"""
DVYB Ad-Hoc Content Generation Endpoint
Handles on-demand content generation from the "Generate Content Now" button.

Generation Flow:
1. Gather context from dvyb_context table
2. Analyze user-uploaded images with Grok (inventory analysis)
3. Analyze user-provided links with OpenAI (web search)
4. Generate prompts with Grok (image + clip prompts)
5. Generate images with FAL
6. Generate clips with Kling
7. Save progressively to dvyb_generated_content table
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, File, Form, UploadFile
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
import uuid
import math
import random
from datetime import datetime
import asyncio
import httpx

from app.services.grok_prompt_service import grok_service
from app.utils.web2_s3_helper import web2_s3_helper
import fal_client
import os
from app.config.settings import settings
import tempfile
import requests
from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, CompositeVideoClip, CompositeAudioClip
from PIL import Image
import io

logger = logging.getLogger(__name__)
router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Track active generation jobs
active_jobs: Dict[str, Any] = {}

# Import for timeout mechanism
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import threading

# Timeout for FAL clip generation (5 minutes = 300 seconds)
FAL_CLIP_TIMEOUT_SECONDS = 300


def generate_clip_with_timeout_and_fallback(
    primary_model: dict,
    fallback_model: dict,
    clip_prompt: str,
    frame_presigned_url: str,
    clip_num: int,
    video_idx: int,
    timeout_seconds: int = FAL_CLIP_TIMEOUT_SECONDS
) -> tuple:
    """
    Generate a clip with FAL, with timeout and automatic model fallback.
    
    Args:
        primary_model: Primary model config dict with 'name', 'fal_model', 'clip_duration', 'duration_param'
        fallback_model: Fallback model config to use if primary times out
        clip_prompt: The prompt for clip generation
        frame_presigned_url: Presigned URL of the starting frame
        clip_num: Clip number for logging
        video_idx: Video index for logging
        timeout_seconds: Timeout in seconds (default 7 minutes)
    
    Returns:
        tuple: (result, model_used_name, model_used_fal, clip_duration, success)
    """
    
    def _build_fal_arguments(model_name: str, model_config: dict) -> dict:
        """Build FAL arguments based on model type."""
        if model_name == "kling_v2.6":
            return {
                "prompt": clip_prompt,
                "image_url": frame_presigned_url,
                "duration": model_config["duration_param"],  # "5" or "10" (string without 's')
                "negative_prompt": "blur, distort, low quality, pixelated, noisy, grainy, out of focus, poorly lit, poorly exposed, poorly composed, poorly framed, poorly cropped, poorly color corrected, poorly color graded, additional bubbles, particles, extra text, double logos",
                "cfg_scale": 0.5,
                "generate_audio": True
            }
        else:  # veo3.1
            return {
                "prompt": clip_prompt,
                "image_url": frame_presigned_url,
                "aspect_ratio": "9:16",
                "duration": model_config["duration_param"],  # "8s" (with 's' suffix)
                "generate_audio": True,
                "resolution": "720p"
            }
    
    def _call_fal_blocking(model_config: dict):
        """Blocking FAL call to run in thread."""
        model_name = model_config["name"]
        fal_model = model_config["fal_model"]
        fal_args = _build_fal_arguments(model_name, model_config)
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    print(f"    [FAL] {log.get('message', '')}")
        
        result = fal_client.subscribe(
            fal_model,
            arguments=fal_args,
            with_logs=True,
            on_queue_update=on_queue_update
        )
        return result
    
    def _try_model_with_timeout(model_config: dict, is_fallback: bool = False) -> tuple:
        """Try a model with timeout, returns (result, success)."""
        model_name = model_config["name"]
        label = "FALLBACK" if is_fallback else ""
        
        print(f"  🎬 [{model_name.upper()}] {label} Generating clip {clip_num} (timeout: {timeout_seconds}s / {timeout_seconds//60}min)...")
        print(f"     Model: {model_config['fal_model']}")
        print(f"     Duration: {model_config['clip_duration']}s")
        
        # Create executor WITHOUT context manager to avoid blocking on shutdown
        executor = ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(_call_fal_blocking, model_config)
            try:
                result = future.result(timeout=timeout_seconds)
                if result and "video" in result:
                    print(f"  ✅ [{model_name.upper()}] {label} Clip generated successfully!")
                    return (result, True)
                else:
                    print(f"  ⚠️ [{model_name.upper()}] {label} No video in result")
                    return (None, False)
            except FuturesTimeoutError:
                print(f"\n  ⏰ TIMEOUT! [{model_name.upper()}] {label} did not respond within {timeout_seconds}s ({timeout_seconds//60} minutes)")
                # Don't wait for the thread - let it run in background (FAL will handle it)
                future.cancel()
                return (None, False)
        except Exception as e:
            print(f"  ❌ [{model_name.upper()}] {label} Error: {e}")
            return (None, False)
        finally:
            # Shutdown executor without waiting for pending futures
            executor.shutdown(wait=False)
    
    # Try primary model first
    result, success = _try_model_with_timeout(primary_model, is_fallback=False)
    if success:
        return (result, primary_model["name"], primary_model["fal_model"], primary_model["clip_duration"], True)
    
    # Primary failed, try fallback
    print(f"  🔄 Switching to fallback model: {fallback_model['name'].upper()}...")
    result, success = _try_model_with_timeout(fallback_model, is_fallback=True)
    if success:
        return (result, fallback_model["name"], fallback_model["fal_model"], fallback_model["clip_duration"], True)
    
    # Both failed
    print(f"  ❌ Both models failed - clip {clip_num} generation failed")
    return (None, fallback_model["name"], fallback_model["fal_model"], fallback_model["clip_duration"], False)


def get_fallback_model(current_model_name: str) -> dict:
    """Get the fallback model configuration based on current model."""
    if current_model_name == "kling_v2.6":
        return {
            "name": "veo3.1",
            "fal_model": "fal-ai/veo3.1/fast/image-to-video",
            "clip_duration": 8,
            "duration_param": "8s"
        }
    else:  # veo3.1
        return {
            "name": "kling_v2.6",
            "fal_model": "fal-ai/kling-video/v2.6/pro/image-to-video",
            "clip_duration": 10,
            "duration_param": "10"
        }


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class DvybAdhocGenerationRequest(BaseModel):
    """Request for ad-hoc content generation"""
    account_id: int
    topic: str
    platforms: List[str]  # e.g., ["instagram", "twitter", "linkedin", "tiktok"]
    number_of_posts: int  # 1-4
    number_of_images: Optional[int] = None  # Specific number of image posts (calculated by frontend based on limits)
    number_of_videos: Optional[int] = None  # Specific number of video posts (calculated by frontend based on limits)
    user_prompt: Optional[str] = None
    user_images: Optional[List[str]] = None  # S3 URLs
    inspiration_links: Optional[List[str]] = None
    clips_per_video: Optional[int] = 1  # Default 1 clip (8s), can be 2 (16s) or 3 (24s)


class DvybAdhocGenerationResponse(BaseModel):
    """Response from ad-hoc generation"""
    success: bool
    job_id: Optional[str] = None
    uuid: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


class GenerationStatus(BaseModel):
    """Status of a generation job"""
    success: bool
    status: str
    progress_percent: int
    progress_message: str
    data: Optional[Dict[str, Any]] = None


# ============================================
# IMAGE FORMAT HELPERS
# ============================================

def convert_logo_to_png_if_needed(logo_s3_key: str, account_id: int) -> str:
    """
    Convert logo to PNG if it's in an unsupported format (SVG, AVIF, WEBP).
    FAL only supports JPG, JPEG, and PNG.
    
    Returns: The S3 key of the PNG logo (either original or converted)
    """
    if not logo_s3_key:
        return logo_s3_key
    
    # Check file extension
    logo_lower = logo_s3_key.lower()
    
    # If already a supported format, return as-is
    if logo_lower.endswith(('.jpg', '.jpeg', '.png')):
        print(f"✅ Logo is already in supported format: {logo_s3_key}")
        return logo_s3_key
    
    # Check for unsupported formats
    needs_conversion = logo_lower.endswith(('.svg', '.avif', '.webp'))
    
    if not needs_conversion:
        print(f"⚠️ Logo format unknown, attempting to use as-is: {logo_s3_key}")
        return logo_s3_key
    
    print(f"🔄 Logo needs conversion to PNG: {logo_s3_key}")
    
    try:
        import io
        from PIL import Image
        import cairosvg  # For SVG conversion
        
        # Generate presigned URL to download the logo
        presigned_url = web2_s3_helper.generate_presigned_url(logo_s3_key)
        if not presigned_url:
            print(f"❌ Failed to get presigned URL for logo conversion, using original")
            return logo_s3_key
        
        # Download the logo
        response = requests.get(presigned_url, timeout=30)
        if response.status_code != 200:
            print(f"❌ Failed to download logo (status {response.status_code}), using original")
            return logo_s3_key
        
        content = response.content
        png_content = None
        
        # Convert based on format
        if logo_lower.endswith('.svg'):
            print(f"🎨 Converting SVG to PNG...")
            try:
                # Convert SVG to PNG using cairosvg
                png_content = cairosvg.svg2png(bytestring=content, output_width=1024)
                print(f"✅ SVG converted to PNG successfully")
            except Exception as svg_error:
                print(f"⚠️ SVG conversion failed: {svg_error}")
                # Try PIL as fallback (may not work for complex SVGs)
                try:
                    image = Image.open(io.BytesIO(content))
                    png_buffer = io.BytesIO()
                    image.save(png_buffer, format='PNG')
                    png_content = png_buffer.getvalue()
                    print(f"✅ SVG converted via PIL fallback")
                except Exception as pil_error:
                    print(f"❌ PIL fallback also failed: {pil_error}")
                    return logo_s3_key
                    
        elif logo_lower.endswith('.avif'):
            print(f"🎨 Converting AVIF to PNG...")
            try:
                # pillow-avif-plugin should handle AVIF if installed
                image = Image.open(io.BytesIO(content))
                if image.mode in ('RGBA', 'LA'):
                    background = Image.new('RGB', image.size, (255, 255, 255))
                    background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                    image = background
                elif image.mode != 'RGB':
                    image = image.convert('RGB')
                
                png_buffer = io.BytesIO()
                image.save(png_buffer, format='PNG')
                png_content = png_buffer.getvalue()
                print(f"✅ AVIF converted to PNG successfully")
            except Exception as avif_error:
                print(f"❌ AVIF conversion failed: {avif_error}")
                return logo_s3_key
                
        elif logo_lower.endswith('.webp'):
            print(f"🎨 Converting WEBP to PNG...")
            try:
                image = Image.open(io.BytesIO(content))
                if image.mode in ('RGBA', 'LA'):
                    background = Image.new('RGB', image.size, (255, 255, 255))
                    background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                    image = background
                elif image.mode != 'RGB':
                    image = image.convert('RGB')
                
                png_buffer = io.BytesIO()
                image.save(png_buffer, format='PNG')
                png_content = png_buffer.getvalue()
                print(f"✅ WEBP converted to PNG successfully")
            except Exception as webp_error:
                print(f"❌ WEBP conversion failed: {webp_error}")
                return logo_s3_key
        
        if not png_content:
            print(f"❌ No PNG content generated, using original")
            return logo_s3_key
        
        # Save converted PNG to temp file and upload to S3
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
            temp_file.write(png_content)
            temp_file_path = temp_file.name
        
        try:
            # Generate a unique filename for the converted logo
            original_name = logo_s3_key.split('/')[-1].rsplit('.', 1)[0]  # Get filename without extension
            png_filename = f"{original_name}_converted_{uuid.uuid4().hex[:8]}.png"
            
            # Upload to S3
            new_s3_key = web2_s3_helper.upload_from_file(
                file_path=temp_file_path,
                folder=f"dvyb/converted-logos/{account_id}",
                filename=png_filename
            )
            
            print(f"✅ Converted logo uploaded to S3: {new_s3_key}")
            return new_s3_key
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
                
    except ImportError as ie:
        print(f"⚠️ Missing dependency for logo conversion: {ie}")
        print(f"⚠️ Using original logo - may fail at FAL if format unsupported")
        return logo_s3_key
    except Exception as e:
        print(f"❌ Logo conversion failed: {e}")
        print(f"⚠️ Using original logo - may fail at FAL if format unsupported")
        return logo_s3_key


# ============================================
# DATABASE HELPERS
# ============================================

async def create_generation_record(account_id: int, request: DvybAdhocGenerationRequest, job_id: str, generation_uuid: str):
    """Create initial generation record in database"""
    import httpx
    
    try:
        # Always use environment variable for backend URL
        backend_url = settings.typescript_backend_url
        if not backend_url:
            raise ValueError("TYPESCRIPT_BACKEND_URL environment variable is not set")
        
        create_url = f"{backend_url}/api/dvyb/create"
        
        print(f"\n📡 CREATING GENERATION RECORD in TypeScript Backend")
        print(f"  🔗 URL: {create_url}")
        print(f"  📊 Account ID: {account_id}")
        print(f"  🆔 UUID: {generation_uuid}")
        print(f"  🏷️ Job ID: {job_id}")
        
        data = {
            "accountId": account_id,
            "uuid": generation_uuid,
            "jobId": job_id,
            "generationType": "on_demand",
            "topic": request.topic,
            "userPrompt": request.user_prompt,
            "userImages": request.user_images,
            "numberOfPosts": request.number_of_posts,
            "requestedPlatforms": request.platforms,  # NEW: Save selected platforms for "Post Now"
            "status": "generating",
            "progressPercent": 0,
            "progressMessage": "Starting generation...",
        }
        
        logger.debug(f"🔄 Creating generation record: {create_url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                create_url,
                json=data
            )
            response.raise_for_status()
            
            print(f"  ✅ Generation record created successfully (status: {response.status_code})")
            
        logger.info(f"✅ Created generation record: {generation_uuid}")
        
    except httpx.HTTPStatusError as e:
        print(f"  ❌ HTTP Error {e.response.status_code}: {e.response.text[:200]}")
        logger.error(f"❌ HTTP error creating generation record: {e}")
        raise
    except httpx.RequestError as e:
        print(f"  ❌ Request Error: {str(e)[:200]}")
        logger.error(f"❌ Request error creating generation record: {e}")
        raise
    except Exception as e:
        print(f"  ❌ Unexpected Error: {str(e)[:200]}")
        logger.error(f"❌ Failed to create generation record at {create_url}: {e}")
        raise


async def update_progress_in_db(account_id: int, progress: int, message: str, generation_uuid: str = None, metadata: Dict = None):
    """Update generation progress in database"""
    import httpx
    
    try:
        # Always use environment variable for backend URL
        backend_url = settings.typescript_backend_url
        if not backend_url:
            raise ValueError("TYPESCRIPT_BACKEND_URL environment variable is not set")
        
        update_url = f"{backend_url}/api/dvyb/update-progress"
        
        data = {
            "accountId": account_id,
            "uuid": generation_uuid,  # Pass UUID for reliable lookup
            "progressPercent": progress,
            "progressMessage": message,
        }
        
        if metadata:
            data["metadata"] = metadata
        
        logger.debug(f"🔄 Calling progress update: {update_url} (UUID: {generation_uuid})")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                update_url,
                json=data
            )
            response.raise_for_status()
            
        logger.info(f"✅ Updated progress: {progress}% - {message}")
        
    except Exception as e:
        logger.error(f"❌ Failed to update progress to {backend_url}/api/dvyb/update-progress: {e}")


async def save_generated_content_to_db(account_id: int, generation_uuid: str, platform_texts: List, frame_prompts: List, clip_prompts: List, image_urls: List, video_urls: List):
    """Save generated content to database"""
    import httpx
    
    try:
        # Always use environment variable for backend URL
        backend_url = settings.typescript_backend_url
        if not backend_url:
            raise ValueError("TYPESCRIPT_BACKEND_URL environment variable is not set")
        
        save_url = f"{backend_url}/api/dvyb/save-content"
        
        data = {
            "uuid": generation_uuid,
            "platformTexts": platform_texts,
            "framePrompts": frame_prompts,
            "clipPrompts": clip_prompts,
            "generatedImageUrls": image_urls,
            "generatedVideoUrls": video_urls,
            "status": "completed",
            "progressPercent": 100,
            "progressMessage": "Generation completed!",
        }
        
        logger.debug(f"🔄 Saving generated content: {save_url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                save_url,
                json=data
            )
            response.raise_for_status()
            
        logger.info(f"✅ Saved generated content to database")
        
    except Exception as e:
        logger.error(f"❌ Failed to save content to {save_url}: {e}")
        raise


async def update_progressive_content(account_id: int, generation_uuid: str, post_index: int, content_type: str, content_url: str, platform_text: Dict):
    """Update database with a single piece of generated content progressively"""
    import httpx
    
    try:
        # Always use environment variable for backend URL
        backend_url = settings.typescript_backend_url
        if not backend_url:
            print(f"  ⚠️ TYPESCRIPT_BACKEND_URL not set in environment, using default")
            backend_url = "http://localhost:3001"
        
        update_url = f"{backend_url}/api/dvyb/update-progressive-content"
        
        data = {
            "accountId": account_id,  # Include for logging/debugging
            "uuid": generation_uuid,
            "postIndex": post_index,
            "contentType": content_type,  # "image" or "video"
            "contentUrl": content_url,
            "platformText": platform_text,
        }
        
        print(f"\n📡 PROGRESSIVE UPDATE - Sending to TypeScript Backend")
        print(f"  🔗 URL: {update_url}")
        print(f"  📊 Post Index: {post_index}")
        print(f"  📦 Content Type: {content_type}")
        print(f"  📁 Content URL: {content_url[:80]}...")
        print(f"  📝 Platform Text: {list(platform_text.get('platforms', {}).keys()) if platform_text else 'None'}")
        
        logger.debug(f"🔄 Progressive update for post {post_index}: {content_type}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                update_url,
                json=data
            )
            response.raise_for_status()
            
            print(f"  ✅ Progressive update API call successful (status: {response.status_code})")
            
        logger.info(f"✅ Progressive update saved for post {post_index}")
        
    except httpx.HTTPStatusError as e:
        print(f"  ❌ HTTP Error {e.response.status_code}: {e.response.text[:200]}")
        logger.warning(f"⚠️ HTTP error saving progressive update for post {post_index}: {e}")
        # Don't raise - progressive updates are optional
    except httpx.RequestError as e:
        print(f"  ❌ Request Error: {str(e)[:200]}")
        logger.warning(f"⚠️ Request error saving progressive update for post {post_index}: {e}")
        # Don't raise - progressive updates are optional
    except Exception as e:
        print(f"  ❌ Unexpected Error: {str(e)[:200]}")
        logger.warning(f"⚠️ Failed to save progressive update for post {post_index}: {e}")
        # Don't raise - progressive updates are optional


# ============================================
# MODEL MAPPING
# ============================================

def map_model_name_to_fal_id(model_name: str) -> str:
    """Map model names to Fal.ai model IDs (matching web3)"""
    model_mapping = {
        'seedream': 'fal-ai/bytedance/seedream/v4/edit',
        'nano-banana': 'fal-ai/nano-banana/edit',
        'flux-pro-kontext': 'fal-ai/flux-pro/kontext'
    }
    return model_mapping.get(model_name, 'fal-ai/nano-banana/edit')  # Default to nano-banana for DVYB


# ============================================
# AUDIO/VIDEO PROCESSING HELPERS
# ============================================

def extract_audio_from_video(video_path: str) -> str:
    """Extract audio from video file and return audio file path."""
    try:
        print(f"🎵 Extracting audio from video...")
        
        video_clip = VideoFileClip(video_path)
        
        if video_clip.audio is None:
            print(f"⚠️ No audio found in video")
            video_clip.close()
            return None
        
        # Extract audio
        audio_path = video_path.replace('.mp4', '_audio.mp3')
        video_clip.audio.write_audiofile(audio_path, codec='mp3', logger=None)
        
        video_clip.close()
        
        print(f"✅ Audio extracted: {audio_path}")
        return audio_path
        
    except Exception as e:
        print(f"❌ Error extracting audio: {str(e)}")
        return None


def remove_audio_from_video(video_path: str) -> str:
    """Remove audio from video file and return video-only file path."""
    try:
        print(f"🎬 Removing audio from video...")
        
        video_clip = VideoFileClip(video_path)
        video_only = video_clip.without_audio()
        
        # Save video without audio
        video_only_path = video_path.replace('.mp4', '_no_audio.mp4')
        video_only.write_videofile(
            video_only_path,
            codec='libx264',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        video_clip.close()
        video_only.close()
        
        print(f"✅ Video without audio created: {video_only_path}")
        return video_only_path
        
    except Exception as e:
        print(f"❌ Error removing audio: {str(e)}")
        return None


def separate_voice_from_music_demucs(video_path: str) -> str:
    """
    Separate voice from background music in video using Demucs.
    This is specifically for Veo clips that have unwanted background music.
    """
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        import numpy as np
        
        print(f"🎵 Separating voice from background music using Demucs...")
        
        # Extract audio from video
        video_clip = VideoFileClip(video_path)
        audio_path = video_path.replace('.mp4', '_audio.wav')
        video_clip.audio.write_audiofile(audio_path, codec='pcm_s16le', logger=None)
        
        # Load Demucs model (htdemucs is best for vocals)
        print("🤖 Loading Demucs model...")
        model = get_model('htdemucs')
        model.eval()
        
        # Load audio with torchaudio
        print("📂 Loading audio file...")
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Ensure stereo
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        # Apply model
        print("🔬 Separating voice from music (this may take 10-30 seconds)...")
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # Extract vocals (index 3 in htdemucs output)
        # htdemucs outputs: drums, bass, other, vocals
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Save voice-only audio
        voice_only_audio_path = video_path.replace('.mp4', '_voice_only.wav')
        sf.write(voice_only_audio_path, vocals, sample_rate)
        print(f"✅ Voice-only audio saved: {voice_only_audio_path}")
        
        # Replace video audio with voice-only audio
        voice_audio_clip = AudioFileClip(voice_only_audio_path)
        video_with_voice = video_clip.set_audio(voice_audio_clip)
        
        # Save final video with voice only
        output_path = video_path.replace('.mp4', '_voice_only.mp4')
        video_with_voice.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Close clips
        video_clip.close()
        voice_audio_clip.close()
        video_with_voice.close()
        
        # Clean up intermediate files
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(voice_only_audio_path):
            os.remove(voice_only_audio_path)
        
        print(f"✅ Voice separation complete: {output_path}")
        return output_path
        
    except ImportError as e:
        print(f"⚠️ Demucs not installed: {e}")
        print("⚠️ Skipping voice separation - using original video")
        return video_path
    except Exception as e:
        print(f"⚠️ Voice separation failed: {type(e).__name__}: {e}")
        print("⚠️ Using original video")
        return video_path


def trim_ugc_clip_at_speech_end(video_path: str, min_search_time: float = 5.0, buffer_ms: int = 300) -> str:
    """
    Trim UGC/influencer clip at the point where speech ends (after min_search_time).
    Uses Demucs to separate vocals and detect when the character stops speaking.
    
    Args:
        video_path: Path to the video file
        min_search_time: Only look for speech end AFTER this time (default 5.0 seconds)
        buffer_ms: Add this buffer after speech ends (default 300ms)
    
    Returns:
        Path to trimmed video (or original if trimming not needed/failed)
    """
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        import numpy as np
        
        print(f"\n{'='*60}")
        print(f"✂️ UGC CLIP TRIMMING: Detecting speech end point")
        print(f"{'='*60}")
        print(f"📍 Min search time: {min_search_time}s (only look after this point)")
        print(f"📍 Buffer after speech: {buffer_ms}ms")
        
        # Get video duration first
        video_clip = VideoFileClip(video_path)
        video_duration = video_clip.duration
        print(f"📏 Original video duration: {video_duration:.2f}s")
        
        if video_duration <= min_search_time:
            print(f"⚠️ Video too short ({video_duration:.2f}s <= {min_search_time}s), skipping trim")
            video_clip.close()
            return video_path
        
        # Extract audio from video
        audio_path = video_path.replace('.mp4', '_trim_audio.wav')
        video_clip.audio.write_audiofile(audio_path, codec='pcm_s16le', logger=None)
        print(f"🎵 Audio extracted for analysis")
        
        # Load Demucs model
        print("🤖 Loading Demucs model for speech detection...")
        model = get_model('htdemucs')
        model.eval()
        
        # Load audio with torchaudio
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Ensure stereo for Demucs
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        # Apply model to separate vocals
        print("🔬 Separating vocals to detect speech...")
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # Extract vocals (index 3 in htdemucs output)
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Calculate RMS energy in small windows to detect speech activity
        print("📊 Analyzing vocal track for speech activity...")
        window_size = int(sample_rate * 0.05)  # 50ms windows
        hop_size = int(sample_rate * 0.025)    # 25ms hop
        
        # Calculate RMS for each window
        num_windows = (len(vocals) - window_size) // hop_size + 1
        rms_values = []
        
        for i in range(num_windows):
            start = i * hop_size
            end = start + window_size
            window = vocals[start:end]
            rms = np.sqrt(np.mean(window ** 2))
            rms_values.append(rms)
        
        rms_values = np.array(rms_values)
        
        # Normalize RMS values
        if rms_values.max() > 0:
            rms_normalized = rms_values / rms_values.max()
        else:
            print("⚠️ No audio detected, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        # Find speech threshold (use 10% of max as threshold)
        speech_threshold = 0.10
        
        # Calculate time for each window
        window_times = np.array([i * hop_size / sample_rate for i in range(len(rms_values))])
        
        # Find the LAST time speech is above threshold AFTER min_search_time
        min_search_index = np.searchsorted(window_times, min_search_time)
        
        # Look for speech end after min_search_time
        speech_active_after_min = rms_normalized[min_search_index:] > speech_threshold
        
        if not np.any(speech_active_after_min):
            print(f"⚠️ No speech detected after {min_search_time}s, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        # Find the last index where speech is active (after min_search_time)
        last_speech_indices = np.where(speech_active_after_min)[0]
        if len(last_speech_indices) == 0:
            print(f"⚠️ Speech ended before {min_search_time}s, skipping trim")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        last_speech_index = last_speech_indices[-1] + min_search_index
        speech_end_time = window_times[last_speech_index]
        
        # Add buffer (300ms default)
        trim_time = speech_end_time + (buffer_ms / 1000.0)
        
        # Don't trim if speech goes to near the end anyway
        if trim_time >= video_duration - 0.2:
            print(f"✅ Speech continues until near end ({speech_end_time:.2f}s), no trimming needed")
            video_clip.close()
            os.remove(audio_path)
            return video_path
        
        print(f"🎯 Speech end detected at: {speech_end_time:.2f}s")
        print(f"✂️ Trimming video at: {trim_time:.2f}s (speech end + {buffer_ms}ms buffer)")
        
        # Trim the video
        trimmed_clip = video_clip.subclip(0, trim_time)
        
        # Save trimmed video
        output_path = video_path.replace('.mp4', '_trimmed.mp4')
        trimmed_clip.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-trim-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Close clips
        video_clip.close()
        trimmed_clip.close()
        
        # Clean up
        if os.path.exists(audio_path):
            os.remove(audio_path)
        
        trimmed_duration = VideoFileClip(output_path).duration
        print(f"\n✅ UGC CLIP TRIMMED SUCCESSFULLY!")
        print(f"   Original: {video_duration:.2f}s → Trimmed: {trimmed_duration:.2f}s")
        print(f"   Saved: {(video_duration - trimmed_duration):.2f}s of awkward silence removed")
        print(f"{'='*60}\n")
        
        return output_path
        
    except ImportError as e:
        print(f"⚠️ Demucs not available for speech detection: {e}")
        print("⚠️ Skipping UGC clip trim - using original video")
        return video_path
    except Exception as e:
        print(f"⚠️ UGC clip trimming failed: {type(e).__name__}: {e}")
        import traceback
        print(f"⚠️ Traceback: {traceback.format_exc()}")
        print("⚠️ Using original video")
        return video_path


async def generate_background_music_with_pixverse(video_s3_url: str, audio_prompt: str, duration: int, account_id: int, generation_uuid: str, video_index: int) -> str:
    """Generate background music for video using Pixverse Sound Effects."""
    try:
        print(f"🎵 Generating background music with Pixverse Sound Effects...")
        print(f"   Audio prompt: {audio_prompt[:100]}...")
        
        # Generate presigned URL for video
        presigned_video_url = web2_s3_helper.generate_presigned_url(video_s3_url)
        if not presigned_video_url:
            print("❌ Failed to generate presigned URL for video")
            return None
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    print(log["message"])
        
        result = fal_client.subscribe(
            "fal-ai/pixverse/sound-effects",
            arguments={
                "video_url": presigned_video_url,
                "prompt": audio_prompt,
                "duration": str(duration)
            },
            with_logs=True,
            on_queue_update=on_queue_update
        )
        
        if result and 'video' in result:
            fal_video_url = result['video']['url']
            
            # Upload to S3
            s3_url = web2_s3_helper.upload_from_url(
                url=fal_video_url,
                folder=f"dvyb/generated/{account_id}/{generation_uuid}",
                filename=f"video_{video_index}_with_music.mp4"
            )
            
            print(f"✅ Background music added: {s3_url}")
            return s3_url
        else:
            print("❌ No video found in Pixverse result")
            return None
            
    except Exception as e:
        print(f"❌ Error generating background music: {str(e)}")
        logger.error(f"Pixverse background music error: {e}")
        return None


async def mix_voiceover_with_background_music(video_with_music_s3_url: str, voiceover_audio_path: str, account_id: int, generation_uuid: str, video_index: int) -> str:
    """Mix voiceover with background music video, with voiceover at higher volume."""
    try:
        print(f"🎵 Mixing voiceover with background music...")
        
        # Download video with music from S3
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
            presigned_url = web2_s3_helper.generate_presigned_url(video_with_music_s3_url)
            response = requests.get(presigned_url)
            temp_file.write(response.content)
            video_with_music_path = temp_file.name
        
        # Verify voiceover file exists
        if not os.path.exists(voiceover_audio_path):
            print(f"❌ Voiceover file not found: {voiceover_audio_path}")
            return None
        
        # Load video and audio files
        video_clip = VideoFileClip(video_with_music_path)
        background_music_clip = video_clip.audio
        voiceover_clip = AudioFileClip(voiceover_audio_path)
        
        # Adjust volumes: voiceover louder than background music
        background_music_clip = background_music_clip.volumex(0.3)  # 30% volume for background music
        voiceover_clip = voiceover_clip.volumex(1.0)  # 100% volume for voiceover
        
        # Mix audio tracks together
        combined_audio = CompositeAudioClip([background_music_clip, voiceover_clip])
        
        # Set audio to video
        final_clip = video_clip.set_audio(combined_audio)
        
        # Save final clip to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as final_temp:
            final_path = final_temp.name
        
        final_clip.write_videofile(
            final_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Upload to S3
        s3_url = web2_s3_helper.upload_from_file(
            file_path=final_path,
            folder=f"dvyb/generated/{account_id}/{generation_uuid}",
            filename=f"final_video_{video_index}.mp4"
        )
        
        # Clean up
        video_clip.close()
        voiceover_clip.close()
        final_clip.close()
        
        try:
            os.remove(video_with_music_path)
            os.remove(final_path)
            os.remove(voiceover_audio_path)
        except:
            pass
        
        print(f"✅ Voiceover mixed with background music: {s3_url}")
        return s3_url
        
    except Exception as e:
        print(f"❌ Error mixing voiceover with background music: {str(e)}")
        logger.error(f"Audio mixing error: {e}")
        return None


# ============================================
# CONTEXT GATHERING
# ============================================

async def gather_context(request: DvybAdhocGenerationRequest) -> Dict:
    """
    Gather all context for generation including:
    - Topic, platforms, user prompt
    - DVYB context (brand info, voices, styles, logos, images, documents, links)
    - Random selection from arrays for variety
    - Document/link decay filtering
    """
    import httpx
    from datetime import datetime, timedelta
    
    context = {
        "topic": request.topic,
        "platforms": request.platforms,
        "number_of_posts": request.number_of_posts,
        "user_prompt": request.user_prompt,
        "current_date": datetime.utcnow().isoformat(),  # For document/link decay
    }
    
    # Fetch dvyb_context from backend (internal endpoint, no auth required)
    try:
        backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{backend_url}/api/dvyb/context/internal",
                params={"accountId": request.account_id}
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success") and result.get("data"):
                dvyb_data = result["data"]
                context["dvyb_context"] = dvyb_data
                
                # Process brandVoices, brandVoice, brandStyles, keywords (JSON columns)
                # These will be passed to Grok for random selection
                context["brand_voices"] = dvyb_data.get("brandVoices") if dvyb_data.get("brandVoices") else None
                context["brand_voice"] = dvyb_data.get("brandVoice") if dvyb_data.get("brandVoice") else None
                context["brand_styles"] = dvyb_data.get("brandStyles") if dvyb_data.get("brandStyles") else None
                context["keywords"] = dvyb_data.get("keywords") if dvyb_data.get("keywords") else None
                
                # Process additionalLogoUrls - randomly pick one logo (from logoUrl or additionalLogoUrls)
                logo_url = dvyb_data.get("logoUrl")
                additional_logos = dvyb_data.get("additionalLogoUrls")
                
                available_logos = []
                if logo_url:
                    available_logos.append(logo_url)
                if additional_logos and isinstance(additional_logos, list):
                    available_logos.extend([url for url in additional_logos if url])
                
                if available_logos:
                    selected_logo = random.choice(available_logos)
                    context["selected_logo_url"] = selected_logo
                    logger.info(f"🎨 Selected logo from {len(available_logos)} available: {selected_logo[:50]}...")
                else:
                    context["selected_logo_url"] = None
                    logger.info("⚠️ No logo URLs available")
                
                # Process brandImages - randomly pick one for inventory analysis
                brand_images = dvyb_data.get("brandImages")
                if brand_images and isinstance(brand_images, list) and len(brand_images) > 0:
                    selected_brand_image = random.choice([img for img in brand_images if img])
                    context["selected_brand_image"] = selected_brand_image
                    logger.info(f"🖼️ Selected brand image from {len(brand_images)} available: {selected_brand_image[:50]}...")
                else:
                    context["selected_brand_image"] = None
                
                # Process linksJson - filter by 10-day decay and pick one random link
                links_json = dvyb_data.get("linksJson")
                if links_json and isinstance(links_json, list):
                    cutoff_date = datetime.utcnow() - timedelta(days=10)
                    valid_links = []
                    
                    for link_obj in links_json:
                        if not isinstance(link_obj, dict):
                            continue
                        
                        timestamp_str = link_obj.get("timestamp")
                        url = link_obj.get("url")
                        
                        if not url:
                            continue
                        
                        # Check timestamp (filter out links older than 10 days)
                        if timestamp_str:
                            try:
                                link_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                if link_date.tzinfo:
                                    link_date = link_date.replace(tzinfo=None)
                                
                                if link_date >= cutoff_date:
                                    valid_links.append(link_obj)
                            except Exception as e:
                                logger.warning(f"⚠️ Error parsing link timestamp: {e}")
                                # Include link if timestamp parsing fails
                                valid_links.append(link_obj)
                        else:
                            # Include link if no timestamp
                            valid_links.append(link_obj)
                    
                    if valid_links:
                        selected_link = random.choice(valid_links)
                        context["selected_link"] = selected_link.get("url")  # Store FULL URL, no truncation
                        logger.info(f"🔗 Selected link from {len(valid_links)} valid (after 10-day filter): {selected_link.get('url')}")
                    else:
                        context["selected_link"] = None
                        logger.info(f"⚠️ No valid links found (filtered {len(links_json)} total by 10-day decay)")
                else:
                    context["selected_link"] = None
                
                # Process documentsText - apply 30-day decay and pass with timestamps
                documents_text = dvyb_data.get("documentsText")
                if documents_text and isinstance(documents_text, list):
                    cutoff_date = datetime.utcnow() - timedelta(days=30)
                    valid_documents = []
                    
                    for doc in documents_text:
                        if not isinstance(doc, dict):
                            continue
                        
                        timestamp_str = doc.get("timestamp")
                        if timestamp_str:
                            try:
                                doc_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                if doc_date.tzinfo:
                                    doc_date = doc_date.replace(tzinfo=None)
                                
                                if doc_date >= cutoff_date:
                                    # Calculate age in days for Grok context
                                    days_old = (datetime.utcnow() - doc_date).days
                                    valid_documents.append({
                                        "name": doc.get("name", ""),
                                        "text": doc.get("text", ""),
                                        "url": doc.get("url", ""),
                                        "timestamp": timestamp_str,
                                        "age_days": days_old
                                    })
                            except Exception as e:
                                logger.warning(f"⚠️ Error parsing document timestamp: {e}")
                                # Include document if timestamp parsing fails
                                valid_documents.append({
                                    "name": doc.get("name", ""),
                                    "text": doc.get("text", ""),
                                    "url": doc.get("url", ""),
                                })
                        else:
                            # Include document if no timestamp
                            valid_documents.append({
                                "name": doc.get("name", ""),
                                "text": doc.get("text", ""),
                                "url": doc.get("url", ""),
                            })
                    
                    context["documents_text"] = valid_documents
                    logger.info(f"📚 Documents after 30-day decay: {len(valid_documents)}/{len(documents_text)}")
                else:
                    context["documents_text"] = []
                
                logger.info(f"✅ Fetched and processed dvyb_context for account {request.account_id}")
            else:
                logger.warning(f"⚠️ No dvyb_context found for account {request.account_id}")
                context["dvyb_context"] = {}
                
    except Exception as e:
        logger.error(f"❌ Failed to fetch dvyb_context: {e}")
        context["dvyb_context"] = {}
    
    return context


# ============================================
# IMAGE ANALYSIS (GROK INVENTORY ANALYSIS)
# ============================================

async def analyze_user_images(user_images: List[str], context: Dict) -> Dict:
    """Analyze user-uploaded images with Grok using full brand context"""
    if not user_images:
        return {}
    
    try:
        print("=" * 80)
        print("🔍 GROK INVENTORY ANALYSIS (WITH BRAND CONTEXT)")
        print("=" * 80)
        print(f"📸 Number of images: {len(user_images)}")
        print(f"📸 Image URLs: {user_images}")
        
        # Get full brand context
        dvyb_context = context.get("dvyb_context", {})
        
        # Get topic and user prompt/instructions
        topic = context.get("topic", "")
        user_prompt = context.get("user_prompt", "")
        
        # Extract relevant brand information
        brand_info = {
            "account_name": dvyb_context.get("accountName", ""),
            "website": dvyb_context.get("website", ""),
            "industry": dvyb_context.get("industry", "General"),
            "business_overview": dvyb_context.get("businessOverview", ""),
            "customer_demographics": dvyb_context.get("customerDemographics", ""),
            "popular_products": dvyb_context.get("popularProducts", []),
            "brand_voice": dvyb_context.get("brandVoice", ""),
            "why_customers_choose": dvyb_context.get("whyCustomersChoose", ""),
        }
        
        print(f"🏢 Brand: {brand_info['account_name']}")
        print(f"🏢 Industry: {brand_info['industry']}")
        print(f"🏢 Business Overview: {brand_info['business_overview'][:100] if brand_info['business_overview'] else 'N/A'}...")
        print(f"📝 Topic: {topic if topic else 'N/A'}")
        print(f"📝 User Instructions: {user_prompt[:100] if user_prompt else 'N/A'}...")
        
        # Get presigned URLs from context (already generated in pipeline)
        user_images_presigned = context.get('user_images_presigned', {})
        
        presigned_urls = []
        brand_image_index = None  # Track which image is the brand image
        
        for s3_key in user_images:
            if s3_key in user_images_presigned:
                presigned_urls.append(user_images_presigned[s3_key])
            else:
                # Fallback: generate if not found (shouldn't happen in normal flow)
                print(f"⚠️ Presigned URL not found for {s3_key}, generating on-demand...")
                try:
                    presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                    presigned_urls.append(presigned_url)
                except Exception as e:
                    logger.error(f"❌ Failed to generate presigned URL for {s3_key}: {e}")
                    presigned_urls.append(s3_key)  # Last resort fallback
        
        # Add selected brand image (if available) as an inspirational image
        selected_brand_image = context.get('selected_brand_image')
        if selected_brand_image:
            print(f"🎨 Adding brand image as inspiration: {selected_brand_image[:50]}...")
            try:
                brand_image_url = web2_s3_helper.generate_presigned_url(selected_brand_image)
                if brand_image_url:
                    presigned_urls.append(brand_image_url)
                    brand_image_index = len(presigned_urls)  # 1-based index
                    print(f"  ✅ Brand image added at index {brand_image_index}")
            except Exception as e:
                logger.error(f"❌ Failed to generate presigned URL for brand image: {e}")
        
        print(f"🔗 Using {len(presigned_urls)} presigned URLs for Grok analysis (including {1 if brand_image_index else 0} brand image)")
        
        # Call Grok inventory analysis with brand context
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
        import json
        
        # Build comprehensive product/inspiration/model classification prompt
        brand_image_note = f"\n\n🎨 **BRAND IMAGE**: Image {brand_image_index} is a brand-provided inspirational image. It MUST be classified as INSPIRATION IMAGE." if brand_image_index else ""
        
        # Build brand context dynamically - only include non-empty fields
        brand_context_lines = []
        if brand_info.get('account_name'):
            brand_context_lines.append(f"- Business: {brand_info['account_name']}")
        if brand_info.get('industry'):
            brand_context_lines.append(f"- Industry: {brand_info['industry']}")
        if brand_info.get('website'):
            brand_context_lines.append(f"- Website: {brand_info['website']}")
        if brand_info.get('business_overview') and str(brand_info['business_overview']).strip():
            brand_context_lines.append(f"- What we do: {str(brand_info['business_overview'])[:500]}")
        if brand_info.get('customer_demographics') and str(brand_info['customer_demographics']).strip():
            brand_context_lines.append(f"- Target Customers: {str(brand_info['customer_demographics'])[:300]}")
        if brand_info.get('popular_products'):
            products_str = str(brand_info['popular_products'])[:300]
            if products_str.strip():
                brand_context_lines.append(f"- Popular Products/Services: {products_str}")
        if brand_info.get('brand_voice') and str(brand_info['brand_voice']).strip():
            brand_context_lines.append(f"- Brand Voice: {str(brand_info['brand_voice'])[:200]}")
        
        brand_context_str = "\n".join(brand_context_lines) if brand_context_lines else "No brand context available"
        
        # Build topic and user instructions section
        user_context_lines = []
        if topic and str(topic).strip():
            user_context_lines.append(f"📌 Topic: {topic}")
        if user_prompt and str(user_prompt).strip():
            user_context_lines.append(f"📌 User Instructions: {user_prompt}")
        user_context_str = "\n".join(user_context_lines) if user_context_lines else ""
        
        analysis_prompt = f"""You are an expert visual analyst for {brand_info.get('account_name', 'the brand')}.

BRAND CONTEXT:
{brand_context_str}
{f'''
USER CONTEXT (PRIORITY - Follow these instructions):
{user_context_str}
''' if user_context_str else ''}{brand_image_note}

🎯 YOUR CRITICAL TASK:
Classify each uploaded image into ONE of these 3 categories:

1. **PRODUCT IMAGES** 🛍️
   - Actual products/services that {brand_info['account_name']} sells or offers
   - Match these against the brand's business overview and popular products
   - Examples: Physical products, packaged goods, food dishes, software interfaces, service offerings
   - **Purpose**: These can be referenced in generated content to show the actual product

2. **INSPIRATION IMAGES** 🎨
   - Style references, aesthetic guides, mood boards, competitor examples
   - NOT the brand's actual products, but style/mood inspirations
   - Examples: Color palettes, art styles, layouts, competitor ads, design references
   - **Purpose**: These guide the overall style and aesthetic direction of generated content

3. **MODEL/INFLUENCER IMAGE** 👤
   - Photos of people/influencers to be used in UGC-style videos
   - Can ONLY be ONE model image (if multiple people, pick the most prominent)
   - Examples: Influencer photo, brand ambassador, human character
   - **Purpose**: This person can appear consistently in UGC-style content

🚨 CLASSIFICATION RULES:

🎯 **USER INSTRUCTIONS ARE PRIORITY**:
- If user instructions specify how to use certain images, FOLLOW those instructions
- Examples:
  * "Use this image as product" → Classify as PRODUCT regardless of visual content
  * "This is the model for UGC" → Classify as MODEL
  * "Use as style inspiration" → Classify as INSPIRATION
  * "Generate UGC style video" → Look for MODEL images to use for UGC
  * "Product showcase" → Prioritize PRODUCT image classification

📌 **TOPIC CONTEXT**:
- Consider the topic when classifying - images should support the content goal
- If topic is "product launch" → prioritize finding PRODUCT images
- If topic is "influencer content" or "UGC" → prioritize finding MODEL images

📋 **DEFAULT RULES** (when no specific user instruction):
- An image can ONLY be in ONE category
- If an image shows a product being held by a person → classify as PRODUCT (not model)
- If an image shows ONLY a person (no product focus) → classify as MODEL
- If an image shows a style/aesthetic reference → classify as INSPIRATION
- Prioritize: PRODUCT > MODEL > INSPIRATION (when uncertain)

📊 OUTPUT FORMAT (STRICT JSON):
Return ONLY this exact JSON structure:

{{
  "product_images": {{
    "count": <number>,
    "indices": [<list of indices, e.g., 1, 3>],
  "image_1": {{
      "category": "Specific Product Category (e.g., Wireless Headphones, Gourmet Pizza, etc.)",
      "features": ["feature1", "feature2", "feature3"],
      "angle": "front view / side view / detail shot / close-up / top-down / etc.",
      "showcases": "What this image showcases best",
      "target_audience": "Target demographic",
      "best_use": "Opening shot / Detail shot / Action shot / etc."
    }}
  }},
  "inspiration_images": {{
    "count": <number>,
    "indices": [<list of indices, e.g., 2>],
    "image_2": {{
      "type": "lifestyle_aesthetic / color_palette / layout_reference / etc.",
      "style": "minimalist modern / bold vibrant / luxury elegant / etc.",
      "colors": ["color1", "color2", "color3"],
      "mood": "energetic / calm / professional / etc.",
      "insights": "How to apply this aesthetic in content generation"
    }}
  }},
  "model_image": {{
    "has_model": true/false,
    "index": <number or null>,
    "description": "Detailed description: ethnicity, age range, gender, style, clothing, appearance, body type"
  }},
  
  "visual_styles": {{
    "photography_styles": ["mobile_casual", "professional_dslr", "cinematic", "documentary", "studio", "lifestyle"],
    "lighting_styles": ["natural_daylight", "golden_hour", "studio_lighting", "soft_diffused", "dramatic_hard", "backlit", "warm_ambient"],
    "color_treatments": ["warm_tones", "cool_tones", "vibrant_saturated", "muted_desaturated", "high_contrast", "low_contrast", "vintage", "modern_clean", "moody_dark"],
    "composition_styles": ["close_up", "medium_shot", "wide_shot", "overhead_flatlay", "eye_level", "rule_of_thirds", "centered", "shallow_depth_of_field"],
    "background_styles": ["minimal_clean", "lifestyle_setting", "textured", "bokeh_blur", "outdoor_natural", "indoor_cozy", "studio_seamless"],
    "mood_atmospheres": ["bright_airy", "dark_moody", "warm_cozy", "clean_minimal", "vibrant_energetic", "luxurious_elegant", "raw_authentic"],
    "quality_feels": ["high_definition_crisp", "soft_dreamy", "intentional_grain", "instagram_aesthetic", "professional_advertising", "ugc_authentic"],
    "overall_summary": "Brief 1-2 sentence summary of the brand's dominant visual style across all images"
  }}
}}

🔍 IMPORTANT NOTES:
- If NO products detected, set product_images.count = 0, indices = []
- If NO inspiration detected, set inspiration_images.count = 0, indices = []
- If NO model detected, set model_image.has_model = false, index = null
- Be VERY specific in categorization - consider brand context
- Product images should match the brand's actual offerings
- Inspiration images are style guides ONLY

📸 **VISUAL STYLE ANALYSIS** (CRITICAL - Analyze ALL images):
Analyze the visual characteristics across ALL uploaded images to identify the brand's visual identity.
For each category, list ALL styles you observe (can have multiple):

- **photography_styles**: How were photos taken? (mobile_casual, professional_dslr, cinematic, documentary, studio, lifestyle, etc.)
- **lighting_styles**: What lighting is used? (natural_daylight, golden_hour, studio_lighting, soft_diffused, dramatic_hard, backlit, warm_ambient, etc.)
- **color_treatments**: How are colors treated? (warm_tones, cool_tones, vibrant_saturated, muted_desaturated, high_contrast, low_contrast, vintage, modern_clean, moody_dark, etc.)
- **composition_styles**: How are shots composed? (close_up, medium_shot, wide_shot, overhead_flatlay, eye_level, rule_of_thirds, centered, shallow_depth_of_field, etc.)
- **background_styles**: What backgrounds are used? (minimal_clean, lifestyle_setting, textured, bokeh_blur, outdoor_natural, indoor_cozy, studio_seamless, etc.)
- **mood_atmospheres**: What mood/atmosphere? (bright_airy, dark_moody, warm_cozy, clean_minimal, vibrant_energetic, luxurious_elegant, raw_authentic, etc.)
- **quality_feels**: What quality/feel? (high_definition_crisp, soft_dreamy, intentional_grain, instagram_aesthetic, professional_advertising, ugc_authentic, etc.)
- **overall_summary**: Write a 1-2 sentence summary of the brand's dominant visual style

⚠️ Include ONLY styles you actually observe in the images. If you see multiple styles, list all of them.

⚠️ JSON FORMATTING (CRITICAL):
- **NO TRAILING COMMAS**: Never put commas after the last item in an array or object
- Valid: `"indices": []` or `"indices": [1, 2]`
- Invalid: `"indices": [],` ← NO COMMA BEFORE CLOSING BRACE
- Your JSON must be parseable without errors

Analyze the {len(presigned_urls)} image(s) now.
"""

        print(f"🤖 Calling Grok with brand-aware analysis...")
        
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(
            f"You are an expert visual analyst for {brand_info['account_name']}. "
            f"Your critical task is to classify uploaded images into PRODUCT, INSPIRATION, or MODEL categories. "
            f"Analyze images in the context of their business and return ONLY valid JSON with strict structure. "
            f"Product images are actual items they sell. Inspiration images are style guides. Model images are people for UGC videos."
        ))
        
        # Create image objects
        image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
        
        chat.append(user(analysis_prompt, *image_objects))
        
        response = chat.sample()
        analysis_text = response.content.strip()
        
        print(f"📝 Grok raw response: {analysis_text[:300]}...")
        
        # Parse JSON response (handle markdown)
        import re
        
        try:
            # Remove markdown code blocks if present
            if "```json" in analysis_text:
                json_start = analysis_text.find("```json") + 7
                json_end = analysis_text.find("```", json_start)
                json_content = analysis_text[json_start:json_end].strip()
            elif "```" in analysis_text:
                # Handle generic code blocks
                json_start = analysis_text.find("```") + 3
                json_end = analysis_text.find("```", json_start)
                json_content = analysis_text[json_start:json_end].strip()
            elif analysis_text.startswith("{") and analysis_text.endswith("}"):
                json_content = analysis_text
            else:
                # Try to find JSON object
                start_idx = analysis_text.find("{")
                end_idx = analysis_text.rfind("}") + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_content = analysis_text[start_idx:end_idx]
                else:
                    raise ValueError("No valid JSON found in response")
            
            # Fix common JSON issues (trailing commas before } or ])
            import re
            json_content = re.sub(r',(\s*[}\]])', r'\1', json_content)
            
            # Parse JSON
            inventory_analysis = json.loads(json_content)
            
            print(f"✅ Inventory analysis completed")
            print(f"📊 Analysis keys: {list(inventory_analysis.keys())}")
            print(f"📊 Full analysis:")
            print("=" * 80)
            print(json.dumps(inventory_analysis, indent=2))
            print("=" * 80)
            
            # Log classification summary
            product_images = inventory_analysis.get('product_images', {})
            inspiration_images = inventory_analysis.get('inspiration_images', {})
            model_image = inventory_analysis.get('model_image', {})
            
            print(f"\n📦 PRODUCT IMAGES: {product_images.get('count', 0)} detected")
            if product_images.get('count', 0) > 0:
                print(f"   Indices: {product_images.get('indices', [])}")
                for idx in product_images.get('indices', []):
                    img_key = f"image_{idx}"
                    if img_key in product_images:
                        print(f"   • {img_key}: {product_images[img_key].get('category', 'N/A')} - {product_images[img_key].get('showcases', 'N/A')}")
            
            print(f"\n🎨 INSPIRATION IMAGES: {inspiration_images.get('count', 0)} detected")
            if inspiration_images.get('count', 0) > 0:
                print(f"   Indices: {inspiration_images.get('indices', [])}")
                for idx in inspiration_images.get('indices', []):
                    img_key = f"image_{idx}"
                    if img_key in inspiration_images:
                        print(f"   • {img_key}: {inspiration_images[img_key].get('style', 'N/A')} - {inspiration_images[img_key].get('mood', 'N/A')}")
            
            print(f"\n👤 MODEL IMAGE: {'YES' if model_image.get('has_model') else 'NO'}")
            if model_image.get('has_model'):
                print(f"   Index: {model_image.get('index')}")
                print(f"   Description: {model_image.get('description', 'N/A')}")
            
            print("=" * 80)
            
            return inventory_analysis
            
        except (json.JSONDecodeError, ValueError) as e:
            print(f"❌ Failed to parse JSON: {e}")
            print(f"❌ Raw response: {analysis_text}")
            # Return minimal fallback
            return {
                f"image_{i+1}": {
                    "type": "uploaded_image",
                    "note": "Analysis temporarily unavailable",
                    "raw_response": analysis_text[:200]
                }
                for i in range(len(presigned_urls))
            }
        
    except Exception as e:
        logger.error(f"❌ Image analysis failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return {}


# ============================================
# LINK ANALYSIS (GROK LIVE SEARCH)
# ============================================

async def analyze_inspiration_links(links: List[str]) -> Dict:
    """
    Analyze inspiration links with Grok live search (web_source).
    Uses the same approach as web3 project_unified_generation.py
    """
    if not links or all(not link.strip() for link in links):
        return {}
    
    try:
        print("=" * 80)
        print("🔗 GROK LINK ANALYSIS (Live Search with web_source)")
        print("=" * 80)
        
        # Filter out empty links
        valid_links = [link.strip() for link in links if link.strip()]
        print(f"🔗 Number of links: {len(valid_links)}")
        print(f"🔗 Links: {valid_links}")
        
        from xai_sdk import Client
        from xai_sdk.chat import user, system
        from xai_sdk.search import SearchParameters, web_source
        from urllib.parse import urlparse
        
        # Extract domains for Grok web_source filtering (limit to 10)
        allowed_websites = []
        for link in valid_links[:10]:
            try:
                parsed = urlparse(link)
                domain = parsed.netloc or parsed.path.split('/')[0]
                if domain and domain not in allowed_websites:
                    allowed_websites.append(domain)
            except Exception as e:
                logger.warning(f"⚠️ Could not parse URL {link}: {e}")
        
        if not allowed_websites:
            print("⚠️ No valid domains extracted from links")
            return {}
        
        print(f"🌐 Allowed websites for Grok web search: {allowed_websites}")
        
        # Get Grok API key
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            logger.warning("⚠️ No Grok API key for web live search")
            return {}
        
        # Initialize Grok client
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # Create chat with web_source search parameters (NO date range, NO max_results - same as web3)
        print("🤖 Calling Grok (grok-4-latest) with web_source live search...")
        chat = client.chat.create(
            model="grok-4-latest",
            search_parameters=SearchParameters(
                mode="auto",
                sources=[web_source(allowed_websites=allowed_websites)]
            ),
        )
        
        system_prompt = """You are a web content analyzer for brand marketing research. Extract and summarize key information from the specified websites.

Focus on:
- Key features, products, or services
- Important metrics, statistics, or data points
- Design styles, aesthetics, or visual elements
- Content strategies or messaging approaches
- Any unique or notable characteristics
- Brand positioning and messaging

Return a comprehensive summary of insights that can be used for content generation."""
        
        user_prompt = f"""Please gather comprehensive information from these websites:
{', '.join(valid_links)}

Extract and summarize:
1. Key features, products, or services
2. Important metrics, statistics, or data points
3. Design styles, aesthetics, or visual elements
4. Content strategies or messaging approaches
5. Any unique or notable characteristics

Return a concise summary of insights from all links combined."""
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        print("🔄 Calling Grok for web context (no date restrictions)...")
        response = chat.sample()
        
        link_analysis_text = response.content.strip()
        
        if not link_analysis_text:
            print("⚠️ Empty response from Grok live search")
            return {}
        
        print("✅ Grok live search completed successfully")
        
        print(f"✅ Link analysis completed")
        print(f"📊 Full analysis result:")
        print("=" * 80)
        print(link_analysis_text[:1000])  # Show first 1000 chars
        if len(link_analysis_text) > 1000:
            print(f"... (truncated, total length: {len(link_analysis_text)} chars)")
        print("=" * 80)
        
        # Handle potential markdown in response
        import re
        
        # Remove markdown formatting if present
        cleaned_text = link_analysis_text
        
        # Remove markdown code blocks
        cleaned_text = re.sub(r'```[\s\S]*?```', '', cleaned_text)
        
        # Remove markdown headers
        cleaned_text = re.sub(r'#{1,6}\s+', '', cleaned_text)
        
        # Remove bold/italic markers
        cleaned_text = re.sub(r'\*\*([^\*]+)\*\*', r'\1', cleaned_text)
        cleaned_text = re.sub(r'\*([^\*]+)\*', r'\1', cleaned_text)
        cleaned_text = re.sub(r'__([^_]+)__', r'\1', cleaned_text)
        cleaned_text = re.sub(r'_([^_]+)_', r'\1', cleaned_text)
        
        # Clean up extra whitespace
        cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text).strip()
        
        return {
            "summary": cleaned_text,
            "raw_summary": link_analysis_text  # Keep original for context
        }
        
    except Exception as e:
        logger.error(f"❌ Link analysis failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return {}


# ============================================
# PROMPT GENERATION
# ============================================

def _build_brand_context(dvyb_context: Dict, color_str: str) -> str:
    """
    Build brand context string dynamically, only including non-empty/non-null values.
    Never outputs N/A or empty placeholders.
    """
    lines = []
    
    # Only add each field if it has actual content
    account_name = dvyb_context.get('accountName')
    if account_name and str(account_name).strip():
        lines.append(f"- Business: {account_name}")
    
    industry = dvyb_context.get('industry')
    if industry and str(industry).strip():
        lines.append(f"- Industry: {industry}")
    
    brand_voice = dvyb_context.get('brandVoice')
    if brand_voice and str(brand_voice).strip():
        lines.append(f"- Brand Voice: {brand_voice}")
    
    if color_str and color_str.strip():
        lines.append(f"- Brand Colors: {color_str}")
    
    customer_demographics = dvyb_context.get('customerDemographics')
    if customer_demographics and str(customer_demographics).strip():
        lines.append(f"- Target Audience: {str(customer_demographics)[:500]}")
    
    business_overview = dvyb_context.get('businessOverview')
    if business_overview and str(business_overview).strip():
        lines.append(f"- Business Overview: {str(business_overview)[:500]}")
    
    popular_products = dvyb_context.get('popularProducts')
    if popular_products:
        products_str = str(popular_products)[:300] if isinstance(popular_products, str) else str(popular_products)[:300]
        if products_str.strip():
            lines.append(f"- Popular Products/Services: {products_str}")
    
    if not lines:
        return "No brand context available"
    
    return "\n".join(lines)


def _format_enhanced_context(context: Dict) -> str:
    """
    Format enhanced brand context (brandVoices, brandStyles, keywords, documentsText) for Grok.
    Provides instructions for random selection and temporal context.
    Only includes non-empty/non-null values - never outputs N/A.
    """
    from datetime import datetime
    sections = []
    
    # Brand Voices
    brand_voices = context.get('brand_voices')
    if brand_voices and str(brand_voices).strip():
        sections.append(f"**Brand Voices**: {brand_voices}")
        sections.append("  → If comma-separated, pick ONE at random for THIS generation to add variety")
    
    # Brand Voice (single)
    brand_voice = context.get('brand_voice')
    if brand_voice and str(brand_voice).strip():
        sections.append(f"**Brand Voice (Primary)**: {brand_voice}")
    
    # Brand Styles
    brand_styles = context.get('brand_styles')
    if brand_styles and str(brand_styles).strip():
        sections.append(f"**Brand Styles**: {brand_styles}")
        sections.append("  → If comma-separated, pick ONE at random for THIS generation to add variety")
    
    # Keywords (important brand/product keywords)
    keywords = context.get('keywords')
    if keywords and str(keywords).strip():
        sections.append(f"**Brand Keywords**: {keywords}")
        sections.append("  → Incorporate relevant keywords naturally in prompts and platform texts")
    
    # Documents Text with temporal context
    documents_text = context.get('documents_text', [])
    if documents_text and len(documents_text) > 0:
        sections.append(f"\n**BRAND DOCUMENTS** ({len(documents_text)} document(s) within 30 days):")
        sections.append("  ℹ️ These documents contain important brand information. Consider temporal context:")
        
        current_date = context.get('current_date')
        if current_date:
            sections.append(f"  📅 Today's Date: {str(current_date)[:10]}")
        
        for i, doc in enumerate(documents_text[:5], 1):  # Limit to 5 docs to save tokens
            name = doc.get('name', f'Document {i}')
            text_content = doc.get('text', '')
            text_preview = str(text_content)[:300] if text_content and str(text_content).strip() else None
            age_days = doc.get('age_days')
            
            if age_days is not None:
                sections.append(f"\n  📄 {name} ({age_days} days old):")
            else:
                sections.append(f"\n  📄 {name}:")
            
            if text_preview:
                sections.append(f"     {text_preview}...")
            
            if age_days is not None and age_days > 7:
                sections.append(f"     ⚠️ Note: This document is {age_days} days old. Events mentioned may be in the past.")
    
    if not sections:
        return ""  # Return empty string instead of placeholder
    
    return "\n".join(sections)


async def generate_prompts_with_grok(request: DvybAdhocGenerationRequest, context: Dict) -> Dict:
    """Generate image and clip prompts with Grok - Multi-clip Veo3.1 support"""
    
    # Calculate number of images and clips
    number_of_posts = request.number_of_posts
    
    # If frontend provides specific mix (based on plan limits), use it
    if request.number_of_images is not None and request.number_of_videos is not None:
        num_images = request.number_of_images
        num_clips = request.number_of_videos
        print(f"✅ Using frontend-calculated mix: {num_images} images, {num_clips} videos (based on plan limits)")
    else:
        # Default logic: 2 videos, 2 images (maximize videos for odd numbers)
        num_clips = math.ceil(number_of_posts / 2)
        num_images = number_of_posts - num_clips
        print(f"⚠️ Frontend didn't provide mix, using default (maximize videos): {num_clips} videos, {num_images} images")
    
    # Video configuration (Model-agnostic - Kling v2.6 or Veo3.1 selected randomly per video)
    # Kling v2.6: supports 5s and 10s (using 10s default)
    # Veo3.1: supports 4s, 6s, 8s (using 8s default)
    # Ratio: 60% Kling, 40% Veo
    CLIPS_PER_VIDEO = request.clips_per_video if hasattr(request, 'clips_per_video') and request.clips_per_video else 1
    # CLIP_DURATION will be set per video based on model selection (8s for Veo, 10s for Kling)
    # For Grok prompt generation, we use a conservative estimate
    CLIP_DURATION_ESTIMATE = 8  # Conservative estimate for prompt generation
    VIDEO_DURATION_ESTIMATE = CLIPS_PER_VIDEO * CLIP_DURATION_ESTIMATE
    
    print(f"⚙️ Video Configuration: {CLIPS_PER_VIDEO} clip(s) per video, ~{CLIP_DURATION_ESTIMATE}-10s per clip")
    print(f"⚙️ Model Selection: 30% Kling v2.6 (10s clips), 70% Veo3.1 (8s clips)")
    
    print("=" * 80)
    print("🤖 GROK PROMPT GENERATION (KLING v2.6 / VEO3.1 MULTI-MODEL MODE)")
    print("=" * 80)
    print(f"📝 Topic: {request.topic}")
    print(f"📝 Platforms: {request.platforms}")
    print(f"📝 Number of posts: {number_of_posts}")
    print(f"📝 Number of video posts: {num_clips}")
    print(f"📝 Number of image posts: {num_images}")
    print(f"🎬 Clips per video: {CLIPS_PER_VIDEO}")
    print(f"⏱️  Clip duration: {CLIP_DURATION_ESTIMATE}s (Veo) / 10s (Kling)")
    print(f"🎥 Total video duration: {VIDEO_DURATION_ESTIMATE}s+ depending on model")
    print(f"📝 User prompt: {request.user_prompt}")
    print(f"📝 User images: {len(request.user_images) if request.user_images else 0}")
    print(f"📝 Inspiration links: {len(request.inspiration_links) if request.inspiration_links else 0}")
    print(f"📝 Context keys: {list(context.keys())}")
    
    # Randomly determine which posts will be videos
    all_indices = list(range(number_of_posts))
    random.shuffle(all_indices)
    video_indices = set(all_indices[:num_clips])
    
    print(f"🎲 Video indices: {sorted(video_indices)}")
    print(f"🖼️ Image-only indices: {sorted([i for i in all_indices if i not in video_indices])}")
    
    # Build comprehensive prompt for Grok
    dvyb_context = context.get("dvyb_context", {})
    inventory_analysis = context.get("inventory_analysis", {})
    link_analysis = context.get("link_analysis", {})
    
    # Format inventory analysis for Grok (pass as-is with dynamic structure)
    inventory_analysis_str = ""
    if inventory_analysis:
        import json
        inventory_analysis_str = json.dumps(inventory_analysis, indent=2)
    
    # Format link analysis for Grok
    link_analysis_str = ""
    if link_analysis:
        summary = link_analysis.get("summary")
        if summary and str(summary).strip():
            link_analysis_str = summary
    
    # Randomly decide voiceover for product/brand marketing videos (30% chance voiceover, 70% no voiceover)
    # UGC videos always have voiceover=false (character speaks instead)
    voiceover_random = random.random()
    voiceover_for_non_ugc = voiceover_random <= 0.1
    print(f"🎲 Voiceover decision: random={voiceover_random:.2f}, voiceover_for_non_ugc={voiceover_for_non_ugc} (<=0.1 means voiceover)")
    
    # Build Grok prompt with clip prompts (matching web3 flow)
    # Color palette for prompts
    color_palette = dvyb_context.get('socialPostColors') or dvyb_context.get('colorPalette') or {}
    
    # Ensure color_palette is always a dict, never None
    if not isinstance(color_palette, dict):
        print(f"⚠️ Invalid color palette type: {type(color_palette)}, using empty dict")
        color_palette = {}
    
    print(f"🎨 Color Palette: {color_palette}")
    
    color_str = ""
    if color_palette:
        colors = []
        if color_palette.get('primary'):
            colors.append(f"Primary: {color_palette['primary']}")
        if color_palette.get('secondary'):
            colors.append(f"Secondary: {color_palette['secondary']}")
        if color_palette.get('accent'):
            colors.append(f"Accent: {color_palette['accent']}")
        color_str = ", ".join(colors) if colors else ""
    
    # Build multi-clip video prompts structure (Veo3.1 specific - Instagram Reels 9:16)
    video_prompts_instruction = ""
    video_examples = []
    
    if num_clips > 0:
        # For each video index, generate CLIPS_PER_VIDEO sets of prompts
        for video_idx in sorted(video_indices):
            for clip_num in range(1, CLIPS_PER_VIDEO + 1):
                video_examples.append(f'''  "video_{video_idx}_clip_{clip_num}_image_prompt": "Detailed visual description for starting frame of clip {clip_num} in video {video_idx} (9:16 vertical aspect ratio, Instagram Reels style)...",
  "video_{video_idx}_clip_{clip_num}_product_mapping": "image_1" or "image_2" or null (map to product image if needed for this specific frame),
  "video_{video_idx}_clip_{clip_num}_prompt": "Cinematic 8-10 second video description with smooth motion, no text overlays. [THEN add voiceover OR character speech at the END]",
  "video_{video_idx}_clip_{clip_num}_logo_needed": true or false''')
            
            # Single audio prompt per video (added after stitching)
            video_examples.append(f'''  "video_{video_idx}_audio_prompt": "Create instrumental background music for {VIDEO_DURATION_ESTIMATE}-second video. Focus ONLY on music composition, NO sound effects."''')
        
        video_prompts_section = ",\n  ".join(video_examples)
        
        video_prompts_instruction = f"""

3. VIDEO TYPE SELECTION & GENERATION ({num_clips} videos, each ~{VIDEO_DURATION_ESTIMATE}-{CLIPS_PER_VIDEO * 10}s):
   
   🎯 CRITICAL: INTELLIGENT VIDEO TYPE & FLAGS DECISION
   
   **DECISION HIERARCHY**:
   1. **Intelligently infer from USER INSTRUCTIONS** what type of video they want:
      → If user intent is about showcasing/launching/featuring a PRODUCT → use "product_marketing"
      → If user intent is about brand storytelling/awareness/values → use "brand_marketing"
      → If user intent is about authentic creator content/testimonials/personal experience → use "ugc_influencer"
   2. **If user instructions don't clearly indicate a preference**, autonomously decide based on:
      → Inventory analysis (what products/items are shown)
      → Brand context (industry, voice, audience)
      → Content purpose (educational, promotional, storytelling)
   
   🚨🚨🚨 **CRITICAL - USER INTENT OVERRIDES EVERYTHING** 🚨🚨🚨
   
   If user explicitly mentions "product marketing" or indicates product-focused content:
   → video_type MUST be "product_marketing" - NEVER "ugc_influencer"
   
   If user explicitly mentions "brand marketing" or indicates brand-focused content:
   → video_type MUST be "brand_marketing" - NEVER "ugc_influencer"
   
   ⚠️ **IMPORTANT**: Product marketing videos CAN include human models wearing/using the product!
   - "Model wearing product" + "product marketing" → STILL "product_marketing" (NOT ugc_influencer)
   - The difference is STYLE: product_marketing is professional/cinematic, ugc_influencer is authentic/casual
   - Having a model in the video does NOT automatically make it UGC
   
   Only use "ugc_influencer" when user explicitly wants:
   - Authentic creator/influencer style content
   - First-person testimonials or reviews
   - Casual, relatable, personal vlog-style content
   
   Based on this analysis, YOU MUST DECIDE the optimal video type. However, the VOICEOVER FLAG IS PRE-DETERMINED - you MUST use exactly the value specified below:
   
   🚨🚨🚨 **MANDATORY VOICEOVER FLAG FOR THIS GENERATION** 🚨🚨🚨
   For product_marketing and brand_marketing videos: **voiceover MUST BE {"true" if voiceover_for_non_ugc else "false"}**
   {"You MUST include voiceover narration in clip prompts." if voiceover_for_non_ugc else "You MUST NOT include ANY voiceover or speech in clip prompts. PURE VISUAL ONLY."}
   This is PRE-DETERMINED. Do NOT change this value. Do NOT override this decision.
   
   A. **PRODUCT MARKETING VIDEO** (Professional product showcase):
      - Use when: User wants product-focused content, product launch, product showcase, OR user explicitly mentions "product marketing"
      - ⚠️ CAN include human models wearing/using the product - this is STILL product marketing, NOT UGC
      - FLAGS TO OUTPUT:
        * "video_type": "product_marketing"
        * "voiceover": {"true" if voiceover_for_non_ugc else "false"} ← MANDATORY - DO NOT CHANGE THIS VALUE
        * "no_characters": true OR false (can have models in product marketing - set false if user wants model)
        * "human_characters_only": true if including models, false if pure product
        * "influencer_marketing": false (ALWAYS false for product marketing)
      - Style: Professional product showcase, feature highlights
      {"- Voiceover Style: Professional, authoritative narrator voice (e.g., 'In a professional male narrator voice:', 'In a confident female voice:')" if voiceover_for_non_ugc else "- 🚨 PURE VISUAL MODE (voiceover=false): NO voiceover, NO character speech, NO humans. This is a cinematic product video with ONLY visuals and background music."}
      {"- Example clip prompt WITH voiceover: 'Sleek smartphone rotating on marble surface, camera slowly zooming to reveal elegant design features, professional studio lighting, no text overlays. Voiceover in professional male narrator voice: Introducing the future of mobile technology.'" if voiceover_for_non_ugc else "- Example clip prompt WITHOUT voiceover: 'Sleek smartphone rotating on marble surface, camera slowly zooming to reveal elegant design features, dramatic rim lighting creating golden edge glow, slow motion dust particles in light beam, cinematic atmosphere, no text overlays.'"}
      {"- CRITICAL: Include voiceover text at END of clip prompt. Specify voice type/tone (professional/enthusiastic/warm/authoritative, male/female)" if voiceover_for_non_ugc else "- 🚨 CRITICAL: NO 'Voiceover:', NO 'Saying:', NO speech text. Focus ONLY on CINEMATIC VISUALS - dramatic lighting, slow motion, artistic compositions."}
      {"- 🚨 VOICEOVER TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-) in voiceover text." if voiceover_for_non_ugc else ""}
   
   B. **UGC INFLUENCER VIDEO** (Authentic influencer style):
      - Use when: Lifestyle/personal use context, human engagement needed, relatable content, OR user explicitly requests UGC/influencer style video
      - FLAGS TO OUTPUT:
        * "video_type": "ugc_influencer"
        * "voiceover": false (character speaks on camera, embedded in Veo3.1 clip)
        * "no_characters": false
        * "human_characters_only": true
        * "influencer_marketing": true
      - Speech limit: 12-14 words MAX per 8-10s clip
      - Style: Authentic, conversational, relatable UGC content
      
      🎬 **COMPELLING HOOKS & STORYLINES** (CRITICAL FOR 8-SECOND IMPACT):
      
      Every UGC clip MUST have a mini-narrative with PURPOSE. The influencer is promoting a brand - make every second count:
      
      **8-SECOND STORY STRUCTURE**:
      - **Hook (0-2s)**: Grab attention with emotion, question, or surprising statement
      - **Core Message (2-6s)**: Deliver value/benefit authentically  
      - **Impact (6-8s)**: Resolution, reaction, or emotional payoff
      
      **PROVEN HOOK FORMULAS** (Choose based on brand/product context):
      - "Wait, you guys still don't know about..." → discovery/revelation
      - "I was SO skeptical until..." → transformation story
      - "Okay I HAVE to tell you about..." → urgent recommendation
      - "Nobody told me that..." → insider secret
      - "POV: You finally found..." → relatable moment
      - "This literally changed how I..." → personal testimony
      - "Stop scrolling, you need to see..." → direct engagement
      
      **SPEECH MUST INCLUDE**: A clear value proposition or emotional payoff for viewers. NOT just "I love this product" but WHY it matters.
      
      🎥 **DYNAMIC VISUAL TRANSITIONS** (AUTONOMOUS DECISION):
      
      You can CHOOSE to include camera movements that shift focus between influencer and product. The audio (character speaking) CONTINUES throughout - only the VISUAL focus changes.
      
      **OPTION 1 - INFLUENCER ALWAYS IN FRAME** (Simple testimonial):
      Use when: Personal emotional story, direct connection, reaction-focused content
      → "Influencer looking at camera with genuine excitement, natural hand gestures, saying in enthusiastic tone: This app just created a week of content for me in five minutes"
      
      **OPTION 2 - DYNAMIC TRANSITION** (Camera reveals product):
      Use when: Feature demonstration needed, showing the product adds value, "let me show you" moments
      → "Influencer speaking to camera, camera smoothly pans to laptop screen showing the app interface with generated content, then pulls back to reveal influencer's amazed reaction, continuous speech: Watch this, I just typed one sentence and it created all of this, I'm literally speechless"
      
      **OPTION 3 - PRODUCT FOCUS WITH VOICE** (Feature showcase):
      Use when: Product details are the star, influencer introduces then product takes over
      → "Influencer holds up product speaking excitedly, camera zooms in to product details and features while voice continues, then zooms out to show influencer's satisfied expression, saying: Look at this finish, feel this quality, this is what premium actually means"
      
      **TRANSITION TECHNIQUES** (Describe in your prompts):
      - "camera smoothly pans to..." - horizontal movement
      - "camera zooms in to reveal..." - focus on detail
      - "camera pulls back to show..." - reveal wider context
      - "focus shifts from influencer to product..." - depth of field change
      - "influencer moves aside revealing..." - character-driven reveal
      
      **DECIDE AUTONOMOUSLY**: Based on your storyline, choose whether transitions add value or if keeping the influencer in frame creates stronger connection.
      
      **CHARACTER/MODEL SPECIFICATION RULES**:
      - If has_model_image=true (user provided model image):
        * ALL image prompts: Use "Reference model" (DO NOT describe new character)
        * ALL clip prompts: "Reference model [action], saying in [conversational/excited/casual/enthusiastic] tone (14 words max): [speech]"
      - If has_model_image=false (no model provided - AUTONOMOUS CHARACTER GENERATION):
        * **🎨 CHARACTER DIVERSITY & AUTONOMY**: You have FULL creative freedom to create diverse, realistic influencer characters
        * Represent different ethnicities, genders, ages, styles, and body types based on what feels authentic for the brand/product
        * Consider the target audience from brand context when designing characters
        * NO DEFAULTS: Each character should be thoughtfully created, not based on stereotypes or defaults
        * Clip 1 image prompt: FULL character description (MUST include: ethnicity, age range, gender, style, clothing, appearance, body type)
          → Examples of diverse characters:
          → "South Asian woman, 25-30 years old, long dark hair, casual modern style, confident demeanor, slim build"
          → "African American man, 30-35 years old, short fade haircut, streetwear fashion, energetic personality, athletic build"
          → "Hispanic woman, 20-25 years old, curly brown hair, athleisure wear, friendly approachable vibe, medium build"
          → "East Asian man, late 20s, minimalist fashion, professional setting, calm thoughtful expression, average build"
          → "Middle Eastern woman, early 30s, hijab, elegant modern style, warm smile, professional appearance"
        * Clip 1 clip prompt: Include same character details with action and speech
        * Clip 2+ image prompts: "Reference character from previous frame, [new context/action]" or "Same influencer as previous frame, [new setting]"
        * Clip 2+ clip prompts: "Reference character from previous frame, [action], saying in [same tone] (14 words max): [speech]"
      
      - ALWAYS specify speaking tone/style: conversational, excited, casual, enthusiastic, genuine, relatable, friendly
      - **🚨 CHARACTER SPEECH TEXT FORMATTING**: NEVER use em-dashes (—) or hyphens (-) in character speech text. Use commas, periods, or natural pauses instead. Em-dashes interfere with TTS generation and create awkward pauses.
      
      **COMPLETE UGC CLIP PROMPT EXAMPLES**:
      
      - Example (simple, with model): "Reference model looking at camera with genuine surprise turning to excitement, bright modern kitchen, natural morning light, no text overlays. Saying in enthusiastic discovery tone (14 words max): Wait, you guys still don't know about this? It literally changed my entire morning routine."
      
      - Example (with transition, no model): "Hispanic woman, late 20s, curly hair, casual style, speaking to camera with curious expression, camera smoothly pans to phone screen showing app results, then pulls back to her amazed reaction, living room setting, no text overlays. Saying in excited genuine tone (14 words max): I typed one idea and look what it created, this is actually insane you guys."
      
      - Example (product focus): "Reference model holding product up to camera, speaking with enthusiasm, camera zooms slowly into product details while voice continues, then zooms out to satisfied smile, studio lighting, no text overlays. Saying in testimonial tone (14 words max): Feel this quality, see this design, this is why I switched and never looked back."
   
   C. **BRAND MARKETING VIDEO** (Brand storytelling):
      - Use when: Abstract brand values, emotional storytelling, no specific product, OR user explicitly requests brand storytelling/brand-focused video
      - FLAGS TO OUTPUT:
        * "video_type": "brand_marketing"
        * "voiceover": {"true" if voiceover_for_non_ugc else "false"} ← MANDATORY - DO NOT CHANGE THIS VALUE
        * "no_characters": true (NO human characters - NEVER include people)
        * "human_characters_only": false
        * "influencer_marketing": false
      - Style: Artistic, emotional, brand-focused
      {"- Voiceover Style: Inspirational, cinematic narrator voice (specify: warm/inspiring/dramatic, male/female)" if voiceover_for_non_ugc else "- 🚨 PURE VISUAL MODE (voiceover=false): NO voiceover, NO character speech, NO humans. This is a cinematic brand video with ONLY artistic visuals and background music."}
      {"- Example clip prompt WITH voiceover: 'Abstract artistic representation of innovation, flowing light patterns, dynamic camera movement revealing brand essence, cinematic atmosphere, no text overlays. Voiceover in warm inspiring male voice: Your journey to excellence starts here.'" if voiceover_for_non_ugc else "- Example clip prompt WITHOUT voiceover: 'Abstract artistic representation of innovation, flowing light patterns transitioning through brand colors, dynamic camera movement revealing brand essence, dramatic rim lighting, slow motion particles floating in light beam, cinematic atmosphere, no text overlays.'"}
      {"- CRITICAL: Include voiceover text at END of clip prompt. Specify voice type/tone for emotional impact (inspiring/dramatic/warm/confident, male/female)" if voiceover_for_non_ugc else "- 🚨 CRITICAL: NO 'Voiceover:', NO 'Saying:', NO speech text. Focus ONLY on CINEMATIC ARTISTRY - dramatic lighting, slow motion, artistic compositions, abstract visuals."}
      {"- 🚨 VOICEOVER TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-) in voiceover text." if voiceover_for_non_ugc else ""}
   
   YOU MUST OUTPUT (at the top level):
   "video_type": "product_marketing" OR "ugc_influencer" OR "brand_marketing",
   "voiceover": {"true" if voiceover_for_non_ugc else "false"} ← 🚨 FOR PRODUCT/BRAND MARKETING: USE EXACTLY THIS VALUE. For UGC: always false.
   "no_characters": true OR false,
   "human_characters_only": true OR false,
   "influencer_marketing": true OR false,
   "web3": false (always false for DVYB)
   
   ⚠️ VOICEOVER FLAG REMINDER: For product_marketing and brand_marketing, voiceover MUST be {"true" if voiceover_for_non_ugc else "false"}. This is PRE-DETERMINED.
   
   📋 MULTI-CLIP VIDEO STRUCTURE (Kling v2.6 / Veo3.1 with 9:16 aspect ratio):
   Video indices: {sorted(video_indices)}
   Each video requires:
   - {CLIPS_PER_VIDEO} image prompts (starting frames for each 8-10s clip)
   - {CLIPS_PER_VIDEO} clip prompts (motion/animation descriptions)
   - {CLIPS_PER_VIDEO} logo decisions (true/false for each frame)
   - 1 audio prompt (background music for entire {VIDEO_DURATION_ESTIMATE}-{CLIPS_PER_VIDEO * 10}s video)
   
   Format: "video_{{index}}_clip_{{num}}_image_prompt", "video_{{index}}_clip_{{num}}_prompt", etc.
   
   🎬 VIDEO MODEL REQUIREMENTS (Kling v2.6 OR Veo3.1 selected per video):
   - Aspect ratio: 9:16 (Instagram Reels/TikTok vertical - MANDATORY)
   - Clip duration: 8-10s (8s for Veo3.1, 10s for Kling v2.6)
   - Embedded audio: YES (voiceover OR character speech based on video_type)
   - 🚨 CRITICAL CLIP PROMPT STRUCTURE: "no text overlays" must come BEFORE voiceover/speech text (NOT after)
     * This prevents the model from speaking "no text overlays" as part of the audio
     * Structure: [Scene description], no text overlays. [Voiceover/Speech at the END]
   - Background music added separately AFTER stitching (via Pixverse Sound Effects)
   
   👤 INFLUENCER CONSISTENCY (CRITICAL for ugc_influencer type):
   
   🚨 USE "REFERENCE MODEL" KEYWORD (MANDATORY):
   - If inventory analysis shows has_model_image=true:
     * You MUST use the exact term **"reference model"** in ALL image prompts for UGC videos
     * Example: "Reference model sitting at table, looking at camera with genuine excitement"
     * Example: "Reference model holding product and speaking naturally to camera"
     * DO NOT describe new character details - just use "reference model" to refer to the person from the uploaded image
     * This ensures the same person appears consistently across all frames
   
  - If no model image provided (has_model_image=false - AUTONOMOUS DIVERSE CHARACTER GENERATION):
    * **🎨 IMPORTANT**: Create diverse, authentic influencer characters representing different ethnicities, genders, ages, and styles
    * Consider the brand's target audience and product category when designing the character
    * Clip 1 image prompt: FULL character description (MUST specify: ethnicity, age range, gender, style, appearance, clothing, body type)
      → Example 1: "South Asian woman, mid-20s, long dark hair, casual modern style, denim jacket over white tee, confident smile, modern apartment background"
      → Example 2: "African American man, early 30s, athletic build, streetwear outfit, friendly approachable demeanor, urban loft setting"
      → Example 3: "East Asian woman, late 20s, minimalist fashion, professional blazer, calm thoughtful expression, clean modern office"
    * Clip 2+ image prompts: **"Reference character from previous frame"** + new context/action or setting
      → Example: "Reference character from previous frame, now in elegant living room, demonstrating product use"
    * IMPORTANT: Using "reference character" ensures the same person appears consistently across clips
   
   - Same person MUST appear across all clips in the video for consistency
   - The "reference model" or "reference character" terminology ensures character extraction and consistency
   - Backend will automatically handle passing the first generated image to subsequent clip generations
   
  📸 **CLIP IMAGE PROMPTS** (Starting Frames - Same Quality Standards):
  - Apply ALL image quality guidelines from section 4 to clip image prompts
  - Apply CINEMATIC elements: dramatic lighting, implied motion, cinematic composition
  - Include detailed descriptions with color palette integration
  - Keep compositions simple and focused (avoid clutter)
  - **CRITICAL COLOR USAGE**: Use brand colors ONLY in physical objects/surfaces (clothing, walls, furniture, props, decor) - NEVER in lighting, glows, or effects
  - Example: "wearing {color_palette.get('primary')} colored shirt" ✅ NOT "using {color_palette.get('primary')} for lighting accents" ❌
  - **MANDATORY ENDING**: End with: ", colors used only in physical objects and surfaces not in lighting or glow effects, use provided hex colour codes for generating images but no hex colour code as text in image anywhere"
  - Remember: These frames will become video starting points, so they must be high-quality and on-brand
  
  🎬 **CLIP MOTION PROMPTS** (Video Animation - CINEMATIC QUALITY):
  - Apply CINEMATIC TECHNIQUES from section 4 to ALL clip prompts
  - Think like a DIRECTOR: describe HOW the camera moves, not just what's in frame
  - **Camera Movement**: "slow zoom in", "camera orbits", "tracking shot", "dolly push", "crane descent"
  - **Speed Effects**: "slow motion", "timelapse", "speed ramp from slow to normal"
  - **Focus Techniques**: "rack focus from foreground to product", "pull focus following action"
  - **Reveal Techniques**: "reveal shot as hand moves away", "push through foreground element"
  
  **CLIP PROMPT CINEMATIC EXAMPLES**:
  - ❌ Basic: "Product on table, camera shows it"
  - ✅ Cinematic: "Slow cinematic zoom in on product revealing texture details, soft rack focus from blurred foreground fruit to sharp product surface, dramatic rim lighting"
  
  - ❌ Basic: "Person picks up product"
  - ✅ Cinematic: "Tracking shot following hand reaching toward product in slow motion, camera pushes in as fingers make contact, shallow depth of field with background melting into bokeh"
  
  - ❌ Basic: "Show product features"
  - ✅ Cinematic: "Camera slowly orbits product 90 degrees revealing different angles, dramatic side lighting casting long shadows, dust particles visible in light beam, speed ramp to normal as orbit completes"
  
  **AUTONOMOUS CINEMATIC DECISIONS**: You decide when cinematic elements enhance the clip. Product reveals, emotional moments, and brand storytelling often benefit from cinematic techniques. UGC may use subtle handheld movement for authenticity. YOU choose what serves the content best.
  
  🎬 **CINEMATIC CLIP PROMPT INSPIRATION** (FOR PRODUCT & BRAND MARKETING VIDEOS):
  
  These examples are STARTING POINTS to spark your creativity - NOT limitations. Go beyond them, invent new techniques, surprise us:
  
  **ULTRA SLOW MOTION SHOTS**:
  - "Ultra slow motion water droplets cascading off the product surface, each droplet catching light like tiny crystals, 120fps cinematic quality"
  - "Extreme slow motion product rotation revealing every surface detail, dust particles floating gracefully in dramatic backlight"
  - "Slow motion fabric unfurling in wind, revealing product underneath, silk-like movement at 60fps"
  - "Ultra slow motion pour of liquid, viscous flow catching rim lighting, every ripple visible"
  - "Slow motion ice cream melt, single droplet stretching before falling, macro lens detail"
  
  **DRAMATIC CAMERA MOVEMENTS**:
  - "Sweeping crane shot descending from above, gradually revealing product in dramatic spotlight"
  - "Dolly zoom creating vertigo effect while product stays centered, background warping cinematically"
  - "360-degree orbit around product, seamless rotation revealing all angles, consistent dramatic lighting"
  - "Push-in through smoke/mist revealing product emerging like a hero shot"
  - "Pull-back reveal starting from extreme macro texture to full product in context"
  
  **CINEMATIC LIGHTING EFFECTS**:
  - "Product bathed in moving light beams, shadows dancing across surface, film noir atmosphere"
  - "Golden hour rays streaming through, lens flare kissing product edge, warm cinematic grade"
  - "Dramatic chiaroscuro lighting, half product in shadow half in brilliant highlight"
  - "Pulsing neon reflections on product surface, cyberpunk aesthetic, moody atmosphere"
  - "Soft diffused light slowly intensifying to dramatic spotlight reveal"
  
  **ABSTRACT/ARTISTIC SEQUENCES** (especially for brand marketing):
  - "Liquid chrome morphing into product shape, reflective surface catching environment"
  - "Particle explosion transitioning into product formation, cosmic energy aesthetic"
  - "Color wash transitions flowing through frame, brand colors dancing in abstract patterns"
  - "Geometric shapes assembling into product silhouette, minimal elegant animation"
  - "Light painting trails circling product, long exposure effect, ethereal glow"
  
  **TEXTURE & DETAIL REVEALS**:
  - "Extreme macro traveling across product surface, revealing craftsmanship at microscopic level"
  - "Focus pull from blurred foreground element to sharp product detail, rack focus beauty shot"
  - "Cross-section reveal, camera pushing through product layers, internal structure visible"
  - "Steam/vapor rising around product, creating mystery and allure, diffused lighting"
  
  **ENVIRONMENTAL TRANSITIONS**:
  - "Time-lapse background transitioning day to night while product remains lit, dramatic time passage"
  - "Weather elements (rain, snow, leaves) falling around stationary product, seasonal atmosphere"
  - "Background morphing between locations while product stays anchored, versatility showcase"
  
  **UNLIMITED CREATIVITY**: These examples are just INSPIRATION - not limitations. You have COMPLETE creative freedom to invent entirely new cinematic techniques, combine approaches in unexpected ways, or create something we haven't even imagined. The best clip prompts often go far beyond these examples. Trust your creative instincts. Pure visual storytelling with no boundaries.
  
  🛍️ **PRODUCT MAPPING FOR CLIP FRAMES** (SAME AS IMAGE POSTS):
  - For EACH clip image prompt, decide if a product should be referenced
  - Output `"video_X_clip_Y_product_mapping": "image_Z"` or `null`
  - When product is mapped: Use **"reference product"** keyword in the clip image prompt
  - **MANDATORY**: Also include **"do not morph the product distinguishing features"** at the end
  
  **EXAMPLES**:
  ```
  Available products: image_1 (headphones front), image_2 (headphones side)
  
  Video 0, Clip 1 (opening shot with product):
  {{
    "video_0_clip_1_product_mapping": "image_1",
    "video_0_clip_1_image_prompt": "Reference product (wireless headphones) on modern desk, front angle view showing LED lighting...",
    "video_0_clip_1_logo_needed": true
  }}
  
  Video 0, Clip 2 (detail shot):
  {{
    "video_0_clip_2_product_mapping": "image_2",
    "video_0_clip_2_image_prompt": "Reference product from side angle, close-up on touch controls, premium materials visible...",
    "video_0_clip_2_logo_needed": false
  }}
  ```
  
  **IMPORTANT**: The CLIP PROMPT (motion/animation description) does NOT need product_mapping - only the IMAGE PROMPT does!
   
  🎤 VOICEOVER vs CHARACTER SPEECH:
  
  🚨 **CRITICAL TEXT FORMATTING RULE FOR ALL CLIP PROMPTS**:
  - **NEVER use em-dashes (—) or hyphens (-) in voiceover text or character speech**
  - Em-dashes and hyphens interfere with TTS (text-to-speech) generation and create awkward pauses
  - Use commas, periods, or natural pauses instead
  - ✅ GOOD: "This product changed everything, I absolutely love it"
  - ❌ BAD: "This product changed everything — I absolutely love it"
  - ❌ BAD: "This product changed everything - I absolutely love it"
  
  - If video_type = "ugc_influencer":
    * Clip prompts MUST include: "Character saying (14 words max): [natural speech]"
    * Speech embedded in Veo3.1 clip (character's lips move)
    * Example: "saying (14 words max): This lipstick changed everything about my makeup routine and I absolutely love it"
    * 🏢 **USE BRAND NAME IN SPEECH**: In the character's speech, use "{dvyb_context.get('accountName', 'the brand')}" when mentioning the brand
    * Example: "saying in excited tone: I've been using {dvyb_context.get('accountName', 'the brand')} and it's a game changer"
  - If video_type = "product_marketing" or "brand_marketing":
    * NO character speech in clip prompts
    * Voiceover added separately (narration, NOT embedded)
    * Clip prompts focus on pure visual storytelling
    * 🏢 **USE BRAND NAME IN VOICEOVER**: In the voiceover text, use "{dvyb_context.get('accountName', 'the brand')}" when mentioning the brand
    * Example: "Voiceover in professional voice: {dvyb_context.get('accountName', 'the brand')} transforms your social presence"
   
   🏆 LOGO INTEGRATION (Intelligent decisions):
   
   🚨 USE "REFERENCE LOGO" KEYWORD (MANDATORY when logo_needed=true):
   - For each image/clip: Decide `logo_needed` = true or false
   - When logo_needed=true, you MUST use **"reference logo"** in your image prompt
   - Examples:
     * "Modern office setting with laptop displaying analytics dashboard, reference logo prominently visible on screen"
     * "Product showcase on marble surface, reference logo subtly integrated in corner"
   - This ensures consistent logo placement across multiple images
   
   **LOGO DECISION GUIDELINES** (think like a creative director):
   - Product marketing: Logo often in final frames → `logo_needed: true`
   - UGC influencer: Logo minimal/none (authentic feel) → `logo_needed: false`
   - Brand marketing: Logo in key brand moments → `logo_needed: true`
   - Only include when it naturally enhances the brand moment

4. **IMAGE PROMPT GENERATION GUIDELINES** (CRITICAL FOR HIGH-QUALITY IMAGES):
   
   **📸 VISUAL STYLE MATCHING** (MANDATORY - Match brand's visual identity):
   The inventory analysis contains `visual_styles` with the brand's visual characteristics.
   For EACH image prompt, you MUST:
   
   1. **RANDOMLY PICK** one style from each category in `visual_styles`:
      - Pick ONE from `photography_styles` (e.g., "mobile_casual" or "professional_dslr")
      - Pick ONE from `lighting_styles` (e.g., "natural_daylight" or "golden_hour")
      - Pick ONE from `color_treatments` (e.g., "warm_tones" or "vibrant_saturated")
      - Pick ONE from `composition_styles` (e.g., "close_up" or "overhead_flatlay")
      - Pick ONE from `background_styles` (e.g., "minimal_clean" or "lifestyle_setting")
      - Pick ONE from `mood_atmospheres` (e.g., "warm_cozy" or "bright_airy")
      - Pick ONE from `quality_feels` (e.g., "instagram_aesthetic" or "ugc_authentic")
   
   2. **INTELLIGENTLY INCORPORATE** the picked styles into your image prompt text:
      - Don't just list the styles - weave them naturally into the prompt
      - Example: If you picked "mobile_casual", "natural_daylight", "warm_tones", "shallow_depth_of_field":
        → "Casual smartphone-style photo, natural window light streaming in, warm golden tones, subject in focus with soft bokeh background..."
   
   3. **VARY ACROSS PROMPTS**: Each image prompt should randomly pick different combinations
      - This creates variety while staying within the brand's visual identity
   
   **STYLE INTEGRATION EXAMPLES**:
   - photography=mobile_casual → "authentic smartphone-captured photo", "casual handheld shot", "raw unfiltered look"
   - lighting=golden_hour → "warm golden hour sunlight", "soft sunset glow", "magic hour warmth"
   - color=muted_desaturated → "subdued color palette", "softened tones", "gentle pastel hues"
   - composition=overhead_flatlay → "bird's eye view arrangement", "top-down flat lay", "overhead perspective"
   - background=bokeh_blur → "dreamy blurred background", "soft out-of-focus backdrop", "creamy bokeh"
   - mood=warm_cozy → "inviting warm atmosphere", "cozy intimate setting", "comfortable homey feel"
   - quality=ugc_authentic → "genuine unpolished aesthetic", "real and relatable look", "authentic user-generated style"
   
   🚨🚨🚨 **MANDATORY PRODUCT RULES - READ CAREFULLY** 🚨🚨🚨
   
   **RULE 1: PRODUCT MAPPING IS REQUIRED FOR ALL IMAGES** (when inventory has products):
   - If inventory_analysis contains product_images (count > 0):
     → You MUST set `product_mapping` for **ALL** image prompts, not just some
     → Set `"image_X_product_mapping": "image_1"` for EVERY image (0, 1, 2, 3, etc.)
   - If user mentions "product", "our product", "this product", "generate for product":
     → This confirms they want product in ALL images - map ALL of them
   - **NEVER set product_mapping to null when products exist in inventory**
   
   **RULE 2: "Reference product" MUST START EVERY IMAGE PROMPT** (when product is mapped):
   - When product_mapping is set (not null), your image prompt MUST:
     → **BEGIN** with the exact words "Reference product"
     → Follow immediately with description of product placement
   
   ✅ CORRECT FORMAT (product_mapping is set):
   - "Reference product displayed elegantly on marble surface..."
   - "Reference product (gelato) in glass bowl, surrounded by..."
   - "Reference product as hero shot on wooden table..."
   - "Reference product held by hands, lifestyle setting..."
   
   ❌ WRONG FORMAT (DO NOT DO THIS):
   - "Close-up of new artisanal gelato scoop..." ← Missing "Reference product" at start
   - "Elegant glass bowl with gelato..." ← Missing "Reference product" at start
   - "...reference product" at the end ← Wrong position, must be at START
   
   **RULE 3: END WITH PRODUCT INTEGRITY PHRASE**:
   - Every image prompt with product mapping MUST end with:
     → "do not morph the product distinguishing features"
   
   **RULE 4: REFERENCE LOGO PLACEMENT**:
   - "Reference logo" → When logo_needed is true
   - Place near the end of prompt, before the product integrity phrase
   
   **COMPLETE EXAMPLE OF CORRECT IMAGE PROMPT**:
   ```
   "image_prompt_0": "Reference product (artisanal popsicle) standing upright with stick inserted into a small ceramic bowl of chia seeds for support, leaning slightly against the bowl rim, cube-shaped design with colorful layers clearly visible and bite mark showing creamy interior, fresh berries and mint scattered around the bowl on marble countertop, soft diffused warm ambient lighting highlighting frozen texture, shallow depth of field with creamy bokeh background, warm cozy atmosphere, professional DSLR photography, incorporating Primary: #6998d0 in ceramic bowl, Secondary: #FFFFFF in marble, Accent: #9b366c in berry garnishes, 1:1 aspect ratio, Reference logo engraved on wooden stick, do not morph the product distinguishing features",
   "image_0_product_mapping": "image_1",
   "image_0_logo_needed": true
   ```
   
   **DETAILED & SPECIFIC PROMPTS** (MANDATORY):
   - Generate detailed and comprehensive image prompts (120-150 words per prompt)
   - **PROMPT STRUCTURE ORDER** (STRICT - when product exists in inventory):
     1. **FIRST 2 WORDS MUST BE**: "Reference product" (MANDATORY - no exceptions)
     2. Product description in parentheses: "(gelato)" or "(paleta)"
     3. **PHYSICAL PLACEMENT/POSITIONING** (CRITICAL - see below)
     4. Scene/environment description
     5. Lighting and atmosphere  
     6. Visual style elements (from visual_styles analysis)
     7. Color palette integration
     8. Technical specs (aspect ratio)
     9. "Reference logo [placement]"
     10. **LAST WORDS MUST BE**: "do not morph the product distinguishing features"
   
   📍 **PRODUCT PLACEMENT/POSITIONING** (MANDATORY - specify HOW product is physically placed):
   
   You MUST describe the physical positioning of the product in a way that:
   - Makes sense for that specific type of product
   - Follows real-world physics and natural laws
   - Shows the product in its best/most natural presentation
   
   ⚠️ **PHYSICS & SUPPORT RULES** (CRITICAL - products cannot float in air):
   
   **RULE: If product is at an angle, you MUST specify what is SUPPORTING it**
   - Products cannot hover, float, or balance at impossible angles
   - Every angled position needs a physical support described
   
   ❌ WRONG (physically impossible):
   - "standing upright at a slight angle on wooden surface" ← How is it staying at an angle? Impossible!
   - "popsicle tilted at 45 degrees on plate" ← Would fall over without support
   - "bottle leaning without support" ← Defies gravity
   
   ✅ CORRECT (physics-compliant - always specify support):
   - "standing upright with stick inserted into a small bowl of chia seeds for support"
   - "leaning at 45-degree angle against a ceramic bowl rim"
   - "propped up by resting against a stack of cookies"
   - "balanced in a decorative holder designed for popsicles"
   - "lying flat on the surface" (no angle = no support needed)
   - "held by a hand entering frame from left side"
   
   **SUPPORT OPTIONS TO USE**:
   - Inserted into: bowl of seeds, sand, ice, crushed ingredients
   - Leaning against: bowl rim, cup edge, stack of items, wall, another product
   - Resting on: stand, holder, display prop, folded napkin
   - Held by: hand, fingers, tongs, serving utensil
   - Lying flat: on surface (no support needed when horizontal)
   
   🔄 **ORIENTATION RULES** (CRITICAL - specify which end is up/down):
   
   Many products have a CORRECT orientation. You MUST explicitly describe which end faces up/down/camera:
   
   ❌ WRONG (ambiguous - AI may render inverted/wrong):
   - "popsicle in sand" ← Which end in sand? Could render frozen part buried!
   - "bottle on table" ← Cap up or down? Lying or standing?
   - "shoe displayed" ← Toe pointing where? Sole visible?
   
   ✅ CORRECT (explicit orientation):
   - "popsicle with wooden STICK inserted into sand, frozen treat part facing UP toward camera"
   - "bottle standing UPRIGHT with cap at TOP, label facing camera"
   - "shoe with TOE pointing LEFT, slight angle showing both side profile and top"
   - "lipstick standing VERTICAL with colored tip at TOP, cap removed beside it"
   - "phone lying SCREEN-UP on table, home screen visible"
   
   **ORIENTATION CHECKLIST** (ask yourself for each product):
   1. Which end should face UP? (specify it)
   2. Which end should face the CAMERA? (specify it)
   3. Which side is the "front"? (label, logo, main feature - make it visible)
   4. What is the natural/logical position? (how would a human place it?)
   
   **PRODUCT-SPECIFIC ORIENTATIONS**:
   🍦 Popsicle/Ice cream: "STICK at bottom (in holder/hand/sand), FROZEN TREAT at top visible to camera"
   🍾 Bottles: "standing UPRIGHT, cap/cork at TOP, label facing camera"
   👟 Shoes: "toe pointing LEFT or RIGHT, sole angled to show tread pattern"
   📱 Phone: "screen facing UP/toward camera, top of phone at top of frame"
   💄 Cosmetics: "applicator/tip at TOP, brand label visible"
   ⌚ Watch: "face toward camera, 12 o'clock at top, crown on right side"
   👜 Bags: "opening at TOP, front panel with logo facing camera"
   
   **PLACEMENT EXAMPLES BY PRODUCT TYPE**:
   
   🍦 **Food/Frozen treats (popsicle, ice cream, etc.)**:
   - "held by hand gripping the WOODEN STICK at bottom, FROZEN TREAT visible at top, bite taken from top corner revealing creamy interior"
   - "STICK inserted into bowl of chia seeds pointing DOWN, FROZEN PART facing UP toward camera, frost crystals visible"
   - "hand holding STICK from below, FROZEN TREAT at eye level tilted toward camera, condensation droplets glistening"
   - "WOODEN STICK planted in sand pointing DOWN, colorful FROZEN LAYERS visible at TOP, tropical fruits around base"
   - "POV shot - hand reaching to grab the STICK, FROZEN TREAT facing viewer, about to take a bite"
   - "lying flat on marble surface with STICK extending to the right, TOP of frozen treat showing layers and bite mark"
   
   ⌚ **Watches/Jewelry**:
   - "laid flat face-up on velvet cushion"
   - "wrapped around a cylindrical display stand"
   - "positioned at classic 10:10 time showing full dial"
   - "draped elegantly over polished stone"
   
   👗 **Clothing/Fashion**:
   - "draped gracefully over wooden chair back"
   - "laid flat on white surface showing full design"
   - "hung on minimalist wooden hanger against wall"
   - "folded neatly with corner slightly lifted"
   
   📱 **Electronics/Gadgets**:
   - "propped up at viewing angle on sleek stand"
   - "laid flat screen-up reflecting ambient light"
   - "held in hand with screen facing camera"
   - "floating at slight angle with shadow beneath"
   
   🧴 **Bottles/Containers**:
   - "standing upright with label facing camera"
   - "tilted at 30-degree angle showing liquid inside"
   - "nestled in crushed ice with condensation droplets"
   - "lying on side with pump dispenser visible"
   
   👟 **Shoes/Footwear**:
   - "positioned at three-quarter angle showing profile"
   - "one shoe standing, one lying beside it"
   - "arranged toe-to-heel in dynamic composition"
   
   🎒 **Bags/Accessories**:
   - "standing upright with flap open revealing interior"
   - "laid on side showing brand hardware"
   - "hung on hook with strap draped naturally"
   
   **GENERIC PLACEMENT OPTIONS** (when unsure):
   - "centered prominently as hero shot"
   - "positioned at eye-level angle"
   - "arranged at three-quarter view for dimension"
   - "displayed upright in natural resting position"
   - "held by hands entering frame showing scale"
   
   🎯 **ENGAGEMENT-BOOSTING ELEMENTS** (MANDATORY - APPLY TO ANY PRODUCT):
   
   ⚠️ **MANDATORY RULE**: EVERY image prompt you generate MUST include AT LEAST ONE engagement element from the categories below. Static "catalog shots" with products just sitting there are NOT ACCEPTABLE. You must AUTONOMOUSLY choose which engagement element(s) make sense for each specific product.
   
   **YOUR RESPONSIBILITY**: These examples teach you the PRINCIPLE. Apply them CREATIVELY and AUTONOMOUSLY to ANY product type - fashion, tech, beauty, food, home goods, jewelry, services, ANYTHING. You decide what works best for each product.
   
   **BEFORE FINALIZING ANY IMAGE PROMPT, ASK YOURSELF**:
   "Does this prompt have at least ONE of: human interaction, action/motion, desire-triggering detail, dynamic angle, or lifestyle context?"
   If NO → Add one. If YES → Good to proceed.
   
   **1. HUMAN INTERACTION** (highest engagement - works for ANY product):
   Examples to learn from:
   - Food: "held by a stylish hand, bite taken"
   - Fashion: "model adjusting collar, fabric in motion"
   - Tech: "fingers tapping screen, notification visible"
   - Beauty: "applying lipstick in mirror reflection"
   - Home: "hand placing item on shelf, arranging moment"
   → APPLY THIS: Show the product being USED, TOUCHED, or INTERACTED with
   
   **2. ACTION & MOTION** (creates life - adapt to product type):
   Examples to learn from:
   - Cold items: "condensation droplets, frost crystals, melt dripping"
   - Hot items: "steam rising, warmth visible"
   - Liquids: "splash frozen mid-air, pour moment"
   - Fabric: "flowing in breeze, movement blur"
   - Tech: "screen glow, notification animation"
   → APPLY THIS: What would be MOVING or CHANGING about this product in real life?
   
   **3. DESIRE-TRIGGERING DETAILS** (makes viewers want it):
   Examples to learn from:
   - Food: "bite revealing interior, glistening surface"
   - Fashion: "texture closeup, stitching detail, fabric weave"
   - Beauty: "product swatch on skin, before/after hint"
   - Tech: "screen showing exciting content, sleek reflection"
   - Jewelry: "light catching facets, sparkle and shimmer"
   → APPLY THIS: What sensory detail would make someone CRAVE this product?
   
   **4. DYNAMIC ANGLES** (not just straight-on - works for everything):
   - "POV shot as if viewer is about to grab/use it"
   - "low angle hero shot making product look impressive"
   - "overhead flat-lay for context and lifestyle"
   - "dutch angle (slight tilt) for energy"
   - "extreme close-up macro showing texture/quality"
   → APPLY THIS: Choose angle that creates EMOTION, not just documentation
   
   **5. LIFESTYLE CONTEXT** (aspirational - adapt to product):
   Examples to learn from:
   - Food: "picnic setting, cafe moment, dinner party"
   - Fashion: "street style, travel moment, night out"
   - Tech: "productive workspace, cozy evening, creative session"
   - Beauty: "getting ready moment, mirror selfie vibe"
   - Home: "styled room corner, morning routine, hosting guests"
   → APPLY THIS: Where would the IDEAL customer be using this product?
   
   **PRODUCT-SPECIFIC ADAPTATIONS** (be creative for each category):
   
   🍦 Food/Beverage: bite marks, melt/drip, steam, condensation, pour moment
   👗 Fashion: fabric movement, styling moment, mirror check, outfit reveal
   💄 Beauty: application moment, swatch on skin, glow/shimmer, reflection
   📱 Tech: screen content, finger interaction, notification, charging glow
   🏠 Home: styling moment, in-use context, before/after, cozy setting
   💎 Jewelry: light catching, sparkle, wearing moment, gift box opening
   🎒 Accessories: being worn, packing moment, what fits inside
   
   **AUTONOMOUS APPLICATION**: For ANY product you encounter, ask yourself:
   1. How would a human INTERACT with this? (show that)
   2. What MOVES or CHANGES about it? (capture that moment)
   3. What makes people WANT it? (highlight that detail)
   4. What ANGLE creates emotion? (use that)
   5. Where would the dream customer USE it? (set that scene)
   
   🚨 **FINAL CHECK (MANDATORY)**: Before outputting ANY image prompt, verify it contains at least ONE engagement element. Examples of what to add:
   
   - Food/Beverage: "hand holding", "bite taken revealing interior", "condensation droplets", "melt dripping"
   - Fashion: "model adjusting garment", "fabric caught in breeze", "mirror reflection moment"
   - Tech: "finger tapping screen", "hand unboxing", "screen showing exciting content"
   - Beauty: "applying product", "swatch on skin", "mirror application moment"
   - Home/Decor: "hand placing item", "person in background using space", "morning light through window"
   - Jewelry: "hand showing off ring", "clasp being fastened", "light catching facets"
   - ANY Product: "hand reaching toward", "POV about to grab", "unboxing moment", "in-use action"
   
   **YOU DECIDE** which element fits best. Be creative. But NEVER output a static "product just sitting there" prompt.
   
   - Include specific details about: composition, lighting, camera angle, mood, atmosphere
   - Specify subject placement, background elements, foreground elements, and spatial relationships
   - Describe textures, materials, and surface qualities
   - Include professional photography/cinematography terms for better quality
   
   **EXPANDED PROMPT EXAMPLE** (120-150 words):
   "Reference product (artisanal popsicle) held by a feminine hand with soft pink manicured nails entering frame from bottom right, fresh bite taken from top corner revealing colorful layered interior with visible berry chunks, condensation droplets glistening on frozen surface catching golden hour sunlight, slight melt beginning at edges with a single droplet about to fall, fresh strawberries and tropical fruits arranged on rustic wooden table below, turquoise ceramic bowl with chia seeds as prop element, shallow depth of field with dreamy bokeh background suggesting beach cafe setting, warm inviting atmosphere that makes viewer crave the treat, professional food photography style with high definition crisp details showing ice crystal texture, incorporating Primary: #6998d0 in ceramic bowl, Secondary: #FFFFFF in background highlights, Accent: #9b366c in berry garnishes, 1:1 aspect ratio for social media, Reference logo engraved on wooden stick, do not morph the product distinguishing features"
   
   **SIMPLICITY & FOCUS** (AVOID CLUTTERED IMAGES):
   - Focus on ONE central subject or concept per image
   - Avoid prompts with too many characters (max 1-2 people in frame)
   - Avoid prompts with too many objects competing for attention
   - Use clean, uncluttered backgrounds
   - Create visual hierarchy - make it clear what the eye should focus on first
   - Simple, powerful imagery is better than busy, complex scenes
   - Think "magazine cover" quality - clean, professional, focused
   
   🎬 **CINEMATIC & DYNAMIC ELEMENTS** (AUTONOMOUS - ELEVATE VISUAL QUALITY):
   
   **YOUR CREATIVE FREEDOM**: You are a CINEMATOGRAPHER and DIRECTOR, not just a prompt writer. Think about HOW the shot is captured, not just WHAT is in it. These examples teach you techniques - apply them AUTONOMOUSLY when they enhance the content. Not every prompt needs cinematic elements, but brilliant content often has them.
   
   **FOR IMAGES - "FROZEN CINEMATIC MOMENTS"**:
   
   Instead of static product shots, capture a dramatic moment frozen in time:
   
   📸 **Implied Motion** (the image feels alive):
   - "splash of berry juice frozen mid-air around the popsicle"
   - "single condensation droplet suspended, about to fall"
   - "hair strand caught in breeze, flowing across frame"
   - "fabric ripple frozen at peak of movement"
   - "powder/crumbs exploding outward, frozen in moment of impact"
   
   📸 **Dramatic Lighting** (creates mood and dimension):
   - "dramatic rim lighting creating golden edge glow on product"
   - "single shaft of light cutting through dust particles"
   - "backlit silhouette with lens flare bleeding into frame"
   - "chiaroscuro lighting with deep shadows and bright highlights"
   - "golden hour rays streaming through, catching on condensation"
   
   📸 **Cinematic Composition** (film-quality framing):
   - "rack focus effect - blurred foreground element, sharp product"
   - "shallow depth of field with dreamy circular bokeh"
   - "leading lines drawing eye toward product"
   - "reflection in water/mirror creating symmetry"
   - "shot through foreground element (leaves, glass, fabric)"
   
   📸 **Perspective Drama** (unusual angles that captivate):
   - "worm's eye view looking up at product against sky"
   - "bird's eye directly overhead flat lay"
   - "dutch angle creating dynamic tension"
   - "extreme macro showing texture at near-microscopic level"
   - "forced perspective making product appear larger than life"
   
   **FOR CLIPS/VIDEOS - CAMERA MOVEMENT & DYNAMICS**:
   
   Video prompts should describe HOW the camera moves and behaves:
   
   🎥 **Camera Movement** (brings scenes to life):
   - "slow cinematic zoom in toward product, revealing fine details"
   - "camera slowly orbits around product 90 degrees"
   - "dolly push in on character's reaction face"
   - "tracking shot following hand as it reaches for product"
   - "crane shot descending from above to eye level"
   - "subtle handheld movement for organic, authentic feel"
   
   🎥 **Speed & Timing** (creates emotional impact):
   - "slow motion capture of bite, showing texture in detail"
   - "timelapse of condensation forming on cold surface"
   - "speed ramp: slow motion moment of impact, then normal speed"
   - "real-time pour with liquid dynamics visible"
   - "slow motion hair flip or fabric swirl"
   
   🎥 **Focus & Depth** (directs viewer attention):
   - "rack focus from blurred hand to sharp product"
   - "pull focus following movement through scene"
   - "deep focus keeping entire scene sharp"
   - "selective focus isolating subject from busy background"
   
   🎥 **Reveal & Transition Techniques**:
   - "reveal shot: obstruction moves away unveiling product"
   - "camera pushes through foreground element into scene"
   - "whip pan blur suggesting energy and excitement"
   - "zoom through product logo for transition moment"
   
   **AUTONOMOUS APPLICATION GUIDE**:
   
   Ask yourself for each prompt:
   - "Would a cinematic technique make this more visually striking?"
   - "What would a film director do to make this shot memorable?"
   - "Is there implied motion I can freeze (images) or actual motion I can describe (clips)?"
   - "What lighting would create the most dramatic/appealing mood?"
   
   **WHEN TO USE** (your judgment):
   - Product reveals → zoom in, dramatic lighting, reveal shots
   - Food/beverage → slow motion, splash/drip frozen moments, macro texture
   - Fashion/beauty → slow motion fabric/hair, artistic lighting, mirror shots
   - UGC/lifestyle → handheld feel, natural movement, authentic moments
   - Brand storytelling → cinematic transitions, dramatic compositions
   
   **EXAMPLE TRANSFORMATIONS**:
   
   ❌ Basic: "popsicle on wooden table with berries"
   ✅ Cinematic: "popsicle with dramatic rim lighting creating golden edge glow, single droplet of melt frozen mid-fall, shot through blurred foreground berry with rack focus to sharp product, shallow depth of field with warm bokeh"
   
   ❌ Basic: "person holding product and smiling"
   ✅ Cinematic: "slow motion zoom in on genuine smile as hand brings product into frame, soft golden hour backlight creating hair glow and subtle lens flare, shallow depth of field with background melting into creamy bokeh"
   
   ❌ Basic: "product on display"
   ✅ Cinematic: "camera slowly orbits product 45 degrees revealing different angle, dramatic side lighting casting long shadows, dust particles visible in light shaft, cinematic color grade with lifted blacks"
   
   **REMEMBER**: You have FULL creative autonomy. These are techniques in your toolkit - use them when they serve the content. A simple, clean shot can be perfect. A cinematic masterpiece can be perfect. YOU decide what's right for each specific prompt based on brand, product, context, and intended emotion.
   
   **🌍 REAL-WORLD PHYSICS & NATURAL LAWS** (AUTONOMOUS APPLICATION):
   
   You must AUTONOMOUSLY apply real-world understanding to ALL prompts. Your prompts should explicitly describe how objects, humans, animals, and environments behave according to physics and nature. This prevents AI image/video models from making unrealistic outputs.
   
   **YOUR RESPONSIBILITY**: Based on the context, intelligently include realistic details in your prompts. These examples teach you the PRINCIPLE - apply it to ANY scenario:
   
   📱 **Object Orientation & Interaction**:
   - "holding smartphone with screen facing toward them" (not screen facing away)
   - "laptop open on desk, screen tilted toward the user at comfortable viewing angle"
   - "drinking from cup held by the handle, liquid inside visible through transparent glass"
   - "reading book held upright, pages facing the reader, natural page curl"
   - "camera viewfinder pressed to eye, finger on shutter button"
   
   🖐️ **Human Anatomy & Natural Poses**:
   - "natural hand grip with five fingers wrapped around the product"
   - "relaxed shoulders, weight balanced on both feet"
   - "genuine smile reaching the eyes, natural facial muscles"
   - "wrist at comfortable angle while typing on keyboard"
   - "elbow bent naturally while holding phone to ear"
   
   ⚖️ **Physics & Gravity**:
   - "hair falling naturally with gravity, slight movement from breeze"
   - "fabric of dress draping downward, following body contours"
   - "coffee steam rising upward from hot cup"
   - "water droplets running down the side of cold glass"
   - "shadow cast on ground in direction opposite to light source"
   
   🔲 **Spatial Relationships & Perspective**:
   - "person in foreground slightly larger, background elements appropriately smaller"
   - "objects on table receding toward horizon with correct perspective"
   - "reflection in mirror showing the back of the person's head"
   - "phone screen reflecting ceiling lights realistically"
   
   🐾 **Living Things & Natural Behavior**:
   - "dog sitting with tail naturally positioned, ears alert"
   - "cat's pupils adjusted to lighting conditions"
   - "person blinking naturally, micro-expressions present"
   - "plant leaves oriented toward light source"
   
   🌤️ **Environment & Context Consistency**:
   - "indoor scene with soft artificial lighting from visible sources"
   - "outdoor sunny day with harsh shadows and bright highlights"
   - "rainy weather with wet surfaces reflecting city lights"
   - "morning light coming from east-facing window"
   
   **APPLY THIS AUTONOMOUSLY**: For every prompt you generate, consider what would happen in the real world. If someone is holding something, HOW are they holding it? If something is on a surface, HOW is it positioned? If there's light, WHERE are the shadows? Your prompts should answer these questions naturally.
   
  **COLOR PALETTE INTEGRATION** (MANDATORY - NATURAL PHYSICAL OBJECTS ONLY):
  - You MUST use the brand's color palette in every image prompt (if provided)
{f"  - Primary color: {color_palette.get('primary')}" if color_palette.get('primary') else ""}
{f"  - Secondary color: {color_palette.get('secondary')}" if color_palette.get('secondary') else ""}
{f"  - Accent color: {color_palette.get('accent')}" if color_palette.get('accent') else ""}
  
  - **🚨 CRITICAL: HOW TO USE COLORS NATURALLY** (NO GLOWS, NO LIGHTING EFFECTS):
    * ✅ USE colors in PHYSICAL OBJECTS & SURFACES:
      - Painted walls, colored furniture, decor items (vases, artwork, cushions)
      - Clothing items (shirts, jackets, accessories)
      - Product packaging, props, background elements
      - Natural surfaces (colored table, painted backdrop, colored rug/carpet)
    
    * ❌ NEVER use colors for:
      - Lighting effects, glows, halos, auras, neon effects
      - "Accent lighting", "ambient glow", "screen glow", "energetic lighting"
      - Borders, outlines, artificial effects around people or objects
      - Any kind of light source or illumination effect
  
  - **CORRECT USAGE EXAMPLES** (only use colors that are available above):
    * "wearing [brand color] colored shirt"
    * "[brand color] painted wall in background"
    * "[brand color] colored cushions on sofa"
    * "product packaging in [brand color]"
    * "[brand color] colored furniture"
  
  - **INCORRECT USAGE (AVOID)**:
    * ❌ "using [color] for lighting accents"
    * ❌ "using [color] for screen glow"
    * ❌ "energetic lighting in {color_palette.get('primary', '#000000')}"
    * ❌ "ambient glow" or "accent lighting" with brand colors
  
  - **MANDATORY ENDING**: Every image prompt MUST end with: ", colors used only in physical objects and surfaces not in lighting or glow effects, use provided hex colour codes for generating images but no hex colour code as text in image anywhere"
  - **ABSOLUTELY MANDATORY**: The hex codes should be used by the AI model for color palette application in PHYSICAL OBJECTS ONLY, never as lighting effects, and must NEVER appear as visible text anywhere in the generated images
   
   **PROFESSIONAL QUALITY** (Social Media Excellence):
   - Specify professional lighting: studio lighting, natural light, golden hour, soft diffused light, dramatic lighting
   - Include camera specs when relevant: shallow depth of field, bokeh, sharp focus, 50mm lens perspective
   - Mention composition rules: rule of thirds, centered composition, negative space, symmetry
   - Describe mood and atmosphere: energetic, calm, luxurious, authentic, professional, aspirational
   - Optimize for 1:1 aspect ratio (square format for social media)
   
  **EXAMPLES OF GOOD IMAGE PROMPTS** (Colors in Physical Objects Only):
  - "Professional product photography of sleek wireless headphones centered on minimalist marble surface, {color_palette.get('primary', '#000000')} colored backdrop wall, {color_palette.get('secondary', '#000000')} product packaging visible in background, clean professional studio lighting with soft shadows, shallow depth of field creating bokeh effect, commercial advertising aesthetic, high-end feel, colors used only in physical objects and surfaces not in lighting or glow effects, use provided hex colour codes for generating images but no hex colour code as text in image anywhere"
  - "Young entrepreneur working on laptop in modern coffee shop, warm natural light streaming through window, wearing {color_palette.get('primary', '#000000')} colored casual shirt, {color_palette.get('secondary', '#000000')} colored furniture and decor in background, {color_palette.get('accent', '#000000')} colored coffee cup on table, shallow depth of field with blurred background, authentic candid moment, professional lifestyle photography, Instagram aesthetic, colors used only in physical objects and surfaces not in lighting or glow effects, use provided hex colour codes for generating images but no hex colour code as text in image anywhere"

5. PLATFORM-SPECIFIC TEXTS:
   - Generate engaging captions for: Instagram, Twitter, LinkedIn, TikTok
   - Match the tone/style to the chosen video_type
   - UGC videos: Casual, relatable captions (as if YOU are the person in the video)
   - Product videos: Feature-focused, benefit-driven (as the BRAND speaking)
   - Brand videos: Emotional, value-driven (as the BRAND storytelling)
   
   🚫 **NEVER REVEAL PROCESS**: Platform texts are PUBLIC. Never mention "UGC style", "influencer content", "product marketing", etc. Write as the authentic voice would naturally post.
"""
    else:
        video_prompts_section = ""
        video_prompts_instruction = ""
        
    # Build JSON example with new structure
    # Image-only posts (not videos)
    image_only_indices = [i for i in range(number_of_posts) if i not in video_indices]
    image_prompt_examples = []
    for i in image_only_indices:
        image_prompt_examples.append(f'"image_prompt_{i}": "Detailed visual description with {color_str}, 1:1 aspect ratio for social media..."')
        image_prompt_examples.append(f'"image_{i}_product_mapping": "image_1" (REQUIRED if products exist in inventory - map ALL images to product)')
        image_prompt_examples.append(f'"image_{i}_logo_needed": true')
    
    image_prompts_section = ",\n  ".join(image_prompt_examples) if image_prompt_examples else ""
    
    # Platform texts for ALL posts
    platform_text_examples = ",\n    ".join([f'''{{
    "post_index": {i},
    "topic": "{request.topic}",
      "content_type": "{'video' if i in video_indices else 'image'}",
    "platforms": {{
        "twitter": "Engaging tweet (max 280 chars)...",
        "instagram": "Instagram caption with emojis and hashtags...",
        "linkedin": "Professional post with insights...",
        "tiktok": "Catchy TikTok caption..."
    }}
  }}''' for i in range(number_of_posts)])
    
    # Build complete JSON example
    json_example = f'''{{
  "video_type": "product_marketing" or "ugc_influencer" or "brand_marketing",
  "voiceover": {"true" if voiceover_for_non_ugc else "false"} for product/brand marketing OR false for ugc_influencer,
  "no_characters": true or false,
  "human_characters_only": true or false,
  "influencer_marketing": true or false,
  "web3": false,
  
  {image_prompts_section}{", " if image_prompts_section and video_prompts_section else ""}
  
  {video_prompts_section},
  
  "platform_texts": [
    {platform_text_examples}
  ]
}}'''

    system_prompt = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in social media content creation.
You respond ONLY with valid JSON objects, no extra text or formatting.

Generate {number_of_posts} pieces of content for the topic: "{request.topic}"

🎯 YOUR DECISION-MAKING RESPONSIBILITY:

1. **DECIDE VIDEO TYPE** (product_marketing / ugc_influencer / brand_marketing)
   - Analyze brand context, inventory, user instructions, and link analysis
   - Set appropriate flags based on your decision

2. **⚠️ VOICEOVER FLAG IS PRE-DETERMINED** (DO NOT OVERRIDE):
   - For product_marketing and brand_marketing: voiceover MUST be {"true" if voiceover_for_non_ugc else "false"} (this is pre-decided)
   - For ugc_influencer: voiceover is always false (character speaks on camera)

3. **GENERATE PROMPTS BASED ON FLAGS**:
   {"- voiceover=true for product/brand marketing → Include 'Voiceover in [tone] [gender] voice:' at END of clip prompts" if voiceover_for_non_ugc else "- voiceover=false for product/brand marketing → NO voiceover, NO speech - PURE VISUAL with cinematic effects only"}
   - influencer_marketing=true (UGC) → Include "saying in [tone] (14 words max): [speech]" in clip prompts
   - no_characters=true → NO human characters in prompts

3. **SPECIFY VOICE/TONE** (CRITICAL for Veo3.1 audio quality):
   - Product/Brand videos: "Voiceover in professional male narrator voice:" or "warm confident female voice:"
   - UGC videos: "saying in conversational excited tone:" or "genuine relatable tone:"
   - Voice/tone specification ensures Veo3.1 generates appropriate, high-quality embedded audio

4. **USE ACTUAL BRAND NAME IN CLIP PROMPTS ONLY** (MANDATORY for voiceover/speech):
   - **Brand Name**: {dvyb_context.get('accountName', 'the brand')}
   - **ONLY in CLIP PROMPTS** (video motion descriptions with voiceover/speech):
     * When generating voiceover text or character speech that mentions the brand
     * ALWAYS use "{dvyb_context.get('accountName', 'the brand')}" (the actual brand name from accountName)
     * DO NOT use generic terms like "our product", "this brand", "our company"
   - **NOT in IMAGE PROMPTS** (visual descriptions - no speech, so no brand name needed)
   - **NOT in PLATFORM TEXTS** (social media captions - handle brand mentions naturally there)
   - Clip Prompt Examples (Note: "no text overlays" comes BEFORE voiceover/speech):
     * ✅ CORRECT: "video_0_clip_1_prompt": "Camera zooms in, no text overlays. Voiceover in professional voice: {dvyb_context.get('accountName', 'the brand')} revolutionizes content creation."
     * ✅ CORRECT: "video_0_clip_1_prompt": "Influencer smiling, no text overlays. Saying in excited tone: I love using {dvyb_context.get('accountName', 'the brand')} for my posts."
     * ❌ WRONG: "video_0_clip_1_prompt": "Voiceover: This product revolutionizes content creation, no text overlays." (no text overlays should NOT come after speech)

5. **MODEL/CHARACTER CONSISTENCY**:
   - If has_model_image=true → Use "reference model" in ALL image prompts (UGC only)
   - If has_model_image=false → Specify full character details in Clip 1, use "reference character" in Clip 2+

YOUR FLAGS CONTROL THE PROMPTS YOU GENERATE. Be consistent and intentional.

BRAND CONTEXT:
{_build_brand_context(dvyb_context, color_str)}

ENHANCED BRAND CONTEXT (Use for variety in content):
{_format_enhanced_context(context) if _format_enhanced_context(context) else '(No enhanced context available)'}

🚨 CRITICAL - RELEVANCE FILTERING:
- The above documents, links, voices, and styles are provided as OPTIONAL context
- **ONLY USE IF RELEVANT** to:
  * Current topic: "{request.topic}"
  * Brand: {dvyb_context.get('accountName', '') or 'the brand'}
  * Industry: {dvyb_context.get('industry', '') or 'the industry'}
  * User instructions: {request.user_prompt if request.user_prompt and request.user_prompt.strip() else '(No specific instructions)'}
- **IGNORE IRRELEVANT DATA**: Users may have uploaded unrelated documents/links by mistake
- Examples of what to IGNORE:
  * If topic is "Summer Sale" → ignore documents about "Winter Holiday Party"
  * If generating product content → ignore HR policies or internal memos
  * If brand sells software → ignore documents about restaurant operations
  * If link is about unrelated industry → ignore it
- **USE YOUR JUDGMENT**: Intelligently decide relevance before incorporating any data

USER INSTRUCTIONS: {request.user_prompt if request.user_prompt and request.user_prompt.strip() else '(No specific instructions provided - use your best judgment based on topic and brand context)'}

CURRENT DATE: {context.get('current_date', datetime.utcnow().isoformat())[:10]} (for temporal context in documents)

UPLOADED IMAGES ANALYSIS (Classified into 3 categories):
{inventory_analysis_str if inventory_analysis_str else '(No user images provided)'}

🚨 CRITICAL: HOW TO USE CLASSIFIED IMAGES IN YOUR PROMPTS:

1. **PRODUCT IMAGES** 🛍️:
   - These are actual products/services the brand sells
   - Each product has: category, features, angle, showcases, best_use
   
   **YOUR TASK**:
   - For each IMAGE prompt (NOT clip motion prompts), decide if a product image should be referenced
   - **OUTPUT MAPPING**: `"product_mapping": "image_X"` where X is the product image index from inventory
   - **IN YOUR PROMPT**: When product is mapped, use the keyword **"reference product"**
   
   **EXAMPLES**:
   - Product available: image_1 (wireless headphones, front view, showcases LED lighting)
   - Product available: image_2 (wireless headphones, side view, showcases touch controls)
   
   Your output:
   - Image post 0 (product showcase):
     * `"image_0_product_mapping": "image_1"`
     * `"image_prompt_0": "Reference product (wireless headphones) on marble surface, LED lighting visible..."`
   
   - Video 0, Clip 1 (opening shot):
     * `"video_0_clip_1_product_mapping": "image_1"`
     * `"video_0_clip_1_image_prompt": "Reference product from front angle in modern setup, LED lights glowing..."`
   
   - Video 0, Clip 2 (detail shot):
     * `"video_0_clip_2_product_mapping": "image_2"`
     * `"video_0_clip_2_image_prompt": "Reference product from side angle, close-up on touch controls..."`
   
   **WHEN TO MAP**: When the frame should feature that specific product view/angle
   **WHEN NOT TO MAP**: Pure lifestyle shots without product focus → set mapping to `null`

2. **INSPIRATION IMAGES** 🎨:
   - Style guides, mood boards, aesthetic references
   - Each has: type, style, colors, mood, insights
   
   **YOUR TASK**:
   - Use these to understand the desired aesthetic and style
   - Incorporate the style naturally into your prompts (colors, mood, composition)
   - **NO MAPPING OUTPUT**: Don't create product_mapping for inspiration images
   - **IN YOUR PROMPT**: Don't use "reference inspiration" - just write prompts that reflect the style
   
   **EXAMPLE**:
   - Inspiration: image_3 (minimalist modern, white/gold colors, soft lighting, luxury mood)
   
   Your prompt should naturally incorporate:
   - "minimalist white room with gold accents, soft natural lighting, clean luxury aesthetic..."

3. **MODEL IMAGE** 👤:
   - A person/influencer for UGC-style videos
   - Details: ethnicity, age, gender, style, appearance
   
   **YOUR TASK**:
   - If `has_model_image: true` → Use **"reference model"** keyword in ALL UGC image prompts
   - **NO MAPPING OUTPUT**: Model is handled automatically - you just use the keyword
   - **IN YOUR PROMPT**: "Reference model [action/setting]..."
   
   **EXAMPLE**:
   - Model available: image_4 (South Asian woman, mid-20s, casual modern style)
   
   Your UGC prompts:
   - `"video_0_clip_1_image_prompt": "Reference model in bright kitchen, natural lighting, genuine smile..."`
   - `"video_0_clip_2_image_prompt": "Reference model holding product, looking at camera..."`

INSPIRATION LINKS ANALYSIS:
{link_analysis_str if link_analysis_str else '(No inspiration links provided)'}
{f'⚠️ NOTE: Only incorporate link insights if RELEVANT to topic "{request.topic}" and brand context. Ignore if unrelated.' if link_analysis_str else ''}

GENERATE:

🎯 **AUTONOMOUS TOPIC SELECTION** (When user instructions are minimal or not provided):

**APPLIES TO BOTH WEB2 AND WEB3 BRANDS/PROJECTS**:

If the user has NOT provided specific content instructions or topic guidance:
- **ANALYZE THE PROVIDED CONTEXT** deeply:
  * Brand context (accountName, businessOverview, industry, brandVoices, brandStyles)
  * Inventory analysis (products, inspiration images, model images)
  * Documents and links (recent news, updates, features)
  * Keywords and brand values
  
- **PICK A COMPELLING TOPIC** autonomously based on:
  * Industry trends and what resonates with the target audience
  * Brand's unique selling points or recent developments
  * Seasonal/timely relevance (if applicable)
  * What would drive the most engagement for this specific brand
  
- **TOPIC SELECTION EXAMPLES BY INDUSTRY**:
  * **E-commerce/Retail**: New arrivals, seasonal sales, customer favorites, behind-the-scenes
  * **SaaS/Tech**: Feature spotlight, productivity tips, user success stories, industry insights
  * **Food & Beverage**: Recipe ideas, ingredient spotlight, seasonal specials, food trends
  * **Fashion/Beauty**: Style tips, trending looks, product tutorials, influencer picks
  * **Health & Fitness**: Workout tips, nutrition advice, transformation stories, wellness trends
  * **Finance/Fintech**: Money tips, market insights, product benefits, financial education
  * **Travel/Hospitality**: Destination highlights, travel tips, guest experiences, seasonal getaways
  * **Web3/Crypto**: Community updates, ecosystem growth, partnership announcements, technical milestones
  * **Any other industry**: Adapt creatively based on context analysis
  
- **GENERATE COHESIVE CONTENT**: Once you pick a topic, ensure ALL generated content (texts, image prompts, clip prompts) aligns with that chosen topic for a unified, engaging post.

1. VIDEO TYPE SELECTION:
   - **FIRST**: Check if USER INSTRUCTIONS explicitly request a specific video type (product showcase, UGC/influencer, brand story)
   - **IF YES**: Honor the user's explicit request
   - **IF NO**: Autonomously analyze inventory, brand context, and content purpose to decide
   - Choose: "product_marketing", "ugc_influencer", or "brand_marketing"
   - This decision affects ALL subsequent prompts and flags

2. IMAGE PROMPTS (for image-only posts):
   - Posts at indices {sorted(image_only_indices)}: Static images (1:1 aspect ratio)
   - Include brand colors: {color_str}
   - Optimized for AI image generation
   
   🏷️ **LOGO REQUIREMENT FOR IMAGE POSTS** (MANDATORY):
   - **ALL image-only posts MUST include the brand logo**
   - For every image post, set `logo_needed: true`
   - This ensures brand visibility in static image posts
   - Example: `"image_0_logo_needed": true`, `"image_3_logo_needed": true`
   
   🚨 PRODUCT MAPPING & REFERENCE KEYWORDS (MANDATORY):
   
   **⚠️ CRITICAL RULE: WHEN PRODUCTS EXIST, MAP ALL IMAGES TO PRODUCT**:
   - If inventory_analysis contains product_images (count > 0):
     * You MUST set `"image_X_product_mapping": "image_1"` for **EVERY** image prompt (0, 1, 2, 3...)
     * **NEVER set product_mapping to null** when products exist
     * The user uploaded product images because they want the PRODUCT in their content
     * ALL images should showcase the product from different angles, settings, or contexts
   
   **MAPPING RULE**:
   - Products exist → Map ALL images to product (use "image_1" for most, or vary if multiple products)
   - No products → Then and ONLY then can product_mapping be null
   
   **IN YOUR PROMPT** (when product is mapped):
   - Use **"Reference product"** keyword at the START
   - Include **"do not morph the product distinguishing features"** at the END
   
   **MAPPING EXAMPLES** (when 1 product exists - ALL images get mapped):
   ```
   Available: image_1 (paleta product)
   
   Image Post 0 (close-up product shot):
   {{
     "image_0_product_mapping": "image_1",
     "image_prompt_0": "Reference product (paleta) held by hand with bite taken...",
     "image_0_logo_needed": true
   }}
   
   Image Post 1 (lifestyle context - STILL HAS PRODUCT):
   {{
     "image_1_product_mapping": "image_1",
     "image_prompt_1": "Reference product (paleta) in beach setting with tropical fruits...",
     "image_1_logo_needed": true
   }}
   
   Image Post 2 (different angle - STILL HAS PRODUCT):
   {{
     "image_2_product_mapping": "image_1",
     "image_prompt_2": "Reference product (paleta) flat lay arrangement with ingredients...",
     "image_2_logo_needed": true
   }}
   ```
   
   **NOTE**: ALWAYS set `logo_needed: true` for ALL image-only posts
   
   **REFERENCE KEYWORDS** (use in prompts when applicable):
   - **"Reference product"** → MANDATORY for ALL images when products exist
   - **"Reference logo"** → When logo_needed is true
   - **"Reference model"** → When has_model_image is true (for UGC videos)
   
   **COMBINED EXAMPLE** (120-150 words):
   ```
   {{
     "image_prompt_0": "Reference product (artisan popsicle) standing upright with wooden stick inserted into a turquoise ceramic bowl filled with chia seeds for support, leaning at slight angle against the bowl rim for stability, cube-shaped frozen treat with alternating peanut butter and strawberry layers clearly visible with a bite taken from top corner revealing creamy texture inside, fresh strawberries and goji berries scattered artfully around the bowl on rustic wooden table, soft natural window light streaming from the right creating beautiful highlights on the frozen surface, shallow depth of field with softly blurred background, warm cozy atmosphere with vibrant saturated colors, professional DSLR photography quality with high definition crisp details, incorporating Primary: #6998d0 in ceramic bowl, Secondary: #FFFFFF in background highlights, Accent: #9b366c in strawberry garnish, 1:1 aspect ratio for social media, Reference logo engraved on wooden stick, do not morph the product distinguishing features",
     "image_0_product_mapping": "image_1",
     "image_0_logo_needed": true
   }}
   ```
   
   These keywords ensure consistency when the same elements appear across multiple images.{video_prompts_instruction}

5. PLATFORM-SPECIFIC TEXTS:
   - Generate for ALL {number_of_posts} posts
   - Platforms: {', '.join(request.platforms)}
   - Twitter: Engaging tweets (max 280 chars)
   - Instagram: Captions with emojis + hashtags
   - LinkedIn: Professional insights
   - TikTok: Catchy, short captions
   - Match tone to video_type (casual for UGC, professional for product/brand)
   
   🚫 **CRITICAL: NEVER REVEAL INTERNAL PROCESS IN PLATFORM TEXTS**:
   Platform texts are PUBLIC social media captions seen by END USERS. They must NOT contain:
   - ❌ "UGC style", "UGC content", "influencer style", "customer stories"
   - ❌ "Product marketing", "brand marketing", "promotional content"
   - ❌ References to user instructions or generation process
   - ❌ Meta-commentary about what type of content it is
   - ❌ "Real talk", "honest review", "testimonial" (unless naturally authentic)
   
   ✅ **WRITE AS IF YOU ARE THE BRAND/INFLUENCER** posting naturally:
   - For UGC: Write as an authentic person sharing their genuine experience
   - For Product: Write as the brand showcasing their offering
   - For Brand: Write as the brand telling their story
   
   **EXAMPLES**:
   - ❌ WRONG: "Listen to this customer's honest take on our product—UGC style real talk!"
   - ✅ CORRECT: "This just changed my morning routine completely 🔥 Have you tried it yet?"
   
   - ❌ WRONG: "Check out this influencer-style review of our latest product"
   - ✅ CORRECT: "I've been using this for 2 weeks and honestly? Game changer 💯"
   
   - ❌ WRONG: "Brand marketing content showcasing our values"
   - ✅ CORRECT: "Built for those who refuse to settle ✨"

6. 🌐 **WEB3/BLOCKCHAIN PROJECT DETECTION & CONTENT STYLE** (CRITICAL):
   
   **FIRST**: Analyze the brand context, user prompt, and inventory analysis to determine if this is a Web3/blockchain project.
   Web3 indicators: crypto, blockchain, DeFi, NFT, token, DAO, metaverse, wallet, staking, yield, airdrop, TGE, TVL, APY, Web3, chain, decentralized, smart contract, etc.
   
   **IF WEB3/BLOCKCHAIN PROJECT DETECTED**:
   
   🎯 **USER INSTRUCTIONS ARE ALWAYS PRIORITY**:
   - **FIRST** check if user has given specific instructions about content style/type
   - If user requests: UGC style, product launch, feature announcement, educational content, professional posts, etc.
     → **FOLLOW USER INSTRUCTIONS** - do NOT default to shitpost style
   - Examples of user instructions that override shitpost default:
     * "Generate UGC style video" → Use UGC/influencer approach
     * "New feature launch post" → Use product marketing approach
     * "Professional announcement" → Use brand marketing approach
     * "Educational content about our product" → Use informative approach
   - **ONLY if user has NOT given specific content style instructions** → Default to SHITPOST style below
   
   A. **Platform Texts - SHITPOST STYLE** (DEFAULT when no specific user instructions):
      - Generate casual, witty, meme-worthy captions that drive engagement
      - Use natural crypto Twitter humor and community callbacks
      - Include project token mention naturally (if available)
      - Reference bullish sentiment, moon, HODL culture when appropriate
      - Keep content punchy and authentic - NO corporate speak
      - End with natural engagement hooks that invite community participation
      - Examples:
        * "When you realize $TOKEN is about to change everything 👀🚀"
        * "POV: You found this before everyone else 😏"
        * "Not financial advice but... 💀"
        * "The team shipping while others are sleeping 🔥"
   
   B. **Image Prompts - CATEGORY-SPECIFIC SHITPOST VISUALS**:
      
      🎯 **BE FULLY AUTONOMOUS & CREATIVE**: You decide the category and visual style based on context analysis.
      The examples below are ONLY INSPIRATIONS - you can create any category-appropriate meme visuals:
      
      **EXAMPLE CATEGORIES (for inspiration only - be creative beyond these)**:
      - **DeFi**: Meme/Comic style with crypto characters (Wojak checking yields, Pepe celebrating gains); relatable DeFi scenarios
      - **NFT**: Meme/Comic with popular formats (Drake choosing NFTs, Expanding Brain meme about digital ownership)
      - **Gaming**: Meme/Comic with gaming characters (Chad gamer, Wojak losing, Pepe winning); relatable gaming reactions
      - **Meme coins**: Classic meme characters (Doge, Pepe, Stonks Man celebrating gains); authentic meme aesthetics
      - **DAO**: Meme with governance humor, community voting scenarios
      - **Trading**: Bullish visuals, chart reactions, trading desk scenarios
      - **Infrastructure/Layer 1/Layer 2**: Tech visuals with hype elements, network diagrams with meme flair
      - **AI & Crypto**: Futuristic AI visuals with crypto elements
      - **SocialFi**: Community-focused, social interaction memes
      - **Privacy/Security**: Hacker aesthetics, anonymous vibes with humor
      - **Cross-chain/Bridges**: Connection visuals, bridging memes
      - **Prediction Markets**: Betting humor, crystal ball memes
      - **Real World Assets**: Property/asset memes, tokenization humor
      - **Any other Web3 vertical**: Adapt creatively to the specific niche
      
      🚀 **YOUR CREATIVE FREEDOM**:
      - Invent new meme formats that fit the specific project/brand
      - Mix and match styles based on what resonates with the content
      - Use trending meme formats, internet culture references, or create original concepts
      - Adapt to ANY Web3 category - the list above is not exhaustive
      - Consider the specific project's community culture and tone
      
      👤 **CHARACTER FREEDOM FOR WEB3**:
      - You are FREE to use ANY type of characters for Web3 projects:
        * Humans (diverse, relatable people)
        * Popular meme characters (Wojak, Pepe, Doge, Chad, etc.)
        * Web3-specific characters (crypto mascots, blockchain avatars)
        * Original/creative characters that fit the brand
        * Abstract or no characters at all
      - Choose whatever character type best fits the content and drives engagement
      - Web3 characters are NOT mandatory - use your judgment
      
      * Include "vibrant cartoon style", "meme aesthetic", "internet culture art" when appropriate
      * Make visuals shareable and relatable to crypto community
      * Be bold, creative, and authentically Web3
   
   ⚠️ **WEB2 PROJECTS - NO WEB3 CHARACTERS**:
      - For non-Web3/non-blockchain brands, NEVER use Web3-specific characters
      - No Wojak, Pepe, Doge, or crypto meme characters for Web2 brands
      - Use professional humans, product-focused visuals, or brand-appropriate imagery
      - Keep the aesthetic aligned with mainstream/traditional marketing
   
   C. **Clip Prompts - ALIGNED WITH SHITPOST AESTHETIC**:
      - Motion should feel dynamic, energetic, and engaging
      - Camera work: quick zooms, dynamic pans, reaction-style movements
      - If UGC style: influencer reacting authentically with crypto community vibes
      - Voiceover (if product/brand): energetic, hyped, community-focused tone
      - Examples:
        * "Quick zoom on screen showing gains, camera shakes with excitement, meme-style reaction..."
        * "Influencer's eyes widen in genuine surprise, quick cut to product, excited energy..."

7. 📊 **INFOGRAPHIC DATA REQUIREMENTS** (Web2 projects with metrics):
   
   **CRITICAL RULES FOR INFOGRAPHICS**:
   
   A. **When to use Infographics**:
      - ONLY for IMAGE-ONLY posts (posts that will NOT have video/clip generation)
      - When context contains specific metrics, data, statistics, or numerical information
      - NEVER generate infographic-style prompts for posts that will have clips/videos
   
   B. **Mandatory Data Extraction**:
      If generating image prompts for INFOGRAPHICS, DATA VISUALIZATIONS, CHARTS, or ANALYTICAL CONTENT:
      - You MUST extract ACTUAL DATA from the provided context (dvyb_context, user_prompt, inventory analysis)
      - Include specific numbers, percentages, statistics, metrics from the context
      - **NEVER use placeholder data** like "various metrics", "relevant statistics", "X%", "[number]"
      
   C. **Required Data Types to Extract**:
      - Revenue/sales figures (e.g., "$10M revenue", "50K customers")
      - Growth percentages (e.g., "40% YoY growth", "3x increase")
      - User/customer metrics (e.g., "100K active users", "5M downloads")
      - Performance stats (e.g., "99.9% uptime", "2s response time")
      - Market data (e.g., "$5B market size", "15% market share")
      - Any numerical data available in the context
   
   D. **Infographic Prompt Format**:
      "Infographic showing [specific data from context] with pie charts displaying [actual percentages], 
      bar graphs showing [actual metrics], clean data visualization, professional design..."
      
      ❌ WRONG: "Infographic showing various company metrics and growth statistics"
      ✅ CORRECT: "Infographic showing 40% revenue growth, 100K active users, pie chart with 60% retention rate, bar graph comparing Q1 ($2M) to Q4 ($5M) revenue"
   
   E. **VIDEO POSTS - NO INFOGRAPHICS**:
      - For posts at video indices (posts that will have clip prompts), NEVER generate infographic-style image prompts
      - Video starting frames should be dynamic, action-oriented, or character-focused
      - Infographics are static and don't translate well to motion/video content

Return ONLY this JSON structure (no markdown, no extra text):
{json_example}

CRITICAL REQUIREMENTS:
- MUST output ALL flags at top level: video_type, voiceover, no_characters, human_characters_only, influencer_marketing, web3
- Flags MUST match video_type:
  * product_marketing → voiceover=true, no_characters=true, influencer_marketing=false
  * ugc_influencer → voiceover=false, no_characters=false, influencer_marketing=true, human_characters_only=true
  * brand_marketing → voiceover=true, no_characters=true, influencer_marketing=false

- Image prompts: Incorporate hex color codes from brand palette

- Video clip prompts: Describe MOTION, CAMERA WORK, and embedded audio (voiceover OR character speech)
  * 🚫 **NO HEX COLOR CODES IN CLIP PROMPTS**: Clip prompts describe motion and audio, NOT colors
  * Hex color codes are ONLY for image prompts (starting frames), NEVER in clip/motion prompts
  * ❌ WRONG: "Camera pans across #131313 colored room with #e0e4f4 accents..."
  * ✅ CORRECT: "Camera pans smoothly across modern living room, revealing product on table..."

- **TEXT OVERLAY & AUDIO RULES (CRITICAL PLACEMENT)**:
  * "no text overlays" must appear BEFORE voiceover/speech text in clip prompts
  * Structure: [Scene description], no text overlays. [Voiceover/Speech at END]
  * This prevents the model from speaking "no text overlays" as part of the audio

- **VOICEOVER TONE/VOICE SPECIFICATION (MANDATORY for product/brand marketing)**:
  * When YOU DECIDE voiceover=true (product_marketing or brand_marketing):
    → Your clip prompts MUST include voiceover with voice specification
    → MUST specify voice type at START: "Voiceover in [adjective] [gender] [role] voice:"
    → Voice adjectives: professional/warm/enthusiastic/confident/authoritative/inspiring/energetic/dramatic/soothing
    → Gender: male/female/neutral
    → Role: narrator/announcer/guide/storyteller
    → Example: "Voiceover in professional male narrator voice: Discover innovation redefined"
    → Example: "Voiceover in warm confident female voice: Experience luxury like never before"
    → Example: "Voiceover in enthusiastic energetic voice: Get ready for the future"
    → Example: "Voiceover in inspiring dramatic male storyteller voice: Your journey begins now"
    → The voice specification adds the right emotional flavor and makes Veo3.1 generate appropriate audio
  * 🏢 **USE BRAND NAME IN VOICEOVER TEXT ONLY**{f" (Brand: {dvyb_context.get('accountName')})" if dvyb_context.get('accountName') else ""}:
    → ONLY in the VOICEOVER TEXT within clip prompts (not in image prompts or visual descriptions)
    → When voiceover mentions the brand, use "{dvyb_context.get('accountName', 'the brand')}" (exact brand name from BRAND CONTEXT)
    → Example: "Smooth camera zoom, no text overlays. Voiceover in professional voice: {dvyb_context.get('accountName', 'the brand')} brings your content to life."
    → DO NOT use generic placeholders like "this product", "our brand" in the voiceover text
  
- **CHARACTER SPEECH TONE SPECIFICATION (MANDATORY for ugc_influencer)**:
  * When YOU DECIDE influencer_marketing=true (ugc_influencer):
    → Your clip prompts MUST include character speaking with tone specification
    → MUST specify speaking tone: "saying in [tone] (14 words max): [speech]"
    → Tone options: conversational/excited/casual/enthusiastic/genuine/relatable/friendly/energetic/authentic/natural
    → Example: "saying in conversational excited tone (14 words max): This product changed my life"
    → Example: "saying in genuine relatable tone (14 words max): You guys need to try this"
    → Example: "saying in casual friendly tone (14 words max): I'm obsessed with this new find"
    → The tone specification makes Veo3.1 generate natural, authentic-sounding speech matching UGC style
  * 🏢 **USE BRAND NAME IN CHARACTER SPEECH ONLY**{f" (Brand: {dvyb_context.get('accountName')})" if dvyb_context.get('accountName') else ""}:
    → ONLY in the CHARACTER SPEECH TEXT within clip prompts (not in image prompts or visual descriptions)
    → When character's speech mentions the brand, use "{dvyb_context.get('accountName', 'the brand')}" (exact brand name from BRAND CONTEXT)
    → Example: "Influencer looking at camera, no text overlays. Saying in excited tone (14 words max): I've been using {dvyb_context.get('accountName', 'the brand')} and it's amazing."
    → DO NOT use generic terms like "this app", "this tool", "this product" in the character's speech

- **MODEL/CHARACTER DESCRIPTION (when has_model_image=false - AUTONOMOUS DIVERSE GENERATION)**:
  * **🎨 CHARACTER DIVERSITY MANDATE**: Create realistic, diverse influencer characters
  * Represent various ethnicities (South Asian, East Asian, African American, Hispanic/Latino, Middle Eastern, Caucasian, etc.)
  * Represent various genders (male, female, non-binary when appropriate)
  * Represent various age ranges (early 20s, mid-20s, late 20s, 30s, 40s+)
  * Consider brand context and target audience when designing the character
  * For ugc_influencer videos WITHOUT model image:
    → Clip 1 image prompt MUST include FULL character description
    → Required details: ethnicity, age range, gender, style/appearance, clothing, body type
    → Example 1: "South Asian woman, mid-20s, long dark hair, casual streetwear, slim build, friendly confident face"
    → Example 2: "African American male, early 30s, athletic build, professional attire, warm engaging demeanor"
    → Example 3: "Hispanic woman, late 20s, curly hair, athleisure wear, medium build, approachable authentic vibe"
    → Example 4: "East Asian man, early 30s, minimalist modern fashion, average build, calm thoughtful expression"
    → This description will be used to generate the character, who must appear in ALL subsequent clips
  * Clip 2+ image prompts: "Reference character from previous frame, [new context/action]"

- **LOGO DECISIONS** (MANDATORY):
  * **IMAGE-ONLY POSTS**: ALWAYS set `logo_needed: true` for ALL image-only posts (posts at indices {sorted(image_only_indices)})
  * **VIDEO CLIP FRAMES**: Decide true/false for each video clip frame based on creative judgment
  * Think like a creative director for video frames, but image posts ALWAYS need logo

- **JSON VALIDATION**: Must be valid and parseable

- **VIDEO INDICES**: Posts at indices {sorted(video_indices)} are {VIDEO_DURATION_ESTIMATE}-{CLIPS_PER_VIDEO * 10}s videos ({CLIPS_PER_VIDEO} clips each), rest are images
"""
    
    # Debug logging
    print(f"\n📊 INVENTORY ANALYSIS PASSED TO GROK:")
    print(inventory_analysis_str[:500] if inventory_analysis_str and len(inventory_analysis_str) > 500 else inventory_analysis_str if inventory_analysis_str else "(No inventory analysis)")
    print(f"\n📊 LINK ANALYSIS PASSED TO GROK:")
    print(link_analysis_str[:500] if link_analysis_str and len(link_analysis_str) > 500 else link_analysis_str if link_analysis_str else "(No link analysis)")
    print(f"\n📊 FULL SYSTEM PROMPT (first 1000 chars):")
    print(system_prompt[:1000] if len(system_prompt) > 1000 else system_prompt)
    print("=" * 80)

    try:
        # Call Grok
        from xai_sdk import Client
        from xai_sdk.chat import user, system
        
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(system_prompt))
        chat.append(user(f"Generate {number_of_posts} pieces of content for: {request.topic}"))
        
        print("🤖 Calling Grok for prompt generation...")
        response = chat.sample()
        response_text = response.content.strip()
        
        # LOG FULL GROK OUTPUT (NOT TRUNCATED)
        print("=" * 80)
        print("🤖 GROK RAW OUTPUT (FULL)")
        print("=" * 80)
        print(response_text)
        print("=" * 80)
        
        # Parse JSON response (handle markdown and code blocks)
        import json
        import re
        
        # Extract JSON from response (robust markdown handling)
        json_content = None
        
        # Method 1: Look for ```json code block
        if "```json" in response_text:
            json_start = response_text.find("```json") + 7
            json_end = response_text.find("```", json_start)
            if json_end > json_start:
                json_content = response_text[json_start:json_end].strip()
                print(f"✅ Found JSON in ```json code block")
        
        # Method 2: Look for generic ``` code block
        elif "```" in response_text:
            json_start = response_text.find("```") + 3
            json_end = response_text.find("```", json_start)
            if json_end > json_start:
                potential_json = response_text[json_start:json_end].strip()
                # Check if it starts with { (likely JSON)
                if potential_json.startswith("{"):
                    json_content = potential_json
                    print(f"✅ Found JSON in generic ``` code block")
        
        # Method 3: Response is pure JSON
        if not json_content and response_text.startswith("{") and response_text.endswith("}"):
            json_content = response_text
            print(f"✅ Response is pure JSON")
        
        # Method 4: Search for JSON object
        if not json_content:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                json_content = json_match.group(0)
                print(f"✅ Found JSON via regex search")
        
        if not json_content:
            raise ValueError("No valid JSON found in Grok response")
        
        print(f"\n📝 EXTRACTED JSON (first 500 chars):")
        print(json_content[:500])
        print("=" * 80)
        
        # Remove any remaining markdown formatting within JSON values
        # (Grok might include markdown in text fields)
        # NOTE: Don't remove underscores as they're used in JSON keys (image_prompts, platform_texts)
        json_content = re.sub(r'\*\*([^\*]+)\*\*', r'\1', json_content)  # Bold
        json_content = re.sub(r'__([^_]+)__', r'\1', json_content)  # Bold (double underscore only)
        # Skip single underscore/asterisk removal - they might be in JSON keys or valid text
        
        prompts_data = json.loads(json_content)
        
        # DEBUG: Log parsed JSON structure
        print("\n🔍 DEBUG: Parsed JSON structure:")
        print(f"  Keys: {list(prompts_data.keys())}")
        
        # Extract video type and flags from Grok
        video_type = prompts_data.get("video_type", "product_marketing")
        voiceover = prompts_data.get("voiceover", True)
        no_characters = prompts_data.get("no_characters", True)
        human_characters_only = prompts_data.get("human_characters_only", False)
        influencer_marketing = prompts_data.get("influencer_marketing", False)
        nudge = False  # OVERRIDE: Always False (nudge output quality not good yet)
        web3 = prompts_data.get("web3", False)
        
        print(f"\n🎯 GROK DECISIONS:")
        print(f"  Video Type: {video_type}")
        print(f"  Voiceover: {voiceover}")
        print(f"  No Characters: {no_characters}")
        print(f"  Human Characters Only: {human_characters_only}")
        print(f"  Influencer Marketing: {influencer_marketing}")
        print(f"  Nudge: {nudge} (OVERRIDDEN to False - feature disabled)")
        print(f"  Web3: {web3}")
        
        # Store video configuration (use the value from request)
        # CLIPS_PER_VIDEO is already defined earlier in the function
        # CLIPS_PER_VIDEO = 1 (default), CLIP_DURATION = 8s, VIDEO_DURATION = 8s
        # No need to redefine here - just use the existing variables
        
        # Extract image prompts for image-only posts
        image_only_indices = [i for i in range(number_of_posts) if i not in video_indices]
        image_prompts_dict = {}
        logo_decisions_dict = {}
        image_product_mappings_dict = {}  # NEW: Product mappings for image posts
        
        for i in image_only_indices:
            image_prompt_key = f"image_prompt_{i}"
            logo_key = f"image_{i}_logo_needed"
            product_mapping_key = f"image_{i}_product_mapping"  # NEW
            
            if image_prompt_key in prompts_data:
                image_prompts_dict[i] = prompts_data[image_prompt_key]
            if logo_key in prompts_data:
                logo_val = prompts_data[logo_key]
                logo_decisions_dict[i] = logo_val if isinstance(logo_val, bool) else str(logo_val).lower() in ['true', '1', 'yes']
            if product_mapping_key in prompts_data:  # NEW
                product_mapping_val = prompts_data[product_mapping_key]
                # Store if not null/none
                if product_mapping_val and product_mapping_val.lower() not in ['null', 'none']:
                    image_product_mappings_dict[i] = product_mapping_val
                    print(f"  📦 Image {i} product mapping: {product_mapping_val}")
            else:
                    image_product_mappings_dict[i] = None
        
        # Extract video prompts (multi-clip structure)
        video_prompts_dict = {}  # {video_idx: {clip_num: {image_prompt, clip_prompt, logo_needed, product_mapping}}}
        video_audio_prompts = {}  # {video_idx: audio_prompt}
        
        for video_idx in video_indices:
            video_prompts_dict[video_idx] = {}
            
            for clip_num in range(1, CLIPS_PER_VIDEO + 1):
                image_prompt_key = f"video_{video_idx}_clip_{clip_num}_image_prompt"
                clip_prompt_key = f"video_{video_idx}_clip_{clip_num}_prompt"
                logo_key = f"video_{video_idx}_clip_{clip_num}_logo_needed"
                product_mapping_key = f"video_{video_idx}_clip_{clip_num}_product_mapping"  # NEW
                
                clip_data = {}
                if image_prompt_key in prompts_data:
                    clip_data['image_prompt'] = prompts_data[image_prompt_key]
                if clip_prompt_key in prompts_data:
                    clip_data['clip_prompt'] = prompts_data[clip_prompt_key]
                if logo_key in prompts_data:
                    logo_val = prompts_data[logo_key]
                    clip_data['logo_needed'] = logo_val if isinstance(logo_val, bool) else str(logo_val).lower() in ['true', '1', 'yes']
                if product_mapping_key in prompts_data:  # NEW
                    product_mapping_val = prompts_data[product_mapping_key]
                    # Store if not null/none
                    if product_mapping_val and str(product_mapping_val).lower() not in ['null', 'none']:
                        clip_data['product_mapping'] = product_mapping_val
                        print(f"  📦 Video {video_idx}, Clip {clip_num} product mapping: {product_mapping_val}")
                else:
                        clip_data['product_mapping'] = None
                
                if clip_data:
                    video_prompts_dict[video_idx][clip_num] = clip_data
            
            # Extract audio prompt for this video
            audio_key = f"video_{video_idx}_audio_prompt"
            if audio_key in prompts_data:
                video_audio_prompts[video_idx] = prompts_data[audio_key]
        
        # Extract platform texts (array format)
        platform_texts = prompts_data.get("platform_texts", [])
        
        # DEBUG: Log extracted data
        print(f"\n🔍 DEBUG: After extraction:")
        print(f"  video_type: {video_type}")
        print(f"  image_only_indices: {sorted(image_only_indices)}")
        print(f"  image_prompts_dict: {len(image_prompts_dict)} items")
        print(f"  video_indices: {sorted(video_indices)}")
        print(f"  video_prompts_dict: {len(video_prompts_dict)} videos")
        for vid_idx, clips in video_prompts_dict.items():
            print(f"    Video {vid_idx}: {len(clips)} clips")
        print(f"  video_audio_prompts: {len(video_audio_prompts)} items")
        print(f"  platform_texts: {len(platform_texts)} items")
        
        # Update platform_texts with correct content_type
        for i, text_entry in enumerate(platform_texts):
            text_entry["content_type"] = "video" if i in video_indices else "image"
        
        print(f"\n✅ EXTRACTION COMPLETE:")
        print(f"  Video type: {video_type}")
        print(f"  Flags: voiceover={voiceover}, no_characters={no_characters}, influencer={influencer_marketing}")
        print(f"  Image-only posts: {len(image_prompts_dict)}")
        print(f"  Video posts: {len(video_prompts_dict)} (each with {CLIPS_PER_VIDEO} clips)")
        print(f"  Platform texts: {len(platform_texts)}")
        print(f"  Total clips to generate: {len(video_prompts_dict) * CLIPS_PER_VIDEO}")
        print("=" * 80)
        
        return {
            # Video type and flags
            "video_type": video_type,
            "voiceover": voiceover,
            "no_characters": no_characters,
            "human_characters_only": human_characters_only,
            "influencer_marketing": influencer_marketing,
            "nudge": False,  # Nudge feature disabled
            "web3": web3,
            
            # Prompts and decisions
            "image_only_prompts": image_prompts_dict,  # {index: prompt}
            "image_logo_decisions": logo_decisions_dict,  # {index: true/false}
            "image_product_mappings": image_product_mappings_dict,  # NEW: {index: "image_X" or None}
            "video_prompts": video_prompts_dict,  # {video_idx: {clip_num: {image_prompt, clip_prompt, logo_needed, product_mapping}}}
            "video_audio_prompts": video_audio_prompts,  # {video_idx: audio_prompt}
            "platform_texts": platform_texts,
            
            # Configuration
            "video_indices": sorted(video_indices),
            "image_only_indices": sorted(image_only_indices),
            "clips_per_video": CLIPS_PER_VIDEO,
            # Note: Actual clip/video duration depends on model selected per video
            # These are estimates - actual values set during generation
            "clip_duration_estimate": CLIP_DURATION_ESTIMATE,
            "video_duration_estimate": VIDEO_DURATION_ESTIMATE,
        }
        
    except Exception as e:
        logger.error(f"❌ Prompt generation failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        raise


# ============================================
# CONTENT GENERATION
# ============================================

async def generate_content(request: DvybAdhocGenerationRequest, prompts: Dict, context: Dict, generation_uuid: str):
    """Generate images and videos with FAL Nano Banana Edit and Veo3.1 (9:16 Instagram Reels)"""
    
    # Extract new prompt structure
    video_type = prompts["video_type"]
    image_only_prompts = prompts["image_only_prompts"]
    image_logo_decisions = prompts["image_logo_decisions"]
    image_product_mappings = prompts.get("image_product_mappings", {})  # NEW: Product mappings for image posts
    video_prompts = prompts["video_prompts"]  # Includes product_mapping per clip
    video_audio_prompts = prompts["video_audio_prompts"]
    video_indices = prompts["video_indices"]
    image_only_indices = prompts["image_only_indices"]
    CLIPS_PER_VIDEO = prompts["clips_per_video"]
    
    # Model selection: 60% Kling v2.6 (10s clips), 40% Veo3.1 (8s clips)
    # Selection is done per video, not per clip (all clips in a video use same model)
    import random
    
    def select_video_model():
        """Select video model with 30:70 ratio (Kling:Veo)"""
        if random.random() < 0.30:
            return {
                "name": "kling_v2.6",
                "fal_model": "fal-ai/kling-video/v2.6/pro/image-to-video",
                "clip_duration": 10,  # Kling supports 5 or 10, using 10
                "duration_param": "10",  # Kling uses string "5" or "10"
            }
        else:
            return {
                "name": "veo3.1",
                "fal_model": "fal-ai/veo3.1/fast/image-to-video",
                "clip_duration": 8,  # Veo supports 4, 6, 8, using 8
                "duration_param": "8s",  # Veo uses "4s", "6s", "8s"
            }
    
    dvyb_context = context.get('dvyb_context', {})
    account_id = context.get('account_id', 0)
    # Use randomly selected logo from logoUrl or additionalLogoUrls
    logo_url_raw = context.get('selected_logo_url')
    
    print(f"📝 Using randomly selected logo: {logo_url_raw}")
    
    # Extract S3 key from logoUrl (could be full URL or S3 key)
    logo_s3_url = None
    if logo_url_raw:
        # If it's a full S3 URL, extract just the key
        if logo_url_raw.startswith('http'):
            # Extract key from URL like: https://bucket.s3.amazonaws.com/path/to/file.png
            # Result should be: path/to/file.png
            from urllib.parse import urlparse
            parsed = urlparse(logo_url_raw)
            # Remove leading slash from path
            logo_s3_url = parsed.path.lstrip('/')
            print(f"📝 Extracted S3 key from selected logo: {logo_s3_url}")
        else:
            # Already an S3 key
            logo_s3_url = logo_url_raw
            print(f"📝 Selected logo S3 key: {logo_s3_url}")
        
        # SAFETY CHECK: Convert unsupported formats (SVG, AVIF, WEBP) to PNG
        # FAL only supports JPG, JPEG, and PNG
        logo_s3_url = convert_logo_to_png_if_needed(logo_s3_url, account_id)
    
    # Extract model image info from inventory analysis
    inventory_analysis = context.get('inventory_analysis', {})
    has_model_image = inventory_analysis.get('has_model_image', False)
    model_image_index = inventory_analysis.get('model_image_index')
    model_description = inventory_analysis.get('model_description', '')
    
    all_generated_content = {}  # {index: {"type": "image" | "video", "url": "...", ...}}
    model_usage = {
        "imageGeneration": [],  # Image-only posts
        "videoFrameGeneration": [],  # Starting frames for videos
        "videoClipGeneration": [],  # Video clips
        "audioGeneration": []  # Background music/audio
    }
    
    print("=" * 80)
    print("🎥 DVYB KLING v2.6 / VEO3.1 CONTENT GENERATION")
    print("=" * 80)
    print(f"📋 Video Type: {video_type}")
    print(f"📋 Total Posts: {len(image_only_indices) + len(video_indices)}")
    print(f"📋 Image-only posts: {sorted(image_only_indices)}")
    print(f"📋 Video posts: {sorted(video_indices)}")
    print(f"📋 Clips per video: {CLIPS_PER_VIDEO}")
    print(f"📋 Video models: 30% Kling v2.6 (10s clips), 70% Veo3.1 (8s clips)")
    print(f"📋 Video duration: {CLIPS_PER_VIDEO * 8}s - {CLIPS_PER_VIDEO * 10}s (depending on model)")
    print(f"📋 Model image detected: {has_model_image}")
    if has_model_image:
        print(f"📋 Model image index: {model_image_index}")
        print(f"📋 Model description: {model_description[:100]}...")
    print("=" * 80)
    
    # Generate presigned logo URL
    presigned_logo_url = None
    if logo_s3_url:
        try:
            presigned_logo_url = web2_s3_helper.generate_presigned_url(logo_s3_url)
            if presigned_logo_url:
                print(f"✅ Logo presigned URL: {presigned_logo_url[:80]}...")
            else:
                print(f"❌ Failed to generate presigned logo URL")
        except Exception as e:
            print(f"❌ Logo URL generation failed: {e}")
    
    if not presigned_logo_url:
        print(f"⚠️ No logo URL - Nano Banana Edit requires image_urls parameter!")
        raise ValueError("Logo URL is required for Nano Banana Edit model")
    
    # Get presigned URLs from context (already generated in pipeline)
    user_images_presigned = context.get('user_images_presigned', {})
    
    # Get presigned model image URL if available
    presigned_model_url = None
    if has_model_image and model_image_index is not None and request.user_images:
        try:
            # model_image_index is 1-based from Grok, convert to 0-based
            model_idx = model_image_index - 1
            if 0 <= model_idx < len(request.user_images):
                model_image_s3_key = request.user_images[model_idx]
                
                # Use presigned URL from context (already generated)
                if model_image_s3_key in user_images_presigned:
                    presigned_model_url = user_images_presigned[model_image_s3_key]
                    print(f"✅ Model image presigned URL (from context): {presigned_model_url[:80]}...")
                else:
                    print(f"⚠️ Model image presigned URL not found in context, generating on-demand...")
                    presigned_model_url = web2_s3_helper.generate_presigned_url(model_image_s3_key)
                    if presigned_model_url:
                        print(f"✅ Model image presigned URL (on-demand): {presigned_model_url[:80]}...")
                    else:
                        print(f"❌ Failed to generate presigned model URL")
            else:
                print(f"⚠️ Model image index {model_image_index} out of range")
        except Exception as e:
            print(f"❌ Model URL generation failed: {e}")
    
    if has_model_image and presigned_model_url:
        print(f"👤 Model image will be used for UGC-style character consistency")
    
    # Get presigned URLs for product images (from context, already generated in pipeline)
    product_presigned_urls = {}  # {"image_1": "presigned_url", "image_2": "presigned_url", ...}
    product_images_data = inventory_analysis.get('product_images', {})
    product_count = product_images_data.get('count', 0)
    product_indices = product_images_data.get('indices', [])
    
    if product_count > 0 and product_indices and request.user_images:
        print(f"\n🛍️ PRODUCT IMAGES DETECTED: {product_count} product(s)")
        for product_idx in product_indices:
            try:
                # product_idx is 1-based from Grok, convert to 0-based for list access
                user_image_idx = product_idx - 1
                if 0 <= user_image_idx < len(request.user_images):
                    product_image_s3_key = request.user_images[user_image_idx]
                    
                    # Use presigned URL from context (already generated)
                    if product_image_s3_key in user_images_presigned:
                        presigned_product_url = user_images_presigned[product_image_s3_key]
                        product_key = f"image_{product_idx}"
                        product_presigned_urls[product_key] = presigned_product_url
                        print(f"✅ Product image {product_key} presigned URL (from context): {presigned_product_url[:80]}...")
                        
                        # Log product details from inventory
                        if product_key in product_images_data:
                            product_info = product_images_data[product_key]
                            print(f"   📦 Category: {product_info.get('category', 'N/A')}")
                            print(f"   📦 Angle: {product_info.get('angle', 'N/A')}")
                            print(f"   📦 Best use: {product_info.get('best_use', 'N/A')}")
                    else:
                        print(f"⚠️ Product image presigned URL not found in context for {product_image_s3_key}")
                else:
                    print(f"⚠️ Product image index {product_idx} out of range (user_images length: {len(request.user_images)})")
            except Exception as e:
                print(f"❌ Product URL retrieval failed for image {product_idx}: {e}")
        
        print(f"✅ Retrieved {len(product_presigned_urls)} product presigned URLs from context")
    else:
        print(f"ℹ️ No product images detected in inventory analysis")
    
    # STEP 2: Generate image-only posts
    print("\n" + "=" * 80)
    print("🎨 IMAGE-ONLY POSTS (Nano Banana Edit, 1:1)")
    print("=" * 80)
    
    for idx in sorted(image_only_indices):
        prompt = image_only_prompts.get(idx)
        logo_needed = image_logo_decisions.get(idx, False)
        product_mapping = image_product_mappings.get(idx)  # NEW: e.g., "image_1", "image_2", or None
        
        if not prompt:
            print(f"⚠️ No prompt for image index {idx}, skipping")
            continue
        
        # FALLBACK: Force logo inclusion for ALL image-only posts (even if Grok forgot)
        if not logo_needed:
            print(f"⚠️ Grok forgot to set logo_needed=true for image post {idx}, forcing logo inclusion")
            logo_needed = True
        
        print(f"\n📝 Image {idx}: {prompt[:80]}...")
        print(f"🏷️ Logo needed: {logo_needed} (always true for image posts)")
        print(f"🛍️ Product mapping: {product_mapping if product_mapping else 'None'}")
        
        try:
            # Build reference images based on priority: Logo → Model → Product
            image_urls = []
            
            # 1. Logo (always included for image posts)
            if logo_needed and presigned_logo_url:
                image_urls.append(presigned_logo_url)
                print(f"  🏷️ Including logo image (mandatory for image posts)")
            
            # 2. Model (if UGC and available - GLOBAL for all UGC images)
            if video_type == "ugc_influencer" and has_model_image and presigned_model_url:
                image_urls.append(presigned_model_url)
                print(f"  👤 Including model image for UGC character consistency")
            
            # 3. Product (if mapped for this specific image - FRAME-SPECIFIC)
            if product_mapping and product_mapping in product_presigned_urls:
                image_urls.append(product_presigned_urls[product_mapping])
                print(f"  🛍️ Including product image: {product_mapping}")
                # Log product details
                if product_mapping in product_images_data:
                    product_info = product_images_data[product_mapping]
                    print(f"     📦 {product_info.get('category', 'N/A')} - {product_info.get('angle', 'N/A')}")
            elif product_mapping:
                print(f"  ⚠️ Product mapping '{product_mapping}' not found in available products")
            
            # Log reference images being used
            print(f"📸 [NANO-BANANA-EDIT] Image {idx} - Reference images ({len(image_urls)}):")
            if image_urls:
                for i, url in enumerate(image_urls):
                    print(f"   {i+1}. {url[:80]}...")
            else:
                print(f"   ⚠️ No reference images provided - logo is required!")
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            result = fal_client.subscribe(
                "fal-ai/nano-banana/edit",
                arguments={
                    "prompt": prompt,
                    "num_images": 1,
                    "output_format": "jpeg",
                    "aspect_ratio": "1:1",
                    "image_urls": image_urls,
                    "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags, double logos, extra text"
                },
                with_logs=True,
                on_queue_update=on_queue_update
            )
            
            if result and "images" in result and result["images"]:
                fal_url = result["images"][0]["url"]
                print(f"  📥 FAL URL received: {fal_url[:100]}...")
                
                # Upload to S3
                print(f"  📤 Uploading to S3...")
                s3_url = web2_s3_helper.upload_from_url(
                    url=fal_url,
                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}",
                    filename=f"image_{idx}.png"
                )
                
                if s3_url:
                    print(f"  ✅ S3 upload successful: {s3_url}")
                else:
                    print(f"  ❌ S3 upload failed")
                
                all_generated_content[idx] = {
                    "type": "image",
                    "url": s3_url
                }
                
                # Track model usage
                model_usage["imageGeneration"].append({
                    "post_index": idx,
                    "model": "fal-ai/nano-banana/edit",
                    "type": "image_post"
                })
                
                print(f"✅ Image {idx} generation complete")
                
                # Progressive update: Send this image to database immediately
                platform_text = prompts["platform_texts"][idx] if idx < len(prompts["platform_texts"]) else {}
                await update_progressive_content(
                    account_id=request.account_id,
                    generation_uuid=generation_uuid,
                    post_index=idx,
                    content_type="image",
                    content_url=s3_url,
                    platform_text=platform_text
                )
                
                # Update progress
                total_items = len(image_only_indices) + len(video_indices)
                progress = 40 + int((len(all_generated_content) / total_items) * 30)
                await update_progress_in_db(
                    request.account_id,
                    progress,
                    f"Generated image {idx}",
                    generation_uuid
                )
                
        except Exception as e:
            print(f"❌ Failed to generate image {idx}: {e}")
            logger.error(f"Image generation error for index {idx}: {e}")
    
    # STEP 3: Generate multi-clip videos with Kling v2.6 / Veo3.1 (60:40 ratio)
    print("\n" + "=" * 80)
    print(f"🎬 MULTI-CLIP VIDEO GENERATION (Kling v2.6 5% / Veo3.1 95%, 9:16)")
    print(f"⏱️  VIDEO GENERATION IN PROGRESS - This may take several minutes...")
    print(f"📊 Generating {len(video_indices)} video(s), each {CLIPS_PER_VIDEO} clip(s) × 8-10s")
    print("=" * 80)
    
    # Update progress with video generation message
    await update_progress_in_db(
        request.account_id,
        40,
        f"🎬 Generating videos... ({len(video_indices)} video(s), 8-10s clips - this may take a few minutes)",
        generation_uuid
    )
    
    # Track which model was used for each video
    video_model_selections = {}
    
    for video_idx in sorted(video_indices):
        # Select model for this video (60% Kling, 40% Veo)
        selected_model = select_video_model()
        video_model_selections[video_idx] = selected_model
        CLIP_DURATION = selected_model["clip_duration"]
        VIDEO_DURATION = CLIPS_PER_VIDEO * CLIP_DURATION
        
        print(f"\n{'='*80}")
        print(f"🎥 VIDEO AT INDEX {video_idx}")
        print(f"🎯 Selected Model: {selected_model['name'].upper()} ({CLIP_DURATION}s clips, {VIDEO_DURATION}s total)")
        print(f"{'='*80}")
        
        video_clip_data = video_prompts.get(video_idx, {})
        if not video_clip_data:
            print(f"⚠️ No clip data for video {video_idx}, skipping")
            continue
            
        # Step 3a: Generate starting frames for all clips
        print(f"\n🖼️ Generating {CLIPS_PER_VIDEO} starting frames...")
        
        frame_s3_urls = []
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            image_prompt = clip_data.get('image_prompt')
            logo_needed = clip_data.get('logo_needed', False)
            product_mapping = clip_data.get('product_mapping')  # NEW: e.g., "image_1", "image_2", or None
            
            if not image_prompt:
                print(f"⚠️ No image prompt for clip {clip_num}, skipping")
                frame_s3_urls.append(None)
                continue
            
            print(f"\n  📝 Clip {clip_num} frame: {image_prompt[:80]}...")
            print(f"  🏷️ Logo: {logo_needed}")
            print(f"  🛍️ Product mapping: {product_mapping if product_mapping else 'None'}")
            
            try:
                # Build reference images based on priority: Logo → Model → Product → Previous frame
                image_urls = []
                
                # 1. Logo (if needed for branding)
                if logo_needed and presigned_logo_url:
                    image_urls.append(presigned_logo_url)
                    print(f"  🏷️ Including logo image")
                
                # 2. Model image (if UGC video and available - GLOBAL)
                if video_type == "ugc_influencer" and has_model_image and presigned_model_url:
                    image_urls.append(presigned_model_url)
                    print(f"  👤 Including model image for character extraction")
                
                # 3. Product (if mapped for this specific frame - FRAME-SPECIFIC)
                if product_mapping and product_mapping in product_presigned_urls:
                    image_urls.append(product_presigned_urls[product_mapping])
                    print(f"  🛍️ Including product image: {product_mapping}")
                    # Log product details
                    if product_mapping in product_images_data:
                        product_info = product_images_data[product_mapping]
                        print(f"     📦 {product_info.get('category', 'N/A')} - {product_info.get('angle', 'N/A')}")
                elif product_mapping:
                    print(f"  ⚠️ Product mapping '{product_mapping}' not found in available products")
                
                # 4. Previous frame (if UGC and clip 2+, for character consistency)
                if video_type == "ugc_influencer" and clip_num > 1 and frame_s3_urls and frame_s3_urls[0]:
                    frame_1_presigned = web2_s3_helper.generate_presigned_url(frame_s3_urls[0])
                    if frame_1_presigned:
                        image_urls.append(frame_1_presigned)
                        print(f"  👤 Including frame 1 for character consistency")
                
                # Ensure at least logo is passed (Nano Banana Edit requirement)
                if not image_urls and presigned_logo_url:
                    image_urls.append(presigned_logo_url)
                
                # Log reference images being used for frame generation
                print(f"  📸 [NANO-BANANA-EDIT] Frame {clip_num} - Reference images ({len(image_urls)}):")
                if image_urls:
                    for i, url in enumerate(image_urls):
                        print(f"     {i+1}. {url[:80]}...")
                else:
                    print(f"     ⚠️ No reference images provided")
                
                def on_queue_update(update):
                    if isinstance(update, fal_client.InProgress):
                        for log in update.logs:
                            print(log["message"])
                
                result = fal_client.subscribe(
                    "fal-ai/nano-banana/edit",
                    arguments={
                        "prompt": image_prompt,
                        "num_images": 1,
                        "output_format": "jpeg",
                        "aspect_ratio": "1:1",
                        "image_urls": image_urls,
                        "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags, double logos, extra text"
                },
                with_logs=True,
                on_queue_update=on_queue_update
            )
            
                if result and "images" in result and result["images"]:
                    fal_url = result["images"][0]["url"]
                    print(f"  📥 FAL URL received: {fal_url[:100]}...")
                    
                    # Upload to S3
                    print(f"  📤 Uploading frame to S3...")
                    s3_url = web2_s3_helper.upload_from_url(
                        url=fal_url,
                        folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                        filename=f"frame_{clip_num}.png"
                    )
                    
                    if s3_url:
                        print(f"  ✅ S3 upload successful: {s3_url}")
                    else:
                        print(f"  ❌ S3 upload failed")
                    
                    frame_s3_urls.append(s3_url)
                    
                    # Track model usage for frame generation
                    model_usage["videoFrameGeneration"].append({
                        "post_index": video_idx,
                        "clip_number": clip_num,
                        "model": "fal-ai/nano-banana/edit",
                        "type": "video_frame"
                    })
                    
                    print(f"  ✅ Frame {clip_num} generation complete")
                else:
                    frame_s3_urls.append(None)
                    print(f"  ❌ Failed to generate frame {clip_num}")
                    
            except Exception as e:
                print(f"  ❌ Frame {clip_num} generation error: {e}")
                logger.error(f"Frame generation error for video {video_idx}, clip {clip_num}: {e}")
                frame_s3_urls.append(None)
        
        # Step 3b: Generate clips with selected model (Kling v2.6 or Veo3.1) WITH TIMEOUT & FALLBACK
        model_name = selected_model["name"]
        fal_model = selected_model["fal_model"]
        duration_param = selected_model["duration_param"]
        
        # Get fallback model for timeout scenarios
        fallback_model = get_fallback_model(model_name)
        
        print(f"\n🎬 Generating {CLIPS_PER_VIDEO} clips with {model_name.upper()} (fallback: {fallback_model['name'].upper()})...")
        print(f"   Primary Model: {fal_model}")
        print(f"   Fallback Model: {fallback_model['fal_model']}")
        print(f"   Timeout: {FAL_CLIP_TIMEOUT_SECONDS}s ({FAL_CLIP_TIMEOUT_SECONDS//60} minutes)")
        
        clip_s3_urls = []
        actual_models_used = []  # Track which models were actually used per clip
        
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            clip_prompt = clip_data.get('clip_prompt')
            frame_s3_url = frame_s3_urls[clip_num - 1] if clip_num <= len(frame_s3_urls) else None
            
            if not clip_prompt or not frame_s3_url:
                print(f"  ⚠️ Missing clip prompt or frame for clip {clip_num}, skipping")
                clip_s3_urls.append(None)
                actual_models_used.append(None)
                continue
            
            print(f"\n  📝 Clip {clip_num} prompt: {clip_prompt[:80]}...")
            
            try:
                # Generate presigned URL for starting frame
                print(f"  🔗 Generating presigned URL for frame: {frame_s3_url[:80]}...")
                frame_presigned_url = web2_s3_helper.generate_presigned_url(frame_s3_url)
                if not frame_presigned_url:
                    print(f"  ❌ Failed to generate presigned URL for frame")
                    clip_s3_urls.append(None)
                    actual_models_used.append(None)
                    continue
                
                print(f"  ✅ Frame presigned URL ready: {frame_presigned_url[:100]}...")
                
                # Use timeout-enabled clip generation with automatic fallback
                result, used_model_name, used_fal_model, used_clip_duration, success = generate_clip_with_timeout_and_fallback(
                    primary_model=selected_model,
                    fallback_model=fallback_model,
                    clip_prompt=clip_prompt,
                    frame_presigned_url=frame_presigned_url,
                    clip_num=clip_num,
                    video_idx=video_idx,
                    timeout_seconds=FAL_CLIP_TIMEOUT_SECONDS
                )
                
                if success and result and "video" in result:
                    fal_video_url = result["video"]["url"]
                    print(f"  📥 FAL {used_model_name} URL received: {fal_video_url[:100]}...")
                    
                    # Upload to S3
                    print(f"  📤 Uploading clip to S3...")
                    s3_url = web2_s3_helper.upload_from_url(
                        url=fal_video_url,
                        folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                        filename=f"clip_{clip_num}.mp4"
                    )
                    
                    if s3_url:
                        print(f"  ✅ S3 upload successful: {s3_url}")
                    else:
                        print(f"  ❌ S3 upload failed")
                    
                    clip_s3_urls.append(s3_url)
                    actual_models_used.append({
                        "name": used_model_name,
                        "fal_model": used_fal_model,
                        "clip_duration": used_clip_duration,
                        "was_fallback": used_model_name != model_name
                    })
                    
                    # Track model usage for clip generation (with fallback info)
                    model_usage["videoClipGeneration"].append({
                        "post_index": video_idx,
                        "clip_number": clip_num,
                        "model": used_fal_model,
                        "model_name": used_model_name,
                        "duration": f"{used_clip_duration}s",
                        "aspect_ratio": "9:16",
                        "was_fallback": used_model_name != model_name,
                        "primary_model": model_name
                    })
                    
                    print(f"  ✅ {used_model_name.upper()} clip {clip_num} generation complete (with embedded audio)")
                    if used_model_name != model_name:
                        print(f"  ℹ️ Note: Used fallback model due to primary model timeout")
                else:
                    clip_s3_urls.append(None)
                    actual_models_used.append(None)
                    print(f"  ❌ Failed to generate clip {clip_num} (both primary and fallback failed)")
                    
            except Exception as e:
                print(f"  ❌ Clip {clip_num} generation error: {e}")
                logger.error(f"Clip generation error for video {video_idx}, clip {clip_num}: {e}")
                clip_s3_urls.append(None)
                actual_models_used.append(None)
        
        # Update model_name to reflect actual model used (for UGC trimming logic)
        # Use the first successful model if any clips succeeded
        for actual_model in actual_models_used:
            if actual_model:
                model_name = actual_model["name"]
                CLIP_DURATION = actual_model["clip_duration"]
                break
        
        # Step 3c: Process clips (Demucs separation for non-influencer videos)
        print(f"\n🎵 Processing {len([c for c in clip_s3_urls if c])} clips...")
        
        valid_clips = [url for url in clip_s3_urls if url]
        
        if not valid_clips:
            print(f"❌ No valid clips to stitch for video {video_idx}")
            continue
        
        # Extract video-specific flags
        video_type = prompts["video_type"]
        influencer_marketing_flag = prompts["influencer_marketing"]
        voiceover_flag = prompts["voiceover"]
        
        # Step 3c-1: Separate voice from music for each clip (unless influencer marketing OR single clip)
        # NEW: Skip audio processing if CLIPS_PER_VIDEO == 1 (treat all single clips like UGC videos)
        if not influencer_marketing_flag and CLIPS_PER_VIDEO > 1:
            print(f"\n{'='*60}")
            print(f"🎵 VEO MODEL: Separating voice from background music for each clip")
            print(f"{'='*60}")
            
            cleaned_clips = []
            for idx, clip_url in enumerate(valid_clips):
                clip_num = idx + 1
                print(f"\n🎬 Processing clip {clip_num}/{len(valid_clips)}...")
                
                # Download clip
                with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                    presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                    response = requests.get(presigned_url)
                    temp_file.write(response.content)
                    clip_path = temp_file.name
                    print(f"  📥 Downloaded clip {clip_num}")
                
                # Separate voice from music using Demucs
                cleaned_clip_path = separate_voice_from_music_demucs(clip_path)
                if not cleaned_clip_path or cleaned_clip_path == clip_path:
                    print(f"  ⚠️ Using original clip (Demucs not available or failed)")
                    cleaned_clip_path = clip_path
                
                # Upload cleaned clip to S3
                cleaned_clip_s3_url = web2_s3_helper.upload_from_file(
                    file_path=cleaned_clip_path,
                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                    filename=f"cleaned_clip_{clip_num}.mp4"
                )
                
                # Clean up local files
                try:
                    os.remove(clip_path)
                    if cleaned_clip_path != clip_path:
                        os.remove(cleaned_clip_path)
                except:
                    pass
                
                cleaned_clips.append(cleaned_clip_s3_url)
                print(f"  ✅ Clip {clip_num} cleaned and uploaded")
            
            # Use cleaned clips for stitching
            valid_clips = cleaned_clips
            
            print(f"\n{'='*60}")
            print(f"✅ ALL CLIPS CLEANED: Background music removed from all Veo clips")
            print(f"{'='*60}\n")
        elif CLIPS_PER_VIDEO == 1:
            print(f"⚡ Single clip video: Skipping audio processing (using raw Veo3.1 output)")
            
            # NEW: For UGC/influencer single clips, trim at speech end to remove awkward silence
            # Only trim for Veo3.1 clips (Kling v2.6 doesn't need trimming)
            if influencer_marketing_flag and valid_clips and model_name == "veo3.1":
                print(f"\n🎤 UGC/Influencer single clip (Veo3.1): Applying speech-end trimming...")
                trimmed_clips = []
                for idx, clip_url in enumerate(valid_clips):
                    clip_num = idx + 1
                    print(f"\n✂️ Processing UGC clip {clip_num} for speech-end trim...")
                
                    # Download clip
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                        presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                        response = requests.get(presigned_url)
                        temp_file.write(response.content)
                        clip_path = temp_file.name
                        print(f"  📥 Downloaded clip {clip_num}")
                    
                    # Trim at speech end (only look after 5 seconds, add 300ms buffer)
                    trimmed_clip_path = trim_ugc_clip_at_speech_end(clip_path, min_search_time=5.0, buffer_ms=300)
                    
                    # Upload trimmed clip to S3
                    trimmed_s3_url = web2_s3_helper.upload_from_file(
                        file_path=trimmed_clip_path,
                        folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                        filename=f"ugc_trimmed_clip_{clip_num}.mp4"
                    )
                    
                    # Clean up local files
                    try:
                        os.remove(clip_path)
                        if trimmed_clip_path != clip_path:
                            os.remove(trimmed_clip_path)
                    except:
                        pass
                    
                    trimmed_clips.append(trimmed_s3_url)
                    print(f"  ✅ UGC clip {clip_num} trimmed and uploaded")
                
                # Use trimmed clips
                valid_clips = trimmed_clips
            elif influencer_marketing_flag and valid_clips and model_name == "kling_v2.6":
                print(f"🎤 UGC/Influencer (Kling v2.6): Skipping speech-end trimming (not needed for Kling)")
            else:
                print(f"🎤 Influencer marketing: Skipping voice separation (character speaks naturally)")
            
            # For multi-clip UGC/influencer videos, trim each clip at speech end
            # Only trim for Veo3.1 clips (Kling v2.6 doesn't need trimming)
            if model_name == "veo3.1":
                print(f"\n🎤 UGC/Influencer multi-clip (Veo3.1): Applying speech-end trimming to each clip...")
                trimmed_clips = []
                for idx, clip_url in enumerate(valid_clips):
                    clip_num = idx + 1
                    print(f"\n✂️ Processing UGC clip {clip_num}/{len(valid_clips)} for speech-end trim...")
                    
                    # Download clip
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                        presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                        response = requests.get(presigned_url)
                        temp_file.write(response.content)
                        clip_path = temp_file.name
                        print(f"  📥 Downloaded clip {clip_num}")
                    
                    # Trim at speech end (only look after 5 seconds, add 300ms buffer)
                    trimmed_clip_path = trim_ugc_clip_at_speech_end(clip_path, min_search_time=5.0, buffer_ms=300)
                    
                    # Upload trimmed clip to S3
                    trimmed_s3_url = web2_s3_helper.upload_from_file(
                        file_path=trimmed_clip_path,
                        folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                        filename=f"ugc_trimmed_clip_{clip_num}.mp4"
                    )
                    
                    # Clean up local files
                    try:
                        os.remove(clip_path)
                        if trimmed_clip_path != clip_path:
                            os.remove(trimmed_clip_path)
                    except:
                        pass
                    
                    trimmed_clips.append(trimmed_s3_url)
                    print(f"  ✅ UGC clip {clip_num} trimmed and uploaded")
                
                # Use trimmed clips
                valid_clips = trimmed_clips
            else:
                print(f"🎤 UGC/Influencer multi-clip (Kling v2.6): Skipping speech-end trimming (not needed for Kling)")
        
        # Step 3c-2: Stitch clips together (random: simple concat or crossfade)
        print(f"\n🎞️ Stitching {len(valid_clips)} clips...")

        
        if len(valid_clips) == 1:
            # Single clip, no stitching needed
            # NEW: Skip audio processing for single clips (treat like UGC videos regardless of video type)
            print(f"✅ Single clip video (no stitching or audio processing needed)")
            final_video_url = valid_clips[0]
            
            print(f"⚡ Using raw Veo3.1 output for faster generation")
            print(f"✅ Final video ready: {final_video_url}")
        
        else:
            # Multiple clips - stitch them
            try:
                # Randomly choose stitching method (50% simple, 50% crossfade)
                # Exception: Influencer marketing ALWAYS uses simple stitching
                if influencer_marketing_flag:
                    use_crossfade = False
                    print(f"🎤 Influencer Marketing: Using SIMPLE STITCHING (no crossfade)")
                else:
                    use_crossfade = random.choice([True, False])
                    stitch_method = "crossfade" if use_crossfade else "simple"
                    print(f"🎲 Stitching method: {stitch_method}")
                
                # Download clips to temporary location
                temp_clips = []
                for idx, clip_url in enumerate(valid_clips):
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                        # Download clip from S3
                        presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                        if presigned_url:
                            response = requests.get(presigned_url)
                            temp_file.write(response.content)
                            temp_clips.append(temp_file.name)
                            print(f"  📥 Downloaded clip {idx + 1}")
                
                if len(temp_clips) != len(valid_clips):
                    print(f"  ⚠️ Failed to download all clips, using first clip only")
                    final_video_url = valid_clips[0]
                else:
                    # Stitch clips using MoviePy
                    from moviepy.editor import VideoFileClip, concatenate_videoclips, CompositeVideoClip
                    
                    clips = [VideoFileClip(path) for path in temp_clips]
                    
                    if use_crossfade:
                        # Crossfade stitching (1-second overlap)
                        transition_duration = 1.0
                        final_clips = []
                        
                        for i, clip in enumerate(clips):
                            if i == 0:
                                # First clip: add fade-out at end
                                final_clips.append(clip.crossfadeout(transition_duration))
                            elif i == len(clips) - 1:
                                # Last clip: add fade-in at start
                                final_clips.append(clip.crossfadein(transition_duration).set_start(final_clips[-1].end - transition_duration))
                            else:
                                # Middle clips: both fade-in and fade-out
                                final_clips.append(
                                    clip.crossfadein(transition_duration).crossfadeout(transition_duration).set_start(final_clips[-1].end - transition_duration)
                                )
                        
                        combined = CompositeVideoClip(final_clips)
                        print(f"  ✨ Applied crossfade transitions")
                    else:
                        # Simple concatenation
                        combined = concatenate_videoclips(clips, method="compose")
                        print(f"  🔗 Simple concatenation")
                    
                    # Add fade effects (matching standalone script):
                    # - Audio fade-in at beginning (1.0s) - NO visual fade-in
                    # - Audio + visual fade-out at end (1.5s)
                    print(f"  🔊 Adding 1.0s audio fade-in at beginning...")
                    if combined.audio:
                        combined = combined.audio_fadein(1.0)
                    
                    print(f"  🎬 Adding 1.5s fade-out (audio + visual) at end...")
                    combined = combined.fadeout(1.5)  # Visual fade-out
                    if combined.audio:
                        combined = combined.audio_fadeout(1.5)  # Audio fade-out
                    
                    # Save to temporary file
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as final_temp:
                        stitched_path = final_temp.name
                    
                    combined.write_videofile(
                        stitched_path,
                        codec='libx264',
                        audio_codec='aac',
                        temp_audiofile='temp-audio.m4a',
                        remove_temp=True
                    )
                    
                    # Upload stitched video to S3 (has voiceover, no background music yet)
                    stitched_video_s3_url = web2_s3_helper.upload_from_file(
                        file_path=stitched_path,
                folder=f"dvyb/generated/{request.account_id}/{generation_uuid}",
                        filename=f"stitched_video_{video_idx}.mp4"
                    )
                    
                    print(f"  ✅ Stitched video uploaded: {stitched_video_s3_url}")
                    
                    # Cleanup
                    for clip in clips:
                        clip.close()
                    combined.close()
                    
                    for temp_path in temp_clips:
                        try:
                            os.remove(temp_path)
                        except:
                            pass
                    
                    # Step 3c-3: Process audio for stitched video (unless influencer marketing)
                    if not influencer_marketing_flag:
                        print(f"\n{'='*60}")
                        print(f"🎵 PROCESSING AUDIO FOR FINAL VIDEO")
                        print(f"{'='*60}")
                        
                        # Extract voiceover audio from stitched video
                        print(f"🎤 Extracting voiceover from stitched video...")
                        voiceover_audio_path = extract_audio_from_video(stitched_path)
                        
                        if not voiceover_audio_path:
                            print(f"  ⚠️ No voiceover audio found, using stitched video as-is")
                            final_video_url = stitched_video_s3_url
                        else:
                            # Remove audio from stitched video (create video-only)
                            print(f"🎬 Creating video-only version...")
                            video_only_path = remove_audio_from_video(stitched_path)
                            
                            if not video_only_path:
                                print(f"  ⚠️ Failed to create video-only, using stitched video")
                                final_video_url = stitched_video_s3_url
                                try:
                                    os.remove(voiceover_audio_path)
                                except:
                                    pass
                            else:
                                # Upload video-only to S3
                                video_only_s3_url = web2_s3_helper.upload_from_file(
                                    file_path=video_only_path,
                                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                                    filename=f"video_only.mp4"
                                )
                                
                                # Generate background music with Pixverse Sound Effects
                                print(f"🎵 Adding background music with Pixverse Sound Effects...")
                                audio_prompt = prompts["video_audio_prompts"].get(video_idx, "Upbeat background music")
                                
                                video_with_music_s3_url = await generate_background_music_with_pixverse(
                                    video_s3_url=video_only_s3_url,
                                    audio_prompt=audio_prompt,
                                    duration=VIDEO_DURATION,
                                    account_id=request.account_id,
                                    generation_uuid=generation_uuid,
                                    video_index=video_idx
                                )
                                
                                if not video_with_music_s3_url:
                                    print(f"  ⚠️ Failed to add background music, using stitched video")
                                    final_video_url = stitched_video_s3_url
                                    try:
                                        os.remove(video_only_path)
                                        os.remove(voiceover_audio_path)
                                    except:
                                        pass
                                else:
                                    # Track model usage for audio generation
                                    model_usage["audioGeneration"].append({
                                        "post_index": video_idx,
                                        "model": "fal-ai/pixverse/sound-effects",
                                        "audio_prompt": audio_prompt[:100],
                                        "duration": VIDEO_DURATION
                                    })
                                    
                                    # Mix voiceover with background music
                                    print(f"🎤 Mixing voiceover with background music...")
                                    final_video_url = await mix_voiceover_with_background_music(
                                        video_with_music_s3_url=video_with_music_s3_url,
                                        voiceover_audio_path=voiceover_audio_path,
                                        account_id=request.account_id,
                                        generation_uuid=generation_uuid,
                                        video_index=video_idx
                                    )
                                    
                                    if not final_video_url:
                                        print(f"  ⚠️ Failed to mix audio, using video with music only")
                                        final_video_url = video_with_music_s3_url
                                    
                                    # Clean up intermediate files
                                    try:
                                        os.remove(video_only_path)
                                    except:
                                        pass
                        
                        print(f"\n{'='*60}")
                        print(f"✅ AUDIO PROCESSING COMPLETE")
                        print(f"{'='*60}\n")
                    else:
                        print(f"🎤 Influencer marketing: Using stitched video as-is (natural speaking)")
                        final_video_url = stitched_video_s3_url
                    
                    # Clean up stitched file
                    try:
                        os.remove(stitched_path)
                    except:
                        pass
                    
            except Exception as e:
                print(f"  ❌ Stitching/audio processing failed: {e}")
                logger.error(f"Video processing error for video {video_idx}: {e}")
                import traceback
                print(f"  ❌ Full traceback: {traceback.format_exc()}")
                # Fallback to first clip
                final_video_url = valid_clips[0]
                print(f"  ⚠️ Using first clip as fallback")
        
        if final_video_url:
            all_generated_content[video_idx] = {
                "type": "video",
                "url": final_video_url,
                "clip_urls": clip_s3_urls,
                "frame_urls": frame_s3_urls,
                "duration": VIDEO_DURATION
            }
            print(f"✅ Final video for index {video_idx}: {final_video_url}")
            
            # Progressive update: Send this video to database immediately
            platform_text = prompts["platform_texts"][video_idx] if video_idx < len(prompts["platform_texts"]) else {}
            await update_progressive_content(
                account_id=request.account_id,
                generation_uuid=generation_uuid,
                post_index=video_idx,
                content_type="video",
                content_url=final_video_url,
                platform_text=platform_text
            )
            
            # Update progress
            total_items = len(image_only_indices) + len(video_indices)
            progress = 70 + int((len(all_generated_content) / total_items) * 25)
            await update_progress_in_db(
                request.account_id,
                progress,
                f"Generated video {video_idx}",
                generation_uuid
            )
        else:
            print(f"❌ Failed to generate final video for index {video_idx}")
    
    print("\n" + "=" * 80)
    print("✅ CONTENT GENERATION COMPLETE")
    print("=" * 80)
    print(f"📊 Generated {len([c for c in all_generated_content.values() if c['type'] == 'image'])} images")
    print(f"📊 Generated {len([c for c in all_generated_content.values() if c['type'] == 'video'])} videos")
    print(f"📊 Model usage tracked:")
    print(f"   - Image generation: {len(model_usage['imageGeneration'])} items")
    print(f"   - Video frame generation: {len(model_usage['videoFrameGeneration'])} items")
    print(f"   - Video clip generation: {len(model_usage['videoClipGeneration'])} items")
    print(f"   - Audio generation: {len(model_usage['audioGeneration'])} items")
    print("=" * 80)
    
    return {
        "generated_content": all_generated_content,
        "model_usage": model_usage
    }


# ============================================
# MAIN GENERATION PIPELINE
# ============================================

async def run_adhoc_generation_pipeline(job_id: str, request: DvybAdhocGenerationRequest, generation_uuid: str):
    """Run the complete ad-hoc generation pipeline"""
    
    try:
        print("\n" + "=" * 80)
        print("🚀 DVYB AD-HOC GENERATION PIPELINE STARTED")
        print("=" * 80)
        print(f"📋 Job ID: {job_id}")
        print(f"📋 UUID: {generation_uuid}")
        print(f"📋 Account ID: {request.account_id}")
        print(f"📋 Topic: {request.topic}")
        print(f"📋 Platforms: {request.platforms}")
        print(f"📋 Number of posts: {request.number_of_posts}")
        print(f"📋 User images (S3 keys): {request.user_images}")
        print("=" * 80 + "\n")
        
        # Generate presigned URLs for user images ONCE (valid for 1 hour)
        # These will be reused throughout the pipeline for Grok analysis and FAL generation
        user_images_presigned = {}  # {s3_key: presigned_url}
        if request.user_images:
            print(f"\n🔗 Generating presigned URLs for {len(request.user_images)} user images (1-hour expiration)...")
            for i, s3_key in enumerate(request.user_images, 1):
                try:
                    presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                    if presigned_url:
                        user_images_presigned[s3_key] = presigned_url
                        print(f"  ✅ Image {i}: {s3_key[:50]}... → {presigned_url[:80]}...")
                    else:
                        print(f"  ❌ Failed to generate presigned URL for image {i}: {s3_key}")
                except Exception as e:
                    print(f"  ❌ Error generating presigned URL for image {i}: {e}")
            print(f"✅ Generated {len(user_images_presigned)} presigned URLs\n")
        
        # Step 1: Gather context (10%)
        await update_progress_in_db(request.account_id, 10, "Gathering context...", generation_uuid)
        context = await gather_context(request)
        
        # Add presigned URLs to context for reuse throughout pipeline
        context["user_images_presigned"] = user_images_presigned
        
        print(f"✅ Context gathered: {list(context.keys())}")
        
        # Step 2: Analyze user images (20%)
        if request.user_images:
            await update_progress_in_db(request.account_id, 20, "Analyzing uploaded images...", generation_uuid)
            inventory_analysis = await analyze_user_images(request.user_images, context)
            context["inventory_analysis"] = inventory_analysis
        else:
            print("⏭️ Skipping inventory analysis - no user images provided")
        
        # Step 3: Analyze inspiration links (25%)
        # Check both user-provided links and selected_link from linksJson (with 10-day decay)
        links_to_analyze = []
        if request.inspiration_links:
            links_to_analyze.extend(request.inspiration_links)
        if context.get('selected_link'):
            links_to_analyze.append(context['selected_link'])
        
        if links_to_analyze:
            await update_progress_in_db(request.account_id, 25, "Analyzing inspiration links...", generation_uuid)
            link_analysis = await analyze_inspiration_links(links_to_analyze)
            context["link_analysis"] = link_analysis
        else:
            print("⏭️ Skipping link analysis - no inspiration links provided (user or linksJson)")
        
        # Step 4: Generate prompts (35%)
        await update_progress_in_db(request.account_id, 35, "Generating prompts...", generation_uuid)
        prompts = await generate_prompts_with_grok(request, context)
        
        # Step 5: Generate content (40-95%)
        await update_progress_in_db(request.account_id, 40, "Generating images and clips...", generation_uuid)
        generation_result = await generate_content(request, prompts, context, generation_uuid)
        
        # Extract generated content and model usage
        generated_content = generation_result["generated_content"]
        model_usage = generation_result["model_usage"]
        
        # Step 6: Save to database (100%)
        await update_progress_in_db(request.account_id, 98, "Saving content...", generation_uuid)
        
        # Extract URLs from generated_content dictionary
        image_urls = []
        video_urls = []
        intermediate_assets = {}
        
        for idx in sorted(generated_content.keys()):
            content = generated_content[idx]
            if content["type"] == "image":
                image_urls.append(content["url"])
            elif content["type"] == "video":
                video_urls.append(content["url"])
                # Store intermediate assets for videos
                intermediate_assets[f"video_{idx}"] = {
                    "frames": content.get("frame_urls", []),
                    "clips": content.get("clip_urls", []),
                    "finalVideo": content["url"],
                    "duration": content.get("duration", 16)
                }
        
        # Build framePrompts array (all image prompts: image-only posts + video frame prompts)
        frame_prompts = []
        
        # Add image-only prompts
        image_only_prompts = prompts.get("image_only_prompts", {})
        for idx in sorted(image_only_prompts.keys()):
            frame_prompts.append({
                "post_index": idx,
                "prompt": image_only_prompts[idx],
                "type": "image_post"
            })
        
        # Add video frame prompts (for each clip in each video)
        video_prompts = prompts.get("video_prompts", {})
        for video_idx in sorted(video_prompts.keys()):
            clips_data = video_prompts[video_idx]
            for clip_num in sorted(clips_data.keys()):
                clip_data = clips_data[clip_num]
                frame_prompts.append({
                    "post_index": video_idx,
                    "clip_number": clip_num,
                    "prompt": clip_data.get("image_prompt", ""),
                    "logo_needed": clip_data.get("logo_needed", False),
                    "type": "video_frame"
                })
        
        # Build clipPrompts array (all video clip prompts)
        clip_prompts = []
        for video_idx in sorted(video_prompts.keys()):
            clips_data = video_prompts[video_idx]
            for clip_num in sorted(clips_data.keys()):
                clip_data = clips_data[clip_num]
                clip_prompts.append({
                    "post_index": video_idx,
                    "clip_number": clip_num,
                    "prompt": clip_data.get("clip_prompt", ""),
                    "type": "clip_motion"
                })
        
        # Build comprehensive metadata (includes all prompts + intermediate assets + model usage)
        metadata = {
            "intermediateAssets": intermediate_assets,
            "modelUsage": model_usage,  # Track which models were used for analytics
            "prompts": {
                "video_type": prompts.get("video_type"),
                "flags": {
                    "voiceover": prompts.get("voiceover"),
                    "influencer_marketing": prompts.get("influencer_marketing"),
                    "no_characters": prompts.get("no_characters"),
                    "human_characters_only": prompts.get("human_characters_only"),
                    "nudge": False,  # Nudge feature disabled
                    "web3": prompts.get("web3", False)
                },
                "imagePrompts": prompts.get("image_only_prompts", {}),
                "videoPrompts": prompts.get("video_prompts", {}),
                "audioPrompts": prompts.get("video_audio_prompts", {}),  # Audio prompts in metadata
                "configuration": {
                    "clips_per_video": prompts.get("clips_per_video", 2),
                    "clip_duration": prompts.get("clip_duration", 8),
                    "video_duration": prompts.get("video_duration", 16)
                }
            },
            "inventoryAnalysis": context.get("inventory_analysis", {}),
            "linkAnalysis": context.get("link_analysis", {})
        }
        
        # Log what we're saving
        print(f"\n📊 SAVING TO DATABASE:")
        print(f"  - Frame prompts: {len(frame_prompts)} items")
        print(f"  - Clip prompts: {len(clip_prompts)} items")
        print(f"  - Image URLs: {len(image_urls)} items")
        print(f"  - Video URLs: {len(video_urls)} items")
        print(f"  - Platform texts: {len(prompts['platform_texts'])} items")
        print(f"  - Intermediate assets: {len(intermediate_assets)} videos")
        print(f"  - Model usage: {len(model_usage['imageGeneration'])} images, {len(model_usage['videoClipGeneration'])} clips, {len(model_usage['audioGeneration'])} audio tracks")
        
        # Update database with metadata
        await update_progress_in_db(
            request.account_id,
            99,
            "Saving metadata...",
            generation_uuid,
            metadata
        )
        
        await save_generated_content_to_db(
            account_id=request.account_id,
            generation_uuid=generation_uuid,
            platform_texts=prompts["platform_texts"],
            frame_prompts=frame_prompts,
            clip_prompts=clip_prompts,
            image_urls=image_urls,
            video_urls=video_urls,
        )
        
        await update_progress_in_db(request.account_id, 100, "Generation completed!", generation_uuid)
        
        print("\n" + "=" * 80)
        print("✅ DVYB AD-HOC GENERATION PIPELINE COMPLETED")
        print("=" * 80)
        print(f"📊 Generated {len(image_urls)} images")
        print(f"📊 Generated {len(video_urls)} videos")
        print(f"📊 Generated {len(prompts['platform_texts'])} platform texts")
        print("=" * 80 + "\n")
        
    except Exception as e:
        logger.error(f"❌ Generation pipeline failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        
        # Update database with error
        try:
            await update_progress_in_db(
                request.account_id,
                0,
                f"Generation failed: {str(e)}",
                generation_uuid,
                {"error": str(e)}
            )
        except:
            pass


# ============================================
# FILE UPLOAD
# ============================================

@router.post("/upload")
async def upload_user_image(
    file: UploadFile = File(...),
    accountId: int = Form(...)
):
    """Upload user image for ad-hoc generation"""
    
    try:
        from fastapi import File, Form, UploadFile
        from PIL import Image
        import tempfile
        import os
        import io
        
        # Validate file type
        allowed_types = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Invalid file type. Only PNG, JPG, JPEG, and WEBP allowed")
        
        # Read file content
        content = await file.read()
        
        # Convert WEBP to PNG if needed (similar to brand-profile screen)
        file_extension = file.filename.split('.')[-1].lower() if '.' in file.filename else 'png'
        
        if file.content_type == 'image/webp' or file_extension == 'webp':
            logger.info(f"🔄 Converting WEBP to PNG: {file.filename}")
            
            # Open WEBP image and convert to PNG
            image = Image.open(io.BytesIO(content))
            
            # Convert to RGB if needed (WEBP can have transparency)
            if image.mode in ('RGBA', 'LA'):
                # Create white background
                background = Image.new('RGB', image.size, (255, 255, 255))
                background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
                image = background
            elif image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Save as PNG in memory
            png_buffer = io.BytesIO()
            image.save(png_buffer, format='PNG')
            content = png_buffer.getvalue()
            
            # Update file extension to PNG
            file_extension = 'png'
            
            logger.info(f"✅ Converted WEBP to PNG successfully")
        
        # Generate unique filename
        unique_filename = f"{uuid.uuid4()}.{file_extension}"
        
        # Save temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}") as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Upload to S3 (returns S3 key, not presigned URL)
            s3_key = web2_s3_helper.upload_from_file(
                file_path=temp_file_path,
                folder=f"dvyb/user-uploads/{accountId}",
                filename=unique_filename
            )
            
            logger.info(f"✅ Uploaded user image to S3: {s3_key}")
            
            # Generate presigned URL for frontend preview
            presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
            
            return {
                "success": True,
                "s3_url": presigned_url,  # Send presigned URL to frontend for preview
                "s3_key": s3_key,  # Also send S3 key for database storage
                "filename": unique_filename,
            }
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        
    except Exception as e:
        logger.error(f"❌ Image upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# API ENDPOINTS
# ============================================

async def _run_pipeline_in_thread(job_id: str, request: DvybAdhocGenerationRequest, generation_uuid: str):
    """
    Wrapper to run the generation pipeline in a separate thread.
    This prevents blocking the FastAPI event loop, allowing concurrent request handling.
    """
    import asyncio
    loop = asyncio.get_event_loop()
    
    # Run the async pipeline in a thread executor to avoid blocking
    await loop.run_in_executor(
        None,  # Use default ThreadPoolExecutor
        lambda: asyncio.run(run_adhoc_generation_pipeline(job_id, request, generation_uuid))
    )


@router.post("/generate", response_model=DvybAdhocGenerationResponse)
async def generate_adhoc_content(request: DvybAdhocGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate ad-hoc content from "Generate Content Now" button
    
    This endpoint:
    1. Creates a generation job in the database
    2. Starts background generation pipeline in a separate thread
    3. Returns job_id immediately for frontend polling
    4. Can handle multiple concurrent generation requests
    
    The pipeline runs in a separate thread to prevent blocking the FastAPI event loop,
    allowing the server to handle other requests while generation is in progress.
    """
    
    try:
        # Generate unique identifiers
        job_id = str(uuid.uuid4())
        generation_uuid = str(uuid.uuid4())
        
        logger.info(f"📥 Received ad-hoc generation request for account {request.account_id}")
        logger.info(f"   Job ID: {job_id}")
        logger.info(f"   UUID: {generation_uuid}")
        logger.info(f"   Topic: {request.topic}")
        logger.info(f"   Platforms: {request.platforms}")
        logger.info(f"   Number of posts: {request.number_of_posts}")
        
        # Create generation record in database
        await create_generation_record(request.account_id, request, job_id, generation_uuid)
        logger.info(f"✅ Generation record created in database")
        
        # Start background generation in a separate thread
        # This allows FastAPI to handle other requests concurrently
        background_tasks.add_task(
            _run_pipeline_in_thread,
            job_id,
            request,
            generation_uuid
        )
        
        logger.info(f"🚀 Started ad-hoc generation job in background thread: {job_id}")
        logger.info(f"   Server is now free to handle other requests")
        
        return DvybAdhocGenerationResponse(
            success=True,
            job_id=job_id,
            uuid=generation_uuid,
            message="Generation started in background"
        )
        
    except Exception as e:
        logger.error(f"❌ Failed to start generation: {e}")
        logger.error(f"   Error type: {type(e).__name__}")
        logger.error(f"   Error details: {str(e)}")
        return DvybAdhocGenerationResponse(
            success=False,
            error=str(e)
        )


@router.get("/status/{account_id}", response_model=GenerationStatus)
async def get_generation_status(account_id: int):
    """Get the status of the latest generation for an account"""
    
    try:
        import httpx
        backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{backend_url}/api/dvyb/latest",
                params={"accountId": account_id}
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success") and result.get("data"):
                data = result["data"]
                return GenerationStatus(
                    success=True,
                    status=data.get("status", "unknown"),
                    progress_percent=data.get("progressPercent", 0),
                    progress_message=data.get("progressMessage", ""),
                    data=data
                )
            else:
                return GenerationStatus(
                    success=False,
                    status="not_found",
                    progress_percent=0,
                    progress_message="No generation found"
                )
                
    except Exception as e:
        logger.error(f"❌ Failed to get generation status: {e}")
        return GenerationStatus(
            success=False,
            status="error",
            progress_percent=0,
            progress_message=str(e)
        )

