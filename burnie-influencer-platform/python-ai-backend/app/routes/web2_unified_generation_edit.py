"""
Web2 Unified Generation Edit Endpoint

Handles edit flow for generated images with permutation-based prompt refinement.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import uuid
import asyncio
from datetime import datetime

from app.routes.web2_unified_generation import (
    run_visual_analysis,
    generate_prompts,
    generate_images,
    save_generated_content_to_db,
    download_and_save_to_s3,
    map_model_name_to_fal_id,
    generate_with_nano_banana,
    generate_with_flux_pro_kontext,
    generate_with_seedream
)
from app.services.grok_prompt_service import grok_service

router = APIRouter()


class UnifiedGenerationEditRequest(BaseModel):
    """Request model for edit generation"""
    account_id: int
    account_client_id: Optional[str] = None
    content_type: str = "image"
    industry: str = "Fashion"
    workflow_type: str = "Edit Flow"
    theme: str = "Image refinement with permutation-based styling"
    
    # Edit-specific fields
    original_prompt: str = Field(..., description="Original prompt used to generate the image being edited")
    product_category: str = Field(..., description="Product category from inventory analysis")
    reference_image_url: str = Field(..., description="S3 URL of the image being edited")
    
    # User selections
    num_variations: int = Field(default=4, ge=1, le=5, description="Number of variations to generate")
    additional_instructions: Optional[str] = Field(default="", description="Additional user instructions")
    
    # Permutation selections
    model_preferences: Optional[Dict[str, List[str]]] = Field(default_factory=dict)
    target_occasions: Optional[List[str]] = Field(default_factory=list)
    settings_context: Optional[List[str]] = Field(default_factory=list)
    styling_enhancements: Optional[List[str]] = Field(default_factory=list)
    color_variations: Optional[List[str]] = Field(default_factory=list)
    style_variations: Optional[List[str]] = Field(default_factory=list)
    product_categories: Optional[List[str]] = Field(default_factory=list)
    styling_transformations: Optional[List[str]] = Field(default_factory=list)
    seasons: Optional[List[str]] = Field(default_factory=list)
    campaign_styles: Optional[List[str]] = Field(default_factory=list)
    
    # Model image (if provided)
    model_image_url: Optional[str] = Field(default=None, description="Model image URL if provided")
    
    # Original platform texts (if available)
    original_platform_texts: Optional[Dict[str, str]] = Field(default=None, description="Original platform texts from the image being edited")
    
    # Brand context
    include_logo: bool = Field(default=True)
    no_characters: bool = Field(default=False)
    human_characters_only: bool = Field(default=True)
    web3_characters: bool = Field(default=False)
    use_brand_aesthetics: bool = Field(default=True)
    viral_trends: bool = Field(default=False)
    
    # Technical settings
    image_model: Optional[str] = Field(default=None, description="Image model to use (will be fetched from account config if not provided)")
    video_model: str = Field(default="fal-flux")
    clip_duration: int = Field(default=5)
    aspect_ratio: str = Field(default="1:1")


async def create_initial_edit_record(request: UnifiedGenerationEditRequest, job_id: str):
    """Create initial database record for edit generation tracking"""
    try:
        import httpx
        import os
        
        # Prepare user images array (reference image + model image if provided)
        user_images = [request.reference_image_url]
        if request.model_image_url:
            user_images.append(request.model_image_url)
        
        # Prepare data for initial database storage
        db_data = {
            "account_id": request.account_id,
            "account_client_id": request.account_client_id,
            "content_type": request.content_type,
            "image_model": request.image_model,
            "video_model": request.video_model,
            "clip_duration": request.clip_duration,
            "user_prompt": request.original_prompt,  # Store original prompt as user prompt
            "user_images": user_images,
            "theme": request.theme,
            "workflow_type": request.workflow_type,
            "target_platform": "multi",  # Edit flow supports multiple platforms
            "include_logo": request.include_logo,
            "no_characters": request.no_characters,
            "human_characters_only": request.human_characters_only,
            "web3_characters": request.web3_characters,
            "use_brand_aesthetics": request.use_brand_aesthetics,
            "viral_trends": request.viral_trends,
            "status": "generating",
            "num_variations": request.num_variations,
            "workflow_metadata": {
                "industry": request.industry,
                "original_prompt": request.original_prompt,
                "product_category": request.product_category,
                "reference_image_url": request.reference_image_url,
                "model_image_url": request.model_image_url,
                "additional_instructions": request.additional_instructions,
                "permutation_context": {
                    "model_preferences": request.model_preferences,
                    "target_occasions": request.target_occasions,
                    "settings_context": request.settings_context,
                    "styling_enhancements": request.styling_enhancements,
                    "color_variations": request.color_variations,
                    "style_variations": request.style_variations,
                    "product_categories": request.product_categories,
                    "styling_transformations": request.styling_transformations,
                    "seasons": request.seasons,
                    "campaign_styles": request.campaign_styles
                }
            },
            "visual_analysis": {},
            "brand_context": {},
            "industry": request.industry,
            "job_id": job_id,
            "progress_percent": 10,
            "progress_message": "Starting edit generation...",
            "current_step": "initializing"
        }
        
        # Save to database via TypeScript backend
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/web2-generated-content",
                json=db_data
            )
            response.raise_for_status()
            print(f"✅ Initial edit record created for job {job_id}")
            
    except Exception as e:
        print(f"❌ Error creating initial edit record: {str(e)}")
        raise


async def generate_edit_images(request: UnifiedGenerationEditRequest, edit_prompts: Dict, context: Dict) -> Dict:
    """Generate images for edit flow using Fal.ai with proper model mapping"""
    try:
        print("🎨 EDIT IMAGE GENERATION")
        print("=" * 50)
        
        image_model = context.get('image_model', 'seedream')
        logo_url = context.get('logo_url')
        reference_image_url = request.reference_image_url
        model_image_url = request.model_image_url
        
        print(f"🖼️  Image Model: {image_model}")
        print(f"🖼️  Reference Image: {reference_image_url}")
        print(f"🖼️  Model Image: {model_image_url}")
        print(f"🖼️  Logo URL: {logo_url}")
        print(f"🖼️  Include Logo: {request.include_logo}")
        
        generated_images = []
        
        # Prepare image URLs for Fal.ai
        image_urls_for_fal = [reference_image_url]
        if model_image_url:
            image_urls_for_fal.append(model_image_url)
        if request.include_logo and logo_url:
            image_urls_for_fal.append(logo_url)
        
        print(f"🖼️  Image URLs for Fal.ai: {image_urls_for_fal}")
        
        # Generate presigned URLs for Fal.ai
        from app.utils.web2_s3_helper import Web2S3Helper
        s3_helper = Web2S3Helper()
        
        presigned_urls = []
        for url in image_urls_for_fal:
            try:
                # Extract S3 key from URL first
                s3_key = s3_helper.extract_s3_key_from_url(url)
                presigned_url = s3_helper.generate_presigned_url(s3_key)
                presigned_urls.append(presigned_url)
                print(f"✅ Generated presigned URL for: {url}")
            except Exception as e:
                print(f"❌ Failed to generate presigned URL for {url}: {e}")
                # Continue with other URLs
        
        if not presigned_urls:
            return {"error": "Failed to generate presigned URLs for image generation"}
        
        # Generate images for each prompt with progressive saving
        for i in range(1, request.num_variations + 1):
            prompt_key = f'prompt_{i}'
            if prompt_key not in edit_prompts:
                continue
                
            image_prompt = edit_prompts[prompt_key]
            print(f"🖼️  Generating image {i}/{request.num_variations}")
            print(f"🖼️  Prompt: {image_prompt}")
            
            try:
                # Map model name to Fal.ai model ID
                fal_model_id = map_model_name_to_fal_id(image_model)
                print(f"🖼️  Using Fal.ai Model ID: {fal_model_id}")
                
                # Call Fal.ai based on model
                if image_model == 'nano-banana':
                    result = await generate_with_nano_banana(image_prompt, presigned_urls)
                elif image_model == 'flux-pro-kontext':
                    result = await generate_with_flux_pro_kontext(image_prompt, presigned_urls)
                elif image_model == 'seedream':
                    result = await generate_with_seedream(image_prompt, presigned_urls)
                else:
                    # Default to seedream
                    print(f"⚠️  Unknown model {image_model}, defaulting to seedream")
                    result = await generate_with_seedream(image_prompt, presigned_urls)
                
                # Download and save generated image to S3
                fal_image_url = result.get('image_url', '')
                if fal_image_url:
                    print(f"📥 Downloading generated image from Fal.ai: {fal_image_url}")
                    s3_url = await download_and_save_to_s3(fal_image_url, request.account_id, f"edit_generated_image_{i}")
                    print(f"💾 Saved to S3: {s3_url}")
                    generated_images.append(s3_url)
                    
                    # Progressive save - update database with this image
                    await save_progressive_edit_image_to_db(request, context, s3_url, image_prompt, i - 1, edit_prompts)
                else:
                    print(f"❌ No image URL returned from Fal.ai for image {i}")
                    generated_images.append(f's3://placeholder/edit_image_{i}.jpg')
                    
            except Exception as e:
                print(f"❌ Error generating image {i}: {str(e)}")
                generated_images.append(f's3://placeholder/edit_image_{i}.jpg')
        
        print(f"✅ Generated {len(generated_images)} images")
        return {
            "generated_images": generated_images,
            "image_model": image_model,
            "fal_model_id": map_model_name_to_fal_id(image_model)
        }
        
    except Exception as e:
        print(f"❌ Error in edit image generation: {str(e)}")
        return {"error": f"Edit image generation failed: {str(e)}"}


@router.post("/api/web2/unified-generation-edit")
async def unified_generation_edit(request: UnifiedGenerationEditRequest):
    """
    Edit flow endpoint that takes a generated image and creates new variations
    with user-selected permutations and additional instructions.
    """
    try:
        print("=" * 80)
        print("🎨 UNIFIED GENERATION EDIT FLOW")
        print("=" * 80)
        print(f"📝 Original Prompt: {request.original_prompt}")
        print(f"📦 Product Category: {request.product_category}")
        print(f"🖼️ Reference Image: {request.reference_image_url}")
        print(f"🔢 Number of Variations: {request.num_variations}")
        print(f"💬 Additional Instructions: {request.additional_instructions}")
        print("=" * 80)
        
        # Generate job ID
        job_id = str(uuid.uuid4())
        print(f"🆔 Job ID: {job_id}")
        
        # Create initial database record
        await create_initial_edit_record(request, job_id)
        
        # Return job_id immediately for frontend navigation
        print(f"✅ Initial edit record created for job {job_id}")
        print(f"🚀 Returning job_id immediately for frontend navigation")
        
        # Start asynchronous processing (don't await - let it run in background)
        import asyncio
        asyncio.create_task(process_edit_generation_async(request, job_id))
        
        return {
            "success": True,
            "job_id": job_id,
            "message": "Edit generation started successfully"
        }
        
    except Exception as e:
        print(f"❌ Error in edit generation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Edit generation failed: {str(e)}")


async def process_edit_generation_async(request: UnifiedGenerationEditRequest, job_id: str):
    """
    Process edit generation asynchronously in the background.
    This function runs after the job_id is returned to the frontend.
    """
    try:
        print(f"🚀 Starting async edit generation for job {job_id}")
        
        # Prepare context for edit flow
        context = {
            'account_id': request.account_id,
            'industry': request.industry,
            'workflow_type': request.workflow_type,
            'original_prompt': request.original_prompt,
            'product_category': request.product_category,
            'reference_image_url': request.reference_image_url,
            'model_image_url': request.model_image_url,
            'include_logo': request.include_logo,
            'image_model': request.image_model or 'seedream',  # Will be updated from account config
            'logo_url': None,  # Will be fetched from brand context
            'brand_context': {},
            'context_management': {},
            'job_id': job_id  # Add job_id to context for progressive saving
        }
        
        # Fetch account configuration and brand context
        try:
            from app.routes.web2_unified_generation import fetch_account_configuration, fetch_brand_context_data
            
            # Get account configuration
            account_config = await fetch_account_configuration(request.account_id)
            if account_config:
                print(f"📋 Account Config: {account_config}")
                # Use account config image model if not provided in request
                if not request.image_model or request.image_model == 'seedream':  # Default fallback
                    context['image_model'] = account_config.get('image_model', 'seedream')
                    print(f"🖼️  Using account config image model: {context['image_model']}")
                else:
                    print(f"🖼️  Using request image model: {request.image_model}")
            else:
                print(f"⚠️  No account config found, using request image model: {request.image_model}")
            
            # Get brand context
            brand_context = await fetch_brand_context_data(request.account_id)
            if brand_context:
                context['brand_context'] = brand_context
                context['logo_url'] = brand_context.get('brand_logo_url')
                print(f"✅ Brand context loaded: {bool(brand_context)}")
                print(f"✅ Logo URL: {context['logo_url']}")
            
        except Exception as e:
            print(f"⚠️ Failed to fetch brand context: {e}")
        
        # Generate edit prompts using Grok
        print("🤖 Generating edit prompts with Grok...")
        edit_prompts = await generate_edit_prompts(request, context)
        print(f"✅ Generated {len(edit_prompts)} edit prompts")
        
        # Generate images using Fal.ai
        print("🎨 Generating images with Fal.ai...")
        generated_content = await generate_edit_images(request, edit_prompts, context)
        
        # Save to database
        print("💾 Saving generated content to database...")
        await save_edit_generated_content_to_db(request, context, edit_prompts, generated_content, {})
        
        print(f"✅ Async edit generation completed for job {job_id}")
        
    except Exception as e:
        print(f"❌ Error in async edit generation for job {job_id}: {str(e)}")
        # Update database with error status
        try:
            typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
            async with httpx.AsyncClient() as client:
                # Get existing record to find the numeric ID
                response = await client.get(f"{typescript_backend_url}/api/web2-generated-content/job/{job_id}")
                if response.status_code == 200:
                    existing_data = response.json()
                    if existing_data.get('success') and existing_data.get('data'):
                        existing_record = existing_data['data']
                        numeric_id = existing_record['id']
                        
                        # Update with error status
                        error_data = {
                            "progress_percent": 0,
                            "progress_message": f"Generation failed: {str(e)}",
                            "generation_state": "failed"
                        }
                        
                        await client.put(
                            f"{typescript_backend_url}/api/web2-generated-content/{numeric_id}",
                            json=error_data
                        )
                        print(f"✅ Updated database with error status for job {job_id}")
        except Exception as db_error:
            print(f"❌ Failed to update database with error status: {db_error}")


async def generate_edit_prompts(request: UnifiedGenerationEditRequest, context: Dict) -> Dict:
    """
    Generate refined prompts using Grok based on original prompt and user selections.
    """
    try:
        print("🤖 Generating edit prompts with Grok...")
        
        # Build permutation context
        permutation_context = {
            'model_preferences': request.model_preferences or {},
            'target_occasions': request.target_occasions or [],
            'settings_context': request.settings_context or [],
            'styling_enhancements': request.styling_enhancements or [],
            'color_variations': request.color_variations or [],
            'style_variations': request.style_variations or [],
            'product_categories': request.product_categories or [],
            'styling_transformations': request.styling_transformations or [],
            'seasons': request.seasons or [],
            'campaign_styles': request.campaign_styles or []
        }
        
        # Generate prompts using Grok edit service
        from app.services.grok_prompt_service import GrokPromptService
        grok_service = GrokPromptService()
        
        # Log input context for Grok
        print("🤖 GROK INPUT CONTEXT:")
        print(f"📝 Original Prompt: {request.original_prompt}")
        print(f"📦 Product Category: {request.product_category}")
        print(f"🔢 Number of Variations: {request.num_variations}")
        print(f"🔄 Permutation Context: {permutation_context}")
        print(f"💬 Additional Instructions: {request.additional_instructions or ''}")
        print(f"🏭 Industry: {request.industry}")
        print(f"🎯 Context: {context}")
        
        edit_prompts = grok_service.generate_edit_prompts(
            original_prompt=request.original_prompt,
            product_category=request.product_category,
            num_variations=request.num_variations,
            permutation_context=permutation_context,
            additional_instructions=request.additional_instructions or "",
            industry=request.industry,
            context=context,
            original_platform_texts=request.original_platform_texts  # Pass original platform texts
        )
        
        # Log Grok output
        print("🤖 GROK OUTPUT:")
        print(f"✅ Generated Prompts: {edit_prompts}")
        if isinstance(edit_prompts, dict):
            for key, value in edit_prompts.items():
                print(f"📝 {key}: {value}")
        
        print(f"✅ Generated {len(edit_prompts)} edit prompts")
        return edit_prompts
        
    except Exception as e:
        print(f"❌ Error generating edit prompts: {str(e)}")
        return {"error": f"Failed to generate edit prompts: {str(e)}"}


async def save_progressive_edit_image_to_db(request: UnifiedGenerationEditRequest, context: Dict, image_url: str, image_prompt: str, image_index: int, prompts: Dict):
    """Progressive save for edit images - update database as each image is generated"""
    try:
        import httpx
        import os
        
        # Get existing data from database
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        job_id = context.get('job_id')
        
        async with httpx.AsyncClient() as client:
            # Get existing record
            response = await client.get(f"{typescript_backend_url}/api/web2-generated-content/job/{job_id}")
            if not response.is_success:
                print(f"❌ Failed to get existing record for job {job_id}")
                return
            
            existing_data = response.json()
            if not existing_data.get('success'):
                print(f"❌ No existing record found for job {job_id}")
                return
            
            existing_record = existing_data['data']
            existing_urls = existing_record.get('generated_image_urls', [])
            
            # Ensure existing_urls is not None and is a list
            if existing_urls is None or not isinstance(existing_urls, list):
                existing_urls = []
            
            print(f"🔍 DEBUG: existing_urls type: {type(existing_urls)}, value: {existing_urls}")
            
            # Ensure the array is long enough
            while len(existing_urls) <= image_index:
                existing_urls.append('')
            
            # Update the specific image URL
            existing_urls[image_index] = image_url
            
            # Get existing per_image_metadata or initialize empty
            existing_per_image_metadata = existing_record.get('per_image_metadata', {})
            if not isinstance(existing_per_image_metadata, dict):
                existing_per_image_metadata = {}
            
            # Create/update the specific image metadata
            image_key = f"image_{image_index + 1}"
            existing_per_image_metadata[image_key] = {
                "image_url": image_url,
                "prompt": image_prompt,
                "platform_texts": {},  # Will be populated later if available
                "product_category": request.product_category,
                "image_index": image_index
            }
            
            print(f"🔍 DEBUG: Updated per_image_metadata for {image_key}: {image_prompt}")
            
            # Update with new image URL, per_image_metadata, and progress
            update_data = {
                "generated_image_urls": existing_urls,
                "per_image_metadata": existing_per_image_metadata,
                "progress_percent": min(90, 10 + (image_index * 20)),
                "progress_message": f"Generated {image_index + 1} of {request.num_variations} images"
            }
            
            # Update the record
            update_response = await client.put(
                f"{typescript_backend_url}/api/web2-generated-content/{existing_record['id']}",
                json=update_data
            )
            update_response.raise_for_status()
            print(f"✅ Progressive save successful for edit image {image_index + 1}")
            
    except Exception as e:
        print(f"❌ Error in progressive edit save: {str(e)}")


async def save_edit_generated_content_to_db(request: UnifiedGenerationEditRequest, context: Dict, prompts: Dict, generated_content: Dict, visual_analysis: Dict):
    """Save edit generated content to database via TypeScript backend API"""
    try:
        import httpx
        import os
        
        # Prepare user images array (reference image + model image if provided)
        user_images = [request.reference_image_url]
        if request.model_image_url:
            user_images.append(request.model_image_url)
        
        # Extract platform texts from prompts (similar to regular generation)
        per_image_platform_texts = []
        platform_texts = {}
        
        # For edit flow, we'll use the original prompt for all images since we're editing the same base image
        generated_prompts = []
        for i in range(1, request.num_variations + 1):
            prompt_key = f'prompt_{i}'
            if prompt_key in prompts:
                generated_prompts.append(prompts[prompt_key])
            else:
                generated_prompts.append(request.original_prompt)
        
        # Extract platform texts if available in prompts
        for i in range(1, request.num_variations + 1):
            platform_texts_key = f'image_{i}_platform_texts'
            image_platform_texts = prompts.get(platform_texts_key, {})
            per_image_platform_texts.append(image_platform_texts)
            print(f"🔍 DEBUG: Image {i} platform texts: {image_platform_texts}")
        
        # For backward compatibility, also extract from first image
        if per_image_platform_texts:
            platform_texts = per_image_platform_texts[0]
        
        # Build per_image_metadata
        per_image_metadata = {}
        generated_images = generated_content.get('generated_images', [])
        
        for i, image_url in enumerate(generated_images):
            image_key = f"image_{i + 1}"
            per_image_metadata[image_key] = {
                "image_url": image_url,
                "prompt": generated_prompts[i] if i < len(generated_prompts) else request.original_prompt,
                "platform_texts": per_image_platform_texts[i] if i < len(per_image_platform_texts) else {},
                "product_category": request.product_category,
                "image_index": i
            }
        
        # Prepare data for database storage
        db_data = {
            "account_id": request.account_id,
            "account_client_id": request.account_client_id,
            "content_type": request.content_type,
            "image_model": context.get('image_model'),
            "video_model": request.video_model,
            "clip_duration": request.clip_duration,
            "user_prompt": request.original_prompt,
            "user_images": user_images,
            "theme": request.theme,
            "workflow_type": request.workflow_type,
            "target_platform": "multi",
            "include_logo": request.include_logo,
            "no_characters": request.no_characters,
            "human_characters_only": request.human_characters_only,
            "web3_characters": request.web3_characters,
            "use_brand_aesthetics": request.use_brand_aesthetics,
            "viral_trends": request.viral_trends,
            "generated_image_urls": generated_images,
            "generated_prompts": generated_prompts,
            "product_categories": [request.product_category] * len(generated_images),
            "twitter_text": platform_texts.get('twitter', ''),
            "youtube_description": platform_texts.get('youtube', ''),
            "instagram_caption": platform_texts.get('instagram', ''),
            "linkedin_post": platform_texts.get('linkedin', ''),
            "status": "completed",
            "num_variations": request.num_variations,
            "workflow_metadata": {
                "industry": request.industry,
                "form_data": {},
                "custom_options": {}
            },
            "visual_analysis": visual_analysis,
            "brand_context": context.get('brand_context', {}),
            "industry": request.industry,
            "per_image_metadata": per_image_metadata,
            "job_id": context.get('job_id'),
            "progress_percent": 100,
            "progress_message": f"Generated {len(generated_images)} edit variations",
            "current_step": "completed"
        }
        
        # Get the numeric ID from the existing record
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        job_id = context.get('job_id')
        
        async with httpx.AsyncClient() as client:
            # Get existing record to find the numeric ID
            response = await client.get(f"{typescript_backend_url}/api/web2-generated-content/job/{job_id}")
            if not response.is_success:
                print(f"❌ Failed to get existing record for job {job_id}")
                raise Exception(f"Failed to get existing record for job {job_id}")
            
            existing_data = response.json()
            if not existing_data.get('success'):
                print(f"❌ No existing record found for job {job_id}")
                raise Exception(f"No existing record found for job {job_id}")
            
            existing_record = existing_data['data']
            numeric_id = existing_record['id']
            
            # Save to database using numeric ID
            response = await client.put(
                f"{typescript_backend_url}/api/web2-generated-content/{numeric_id}",
                json=db_data
            )
            response.raise_for_status()
            print(f"✅ Edit generated content saved to database for job {job_id} (ID: {numeric_id})")
            
    except Exception as e:
        print(f"❌ Error saving edit generated content to database: {str(e)}")
        raise


import json
