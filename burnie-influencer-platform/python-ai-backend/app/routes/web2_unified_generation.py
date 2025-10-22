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
    
    # Content type
    content_type: str  # 'image' or 'video'
    
    # Workflow context
    industry: str  # 'Fashion', 'Social Media Management', 'Design Agency', etc.
    workflow_type: str  # 'Model Diversity Showcase', 'Viral Trend Content', etc.
    theme: Optional[str] = None
    
    # User inputs from workflow screen
    workflow_inputs: Optional[Dict[str, Any]] = None  # All form inputs from workflow
    user_uploaded_images: Optional[List[str]] = None  # S3 URLs from workflow screen
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
    
    # Generation parameters
    num_images: int = 1  # Number of images to generate (for image workflows)
    image_model: Optional[str] = None  # Uses account default if not provided
    video_model: Optional[str] = None  # For video workflows
    clip_duration: Optional[int] = 5
    
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
            s3_key = web2_s3_helper.extractS3Key(s3_url)
            if s3_key:
                # Generate presigned URL
                presigned_url = web2_s3_helper.s3.generate_presigned_url(
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
    
    try:
        # Step 1: Gather context (10%)
        tracker.update("Gathering context...", 10)
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
        await asyncio.sleep(0.1)
        
        visual_analysis = await run_visual_analysis(request, context)
        if visual_analysis:
            context['visual_analysis'] = visual_analysis
        
        # Step 3: Generate prompts (50%)
        tracker.update("Generating optimized prompts...", 50)
        await asyncio.sleep(0.1)
        
        prompts = await generate_prompts(request, context)
        
        # Step 4: Generate content (70-90%)
        if request.content_type == 'image':
            tracker.update(f"Generating image 1 of {request.num_images}...", 70)
            await asyncio.sleep(0.1)
            
            generated_content = await generate_images(request, prompts, context)
        else:  # video
            tracker.update("Generating video clip...", 70)
            await asyncio.sleep(0.1)
            
            generated_content = await generate_video(request, prompts, context)
        
        # Step 5: Save to database (95%)
        tracker.update("Saving generated content...", 95)
        await asyncio.sleep(0.1)
        
        await save_generated_content_to_db(request, context, prompts, generated_content, visual_analysis)
        
        # Step 6: Complete (100%)
        tracker.complete(generated_content)
        
    except Exception as e:
        logger.error(f"Error in generation pipeline: {str(e)}")
        tracker.error(str(e))


async def gather_all_context(request: UnifiedContentGenerationRequest) -> Dict:
    """Gather all context from various sources"""
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
        
        # Generation params
        'image_model': request.image_model or 'flux-pro-kontext',
        'video_model': request.video_model or 'sora',
        'clip_duration': request.clip_duration,
        'aspect_ratio': '16:9',
        
        # Brand context
        'brand_name': request.brand_name or 'the brand',
        'brand_description': request.brand_description,
        'brand_colors': request.brand_colors,
        'brand_voice': request.brand_voice,
    }
    
    return context


async def run_visual_analysis(request: UnifiedContentGenerationRequest, context: Dict) -> Dict:
    """Run visual pattern analysis if images are available"""
    # Collect all image URLs
    all_images = []
    
    if request.user_uploaded_images:
        all_images.extend(request.user_uploaded_images)
    
    if request.product_photos:
        all_images.extend(request.product_photos)
    
    if request.inspiration_images:
        all_images.extend(request.inspiration_images)
    
    if request.past_content_images:
        all_images.extend(request.past_content_images)
    
    if request.generic_visuals:
        all_images.extend(request.generic_visuals)
    
    # LOG VISUAL ANALYSIS CONTEXT
    print("=" * 80)
    print("🔍 VISUAL PATTERN ANALYSIS CONTEXT")
    print("=" * 80)
    print(f"📊 Industry: {request.industry}")
    print(f"📊 Workflow Type: {request.workflow_type}")
    print(f"📊 Content Type: {request.content_type}")
    print(f"📊 Number of Images: {len(all_images)}")
    print(f"📊 User Uploaded Images: {len(request.user_uploaded_images) if request.user_uploaded_images else 0}")
    print(f"📊 Product Photos: {len(request.product_photos) if request.product_photos else 0}")
    print(f"📊 Inspiration Images: {len(request.inspiration_images) if request.inspiration_images else 0}")
    print(f"📊 Past Content Images: {len(request.past_content_images) if request.past_content_images else 0}")
    print(f"📊 Generic Visuals: {len(request.generic_visuals) if request.generic_visuals else 0}")
    print(f"📊 All Image URLs: {all_images}")
    print(f"📊 Context Keys: {list(context.keys())}")
    print(f"📊 Brand Context: {context.get('brand_context', {})}")
    print(f"📊 Context Management: {context.get('context_management', {})}")
    print("=" * 80)
    
    if not all_images:
        logger.info("No images provided for visual analysis")
        return {}
    
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


async def save_generated_content_to_db(request: UnifiedContentGenerationRequest, context: Dict, prompts: Dict, generated_content: Dict, visual_analysis: Dict):
    """Save generated content to database via TypeScript backend API"""
    try:
        import httpx
        
        # Prepare data for database storage
        db_data = {
            "account_id": request.account_id,
            "account_client_id": request.account_client_id,
            "content_type": request.content_type,
            "image_model": request.image_model,
            "video_model": request.video_model,
            "clip_duration": request.clip_duration,
            "user_prompt": request.user_prompt,
            "user_images": request.user_uploaded_images,  # Store S3 URLs
            "theme": request.theme,
            "workflow_type": request.workflow_type,
            "target_platform": request.target_platform,
            "include_logo": request.include_logo,
            "no_characters": request.no_characters,
            "human_characters_only": request.human_characters_only,
            "web3_characters": request.web3_characters,
            "use_brand_aesthetics": request.use_brand_aesthetics,
            "viral_trends": request.viral_trends,
            "status": "completed",
            "workflow_metadata": {
                "industry": request.industry,
                "num_variations": request.num_images,
                "custom_options": context.get('custom_options', {}),
                "form_data": context.get('form_data', {})
            },
            "visual_analysis": visual_analysis,
            "brand_context": context.get('brand_context', {}),
            "industry": request.industry
        }
        
        # Add generated content URLs
        if request.content_type == 'image':
            db_data.update({
                "image_prompt": prompts.get('image_prompt', ''),
                "generated_image_urls": generated_content.get('image_urls', []),
                "twitter_text": generated_content.get('platform_texts', {}).get('twitter', ''),
                "youtube_description": generated_content.get('platform_texts', {}).get('youtube', ''),
                "instagram_caption": generated_content.get('platform_texts', {}).get('instagram', ''),
                "linkedin_post": generated_content.get('platform_texts', {}).get('linkedin', '')
            })
        else:  # video
            db_data.update({
                "clip_prompt": prompts.get('clip_prompt', ''),
                "generated_video_url": generated_content.get('video_url', ''),
                "twitter_text": generated_content.get('platform_texts', {}).get('twitter', ''),
                "youtube_description": generated_content.get('platform_texts', {}).get('youtube', ''),
                "instagram_caption": generated_content.get('platform_texts', {}).get('instagram', ''),
                "linkedin_post": generated_content.get('platform_texts', {}).get('linkedin', '')
            })
        
        # Save to database via TypeScript backend
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')}/api/web2-generated-content",
                json=db_data,
                timeout=30.0
            )
            
            if response.status_code == 201:
                logger.info("Generated content saved to database successfully")
            else:
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


async def generate_images(request: UnifiedContentGenerationRequest, prompts: Dict, context: Dict) -> Dict:
    """Generate images using Fal.ai"""
    generated_images = []
    
    for i in range(1, request.num_images + 1):
        image_prompt_key = f'image_prompt_{i}'
        platform_texts_key = f'image_{i}_platform_texts'
        
        if image_prompt_key not in prompts:
            continue
        
        image_prompt = prompts[image_prompt_key]
        platform_texts = prompts.get(platform_texts_key, {})
        
        # Determine reference image URL if available
        reference_image_url = None
        if request.user_uploaded_images and len(request.user_uploaded_images) >= i:
            reference_image_url = request.user_uploaded_images[i - 1]
        
        # Call Fal.ai to generate image
        # TODO: Implement actual Fal.ai image generation
        # For now, return placeholder
        generated_images.append({
            'prompt': image_prompt,
            'image_url': f's3://placeholder/image_{i}.jpg',
            'platform_texts': platform_texts
        })
    
    return {
        'content_type': 'image',
        'generated_content': generated_images
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

@router.post("/api/web2/unified-generate")
async def start_unified_generation(request: UnifiedContentGenerationRequest):
    """
    Start unified content generation pipeline
    Returns job ID for tracking progress via SSE
    """
    # Create job ID
    job_id = str(uuid.uuid4())
    
    # Create progress tracker
    tracker = ProgressTracker()
    active_jobs[job_id] = tracker
    
    # Start generation pipeline in background
    asyncio.create_task(run_generation_pipeline(job_id, request))
    
    return {
        'success': True,
        'job_id': job_id,
        'message': 'Generation started. Connect to /api/web2/unified-generate/progress/{job_id} for updates'
    }


@router.get("/api/web2/unified-generate/progress/{job_id}")
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

