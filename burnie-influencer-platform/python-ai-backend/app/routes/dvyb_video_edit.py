"""
DVYB Video Edit Route

Endpoint for processing video edits (timeline, clips, audio, effects).
Called by TypeScript backend as a background job.
"""

import os
import tempfile
import subprocess
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import httpx
import requests
import boto3
from botocore.exceptions import ClientError
from moviepy.editor import (
    VideoFileClip, AudioFileClip, ImageClip, TextClip,
    concatenate_videoclips, concatenate_audioclips,
    CompositeVideoClip, CompositeAudioClip,
    ColorClip
)
import moviepy.audio.fx.all as afx
from PIL import Image, ImageDraw, ImageFont
import numpy as np

router = APIRouter()

# Initialize S3 client
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION', 'us-east-1')
)
S3_BUCKET = os.getenv('S3_BUCKET_NAME', 'burnie-mindshare-content-staging')
# Public bucket for admin assets (dvyb-assets)
BURNIE_VIDEOS_BUCKET = 'burnie-videos'


class VideoClip(BaseModel):
    """Video clip configuration"""
    id: str
    trackId: Optional[str] = None
    name: Optional[str] = "Clip"
    startTime: float = 0
    duration: float = 0
    sourceStart: Optional[float] = 0
    sourceDuration: Optional[float] = None
    src: Optional[str] = None
    type: str = "video"
    thumbnail: Optional[str] = None
    transform: Optional[Dict[str, Any]] = None
    position: Optional[Dict[str, Any]] = None
    size: Optional[Dict[str, Any]] = None
    volume: Optional[float] = 100
    fadeIn: Optional[float] = 0
    fadeOut: Optional[float] = 0
    muted: Optional[bool] = False
    filters: Optional[Dict[str, Any]] = None
    filterPreset: Optional[str] = None
    transitionIn: Optional[str] = None
    transitionOut: Optional[str] = None
    transitionInDuration: Optional[float] = 0
    transitionOutDuration: Optional[float] = 0
    text: Optional[Dict[str, Any]] = None
    blendMode: Optional[str] = None
    flipHorizontal: Optional[bool] = False
    flipVertical: Optional[bool] = False
    cornerRadius: Optional[float] = 0
    borderWidth: Optional[float] = 0
    borderColor: Optional[str] = None
    shadowEnabled: Optional[bool] = False
    shadowColor: Optional[str] = None
    shadowBlur: Optional[float] = 0
    shadowOffsetX: Optional[float] = 0
    shadowOffsetY: Optional[float] = 0
    speed: Optional[float] = 1.0
    aiGenerated: Optional[bool] = False
    aiModified: Optional[bool] = False
    
    class Config:
        extra = "allow"  # Allow extra fields


class VideoTrack(BaseModel):
    """Video track configuration"""
    id: str
    name: str
    type: str
    clips: List[VideoClip] = []
    muted: bool = False
    locked: bool = False
    visible: bool = True
    height: Optional[int] = None
    color: Optional[str] = None
    
    class Config:
        extra = "allow"  # Allow extra fields


class ExportSettings(BaseModel):
    """Export settings"""
    resolution: Optional[str] = "1080p"
    format: Optional[str] = "mp4"
    quality: Optional[str] = "high"
    fps: Optional[int] = 30
    
    class Config:
        extra = "allow"


class ProcessVideoRequest(BaseModel):
    """Request body for processing video edits"""
    accountId: int
    generatedContentId: Optional[int] = None
    postIndex: Optional[int] = None
    editId: int
    originalVideoUrl: Optional[str] = None
    tracks: List[VideoTrack] = []
    duration: float = 30
    aspectRatio: str = "9:16"
    callbackUrl: Optional[str] = None
    exportSettings: Optional[ExportSettings] = None
    
    class Config:
        extra = "allow"  # Allow extra fields not defined in the model


def extract_s3_key_from_url(url: str) -> str:
    """Extract S3 key from presigned URL or S3 URL
    
    For S3 URLs, the format can be:
    - bucket.s3.region.amazonaws.com/key -> pathname IS the key (don't remove anything)
    - s3.amazonaws.com/bucket/key -> pathname is /bucket/key (remove bucket)
    """
    try:
        from urllib.parse import urlparse, unquote
        
        # If it's a presigned URL, extract the key from the path
        if 'amazonaws.com' in url:
            parsed = urlparse(url)
            # Remove query parameters and get the path
            s3_key = parsed.path.lstrip('/')
            # URL decode the key
            s3_key = unquote(s3_key)
            
            # Check if hostname format is bucket.s3.region.amazonaws.com
            # In this case, pathname is already the full S3 key
            hostname_parts = parsed.hostname.split('.')
            is_bucket_in_hostname = len(hostname_parts) > 3 and hostname_parts[1] == 's3'
            
            if not is_bucket_in_hostname:
                # Hostname is s3.amazonaws.com or s3.region.amazonaws.com
                # Path format: /bucket/key, so remove bucket name (first part)
                parts = s3_key.split('/')
                if len(parts) > 1:
                    s3_key = '/'.join(parts[1:])
            
            # Remove query parameters if any (shouldn't be needed after urlparse, but just in case)
            if '?' in s3_key:
                s3_key = s3_key.split('?')[0]
            
            return s3_key
        elif url.startswith('s3://'):
            # Extract from s3://bucket/key format
            parts = url.replace('s3://', '').split('/', 1)
            if len(parts) > 1:
                return parts[1]
            return parts[0] if parts else ''
        else:
            # Assume it's already an S3 key
            return url
    except Exception as e:
        print(f"⚠️ Failed to extract S3 key from URL: {e}")
        return url


def download_from_url(url: str, local_path: str) -> bool:
    """Download file from URL (presigned S3 URL or any HTTP URL)
    
    If it's an S3 presigned URL, we'll try to generate a fresh one using Python's S3 credentials
    to avoid 403 errors from expired or mismatched credentials.
    """
    try:
        # Check if it's an S3 presigned URL
        if 'amazonaws.com' in url and ('X-Amz-Signature' in url or 'x-amz-signature' in url.lower()):
            print(f"🔄 Detected S3 presigned URL, generating fresh presigned URL...")
            try:
                # Extract S3 key from the presigned URL
                s3_key = extract_s3_key_from_url(url)
                print(f"📎 Extracted S3 key: {s3_key}")
                
                # Generate fresh presigned URL using Python's S3 credentials
                from app.services.s3_storage_service import get_s3_storage
                s3_service = get_s3_storage()
                
                presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
                
                if presigned_result.get('success'):
                    url = presigned_result['presigned_url']
                    print(f"✅ Generated fresh presigned URL for download")
                else:
                    print(f"⚠️ Failed to generate fresh presigned URL: {presigned_result.get('error')}")
                    print(f"⚠️ Falling back to original URL...")
            except Exception as e:
                print(f"⚠️ Error generating fresh presigned URL: {e}")
                print(f"⚠️ Falling back to original URL...")
        
        print(f"📥 Downloading from URL: {url[:100]}...")
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()
        
        with open(local_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"✅ Downloaded to {local_path}")
        return True
    except Exception as e:
        print(f"❌ Failed to download from URL: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response status: {e.response.status_code}")
            print(f"   Response headers: {dict(e.response.headers)}")
        return False


def download_from_s3(s3_key_or_url: str, local_path: str) -> bool:
    """Download file from S3 - handles presigned URLs, S3 keys, and s3:// URLs
    
    For presigned URLs: Generates a fresh presigned URL using Python's S3 credentials
    For S3 keys: Generates a presigned URL and downloads via HTTP (more reliable)
    """
    try:
        if not s3_key_or_url:
            print("❌ No S3 key or URL provided")
            return False
        
        # If it's a presigned URL (starts with http/https), download via HTTP
        if s3_key_or_url.startswith('http://') or s3_key_or_url.startswith('https://'):
            return download_from_url(s3_key_or_url, local_path)
        
        # Handle s3:// protocol or plain S3 key
        s3_key = s3_key_or_url
        if s3_key.startswith('s3://'):
            # Extract key from s3://bucket/key format
            parts = s3_key.replace('s3://', '').split('/', 1)
            if len(parts) > 1:
                s3_key = parts[1]
            else:
                s3_key = parts[0] if parts else ''
        
        # Remove leading slash if present
        s3_key = s3_key.lstrip('/')
        
        # Check if this is a dvyb-assets file (admin assets in burnie-videos bucket)
        is_dvyb_asset = s3_key.startswith('dvyb-assets/')
        bucket = BURNIE_VIDEOS_BUCKET if is_dvyb_asset else S3_BUCKET
        
        if is_dvyb_asset:
            print(f"📎 Detected dvyb-assets file, using burnie-videos bucket (public)")
            # For public assets, use public URL directly (no presigned URL needed)
            public_url = f"https://{BURNIE_VIDEOS_BUCKET}.s3.amazonaws.com/{s3_key}"
            print(f"📥 Downloading from public URL: {public_url[:100]}...")
            return download_from_url(public_url, local_path)
        
        print(f"📎 Generating presigned URL for S3 key: {s3_key} (bucket: {bucket})")
        
        # First, check if the object exists in S3
        try:
            s3_client.head_object(Bucket=bucket, Key=s3_key)
            print(f"✅ S3 object exists: s3://{bucket}/{s3_key}")
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code == '404' or error_code == 'NoSuchKey':
                print(f"❌ S3 object does not exist: s3://{bucket}/{s3_key}")
                print(f"   Please verify the S3 key is correct and the file was uploaded successfully")
                return False
            else:
                print(f"⚠️ Error checking S3 object existence: {e}")
                # Continue anyway, might be a permissions issue
        
        # Generate presigned URL using Python's S3 service (more reliable than direct SDK download)
        try:
            from app.services.s3_storage_service import get_s3_storage
            s3_service = get_s3_storage()
            
            presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
            
            if presigned_result.get('success'):
                presigned_url = presigned_result['presigned_url']
                print(f"✅ Generated presigned URL, downloading...")
                return download_from_url(presigned_url, local_path)
            else:
                print(f"⚠️ Failed to generate presigned URL: {presigned_result.get('error')}")
                print(f"⚠️ Falling back to direct S3 SDK download...")
        except Exception as e:
            print(f"⚠️ Error using S3 service: {e}")
            print(f"⚠️ Falling back to direct S3 SDK download...")
        
        # Fallback: Download using S3 SDK directly
        try:
            s3_client.download_file(bucket, s3_key, local_path)
            print(f"✅ Downloaded {s3_key} from {bucket} to {local_path}")
            return True
        except Exception as e:
            print(f"❌ Failed to download from S3: {e}")
            return False
    except Exception as e:
        print(f"❌ Failed to download {s3_key_or_url}: {e}")
        return False


def upload_to_s3(local_path: str, s3_key: str) -> bool:
    """Upload file to S3"""
    try:
        file_size = os.path.getsize(local_path) / (1024 * 1024)  # Size in MB
        print(f"📤 Uploading {os.path.basename(local_path)} ({file_size:.2f} MB) to S3...")
        s3_client.upload_file(local_path, S3_BUCKET, s3_key)
        print(f"✅ Uploaded {local_path} to s3://{S3_BUCKET}/{s3_key}")
        return True
    except Exception as e:
        print(f"❌ Failed to upload {local_path}: {e}")
        import traceback
        traceback.print_exc()
        return False


def apply_filters(clip: VideoFileClip, filters: Dict[str, Any]) -> VideoFileClip:
    """Apply visual filters to clip"""
    if not filters:
        return clip
    
    # Brightness (0-200, 100 = normal)
    brightness = filters.get('brightness', 100) / 100.0
    
    # Contrast (0-200, 100 = normal)
    contrast = filters.get('contrast', 100) / 100.0
    
    # Saturation (0-200, 100 = normal)
    saturation = filters.get('saturation', 100) / 100.0
    
    # Hue rotation (degrees)
    hue = filters.get('hue', 0)
    
    # Apply brightness using color correction
    if brightness != 1.0:
        def adjust_brightness(frame):
            return np.clip(frame * brightness, 0, 255).astype('uint8')
        clip = clip.fl_image(adjust_brightness)
    
    # Apply contrast
    if contrast != 1.0:
        def adjust_contrast(frame):
            mean = 128
            return np.clip((frame - mean) * contrast + mean, 0, 255).astype('uint8')
        clip = clip.fl_image(adjust_contrast)
    
    # Apply saturation
    if saturation != 1.0:
        def adjust_saturation(frame):
            # Convert to float
            img = frame.astype('float32')
            # Calculate grayscale
            gray = np.dot(img[...,:3], [0.299, 0.587, 0.114])
            gray = np.stack([gray] * 3, axis=-1)
            # Interpolate between grayscale and original
            result = gray + saturation * (img - gray)
            return np.clip(result, 0, 255).astype('uint8')
        clip = clip.fl_image(adjust_saturation)
    
    # Apply hue rotation
    if hue != 0:
        def adjust_hue(frame):
            from PIL import Image
            img = Image.fromarray(frame)
            # Convert to HSV, rotate hue, convert back
            hsv = img.convert('HSV')
            h, s, v = hsv.split()
            # Rotate hue (hue is 0-255 in PIL)
            h_array = np.array(h, dtype='int32')
            h_array = (h_array + int(hue * 255 / 360)) % 256
            h = Image.fromarray(h_array.astype('uint8'))
            hsv = Image.merge('HSV', (h, s, v))
            return np.array(hsv.convert('RGB'))
        clip = clip.fl_image(adjust_hue)
    
    # Blur
    blur = filters.get('blur', 0)
    if blur > 0:
        def apply_blur(frame):
            from PIL import Image, ImageFilter
            img = Image.fromarray(frame)
            img = img.filter(ImageFilter.GaussianBlur(radius=blur))
            return np.array(img)
        clip = clip.fl_image(apply_blur)
    
    return clip


def apply_video_transitions(clip: VideoFileClip, clip_data: Any) -> VideoFileClip:
    """Apply transition effects (fade in/out) to video clip"""
    # Fade in
    transition_in = getattr(clip_data, 'transitionIn', 'none')
    transition_in_duration = getattr(clip_data, 'transitionInDuration', 0) or 0
    
    if transition_in == 'fade' and transition_in_duration > 0:
        clip = clip.fadein(transition_in_duration)
    elif transition_in == 'dissolve' and transition_in_duration > 0:
        clip = clip.fadein(transition_in_duration)
    
    # Fade out
    transition_out = getattr(clip_data, 'transitionOut', 'none')
    transition_out_duration = getattr(clip_data, 'transitionOutDuration', 0) or 0
    
    if transition_out == 'fade' and transition_out_duration > 0:
        clip = clip.fadeout(transition_out_duration)
    elif transition_out == 'dissolve' and transition_out_duration > 0:
        clip = clip.fadeout(transition_out_duration)
    
    return clip


def apply_speed_change(clip: VideoFileClip, speed: float) -> VideoFileClip:
    """Apply speed change to video clip"""
    if speed and speed != 1.0 and speed > 0:
        # Speed up or slow down
        clip = clip.fx(lambda c: c.speedx(speed))
    return clip


def apply_blend_mode(base_frame, overlay_frame, blend_mode: str):
    """Apply blend mode between two frames"""
    # Normalize to 0-1 range
    base = base_frame.astype('float32') / 255.0
    overlay = overlay_frame.astype('float32') / 255.0
    
    # Get alpha channel if present
    if overlay.shape[-1] == 4:
        alpha = overlay[:,:,3:4]
        overlay_rgb = overlay[:,:,:3]
    else:
        alpha = np.ones((*overlay.shape[:2], 1))
        overlay_rgb = overlay
    
    if base.shape[-1] == 4:
        base_rgb = base[:,:,:3]
    else:
        base_rgb = base
    
    # Apply blend mode
    if blend_mode == 'multiply':
        result = base_rgb * overlay_rgb
    elif blend_mode == 'screen':
        result = 1 - (1 - base_rgb) * (1 - overlay_rgb)
    elif blend_mode == 'overlay':
        mask = base_rgb < 0.5
        result = np.where(mask, 2 * base_rgb * overlay_rgb, 1 - 2 * (1 - base_rgb) * (1 - overlay_rgb))
    elif blend_mode == 'darken':
        result = np.minimum(base_rgb, overlay_rgb)
    elif blend_mode == 'lighten':
        result = np.maximum(base_rgb, overlay_rgb)
    elif blend_mode == 'soft-light':
        mask = overlay_rgb < 0.5
        result = np.where(mask, base_rgb - (1 - 2 * overlay_rgb) * base_rgb * (1 - base_rgb),
                         base_rgb + (2 * overlay_rgb - 1) * (np.sqrt(base_rgb) - base_rgb))
    elif blend_mode == 'difference':
        result = np.abs(base_rgb - overlay_rgb)
    else:  # normal
        result = overlay_rgb
    
    # Apply alpha blending
    blended = base_rgb * (1 - alpha) + result * alpha
    
    # Convert back to 0-255 range
    return np.clip(blended * 255, 0, 255).astype('uint8')


def create_text_clip(text_config: Dict[str, Any], duration: float, size: tuple) -> Optional[TextClip]:
    """Create a text clip with styling"""
    try:
        content = text_config.get('content', '')
        if not content:
            return None
        
        fontsize = text_config.get('fontSize', 48)
        font = text_config.get('fontFamily', 'Arial')
        color = text_config.get('color', '#FFFFFF')
        bg_color = text_config.get('backgroundColor')
        font_weight = text_config.get('fontWeight', 400)
        has_shadow = text_config.get('shadow', False)
        
        # Calculate position
        text_align = text_config.get('textAlign', 'center')
        vertical_align = text_config.get('verticalAlign', 'middle')
        
        # Adjust font for weight (bold)
        font_to_use = font
        if font_weight >= 700:
            # Try to use bold variant
            if 'Bold' not in font:
                font_to_use = f"{font}-Bold"
        
        # Create text clip
        try:
            txt_clip = TextClip(
                content,
                fontsize=fontsize,
                color=color,
                font=font_to_use,
                method='caption',
                size=(size[0] * 0.9, None),  # 90% width for padding
                align=text_align
            )
        except Exception:
            # Fallback if font not found
            txt_clip = TextClip(
                content,
                fontsize=fontsize,
                color=color,
                font='Arial',
                method='caption',
                size=(size[0] * 0.9, None),
                align=text_align
            )
        
        # Set duration
        txt_clip = txt_clip.set_duration(duration)
        
        # Position based on vertical alignment
        if vertical_align == 'top':
            y_pos = 50
        elif vertical_align == 'bottom':
            y_pos = size[1] - txt_clip.h - 100  # More space from bottom
        else:  # middle
            y_pos = (size[1] - txt_clip.h) / 2
        
        # Horizontal positioning
        if text_align == 'left':
            x_pos = 50
        elif text_align == 'right':
            x_pos = size[0] - txt_clip.w - 50
        else:  # center
            x_pos = (size[0] - txt_clip.w) / 2
        
        # Create shadow if enabled
        if has_shadow:
            shadow_clip = TextClip(
                content,
                fontsize=fontsize,
                color='black',
                font=font_to_use if 'Bold' not in font_to_use or font_weight < 700 else font,
                method='caption',
                size=(size[0] * 0.9, None),
                align=text_align
            ).set_duration(duration).set_position((x_pos + 3, y_pos + 3)).set_opacity(0.6)
            
            txt_clip = txt_clip.set_position((x_pos, y_pos))
            
            # Composite shadow under text
            if bg_color:
                bg = ColorClip(
                    size=(txt_clip.w + 20, txt_clip.h + 20),
                    color=bg_color,
                    duration=duration
                ).set_position((x_pos - 10, y_pos - 10))
                return CompositeVideoClip([bg, shadow_clip, txt_clip], size=size)
            else:
                return CompositeVideoClip([shadow_clip, txt_clip], size=size)
        
        txt_clip = txt_clip.set_position((x_pos, y_pos))
        
        # Add background if specified
        if bg_color:
            bg = ColorClip(
                size=(txt_clip.w + 20, txt_clip.h + 20),
                color=bg_color,
                duration=duration
            ).set_position((x_pos - 10, y_pos - 10))
            return CompositeVideoClip([bg, txt_clip], size=size)
        
        return txt_clip
        
    except Exception as e:
        print(f"❌ Failed to create text clip: {e}")
        import traceback
        traceback.print_exc()
        return None


def process_video_edit(request: ProcessVideoRequest) -> Dict[str, Any]:
    """Process video edit and create final video"""
    temp_dir = tempfile.mkdtemp()
    
    try:
        print(f"🎬 Processing video edit {request.editId} for account {request.accountId}")
        print(f"📊 Building video from scratch using track metadata")
        print(f"📊 Tracks count: {len(request.tracks)}")
        print(f"📎 Original video S3 key: {request.originalVideoUrl}")
        
        # Count all assets that need to be downloaded
        total_assets = 0
        for i, track in enumerate(request.tracks):
            clip_count = len(track.clips)
            total_assets += clip_count
            print(f"   Track {i} ({track.type}): {clip_count} clips")
        
        print(f"📥 Will download {total_assets} assets from S3 (Python will generate presigned URLs)")
        
        # Parse aspect ratio
        aspect_parts = request.aspectRatio.split(':')
        aspect_ratio = float(aspect_parts[0]) / float(aspect_parts[1])
        
        # Determine video size based on aspect ratio
        if request.aspectRatio == "9:16":
            video_size = (1080, 1920)  # Vertical
        elif request.aspectRatio == "16:9":
            video_size = (1920, 1080)  # Horizontal
        elif request.aspectRatio == "1:1":
            video_size = (1080, 1080)  # Square
        else:
            video_size = (1080, 1920)  # Default to vertical
        
        # Build timeline
        video_clips = []
        audio_clips = []
        overlay_clips = []
        caption_clips = []
        
        # Map video clip id -> end time (startTime + duration) for trimToClipEnd (music/audio)
        video_clip_end_by_id: Dict[str, float] = {}
        for track in request.tracks:
            if not track.visible:
                continue
            for c in track.clips:
                if c.type == 'video':
                    end_time = (c.startTime or 0) + (c.duration or 0)
                    video_clip_end_by_id[c.id] = end_time
        
        # Process tracks
        for track in request.tracks:
            if not track.visible or track.muted:
                continue
            
            for clip_data in track.clips:
                if clip_data.type == 'video':
                    # Download video clip from S3
                    if not clip_data.src:
                        print(f"⚠️ Video clip {clip_data.id} has no src URL, skipping")
                        continue
                    
                    print(f"📥 Downloading video clip {clip_data.id} (S3 key: {clip_data.src[:80]}...)")
                    clip_path = os.path.join(temp_dir, f"clip_{clip_data.id}.mp4")
                    if not download_from_s3(clip_data.src, clip_path):
                        print(f"❌ Failed to download video clip {clip_data.id} from S3 key: {clip_data.src}")
                        raise Exception(f"Failed to download video clip {clip_data.id}")
                    
                    print(f"✅ Downloaded video clip {clip_data.id}")
                    video_clip = VideoFileClip(clip_path)
                    
                    # Apply speed change first (affects duration)
                    speed = getattr(clip_data, 'speed', 1.0) or 1.0
                    if speed != 1.0:
                        video_clip = video_clip.speedx(speed)
                    
                    # Calculate target duration after speed change
                    target_duration = clip_data.duration
                    
                    # Trim clip to exact duration needed
                    source_start = clip_data.sourceStart or 0
                    source_end = source_start + target_duration
                    
                    # Get actual clip duration after speed change
                    actual_duration = video_clip.duration
                    
                    # Only trim if needed
                    if source_start > 0 or source_end < actual_duration:
                        # Trim to exact duration
                        video_clip = video_clip.subclip(
                            source_start,
                            min(source_end, actual_duration)
                        )
                    
                    # Ensure duration matches exactly (trim again if needed)
                    actual_duration_after_trim = video_clip.duration
                    if abs(actual_duration_after_trim - target_duration) > 0.01:  # Allow 10ms tolerance
                        print(f"   ⚠️ Duration mismatch: actual={actual_duration_after_trim:.2f}s, target={target_duration:.2f}s")
                        # Trim to exact target duration
                        if actual_duration_after_trim > target_duration:
                            video_clip = video_clip.subclip(0, target_duration)
                        else:
                            # If shorter, we'll pad with last frame or extend
                            video_clip = video_clip.loop(duration=target_duration)
                    
                    # Apply filters (brightness, contrast, saturation, hue, blur)
                    if clip_data.filters:
                        video_clip = apply_filters(video_clip, clip_data.filters)
                    
                    # Resize to match project size
                    video_clip = video_clip.resize(video_size)
                    
                    # Apply transitions (fade in/out) - this should preserve duration
                    video_clip = apply_video_transitions(video_clip, clip_data)
                    
                    # Final duration check - ensure it matches exactly
                    final_duration = video_clip.duration
                    if abs(final_duration - target_duration) > 0.01:
                        print(f"   ⚠️ Final duration mismatch: {final_duration:.2f}s vs {target_duration:.2f}s")
                        # Trim to exact duration (don't use set_duration as it can cause audio issues)
                        if final_duration > target_duration:
                            video_clip = video_clip.subclip(0, target_duration)
                        else:
                            # If shorter, loop to fill duration
                            video_clip = video_clip.loop(duration=target_duration)
                    
                    # Add video clip's audio to the mix (so exported file has sound when no separate voiceover/music)
                    if video_clip.audio is not None and not getattr(clip_data, 'muted', False):
                        try:
                            track_audio = video_clip.audio.subclip(0, min(video_clip.duration, video_clip.audio.duration))
                            track_audio = track_audio.set_start(clip_data.startTime)
                            audio_clips.append(track_audio)
                            print(f"   🎵 Using audio from video clip {clip_data.id}")
                        except Exception as e:
                            print(f"   ⚠️ Could not extract audio from video clip: {e}")
                    # Remove audio from video for compositing (we've added it to audio_clips)
                    if video_clip.audio is not None:
                        video_clip = video_clip.without_audio()
                    
                    # Set position on timeline
                    video_clip = video_clip.set_start(clip_data.startTime)
                    
                    video_clips.append(video_clip)
                
                elif clip_data.type in ['audio', 'music', 'voiceover']:
                    # Download audio clip from S3
                    if not clip_data.src:
                        print(f"⚠️ Audio clip {clip_data.id} has no src URL, skipping")
                        continue
                    
                    print(f"📥 Downloading audio clip {clip_data.id} ({clip_data.type}) (S3 key: {clip_data.src[:80]}...)")
                    audio_path = os.path.join(temp_dir, f"audio_{clip_data.id}.mp3")
                    if not download_from_s3(clip_data.src, audio_path):
                        print(f"❌ Failed to download audio clip {clip_data.id} from S3 key: {clip_data.src}")
                        raise Exception(f"Failed to download audio clip {clip_data.id}")
                    
                    print(f"✅ Downloaded audio clip {clip_data.id}")
                    audio_clip = AudioFileClip(audio_path)
                    
                    # Calculate target duration (cap to referenced video clip end if trimToClipEnd)
                    target_duration = clip_data.duration
                    trim_to_clip_end = getattr(clip_data, 'trimToClipEnd', False)
                    trim_video_clip_id = getattr(clip_data, 'trimToVideoClipId', None)
                    if trim_to_clip_end and trim_video_clip_id and trim_video_clip_id in video_clip_end_by_id:
                        video_end_time = video_clip_end_by_id[trim_video_clip_id]
                        clip_start = clip_data.startTime or 0
                        max_duration = max(0.0, video_end_time - clip_start)
                        if max_duration < target_duration:
                            target_duration = max_duration
                            print(f"   🎵 Trimming {clip_data.type} to video clip end: duration={target_duration:.2f}s (video clip {trim_video_clip_id} ends at {video_end_time:.2f}s)")
                    
                    # Trim audio to exact duration needed
                    source_start = clip_data.sourceStart or 0
                    source_end = source_start + target_duration
                    
                    # Get actual audio duration
                    actual_duration = audio_clip.duration
                    
                    # Only trim if needed
                    if source_start > 0 or source_end < actual_duration:
                        # Trim to exact duration
                        audio_clip = audio_clip.subclip(
                            source_start,
                            min(source_end, actual_duration)
                        )
                    
                    # Ensure duration matches exactly
                    actual_duration_after_trim = audio_clip.duration
                    if abs(actual_duration_after_trim - target_duration) > 0.01:  # Allow 10ms tolerance
                        print(f"   ⚠️ Audio duration mismatch: actual={actual_duration_after_trim:.2f}s, target={target_duration:.2f}s")
                        # Trim to exact target duration
                        if actual_duration_after_trim > target_duration:
                            audio_clip = audio_clip.subclip(0, target_duration)
                        else:
                            # If shorter, loop or pad with silence
                            audio_clip = audio_clip.loop(duration=target_duration)
                    
                    # Set volume
                    volume = (clip_data.volume or 100) / 100.0
                    audio_clip = audio_clip.volumex(volume)
                    
                    # Apply fade in/out (audio_fadein/audio_fadeout via .fx() - AudioFileClip has no .fadein/.fadeout)
                    fade_in = clip_data.fadeIn or 0
                    fade_out = clip_data.fadeOut or 0
                    if fade_in > 0:
                        fade_in = min(fade_in, target_duration / 2)  # Don't fade more than half duration
                        audio_clip = audio_clip.fx(afx.audio_fadein, fade_in)
                    if fade_out > 0:
                        fade_out = min(fade_out, target_duration / 2)  # Don't fade more than half duration
                        audio_clip = audio_clip.fx(afx.audio_fadeout, fade_out)
                    
                    # Final duration check - trim to exact duration (don't use set_duration)
                    final_duration = audio_clip.duration
                    if abs(final_duration - target_duration) > 0.01:
                        print(f"   ⚠️ Final audio duration mismatch: {final_duration:.2f}s vs {target_duration:.2f}s")
                        # Trim to exact duration
                        if final_duration > target_duration:
                            audio_clip = audio_clip.subclip(0, target_duration)
                        else:
                            # If shorter, loop to fill duration
                            audio_clip = audio_clip.loop(duration=target_duration)
                    
                    # Set position on timeline
                    audio_clip = audio_clip.set_start(clip_data.startTime)
                    
                    audio_clips.append(audio_clip)
                
                elif clip_data.type == 'captions' and clip_data.text:
                    # Create text caption
                    text_clip = create_text_clip(clip_data.text, clip_data.duration, video_size)
                    if text_clip:
                        text_clip = text_clip.set_start(clip_data.startTime)
                        caption_clips.append(text_clip)
                
                elif clip_data.type == 'overlay':
                    # Download overlay image from S3
                    if not clip_data.src:
                        print(f"⚠️ Overlay clip {clip_data.id} has no src URL, skipping")
                        continue
                    
                    print(f"📥 Downloading overlay image {clip_data.id} (S3 key: {clip_data.src[:80]}...)")
                    overlay_path = os.path.join(temp_dir, f"overlay_{clip_data.id}.png")
                    if not download_from_s3(clip_data.src, overlay_path):
                        print(f"❌ Failed to download overlay {clip_data.id} from S3 key: {clip_data.src}")
                        raise Exception(f"Failed to download overlay {clip_data.id}")
                    
                    print(f"✅ Downloaded overlay {clip_data.id}")
                    # Process image with PIL for advanced effects
                    from PIL import Image, ImageFilter, ImageOps, ImageEnhance
                    import numpy as np
                    
                    pil_image = Image.open(overlay_path).convert('RGBA')
                    
                    # Apply filters (brightness, contrast, saturation) to overlay
                    filters = getattr(clip_data, 'filters', None)
                    if filters:
                            # Extract RGB channels for enhancement (keep alpha separate)
                            r, g, b, a = pil_image.split()
                            rgb_image = Image.merge('RGB', (r, g, b))
                            
                            # Brightness
                            brightness = filters.get('brightness', 100) / 100.0
                            if brightness != 1.0:
                                enhancer = ImageEnhance.Brightness(rgb_image)
                                rgb_image = enhancer.enhance(brightness)
                            
                            # Contrast
                            contrast = filters.get('contrast', 100) / 100.0
                            if contrast != 1.0:
                                enhancer = ImageEnhance.Contrast(rgb_image)
                                rgb_image = enhancer.enhance(contrast)
                            
                            # Saturation
                            saturation = filters.get('saturation', 100) / 100.0
                            if saturation != 1.0:
                                enhancer = ImageEnhance.Color(rgb_image)
                                rgb_image = enhancer.enhance(saturation)
                            
                            # Hue rotation
                            hue = filters.get('hue', 0)
                            if hue != 0:
                                hsv = rgb_image.convert('HSV')
                                h, s, v = hsv.split()
                                h_array = np.array(h, dtype='int32')
                                h_array = (h_array + int(hue * 255 / 360)) % 256
                                h = Image.fromarray(h_array.astype('uint8'))
                                hsv = Image.merge('HSV', (h, s, v))
                                rgb_image = hsv.convert('RGB')
                            
                            # Merge back with alpha
                            r, g, b = rgb_image.split()
                            pil_image = Image.merge('RGBA', (r, g, b, a))
                    
                    # Apply flip horizontal/vertical
                    flip_horizontal = getattr(clip_data, 'flipHorizontal', False)
                    flip_vertical = getattr(clip_data, 'flipVertical', False)
                    if flip_horizontal:
                        pil_image = ImageOps.mirror(pil_image)
                    if flip_vertical:
                        pil_image = ImageOps.flip(pil_image)
                    
                    # Target overlay size in export pixels (match preview: width = size.width% * scale)
                    size_obj = getattr(clip_data, 'size', None)
                    size_width_pct = (size_obj.get('width') if isinstance(size_obj, dict) else getattr(size_obj, 'width', None)) if size_obj else None
                    size_width_pct = float(size_width_pct or 30)
                    transform = getattr(clip_data, 'transform', None) or {}
                    scale_from_transform = float(transform.get('scale', 1.0))
                    target_w_export = video_size[0] * (size_width_pct / 100.0) * scale_from_transform
                    # Scale corner radius and border to match preview: preview uses px on overlay; we scale by (target overlay width / REF).
                    # REF = overlay width we assume for the UI values (e.g. ~360px). So radius_export = radius_raw * (target_w_export/REF), same for border.
                    REF_OVERLAY_WIDTH = 360.0
                    corner_radius_raw = float(getattr(clip_data, 'cornerRadius', 0) or 0)
                    border_raw = float(getattr(clip_data, 'borderWidth', 0) or 0)
                    corner_radius_export = corner_radius_raw * (target_w_export / REF_OVERLAY_WIDTH)
                    border_width_export = border_raw * (target_w_export / REF_OVERLAY_WIDTH)
                    # Convert to source-image pixels: we draw on pil_image, then add border, then resize (pil_image.width + 2*border_width_src) -> target_w_export.
                    # So border_width_src * (target_w_export / (pil_image.width + 2*border_width_src)) = border_width_export  =>  border_width_src = border_width_export * (pil_image.width + 2*border_width_src) / target_w_export  =>  border_width_src = border_width_export * pil_image.width / (target_w_export - 2*border_width_export)
                    if target_w_export > 0 and pil_image.width > 0:
                        denom_b = target_w_export - 2 * border_width_export
                        if denom_b > 1:
                            border_width = int(max(1, round(border_width_export * pil_image.width / denom_b))) if border_raw > 0 else 0
                        else:
                            border_width = int(max(1, round(border_width_export * pil_image.width / target_w_export))) if border_raw > 0 else 0
                        # corner_radius_src so that after resize it becomes corner_radius_export
                        processed_w = pil_image.width + 2 * border_width
                        corner_radius_src = round(corner_radius_export * processed_w / target_w_export) if corner_radius_raw > 0 else 0
                        corner_radius_src = min(corner_radius_src, min(pil_image.size) // 2)  # PIL round rect limit
                    else:
                        border_width = int(border_raw or 0)
                        corner_radius_src = int(corner_radius_raw or 0)
                    
                    # Apply corner radius and border *before* rotation (so rounded corners and border stay axis-aligned like in preview)
                    if corner_radius_src > 0:
                        mask = Image.new('L', pil_image.size, 0)
                        from PIL import ImageDraw
                        draw = ImageDraw.Draw(mask)
                        draw.rounded_rectangle([(0, 0), pil_image.size], radius=corner_radius_src, fill=255)
                        pil_image.putalpha(mask)
                    
                    border_color = getattr(clip_data, 'borderColor', None) or '#ffffff'
                    if border_width > 0:
                        from PIL import ImageDraw
                        w, h = pil_image.size
                        new_size = (w + border_width * 2, h + border_width * 2)
                        bordered = Image.new('RGBA', new_size, (0, 0, 0, 0))
                        draw = ImageDraw.Draw(bordered)
                        # Draw rounded border (outer rect with corner radius so border follows rounded shape like preview)
                        r_outer = min(corner_radius_src + border_width, min(new_size) // 2)
                        try:
                            draw.rounded_rectangle([(0, 0), new_size], radius=int(r_outer), fill=border_color)
                        except Exception:
                            draw.rounded_rectangle([(0, 0), new_size], radius=max(0, int(r_outer)), fill=border_color)
                        bordered.paste(pil_image, (border_width, border_width), pil_image)
                        pil_image = bordered
                    
                    # Apply rotation last (rotate the rounded+bordered overlay as a unit, like in preview)
                    rotation = 0
                    if clip_data.transform:
                        rotation = clip_data.transform.get('rotation', 0)
                    if rotation != 0:
                        pil_image = pil_image.rotate(-rotation, expand=True, resample=Image.BICUBIC)
                    
                    # Apply drop shadow
                    shadow_enabled = getattr(clip_data, 'shadowEnabled', False)
                    if shadow_enabled:
                        shadow_blur = getattr(clip_data, 'shadowBlur', 10)
                        shadow_offset_x = getattr(clip_data, 'shadowOffsetX', 0)
                        shadow_offset_y = getattr(clip_data, 'shadowOffsetY', 4)
                        shadow_color = getattr(clip_data, 'shadowColor', 'rgba(0,0,0,0.5)')
                        
                        # Create shadow
                        shadow = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))
                        shadow.paste((0, 0, 0, 128), pil_image.split()[3])  # Use alpha as mask
                        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
                        
                        # Create new image with shadow
                        new_size = (pil_image.width + abs(shadow_offset_x) + shadow_blur * 2,
                                   pil_image.height + abs(shadow_offset_y) + shadow_blur * 2)
                        result = Image.new('RGBA', new_size, (0, 0, 0, 0))
                        shadow_pos = (max(0, shadow_offset_x) + shadow_blur, 
                                     max(0, shadow_offset_y) + shadow_blur)
                        result.paste(shadow, shadow_pos)
                        img_pos = (max(0, -shadow_offset_x) + shadow_blur,
                                   max(0, -shadow_offset_y) + shadow_blur)
                        result.paste(pil_image, img_pos, pil_image)
                        pil_image = result
                    
                    # Save processed image (RGBA so alpha is used when compositing on top of base)
                    processed_path = os.path.join(temp_dir, f"overlay_{clip_data.id}_processed.png")
                    pil_image.save(processed_path, 'PNG')
                    
                    # transparent=True uses PNG alpha so overlay sits ON the visuals, not as a split
                    overlay_clip = ImageClip(processed_path, duration=clip_data.duration, transparent=True)
                    
                    # Always apply transform (position and scale) for overlays. Use defaults when missing so centered (x=0,y=0) works.
                    # Match preview: xPercent = 50 + x/5, yPercent = 50 + y/5; position is top-left so overlay center is at (xPercent%, yPercent%).
                    tform = (clip_data.transform or {}) if getattr(clip_data, 'transform', None) is not None else {}
                    if not isinstance(tform, dict):
                        tform = {}
                    def _num(val, default=0.0):
                        if val is None:
                            return default
                        try:
                            return float(val)
                        except (TypeError, ValueError):
                            return default
                    scale = _num(tform.get('scale'), 1.0)
                    x_units = _num(tform.get('x'), 0.0)
                    y_units = _num(tform.get('y'), 0.0)
                    opacity = _num(tform.get('opacity'), 1.0)
                    opacity = max(0.0, min(1.0, opacity))
                    size_obj = getattr(clip_data, 'size', None)
                    size_w = (size_obj.get('width') if isinstance(size_obj, dict) else getattr(size_obj, 'width', None)) if size_obj else None
                    size_w = float(size_w or 30)
                    target_w = int(round(video_size[0] * (size_w / 100.0) * scale))
                    if target_w > 0 and (overlay_clip.size[0] != target_w or scale != 1.0):
                        ar = overlay_clip.size[1] / max(1, overlay_clip.size[0])
                        target_h = int(round(target_w * ar))
                        if target_h > 0:
                            overlay_clip = overlay_clip.resize((target_w, target_h))
                    
                    # Position: match frontend PreviewPlayer exactly.
                    # Frontend: xPercent = 50 + (clip.transform?.x || 0) / 5; left = xPercent%; transform translate(-50%, -50%) => center at (xPercent%, yPercent%).
                    # So center_x_percent = 50 + x_units/5, center_y_percent = 50 + y_units/5. Then top-left = center_px - (clip_w/2, clip_h/2).
                    vid_w, vid_h = video_size
                    center_x_percent = 50.0 + (x_units / 5.0)
                    center_y_percent = 50.0 + (y_units / 5.0)
                    center_x_px = (center_x_percent / 100.0) * vid_w
                    center_y_px = (center_y_percent / 100.0) * vid_h
                    clip_w, clip_h = overlay_clip.size
                    top_left_x = center_x_px - (clip_w / 2.0)
                    top_left_y = center_y_px - (clip_h / 2.0)
                    overlay_clip = overlay_clip.set_position((top_left_x, top_left_y))
                    overlay_clip = overlay_clip.set_opacity(opacity)
                    
                    overlay_clip = overlay_clip.set_start(clip_data.startTime)
                    
                    # Store blend mode for compositing (will be applied during final composition)
                    blend_mode = getattr(clip_data, 'blendMode', 'normal')
                    overlay_clip.blend_mode = blend_mode  # Store as attribute for later use
                    
                    overlay_clips.append(overlay_clip)
        
        # Sort video clips by start time
        video_clips.sort(key=lambda c: c.start)
        
        print(f"🎬 Building final video composition:")
        print(f"   - Video clips: {len(video_clips)}")
        print(f"   - Audio clips: {len(audio_clips)}")
        print(f"   - Overlay clips: {len(overlay_clips)}")
        print(f"   - Caption clips: {len(caption_clips)}")
        print(f"   - Target duration: {request.duration}s")
        print(f"   - Video size: {video_size}")
        
        # Create base video track: black background for full duration, then place each video clip at its startTime
        # (Never concatenate — that would put the first clip at 0 instead of its actual timeline position.)
        if video_clips:
            print(f"   - Placing {len(video_clips)} video clip(s) at their timeline start times")
            base_video = ColorClip(size=video_size, color=(0, 0, 0), duration=request.duration)
            all_video_clips = [base_video] + video_clips
            base_video = CompositeVideoClip(all_video_clips, size=video_size)
        else:
            # No video clips, create black video
            print(f"   - No video clips, creating black background")
            base_video = ColorClip(size=video_size, color=(0, 0, 0), duration=request.duration)
        
        # Ensure base is full-screen background at (0,0) so overlays truly sit ON the visuals (MoviePy 1.0.3 uses set_position)
        base_video = base_video.set_position((0, 0))
        
        # Composite overlays ON TOP of base (overlay-on-visuals, not split composition)
        if overlay_clips:
            print(f"   - Compositing {len(overlay_clips)} overlay(s) on top of base video")
            all_clips = [base_video] + overlay_clips
            base_video = CompositeVideoClip(all_clips, size=video_size)
        
        # Composite captions on top
        if caption_clips:
            print(f"   - Compositing {len(caption_clips)} caption(s)")
            all_clips = [base_video] + caption_clips
            base_video = CompositeVideoClip(all_clips, size=video_size)
        
        # Set final duration before adding audio
        base_video = base_video.set_duration(request.duration)
        
        # Mix audio tracks
        if audio_clips:
            print(f"   - Mixing {len(audio_clips)} audio track(s)")
            # Sort by start time
            audio_clips.sort(key=lambda c: c.start)
            
            # Ensure all audio clips don't exceed the final duration
            trimmed_audio_clips = []
            for audio_clip in audio_clips:
                clip_end_time = audio_clip.start + audio_clip.duration
                if clip_end_time > request.duration:
                    # Trim audio clip to fit within final duration
                    new_duration = max(0, request.duration - audio_clip.start)
                    if new_duration > 0:
                        trimmed_clip = audio_clip.subclip(0, new_duration)
                        # Preserve start time
                        trimmed_clip = trimmed_clip.set_start(audio_clip.start)
                        trimmed_audio_clips.append(trimmed_clip)
                        print(f"   - Trimmed audio clip: end time {clip_end_time:.2f}s -> {audio_clip.start + new_duration:.2f}s")
                    else:
                        print(f"   - Skipping audio clip that starts after video end: {audio_clip.start:.2f}s")
                else:
                    trimmed_audio_clips.append(audio_clip)
            
            if trimmed_audio_clips:
                # Create composite audio
                final_audio = CompositeAudioClip(trimmed_audio_clips)
                # Ensure composite audio doesn't exceed video duration
                if final_audio.duration > request.duration:
                    final_audio = final_audio.subclip(0, request.duration)
                base_video = base_video.set_audio(final_audio)
            else:
                print(f"   - No valid audio clips after trimming")
        else:
            print(f"   - No audio tracks")
        
        # Final duration check - ensure video and audio are in sync
        base_video = base_video.set_duration(request.duration)
        
        print(f"✅ Video composition complete, exporting to file...")
        
        # Export final video
        output_path = os.path.join(temp_dir, "final.mp4")
        print(f"📹 Writing video file to {output_path}...")
        print(f"   - FPS: 30")
        print(f"   - Codec: libx264")
        print(f"   - Bitrate: 5M")
        print(f"   - Duration: {request.duration}s")
        base_video.write_videofile(
            output_path,
            fps=30,
            codec='libx264',
            preset='medium',
            bitrate='5M',
            audio_codec='aac',
            logger=None
        )
        print(f"✅ Video file written successfully")
        
        # Upload to S3
        s3_key = f"dvyb/video-edits/{request.accountId}/{request.generatedContentId}_{request.postIndex}_{request.editId}.mp4"
        print(f"📤 Uploading final video to S3: {s3_key}")
        if not upload_to_s3(output_path, s3_key):
            raise Exception("Failed to upload final video")
        print(f"✅ Video uploaded successfully to S3")
        
        # Cleanup
        base_video.close()
        for clip in video_clips:
            clip.close()
        for clip in audio_clips:
            clip.close()
        
        print(f"🎉 Video processing completed successfully!")
        print(f"📎 Final video S3 key: {s3_key}")
        
        return {
            'success': True,
            'editedVideoUrl': s3_key,  # Store just the S3 key (consistent with originalVideoUrl)
            's3Key': s3_key,
        }
        
    except Exception as e:
        print(f"❌ Video processing failed: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
        }
    finally:
        # Cleanup temp directory
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


async def process_and_callback(request: ProcessVideoRequest):
    """Background task to process video and optionally call back to TypeScript backend"""
    try:
        result = process_video_edit(request)
        
        # If callback URL is provided, notify TypeScript backend
        if request.callbackUrl:
            try:
                async with httpx.AsyncClient() as client:
                    callback_data = {
                        'editId': request.editId,
                        'success': result.get('success', False),
                        'editedVideoUrl': result.get('editedVideoUrl'),
                        'errorMessage': result.get('error'),
                    }
                    await client.post(request.callbackUrl, json=callback_data, timeout=30)
                    print(f"✅ Callback sent to {request.callbackUrl}")
            except Exception as e:
                print(f"❌ Failed to send callback: {e}")
        
        return result
        
    except Exception as e:
        print(f"❌ Background processing failed: {e}")
        import traceback
        traceback.print_exc()
        raise


@router.post("/process")
async def process_video(request: ProcessVideoRequest, background_tasks: BackgroundTasks):
    """Process video edit asynchronously"""
    try:
        # Start background processing
        background_tasks.add_task(process_and_callback, request)
        
        return {
            'success': True,
            'message': 'Video processing started',
            'editId': request.editId,
        }
    except Exception as e:
        print(f"❌ Failed to start video processing: {e}")
        raise HTTPException(status_code=500, detail=str(e))
