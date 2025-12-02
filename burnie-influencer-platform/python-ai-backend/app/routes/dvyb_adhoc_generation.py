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

logger = logging.getLogger(__name__)
router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Track active generation jobs
active_jobs: Dict[str, Any] = {}


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class DvybAdhocGenerationRequest(BaseModel):
    """Request for ad-hoc content generation"""
    account_id: int
    topic: str
    platforms: List[str]  # e.g., ["instagram", "twitter", "linkedin", "tiktok"]
    number_of_posts: int  # 1-4
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
    """Gather all context for generation"""
    import httpx
    
    context = {
        "topic": request.topic,
        "platforms": request.platforms,
        "number_of_posts": request.number_of_posts,
        "user_prompt": request.user_prompt,
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
                context["dvyb_context"] = result["data"]
                logger.info(f"✅ Fetched dvyb_context for account {request.account_id}")
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
        
        # Get presigned URLs from context (already generated in pipeline)
        user_images_presigned = context.get('user_images_presigned', {})
        
        presigned_urls = []
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
        
        print(f"🔗 Using {len(presigned_urls)} presigned URLs for Grok analysis")
        
        # Call Grok inventory analysis with brand context
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
        import json
        
        # Build comprehensive product/inspiration/model classification prompt
        analysis_prompt = f"""You are an expert visual analyst for {brand_info['account_name']}.

BRAND CONTEXT:
- Business: {brand_info['account_name']}
- Industry: {brand_info['industry']}
- Website: {brand_info['website']}
- What we do: {brand_info['business_overview'][:500] if brand_info['business_overview'] else 'N/A'}
- Target Customers: {brand_info['customer_demographics'][:300] if brand_info['customer_demographics'] else 'N/A'}
- Popular Products/Services: {brand_info['popular_products'][:300] if isinstance(brand_info['popular_products'], str) else str(brand_info['popular_products'])[:300] if brand_info['popular_products'] else 'N/A'}
- Brand Voice: {brand_info['brand_voice'][:200] if brand_info['brand_voice'] else 'N/A'}

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
  }}
}}

🔍 IMPORTANT NOTES:
- If NO products detected, set product_images.count = 0, indices = []
- If NO inspiration detected, set inspiration_images.count = 0, indices = []
- If NO model detected, set model_image.has_model = false, index = null
- Be VERY specific in categorization - consider brand context
- Product images should match the brand's actual offerings
- Inspiration images are style guides ONLY

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
# LINK ANALYSIS (OPENAI WEB SEARCH)
# ============================================

async def analyze_inspiration_links(links: List[str]) -> Dict:
    """Analyze inspiration links with OpenAI web search"""
    if not links or all(not link.strip() for link in links):
        return {}
    
    try:
        print("=" * 80)
        print("🔗 OPENAI LINK ANALYSIS")
        print("=" * 80)
        
        # Filter out empty links
        valid_links = [link.strip() for link in links if link.strip()]
        print(f"🔗 Number of links: {len(valid_links)}")
        print(f"🔗 Links: {valid_links}")
        
        from openai import OpenAI
        import os
        
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        
        # Extract domains for filtering
        import urllib.parse
        domains = []
        for link in valid_links:
            try:
                parsed = urllib.parse.urlparse(link)
                domain = parsed.netloc or parsed.path
                if domain:
                    domains.append(domain)
            except:
                continue
        
        print(f"🌐 Domains extracted: {domains}")
        
        # Use Responses API with web search
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a web content analyzer. Extract and summarize key information from the specified websites."
                },
                {
                    "role": "user",
                    "content": f"""Please gather comprehensive information from these websites:
{', '.join(valid_links)}

Extract and summarize:
1. Key features, products, or services
2. Important metrics, statistics, or data points
3. Design styles, aesthetics, or visual elements
4. Content strategies or messaging approaches
5. Any unique or notable characteristics

Return a concise summary of insights from all links combined."""
                }
            ],
            extra_body={
                "web_search_options": {
                    "domain_filter": domains if domains else None
                }
            }
        )
        
        link_analysis_text = response.choices[0].message.content
        
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

async def generate_prompts_with_grok(request: DvybAdhocGenerationRequest, context: Dict) -> Dict:
    """Generate image and clip prompts with Grok - Multi-clip Veo3.1 support"""
    
    # Calculate number of images and clips
    number_of_posts = request.number_of_posts
    num_clips = math.ceil(number_of_posts / 2)
    num_images = number_of_posts - num_clips
    
    # Video configuration (Veo3.1 specific)
    # Configurable: 1 clip = 8s, 2 clips = 16s, 3 clips = 24s, etc.
    CLIPS_PER_VIDEO = request.clips_per_video if hasattr(request, 'clips_per_video') and request.clips_per_video else 1
    CLIP_DURATION = 8  # Veo3.1 only supports 8-second clips
    VIDEO_DURATION = CLIPS_PER_VIDEO * CLIP_DURATION
    
    print(f"⚙️ Video Configuration: {CLIPS_PER_VIDEO} clip(s) per video, {CLIP_DURATION}s per clip, {VIDEO_DURATION}s total duration")
    
    print("=" * 80)
    print("🤖 GROK PROMPT GENERATION (VEO3.1 MULTI-CLIP MODE)")
    print("=" * 80)
    print(f"📝 Topic: {request.topic}")
    print(f"📝 Platforms: {request.platforms}")
    print(f"📝 Number of posts: {number_of_posts}")
    print(f"📝 Number of video posts: {num_clips}")
    print(f"📝 Number of image posts: {num_images}")
    print(f"🎬 Clips per video: {CLIPS_PER_VIDEO}")
    print(f"⏱️  Clip duration: {CLIP_DURATION}s")
    print(f"🎥 Total video duration: {VIDEO_DURATION}s")
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
    inventory_analysis_str = "None"
    if inventory_analysis:
        import json
        inventory_analysis_str = json.dumps(inventory_analysis, indent=2)
    
    # Format link analysis for Grok
    link_analysis_str = "None"
    if link_analysis:
        link_analysis_str = link_analysis.get("summary", "None")
    
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
        color_str = ", ".join(colors) if colors else "N/A"
    
    # Build multi-clip video prompts structure (Veo3.1 specific - Instagram Reels 9:16)
    video_prompts_instruction = ""
    video_examples = []
    
    if num_clips > 0:
        # For each video index, generate CLIPS_PER_VIDEO sets of prompts
        for video_idx in sorted(video_indices):
            for clip_num in range(1, CLIPS_PER_VIDEO + 1):
                video_examples.append(f'''  "video_{video_idx}_clip_{clip_num}_image_prompt": "Detailed visual description for starting frame of clip {clip_num} in video {video_idx} (9:16 vertical aspect ratio, Instagram Reels style)...",
  "video_{video_idx}_clip_{clip_num}_product_mapping": "image_1" or "image_2" or null (map to product image if needed for this specific frame),
  "video_{video_idx}_clip_{clip_num}_prompt": "Cinematic {CLIP_DURATION}-second video description with smooth motion. MUST end with: no text overlays. No background music. [Include voiceover OR character speech based on video_type]",
  "video_{video_idx}_clip_{clip_num}_logo_needed": true or false''')
            
            # Single audio prompt per video (added after stitching)
            video_examples.append(f'''  "video_{video_idx}_audio_prompt": "Create instrumental background music for {VIDEO_DURATION}-second video. Focus ONLY on music composition, NO sound effects."''')
        
        video_prompts_section = ",\n  ".join(video_examples)
        
        video_prompts_instruction = f"""

3. VIDEO TYPE SELECTION & GENERATION ({num_clips} videos, each {VIDEO_DURATION}s):
   
   🎯 CRITICAL: INTELLIGENT VIDEO TYPE & FLAGS DECISION
   
   **DECISION HIERARCHY**:
   1. **If USER INSTRUCTIONS explicitly request a specific video type** (e.g., "make a UGC video", "product showcase", "influencer style", "brand story"):
      → HONOR the user's explicit request
   2. **Otherwise, autonomously decide** based on:
      → Inventory analysis (what products/items are shown)
      → Brand context (industry, voice, audience)
      → Content purpose (educational, promotional, storytelling)
   
   Based on this analysis, YOU MUST DECIDE the optimal video type AND set corresponding flags:
   
   A. **PRODUCT MARKETING VIDEO** (Pure product showcase):
      - Use when: Clear product focus in inventory/context, no human element needed, OR user explicitly requests product showcase
      - FLAGS TO OUTPUT:
        * "video_type": "product_marketing"
        * "voiceover": true (embedded voiceover narration in Veo3.1 clip)
        * "no_characters": true (NO human characters in video)
        * "human_characters_only": false
        * "influencer_marketing": false
      - Style: Professional product showcase, feature highlights
      - Voiceover Style: Professional, authoritative narrator voice (e.g., "In a professional male narrator voice:", "In a confident female voice:", "In an enthusiastic energetic voice:")
      - Example clip prompt: "Sleek smartphone rotating on marble surface, camera slowly zooming to reveal elegant design features, professional studio lighting. Voiceover in professional male narrator voice: Introducing the future of mobile technology, no text overlays. No background music."
      - CRITICAL: Specify voice type/tone at the START of voiceover instructions (professional/enthusiastic/warm/authoritative, male/female)
      - 🚨 VOICEOVER TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-) in voiceover text. Use commas, periods, or natural pauses instead. Em-dashes interfere with TTS generation and create awkward pauses.
   
   B. **UGC INFLUENCER VIDEO** (Authentic influencer style):
      - Use when: Lifestyle/personal use context, human engagement needed, relatable content, OR user explicitly requests UGC/influencer style video
      - FLAGS TO OUTPUT:
        * "video_type": "ugc_influencer"
        * "voiceover": false (character speaks on camera, embedded in Veo3.1 clip)
        * "no_characters": false
        * "human_characters_only": true
        * "influencer_marketing": true
      - Speech limit: 12-14 words MAX per {CLIP_DURATION}s clip
      - Style: Authentic, conversational, relatable UGC content
      
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
      - Example (with model): "Reference model looking at camera in modern kitchen, natural lighting, genuine smile, saying in conversational excited tone (14 words max): This product completely changed my morning routine and I'm absolutely obsessed with it, no text overlays. No background music."
      - Example (no model, diverse): "South Asian woman, 25-30 years old, long dark hair, casual modern style, looking at camera in bright bedroom, saying in enthusiastic genuine tone (14 words max): You guys have to try this, it's seriously a game changer for me, no text overlays. No background music."
   
   C. **BRAND MARKETING VIDEO** (Brand storytelling):
      - Use when: Abstract brand values, emotional storytelling, no specific product, OR user explicitly requests brand storytelling/brand-focused video
      - FLAGS TO OUTPUT:
        * "video_type": "brand_marketing"
        * "voiceover": true (embedded voiceover narration in Veo3.1 clip)
        * "no_characters": true (NO human characters)
        * "human_characters_only": false
        * "influencer_marketing": false
      - Style: Artistic, emotional, brand-focused
      - Voiceover Style: Inspirational, cinematic narrator voice (specify: warm/inspiring/dramatic, male/female)
      - Example clip prompt: "Abstract artistic representation of innovation, flowing light patterns, dynamic camera movement revealing brand essence, cinematic atmosphere. Voiceover in warm inspiring male voice: Your journey to excellence starts here, no text overlays. No background music."
      - CRITICAL: Specify voice type/tone for emotional impact (inspiring/dramatic/warm/confident, male/female)
      - 🚨 VOICEOVER TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-) in voiceover text. Use commas, periods, or natural pauses instead. Em-dashes interfere with TTS generation and create awkward pauses.
   
   🎯 NUDGE MESSAGE DECISION (Engagement Call-to-Action):
   Decide whether to include subtle engagement nudge in the LAST clip of each video:
   
   NUDGE APPROPRIATE FOR:
   - UGC influencer videos (authentic "follow for more" vibe)
   - Brand awareness campaigns
   - Community building content
   - Content asking for user engagement
   - Viral/trending content styles
   
   NUDGE NOT APPROPRIATE FOR:
   - Pure product showcases (professional, sales-focused)
   - B2B enterprise content
   - Formal announcements
   - Educational/tutorial content
   
   IF YOU DECIDE NUDGE=true:
   - Add nudge instructions to LAST clip prompt ONLY (clip 2 for 2-clip videos)
   - Format: "...existing clip description... In final 2-3 seconds, subtle text overlay appears at bottom-center with smooth fade-in animation: 'Follow for more [topic]' or 'Like for daily tips' or 'Subscribe for updates', typography in brand colors, clean minimal design, professional aesthetic"
   - Keep nudge subtle, on-brand, non-intrusive
   - Position: bottom-center or lower-third
   - Style: Elegant fade-in animation, matches video aesthetic
   - Text should feel natural, not salesy
   
   YOU MUST OUTPUT (at the top level):
   "video_type": "product_marketing" OR "ugc_influencer" OR "brand_marketing",
   "voiceover": true OR false,
   "no_characters": true OR false,
   "human_characters_only": true OR false,
   "influencer_marketing": true OR false,
   "nudge": true OR false,
   "web3": false (always false for DVYB)
   
   📋 MULTI-CLIP VIDEO STRUCTURE (Veo3.1 with 9:16 aspect ratio):
   Video indices: {sorted(video_indices)}
   Each video requires:
   - {CLIPS_PER_VIDEO} image prompts (starting frames for each {CLIP_DURATION}s clip)
   - {CLIPS_PER_VIDEO} clip prompts (motion/animation descriptions)
   - {CLIPS_PER_VIDEO} logo decisions (true/false for each frame)
   - 1 audio prompt (background music for entire {VIDEO_DURATION}s video)
   
   Format: "video_{{index}}_clip_{{num}}_image_prompt", "video_{{index}}_clip_{{num}}_prompt", etc.
   
   🎬 VEO3.1 SPECIFIC REQUIREMENTS:
   - Aspect ratio: 9:16 (Instagram Reels/TikTok vertical - MANDATORY)
   - Clip duration: {CLIP_DURATION}s (FIXED - Veo3.1 only supports 8s clips)
   - Embedded audio: YES (voiceover OR character speech based on video_type)
   - ALL clip prompts MUST end with: "no text overlays. No background music." **UNLESS** nudge=true, then LAST clip should INCLUDE nudge text overlay instructions
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
  - Include detailed descriptions with color palette integration
  - Keep compositions simple and focused (avoid clutter)
  - **CRITICAL COLOR USAGE**: Use brand colors ONLY in physical objects/surfaces (clothing, walls, furniture, props, decor) - NEVER in lighting, glows, or effects
  - Example: "wearing {color_palette.get('primary')} colored shirt" ✅ NOT "using {color_palette.get('primary')} for lighting accents" ❌
  - **MANDATORY ENDING**: End with: ", colors used only in physical objects and surfaces not in lighting or glow effects, use provided hex colour codes for generating images but no hex colour code as text in image anywhere"
  - Remember: These frames will become video starting points, so they must be high-quality and on-brand
  
  🛍️ **PRODUCT MAPPING FOR CLIP FRAMES** (SAME AS IMAGE POSTS):
  - For EACH clip image prompt, decide if a product should be referenced
  - Output `"video_X_clip_Y_product_mapping": "image_Z"` or `null`
  - When product is mapped: Use **"reference product"** keyword in the clip image prompt
  
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
   
   **🚨 CRITICAL: USE REFERENCE KEYWORDS** (MANDATORY for consistency):
   - **"reference logo"** → When logo_needed is true
   - **"reference model"** → When has_model_image is true (UGC videos)
   - **"reference product"** → When product_mapping is set (not null)
   - These keywords ensure the same elements appear consistently across multiple images
   - Examples:
     * "reference logo prominently displayed on packaging"
     * "reference model holding product with genuine smile"
     * "reference product centered on marble surface, front angle view"
   
   **DETAILED & SPECIFIC PROMPTS** (MANDATORY):
   - Generate detailed and comprehensive image prompts (100-120 words per prompt)
   - Include specific details about: composition, lighting, camera angle, mood, atmosphere
   - Specify subject placement, background elements, foreground elements, and spatial relationships
   - Describe textures, materials, and surface qualities
   - Include professional photography/cinematography terms for better quality
   
   **SIMPLICITY & FOCUS** (AVOID CLUTTERED IMAGES):
   - Focus on ONE central subject or concept per image
   - Avoid prompts with too many characters (max 1-2 people in frame)
   - Avoid prompts with too many objects competing for attention
   - Use clean, uncluttered backgrounds
   - Create visual hierarchy - make it clear what the eye should focus on first
   - Simple, powerful imagery is better than busy, complex scenes
   - Think "magazine cover" quality - clean, professional, focused
   
  **COLOR PALETTE INTEGRATION** (MANDATORY - NATURAL PHYSICAL OBJECTS ONLY):
  - You MUST use the brand's color palette in every image prompt
  - Primary color: {color_palette.get('primary', 'N/A')}
  - Secondary color: {color_palette.get('secondary', 'N/A')}
  - Accent color: {color_palette.get('accent', 'N/A')}
  
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
  
  - **CORRECT USAGE EXAMPLES**:
    * "wearing {color_palette.get('primary', '#000000')} colored shirt"
    * "{color_palette.get('primary', '#000000')} painted wall in background"
    * "{color_palette.get('accent', '#000000')} colored cushions on sofa"
    * "product packaging in {color_palette.get('primary', '#000000')}"
    * "{color_palette.get('secondary', '#000000')} colored furniture"
  
  - **INCORRECT USAGE (AVOID)**:
    * ❌ "using {color_palette.get('primary', '#000000')} for lighting accents"
    * ❌ "using {color_palette.get('accent', '#000000')} for screen glow"
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
   - UGC videos: Casual, relatable captions
   - Product videos: Feature-focused, benefit-driven
   - Brand videos: Emotional, value-driven
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
        image_prompt_examples.append(f'"image_{i}_product_mapping": "image_1" or "image_2" or null (map to product image if needed)')
        image_prompt_examples.append(f'"image_{i}_logo_needed": true or false')
    
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
  "voiceover": true or false,
  "no_characters": true or false,
  "human_characters_only": true or false,
  "influencer_marketing": true or false,
  "nudge": true or false,
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

🎯 YOUR AUTONOMOUS DECISION-MAKING RESPONSIBILITY:

1. **DECIDE VIDEO TYPE** (product_marketing / ugc_influencer / brand_marketing)
   - Analyze brand context, inventory, user instructions, and link analysis
   - Set appropriate flags based on your decision

2. **GENERATE PROMPTS BASED ON YOUR FLAGS**:
   - If YOU set voiceover=true → Include "Voiceover in [tone] [gender] voice:" in ALL clip prompts
   - If YOU set influencer_marketing=true → Include "saying in [tone] (14 words max): [speech]" in ALL clip prompts
   - If YOU set no_characters=true → NO human characters in prompts
   - If YOU set nudge=true → Add nudge overlay to LAST clip prompt

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
   - Clip Prompt Examples:
     * ✅ CORRECT: "video_0_clip_1_prompt": "Camera zooms in. Voiceover in professional voice: {dvyb_context.get('accountName', 'the brand')} revolutionizes content creation, no text overlays."
     * ✅ CORRECT: "video_0_clip_1_prompt": "Influencer smiling. saying in excited tone: I love using {dvyb_context.get('accountName', 'the brand')} for my posts"
     * ❌ WRONG: "video_0_clip_1_prompt": "Voiceover: This product revolutionizes content creation"

5. **MODEL/CHARACTER CONSISTENCY**:
   - If has_model_image=true → Use "reference model" in ALL image prompts (UGC only)
   - If has_model_image=false → Specify full character details in Clip 1, use "reference character" in Clip 2+

YOUR FLAGS CONTROL THE PROMPTS YOU GENERATE. Be consistent and intentional.

BRAND CONTEXT:
- Business: {dvyb_context.get('accountName', 'N/A')}
- Industry: {dvyb_context.get('industry', 'N/A')}
- Brand Voice: {dvyb_context.get('brandVoice', 'N/A')}
- Brand Colors: {color_str}
- Target Audience: {dvyb_context.get('customerDemographics', 'N/A')[:500] if dvyb_context.get('customerDemographics') else 'N/A'}
- Business Overview: {dvyb_context.get('businessOverview', 'N/A')[:500] if dvyb_context.get('businessOverview') else 'N/A'}
- Popular Products/Services: {str(dvyb_context.get('popularProducts', 'N/A'))[:300] if dvyb_context.get('popularProducts') else 'N/A'}

USER INSTRUCTIONS: {request.user_prompt if request.user_prompt else 'None'}

UPLOADED IMAGES ANALYSIS (Classified into 3 categories):
{inventory_analysis_str}

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
{link_analysis_str}

GENERATE:

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
   
   **PRODUCT MAPPING DECISION (for each image prompt)**:
   - If inventory_analysis contains product_images:
     * Review available products: category, features, angle, showcases, best_use
     * Decide if this specific image should feature a product
     * If YES: Output `"product_mapping": "image_X"` (matching the product image index)
     * If NO: Output `"product_mapping": null`
     * **IN YOUR PROMPT**: If product is mapped, use **"reference product"** keyword
   
   **MAPPING EXAMPLES**:
   ```
   Available: image_1 (headphones front view), image_2 (headphones side view)
   
   Image Post 0 (product showcase):
   {{
     "image_0_product_mapping": "image_1",
     "image_prompt_0": "Reference product (wireless headphones) centered on minimalist marble surface, front angle view...",
     "image_0_logo_needed": true
   }}
   
   Image Post 1 (lifestyle, no product):
   {{
     "image_1_product_mapping": null,
     "image_prompt_1": "Modern coffee shop interior with natural lighting, cozy atmosphere...",
     "image_1_logo_needed": true
   }}
   ```
   
   **NOTE**: ALWAYS set `logo_needed: true` for ALL image-only posts
   
   **REFERENCE KEYWORDS** (use in prompts when applicable):
   - **"reference product"** → When product_mapping is set (not null)
   - **"reference logo"** → When logo_needed is true
   - **"reference model"** → When has_model_image is true (for UGC videos)
   
   **COMBINED EXAMPLE**:
   ```
   {{
     "image_prompt_0": "Reference model in modern coffee shop, natural lighting, holding reference product (smartphone) with reference logo visible on screen, warm atmosphere, shallow depth of field",
     "image_0_product_mapping": "image_2",
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

Return ONLY this JSON structure (no markdown, no extra text):
{json_example}

CRITICAL REQUIREMENTS:
- MUST output ALL flags at top level: video_type, voiceover, no_characters, human_characters_only, influencer_marketing, nudge, web3
- Flags MUST match video_type:
  * product_marketing → voiceover=true, no_characters=true, influencer_marketing=false
  * ugc_influencer → voiceover=false, no_characters=false, influencer_marketing=true, human_characters_only=true
  * brand_marketing → voiceover=true, no_characters=true, influencer_marketing=false

- Image prompts: Incorporate hex color codes from brand palette

- Video clip prompts: Describe MOTION, CAMERA WORK, and embedded audio (voiceover OR character speech)

- **TEXT OVERLAY RULES**:
  * If nudge=false: ALL clip prompts MUST end with "no text overlays. No background music."
  * If nudge=true: LAST clip prompt should INCLUDE nudge text overlay instructions, DO NOT add "no text overlays" to the last clip
  * First clips (when nudge=true): Still end with "no text overlays. No background music."

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
  * 🏢 **USE BRAND NAME IN VOICEOVER TEXT ONLY** (Brand: {dvyb_context.get('accountName', 'N/A')}):
    → ONLY in the VOICEOVER TEXT within clip prompts (not in image prompts or visual descriptions)
    → When voiceover mentions the brand, use "{dvyb_context.get('accountName', 'N/A')}" (exact brand name from accountName)
    → Example: "Smooth camera zoom. Voiceover in professional voice: {dvyb_context.get('accountName', 'N/A')} brings your content to life, no text overlays."
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
  * 🏢 **USE BRAND NAME IN CHARACTER SPEECH ONLY** (Brand: {dvyb_context.get('accountName', 'N/A')}):
    → ONLY in the CHARACTER SPEECH TEXT within clip prompts (not in image prompts or visual descriptions)
    → When character's speech mentions the brand, use "{dvyb_context.get('accountName', 'N/A')}" (exact brand name from accountName)
    → Example: "Influencer looking at camera. saying in excited tone (14 words max): I've been using {dvyb_context.get('accountName', 'N/A')} and it's amazing, no text overlays."
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

- **NUDGE MESSAGE (if nudge=true)**:
  * Add nudge text overlay instructions to LAST clip prompt ONLY
  * Format: "In final 2-3 seconds, text overlay bottom-center: 'Follow for more [topic]' with fade-in animation, brand colors"
  * Keep subtle and on-brand

- **LOGO DECISIONS** (MANDATORY):
  * **IMAGE-ONLY POSTS**: ALWAYS set `logo_needed: true` for ALL image-only posts (posts at indices {sorted(image_only_indices)})
  * **VIDEO CLIP FRAMES**: Decide true/false for each video clip frame based on creative judgment
  * Think like a creative director for video frames, but image posts ALWAYS need logo

- **JSON VALIDATION**: Must be valid and parseable

- **VIDEO INDICES**: Posts at indices {sorted(video_indices)} are {VIDEO_DURATION}s videos ({CLIPS_PER_VIDEO} clips each), rest are images
"""
    
    # Debug logging
    print(f"\n📊 INVENTORY ANALYSIS PASSED TO GROK:")
    print(inventory_analysis_str[:500] if len(inventory_analysis_str) > 500 else inventory_analysis_str)
    print(f"\n📊 LINK ANALYSIS PASSED TO GROK:")
    print(link_analysis_str[:500] if len(link_analysis_str) > 500 else link_analysis_str)
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
        nudge = prompts_data.get("nudge", False)
        web3 = prompts_data.get("web3", False)
        
        print(f"\n🎯 GROK DECISIONS:")
        print(f"  Video Type: {video_type}")
        print(f"  Voiceover: {voiceover}")
        print(f"  No Characters: {no_characters}")
        print(f"  Human Characters Only: {human_characters_only}")
        print(f"  Influencer Marketing: {influencer_marketing}")
        print(f"  Nudge: {nudge}")
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
        print(f"  Flags: voiceover={voiceover}, no_characters={no_characters}, influencer={influencer_marketing}, nudge={nudge}")
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
            "nudge": nudge,
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
            "clip_duration": CLIP_DURATION,
            "video_duration": VIDEO_DURATION,
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
    CLIP_DURATION = prompts["clip_duration"]
    VIDEO_DURATION = prompts["video_duration"]
    
    dvyb_context = context.get('dvyb_context', {})
    logo_url_raw = dvyb_context.get('logoUrl')
    
    print(f"📝 Raw logo URL from dvyb_context: {logo_url_raw}")
    
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
            print(f"📝 Extracted S3 key from logo URL: {logo_s3_url}")
        else:
            # Already an S3 key
            logo_s3_url = logo_url_raw
            print(f"📝 Logo S3 key: {logo_s3_url}")
    
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
    print("🎥 DVYB VEO3.1 CONTENT GENERATION")
    print("=" * 80)
    print(f"📋 Video Type: {video_type}")
    print(f"📋 Total Posts: {len(image_only_indices) + len(video_indices)}")
    print(f"📋 Image-only posts: {sorted(image_only_indices)}")
    print(f"📋 Video posts: {sorted(video_indices)}")
    print(f"📋 Clips per video: {CLIPS_PER_VIDEO}")
    print(f"📋 Video duration: {VIDEO_DURATION}s ({CLIPS_PER_VIDEO} × {CLIP_DURATION}s)")
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
    
    # STEP 3: Generate multi-clip videos with Veo3.1
    print("\n" + "=" * 80)
    print(f"🎬 MULTI-CLIP VIDEO GENERATION (Veo3.1, 9:16)")
    print(f"⏱️  VIDEO GENERATION IN PROGRESS - This may take several minutes...")
    print(f"📊 Generating {len(video_indices)} video(s), each {CLIPS_PER_VIDEO} clip(s) × {CLIP_DURATION}s = {VIDEO_DURATION}s")
    print("=" * 80)
    
    # Update progress with video generation message
    await update_progress_in_db(
        request.account_id,
        40,
        f"🎬 Generating videos... ({len(video_indices)} video(s), {VIDEO_DURATION}s each - this may take a few minutes)",
        generation_uuid
    )
    
    
    for video_idx in sorted(video_indices):
        print(f"\n{'='*80}")
        print(f"🎥 VIDEO AT INDEX {video_idx} ({VIDEO_DURATION}s)")
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
        
        # Step 3b: Generate clips with Veo3.1
        print(f"\n🎬 Generating {CLIPS_PER_VIDEO} clips with Veo3.1...")
        
        clip_s3_urls = []
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            clip_prompt = clip_data.get('clip_prompt')
            frame_s3_url = frame_s3_urls[clip_num - 1] if clip_num <= len(frame_s3_urls) else None
            
            if not clip_prompt or not frame_s3_url:
                print(f"  ⚠️ Missing clip prompt or frame for clip {clip_num}, skipping")
                clip_s3_urls.append(None)
                continue
            
            print(f"\n  📝 Clip {clip_num} prompt: {clip_prompt[:80]}...")
            
            try:
                # Generate presigned URL for starting frame
                print(f"  🔗 Generating presigned URL for frame: {frame_s3_url[:80]}...")
                frame_presigned_url = web2_s3_helper.generate_presigned_url(frame_s3_url)
                if not frame_presigned_url:
                    print(f"  ❌ Failed to generate presigned URL for frame")
                    clip_s3_urls.append(None)
                    continue
                
                print(f"  ✅ Frame presigned URL ready: {frame_presigned_url[:100]}...")
                print(f"  🎬 [VEO3.1-FAST] Generating clip with 9:16 aspect ratio, 8s duration, embedded audio")
                
                # Generate clip with Veo3.1
                def on_queue_update_veo(update):
                    if isinstance(update, fal_client.InProgress):
                        for log in update.logs:
                            print(log["message"])
                
                result = fal_client.subscribe(
                    "fal-ai/veo3.1/fast/image-to-video",
                    arguments={
                        "prompt": clip_prompt,
                        "image_url": frame_presigned_url,
                        "aspect_ratio": "9:16",  # Instagram Reels vertical format
                        "duration": "8s",        # Fixed for Veo3.1
                        "generate_audio": True,   # Embedded voiceover/speech
                        "resolution": "720p"
                    },
                    with_logs=True,
                    on_queue_update=on_queue_update_veo
                )
                
                if result and "video" in result:
                    fal_video_url = result["video"]["url"]
                    print(f"  📥 FAL Veo3.1 URL received: {fal_video_url[:100]}...")
                    
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
                    
                    # Track model usage for clip generation
                    model_usage["videoClipGeneration"].append({
                        "post_index": video_idx,
                        "clip_number": clip_num,
                        "model": "fal-ai/veo3.1/fast/image-to-video",
                        "duration": "8s",
                        "aspect_ratio": "9:16"
                    })
                    
                    print(f"  ✅ Veo3.1 clip {clip_num} generation complete (with embedded audio)")
                else:
                    clip_s3_urls.append(None)
                    print(f"  ❌ Failed to generate clip {clip_num}")
                    
            except Exception as e:
                print(f"  ❌ Clip {clip_num} generation error: {e}")
                logger.error(f"Clip generation error for video {video_idx}, clip {clip_num}: {e}")
                clip_s3_urls.append(None)
        
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
        
        # Step 3c-1: Separate voice from music for each clip (unless influencer marketing)
        if not influencer_marketing_flag:
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
        else:
            print(f"🎤 Influencer marketing: Skipping voice separation (character speaks naturally)")
        
        # Step 3c-2: Stitch clips together (random: simple concat or crossfade)
        print(f"\n🎞️ Stitching {len(valid_clips)} clips...")

        
        if len(valid_clips) == 1:
            # Single clip, no stitching needed - but still process audio
            print(f"✅ Single clip video (no stitching needed)")
            single_clip_s3_url = valid_clips[0]
            
            # Process audio for single clip (unless influencer marketing)
            if not influencer_marketing_flag:
                print(f"\n{'='*60}")
                print(f"🎵 PROCESSING AUDIO FOR SINGLE CLIP VIDEO")
                print(f"{'='*60}")
                
                # Download clip
                with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                    presigned_url = web2_s3_helper.generate_presigned_url(single_clip_s3_url)
                    response = requests.get(presigned_url)
                    temp_file.write(response.content)
                    clip_path = temp_file.name
                
                try:
                    # Extract voiceover audio
                    voiceover_audio_path = extract_audio_from_video(clip_path)
                    
                    if not voiceover_audio_path:
                        print(f"  ⚠️ No voiceover audio found, using clip as-is")
                        final_video_url = single_clip_s3_url
                    else:
                        # Remove audio from clip (create video-only)
                        video_only_path = remove_audio_from_video(clip_path)
                        
                        if not video_only_path:
                            print(f"  ⚠️ Failed to create video-only, using original clip")
                            final_video_url = single_clip_s3_url
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
                            
                            # Generate background music with Pixverse
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
                                print(f"  ⚠️ Failed to add background music, using original clip")
                                final_video_url = single_clip_s3_url
                            else:
                                # Track model usage for audio generation
                                model_usage["audioGeneration"].append({
                                    "post_index": video_idx,
                                    "model": "fal-ai/pixverse/sound-effects",
                                    "audio_prompt": audio_prompt[:100],
                                    "duration": VIDEO_DURATION
                                })
                                
                                # Mix voiceover with background music
                                final_video_url = await mix_voiceover_with_background_music(
                                    video_with_music_s3_url=video_with_music_s3_url,
                                    voiceover_audio_path=voiceover_audio_path,
                                    account_id=request.account_id,
                                    generation_uuid=generation_uuid,
                                    video_index=video_idx
                                )
                                
                                if not final_video_url:
                                    print(f"  ⚠️ Failed to mix audio, using video with music")
                                    final_video_url = video_with_music_s3_url
                            
                            # Clean up
                            try:
                                os.remove(video_only_path)
                            except:
                                pass
                    
                    print(f"\n{'='*60}")
                    print(f"✅ AUDIO PROCESSING COMPLETE FOR SINGLE CLIP")
                    print(f"{'='*60}\n")
                    
                except Exception as e:
                    print(f"  ⚠️ Audio processing failed: {e}")
                    final_video_url = single_clip_s3_url
                
                # Clean up downloaded clip
                try:
                    os.remove(clip_path)
                except:
                    pass
            else:
                print(f"🎤 Influencer marketing: Using single clip as-is (natural speaking)")
                final_video_url = single_clip_s3_url
        
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
        if request.inspiration_links:
            await update_progress_in_db(request.account_id, 25, "Analyzing inspiration links...", generation_uuid)
            link_analysis = await analyze_inspiration_links(request.inspiration_links)
            context["link_analysis"] = link_analysis
        else:
            print("⏭️ Skipping link analysis - no inspiration links provided")
        
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
                    "nudge": prompts.get("nudge"),
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

