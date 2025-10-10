from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
import requests
import boto3
from botocore.exceptions import ClientError
from moviepy.editor import VideoFileClip
import logging
from pathlib import Path

router = APIRouter()

# Setup logging
logger = logging.getLogger(__name__)

# AWS S3 configuration
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION', 'us-east-1')
)

class VideoWatermarkRequest(BaseModel):
    video_url: str
    s3_bucket: str
    s3_key_prefix: Optional[str] = None

class VideoWatermarkResponse(BaseModel):
    success: bool
    watermark_video_url: Optional[str] = None
    error: Optional[str] = None

@router.post("/video-watermark", response_model=VideoWatermarkResponse)
async def create_video_watermark(request: VideoWatermarkRequest):
    """
    Create a watermarked version of a video by adding watermarks to every 25th frame
    """
    try:
        logger.info(f"🎬 Creating video watermark for: {request.video_url}")
        
        # Generate temporary file paths
        with tempfile.TemporaryDirectory() as temp_dir:
            original_path = os.path.join(temp_dir, 'original.mp4')
            watermarked_path = os.path.join(temp_dir, 'watermarked.mp4')
            
            # Step 1: Generate fresh presigned URL if this is an S3 URL
            download_url = request.video_url
            if 's3.amazonaws.com' in request.video_url:
                logger.info(f"🔄 Detected S3 URL, generating fresh presigned URL...")
                try:
                    from urllib.parse import urlparse
                    from app.services.s3_storage_service import get_s3_storage
                    
                    # Extract S3 key from URL
                    parsed = urlparse(request.video_url)
                    if '.s3.amazonaws.com' in parsed.netloc:
                        # Format: https://bucket-name.s3.amazonaws.com/key/path
                        s3_key = parsed.path.lstrip('/')  # Remove leading slash
                    else:
                        # Format: https://s3.amazonaws.com/bucket-name/key/path
                        path_parts = parsed.path.lstrip('/').split('/', 1)
                        s3_key = path_parts[1] if len(path_parts) > 1 else ''
                    
                    if s3_key:
                        logger.info(f"🔑 Extracted S3 key: {s3_key}")
                        s3_service = get_s3_storage()
                        presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
                        
                        if presigned_result['success']:
                            download_url = presigned_result['presigned_url']
                            logger.info(f"✅ Generated fresh presigned URL for video watermarking")
                        else:
                            logger.warning(f"⚠️ Failed to generate fresh presigned URL: {presigned_result.get('error')}")
                            logger.info(f"📋 Will attempt to use original URL anyway")
                    else:
                        logger.warning(f"⚠️ Could not extract S3 key from URL: {request.video_url}")
                        
                except Exception as e:
                    logger.warning(f"⚠️ Error generating fresh presigned URL: {e}")
                    logger.info(f"📋 Will attempt to use original URL anyway")
            
            # Step 2: Download original video
            logger.info(f"📥 Downloading video from: {download_url}")
            response = requests.get(download_url, stream=True, timeout=60)
            response.raise_for_status()
            
            with open(original_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"✅ Downloaded video to: {original_path}")
            
            # Step 3: Process video with watermarks using MoviePy
            logger.info("🎬 Processing video with watermarks using MoviePy...")
            success = process_video_with_watermarks_moviepy(original_path, watermarked_path)
            
            if not success:
                raise HTTPException(status_code=500, detail="Failed to process video with watermarks")
            
            logger.info(f"✅ Video processed and saved to: {watermarked_path}")
            
            # Step 4: Generate S3 key for watermarked video
            original_s3_key = extract_s3_key_from_url(request.video_url)
            if not original_s3_key:
                raise HTTPException(status_code=400, detail="Could not extract S3 key from URL")
            
            watermarked_s3_key = generate_watermarked_video_s3_key(original_s3_key)
            
            # Step 5: Upload to S3
            logger.info(f"📤 Uploading watermarked video to S3: {watermarked_s3_key}")
            
            with open(watermarked_path, 'rb') as f:
                s3_client.upload_fileobj(
                    f,
                    request.s3_bucket,
                    watermarked_s3_key,
                    ExtraArgs={'ContentType': 'video/mp4'}
                )
            
            # Generate presigned URL for consistency with other media URLs
            from app.services.s3_storage_service import get_s3_storage
            s3_service = get_s3_storage()
            
            presigned_result = s3_service.generate_presigned_url(watermarked_s3_key, expiration=3600)
            
            if presigned_result.get('success'):
                watermark_video_url = presigned_result['presigned_url']
                logger.info(f"✅ Watermarked video uploaded with presigned URL: {watermark_video_url[:100]}...")
            else:
                # Fallback to direct S3 URL if presigned generation fails
                watermark_video_url = f"https://{request.s3_bucket}.s3.amazonaws.com/{watermarked_s3_key}"
                logger.warning(f"⚠️ Failed to generate presigned URL, using direct S3 URL: {presigned_result.get('error')}")
            
            return VideoWatermarkResponse(
                success=True,
                watermark_video_url=watermark_video_url
            )
            
    except requests.RequestException as e:
        logger.error(f"❌ Failed to download video: {e}")
        return VideoWatermarkResponse(
            success=False,
            error=f"Failed to download video: {str(e)}"
        )
    except ClientError as e:
        logger.error(f"❌ S3 upload failed: {e}")
        return VideoWatermarkResponse(
            success=False,
            error=f"S3 upload failed: {str(e)}"
        )
    except Exception as e:
        logger.error(f"❌ Video watermarking failed: {e}")
        return VideoWatermarkResponse(
            success=False,
            error=f"Video watermarking failed: {str(e)}"
        )

def process_video_with_watermarks_moviepy(input_path: str, output_path: str) -> bool:
    """
    Process video to add watermarks to ALL frames using OpenCV and PIL (same approach as image watermarking)
    This avoids ImageMagick font issues and provides consistent watermarking with images
    """
    try:
        import cv2
        from app.ai.watermarks import BlendedTamperResistantWatermark
        
        # Load the video clip
        logger.info(f"📥 Loading video clip from: {input_path}")
        video_clip = VideoFileClip(input_path)
        
        # Get video properties
        width, height = video_clip.size
        duration = video_clip.duration
        fps = video_clip.fps
        total_frames = int(fps * duration)
        
        logger.info(f"📊 Video properties: {width}x{height}, {fps} FPS, {duration:.2f}s duration, {total_frames} total frames")
        
        # Initialize watermarker (same as image watermarking)
        font_path = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'NTBrickSans.ttf')
        if os.path.exists(font_path):
            watermarker = BlendedTamperResistantWatermark(font_path)
            logger.info(f"✅ Using font: {font_path}")
        else:
            watermarker = BlendedTamperResistantWatermark()
            logger.warning("⚠️ Using default font (NTBrickSans.ttf not found)")
        
        # Function to apply watermark to frame (all frames)
        def apply_watermark_to_frame(get_frame, t):
            frame = get_frame(t)
            
            # Apply watermark to all frames for complete protection
            # Convert frame from RGB to BGR for OpenCV
            frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            
            # Apply the same watermarking as images
            watermarked_bgr = watermarker.add_robust_blended_watermark(
                frame_bgr,
                corner_text="@burnieio",
                center_text="Buy to Access", 
                center_text_2="@burnieio",
                hidden_text="BURNIEIO_2024",
                blend_mode='texture_aware'
            )
            
            # Convert back to RGB for MoviePy
            frame = cv2.cvtColor(watermarked_bgr, cv2.COLOR_BGR2RGB)
            
            return frame
        
        # Create new video clip with watermarked frames
        logger.info("🎬 Applying watermarks to all frames for complete protection...")
        watermarked_clip = video_clip.fl(apply_watermark_to_frame, apply_to=['mask'])
        
        # Write the final video with proper H.264 encoding and preserve audio
        logger.info(f"💾 Writing watermarked video to: {output_path}")
        watermarked_clip.write_videofile(
            output_path,
            codec='libx264',           # Use H.264 codec (same as original videos)
            audio_codec='aac',         # Preserve AAC audio
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            fps=fps,                   # Preserve original FPS
            preset='medium',           # Good balance of quality and speed
            ffmpeg_params=['-crf', '23']  # Good quality setting
        )
        
        # Clean up
        video_clip.close()
        watermarked_clip.close()
        
        logger.info("✅ Video watermarking completed successfully using OpenCV/PIL approach")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error processing video with OpenCV/PIL watermarking: {e}")
        return False

# Note: create_watermark_text function removed - now using OpenCV/PIL watermarking approach
# which is consistent with image watermarking and avoids ImageMagick font issues

def extract_s3_key_from_url(url: str) -> str:
    """Extract S3 key from URL"""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.path.lstrip('/')
    except Exception:
        return ""

def generate_watermarked_video_s3_key(original_key: str) -> str:
    """Generate watermarked video S3 key from original key"""
    path = Path(original_key)
    return str(path.with_stem(f"{path.stem}-watermarked"))
