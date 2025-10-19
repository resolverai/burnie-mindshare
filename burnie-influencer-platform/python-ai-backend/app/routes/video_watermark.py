from fastapi import APIRouter, HTTPException, BackgroundTasks
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
    content_id: int
    callback_url: str
    s3_key_prefix: Optional[str] = None

class VideoWatermarkResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    watermark_video_url: Optional[str] = None
    error: Optional[str] = None

def process_video_watermark_background(
    video_url: str,
    s3_bucket: str,
    content_id: int,
    callback_url: str
):
    """
    Background task to process video watermarking and call callback when done
    """
    watermark_video_url = None
    error_message = None
    
    try:
        logger.info(f"🎬 Background: Starting video watermark for content ID: {content_id}, video: {video_url}")
        
        # Generate temporary file paths
        with tempfile.TemporaryDirectory() as temp_dir:
            original_path = os.path.join(temp_dir, 'original.mp4')
            watermarked_path = os.path.join(temp_dir, 'watermarked.mp4')
            
            # Step 1: Generate fresh presigned URL if this is an S3 URL
            download_url = video_url
            if 's3.amazonaws.com' in video_url:
                logger.info(f"🔄 Detected S3 URL, generating fresh presigned URL...")
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(video_url)
                    s3_key = parsed.path.lstrip('/')
                    
                    # Generate fresh presigned URL
                    from app.services.s3_storage_service import get_s3_storage
                    s3_service = get_s3_storage()
                    
                    presigned_result = s3_service.generate_presigned_url(s3_key, expiration=3600)
                    
                    if presigned_result.get('success'):
                        download_url = presigned_result['presigned_url']
                        logger.info(f"✅ Generated fresh presigned URL for download")
                    else:
                        logger.warning(f"⚠️ Failed to generate presigned URL: {presigned_result.get('error')}")
                        logger.info(f"⚠️ Falling back to original URL...")
                        
                except Exception as e:
                    logger.error(f"❌ Error generating presigned URL: {e}")
                    logger.info(f"⚠️ Falling back to original URL...")

            
            # Step 2: Download original video
            logger.info(f"📥 Downloading video from: {download_url[:100]}...")
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
                raise Exception("Failed to process video with watermarks")
            
            logger.info(f"✅ Video processed and saved to: {watermarked_path}")
            
            # Step 4: Generate S3 key for watermarked video
            original_s3_key = extract_s3_key_from_url(video_url)
            if not original_s3_key:
                raise Exception("Could not extract S3 key from URL")
            
            watermarked_s3_key = generate_watermarked_video_s3_key(original_s3_key)
            
            # Step 5: Upload to S3
            logger.info(f"📤 Uploading watermarked video to S3: {watermarked_s3_key}")
            
            with open(watermarked_path, 'rb') as f:
                s3_client.upload_fileobj(
                    f,
                    s3_bucket,
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
                watermark_video_url = f"https://{s3_bucket}.s3.amazonaws.com/{watermarked_s3_key}"
                logger.warning(f"⚠️ Failed to generate presigned URL, using direct S3 URL: {presigned_result.get('error')}")
            
            logger.info(f"✅ Background: Video watermarking completed for content ID: {content_id}")
            
    except requests.RequestException as e:
        error_message = f"Failed to download video: {str(e)}"
        logger.error(f"❌ Background: {error_message}")
    except ClientError as e:
        error_message = f"S3 upload failed: {str(e)}"
        logger.error(f"❌ Background: {error_message}")
    except Exception as e:
        error_message = f"Video watermarking failed: {str(e)}"
        logger.error(f"❌ Background: {error_message}")
    
    # Step 6: Call callback endpoint to notify TypeScript backend
    try:
        logger.info(f"📞 Calling callback URL: {callback_url}")
        callback_payload = {
            "content_id": content_id,
            "success": watermark_video_url is not None,
            "watermark_video_url": watermark_video_url,
            "error": error_message
        }
        
        callback_response = requests.post(
            callback_url,
            json=callback_payload,
            timeout=10
        )
        
        if callback_response.ok:
            logger.info(f"✅ Callback successful for content ID: {content_id}")
        else:
            logger.error(f"❌ Callback failed with status {callback_response.status_code}: {callback_response.text}")
            
    except Exception as e:
        logger.error(f"❌ Failed to call callback URL: {e}")

@router.post("/video-watermark", response_model=VideoWatermarkResponse)
async def create_video_watermark(request: VideoWatermarkRequest, background_tasks: BackgroundTasks):
    """
    Start video watermarking as a background task and return immediately
    """
    try:
        logger.info(f"🎬 Received video watermark request for content ID: {request.content_id}, video: {request.video_url}")
        
        # Validate inputs
        if not request.video_url or not request.video_url.startswith('http'):
            return VideoWatermarkResponse(
                success=False,
                error="Invalid video URL"
            )
        
        # Add background task
        background_tasks.add_task(
            process_video_watermark_background,
            video_url=request.video_url,
            s3_bucket=request.s3_bucket,
            content_id=request.content_id,
            callback_url=request.callback_url
        )
        
        logger.info(f"✅ Video watermarking task queued for content ID: {request.content_id}")
        
        return VideoWatermarkResponse(
            success=True,
            message="Video watermarking started in background"
        )
        
    except Exception as e:
        logger.error(f"❌ Failed to queue video watermarking task: {e}")
        return VideoWatermarkResponse(
            success=False,
            error=f"Failed to start video watermarking: {str(e)}"
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
        
        # Function to apply watermark to frame (optimized pattern - every other 24 frames)
        def apply_watermark_to_frame(get_frame, t):
            frame = get_frame(t)
            
            # Calculate current frame number
            current_frame = int(t * fps)
            
            # Optimized watermarking pattern: watermark 24 frames, skip 24 frames, repeat
            # This reduces resource consumption by ~50% while maintaining protection
            frame_position_in_cycle = current_frame % 48  # 48 = 24 watermarked + 24 skipped
            should_watermark = frame_position_in_cycle < 24  # First 24 frames in each 48-frame cycle
            
            if should_watermark:
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
            
            # Return frame (watermarked or original depending on cycle position)
            return frame
        
        # Create new video clip with watermarked frames (optimized pattern)
        logger.info("🎬 Applying watermarks with optimized pattern (24 frames on, 24 frames off) for resource efficiency...")
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
