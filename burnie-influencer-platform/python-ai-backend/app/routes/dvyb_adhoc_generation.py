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
from pydantic import BaseModel, Field
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
from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, concatenate_audioclips, CompositeVideoClip, CompositeAudioClip
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

# Max duration for video inspiration (15 seconds) - longer videos will be trimmed to this
MAX_VIDEO_INSPIRATION_DURATION = 15

# ============================================
# VIDEO LENGTH MODES & STORYTELLING FRAMEWORKS
# ============================================

# Video length mode configurations
VIDEO_LENGTH_MODES = {
    "quick": {
        "description": "Quick 8s single clip",
        "target_duration": 8,
        "min_clips": 1,
        "max_clips": 1,
        "framework": "hook_reveal"  # Condensed hook + reveal
    },
    "standard": {
        "description": "Standard 16s video (2 clips)",
        "target_duration": 16,
        "min_clips": 2,
        "max_clips": 2,
        "framework": "condensed_story"  # Hook → Build/Reveal → Payoff
    },
    "story": {
        "description": "Story-like 30-60s+ video (3-8 clips)",
        "target_duration": 45,  # Target middle of range
        "min_clips": 3,
        "max_clips": 8,  # Allow up to 8 clips for complex narratives (8 clips × 8s = 64s max)
        "framework": "full_7_beat"  # Full 7-beat storytelling arc (can extend beyond 7 beats)
    }
}

# Model duration capabilities
MODEL_DURATIONS = {
    "veo3.1": [4, 6, 8],  # Veo supports 4s, 6s, 8s
    "kling_v2.6": [5, 10]  # Kling supports 5s, 10s
}

# Category detection keywords for emotional triggers
CATEGORY_KEYWORDS = {
    "food": ["food", "restaurant", "cafe", "bakery", "coffee", "tea", "beverage", "drink", "meal", "cuisine", 
             "chef", "cooking", "recipe", "ice cream", "dessert", "snack", "pizza", "burger", "sushi", 
             "biryani", "curry", "chocolate", "candy", "catering", "kitchen", "dining"],
    "fashion": ["fashion", "clothing", "apparel", "shoes", "sneakers", "jewelry", "watch", "accessories",
                "handbag", "bag", "dress", "shirt", "pants", "jeans", "jacket", "coat", "hat", "cap",
                "sunglasses", "eyewear", "boutique", "style", "outfit", "wardrobe", "designer", "luxury"],
    "tech_gadget": ["tech", "technology", "gadget", "device", "electronic", "phone", "smartphone", "laptop",
                   "computer", "tablet", "headphone", "earbuds", "speaker", "camera", "drone", "smartwatch",
                   "gaming", "console", "software", "app", "saas", "ai", "robot", "iot"],
    "beauty_wellness": ["beauty", "skincare", "cosmetic", "makeup", "perfume", "fragrance", "spa", "wellness",
                       "salon", "hair", "nail", "serum", "cream", "lotion", "lipstick", "mascara"],
    "digital_service": ["agency", "consulting", "marketing", "design", "development", "service", "studio",
                       "creative", "branding", "advertising", "seo", "social media", "content", "strategy",
                       "freelance", "coach", "mentor", "course", "education", "training"]
}

# Category-specific emotional triggers and visual strategies
CATEGORY_STORYTELLING = {
    "food": {
        "emotions": ["comfort", "craving", "nostalgia", "joy", "satisfaction", "warmth"],
        "visual_levers": ["slow-mo pour/drizzle", "steam rising", "texture closeups", "sizzle shots", 
                         "ingredient showcase", "bite moments", "golden cheese pull"],
        "hook_styles": ["sensory tease", "craving trigger", "comfort promise", "secret ingredient"],
        "goal": "Make viewer salivate and crave the product"
    },
    "fashion": {
        "emotions": ["confidence", "identity", "transformation", "aspiration", "self-expression"],
        "visual_levers": ["before→after transformation", "movement/flow", "glow-up moment", 
                         "slow-mo fabric flow", "confident strut", "mirror reveal"],
        "hook_styles": ["identity question", "transformation promise", "confidence unlock", "style upgrade"],
        "goal": "Make viewer feel they'd look and feel better with product"
    },
    "tech_gadget": {
        "emotions": ["power", "efficiency", "smartness", "control", "futuristic", "sleek"],
        "visual_levers": ["frustration→solution", "speed comparison", "feature reveal", 
                         "interface showcase", "seamless integration", "wow moment"],
        "hook_styles": ["problem statement", "life hack reveal", "future glimpse", "efficiency promise"],
        "goal": "Make viewer feel life becomes smarter and easier"
    },
    "beauty_wellness": {
        "emotions": ["self-care", "transformation", "radiance", "confidence", "luxury", "ritual"],
        "visual_levers": ["skin texture macro", "application ritual", "before→after glow", 
                         "sensory experience", "pampering moments", "mirror confidence"],
        "hook_styles": ["self-care invite", "transformation promise", "secret reveal", "glow trigger"],
        "goal": "Make viewer feel the transformation and self-care moment"
    },
    "digital_service": {
        "emotions": ["aspiration", "trust", "success", "growth", "relief", "empowerment"],
        "visual_levers": ["pain point dramatization", "success transformation", "results showcase",
                         "behind-the-scenes", "client testimonial style", "growth visualization"],
        "hook_styles": ["pain point call-out", "success story tease", "expertise flex", "outcome promise"],
        "goal": "Make viewer trust brand to grow their life/business"
    },
    "general": {
        "emotions": ["curiosity", "delight", "satisfaction", "trust", "connection"],
        "visual_levers": ["product hero shots", "lifestyle integration", "benefit demonstration",
                         "quality showcase", "user experience"],
        "hook_styles": ["curiosity trigger", "benefit tease", "problem solution", "value reveal"],
        "goal": "Connect viewer emotionally with the brand and product"
    }
}

# 7-Beat Storytelling Framework for Creative Director (lifestyle/UGC videos)
SEVEN_BEAT_FRAMEWORK = """
🎬 MANDATORY VIDEO STRUCTURE - 7-BEAT STORYTELLING ARC

You MUST structure videos following this emotional arc:

**BEAT 1 - HOOK (0-3s)**: Stop the scroll!
- Shock, humor, tension, or intrigue
- Relatable "that's so me" moment
- Pattern interrupt that demands attention
- Examples: "Nobody told me...", "POV: You finally...", "This literally changed..."

**BEAT 2 - PROBLEM/DESIRE BUILD (3-10s)**: Create emotional connection
- Expand the emotional feeling
- Make viewer think "this is about ME"
- Build tension or desire
- Show the pain point or aspiration

**BEAT 3 - ESCALATION (10-18s)**: Raise the stakes
- Add humor, deeper relatability, or increased tension
- "And then it got worse..." or "But wait..."
- Build anticipation for the solution

**BEAT 4 - TRANSITION/BEAT DROP (~18s)**: The mood shift
- Music change or tonal shift
- Visual transformation (lighting, color, energy)
- Emotional release point
- The "everything changed when..." moment

**BEAT 5 - PRODUCT REVEAL + PAYOFF (18-35s)**: The hero moment
- Product solves the emotional state
- Sensory/aspirational/lifestyle satisfaction
- Show transformation and benefit
- Cinematic product showcase

**BEAT 6 - PUNCHLINE/MESSAGE (35-42s)**: The memorable takeaway
- Crystallize the message
- Emotional resonance
- Brand positioning
- The line they'll remember

**BEAT 7 - CTA (42-45s)**: Call to action
- Clear next step
- Urgency or invitation
- Brand/product name mention
"""

# 3-Beat Product Framework for Photographer (product-centric videos)
THREE_BEAT_PRODUCT_FRAMEWORK = """
🎬 PRODUCT VIDEO STRUCTURE - 3-BEAT VISUAL SHOWCASE

For product-centric videos, follow this visual spectacle arc:

**BEAT 1 - INTRIGUE/REVEAL (0-3s)**: Create mystery
- Dramatic entrance from darkness/mist
- Blur to focus reveal
- Zoom or dolly reveal
- Silhouette to full reveal
- NO humans needed - product is the star

**BEAT 2 - GLORY/SHOWCASE (3-10s)**: The main event
- Hero shots with dramatic lighting
- Camera orbits (180° or 360°)
- Texture and detail macro shots
- Multiple angle transitions
- Slow-mo beauty moments
- Rim lighting, reflections, lens flares
- THIS IS THE MAIN EVENT - make it spectacular

**BEAT 3 - PAYOFF/FINALE (10-15s)**: The hero moment
- Final beauty shot at perfect angle
- Hold on hero composition
- Logo/branding reveal (optional)
- Seamless loop point (optional)
- Dramatic final lighting

PRODUCT VIDEO TYPES (LLM should choose based on product):
- **Hero Orbit**: Camera orbits 360° around product (watches, jewelry, bottles)
- **Dramatic Reveal**: Product emerges from darkness/mist (luxury, tech)
- **Texture Journey**: Macro camera travels across surface (fabric, leather, food)
- **Levitation/Float**: Product floating with dramatic lighting (cosmetics, perfumes)
- **Pour/Drip/Steam**: Sensory motion elements (food, beverages, skincare)
"""


def detect_brand_category(context: Dict) -> str:
    """
    Detect brand category from context for emotional targeting.
    Returns one of: food, fashion, tech_gadget, beauty_wellness, digital_service, general
    """
    dvyb_context = context.get("dvyb_context", {})
    
    # Gather text to analyze
    text_to_analyze = " ".join([
        str(dvyb_context.get("industry", "")),
        str(dvyb_context.get("businessOverview", "")),
        str(dvyb_context.get("popularProducts", "")),
        str(context.get("topic", "")),
        str(dvyb_context.get("accountName", "")),
        str(dvyb_context.get("website", "")),
    ]).lower()
    
    # Count keyword matches per category
    category_scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in text_to_analyze)
        category_scores[category] = score
    
    # Find highest scoring category
    if category_scores:
        best_category = max(category_scores, key=category_scores.get)
        if category_scores[best_category] > 0:
            return best_category
    
    return "general"


def get_storytelling_context(category: str, video_length_mode: str, is_product_flow: bool) -> Dict:
    """
    Get storytelling context based on category and video mode.
    Returns framework instructions and emotional triggers.
    """
    category_data = CATEGORY_STORYTELLING.get(category, CATEGORY_STORYTELLING["general"])
    mode_config = VIDEO_LENGTH_MODES.get(video_length_mode, VIDEO_LENGTH_MODES["standard"])
    
    if is_product_flow:
        # Use 3-beat product framework for Photographer persona
        framework = THREE_BEAT_PRODUCT_FRAMEWORK
        framework_type = "3-beat product showcase"
    else:
        # Use appropriate framework based on video length mode for Creative Director
        if video_length_mode == "quick":
            framework = """
🎬 QUICK VIDEO STRUCTURE (8s single clip)
- HOOK (0-2s): Instant attention grab
- REVEAL + PAYOFF (2-7s): Product/message showcase
- CTA (7-8s): Quick call to action or brand
Keep it punchy, impactful, loop-friendly!
"""
            framework_type = "quick hook-reveal"
        elif video_length_mode == "standard":
            framework = """
🎬 STANDARD VIDEO STRUCTURE (16s, 2 clips)

**CLIP 1 (8s)**: Hook + Problem/Desire
- 0-3s: Strong hook (shock, humor, relatability)
- 3-8s: Build tension/desire, escalate emotion

**CLIP 2 (8s)**: Resolution + Payoff
- 0-4s: Beat drop / transition moment
- 4-7s: Product reveal + satisfaction
- 7-8s: Punchline + CTA
"""
            framework_type = "condensed 4-beat"
        else:  # story mode
            framework = SEVEN_BEAT_FRAMEWORK
            framework_type = "full 7-beat"
    
    return {
        "category": category,
        "category_data": category_data,
        "framework": framework,
        "framework_type": framework_type,
        "mode_config": mode_config,
        "emotions": category_data["emotions"],
        "visual_levers": category_data["visual_levers"],
        "hook_styles": category_data["hook_styles"],
        "goal": category_data["goal"]
    }


def map_duration_to_model(requested_duration: int, model_name: str) -> int:
    """
    Map LLM-requested duration to actual model capabilities.
    Returns the closest supported duration for the given model.
    """
    supported = MODEL_DURATIONS.get(model_name, [8])
    
    # Find closest supported duration
    closest = min(supported, key=lambda x: abs(x - requested_duration))
    return closest


def calculate_clip_structure(video_length_mode: str, model_name: str) -> List[Dict]:
    """
    Calculate optimal clip structure based on video length mode and model.
    Returns list of clip configurations with durations.
    """
    mode_config = VIDEO_LENGTH_MODES.get(video_length_mode, VIDEO_LENGTH_MODES["standard"])
    target_duration = mode_config["target_duration"]
    min_clips = mode_config["min_clips"]
    max_clips = mode_config["max_clips"]
    
    supported_durations = MODEL_DURATIONS.get(model_name, [8])
    max_clip_duration = max(supported_durations)
    
    clips = []
    
    if video_length_mode == "quick":
        # Single 8s clip
        duration = map_duration_to_model(8, model_name)
        clips.append({"clip_num": 1, "duration": duration, "beat": "hook_reveal"})
    
    elif video_length_mode == "standard":
        # 2 clips, aim for 16s total
        duration = map_duration_to_model(8, model_name)
        clips.append({"clip_num": 1, "duration": duration, "beat": "hook_build"})
        clips.append({"clip_num": 2, "duration": duration, "beat": "reveal_payoff"})
    
    elif video_length_mode == "story":
        # 3-5 clips for 30-45s, use varied durations for rhythm
        if model_name == "veo3.1":
            # Veo: Use varied durations for cinematic feel
            # Hook (4s) → Build (6s) → Escalation (8s) → Reveal (8s) → Payoff (6s)
            clips = [
                {"clip_num": 1, "duration": 4, "beat": "hook"},
                {"clip_num": 2, "duration": 6, "beat": "problem_desire"},
                {"clip_num": 3, "duration": 8, "beat": "escalation_transition"},
                {"clip_num": 4, "duration": 8, "beat": "reveal_payoff"},
                {"clip_num": 5, "duration": 6, "beat": "punchline_cta"},
            ]
        else:
            # Kling: Use 5s and 10s clips
            # Hook (5s) → Build (10s) → Escalation+Transition (10s) → Reveal+Payoff (10s)
            clips = [
                {"clip_num": 1, "duration": 5, "beat": "hook"},
                {"clip_num": 2, "duration": 10, "beat": "problem_desire_escalation"},
                {"clip_num": 3, "duration": 10, "beat": "transition_reveal"},
                {"clip_num": 4, "duration": 10, "beat": "payoff_punchline_cta"},
            ]
    
    return clips


# ============================================
# VIDEO INSPIRATION PROCESSING
# ============================================

import re
import cv2
import yt_dlp

def is_video_platform_url(url: str) -> bool:
    """Check if URL is from a supported video platform (YouTube, Instagram, Twitter/X)"""
    patterns = [
        # Instagram
        r'instagram\.com/reel/',
        r'instagram\.com/p/',
        r'instagram\.com/tv/',
        r'instagr\.am/',
        # YouTube
        r'youtube\.com/shorts/',
        r'youtu\.be/',
        r'youtube\.com/watch',
        # Twitter/X
        r'twitter\.com/.+/status/',
        r'x\.com/.+/status/',
    ]
    return any(re.search(pattern, url) for pattern in patterns)


def download_inspiration_video(url: str, output_dir: str = "/tmp/dvyb-inspirations") -> tuple:
    """
    Download video from YouTube/Instagram/Twitter using yt-dlp.
    Returns (video_path, is_video) - is_video is False if it's an image.
    """
    os.makedirs(output_dir, exist_ok=True)
    output_filename = f"{output_dir}/inspiration_{uuid.uuid4().hex[:8]}.mp4"
    
    print(f"  📥 Downloading inspiration video...")
    print(f"     URL: {url[:80]}...")
    
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': output_filename,
        'quiet': True,
        'no_warnings': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            
            # Check if it's actually a video (has duration)
            duration = info.get('duration', 0)
            if duration == 0:
                print(f"  ⚠️ No video found at URL (might be an image post)")
                return (None, False)
            
            print(f"  ✅ Downloaded: {duration:.1f}s video")
            return (output_filename, True)
    except yt_dlp.utils.DownloadError as e:
        print(f"  ❌ Video download failed (yt-dlp error): {e}")
        print(f"     This may be due to: private content, geo-restrictions, or unsupported URL format")
        return (None, False)
    except Exception as e:
        print(f"  ❌ Video download failed (unexpected error): {type(e).__name__}: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        return (None, False)


def download_inspiration_image(url: str, output_dir: str = "/tmp/dvyb-inspirations") -> tuple:
    """
    Download image from Instagram/Twitter/any URL using multiple strategies.
    Returns (image_paths, is_image) - list of downloaded image paths or (None, False) if failed.
    For Instagram carousels, downloads only the first image.
    
    Strategy:
    - For direct image URLs (S3, CDN, etc.): Direct download
    - For Instagram/Twitter: Try yt-dlp → instaloader → web scraping
    - For regular URLs: Skip directly to web scraping (Strategy 3)
    """
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"  📥 Downloading inspiration image(s)...")
    print(f"     URL: {url[:80]}...")
    
    # Check if URL is a direct image file (S3, CDN, etc.) by file extension
    from urllib.parse import urlparse
    parsed_url = urlparse(url)
    path_lower = parsed_url.path.lower()
    image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
    is_direct_image_url = any(path_lower.endswith(ext) for ext in image_extensions)
    
    # STRATEGY 0: Direct download for direct image URLs (S3, CDN, etc.)
    if is_direct_image_url:
        print(f"  🔧 Strategy 0: Direct image URL detected - downloading directly...")
        try:
            import requests
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            response = requests.get(url, headers=headers, timeout=30, stream=True)
            response.raise_for_status()
            
            # Verify it's actually an image
            content_type = response.headers.get('content-type', '').lower()
            if 'image' not in content_type:
                print(f"  ⚠️ URL has image extension but content-type is: {content_type}")
                # Continue to other strategies
            else:
                # Determine file extension
                ext = None
                for img_ext in image_extensions:
                    if path_lower.endswith(img_ext):
                        ext = img_ext.lstrip('.')
                        break
                if not ext:
                    ext = 'jpg'  # Default
                
                # Save image
                img_path = os.path.join(output_dir, f"direct_image_{uuid.uuid4().hex[:8]}.{ext}")
                with open(img_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                print(f"  ✅ Direct download successful: {len(response.content)} bytes")
                return ([img_path], True)
        except Exception as e:
            print(f"  ⚠️ Direct download failed: {type(e).__name__}: {e}")
            # Continue to other strategies
    
    # Detect platform
    is_instagram = 'instagram.com' in url.lower()
    is_twitter = 'twitter.com' in url.lower() or 'x.com' in url.lower()
    is_social_media = is_instagram or is_twitter
    
    # Track redirect URL discovered by yt-dlp (for Twitter/X links that redirect to articles)
    discovered_redirect_url = None
    
    # For regular URLs (not social media), skip directly to Strategy 3 (web scraping)
    if not is_social_media:
        print(f"  🔍 Regular URL detected (not Instagram/Twitter) - using web scraping directly")
        # Jump directly to Strategy 3 (defined at the end of this function)
        # We'll use a flag to skip strategies 1 and 2
        skip_social_strategies = True
    else:
        print(f"  🔍 Social media URL detected - will try yt-dlp → instaloader → web scraping")
        skip_social_strategies = False
    
    # STRATEGY 1: Try yt-dlp first (only for social media platforms)
    if not skip_social_strategies:
        print(f"  🔧 Strategy 1: Trying yt-dlp...")
        output_template = f"{output_dir}/inspiration_%(autonumber)s.%(ext)s"
        
        ydl_opts = {
            'format': 'best',
            'outtmpl': output_template,
            'quiet': False,  # Enable output for debugging
            'no_warnings': False,
            'writethumbnail': False,
            'skip_download': False,
            'playlist_items': '1',  # Only download first item from carousels
            'noplaylist': False,  # Allow playlist/carousel processing
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                print(f"  🔍 Extracting info from URL...")
                info = ydl.extract_info(url, download=True)
                
                print(f"  🔍 Info type: {'playlist/carousel' if 'entries' in info else 'single media'}")
                if 'entries' in info:
                    print(f"  🔍 Number of entries: {len(info.get('entries', []))}")
                
                # Collect downloaded files
                downloaded_files = []
                
                # Check if it's a single image
                if info.get('ext') in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
                    filename = ydl.prepare_filename(info)
                    if os.path.exists(filename):
                        downloaded_files.append(filename)
                        print(f"  ✅ yt-dlp: Downloaded 1 image")
                
                # Check if it's a carousel/multiple images
                elif 'entries' in info and len(info['entries']) > 0:
                    # Only process first entry
                    entry = info['entries'][0]
                    if entry.get('ext') in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
                        filename = ydl.prepare_filename(entry)
                        if os.path.exists(filename):
                            downloaded_files.append(filename)
                            print(f"  ✅ yt-dlp: Downloaded first image from carousel")
                
                # Scan directory for any downloaded files
                if not downloaded_files:
                    for file in os.listdir(output_dir):
                        file_path = os.path.join(output_dir, file)
                        if file.startswith('inspiration_') and os.path.isfile(file_path):
                            ext = file.split('.')[-1].lower()
                            if ext in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
                                downloaded_files.append(file_path)
                
                if downloaded_files:
                    return ([downloaded_files[0]], True)
                
                # If yt-dlp returned 0 entries for Instagram, try instaloader
                if is_instagram and 'entries' in info and len(info.get('entries', [])) == 0:
                    print(f"  ⚠️ yt-dlp returned 0 entries for Instagram, trying fallback...")
                else:
                    print(f"  ⚠️ yt-dlp: No images found, trying fallback strategies...")
                    
        except Exception as e:
            error_str = str(e)
            print(f"  ⚠️ yt-dlp failed: {type(e).__name__}: {e}")
            
            # Try to extract redirect URL from "Unsupported URL" error message
            # Pattern: "ERROR: Unsupported URL: https://..."
            if 'Unsupported URL:' in error_str:
                import re
                url_match = re.search(r'Unsupported URL: (https?://[^\s]+)', error_str)
                if url_match:
                    discovered_redirect_url = url_match.group(1)
                    print(f"  🔍 Discovered redirect URL: {discovered_redirect_url[:80]}...")
                    print(f"     Will use this URL for Strategy 3 web scraping")
    
    # STRATEGY 2: Try instaloader for Instagram (only if Instagram and Strategy 1 failed)
    if not skip_social_strategies and is_instagram:
        print(f"  🔧 Strategy 2: Trying instaloader for Instagram...")
        try:
            import instaloader
            
            # Extract shortcode from Instagram URL
            # URLs like: https://www.instagram.com/p/DSAr8MDDyWb/ or https://www.instagram.com/p/DSAr8MDDyWb/?img_index=1
            shortcode = None
            if '/p/' in url:
                shortcode = url.split('/p/')[1].split('/')[0].split('?')[0]
            elif '/reel/' in url:
                shortcode = url.split('/reel/')[1].split('/')[0].split('?')[0]
            
            if not shortcode:
                print(f"  ❌ Could not extract shortcode from Instagram URL")
            else:
                print(f"  🔍 Instagram shortcode: {shortcode}")
                
                # Create instaloader instance (anonymous, no login)
                L = instaloader.Instaloader(
                    download_videos=False,
                    download_video_thumbnails=False,
                    download_geotags=False,
                    download_comments=False,
                    save_metadata=False,
                    compress_json=False,
                    dirname_pattern=output_dir,
                    filename_pattern='{shortcode}_{medianame}'
                )
                
                # Get post
                print(f"  🔍 Fetching Instagram post...")
                post = instaloader.Post.from_shortcode(L.context, shortcode)
                
                # Download first image from post
                downloaded_files = []
                
                if post.typename == 'GraphSidecar':
                    # It's a carousel - get first image
                    print(f"  🔍 Carousel detected with {post.mediacount} items")
                    nodes = list(post.get_sidecar_nodes())
                    if nodes:
                        first_node = nodes[0]
                        img_url = first_node.display_url
                        print(f"  🔍 Downloading first carousel image from URL...")
                        
                        # Download the image directly
                        import requests
                        response = requests.get(img_url, timeout=30)
                        response.raise_for_status()
                        
                        img_path = os.path.join(output_dir, f"insta_{shortcode}_0.jpg")
                        with open(img_path, 'wb') as f:
                            f.write(response.content)
                        
                        downloaded_files.append(img_path)
                        print(f"  ✅ instaloader: Downloaded first image from carousel")
                else:
                    # Single image post
                    img_url = post.url
                    print(f"  🔍 Single image post, downloading...")
                    
                    import requests
                    response = requests.get(img_url, timeout=30)
                    response.raise_for_status()
                    
                    img_path = os.path.join(output_dir, f"insta_{shortcode}.jpg")
                    with open(img_path, 'wb') as f:
                        f.write(response.content)
                    
                    downloaded_files.append(img_path)
                    print(f"  ✅ instaloader: Downloaded 1 image")
                
                if downloaded_files:
                    return (downloaded_files, True)
                    
        except ImportError:
            print(f"  ❌ instaloader not installed. Install with: pip install instaloader")
        except Exception as e:
            print(f"  ⚠️ instaloader failed: {type(e).__name__}: {e}")
    
    # STRATEGY 3: Generic web scraping for any URL (universal fallback)
    # Based on ai/image_downloader.py - proven working approach
    print(f"  🔧 Strategy 3: Trying web scraping for any URL...")
    try:
        from bs4 import BeautifulSoup
        import requests
        from urllib.parse import urljoin, urlparse
        import mimetypes
        
        # Use discovered redirect URL if available (from yt-dlp), otherwise use original URL
        scrape_url = discovered_redirect_url if discovered_redirect_url else url
        if discovered_redirect_url:
            print(f"  🔍 Using discovered redirect URL for scraping: {scrape_url[:80]}...")
        else:
            print(f"  🔍 Fetching webpage: {scrape_url[:80]}...")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(scrape_url, headers=headers, timeout=10, allow_redirects=True)
        response.raise_for_status()
        
        print(f"  🔍 Final URL after redirects: {response.url[:80]}...")
        
        soup = BeautifulSoup(response.content, 'html.parser')
        min_size = 10000  # 10KB minimum to skip icons/thumbnails
        
        def download_image_from_url(img_url, source_label):
            """Helper to download and validate an image"""
            try:
                # Make URL absolute
                full_url = urljoin(response.url, img_url)
                print(f"  🔍 Trying {source_label}: {full_url[:80]}...")
                
                # Download image
                img_response = requests.get(full_url, headers=headers, timeout=10, stream=True)
                img_response.raise_for_status()
                
                # Verify content type
                content_type = img_response.headers.get('content-type', '')
                if 'image' not in content_type.lower():
                    print(f"  ⚠️ Not an image (content-type: {content_type})")
                    return None
                
                # Check file size
                content_length = img_response.headers.get('content-length')
                if content_length:
                    file_size = int(content_length)
                    if file_size < min_size:
                        print(f"  ⚠️ Image too small ({file_size} bytes)")
                        return None
                
                # Determine file extension from content type
                ext = mimetypes.guess_extension(content_type.split(';')[0])
                if not ext:
                    parsed = urlparse(full_url)
                    ext = os.path.splitext(parsed.path)[1]
                    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
                        ext = '.jpg'
                
                # Save image
                img_path = os.path.join(output_dir, f"scraped_inspiration{ext}")
                with open(img_path, 'wb') as f:
                    for chunk in img_response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                # Verify final file size
                actual_size = os.path.getsize(img_path)
                if actual_size < min_size:
                    print(f"  ⚠️ Downloaded image too small ({actual_size} bytes)")
                    os.remove(img_path)
                    return None
                
                print(f"  ✅ Web scraping: Downloaded from {source_label} ({actual_size} bytes)")
                return img_path
                
            except Exception as e:
                print(f"  ⚠️ Failed: {type(e).__name__}")
                return None
        
        # PRIORITY 1: Open Graph image (og:image) - best for social media
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            img_path = download_image_from_url(og_image['content'], 'og:image')
            if img_path:
                return ([img_path], True)
        
        # PRIORITY 2: Twitter card image
        twitter_image = soup.find('meta', attrs={'name': 'twitter:image'})
        if twitter_image and twitter_image.get('content'):
            img_path = download_image_from_url(twitter_image['content'], 'twitter:image')
            if img_path:
                return ([img_path], True)
        
        # PRIORITY 3: Featured/hero/article image (by class name)
        article_img = soup.find('img', class_=lambda x: x and any(
            keyword in x.lower() for keyword in ['featured', 'hero', 'main', 'lead', 'article']
        ))
        if article_img:
            img_url = article_img.get('src') or article_img.get('data-src') or article_img.get('data-lazy-src')
            if img_url:
                img_path = download_image_from_url(img_url, 'featured article image')
                if img_path:
                    return ([img_path], True)
        
        # PRIORITY 4: Scan all images and score them
        print(f"  🔍 Scanning all images on page...")
        images = soup.find_all('img')
        candidate_images = []
        
        for idx, img in enumerate(images):
            img_url = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
            
            if not img_url:
                continue
            
            # Convert to absolute URL
            img_url = urljoin(response.url, img_url)
            
            # Skip data URIs and SVGs (usually icons)
            if img_url.startswith('data:') or img_url.endswith('.svg'):
                continue
            
            # Skip common icon/logo patterns
            img_alt = (img.get('alt') or '').lower()
            img_class = ' '.join(img.get('class', [])).lower()
            skip_keywords = ['icon', 'logo', 'avatar', 'sprite', 'badge', 'button']
            if any(keyword in img_alt or keyword in img_class for keyword in skip_keywords):
                continue
            
            # Score the image based on size hints
            score = 0
            width = img.get('width')
            height = img.get('height')
            
            if width and height:
                try:
                    w = int(width) if str(width).isdigit() else 0
                    h = int(height) if str(height).isdigit() else 0
                    if w > 300 and h > 300:
                        score += 10
                except:
                    pass
            
            # Try to get file size via HEAD request
            try:
                head_response = requests.head(img_url, headers=headers, timeout=5, allow_redirects=True)
                content_length = head_response.headers.get('content-length')
                if content_length:
                    file_size = int(content_length)
                    if file_size > min_size:
                        score += 5
                else:
                    file_size = 0
            except:
                file_size = 0
            
            candidate_images.append({
                'url': img_url,
                'score': score,
                'size': file_size,
                'index': idx
            })
        
        # Sort by score (higher is better) and then by index (first appearance)
        candidate_images.sort(key=lambda x: (-x['score'], x['index']))
        
        print(f"  🔍 Found {len(candidate_images)} candidate image(s)")
        
        # Try downloading top candidates
        for i, candidate in enumerate(candidate_images[:5]):  # Try top 5 candidates
            img_path = download_image_from_url(candidate['url'], f"candidate #{i+1} (score: {candidate['score']})")
            if img_path:
                return ([img_path], True)
        
        print(f"  ⚠️ No suitable images found on webpage")
        return (None, False)
                
    except ImportError:
        print(f"  ❌ beautifulsoup4 not installed. Install with: pip install beautifulsoup4 lxml")
        return (None, False)
    except Exception as e:
        print(f"  ❌ Web scraping failed: {type(e).__name__}: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        return (None, False)


def extract_frames_from_video(video_path: str, output_dir: str, fps: int = 1, max_duration: int = None) -> list:
    """
    Extract frames from video at specified FPS (default 1 frame per second).
    
    Args:
        video_path: Path to the video file
        output_dir: Directory to save extracted frames
        fps: Frames per second to extract (default 1)
        max_duration: Maximum duration to extract frames from (in seconds). 
                      If None, uses MAX_VIDEO_INSPIRATION_DURATION.
    
    Returns list of frame file paths.
    """
    if max_duration is None:
        max_duration = MAX_VIDEO_INSPIRATION_DURATION
    
    os.makedirs(output_dir, exist_ok=True)
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ❌ Unable to open video: {video_path}")
        return []
    
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / video_fps if video_fps > 0 else 0
    
    print(f"  📊 Video: {duration:.1f}s, {video_fps:.1f} FPS")
    print(f"  📊 Max duration for frames: {max_duration}s (based on {max_duration // 8} clip(s))")
    
    # Calculate effective duration (trim to max if too long)
    effective_duration = duration
    if duration > max_duration:
        print(f"  ⚠️ Video too long ({duration:.1f}s), using first {max_duration}s only")
        effective_duration = max_duration
    
    # Calculate max frames to extract based on effective duration
    max_frames_to_extract = int(effective_duration * fps)
    
    frame_interval = int(video_fps / fps) if fps > 0 else int(video_fps)
    frame_paths = []
    frame_count = 0
    saved_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Stop if we've extracted enough frames for the effective duration
        if saved_count >= max_frames_to_extract:
            break
        
        if frame_count % frame_interval == 0:
            frame_path = os.path.join(output_dir, f"frame_{saved_count:02d}.jpg")
            cv2.imwrite(frame_path, frame)
            frame_paths.append(frame_path)
            saved_count += 1
        
        frame_count += 1
    
    cap.release()
    print(f"  ✅ Extracted {saved_count} frames (1 per second, from first {effective_duration:.0f}s)")
    return frame_paths


def extract_and_transcribe_audio(video_path: str, output_dir: str, max_duration: int = None) -> tuple:
    """
    Extract audio, separate vocals with Demucs, and transcribe with OpenAI Whisper.
    Also saves the background music (original audio) for later use.
    
    Args:
        video_path: Path to the video file
        output_dir: Directory to save audio files
        max_duration: Maximum duration for transcription processing (in seconds).
                      Background music is always saved in FULL, regardless of this.
                      If None, uses MAX_VIDEO_INSPIRATION_DURATION.
    
    Returns tuple: (transcript_text, background_music_path)
    - transcript_text: The transcribed speech from the video
    - background_music_path: Path to the background music file (FULL original audio)
    """
    if max_duration is None:
        max_duration = MAX_VIDEO_INSPIRATION_DURATION
    
    import torch
    import torchaudio
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    import soundfile as sf
    import numpy as np
    from openai import OpenAI
    
    audio_path = os.path.join(output_dir, "audio.wav")
    vocals_path = os.path.join(output_dir, "vocals.wav")
    background_music_path = os.path.join(output_dir, "background_music.wav")
    
    try:
        # Step 1: Extract FULL audio from video (complete music track)
        print(f"  🎵 Extracting full audio from video...")
        video_clip = VideoFileClip(video_path)
        if video_clip.audio is None:
            print(f"  ⚠️ No audio track in video")
            video_clip.close()
            return ("", None)
        
        video_duration = video_clip.duration
        print(f"  📊 Video duration: {video_duration:.1f}s")
        
        # Save FULL original audio as background music FIRST (preserves complete music)
        video_clip.audio.write_audiofile(background_music_path, codec='pcm_s16le', logger=None)
        print(f"  🎶 Background music saved (FULL {video_duration:.1f}s audio): {background_music_path}")
        
        # Step 2: Extract trimmed audio for transcription processing
        # Only process up to max_duration for Demucs/transcription (saves processing time)
        if video_duration > max_duration:
            print(f"  ⚠️ Trimming to first {max_duration}s for transcription processing")
            trimmed_clip = video_clip.subclip(0, max_duration)
            trimmed_clip.audio.write_audiofile(audio_path, codec='pcm_s16le', logger=None)
            trimmed_clip.close()
        else:
            video_clip.audio.write_audiofile(audio_path, codec='pcm_s16le', logger=None)
        
        video_clip.close()
        
        # Step 3: Separate vocals with Demucs (only for transcription purposes)
        print(f"  🎤 Separating vocals with Demucs (for transcription only)...")
        model = get_model('htdemucs')
        model.eval()
        
        waveform, sample_rate = torchaudio.load(audio_path)
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        
        with torch.no_grad():
            sources = apply_model(model, waveform.unsqueeze(0), device='cpu')[0]
        
        # htdemucs outputs: drums (0), bass (1), other (2), vocals (3)
        vocals = sources[3].numpy()
        
        # Convert to mono if stereo for consistency
        if vocals.shape[0] == 2:
            vocals = np.mean(vocals, axis=0)
        
        # Save vocals for transcription
        sf.write(vocals_path, vocals, sample_rate)
        
        # Step 4: Transcribe vocals with OpenAI Whisper
        print(f"  📝 Transcribing with OpenAI Whisper...")
        client = OpenAI(api_key=settings.openai_api_key)
        
        with open(vocals_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        
        transcript_text = transcription.text.strip()
        print(f"  ✅ Transcription: \"{transcript_text[:100]}{'...' if len(transcript_text) > 100 else ''}\"")
        
        # Cleanup temporary files (keep background_music_path for later upload)
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(vocals_path):
            os.remove(vocals_path)
        
        return (transcript_text, background_music_path)
        
    except Exception as e:
        print(f"  ❌ Audio extraction/transcription error: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        # Cleanup on error
        if os.path.exists(audio_path):
            os.remove(audio_path)
        if os.path.exists(vocals_path):
            os.remove(vocals_path)
        if os.path.exists(background_music_path):
            os.remove(background_music_path)
        return ("", None)


def analyze_image_inspiration_with_grok(image_urls: list, context: dict) -> dict:
    """
    Analyze image inspiration using Grok - pass images for aesthetic/creative analysis.
    Returns inspiration analysis dict with visual elements, aesthetics, composition, etc.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import json
    
    print(f"\n  🤖 Analyzing image inspiration with Grok (xai_sdk)...")
    print(f"     Images: {len(image_urls)}")
    
    if not image_urls:
        print(f"  ⚠️ No images to analyze")
        return {}
    
    brand_name = context.get('dvyb_context', {}).get('accountName', 'the brand')
    
    system_prompt = f"""You are a WORLD-CLASS CREATIVE IMAGE ANALYST specializing in social media content analysis.
You analyze images to extract creative insights that can inspire new content for {brand_name}.

🎯 YOUR CRITICAL TASK:
Analyze the provided image(s) to extract EVERY SINGLE VISUAL ELEMENT and creative detail that can guide content creation. BE EXTREMELY DETAILED AND COMPREHENSIVE.

🔍 **WHAT TO ANALYZE - CAPTURE EVERYTHING**:

1. **VISUAL AESTHETICS**:
   - Color palette (ALL colors present - dominant, accent, background colors)
   - Color grading and treatment (warm/cool tones, saturation, contrast)
   - Lighting style (natural daylight, studio, dramatic, soft, harsh, golden hour, backlit, side-lit, etc.)
   - Overall mood and atmosphere (energetic, calm, moody, bright, dark, etc.)
   - Visual quality (professional DSLR, mobile casual, cinematic, polished, raw, grainy, etc.)
   - Any filters or effects applied

2. **COMPOSITION & FRAMING**:
   - Shot type (extreme close-up, close-up, medium shot, full shot, wide shot, etc.)
   - Camera angle (eye-level, high angle, low angle, overhead/flatlay, Dutch angle, etc.)
   - Framing techniques (tight framing, negative space, centered, off-center, etc.)
   - Compositional rules used (rule of thirds, leading lines, symmetry, golden ratio, etc.)
   - Depth of field (shallow/bokeh, deep focus, etc.)
   - Perspective and point of view

3. **HUMAN PRESENCE** (CRITICAL - capture ALL details):
   - ARE THERE ANY HUMANS? (Full bodies, partial, hands only, silhouettes?)
   - How many people? (Count them)
   - Faces: Visible or not? Expressions? Emotions? Age range? Ethnicity? Gender?
   - Poses: Specific body positioning (standing, sitting, leaning, reaching, etc.)
   - Gestures: Hand positions, finger placements, arm movements
   - Body language: Confident, relaxed, dynamic, static?
   - Clothing style: Casual, formal, athletic, fashion-forward, colors, patterns?
   - Accessories: Jewelry, watches, bags, hats, glasses?
   - Hair style and makeup (if visible)
   - Interaction: Are people interacting with objects? With each other?
   - Positioning: Where are people placed in the frame?

4. **CHARACTERS & LIVING BEINGS**:
   - Any animals? (Pets, wildlife - specify species, breed if identifiable)
   - Any illustrated/animated characters?
   - Any mascots or brand characters?
   - Describe their appearance, positioning, and role in the image

5. **OBJECTS & PROPS** (List EVERYTHING):
   - ALL objects visible in the image (be exhaustive)
   - Main subjects vs supporting props
   - Product placement (if any) - how is it showcased?
   - Food and beverages (specific items, presentation style)
   - Furniture and decor
   - Technology and gadgets
   - Nature elements (flowers, plants, trees, water, etc.)
   - Tools, instruments, equipment
   - Packaging, containers, bottles
   - How objects are arranged (neat, scattered, organized, chaotic?)
   - Size relationships between objects
   - Textures visible on objects

6. **SETTING & ENVIRONMENT**:
   - Location type (indoor, outdoor, studio, cafe, home, office, nature, urban, etc.)
   - Specific setting details (kitchen, bedroom, park, street, beach, etc.)
   - Background elements (what's visible in the background?)
   - Architectural elements (walls, floors, windows, doors, etc.)
   - Weather conditions (if outdoor: sunny, cloudy, rainy, etc.)
   - Time of day indicators (morning light, evening, night, etc.)
   - Environmental atmosphere (clean, messy, minimal, cluttered, luxurious, casual, etc.)

7. **STYLING & AESTHETICS**:
   - Overall styling approach (minimal, maximalist, vintage, modern, rustic, etc.)
   - Color coordination and harmony
   - Pattern usage (stripes, florals, geometric, etc.)
   - Material textures (wood, metal, fabric, glass, etc.)
   - Surface finishes (matte, glossy, rough, smooth, etc.)

8. **CREATIVE & TECHNICAL ELEMENTS**:
   - Motion blur or freeze frame
   - Focus techniques (selective focus, tilt-shift, etc.)
   - Lens effects (bokeh, lens flare, vignetting, etc.)
   - Post-processing treatments (vintage look, high contrast, faded, etc.)
   - Text or graphics overlay (if any)
   - Unique creative techniques that stand out
   - What makes this image visually engaging?

9. **ACTION & MOVEMENT** (if present):
   - Is there implied movement or action?
   - Captured moments (pouring, eating, jumping, reaching, etc.)
   - Dynamic elements vs static elements

10. **REPLICATION TIPS**:
    - Specific, actionable advice on how to recreate this EXACT aesthetic for {brand_name}
    - What elements are CRITICAL to capture the same feel?
    - What would work well for brand content?
    - Technical tips (lighting setup, camera settings, styling choices)

⚠️ RESPOND ONLY WITH VALID JSON in this exact format (BE EXHAUSTIVE IN YOUR DESCRIPTIONS):
{{
  "visual_aesthetics": {{
    "color_palette": ["ALL colors present - dominant, accent, background"],
    "color_treatment": "Warm/cool tones, saturation level, contrast level",
    "lighting_style": "Detailed lighting description",
    "mood_atmosphere": "Overall mood description",
    "visual_quality": "Professional/candid/cinematic/etc description",
    "filters_effects": "Any filters or effects applied"
  }},
  "composition": {{
    "shot_type": "Extreme close-up/close-up/medium/wide/etc",
    "angle": "Eye-level/high/low/overhead/etc",
    "framing_techniques": ["technique1", "technique2"],
    "compositional_rules": ["rule of thirds", "leading lines", etc],
    "depth_of_field": "Shallow/deep/etc",
    "perspective": "Perspective description"
  }},
  "human_presence": {{
    "has_humans": true or false,
    "count": number of people or 0,
    "visibility": "Full body/partial/hands only/silhouettes/etc",
    "description": "EXHAUSTIVE description: faces, expressions, age, gender, ethnicity, clothing, accessories, hair, makeup",
    "poses_and_gestures": ["Specific pose 1", "gesture 2", "body language 3"],
    "positioning": "Where people are placed in frame",
    "interactions": "What are they doing/interacting with"
  }},
  "characters_and_beings": {{
    "has_animals": true or false,
    "animals": ["species/breed if present"],
    "has_characters": true or false,
    "characters": ["animated/illustrated characters if present"],
    "description": "Detailed description of any living beings or characters"
  }},
  "objects_and_props": {{
    "all_objects": ["EXHAUSTIVE list of ALL visible objects"],
    "main_subjects": ["Primary objects of focus"],
    "supporting_props": ["Secondary/background objects"],
    "arrangement": "Detailed description of how objects are arranged",
    "styling": "Styling approach description",
    "textures": ["Textures visible on objects"]
  }},
  "setting": {{
    "location_type": "Specific location type",
    "specific_setting": "Exact setting (kitchen/park/cafe/etc)",
    "background": "Detailed background description",
    "environment": "Environmental atmosphere description",
    "weather_time": "Weather/time of day if applicable"
  }},
  "styling_aesthetics": {{
    "overall_style": "Minimal/maximalist/vintage/modern/etc",
    "patterns": ["Any patterns present"],
    "materials": ["Materials visible - wood/metal/fabric/etc"],
    "finishes": ["Surface finishes - matte/glossy/etc"]
  }},
  "technical_creative": {{
    "motion_elements": "Any implied movement or action",
    "focus_techniques": "Focus/blur techniques used",
    "lens_effects": ["Bokeh", "lens flare", "vignetting", etc],
    "post_processing": "Post-processing treatments applied",
    "unique_techniques": ["Unique creative elements that stand out"]
  }},
  "action_movement": {{
    "has_action": true or false,
    "description": "Description of any action, movement, or captured moments"
  }},
  "creative_elements": ["ALL creative elements that make this engaging"],
  "replication_tips": "DETAILED, ACTIONABLE tips to replicate this EXACT aesthetic for {brand_name}, including technical setup"
}}"""

    # Build user prompt
    user_prompt = f"""Analyze {'these images' if len(image_urls) > 1 else 'this image'} as creative inspiration for {brand_name}.

{'The images below are from the same post:' if len(image_urls) > 1 else 'Image to analyze:'}

🎯 Extract creative insights that can inspire content for {brand_name}.
Be DETAILED and SPECIFIC in your analysis."""

    try:
        print(f"     Creating Grok chat with xai_sdk...")
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(system_prompt))
        
        # Add images to chat
        image_objects = [image(image_url=img_url, detail="high") for img_url in image_urls]
        print(f"     Created {len(image_objects)} image objects for Grok")
        
        # Append user message with all images
        chat.append(user(user_prompt, *image_objects))
        
        print(f"     Calling Grok.sample()...")
        response = chat.sample()
        response_text = response.content.strip()
        
        print(f"  ✅ Grok analysis complete")
        print(f"     Response length: {len(response_text)} chars")
        
        # Parse JSON response (handle markdown)
        if "```json" in response_text:
            json_start = response_text.find("```json") + 7
            json_end = response_text.find("```", json_start)
            json_content = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.find("```") + 3
            json_end = response_text.find("```", json_start)
            json_content = response_text[json_start:json_end].strip()
        elif response_text.startswith("{") and response_text.endswith("}"):
            json_content = response_text
        else:
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = response_text[start_idx:end_idx]
            else:
                raise ValueError("No valid JSON found in Grok response")
        
        # Fix common JSON issues (trailing commas)
        import re
        json_content = re.sub(r',(\s*[}\]])', r'\1', json_content)
        
        analysis = json.loads(json_content)
        
        print(f"  ✅ Image inspiration analysis complete")
        if 'visual_aesthetics' in analysis:
            print(f"     Colors: {analysis['visual_aesthetics'].get('color_palette', [])}...")
        if 'human_presence' in analysis:
            print(f"     Humans: {analysis['human_presence'].get('has_humans', False)}")
        
        return analysis
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok JSON response: {e}")
        print(f"     Raw response: {response_text[:200]}...")
        return {}
    except Exception as e:
        print(f"  ❌ Grok analysis failed: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        return {}


def analyze_video_inspiration_with_grok(frame_urls: list, transcript: str, context: dict) -> dict:
    """
    Analyze video inspiration using Grok - pass frames in sequence + transcript.
    Uses xai_sdk with image() helper (same as inventory analysis).
    Returns inspiration analysis dict with storyline, creative elements, etc.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import json
    
    print(f"\n  🤖 Analyzing video inspiration with Grok (xai_sdk)...")
    print(f"     Frames: {len(frame_urls)}")
    print(f"     Transcript: {len(transcript)} chars")
    
    if not frame_urls:
        print(f"  ⚠️ No frames to analyze")
        return {}
    
    brand_name = context.get('dvyb_context', {}).get('accountName', 'the brand')
    
    system_prompt = f"""You are a WORLD-CLASS CREATIVE VIDEO ANALYST specializing in social media content analysis.
You analyze video frames and transcripts to extract creative insights that can inspire new content for {brand_name}.

You will receive images in sequence (frames extracted from a video, 1 frame per second) and the associated transcription.

🎯 YOUR CRITICAL TASK:
1. **RECREATE THE STORYLINE** - What happens in the video from start to end? Be DETAILED and specific.
2. **IDENTIFY THE HOOK** - How does the video grab attention in the first 2-3 seconds?
3. **EXTRACT CREATIVE ELEMENTS** - What makes this video engaging? List all creative techniques.
4. **ANALYZE VISUAL TECHNIQUES** - Camera movements, transitions, effects, compositions, lighting
5. **IDENTIFY KEY MOMENTS** - The most impactful moments in the video
6. **ANALYZE PACING** - How quickly things happen, timing of transitions
7. **MOOD & ATMOSPHERE** - The overall feel and vibe
8. **PRODUCT SHOWCASE STYLE** - How products are shown (if applicable)
9. **REPLICATION TIPS** - Specific, actionable tips to replicate this style for a brand video

🔍 **IDENTIFY VISUAL SUBJECTS & ELEMENTS** (helps with replication):
Identify visual elements present in the video that could enhance brand content:
- **HUMAN PRESENCE**: Are there people? Faces? Hands? Body parts? What are they doing?
- **OBJECTS & PROPS**: What objects appear? Food, drinks, accessories, gadgets, furniture?
- **SETTING/LOCATION**: Where is this filmed? Studio, outdoor, kitchen, beach, urban, nature?
- **ANIMALS/CREATURES**: Any pets, animals, or animated characters?
- **ENVIRONMENTAL ELEMENTS**: Weather, lighting conditions, time of day, atmosphere?
- **ACTIONS & INTERACTIONS**: What actions are being performed? Holding, reaching, eating, dancing, demonstrating?

These elements provide context for replicating the video's feel with the brand's product.

📝 **STORYLINE FORMAT** (CRITICAL - be ultra-detailed like a storyboard):
Write the storyline as a TIMELINE with specific descriptions:
- 0-2 sec: [What happens in first 2 seconds]
- 2-4 sec: [What happens next]
- 4-6 sec: [Continue...]
- [Continue for entire video duration]

Include camera movements, subject actions, transitions, text overlays, etc.

⚠️ RESPOND ONLY WITH VALID JSON in this exact format:
{{
  "storyline": "DETAILED timeline breakdown: 0-2 sec: [description]. 2-4 sec: [description]. ...",
  "hook": "Specific description of how the video grabs attention in first 2-3 seconds",
  "creative_elements": ["element1", "element2", "element3", ...],
  "visual_techniques": ["technique1", "technique2", "technique3", ...],
  "visual_subjects": {{
    "humans": "Description of human presence (faces, hands, body, actions) or 'None'",
    "objects_props": ["object1", "object2", ...],
    "setting_location": "Description of where the video is set",
    "actions_interactions": ["action1", "action2", ...],
    "environmental_elements": "Weather, lighting, time of day, atmosphere details"
  }},
  "mood_atmosphere": "The overall mood and atmosphere",
  "message": "What the video is trying to convey",
  "pacing": "fast/medium/slow - detailed description of pacing",
  "key_moments": ["moment1 at Xs", "moment2 at Ys", ...],
  "product_showcase_style": "How products are shown (if applicable, else N/A)",
  "replication_tips": "Detailed, actionable tips to replicate this style for {brand_name}"
}}"""

    # Build user prompt with frame descriptions
    transcript_text = transcript if transcript else "(No speech detected in video)"
    
    user_prompt = f"""Analyze this video inspiration for {brand_name}.

The frames below are extracted at 1 frame per second, shown in sequence:

{"".join([f"- Frame {i+1} (at {i} seconds)" + chr(10) for i in range(len(frame_urls))])}

TRANSCRIPTION FROM VIDEO:
"{transcript_text}"

🎯 Analyze the complete visual sequence and extract creative insights that can inspire content for {brand_name}.
Be ULTRA-DETAILED in your storyline - describe it like a professional storyboard with exact timestamps.
"""

    try:
        print(f"     Creating Grok chat with xai_sdk...")
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(system_prompt))
        
        # Create image objects for all frames (same pattern as inventory analysis)
        image_objects = [image(image_url=url, detail="high") for url in frame_urls]
        print(f"     Created {len(image_objects)} image objects for Grok")
        
        # Append user message with all images
        chat.append(user(user_prompt, *image_objects))
        
        print(f"     Calling Grok.sample()...")
        response = chat.sample()
        response_text = response.content.strip()
        
        print(f"     Grok raw response: {response_text[:300]}...")
        
        # Parse JSON response (handle markdown)
        if "```json" in response_text:
            json_start = response_text.find("```json") + 7
            json_end = response_text.find("```", json_start)
            json_content = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.find("```") + 3
            json_end = response_text.find("```", json_start)
            json_content = response_text[json_start:json_end].strip()
        elif response_text.startswith("{") and response_text.endswith("}"):
            json_content = response_text
        else:
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = response_text[start_idx:end_idx]
            else:
                raise ValueError("No valid JSON found in Grok response")
        
        # Fix common JSON issues (trailing commas)
        import re
        json_content = re.sub(r',(\s*[}\]])', r'\1', json_content)
        
        analysis = json.loads(json_content)
        
        print(f"  ✅ Video inspiration analysis complete")
        print(f"     Storyline: {analysis.get('storyline', '')[:150]}...")
        print(f"     Hook: {analysis.get('hook', '')[:100]}...")
        print(f"     Creative elements: {len(analysis.get('creative_elements', []))} identified")
        print(f"     Visual techniques: {len(analysis.get('visual_techniques', []))} identified")
        print(f"     Key moments: {len(analysis.get('key_moments', []))} identified")
        
        return analysis
        
    except Exception as e:
        print(f"  ❌ Video inspiration analysis failed: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        return {}


async def process_image_inspiration_link(url: str, context: dict, account_id: int) -> dict:
    """
    Process image inspiration link from Instagram/Twitter.
    Returns analysis dict with aesthetic and creative insights.
    """
    print(f"\n{'='*60}")
    print(f"🖼️ IMAGE INSPIRATION ANALYSIS")
    print(f"{'='*60}")
    print(f"  URL: {url[:80]}...")
    
    output_dir = f"/tmp/dvyb-inspirations/{uuid.uuid4().hex[:8]}"
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Check if URL is already a public S3 URL (no need to re-upload)
        from urllib.parse import urlparse
        parsed_url = urlparse(url)
        is_s3_url = 's3.amazonaws.com' in parsed_url.netloc.lower() or 'amazonaws.com' in parsed_url.netloc.lower()
        is_public_s3 = is_s3_url and ('burnie-videos' in url.lower() or 'burnie-mindshare' in url.lower())
        
        if is_public_s3:
            # For public S3 URLs, use the URL directly (no need to download/re-upload)
            print(f"  ✅ Public S3 URL detected - using directly (no download/re-upload needed)")
            image_presigned_urls = [url]
        else:
            # Step 1: Download image(s)
            image_paths, is_image = download_inspiration_image(url, output_dir)
            if not is_image or not image_paths:
                print(f"  ⚠️ No images downloaded, skipping image analysis")
                return {}
            
            # Step 2: Upload images to S3 and get presigned URLs
            print(f"  📤 Uploading {len(image_paths)} image(s) to S3...")
            image_presigned_urls = []
            for i, image_path in enumerate(image_paths):
                s3_key = web2_s3_helper.upload_from_file(
                    file_path=image_path,
                    folder=f"dvyb/inspiration-images/{account_id}",
                    filename=f"image_{i:02d}_{uuid.uuid4().hex[:6]}.jpg"
                )
                if s3_key:
                    presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                    if presigned_url:
                        image_presigned_urls.append(presigned_url)
            
            print(f"  ✅ Uploaded {len(image_presigned_urls)} image(s) to S3")
            
            if not image_presigned_urls:
                print(f"  ⚠️ No images uploaded successfully")
                return {}
        
        # Step 3: Analyze with Grok
        analysis = analyze_image_inspiration_with_grok(image_presigned_urls, context)
        
        # Add metadata
        analysis["source_url"] = url
        analysis["image_count"] = len(image_presigned_urls)
        analysis["image_urls"] = image_presigned_urls
        
        return analysis
        
    except Exception as e:
        print(f"  ❌ Image inspiration processing failed: {e}")
        print(f"  ⚠️  Don't worry - content generation will continue without image inspiration")
        import traceback
        print(f"     {traceback.format_exc()}")
        return {}
    
    finally:
        # Cleanup
        print(f"  🧹 Cleaning up temporary files...")
        import shutil
        if os.path.exists(output_dir):
            try:
                shutil.rmtree(output_dir)
            except Exception as e:
                print(f"  ⚠️ Cleanup warning: {e}")


async def process_video_inspiration_link(url: str, context: dict, account_id: int, clips_per_video: int = 1) -> dict:
    """
    Full pipeline for processing a video inspiration link:
    1. Download video
    2. Extract frames
    3. Extract & transcribe audio
    4. Upload frames to S3 and get presigned URLs
    5. Analyze with Grok
    6. Cleanup
    
    Args:
        url: Video URL to process
        context: Context dict with brand info
        account_id: Account ID for S3 paths
        clips_per_video: Number of clips per video (used to calculate max_duration: clips * 8 seconds)
    
    Returns video inspiration analysis dict.
    """
    # Calculate max duration based on number of clips (8 seconds per clip)
    max_duration = clips_per_video * 8
    
    print(f"\n{'='*60}")
    print(f"🎬 VIDEO INSPIRATION ANALYSIS")
    print(f"{'='*60}")
    print(f"  URL: {url[:80]}...")
    print(f"  📊 Clips per video: {clips_per_video} → Max duration for frames: {max_duration}s")
    
    output_dir = f"/tmp/dvyb-inspirations/{uuid.uuid4().hex[:8]}"
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Step 1: Download video
        video_path, is_video = download_inspiration_video(url, output_dir)
        if not is_video or not video_path:
            print(f"  ⚠️ Not a video or download failed, skipping video analysis")
            return {}
        
        # Step 1b: Get video duration to dynamically determine clips_per_video
        import cv2
        cap = cv2.VideoCapture(video_path)
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_duration = total_frames / video_fps if video_fps > 0 else 0
        cap.release()
        
        print(f"  📊 Inspiration video duration: {video_duration:.1f}s")
        
        # Dynamically determine clips_per_video based on video duration
        # Rule: 
        #   - Video 0-10s → 1 clip (8s output)
        #   - Video >10s → 2 clips (16s output)
        # This ensures we capture enough of the inspiration for longer videos
        original_clips_per_video = clips_per_video
        
        if video_duration <= 10:
            clips_per_video = 1
            print(f"  🎯 Video ≤10s → Using 1 clip")
        else:
            # Video > 10s: use 2 clips to capture more of the inspiration
            clips_per_video = 2
            print(f"  🎯 Video >10s ({video_duration:.1f}s) → Using 2 clips")
        
        # Recalculate max_duration if clips_per_video changed
        if clips_per_video != original_clips_per_video:
            max_duration = clips_per_video * 8
            print(f"  📊 Adjusted: Clips per video: {clips_per_video} → Max duration for frames: {max_duration}s")
        
        # Step 2: Extract frames (1 per second, up to max_duration)
        frames_dir = os.path.join(output_dir, "frames")
        frame_paths = extract_frames_from_video(video_path, frames_dir, fps=1, max_duration=max_duration)
        if not frame_paths:
            print(f"  ⚠️ No frames extracted, skipping video analysis")
            return {}
        
        # Step 3: Extract and transcribe audio (also saves FULL background music)
        # Note: Background music is saved in FULL, only transcription processing is trimmed
        transcript, background_music_path = extract_and_transcribe_audio(video_path, output_dir, max_duration=max_duration)
        
        # Step 4: Upload frames to S3 and get presigned URLs
        print(f"  📤 Uploading {len(frame_paths)} frames to S3...")
        frame_presigned_urls = []
        for i, frame_path in enumerate(frame_paths):
            s3_key = web2_s3_helper.upload_from_file(
                file_path=frame_path,
                folder=f"dvyb/inspiration-frames/{account_id}",
                filename=f"frame_{i:02d}_{uuid.uuid4().hex[:6]}.jpg"
            )
            if s3_key:
                presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                if presigned_url:
                    frame_presigned_urls.append(presigned_url)
        
        print(f"  ✅ Uploaded {len(frame_presigned_urls)} frames to S3")
        
        # Step 4b: Check if inspiration audio has significant vocals (English words > 5)
        # If yes, don't use inspiration music (keep AI-generated audio in final video)
        use_inspiration_music = True
        if transcript and transcript.strip():
            # Count words in transcript (split by whitespace)
            word_count = len(transcript.strip().split())
            print(f"  🎤 Transcript word count: {word_count}")
            
            if word_count > 5:
                # Check if it contains English words (basic check: has ASCII letters)
                import re
                english_words = re.findall(r'[a-zA-Z]+', transcript)
                english_word_count = len(english_words)
                
                if english_word_count > 5:
                    use_inspiration_music = False
                    print(f"  ⚠️ Significant vocals detected ({english_word_count} English words)")
                    print(f"     Skipping inspiration music - will keep AI-generated audio in final video")
                else:
                    print(f"  ✅ Minimal English vocals ({english_word_count} words) - will use inspiration music")
            else:
                print(f"  ✅ Minimal vocals ({word_count} words) - will use inspiration music")
        else:
            print(f"  ✅ No vocals detected - will use inspiration music")
        
        # Step 4c: Upload background music to S3 (only if no significant vocals)
        background_music_s3_key = None
        if use_inspiration_music and background_music_path and os.path.exists(background_music_path):
            print(f"  📤 Uploading background music to S3...")
            background_music_s3_key = web2_s3_helper.upload_from_file(
                file_path=background_music_path,
                folder=f"dvyb/inspiration-audio/{account_id}",
                filename=f"background_music_{uuid.uuid4().hex[:8]}.wav"
            )
            if background_music_s3_key:
                print(f"  ✅ Background music uploaded: {background_music_s3_key}")
            else:
                print(f"  ⚠️ Failed to upload background music")
        elif not use_inspiration_music:
            print(f"  ⏭️ Skipping background music upload (significant vocals detected)")
        
        # Step 5: Analyze with Grok
        analysis = analyze_video_inspiration_with_grok(frame_presigned_urls, transcript, context)
        
        # Add metadata
        analysis["source_url"] = url
        analysis["frame_count"] = len(frame_presigned_urls)
        analysis["has_transcript"] = bool(transcript)
        analysis["transcript"] = transcript
        analysis["background_music_s3_key"] = background_music_s3_key  # For use in final video
        analysis["video_duration"] = video_duration  # Original video duration
        analysis["clips_per_video"] = clips_per_video  # Dynamically determined clips per video
        
        return analysis
        
    except Exception as e:
        print(f"  ❌ Video inspiration processing failed: {e}")
        print(f"  ⚠️  Don't worry - content generation will continue without video inspiration")
        import traceback
        print(f"     {traceback.format_exc()}")
        return {}
    
    finally:
        # Cleanup
        print(f"  🧹 Cleaning up temporary files...")
        import shutil
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)


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
                "negative_prompt": "blur, distort, low quality, pixelated, noisy, grainy, out of focus, poorly lit, poorly exposed, poorly composed, poorly framed, poorly cropped, poorly color corrected, poorly color graded, additional bubbles, particles, extra text, double logos, extra fingers, six fingers, missing fingers, fused fingers, extra hands, three hands, extra limbs, extra arms, extra legs, deformed hands, mutated hands, malformed hands, distorted face, morphing face, asymmetrical face, extra eyes, cross-eyed, deformed body, unnatural proportions, limb stretching, body parts morphing, product morphing, shape distortion, flickering",
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
    platforms: List[str] = ["instagram", "linkedin", "twitter"]  # Default to all 3 platforms
    number_of_posts: int  # 1-4
    number_of_images: Optional[int] = None  # Specific number of image posts (calculated by frontend based on limits)
    number_of_videos: Optional[int] = None  # Specific number of video posts (calculated by frontend based on limits)
    user_prompt: Optional[str] = None
    user_images: Optional[List[str]] = None  # S3 URLs
    inspiration_links: Optional[List[str]] = None
    clips_per_video: Optional[int] = 1  # DEPRECATED: Use video_length_mode instead. Kept for backward compatibility.
    is_onboarding_product_image: Optional[bool] = False  # If true, user_images[0] is explicitly a product image from onboarding
    force_product_marketing: Optional[bool] = False  # If true, force product_marketing video type
    is_product_shot_flow: Optional[bool] = False  # If true, use product photography specialist persona (Flow 2)
    generation_type: Optional[str] = "on_demand"  # 'on_demand' for manual, 'auto' for automated generation
    # NEW: Video length mode for flexible video generation
    # - "quick": 8s single clip (1 clip, hook+reveal)
    # - "standard": 16s (2 clips, condensed story) - DEFAULT
    # - "story": 30-45s (3-5 clips, full 7-beat arc for Creative Director, extended 3-beat for Photographer)
    video_length_mode: Optional[str] = "standard"  # "quick" | "standard" | "story"
    # User's video style choice
    # - "brand_marketing": Cinematic brand storytelling with mixed audio (DEFAULT)
    # - "product_marketing": Product showcase with professional narration
    # - "ugc_influencer": Authentic creator-style with character speaking
    video_style: Optional[str] = "brand_marketing"  # "brand_marketing" | "product_marketing" | "ugc_influencer"


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
            "generationType": request.generation_type or "on_demand",
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
        'nano-banana': 'fal-ai/nano-banana-pro/edit',  # Using nano-banana-pro for better quality
        'flux-pro-kontext': 'fal-ai/flux-pro/kontext'
    }
    return model_mapping.get(model_name, 'fal-ai/nano-banana-pro/edit')  # Default to nano-banana-pro for DVYB


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
        print(f"   🎵 generate_background_music_with_pixverse() called")
        print(f"      Video: {video_s3_url[:60]}...")
        print(f"      Duration: {duration}s")
        print(f"      Audio prompt: {audio_prompt[:100]}...")
        
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


async def generate_music_with_elevenlabs(music_prompt: str, duration_seconds: int) -> str:
    """Generate background music using ElevenLabs Sound Effects v2 via FAL.
    
    Args:
        music_prompt: Short description of the music style/mood
        duration_seconds: Duration in seconds (typically 4, 6, or 8 for clips)
        
    Returns:
        Path to generated audio file, or None on failure
    """
    try:
        print(f"   🎵 generate_music_with_elevenlabs() called")
        print(f"      Music prompt: {music_prompt[:100]}...")
        print(f"      Duration: {duration_seconds}s")
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    print(f"      📋 ElevenLabs: {log.get('message', str(log))}")
        
        result = await asyncio.to_thread(
            fal_client.subscribe,
            "fal-ai/elevenlabs/sound-effects/v2",
            arguments={
                "text": music_prompt,
                "prompt_influence": 0.3,
                "output_format": "mp3_44100_128",
                "duration_seconds": duration_seconds
            },
            with_logs=True,
            on_queue_update=on_queue_update
        )
        
        # ElevenLabs returns: {"audio": {"url": "..."}}
        if result and result.get("audio") and result["audio"].get("url"):
            audio_url = result["audio"]["url"]
            print(f"      ✅ ElevenLabs music generated: {audio_url[:60]}...")
            
            # Download audio to temp file
            response = requests.get(audio_url)
            if response.status_code == 200:
                with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as temp_file:
                    temp_file.write(response.content)
                    print(f"      ✅ Music downloaded to: {temp_file.name}")
                    return temp_file.name
            else:
                print(f"      ❌ Failed to download audio: HTTP {response.status_code}")
                return None
        else:
            print(f"      ❌ No audio file in ElevenLabs result")
            print(f"      Result: {result}")
            return None
            
    except Exception as e:
        print(f"   ❌ Error generating ElevenLabs music: {str(e)}")
        logger.error(f"ElevenLabs music generation error: {e}")
        import traceback
        traceback.print_exc()
        return None


async def apply_music_to_clip(clip_path: str, music_path: str, output_path: str) -> bool:
    """Apply background music to a video clip (replacing any existing audio).
    
    Args:
        clip_path: Path to video clip (no audio or with audio to replace)
        music_path: Path to music audio file
        output_path: Path for output video with music
        
    Returns:
        True on success, False on failure
    """
    try:
        print(f"      🎵 apply_music_to_clip() called")
        print(f"         Clip: {clip_path}")
        print(f"         Music: {music_path}")
        
        video = VideoFileClip(clip_path)
        music = AudioFileClip(music_path)
        
        # Trim or loop music to match video duration
        if music.duration < video.duration:
            # Loop music if shorter than video
            loops_needed = int(video.duration / music.duration) + 1
            music_clips = [music] * loops_needed
            music = concatenate_audioclips(music_clips)
        
        # Trim music to video duration
        music = music.subclip(0, video.duration)
        
        # Set music as video audio
        video_with_music = video.set_audio(music)
        
        # Write output
        video_with_music.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Cleanup
        video.close()
        music.close()
        video_with_music.close()
        
        print(f"      ✅ Music applied successfully")
        return True
        
    except Exception as e:
        print(f"      ❌ Error applying music to clip: {str(e)}")
        logger.error(f"Apply music error: {e}")
        return False


async def mix_music_and_voiceover_for_clip(
    no_audio_clip_path: str, 
    music_path: str, 
    voiceover_path: str, 
    output_path: str,
    music_volume: float = 0.3,
    voiceover_volume: float = 1.0
) -> bool:
    """Mix background music with voiceover for a clip.
    
    Args:
        no_audio_clip_path: Path to video clip without audio
        music_path: Path to music audio file
        voiceover_path: Path to voiceover audio file
        output_path: Path for output video
        music_volume: Volume multiplier for music (default 0.3 = 30%)
        voiceover_volume: Volume multiplier for voiceover (default 1.0 = 100%)
        
    Returns:
        True on success, False on failure
    """
    try:
        print(f"      🎵 mix_music_and_voiceover_for_clip() called")
        print(f"         Clip: {no_audio_clip_path}")
        print(f"         Music: {music_path}")
        print(f"         Voiceover: {voiceover_path}")
        print(f"         Mix ratio: music {music_volume*100:.0f}%, voiceover {voiceover_volume*100:.0f}%")
        
        video = VideoFileClip(no_audio_clip_path)
        music = AudioFileClip(music_path)
        voiceover = AudioFileClip(voiceover_path)
        
        # Trim or loop music to match video duration
        if music.duration < video.duration:
            loops_needed = int(video.duration / music.duration) + 1
            music_clips = [music] * loops_needed
            music = concatenate_audioclips(music_clips)
        music = music.subclip(0, video.duration)
        
        # Adjust volumes
        music = music.volumex(music_volume)
        voiceover = voiceover.volumex(voiceover_volume)
        
        # Trim voiceover if longer than video (shouldn't happen but safety)
        if voiceover.duration > video.duration:
            voiceover = voiceover.subclip(0, video.duration)
        
        # Mix audio tracks
        mixed_audio = CompositeAudioClip([music, voiceover])
        
        # Apply to video
        video_with_audio = video.set_audio(mixed_audio)
        
        # Write output
        video_with_audio.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            logger=None
        )
        
        # Cleanup
        video.close()
        music.close()
        voiceover.close()
        mixed_audio.close()
        video_with_audio.close()
        
        print(f"      ✅ Music and voiceover mixed successfully")
        return True
        
    except Exception as e:
        print(f"      ❌ Error mixing music and voiceover: {str(e)}")
        logger.error(f"Mix music/voiceover error: {e}")
        import traceback
        traceback.print_exc()
        return False


async def mix_voiceover_with_background_music(video_with_music_s3_url: str, voiceover_audio_path: str, account_id: int, generation_uuid: str, video_index: int) -> str:
    """Mix voiceover with background music video, with voiceover at higher volume."""
    try:
        print(f"   🎵 mix_voiceover_with_background_music() called")
        print(f"      Video with music: {video_with_music_s3_url[:60]}...")
        print(f"      Voiceover file: {voiceover_audio_path}")
        
        # Download video with music from S3
        print(f"      📥 Downloading video with background music from S3...")
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
            presigned_url = web2_s3_helper.generate_presigned_url(video_with_music_s3_url)
            response = requests.get(presigned_url)
            temp_file.write(response.content)
            video_with_music_path = temp_file.name
        print(f"      ✅ Downloaded: {len(response.content) / 1024:.1f} KB")
        
        # Verify voiceover file exists
        if not os.path.exists(voiceover_audio_path):
            print(f"      ❌ Voiceover file not found: {voiceover_audio_path}")
            return None
        
        voiceover_size = os.path.getsize(voiceover_audio_path)
        print(f"      ✅ Voiceover file exists: {voiceover_size / 1024:.1f} KB")
        
        # Load video and audio files
        print(f"      🔊 Loading audio tracks...")
        video_clip = VideoFileClip(video_with_music_path)
        background_music_clip = video_clip.audio
        voiceover_clip = AudioFileClip(voiceover_audio_path)
        
        print(f"         Background music duration: {background_music_clip.duration:.1f}s")
        print(f"         Voiceover duration: {voiceover_clip.duration:.1f}s")
        
        # Adjust volumes: voiceover louder than background music
        print(f"      🔉 Adjusting volumes...")
        print(f"         Background music: 30% (ducked under voiceover)")
        print(f"         Voiceover: 100% (full volume)")
        background_music_clip = background_music_clip.volumex(0.3)  # 30% volume for background music
        voiceover_clip = voiceover_clip.volumex(1.0)  # 100% volume for voiceover
        
        # Mix audio tracks together
        print(f"      🎚️ Compositing audio tracks...")
        combined_audio = CompositeAudioClip([background_music_clip, voiceover_clip])
        
        # Set audio to video
        final_clip = video_clip.set_audio(combined_audio)
        
        # Save final clip to temporary file
        print(f"      💾 Encoding final video with mixed audio...")
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
        
        final_size = os.path.getsize(final_path)
        print(f"      ✅ Encoded: {final_size / (1024*1024):.1f} MB")
        
        # Upload to S3
        print(f"      📤 Uploading final video to S3...")
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
        
        print(f"   ✅ AUDIO MIX COMPLETE: {s3_url}")
        return s3_url
        
    except Exception as e:
        print(f"❌ Error mixing voiceover with background music: {str(e)}")
        logger.error(f"Audio mixing error: {e}")
        return None


async def replace_video_audio_with_inspiration_music(
    video_s3_url: str, 
    inspiration_music_s3_key: str, 
    account_id: int, 
    generation_uuid: str, 
    video_index: int,
    target_duration: float = None
) -> str:
    """
    Replace the audio in a video with inspiration background music.
    Used when video inspiration is provided to use the inspiration's music instead of AI-generated audio.
    
    Args:
        video_s3_url: S3 key of the video to process
        inspiration_music_s3_key: S3 key of the inspiration background music
        account_id: Account ID for S3 path
        generation_uuid: Generation UUID for S3 path
        video_index: Video index for naming
        target_duration: Target duration in seconds (loops/trims music to match video)
    
    Returns:
        S3 key of the final video with inspiration music, or None if failed
    """
    try:
        print(f"🎶 Replacing video audio with inspiration background music...")
        print(f"   Video: {video_s3_url[:60]}...")
        print(f"   Music: {inspiration_music_s3_key[:60]}...")
        
        # Download video from S3
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
            presigned_url = web2_s3_helper.generate_presigned_url(video_s3_url)
            response = requests.get(presigned_url)
            temp_file.write(response.content)
            video_path = temp_file.name
        
        # Download inspiration music from S3
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            music_presigned_url = web2_s3_helper.generate_presigned_url(inspiration_music_s3_key)
            response = requests.get(music_presigned_url)
            temp_file.write(response.content)
            music_path = temp_file.name
        
        # Load video and music
        video_clip = VideoFileClip(video_path)
        video_duration = video_clip.duration
        print(f"   Video duration: {video_duration:.2f}s")
        
        music_clip = AudioFileClip(music_path)
        music_duration = music_clip.duration
        print(f"   Music duration: {music_duration:.2f}s")
        
        # Adjust music to match video duration
        if music_duration < video_duration:
            # Loop music if shorter than video
            print(f"   Looping music to match video duration...")
            loops_needed = int(video_duration / music_duration) + 1
            # Create list of music clips for looping
            music_clips = [music_clip] * loops_needed
            from moviepy.editor import concatenate_audioclips
            music_clip = concatenate_audioclips(music_clips)
        
        # Trim music to match video duration
        music_clip = music_clip.subclip(0, video_duration)
        
        # Set music as video audio
        final_clip = video_clip.set_audio(music_clip)
        
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
            filename=f"video_{video_index}_with_inspiration_music.mp4"
        )
        
        # Clean up
        video_clip.close()
        music_clip.close()
        final_clip.close()
        
        try:
            os.remove(video_path)
            os.remove(music_path)
            os.remove(final_path)
        except:
            pass
        
        print(f"✅ Video audio replaced with inspiration music: {s3_url}")
        return s3_url
        
    except Exception as e:
        print(f"❌ Error replacing video audio with inspiration music: {str(e)}")
        import traceback
        print(f"   {traceback.format_exc()}")
        logger.error(f"Inspiration music replacement error: {e}")
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
                    # Handle dict or string format for logging
                    if isinstance(selected_brand_image, dict):
                        img_url = selected_brand_image.get('url', str(selected_brand_image)[:50])
                        logger.info(f"🖼️ Selected brand image from {len(brand_images)} available: {img_url[:50]}...")
                    else:
                        logger.info(f"🖼️ Selected brand image from {len(brand_images)} available: {str(selected_brand_image)[:50]}...")
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

async def analyze_user_images(user_images: List[str], context: Dict, is_onboarding_product_image: bool = False) -> Dict:
    """Analyze user-uploaded images with Grok using full brand context
    
    Args:
        user_images: List of S3 keys for user-uploaded images
        context: Full brand context
        is_onboarding_product_image: If True, the first image is explicitly a product image from onboarding
    """
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
                presigned_url = user_images_presigned[s3_key]
                # Validate that it's actually a URL, not an S3 key
                if presigned_url and (presigned_url.startswith('http://') or presigned_url.startswith('https://')):
                    presigned_urls.append(presigned_url)
                    print(f"  ✅ User image presigned URL: {presigned_url[:80]}...")
                else:
                    print(f"  ⚠️ Invalid presigned URL for {s3_key}: {presigned_url}")
            else:
                # Fallback: generate if not found (shouldn't happen in normal flow)
                print(f"⚠️ Presigned URL not found for {s3_key}, generating on-demand...")
                try:
                    presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                    if presigned_url and (presigned_url.startswith('http://') or presigned_url.startswith('https://')):
                        presigned_urls.append(presigned_url)
                        print(f"  ✅ Generated presigned URL: {presigned_url[:80]}...")
                    else:
                        print(f"  ❌ Failed to generate valid presigned URL for {s3_key}")
                except Exception as e:
                    logger.error(f"❌ Failed to generate presigned URL for {s3_key}: {e}")
                    # Do NOT add invalid URLs to the list
        
        # Add selected brand image (if available) as an inspirational image
        selected_brand_image = context.get('selected_brand_image')
        if selected_brand_image:
            # Extract S3 key from dict or use as-is if it's already a string
            if isinstance(selected_brand_image, dict):
                brand_image_s3_key = selected_brand_image.get('url') or selected_brand_image.get('s3_key')
            elif isinstance(selected_brand_image, str):
                brand_image_s3_key = selected_brand_image
            else:
                print(f"  ⚠️ Unexpected brand image format: {type(selected_brand_image)}")
                brand_image_s3_key = None
            
            if brand_image_s3_key:
                print(f"🎨 Adding brand image as inspiration: {brand_image_s3_key[:80]}...")
                try:
                    brand_image_url = web2_s3_helper.generate_presigned_url(brand_image_s3_key)
                    if brand_image_url and (brand_image_url.startswith('http://') or brand_image_url.startswith('https://')):
                        presigned_urls.append(brand_image_url)
                        brand_image_index = len(presigned_urls)  # 1-based index
                        print(f"  ✅ Brand image added at index {brand_image_index}: {brand_image_url[:80]}...")
                    else:
                        print(f"  ❌ Failed to generate valid presigned URL for brand image: {brand_image_s3_key}")
                except Exception as e:
                    logger.error(f"❌ Failed to generate presigned URL for brand image: {e}")
            else:
                print(f"  ⚠️ Could not extract S3 key from brand image")
        
        print(f"🔗 Using {len(presigned_urls)} presigned URLs for Grok analysis (including {1 if brand_image_index else 0} brand image)")
        
        # Fetch available inspiration categories for category matching
        available_categories = get_available_inspiration_categories()
        categories_list_str = ", ".join(available_categories) if available_categories else "No categories available"
        
        # Call Grok inventory analysis with brand context
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
        import json
        
        # Build comprehensive product/inspiration/model classification prompt
        brand_image_note = f"\n\n🎨 **BRAND IMAGE**: Image {brand_image_index} is a brand-provided inspirational image. It MUST be classified as INSPIRATION IMAGE." if brand_image_index else ""
        
        # Add category selection section if categories are available
        category_selection_note = ""
        if available_categories:
            category_selection_note = f"""

🎯 **PRODUCT CATEGORY MATCHING** (CRITICAL):
After analyzing the product images, you MUST also suggest which inspiration category from our database best matches the user's product.

**AVAILABLE CATEGORIES** (you MUST choose from this list ONLY - do NOT make up categories):
{categories_list_str}

**INSTRUCTIONS**:
1. Look at the product images you classified
2. Determine which category from the list above most closely matches the product
3. If multiple products are detected, choose the category that best represents the PRIMARY product
4. If no category matches well, choose the CLOSEST match from the list
5. You MUST select from the provided list - do NOT create new category names

**OUTPUT**: Add a "suggested_category" field to your JSON response with the category name you selected from the list above.
Example: "suggested_category": "Fashion" (must be exactly one of the categories from the list)
"""
        
        # Add onboarding product image hint
        onboarding_product_note = ""
        if is_onboarding_product_image:
            onboarding_product_note = """

🛍️ **CRITICAL - ONBOARDING PRODUCT IMAGE**:
The user has explicitly uploaded Image 1 as their PRODUCT IMAGE during onboarding.
This image MUST be classified as a PRODUCT IMAGE regardless of what is shown.
Even if the image shows a person wearing/holding/using the product, classify it as PRODUCT (not model).
The person in the image (if any) should be described in the product's 'showcases' field as part of how the product is displayed.
This product will be featured in the generated content."""
        
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
''' if user_context_str else ''}{brand_image_note}{onboarding_product_note}{category_selection_note}

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
  }},
  "suggested_category": "<category name from the provided list, or null if no product images detected>"
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
            
            # Log suggested category if available
            suggested_category = inventory_analysis.get('suggested_category')
            if suggested_category:
                print(f"\n🎯 SUGGESTED CATEGORY: {suggested_category}")
            else:
                print(f"\n🎯 SUGGESTED CATEGORY: None (no product images or category not suggested)")
            
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

def get_existing_inspiration_analysis(url: str) -> Optional[Dict]:
    """
    Get existing inspiration analysis from database if it exists.
    Returns the analysis dict if found, None otherwise.
    """
    try:
        from app.database.connection import get_db_session
        from sqlalchemy import text
        import json
        
        session = get_db_session()
        try:
            # Query database for inspiration link with this URL
            # Check both url and mediaUrl fields (for custom uploads)
            query = text("""
                SELECT "inspirationAnalysis" 
                FROM dvyb_inspiration_links 
                WHERE "isActive" = true 
                  AND (
                    url = :url 
                    OR "mediaUrl" = :url
                  )
                  AND "inspirationAnalysis" IS NOT NULL
                LIMIT 1
            """)
            
            result = session.execute(query, {"url": url}).fetchone()
            
            if result and result[0]:
                # Parse JSON string to dict
                analysis = json.loads(result[0])
                print(f"  ✅ Found existing analysis in database for: {url[:80]}...")
                return analysis
            else:
                print(f"  ℹ️  No existing analysis found in database for: {url[:80]}...")
                return None
                
        finally:
            session.close()
            
    except Exception as e:
        logger.warning(f"⚠️ Error checking database for existing analysis: {e}")
        # If database check fails, proceed with Grok analysis
        return None


def get_available_inspiration_categories() -> List[str]:
    """
    Fetch all distinct categories from dvyb_inspiration_links table.
    Returns list of category names.
    """
    try:
        from app.database.connection import get_db_session
        from sqlalchemy import text
        
        session = get_db_session()
        try:
            query = text("""
                SELECT DISTINCT category 
                FROM dvyb_inspiration_links 
                WHERE "isActive" = true 
                  AND category IS NOT NULL 
                  AND category != ''
                ORDER BY category ASC
            """)
            
            result = session.execute(query).fetchall()
            categories = [row[0] for row in result if row[0]]
            
            print(f"📋 Found {len(categories)} distinct inspiration categories in database")
            return categories
                
        finally:
            session.close()
            
    except Exception as e:
        logger.warning(f"⚠️ Error fetching inspiration categories: {e}")
        return []


def get_inspirations_by_category(category: str, count: int = 4, media_type: str = "image") -> List[Dict]:
    """
    Get random inspirations from a specific category that have analysis available.
    
    Args:
        category: Category name to match
        count: Number of inspirations to return (default 4)
        media_type: Filter by media type - "image" or "video" (default "image")
    
    Returns:
        List of inspiration dicts with url, mediaUrl, and analysis
    """
    try:
        from app.database.connection import get_db_session
        from sqlalchemy import text
        import json
        import random
        
        session = get_db_session()
        try:
            # Query inspirations matching category with analysis available
            query = text("""
                SELECT id, url, "mediaUrl", category, title, "mediaType", "inspirationAnalysis"
                FROM dvyb_inspiration_links 
                WHERE "isActive" = true 
                  AND category = :category
                  AND "mediaType" = :media_type
                  AND "inspirationAnalysis" IS NOT NULL
                ORDER BY RANDOM()
                LIMIT :limit
            """)
            
            result = session.execute(query, {"category": category, "media_type": media_type, "limit": count}).fetchall()
            
            inspirations = []
            for row in result:
                inspiration = {
                    "id": row[0],
                    "url": row[1] or row[2],  # Use url or mediaUrl
                    "category": row[3],
                    "title": row[4],
                    "media_type": row[5],
                }
                inspirations.append(inspiration)
            
            print(f"🎯 Found {len(inspirations)} {media_type} inspirations in category '{category}' with analysis available")
            return inspirations
                
        finally:
            session.close()
            
    except Exception as e:
        logger.warning(f"⚠️ Error fetching inspirations by category: {e}")
        return []


async def extract_inspiration_music_only(url: str, account_id: int, clips_per_video: int = 1) -> Optional[str]:
    """
    Extract background music from video inspiration link without doing full Grok analysis.
    This is used when we have existing analysis in the database but still need to extract music.
    
    Args:
        url: Video URL to extract music from
        account_id: Account ID for S3 paths
        clips_per_video: Number of clips per video (used to calculate max_duration)
    
    Returns:
        S3 key of the background music, or None if extraction failed or music shouldn't be used
    """
    max_duration = clips_per_video * 8
    output_dir = f"/tmp/dvyb-inspiration-music/{uuid.uuid4().hex[:8]}"
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        print(f"  🎵 Extracting music from video inspiration (analysis already exists in DB)...")
        print(f"     URL: {url[:80]}...")
        
        # Step 1: Download video
        video_path, is_video = download_inspiration_video(url, output_dir)
        if not is_video or not video_path:
            print(f"  ⚠️ Not a video or download failed, skipping music extraction")
            return None
        
        # Step 2: Extract and transcribe audio (to check for vocals)
        transcript, background_music_path = extract_and_transcribe_audio(video_path, output_dir, max_duration=max_duration)
        
        # Step 3: Check if inspiration audio has significant vocals (English words > 5)
        # If yes, don't use inspiration music (keep AI-generated audio in final video)
        use_inspiration_music = True
        if transcript and transcript.strip():
            # Count words in transcript (split by whitespace)
            word_count = len(transcript.strip().split())
            print(f"  🎤 Transcript word count: {word_count}")
            
            if word_count > 5:
                # Check if it contains English words (basic check: has ASCII letters)
                import re
                english_words = re.findall(r'[a-zA-Z]+', transcript)
                english_word_count = len(english_words)
                
                if english_word_count > 5:
                    use_inspiration_music = False
                    print(f"  ⚠️ Significant vocals detected ({english_word_count} English words)")
                    print(f"     Skipping inspiration music - will keep AI-generated audio in final video")
                    return None
                else:
                    print(f"  ✅ Minimal English vocals ({english_word_count} words) - will use inspiration music")
            else:
                print(f"  ✅ Minimal vocals ({word_count} words) - will use inspiration music")
        else:
            print(f"  ✅ No vocals detected - will use inspiration music")
        
        # Step 4: Upload background music to S3 (only if no significant vocals)
        background_music_s3_key = None
        if use_inspiration_music and background_music_path and os.path.exists(background_music_path):
            print(f"  📤 Uploading background music to S3...")
            background_music_s3_key = web2_s3_helper.upload_from_file(
                file_path=background_music_path,
                folder=f"dvyb/inspiration-audio/{account_id}",
                filename=f"background_music_{uuid.uuid4().hex[:8]}.wav"
            )
            if background_music_s3_key:
                print(f"  ✅ Background music uploaded: {background_music_s3_key}")
            else:
                print(f"  ⚠️ Failed to upload background music")
        
        return background_music_s3_key
        
    except Exception as e:
        print(f"  ❌ Music extraction failed: {e}")
        import traceback
        print(f"     {traceback.format_exc()}")
        return None
    
    finally:
        # Cleanup
        import shutil
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)


async def analyze_inspiration_links(links: List[str], context: dict = None, account_id: int = None, clips_per_video: int = 1, num_posts: int = None) -> Dict:
    """
    Analyze inspiration links - handles both video platforms and regular web links.
    - Video platforms (YouTube, Instagram, Twitter) → Extract frames + transcript → Grok video analysis
    - Regular links → Grok live search (web_source)
    
    Args:
        links: List of URLs to analyze
        context: Context dict with brand info
        account_id: Account ID for S3 paths
        clips_per_video: Number of clips per video (used to calculate max_duration for video analysis)
        num_posts: Number of posts to generate (used to randomly select inspirations if more provided)
    """
    if not links or all(not link.strip() for link in links):
        return {}
    
    try:
        print("=" * 80)
        print("🔗 INSPIRATION LINK ANALYSIS")
        print("=" * 80)
        
        # Filter out empty links
        valid_links = [link.strip() for link in links if link.strip()]
        print(f"🔗 Number of links: {len(valid_links)}")
        print(f"🔗 Links: {valid_links}")
        
        # If user provided more inspirations than posts to generate, randomly select to match post count
        if num_posts and len(valid_links) > num_posts:
            import random
            print(f"⚖️ User provided {len(valid_links)} inspirations for {num_posts} posts - randomly selecting {num_posts}")
            valid_links = random.sample(valid_links, num_posts)
            print(f"🎲 Randomly selected links: {valid_links}")
        
        # Separate links by type: video platform, direct media files (S3/CDN), or regular web links
        from urllib.parse import urlparse
        
        video_links = []
        direct_media_links = []  # S3/CDN image/video URLs
        regular_links = []
        
        for link in valid_links:
            if is_video_platform_url(link):
                video_links.append(link)
            else:
                # Check if it's a direct media file (S3, CDN, etc.)
                url_lower = link.lower()
                parsed_url = urlparse(link)
                path_lower = parsed_url.path.lower()
                
                image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
                video_extensions = ['.mp4', '.webm', '.mpeg', '.mov', '.avi', '.mkv']
                
                is_direct_image = any(path_lower.endswith(ext) for ext in image_extensions)
                is_direct_video = any(path_lower.endswith(ext) for ext in video_extensions)
                
                if is_direct_image or is_direct_video:
                    direct_media_links.append(link)
                else:
                    regular_links.append(link)
        
        print(f"🎬 Video platform links: {len(video_links)}")
        print(f"🖼️ Direct media links (S3/CDN): {len(direct_media_links)}")
        print(f"🌐 Regular links: {len(regular_links)}")
        
        result = {}
        
        # Process video/image platform links first (if any)
        if video_links and context and account_id:
            print(f"\n📹 Processing {len(video_links)} video/image inspiration link(s)...")
            print(f"📊 Clips per video: {clips_per_video} → Processing up to {clips_per_video * 8}s of video")
            video_inspirations = []
            image_inspirations = []
            
            # Process ALL user-provided links (already limited by random selection above)
            # For 1:1 mapping with generated content
            max_links_to_process = num_posts if num_posts else (4 if context.get("is_product_shot_flow", False) else len(video_links))
            links_to_process = video_links[:max_links_to_process]
            
            for link in links_to_process:
                # Check if analysis already exists in database
                existing_analysis = get_existing_inspiration_analysis(link)
                if existing_analysis:
                    # Use existing analysis, but still extract music (music extraction is not stored in DB)
                    if "video_inspiration" in existing_analysis:
                        video_inspiration = existing_analysis["video_inspiration"].copy()
                        print(f"  ✅ Using existing video inspiration analysis from database")
                        
                        # Extract music from video (music is not stored in DB, needs to be extracted during generation)
                        print(f"  🎵 Extracting music from video (analysis exists but music needs to be extracted)...")
                        music_s3_key = await extract_inspiration_music_only(link, account_id, clips_per_video)
                        if music_s3_key:
                            video_inspiration["background_music_s3_key"] = music_s3_key
                            print(f"  ✅ Music extracted and added to existing analysis")
                        else:
                            # If music extraction failed or shouldn't be used, keep existing music key if present
                            if "background_music_s3_key" not in video_inspiration:
                                print(f"  ⚠️  Music extraction failed or not applicable, no music will be used")
                        
                        video_inspirations.append(video_inspiration)
                    elif "image_inspiration" in existing_analysis:
                        image_inspirations.append(existing_analysis["image_inspiration"])
                        print(f"  ✅ Using existing image inspiration analysis from database")
                    else:
                        # If existing analysis doesn't have video/image structure, try processing
                        print(f"  ⚠️  Existing analysis found but doesn't match expected format, processing with Grok...")
                        video_analysis = await process_video_inspiration_link(link, context, account_id, clips_per_video)
                        if video_analysis:
                            video_inspirations.append(video_analysis)
                        else:
                            image_analysis = await process_image_inspiration_link(link, context, account_id)
                            if image_analysis:
                                image_inspirations.append(image_analysis)
                else:
                    # No existing analysis, process with Grok (includes music extraction)
                    # Try video first
                    video_analysis = await process_video_inspiration_link(link, context, account_id, clips_per_video)
                    if video_analysis:
                        video_inspirations.append(video_analysis)
                    else:
                        # If video processing failed, try as image
                        print(f"\n📸 Video processing failed, trying as image inspiration...")
                        image_analysis = await process_image_inspiration_link(link, context, account_id)
                        if image_analysis:
                            image_inspirations.append(image_analysis)
            
            if video_inspirations:
                result["video_inspiration"] = video_inspirations[0]  # Use first video inspiration
                print(f"\n✅ Video inspiration analysis complete!")
                print(f"⏭️  Skipping Grok live search on regular links (video inspiration takes priority)")
                return result  # Return early - skip regular link analysis when video inspiration exists
            
            if image_inspirations:
                # Store multiple inspirations as list for 1:1 mapping with generated content
                if len(image_inspirations) > 1:
                    result["image_inspirations"] = image_inspirations  # Store as list
                    print(f"\n✅ {len(image_inspirations)} image inspiration(s) analysis complete!")
                    print(f"📋 Multiple inspirations stored for 1:1 mapping with content")
                else:
                    result["image_inspiration"] = image_inspirations[0]  # Use first image inspiration
                    print(f"\n✅ Image inspiration analysis complete!")
                print(f"⏭️  Skipping Grok live search on regular links (image inspiration takes priority)")
                return result  # Return early - skip regular link analysis when image inspiration exists
        
        # Process direct media links (S3/CDN images/videos) - similar to video platform links
        if direct_media_links and context and account_id:
            print(f"\n🖼️ Processing {len(direct_media_links)} direct media file(s) (S3/CDN)...")
            direct_video_inspirations = []
            direct_image_inspirations = []
            
            # Process ALL user-provided links (already limited by random selection above)
            max_links_to_process = num_posts if num_posts else len(direct_media_links)
            links_to_process = direct_media_links[:max_links_to_process]
            
            for link in links_to_process:
                # Check if analysis already exists in database
                existing_analysis = get_existing_inspiration_analysis(link)
                if existing_analysis:
                    # Use existing analysis directly
                    if "video_inspiration" in existing_analysis:
                        video_inspiration = existing_analysis["video_inspiration"].copy()
                        print(f"  ✅ Using existing video inspiration analysis from database for: {link[:80]}...")
                        
                        # Extract music from video (music is not stored in DB, needs to be extracted during generation)
                        print(f"  🎵 Extracting music from video (analysis exists but music needs to be extracted)...")
                        music_s3_key = await extract_inspiration_music_only(link, account_id, clips_per_video)
                        if music_s3_key:
                            video_inspiration["background_music_s3_key"] = music_s3_key
                            print(f"  ✅ Music extracted and added to existing analysis")
                        else:
                            if "background_music_s3_key" not in video_inspiration:
                                print(f"  ⚠️  Music extraction failed or not applicable, no music will be used")
                        
                        direct_video_inspirations.append(video_inspiration)
                    elif "image_inspiration" in existing_analysis:
                        direct_image_inspirations.append(existing_analysis["image_inspiration"])
                        print(f"  ✅ Using existing image inspiration analysis from database for: {link[:80]}...")
                    else:
                        # If existing analysis doesn't have expected structure, try processing
                        print(f"  ⚠️  Existing analysis found but doesn't match expected format, processing with Grok...")
                        # Determine if it's image or video based on extension
                        url_lower = link.lower()
                        parsed_url = urlparse(link)
                        path_lower = parsed_url.path.lower()
                        image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
                        video_extensions = ['.mp4', '.webm', '.mpeg', '.mov', '.avi', '.mkv']
                        is_direct_image = any(path_lower.endswith(ext) for ext in image_extensions)
                        
                        if is_direct_image:
                            image_analysis = await process_image_inspiration_link(link, context, account_id)
                            if image_analysis:
                                direct_image_inspirations.append(image_analysis)
                        else:
                            video_analysis = await process_video_inspiration_link(link, context, account_id, clips_per_video)
                            if video_analysis:
                                direct_video_inspirations.append(video_analysis)
                else:
                    # No existing analysis, process with Grok
                    url_lower = link.lower()
                    parsed_url = urlparse(link)
                    path_lower = parsed_url.path.lower()
                    image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
                    video_extensions = ['.mp4', '.webm', '.mpeg', '.mov', '.avi', '.mkv']
                    is_direct_image = any(path_lower.endswith(ext) for ext in image_extensions)
                    
                    if is_direct_image:
                        print(f"  🖼️ Processing as direct image file...")
                        image_analysis = await process_image_inspiration_link(link, context, account_id)
                        if image_analysis:
                            direct_image_inspirations.append(image_analysis)
                    else:
                        print(f"  🎬 Processing as direct video file...")
                        video_analysis = await process_video_inspiration_link(link, context, account_id, clips_per_video)
                        if video_analysis:
                            direct_video_inspirations.append(video_analysis)
            
            # Add direct media inspirations to result
            if direct_video_inspirations:
                result["video_inspiration"] = direct_video_inspirations[0]  # Use first video inspiration
                print(f"\n✅ Direct video inspiration analysis complete!")
                print(f"⏭️  Skipping Grok live search on regular links (video inspiration takes priority)")
                return result  # Return early - skip regular link analysis when video inspiration exists
            
            if direct_image_inspirations:
                # Store multiple inspirations as list for 1:1 mapping with generated content
                if len(direct_image_inspirations) > 1:
                    result["image_inspirations"] = direct_image_inspirations  # Store as list
                    print(f"\n✅ {len(direct_image_inspirations)} direct image inspiration(s) analysis complete!")
                    print(f"📋 Multiple inspirations stored for 1:1 mapping with content")
                else:
                    result["image_inspiration"] = direct_image_inspirations[0]  # Use first image inspiration
                    print(f"\n✅ Direct image inspiration analysis complete!")
                print(f"⏭️  Skipping Grok live search on regular links (image inspiration takes priority)")
                return result  # Return early - skip regular link analysis when image inspiration exists
        
        # If no regular links, return result (which might be empty or have video/image analysis)
        if not regular_links:
            return result
        
        # Process regular links - check for existing analysis first
        print(f"\n🌐 Processing {len(regular_links)} regular link(s)...")
        
        # Check for existing analysis in database for each link
        links_without_analysis = []
        combined_existing_analysis = {}
        
        for link in regular_links:
            existing_analysis = get_existing_inspiration_analysis(link)
            if existing_analysis:
                # Merge existing analysis into result
                if "summary" in existing_analysis:
                    # For regular links, existing analysis should have "summary" or "raw_summary"
                    if "summary" not in combined_existing_analysis:
                        combined_existing_analysis["summary"] = existing_analysis.get("summary", "")
                    else:
                        # Combine summaries if multiple links
                        combined_existing_analysis["summary"] += "\n\n" + existing_analysis.get("summary", "")
                    
                    if "raw_summary" in existing_analysis:
                        if "raw_summary" not in combined_existing_analysis:
                            combined_existing_analysis["raw_summary"] = existing_analysis.get("raw_summary", "")
                        else:
                            combined_existing_analysis["raw_summary"] += "\n\n" + existing_analysis.get("raw_summary", "")
                    
                    print(f"  ✅ Using existing analysis from database for: {link[:80]}...")
                else:
                    # Analysis exists but doesn't have summary (might be video/image), add to links to process
                    links_without_analysis.append(link)
            else:
                # No existing analysis, need to call Grok
                links_without_analysis.append(link)
        
        # If we have existing analysis for all links, return it
        if combined_existing_analysis and not links_without_analysis:
            print(f"✅ Using existing analysis from database for all {len(regular_links)} link(s)")
            result.update(combined_existing_analysis)
            return result
        
        # If some links don't have analysis, process them with Grok
        if links_without_analysis:
            print(f"🌐 Processing {len(links_without_analysis)} link(s) with Grok live search (others have existing analysis)...")
            
            from xai_sdk import Client
            from xai_sdk.chat import user, system
            from xai_sdk.search import SearchParameters, web_source
            from urllib.parse import urlparse
            
            # Extract domains for Grok web_source filtering (limit to 10)
            allowed_websites = []
            for link in links_without_analysis[:10]:
                try:
                    parsed = urlparse(link)
                    domain = parsed.netloc or parsed.path.split('/')[0]
                    if domain and domain not in allowed_websites:
                        allowed_websites.append(domain)
                except Exception as e:
                    logger.warning(f"⚠️ Could not parse URL {link}: {e}")
            
            if not allowed_websites:
                print("⚠️ No valid domains extracted from links")
                # Return existing analysis if we have it
                if combined_existing_analysis:
                    result.update(combined_existing_analysis)
                return result
            
            print(f"🌐 Allowed websites for Grok web search: {allowed_websites}")
            
            # Get Grok API key
            grok_api_key = settings.xai_api_key
            if not grok_api_key:
                logger.warning("⚠️ No Grok API key for web live search")
                # Return existing analysis if we have it
                if combined_existing_analysis:
                    result.update(combined_existing_analysis)
                return result
            
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
{', '.join(links_without_analysis)}

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
                # Return existing analysis if we have it
                if combined_existing_analysis:
                    result.update(combined_existing_analysis)
                return result
            
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
        
        # Merge with existing analysis if present, otherwise use new Grok analysis
        if combined_existing_analysis:
            # Combine existing and new analysis
            if "summary" in combined_existing_analysis:
                result["summary"] = combined_existing_analysis["summary"] + "\n\n" + cleaned_text
            else:
                result["summary"] = cleaned_text
            
            if "raw_summary" in combined_existing_analysis:
                result["raw_summary"] = combined_existing_analysis["raw_summary"] + "\n\n" + link_analysis_text
            else:
                result["raw_summary"] = link_analysis_text
        else:
            # No existing analysis, use only new Grok analysis
            result["summary"] = cleaned_text
            result["raw_summary"] = link_analysis_text
        
        return result
        
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
    # Kling v2.6: supports 5s and 10s
    # Veo3.1: supports 4s, 6s, 8s
    # Ratio: 10% Kling, 90% Veo
    
    # Get video length mode (new system) or fall back to clips_per_video (legacy)
    video_length_mode = request.video_length_mode if hasattr(request, 'video_length_mode') and request.video_length_mode else "standard"
    mode_config = VIDEO_LENGTH_MODES.get(video_length_mode, VIDEO_LENGTH_MODES["standard"])
    
    # Get user's video style choice (defaults to brand_marketing)
    user_video_style = request.video_style if hasattr(request, 'video_style') and request.video_style else "brand_marketing"
    USER_CHOSE_VIDEO_STYLE = True  # User always has a choice (with default)
    print(f"🎬 Video style: {user_video_style}")
    
    # For story mode: Grok decides clip count. For others: use max_clips as fixed value
    MIN_CLIPS = mode_config["min_clips"]
    MAX_CLIPS = mode_config["max_clips"]
    CLIPS_PER_VIDEO = MAX_CLIPS  # Will be used as maximum/example, Grok can choose fewer
    GROK_DECIDES_CLIP_COUNT = (video_length_mode == "story")  # Story mode = Grok decides
    
    # Legacy support: Override with clips_per_video if explicitly set (backward compatibility)
    if hasattr(request, 'clips_per_video') and request.clips_per_video and request.clips_per_video > 1:
        CLIPS_PER_VIDEO = request.clips_per_video
        MAX_CLIPS = request.clips_per_video
        GROK_DECIDES_CLIP_COUNT = False
        print(f"⚠️ Legacy clips_per_video override: {CLIPS_PER_VIDEO}")
    
    # Override CLIPS_PER_VIDEO if video inspiration is provided with dynamic clips_per_video
    link_analysis = context.get("link_analysis", {})
    video_inspiration = link_analysis.get("video_inspiration", {}) if link_analysis else {}
    if video_inspiration and "clips_per_video" in video_inspiration:
        dynamic_clips = video_inspiration.get("clips_per_video")
        inspiration_duration = video_inspiration.get("video_duration", 0)
        original_clips = CLIPS_PER_VIDEO
        CLIPS_PER_VIDEO = dynamic_clips
        print(f"🎬 Video inspiration detected ({inspiration_duration:.1f}s) → Overriding clips per video: {original_clips} → {CLIPS_PER_VIDEO}")
    
    # Detect brand category for emotional targeting
    brand_category = detect_brand_category(context)
    is_product_flow = context.get("is_product_shot_flow", False) or context.get("use_photographer_persona", False)
    
    # Get storytelling context based on category and mode
    storytelling_ctx = get_storytelling_context(brand_category, video_length_mode, is_product_flow)
    
    # CLIP_DURATION will be set per video based on model selection (8s for Veo, 10s for Kling)
    # For Grok prompt generation, we use a conservative estimate
    CLIP_DURATION_ESTIMATE = 8  # Conservative estimate for prompt generation
    VIDEO_DURATION_ESTIMATE = CLIPS_PER_VIDEO * CLIP_DURATION_ESTIMATE
    
    print(f"⚙️ Video Length Mode: {video_length_mode} ({mode_config['description']})")
    print(f"⚙️ Brand Category: {brand_category} (Goal: {storytelling_ctx['goal']})")
    print(f"⚙️ Storytelling Framework: {storytelling_ctx['framework_type']}")
    print(f"⚙️ Video Configuration: {CLIPS_PER_VIDEO} clip(s) per video, ~{CLIP_DURATION_ESTIMATE}-10s per clip")
    print(f"⚙️ Model Selection: 10% Kling v2.6 (10s clips), 90% Veo3.1 (8s clips)")
    
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
    image_only_indices = [i for i in all_indices if i not in video_indices]
    
    print(f"🎲 Video indices: {sorted(video_indices)}")
    print(f"🖼️ Image-only indices: {sorted(image_only_indices)}")
    
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
    video_inspiration_str = ""
    image_inspiration_str = ""
    has_video_inspiration = False
    has_image_inspiration = False
    
    if link_analysis:
        # Check for video inspiration (from YouTube/Instagram/Twitter reel analysis)
        video_inspiration = link_analysis.get("video_inspiration")
        if video_inspiration:
            has_video_inspiration = True
            import json
            # Extract visual subjects (new detailed element analysis)
            visual_subjects = video_inspiration.get('visual_subjects', {})
            humans_desc = visual_subjects.get('humans', 'None') if visual_subjects else 'None'
            objects_props = visual_subjects.get('objects_props', []) if visual_subjects else []
            setting_location = visual_subjects.get('setting_location', 'N/A') if visual_subjects else 'N/A'
            actions_interactions = visual_subjects.get('actions_interactions', []) if visual_subjects else []
            environmental = visual_subjects.get('environmental_elements', 'N/A') if visual_subjects else 'N/A'
            
            video_inspiration_str = f"""
🎬 VIDEO INSPIRATION ANALYSIS (from reel/short):
- Storyline: {video_inspiration.get('storyline', 'N/A')}
- Hook (first 2-3s): {video_inspiration.get('hook', 'N/A')}
- Creative Elements: {', '.join(video_inspiration.get('creative_elements', []))}
- Visual Techniques: {', '.join(video_inspiration.get('visual_techniques', []))}

🔍 VISUAL SUBJECTS & ELEMENTS (consider incorporating when appropriate):
- Human Presence: {humans_desc}
- Objects/Props: {', '.join(objects_props) if objects_props else 'None identified'}
- Setting/Location: {setting_location}
- Actions/Interactions: {', '.join(actions_interactions) if actions_interactions else 'None identified'}
- Environmental Elements: {environmental}

- Mood/Atmosphere: {video_inspiration.get('mood_atmosphere', 'N/A')}
- Pacing: {video_inspiration.get('pacing', 'N/A')}
- Key Moments: {', '.join(video_inspiration.get('key_moments', []))}
- Product Showcase Style: {video_inspiration.get('product_showcase_style', 'N/A')}
- Replication Tips: {video_inspiration.get('replication_tips', 'N/A')}
- Transcript: "{video_inspiration.get('transcript', '')[:200]}{'...' if len(video_inspiration.get('transcript', '')) > 200 else ''}"
"""
            print(f"\n🎬 VIDEO INSPIRATION DETECTED!")
            print(f"   Storyline: {video_inspiration.get('storyline', 'N/A')[:100]}...")
            print(f"   Creative Elements: {video_inspiration.get('creative_elements', [])}")
            print(f"   Visual Subjects: humans={humans_desc[:50]}..., objects={objects_props[:3]}")
        
        # Check for image inspiration(s) (from Instagram/Twitter image post analysis)
        # Support both single inspiration and multiple inspirations (for product shot flow)
        image_inspiration = link_analysis.get("image_inspiration")
        image_inspirations_list = link_analysis.get("image_inspirations", [])
        
        # Get number of images for mapping (used in prompt instructions)
        num_images_for_mapping = request.number_of_images if hasattr(request, 'number_of_images') and request.number_of_images else num_images
        
        # If multiple inspirations exist, use them; otherwise use single inspiration
        if image_inspirations_list:
            has_image_inspiration = True
            num_inspirations = len(image_inspirations_list)
            print(f"\n🖼️ {num_inspirations} IMAGE INSPIRATION(S) DETECTED!")
            print(f"   Will be used for 1:1 mapping with {num_images_for_mapping} image(s)")
            
            # Format multiple inspirations for prompt generation
            inspiration_sections = []
            for idx, insp in enumerate(image_inspirations_list, 1):
                visual_aesthetics = insp.get('visual_aesthetics', {})
                composition = insp.get('composition', {})
                human_presence = insp.get('human_presence', {})
                setting = insp.get('setting', {})
                styling = insp.get('styling_aesthetics', {})
                
                inspiration_sections.append(f"""
🖼️ INSPIRATION {idx} ANALYSIS (from social media image post):

📸 VISUAL AESTHETICS:
- Color Palette: {', '.join(visual_aesthetics.get('color_palette', []))}
- Color Treatment: {visual_aesthetics.get('color_treatment', 'N/A')}
- Lighting Style: {visual_aesthetics.get('lighting_style', 'N/A')}
- Mood/Atmosphere: {visual_aesthetics.get('mood_atmosphere', 'N/A')}
- Visual Quality: {visual_aesthetics.get('visual_quality', 'N/A')}

📐 COMPOSITION & FRAMING:
- Shot Type: {composition.get('shot_type', 'N/A')}
- Camera Angle: {composition.get('angle', 'N/A')}
- Framing Techniques: {', '.join(composition.get('framing_techniques', []))}
- Depth of Field: {composition.get('depth_of_field', 'N/A')}

👤 HUMAN PRESENCE:
- Has Humans: {'Yes' if human_presence.get('has_humans') else 'No'}
- Count: {human_presence.get('count', 0)} person(s)
- Description: {human_presence.get('description', 'None')}

🌍 SETTING & ENVIRONMENT:
- Location Type: {setting.get('location_type', 'N/A')}
- Specific Setting: {setting.get('specific_setting', 'N/A')}
- Background: {setting.get('background', 'N/A')}

🎭 STYLING & AESTHETICS:
- Overall Style: {styling.get('overall_style', 'N/A')}
- Patterns: {', '.join(styling.get('patterns', []))}

💡 REPLICATION TIPS: {insp.get('replication_tips', 'N/A')}
""")
            
            image_inspiration_str = "\n".join(inspiration_sections)
            
        elif image_inspiration:
            has_image_inspiration = True
            num_inspirations = 1
            import json
            # Extract ALL visual elements comprehensively
            visual_aesthetics = image_inspiration.get('visual_aesthetics', {})
            composition = image_inspiration.get('composition', {})
            human_presence = image_inspiration.get('human_presence', {})
            characters_beings = image_inspiration.get('characters_and_beings', {})
            objects_and_props = image_inspiration.get('objects_and_props', {})
            setting = image_inspiration.get('setting', {})
            styling = image_inspiration.get('styling_aesthetics', {})
            technical = image_inspiration.get('technical_creative', {})
            action = image_inspiration.get('action_movement', {})
            
            image_inspiration_str = f"""
🖼️ IMAGE INSPIRATION ANALYSIS (from social media image post):

📸 VISUAL AESTHETICS:
- Color Palette: {', '.join(visual_aesthetics.get('color_palette', []))}
- Color Treatment: {visual_aesthetics.get('color_treatment', 'N/A')}
- Lighting Style: {visual_aesthetics.get('lighting_style', 'N/A')}
- Mood/Atmosphere: {visual_aesthetics.get('mood_atmosphere', 'N/A')}
- Visual Quality: {visual_aesthetics.get('visual_quality', 'N/A')}
- Filters/Effects: {visual_aesthetics.get('filters_effects', 'None')}

📐 COMPOSITION & FRAMING:
- Shot Type: {composition.get('shot_type', 'N/A')}
- Camera Angle: {composition.get('angle', 'N/A')}
- Framing Techniques: {', '.join(composition.get('framing_techniques', []))}
- Compositional Rules: {', '.join(composition.get('compositional_rules', []))}
- Depth of Field: {composition.get('depth_of_field', 'N/A')}
- Perspective: {composition.get('perspective', 'N/A')}

👤 HUMAN PRESENCE (CRITICAL):
- Has Humans: {'Yes' if human_presence.get('has_humans') else 'No'}
- Count: {human_presence.get('count', 0)} person(s)
- Visibility: {human_presence.get('visibility', 'N/A')}
- Description: {human_presence.get('description', 'None')}
- Poses/Gestures: {', '.join(human_presence.get('poses_and_gestures', []))}
- Positioning: {human_presence.get('positioning', 'N/A')}
- Interactions: {human_presence.get('interactions', 'N/A')}

🦁 CHARACTERS & LIVING BEINGS:
- Animals: {'Yes - ' + ', '.join(characters_beings.get('animals', [])) if characters_beings.get('has_animals') else 'No'}
- Characters: {'Yes - ' + ', '.join(characters_beings.get('characters', [])) if characters_beings.get('has_characters') else 'No'}
- Description: {characters_beings.get('description', 'None')}

🎨 OBJECTS & PROPS (ALL ELEMENTS):
- All Objects: {', '.join(objects_and_props.get('all_objects', [])[:10])}{'...' if len(objects_and_props.get('all_objects', [])) > 10 else ''}
- Main Subjects: {', '.join(objects_and_props.get('main_subjects', []))}
- Supporting Props: {', '.join(objects_and_props.get('supporting_props', [])[:5])}{'...' if len(objects_and_props.get('supporting_props', [])) > 5 else ''}
- Arrangement: {objects_and_props.get('arrangement', 'N/A')}
- Styling: {objects_and_props.get('styling', 'N/A')}
- Textures: {', '.join(objects_and_props.get('textures', []))}

🌍 SETTING & ENVIRONMENT:
- Location Type: {setting.get('location_type', 'N/A')}
- Specific Setting: {setting.get('specific_setting', 'N/A')}
- Background: {setting.get('background', 'N/A')}
- Environment: {setting.get('environment', 'N/A')}
- Weather/Time: {setting.get('weather_time', 'N/A')}

🎭 STYLING & AESTHETICS:
- Overall Style: {styling.get('overall_style', 'N/A')}
- Patterns: {', '.join(styling.get('patterns', []))}
- Materials: {', '.join(styling.get('materials', []))}
- Finishes: {', '.join(styling.get('finishes', []))}

📷 TECHNICAL & CREATIVE:
- Motion Elements: {technical.get('motion_elements', 'N/A')}
- Focus Techniques: {technical.get('focus_techniques', 'N/A')}
- Lens Effects: {', '.join(technical.get('lens_effects', []))}
- Post-Processing: {technical.get('post_processing', 'N/A')}
- Unique Techniques: {', '.join(technical.get('unique_techniques', []))}

⚡ ACTION & MOVEMENT:
- Has Action: {'Yes' if action.get('has_action') else 'No'}
- Description: {action.get('description', 'Static image')}

✨ CREATIVE ELEMENTS: {', '.join(image_inspiration.get('creative_elements', []))}

💡 REPLICATION TIPS: {image_inspiration.get('replication_tips', 'N/A')}
"""
            print(f"\n🖼️ IMAGE INSPIRATION DETECTED!")
            print(f"   Color Palette: {visual_aesthetics.get('color_palette', [])}...")
            print(f"   Mood: {visual_aesthetics.get('mood_atmosphere', 'N/A')}")
            print(f"   Human Presence: {'Yes' if human_presence.get('has_humans') else 'No'} ({human_presence.get('count', 0)} person(s))")
            print(f"   Objects: {len(objects_and_props.get('all_objects', []))} items identified")
        
        # Regular link analysis summary
        summary = link_analysis.get("summary")
        if summary and str(summary).strip():
            link_analysis_str = summary
    
    # Voiceover decision - Now Grok has CREATIVE FREEDOM to decide per-clip
    # But still respect inspiration overrides (no voiceover when inspiration is provided)
    voiceover_allowed = True  # Grok can decide
    voiceover_forced_off = False  # Override flag
    
    if has_video_inspiration:
        voiceover_forced_off = True
        voiceover_allowed = False
        print(f"🎬 Video inspiration detected: voiceover FORCED OFF (will use inspiration's background music)")
        print(f"   → Grok will NOT include voiceover in any clips")
    elif has_image_inspiration:
        voiceover_forced_off = True
        voiceover_allowed = False
        print(f"🖼️ Image inspiration detected: voiceover FORCED OFF (pure visual mode)")
        print(f"   → Grok will NOT include voiceover in any clips")
    else:
        print(f"🎤 Voiceover: GROK HAS CREATIVE FREEDOM")
        print(f"   → Grok will decide per-clip based on brand category, storytelling beat, and content type")
        print(f"   → Brand category: {brand_category}")
        print(f"   → Storytelling framework: {storytelling_ctx['framework_type']}")
    
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
                video_examples.append(f'''  "video_{video_idx}_clip_{clip_num}_duration": 4 or 6 or 8 (MANDATORY: choose duration based on the beat/purpose of this clip - see STORYTELLING FRAMEWORK),
  "video_{video_idx}_clip_{clip_num}_beat": "hook" or "build" or "escalation" or "transition" or "reveal" or "payoff" or "cta" (identify the storytelling beat for this clip),
  "video_{video_idx}_clip_{clip_num}_has_voiceover": true or false (YOUR CREATIVE DECISION - should this clip have voiceover narration?),
  "video_{video_idx}_clip_{clip_num}_music_prompt": "CONTEXT-AWARE music for this specific brand + beat (e.g. for food brand reveal: 'warm comfort food crescendo, satisfying meal moment', for tech hook: 'futuristic synth intro, innovation teaser')" or null (set null if voiceover/speech should dominate),
  "video_{video_idx}_clip_{clip_num}_image_prompt": "Detailed visual description for starting frame of clip {clip_num} in video {video_idx} (9:16 vertical aspect ratio, Instagram Reels style)...",
  "video_{video_idx}_clip_{clip_num}_product_mapping": "image_1" or "image_2" or null (map to product image if needed for this specific frame),
  "video_{video_idx}_clip_{clip_num}_prompt": "🚨 MANDATORY: Cinematic description + DYNAMIC QA specific to THIS clip's elements (see QA section). Analyze your image_prompt: what character/product details? Write QA protecting THOSE specific elements (e.g., '[product name] maintains shape', 'consistent [character hair/outfit]', 'five fingers on hand holding [object]'). Then 'no text overlays'. If has_voiceover=true, add voiceover at END.",
  "video_{video_idx}_clip_{clip_num}_logo_needed": true or false''')
            
            # Legacy audio prompt per video (kept for backward compatibility)
            video_examples.append(f'''  "video_{video_idx}_audio_prompt": "Create instrumental background music for {VIDEO_DURATION_ESTIMATE}-second video. Focus ONLY on music composition, NO sound effects."''')
        
        video_prompts_section = ",\n  ".join(video_examples)
        
        video_prompts_instruction = f"""

3. VIDEO TYPE SELECTION & GENERATION ({num_clips} videos, each ~{VIDEO_DURATION_ESTIMATE}-{CLIPS_PER_VIDEO * 10}s):
   
   🎯 CRITICAL: VIDEO TYPE DECISION
   
   🚨🚨🚨 **USER SELECTED VIDEO STYLE: {user_video_style.upper()}** 🚨🚨🚨
   
   **YOU MUST USE**: video_type = "{user_video_style}"
   **DO NOT OVERRIDE** - User explicitly selected this style, respect their choice!
   
   **VIDEO STYLES REFERENCE** (for your understanding):
   - **brand_marketing**: Cinematic brand storytelling, mixed audio (character speaking + voiceover + music)
   - **product_marketing**: Product showcase, professional narration, product as hero
   - **ugc_influencer**: Authentic creator-style, character speaking to camera throughout
   
   🚨🚨🚨 **CRITICAL - USER INTENT OVERRIDES EVERYTHING** 🚨🚨🚨
   
   If user explicitly mentions "product marketing" or indicates product-focused content:
   → video_type MUST be "product_marketing" - NEVER "ugc_influencer"
   
   If user explicitly mentions "brand marketing" or indicates brand-focused content:
   → video_type MUST be "brand_marketing" - NEVER "ugc_influencer"
   
   ⚠️ **IMPORTANT**: Product marketing videos CAN include human models wearing/using the product!
   - "Model wearing product" + "product marketing" → STILL "product_marketing" (NOT ugc_influencer)
   - The difference is STYLE: product_marketing is professional/cinematic, ugc_influencer is authentic/casual
   - Having a model in the video does NOT automatically make it UGC
   
   Only use "ugc_influencer" when ALL conditions are met:
   - {"❌ NOT ALLOWED: This video has {CLIPS_PER_VIDEO} clips (3+) → ugc_influencer is BLOCKED" if CLIPS_PER_VIDEO >= 3 else "✅ Video is SHORT (1-2 clips) → ugc_influencer is allowed"}
   - User explicitly wants authentic creator/influencer style content
   - Content is first-person testimonials, reviews, or casual vlog-style
   
   Based on this analysis, YOU MUST DECIDE the optimal video type.
   
   🎤🎤🎤 **PER-CLIP AUDIO DECISION - YOUR CREATIVE FREEDOM** 🎤🎤🎤
   
   {"🚨 VOICEOVER FORCED OFF: Inspiration content detected. All clips MUST have has_voiceover=false. NO voiceover in any clips." if voiceover_forced_off else f'''You have FULL CREATIVE CONTROL over audio for EACH CLIP independently.
   
   **THREE AUDIO OPTIONS PER CLIP** (mix freely for maximum engagement):
   1. **CHARACTER SPEAKING** → has_voiceover=false, add "Saying in [tone]: [speech]" in prompt
      - Character's lips move, authentic UGC feel, great for hooks & CTAs
   2. **VOICEOVER NARRATION** → has_voiceover=true, add "Voiceover in [voice]: [text]" at END
      - Professional narration over visuals, great for storytelling & explanations
   3. **PURE VISUAL + MUSIC** → has_voiceover=false, NO speech text in prompt
      - Music carries the emotion, great for reveals & sensory moments
   
   **DECISION CRITERIA** (use your creative judgment):
   - **Brand Category**: {brand_category}
   - **Storytelling Framework**: {storytelling_ctx["framework_type"]}
   - **Emotional Goal**: {storytelling_ctx["goal"]}
   
   **AUDIO STRATEGY BY BEAT** (suggestions, not rules):
   | Beat | Best Option | Why |
   |------|-------------|-----|
   | Hook | Character speaking | Direct connection, grabs attention |
   | Problem | Character OR voiceover | Relatable moment OR narrative setup |
   | Escalation | Music builds OR voiceover | Tension through sound |
   | Reveal | Pure visual + music | Let the moment breathe |
   | Payoff | Character reaction OR music | Emotional authenticity |
   | CTA | Character speaking | Personal invitation feels genuine |
   
   🎭 **NATURAL EXPRESSIONS BY BEAT** (EMBED in image + clip prompts):
   | Beat | Expression Cues to Include |
   |------|---------------------------|
   | Hook | "curious raised eyebrow", "slight head tilt", "engaged eye contact", "intrigued expression" |
   | Problem | "furrowed brow", "frustrated sigh", "disappointed head shake", "lips pressed in mild annoyance" |
   | Escalation | "eyes widening with realization", "mouth opening in surprise", "excited energy building" |
   | Reveal | "awe-struck expression", "jaw dropping slightly", "eyes sparkling with delight" |
   | Payoff | "satisfied closed-eye moment", "genuine smile reaching eyes", "content exhale" |
   | CTA | "warm inviting smile", "enthusiastic eye contact", "leaning toward camera", "animated gestures" |
   
   **AUDIO STRATEGY BY CATEGORY**:
   - FOOD: Character reacting to taste + sensory visuals with music
   - FASHION: Character showing off + lifestyle music beats
   - TECH: Mix of character demo + voiceover for features
   - DIGITAL SERVICE: Voiceover builds credibility + character testimonial
   - BEAUTY: Character transformation + reveal with music
   
   🎯 **GOAL**: Create a SCROLL-STOPPING video by mixing character speech, voiceover, and pure visuals strategically.
   
   **FOR EACH CLIP**:
   - "video_X_clip_Y_has_voiceover": true (for voiceover narration) or false (for character speech OR pure visual)
   - Add appropriate text in clip prompt based on your choice'''}
   
   A. **PRODUCT MARKETING VIDEO** (Professional product showcase):
      - Use when: User wants product-focused content, product launch, product showcase, OR user explicitly mentions "product marketing"
      - ⚠️ CAN include human models wearing/using the product - this is STILL product marketing, NOT UGC
      - FLAGS TO OUTPUT:
        * "video_type": "product_marketing"
        * "voiceover": false (legacy field - per-clip has_voiceover is now used)
        * "no_characters": true OR false (can have models in product marketing - set false if user wants model)
        * "human_characters_only": true if including models, false if pure product
        * "influencer_marketing": false (ALWAYS false for product marketing)
      - Style: Professional product showcase, feature highlights
      - **PER-CLIP VOICEOVER**: Decide has_voiceover for each clip based on beat purpose
      - Example clip WITH voiceover (has_voiceover=true): 'Sleek smartphone rotating on marble surface, camera orbiting, no text overlays. Voiceover in professional male voice: Introducing the future of technology.'
      - Example clip WITHOUT voiceover (has_voiceover=false): 'Sleek smartphone rotating, 360-degree orbit, dramatic rim lighting, cinematic atmosphere, no text overlays.'
      - 🚨 VOICEOVER TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-) in voiceover text.
   
   B. **UGC INFLUENCER VIDEO** (Authentic influencer style):
      - Use when: Lifestyle/personal use context, human engagement needed, relatable content, OR user explicitly requests UGC/influencer style video
      - FLAGS TO OUTPUT:
        * "video_type": "ugc_influencer"
        * "voiceover": false (character speaks on camera, embedded in Veo3.1 clip)
        * "no_characters": false
        * "human_characters_only": true
        * "influencer_marketing": true
      - Speech limit: 12-14 words MAX per 8-10s clip (for clips with influencer speaking)
      - Style: Authentic, conversational, relatable UGC content
      
      🎬 **UGC CLIP VARIETY** (NOT EVERY CLIP NEEDS INFLUENCER!):
      
      **IMPORTANT**: UGC videos can MIX influencer clips with pure visual clips for maximum impact!
      
      **CLIP TYPES FOR UGC VIDEOS** (mix intelligently):
      1. **INFLUENCER SPEAKING** → Character talks to camera, lips move, authentic feel
      2. **PURE VISUALS** → No human, just product/scene visuals (B-roll style)
      3. **INFLUENCER REACTING** → Character visible but not speaking, just reacting/using product
      
      **EXAMPLE UGC STORY FLOW** (5 clips):
      - Clip 1 [hook]: Influencer speaks to camera "POV: You just discovered..."
      - Clip 2 [problem]: Pure visual - close-up of the problem/situation (no human)
      - Clip 3 [build]: Influencer reacting with excited expression (minimal/no speech)
      - Clip 4 [reveal]: Pure visual - product hero shot (no human, let product shine)
      - Clip 5 [cta]: Influencer speaks "Link in bio, you need this!"
      
      **WHY MIX?**: 
      - Pure visual clips add VARIETY and keep viewers engaged
      - Product close-ups without influencer = professional feel within UGC
      - Not every moment needs talking - some beats are VISUAL
      - Creates scroll-stopping rhythm: talk → visual → talk → visual → CTA
      
      🎬 **COMPELLING HOOKS & STORYLINES** (CRITICAL FOR IMPACT):
      
      Every UGC clip MUST have a PURPOSE. The influencer is promoting a brand - make every second count:
      
      **STORY STRUCTURE**:
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
   
   C. **BRAND MARKETING VIDEO** (Brand storytelling with CHARACTER-DRIVEN narrative):
      - Use when: Story videos (3+ clips), brand values through relatable stories, OR user explicitly requests brand storytelling
      - {"🎬 **THIS IS A STORY VIDEO ({} clips)** - MUST have characters and narrative arc!".format(CLIPS_PER_VIDEO) if CLIPS_PER_VIDEO >= 3 else "Can be abstract or character-driven"}
      - FLAGS TO OUTPUT:
        * "video_type": "brand_marketing"
        * "voiceover": false (legacy field - per-clip has_voiceover is now used)
        * "no_characters": {"false (STORY VIDEOS NEED CHARACTERS!)" if CLIPS_PER_VIDEO >= 3 else "true or false (your choice)"}
        * "human_characters_only": {"true (use relatable human characters for story)" if CLIPS_PER_VIDEO >= 3 else "false"}
        * "influencer_marketing": false
      
      {"🎭 **STORY VIDEO CHARACTER RULES** (3+ clips):".format(CLIPS_PER_VIDEO) if CLIPS_PER_VIDEO >= 3 else ""}
      {'''- MUST include relatable human characters experiencing a journey
      - Characters CAN speak directly to camera (UGC-style moments) in some clips
      - Characters CAN have voiceover narration in other clips  
      - Some clips can be pure visual (product reveal, sensory moments)
      - MIX techniques for maximum engagement - NOT all voiceover, NOT all character speaking
      - Create a STORY ARC: relatable problem → tension → discovery → satisfaction
      
      **CHARACTER-DRIVEN STORY EXAMPLE** (5 clips for food brand):
      
      Clip 1 [hook] - CHARACTER SPEAKS (no product):
      "South Asian man, 30s, in cozy American apartment, nostalgic expression, no text overlays. Saying in genuine relatable tone (14 words max): Missing home, you know that feeling when nothing tastes like mom's cooking?"
      
      Clip 2 [problem] - CHARACTER FRUSTRATION (no product):
      "Reference character scrolling food delivery apps with disappointed frown, kitchen background, no text overlays. Saying in frustrated tone (14 words max): I've tried everything here, but nothing hits the same, it's just not authentic."
      
      Clip 3 [escalation] - DISCOVERY MOMENT (no product yet):
      "Reference character eyes widening with excitement looking at phone, growing hope, no text overlays. Saying in excited building tone (14 words max): Wait, what is this? Everyone's talking about it, could this actually be real?"
      
      Clip 4 [reveal] - PRODUCT HERO SHOT (product mapping now!):
      "Reference product [Biryani] revealed with steam rising, dramatic food lighting, mouth-watering presentation, no text overlays." (pure visual - music carries this moment)
      
      Clip 5 [cta] - SATISFACTION + CALL (product visible):
      "Reference character taking bite with eyes closed in bliss, reference product visible, no text overlays. Saying in satisfied inviting tone (14 words max): This is it, this is home, you have to try this yourself."
      ''' if CLIPS_PER_VIDEO >= 3 else '''- Style: Artistic, emotional, brand-focused
      - Example clip WITH voiceover: 'Abstract flowing light patterns, dynamic camera, no text overlays. Voiceover in warm voice: Your journey starts here.'
      - Example clip WITHOUT voiceover: 'Abstract flowing light patterns, sweeping crane shot, dramatic lighting, no text overlays.' '''}
      
      - 🚨 VOICEOVER/SPEECH TEXT FORMATTING: NEVER use em-dashes (—) or hyphens (-). Use commas, periods instead.
   
   YOU MUST OUTPUT (at the top level):
   "video_type": "product_marketing" OR "ugc_influencer" OR "brand_marketing",
   "voiceover": false (LEGACY - per-clip has_voiceover field is now authoritative),
   "no_characters": true OR false,
   "human_characters_only": true OR false,
   "influencer_marketing": true OR false,
   "web3": false (always false for DVYB)
   
   **PER-CLIP VOICEOVER** (NEW - YOUR CREATIVE DECISION):
   For each clip, set "video_X_clip_Y_has_voiceover": true or false based on beat purpose and brand category.
   
   📋 MULTI-CLIP VIDEO STRUCTURE (Kling v2.6 / Veo3.1 with 9:16 aspect ratio):
   Video indices: {sorted(video_indices)}
   
   {"🎬 **FLEXIBLE CLIP COUNT - YOUR CREATIVE DECISION**:" if GROK_DECIDES_CLIP_COUNT else ""}
   {"→ You can generate between {} and {} clips based on what your story needs".format(MIN_CLIPS, MAX_CLIPS) if GROK_DECIDES_CLIP_COUNT else ""}
   {"→ Simple stories: 3-4 clips | Standard narratives: 5-6 clips | Epic tales: 7-8 clips" if GROK_DECIDES_CLIP_COUNT else ""}
   {"→ Each clip: 4s, 6s, or 8s (choose duration based on beat purpose)" if GROK_DECIDES_CLIP_COUNT else ""}
   {"→ FIRST output: 'total_clips': N (where N is your chosen clip count)" if GROK_DECIDES_CLIP_COUNT else ""}
   
   Each video requires:
   - {"YOUR CHOSEN NUMBER of" if GROK_DECIDES_CLIP_COUNT else str(CLIPS_PER_VIDEO)} image prompts (starting frames for each clip)
   - {"YOUR CHOSEN NUMBER of" if GROK_DECIDES_CLIP_COUNT else str(CLIPS_PER_VIDEO)} clip prompts (motion/animation descriptions)
   - {"YOUR CHOSEN NUMBER of" if GROK_DECIDES_CLIP_COUNT else str(CLIPS_PER_VIDEO)} logo decisions (true/false for each frame)
   - 1 audio prompt (background music for entire video)
   
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
     * 🚨 MUST start with SHOT TYPE: "MEDIUM SHOT, waist-up with headroom: Reference model..."
     * Example: "MEDIUM SHOT, waist-up with generous headroom above: Reference model sitting at table, looking at camera with genuine excitement, full head visible"
     * Example: "THREE-QUARTER SHOT with complete head in frame: Reference model holding product and speaking naturally to camera, ample space above head"
     * DO NOT describe new character details - just use "reference model" to refer to the person from the uploaded image
     * This ensures the same person appears consistently across all frames
   
  - If no model image provided (has_model_image=false - AUTONOMOUS DIVERSE CHARACTER GENERATION):
    * **🎨 IMPORTANT**: Create diverse, authentic influencer characters representing different ethnicities, genders, ages, and styles
    * Consider the brand's target audience and product category when designing the character
    * 🚨 MUST start EVERY prompt with SHOT TYPE: "MEDIUM SHOT, waist-up with headroom: ..."
    * Clip 1 image prompt: SHOT TYPE + FULL character description (MUST specify: ethnicity, age range, gender, style, appearance, clothing, body type)
      → Example 1: "MEDIUM SHOT, waist-up with generous headroom above: South Asian woman, mid-20s, long dark hair, casual modern style, denim jacket over white tee, confident smile, face fully visible, modern apartment background"
      → Example 2: "THREE-QUARTER SHOT with complete head in frame: African American man, early 30s, athletic build, streetwear outfit, friendly approachable demeanor, full head visible with space above, urban loft setting"
      → Example 3: "MEDIUM SHOT with ample headroom: East Asian woman, late 20s, minimalist fashion, professional blazer, calm thoughtful expression, face visible, clean modern office"
    * Clip 2+ image prompts: SHOT TYPE + **"Reference character from previous frame"** + new context/action or setting
      → Example: "MEDIUM SHOT, waist-up with headroom: Reference character from previous frame, now in elegant living room, demonstrating product use, full head visible"
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
  - **AI ARTIFACT PREVENTION**: End prompt with quality details (3-5 SPECIFIC points): product name, hand anatomy if visible, environment specifics - naturally written, no brackets
  - Remember: These frames will become video starting points, so they must be high-quality and on-brand
  
  🎬 **CLIP MOTION PROMPTS** (Video Animation - CINEMATIC QUALITY):
  - Apply CINEMATIC TECHNIQUES from section 4 to ALL clip prompts
  - Think like a DIRECTOR: describe HOW the camera moves, not just what's in frame
  - **Camera Movement**: "camera orbits", "tracking shot", "dolly push", "crane descent", "pan across", "tilt reveal", "zoom in/out", "handheld follow"
  - **Speed Effects**: "slow motion", "timelapse", "speed ramp from slow to normal"
  - **Focus Techniques**: "rack focus from foreground to product", "pull focus following action"
  - **Reveal Techniques**: "reveal shot as hand moves away", "push through foreground element"
  
  **CLIP PROMPT CINEMATIC EXAMPLES**:
  - ❌ Basic: "Product on table, camera shows it"
  - ✅ Cinematic: "Camera orbits product 180 degrees revealing texture details, soft rack focus from blurred foreground to sharp product surface, dramatic rim lighting with subtle lens flare"
  
  - ❌ Basic: "Person picks up product"
  - ✅ Cinematic: "Tracking shot following hand reaching toward product, camera pushes in as fingers make contact, rack focus shifting to product, shallow depth of field with background melting into bokeh"
  
  - ❌ Basic: "Show product features"
  - ✅ Cinematic: "Camera slowly orbits product 90 degrees revealing different angles, dramatic side lighting casting long shadows, dust particles visible in light beam, speed ramp to normal as orbit completes"
  
  **AUTONOMOUS CINEMATIC DECISIONS**: You decide when cinematic elements enhance the clip. Product reveals, emotional moments, and brand storytelling often benefit from cinematic techniques. UGC may use subtle handheld movement for authenticity. YOU choose what serves the content best.
  
  🎬 **CINEMATIC CLIP PROMPT INSPIRATION** (FOR PRODUCT & BRAND MARKETING VIDEOS):
  
  These examples are STARTING POINTS to spark your creativity - NOT limitations. Go beyond them, invent new techniques, surprise us:
  
  ⚡ **VARY YOUR TECHNIQUES**: Each video should feel fresh and unique. Mix different approaches - don't rely on the same technique repeatedly. Combine camera movements with lighting effects, blend speed variations with focus techniques. The best content surprises viewers with creative variety.
  
  **SPEED & TIMING TECHNIQUES** (choose what fits the mood):
  - "Real-time product rotation with natural momentum, authentic movement feel"
  - "Timelapse of environment changing around stationary product, day to night transition"
  - "Speed ramp: normal speed approach, then slowing at the key reveal moment"
  - "Quick cuts between different angles, dynamic energy and modern pacing"
  - "Slow motion pour of liquid catching every ripple and reflection"
  - "Freeze frame at peak action moment, then resume motion"
  
  **DRAMATIC CAMERA MOVEMENTS**:
  - "Sweeping crane shot descending from above, gradually revealing product in dramatic spotlight"
  - "Dolly zoom creating vertigo effect while product stays centered, background warping cinematically"
  - "360-degree orbit around product, seamless rotation revealing all angles, consistent dramatic lighting"
  - "Push-in through smoke/mist revealing product emerging like a hero shot"
  - "Pull-back reveal starting from extreme macro texture to full product in context"
  - "Handheld tracking shot following product in motion, documentary realism"
  - "Steadicam glide circling the scene, smooth cinematic flow"
  
  **CINEMATIC LIGHTING EFFECTS**:
  - "Product bathed in moving light beams, shadows dancing across surface, film noir atmosphere"
  - "Golden hour rays streaming through, lens flare kissing product edge, warm cinematic grade"
  - "Dramatic chiaroscuro lighting, half product in shadow half in brilliant highlight"
  - "Pulsing neon reflections on product surface, cyberpunk aesthetic, moody atmosphere"
  - "Soft diffused light slowly intensifying to dramatic spotlight reveal"
  - "Practical lighting from within the scene, authentic ambient glow"
  
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
  - "Split-screen comparison showing product in different contexts simultaneously"
  
  **UNLIMITED CREATIVITY**: These examples are just INSPIRATION - not limitations. You have COMPLETE creative freedom to invent entirely new cinematic techniques, combine approaches in unexpected ways, or create something we haven't even imagined. The best clip prompts often go far beyond these examples. Trust your creative instincts. Pure visual storytelling with no boundaries.
  
  🎬 **VIDEO CLIP QUALITY ASSURANCE** (MANDATORY - DYNAMIC PER CLIP):
  
  Video generation models produce artifacts. You MUST generate CONTEXT-SPECIFIC quality assurance for EACH clip based on what's actually in that clip. DO NOT copy-paste the same QA text - analyze your clip prompt and image prompt to determine what needs protection.
  
  **🎯 DYNAMIC QA GENERATION PROCESS** (for each clip):
  
  1. **ANALYZE your clip prompt**: What elements are present?
     - Humans? → Which body parts visible? Hands? Face? Full body?
     - Products? → What product specifically? What angle/view?
     - Interactions? → Hands touching objects? Pouring? Applying?
     - Environment? → Background elements that could morph?
  
  2. **ANALYZE the associated image prompt**: What was in the starting frame?
     - Character details from image prompt
     - Product details from image prompt
     - Setting/environment specifics
  
  3. **GENERATE SPECIFIC QA** based on YOUR analysis:
  
  **IF HANDS ARE VISIBLE** (holding, touching, gesturing):
  → Write QA specific to THAT hand action:
  - Holding bottle: "right hand gripping [product name] bottle with five fingers, thumb wrapped around neck, no finger clipping through glass"
  - Applying makeup: "hand holding [product] with natural grip, five fingers visible, index finger applying product, no digit duplication"
  - Gesturing: "both hands with five fingers each, natural gesturing motion, no extra digits appearing"
  
  **IF FACE IS VISIBLE**:
  → Write QA specific to THAT character:
  - "consistent face of [character description from image prompt], two symmetrical eyes, natural expressions, no facial morphing"
  - Include character-specific details: skin tone, hair, features that should stay consistent
  
  **IF FULL/PARTIAL BODY VISIBLE**:
  → Write QA specific to THAT body view:
  - Full body: "complete figure with two arms, two legs, natural proportions, [clothing from image prompt] stays consistent"
  - Waist-up: "stable torso, two arms visible, consistent [outfit details], no limb stretching"
  
  **IF PRODUCT IS FEATURED**:
  → Write QA specific to THAT product:
  - "[Actual product name] maintains exact shape throughout, [specific features like logo/texture/color] stay stable"
  - "single [product] with consistent [distinguishing features], no duplication"
  
  **🚨 EACH CLIP'S QA MUST BE UNIQUE** - based on that specific clip's content!
  
  **DYNAMIC QA EXAMPLES** (notice how each is specific to its scene):
  
  Scene: Person picking up coffee cup (from image prompt: "30-year-old woman, blonde hair, white blouse")
  → "Camera follows blonde woman picking up coffee cup, warm café lighting, hand gripping ceramic cup with five fingers and thumb, consistent blonde hair and white blouse throughout motion, facial features stable, cup maintains same size, no text overlays"
  
  Scene: Hand spraying perfume (from image prompt: "Midnight Bloom perfume bottle, gold cap")
  → "Close-up of hand spraying Midnight Bloom perfume, five fingers gripping black bottle, thumb on gold cap spray mechanism, single spray nozzle, mist direction consistent, product shape stable throughout spray action, no text overlays"
  
  Scene: Product rotating (from image prompt: "wireless headphones, silver, LED strip")
  → "Wireless headphones rotating on display, silver finish maintains consistent color, LED strip stays in same position relative to ear cup, no shape warping during rotation, product size stable, no text overlays"
  
  Scene: Influencer speaking (from image prompt: "South Asian man, beard, denim jacket")
  → "Reference character speaking to camera, beard shape consistent, denim jacket texture stable, natural lip movement matching speech, five fingers on each hand when gesturing, no facial distortion during expressions, no text overlays. Saying: [speech]"
  
  **🚨 NEVER USE GENERIC QA**: Do NOT write "anatomically correct human" - instead write "consistent [specific character details from your image prompt]"
  
  🛍️ **PRODUCT MAPPING RULES - IMAGE POSTS vs VIDEO POSTS** (CRITICAL DIFFERENCE):
  
  🚨🚨🚨 **IMAGE POSTS vs VIDEO POSTS - DIFFERENT RULES!** 🚨🚨🚨
  
  **📸 IMAGE POSTS (Static images at indices {sorted(image_only_indices)}):**
  - ✅ **ALWAYS** map product to ALL image posts
  - ✅ Set `image_X_product_mapping: "image_1"` (or image_2, etc.) for EVERY image
  - ✅ Product is the STAR of image posts - no storytelling needed
  - ✅ Use "Reference product" at START of every image prompt
  - ❌ NEVER set product_mapping to null for image posts when products exist
  
  **🎬 VIDEO POSTS (Story videos at indices {sorted(video_indices)}):**
  - ⚠️ **FOLLOW THE STORYTELLING FRAMEWORK** for product placement
  - ❌ Do NOT show product in early beats (hook, problem, escalation)
  - ✅ ONLY show product in later beats (transition, reveal, payoff, CTA)
  - 📖 The story builds TENSION before the product REVEAL
  
  **WHY DIFFERENT RULES?**
  - Image posts = Product showcase (immediate impact)
  - Video posts = Storytelling (build anticipation → reveal → satisfaction)
  - Early product in video = BORING (no story arc)
  - Late product reveal = ENGAGING (tension → payoff)
  
  🚨🚨🚨 **PRODUCT PLACEMENT TIMING FOR VIDEO CLIPS** (MANDATORY):
  
  **DO NOT show product in these beats** (set product_mapping to null):
  - ❌ Hook (beat 1) → Focus on CHARACTER/SITUATION, NOT product
  - ❌ Problem (beat 2) → Show the PAIN POINT, NOT the solution
  - ❌ Escalation (beat 3) → Build TENSION, product not revealed yet
  
  **SHOW product ONLY in these beats** (set product_mapping to image):
  - ✅ Transition (beat 4) → Can START to hint at solution
  - ✅ Reveal (beat 5) → HERO MOMENT - product revealed as solution
  - ✅ Payoff (beat 6) → Product in use, satisfaction
  - ✅ CTA (beat 7) → Product with call-to-action
  
  **WHY THIS MATTERS**:
  - Showing product too early KILLS the story arc
  - Viewers need TENSION before RELEASE
  - The reveal moment creates IMPACT
  
  **EXAMPLES FOR STORY VIDEO** (5 clips):
  ```
  Beat 1 - Intrigue/Hook (NO PRODUCT):
  {{
    "video_0_clip_1_beat": "hook",
    "video_0_clip_1_product_mapping": null,
    "video_0_clip_1_image_prompt": "Character looking frustrated/curious/intrigued, relatable situation, NO product visible...",
    "video_0_clip_1_prompt": "Character speaking to camera with relatable expression... Saying in genuine tone (14 words max): Have you ever felt like [relatable problem]..."
  }}
  
  Beat 2 - Problem/Showcase (NO PRODUCT for story, or product showcase for 3-beat):
  {{
    "video_0_clip_2_beat": "problem",
    "video_0_clip_2_product_mapping": null,
    "video_0_clip_2_image_prompt": "Character experiencing the problem, emotional tension building...",
    "video_0_clip_2_prompt": "Character's frustrated reaction, camera captures emotion..."
  }}
  
  Beat 4 - Reveal (PRODUCT APPEARS!):
  {{
    "video_0_clip_4_beat": "reveal",
    "video_0_clip_4_product_mapping": "image_1",
    "video_0_clip_4_image_prompt": "Reference product [name] revealed as hero shot, dramatic presentation...",
    "video_0_clip_4_prompt": "Camera reveals product with satisfying cinematography, triumphant moment..."
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
  
  - If video_type = "ugc_influencer" (SHORT videos only, 1-2 clips):
    * Clip prompts MUST include: "Character saying (14 words max): [natural speech]"
    * Speech embedded in Veo3.1 clip (character's lips move)
    * Example: "saying (14 words max): This lipstick changed everything about my makeup routine and I absolutely love it"
    * 🏢 **USE BRAND NAME IN SPEECH**: In the character's speech, use "{dvyb_context.get('accountName', 'the brand')}" when mentioning the brand
    * Example: "saying in excited tone: I've been using {dvyb_context.get('accountName', 'the brand')} and it's a game changer"
  
  - If video_type = "brand_marketing" (REQUIRED for story videos with 3+ clips):
    
    🎬 **YOU HAVE FULL CREATIVE AUTONOMY** - Make this video SCROLL-STOPPING and ENGAGING!
    
    **MIX TECHNIQUES FREELY ACROSS CLIPS** - Your goal is maximum engagement:
    * **CHARACTER SPEAKING (UGC-style moments)**: Add "Saying in [tone] (14 words max): [speech]"
      → Great for: hooks, relatable moments, CTAs, building connection
      → Character's lips move, feels authentic and personal
    * **VOICEOVER NARRATION**: Set `has_voiceover=true`, add "Voiceover in [voice style]: [narration]" at END
      → Great for: explaining value, storytelling transitions, emotional builds
      → Professional voice over the visuals
    * **PURE VISUAL WITH MUSIC**: No speech, no voiceover - music and visuals tell the story
      → Great for: product reveals, sensory moments, beat drops, emotional payoffs
    
    🎯 **CREATIVE GUIDANCE** (not rules - use your judgment):
    | Beat | Consider | Why |
    | Hook | Character speaking to camera | Grabs attention, feels like talking to viewer |
    | Problem | Character expression OR voiceover | Relatability OR narrative |
    | Escalation | Music building OR voiceover | Tension through sound OR story |
    | Reveal | Pure visual with triumphant music | Let the product/moment shine |
    | Payoff | Character reacting OR voiceover | Emotional connection OR narration |
    | CTA | Character speaking directly | Personal invitation to act |
    
    🔥 **GOAL**: Create a video that mixes authentic UGC moments with cinematic storytelling.
    Not every clip needs speech. Not every clip needs voiceover. Find the perfect rhythm.
    
    🏢 **USE BRAND NAME**: "{dvyb_context.get('accountName', 'the brand')}" in speech OR voiceover
  
  - If video_type = "product_marketing" (product showcases):
    * Focus on PRODUCT as hero
    * Typically uses voiceover narration (set has_voiceover=true for clips needing narration)
    * Some clips can be pure visual with music (product glory shots)
    * 🏢 **USE BRAND NAME IN VOICEOVER**: "{dvyb_context.get('accountName', 'the brand')}"
   
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
   
   🚨 **PROMPT LENGTH LIMIT (MANDATORY)**: 
   - Each IMAGE prompt MUST be UNDER 4000 characters (hard limit is 5000)
   - Each CLIP prompt MUST be UNDER 4000 characters (hard limit is 5000)
   - Be CONCISE and capture the ESSENCE, not every micro-detail
   - Focus on KEY visual elements that define the look and feel
   - DO NOT list every single object, accessory, or background element
   - Summarize inspiration into core mood, lighting, composition, and style
   
   🚨🚨🚨 **CLIP PROMPT QUALITY ASSURANCE - FINAL REMINDER** 🚨🚨🚨
   
   EVERY clip prompt MUST include DYNAMIC, CONTEXT-SPECIFIC quality assurance text BEFORE "no text overlays".
   
   **DO NOT USE GENERIC QA** - generate QA specific to each clip's content!
   
   **ANALYZE BEFORE WRITING QA**:
   1. What's in your IMAGE PROMPT for this clip? (character details, product name, setting)
   2. What ACTION happens in your CLIP PROMPT? (hands touching, product rotating, person speaking)
   3. Write QA that protects THOSE SPECIFIC elements from artifacts
   
   **EXAMPLE CLIP PROMPT STRUCTURE**:
   "[Scene], [camera], [lighting], [SPECIFIC QA for this clip's elements], no text overlays. [Voiceover if applicable]"
   
   ❌ GENERIC (BAD): "Camera orbits product, dramatic lighting, product maintains shape, no text overlays"
   ✅ SPECIFIC (GOOD): "Camera orbits Midnight Bloom perfume, dramatic lighting, black bottle maintains exact shape, gold cap position stable, label text legible throughout rotation, no text overlays"
   
   ❌ GENERIC (BAD): "Person picks up cup, hands have five fingers, no text overlays"  
   ✅ SPECIFIC (GOOD): "Blonde woman in white blouse picks up coffee cup, right hand gripping ceramic handle with five fingers, consistent blonde hair and facial features, cup size stable, no text overlays"
   
   EACH CLIP'S QA MUST BE UNIQUE based on its specific content!
   
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
   
   🎥 **Camera Movement** (brings scenes to life - vary your choices):
   - "camera slowly orbits around product 90 degrees"
   - "tracking shot following hand as it reaches for product"
   - "crane descent from overhead revealing scene"
   - "dolly glide past product showcasing depth"
   - "pan across multiple products in elegant sweep"
   - "tilt up from product detail to full view"
   - "crane shot descending from above to eye level"
   - "subtle handheld movement for organic, authentic feel"
   
   🎥 **Speed & Timing** (creates emotional impact):
   - "real-time capture of bite, showing authentic texture and reaction"
   - "timelapse of condensation forming on cold surface"
   - "speed ramp: building momentum, then slowing at key reveal"
   - "real-time pour with liquid dynamics visible"
   - "quick cuts between angles for dynamic energy"
   - "freeze frame at peak moment, then resume"
   
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
   
   **WHEN TO USE** (your judgment - vary techniques for each piece):
   - Product reveals → orbit rotations, dramatic lighting, reveal shots, crane descents
   - Food/beverage → macro texture, splash dynamics, steam rising, appetizing angles
   - Fashion/beauty → fabric movement, artistic lighting, mirror shots, confident poses
   - UGC/lifestyle → handheld feel, natural movement, authentic moments
   - Brand storytelling → cinematic transitions, timelapse, dramatic compositions
   
   **EXAMPLE TRANSFORMATIONS**:
   
   ❌ Basic: "popsicle on wooden table with berries"
   ✅ Cinematic: "popsicle with dramatic rim lighting creating golden edge glow, single droplet of melt frozen mid-fall, shot through blurred foreground berry with rack focus to sharp product, shallow depth of field with warm bokeh"
   
   ❌ Basic: "person holding product and smiling"
   ✅ Cinematic: "tracking shot following hand as it brings product into frame, genuine smile captured in warm golden hour backlight creating hair glow and subtle lens flare, rack focus from face to product, shallow depth of field with background melting into creamy bokeh"
   
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
  
  🚫 **INTELLIGENT ARTIFACT PREVENTION** (DYNAMIC per prompt):
  Generate UNIQUE prevention text for EACH prompt based on its SPECIFIC elements:
  
  - Use the ACTUAL product name from inventory (not generic "product")
  - Describe SPECIFIC hand positions for THAT action
  - Mention SPECIFIC environment elements from YOUR prompt
  - Each prompt's prevention MUST be DIFFERENT
  
  🚨 **MANDATORY WHEN HUMANS/HANDS APPEAR** (ALWAYS include these phrases):
  - Hands visible: "each hand has exactly five fingers with one thumb, natural finger proportions, no extra digits, no fused fingers"
  - Two hands: "two distinct hands - left and right clearly differentiated"
  - Body visible: "anatomically correct human, two arms, two legs, natural proportions, no extra limbs"
  - Face visible: "symmetrical natural face, two eyes, natural skin texture, full head visible with headroom"
  
  Format: End your prompt with quality assurance phrases naturally written (no brackets, no special keywords).
  
  Example WITH humans - end prompt with:
  "...single Sweater with consistent pattern, each hand has exactly five fingers with one thumb, anatomically correct body with two arms, natural proportions, full head visible with headroom, coherent skyline background"
  
  Example NO humans - end prompt with:
  "...single Watch on marble surface, symmetrical watch face, consistent strap texture, no duplicate products, natural marble veining"
   
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
    # Image-only posts (not videos) - already calculated above
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
  {"'total_clips': 3 or 4 or 5 (YOUR DECISION - how many clips does your story need? Min: {}, Max: {}),".format(MIN_CLIPS, MAX_CLIPS) if GROK_DECIDES_CLIP_COUNT else ""}
  "voiceover": false (LEGACY - per-clip has_voiceover is now used),
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

    # Determine persona based on flow type OR if product images were detected
    is_product_shot_flow = context.get("is_product_shot_flow", False)
    use_photographer_persona = context.get("use_photographer_persona", False)
    
    # Use photographer persona if either:
    # 1. User explicitly came through product shot flow (Flow 2), OR
    # 2. Product images were detected in inventory analysis
    if is_product_shot_flow or use_photographer_persona:
        if use_photographer_persona and not is_product_shot_flow:
            print(f"📸 Using PHOTOGRAPHER persona (product images detected in inventory analysis)")
        else:
            print(f"📸 Using PHOTOGRAPHER persona (product shot flow)")
        # FLOW 2: Product Photography Specialist persona
        persona_intro = f"""You are a WORLD-CLASS PRODUCT PHOTOGRAPHER and COMMERCIAL VISUAL SPECIALIST.
You create stunning, high-end product imagery and video clips that rival top advertising agencies.
You respond ONLY with valid JSON objects, no extra text or formatting.

Generate {number_of_posts} pieces of PREMIUM PRODUCT PHOTOGRAPHY content for: "{request.topic}"

🎯🎯🎯 **USER INSTRUCTIONS ARE TOP PRIORITY** 🎯🎯🎯

**BEFORE generating ANY content, CHECK user instructions:**
USER INSTRUCTIONS: {request.user_prompt if request.user_prompt and request.user_prompt.strip() else '(No specific instructions)'}

**IF user has provided specific instructions:**
- FOLLOW them EXACTLY - they override all default behaviors
- Examples of user instruction types to honor:
  * "Show product on a beach" → Generate beach setting shots
  * "Use models wearing the product" → Include models in shots
  * "Focus on product details only" → No models, just closeups
  * "Create lifestyle shots" → Lifestyle context with people
  * "Make it minimal and clean" → Minimalist aesthetic
  * "Show product in use" → Demonstrate usage with hands/models
- User knows their brand best - their vision takes precedence

**IF no specific instructions provided:**
- Use your expertise to decide the best approach
- Apply the variety and autonomous decision rules below

🚨🚨🚨 CRITICAL - AUTONOMOUS PRODUCT DISPLAY DECISION + VARIETY 🚨🚨🚨

You MUST intelligently decide HOW to display the product AND create VARIETY across outputs.

⚠️ **MANDATORY VARIETY RULE**: 
{f'''
🚨 **WHEN INSPIRATIONS ARE PROVIDED** ({num_inspirations} inspiration(s)):
- The 50-50 split rule does NOT apply - follow the inspirations instead
- Each image must follow its corresponding inspiration's aesthetic
- If an inspiration shows a model, that image should include a model
- If an inspiration shows product-only, that image should be product-only
- Do NOT force a 50-50 split - let each inspiration guide its image's composition
- The variety comes from following different inspirations, not from forcing a model/product-only split
- Cover ALL provided inspirations - every inspiration must be used
''' if has_image_inspiration else '''**ONLY APPLY WHEN NO INSPIRATIONS PROVIDED**:
- Do NOT put human models in ALL images. Mix it up!
- For 4 images: aim for 2 with models, 2 product-only (closeups, flat-lays, studio shots)
- For 2 images: 1 with model, 1 product-only
- Product-only shots are ESSENTIAL for showcasing details, textures, craftsmanship
'''}

**SHOT TYPE MIX** (Apply to ALL product categories):
1. **HERO/CLOSEUP SHOTS** (NO humans): Dramatic product-only shots highlighting design, texture, materials
2. **DETAIL/MACRO SHOTS** (NO humans): Extreme closeups showing craftsmanship, stitching, buttons, logos
3. **FLAT-LAY/STYLED SHOTS** (NO humans): Product on beautiful surfaces with complementary props
4. **LIFESTYLE SHOTS** (WITH humans): Models wearing/using the product in context

**WEARABLE PRODUCTS** (clothing, sweaters, dresses, jackets, shoes, jewelry, watches, accessories, hats, scarves, bags):
{f'''
→ **WHEN INSPIRATIONS PROVIDED**: Follow each inspiration's composition (model or product-only) - do NOT force 50-50 split
→ **WHEN NO INSPIRATIONS**: MIX of model shots AND product-only shots:
  - 50% WITH models wearing/displaying (face visible, varied moods)
  - 50% PRODUCT-ONLY: flat-lays, hanging shots, closeups on fabric/details, artistic arrangements
''' if has_image_inspiration else '''→ MIX of model shots AND product-only shots:
  - 50% WITH models wearing/displaying (face visible, varied moods)
  - 50% PRODUCT-ONLY: flat-lays, hanging shots, closeups on fabric/details, artistic arrangements
'''}
→ For model shots: face visible, varied ethnicities, moods, settings
→ For product-only: dramatic lighting, texture details, premium surfaces
→ Examples WITH model:
  - "Reference product (floral sweater) worn by confident 25-year-old Black woman, face visible with warm smile, urban street setting"
→ Examples PRODUCT-ONLY (equally important!):
  - "Reference product (floral sweater) laid flat on warm wooden surface, soft natural light, visible texture details, cozy blanket and coffee cup nearby"
  - "Reference product (watch) extreme closeup on dial and hands, dramatic rim lighting, brushed metal surface, luxury aesthetic"
  - "Reference product (sneakers) artistic arrangement on concrete steps, urban setting, dramatic shadows, no people"

**CONSUMABLE/DTC PRODUCTS** (skincare, cosmetics, food, beverages, supplements, perfumes, candles):
{f'''
→ **WHEN INSPIRATIONS PROVIDED**: Follow each inspiration's composition (model/hands or product-only) - do NOT force 60/40 split
→ **WHEN NO INSPIRATIONS**: MIX of product-only hero shots AND lifestyle shots:
  - 60% PRODUCT-ONLY: flat-lays, bottle closeups, texture shots, ingredient showcases
  - 40% WITH hands/models: application moments, usage demonstrations
''' if has_image_inspiration else '''→ MIX of product-only hero shots AND lifestyle shots:
  - 60% PRODUCT-ONLY: flat-lays, bottle closeups, texture shots, ingredient showcases
  - 40% WITH hands/models: application moments, usage demonstrations
'''}
→ Product-only examples:
  - "Reference product (serum bottle) hero shot on marble surface, golden liquid visible through glass, soft diffused light"
  - "Reference product (perfume) floating with dramatic rim lighting, mist particles visible, black velvet background"
→ Lifestyle examples (when showing usage, detail the EXACT realistic action):
  - Perfumes: spraying on wrist/neck (pulse points), NOT on random objects
  - Serums: dropper dispensing onto fingertips/palm
  - Creams: being gently applied/patted onto skin

**TECH/GADGETS** (electronics, devices, gadgets, tools, equipment):
{f'''
→ **WHEN INSPIRATIONS PROVIDED**: Follow each inspiration's composition (model/hands or product-only) - do NOT force 70/30 split
→ **WHEN NO INSPIRATIONS**: Primarily PRODUCT-ONLY shots (70%):
  - Clean studio hero shots with dramatic lighting
  - Detail shots of craftsmanship/materials
  - Floating/levitation effects
→ Some lifestyle shots (30%): product in use context
''' if has_image_inspiration else '''→ Primarily PRODUCT-ONLY shots (70%):
  - Clean studio hero shots with dramatic lighting
  - Detail shots of craftsmanship/materials
  - Floating/levitation effects
→ Some lifestyle shots (30%): product in use context
'''}
→ Example: "Reference product (wireless earbuds) floating above brushed metal surface, dramatic rim lighting, reflective case open below, tech-noir aesthetic"

**HOME/DECOR** (furniture, home goods, art, plants):
→ Primarily PRODUCT-ONLY styled shots (80%):
  - Styled room/environment shots
  - Detail texture close-ups
→ Occasional lifestyle context with people (20%)

🎯 YOUR EXPERTISE - PROFESSIONAL PRODUCT PHOTOGRAPHY:

**ENVIRONMENT MASTERY** (Vary across outputs):
- **Studio Setups**: Clean infinity cove, marble surfaces, velvet backdrops, textured stone, brushed metal
- **Lifestyle Contexts**: Sunset terraces with warm golden light, misty forest floors, urban rooftops at dusk, cozy cafes, city streets
- **Fashion Locations**: Urban streets, rooftop parties, beach boardwalks, boutique interiors, art galleries
- **Atmospheric Elements**: Dust particles in light beams, water droplets, rising steam, floating petals, wind in hair/fabric

**LIGHTING TECHNIQUES** (Be specific in prompts):
- **Rim Lighting**: "dramatic rim light creating glowing edge silhouette"
- **Golden Hour**: "warm sunset light casting long shadows, orange and amber tones"
- **Studio Softbox**: "soft diffused light from left, subtle fill from right, no harsh shadows"
- **Dramatic Moody**: "single spotlight from above, deep shadows, noir aesthetic"
- **Natural Daylight**: "soft overcast natural light, flattering skin tones, no harsh shadows"

**CAMERA ANGLES & MOVEMENTS** (Vary these):
- **Full Body Fashion**: "full body shot showing complete outfit, model mid-stride, confident posture"
- **3/4 Portrait**: "three-quarter angle capturing model and product, environmental context visible"
- **Hero Shots**: "low angle looking up at product/model, making them appear powerful and premium"
- **Macro Details**: "extreme close-up on texture/material, shallow depth of field"
- **Lifestyle Candid**: "natural candid moment, model interacting with product authentically"

🚨🚨🚨 **FRAMING RULES FOR MODEL SHOTS** (ABSOLUTELY CRITICAL - #1 PRIORITY) 🚨🚨🚨

⚠️ **SHOT TYPE MUST BE FIRST WORDS OF EVERY MODEL PROMPT** - This is the MOST important rule!

**MANDATORY PROMPT STRUCTURE for prompts with humans:**
START every prompt with shot type: "MEDIUM SHOT, waist-up with headroom: ..." or "FULL BODY SHOT: ..."

**REQUIRED SHOT TYPES** (choose one and put it FIRST):
- "MEDIUM SHOT, waist-up with generous headroom above: [rest of prompt]"
- "FULL BODY SHOT from head to toe: [rest of prompt]"  
- "THREE-QUARTER SHOT with complete head in frame: [rest of prompt]"

**FRAMING RULES**:
- **NEVER crop the top of the head** - always leave 15-20% space above the model's head
- **Camera MUST step back** - do NOT zoom in close to faces
- **Head + hair MUST be fully visible** - no hairline cropping, no forehead cut off
- **Safe zone**: Imagine a box around the model - their ENTIRE head must be well inside the frame

**EXAMPLE PROMPT STRUCTURE** (notice shot type comes FIRST):
✅ "MEDIUM SHOT, waist-up with generous headroom above: Reference product (baseball cap) worn by 28-year-old South Asian man, athletic build, face visible with confident smile, neutral beige background..."
✅ "FULL BODY SHOT from head to toe: Model wearing reference product (sweater), standing in urban setting, complete figure in frame with space above head..."

❌ **WRONG** (shot type buried or missing): "Reference product worn by 25-year-old woman, face visible..." (NO shot type = will crop head!)

**EXAMPLES of BAD framing to AVOID**:
- Close-up shots where forehead/hairline is cropped
- Top of head cut off by frame edge  
- Extreme close-up cutting off any part of head
- Tight chest-up shots without headroom

**MODEL SPECIFICATIONS** (REQUIRED for wearables - be diverse):
- 🚨 FIRST: Always start with SHOT TYPE (e.g., "MEDIUM SHOT, waist-up with headroom:")
- THEN specify: ethnicity, age range, gender, body type, hair, style vibe, expression, pose
- 🚨 MANDATORY: Always include "face visible" and describe facial expression (smile, confident gaze, etc.)
- 🚨 NEVER: No cropped heads, no back-of-head shots, no obscured faces, no looking away from camera entirely
- Vary across outputs: different ethnicities, ages, styles, moods
- Examples (note SHOT TYPE comes FIRST, then face/expression details):
  → "MEDIUM SHOT, waist-up with generous headroom above: 25-year-old Black woman, natural curly hair, athletic build, face visible with confident smile looking at camera, urban streetwear styling"
  → "FULL BODY SHOT from head to toe: 30-year-old East Asian man, minimalist fashion, face visible with relaxed chill expression, slight smile, hands in pockets, complete figure in frame"
  → "THREE-QUARTER SHOT with complete head visible: 22-year-old Latina woman, long wavy hair, face visible with playful laugh, head tilted, spinning with fabric flowing"
  → "MEDIUM SHOT with ample headroom: 35-year-old South Asian woman, elegant professional look, face visible with serene confident gaze, subtle smile"

**FOR WEARABLES - MOOD VARIATIONS** (use different moods, FACE ALWAYS VISIBLE):
- **Swagger/Confidence**: Bold poses, face visible with direct eye contact at camera, power stance
- **Chill/Relaxed**: Casual lean, face visible with natural genuine smile, comfortable body language
- **Elegant/Sophisticated**: Refined posture, face visible with subtle confident expression, upscale setting
- **Playful/Energetic**: Movement, face visible with joyful laughter, dynamic action but face still clear
- **Editorial/High Fashion**: Dramatic poses, face visible with intense captivating gaze, artistic composition

🎨 **INSPIRATION IMAGES FROM INVENTORY** (CRITICAL - USE IF PROVIDED):
If the inventory analysis contains `inspiration_images` with count > 0, you MUST incorporate their aesthetic:

**HOW TO USE INSPIRATION IMAGES**:
1. **READ the inspiration analysis carefully** - note the style, colors, mood, composition, lighting
2. **APPLY the aesthetic** to your product photography prompts:
   - Match the color palette (warm tones, cool tones, vibrant, muted)
   - Match the lighting style (soft natural, dramatic moody, golden hour, studio)
   - Match the composition approach (minimalist, layered, symmetrical, dynamic)
   - Match the mood/atmosphere (luxury, casual, editorial, cozy)
3. **DO NOT just copy** - blend the inspiration's aesthetic with professional product photography
4. **EXPLICIT INTEGRATION**: In your prompts, describe elements FROM the inspiration:
   - "warm golden lighting matching inspiration's sunset aesthetic"
   - "minimalist composition with clean negative space as seen in reference"
   - "muted earth tone color palette inspired by uploaded style reference"

**EXAMPLE USAGE**:
If inspiration shows: "bohemian outdoor setting, warm golden hour, earthy tones, natural textures, layered fabrics"
→ Your prompt: "Reference product (floral sweater) worn by model on outdoor patio with woven rattan furniture, warm golden hour sunlight streaming through, earthy terracotta pots with dried pampas grass, layered textiles in muted earth tones, bohemian luxe aesthetic inspired by reference styling"

🚨 **DON'T IGNORE INSPIRATION**: If inspiration images are provided, they represent the user's desired visual direction. Your outputs should REFLECT that aesthetic!

🔗 **LINK INSPIRATION ANALYSIS** (From YouTube, Instagram, Twitter URLs - IF PROVIDED):
If `INSPIRATION LINKS ANALYSIS` or `VIDEO INSPIRATION ANALYSIS` or `IMAGE INSPIRATION ANALYSIS` is provided below, you MUST incorporate that aesthetic:

**FOR VIDEO INSPIRATION** (from reels/shorts):
- Study the storyline, hook, creative elements, visual techniques
- Apply similar pacing, camera movements, transitions to your clip prompts
- Match the mood/atmosphere and product showcase style
- Use the visual subjects (humans, objects, settings) as reference for your shots

**FOR IMAGE INSPIRATION** (from social media image posts):
- Study the visual aesthetics: color palette, lighting style, mood
- Match the composition: shot type, camera angle, framing techniques
- If humans present: replicate similar poses, visibility, positioning
- Apply the same styling aesthetics and technical approach
- Match the setting/environment type

**EXAMPLE - Applying Image Inspiration to Product Shot**:
If inspiration shows: "warm golden lighting, shallow depth of field, medium shot, model in relaxed pose, earth tone color palette, cozy cafe setting"
→ Your product shot prompt: "Reference product (floral sweater) worn by relaxed model in cozy cafe setting, warm golden ambient lighting from window, medium shot with shallow depth of field, earth tone color palette, model in natural relaxed seated pose, face visible with gentle smile, soft bokeh background"

🎯 REALISTIC PRODUCT USAGE (CRITICAL - Use world knowledge):

When showing product in use, ALWAYS detail the NATURAL, REALISTIC way the product would be used:

**PERFUMES/FRAGRANCES**:
→ Spray on pulse points: wrists, neck, behind ears, inner elbows
→ NEVER spray on: leaves, objects, air randomly, body parts where fragrance isn't applied
→ Examples: "model spraying perfume on inner wrist", "gentle mist applied to neck", "elegant spray behind ear"
→ If hands visible: spray should target wrist/hand area naturally

**SKINCARE/SERUMS/CREAMS**:
→ Apply to face, hands, or relevant skin area
→ Show dropper dispensing onto palm, fingertips touching cream, gentle application motions
→ Examples: "serum dropper releasing golden drop onto fingertips", "cream being gently patted onto cheekbone"

**COSMETICS/MAKEUP**:
→ Lipstick applied to lips, mascara to lashes, foundation blended on face
→ Show realistic application gestures and tools
→ Examples: "lipstick gliding across full lips", "mascara wand sweeping through lashes"

**BEVERAGES/FOOD**:
→ Being consumed, poured, or held in natural drinking/eating position
→ Show realistic enjoyment moments
→ Examples: "coffee cup raised to lips with steam rising", "wine glass tilted for elegant sip"

**TECH/GADGETS**:
→ Being used for their intended purpose: earbuds in ears, phone in hand being used, watch on wrist
→ Examples: "earbuds nestled in ears, person lost in music", "smartwatch on wrist displaying notification"

⚠️ NEVER show product being used in unnatural/illogical ways - use your world knowledge of how products are actually used in real life.

🚨 CRITICAL RULES:
1. 🚨🚨🚨 **SHOT TYPE FIRST** (for model shots): ALWAYS start prompts with "MEDIUM SHOT, waist-up with headroom:" or "FULL BODY SHOT:" - This PREVENTS cropped heads!
2. 🚨 VARIETY IS MANDATORY: {f"When inspirations ({num_inspirations}) are provided, follow each inspiration's composition (model or product-only) - do NOT force 50/50 split. Each image should match its inspiration's aesthetic. Cover ALL provided inspirations." if has_image_inspiration else "Do NOT put human models in ALL images! Mix product-only shots with model shots (aim for 50/50 split) - ONLY apply when NO inspirations are provided."}
3. Generate DIVERSE outputs - vary shot types: closeups, flat-lays, lifestyle, studio, macro details
4. For model shots: FACE MUST ALWAYS BE VISIBLE AND EXPRESSIVE - include phrases like "face visible", "looking at camera", "genuine smile"
5. For product-only shots: focus on textures, details, dramatic lighting, premium surfaces - NO humans needed
6. NO TWO OUTPUTS SHOULD LOOK THE SAME - vary shot types, settings, lighting, angles
7. When showing product in use: ALWAYS describe the EXACT realistic usage action matching the product's real-world purpose
8. 🚨 PROPER FRAMING (for model shots): "full head visible with generous headroom above" - NEVER crop heads - include 15-20% space above head
9. If INSPIRATION IMAGES provided: APPLY their aesthetic to your product photography
10. If LINK INSPIRATION provided: Study and APPLY the aesthetic from the inspiration
11. Product-only shots are PREMIUM content - closeups of watches, jewelry, shoes, clothing details are highly valuable

🚫 INTELLIGENT ARTIFACT PREVENTION (UNIQUE PER PROMPT):
Generate DYNAMIC, CONTEXT-SPECIFIC prevention text for EACH image prompt. Each prompt's prevention MUST be DIFFERENT and SPECIFIC to that scene.

**RULES FOR PREVENTION GENERATION**:
1. ANALYZE your specific image prompt - what product? what action? what setting?
2. Write SHORT, TARGETED prevention (3-5 specific points max)
3. MENTION the actual product by name from inventory analysis
4. DESCRIBE the specific action correctly if hands/usage is shown
5. NEVER copy-paste same prevention text across prompts

**QUALITY ASSURANCE EXAMPLES** (add these details naturally at the END of your prompts - no brackets, no special keywords):

Scene: Perfume spray on wrist (HANDS VISIBLE)
End prompt with: "...single Midnight Bloom bottle, one spray nozzle, each hand has exactly five fingers with one thumb, left hand gripping bottle, right wrist receiving spray, no extra digits, no fused fingers, natural finger proportions, mist between nozzle and wrist"

Scene: Sweater worn by model on rooftop (FULL BODY VISIBLE)
End prompt with: "...single Floral Knit Sweater with consistent pattern, anatomically correct human with two arms two legs, natural body proportions, no extra limbs, full head visible with headroom above, symmetrical face, natural rooftop perspective, single coherent skyline"

Scene: Serum dropper application to palm (HANDS + FACE VISIBLE)
End prompt with: "...single dropper tip, each hand has exactly five fingers with one thumb, right hand holding dropper at natural angle, left palm open receiving drop, no extra fingers, no fused digits, symmetrical natural face with two eyes, natural skin texture, one golden drop falling"

Scene: Sunglasses product shot on marble (NO HUMANS)
End prompt with: "...single pair of sunglasses, symmetrical frames, consistent lens tint, natural marble veining, no duplicate products"

Scene: Lipstick being applied (HAND + FACE VISIBLE)
End prompt with: "...single lipstick tube, one application point on lips, hand holding lipstick with exactly five fingers and one thumb, natural finger grip, symmetrical face, natural lip shape, no extra fingers"

**WHAT MAKES PREVENTION DYNAMIC**:
- Uses ACTUAL product name from inventory (e.g., "Floral Knit Sweater" not "product")
- Describes SPECIFIC hand positions for THAT action (e.g., "left hand holding bottle at 45 degrees")
- Mentions SPECIFIC environmental elements from YOUR prompt (e.g., "sunset terrace railing" not generic "environment")
- Focuses on 3-5 RISKY elements for THAT particular composition

**ANTI-PATTERNS TO AVOID**:
❌ Same prevention text for multiple prompts
❌ Listing elements NOT in your prompt
❌ Long exhaustive lists covering everything
❌ Copy-pasting prevention examples from these instructions

🚨🚨🚨 **MANDATORY HUMAN ANATOMY PREVENTION** (ALWAYS include when humans/hands appear) 🚨🚨🚨

When your prompt includes ANY human element (full body, hands, face), you MUST include these SPECIFIC prevention phrases:

**WHEN HANDS ARE VISIBLE** (holding product, applying, gesturing):
→ ALWAYS add: "each hand has exactly five fingers, one thumb per hand, natural finger proportions, no extra digits, no fused fingers, no floating hands"
→ If two hands: "two distinct hands - left and right clearly differentiated"
→ If one hand: "single hand with five fingers and one thumb"

**WHEN FULL/PARTIAL BODY VISIBLE**:
→ ALWAYS add: "anatomically correct human body, two arms, two legs, natural body proportions, no extra limbs, no merged body parts"

**WHEN FACE VISIBLE**:
→ ALWAYS add: "symmetrical natural face, two eyes, one nose, one mouth, natural skin texture, no distorted features"
→ Plus: "full head visible with headroom above, no cropped head"

**EXAMPLE PROMPT ENDINGS WITH HUMAN ANATOMY** (add naturally at the END of your prompt - no brackets, no keywords):

Scene: Model holding serum bottle, applying drop to hand
End prompt with: "...single Hydra Serum bottle, one dropper tip, each hand has exactly five fingers with one thumb per hand, natural finger proportions, no extra digits, no fused fingers, two distinct hands - right holding bottle left receiving drop, one golden drop falling, symmetrical natural face with two eyes, natural skin texture, anatomically correct arms with natural proportions"

Scene: Hands spraying perfume on wrist
End prompt with: "...single perfume bottle, one spray nozzle, each hand has exactly five fingers with one thumb, left hand gripping bottle naturally, right wrist receiving spray, no extra fingers, no floating hands, natural wrist anatomy, mist arc between nozzle and wrist"

Scene: Model wearing sweater, full body
End prompt with: "...single sweater with consistent pattern, anatomically correct human body with two arms and two legs, natural body proportions, no extra limbs, full head visible with headroom, symmetrical face, natural posture"

  🚨 This is NOT optional - hand/body distortions are the #1 AI artifact problem. ALWAYS include these phrases naturally at the end when humans appear.
  
  🎭 **NATURAL CHARACTER EXPRESSIONS** (CRITICAL FOR BELIEVABLE HUMANS):
  
  AI-generated characters often look unnatural, robotic, or expressionless. You MUST add NATURAL EXPRESSION CUES to make characters feel authentic and relatable.
  
  **EXPRESSION ELEMENTS TO INCLUDE** (intelligently embed in prompts):
  
  **FACIAL EXPRESSIONS** (match the beat/emotion):
  - Hook/Problem: "slight furrow in brow", "eyes narrowing with curiosity", "lips pressed in mild frustration"
  - Discovery: "eyes widening with realization", "eyebrows raising in surprise", "mouth opening slightly in awe"
  - Satisfaction: "genuine warm smile reaching eyes", "relaxed facial muscles", "satisfied closed-eye moment"
  - Speaking: "natural lip movement", "eyes engaged with camera", "expressive eyebrows during speech"
  
  **BODY LANGUAGE** (match the mood):
  - Frustration: "shoulders slightly hunched", "hand running through hair", "leaning back in exasperation"
  - Excitement: "leaning forward with energy", "animated hand gestures", "open body posture"
  - Satisfaction: "relaxed shoulders", "content posture", "natural breathing visible"
  - Authenticity: "small natural fidgets", "weight shifting", "genuine micro-expressions"
  
  **AVOID ROBOTIC APPEARANCES**:
  - ❌ "person looking at camera" (too static)
  - ✅ "person glancing at camera with slight head tilt and warm smile, eyes crinkling at corners"
  
  - ❌ "happy expression" (too generic)
  - ✅ "genuine smile with visible teeth, crow's feet forming at eyes, cheeks raised naturally"
  
  - ❌ "speaking to camera" (too flat)
  - ✅ "speaking with animated expressions, eyebrows rising for emphasis, natural hand gestures accompanying words"
  
  **EMBED NATURALLY IN IMAGE PROMPTS**:
  "South Asian man, 30s, friendly nostalgic expression with *slight wistful smile and distant gaze*, casual checkered shirt..."
  
  **EMBED NATURALLY IN CLIP PROMPTS**:
  "Reference character *turning to camera with eyes lighting up in recognition*, subtle head tilt forward, *genuine excited micro-expressions forming*, no text overlays. Saying in..."

🎬🎬🎬 **VIDEO CLIP QUALITY ASSURANCE** (MANDATORY - DYNAMIC PER CLIP) 🎬🎬🎬

Video generation models produce WORSE artifacts than image models. You MUST generate CONTEXT-SPECIFIC quality assurance for EACH clip based on what's in that specific clip and its associated image prompt.

**🎯 DYNAMIC QA GENERATION** (DO NOT copy-paste - generate unique QA per clip):

1. **LOOK AT YOUR IMAGE PROMPT** for this clip - what specific elements are there?
2. **LOOK AT YOUR CLIP PROMPT** - what actions/movements are happening?
3. **WRITE QA SPECIFIC TO THOSE ELEMENTS** - use actual names and details!

**DYNAMIC QA RULES BY ELEMENT TYPE**:

**HANDS VISIBLE** → Describe SPECIFIC hand action:
- "right hand holding [exact product name from inventory] with five fingers, thumb stabilizing grip"
- "fingers applying [product] to [target], natural pressure, no clipping through surface"
- "both hands visible with five fingers each during [specific action]"

**FACE/CHARACTER VISIBLE** → Reference YOUR image prompt details:
- "consistent [character details you wrote in image prompt], facial features stable during [action]"
- "same [hair color/style, skin tone, outfit] as starting frame throughout motion"

**PRODUCT FEATURED** → Use ACTUAL product name:
- "[Product name from inventory] maintains exact shape, [specific feature like logo/cap/texture] stays stable"
- "single [product] throughout, no duplication, [distinguishing features] consistent"

**PRODUCT PHOTOGRAPHY DYNAMIC QA EXAMPLES**:

Scene: Serum dropper (image prompt had: "Hydra Glow serum, amber glass bottle, gold dropper")
→ "Close-up of Hydra Glow serum application, amber glass bottle shape stable, gold dropper dispensing single drop, hand with five fingers gripping dropper naturally, golden liquid drop maintaining form as it falls, no text overlays"

Scene: Model wearing sweater (image prompt had: "25-year-old Asian woman, black hair, Floral Knit sweater")
→ "Model showcase of Floral Knit sweater, consistent floral pattern on sweater fabric, Asian woman's black hair and facial features stable, sweater fit unchanged during movement, natural arm positions with two arms visible, no text overlays"

Scene: Watch detail shot (image prompt had: "Chronos Elite watch, silver case, black leather strap")
→ "Macro detail of Chronos Elite watch, silver case maintains circular shape, black leather strap texture consistent, watch face details stable during slow rotation, no dial distortion, no text overlays"

**🚨 ANTI-PATTERNS TO AVOID**:
❌ Generic: "anatomically correct human" → ✅ Specific: "consistent [your character description]"
❌ Generic: "product maintains shape" → ✅ Specific: "[Product name] maintains [specific features]"
❌ Same QA for every clip → ✅ Unique QA based on each clip's content
"""
    else:
        # FLOW 1: Social Media Creative Director persona (default)
        persona_intro = f"""You are a WORLD-CLASS CREATIVE DIRECTOR specializing in social media content creation.
You respond ONLY with valid JSON objects, no extra text or formatting.

Generate {number_of_posts} pieces of content for the topic: "{request.topic}"

🎯🎯🎯 **USER INSTRUCTIONS ARE TOP PRIORITY** 🎯🎯🎯

**BEFORE generating ANY content, CHECK user instructions (provided below in USER INSTRUCTIONS section).**

**IF user has provided specific instructions:**
- FOLLOW them EXACTLY - they override all default behaviors
- User knows their brand best - their vision takes precedence
- Honor specific requests about style, mood, setting, models, etc.

**IF no specific instructions provided:**
- Use your expertise and the guidelines below to decide\""""
    
    # Build storytelling framework section based on category and mode
    storytelling_section = f"""
🎬🎬🎬 **STORYTELLING FRAMEWORK - {storytelling_ctx['framework_type'].upper()}** 🎬🎬🎬

**BRAND CATEGORY DETECTED**: {brand_category.upper()}
**EMOTIONAL GOAL**: {storytelling_ctx['goal']}
**VIDEO LENGTH MODE**: {video_length_mode} ({mode_config['description']})
**TARGET CLIPS**: {mode_config['min_clips']}-{mode_config['max_clips']} clips

**EMOTIONAL TRIGGERS TO USE** (for this category):
- Emotions: {', '.join(storytelling_ctx['emotions'])}
- Visual Levers: {', '.join(storytelling_ctx['visual_levers'][:5])}
- Hook Styles: {', '.join(storytelling_ctx['hook_styles'])}

{storytelling_ctx['framework']}

🎯 **CLIP DURATION SPECIFICATION** (MANDATORY):

You MUST specify the duration for each clip in your output. The video generation model will use these exact durations.

**SUPPORTED DURATIONS**:
- Veo3.1: 4s, 6s, 8s
- Kling: 5s, 10s

**For each clip, add a "duration" field**:
- "video_X_clip_Y_duration": 4 or 6 or 8 (for beat-appropriate timing)

**DURATION GUIDANCE BY BEAT**:
- Hook/Intro beats: 4s (punchy, attention-grabbing)
- Build/Escalation beats: 6s-8s (time to develop emotion)  
- Reveal/Payoff beats: 6s-8s (time for satisfaction)
- CTA/Outro beats: 4s (quick, memorable)

**Example for story mode (5 clips)**:
- Clip 1 (Hook): 4s - Quick attention grab
- Clip 2 (Problem/Desire): 6s - Build tension
- Clip 3 (Escalation+Transition): 8s - Stakes + beat drop
- Clip 4 (Reveal+Payoff): 8s - Product satisfaction
- Clip 5 (Punchline+CTA): 6s - Memorable ending

**VARY DURATIONS for cinematic rhythm** - don't make every clip the same length!
"""
    
    system_prompt = f"""{persona_intro}

{storytelling_section}

🎯 YOUR DECISION-MAKING RESPONSIBILITY:

1. **DECIDE VIDEO TYPE** (product_marketing / ugc_influencer / brand_marketing)
   - Analyze brand context, inventory, user instructions, and link analysis
   - Set appropriate flags based on your decision

2. **🎤 PER-CLIP VOICEOVER - YOUR CREATIVE FREEDOM**:
   {"🚨 VOICEOVER FORCED OFF: Inspiration detected. Set has_voiceover=false for ALL clips." if voiceover_forced_off else f'''You decide voiceover for EACH CLIP independently based on:
   - Brand Category: {brand_category} → {storytelling_ctx["goal"]}
   - Beat Purpose: Hook clips usually NO voiceover, CTA clips often YES
   - Content Type: UGC = character speech, Product/Brand = your choice per clip'''}

3. **GENERATE PROMPTS BASED ON YOUR VOICEOVER DECISIONS**:
   - If has_voiceover=true for a clip → Include 'Voiceover in [tone] [gender] voice:' at END of clip prompt
   - If has_voiceover=false for a clip → Pure visual, NO voiceover text
   - influencer_marketing=true (UGC) → Include "saying in [tone] (14 words max): [speech]" in clip prompts
   - no_characters=true → NO human characters in prompts

4. **SPECIFY VOICE/TONE** (CRITICAL for Veo3.1 audio quality when has_voiceover=true):
   - Product/Brand videos: "Voiceover in professional male narrator voice:" or "warm confident female voice:"
   - UGC videos: "saying in conversational excited tone:" or "genuine relatable tone:"
   - Voice/tone specification ensures Veo3.1 generates appropriate, high-quality embedded audio

5. **🎵 PER-CLIP MUSIC PROMPT - CONTEXT-AWARE GENERATION**:
   Generate music prompts that are SPECIFIC to the brand, story context, and beat purpose. NOT generic prompts!
   
   **🎯 MUSIC PROMPT MUST CONSIDER**:
   1. **BRAND CONTEXT**: Industry, target audience, brand personality
   2. **STORY CONTEXT**: What's happening visually in this clip
   3. **BEAT PURPOSE**: Where this clip sits in the storytelling framework
   4. **EMOTIONAL GOAL**: What feeling should the viewer have
   
   **MUSIC PROMPT GENERATION BY BRAND CATEGORY**:
   
   **FOOD/BEVERAGE BRANDS**:
   - Hook: "warm acoustic intro, anticipation of delicious moment, subtle sizzle undertone"
   - Build: "gentle rhythm building hunger, cozy kitchen ambiance"
   - Reveal: "satisfying crescendo, comfort food warmth, feel-good resolution"
   - CTA: "upbeat cheerful melody, inviting dining atmosphere"
   
   **FASHION/BEAUTY BRANDS**:
   - Hook: "sleek modern beat, runway energy, confident pulse"
   - Build: "stylish electronic groove, transformation building"
   - Reveal: "glamorous reveal music, empowering beat drop, confidence surge"
   - CTA: "trendy pop energy, aspirational lifestyle vibe"
   
   **TECH/GADGET BRANDS**:
   - Hook: "futuristic synth intro, innovation teaser, clean digital tone"
   - Build: "technological pulse building, anticipation of reveal"
   - Reveal: "epic tech reveal, powerful bass drop, future-forward triumph"
   - CTA: "energetic electronic, cutting-edge momentum, call to action drive"
   
   **DIGITAL SERVICE/SaaS BRANDS**:
   - Hook: "professional corporate intro, trust-building tone"
   - Build: "steady momentum, productivity rhythm, focus energy"
   - Reveal: "achievement unlocked feel, success crescendo"
   - CTA: "motivational upbeat, take-action energy, confident close"
   
   **LIFESTYLE/WELLNESS BRANDS**:
   - Hook: "serene nature sounds, peaceful intro, mindful moment"
   - Build: "gentle yoga flow rhythm, wellness journey building"
   - Reveal: "blissful transformation, inner peace crescendo"
   - CTA: "uplifting acoustic warmth, self-care motivation"
   
   **🎬 MUSIC BY STORYTELLING BEAT** (7-Beat Framework):
   | Beat | Purpose | Music Characteristics |
   | Hook | Grab attention | Punchy intro, immediate impact, curiosity trigger |
   | Problem | Show pain point | Tension undertone, relatable struggle feel |
   | Escalation | Raise stakes | Building intensity, momentum increase |
   | Transition | Mood shift | Beat drop, dramatic pause, pivot moment |
   | Reveal | Product solution | Triumphant swell, satisfaction payoff |
   | Payoff | Emotional reward | Warm resolution, feel-good achievement |
   | CTA | Drive action | Energetic push, confident call to action |
   
   **🎬 MUSIC BY STORYTELLING BEAT** (3-Beat Product Framework):
   | Beat | Purpose | Music Characteristics |
   | Intrigue | Hook attention | Mysterious intro, curiosity building |
   | Showcase | Product glory | Epic reveal, premium feel, showcase worthy |
   | Payoff | Drive desire | Satisfying close, want-to-buy energy |
   
   **WHEN TO SKIP MUSIC** (set null):
   - UGC clips where character speech is the main focus
   - Clips with important voiceover that shouldn't compete with music
   - Clips where ambient/natural sounds tell the story better
   
   **EXAMPLE MUSIC PROMPTS** (context-aware, not generic):
   
   ❌ GENERIC (BAD): "upbeat music"
   ✅ CONTEXT-AWARE (GOOD): "warm coffee shop acoustic, morning energy, cozy cafe vibe for breakfast brand reveal"
   
   ❌ GENERIC (BAD): "dramatic music"  
   ✅ CONTEXT-AWARE (GOOD): "sleek runway beat with confident bass drop, fashion transformation moment"
   
   ❌ GENERIC (BAD): "happy music"
   ✅ CONTEXT-AWARE (GOOD): "blissful skincare transformation crescendo, self-care achievement, glowing results payoff"
   
   **WRITE MUSIC PROMPTS THAT MATCH YOUR SPECIFIC BRAND AND STORY!**

6. **USE ACTUAL BRAND NAME IN CLIP PROMPTS ONLY** (MANDATORY for voiceover/speech):
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

{video_inspiration_str if has_video_inspiration else ''}
{'''
🎬 **CRITICAL - VIDEO INSPIRATION ALIGNMENT**:

A video reel/short inspiration has been provided above. Generate clip prompts that replicate the inspiration's storytelling approach while adapting for this brand.

🚨 **PROMPT LENGTH LIMIT**: Each CLIP prompt MUST be UNDER 4000 characters. Capture the ESSENCE of the timeline and key moments - don't describe every micro-detail.
''' if has_video_inspiration else ''}

{image_inspiration_str if has_image_inspiration else ''}
{'''
🖼️ **CRITICAL - IMAGE INSPIRATION ALIGNMENT**:

An image inspiration has been provided above. Create content with the SAME AESTHETIC while featuring the brand's product.

🚨🚨🚨 **MANDATORY - USE ALL INSPIRATIONS WITH 1:1 MAPPING** 🚨🚨🚨

**IF INSPIRATIONS ARE PROVIDED** (e.g., {num_inspirations} inspiration(s) for {num_images_for_mapping} image(s)):
- You MUST use ALL inspirations - do NOT skip any inspiration
- Create a 1:1 mapping: 1 image per inspiration (when counts match)
- Each image prompt MUST follow its corresponding inspiration's aesthetic
- **MAPPING RULES**:
  * If {num_images_for_mapping} images and {num_inspirations} inspirations (counts match):
    → Image 0 → Follow Inspiration 1's aesthetic
    → Image 1 → Follow Inspiration 2's aesthetic
    → Image 2 → Follow Inspiration 3's aesthetic (if exists)
    → Image 3 → Follow Inspiration 4's aesthetic (if exists)
  * If counts don't match (e.g., {num_images_for_mapping} images but {num_inspirations} inspirations):
    → Distribute inspirations evenly across images
    → Example: If 4 images and 2 inspirations → Image 0-1 → Inspiration 1, Image 2-3 → Inspiration 2
- **CRITICAL**: Every inspiration MUST be used - no inspiration should be left unused
- **CRITICAL**: Each image must follow ONE inspiration's aesthetic - do NOT blend multiple inspirations into one image

**INSPIRATION MAPPING INSTRUCTIONS**:
- Study each inspiration's analysis carefully (Inspiration 1, Inspiration 2, etc.)
- Apply the specific aesthetic (colors, lighting, composition, mood) from that inspiration to its mapped image
- Each image should reflect the unique style of its assigned inspiration
- Do NOT blend all inspirations into one image - each image follows ONE inspiration
- Reference the inspiration number in your prompt generation (e.g., "Following Inspiration 1's aesthetic: warm golden lighting, minimalist composition...")
- **CRITICAL - MODEL vs PRODUCT-ONLY WHEN INSPIRATIONS PROVIDED**:
  * Follow each inspiration's composition exactly - do NOT force a 50-50 split
  * The 50-50 split rule ONLY applies when NO inspirations are provided
  * If an inspiration shows a model/human → that image should include a model/human
  * If an inspiration shows product-only → that image should be product-only
  * The variety comes from following different inspirations, not from forcing a model/product-only split
  * Each inspiration's aesthetic (including whether it has models or not) should be preserved in its mapped image
  * Cover ALL provided inspirations - every inspiration must be used in the generated prompts

🚨 **PROMPT LENGTH LIMIT**: Each prompt MUST be UNDER 4000 characters. Be CONCISE - capture the ESSENCE, not every detail.

**CAPTURE THE ESSENCE (SUMMARIZE, don't list everything)**:

✅ **CORE AESTHETIC** (describe in 1-2 sentences):
   - Primary mood/vibe + lighting style + color palette

✅ **COMPOSITION** (1 sentence):
   - Shot type, angle, depth of field

✅ **HUMAN PRESENCE** (if applicable - be brief):
   - Simple description of pose, clothing style, positioning

✅ **SETTING** (1 sentence max):
   - Location type and atmosphere

🎯 **YOUR TASK**: Write a CONCISE prompt (under 4000 chars) that captures the inspiration's VIBE - same mood, lighting, composition style - with the brand's product as hero.

❌ **DO NOT**: List every single object, every accessory, every background element. Focus on what makes the image FEEL the way it does.

✅ **GOOD EXAMPLE** (under 800 chars):
"Reference product (Floral Sweater) worn by confident young woman, urban street style, sunny outdoor setting with bokeh city background, medium shot eye-level, shallow depth of field, warm natural lighting, edgy fashion vibe with leather jacket layered over sweater, relaxed confident pose, bustling city atmosphere, professional candid photography style"

❌ **BAD EXAMPLE** (too long - over 5000 chars):
"Reference product worn by young woman in her 20s, Caucasian or mixed ethnicity with fair skin and olive undertones, dark brown hair in messy updo with loose strands falling over face..." [continues for 4000+ more characters listing every detail]
''' if has_image_inspiration else ''}

{'''
🚨🚨🚨 **PRODUCT IS THE HERO - MANDATORY** 🚨🚨🚨

**IF PRODUCT IMAGES ARE IDENTIFIED IN INVENTORY ANALYSIS:**
- The ACTUAL PRODUCT must be **VISIBLE AND FEATURED THROUGHOUT THE ENTIRE CLIP**
- The product is the HERO/STAR of the video - it should appear in EVERY SCENE
- DO NOT just blend product "patterns" or "textures" into the inspiration's setting
- DO NOT recreate the inspiration's environment with product colors/patterns abstracted into it
- INSTEAD: Show the ACTUAL PRODUCT in a setting/style INSPIRED by the reference video

**WHAT TO COPY FROM INSPIRATION:**
✅ Camera movements (orbit, pan, tilt, tracking, crane, dolly, etc.)
✅ Pacing and timing (how fast/slow things happen)
✅ Transitions (hard cuts, morphs, dissolves)
✅ Lighting style and mood (dramatic, soft, neon, etc.)
✅ Visual effects (glitch, lens flares, reflections)
✅ Overall cinematic quality and production value

🔍 **VISUAL SUBJECTS** (use your judgment - these enhance replication when appropriate):
Consider incorporating visual elements from the inspiration when they enhance the content:
- **Human elements** - Hands, people, body language can add authenticity
- **Objects/Props** - Food, drinks, accessories can create context and lifestyle feel
- **Setting/Location** - Matching environments creates visual consistency
- **Actions/Interactions** - Similar actions (reaching, holding, using) can mirror the inspiration's energy
- **Environmental elements** - Lighting conditions and atmosphere contribute to mood

⚡ **YOUR CREATIVE AUTONOMY**: You decide which visual subjects to incorporate based on what serves the brand and product best. Not every inspiration element needs to be replicated - choose what enhances YOUR content.

**WHAT TO REPLACE:**
✅ The main subject/hero → Replace with the ACTUAL PRODUCT from inventory
✅ Adapt supporting elements (hands, props, environment) to showcase YOUR product naturally
✅ Any text/graphics → Replace with brand-relevant content

**EXAMPLE - WRONG vs RIGHT:**

❌ WRONG (what NOT to do):
"Surreal cave with winding fabric pool lit in neon purple matching sweater patterns, organic petal formations..."
→ This blends product PATTERNS into a fantasy scene but DOESN'T SHOW the actual product!
→ This also IGNORES visual subjects from inspiration (hands, props, setting)!

✅ RIGHT (what TO do - with visual subjects from inspiration):
If inspiration has: "Human hands reaching for item, kitchen setting, coffee cup on counter, morning light"
→ Generate: "Elegant female hands reach toward the floral pattern sweater laid on a marble kitchen counter, morning golden light streaming through window, steaming coffee cup in background creating cozy atmosphere. Camera tracks hand movement as fingers touch the fuzzy mohair texture, rack focus from sweater to hand, then dolly in to reveal purple and yellow floral designs..."

✅ RIGHT (what TO do - product as hero but with inspiration's visual elements):
"The floral pattern sweater floats majestically in center frame against a dreamy, surreal pink-lit backdrop. Elegant hands reach into frame from below, gently lifting the sweater. Camera orbits as the sweater rotates gracefully, soft neon reflections dance across its fuzzy mohair texture. Hard cut to close-up of the purple and yellow floral designs, dramatic spotlight emphasizing every thread..."
→ The ACTUAL PRODUCT is visible and featured throughout!

📋 **CLIP PROMPT FORMAT** (Generate prompts like professional advertising storyboards):

Your clip prompts MUST include:
1. **EXACT TIMELINE BREAKDOWN** - Second-by-second description of what happens
2. **PRODUCT VISIBILITY** - The product MUST be mentioned/visible in EVERY 2-second segment
3. **CAMERA MOVEMENTS** - Push-in, pull-out, pan, tilt, overhead, tracking, slow descent, etc.
4. **TRANSITIONS** - Hard cuts, morphing, dissolves, fades, seamless transitions between scenes
5. **VISUAL COMPOSITION** - Framing, symmetry, reflections, lighting, lens flares
6. **STYLE SPECIFICATIONS** - Hyper-realistic, cinematic, color grade, film grain
7. **MUSIC/AUDIO DESCRIPTION** - Type of music, tempo, when it peaks, mood it creates

📝 **EXAMPLE CLIP PROMPT FORMAT** (Product-focused with inspiration style):

"Luxury 8-second vertical (9:16) product film for philistinetoronto. No dialogue, only music.

0-2 sec: The floral pattern sweater floats center-frame in a surreal, dreamy pink-lit studio space. Camera orbits slowly, soft neon reflections dancing on the fuzzy mohair texture.

2-4 sec: Hard cut to dramatic overhead shot. The sweater laid flat on a glossy reflective surface, camera slowly descending, capturing every detail of the purple and yellow floral designs.

4-6 sec: Close-up dolly around the sweater's sleeve, showcasing the oversized fit. Subtle glowing edges in brand accent colors. Background transitions to ethereal twilight aesthetic.

6-8 sec: Wide shot - the sweater on a modern display stand, dreamlike atmosphere, soft lens flare. Fade to black with brand logo.

Style: Hyper-realistic luxury advertising, inspired by surreal fantasy aesthetics, ultra-clean.
Music: Ambient dreamy synth that builds to a calming peak.
Aspect ratio: 9:16 vertical."

🎯 **ALIGNMENT RULES**:

1. **PRODUCT IS HERO**: The actual product MUST be visible in every scene - not just patterns/colors abstracted
2. **FOLLOW INSPIRATION TECHNIQUES**: Copy camera movements, pacing, transitions, lighting, effects
3. **CREATE PRODUCT-FOCUSED SETTING**: Design a setting that showcases the product while matching inspiration's aesthetic
4. **IMAGE PROMPT = STARTING FRAME**: The image_prompt should show the PRODUCT as the hero of the first frame
5. **MUSIC ALIGNMENT**: Describe music that fits the brand mood while matching inspiration's audio approach

🎬 **MULTI-CLIP INSPIRATION DISTRIBUTION** (CRITICAL - See CLIPS_PER_VIDEO above):

⚠️ Check the "MULTI-CLIP VIDEO STRUCTURE" section above for the exact number of clips per video.
When generating a video with MULTIPLE CLIPS, you MUST:

1. **SPREAD THE INSPIRATION STORYLINE ACROSS ALL CLIPS**:
   - Divide the inspiration's timeline/story arc across the total number of clips
   - Each clip should represent a CHAPTER of the overall story
   - When all clips are stitched together, they form ONE cohesive, mind-blowing video

2. **CLIP STRUCTURE FOR MULTI-CLIP VIDEOS**:
   - **Clip 1**: Opening/Hook - Grab attention, introduce product in the inspiration's style
   - **Clip 2**: Development/Showcase - Deep dive into product features using inspiration's techniques
   - **Clip 3** (if applicable): Climax/Resolution - Dramatic finale, brand reveal, call-to-action moment

3. **TIMELINE ADAPTATION**:
   - If inspiration is 15 seconds and you have 3 clips (24-30s total):
     * Clip 1 (8-10s): Expand inspiration's 0-5s into a full clip with product as hero
     * Clip 2 (8-10s): Expand inspiration's 5-10s into a full clip with product showcase
     * Clip 3 (8-10s): Expand inspiration's 10-15s into a full clip with grand finale
   - Each clip should feel complete on its own BUT flow seamlessly into the next

4. **PRODUCT IN EVERY CLIP**:
   - The product MUST appear in EVERY clip's starting frame (image prompt)
   - The product MUST be featured throughout EVERY clip's motion (clip prompt)
   - Each clip shows the product from a different angle, context, or moment

5. **CONTINUITY ACROSS CLIPS**:
   - Visual style/aesthetic should be CONSISTENT across all clips
   - Lighting mood should flow naturally (don't jump from dark to bright randomly)
   - Camera style should feel unified (all cinematic, or all dynamic, etc.)
   - Music description should indicate a CONTINUOUS piece that spans all clips

**EXAMPLE - 3-CLIP VIDEO WITH INSPIRATION**:

Clip 1 (Opening - 0-10s of final video):
- Image prompt: "Reference product (floral sweater) floating center-frame in dreamy pink-lit space..."
- Clip prompt: "0-2s: Sweater emerges from soft mist, crane descent revealing. 2-6s: Camera orbits, revealing texture. 6-10s: Dolly glide to close-up..."

Clip 2 (Showcase - 10-20s of final video):
- Image prompt: "Reference product (floral sweater) laid elegantly on reflective surface, dramatic overhead lighting..."
- Clip prompt: "0-2s: Overhead crane descent toward sweater. 2-6s: Slow 360 rotation, every floral detail visible. 6-10s: Pull back to reveal setting..."

Clip 3 (Finale - 20-30s of final video):
- Image prompt: "Reference product (floral sweater) on minimalist display, brand logo subtly visible, golden hour lighting..."
- Clip prompt: "0-2s: Wide establishing shot. 2-6s: Slow zoom culminating in product hero shot. 6-10s: Soft fade, logo appears with light streaks..."

🚨 **CRITICAL - VIDEO TYPE RESTRICTION**:

When video inspiration is provided, you MUST categorize the video as either:
- "product_marketing" - For product-focused cinematic videos
- "brand_marketing" - For brand storytelling/awareness videos

**NEVER use "ugc_influencer"** when video inspiration is provided.
Video inspiration = Professional cinematic content = product_marketing OR brand_marketing ONLY.
''' if has_video_inspiration else ''}

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
   - **FIRST**: Check if VIDEO INSPIRATION is provided (from YouTube, Instagram, Twitter/X)
   - **IF VIDEO INSPIRATION EXISTS**: ALWAYS use "product_marketing" or "brand_marketing" - NEVER "ugc_influencer"
   - **SECOND**: Check if USER INSTRUCTIONS explicitly request a specific video type (product showcase, UGC/influencer, brand story)
   - **IF YES**: Honor the user's explicit request
   - **IF NO VIDEO INSPIRATION**: Autonomously analyze inventory, brand context, and content purpose to decide
   - Choose: "product_marketing", "ugc_influencer", or "brand_marketing"
   - This decision affects ALL subsequent prompts and flags
   
   🚨 **REMEMBER**: Video inspiration = Professional cinematic = NEVER UGC

2. IMAGE PROMPTS (for image-only posts):
   - Posts at indices {sorted(image_only_indices)}: Static images (1:1 aspect ratio)
   - Include brand colors: {color_str}
   - Optimized for AI image generation
   
   🚨 **SHOT TYPE VARIETY** (CRITICAL - Do NOT put humans in ALL images):
   - Mix product-only shots with lifestyle/model shots
   - For 4 images: 2 product-only (closeups, flat-lays, studio), 2 with models/hands
   - Product-only shots: dramatic lighting, texture details, macro closeups, flat-lays
   - Lifestyle shots: models wearing/using product, hands interacting
   - Example product-only: "Reference product (watch) extreme closeup on dial, dramatic rim lighting, no humans"
   - Example lifestyle: "Reference product (watch) worn by confident model, urban setting, face visible"
   
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

- **🛍️ PRODUCT MAPPING REMINDER** (CRITICAL):
  * **IMAGE POSTS** (indices {sorted(image_only_indices)}): **ALWAYS** set `image_X_product_mapping: "image_1"` (or rotate through products)
    → Product in EVERY image post - they are product showcases!
  * **VIDEO CLIPS**: Follow BEAT-SPECIFIC rules
    → ❌ Clips 1-3 (hook/problem/escalation): `product_mapping: null`
    → ✅ Clips 4+ (transition/reveal/payoff/cta): `product_mapping: "image_1"`
    → Build story TENSION before product REVEAL

- **JSON VALIDATION**: Must be valid and parseable

- **VIDEO INDICES**: Posts at indices {sorted(video_indices)} are {VIDEO_DURATION_ESTIMATE}-{CLIPS_PER_VIDEO * 10}s videos ({CLIPS_PER_VIDEO} clips each), rest are images

{"🚨🚨🚨 CRITICAL STORY VIDEO REMINDERS (YOU HAVE {} CLIPS) 🚨🚨🚨".format(CLIPS_PER_VIDEO) if CLIPS_PER_VIDEO >= 3 else ""}
{'''
**⚠️ THIS IS A STORY VIDEO - FOLLOW THESE RULES:**

1. **CHARACTERS ARE REQUIRED** - Use relatable human characters, NOT just product shots
   - Set no_characters=false, human_characters_only=true
   - Create diverse, authentic characters appropriate for the brand

2. **CHARACTER SPEAKING IS REQUIRED** in at least 2-3 clips (UGC-style)
   - Hook clip: Character speaks to camera about relatable problem
   - CTA clip: Character invites viewer with genuine enthusiasm
   - Use "Saying in [tone] (14 words max): [speech]" format

3. **PRODUCT TIMING - DO NOT SHOW PRODUCT IN EARLY CLIPS**
   - Clip 1-2: NO product_mapping (focus on CHARACTER and PROBLEM)
   - Clip 3: Can hint at solution
   - Clip 4-5: Product appears (REVEAL and PAYOFF)
   
4. **CREATE TENSION BEFORE RELIEF**
   - Early clips: frustration, longing, problem
   - Later clips: discovery, satisfaction, invitation
   
5. **MIX AUDIO TECHNIQUES**
   - Some clips: Character speaking (UGC feel)
   - Some clips: Voiceover narration
   - Some clips: Pure visual with music (especially for product reveal)

❌ BAD VIDEO (all product, no story):
- Clip 1: Product shot with voiceover
- Clip 2: Product shot with voiceover
- Clip 3: Product shot with voiceover
- Clip 4: Product shot with voiceover
- Clip 5: Product shot with voiceover
→ BORING, NO ENGAGEMENT, NOT SCROLL-STOPPING

✅ GOOD VIDEO (character-driven story):
- Clip 1: Character speaks about relatable problem (no product)
- Clip 2: Character shows frustration (no product)
- Clip 3: Character discovers solution (no product yet)
- Clip 4: PRODUCT REVEALED with dramatic cinematography
- Clip 5: Character satisfied, invites viewer (product visible)
→ ENGAGING, SCROLL-STOPPING, MEMORABLE
''' if CLIPS_PER_VIDEO >= 3 else ""}
"""
    
    # Debug logging
    print(f"\n📊 INVENTORY ANALYSIS PASSED TO GROK:")
    print(inventory_analysis_str[:500] if inventory_analysis_str and len(inventory_analysis_str) > 500 else inventory_analysis_str if inventory_analysis_str else "(No inventory analysis)")
    print(f"\n📊 LINK ANALYSIS PASSED TO GROK:")
    print(link_analysis_str[:500] if link_analysis_str and len(link_analysis_str) > 500 else link_analysis_str if link_analysis_str else "(No link analysis)")
    
    if has_video_inspiration:
        print(f"\n🎬 VIDEO INSPIRATION PASSED TO GROK:")
        print(video_inspiration_str[:500] if len(video_inspiration_str) > 500 else video_inspiration_str)
    
    if has_image_inspiration:
        print(f"\n🖼️ IMAGE INSPIRATION PASSED TO GROK:")
        print(image_inspiration_str[:500] if len(image_inspiration_str) > 500 else image_inspiration_str)
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
        
        # NEW: Extract Grok's clip count decision (for story mode)
        grok_clip_count = prompts_data.get("total_clips")
        if grok_clip_count and GROK_DECIDES_CLIP_COUNT:
            # Grok chose the clip count - use it (within bounds)
            grok_clip_count = int(grok_clip_count)
            actual_clips = max(MIN_CLIPS, min(grok_clip_count, MAX_CLIPS))
            print(f"  🎬 Grok chose {grok_clip_count} clips → Using {actual_clips} clips (bounds: {MIN_CLIPS}-{MAX_CLIPS})")
            CLIPS_PER_VIDEO = actual_clips
        else:
            # Count how many clips Grok actually generated by checking keys
            for video_idx in video_indices:
                clip_count = 0
                for i in range(1, 10):  # Check up to 10 clips
                    if f"video_{video_idx}_clip_{i}_prompt" in prompts_data or f"video_{video_idx}_clip_{i}_image_prompt" in prompts_data:
                        clip_count = i
                if clip_count > 0 and clip_count != CLIPS_PER_VIDEO:
                    print(f"  🎬 Grok generated {clip_count} clips for video {video_idx} (expected {CLIPS_PER_VIDEO})")
                    CLIPS_PER_VIDEO = max(CLIPS_PER_VIDEO, clip_count)  # Use the max found
        
        # Apply user's video style choice (always has a value, defaults to brand_marketing)
        user_video_style = request.video_style if hasattr(request, 'video_style') and request.video_style else "brand_marketing"
        if user_video_style in ['brand_marketing', 'product_marketing', 'ugc_influencer']:
            if video_type != user_video_style:
                print(f"🎬 Applying user's video style: '{user_video_style}' (Grok suggested: '{video_type}')")
            video_type = user_video_style
            # Set flags based on user's choice
            if user_video_style == "ugc_influencer":
                influencer_marketing = True
                no_characters = False
                human_characters_only = True
            elif user_video_style == "product_marketing":
                influencer_marketing = False
            elif user_video_style == "brand_marketing":
                influencer_marketing = False
        
        # OVERRIDE: Force product_marketing when onboarding product image is provided (higher priority than user choice)
        force_product_marketing = context.get("force_product_marketing", False)
        if force_product_marketing and video_type != "product_marketing":
            print(f"🛍️ OVERRIDE: force_product_marketing=True, changing video_type from '{video_type}' to 'product_marketing'")
            video_type = "product_marketing"
            influencer_marketing = False
        
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
        # image_only_indices is already calculated earlier in the function
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
                product_mapping_key = f"video_{video_idx}_clip_{clip_num}_product_mapping"
                duration_key = f"video_{video_idx}_clip_{clip_num}_duration"  # NEW: Per-clip duration
                beat_key = f"video_{video_idx}_clip_{clip_num}_beat"  # NEW: Storytelling beat
                has_voiceover_key = f"video_{video_idx}_clip_{clip_num}_has_voiceover"  # NEW: Per-clip voiceover
                
                clip_data = {}
                if image_prompt_key in prompts_data:
                    clip_data['image_prompt'] = prompts_data[image_prompt_key]
                if clip_prompt_key in prompts_data:
                    clip_data['clip_prompt'] = prompts_data[clip_prompt_key]
                if logo_key in prompts_data:
                    logo_val = prompts_data[logo_key]
                    clip_data['logo_needed'] = logo_val if isinstance(logo_val, bool) else str(logo_val).lower() in ['true', '1', 'yes']
                if product_mapping_key in prompts_data:
                    product_mapping_val = prompts_data[product_mapping_key]
                    # Store if not null/none
                    if product_mapping_val and str(product_mapping_val).lower() not in ['null', 'none']:
                        clip_data['product_mapping'] = product_mapping_val
                        print(f"  📦 Video {video_idx}, Clip {clip_num} product mapping: {product_mapping_val}")
                else:
                        clip_data['product_mapping'] = None
                
                # NEW: Extract per-clip duration (Grok's creative decision)
                if duration_key in prompts_data:
                    duration_val = prompts_data[duration_key]
                    if isinstance(duration_val, int):
                        clip_data['duration'] = duration_val
                    elif isinstance(duration_val, str) and duration_val.isdigit():
                        clip_data['duration'] = int(duration_val)
                    else:
                        clip_data['duration'] = 8  # Default
                    print(f"  ⏱️  Video {video_idx}, Clip {clip_num} duration: {clip_data['duration']}s")
                else:
                    clip_data['duration'] = 8  # Default
                
                # NEW: Extract storytelling beat
                if beat_key in prompts_data:
                    clip_data['beat'] = prompts_data[beat_key]
                    print(f"  🎬 Video {video_idx}, Clip {clip_num} beat: {clip_data['beat']}")
                else:
                    clip_data['beat'] = 'unknown'
                
                # NEW: Extract per-clip voiceover decision (Grok's creative decision)
                if has_voiceover_key in prompts_data:
                    vo_val = prompts_data[has_voiceover_key]
                    clip_data['has_voiceover'] = vo_val if isinstance(vo_val, bool) else str(vo_val).lower() in ['true', '1', 'yes']
                    print(f"  🎤 Video {video_idx}, Clip {clip_num} voiceover: {'YES' if clip_data['has_voiceover'] else 'NO'}")
                else:
                    clip_data['has_voiceover'] = False  # Default to no voiceover
                
                # NEW: Extract per-clip music prompt (Grok's creative decision)
                music_prompt_key = f"video_{video_idx}_clip_{clip_num}_music_prompt"
                if music_prompt_key in prompts_data:
                    music_val = prompts_data[music_prompt_key]
                    # Can be a string or null
                    if music_val and isinstance(music_val, str) and music_val.lower() not in ['null', 'none', '']:
                        clip_data['music_prompt'] = music_val
                        print(f"  🎵 Video {video_idx}, Clip {clip_num} music: {music_val[:50]}...")
                    else:
                        clip_data['music_prompt'] = None
                        print(f"  🎵 Video {video_idx}, Clip {clip_num} music: NONE (no custom music)")
                else:
                    clip_data['music_prompt'] = None  # Default to no custom music
                
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
    
    # Extract inspiration background music if available (for replacing AI-generated audio)
    link_analysis = context.get("link_analysis", {})
    video_inspiration = link_analysis.get("video_inspiration", {})
    inspiration_music_s3_key = video_inspiration.get("background_music_s3_key") if video_inspiration else None
    
    if inspiration_music_s3_key:
        print(f"🎶 Inspiration background music available: {inspiration_music_s3_key}")
        print(f"   Will be used for product_marketing/brand_marketing videos instead of AI-generated audio")
    else:
        print(f"🎶 No inspiration background music available (will use AI-generated audio)")
    
    # Model selection: 10% Kling v2.6, 90% Veo3.1
    # Selection is done per video, not per clip (all clips in a video use same model)
    # NEW: Duration is now specified per-clip by the LLM
    import random
    
    def get_model_duration_param(model_name: str, requested_duration: int) -> tuple:
        """
        Map LLM-requested duration to actual model-supported duration.
        Returns (actual_duration, duration_param_string)
        """
        if model_name == "kling_v2.6":
            # Kling supports 5 and 10 seconds
            supported = [5, 10]
            closest = min(supported, key=lambda x: abs(x - requested_duration))
            return (closest, str(closest))  # Kling uses "5" or "10"
        else:
            # Veo supports 4, 6, 8 seconds
            supported = [4, 6, 8]
            closest = min(supported, key=lambda x: abs(x - requested_duration))
            return (closest, f"{closest}s")  # Veo uses "4s", "6s", "8s"
    
    def select_video_model(default_duration: int = 8):
        """Select video model with 10:90 ratio (Kling:Veo)"""
        if random.random() < 0.10:
            actual_duration, duration_param = get_model_duration_param("kling_v2.6", default_duration)
            return {
                "name": "kling_v2.6",
                "fal_model": "fal-ai/kling-video/v2.6/pro/image-to-video",
                "clip_duration": actual_duration,
                "duration_param": duration_param,
            }
        else:
            actual_duration, duration_param = get_model_duration_param("veo3.1", default_duration)
            return {
                "name": "veo3.1",
                "fal_model": "fal-ai/veo3.1/fast/image-to-video",
                "clip_duration": actual_duration,
                "duration_param": duration_param,
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
    print(f"📋 Video models: 10% Kling v2.6 (10s clips), 90% Veo3.1 (8s clips)")
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
        print(f"⚠️ No logo URL available - will use product/model images if available")
    
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
        
        # Safety: Truncate prompt if over FAL's 5000 character limit
        if len(prompt) > 4500:
            print(f"  ⚠️ Image prompt too long ({len(prompt)} chars), truncating to 4500 chars")
            prompt = prompt[:4500] + "..."
        
        # FALLBACK: Force logo inclusion for ALL image-only posts (even if Grok forgot)
        if not logo_needed:
            print(f"⚠️ Grok forgot to set logo_needed=true for image post {idx}, forcing logo inclusion")
            logo_needed = True
        
        print(f"\n📝 Image {idx} ({len(prompt)} chars): {prompt[:80]}...")
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
            
            # Ensure at least one image is passed (Nano Banana Edit requirement)
            # Priority: already added images > logo > any available product
            if not image_urls:
                if presigned_logo_url:
                    image_urls.append(presigned_logo_url)
                    print(f"  🏷️ Fallback: Including logo image (no other images available)")
                elif product_presigned_urls:
                    # Use the first available product image as fallback
                    first_product_key = list(product_presigned_urls.keys())[0]
                    image_urls.append(product_presigned_urls[first_product_key])
                    print(f"  🛍️ Fallback: Including product image {first_product_key} (no logo available)")
            
            # Model selection: Force GPT 1.5 for product shot flow or when product images detected, otherwise 50/50 random
            is_product_shot_flow = context.get("is_product_shot_flow", False)
            use_photographer_persona = context.get("use_photographer_persona", False)
            if is_product_shot_flow or use_photographer_persona:
                # Flow 2: Always use GPT 1.5 Image for high-quality product photography
                selected_image_model = "gpt-1.5-image"
                selected_image_model_fal = "fal-ai/gpt-image-1.5/edit"
                print(f"  🎨 Image model selection: {selected_image_model.upper()} (FORCED - Product Shot Flow)")
            else:
                # Flow 1: Random selection 50% Nano Banana Pro Edit, 50% GPT 1.5 Image Edit
                image_model_random = random.random()
                if image_model_random > 0.5:
                    selected_image_model = "nano-banana"
                    selected_image_model_fal = "fal-ai/nano-banana-pro/edit"
                else:
                    selected_image_model = "gpt-1.5-image"
                    selected_image_model_fal = "fal-ai/gpt-image-1.5/edit"
                print(f"  🎲 Image model selection: {selected_image_model.upper()} (random: {image_model_random:.2f})")
            
            # Log reference images being used (after model selection)
            print(f"📸 [{selected_image_model.upper()}] Image {idx} - Reference images ({len(image_urls)}):")
            if image_urls:
                for i, url in enumerate(image_urls):
                    print(f"   {i+1}. {url[:80]}...")
            else:
                print(f"   ⚠️ No reference images provided - image edit models require at least 1 image!")
                print(f"   ❌ Skipping image {idx} generation - no reference images available")
                continue
            
            def on_queue_update(update):
                if isinstance(update, fal_client.InProgress):
                    for log in update.logs:
                        print(log["message"])
            
            if selected_image_model == "nano-banana":
                result = fal_client.subscribe(
                    "fal-ai/nano-banana-pro/edit",
                    arguments={
                        "prompt": prompt,
                        "num_images": 1,
                        "output_format": "png",
                        "aspect_ratio": "1:1",
                        "resolution": "1K",
                        "image_urls": image_urls,
                        "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic features, hashtags, double logos, extra text, cropped head, cut off head, forehead cropped, head out of frame, top of head missing, hairline cropped, extreme close-up, zoomed in too close, tight framing cutting off head"
                    },
                    with_logs=True,
                    on_queue_update=on_queue_update
                )
            else:
                # GPT 1.5 Image Edit model
                result = fal_client.subscribe(
                    "fal-ai/gpt-image-1.5/edit",
                    arguments={
                        "prompt": prompt,
                        "image_urls": image_urls,
                        "image_size": "1024x1024",
                        "background": "auto",
                        "quality": "high",
                        "input_fidelity": "high",
                        "num_images": 1,
                        "output_format": "png"
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
                    "model": selected_image_model_fal,
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
    print(f"🎬 MULTI-CLIP VIDEO GENERATION (Kling v2.6 10% / Veo3.1 90%, 9:16)")
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
        locked_frame_model = None  # For multi-clip videos: lock to the model used for frame 1
        locked_frame_model_fal = None
        
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            image_prompt = clip_data.get('image_prompt')
            logo_needed = clip_data.get('logo_needed', False)
            product_mapping = clip_data.get('product_mapping')  # NEW: e.g., "image_1", "image_2", or None
            
            if not image_prompt:
                print(f"⚠️ No image prompt for clip {clip_num}, skipping")
                frame_s3_urls.append(None)
                continue
            
            # Safety: Truncate prompt if over FAL's 5000 character limit
            if len(image_prompt) > 4500:
                print(f"  ⚠️ Image prompt too long ({len(image_prompt)} chars), truncating to 4500 chars")
                image_prompt = image_prompt[:4500] + "..."
            
            print(f"\n  📝 Clip {clip_num} frame ({len(image_prompt)} chars): {image_prompt[:80]}...")
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
                
                # 4. Previous frame (for clip 2+, for visual/style consistency across clips)
                # Include for ALL video types to ensure continuity in multi-clip videos
                if clip_num > 1 and frame_s3_urls:
                    # Get the most recent successfully generated frame
                    previous_frame_s3_url = None
                    for prev_idx in range(len(frame_s3_urls) - 1, -1, -1):
                        if frame_s3_urls[prev_idx]:
                            previous_frame_s3_url = frame_s3_urls[prev_idx]
                            break
                    
                    if previous_frame_s3_url:
                        prev_frame_presigned = web2_s3_helper.generate_presigned_url(previous_frame_s3_url)
                        if prev_frame_presigned:
                            image_urls.append(prev_frame_presigned)
                            print(f"  🔗 Including previous frame for visual continuity (clip {clip_num - 1} → clip {clip_num})")
                
                # Ensure at least one image is passed (Nano Banana Edit requirement)
                # Priority: already added images > logo > any available product
                if not image_urls:
                    if presigned_logo_url:
                        image_urls.append(presigned_logo_url)
                        print(f"  🏷️ Fallback: Including logo image (no other images available)")
                    elif product_presigned_urls:
                        # Use the first available product image as fallback
                        first_product_key = list(product_presigned_urls.keys())[0]
                        image_urls.append(product_presigned_urls[first_product_key])
                        print(f"  🛍️ Fallback: Including product image {first_product_key} (no logo available)")
                
                # Model selection for frame generation
                # For multi-clip videos: use the same model for all frames (locked after frame 1)
                is_product_shot_flow = context.get("is_product_shot_flow", False)
                use_photographer_persona = context.get("use_photographer_persona", False)
                if CLIPS_PER_VIDEO > 1 and locked_frame_model is not None:
                    selected_frame_model = locked_frame_model
                    selected_frame_model_fal = locked_frame_model_fal
                    print(f"  🔒 Using locked frame model for consistency: {selected_frame_model.upper()}")
                elif is_product_shot_flow or use_photographer_persona:
                    # Flow 2: Always use GPT 1.5 Image for high-quality product photography
                    selected_frame_model = "gpt-1.5-image"
                    selected_frame_model_fal = "fal-ai/gpt-image-1.5/edit"
                    print(f"  🎨 Frame model selection: {selected_frame_model.upper()} (FORCED - Product Shot Flow)")
                else:
                    # Flow 1: Random model selection 50% Nano Banana Pro Edit, 50% GPT 1.5 Image Edit
                    frame_model_random = random.random()
                    if frame_model_random > 0.5:
                        selected_frame_model = "nano-banana"
                        selected_frame_model_fal = "fal-ai/nano-banana-pro/edit"
                    else:
                        selected_frame_model = "gpt-1.5-image"
                        selected_frame_model_fal = "fal-ai/gpt-image-1.5/edit"
                    
                    print(f"  🎲 Frame model selection: {selected_frame_model.upper()} (random: {frame_model_random:.2f})")
                
                # Log reference images being used for frame generation
                print(f"  📸 [{selected_frame_model.upper()}] Frame {clip_num} - Reference images ({len(image_urls)}):")
                if image_urls:
                    for i, url in enumerate(image_urls):
                        print(f"     {i+1}. {url[:80]}...")
                else:
                    print(f"     ⚠️ No reference images available - Image edit models require at least 1 image!")
                    print(f"     ❌ Skipping frame {clip_num} generation")
                    frame_s3_urls.append(None)
                    continue
            
                def on_queue_update(update):
                    if isinstance(update, fal_client.InProgress):
                        for log in update.logs:
                            print(log["message"])
            
                if selected_frame_model == "nano-banana":
                    result = fal_client.subscribe(
                        "fal-ai/nano-banana-pro/edit",
                        arguments={
                            "prompt": image_prompt,
                            "num_images": 1,
                            "output_format": "png",
                            "aspect_ratio": "1:1",
                            "resolution": "1K",
                            "image_urls": image_urls,
                            "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic features, hashtags, double logos, extra text, cropped head, cut off head, forehead cropped, head out of frame, top of head missing, hairline cropped, extreme close-up, zoomed in too close, tight framing cutting off head"
                        },
                        with_logs=True,
                        on_queue_update=on_queue_update
                    )
                else:
                    # GPT 1.5 Image Edit model
                    result = fal_client.subscribe(
                        "fal-ai/gpt-image-1.5/edit",
                        arguments={
                            "prompt": image_prompt,
                            "image_urls": image_urls,
                            "image_size": "1024x1024",
                            "background": "auto",
                            "quality": "medium",
                            "input_fidelity": "high",
                            "num_images": 1,
                            "output_format": "png"
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
                    
                    # Lock the frame model for multi-clip videos (after first successful frame)
                    if CLIPS_PER_VIDEO > 1 and locked_frame_model is None:
                        locked_frame_model = selected_frame_model
                        locked_frame_model_fal = selected_frame_model_fal
                        print(f"  🔒 Locking frame model to {selected_frame_model.upper()} for remaining clips")
                    
                    # Track model usage for frame generation
                    model_usage["videoFrameGeneration"].append({
                        "post_index": video_idx,
                        "clip_number": clip_num,
                        "model": selected_frame_model_fal,
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
        locked_model = None  # For multi-clip videos: lock to the model used for clip 1
        
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            clip_prompt = clip_data.get('clip_prompt')
            frame_s3_url = frame_s3_urls[clip_num - 1] if clip_num <= len(frame_s3_urls) else None
            
            # NEW: Get clip-specific duration from LLM output (default to 8s if not specified)
            llm_requested_duration = clip_data.get('duration', 8)
            clip_beat = clip_data.get('beat', 'unknown')
            
            # NEW: Get clip-specific voiceover decision from LLM output
            has_voiceover = clip_data.get('has_voiceover', False)
            
            if not clip_prompt or not frame_s3_url:
                print(f"  ⚠️ Missing clip prompt or frame for clip {clip_num}, skipping")
                clip_s3_urls.append(None)
                actual_models_used.append(None)
                continue
            
            # Safety: Truncate clip prompt if over 5000 character limit
            if len(clip_prompt) > 4500:
                print(f"  ⚠️ Clip prompt too long ({len(clip_prompt)} chars), truncating to 4500 chars")
                clip_prompt = clip_prompt[:4500] + "..."
            
            print(f"\n  📝 Clip {clip_num} [{clip_beat}] prompt ({len(clip_prompt)} chars): {clip_prompt[:80]}...")
            print(f"  ⏱️  LLM requested duration: {llm_requested_duration}s")
            print(f"  🎤 Voiceover: {'YES - has voiceover' if has_voiceover else 'NO - pure visual'}")
            
            # For multi-clip videos: use the same model for all clips (locked after clip 1)
            if CLIPS_PER_VIDEO > 1 and locked_model is not None:
                # Update locked model with clip-specific duration
                actual_duration, duration_param = get_model_duration_param(locked_model['name'], llm_requested_duration)
                current_primary_model = {
                    **locked_model,
                    'clip_duration': actual_duration,
                    'duration_param': duration_param
                }
                current_fallback_model = current_primary_model  # Same model for fallback to ensure consistency
                print(f"  🔒 Using locked model for consistency: {locked_model['name'].upper()} with {actual_duration}s")
            else:
                # Update selected model with clip-specific duration
                actual_duration, duration_param = get_model_duration_param(selected_model['name'], llm_requested_duration)
                current_primary_model = {
                    **selected_model,
                    'clip_duration': actual_duration,
                    'duration_param': duration_param
                }
                # Also update fallback model with clip-specific duration
                fb_actual_duration, fb_duration_param = get_model_duration_param(fallback_model['name'], llm_requested_duration)
                current_fallback_model = {
                    **fallback_model,
                    'clip_duration': fb_actual_duration,
                    'duration_param': fb_duration_param
                }
                print(f"  ⏱️  Mapped to {selected_model['name'].upper()}: {actual_duration}s")
            
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
                    primary_model=current_primary_model,
                    fallback_model=current_fallback_model,
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
                    
                    # For multi-clip videos: lock model after first successful clip for consistency
                    if CLIPS_PER_VIDEO > 1 and clip_num == 1 and locked_model is None:
                        # Determine duration_param format based on model (Veo uses "8s", Kling uses "10")
                        if used_model_name == "veo3.1":
                            duration_param_locked = f"{used_clip_duration}s"
                        else:
                            duration_param_locked = str(used_clip_duration)
                        
                        locked_model = {
                            "name": used_model_name,
                            "fal_model": used_fal_model,
                            "clip_duration": used_clip_duration,
                            "duration_param": duration_param_locked
                        }
                        print(f"  🔒 Locked model for remaining clips: {used_model_name.upper()} (ensures visual consistency)")
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
        
        # Step 3c: Process clips with per-clip audio (music and voiceover)
        print(f"\n🎵 Processing {len([c for c in clip_s3_urls if c])} clips...")
        
        valid_clips = [url for url in clip_s3_urls if url]
        
        if not valid_clips:
            print(f"❌ No valid clips to stitch for video {video_idx}")
            continue
        
        # Extract video-specific flags
        video_type = prompts["video_type"]
        influencer_marketing_flag = prompts["influencer_marketing"]
        voiceover_flag = prompts["voiceover"]
        
        # Step 3c-1: Process each clip with per-clip audio logic
        # PRIORITY ORDER:
        # 1. If inspiration_music exists → Clean Veo music, apply inspiration music, mix (USER'S CHOICE)
        # 2. Else if clip has music_prompt → Clean Veo music, generate ElevenLabs music, apply/mix
        # 3. Else → Keep original clip as-is (Veo's default audio is fine)
        
        # Flag to track if per-clip audio was applied (skip post-stitching audio if true)
        per_clip_audio_applied = False
        
        if not influencer_marketing_flag and CLIPS_PER_VIDEO > 1:
            print(f"\n{'='*60}")
            print(f"🎵 PER-CLIP AUDIO PROCESSING (NEW)")
            print(f"{'='*60}")
            print(f"   Inspiration music available: {'YES' if inspiration_music_s3_key else 'NO'}")
            
            processed_clips = []
            any_clip_had_custom_audio = False  # Track if any clip had custom audio
            
            for idx, clip_url in enumerate(valid_clips):
                clip_num = idx + 1
                # Get clip data for this clip (match by index - valid_clips may have gaps removed)
                # Find the actual clip_num by counting through clip_s3_urls
                actual_clip_num = 0
                valid_idx = 0
                for i, url in enumerate(clip_s3_urls, 1):
                    if url:
                        if valid_idx == idx:
                            actual_clip_num = i
                            break
                        valid_idx += 1
                
                clip_data = video_clip_data.get(actual_clip_num, {})
                music_prompt = clip_data.get('music_prompt')
                has_voiceover = clip_data.get('has_voiceover', False)
                clip_duration = clip_data.get('duration', 8)
                clip_beat = clip_data.get('beat', 'unknown')
                
                print(f"\n🎬 Processing clip {clip_num}/{len(valid_clips)} [{clip_beat}]...")
                print(f"   Music prompt: {music_prompt[:50] + '...' if music_prompt else 'NONE'}")
                print(f"   Has voiceover: {'YES' if has_voiceover else 'NO'}")
                print(f"   Duration: {clip_duration}s")
                
                # Determine audio processing path
                # PRIORITY: Inspiration music > ElevenLabs music > Original Veo audio
                # Inspiration music takes priority when available (user explicitly provided an inspiration with music)
                if inspiration_music_s3_key:
                    # PATH B: Inspiration music from user-provided video (takes priority!)
                    print(f"   → PATH B: Inspiration music from video link (PRIORITY)")
                    any_clip_had_custom_audio = True
                    
                    # Download clip
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                        presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                        response = requests.get(presigned_url)
                        temp_file.write(response.content)
                        clip_path = temp_file.name
                        print(f"      📥 Downloaded clip")
                    
                    # Clean Veo background music with Demucs
                    print(f"      🎵 Cleaning Veo background music with Demucs...")
                    cleaned_clip_path = separate_voice_from_music_demucs(clip_path)
                    if not cleaned_clip_path or cleaned_clip_path == clip_path:
                        print(f"      ⚠️ Demucs failed, using original clip")
                        cleaned_clip_path = clip_path
                    
                    # Download inspiration music
                    print(f"      🎵 Downloading inspiration music...")
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as music_file:
                        inspiration_presigned = web2_s3_helper.generate_presigned_url(inspiration_music_s3_key)
                        music_response = requests.get(inspiration_presigned)
                        music_file.write(music_response.content)
                        inspiration_music_path = music_file.name
                    
                    # Create no-audio clip for mixing
                    no_audio_path = remove_audio_from_video(cleaned_clip_path)
                    
                    # Extract voiceover audio if clip has voiceover
                    if has_voiceover:
                        voiceover_path = extract_audio_from_video(cleaned_clip_path)
                        
                        # Mix inspiration music (30%) + voiceover (100%)
                        final_clip_path = cleaned_clip_path.replace('.mp4', '_final.mp4')
                        success = await mix_music_and_voiceover_for_clip(
                            no_audio_clip_path=no_audio_path,
                            music_path=inspiration_music_path,
                            voiceover_path=voiceover_path,
                            output_path=final_clip_path,
                            music_volume=0.3,
                            voiceover_volume=1.0
                        )
                        
                        if success:
                            print(f"      ✅ Inspiration music + voiceover mixed successfully")
                        else:
                            # Fallback: apply inspiration music only
                            success = await apply_music_to_clip(no_audio_path, inspiration_music_path, final_clip_path)
                            print(f"      ⚠️ Voiceover mix failed, applied inspiration music only")
                        
                        # Clean up voiceover file
                        try:
                            os.remove(voiceover_path)
                        except:
                            pass
                    else:
                        # No voiceover - just apply inspiration music
                        final_clip_path = cleaned_clip_path.replace('.mp4', '_final.mp4')
                        success = await apply_music_to_clip(no_audio_path, inspiration_music_path, final_clip_path)
                        print(f"      ✅ Inspiration music applied (no voiceover)")
                    
                    # Clean up temp files
                    try:
                        os.remove(no_audio_path)
                        os.remove(inspiration_music_path)
                    except:
                        pass
                    
                    # Upload processed clip
                    if success and os.path.exists(final_clip_path):
                        processed_s3_url = web2_s3_helper.upload_from_file(
                            file_path=final_clip_path,
                            folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                            filename=f"processed_clip_{clip_num}.mp4"
                        )
                        processed_clips.append(processed_s3_url)
                        print(f"      ✅ Clip {clip_num} processed with inspiration music and uploaded")
                        try:
                            os.remove(final_clip_path)
                        except:
                            pass
                    else:
                        # Fallback to cleaned clip
                        cleaned_s3_url = web2_s3_helper.upload_from_file(
                            file_path=cleaned_clip_path,
                            folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                            filename=f"cleaned_clip_{clip_num}.mp4"
                        )
                        processed_clips.append(cleaned_s3_url)
                        print(f"      ⚠️ Inspiration music processing failed, using cleaned clip")
                    
                    # Clean up local files
                    try:
                        os.remove(clip_path)
                        if cleaned_clip_path != clip_path:
                            os.remove(cleaned_clip_path)
                    except:
                        pass
                
                elif music_prompt:
                    # PATH A: Custom music from ElevenLabs (fallback when no inspiration music)
                    print(f"   → PATH A: Custom ElevenLabs music")
                    any_clip_had_custom_audio = True
                
                    # Download clip
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_file:
                        presigned_url = web2_s3_helper.generate_presigned_url(clip_url)
                        response = requests.get(presigned_url)
                        temp_file.write(response.content)
                        clip_path = temp_file.name
                        print(f"      📥 Downloaded clip")
                
                    # Clean Veo background music with Demucs
                    print(f"      🎵 Cleaning Veo background music with Demucs...")
                    cleaned_clip_path = separate_voice_from_music_demucs(clip_path)
                    if not cleaned_clip_path or cleaned_clip_path == clip_path:
                        print(f"      ⚠️ Demucs failed, using original clip")
                        cleaned_clip_path = clip_path
                
                    # Generate ElevenLabs music
                    print(f"      🎵 Generating ElevenLabs music: {music_prompt[:60]}...")
                    music_path = await generate_music_with_elevenlabs(music_prompt, clip_duration)
                    
                    if music_path:
                        # Create no-audio clip for mixing
                        no_audio_path = remove_audio_from_video(cleaned_clip_path)
                        
                        # Extract voiceover audio if clip has voiceover
                        if has_voiceover:
                            voiceover_path = extract_audio_from_video(cleaned_clip_path)
                            
                            # Mix music (30%) + voiceover (100%)
                            final_clip_path = cleaned_clip_path.replace('.mp4', '_final.mp4')
                            success = await mix_music_and_voiceover_for_clip(
                                no_audio_clip_path=no_audio_path,
                                music_path=music_path,
                                voiceover_path=voiceover_path,
                                output_path=final_clip_path,
                                music_volume=0.3,
                                voiceover_volume=1.0
                            )
                            
                            if success:
                                print(f"      ✅ Music + voiceover mixed successfully")
                            else:
                                # Fallback: apply music only
                                success = await apply_music_to_clip(no_audio_path, music_path, final_clip_path)
                                print(f"      ⚠️ Voiceover mix failed, applied music only")
                            
                            # Clean up voiceover file
                            try:
                                os.remove(voiceover_path)
                            except:
                                pass
                        else:
                            # No voiceover - just apply music
                            final_clip_path = cleaned_clip_path.replace('.mp4', '_final.mp4')
                            success = await apply_music_to_clip(no_audio_path, music_path, final_clip_path)
                            print(f"      ✅ Music applied (no voiceover)")
                        
                        # Clean up temp files
                        try:
                            os.remove(no_audio_path)
                            os.remove(music_path)
                        except:
                            pass
                        
                        # Upload processed clip
                        if success and os.path.exists(final_clip_path):
                            processed_s3_url = web2_s3_helper.upload_from_file(
                                file_path=final_clip_path,
                                folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                                filename=f"processed_clip_{clip_num}.mp4"
                            )
                            processed_clips.append(processed_s3_url)
                            print(f"      ✅ Clip {clip_num} processed and uploaded")
                            try:
                                os.remove(final_clip_path)
                            except:
                                pass
                        else:
                            # Fallback to cleaned clip
                            cleaned_s3_url = web2_s3_helper.upload_from_file(
                                file_path=cleaned_clip_path,
                                folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                                filename=f"cleaned_clip_{clip_num}.mp4"
                            )
                            processed_clips.append(cleaned_s3_url)
                            print(f"      ⚠️ Music processing failed, using cleaned clip")
                    else:
                        # ElevenLabs failed - use cleaned clip
                        cleaned_s3_url = web2_s3_helper.upload_from_file(
                            file_path=cleaned_clip_path,
                            folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/video_{video_idx}",
                            filename=f"cleaned_clip_{clip_num}.mp4"
                        )
                        processed_clips.append(cleaned_s3_url)
                        print(f"      ⚠️ ElevenLabs failed, using cleaned clip")
                
                    # Clean up local files
                    try:
                        os.remove(clip_path)
                        if cleaned_clip_path != clip_path:
                            os.remove(cleaned_clip_path)
                    except:
                        pass
                
                else:
                    # PATH C: No custom music - keep original Veo clip as-is
                    print(f"   → PATH C: Keep original clip (no custom music)")
                    processed_clips.append(clip_url)
                    print(f"      ✅ Clip {clip_num} kept as-is (Veo default audio)")
            
            # Use processed clips for stitching
            valid_clips = processed_clips
            
            # Set flag if any clip had custom audio (skip post-stitching audio)
            per_clip_audio_applied = any_clip_had_custom_audio
            
            print(f"\n{'='*60}")
            print(f"✅ ALL CLIPS PROCESSED: Per-clip audio applied")
            print(f"   Custom audio applied to at least one clip: {'YES' if any_clip_had_custom_audio else 'NO'}")
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
        
        # Step 3c-2: Stitch clips together (smart: simple concat or crossfade based on audio content)
        # First, log audio summary for debugging and build clip audio status
        print(f"\n{'='*60}")
        print(f"🎤 AUDIO SUMMARY FOR VIDEO {video_idx}")
        print(f"{'='*60}")
        voiceover_clips = []
        character_speech_clips = []
        pure_visual_clips = []
        clips_with_audio = set()  # Clips that have voiceover OR character speech
        
        for clip_num in range(1, CLIPS_PER_VIDEO + 1):
            clip_data = video_clip_data.get(clip_num, {})
            clip_has_vo = clip_data.get('has_voiceover', False)
            clip_beat = clip_data.get('beat', 'unknown')
            clip_duration = clip_data.get('duration', 8)
            clip_prompt = clip_data.get('clip_prompt', '')
            
            # Check for character speech in clip prompt (e.g., "Saying in", "saying:", etc.)
            has_character_speech = any(indicator in clip_prompt.lower() for indicator in [
                'saying in', 'saying:', 'says:', 'speaks:', 'talking:', 
                '(14 words max):', 'words max):'
            ])
            
            if clip_has_vo:
                voiceover_clips.append(clip_num)
                clips_with_audio.add(clip_num)
                print(f"   Clip {clip_num} [{clip_beat}] ({clip_duration}s): 🎤 HAS VOICEOVER")
            elif has_character_speech:
                character_speech_clips.append(clip_num)
                clips_with_audio.add(clip_num)
                print(f"   Clip {clip_num} [{clip_beat}] ({clip_duration}s): 🗣️ CHARACTER SPEAKING")
            else:
                pure_visual_clips.append(clip_num)
                print(f"   Clip {clip_num} [{clip_beat}] ({clip_duration}s): 🎬 PURE VISUAL (music only)")
        
        print(f"\n   📊 Summary: {len(voiceover_clips)} voiceover, {len(character_speech_clips)} character speech, {len(pure_visual_clips)} pure visual")
        if voiceover_clips:
            print(f"   🎤 Voiceover clips: {voiceover_clips}")
        if character_speech_clips:
            print(f"   🗣️ Character speech clips: {character_speech_clips}")
        if pure_visual_clips:
            print(f"   🎬 Pure visual clips: {pure_visual_clips}")
        print(f"   🔗 Clips needing simple stitch (have audio): {sorted(clips_with_audio)}")
        print(f"{'='*60}\n")
        
        print(f"🎞️ Stitching {len(valid_clips)} clips...")

        
        if len(valid_clips) == 1:
            # Single clip, no stitching needed
            print(f"✅ Single clip video (no stitching needed)")
            final_video_url = valid_clips[0]
            
            # NEW: For product_marketing/brand_marketing with inspiration music, replace AI audio
            if inspiration_music_s3_key and video_type in ["product_marketing", "brand_marketing"] and not influencer_marketing_flag:
                print(f"\n🎶 Single clip with inspiration music: Replacing AI-generated audio...")
                video_with_inspiration_music = await replace_video_audio_with_inspiration_music(
                    video_s3_url=final_video_url,
                    inspiration_music_s3_key=inspiration_music_s3_key,
                    account_id=request.account_id,
                    generation_uuid=generation_uuid,
                    video_index=video_idx
                )
                
                if video_with_inspiration_music:
                    final_video_url = video_with_inspiration_music
                    print(f"✅ Final video with inspiration music: {final_video_url}")
                else:
                    print(f"⚠️ Failed to add inspiration music, using original clip with AI audio")
                    print(f"✅ Final video ready: {final_video_url}")
            else:
                print(f"⚡ Using raw Veo3.1/Kling output for faster generation")
                print(f"✅ Final video ready: {final_video_url}")
        
        else:
            # Multiple clips - stitch them with SMART transitions
            try:
                # SMART STITCHING: Use crossfade ONLY between pure visual clips
                # If either clip has voiceover OR character speech, use simple stitch
                # Exception: Influencer marketing ALWAYS uses simple stitching
                
                if influencer_marketing_flag:
                    use_smart_transitions = False
                    print(f"🎤 Influencer Marketing: Using SIMPLE STITCHING (no crossfade)")
                else:
                    use_smart_transitions = True
                    print(f"🎬 Smart Stitching: Crossfade only between pure visual clips")
                
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
                    
                    if use_smart_transitions:
                        # SMART TRANSITIONS: Per-clip-pair decision
                        # Only crossfade between BOTH pure visual clips
                        transition_duration = 1.0
                        
                        # Build list of transition types for each join point
                        # Index i represents the transition AFTER clip i (before clip i+1)
                        transition_types = []
                        for i in range(len(clips) - 1):
                            clip_num_current = i + 1  # 1-indexed clip number
                            clip_num_next = i + 2
                            
                            current_has_audio = clip_num_current in clips_with_audio
                            next_has_audio = clip_num_next in clips_with_audio
                            
                            if current_has_audio or next_has_audio:
                                transition_types.append('simple')
                                reason = []
                                if current_has_audio:
                                    reason.append(f"clip {clip_num_current} has audio")
                                if next_has_audio:
                                    reason.append(f"clip {clip_num_next} has audio")
                                print(f"  🔗 Transition {i+1}→{i+2}: SIMPLE ({', '.join(reason)})")
                            else:
                                transition_types.append('crossfade')
                                print(f"  ✨ Transition {i+1}→{i+2}: CROSSFADE (both pure visual)")
                        
                        # Check if we need any crossfades at all
                        has_any_crossfade = 'crossfade' in transition_types
                        
                        if not has_any_crossfade:
                            # All transitions are simple - just concatenate
                            combined = concatenate_videoclips(clips, method="compose")
                            print(f"  🔗 All transitions are simple (clips have audio)")
                        else:
                            # Mixed transitions - build composite carefully
                            # For simplicity, we'll concatenate segments with simple joins
                            # and only apply crossfade where both clips are pure visual
                            
                            current_time = 0
                            final_clips = []
                            
                            for i, clip in enumerate(clips):
                                if i == 0:
                                    # First clip
                                    if i < len(transition_types) and transition_types[i] == 'crossfade':
                                        # Next transition is crossfade, add fadeout
                                        modified_clip = clip.crossfadeout(transition_duration)
                                    else:
                                        modified_clip = clip
                                    modified_clip = modified_clip.set_start(current_time)
                                    final_clips.append(modified_clip)
                                    
                                    # Update time based on next transition
                                    if i < len(transition_types) and transition_types[i] == 'crossfade':
                                        current_time = modified_clip.end - transition_duration
                                    else:
                                        current_time = modified_clip.end
                                        
                                elif i == len(clips) - 1:
                                    # Last clip
                                    prev_transition = transition_types[i-1] if i > 0 else 'simple'
                                    if prev_transition == 'crossfade':
                                        modified_clip = clip.crossfadein(transition_duration)
                                    else:
                                        modified_clip = clip
                                    modified_clip = modified_clip.set_start(current_time)
                                    final_clips.append(modified_clip)
                                    
                                else:
                                    # Middle clip
                                    prev_transition = transition_types[i-1]
                                    next_transition = transition_types[i]
                                    
                                    modified_clip = clip
                                    if prev_transition == 'crossfade':
                                        modified_clip = modified_clip.crossfadein(transition_duration)
                                    if next_transition == 'crossfade':
                                        modified_clip = modified_clip.crossfadeout(transition_duration)
                                    
                                    modified_clip = modified_clip.set_start(current_time)
                                    final_clips.append(modified_clip)
                                    
                                    # Update time based on next transition
                                    if next_transition == 'crossfade':
                                        current_time = modified_clip.end - transition_duration
                                    else:
                                        current_time = modified_clip.end
                            
                            combined = CompositeVideoClip(final_clips)
                            crossfade_count = transition_types.count('crossfade')
                            simple_count = transition_types.count('simple')
                            print(f"  ✨ Applied {crossfade_count} crossfade + {simple_count} simple transitions")
                    else:
                        # Simple concatenation (influencer marketing)
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
                    
                    # Step 3c-3: Process audio for stitched video (unless influencer marketing OR per-clip audio applied)
                    if not influencer_marketing_flag and not per_clip_audio_applied:
                        print(f"\n{'='*60}")
                        print(f"🎵 PROCESSING AUDIO FOR FINAL VIDEO (POST-STITCHING)")
                        print(f"{'='*60}")
                        print(f"   Video type: {video_type}")
                        print(f"   Voiceover clips: {voiceover_clips if voiceover_clips else 'None'}")
                        print(f"   Pure visual clips: {pure_visual_clips if pure_visual_clips else 'None'}")
                        print(f"   Inspiration music: {'YES' if inspiration_music_s3_key else 'NO (will use Pixverse)'}")
                        print(f"")
                        print(f"   🔄 AUDIO PROCESSING PIPELINE:")
                        print(f"      1. Extract embedded audio from stitched video (voiceover + ambient)")
                        print(f"      2. Create video-only version (no audio)")
                        print(f"      3. Add background music (inspiration or Pixverse)")
                        print(f"      4. Mix voiceover (100%) with background music (30%)")
                        print(f"{'='*60}")
                    elif per_clip_audio_applied:
                        # Per-clip audio was already applied - use stitched video as final
                        print(f"\n{'='*60}")
                        print(f"⏭️ SKIPPING POST-STITCHING AUDIO (Per-clip audio already applied)")
                        print(f"{'='*60}")
                        print(f"   Audio was processed per-clip with ElevenLabs/inspiration music")
                        print(f"   Stitched video already has correct audio mix")
                        final_video_url = stitched_video_s3_url
                    
                    if not influencer_marketing_flag and not per_clip_audio_applied:
                        # Extract voiceover audio from stitched video
                        print(f"\n🎤 Step 1: Extracting audio from stitched video...")
                        voiceover_audio_path = extract_audio_from_video(stitched_path)
                        
                        if not voiceover_audio_path:
                            print(f"  ⚠️ No audio extracted from stitched video")
                            if len(voiceover_clips) > 0:
                                print(f"     Expected voiceover in clips {voiceover_clips} but extraction failed")
                            else:
                                print(f"     This is expected - all clips are pure visual")
                            print(f"  → Using stitched video as-is")
                            final_video_url = stitched_video_s3_url
                        else:
                            print(f"  ✅ Audio extracted successfully")
                            if len(voiceover_clips) > 0:
                                print(f"     Contains voiceover from clips: {voiceover_clips}")
                            else:
                                print(f"     Contains ambient audio only (no voiceover clips)")
                            
                            # Remove audio from stitched video (create video-only)
                            print(f"\n🎬 Step 2: Creating video-only version...")
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
                                
                                # Choose between inspiration music or Pixverse Sound Effects
                                # NOTE: Pixverse Sound Effects is currently DISABLED - skipping background music generation
                                SKIP_PIXVERSE_BACKGROUND_MUSIC = True  # Set to False to re-enable Pixverse background music
                                
                                print(f"\n🎵 Step 3: Adding background music...")
                                if inspiration_music_s3_key:
                                    # Use inspiration background music instead of Pixverse
                                    print(f"   Source: INSPIRATION MUSIC from user-provided video link")
                                    print(f"   → Skipping Pixverse AI generation")
                                    
                                    video_with_music_s3_url = await replace_video_audio_with_inspiration_music(
                                        video_s3_url=video_only_s3_url,
                                        inspiration_music_s3_key=inspiration_music_s3_key,
                                        account_id=request.account_id,
                                        generation_uuid=generation_uuid,
                                        video_index=video_idx
                                    )
                                    
                                    if video_with_music_s3_url:
                                        # Track model usage for audio generation
                                        model_usage["audioGeneration"].append({
                                            "post_index": video_idx,
                                            "model": "inspiration-music",
                                            "audio_source": "video_inspiration_link",
                                            "duration": VIDEO_DURATION
                                        })
                                elif SKIP_PIXVERSE_BACKGROUND_MUSIC:
                                    # Skip Pixverse background music - use original stitched video with voiceover
                                    print(f"   ⏭️ SKIPPING Pixverse background music generation (disabled)")
                                    print(f"   → Using original stitched video with voiceover audio intact")
                                    # Set final video directly to stitched video (skip mixing step entirely)
                                    final_video_url = stitched_video_s3_url
                                    print(f"\n{'='*60}")
                                    print(f"✅ AUDIO PROCESSING COMPLETE (Pixverse skipped)")
                                    print(f"{'='*60}\n")
                                    # Clean up intermediate files
                                    try:
                                        os.remove(video_only_path)
                                        os.remove(voiceover_audio_path)
                                    except:
                                        pass
                                    # Skip the rest of audio processing by using a sentinel value
                                    video_with_music_s3_url = "SKIPPED"
                                else:
                                    # Generate background music with Pixverse Sound Effects
                                    print(f"   Source: PIXVERSE AI-GENERATED music")
                                    audio_prompt = prompts["video_audio_prompts"].get(video_idx, "Upbeat background music")
                                    print(f"   Audio prompt: {audio_prompt[:80]}...")
                                
                                    video_with_music_s3_url = await generate_background_music_with_pixverse(
                                        video_s3_url=video_only_s3_url,
                                        audio_prompt=audio_prompt,
                                        duration=VIDEO_DURATION,
                                        account_id=request.account_id,
                                        generation_uuid=generation_uuid,
                                        video_index=video_idx
                                    )
                                    
                                    if video_with_music_s3_url:
                                        # Track model usage for audio generation
                                        model_usage["audioGeneration"].append({
                                            "post_index": video_idx,
                                            "model": "fal-ai/pixverse/sound-effects",
                                            "audio_prompt": audio_prompt[:100],
                                            "duration": VIDEO_DURATION
                                        })
                                
                                if video_with_music_s3_url == "SKIPPED":
                                    # Pixverse was skipped, final_video_url already set, nothing more to do
                                    pass
                                elif not video_with_music_s3_url:
                                    print(f"  ⚠️ Failed to add background music, using stitched video")
                                    final_video_url = stitched_video_s3_url
                                    try:
                                        os.remove(video_only_path)
                                        os.remove(voiceover_audio_path)
                                    except:
                                        pass
                                    print(f"\n{'='*60}")
                                    print(f"✅ AUDIO PROCESSING COMPLETE")
                                    print(f"{'='*60}\n")
                                else:
                                    # Mix voiceover with background music
                                    print(f"\n🎤 Step 4: Mixing audio tracks...")
                                    print(f"   Background music volume: 30%")
                                    print(f"   Voiceover volume: 100%")
                                    if len(voiceover_clips) > 0:
                                        print(f"   → Voiceover from clips {voiceover_clips} will be audible")
                                    else:
                                        print(f"   → No voiceover clips - only ambient audio will mix with music")
                                    
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
            inventory_analysis = await analyze_user_images(
                request.user_images, 
                context, 
                is_onboarding_product_image=request.is_onboarding_product_image or False
            )
            context["inventory_analysis"] = inventory_analysis
            
            # Store flags for prompt generation
            context["is_onboarding_product_image"] = request.is_onboarding_product_image or False
            context["force_product_marketing"] = request.force_product_marketing or False
            context["is_product_shot_flow"] = request.is_product_shot_flow or False
            
            # Check if product images were detected - if so, use photographer persona
            product_images_detected = inventory_analysis.get("product_images", {}).get("count", 0) > 0
            if product_images_detected:
                context["use_photographer_persona"] = True
                print(f"📸 Product images detected in inventory analysis - will use photographer persona")
            else:
                context["use_photographer_persona"] = False
        else:
            print("⏭️ Skipping inventory analysis - no user images provided")
        
        # Step 3: Auto-select inspirations for product shot flow (if no user-provided inspirations)
        is_product_shot_flow = context.get("is_product_shot_flow", False)
        number_of_images = request.number_of_images if hasattr(request, 'number_of_images') and request.number_of_images else 0
        number_of_videos = request.number_of_videos if hasattr(request, 'number_of_videos') and request.number_of_videos else 0
        total_posts = number_of_images + number_of_videos
        
        # Check if we should auto-select inspirations:
        # - Product shot flow is active (website analysis flow does NOT auto-select)
        # - User hasn't provided inspiration links
        # - We have posts to generate
        auto_selected_inspirations = []
        if is_product_shot_flow and not request.inspiration_links and total_posts > 0:
            suggested_category = inventory_analysis.get('suggested_category') if inventory_analysis else None
            if suggested_category:
                print(f"\n🎯 Auto-selecting inspirations for product shot flow...")
                print(f"   Suggested category: {suggested_category}")
                print(f"   Target: {total_posts} inspirations with analysis available")
                
                auto_selected_inspirations = get_inspirations_by_category(suggested_category, count=total_posts)
                
                if auto_selected_inspirations:
                    print(f"   ✅ Selected {len(auto_selected_inspirations)} inspirations:")
                    for i, insp in enumerate(auto_selected_inspirations, 1):
                        print(f"      {i}. {insp.get('title', 'Untitled')} ({insp.get('category')}) - {insp.get('url', '')[:60]}...")
                else:
                    print(f"   ⚠️  No inspirations found in category '{suggested_category}' with analysis available")
            else:
                print(f"\n⏭️  Skipping auto-selection: No suggested category from inventory analysis")
        elif not is_product_shot_flow and not request.inspiration_links:
            print(f"\n⏭️  Skipping auto-selection: Website analysis flow does not auto-select inspirations")
        
        # Step 3: Analyze inspiration links (25%)
        # Check both user-provided links, auto-selected inspirations, and selected_link from linksJson (with 10-day decay)
        links_to_analyze = []
        if request.inspiration_links:
            # User-provided inspirations take priority
            links_to_analyze.extend(request.inspiration_links)
            print(f"📎 Using {len(request.inspiration_links)} user-provided inspiration link(s)")
        elif auto_selected_inspirations:
            # Use auto-selected inspirations if no user-provided ones
            links_to_analyze.extend([insp['url'] for insp in auto_selected_inspirations])
            print(f"📎 Using {len(auto_selected_inspirations)} auto-selected inspiration link(s) from category")
        if context.get('selected_link'):
            links_to_analyze.append(context['selected_link'])
        
        if links_to_analyze:
            await update_progress_in_db(request.account_id, 25, "Analyzing inspiration links...", generation_uuid)
            # Pass clips_per_video to determine how much of the inspiration video to analyze
            clips_per_video = request.clips_per_video if hasattr(request, 'clips_per_video') and request.clips_per_video else 1
            
            # Calculate total posts to generate for random selection of inspirations
            num_images = request.number_of_images if hasattr(request, 'number_of_images') and request.number_of_images else 0
            num_videos = request.number_of_videos if hasattr(request, 'number_of_videos') and request.number_of_videos else 0
            total_posts_to_generate = num_images + num_videos
            
            # Wrap inspiration analysis in try-except to ensure content generation continues even if analysis fails
            try:
                link_analysis = await analyze_inspiration_links(links_to_analyze, context, request.account_id, clips_per_video, total_posts_to_generate)
                context["link_analysis"] = link_analysis
                
                if not link_analysis or (not link_analysis.get("video_inspiration") and not link_analysis.get("image_inspiration") and not link_analysis.get("analysis")):
                    print("⚠️ Inspiration link analysis returned no results - continuing without inspiration")
            except Exception as e:
                print(f"⚠️ Inspiration link analysis failed: {e}")
                print(f"   Continuing with content generation without inspiration analysis...")
                import traceback
                print(f"   {traceback.format_exc()}")
                context["link_analysis"] = {}  # Set empty dict to avoid KeyError downstream
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
                    "clips_per_video": prompts.get("clips_per_video", 1),
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


# ============================================
# INSPIRATION ANALYSIS ENDPOINT
# ============================================

class InspirationAnalysisRequest(BaseModel):
    """Request model for single inspiration link analysis"""
    url: str = Field(..., description="URL of the inspiration link to analyze")
    media_type: Optional[str] = Field(None, description="Media type: 'image' or 'video' (optional, will be auto-detected)")
    platform: Optional[str] = Field(None, description="Platform: 'youtube', 'instagram', 'twitter', 'tiktok', 'custom' (optional)")


class InspirationAnalysisResponse(BaseModel):
    """Response model for inspiration analysis"""
    success: bool
    analysis: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/analyze-inspiration", response_model=InspirationAnalysisResponse)
async def analyze_single_inspiration(request: InspirationAnalysisRequest):
    """
    Analyze a single inspiration link using Grok LLM.
    
    This endpoint:
    - Downloads and processes video/image from the link
    - Analyzes with Grok (video frames + transcript OR images OR web search)
    - Returns the analysis result as JSON
    
    Used by admin dashboard to pre-analyze inspirations when they are added.
    """
    try:
        url = request.url.strip()
        if not url:
            return InspirationAnalysisResponse(
                success=False,
                error="URL is required"
            )
        
        logger.info(f"🔗 Analyzing inspiration link: {url[:80]}...")
        
        # Create minimal context (no account-specific info needed for analysis)
        minimal_context = {
            'dvyb_context': {
                'accountName': 'brand',  # Generic placeholder
            }
        }
        
        # Use a dummy account_id for S3 paths (admin analysis doesn't need real account)
        # We'll use 0 as a placeholder
        account_id = 0
        
        # Check if URL is a direct media file (S3 URLs, CDN URLs, etc.)
        # by checking file extension
        import re
        from urllib.parse import urlparse
        
        url_lower = url.lower()
        parsed_url = urlparse(url)
        path_lower = parsed_url.path.lower()
        
        # Image extensions
        image_extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
        is_direct_image = any(path_lower.endswith(ext) for ext in image_extensions)
        
        # Video extensions
        video_extensions = ['.mp4', '.webm', '.mpeg', '.mov', '.avi', '.mkv']
        is_direct_video = any(path_lower.endswith(ext) for ext in video_extensions)
        
        # Determine if it's a video platform URL (YouTube, Instagram, Twitter)
        is_video_platform = is_video_platform_url(url)
        
        result = {}
        
        # Process direct media files (S3 URLs, CDN URLs, etc.)
        if is_direct_image:
            logger.info(f"🖼️ Processing as direct image file (S3/CDN URL)...")
            image_analysis = await process_image_inspiration_link(url, minimal_context, account_id)
            if image_analysis:
                result["image_inspiration"] = image_analysis
                logger.info(f"✅ Direct image analysis complete")
            else:
                logger.warn(f"⚠️ Direct image analysis failed")
        elif is_direct_video:
            logger.info(f"🎬 Processing as direct video file (S3/CDN URL)...")
            video_analysis = await process_video_inspiration_link(url, minimal_context, account_id, clips_per_video=1)
            if video_analysis:
                result["video_inspiration"] = video_analysis
                logger.info(f"✅ Direct video analysis complete")
            else:
                logger.warn(f"⚠️ Direct video analysis failed")
        # Process video/image platform links (YouTube, Instagram, Twitter)
        elif is_video_platform:
            logger.info(f"🎬 Processing as video/image platform link...")
            
            # Try video first
            video_analysis = await process_video_inspiration_link(url, minimal_context, account_id, clips_per_video=1)
            if video_analysis:
                result["video_inspiration"] = video_analysis
                logger.info(f"✅ Video inspiration analysis complete")
            else:
                # If video processing failed, try as image
                logger.info(f"📸 Video processing failed, trying as image inspiration...")
                image_analysis = await process_image_inspiration_link(url, minimal_context, account_id)
                if image_analysis:
                    result["image_inspiration"] = image_analysis
                    logger.info(f"✅ Image inspiration analysis complete")
        else:
            # Process regular links with Grok live search
            logger.info(f"🌐 Processing as regular web link with Grok live search...")
            
            from xai_sdk import Client
            from xai_sdk.chat import user, system
            from xai_sdk.search import SearchParameters, web_source
            from urllib.parse import urlparse
            
            # Extract domain for Grok web_source filtering
            try:
                parsed = urlparse(url)
                domain = parsed.netloc or parsed.path.split('/')[0]
                allowed_websites = [domain] if domain else []
            except Exception as e:
                logger.warning(f"⚠️ Could not parse URL {url}: {e}")
                allowed_websites = []
            
            if not allowed_websites:
                return InspirationAnalysisResponse(
                    success=False,
                    error="Could not extract domain from URL"
                )
            
            # Get Grok API key
            grok_api_key = settings.xai_api_key
            if not grok_api_key:
                return InspirationAnalysisResponse(
                    success=False,
                    error="Grok API key not configured"
                )
            
            # Initialize Grok client
            client = Client(api_key=grok_api_key, timeout=3600)
            
            # Create chat with web_source search parameters
            chat = client.chat.create(
                model="grok-4-latest",
                search_parameters=SearchParameters(
                    mode="auto",
                    sources=[web_source(allowed_websites=allowed_websites)]
                ),
            )
            
            system_prompt = """You are a web content analyzer for brand marketing research. Extract and summarize key information from the specified website.

Focus on:
- Key features, products, or services
- Important metrics, statistics, or data points
- Design styles, aesthetics, or visual elements
- Content strategies or messaging approaches
- Any unique or notable characteristics
- Brand positioning and messaging

Return a comprehensive summary of insights that can be used for content generation."""
            
            user_prompt = f"""Please gather comprehensive information from this website:
{url}

Extract and summarize:
1. Key features, products, or services
2. Important metrics, statistics, or data points
3. Design styles, aesthetics, or visual elements
4. Content strategies or messaging approaches
5. Any unique or notable characteristics

Return a concise summary of insights."""
            
            chat.append(system(system_prompt))
            chat.append(user(user_prompt))
            
            logger.info("🔄 Calling Grok for web context...")
            response = chat.sample()
            
            link_analysis_text = response.content.strip()
            
            if not link_analysis_text:
                return InspirationAnalysisResponse(
                    success=False,
                    error="Empty response from Grok live search"
                )
            
            logger.info("✅ Grok live search completed successfully")
            
            # Handle potential markdown in response
            import re
            
            # Remove markdown formatting if present
            cleaned_text = link_analysis_text
            cleaned_text = re.sub(r'```[\s\S]*?```', '', cleaned_text)
            cleaned_text = re.sub(r'#{1,6}\s+', '', cleaned_text)
            cleaned_text = re.sub(r'\*\*([^\*]+)\*\*', r'\1', cleaned_text)
            cleaned_text = re.sub(r'\*([^\*]+)\*', r'\1', cleaned_text)
            cleaned_text = re.sub(r'__([^_]+)__', r'\1', cleaned_text)
            cleaned_text = re.sub(r'_([^_]+)_', r'\1', cleaned_text)
            cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text).strip()
            
            result["summary"] = cleaned_text
            result["raw_summary"] = link_analysis_text
        
        if not result:
            return InspirationAnalysisResponse(
                success=False,
                error="No analysis result generated"
            )
        
        logger.info(f"✅ Inspiration analysis complete for: {url[:80]}...")
        
        return InspirationAnalysisResponse(
            success=True,
            analysis=result
        )
        
    except Exception as e:
        logger.error(f"❌ Inspiration analysis failed: {e}")
        import traceback
        logger.error(f"   {traceback.format_exc()}")
        return InspirationAnalysisResponse(
            success=False,
            error=str(e)
        )

