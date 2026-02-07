"""
DVYB Image Regeneration Route

Endpoint for regenerating images using fal nano-banana-pro edit model.
Takes a user prompt and source image, generates a new image based on the prompt.
"""

import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import fal_client
import httpx

from app.utils.web2_s3_helper import web2_s3_helper

logger = logging.getLogger(__name__)

router = APIRouter()


class RegenerateImageRequest(BaseModel):
    """Request body for image regeneration"""
    accountId: int
    generatedContentId: int
    postIndex: int
    prompt: str  # User's prompt describing desired changes
    sourceImageS3Key: str  # S3 key of the source image to edit
    # Callback URL to notify TypeScript backend when processing is complete
    callbackUrl: Optional[str] = None
    # Optional: regeneration record ID for callback updates
    regenerationId: Optional[int] = None


class RegenerateImageResponse(BaseModel):
    """Response for image regeneration"""
    success: bool
    regeneratedImageS3Key: Optional[str] = None
    regeneratedImageUrl: Optional[str] = None
    error: Optional[str] = None
    processingTimeMs: Optional[int] = None


async def process_regeneration_and_callback(request: RegenerateImageRequest):
    """Background task to regenerate image and call back to TypeScript backend"""
    start_time = time.time()
    
    try:
        logger.info(f"🎨 Starting image regeneration for account {request.accountId}, content {request.generatedContentId}, post {request.postIndex}")
        logger.info(f"📝 Prompt: {request.prompt[:100]}...")
        logger.info(f"🖼️ Source image: {request.sourceImageS3Key}")
        
        # Generate presigned URL for the source image
        presigned_source_url = web2_s3_helper.generate_presigned_url(request.sourceImageS3Key)
        if not presigned_source_url:
            raise Exception(f"Failed to generate presigned URL for source image: {request.sourceImageS3Key}")
        
        logger.info(f"✅ Generated presigned URL for source image")
        
        # Prepare reference images for nano-banana-pro edit
        image_urls = [presigned_source_url]
        
        # Log what we're sending to nano-banana-pro
        logger.info(f"📸 [NANO-BANANA-PRO-EDIT] Regeneration - Reference images (1):")
        logger.info(f"   1. {presigned_source_url[:80]}...")
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    logger.info(f"   FAL: {log['message']}")
        
        # Call fal nano-banana-pro edit with same parameters as dvyb_adhoc_generation
        logger.info(f"🚀 Calling fal-ai/nano-banana-pro/edit...")
        
        result = fal_client.subscribe(
            "fal-ai/nano-banana-pro/edit",
            arguments={
                "prompt": request.prompt,
                "num_images": 1,
                "output_format": "png",
                "aspect_ratio": "9:16",
                "resolution": "1K",  # Higher quality resolution
                "image_urls": image_urls,
                "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, unrealistic face, unrealistic body, unrealistic proportions, unrealistic features, hashtags, double logos, extra text"
            },
            with_logs=True,
            on_queue_update=on_queue_update
        )
        
        if not result or "images" not in result or not result["images"]:
            raise Exception("No images returned from fal nano-banana-pro edit")
        
        fal_url = result["images"][0]["url"]
        logger.info(f"📥 FAL URL received: {fal_url[:100]}...")
        
        # Upload to S3 using web2_s3_helper (downloads from URL and uploads to S3)
        logger.info(f"📤 Uploading regenerated image to S3...")
        
        # Generate unique filename with timestamp
        timestamp = int(time.time())
        filename = f"regen_{timestamp}.png"
        folder = f"dvyb/regenerated/{request.accountId}/{request.generatedContentId}/post_{request.postIndex}"
        
        # Use web2_s3_helper to download from fal and upload to S3
        s3_key = web2_s3_helper.upload_from_url(
            url=fal_url,
            folder=folder,
            filename=filename
        )
        
        if not s3_key:
            raise Exception("Failed to upload regenerated image to S3")
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        logger.info(f"✅ Regeneration complete in {processing_time_ms}ms: {s3_key}")
        
        # Generate presigned URL for the new image
        regenerated_presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
        
        # Call back to TypeScript backend if URL provided
        if request.callbackUrl:
            try:
                async with httpx.AsyncClient() as client:
                    callback_response = await client.post(
                        request.callbackUrl,
                        json={
                            "success": True,
                            "regenerationId": request.regenerationId,
                            "regeneratedImageS3Key": s3_key,
                            "processingTimeMs": processing_time_ms,
                        },
                        timeout=30.0
                    )
                    logger.info(f"📞 Callback response: {callback_response.status_code}")
            except Exception as callback_error:
                logger.error(f"❌ Callback failed: {callback_error}")
        
        return RegenerateImageResponse(
            success=True,
            regeneratedImageS3Key=s3_key,
            regeneratedImageUrl=regenerated_presigned_url,
            processingTimeMs=processing_time_ms
        )
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        logger.error(f"❌ Image regeneration failed: {e}")
        
        # Call back with error if URL provided
        if request.callbackUrl:
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        request.callbackUrl,
                        json={
                            "success": False,
                            "regenerationId": request.regenerationId,
                            "error": str(e),
                            "processingTimeMs": processing_time_ms,
                        },
                        timeout=30.0
                    )
            except Exception as callback_error:
                logger.error(f"❌ Error callback failed: {callback_error}")
        
        return RegenerateImageResponse(
            success=False,
            error=str(e),
            processingTimeMs=processing_time_ms
        )


@router.post("/regenerate", response_model=RegenerateImageResponse)
async def regenerate_image(request: RegenerateImageRequest, background_tasks: BackgroundTasks):
    """
    Regenerate an image using fal nano-banana-pro edit model.
    
    Takes a user prompt and source image S3 key, generates a new image
    that incorporates the prompt's requested changes.
    
    Processing happens in the background with optional callback.
    """
    try:
        logger.info(f"🎨 Image regeneration request received:")
        logger.info(f"   Account: {request.accountId}")
        logger.info(f"   Content: {request.generatedContentId}, Post: {request.postIndex}")
        logger.info(f"   Prompt: {request.prompt[:50]}...")
        logger.info(f"   Source: {request.sourceImageS3Key}")
        
        # Validate source image exists
        if not request.sourceImageS3Key:
            raise HTTPException(status_code=400, detail="Source image S3 key is required")
        
        if not request.prompt or not request.prompt.strip():
            raise HTTPException(status_code=400, detail="Prompt is required")
        
        # If callback URL provided, process in background
        if request.callbackUrl:
            background_tasks.add_task(process_regeneration_and_callback, request)
            return RegenerateImageResponse(
                success=True,
                error=None
            )
        
        # Otherwise, process synchronously
        result = await process_regeneration_and_callback(request)
        
        if not result.success:
            raise HTTPException(status_code=500, detail=result.error)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error in regenerate_image endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "dvyb-image-regeneration"}

