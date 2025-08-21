from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import tempfile
import os
import requests
import boto3
from botocore.exceptions import ClientError
from app.ai.watermarks import BlendedTamperResistantWatermark
import logging

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

class WatermarkRequest(BaseModel):
    image_url: str
    s3_bucket: str
    s3_key_prefix: Optional[str] = None

class WatermarkResponse(BaseModel):
    success: bool
    watermark_url: Optional[str] = None
    error: Optional[str] = None

@router.post("/watermark", response_model=WatermarkResponse)
async def create_watermark(request: WatermarkRequest):
    """
    Create a watermarked version of an image and upload to S3
    """
    try:
        logger.info(f"🖼️ Creating watermark for image: {request.image_url}")
        
        # Initialize watermarker
        font_path = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'NTBrickSans.ttf')
        if os.path.exists(font_path):
            watermarker = BlendedTamperResistantWatermark(font_path)
            logger.info(f"✅ Using font: {font_path}")
        else:
            watermarker = BlendedTamperResistantWatermark()
            logger.warning("⚠️ Using default font (NTBrickSans.ttf not found)")
        
        # Generate temporary file paths
        with tempfile.TemporaryDirectory() as temp_dir:
            original_path = os.path.join(temp_dir, 'original.jpg')
            watermarked_path = os.path.join(temp_dir, 'watermarked.jpg')
            
            # Step 1: Download original image
            logger.info(f"📥 Downloading image from: {request.image_url}")
            response = requests.get(request.image_url, stream=True, timeout=30)
            response.raise_for_status()
            
            with open(original_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            logger.info(f"✅ Downloaded image to: {original_path}")
            
            # Step 2: Apply watermark
            import cv2
            image = cv2.imread(original_path)
            if image is None:
                raise HTTPException(status_code=400, detail="Failed to load image")
            
            logger.info("🖼️ Applying watermark...")
            watermarked = watermarker.add_robust_blended_watermark(
                image,
                corner_text="@burnieio",
                center_text="Buy to Access",
                center_text_2="@burnieio",
                hidden_text="BURNIEIO_2024",
                blend_mode='texture_aware'
            )
            
            # Save watermarked image
            success = cv2.imwrite(watermarked_path, watermarked)
            if not success:
                raise HTTPException(status_code=500, detail="Failed to save watermarked image")
            
            logger.info(f"✅ Watermark applied and saved to: {watermarked_path}")
            
            # Step 3: Generate S3 key for watermarked image
            original_s3_key = extract_s3_key_from_url(request.image_url)
            if not original_s3_key:
                raise HTTPException(status_code=400, detail="Could not extract S3 key from URL")
            
            watermarked_s3_key = generate_watermarked_s3_key(original_s3_key)
            
            # Step 4: Upload to S3
            logger.info(f"📤 Uploading to S3: {watermarked_s3_key}")
            
            with open(watermarked_path, 'rb') as f:
                s3_client.upload_fileobj(
                    f,
                    request.s3_bucket,
                    watermarked_s3_key,
                    ExtraArgs={'ContentType': 'image/jpeg'}
                )
            
            # Generate public URL
            watermark_url = f"https://{request.s3_bucket}.s3.amazonaws.com/{watermarked_s3_key}"
            
            logger.info(f"✅ Watermarked image uploaded: {watermark_url}")
            
            return WatermarkResponse(
                success=True,
                watermark_url=watermark_url
            )
            
    except requests.RequestException as e:
        logger.error(f"❌ Failed to download image: {e}")
        return WatermarkResponse(
            success=False,
            error=f"Failed to download image: {str(e)}"
        )
    except ClientError as e:
        logger.error(f"❌ S3 upload failed: {e}")
        return WatermarkResponse(
            success=False,
            error=f"S3 upload failed: {str(e)}"
        )
    except Exception as e:
        logger.error(f"❌ Watermarking failed: {e}")
        return WatermarkResponse(
            success=False,
            error=f"Watermarking failed: {str(e)}"
        )

def extract_s3_key_from_url(url: str) -> str:
    """Extract S3 key from URL"""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.path.lstrip('/')
    except Exception:
        return ""

def generate_watermarked_s3_key(original_key: str) -> str:
    """Generate watermarked S3 key from original key"""
    from pathlib import Path
    path = Path(original_key)
    return str(path.with_stem(f"{path.stem}-watermarked"))
