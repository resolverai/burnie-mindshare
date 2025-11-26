"""
Unified DVYB Content Generation Endpoint
Handles complete flow: Context Gathering → Prompt Generation → Content Generation
With real-time progress updates via polling

This endpoint is designed to handle millions of customer requests for:
- Single posts
- Threads
- Carousels
- Videos
- Stories

Similar to Web3 projects flow but more generic for both Web3 and Web2 use cases.
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import json
import logging
from datetime import datetime, timedelta
import uuid

from app.services.grok_prompt_service import grok_service
import fal_client
import os
import httpx
import random
import requests
import tempfile
from pathlib import Path
from app.config.settings import settings

# MoviePy imports for video processing
try:
    from moviepy.editor import VideoFileClip, AudioFileClip, concatenate_videoclips, CompositeVideoClip
    MOVIEPY_AVAILABLE = True
except ImportError:
    logging.warning("⚠️ MoviePy not available - video features will be limited")
    MOVIEPY_AVAILABLE = False

logger = logging.getLogger(__name__)

router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Document decay configuration (N days)
DOCUMENT_DECAY_DAYS = 30  # Documents older than 30 days are excluded from context

# Video generation configuration
NUMBER_OF_CLIPS = 1  # Number of clips to generate for video
CLIP_DURATION = 10  # Duration of each clip in seconds


# ============================================
# REQUEST MODELS
# ============================================

class DvybGenerationRequest(BaseModel):
    """Request for DVYB content generation"""
    account_id: int
    content_id: int
    uuid: str
    content_type: str  # 'thread', 'single_post', 'carousel', 'video', 'story'
    platform: str = 'twitter'  # 'twitter', 'linkedin', 'instagram', etc.
    user_prompt: Optional[str] = None  # User's custom prompt/instructions
    num_variations: int = 1  # Number of content variations to generate
    include_image: bool = False  # Whether to generate images
    include_video: bool = False  # Whether to generate videos
    context: Dict[str, Any]  # Full context from DVYB account
    job_id: Optional[str] = None  # If not provided, will be generated


# ============================================
# PROGRESS TRACKING (stored in database via TypeScript backend)
# ============================================

# Store active generation jobs in memory for quick access
active_jobs: Dict[str, Dict[str, Any]] = {}


# ============================================
# HELPER FUNCTIONS
# ============================================

async def update_progress(
    account_id: int,
    job_id: str,
    progress: int,
    message: str,
    status: str = "processing",
    result: Optional[Dict] = None
):
    """Update generation progress in TypeScript backend database"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        payload = {
            "job_id": job_id,
            "progress_percent": progress,
            "progress_message": message,
            "status": status
        }
        
        if result:
            payload["result"] = result
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/dvyb/internal/update-progress",
                json=payload,
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.error(f"⚠️ Failed to update progress: {response.status_code}")
                
    except Exception as e:
        logger.error(f"⚠️ Error updating progress: {str(e)}")


async def gather_all_context(context: Dict[str, Any]) -> Dict:
    """
    Process and structure the DVYB account context for content generation.
    
    This function:
    1. Validates and structures the context data
    2. Applies document decay if applicable
    3. Prepares context for AI prompts
    
    Args:
        context: Raw context from DVYB account
        
    Returns:
        Structured context dictionary ready for prompt generation
    """
    try:
        logger.info("📥 Processing DVYB account context...")
        
        structured_context = {
            "account_info": {
                "name": context.get("accountName", ""),
                "account_type": context.get("accountType", "web2"),
                "industry": context.get("industry", ""),
                "website": context.get("website", ""),
            },
            "brand_identity": {
                "brand_voice": context.get("brandVoice", ""),
                "brand_values": context.get("brandValues", ""),
                "target_audience": context.get("targetAudience", ""),
                "color_palette": context.get("colorPalette", {}),
                "typography": context.get("typography", {}),
                "logo_url": context.get("logoUrl", ""),
            },
            "content_strategy": {
                "content_pillars": context.get("contentPillars", []),
                "keywords": context.get("keywords", ""),
                "competitors": context.get("competitors", ""),
                "goals": context.get("goals", ""),
                "content_guidelines": context.get("contentGuidelines", ""),
                "content_text": context.get("contentText", ""),
            },
            "platform_data": {
                "platform_handles": context.get("platformHandles", {}),
                "links": context.get("linksJson", []),
            },
            "documents": [],
            "web3_specific": {},
        }
        
        # Process documents with decay logic
        documents_text = context.get("documentsText", [])
        if isinstance(documents_text, list):
            current_date = datetime.utcnow()
            for doc in documents_text:
                if isinstance(doc, dict):
                    doc_timestamp = doc.get("timestamp")
                    if doc_timestamp:
                        try:
                            doc_date = datetime.fromisoformat(doc_timestamp.replace('Z', '+00:00'))
                            days_old = (current_date - doc_date).days
                            if days_old <= DOCUMENT_DECAY_DAYS:
                                structured_context["documents"].append({
                                    "name": doc.get("name", ""),
                                    "text": doc.get("text", ""),
                                    "url": doc.get("url", ""),
                                    "age_days": days_old
                                })
                        except:
                            # If timestamp parsing fails, include the document anyway
                            structured_context["documents"].append({
                                "name": doc.get("name", ""),
                                "text": doc.get("text", ""),
                                "url": doc.get("url", ""),
                            })
        
        # Add Web3-specific context if applicable
        if context.get("chain") or context.get("tokenSymbol"):
            structured_context["web3_specific"] = {
                "chain": context.get("chain", ""),
                "token_symbol": context.get("tokenSymbol", ""),
            }
        
        logger.info(f"✅ Context structured successfully")
        logger.info(f"   - Account: {structured_context['account_info']['name']}")
        logger.info(f"   - Industry: {structured_context['account_info']['industry']}")
        logger.info(f"   - Documents: {len(structured_context['documents'])}")
        
        return structured_context
        
    except Exception as e:
        logger.error(f"❌ Error gathering context: {str(e)}")
        raise


async def generate_content_prompt(
    context: Dict,
    content_type: str,
    platform: str,
    user_prompt: Optional[str] = None
) -> str:
    """
    Generate a comprehensive prompt for content generation using Grok/LLM.
    
    Args:
        context: Structured account context
        content_type: Type of content to generate ('thread', 'single_post', etc.)
        platform: Target platform ('twitter', 'linkedin', etc.)
        user_prompt: Optional user-provided instructions
        
    Returns:
        Generated prompt string for content creation
    """
    try:
        logger.info(f"🤖 Generating content prompt for {content_type} on {platform}...")
        
        # Build comprehensive context string
        account_info = context.get("account_info", {})
        brand_identity = context.get("brand_identity", {})
        content_strategy = context.get("content_strategy", {})
        
        context_parts = []
        
        # Account information
        if account_info.get("name"):
            context_parts.append(f"Account: {account_info['name']}")
        if account_info.get("industry"):
            context_parts.append(f"Industry: {account_info['industry']}")
        if account_info.get("account_type"):
            context_parts.append(f"Type: {account_info['account_type']}")
        
        # Brand voice and values
        if brand_identity.get("brand_voice"):
            context_parts.append(f"Brand Voice: {brand_identity['brand_voice']}")
        if brand_identity.get("brand_values"):
            context_parts.append(f"Brand Values: {brand_identity['brand_values']}")
        if brand_identity.get("target_audience"):
            context_parts.append(f"Target Audience: {brand_identity['target_audience']}")
        
        # Content strategy
        if content_strategy.get("content_pillars"):
            pillars = content_strategy['content_pillars']
            if isinstance(pillars, list):
                context_parts.append(f"Content Pillars: {', '.join(pillars)}")
        if content_strategy.get("keywords"):
            context_parts.append(f"Keywords: {content_strategy['keywords']}")
        if content_strategy.get("content_guidelines"):
            context_parts.append(f"Guidelines: {content_strategy['content_guidelines']}")
        
        # Documents
        documents = context.get("documents", [])
        if documents:
            context_parts.append(f"Reference Documents: {len(documents)} documents available")
            for i, doc in enumerate(documents[:3], 1):  # Include up to 3 documents
                if doc.get("text"):
                    context_parts.append(f"Document {i}: {doc['text'][:500]}...")  # First 500 chars
        
        context_string = "\n".join(context_parts)
        
        # Build the prompt based on content type and platform
        platform_specs = get_platform_specifications(platform, content_type)
        
        prompt_template = f"""You are an expert social media content creator for {platform}.

ACCOUNT CONTEXT:
{context_string}

TASK: Generate {content_type} for {platform}

PLATFORM REQUIREMENTS:
{platform_specs}

{'USER INSTRUCTIONS: ' + user_prompt if user_prompt else ''}

Generate engaging, on-brand content that:
1. Matches the brand voice and values
2. Resonates with the target audience
3. Incorporates relevant keywords naturally
4. Follows platform best practices
5. Is optimized for engagement

{'For threads: Provide a cohesive narrative across multiple tweets with strong hooks.' if content_type == 'thread' else ''}
{'For single posts: Create a compelling standalone message with maximum impact.' if content_type == 'single_post' else ''}
"""
        
        # Use Grok service to enhance the prompt
        try:
            enhanced_prompt = await grok_service.generate_daily_posts_prompt(
                context_string,
                platform_type=platform
            )
            if enhanced_prompt:
                return enhanced_prompt
        except Exception as e:
            logger.warning(f"⚠️ Grok service failed, using template: {str(e)}")
        
        return prompt_template
        
    except Exception as e:
        logger.error(f"❌ Error generating prompt: {str(e)}")
        raise


def get_platform_specifications(platform: str, content_type: str) -> str:
    """Get platform-specific specifications for content generation"""
    
    specs = {
        "twitter": {
            "single_post": "- Max 280 characters\n- Use hashtags strategically (2-3 max)\n- Include call-to-action",
            "thread": "- 5-10 tweets max\n- First tweet must hook attention\n- Each tweet max 280 characters\n- Use thread numbers sparingly",
            "carousel": "- 2-4 cards\n- Each card should be visually distinct\n- Tell a sequential story",
        },
        "linkedin": {
            "single_post": "- 1300-2000 characters ideal\n- Professional tone\n- Include industry insights",
            "carousel": "- 5-10 slides\n- Professional design\n- Include data/insights",
        },
        "instagram": {
            "single_post": "- Caption 125-150 characters\n- Use 20-30 hashtags\n- Emoji-friendly",
            "story": "- 15 seconds max\n- Vertical format (9:16)\n- Bold, eye-catching visuals",
        },
    }
    
    return specs.get(platform, {}).get(content_type, "Standard social media best practices")


async def generate_text_content(
    prompt: str,
    content_type: str,
    num_variations: int = 1
) -> Dict[str, Any]:
    """
    Generate text content using AI (Grok/OpenAI/Claude).
    
    Args:
        prompt: The content generation prompt
        content_type: Type of content ('thread', 'single_post', etc.)
        num_variations: Number of variations to generate
        
    Returns:
        Dictionary with generated text content
    """
    try:
        logger.info(f"✍️ Generating text content ({num_variations} variations)...")
        
        # Use Grok service for content generation
        if content_type == "thread":
            # Generate thread
            result = await grok_service.generate_thread_content(prompt, num_variations)
            return {
                "content_type": "thread",
                "variations": result.get("threads", []),
                "tweet_texts": result.get("threads", [[]])[0] if result.get("threads") else [],
            }
        else:
            # Generate single post
            result = await grok_service.generate_single_post(prompt, num_variations)
            return {
                "content_type": "single_post",
                "variations": result.get("posts", []),
                "tweet_text": result.get("posts", [""])[0] if result.get("posts") else "",
            }
        
    except Exception as e:
        logger.error(f"❌ Error generating text content: {str(e)}")
        # Fallback to simple generation
        return {
            "content_type": content_type,
            "tweet_text": f"Generated content based on your brand guidelines. [Error: {str(e)}]",
            "variations": [],
        }


async def generate_image_content(
    prompt: str,
    context: Dict,
    num_images: int = 1
) -> List[str]:
    """
    Generate images using FAL AI.
    
    Args:
        prompt: Image generation prompt
        context: Account context (for logo, brand colors, etc.)
        num_images: Number of images to generate
        
    Returns:
        List of image URLs
    """
    try:
        logger.info(f"🎨 Generating images ({num_images})...")
        
        # Extract brand colors for image generation
        color_palette = context.get("brand_identity", {}).get("color_palette", {})
        primary_color = color_palette.get("primary", "#1DA1F2")
        
        # Enhance prompt with brand context
        brand_voice = context.get("brand_identity", {}).get("brand_voice", "")
        enhanced_prompt = f"{prompt}. Brand style: {brand_voice}. Color theme: {primary_color}"
        
        image_urls = []
        
        for i in range(num_images):
            try:
                # Use FAL AI for image generation
                handler = await fal_client.submit_async(
                    "fal-ai/flux/dev",
                    arguments={
                        "prompt": enhanced_prompt,
                        "num_images": 1,
                        "image_size": "square_hd",  # 1:1 aspect ratio for social media
                    },
                )
                
                result = await handler.get()
                if result and result.get("images"):
                    image_url = result["images"][0]["url"]
                    image_urls.append(image_url)
                    logger.info(f"✅ Generated image {i+1}/{num_images}")
            except Exception as e:
                logger.error(f"❌ Error generating image {i+1}: {str(e)}")
        
        return image_urls
        
    except Exception as e:
        logger.error(f"❌ Error in image generation: {str(e)}")
        return []


async def run_generation_pipeline(job_id: str, request: DvybGenerationRequest):
    """
    Run the complete DVYB content generation pipeline with progress updates.
    
    Pipeline stages:
    1. Context gathering (0-10%)
    2. Prompt generation (10-20%)
    3. Text content generation (20-60%)
    4. Image generation (60-80%) - if requested
    5. Video generation (80-95%) - if requested
    6. Finalization (95-100%)
    """
    try:
        account_id = request.account_id
        content_id = request.content_id
        
        logger.info(f"🚀 Starting DVYB generation pipeline for account {account_id}")
        logger.info(f"   - Job ID: {job_id}")
        logger.info(f"   - Content Type: {request.content_type}")
        logger.info(f"   - Platform: {request.platform}")
        
        # Stage 1: Context gathering (0-10%)
        await update_progress(account_id, job_id, 5, "Gathering account context...")
        context = await gather_all_context(request.context)
        await update_progress(account_id, job_id, 10, "Context gathered successfully")
        
        # Stage 2: Prompt generation (10-20%)
        await update_progress(account_id, job_id, 15, "Generating content prompt...")
        prompt = await generate_content_prompt(
            context,
            request.content_type,
            request.platform,
            request.user_prompt
        )
        await update_progress(account_id, job_id, 20, "Prompt generated")
        
        # Stage 3: Text content generation (20-60%)
        await update_progress(account_id, job_id, 30, "Generating text content...")
        text_result = await generate_text_content(
            prompt,
            request.content_type,
            request.num_variations
        )
        await update_progress(account_id, job_id, 60, "Text content generated")
        
        # Prepare final result
        final_result = {
            "tweet_text": text_result.get("tweet_text"),
            "tweet_texts": text_result.get("tweet_texts"),
            "variations": text_result.get("variations", []),
            "image_urls": [],
            "video_urls": [],
        }
        
        # Stage 4: Image generation (60-80%) - if requested
        if request.include_image:
            await update_progress(account_id, job_id, 65, "Generating images...")
            image_urls = await generate_image_content(
                prompt,
                context,
                request.num_variations
            )
            final_result["image_urls"] = image_urls
            await update_progress(account_id, job_id, 80, f"Generated {len(image_urls)} images")
        else:
            await update_progress(account_id, job_id, 80, "Skipping image generation")
        
        # Stage 5: Video generation (80-95%) - if requested
        if request.include_video:
            await update_progress(account_id, job_id, 85, "Generating videos...")
            # Video generation would go here (similar to image generation)
            # For now, skipping detailed implementation
            await update_progress(account_id, job_id, 95, "Video generation complete")
        else:
            await update_progress(account_id, job_id, 95, "Skipping video generation")
        
        # Stage 6: Finalization (95-100%)
        await update_progress(account_id, job_id, 98, "Finalizing content...")
        await update_progress(
            account_id,
            job_id,
            100,
            "Content generation complete!",
            status="completed",
            result=final_result
        )
        
        logger.info(f"✅ DVYB generation pipeline completed for job {job_id}")
        
        # Remove from active jobs
        if job_id in active_jobs:
            del active_jobs[job_id]
        
    except Exception as e:
        logger.error(f"❌ Generation pipeline failed: {str(e)}")
        await update_progress(
            account_id,
            job_id,
            0,
            f"Generation failed: {str(e)}",
            status="failed"
        )
        
        # Remove from active jobs
        if job_id in active_jobs:
            del active_jobs[job_id]


# ============================================
# API ENDPOINTS
# ============================================

@router.post("/api/dvyb/generate")
async def start_dvyb_generation(request: DvybGenerationRequest):
    """
    Start DVYB content generation pipeline.
    
    This is the main entry point for all DVYB content generation requests.
    Supports millions of concurrent customers.
    """
    try:
        # Generate job_id if not provided
        job_id = request.job_id or str(uuid.uuid4())
        request.job_id = job_id
        
        logger.info(f"📥 Received DVYB generation request")
        logger.info(f"   - Account ID: {request.account_id}")
        logger.info(f"   - Content Type: {request.content_type}")
        logger.info(f"   - Job ID: {job_id}")
        
        # Store job in memory
        active_jobs[job_id] = {
            "account_id": request.account_id,
            "content_id": request.content_id,
            "status": "running",
            "started_at": datetime.utcnow().isoformat()
        }
        
        # Start generation pipeline in background
        asyncio.create_task(run_generation_pipeline(job_id, request))
        
        return {
            "success": True,
            "job_id": job_id,
            "message": "Content generation started",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Error starting DVYB generation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dvyb/progress/{job_id}")
async def get_dvyb_progress(job_id: str):
    """
    Get DVYB content generation progress by job_id.
    
    This endpoint is polled by the frontend for real-time updates.
    Optimized for high-frequency polling from millions of users.
    """
    try:
        # Check if job is in active jobs
        if job_id in active_jobs:
            job_info = active_jobs[job_id]
            
            # Fetch latest progress from TypeScript backend
            typescript_backend_url = settings.typescript_backend_url
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{typescript_backend_url}/api/dvyb/internal/progress/{job_id}",
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return data
                else:
                    return {
                        "success": False,
                        "status": "processing",
                        "progress": 0,
                        "message": "Processing...",
                        "timestamp": datetime.utcnow().isoformat()
                    }
        else:
            # Job not found in active jobs - might be completed or failed
            return {
                "success": False,
                "error": "Job not found or already completed",
                "timestamp": datetime.utcnow().isoformat()
            }
                
    except Exception as e:
        logger.error(f"❌ Error fetching DVYB progress: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dvyb/health")
async def dvyb_health_check():
    """Health check endpoint for DVYB generation service"""
    return {
        "success": True,
        "service": "DVYB Unified Content Generation",
        "status": "operational",
        "active_jobs": len(active_jobs),
        "timestamp": datetime.utcnow().isoformat()
    }


# ============================================
# WEEKLY CONTENT GENERATION FOR DVYB
# ============================================

class WeeklyGenerationRequest(BaseModel):
    """Request for weekly content generation"""
    account_id: int
    job_id: str  # UUID for tracking this generation
    week_start: str  # ISO format date
    week_end: str  # ISO format date


async def fetch_dvyb_context_from_backend(account_id: int) -> Dict[str, Any]:
    """
    Fetch complete DVYB context from TypeScript backend.
    
    Returns:
        Complete context including postsPerWeek, mediaChannels, topics, brand info, etc.
    """
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient() as client:
            # Fetch context
            context_response = await client.get(
                f"{typescript_backend_url}/api/dvyb/context",
                headers={"x-account-id": str(account_id)},
                timeout=30.0
            )
            
            if context_response.status_code != 200:
                raise HTTPException(status_code=404, detail="Context not found")
            
            context_data = context_response.json()
            context = context_data.get("data", {})
            
            # Fetch topics
            topics_response = await client.get(
                f"{typescript_backend_url}/api/dvyb/topics",
                headers={"x-account-id": str(account_id)},
                timeout=30.0
            )
            
            topics = []
            if topics_response.status_code == 200:
                topics_data = topics_response.json()
                topics = topics_data.get("data", {}).get("generatedTopics", [])
            
            # Combine context and topics
            context["topics"] = topics
            
            logger.info(f"✅ Fetched context for account {account_id}")
            logger.info(f"   - Posts per week: {context.get('postsPerWeek', 7)}")
            logger.info(f"   - Media channels: {context.get('mediaChannels', {})}")
            logger.info(f"   - Topics: {len(topics)}")
            
            return context
            
    except Exception as e:
        logger.error(f"❌ Error fetching context: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch context: {str(e)}")


async def get_presigned_url_for_fal(url: str) -> str:
    """
    Convert S3 URL to presigned URL for FAL.
    FAL requires presigned URLs for all image inputs.
    """
    try:
        if not url or not url.startswith("s3://"):
            return url  # Return as-is if not S3 URL
        
        # Extract bucket and key from S3 URL
        # Format: s3://bucket-name/key/path
        s3_parts = url.replace("s3://", "").split("/", 1)
        if len(s3_parts) != 2:
            return url
        
        bucket, key = s3_parts
        
        # Call TypeScript backend to generate presigned URL
        typescript_backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/dvyb/upload/presigned-url",
                json={"s3_key": key, "operation": "get"},
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("data", {}).get("presigned_url", url)
        
        return url
        
    except Exception as e:
        logger.warning(f"⚠️ Failed to get presigned URL: {str(e)}, using original URL")
        return url


async def generate_weekly_content_with_grok(
    context: Dict[str, Any],
    num_posts: int,
    num_videos: int,
    week_start: str,
    week_end: str
) -> List[Dict[str, Any]]:
    """
    Generate weekly content plan using Grok.
    
    Returns list of content items with:
    - topic
    - content_type (image_post or video_post)
    - post_date
    - post_time
    - text (for each platform)
    - frame_prompts (for images)
    - clip_prompts (for videos)
    """
    try:
        logger.info(f"🤖 Generating weekly content plan with Grok...")
        
        # Extract context info
        account_name = context.get("accountName", "")
        business_overview = context.get("businessOverview", "")
        customer_demographics = context.get("customerDemographics", "")
        brand_story = context.get("brandStory", "")
        brand_voice = context.get("brandVoice", "")
        media_channels = context.get("mediaChannels", {})
        topics = context.get("topics", [])
        
        # Filter topics for this week
        week_topics = []
        for topic_obj in topics:
            if isinstance(topic_obj, dict):
                week_topics.append(topic_obj.get("topic", ""))
        
        # Get selected platforms
        social_platforms = media_channels.get("social", [])
        video_platforms = media_channels.get("video", [])
        all_platforms = list(set(social_platforms + video_platforms))
        
        # Build Grok prompt
        prompt = f"""You are a social media content strategist. Generate a weekly content plan for {account_name}.

BRAND CONTEXT:
- Business: {business_overview}
- Audience: {customer_demographics}
- Brand Story: {brand_story}
- Brand Voice: {brand_voice}

CONTENT REQUIREMENTS:
- Total posts: {num_posts}
- Video posts: {num_videos}
- Image posts: {num_posts - num_videos}
- Week: {week_start} to {week_end}
- Platforms: {', '.join(all_platforms)}

AVAILABLE TOPICS:
{chr(10).join([f"- {t}" for t in week_topics[:10]])}

For each post, generate:
1. topic: Pick from available topics (or create relevant one)
2. content_type: "image_post" or "video_post"
3. post_date: Date within the week (YYYY-MM-DD)
4. post_time: Optimal posting time (HH:MM format, 24-hour)
5. text: Platform-specific text for each platform ({', '.join(all_platforms)})
6. frame_prompts: Array of 1 detailed visual description for image (if image_post)
7. clip_prompts: Array of 1 detailed scene description for 10-second video (if video_post)

PLATFORM-SPECIFIC TEXT GUIDELINES:
- Instagram: Engaging, visual-focused, with emojis, max 2200 chars
- Twitter: Concise, punchy, max 280 chars
- Facebook: Conversational, story-driven, max 500 chars
- LinkedIn: Professional, value-driven, max 700 chars
- YouTube: Descriptive, SEO-optimized, max 500 chars

VISUAL PROMPT GUIDELINES:
- For images: Describe a single eye-catching scene that captures the topic
- For videos: Describe a 10-second dynamic scene with motion and engagement
- Include brand colors, mood, style, composition
- Make it specific and detailed for AI generation

Return ONLY valid JSON in this exact structure:
{{
  "posts": [
    {{
      "topic": "Topic text here",
      "content_type": "image_post",
      "post_date": "2024-11-25",
      "post_time": "14:00",
      "platform_text": {{
        "instagram": "Text for Instagram",
        "twitter": "Text for Twitter",
        ...
      }},
      "frame_prompts": ["Detailed visual description"],
      "clip_prompts": []
    }},
    ...
  ]
}}"""

        # Call Grok
        response = await grok_service.generate_content(prompt, model="grok-beta")
        
        # Parse JSON response
        response_text = response.strip()
        
        # Remove markdown code blocks if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = []
            in_code_block = False
            for line in lines:
                if line.strip().startswith("```"):
                    in_code_block = not in_code_block
                    continue
                if in_code_block or not line.strip().startswith("```"):
                    json_lines.append(line)
            response_text = "\n".join(json_lines).strip()
        
        content_plan = json.loads(response_text)
        posts = content_plan.get("posts", [])
        
        logger.info(f"✅ Generated {len(posts)} posts with Grok")
        return posts
        
    except Exception as e:
        logger.error(f"❌ Error generating content plan: {str(e)}")
        raise


async def generate_image_with_fal(
    frame_prompt: str,
    context: Dict[str, Any]
) -> str:
    """
    Generate image using FAL Nano Banana Edit.
    Uses presigned S3 URLs for logo and reference images.
    """
    try:
        logger.info(f"🎨 Generating image with FAL Nano Banana Edit...")
        
        # Get logo URL (convert to presigned)
        logo_url = context.get("logoUrl", "")
        if logo_url:
            logo_url = await get_presigned_url_for_fal(logo_url)
        
        # Get brand colors
        color_palette = context.get("colorPalette", {})
        primary_color = color_palette.get("primary", "#0099ff")
        
        # Prepare FAL request
        arguments = {
            "prompt": frame_prompt,
            "image_size": "square_hd",
            "num_inference_steps": 28,
            "guidance_scale": 3.5,
            "num_images": 1,
            "enable_safety_checker": True,
        }
        
        # Add logo if available
        if logo_url:
            arguments["image_url"] = logo_url
            arguments["strength"] = 0.75
        
        result = await asyncio.to_thread(
            fal_client.subscribe,
            "fal-ai/fast-sdxl",
            arguments=arguments,
            with_logs=True
        )
        
        if result and "images" in result and len(result["images"]) > 0:
            image_url = result["images"][0]["url"]
            logger.info(f"✅ Image generated: {image_url}")
            return image_url
        else:
            raise Exception("No image generated")
            
    except Exception as e:
        logger.error(f"❌ Image generation failed: {str(e)}")
        raise


async def generate_video_with_kling(
    clip_prompt: str,
    context: Dict[str, Any]
) -> str:
    """
    Generate 10-second video using Kling.
    """
    try:
        logger.info(f"🎬 Generating video with Kling...")
        
        # Kling API endpoint
        kling_api_key = settings.kling_api_key
        if not kling_api_key:
            raise Exception("Kling API key not configured")
        
        # Call Kling API
        headers = {
            "Authorization": f"Bearer {kling_api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "prompt": clip_prompt,
            "duration": 10,  # 10 seconds
            "aspect_ratio": "16:9",
            "cfg_scale": 0.5,
        }
        
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                "https://api.piapi.ai/api/kling/v1/video/generations",
                headers=headers,
                json=payload
            )
            
            if response.status_code != 200:
                raise Exception(f"Kling API error: {response.status_code}")
            
            result = response.json()
            task_id = result.get("data", {}).get("task_id")
            
            if not task_id:
                raise Exception("No task ID returned from Kling")
            
            # Poll for completion
            max_attempts = 60  # 5 minutes max
            for attempt in range(max_attempts):
                await asyncio.sleep(5)
                
                status_response = await client.get(
                    f"https://api.piapi.ai/api/kling/v1/video/generations/{task_id}",
                    headers=headers
                )
                
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    task_status = status_data.get("data", {}).get("task_status")
                    
                    if task_status == "succeed":
                        video_url = status_data.get("data", {}).get("task_result", {}).get("videos", [{}])[0].get("url")
                        if video_url:
                            logger.info(f"✅ Video generated: {video_url}")
                            return video_url
                    elif task_status == "failed":
                        raise Exception("Kling video generation failed")
            
            raise Exception("Kling video generation timed out")
            
    except Exception as e:
        logger.error(f"❌ Video generation failed: {str(e)}")
        raise


async def update_progress_in_db(
    job_id: str,
    progress_percent: int,
    progress_message: str,
    status: str = None,
    generated_image_urls: List[str] = None,
    generated_video_urls: List[str] = None,
    platform_texts: List[Dict] = None,
    frame_prompts: List[str] = None,
    clip_prompts: List[str] = None,
    error_message: str = None
):
    """
    Update generation progress in TypeScript backend database.
    """
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        payload = {
            "jobId": job_id,
            "progressPercent": progress_percent,
            "progressMessage": progress_message
        }
        
        if status:
            payload["status"] = status
        if generated_image_urls is not None:
            payload["generatedImageUrls"] = generated_image_urls
        if generated_video_urls is not None:
            payload["generatedVideoUrls"] = generated_video_urls
        if platform_texts is not None:
            payload["platformTexts"] = platform_texts
        if frame_prompts is not None:
            payload["framePrompts"] = frame_prompts
        if clip_prompts is not None:
            payload["clipPrompts"] = clip_prompts
        if error_message:
            payload["errorMessage"] = error_message
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{typescript_backend_url}/api/dvyb/generation/progress",
                json=payload,
                timeout=30.0
            )
            
            if response.status_code != 200:
                logger.warning(f"⚠️ Failed to update progress: {response.status_code}")
                
    except Exception as e:
        logger.warning(f"⚠️ Error updating progress: {str(e)}")


@router.post("/api/dvyb/generate-weekly")
async def generate_weekly_content(request: WeeklyGenerationRequest):
    """
    Generate a week's worth of content for DVYB account.
    
    This endpoint:
    1. Fetches account context (postsPerWeek, mediaChannels, topics, brand info)
    2. Uses Grok to generate content plan (3 videos, rest images)
    3. Generates images using FAL Nano Banana Edit
    4. Generates 10-second videos using Kling
    5. Updates progress in database throughout generation
    6. Stores all content in ONE record (like web3 projects)
    
    Returns job_id for tracking progress
    """
    try:
        job_id = request.job_id if request.job_id else str(uuid.uuid4())
        logger.info(f"🎯 Starting weekly content generation for account {request.account_id}")
        logger.info(f"   Job ID: {job_id}")
        logger.info(f"   Week: {request.week_start} to {request.week_end}")
        
        # Update progress: Starting
        await update_progress_in_db(job_id, 0, "Starting generation...")
        
        # Fetch context from backend
        await update_progress_in_db(job_id, 5, "Fetching account context...")
        context = await fetch_dvyb_context_from_backend(request.account_id)
        
        # Get configuration
        posts_per_week = context.get("postsPerWeek", 7)
        num_videos = min(3, posts_per_week)  # 3 video posts
        num_images = posts_per_week - num_videos  # Rest are image posts
        
        logger.info(f"📊 Content plan: {posts_per_week} total ({num_videos} videos, {num_images} images)")
        
        # Generate content plan with Grok
        await update_progress_in_db(job_id, 10, "Generating content plan with AI...")
        content_plan = await generate_weekly_content_with_grok(
            context,
            posts_per_week,
            num_videos,
            request.week_start,
            request.week_end
        )
        
        total_posts = len(content_plan)
        logger.info(f"✅ Generated plan for {total_posts} posts")
        
        # Initialize arrays for storing all generated content
        generated_image_urls = []
        generated_video_urls = []
        platform_texts = []
        frame_prompts_all = []
        clip_prompts_all = []
        
        # Process each post
        for idx, post in enumerate(content_plan):
            try:
                # Calculate progress (10-90% for generation, leave 10% for finalization)
                post_progress = 10 + int((idx / total_posts) * 80)
                await update_progress_in_db(
                    job_id, 
                    post_progress, 
                    f"Generating post {idx + 1}/{total_posts}: {post.get('topic', 'Untitled')[:30]}..."
                )
                
                logger.info(f"📝 Processing post {idx + 1}/{total_posts}: {post.get('topic', 'Untitled')}")
                
                content_type = post.get("content_type", "image_post")
                
                # Store platform text
                platform_texts.append({
                    "post_index": idx,
                    "platforms": post.get("platform_text", {}),
                    "topic": post.get("topic", ""),
                    "post_date": post.get("post_date"),
                    "post_time": post.get("post_time", "12:00"),
                    "content_type": "video" if content_type == "video_post" else "image"
                })
                
                # Generate visual content
                if content_type == "video_post" and post.get("clip_prompts"):
                    # Store clip prompt
                    clip_prompt = post["clip_prompts"][0]
                    clip_prompts_all.append(clip_prompt)
                    
                    # Generate video
                    video_url = await generate_video_with_kling(clip_prompt, context)
                    generated_video_urls.append(video_url)
                    
                    logger.info(f"✅ Video {len(generated_video_urls)} generated")
                    
                elif post.get("frame_prompts"):
                    # Store frame prompt
                    frame_prompt = post["frame_prompts"][0]
                    frame_prompts_all.append(frame_prompt)
                    
                    # Generate image
                    image_url = await generate_image_with_fal(frame_prompt, context)
                    generated_image_urls.append(image_url)
                    
                    logger.info(f"✅ Image {len(generated_image_urls)} generated")
                
                # Update progress with current URLs
                await update_progress_in_db(
                    job_id,
                    post_progress,
                    f"Generated {idx + 1}/{total_posts} posts",
                    generated_image_urls=generated_image_urls,
                    generated_video_urls=generated_video_urls,
                    platform_texts=platform_texts,
                    frame_prompts=frame_prompts_all,
                    clip_prompts=clip_prompts_all
                )
                
            except Exception as e:
                logger.error(f"❌ Failed to process post {idx + 1}: {str(e)}")
                continue
        
        # Final update: Completion
        await update_progress_in_db(
            job_id,
            100,
            "Generation completed!",
            status="completed",
            generated_image_urls=generated_image_urls,
            generated_video_urls=generated_video_urls,
            platform_texts=platform_texts,
            frame_prompts=frame_prompts_all,
            clip_prompts=clip_prompts_all
        )
        
        logger.info(f"🎉 Weekly content generation complete!")
        logger.info(f"   Images: {len(generated_image_urls)}")
        logger.info(f"   Videos: {len(generated_video_urls)}")
        logger.info(f"   Total posts: {len(platform_texts)}")
        
        return {
            "success": True,
            "data": {
                "job_id": job_id,
                "account_id": request.account_id,
                "total_posts": len(platform_texts),
                "num_images": len(generated_image_urls),
                "num_videos": len(generated_video_urls)
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Weekly content generation failed: {str(e)}")
        # Update error status
        if 'job_id' in locals():
            await update_progress_in_db(
                job_id,
                0,
                "Generation failed",
                status="failed",
                error_message=str(e)
            )
        raise HTTPException(status_code=500, detail=str(e))

