"""
DVYB Image Overlay Route

Endpoint for applying text/emoji overlays to images.
Called by TypeScript backend as a background job.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.services.image_overlay_service import get_image_overlay_service

logger = logging.getLogger(__name__)

router = APIRouter()


class Overlay(BaseModel):
    """Overlay configuration from frontend"""
    id: str
    text: str
    x: float  # percentage (0-100)
    y: float  # percentage (0-100)
    width: float  # percentage (0-100)
    height: float  # percentage (0-100)
    rotation: float = 0
    fontSize: int = 24
    fontFamily: str = "Inter"
    color: str = "#FFFFFF"
    isBold: bool = False
    isItalic: bool = False
    isUnderline: bool = False
    isEmoji: bool = False
    isSticker: bool = False


class ProcessImageRequest(BaseModel):
    """Request body for processing image with overlays"""
    accountId: int
    generatedContentId: int
    postIndex: int
    sourceImageUrl: str  # S3 key of source image (original or regenerated)
    overlays: List[Overlay]
    referenceWidth: int = 450
    # Callback URL to notify TypeScript backend when processing is complete
    callbackUrl: Optional[str] = None


class ProcessImageResponse(BaseModel):
    """Response for image processing"""
    success: bool
    editedImageUrl: Optional[str] = None
    error: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    overlaysApplied: Optional[int] = None


async def process_and_callback(request: ProcessImageRequest):
    """Background task to process image and optionally call back to TypeScript backend"""
    try:
        service = get_image_overlay_service()
        
        # Convert overlays to dict format
        overlays_dict = [overlay.model_dump() for overlay in request.overlays]
        
        result = await service.process_image_with_overlays(
            source_image_url=request.sourceImageUrl,
            overlays=overlays_dict,
            account_id=request.accountId,
            generated_content_id=request.generatedContentId,
            post_index=request.postIndex
        )
        
        # If callback URL is provided, notify TypeScript backend
        if request.callbackUrl:
            import httpx
            try:
                async with httpx.AsyncClient() as client:
                    callback_data = {
                        'accountId': request.accountId,
                        'generatedContentId': request.generatedContentId,
                        'postIndex': request.postIndex,
                        'success': result.get('success', False),
                        'editedImageUrl': result.get('edited_image_url'),
                        'error': result.get('error')
                    }
                    await client.post(request.callbackUrl, json=callback_data, timeout=30)
                    logger.info(f"Callback sent to {request.callbackUrl}")
            except Exception as e:
                logger.error(f"Failed to send callback: {e}")
        
        return result
        
    except Exception as e:
        logger.error(f"Background processing failed: {e}")
        import traceback
        traceback.print_exc()


@router.post("/process", response_model=ProcessImageResponse)
async def process_image_overlay(request: ProcessImageRequest, background_tasks: BackgroundTasks):
    """
    Process an image by applying text/emoji overlays.
    
    This endpoint:
    1. Downloads the source image from S3
    2. Applies all overlays (text, emojis, stickers)
    3. Uploads the result back to S3
    4. Optionally calls back to TypeScript backend with the result
    
    Processing happens in the background. The endpoint returns immediately
    with status 'processing'. Use the callback URL to get notified when done.
    """
    try:
        logger.info(f"📥 Image overlay request: account={request.accountId}, content={request.generatedContentId}, post={request.postIndex}")
        logger.info(f"   Source: {request.sourceImageUrl}, Overlays: {len(request.overlays)}")
        
        # For immediate response, process synchronously if no callback
        if not request.callbackUrl:
            # Process synchronously
            service = get_image_overlay_service()
            overlays_dict = [overlay.model_dump() for overlay in request.overlays]
            
            result = await service.process_image_with_overlays(
                source_image_url=request.sourceImageUrl,
                overlays=overlays_dict,
                account_id=request.accountId,
                generated_content_id=request.generatedContentId,
                post_index=request.postIndex
            )
            
            return ProcessImageResponse(
                success=result.get('success', False),
                editedImageUrl=result.get('edited_image_url'),
                error=result.get('error'),
                width=result.get('width'),
                height=result.get('height'),
                overlaysApplied=result.get('overlays_applied')
            )
        else:
            # Process in background
            background_tasks.add_task(process_and_callback, request)
            
            return ProcessImageResponse(
                success=True,
                error=None
            )
            
    except Exception as e:
        logger.error(f"Error in process_image_overlay: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "service": "dvyb-image-overlay"}

