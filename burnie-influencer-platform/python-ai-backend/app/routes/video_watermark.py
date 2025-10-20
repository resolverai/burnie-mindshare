from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
import requests
import boto3
from botocore.exceptions import ClientError
import subprocess
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
            
            # Step 3: Process video with watermark using FFmpeg (fast and simple)
            logger.info("🎬 Processing video with watermark using FFmpeg...")
            success = process_video_with_ffmpeg_watermark(original_path, watermarked_path)
            
            if not success:
                raise Exception("Failed to process video with watermark")
            
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

def process_video_with_ffmpeg_watermark(input_path: str, output_path: str) -> bool:
    """
    Process video to add a simple text watermark using FFmpeg - fast and doesn't corrupt video
    Adds "Buy to Access '@burnieio'" at bottom right corner
    """
    try:
        # FFmpeg command to add text overlay at bottom right
        # Using drawtext filter for simple, fast watermarking
        # Use h264_videotoolbox for macOS (hardware accelerated) or fallback to libopenh264
        watermark_text = "Buy to Access @burnieio"
        
        # Detect platform and choose appropriate encoder
        import platform
        is_mac = platform.system() == 'Darwin'
        
        if is_mac:
            # Use VideoToolbox (hardware accelerated) on macOS
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', input_path,
                '-vf', 
                f"drawtext=text='{watermark_text}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=w-tw-20:y=h-th-20",
                '-c:v', 'h264_videotoolbox',  # Hardware accelerated H.264 on macOS
                '-b:v', '5M',                  # Target bitrate 5 Mbps (good quality)
                '-c:a', 'copy',                # Copy audio without re-encoding (fast!)
                '-movflags', '+faststart',     # Enable progressive playback
                '-y',                          # Overwrite output file
                output_path
            ]
            encoder_name = 'h264_videotoolbox (hardware)'
        else:
            # Use libx264 on Linux (available in Docker via apt ffmpeg package)
            # This is better quality and faster than libopenh264
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', input_path,
                '-vf', 
                f"drawtext=text='{watermark_text}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=w-tw-20:y=h-th-20",
                '-c:v', 'libx264',             # libx264 encoder (available in Docker)
                '-crf', '23',                  # Quality setting (23 = default, good)
                '-c:a', 'copy',                # Copy audio without re-encoding (fast!)
                '-movflags', '+faststart',     # Enable progressive playback
                '-y',                          # Overwrite output file
                output_path
            ]
            encoder_name = 'libx264 (software)'
        logger.info(f"🎬 Running FFmpeg watermark command with {encoder_name}...")
        logger.info(f"📝 Watermark text: {watermark_text}")
        logger.info(f"📝 FFmpeg command: {' '.join(ffmpeg_cmd)}")
        
        # Run FFmpeg
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0:
            logger.info(f"✅ FFmpeg watermarking completed successfully with {encoder_name}")
            return True
        else:
            logger.error(f"❌ FFmpeg failed with return code {result.returncode}")
            logger.error(f"❌ FFmpeg stderr: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        logger.error("❌ FFmpeg watermarking timed out after 5 minutes")
        return False
    except Exception as e:
        logger.error(f"❌ Error processing video with FFmpeg: {e}")
        return False

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
