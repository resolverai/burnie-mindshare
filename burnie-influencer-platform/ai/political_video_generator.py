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
        "shake", "zoom_pulse", "zoom_whip", "heartbeat",
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

def get_political_video_system_prompt(language_code: str = "hi", language_name: str = "Hindi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, current_date: Optional[str] = None, min_duration: int = 60, max_duration: int = 90) -> str:
    """Get the system prompt for video generation (Stage 1 - Plan generation). Works for any context: political, business, technology, healthcare, finance, education, etc."""
    
    # Determine AI video rules based on influencer mode
    if influencer_mode:
        gender_text = influencer_gender or "male"
        gender_pronoun = "she" if gender_text == "female" else "he"
        gender_descriptor = "woman" if gender_text == "female" else "man"
        ai_video_rules = f"""## 🎥 AI VIDEO CLIP RULES - INFLUENCER MODE (VERY STRICT)

⚠️ **UP TO 3 AI-generated video clips** in the entire video (some may fail and be replaced with IMAGE_ONLY)

### Influencer Clip Requirements:
* SHOULD have **up to 3 AI_VIDEO clips** (ideally 3, but if generation fails, failover to IMAGE_ONLY is acceptable)
* **ALL AI_VIDEO clips**: MUST be **exactly 8 seconds long** each
* Total influencer screen time: **24 seconds** (8 + 8 + 8 seconds)

### Selecting Which Clips Should Be AI_VIDEO:
* Choose the **3 most emotionally impactful moments** in the narrative
* Ideal for: revelations, accusations, shocking facts, call-to-action
* Distribute influencer clips **throughout the video** (not all at beginning or end)
* Example distribution for 8 clips: Clips 1, 4, 7 could be AI_VIDEO

### Influencer Visual Composition (CREATIVE FREEDOM):
* **LAYOUT OPTIONS** - Choose the BEST layout for each clip's narrative purpose:
  - **Lower portion**: Influencer in lower 30-50% with context visuals above (classic presenter)
  - **Side split**: Influencer on left/right 40% with context on opposite side
  - **Center focus**: Influencer centered with blurred/dark context around edges
  - **Corner overlay**: Influencer in corner (20-30%) with full context behind
* **VARY POSITIONING** across the 3 influencer clips for visual interest
* **STYLE**: Think "news presenter", "TikTok explainer", "reaction video"
* **EXPRESSION**: Influencer must show emotion matching the voiceover text
* **SPECIFY POSITION**: In each prompt, clearly state WHERE the influencer appears
  - Example: "Influencer in bottom-left corner (30% of frame)"
  - Example: "Influencer centered in lower third"
  - Example: "Split screen: influencer on right, context map on left"

### Influencer Prompt Format:
For the **FIRST AI_VIDEO clip**, provide FULL character description + POSITION:
* **CRITICAL**: The influencer must be a {gender_descriptor} (gender: {gender_text})
* **CONTEXT-AWARE APPEARANCE**: Adapt influencer appearance to match the input context:
  * If input mentions India/Indian context → Indian ethnicity, age (25-35), {gender_descriptor}, appropriate attire (professional or traditional based on context)
  * If input mentions USA/American context → American ethnicity, age (25-35), {gender_descriptor}, professional attire
  * If input mentions other countries → Appropriate ethnicity and attire for that country
  * If input is global/unspecified → Diverse/international appearance, professional attire
* Specify: Ethnicity (based on context), age (25-35), {gender_descriptor}, attire (professional or context-appropriate), expression, exact position in frame
* **CRITICAL: NO DUPLICATE HUMANS**: The same person (influencer or any human) must appear ONLY ONCE in the entire image. Never describe the same person appearing in both upper and lower portions, or in split compositions. If you describe a visual in "upper portion" and an influencer in "lower portion", ensure they are DIFFERENT people or the influencer is ONLY in one location.
* Example 1 (lower portion, Indian context): "Dramatic visual of [context] in upper portion. 28-year-old Indian {gender_descriptor}, professional casual attire, dark hair, confident expression, speaking directly to camera in lower portion. **CRITICAL**: Never include text like 'UPPER 55%' or 'LOWER 45%' in the generated image - these are composition instructions, not visual elements. The influencer appears ONLY in the lower portion, NOT in the upper portion. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
* Example 1 (lower portion, Tech context): "Dramatic visual of [tech context] in upper portion. 30-year-old {gender_descriptor}, lab coat or professional tech attire, confident expression, speaking directly to camera in lower portion. **CRITICAL**: Never include text like 'UPPER 55%' or 'LOWER 45%' in the generated image - these are composition instructions, not visual elements. The influencer appears ONLY in the lower portion, NOT in the upper portion. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
* Example 2 (side split): "Split composition. Visual of [context] on the left side. 30-year-old {gender_descriptor}, professional attire (context-appropriate), professional look, speaking to camera on the right side. **CRITICAL**: Never include text like 'LEFT 60%' or 'RIGHT 40%' in the generated image - these are composition instructions, not visual elements. The influencer appears ONLY on the right side, NOT on the left side. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
* Example 3 (corner): "Full context composition showing [visual]. BOTTOM-RIGHT CORNER (25%): 26-year-old {gender_descriptor}, professional attire (context-appropriate), appearing as overlay/presenter. Speaking to camera. The influencer appears ONLY in the bottom-right corner, NOT elsewhere in the image. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."

For **SUBSEQUENT AI_VIDEO clips** (2nd and 3rd), use "reference influencer" + VARY POSITION:
* **VARY the influencer position** across the 3 clips for visual interest!
* **CRITICAL**: Since these clips use nano-banana-pro/edit with reference images, you MUST include this text at the end of EVERY starting_image_prompt: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* This ensures only the influencer's appearance is copied, and all text from the reference image is completely ignored, preventing text artifacts in new clips
* **CRITICAL: NO DUPLICATE HUMANS**: The reference influencer must appear ONLY ONCE in the entire image. Never describe the reference influencer appearing in multiple locations (e.g., both upper and lower portions, or both left and right sides). The influencer should be in ONE location only.
* **Starting Image Prompt Examples** (for image generation - NO voiceover instructions):
  * Example: "Reference influencer speaking to camera on the left side, same appearance. Infographic showing [new context] on the right side. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. **CRITICAL**: Never include text like 'LEFT 35%' or 'RIGHT 65%' in the generated image - these are composition instructions, not visual elements. The reference influencer appears ONLY on the left side, NOT on the right side. no text overlays."
  * Example: "FULL FRAME: dramatic [context visual]. BOTTOM-LEFT CORNER (30%): Reference influencer as overlay, speaking directly to viewer. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. The reference influencer appears ONLY in the bottom-left corner, NOT elsewhere in the image. no text overlays."
* **Clip Prompt** (for video generation - includes voiceover instructions):
  * Example: "Reference influencer speaking to camera on the left side, same appearance. Infographic showing [new context] on the right side. Speaking in {language_name} language (ISO code: {language_code}). Do NOT generate audio in Chinese. The audio must be in {language_name} language only (ISO code: {language_code}). NO distortion of text overlays or signage. All text visible in the starting frame must remain exactly the same throughout the entire clip - same position, same size, same content, no morphing or warping. NOT showing year numbers or decade labels as text unless part of a calendar widget or date picker interface. no text overlays. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."

### What the Influencer is SAYING (AI_VIDEO CLIPS ONLY):
* **ONLY FOR AI_VIDEO INFLUENCER CLIPS** - This word limit does NOT apply to regular IMAGE_ONLY voiceovers
* For AI_VIDEO clips, the influencer SPEAKS the voiceover text on camera
* The voiceover text becomes what the influencer says (lip-synced)
* **CRITICAL**: When including voiceover text in image/video prompts, REMOVE all square bracket expressions like [shocked, voice cracks] - these are ONLY for ElevenLabs TTS, NOT for visual prompts
* **MANDATORY WORD LIMIT FOR AI_VIDEO CLIPS ONLY**: For ALL influencer clips (8 seconds each), the voiceover text that the influencer speaks MUST be **between 14-16 words** (minimum 14 words, maximum 16 words)
* This ensures the text fits within the 8-second clip duration without being trimmed or clipped, and provides enough content for natural speech
* **NOTE**: Regular IMAGE_ONLY clips can have voiceover text of any length - this limit ONLY applies to AI_VIDEO influencer clips
* Count words in the actual speech text (excluding square bracket expressions like [shocked])
* Example: If voiceover is "20 दिसंबर को हाईजैक हुआ [शॉक्ड, वॉइस क्रैक]", the speech text "20 दिसंबर को हाईजैक हुआ" is 4 words - this is TOO SHORT, must be 14-16 words for 8-second clips
* Example prompt ending: "Reference influencer speaking to camera. The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [the voiceover text WITHOUT square brackets, between 14-16 words]. Do NOT make up different words or say something else."

### 🚨 CRITICAL LANGUAGE REQUIREMENT FOR VEO3.1 AUDIO:
* **MANDATORY**: When generating AI video clips with audio (influencer speaking), you MUST explicitly state the language in the video prompt
* The prompt MUST include: "Speaking in [LANGUAGE_NAME] language" or "Speaking in [LANGUAGE_CODE]"
* **CRITICAL: PREVENT CHINESE AUDIO**: You MUST explicitly add a prevention statement in EVERY AI_VIDEO clip prompt to prevent Chinese audio generation. Add this statement: "Do NOT generate audio in Chinese. The audio must be in [LANGUAGE_NAME] language only (ISO code: [LANGUAGE_CODE])."
* **CRITICAL**: When including voiceover text in the prompt, REMOVE all square bracket expressions (like [shocked, voice cracks]) - these are ONLY for ElevenLabs TTS, NOT for visual/video prompts
* **CRITICAL: EXACT SPEECH REQUIREMENT**: The influencer MUST say EXACTLY what is provided in the voiceover text, word-for-word. Add this explicit instruction to EVERY AI_VIDEO clip prompt: "The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR HINDI**: "Influencer speaking to camera in Hindi language (ISO code: hi). Do NOT generate audio in Chinese. The audio must be in Hindi language only (ISO code: hi). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
* **COMPLETE EXAMPLE FOR PUNJABI**: "Influencer speaking to camera in Punjabi language (ISO code: pa). Do NOT generate audio in Chinese. The audio must be in Punjabi language only (ISO code: pa). The influencer must say EXACTLY the following text, word-for-word, without adding, removing, or changing any words: [voiceover text WITHOUT square brackets]. Do NOT make up different words or say something else."
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

        ai_video_count_rule = "* `\"ai_video_clips_used\"` should be **up to 3** (influencer mode) - ideally 3, but failover to IMAGE_ONLY is acceptable if generation fails"
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
    
    return f"""You are a **short-form video generation system** that creates scroll-stopping content for ANY context (political, business, technology, healthcare, finance, education, etc.).

**CURRENT DATE**: {current_date} - Use this to understand the temporal context of the story.

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

You must generate a **45–60 second scroll-stopping video plan**, using **ONLY structured JSON output**.

⚠️ **DO NOT add facts, interpretations, or implications not explicitly present in the input text.**

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

## 🎬 VIDEO STRUCTURE RULES (NON-NEGOTIABLE)

### Duration
* Total video length: **{min_duration}-{max_duration} seconds** (you must decide the number of clips to achieve this target duration)
* **CRITICAL: DURATION-BASED CLIP PLANNING**: 
  * Calculate the total duration based on clip durations (4s, 6s, 8s)
  * Plan the number of clips to reach the target duration range
  * Example: For 30-45 seconds, you might need 6-10 clips (mostly 4-second clips)
  * Example: For 60-90 seconds, you might need 12-18 clips (mix of 4s, 6s, 8s)
  * **YOU decide the number of clips autonomously** to match the desired duration

### Clip Length
* Each clip duration MUST be **exactly one of**:
  * **4 seconds** (PREFERRED for IMAGE_ONLY/SILENT_IMAGE clips - keeps video fast-paced and engaging, use for short messages)
  * **6 seconds** (For IMAGE_ONLY clips when message is longer/bigger and needs more time, OR for AI_VIDEO clips in non-influencer mode)
  * **8 seconds** (For AI_VIDEO clips in influencer mode only)
* ❌ No other durations allowed
* **CRITICAL: FAST-PACED VIDEO REQUIREMENT**: To keep the video engaging and prevent it from feeling slow:
  * **MOST IMAGE_ONLY clips should be 4 seconds** (use for short, punchy messages)
  * **Use 6 seconds for IMAGE_ONLY clips** when the voiceover message is longer and needs more time to be delivered clearly (bigger messages)
  * **Mix of 4s and 6s for IMAGE_ONLY clips** - vary durations based on message length to accommodate different message sizes
  * Only use 8 seconds for AI_VIDEO influencer clips
  * Faster clips = more content = more engaging video, but balance with message clarity
  * Voiceover for 4-second clips: 1 short sentence (6-8 words) - concise and punchy
  * Voiceover for 6-second IMAGE_ONLY clips: 1-2 sentences (10-12 words) - for bigger messages that need more time

### Clip 0 (Opening)
* Must be **SILENT**
* No voiceover
* Scroll-stopping accusation framing
* **🚨 CRITICAL: TEXT OVERLAYS ARE MANDATORY FOR CLIP 0**:
  * Clip 0 MUST ALWAYS include text overlays in the generated image prompt
  * The text overlay sets the overall message/theme for the entire video
  * **MANDATORY**: The prompt for Clip 0 MUST explicitly describe what text overlay to include
  * Example: "Dramatic visual of [context] with bold text overlay stating '[main message/theme]' in [language]"
  * Example: "Visual of [context] with prominent text overlay: '[key message]' displayed prominently"
  * The text overlay should be the main hook or key message that sets the tone for the video
  * **🚨 CRITICAL: NEVER include "no text overlays" in Clip 0 prompts** - text overlays are REQUIRED and MANDATORY
  * **🚨 CRITICAL: The prompt MUST end with the text overlay description, NOT with "no text overlays"**
  * **WRONG EXAMPLE**: "Dramatic visual of [context] with bold text overlay stating '[message]'... no text overlays" ← This will prevent text overlay generation
  * **CORRECT EXAMPLE**: "Dramatic visual of [context] with bold text overlay stating '[message]' in [language]" ← Ends with text overlay description, no "no text overlays"
  * **VERIFICATION**: Before finalizing Clip 0 prompt, check that it does NOT contain "no text overlays" anywhere in the prompt

### Voiceover
* Voiceover must be present in **every clip except Clip 0**
* Voiceover must run continuously through the video
* **CRITICAL**: Voiceover text MUST include emotional expressions in square brackets
* Examples: [shocked, voice cracks slightly], [fearful, slower, tense whisper], [angry, rising intensity], [outraged, voice booms]
* These expressions will be used by the TTS system for emotional delivery

---

{ai_video_rules}

---

## 🖼️ IMAGE_ONLY CLIP - EFFECT HINTS

For IMAGE_ONLY and SILENT_IMAGE clips, provide an `effect_hint` describing the desired visual effect style.
DO NOT specify exact coordinates or detailed effect parameters - those will be determined after image generation.

Effect hints should describe:
* The **mood/energy** (dramatic, subtle, intense, calm)
* The **movement type** (zoom, pan, spotlight, shake)
* The **focus area description** (face, text, center, full image)
* The **narrative purpose** (reveal, emphasize, build tension)

Example effect hints:
* "Slow dramatic zoom into the face, building tension"
* "Ken Burns pan across the scene from left to right"
* "Spotlight highlight on the central text with pulsing darkness"
* "Shake effect for dramatic emphasis"
* "Slow zoom out to reveal the full scene"

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
  * **🚨 CRITICAL: VISUAL DIVERSITY REQUIREMENT FOR IMAGE-BASED CLIPS**:
    * **MANDATORY**: All image-based clips (IMAGE_ONLY and SILENT_IMAGE) MUST have DISTINCT and DIFFERENT visuals
    * **PROBLEM**: If clips have similar visuals, the video looks repetitive, unprofessional, and boring
    * **SOLUTION**: Each image-based clip must have a UNIQUE visual composition, setting, angle, perspective, or focus
    * **REQUIREMENTS**:
      * **Vary visual compositions**: Use different layouts (split screen, full frame, corner overlay, close-up, wide shot, etc.)
      * **Vary settings/locations**: Use different environments, backgrounds, or contexts for each clip
      * **Vary camera angles**: Use different perspectives (close-up, wide shot, overhead, side view, front view, etc.)
      * **Vary visual elements**: Include different objects, people, scenes, or data visualizations in each clip
      * **Vary color schemes**: Use different lighting, color palettes, or moods when appropriate
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
    * **EXAMPLES OF GOOD VISUAL DIVERSITY**:
      * Clip 1: "Close-up of steel price charts on digital display, workers in background"
      * Clip 2: "Wide shot of steel mill warehouse with buyers examining coils"
      * Clip 3: "Split screen: government documents on left, steel import crates on right"
      * Clip 4: "Overhead view of negotiation table with price documents"
      * Clip 5: "Side view of production line with cost charts on wall"
      * Clip 6: "Front view of executives in meeting room with presentation screen"
    * **EXAMPLES OF BAD (TOO SIMILAR)**:
      * ❌ Clip 1: "Steel mill with workers and upward trending chart"
      * ❌ Clip 2: "Steel mill with workers and upward trending chart" (too similar!)
      * ❌ Clip 3: "Steel mill with workers and upward trending chart" (repetitive!)
      * ❌ Clip 4: "Chart showing upward trend" (all charts showing same trend!)
    * **VERIFICATION CHECKLIST**: Before finalizing image prompts for ALL image-based clips, check:
      * ✅ Each IMAGE_ONLY/SILENT_IMAGE clip has a DISTINCT visual composition
      * ✅ No two image-based clips have the same or very similar settings
      * ✅ Visuals vary in composition, angle, focus, or perspective
      * ✅ Charts/data visualizations are varied (not all showing same trend type)
      * ✅ The sequence of visuals creates visual interest and prevents monotony
      * ✅ If multiple clips show charts, they show different chart types, directions, or contexts
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
* **VOICEOVER LENGTH BY CLIP DURATION** (MANDATORY - applies to both ElevenLabs voiceover AND influencer speaking in AI_VIDEO clips):
  * **4-second clips** (IMAGE_ONLY - short messages): 1 short sentence (**6-8 words**) - minimum 6 words, maximum 8 words - concise, punchy, fits perfectly in 4 seconds
  * **6-second clips** (IMAGE_ONLY - bigger messages OR AI_VIDEO non-influencer): 1-2 short sentences (**10-12 words**) - minimum 10 words, maximum 12 words - use for IMAGE_ONLY clips when message is longer and needs more time
  * **8-second clips** (AI_VIDEO influencer only): 1-2 sentences (**14-16 words**) - minimum 14 words, maximum 16 words
  * **IMPORTANT**: When deciding clip duration for IMAGE_ONLY clips, consider the message length:
    * If voiceover is 6-8 words → Use **4 seconds**
    * If voiceover is 10-12 words → Use **6 seconds**
    * This ensures proper pacing and message clarity
* **MUST include emotional expressions in square brackets** for TTS
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
  "video_overview": {{{{
    "total_duration_seconds": 0,
    "total_clips": 0,
    "ai_video_clips_used": 0
  }}}},
  "clips": [
    {{{{
      "clip_number": 0,
      "duration_seconds": 4,
      "clip_type": "SILENT_IMAGE | IMAGE_ONLY | AI_VIDEO",
      "voiceover": "",
      "prompt": "For Clip 0 (SILENT_IMAGE): image prompt with MANDATORY text overlay description (e.g., 'with bold text overlay stating [message]') - DO NOT include 'no text overlays'. For other IMAGE_ONLY clips: image prompt ending with 'no text overlays'. For AI_VIDEO: video clip prompt (with voiceover instructions)",
      "starting_image_prompt": "REQUIRED for AI_VIDEO clips only - image prompt for starting frame (visual description only, NO voiceover text instructions, MUST end with 'no text overlays')",
      "music_group": "",
      "effect_hint": "Description of desired visual effect style and movement",
      "is_influencer_clip": false,
      "failover_image_prompt": "OPTIONAL: For AI_VIDEO influencer clips only - image prompt without influencer for failover",
      "failover_effect_hint": "OPTIONAL: For AI_VIDEO influencer clips only - effect hint for failover image",
      "hook_type": "MANDATORY - Explicitly state which hook is used in this clip. For starting clips (0-1): 'Shock/Surprise', 'Story-Start', 'Confrontation', 'Question', 'Bold Claim', 'Curiosity Gap', or 'Visual Pattern Interrupt'. For middle clips (2 to N-1): 'Myth vs Reality', 'Transformation', 'Authority', 'Relatability', 'Mistake', 'Social Proof', or 'Contrarian'. For ending clip (final): 'CTA', 'Question', 'Time-Bound', 'Transformation Promise', or 'Reflective Statement'. MUST be present in ALL THREE stages."
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
  }}}}
}}}}
```

---

## 📌 FIELD VALIDATION RULES

* `"clip_type"` must be exactly:
  * `SILENT_IMAGE`
  * `IMAGE_ONLY`
  * `AI_VIDEO`
* `"duration_seconds"` must be **4, 6, or 8 only**
  * **4 seconds**: For IMAGE_ONLY/SILENT_IMAGE clips with short messages (6-8 words)
  * **6 seconds**: For IMAGE_ONLY clips with bigger messages (10-12 words) OR for AI_VIDEO clips in non-influencer mode
  * **8 seconds**: For AI_VIDEO clips in influencer mode only
{ai_video_duration_rule}
{ai_video_count_rule}
* `"voiceover"` must be empty for Clip 0
* `"effect_hint"` is REQUIRED for SILENT_IMAGE and IMAGE_ONLY clips
* `"is_influencer_clip"` is true ONLY for AI_VIDEO clips in influencer mode
* `"hook_type"` is **MANDATORY** for ALL clips - explicitly state which hook is used:
  * **Starting clips (Clip 0 or Clip 1)**: Must have one of: 'Shock/Surprise', 'Story-Start', 'Confrontation', 'Question', 'Bold Claim', 'Curiosity Gap', 'Visual Pattern Interrupt'
  * **Middle clips (Clips 2 to N-1)**: Must have at least one clip with: 'Myth vs Reality', 'Transformation', 'Authority', 'Relatability', 'Mistake', 'Social Proof', 'Contrarian'
  * **Ending clip (Final clip)**: Must have one of: 'CTA', 'Question', 'Time-Bound', 'Transformation Promise', 'Reflective Statement'
  * **CRITICAL**: ALL THREE stages (starting, middle, ending) MUST have hook_type specified - never skip any stage

### Music Group Validation:
* Each music group's `"total_duration_seconds"` must be **≤ 20**
* `"clips"` array must list which clip numbers use this music
* **Every clip (including Clip 0)** must belong to exactly one music group
* Clip 0 should typically be in Music_A (first music group) for dramatic opening

---

## ⛔ ABSOLUTE PROHIBITIONS

* ❌ No markdown
* ❌ No explanations
* ❌ No assumptions beyond input text
* ❌ No output outside JSON

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


def analyze_text_and_generate_plan(context_text: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, desired_duration: Optional[str] = None) -> Dict:
    """
    Use Grok-4-latest to analyze text and generate video plan (Stage 1)
    This generates image prompts and effect_hints, NOT detailed effects
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
    
    system_prompt = get_political_video_system_prompt(language_code, language_name, influencer_mode, influencer_gender, current_date, min_duration, max_duration)
    
    # Adjust user prompt based on influencer mode
    if influencer_mode:
        ai_video_instruction = """- UP TO 3 AI_VIDEO clips - influencer speaking to camera (ideally 3, but failover to IMAGE_ONLY is acceptable if generation fails)
- ALL AI_VIDEO clips: 8 seconds each, full influencer character description for first clip + specify position in frame
- Second/Third AI_VIDEO: Use "reference influencer" for consistency
- VARY influencer positioning across clips (lower 30-50%, side split, corner overlay, etc.)
- Specify exact position in each prompt (e.g., "influencer in bottom-left corner 30%")
- CRITICAL: Remove square bracket expressions (like [shocked]) from image/video prompts - they're only for voiceover text
- **CRITICAL WORD LIMIT BY CLIP DURATION** (applies to ALL voiceovers - ElevenLabs AND influencer speaking):
  * **4-second clips**: 6-8 words (minimum 6, maximum 8 words)
  * **6-second clips**: 10-12 words (minimum 10, maximum 12 words)
  * **8-second clips**: 14-16 words (minimum 14, maximum 16 words - for influencer clips)
- CRITICAL for 2nd/3rd clips: MUST include "Only take reference influencer from the reference image for new image generation. Ignore text from reference image." at the end of image prompts (ensures only influencer appearance is copied, all text is ignored)"""
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
  * **Other IMAGE_ONLY clips**: Use `prompt` field only - MUST end with "no text overlays" (text can be embedded in image like signage/banners, but NO text overlays)
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
        print(f"  Total Duration: {video_plan.get('video_overview', {}).get('total_duration_seconds', 0)}s")
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
        "zoom_whip", "heartbeat", "flash", "letterbox", "color_shift",
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
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok for image analysis (auth context expired)...")
            
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
            # Check if it's an auth context expiration error (retryable)
            if ("Auth context expired" in error_str or 
                "grpc_status:13" in error_str or
                "StatusCode.INTERNAL" in error_str) and attempt < max_retries - 1:
                print(f"  ⚠️ Auth context expired (attempt {attempt + 1}/{max_retries}), retrying with fresh connection...")
                continue
            # Check if it's a RESOURCE_EXHAUSTED error (message too large) - don't retry, assign random effects
            elif ("RESOURCE_EXHAUSTED" in error_str or 
                  "grpc_status:8" in error_str or
                  "Sent message larger than max" in error_str or
                  "StatusCode.RESOURCE_EXHAUSTED" in error_str):
                print(f"  ⚠️ Message too large for Grok (RESOURCE_EXHAUSTED) - assigning random effects to all clips...")
                # Break out of retry loop and assign random effects
                response_text = None
                break
            else:
                # Not a retryable error or max retries reached - re-raise
                raise
    
    # If we failed due to RESOURCE_EXHAUSTED, assign random effects and continue
    if last_exception and ("RESOURCE_EXHAUSTED" in str(last_exception) or "Sent message larger than max" in str(last_exception)):
        print(f"  ⚠️ Grok image analysis failed due to message size limit - assigning random effects to all clips...")
        clip_effects = {}
        for clip_info in image_clips:
            clip_num = clip_info['clip_number']
            duration = clip_info['duration']
            clip_effects[clip_num] = generate_random_effect(clip_num, duration)
            print(f"  ✅ Assigned random effect to clip {clip_num}")
        return clip_effects
    
    # If no response_text and not RESOURCE_EXHAUSTED, re-raise the exception
    if last_exception and not response_text:
        raise last_exception
    
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
    # This will also add "no text overlays" for all images
    prompt = clean_prompt_for_visual(prompt, is_starting_frame=is_starting_frame)
    
    # Double-check "no text overlays" is present (for all images)
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


def generate_voiceover_with_timestamps(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, max_retries: int = 2) -> Tuple[Optional[str], List[Dict]]:
    """
    Generate voiceover using ElevenLabs v3 TTS with word timestamps and retry logic.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        max_retries: Maximum number of retry attempts (default: 2)
    
    Returns: (audio_path, word_timestamps) or (None, [])
    """
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
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
            print(f"\n  🎙️ Generating voiceover with timestamps ({language_name})...")
        
        print(f"     Text: {text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        
        try:
            result = fal_client.subscribe(
                "fal-ai/elevenlabs/tts/eleven-v3",
                arguments={
                    "text": text,
                    "voice": voice_id,
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "speed": 1,
                    "language_code": language_code,
                    "timestamps": True  # Request timestamps
                },
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
    voice_id: Optional[str] = None
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
        voice_id=voice_id
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

def generate_voiceover(text: str, output_path: str, language_code: str = "hi", voice_id: Optional[str] = None, max_retries: int = 2) -> Tuple[Optional[str], float]:
    """
    Generate voiceover using ElevenLabs v3 TTS with retry logic
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code (default: "hi")
        voice_id: ElevenLabs voice ID (default: uses ELEVENLABS_VOICE_ID_MALE)
        max_retries: Maximum number of retry attempts (default: 2)
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    if voice_id is None:
        voice_id = ELEVENLABS_VOICE_ID_MALE
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
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
            print(f"\n  🎙️ Generating voiceover with ElevenLabs v3 ({language_name})...")
        
        print(f"     Text: {text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        
        try:
            result = fal_client.subscribe(
                "fal-ai/elevenlabs/tts/eleven-v3",
                arguments={
                    "text": text,
                    "voice": voice_id,
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "speed": 1,
                    "language_code": language_code,
                    "timestamps": False
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
    voice_id: Optional[str] = None
) -> Dict[int, Dict]:
    """
    Generate individual voiceover for each clip
    Returns: Dict mapping clip_number -> {path, duration}
    """
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    print(f"\n  Generating voiceover for {len(clip_voiceovers)} clips in {language_name}...")
    
    voiceover_data = {}
    
    for clip_info in clip_voiceovers:
        clip_num = clip_info['clip_number']
        text = clip_info['voiceover_text']
        
        if not text or not text.strip():
            continue
        
        output_path = os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3")
        path, duration = generate_voiceover(text, output_path, language_code, voice_id)
        
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
    print(f"  Voiceovers: {len(voiceover_files)} clips have voiceover")
    print(f"  Music Groups: {len(music_files)}")
    
    try:
        # Load all video clips and calculate start times
        video_clips = []
        clip_start_times = {}
        current_time = 0
        
        for i, clip_path in enumerate(clip_paths):
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                video_clips.append(clip)
                clip_start_times[i] = current_time
                
                # For IMAGE_ONLY clips with separate voiceover, use voiceover duration as authoritative
                # The clip should already be extended to match voiceover during creation
                if i in voiceover_files and not voiceover_files[i].get('embedded', False):
                    # IMAGE_ONLY clip - use voiceover duration (clip should match)
                    vo_duration = voiceover_files[i].get('duration', clip.duration)
                    # Use the longer of clip duration or voiceover duration
                    final_duration = max(clip.duration, vo_duration)
                    clip_durations[i] = final_duration
                    current_time += final_duration
                    if final_duration > clip.duration:
                        print(f"  Loaded clip {i}: {clip.duration}s → extended to {final_duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                    else:
                        print(f"  Loaded clip {i}: {clip.duration}s (voiceover: {vo_duration:.2f}s) (starts at {clip_start_times[i]}s)")
                elif i in voiceover_files and voiceover_files[i].get('embedded', False):
                    # INFLUENCER clip with embedded audio - use actual video duration
                    # For accepted clips (>8s, English), actual_clip_durations was updated to actual video duration
                    # Use the actual video duration from the clip file itself (most authoritative)
                    actual_video_duration = clip.duration
                    # Update clip_durations to match actual video duration (ensures consistency)
                    clip_durations[i] = actual_video_duration
                    current_time += actual_video_duration
                    print(f"  Loaded clip {i} (influencer): {actual_video_duration:.2f}s (actual video duration, starts at {clip_start_times[i]}s)")
                else:
                    # AI_VIDEO or other clip - use clip_durations dict or actual duration
                    clip_duration = clip_durations.get(i, clip.duration)
                    current_time += clip_duration
                    print(f"  Loaded clip {i}: {clip_duration:.2f}s (starts at {clip_start_times[i]}s)")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Calculate clip start times for logging
        print(f"\n  Clip timing:")
        for clip_num, start_time in clip_start_times.items():
            music_group = clip_music_mapping.get(clip_num, "None")
            print(f"    Clip {clip_num}: starts at {start_time}s, music: {music_group}")
        
        # Build audio layers
        audio_clips = []
        
        # Extract audio from influencer clips (embedded voiceover) BEFORE concatenation
        # This preserves the audio timing correctly
        print(f"\n  Extracting audio from influencer clips:")
        for clip_num, vo_info in voiceover_files.items():
            if vo_info.get('embedded', False):
                # Extract audio from the video clip itself
                if clip_num < len(video_clips):
                    clip = video_clips[clip_num]
                    if clip.audio is not None:
                        start_time = clip_start_times.get(clip_num, 0)
                        # Use actual_clip_durations (which may be > 8s for accepted English clips)
                        # This ensures audio matches video duration when clip was accepted
                        clip_duration = clip_durations.get(clip_num, clip.audio.duration)
                        actual_video_duration = clip.duration
                        
                        # CRITICAL: For influencer clips that were accepted (English + CLI language English),
                        # use the actual video duration, not the planned duration
                        # Only trim if audio is longer than video (shouldn't happen, but safety check)
                        if clip.audio.duration > actual_video_duration:
                            # Audio is longer than video - trim to video duration
                            clip_audio = clip.audio.subclip(0, actual_video_duration)
                            print(f"    ⚠️ Trimmed embedded audio from {clip.audio.duration:.2f}s to {actual_video_duration:.2f}s (audio longer than video)")
                        elif clip.audio.duration < actual_video_duration:
                            # Audio is shorter than video - this shouldn't happen, but use audio duration
                            clip_audio = clip.audio
                            print(f"    ⚠️ Audio ({clip.audio.duration:.2f}s) shorter than video ({actual_video_duration:.2f}s) - using audio duration")
                        else:
                            # Audio matches video duration - use as is (this is the correct case for accepted clips)
                            clip_audio = clip.audio
                        
                        # Set start time
                        clip_audio = clip_audio.set_start(start_time)
                        
                        # Normalize voiceover volume for consistency
                        print(f"    Clip {clip_num}: Normalizing embedded voiceover volume...")
                        clip_audio = normalize_audio_clip(clip_audio, target_rms_db=-20.0)
                        
                        audio_clips.append(clip_audio)
                        print(f"    Clip {clip_num}: extracted embedded voiceover ({clip_audio.duration:.2f}s, starts at {start_time}s, ends at {start_time + clip_audio.duration:.2f}s)")
                    else:
                        print(f"    Clip {clip_num}: ⚠️ No audio found in influencer clip video")
        
        # Remove audio from video clips before concatenation (we'll add it back in the composite)
        # This prevents audio duplication
        # Also resize all clips to OUTPUT_SIZE to prevent black borders
        # CRITICAL: Ensure clips match their planned durations (especially for accepted influencer clips >8s)
        video_clips_no_audio = []
        for i, clip in enumerate(video_clips):
            # Resize clip to target resolution to prevent black borders
            clip_size = clip.size
            if clip_size != OUTPUT_SIZE:
                print(f"  Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                clip = clip.resize(OUTPUT_SIZE)
            
            # CRITICAL: For influencer clips that were accepted (>8s, English),
            # clip_durations[i] should already be set to the actual video duration
            # Use the actual video duration from the clip file itself (most authoritative)
            actual_clip_duration = clip.duration
            planned_duration = clip_durations.get(i, actual_clip_duration)
            
            # For influencer clips with embedded audio, always use actual video duration
            # This ensures video and audio stay in sync for accepted clips (>8s, English)
            if i in voiceover_files and voiceover_files[i].get('embedded', False):
                # Use actual video duration (don't trim)
                clip_durations[i] = actual_clip_duration
                # Clip should already be the correct duration, no trimming needed
            elif actual_clip_duration != planned_duration:
                # For other clips, if duration doesn't match, update clip_durations
                if actual_clip_duration > planned_duration:
                    # Clip is longer than planned - trim to planned duration
                    clip = clip.subclip(0, planned_duration)
                    print(f"  ⚠️ Trimmed clip {i} from {actual_clip_duration:.2f}s to {planned_duration:.2f}s")
                else:
                    # Clip is shorter than planned - use actual duration
                    clip_durations[i] = actual_clip_duration
                    print(f"  ⚠️ Clip {i} duration ({actual_clip_duration:.2f}s) shorter than planned ({planned_duration:.2f}s) - using actual duration")
            
            if i in voiceover_files and voiceover_files[i].get('embedded', False):
                # Remove audio from influencer clips (we've already extracted it)
                video_clips_no_audio.append(clip.set_audio(None))
            else:
                video_clips_no_audio.append(clip)
        
        # Concatenate video clips (without audio from influencer clips)
        final_video = concatenate_videoclips(video_clips_no_audio, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
        # Add per-clip voiceovers at their correct start times (non-embedded)
        print(f"\n  Adding separate voiceover files:")
        for clip_num, vo_info in voiceover_files.items():
            # Skip if voiceover is embedded in video (already extracted above)
            if vo_info.get('embedded', False):
                continue
                
            vo_path = vo_info.get('path')
            if vo_path and os.path.exists(vo_path):
                voiceover = AudioFileClip(vo_path)
                start_time = clip_start_times.get(clip_num, 0)
                clip_duration = clip_durations.get(clip_num, voiceover.duration)
                
                # CRITICAL: For IMAGE_ONLY clips, NEVER trim voiceover - extend clip to match voiceover instead
                # The image clip should already be extended to match voiceover duration during creation
                # If voiceover is longer than clip_duration, use voiceover duration as authoritative
                if voiceover.duration > clip_duration:
                    # Voiceover is longer - use voiceover duration (clip should already be extended)
                    print(f"    ℹ️ Clip {clip_num}: Voiceover ({voiceover.duration:.2f}s) longer than clip_duration ({clip_duration:.2f}s)")
                    print(f"       Using voiceover duration - image clip should already be extended to match")
                    clip_duration = voiceover.duration
                    # Update clip_durations for accurate timing
                    clip_durations[clip_num] = clip_duration
                
                # DO NOT trim voiceover - the clip duration should match voiceover duration
                voiceover = voiceover.set_start(start_time)
                
                # Normalize voiceover volume for consistency
                print(f"    Clip {clip_num}: Normalizing voiceover volume...")
                voiceover = normalize_audio_clip(voiceover, target_rms_db=-20.0)
                
                audio_clips.append(voiceover)
                print(f"    Clip {clip_num} voiceover: {voiceover.duration:.2f}s (starts at {start_time}s, ends at {start_time + voiceover.duration:.2f}s)")
        
        # Add music for each group at correct time positions
        for group_name, music_info in music_files.items():
            music_path = music_info.get('path')
            group_clips = music_info.get('clips', [])
            
            if music_path and os.path.exists(music_path) and group_clips:
                music = AudioFileClip(music_path)
                
                # Find the start time for this music group (first clip in group)
                first_clip = min(group_clips)
                music_start_time = clip_start_times.get(first_clip, 0)
                
                # Calculate total duration needed for this group
                group_duration = sum(clip_durations.get(c, 4) for c in group_clips)
                
                # Trim or extend music to match group duration
                if music.duration < group_duration:
                    # Loop music if shorter
                    loops_needed = int(group_duration / music.duration) + 1
                    music_parts = [music] * loops_needed
                    music = concatenate_audioclips(music_parts)
                
                music = music.subclip(0, min(music.duration, group_duration))
                
                # Set start time and lower volume
                music = music.set_start(music_start_time)
                music = music.volumex(0.143)  # Lower volume for background (7:1 ratio with voiceover at 1.0)
                
                audio_clips.append(music)
                print(f"  Added music '{group_name}': {music.duration}s (starts at {music_start_time}s)")
        
        # Combine all audio
        if audio_clips:
            final_audio = CompositeAudioClip(audio_clips)
            final_video = final_video.set_audio(final_audio)
            print(f"  Combined {len(audio_clips)} audio tracks")
        
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
                video_clips.append(clip)
                print(f"  Loaded clip {i}: {clip.duration}s")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Concatenate video clips
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
            audio_clips.append(voiceover)
            print(f"  Added voiceover: {voiceover.duration}s")
        
        # Add background music
        if music_path and os.path.exists(music_path):
            music = AudioFileClip(music_path)
            # Trim or loop music to match video duration
            if music.duration < final_video.duration:
                loops_needed = int(final_video.duration / music.duration) + 1
                music_clips_list = [music] * loops_needed
                music = concatenate_audioclips(music_clips_list)
            music = music.subclip(0, final_video.duration)
            # Lower music volume when voiceover is present
            if voiceover_path:
                music = music.volumex(0.143)  # Lower volume for background (7:1 ratio with voiceover at 1.0)
            audio_clips.append(music)
            print(f"  Added music: {music.duration}s")
        
        # Combine audio
        if audio_clips:
            if len(audio_clips) > 1:
                final_audio = CompositeAudioClip(audio_clips)
            else:
                final_audio = audio_clips[0]
            final_video = final_video.set_audio(final_audio)
        
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
        
        if os.path.exists(output_path):
            print(f"  ✅ Captions applied: {combo['name']}")
            return output_path
        else:
            print(f"  ⚠️ Warning: Captioned video not created, using original")
            return video_path
            
    except Exception as e:
        print(f"  ⚠️ Warning: Failed to apply captions: {e}")
        import traceback
        print(traceback.format_exc())
        return video_path


def generate_political_video(input_file: str, output_path: str, language_code: str = "hi", influencer_mode: bool = False, influencer_gender: Optional[str] = None, user_instruction: Optional[str] = None, voice_id: Optional[str] = None, captions: Optional[str] = None, transliterate: bool = False, desired_duration: Optional[str] = None, ai_video_model: str = "veo3.1") -> str:
    """Main pipeline to generate political video from input document
    
    Args:
        input_file: Path to input document
        output_path: Path to output video
        language_code: Language code for voiceover
        influencer_mode: Whether to enable influencer mode
        influencer_gender: Gender of influencer ("male" or "female"), only used if influencer_mode is True
        user_instruction: Optional user instruction to guide prompt generation
        ai_video_model: AI video model to use for influencer clips ("veo3.1" or "seedance1.5")
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
        
        video_plan = analyze_text_and_generate_plan(context_text, language_code, influencer_mode, influencer_gender, user_instruction, desired_duration)
        
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
            voiceover_files = generate_voiceover_per_clip(clip_voiceover_texts, temp_dir, language_code, voice_id)
        
        print(f"\n  ✅ Generated voiceovers for {len(voiceover_files)} non-AI clips")
        if influencer_mode:
            print(f"  📝 {len(influencer_clip_voiceovers)} AI_VIDEO clips will have voice post-processed")
        
        # Step 4: Generate all images
        print(f"\n{'='*60}")
        print(f"🖼️ STEP 4: IMAGE GENERATION")
        print(f"{'='*60}")
        
        clip_data = []  # Store clip info for later processing
        image_clips_for_analysis = []  # IMAGE_ONLY clips for Stage 2 effect analysis
        
        # Track first influencer image for consistency
        first_influencer_image_s3_url = None
        first_influencer_clip_found = False
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            clip_type = clip.get('clip_type', 'IMAGE_ONLY')
            planned_duration = clip.get('duration_seconds', AI_VIDEO_DEFAULT_DURATION if clip_type == "AI_VIDEO" else 4)
            # For AI_VIDEO clips: use starting_image_prompt for image generation, prompt for video generation
            # For other clips: use prompt for image generation
            starting_image_prompt = clip.get('starting_image_prompt', '')  # For AI_VIDEO clips only
            prompt = clip.get('prompt', '')  # Clip prompt (for video) or image prompt (for IMAGE_ONLY)
            voiceover = clip.get('voiceover', '')
            effect_hint = clip.get('effect_hint', 'Create engaging movement')
            is_influencer_clip = clip.get('is_influencer_clip', False) or (influencer_mode and clip_type == "AI_VIDEO")
            
            # Determine actual duration based on voiceover
            # For AI_VIDEO clips in influencer mode, use planned duration
            # (voiceover timing will be aligned to video later)
            vo_info = voiceover_files.get(clip_num, {})
            vo_duration = vo_info.get('duration', 0)
            
            if clip_type == "AI_VIDEO" and influencer_mode:
                # AI_VIDEO in influencer mode uses fixed duration
                actual_duration = planned_duration
            elif vo_duration > 0:
                # Add 0.5s buffer after voiceover ends
                actual_duration = max(planned_duration, vo_duration + 0.5)
            else:
                actual_duration = planned_duration
            
            print(f"\n  --- Clip {clip_num} ({clip_type}{'*INFLUENCER*' if is_influencer_clip else ''}) ---")
            print(f"      Planned: {planned_duration}s, Voiceover: {vo_duration:.2f}s, Actual: {actual_duration:.2f}s")
            
            # Generate image for all clip types
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
                if first_influencer_clip_found and first_influencer_image_s3_url:
                    print(f"      Using nano-banana-pro/edit with reference influencer (9:16 aspect ratio)")
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
                'prompt': prompt,  # Clip prompt (for video generation) or image prompt (for IMAGE_ONLY)
                'starting_image_prompt': starting_image_prompt,  # Starting frame image prompt (for AI_VIDEO clips only)
                'voiceover': voiceover,
                'effect_hint': effect_hint,
                'image_path': image_result,
                'image_s3_url': image_s3_url,
                'is_influencer_clip': is_influencer_clip,
                # Include failover fields for AI_VIDEO influencer clips
                'failover_image_prompt': clip.get('failover_image_prompt', ''),
                'failover_effect_hint': clip.get('failover_effect_hint', '')
            }
            clip_data.append(clip_info)
            
            # Collect IMAGE_ONLY/SILENT_IMAGE clips for Stage 2 analysis
            if clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"] and image_result:
                image_clips_for_analysis.append({
                    'clip_number': clip_num,
                    'image_path': image_result,
                    'duration': actual_duration,  # Use actual duration
                    'effect_hint': effect_hint,
                    'voiceover': voiceover
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
            print(f"  ⚠️ No IMAGE_ONLY clips to analyze")
        
        # Step 5: Create video clips with adjusted durations
        print(f"\n{'='*60}")
        print(f"🎬 STEP 5: VIDEO CLIP CREATION (Duration matched to voiceover)")
        print(f"{'='*60}")
        
        clip_paths = []
        actual_clip_durations = {}  # Store actual durations for stitching
        
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
            
            if not image_path:
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
                if ai_video_model == "seedance1.5":
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
                    model_name = "Seedance v1.5 Pro" if ai_video_model == "seedance1.5" else "Veo3.1"
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
                                    voice_id
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
                    # Apply captions if requested
                    if captions and video_result:
                        print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                        # For AI_VIDEO clips, audio is embedded in video, so no separate audio_path needed
                        language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
                        captioned_path = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=None, transliterate=transliterate, language_name=language_name)
                        if captioned_path and captioned_path != video_result:
                            # Replace original with captioned version
                            if os.path.exists(video_result):
                                try:
                                    os.remove(video_result)
                                except:
                                    pass
                            video_result = captioned_path
                    clip_paths.append(video_result)
                elif ai_video_failed:
                    # Failover handled above - clip_type was changed to IMAGE_ONLY
                    # Continue to IMAGE_ONLY section below
                    pass
                else:
                    clip_paths.append(None)
            
            # Handle IMAGE_ONLY clips (including failover cases)
            # Check if this is an IMAGE_ONLY clip (original or failover)
            is_image_only_clip = clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]
            
            if is_image_only_clip:
                video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
                
                # Use effects from Stage 2 image analysis, or default if not available
                # For Clip 0 (SILENT_IMAGE), always use static (no effects) to preserve text visibility
                if clip_num == 0:
                    print(f"  📌 Clip 0 (SILENT_IMAGE): Using static image (no effects) to preserve text visibility")
                    effects = []
                else:
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
                    captioned_path = apply_captions_to_clip(video_result, captions, language_code, temp_dir, audio_path=audio_path, transliterate=transliterate, language_name=language_name)
                    if captioned_path and captioned_path != video_result:
                        # Replace original with captioned version
                        if os.path.exists(video_result):
                            try:
                                os.remove(video_result)
                            except:
                                pass
                        video_result = captioned_path
                
                clip_paths.append(video_result)
        
        # Filter out None values
        valid_clip_paths = [p for p in clip_paths if p]
        
        if not valid_clip_paths:
            raise ValueError("No clips were generated successfully")
        
        # Step 6: Generate background music for each music group
        print(f"\n{'='*60}")
        print(f"🎵 STEP 6: MUSIC GENERATION (Per Music Group)")
        print(f"{'='*60}")
        
        music_groups = video_plan.get('music_groups', {})
        music_files = {}  # group_name -> file_path
        
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
        
        # Save raw assets (voiceover files, music files)
        raw_assets_dir = os.path.join(assets_dir, "raw_assets")
        os.makedirs(raw_assets_dir, exist_ok=True)
        
        # Save voiceover files
        print(f"\n  Saving raw voiceover files...")
        for clip_num, vo_info in voiceover_files.items():
            if not vo_info.get('embedded', False):
                vo_path = vo_info.get('path')
                if vo_path and os.path.exists(vo_path):
                    import shutil
                    dest_path = os.path.join(raw_assets_dir, f"voiceover_clip_{clip_num}.mp3")
                    shutil.copy2(vo_path, dest_path)
                    print(f"    ✅ Saved: voiceover_clip_{clip_num}.mp3")
        
        # Save music files (grouped music)
        print(f"\n  Saving raw music files...")
        for group_name, music_info in music_files.items():
            music_path = music_info.get('path')
            if music_path and os.path.exists(music_path):
                import shutil
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
                
                audio_clips = []
                
                # Add voiceover (if not embedded)
                if clip_num in voiceover_files and not voiceover_files[clip_num].get('embedded', False):
                    vo_path = voiceover_files[clip_num].get('path')
                    if vo_path and os.path.exists(vo_path):
                        voiceover = AudioFileClip(vo_path)
                        # For IMAGE_ONLY clips, don't trim - use full voiceover
                        # Clip should already be extended to match voiceover
                        if voiceover.duration > clip_duration:
                            # Use voiceover duration as authoritative for IMAGE_ONLY clips
                            if clip_type in ["IMAGE_ONLY", "SILENT_IMAGE"]:
                                clip_duration = voiceover.duration
                                if video_clip.duration < clip_duration:
                                    # Extend video by looping if needed
                                    loops_needed = int(clip_duration / video_clip.duration) + 1
                                    video_parts = [video_clip] * loops_needed
                                    video_clip = concatenate_videoclips(video_parts)
                                    video_clip = video_clip.subclip(0, clip_duration)
                            else:
                                voiceover = voiceover.subclip(0, clip_duration)
                        voiceover = voiceover.volumex(1.0)
                        audio_clips.append(voiceover)
                
                # Add embedded audio (for influencer clips)
                if clip_num in voiceover_files and voiceover_files[clip_num].get('embedded', False):
                    if video_clip.audio is not None:
                        embedded_audio = video_clip.audio
                        if embedded_audio.duration > clip_duration:
                            embedded_audio = embedded_audio.subclip(0, clip_duration)
                        embedded_audio = embedded_audio.volumex(1.0)
                        audio_clips.append(embedded_audio)
                
                # Add background music (portion for this clip from music group)
                music_group = clip_music_mapping.get(clip_num)
                if music_group and music_group in music_files:
                    music_info = music_files[music_group]
                    music_path = music_info.get('path')
                    group_clips = music_info.get('clips', [])
                    
                    if music_path and os.path.exists(music_path) and clip_num in group_clips:
                        music = AudioFileClip(music_path)
                        
                        # Calculate start position in music for this clip
                        clip_index_in_group = group_clips.index(clip_num)
                        music_start = sum(actual_clip_durations.get(c, 4) for c in group_clips[:clip_index_in_group])
                        
                        # Extract this clip's portion of music
                        music_end = music_start + clip_duration
                        if music_start < music.duration:
                            if music_end > music.duration:
                                # Need to loop music
                                loops_needed = int(music_end / music.duration) + 1
                                music_parts = [music] * loops_needed
                                music = concatenate_audioclips(music_parts)
                            music = music.subclip(music_start, min(music_end, music.duration))
                            music = music.volumex(0.143)  # Lower volume for background (7:1 ratio with voiceover at 1.0)
                            audio_clips.append(music)
                
                # Combine audio
                if audio_clips:
                    if len(audio_clips) > 1:
                        final_audio = CompositeAudioClip(audio_clips)
                    else:
                        final_audio = audio_clips[0]
                    video_clip = video_clip.set_audio(final_audio)
                else:
                    # No audio, remove existing audio
                    video_clip = video_clip.set_audio(None)
                
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
                
                # Save clip metadata
                metadata_path = os.path.join(clip_folder, f"clip_{clip_num}_metadata.json")
                with open(metadata_path, 'w') as f:
                    json.dump({
                        'clip_number': clip_num,
                        'clip_type': clip_type,
                        'is_influencer_clip': is_influencer_clip,
                        'duration': clip_duration,
                        'music_group': music_group,
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
        print(f"     - {assets_dir}/raw_assets/ (voiceover files, music files, music group info)")
        print(f"     - {assets_dir}/clip_*/ (complete clip assets with video + audio)")
        
        # Step 7: Stitch everything together with segmented music
        print(f"\n{'='*60}")
        print(f"🎬 STEP 7: VIDEO STITCHING")
        print(f"{'='*60}")
        
        final_video = stitch_video_clips_with_music_groups(
            clip_paths=valid_clip_paths,
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
        choices=["veo3.1", "seedance1.5"],
        default="veo3.1",
        help="AI video model to use for influencer clips. Options: veo3.1 (default), seedance1.5 (ByteDance Seedance v1.5 Pro). Only applies when --influencer is enabled."
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
    if args.influencer:
        print(f"👤 Influencer Mode: ENABLED (3 AI clips: 8s + 6s + 6s = 20 seconds total)")
        print(f"   Gender: {args.gender}")
    
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
        ai_video_model=args.ai_video_model  # Pass AI video model selection
    )
    
    if result:
        print(f"\n✅ Success! Video saved to: {result}")
        sys.exit(0)
    else:
        print(f"\n❌ Failed to generate video")
        sys.exit(1)


if __name__ == "__main__":
    main()

