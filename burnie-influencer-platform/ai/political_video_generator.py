"""
Political Video Generator
Generates 45-60 second scroll-stopping political videos from PDF/TXT/DOC research documents

Usage:
    python political_video_generator.py --input /path/to/research.pdf --output /path/to/output.mp4
    python political_video_generator.py -i research.pdf -o video.mp4 --influencer  # With influencer mode

Requirements:
    pip install pypdf python-docx fal-client moviepy pillow numpy xai-sdk boto3 python-dotenv librosa soundfile demucs openai
"""

import os
import sys
import json
import argparse
import re
import uuid
import tempfile
import asyncio
import subprocess
import base64
import time
import glob
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
import fal_client
import numpy as np
from PIL import Image
from moviepy.editor import (
    VideoFileClip, AudioFileClip, ImageClip, 
    concatenate_videoclips, concatenate_audioclips, 
    CompositeVideoClip, CompositeAudioClip
)
import boto3
from botocore.exceptions import ClientError
import requests

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

# Configure fal_client with API key (same as video_generation.py)
fal_api_key = os.getenv("FAL_API_KEY")

# OpenAI API key for Whisper transcription (influencer mode voice alignment)
openai_api_key = os.getenv("OPENAI_API_KEY")

# ElevenLabs API key for direct API calls (allows custom voices)
elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")

# AWS credentials for S3 uploads (presigned URLs for images/videos)
# Note: Using S3_BUCKET_NAME (not AWS_S3_BUCKET_NAME) to match settings.py
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_s3_bucket_name = os.getenv("S3_BUCKET_NAME")  # Matches settings.py env variable name
aws_region = os.getenv("AWS_REGION", "ap-south-1")
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Import dynamic video generator for IMAGE_ONLY clips
from dynamic_video_generator import (
    EffectEngine, EFFECTS_CATALOG, ASPECT_RATIOS,
    extract_region, region_to_center_and_size
)

# Import video caption functionality
from video_captions import VideoCaptionStyler, COMBINATIONS, find_combination

# Import article_to_video for research clips
from article_to_video import (
    search_articles,
    capture_multiple_folds,
    suggest_highlight_text,
    create_highlight_video
)


# ============================================
# S3 HELPER FOR PRESIGNED URLs
# ============================================

class S3Helper:
    """Helper class for uploading files to S3 and getting presigned URLs"""
    
    def __init__(self, project_name: str = "political_video"):
        """Initialize S3 helper with AWS credentials from python-ai-backend/.env"""
        # Use module-level variables loaded from python-ai-backend/.env
        self.bucket_name = aws_s3_bucket_name
        self.region = aws_region
        self.project_name = project_name
        
        # Validate bucket name
        if not self.bucket_name:
            print(f"  ⚠️ Warning: S3_BUCKET_NAME not set in python-ai-backend/.env")
        
        # Validate AWS credentials
        if not aws_access_key_id or not aws_secret_access_key:
            print(f"  ⚠️ Warning: AWS credentials not set in python-ai-backend/.env")
        
        # Initialize S3 client
        try:
            self.s3_client = boto3.client(
                's3',
                region_name=self.region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
            
            # Test connection by checking if bucket exists
            if self.bucket_name:
                try:
                    self.s3_client.head_bucket(Bucket=self.bucket_name)
                    print(f"  ✅ S3 connection verified for bucket: {self.bucket_name}")
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                    if error_code == '404':
                        print(f"  ❌ S3 bucket not found: {self.bucket_name}")
                        print(f"     Please check S3_BUCKET_NAME in python-ai-backend/.env")
                    elif error_code == '403':
                        print(f"  ❌ Access denied to S3 bucket: {self.bucket_name}")
                        print(f"     Please check AWS credentials in python-ai-backend/.env")
                    else:
                        print(f"  ⚠️ S3 bucket check failed: {e}")
        except Exception as e:
            print(f"  ⚠️ Failed to initialize S3 client: {e}")
            self.s3_client = None
        
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    def upload_file(self, local_path: str, content_type: str = "image", file_type: str = "img") -> Optional[str]:
        """
        Upload file to S3 and get presigned URL.
        Matches the pattern from web2_s3_helper.upload_from_file + generate_presigned_url
        
        Args:
            local_path: Local file path to upload
            content_type: "image" or "video" or "audio"
            file_type: Folder organization identifier
            
        Returns:
            Presigned URL string or None if failed
        """
        if not self.s3_client:
            print(f"  ❌ S3 client not initialized")
            return None
        
        if not self.bucket_name:
            print(f"  ❌ S3 bucket name not set")
            return None
        
        if not os.path.exists(local_path):
            print(f"  ❌ File not found: {local_path}")
            return None
        
        try:
            # Generate S3 key (similar to web2_s3_helper pattern)
            file_extension = os.path.splitext(local_path)[1]
            unique_id = uuid.uuid4().hex[:8]
            s3_key = f"{self.project_name}/{self.timestamp}/{file_type}/{unique_id}{file_extension}"
            
            # Determine content type based on file extension (matching web2_s3_helper)
            ext = file_extension.lower()
            content_type_map = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.mp4': 'video/mp4',
                '.mov': 'video/quicktime',
                '.avi': 'video/x-msvideo',
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg'
            }
            mime_type = content_type_map.get(ext, 'application/octet-stream')
            
            # Upload file (using upload_file like web2_s3_helper, not upload_fileobj)
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={
                    'ContentType': mime_type,
                    'CacheControl': 'max-age=31536000'
                }
            )
            
            # Generate presigned URL (matching web2_s3_helper pattern)
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key
                },
                ExpiresIn=3600  # 1 hour
            )
            
            print(f"  ✅ Uploaded to S3: {s3_key}")
            return presigned_url
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == 'NoSuchBucket':
                print(f"  ❌ S3 bucket does not exist: {self.bucket_name}")
                print(f"     Please check S3_BUCKET_NAME in python-ai-backend/.env")
            else:
                print(f"  ❌ S3 upload failed: {e}")
            return None
        except Exception as e:
            print(f"  ❌ S3 upload error: {e}")
            import traceback
            print(traceback.format_exc())
            return None

# ============================================
# CONFIGURATION
# ============================================

OUTPUT_ASPECT_RATIO = "9:16"
OUTPUT_SIZE = (1080, 1920)
FPS = 30

# AI Video clip settings
AI_VIDEO_DEFAULT_DURATION = 6  # Changed from 4 to 6 seconds
AI_VIDEO_INFLUENCER_COUNT = 3  # Up to 3 AI video clips when influencer mode is ON (some may failover to IMAGE_ONLY)
AI_VIDEO_REGULAR_COUNT = 2     # Max 2 AI video clips when influencer mode is OFF

# ElevenLabs voice IDs (multilingual voices that support Indic languages)
ELEVENLABS_VOICE_ID_MALE = "RpiHVNPKGBg7UmgmrKrN"  # Default male voice
ELEVENLABS_VOICE_ID_FEMALE = "Lw21wLjWqPPaL3TcYWek"  # Female voice

# Default language
DEFAULT_LANGUAGE = "hi"

# Supported Indic languages (ISO 639-1 codes)
SUPPORTED_LANGUAGES = {
    "hi": "Hindi",
    "pa": "Punjabi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "or": "Odia",
    "en": "English",
}

# ============================================
# TEXT EXTRACTION
# ============================================

def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF file"""
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        
        with open(file_path, 'rb') as f:
            pdf_reader = PdfReader(f)
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        print(f"❌ PDF extraction error: {e}")
        return ""


def extract_text_from_docx(file_path: str) -> str:
    """Extract text from DOCX file"""
    try:
        from docx import Document
        doc = Document(file_path)
        text = "\n".join([para.text for para in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"❌ DOCX extraction error: {e}")
        return ""


def extract_text_from_txt(file_path: str) -> str:
    """Extract text from TXT file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception as e:
        print(f"❌ TXT extraction error: {e}")
        return ""


def extract_text_from_file(file_path: str) -> str:
    """Extract text from PDF, DOCX, or TXT file"""
    ext = file_path.lower().split('.')[-1]
    
    print(f"\n📄 Extracting text from: {file_path}")
    
    if ext == 'pdf':
        text = extract_text_from_pdf(file_path)
    elif ext in ['docx', 'doc']:
        text = extract_text_from_docx(file_path)
    elif ext == 'txt':
        text = extract_text_from_txt(file_path)
    else:
        print(f"❌ Unsupported file type: {ext}")
        return ""
    
    print(f"✅ Extracted {len(text)} characters")
    return text


# ============================================
# S3 HELPER (Simplified - uses temp files)
# ============================================

class LocalFileHelper:
    """Helper for managing temporary files (replaces S3 for local CLI usage)"""
    
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.temp_files = []
    
    def save_file(self, content: bytes, filename: str) -> str:
        """Save file and return local path"""
        file_path = os.path.join(self.output_dir, filename)
        with open(file_path, 'wb') as f:
            f.write(content)
        self.temp_files.append(file_path)
        return file_path
    
    def get_file_url(self, file_path: str) -> str:
        """For local files, return file:// URL or path"""
        return f"file://{os.path.abspath(file_path)}"
    
    def cleanup(self):
        """Clean up temporary files"""
        for f in self.temp_files:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except:
                pass


# ============================================
# EFFECTS CATALOG FOR GROK
# ============================================

def get_effects_catalog_for_grok() -> str:
    """Format effects catalog for Grok prompt"""
    catalog_text = """
AVAILABLE EFFECTS FOR IMAGE_ONLY CLIPS:

Each IMAGE_ONLY clip can have effects applied to create dynamic movement. 
For each IMAGE_ONLY clip, you must specify which effects to apply with their parameters.

Effects use BOUNDING BOX coordinates:
- left_pct: Left edge (0-100, percentage from left)
- top_pct: Top edge (0-100, percentage from top)  
- right_pct: Right edge (0-100, percentage from left)
- bottom_pct: Bottom edge (0-100, percentage from top)

"""
    
    # Only include relevant effects for political videos
    # NOTE: highlight_spotlight, brightness_pulse, and fade_vignette are excluded - not desired for image-based clips
    # All effects listed here are implemented in EffectEngine from dynamic_video_generator.py
    relevant_effects = [
        # Basic movement effects
        "zoom_in", "zoom_out", "pan", "ken_burns",
        # Emphasis effects
        "shake", "zoom_pulse", "zoom_whip",
        # Visual style effects
        "flash", "letterbox", "color_shift", "contrast_boost",
        # Advanced effects from dynamic_video_generator (all implemented in EffectEngine)
        "focus_rack", "reveal_wipe", "blur_transition", "saturation_pulse",
        "radial_blur", "bounce_zoom", "tilt", "glitch", "rgb_split",
        "film_grain", "light_leak", "color_pop", "split_screen",
        "mirror", "pixelate", "wave_distortion"
    ]
    
    for effect_id in relevant_effects:
        if effect_id in EFFECTS_CATALOG:
            effect_info = EFFECTS_CATALOG[effect_id]
            catalog_text += f"**{effect_id}** - {effect_info['name']}\n"
            catalog_text += f"  {effect_info['description']}\n\n"
    
    return catalog_text


# ============================================
# GROK INTEGRATION
# ============================================

def get_political_video_system_prompt(language_code: str = "hi", language_name: str = "Hindi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, current_date: Optional[str] = None, min_duration: int = 60, max_duration: int = 90, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, reference_image_mode: bool = False, include_research: bool = False, research_type: str = "news") -> str:
    """Get the system prompt for video generation (Stage 1 - Plan generation). Works for any context: political, business, technology, healthcare, finance, education, etc.
    
    Args:
        reference_image_mode: If True, a reference influencer image is provided from CLI.
                            All influencer prompts should use "reference influencer" terminology.
        include_research: If True, generate research_integration with searchable claims for mini-clips.
        research_type: Type of research source to search - "news", "blog", "report", "twitter".
    """
    
    # Determine AI video rules based on influencer mode
    if influencer_mode:
        gender_text = influencer_gender or "male"
        gender_pronoun = "she" if gender_text == "female" else "he"
        gender_descriptor = "woman" if gender_text == "female" else "man"
        
        # Build reference image instructions based on whether CLI reference image is provided
        if reference_image_mode:
            reference_image_instructions = """### 🚨 REFERENCE IMAGE MODE (CRITICAL - CLI REFERENCE IMAGE PROVIDED):
* **A reference influencer image is provided from CLI** - use "reference influencer" terminology in ALL AI_VIDEO prompts
* **ALL AI_VIDEO clips (including the FIRST one) must use "reference influencer"** - do NOT provide full character description
* **CRITICAL**: ALWAYS include: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* **IMPORTANT**: Even for Clip 1 (first AI_VIDEO clip), use "reference influencer" instead of describing appearance
* **FORMAT**: All starting_image_prompt fields should look like: "Reference influencer [expression], [position], [lighting], [background]. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"
"""
        else:
            reference_image_instructions = f"""For the **FIRST AI_VIDEO clip**, provide FULL character description + POSITION with **CINEMATIC VISUAL STYLE**:
* **CRITICAL**: The influencer must be a {gender_descriptor} (gender: {gender_text})
* **CONTEXT-AWARE APPEARANCE**: Adapt influencer appearance to match the input context:
  * If input mentions India/Indian context → Indian ethnicity, age (25-35), {gender_descriptor}, appropriate attire
  * If input mentions USA/American context → American ethnicity, age (25-35), {gender_descriptor}, professional attire
  * If other countries → Appropriate ethnicity and attire for that country
"""
        
        ai_video_rules = f"""## 🎥 AI VIDEO CLIP RULES - INFLUENCER MODE (VERY STRICT)

⚠️ **AI Video influencer clips should be ~30% of total video duration** (some may fail and be replaced with IMAGE_ONLY)

### 🚨 CLIP 1 MUST BE AI_VIDEO (MANDATORY):
* **Clip 0**: SILENT_IMAGE (visual hook with text overlay)
* **Clip 1**: **MUST be AI_VIDEO** - the first verbal clip MUST feature the influencer speaking
* **WHY**: Clip 1 is the first clip with voice - having the influencer introduce the topic creates immediate connection with viewers
* This is NON-NEGOTIABLE - Clip 1 is ALWAYS an AI_VIDEO influencer clip

### Influencer Clip Requirements:
* AI_VIDEO clips should account for **~30% of total video duration** (NOT a hardcoded number)
* **🚨 MINIMUM 3 AI_VIDEO CLIPS**: Even if percentage calculation gives less, always have at least 3 AI influencer clips
* **ALL AI_VIDEO clips**: MUST be **exactly 8 seconds long** each
* **Calculate number of AI clips based on video duration**:
  * 45-second video → 30% = 13.5 seconds → 2 AI clips by percentage, BUT **use 3 minimum** (24 seconds)
  * 60-second video → 30% = 18 seconds → 2 AI clips by percentage, BUT **use 3 minimum** (24 seconds)
  * 90-second video → 30% = 27 seconds → 3-4 AI clips (24-32 seconds)
* **MINIMUM RULE**: If 30% calculation results in less than 3 clips, round UP to 3 clips

### Selecting Which Clips Should Be AI_VIDEO:
* **Clip 1 is ALWAYS AI_VIDEO** (first verbal clip after silent Clip 0)
* Choose the **most emotionally impactful moments** for remaining AI clips
* **MINIMUM 3 AI clips** required (including Clip 1)
* Ideal for: introductions, revelations, accusations, shocking facts, call-to-action
* Distribute remaining influencer clips **throughout the video** (after Clip 1)
* Example distribution for 60s video (3 AI clips minimum): Clip 1 (intro), Clip 5 (mid-point), Clip 9 (climax)
* Example distribution for 90s video (3-4 AI clips): Clip 1 (intro), Clip 6 (revelation), Clip 11 (peak), Clip 15 (conclusion)

### Influencer Visual Composition (CONSISTENT FORMAT REQUIRED):
* **🚨 CRITICAL: CONSISTENT LAYOUT FORMAT ACROSS ALL AI INFLUENCER CLIPS**:
  * **YOU decide which layout format to use** - you have full autonomy to choose
  * **BUT you MUST use the SAME format for ALL AI influencer clips** in the video
  * **DO NOT MIX formats** - if you choose split layout, ALL influencer clips use split; if you choose overlay, ALL use overlay
* **LAYOUT FORMAT OPTIONS** - Choose ONE format and use it for ALL AI influencer clips:
  * **OPTION A - SPLIT LAYOUT**: Influencer on one side (left/right), context on the other side
    * Examples: "Influencer on left, context on right" OR "Influencer on right, context on left"
    * **If using split layout**: Use the SAME split format (e.g., always influencer on right) for ALL AI clips
    * DO NOT mix "influencer on left" with "influencer on right" in the same video
  * **OPTION B - OVERLAY LAYOUT**: Influencer in a corner with full context behind
    * Examples: "bottom-right corner overlay", "bottom-left corner overlay", "lower portion overlay"
    * **If using overlay layout**: Use the SAME corner position (e.g., always bottom-right) for ALL AI clips
    * DO NOT mix "bottom-right" with "bottom-left" or "lower portion" in the same video
  * **OPTION C - LOWER PORTION**: Influencer in lower 30-50% with context visuals above
    * This counts as an overlay style - maintain consistent positioning
* **WRONG (INCONSISTENT - DO NOT DO THIS)**:
  * ❌ Clip 1: "Split composition, influencer on LEFT"
  * ❌ Clip 2: "Corner overlay, bottom-RIGHT"
  * ❌ Clip 3: "Split composition, influencer on RIGHT"
  * (This mixes split and overlay AND mixes left/right positions)
* **CORRECT (CONSISTENT)**:
  * ✅ Clip 1: "Split composition, influencer on RIGHT, context on left"
  * ✅ Clip 2: "Split composition, influencer on RIGHT, context on left"
  * ✅ Clip 3: "Split composition, influencer on RIGHT, context on left"
  * (All clips use the SAME format: split with influencer on right)
* **CORRECT (CONSISTENT - OVERLAY OPTION)**:
  * ✅ Clip 1: "Full context, influencer in BOTTOM-RIGHT corner overlay"
  * ✅ Clip 2: "Full context, influencer in BOTTOM-RIGHT corner overlay"
  * ✅ Clip 3: "Full context, influencer in BOTTOM-RIGHT corner overlay"
  * (All clips use the SAME format: corner overlay at bottom-right)
* **DECISION AUTONOMY**: You are **FULLY AUTONOMOUS** to decide which format works best for the content - **NO BIAS** towards any particular format:
  * **Split layout**: Good for side-by-side comparison, data visualization, formal presentation
  * **Overlay layout**: Good for reaction videos, dramatic reveals, immersive storytelling  
  * **Lower portion**: Good for news presenter style, explainer content
  * **Your choice is COMPLETELY FREE** - choose based on what makes the video most engaging for THIS content
  * **DO NOT default to any one format** - analyze the content and pick the best fit
  * Once you choose, **MAINTAIN that choice for ALL AI influencer clips** throughout the video
* **STYLE**: Think "news presenter", "TikTok explainer", "reaction video"
* **EXPRESSION**: Influencer must show emotion matching the voiceover text
* **SPECIFY POSITION**: In each prompt, clearly state WHERE the influencer appears (but keep it consistent!)

### Influencer Prompt Format (CINEMATIC & EXCITING):
{reference_image_instructions}
* **🎬 CINEMATIC REQUIREMENTS FOR INFLUENCER SHOTS**:
  * **LIGHTING**: Use dramatic lighting (Rembrandt, three-point with color accents, neon rim light)
  * **EXPRESSION**: Specific emotional expressions (knowing smirk, raised eyebrow, intense gaze) - NOT just "confident"
  * **CAMERA DIRECTION**: Always include "speaking directly to camera" or "direct eye contact with camera"
  * **DEPTH**: "shallow depth of field with bokeh background"
  * **COLOR**: Modern cinematic palette - VARY colors across clips (cool tones, warm naturals, greyscale, pastels)
  * **BACKGROUND**: Prefer clean/minimal backgrounds (plain colors, soft textures, white, grey) - avoid cluttered scenes
* **🚨 CRITICAL: INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip:
  * **MANDATORY**: In ALL formats (split, overlay, lower portion, corner), the influencer MUST be speaking directly to camera
  * **NEVER describe generic expressions** - add character and energy
  * Always include "speaking directly to camera" or "direct eye contact with camera" in EVERY influencer prompt
* **CRITICAL: NO DUPLICATE HUMANS**: The influencer must appear ONLY ONCE in the entire image.

**CINEMATIC EXAMPLE 1 (Split composition - Cool Tones):**
"Cinematic split composition, LEFT SIDE: dreamy bokeh shot of [context visual] with dramatic cool blue lighting and soft focus, RIGHT SIDE: 28-year-old Indian {gender_descriptor} medium close-up with confident knowing expression, speaking directly to camera, dramatic Rembrandt lighting with soft key light and subtle rim accent on hair, wearing elegant professional attire, shallow depth of field with clean minimal background, rich cinematic color grading with neutral tones, direct eye contact with camera, shot on 50mm f/1.4. The influencer appears ONLY on the right side. no text overlays."

**CINEMATIC EXAMPLE 2 (Lower portion - Warm Natural):**
"Clean soft cream upper portion showing [context visual] with minimal props and warm natural lighting. LOWER PORTION: 28-year-old Indian {gender_descriptor} medium shot with engaged expression, speaking directly to camera, dramatic three-point lighting with warm key and cool fill, professional attire, shallow depth of field against clean backdrop, direct eye contact with camera, natural skin tones with soft background, shot on 35mm lens. The influencer appears ONLY in the lower portion. no text overlays."

**CINEMATIC EXAMPLE 3 (Corner overlay - Moody Greyscale):**
"Full frame high contrast greyscale visual of [context] with dramatic chiaroscuro lighting, minimal props, clean composition. BOTTOM-RIGHT CORNER (30%): 28-year-old Indian {gender_descriptor} as overlay, intimate close-up with knowing smirk and raised eyebrow, speaking directly to camera, dramatic side lighting creating beautiful shadows on face, subtle cool rim light accent, professional attire, direct eye contact with camera, desaturated color palette with rich shadows. The influencer appears ONLY in the bottom-right corner. no text overlays."

For **SUBSEQUENT AI_VIDEO clips** (2nd, 3rd, etc.), use "reference influencer" + SAME POSITION FORMAT + **CINEMATIC STYLE**:
* **MAINTAIN the SAME position format** as the first AI_VIDEO clip for visual consistency!
* **MAINTAIN CINEMATIC QUALITY**: Each subsequent clip must have same level of cinematic detail
* **MAINTAIN CINEMATIC QUALITY**: Keep consistent lighting style but VARY color palettes across clips
* **CRITICAL**: Include this at the end: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* **CRITICAL: NO DUPLICATE HUMANS**: The reference influencer must appear ONLY ONCE in the entire image.

**CINEMATIC Starting Image Prompt Examples** (for image generation - USE CONSISTENT colors from chosen theme):
* **Split Example (COOL_MINIMAL theme)**: "Cinematic split composition, LEFT SIDE: [new context visual] with soft diffused cool lighting, clean white background with subtle grey gradient, minimal props, RIGHT SIDE: Reference influencer medium close-up with [specific emotion matching voiceover - e.g., furrowed brow of concern, wide eyes of revelation], speaking directly to camera, same appearance, soft key light with subtle ice blue rim accent, shallow depth of field, direct eye contact with camera, cool desaturated color grading, shot on 50mm. Reference influencer appears ONLY on the right side. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."
* **Lower Portion Example (SOFT_LAVENDER theme)**: "Clean minimal upper portion showing [context visual] with soft lavender backdrop and minimal props, atmospheric depth with subtle periwinkle haze. LOWER PORTION: Reference influencer as presenter, speaking directly to camera, same appearance, [specific expression], soft diffused lighting with lavender-grey tones, direct eye contact with camera, cool skin tones with cream highlights. Reference influencer appears ONLY in the lower portion. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."
* **Corner Example (MOODY_GREYSCALE theme)**: "Full frame high contrast [context visual] with dramatic chiaroscuro lighting, charcoal grey background, minimal props, clean composition. BOTTOM-RIGHT CORNER (30%): Reference influencer intimate close-up with [specific expression], speaking directly to camera, same appearance, dramatic side lighting with cool white rim accent, direct eye contact with camera, silver highlights with deep shadows. Reference influencer appears ONLY in the bottom-right corner. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays."
* **Clip Prompt** (for video generation - includes voiceover instructions):
  * Example: "Reference influencer speaking to camera on the left side, same appearance. Infographic showing [new context] on the right side. Speaking in {language_name} language (ISO code: {language_code}). Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code}). NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."

### What the Influencer is SAYING (AI_VIDEO CLIPS ONLY):
* **ONLY FOR AI_VIDEO INFLUENCER CLIPS** - This word limit does NOT apply to regular IMAGE_ONLY voiceovers
* For AI_VIDEO clips, the influencer SPEAKS the voiceover text on camera
* The voiceover text becomes what the influencer says (lip-synced)
* **CRITICAL**: When including voiceover text in image/video prompts, use PLAIN TEXT only - no square bracket expressions
* **MANDATORY WORD LIMIT FOR AI_VIDEO CLIPS ONLY**: For ALL influencer clips (8 seconds each), the voiceover text that the influencer speaks MUST be **between 14-16 words** (minimum 14 words, maximum 16 words)
* This ensures the text fits within the 8-second clip duration without being trimmed or clipped, and provides enough content for natural speech
* **NOTE**: Regular IMAGE_ONLY clips can have voiceover text of any length - this limit ONLY applies to AI_VIDEO influencer clips
* Count words in the actual speech text
* Example: If voiceover is "20 दिसंबर को हाईजैक हुआ", that is 4 words - this is TOO SHORT, must be 14-16 words for 8-second clips
* Example prompt ending: "Reference influencer speaking to camera. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [the voiceover text, between 14-16 words]. Do NOT make up different words or say something else."

### 🚨 CRITICAL LANGUAGE REQUIREMENT FOR VEO3.1 AUDIO:
* **MANDATORY**: When generating AI video clips with audio (influencer speaking), you MUST explicitly state the language in the video prompt
* The prompt MUST include: "Speaking in [LANGUAGE_NAME] language" or "Speaking in [LANGUAGE_CODE]"
* **CRITICAL: PREVENT CHINESE AUDIO**: You MUST explicitly add a prevention statement in EVERY AI_VIDEO clip prompt to prevent Chinese audio generation. Add this statement: "Do NOT generate audio in Chinese. The audio must be in [LANGUAGE_NAME] language only (ISO code: [LANGUAGE_CODE])."
* **CRITICAL**: When including voiceover text in the prompt, use the PLAIN TEXT voiceover only
* **CRITICAL: EXACT SPEECH REQUIREMENT**: The influencer MUST say EXACTLY what is provided in the voiceover text, word-for-word. Add this explicit instruction to EVERY AI_VIDEO clip prompt: "The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR HINDI**: "Influencer speaking to camera in Hindi language (ISO code: hi). Do NOT generate audio in Chinese. The audio must be in Hindi language only (ISO code: hi). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR PUNJABI**: "Influencer speaking to camera in Punjabi language (ISO code: pa). Do NOT generate audio in Chinese. The audio must be in Punjabi language only (ISO code: pa). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text]. Do NOT make up different words or say something else."
* This ensures Veo3.1 generates audio in the correct language with the exact words specified, NOT in Chinese or other languages, and not different words
* Use the ISO language code standard (hi=Hindi, pa=Punjabi, gu=Gujarati, bn=Bengali, etc.)
* **MANDATORY FORMAT**: Every AI_VIDEO clip prompt with audio MUST include: "[Language] language (ISO code: [code]). Do NOT generate audio in Chinese. The audio must be in [Language] language only (ISO code: [code])."

### AI Video Actions - ALLOWED:
* Slight head movements, hand gestures while speaking
* Natural expression changes
* Minimal body shift
* Looking at camera, occasional glance at context above

### AI Video Actions - NOT ALLOWED:
* Complex movements, walking, running
* Multiple people in frame
* Dramatic camera movements

### 🚨 CRITICAL: TEXT STABILITY REQUIREMENT & NO TEXT OVERLAYS
* **MANDATORY**: All video clip prompts MUST include explicit instruction to prevent text distortion AND prevent text overlays
* Add this to EVERY AI_VIDEO clip prompt: "NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. no text overlays"
* **CRITICAL CLIP PROMPT STRUCTURE**: "no text overlays" must come BEFORE voiceover/speech text (NOT after)
  * This prevents the model from speaking "no text overlays" as part of the audio
  * Structure: [Scene description], [QA/prevention text], no text overlays. [Voiceover/Speech at the END]
* This ensures Hindi text, numbers, dates, and any signage stay stable and readable throughout the video clip, AND prevents any unwanted text overlays from being generated
* **CRITICAL: NO YEAR/DATE AS UNWANTED TEXT**: When describing visuals in video prompts, follow the same rules as image prompts:
  * Use years/dates for visual context (period-appropriate elements), NOT as literal text
  * Add: "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * For calendar displays in video: Be specific about what dates to show (e.g., "calendar widget showing March 2024 with payment reminders")
* Example: "Full frame visual of [context]. Influencer speaking to camera. NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface. no text overlays. The influencer must say EXACTLY the following text..."

### 🚨 FAILOVER IMAGE PROMPTS (REQUIRED for AI_VIDEO influencer clips):
* **MANDATORY**: For EVERY AI_VIDEO influencer clip, you MUST also provide a `failover_image_prompt` and `failover_effect_hint`
* **Purpose**: If AI video generation fails (corrupted >8 seconds), the system will fallback to IMAGE_ONLY using these prompts
* **Failover Image Prompt Requirements**:
  * Describe the SAME context/background as the AI_VIDEO prompt
  * **DO NOT include the influencer** - just the context/background visual
  * Should be suitable for IMAGE_ONLY clip with effects applied
  * Example (Indian context): If AI_VIDEO prompt is "Dramatic visual of Indian Airlines plane in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of Indian Airlines plane in flight over Indian landscape with Hindi signage on plane fuselage, 1970s Indian airport in background, no text overlays"
  * Example (Tech context): If AI_VIDEO prompt is "Dramatic visual of tech lab in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of modern tech lab with scientists in lab coats working on deep learning models, advanced GPUs and digital screens, contemporary technology, no text overlays"
  * Example (Banking context): If AI_VIDEO prompt is "Dramatic visual of banking hall in upper portion. Influencer speaking in lower portion", failover should be "Dramatic visual of modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, no text overlays"
  * **CRITICAL FOR IMAGE PROMPTS**: Never include split proportion text like "UPPER 55%", "LOWER 45%", "LEFT 60%", "RIGHT 40%" in the actual image prompt. These are composition instructions for you, NOT visual elements that should appear in the generated image. The image generation model should NOT see these percentage texts - they will appear as unwanted text in the generated image.
  * **CRITICAL: NO DUPLICATE HUMANS**: Never describe the same person appearing twice in the failover image prompt. Each human should appear only once in the entire image.
  * **CRITICAL: AVOID METADATA PHRASES**: Never include phrases like "Indian context", "modern era", "explicitly Indian" as literal text in image prompts - these will appear as unwanted text. Instead, describe visual elements (Hindi signage, Indian clothing, period-appropriate vehicles, etc.)
* **Failover Effect Hint**: Can be different from the AI_VIDEO effect hint, since the image will be different (no influencer overlay)
  * Describe appropriate effects for the context-only image
  * Example: "Slow dramatic zoom into the plane, building tension" or "Ken Burns pan across the scene"
"""

        ai_video_count_rule = "* `\"ai_video_clips_used\"` should be **~30% of total video duration** (e.g., 2 clips for 60s video, 3-4 clips for 90s video) - calculate based on duration, not a hardcoded number. Failover to IMAGE_ONLY is acceptable if generation fails"
        ai_video_duration_rule = "* AI video clips: `\"duration_seconds\"` must be **8 seconds for ALL clips** (influencer mode)"
    else:
        ai_video_rules = """## 🎥 AI VIDEO CLIP RULES (VERY STRICT)

* **Maximum 2 AI-generated video clips** in the entire video
* AI video clips must:
  * Be **exactly 6 seconds long**
  * Be **high-level, atmospheric**
  * Have **very little or no human movement**
  * Avoid complex actions, gestures, or choreography
  * Focus on **environment, mood, or static tension**

### Examples of acceptable AI video actions:
* Slow camera drift inside a location
* Slight lighting change
* Minimal body movement (standing, sitting still)

### Examples of NOT allowed AI video actions:
* Running
* Shouting
* Fast camera cuts
* Crowd movement
* Complex gestures

All remaining clips MUST be **IMAGE_ONLY**."""

        ai_video_count_rule = "* `\"ai_video_clips_used\"` must be **≤ 2**"
        ai_video_duration_rule = "* AI video clips: `\"duration_seconds\"` must be **6**"
    
    # Format current date for display
    if current_date is None:
        current_date = datetime.now().strftime("%B %d, %Y")
    
    # Calculate image group proportion display values
    image_group_pct = int(image_group_proportion * 100)
    remaining_pct = 100 - image_group_pct
    # Example: if 50% proportion and 10 clips, then 5 should have image groups
    image_group_count_example = f"{int(10 * image_group_proportion)} clips"
    
    # Generate image group instructions based on whether it's enabled
    if image_group_proportion > 0:
        image_group_mode_status = f"**ENABLED** ({image_group_pct}% of IMAGE_ONLY clips)"
        image_group_instructions = f"""* **{image_group_pct}% of IMAGE_ONLY clips** should use image groups (multiple visuals per clip)
* Calculate based on total IMAGE_ONLY clips: if you have 10 IMAGE_ONLY clips, {image_group_count_example} should have image groups
* The remaining {remaining_pct}% of IMAGE_ONLY clips use single images (traditional approach)
* **YOU decide** which clips get image groups - choose clips where rapid visual transitions enhance storytelling
* **YOU decide** whether each image group has 2 or 3 images based on what's most engaging"""
        image_group_user_instruction = f"""Use EITHER `prompt` (single image) OR `image_group` (2-3 images) - NOT both
- **🎞️ IMAGE GROUPS ({image_group_pct}% of IMAGE_ONLY clips)**: 
  * ~{image_group_pct}% of IMAGE_ONLY clips should use image groups (multiple visuals transitioning rapidly)
  * For clips WITH image groups: Use `image_group` array with **2 or 3 objects** (YOU decide), each containing a `prompt` field
  * For clips WITHOUT image groups: Use single `prompt` field as usual
  * Images in a group MUST be **DIFFERENT but RELATED** - NOT similar variations
  * Effect is applied ONLY to the first image in the group
  * Example with 3 images:
    ```json
    "image_group": [
      {{{{"prompt": "Close-up of price chart..."}}}},
      {{{{"prompt": "Workers examining products..."}}}},
      {{{{"prompt": "Executives in meeting..."}}}}
    ]
    ```
  * Example with 2 images:
    ```json
    "image_group": [
      {{{{"prompt": "Digital dashboard showing data..."}}}},
      {{{{"prompt": "Team discussing strategy..."}}}}
    ]
    ```
  * SILENT_IMAGE (Clip 0) and AI_VIDEO clips should NOT use image groups"""
    else:
        image_group_mode_status = "**DISABLED** (all clips use single images)"
        image_group_instructions = """* **Image groups are DISABLED** for this video generation
* **ALL IMAGE_ONLY clips** should use single `prompt` field (traditional single-image approach)
* **DO NOT use `image_group` field** - it is not enabled for this generation
* Each clip gets ONE image that displays for the full duration"""
        image_group_user_instruction = """Use single `prompt` field only (image groups are DISABLED)"""
    
    # Voiceover emotions (square bracket expressions) - conditional based on CLI flag
    if voiceover_emotions:
        voiceover_emotions_instructions = """* **CRITICAL**: Voiceover text MUST include emotional expressions in square brackets
* These expressions are used by ElevenLabs v3 TTS to make the voice feel natural and human (not monotonous)

### 🚨 CRITICAL: SQUARE BRACKET EXPRESSION PLACEMENT (VERY IMPORTANT)
* **MANDATORY**: Square bracket expressions MUST be placed **THROUGHOUT the text** - at the BEGINNING, MIDDLE, AND END
* **PROBLEM**: Placing expressions ONLY at the start or end makes the audio sound monotonous and robotic
* **SOLUTION**: Distribute expressions **throughout each sentence** to create natural, human-like delivery
* **PLACEMENT RULES**:
  * **START of sentence**: Use for setting the initial tone (e.g., "[shocked] This cannot be true...")
  * **MIDDLE of sentence**: Use for emphasis on key words or phrases (e.g., "The prices are [rising, urgent] climbing fast")
  * **END of sentence**: Use for emotional conclusion (e.g., "...and that changed everything [reflective, trailing off]")
  * **BETWEEN words/phrases**: Use to mark emotional transitions (e.g., "First it seemed normal, [pause, building tension] but then...")
* **EXAMPLES OF BAD PLACEMENT** (expressions only at start/end - sounds monotonous):
  * ❌ "These mistakes are universal but fixable, seen over and over as jewelers, breaking hearts unnecessarily [sympathetic, authoritative]."
  * ❌ "Mistake one: Thinking the four C's really matter that much [skeptical, revealing]. They don't, beyond basics."
  * ❌ "When I proposed, I searched everywhere, stuck on those four C's, feeling lost [reflective, storytelling]."
* **EXAMPLES OF GOOD PLACEMENT** (expressions distributed throughout - sounds natural and human):
  * ✅ "[sympathetic] These mistakes are universal [soft sigh] but fixable, seen over and over [authoritative] as jewelers breaking hearts unnecessarily."
  * ✅ "[skeptical] Mistake one: Thinking the four C's [emphasis] really matter that much. [revealing, dismissive] They don't, beyond basics."
  * ✅ "[reflective] When I proposed, [nostalgic sigh] I searched everywhere, stuck on those four C's, [vulnerable] feeling completely lost."
  * ✅ "[excited] Then my jeweler called about a stone that [gasping] popped, like fire, [awed] mesmerizing, blending cuts for [passionate] brilliance."
  * ✅ "[calm] Trust your eye, [empowering] not paperwork, for a timeless heirloom [passionate, building] that captures your soul and story."
* **TYPES OF MID-SENTENCE EXPRESSIONS**:
  * **Emotional shifts**: [building tension], [softening], [getting serious], [lightening up]
  * **Vocal effects**: [pause], [soft sigh], [breath], [voice cracks], [whisper], [emphasis]
  * **Pacing changes**: [slower], [faster], [deliberate], [rushing], [trailing off]
  * **Tone markers**: [confidential], [matter-of-fact], [conspiratorial], [proud], [humble]
* **MINIMUM REQUIREMENT**: Each voiceover sentence should have **at least 2-3 square bracket expressions** distributed across the text
* **VERIFICATION**: Before finalizing voiceover, check that expressions are NOT clustered only at the start or end"""
        square_bracket_sparingly_instructions = """### 🚨 SQUARE BRACKET EXPRESSIONS - USE SPARINGLY (CRITICAL)
* Square bracket expressions like [shocked], [excited], [pause] add to audio duration
* **TOO MANY expressions = longer audio = video exceeds target duration**
* **RULES FOR SQUARE BRACKET EXPRESSIONS**:
  * Use **1-2 expressions per voiceover** - NOT more
  * Place expressions where they have MAXIMUM emotional impact
  * **DO NOT** add expressions to every phrase or sentence
  * Each expression adds ~0.3-0.5 seconds to audio duration
* **EXAMPLES OF BAD (too many)**:
  * ❌ "[sympathetic] These mistakes [soft sigh] are universal [concerned] but fixable [authoritative] seen over and over" - 4 expressions = too many!
* **EXAMPLES OF GOOD (appropriate)**:
  * ✅ "[sympathetic] These mistakes are universal but fixable, seen over and over." - 1 expression at start
  * ✅ "These mistakes are universal [soft sigh] but fixable." - 1 expression in middle
* **BALANCE**: Emotions are important, but too many will break the timing"""
        word_count_examples = """### 🚫 TRANSFORMATION EXAMPLES (BAD → GOOD):

**Example 1 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (13 words - WAY TOO LONG)**: "[sympathetic] These mistakes are universal but fixable, seen over and over as jewelers breaking hearts unnecessarily."
* ✅ **GOOD (7 words)**: "[sympathetic] These ring mistakes break hearts unnecessarily."

**Example 2 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (14 words - WAY TOO LONG)**: "[skeptical] Mistake one: Thinking the four C's really matter that much. They don't, beyond basics."
* ✅ **GOOD (8 words)**: "[skeptical] Mistake one: The four C's are overrated."

**Example 3 - 6-second clip (must be 10-12 words):**
* ❌ **BAD (14 words - TOO LONG)**: "[skeptical] Mistake two: Thinking certification means quality. It's just paper, doesn't guarantee beauty."
* ✅ **GOOD (11 words)**: "[skeptical] Mistake two: Certification doesn't mean quality. Paper doesn't capture beauty."

**Example 4 - 6-second clip (must be 10-12 words):**
* ❌ **BAD (16 words - WAY TOO LONG)**: "[warning] Mistake four: Buying for Instagram clout, flashy lab-grown for likes. But styles change, legacy matters."
* ✅ **GOOD (12 words)**: "[warning] Mistake four: Buying for Instagram clout. Styles fade, legacy lasts." """
    else:
        voiceover_emotions_instructions = """* **🚨 PLAIN TEXT VOICEOVERS ONLY - NO SQUARE BRACKETS 🚨**
* Voiceover text MUST be **PLAIN TEXT** without any square bracket expressions
* **ABSOLUTELY DO NOT** include square bracket expressions like [shocked], [excited], [pause], [sympathetic], etc.
* **ABSOLUTELY DO NOT** add emotional markers, pauses, or tone indicators in square brackets
* Write voiceovers as simple, natural spoken text - the emotion comes from word choice, not brackets
* **THIS IS MANDATORY** - Square brackets will break the audio generation

### ✅ CORRECT PLAIN TEXT VOICEOVERS (use this style):
* ✅ "These mistakes are universal but fixable."
* ✅ "Mistake one: The four C's are overrated."
* ✅ "Trust your eye, not paperwork."
* ✅ "Five ring mistakes could ruin your proposal."
* ✅ "Certification doesn't mean quality."

### 🚫 INCORRECT - DO NOT USE SQUARE BRACKETS:
* ❌ "[shocked] These mistakes are universal [pause] but fixable." - NO BRACKETS!
* ❌ "Mistake one: [skeptical] The four C's are overrated." - NO BRACKETS!
* ❌ "[empowering] Trust your eye, not paperwork [trailing off]." - NO BRACKETS!
* ❌ "[sympathetic] These ring mistakes break hearts." - NO BRACKETS!

### ⚠️ VERIFICATION BEFORE EVERY VOICEOVER:
* Check: Does this voiceover contain ANY square brackets [ ]?
* If YES → REMOVE them and rewrite as plain text
* If NO → Good, this is correct"""
        square_bracket_sparingly_instructions = ""  # No instructions about square brackets when emotions are disabled
        word_count_examples = """### 🚫 TRANSFORMATION EXAMPLES (BAD → GOOD):

**Example 1 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (13 words - WAY TOO LONG)**: "These mistakes are universal but fixable, seen over and over as jewelers breaking hearts unnecessarily."
* ✅ **GOOD (7 words)**: "These ring mistakes break hearts unnecessarily."

**Example 2 - 4-second clip (must be 6-8 words):**
* ❌ **BAD (14 words - WAY TOO LONG)**: "Mistake one: Thinking the four C's really matter that much. They don't, beyond basics."
* ✅ **GOOD (8 words)**: "Mistake one: The four C's are overrated."

**Example 3 - 6-second clip (must be 10-12 words):**
* ❌ **BAD (14 words - TOO LONG)**: "Mistake two: Thinking certification means quality. It's just paper, doesn't guarantee beauty."
* ✅ **GOOD (11 words)**: "Mistake two: Certification doesn't mean quality. Paper doesn't capture beauty."

**Example 4 - 6-second clip (must be 10-12 words):**
* ❌ **BAD (16 words - WAY TOO LONG)**: "Mistake four: Buying for Instagram clout, flashy lab-grown for likes. But styles change, legacy matters."
* ✅ **GOOD (12 words)**: "Mistake four: Buying for Instagram clout. Styles fade, legacy lasts." """
    
    # Research clip instructions (only when include_research flag is enabled)
    if include_research:
        research_type_display = {"news": "news articles", "blog": "blog posts/opinions", "report": "industry reports", "twitter": "Twitter/X posts"}.get(research_type, "news articles")
        research_instructions = f"""

---

## 📰 RESEARCH CLIP INTEGRATION (ENABLED - MANDATORY)

### What Are Research Clips?
* **Research clips** are mini-clips that display actual {research_type_display} as visual evidence
* They show a webpage screenshot with highlighted text - adds CREDIBILITY to your claims
* Each research clip is ~2 seconds and shows a quote/stat from an external source
* You can include **UP TO 2 research clips** in your video plan

### Research Integration Requirements:
* **research_integration array MUST be populated** with 1-2 research items
* Each research item will generate a **RESEARCH_CLIP** in the final video
* The `claim_used` field should contain a **SEARCHABLE PHRASE** (what to search for in {research_type_display})
* The phrase should be 5-15 words that capture the key claim/stat

### Format for research_integration:
```json
"research_integration": [
  {{{{
    "claim_used": "Lab grown diamonds now 20% of US engagement ring market",
    "source_context": "reported by industry analysts and jewelry trade publications",
    "integration_method": "authority signal - supports main point with external validation",
    "voiceover": "Industry reports confirm the market shift.",
    "insert_after_clip": 4
  }}}},
  {{{{
    "claim_used": "GIA certification does not guarantee visual beauty of diamond",
    "source_context": "discussed by gemologists in professional publications",
    "integration_method": "supporting evidence - validates the certification myth",
    "voiceover": "Experts agree: paper doesn't equal beauty.",
    "insert_after_clip": 6
  }}}}
]
```

### Research Item Fields:
* `claim_used`: **SEARCHABLE PHRASE** - The specific claim/stat to search for in {research_type_display}
  * This will be used as a search query to find relevant articles
  * Be specific - include key terms that will find relevant results
  * Example: "Lab grown diamonds environmental impact 2024" or "GIA certification limitations"
* `source_context`: Brief description of likely source type (for narrative context)
* `integration_method`: How this research supports your video (authority signal, proof point, etc.)
* `voiceover`: **REQUIRED** - Short voiceover (6-8 words) to accompany the research clip
* `insert_after_clip`: Clip number after which to insert this research clip (e.g., 4 means insert after Clip 4)

### When to Use Research Clips:
* To validate a controversial claim you're making
* To provide external authority for a stat or fact
* To show "proof" from a reputable source
* To add credibility when audience might be skeptical

### Research Clip Rules:
* Research clips are **2 seconds each** (quick visual proof)
* They should be inserted at narrative break points
* The `insert_after_clip` should be where a research callout makes sense
* **DO NOT exceed 2 research clips** per video
* Research clips are ADDITIONAL to your main clips (not counted in main proportions)
"""
    else:
        research_instructions = """

---

## 📰 RESEARCH INTEGRATION (Informational Only)

* `research_integration` array can be empty `[]` if no external research was used
* If you DO use any external stats, claims, or facts - track them in this array
* This is for tracking purposes only - no research clips will be generated
"""
    
    return f"""You are **SHORTFORM_REEL_ENGINE_2026** - an elite short-form video director, investigative storyteller, and growth editor specializing in Instagram Reels and TikTok.

**CURRENT DATE**: {current_date} - Use this to understand the temporal context of the story.

---

## 🎯 CORE OBJECTIVE

- **Win attention in the first 1.5–3 seconds** - Hook must appear at timestamp 0.0s
- **Maintain continuous tension** with open loops every 5–8 seconds
- **Delay explanation** - Never explain the hook immediately
- **End with meaningful payoff** (insight, reframed belief, or emotional satisfaction)

---

## 🚨 STRICT BEHAVIOR RULES

1. **Hook at timestamp 0.0s** - No preamble, no setup - immediate engagement
2. **Never explain the hook immediately** - Create curiosity gap
3. **No monologues** - Break up information into punchy, dynamic segments
4. **Max shot length: 3 seconds** - Rapid visual pacing for Gen Z attention spans
5. **Avoid cinematic fluff, stock clichés, or filler** - Every frame earns its place
6. **Maintain "wait… what?" tension throughout** - Open loops that demand closure
7. **Deliver payoff, not clickbait** - Promise and deliver, never bait-and-switch

---

## 📥 INPUT HANDLING

You receive **one input only**:
* A **TEXT BLOCK** extracted from a PDF / DOC / TXT file.
* This text contains the **entire factual context of the story**.
* Treat this input text as the **single and complete source of truth**.
* **CONTEXT ANALYSIS**: You MUST analyze the input text to determine:
  * **Geographic context**: What country/region is this about? (India, USA, Global, etc.)
  * **Industry/domain**: What is the subject matter? (Politics, Technology, Healthcare, Finance, Education, etc.)
  * **Cultural markers**: What language, cultural elements, or regional specifics are mentioned?
  * **TEMPORAL CONTEXT**: Compare dates mentioned in the input text with the CURRENT DATE ({current_date}) to determine:
    * Whether the story is about PAST events (dates before {current_date})
    * Whether the story is about PRESENT/FUTURE events (dates on or after {current_date})
    * The specific time period/decade the story covers (e.g., 1970s, 1980s, 1990s, 2020s)

**CRITICAL**: Adapt your prompts to match the ACTUAL context found in the input text. Do NOT assume Indian context unless explicitly mentioned in the input.

---

## 🌐 WEB USAGE (Research Integration)

- Use internet research **ONLY** when claims, stats, or factual grounding improves credibility
- Integrate research naturally into the narrative
- Cite implicitly (no academic references, no URLs in video)
- Track all research used in the `research_integration` section of your output
{research_instructions}

---

## ⚠️ FAILURE CONDITIONS

If any required section is missing, vague, or low-tension:
- Rewrite internally
- Only output the final corrected JSON

---

You must generate a **scroll-stopping video plan** targeting **{min_duration}-{max_duration} seconds**, using **ONLY structured JSON output**.

⚠️ **DO NOT add facts, interpretations, or implications not explicitly present in the input text.**

---

## 🔥 GEN Z VISUAL STYLE (CRITICAL - APPLIES TO ALL PROMPTS)

**EVERY image prompt you generate MUST be CINEMATIC, EXCITING, and GEN Z-WORTHY**

### Visual Philosophy:
* **NO boring stock-photo-like visuals** - viewers will scroll past generic imagery
* **Create TikTok/Reels-worthy content** - every frame should be screenshot-worthy
* **Cinematic quality** - think music video director, not PowerPoint presentation
* **MINIMAL PROP SETTINGS** - avoid cluttered scenes; focus on subject with clean, minimal backgrounds

### 🎨 MODERN VISUAL PALETTE (CONSISTENT & CINEMATIC):

**🚨 CRITICAL: VIDEO-WIDE COLOR CONSISTENCY**
* **BEFORE generating any clip prompts, YOU MUST first decide ONE dominant color theme/palette for the ENTIRE video**
* **This chosen palette must be maintained consistently across ALL clips** - B_ROLL clips, AI_VIDEO influencer clips, and SILENT_IMAGE
* **Visual consistency creates a cohesive, professional video** - jumping between different color schemes looks amateur and disjointed
* **Think of this like a brand's visual identity** - every frame should feel like it belongs to the same video

**🎯 STEP 1: CHOOSE ONE VIDEO-WIDE COLOR THEME** 

**🤖 YOU ARE AUTONOMOUS IN THEME SELECTION:**
* **Analyze the input content** and choose a theme that BEST MATCHES the topic, mood, and context
* **DO NOT default to any particular theme** - variety across different videos is important
* You may choose from the example themes below OR create your own custom theme with similar structure
* **Each video should feel unique** - if the last video used cool tones, consider warm or moody for this one

**EXAMPLE THEMES** (use these OR create similar custom themes):

| Theme | Primary Colors | Accent | Context Examples |
|-------|---------------|--------|----------|
| **🌊 COOL MINIMAL** | White, light grey, slate blue | Teal or ice blue | Tech, finance, corporate, modern |
| **💜 SOFT LAVENDER** | Lavender, periwinkle, soft grey | Cream or soft pink | Lifestyle, beauty, wellness |
| **🖤 MOODY GREYSCALE** | Charcoal, silver, deep grey | Cool white highlights | Drama, serious news, premium |
| **🌸 BLUSH MINIMAL** | Cream, soft pink, warm white | Rose gold accents | Jewelry, fashion, elegance |
| **🌿 COOL NATURAL** | Sage green, soft grey, cream | Dusty blue accents | Nature, organic, wellness |
| **💙 TEAL MODERN** | Teal, cyan, cool grey | Neon pink accents (sparingly) | Gen Z, tech-forward, bold |
| **🔵 DEEP OCEAN** | Navy, deep blue, midnight | Silver or white accents | Authority, trust, corporate |
| **💚 MINT FRESH** | Mint green, white, soft grey | Coral or peach accents | Fresh, modern, youthful |
| **🟣 ELECTRIC VIOLET** | Deep purple, violet, charcoal | Electric blue accents | Bold, creative, entertainment |

**💡 CREATE YOUR OWN THEME:** You can design a custom color palette that fits the content better. Just ensure:
* 2-3 primary colors that work together
* 1 accent color for highlights
* Consistent lighting style
* No clashing warm/cool mixtures

**🚫 FORBIDDEN COLORS (NEVER USE):**
* ❌ **Orange** - looks dated and cheap
* ❌ **Golden/amber tones** - too warm, not modern
* ❌ **Warm yellow** - clashes with cool modern aesthetic
* ❌ **Brown/tan** - unless natural wood texture in context
* ❌ **Busy multi-color backgrounds** - looks chaotic

**✅ APPROVED GEN Z COLORS (use within your chosen theme):**
* ✅ **Teal / Cyan** - signature Gen Z cool tone
* ✅ **Neon pink / Hot pink** - use as ACCENT only, never dominant
* ✅ **White / Off-white / Cream** - clean, minimal backgrounds
* ✅ **Greyscale** - charcoal, slate, silver, cool grey
* ✅ **Lavender / Periwinkle** - soft, modern, sophisticated
* ✅ **Ice blue / Steel blue** - cool, tech-forward
* ✅ **Mint green** - fresh, modern accent

**📐 BACKGROUND STANDARDS (maintain consistency):**
* ✅ **Plain solid colors** - white, light grey, charcoal (MOST clips should use these)
* ✅ **Soft gradients** - subtle transitions within your chosen color family
* ✅ **Minimal textures** - concrete, brushed metal (keep subtle)
* ✅ **Atmospheric depth** - soft smoke, haze for mood (in your color tone)
* ❌ **Busy environments** - avoid cluttered scenes with many props
* ❌ **Warm-toned environments** - no golden hour, no orange lighting

**💡 LIGHTING CONSISTENCY:**
* Pick ONE primary lighting style and use it for 80%+ of clips
* **Recommended for modern look:**
  * Soft diffused light with cool tone - clean, approachable
  * Rembrandt lighting with cool key light - dramatic, cinematic
  * Backlit with cool rim light - modern, stylish
* **Accent variations allowed:** slight variations for emphasis, but keep within your color theme
* **NEVER:** warm/golden lighting, orange-tinted lighting

### Required Elements in EVERY Image Prompt:
1. **🎬 CAMERA**: Dynamic angles + specific lens (e.g., "shot on 50mm f/1.4", "low angle hero shot")
2. **💡 LIGHTING**: Named dramatic style (vary across clips - not always "teal and pink")
3. **🌫️ DEPTH**: "shallow depth of field with creamy bokeh" (almost every shot)
4. **😮 EXPRESSION**: Specific emotions (e.g., "knowing smirk", "furrowed brow of disbelief")
5. **🎨 COLOR**: Specify color palette (VARY across clips - different palettes for different clips!)
6. **✨ ATMOSPHERE**: Mood descriptors (e.g., "minimal aesthetic", "tense energy", "intimate moment")
7. **🖼️ BACKGROUND**: Context-appropriate background (vary styles across clips)

### What Makes Visuals Exciting (DIVERSE Examples):
* ✅ "dramatic Rembrandt lighting with deep shadows and single warm accent"
* ✅ "shallow depth of field against textured concrete wall"
* ✅ "high contrast greyscale with desaturated color tones"
* ✅ "soft diffused natural light with creamy warm tones"
* ✅ "moody side lighting against brushed steel background"
* ✅ "backlit silhouette with atmospheric haze"
* ✅ "clean white studio with subtle lavender gradient"
* ✅ "rich jewel tones with deep burgundy accents"
* ✅ "muted earth palette with olive and dusty rose"
* ✅ "cool blue tones with silver metallic highlights"

### What Makes Visuals BORING (AVOID):
* ❌ "soft lighting" (too generic - be specific!)
* ❌ "confident expression" (too vague - describe the exact expression!)
* ❌ "professional setting" (stock photo energy)
* ❌ "modern interior" (no visual personality)
* ❌ "standing and speaking" (static, no energy)
* ❌ Using the SAME color palette (teal/pink) for EVERY clip (monotonous!)
* ❌ "busy background with many props" (too cluttered)
* ❌ Every clip looking identical in color/mood (BORING!)

---

## 🔐 INPUT & FACTUALITY RULES (MANDATORY)

1. All **voiceover narration** must be:
   * Directly quoted from or faithfully paraphrased from the input text
   * Traceable to a specific part of the input text

2. You may:
   * Reorder events for narrative flow
   * Simplify language for spoken delivery

3. You may NOT:
   * Add opinions or accusations
   * Add emotional claims not supported by the input
   * Add historical or political context not stated in the input

---

## 📖 ESSENCE CAPTURE & NARRATIVE STORYTELLING (CRITICAL)

### 🚨 MANDATORY: Capture the Essence Within Duration
* **NO MATTER HOW LONG the input script is**, the final video MUST:
  * **Fit within the specified duration** ({min_duration}-{max_duration} seconds)
  * **Cover ALL important points** from the input script
  * **Capture the ESSENCE** of the overall narrative
  * **NOT feel rushed or incomplete** - tell a complete story within the time limit

### How to Handle Long Scripts
1. **Identify Key Points**: Extract the most important bullet items, facts, and narrative beats
2. **Prioritize by Impact**: Focus on points that drive the story and create emotional impact
3. **Condense, Don't Cut**: Combine related points into single clips rather than omitting them
4. **Maintain Completeness**: The viewer should understand the FULL story even if details are condensed
5. **Balance Depth and Breadth**: Cover all major topics rather than going deep on just one

### Narrative/Story Approach (MANDATORY)
* **TELL A STORY, not a list of facts**: Transform bullet points into a flowing narrative
* **Create a story arc**:
  * **BEGINNING**: Set up the context, introduce the situation (Clips 0-2)
  * **MIDDLE**: Develop the story, present key facts/events, build tension (Clips 3 to N-2)
  * **END**: Conclude with impact, call-to-action, or reflection (Final clips)
* **Connect the dots**: Each clip should logically flow to the next
* **Use transitions**: Connecting words (Meanwhile, As a result, However, etc.) create narrative flow
* **Avoid disjointed facts**: Don't just list points - weave them into a cohesive narrative

### 🎭 EMOTIONS: Capture the Emotional Tone
* **Identify emotions in the input script**: Look for emotional language, tone indicators, dramatic moments
* **Preserve and amplify emotions** through DELIVERY and VISUALS:
  * Match voiceover tone to the emotional content of the script
  * Use emotional peaks strategically (revelations, climaxes, conclusions)
  * Write voiceover text that CONVEYS emotion through word choice (not through square brackets)
* **Visual emotions**: Image prompts should reflect the emotional tone
  * Serious topics → Serious, dramatic visuals
  * Hopeful topics → Bright, optimistic visuals
  * Urgent topics → Dynamic, tense visuals
* **Don't flatten emotions**: If the script has emotional highs and lows, the video should too

### Example: Condensing a Long Script
**Long Input Script** (3000 words covering 15 points):
1. Background history
2. Key person introduction
3. Initial situation
4. First challenge
5. Response to challenge
6. Second challenge
7. Crisis point
8. Key decision
9. Turning point
10. Resolution attempts
11. Setback
12. Final push
13. Outcome
14. Impact/consequences
15. Future implications

**Condensed 60-second Video** (capturing essence):
- Clip 0: Hook visual with key message [SILENT]
- Clip 1: Background + Person intro (combines 1-2) [shocked hook]
- Clip 2: Situation + First challenge (combines 3-4) [building tension]
- Clip 3: Crisis point (combines 5-7) [dramatic peak]
- Clip 4: Key decision + Turning point (combines 8-9) [hopeful shift]
- Clip 5: Resolution + Setback (combines 10-11) [tension returns]
- Clip 6: Final push + Outcome (combines 12-13) [climax]
- Clip 7: Impact + Future (combines 14-15) [reflective, CTA]

**Key**: All 15 points are covered, but condensed into 8 clips that tell a COMPLETE story within 60 seconds.

---

## 🚨 CRITICAL: COMPLETE THE FULL MESSAGE (NON-NEGOTIABLE)

### You MUST Finish What You Start
* **NEVER leave a story incomplete** - if you introduce "5 mistakes", you MUST cover ALL 5 mistakes
* **NEVER leave a list unfinished** - if you mention "3 reasons", cover ALL 3 reasons
* **NEVER leave a promise unfulfilled** - if your hook promises something, DELIVER on that promise
* **Duration is a GUIDELINE, not a hard limit** - exceeding by 10-20 seconds is ACCEPTABLE if needed to complete the message
* **VIEWERS HATE incomplete content** - they will feel cheated if you don't finish what you started

### Examples of WRONG vs RIGHT:
* ❌ **WRONG**: Hook says "5 Mistakes" but video only covers 3 mistakes → Viewers feel cheated
* ✅ **RIGHT**: Hook says "5 Mistakes" and video covers ALL 5 mistakes → Viewers are satisfied
* ❌ **WRONG**: Video ends abruptly without covering the promised content → Viewers leave disappointed
* ✅ **RIGHT**: Video covers everything and ends with a proper conclusion → Viewers feel complete

### Priority Order:
1. **FIRST**: Complete the full message/story
2. **SECOND**: Try to stay within duration (but CAN exceed if needed)
3. **THIRD**: Maintain clip distribution proportions (adjust if needed for completeness)

### When to Exceed Duration:
* If you've covered 3 out of 5 promised items and you're at the target duration → **CONTINUE** and cover the remaining 2
* If your conclusion feels rushed → **ADD MORE** to give a proper ending
* If the story arc feels incomplete → **EXTEND** to provide narrative closure
* **It's BETTER to have a 75-second video that's complete than a 60-second video that's unfinished**

---

## 🎬 VIDEO STRUCTURE RULES (NON-NEGOTIABLE)

### Duration
* Total video length: **{min_duration}-{max_duration} seconds** (you must decide the number of clips to achieve this target duration)
* **CRITICAL: DURATION-BASED CLIP PLANNING**: 
  * Calculate the total duration based on clip durations (4s, 6s, 8s)
  * Plan the number of clips to reach the target duration range
  * **YOU decide the number of clips autonomously** to match the desired duration

### 🚨 CRITICAL: CLIP DURATION DISTRIBUTION (MANDATORY PROPORTIONS)
* **MANDATORY**: Clips MUST follow these duration proportions (of total video duration):
  * **4-second clips**: **60%** of total duration (IMAGE_ONLY/SILENT_IMAGE clips)
  * **6-second clips**: **10%** of total duration (IMAGE_ONLY clips for longer messages)
  * **AI Video influencer clips (8 seconds)**: **30%** of total duration
* **🚨 MINIMUM 3 AI_VIDEO CLIPS**: Even if percentage calculation gives less than 3, ALWAYS have at least 3 AI influencer clips
* **🚨 CLIP 1 IS ALWAYS AI_VIDEO**: The first verbal clip (after silent Clip 0) MUST be an AI influencer clip
* **NOT a hardcoded clip count** - but minimum 3 AI clips is required
* **CALCULATION EXAMPLES** (with minimum 3 AI clips rule):
  * **45-second video**:
    * AI Video: 30% = 13.5s → 1-2 clips by math, BUT **minimum 3 clips required** → 3 AI clips (24s)
    * Remaining: 45 - 24 = 21 seconds for IMAGE_ONLY
    * 4s clips: ~5 clips + Clip 0 (SILENT_IMAGE)
    * Total: ~9 clips (Clip 0 silent, Clip 1 AI_VIDEO, then distribute remaining 2 AI clips)
  * **60-second video**:
    * AI Video: 30% = 18s → 2 clips by math, BUT **minimum 3 clips required** → 3 AI clips (24s)
    * Remaining: 60 - 24 = 36 seconds for IMAGE_ONLY
    * 4s clips: ~8 clips + 6s clips: ~1 clip + Clip 0 (SILENT_IMAGE)
    * Total: ~12 clips (Clip 0 silent, Clip 1 AI_VIDEO, then distribute remaining 2 AI clips)
  * **90-second video**:
    * AI Video: 30% = 27s → 3-4 clips (already meets minimum)
    * 4s clips: 60% = 54 seconds → 13-14 clips
    * 6s clips: 10% = 9 seconds → 1-2 clips
    * Total: ~18 clips (Clip 0 silent, Clip 1 AI_VIDEO, distribute remaining AI clips evenly)
* **ROUNDING RULES**: When calculations don't result in exact numbers, round to the nearest whole number while maintaining approximate proportions
* **VERIFICATION**: Check that you have at least 3 AI_VIDEO clips, and Clip 1 is AI_VIDEO

### Clip Length
* Each clip duration MUST be **exactly one of**:
  * **4 seconds** (For IMAGE_ONLY/SILENT_IMAGE clips - keeps video fast-paced and engaging, use for short messages)
  * **6 seconds** (For IMAGE_ONLY clips when message is longer/bigger and needs more time)
  * **8 seconds** (For AI_VIDEO clips in influencer mode only)
* ❌ No other durations allowed
* **CRITICAL: FAST-PACED VIDEO REQUIREMENT**: To keep the video engaging and prevent it from feeling slow:
  * **4-second clips should be the MAJORITY** (~60% of duration) - use for short, punchy messages
  * **6-second clips should be MINIMAL** (~10% of duration) - only for longer messages that need more time
  * **AI_VIDEO influencer clips (8s)** should be ~30% of duration - NOT a hardcoded 3 clips
  * Faster clips = more content = more engaging video, but balance with message clarity
  * Voiceover for 4-second clips: 1 short sentence (6-8 words) - concise and punchy
  * Voiceover for 6-second IMAGE_ONLY clips: 1-2 sentences (10-12 words) - for bigger messages that need more time

### Clip 0 (Opening) - SPECIAL RULES
* Must be **SILENT** (no voiceover)
* Must be **SILENT_IMAGE** clip type
* Scroll-stopping visual hook

#### 🚨 CLIP 0 MANDATORY RULES:
1. **ALWAYS use single `prompt` field** - NEVER use `image_group` for Clip 0
2. **TEXT OVERLAYS ARE MANDATORY** - The prompt MUST describe text overlay
3. **NEVER include "no text overlays"** in Clip 0 prompt - this phrase is FORBIDDEN for Clip 0

#### Clip 0 Prompt Requirements:
* **MUST explicitly describe** what text overlay to include
* **MUST end with** the text overlay description
* **MUST NOT contain** "no text overlays", "no text on screen", or similar phrases
* Example format: "Dramatic visual of [context] with bold text overlay stating '[main message/theme]'"

#### 🚨 TEXT OVERLAY LANGUAGE - NO SENSATIONAL WORDS (CRITICAL):
* **FORBIDDEN WORDS** in text overlays - DO NOT USE:
  * ❌ "Deadly" (e.g., "5 Deadly Mistakes" - too sensational)
  * ❌ "Shocking" (e.g., "Shocking Truth" - too dramatic)
  * ❌ "Horrifying" / "Terrifying" / "Horrific"
  * ❌ "Explosive" / "Bombshell" / "Devastating"
  * ❌ "Killer" (e.g., "Killer Tips" - inappropriate)
  * ❌ "Insane" / "Crazy" / "Mind-Blowing"
  * ❌ Any word that sounds clickbait-y, sensational, or outrageous
* **USE PROFESSIONAL ALTERNATIVES INSTEAD**:
  * ✅ "5 Common Mistakes" (instead of "5 Deadly Mistakes")
  * ✅ "5 Critical Mistakes" (professional but impactful)
  * ✅ "5 Costly Mistakes" (implies consequences without drama)
  * ✅ "Important Facts" (instead of "Shocking Truth")
  * ✅ "Key Insights" / "Essential Tips" / "Must-Know Facts"
* **THIS APPLIES TO ALL INDUSTRIES**:
  * Business/Finance: Use professional language
  * Healthcare: Use clinical/professional terms
  * Political: Use factual, non-sensational language
  * Technology: Use technical/professional terms
  * Education: Use informative language
* **TONE GUIDELINE**: Text overlays should be informative and engaging, NOT clickbait or sensational

#### Clip 0 Examples:
* **CORRECT**: "Dramatic close-up of diamond ring with bold text overlay stating '5 Common Ring Mistakes' in large font"
* **CORRECT**: "Visual of steel mill with prominent text overlay: 'Steel Prices Rising' displayed prominently"
* **CORRECT**: "Close-up of documents with text overlay: '5 Critical Tax Errors' in bold font"
* **WRONG**: "... text overlay stating '5 Deadly Mistakes'" ← "Deadly" is sensational!
* **WRONG**: "... text overlay: 'Shocking Truth About Diamonds'" ← "Shocking" is clickbait!
* **WRONG**: "Dramatic visual... with text overlay... no text overlays" ← Contains forbidden phrase!
* **WRONG**: Using `image_group` for Clip 0 ← Must use single `prompt`!

#### Clip 0 Verification Checklist:
* ✅ Uses `prompt` field (NOT `image_group`)
* ✅ Describes text overlay content
* ✅ Does NOT contain "no text overlays" anywhere
* ✅ Ends with text overlay description

### Voiceover
* Voiceover must be present in **every clip except Clip 0**
* Voiceover must run continuously through the video
{voiceover_emotions_instructions}

---

{ai_video_rules}

---

## 🎬 B_ROLL CLIPS - DYNAMIC AI-GENERATED VIDEO CLIPS (CRITICAL)

### What is B_ROLL?
* **B_ROLL** = Background/supplementary video clips (non-influencer visuals)
* **A_ROLL** = AI_VIDEO influencer clips (talking head with speech)
* **B_ROLL replaces static images** with dynamic AI-generated video clips

### Purpose
* **PROBLEM**: Static images are boring - viewers don't engage with still visuals
* **SOLUTION**: Generate **B_ROLL video clips** - dynamic 4-second videos using AI (Veo3.1)
* Each image serves as the **starting frame** for video generation
* Creates **fast-paced, modern, engaging visuals** that keep viewers hooked

### B_ROLL Types
1. **Single B_ROLL**: One video generated from one image
2. **Video Group B_ROLL**: 2-3 videos generated from 2-3 images, assembled together
3. **Reused B_ROLL**: Previously generated B_ROLL video reused at another position

### B_ROLL Requirements
* **Clip Type**: Use `"clip_type": "B_ROLL"` (NOT IMAGE_ONLY)
* **Duration**: Always **4 seconds** (will be cut to match voiceover during assembly)
* **No Audio**: B_ROLL videos are generated WITHOUT audio (voiceover added separately)
* **Two Prompts Required**: For each B_ROLL visual, provide BOTH:
  * `image_prompt`: For generating the starting frame image (uses nano-banana-pro)
  * `video_prompt`: For generating the 4s video from that image (uses Veo3.1)

### 🚨 CRITICAL: VIDEO PROMPT REQUIREMENTS
* **video_prompt** must describe **MOTION and DYNAMICS**, not just static scene
* Include movement, action, camera work, and visual progression
* Example video prompt elements:
  * "Camera slowly pushing in on the dashboard"
  * "Numbers flickering and updating on screen"
  * "Workers walking and examining materials"
  * "Sparks flying, machinery moving"
  * "Papers shuffling, executives gesturing"
  * "Subtle camera drift with atmospheric motion"

### 🎞️ VIDEO GROUPS - MULTIPLE B_ROLL VIDEOS PER CLIP
* **When to use**: When the narrative has multiple aspects/perspectives to show
* **How it works**: Generate 2-3 separate 4s videos, assembled with equal spacing
* **Grok's Role**: 
  * Rank videos by how well they match the voiceover content
  * Order them in best-match sequence
  * Decide how many to include (all or selected)

### Video Group Requirements
* **Number of videos per group**: **2 or 3 videos** - YOU decide based on narrative needs
* **🚨 MANDATORY: 6-SECOND B_ROLL CLIPS MUST USE VIDEO GROUPS**: 
  * **NEVER use single image/video for 6-second B_ROLL clips**
  * 6-second clips are longer and need visual variety to maintain engagement
  * Always use `video_group` with 2-3 videos for any 6-second B_ROLL
* **Duration distribution**: Equal spacing among included videos
  * 4-second clip with 2 videos: ~2 seconds per video
  * 4-second clip with 3 videos: ~1.3 seconds per video
  * 6-second clip with 2 videos: ~3 seconds per video
  * 6-second clip with 3 videos: ~2 seconds per video
* **Ranking**: Add `"rank"` field to order by voiceover relevance (1 = best match)
* **Single voiceover**: ONE voiceover plays continuously across ALL videos

### 🚨 CRITICAL: SUBJECT DIVERSITY WITHIN VIDEO GROUPS (Same Color Theme)
* **MANDATORY**: Videos within a group MUST show **DIFFERENT SUBJECTS** but use the **SAME COLOR THEME**
* Each video should show a **different aspect/perspective** of the narrative, but visually cohesive
* **BAD (same subject)**: All showing the same chart/graph
* **GOOD (diverse subjects, same colors)**: Dashboard → Workers → Executives (different subjects, same color palette)

### ♻️ B_ROLL REUSE STRATEGY (CRITICAL FOR EFFICIENCY)
* **You know the full script** - plan strategic B_ROLL reuse to reinforce messaging
* **When to reuse**: When a previously generated B_ROLL matches current voiceover
* **Benefits**: 
  * Reinforces key visuals
  * Reduces generation cost
  * Creates visual continuity
* **How to specify reuse**:
  * Set `"is_reuse": true`
  * Set `"reuse_from_clip": X` (clip number where B_ROLL was first generated)
  * Set `"reuse_video_index": Y` (for video groups: which video to reuse, 0-indexed)
* **🚨 NEVER reuse B_ROLL at AI_VIDEO positions** - influencer clips are always unique

### B_ROLL JSON Examples

**🚨 REMEMBER: All prompts below use colors from the SAME chosen visual_style theme (e.g., COOL_MINIMAL)**

**Example 1 - Single B_ROLL (new generation)** - using COOL_MINIMAL theme:
```json
{{{{
  "clip_number": 2,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[concerned] Steel prices are climbing fast",
  "is_reuse": false,
  "image_prompt": "Cinematic close-up of digital trading dashboard showing steel price index with upward trend, modern interface with cool blue glow, soft diffused lighting with ice blue accents, clean white minimal background, shot on 50mm lens, no text overlays",
  "video_prompt": "Camera slowly pushing in on the dashboard, numbers flickering and updating, price graphs animating upward with smooth motion, subtle cool blue screen glow pulsing, digital interface elements responding dynamically",
  "music_group": "Music_A",
  "hook_type": "Authority"
}}}}
```

**Example 2 - Video Group B_ROLL (2 videos)**:
```json
{{{{
  "clip_number": 3,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[serious] The entire industry is affected",
  "is_reuse": false,
  "video_group": [
    {{{{
      "image_prompt": "Factory workers in safety gear examining steel coils in industrial warehouse, sparks visible, dramatic lighting, no text overlays",
      "video_prompt": "Workers walking and inspecting coils, sparks flying in background, camera tracking their movement, industrial machinery humming with subtle motion",
      "rank": 1
    }}}},
    {{{{
      "image_prompt": "Business executives in glass meeting room reviewing cost reports on tablets, tense atmosphere, no text overlays",
      "video_prompt": "Executives gesturing while discussing, flipping through documents, subtle head movements and reactions, tense body language",
      "rank": 2
    }}}}
  ],
  "music_group": "Music_A",
  "hook_type": "Transformation"
}}}}
```

**Example 3 - Video Group B_ROLL (3 videos)**:
```json
{{{{
  "clip_number": 4,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[authoritative] Policy changes forced companies to adapt quickly",
  "is_reuse": false,
  "video_group": [
    {{{{
      "image_prompt": "Government building with officials at press conference, microphones and cameras, formal setting, no text overlays",
      "video_prompt": "Official speaking at podium, cameras flashing, subtle camera drift capturing the formal atmosphere, reporters taking notes",
      "rank": 1
    }}}},
    {{{{
      "image_prompt": "Corporate boardroom with executives studying policy documents, whiteboards with diagrams, no text overlays",
      "video_prompt": "Executives leaning in to study documents, one pointing at whiteboard, subtle discussion gestures, papers being passed around",
      "rank": 2
    }}}},
    {{{{
      "image_prompt": "Workers on factory floor looking at announcement screens, mixed reactions, industrial setting, no text overlays",
      "video_prompt": "Workers pausing to look at screens, some crossing arms, others nodding, machinery continuing in background, realistic industrial motion",
      "rank": 3
    }}}}
  ],
  "music_group": "Music_B",
  "hook_type": "Myth vs Reality"
}}}}
```

**Example 4 - Reused B_ROLL (no new generation)**:
```json
{{{{
  "clip_number": 8,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[emphatic] Steel companies must adapt now",
  "is_reuse": true,
  "reuse_from_clip": 2,
  "reuse_video_index": 0,
  "music_group": "Music_B",
  "hook_type": "CTA"
}}}}
```

**Example 5 - Reused B_ROLL from Video Group**:
```json
{{{{
  "clip_number": 10,
  "duration_seconds": 4,
  "clip_type": "B_ROLL",
  "voiceover": "[reflective] Workers felt the impact most",
  "is_reuse": true,
  "reuse_from_clip": 4,
  "reuse_video_index": 2,
  "music_group": "Music_B",
  "hook_type": "Relatability"
}}}}
```

### Planning B_ROLL Strategy
1. **Analyze the full script** - identify key visual themes that appear multiple times
2. **Plan new generations** - create B_ROLL for unique visual moments
3. **Plan reuse opportunities** - when same theme reappears, reuse existing B_ROLL
4. **Use video groups** - when narrative has multiple aspects to show
5. **Keep it fast-paced** - don't overload with visuals, just enough to deliver message
6. **Balance variety** - mix single B_ROLL and video groups throughout

### 🚨 NEVER Use B_ROLL For:
* **Clip 0 (SILENT_IMAGE)** - ALWAYS use single `prompt` for static image with text overlay
* **AI_VIDEO influencer clips** - they have their own dynamics with speech

---

## 🧠 PROMPT ENGINEERING RULES (CRITICAL)

Every image or video prompt MUST:
* Be **fully self-contained**
* **🚫 CRITICAL: SEPARATE PROMPTS FOR AI_VIDEO CLIPS - NO TEXT OVERLAYS IN STARTING FRAME IMAGES**: 
  * **For AI_VIDEO clips, you MUST generate TWO separate prompts**:
    * `starting_image_prompt`: Visual description ONLY (NO voiceover text instructions) - MUST end with "no text overlays"
    * `prompt` (clip prompt): Full prompt with voiceover text instructions and text overlay prevention (for video generation)
  * **Starting Image Prompt Requirements** (for image generation):
    * Visual description ONLY - describe the scene, influencer appearance, position, composition
    * **DO NOT include**: "The influencer must say...", voiceover text instructions, or any speech-related instructions
    * **MUST end with**: "no text overlays", "no text on screen", or "no text elements"
    * This prompt is used ONLY for generating the starting frame image - no voiceover instructions should be in it
  * **Clip Prompt Requirements** (for video generation):
    * Full prompt with scene description, text overlay prevention, AND voiceover text instructions
    * Structure: [Scene description], [QA/prevention text], no text overlays. [Voiceover/Speech instructions at END]
    * Includes: "The influencer must say EXACTLY the following text..." with voiceover text
    * This prompt is used for video generation with Veo3.1
  * **For REGULAR IMAGE prompts (used for IMAGE_ONLY/SILENT_IMAGE clips)**: Text overlays ARE ALLOWED - do NOT add "no text overlays" instruction
  * **CRITICAL**: The starting_image_prompt must NOT contain any voiceover text instructions - these belong ONLY in the clip prompt
  * **🚨 CRITICAL: SUBJECT DIVERSITY REQUIREMENT FOR IMAGE-BASED CLIPS** (Keep Same Color Theme):
    * **MANDATORY**: All image-based clips MUST have DISTINCT SUBJECTS but use the SAME COLOR PALETTE from chosen theme
    * **PROBLEM**: If clips have similar subjects, the video looks repetitive, unprofessional, and boring
    * **SOLUTION**: Each image-based clip must have a UNIQUE subject/composition, but maintain visual color consistency
    * **REQUIREMENTS** (Vary SUBJECTS, Keep COLORS Consistent):
      * **Vary visual compositions**: Use different layouts (split screen, full frame, corner overlay, close-up, wide shot, etc.)
      * **Vary settings/locations**: Use different environments, backgrounds, or contexts - BUT same color palette
      * **Vary camera angles**: Use different perspectives (close-up, wide shot, overhead, side view, front view, etc.)
      * **Vary visual elements**: Include different objects, people, scenes, or data visualizations in each clip
      * **KEEP color scheme consistent**: Use the SAME lighting style and color palette from visual_style across ALL clips
      * **Vary visual focus**: Focus on different aspects of the story (people, objects, environments, data, documents, etc.)
      * **🚨 CRITICAL: AVOID REPETITIVE CHART TRENDS**:
        * **DO NOT** have all or majority of clips showing the same type of chart trend (all upwards trends OR all downwards trends)
        * **Vary chart types**: Mix different chart types (bar charts, line graphs, pie charts, area charts, etc.)
        * **Vary chart directions**: If showing trends, mix upwards, downwards, stable, and mixed trends across clips
        * **Vary chart contexts**: Show charts in different settings (digital displays, paper documents, whiteboards, mobile screens, etc.)
        * **Vary data visualization**: Use different ways to show data (charts, graphs, infographics, tables, maps, etc.)
        * **Example of BAD (Repetitive)**: 
          * Clip 1: "Chart showing upward trend"
          * Clip 2: "Chart showing upward trend"
          * Clip 3: "Chart showing upward trend"
          * Clip 4: "Chart showing upward trend"
        * **Example of GOOD (Diverse)**: 
          * Clip 1: "Chart showing upward trend on digital display"
          * Clip 2: "Wide shot of warehouse with workers examining products"
          * Clip 3: "Close-up of documents on negotiation table"
          * Clip 4: "Split screen: production line on left, cost analysis on right"
          * Clip 5: "Overhead view of factory floor with machinery"
    * **EXAMPLES OF GOOD SUBJECT DIVERSITY** (with consistent COOL_MINIMAL color theme):
      * Clip 1: "Close-up of steel price charts on digital display with cool blue glow, workers in background, clean grey backdrop"
      * Clip 2: "Wide shot of steel mill warehouse with buyers examining coils, soft diffused cool lighting, minimal white ceiling"
      * Clip 3: "Split screen: government documents on left, steel import crates on right, clean slate grey background"
      * Clip 4: "Overhead view of negotiation table with price documents, cool white lighting, minimal backdrop"
      * Clip 5: "Side view of production line with cost charts on wall, ice blue accent lighting, grey industrial tones"
      * Clip 6: "Front view of executives in meeting room with presentation screen, soft cool lighting, white minimal interior"
    * **EXAMPLES OF BAD (TOO SIMILAR SUBJECTS OR INCONSISTENT COLORS)**:
      * ❌ Clip 1: "Steel mill with workers and upward trending chart" (same subject as others)
      * ❌ Clip 2: "Steel mill with workers and upward trending chart" (too similar!)
      * ❌ Clip 3: "Golden hour warm lighting with orange sunset" (wrong colors - no warm tones!)
      * ❌ Clip 4: "Teal neon with pink gradient" (different color theme from other clips!)
    * **VERIFICATION CHECKLIST**: Before finalizing image prompts for ALL image-based clips, check:
      * ✅ Each clip has a DISTINCT visual SUBJECT/composition
      * ✅ No two clips have the same or very similar subjects/settings
      * ✅ Visuals vary in composition, angle, focus, or perspective
      * ✅ Charts/data visualizations are varied (not all showing same trend type)
      * ✅ The sequence of visuals creates visual interest and prevents monotony
      * ✅ **ALL clips use the SAME color palette** from your chosen visual_style theme
      * ✅ **NO warm/golden/orange tones** appear in any prompt
      * ✅ **Lighting style is consistent** across all clips
    * **NOTE**: This requirement applies ONLY to image-based clips (IMAGE_ONLY/SILENT_IMAGE). AI_VIDEO clips can have similar visuals since they include influencer movement and variation
  * **CONTEXT-AWARE**: Analyze the input text to determine the actual context and adapt prompts accordingly:
  * **Geographic context**: If input mentions India → Use Indian visual elements (Hindi signage, Indian clothing, Indian architecture, etc.)
  * **Geographic context**: If input mentions USA → Use American visual elements (English signage, American clothing, American architecture, etc.)
  * **Geographic context**: If input mentions other countries → Use appropriate visual elements for that country
  * **Geographic context**: If input is global/unspecified → Use neutral, international visual elements
  * **Industry/domain context**: Adapt to the subject matter:
    * Technology/Deep Tech → Modern tech labs, GPUs, servers, digital interfaces, scientists/engineers
    * Finance/Banking → Financial institutions, trading floors, digital banking interfaces, business professionals
    * Healthcare → Medical facilities, healthcare professionals, medical equipment, hospitals
    * Education → Classrooms, educational institutions, students, teachers
    * Politics → Political settings, rallies, government buildings, political figures (adapt to country mentioned)
  * **Cultural markers**: Only include cultural elements if mentioned in the input:
    * If Indian context → Hindi/English signage, Indian clothing (kurta, saree, salwar kameez), Indian vehicles
    * If American context → English signage, American clothing, American vehicles
    * If other context → Appropriate cultural markers for that context
  * **CRITICAL**: Never write generic metadata phrases like "Indian context", "modern era", "explicitly [country] context" as text - these phrases will appear as unwanted text in images. Instead, describe the visual elements that convey these concepts.
  * **TIME PERIOD / YEAR**: If the context mentions a specific year, decade, or time period (e.g., 1978, 1980s, 1990s), you MUST include this information in the image prompt through visual descriptions
  * When year/time period is specified, describe visual elements that match that era:
    * Clothing styles from that period (e.g., "1970s Indian clothing: kurta with wide collars, bell-bottom pants")
    * Technology level (e.g., "vintage rotary phones", "older desktop computers", "smartphones with modern UI" for 2020s)
    * Architecture and building styles from that era
    * Political symbols, banners, and election materials from that specific time period
    * Design aesthetics and color palettes from that era
  * **CRITICAL: NO YEAR/DATE AS TEXT**: Never include years or dates as standalone text (e.g., "1978", "2020", "2020s") unless they are part of a calendar widget, date picker, or date display interface. Always add: "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * **CRITICAL**: If context mentions events in 1970s-1980s, the prompt MUST ensure NO modern elements (like modern smartphones, contemporary vehicles) appear, but describe this through visual elements, not year text
  * Example (Indian context): "Indian political rally with 1970s-era Congress party banners, people in 1970s Indian clothing (kurta with wide collars, bell-bottom pants), vintage Ambassador cars, period-appropriate signage from late 1970s, NOT modern smartphones, NOT contemporary vehicles, NOT showing year numbers as text, no text overlays"
  * Example (Tech context): "Modern tech lab with scientists in lab coats working on deep learning models, advanced GPUs and digital screens, contemporary 2020s technology, NOT showing year numbers as text, no text overlays"
  * Example (Banking context): "Modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, NOT showing year numbers as text, no text overlays"
* Include **comprehensive negative constraints** where ambiguity exists:
  * "NOT American Airlines, NOT US aircraft" (if applicable)
  * "NOT modern {current_date.split()[2]} elements" (if story is from past)
  * "NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface"
  * "NOT duplicate humans in the same image"
  * "NOT metadata phrases like 'Indian context' or 'modern era' as text"

### 🚨🚨🚨 CINEMATIC & EXCITING IMAGE PROMPTS (ABSOLUTELY CRITICAL - GEN Z VISUAL APPEAL):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR IMAGE PROMPTS ⚠️**
* **MANDATORY**: ALL image prompts MUST be **CINEMATIC, DETAILED, and VISUALLY EXCITING**
* **STRICT MINIMUM**: Every image prompt MUST be **AT LEAST 60-100 words** - shorter prompts result in BORING, generic visuals
* **GOAL**: Create visuals that are **TikTok/Reels-worthy**, **scroll-stopping**, and appeal to **Gen Z aesthetic**

### WHY THIS MATTERS:
* **PROBLEM**: Short/vague/generic prompts cause:
  * 🚫 BORING stock-photo-like visuals that viewers scroll past
  * 🚫 Disconnected body parts (hands floating without arms)
  * 🚫 Generic lighting that feels flat and amateur
  * 🚫 No emotional impact - viewers don't feel anything

### 🎬 CINEMATIC CAMERA WORK (REQUIRED IN EVERY PROMPT):
* **DYNAMIC ANGLES**: Use cinematic camera angles, NOT just "medium shot"
  * "Low angle hero shot" - makes subject look powerful
  * "Dutch tilt" - creates tension and unease
  * "Extreme close-up" - intimacy, detail, emotion
  * "Bird's eye overhead shot" - context and scale
  * "Over-the-shoulder" - voyeuristic, immersive
* **LENS SPECIFICATIONS**: Add lens details for professional look
  * "shot on 35mm lens" - classic cinematic
  * "shot on 50mm f/1.4" - portrait, shallow depth
  * "shot on 85mm portrait lens" - flattering compression
  * "macro lens detail" - extreme detail shots
* **DEPTH OF FIELD**: Almost every shot needs this
  * "shallow depth of field with creamy bokeh"
  * "background melting into soft blur"
  * "sharp subject against dreamy bokeh background"

### 💡 DRAMATIC LIGHTING (REQUIRED - NO FLAT LIGHTING):
* **NEVER use generic "soft lighting" or "natural light" alone** - be SPECIFIC
* **🚨 VARY LIGHTING STYLES ACROSS CLIPS** - don't use the same lighting for every image!
* **CINEMATIC LIGHTING STYLES** (rotate these across clips):
  * "Rembrandt lighting with dramatic shadows on face" - classic portrait
  * "Dramatic side lighting creating depth and dimension" - moody
  * "Three-point lighting" - professional, balanced
  * "Chiaroscuro lighting with deep shadows" - artistic, dramatic
  * "Film noir single spotlight from above" - mysterious
  * "Soft diffused window light" - natural, authentic
  * "Backlit with rim light separation" - modern, stylish
  * "Split lighting with half face in shadow" - dramatic, mysterious
  * "Butterfly lighting from above" - beauty, glamour
  * "Natural golden hour glow" - warm, cinematic (when context fits)
* **LIGHTING COLOR OPTIONS** (vary across clips - don't always use teal/pink!):
  * Cool blue/cyan rim accents - modern, tech feel
  * Warm amber edge glow - golden hour, natural
  * Deep red/burgundy undertones - dramatic, intense
  * Soft lavender fill - gentle, dreamy
  * Green/olive tones - natural, environmental
  * Neutral/white balanced - clean, professional
  * High contrast with no color cast - timeless, classic

### 🎨 CINEMATIC VISUAL AESTHETICS (DIVERSE & EXCITING):
* **🚨 CRITICAL: VARY COLOR GRADING ACROSS CLIPS** - monotonous colors kill engagement!
* **COLOR GRADING OPTIONS** (rotate these - don't repeat the same look):
  * "high contrast greyscale with subtle warm tones"
  * "moody desaturated palette with rich shadows"
  * "clean neutral tones with crisp whites"
  * "rich cinematic color with deep blacks"
  * "soft pastel color grading"
  * "cool blue-grey tones with silver highlights"
  * "warm natural skin tones with soft background"
  * "jewel tones with deep burgundy and emerald"
  * "muted earth palette with dusty rose accents"
* **BACKGROUND VARIETY** (mix these across clips):
  * "plain white/grey studio background" - clean, minimal
  * "soft pastel solid backdrop" - gentle, modern
  * "textured concrete or brick wall" - industrial, authentic
  * "brushed metal or steel surface" - tech, premium
  * "natural wood grain texture" - warm, organic
  * "fabric or paper texture backdrop" - artistic, tactile
  * "atmospheric fog or haze" - moody, cinematic
  * "environmental context" - when story demands
* **ATMOSPHERE & MOOD** (vary the energy):
  * "tense atmosphere with dramatic shadows"
  * "calm, contemplative mood with soft light"
  * "energetic and dynamic feel"
  * "intimate emotional moment frozen in time"
  * "powerful and commanding presence"
  * "mysterious with hidden details"
* **TEXTURE & DETAIL**:
  * "film grain for authentic cinematic texture"
  * "visible texture and material details"
  * "hyper-detailed surface reflections"

### 🔥 EXPRESSIONS & CAMERA DIRECTION:
* **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip
* **NEVER describe generic expressions** - add character and energy
* **EXPRESSIONS** (be specific about emotion):
  * "confident knowing smirk" NOT just "smiling"
  * "thoughtful expression with slight head tilt" NOT just "thinking"
  * "warm genuine smile reaching the eyes" NOT just "happy"
  * "intense focused gaze with furrowed brow" NOT just "looking"
  * "raised eyebrow with curious expression" NOT just "interested"
* **CAMERA DIRECTION** (MANDATORY for influencer clips):
  * Always include "speaking directly to camera" or "direct eye contact with camera"
  * **FOR INFLUENCER/PRESENTER SHOTS** (AI_VIDEO clips): Influencer must be speaking directly to camera in every frame
* **FOR OTHER SUBJECTS** (non-influencer elements in split/overlay visuals):
  * Add movement and energy for context visuals
  * Dynamic compositions for background elements

### 🚫 CRITICAL RULE FOR BODY PARTS:
* **NEVER describe hands, arms, or body parts in isolation**
* If showing a hand → MUST describe the person attached (arm, shoulder, body)
* **EVERY hand must be attached to an arm, every arm to a shoulder**

### TRANSFORMATION EXAMPLES (BORING → EXCITING with DIVERSE Styles):

**Example 1 - Hand holding diamond (Cool Greyscale Style):**
* ❌ **BORING (generic, flat)**: "Close-up of diamond under light, hand holding it in luxurious setting, no text overlays"
* ✅ **EXCITING (75 words)**: "Extreme macro close-up of master jeweler's hands delicately holding brilliant-cut diamond against clean white studio background, diamond exploding with prismatic sparkle and light refraction, visible arm in crisp white sleeve with rolled cuff, single focused spotlight from above, shallow depth of field with minimal props, shot on macro lens, chiaroscuro lighting creating dramatic shadows, high contrast greyscale tones with diamond as the only color accent, intimate moment of craftsmanship frozen in time, no text overlays"

**Example 2 - Person with product (Warm Natural Style):**
* ❌ **BORING (static, generic)**: "Woman looking at rings in jewelry store, soft lighting, modern interior, no text overlays"
* ✅ **EXCITING (82 words)**: "Cinematic medium close-up of elegant young woman against soft cream backdrop with wide eyes of wonder and slightly parted lips, dramatic Rembrandt lighting with warm key light casting beautiful shadows on her face, subtle golden rim light accent on her dark hair, stunning diamond rings sparkling in foreground creating prismatic lens flares, shallow depth of field with clean minimal background, shot on 50mm f/1.4, rich natural skin tones with warm neutral color grading, soft desaturated background, no text overlays"

**Example 3 - Document/Object (Film Noir Style):**
* ❌ **BORING (flat overhead)**: "Certification paper on desk with loupe and diamonds, professional setting, no text overlays"
* ✅ **EXCITING (78 words)**: "Dramatic bird's eye overhead shot of official diamond certification document against textured dark wood surface, single harsh spotlight creating film noir atmosphere with deep shadows, gemologist's experienced hands with vintage silver signet ring visible at edge of frame, jeweler's loupe and three loose diamonds on black velvet catching light like stars, high contrast black and white aesthetic with subtle warm undertones, minimal props clean composition, professional appraisal atmosphere with tension and anticipation, shot on 35mm, no text overlays"

**Example 4 - Comparing items (Cool Blue Style):**
* ❌ **BORING (static description)**: "Person comparing two rings, confused expression, store counter, no text overlays"
* ✅ **EXCITING (85 words)**: "Dynamic medium shot of well-dressed young woman against soft grey textured backdrop frozen mid-decision with furrowed brow and slight lip bite of uncertainty, holding two contrasting rings up to dramatic side light - large cloudy stone in left hand appearing dull, small brilliant diamond in right hand exploding with fire, her face half-illuminated with cool blue light and half in shadow creating visual tension, subtle cyan rim light accent, minimal clean background with no distracting props, shot on 85mm portrait lens, moody desaturated color palette, no text overlays"

**Example 5 - Character on plain background (Clean Minimal Style):**
* ❌ **BORING (cluttered)**: "Person in busy office environment with many objects, talking to camera"
* ✅ **EXCITING (70 words)**: "Cinematic close-up of confident young professional against clean white studio backdrop, speaking directly to camera with raised eyebrow and knowing smirk, dramatic side lighting creating beautiful shadows on face, subtle warm rim accent, minimal props clean aesthetic, shallow depth of field, high contrast look with natural skin tones and neutral background, shot on 50mm f/1.4, direct eye contact with camera, modern minimal aesthetic, no text overlays"

**Example 6 - Industrial/Tech (Moody Blue-Grey Style):**
* ✅ **EXCITING**: "Wide shot of factory floor against brushed steel backdrop, workers in safety gear examining equipment, dramatic overhead industrial lighting with cool blue-grey tones, atmospheric haze adding depth, machinery silhouettes in background, high contrast shadows, shot on 35mm lens, documentary feel with cinematic color grading, muted earth tones with steel blue accents, no text overlays"

**Example 7 - Nature/Outdoor (Golden Hour Style):**
* ✅ **EXCITING**: "Cinematic wide shot of rural landscape at golden hour, warm amber light filtering through dust particles, farmer silhouette against soft orange sky, textured earth tones with deep shadows, atmospheric depth with gentle lens flare, shot on 50mm, film grain texture, rich warm color palette with natural greens and golden highlights, nostalgic documentary mood, no text overlays"

### VERIFICATION CHECKLIST (CHECK EVERY PROMPT):
Before finalizing EACH image prompt, verify:
* ✅ Word count is **60-100 words** (count them!)
* ✅ **CAMERA**: Specific angle + lens (not just "medium shot")
* ✅ **LIGHTING**: Dramatic lighting style (VARY styles across clips!)
* ✅ **DEPTH OF FIELD**: Bokeh/blur described
* ✅ **EXPRESSION**: Specific emotion (not generic like just "happy" or "serious")
* ✅ **FOR INFLUENCER**: "speaking directly to camera" or "direct eye contact with camera" included (MANDATORY)
* ✅ **ATMOSPHERE**: Mood/feeling conveyed
* ✅ **COLOR**: Specified color palette (VARY palettes across clips - don't repeat same colors!)
* ✅ **BACKGROUND**: Context-appropriate (vary: plain, textured, environmental)
* ✅ If hands shown, FULL person described
* ✅ NO generic/stock-photo-like descriptions
* ✅ **DIVERSITY CHECK**: Is this clip's color/mood DIFFERENT from adjacent clips?

### ⚠️ IMAGE PROMPT FORMATTING (CRITICAL):
* **DO NOT** include "9:16 vertical composition" in image prompts - this causes images to be rotated 90 degrees
* **DO** use other 9:16-related descriptions like "split composition", "full frame", "upper portion", "lower portion", etc.
* **CRITICAL FOR IMAGE PROMPTS**: When generating image prompts, NEVER include split proportion text like "UPPER 55%", "LOWER 45%", "LEFT 60%", "RIGHT 40%" in the actual prompt sent to the image generation model. These are composition instructions for you to understand layout, NOT visual elements. If you include them, they will appear as unwanted text in the generated image. Instead, use descriptive phrases like "in upper portion", "in lower portion", "on the left side", "on the right side" without percentages.
* **CRITICAL: NO DUPLICATE HUMANS IN SAME IMAGE**: When generating image prompts, NEVER describe the same person (influencer or any human) appearing twice in the same image. This includes:
  * ❌ WRONG: "Dramatic visual of confused Indian freelancer in upper portion. 28-year-old Indian woman speaking in lower portion" (same person described twice)
  * ❌ WRONG: "Split composition. Indian woman on left side. Same Indian woman on right side" (same person twice)
  * ✅ CORRECT: "Dramatic visual of [context/object] in upper portion. 28-year-old Indian woman speaking directly to camera in lower portion, no text overlays" (person appears only once)
  * ✅ CORRECT: "Split composition. Visual of [context/object] on the left side. 28-year-old Indian woman speaking to camera on the right side, no text overlays" (person appears only once)
* **CRITICAL: AVOID METADATA PHRASES AS TEXT**: Never include phrases like "[country] context", "modern era", "explicitly [country]", "[country] setting", "modern context", "contemporary era" as literal text in image prompts. These phrases will appear as unwanted text in the generated images. Instead, convey these concepts through visual descriptions:
  * ❌ WRONG: "Indian Airlines plane, explicitly Indian context, modern era"
  * ✅ CORRECT: "Indian Airlines plane with Hindi signage, 1970s Indian airport setting, vintage aircraft"
  * ❌ WRONG: "Tech lab, modern era, tech context"
  * ✅ CORRECT: "Modern tech lab with scientists in lab coats, advanced GPUs, digital interfaces, contemporary technology"
  * ❌ WRONG: "Banking hall, modern era, financial context"
  * ✅ CORRECT: "Modern banking hall with digital interfaces, financial professionals, contemporary banking technology"
* The aspect ratio is already set to 9:16 in the API call, so you don't need to mention it in the prompt
* Example ❌ WRONG: "9:16 vertical composition. Image of..."
* Example ❌ WRONG: "Split composition. LEFT 60%: ... RIGHT 40%: ..." (percentages will appear as text in image)
* Example ❌ WRONG: "[Country/Industry] context, modern era" (phrases will appear as text)
* Example ✅ CORRECT: "Image of... no text overlays" or "Split composition. Visual on the left side... Visual on the right side... no text overlays"
* Example ✅ CORRECT (Indian context): "Indian Airlines plane with Hindi signage on fuselage, 1970s Indian airport terminal in background, no text overlays"
* Example ✅ CORRECT (Tech context): "Modern tech lab with scientists in lab coats, advanced GPUs and digital screens, contemporary technology, no text overlays"
* Example ✅ CORRECT (Banking context): "Modern banking hall with digital interfaces, financial professionals in business attire, contemporary banking technology, no text overlays"

### 📅 TIME PERIOD / YEAR IN IMAGE PROMPTS (CRITICAL):
* **MANDATORY**: You MUST determine the time period of the story by comparing dates in the input text with CURRENT DATE ({current_date})
* **How to determine time period**:
  1. Extract all dates, years, and time references from the input text
  2. Compare them with CURRENT DATE ({current_date})
  3. If dates are in the PAST (before {current_date}), the story is historical - use those specific years/decades
  4. If dates are in the PRESENT/FUTURE (on or after {current_date}), use current/modern time period
* **CRITICAL: YEAR/DATE AS VISUAL CONTEXT, NOT TEXT**:
  * **USE years/dates for visual context**: Describe period-appropriate elements (clothing, technology, architecture, design styles) that match the era
  * **DO NOT include years/dates as literal text**: Never write "1978", "2020", "2020s" as standalone text in prompts - these will appear as unwanted text in generated images
  * **EXCEPTION for calendars/date displays**: If the image should show a calendar, date picker, or date-related UI element, you MAY specify the actual date to display, but be VERY specific:
    * ✅ CORRECT: "Digital calendar interface showing March 15, 2024 on the calendar widget" (specific UI element)
    * ✅ CORRECT: "Quarterly calendar with payment reminders for Q1 2024, showing January, February, March months" (calendar with months)
    * ❌ WRONG: "Calendar with 2020 2020" (will appear as duplicate text)
    * ❌ WRONG: "Modern 2020s setting" (will appear as "2020s" text)
    * ✅ CORRECT: "Modern setting from 2020s era with contemporary design, smartphones, digital interfaces" (describes era through visual elements, not text)
* **What to include in image prompts**:
  * Period-appropriate visual elements (clothing, vehicles, technology, architecture) matching that era
  * Design styles and aesthetics from that time period
  * Technology level appropriate to the era (e.g., "vintage rotary phones" for 1970s, "smartphones" for 2020s)
  * If story is from the past: Negative constraint like "NOT modern {current_date.split()[2]} elements" or "NOT contemporary elements"
  * **ALWAYS add**: "NOT showing year numbers as text unless part of a calendar widget or date picker interface"

### 📆 DATES IN IMAGES - INTELLIGENT DECISION (CRITICAL):
* **MANDATORY**: You MUST intelligently decide whether to show dates in each image based on context and relevance
* **When to INCLUDE dates in image prompts**:
  * **ONLY if the date is part of the context and relevant for that specific image/clip**
  * Examples of when dates ARE relevant:
    * Historical events with specific dates (e.g., "December 20, 1978" for a hijacking event)
    * Calendar interfaces showing payment due dates, deadlines, or schedules
    * News headlines or documents displaying dates
    * Timestamps on documents, screens, or digital interfaces
    * Event announcements or invitations with dates
  * **If including a date, you MUST specify it explicitly in the image prompt**:
    * ✅ CORRECT: "Newspaper headline showing 'December 20, 1978' in the date field, Indian Airlines hijacking story"
    * ✅ CORRECT: "Digital calendar widget on smartphone screen displaying December 20, 1978 with event reminder"
    * ✅ CORRECT: "Document timestamp showing 'March 15, 2024' in the header"
* **When to EXCLUDE dates from image prompts**:
  * **If the date is NOT directly relevant to the visual content of that specific image/clip**
  * **If the date is only mentioned in the voiceover but not part of the visual context**
  * **If showing the date would be distracting or unnecessary for the image**
  * Examples of when dates are NOT needed:
    * General scene visuals (airports, buildings, people) where the date isn't part of the scene
    * Abstract or conceptual images where dates aren't relevant
    * Images focusing on people, objects, or environments without date-related context
  * **If excluding dates, you MUST explicitly state in the prompt**:
    * ✅ CORRECT: "Dramatic visual of Indian Airlines plane in flight, 1970s-era aircraft, no dates shown in image"
    * ✅ CORRECT: "Modern tech lab with scientists working, contemporary setting, no dates or timestamps visible"
* **Decision Process**:
  1. Analyze the voiceover text for the clip - does it mention a specific date?
  2. Determine if that date is relevant to the visual content of the image
  3. If YES and the date should be visible (e.g., in a document, calendar, headline):
     * Include the date explicitly in the image prompt: "showing [specific date] in [location/context]"
  4. If NO or the date is only in voiceover:
     * Explicitly state: "no dates shown in image" or "no dates or timestamps visible"
* **CRITICAL**: Always make an intelligent decision - don't include dates by default, only when they're contextually relevant and add value to the visual
* **Examples** (assuming CURRENT DATE is {current_date}):
  * If story mentions "December 20, 1978" → Story is from 1978 (PAST)
  * ❌ WRONG: "[Context] in 1978" (year may appear as text)
  * ❌ WRONG: "[Context] with 1978 banners" (year may appear as text)
  * ✅ CORRECT (Indian context): "Indian political rally with 1970s-era Congress party banners, people in 1970s Indian clothing (kurta, dhoti), vintage Ambassador cars, period-appropriate signage from late 1970s, NOT modern {current_date.split()[2]} elements, NOT showing year numbers as text, no text overlays"
  * ✅ CORRECT (Tech context): "1970s-era computer lab with vintage mainframe computers, scientists in 1970s clothing, period-appropriate technology, NOT modern {current_date.split()[2]} elements, NOT showing year numbers as text, no text overlays"
  * If story mentions "2025" or future dates → Story is from future (use modern/futuristic elements)
  * ❌ WRONG: "Modern 2025 setting" (year may appear as text)
  * ✅ CORRECT (Indian context): "Modern setting with contemporary Indian clothing, smartphones, digital payment interfaces, current design aesthetics, NOT showing year numbers as text, no text overlays"
  * ✅ CORRECT (Tech context): "Modern tech lab with contemporary technology, advanced GPUs, digital interfaces, current design aesthetics, NOT showing year numbers as text, no text overlays"
  * For calendar/date displays:
  * ❌ WRONG: "Calendar showing 2020 2020" (duplicate text)
  * ✅ CORRECT: "Digital calendar widget on smartphone screen showing March 2024, with payment reminders for March 15, 2024"

### 📅 CALENDAR AND DATE DISPLAYS IN IMAGE PROMPTS (CRITICAL):
* **When calendars or date displays are needed**:
  * ✅ CORRECT: "Digital calendar widget on smartphone screen showing March 2024, with payment reminders for March 15, 2024" (specific UI element with actual dates)
  * ✅ CORRECT: "Quarterly calendar interface showing Q1 2024 with months January, February, March displayed" (calendar with months, not just year)
  * ✅ CORRECT: "Calendar app on phone screen displaying quarterly payment schedule for 2024, showing specific months and due dates" (comprehensive description)
  * ❌ WRONG: "Calendar with 2020 2020" (duplicate year text, no context)
  * ❌ WRONG: "Calendar showing 2020s" (decade label as text)
  * ❌ WRONG: "Modern 2020s calendar" (decade may appear as text)
* **Key principles**:
  * If showing a calendar/date widget, be SPECIFIC about what dates to display (month, day, year if needed)
  * Describe the calendar as a UI element or interface component, not just "calendar with year"
  * Always specify the context (e.g., "on smartphone screen", "digital calendar widget", "payment reminder calendar")
  * For quarterly calendars, specify the quarters and months, not just the year
* **Example for quarterly tax calendar**:
  * ❌ WRONG: "Quarterly calendar with 2020 2020"
  * ✅ CORRECT: "Digital calendar interface on smartphone screen showing quarterly tax payment schedule for 2024, displaying Q1 (January-March), Q2 (April-June), Q3 (July-September), Q4 (October-December) with payment due dates and amounts, modern 2020s app design, NOT showing duplicate year numbers as text"

❌ Never rely on earlier clips for context
❌ Never generate short or vague prompts

---

## 🎵 MUSIC RULES (CRITICAL - 20 SECOND LIMIT)

⚠️ **MAXIMUM 20 SECONDS PER MUSIC GROUP** - This is a hard technical limit!

* Each music group can cover clips totaling **MAXIMUM 20 seconds**
* You MUST create multiple music groups if video is longer than 20 seconds
* Music should change at narrative shifts (not arbitrarily)

### Music Group Planning Strategy:
1. Calculate cumulative duration of clips
2. Create new music group when approaching 20 second limit
3. Align music changes with narrative beats (tension → revelation → anger → question)

### Example for 52 second video:
- **Music_A** (0-18s): Clips 0,1,2 - "Subtle, ambient background, slow tempo, gentle tension"
- **Music_B** (18-36s): Clips 3,4,5 - "Soft instrumental, moderate tempo, supportive strings"  
- **Music_C** (36-52s): Clips 6,7,8 - "Mellow background, calm tone, reflective mood"

### Music Prompt Requirements:
* Describe mood, tempo, emotional intent
* Match the narrative beat of those clips
* **IMPORTANT**: Keep music subtle and supportive - avoid overly dramatic, intense, or aggressive descriptions
* Use terms like: "subtle", "gentle", "understated", "ambient", "soft", "mellow", "calm", "peaceful"
* Avoid terms like: "intense", "dramatic", "aggressive", "powerful", "explosive", "climactic", "urgent", "pounding"
* Music should complement narration without overpowering it
* ❌ No song names or artists
* ❌ No groups exceeding 20 seconds total duration

---

## 🎙️ VOICEOVER RULES

* **LANGUAGE: {language_name}** - All voiceover text MUST be written in {language_name} language
* Spoken, simple {language_name} language (can include some English words where natural)
* Use the script/writing system appropriate for {language_name}
* Chronologically consistent with input text

### 🚨 CRITICAL: SCRIPT SIMPLICITY REQUIREMENT
* **MANDATORY**: The script/voiceover text MUST be extremely SIMPLE and easy to understand
* **Purpose**: Anyone should be able to understand the message even while casually listening (not just reading)
* **Requirements for ALL voiceover text** (both ElevenLabs voiceover AND influencer speech in AI_VIDEO clips):
  * Use **simple, everyday vocabulary** - avoid jargon, technical terms, or complex words
  * Use **short, clear sentences** - each sentence should convey ONE idea
  * Use **conversational tone** - write as if speaking to a friend
  * **Avoid complex sentence structures** - no nested clauses, multiple subjects, or convoluted phrases
  * **Repeat key terms** instead of using synonyms - consistency aids comprehension
  * **Use concrete examples** instead of abstract concepts
  * **Break down complex ideas** into multiple simple statements
* **Examples**:
  * ❌ COMPLEX: "The ramifications of the policy implementation necessitated a recalibration of strategic objectives"
  * ✅ SIMPLE: "The new policy changed everything. We had to rethink our plan."
  * ❌ COMPLEX: "Pursuant to the aforementioned circumstances, the stakeholders convened to deliberate"
  * ✅ SIMPLE: "Because of this, the team met to discuss what to do next."
* **This applies to BOTH**:
  * Regular ElevenLabs voiceover text (for IMAGE_ONLY clips)
  * Influencer speech text in AI_VIDEO clips (what the influencer says on camera)
* **The simplicity rule must be followed while still maintaining the word count constraints** (6-8 words for 4s, 10-12 words for 6s, 14-16 words for 8s AI_VIDEO clips)

### 🚨🚨🚨 VOICEOVER WORD COUNT (ABSOLUTELY CRITICAL - STRICTLY ENFORCED):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR VOICEOVERS ⚠️**
* **STRICT WORD LIMITS BY CLIP DURATION** (NO EXCEPTIONS):
  * **4-second clips**: **6-8 words ONLY** (NOT 9, NOT 10, NOT 13 - EXACTLY 6-8 words!)
  * **6-second clips**: **10-12 words ONLY** (NOT 14, NOT 15 - EXACTLY 10-12 words!)
  * **8-second clips (AI_VIDEO)**: **14-16 words ONLY**
* **WHY THIS MATTERS**: Voiceovers that exceed word limits will:
  * 🚫 Audio will be too long for clip duration
  * 🚫 Audio will be cut off mid-sentence
  * 🚫 Video pacing will be broken
  * 🚫 User experience will be poor

### HOW TO COUNT WORDS:
* **ONLY count spoken words** - the actual words the viewer will hear
* Example: "This is amazing" = **3 words**
* Example: "These mistakes are universal" = **4 words**

{word_count_examples}

### MANDATORY VERIFICATION:
* **COUNT EVERY VOICEOVER** before finalizing
* For EACH voiceover, ask: "Does this match the clip duration?"
  * 4-second clip → Is it 6-8 words? If not, REWRITE shorter
  * 6-second clip → Is it 10-12 words? If not, REWRITE shorter/longer
  * 8-second clip → Is it 14-16 words? If not, REWRITE shorter/longer
* **If voiceover is too long → CONDENSE the message, don't change clip duration**
* **Keep the ESSENCE but use FEWER words**

{square_bracket_sparingly_instructions}

### 🚨🚨🚨 NARRATIVE STRUCTURE - HOOKS ARE MANDATORY (ABSOLUTELY CRITICAL):
* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR VIDEO ENGAGEMENT ⚠️**
* **PROBLEM**: Videos without proper hooks feel flat, boring, and get scrolled past
* **EVERY VIDEO MUST HAVE**: Opening Hook → Middle Engagement → Strong Ending

### 🎬 CLIP 1 OPENING HOOK (MANDATORY - MUST BE AI_VIDEO):
* **Clip 0**: Silent visual hook with text overlay (grabs attention visually) - SILENT_IMAGE
* **Clip 1**: **MUST be AI_VIDEO** - Influencer delivers the FIRST VOICEOVER with **CONTEXT + HOOK**
* **⚠️ CRITICAL**: Clip 1 is the FIRST thing viewers HEAR - having the influencer introduce the topic creates immediate connection!
* **WHY AI_VIDEO for Clip 1**: The influencer speaking directly to the viewer establishes trust and engagement from the start

### 🚨 CLIP 1 MUST SET CONTEXT (VERY IMPORTANT):
* **PROBLEM**: Clip 0 is SILENT - viewers only SEE the text overlay but don't HEAR it
* **SOLUTION**: Clip 1 MUST verbally introduce the topic/context BEFORE or WHILE delivering the hook
* **WHY**: Starting with "What if these mistakes..." is confusing - viewers ask "what mistakes?"
* **RULE**: Clip 1 voiceover should contain BOTH:
  1. **CONTEXT**: What is this video about? (topic introduction)
  2. **HOOK**: Why should I keep watching? (engagement element)
* **COMBINE them into ONE flowing sentence** - don't make context boring, make it part of the hook!

**🚫 BAD CLIP 1 OPENINGS (NO CONTEXT - SOUNDS ABRUPT & CONFUSING):**
* ❌ "What if these mistakes ruin your proposal?" (What mistakes? No context!)
* ❌ "These ring mistakes break hearts unnecessarily." (jumps in without intro)
* ❌ "These are the mistakes people make." (flat, no context, no hook)
* ❌ "Let me tell you about five mistakes." (weak, vague, no topic)

**✅ GOOD CLIP 1 OPENINGS (CONTEXT + HOOK COMBINED - ENGAGING & CLEAR):**
* ✅ "Buying an engagement ring? Five mistakes could ruin it." (Context: buying ring + Hook: mistakes)
* ✅ "Diamond ring shopping has five hidden traps. Are you falling in?" (Context: diamond shopping + Hook: traps/question)
* ✅ "Your perfect ring might be ruined by these five mistakes." (Context: ring + Hook: ruined/mistakes)
* ✅ "Engagement ring buyers make five costly errors. Don't be one." (Context: ring buyers + Hook: costly errors)
* ✅ "Before you buy that diamond, know these five mistakes." (Context: buying diamond + Hook: know mistakes)

**FORMULA FOR CLIP 1**: [TOPIC/CONTEXT] + [HOOK ELEMENT]
* Topic + Question: "Buying a ring? What if you're making a mistake?"
* Topic + Bold Claim: "Diamond rings have five costly secrets most buyers miss."
* Topic + Urgency: "Ring shopping? Stop. These mistakes cost thousands."
* Topic + Story: "When I bought my ring, I almost made this fatal error."

### 🏁 ENDING CLIP (MANDATORY - MUST NOT BE ABRUPT):
* **Final clip** MUST end with a proper conclusion, NOT mid-thought
* **EVERY ending needs**: CTA (Call-to-Action) OR Question OR Reflective Statement

**🚫 BAD ENDINGS (ABRUPT - LEAVES VIEWERS CONFUSED):**
* ❌ "Mistake five: Thinking buying is hard; it's creating your story." (ends on a mistake, no conclusion)
* ❌ "That's the fifth mistake." (abrupt, no engagement, no closure)
* ❌ "It's about pulling out the story." (trailing off, incomplete)

**✅ GOOD ENDINGS (STRONG CLOSURE - DRIVES ENGAGEMENT):**
* ✅ "[passionate] Your ring should tell YOUR story. Ready to create yours? Comment below!" (CTA + Transformation Promise)
* ✅ "[reflective] The ring isn't hard. The story is priceless. What's your ring story?" (Reflective + Question)
* ✅ "[empowering] Find a jeweler who listens. Your love story deserves nothing less." (Transformation Promise)
* ✅ "[hopeful] Avoid these mistakes, create your legacy. Share this with someone ring shopping!" (CTA + Value)

* **CRITICAL: SCRIPT STRUCTURE FOR SCROLL-STOPPING VIDEOS**:
  * **STARTING HOOK (Clip 0 or Clip 1)**: Must grab attention immediately using one of these hooks:
    * **Visual Pattern Interrupt**: Fast cuts, bold visuals, sudden change
    * **Shock/Surprise Hook**: Unexpected statement or visual
    * **Curiosity Gap Hook**: Withhold key information to force continuation
    * **Question Hook**: Force the brain to internally answer
    * **Bold Claim Hook**: Strong, confident statement
    * **Story-Start Hook**: Drop viewer into unfolding narrative
    * **Confrontation Hook**: Challenge viewer's beliefs (use carefully)
  * **MIDDLE CONTENT (Clips 2-N-1)**: Build engagement with:
    * **Myth vs Reality**: Challenge misinformation
    * **Transformation**: Show before/after contrast
    * **Authority**: Signal expertise with numbers, years, outcomes
    * **Relatability**: Make viewer feel understood
    * **Mistake Hook**: Highlight costly/common errors
    * **Social Proof**: Leverage herd psychology
  * **ENDING (Final Clip)**: Choose ending style based on context/industry:
    * **For Political/News, Marketing, E-commerce, Events**: Include Strong CTA + Question
      * **Strong CTA (Call-to-Action)**: Clear next step (share, comment, follow, learn more)
      * **Engaging Question**: Force reflection or engagement
      * **Time-Bound Hook**: Create urgency if applicable (best for: E-commerce, Events, Launches)
    * **For Educational, Documentary, Informational**: May end with reflective statement or transformation promise
      * **Transformation Promise**: Show what's possible
      * **Reflective Statement**: Thought-provoking conclusion
      * **Question**: Optional, only if it adds value
    * **For Entertainment, Storytelling**: May end with narrative conclusion or cliffhanger
      * **Story Conclusion**: Satisfying narrative wrap-up
      * **Cliffhanger**: If part of series
      * **CTA**: Optional, only if appropriate
    * **CRITICAL**: Analyze the context - CTA/Question is NOT always necessary. Use judgment based on:
      * Industry norms (marketing needs CTA, documentaries may not)
      * Content type (educational may end with insight, not CTA)
      * User instruction (if user specifies ending style, follow it)
* **🚨 MANDATORY: HOOKS MUST ALWAYS BE USED IN ALL THREE STAGES**:
  * **CRITICAL REQUIREMENT**: Every video plan MUST explicitly include hooks in ALL THREE stages:
    * **1. STARTING STAGE (Clip 0 or Clip 1)**: MUST have at least one starting hook
    * **2. MIDDLE STAGE (Clips 2 to N-1)**: MUST have at least one middle hook (distribute across multiple middle clips)
    * **3. ENDING STAGE (Final Clip)**: MUST have at least one ending hook
  * **NEVER SKIP A STAGE**: You cannot create a video with hooks in only one or two stages - ALL THREE stages must have hooks
  * **DEFAULT HOOK COMBINATION** (use when context is unclear or for general content):
    * **Starting**: **Shock/Surprise Hook** + **Story-Start Hook** (combination for maximum impact)
    * **Middle**: **Myth vs Reality** + **Authority** (build credibility while challenging assumptions) - use across multiple middle clips
    * **Ending**: **Strong CTA + Question** (drive engagement and action)
  * **ALWAYS SPECIFY**: In your JSON response, explicitly state which hooks you're using for each section
  * **VERIFICATION**: Before finalizing your plan, verify that:
    * ✅ Starting clip(s) have a starting hook
    * ✅ At least one middle clip has a middle hook
    * ✅ Ending clip has an ending hook
  * **HOOK SELECTION BY CONTEXT**:
  * **Political/News Videos** (PRIMARY USE CASE - optimized for political content):
    * **Starting Hooks** (Clip 0 or Clip 1):
      * **Shock/Surprise Hook**: Unexpected revelations, scandals, breaking news - "You won't believe what happened..."
      * **Story-Start Hook**: Drop viewer into unfolding political narrative - "On December 20, 1978, something changed forever..."
      * **Confrontation Hook**: Challenge political beliefs or actions - "They told you X, but here's what really happened..."
      * **Question Hook**: Force reflection on political issues - "What if everything you knew about this was wrong?"
      * **Bold Claim Hook**: Strong political statement - "This single event changed Indian politics forever"
      * **DEFAULT for Political**: **Shock/Surprise Hook** + **Story-Start Hook** (combination)
    * **Middle Hooks** (Clips 2 to N-1):
      * **Myth vs Reality**: Challenge political misinformation - "Everyone thinks X, but the truth is Y..."
      * **Authority**: Use numbers, dates, years, official records - "According to official records from 1978..."
      * **Mistake Hook**: Highlight costly political errors - "This was the mistake that cost them everything..."
      * **Transformation**: Show before/after political change - "Before this, the country was X, after this it became Y..."
      * **Social Proof**: Leverage public opinion or historical consensus - "126 passengers witnessed this..."
      * **DEFAULT for Political**: **Myth vs Reality** + **Authority** (combination)
    * **Ending Hook** (Final Clip) - For Political/News, CTA is typically recommended:
      * **Strong CTA + Question**: "Share this if you believe in transparency" + "What do you think really happened?"
      * **Time-Bound Hook**: Create urgency for political action - "This happened in 1978, but it's still relevant today..."
      * **Transformation Promise**: Show what's possible - "This is how we can prevent this from happening again..."
      * **DEFAULT for Political**: **Strong CTA + Question** (combination)
      * **Note**: For political content, ending with CTA + Question is usually effective, but use judgment based on specific context
  * **Finance/Economics**: Bold Claim, Myth vs Reality, Mistake Hook, Authority
    * **DEFAULT**: **Bold Claim** + **Authority** (combination)
  * **Technology**: Curiosity Gap, Authority, Transformation, Social Proof
    * **DEFAULT**: **Curiosity Gap** + **Authority** (combination)
  * **Education**: Question Hook, Myth vs Reality, Relatability, Transformation
    * **DEFAULT**: **Question Hook** + **Myth vs Reality** (combination)
  * **Health/Wellness**: Transformation, Relatability, Authority, Mistake Hook
    * **DEFAULT**: **Transformation** + **Authority** (combination)
  * **Business/Startups**: Bold Claim, Authority, Social Proof, Contrarian
    * **DEFAULT**: **Bold Claim** + **Social Proof** (combination)
  * **General/Entertainment**: Visual Pattern Interrupt, Story-Start, Relatability, Question Hook
    * **DEFAULT**: **Story-Start Hook** + **Question Hook** (combination)
* **🚨 CRITICAL: NARRATIVE FLOW AND CONNECTING WORDS BETWEEN CLIPS**:
  * **PROBLEM**: Without proper flow, clips feel disjointed and stitched together, not like a cohesive narrative
  * **SOLUTION**: Voiceovers MUST flow naturally from one clip to the next, creating a holistic message delivery
  * **MANDATORY REQUIREMENTS**:
    * **1. MANDATORY: Use Connecting Words/Phrases at START or END of Voiceovers**:
      * **CRITICAL RULE**: Each voiceover (except the first clip) MUST either:
        * **START with a connecting word/phrase** (e.g., "Meanwhile...", "Additionally...", "This led to...", "As a result...", "Following this...", "Because of this...", "This caused...", "Consequently...", "Therefore...", "However...", "But...", "Yet...", "Then...", "Next...", "After that...", "Subsequently...", "In response...", "This meant...", "This resulted in...", "The impact was...", "The consequence was...", "What happened next...", "At the same time...", "Simultaneously...", "Later...", "Eventually...", "In the aftermath...")
        * **OR END with a connecting phrase** that sets up the next clip (e.g., "...which led to...", "...causing...", "...resulting in...", "...and this...", "...meanwhile...", "...at the same time...", "...which meant...", "...which caused...", "...which resulted in...")
      * **EXCEPTION**: Connecting words are NOT mandatory ONLY if the voiceover naturally flows from the previous clip through:
        * **Pronouns that clearly reference the previous clip** (e.g., "This surge..." refers to "prices climbing" from previous clip, "They..." refers to "mills" from previous clip, "It..." refers to a clear subject from previous clip)
        * **Direct continuation of the same thought** (e.g., Clip 1: "Prices are climbing fast" → Clip 2: "This surge comes from..." - "This surge" already connects)
      * **WHEN TO USE CONNECTORS** (use MORE OFTEN than not):
        * **ALWAYS use connectors when**:
          * The topic shifts slightly (e.g., from "prices rose" to "mills lifted offers" → use "As a result..." or "This led to..." or "Meanwhile...")
          * Introducing a new factor or additional information (e.g., "Additionally...", "Moreover...", "Furthermore...", "What's more...", "Not only that...", "Also...", "Plus...", "At the same time...", "Simultaneously...")
          * Showing cause-effect (e.g., "This caused...", "Because of this...", "As a result...", "Consequently...", "Therefore...", "This led to...", "Following this...", "Subsequently...")
          * Showing contrast (e.g., "However...", "But...", "Yet...", "Despite this...", "On the other hand...", "In contrast...", "While...", "Although...")
          * Showing continuation or sequence (e.g., "Then...", "Next...", "After that...", "Subsequently...", "Following this...", "Meanwhile...", "Later...", "Eventually...")
          * The previous clip ended and the next clip introduces a new aspect (e.g., "Meanwhile...", "At the same time...", "Additionally...")
          * The voiceover feels like it could be standalone without context
        * **PREFERRED: Use connectors even when flow seems clear** - it's better to have explicit connectors than risk disjointed feeling
        * **RARE EXCEPTION: Skip connectors only when**:
          * The voiceover starts with a pronoun that clearly references the previous clip (e.g., "This surge..." after "prices climbing", "They..." after "mills", "It..." after clear subject)
          * The voiceover is a direct continuation of the exact same sentence/thought from the previous clip
      * **PLACEMENT STRATEGY**:
        * **Prefer STARTING connectors** (most common): "Additionally, trade policy changes..." or "Meanwhile, domestic mills..." or "As a result, producers gained..."
        * **Use ENDING connectors** when it sets up the next clip naturally: "...which gave producers leverage" → next clip: "They can now increase prices"
        * **Use MID-SENTENCE connectors** when appropriate: "Prices rose, and this led to..."
    * **2. Maintain Narrative Continuity**:
      * Each clip's voiceover should logically follow from the previous clip
      * Avoid abrupt topic changes without transition
      * Build a coherent story arc across all clips
      * Reference previous information when relevant (e.g., "As mentioned earlier...", "Remember...", "As we saw...", "Building on this...", "This surge..." (referring to previous clip), "They..." (referring to previous subject))
    * **3. Create Holistic Message Delivery**:
      * The entire video should feel like ONE cohesive narrative, not separate clips
      * Each voiceover should contribute to the overall message/story
      * Avoid making clips feel like isolated statements
      * Ensure the final clip ties back to earlier clips when appropriate
    * **4. Examples of Good Flow with Connectors**:
      * ❌ **BAD (Disjointed - NO connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast."
        * Clip 2: "Domestic mills are lifting offers now." ← NO connector, feels abrupt
        * Clip 3: "Sellers anticipate continued cost pressures." ← NO connector, feels abrupt
        * Clip 4: "Limited supply of base steel persists." ← NO connector, feels abrupt
      * ✅ **GOOD (Connected with STARTING connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast [calm, authoritative]."
        * Clip 2: "This surge comes mainly from mill price hikes and rising costs [calm, experienced]." ← "This surge" connects
        * Clip 3: "As a result, domestic mills are lifting offers now [calm, informative]." ← "As a result" connects
        * Clip 4: "Meanwhile, sellers anticipate continued cost pressures [calm, insightful]." ← "Meanwhile" connects
        * Clip 5: "Additionally, trade policy changes have reduced cheap import competition [calm, knowledgeable]." ← "Additionally" connects
        * Clip 6: "This gives producers more leverage [calm, steady]." ← "This" connects
        * Clip 7: "They can now increase local selling prices [calm, explanatory]." ← "They" connects
        * Clip 8: "Meanwhile, limited supply of base steel persists [calm, factual]." ← "Meanwhile" connects
        * Clip 9: "Additionally, firm market sentiment and higher production costs have contributed [calm, conclusive]." ← "Additionally" connects
      * ✅ **BETTER (Mixed STARTING and ENDING connectors)**: 
        * Clip 1: "Indian coated steel prices are climbing fast [calm, authoritative]."
        * Clip 2: "This surge comes mainly from mill price hikes and rising costs [calm, experienced]."
        * Clip 3: "As a result, domestic mills are lifting offers now [calm, informative]."
        * Clip 4: "Sellers anticipate continued cost pressures, which is causing buyers to stock ahead [calm, insightful]." ← ending connector
        * Clip 5: "Additionally, trade policy changes have reduced cheap import competition [calm, knowledgeable]."
        * Clip 6: "This gives producers more leverage, allowing them to increase prices [calm, steady]." ← ending connector
        * Clip 7: "They can now increase local selling prices with reduced competition [calm, explanatory]."
        * Clip 8: "Meanwhile, limited supply of base steel persists [calm, factual]."
        * Clip 9: "Furthermore, firm market sentiment and higher production costs have contributed [calm, conclusive]."
    * **5. Language-Specific Connecting Words** (for {language_name}):
      * Use appropriate connecting words in {language_name} language
      * **Starting connectors** (use at START of voiceover):
        * English: "Additionally", "Moreover", "Furthermore", "Meanwhile", "However", "But", "Yet", "Then", "Next", "After that", "As a result", "Because of this", "This caused", "Consequently", "Therefore", "This led to", "Following this", "Subsequently", "In response", "This meant", "This resulted in", "The impact was", "The consequence was", "What happened next", "At the same time", "Simultaneously", "Later", "Eventually", "In the aftermath", "On the other hand", "In contrast", "While", "Although", "Despite this"
        * Hindi: "इसके बाद", "फिर", "तब", "उस समय", "इस दौरान", "परिणामस्वरूप", "इस कारण", "लेकिन", "हालांकि", "इसके अलावा", "इसके साथ ही", "जबकि", "इस बीच", "बाद में", "अंत में", "इसका मतलब था", "इसका नतीजा यह हुआ", "इसके परिणामस्वरूप", "इस वजह से", "इसलिए", "फलस्वरूप"
        * Punjabi: "ਇਸ ਤੋਂ ਬਾਅਦ", "ਫਿਰ", "ਤਦ", "ਉਸ ਸਮੇਂ", "ਇਸ ਦੌਰਾਨ", "ਨਤੀਜੇ ਵਜੋਂ", "ਇਸ ਕਾਰਨ", "ਪਰ", "ਹਾਲਾਂਕਿ", "ਇਸ ਤੋਂ ਇਲਾਵਾ", "ਇਸ ਦੇ ਨਾਲ ਹੀ", "ਜਦਕਿ", "ਇਸ ਦੌਰਾਨ", "ਬਾਅਦ ਵਿੱਚ", "ਅੰਤ ਵਿੱਚ"
        * Gujarati: "આ પછી", "પછી", "ત્યારે", "આ સમય દરમ્યાન", "પરિણામે", "આ કારણે", "પરંતુ", "જોકે", "આ ઉપરાંત", "આ સાથે", "જ્યારે", "આ દરમ્યાન", "પછીથી", "અંતે"
      * **Ending connectors** (use at END of voiceover):
        * English: "...which led to...", "...causing...", "...resulting in...", "...and this...", "...meanwhile...", "...at the same time...", "...which meant...", "...which caused...", "...which resulted in...", "...which gave...", "...which allowed...", "...which enabled..."
        * Hindi: "...जिससे...", "...जिसका मतलब था...", "...जिसके परिणामस्वरूप...", "...जिसके कारण...", "...और इससे...", "...जबकि...", "...इस बीच..."
        * Adapt connecting words to the specific language being used
    * **6. Verification Checklist for Each Voiceover**:
      * For each voiceover (except Clip 0), ask:
        * ✅ Does it START with a connecting word/phrase? (If not, check if flow is clear)
        * ✅ Does it END with a connecting phrase that sets up the next clip? (If not, check if flow is clear)
        * ✅ If neither, does it naturally flow from the previous clip through pronouns or direct continuation? (e.g., "This surge..." refers to previous clip)
        * ✅ If it feels like it could be standalone without context, ADD a connecting phrase
        * ✅ Does the entire sequence feel like ONE cohesive narrative?
  * **FINAL VERIFICATION**: Before finalizing ALL voiceovers, check the ENTIRE sequence:
    * ✅ Read all voiceovers in sequence - do they flow naturally?
    * ✅ Are connecting words/phrases used where there's a potential disconnect?
    * ✅ Does the entire video feel like ONE cohesive narrative?
    * ✅ Would a viewer understand the story even if they missed a clip?
    * ✅ If any clip feels disconnected, ADD a connecting word/phrase at the START or END
* **SCRIPT PACING**: 
  * **STARTING**: Start fast and attention-grabbing (MUST have a starting hook in Clip 0 or Clip 1)
  * **MIDDLE**: Maintain momentum (MUST have at least one middle hook distributed across Clips 2 to N-1)
  * **ENDING**: End strong (MUST have an ending hook in the final clip - CTA + question for engagement, OR reflective statement/transformation promise based on context)
  * **CRITICAL**: All three stages (starting, middle, ending) MUST have hooks - never skip any stage
* **ENDING REQUIREMENT**: Final clip ending style depends on context:
  * **Political/News, Marketing, E-commerce**: Typically end with CTA + Question
  * **Educational, Documentary**: May end with reflective statement or transformation promise
  * **Entertainment, Storytelling**: May end with narrative conclusion
  * Use judgment - CTA/Question is NOT mandatory for all contexts
  * **CRITICAL**: Regardless of ending style, the ending clip MUST have an ending hook (CTA, Question, Transformation Promise, Reflective Statement, etc.)
* **🚨 FINAL VERIFICATION - HOOKS IN ALL THREE STAGES**:
  * Before finalizing your video plan, verify that hooks are present in ALL THREE stages:
    * ✅ **STARTING**: At least one starting hook in Clip 0 or Clip 1
    * ✅ **MIDDLE**: At least one middle hook in one or more clips from Clips 2 to N-1
    * ✅ **ENDING**: At least one ending hook in the final clip
  * **NEVER submit a video plan with hooks in only one or two stages - ALL THREE stages are mandatory**

### 🚨 CRITICAL: NUMBERS, DATES, AND YEARS MUST BE IN {language_name}
* **MANDATORY**: All numbers, dates, and years in voiceover text MUST be written in {language_name} words, NOT in English numerals
* This ensures proper pronunciation by the TTS system and influencer (if using Veo3.1 audio)
* **Convert ALL numbers to {language_name} words**:
  * Example for Hindi: "410" → "चार सौ दस" (char sau das)
  * Example for Hindi: "1978" → "उन्नीस सौ अठहत्तर" (unnees sau atthatar)
  * Example for Hindi: "20 दिसंबर" → "बीस दिसंबर" (bees disambar)
  * Example for Hindi: "126 यात्री" → "एक सौ छब्बीस यात्री" (ek sau chhabbees yaatri)
* **Apply this rule to**:
  * Flight numbers (e.g., "IC-410" → "IC चार सौ दस")
  * Years (e.g., "1978" → "उन्नीस सौ अठहत्तर")
  * Dates (e.g., "20 दिसंबर" → "बीस दिसंबर")
  * Quantities (e.g., "126" → "एक सौ छब्बीस")
  * Any other numbers in the voiceover text
* **Example voiceover text**:
  * ❌ WRONG: "20 दिसंबर 1978 को, इंडियन एयरलाइंस की फ्लाइट IC-410 कोलकाता से दिल्ली जा रही थी"
  * ✅ CORRECT: "बीस दिसंबर उन्नीस सौ अठहत्तर को, इंडियन एयरलाइंस की फ्लाइट IC चार सौ दस कोलकाता से दिल्ली जा रही थी"
* **For other languages**: Apply the same rule - convert all numbers to words in the target language

---

## 📦 REQUIRED JSON OUTPUT SCHEMA (STRICT)

```json
{{{{
  "input_summary": {{{{
    "key_events": [],
    "people_mentioned": [],
    "locations": [],
    "time_periods": []
  }}}},
  "hook_breakdown": {{{{
    "hook_text": "The exact text/visual that appears at timestamp 0.0s",
    "hook_category": "Type: Shock/Surprise | Story-Start | Confrontation | Question | Bold Claim | Curiosity Gap | Visual Pattern Interrupt",
    "hook_psychology_trigger": "Why this hook works psychologically (e.g., 'Triggers loss aversion', 'Creates curiosity gap')",
    "hook_delivery_style": "How the hook is delivered (e.g., 'Direct address to camera', 'Bold text overlay', 'Visual reveal')",
    "hook_duration_seconds": "How long the hook lasts (typically 1.5-3 seconds)",
    "hook_visual_treatment": "Visual style of the hook (e.g., 'Fast cut', 'Zoom in', 'Text animation')",
    "hook_reveal_rule": "What information is withheld and when it will be revealed"
  }}}},
  "video_strategy_summary": {{{{
    "core_emotion": "Primary emotion the video evokes (e.g., 'curiosity', 'urgency', 'fear of missing out', 'hope')",
    "tension_arc": "How tension builds and releases (e.g., 'Hook creates mystery → Middle builds stakes → Reveal delivers payoff')",
    "retention_mechanism": "What keeps viewers watching (e.g., 'Open loops every 5s', 'Unexpected reveals', 'Story progression')",
    "payoff_type": "Type of ending: 'insight' | 'reframed belief' | 'emotional satisfaction' | 'call to action'"
  }}}},
  "visual_style": {{{{
    "chosen_theme": "Theme name - use example (COOL_MINIMAL, TEAL_MODERN, etc.) OR create custom (e.g., OCEAN_CORPORATE, WARM_EARTH)",
    "primary_colors": ["List 2-3 primary colors for this video, e.g., 'white', 'slate grey', 'teal'"],
    "accent_color": "One accent color used sparingly, e.g., 'ice blue' or 'coral'",
    "background_style": "Primary background style: 'solid minimal' | 'soft gradient' | 'textured minimal' | 'atmospheric'",
    "lighting_style": "Primary lighting: 'soft diffused cool' | 'rembrandt cool' | 'backlit rim' | 'high contrast'",
    "theme_reasoning": "Brief explanation of why this theme fits the content (1 sentence)"
  }}}},
  "video_overview": {{{{
    "total_duration_seconds": 0,
    "total_clips": 0,
    "ai_video_clips_used": 0,
    "b_roll_clips_used": 0,
    "b_roll_reused_count": 0,
    "video_group_clips_used": 0
  }}}},
  "clips": [
    {{{{
      "clip_number": 0,
      "timestamp": "0.0s",
      "duration_seconds": 4,
      "clip_type": "SILENT_IMAGE",
      "voiceover": "",
      "on_screen_text": "Text overlay for Clip 0 hook. Example: '5 Ring Mistakes'",
      "tension_purpose": "Creates curiosity gap with visual hook",
      "prompt": "Image prompt for Clip 0 with text overlay (no 'no text overlays' instruction)",
      "music_group": "Music_A",
      "hook_type": "Visual Pattern Interrupt"
    }}}},
    {{{{
      "clip_number": 1,
      "timestamp": "4.0s",
      "duration_seconds": 8,
      "clip_type": "AI_VIDEO",
      "voiceover": "The voiceover text the influencer speaks (14-16 words)",
      "tension_purpose": "Establishes context and hooks viewer with influencer connection",
      "prompt": "Full video prompt with scene description, language instructions, and voiceover text",
      "starting_image_prompt": "Image prompt for starting frame (visual only, ends with 'no text overlays')",
      "music_group": "Music_A",
      "is_influencer_clip": true,
      "failover_image_prompt": "Backup image prompt without influencer for failover",
      "failover_effect_hint": "Effect hint for failover image",
      "hook_type": "Shock/Surprise"
    }}}},
    {{{{
      "clip_number": 2,
      "timestamp": "12.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for this B_ROLL clip",
      "tension_purpose": "Builds visual context with dynamic footage",
      "is_reuse": false,
      "image_prompt": "Cinematic image prompt for starting frame generation (ends with 'no text overlays')",
      "video_prompt": "Video generation prompt describing motion, dynamics, camera work",
      "music_group": "Music_A",
      "hook_type": "Authority"
    }}}},
    {{{{
      "clip_number": 3,
      "timestamp": "16.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover text for video group clip",
      "tension_purpose": "Shows multiple perspectives rapidly",
      "is_reuse": false,
      "video_group": [
        {{{{
          "image_prompt": "First image prompt for starting frame",
          "video_prompt": "First video motion description",
          "rank": 1
        }}}},
        {{{{
          "image_prompt": "Second image prompt for starting frame",
          "video_prompt": "Second video motion description",
          "rank": 2
        }}}}
      ],
      "music_group": "Music_A",
      "hook_type": "Transformation"
    }}}},
    {{{{
      "clip_number": 8,
      "timestamp": "32.0s",
      "duration_seconds": 4,
      "clip_type": "B_ROLL",
      "voiceover": "Voiceover that relates to previously shown visual",
      "tension_purpose": "Reinforces earlier message with reused visual",
      "is_reuse": true,
      "reuse_from_clip": 2,
      "reuse_video_index": 0,
      "music_group": "Music_B",
      "hook_type": "Relatability"
    }}}}
  ],
  "music_groups": {{{{
    "Music_A": {{{{
      "mood": "tense, suspenseful",
      "tempo": "slow",
      "prompt": "Detailed music generation prompt for ElevenLabs sound effects",
      "clips": [0, 1, 2],
      "total_duration_seconds": 16
    }}}},
    "Music_B": {{{{
      "mood": "dramatic, urgent",
      "tempo": "medium-fast",
      "prompt": "Different music prompt for narrative shift",
      "clips": [3, 4, 5],
      "total_duration_seconds": 18
    }}}}
  }}}},
  "research_integration": [
    {{{{
      "claim_used": "Specific claim or stat from research that was integrated",
      "source_context": "Brief context about where this information came from",
      "integration_method": "How it was woven into the narrative (e.g., 'Used as hook', 'Authority signal', 'Supporting evidence')"
    }}}}
  ]
}}}}
```

**NOTE on B_ROLL fields**:
* `clip_type`: Use `"B_ROLL"` for all non-influencer, non-silent clips (replaces IMAGE_ONLY)
* `is_reuse`: **REQUIRED** for B_ROLL - `false` for new generation, `true` for reusing existing
* `image_prompt` + `video_prompt`: For single B_ROLL (new generation only)
* `video_group`: For multi-video B_ROLL (array with image_prompt, video_prompt, rank for each)
* `reuse_from_clip` + `reuse_video_index`: For reused B_ROLL only

**NOTE on Clip Types**:
* `SILENT_IMAGE`: Clip 0 only - static image with text overlay
* `AI_VIDEO`: Influencer clips with speech (A-roll)
* `B_ROLL`: Dynamic video clips without speech (replaces IMAGE_ONLY)

**NOTE on NEW STRATEGY FIELDS**:
* `hook_breakdown`: **REQUIRED** - Detailed analysis of the opening hook strategy
* `video_strategy_summary`: **REQUIRED** - Overall engagement and retention strategy
* `timestamp`: **REQUIRED** for each clip - Running timestamp (e.g., "0.0s", "4.0s", "8.0s")
* `tension_purpose`: **REQUIRED** for each clip - What engagement purpose this clip serves
* `on_screen_text`: **OPTIONAL** - Text overlay content (especially important for Clip 0)
* `research_integration`: **REQUIRED** array - Even if empty [], must be present; list any research/stats used

---

## 📌 FIELD VALIDATION RULES

* `"clip_type"` must be exactly:
  * `SILENT_IMAGE` - Clip 0 only (static image with text overlay)
  * `B_ROLL` - Dynamic video clips (replaces IMAGE_ONLY)
  * `AI_VIDEO` - Influencer clips with speech
* `"duration_seconds"` must be **4 or 8 only**
  * **4 seconds**: For B_ROLL clips and SILENT_IMAGE (Clip 0)
  * **8 seconds**: For AI_VIDEO clips in influencer mode only
{ai_video_duration_rule}
{ai_video_count_rule}
* `"voiceover"` must be empty for Clip 0
* `"is_influencer_clip"` is true ONLY for AI_VIDEO clips in influencer mode
* `"hook_type"` is **MANDATORY** for ALL clips - explicitly state which hook is used:
  * **Starting clips (Clip 0 or Clip 1)**: Must have one of: 'Shock/Surprise', 'Story-Start', 'Confrontation', 'Question', 'Bold Claim', 'Curiosity Gap', 'Visual Pattern Interrupt'
  * **Middle clips (Clips 2 to N-1)**: Must have at least one clip with: 'Myth vs Reality', 'Transformation', 'Authority', 'Relatability', 'Mistake', 'Social Proof', 'Contrarian'
  * **Ending clip (Final clip)**: Must have one of: 'CTA', 'Question', 'Time-Bound', 'Transformation Promise', 'Reflective Statement'
  * **CRITICAL**: ALL THREE stages (starting, middle, ending) MUST have hook_type specified - never skip any stage

### B_ROLL Validation:
* `"is_reuse"` is **REQUIRED** for ALL B_ROLL clips - set to `false` for new generation, `true` for reuse
* For NEW B_ROLL (is_reuse=false):
  * **Single video**: Use `"image_prompt"` + `"video_prompt"` fields
  * **Video group**: Use `"video_group"` array with objects containing `"image_prompt"`, `"video_prompt"`, `"rank"`
* For REUSED B_ROLL (is_reuse=true):
  * Use `"reuse_from_clip"` (clip number) + `"reuse_video_index"` (0-indexed, which video to reuse)
  * Do NOT include image_prompt, video_prompt, or video_group
* `"video_group"` array must have **2-3 video objects**, each with:
  * `"image_prompt"`: For generating starting frame image
  * `"video_prompt"`: For generating 4s video from that image
  * `"rank"`: Order by voiceover relevance (1 = best match)
* Videos in `"video_group"` MUST be **different but related** - NOT similar variations
* ~{image_group_pct}% of B_ROLL clips should use video groups for dynamic feel
* **🚨 6-SECOND B_ROLL CLIPS MUST ALWAYS USE video_group** - NEVER single image/video for 6s clips
* **NEVER reuse B_ROLL at AI_VIDEO positions** - influencer clips are always unique
* SILENT_IMAGE (Clip 0) should NOT be B_ROLL - always single static image with text overlay
* AI_VIDEO clips should NOT be B_ROLL - they have their own dynamics with speech

### Music Group Validation:
* Each music group's `"total_duration_seconds"` must be **≤ 20**
* `"clips"` array must list which clip numbers use this music
* **Every clip (including Clip 0)** must belong to exactly one music group
* Clip 0 should typically be in Music_A (first music group) for dramatic opening

### Hook Breakdown Validation (NEW - REQUIRED):
* `"hook_breakdown"` object is **MANDATORY** at the top level
* All fields in `hook_breakdown` must be filled with specific, actionable content
* `"hook_category"` must match one of the starting hook types
* `"hook_duration_seconds"` should be 1.5-3 seconds for maximum impact
* `"hook_reveal_rule"` must specify what information is withheld

### Visual Style Validation (REQUIRED - MUST BE DECIDED FIRST):
* `"visual_style"` object is **MANDATORY** at the top level
* `"chosen_theme"` - use an example theme name OR create a descriptive custom theme name (e.g., `OCEAN_CORPORATE`, `WARM_EARTH`, `NEON_TECH`)
* `"primary_colors"` must list 2-3 colors that will dominate ALL clips
* `"accent_color"` must be ONE color used sparingly for highlights
* `"background_style"` must be consistent across the video
* `"lighting_style"` must be the primary lighting used in 80%+ of clips
* **🚨 ALL clip prompts MUST use colors from the chosen theme** - no exceptions
* **🎨 BE AUTONOMOUS** - choose or create a theme that BEST FITS the content, don't default to the same theme every time

### Video Strategy Summary Validation (NEW - REQUIRED):
* `"video_strategy_summary"` object is **MANDATORY** at the top level
* `"core_emotion"` must be a specific emotional state (not generic like "good" or "interesting")
* `"tension_arc"` must describe how engagement builds and releases
* `"retention_mechanism"` must specify concrete techniques (open loops, reveals, etc.)
* `"payoff_type"` must be one of: 'insight', 'reframed belief', 'emotional satisfaction', 'call to action'

### Clip-Level New Fields Validation:
* `"timestamp"` is **REQUIRED** for every clip - format: "X.Xs" (e.g., "0.0s", "4.0s", "8.0s")
* `"tension_purpose"` is **REQUIRED** for every clip - describe what engagement purpose this clip serves
* `"on_screen_text"` is **OPTIONAL** but recommended for Clip 0 (silent hook) - describes text overlay content

### Research Integration Validation (NEW - REQUIRED):
* `"research_integration"` array is **MANDATORY** at the top level (can be empty [] if no research used)
* For each research item: `"claim_used"`, `"source_context"`, and `"integration_method"` are all required
* Use this to track any stats, claims, or facts that add credibility to the video

---

## 🎨 FINAL VISUAL CONSISTENCY CHECKLIST (MANDATORY)

Before generating your JSON output, verify:

1. ✅ **visual_style object is complete** with chosen_theme, primary_colors, accent_color
2. ✅ **EVERY B_ROLL image_prompt** uses ONLY colors from your chosen theme
3. ✅ **EVERY AI_VIDEO starting_image_prompt** uses ONLY colors from your chosen theme
4. ✅ **SILENT_IMAGE (Clip 0) prompt** uses colors from your chosen theme
5. ✅ **NO warm/golden/orange tones appear** in ANY prompt
6. ✅ **Background descriptions are consistent** - same style across all clips
7. ✅ **Lighting descriptions are consistent** - same primary lighting across clips
8. ✅ **The entire video would look cohesive** if all clips were played together

**Example of CONSISTENT prompts (GOOD):**
* Clip 0: "...clean white background with subtle grey gradient, soft diffused cool lighting..."
* Clip 2: "...minimal white backdrop with ice blue accents, soft diffused cool lighting..."
* Clip 5: "...clean grey background with subtle cool tones, soft diffused lighting..."

**Example of INCONSISTENT prompts (BAD - DO NOT DO THIS):**
* Clip 0: "...golden hour warm lighting, orange sunset background..."
* Clip 2: "...teal neon accents with pink gradient..."
* Clip 5: "...cool blue minimal background with grey tones..."

---

## ⛔ ABSOLUTE PROHIBITIONS

* ❌ No markdown
* ❌ No explanations
* ❌ No assumptions beyond input text
* ❌ No output outside JSON
* ❌ **No golden/orange/warm tones in any prompt**
* ❌ **No mixing different color themes across clips**

---

Output ONLY valid JSON. No markdown formatting, no explanations."""


def detect_hooks_in_video_plan(video_plan: Dict) -> Dict:
    """
    Detect which hooks are being used in the video plan by reading explicit hook_type field from each clip.
    Relies solely on Grok's explicit hook_type declaration - no regex pattern matching.
    Returns a dictionary with starting_hooks, middle_hooks, and ending_hooks.
    """
    hooks_detected = {
        'starting_hooks': [],
        'middle_hooks': [],
        'ending_hooks': []
    }
    
    clips = video_plan.get('clips', [])
    if not clips:
        return hooks_detected
    
    # Read explicit hook_type fields from Grok's response (language-independent)
    # Analyze starting clips (Clip 0 or Clip 1)
    starting_clips = [c for c in clips if c.get('clip_number', 0) <= 1]
    for clip in starting_clips:
        hook_type = clip.get('hook_type', '').strip()
        if hook_type:
            # Normalize hook type name for matching
            hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
            # Check if it's a valid starting hook
            starting_hook_names = ['Shock/Surprise', 'Shock', 'Surprise', 'Story-Start', 'Story Start', 'Confrontation', 
                                  'Question', 'Bold Claim', 'Bold', 'Curiosity Gap', 'Curiosity', 'Visual Pattern Interrupt', 
                                  'Visual Pattern', 'Pattern Interrupt']
            if any(name.lower() in hook_type_normalized.lower() for name in starting_hook_names):
                if hook_type not in hooks_detected['starting_hooks']:
                    hooks_detected['starting_hooks'].append(hook_type)
            else:
                # Log warning if hook_type doesn't match expected starting hooks
                print(f"  ⚠️ Warning: Clip {clip.get('clip_number')} has hook_type '{hook_type}' which doesn't match expected starting hooks")
    
    # Analyze middle clips (Clips 2 to N-1)
    if len(clips) > 2:
        middle_clips = [c for c in clips if 2 <= c.get('clip_number', 0) < len(clips) - 1]
        for clip in middle_clips:
            hook_type = clip.get('hook_type', '').strip()
            if hook_type:
                hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
                middle_hook_names = ['Myth vs Reality', 'Myth', 'Reality', 'Transformation', 'Authority', 'Relatability',
                                    'Mistake', 'Social Proof', 'Social', 'Contrarian']
                if any(name.lower() in hook_type_normalized.lower() for name in middle_hook_names):
                    if hook_type not in hooks_detected['middle_hooks']:
                        hooks_detected['middle_hooks'].append(hook_type)
                else:
                    # Log warning if hook_type doesn't match expected middle hooks
                    print(f"  ⚠️ Warning: Clip {clip.get('clip_number')} has hook_type '{hook_type}' which doesn't match expected middle hooks")
    
    # Analyze ending clip (last clip)
    if clips:
        ending_clip = clips[-1]
        hook_type = ending_clip.get('hook_type', '').strip()
        if hook_type:
            hook_type_normalized = hook_type.replace('_', ' ').replace('-', ' ')
            ending_hook_names = ['CTA', 'Call to Action', 'Call-to-Action', 'Question', 'Time-Bound', 'Time Bound',
                                'Transformation Promise', 'Transformation', 'Reflective Statement', 'Reflective']
            if any(name.lower() in hook_type_normalized.lower() for name in ending_hook_names):
                if hook_type not in hooks_detected['ending_hooks']:
                    hooks_detected['ending_hooks'].append(hook_type)
            else:
                # Log warning if hook_type doesn't match expected ending hooks
                print(f"  ⚠️ Warning: Ending clip has hook_type '{hook_type}' which doesn't match expected ending hooks")
    
    # Log warnings if hooks are missing in any stage
    if not hooks_detected['starting_hooks']:
        print(f"  ⚠️ Warning: No starting hooks detected. Check that Clip 0 or Clip 1 have hook_type field.")
    if not hooks_detected['middle_hooks']:
        print(f"  ⚠️ Warning: No middle hooks detected. Check that at least one middle clip (Clips 2 to N-1) has hook_type field.")
    if not hooks_detected['ending_hooks']:
        print(f"  ⚠️ Warning: No ending hooks detected. Check that the final clip has hook_type field.")
    
    return hooks_detected


def parse_duration(duration_str: str) -> tuple:
    """
    Parse duration string into min and max seconds.
    Handles ranges like "30-45" and single numbers like "15".
    Returns (min_seconds, max_seconds).
    """
    duration_str = duration_str.strip()
    
    if '-' in duration_str:
        # Range format: "30-45"
        parts = duration_str.split('-')
        if len(parts) == 2:
            try:
                min_sec = int(parts[0].strip())
                max_sec = int(parts[1].strip())
                return (min_sec, max_sec)
            except ValueError:
                pass
    
    # Single number format: "15", "30", etc.
    try:
        seconds = int(duration_str)
        # If single number, use it as both min and max
        return (seconds, seconds)
    except ValueError:
        pass
    
    # Default fallback
    return (60, 90)


def analyze_text_and_generate_plan(context_text: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, desired_duration: Optional[str] = None, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, reference_image_mode: bool = False, include_research: bool = False, research_type: str = "news") -> Dict:
    """
    Use Grok-4-latest to analyze text and generate video plan (Stage 1)
    This generates image prompts and effect_hints, NOT detailed effects
    
    Args:
        reference_image_mode: If True, instructs Grok to use "reference influencer" terminology in ALL influencer prompts
        include_research: If True, instructs Grok to populate research_integration with searchable claims
        research_type: Type of research source (news, blog, report, twitter)
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    
    # Get language name from code
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Parse desired duration
    if desired_duration:
        min_duration, max_duration = parse_duration(desired_duration)
        duration_display = f"{min_duration}-{max_duration}" if min_duration != max_duration else str(min_duration)
    else:
        min_duration, max_duration = 60, 90
        duration_display = "60-90 (default)"
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK VIDEO PLAN GENERATION (Stage 1: Prompts & Hints)")
    print(f"{'='*60}")
    print(f"  Context length: {len(context_text)} characters")
    print(f"  Voiceover Language: {language_name} ({language_code})")
    print(f"  Influencer Mode: {'ON' if influencer_mode else 'OFF'}")
    print(f"  Desired Duration: {duration_display} seconds")
    if influencer_mode:
        print(f"  Influencer Gender: {influencer_gender or 'male'}")
    
    # Get current date for temporal context
    current_date = datetime.now().strftime("%B %d, %Y")
    
    # Calculate image group percentage for display
    image_group_pct = int(image_group_proportion * 100)
    print(f"  Image Group Proportion: {image_group_pct}% of IMAGE_ONLY clips")
    
    # Generate image group user instruction based on whether it's enabled
    if image_group_proportion > 0:
        image_group_user_instruction = f"""Use EITHER `prompt` (single image) OR `image_group` (2-3 images) - NOT both
- **🎞️ IMAGE GROUPS ({image_group_pct}% of IMAGE_ONLY clips)**: 
  * ~{image_group_pct}% of IMAGE_ONLY clips should use image groups (multiple visuals transitioning rapidly)
  * For clips WITH image groups: Use `image_group` array with **2 or 3 objects** (YOU decide), each containing a `prompt` field
  * For clips WITHOUT image groups: Use single `prompt` field as usual
  * Images in a group MUST be **DIFFERENT but RELATED** - NOT similar variations
  * Effect is applied ONLY to the first image in the group
  * SILENT_IMAGE (Clip 0) and AI_VIDEO clips should NOT use image groups"""
    else:
        image_group_user_instruction = """Use single `prompt` field only (image groups are DISABLED)"""
    
    system_prompt = get_political_video_system_prompt(language_code, language_name, influencer_mode, influencer_gender, current_date, min_duration, max_duration, image_group_proportion, voiceover_emotions, reference_image_mode, include_research, research_type)
    
    # Adjust user prompt based on influencer mode
    if influencer_mode:
        ai_video_instruction = """- AI_VIDEO clips should be ~30% of total video duration (NOT a hardcoded 3 clips)
- Calculate based on duration: 60s video→2 clips, 90s video→3-4 clips, 45s video→1-2 clips
- ALL AI_VIDEO clips: 8 seconds each, full influencer character description for first clip + specify position in frame
- Second/Third/etc. AI_VIDEO: Use "reference influencer" for consistency
- **CONSISTENT POSITIONING**: Choose ONE layout format (split OR overlay) and use the SAME format for ALL AI_VIDEO clips
  * If using split layout (influencer left/right, context on other side): Use SAME side for ALL clips
  * If using overlay (corner/lower portion): Use SAME corner position for ALL clips
  * DO NOT MIX different formats or positions across clips
- CRITICAL: Use PLAIN TEXT for all prompts - no square bracket expressions
- **CRITICAL WORD LIMIT BY CLIP DURATION** (applies to ALL voiceovers - ElevenLabs AND influencer speaking):
  * **4-second clips**: 6-8 words (minimum 6, maximum 8 words)
  * **6-second clips**: 10-12 words (minimum 10, maximum 12 words)
  * **8-second clips**: 14-16 words (minimum 14, maximum 16 words - for influencer clips)
- CRITICAL for 2nd/3rd/etc. clips: MUST include "Only take reference influencer from the reference image for new image generation. Ignore text from reference image." at the end of image prompts (ensures only influencer appearance is copied, all text is ignored)"""
    else:
        ai_video_instruction = "- Maximum 2 AI_VIDEO clips (6 seconds each)"
    
    # Build user prompt with optional user instruction
    user_prompt_parts = [f"""Analyze the following political context and generate a complete video plan.

=== CONTEXT TEXT ===
{context_text}
=== END CONTEXT ==="""]
    
    # Add user instruction if provided
    if user_instruction and user_instruction.strip():
        user_prompt_parts.append(f"""
=== USER INSTRUCTION (IMPORTANT) ===
{user_instruction.strip()}
=== END USER INSTRUCTION ===

⚠️ **CRITICAL**: The USER INSTRUCTION above is VERY IMPORTANT. You MUST align all image prompts, clip prompts, and video plan elements with the user's specific requirements. The user's instruction takes priority in guiding how you generate prompts and structure the video.""")

    # Add duration instruction to user prompt
    duration_instruction = f"Generate a scroll-stopping video plan targeting **{min_duration}-{max_duration} seconds** total duration. **YOU must autonomously decide the number of clips** to achieve this target duration based on clip durations (4s, 6s, 8s). Calculate: if most clips are 4 seconds, you'll need approximately {min_duration//4}-{max_duration//4} clips. Adjust based on mix of clip durations."
    
    user_prompt_parts.append(f"""
{duration_instruction}
Remember:
- Clip 0 must be SILENT_IMAGE (no voiceover, but WITH background music) - use as visual hook
- **CRITICAL: FAST-PACED VIDEO STRUCTURE**:
  * **MOST IMAGE_ONLY clips should be 4 seconds** (use for short messages, 6-8 words) - keeps video engaging and prevents slow pacing
  * **Use 6 seconds for IMAGE_ONLY clips** when the message is longer (10-12 words) and needs more time to be delivered clearly
  * **Mix of 4s and 6s for IMAGE_ONLY clips** - vary durations based on message length to accommodate different message sizes
  * Only use 8 seconds for AI_VIDEO influencer clips
  * Faster clips = more content = more engaging video, but balance with message clarity
  * **VOICEOVER WORD LIMITS BY CLIP DURATION** (applies to ALL voiceovers - ElevenLabs AND influencer speaking):
    * **4-second clips** (IMAGE_ONLY - short messages): 6-8 words (minimum 6, maximum 8 words) - STRICT LIMIT
    * **6-second clips** (IMAGE_ONLY - bigger messages OR AI_VIDEO non-influencer): 10-12 words (minimum 10, maximum 12 words) - STRICT LIMIT - use for IMAGE_ONLY when message needs more time
    * **8-second clips** (AI_VIDEO influencer only): 14-16 words (minimum 14, maximum 16 words) - STRICT LIMIT
  * **IMPORTANT**: When deciding clip duration for IMAGE_ONLY clips, match duration to message length:
    * If voiceover is 6-8 words → Use **4 seconds**
    * If voiceover is 10-12 words → Use **6 seconds**
- **CRITICAL: SEPARATE PROMPTS FOR AI_VIDEO CLIPS**:
  * For AI_VIDEO clips, you MUST generate TWO separate prompts:
    * `starting_image_prompt`: Visual description ONLY (NO voiceover text instructions) - MUST end with "no text overlays"
    * `prompt` (clip prompt): Full prompt with voiceover text instructions and text overlay prevention (for video generation)
  * The starting_image_prompt is used ONLY for generating the starting frame image - it should NOT contain any voiceover text instructions like "The influencer must say..."
  * The clip prompt (prompt field) is used for video generation with Veo3.1 - it includes voiceover text instructions
  * **🚨 MANDATORY: PREVENT CHINESE AUDIO IN AI_VIDEO CLIP PROMPTS**:
    * Every AI_VIDEO clip prompt (the `prompt` field) MUST explicitly include a statement to prevent Chinese audio generation
    * Add this statement: "Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code})."
    * This MUST be included in addition to the language specification
    * Example format: "Influencer speaking to camera in {language_name} language (ISO code: {language_code}). Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code}). The influencer must say EXACTLY the following text..."
    * This prevents Veo3.1 from generating Chinese audio even when the language is specified
- **For IMAGE_ONLY/SILENT_IMAGE clips**: 
  * **Clip 0 (SILENT_IMAGE)**: Use `prompt` field only - MUST explicitly describe text overlay (e.g., "with bold text overlay stating '[message]'") - DO NOT include "no text overlays" - text overlays are MANDATORY for Clip 0
  * **Other IMAGE_ONLY clips**: {image_group_user_instruction}
{ai_video_instruction}
- All other clips are IMAGE_ONLY with effects
- Voiceover must include emotional expressions in [brackets]
- **CRITICAL: SCROLL-STOPPING SCRIPT STRUCTURE**:
  * **STARTING HOOK (Clip 0 or Clip 1)**: Choose appropriate hook based on context:
    * **Visual Pattern Interrupt**: Fast cuts, bold visuals, sudden change (best for: Creators, D2C, Fashion, Entertainment)
    * **Shock/Surprise Hook**: Unexpected statement/visual (best for: Finance, Startups, Health, Marketing)
    * **Curiosity Gap Hook**: Withhold key info to force continuation (best for: Education, SaaS, Consulting)
    * **Question Hook**: Force brain to internally answer (best for: Education, SaaS, Coaches, B2B)
    * **Bold Claim Hook**: Strong, confident statement (best for: SaaS, Coaches, Marketing, B2B)
    * **Story-Start Hook**: Drop viewer into unfolding narrative (best for: Creators, Brands, Founders, D2C)
    * **Confrontation Hook**: Challenge beliefs (best for: Creators, Coaches, Finance, SaaS) - use carefully, must feel honest
  * **MIDDLE CONTENT (Clips 2 to N-1)**: Build engagement with varied hooks:
    * **Myth vs Reality**: Challenge misinformation (best for: Finance, Health, Education, Web3)
    * **Transformation**: Show before/after contrast (best for: Fitness, D2C, Career, Education)
    * **Authority**: Signal expertise with numbers, years, outcomes (best for: Finance, SaaS, Consulting)
    * **Relatability**: Make viewer feel understood (best for: Creators, SMBs, Mental Health, Career)
    * **Mistake Hook**: Highlight costly/common errors (best for: Marketing, Finance, SaaS, Education)
    * **Social Proof**: Leverage herd psychology (best for: SaaS, D2C, Marketplaces)
    * **Contrarian Hook**: Oppose popular advice (best for: Creators, Fitness, Finance, Startups)
  * **ENDING (Final Clip)**: Choose ending style based on context/industry:
    * **For Political/News, Marketing, E-commerce, Events**: Include Strong CTA + Question
      * **Strong CTA (Call-to-Action)**: Clear next step (follow, share, comment, learn more)
      * **Engaging Question**: Force reflection or engagement
      * **Time-Bound Hook**: Create urgency if applicable (best for: E-commerce, Events, Launches)
    * **For Educational, Documentary, Informational**: May end with reflective statement or transformation promise
      * **Transformation Promise**: Show what's possible
      * **Reflective Statement**: Thought-provoking conclusion
      * **Question**: Optional, only if it adds value
    * **For Entertainment, Storytelling**: May end with narrative conclusion or cliffhanger
      * **Story Conclusion**: Satisfying narrative wrap-up
      * **Cliffhanger**: If part of series
      * **CTA**: Optional, only if appropriate
    * **CRITICAL**: Analyze the context - CTA/Question is NOT always necessary. Use judgment based on:
      * Industry norms (marketing needs CTA, documentaries may not)
      * Content type (educational may end with insight, not CTA)
      * User instruction (if user specifies ending style, follow it)
  * **HOOK SELECTION STRATEGY**:
    * **MANDATORY**: Always explicitly specify which hooks you're using in your response
    * **CRITICAL REQUIREMENT - ALL THREE STAGES MUST HAVE HOOKS**:
      * **1. STARTING STAGE**: MUST include at least one starting hook in Clip 0 or Clip 1
      * **2. MIDDLE STAGE**: MUST include at least one middle hook in one or more clips from Clips 2 to N-1
      * **3. ENDING STAGE**: MUST include at least one ending hook in the final clip
      * **NEVER CREATE A VIDEO WITH HOOKS IN ONLY ONE OR TWO STAGES - ALL THREE STAGES ARE REQUIRED**
    * **DEFAULT HOOK COMBINATION** (use when context is unclear):
      * **Starting**: **Shock/Surprise Hook** + **Story-Start Hook**
      * **Middle**: **Myth vs Reality** + **Authority** (distribute across multiple middle clips)
      * **Ending**: **Strong CTA + Question**
    * Analyze the input context to determine industry/domain (politics, finance, tech, health, education, etc.)
    * Select hooks that align with the industry and audience pain points
    * **If context is unclear, use the DEFAULT HOOK COMBINATION above**
    * High-performing content often combines multiple hooks in the first 3 seconds
    * Hooks are psychological tools - adapt them to the specific context and audience
    * **VERIFICATION CHECKLIST**: Before finalizing your video plan, ensure:
      * ✅ Starting clip(s) have a starting hook (Clip 0 or Clip 1)
      * ✅ At least one middle clip has a middle hook (Clips 2 to N-1)
      * ✅ Ending clip has an ending hook (Final clip)
      * ✅ All three stages are covered - never skip any stage
    * **MANDATORY JSON FIELD**: Every clip in your JSON response MUST include a `"hook_type"` field that explicitly states which hook is used:
      * For starting clips (0-1): Set `"hook_type"` to one of: "Shock/Surprise", "Story-Start", "Confrontation", "Question", "Bold Claim", "Curiosity Gap", or "Visual Pattern Interrupt"
      * For middle clips (2 to N-1): Set `"hook_type"` to one of: "Myth vs Reality", "Transformation", "Authority", "Relatability", "Mistake", "Social Proof", or "Contrarian" (at least one middle clip must have this)
      * For ending clip (final): Set `"hook_type"` to one of: "CTA", "Question", "Time-Bound", "Transformation Promise", or "Reflective Statement"
      * **CRITICAL**: The `hook_type` field is MANDATORY for ALL clips - this ensures hooks are detected correctly regardless of the voiceover language
- **CRITICAL: CONTEXT-AWARE PROMPTS**: Analyze the input text to determine the actual context (country, industry, domain) and adapt all prompts accordingly. Only include country-specific or cultural elements if they are mentioned in the input text. For example:
  * If input is about Indian politics → Use Indian context (Hindi signage, Indian clothing, etc.)
  * If input is about US technology → Use American tech context (English signage, modern tech labs, etc.)
  * If input is about global deep tech → Use neutral, international tech context
  * If input is about banking → Use financial/banking context appropriate to the country mentioned
- Include Clip 0 in the first music group for dramatic opening impact""")
    
    if user_instruction and user_instruction.strip():
        user_prompt_parts.append("""
- **ALIGN ALL PROMPTS WITH USER INSTRUCTION**: Ensure image prompts, clip prompts, and overall video structure follow the user's instruction above.""")

    user_prompt_parts.append("\nOutput ONLY valid JSON.")
    
    user_prompt = "".join(user_prompt_parts)

    # Retry logic for auth context expiration
    max_retries = 2
    last_exception = None
    response_text = None
    
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok (auth context expired)...")
            
            print(f"\n  🔗 Connecting to Grok-4-latest...")
            # Create fresh client for each attempt to avoid auth context expiration
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-latest")
            
            chat.append(system(system_prompt))
            chat.append(user(user_prompt))
            
            print(f"  📤 Sending context to Grok...")
            response = chat.sample()
            response_text = response.content.strip()
            # Success - break out of retry loop
            break
        except Exception as e:
            last_exception = e
            error_str = str(e)
            # Check if it's an auth context expiration error
            if ("Auth context expired" in error_str or 
                "grpc_status:13" in error_str or
                "StatusCode.INTERNAL" in error_str) and attempt < max_retries - 1:
                print(f"  ⚠️ Auth context expired (attempt {attempt + 1}/{max_retries}), retrying with fresh connection...")
                continue
            else:
                # Not a retryable error or max retries reached - re-raise
                raise
    
    if last_exception and not response_text:
        raise last_exception
    
    try:
        # Log full Grok response
        print(f"\n{'='*60}")
        print(f"📄 GROK RAW RESPONSE:")
        print(f"{'='*60}")
        print(response_text)
        print(f"{'='*60}\n")
        
        # Parse JSON response
        json_content = response_text
        
        # Handle markdown code blocks
        if "```json" in json_content:
            json_start = json_content.find("```json") + 7
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        elif "```" in json_content:
            json_start = json_content.find("```") + 3
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        
        # Find JSON object
        if not json_content.startswith("{"):
            start_idx = json_content.find("{")
            end_idx = json_content.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx]
        
        # Fix common JSON issues
        json_content = re.sub(r',(\s*[\]\}])', r'\1', json_content)
        
        video_plan = json.loads(json_content)
        
        # Detect and log hooks used in the video plan
        detected_hooks = detect_hooks_in_video_plan(video_plan)
        
        # Log parsed plan
        print(f"\n{'='*60}")
        print(f"📋 PARSED VIDEO PLAN:")
        print(f"{'='*60}")
        
        # Log visual style choice
        visual_style = video_plan.get('visual_style', {})
        if visual_style:
            print(f"\n  🎨 VISUAL STYLE:")
            print(f"    Theme: {visual_style.get('chosen_theme', 'Not specified')}")
            print(f"    Primary Colors: {', '.join(visual_style.get('primary_colors', []))}")
            print(f"    Accent Color: {visual_style.get('accent_color', 'Not specified')}")
            print(f"    Background: {visual_style.get('background_style', 'Not specified')}")
            print(f"    Lighting: {visual_style.get('lighting_style', 'Not specified')}")
        
        print(f"\n  Total Duration: {video_plan.get('video_overview', {}).get('total_duration_seconds', 0)}s")
        print(f"  Total Clips: {video_plan.get('video_overview', {}).get('total_clips', 0)}")
        print(f"  AI Video Clips: {video_plan.get('video_overview', {}).get('ai_video_clips_used', 0)}")
        
        # Log detected hooks
        if detected_hooks:
            print(f"\n  🎣 DETECTED HOOKS:")
            if detected_hooks.get('starting_hooks'):
                print(f"    Starting Hooks: {', '.join(detected_hooks['starting_hooks'])}")
            if detected_hooks.get('middle_hooks'):
                print(f"    Middle Hooks: {', '.join(detected_hooks['middle_hooks'])}")
            if detected_hooks.get('ending_hooks'):
                print(f"    Ending Hooks: {', '.join(detected_hooks['ending_hooks'])}")
        
        print(f"\n  Clips:")
        for clip in video_plan.get('clips', []):
            print(f"    Clip {clip.get('clip_number')}: {clip.get('clip_type')} ({clip.get('duration_seconds')}s)")
            if clip.get('voiceover'):
                print(f"      Voiceover: {clip.get('voiceover')[:80]}...")
        print(f"{'='*60}\n")
        
        return video_plan
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok JSON response: {e}")
        raise
    except Exception as e:
        print(f"  ❌ Grok analysis failed: {e}")
        import traceback
        print(traceback.format_exc())
        raise


# ============================================
# IMAGE EFFECT ANALYSIS (Stage 2)
# ============================================

def generate_random_effect(clip_num: int, duration: float) -> List[Dict]:
    """
    Generate a random effect for a clip when Grok analysis fails or is skipped.
    Returns a list with one random effect.
    """
    import random
    
    # Available effects (excluding forbidden ones)
    available_effects = [
        "zoom_in", "zoom_out", "pan", "ken_burns", "shake", "zoom_pulse",
        "zoom_whip", "flash", "letterbox", "color_shift",
        "contrast_boost", "focus_rack", "reveal_wipe", "blur_transition",
        "saturation_pulse", "radial_blur", "bounce_zoom", "tilt", "glitch",
        "rgb_split", "film_grain", "light_leak", "color_pop", "split_screen",
        "mirror", "pixelate", "wave_distortion"
    ]
    
    # Select a random effect
    effect_type = random.choice(available_effects)
    
    # Generate appropriate parameters based on effect type
    if effect_type in ["zoom_in", "zoom_out", "ken_burns"]:
        return [{
            "effect_type": effect_type,
            "start_region": {
                "left_pct": random.randint(10, 40),
                "top_pct": random.randint(10, 40),
                "right_pct": random.randint(60, 90),
                "bottom_pct": random.randint(60, 90)
            },
            "end_region": {
                "left_pct": random.randint(20, 50),
                "top_pct": random.randint(20, 50),
                "right_pct": random.randint(70, 95),
                "bottom_pct": random.randint(70, 95)
            },
            "zoom_start": 1.0,
            "zoom_end": 1.2 if effect_type == "zoom_in" else 0.9,
            "start_time": 0,
            "duration": duration
        }]
    elif effect_type in ["shake", "zoom_pulse", "zoom_whip", "heartbeat"]:
        return [{
            "effect_type": effect_type,
            "region": {
                "left_pct": random.randint(20, 40),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(60, 80),
                "bottom_pct": random.randint(60, 80)
            },
            "intensity": round(random.uniform(0.2, 0.5), 2),
            "start_time": 0,
            "duration": duration
        }]
    elif effect_type == "pan":
        return [{
            "effect_type": "pan",
            "start_region": {
                "left_pct": random.randint(0, 30),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(50, 70),
                "bottom_pct": random.randint(60, 80)
            },
            "end_region": {
                "left_pct": random.randint(30, 60),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(80, 100),
                "bottom_pct": random.randint(60, 80)
            },
            "start_time": 0,
            "duration": duration
        }]
    else:
        # For other effects, use a simple region-based approach
        return [{
            "effect_type": effect_type,
            "region": {
                "left_pct": random.randint(20, 40),
                "top_pct": random.randint(20, 40),
                "right_pct": random.randint(60, 80),
                "bottom_pct": random.randint(60, 80)
            },
            "start_time": 0,
            "duration": duration
        }]


def analyze_images_for_effects(
    image_clips: List[Dict],  # List of {clip_number, image_path, duration, effect_hint, voiceover}
) -> Dict[int, List[Dict]]:
    """
    Stage 2: Analyze generated images with Grok to create precise effects.
    
    This function:
    1. Takes all generated IMAGE_ONLY/SILENT_IMAGE clip images
    2. Passes them to Grok with the effects catalog (max 9 images)
    3. Grok sees actual images and generates precise bounding boxes and effect parameters
    4. For images not sent to Grok (if > 9), assigns random effects
    5. On error, assigns random effects to all clips
    
    Returns: Dict mapping clip_number -> effects list
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import base64
    import random
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK IMAGE ANALYSIS FOR EFFECTS (Stage 2)")
    print(f"{'='*60}")
    print(f"  Analyzing {len(image_clips)} images for precise effects...")
    
    if not image_clips:
        print("  ⚠️ No images to analyze")
        return {}
    
    # FIXED: Limit to 6 images max to avoid RESOURCE_EXHAUSTED errors (message size limit ~20MB)
    MAX_IMAGES_FOR_GROK = 6
    clips_to_analyze = image_clips.copy()
    clips_not_analyzed = []
    
    if len(clips_to_analyze) > MAX_IMAGES_FOR_GROK:
        print(f"  ⚠️ {len(clips_to_analyze)} images exceed limit of {MAX_IMAGES_FOR_GROK}")
        print(f"  🎲 Randomly selecting {MAX_IMAGES_FOR_GROK} images for Grok analysis...")
        # Randomly select MAX_IMAGES_FOR_GROK images
        random.shuffle(clips_to_analyze)
        clips_not_analyzed = clips_to_analyze[MAX_IMAGES_FOR_GROK:]
        clips_to_analyze = clips_to_analyze[:MAX_IMAGES_FOR_GROK]
        print(f"  ✅ Selected {len(clips_to_analyze)} images for Grok, {len(clips_not_analyzed)} will get random effects")
    
    # Build effects catalog for prompt
    effects_catalog = get_effects_catalog_for_grok()
    
    system_prompt = f"""You are an expert VIDEO DIRECTOR and MOTION GRAPHICS specialist.

Your task is to analyze a sequence of images that will become video clips and create PRECISE EFFECTS for each.

{effects_catalog}

---

## 🎯 CRITICAL: ACCURATE COORDINATE ESTIMATION

ALL coordinates are PERCENTAGES (0-100) measured as follows:

**HORIZONTAL (X)** - measured from LEFT edge:
├── 0%   = Left edge of image
├── 25%  = Quarter way from left
├── 50%  = Exact horizontal center
├── 75%  = Three-quarters from left
└── 100% = Right edge of image

**VERTICAL (Y)** - measured from TOP edge:
├── 0%   = Top edge of image
├── 25%  = Quarter way from top
├── 50%  = Exact vertical center
├── 75%  = Three-quarters from top
└── 100% = Bottom edge of image

**BOUNDING BOX FORMAT:**
All regions must be specified as bounding boxes with 4 values:
- left_pct: Left edge (0 = image left, 100 = image right)
- top_pct: Top edge (0 = image top, 100 = image bottom)
- right_pct: Right edge (must be > left_pct)
- bottom_pct: Bottom edge (must be > top_pct)

---

## 📋 STEP-BY-STEP ANALYSIS FOR EACH IMAGE:

1. **IDENTIFY KEY ELEMENTS** - What are the important subjects/objects in this image?
2. **LOCATE PRECISELY** - Use the 10x10 mental grid to determine exact coordinates
3. **MATCH EFFECT HINT** - The creator provided hints about desired effect style
4. **CREATE EFFECTS** - Generate precise effects that match the hint and enhance the image

---

## ⚠️ COORDINATE ACCURACY RULES:

1. Mentally divide each image into a 10x10 grid
2. If element is in RIGHT half → left_pct and right_pct should BOTH be > 50
3. If element is in BOTTOM half → top_pct and bottom_pct should BOTH be > 50
4. If element is centered → values should be around 40-60
5. **TENDENCY: Most people UNDERESTIMATE - if unsure, add 5-10% to your estimates**

---

## 📦 OUTPUT FORMAT (STRICT JSON):

Return a JSON object where keys are clip numbers and values are effects arrays:

```json
{{
  "0": [
    {{
      "effect_type": "ken_burns",
      "start_region": {{"left_pct": 20, "top_pct": 15, "right_pct": 55, "bottom_pct": 50}},
      "end_region": {{"left_pct": 45, "top_pct": 45, "right_pct": 80, "bottom_pct": 80}},
      "zoom_start": 1.0,
      "zoom_end": 1.3,
      "start_time": 0,
      "duration": 4
    }}
  ],
  "1": [
    {{
      "effect_type": "shake",
      "region": {{"left_pct": 30, "top_pct": 20, "right_pct": 70, "bottom_pct": 60}},
      "intensity": 0.3,
      "start_time": 0,
      "duration": 6
    }},
    {{
      "effect_type": "zoom_in",
      "region": {{"left_pct": 35, "top_pct": 25, "right_pct": 65, "bottom_pct": 55}},
      "zoom_start": 1.0,
      "zoom_end": 1.2,
      "start_time": 3,
      "duration": 3
    }}
  ]
}}
```

---

## 🎬 EFFECT SELECTION STRATEGY:

- Match the effect_hint provided for each clip
- Create dynamic, scroll-stopping movement
- Ensure effects enhance the narrative (don't distract)
- Multiple overlapping effects can create richer visuals
- Each effect needs: start_time and duration (must fit within clip duration)

## ⚠️ FORBIDDEN EFFECTS (DO NOT USE):

**NEVER use these effects - they are NOT available:**
- `highlight_spotlight` - NOT available, do not use
- `brightness_pulse` - NOT available, do not use
- `fade_vignette` - NOT available, do not use

These effects have been removed from the available effects list. Only use effects that are listed in the AVAILABLE EFFECTS section above.

---

Output ONLY valid JSON. No markdown, no explanations."""

    # Build user prompt with image details
    user_prompt_text = f"""Analyze these images and generate precise effects for each.

⚠️ **IMPORTANT: OUTPUT VIDEO DIMENSIONS**
- Final video size: {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]} pixels (width x height)
- Aspect ratio: {OUTPUT_ASPECT_RATIO}
- All bounding box coordinates must be calculated based on these FINAL dimensions
- Images will be resized/cropped to match these dimensions before effects are applied
- Provide coordinates as if the image is already {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]}

IMAGES TO ANALYZE (in video sequence order):

"""
    
    # Prepare image data for Grok
    image_data_list = []
    for clip_info in image_clips:
        clip_num = clip_info['clip_number']
        image_path = clip_info['image_path']
        duration = clip_info['duration']
        effect_hint = clip_info.get('effect_hint', 'Create engaging movement')
        voiceover = clip_info.get('voiceover', '')
        
        user_prompt_text += f"""
---
**CLIP {clip_num}** (Duration: {duration}s)
- Effect Hint: "{effect_hint}"
- Voiceover: "{voiceover[:100]}{'...' if len(voiceover) > 100 else ''}"
- [Image attached below]
"""
        
        # Load and encode image
        try:
            with open(image_path, "rb") as f:
                image_bytes = base64.b64encode(f.read()).decode('utf-8')
            
            ext = image_path.lower().split('.')[-1]
            mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
            mime_type = mime_types.get(ext, 'image/png')
            image_data_url = f"data:{mime_type};base64,{image_bytes}"
            
            image_data_list.append({
                'clip_number': clip_num,
                'data_url': image_data_url
            })
            print(f"  📷 Prepared image for clip {clip_num}")
        except Exception as e:
            print(f"  ⚠️ Failed to load image for clip {clip_num}: {e}")
    
    user_prompt_text += """
---

Generate precise effects for ALL clips above. Analyze each image carefully and create effects with accurate bounding boxes.

Output ONLY valid JSON mapping clip_number -> effects array."""

    # Retry logic for auth context expiration
    max_retries = 2
    last_exception = None
    response_text = None
    
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok for image analysis...")
            
            print(f"\n  🔗 Connecting to Grok-4-latest for image analysis...")
            # Create fresh client for each attempt to avoid auth context expiration
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-latest")
            
            chat.append(system(system_prompt))
            
            # Build message with text and all images
            # Create the user message with images
            message_parts = [user_prompt_text]
            for img_data in image_data_list:
                message_parts.append(image(image_url=img_data['data_url'], detail="high"))
            
            chat.append(user(*message_parts))
            
            print(f"  📤 Sending {len(image_data_list)} images to Grok for analysis...")
            response = chat.sample()
            response_text = response.content.strip()
            # Success - break out of retry loop
            break
        except Exception as e:
            last_exception = e
            error_str = str(e)
            
            # Check if it's a RESOURCE_EXHAUSTED error (message too large) - don't retry, assign random effects immediately
            if ("RESOURCE_EXHAUSTED" in error_str or 
                  "grpc_status:8" in error_str or
                  "Sent message larger than max" in error_str or
                  "StatusCode.RESOURCE_EXHAUSTED" in error_str):
                print(f"  ⚠️ Message too large for Grok (RESOURCE_EXHAUSTED) - will assign random effects...")
                response_text = None
                break
            
            # Check if it's a retryable error (auth context, internal error, etc.)
            is_retryable = ("Auth context expired" in error_str or 
                           "grpc_status:13" in error_str or
                           "StatusCode.INTERNAL" in error_str or
                           "grpc" in error_str.lower())
            
            if is_retryable and attempt < max_retries - 1:
                print(f"  ⚠️ Grok error (attempt {attempt + 1}/{max_retries}): {error_str[:100]}...")
                print(f"  🔄 Retrying with fresh connection...")
                continue
            else:
                # Max retries reached or non-retryable error - will fall back to random effects
                print(f"  ⚠️ Grok image analysis failed after {attempt + 1} attempts: {error_str[:150]}...")
                response_text = None
                break
    
    # If ANY error occurred and we don't have a response, fall back to random effects
    if last_exception and not response_text:
        print(f"  ⚠️ Grok image analysis failed - assigning random effects to all clips...")
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects
    
    try:
        
        # Log full Grok response
        print(f"\n{'='*60}")
        print(f"📄 GROK EFFECTS ANALYSIS RAW RESPONSE:")
        print(f"{'='*60}")
        print(response_text)
        print(f"{'='*60}\n")
        
        # Parse JSON response
        json_content = response_text
        
        # Handle markdown code blocks
        if "```json" in json_content:
            json_start = json_content.find("```json") + 7
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        elif "```" in json_content:
            json_start = json_content.find("```") + 3
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        
        # Find JSON object
        if not json_content.startswith("{"):
            start_idx = json_content.find("{")
            end_idx = json_content.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx]
        
        # Fix common JSON issues
        json_content = re.sub(r',(\s*[\]\}])', r'\1', json_content)
        
        effects_data = json.loads(json_content)
        
        # Convert string keys to int keys and filter forbidden effects
        FORBIDDEN_EFFECTS = {"highlight_spotlight", "brightness_pulse", "fade_vignette"}
        clip_effects = {}
        for key, effects in effects_data.items():
            clip_num = int(key)
            # Filter out forbidden effects
            filtered_effects = [
                effect for effect in effects 
                if effect.get('effect_type') not in FORBIDDEN_EFFECTS
            ]
            
            # Warn if forbidden effects were removed
            removed_count = len(effects) - len(filtered_effects)
            if removed_count > 0:
                removed_types = [
                    effect.get('effect_type') for effect in effects 
                    if effect.get('effect_type') in FORBIDDEN_EFFECTS
                ]
                print(f"  ⚠️ Clip {clip_num}: Removed {removed_count} forbidden effect(s): {', '.join(removed_types)}")
            
            # Only add clip if it has at least one valid effect, otherwise will use defaults
            if filtered_effects:
                clip_effects[clip_num] = filtered_effects
            else:
                print(f"  ⚠️ Clip {clip_num}: All effects were forbidden, will use default effects")
            
            # Log parsed effects (after filtering)
            if clip_num in clip_effects:
                print(f"\n  📋 Clip {clip_num} effects:")
                for i, effect in enumerate(clip_effects[clip_num]):
                    print(f"      Effect {i+1}: {effect.get('effect_type')}")
        
        print(f"\n  ✅ Generated effects for {len(clip_effects)} clips from Grok analysis")
        
        # FIXED: Assign random effects to clips not analyzed by Grok
        if clips_not_analyzed:
            print(f"\n  🎲 Assigning random effects to {len(clips_not_analyzed)} clips not analyzed by Grok...")
            for clip_info in clips_not_analyzed:
                clip_num = clip_info['clip_number']
                duration = clip_info['duration']
                if clip_num not in clip_effects:
                    clip_effects[clip_num] = generate_random_effect(clip_num, duration)
                    print(f"  ✅ Assigned random effect to clip {clip_num}")
        
        # Ensure all clips have effects (including those that Grok might have missed)
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            if clip_num not in clip_effects:
                duration = clip_info['duration']
                clip_effects[clip_num] = generate_random_effect(clip_num, duration)
                print(f"  ✅ Assigned random effect to clip {clip_num} (missed by Grok)")
        
        return clip_effects
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok effects JSON: {e}")
        print(f"  📄 Raw response: {response_text[:500]}...")
        print(f"  🎲 Assigning random effects to all clips due to parsing error...")
        # FIXED: Assign random effects to all clips instead of returning empty dict
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects
    except Exception as e:
        error_str = str(e)
        print(f"  ❌ Grok image analysis failed: {e}")
        import traceback
        print(traceback.format_exc())
        
        # Check if it's a RESOURCE_EXHAUSTED error - handle gracefully
        if ("RESOURCE_EXHAUSTED" in error_str or 
            "grpc_status:8" in error_str or
            "Sent message larger than max" in error_str or
            "StatusCode.RESOURCE_EXHAUSTED" in error_str):
            print(f"  ⚠️ Message too large for Grok (RESOURCE_EXHAUSTED) - assigning random effects to all clips...")
        else:
            print(f"  🎲 Assigning random effects to all clips due to error...")
        
        # FIXED: Assign random effects to all clips instead of returning empty dict or raising
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects


# ============================================
# IMAGE GENERATION
# ============================================

def clean_prompt_for_visual(prompt: str, is_starting_frame: bool = False, clip_num: int = -1) -> str:
    """
    Remove problematic phrases from prompts that cause unwanted text in generated images.
    - Removes square bracket expressions (like [shocked, voice cracks]) - only for ElevenLabs TTS
    - Removes metadata phrases that appear as literal text (like "Indian context", "modern era")
    - For starting frame images (AI_VIDEO clips): Ensures "no text overlays" is present
    - For Clip 0 (SILENT_IMAGE): Does NOT add "no text overlays" (text overlays are MANDATORY)
    - For other regular images (IMAGE_ONLY clips): Does NOT add "no text overlays" (text overlays are allowed)
    
    Args:
        prompt: Image generation prompt
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip (no text overlays needed)
                          If False, this is a regular image for IMAGE_ONLY clip (text overlays allowed)
        clip_num: Clip number (0 for SILENT_IMAGE which requires text overlays)
    """
    import re
    # Remove square bracket expressions: [anything inside brackets]
    cleaned = re.sub(r'\[[^\]]+\]', '', prompt)
    
    # Remove problematic metadata phrases that appear as text in images
    # These phrases should be conveyed through visual descriptions, not as literal text
    problematic_phrases = [
        r'\bexplicitly\s+Indian\s+context\b',
        r'\bIndian\s+context\b',
        r'\bmodern\s+era\b',
        r'\bcontemporary\s+era\b',
        r'\bexplicitly\s+Indian\b',
        r'\bmodern\s+context\b',
        r'\bIndian\s+setting\b',
        r'\bexplicitly\s+Indian\s+setting\b',
    ]
    
    for phrase_pattern in problematic_phrases:
        cleaned = re.sub(phrase_pattern, '', cleaned, flags=re.IGNORECASE)
    
    # Clean up extra spaces and punctuation
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'\s*,\s*,', ',', cleaned)  # Remove double commas
    cleaned = re.sub(r'\s*,\s*$', '', cleaned)  # Remove trailing comma
    cleaned = cleaned.strip()
    
    # CRITICAL: Clip 0 (SILENT_IMAGE) MUST have text overlays - they set the overall message
    # For Clip 0, aggressively remove ALL "no text overlays" instructions and ensure text overlay is present
    if clip_num == 0:
        # Remove any existing "no text overlays" instructions (multiple patterns to catch all variations)
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
            r'\bwithout\s+text\s+overlays?\b',
            r'\bno\s+text\s+overlay\b',
            r'\btext\s+overlays?\s+not\s+allowed\b',
            r'\btext\s+overlays?\s+are\s+not\s+allowed\b',
            r'\bdo\s+not\s+include\s+text\s+overlays?\b',
            r'\bavoid\s+text\s+overlays?\b',
        ]
        for pattern in no_text_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        # Clean up extra spaces, commas, and punctuation
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        cleaned = re.sub(r'\s*,\s*,', ',', cleaned)  # Remove double commas
        cleaned = re.sub(r'\s*,\s*$', '', cleaned)  # Remove trailing comma
        cleaned = re.sub(r'\s*\.\s*$', '', cleaned)  # Remove trailing period if it was after "no text overlays"
        # Ensure the prompt doesn't end with just a comma or awkward punctuation
        cleaned = cleaned.strip()
        return cleaned
    
    # For all other clips: Add "no text overlays" (both starting frames and regular images)
    # Text can be embedded in the image (like signage, banners), but NO text overlays
    # Check if any variation of "no text overlays" is already present
    no_text_patterns = [
        r'\bno\s+text\s+overlays?\b',
        r'\bno\s+text\s+on\s+screen\b',
        r'\bno\s+text\s+elements?\b',
        r'\bwithout\s+text\s+overlays?\b',
    ]
    
    has_no_text_instruction = any(
        re.search(pattern, cleaned, re.IGNORECASE) 
        for pattern in no_text_patterns
    )
    
    if not has_no_text_instruction:
        # Add "no text overlays" at the end if missing (for all images except Clip 0)
        cleaned = f"{cleaned}, no text overlays"
    
    return cleaned


def generate_image_with_nano_banana(prompt: str, output_path: str, aspect_ratio: str = "9:16", is_starting_frame: bool = False, clip_num: int = -1) -> str:
    """Generate image using nano-banana-pro model
    
    Args:
        prompt: Image generation prompt
        output_path: Where to save the generated image
        aspect_ratio: Aspect ratio for the image (default "9:16")
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip
                          If False, this is a regular image for IMAGE_ONLY clip
                          Both types need "no text overlays" (text overlays not allowed)
    """
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    # This will also add "no text overlays" for all images EXCEPT Clip 0
    prompt = clean_prompt_for_visual(prompt, is_starting_frame=is_starting_frame, clip_num=clip_num)
    
    # Double-check "no text overlays" is present (for all images EXCEPT Clip 0)
    # Clip 0 (SILENT_IMAGE) REQUIRES text overlays - do not add "no text overlays" for it
    if clip_num != 0:
        import re
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
        ]
        has_no_text = any(re.search(pattern, prompt, re.IGNORECASE) for pattern in no_text_patterns)
        if not has_no_text:
            prompt = f"{prompt}, no text overlays"
    
    print(f"\n  🖼️ Generating image with nano-banana-pro...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Aspect ratio: {aspect_ratio}")
    print(f"     Starting frame: {is_starting_frame} (no text overlays: True for all images)")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Add negative prompt for ALL images (both starting frames and regular images)
    # Text can be embedded in image (like signage), but NO text overlays
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text, hashtags, social media text, any text overlay"
    
    try:
        result = fal_client.subscribe(
            "fal-ai/nano-banana-pro",
            arguments={
                "prompt": prompt,
                "num_images": 1,
                "aspect_ratio": aspect_ratio,
                "output_format": "png",
                "resolution": "1K",
                "negative_prompt": negative_prompt
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0].get('url')
            if image_url:
                # Download and save image
                response = requests.get(image_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Image saved: {output_path}")
                return output_path
        
        print(f"  ❌ No image in result")
        return None
        
    except Exception as e:
        print(f"  ❌ Image generation failed: {e}")
        return None


def generate_image_with_nano_banana_edit(prompt: str, output_path: str, reference_image_urls: List[str], aspect_ratio: str = "9:16", is_starting_frame: bool = False, clip_num: int = -1) -> str:
    """
    Generate image using nano-banana-pro/edit model with reference images for consistency.
    Used for subsequent influencer images to maintain character appearance.
    
    Args:
        prompt: Image generation prompt (should include "reference influencer")
        output_path: Where to save the generated image
        reference_image_urls: List of S3 presigned URLs for reference images (first influencer image)
        aspect_ratio: Aspect ratio for the image (default "9:16")
        is_starting_frame: If True, this is a starting frame for AI_VIDEO clip
                          If False, this is a regular image for IMAGE_ONLY clip
                          Both types need "no text overlays" (text overlays not allowed)
    
    Returns:
        Path to saved image or None
    """
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    # This will add "no text overlays" for all images EXCEPT Clip 0 (which requires text overlays)
    prompt = clean_prompt_for_visual(prompt, is_starting_frame=is_starting_frame, clip_num=clip_num)
    
    # Double-check "no text overlays" is present (for all images except Clip 0)
    if clip_num != 0:
        import re
        no_text_patterns = [
            r'\bno\s+text\s+overlays?\b',
            r'\bno\s+text\s+on\s+screen\b',
            r'\bno\s+text\s+elements?\b',
        ]
        has_no_text = any(re.search(pattern, prompt, re.IGNORECASE) for pattern in no_text_patterns)
        if not has_no_text:
            prompt = f"{prompt}, no text overlays"
    
    print(f"\n  🖼️ Generating image with nano-banana-pro/edit (with reference)...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Reference images: {len(reference_image_urls)}")
    print(f"     Aspect ratio: {aspect_ratio}")
    print(f"     Starting frame: {is_starting_frame} (no text overlays: True for all images)")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Add negative prompt for ALL images (both starting frames and regular images)
    # Text can be embedded in image (like signage), but NO text overlays
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text, hashtags, social media text, any text overlay"
    
    try:
        arguments = {
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
            "output_format": "png",
            "resolution": "1K",  # As per example
            "image_urls": reference_image_urls,  # Reference images for consistency
            "negative_prompt": negative_prompt
        }
        
        # Add reference images for character consistency
        if reference_image_urls:
            print(f"     📸 Using {len(reference_image_urls)} reference images for consistency")
        
        result = fal_client.subscribe(
            "fal-ai/nano-banana-pro/edit",
            arguments=arguments,
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0].get('url')
            if image_url:
                # Download and save image
                response = requests.get(image_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Image saved (with reference): {output_path}")
                return output_path
        
        print(f"  ❌ No image in result")
        return None
        
    except Exception as e:
        print(f"  ❌ Image generation (edit) failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# AI VIDEO GENERATION (VEO3.1)
# ============================================

def round_duration_to_veo_supported(duration: float) -> int:
    """
    Round up duration to nearest Veo3.1 supported value (4, 6, or 8 seconds).
    
    Args:
        duration: Desired duration in seconds
    
    Returns:
        Nearest supported duration (4, 6, or 8)
    """
    if duration <= 4:
        return 4
    elif duration <= 6:
        return 6
    elif duration <= 8:
        return 8
    else:
        # For durations > 8s, return 8 (will be extended by looping)
        return 8


def extend_video_by_looping(video_path: str, target_duration: float, output_path: str) -> Optional[str]:
    """
    Extend video by looping it to match target duration.
    
    Args:
        video_path: Path to source video
        target_duration: Target duration in seconds
        output_path: Where to save extended video
    
    Returns:
        Path to extended video or None
    """
    try:
        from moviepy.editor import VideoFileClip, concatenate_videoclips
        
        print(f"  🔄 Extending video by looping: {target_duration:.2f}s")
        
        # Load source video
        source_clip = VideoFileClip(video_path)
        source_duration = source_clip.duration
        
        if source_duration >= target_duration:
            # Video is already long enough, just copy it
            source_clip.close()
            import shutil
            shutil.copy(video_path, output_path)
            return output_path
        
        # Calculate how many loops needed
        loops_needed = int(target_duration / source_duration) + 1
        print(f"     Source: {source_duration:.2f}s, Target: {target_duration:.2f}s, Loops: {loops_needed}")
        
        # Create list of clips to concatenate
        clips_to_loop = [source_clip] * loops_needed
        
        # Concatenate
        extended_clip = concatenate_videoclips(clips_to_loop, method="compose")
        
        # Trim to exact target duration
        final_clip = extended_clip.subclip(0, target_duration)
        
        # Write extended video
        final_clip.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio=source_clip.audio is not None,
            verbose=False,
            logger=None
        )
        
        # Cleanup
        source_clip.close()
        extended_clip.close()
        final_clip.close()
        
        print(f"  ✅ Extended video: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Failed to extend video: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def trim_influencer_clip_at_speech_end(video_path: str, min_search_time: float = 5.0, buffer_ms: int = 300) -> str:
    """
    Trim influencer clip at the point where speech ends (after min_search_time).
    Uses Demucs to separate vocals and detect when the character stops speaking.
    This prevents unnecessary weird gestures that appear in AI generated video clips.
    
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
        import numpy as np
        
        print(f"\n{'='*60}")
        print(f"✂️ INFLUENCER CLIP TRIMMING: Detecting speech end point")
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
        
        # Save trimmed video (overwrite original)
        trimmed_clip.write_videofile(
            video_path,
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
        
        trimmed_duration = VideoFileClip(video_path).duration
        print(f"\n✅ INFLUENCER CLIP TRIMMED SUCCESSFULLY!")
        print(f"   Original: {video_duration:.2f}s → Trimmed: {trimmed_duration:.2f}s")
        print(f"   Saved: {(video_duration - trimmed_duration):.2f}s of awkward silence removed")
        print(f"{'='*60}\n")
        
        return video_path
        
    except ImportError as e:
        print(f"⚠️ Demucs not available for speech detection: {e}")
        print("⚠️ Skipping influencer clip trim - using original video")
        return video_path
    except Exception as e:
        print(f"⚠️ Influencer clip trimming failed: {type(e).__name__}: {e}")
        import traceback
        print(f"⚠️ Traceback: {traceback.format_exc()}")
        print("⚠️ Using original video")
        return video_path


def generate_ai_video_clip(
    prompt: str, 
    starting_image_url: str, 
    output_path: str, 
    duration: float = 6,
    generate_audio: bool = False,
    target_duration: Optional[float] = None,
    language_code: str = "hi",
    language_name: Optional[str] = None
) -> str:
    """
    Generate AI video clip using veo3.1 fast image-to-video.
    Veo3.1 only supports durations of 4s, 6s, or 8s. If target_duration is longer,
    the video will be extended by looping.
    
    Args:
        prompt: Video generation prompt
        starting_image_url: S3 presigned URL of starting image
        output_path: Where to save the generated video
        duration: Desired video duration in seconds (will be rounded to 4/6/8)
        generate_audio: If True, generate audio (for influencer lip-sync)
        target_duration: If provided, extend video to this duration by looping
        language_code: Language code (e.g., "hi", "pa", "gu") for audio generation
        language_name: Language name (e.g., "Hindi", "Punjabi") for prompt
    
    Returns:
        Path to saved video or None
    """
    # Round duration to nearest supported value (4, 6, or 8)
    veo_duration = round_duration_to_veo_supported(duration)
    
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    prompt = clean_prompt_for_visual(prompt)
    
    # Add text distortion prevention instruction and no text overlays for video clips
    if "NO distortion" not in prompt and "no distortion" not in prompt:
        prompt = f"{prompt} NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping."
    
    # Add "no text overlays" if not already present (must come before voiceover/speech text)
    if "no text overlays" not in prompt.lower() and "no text on screen" not in prompt.lower() and "no text elements" not in prompt.lower():
        # Insert before voiceover/speech text if present, otherwise append at end
        if "The influencer must say" in prompt or "Voiceover" in prompt or "Saying" in prompt:
            # Find where voiceover/speech starts and insert before it
            for marker in ["The influencer must say", "Voiceover", "Saying"]:
                if marker in prompt:
                    idx = prompt.find(marker)
                    prompt = prompt[:idx].rstrip() + " no text overlays. " + prompt[idx:]
                    break
        else:
            # No voiceover, just append at end
            prompt = f"{prompt} no text overlays"
    
    # If generating audio, ensure language is explicitly stated in prompt
    if generate_audio and language_name:
        # Check if language is already mentioned in prompt
        language_mentioned = any(
            lang.lower() in prompt.lower() 
            for lang in [language_name, language_code, "speaking in", "language"]
        )
        if not language_mentioned:
            # Append language instruction to prompt
            prompt = f"{prompt} The influencer is speaking in {language_name} language (ISO code: {language_code})."
            print(f"     ⚠️ Added language instruction to prompt: {language_name} ({language_code})")
    
    print(f"\n  🎬 Generating AI video with veo3.1...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Starting image URL: {starting_image_url[:80]}...")
    print(f"     Requested duration: {duration:.2f}s → Veo duration: {veo_duration}s")
    if target_duration and target_duration > veo_duration:
        print(f"     Will extend to: {target_duration:.2f}s by looping")
    print(f"     Generate Audio: {generate_audio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Generate video with Veo3.1 supported duration
        result = fal_client.subscribe(
            "fal-ai/veo3.1/fast/image-to-video",
            arguments={
                "prompt": prompt,
                "image_url": starting_image_url,
                "aspect_ratio": "9:16",
                "duration": f"{veo_duration}s",
                "generate_audio": generate_audio
                # "auto_fix": True  # Auto-fix bad prompts to prevent generation failures
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            video_url = result['video'].get('url')
            if video_url:
                # Download and save video
                temp_video_path = output_path.replace('.mp4', '_temp.mp4')
                response = requests.get(video_url)
                with open(temp_video_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Video generated: {temp_video_path}")
                
                # If target_duration is longer than generated duration, extend by looping
                if target_duration and target_duration > veo_duration:
                    extended_path = extend_video_by_looping(temp_video_path, target_duration, output_path)
                    # Cleanup temp file
                    if os.path.exists(temp_video_path):
                        os.remove(temp_video_path)
                    return extended_path
                else:
                    # No extension needed, just rename
                    if os.path.exists(temp_video_path):
                        import shutil
                        shutil.move(temp_video_path, output_path)
                    print(f"  ✅ Video saved: {output_path}")
                    return output_path
        
        print(f"  ❌ No video in result")
        return None
        
    except Exception as e:
        print(f"  ❌ AI video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_ai_video_clip_seedance(
    prompt: str, 
    starting_image_url: str, 
    output_path: str, 
    duration: float = 6,
    generate_audio: bool = False,
    target_duration: Optional[float] = None,
    language_code: str = "hi",
    language_name: Optional[str] = None
) -> str:
    """
    Generate AI video clip using ByteDance Seedance v1.5 Pro image-to-video.
    Seedance supports durations of 4s, 6s, or 8s. If target_duration is longer,
    the video will be extended by looping.
    
    Args:
        prompt: Video generation prompt
        starting_image_url: S3 presigned URL of starting image
        output_path: Where to save the generated video
        duration: Desired video duration in seconds (will be rounded to 4/6/8)
        generate_audio: If True, generate audio (for influencer lip-sync)
        target_duration: If provided, extend video to this duration by looping
        language_code: Language code (e.g., "hi", "pa", "gu") for audio generation
        language_name: Language name (e.g., "Hindi", "Punjabi") for prompt
    
    Returns:
        Path to saved video or None
    """
    # Round duration to nearest supported value (4, 6, or 8)
    seedance_duration = round_duration_to_veo_supported(duration)
    
    # Clean prompt: remove square bracket expressions (only for TTS, not visuals)
    prompt = clean_prompt_for_visual(prompt)
    
    # Add text distortion prevention instruction and no text overlays for video clips
    if "NO distortion" not in prompt and "no distortion" not in prompt:
        prompt = f"{prompt} NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping."
    
    # Add "no text overlays" if not already present (must come before voiceover/speech text)
    if "no text overlays" not in prompt.lower() and "no text on screen" not in prompt.lower() and "no text elements" not in prompt.lower():
        # Insert before voiceover/speech text if present, otherwise append at end
        if "The influencer must say" in prompt or "Voiceover" in prompt or "Saying" in prompt:
            # Find where voiceover/speech starts and insert before it
            for marker in ["The influencer must say", "Voiceover", "Saying"]:
                if marker in prompt:
                    idx = prompt.find(marker)
                    prompt = prompt[:idx].rstrip() + " no text overlays. " + prompt[idx:]
                    break
        else:
            # No voiceover, just append at end
            prompt = f"{prompt} no text overlays"
    
    # If generating audio, ensure language is explicitly stated in prompt
    if generate_audio and language_name:
        # Check if language is already mentioned in prompt
        language_mentioned = any(
            lang.lower() in prompt.lower() 
            for lang in [language_name, language_code, "speaking in", "language"]
        )
        if not language_mentioned:
            # Append language instruction to prompt
            prompt = f"{prompt} The influencer is speaking in {language_name} language (ISO code: {language_code})."
            print(f"     ⚠️ Added language instruction to prompt: {language_name} ({language_code})")
    
    print(f"\n  🎬 Generating AI video with Seedance v1.5 Pro...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Starting image URL: {starting_image_url[:80]}...")
    print(f"     Requested duration: {duration:.2f}s → Seedance duration: {seedance_duration}s")
    if target_duration and target_duration > seedance_duration:
        print(f"     Will extend to: {target_duration:.2f}s by looping")
    print(f"     Generate Audio: {generate_audio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Generate video with Seedance
        result = fal_client.subscribe(
            "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
            arguments={
                "prompt": prompt,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "duration": str(int(seedance_duration)),  # Seedance expects duration as string integer
                "enable_safety_checker": True,
                "generate_audio": generate_audio,
                "image_url": starting_image_url,
                "camera_fixed": True
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            video_url = result['video'].get('url')
            if video_url:
                # Download and save video
                temp_video_path = output_path.replace('.mp4', '_temp.mp4')
                response = requests.get(video_url)
                with open(temp_video_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Video generated: {temp_video_path}")
                
                # If target_duration is longer than generated duration, extend by looping
                if target_duration and target_duration > seedance_duration:
                    extended_path = extend_video_by_looping(temp_video_path, target_duration, output_path)
                    # Cleanup temp file
                    if os.path.exists(temp_video_path):
                        os.remove(temp_video_path)
                    return extended_path
                else:
                    # No extension needed, just rename
                    if os.path.exists(temp_video_path):
                        import shutil
                        shutil.move(temp_video_path, output_path)
                    print(f"  ✅ Video saved: {output_path}")
                    return output_path
        
        print(f"  ❌ No video in result")
        return None
        
    except Exception as e:
        print(f"  ❌ AI video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_ai_video_clip_omnihuman(
    image_url: str,
    audio_url: str,
    output_path: str,
    resolution: str = "720p",
    activity_prompt: Optional[str] = None
) -> Optional[str]:
    """
    Generate avatar video using OmniHuman 1.5.
    Creates lip-synced avatar video from image and audio.
    
    Unlike Veo3.1 and Seedance which generate video from prompt,
    OmniHuman takes an image and audio to create lip-synced video.
    
    Args:
        image_url: S3 presigned URL of the avatar/influencer image
        audio_url: S3 presigned URL of the voiceover audio
        output_path: Where to save the generated video
        resolution: Video resolution ("720p" or "1080p")
        activity_prompt: Optional activity/movement instructions for the avatar
        
    Returns:
        Path to saved video or None
    """
    print(f"\n  🎬 Generating avatar video with OmniHuman 1.5...")
    print(f"     Image URL: {image_url[:80]}...")
    print(f"     Audio URL: {audio_url[:80]}...")
    print(f"     Resolution: {resolution}")
    if activity_prompt:
        print(f"     Activity: {activity_prompt[:80]}...")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    # Build arguments
    arguments = {
        "image_url": image_url,
        "audio_url": audio_url,
        "resolution": resolution
    }
    
    # Add activity prompt if provided
    if activity_prompt and activity_prompt.strip():
        arguments["prompt"] = activity_prompt.strip()
    
    try:
        result = fal_client.subscribe(
            "fal-ai/bytedance/omnihuman/v1.5",
            arguments=arguments,
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            video_url = result['video'].get('url')
            if video_url:
                response = requests.get(video_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ OmniHuman avatar video saved: {output_path}")
                return output_path
        
        print(f"  ❌ No video in OmniHuman result")
        return None
        
    except Exception as e:
        print(f"  ❌ OmniHuman video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# B_ROLL VIDEO GENERATION (Veo3.1 without audio)
# ============================================

def generate_b_roll_video(
    image_url: str,
    video_prompt: str,
    output_path: str,
    duration: int = 4
) -> Optional[str]:
    """
    Generate a B_ROLL video clip using Veo3.1 image-to-video WITHOUT audio.
    
    B_ROLL videos are background/supplementary footage that plays while
    voiceover is added separately during stitching.
    
    Args:
        image_url: S3 presigned URL of the starting image
        video_prompt: Prompt describing motion, dynamics, camera work
        output_path: Where to save the generated video
        duration: Video duration (always 4 seconds for B_ROLL)
        
    Returns:
        Path to saved video or None
    """
    print(f"\n  🎬 Generating B_ROLL video with Veo3.1 (no audio)...")
    print(f"     Video Prompt: {video_prompt[:100]}...")
    print(f"     Starting Image: {image_url[:80]}...")
    print(f"     Duration: {duration}s")
    
    # Clean prompt: remove square bracket expressions
    video_prompt = clean_prompt_for_visual(video_prompt)
    
    # Add no text overlays instruction if not present
    if "no text overlays" not in video_prompt.lower():
        video_prompt = f"{video_prompt} no text overlays"
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        # Generate video with Veo3.1 - NO audio
        result = fal_client.subscribe(
            "fal-ai/veo3.1/fast/image-to-video",
            arguments={
                "prompt": video_prompt,
                "image_url": image_url,
                "aspect_ratio": "9:16",
                "duration": f"{duration}s",
                "generate_audio": False  # B_ROLL has no audio - voiceover added separately
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            video_url = result['video'].get('url')
            if video_url:
                response = requests.get(video_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ B_ROLL video saved: {output_path}")
                return output_path
        
        print(f"  ❌ No video in B_ROLL result")
        return None
        
    except Exception as e:
        print(f"  ❌ B_ROLL video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def create_video_from_b_roll_group(
    video_paths: List[str],
    output_path: str,
    duration: float,
    temp_dir: str = None
) -> Optional[str]:
    """
    Create a single video from multiple B_ROLL videos (video group) with equal spacing.
    
    Args:
        video_paths: List of B_ROLL video file paths (2-3 videos, already ranked/ordered by Grok)
        output_path: Output video file path
        duration: Total duration for the final clip in seconds (cut to match voiceover)
        temp_dir: Temporary directory for intermediate files
        
    Returns:
        Path to output video or None if failed
    """
    print(f"\n  🎬 Assembling B_ROLL video group ({len(video_paths)} videos)...")
    print(f"     Total Duration: {duration}s")
    print(f"     Duration per video: {duration/len(video_paths):.2f}s")
    
    if not video_paths:
        print(f"  ❌ No videos provided for video group")
        return None
    
    if len(video_paths) == 1:
        # Single video - just trim to duration
        print(f"     Single video in group, trimming to {duration}s")
        try:
            clip = VideoFileClip(video_paths[0])
            if clip.duration > duration:
                clip = clip.subclip(0, duration)
            clip.write_videofile(
                output_path,
                codec='libx264',
                audio=False,
                fps=FPS,
                preset='medium',
                verbose=False,
                logger=None
            )
            clip.close()
            print(f"  ✅ Single B_ROLL video trimmed: {output_path}")
            return output_path
        except Exception as e:
            print(f"  ❌ Failed to trim single video: {e}")
            return None
    
    try:
        # Calculate duration for each video segment
        duration_per_video = duration / len(video_paths)
        
        segment_clips = []
        
        for i, video_path in enumerate(video_paths):
            if not os.path.exists(video_path):
                print(f"     ⚠️ Video {i+1} not found: {video_path}")
                continue
            
            try:
                clip = VideoFileClip(video_path)
                # Trim each video to its allocated duration
                if clip.duration > duration_per_video:
                    clip = clip.subclip(0, duration_per_video)
                segment_clips.append(clip)
                print(f"     Video {i+1}: {clip.duration:.2f}s (target: {duration_per_video:.2f}s)")
            except Exception as e:
                print(f"     ⚠️ Failed to load video {i+1}: {e}")
        
        if not segment_clips:
            print(f"  ❌ No valid video segments for group")
            return None
        
        # Concatenate all segments
        print(f"  🔗 Concatenating {len(segment_clips)} video segments...")
        
        final_clip = concatenate_videoclips(segment_clips, method="compose")
        
        # Trim to exact target duration if needed
        if final_clip.duration > duration:
            final_clip = final_clip.subclip(0, duration)
        
        # Write final output
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio=False,  # No audio in B_ROLL - added later during stitching
            fps=FPS,
            preset='medium',
            verbose=False,
            logger=None
        )
        
        # Close clips
        final_clip.close()
        for clip in segment_clips:
            clip.close()
        
        print(f"  ✅ B_ROLL video group assembled: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ B_ROLL video group assembly failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# INFLUENCER VOICE PROCESSING PIPELINE
# ============================================

def extract_audio_from_video(video_path: str, output_audio_path: str) -> Optional[str]:
    """Extract audio track from video file"""
    print(f"\n  🔊 Extracting audio from video...")
    try:
        video = VideoFileClip(video_path)
        if video.audio is None:
            print(f"  ⚠️ Video has no audio track")
            video.close()
            return None
        
        video.audio.write_audiofile(output_audio_path, verbose=False, logger=None)
        video.close()
        print(f"  ✅ Audio extracted: {output_audio_path}")
        return output_audio_path
    except Exception as e:
        print(f"  ❌ Audio extraction failed: {e}")
        return None


def separate_voice_with_demucs(audio_path: str, output_dir: str) -> Optional[str]:
    """
    Separate voice from audio using demucs (htdemucs model).
    Uses the same pattern as dvyb_adhoc_generation.py.
    Returns path to isolated vocals track.
    """
    print(f"\n  🎵 Separating voice with Demucs (htdemucs model)...")
    
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import soundfile as sf
        
        # Load Demucs model (htdemucs is best for vocals)
        print("  🤖 Loading Demucs htdemucs model...")
        model = get_model('htdemucs')
        model.eval()
        
        # Load audio with torchaudio
        print("  📂 Loading audio file...")
        waveform, sample_rate = torchaudio.load(audio_path)
        
        # Ensure stereo (demucs expects stereo input)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        # Apply model
        print("  🔬 Separating voice from music (this may take 10-30 seconds)...")
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # htdemucs outputs: drums (0), bass (1), other (2), vocals (3)
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Save voice-only audio
        vocals_path = os.path.join(output_dir, f"vocals_{uuid.uuid4().hex[:8]}.wav")
        sf.write(vocals_path, vocals, sample_rate)
        
        print(f"  ✅ Vocals extracted: {vocals_path}")
        return vocals_path
        
    except ImportError as e:
        print(f"  ❌ Demucs import error: {e}")
        print(f"     Please install: pip install demucs torch torchaudio")
        return None
    except Exception as e:
        print(f"  ❌ Demucs separation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def get_word_timestamps_whisper(audio_path: str) -> Tuple[str, List[Dict]]:
    """
    Get word-level timestamps from audio using OpenAI Whisper API.
    Uses the exact pattern from OpenAI documentation.
    
    Returns tuple: (transcript_text, word_timestamps_list)
    - word_timestamps_list: list of dicts with 'word', 'start', 'end' keys
    """
    print(f"\n  📝 Getting word timestamps with Whisper...")
    
    try:
        from openai import OpenAI
        
        # Use module-level openai_api_key loaded from python-ai-backend/.env
        if not openai_api_key:
            print(f"  ⚠️ OPENAI_API_KEY not set in python-ai-backend/.env")
            return "", []
        
        client = OpenAI(api_key=openai_api_key)
        
        # Open audio file and request transcription with word-level timestamps
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-1",
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )
        
        # Extract transcript text
        transcript_text = transcription.text.strip() if hasattr(transcription, 'text') else ""
        print(f"  📄 Transcript: \"{transcript_text[:80]}{'...' if len(transcript_text) > 80 else ''}\"")
        
        # Extract word timestamps - directly access transcription.words as shown in example
        word_timestamps = []
        if hasattr(transcription, 'words') and transcription.words:
            for word_data in transcription.words:
                word_timestamps.append({
                    'word': word_data.word,
                    'start': word_data.start,
                    'end': word_data.end
                })
            
            print(f"  ✅ Got timestamps for {len(word_timestamps)} words")
        else:
            print(f"  ⚠️ No word-level timestamps in response (transcription.words is empty or missing)")
        
        return transcript_text, word_timestamps
        
    except Exception as e:
        print(f"  ❌ Whisper transcription failed: {e}")
        import traceback
        print(traceback.format_exc())
        return "", []


def is_text_english(text: str) -> bool:
    """
    Detect if transcribed text is English.
    Uses multiple heuristics: checks ASCII ratio, common English words, and English character patterns.
    
    Args:
        text: Transcribed text to check
    
    Returns:
        True if text appears to be English, False otherwise
    """
    if not text or not text.strip():
        return False
    
    # First check: ASCII ratio (English text is mostly ASCII)
    ascii_chars = sum(1 for char in text if ord(char) < 128)
    ascii_ratio = ascii_chars / len(text) if len(text) > 0 else 0
    
    # If >90% ASCII, very likely English (strong indicator)
    if ascii_ratio >= 0.9:
        # Additional check: look for non-ASCII characters that indicate other languages
        # Common non-English indicators: Devanagari, Chinese, Arabic, etc.
        non_ascii = [char for char in text if ord(char) >= 128]
        # If we have mostly ASCII and no obvious non-English script characters, it's likely English
        if len(non_ascii) == 0 or all(ord(c) < 0x0900 for c in non_ascii):  # Exclude Devanagari and similar
            return True
    
    # Second check: Common English words (for shorter texts or mixed content)
    import re
    text_clean = re.sub(r'[^\w\s]', '', text.lower())
    words = text_clean.split()
    
    if not words:
        return False
    
    # Expanded common English words (including technical terms)
    common_english_words = {
        'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
        'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
        'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
        'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
        'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
        'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
        'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
        'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
        'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
        'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
        # Technical/common English words
        'intelligent', 'spot', 'instance', 'utilization', 'automatic', 'failover', 'interruption',
        'with', 'upon', 'system', 'technology', 'data', 'information', 'process', 'method',
        'application', 'service', 'platform', 'software', 'hardware', 'network', 'server',
        'client', 'user', 'access', 'control', 'management', 'operation', 'function',
        'feature', 'component', 'module', 'interface', 'database', 'storage', 'memory'
    }
    
    # Count English words
    english_word_count = sum(1 for word in words if word in common_english_words)
    
    # Check if at least 20% of words are common English words (lowered threshold for technical text)
    # OR if >80% ASCII and no obvious non-English script
    if len(words) > 0:
        english_ratio = english_word_count / len(words)
        if english_ratio >= 0.2:
            return True
    
    # Fallback: If >80% ASCII and no obvious non-English characters, likely English
    if ascii_ratio >= 0.8:
        # Check for common non-English script ranges
        non_english_scripts = [
            range(0x0900, 0x097F),  # Devanagari (Hindi, etc.)
            range(0x4E00, 0x9FFF),  # CJK Unified Ideographs (Chinese, Japanese)
            range(0x0600, 0x06FF),  # Arabic
            range(0x0400, 0x04FF),  # Cyrillic
        ]
        has_non_english_script = any(
            any(ord(char) in script_range for char in text)
            for script_range in non_english_scripts
        )
        if not has_non_english_script:
            return True
    
    return False
    return ascii_ratio > 0.8


def generate_voiceover_direct_elevenlabs(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, audio_model: str = "v3") -> Tuple[Optional[str], float]:
    """
    Generate voiceover using direct ElevenLabs API (supports custom voices).
    
    This bypasses FAL and calls ElevenLabs API directly, allowing use of custom voices
    that are only available to authenticated accounts.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (can be a custom voice ID)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0) - Note: may not be supported in all models
        audio_model: ElevenLabs model to use - "v3", "v2", or "turbo"
    
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError:
        print("  ❌ ElevenLabs SDK not installed. Run: pip install elevenlabs")
        return None, 0
    
    if not elevenlabs_api_key:
        print("  ❌ ELEVENLABS_API_KEY not set in python-ai-backend/.env")
        return None, 0
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Map audio model to ElevenLabs model ID
    model_map = {
        "v3": "eleven_multilingual_v2",  # v3 maps to multilingual_v2 in direct API
        "v2": "eleven_multilingual_v2",
        "turbo": "eleven_turbo_v2_5"
    }
    model_id = model_map.get(audio_model, "eleven_multilingual_v2")
    model_display_name = {"v3": "Multilingual v2", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}.get(audio_model, "Multilingual v2")
    
    # Determine if we should use emotional format
    use_emotional_format = audio_model in ["v2", "turbo"]
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    print(f"\n  🎙️ Generating voiceover DIRECTLY via ElevenLabs API ({language_name}, {model_display_name})...")
    print(f"     Text: {processed_text[:100]}...")
    print(f"     Voice ID: {voice_id[:20]}...")
    print(f"     Model: {model_id}")
    
    try:
        client = ElevenLabs(api_key=elevenlabs_api_key)
        
        # Build voice settings with speed parameter
        # ElevenLabs supports speed in voice_settings for some models
        from elevenlabs import VoiceSettings
        voice_settings = VoiceSettings(
            stability=0.4,  # Lower stability for more expressive output
            similarity_boost=0.75,
            style=0.0,
            use_speaker_boost=True,
            speed=speed  # Pass CLI speed parameter
        )
        
        # Log speed if not default
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        # Generate audio - returns a generator of bytes
        audio_generator = client.text_to_speech.convert(
            text=processed_text,
            voice_id=voice_id,
            model_id=model_id,
            output_format="mp3_44100_128",
            voice_settings=voice_settings,
        )
        
        # Write audio bytes to file
        with open(output_path, 'wb') as f:
            for chunk in audio_generator:
                f.write(chunk)
        
        # Get actual audio duration
        try:
            audio_clip = AudioFileClip(output_path)
            duration = audio_clip.duration
            audio_clip.close()
        except:
            duration = 0
        
        print(f"  ✅ Voiceover saved (direct API): {output_path} (duration: {duration:.2f}s)")
        return output_path, duration
        
    except Exception as e:
        print(f"  ❌ Direct ElevenLabs API call failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None, 0


def generate_voiceover_direct_elevenlabs_with_timestamps(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, audio_model: str = "v3") -> Tuple[Optional[str], List[Dict]]:
    """
    Generate voiceover using direct ElevenLabs API with word timestamps.
    
    This bypasses FAL and calls ElevenLabs API directly, allowing use of custom voices.
    Since direct API doesn't return timestamps, we use Whisper as fallback.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (can be a custom voice ID)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        audio_model: ElevenLabs model to use - "v3", "v2", or "turbo"
    
    Returns: (audio_path, word_timestamps) or (None, [])
    """
    # First generate the audio using direct API
    audio_path, duration = generate_voiceover_direct_elevenlabs(
        text=text,
        output_path=output_path,
        language_code=language_code,
        voice_id=voice_id,
        speed=speed,
        audio_model=audio_model
    )
    
    if not audio_path:
        return None, []
    
    # Use Whisper to get word timestamps
    word_timestamps = []
    print(f"  🎯 Getting word timestamps via Whisper...")
    try:
        whisper_transcript, whisper_timestamps = get_word_timestamps_whisper(audio_path)
        if whisper_timestamps:
            word_timestamps = whisper_timestamps
            print(f"  ✅ Got {len(word_timestamps)} word timestamps from Whisper")
    except Exception as e:
        print(f"  ⚠️ Whisper timestamp extraction failed: {e}")
    
    return audio_path, word_timestamps


def generate_voiceover_with_timestamps(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, max_retries: int = 2, audio_model: str = "v3", elevenlabs_direct: bool = False) -> Tuple[Optional[str], List[Dict]]:
    """
    Generate voiceover using ElevenLabs TTS with word timestamps and retry logic.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        max_retries: Maximum number of retry attempts (default: 2)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    
    Returns: (audio_path, word_timestamps) or (None, [])
    """
    # If elevenlabs_direct flag is set, use direct API call
    if elevenlabs_direct:
        return generate_voiceover_direct_elevenlabs_with_timestamps(
            text=text,
            output_path=output_path,
            language_code=language_code,
            voice_id=voice_id,
            speed=speed,
            audio_model=audio_model
        )
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine API endpoint and settings based on audio model
    use_emotional_format = audio_model in ["v2", "turbo"]
    stability = 0.4  # Lower stability for more expressive output (all models)
    
    if audio_model == "v2":
        api_endpoint = "fal-ai/elevenlabs/tts/multilingual-v2"
        model_display_name = "Multilingual v2"
    elif audio_model == "turbo":
        api_endpoint = "fal-ai/elevenlabs/tts/turbo-v2.5"
        model_display_name = "Turbo v2.5"
    else:  # Default to v3
        api_endpoint = "fal-ai/elevenlabs/tts/eleven-v3"
        model_display_name = "v3"
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    import time
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if attempt > 0:
            print(f"\n  🔄 Retry attempt {attempt}/{max_retries} for voiceover generation with timestamps...")
            time.sleep(2)  # Wait 2 seconds between retries
        else:
            print(f"\n  🎙️ Generating voiceover with timestamps ({language_name}, {model_display_name})...")
            if use_emotional_format:
                print(f"     Using emotional format with stability={stability}")
        
        print(f"     Text: {processed_text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        try:
            # All models support the same arguments
            arguments = {
                    "text": processed_text,
                    "voice": voice_id,
                    "stability": stability,
                    "similarity_boost": 0.75,
                "speed": speed,
                    "language_code": language_code,
                    "timestamps": True  # Request timestamps
            }
            
            result = fal_client.subscribe(
                api_endpoint,
                arguments=arguments,
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            audio_path = None
            word_timestamps = []
            
            if result and 'audio' in result:
                audio_url = result['audio'].get('url')
                if audio_url:
                    # Download and save audio
                    response = requests.get(audio_url)
                    with open(output_path, 'wb') as f:
                        f.write(response.content)
                    audio_path = output_path
                    print(f"  ✅ Voiceover saved: {output_path}")
                    
                    # Extract timestamps if available from ElevenLabs API
                    if result and 'normalized_alignment' in result:
                        alignment = result.get('normalized_alignment', {})
                        chars = alignment.get('characters', [])
                        char_starts = alignment.get('character_start_times_seconds', [])
                        char_ends = alignment.get('character_end_times_seconds', [])
                        
                        # Convert character-level to word-level timestamps
                        if chars and char_starts and char_ends:
                            current_word = ""
                            word_start = None
                            
                            for i, char in enumerate(chars):
                                if char == ' ' or i == len(chars) - 1:
                                    if i == len(chars) - 1 and char != ' ':
                                        current_word += char
                                    
                                    if current_word and word_start is not None:
                                        word_timestamps.append({
                                            'word': current_word,
                                            'start': word_start,
                                            'end': char_ends[i-1] if i > 0 else char_ends[i]
                                        })
                                    current_word = ""
                                    word_start = None
                                else:
                                    if word_start is None:
                                        word_start = char_starts[i]
                                    current_word += char
                            
                            if word_timestamps:
                                print(f"  ✅ Got timestamps for {len(word_timestamps)} words from ElevenLabs API")
                    
                    # Fallback: Use Whisper to get word timestamps if ElevenLabs API didn't provide them
                    if not word_timestamps and audio_path:
                        print(f"  ⚠️ No timestamps from ElevenLabs API, using Whisper as fallback...")
                        try:
                            whisper_transcript, whisper_timestamps = get_word_timestamps_whisper(audio_path)
                            if whisper_timestamps:
                                word_timestamps = whisper_timestamps
                                print(f"  ✅ Got {len(word_timestamps)} word timestamps from Whisper fallback")
                        except Exception as e:
                            print(f"  ⚠️ Whisper fallback failed: {e}")
                    
                    # Success - return the audio path and timestamps
                    return audio_path, word_timestamps
            
            # Check if result has error detail
            if result and 'detail' in result:
                error_msg = result.get('detail', 'Unknown error')
                print(f"  ❌ No audio in result: {error_msg}")
            else:
                print(f"  ❌ No audio in result")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                return None, []
            
        except Exception as e:
            error_msg = str(e)
            print(f"  ❌ Voiceover generation failed: {error_msg}")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                import traceback
                print(traceback.format_exc())
                return None, []
    
    return None, []


def align_voiceover_to_timestamps(
    voiceover_path: str,
    voiceover_timestamps: List[Dict],
    target_timestamps: List[Dict],
    output_path: str
) -> Optional[str]:
    """
    Align voiceover audio to match target word timestamps from Veo lip-sync.
    
    Uses WORD-LEVEL alignment for precise lip-sync:
    1. Segments ElevenLabs audio by word timestamps
    2. For each word, time-stretches to match original word duration
    3. Concatenates aligned word segments
    
    Args:
        voiceover_path: Path to generated ElevenLabs voiceover
        voiceover_timestamps: Word timestamps from ElevenLabs (may be empty)
        target_timestamps: Word timestamps from original Veo audio (from Whisper)
        output_path: Where to save aligned audio
    
    Returns:
        Path to aligned audio or None
    """
    print(f"\n  🔧 Aligning voiceover to lip-sync timestamps (word-level)...")
    
    try:
        import librosa
        import soundfile as sf
        
        # Load voiceover audio
        y, sr = librosa.load(voiceover_path, sr=None)
        original_duration = len(y) / sr
        
        # Get target duration from Veo timestamps
        if not target_timestamps:
            print(f"  ⚠️ No target timestamps, using original voiceover")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        total_target_duration = max(t['end'] for t in target_timestamps)
        
        if original_duration <= 0 or total_target_duration <= 0:
            print(f"  ⚠️ Invalid durations, using original voiceover")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        print(f"     ElevenLabs duration: {original_duration:.2f}s")
        print(f"     Target lip-sync duration: {total_target_duration:.2f}s")
        print(f"     Target words: {len(target_timestamps)}, ElevenLabs words: {len(voiceover_timestamps)}")
        
        # WORD-LEVEL ALIGNMENT: Align each word individually
        if voiceover_timestamps and target_timestamps:
            # Try to match words even if counts differ slightly
            min_words = min(len(voiceover_timestamps), len(target_timestamps))
            
            if min_words > 0:
                print(f"     Using word-level alignment for precise lip-sync...")
                print(f"     Aligning {min_words} words (target: {len(target_timestamps)}, elevenlabs: {len(voiceover_timestamps)})")
                
                aligned_segments = []
                current_time = 0.0
                
                # Align words up to the minimum count
                for i in range(min_words):
                    target_word = target_timestamps[i]
                    vo_word = voiceover_timestamps[i]
                    
                    # Check for gap before this word (silence between words)
                    target_start = target_word['start']
                    if i > 0:
                        prev_target_end = target_timestamps[i-1]['end']
                        gap_duration = target_start - prev_target_end
                        if gap_duration > 0.01:  # More than 10ms gap
                            # Add silence for the gap
                            gap_samples = int(gap_duration * sr)
                            aligned_segments.append(np.zeros(gap_samples))
                            current_time += gap_duration
                    
                    # Get word timings
                    target_end = target_word['end']
                    target_duration = target_end - target_start
                    
                    vo_start = vo_word['start']
                    vo_end = vo_word['end']
                    vo_duration = vo_end - vo_start
                    
                    # Extract word segment from ElevenLabs audio
                    vo_start_sample = max(0, int(vo_start * sr))
                    vo_end_sample = min(len(y), int(vo_end * sr))
                    
                    if vo_end_sample > vo_start_sample:
                        word_segment = y[vo_start_sample:vo_end_sample]
                    else:
                        word_segment = np.array([])
                    
                    # Calculate stretch ratio for this word
                    if vo_duration > 0 and target_duration > 0 and len(word_segment) > 0:
                        word_stretch_ratio = target_duration / vo_duration
                        
                        # Limit stretch ratio to reasonable bounds (0.5x to 2.0x for individual words)
                        if word_stretch_ratio < 0.5:
                            word_stretch_ratio = 0.5
                        elif word_stretch_ratio > 2.0:
                            word_stretch_ratio = 2.0
                        
                        # Time-stretch this word segment
                        word_stretched = librosa.effects.time_stretch(word_segment, rate=1/word_stretch_ratio)
                        
                        # Trim or pad to exact target duration
                        target_samples = int(target_duration * sr)
                        if len(word_stretched) > target_samples:
                            word_stretched = word_stretched[:target_samples]
                        elif len(word_stretched) < target_samples:
                            # Pad with silence
                            padding = np.zeros(target_samples - len(word_stretched))
                            word_stretched = np.concatenate([word_stretched, padding])
                        
                        aligned_segments.append(word_stretched)
                        current_time += target_duration
                    else:
                        # Empty or invalid segment, add silence matching target duration
                        silence_samples = int(target_duration * sr)
                        aligned_segments.append(np.zeros(silence_samples))
                        current_time += target_duration
                
                # Handle remaining target words if any (add silence)
                if len(target_timestamps) > min_words:
                    print(f"     ⚠️ {len(target_timestamps) - min_words} extra target words, adding silence")
                    for i in range(min_words, len(target_timestamps)):
                        target_word = target_timestamps[i]
                        target_duration = target_word['end'] - target_word['start']
                        silence_samples = int(target_duration * sr)
                        aligned_segments.append(np.zeros(silence_samples))
                
                # Concatenate all aligned word segments
                if aligned_segments:
                    y_aligned = np.concatenate(aligned_segments)
                    
                    # Ensure total duration matches exactly
                    target_total_samples = int(total_target_duration * sr)
                    if len(y_aligned) > target_total_samples:
                        y_aligned = y_aligned[:target_total_samples]
                    elif len(y_aligned) < target_total_samples:
                        # Pad with silence at end
                        padding = np.zeros(target_total_samples - len(y_aligned))
                        y_aligned = np.concatenate([y_aligned, padding])
                    
                    # Save aligned audio
                    sf.write(output_path, y_aligned, sr)
                    
                    final_duration = len(y_aligned) / sr
                    print(f"     Word-level alignment complete: {final_duration:.2f}s ({min_words} words aligned)")
                    print(f"  ✅ Aligned voiceover saved: {output_path}")
                    return output_path
                else:
                    print(f"  ⚠️ No aligned segments, falling back to global alignment")
            else:
                print(f"  ⚠️ No matching words found, falling back to global alignment")
            
            # Concatenate all aligned word segments
            if aligned_segments:
                y_aligned = np.concatenate(aligned_segments)
                
                # Ensure total duration matches exactly
                target_total_samples = int(total_target_duration * sr)
                if len(y_aligned) > target_total_samples:
                    y_aligned = y_aligned[:target_total_samples]
                elif len(y_aligned) < target_total_samples:
                    # Pad with silence at end
                    padding = np.zeros(target_total_samples - len(y_aligned))
                    y_aligned = np.concatenate([y_aligned, padding])
                
                # Save aligned audio
                sf.write(output_path, y_aligned, sr)
                
                final_duration = len(y_aligned) / sr
                print(f"     Word-level alignment complete: {final_duration:.2f}s")
                print(f"  ✅ Aligned voiceover saved: {output_path}")
                return output_path
            else:
                print(f"  ⚠️ No aligned segments, falling back to global alignment")
        
        # FALLBACK: Global duration matching (if word counts don't match or no word timestamps)
        print(f"     Using global duration alignment (fallback)...")
        duration_diff = abs(original_duration - total_target_duration)
        if duration_diff < 0.3:
            print(f"     Durations close enough (diff: {duration_diff:.2f}s), using original")
            import shutil
            shutil.copy(voiceover_path, output_path)
            return output_path
        
        # Time-stretch to match target duration
        stretch_ratio = total_target_duration / original_duration
        
        # Limit stretch ratio to reasonable bounds (0.7x to 1.4x)
        if stretch_ratio < 0.7:
            print(f"     ⚠️ Stretch ratio {stretch_ratio:.2f} too low, clamping to 0.7")
            stretch_ratio = 0.7
        elif stretch_ratio > 1.4:
            print(f"     ⚠️ Stretch ratio {stretch_ratio:.2f} too high, clamping to 1.4")
            stretch_ratio = 1.4
        
        print(f"     Applying global stretch ratio: {stretch_ratio:.2f}")
        
        # Apply time stretching (rate is inverse of stretch ratio)
        y_stretched = librosa.effects.time_stretch(y, rate=1/stretch_ratio)
        
        # Trim or pad to exact target duration
        target_samples = int(total_target_duration * sr)
        if len(y_stretched) > target_samples:
            y_stretched = y_stretched[:target_samples]
        elif len(y_stretched) < target_samples:
            # Pad with silence
            padding = np.zeros(target_samples - len(y_stretched))
            y_stretched = np.concatenate([y_stretched, padding])
        
        # Save aligned audio
        sf.write(output_path, y_stretched, sr)
        
        final_duration = len(y_stretched) / sr
        print(f"     Final aligned duration: {final_duration:.2f}s")
        print(f"  ✅ Aligned voiceover saved: {output_path}")
        return output_path
        
    except ImportError as e:
        print(f"  ❌ librosa not installed: {e}")
        print(f"     Please install: pip install librosa soundfile")
        # Fall back to original
        import shutil
        shutil.copy(voiceover_path, output_path)
        return output_path
        
    except Exception as e:
        print(f"  ❌ Alignment failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def replace_audio_in_video(video_path: str, new_audio_path: str, output_path: str) -> Optional[str]:
    """Replace audio track in video with new audio, with volume normalization"""
    print(f"\n  🎬 Replacing audio in video...")
    
    try:
        import numpy as np
        import soundfile as sf
        
        video = VideoFileClip(video_path)
        new_audio = AudioFileClip(new_audio_path)
        
        # Normalize audio volume to prevent suppressed sound
        # Target RMS level: -20 dB (good for speech)
        try:
            import librosa
            
            # Load audio file for normalization (librosa handles both .wav and .mp3)
            audio_data, sample_rate = librosa.load(new_audio_path, sr=None, mono=True)
            
            # Calculate current RMS
            rms = np.sqrt(np.mean(audio_data**2))
            
            # Target RMS (-20 dB = 0.1 in linear scale)
            target_rms = 0.1
            
            # Avoid division by zero
            if rms > 0:
                # Calculate gain factor
                gain = target_rms / rms
                
                # Limit gain to prevent clipping (max 3x boost)
                gain = min(gain, 3.0)
                
                # Apply gain
                normalized_audio = audio_data * gain
                
                # Prevent clipping by normalizing if max exceeds 1.0
                max_val = np.abs(normalized_audio).max()
                if max_val > 0.95:
                    normalized_audio = normalized_audio * (0.95 / max_val)
                
                # Save normalized audio to temp file (always as .wav for compatibility)
                temp_normalized = new_audio_path.replace('.wav', '_normalized.wav').replace('.mp3', '_normalized.wav')
                sf.write(temp_normalized, normalized_audio, sample_rate)
                
                # Use normalized audio
                new_audio.close()
                new_audio = AudioFileClip(temp_normalized)
                
                print(f"     🔊 Audio normalized (gain: {gain:.2f}x, RMS: {rms:.4f} → {target_rms:.4f})")
        except Exception as e:
            print(f"     ⚠️ Audio normalization failed: {e}, using original audio")
        
        # Match audio duration to video
        if new_audio.duration > video.duration:
            new_audio = new_audio.subclip(0, video.duration)
        elif new_audio.duration < video.duration:
            # Pad with silence
            silence_duration = video.duration - new_audio.duration
            print(f"     Padding {silence_duration:.2f}s silence at end")
        
        # Apply fade-in/fade-out to prevent clicks/pops at clip boundaries
        fade_duration = min(0.03, new_audio.duration * 0.05)  # 30ms or 5% of duration
        new_audio = new_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
        
        # Set new audio
        final_video = video.set_audio(new_audio)
        
        # Write output
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            verbose=False,
            logger=None
        )
        
        video.close()
        new_audio.close()
        
        print(f"  ✅ Video with replaced audio saved: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Audio replacement failed: {e}")
        return None


def process_influencer_clip_voice(
    video_path: str,
    voiceover_text: str,
    output_path: str,
    temp_dir: str,
    language_code: str = "hi",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False
) -> Optional[str]:
    """
    Complete pipeline to process influencer clip:
    1. Extract audio from Veo-generated video
    2. Separate voice from background music using Demucs (removes Veo's background music)
    3. Get word timestamps from separated vocals using Whisper
    4. Generate ElevenLabs voiceover for the same text
    5. Align ElevenLabs voiceover to match original lip-sync timestamps
    6. Replace audio in video with the aligned ElevenLabs voiceover
    
    Args:
        video_path: Path to Veo-generated video (with AI voice + background music)
        voiceover_text: Text that was spoken
        output_path: Where to save processed video
        temp_dir: Temp directory for intermediate files
        language_code: Language for voiceover
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    
    Returns:
        Path to processed video or None
    """
    print(f"\n{'='*50}")
    print(f"🎭 PROCESSING INFLUENCER CLIP VOICE")
    print(f"{'='*50}")
    
    # Ensure voice_id has a default value
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    print(f"  Voice ID: {voice_id[:20]}...")
    
    clip_id = uuid.uuid4().hex[:8]
    
    # Step 1: Extract audio from Veo video
    print(f"\n  Step 1: Extracting audio from Veo video...")
    original_audio_path = os.path.join(temp_dir, f"original_audio_{clip_id}.wav")
    extracted_audio = extract_audio_from_video(video_path, original_audio_path)
    
    if not extracted_audio:
        print("  ⚠️ No audio in video, returning original")
        return video_path
    
    # Step 2: Separate voice from background music using Demucs
    # This removes the unwanted Veo-generated background music, keeping only the voice
    print(f"\n  Step 2: Separating voice from Veo background music...")
    vocals_path = separate_voice_with_demucs(extracted_audio, temp_dir)
    
    if not vocals_path:
        print("  ⚠️ Demucs separation failed, using original audio for timestamps")
        vocals_path = extracted_audio
    
    # Step 3: Get word timestamps from separated vocals using Whisper
    print(f"\n  Step 3: Getting word timestamps from Veo vocals...")
    original_transcript, original_timestamps = get_word_timestamps_whisper(vocals_path)
    
    if not original_timestamps:
        print("  ⚠️ No word timestamps from Whisper, will use duration-based alignment")
    else:
        print(f"  📊 Original speech: {len(original_timestamps)} words detected")
    
    # Step 4: Generate ElevenLabs voiceover with gender-based voice
    print(f"\n  Step 4: Generating ElevenLabs voiceover (replacing Veo AI voice)...")
    print(f"     Using voice ID: {voice_id[:20]}... (for consistency across all influencer clips)")
    elevenlabs_audio_path = os.path.join(temp_dir, f"elevenlabs_vo_{clip_id}.mp3")
    elevenlabs_audio, elevenlabs_timestamps = generate_voiceover_with_timestamps(
        voiceover_text, 
        elevenlabs_audio_path, 
        language_code,
        voice_id=voice_id,
        speed=speed,
        audio_model=audio_model,
        elevenlabs_direct=elevenlabs_direct
    )
    
    if not elevenlabs_audio:
        print("  ⚠️ ElevenLabs voiceover failed, returning original video")
        return video_path
    
    # Step 5: Align ElevenLabs voiceover to match original lip-sync timestamps
    print(f"\n  Step 5: Aligning voiceover to original lip-sync...")
    aligned_audio_path = os.path.join(temp_dir, f"aligned_vo_{clip_id}.wav")
    aligned_audio = align_voiceover_to_timestamps(
        elevenlabs_audio,
        elevenlabs_timestamps,
        original_timestamps,
        aligned_audio_path
    )
    
    if not aligned_audio:
        print("  ⚠️ Alignment failed, using original ElevenLabs voiceover")
        aligned_audio = elevenlabs_audio
    
    # Step 6: Create video with no audio (completely remove Veo audio including background music)
    print(f"\n  Step 6: Replacing audio in video...")
    video_no_audio_path = os.path.join(temp_dir, f"video_no_audio_{clip_id}.mp4")
    try:
        video = VideoFileClip(video_path)
        video_no_audio = video.set_audio(None)
        video_no_audio.write_videofile(
            video_no_audio_path,
            fps=FPS,
            codec='libx264',
            audio=False,
            verbose=False,
            logger=None
        )
        video.close()
    except Exception as e:
        print(f"  ⚠️ Failed to strip audio: {e}")
        video_no_audio_path = video_path
    
    # Step 7: Add the aligned ElevenLabs voiceover to the video
    final_video = replace_audio_in_video(video_no_audio_path, aligned_audio, output_path)
    
    if final_video:
        print(f"\n  ✅ Influencer clip processed successfully!")
        print(f"     - Veo background music removed")
        print(f"     - ElevenLabs voiceover aligned to lip movements")
        return final_video
    
    return video_path  # Fall back to original


# ============================================
# IMAGE TO VIDEO (Using Effects)
# ============================================

def create_video_from_image_with_effects(
    image_path: str, 
    output_path: str, 
    duration: float, 
    effects: List[Dict]
) -> str:
    """Create video from image using dynamic_video_generator effects"""
    print(f"\n  🎬 Creating video from image with effects...")
    print(f"     Image: {image_path}")
    print(f"     Duration: {duration}s")
    print(f"     Effects: {len(effects)}")
    
    try:
        # Create effect engine
        engine = EffectEngine(
            image_path=image_path,
            output_size=OUTPUT_SIZE,
            duration=duration,
            fps=FPS
        )
        
        # Set effects plan
        engine.set_effects_plan(effects)
        
        # Generate video
        engine.generate_video(output_path)
        
        print(f"  ✅ Video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Video creation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def create_video_from_image_group(
    image_paths: List[str],
    output_path: str,
    duration: float,
    first_image_effects: List[Dict] = None,
    temp_dir: str = None
) -> str:
    """Create video from multiple images (image group) with rapid transitions.
    
    Args:
        image_paths: List of image file paths (2-3 images)
        output_path: Output video file path
        duration: Total duration for the clip in seconds
        first_image_effects: Effects to apply only to the first image (optional)
        temp_dir: Temporary directory for intermediate files
        
    Returns:
        Path to output video or None if failed
    """
    print(f"\n  🎬 Creating video from image group ({len(image_paths)} images)...")
    print(f"     Total Duration: {duration}s")
    print(f"     Duration per image: {duration/len(image_paths):.2f}s")
    
    if not image_paths:
        print(f"  ❌ No images provided for image group")
        return None
    
    if len(image_paths) == 1:
        # Single image - use regular function
        print(f"     Single image in group, using standard effect processing")
        effects = first_image_effects if first_image_effects else []
        return create_video_from_image_with_effects(image_paths[0], output_path, duration, effects)
    
    try:
        # Calculate duration for each image segment
        duration_per_image = duration / len(image_paths)
        
        # Create temp directory if not provided
        if not temp_dir:
            temp_dir = os.path.dirname(output_path) or "."
        
        segment_clips = []
        
        for i, img_path in enumerate(image_paths):
            segment_output = os.path.join(temp_dir, f"image_group_segment_{i}.mp4")
            
            if i == 0 and first_image_effects:
                # First image gets effects
                print(f"     Image {i+1}: Applying {len(first_image_effects)} effects ({duration_per_image:.2f}s)")
                segment_result = create_video_from_image_with_effects(
                    img_path, segment_output, duration_per_image, first_image_effects
                )
            else:
                # Other images are displayed as-is (static, no effects)
                print(f"     Image {i+1}: Static display ({duration_per_image:.2f}s)")
                # Create a simple static video from image
                engine = EffectEngine(
                    image_path=img_path,
                    output_size=OUTPUT_SIZE,
                    duration=duration_per_image,
                    fps=FPS
                )
                # No effects = static image
                engine.set_effects_plan([])
                engine.generate_video(segment_output)
                segment_result = segment_output
            
            if segment_result and os.path.exists(segment_result):
                segment_clips.append(segment_result)
            else:
                print(f"  ⚠️ Failed to create segment {i+1}, using image as fallback")
                # Fallback: create static video
                try:
                    engine = EffectEngine(
                        image_path=img_path,
                        output_size=OUTPUT_SIZE,
                        duration=duration_per_image,
                        fps=FPS
                    )
                    engine.set_effects_plan([])
                    engine.generate_video(segment_output)
                    if os.path.exists(segment_output):
                        segment_clips.append(segment_output)
                except Exception as fallback_err:
                    print(f"  ❌ Fallback also failed: {fallback_err}")
        
        if not segment_clips:
            print(f"  ❌ No segments created for image group")
            return None
        
        # Concatenate all segments
        print(f"  🔗 Concatenating {len(segment_clips)} image segments...")
        
        video_clips = [VideoFileClip(seg) for seg in segment_clips]
        final_clip = concatenate_videoclips(video_clips, method="compose")
        
        # Write final output
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio=False,  # No audio in image clips - added later
            fps=FPS,
            preset='medium',
            verbose=False,
            logger=None
        )
        
        # Close clips
        final_clip.close()
        for vc in video_clips:
            vc.close()
        
        # Clean up segment files
        for seg in segment_clips:
            try:
                if os.path.exists(seg):
                    os.remove(seg)
            except:
                pass
        
        print(f"  ✅ Image group video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ❌ Image group video creation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def generate_research_clip(
    claim_text: str,
    voiceover_text: str,
    output_path: str,
    temp_dir: str,
    research_type: str = "news",
    highlight_color: str = "black",
    language_code: str = "en",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False
) -> Tuple[Optional[str], Optional[str], float]:
    """Generate a research clip by searching for articles, capturing screenshots, and creating a highlight video.
    
    Args:
        claim_text: Searchable phrase to find in articles (from Grok's research_integration)
        voiceover_text: Short voiceover to accompany the research clip (from Grok)
        output_path: Path for the output video
        temp_dir: Temporary directory for intermediate files
        research_type: Type of source to search (news, blog, report, twitter)
        highlight_color: Color for highlighting text in screenshots
        language_code: Language for voiceover generation
        voice_id: ElevenLabs voice ID
        speed: Voiceover speed
        audio_model: ElevenLabs model (v3, v2, turbo)
        elevenlabs_direct: Whether to use direct ElevenLabs API
        
    Returns:
        Tuple of (video_path, voiceover_path, duration) or (None, None, 0) on failure
    """
    print(f"\n{'='*60}")
    print(f"📰 GENERATING RESEARCH CLIP")
    print(f"{'='*60}")
    print(f"  Search Query: {claim_text[:60]}{'...' if len(claim_text) > 60 else ''}")
    print(f"  Source Type: {research_type}")
    print(f"  Highlight Color: {highlight_color}")
    print(f"  Voiceover: {voiceover_text}")
    
    research_temp_dir = os.path.join(temp_dir, f"research_{uuid.uuid4().hex[:8]}")
    os.makedirs(research_temp_dir, exist_ok=True)
    
    try:
        # Step 1: Search for articles
        print(f"\n  📤 Step 1: Searching for articles...")
        search_results = search_articles(claim_text, num_results=5, search_type=research_type)
        
        if not search_results:
            print(f"  ❌ No search results found for: {claim_text}")
            return None, None, 0
        
        # Step 2: Try to capture folds from articles (with automatic retry on CAPTCHA)
        print(f"\n  📸 Step 2: Capturing article screenshots...")
        fold_images = None
        article_url = None
        
        for article in search_results:
            current_url = article.get("url", "")
            current_title = article.get("title", "")[:50]
            
            print(f"\n  📰 Trying: {current_title}...")
            print(f"     URL: {current_url[:60]}{'...' if len(current_url) > 60 else ''}")
            
            captured, is_blocked, block_reason = capture_multiple_folds(
                url=current_url,
                output_dir=research_temp_dir,
                num_folds=2,  # Just 2 folds for research clips
                scroll_offset=100,
                mobile=True  # Mobile viewport for 9:16
            )
            
            if not is_blocked and captured:
                fold_images = captured
                article_url = current_url
                print(f"  ✅ Successfully captured from: {current_url[:50]}...")
                break
            elif is_blocked:
                print(f"  ⏭️ Blocked: {block_reason}")
                continue
        
        if not fold_images:
            print(f"  ❌ Could not capture any article screenshots")
            return None, None, 0
        
        # Step 3: Ask Grok to suggest text to highlight based on the claim context
        # NOTE: Direct claim_text search almost never works because claims are paraphrased
        # Go straight to Grok suggestion which intelligently finds related text in the article
        print(f"\n  🎯 Step 3: Asking Grok to suggest text to highlight...")
        
        suggested_text, suggested_fold = suggest_highlight_text(fold_images, search_query=claim_text)
        
        if not suggested_text:
            print(f"  ❌ Grok could not find relevant text to highlight")
            return None, None, 0
        
        print(f"  ✅ Grok suggests: '{suggested_text[:50]}...'")
        
        # Step 4: Create highlight video with Grok-suggested text
        print(f"\n  🎬 Step 4: Creating highlight video...")
        research_video_path = os.path.join(temp_dir, f"research_clip_{uuid.uuid4().hex[:8]}.mp4")
        
        result = create_highlight_video(
            fold_images=fold_images,
            search_text=suggested_text,
            output_video_path=research_video_path,
            duration=2.0,  # Research clips are 2 seconds
            aspect_ratio="9:16",
            highlight_color=highlight_color,
            highlight_alpha=0.4,  # User specified 0.4
            fps=FPS,
            mobile=True,
            highlight_style="sweep",  # Default sweep style
            known_fold_index=suggested_fold  # Use the fold Grok identified
                )
        
        if not result or not os.path.exists(research_video_path):
            print(f"  ❌ Failed to create research clip video")
            return None, None, 0
        
        # Step 5: Generate voiceover for this research clip
        print(f"\n  🎙️ Step 5: Generating voiceover...")
        voiceover_path = os.path.join(temp_dir, f"research_vo_{uuid.uuid4().hex[:8]}.mp3")
        
        vo_result, vo_duration = generate_voiceover(
            voiceover_text,
            voiceover_path,
            language_code,
            voice_id,
            speed,
            audio_model=audio_model,
            elevenlabs_direct=elevenlabs_direct
        )
        
        if not vo_result:
            print(f"  ⚠️ Voiceover generation failed, using video without audio")
            vo_duration = 4.0  # Default duration
            voiceover_path = None
        
        print(f"\n  ✅ Research clip generated successfully!")
        print(f"     Video: {research_video_path}")
        print(f"     Voiceover: {voiceover_path if voiceover_path else 'None'}")
        print(f"     Duration: {vo_duration:.2f}s")
        
        return research_video_path, voiceover_path, vo_duration
        
    except Exception as e:
        print(f"  ❌ Research clip generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None, None, 0


def get_default_effects(duration: int, clip_num: int = 0) -> List[Dict]:
    """Get default effects if none specified. For Clip 0, keep it static (no effect) to preserve text visibility."""
    import random
    
    # For Clip 0 (SILENT_IMAGE), keep it static with no effects
    # This prevents text from being cut off by zoom/pan effects
    # The image contains important political text that must remain fully visible
    if clip_num == 0:
        # Return empty list = no effects = static image
        # This ensures all text remains visible and readable
        return []
    
    # For other clips, use ken_burns as default
    return [
        {
            "effect_type": "ken_burns",
            "start_region": {
                "left_pct": 20,
                "top_pct": 20,
                "right_pct": 60,
                "bottom_pct": 60
            },
            "end_region": {
                "left_pct": 40,
                "top_pct": 40,
                "right_pct": 80,
                "bottom_pct": 80
            },
            "zoom_start": 1.0,
            "zoom_end": 1.2,
            "start_time": 0,
            "duration": duration
        }
    ]


# ============================================
# VOICEOVER GENERATION (ElevenLabs v3)
# ============================================

def convert_voiceover_to_emotional_format(text: str) -> str:
    """
    Convert voiceover text to emotional format using GPT-4o.
    This adds emotion tags for more natural-sounding text-to-speech with v2/turbo models.
    
    Args:
        text: Original voiceover text
        
    Returns:
        Modified text with emotion tags, or original text if conversion fails
    """
    try:
        from openai import OpenAI
        
        client = OpenAI()
        
        prompt = f"""You are tasked with adding human emotion tags to a given text to enhance its expressiveness for text-to-speech applications. Your goal is to create a more natural and emotive reading experience while maintaining an AI-like quality. Follow these instructions carefully:

1. You will be provided with the original text in the following format:
<original_text>
{text}
</original_text>

2. Analyze the text and identify appropriate points where emotional expressions can be added. Consider the context, tone, and content of the text to determine suitable emotions.

3. Insert emotion tags at relevant points in the text. These tags should reflect the emotional state or tone that would be appropriate for a human-like voice with an AI touch.

4. Use the following format for emotion tags:
<emotion type="emotion_name" intensity="low/medium/high">

5. Common emotion types you can use include, but are not limited to:
- happy
- sad
- excited
- concerned
- curious
- surprised
- confused
- determined

6. Adjust the intensity of the emotion as appropriate: low, medium, or high.

7. Here are some examples of how to use emotion tags:
<emotion type="excited" intensity="medium">Great news!</emotion> The project was a success.
I'm <emotion type="concerned" intensity="low">not sure</emotion> if this is the right approach.

8. Insert the emotion tags throughout the text where appropriate, ensuring a natural flow and avoiding overuse.

9. Provide your modified text with emotion tags inserted in the following format:
<modified_text>
[Insert your modified text here]
</modified_text>

10. Ensure that you maintain the integrity of the original text, only adding emotion tags without changing the actual content.

Remember, the goal is to enhance the text for a more human-like voice while retaining an AI quality. Use your judgment to strike a balance between expressiveness and maintaining a slightly artificial feel."""

        print(f"  🎭 Converting voiceover to emotional format using GPT-4o...")
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000
        )
        
        result = response.choices[0].message.content
        
        # Extract content between <modified_text> tags
        import re
        match = re.search(r'<modified_text>\s*(.*?)\s*</modified_text>', result, re.DOTALL)
        
        if match:
            modified_text = match.group(1).strip()
            print(f"  ✅ Emotional format conversion complete")
            print(f"     Original: {text[:80]}...")
            print(f"     Modified: {modified_text[:80]}...")
            return modified_text
        else:
            print(f"  ⚠️ Could not extract modified text from GPT-4o response, using original")
            return text
            
    except Exception as e:
        print(f"  ⚠️ Emotional format conversion failed: {e}")
        print(f"     Using original text")
        return text


def generate_voiceover(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, speed: float = 1.0, max_retries: int = 2, audio_model: str = "v3", elevenlabs_direct: bool = False) -> Tuple[Optional[str], float]:
    """
    Generate voiceover using ElevenLabs TTS with retry logic
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        max_retries: Maximum number of retry attempts (default: 2)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    # If elevenlabs_direct flag is set, use direct API call
    if elevenlabs_direct:
        return generate_voiceover_direct_elevenlabs(
            text=text,
            output_path=output_path,
            language_code=language_code,
            voice_id=voice_id,
            speed=speed,
            audio_model=audio_model
        )
    
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine API endpoint and settings based on audio model
    use_emotional_format = audio_model in ["v2", "turbo"]
    stability = 0.4  # Lower stability for more expressive output (all models)
    
    if audio_model == "v2":
        api_endpoint = "fal-ai/elevenlabs/tts/multilingual-v2"
        model_display_name = "Multilingual v2"
    elif audio_model == "turbo":
        api_endpoint = "fal-ai/elevenlabs/tts/turbo-v2.5"
        model_display_name = "Turbo v2.5"
    else:  # Default to v3
        api_endpoint = "fal-ai/elevenlabs/tts/eleven-v3"
        model_display_name = "v3"
    
    # Convert text to emotional format for v2/turbo models
    processed_text = text
    if use_emotional_format:
        processed_text = convert_voiceover_to_emotional_format(text)
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    import time
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if attempt > 0:
            print(f"\n  🔄 Retry attempt {attempt}/{max_retries} for voiceover generation...")
            time.sleep(2)  # Wait 2 seconds between retries
        else:
            print(f"\n  🎙️ Generating voiceover with ElevenLabs {model_display_name} ({language_name})...")
            if use_emotional_format:
                print(f"     Using emotional format with stability={stability}")
        
        print(f"     Text: {processed_text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        try:
            # All models support the same arguments
            arguments = {
                    "text": processed_text,
                    "voice": voice_id,
                    "stability": stability,
                    "similarity_boost": 0.75,
                    "speed": speed,
                    "language_code": language_code,
                    "timestamps": False
            }
            
            result = fal_client.subscribe(
                api_endpoint,
                arguments=arguments,
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'audio' in result:
                audio_url = result['audio'].get('url')
                if audio_url:
                    # Download and save audio
                    import requests
                    response = requests.get(audio_url)
                    with open(output_path, 'wb') as f:
                        f.write(response.content)
                    
                    # Get actual audio duration
                    try:
                        audio_clip = AudioFileClip(output_path)
                        duration = audio_clip.duration
                        audio_clip.close()
                    except:
                        duration = 0
                    
                    print(f"  ✅ Voiceover saved: {output_path} (duration: {duration:.2f}s)")
                    return output_path, duration
            
            # Check if result has error detail
            if result and 'detail' in result:
                error_msg = result.get('detail', 'Unknown error')
                print(f"  ❌ No audio in result: {error_msg}")
            else:
                print(f"  ❌ No audio in result")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                return None, 0
            
        except Exception as e:
            error_msg = str(e)
            print(f"  ❌ Voiceover generation failed: {error_msg}")
            
            # If this was the last attempt, return failure
            if attempt == max_retries:
                return None, 0
    
    return None, 0


def generate_voiceover_per_clip(
    clip_voiceovers: List[Dict],  # List of {clip_number, voiceover_text}
    temp_dir: str,
    language_code: str = "hi",
    voice_id: Optional[str] = None,
    speed: float = 1.0,
    audio_model: str = "v3",
    elevenlabs_direct: bool = False
) -> Dict[int, Dict]:
    """
    Generate individual voiceover for each clip
    
    Args:
        clip_voiceovers: List of dicts with clip_number and voiceover_text
        temp_dir: Temporary directory for output files
        language_code: Language code for TTS
        voice_id: ElevenLabs voice ID
        speed: Voice speed multiplier (default: 1.0)
        audio_model: ElevenLabs model to use - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
        
    Returns: Dict mapping clip_number -> {path, duration}
    """
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    model_display = "Multilingual v2" if audio_model == "v2" else "v3"
    api_mode = "DIRECT API" if elevenlabs_direct else "via FAL"
    print(f"\n  Generating voiceover for {len(clip_voiceovers)} clips in {language_name} (ElevenLabs {model_display} {api_mode})...")
    if speed != 1.0:
        print(f"  Speed: {speed}x")
    
    voiceover_data = {}
    
    for clip_info in clip_voiceovers:
        clip_num = clip_info['clip_number']
        text = clip_info['voiceover_text']
        
        if not text or not text.strip():
            continue
        
        output_path = os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3")
        path, duration = generate_voiceover(text, output_path, language_code, voice_id, speed, audio_model=audio_model, elevenlabs_direct=elevenlabs_direct)
        
        if path:
            voiceover_data[clip_num] = {
                'path': path,
                'duration': duration
            }
            print(f"     Clip {clip_num}: {duration:.2f}s")
    
    return voiceover_data


# ============================================
# BACKGROUND MUSIC GENERATION
# ============================================

def generate_background_music(prompt: str, duration_seconds: int, output_path: str) -> str:
    """Generate background music using ElevenLabs Sound Effects v2"""
    print(f"\n  🎵 Generating background music...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Duration: {duration_seconds}s")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    try:
        result = fal_client.subscribe(
            "fal-ai/elevenlabs/sound-effects/v2",
            arguments={
                "text": prompt,
                "prompt_influence": 0.3,
                "output_format": "mp3_44100_128",
                "duration_seconds": duration_seconds
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'audio' in result:
            audio_url = result['audio'].get('url')
            if audio_url:
                # Download and save audio
                import requests
                response = requests.get(audio_url)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                print(f"  ✅ Music saved: {output_path}")
                return output_path
        
        print(f"  ❌ No audio in result")
        return None
        
    except Exception as e:
        print(f"  ❌ Music generation failed: {e}")
        return None


# ============================================
# VIDEO STITCHING
# ============================================

def normalize_audio_clip(audio_clip, target_rms_db=-20.0):
    """
    Normalize an audio clip to a target RMS level.
    
    Args:
        audio_clip: MoviePy AudioFileClip or AudioClip
        target_rms_db: Target RMS level in dB (default -20 dB for speech)
    
    Returns:
        Normalized AudioClip
    """
    try:
        import numpy as np
        import librosa
        import soundfile as sf
        import tempfile
        
        # Get audio data from clip - use librosa for reliable audio loading
        # Write audio to temp file first, then load with librosa
        import tempfile
        temp_audio = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_audio_path = temp_audio.name
        temp_audio.close()
        
        try:
            # Write audio clip to temporary file
            audio_clip.write_audiofile(temp_audio_path, verbose=False, logger=None, fps=audio_clip.fps)
            
            # Load with librosa (mono=True for consistent processing)
            audio_array, sample_rate = librosa.load(temp_audio_path, sr=None, mono=True)
            
            # Clean up temp file
            os.unlink(temp_audio_path)
        except Exception as e:
            # Clean up temp file on error
            try:
                os.unlink(temp_audio_path)
            except:
                pass
            raise e
        
        # Ensure audio_array is a 1D numpy array
        audio_array = np.asarray(audio_array).flatten()
        
        # Calculate current RMS
        rms = np.sqrt(np.mean(audio_array**2))
        
        # Target RMS in linear scale
        target_rms = 10 ** (target_rms_db / 20.0)
        
        # Avoid division by zero
        if rms > 0:
            # Calculate gain factor
            gain = target_rms / rms
            
            # Limit gain to prevent clipping (max 3x boost)
            gain = min(gain, 3.0)
            
            # Apply gain
            normalized_audio = audio_array * gain
            
            # Prevent clipping by normalizing if max exceeds 0.95
            max_val = np.abs(normalized_audio).max()
            if max_val > 0.95:
                normalized_audio = normalized_audio * (0.95 / max_val)
            
            # Create temporary file for normalized audio
            temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            temp_path = temp_file.name
            temp_file.close()
            
            # Save normalized audio (use sample_rate from librosa load)
            sf.write(temp_path, normalized_audio, sample_rate)
            
            # Create new audio clip from normalized file
            normalized_clip = AudioFileClip(temp_path)
            
            # Copy timing from original clip
            if hasattr(audio_clip, 'start') and audio_clip.start is not None:
                normalized_clip = normalized_clip.set_start(audio_clip.start)
            
            print(f"      🔊 Normalized audio (gain: {gain:.2f}x, RMS: {rms:.4f} → {target_rms:.4f})")
            
            return normalized_clip
        else:
            # No audio to normalize
            return audio_clip
            
    except Exception as e:
        print(f"      ⚠️ Audio normalization failed: {e}, using original audio")
        return audio_clip


def stitch_video_clips_with_music_groups(
    clip_paths: List[str],
    clip_numbers: List[int],  # Clip numbers corresponding to each path
    clip_durations: Dict[int, float],
    voiceover_files: Dict[int, Dict],  # clip_number -> {path, duration}
    music_files: Dict[str, Dict],
    clip_music_mapping: Dict[int, str],
    output_path: str
) -> str:
    """Stitch all video clips together with per-clip voiceovers and segmented music groups"""
    print(f"\n{'='*60}")
    print(f"🎬 STITCHING VIDEO WITH PER-CLIP VOICEOVERS")
    print(f"{'='*60}")
    print(f"  Clips: {len(clip_paths)}")
    print(f"  Clip numbers: {clip_numbers}")
    print(f"  Voiceovers: {len(voiceover_files)} clips have voiceover")
    print(f"  Music Groups: {len(music_files)}")
    
    try:
        # Load all video clips and calculate start times
        video_clips = []
        clip_start_times = {}
        current_time = 0
        
        for i, clip_path in enumerate(clip_paths):
            # Get the actual clip number for this position
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                video_clips.append(clip)
                clip_start_times[i] = current_time
                
                # Determine if this is a research clip (clip_num >= 1000)
                is_research_clip = clip_num >= 1000
                
                # For clips with separate voiceover, use voiceover duration as authoritative
                if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                    # Clip with separate voiceover - use voiceover duration
                    vo_duration = voiceover_files[clip_num].get('duration', clip.duration)
                    # Use the longer of clip duration or voiceover duration
                    final_duration = max(clip.duration, vo_duration)
                    clip_durations[clip_num] = final_duration
                    current_time += final_duration
                    if final_duration > clip.duration:
                        print(f"  Loaded clip {i}: {clip.duration}s → extended to {final_duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                    else:
                        clip_label = f"(research after {clip_num - 1000})" if is_research_clip else ""
                        print(f"  Loaded clip {i} {clip_label}: {clip.duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                elif clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                    # INFLUENCER clip with embedded audio - use actual video duration
                    actual_video_duration = clip.duration
                    clip_durations[clip_num] = actual_video_duration
                    current_time += actual_video_duration
                    print(f"  Loaded clip {i} (influencer): {actual_video_duration:.2f}s (actual video duration, starts at {clip_start_times[i]}s)")
                else:
                    # Clip without voiceover or with different handling
                    clip_duration = clip_durations.get(clip_num, clip.duration)
                    current_time += clip_duration
                    print(f"  Loaded clip {i}: {clip_duration:.2f}s (starts at {clip_start_times[i]}s)")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Calculate clip start times for logging
        print(f"\n  Clip timing:")
        for i, start_time in clip_start_times.items():
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            music_group = clip_music_mapping.get(clip_num, "None")
            print(f"    Clip {i} (#{clip_num}): starts at {start_time}s, music: {music_group}")
        
        # Build audio layers
        audio_clips = []
        
        # Extract audio from influencer clips (embedded voiceover) BEFORE concatenation
        # This preserves the audio timing correctly
        print(f"\n  Extracting audio from influencer clips:")
        AUDIO_BUFFER = 0.04  # 40ms buffer to prevent boundary artifacts
        
        # Build a mapping from clip_number to list index
        clip_num_to_index = {clip_numbers[i]: i for i in range(len(clip_numbers))}
        
        for clip_num, vo_info in voiceover_files.items():
            # CRITICAL: Clip 0 is SILENT_IMAGE - NEVER extract audio from it
            if clip_num == 0:
                print(f"    Clip {clip_num}: ⚠️ SILENT_IMAGE - skipping embedded audio (should never have audio)")
                continue
            
            if vo_info.get('embedded', False):
                # Find the list index for this clip number
                if clip_num not in clip_num_to_index:
                    print(f"    Clip {clip_num}: ⚠️ Not found in clip list, skipping audio extraction")
                    continue
                    
                list_idx = clip_num_to_index[clip_num]
                if list_idx >= len(video_clips):
                    print(f"    Clip {clip_num}: ⚠️ Index {list_idx} out of range for video_clips, skipping")
                    continue
                    
                clip = video_clips[list_idx]
                if clip.audio is not None:
                    start_time = clip_start_times.get(list_idx, 0)
                    actual_video_duration = clip.duration
                    
                    # CRITICAL: Trim embedded audio to ensure clean boundaries
                    # Use 40ms buffer to prevent sample alignment issues at clip boundaries
                    # PLUS add 150ms gap at END of voiceover for breathing room before next voiceover
                    VOICEOVER_END_GAP = 0.15  # 150ms gap between voiceovers for natural pacing
                    target_duration = min(clip.audio.duration, actual_video_duration) - AUDIO_BUFFER - VOICEOVER_END_GAP
                    target_duration = max(target_duration, 0.1)  # Minimum 100ms
                    
                    if clip.audio.duration > target_duration:
                        clip_audio = clip.audio.subclip(0, target_duration)
                    else:
                        clip_audio = clip.audio
                    
                    actual_audio_duration = clip_audio.duration
                    
                    # Normalize voiceover volume for consistency
                    print(f"    Clip {clip_num}: Normalizing embedded voiceover volume...")
                    clip_audio = normalize_audio_clip(clip_audio, target_rms_db=-20.0)
                    
                    # Apply fade in/out to prevent clicks/pops at clip boundaries
                    fade_duration = min(0.05, clip_audio.duration * 0.05)  # 50ms or 5% of duration
                    clip_audio = clip_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                    
                    # CRITICAL: Use actual audio duration for end time (not video duration)
                    # The 150ms gap at end creates natural pause before next clip's voiceover
                    clip_end_time = start_time + actual_audio_duration
                    clip_audio = clip_audio.set_start(start_time).set_end(clip_end_time)
                    
                    audio_clips.append(clip_audio)
                    print(f"    Clip {clip_num}: extracted embedded voiceover ({actual_audio_duration:.2f}s, starts at {start_time}s, ends at {clip_end_time:.2f}s)")
                else:
                    print(f"    Clip {clip_num}: ⚠️ No audio found in influencer clip video")
        
        # Remove audio from video clips before concatenation (we'll add it back in the composite)
        # This prevents audio duplication
        # Also resize all clips to OUTPUT_SIZE to prevent black borders
        # CRITICAL: Ensure clips match their planned durations (especially for accepted influencer clips >8s)
        video_clips_no_audio = []
        for i, clip in enumerate(video_clips):
            # Get the actual clip number for this position
            clip_num = clip_numbers[i] if i < len(clip_numbers) else i
            
            # Resize clip to target resolution to prevent black borders
            clip_size = clip.size
            if clip_size != OUTPUT_SIZE:
                print(f"  Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                clip = clip.resize(OUTPUT_SIZE)
            
            # CRITICAL: For influencer clips that were accepted (>8s, English),
            # clip_durations should already be set to the actual video duration
            # Use the actual video duration from the clip file itself (most authoritative)
            actual_clip_duration = clip.duration
            planned_duration = clip_durations.get(clip_num, actual_clip_duration)
            
            # For influencer clips with embedded audio, always use actual video duration
            # This ensures video and audio stay in sync for accepted clips (>8s, English)
            if clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                # Use actual video duration (don't trim)
                clip_durations[clip_num] = actual_clip_duration
                # Clip should already be the correct duration, no trimming needed
            elif actual_clip_duration != planned_duration:
                # For other clips, if duration doesn't match, update clip_durations
                if actual_clip_duration > planned_duration:
                    # Clip is longer than planned - trim to planned duration
                    clip = clip.subclip(0, planned_duration)
                    print(f"  ⚠️ Trimmed clip {i} from {actual_clip_duration:.2f}s to {planned_duration:.2f}s")
                else:
                    # Clip is shorter than planned - use actual duration
                    clip_durations[clip_num] = actual_clip_duration
                    print(f"  ⚠️ Clip {i} duration ({actual_clip_duration:.2f}s) shorter than planned ({planned_duration:.2f}s) - using actual duration")
            
            # CRITICAL: Remove audio from ALL video clips before concatenation
            # We manage all audio separately (voiceover files + embedded audio extraction + music)
            # Leaving any audio on clips can cause noise/pops at stitching boundaries
            video_clips_no_audio.append(clip.set_audio(None))
        
        # Concatenate video clips (all audio stripped - we add it back via CompositeAudioClip)
        final_video = concatenate_videoclips(video_clips_no_audio, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
        # Add per-clip voiceovers at their correct start times (non-embedded)
        print(f"\n  Adding separate voiceover files:")
        for clip_num, vo_info in voiceover_files.items():
            # CRITICAL: Clip 0 is SILENT_IMAGE - NEVER add voiceover for it
            if clip_num == 0:
                print(f"    Clip {clip_num}: ⚠️ SILENT_IMAGE - skipping voiceover (should never have voiceover)")
                continue
            
            # Skip if voiceover is embedded in video (already extracted above)
            if vo_info.get('embedded', False):
                continue
                
            vo_path = vo_info.get('path')
            if vo_path and os.path.exists(vo_path):
                voiceover = AudioFileClip(vo_path)
                
                # Find the list index for this clip number to get the start time
                list_idx = clip_num_to_index.get(clip_num)
                if list_idx is None:
                    print(f"    Clip {clip_num}: ⚠️ Not found in clip list, skipping voiceover")
                    continue
                    
                start_time = clip_start_times.get(list_idx, 0)
                clip_duration = clip_durations.get(clip_num, voiceover.duration)
                
                # CRITICAL: Trim voiceover to ensure clean boundaries
                # Use 40ms buffer to prevent sample alignment issues at clip boundaries
                # PLUS add 150ms gap at END of voiceover for breathing room before next voiceover
                VOICEOVER_END_GAP = 0.15  # 150ms gap between voiceovers for natural pacing
                target_duration = min(voiceover.duration, clip_duration) - AUDIO_BUFFER - VOICEOVER_END_GAP
                target_duration = max(target_duration, 0.1)  # Minimum 100ms
                
                if voiceover.duration > target_duration:
                    voiceover = voiceover.subclip(0, target_duration)
                
                actual_vo_duration = voiceover.duration
                
                # Normalize voiceover volume for consistency
                print(f"    Clip {clip_num}: Normalizing voiceover volume...")
                voiceover = normalize_audio_clip(voiceover, target_rms_db=-20.0)
                
                # Apply fade in/out to prevent clicks/pops at clip boundaries
                fade_duration = min(0.05, voiceover.duration * 0.05)  # 50ms or 5% of duration
                voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                
                # CRITICAL: Use actual voiceover duration for end time
                # The 150ms gap at end creates natural pause before next clip's voiceover
                clip_end_time = start_time + actual_vo_duration
                voiceover = voiceover.set_start(start_time).set_end(clip_end_time)
                
                audio_clips.append(voiceover)
                print(f"    Clip {clip_num} voiceover: {actual_vo_duration:.2f}s (starts at {start_time}s, ends at {clip_end_time:.2f}s)")
        
        # Use ONLY the first music group (Music_A) and loop it throughout entire video
        # Get the first music group (sorted alphabetically, so Music_A comes first)
        sorted_music_groups = sorted(music_files.keys())
        if sorted_music_groups:
            first_group_name = sorted_music_groups[0]
            music_info = music_files[first_group_name]
            music_path = music_info.get('path')
            
            if music_path and os.path.exists(music_path):
                music = AudioFileClip(music_path)
                
                # Calculate total video duration (sum of all clips)
                total_video_duration = sum(clip_durations.values())
                
                # CRITICAL: Music starts from Clip 1 (skip Clip 0 which is SILENT_IMAGE)
                clip_0_duration = clip_durations.get(0, 4.0)  # Clip 0 duration (default 4s)
                music_start_time = clip_0_duration
                music_duration_needed = total_video_duration - music_start_time
                
                print(f"  🎵 Using ONLY first music group '{first_group_name}' for entire video")
                print(f"     Original music duration: {music.duration:.1f}s")
                print(f"     Total video duration: {total_video_duration:.1f}s")
                print(f"     Music starts at: {music_start_time:.1f}s (after Clip 0)")
                print(f"     Music duration needed: {music_duration_needed:.1f}s")
                
                # Apply fade to original music BEFORE looping to ensure smooth loop transitions
                music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
                music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
                
                # Loop music to cover needed duration
                if music.duration < music_duration_needed:
                    loops_needed = int(music_duration_needed / music.duration) + 1
                    music_parts = [music] * loops_needed
                    music = concatenate_audioclips(music_parts)
                    print(f"     Looped music {loops_needed}x to cover video")
                
                # Trim to exact needed duration
                music = music.subclip(0, min(music.duration, music_duration_needed))
                
                # Apply final fade to the complete music track
                final_music_fade = min(0.1, music.duration * 0.01)  # 100ms or 1% for overall track
                music = music.audio_fadein(final_music_fade).audio_fadeout(final_music_fade)
                
                # Start music at Clip 1 (after Clip 0) and set volume very low
                music = music.set_start(music_start_time)
                music = music.volumex(0.07)  # Background music at 7% volume
                
                audio_clips.append(music)
                print(f"  ✅ Added music '{first_group_name}': {music.duration:.1f}s (starts at {music_start_time:.1f}s, skips Clip 0)")
        else:
            print(f"  ⚠️ No music groups available")
        
        # Combine all audio
        if audio_clips:
            final_audio = CompositeAudioClip(audio_clips)
            
            # CRITICAL: Add buffer at the END of the final video to prevent jitter/noise
            # Trim final audio slightly and add fade out at the very end
            END_BUFFER = 0.15  # 150ms buffer at end of video
            video_duration = final_video.duration
            
            if final_audio.duration > video_duration - END_BUFFER:
                # Trim audio to leave buffer at end
                final_audio = final_audio.subclip(0, video_duration - END_BUFFER)
                print(f"  🔇 Added {int(END_BUFFER*1000)}ms end buffer to prevent audio jitter")
            
            # Apply final fade out at the very end of the audio
            final_fade_duration = min(0.1, final_audio.duration * 0.02)  # 100ms or 2% of duration
            final_audio = final_audio.audio_fadeout(final_fade_duration)
            
            final_video = final_video.set_audio(final_audio)
            print(f"  Combined {len(audio_clips)} audio tracks")
        
        # CRITICAL: Add fade to black at the END of the video to prevent noise/jitter
        # This is especially important when the last clip is an AI Influencer clip
        FADE_OUT_DURATION = 0.3  # 300ms fade to black
        print(f"  🎬 Adding {FADE_OUT_DURATION}s fade to black at end of video")
        final_video = final_video.fadeout(FADE_OUT_DURATION)
        
        # Write final video
        print(f"\n  Writing final video to: {output_path}")
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            preset='medium',
            bitrate='8000k'
        )
        
        # Cleanup
        for clip in video_clips:
            clip.close()
        
        print(f"\n✅ Final video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"❌ Video stitching failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


def stitch_video_clips(
    clip_paths: List[str],
    voiceover_path: Optional[str],
    music_path: Optional[str],
    output_path: str
) -> str:
    """Legacy function - Stitch all video clips together with single audio track"""
    print(f"\n{'='*60}")
    print(f"🎬 STITCHING VIDEO")
    print(f"{'='*60}")
    print(f"  Clips: {len(clip_paths)}")
    print(f"  Voiceover: {'Yes' if voiceover_path else 'No'}")
    print(f"  Music: {'Yes' if music_path else 'No'}")
    
    try:
        # Load all video clips and resize to target resolution
        video_clips = []
        for i, clip_path in enumerate(clip_paths):
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                # Resize clip to target resolution to prevent black borders
                clip_size = clip.size
                if clip_size != OUTPUT_SIZE:
                    print(f"  Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                    clip = clip.resize(OUTPUT_SIZE)
                # CRITICAL: Strip audio from all clips to prevent noise at stitching points
                # We manage all audio separately (voiceover + music)
                clip = clip.set_audio(None)
                video_clips.append(clip)
                print(f"  Loaded clip {i}: {clip.duration}s")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Concatenate video clips (all audio stripped - we add it back separately)
        final_video = concatenate_videoclips(video_clips, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
        # Add audio
        audio_clips = []
        
        # Add voiceover
        if voiceover_path and os.path.exists(voiceover_path):
            voiceover = AudioFileClip(voiceover_path)
            # Trim or loop voiceover to match video duration
            if voiceover.duration > final_video.duration:
                voiceover = voiceover.subclip(0, final_video.duration)
            # Apply short fade in/out to prevent clicks/pops
            fade_duration = min(0.03, voiceover.duration * 0.05)
            voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
            audio_clips.append(voiceover)
            print(f"  Added voiceover: {voiceover.duration}s")
        
        # Add background music
        if music_path and os.path.exists(music_path):
            music = AudioFileClip(music_path)
            # Apply fade to original music BEFORE looping to ensure smooth loop transitions
            music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
            music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
            # Trim or loop music to match video duration
            if music.duration < final_video.duration:
                loops_needed = int(final_video.duration / music.duration) + 1
                music_clips_list = [music] * loops_needed
                music = concatenate_audioclips(music_clips_list)
            music = music.subclip(0, final_video.duration)
            # Apply final fade to the complete music track
            final_music_fade = min(0.1, music.duration * 0.01)  # 100ms or 1% for overall track
            music = music.audio_fadein(final_music_fade).audio_fadeout(final_music_fade)
            # Lower music volume when voiceover is present
            if voiceover_path:
                music = music.volumex(0.07)  # Background music at 7% volume
            audio_clips.append(music)
            print(f"  Added music: {music.duration}s")
        
        # Combine audio
        if audio_clips:
            if len(audio_clips) > 1:
                final_audio = CompositeAudioClip(audio_clips)
            else:
                final_audio = audio_clips[0]
            
            # CRITICAL: Add buffer at the END of the final video to prevent jitter/noise
            END_BUFFER = 0.15  # 150ms buffer at end of video
            video_duration = final_video.duration
            
            if final_audio.duration > video_duration - END_BUFFER:
                final_audio = final_audio.subclip(0, video_duration - END_BUFFER)
                print(f"  🔇 Added {int(END_BUFFER*1000)}ms end buffer to prevent audio jitter")
            
            # Apply final fade out at the very end
            final_fade_duration = min(0.1, final_audio.duration * 0.02)
            final_audio = final_audio.audio_fadeout(final_fade_duration)
            
            final_video = final_video.set_audio(final_audio)
        
        # CRITICAL: Add fade to black at the END of the video to prevent noise/jitter
        FADE_OUT_DURATION = 0.3  # 300ms fade to black
        print(f"  🎬 Adding {FADE_OUT_DURATION}s fade to black at end of video")
        final_video = final_video.fadeout(FADE_OUT_DURATION)
        
        # Write final video
        print(f"\n  Writing final video to: {output_path}")
        final_video.write_videofile(
            output_path,
            fps=FPS,
            codec='libx264',
            audio_codec='aac',
            preset='medium',
            bitrate='8000k'
        )
        
        # Cleanup
        for clip in video_clips:
            clip.close()
        
        print(f"\n✅ Final video created: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"❌ Video stitching failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# MAIN PIPELINE
# ============================================

def transliterate_transcription_words(transcription_data, language_code: str = "hi", language_name: str = "Hindi") -> bool:
    """
    Transliterate transcription words from non-English scripts (Hindi, Arabic, etc.) to English using GPT-4o-mini.
    This ensures captions display correctly in English fonts.
    
    Args:
        transcription_data: Transcription object with words attribute
        language_code: Language code of the transcription (e.g., "hi", "pa", "gu")
        language_name: Language name for better transliteration instructions (e.g., "Hindi", "Punjabi", "Gujarati")
    
    Returns:
        True if transliteration was applied, False otherwise
    """
    if not transcription_data or not hasattr(transcription_data, 'words') or not transcription_data.words:
        return False
    
    # Check if any words need transliteration (non-English scripts)
    words_to_transliterate = []
    word_indices = []
    for i, word_data in enumerate(transcription_data.words):
        if hasattr(word_data, 'word'):
            word_text = word_data.word
            # Check for non-ASCII scripts (Hindi/Devanagari, Arabic, Chinese, etc.)
            # Devanagari: \u0900-\u097F
            # Arabic: \u0600-\u06FF
            # Chinese/Japanese/Korean: \u4E00-\u9FFF, \u3040-\u309F, \u30A0-\u30FF, \uAC00-\uD7AF
            has_non_ascii = any(
                '\u0900' <= char <= '\u097F' or  # Devanagari
                '\u0600' <= char <= '\u06FF' or  # Arabic
                '\u4E00' <= char <= '\u9FFF' or  # CJK Unified Ideographs
                '\u3040' <= char <= '\u309F' or  # Hiragana
                '\u30A0' <= char <= '\u30FF' or  # Katakana
                '\uAC00' <= char <= '\uD7AF'     # Hangul
                for char in word_text
            )
            if has_non_ascii:
                words_to_transliterate.append(word_text)
                word_indices.append(i)
    
    if not words_to_transliterate:
        return False  # No transliteration needed
    
    print(f"  🔤 Transliterating {len(words_to_transliterate)} words to English using GPT-4o-mini...")
    
    try:
        # Initialize OpenAI client for transliteration (use existing import)
        # OpenAI is already imported via video_captions, but we need it here too
        try:
            from openai import OpenAI
        except ImportError:
            # Fallback if not imported
            import openai
            OpenAI = openai.OpenAI
        
        client = OpenAI(api_key=openai_api_key)
        
        # Combine all words for batch processing
        combined_text = " | ".join(words_to_transliterate)
        
        # Use provided language_name or determine from language_code
        if not language_name or language_name == "Hindi":
            language_names = {
                "hi": "Hindi Devanagari",
                "pa": "Punjabi Gurmukhi",
                "gu": "Gujarati",
                "bn": "Bengali",
                "ta": "Tamil",
                "te": "Telugu",
                "mr": "Marathi",
                "kn": "Kannada",
                "ml": "Malayalam",
                "or": "Odia",
                "ar": "Arabic",
                "zh": "Chinese",
                "ja": "Japanese",
                "ko": "Korean"
            }
            lang_name = language_names.get(language_code, language_name or "non-English script")
        else:
            lang_name = language_name
        
        print(f"  📝 Original language: {lang_name} ({language_code})")
        
        # Build comprehensive system prompt with examples
        system_prompt = f"""You are an expert transliterator. Convert {lang_name} text (language code: {language_code}) to English Roman script using SIMPLE ASCII characters only.

CRITICAL RULES:

1. USE ONLY ASCII ENGLISH CHARACTERS: Use only standard English letters (a-z, A-Z) and numbers. NO diacritical marks, NO special characters like ā, ī, ū, ṁ, ś, ṇ, ṛ, etc. Use simple 'a', 'i', 'u', 'm', 's', 'n', 'r' instead.

2. TRANSLITERATION FORMAT: Use simple phonetic English spelling (like 'saalon', 'vaishvik', 'nirmaataa') - NOT IAST format with diacritics. Double vowels for long sounds (aa, ii, uu, ee, oo).

3. PRESERVE ENGLISH WORDS: If a word in the original text is already in English (like 'factory', 'company', 'India', 'PF', 'ESIC', 'codes', etc.), keep it exactly as-is in English.

4. RECOGNIZE ENGLISH WORDS IN {lang_name.upper()} SCRIPT - CRITICAL: If a word in {lang_name} script is actually a transliteration of a common English word, convert it back to the ORIGINAL English word. This is especially important for:

   MONTH NAMES:
   - दिसंबर → December (NOT "disambar")
   - जनवरी → January (NOT "janavari")
   - फरवरी → February (NOT "pharavari")
   - मार्च → March (NOT "maarch")
   - अप्रैल → April (NOT "aprail")
   - मई → May (NOT "mai")
   - जून → June (NOT "joon")
   - जुलाई → July (NOT "julaai")
   - अगस्त → August (NOT "agast")
   - सितंबर → September (NOT "sitambar")
   - अक्टूबर → October (NOT "aktubar")
   - नवंबर → November (NOT "navambar")

   DAYS OF WEEK:
   - सोमवार → Monday (NOT "somvaar")
   - मंगलवार → Tuesday (NOT "mangalvaar")
   - बुधवार → Wednesday (NOT "budhvaar")
   - गुरुवार → Thursday (NOT "guruvaar")
   - शुक्रवार → Friday (NOT "shukravaar")
   - शनिवार → Saturday (NOT "shanivaar")
   - रविवार → Sunday (NOT "ravivaar")

   COMMON ENGLISH WORDS:
   - फ़ैक्टरी → factory (NOT "factory" transliterated)
   - कंपनी → company (NOT "kampani")
   - इंडिया → India (NOT "india")
   - टेक्नोलॉजी → technology (NOT "technology" transliterated)
   - सिस्टम → system (NOT "system" transliterated)
   - कंप्यूटर → computer (NOT "computer" transliterated)
   - इंटरनेट → internet (NOT "internet" transliterated)
   - मोबाइल → mobile (NOT "mobile" transliterated)
   - सॉफ्टवेयर → software (NOT "software" transliterated)
   - हार्डवेयर → hardware (NOT "hardware" transliterated)
   - बैंक → bank (NOT "bank" transliterated)
   - हॉस्पिटल → hospital (NOT "hospital" transliterated)
   - यूनिवर्सिटी → university (NOT "university" transliterated)
   - कॉलेज → college (NOT "college" transliterated)
   - स्कूल → school (NOT "school" transliterated)
   - पार्क → park (NOT "park" transliterated)
   - मार्केट → market (NOT "market" transliterated)
   - रेस्टोरेंट → restaurant (NOT "restaurant" transliterated)
   - होटल → hotel (NOT "hotel" transliterated)
   - एयरपोर्ट → airport (NOT "airport" transliterated)
   - स्टेशन → station (NOT "station" transliterated)
   - बस → bus (NOT "bus" transliterated)
   - ट्रेन → train (NOT "train" transliterated)
   - कार → car (NOT "car" transliterated)
   - बाइक → bike (NOT "bike" transliterated)

   PROPER NOUNS (Countries, Cities, Names):
   - अमेरिका → America (NOT "amerika")
   - ब्रिटेन → Britain (NOT "britain" transliterated)
   - लंदन → London (NOT "london" transliterated)
   - न्यूयॉर्क → New York (NOT "new york" transliterated)
   - पेरिस → Paris (NOT "paris" transliterated)
   - जर्मनी → Germany (NOT "germany" transliterated)
   - फ्रांस → France (NOT "france" transliterated)
   - जापान → Japan (NOT "japan" transliterated)
   - चीन → China (NOT "china" transliterated)
   - रूस → Russia (NOT "russia" transliterated)
   - ऑस्ट्रेलिया → Australia (NOT "australia" transliterated)
   - कनाडा → Canada (NOT "canada" transliterated)

   NUMBERS (when written in English numerals, keep as-is):
   - 1978 → 1978 (keep as number)
   - IC-410 → IC-410 (keep as-is)

   COMMON ABBREVIATIONS:
   - पीएफ → PF (NOT "PF" transliterated)
   - ईएसआईसी → ESIC (NOT "ESIC" transliterated)
   - आईसी → IC (NOT "IC" transliterated)
   - यूएसए → USA (NOT "USA" transliterated)
   - यूके → UK (NOT "UK" transliterated)

5. CAPITALIZATION: Use natural English capitalization - capitalize first letter of sentences, proper nouns (names, places, months, days), and acronyms. Keep common words lowercase.

6. CONTEXT AWARENESS: If you recognize a word as a common English word (especially months, days, countries, cities, technology terms, common nouns), always convert it back to the original English spelling, not a phonetic transliteration.

7. Return the transliterated text in the same format as input, separated by ' | ' if multiple texts are provided."""

        user_prompt = f"""Transliterate this {lang_name} text (language code: {language_code}) to English using ONLY ASCII characters (a-z, A-Z, 0-9). 

CRITICAL INSTRUCTIONS:
- NO diacritical marks
- Use simple phonetic spelling with double vowels for long sounds (aa, ii, uu, ee, oo)
- RECOGNIZE AND CONVERT: If any words are English words (months like दिसंबर→December, days, countries, cities, common nouns like कंपनी→company, technology terms, etc.), convert them back to the ORIGINAL English spelling
- Use natural capitalization (capitalize months, days, proper nouns, first letter of sentences)
- Keep the same format (use ' | ' separator if multiple texts):

{combined_text}"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            temperature=0.2,
            max_tokens=5000
        )
        
        transliterated_result = response.choices[0].message.content.strip()
        
        # Split the result back if multiple texts
        if len(words_to_transliterate) > 1:
            transliterated_texts = [t.strip() for t in transliterated_result.split('|')]
        else:
            transliterated_texts = [transliterated_result]
        
        # Update word objects with transliterated text
        for idx, transliterated in zip(word_indices, transliterated_texts):
            if idx < len(transcription_data.words):
                word_obj = transcription_data.words[idx]
                if hasattr(word_obj, 'word'):
                    word_obj.word = transliterated
        
        print(f"  ✅ Transliteration complete: {len(transliterated_texts)} words converted to English")
        return True
        
    except Exception as e:
        print(f"  ⚠️ Warning: Transliteration failed: {e}, using original text")
        import traceback
        print(traceback.format_exc())
        return False


def apply_captions_to_clip(video_path: str, caption_combination: str, language_code: str = "hi", temp_dir: str = None, audio_path: Optional[str] = None, transliterate: bool = False, language_name: str = "Hindi") -> Optional[str]:
    """
    Apply captions to a single video clip using VideoCaptionStyler.
    Optionally transliterates non-English text to English for proper font rendering.
    
    Args:
        video_path: Path to input video clip
        caption_combination: Name of caption combination (e.g., "boxed_purple")
        language_code: Language code for transcription (passed from CLI)
        temp_dir: Temporary directory for output (if None, uses same dir as input)
        audio_path: Optional path to separate audio file (for image-based clips with separate voiceover)
        transliterate: If True, transliterate non-English text to English using GPT-4o-mini
        language_name: Language name for better transliteration instructions (e.g., "Hindi", "Punjabi")
    
    Returns:
        Path to captioned video or None if failed
    """
    if not video_path or not os.path.exists(video_path):
        return None
    
    # Find the combination
    combo = find_combination(caption_combination)
    if not combo:
        print(f"  ⚠️ Warning: Caption combination '{caption_combination}' not found, skipping captions")
        return video_path
    
    # Determine output path
    if temp_dir:
        base_name = os.path.basename(video_path)
        name, ext = os.path.splitext(base_name)
        output_path = os.path.join(temp_dir, f"{name}_captioned{ext}")
    else:
        base_name = os.path.basename(video_path)
        name, ext = os.path.splitext(base_name)
        output_dir = os.path.dirname(video_path)
        output_path = os.path.join(output_dir, f"{name}_captioned{ext}")
    
    try:
        # Create VideoCaptionStyler instance
        styler = VideoCaptionStyler(video_path, output_path, api_key=openai_api_key)
        
        # Transcribe audio - use provided audio_path if available (for image-based clips)
        # Otherwise, extract from video (for AI_VIDEO clips with embedded audio)
        # CRITICAL: Use language_code from CLI for transcription
        if audio_path and os.path.exists(audio_path):
            print(f"  🔊 Using separate voiceover file for transcription: {os.path.basename(audio_path)}")
            print(f"  🌐 Transcribing with language code: {language_code} ({language_name})")
            transcription = styler.transcribe_audio(audio_path=audio_path, language=language_code)
        else:
            print(f"  🌐 Transcribing with language code: {language_code} ({language_name})")
            transcription = styler.transcribe_audio(language=language_code)
        
        if not transcription:
            print(f"  ⚠️ Warning: Failed to transcribe audio for captions, skipping")
            return video_path
        
        # Transliterate non-English text to English if --transliterate flag is provided
        # This ensures Hindi, Arabic, Chinese, etc. display correctly in captions using standard fonts
        if transliterate and language_code != "en":
            print(f"  🔤 Transliteration enabled: Converting {language_name} text to English...")
            transliterate_transcription_words(styler.transcription_data, language_code, language_name)
        elif not transliterate and language_code != "en":
            print(f"  ℹ️ Transliteration disabled: Using original {language_name} text for captions")
        
        # Generate captions
        if combo['effect'] == 'karaoke':
            max_words = 4
        else:
            max_words = 2
        
        styler.auto_generate_captions(
            max_words_per_caption=max_words,
            style_preset=combo['style'],
            word_effect=combo['effect']
        )
        
        # Render with captions
        styler.render(quality="high")
        
        # Extract and serialize transcription data for potential regeneration
        transcription_result = None
        if styler.transcription_data and hasattr(styler.transcription_data, 'words'):
            transcription_result = {
                'text': getattr(styler.transcription_data, 'text', ''),
                'language': getattr(styler.transcription_data, 'language', ''),
                'words': []
            }
            for word_data in styler.transcription_data.words:
                transcription_result['words'].append({
                    'word': getattr(word_data, 'word', str(word_data)),
                    'start': getattr(word_data, 'start', 0),
                    'end': getattr(word_data, 'end', 0)
                })
        
        if os.path.exists(output_path):
            print(f"  ✅ Captions applied: {combo['name']}")
            return output_path, transcription_result
        else:
            print(f"  ⚠️ Warning: Captioned video not created, using original")
            return video_path, transcription_result
            
    except Exception as e:
        print(f"  ⚠️ Warning: Failed to apply captions: {e}")
        import traceback
        print(traceback.format_exc())
        return video_path, None


def generate_political_video(input_file: str, output_path: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, voice_id: Optional[str] = None, captions: Optional[str] = None, transliterate: bool = False, desired_duration: Optional[str] = None, ai_video_model: str = "veo3.1", speed: float = 1.0, image_group_proportion: float = 0.5, voiceover_emotions: bool = False, audio_model: str = "v3", reference_image: Optional[str] = None, background_music: Optional[str] = None, elevenlabs_direct: bool = False, include_research: bool = False, research_type: str = "news", highlight_color: str = "black") -> str:
    """Main pipeline to generate political video from input document
    
    Args:
        input_file: Path to input document
        output_path: Path to output video
        background_music: Optional path to custom background music file. If provided and valid, 
                         this music will be used instead of ElevenLabs generated music.
        elevenlabs_direct: If True, call ElevenLabs API directly (allows custom voices)
        include_research: If True, generate research clips from Grok's research_integration
        research_type: Type of research source to search for (news, blog, report, twitter)
        highlight_color: Color for highlighting text in research clip screenshots
        language_code: Language code for voiceover
        influencer_mode: Whether to enable influencer mode
        influencer_gender: Gender of influencer ("male" or "female"), only used if influencer_mode is True
        user_instruction: Optional user instruction to guide prompt generation
        ai_video_model: AI video model to use for influencer clips ("veo3.1", "seedance1.5", or "omnihuman1.5")
        speed: Voice speed multiplier for ElevenLabs TTS (default: 1.0)
        image_group_proportion: Proportion of IMAGE_ONLY clips to use image groups (0.0-1.0, default: 0.5)
        voiceover_emotions: Whether to include emotional expressions in voiceover text
        audio_model: ElevenLabs TTS model - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        reference_image: Optional path to reference influencer image for character consistency
    """
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine voice ID: CLI override > gender-based > default
    if voice_id:
        # Use CLI-provided voice ID (overrides gender-based selection)
        print(f"  🎙️ Using CLI-provided voice ID: {voice_id[:20]}...")
    elif influencer_gender:
        # Use gender-based voice ID
        voice_id = ELEVENLABS_VOICE_ID_FEMALE if influencer_gender == "female" else ELEVENLABS_VOICE_ID_MALE
    else:
        # Default to male voice
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    print(f"\n{'='*80}")
    print(f"🎬 POLITICAL VIDEO GENERATOR")
    print(f"{'='*80}")
    print(f"  Input: {input_file}")
    print(f"  Output: {output_path}")
    print(f"  Language: {language_name} ({language_code})")
    if influencer_mode:
        print(f"  Influencer Mode: ENABLED")
        print(f"  Influencer Gender: {influencer_gender or 'male'}")
        print(f"  Voice ID: {voice_id[:20]}...")
    else:
        print(f"  Influencer Mode: OFF")
        print(f"  Voice ID: {voice_id[:20]}...")
    if user_instruction:
        print(f"  User Instruction: {user_instruction[:100]}{'...' if len(user_instruction) > 100 else ''}")
    
    # Create temp directory for intermediate files
    temp_dir = tempfile.mkdtemp(prefix="political_video_")
    print(f"  Temp directory: {temp_dir}")
    
    # Initialize S3 helper for presigned URLs
    s3_helper = S3Helper(project_name="political_video")
    
    # Upload reference image to S3 if provided (for character consistency in influencer clips)
    reference_image_s3_url = None
    if reference_image and influencer_mode:
        print(f"\n{'='*60}")
        print(f"📤 UPLOADING REFERENCE INFLUENCER IMAGE")
        print(f"{'='*60}")
        print(f"  Reference image: {reference_image}")
        
        if os.path.exists(reference_image):
            reference_image_s3_url = s3_helper.upload_file(reference_image, "image", "reference_influencer")
            if reference_image_s3_url:
                print(f"  ✅ Reference image uploaded to S3")
                print(f"  → ALL influencer clips will use nano-banana-pro/edit with this reference")
            else:
                print(f"  ⚠️ Failed to upload reference image - falling back to generated influencer")
        else:
            print(f"  ⚠️ Reference image not found: {reference_image}")
    
    try:
        # Step 1: Extract text from input file
        print(f"\n{'='*60}")
        print(f"📄 STEP 1: TEXT EXTRACTION")
        print(f"{'='*60}")
        
        context_text = extract_text_from_file(input_file)
        if not context_text:
            raise ValueError("Failed to extract text from input file")
        
        # Step 2: Generate video plan with Grok
        print(f"\n{'='*60}")
        print(f"🤖 STEP 2: VIDEO PLAN GENERATION")
        print(f"{'='*60}")
        
        # Pass reference_image_mode=True if CLI reference image was uploaded successfully
        reference_image_mode = reference_image_s3_url is not None
        video_plan = analyze_text_and_generate_plan(context_text, language_code, influencer_mode, influencer_gender, user_instruction, desired_duration, image_group_proportion, voiceover_emotions, reference_image_mode, include_research, research_type)
        
        # Step 3: Generate per-clip voiceovers FIRST (to determine actual clip durations)
        # For influencer mode, we skip voiceover generation for AI_VIDEO clips 
        # (voiceover will be generated after Veo processing)
        print(f"\n{'='*60}")
        print(f"🎙️ STEP 3: PER-CLIP VOICEOVER GENERATION")
        print(f"{'='*60}")
        
        # Collect voiceover texts for non-AI_VIDEO clips (or all clips if not influencer mode)
        clip_voiceover_texts = []
        influencer_clip_voiceovers = {}  # Store voiceover text for influencer clips
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            voiceover = clip.get('voiceover', '')
            
            # Skip clip 0 which is silent
            if voiceover and voiceover.strip() and clip_num > 0:
                if influencer_mode and clip_type == "AI_VIDEO":
                    # For influencer AI clips, store voiceover text for later processing
                    influencer_clip_voiceovers[clip_num] = voiceover
                    print(f"  📝 Clip {clip_num} (AI_VIDEO): Voiceover text stored for post-processing")
                else:
                    clip_voiceover_texts.append({
                        'clip_number': clip_num,
                        'voiceover_text': voiceover
                    })
        
        # Generate voiceovers for non-influencer clips
        voiceover_files = {}  # clip_number -> {path, duration}
        if clip_voiceover_texts:
            voiceover_files = generate_voiceover_per_clip(clip_voiceover_texts, temp_dir, language_code, voice_id, speed, audio_model=audio_model, elevenlabs_direct=elevenlabs_direct)
        
        print(f"\n  ✅ Generated voiceovers for {len(voiceover_files)} non-AI clips")
        if influencer_mode:
            print(f"  📝 {len(influencer_clip_voiceovers)} AI_VIDEO clips will have voice post-processed")
        
        # Step 4: Generate all images
        print(f"\n{'='*60}")
        print(f"🖼️ STEP 4: IMAGE GENERATION")
        print(f"{'='*60}")
        
        clip_data = []  # Store clip info for later processing
        image_clips_for_analysis = []  # SILENT_IMAGE clips for Stage 2 effect analysis (B_ROLL uses Veo3.1)
        
        # Track first influencer image for consistency
        first_influencer_image_s3_url = None
        first_influencer_clip_found = False
        
        # Track generated B_ROLL videos for reuse
        generated_b_roll_videos = {}  # clip_num -> {video_paths: [], video_s3_urls: []}
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            # Convert legacy IMAGE_ONLY to B_ROLL (except for Clip 0 which stays SILENT_IMAGE)
            if clip_type == "IMAGE_ONLY" and clip_num > 0:
                clip_type = "B_ROLL"
                print(f"      📝 Converting IMAGE_ONLY to B_ROLL for clip {clip_num}")
            planned_duration = clip.get('duration_seconds', AI_VIDEO_DEFAULT_DURATION if clip_type == "AI_VIDEO" else 4)
            # For AI_VIDEO clips: use starting_image_prompt for image generation, prompt for video generation
            # For B_ROLL clips: use image_prompt for image generation, video_prompt for video generation
            # For other clips: use prompt for image generation
            starting_image_prompt = clip.get('starting_image_prompt', '')  # For AI_VIDEO clips only
            prompt = clip.get('prompt', '')  # Clip prompt (for video) or image prompt (for legacy IMAGE_ONLY)
            # B_ROLL fields
            image_prompt = clip.get('image_prompt', '')  # For B_ROLL single video
            video_prompt = clip.get('video_prompt', '')  # For B_ROLL single video
            video_group = clip.get('video_group', None)  # Multiple videos for B_ROLL with video groups
            is_reuse = clip.get('is_reuse', False)  # B_ROLL reuse flag
            reuse_from_clip = clip.get('reuse_from_clip', None)  # Which clip to reuse B_ROLL from
            reuse_video_index = clip.get('reuse_video_index', 0)  # Which video in the group to reuse
            # Legacy IMAGE_ONLY fields (for backwards compatibility)
            image_group = clip.get('image_group', None)  # Multiple images for dynamic IMAGE_ONLY clips
            voiceover = clip.get('voiceover', '')
            effect_hint = clip.get('effect_hint', 'Create engaging movement')
            is_influencer_clip = clip.get('is_influencer_clip', False) or (influencer_mode and clip_type == "AI_VIDEO")
            
            # Determine actual duration based on voiceover
            # For AI_VIDEO clips in influencer mode, use planned duration
            # (voiceover timing will be aligned to video later)
            vo_info = voiceover_files.get(clip_num, {})
            vo_duration = vo_info.get('duration', 0)
            
            # Check if this is a video group clip (B_ROLL with multiple videos)
            has_video_group = video_group is not None and len(video_group) > 0 and clip_type == "B_ROLL"
            # Check if this is a legacy image group clip (IMAGE_ONLY with multiple images)
            has_image_group = image_group is not None and len(image_group) > 0 and clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]
            
            if clip_type == "AI_VIDEO" and influencer_mode:
                # AI_VIDEO in influencer mode uses fixed duration
                actual_duration = planned_duration
            elif (has_video_group or has_image_group) and vo_duration > 0:
                # VIDEO GROUP / IMAGE GROUP CLIPS: Use voiceover duration (+ small buffer) for spacing
                # This ensures videos/images transition WITH the voiceover, not extending beyond it
                actual_duration = vo_duration + 0.3  # Small buffer for natural feel
                group_type = "Video Group" if has_video_group else "Image Group"
                print(f"      📦 {group_type}: Using voiceover duration ({vo_duration:.2f}s + 0.3s buffer = {actual_duration:.2f}s) instead of planned ({planned_duration}s)")
            elif vo_duration > 0:
                # Regular clips: Add 0.5s buffer after voiceover ends
                actual_duration = max(planned_duration, vo_duration + 0.5)
            else:
                actual_duration = planned_duration
            
            # Build clip type label
            type_suffix = ""
            if is_influencer_clip:
                type_suffix = "*INFLUENCER*"
            elif has_video_group:
                type_suffix = "*VIDEO_GROUP*"
            elif has_image_group:
                type_suffix = "*IMAGE_GROUP*"
            elif is_reuse:
                type_suffix = "*REUSE*"
            
            print(f"\n  --- Clip {clip_num} ({clip_type}{type_suffix}) ---")
            print(f"      Planned: {planned_duration}s, Voiceover: {vo_duration:.2f}s, Actual: {actual_duration:.2f}s")
            if has_video_group:
                print(f"      🎬 Video Group: {len(video_group)} videos")
            elif has_image_group:
                print(f"      📦 Image Group: {len(image_group)} images")
            elif is_reuse:
                print(f"      ♻️ Reusing B_ROLL from Clip {reuse_from_clip}, video index {reuse_video_index}")
            
            # Generate image(s) for the clip
            # For B_ROLL with video_group: generate multiple images for video generation
            # For B_ROLL single: generate one image for video generation
            # For legacy image groups: generate multiple images
            # For regular clips: generate single image
            
            image_group_paths = []  # Store all image paths for image groups (legacy)
            video_group_data = []  # Store {image_path, image_s3_url, video_prompt, rank} for B_ROLL video groups
            
            # Handle B_ROLL reuse - skip image generation
            if clip_type == "B_ROLL" and is_reuse:
                print(f"      ♻️ B_ROLL reuse: Will use video from Clip {reuse_from_clip}")
                image_path = None
                image_result = None
            # Handle B_ROLL with video group
            elif has_video_group:
                print(f"      🎬 Generating {len(video_group)} images for video group B_ROLL...")
                for vid_idx, vid_item in enumerate(video_group):
                    vid_image_prompt = vid_item.get('image_prompt', '')
                    vid_video_prompt = vid_item.get('video_prompt', '')
                    vid_rank = vid_item.get('rank', vid_idx + 1)
                    
                    if not vid_image_prompt:
                        print(f"      ⚠️ Video {vid_idx+1}: No image_prompt found, skipping")
                        continue
                    
                    img_path = os.path.join(temp_dir, f"clip_{clip_num}_vid_{vid_idx}.png")
                    print(f"      📷 Video {vid_idx+1}/{len(video_group)}: Generating starting frame...")
                    
                    # Generate image (B_ROLL starting frames need "no text overlays")
                    img_result = generate_image_with_nano_banana(vid_image_prompt, img_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                    
                    if img_result and os.path.exists(img_result):
                        # Upload to S3 for Veo3.1
                        img_s3_url = s3_helper.upload_file(img_result, "image", f"clip_{clip_num}_vid_{vid_idx}")
                        video_group_data.append({
                            'image_path': img_result,
                            'image_s3_url': img_s3_url,
                            'video_prompt': vid_video_prompt,
                            'rank': vid_rank
                        })
                        print(f"      ✅ Video {vid_idx+1}: Starting frame generated")
                    else:
                        print(f"      ⚠️ Video {vid_idx+1}: Generation failed")
                
                # Sort by rank for proper ordering
                video_group_data.sort(key=lambda x: x.get('rank', 99))
                
                # Use first image as the main image for this clip
                if video_group_data:
                    image_path = video_group_data[0]['image_path']
                    image_result = video_group_data[0]['image_path']
                    print(f"      ✅ Video group: {len(video_group_data)} starting frames generated")
                else:
                    print(f"      ⚠️ All video group images failed")
                    image_path = None
                    image_result = None
            # Handle B_ROLL with single video
            elif clip_type == "B_ROLL" and image_prompt:
                print(f"      🎬 Generating starting frame for single B_ROLL...")
                image_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.png")
                # B_ROLL starting frames need "no text overlays"
                image_result = generate_image_with_nano_banana(image_prompt, image_path, aspect_ratio="9:16", is_starting_frame=True, clip_num=clip_num)
                if image_result:
                    print(f"      ✅ B_ROLL starting frame generated")
            # Handle legacy image groups
            elif has_image_group:
                # IMAGE GROUP: Generate multiple images
                print(f"      📦 Generating {len(image_group)} images for image group...")
                for img_idx, img_item in enumerate(image_group):
                    img_prompt = img_item.get('prompt', '')
                    if not img_prompt:
                        print(f"      ⚠️ Image {img_idx+1}: No prompt found, skipping")
                        continue
                    
                    img_path = os.path.join(temp_dir, f"clip_{clip_num}_img_{img_idx}.png")
                    print(f"      📷 Image {img_idx+1}/{len(image_group)}: Generating...")
                    
                    # Generate image (legacy IMAGE_ONLY clips, so is_starting_frame=False)
                    img_result = generate_image_with_nano_banana(img_prompt, img_path, aspect_ratio="9:16", is_starting_frame=False, clip_num=clip_num)
                    
                    if img_result and os.path.exists(img_result):
                        image_group_paths.append(img_result)
                        print(f"      ✅ Image {img_idx+1}: Generated successfully")
                    else:
                        print(f"      ⚠️ Image {img_idx+1}: Generation failed")
                
                # Use first image as the main image for this clip
                if image_group_paths:
                    image_path = image_group_paths[0]
                    image_result = image_group_paths[0]
                    print(f"      ✅ Image group: {len(image_group_paths)} images generated successfully")
                else:
                    # Fallback to single prompt if all image group images failed
                    print(f"      ⚠️ All image group images failed, falling back to single prompt")
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                    image_result = generate_image_with_nano_banana(prompt, image_path, aspect_ratio="9:16", is_starting_frame=False, clip_num=clip_num)
                    image_group_paths = [image_result] if image_result else []
            else:
                # SINGLE IMAGE: Original logic
                if clip_type == "AI_VIDEO":
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}_start.png")
                else:
                    image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                
                # For influencer mode AI_VIDEO clips (except first), use edit model with reference
                # All clips use 9:16 aspect ratio
                # CRITICAL: Only starting frame images (AI_VIDEO clips) need "no text overlays"
                # Regular images (IMAGE_ONLY/SILENT_IMAGE clips) allow text overlays
                is_starting_frame = (clip_type == "AI_VIDEO")
                
                # CRITICAL: For AI_VIDEO clips, use starting_image_prompt for image generation (no voiceover instructions)
                # For other clips, use prompt for image generation
                # If starting_image_prompt is missing for AI_VIDEO, fallback to prompt (but warn)
                if clip_type == "AI_VIDEO":
                    if starting_image_prompt:
                        image_prompt_to_use = starting_image_prompt
                    else:
                        print(f"      ⚠️ WARNING: No starting_image_prompt found for AI_VIDEO clip {clip_num}, using prompt field (may contain voiceover instructions)")
                        image_prompt_to_use = prompt
                else:
                    image_prompt_to_use = prompt
                
                if is_influencer_clip:
                    # Priority for reference image:
                    # 1. CLI-provided reference_image_s3_url (if provided, ALL influencer clips use this)
                    # 2. First generated influencer image (for subsequent clips only)
                    # 3. Generate fresh image with nano-banana-pro (for first clip if no CLI reference)
                    
                    if reference_image_s3_url:
                        # CLI reference image provided - use nano-banana-pro/edit for ALL influencer clips
                        print(f"      Using nano-banana-pro/edit with CLI reference influencer (9:16 aspect ratio)")
                        if clip_type == "AI_VIDEO" and starting_image_prompt:
                            print(f"      Using starting_image_prompt for image generation (no voiceover instructions)")
                        image_result = generate_image_with_nano_banana_edit(
                            image_prompt_to_use, 
                            image_path, 
                            [reference_image_s3_url],
                            aspect_ratio="9:16",
                            is_starting_frame=is_starting_frame,
                            clip_num=clip_num
                        )
                    elif first_influencer_clip_found and first_influencer_image_s3_url:
                        # No CLI reference, but have first generated influencer - use as reference for subsequent clips
                        print(f"      Using nano-banana-pro/edit with generated reference influencer (9:16 aspect ratio)")
                        if clip_type == "AI_VIDEO" and starting_image_prompt:
                            print(f"      Using starting_image_prompt for image generation (no voiceover instructions)")
                        image_result = generate_image_with_nano_banana_edit(
                            image_prompt_to_use, 
                            image_path, 
                            [first_influencer_image_s3_url],
                            aspect_ratio="9:16",
                            is_starting_frame=is_starting_frame,
                            clip_num=clip_num
                        )
                    else:
                        # No CLI reference, first influencer clip - generate fresh with nano-banana-pro
                        print(f"      Using nano-banana-pro for first influencer clip (9:16 aspect ratio)")
                        if clip_type == "AI_VIDEO" and starting_image_prompt:
                            print(f"      Using starting_image_prompt for image generation (no voiceover instructions)")
                        image_result = generate_image_with_nano_banana(image_prompt_to_use, image_path, aspect_ratio="9:16", is_starting_frame=is_starting_frame, clip_num=clip_num)
                else:
                    # Image-based clips: use 9:16 aspect ratio (text overlays allowed for IMAGE_ONLY, required for Clip 0)
                    image_result = generate_image_with_nano_banana(image_prompt_to_use, image_path, aspect_ratio="9:16", is_starting_frame=is_starting_frame, clip_num=clip_num)
            
            # Upload image to S3 for presigned URL (needed for veo3.1)
            image_s3_url = None
            if image_result:
                image_s3_url = s3_helper.upload_file(image_result, "image", f"clip_{clip_num}")
                if not image_s3_url:
                    print(f"      ⚠️ Failed to upload image to S3, using base64 fallback")
            
            # Track first influencer image for subsequent clips
            if is_influencer_clip and not first_influencer_clip_found and image_s3_url:
                first_influencer_image_s3_url = image_s3_url
                first_influencer_clip_found = True
                print(f"      📸 First influencer image saved as reference")
            
            clip_info = {
                'clip_number': clip_num,
                'clip_type': clip_type,
                'planned_duration': planned_duration,
                'actual_duration': actual_duration,
                'prompt': prompt,  # Clip prompt (for video generation) or image prompt (for legacy IMAGE_ONLY)
                'starting_image_prompt': starting_image_prompt,  # Starting frame image prompt (for AI_VIDEO clips only)
                'voiceover': voiceover,
                'effect_hint': effect_hint,
                'image_path': image_result,
                'image_s3_url': image_s3_url,
                'is_influencer_clip': is_influencer_clip,
                # Include failover fields for AI_VIDEO influencer clips
                'failover_image_prompt': clip.get('failover_image_prompt', ''),
                'failover_effect_hint': clip.get('failover_effect_hint', ''),
                # Legacy image group support
                'has_image_group': has_image_group,
                'image_group_paths': image_group_paths if has_image_group else [],
                # B_ROLL support
                'is_b_roll': clip_type == "B_ROLL",
                'video_prompt': video_prompt,  # For single B_ROLL
                'has_video_group': has_video_group,
                'video_group_data': video_group_data if has_video_group else [],  # For B_ROLL with video groups
                'is_reuse': is_reuse,
                'reuse_from_clip': reuse_from_clip,
                'reuse_video_index': reuse_video_index
            }
            clip_data.append(clip_info)
            
            # NOTE: Clip 0 (SILENT_IMAGE) should NOT have effects - it's a static image with text overlay
            # B_ROLL clips don't need effect analysis - they use Veo3.1 for motion
            # So we skip effect analysis entirely when only clip 0 is image-based
            # Only legacy IMAGE_ONLY clips (if any) would need effect analysis
            if clip_type == "IMAGE_ONLY" and image_result and clip_num > 0:
                image_clips_for_analysis.append({
                    'clip_number': clip_num,
                    'image_path': image_result,
                    'duration': actual_duration,
                    'effect_hint': effect_hint,
                    'voiceover': voiceover,
                    'is_image_group': has_image_group
                })
        
        # Step 4.5: Analyze images with Grok for precise effects (Stage 2)
        print(f"\n{'='*60}")
        print(f"🎨 STEP 4.5: IMAGE ANALYSIS FOR EFFECTS (Stage 2)")
        print(f"{'='*60}")
        
        clip_effects = {}
        if image_clips_for_analysis:
            clip_effects = analyze_images_for_effects(image_clips_for_analysis)
            print(f"\n  ✅ Got effects for {len(clip_effects)} clips from image analysis")
        else:
            print(f"  ⚠️ No SILENT_IMAGE clips to analyze (B_ROLL clips use Veo3.1 for motion)")
        
        # Step 5: Create video clips with adjusted durations
        print(f"\n{'='*60}")
        print(f"🎬 STEP 5: VIDEO CLIP CREATION (Duration matched to voiceover)")
        print(f"{'='*60}")
        
        clip_paths = []
        raw_clip_paths = {}  # Store pre-caption video paths for raw asset saving
        actual_clip_durations = {}  # Store actual durations for stitching
        all_transcription_data = {}  # Collect transcription data for saving
        
        for clip_info in clip_data:
            clip_num = clip_info['clip_number']
            clip_type = clip_info['clip_type']
            duration = clip_info['actual_duration']  # Use actual duration (adjusted for voiceover)
            prompt = clip_info['prompt']
            image_path = clip_info['image_path']
            image_s3_url = clip_info.get('image_s3_url')
            is_influencer_clip = clip_info.get('is_influencer_clip', False)
            voiceover_text = clip_info.get('voiceover', '')
            
            actual_clip_durations[clip_num] = duration
            
            print(f"\n  --- Creating video for Clip {clip_num} ({clip_type}{'*INFLUENCER*' if is_influencer_clip else ''}, {duration:.2f}s) ---")
            
            # Check if this is a B_ROLL reuse clip (doesn't need image_path)
            is_b_roll_reuse = clip_info.get('is_b_roll', False) and clip_info.get('is_reuse', False)
            
            if not image_path and not is_b_roll_reuse:
                print(f"  ⚠️ Skipping clip {clip_num} - no image generated")
                clip_paths.append(None)
                continue
            
            if clip_type == "AI_VIDEO":
                # For AI video, use S3 presigned URL if available, otherwise base64
                if not image_s3_url:
                    print(f"  ⚠️ No S3 URL for starting image, creating base64 data URL")
                    import base64
                    with open(image_path, 'rb') as f:
                        image_data = base64.b64encode(f.read()).decode('utf-8')
                    ext = image_path.lower().split('.')[-1]
                    mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png'}
                    mime_type = mime_types.get(ext, 'image/png')
                    image_s3_url = f"data:{mime_type};base64,{image_data}"
                
                # Determine if we need audio for this clip (influencer mode)
                generate_audio = is_influencer_clip and influencer_mode
                
                # Generate AI video
                # Veo3.1 only supports 4s, 6s, or 8s
                # For influencer clips: don't extend by looping - must be exactly 6s or 8s
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                
                # For influencer clips: NO RETRIES - if duration exceeds 8 seconds, immediately failover
                # For non-influencer clips: single attempt
                video_result = None
                video_duration = None
                ai_video_failed = False
                
                # For influencer clips, don't extend by looping - use exact veo duration
                target_duration_for_generation = None if (is_influencer_clip and influencer_mode) else duration
                
                # Use selected AI video model
                if ai_video_model == "omnihuman1.5":
                    # OmniHuman 1.5: Generate voiceover first, then lip-sync with image
                    print(f"  🎬 Using OmniHuman 1.5 for AI video generation (lip-sync)...")
                    
                    # Step 1: Generate voiceover for this clip
                    voiceover_path = os.path.join(temp_dir, f"omnihuman_vo_clip_{clip_num}.mp3")
                    vo_result, vo_duration = generate_voiceover(
                        voiceover_text if voiceover_text else "",
                        voiceover_path,
                        language_code,
                        voice_id,
                        speed,
                        audio_model=audio_model,
                        elevenlabs_direct=elevenlabs_direct
                    )
                    
                    if vo_result:
                        # Step 2: Upload voiceover to S3
                        vo_s3_url = s3_helper.upload_file(vo_result, "voiceover", f"omnihuman_clip_{clip_num}")
                        
                        if vo_s3_url:
                            # Step 3: Generate video with OmniHuman (lip-sync image + audio)
                            video_result = generate_ai_video_clip_omnihuman(
                                image_url=image_s3_url,
                                audio_url=vo_s3_url,
                                output_path=video_path,
                                resolution="720p"
                            )
                            
                            # For OmniHuman, mark voiceover as embedded since it's lip-synced
                            if video_result:
                                voiceover_files[clip_num] = {
                                    'path': vo_result,
                                    'duration': vo_duration,
                                    'embedded': True  # Audio is already in the video
                                }
                        else:
                            print(f"  ❌ Failed to upload voiceover to S3 for OmniHuman")
                    else:
                        print(f"  ❌ Failed to generate voiceover for OmniHuman clip")
                        
                elif ai_video_model == "seedance1.5":
                    print(f"  🎬 Using Seedance v1.5 Pro for AI video generation...")
                    video_result = generate_ai_video_clip_seedance(
                        prompt=prompt,
                        starting_image_url=image_s3_url,
                        output_path=video_path,
                        duration=duration,  # Desired duration (will be rounded to 4/6/8)
                        generate_audio=generate_audio,
                        target_duration=target_duration_for_generation,  # None for influencer clips (no extension)
                        language_code=language_code,
                        language_name=language_name
                    )
                else:  # Default to veo3.1
                    print(f"  🎬 Using Veo3.1 for AI video generation...")
                    video_result = generate_ai_video_clip(
                        prompt=prompt,
                        starting_image_url=image_s3_url,
                        output_path=video_path,
                        duration=duration,  # Desired duration (will be rounded to 4/6/8)
                        generate_audio=generate_audio,
                        target_duration=target_duration_for_generation,  # None for influencer clips (no extension)
                        language_code=language_code,
                        language_name=language_name
                    )
                
                # Check if API call failed (video_result is None)
                if not video_result and is_influencer_clip and influencer_mode:
                    model_names = {"seedance1.5": "Seedance v1.5 Pro", "omnihuman1.5": "OmniHuman 1.5", "veo3.1": "Veo3.1"}
                    model_name = model_names.get(ai_video_model, "AI Video")
                    print(f"  ❌ AI video generation failed at {model_name} API level for influencer clip {clip_num}")
                    ai_video_failed = True
                
                if video_result and os.path.exists(video_result):
                    # Check duration for influencer clips
                    if is_influencer_clip and influencer_mode:
                        try:
                            test_clip = VideoFileClip(video_result)
                            video_duration = test_clip.duration
                            test_clip.close()
                            
                            # Check duration: if > 8 seconds, transcribe and check language
                            # Even clips in 9.5-10.5s range can be accepted if they're English and CLI language is English
                            if video_duration > 8.0:
                                # Video is > 8 seconds but not in corrupted range - check language via transcription
                                print(f"  ⚠️ Clip {clip_num} duration ({video_duration:.2f}s) exceeds 8 seconds limit")
                                print(f"  🔍 Transcribing audio to check language...")
                                
                                # Extract audio and transcribe
                                try:
                                    audio_path = os.path.join(temp_dir, f"clip_{clip_num}_lang_check.wav")
                                    extracted_audio = extract_audio_from_video(video_result, audio_path)
                                    
                                    if extracted_audio:
                                        transcript_text, _ = get_word_timestamps_whisper(extracted_audio)
                                        
                                        # Clean up temp audio
                                        if os.path.exists(audio_path):
                                            os.remove(audio_path)
                                        
                                        if transcript_text:
                                            is_english = is_text_english(transcript_text)
                                            print(f"  📄 Transcribed text: \"{transcript_text[:100]}{'...' if len(transcript_text) > 100 else ''}\"")
                                            print(f"  🌐 Detected language: {'English' if is_english else 'Non-English'}")
                                            
                                            # Decision logic:
                                            # - If English AND CLI language is English: ACCEPT
                                            # - If English BUT CLI language is NOT English: REJECT
                                            # - If NOT English: REJECT
                                            if is_english and language_code == "en":
                                                print(f"  ✅ Clip is English and CLI language is English - ACCEPTING clip despite duration > 8s")
                                                # Accept the clip - don't set ai_video_failed
                                                # Continue to trimming step below
                                            elif is_english and language_code != "en":
                                                print(f"  ❌ Clip is English but CLI language is {language_code} - REJECTING clip")
                                                ai_video_failed = True
                                                if os.path.exists(video_result):
                                                    os.remove(video_result)
                                                video_result = None
                                            else:
                                                print(f"  ❌ Clip is not English - REJECTING clip")
                                                ai_video_failed = True
                                                if os.path.exists(video_result):
                                                    os.remove(video_result)
                                                video_result = None
                                        else:
                                            print(f"  ⚠️ Transcription failed - REJECTING clip (no transcript)")
                                            ai_video_failed = True
                                            if os.path.exists(video_result):
                                                os.remove(video_result)
                                            video_result = None
                                    else:
                                        print(f"  ⚠️ Audio extraction failed - REJECTING clip (no audio)")
                                        ai_video_failed = True
                                        if os.path.exists(video_result):
                                            os.remove(video_result)
                                        video_result = None
                                except Exception as e:
                                    print(f"  ⚠️ Language check failed: {e} - REJECTING clip")
                                    import traceback
                                    print(traceback.format_exc())
                                    ai_video_failed = True
                                    if os.path.exists(video_result):
                                        os.remove(video_result)
                                    video_result = None
                            else:
                                print(f"  ✅ Clip {clip_num} duration ({video_duration:.2f}s) is within limit (≤8s)")
                            
                            # Apply speech-end trimming to remove awkward gestures after speech ends
                            # This applies to both clips ≤8s and clips >8s that were accepted (English + CLI language English)
                            # SKIPPED: Trimming is currently disabled
                            if False and video_result and not ai_video_failed:  # Disabled: set to True to enable trimming
                                print(f"  ✂️ Applying speech-end trimming to remove awkward silence...")
                                trimmed_result = trim_influencer_clip_at_speech_end(video_result, min_search_time=5.0, buffer_ms=300)
                                if trimmed_result and trimmed_result != video_result:
                                    video_result = trimmed_result
                                    # Update duration after trimming
                                    try:
                                        test_clip = VideoFileClip(video_result)
                                        video_duration = test_clip.duration
                                        test_clip.close()
                                        # CRITICAL: Update actual_clip_durations to reflect trimmed duration
                                        # This ensures subsequent clips start at correct times
                                        actual_clip_durations[clip_num] = video_duration
                                        print(f"  ✅ Clip trimmed to {video_duration:.2f}s (updated actual_clip_durations)")
                                    except Exception as e:
                                        print(f"  ⚠️ Failed to update duration after trimming: {e}")
                                        pass
                        except Exception as e:
                            print(f"  ⚠️ Failed to check duration: {e}, proceeding with clip")
                else:
                    # Video generation failed (video_result is None or file doesn't exist)
                    if not video_result:
                        print(f"  ❌ Video generation failed at Veo3.1 API level for clip {clip_num}")
                    else:
                        print(f"  ⚠️ Video generation failed for clip {clip_num} (file not found)")
                    if is_influencer_clip and influencer_mode:
                        ai_video_failed = True
                
                # FAILOVER: If AI video failed after 2 retries, switch to IMAGE_ONLY using failover prompt
                if ai_video_failed and is_influencer_clip and influencer_mode:
                    failover_prompt = clip_info.get('failover_image_prompt', '')
                    failover_effect_hint = clip_info.get('failover_effect_hint', 'Create engaging movement')
                    
                    if failover_prompt:
                        print(f"\n  🔄 FAILOVER: Switching to IMAGE_ONLY mode for clip {clip_num}")
                        print(f"     Using failover image prompt (without influencer)")
                        
                        # Generate image with failover prompt (image-based clip, so use 9:16)
                        failover_image_path = os.path.join(temp_dir, f"clip_{clip_num}.png")
                        failover_image_result = generate_image_with_nano_banana(failover_prompt, failover_image_path, aspect_ratio="9:16")
                        
                        if failover_image_result:
                            # Update clip_info to reflect IMAGE_ONLY mode
                            clip_info['clip_type'] = 'IMAGE_ONLY'
                            clip_info['image_path'] = failover_image_result
                            clip_info['effect_hint'] = failover_effect_hint
                            clip_info['is_influencer_clip'] = False  # No longer an influencer clip
                            
                            # Update local variables for IMAGE_ONLY processing
                            clip_type = 'IMAGE_ONLY'  # Change clip_type so it goes to IMAGE_ONLY section
                            image_path = failover_image_result
                            effect_hint = failover_effect_hint
                            
                            # Generate voiceover for this clip (same text, but now as IMAGE_ONLY)
                            if voiceover_text:
                                vo_info = generate_voiceover(
                                    voiceover_text,
                                    os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3"),
                                    language_code,
                                    voice_id,
                                    speed,
                                    audio_model=audio_model,
                                    elevenlabs_direct=elevenlabs_direct
                                )
                                if vo_info[0]:
                                    vo_duration = vo_info[1]
                                    voiceover_files[clip_num] = {
                                        'path': vo_info[0],
                                        'duration': vo_duration,
                                        'embedded': False
                                    }
                                    # CRITICAL: Update duration to match voiceover duration
                                    # This ensures the image clip is created with the correct duration
                                    duration = vo_duration
                                    clip_info['actual_duration'] = vo_duration
                                    
                                    # CRITICAL: Update actual_clip_durations to match voiceover duration
                                    # This ensures subsequent clips start at correct times
                                    actual_clip_durations[clip_num] = vo_duration
                                    print(f"  ✅ Updated duration to {vo_duration:.2f}s (voiceover duration) for failover clip {clip_num}")
                            
                            # Note: video_result is None, so we'll skip appending and go to IMAGE_ONLY section
                        else:
                            print(f"  ❌ Failover image generation also failed for clip {clip_num}")
                            clip_paths.append(None)
                            continue
                    else:
                        print(f"  ❌ No failover prompt available for clip {clip_num}. Skipping clip.")
                        clip_paths.append(None)
                        continue
                
                # For influencer clips, keep original Veo audio (no voice replacement)
                # The Veo-generated audio is already embedded in the video
                if video_result and is_influencer_clip and influencer_mode and not ai_video_failed:
                    # For influencer clips, the voiceover is embedded in video (Veo audio)
                    # Add to voiceover_files with duration for music timing
                    # Use the actual duration (which may have been trimmed)
                    actual_duration = actual_clip_durations.get(clip_num, duration)
                    vo_clip = VideoFileClip(video_result)
                    # Use the actual clip duration (after trimming if applicable)
                    vo_clip_duration = vo_clip.duration
                    vo_clip.close()
                    voiceover_files[clip_num] = {
                        'path': None,  # No separate voiceover file - embedded in video
                        'duration': vo_clip_duration,  # Use actual trimmed duration
                        'embedded': True
                    }
                    print(f"  ✅ Influencer clip {clip_num}: Using original Veo audio (embedded, duration: {vo_clip_duration:.2f}s)")
                    
                    # Wait 5 seconds before generating next influencer clip to avoid issues
                    print(f"  ⏳ Waiting 5 seconds before next influencer clip generation...")
                    time.sleep(5)
                
                # Note: generate_ai_video_clip already handles duration extension by looping
                # if target_duration > veo supported duration (4/6/8s)
                
                # Only append video_result if we have one (not failed to failover)
                if video_result and not ai_video_failed:
                    # IMPORTANT: Save raw (pre-caption) path for raw asset saving
                    raw_clip_paths[clip_num] = video_result
                    
                    # Apply captions if requested
                    if captions and video_result:
                        print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                        # For AI_VIDEO clips, audio is embedded in video, so no separate audio_path needed
                        language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                        caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=None, transliterate=transliterate, language_name=language_name)
                        # Handle tuple return (path, transcription_data)
                        captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                        if transcription_info:
                            all_transcription_data[clip_num] = transcription_info
                        if captioned_path and captioned_path != video_result:
                            # Keep raw file for asset saving, use captioned for final video
                            video_result = captioned_path
                    clip_paths.append(video_result)
                elif ai_video_failed:
                    # Failover handled above - clip_type was changed to IMAGE_ONLY
                    # Continue to IMAGE_ONLY section below
                    pass
                else:
                    clip_paths.append(None)
            
            # Handle B_ROLL clips (dynamic AI-generated video clips)
            is_b_roll_clip = clip_info.get('is_b_roll', False) and clip_type == "B_ROLL"
            
            if is_b_roll_clip:
                video_path = os.path.join(temp_dir, f"clip_{clip_num}_broll.mp4")
                video_result = None
                
                # Check if this is a reused B_ROLL
                if clip_info.get('is_reuse', False):
                    reuse_from = clip_info.get('reuse_from_clip')
                    reuse_idx = clip_info.get('reuse_video_index', 0)
                    
                    print(f"  ♻️ Reusing B_ROLL from Clip {reuse_from}, video index {reuse_idx}...")
                    
                    if reuse_from in generated_b_roll_videos:
                        reuse_data = generated_b_roll_videos[reuse_from]
                        reuse_video_paths = reuse_data.get('video_paths', [])
                        
                        if reuse_idx < len(reuse_video_paths):
                            source_video = reuse_video_paths[reuse_idx]
                            if source_video and os.path.exists(source_video):
                                # Copy the video for this clip (may need to trim to different duration)
                                import shutil
                                shutil.copy(source_video, video_path)
                                video_result = video_path
                                print(f"  ✅ B_ROLL reused from Clip {reuse_from}")
                            else:
                                print(f"  ⚠️ Source video not found: {source_video}")
                        else:
                            print(f"  ⚠️ Video index {reuse_idx} out of range for Clip {reuse_from}")
                    else:
                        print(f"  ⚠️ Clip {reuse_from} not found in generated B_ROLL videos")
                
                # Check if this is a video group B_ROLL
                elif clip_info.get('has_video_group', False):
                    video_group_data = clip_info.get('video_group_data', [])
                    
                    print(f"  🎬 Generating B_ROLL video group ({len(video_group_data)} videos)...")
                    
                    individual_video_paths = []
                    
                    for vid_idx, vid_data in enumerate(video_group_data):
                        vid_image_s3_url = vid_data.get('image_s3_url')
                        vid_video_prompt = vid_data.get('video_prompt', '')
                        
                        if not vid_image_s3_url:
                            print(f"      ⚠️ Video {vid_idx+1}: No S3 URL for starting image")
                            continue
                        
                        individual_path = os.path.join(temp_dir, f"clip_{clip_num}_vid_{vid_idx}.mp4")
                        print(f"      🎬 Video {vid_idx+1}/{len(video_group_data)}: Generating with Veo3.1...")
                        
                        vid_result = generate_b_roll_video(
                            image_url=vid_image_s3_url,
                            video_prompt=vid_video_prompt,
                            output_path=individual_path,
                            duration=4  # Always 4s for B_ROLL
                        )
                        
                        if vid_result and os.path.exists(vid_result):
                            individual_video_paths.append(vid_result)
                            print(f"      ✅ Video {vid_idx+1}: Generated successfully")
                        else:
                            print(f"      ⚠️ Video {vid_idx+1}: Generation failed")
                    
                    # Store for potential reuse
                    generated_b_roll_videos[clip_num] = {
                        'video_paths': individual_video_paths,
                        'is_video_group': True
                    }
                    
                    # Assemble video group with equal spacing (trimmed to voiceover duration)
                    if individual_video_paths:
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', duration)
                        target_duration = vo_duration if vo_duration > 0 else duration
                        
                        video_result = create_video_from_b_roll_group(
                            video_paths=individual_video_paths,
                            output_path=video_path,
                            duration=target_duration,
                            temp_dir=temp_dir
                        )
                        print(f"  ✅ B_ROLL video group assembled: {target_duration:.2f}s")
                    else:
                        print(f"  ⚠️ No videos in group to assemble")
                
                # Single B_ROLL video
                else:
                    image_s3_url = clip_info.get('image_s3_url')
                    vid_prompt = clip_info.get('video_prompt', '')
                    
                    if image_s3_url and vid_prompt:
                        print(f"  🎬 Generating single B_ROLL with Veo3.1...")
                        
                        video_result = generate_b_roll_video(
                            image_url=image_s3_url,
                            video_prompt=vid_prompt,
                            output_path=video_path,
                            duration=4  # Always 4s for B_ROLL
                        )
                        
                        if video_result:
                            # Store for potential reuse
                            generated_b_roll_videos[clip_num] = {
                                'video_paths': [video_result],
                                'is_video_group': False
                            }
                            print(f"  ✅ B_ROLL video generated")
                    else:
                        print(f"  ⚠️ Missing image_s3_url or video_prompt for B_ROLL clip {clip_num}")
                
                # Update actual clip duration
                if video_result and os.path.exists(video_result):
                    try:
                        test_clip = VideoFileClip(video_result)
                        actual_video_duration = test_clip.duration
                        test_clip.close()
                        
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', 0)
                        final_duration = max(actual_video_duration, vo_duration) if vo_duration > 0 else actual_video_duration
                        actual_clip_durations[clip_num] = final_duration
                        print(f"  ✅ B_ROLL clip duration: {final_duration:.2f}s")
                    except Exception as e:
                        print(f"  ⚠️ Failed to get B_ROLL clip duration: {e}")
                        actual_clip_durations[clip_num] = duration
                    
                    raw_clip_paths[clip_num] = video_result
                
                # Apply captions if requested
                if captions and video_result:
                    print(f"  📝 Applying captions ({captions}) to B_ROLL clip {clip_num}...")
                    audio_path = None
                    if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                        audio_path = voiceover_files[clip_num].get('path')
                    
                    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                    caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=audio_path, transliterate=transliterate, language_name=language_name)
                    captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                    if transcription_info:
                        all_transcription_data[clip_num] = transcription_info
                    if captioned_path and captioned_path != video_result:
                        video_result = captioned_path
                
                clip_paths.append(video_result)
            
            # Handle SILENT_IMAGE clips (Clip 0 only - static image with text overlay)
            elif clip_type == "SILENT_IMAGE":
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                
                # For Clip 0 (SILENT_IMAGE), always use static (no effects) to preserve text visibility
                print(f"  📌 Clip 0 (SILENT_IMAGE): Using static image (no effects) to preserve text visibility")
                effects = []
                
                # SINGLE IMAGE: Create video from static image
                video_result = create_video_from_image_with_effects(
                    image_path=image_path,
                    output_path=video_path,
                    duration=duration,
                    effects=effects
                )
                
                if video_result and os.path.exists(video_result):
                    actual_clip_durations[clip_num] = duration
                    raw_clip_paths[clip_num] = video_result
                
                clip_paths.append(video_result)
            
            # Handle legacy IMAGE_ONLY clips (including failover cases)
            # Check if this is an IMAGE_ONLY clip (original or failover)
            is_image_only_clip = clip_type == "IMAGE_ONLY"
            
            if is_image_only_clip:
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                
                # Check if this is an image group clip
                clip_has_image_group = clip_info.get('has_image_group', False)
                image_group_paths = clip_info.get('image_group_paths', [])
                
                # Use effects from Stage 2 image analysis, or default if not available
                effects = clip_effects.get(clip_num, [])
                if not effects:
                    print(f"  ⚠️ No effects from image analysis for clip {clip_num}, using defaults")
                    effects = get_default_effects(duration, clip_num)
                else:
                    print(f"  ✅ Using {len(effects)} effects from image analysis")
                    # Update effect durations to match actual clip duration
                    for effect in effects:
                        if effect.get('duration', 0) > duration:
                            effect['duration'] = duration
                        # If effect spans full clip, update to actual duration
                        if effect.get('start_time', 0) == 0 and effect.get('duration', duration) >= clip_info['planned_duration']:
                            effect['duration'] = duration
                
                # IMAGE GROUP: Create video from multiple images with rapid transitions
                if clip_has_image_group and len(image_group_paths) > 1:
                    print(f"  📦 Creating video from image group ({len(image_group_paths)} images)...")
                    # For image groups: effects apply only to FIRST image, others are displayed as-is
                    video_result = create_video_from_image_group(
                        image_paths=image_group_paths,
                        output_path=video_path,
                        duration=duration,
                        first_image_effects=effects,  # Effects apply only to first image
                        temp_dir=temp_dir
                    )
                else:
                    # SINGLE IMAGE: Original logic
                    video_result = create_video_from_image_with_effects(
                        image_path=image_path,
                        output_path=video_path,
                        duration=duration,
                        effects=effects
                    )
                
                # CRITICAL: For IMAGE_ONLY clips (including failover), update actual_clip_durations
                # to match the actual video duration or voiceover duration (whichever is longer)
                if video_result and os.path.exists(video_result):
                    try:
                        test_clip = VideoFileClip(video_result)
                        actual_video_duration = test_clip.duration
                        test_clip.close()
                        
                        # Check if there's a voiceover for this clip
                        vo_duration = voiceover_files.get(clip_num, {}).get('duration', 0)
                        
                        # Use the longer of: actual video duration or voiceover duration
                        # This ensures the clip duration matches the voiceover (if present)
                        final_duration = max(actual_video_duration, vo_duration) if vo_duration > 0 else actual_video_duration
                        
                        # Update actual_clip_durations to ensure correct timing for subsequent clips
                        actual_clip_durations[clip_num] = final_duration
                        
                        if vo_duration > 0 and final_duration != actual_video_duration:
                            print(f"  ✅ Updated actual_clip_durations[{clip_num}] to {final_duration:.2f}s (voiceover duration, video was {actual_video_duration:.2f}s)")
                        elif final_duration != duration:
                            print(f"  ✅ Updated actual_clip_durations[{clip_num}] to {final_duration:.2f}s (actual video duration, planned was {duration:.2f}s)")
                    except Exception as e:
                        print(f"  ⚠️ Failed to update actual_clip_durations for clip {clip_num}: {e}")
                        # Fallback: use planned duration
                        actual_clip_durations[clip_num] = duration
                
                # IMPORTANT: Save raw (pre-caption) path for raw asset saving
                if video_result:
                    raw_clip_paths[clip_num] = video_result
                
                # Apply captions if requested
                if captions and video_result:
                    print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                    # For IMAGE_ONLY clips, use separate voiceover file if available
                    audio_path = None
                    if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                        audio_path = voiceover_files[clip_num].get('path')
                        if audio_path and os.path.exists(audio_path):
                            print(f"  🔊 Using separate voiceover file for transcription: {os.path.basename(audio_path)}")
                    
                    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                    caption_result = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=audio_path, transliterate=transliterate, language_name=language_name)
                    # Handle tuple return (path, transcription_data)
                    captioned_path, transcription_info = caption_result if isinstance(caption_result, tuple) else (caption_result, None)
                    if transcription_info:
                        all_transcription_data[clip_num] = transcription_info
                    if captioned_path and captioned_path != video_result:
                        # Keep raw file for asset saving, use captioned for final video
                        video_result = captioned_path
                
                clip_paths.append(video_result)
        
        # Filter out None values and build parallel clip numbers list
        valid_clip_paths = []
        valid_clip_numbers = []  # Track clip number for each path (for voiceover/duration lookup)
        
        # clip_paths is built by iterating through clip_data in order
        # So clip_paths[i] corresponds to clip_data[i]
        for i, clip_info in enumerate(clip_data):
            clip_num = clip_info['clip_number']
            # clip_paths[i] corresponds to clip_data[i], not clip_paths[clip_num]
            if i < len(clip_paths) and clip_paths[i]:
                valid_clip_paths.append(clip_paths[i])
                valid_clip_numbers.append(clip_num)
        
        if not valid_clip_paths:
            raise ValueError("No clips were generated successfully")
        
        # Step 6: Generate background music for each music group
        print(f"\n{'='*60}")
        print(f"🎵 STEP 6: MUSIC GENERATION (Per Music Group)")
        print(f"{'='*60}")
        
        music_groups = video_plan.get('music_groups', {})
        music_files = {}  # group_name -> file_path
        custom_music_used = False  # Track if custom music was successfully loaded
        
        # Check if custom background music file was provided
        if background_music:
            print(f"\n  📁 Custom background music provided: {background_music}")
            
            if os.path.exists(background_music):
                try:
                    # Try to load the audio file to verify it's valid
                    test_audio = AudioFileClip(background_music)
                    custom_music_duration = test_audio.duration
                    test_audio.close()
                    
                    print(f"     ✅ Music file loaded successfully (duration: {custom_music_duration:.1f}s)")
                    print(f"     → Skipping ElevenLabs music generation")
                    
                    # Use custom music as Music_A (will be looped in stitch function)
                    # Get all clips for Music_A (or all clips if no groups defined)
                    all_clips = list(range(len(clips)))
                    total_video_duration = sum(actual_clip_durations.get(c, 4) for c in all_clips)
                    
                    music_files['Music_A'] = {
                        'path': background_music,
                        'clips': all_clips,
                        'duration': custom_music_duration,
                        'is_custom': True  # Mark as custom music
                    }
                    custom_music_used = True
                    print(f"     → Custom music assigned to Music_A (video duration: {total_video_duration:.1f}s)")
                    
                except Exception as e:
                    print(f"     ❌ Failed to load music file: {e}")
                    print(f"     → Falling back to ElevenLabs music generation")
            else:
                print(f"     ❌ Music file not found: {background_music}")
                print(f"     → Falling back to ElevenLabs music generation")
        
        # Generate music via ElevenLabs only if custom music was not used
        if not custom_music_used:
            # Use actual clip durations (adjusted for voiceover) for timing calculation
            print(f"\n  Using actual clip durations (adjusted for voiceover):")
            for clip_num, dur in actual_clip_durations.items():
                print(f"    Clip {clip_num}: {dur:.2f}s")
            
            for group_name, group_info in music_groups.items():
                group_clips = group_info.get('clips', [])
                
                # Calculate duration from actual clip durations (adjusted for voiceover)
                group_duration = sum(actual_clip_durations.get(c, 4) for c in group_clips)
                
                # Ensure max 20 seconds
                group_duration = min(group_duration, 20)
                
                if group_duration > 0:
                    music_prompt = group_info.get('prompt', 
                        f"{group_info.get('mood', 'tense')} {group_info.get('tempo', 'medium')} background music")
                    
                    print(f"\n  🎵 Music Group: {group_name}")
                    print(f"     Clips: {group_clips}")
                    print(f"     Duration: {group_duration:.1f}s (generating {int(group_duration)}s)")
                    print(f"     Prompt: {music_prompt[:80]}...")
                    
                    music_path = os.path.join(temp_dir, f"music_{group_name}.mp3")
                    result = generate_background_music(music_prompt, int(group_duration), music_path)
                    
                    if result:
                        music_files[group_name] = {
                            'path': result,
                            'clips': group_clips,
                            'duration': group_duration
                        }
        
        if custom_music_used:
            print(f"\n  ✅ Using custom background music")
        else:
            print(f"\n  ✅ Generated {len(music_files)} music tracks")
        
        # Build clip-to-music mapping (needed for asset saving)
        clip_music_mapping = {}  # clip_number -> music_group_name
        for group_name, group_info in music_groups.items():
            for clip_num in group_info.get('clips', []):
                clip_music_mapping[clip_num] = group_name
        
        # Step 6.5: Save individual clip assets (for potential regeneration)
        print(f"\n{'='*60}")
        print(f"💾 STEP 6.5: SAVING INDIVIDUAL CLIP ASSETS")
        print(f"{'='*60}")
        
        # Create assets directory in ai/output folder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(script_dir, "output")
        os.makedirs(output_dir, exist_ok=True)
        
        # Create assets folder with timestamp for this video generation
        base_name = os.path.splitext(os.path.basename(output_path))[0]
        assets_dir = os.path.join(output_dir, f"{base_name}_assets")
        os.makedirs(assets_dir, exist_ok=True)
        print(f"  Assets directory: {assets_dir}")
        
        # Create clip number to clip_data mapping
        clip_data_map = {info['clip_number']: info for info in clip_data}
        
        # Save raw assets (voiceover files, music files, images, video clips, metadata)
        raw_assets_dir = os.path.join(assets_dir, "raw_assets")
        os.makedirs(raw_assets_dir, exist_ok=True)
        
        import shutil
        
        # Save voiceover files
        print(f"\n  Saving raw voiceover files...")
        for clip_num, vo_info in voiceover_files.items():
            if not vo_info.get('embedded', False):
                vo_path = vo_info.get('path')
                if vo_path and os.path.exists(vo_path):
                    dest_path = os.path.join(raw_assets_dir, f"voiceover_clip_{clip_num}.mp3")
                    shutil.copy2(vo_path, dest_path)
                    print(f"    ✅ Saved: voiceover_clip_{clip_num}.mp3")
        
        # Save music files (grouped music)
        print(f"\n  Saving raw music files...")
        for group_name, music_info in music_files.items():
            music_path = music_info.get('path')
            if music_path and os.path.exists(music_path):
                dest_path = os.path.join(raw_assets_dir, f"music_{group_name}.mp3")
                shutil.copy2(music_path, dest_path)
                print(f"    ✅ Saved: music_{group_name}.mp3")
                # Also save music group info (which clips use this music)
                music_info_path = os.path.join(raw_assets_dir, f"music_{group_name}_info.json")
                with open(music_info_path, 'w') as f:
                    json.dump({
                        'group_name': group_name,
                        'clips': music_info.get('clips', []),
                        'duration': music_info.get('duration', 0)
                    }, f, indent=2)
                print(f"    ✅ Saved: music_{group_name}_info.json")
        
        # Save raw video clips (WITHOUT captions - these are the pre-caption video files)
        print(f"\n  Saving raw video clips (without captions)...")
        raw_video_dir = os.path.join(raw_assets_dir, "videos")
        os.makedirs(raw_video_dir, exist_ok=True)
        for clip_num, raw_path in raw_clip_paths.items():
            if raw_path and os.path.exists(raw_path):
                dest_path = os.path.join(raw_video_dir, f"clip_{clip_num}_raw.mp4")
                shutil.copy2(raw_path, dest_path)
                print(f"    ✅ Saved: videos/clip_{clip_num}_raw.mp4 (no captions)")
        
        # Note: images are saved later with more specific naming based on clip_data
        
        # Save master metadata (all clip information for regeneration)
        print(f"\n  Saving master metadata...")
        master_metadata = {
            'generation_params': {
                'language_code': language_code,
                'language_name': SUPPORTED_LANGUAGES.get(language_code, "Unknown"),
                'influencer_mode': influencer_mode,
                'influencer_gender': influencer_gender,
                'ai_video_model': ai_video_model,
                'audio_model': audio_model,
                'voice_id': voice_id,
                'speed': speed,
                'captions': captions,
                'transliterate': transliterate,
                'voiceover_emotions': voiceover_emotions,
                'image_group_proportion': image_group_proportion,
                'desired_duration': desired_duration,
                'user_instruction': user_instruction
            },
            'clip_count': len(valid_clip_paths),
            'total_duration': sum(actual_clip_durations.values()),
            'clips': [],
            'voiceover_files': {},
            'music_files': {},
            'clip_music_mapping': clip_music_mapping
        }
        
        # Add comprehensive clip data (everything needed for regeneration)
        for clip_num, clip_info in enumerate(clip_data):
            clip_metadata = {
                'clip_number': clip_num,
                'clip_type': clip_info.get('clip_type', 'IMAGE_ONLY'),
                'duration': actual_clip_durations.get(clip_num, 4),
                'planned_duration': clip_info.get('estimated_duration_seconds', 4),
                'is_influencer_clip': clip_info.get('is_influencer_clip', False),
                'prompt': clip_info.get('prompt', ''),
                'starting_image_prompt': clip_info.get('starting_image_prompt', ''),
                'voiceover_text': clip_info.get('voiceover', ''),
                'effect_hint': clip_info.get('effect_hint', ''),
                'hook_type': clip_info.get('hook_type', ''),
                'music_prompt': clip_info.get('music_prompt', ''),
                'text_overlay': clip_info.get('text_overlay', ''),
                # Image group data
                'has_image_group': 'image_group' in clip_info,
                'image_group': clip_info.get('image_group', []),
                # Failover data for AI_VIDEO clips
                'failover_image_prompt': clip_info.get('failover_image_prompt', ''),
                'failover_effect_hint': clip_info.get('failover_effect_hint', ''),
                # Raw file references
                'raw_video_path': f"videos/clip_{clip_num}_raw.mp4",
                'raw_image_path': f"images/clip_{clip_num}.png" if clip_info.get('clip_type') != 'AI_VIDEO' else f"images/clip_{clip_num}_start.png"
            }
            master_metadata['clips'].append(clip_metadata)
        
        # Add voiceover file info with durations
        for clip_num, vo_info in voiceover_files.items():
            master_metadata['voiceover_files'][str(clip_num)] = {
                'embedded': vo_info.get('embedded', False),
                'duration': vo_info.get('duration', 0),
                'path': f"voiceover_clip_{clip_num}.mp3" if not vo_info.get('embedded', False) else None
            }
        
        # Add music file info (including whether it's custom or generated)
        for group_name, music_info in music_files.items():
            master_metadata['music_files'][group_name] = {
                'clips': music_info.get('clips', []),
                'duration': music_info.get('duration', 0),
                'path': f"music_{group_name}.mp3",
                'is_custom': music_info.get('is_custom', False),
                'original_path': music_info.get('path') if music_info.get('is_custom') else None
            }
        
        master_metadata_path = os.path.join(raw_assets_dir, "master_metadata.json")
        with open(master_metadata_path, 'w') as f:
            json.dump(master_metadata, f, indent=2)
        print(f"    ✅ Saved: master_metadata.json")
        
        # Save effect analysis results (Grok's effect recommendations and actual applied effects)
        print(f"\n  Saving effect analysis...")
        effect_analysis_data = {}
        for clip_num, clip_info in enumerate(clip_data):
            # Get effects that were actually applied to this clip
            applied = clip_effects.get(clip_num, []) if clip_effects else []
            # Convert effect objects to serializable dicts if needed
            serializable_effects = []
            for eff in applied:
                if isinstance(eff, dict):
                    serializable_effects.append(eff)
                else:
                    serializable_effects.append(str(eff))
            
            effect_analysis_data[str(clip_num)] = {
                'effect_hint': clip_info.get('effect_hint', ''),
                'applied_effects': serializable_effects
            }
        effect_analysis_path = os.path.join(raw_assets_dir, "effect_analysis.json")
        with open(effect_analysis_path, 'w') as f:
            json.dump(effect_analysis_data, f, indent=2)
        print(f"    ✅ Saved: effect_analysis.json")
        
        # Save original Grok video plan (for complete regeneration capability)
        print(f"\n  Saving Grok video plan...")
        video_plan_data = {
            'clips': []
        }
        for clip_info in clip_data:
            # Include all original Grok-generated data for each clip
            video_plan_data['clips'].append({
                'clip_number': clip_info.get('clip_number', 0),
                'clip_type': clip_info.get('clip_type', 'IMAGE_ONLY'),
                'estimated_duration_seconds': clip_info.get('estimated_duration_seconds', 4),
                'voiceover': clip_info.get('voiceover', ''),
                'prompt': clip_info.get('prompt', ''),
                'starting_image_prompt': clip_info.get('starting_image_prompt', ''),
                'effect_hint': clip_info.get('effect_hint', ''),
                'hook_type': clip_info.get('hook_type', ''),
                'music_prompt': clip_info.get('music_prompt', ''),
                'music_group': clip_info.get('music_group', 'Music_A'),
                'text_overlay': clip_info.get('text_overlay', ''),
                'image_group': clip_info.get('image_group', []),
                'failover_image_prompt': clip_info.get('failover_image_prompt', ''),
                'failover_effect_hint': clip_info.get('failover_effect_hint', ''),
                'is_influencer_clip': clip_info.get('is_influencer_clip', False)
            })
        video_plan_path = os.path.join(raw_assets_dir, "video_plan.json")
        with open(video_plan_path, 'w') as f:
            json.dump(video_plan_data, f, indent=2)
        print(f"    ✅ Saved: video_plan.json")
        
        # Save input context text (for reference and potential re-generation)
        print(f"\n  Saving input context...")
        context_path = os.path.join(raw_assets_dir, "input_context.txt")
        with open(context_path, 'w') as f:
            f.write(context_text)
        print(f"    ✅ Saved: input_context.txt ({len(context_text)} chars)")
        
        # Save transcription data (word-level timestamps for caption regeneration)
        print(f"\n  Saving transcription data...")
        if all_transcription_data:
            transcription_path = os.path.join(raw_assets_dir, "transcriptions.json")
            with open(transcription_path, 'w') as f:
                # Convert int keys to string for JSON serialization
                serializable_transcriptions = {str(k): v for k, v in all_transcription_data.items()}
                json.dump(serializable_transcriptions, f, indent=2)
            print(f"    ✅ Saved: transcriptions.json ({len(all_transcription_data)} clips)")
        else:
            print(f"    ℹ️ No transcription data to save (captions may not have been applied)")
        
        # Save raw images (original generated images before video processing)
        print(f"\n  Saving raw images...")
        images_dir = os.path.join(raw_assets_dir, "images")
        os.makedirs(images_dir, exist_ok=True)
        for clip_info in clip_data:
            clip_num = clip_info['clip_number']
            clip_type = clip_info.get('clip_type', 'IMAGE_ONLY')
            
            # Save main image
            image_path = clip_info.get('image_path')
            if image_path and os.path.exists(image_path):
                if clip_type == "AI_VIDEO":
                    dest_name = f"clip_{clip_num}_start.png"
                else:
                    dest_name = f"clip_{clip_num}.png"
                dest_path = os.path.join(images_dir, dest_name)
                import shutil
                shutil.copy2(image_path, dest_path)
                print(f"    ✅ Saved: images/{dest_name}")
            
            # Save image group images
            image_group_paths = clip_info.get('image_group_paths', [])
            for idx, img_path in enumerate(image_group_paths):
                if img_path and os.path.exists(img_path):
                    dest_name = f"clip_{clip_num}_group_{idx}.png"
                    dest_path = os.path.join(images_dir, dest_name)
                    import shutil
                    shutil.copy2(img_path, dest_path)
                    print(f"    ✅ Saved: images/{dest_name}")
        
        # Save voiceover files
        print(f"\n  Saving voiceover files...")
        voiceovers_dir = os.path.join(raw_assets_dir, "voiceovers")
        os.makedirs(voiceovers_dir, exist_ok=True)
        for clip_num, vo_info in voiceover_files.items():
            if not vo_info.get('embedded', False):
                vo_path = vo_info.get('path')
                if vo_path and os.path.exists(vo_path):
                    dest_name = f"voiceover_clip_{clip_num}.mp3"
                    dest_path = os.path.join(voiceovers_dir, dest_name)
                    import shutil
                    shutil.copy2(vo_path, dest_path)
                    print(f"    ✅ Saved: voiceovers/{dest_name}")
        
        # Save music files
        print(f"\n  Saving music files...")
        music_dir = os.path.join(raw_assets_dir, "music")
        os.makedirs(music_dir, exist_ok=True)
        for group_name, music_info in music_files.items():
            music_path = music_info.get('path')
            if music_path and os.path.exists(music_path):
                dest_name = f"music_{group_name}.mp3"
                dest_path = os.path.join(music_dir, dest_name)
                import shutil
                shutil.copy2(music_path, dest_path)
                print(f"    ✅ Saved: music/{dest_name}")
        
        # Save each clip as a complete asset (video + voiceover + music)
        print(f"\n  Saving complete clip assets...")
        for clip_num in range(len(valid_clip_paths)):
            clip_path = valid_clip_paths[clip_num]
            if not clip_path or not os.path.exists(clip_path):
                continue
            
            clip_info = clip_data_map.get(clip_num, {})
            clip_type = clip_info.get('clip_type', 'IMAGE_ONLY')
            is_influencer_clip = clip_info.get('is_influencer_clip', False)
            
            # Create clip-specific folder
            clip_folder = os.path.join(assets_dir, f"clip_{clip_num}")
            os.makedirs(clip_folder, exist_ok=True)
            
            asset_path = os.path.join(clip_folder, f"clip_{clip_num}_complete.mp4")
            
            try:
                # Load video clip
                video_clip = VideoFileClip(clip_path)
                clip_duration = actual_clip_durations.get(clip_num, video_clip.duration)
                
                # Trim video to exact duration
                if video_clip.duration > clip_duration:
                    video_clip = video_clip.subclip(0, clip_duration)
                
                # CRITICAL: Strip any existing audio from video clip FIRST
                # We'll add all audio back via CompositeAudioClip
                video_clip = video_clip.set_audio(None)
                
                # Use the actual video duration as the authoritative duration for all audio
                final_clip_duration = video_clip.duration
                AUDIO_BUFFER = 0.04  # 40ms buffer to prevent boundary artifacts
                
                audio_clips = []
                
                # Add voiceover (if not embedded)
                if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                    vo_path = voiceover_files[clip_num].get('path')
                    if vo_path and os.path.exists(vo_path):
                        voiceover = AudioFileClip(vo_path)
                        # For IMAGE_ONLY clips, don't trim - use full voiceover
                        # Clip should already be extended to match voiceover
                        if voiceover.duration > final_clip_duration:
                            # Use voiceover duration as authoritative for IMAGE_ONLY clips
                            if clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]:
                                final_clip_duration = voiceover.duration
                                if video_clip.duration < final_clip_duration:
                                    # Extend video by looping if needed
                                    loops_needed = int(final_clip_duration / video_clip.duration) + 1
                                    video_parts = [video_clip] * loops_needed
                                    video_clip = concatenate_videoclips(video_parts)
                                    video_clip = video_clip.subclip(0, final_clip_duration)
                        
                        # CRITICAL: Trim voiceover with 40ms buffer to prevent boundary artifacts
                        target_vo_duration = min(voiceover.duration, final_clip_duration) - AUDIO_BUFFER
                        target_vo_duration = max(target_vo_duration, 0.1)  # Minimum 100ms
                        if voiceover.duration > target_vo_duration:
                            voiceover = voiceover.subclip(0, target_vo_duration)
                        
                        voiceover = voiceover.volumex(1.0)
                        # Apply fade in/out to prevent clicks/pops at clip boundaries
                        fade_duration = min(0.05, voiceover.duration * 0.05)
                        voiceover = voiceover.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                        audio_clips.append(voiceover)
                
                # Add embedded audio (for influencer clips)
                original_video_for_audio = None  # Keep reference to avoid closing before write
                if clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                    # Re-load the original video to get its audio (since we stripped it above)
                    original_video_for_audio = VideoFileClip(clip_path)
                    if original_video_for_audio.audio is not None:
                        embedded_audio = original_video_for_audio.audio
                        
                        # CRITICAL: Trim embedded audio with 40ms buffer to prevent boundary artifacts
                        target_audio_duration = min(embedded_audio.duration, final_clip_duration) - AUDIO_BUFFER
                        target_audio_duration = max(target_audio_duration, 0.1)  # Minimum 100ms
                        if embedded_audio.duration > target_audio_duration:
                            embedded_audio = embedded_audio.subclip(0, target_audio_duration)
                        
                        embedded_audio = embedded_audio.volumex(1.0)
                        # Apply fade in/out to prevent clicks/pops at clip boundaries
                        fade_duration = min(0.05, embedded_audio.duration * 0.05)
                        embedded_audio = embedded_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                        audio_clips.append(embedded_audio)
                    # NOTE: Don't close original_video_for_audio here - audio reader needs it open
                
                # Add background music (use ONLY first music group, looped)
                # Get the first music group (sorted alphabetically, so Music_A comes first)
                sorted_music_groups = sorted(music_files.keys())
                if sorted_music_groups:
                    first_group_name = sorted_music_groups[0]
                    music_info = music_files[first_group_name]
                    music_path = music_info.get('path')
                    
                    if music_path and os.path.exists(music_path):
                        music = AudioFileClip(music_path)
                        
                        # Apply fade to original music BEFORE looping
                        music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
                        music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
                        
                        # Calculate start position in music based on cumulative duration of previous clips
                        # This ensures music continues seamlessly when clips are played in sequence
                        clips_before = [c for c in actual_clip_durations.keys() if c < clip_num]
                        music_start = sum(actual_clip_durations.get(c, 4) for c in clips_before)
                        
                        # Loop music if needed to reach this position + clip duration
                        music_end = music_start + final_clip_duration
                        if music_end > music.duration:
                            loops_needed = int(music_end / music.duration) + 1
                            music_parts = [music] * loops_needed
                            music = concatenate_audioclips(music_parts)
                        
                        # Extract this clip's portion of music
                        music = music.subclip(music_start % music.duration if music.duration > 0 else 0, 
                                             min((music_start % music.duration if music.duration > 0 else 0) + final_clip_duration, music.duration))
                        if music.duration < final_clip_duration:
                            # If extracted portion is shorter than clip, loop it
                            loops = int(final_clip_duration / music.duration) + 1
                            music_parts = [music] * loops
                            music = concatenate_audioclips(music_parts)
                        
                        # CRITICAL: Trim music to EXACT video duration to prevent overflow
                        music = music.subclip(0, final_clip_duration)
                        
                        # Apply fade to this clip's music portion
                        clip_music_fade = min(0.03, music.duration * 0.05)  # 30ms or 5%
                        music = music.audio_fadein(clip_music_fade).audio_fadeout(clip_music_fade)
                        
                        music = music.volumex(0.07)  # Background music at 7% volume
                        audio_clips.append(music)
                
                # Combine audio
                if audio_clips:
                    # CRITICAL: Ensure all audio clips are trimmed to exact video duration
                    trimmed_audio_clips = []
                    for ac in audio_clips:
                        if ac.duration > final_clip_duration:
                            ac = ac.subclip(0, final_clip_duration)
                        trimmed_audio_clips.append(ac)
                    
                    if len(trimmed_audio_clips) > 1:
                        final_audio = CompositeAudioClip(trimmed_audio_clips)
                    else:
                        final_audio = trimmed_audio_clips[0]
                    
                    # Final safety: trim composite audio to video duration
                    if final_audio.duration > final_clip_duration:
                        final_audio = final_audio.subclip(0, final_clip_duration)
                    
                    video_clip = video_clip.set_audio(final_audio)
                # Video already has audio stripped, no need for else clause
                
                # Write asset
                video_clip.write_videofile(
                    asset_path,
                    fps=FPS,
                    codec='libx264',
                    audio_codec='aac',
                    verbose=False,
                    logger=None
                )
                
                video_clip.close()
                for audio in audio_clips:
                    if hasattr(audio, 'close'):
                        audio.close()
                # Close the original video used for embedded audio extraction
                if original_video_for_audio is not None:
                    original_video_for_audio.close()
                
                # Save clip metadata
                metadata_path = os.path.join(clip_folder, f"clip_{clip_num}_metadata.json")
                # Get music group - we now use only the first music group for all clips
                clip_music_group = sorted_music_groups[0] if sorted_music_groups else None
                with open(metadata_path, 'w') as f:
                    json.dump({
                        'clip_number': clip_num,
                        'clip_type': clip_type,
                        'is_influencer_clip': is_influencer_clip,
                        'duration': clip_duration,
                        'music_group': clip_music_group,
                        'has_voiceover': clip_num in voiceover_files,
                        'voiceover_embedded': voiceover_files.get(clip_num, {}).get('embedded', False) if clip_num in voiceover_files else False
                    }, f, indent=2)
                
                print(f"  ✅ Saved asset: clip_{clip_num}/clip_{clip_num}_complete.mp4 ({clip_duration:.2f}s)")
                
            except Exception as e:
                print(f"  ⚠️ Failed to save asset for clip {clip_num}: {e}")
                import traceback
                print(traceback.format_exc())
        
        print(f"\n  ✅ Saved {len([c for c in valid_clip_paths if c])} clip assets to {assets_dir}")
        print(f"  📁 Assets structure:")
        print(f"     - {assets_dir}/raw_assets/")
        print(f"       - voiceover_clip_*.mp3 (voiceover audio files)")
        print(f"       - music_*.mp3 (background music files)")
        print(f"       - videos/clip_*_raw.mp4 (raw video clips)")
        print(f"       - images/clip_*.png (generated images)")
        print(f"       - video_plan.json (Grok-generated video plan)")
        print(f"       - master_metadata.json (all clip info for regeneration)")
        print(f"     - {assets_dir}/clip_*/ (complete clip assets with video + audio)")
        
        # Step 6.5: Generate research clips if enabled
        research_clips_to_insert = []  # List of (insert_after_clip, video_path, voiceover_path, duration)
        
        if include_research:
            print(f"\n{'='*60}")
            print(f"📰 STEP 6.5: RESEARCH CLIP GENERATION")
            print(f"{'='*60}")
            
            research_items = video_plan.get('research_integration', [])
            valid_research_items = [r for r in research_items if r.get('claim_used') and r.get('voiceover') and r.get('insert_after_clip') is not None]
            
            if valid_research_items:
                print(f"  Found {len(valid_research_items)} research clips to generate")
                
                for i, research_item in enumerate(valid_research_items[:2]):  # Max 2 research clips
                    claim = research_item.get('claim_used', '')
                    voiceover = research_item.get('voiceover', '')
                    insert_after = research_item.get('insert_after_clip', 0)
                    
                    print(f"\n  📰 Research Clip {i+1}:")
                    print(f"     Claim: {claim[:50]}...")
                    print(f"     Insert after Clip: {insert_after}")
                    
                    video_path, vo_path, duration = generate_research_clip(
                        claim_text=claim,
                        voiceover_text=voiceover,
                        output_path=os.path.join(temp_dir, f"research_clip_{i}.mp4"),
                        temp_dir=temp_dir,
                        research_type=research_type,
                        highlight_color=highlight_color,
                        language_code=language_code,
                        voice_id=voice_id,
                        speed=speed,
                        audio_model=audio_model,
                        elevenlabs_direct=elevenlabs_direct
                    )
                    
                    if video_path:
                        research_clips_to_insert.append({
                            'insert_after_clip': insert_after,
                            'video_path': video_path,
                            'voiceover_path': vo_path,
                            'duration': duration,
                            'claim': claim,
                            'voiceover_text': voiceover
                        })
                        print(f"     ✅ Research clip {i+1} generated successfully")
                    else:
                        print(f"     ⚠️ Failed to generate research clip {i+1}")
                
                print(f"\n  ✅ Generated {len(research_clips_to_insert)} research clips")
                
                # Save research clips to raw assets
                research_assets_dir = os.path.join(raw_assets_dir, "research_clips")
                os.makedirs(research_assets_dir, exist_ok=True)
                print(f"\n  Saving research clips to raw assets...")
                
                for i, research_clip in enumerate(research_clips_to_insert):
                    insert_after = research_clip['insert_after_clip']
                    
                    # Save research video
                    if research_clip['video_path'] and os.path.exists(research_clip['video_path']):
                        dest_video = os.path.join(research_assets_dir, f"research_after_clip_{insert_after}.mp4")
                        shutil.copy2(research_clip['video_path'], dest_video)
                        print(f"    ✅ Saved: research_clips/research_after_clip_{insert_after}.mp4")
                    
                    # Save research voiceover
                    if research_clip['voiceover_path'] and os.path.exists(research_clip['voiceover_path']):
                        dest_vo = os.path.join(research_assets_dir, f"research_vo_after_clip_{insert_after}.mp3")
                        shutil.copy2(research_clip['voiceover_path'], dest_vo)
                        print(f"    ✅ Saved: research_clips/research_vo_after_clip_{insert_after}.mp3")
                    
                    # Save research metadata
                    metadata = {
                        'insert_after_clip': insert_after,
                        'claim': research_clip.get('claim', ''),
                        'voiceover_text': research_clip.get('voiceover_text', ''),
                        'duration': research_clip.get('duration', 2.0)
                    }
                    metadata_path = os.path.join(research_assets_dir, f"research_after_clip_{insert_after}_info.json")
                    with open(metadata_path, 'w') as f:
                        json.dump(metadata, f, indent=2)
                    print(f"    ✅ Saved: research_clips/research_after_clip_{insert_after}_info.json")
            else:
                print(f"  ⚠️ No valid research items found in video plan")
                print(f"     research_integration array may be empty or missing required fields")
                print(f"     Required: claim_used, voiceover, insert_after_clip")
        
        # Insert research clips into the clip lists (sorted by insert position)
        if research_clips_to_insert:
            # Sort by insert_after_clip in reverse order to maintain correct positions
            research_clips_to_insert.sort(key=lambda x: x['insert_after_clip'], reverse=True)
            
            for research_clip in research_clips_to_insert:
                # Find the position to insert AFTER the specified clip
                # We need to find where the specified clip is in valid_clip_numbers
                insert_after_clip_num = research_clip['insert_after_clip']
                
                # Find the index of the clip we want to insert after
                try:
                    idx_of_target = valid_clip_numbers.index(insert_after_clip_num)
                    insert_idx = idx_of_target + 1
                except ValueError:
                    # Clip not found, insert at the end
                    print(f"  ⚠️ Clip {insert_after_clip_num} not found in valid clips, skipping research clip")
                    continue
                
                # Create a unique clip number for the research clip
                research_clip_num = 1000 + insert_after_clip_num
                
                # Insert video path and clip number at the correct position
                valid_clip_paths.insert(insert_idx, research_clip['video_path'])
                valid_clip_numbers.insert(insert_idx, research_clip_num)
                
                # Insert voiceover file info
                if research_clip['voiceover_path']:
                    voiceover_files[research_clip_num] = {
                        'path': research_clip['voiceover_path'],
                        'duration': research_clip['duration']
                    }
                
                # Update actual durations (research clips use their voiceover duration)
                actual_clip_durations[research_clip_num] = research_clip['duration']
                
                # Assign to first music group
                first_music_group = list(clip_music_mapping.values())[0] if clip_music_mapping else 'Music_A'
                clip_music_mapping[research_clip_num] = first_music_group
                
                print(f"  📍 Inserted research clip after Clip {insert_after_clip_num} (at index {insert_idx})")
        
        # Step 7: Stitch everything together with segmented music
        print(f"\n{'='*60}")
        print(f"🎬 STEP 7: VIDEO STITCHING")
        print(f"{'='*60}")
        
        final_video = stitch_video_clips_with_music_groups(
            clip_paths=valid_clip_paths,
            clip_numbers=valid_clip_numbers,  # Clip numbers corresponding to each path
            clip_durations=actual_clip_durations,  # Use actual durations (adjusted for voiceover)
            voiceover_files=voiceover_files,  # Per-clip voiceover files
            music_files=music_files,
            clip_music_mapping=clip_music_mapping,
            output_path=output_path
        )
        
        if final_video:
            print(f"\n{'='*80}")
            print(f"🎉 VIDEO GENERATION COMPLETE!")
            print(f"{'='*80}")
            print(f"  Output: {output_path}")
            
            # Get video info
            video_info = VideoFileClip(output_path)
            print(f"  Duration: {video_info.duration:.1f}s")
            print(f"  Resolution: {video_info.size[0]}x{video_info.size[1]}")
            video_info.close()
            
            return output_path
        else:
            raise ValueError("Failed to stitch final video")
        
    except Exception as e:
        print(f"\n❌ Video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None
    
    finally:
        # Cleanup temp directory
        print(f"\n🧹 Cleaning up temp files...")
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


# ============================================
# CLI
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate political videos from research documents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python political_video_generator.py --input research.pdf --output video.mp4
  python political_video_generator.py -i document.docx -o output.mp4
  python political_video_generator.py -i notes.txt -o final_video.mp4
  
  # With influencer mode (20 seconds of influencer speaking to camera: 8s + 6s + 6s)
  python political_video_generator.py -i research.pdf -o video.mp4 --influencer

Supported input formats:
  - PDF (.pdf)
  - Word Document (.docx, .doc)
  - Text File (.txt)

Supported languages (ISO 639-1 codes):
  hi = Hindi (default)    pa = Punjabi      bn = Bengali
  ta = Tamil              te = Telugu       mr = Marathi
  gu = Gujarati           kn = Kannada      ml = Malayalam
  or = Odia               en = English

Influencer Mode (--influencer):
  - Up to 3 AI video clips with influencer speaking to camera (ideally 3, but failover to IMAGE_ONLY if generation fails)
  - All influencer clips: 8 seconds each (total 24 seconds for 3 clips)
  - Grok decides which emotional moments feature the influencer
  - Influencer position varies across clips (lower portion, side split, corner overlay)
  - Same influencer appearance maintained across all 3 clips via reference images
  - Voice is generated by Veo3.1 and kept as-is (original audio)
  - Background music is generated separately via ElevenLabs sound effects

Examples:
  python political_video_generator.py -i research.pdf -l hi  # Hindi
  python political_video_generator.py -i research.pdf -l pa  # Punjabi
  python political_video_generator.py -i research.pdf --influencer  # With influencer

All environment variables are loaded from python-ai-backend/.env:
  - XAI_API_KEY: API key for Grok (xAI)
  - FAL_API_KEY: API key for FAL.ai (images, videos, ElevenLabs voiceover/music)
  - OPENAI_API_KEY: For Whisper transcription (influencer mode voice alignment)
  - AWS_ACCESS_KEY_ID: AWS credentials for S3 uploads
  - AWS_SECRET_ACCESS_KEY: AWS credentials for S3 uploads
  - S3_BUCKET_NAME: S3 bucket name (matches settings.py, required)
  - AWS_REGION: AWS region (default: ap-south-1)
        """
    )
    
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Path to input document (PDF, DOCX, or TXT)"
    )
    
    parser.add_argument(
        "--output", "-o",
        help="Path to output video (default: input_name_video.mp4)"
    )
    
    parser.add_argument(
        "--language", "-l",
        default="hi",
        help="Language code for voiceover (ISO 639-1). Supported: hi (Hindi), pa (Punjabi), bn (Bengali), ta (Tamil), te (Telugu), mr (Marathi), gu (Gujarati), kn (Kannada), ml (Malayalam), or (Odia), en (English). Default: hi"
    )
    
    parser.add_argument(
        "--influencer",
        action="store_true",
        default=False,
        help="Enable influencer mode: 3 AI video clips (6s each) with influencer speaking to camera. The influencer's voice is generated by Veo3.1 and kept as-is (original audio)."
    )
    
    parser.add_argument(
        "--gender", "-g",
        choices=["male", "female"],
        default="male",
        help="Gender of influencer (only used when --influencer is enabled). Options: male (default), female. Affects both visual appearance and voice selection."
    )
    
    parser.add_argument(
        "--instruction",
        type=str,
        default=None,
        help="User's instruction to guide prompt generation. This instruction will be passed to Grok to align image prompts and clip prompts with your specific requirements."
    )
    
    parser.add_argument(
        "--voiceid",
        type=str,
        default=None,
        help="ElevenLabs voice ID to override default voice selection. If provided, this will override the gender-based voice selection (male/female). Example: RpiHVNPKGBg7UmgmrKrN"
    )
    
    parser.add_argument(
        "--captions",
        type=str,
        default=None,
        help="Apply captions to all clips using a caption combination. Available: boxed_pink, boxed_purple, boxed_blue, boxed_green, boxed_orange, boxed_red, boxed_black, karaoke_purple, karaoke_pink, karaoke_blue, karaoke_green, karaoke_orange, karaoke_red, karaoke_yellow. Example: --captions boxed_purple"
    )
    
    parser.add_argument(
        "--transliterate",
        action="store_true",
        default=False,
        help="Transliterate non-English captions to English using GPT-4o-mini. Use this if non-English characters (Hindi, Arabic, Chinese, etc.) show as boxes in captions. If not provided, captions will use the original transcribed text."
    )
    
    parser.add_argument(
        "--duration",
        "-d",
        type=str,
        default="60-90",
        help="Desired video duration in seconds. Can be a range (e.g., '30-45', '45-60', '60-75', '75-90') or a single number (e.g., '15', '30', '45'). Grok will automatically decide the number of clips based on this. Default: '60-90'"
    )
    
    parser.add_argument(
        "--ai-video-model",
        choices=["veo3.1", "seedance1.5", "omnihuman1.5"],
        default="veo3.1",
        help="AI video model to use for influencer clips. Options: veo3.1 (default), seedance1.5 (ByteDance Seedance v1.5 Pro), omnihuman1.5 (ByteDance OmniHuman 1.5 - requires pre-generated voiceover). Only applies when --influencer is enabled."
    )
    
    parser.add_argument(
        "--speed", "-s",
        type=float,
        default=1.0,
        help="Voice speed multiplier for ElevenLabs TTS (default: 1.0, range: 0.5-2.0). E.g., 1.2 for 20%% faster speech. Applies to all clips."
    )
    
    parser.add_argument(
        "--image-group-proportion",
        type=float,
        default=None,
        help="OPTIONAL: Proportion of IMAGE_ONLY clips that should use image groups (multiple visuals per clip) for dynamic, fast-paced feel. Range: 0.0-1.0. If NOT provided, all image clips will have single visuals (traditional mode). E.g., --image-group-proportion 0.5 means 50%% of image clips will have 2-3 visuals transitioning rapidly."
    )
    
    parser.add_argument(
        "--voiceover-emotions",
        action="store_true",
        default=False,
        help="OPTIONAL: Enable emotional expressions in voiceover text (square bracket expressions like [shocked], [pause], [excited]). If NOT provided, voiceovers will be plain text without emotional markers. When enabled, ElevenLabs TTS will use these expressions to make voice delivery more natural and human-like."
    )
    
    parser.add_argument(
        "--audio-model",
        choices=["v3", "v2", "turbo"],
        default="v3",
        help="ElevenLabs TTS model to use for voiceover generation. Options: v3 (eleven-v3, default) - supports language codes and timestamps, v2 (multilingual-v2) - multilingual support, turbo (turbo-v2.5) - fastest generation. E.g., --audio-model turbo for turbo v2.5 model."
    )
    
    parser.add_argument(
        "--reference-image", "-r",
        type=str,
        default=None,
        help="OPTIONAL: Path to reference influencer image for character consistency in AI influencer clips. When provided, ALL influencer clips will use nano-banana-pro/edit model with this reference image, ensuring the same influencer appears in all AI video clips. The reference image should be a clear, high-quality portrait of the influencer. Grok will use 'reference influencer' terminology in prompts. E.g., --reference-image influencer.png"
    )
    
    parser.add_argument(
        "--music", "-m",
        type=str,
        default=None,
        help="OPTIONAL: Path to custom background music file (MP3, WAV, etc.). When provided, this music will be used instead of generating music via ElevenLabs. The music will be looped if shorter than video duration and volume will be reduced to not overpower voiceover. If file is not found or cannot be loaded, falls back to ElevenLabs generated music. E.g., --music background.mp3"
    )
    
    parser.add_argument(
        "--elevenlabs-direct",
        action="store_true",
        default=False,
        help="OPTIONAL: Call ElevenLabs API directly instead of via FAL. This allows using custom voices that are only available to authenticated ElevenLabs accounts. Requires ELEVENLABS_API_KEY to be set in python-ai-backend/.env. When enabled, --voiceid can be any custom voice ID from your ElevenLabs account."
    )
    
    parser.add_argument(
        "--research",
        action="store_true",
        default=False,
        help="OPTIONAL: Include research clips in the video. When enabled, Grok will suggest 1-2 claims that can be searched for and displayed as mini-clips showing actual news/blog/report screenshots with highlighted quotes. These clips add credibility to your video content."
    )
    
    parser.add_argument(
        "--research-type",
        type=str,
        choices=["news", "blog", "report", "twitter"],
        default="news",
        help="OPTIONAL: Type of research sources to search for. Options: news (default), blog, report, twitter. Used with --research flag to determine where to search for supporting evidence."
    )
    
    parser.add_argument(
        "--highlight-color",
        type=str,
        default="black",
        help="OPTIONAL: Highlight color for research clips. Default: black. Options: black, yellow, orange, pink, neongreen, neonpink, or any hex color like #FF6B6B. This color is used to highlight the key quote in article screenshots."
    )
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.input):
        print(f"❌ Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # Check environment variables (loaded from python-ai-backend/.env)
    if not os.getenv('XAI_API_KEY'):
        print("❌ Error: XAI_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        sys.exit(1)
    
    if not os.getenv('FAL_API_KEY'):
        print("❌ Error: FAL_API_KEY environment variable not set!")
        print("Please set it in python-ai-backend/.env file")
        sys.exit(1)
    
    # Check influencer mode specific requirements
    if args.influencer:
        if not openai_api_key:
            print("⚠️ Warning: OPENAI_API_KEY not set in python-ai-backend/.env - voice alignment may not work optimally")
        
        if not aws_access_key_id or not aws_secret_access_key:
            print("⚠️ Warning: AWS credentials not set in python-ai-backend/.env - S3 uploads may fail")
    
    # Validate language code
    if args.language not in SUPPORTED_LANGUAGES:
        print(f"❌ Error: Unsupported language code: {args.language}")
        print(f"Supported languages: {', '.join([f'{k} ({v})' for k, v in SUPPORTED_LANGUAGES.items()])}")
        sys.exit(1)
    
    print(f"🌐 Language: {SUPPORTED_LANGUAGES[args.language]} ({args.language})")
    if args.speed != 1.0:
        print(f"⚡ Voice Speed: {args.speed}x")
    # Image group proportion (optional - only enabled when explicitly provided)
    if args.image_group_proportion is not None and args.image_group_proportion > 0:
        image_group_pct = int(args.image_group_proportion * 100)
        print(f"📦 Image Groups: ENABLED ({image_group_pct}% of IMAGE_ONLY clips will have 2-3 visuals)")
    else:
        print(f"📦 Image Groups: DISABLED (all clips will have single visuals)")
    
    # Voiceover emotions (optional - only enabled when explicitly provided)
    if args.voiceover_emotions:
        print(f"🎭 Voiceover Emotions: ENABLED (square bracket expressions will be added)")
    else:
        print(f"🎭 Voiceover Emotions: DISABLED (plain text voiceovers)")
    
    # Audio model for voiceover
    audio_model_names = {"v3": "Eleven v3", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}
    audio_model_display = audio_model_names.get(args.audio_model, "Eleven v3")
    print(f"🎙️ Audio Model: {audio_model_display} ({args.audio_model})")
    
    # ElevenLabs direct API mode (for custom voices)
    if args.elevenlabs_direct:
        if not elevenlabs_api_key:
            print(f"❌ Error: --elevenlabs-direct requires ELEVENLABS_API_KEY in python-ai-backend/.env")
            sys.exit(1)
        print(f"🔑 ElevenLabs: DIRECT API (custom voices supported)")
    else:
        print(f"🔑 ElevenLabs: via FAL")
    
    # Research clips integration
    if args.research:
        research_type_display = {"news": "News Articles", "blog": "Blog Posts", "report": "Industry Reports", "twitter": "Twitter/X"}.get(args.research_type, "News")
        print(f"📰 Research Clips: ENABLED (source: {research_type_display})")
        print(f"   Highlight Color: {args.highlight_color}")
    else:
        print(f"📰 Research Clips: Disabled")
    
    if args.influencer:
        print(f"👤 Influencer Mode: ENABLED (~30% AI influencer clips)")
        print(f"   Gender: {args.gender}")
        print(f"   AI Model: {args.ai_video_model}")
        if args.reference_image:
            if not os.path.exists(args.reference_image):
                print(f"❌ Error: Reference image not found: {args.reference_image}")
                sys.exit(1)
            print(f"   Reference Image: {args.reference_image}")
            print(f"   → ALL influencer clips will use nano-banana-pro/edit with reference")
    
    # Background music (optional - uses custom file instead of generating via ElevenLabs)
    if args.music:
        if os.path.exists(args.music):
            print(f"🎵 Background Music: {args.music} (custom file)")
            print(f"   → Will skip ElevenLabs music generation")
        else:
            print(f"⚠️ Background Music: {args.music} NOT FOUND - will fallback to ElevenLabs generation")
    else:
        print(f"🎵 Background Music: ElevenLabs generated (Music Group A looped)")
    
    # Set output path
    if args.output:
        output_path = args.output
    else:
        base_name = os.path.splitext(os.path.basename(args.input))[0]
        output_dir = os.path.dirname(args.input) or "."
        suffix = "_influencer_video" if args.influencer else "_video"
        output_path = os.path.join(output_dir, f"{base_name}{suffix}.mp4")
    
    # Validate caption combination if provided
    if args.captions:
        combo = find_combination(args.captions)
        if not combo:
            print(f"❌ Error: Caption combination '{args.captions}' not found!")
            print(f"\nAvailable combinations:")
            for c in COMBINATIONS:
                print(f"  - {c['name']}: {c['description']}")
            sys.exit(1)
        print(f"📝 Captions: {combo['name']} - {combo['description']}")
        if args.transliterate:
            print(f"🔤 Transliteration: ENABLED (non-English text will be converted to English)")
        else:
            print(f"ℹ️ Transliteration: DISABLED (using original transcribed text)")
    
    # Generate video
    result = generate_political_video(
        args.input, 
        output_path, 
        args.language, 
        args.influencer,
        influencer_gender=args.gender,  # Always pass gender if provided, for voiceover consistency
        user_instruction=args.instruction,
        voice_id=args.voiceid,  # Pass CLI voice ID if provided
        captions=args.captions,  # Pass caption combination if provided
        transliterate=args.transliterate,  # Pass transliteration flag if provided
        desired_duration=args.duration,  # Pass desired duration from CLI
        ai_video_model=args.ai_video_model,  # Pass AI video model selection
        speed=args.speed,  # Pass voice speed multiplier
        image_group_proportion=args.image_group_proportion if args.image_group_proportion is not None else 0.0,  # Pass image group proportion (0 = disabled)
        voiceover_emotions=args.voiceover_emotions,  # Pass voiceover emotions flag
        audio_model=args.audio_model,  # Pass ElevenLabs audio model (v3 or v2)
        reference_image=args.reference_image,  # Pass reference influencer image if provided
        background_music=args.music,  # Pass custom background music file if provided
        elevenlabs_direct=args.elevenlabs_direct,  # Pass direct ElevenLabs API flag
        include_research=args.research,  # Pass research clips flag
        research_type=args.research_type,  # Pass research source type
        highlight_color=args.highlight_color  # Pass highlight color for research clips
    )
    
    if result:
        print(f"\n✅ Success! Video saved to: {result}")
        sys.exit(0)
    else:
        print(f"\n❌ Failed to generate video")
        sys.exit(1)


if __name__ == "__main__":
    main()

