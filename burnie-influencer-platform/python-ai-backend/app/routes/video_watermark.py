from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
import requests
import boto3
from botocore.exceptions import ClientError
import cv2
import numpy as np
from moviepy.editor import VideoFileClip, CompositeVideoClip, TextClip
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
            
            # Step 1: Download original video
            logger.info(f"📥 Downloading video from: {request.video_url}")
            response = requests.get(request.video_url, stream=True, timeout=60)
            response.raise_for_status()
            
            with open(original_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"✅ Downloaded video to: {original_path}")
            
            # Step 2: Process video with watermarks
            logger.info("🎬 Processing video with watermarks...")
            success = await process_video_with_watermarks(original_path, watermarked_path)
            
            if not success:
                raise HTTPException(status_code=500, detail="Failed to process video with watermarks")
            
            logger.info(f"✅ Video processed and saved to: {watermarked_path}")
            
            # Step 3: Generate S3 key for watermarked video
            original_s3_key = extract_s3_key_from_url(request.video_url)
            if not original_s3_key:
                raise HTTPException(status_code=400, detail="Could not extract S3 key from URL")
            
            watermarked_s3_key = generate_watermarked_video_s3_key(original_s3_key)
            
            # Step 4: Upload to S3
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

async def process_video_with_watermarks(input_path: str, output_path: str) -> bool:
    """
    Process video to add watermarks to every 25th frame
    """
    try:
        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            logger.error("❌ Failed to open video file")
            return False
        
        # Get video properties
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        logger.info(f"📊 Video properties: {width}x{height}, {fps} FPS, {total_frames} frames")
        
        # Setup video writer
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        frame_count = 0
        watermarked_frames = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Add watermark to every 25th frame
            if frame_count % 25 == 0:
                frame = add_watermark_to_frame(frame, width, height)
                watermarked_frames += 1
            
            out.write(frame)
            frame_count += 1
            
            # Log progress every 100 frames
            if frame_count % 100 == 0:
                logger.info(f"📊 Processed {frame_count}/{total_frames} frames")
        
        # Release everything
        cap.release()
        out.release()
        
        logger.info(f"✅ Video processing complete: {watermarked_frames} frames watermarked out of {frame_count} total frames")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error processing video: {e}")
        return False

def add_watermark_to_frame(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    """
    Add watermark to a single frame
    """
    try:
        # Create a copy of the frame
        watermarked_frame = frame.copy()
        
        # Define watermark properties
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 1.0
        color = (255, 255, 255)  # White text
        thickness = 2
        
        # Calculate text size
        text = "@burnieio"
        (text_width, text_height), baseline = cv2.getTextSize(text, font, font_scale, thickness)
        
        # Position watermark in bottom-right corner with padding
        padding = 20
        x = width - text_width - padding
        y = height - padding
        
        # Add semi-transparent background rectangle
        overlay = watermarked_frame.copy()
        cv2.rectangle(overlay, (x - 10, y - text_height - 10), (x + text_width + 10, y + 10), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, watermarked_frame, 0.3, 0, watermarked_frame)
        
        # Add text
        cv2.putText(watermarked_frame, text, (x, y), font, font_scale, color, thickness)
        
        # Add "Buy to Access" text below
        buy_text = "Buy to Access"
        (buy_width, buy_height), _ = cv2.getTextSize(buy_text, font, 0.6, 1)
        buy_x = width - buy_width - padding
        buy_y = y + 30
        
        # Add semi-transparent background for buy text
        cv2.rectangle(overlay, (buy_x - 5, buy_y - buy_height - 5), (buy_x + buy_width + 5, buy_y + 5), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, watermarked_frame, 0.3, 0, watermarked_frame)
        
        # Add buy text
        cv2.putText(watermarked_frame, buy_text, (buy_x, buy_y), font, 0.6, color, 1)
        
        return watermarked_frame
        
    except Exception as e:
        logger.error(f"❌ Error adding watermark to frame: {e}")
        return frame

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
