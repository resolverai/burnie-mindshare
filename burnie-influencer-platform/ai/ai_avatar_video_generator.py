"""
AI Avatar Video Generator
Generates fully AI-generated UGC/influencer-style videos with character and voice consistency.

Uses OmniHuman 1.5 for lip-synced avatar videos with ElevenLabs v3 for consistent voiceover.

🚀 KEY ADVANTAGE: FLEXIBLE VOICEOVER LENGTH
Unlike models that require fixed clip durations (4s, 6s, 8s), OmniHuman 1.5 automatically
matches video duration to audio length. This means:
  - Voiceovers can be ANY length (5s, 8s, 12s, 15s, 20s, etc.)
  - More natural, engaging speech without arbitrary time constraints
  - Grok has full creative freedom to write compelling content

Character Consistency:
  - First clip: nano-banana-pro with full character description
  - Subsequent clips: nano-banana-pro/edit with reference image

Voice Consistency:
  - Single ElevenLabs voice ID used across all clips

Usage:
    python ai_avatar_video_generator.py --input script.pdf --reference-image influencer.png --voiceid <voice_id> --output video.mp4
    python ai_avatar_video_generator.py -i script.txt -r avatar.jpg -v <voice_id> -o output.mp4 --language hi

Requirements:
    pip install pypdf python-docx fal-client moviepy pillow numpy xai-sdk boto3 python-dotenv librosa soundfile openai
"""

import os
import sys
import json
import argparse
import re
import uuid
import tempfile
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

# Configure fal_client with API key
fal_api_key = os.getenv("FAL_API_KEY")

# OpenAI API key for Whisper transcription and transliteration
openai_api_key = os.getenv("OPENAI_API_KEY")

# AWS credentials for S3 uploads (presigned URLs for images/videos/audio)
aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
aws_s3_bucket_name = os.getenv("S3_BUCKET_NAME")
aws_region = os.getenv("AWS_REGION", "ap-south-1")

if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Import video caption functionality
from video_captions import VideoCaptionStyler, COMBINATIONS, find_combination

# ============================================
# CONFIGURATION
# ============================================

OUTPUT_ASPECT_RATIO = "9:16"
OUTPUT_SIZE = (1080, 1920)
FPS = 30

# Default ElevenLabs voice ID (can be overridden via CLI)
DEFAULT_VOICE_ID = "RpiHVNPKGBg7UmgmrKrN"

# Default language
DEFAULT_LANGUAGE = "hi"

# Supported languages (ISO 639-1 codes)
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
# S3 HELPER FOR PRESIGNED URLs
# ============================================

class S3Helper:
    """Helper class for uploading files to S3 and getting presigned URLs"""
    
    def __init__(self, project_name: str = "ai_avatar_video"):
        """Initialize S3 helper with AWS credentials from python-ai-backend/.env"""
        self.bucket_name = aws_s3_bucket_name
        self.region = aws_region
        self.project_name = project_name
        
        if not self.bucket_name:
            print(f"  ⚠️ Warning: S3_BUCKET_NAME not set in python-ai-backend/.env")
        
        if not aws_access_key_id or not aws_secret_access_key:
            print(f"  ⚠️ Warning: AWS credentials not set in python-ai-backend/.env")
        
        try:
            self.s3_client = boto3.client(
                's3',
                region_name=self.region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key
            )
            
            if self.bucket_name:
                try:
                    self.s3_client.head_bucket(Bucket=self.bucket_name)
                    print(f"  ✅ S3 connection verified for bucket: {self.bucket_name}")
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                    if error_code == '404':
                        print(f"  ❌ S3 bucket not found: {self.bucket_name}")
                    elif error_code == '403':
                        print(f"  ❌ Access denied to S3 bucket: {self.bucket_name}")
                    else:
                        print(f"  ⚠️ S3 bucket check failed: {e}")
        except Exception as e:
            print(f"  ⚠️ Failed to initialize S3 client: {e}")
            self.s3_client = None
        
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    def upload_file(self, local_path: str, content_type: str = "image", file_type: str = "img") -> Optional[str]:
        """
        Upload file to S3 and get presigned URL.
        
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
            file_extension = os.path.splitext(local_path)[1]
            unique_id = uuid.uuid4().hex[:8]
            s3_key = f"{self.project_name}/{self.timestamp}/{file_type}/{unique_id}{file_extension}"
            
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
            
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                s3_key,
                ExtraArgs={
                    'ContentType': mime_type,
                    'CacheControl': 'max-age=31536000'
                }
            )
            
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
            else:
                print(f"  ❌ S3 upload failed: {e}")
            return None
        except Exception as e:
            print(f"  ❌ S3 upload error: {e}")
            import traceback
            print(traceback.format_exc())
            return None


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
# GROK INTEGRATION FOR AVATAR VIDEO PLAN
# ============================================

def get_avatar_video_system_prompt(
    language_code: str = "hi",
    language_name: str = "Hindi",
    current_date: Optional[str] = None,
    min_duration: int = 30,
    max_duration: int = 60,
    voiceover_emotions: bool = True,
    split_proportion: float = 0.3
) -> str:
    """
    Get the system prompt for avatar video generation.
    Generates prompts for OmniHuman 1.5 lip-synced avatar videos.
    
    Args:
        voiceover_emotions: Whether to include emotional expressions in voiceover text
        split_proportion: Proportion of clips that should have split compositions with B-roll (0.0-1.0)
    """
    
    if current_date is None:
        current_date = datetime.now().strftime("%B %d, %Y")
    
    # Calculate split proportion display values
    split_pct = int(split_proportion * 100)
    remaining_pct = 100 - split_pct
    # Example calculation for 10 clips
    split_count_example = f"{int(10 * split_proportion)} clips"
    
    # Voiceover emotions instructions - conditional based on flag
    if voiceover_emotions:
        voiceover_emotions_instructions = """* **MUST include emotional expressions in square brackets** for TTS
* Examples: [excited, energetic], [thoughtful, slower], [friendly, warm], [serious, measured]

### Emotional Expression Guidelines:
* Match expression to content meaning
* Use varied expressions across clips
* Common expressions: [excited], [friendly], [curious], [confident], [warm], [thoughtful], [enthusiastic], [sincere]
* These expressions make the voice feel natural and human (not monotonous)"""
        voiceover_guideline_short = "* Include emotional expressions [excited], [thoughtful], [serious]"
        voiceover_schema_example = f"Complete thought/message in {language_name} with [emotional expression]. ONE FULL MESSAGE - never break across clips."
        voiceover_content_rule = '* `"voiceover"` must include emotional expression in [brackets]'
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
        voiceover_guideline_short = "* Write natural, conversational text (NO square brackets)"
        voiceover_schema_example = f"Complete thought/message in {language_name}. ONE FULL MESSAGE - never break across clips. NO square brackets."
        voiceover_content_rule = '* `"voiceover"` must be PLAIN TEXT - NO square bracket expressions'
    
    return f"""You are a **short-form UGC/influencer video generation system** that creates scroll-stopping avatar videos for ANY context (product reviews, tutorials, announcements, storytelling, marketing, etc.).

**CURRENT DATE**: {current_date}

You receive **two inputs**:
1. A **TEXT BLOCK** extracted from a PDF / DOC / TXT file containing the script/content.
2. A **USER INSTRUCTION** providing specific guidance on how to create the video.

**YOUR TASK**: Generate a complete video plan for an AI avatar/influencer speaking to camera.

---

## 🎯 KEY CONCEPT: AI AVATAR VIDEO

This video features a **single AI-generated influencer/avatar** speaking directly to camera throughout.
- The same person appears in ALL clips (character consistency is maintained externally)
- The person SPEAKS the voiceover text (lip-synced via OmniHuman 1.5)
- Focus on creating engaging, scroll-stopping content

---

## 🔐 INPUT & CONTENT RULES

1. All **voiceover narration** must be:
   * Based on the input script text
   * Adapted for spoken delivery (natural, conversational)

2. You may:
   * Reorder content for better narrative flow
   * Simplify language for spoken delivery
   * Add emotional expressions for TTS

3. You may NOT:
   * Add facts not present in the input
   * Change the core message or intent

---

## 📖 ESSENCE CAPTURE & NARRATIVE STORYTELLING (CRITICAL)

### 🚨 MANDATORY: Capture the Essence Within Duration
* **NO MATTER HOW LONG the input script is**, the final video MUST:
  * **Fit within the specified duration** ({min_duration}-{max_duration} seconds)
  * **Cover ALL important points** from the input script
  * **Capture the ESSENCE and EMOTION** of the overall narrative
  * **NOT feel rushed or incomplete** - tell a complete story within the time limit

### How to Handle Long Scripts
1. **Identify ALL Key Points**: Extract ALL important bullet items, facts, and narrative beats
2. **Prioritize by Impact**: Focus on points that drive the story and create emotional impact
3. **Condense, Don't Cut**: Combine related points into single clips rather than OMITTING them
4. **Maintain Completeness**: The viewer should understand the FULL story even if details are condensed
5. **Balance Depth and Breadth**: Cover all major topics rather than going deep on just one
6. **🚨 CRITICAL**: If the script says "5 mistakes" → you MUST cover ALL 5 mistakes!
   * If script says "3 steps" → cover ALL 3 steps
   * If script has a numbered list → include ALL items from that list

### Narrative/Story Approach (MANDATORY)
* **TELL A STORY, not a list of facts**: Transform bullet points into a flowing narrative
* **Create a story arc**:
  * **BEGINNING**: Set up the context, introduce the situation (Clips 0-1)
  * **MIDDLE**: Develop the story, present ALL key facts/events, build engagement (Clips 2 to N-1)
  * **ENDING**: Conclude with impact, call-to-action (Final Clip)

### Condensing Example (15 Points → 7 Clips)
**Input Script**: Long document with 15 important points about "5 Mistakes in Buying Engagement Rings"
**Target Duration**: 45-60 seconds (7-8 clips)
**Solution**:
- Clip 0: Hook + "5 mistakes" intro (combines intro) [hook]
- Clip 1: Context + why these matter (sets the scene) [relatability]
- Clip 2: Mistake 1 + Mistake 2 (condensed together) [myth vs reality]
- Clip 3: Personal story (emotional moment) [transformation]
- Clip 4: Mistake 3 + Mistake 4 (condensed together) [authority]
- Clip 5: Mistake 5 (standalone for emphasis) [mistake]
- Clip 6: Conclusion + CTA (wrap up + action) [CTA]

**Key**: All 5 mistakes are covered, but condensed into 7 clips that tell a COMPLETE story within 45-60 seconds.

---

## 🎬 VIDEO STRUCTURE RULES

### Duration & Autonomous Clip Planning
* Total video length: **{min_duration}-{max_duration} seconds**
* **YOU ARE AUTONOMOUS** - decide how many clips based on:
  1. Target duration from input
  2. Content/message that needs to be conveyed - **COVER ALL KEY POINTS**
  3. Visual changes needed (new visual = new clip)
  4. Natural breakpoints in the narrative

### 🎯 WORD-TO-DURATION GUIDE (STRICT - FOLLOW EXACTLY)
**CRITICAL**: Word count MUST match duration. Audio duration = words ÷ 2 (roughly 2 words per second)

| Duration | Word Count | Example Use |
|----------|------------|-------------|
| **5-6 seconds** | 10-12 words | Punchy hook, quick transition |
| **7-8 seconds** | 14-16 words | Short statement, single point |
| **9-10 seconds** | 18-20 words | Medium explanation |
| **11-12 seconds** | 22-24 words | Detailed point |
| **13-14 seconds** | 26-28 words | Story segment |
| **15-16 seconds** | 30-32 words | Full explanation |

**FORMULA**: `estimated_duration_seconds = word_count ÷ 2`
**VALIDATION**: If you write 15 words, clip should be ~7-8 seconds, NOT 16 seconds!

### ⚡ DYNAMIC PACING (CRITICAL FOR ENGAGEMENT)
* **MIX SHORT AND LONG CLIPS** - Don't make all clips the same length!
* **Short punchy clips (5-8s)**: Hooks, transitions, impact moments, quick points
* **Medium clips (9-12s)**: Explanations, story beats, key messages
* **Longer clips (13-16s)**: Full stories, detailed explanations (use sparingly)

**PACING STRATEGY**:
* Start with SHORT punchy hook (5-8s) - grab attention FAST
* Vary between short and medium throughout
* Use SHORT clips for: hooks, transitions, impactful statements
* Use MEDIUM clips for: explanations, story segments
* End with SHORT punchy CTA (5-8s)

**BAD PACING**: 12s → 14s → 13s → 11s → 16s (all similar = boring)
**GOOD PACING**: 6s → 10s → 8s → 12s → 7s → 10s → 6s (varied = engaging)

### 📹 VISUAL-DRIVEN CLIP BREAKS
* **Start a NEW CLIP when**:
  - Visual/scene needs to change
  - Expression or pose changes significantly
  - New hook or segment begins
  - Topic shifts to a new point
* **Each clip = One complete visual scene**
* OmniHuman will animate the avatar speaking the voiceover

### 🚫 AVOID BROKEN MESSAGES
* **NEVER** break a single thought across multiple clips
* Each clip = **COMPLETE thought or segment**
* Video should flow like a **REAL person talking**
* If message is long, keep in ONE clip

### 🎥 SCROLL-STOPPING FEEL
* Fast-moving, dynamic, engaging
* Varied pacing keeps viewers watching
* Mix of energy levels (calm → punchy → thoughtful → energetic)
* **Social media ready**: Instagram Reels, TikTok, YouTube Shorts

### Voiceover Guidelines
* Write **natural, conversational** voiceovers
* **MATCH word count to duration** (see table above)
* Short clips = punchy, impactful words
{voiceover_guideline_short}
* **One complete message per clip**

### Clip 0 (Opening Hook)
* Must be **attention-grabbing** and **scroll-stopping**
* **KEEP IT SHORT**: 5-8 seconds (10-16 words) for maximum impact
* Sets the tone for the entire video
* MUST use a starting hook (see hooks section below)

---

## 🎣 SCROLL-STOPPING HOOKS (MANDATORY)

**CRITICAL**: Every video MUST use hooks in ALL THREE stages to maximize engagement.

### 🚀 STARTING HOOKS (Clip 0 or Clip 1) - Choose ONE or combine:
* **Shock/Surprise Hook**: Unexpected statement that grabs attention
  - Example: "Most people get this completely wrong..."
* **Question Hook**: Force the brain to internally answer
  - Example: "Have you ever wondered why...?"
* **Bold Claim Hook**: Strong, confident statement
  - Example: "This one change transformed everything..."
* **Story-Start Hook**: Drop viewer into unfolding narrative
  - Example: "Last week, something incredible happened..."
* **Curiosity Gap Hook**: Withhold key information to force continuation
  - Example: "There's a secret that nobody talks about..."
* **Confrontation Hook**: Challenge viewer's beliefs (use carefully)
  - Example: "Everything you know about X is wrong..."

### 📈 MIDDLE HOOKS (Clips 2 to N-1) - Use throughout:
* **Myth vs Reality**: Challenge common misconceptions
  - Example: "Everyone thinks X, but actually..."
* **Authority**: Signal expertise with numbers, years, outcomes
  - Example: "After 10 years of experience..."
* **Transformation**: Show before/after contrast
  - Example: "Before I discovered this, I was struggling..."
* **Relatability**: Make viewer feel understood
  - Example: "I know exactly how frustrating this feels..."
* **Mistake Hook**: Highlight costly/common errors
  - Example: "The biggest mistake people make is..."
* **Social Proof**: Leverage herd psychology
  - Example: "Thousands of people have already..."

### 🎯 ENDING HOOKS (Final Clip) - Choose based on context:
* **CTA (Call-to-Action)**: Clear next step
  - Example: "Follow for more tips like this!"
* **Question**: Force reflection or engagement
  - Example: "What do you think? Let me know in the comments!"
* **Transformation Promise**: Show what's possible
  - Example: "Imagine what you could achieve with this..."
* **Time-Bound Hook**: Create urgency (if applicable)
  - Example: "Don't wait - start today!"

### 🚨 HOOK REQUIREMENTS:
* **MANDATORY**: All three stages (starting, middle, ending) MUST have hooks
* **Starting**: At least ONE starting hook in Clip 0 or Clip 1
* **Middle**: At least ONE middle hook across Clips 2 to N-1
* **Ending**: At least ONE ending hook in the final clip
* **SPECIFY**: Include `hook_type` field in EVERY clip's JSON

---

## 🧠 IMAGE PROMPT RULES (CRITICAL)

Every image prompt describes the **avatar/influencer speaking to camera**.

### ⚠️ ALL CLIPS USE "REFERENCE INFLUENCER" (MANDATORY)
A reference image is provided from CLI. ALL clips (including Clip 0) must use "reference influencer" terminology.
* Use "reference influencer" in EVERY image prompt
* **CRITICAL**: ALWAYS include: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* Vary camera angle, expression, pose, and lighting between clips for visual interest

### Example Prompts (CINEMATIC & GEN Z):

**Clip 0 (Opening Hook - Close-up for impact)**:
"Reference influencer with confident knowing smirk and raised eyebrow, extreme close-up shot on 85mm portrait lens, dramatic Rembrandt lighting with warm golden key light creating beautiful shadows, subtle neon pink rim accent on hair edges, shallow depth of field with modern studio melting into creamy bokeh, speaking directly to camera, rich cinematic color grading with teal shadows and warm amber highlights, film grain texture, direct intense eye contact with camera. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**Middle Clip (Medium shot)**:
"Reference influencer with thoughtful expression, medium shot on 50mm f/1.4, three-point lighting with warm key light and cool blue fill creating professional depth, speaking directly to camera, shallow depth of field with upscale office environment in soft bokeh with visible light bokeh orbs, rich cinematic color grading with high contrast and warm tones. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**Ending Clip (CTA - Close-up for connection)**:
"Reference influencer with warm genuine smile reaching the eyes, intimate close-up shot on 85mm lens, golden hour backlight creating halo effect with lens flare, soft diffused key light creating flattering catchlights in eyes, shallow depth of field with dreamy warm bokeh background, speaking directly to camera, warm golden color grading with soft vignette, intimate emotional moment frozen in time. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

### Image Prompt Requirements:
* **ALL prompts MUST include** "reference influencer" and the reference instruction
* ALL prompts MUST end with "no text overlays"
* **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip
* Focus on natural, relatable aesthetics (UGC style)
* Vary expressions based on voiceover emotion
* Include lighting description in every prompt
* Include camera angle/shot type in every prompt
* Keep backgrounds consistent but with slight variations

---

## 🖼️ SPLIT-PROPORTION VISUALS ({split_pct}% OF CLIPS - B-ROLL ENGAGEMENT)

**CRITICAL FOR ENGAGEMENT**: To keep the video visually interesting and engaging, **{split_pct}% of clips should use split-proportion compositions** where the influencer shares the frame with context visuals (B-roll) related to the topic.

### 📊 SPLIT COMPOSITION RULE:
* **If you have 10 clips** → {split_count_example} should have split compositions
* **Calculate**: Total clips × {split_proportion} = Number of split composition clips (round to nearest)
* **Remaining {remaining_pct}%** of clips are standard talking-head (influencer only)

### 🚨 CONSISTENT LAYOUT FORMAT (CRITICAL - DO NOT MIX)
* **🚨 CRITICAL: CHOOSE ONE FORMAT AND USE IT FOR ALL SPLIT CLIPS**:
  * **YOU decide which layout format to use** - you have full autonomy to choose
  * **BUT you MUST use the SAME format for ALL split composition clips** in the video
  * **DO NOT MIX formats** - if you choose side_split, ALL split clips use side_split
* **LAYOUT FORMAT OPTIONS** - Choose ONE format and use it for ALL split clips:
  * **OPTION A - SIDE SPLIT**: If using side_split, ALWAYS put influencer on the SAME side (e.g., always right)
    * DO NOT mix "influencer on left" with "influencer on right" in the same video
  * **OPTION B - UPPER/LOWER**: If using upper_lower, influencer is ALWAYS in the lower portion
  * **OPTION C - CORNER OVERLAY**: If using corner_overlay, ALWAYS use the SAME corner (e.g., always bottom-right)
    * DO NOT mix "bottom-right" with "bottom-left" in the same video
* **WRONG (INCONSISTENT)**:
  * ❌ Clip 2: "Split composition, influencer on LEFT"
  * ❌ Clip 4: "Corner overlay, influencer in BOTTOM-RIGHT"
  * ❌ Clip 5: "Split composition, influencer on RIGHT"
  * (This mixes side_split and corner_overlay AND mixes left/right positions)
* **CORRECT (CONSISTENT)**:
  * ✅ Clip 2: "Side split, influencer on RIGHT, context on left"
  * ✅ Clip 4: "Side split, influencer on RIGHT, context on left"
  * ✅ Clip 5: "Side split, influencer on RIGHT, context on left"
  * (All split clips use the SAME format: side_split with influencer on right)

### 🎨 LAYOUT OPTIONS (Choose ONE and use consistently):

**1. SIDE SPLIT (Left/Right)**:
* Influencer on one side (40%), context visual on the other side (60%)
* Best for: comparing, showing related visuals, demonstrations
* Example: "Cinematic split composition. LEFT SIDE (60%): dreamy bokeh shot of [relevant context - product, scene] with dramatic warm lighting and lens flares, atmospheric mood with rich cinematic color grading. RIGHT SIDE (40%): Reference influencer medium close-up on 50mm lens with confident expression, speaking directly to camera, dramatic Rembrandt lighting with warm golden key light and cool blue rim accent, shallow depth of field, teal and orange color grading. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**2. UPPER/LOWER SPLIT (Vertical)**:
* Context visual in upper portion (55%), influencer in lower portion (45%)
* Best for: dramatic visuals, storytelling, revealing context
* Example: "Dramatic upper portion (55%) showing [relevant context - landscape, product showcase] with cinematic lighting and atmospheric mood, dust particles visible in light beams, god rays creating magical atmosphere. LOWER PORTION (45%): Reference influencer medium shot on 35mm lens with engaged expression, speaking directly to camera, dramatic three-point lighting with warm key and subtle magenta rim accent, shallow depth of field, film grain texture. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**3. CORNER OVERLAY**:
* Full context visual as background, influencer in corner (25-30%)
* Best for: immersive context, environmental storytelling
* Example: "Full frame cinematic visual of [relevant context scene] with dramatic chiaroscuro lighting, magical atmosphere with dust particles in light beams, rich color grading. BOTTOM-RIGHT CORNER (25%): Reference influencer intimate close-up with warm expression, speaking directly to camera, dramatic side lighting creating beautiful shadows on face, warm golden tones, editorial portrait style. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

### ⚠️ CRITICAL RULES FOR SPLIT COMPOSITIONS:
* **NO DUPLICATE HUMANS**: The influencer must appear ONLY ONCE in the image - never in both portions
* **NO PERCENTAGE TEXT IN IMAGE**: Never include "UPPER 55%", "LEFT 60%" etc. as visible text - these are composition instructions only
* **RELEVANT CONTEXT**: The split visual MUST relate to what the influencer is talking about in that clip
* **STILL USE "reference influencer"**: Even in split compositions, use the reference influencer terminology

### 📋 WHEN TO USE SPLIT COMPOSITIONS:
* ✅ When explaining a concept that benefits from visual context
* ✅ When showing a product, chart, location, or demonstration
* ✅ When the voiceover references something that should be visible
* ✅ For variety after 2-3 standard talking-head clips
* ❌ NOT for opening hooks (keep those as direct close-ups)
* ❌ NOT for final CTA (keep personal connection)

### 🎯 EXAMPLE SPLIT COMPOSITION PROMPTS (CINEMATIC):

**Product/Item Related**:
"Cinematic split composition. LEFT SIDE (60%): stunning product shot of [product name/type] on elegant display with dramatic spotlight creating god rays and magical atmosphere, dust particles floating in light beam, high-end editorial aesthetic with deep shadows. RIGHT SIDE (40%): Reference influencer medium close-up on 50mm lens with excited expression, speaking directly to camera, dramatic Rembrandt lighting with warm golden tones, shallow depth of field, rich cinematic color grading. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**Data/Chart Related**:
"Dramatic upper portion (55%) showing sleek professional data visualization of [relevant metrics/comparison] with modern glassmorphism design, subtle glow effects and premium feel, dark background with accent lighting. Lower portion (45%): Reference influencer close-up on 85mm portrait lens with thoughtful expression, speaking directly to camera, soft three-point lighting with cool blue rim accent, cinematic depth with office in bokeh. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

**Location/Scene Related**:
"Full cinematic view of [relevant location/scene] with dramatic chiaroscuro lighting, atmospheric depth with god rays and dust particles, magical mood with rich color grading. Reference influencer as overlay in bottom-left corner (30%), intimate close-up with warm expression, speaking directly to camera, dramatic side lighting creating beautiful shadows, editorial portrait quality. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

---

## 🎭 ACTIVITY PROMPTS (OPTIONAL - MAKE IT ENGAGING)

**PURPOSE**: Add subtle, minimalist activities/movements to make the avatar video more dynamic and engaging. OmniHuman 1.5 can animate the avatar with additional movements beyond just lip-sync.

### 📋 WHEN TO USE (AUTONOMOUS - YOU DECIDE):
* **NOT mandatory** - use when it enhances the clip
* Best for **medium to longer clips** (8+ seconds)
* When the voiceover content suits natural movement
* To add variety after static talking-head clips
* **Skip for** short punchy clips (5-6s) where focus should be on the message

### 🎯 MINIMALIST ACTIVITY IDEAS:
* **Subtle gestures**: "Gentle hand gesture while explaining", "Subtle pointing motion"
* **Head movements**: "Subtle head nod while speaking", "Slight head tilt showing interest"
* **Body shifts**: "Leans forward slightly at key point", "Relaxes back while concluding"
* **Hand activities**: "Counts on fingers while listing", "Open palm gesture for emphasis"
* **Expression changes**: "Expression shifts from curious to confident mid-clip"
* **Walking/Movement**: "Takes a slow step forward while speaking" (for wider shots)

### ⚠️ ACTIVITY PROMPT RULES:
* **MINIMALIST**: Activities should be subtle, not distracting
* **NATURAL**: Should feel like organic human behavior
* **RELEVANT**: Should match the tone/content of the voiceover
* **BRIEF**: Keep prompts short and clear (10-20 words max)
* **Set to null** if no activity needed for that clip

### 📝 EXAMPLE ACTIVITY PROMPTS:
* "Subtle nod while making key point, then gentle hand gesture"
* "Leans in slightly when revealing important information"
* "Counts on fingers while listing the three mistakes"
* "Relaxed posture, then sits up straighter for conclusion"
* "Gentle smile builds as the positive message unfolds"
* null (when no activity needed - just standard lip-sync)

---

## 🎬 CREATIVE DIRECTION (MAKE IT FABULOUS!)

### 🚨🚨🚨 CINEMATIC & EXCITING IMAGE PROMPTS (GEN Z VISUAL APPEAL - ABSOLUTELY CRITICAL):

* **⚠️ THIS IS THE MOST IMPORTANT RULE FOR IMAGE PROMPTS ⚠️**
* **MANDATORY**: ALL image prompts MUST be **CINEMATIC, DETAILED, and VISUALLY EXCITING**
* **GOAL**: Create visuals that are **TikTok/Reels-worthy**, **scroll-stopping**, and appeal to **Gen Z aesthetic**
* **STRICT MINIMUM**: Every image prompt should be **detailed and specific** - vague prompts result in BORING visuals

### WHY THIS MATTERS:
* **PROBLEM**: Short/vague/generic prompts cause:
  * 🚫 BORING stock-photo-like visuals that viewers scroll past
  * 🚫 Generic lighting that feels flat and amateur
  * 🚫 No emotional impact - viewers don't feel anything
  * 🚫 Forgettable content that doesn't stand out

### 🎬 CINEMATIC CAMERA WORK (REQUIRED IN EVERY PROMPT):

* **DYNAMIC ANGLES**: Use cinematic camera angles, NOT just "medium shot"
  * "Low angle hero shot" - makes subject look powerful
  * "Extreme close-up" - intimacy, detail, emotion
  * "Over-the-shoulder feel" - voyeuristic, immersive
  * "Straight-on direct address" - connection with viewer
* **LENS SPECIFICATIONS**: Add lens details for professional look
  * "shot on 35mm lens" - classic cinematic
  * "shot on 50mm f/1.4" - portrait, shallow depth
  * "shot on 85mm portrait lens" - flattering compression
* **DEPTH OF FIELD**: Almost every shot needs this
  * "shallow depth of field with creamy bokeh"
  * "background melting into soft blur"
  * "sharp subject against dreamy bokeh background"

### 📷 CAMERA ANGLES & SHOTS (Vary for Visual Interest):
* **Close-up (CU)**: Face fills frame, intense/emotional moments, hook delivery
* **Medium Close-up (MCU)**: Head and shoulders, conversational, most common for talking
* **Medium Shot (MS)**: Waist up, shows hand gestures, explanatory content
* **Medium Wide (MW)**: Full upper body, dynamic storytelling, reveals setting

### 🎯 SHOT PROGRESSION STRATEGY:
* **Opening Hook**: Start with close-up for immediate connection and impact
* **Middle Content**: Alternate between MCU and MS for variety
* **Key Points**: Use close-up to emphasize important statements
* **Ending CTA**: Close-up or MCU for personal connection

### 💡 DRAMATIC LIGHTING (REQUIRED - NO FLAT LIGHTING):

* **NEVER use generic "soft lighting" or "natural light" alone** - be SPECIFIC
* **CINEMATIC LIGHTING STYLES** (choose one for each prompt):
  * "Rembrandt lighting with subtle shadows" - classic portrait
  * "Dramatic side lighting creating depth and dimension" - moody
  * "Three-point lighting with warm key and cool fill" - professional
  * "Film noir single spotlight from above" - mysterious
  * "Golden hour backlight with lens flare" - dreamy, romantic
  * "Neon rim light accents on hair/edges" - modern, Gen Z
* **COLOR IN LIGHTING** (add accent colors):
  * "warm golden key light with cool blue rim accent"
  * "dramatic side light with subtle pink edge glow"
  * "teal shadows with warm amber highlights"

### 🎨 GEN Z VISUAL AESTHETICS (MAKE IT EXCITING):

* **COLOR GRADING** (specify in every prompt):
  * "rich cinematic color grading with teal and orange tones"
  * "moody desaturated palette with one vibrant accent color"
  * "warm golden tones with cool shadow undertones"
  * "high contrast with deep blacks and bright highlights"
* **ATMOSPHERE & MOOD** (don't just describe - create feeling):
  * "tense atmosphere with dramatic shadows"
  * "electric energy and anticipation"
  * "luxurious opulent mood"
  * "intimate emotional moment frozen in time"
  * "magical atmosphere with dust particles floating in light beam"
* **TEXTURE & DETAIL**:
  * "film grain for authentic cinematic texture"
  * "visible texture and material details"
  * "hyper-detailed surface reflections"

### 🖼️ BACKGROUND GUIDELINES:
* **Modern minimalist**: Clean, professional, not distracting
* **Lifestyle setting**: Living room, cafe, outdoor - relatable
* **Office/workspace**: Authority, professional content
* **Blurred background (bokeh)**: Focus on speaker, cinematic feel
* **Contextual backgrounds**: Match the content topic

### 🎭 EXPRESSION & CAMERA DIRECTION (BE SPECIFIC):

* **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - speaking directly to camera in every clip
* **NEVER describe generic expressions** - add character and energy
* **EXPRESSIONS** (be specific about emotion):
  * "knowing smirk with raised eyebrow" NOT just "smiling"
  * "furrowed brow of concentration" NOT just "serious"
  * "wide eyes of excitement" NOT just "excited"
  * "intense focused gaze" NOT just "looking"
  * "warm genuine smile reaching the eyes" NOT just "happy"
* **CAMERA DIRECTION**: Always include "speaking directly to camera" or "direct eye contact with camera"

### 🌟 PRO TIPS FOR SCROLL-STOPPING VISUALS:
* First 1-2 seconds must be visually striking (hook them!)
* Use contrast between clips (close → wide → close)
* Match visual energy to voiceover energy
* Expressions should match the emotional content
* Background should complement, never distract
* Consistent style = professional feel
* Slight variations = keeps it interesting

### 📐 COMPOSITION RULES:
* Subject slightly off-center for dynamic composition
* Headroom: Not too much space above head
* Looking room: Slight space in direction of gaze
* Clean backgrounds without clutter
* Depth in frame (foreground/background separation)

### Visual Variety Across Clips:
* **Vary expressions**: Match emotion to content (excited, thoughtful, concerned, happy)
* **Vary camera angles**: Close-up → Medium → Medium Close-up → Close-up
* **Vary lighting style**: Ring light → Side light → Natural window → Golden hour
* **Vary color mood**: Warm tones → Cool professional → Vibrant → Back to warm
* **Keep consistent**: Same person, same outfit, similar background STYLE (not identical)

### 🔥 EXAMPLE TRANSFORMATIONS (BORING → EXCITING):

**BORING (generic, flat)**:
"Reference influencer smiling at camera, medium shot, office background, good lighting"

**EXCITING (cinematic, Gen Z)**:
"Reference influencer with confident knowing smirk and slightly raised eyebrow, medium close-up shot on 50mm lens, dramatic Rembrandt lighting with warm golden key light and cool blue rim accent on hair, shallow depth of field with modern minimalist office in creamy bokeh, rich cinematic color grading with teal shadows and warm highlights, speaking directly to camera, film grain texture. Only take reference influencer from the reference image for new image generation. Ignore text from reference image. no text overlays"

### ✅ VERIFICATION CHECKLIST (CHECK EVERY PROMPT):
Before finalizing EACH image prompt, verify:
- [ ] Specific camera angle (CU, MCU, MS) + lens info?
- [ ] Specific lighting style (not generic "soft lighting")?
- [ ] Depth of field mentioned?
- [ ] Color grading/mood specified?
- [ ] Specific expression (not generic "smiling")?
- [ ] **"speaking directly to camera"** included? (MANDATORY)
- [ ] "reference influencer" + reference instruction included?
- [ ] "no text overlays" at the end?

---

## 🎙️ VOICEOVER RULES

* **LANGUAGE: {language_name}** - All voiceover text MUST be written in {language_name}
* Use natural, conversational {language_name} (can include English words where natural)
{voiceover_emotions_instructions}

---

## 🎵 MUSIC RULES (CRITICAL - 20 SECOND LIMIT)

⚠️ **MAXIMUM 20 SECONDS PER MUSIC GROUP**

* Each music group can cover clips totaling **MAXIMUM 20 seconds**
* Create multiple music groups if video is longer than 20 seconds
* Music should change at narrative shifts

### Music Group Planning:
1. Calculate cumulative duration of clips
2. Create new music group when approaching 20 second limit
3. Align music changes with content shifts

### Music Prompt Requirements:
* Describe mood, tempo, emotional intent
* Keep music **subtle and supportive** - NOT overpowering
* Use terms like: "subtle", "upbeat", "gentle", "modern", "corporate", "inspiring"
* ❌ No song names or artists
* ❌ No groups exceeding 20 seconds total duration

---

## 📦 REQUIRED JSON OUTPUT SCHEMA (STRICT)

```json
{{{{
  "input_summary": {{{{
    "main_topic": "Brief summary of what the video is about",
    "key_points": [],
    "tone": "The overall tone (professional, casual, educational, etc.)"
  }}}},
  "video_overview": {{{{
    "total_duration_seconds": 0,
    "total_clips": 0,
    "total_words": 0,
    "split_composition_clips": 0
  }}}},
  "avatar_description": {{{{
    "appearance": "Detailed description of the avatar's appearance (age, features, style)",
    "attire": "What they're wearing (colors, style, accessories)",
    "background_style": "General background style for consistency (modern office, lifestyle, etc.)",
    "lighting_style": "Lighting aesthetic (soft natural, ring light, golden hour, studio)",
    "color_mood": "Color/mood aesthetic (warm tones, cool professional, vibrant, soft pastels)"
  }}}},
  "clips": [
    {{{{
      "clip_number": 0,
      "word_count": 15,
      "estimated_duration_seconds": 10,
      "voiceover": "{voiceover_schema_example}",
      "image_prompt": "DETAILED visual scene. Use 'reference influencer' + reference instruction. Include expression, camera angle, lighting, background, 'speaking directly to camera'. For split compositions, describe layout clearly. End with 'no text overlays'",
      "activity_prompt": "Optional - Minimalist activity instruction for OmniHuman (e.g., 'subtle head nod while speaking', 'gentle hand gesture mid-clip'). Set to null if no activity needed.",
      "split_composition": {{{{
        "enabled": false,
        "layout": "none / side_split / upper_lower / corner_overlay",
        "context_visual": "Description of the context visual (only if enabled=true)"
      }}}},
      "expression": "Specific expression (excited, confident, thoughtful, curious, warm, passionate, sincere)",
      "camera_angle": "Specific shot type: close-up (CU), medium close-up (MCU), medium shot (MS), medium wide (MW)",
      "lighting": "Lighting for this clip (soft natural, ring light glow, golden hour warmth, studio diffused)",
      "visual_change_reason": "Why this clip needs a new visual (new scene, expression change, topic shift, hook transition)",
      "hook_type": "MANDATORY - Starting clips: 'Shock/Surprise', 'Question', 'Bold Claim', 'Story-Start', 'Curiosity Gap', 'Confrontation'. Middle clips: 'Myth vs Reality', 'Authority', 'Transformation', 'Relatability', 'Mistake', 'Social Proof'. Ending clip: 'CTA', 'Question', 'Transformation Promise', 'Time-Bound'"
    }}}}
  ],
  "music_groups": {{{{
    "Music_A": {{{{
      "mood": "upbeat, modern",
      "tempo": "medium",
      "prompt": "Detailed music generation prompt",
      "clips": [0, 1, 2],
      "total_duration_seconds": 16
    }}}}
  }}}}
}}}}
```

---

## 📌 FIELD VALIDATION RULES

### Duration Estimation (STRICT)
* `"word_count"` = EXACT count of words in voiceover
* `"estimated_duration_seconds"` = word_count ÷ 2 (STRICT: ~2 words per second)
* **FORMULA**: duration = word_count ÷ 2
* **VALIDATION**:
  - 10-12 words = 5-6 seconds
  - 14-16 words = 7-8 seconds
  - 18-20 words = 9-10 seconds
  - 22-24 words = 11-12 seconds
  - 26-28 words = 13-14 seconds
  - 30-32 words = 15-16 seconds
* **❌ WRONG**: 15 words with 16s duration (should be ~7-8s)
* Sum of all clip durations should match target video duration

### Content Rules
{voiceover_content_rule}
* `"voiceover"` must be ONE COMPLETE thought - NEVER break messages across clips
* `"image_prompt"` must end with "no text overlays"
* `"image_prompt"` must include: "reference influencer", expression, camera angle, lighting, "speaking directly to camera"
* **ALL clips** (including Clip 0) must use "reference influencer" terminology
* **ALL clips** must include: "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
* `"visual_change_reason"` explains why this clip needs a new visual

### Creative Direction Rules (MAKE IT FABULOUS!)
* `"camera_angle"` must be specific: close-up (CU), medium close-up (MCU), medium shot (MS), medium wide (MW)
* `"expression"` must match the voiceover emotion
* `"lighting"` should enhance the mood (soft natural, ring light, golden hour, studio)
* **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - include "speaking directly to camera" in every image prompt
* **Vary camera angles across clips** for visual interest
* **Opening hook**: Use close-up for immediate impact
* **Middle content**: Alternate between MCU and MS
* **Ending CTA**: Close-up for personal connection

### Music Rules
* Music groups: `"total_duration_seconds"` must be **≤ 20** (create multiple groups for longer videos)

### Hook Rules
* `"hook_type"` is **MANDATORY** for ALL clips:
  * **Starting clips (Clip 0 or Clip 1)**: 'Shock/Surprise', 'Question', 'Bold Claim', 'Story-Start', 'Curiosity Gap', or 'Confrontation'
  * **Middle clips (Clips 2 to N-1)**: 'Myth vs Reality', 'Authority', 'Transformation', 'Relatability', 'Mistake', or 'Social Proof'
  * **Ending clip (Final clip)**: 'CTA', 'Question', 'Transformation Promise', or 'Time-Bound'
  * **ALL THREE stages MUST have hooks** - never skip any stage

### 🖼️ SPLIT COMPOSITION RULES ({split_pct}% OF CLIPS)
* **TARGET**: {split_pct}% of clips should have `split_composition.enabled = true`
* Calculate: `split_composition_clips = round(total_clips × {split_proportion})`
* 10 clips → 3 split | 7 clips → 2 split | 5 clips → 1-2 split
* `split_composition.layout` must be one of: "side_split", "upper_lower", "corner_overlay"
* `split_composition.context_visual` must describe what's shown alongside the influencer
* **NOT for opening hook (Clip 0)** - keep direct close-up connection
* **NOT for final CTA** - keep personal connection
* Best for **middle clips** where context visuals enhance understanding

### 🎭 ACTIVITY PROMPT RULES (OPTIONAL)
* `"activity_prompt"` is **OPTIONAL** - YOU decide which clips need it
* Set to `null` for clips that don't need activity
* Best for **medium to longer clips** (8+ seconds)
* Keep activities **MINIMALIST** - subtle, not distracting
* Examples: "subtle head nod", "gentle hand gesture", "leans in at key point"
* **Skip for** short punchy clips where message is the focus

### 🎥 CLIP PLANNING STRATEGY
1. Read the script and identify key messages/points
2. Group related messages that can stay in ONE clip
3. Count words for each voiceover → estimate duration
4. Decide visual changes between clips (pose, setting, expression)
5. **Select {split_pct}% of clips for split compositions** (context visuals / B-roll)
6. **Optionally add activity prompts** for engaging clips
7. Ensure total duration matches target range
8. Apply appropriate hooks to each stage

---

## ⛔ ABSOLUTE PROHIBITIONS

* ❌ No markdown
* ❌ No explanations
* ❌ No assumptions beyond input text
* ❌ No output outside JSON
* ❌ **NEVER break a single message/thought across multiple clips**
* ❌ **NEVER create choppy, unnatural clip transitions**
* ❌ No clips without clear visual change reason
* ❌ **NEVER mismatch word count and duration** (15 words ≠ 16 seconds!)
* ❌ **NEVER make all clips similar duration** (vary for dynamic pacing!)
* ❌ **NEVER omit "reference influencer"** from image prompts
* ❌ **NEVER duplicate the influencer** in split compositions (influencer appears ONCE)
* ❌ **NEVER include percentage text** like "UPPER 55%" as visible text in image prompts

---

Output ONLY valid JSON. No markdown formatting, no explanations."""


def parse_duration(duration_str: str) -> tuple:
    """
    Parse duration string into min and max seconds.
    Handles ranges like "30-45" and single numbers like "15".
    """
    duration_str = duration_str.strip()
    
    if '-' in duration_str:
        parts = duration_str.split('-')
        if len(parts) == 2:
            try:
                min_sec = int(parts[0].strip())
                max_sec = int(parts[1].strip())
                return (min_sec, max_sec)
            except ValueError:
                pass
    
    try:
        seconds = int(duration_str)
        return (seconds, seconds)
    except ValueError:
        pass
    
    # Default fallback
    return (30, 60)


def detect_hooks_in_video_plan(video_plan: Dict) -> Dict:
    """
    Detect which hooks are being used in the video plan by reading explicit hook_type field from each clip.
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
    
    # Analyze starting clips (Clip 0 or Clip 1)
    starting_clips = [c for c in clips if c.get('clip_number', 0) <= 1]
    for clip in starting_clips:
        hook_type = clip.get('hook_type', '').strip()
        if hook_type:
            starting_hook_names = ['Shock/Surprise', 'Shock', 'Surprise', 'Question', 'Bold Claim', 'Bold',
                                  'Story-Start', 'Story Start', 'Curiosity Gap', 'Curiosity', 'Confrontation']
            if any(name.lower() in hook_type.lower() for name in starting_hook_names):
                if hook_type not in hooks_detected['starting_hooks']:
                    hooks_detected['starting_hooks'].append(hook_type)
    
    # Analyze middle clips (Clips 2 to N-1)
    if len(clips) > 2:
        middle_clips = [c for c in clips if 2 <= c.get('clip_number', 0) < len(clips) - 1]
        for clip in middle_clips:
            hook_type = clip.get('hook_type', '').strip()
            if hook_type:
                middle_hook_names = ['Myth vs Reality', 'Myth', 'Reality', 'Authority', 'Transformation',
                                    'Relatability', 'Mistake', 'Social Proof', 'Social']
                if any(name.lower() in hook_type.lower() for name in middle_hook_names):
                    if hook_type not in hooks_detected['middle_hooks']:
                        hooks_detected['middle_hooks'].append(hook_type)
    
    # Analyze ending clip (last clip)
    if clips:
        ending_clip = clips[-1]
        hook_type = ending_clip.get('hook_type', '').strip()
        if hook_type:
            ending_hook_names = ['CTA', 'Call to Action', 'Question', 'Transformation Promise',
                                'Transformation', 'Time-Bound', 'Time Bound']
            if any(name.lower() in hook_type.lower() for name in ending_hook_names):
                if hook_type not in hooks_detected['ending_hooks']:
                    hooks_detected['ending_hooks'].append(hook_type)
    
    # Log warnings if hooks are missing
    if not hooks_detected['starting_hooks']:
        print(f"  ⚠️ Warning: No starting hooks detected in Clip 0 or Clip 1")
    if not hooks_detected['middle_hooks']:
        print(f"  ⚠️ Warning: No middle hooks detected in Clips 2 to N-1")
    if not hooks_detected['ending_hooks']:
        print(f"  ⚠️ Warning: No ending hooks detected in final clip")
    
    return hooks_detected


def analyze_script_and_generate_plan(
    script_text: str,
    language_code: str = "hi",
    user_instruction: Optional[str] = None,
    desired_duration: Optional[str] = None,
    voiceover_emotions: bool = True,
    split_proportion: float = 0.3
) -> Dict:
    """
    Use Grok-4-latest to analyze script and generate avatar video plan.
    
    Args:
        voiceover_emotions: Whether to include emotional expressions in voiceover text
        split_proportion: Proportion of clips with split compositions / B-roll (0.0-1.0)
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Parse desired duration
    if desired_duration:
        min_duration, max_duration = parse_duration(desired_duration)
        duration_display = f"{min_duration}-{max_duration}" if min_duration != max_duration else str(min_duration)
    else:
        min_duration, max_duration = 30, 60
        duration_display = "30-60 (default)"
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK AVATAR VIDEO PLAN GENERATION")
    print(f"{'='*60}")
    print(f"  Script length: {len(script_text)} characters")
    print(f"  Language: {language_name} ({language_code})")
    print(f"  Desired Duration: {duration_display} seconds")
    if voiceover_emotions:
        print(f"  Voiceover emotions: ENABLED (square bracket expressions)")
    
    current_date = datetime.now().strftime("%B %d, %Y")
    system_prompt = get_avatar_video_system_prompt(
        language_code, language_name, current_date, min_duration, max_duration, voiceover_emotions, split_proportion
    )
    
    # Calculate split proportion display values for user prompt
    split_pct = int(split_proportion * 100)
    
    # Conditional voiceover rule for user prompt based on flag
    if voiceover_emotions:
        voiceover_user_rule = "- Include emotional expressions [excited], [thoughtful], [serious] in brackets"
    else:
        voiceover_user_rule = "- Write natural voiceovers as PLAIN TEXT - **NO square brackets** like [excited] or [pause]"
    
    # Build user prompt
    user_prompt_parts = [f"""Analyze the following script and generate a complete avatar video plan.

Generate a **SCROLL-STOPPING** UGC/influencer video targeting **{min_duration}-{max_duration} seconds** total duration.

🎯 **WORD-TO-DURATION (STRICT - MUST FOLLOW)**:
- **FORMULA**: estimated_duration_seconds = word_count ÷ 2
- 10-12 words = 5-6s | 14-16 words = 7-8s | 18-20 words = 9-10s
- 22-24 words = 11-12s | 26-28 words = 13-14s | 30-32 words = 15-16s
- **❌ WRONG**: 15 words with 16s duration! (should be ~7-8s)

⚡ **DYNAMIC PACING (CRITICAL)**:
- **MIX SHORT AND LONG CLIPS** - Don't make all clips similar length!
- SHORT punchy (5-8s): Hooks, transitions, impact moments
- MEDIUM (9-12s): Explanations, story beats
- LONGER (13-16s): Full stories (use sparingly)
- **GOOD**: 6s→10s→8s→12s→7s→10s→6s (varied = engaging)
- **BAD**: 12s→14s→13s→11s→16s (all similar = boring)

🚫 **AVOID BROKEN MESSAGES**:
- Each clip = ONE COMPLETE thought/segment
- Video should flow like a REAL PERSON TALKING

🎥 **SCROLL-STOPPING FEEL**:
- Fast-moving, dynamic, engaging
- Mix of energy levels throughout
- Social media ready (Reels, TikTok, Shorts)

📝 **IMAGE PROMPT RULES**:
- ALL clips use "reference influencer" + "Only take reference influencer from the reference image for new image generation. Ignore text from reference image."
- **🚨 INFLUENCER MUST ALWAYS FACE CAMERA** - include "speaking directly to camera" in every image prompt
- ALL image prompts must end with "no text overlays"
- Change setting/expression/camera angle between clips for visual variety

📖 **ESSENCE CAPTURE (CRITICAL)**:
- **COVER ALL KEY POINTS** from the input script within the duration
- If script says "5 mistakes" → you MUST cover ALL 5 mistakes
- If script has a numbered list → include ALL items (condense if needed)
- **Condense, don't cut** - combine related points rather than omitting them
- Viewer should understand the FULL story, even if condensed

🖼️ **SPLIT COMPOSITIONS ({split_pct}% OF CLIPS - B-ROLL)**:
- **{split_pct}% of clips should have split compositions** with context visuals (B-roll)
- Calculate: total_clips × {split_proportion} = split clips (round)
- **🚨 CONSISTENT FORMAT**: Choose ONE layout (side_split OR upper_lower OR corner_overlay) and use it for ALL split clips
  - If side_split: ALWAYS put influencer on the SAME side (e.g., always right)
  - If corner_overlay: ALWAYS use the SAME corner (e.g., always bottom-right)
  - DO NOT MIX different layouts/positions across clips
- Context visual must relate to what influencer is talking about
- **NOT for opening hook or final CTA** - use for middle clips
- Influencer appears ONLY ONCE (no duplicates)
- Set `split_composition.enabled = true` for these clips

🎤 **VOICEOVER RULES**:
{voiceover_user_rule}
- **MATCH word count to duration** (word_count ÷ 2 = seconds)
- More words = longer clip, fewer words = shorter punchy clip

🎵 **MUSIC RULES**:
- Music groups max 20 seconds each (create multiple groups for longer videos)

🎭 **ACTIVITY PROMPTS (OPTIONAL - YOU DECIDE)**:
- Add subtle activities to some clips to make avatar more engaging
- Examples: "subtle head nod", "gentle hand gesture", "leans forward at key point"
- Best for medium/longer clips (8+ seconds)
- Set `activity_prompt` to null if no activity needed
- Keep activities MINIMALIST and NATURAL

**🎬 NARRATION STRUCTURE (TELL A STORY)**:
- **BEGINNING (Clips 0-1)**: Set up context, introduce the situation, grab attention
- **MIDDLE (Clips 2 to N-1)**: Develop the story, present ALL key facts/points, build engagement
- **ENDING (Final Clip)**: Conclude with impact, clear call-to-action
- Video should flow like a REAL PERSON TELLING A STORY

**🎣 HOOKS ARE MANDATORY**:
- **Starting Hook (Clip 0 or 1)**: Shock/Surprise, Question, Bold Claim, Story-Start, Curiosity Gap, Confrontation
- **Middle Hooks (Clips 2 to N-1)**: Myth vs Reality, Authority, Transformation, Relatability, Mistake, Social Proof
- **Ending Hook (Final Clip)**: CTA, Question, Transformation Promise, Time-Bound
- Every clip MUST have a `hook_type` field
- ALL THREE STAGES must have hooks

=== SCRIPT TEXT ===
{script_text}
=== END SCRIPT ==="""]
    
    if user_instruction and user_instruction.strip():
        user_prompt_parts.append(f"""

=== USER INSTRUCTION (IMPORTANT) ===
{user_instruction.strip()}
=== END USER INSTRUCTION ===

⚠️ **CRITICAL**: Follow the user's instruction above. Align all prompts and video structure with their specific requirements.""")
    
    user_prompt_parts.append("\n\nOutput ONLY valid JSON.")
    user_prompt = "".join(user_prompt_parts)
    
    # Retry logic
    max_retries = 2
    last_exception = None
    response_text = None
    
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                print(f"  🔄 RETRY {attempt}/{max_retries-1}: Reconnecting to Grok...")
            
            print(f"\n  🔗 Connecting to Grok-4-latest...")
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-latest")
            
            chat.append(system(system_prompt))
            chat.append(user(user_prompt))
            
            print(f"  📤 Sending script to Grok...")
            response = chat.sample()
            response_text = response.content.strip()
            break
        except Exception as e:
            last_exception = e
            error_str = str(e)
            if ("Auth context expired" in error_str or 
                "grpc_status:13" in error_str or
                "StatusCode.INTERNAL" in error_str) and attempt < max_retries - 1:
                print(f"  ⚠️ Auth context expired, retrying...")
                continue
            else:
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
        
        if "```json" in json_content:
            json_start = json_content.find("```json") + 7
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        elif "```" in json_content:
            json_start = json_content.find("```") + 3
            json_end = json_content.find("```", json_start)
            json_content = json_content[json_start:json_end].strip()
        
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
            hook_info = f" [{clip.get('hook_type', 'No hook')}]" if clip.get('hook_type') else ""
            # Handle both estimated_duration_seconds (new) and duration_seconds (fallback)
            duration = clip.get('estimated_duration_seconds') or clip.get('duration_seconds', 'flexible')
            print(f"    Clip {clip.get('clip_number')}: ~{duration}s (actual determined by audio){hook_info}")
            if clip.get('voiceover'):
                voiceover_preview = clip.get('voiceover')[:100] + "..." if len(clip.get('voiceover', '')) > 100 else clip.get('voiceover')
                print(f"      Voiceover: {voiceover_preview}")
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
# IMAGE GENERATION
# ============================================

def clean_prompt_for_visual(prompt: str) -> str:
    """
    Clean prompt for image generation.
    Removes square bracket expressions and ensures "no text overlays" is present.
    """
    import re
    
    # Remove square bracket expressions: [anything inside brackets]
    cleaned = re.sub(r'\[[^\]]+\]', '', prompt)
    
    # Clean up extra spaces
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'\s*,\s*,', ',', cleaned)
    cleaned = re.sub(r'\s*,\s*$', '', cleaned)
    cleaned = cleaned.strip()
    
    # Ensure "no text overlays" is present
    no_text_patterns = [
        r'\bno\s+text\s+overlays?\b',
        r'\bno\s+text\s+on\s+screen\b',
        r'\bno\s+text\s+elements?\b',
    ]
    
    has_no_text = any(
        re.search(pattern, cleaned, re.IGNORECASE) 
        for pattern in no_text_patterns
    )
    
    if not has_no_text:
        cleaned = f"{cleaned}, no text overlays"
    
    return cleaned


def generate_image_with_nano_banana(
    prompt: str,
    output_path: str,
    aspect_ratio: str = "9:16"
) -> Optional[str]:
    """
    Generate image using nano-banana-pro model.
    Used for the FIRST clip with full character description.
    """
    prompt = clean_prompt_for_visual(prompt)
    
    print(f"\n  🖼️ Generating image with nano-banana-pro...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Aspect ratio: {aspect_ratio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text"
    
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


def generate_image_with_nano_banana_edit(
    prompt: str,
    output_path: str,
    reference_image_urls: List[str],
    aspect_ratio: str = "9:16"
) -> Optional[str]:
    """
    Generate image using nano-banana-pro/edit model with reference images.
    Used for SUBSEQUENT clips to maintain character consistency.
    
    Args:
        prompt: Image generation prompt (should include "reference influencer")
        output_path: Where to save the generated image
        reference_image_urls: List of S3 presigned URLs for reference images
        aspect_ratio: Aspect ratio for the image
    """
    prompt = clean_prompt_for_visual(prompt)
    
    print(f"\n  🖼️ Generating image with nano-banana-pro/edit (with reference)...")
    print(f"     Prompt: {prompt[:100]}...")
    print(f"     Reference images: {len(reference_image_urls)}")
    print(f"     Aspect ratio: {aspect_ratio}")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    negative_prompt = "text overlays, text on screen, text elements, captions, labels, subtitles, watermarks, logos with text"
    
    try:
        arguments = {
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
            "output_format": "png",
            "resolution": "1K",
            "image_urls": reference_image_urls,
            "negative_prompt": negative_prompt
        }
        
        result = fal_client.subscribe(
            "fal-ai/nano-banana-pro/edit",
            arguments=arguments,
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0].get('url')
            if image_url:
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
# VOICEOVER GENERATION (ElevenLabs TTS)
# ============================================

def generate_voiceover(
    text: str,
    output_path: str,
    language_code: str = "hi",
    voice_id: str = DEFAULT_VOICE_ID,
    speed: float = 1.0,
    max_retries: int = 2,
    audio_model: str = "v3"
) -> Tuple[Optional[str], float]:
    """
    Generate voiceover using ElevenLabs TTS.
    
    Args:
        text: Text to convert to speech
        output_path: Where to save the audio file
        language_code: Language code
        voice_id: ElevenLabs voice ID
        speed: Voice speed multiplier (default: 1.0, range: 0.5-2.0)
        max_retries: Maximum retry attempts
        audio_model: ElevenLabs model - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        
    Returns: (output_path, duration_seconds) or (None, 0) on failure
    """
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    # Determine API endpoint based on audio model
    if audio_model == "v2":
        api_endpoint = "fal-ai/elevenlabs/tts/multilingual-v2"
        model_display_name = "Multilingual v2"
    elif audio_model == "turbo":
        api_endpoint = "fal-ai/elevenlabs/tts/turbo-v2.5"
        model_display_name = "Turbo v2.5"
    else:  # Default to v3
        api_endpoint = "fal-ai/elevenlabs/tts/eleven-v3"
        model_display_name = "v3"
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"     📋 {log.get('message', str(log))}")
    
    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"\n  🔄 Retry attempt {attempt}/{max_retries} for voiceover generation...")
            time.sleep(2)
        else:
            print(f"\n  🎙️ Generating voiceover with ElevenLabs {model_display_name} ({language_name})...")
        
        print(f"     Text: {text[:100]}...")
        print(f"     Voice ID: {voice_id[:20]}...")
        if speed != 1.0:
            print(f"     Speed: {speed}x")
        
        try:
            result = fal_client.subscribe(
                api_endpoint,
                arguments={
                    "text": text,
                    "voice": voice_id,
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "speed": speed,
                    "language_code": language_code,
                    "timestamps": False
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
            if result and 'audio' in result:
                audio_url = result['audio'].get('url')
                if audio_url:
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
            
            if result and 'detail' in result:
                print(f"  ❌ No audio in result: {result.get('detail', 'Unknown error')}")
            else:
                print(f"  ❌ No audio in result")
            
            if attempt == max_retries:
                return None, 0
            
        except Exception as e:
            print(f"  ❌ Voiceover generation failed: {e}")
            if attempt == max_retries:
                return None, 0
    
    return None, 0


def generate_voiceover_per_clip(
    clip_voiceovers: List[Dict],
    temp_dir: str,
    language_code: str = "hi",
    voice_id: str = DEFAULT_VOICE_ID,
    speed: float = 1.0,
    audio_model: str = "v3"
) -> Dict[int, Dict]:
    """
    Generate individual voiceover for each clip.
    
    Args:
        clip_voiceovers: List of dicts with clip_number and voiceover_text
        temp_dir: Temporary directory for output files
        language_code: Language code for TTS
        voice_id: ElevenLabs voice ID
        speed: Voice speed multiplier (default: 1.0)
        audio_model: ElevenLabs model - "v3" (eleven-v3), "v2" (multilingual-v2), or "turbo" (turbo-v2.5)
        
    Returns: Dict mapping clip_number -> {path, duration}
    """
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    model_display = {"v3": "v3", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}.get(audio_model, "v3")
    print(f"\n  Generating voiceover for {len(clip_voiceovers)} clips in {language_name} (ElevenLabs {model_display})...")
    if speed != 1.0:
        print(f"  Speed: {speed}x")
    
    voiceover_data = {}
    
    for clip_info in clip_voiceovers:
        clip_num = clip_info['clip_number']
        text = clip_info['voiceover_text']
        
        if not text or not text.strip():
            continue
        
        output_path = os.path.join(temp_dir, f"voiceover_clip_{clip_num}.mp3")
        path, duration = generate_voiceover(text, output_path, language_code, voice_id, speed, audio_model=audio_model)
        
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

def generate_background_music(prompt: str, duration_seconds: int, output_path: str) -> Optional[str]:
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
# OMNIHUMAN 1.5 VIDEO GENERATION
# ============================================

def generate_avatar_video_omnihuman(
    image_url: str,
    audio_url: str,
    output_path: str,
    resolution: str = "720p",
    activity_prompt: Optional[str] = None
) -> Optional[str]:
    """
    Generate avatar video using OmniHuman 1.5.
    Creates lip-synced avatar video from image and audio.
    
    Args:
        image_url: S3 presigned URL of the avatar image
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
                print(f"  ✅ Avatar video saved: {output_path}")
                return output_path
        
        print(f"  ❌ No video in result")
        return None
        
    except Exception as e:
        print(f"  ❌ OmniHuman video generation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return None


# ============================================
# AUDIO NORMALIZATION
# ============================================

def normalize_audio_clip(audio_clip, target_rms_db=-20.0):
    """
    Normalize an audio clip to a target RMS level.
    Prevents audio volume inconsistencies between clips.
    
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
        
        # Extract audio data
        if hasattr(audio_clip, 'to_soundarray'):
            audio_array = audio_clip.to_soundarray(fps=44100)
        else:
            # Fallback: write to temp file and load
            temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            temp_path = temp_file.name
            temp_file.close()
            
            audio_clip.write_audiofile(temp_path, fps=44100, verbose=False, logger=None)
            audio_array, sample_rate = librosa.load(temp_path, sr=44100, mono=False)
            os.unlink(temp_path)
            
            if audio_array.ndim == 1:
                audio_array = audio_array.reshape(-1, 1)
            else:
                audio_array = audio_array.T
        
        sample_rate = 44100
        
        # Check if audio has content
        if audio_array is not None and len(audio_array) > 0:
            # Convert to mono for RMS calculation
            if audio_array.ndim > 1:
                mono_audio = np.mean(audio_array, axis=1)
            else:
                mono_audio = audio_array
            
            # Calculate current RMS
            rms = np.sqrt(np.mean(mono_audio ** 2))
            
            if rms > 0:
                # Calculate target RMS
                target_rms = 10 ** (target_rms_db / 20)
                
                # Calculate gain needed
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
                
                # Save normalized audio
                sf.write(temp_path, normalized_audio, sample_rate)
                
                # Create new audio clip from normalized file
                normalized_clip = AudioFileClip(temp_path)
                
                # Copy timing from original clip
                if hasattr(audio_clip, 'start') and audio_clip.start is not None:
                    normalized_clip = normalized_clip.set_start(audio_clip.start)
                
                print(f"      🔊 Normalized audio (gain: {gain:.2f}x)")
                
                return normalized_clip
            else:
                # No audio to normalize
                return audio_clip
        else:
            return audio_clip
            
    except Exception as e:
        print(f"      ⚠️ Audio normalization failed: {e}, using original audio")
        return audio_clip


# ============================================
# VIDEO STITCHING
# ============================================

def stitch_video_clips_with_music(
    clip_paths: List[str],
    clip_durations: Dict[int, float],
    voiceover_files: Dict[int, Dict],
    music_files: Dict[str, Dict],
    clip_music_mapping: Dict[int, str],
    output_path: str
) -> Optional[str]:
    """Stitch all video clips together with voiceovers and music"""
    print(f"\n{'='*60}")
    print(f"🎬 STITCHING VIDEO")
    print(f"{'='*60}")
    print(f"  Clips: {len(clip_paths)}")
    print(f"  Music Groups: {len(music_files)}")
    
    try:
        # Load all video clips
        video_clips = []
        clip_start_times = {}
        current_time = 0
        
        for i, clip_path in enumerate(clip_paths):
            if clip_path and os.path.exists(clip_path):
                clip = VideoFileClip(clip_path)
                video_clips.append(clip)
                clip_start_times[i] = current_time
                
                clip_duration = clip_durations.get(i, clip.duration)
                current_time += clip_duration
                print(f"  Loaded clip {i}: {clip_duration:.2f}s (starts at {clip_start_times[i]}s)")
        
        if not video_clips:
            print("❌ No video clips to stitch")
            return None
        
        # Build audio layers FIRST (before stripping audio from clips)
        audio_clips = []
        
        # OmniHuman clips have embedded audio - extract it with normalization
        print(f"\n  Extracting embedded audio from clips:")
        AUDIO_BUFFER = 0.04  # 40ms buffer to prevent boundary artifacts
        
        for i, clip in enumerate(video_clips):
            if clip.audio is not None:
                start_time = clip_start_times.get(i, 0)
                actual_video_duration = clip.duration
                
                # CRITICAL: Trim embedded audio to ensure clean boundaries
                # Use 40ms buffer to prevent sample alignment issues at clip boundaries
                target_duration = min(clip.audio.duration, actual_video_duration) - AUDIO_BUFFER
                target_duration = max(target_duration, 0.1)  # Minimum 100ms
                
                if clip.audio.duration > target_duration:
                    clip_audio = clip.audio.subclip(0, target_duration)
                else:
                    clip_audio = clip.audio
                
                actual_audio_duration = clip_audio.duration
                
                # Normalize audio volume for consistency
                print(f"    Clip {i}: Normalizing embedded voiceover volume...")
                clip_audio = normalize_audio_clip(clip_audio, target_rms_db=-20.0)
                
                # Apply fade in/out to prevent clicks/pops at clip boundaries
                fade_duration = min(0.05, clip_audio.duration * 0.05)  # 50ms or 5% of duration
                clip_audio = clip_audio.audio_fadein(fade_duration).audio_fadeout(fade_duration)
                
                # CRITICAL: Use actual audio duration for end time
                clip_end_time = start_time + actual_audio_duration
                clip_audio = clip_audio.set_start(start_time).set_end(clip_end_time)
                
                audio_clips.append(clip_audio)
                print(f"    Clip {i}: embedded audio ({actual_audio_duration:.2f}s, starts at {start_time}s, ends at {clip_end_time:.2f}s)")
            else:
                print(f"    Clip {i}: ⚠️ No audio found in video")
        
        # Remove audio from video clips before concatenation (we'll add it back in the composite)
        # This prevents audio duplication and noise/pops at stitching boundaries
        # Also resize all clips to OUTPUT_SIZE to prevent black borders
        print(f"\n  Preparing clips for concatenation (stripping audio, resizing):")
        video_clips_no_audio = []
        for i, clip in enumerate(video_clips):
            # Resize clip to target resolution to prevent black borders
            clip_size = clip.size
            if clip_size != OUTPUT_SIZE:
                print(f"    Resizing clip {i} from {clip_size} to {OUTPUT_SIZE}")
                clip = clip.resize(OUTPUT_SIZE)
            
            # CRITICAL: Remove audio from ALL video clips before concatenation
            # We manage all audio separately (embedded audio extraction + music)
            # Leaving any audio on clips can cause noise/pops at stitching boundaries
            video_clips_no_audio.append(clip.set_audio(None))
            print(f"    Clip {i}: stripped audio, ready for concatenation")
        
        # Concatenate video clips (all audio stripped - we add it back via CompositeAudioClip)
        final_video = concatenate_videoclips(video_clips_no_audio, method="compose")
        print(f"  Combined video duration: {final_video.duration}s")
        
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
                
                print(f"  🎵 Using ONLY first music group '{first_group_name}' for entire video")
                print(f"     Original music duration: {music.duration:.1f}s")
                print(f"     Total video duration: {total_video_duration:.1f}s")
                
                # Apply fade to original music BEFORE looping to ensure smooth loop transitions
                music_fade = min(0.05, music.duration * 0.02)  # 50ms or 2% of duration
                music = music.audio_fadein(music_fade).audio_fadeout(music_fade)
                
                # Loop music to cover entire video duration
                if music.duration < total_video_duration:
                    loops_needed = int(total_video_duration / music.duration) + 1
                    music_parts = [music] * loops_needed
                    music = concatenate_audioclips(music_parts)
                    print(f"     Looped music {loops_needed}x to cover video")
                
                # Trim to exact video duration
                music = music.subclip(0, min(music.duration, total_video_duration))
                
                # Apply final fade to the complete music track
                final_music_fade = min(0.1, music.duration * 0.01)  # 100ms or 1% for overall track
                music = music.audio_fadein(final_music_fade).audio_fadeout(final_music_fade)
                
                # Start music at beginning of video and set volume very low
                music = music.set_start(0)
                music = music.volumex(0.04)  # Very low volume for background (25:1 ratio with voiceover at 1.0)
                
                audio_clips.append(music)
                print(f"  ✅ Added music '{first_group_name}': {music.duration:.1f}s (looped throughout entire video)")
        else:
            print(f"  ⚠️ No music groups available")
        
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


# ============================================
# TRANSLITERATION
# ============================================

def transliterate_transcription_words(transcription_data, language_code: str = "hi", language_name: str = "Hindi") -> bool:
    """
    Transliterate transcription words from non-English scripts to English using GPT-4o-mini.
    """
    if not transcription_data or not hasattr(transcription_data, 'words') or not transcription_data.words:
        return False
    
    words_to_transliterate = []
    word_indices = []
    
    for i, word_data in enumerate(transcription_data.words):
        if hasattr(word_data, 'word'):
            word_text = word_data.word
            has_non_ascii = any(
                '\u0900' <= char <= '\u097F' or  # Devanagari
                '\u0600' <= char <= '\u06FF' or  # Arabic
                '\u4E00' <= char <= '\u9FFF' or  # CJK
                '\u3040' <= char <= '\u309F' or  # Hiragana
                '\u30A0' <= char <= '\u30FF' or  # Katakana
                '\uAC00' <= char <= '\uD7AF'     # Hangul
                for char in word_text
            )
            if has_non_ascii:
                words_to_transliterate.append(word_text)
                word_indices.append(i)
    
    if not words_to_transliterate:
        return False
    
    print(f"  🔤 Transliterating {len(words_to_transliterate)} words to English...")
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=openai_api_key)
        
        combined_text = " | ".join(words_to_transliterate)
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": f"You are an expert transliterator. Convert {language_name} text to English Roman script using ONLY ASCII characters (a-z, A-Z). Use simple phonetic spelling with double vowels for long sounds. Return the transliterated text in the same format (separated by ' | ')."
                },
                {
                    "role": "user",
                    "content": f"Transliterate this {language_name} text to English:\n{combined_text}"
                }
            ],
            temperature=0.2,
            max_tokens=5000
        )
        
        transliterated_result = response.choices[0].message.content.strip()
        
        if len(words_to_transliterate) > 1:
            transliterated_texts = [t.strip() for t in transliterated_result.split('|')]
        else:
            transliterated_texts = [transliterated_result]
        
        for idx, transliterated in zip(word_indices, transliterated_texts):
            if idx < len(transcription_data.words):
                word_obj = transcription_data.words[idx]
                if hasattr(word_obj, 'word'):
                    word_obj.word = transliterated
        
        print(f"  ✅ Transliteration complete: {len(transliterated_texts)} words converted")
        return True
        
    except Exception as e:
        print(f"  ⚠️ Transliteration failed: {e}")
        return False


def apply_captions_to_clip(
    video_path: str,
    caption_combination: str,
    language_code: str = "hi",
    temp_dir: str = None,
    audio_path: Optional[str] = None,
    transliterate: bool = False,
    language_name: str = "Hindi"
) -> Optional[str]:
    """Apply captions to a video clip."""
    if not video_path or not os.path.exists(video_path):
        return None
    
    combo = find_combination(caption_combination)
    if not combo:
        print(f"  ⚠️ Caption combination '{caption_combination}' not found")
        return video_path
    
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
        styler = VideoCaptionStyler(video_path, output_path, api_key=openai_api_key)
        
        if audio_path and os.path.exists(audio_path):
            print(f"  🔊 Using separate audio for transcription: {os.path.basename(audio_path)}")
            transcription = styler.transcribe_audio(audio_path=audio_path, language=language_code)
        else:
            transcription = styler.transcribe_audio(language=language_code)
        
        if not transcription:
            print(f"  ⚠️ Failed to transcribe audio")
            return video_path
        
        if transliterate and language_code != "en":
            transliterate_transcription_words(styler.transcription_data, language_code, language_name)
        
        if combo['effect'] == 'karaoke':
            max_words = 4
        else:
            max_words = 2
        
        styler.auto_generate_captions(
            max_words_per_caption=max_words,
            style_preset=combo['style'],
            word_effect=combo['effect']
        )
        
        styler.render(quality="high")
        
        if os.path.exists(output_path):
            print(f"  ✅ Captions applied: {combo['name']}")
            return output_path
        else:
            return video_path
            
    except Exception as e:
        print(f"  ⚠️ Failed to apply captions: {e}")
        return video_path


# ============================================
# MAIN PIPELINE
# ============================================

def generate_avatar_video(
    input_file: str,
    reference_image: str,
    output_path: str,
    language_code: str = "hi",
    voice_id: str = DEFAULT_VOICE_ID,
    speed: float = 1.0,
    user_instruction: Optional[str] = None,
    captions: Optional[str] = None,
    transliterate: bool = False,
    desired_duration: Optional[str] = None,
    voiceover_emotions: bool = True,
    audio_model: str = "v3",
    split_proportion: float = 0.3
) -> Optional[str]:
    """
    Main pipeline to generate AI avatar video.
    
    Args:
        input_file: Path to input script (PDF, DOCX, TXT)
        reference_image: Path to reference influencer image
        output_path: Path to output video
        language_code: Language code for voiceover
        voice_id: ElevenLabs voice ID
        speed: Voice speed multiplier (default: 1.0)
        user_instruction: Optional instruction for Grok
        captions: Caption style name
        transliterate: Whether to transliterate captions
        desired_duration: Target duration
        voiceover_emotions: Whether to include emotional expressions in voiceover
        audio_model: ElevenLabs model - "v3", "v2", or "turbo"
        split_proportion: Proportion of clips with split compositions / B-roll (0.0-1.0)
    """
    
    language_name = SUPPORTED_LANGUAGES.get(language_code, "Hindi")
    
    print(f"\n{'='*80}")
    print(f"🎬 AI AVATAR VIDEO GENERATOR")
    print(f"{'='*80}")
    print(f"  Input Script: {input_file}")
    print(f"  Reference Image: {reference_image}")
    print(f"  Output: {output_path}")
    print(f"  Language: {language_name} ({language_code})")
    print(f"  Voice ID: {voice_id[:20]}...")
    if speed != 1.0:
        print(f"  Voice Speed: {speed}x")
    if user_instruction:
        print(f"  Instruction: {user_instruction[:100]}{'...' if len(user_instruction) > 100 else ''}")
    
    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="ai_avatar_video_")
    print(f"  Temp directory: {temp_dir}")
    
    # Initialize S3 helper
    s3_helper = S3Helper(project_name="ai_avatar_video")
    
    try:
        # Step 1: Upload reference image to S3
        print(f"\n{'='*60}")
        print(f"📤 STEP 1: UPLOAD REFERENCE IMAGE TO S3")
        print(f"{'='*60}")
        
        if not os.path.exists(reference_image):
            raise ValueError(f"Reference image not found: {reference_image}")
        
        reference_image_s3_url = s3_helper.upload_file(reference_image, "image", "reference")
        if not reference_image_s3_url:
            raise ValueError("Failed to upload reference image to S3")
        
        print(f"  ✅ Reference image uploaded: {reference_image_s3_url[:80]}...")
        
        # Step 2: Extract text from input file
        print(f"\n{'='*60}")
        print(f"📄 STEP 2: TEXT EXTRACTION")
        print(f"{'='*60}")
        
        script_text = extract_text_from_file(input_file)
        if not script_text:
            raise ValueError("Failed to extract text from input file")
        
        # Step 3: Generate video plan with Grok
        print(f"\n{'='*60}")
        print(f"🤖 STEP 3: VIDEO PLAN GENERATION")
        print(f"{'='*60}")
        
        video_plan = analyze_script_and_generate_plan(
            script_text, language_code, user_instruction, desired_duration, voiceover_emotions, split_proportion
        )
        
        # Step 4: Generate voiceovers for all clips
        print(f"\n{'='*60}")
        print(f"🎙️ STEP 4: VOICEOVER GENERATION")
        print(f"{'='*60}")
        
        clip_voiceover_texts = []
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            voiceover = clip.get('voiceover', '')
            if voiceover and voiceover.strip():
                clip_voiceover_texts.append({
                    'clip_number': clip_num,
                    'voiceover_text': voiceover
                })
        
        voiceover_files = generate_voiceover_per_clip(
            clip_voiceover_texts, temp_dir, language_code, voice_id, speed, audio_model=audio_model
        )
        
        print(f"\n  ✅ Generated voiceovers for {len(voiceover_files)} clips")
        
        # Upload voiceovers to S3
        voiceover_s3_urls = {}
        for clip_num, vo_info in voiceover_files.items():
            vo_path = vo_info.get('path')
            if vo_path:
                s3_url = s3_helper.upload_file(vo_path, "audio", f"voiceover_clip_{clip_num}")
                if s3_url:
                    voiceover_s3_urls[clip_num] = s3_url
                    print(f"  ✅ Uploaded voiceover clip {clip_num} to S3")
        
        # Step 5: Generate images for all clips
        print(f"\n{'='*60}")
        print(f"🖼️ STEP 5: IMAGE GENERATION")
        print(f"{'='*60}")
        
        clip_data = []
        first_generated_image_s3_url = None
        
        for clip in video_plan.get('clips', []):
            clip_num = clip.get('clip_number', 0)
            # Duration is just an estimate - actual duration determined by audio length (OmniHuman flexibility)
            estimated_duration = clip.get('estimated_duration_seconds') or clip.get('duration_seconds', 'flexible')
            image_prompt = clip.get('image_prompt', '')
            voiceover = clip.get('voiceover', '')
            activity_prompt = clip.get('activity_prompt')  # Optional activity for OmniHuman
            
            print(f"\n  --- Clip {clip_num} (estimated ~{estimated_duration}s, actual determined by audio) ---")
            if activity_prompt:
                print(f"      Activity: {activity_prompt[:60]}...")
            
            image_path = os.path.join(temp_dir, f"clip_{clip_num}_image.png")
            
            # First clip: use nano-banana-pro
            # Subsequent clips: use nano-banana-pro/edit with reference
            # ALWAYS use nano-banana-pro/edit with reference image from CLI
            # This ensures character consistency across ALL clips
            print(f"      Using nano-banana-pro/edit (with reference influencer from CLI)")
            image_result = generate_image_with_nano_banana_edit(
                image_prompt, image_path, [reference_image_s3_url], aspect_ratio="9:16"
            )
            
            # Upload generated image to S3
            image_s3_url = None
            if image_result:
                image_s3_url = s3_helper.upload_file(image_result, "image", f"clip_{clip_num}")
                if clip_num == 0:
                    first_generated_image_s3_url = image_s3_url
            
            clip_data.append({
                'clip_number': clip_num,
                'estimated_duration': estimated_duration,
                'image_path': image_result,
                'image_s3_url': image_s3_url,
                'voiceover': voiceover,
                'activity_prompt': activity_prompt
            })
        
        # Step 6: Generate avatar videos with OmniHuman 1.5
        print(f"\n{'='*60}")
        print(f"🎬 STEP 6: AVATAR VIDEO GENERATION (OmniHuman 1.5)")
        print(f"{'='*60}")
        
        clip_paths = []
        actual_clip_durations = {}
        
        for clip_info in clip_data:
            clip_num = clip_info['clip_number']
            estimated_duration = clip_info.get('estimated_duration', 'flexible')
            image_s3_url = clip_info.get('image_s3_url')
            
            print(f"\n  --- Creating video for Clip {clip_num} (duration determined by audio) ---")
            
            if not image_s3_url:
                print(f"  ⚠️ Skipping clip {clip_num} - no image")
                clip_paths.append(None)
                continue
            
            # Get voiceover S3 URL
            audio_s3_url = voiceover_s3_urls.get(clip_num)
            if not audio_s3_url:
                print(f"  ⚠️ Skipping clip {clip_num} - no voiceover")
                clip_paths.append(None)
                continue
            
            video_path = os.path.join(temp_dir, f"clip_{clip_num}.mp4")
            
            # Get activity prompt if available
            activity_prompt = clip_info.get('activity_prompt')
            
            # Generate avatar video with OmniHuman 1.5
            video_result = generate_avatar_video_omnihuman(
                image_url=image_s3_url,
                audio_url=audio_s3_url,
                output_path=video_path,
                resolution="720p",
                activity_prompt=activity_prompt
            )
            
            if video_result:
                # Get actual duration (OmniHuman determines this from audio length)
                try:
                    test_clip = VideoFileClip(video_result)
                    actual_duration = test_clip.duration
                    test_clip.close()
                    actual_clip_durations[clip_num] = actual_duration
                    print(f"      ✅ Actual clip duration: {actual_duration:.2f}s (auto-matched to audio)")
                except:
                    # Fallback to estimated if we can't read the actual duration
                    fallback_duration = estimated_duration if isinstance(estimated_duration, (int, float)) else 10
                    actual_clip_durations[clip_num] = fallback_duration
                
                # Apply captions if requested
                if captions:
                    print(f"  📝 Applying captions ({captions}) to clip {clip_num}...")
                    vo_path = voiceover_files.get(clip_num, {}).get('path')
                    captioned_path = apply_captions_to_clip(
                        video_result, captions, language_code, temp_dir,
                        audio_path=vo_path, transliterate=transliterate,
                        language_name=language_name
                    )
                    if captioned_path and captioned_path != video_result:
                        video_result = captioned_path
                
                clip_paths.append(video_result)
            else:
                clip_paths.append(None)
        
        # Filter out None values
        valid_clip_paths = [p for p in clip_paths if p]
        
        if not valid_clip_paths:
            raise ValueError("No clips were generated successfully")
        
        # Step 7: Generate background music
        print(f"\n{'='*60}")
        print(f"🎵 STEP 7: MUSIC GENERATION")
        print(f"{'='*60}")
        
        music_groups = video_plan.get('music_groups', {})
        music_files = {}
        
        for group_name, group_info in music_groups.items():
            group_clips = group_info.get('clips', [])
            group_duration = sum(actual_clip_durations.get(c, 4) for c in group_clips)
            group_duration = min(group_duration, 20)
            
            if group_duration > 0:
                music_prompt = group_info.get('prompt', 
                    f"{group_info.get('mood', 'upbeat')} {group_info.get('tempo', 'medium')} background music")
                
                print(f"\n  🎵 Music Group: {group_name}")
                print(f"     Clips: {group_clips}")
                print(f"     Duration: {group_duration:.1f}s")
                
                music_path = os.path.join(temp_dir, f"music_{group_name}.mp3")
                result = generate_background_music(music_prompt, int(group_duration), music_path)
                
                if result:
                    music_files[group_name] = {
                        'path': result,
                        'clips': group_clips,
                        'duration': group_duration
                    }
        
        print(f"\n  ✅ Generated {len(music_files)} music tracks")
        
        # Build clip-to-music mapping
        clip_music_mapping = {}
        for group_name, group_info in music_groups.items():
            for clip_num in group_info.get('clips', []):
                clip_music_mapping[clip_num] = group_name
        
        # Step 7.5: Save individual clip assets
        print(f"\n{'='*60}")
        print(f"💾 STEP 7.5: SAVING INDIVIDUAL CLIP ASSETS")
        print(f"{'='*60}")
        
        # Create assets directory in ai/output folder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(script_dir, "output")
        os.makedirs(output_dir, exist_ok=True)
        
        # Create assets folder based on output video name
        base_name = os.path.splitext(os.path.basename(output_path))[0]
        assets_dir = os.path.join(output_dir, f"{base_name}_assets")
        os.makedirs(assets_dir, exist_ok=True)
        print(f"  Assets directory: {assets_dir}")
        
        # Create clip_data mapping (clip_number -> clip_info)
        clip_data_map = {clip['clip_number']: clip for clip in video_plan.get('clips', [])}
        
        # Save raw assets (comprehensive for regeneration)
        raw_assets_dir = os.path.join(assets_dir, "raw_assets")
        os.makedirs(raw_assets_dir, exist_ok=True)
        
        import shutil
        import glob as glob_module
        
        # Save input script text (for reference and potential re-generation)
        print(f"\n  Saving input context...")
        context_path = os.path.join(raw_assets_dir, "input_context.txt")
        with open(context_path, 'w') as f:
            f.write(script_text)
        print(f"    ✅ Saved: input_context.txt ({len(script_text)} chars)")
        
        # Save raw video clips (OmniHuman-generated clips before final stitching)
        print(f"\n  Saving raw video clips...")
        raw_video_dir = os.path.join(raw_assets_dir, "videos")
        os.makedirs(raw_video_dir, exist_ok=True)
        for i, clip_path in enumerate(valid_clip_paths):
            if clip_path and os.path.exists(clip_path):
                dest_path = os.path.join(raw_video_dir, f"clip_{i}_raw.mp4")
                shutil.copy2(clip_path, dest_path)
                print(f"    ✅ Saved: videos/clip_{i}_raw.mp4")
        
        # Save raw images (generated starting images for each clip)
        print(f"\n  Saving raw images...")
        raw_images_dir = os.path.join(raw_assets_dir, "images")
        os.makedirs(raw_images_dir, exist_ok=True)
        for clip_info_item in clip_data:
            clip_num = clip_info_item['clip_number']
            image_path = clip_info_item.get('image_path')
            if image_path and os.path.exists(image_path):
                dest_name = f"clip_{clip_num}_image.png"
                dest_path = os.path.join(raw_images_dir, dest_name)
                shutil.copy2(image_path, dest_path)
                print(f"    ✅ Saved: images/{dest_name}")
        
        # Save voiceover files
        print(f"\n  Saving raw voiceover files...")
        voiceovers_dir = os.path.join(raw_assets_dir, "voiceovers")
        os.makedirs(voiceovers_dir, exist_ok=True)
        for clip_num, vo_info in voiceover_files.items():
            vo_path = vo_info.get('path')
            if vo_path and os.path.exists(vo_path):
                dest_path = os.path.join(voiceovers_dir, f"voiceover_clip_{clip_num}.mp3")
                shutil.copy2(vo_path, dest_path)
                print(f"    ✅ Saved: voiceovers/voiceover_clip_{clip_num}.mp3")
        
        # Save music files
        print(f"\n  Saving raw music files...")
        music_dir = os.path.join(raw_assets_dir, "music")
        os.makedirs(music_dir, exist_ok=True)
        for group_name, music_info in music_files.items():
            music_path = music_info.get('path')
            if music_path and os.path.exists(music_path):
                dest_path = os.path.join(music_dir, f"music_{group_name}.mp3")
                shutil.copy2(music_path, dest_path)
                print(f"    ✅ Saved: music/music_{group_name}.mp3")
                # Save music group info
                music_info_path = os.path.join(music_dir, f"music_{group_name}_info.json")
                with open(music_info_path, 'w') as f:
                    json.dump({
                        'group_name': group_name,
                        'clips': music_info.get('clips', []),
                        'duration': music_info.get('duration', 0)
                    }, f, indent=2)
                print(f"    ✅ Saved: music/music_{group_name}_info.json")
        
        # Save master metadata (all information for regeneration)
        print(f"\n  Saving master metadata...")
        master_metadata = {
            'generator': 'ai_avatar_video_generator',  # Identifies which script generated this
            'generation_params': {
                'language_code': language_code,
                'language_name': SUPPORTED_LANGUAGES.get(language_code, "Unknown"),
                'voice_id': voice_id,
                'speed': speed,
                'captions': captions,
                'transliterate': transliterate,
                'voiceover_emotions': voiceover_emotions,
                'audio_model': audio_model,
                'desired_duration': desired_duration,
                'user_instruction': user_instruction,
                'split_proportion': split_proportion,
                'reference_image': reference_image
            },
            'clip_count': len(valid_clip_paths),
            'total_duration': sum(actual_clip_durations.values()),
            'clips': [],
            'voiceover_files': {},
            'music_files': {},
            'clip_music_mapping': clip_music_mapping
        }
        
        # Add comprehensive clip data
        for clip_info_item in video_plan.get('clips', []):
            clip_num = clip_info_item.get('clip_number', 0)
            clip_metadata = {
                'clip_number': clip_num,
                'duration': actual_clip_durations.get(clip_num, 0),
                'planned_duration': clip_info_item.get('estimated_duration_seconds', 0),
                'voiceover_text': clip_info_item.get('voiceover', ''),
                'image_prompt': clip_info_item.get('image_prompt', ''),
                'activity_prompt': clip_info_item.get('activity_prompt', ''),
                'expression': clip_info_item.get('expression', ''),
                'camera_angle': clip_info_item.get('camera_angle', ''),
                'lighting': clip_info_item.get('lighting', ''),
                'hook_type': clip_info_item.get('hook_type', ''),
                'visual_change_reason': clip_info_item.get('visual_change_reason', ''),
                'split_composition': clip_info_item.get('split_composition', {}),
                'voiceover_embedded': True,  # OmniHuman always embeds voiceover
                'raw_video_path': f"videos/clip_{clip_num}_raw.mp4",
                'raw_image_path': f"images/clip_{clip_num}_image.png"
            }
            master_metadata['clips'].append(clip_metadata)
        
        # Add voiceover file info
        for clip_num, vo_info in voiceover_files.items():
            master_metadata['voiceover_files'][str(clip_num)] = {
                'embedded': True,  # OmniHuman always embeds voiceover
                'duration': vo_info.get('duration', 0),
                'path': f"voiceovers/voiceover_clip_{clip_num}.mp3"
            }
        
        # Add music file info
        for group_name, music_info in music_files.items():
            master_metadata['music_files'][group_name] = {
                'clips': music_info.get('clips', []),
                'duration': music_info.get('duration', 0),
                'path': f"music/music_{group_name}.mp3"
            }
        
        master_metadata_path = os.path.join(raw_assets_dir, "master_metadata.json")
        with open(master_metadata_path, 'w') as f:
            json.dump(master_metadata, f, indent=2)
        print(f"    ✅ Saved: master_metadata.json")
        
        # Save video plan JSON (Grok-generated plan)
        print(f"\n  Saving video plan...")
        video_plan_path = os.path.join(raw_assets_dir, "video_plan.json")
        with open(video_plan_path, 'w') as f:
            json.dump(video_plan, f, indent=2)
        print(f"    ✅ Saved: video_plan.json")
        
        # Save each clip as a complete asset (video + voiceover embedded)
        print(f"\n  Saving complete clip assets...")
        for i, clip_path in enumerate(valid_clip_paths):
            if not clip_path or not os.path.exists(clip_path):
                continue
            
            clip_info = clip_data_map.get(i, {})
            clip_num = clip_info.get('clip_number', i)
            
            # Create clip-specific folder
            clip_folder = os.path.join(assets_dir, f"clip_{clip_num}")
            os.makedirs(clip_folder, exist_ok=True)
            
            asset_path = os.path.join(clip_folder, f"clip_{clip_num}_complete.mp4")
            
            try:
                # Load video clip (already has embedded audio from OmniHuman)
                video_clip = VideoFileClip(clip_path)
                clip_duration = actual_clip_durations.get(clip_num, video_clip.duration)
                
                # For avatar clips, voiceover is already embedded - just copy
                # Write the clip with its embedded audio
                video_clip.write_videofile(
                    asset_path,
                    fps=FPS,
                    codec='libx264',
                    audio_codec='aac',
                    preset='medium',
                    bitrate='8000k',
                    verbose=False,
                    logger=None
                )
                video_clip.close()
                
                # Save clip metadata
                metadata_path = os.path.join(clip_folder, f"clip_{clip_num}_metadata.json")
                with open(metadata_path, 'w') as f:
                    json.dump({
                        'clip_number': clip_num,
                        'duration': clip_duration,
                        'voiceover': clip_info.get('voiceover', ''),
                        'image_prompt': clip_info.get('image_prompt', ''),
                        'hook_type': clip_info.get('hook_type', ''),
                        'expression': clip_info.get('expression', ''),
                        'camera_angle': clip_info.get('camera_angle', ''),
                        'activity_prompt': clip_info.get('activity_prompt', ''),
                        'split_composition': clip_info.get('split_composition', {}),
                        'music_group': clip_music_mapping.get(clip_num, ''),
                        'voiceover_embedded': True  # OmniHuman always embeds voiceover
                    }, f, indent=2)
                
                print(f"  ✅ Saved asset: clip_{clip_num}/clip_{clip_num}_complete.mp4 ({clip_duration:.2f}s)")
                
            except Exception as e:
                print(f"  ⚠️ Failed to save asset for clip {clip_num}: {e}")
                import traceback
                print(traceback.format_exc())
        
        # Also save video_plan.json in the assets root for backwards compatibility
        video_plan_root_path = os.path.join(assets_dir, "video_plan.json")
        with open(video_plan_root_path, 'w') as f:
            json.dump(video_plan, f, indent=2)
        
        print(f"\n  ✅ Saved {len([c for c in valid_clip_paths if c])} clip assets to {assets_dir}")
        print(f"  📁 Assets structure:")
        print(f"     - {assets_dir}/raw_assets/")
        print(f"       - input_context.txt (original script text)")
        print(f"       - master_metadata.json (all generation params & clip info)")
        print(f"       - video_plan.json (Grok-generated video plan)")
        print(f"       - videos/clip_*_raw.mp4 (raw OmniHuman video clips)")
        print(f"       - images/clip_*_image.png (generated starting images)")
        print(f"       - voiceovers/voiceover_clip_*.mp3 (voiceover audio files)")
        print(f"       - music/music_*.mp3 (background music files)")
        print(f"     - {assets_dir}/clip_*/ (complete clip assets with embedded audio)")
        print(f"     - {assets_dir}/video_plan.json (Grok-generated video plan)")
        
        # Step 8: Stitch everything together
        print(f"\n{'='*60}")
        print(f"🎬 STEP 8: VIDEO STITCHING")
        print(f"{'='*60}")
        
        final_video = stitch_video_clips_with_music(
            clip_paths=valid_clip_paths,
            clip_durations=actual_clip_durations,
            voiceover_files=voiceover_files,
            music_files=music_files,
            clip_music_mapping=clip_music_mapping,
            output_path=output_path
        )
        
        if final_video:
            print(f"\n{'='*80}")
            print(f"🎉 VIDEO GENERATION COMPLETE!")
            print(f"{'='*80}")
            print(f"  Output: {output_path}")
            
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
        description="Generate AI avatar videos with character and voice consistency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ai_avatar_video_generator.py --input script.pdf --reference-image avatar.png --voiceid <voice_id> --output video.mp4
  python ai_avatar_video_generator.py -i script.txt -r influencer.jpg -v <voice_id> -o output.mp4 --language hi
  python ai_avatar_video_generator.py -i script.docx -r person.png -v <voice_id> -o video.mp4 --duration 30-45 --captions boxed_purple

Supported input formats:
  - PDF (.pdf)
  - Word Document (.docx, .doc)
  - Text File (.txt)

Supported languages (ISO 639-1 codes):
  hi = Hindi (default)    pa = Punjabi      bn = Bengali
  ta = Tamil              te = Telugu       mr = Marathi
  gu = Gujarati           kn = Kannada      ml = Malayalam
  or = Odia               en = English

Pipeline:
  1. Upload reference image to S3
  2. Extract script text from input file
  3. Grok generates video plan with prompts
  4. ElevenLabs v3 generates voiceovers (consistent voice)
  5. nano-banana-pro generates images (consistent character via reference)
  6. OmniHuman 1.5 generates lip-synced avatar videos
  7. ElevenLabs Sound Effects generates background music
  8. Stitch all clips together

Environment variables (from python-ai-backend/.env):
  - XAI_API_KEY: API key for Grok (xAI)
  - FAL_API_KEY: API key for FAL.ai
  - OPENAI_API_KEY: For Whisper transcription and transliteration
  - AWS_ACCESS_KEY_ID: AWS credentials for S3
  - AWS_SECRET_ACCESS_KEY: AWS credentials for S3
  - S3_BUCKET_NAME: S3 bucket name
  - AWS_REGION: AWS region (default: ap-south-1)
        """
    )
    
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Path to input script (PDF, DOCX, or TXT)"
    )
    
    parser.add_argument(
        "--reference-image", "-r",
        required=True,
        help="Path to reference influencer image for character consistency"
    )
    
    parser.add_argument(
        "--output", "-o",
        help="Path to output video (default: input_name_avatar_video.mp4)"
    )
    
    parser.add_argument(
        "--voiceid", "-v",
        default=DEFAULT_VOICE_ID,
        help=f"ElevenLabs voice ID for consistent voiceover (default: {DEFAULT_VOICE_ID[:20]}...)"
    )
    
    parser.add_argument(
        "--language", "-l",
        default="hi",
        help="Language code for voiceover (ISO 639-1). Default: hi (Hindi)"
    )
    
    parser.add_argument(
        "--instruction",
        type=str,
        default=None,
        help="User instruction to guide prompt generation"
    )
    
    parser.add_argument(
        "--captions",
        type=str,
        default=None,
        help="Apply captions using a style combination (e.g., boxed_purple, karaoke_pink)"
    )
    
    parser.add_argument(
        "--transliterate",
        action="store_true",
        default=False,
        help="Transliterate non-English captions to English"
    )
    
    parser.add_argument(
        "--duration", "-d",
        type=str,
        default="30-60",
        help="Desired video duration in seconds. Range (e.g., '30-45') or single (e.g., '30'). Default: '30-60'"
    )
    
    parser.add_argument(
        "--speed", "-s",
        type=float,
        default=1.0,
        help="Voice speed multiplier for ElevenLabs TTS (default: 1.0, range: 0.5-2.0). E.g., 1.2 for 20%% faster speech"
    )
    
    parser.add_argument(
        "--audio-model",
        choices=["v3", "v2", "turbo"],
        default="v3",
        help="ElevenLabs TTS model to use for voiceover generation. Options: v3 (eleven-v3, default) - supports language codes and timestamps, v2 (multilingual-v2) - multilingual support, turbo (turbo-v2.5) - fastest generation. E.g., --audio-model turbo for turbo v2.5 model."
    )
    
    parser.add_argument(
        "--voiceover-emotions",
        action="store_true",
        default=False,
        help="OPTIONAL: Enable emotional expressions in voiceover text (square bracket expressions like [shocked], [pause], [excited]). If NOT provided, voiceovers will be plain text without emotional markers. When enabled, ElevenLabs TTS will use these expressions to make voice delivery more natural and human-like."
    )
    
    parser.add_argument(
        "--split-proportion",
        type=float,
        default=0.3,
        help="OPTIONAL: Proportion of clips that should have split compositions with B-roll visuals (default: 0.3 = 30%%). Range: 0.0-1.0. E.g., --split-proportion 0.4 means 40%% of clips will have influencer + context visuals side-by-side. Set to 0 for all talking-head clips."
    )
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.input):
        print(f"❌ Error: Input file not found: {args.input}")
        sys.exit(1)
    
    # Validate reference image
    if not os.path.exists(args.reference_image):
        print(f"❌ Error: Reference image not found: {args.reference_image}")
        sys.exit(1)
    
    # Check environment variables
    if not os.getenv('XAI_API_KEY'):
        print("❌ Error: XAI_API_KEY not set!")
        sys.exit(1)
    
    if not os.getenv('FAL_API_KEY'):
        print("❌ Error: FAL_API_KEY not set!")
        sys.exit(1)
    
    if not aws_access_key_id or not aws_secret_access_key:
        print("⚠️ Warning: AWS credentials not set - S3 uploads may fail")
    
    # Validate language
    if args.language not in SUPPORTED_LANGUAGES:
        print(f"❌ Error: Unsupported language: {args.language}")
        print(f"Supported: {', '.join([f'{k} ({v})' for k, v in SUPPORTED_LANGUAGES.items()])}")
        sys.exit(1)
    
    print(f"🌐 Language: {SUPPORTED_LANGUAGES[args.language]} ({args.language})")
    print(f"🎙️ Voice ID: {args.voiceid[:20]}...")
    audio_model_display = {"v3": "ElevenLabs v3", "v2": "Multilingual v2", "turbo": "Turbo v2.5"}.get(args.audio_model, "v3")
    print(f"🔊 Audio Model: {audio_model_display}")
    if args.speed != 1.0:
        print(f"⚡ Voice Speed: {args.speed}x")
    if args.voiceover_emotions:
        print(f"😊 Voiceover Emotions: ENABLED (square bracket expressions)")
    split_pct = int(args.split_proportion * 100)
    print(f"🖼️ Split/B-roll Proportion: {split_pct}% of clips")
    
    # Set output path
    if args.output:
        output_path = args.output
    else:
        base_name = os.path.splitext(os.path.basename(args.input))[0]
        output_dir = os.path.dirname(args.input) or "."
        output_path = os.path.join(output_dir, f"{base_name}_avatar_video.mp4")
    
    # Validate caption combination
    if args.captions:
        combo = find_combination(args.captions)
        if not combo:
            print(f"❌ Error: Caption combination '{args.captions}' not found!")
            print(f"\nAvailable combinations:")
            for c in COMBINATIONS:
                print(f"  - {c['name']}: {c['description']}")
            sys.exit(1)
        print(f"📝 Captions: {combo['name']}")
        if args.transliterate:
            print(f"🔤 Transliteration: ENABLED")
    
    # Generate video
    result = generate_avatar_video(
        input_file=args.input,
        reference_image=args.reference_image,
        output_path=output_path,
        language_code=args.language,
        voice_id=args.voiceid,
        speed=args.speed,
        user_instruction=args.instruction,
        captions=args.captions,
        transliterate=args.transliterate,
        desired_duration=args.duration,
        voiceover_emotions=args.voiceover_emotions,
        audio_model=args.audio_model,
        split_proportion=args.split_proportion
    )
    
    if result:
        print(f"\n✅ Success! Video saved to: {result}")
        sys.exit(0)
    else:
        print(f"\n❌ Failed to generate video")
        sys.exit(1)


if __name__ == "__main__":
    main()

