"""
Unified Web2 Content Generation Endpoint
Handles complete flow: Visual Analysis → Prompt Generation → Content Generation
With real-time progress updates via Server-Sent Events (SSE)
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import json
import logging
from datetime import datetime
import uuid

from app.services.visual_pattern_analysis_service import visual_analysis_service
from app.services.grok_prompt_service import grok_service
from app.utils.web2_s3_helper import web2_s3_helper
import fal_client
import os
import httpx

logger = logging.getLogger(__name__)

router = APIRouter()

# Configure fal_client
from app.config.settings import settings
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key


# ============================================
# REQUEST MODELS
# ============================================

class UnifiedContentGenerationRequest(BaseModel):
    """Request for unified content generation with all steps"""
    # Account info
    account_id: int
    account_client_id: Optional[int] = None
    job_id: Optional[str] = None
    
    # Content type
    content_type: str  # 'image' or 'video'
    
    # Workflow context
    industry: str  # 'Fashion', 'Social Media Management', 'Design Agency', etc.
    workflow_type: str  # 'Model Diversity Showcase', 'Viral Trend Content', etc.
    theme: Optional[str] = None
    
    # User inputs from workflow screen
    workflow_inputs: Optional[Dict[str, Any]] = None  # All form inputs from workflow
    user_uploaded_images: Optional[List[str]] = None  # S3 URLs from workflow screen
    model_image_url: Optional[str] = None  # S3 URL of uploaded model image
    user_prompt: Optional[str] = None
    
    # Context Management data (S3 URLs) - will be fetched from database
    # These are passed if frontend already has them, otherwise fetched
    product_photos: Optional[List[str]] = None
    inspiration_images: Optional[List[str]] = None
    past_content_images: Optional[List[str]] = None
    generic_visuals: Optional[List[str]] = None
    
    # Brand context (will be fetched from database if not provided)
    brand_name: Optional[str] = None
    brand_description: Optional[str] = None
    brand_colors: Optional[Dict] = None
    brand_voice: Optional[str] = None
    logo_url: Optional[str] = None
    
    # Generation parameters
    num_images: int = 1  # Number of images to generate (for image workflows)
    image_model: Optional[str] = None  # Uses account default if not provided
    video_model: Optional[str] = None  # For video workflows
    clip_duration: Optional[int] = 5
    
    # Target platform
    target_platform: Optional[str] = None
    
    # Flags
    no_characters: bool = False
    human_characters_only: bool = False
    web3_characters: bool = False
    use_brand_aesthetics: bool = True
    viral_trends: bool = False
    include_logo: bool = False


# ============================================
# PROGRESS TRACKING
# ============================================

class ProgressTracker:
    """Track progress of content generation"""
    def __init__(self):
        self.current_step = ""
        self.progress_percent = 0
        self.status = "idle"  # idle, running, complete, error
        self.error_message = None
        self.result_data = None
    
    def update(self, step: str, percent: int):
        self.current_step = step
        self.progress_percent = percent
        self.status = "running"
    
    def complete(self, result_data: Dict):
        self.status = "complete"
        self.progress_percent = 100
        self.current_step = "Content ready!"
        self.result_data = result_data
    
    def error(self, message: str):
        self.status = "error"
        self.error_message = message


# Store active generation jobs
active_jobs: Dict[str, ProgressTracker] = {}


# ============================================
# HELPER FUNCTIONS
# ============================================

async def generate_presigned_urls(s3_urls: List[str]) -> List[str]:
    """Generate fresh presigned URLs for S3 objects"""
    if not s3_urls:
        return []
    
    presigned_urls = []
    for s3_url in s3_urls:
        try:
            # Extract S3 key from URL
            s3_key = web2_s3_helper.extract_s3_key_from_url(s3_url)
            if s3_key:
                # Generate presigned URL
                presigned_url = web2_s3_helper.s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': web2_s3_helper.bucket_name, 'Key': s3_key},
                    ExpiresIn=3600  # 1 hour
                )
                presigned_urls.append(presigned_url)
        except Exception as e:
            logger.error(f"Error generating presigned URL for {s3_url}: {str(e)}")
    
    return presigned_urls


async def fetch_context_management_data(account_id: int):
    """Fetch context management data from database"""
    # This would typically use a database query
    # For now, we'll return empty dict - frontend should pass the data
    # TODO: Implement database fetch via TypeScript backend API
    return {}


async def fetch_account_brand_data(account_id: int):
    """Fetch account and brand context data"""
    # TODO: Implement database fetch via TypeScript backend API
    return {}


# ============================================
# MAIN GENERATION PIPELINE
# ============================================

async def run_generation_pipeline(job_id: str, request: UnifiedContentGenerationRequest):
    """
    Run the complete generation pipeline with progress updates
    """
    tracker = active_jobs[job_id]
    
    context = {}
    try:
        # Step 1: Gather context (10%)
        tracker.update("Gathering context...", 10)
        await update_progress_in_db(request.account_id, 10, "Gathering context...", "context_gathering")
        await asyncio.sleep(0.1)  # Allow event loop to process
        
        context = await gather_all_context(request)
        
        # LOG OVERALL CONTEXT GATHERING
        print("=" * 80)
        print("📋 OVERALL CONTEXT GATHERING")
        print("=" * 80)
        print(f"🏢 Account ID: {request.account_id}")
        print(f"🏢 Account Client ID: {request.account_client_id}")
        print(f"🏢 Industry: {request.industry}")
        print(f"🏢 Workflow Type: {request.workflow_type}")
        print(f"🏢 Content Type: {request.content_type}")
        print(f"🏢 Context Keys Available: {list(context.keys())}")
        print(f"🏢 Brand Context Available: {'brand_context' in context}")
        print(f"🏢 Context Management Available: {'context_management' in context}")
        print(f"🏢 Account Info Available: {'account' in context}")
        print("=" * 80)
        
        # Step 2: Visual pattern analysis (30%)
        tracker.update("Analyzing visual patterns...", 30)
        await update_progress_in_db(request.account_id, 30, "Analyzing visual patterns...", "visual_analysis")
        await asyncio.sleep(0.1)
        
        visual_analysis = await run_visual_analysis(request, context)
        if visual_analysis:
            context['visual_analysis'] = visual_analysis
            
            # LOG VISUAL ANALYSIS OUTPUT
            print("=" * 80)
            print("🔍 VISUAL ANALYSIS OUTPUT")
            print("=" * 80)
            print(f"📊 Analysis Result: {visual_analysis}")
            print(f"📊 Analysis Keys: {list(visual_analysis.keys()) if isinstance(visual_analysis, dict) else 'Not a dict'}")
            print("=" * 80)
        
        # Step 3: Generate prompts (50%)
        tracker.update("Generating optimized prompts...", 50)
        await update_progress_in_db(request.account_id, 50, "Generating optimized prompts...", "prompt_generation")
        yield f"data: {json.dumps({'type': 'progress', 'message': 'Generating optimized prompts...', 'percent': 50})}\n\n"
        await asyncio.sleep(0.1)
        
        prompts = await generate_prompts(request, context)
        
        # LOG GROK GENERATED PROMPTS OUTPUT
        print("=" * 80)
        print("🤖 GROK GENERATED PROMPTS OUTPUT")
        print("=" * 80)
        print(f"📝 Prompts Result: {prompts}")
        print(f"📝 Prompts Keys: {list(prompts.keys()) if isinstance(prompts, dict) else 'Not a dict'}")
        if isinstance(prompts, dict):
            for key, value in prompts.items():
                print(f"📝 {key}: {value}")
        print("=" * 80)
        
        # Step 4: Generate content (70-90%)
        if request.content_type == 'image':
            tracker.update(f"Generating image 1 of {request.num_images}...", 70)
            await update_progress_in_db(request.account_id, 70, f"Generating image 1 of {request.num_images}...", "image_generation")
            yield f"data: {json.dumps({'type': 'progress', 'message': f'Generating image 1 of {request.num_images}...', 'percent': 70})}\n\n"
            await asyncio.sleep(0.1)
            
            generated_content = None
            async for result in generate_images(request, prompts, context):
                if isinstance(result, dict) and 'content_type' in result:
                    generated_content = result
                    # Check for validation errors
                    if generated_content.get('error'):
                        print(f"❌ Image generation failed: {generated_content['error']}")
                        await update_progress_in_db(request.account_id, 100, f"Generation failed: {generated_content['error']}", "error")
                        # Update existing record with error instead of creating new one
                        await update_existing_record_with_error(request, generated_content['error'])
                        yield f"data: {json.dumps({'type': 'error', 'message': generated_content['error']})}\n\n"
                        return
                else:
                    # This is a progress event, yield it
                    yield result
        else:  # video
            tracker.update("Generating video clip...", 70)
            await asyncio.sleep(0.1)
            
            generated_content = await generate_video(request, prompts, context)
        
        # Step 5: Save to database (95%)
        tracker.update("Saving generated content...", 95)
        await update_progress_in_db(request.account_id, 95, "Saving generated content...", "saving_to_db")
        yield f"data: {json.dumps({'type': 'progress', 'message': 'Saving generated content...', 'percent': 95})}\n\n"
        await asyncio.sleep(0.1)
        
        await save_generated_content_to_db(request, context, prompts, generated_content, visual_analysis)
        
        # Step 6: Complete (100%)
        tracker.complete(generated_content)
        await update_progress_in_db(request.account_id, 100, "Generation complete!", "completed")
        yield f"data: {json.dumps({'type': 'complete', 'result': generated_content})}\n\n"
        
    except Exception as e:
        logger.error(f"Error in generation pipeline: {str(e)}")
        
        # Save error record to database
        try:
            await save_generated_content_to_db(
                request, 
                context, 
                {},  # Empty prompts on error
                {"error": str(e)},  # Error content
                {}   # Empty visual analysis on error
            )
        except Exception as save_error:
            logger.error(f"Failed to save error record to database: {str(save_error)}")
        
        tracker.error(str(e))


async def gather_all_context(request: UnifiedContentGenerationRequest) -> Dict:
    """Gather all context from various sources"""
    # Fetch account configurations from TypeScript backend
    account_config = await fetch_account_configuration(request.account_id)
    
    # Fetch context management data from TypeScript backend
    context_management = await fetch_context_management_data(request.account_id)
    
    # Fetch brand context data from TypeScript backend
    brand_context = await fetch_brand_context_data(request.account_id)
    
    context = {
        'account_id': request.account_id,
        'industry': request.industry,
        'workflow_type': request.workflow_type,
        'theme': request.theme,
        'user_prompt': request.user_prompt,
        'workflow_inputs': request.workflow_inputs or {},
        
        # Flags
        'no_characters': request.no_characters,
        'human_characters_only': request.human_characters_only,
        'web3_characters': request.web3_characters,
        'use_brand_aesthetics': request.use_brand_aesthetics,
        'viral_trends': request.viral_trends,
        'include_logo': request.include_logo,
        
        # Generation params - use account config if not provided in request
        'image_model': request.image_model or account_config.get('image_model', 'seedream'),
        'video_model': request.video_model or account_config.get('video_model', 'sora'),
        'clip_duration': request.clip_duration or account_config.get('clip_duration', 5),
        'aspect_ratio': '16:9',
        
        # Brand context - prioritize brand_context over request values, with context_management as fallback
        'brand_name': brand_context.get('brand_name') or context_management.get('brand_name') or request.brand_name or 'the brand',
        'brand_description': brand_context.get('brand_description') or context_management.get('brand_story') or request.brand_description,
        'brand_colors': brand_context.get('brand_colors') or context_management.get('brand_colors') or request.brand_colors,
        'brand_voice': brand_context.get('brand_voice') or context_management.get('brand_voice') or request.brand_voice,
        'logo_url': brand_context.get('logo_url') or context_management.get('brand_logo_url') or request.logo_url,
        
        # DEBUG: Log brand context details
        'brand_context_debug': {
            'fetched_brand_context': brand_context,
            'request_brand_name': request.brand_name,
            'request_logo_url': request.logo_url,
            'final_logo_url': brand_context.get('logo_url') or request.logo_url
        },
        'model_image_url': request.model_image_url,
        
        # Account configuration
        'account_config': account_config,
        
        # Context management data
        'context_management': context_management,
        'brand_context': brand_context,
        
        # Extract images from context management
        'product_photos': context_management.get('product_photos', []),
        'inspiration_images': context_management.get('inspiration_images', []),
        'past_content_images': context_management.get('past_content_images', []),
        'generic_visuals': context_management.get('generic_visuals', []),
        
        # Brand data already extracted above
    }
    
    return context


async def fetch_account_configuration(account_id: int) -> Dict:
    """Fetch account configuration from TypeScript backend"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/web2-account-configurations/{account_id}",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                # TypeScript backend returns the data directly, not wrapped in 'data' field
                return data if isinstance(data, dict) else {}
            else:
                print(f"⚠️  Failed to fetch account configuration: {response.status_code}")
                return {}
                
    except Exception as e:
        print(f"⚠️  Error fetching account configuration: {str(e)}")
        return {}


async def fetch_context_management_data(account_id: int) -> Dict:
    """Fetch context management data from TypeScript backend"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/web2-context/{account_id}",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('data', {})
            else:
                print(f"⚠️  Failed to fetch context management: {response.status_code}")
                return {}
                
    except Exception as e:
        print(f"⚠️  Error fetching context management: {str(e)}")
        return {}


async def fetch_brand_context_data(account_id: int) -> Dict:
    """Fetch brand context data from TypeScript backend"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/web2-account-context/account/{account_id}",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                # TypeScript backend returns the data wrapped in 'data' field for brand context
                brand_data = data.get('data', {})
                print(f"🔍 DEBUG: Brand context fetched: {brand_data}")
                print(f"🔍 DEBUG: Brand context keys: {list(brand_data.keys()) if brand_data else 'Empty'}")
                return brand_data
            elif response.status_code == 404:
                print(f"⚠️  Brand context not found for account {account_id}")
                return {}
            else:
                print(f"⚠️  Failed to fetch brand context: {response.status_code}")
                print(f"⚠️  Response text: {response.text}")
                return {}
                
    except Exception as e:
        print(f"⚠️  Error fetching brand context: {str(e)}")
        return {}


async def run_visual_analysis(request: UnifiedContentGenerationRequest, context: Dict) -> Dict:
    """Run visual pattern analysis if images are available"""
    # Collect all image URLs
    all_images = []
    
    if request.user_uploaded_images:
        all_images.extend(request.user_uploaded_images)
    
    # Get images from context management
    product_photos = context.get('product_photos', [])
    inspiration_images = context.get('inspiration_images', [])
    past_content_images = context.get('past_content_images', [])
    generic_visuals = context.get('generic_visuals', [])
    
    # Helper function to extract URL from image object (string or dict)
    def extract_image_url(image_obj):
        if isinstance(image_obj, str):
            return image_obj
        elif isinstance(image_obj, dict):
            # Try different URL fields that might be present
            return (image_obj.get('s3_url') or 
                   image_obj.get('presigned_url') or 
                   image_obj.get('url') or 
                   str(image_obj))
        else:
            return str(image_obj)
    
    if product_photos:
        all_images.extend([extract_image_url(img) for img in product_photos])
    
    if inspiration_images:
        all_images.extend([extract_image_url(img) for img in inspiration_images])
    
    if past_content_images:
        all_images.extend([extract_image_url(img) for img in past_content_images])
    
    if generic_visuals:
        all_images.extend([extract_image_url(img) for img in generic_visuals])
    
    # LOG VISUAL ANALYSIS CONTEXT
    print("=" * 80)
    # For Simple Workflow, ONLY use uploaded product images - NO visual analysis from context management
    if request.workflow_type == 'Simple Workflow':
        # Only use uploaded product images for Simple Workflow - NO context management images
        simple_workflow_images = request.user_uploaded_images or []
        print(f"🔍 Running inventory analysis for Simple Workflow with {len(simple_workflow_images)} products")
        print(f"🔍 Simple Workflow images (ONLY uploaded products): {simple_workflow_images}")
        print(f"🔍 Context management images EXCLUDED for Simple Workflow")
        print(f"🔍 Product photos from context: {len(product_photos)} - NOT USED")
        print(f"🔍 Inspiration images from context: {len(inspiration_images)} - NOT USED")
        print(f"🔍 Past content images from context: {len(past_content_images)} - NOT USED")
        print(f"🔍 Generic visuals from context: {len(generic_visuals)} - NOT USED")
        
        # Skip visual analysis from context management for Simple Workflow
        # Only run inventory analysis on uploaded product images
        visual_analysis = {}  # Start with empty visual analysis
        
        try:
            # Convert S3 URLs to presigned URLs for Grok
            print(f"🔍 Converting S3 URLs to presigned URLs for Grok...")
            presigned_product_images = await generate_presigned_urls(simple_workflow_images)
            print(f"🔍 Presigned URLs generated: {presigned_product_images}")
            
            if not presigned_product_images:
                print(f"❌ Failed to generate presigned URLs for product images")
                visual_analysis['inventory_analysis'] = {}
            else:
                inventory_analysis = grok_service.analyze_inventory(
                    product_images=presigned_product_images,
                    industry=request.industry
                )
                visual_analysis['inventory_analysis'] = inventory_analysis
                print(f"✅ Inventory analysis completed: {inventory_analysis}")
        except Exception as e:
            print(f"❌ Inventory analysis failed: {e}")
            import traceback
            print(f"❌ Full traceback: {traceback.format_exc()}")
            # Continue without inventory analysis
            visual_analysis['inventory_analysis'] = {}
        
        return visual_analysis
    
    # For other workflows, run visual analysis on context management images
    print("🔍 VISUAL PATTERN ANALYSIS CONTEXT")
    print("=" * 80)
    print(f"📊 Industry: {request.industry}")
    print(f"📊 Workflow Type: {request.workflow_type}")
    print(f"📊 Content Type: {request.content_type}")
    print(f"📊 Number of Images: {len(all_images)}")
    print(f"📊 User Uploaded Images: {len(request.user_uploaded_images) if request.user_uploaded_images else 0}")
    print(f"📊 Product Photos: {len(product_photos)}")
    print(f"📊 Inspiration Images: {len(inspiration_images)}")
    print(f"📊 Past Content Images: {len(past_content_images)}")
    print(f"📊 Generic Visuals: {len(generic_visuals)}")
    print(f"📊 All Image URLs: {all_images}")
    print(f"📊 Context Keys: {list(context.keys())}")
    print(f"📊 Brand Context: {context.get('brand_context', {})}")
    print(f"📊 Context Management: {context.get('context_management', {})}")
    print("=" * 80)
    
    # Generate fresh presigned URLs
    presigned_urls = await generate_presigned_urls(all_images)
    
    if not presigned_urls:
        logger.warning("Failed to generate presigned URLs for visual analysis")
        return {}
    
    # Run visual analysis
    visual_analysis = visual_analysis_service.analyze_visual_patterns(
        image_urls=presigned_urls,
        industry=request.industry,
        workflow_type=request.workflow_type
    )
    
    return visual_analysis


async def save_progressive_image_to_db(request: UnifiedContentGenerationRequest, image_url: str, platform_texts: Dict, image_index: int):
    """Save individual generated image to database progressively"""
    try:
        import httpx
        
        # Get existing record
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        async with httpx.AsyncClient() as client:
            find_response = await client.get(
                f"{typescript_backend_url}/api/web2-generated-content/job/{request.job_id}",
                timeout=10.0
            )
            
            if find_response.status_code == 200:
                existing_data = find_response.json()
                content_id = existing_data['data']['id']
                existing_urls = existing_data['data'].get('generated_image_urls', [])
                
                # Add new image URL to existing array
                if isinstance(existing_urls, str):
                    existing_urls = [existing_urls] if existing_urls else []
                elif not isinstance(existing_urls, list):
                    existing_urls = []
                
                existing_urls.append(image_url)
                
                # Update with new image URL and platform texts
                update_data = {
                    "generated_image_urls": existing_urls,
                    "twitter_text": platform_texts.get('twitter', ''),
                    "youtube_description": platform_texts.get('youtube', ''),
                    "instagram_caption": platform_texts.get('instagram', ''),
                    "linkedin_post": platform_texts.get('linkedin', ''),
                    "progress_percent": min(90, 10 + (image_index * 20)),  # Progressive progress
                    "progress_message": f"Generated {image_index} of {request.num_images} images"
                }
                
                # Update the record
                update_response = await client.put(
                    f"{typescript_backend_url}/api/web2-generated-content/{content_id}",
                    json=update_data,
                    timeout=10.0
                )
                
                if update_response.status_code in [200, 201]:
                    print(f"✅ Progressive save successful for image {image_index}: {image_url}")
                else:
                    print(f"❌ Failed to update progressive image: {update_response.status_code}")
            else:
                print(f"❌ Could not find existing record for job_id: {request.job_id}")
                
    except Exception as e:
        print(f"❌ Error in progressive save: {str(e)}")


async def save_generated_content_to_db(request: UnifiedContentGenerationRequest, context: Dict, prompts: Dict, generated_content: Dict, visual_analysis: Dict):
    """Save generated content to database via TypeScript backend API"""
    try:
        import httpx
        
        # Prepare user images array (product images + model image if provided)
        user_images = []
        if request.user_uploaded_images:
            user_images.extend(request.user_uploaded_images)
        if request.model_image_url:
            user_images.append(request.model_image_url)
        
        # Determine status based on content
        is_error = "error" in generated_content
        status = "error" if is_error else "completed"
        
        # Prepare data for database storage
        db_data = {
            "account_id": request.account_id,
            "account_client_id": request.account_client_id,
            "content_type": request.content_type,
            "image_model": request.image_model,
            "video_model": request.video_model,
            "clip_duration": request.clip_duration,
            "user_prompt": request.user_prompt,
            "user_images": user_images,  # Store all user images (product + model)
            "theme": request.theme,
            "workflow_type": request.workflow_type,
            "target_platform": request.target_platform,
            "include_logo": request.include_logo,
            "no_characters": request.no_characters,
            "human_characters_only": request.human_characters_only,
            "web3_characters": request.web3_characters,
            "use_brand_aesthetics": request.use_brand_aesthetics,
            "viral_trends": request.viral_trends,
            "status": status,
            "num_variations": request.num_images,  # Store directly as num_variations
            "workflow_metadata": {
                "industry": request.industry,
                "custom_options": context.get('custom_options', {}),
                "form_data": context.get('form_data', {})
            },
            "visual_analysis": visual_analysis,
            "brand_context": context.get('brand_context', {}),
            "industry": request.industry
        }
        
        # DEBUG: Log the num_variations value
        print(f"🔍 DEBUG: request.num_images = {request.num_images}")
        print(f"🔍 DEBUG: num_variations = {db_data['num_variations']}")
        print(f"🔍 DEBUG: Full db_data keys = {list(db_data.keys())}")
        
        # Add generated content URLs
        if request.content_type == 'image':
            # Extract image URLs from generated_content
            generated_images = generated_content.get('generated_content', [])
            image_urls = [img.get('image_url', '') for img in generated_images if img.get('image_url')]
            
            # Extract individual prompts for each image
            individual_prompts = [img.get('prompt', '') for img in generated_images if img.get('prompt')]
            
            # Extract platform texts from the first image (they should be the same for all)
            platform_texts = generated_images[0].get('platform_texts', {}) if generated_images else {}
            
            # Extract product categories from inventory analysis
            product_categories = []
            if visual_analysis.get('inventory_analysis'):
                inventory_data = visual_analysis['inventory_analysis']
                # For Simple Workflow, we have multiple products, so we need to map each image to a product
                if request.workflow_type == 'Simple Workflow' and request.user_uploaded_images:
                    for i in range(len(image_urls)):
                        # Each product gets 4 variations, so map image index to product index
                        product_index = (i // 4) % len(request.user_uploaded_images)
                        product_key = f"image_{product_index + 1}"
                        if product_key in inventory_data:
                            product_categories.append(inventory_data[product_key].get('category', 'Unknown'))
                        else:
                            product_categories.append('Unknown')
                else:
                    # For other workflows, use the first available category
                    first_category = None
                    for key, data in inventory_data.items():
                        if isinstance(data, dict) and 'category' in data:
                            first_category = data['category']
                            break
                    product_categories = [first_category or 'Unknown'] * len(image_urls)
            else:
                product_categories = ['Unknown'] * len(image_urls)
            
            print(f"🔍 DEBUG: Saving to database - generated_images: {generated_images}")
            print(f"🔍 DEBUG: Saving to database - image_urls: {image_urls}")
            print(f"🔍 DEBUG: Saving to database - individual_prompts: {individual_prompts}")
            print(f"🔍 DEBUG: Saving to database - product_categories: {product_categories}")
            print(f"🔍 DEBUG: Saving to database - platform_texts: {platform_texts}")
            
            db_data.update({
                "image_prompt": prompts.get('image_prompt', ''),
                "generated_image_urls": image_urls,
                "generated_prompts": individual_prompts,  # Store individual prompts for each image
                "product_categories": product_categories,  # Store product categories for each image
                "twitter_text": platform_texts.get('twitter', ''),
                "youtube_description": platform_texts.get('youtube', ''),
                "instagram_caption": platform_texts.get('instagram', ''),
                "linkedin_post": platform_texts.get('linkedin', '')
            })
            
            # DEBUG: Log the generated image URLs
            print(f"🔍 DEBUG: generated_images = {generated_images}")
            print(f"🔍 DEBUG: image_urls = {image_urls}")
            print(f"🔍 DEBUG: platform_texts = {platform_texts}")
        else:  # video
            db_data.update({
                "clip_prompt": prompts.get('clip_prompt', ''),
                "generated_video_url": generated_content.get('video_url', ''),
                "twitter_text": generated_content.get('platform_texts', {}).get('twitter', ''),
                "youtube_description": generated_content.get('platform_texts', {}).get('youtube', ''),
                "instagram_caption": generated_content.get('platform_texts', {}).get('instagram', ''),
                "linkedin_post": generated_content.get('platform_texts', {}).get('linkedin', '')
            })
        
        # Update existing record by job_id instead of creating new one
        async with httpx.AsyncClient() as client:
            # First, find the existing record by job_id
            find_response = await client.get(
                f"{os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')}/api/web2-generated-content/job/{request.job_id}",
                timeout=10.0
            )
            
            if find_response.status_code == 200:
                # Update existing record
                existing_data = find_response.json()
                content_id = existing_data['data']['id']
                
                response = await client.put(
                    f"{os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')}/api/web2-generated-content/{content_id}",
                    json=db_data,
                    timeout=30.0
                )
            else:
                # Fallback: create new record if job_id not found
                response = await client.post(
                    f"{os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')}/api/web2-generated-content",
                    json=db_data,
                    timeout=30.0
                )
            
            if response.status_code in [200, 201]:
                print(f"✅ Generated content saved to database successfully")
                print(f"🔍 Response status: {response.status_code}")
            else:
                print(f"❌ Failed to save generated content: {response.status_code} - {response.text}")
                logger.error(f"Failed to save generated content: {response.status_code} - {response.text}")
                
    except Exception as e:
        logger.error(f"Error saving generated content to database: {str(e)}")
        # Don't raise exception - content generation should still complete


async def generate_prompts(request: UnifiedContentGenerationRequest, context: Dict) -> Dict:
    """Generate prompts using Grok"""
    prompt_types = []
    num_prompts = {}
    
    if request.content_type == 'image':
        prompt_types.append('image')
        num_prompts['image'] = request.num_images
    else:
        prompt_types.append('clip')
        num_prompts['clip'] = 1
    
    # LOG GROK PROMPT GENERATION CONTEXT
    print("=" * 80)
    print("🤖 GROK PROMPT GENERATION CONTEXT")
    print("=" * 80)
    print(f"📝 Industry: {request.industry}")
    print(f"📝 Workflow Type: {request.workflow_type}")
    print(f"📝 Content Type: {request.content_type}")
    print(f"📝 Theme: {request.theme}")
    print(f"📝 User Prompt: {request.user_prompt}")
    print(f"📝 Number of Images: {request.num_images}")
    print(f"📝 Prompt Types: {prompt_types}")
    print(f"📝 Number of Prompts: {num_prompts}")
    print(f"📝 Include Logo: {request.include_logo}")
    print(f"📝 Model Image URL: {request.model_image_url}")
    print(f"📝 Model Image Override: {bool(request.model_image_url)}")
    print(f"📝 No Characters: {request.no_characters}")
    print(f"📝 Human Characters Only: {request.human_characters_only}")
    print(f"📝 Web3 Characters: {request.web3_characters}")
    print(f"📝 Use Brand Aesthetics: {request.use_brand_aesthetics}")
    print(f"📝 Viral Trends: {request.viral_trends}")
    print(f"📝 Target Platform: {request.target_platform}")
    print(f"📝 Context Keys: {list(context.keys())}")
    print(f"📝 Brand Context: {context.get('brand_context', {})}")
    print(f"📝 Context Management: {context.get('context_management', {})}")
    print(f"📝 Visual Analysis: {context.get('visual_analysis', {})}")
    print(f"📝 Account Info: {context.get('account', {})}")
    print(f"📝 Workflow Metadata: {context.get('workflow_metadata', {})}")
    print("=" * 80)
    
    prompts = grok_service.generate_prompts(
        context=context,
        prompt_types=prompt_types,
        num_prompts=num_prompts,
        use_live_search=context.get('viral_trends', False)
    )
    
    return prompts


def map_model_name_to_fal_id(model_name: str) -> str:
    """Map account configuration model names to Fal.ai model IDs"""
    model_mapping = {
        'seedream': 'fal-ai/bytedance/seedream/v4/edit',
        'nano-banana': 'fal-ai/nano-banana/edit',
        'flux-pro-kontext': 'fal-ai/flux-pro/kontext'
    }
    return model_mapping.get(model_name, 'fal-ai/bytedance/seedream/v4/edit')


async def create_initial_generation_record(request: UnifiedContentGenerationRequest, job_id: str):
    """Create initial database record for generation tracking"""
    try:
        import httpx
        
        # Prepare user images array (product images + model image if provided)
        user_images = []
        if request.user_uploaded_images:
            user_images.extend(request.user_uploaded_images)
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
            "user_prompt": request.user_prompt,
            "user_images": user_images,
            "theme": request.theme,
            "workflow_type": request.workflow_type,
            "target_platform": request.target_platform,
            "include_logo": request.include_logo,
            "no_characters": request.no_characters,
            "human_characters_only": request.human_characters_only,
            "web3_characters": request.web3_characters,
            "use_brand_aesthetics": request.use_brand_aesthetics,
            "viral_trends": request.viral_trends,
            "status": "generating",
            "num_variations": request.num_images,
            "workflow_metadata": {
                "industry": request.industry,
                "custom_options": {},
                "form_data": {}
            },
            "visual_analysis": {},
            "brand_context": {},
            "industry": request.industry,
            "job_id": job_id,
            "progress_percent": 10,
            "progress_message": "Starting generation...",
            "current_step": "initializing"
        }
        
        # Save to database via TypeScript backend
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/web2-generated-content",
                json=db_data,
                timeout=30.0
            )
            
            if response.status_code == 201:
                print(f"✅ Initial generation record created successfully")
                print(f"🔍 Database record created with progress: {db_data['progress_percent']}% - {db_data['progress_message']}")
                return True
            else:
                print(f"❌ Failed to create initial record: {response.status_code} - {response.text}")
                return False
                
    except Exception as e:
        print(f"❌ Error creating initial generation record: {str(e)}")
        return False


async def update_existing_record_with_error(request: UnifiedContentGenerationRequest, error_message: str):
    """Update existing generation record with error instead of creating new one"""
    try:
        import httpx
        
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        # Find the latest generation record for this account
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/web2-generated-content/{request.account_id}?limit=1",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('data') and len(data['data']) > 0:
                    content_id = data['data'][0]['id']
                    
                    # Update the existing record with error
                    update_response = await client.put(
                        f"{typescript_backend_url}/api/web2-generated-content/{content_id}",
                        json={
                            'status': 'error',
                            'error_message': error_message,
                            'progress_percent': 100,
                            'progress_message': f"Generation failed: {error_message}",
                            'current_step': 'error'
                        },
                        timeout=10.0
                    )
                    
                    if update_response.status_code == 200:
                        print(f"✅ Updated existing record with error: {error_message}")
                    else:
                        print(f"⚠️  Failed to update existing record: {update_response.status_code}")
                        
    except Exception as e:
        print(f"⚠️  Error updating existing record: {str(e)}")


async def update_progress_in_db(account_id: int, progress_percent: int, progress_message: str, current_step: str):
    """Update progress in database via TypeScript backend"""
    try:
        import httpx
        
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        # Find the latest generation record for this account
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/web2-generated-content/{account_id}?limit=1",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('data') and len(data['data']) > 0:
                    content_id = data['data'][0]['id']
                    
                    # Update progress
                    update_response = await client.put(
                        f"{typescript_backend_url}/api/web2-generated-content/{content_id}/progress",
                        json={
                            'progress_percent': progress_percent,
                            'progress_message': progress_message,
                            'current_step': current_step
                        },
                        timeout=10.0
                    )
                    
                    if update_response.status_code == 200:
                        print(f"✅ Progress updated: {progress_percent}% - {progress_message}")
                    else:
                        print(f"⚠️  Failed to update progress: {update_response.status_code} - {update_response.text}")
                        
    except Exception as e:
        print(f"⚠️  Error updating progress: {str(e)}")


async def validate_image_aspect_ratio(image_url: str) -> tuple[bool, str]:
    """Validate image aspect ratio for Fal.ai compatibility"""
    try:
        import httpx
        from PIL import Image
        import io
        
        # Skip validation for S3 URLs (they need to be converted to presigned URLs first)
        if image_url.startswith('s3://'):
            print(f"⚠️  Skipping aspect ratio validation for S3 URL: {image_url}")
            return True, "S3 URL - validation skipped"
        
        # Download image to check dimensions
        async with httpx.AsyncClient() as client:
            response = await client.get(image_url, timeout=10.0)
            response.raise_for_status()
            image_data = response.content
        
        # Open image with PIL
        image = Image.open(io.BytesIO(image_data))
        width, height = image.size
        
        # Calculate aspect ratio
        aspect_ratio = width / height
        
        # Check if aspect ratio is within Fal.ai limits (0.333 to 3)
        if 0.333 <= aspect_ratio <= 3:
            return True, f"Valid aspect ratio: {aspect_ratio:.3f}"
        else:
            return False, f"Invalid aspect ratio: {aspect_ratio:.3f} (must be between 0.333 and 3) - will be excluded"
            
    except Exception as e:
        print(f"⚠️  Aspect ratio validation failed for {image_url}: {str(e)}")
        return True, f"Validation skipped due to error: {str(e)}"


async def download_and_save_to_s3(image_url: str, account_id: int, filename: str, max_retries: int = 2) -> str:
    """Download image from Fal.ai and save to S3 with retry mechanism"""
    import httpx
    import uuid
    import asyncio
    from datetime import datetime
    
    for attempt in range(max_retries + 1):  # Initial attempt + max_retries
        try:
            print(f"🔄 Downloading image (attempt {attempt + 1}/{max_retries + 1}): {image_url}")
            
            # Download image from Fal.ai
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                image_data = response.content
            
            print(f"✅ Image downloaded successfully (attempt {attempt + 1})")
            
            # Generate S3 key
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            unique_id = str(uuid.uuid4())[:8]
            s3_key = f"web2/accounts/{account_id}/generated/{timestamp}_{unique_id}_{filename}.png"
            
            # Upload to S3
            from app.utils.web2_s3_helper import Web2S3Helper
            s3_helper = Web2S3Helper()
            
            s3_helper.s3_client.put_object(
                Bucket=s3_helper.bucket_name,
                Key=s3_key,
                Body=image_data,
                ContentType='image/png'
            )
            
            # Return S3 URL
            s3_url = f"s3://{s3_helper.bucket_name}/{s3_key}"
            print(f"✅ Image saved to S3: {s3_url}")
            return s3_url
            
        except httpx.HTTPStatusError as e:
            print(f"❌ HTTP error downloading image (attempt {attempt + 1}): {e.response.status_code} - {e.response.text}")
            if attempt < max_retries:
                print(f"⏳ Retrying in 2 seconds...")
                await asyncio.sleep(2)
            else:
                print(f"❌ Failed to download image after {max_retries + 1} attempts")
                return f"s3://placeholder/{filename}.png"
                
        except httpx.RequestError as e:
            print(f"❌ Request error downloading image (attempt {attempt + 1}): {e}")
            if attempt < max_retries:
                print(f"⏳ Retrying in 2 seconds...")
                await asyncio.sleep(2)
            else:
                print(f"❌ Failed to download image after {max_retries + 1} attempts")
                return f"s3://placeholder/{filename}.png"
                
        except Exception as e:
            print(f"❌ Unexpected error downloading image (attempt {attempt + 1}): {str(e)}")
            if attempt < max_retries:
                print(f"⏳ Retrying in 2 seconds...")
                await asyncio.sleep(2)
            else:
                print(f"❌ Failed to download image after {max_retries + 1} attempts")
                return f"s3://placeholder/{filename}.png"


async def generate_images(request: UnifiedContentGenerationRequest, prompts: Dict, context: Dict):
    """Generate images using Fal.ai with logo integration"""
    generated_images = []
    image_model = context.get('image_model', 'seedream')
    logo_url = context.get('logo_url')
    
    print("=" * 80)
    print("🎨 IMAGE GENERATION WITH FAL.AI")
    print("=" * 80)
    print(f"🖼️  Image Model: {image_model}")
    print(f"🖼️  Account Config: {context.get('account_config', {})}")
    print(f"🖼️  Brand Context: {context.get('brand_context', {})}")
    print(f"🖼️  Number of Images: {request.num_images}")
    print(f"🖼️  Logo URL: {logo_url}")
    print(f"🖼️  Include Logo: {request.include_logo}")
    print(f"🖼️  Context Logo URL: {context.get('logo_url')}")
    print("=" * 80)
    
    for i in range(1, request.num_images + 1):
        image_prompt_key = f'image_prompt_{i}'
        platform_texts_key = f'image_{i}_platform_texts'
        
        if image_prompt_key not in prompts:
            continue
        
        image_prompt = prompts[image_prompt_key]
        platform_texts = prompts.get(platform_texts_key, {})
        
        # For Simple Workflow, determine which product image to use
        reference_image_url = None
        if request.workflow_type == 'Simple Workflow':
            # For Simple Workflow, cycle through product images for each variation
            if request.user_uploaded_images:
                product_index = ((i - 1) // 4) % len(request.user_uploaded_images)  # 4 variations per product
                reference_image_url = request.user_uploaded_images[product_index]
                print(f"🖼️  Simple Workflow - Using product image {product_index + 1} for variation {i}")
        else:
            # For other workflows, use the specific image for this variation
            if request.user_uploaded_images and len(request.user_uploaded_images) >= i:
                reference_image_url = request.user_uploaded_images[i - 1]
        
        # Prepare image URLs for Fal.ai
        image_urls = []
        if reference_image_url:
            image_urls.append(reference_image_url)
        if logo_url and request.include_logo:
            image_urls.append(logo_url)
        
        # Add model image URL if provided (overrides all model preferences)
        if request.model_image_url:
            image_urls.append(request.model_image_url)
            print(f"🖼️  Using specific model image: {request.model_image_url}")
        
        # Ensure we have at least one image for Simple Workflow
        if request.workflow_type == 'Simple Workflow' and not image_urls:
            print(f"❌ No images available for Simple Workflow generation")
            continue
        
        # Generate presigned URLs for Fal.ai first
        print(f"🖼️  Converting S3 URLs to presigned URLs for Fal.ai...")
        presigned_image_urls = await generate_presigned_urls(image_urls)
        print(f"🖼️  Generated {len(presigned_image_urls)} presigned URLs")
        
        # Validate aspect ratios of presigned URLs and filter out invalid ones
        print(f"🖼️  Validating aspect ratios of {len(presigned_image_urls)} presigned images...")
        valid_presigned_urls = []
        validation_warnings = []
        
        for j, url in enumerate(presigned_image_urls):
            is_valid, message = await validate_image_aspect_ratio(url)
            if is_valid:
                valid_presigned_urls.append(url)
                print(f"✅ {message}")
            else:
                validation_warnings.append(f"Image {j+1}: {message}")
                print(f"⚠️  Excluding invalid image: {message}")
        
        # Log warnings about excluded images
        if validation_warnings:
            print(f"⚠️  Excluded {len(validation_warnings)} invalid images:")
            for warning in validation_warnings:
                print(f"   - {warning}")
        
        # Check if we have any valid images left
        if not valid_presigned_urls:
            error_message = "No valid images available for generation. All images failed aspect ratio validation."
            print(f"❌ {error_message}")
            yield {
                "content_type": "image",
                "error": error_message,
                "generated_content": []
            }
            return
        
        # Use only valid images for generation
        presigned_image_urls = valid_presigned_urls
        print(f"🖼️  Using {len(presigned_image_urls)} valid images for generation")
        
        print(f"🖼️  Generating image {i}/{request.num_images}")
        print(f"🖼️  Prompt: {image_prompt}")
        print(f"🖼️  Original S3 URLs: {image_urls}")
        print(f"🖼️  Presigned URLs for Fal.ai: {presigned_image_urls}")
        
        try:
            # Map model name to Fal.ai model ID
            fal_model_id = map_model_name_to_fal_id(image_model)
            print(f"🖼️  Using Fal.ai Model ID: {fal_model_id}")
            
            # Call Fal.ai based on model (using presigned URLs)
            if image_model == 'nano-banana':
                result = await generate_with_nano_banana(image_prompt, presigned_image_urls)
            elif image_model == 'flux-pro-kontext':
                result = await generate_with_flux_pro_kontext(image_prompt, presigned_image_urls)
            elif image_model == 'seedream':
                result = await generate_with_seedream(image_prompt, presigned_image_urls)
            else:
                # Default to seedream
                result = await generate_with_seedream(image_prompt, presigned_image_urls)
            
            # Download and save generated image to S3
            fal_image_url = result.get('image_url', '')
            if fal_image_url:
                print(f"📥 Downloading generated image from Fal.ai: {fal_image_url}")
                s3_url = await download_and_save_to_s3(fal_image_url, request.account_id, f"generated_image_{i}")
                print(f"💾 Saved to S3: {s3_url}")
            else:
                s3_url = f's3://placeholder/image_{i}.jpg'
            
            generated_images.append({
                'prompt': image_prompt,
                'image_url': s3_url,
                'platform_texts': platform_texts
            })
            
            print(f"✅ Image {i} generated successfully: {s3_url}")
            
            # Save this image immediately to database
            await save_progressive_image_to_db(request, s3_url, platform_texts, i)
            
            # Send individual image generation event with platform texts
            yield f"data: {json.dumps({'type': 'image_generated', 'image_url': s3_url, 'image_index': i, 'platform_texts': platform_texts})}\n\n"
            
        except Exception as e:
            print(f"❌ Error generating image {i}: {str(e)}")
            # Fallback to placeholder
            generated_images.append({
                'prompt': image_prompt,
                'image_url': f's3://placeholder/image_{i}.jpg',
                'platform_texts': platform_texts
            })
    
    yield {
        'content_type': 'image',
        'generated_content': generated_images
    }


async def generate_with_nano_banana(prompt: str, image_urls: List[str]) -> Dict:
    """Generate image using Nano Banana Edit model"""
    arguments = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd"
    }
    
    if image_urls:
        arguments["image_urls"] = image_urls  # Nano Banana supports multiple reference images
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"📋 Nano Banana log: {log['message']}")
    
    result = fal_client.subscribe(
        "fal-ai/nano-banana/edit",
        arguments=arguments,
        with_logs=True,
        on_queue_update=on_queue_update,
    )
    
    return {
        'image_url': result.get('images', [{}])[0].get('url', ''),
        'model': 'nano-banana'
    }


async def generate_with_flux_pro_kontext(prompt: str, image_urls: List[str]) -> Dict:
    """Generate image using Flux Pro Kontext model"""
    arguments = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd"
    }
    
    if image_urls:
        arguments["image_urls"] = image_urls  # Flux Pro Kontext supports multiple reference images
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"📋 Flux Pro Kontext log: {log['message']}")
    
    result = fal_client.subscribe(
        "fal-ai/flux-pro/kontext",
        arguments=arguments,
        with_logs=True,
        on_queue_update=on_queue_update,
    )
    
    return {
        'image_url': result.get('images', [{}])[0].get('url', ''),
        'model': 'flux-pro-kontext'
    }


async def generate_with_seedream(prompt: str, image_urls: List[str]) -> Dict:
    """Generate image using Seedream Edit model"""
    arguments = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd"
    }
    
    if image_urls:
        arguments["image_urls"] = image_urls  # Seedream supports multiple reference images
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                print(f"📋 Seedream log: {log['message']}")
    
    result = fal_client.subscribe(
        "fal-ai/bytedance/seedream/v4/edit",
        arguments=arguments,
        with_logs=True,
        on_queue_update=on_queue_update,
    )
    
    return {
        'image_url': result.get('images', [{}])[0].get('url', ''),
        'model': 'seedream'
    }


async def generate_video(request: UnifiedContentGenerationRequest, prompts: Dict, context: Dict) -> Dict:
    """Generate video using Fal.ai"""
    clip_prompt = prompts.get('clip_prompt_1', '')
    platform_texts = prompts.get('clip_1_platform_texts', {})
    
    # TODO: Implement actual Fal.ai video generation
    # For now, return placeholder
    
    return {
        'content_type': 'video',
        'generated_content': [{
            'prompt': clip_prompt,
            'video_url': 's3://placeholder/video_1.mp4',
            'platform_texts': platform_texts
        }]
    }


# ============================================
# API ENDPOINTS
# ============================================

@router.post("/api/web2/unified-generation")
async def start_unified_generation(request: UnifiedContentGenerationRequest):
    """
    Start unified content generation pipeline
    Creates database entry immediately and returns job ID for tracking progress
    """
    # Create job ID
    job_id = str(uuid.uuid4())
    
    # Set job_id in request object
    request.job_id = job_id
    
    # Create progress tracker
    tracker = ProgressTracker()
    active_jobs[job_id] = tracker
    
    # Create database entry immediately with initial status
    try:
        await create_initial_generation_record(request, job_id)
        print(f"✅ Created initial database record for job {job_id}")
    except Exception as e:
        print(f"❌ Failed to create initial database record: {e}")
        return {
            'success': False,
            'error': 'Failed to create generation record'
        }
    
    # Start generation pipeline in background
    async def run_pipeline():
        try:
            async for event in run_generation_pipeline(job_id, request):
                # Store the event in the tracker for SSE streaming
                if isinstance(event, str) and event.startswith('data: '):
                    # Parse the SSE event and store in tracker
                    try:
                        import json
                        event_data = json.loads(event[6:])  # Remove 'data: ' prefix
                        if event_data.get('type') == 'progress':
                            tracker.update(event_data.get('message', ''), event_data.get('percent', 0))
                        elif event_data.get('type') == 'image_generated':
                            tracker.update(f"Generated image {event_data.get('image_index', 1)}", 80)
                        elif event_data.get('type') == 'complete':
                            tracker.complete(event_data.get('result', {}))
                    except Exception as e:
                        print(f"Error processing SSE event: {e}")
        except Exception as e:
            print(f"Error in generation pipeline: {e}")
            tracker.error(str(e))
    
    asyncio.create_task(run_pipeline())
    
    return {
        'success': True,
        'job_id': job_id,
        'message': 'Generation started. Database record created for progress tracking.'
    }


@router.get("/api/web2/unified-generation/progress/{job_id}")
async def stream_progress(job_id: str):
    """
    Stream progress updates via Server-Sent Events (SSE)
    """
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    tracker = active_jobs[job_id]
    
    async def generate_events():
        """Generate SSE events"""
        while True:
            # Send current progress
            event_data = {
                'status': tracker.status,
                'current_step': tracker.current_step,
                'progress_percent': tracker.progress_percent,
            }
            
            if tracker.status == 'error':
                event_data['error'] = tracker.error_message
            
            if tracker.status == 'complete':
                event_data['result'] = tracker.result_data
            
            yield f"data: {json.dumps(event_data)}\n\n"
            
            # If complete or error, stop streaming
            if tracker.status in ['complete', 'error']:
                # Clean up job after a delay
                await asyncio.sleep(5)
                if job_id in active_jobs:
                    del active_jobs[job_id]
                break
            
            # Wait before next update
            await asyncio.sleep(1)
    
    return StreamingResponse(generate_events(), media_type="text/event-stream")

