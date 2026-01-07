"""
AI-Powered Dynamic Image to Video Converter
Creates scroll-stopping videos with cinematic effects driven by Grok-4-latest vision analysis

Usage:
    python dynamic_video_generator.py --image /path/to/image.png --duration 6 --aspect-ratio 9:16 --instructions "Focus on the product, then highlight the price"

Requirements:
    pip install moviepy pillow numpy xai-sdk
"""

import os
import sys
import json
import argparse
import re
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from enum import Enum

from moviepy.editor import ImageClip, CompositeVideoClip, ColorClip
from moviepy.video.fx import resize, crop
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

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
    
    def __init__(self, image_path: str, output_size: Tuple[int, int], duration: float, fps: int = 30):
        self.image_path = image_path
        self.output_size = output_size
        self.duration = duration
        self.fps = fps
        self.effects_plan: List[Dict] = []
        
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
        """Apply focus rack / depth of field shift effect"""
        start_time = effect.get("start_time", 0)
        duration = effect.get("duration", self.duration)
        start_region = extract_region(effect, "start_region")
        end_region = extract_region(effect, "end_region")
        blur_amount = effect.get("blur_amount", 10)
        
        progress = (t - start_time) / duration
        progress = max(0, min(1, progress))
        progress = ease_in_out(progress)
        
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
        focus_mask = start_mask * (1 - progress) + end_mask * progress
        
        # Create blurred version
        pil_img = Image.fromarray(frame)
        blurred = np.array(pil_img.filter(ImageFilter.GaussianBlur(radius=blur_amount)))
        
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
    
    def process_frame(self, get_frame, t: float) -> np.ndarray:
        """Process a single frame applying all active effects"""
        frame = get_frame(t)
        
        # Get active effects for this time
        active_effects = self._get_active_effects(t)
        
        # Apply effects in order
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
        chat = client.chat.create(model="grok-4-latest")
        
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

Available Aspect Ratios:
  9:16  - TikTok, Reels, Shorts (1080x1920)
  16:9  - YouTube landscape (1920x1080)
  1:1   - Instagram square (1080x1080)
  4:5   - Instagram portrait (1080x1350)
  4:3   - Traditional (1440x1080)
  WxH   - Custom dimensions (e.g., 1280x720)
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
    
    print(f"\n{'='*60}")
    print(f"🎬 DYNAMIC VIDEO GENERATOR")
    print(f"{'='*60}")
    print(f"  Input Image: {args.image}")
    print(f"  Output Video: {output_path}")
    print(f"  Duration: {args.duration}s")
    print(f"  Aspect Ratio: {args.aspect_ratio} ({output_size[0]}x{output_size[1]})")
    print(f"  FPS: {args.fps}")
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
        fps=args.fps
    )
    engine.set_effects_plan(effects_plan)
    engine.generate_video(output_path)
    
    print(f"\n🎉 Done! Video saved to: {output_path}")


if __name__ == "__main__":
    main()
