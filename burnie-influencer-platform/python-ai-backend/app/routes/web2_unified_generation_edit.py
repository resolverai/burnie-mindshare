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
        
        # Generate images for each prompt
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
            'context_management': {}
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
        await save_generated_content_to_db(request, context, edit_prompts, generated_content, {})
        
        return {
            "success": True,
            "job_id": job_id,
            "message": "Edit generation completed successfully"
        }
        
    except Exception as e:
        print(f"❌ Error in edit generation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Edit generation failed: {str(e)}")


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
            context=context
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


import json
