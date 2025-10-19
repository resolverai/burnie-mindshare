"""
Web2 Content Generation Routes
Standalone endpoints for image and clip generation without agentic system
Includes prompt generation using Grok LLM
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import fal_client
import os
import requests
import logging
from datetime import datetime
import asyncio
import httpx
import uuid

from app.config.settings import settings
from app.utils.web2_s3_helper import web2_s3_helper
from app.services.grok_prompt_service import grok_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class PromptGenerationRequest(BaseModel):
    """Request for generating prompts using Grok"""
    account_id: int
    prompt_types: List[str]  # ['image', 'clip', 'tweet', 'audio', 'voiceover']
    num_prompts: Optional[Dict[str, int]] = None  # e.g., {"image": 3, "clip": 1}
    
    # Optional context
    theme: Optional[str] = None
    user_prompt: Optional[str] = None
    user_images: Optional[List[str]] = None  # S3 URLs of user-uploaded images
    workflow_type: Optional[str] = None
    target_platform: Optional[str] = None
    
    # Flags
    no_characters: bool = False
    human_characters_only: bool = False
    web3_characters: bool = False
    use_brand_aesthetics: bool = True
    viral_trends: bool = False
    include_logo: bool = False
    
    # Model preferences (optional, uses account config if not provided)
    image_model: Optional[str] = None
    video_model: Optional[str] = None
    clip_duration: Optional[int] = None


class ImageGenerationRequest(BaseModel):
    account_id: int
    prompt: str
    num_images: int = 1  # Number of images to generate (1-5)
    include_logo: bool = False
    user_images: Optional[List[str]] = None  # S3 URLs of user-uploaded reference images
    user_prompt: Optional[str] = None  # Additional user instructions
    image_model: Optional[str] = None  # 'flux-pro-kontext', 'seedream' or 'nano-banana', uses account config if not provided


class ClipGenerationRequest(BaseModel):
    account_id: int
    prompt: str
    # For Pixverse: provide both first_image_url and last_image_url
    # For Sora/Kling: provide only image_url
    image_url: Optional[str] = None
    first_image_url: Optional[str] = None
    last_image_url: Optional[str] = None
    duration: int  # Duration in seconds
    include_logo: bool = False
    user_image: Optional[str] = None  # S3 URL of user-uploaded reference image
    user_prompt: Optional[str] = None  # Additional user instructions
    video_model: Optional[str] = None  # 'pixverse', 'sora', or 'kling', uses account config if not provided


class ContentGenerationResponse(BaseModel):
    success: bool
    content_url: Optional[str] = None
    content_urls: Optional[List[str]] = None  # For multiple images
    s3_key: Optional[str] = None
    s3_keys: Optional[List[str]] = None  # For multiple images
    error: Optional[str] = None


class PromptGenerationResponse(BaseModel):
    success: bool
    prompts: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ============================================
# HELPER FUNCTIONS
# ============================================

async def fetch_account_configuration(account_id: int) -> dict:
    """Fetch account configuration from TypeScript backend"""
    try:
        backend_url = settings.typescript_backend_url
        url = f"{backend_url}/api/web2-account-configurations/{account_id}"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            
            if response.status_code == 200:
                config = response.json()
                logger.info(f"✅ Fetched account config for account {account_id}: {config}")
                return config
            else:
                logger.warning(f"⚠️ Failed to fetch account config (status {response.status_code}), using defaults")
                return {
                    'image_model': 'seedream',
                    'video_model': 'kling',
                    'clip_duration': 5
                }
                
    except Exception as e:
        logger.error(f"❌ Error fetching account configuration: {e}")
        return {
            'image_model': 'seedream',
            'video_model': 'kling',
            'clip_duration': 5
        }


async def fetch_brand_context(account_id: int) -> dict:
    """Fetch brand context including logo URL from TypeScript backend"""
    try:
        backend_url = settings.typescript_backend_url
        url = f"{backend_url}/api/web2-account-context/account/{account_id}"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            
            if response.status_code == 200:
                context = response.json()
                logger.info(f"✅ Fetched brand context for account {account_id}")
                return context
            else:
                logger.warning(f"⚠️ No brand context found for account {account_id}")
                return None
                
    except Exception as e:
        logger.error(f"❌ Error fetching brand context: {e}")
        return None


async def build_grok_context(
    account_id: int,
    user_prompt: Optional[str] = None,
    user_images: Optional[List[str]] = None,
    theme: Optional[str] = None,
    workflow_type: Optional[str] = None,
    target_platform: Optional[str] = None,
    no_characters: bool = False,
    human_characters_only: bool = False,
    web3_characters: bool = False,
    use_brand_aesthetics: bool = True,
    viral_trends: bool = False,
    include_logo: bool = False,
    image_model: Optional[str] = None,
    video_model: Optional[str] = None,
    clip_duration: Optional[int] = None
) -> Dict:
    """Build comprehensive context for Grok prompt generation"""
    
    # Fetch account config and brand context
    account_config = await fetch_account_configuration(account_id)
    brand_context = await fetch_brand_context(account_id)
    
    # Extract brand info
    brand_data = brand_context.get('data', {}) if brand_context else {}
    brand_name = brand_data.get('brand_name', 'the brand')
    brand_description = brand_data.get('brand_description')
    industry = brand_data.get('industry')
    
    # Build context dict
    context = {
        'brand_name': brand_name,
        'brand_description': brand_description,
        'industry': industry,
        'theme': theme,
        'user_prompt': user_prompt,
        'user_images': user_images or [],
        'workflow_type': workflow_type,
        'target_platform': target_platform,
        'no_characters': no_characters,
        'human_characters_only': human_characters_only,
        'web3_characters': web3_characters,
        'use_brand_aesthetics': use_brand_aesthetics,
        'viral_trends': viral_trends,
        'image_model': image_model or account_config.get('image_model', 'nano-banana'),
        'video_model': video_model or account_config.get('video_model', 'kling'),
        'clip_duration': clip_duration or account_config.get('clip_duration', 5),
        'aspect_ratio': '1:1'  # For images
    }
    
    # Add brand aesthetics if requested
    if use_brand_aesthetics and brand_data:
        aesthetics = {}
        if brand_data.get('color_palette'):
            aesthetics['color_palette'] = brand_data['color_palette']
        if brand_data.get('tone'):
            aesthetics['tone'] = brand_data['tone']
        if brand_data.get('visual_style'):
            aesthetics['style'] = brand_data['visual_style']
        
        if aesthetics:
            context['brand_aesthetics'] = aesthetics
    
    # Add logo URL if requested
    if include_logo and brand_data.get('logo_url'):
        context['logo_url'] = brand_data['logo_url']
    
    return context


def download_file(url: str, local_path: str) -> bool:
    """Download file from URL to local path"""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        with open(local_path, 'wb') as f:
            f.write(response.content)
        
        logger.info(f"✅ Downloaded file: {local_path}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to download file from {url}: {e}")
        return False


def cleanup_local_file(file_path: str):
    """Clean up local file"""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"🗑️ Cleaned up local file: {file_path}")
    except Exception as e:
        logger.warning(f"⚠️ Failed to clean up file {file_path}: {e}")


# ============================================
# FILE UPLOAD ENDPOINT
# ============================================

@router.post("/upload-user-file")
async def upload_user_file(
    account_id: int = Form(...),
    file: UploadFile = File(...)
):
    """
    Upload user file (image) to S3 for use in content generation
    Returns S3 URL that can be used in generation endpoints
    """
    try:
        logger.info(f"📤 User file upload request for account {account_id}: {file.filename}")
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)")
        
        # Validate file size (10MB max)
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size must be less than 10MB")
        
        # Generate unique filename
        ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"user_upload_{timestamp}_{unique_id}.{ext}"
        
        # Save locally first
        local_path = f"/tmp/web2_generated/{account_id}/user_uploads/{filename}"
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        with open(local_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"✅ Saved file locally: {local_path}")
        
        # Upload to S3
        s3_key = web2_s3_helper.get_user_upload_s3_path(account_id, filename)
        upload_result = web2_s3_helper.upload_file_to_s3(local_path, s3_key, file.content_type)
        
        # Clean up local file
        cleanup_local_file(local_path)
        
        if upload_result['success']:
            # Return non-presigned S3 URL (s3://bucket/key format)
            s3_url = upload_result['s3_url']
            
            # Also generate presigned URL for immediate viewing
            presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
            
            return {
                "success": True,
                "s3_url": s3_url,
                "presigned_url": presigned_url,
                "filename": filename
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to upload file to S3")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ File upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# PROMPT GENERATION ENDPOINT
# ============================================

@router.post("/generate-prompts", response_model=PromptGenerationResponse)
async def generate_prompts(request: PromptGenerationRequest):
    """
    Generate prompts using Grok LLM based on provided context
    
    This endpoint can generate:
    - Image prompts (for Fal.ai image models)
    - Clip prompts (for Fal.ai video models)
    - Tweet/message text
    - Audio prompts
    - Voiceover prompts
    
    The prompts are generated based on brand context, user input, and various flags.
    """
    try:
        logger.info(f"🤖 Prompt generation request for account {request.account_id}")
        logger.info(f"📝 Prompt types: {request.prompt_types}")
        logger.info(f"🔢 Num prompts: {request.num_prompts}")
        
        # Build comprehensive context
        context = await build_grok_context(
            account_id=request.account_id,
            user_prompt=request.user_prompt,
            user_images=request.user_images,
            theme=request.theme,
            workflow_type=request.workflow_type,
            target_platform=request.target_platform,
            no_characters=request.no_characters,
            human_characters_only=request.human_characters_only,
            web3_characters=request.web3_characters,
            use_brand_aesthetics=request.use_brand_aesthetics,
            viral_trends=request.viral_trends,
            include_logo=request.include_logo,
            image_model=request.image_model,
            video_model=request.video_model,
            clip_duration=request.clip_duration
        )
        
        logger.info(f"📦 Context built: {context.get('brand_name')}, workflow: {context.get('workflow_type')}")
        
        # Generate prompts using Grok
        prompts = grok_service.generate_prompts(
            context=context,
            prompt_types=request.prompt_types,
            num_prompts=request.num_prompts or {},
            use_live_search=request.viral_trends
        )
        
        logger.info(f"✅ Generated {len(prompts)} prompts successfully")
        
        return PromptGenerationResponse(
            success=True,
            prompts=prompts
        )
        
    except Exception as e:
        logger.error(f"❌ Prompt generation failed: {e}")
        return PromptGenerationResponse(
            success=False,
            error=str(e)
        )


# ============================================
# IMAGE GENERATION ENDPOINT
# ============================================

@router.post("/generate-image", response_model=ContentGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """
    Generate one or multiple images using Fal.ai models (Flux Pro Kontext, Seedream, or Nano-Banana)
    
    - Generates images in 1:1 or square_hd aspect ratio
    - Supports num_images (1-5) for generating multiple images at once
    - Supports optional logo integration
    - Supports user-uploaded reference images
    - Returns S3 URLs of generated images
    """
    try:
        logger.info(f"🎨 Image generation request for account {request.account_id}")
        logger.info(f"🔢 Generating {request.num_images} image(s)")
        
        # Validate num_images
        if request.num_images < 1 or request.num_images > 5:
            raise HTTPException(status_code=400, detail="num_images must be between 1 and 5")
        
        # Fetch account configuration
        account_config = await fetch_account_configuration(request.account_id)
        image_model = request.image_model or account_config.get('image_model', 'seedream')
        
        logger.info(f"🔧 Using image model: {image_model}")
        
        # Validate image model
        if image_model not in ['flux-pro-kontext', 'seedream', 'nano-banana']:
            raise HTTPException(status_code=400, detail="Invalid image_model. Must be 'flux-pro-kontext', 'seedream', or 'nano-banana'")
        
        # Prepare reference images
        reference_image_urls = []
        
        # Add user-uploaded images
        if request.user_images:
            logger.info(f"📷 User uploaded {len(request.user_images)} reference image(s)")
            for user_img_url in request.user_images:
                fresh_url = web2_s3_helper.get_fresh_presigned_url_from_s3_url(user_img_url)
                if fresh_url:
                    reference_image_urls.append(fresh_url)
                    logger.info(f"✅ Fresh presigned URL generated for user image")
                else:
                    logger.warning(f"⚠️ Failed to generate presigned URL for user image")
        
        # Add logo if requested
        if request.include_logo:
            logger.info("🏆 Logo requested, fetching brand context...")
            brand_context = await fetch_brand_context(request.account_id)
            
            if brand_context:
                brand_data = brand_context.get('data', {})
                logo_url = brand_data.get('logo_url')
                
                if logo_url:
                    logger.info(f"🏆 Logo URL found: {logo_url}")
                    
                    # Generate fresh presigned URL for logo
                    fresh_logo_url = web2_s3_helper.get_fresh_presigned_url_from_s3_url(logo_url)
                    if fresh_logo_url:
                        reference_image_urls.append(fresh_logo_url)
                        logger.info("✅ Fresh logo presigned URL generated")
                    else:
                        logger.warning("⚠️ Failed to generate fresh presigned URL for logo")
                else:
                    logger.warning(f"⚠️ No logo found for account {request.account_id}")
            else:
                logger.warning(f"⚠️ No brand context found for account {request.account_id}")
        
        # Prepare Fal.ai arguments based on model
        if image_model == "flux-pro-kontext":
            arguments = {
                "prompt": request.prompt,
                "image_urls": reference_image_urls if reference_image_urls else [],
                "aspect_ratio": "1:1",
                "num_images": request.num_images,
                "enable_safety_checker": True,
                "output_format": "jpeg"
            }
            
            model_name = "fal-ai/flux-pro/kontext"
            
        elif image_model == "nano-banana":
            arguments = {
                "prompt": request.prompt,
                "num_images": request.num_images,
                "output_format": "jpeg",
                "aspect_ratio": "1:1",
                "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, hashtags, double logos"
            }
            
            if reference_image_urls:
                arguments["image_urls"] = reference_image_urls
            
            model_name = "fal-ai/nano-banana/edit"
            
        else:  # seedream
            arguments = {
                "prompt": request.prompt,
                "num_images": request.num_images,
                "max_images": request.num_images,
                "enable_safety_checker": True,
                "image_size": "square_hd",
                "negative_prompt": "blurry, low quality, distorted, oversaturated, unrealistic proportions, hashtags, double logos"
            }
            
            if reference_image_urls:
                arguments["image_urls"] = reference_image_urls
            
            model_name = "fal-ai/bytedance/seedream/v4/edit"
        
        logger.info(f"🎨 Generating {request.num_images} image(s) with {image_model.upper()}...")
        
        # Generate images using Fal.ai
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    logger.info(f"📋 Fal.ai log: {log['message']}")
        
        result = fal_client.subscribe(
            model_name,
            arguments=arguments,
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'images' in result and len(result['images']) > 0:
            logger.info(f"✅ Generated {len(result['images'])} image(s)")
            
            generated_urls = []
            generated_s3_keys = []
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Download and upload each image
            for idx, image_data in enumerate(result['images']):
                image_url = image_data['url']
                logger.info(f"📥 Processing image {idx + 1}/{len(result['images'])}")
                
                # Download image locally
                filename = f"image_{timestamp}_{idx + 1}.jpg"
                local_path = f"/tmp/web2_generated/{request.account_id}/images/{filename}"
                
                if download_file(image_url, local_path):
                    # Upload to S3
                    s3_key = web2_s3_helper.get_generated_image_s3_path(request.account_id, filename)
                    upload_result = web2_s3_helper.upload_file_to_s3(local_path, s3_key, "image/jpeg")
                    
                    # Clean up local file
                    cleanup_local_file(local_path)
                    
                    if upload_result['success']:
                        # Generate presigned URL
                        presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                        generated_urls.append(presigned_url)
                        generated_s3_keys.append(s3_key)
                        logger.info(f"✅ Image {idx + 1} uploaded to S3")
                    else:
                        logger.warning(f"⚠️ Failed to upload image {idx + 1} to S3")
                else:
                    logger.warning(f"⚠️ Failed to download image {idx + 1}")
            
            if len(generated_urls) > 0:
                # Return single or multiple URLs based on what was generated
                if len(generated_urls) == 1:
                    return ContentGenerationResponse(
                        success=True,
                        content_url=generated_urls[0],
                        s3_key=generated_s3_keys[0]
                    )
                else:
                    return ContentGenerationResponse(
                        success=True,
                        content_urls=generated_urls,
                        s3_keys=generated_s3_keys
                    )
            else:
                raise HTTPException(status_code=500, detail="Failed to process any generated images")
        else:
            raise HTTPException(status_code=500, detail="No images generated by Fal.ai")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Image generation failed: {e}")
        return ContentGenerationResponse(
            success=False,
            error=str(e)
        )


# ============================================
# CLIP GENERATION ENDPOINT
# ============================================

@router.post("/generate-clip", response_model=ContentGenerationResponse)
async def generate_clip(request: ClipGenerationRequest):
    """
    Generate a single video clip using Fal.ai models (Pixverse, Sora, or Kling)
    
    - Generates clips in 16:9 aspect ratio
    - Pixverse: requires first_image_url and last_image_url (5s or 8s)
    - Sora: requires image_url (4s, 8s, or 12s)
    - Kling: requires image_url (5s or 10s)
    - Supports optional logo integration in the input image
    - Returns S3 URL of generated clip
    """
    try:
        logger.info(f"🎬 Clip generation request for account {request.account_id}")
        
        # Fetch account configuration
        account_config = await fetch_account_configuration(request.account_id)
        video_model = request.video_model or account_config.get('video_model', 'kling')
        
        logger.info(f"🔧 Using video model: {video_model}")
        
        # Validate video model
        if video_model not in ['pixverse', 'sora', 'kling']:
            raise HTTPException(status_code=400, detail="Invalid video_model. Must be 'pixverse', 'sora', or 'kling'")
        
        # Validate duration based on model
        if video_model == 'pixverse' and request.duration not in [5, 8]:
            raise HTTPException(status_code=400, detail="Pixverse only supports durations of 5 or 8 seconds")
        elif video_model == 'sora' and request.duration not in [4, 8, 12]:
            raise HTTPException(status_code=400, detail="Sora only supports durations of 4, 8, or 12 seconds")
        elif video_model == 'kling' and request.duration not in [5, 10]:
            raise HTTPException(status_code=400, detail="Kling only supports durations of 5 or 10 seconds")
        
        # Validate required image URLs based on model
        if video_model == 'pixverse':
            if not request.first_image_url or not request.last_image_url:
                raise HTTPException(status_code=400, detail="Pixverse requires both first_image_url and last_image_url")
        else:  # sora or kling
            if not request.image_url:
                raise HTTPException(status_code=400, detail=f"{video_model.capitalize()} requires image_url")
        
        # Generate fresh presigned URLs for input images
        if video_model == 'pixverse':
            logger.info("🔄 Generating fresh presigned URLs for Pixverse input images...")
            fresh_first_url = web2_s3_helper.get_fresh_presigned_url_from_s3_url(request.first_image_url)
            fresh_last_url = web2_s3_helper.get_fresh_presigned_url_from_s3_url(request.last_image_url)
            
            if not fresh_first_url or not fresh_last_url:
                raise HTTPException(status_code=500, detail="Failed to generate fresh presigned URLs for input images")
        else:
            logger.info(f"🔄 Generating fresh presigned URL for {video_model.capitalize()} input image...")
            fresh_image_url = web2_s3_helper.get_fresh_presigned_url_from_s3_url(request.image_url)
            
            if not fresh_image_url:
                raise HTTPException(status_code=500, detail="Failed to generate fresh presigned URL for input image")
        
        # Generate clip based on model
        logger.info(f"🎬 Generating clip with {video_model.upper()}...")
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    logger.info(f"📋 Fal.ai log: {log['message']}")
        
        if video_model == 'pixverse':
            # Pixverse Transition model
            result = fal_client.subscribe(
                "fal-ai/pixverse/v5/transition",
                arguments={
                    "prompt": request.prompt,
                    "aspect_ratio": "16:9",
                    "resolution": "720p",
                    "duration": str(request.duration),
                    "negative_prompt": "blurry, low quality, low resolution, pixelated, noisy, grainy, out of focus",
                    "first_image_url": fresh_first_url,
                    "last_image_url": fresh_last_url
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
        elif video_model == 'sora':
            # Sora2 Image-to-Video model
            result = fal_client.subscribe(
                "fal-ai/sora-2/image-to-video/pro",
                arguments={
                    "prompt": request.prompt,
                    "resolution": "auto",
                    "aspect_ratio": "16:9",
                    "duration": request.duration,
                    "image_url": fresh_image_url
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
            
        else:  # kling
            # Kling Image-to-Video model
            result = fal_client.subscribe(
                "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
                arguments={
                    "prompt": request.prompt,
                    "image_url": fresh_image_url,
                    "duration": str(request.duration),
                    "negative_prompt": "blur, distort, and low quality",
                    "cfg_scale": 0.5
                },
                with_logs=True,
                on_queue_update=on_queue_update,
            )
        
        if result and 'video' in result:
            video_url = result['video']['url']
            logger.info(f"✅ Clip generated: {video_url}")
            
            # Download clip locally
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"clip_{timestamp}.mp4"
            local_path = f"/tmp/web2_generated/{request.account_id}/videos/{filename}"
            
            if download_file(video_url, local_path):
                # Upload to S3
                s3_key = web2_s3_helper.get_generated_video_s3_path(request.account_id, filename)
                upload_result = web2_s3_helper.upload_file_to_s3(local_path, s3_key, "video/mp4")
                
                # Clean up local file
                cleanup_local_file(local_path)
                
                if upload_result['success']:
                    # Generate presigned URL
                    presigned_url = web2_s3_helper.generate_presigned_url(s3_key)
                    
                    return ContentGenerationResponse(
                        success=True,
                        content_url=presigned_url,
                        s3_key=s3_key
                    )
                else:
                    raise HTTPException(status_code=500, detail="Failed to upload clip to S3")
            else:
                raise HTTPException(status_code=500, detail="Failed to download generated clip")
        else:
            raise HTTPException(status_code=500, detail="No clip generated by Fal.ai")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Clip generation failed: {e}")
        return ContentGenerationResponse(
            success=False,
            error=str(e)
        )

