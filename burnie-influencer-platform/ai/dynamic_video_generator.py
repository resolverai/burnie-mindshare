"""
AI-Powered Dynamic Image to Video Converter
Creates scroll-stopping videos with cinematic effects driven by Grok-4-latest vision analysis

Usage:
    python dynamic_video_generator.py --image /path/to/image.png --duration 6 --aspect-ratio 9:16 --instructions "Focus on the product, then highlight the price"

Requirements:
    pip install moviepy pillow numpy xai-sdk requests
"""

import os
import sys
import json
import argparse
import re
import requests
import base64
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from difflib import SequenceMatcher

from moviepy.editor import ImageClip, CompositeVideoClip, ColorClip
from moviepy.video.fx import resize, crop
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

# Load environment variables from python-ai-backend/.env
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

# Get Google API key for Vision API
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


# ============================================
# GOOGLE VISION API - OCR TEXT DETECTION
# ============================================

def find_text_with_google_vision(
    image_path: str,
    search_text: str
) -> Optional[Tuple[float, float, float, float]]:
    """
    Use Google Vision API to find text in an image and return its bounding box.
    
    Args:
        image_path: Path to the image file
        search_text: The text to search for
        
    Returns:
        Tuple of (left_pct, top_pct, right_pct, bottom_pct) or None if not found
    """
    if not GOOGLE_API_KEY:
        print(f"  ⚠️ GOOGLE_API_KEY not set in python-ai-backend/.env")
        return None
    
    print(f"\n{'='*60}")
    print(f"🔍 GOOGLE VISION API - TEXT DETECTION")
    print(f"{'='*60}")
    print(f"  Image: {image_path}")
    print(f"  Searching for: '{search_text[:60]}{'...' if len(search_text) > 60 else ''}'")
    
    try:
        # Load image and get dimensions
        img = Image.open(image_path)
        img_width, img_height = img.size
        print(f"  Image size: {img_width}x{img_height}")
        
        # Encode image to base64
        with open(image_path, "rb") as f:
            image_content = base64.b64encode(f.read()).decode('utf-8')
        
        # Call Google Vision API
        print(f"  📤 Calling Google Vision API...")
        url = f"https://vision.googleapis.com/v1/images:annotate?key={GOOGLE_API_KEY}"
        
        payload = {
            "requests": [{
                "image": {"content": image_content},
                "features": [{"type": "TEXT_DETECTION", "maxResults": 50}]
            }]
        }
        
        response = requests.post(url, json=payload, timeout=30)
        
        if response.status_code != 200:
            print(f"  ❌ API Error: {response.status_code}")
            print(f"     {response.text[:200]}")
            return None
        
        result = response.json()
        
        # Check for errors in response
        if "error" in result:
            print(f"  ❌ Vision API Error: {result['error'].get('message', 'Unknown error')}")
            return None
        
        # Get text annotations
        responses = result.get("responses", [])
        if not responses or not responses[0].get("textAnnotations"):
            print(f"  ⚠️ No text detected in image")
            return None
        
        text_annotations = responses[0]["textAnnotations"]
        print(f"  ✅ Found {len(text_annotations)} text regions")
        
        # First annotation is the full text, skip it
        # Rest are individual words/lines with bounding boxes
        detected_texts = []
        for annotation in text_annotations[1:]:  # Skip first (full text)
            text = annotation.get("description", "")
            vertices = annotation.get("boundingPoly", {}).get("vertices", [])
            
            if vertices and len(vertices) >= 4:
                # Get bounding box coordinates
                x_coords = [v.get("x", 0) for v in vertices]
                y_coords = [v.get("y", 0) for v in vertices]
                
                bbox = {
                    "text": text,
                    "left": min(x_coords),
                    "top": min(y_coords),
                    "right": max(x_coords),
                    "bottom": max(y_coords)
                }
                detected_texts.append(bbox)
        
        # Normalize search text for matching
        search_normalized = search_text.lower().strip()
        search_words = search_normalized.split()
        
        print(f"  🔎 Searching for text match...")
        
        # Strategy 1: Find consecutive words that form the search text
        # Build a map of word positions
        word_boxes = []
        for dt in detected_texts:
            word_boxes.append({
                "word": dt["text"].lower().strip(),
                "bbox": dt
            })
        
        # Try to find the sequence of words
        best_match_boxes = []
        best_match_score = 0
        
        # Max vertical span for matching text (prevents combining scattered matches)
        max_vertical_span = img_height * 0.25  # Max 25% of image height
        
        # Look for starting words
        for i, wb in enumerate(word_boxes):
            if wb["word"] in search_words or any(sw.startswith(wb["word"]) or wb["word"].startswith(sw) for sw in search_words):
                # Try to build a match from this position
                match_boxes = [wb["bbox"]]
                combined_text = wb["word"]
                start_y = wb["bbox"]["top"]
                
                for j in range(i + 1, min(i + len(search_words) * 2, len(word_boxes))):
                    next_wb = word_boxes[j]
                    
                    # Check vertical proximity - don't combine words too far apart vertically
                    current_y = next_wb["bbox"]["top"]
                    if abs(current_y - start_y) > max_vertical_span:
                        break  # Word is too far vertically, stop matching
                    
                    # Check if this word continues the sequence
                    combined_text += " " + next_wb["word"]
                    match_boxes.append(next_wb["bbox"])
                    
                    # Calculate similarity
                    similarity = SequenceMatcher(None, search_normalized, combined_text).ratio()
                    
                    if similarity > best_match_score:
                        best_match_score = similarity
                        best_match_boxes = list(match_boxes)
                    
                    # If we have a very good match, stop
                    if similarity > 0.85:
                        break
        
        # Strategy 2: If no good sequential match, find lines containing key words
        if best_match_score < 0.5:
            # Group words by vertical position (same line)
            lines = {}
            for dt in detected_texts:
                # Round to nearest 20 pixels for line grouping
                line_y = round(dt["top"] / 20) * 20
                if line_y not in lines:
                    lines[line_y] = []
                lines[line_y].append(dt)
            
            # Sort lines by y position
            sorted_lines = sorted(lines.items())
            
            # Find lines containing search words
            matching_lines = []
            for line_y, line_words in sorted_lines:
                line_text = " ".join([w["text"].lower() for w in line_words])
                # Check if this line contains significant words from search
                word_matches = sum(1 for sw in search_words if sw in line_text)
                if word_matches >= min(3, len(search_words) // 2):
                    matching_lines.append((line_y, line_words, word_matches))
            
            if matching_lines:
                # IMPORTANT: Only combine CONSECUTIVE lines that are close together
                # This prevents combining scattered matches across the entire image
                max_line_gap = 80  # Max pixels between lines to be considered part of same block
                
                # Find the best cluster of consecutive matching lines
                best_cluster = []
                best_cluster_score = 0
                
                for start_idx in range(len(matching_lines)):
                    cluster = [matching_lines[start_idx]]
                    cluster_y = matching_lines[start_idx][0]
                    
                    for next_idx in range(start_idx + 1, len(matching_lines)):
                        next_y = matching_lines[next_idx][0]
                        # Only add if close to previous line
                        if next_y - cluster_y <= max_line_gap:
                            cluster.append(matching_lines[next_idx])
                            cluster_y = next_y
                        else:
                            break  # Gap too large, stop this cluster
                    
                    # Score this cluster by total word matches
                    cluster_score = sum(m[2] for m in cluster)
                    if cluster_score > best_cluster_score:
                        best_cluster_score = cluster_score
                        best_cluster = cluster
                
                if best_cluster:
                    # Combine only the lines in the best cluster
                    all_boxes = []
                    for _, line_words, _ in best_cluster:
                        all_boxes.extend(line_words)
                    
                    if all_boxes:
                        combined_text = " ".join([w["text"].lower() for w in all_boxes])
                        similarity = SequenceMatcher(None, search_normalized, combined_text).ratio()
                        
                        if similarity > best_match_score:
                            best_match_score = similarity
                            best_match_boxes = all_boxes
        
        if best_match_boxes and best_match_score > 0.3:
            # Calculate combined bounding box
            left = min(b["left"] for b in best_match_boxes)
            top = min(b["top"] for b in best_match_boxes)
            right = max(b["right"] for b in best_match_boxes)
            bottom = max(b["bottom"] for b in best_match_boxes)
            
            # Convert to percentages
            left_pct = (left / img_width) * 100
            top_pct = (top / img_height) * 100
            right_pct = (right / img_width) * 100
            bottom_pct = (bottom / img_height) * 100
            
            # Add small padding (2%)
            padding = 2.0
            left_pct = max(0, left_pct - padding)
            top_pct = max(0, top_pct - padding)
            right_pct = min(100, right_pct + padding)
            bottom_pct = min(100, bottom_pct + padding)
            
            matched_text = " ".join([b["text"] for b in best_match_boxes])
            print(f"  ✅ Found match (score: {best_match_score:.2f})")
            print(f"     Matched text: '{matched_text[:60]}{'...' if len(matched_text) > 60 else ''}'")
            print(f"  📍 Bounding box: ({left_pct:.1f}%, {top_pct:.1f}%) to ({right_pct:.1f}%, {bottom_pct:.1f}%)")
            print(f"     Pixels: ({left}, {top}) to ({right}, {bottom})")
            
            return (left_pct, top_pct, right_pct, bottom_pct)
        else:
            print(f"  ⚠️ Could not find matching text (best score: {best_match_score:.2f})")
            # Print detected texts for debugging
            if detected_texts:
                print(f"     Detected words: {[dt['text'] for dt in detected_texts[:20]]}")
            return None
            
    except requests.exceptions.Timeout:
        print(f"  ❌ Google Vision API timeout")
        return None
    except requests.exceptions.RequestException as e:
        print(f"  ❌ Network error: {e}")
        return None
    except Exception as e:
        print(f"  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None


def find_text_in_multiple_folds_with_vision(
    fold_image_paths: List[str],
    search_text: str
) -> Tuple[Optional[str], Optional[Tuple[float, float, float, float]]]:
    """
    Search for text across multiple fold images using Google Vision API.
    
    Args:
        fold_image_paths: List of paths to fold images
        search_text: Text to search for
        
    Returns:
        Tuple of (image_path, bounding_box) or (None, None) if not found
    """
    print(f"\n{'='*60}")
    print(f"🔍 SEARCHING ACROSS {len(fold_image_paths)} FOLDS")
    print(f"{'='*60}")
    print(f"  Target: '{search_text[:60]}{'...' if len(search_text) > 60 else ''}'")
    
    for i, img_path in enumerate(fold_image_paths):
        print(f"\n  📄 Checking fold {i+1}: {Path(img_path).name}")
        
        bbox = find_text_with_google_vision(img_path, search_text)
        
        if bbox:
            print(f"\n  ✅ Text found in fold {i+1}!")
            return (img_path, bbox)
    
    print(f"\n  ⚠️ Text not found in any fold")
    return (None, None)


# ============================================
# EFFECT DEFINITIONS - Bouquet of Effects
# ============================================

EFFECTS_CATALOG = {
    "zoom_in": {
        "name": "Zoom In",
        "description": "Gradually zooms into a specific rectangular region of the image. Creates focus and draws attention to important elements.",
        "parameters": {
        "region": "Bounding box of the focus area - REQUIRED",
        "region.left_pct": "Left edge of region (0-100, percentage from left)",
        "region.top_pct": "Top edge of region (0-100, percentage from top)",
        "region.right_pct": "Right edge of region (0-100, percentage from left)",
        "region.bottom_pct": "Bottom edge of region (0-100, percentage from top)",
        "zoom_start": "Starting zoom level (1.0 = no zoom)",
        "zoom_end": "Ending zoom level (e.g., 1.5 = 50% zoomed in)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "zoom_out": {
        "name": "Zoom Out",
        "description": "Gradually zooms out from a specific rectangular region, revealing more of the image. Good for reveal moments.",
        "parameters": {
        "region": "Bounding box of the focus area - REQUIRED",
        "region.left_pct": "Left edge of region (0-100, percentage from left)",
        "region.top_pct": "Top edge of region (0-100, percentage from top)",
        "region.right_pct": "Right edge of region (0-100, percentage from left)",
        "region.bottom_pct": "Bottom edge of region (0-100, percentage from top)",
        "zoom_start": "Starting zoom level (e.g., 1.5 = start zoomed in)",
        "zoom_end": "Ending zoom level (1.0 = no zoom)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "pan": {
        "name": "Pan",
        "description": "Smoothly pans from one rectangular region to another. Great for showing progression or comparison between two areas.",
        "parameters": {
        "start_region": "Starting bounding box - REQUIRED",
        "start_region.left_pct": "Left edge of start region (0-100)",
        "start_region.top_pct": "Top edge of start region (0-100)",
        "start_region.right_pct": "Right edge of start region (0-100)",
        "start_region.bottom_pct": "Bottom edge of start region (0-100)",
        "end_region": "Ending bounding box - REQUIRED",
        "end_region.left_pct": "Left edge of end region (0-100)",
        "end_region.top_pct": "Top edge of end region (0-100)",
        "end_region.right_pct": "Right edge of end region (0-100)",
        "end_region.bottom_pct": "Bottom edge of end region (0-100)",
        "zoom_level": "Zoom level during pan (1.0 = no zoom, higher = more zoomed)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "highlight_spotlight": {
        "name": "Highlight Spotlight",
        "description": "Darkens the image except for a highlighted rectangular area, drawing attention to it with optional pulsing effect.",
        "parameters": {
        "region": "Bounding box of the highlighted area - REQUIRED",
        "region.left_pct": "Left edge of highlight (0-100, percentage from left)",
        "region.top_pct": "Top edge of highlight (0-100, percentage from top)",
        "region.right_pct": "Right edge of highlight (0-100, percentage from left)",
        "region.bottom_pct": "Bottom edge of highlight (0-100, percentage from top)",
        "darkness": "How dark the surrounding area is (0.0-1.0, higher = darker)",
        "pulse": "Whether to pulse the highlight (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "ken_burns": {
        "name": "Ken Burns Effect",
        "description": "Classic documentary-style effect combining slow zoom with subtle pan from one region to another. Creates cinematic movement.",
        "parameters": {
        "start_region": "Starting focus bounding box - REQUIRED",
        "start_region.left_pct": "Left edge of start region (0-100)",
        "start_region.top_pct": "Top edge of start region (0-100)",
        "start_region.right_pct": "Right edge of start region (0-100)",
        "start_region.bottom_pct": "Bottom edge of start region (0-100)",
        "end_region": "Ending focus bounding box - REQUIRED",
        "end_region.left_pct": "Left edge of end region (0-100)",
        "end_region.top_pct": "Top edge of end region (0-100)",
        "end_region.right_pct": "Right edge of end region (0-100)",
        "end_region.bottom_pct": "Bottom edge of end region (0-100)",
        "zoom_start": "Starting zoom level",
        "zoom_end": "Ending zoom level",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "shake": {
        "name": "Shake/Vibrate",
        "description": "Adds a shake or vibration effect to emphasize impact or urgency. Use sparingly for dramatic moments.",
        "parameters": {
        "intensity": "Shake intensity (1-10, where 10 is most intense)",
        "frequency": "Shakes per second",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "fade_vignette": {
        "name": "Fade Vignette",
        "description": "Adds or animates a vignette (darkened edges) to focus attention on a specific rectangular area.",
        "parameters": {
        "region": "Bounding box of the vignette focus area - REQUIRED",
        "region.left_pct": "Left edge of focus region (0-100)",
        "region.top_pct": "Top edge of focus region (0-100)",
        "region.right_pct": "Right edge of focus region (0-100)",
        "region.bottom_pct": "Bottom edge of focus region (0-100)",
        "intensity_start": "Starting vignette intensity (0.0-1.0)",
        "intensity_end": "Ending vignette intensity (0.0-1.0)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "brightness_pulse": {
        "name": "Brightness Pulse",
        "description": "Pulses brightness on a specific rectangular area to draw attention. Good for highlighting text or key elements.",
        "parameters": {
        "region": "Bounding box of the area to brighten - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "pulse_intensity": "How much to brighten (0.1-0.5 recommended)",
        "pulse_speed": "Pulses per second",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "zoom_pulse": {
        "name": "Zoom Pulse",
        "description": "Quick zoom in and out on a rectangular region to create emphasis, like a heartbeat effect. Great for impactful moments.",
        "parameters": {
        "region": "Bounding box of the pulse focus area - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "pulse_scale": "How much to zoom during pulse (e.g., 1.1 = 10% zoom)",
        "pulse_count": "Number of pulses",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "reveal_wipe": {
        "name": "Reveal Wipe",
        "description": "Reveals content with a directional wipe effect. Good for before/after comparisons.",
        "parameters": {
        "direction": "Wipe direction: left_to_right, right_to_left, top_to_bottom, bottom_to_top",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    
    # ===== NEW SOCIAL MEDIA EFFECTS =====
    
    "glitch": {
        "name": "Glitch Effect",
        "description": "Digital glitch distortion with RGB shift and scan lines. Very popular on TikTok for dramatic/edgy moments.",
        "parameters": {
        "intensity": "Glitch intensity (1-10, where 10 is most intense)",
        "glitch_frequency": "How often glitches occur per second (1-10)",
        "rgb_shift": "Whether to include RGB color channel splitting (true/false)",
        "scan_lines": "Whether to include horizontal scan lines (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "rgb_split": {
        "name": "RGB Split / Chromatic Aberration",
        "description": "Splits RGB color channels creating a trendy chromatic aberration effect. Popular for retro/vaporwave aesthetics.",
        "parameters": {
        "region": "Bounding box where effect is strongest - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "offset": "Pixel offset for RGB channels (5-30 recommended)",
        "direction": "Split direction: horizontal, vertical, diagonal",
        "animate": "Whether to animate the split (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "flash": {
        "name": "Flash / Strobe",
        "description": "Quick white or colored flash for transitions and emphasis. Creates impactful beat-sync moments.",
        "parameters": {
        "color": "Flash color: white, red, blue, yellow, or hex code",
        "flash_count": "Number of flashes (1-5)",
        "intensity": "Flash brightness (0.5-1.0)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "blur_transition": {
        "name": "Blur Transition",
        "description": "Smoothly blurs in or out. Great for dreamy transitions or focus shifts.",
        "parameters": {
        "blur_start": "Starting blur radius (0 = sharp, 20 = very blurry)",
        "blur_end": "Ending blur radius (0 = sharp, 20 = very blurry)",
        "region": "Optional region to apply blur - if not set, applies to whole image",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "letterbox": {
        "name": "Cinematic Letterbox",
        "description": "Adds animated cinematic black bars (letterbox) for dramatic film-like feel.",
        "parameters": {
        "bar_height_pct": "Height of each bar as percentage of image (5-15 recommended)",
        "animate_in": "Whether bars animate in (true) or appear instantly (false)",
        "color": "Bar color: black, white, or hex code",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "color_shift": {
        "name": "Color Grade Shift",
        "description": "Transitions between color grades/filters. Great for mood changes or before/after reveals.",
        "parameters": {
        "from_grade": "Starting color grade: normal, warm, cool, vintage, high_contrast, desaturated, sepia, cyberpunk, golden_hour",
        "to_grade": "Ending color grade: normal, warm, cool, vintage, high_contrast, desaturated, sepia, cyberpunk, golden_hour",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "saturation_pulse": {
        "name": "Saturation Pulse",
        "description": "Pulses color saturation for vibrant, attention-grabbing moments.",
        "parameters": {
        "region": "Bounding box for saturation pulse - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "saturation_boost": "How much to boost saturation (1.2-2.0 recommended)",
        "pulse_speed": "Pulses per second",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "contrast_boost": {
        "name": "Dynamic Contrast",
        "description": "Dramatically increases contrast for punchy, bold visuals. Great for reveals.",
        "parameters": {
        "contrast_start": "Starting contrast (1.0 = normal, 1.5 = high contrast)",
        "contrast_end": "Ending contrast (1.0 = normal, 1.5 = high contrast)",
        "region": "Optional region to apply contrast boost",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "film_grain": {
        "name": "Film Grain",
        "description": "Adds vintage film grain texture for nostalgic, cinematic feel.",
        "parameters": {
        "grain_intensity": "Grain intensity (0.1-0.5, where 0.5 is very grainy)",
        "grain_size": "Size of grain particles (1-3)",
        "animated": "Whether grain animates/moves (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "radial_blur": {
        "name": "Radial Blur / Zoom Blur",
        "description": "Motion blur radiating from a center point. Creates sense of speed or impact.",
        "parameters": {
        "region": "Bounding box for blur center - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "blur_amount": "Blur intensity (5-30)",
        "direction": "Blur direction: zoom_in, zoom_out, spin",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "bounce_zoom": {
        "name": "Bounce/Elastic Zoom",
        "description": "Zoom with elastic bounce-back effect. Fun, energetic feel popular on social media.",
        "parameters": {
        "region": "Bounding box for zoom focus - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "zoom_amount": "How much to zoom (1.2-1.5 recommended)",
        "bounce_count": "Number of bounces (2-4 recommended)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "tilt": {
        "name": "Tilt / Rotation",
        "description": "Subtle rotation/tilt for dynamic, energetic feel. Great for music-synced content.",
        "parameters": {
        "angle_start": "Starting rotation angle in degrees (-15 to 15)",
        "angle_end": "Ending rotation angle in degrees (-15 to 15)",
        "oscillate": "Whether to oscillate back and forth (true/false)",
        "oscillate_speed": "Oscillations per second if oscillating",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "mirror": {
        "name": "Mirror Effect",
        "description": "Creates mirror/reflection effect. Can be horizontal, vertical, or kaleidoscope.",
        "parameters": {
        "mirror_type": "Type: horizontal, vertical, quad, kaleidoscope",
        "mirror_position_pct": "Where to place mirror line (0-100)",
        "animate": "Whether to animate mirror position (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "pixelate": {
        "name": "Pixelate",
        "description": "Pixelation effect that can animate from clear to pixelated or vice versa. Good for reveals or censoring.",
        "parameters": {
        "region": "Bounding box for pixelation - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "pixel_size_start": "Starting pixel size (1 = no pixelation, 50 = very pixelated)",
        "pixel_size_end": "Ending pixel size",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "wave_distortion": {
        "name": "Wave / Ripple Distortion",
        "description": "Wavy ripple distortion effect. Creates dreamy, underwater, or glitchy feel.",
        "parameters": {
        "wave_amplitude": "Height of waves (5-30 pixels)",
        "wave_frequency": "Number of waves across image (2-10)",
        "wave_speed": "How fast waves move (1-5)",
        "direction": "Wave direction: horizontal, vertical, circular",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "edge_glow": {
        "name": "Edge Glow / Neon Outline",
        "description": "Adds glowing edges to objects in the image. Creates neon, cyberpunk aesthetic.",
        "parameters": {
        "glow_color": "Glow color: cyan, magenta, yellow, white, or hex code",
        "glow_intensity": "Glow brightness (0.5-2.0)",
        "glow_size": "Glow spread in pixels (2-10)",
        "pulse": "Whether glow pulses (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "double_exposure": {
        "name": "Double Exposure / Ghost",
        "description": "Creates ghosting/echo effect by overlaying offset copies. Trippy, artistic feel.",
        "parameters": {
        "offset_x_pct": "Horizontal offset for ghost (0-20)",
        "offset_y_pct": "Vertical offset for ghost (0-20)",
        "ghost_opacity": "Opacity of ghost layer (0.2-0.6)",
        "ghost_count": "Number of ghost layers (1-3)",
        "animate": "Whether to animate ghost movement (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "light_leak": {
        "name": "Light Leak",
        "description": "Vintage light leak overlay for warm, nostalgic film look.",
        "parameters": {
        "leak_color": "Light leak color: warm, cool, rainbow, orange, pink",
        "leak_position": "Where leak appears: top_left, top_right, bottom_left, bottom_right, random",
        "leak_intensity": "How strong the leak is (0.2-0.6)",
        "animate": "Whether leak animates/moves (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "focus_rack": {
        "name": "Focus Rack / Depth of Field",
        "description": "Simulates camera focus change from one region to another. Creates professional cinematic look.",
        "parameters": {
        "start_region": "Initially focused region - REQUIRED",
        "start_region.left_pct": "Left edge (0-100)",
        "start_region.top_pct": "Top edge (0-100)",
        "start_region.right_pct": "Right edge (0-100)",
        "start_region.bottom_pct": "Bottom edge (0-100)",
        "end_region": "Finally focused region - REQUIRED",
        "end_region.left_pct": "Left edge (0-100)",
        "end_region.top_pct": "Top edge (0-100)",
        "end_region.right_pct": "Right edge (0-100)",
        "end_region.bottom_pct": "Bottom edge (0-100)",
        "blur_amount": "How blurry unfocused areas are (5-20)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "speed_lines": {
        "name": "Speed Lines / Action Lines",
        "description": "Anime-style speed/action lines radiating from a point. Great for impact moments.",
        "parameters": {
        "region": "Bounding box for speed lines center - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "line_count": "Number of lines (10-50)",
        "line_color": "Line color: white, black, or hex code",
        "line_opacity": "Line opacity (0.3-0.8)",
        "animate": "Whether lines animate (true/false)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "color_pop": {
        "name": "Color Pop / Selective Color",
        "description": "Desaturates everything except a specific region, making it 'pop' with color. Very eye-catching.",
        "parameters": {
        "region": "Bounding box of area to keep colorful - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "desaturation": "How desaturated the rest is (0.0-1.0, where 1.0 is fully grayscale)",
        "feather": "Edge softness (0-50 pixels)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "zoom_whip": {
        "name": "Zoom Whip / Crash Zoom",
        "description": "Ultra-fast zoom for dramatic impact. Creates 'whoosh' feeling without motion blur.",
        "parameters": {
        "region": "Bounding box of zoom target - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "zoom_amount": "How much to zoom (1.5-3.0 for dramatic effect)",
        "ease_type": "Easing: linear, ease_in, ease_out, ease_in_out, bounce",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds, 0.2-0.5 for whip effect)"
        }
    },
    "split_screen": {
        "name": "Split Screen Reveal",
        "description": "Reveals image in split sections. Great for comparisons or dramatic reveals.",
        "parameters": {
        "split_type": "Type: horizontal, vertical, diagonal, quad, radial",
        "reveal_order": "Order: sequential, simultaneous, random",
        "gap_pixels": "Gap between splits (0-10 pixels)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "heartbeat": {
        "name": "Heartbeat / Throb",
        "description": "Rhythmic zoom pulse that mimics a heartbeat. Creates tension and urgency.",
        "parameters": {
        "region": "Bounding box for heartbeat center - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "bpm": "Beats per minute (60-120 for realistic, higher for intense)",
        "intensity": "How much to zoom on each beat (1.02-1.1)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "particle_overlay": {
        "name": "Particle Overlay",
        "description": "Floating particles like dust, sparkles, or snow. Adds atmosphere and magic.",
        "parameters": {
        "particle_type": "Type: dust, sparkle, snow, rain, confetti, hearts, fire_embers",
        "particle_count": "Number of particles (20-100)",
        "particle_size": "Size of particles (2-10 pixels)",
        "particle_speed": "How fast particles move (1-10)",
        "particle_opacity": "Particle opacity (0.3-0.8)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "text_reveal_area": {
        "name": "Text/Element Reveal",
        "description": "Highlights a region where text or important element should be noticed, with animated reveal.",
        "parameters": {
        "region": "Bounding box of text/element - REQUIRED",
        "region.left_pct": "Left edge of region (0-100)",
        "region.top_pct": "Top edge of region (0-100)",
        "region.right_pct": "Right edge of region (0-100)",
        "region.bottom_pct": "Bottom edge of region (0-100)",
        "reveal_type": "Type: fade_in, slide_in, zoom_in, typewriter, glow",
        "highlight_color": "Optional highlight color behind text",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    },
    "highlight_overlay": {
        "name": "Highlight Overlay",
        "description": "Adds a colored semi-transparent overlay on a specific region to highlight it. Great for drawing attention to text, prices, or key elements.",
        "parameters": {
        "region": "Bounding box of area to highlight - REQUIRED",
        "region.left_pct": "Left edge of region (0-100, percentage from left)",
        "region.top_pct": "Top edge of region (0-100, percentage from top)",
        "region.right_pct": "Right edge of region (0-100, percentage from left)",
        "region.bottom_pct": "Bottom edge of region (0-100, percentage from top)",
        "color": "Highlight color: yellow, red, green, blue, orange, pink, cyan, white, or hex code (default: yellow)",
        "alpha": "Opacity of the highlight (0.0-1.0, default: 0.7)",
        "feather": "Edge softness in pixels (0-50, default: 0 for sharp edges)",
        "pulse": "Whether to pulse the highlight opacity (true/false, default: false)",
        "pulse_speed": "Pulses per second if pulsing (default: 2)",
        "fade_in": "Whether to fade in the highlight (true/false, default: false)",
        "fade_in_duration": "Fade in duration in seconds (default: 0.3)",
        "start_time": "When effect starts (seconds)",
        "duration": "How long the effect lasts (seconds)"
        }
    }
}


# ============================================
# ASPECT RATIO CONFIGURATIONS
# ============================================

ASPECT_RATIOS = {
    "9:16": (1080, 1920),   # TikTok, Reels, Shorts (Portrait)
    "16:9": (1920, 1080),   # YouTube, Landscape
    "1:1": (1080, 1080),    # Instagram Square
    "4:5": (1080, 1350),    # Instagram Portrait
    "4:3": (1440, 1080),    # Traditional
}


# ============================================
# EFFECT IMPLEMENTATION FUNCTIONS
# ============================================

def ease_in_out(t: float) -> float:
    """Smooth easing function for animations"""
    return t * t * (3 - 2 * t)


def linear_interpolate(start: float, end: float, progress: float) -> float:
    """Linear interpolation with easing"""
    eased_progress = ease_in_out(progress)
    return start + (end - start) * eased_progress


def extract_region(effect: Dict, region_key: str = "region") -> Tuple[float, float, float, float]:
    """
    Extract bounding box from effect dict.
    Returns (left_pct, top_pct, right_pct, bottom_pct)
    Supports both nested region object and flat parameters for backwards compatibility.
    """
    region = effect.get(region_key, {})
    
    if isinstance(region, dict) and region:
        # New format: nested region object
        left = region.get("left_pct", 25)
        top = region.get("top_pct", 25)
        right = region.get("right_pct", 75)
        bottom = region.get("bottom_pct", 75)
    else:
        # Backwards compatibility: flat parameters or defaults
        # Try to get from flat params first
        left = effect.get("left_pct", effect.get("center_x_pct", 50) - 25)
        top = effect.get("top_pct", effect.get("center_y_pct", 50) - 25)
        right = effect.get("right_pct", effect.get("center_x_pct", 50) + 25)
        bottom = effect.get("bottom_pct", effect.get("center_y_pct", 50) + 25)
    
    # Ensure valid bounds
    left = max(0, min(100, left))
    top = max(0, min(100, top))
    right = max(left + 1, min(100, right))
    bottom = max(top + 1, min(100, bottom))
    
    return (left, top, right, bottom)


def region_to_center_and_size(region: Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
    """
    Convert bounding box to center point and dimensions.
    Returns (center_x_pct, center_y_pct, width_pct, height_pct)
    """
    left, top, right, bottom = region
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    width = right - left
    height = bottom - top
    return (center_x, center_y, width, height)


class EffectEngine:
    """Engine that applies effects to video frames based on Grok's plan"""
    
    def __init__(self, image_path: str, output_size: Tuple[int, int], duration: float, fps: int = 30,
                 highlight_color: str = "yellow", highlight_alpha: float = 0.7):
        self.image_path = image_path
        self.output_size = output_size
        self.duration = duration
        self.fps = fps
        self.effects_plan: List[Dict] = []
        
        # Default highlight settings (can be overridden per-effect)
        self.highlight_color = highlight_color
        self.highlight_alpha = highlight_alpha
        
        # Load and prepare image
        self.original_image = Image.open(image_path)
        self.img_width, self.img_height = self.original_image.size
        
    def set_effects_plan(self, plan: List[Dict]):
        """Set the effects plan from Grok's analysis"""
        self.effects_plan = plan
        print(f"📋 Loaded {len(plan)} effects into engine")
        
    def _get_active_effects(self, t: float) -> List[Dict]:
        """Get all effects that are active at time t"""
        active = []
        for effect in self.effects_plan:
            start = effect.get("start_time", 0)
            duration = effect.get("duration", self.duration)
            if start <= t < start + duration:
                active.append(effect)
        return active
    
    def _apply_zoom(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply zoom effect (in or out) on a bounding box region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        zoom_start = effect.get("zoom_start", 1.0)
        zoom_end = effect.get("zoom_end", 1.3)
        zoom = linear_interpolate(zoom_start, zoom_end, progress)
        
        # Extract region bounding box
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        # Calculate crop position based on region center
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_pan(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply pan effect from start_region to end_region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Extract start and end regions
        start_region = extract_region(effect, "start_region")
        end_region = extract_region(effect, "end_region")
        
        start_center_x, start_center_y, _, _ = region_to_center_and_size(start_region)
        end_center_x, end_center_y, _, _ = region_to_center_and_size(end_region)
        
        zoom_level = effect.get("zoom_level", 1.2)
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom_level), int(w / zoom_level)
        
        # Interpolate position between start and end region centers
        current_x_pct = linear_interpolate(start_center_x, end_center_x, progress)
        current_y_pct = linear_interpolate(start_center_y, end_center_y, progress)
        
        # Calculate crop position
        center_x = int(w * current_x_pct / 100)
        center_y = int(h * current_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_highlight_spotlight(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply highlight/spotlight effect on a bounding box region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        
        # Extract region bounding box (left, top, right, bottom)
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        
        darkness = effect.get("darkness", 0.4)
        pulse = effect.get("pulse", True)
        
        h, w = frame.shape[:2]
        
        # Debug: Log coordinates for troubleshooting
        if t == start_time:  # Only log once per effect
            print(f"     🎯 Highlight spotlight: region=({left_pct:.1f}%, {top_pct:.1f}%, {right_pct:.1f}%, {bottom_pct:.1f}%), frame_size=({w}x{h})")
        
        # Calculate highlight rectangle directly from bounding box
        hl_x1 = int(w * left_pct / 100)
        hl_y1 = int(h * top_pct / 100)
        hl_x2 = int(w * right_pct / 100)
        hl_y2 = int(h * bottom_pct / 100)
        
        # Clamp to bounds
        hl_x1 = max(0, min(w, hl_x1))
        hl_y1 = max(0, min(h, hl_y1))
        hl_x2 = max(hl_x1, min(w, hl_x2))
        hl_y2 = max(hl_y1, min(h, hl_y2))
        
        # Debug: Log calculated pixel coordinates
        if t == start_time:
            print(f"     📍 Calculated highlight box: ({hl_x1}, {hl_y1}) to ({hl_x2}, {hl_y2}), size=({hl_x2-hl_x1}x{hl_y2-hl_y1})")
        
        # Create pulsing darkness if enabled
        if pulse:
            pulse_progress = (t - start_time) / duration
            actual_darkness = darkness + 0.15 * np.sin(pulse_progress * 4 * np.pi)
            actual_darkness = max(0.1, min(0.7, actual_darkness))
        else:
            actual_darkness = darkness
        
        # Create overlay
        overlay = Image.new('RGBA', (w, h), (0, 0, 0, int(255 * actual_darkness)))
        draw = ImageDraw.Draw(overlay)
        
        # Clear the highlight area using exact bounding box
        draw.rectangle([hl_x1, hl_y1, hl_x2, hl_y2], fill=(0, 0, 0, 0))
        
        # Composite
        frame_pil = Image.fromarray(frame).convert('RGBA')
        result = Image.alpha_composite(frame_pil, overlay)
        return np.array(result.convert('RGB'))
    
    def _apply_ken_burns(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply Ken Burns effect (combined zoom and pan) from start_region to end_region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Extract start and end regions
        start_region = extract_region(effect, "start_region")
        end_region = extract_region(effect, "end_region")
        
        start_center_x, start_center_y, _, _ = region_to_center_and_size(start_region)
        end_center_x, end_center_y, _, _ = region_to_center_and_size(end_region)
        
        zoom_start = effect.get("zoom_start", 1.0)
        zoom_end = effect.get("zoom_end", 1.3)
        
        # Interpolate zoom and position
        zoom = linear_interpolate(zoom_start, zoom_end, progress)
        current_x_pct = linear_interpolate(start_center_x, end_center_x, progress)
        current_y_pct = linear_interpolate(start_center_y, end_center_y, progress)
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        center_x = int(w * current_x_pct / 100)
        center_y = int(h * current_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_shake(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply shake/vibration effect"""
        start_time = effect.get("start_time", 0)
        intensity = effect.get("intensity", 5)
        frequency = effect.get("frequency", 15)
        
        # Calculate shake offset
        time_offset = t - start_time
        shake_x = int(intensity * np.sin(time_offset * frequency * 2 * np.pi))
        shake_y = int(intensity * np.cos(time_offset * frequency * 2 * np.pi * 0.7))
        
        # Apply shift using roll
        shifted = np.roll(frame, shake_x, axis=1)
        shifted = np.roll(shifted, shake_y, axis=0)
        return shifted
    
    def _apply_vignette(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply vignette effect centered on a bounding box region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Extract region and get center
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        
        intensity_start = effect.get("intensity_start", 0)
        intensity_end = effect.get("intensity_end", 0.5)
        
        intensity = linear_interpolate(intensity_start, intensity_end, progress)
        
        h, w = frame.shape[:2]
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        # Create vignette mask
        Y, X = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((X - center_x)**2 + (Y - center_y)**2)
        max_dist = np.sqrt(center_x**2 + center_y**2)
        vignette = 1 - (dist_from_center / max_dist) * intensity
        vignette = np.clip(vignette, 0, 1)
        
        # Apply vignette
        result = frame.astype(np.float32)
        for c in range(3):
            result[:, :, c] *= vignette
        
        return result.astype(np.uint8)
    
    def _apply_brightness_pulse(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply brightness pulse to a bounding box region"""
        start_time = effect.get("start_time", 0)
        
        # Extract region bounding box
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        
        pulse_intensity = effect.get("pulse_intensity", 0.3)
        pulse_speed = effect.get("pulse_speed", 2)
        
        h, w = frame.shape[:2]
        
        # Calculate area directly from bounding box
        area_x1 = int(w * left_pct / 100)
        area_y1 = int(h * top_pct / 100)
        area_x2 = int(w * right_pct / 100)
        area_y2 = int(h * bottom_pct / 100)
        
        # Clamp to bounds
        area_x1 = max(0, min(w, area_x1))
        area_y1 = max(0, min(h, area_y1))
        area_x2 = max(area_x1, min(w, area_x2))
        area_y2 = max(area_y1, min(h, area_y2))
        
        # Calculate pulse
        time_offset = t - start_time
        brightness_factor = 1 + pulse_intensity * (0.5 + 0.5 * np.sin(time_offset * pulse_speed * 2 * np.pi))
        
        # Apply brightness to area
        result = frame.copy()
        area = result[area_y1:area_y2, area_x1:area_x2]
        brightened = np.clip(area.astype(np.float32) * brightness_factor, 0, 255).astype(np.uint8)
        result[area_y1:area_y2, area_x1:area_x2] = brightened
        
        return result
    
    def _apply_zoom_pulse(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply zoom pulse effect on a bounding box region"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", 1.0)
        
        # Extract region and get center
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        
        pulse_scale = effect.get("pulse_scale", 1.1)
        pulse_count = effect.get("pulse_count", 2)
        
        # Calculate pulse zoom
        time_offset = t - start_time
        pulse_progress = (time_offset / duration) * pulse_count
        zoom = 1 + (pulse_scale - 1) * abs(np.sin(pulse_progress * np.pi))
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_reveal_wipe(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply reveal wipe effect (shows original vs modified)"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        direction = effect.get("direction", "left_to_right")
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        progress = ease_in_out(progress)
        
        h, w = frame.shape[:2]
        
        # Create a darkened version for "before"
        dark_frame = (frame.astype(np.float32) * 0.5).astype(np.uint8)
        result = dark_frame.copy()
        
        if direction == "left_to_right":
            reveal_x = int(w * progress)
            result[:, :reveal_x] = frame[:, :reveal_x]
        elif direction == "right_to_left":
            reveal_x = int(w * (1 - progress))
            result[:, reveal_x:] = frame[:, reveal_x:]
        elif direction == "top_to_bottom":
            reveal_y = int(h * progress)
            result[:reveal_y, :] = frame[:reveal_y, :]
        elif direction == "bottom_to_top":
            reveal_y = int(h * (1 - progress))
            result[reveal_y:, :] = frame[reveal_y:, :]
        
        return result
    
    # ===== NEW SOCIAL MEDIA EFFECTS =====
    
    def _apply_glitch(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply digital glitch effect with RGB shift and scan lines"""
        start_time = effect.get("start_time", 0)
        intensity = effect.get("intensity", 5)
        glitch_freq = effect.get("glitch_frequency", 5)
        rgb_shift = effect.get("rgb_shift", True)
        scan_lines = effect.get("scan_lines", True)
        
        time_offset = t - start_time
        h, w = frame.shape[:2]
        result = frame.copy()
        
        # Random glitch timing based on frequency
        glitch_phase = (time_offset * glitch_freq) % 1
        glitch_active = glitch_phase < 0.3  # Glitch 30% of each cycle
        
        if glitch_active:
            # RGB channel shift
            if rgb_shift:
                shift = int(intensity * 2 * np.sin(time_offset * 20))
                if len(result.shape) == 3:
                    # Shift red channel
                    result[:, :, 0] = np.roll(result[:, :, 0], shift, axis=1)
                    # Shift blue channel opposite
                    result[:, :, 2] = np.roll(result[:, :, 2], -shift, axis=1)
            
            # Random horizontal slice displacement
            num_slices = int(intensity)
            for _ in range(num_slices):
                slice_y = np.random.randint(0, h - 10)
                slice_h = np.random.randint(5, 20)
                shift_x = np.random.randint(-intensity * 5, intensity * 5)
                result[slice_y:slice_y+slice_h] = np.roll(result[slice_y:slice_y+slice_h], shift_x, axis=1)
        
        # Scan lines overlay
        if scan_lines:
            scan_overlay = np.ones_like(result, dtype=np.float32)
            for y in range(0, h, 4):
                if y + 1 < h:
                    scan_overlay[y:y+2] = 0.85
            result = (result.astype(np.float32) * scan_overlay).astype(np.uint8)
        
        return result
    
    def _apply_rgb_split(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply chromatic aberration / RGB split effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        offset = effect.get("offset", 10)
        direction = effect.get("direction", "horizontal")
        animate = effect.get("animate", True)
        
        time_offset = t - start_time
        h, w = frame.shape[:2]
        
        # Animate offset if enabled
        if animate:
            current_offset = int(offset * (0.5 + 0.5 * np.sin(time_offset * 3)))
        else:
            current_offset = offset
        
        result = frame.copy()
        
        if direction == "horizontal":
            result[:, :, 0] = np.roll(frame[:, :, 0], current_offset, axis=1)  # Red right
            result[:, :, 2] = np.roll(frame[:, :, 2], -current_offset, axis=1)  # Blue left
        elif direction == "vertical":
            result[:, :, 0] = np.roll(frame[:, :, 0], current_offset, axis=0)  # Red down
            result[:, :, 2] = np.roll(frame[:, :, 2], -current_offset, axis=0)  # Blue up
        elif direction == "diagonal":
            result[:, :, 0] = np.roll(np.roll(frame[:, :, 0], current_offset, axis=1), current_offset, axis=0)
            result[:, :, 2] = np.roll(np.roll(frame[:, :, 2], -current_offset, axis=1), -current_offset, axis=0)
        
        return result
    
    def _apply_flash(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply flash/strobe effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", 0.5)
        color = effect.get("color", "white")
        flash_count = effect.get("flash_count", 1)
        intensity = effect.get("intensity", 0.8)
        
        time_offset = t - start_time
        progress = time_offset / duration
        
        # Determine flash timing
        flash_duration = duration / (flash_count * 2)
        flash_phase = (time_offset % (flash_duration * 2)) / flash_duration
        
        if flash_phase < 1:
            # Flash is on
            flash_intensity = intensity * (1 - flash_phase)  # Fade out
            
            # Get flash color
            if color == "white":
                flash_color = np.array([255, 255, 255])
            elif color == "red":
                flash_color = np.array([255, 100, 100])
            elif color == "blue":
                flash_color = np.array([100, 100, 255])
            elif color == "yellow":
                flash_color = np.array([255, 255, 100])
            else:
                flash_color = np.array([255, 255, 255])
            
            result = frame.astype(np.float32)
            result = result + (flash_color - result) * flash_intensity
            return np.clip(result, 0, 255).astype(np.uint8)
        
        return frame
    
    def _apply_blur_transition(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply blur transition effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        blur_start = effect.get("blur_start", 0)
        blur_end = effect.get("blur_end", 15)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        current_blur = blur_start + (blur_end - blur_start) * ease_in_out(progress)
        
        if current_blur > 0.5:
            pil_img = Image.fromarray(frame)
            blurred = pil_img.filter(ImageFilter.GaussianBlur(radius=current_blur))
            return np.array(blurred)
        
        return frame
    
    def _apply_letterbox(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply cinematic letterbox bars"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        bar_height_pct = effect.get("bar_height_pct", 10)
        animate_in = effect.get("animate_in", True)
        color = effect.get("color", "black")
        
        h, w = frame.shape[:2]
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Calculate bar height
        target_bar_height = int(h * bar_height_pct / 100)
        if animate_in and progress < 0.2:
            bar_height = int(target_bar_height * (progress / 0.2))
        else:
            bar_height = target_bar_height
        
        # Get bar color
        if color == "black":
            bar_color = [0, 0, 0]
        elif color == "white":
            bar_color = [255, 255, 255]
        else:
            bar_color = [0, 0, 0]
        
        result = frame.copy()
        result[:bar_height, :] = bar_color
        result[-bar_height:, :] = bar_color
        
        return result
    
    def _apply_color_shift(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply color grade transition"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        from_grade = effect.get("from_grade", "normal")
        to_grade = effect.get("to_grade", "warm")
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        progress = ease_in_out(progress)
        
        def apply_grade(img, grade):
            pil_img = Image.fromarray(img)
            if grade == "warm":
                enhancer = ImageEnhance.Color(pil_img)
                pil_img = enhancer.enhance(1.2)
                # Add warm tint
                img_array = np.array(pil_img).astype(np.float32)
                img_array[:, :, 0] = np.clip(img_array[:, :, 0] * 1.1, 0, 255)  # More red
                img_array[:, :, 2] = np.clip(img_array[:, :, 2] * 0.9, 0, 255)  # Less blue
                return img_array.astype(np.uint8)
            elif grade == "cool":
                img_array = np.array(pil_img).astype(np.float32)
                img_array[:, :, 0] = np.clip(img_array[:, :, 0] * 0.9, 0, 255)  # Less red
                img_array[:, :, 2] = np.clip(img_array[:, :, 2] * 1.1, 0, 255)  # More blue
                return img_array.astype(np.uint8)
            elif grade == "vintage":
                enhancer = ImageEnhance.Color(pil_img)
                pil_img = enhancer.enhance(0.8)
                enhancer = ImageEnhance.Contrast(pil_img)
                pil_img = enhancer.enhance(1.1)
                img_array = np.array(pil_img).astype(np.float32)
                img_array[:, :, 0] = np.clip(img_array[:, :, 0] * 1.05, 0, 255)
                return img_array.astype(np.uint8)
            elif grade == "high_contrast":
                enhancer = ImageEnhance.Contrast(pil_img)
                return np.array(enhancer.enhance(1.5))
            elif grade == "desaturated":
                enhancer = ImageEnhance.Color(pil_img)
                return np.array(enhancer.enhance(0.3))
            elif grade == "sepia":
                img_array = np.array(pil_img).astype(np.float32)
                sepia_filter = np.array([[0.393, 0.769, 0.189],
                                         [0.349, 0.686, 0.168],
                                         [0.272, 0.534, 0.131]])
                sepia_img = np.dot(img_array[..., :3], sepia_filter.T)
                return np.clip(sepia_img, 0, 255).astype(np.uint8)
            elif grade == "cyberpunk":
                img_array = np.array(pil_img).astype(np.float32)
                img_array[:, :, 0] = np.clip(img_array[:, :, 0] * 1.2, 0, 255)  # Boost red
                img_array[:, :, 2] = np.clip(img_array[:, :, 2] * 1.3, 0, 255)  # Boost blue
                img_array[:, :, 1] = np.clip(img_array[:, :, 1] * 0.8, 0, 255)  # Reduce green
                return img_array.astype(np.uint8)
            elif grade == "golden_hour":
                img_array = np.array(pil_img).astype(np.float32)
                img_array[:, :, 0] = np.clip(img_array[:, :, 0] * 1.15, 0, 255)
                img_array[:, :, 1] = np.clip(img_array[:, :, 1] * 1.05, 0, 255)
                img_array[:, :, 2] = np.clip(img_array[:, :, 2] * 0.85, 0, 255)
                return img_array.astype(np.uint8)
            return img
        
        from_frame = apply_grade(frame, from_grade)
        to_frame = apply_grade(frame, to_grade)
        
        # Blend between grades
        result = from_frame.astype(np.float32) * (1 - progress) + to_frame.astype(np.float32) * progress
        return result.astype(np.uint8)
    
    def _apply_saturation_pulse(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply saturation pulse effect"""
        start_time = effect.get("start_time", 0)
        saturation_boost = effect.get("saturation_boost", 1.5)
        pulse_speed = effect.get("pulse_speed", 2)
        
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        
        time_offset = t - start_time
        pulse = 1 + (saturation_boost - 1) * (0.5 + 0.5 * np.sin(time_offset * pulse_speed * 2 * np.pi))
        
        h, w = frame.shape[:2]
        x1, y1 = int(w * left_pct / 100), int(h * top_pct / 100)
        x2, y2 = int(w * right_pct / 100), int(h * bottom_pct / 100)
        
        result = frame.copy()
        region_img = Image.fromarray(result[y1:y2, x1:x2])
        enhancer = ImageEnhance.Color(region_img)
        saturated = enhancer.enhance(pulse)
        result[y1:y2, x1:x2] = np.array(saturated)
        
        return result
    
    def _apply_contrast_boost(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply dynamic contrast effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        contrast_start = effect.get("contrast_start", 1.0)
        contrast_end = effect.get("contrast_end", 1.5)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        current_contrast = linear_interpolate(contrast_start, contrast_end, progress)
        
        pil_img = Image.fromarray(frame)
        enhancer = ImageEnhance.Contrast(pil_img)
        return np.array(enhancer.enhance(current_contrast))
    
    def _apply_film_grain(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply film grain effect"""
        grain_intensity = effect.get("grain_intensity", 0.2)
        grain_size = effect.get("grain_size", 1)
        animated = effect.get("animated", True)
        
        h, w = frame.shape[:2]
        
        # Generate grain
        if animated:
            np.random.seed(int(t * 1000) % 10000)
        
        grain = np.random.normal(0, grain_intensity * 255, (h // grain_size, w // grain_size))
        grain = np.repeat(np.repeat(grain, grain_size, axis=0), grain_size, axis=1)
        grain = grain[:h, :w]
        
        result = frame.astype(np.float32)
        for c in range(3):
            result[:, :, c] = np.clip(result[:, :, c] + grain, 0, 255)
        
        return result.astype(np.uint8)
    
    def _apply_radial_blur(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply radial/zoom blur effect"""
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        blur_amount = effect.get("blur_amount", 15)
        direction = effect.get("direction", "zoom_in")
        
        h, w = frame.shape[:2]
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        # Create radial blur by averaging multiple offset copies
        result = frame.astype(np.float32)
        num_samples = 10
        
        for i in range(1, num_samples + 1):
            scale = 1 + (i / num_samples) * (blur_amount / 100)
            if direction == "zoom_out":
                scale = 2 - scale
            
            # Scale from center
            pil_img = Image.fromarray(frame)
            new_w, new_h = int(w * scale), int(h * scale)
            if new_w > 0 and new_h > 0:
                scaled = pil_img.resize((new_w, new_h), Image.LANCZOS)
                # Crop to original size from center
                left = (new_w - w) // 2
                top = (new_h - h) // 2
                cropped = scaled.crop((left, top, left + w, top + h))
                result += np.array(cropped).astype(np.float32) / num_samples
        
        result = result / 2  # Average original and blurred
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _apply_bounce_zoom(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply elastic bounce zoom effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", 1.0)
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        zoom_amount = effect.get("zoom_amount", 1.3)
        bounce_count = effect.get("bounce_count", 3)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Elastic bounce easing
        def elastic_out(t):
            if t == 0 or t == 1:
                return t
            p = 0.3
            s = p / 4
            return pow(2, -10 * t) * np.sin((t - s) * (2 * np.pi) / p) + 1
        
        bounce_progress = elastic_out(progress)
        zoom = 1 + (zoom_amount - 1) * (1 - bounce_progress)
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_tilt(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply rotation/tilt effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        angle_start = effect.get("angle_start", 0)
        angle_end = effect.get("angle_end", 5)
        oscillate = effect.get("oscillate", False)
        oscillate_speed = effect.get("oscillate_speed", 2)
        
        time_offset = t - start_time
        progress = time_offset / duration
        progress = max(0, min(1, progress))
        
        if oscillate:
            angle = angle_start + (angle_end - angle_start) * np.sin(time_offset * oscillate_speed * 2 * np.pi)
        else:
            angle = linear_interpolate(angle_start, angle_end, progress)
        
        pil_img = Image.fromarray(frame)
        rotated = pil_img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(0, 0, 0))
        return np.array(rotated)
    
    def _apply_mirror(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply mirror/reflection effect"""
        mirror_type = effect.get("mirror_type", "horizontal")
        mirror_position_pct = effect.get("mirror_position_pct", 50)
        
        h, w = frame.shape[:2]
        result = frame.copy()
        
        if mirror_type == "horizontal":
            pos = int(w * mirror_position_pct / 100)
            left_half = frame[:, :pos]
            result[:, pos:pos + left_half.shape[1]] = np.fliplr(left_half)[:, :w-pos]
        elif mirror_type == "vertical":
            pos = int(h * mirror_position_pct / 100)
            top_half = frame[:pos, :]
            result[pos:pos + top_half.shape[0], :] = np.flipud(top_half)[:h-pos, :]
        elif mirror_type == "quad":
            half_h, half_w = h // 2, w // 2
            top_left = frame[:half_h, :half_w]
            result[:half_h, half_w:] = np.fliplr(top_left)
            result[half_h:, :half_w] = np.flipud(top_left)
            result[half_h:, half_w:] = np.flipud(np.fliplr(top_left))
        
        return result
    
    def _apply_pixelate(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply pixelation effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        pixel_size_start = effect.get("pixel_size_start", 1)
        pixel_size_end = effect.get("pixel_size_end", 20)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        pixel_size = int(linear_interpolate(pixel_size_start, pixel_size_end, progress))
        pixel_size = max(1, pixel_size)
        
        h, w = frame.shape[:2]
        x1, y1 = int(w * left_pct / 100), int(h * top_pct / 100)
        x2, y2 = int(w * right_pct / 100), int(h * bottom_pct / 100)
        
        result = frame.copy()
        region_img = frame[y1:y2, x1:x2]
        
        if pixel_size > 1:
            rh, rw = region_img.shape[:2]
            small = Image.fromarray(region_img).resize((max(1, rw // pixel_size), max(1, rh // pixel_size)), Image.NEAREST)
            pixelated = small.resize((rw, rh), Image.NEAREST)
            result[y1:y2, x1:x2] = np.array(pixelated)
        
        return result
    
    def _apply_wave_distortion(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply wave/ripple distortion effect"""
        start_time = effect.get("start_time", 0)
        wave_amplitude = effect.get("wave_amplitude", 10)
        wave_frequency = effect.get("wave_frequency", 5)
        wave_speed = effect.get("wave_speed", 2)
        direction = effect.get("direction", "horizontal")
        
        time_offset = t - start_time
        h, w = frame.shape[:2]
        
        result = np.zeros_like(frame)
        
        for y in range(h):
            for x in range(w):
                if direction == "horizontal":
                    offset = int(wave_amplitude * np.sin(2 * np.pi * wave_frequency * y / h + time_offset * wave_speed))
                    src_x = (x + offset) % w
                    result[y, x] = frame[y, src_x]
                elif direction == "vertical":
                    offset = int(wave_amplitude * np.sin(2 * np.pi * wave_frequency * x / w + time_offset * wave_speed))
                    src_y = (y + offset) % h
                    result[y, x] = frame[src_y, x]
                elif direction == "circular":
                    cx, cy = w // 2, h // 2
                    dist = np.sqrt((x - cx)**2 + (y - cy)**2)
                    offset = int(wave_amplitude * np.sin(2 * np.pi * wave_frequency * dist / max(w, h) + time_offset * wave_speed))
                    angle = np.arctan2(y - cy, x - cx)
                    src_x = int(x + offset * np.cos(angle)) % w
                    src_y = int(y + offset * np.sin(angle)) % h
                    result[y, x] = frame[src_y, src_x]
        
        return result
    
    def _apply_color_pop(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply selective color / color pop effect"""
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        desaturation = effect.get("desaturation", 0.9)
        feather = effect.get("feather", 20)
        
        h, w = frame.shape[:2]
        x1, y1 = int(w * left_pct / 100), int(h * top_pct / 100)
        x2, y2 = int(w * right_pct / 100), int(h * bottom_pct / 100)
        
        # Create grayscale version
        pil_img = Image.fromarray(frame)
        enhancer = ImageEnhance.Color(pil_img)
        grayscale = np.array(enhancer.enhance(1 - desaturation))
        
        # Create mask for colored region
        mask = np.zeros((h, w), dtype=np.float32)
        mask[y1:y2, x1:x2] = 1.0
        
        # Feather the mask
        if feather > 0:
            mask_img = Image.fromarray((mask * 255).astype(np.uint8))
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=feather))
            mask = np.array(mask_img).astype(np.float32) / 255
        
        # Blend
        result = grayscale.astype(np.float32)
        for c in range(3):
            result[:, :, c] = grayscale[:, :, c] * (1 - mask) + frame[:, :, c] * mask
        
        return result.astype(np.uint8)
    
    def _apply_zoom_whip(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply ultra-fast zoom whip / crash zoom effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", 0.3)
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        zoom_amount = effect.get("zoom_amount", 2.0)
        ease_type = effect.get("ease_type", "ease_out")
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        # Apply easing
        if ease_type == "ease_in":
            progress = progress ** 2
        elif ease_type == "ease_out":
            progress = 1 - (1 - progress) ** 2
        elif ease_type == "ease_in_out":
            progress = ease_in_out(progress)
        elif ease_type == "bounce":
            if progress < 0.5:
                progress = 4 * progress ** 3
            else:
                progress = 1 - pow(-2 * progress + 2, 3) / 2
        
        zoom = 1 + (zoom_amount - 1) * progress
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_heartbeat(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply heartbeat/throb zoom effect"""
        start_time = effect.get("start_time", 0)
        region = extract_region(effect, "region")
        center_x_pct, center_y_pct, _, _ = region_to_center_and_size(region)
        bpm = effect.get("bpm", 80)
        intensity = effect.get("intensity", 1.05)
        
        time_offset = t - start_time
        beats_per_second = bpm / 60
        
        # Create heartbeat pattern (double beat)
        beat_phase = (time_offset * beats_per_second) % 1
        if beat_phase < 0.1:
            zoom = 1 + (intensity - 1) * (beat_phase / 0.1)
        elif beat_phase < 0.2:
            zoom = intensity - (intensity - 1) * ((beat_phase - 0.1) / 0.1)
        elif beat_phase < 0.3:
            zoom = 1 + (intensity - 1) * 0.7 * ((beat_phase - 0.2) / 0.1)
        elif beat_phase < 0.4:
            zoom = 1 + (intensity - 1) * 0.7 * (1 - (beat_phase - 0.3) / 0.1)
        else:
            zoom = 1.0
        
        h, w = frame.shape[:2]
        new_h, new_w = int(h / zoom), int(w / zoom)
        
        center_x = int(w * center_x_pct / 100)
        center_y = int(h * center_y_pct / 100)
        
        x1 = max(0, min(w - new_w, center_x - new_w // 2))
        y1 = max(0, min(h - new_h, center_y - new_h // 2))
        
        cropped = frame[y1:y1+new_h, x1:x1+new_w]
        return np.array(Image.fromarray(cropped).resize((w, h), Image.LANCZOS))
    
    def _apply_light_leak(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply light leak overlay effect"""
        start_time = effect.get("start_time", 0)
        leak_color = effect.get("leak_color", "warm")
        leak_position = effect.get("leak_position", "top_right")
        leak_intensity = effect.get("leak_intensity", 0.4)
        animate = effect.get("animate", True)
        
        h, w = frame.shape[:2]
        time_offset = t - start_time
        
        # Create gradient based on position
        Y, X = np.ogrid[:h, :w]
        
        if leak_position == "top_left":
            gradient = 1 - (np.sqrt(X**2 + Y**2) / np.sqrt(w**2 + h**2))
        elif leak_position == "top_right":
            gradient = 1 - (np.sqrt((w - X)**2 + Y**2) / np.sqrt(w**2 + h**2))
        elif leak_position == "bottom_left":
            gradient = 1 - (np.sqrt(X**2 + (h - Y)**2) / np.sqrt(w**2 + h**2))
        elif leak_position == "bottom_right":
            gradient = 1 - (np.sqrt((w - X)**2 + (h - Y)**2) / np.sqrt(w**2 + h**2))
        else:
            gradient = np.ones((h, w))
        
        # Animate intensity
        if animate:
            current_intensity = leak_intensity * (0.7 + 0.3 * np.sin(time_offset * 2))
        else:
            current_intensity = leak_intensity
        
        # Get leak color
        if leak_color == "warm":
            color = np.array([255, 200, 100])
        elif leak_color == "cool":
            color = np.array([100, 200, 255])
        elif leak_color == "orange":
            color = np.array([255, 150, 50])
        elif leak_color == "pink":
            color = np.array([255, 150, 200])
        else:
            color = np.array([255, 220, 150])
        
        # Apply leak
        result = frame.astype(np.float32)
        leak_layer = np.zeros_like(result)
        for c in range(3):
            leak_layer[:, :, c] = color[c] * gradient * current_intensity
        
        result = result + leak_layer
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _apply_focus_rack(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply focus rack / depth of field shift effect
        
        Supports animated blur via blur_start and blur_end parameters:
        - blur_start: Initial blur amount (default: same as blur_amount for backwards compatibility)
        - blur_end: Final blur amount (default: same as blur_amount)
        - If only blur_amount is set, blur stays constant
        - If blur_start=0 and blur_end=10, blur gradually increases
        """
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        start_region = extract_region(effect, "start_region")
        end_region = extract_region(effect, "end_region")
        
        # Support animated blur: blur_start -> blur_end over duration
        blur_amount = effect.get("blur_amount", 10)
        blur_start = effect.get("blur_start", blur_amount)  # Default to blur_amount for backwards compat
        blur_end = effect.get("blur_end", blur_amount)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        progress_eased = ease_in_out(progress)
        
        # Animate blur amount
        current_blur = blur_start + (blur_end - blur_start) * progress_eased
        
        # If blur is essentially 0, return original frame
        if current_blur < 0.5:
            return frame
        
        h, w = frame.shape[:2]
        
        # Create masks for start and end regions
        def create_focus_mask(region):
            left, top, right, bottom = region
            x1, y1 = int(w * left / 100), int(h * top / 100)
            x2, y2 = int(w * right / 100), int(h * bottom / 100)
            mask = np.zeros((h, w), dtype=np.float32)
            mask[y1:y2, x1:x2] = 1.0
            # Feather
            mask_img = Image.fromarray((mask * 255).astype(np.uint8))
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=30))
            return np.array(mask_img).astype(np.float32) / 255
        
        start_mask = create_focus_mask(start_region)
        end_mask = create_focus_mask(end_region)
        
        # Interpolate masks
        focus_mask = start_mask * (1 - progress_eased) + end_mask * progress_eased
        
        # Create blurred version with animated blur amount
        pil_img = Image.fromarray(frame)
        blurred = np.array(pil_img.filter(ImageFilter.GaussianBlur(radius=current_blur)))
        
        # Blend based on focus mask
        result = frame.astype(np.float32)
        for c in range(3):
            result[:, :, c] = frame[:, :, c] * focus_mask + blurred[:, :, c] * (1 - focus_mask)
        
        return result.astype(np.uint8)
    
    def _apply_split_screen(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply split screen reveal effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        split_type = effect.get("split_type", "vertical")
        reveal_order = effect.get("reveal_order", "sequential")
        gap_pixels = effect.get("gap_pixels", 2)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        
        h, w = frame.shape[:2]
        dark_frame = (frame.astype(np.float32) * 0.3).astype(np.uint8)
        result = dark_frame.copy()
        
        if split_type == "vertical":
            mid = w // 2
            if reveal_order == "sequential":
                if progress < 0.5:
                    reveal = int(mid * (progress * 2))
                    result[:, :reveal] = frame[:, :reveal]
                else:
                    result[:, :mid] = frame[:, :mid]
                    reveal = int(mid * ((progress - 0.5) * 2))
                    result[:, mid:mid+reveal] = frame[:, mid:mid+reveal]
            else:
                reveal = int(mid * progress)
                result[:, :reveal] = frame[:, :reveal]
                result[:, w-reveal:] = frame[:, w-reveal:]
        elif split_type == "horizontal":
            mid = h // 2
            if reveal_order == "sequential":
                if progress < 0.5:
                    reveal = int(mid * (progress * 2))
                    result[:reveal, :] = frame[:reveal, :]
                else:
                    result[:mid, :] = frame[:mid, :]
                    reveal = int(mid * ((progress - 0.5) * 2))
                    result[mid:mid+reveal, :] = frame[mid:mid+reveal, :]
            else:
                reveal = int(mid * progress)
                result[:reveal, :] = frame[:reveal, :]
                result[h-reveal:, :] = frame[h-reveal:, :]
        
        return result
    
    def _apply_highlight_overlay(self, frame: np.ndarray, effect: Dict, t: float) -> np.ndarray:
        """Apply colored highlight overlay on a specific region
        
        Supports two modes:
        - Static: Full region highlighted at once (pulse/fade effects)
        - Progressive: Highlight sweeps from left to right like a highlighter pen
        """
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        
        # Extract region bounding box
        region = extract_region(effect, "region")
        left_pct, top_pct, right_pct, bottom_pct = region
        
        # Check if coordinates came from Vision API (accurate) or Grok (needs adjustment)
        from_vision_api = effect.get("_from_vision_api", False)
        original_top_pct = top_pct
        
        if not from_vision_api:
            # Adjust Grok's region estimate: add +10% to top to shift region down
            # Grok consistently estimates regions too high
            # Vision API provides accurate coordinates, so skip adjustment
            top_pct = min(100, top_pct + 10)
            bottom_pct = min(100, bottom_pct + 10)
        
        # ALWAYS use CLI color/alpha - ignore what Grok specified
        # This ensures user's CLI settings take precedence
        color_input = self.highlight_color
        alpha = self.highlight_alpha
        feather = effect.get("feather", 0)
        
        # Progressive highlight modes
        progressive = effect.get("progressive", False)        # L→R sweep
        progressive_down = effect.get("progressive_down", False)  # Top→bottom sweep for multi-line
        
        # Legacy pulse/fade options (disabled in progressive modes)
        is_progressive = progressive or progressive_down
        pulse = effect.get("pulse", False) if not is_progressive else False
        pulse_speed = effect.get("pulse_speed", 2)
        fade_in = effect.get("fade_in", False) if not is_progressive else False
        fade_in_duration = effect.get("fade_in_duration", 0.3)
        
        # Parse color
        color_map = {
            # Basic colors
            "black": (0, 0, 0),
            "white": (255, 255, 255),
            "red": (255, 0, 0),
            "green": (0, 255, 0),
            "blue": (0, 0, 255),
            "yellow": (255, 255, 0),
            "cyan": (0, 255, 255),
            "magenta": (255, 0, 255),
            
            # Extended colors
            "orange": (255, 165, 0),
            "pink": (255, 192, 203),
            "purple": (128, 0, 128),
            "lime": (0, 255, 0),
            "navy": (0, 0, 128),
            "teal": (0, 128, 128),
            "maroon": (128, 0, 0),
            "olive": (128, 128, 0),
            "coral": (255, 127, 80),
            "salmon": (250, 128, 114),
            "gold": (255, 215, 0),
            "silver": (192, 192, 192),
            "gray": (128, 128, 128),
            "grey": (128, 128, 128),
            
            # Highlight-friendly colors
            "lightyellow": (255, 255, 224),
            "lightgreen": (144, 238, 144),
            "lightblue": (173, 216, 230),
            "lightpink": (255, 182, 193),
            "lightcyan": (224, 255, 255),
            "lavender": (230, 230, 250),
            "peach": (255, 218, 185),
            "mint": (189, 252, 201),
            "cream": (255, 253, 208),
            "beige": (245, 245, 220),
            
            # Vibrant colors
            "hotpink": (255, 105, 180),
            "deeppink": (255, 20, 147),
            "tomato": (255, 99, 71),
            "orangered": (255, 69, 0),
            "chartreuse": (127, 255, 0),
            "springgreen": (0, 255, 127),
            "aqua": (0, 255, 255),
            "turquoise": (64, 224, 208),
            "violet": (238, 130, 238),
            "indigo": (75, 0, 130),
            "crimson": (220, 20, 60),
            "scarlet": (255, 36, 0),
            
            # Neon colors
            "neongreen": (57, 255, 20),
            "neonpink": (255, 16, 240),
            "neonyellow": (255, 255, 0),
            "neonorange": (255, 95, 31),
            "neonblue": (77, 77, 255),
        }
        
        if isinstance(color_input, str):
            if color_input.lower() in color_map:
                rgb_color = color_map[color_input.lower()]
            elif color_input.startswith("#"):
                # Parse hex color
                hex_color = color_input.lstrip("#")
                if len(hex_color) == 6:
                    rgb_color = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                else:
                    rgb_color = (255, 255, 0)  # Default to yellow
            else:
                rgb_color = (255, 255, 0)  # Default to yellow
        elif isinstance(color_input, (list, tuple)) and len(color_input) >= 3:
            rgb_color = tuple(color_input[:3])
        else:
            rgb_color = (255, 255, 0)  # Default to yellow
        
        h, w = frame.shape[:2]
        time_offset = t - start_time
        progress = time_offset / duration
        progress = max(0, min(1, progress))
        
        # Calculate current alpha with effects
        current_alpha = alpha
        
        # Apply fade in (only in static mode)
        if fade_in and time_offset < fade_in_duration:
            fade_progress = time_offset / fade_in_duration
            current_alpha = alpha * ease_in_out(fade_progress)
        
        # Apply pulse (only in static mode)
        if pulse:
            pulse_factor = 0.7 + 0.3 * np.sin(time_offset * pulse_speed * 2 * np.pi)
            current_alpha = current_alpha * pulse_factor
        
        # Clamp alpha
        current_alpha = max(0.0, min(1.0, current_alpha))
        
        # Calculate highlight rectangle base coordinates
        hl_x1 = int(w * left_pct / 100)
        hl_y1 = int(h * top_pct / 100)
        hl_x2_full = int(w * right_pct / 100)  # Full width (end position)
        hl_y2_full = int(h * bottom_pct / 100)  # Full height (end position)
        
        # Progressive mode: animate edges based on progress
        if progressive:
            # L→R sweep: animate the right edge
            sweep_progress = ease_in_out(progress)
            total_width = hl_x2_full - hl_x1
            current_width = int(total_width * sweep_progress)
            hl_x2 = hl_x1 + max(1, current_width)
            hl_y2 = hl_y2_full
        elif progressive_down:
            # Top→bottom sweep: animate the bottom edge (better for multi-line text)
            sweep_progress = ease_in_out(progress)
            total_height = hl_y2_full - hl_y1
            current_height = int(total_height * sweep_progress)
            hl_y2 = hl_y1 + max(1, current_height)
            hl_x2 = hl_x2_full
        else:
            # Static mode: full rectangle
            hl_x2 = hl_x2_full
            hl_y2 = hl_y2_full
        
        # Clamp to bounds
        hl_x1 = max(0, min(w, hl_x1))
        hl_y1 = max(0, min(h, hl_y1))
        hl_x2 = max(hl_x1 + 1, min(w, hl_x2))
        hl_y2 = max(hl_y1 + 1, min(h, hl_y2))
        
        # Debug logging (only once per effect)
        if t == start_time:
            if progressive:
                mode_str = "sweep L→R"
            elif progressive_down:
                mode_str = "sweep-down ↓"
            else:
                mode_str = "static"
            
            if from_vision_api:
                print(f"     🎨 Highlight overlay ({mode_str}): region=({left_pct:.1f}%, {top_pct:.1f}%, {right_pct:.1f}%, {bottom_pct:.1f}%) [Google Vision API - exact]")
            else:
                print(f"     🎨 Highlight overlay ({mode_str}): region=({left_pct:.1f}%, {top_pct:.1f}%, {right_pct:.1f}%, {bottom_pct:.1f}%) [Grok +10% adjustment]")
                print(f"        Original from Grok: top_pct={original_top_pct:.1f}%")
            
            animated_str = "animated" if (progressive or progressive_down) else str(hl_y2_full)
            print(f"     📍 Pixel coords: ({hl_x1}, {hl_y1}) to ({hl_x2_full if progressive else hl_x2}, {animated_str}), color={rgb_color}, alpha={alpha}")
        
        # Create result
        result = frame.copy().astype(np.float32)
        
        if feather > 0:
            # Create feathered mask
            mask = np.zeros((h, w), dtype=np.float32)
            mask[hl_y1:hl_y2, hl_x1:hl_x2] = 1.0
            
            # Apply Gaussian blur for feathering
            mask_img = Image.fromarray((mask * 255).astype(np.uint8))
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=feather))
            mask = np.array(mask_img).astype(np.float32) / 255.0
            
            # Apply colored overlay with feathered mask
            for c in range(3):
                result[:, :, c] = result[:, :, c] * (1 - mask * current_alpha) + rgb_color[c] * mask * current_alpha
        else:
            # Sharp edges - direct overlay on region
            region_frame = result[hl_y1:hl_y2, hl_x1:hl_x2]
            for c in range(3):
                region_frame[:, :, c] = region_frame[:, :, c] * (1 - current_alpha) + rgb_color[c] * current_alpha
            result[hl_y1:hl_y2, hl_x1:hl_x2] = region_frame
        
        return result.astype(np.uint8)
    
    def process_frame(self, get_frame, t: float) -> np.ndarray:
        """Process a single frame applying all active effects in order"""
        frame = get_frame(t)
        
        # Get active effects for this time
        active_effects = self._get_active_effects(t)
        
        # Apply effects in order specified by Grok
        for effect in active_effects:
            effect_type = effect.get("effect_type", "")
            
            # Original effects
            if effect_type == "zoom_in" or effect_type == "zoom_out":
                frame = self._apply_zoom(frame, effect, t)
            elif effect_type == "pan":
                frame = self._apply_pan(frame, effect, t)
            elif effect_type == "highlight_spotlight":
                frame = self._apply_highlight_spotlight(frame, effect, t)
            elif effect_type == "ken_burns":
                frame = self._apply_ken_burns(frame, effect, t)
            elif effect_type == "shake":
                frame = self._apply_shake(frame, effect, t)
            elif effect_type == "fade_vignette":
                frame = self._apply_vignette(frame, effect, t)
            elif effect_type == "brightness_pulse":
                frame = self._apply_brightness_pulse(frame, effect, t)
            elif effect_type == "zoom_pulse":
                frame = self._apply_zoom_pulse(frame, effect, t)
            elif effect_type == "reveal_wipe":
                frame = self._apply_reveal_wipe(frame, effect, t)
            
            # New social media effects
            elif effect_type == "glitch":
                frame = self._apply_glitch(frame, effect, t)
            elif effect_type == "rgb_split":
                frame = self._apply_rgb_split(frame, effect, t)
            elif effect_type == "flash":
                frame = self._apply_flash(frame, effect, t)
            elif effect_type == "blur_transition":
                frame = self._apply_blur_transition(frame, effect, t)
            elif effect_type == "letterbox":
                frame = self._apply_letterbox(frame, effect, t)
            elif effect_type == "color_shift":
                frame = self._apply_color_shift(frame, effect, t)
            elif effect_type == "saturation_pulse":
                frame = self._apply_saturation_pulse(frame, effect, t)
            elif effect_type == "contrast_boost":
                frame = self._apply_contrast_boost(frame, effect, t)
            elif effect_type == "film_grain":
                frame = self._apply_film_grain(frame, effect, t)
            elif effect_type == "radial_blur":
                frame = self._apply_radial_blur(frame, effect, t)
            elif effect_type == "bounce_zoom":
                frame = self._apply_bounce_zoom(frame, effect, t)
            elif effect_type == "tilt":
                frame = self._apply_tilt(frame, effect, t)
            elif effect_type == "mirror":
                frame = self._apply_mirror(frame, effect, t)
            elif effect_type == "pixelate":
                frame = self._apply_pixelate(frame, effect, t)
            elif effect_type == "wave_distortion":
                frame = self._apply_wave_distortion(frame, effect, t)
            elif effect_type == "color_pop":
                frame = self._apply_color_pop(frame, effect, t)
            elif effect_type == "zoom_whip":
                frame = self._apply_zoom_whip(frame, effect, t)
            elif effect_type == "heartbeat":
                frame = self._apply_heartbeat(frame, effect, t)
            elif effect_type == "light_leak":
                frame = self._apply_light_leak(frame, effect, t)
            elif effect_type == "focus_rack":
                frame = self._apply_focus_rack(frame, effect, t)
            elif effect_type == "split_screen":
                frame = self._apply_split_screen(frame, effect, t)
            elif effect_type == "highlight_overlay":
                frame = self._apply_highlight_overlay(frame, effect, t)
        
        return frame
    
    def generate_video(self, output_path: str):
        """Generate the final video"""
        print(f"\n🎬 Generating video...")
        print(f"   Input: {self.image_path}")
        print(f"   Output: {output_path}")
        print(f"   Duration: {self.duration}s")
        print(f"   Resolution: {self.output_size[0]}x{self.output_size[1]}")
        print(f"   FPS: {self.fps}")
        print(f"   Effects: {len(self.effects_plan)}")
        
        # Pre-process image to match output size BEFORE creating clip
        # This ensures coordinates from Grok (based on output size) match exactly
        target_w, target_h = self.output_size
        img = Image.open(self.image_path)
        img_w, img_h = img.size
        
        # Calculate resize to fit (maintain aspect ratio, then crop to exact size)
        target_aspect = target_w / target_h
        img_aspect = img_w / img_h
        
        if img_aspect > target_aspect:
            # Image is wider - fit to height, crop width
            new_h = target_h
            new_w = int(target_h * img_aspect)
            img_resized = img.resize((new_w, new_h), Image.LANCZOS)
            # Crop from center
            left = (new_w - target_w) // 2
            img_resized = img_resized.crop((left, 0, left + target_w, target_h))
        else:
            # Image is taller - fit to width, crop height
            new_w = target_w
            new_h = int(target_w / img_aspect)
            img_resized = img.resize((new_w, new_h), Image.LANCZOS)
            # Crop from center
            top = (new_h - target_h) // 2
            img_resized = img_resized.crop((0, top, target_w, top + target_h))
        
        # Save pre-processed image temporarily
        import tempfile
        temp_img_path = output_path.replace('.mp4', '_preprocessed.png')
        img_resized.save(temp_img_path)
        print(f"   📐 Pre-processed image: {img_w}x{img_h} → {target_w}x{target_h}")
        
        # Create base clip from pre-processed image (already at correct size)
        base_clip = ImageClip(temp_img_path, duration=self.duration)
        
        # Apply effects (frames are now at correct output size)
        clip_with_effects = base_clip.fl(self.process_frame)
        
        # No need to resize - already at correct size
        final_clip = clip_with_effects
        
        # Write video
        final_clip.write_videofile(
            output_path,
            fps=self.fps,
            codec='libx264',
            audio=False,
            preset='medium',
            bitrate='8000k',
            logger=None  # Suppress moviepy progress bar
        )
        
        # Cleanup temp preprocessed image
        try:
            if os.path.exists(temp_img_path):
                os.remove(temp_img_path)
        except:
            pass
        
        print(f"\n✅ Video created successfully: {output_path}")
        return output_path


# ============================================
# GROK INTEGRATION
# ============================================

def get_effects_catalog_for_prompt() -> str:
    """Format effects catalog for Grok prompt"""
    catalog_text = "AVAILABLE EFFECTS:\n\n"
    for effect_id, effect_info in EFFECTS_CATALOG.items():
        catalog_text += f"**{effect_id}** - {effect_info['name']}\n"
        catalog_text += f"  Description: {effect_info['description']}\n"
        catalog_text += f"  Parameters:\n"
        for param, desc in effect_info['parameters'].items():
            catalog_text += f"    - {param}: {desc}\n"
        catalog_text += "\n"
    return catalog_text


def analyze_image_and_plan_effects(
    image_path: str,
    duration: float,
    aspect_ratio: str,
    user_instructions: str
) -> List[Dict]:
    """
    Use Grok-4-latest to analyze the image and create an effects plan
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import base64
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK IMAGE ANALYSIS & EFFECT PLANNING")
    print(f"{'='*60}")
    print(f"  Image: {image_path}")
    print(f"  Duration: {duration}s")
    print(f"  Aspect Ratio: {aspect_ratio}")
    print(f"  User Instructions: {user_instructions}")
    
    # Get image dimensions
    img = Image.open(image_path)
    img_width, img_height = img.size
    print(f"  Image Size: {img_width}x{img_height}")
    
    # Get output dimensions
    output_size = ASPECT_RATIOS.get(aspect_ratio, (1080, 1920))
    print(f"  Output Size: {output_size[0]}x{output_size[1]}")
    
    # Encode image to base64 for local files
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode('utf-8')
    
    # Determine mime type
    ext = image_path.lower().split('.')[-1]
    mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
    mime_type = mime_types.get(ext, 'image/jpeg')
    image_data_url = f"data:{mime_type};base64,{image_data}"
    
    # Build effects catalog for prompt
    effects_catalog = get_effects_catalog_for_prompt()
    
    system_prompt = f"""You are an expert VIDEO DIRECTOR and MOTION GRAPHICS specialist who creates scroll-stopping social media videos from static images.

Your task is to analyze an image and create a PRECISE EFFECTS PLAN that transforms it into an engaging {duration}-second video.

{effects_catalog}

🎯 CRITICAL: ACCURATE COORDINATE ESTIMATION

ALL coordinates are PERCENTAGES (0-100) measured as follows:

HORIZONTAL (X) - measured from LEFT edge:
├── 0%   = Left edge of image
├── 25%  = Quarter way from left
├── 50%  = Exact horizontal center
├── 75%  = Three-quarters from left
└── 100% = Right edge of image

VERTICAL (Y) - measured from TOP edge:
├── 0%   = Top edge of image
├── 25%  = Quarter way from top
├── 50%  = Exact vertical center
├── 75%  = Three-quarters from top
└── 100% = Bottom edge of image

BOUNDING BOX FORMAT:
All regions must be specified as bounding boxes with 4 values:
- left_pct: Left edge (0 = image left, 100 = image right)
- top_pct: Top edge (0 = image top, 100 = image bottom)
- right_pct: Right edge (must be > left_pct)
- bottom_pct: Bottom edge (must be > top_pct)

EXAMPLE BOUNDING BOXES:
- Top-left quadrant: {{"left_pct": 0, "top_pct": 0, "right_pct": 50, "bottom_pct": 50}}
- Top-right quadrant: {{"left_pct": 50, "top_pct": 0, "right_pct": 100, "bottom_pct": 50}}
- Bottom-left quadrant: {{"left_pct": 0, "top_pct": 50, "right_pct": 50, "bottom_pct": 100}}
- Bottom-right quadrant: {{"left_pct": 50, "top_pct": 50, "right_pct": 100, "bottom_pct": 100}}
- Center region: {{"left_pct": 25, "top_pct": 25, "right_pct": 75, "bottom_pct": 75}}
- Small element at top-right: {{"left_pct": 70, "top_pct": 10, "right_pct": 95, "bottom_pct": 35}}

⚠️ CRITICAL BOUNDING BOX RULES:
1. Visually identify the EXACT rectangle containing the element of interest
2. left_pct = distance from image LEFT edge to element's LEFT edge
3. top_pct = distance from image TOP edge to element's TOP edge
4. right_pct = distance from image LEFT edge to element's RIGHT edge
5. bottom_pct = distance from image TOP edge to element's BOTTOM edge
6. If element is on the RIGHT side: left_pct and right_pct should BOTH be > 50
7. If element is on the BOTTOM half: top_pct and bottom_pct should BOTH be > 50
8. TENDENCY: Most people UNDERESTIMATE - if unsure, add 5-10% to your estimates

TIMING:
- Total video duration is {duration} seconds
- Effects can overlap or run sequentially
- start_time + duration should not exceed {duration}s
- Create a dynamic flow - don't let the video feel static

EFFECT SELECTION STRATEGY:
- Start with an attention-grabbing effect (zoom, ken_burns)
- Use highlight_spotlight to draw attention to key elements
- Use pan to show different parts of the image
- End with emphasis (zoom_pulse, final zoom)
- Don't overuse shake - only for dramatic moments

⚠️ CRITICAL RULE FOR highlight_overlay:
When the user asks to use highlight_overlay effect, follow these rules STRICTLY:
1. Use ONLY highlight_overlay - do NOT add other effects like film_grain, blur_transition, letterbox, etc.
2. Do NOT use ANY camera movement effects (ken_burns, zoom_in, zoom_out, pan, zoom_pulse, bounce_zoom, zoom_whip)
3. Do NOT use blur_transition - the image should be CLEAR from the start
4. Do NOT use film_grain or other texture effects
5. The video should START with the image fully visible and clear
6. You MAY use: fade_in on the highlight itself, pulse on the highlight
7. Keep it SIMPLE: just highlight_overlay only
8. Do NOT specify "color" or "alpha" in the effect - the system will use the user's CLI settings
9. BOUNDING BOX PRECISION: The region MUST tightly fit the text being highlighted:
   - top_pct should be at the TOP edge of the first line of text (not above it)
   - bottom_pct should be at the BOTTOM edge of the last line of text (not below it)
   - left_pct should be at the LEFT edge of the text (not to the left of it)
   - right_pct should be at the RIGHT edge of the text (not to the right of it)
   - Add only 1-2% padding maximum, NOT 5-10%
   - The highlight should CLOSELY wrap the text, not have large margins

4. OUTPUT FORMAT:
   Return ONLY valid JSON array of effects. Each effect object must have:
   - effect_type: One of the effect IDs from the catalog
   - region OR start_region/end_region: Bounding box with left_pct, top_pct, right_pct, bottom_pct
   - start_time: When the effect starts (seconds)
   - duration: How long the effect lasts (seconds)

Example output format:
[
  {{
    "effect_type": "zoom_in",
    "region": {{
      "left_pct": 20,
      "top_pct": 30,
      "right_pct": 55,
      "bottom_pct": 65
    }},
    "zoom_start": 1.0,
    "zoom_end": 1.4,
    "start_time": 0,
    "duration": 2.0
  }},
  {{
    "effect_type": "highlight_spotlight",
    "region": {{
      "left_pct": 55,
      "top_pct": 35,
      "right_pct": 90,
      "bottom_pct": 70
    }},
    "darkness": 0.4,
    "pulse": true,
    "start_time": 1.5,
    "duration": 1.5
  }},
  {{
    "effect_type": "ken_burns",
    "start_region": {{
      "left_pct": 10,
      "top_pct": 20,
      "right_pct": 50,
      "bottom_pct": 60
    }},
    "end_region": {{
      "left_pct": 50,
      "top_pct": 40,
      "right_pct": 95,
      "bottom_pct": 85
    }},
    "zoom_start": 1.0,
    "zoom_end": 1.3,
    "start_time": 2.0,
    "duration": 2.0
  }}
]"""

    user_prompt = f"""Analyze this image and create an effects plan for a {duration}-second scroll-stopping video.

IMAGE DETAILS:
- Original size: {img_width}x{img_height} pixels
- Output aspect ratio: {aspect_ratio} ({output_size[0]}x{output_size[1]})

USER'S INSTRUCTIONS:
{user_instructions if user_instructions else "Create an engaging video that highlights the most interesting parts of the image"}

STEP-BY-STEP ANALYSIS REQUIRED:

1. LOCATE KEY ELEMENTS - For each important element in the image, estimate its position:
   - Mentally divide the image into a 10x10 grid
   - X coordinate: Count how many grid columns from the LEFT edge (0-10, then multiply by 10 for percentage)
   - Y coordinate: Count how many grid rows from the TOP edge (0-10, then multiply by 10 for percentage)
   - Example: An element 6 columns from left and 4 rows from top = (x: 60, y: 40)

2. VERIFY YOUR COORDINATES:
   - If element is clearly in the RIGHT half → X should be > 50
   - If element is clearly in the BOTTOM half → Y should be > 50
   - If element is in the center → both X and Y should be around 45-55
   - Don't underestimate! If something looks like it's at 60%, don't write 40%

3. SELECT EFFECTS that best showcase each element

4. PLAN TIMING for a {duration}-second engaging video

OUTPUT: Return ONLY a JSON array of effects. No markdown, no explanation.

Remember: Accurate coordinates are CRITICAL. Double-check each percentage before including it."""

    try:
        print(f"\n  🔗 Connecting to Grok-4-latest...")
        client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
        chat = client.chat.create(model="grok-4-fast-reasoning")
        
        chat.append(system(system_prompt))
        
        # Add image
        chat.append(user(user_prompt, image(image_url=image_data_url, detail="high")))
        
        print(f"  📤 Sending image to Grok for analysis...")
        response = chat.sample()
        response_text = response.content.strip()
        
        print(f"  ✅ Grok analysis complete")
        print(f"  📝 Response length: {len(response_text)} chars")
        
        # Log full Grok response for debugging
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
        
        # Find JSON array
        if not json_content.startswith("["):
            start_idx = json_content.find("[")
            end_idx = json_content.rfind("]") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_content = json_content[start_idx:end_idx]
        
        # Fix common JSON issues
        json_content = re.sub(r',(\s*[\]\}])', r'\1', json_content)
        
        effects_plan = json.loads(json_content)
        
        # Log detailed effects plan for debugging
        print(f"\n{'='*60}")
        print(f"📋 PARSED EFFECTS PLAN ({len(effects_plan)} effects):")
        print(f"{'='*60}")
        for i, effect in enumerate(effects_plan):
            print(f"\n  Effect {i+1}: {effect.get('effect_type')}")
            print(f"  {'─'*40}")
            for key, value in effect.items():
                if key != 'effect_type':
                    print(f"    {key}: {value}")
        print(f"\n{'='*60}\n")
        
        return effects_plan
        
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse Grok JSON response: {e}")
        print(f"  📄 Raw response: {response_text[:500]}...")
        return get_fallback_effects_plan(duration)
    except Exception as e:
        print(f"  ❌ Grok analysis failed: {e}")
        import traceback
        print(traceback.format_exc())
        return get_fallback_effects_plan(duration)


def analyze_multiple_folds_for_highlight(
    fold_image_paths: List[str],
    duration: float,
    aspect_ratio: str,
    search_text: str,
    use_vision_api: bool = True,
    skip_zoom: bool = False,
    highlight_style: str = "sweep",
    known_fold_index: int = None
) -> Tuple[Optional[str], List[Dict]]:
    """
    Analyze multiple fold images to find which one contains the target text.
    
    Two-step approach:
    1. Use Grok to identify which fold contains the target text (SKIPPED if known_fold_index provided)
    2. Use Google Vision API on that specific fold for accurate bounding box
    
    Args:
        fold_image_paths: List of paths to fold images (fold_1.png, fold_2.png, etc.)
        duration: Video duration in seconds
        aspect_ratio: Output aspect ratio
        search_text: The text to search for and highlight
        use_vision_api: Whether to use Google Vision API for coordinates (default: True)
        skip_zoom: Whether to skip zoom/pan effects (True for mobile viewport)
        highlight_style: "sweep" (L→R), "sweep-down" (top→bottom for multi-line), or "static"
        known_fold_index: If already known which fold has the text (1-based), skip Grok search
        
    Returns:
        Tuple of (image_path, effects_plan) or (None, []) if text not found
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    
    print(f"\n{'='*60}")
    print(f"🔍 MULTI-FOLD TEXT SEARCH & HIGHLIGHT")
    print(f"{'='*60}")
    print(f"  Searching in {len(fold_image_paths)} fold images")
    print(f"  Target text: '{search_text[:80]}{'...' if len(search_text) > 80 else ''}'")
    print(f"  Duration: {duration}s")
    print(f"  Aspect Ratio: {aspect_ratio}")
    
    # Get output dimensions
    output_size = ASPECT_RATIOS.get(aspect_ratio, (1080, 1920))
    print(f"  Output Size: {output_size[0]}x{output_size[1]}")
    
    # ================================================================
    # STEP 1: Identify which fold contains the text
    # ================================================================
    selected_image_path = None
    
    # If we already know which fold has the text (from earlier Grok suggestion), skip this step
    if known_fold_index is not None:
        print(f"\n  📋 STEP 1: SKIPPED - Fold #{known_fold_index} already identified by Grok suggestion")
        
        # Validate and use the known index
        if known_fold_index >= 1 and known_fold_index <= len(fold_image_paths):
            selected_image_path = fold_image_paths[known_fold_index - 1]
            print(f"  🖼️ Using pre-identified fold: {selected_image_path}")
            
            # Load image to get dimensions
            img = Image.open(selected_image_path)
            print(f"    Size: {img.size[0]}x{img.size[1]}")
        else:
            print(f"  ❌ Invalid known fold index {known_fold_index}")
            return (None, [])
    else:
        # Need to ask Grok which fold has the user-specified text
        print(f"\n  📋 STEP 1: Using Grok to identify which fold contains the text...")
        
        # Prepare all images for Grok
        image_data_urls = []
        for i, img_path in enumerate(fold_image_paths):
            print(f"  Loading fold {i+1}: {img_path}")
            
            img = Image.open(img_path)
            img_width, img_height = img.size
            print(f"    Size: {img_width}x{img_height}")
            
            with open(img_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
            
            ext = img_path.lower().split('.')[-1]
            mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
            mime_type = mime_types.get(ext, 'image/jpeg')
            image_data_urls.append(f"data:{mime_type};base64,{image_data}")
        
        # Grok prompt - ONLY asks which image contains the text, NOT coordinates
        system_prompt = f"""You are an expert at finding specific text in images.

You will be shown {len(fold_image_paths)} images (Image 1, Image 2, etc.). These are consecutive "folds" (screen-sized sections) of a webpage article.

Your task is ONLY to identify which image contains the specified text.
Do NOT provide coordinates - just identify the image number.

OUTPUT FORMAT (JSON only):
{{
  "found": true/false,
  "image_index": 1-based index (1, 2, 3, etc.) or null if not found,
  "confidence": "high" or "medium" or "low" or "none"
}}

Return ONLY the JSON object, no explanation."""

        user_prompt = f"""Which of these {len(fold_image_paths)} images contains the following text?

TEXT TO FIND:
"{search_text}"

Return ONLY the image number in JSON format."""

        try:
            print(f"\n  🔗 Connecting to Grok-4-latest...")
            client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
            chat = client.chat.create(model="grok-4-fast-reasoning")
            
            chat.append(system(system_prompt))
            
            content_items = [user_prompt]
            for i, img_url in enumerate(image_data_urls):
                content_items.append(image(image_url=img_url, detail="high"))
            
            chat.append(user(*content_items))
            
            print(f"  📤 Sending {len(fold_image_paths)} images to Grok...")
            response = chat.sample()
            response_text = response.content.strip()
            
            print(f"  ✅ Grok analysis complete")
            print(f"\n{'='*60}")
            print(f"📄 GROK RESPONSE:")
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
            
            result = json.loads(json_content)
            
            if not result.get("found", False):
                print(f"  ⚠️ Grok: Text not found in any fold image")
                return (None, [])
            
            image_index = result.get("image_index", 1)
            confidence = result.get("confidence", "unknown")
            
            print(f"  ✅ Grok found text in Image {image_index} (confidence: {confidence})")
            
            # Validate image index
            if image_index < 1 or image_index > len(fold_image_paths):
                print(f"  ❌ Invalid image index {image_index}")
                return (None, [])
            
            selected_image_path = fold_image_paths[image_index - 1]
            print(f"  🖼️ Selected fold: {selected_image_path}")
            
        except json.JSONDecodeError as e:
            print(f"  ❌ Failed to parse Grok JSON response: {e}")
            return (None, [])
        except Exception as e:
            print(f"  ❌ Grok fold identification failed: {e}")
            import traceback
            print(traceback.format_exc())
            return (None, [])
    
    # ================================================================
    # STEP 2: Use GOOGLE VISION API for accurate bounding box
    # ================================================================
    bbox = None
    
    if use_vision_api and GOOGLE_API_KEY:
        print(f"\n  📐 STEP 2: Using Google Vision API for precise bounding box...")
        
        bbox = find_text_with_google_vision(
            image_path=selected_image_path,
            search_text=search_text
        )
        
        if bbox:
            print(f"\n  ✅ Google Vision API: Got precise coordinates")
        else:
            print(f"\n  ⚠️ Google Vision API couldn't find text, using Grok coordinates as fallback...")
    else:
        if not GOOGLE_API_KEY:
            print(f"\n  ⚠️ GOOGLE_API_KEY not set, skipping Vision API")
        else:
            print(f"\n  ⚠️ Vision API disabled, skipping")
    
    # ================================================================
    # STEP 3: Create effects plan
    # ================================================================
    if bbox:
        # Use Vision API coordinates (accurate bounding box for the text)
        left_pct, top_pct, right_pct, bottom_pct = bbox
        from_vision_api = True
        print(f"  📏 Using precise Vision API coordinates:")
        print(f"     Region: left={left_pct:.1f}%, top={top_pct:.1f}%, right={right_pct:.1f}%, bottom={bottom_pct:.1f}%")
    else:
        # Fallback: Use approximate coordinates (center of image)
        print(f"  ⚠️ Using fallback coordinates (center region)")
        left_pct, top_pct, right_pct, bottom_pct = 3, 40, 97, 60
        from_vision_api = False
    
    # Calculate zoom target region (center on the highlighted text with some padding)
    # This creates a subtle zoom into the text area
    zoom_center_y = (top_pct + bottom_pct) / 2
    zoom_padding = 15  # Add padding around the text for zoom target
    zoom_top = max(0, zoom_center_y - zoom_padding)
    zoom_bottom = min(100, zoom_center_y + zoom_padding)
    
    # Calculate blur region (slightly expanded from highlight for better focus effect)
    blur_region_top = max(0, top_pct - 5)
    blur_region_bottom = min(100, bottom_pct + 5)
    
    # IMPORTANT: Apply effects in correct order:
    # 1. Background blur (first, so highlight appears on top of blurred bg)
    # 2. Highlight overlay
    # 3. Zoom (last, so everything zooms together)
    effects_plan = [
        # Background blur - gradually increases over duration
        # Starts sharp (blur_start=0), ends blurred (blur_end=10)
        {
            "effect_type": "focus_rack",
            "start_region": {
                "left_pct": 0,
                "top_pct": blur_region_top,
                "right_pct": 100,
                "bottom_pct": blur_region_bottom
            },
            "end_region": {
                "left_pct": 0,
                "top_pct": blur_region_top,
                "right_pct": 100,
                "bottom_pct": blur_region_bottom
            },
            "blur_start": 0,   # Start with no blur
            "blur_end": 10,    # End with moderate blur
            "start_time": 0,
            "duration": duration
        },
        # Highlight overlay - configurable style
        {
            "effect_type": "highlight_overlay",
            "region": {
                "left_pct": left_pct,
                "top_pct": top_pct,
                "right_pct": right_pct,
                "bottom_pct": bottom_pct
            },
            "feather": 2,
            # Highlight animation style based on CLI parameter
            "progressive": highlight_style == "sweep",      # L→R sweep
            "progressive_down": highlight_style == "sweep-down",  # Top→bottom for multi-line
            # Static mode: use pulse/fade for full box highlight
            "pulse": highlight_style == "static",
            "pulse_speed": 1.5,
            "fade_in": highlight_style == "static",
            "fade_in_duration": 0.4,
            "start_time": 0,
            "duration": duration,
            "_from_vision_api": from_vision_api
        }
    ]
    
    # Add zoom effect only if not in mobile mode (mobile viewport is too small for zoom)
    if not skip_zoom:
        effects_plan.append({
            "effect_type": "zoom_in",
            "region": {
                "left_pct": 10,
                "top_pct": zoom_top,
                "right_pct": 90,
                "bottom_pct": zoom_bottom
            },
            "zoom_start": 1.0,
            "zoom_end": 1.08,  # Subtle 8% zoom
            "start_time": 0,
            "duration": duration
        })
    
    # Describe highlight style in logs
    style_desc = {
        "sweep": "highlight_sweep (L→R)",
        "sweep-down": "highlight_sweep (↓) for multi-line",
        "static": "highlight_static (pulse)"
    }.get(highlight_style, "highlight")
    
    print(f"\n  ✅ Effects plan created (Vision API: {from_vision_api})")
    if skip_zoom:
        print(f"  🎬 Effects: progressive_blur (0→10) + {style_desc} (no zoom - mobile mode)")
    else:
        print(f"  🎬 Effects: progressive_blur (0→10) + {style_desc} + subtle zoom_in")
    
    return (selected_image_path, effects_plan)


def get_fallback_effects_plan(duration: float) -> List[Dict]:
    """Fallback effects plan if Grok fails - uses new bounding box format"""
    print(f"  ⚠️ Using fallback effects plan")
    
    segment = duration / 3
    
    return [
        {
        "effect_type": "ken_burns",
        "start_region": {
                "left_pct": 15,
                "top_pct": 15,
                "right_pct": 55,
                "bottom_pct": 55
        },
        "end_region": {
                "left_pct": 45,
                "top_pct": 45,
                "right_pct": 85,
                "bottom_pct": 85
        },
        "zoom_start": 1.0,
        "zoom_end": 1.3,
        "start_time": 0,
        "duration": segment * 2
        },
        {
        "effect_type": "highlight_spotlight",
        "region": {
                "left_pct": 30,
                "top_pct": 30,
                "right_pct": 70,
                "bottom_pct": 70
        },
        "darkness": 0.35,
        "pulse": True,
        "start_time": segment,
        "duration": segment
        },
        {
        "effect_type": "zoom_pulse",
        "region": {
                "left_pct": 30,
                "top_pct": 30,
                "right_pct": 70,
                "bottom_pct": 70
        },
        "pulse_scale": 1.08,
        "pulse_count": 2,
        "start_time": segment * 2,
        "duration": segment
        }
    ]


# ============================================
# MAIN FUNCTION
# ============================================

def parse_aspect_ratio(ratio_str: str) -> Tuple[int, int]:
    """Parse aspect ratio string to dimensions"""
    if ratio_str in ASPECT_RATIOS:
        return ASPECT_RATIOS[ratio_str]
    
    # Try parsing as WIDTHxHEIGHT
    if 'x' in ratio_str.lower():
        parts = ratio_str.lower().split('x')
        try:
            return (int(parts[0]), int(parts[1]))
        except ValueError:
            pass
    
    # Default to 9:16
    print(f"⚠️ Unknown aspect ratio '{ratio_str}', using 9:16")
    return ASPECT_RATIOS["9:16"]


def main():
    parser = argparse.ArgumentParser(
        description="AI-Powered Dynamic Image to Video Converter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python dynamic_video_generator.py --image photo.png --duration 6 --aspect-ratio 9:16 --instructions "Focus on the product, then zoom out"
  python dynamic_video_generator.py --image comparison.jpg --duration 4 --aspect-ratio 1:1 --instructions "Highlight the difference between left and right"
  python dynamic_video_generator.py --image chart.png --duration 8 --aspect-ratio 16:9 --instructions "Start from the title, pan across the data points"
  python dynamic_video_generator.py --image sale.png --duration 5 -hc yellow -ha 0.7 --instructions "Use highlight_overlay effect on the price tag"
  python dynamic_video_generator.py --image article.png --duration 6 -hc "#FF6B6B" -ha 0.5 --instructions "Highlight the headline with highlight_overlay"

Available Aspect Ratios:
  9:16  - TikTok, Reels, Shorts (1080x1920)
  16:9  - YouTube landscape (1920x1080)
  1:1   - Instagram square (1080x1080)
  4:5   - Instagram portrait (1080x1350)
  4:3   - Traditional (1440x1080)
  WxH   - Custom dimensions (e.g., 1280x720)

Highlight Colors:
  Basic:    black, white, red, green, blue, yellow, cyan, magenta
  Extended: orange, pink, purple, lime, navy, teal, coral, gold, gray
  Light:    lightyellow, lightgreen, lightblue, lightpink, lavender, mint, cream
  Vibrant:  hotpink, tomato, chartreuse, turquoise, violet, indigo, crimson
  Neon:     neongreen, neonpink, neonyellow, neonorange, neonblue
  Hex:      #FF6B6B, #00FF00, #123456, etc.
        """
    )
    
    parser.add_argument(
        "--image", "-i",
        required=True,
        help="Path to input image"
    )
    parser.add_argument(
        "--output", "-o",
        help="Path to output video (default: input_name_video.mp4)"
    )
    parser.add_argument(
        "--duration", "-d",
        type=float,
        default=6.0,
        help="Video duration in seconds (default: 6)"
    )
    parser.add_argument(
        "--aspect-ratio", "-a",
        default="9:16",
        help="Output aspect ratio (default: 9:16)"
    )
    parser.add_argument(
        "--instructions", "-t",
        default="",
        help="Instructions for Grok on what to focus on and how to animate"
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=30,
        help="Frames per second (default: 30)"
    )
    parser.add_argument(
        "--highlight-color", "-hc",
        default="yellow",
        help="Default highlight overlay color: yellow, red, green, blue, orange, pink, cyan, white, or hex code (default: yellow)"
    )
    parser.add_argument(
        "--highlight-alpha", "-ha",
        type=float,
        default=0.7,
        help="Default highlight overlay opacity 0.0-1.0 (default: 0.7)"
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip Grok analysis and use fallback effects"
    )
    
    args = parser.parse_args()
    
    # Validate input
    if not os.path.exists(args.image):
        print(f"❌ Error: Image not found: {args.image}")
        sys.exit(1)
    
    # Set output path
    if args.output:
        output_path = args.output
    else:
        base_name = os.path.splitext(os.path.basename(args.image))[0]
        output_dir = os.path.dirname(args.image) or "."
        output_path = os.path.join(output_dir, f"{base_name}_video.mp4")
    
    # Parse aspect ratio
    output_size = parse_aspect_ratio(args.aspect_ratio)
    
    # Validate duration
    if args.duration < 2 or args.duration > 30:
        print(f"⚠️ Duration should be between 2-30 seconds, got {args.duration}")
        args.duration = max(2, min(30, args.duration))
    
    # Validate highlight alpha
    if args.highlight_alpha < 0.0 or args.highlight_alpha > 1.0:
        print(f"⚠️ Highlight alpha should be between 0.0-1.0, got {args.highlight_alpha}")
        args.highlight_alpha = max(0.0, min(1.0, args.highlight_alpha))
    
    print(f"\n{'='*60}")
    print(f"🎬 DYNAMIC VIDEO GENERATOR")
    print(f"{'='*60}")
    print(f"  Input Image: {args.image}")
    print(f"  Output Video: {output_path}")
    print(f"  Duration: {args.duration}s")
    print(f"  Aspect Ratio: {args.aspect_ratio} ({output_size[0]}x{output_size[1]})")
    print(f"  FPS: {args.fps}")
    print(f"  Highlight Color: {args.highlight_color}")
    print(f"  Highlight Alpha: {args.highlight_alpha}")
    print(f"  Instructions: {args.instructions or '(auto)'}")
    
    # Get effects plan
    if args.no_ai:
        effects_plan = get_fallback_effects_plan(args.duration)
    else:
        effects_plan = analyze_image_and_plan_effects(
        args.image,
        args.duration,
        args.aspect_ratio,
        args.instructions
        )
    
    # Create video
    engine = EffectEngine(
        image_path=args.image,
        output_size=output_size,
        duration=args.duration,
        fps=args.fps,
        highlight_color=args.highlight_color,
        highlight_alpha=args.highlight_alpha
    )
    engine.set_effects_plan(effects_plan)
    engine.generate_video(output_path)
    
    print(f"\n🎉 Done! Video saved to: {output_path}")


if __name__ == "__main__":
    main()
