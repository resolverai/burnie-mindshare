"""
Unified Web3 Project Daily Posts Generation Endpoint
Handles complete flow: Context Gathering → Prompt Generation → Content Generation
With real-time progress updates via polling
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
    logger.warning("⚠️ MoviePy not available - video features will be limited")
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
CLIP_DURATION = 10  # Duration of each clip in seconds (Kling supports 5 or 10)


# ============================================
# REQUEST MODELS
# ============================================

class ProjectUnifiedGenerationRequest(BaseModel):
    """Request for unified daily posts generation"""
    project_id: int
    job_id: Optional[str] = None  # If not provided, will be generated
    session_cookie: Optional[str] = None  # Session cookie from TypeScript backend for authentication


# ============================================
# PROGRESS TRACKING (stored in database)
# ============================================

# Store active generation jobs in memory for quick access
active_jobs: Dict[str, Dict[str, Any]] = {}


# ============================================
# HELPER FUNCTIONS
# ============================================

async def fetch_project_context(project_id: int, session_cookie: Optional[str] = None) -> Dict:
    """Fetch project context from TypeScript backend"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/context",
                headers=headers,
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('data', {})
            else:
                logger.error(f"⚠️ Failed to fetch project context: {response.status_code}")
                return {}
                
    except Exception as e:
        logger.error(f"⚠️ Error fetching project context: {str(e)}")
        return {}


async def fetch_project_configuration(project_id: int, session_cookie: Optional[str] = None) -> Dict:
    """Fetch project configuration from TypeScript backend"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/configurations",
                headers=headers,
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('data', {}) if isinstance(data.get('data'), dict) else data
            else:
                logger.error(f"⚠️ Failed to fetch project configuration: {response.status_code}")
                return {}
                
    except Exception as e:
        logger.error(f"⚠️ Error fetching project configuration: {str(e)}")
        return {}


def apply_document_decay(documents_text: List[Dict], decay_days: int = DOCUMENT_DECAY_DAYS) -> List[Dict]:
    """
    Apply exponential time decay to documents.
    Returns only documents uploaded within the last N days.
    """
    if not documents_text or not isinstance(documents_text, list):
        return []
    
    cutoff_date = datetime.utcnow() - timedelta(days=decay_days)
    valid_documents = []
    
    for doc in documents_text:
        if not isinstance(doc, dict):
            continue
        
        # Extract timestamp from document
        timestamp_str = doc.get('timestamp')
        if not timestamp_str:
            continue
        
        try:
            # Parse timestamp (assuming ISO format)
            doc_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            if doc_date.tzinfo:
                doc_date = doc_date.replace(tzinfo=None)
            
            # Include document if within decay period
            if doc_date >= cutoff_date:
                valid_documents.append(doc)
        except Exception as e:
            logger.warning(f"⚠️ Error parsing document timestamp: {e}")
            # Include document if timestamp parsing fails (safer to include)
            valid_documents.append(doc)
    
    logger.info(f"📚 Document decay: {len(documents_text)} total → {len(valid_documents)} within {decay_days} days")
    return valid_documents


async def fetch_live_search_web_context(links: List[Dict]) -> Dict[str, str]:
    """
    Use Grok live search with web_source (NO date range, NO max_results).
    Fetches context from website links (project info, competitor sites, industry studies).
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    from xai_sdk.search import SearchParameters, web_source
    from urllib.parse import urlparse
    
    # Extract URLs from linksJson (limit to 10 for performance)
    allowed_websites = []
    if links and isinstance(links, list):
        for link in links[:10]:
            if isinstance(link, dict):
                url = link.get('url')
            elif isinstance(link, str):
                url = link
            else:
                continue
                
            if url:
                try:
                    parsed = urlparse(url)
                    domain = parsed.netloc or parsed.path.split('/')[0]
                    if domain and domain not in allowed_websites:
                        allowed_websites.append(domain)
                except Exception as e:
                    logger.warning(f"⚠️ Could not parse URL {url}: {e}")
    
    if not allowed_websites:
        return {}
    
    logger.info(f"📎 Fetching web context from {len(allowed_websites)} websites: {', '.join(allowed_websites[:5])}{'...' if len(allowed_websites) > 5 else ''}")
    
    try:
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            logger.warning("⚠️ No Grok API key for web live search")
            return {}
        
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # Web source: NO date range, NO max_results
        chat = client.chat.create(
            model="grok-4-latest",
            search_parameters=SearchParameters(
                mode="auto",
                sources=[web_source(allowed_websites=allowed_websites)]
            ),
        )
        
        system_prompt = """You are a web content analyzer. Extract and summarize key information from the specified websites.

Return a JSON object with website domain as key and summary as value.
Example: {"website1.com": "Summary...", "website2.com": "Summary..."}

Focus on:
- Project information, features, and updates
- Competitor analysis and comparisons
- Industry studies and research
- Key metrics and statistics"""
        
        user_prompt = f"""Please gather comprehensive information from these websites:
{', '.join(allowed_websites[:10])}

Extract and summarize:
1. Project features, updates, and announcements
2. Key metrics, statistics, and data points
3. Competitor information and comparisons
4. Industry studies and research findings
5. Important details relevant to the project

Return ONLY a JSON object with website domains as keys and summaries as values."""
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        logger.info("🔄 Calling Grok for web context (no date restrictions)...")
        response = chat.sample()
        
        response_text = response.content.strip()
        json_content = extract_json_from_response(response_text)
        web_data = json.loads(json_content)
        
        logger.info(f"✅ Fetched web context from {len(web_data)} websites")
        return web_data
        
    except Exception as e:
        logger.error(f"❌ Error in web live search: {e}")
        return {}


async def fetch_live_search_twitter_context(platform_handles: Dict) -> Dict[str, str]:
    """
    Use Grok live search with x_source (WITH date range last 10 days, WITH max_results=20).
    Fetches recent context from Twitter handles (project mentions, industry trends, category discussions).
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    from xai_sdk.search import SearchParameters, x_source
    
    # Extract Twitter handles from platform_handles
    twitter_handles = []
    if platform_handles and isinstance(platform_handles, dict):
        twitter_list = platform_handles.get('twitter', [])
        if isinstance(twitter_list, list):
            for handle in twitter_list[:10]:
                if handle and isinstance(handle, str):
                    clean_handle = handle.lstrip('@').strip()
                    if clean_handle and clean_handle not in twitter_handles:
                        twitter_handles.append(clean_handle)
    
    if not twitter_handles:
        return {}
    
    # Calculate date range: last 10 days
    to_date = datetime.now()
    from_date = to_date - timedelta(days=10)
    
    logger.info(f"🐦 Fetching Twitter context from {len(twitter_handles)} handles (last 10 days): {', '.join(['@' + h for h in twitter_handles[:5]])}{'...' if len(twitter_handles) > 5 else ''}")
    logger.info(f"📅 Date range: {from_date.strftime('%Y-%m-%d')} to {to_date.strftime('%Y-%m-%d')}")
    
    try:
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            logger.warning("⚠️ No Grok API key for Twitter live search")
            return {}
        
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # X source: WITH date range and max_results
        chat = client.chat.create(
            model="grok-4-latest",
            search_parameters=SearchParameters(
                mode="auto",
                max_search_results=20,
                from_date=from_date,
                to_date=to_date,
                sources=[x_source(included_x_handles=twitter_handles)]
            ),
        )
        
        system_prompt = """You are a Twitter/X content analyzer. Extract and summarize recent discussions from the specified Twitter handles.

Return a JSON object with handle as key and summary as value.
Example: {"@handle1": "Summary...", "@handle2": "Summary..."}

Focus on:
- Recent tweets and discussions (last 10 days)
- Project mentions and updates
- Industry trends and category discussions
- Community sentiment and engagement patterns"""
        
        user_prompt = f"""Please gather recent context (last 10 days) from these Twitter handles:
{', '.join(['@' + h for h in twitter_handles[:10]])}

Extract and summarize:
1. Recent tweets and discussions about the project
2. Industry trends and category happenings
3. Community sentiment and engagement patterns
4. Key updates and announcements
5. Important dates and upcoming events

Return ONLY a JSON object with handles (include @) as keys and summaries as values."""
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        logger.info("🔄 Calling Grok for Twitter context (with date range and max_results)...")
        response = chat.sample()
        
        response_text = response.content.strip()
        json_content = extract_json_from_response(response_text)
        twitter_data = json.loads(json_content)
        
        logger.info(f"✅ Fetched Twitter context from {len(twitter_data)} handles")
        return twitter_data
        
    except Exception as e:
        logger.error(f"❌ Error in Twitter live search: {e}")
        return {}


async def fetch_live_search_data_for_links(links: List[Dict], platform_handles: Dict) -> Dict[str, Any]:
    """
    Fetch live search data from both web sources and Twitter handles separately, then combine.
    
    - Web sources: NO date range, NO max_results (gathers all relevant info from links)
    - Twitter handles: WITH date range (last 10 days), WITH max_results=20 (recent discussions)
    
    Returns combined dict with web_context, twitter_context, and combined_insights.
    """
    logger.info("=" * 80)
    logger.info("🔍 STARTING LIVE SEARCH FOR CONTEXT GATHERING")
    logger.info("=" * 80)
    
    # Fetch web context and Twitter context separately (in parallel)
    web_context_task = fetch_live_search_web_context(links if links else [])
    twitter_context_task = fetch_live_search_twitter_context(platform_handles if platform_handles else {})
    
    web_context, twitter_context = await asyncio.gather(web_context_task, twitter_context_task)
    
    # Combine results
    combined_data = {
        "web_context": web_context,
        "twitter_context": twitter_context,
        "combined_insights": ""
    }
    
    # Generate combined insights if we have data
    if web_context or twitter_context:
        try:
            from xai_sdk import Client
            from xai_sdk.chat import user, system
            
            grok_api_key = settings.xai_api_key
            if grok_api_key:
                client = Client(api_key=grok_api_key, timeout=3600)
                chat = client.chat.create(model="grok-4-latest")
                
                insights_prompt = f"""Based on the following context gathered from websites and Twitter handles, provide overall insights and trends:

Website Context:
{json.dumps(web_context, indent=2) if web_context else "None"}

Twitter Context:
{json.dumps(twitter_context, indent=2) if twitter_context else "None"}

Summarize the overall patterns, trends, and key insights that emerge from combining all this information. Focus on what's most relevant for content generation."""
                
                chat.append(system("You are an insights analyst. Summarize key patterns and trends."))
                chat.append(user(insights_prompt))
                response = chat.sample()
                combined_data["combined_insights"] = response.content.strip()
        except Exception as e:
            logger.warning(f"⚠️ Could not generate combined insights: {e}")
    
    logger.info("=" * 80)
    logger.info("✅ LIVE SEARCH CONTEXT GATHERING COMPLETE")
    logger.info("=" * 80)
    logger.info(f"📊 Web context items: {len(web_context)}")
    logger.info(f"🐦 Twitter context items: {len(twitter_context)}")
    logger.info(f"💡 Combined insights: {'Yes' if combined_data.get('combined_insights') else 'No'}")
    logger.info("=" * 80)
    
    return combined_data


async def generate_presigned_url(s3_key: str, expiration: int = 3600, project_id: int = None, session_cookie: Optional[str] = None) -> Optional[str]:
    """Generate presigned URL for S3 object"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        # Extract project_id from s3_key if not provided
        if project_id is None and '/web3_projects/' in s3_key:
            parts = s3_key.split('/')
            try:
                project_idx = parts.index('web3_projects')
                if project_idx + 1 < len(parts):
                    project_id = int(parts[project_idx + 1])
            except (ValueError, IndexError):
                pass
        
        # Clean s3_key (remove s3:// prefix if present)
        clean_s3_key = s3_key.replace('s3://', '').split('/', 1)[-1] if 's3://' in s3_key else s3_key
        
        if project_id:
            endpoint = f"{typescript_backend_url}/api/projects/{project_id}/presigned-url"
        else:
            logger.error(f"⚠️ Cannot generate presigned URL: project_id not found in s3_key: {s3_key}")
            return None
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                endpoint,
                headers=headers,
                json={"s3_key": clean_s3_key, "expiration": expiration},
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                presigned_url = data.get('presigned_url') or data.get('data', {}).get('presigned_url')
                if presigned_url:
                    logger.info(f"✅ Generated presigned URL for {clean_s3_key[:50]}...")
                return presigned_url
            else:
                logger.error(f"⚠️ Failed to generate presigned URL: {response.status_code} - {response.text}")
                return None
                
    except Exception as e:
        logger.error(f"⚠️ Error generating presigned URL: {str(e)}")
        return None


async def gather_all_context(project_id: int, session_cookie: Optional[str] = None) -> Dict:
    """
    Gather ALL context needed for prompt generation.
    
    This function:
    1. Fetches project context from TypeScript backend
    2. Fetches project configuration
    3. Applies document decay (filters old documents)
    4. Fetches live search data from links using Grok (THIS IS THE ONLY GROK CALL FOR CONTEXT GATHERING)
    5. Combines everything into a single context dict
    
    After this function completes, ALL context is ready and will be passed to generate_prompts()
    """
    logger.info(f"📚 Step 1: Gathering all context for project {project_id}")
    
    # Step 1.1: Fetch base project context from TypeScript backend
    logger.info("  → Fetching project context from TypeScript backend...")
    context = await fetch_project_context(project_id, session_cookie)
    
    # Step 1.2: Fetch project configuration
    logger.info("  → Fetching project configuration...")
    config = await fetch_project_configuration(project_id, session_cookie)
    
    # Step 1.3: Apply document decay (filter out old documents)
    logger.info("  → Applying document decay (filtering old documents)...")
    documents_text_raw = context.get('documents_text')
    documents_text = documents_text_raw if isinstance(documents_text_raw, list) else []
    valid_documents: List[Dict[str, Any]] = []
    if documents_text:
        valid_documents = apply_document_decay(documents_text)
        context['documents_text'] = valid_documents
        logger.info(f"  → Documents after decay: {len(valid_documents)}/{len(documents_text)}")
    
    # Step 1.4: Fetch live search data for links and Twitter handles (USES GROK LIVE SEARCH)
    raw_links = context.get('linksJson')
    links = raw_links if isinstance(raw_links, list) else []
    raw_platform_handles = context.get('platform_handles')
    platform_handles = raw_platform_handles if isinstance(raw_platform_handles, dict) else {}
    live_search_data = {}
    
    # Check if we have any sources for live search
    has_links = links and isinstance(links, list) and len(links) > 0
    has_twitter_handles = platform_handles and isinstance(platform_handles, dict) and platform_handles.get('twitter')
    
    if has_links or has_twitter_handles:
        logger.info(f"  → Fetching live search data using Grok...")
        logger.info(f"     - Links: {len(links) if has_links else 0}")
        logger.info(f"     - Twitter handles: {len(platform_handles.get('twitter', [])) if has_twitter_handles else 0}")
        live_search_data = await fetch_live_search_data_for_links(links if has_links else [], platform_handles if has_twitter_handles else {})
        context['live_search_data'] = live_search_data
        if live_search_data:
            web_count = len(live_search_data.get('web_context', {}))
            twitter_count = len(live_search_data.get('twitter_context', {}))
            logger.info(f"  → Live search data fetched: {web_count} websites, {twitter_count} Twitter handles")
        else:
            logger.info(f"  → Live search returned no data")
    else:
        logger.info("  → No links or Twitter handles provided, skipping live search")
    
    # Extract color palette
    raw_color_palette = context.get('color_palette')
    color_palette = raw_color_palette if isinstance(raw_color_palette, dict) else {}
    
    # Get content mix from configuration
    default_content_mix = {'shitpost': 4, 'threads': 4, 'longpost': 2}
    raw_content_mix = config.get('content_mix')
    content_mix = raw_content_mix if isinstance(raw_content_mix, dict) else default_content_mix
    
    # Get image model (video model is fixed to 'kling')
    image_model = config.get('image_model') or 'nano-banana'
    
    # Step 1.5: Combine all gathered context into a single dict
    logger.info("  → Combining all context data...")
    combined_context = {
        'project_id': project_id,
        'project_name': context.get('project_name', 'Web3 Project'),
        'website': context.get('website'),
        'chain': context.get('chain'),
        'token_symbol': context.get('tokenSymbol'),
        'tone': context.get('tone'),
        'category': context.get('category'),
        'keywords': context.get('keywords'),
        'competitors': context.get('competitors'),
        'goals': context.get('goals'),
        'brand_values': context.get('brand_values'),
        'color_palette': color_palette,
        'documents_text': valid_documents if valid_documents else [],
        'platform_handles': platform_handles,
        'links': links,
        'live_search_data': live_search_data,  # Pre-fetched using Grok live search
        'details_text': context.get('details_text'),
        'content_text': context.get('content_text'),
        'logo_url': context.get('logo_url'),  # Pass logo_url to prompt generation
        'content_mix': content_mix,
        'image_model': image_model,
        'video_model': 'kling',  # Fixed
        'clip_duration': 10,  # Fixed
    }
    
    logger.info(f"✅ All context gathered successfully (includes {len(live_search_data)} live search results)")
    return combined_context


def map_model_name_to_fal_id(model_name: str) -> str:
    """Map project configuration model names to Fal.ai model IDs"""
    model_mapping = {
        'seedream': 'fal-ai/bytedance/seedream/v4/edit',
        'nano-banana': 'fal-ai/nano-banana/edit',
        'flux-pro-kontext': 'fal-ai/flux-pro/kontext'
    }
    return model_mapping.get(model_name, 'fal-ai/bytedance/seedream/v4/edit')


async def create_initial_generation_record(project_id: int, job_id: str, context: Dict, session_cookie: Optional[str] = None) -> bool:
    """Create initial database record for generation tracking"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        db_data = {
            "project_id": project_id,
            "uuid": str(uuid.uuid4()),
            "job_id": job_id,
            "workflow_type": "daily_posts",
            "content_type": "mixed",
            "status": "generating",
            "progress_percent": 0,
            "progress_message": "Starting generation...",
            "image_model": context.get('image_model'),
            "video_model": context.get('video_model'),
            "clip_duration": context.get('clip_duration'),
            "generated_image_urls": [],
            "generated_video_urls": [],
            "per_image_metadata": {},
            "per_video_metadata": {},
            "workflow_metadata": {
                "content_mix": context.get('content_mix'),
                "project_name": context.get('project_name'),
                "video_image_index": context.get('video_image_index'),  # Track which post index has video
            }
        }
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content",
                headers=headers,
                json=db_data,
                timeout=30.0
            )
            
            if response.status_code in [201, 200]:
                logger.info(f"✅ Initial generation record created: {job_id}")
                return True
            else:
                logger.error(f"❌ Failed to create initial record: {response.status_code} - {response.text}")
                return False
                
    except Exception as e:
        logger.error(f"❌ Error creating initial generation record: {str(e)}")
        return False


async def update_progress_in_db(project_id: int, job_id: str, progress_percent: int, progress_message: str, session_cookie: Optional[str] = None):
    """Update progress in database"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/progress",
                headers=headers,
                json={
                    "progress_percent": progress_percent,
                    "progress_message": progress_message
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.warning(f"⚠️ Failed to update progress: {response.status_code}")
                
    except Exception as e:
        logger.warning(f"⚠️ Error updating progress: {str(e)}")


# ============================================
# MAIN GENERATION PIPELINE
# ============================================

async def run_generation_pipeline(job_id: str, request: ProjectUnifiedGenerationRequest):
    """
    Run the complete generation pipeline with progress updates
    """
    try:
        project_id = request.project_id
        
        # Step 1: Gather ALL context FIRST (including live search for links, document decay, etc.)
        # This is where ALL context gathering happens, including Grok live search calls for links
        session_cookie = request.session_cookie
        await update_progress_in_db(project_id, job_id, 10, "Gathering context (including live search for links)...", session_cookie)
        context = await gather_all_context(project_id, session_cookie)
        logger.info(f"✅ Context gathering complete. Ready to generate prompts with all context.")
        
        # Get total number of posts for random selection
        content_mix = context.get('content_mix', {'shitpost': 4, 'threads': 4, 'longpost': 2})
        total_posts = sum([content_mix.get('threads', 4), content_mix.get('shitpost', 4), content_mix.get('longpost', 2)])
        
        # Step 1.5: Randomly select index for video generation (only if total_posts > 1)
        # If only 1 post is desired, no video generation (only image and tweet text)
        if total_posts > 1:
            video_image_index = random.randint(1, total_posts)
            context['video_image_index'] = video_image_index
            context['number_of_clips'] = NUMBER_OF_CLIPS
            context['clip_duration'] = CLIP_DURATION
            # Video generation flags for web3 projects
            context['no_characters'] = True
            context['web3_characters'] = False
            context['human_characters_only'] = False
            logger.info(f"🎲 Randomly selected image index {video_image_index} for video generation (out of {total_posts} posts)")
        else:
            # Skip video generation for single post
            context['video_image_index'] = None
            logger.info(f"📋 Total posts is {total_posts} - skipping video generation (only image and tweet text will be generated)")
        
        # LOG CONTEXT BEFORE GROK
        print("=" * 80)
        print("📋 CONTEXT GATHERED FOR GROK")
        print("=" * 80)
        print(f"🏢 Project ID: {project_id}")
        print(f"🏢 Project Name: {context.get('project_name')}")
        print(f"🏢 Chain: {context.get('chain')}")
        print(f"🏢 Token Symbol: {context.get('token_symbol')}")
        print(f"🏢 Tone: {context.get('tone')}")
        print(f"🏢 Color Palette: {context.get('color_palette')}")
        print(f"🏢 Documents (after decay): {len(context.get('documents_text', []))}")
        print(f"🏢 Links: {len(context.get('links', []))}")
        print(f"🏢 Live Search Data: {len(context.get('live_search_data', {}))}")
        print(f"🏢 Content Mix: {context.get('content_mix')}")
        print(f"🏢 Total Posts: {total_posts}")
        print(f"🏢 Image Model: {context.get('image_model')}")
        video_image_index = context.get('video_image_index')
        if video_image_index:
            print(f"🎲 Video Image Index: {video_image_index} (will generate {NUMBER_OF_CLIPS} clips)")
        else:
            print(f"🎲 Video Generation: Skipped (total_posts={total_posts}, video only generated when > 1 post)")
        print("=" * 80)
        
        # Step 2: Generate prompts with Grok (30%)
        # This is a SINGLE Grok call that uses ALL the pre-gathered context (including live_search_data)
        # No additional Grok calls are made here - all context is already gathered
        await update_progress_in_db(project_id, job_id, 30, "Generating prompts with Grok (using pre-gathered context)...", session_cookie)
        prompts = await generate_prompts(context)
        
        # Log parsed prompts (already logged raw output in generate_prompts)
        logger.info(f"✅ Successfully parsed {len(prompts)} prompt keys from Grok response")
        
        # Step 3: Generate all main images (50-90%)
        await update_progress_in_db(project_id, job_id, 50, "Generating images...", session_cookie)
        await generate_images(project_id, job_id, prompts, context, session_cookie)
        
        # Step 4: Generate additional images for video clips (if needed)
        video_image_index = context.get('video_image_index')
        if video_image_index:
            await update_progress_in_db(project_id, job_id, 90, "Generating additional images for video clips...", session_cookie)
            await generate_additional_images_for_clips(project_id, job_id, prompts, context, video_image_index, session_cookie)
        
        # Step 5: Generate video clips (after all images are complete)
        # Progress should NOT reach 100% until video is generated
        if video_image_index:
            await update_progress_in_db(project_id, job_id, 92, "Generating video clips...", session_cookie)
            await generate_video_clips(project_id, job_id, prompts, context, video_image_index, session_cookie)
            # Video generation complete - now can mark as 100%
            await update_progress_in_db(project_id, job_id, 100, "Generation completed!", session_cookie)
        else:
            # No video generation needed - mark as complete after images
            await update_progress_in_db(project_id, job_id, 100, "Generation completed!", session_cookie)
        
        # Update status to completed
        try:
            typescript_backend_url = settings.typescript_backend_url
            headers = {}
            if session_cookie:
                headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
            async with httpx.AsyncClient() as client:
                await client.put(
                    f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/progress",
                    headers=headers,
                    json={
                        "progress_percent": 100,
                        "progress_message": "Generation completed!",
                        "status": "completed"
                    },
                    timeout=10.0
                )
        except Exception as e:
            logger.warning(f"⚠️ Failed to update final status: {str(e)}")
        
        logger.info(f"✅ Generation completed for job {job_id}")
        
    except Exception as e:
        logger.error(f"❌ Error in generation pipeline: {str(e)}")
        session_cookie = request.session_cookie if hasattr(request, 'session_cookie') else None
        await update_progress_in_db(project_id, job_id, 0, f"Error: {str(e)}", session_cookie)
        raise


async def generate_prompts(context: Dict) -> Dict:
    """
    Generate all prompts using Grok in ONE call: 10 tweet texts, 10 image prompts, 3 clip prompts.
    
    NOTE: All context gathering (including live search for links) has already been completed
    in gather_all_context(). This function only uses the already-gathered context.
    """
    try:
        # Import Grok SDK (following web2 GrokPromptService and crew_ai_service patterns)
        from xai_sdk import Client
        from xai_sdk.chat import user, system
        
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            raise ValueError("XAI_API_KEY not found")
        
        # Create Grok client (matching web2 GrokPromptService and crew_ai_service patterns)
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # Create chat WITHOUT live search - we've already fetched all context using live search
        # The live_search_data is already included in the context passed to this function
        # (matching web2 GrokPromptService pattern when use_live_search=False)
        chat = client.chat.create(model="grok-4-latest")
        
        logger.info("📝 Using pre-gathered context (live_search_data already included)")
        
        # Get content mix
        content_mix = context.get('content_mix', {'shitpost': 4, 'threads': 4, 'longpost': 2})
        num_threads = content_mix.get('threads', 4)
        num_shitposts = content_mix.get('shitpost', 4)
        num_longposts = content_mix.get('longpost', 2)
        
        # Build project context string
        project_context = build_project_context_string(context)
        
        # Build system prompt
        system_prompt = """You are a WORLD-CLASS CREATIVE DIRECTOR specializing in Web3 project content creation.
You respond ONLY with valid JSON objects, no extra text or formatting.
Every prompt you generate must be professional, engaging, and optimized for Twitter/X.
You will generate tweet texts in the style of popular crypto Twitter handles (randomly selected).
Image prompts must incorporate the project's color palette and align perfectly with tweet texts.
Clip prompts must intelligently select which images would work best as videos for maximum Twitter engagement."""
        
        # Build user prompt with all context
        user_prompt = build_grok_prompt_for_projects(context, content_mix)
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        # LOG ALL PROMPT INSTRUCTIONS GIVEN TO GROK
        print("=" * 80)
        print("📋 COMPREHENSIVE PROMPT INSTRUCTIONS GIVEN TO GROK")
        print("=" * 80)
        print(f"📝 SYSTEM PROMPT:")
        print(system_prompt)
        print("\n" + "=" * 80)
        print(f"📝 USER PROMPT (first 2000 chars):")
        print(user_prompt[:2000])
        print("\n" + "=" * 80)
        print(f"📝 FULL USER PROMPT LENGTH: {len(user_prompt)} characters")
        print("=" * 80)
        
        # Get response
        response = chat.sample()
        response_text = response.content.strip()
        
        # LOG GROK OUTPUT (ONCE)
        print("=" * 80)
        print("🤖 GROK RAW OUTPUT")
        print("=" * 80)
        print(response_text)
        print("=" * 80)
        
        # Parse JSON (handle markdown code blocks)
        json_content = extract_json_from_response(response_text)
        prompts = json.loads(json_content)
        
        logger.info(f"✅ Generated prompts with Grok: {len(prompts)} keys")
        return prompts
        
    except Exception as e:
        logger.error(f"❌ Error generating prompts: {str(e)}")
        raise


def extract_json_from_response(response_text: str) -> str:
    """Extract JSON from Grok response, handling markdown code blocks"""
    # Try to find JSON between ```json and ```
    if "```json" in response_text:
        json_start = response_text.find("```json") + 7
        json_end = response_text.find("```", json_start)
        json_content = response_text[json_start:json_end].strip()
    # Try plain ``` blocks
    elif "```" in response_text:
        json_start = response_text.find("```") + 3
        json_end = response_text.find("```", json_start)
        json_content = response_text[json_start:json_end].strip()
    # Direct JSON
    elif response_text.startswith("{") and response_text.endswith("}"):
        json_content = response_text
    else:
        # Try to find JSON boundaries
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}") + 1
        if start_idx != -1 and end_idx > start_idx:
            json_content = response_text[start_idx:end_idx]
        else:
            raise ValueError("No valid JSON found in Grok response")
    
    return json_content


def build_project_context_string(context: Dict) -> str:
    """Build comprehensive project context string for Grok"""
    parts = []
    
    # Add today's date for temporal context (help determine if events are past or future)
    today_date = datetime.now().strftime('%Y-%m-%d')
    today_readable = datetime.now().strftime('%B %d, %Y')
    parts.append(f"=== TEMPORAL CONTEXT ===")
    parts.append(f"TODAY'S DATE: {today_date} ({today_readable})")
    parts.append(f"Use this date to determine if events mentioned in documents/context are PAST (already happened) or FUTURE (upcoming)")
    parts.append(f"Documents may contain old information where dates that are now PAST were referred to as FUTURE at document creation time")
    parts.append(f"=== END TEMPORAL CONTEXT ===\n")
    
    # Basic project info
    project_name = context.get('project_name', 'Project')
    has_chain = context.get('chain') and context.get('chain').strip()
    has_token = context.get('token_symbol') and context.get('token_symbol').strip()
    is_web3_project = has_chain or has_token
    
    # Determine project type label
    project_type_label = "Web3 Project" if is_web3_project else "Product/Service"
    parts.append(f"PROJECT: {project_name} ({project_type_label})")
    
    if context.get('website'):
        parts.append(f"Website: {context.get('website')}")
    
    # Only include chain and token if they exist
    if has_chain:
        parts.append(f"Chain/Network: {context.get('chain')}")
    else:
        parts.append(f"Chain/Network: Not specified (pre-launch or non-blockchain product)")
    
    if has_token:
        parts.append(f"Token Symbol: {context.get('token_symbol')}")
    else:
        parts.append(f"Token Symbol: Not specified (pre-launch or non-token product)")
    
    if context.get('tone'):
        parts.append(f"Tone: {context.get('tone')}")
    if context.get('category'):
        parts.append(f"Category: {context.get('category')}")
    
    # Brand values
    if context.get('brand_values'):
        parts.append(f"\nBrand Values:\n{context.get('brand_values')}")
    
    # Color palette
    color_palette = context.get('color_palette', {})
    if color_palette:
        parts.append(f"\nColor Palette:")
        if color_palette.get('primary'):
            parts.append(f"  Primary: {color_palette.get('primary')}")
        if color_palette.get('secondary'):
            parts.append(f"  Secondary: {color_palette.get('secondary')}")
        if color_palette.get('accent'):
            parts.append(f"  Accent: {color_palette.get('accent')}")
    
    # Keywords, competitors, goals
    if context.get('keywords'):
        parts.append(f"\nKeywords: {context.get('keywords')}")
    if context.get('competitors'):
        parts.append(f"Competitors: {context.get('competitors')}")
    if context.get('goals'):
        parts.append(f"Goals: {context.get('goals')}")
    
    # Documents (with timestamps and freshness instructions)
    documents = context.get('documents_text', [])
    if documents:
        parts.append(f"\n=== DOCUMENT CONTEXT (with upload timestamps) ===")
        parts.append(f"⚠️ IMPORTANT: Documents older than 30 days have been excluded (time decay applied).")
        parts.append(f"⚠️ PRIORITIZE information from recent documents (check timestamps).")
        for i, doc in enumerate(documents, 1):
            timestamp = doc.get('timestamp', 'Unknown')
            text = doc.get('text', '')[:500]  # Limit text length
            name = doc.get('name', f'Document {i}')
            parts.append(f"  [{timestamp}] {name}: {text}...")
        parts.append(f"=== END DOCUMENT CONTEXT ===")
    
    # Live search data (from links and Twitter handles)
    live_data = context.get('live_search_data', {})
    if live_data:
        parts.append(f"\n=== FRESH CONTEXT FROM LIVE SEARCH (Last 10 Days) ===")
        
        # Web context from links (project info, competitor analysis, industry studies)
        web_context = live_data.get('web_context', {})
        if web_context:
            parts.append(f"\n📎 Website/Link Context:")
            for website, summary in web_context.items():
                parts.append(f"  • {website}:")
                parts.append(f"    {summary}")
        
        # Twitter context from handles (project mentions, industry trends, category discussions)
        twitter_context = live_data.get('twitter_context', {})
        if twitter_context:
            parts.append(f"\n🐦 Twitter/X Handle Context:")
            for handle, summary in twitter_context.items():
                parts.append(f"  • {handle}:")
                parts.append(f"    {summary}")
        
        # Combined insights (overall patterns from all sources)
        combined_insights = live_data.get('combined_insights')
        if combined_insights:
            parts.append(f"\n💡 Combined Insights from All Sources:")
            parts.append(f"  {combined_insights}")
        
        parts.append(f"\n=== END LIVE SEARCH CONTEXT ===")
    
    # Additional context
    if context.get('details_text'):
        parts.append(f"\nDetails: {context.get('details_text')}")
    if context.get('content_text'):
        parts.append(f"\nContent: {context.get('content_text')}")
    
    return "\n".join(parts)


def get_category_specific_guidance(category: str, post_type: str) -> str:
    """Get category-specific visual guidance based on CrewAI patterns"""
    if not category:
        return ""
    
    category_key = category.lower().strip()
    category_guidance = {
        "defi": {
            "recommended_styles": "Data-Driven (primary for stats focus), Professional (for trust)",
            "thread": "Combine Professional and Data-Driven for sequential data panels; include numbered text overlays",
            "shitpost": "Use Meme/Comic style with crypto characters (Wojak checking yields, Pepe celebrating gains); focus on relatable DeFi scenarios",
            "longpost": "Use Data-Driven with detailed charts (e.g., yield trends) to educate; overlay text with key metrics"
        },
        "nft": {
            "recommended_styles": "Minimalist (primary for art focus), Meme (for virality)",
            "thread": "Blend Minimalist and Meme for a narrative art series; include text with story cues",
            "shitpost": "Use Meme/Comic style with popular characters (Drake choosing NFTs, Expanding Brain meme about digital ownership); make NFT scenarios relatable and funny",
            "longpost": "Use Minimalist with a single elegant artwork; overlay text with mint details"
        },
        "gaming": {
            "recommended_styles": "Tech (primary for innovation), Meme (for engagement)",
            "thread": "Mix Tech and Meme for a gameplay walkthrough; include text with step markers",
            "shitpost": "Use Meme/Comic style with gaming characters (Chad gamer, Wojak losing, Pepe winning); create relatable gaming scenarios and reactions",
            "longpost": "Use Tech with modern gameplay visuals; overlay text with feature highlights"
        },
        "metaverse": {
            "recommended_styles": "Tech (primary for immersion), Hype (for events)",
            "thread": "Combine Tech and Hype for a world-building series; include text with progression",
            "shitpost": "Opt for Hype with explosive event visuals; add text like 'Drop live!'",
            "longpost": "Use Tech with a detailed world view; overlay text with exploration invites"
        },
        "dao": {
            "recommended_styles": "Warm (primary for community), Professional (for governance)",
            "thread": "Blend Warm and Professional for governance steps; include text with guides",
            "shitpost": "Go for Meme with DAO humor; add text like 'Vote or GTFO!'",
            "longpost": "Use Warm with community scenes; overlay text with voting calls"
        },
        "infrastructure": {
            "recommended_styles": "Tech (primary for innovation), Data-Driven (for reliability)",
            "thread": "Combine Data-Driven and Tech for a tech breakdown; include text with data points",
            "shitpost": "Opt for Hype with bold infra claims; add text like 'Unbreakable!'",
            "longpost": "Use Tech with network visuals; overlay text with tech specs"
        },
        "layer 1": {
            "recommended_styles": "Hype (primary for launches), Tech (for tech stack)",
            "thread": "Mix Hype and Tech for a launch series; include text with hype builds",
            "shitpost": "Go for Hype with launch explosions; add text like 'To the moon!'",
            "longpost": "Use Tech with blockchain visuals; overlay text with performance details"
        },
        "layer 2": {
            "recommended_styles": "Data-Driven (primary for efficiency), Tech (for rollups)",
            "thread": "Combine Tech and Data-Driven for a rollup guide; include text with steps",
            "shitpost": "Opt for Hype with rollup memes; add text like 'Gas free LOL!'",
            "longpost": "Use Data-Driven with gas savings charts; overlay text with stats"
        },
        "trading": {
            "recommended_styles": "Data-Driven (primary for charts), Hype (for pumps)",
            "thread": "Mix Data-Driven and Hype for a trade series; include text with signals",
            "shitpost": "Go for Hype with bullish visuals; add text like 'Pump it!'",
            "longpost": "Use Data-Driven with trade signals; overlay text with analysis"
        },
        "meme coins": {
            "recommended_styles": "Meme (primary for virality), Hype (for pumps)",
            "thread": "Combine Meme and Hype for a pump series; include text with hype",
            "shitpost": "Use Meme/Comic style with classic meme characters (Doge, Pepe, Stonks Man celebrating gains); create authentic meme coin scenarios",
            "longpost": "Use Meme with a detailed meme story; overlay text with token lore"
        },
        "socialfi": {
            "recommended_styles": "Warm (primary for community), Meme (for engagement)",
            "thread": "Blend Warm and Meme for a social guide; include text with steps",
            "shitpost": "Go for Meme with social humor; add text like 'Chat wins!'",
            "longpost": "Use Warm with social scenes; overlay text with community invites"
        },
        "ai & crypto": {
            "recommended_styles": "Tech (primary for innovation), Data-Driven (for ROI)",
            "thread": "Combine Data-Driven and Tech for an AI breakdown; include text with data",
            "shitpost": "Opt for Hype with AI hype; add text like 'AI to 1M!'",
            "longpost": "Use Tech with AI visuals; overlay text with feature details"
        },
        "real world assets": {
            "recommended_styles": "Professional (primary for trust), Data-Driven (for value)",
            "thread": "Combine Data-Driven and Professional for a value series; include text with metrics",
            "shitpost": "Opt for Hype with asset pumps; add text like 'Rich AF!'",
            "longpost": "Use Professional with asset visuals; overlay text with value stats"
        },
        "prediction markets": {
            "recommended_styles": "Hype (primary for bets), Data-Driven (for odds)",
            "thread": "Mix Hype and Data-Driven for a market series; include text with odds",
            "shitpost": "Go for Hype with betting memes; add text like 'Bet big!'",
            "longpost": "Use Data-Driven with odds charts; overlay text with bet details"
        },
        "privacy": {
            "recommended_styles": "Minimalist (primary for trust), Tech (for proofs)",
            "thread": "Blend Tech and Minimalist for a proof guide; include text with steps",
            "shitpost": "Opt for Meme with privacy humor; add text like 'Hide LOL!'",
            "longpost": "Use Minimalist with security visuals; overlay text with privacy features"
        },
        "cross chain": {
            "recommended_styles": "Tech (primary for bridges), Data-Driven (for efficiency)",
            "thread": "Combine Data-Driven and Tech for a bridge series; include text with stats",
            "shitpost": "Opt for Hype with cross-chain memes; add text like 'Cross it!'",
            "longpost": "Use Tech with bridge visuals; overlay text with connectivity details"
        },
        "yield farming": {
            "recommended_styles": "Data-Driven (primary for yields), Hype (for farms)",
            "thread": "Mix Data-Driven and Hype for a farm guide; include text with yields",
            "shitpost": "Go for Hype with farm explosions; add text like 'Farm it!'",
            "longpost": "Use Data-Driven with yield charts; overlay text with APY stats"
        },
        "liquid staking": {
            "recommended_styles": "Professional (primary for trust), Data-Driven (for rewards)",
            "thread": "Combine Data-Driven and Professional for a staking series; include text with returns",
            "shitpost": "Opt for Hype with staking memes; add text like 'Stake rich!'",
            "longpost": "Use Professional with staking visuals; overlay text with reward details"
        },
        "derivatives": {
            "recommended_styles": "Data-Driven (primary for trades), Hype (for leverage)",
            "thread": "Mix Data-Driven and Hype for a trade series; include text with signals",
            "shitpost": "Go for Hype with deriv memes; add text like '10x LOL!'",
            "longpost": "Use Data-Driven with trade charts; overlay text with leverage stats"
        },
        "payments": {
            "recommended_styles": "Professional (primary for trust), Minimalist (for simplicity)",
            "thread": "Blend Minimalist and Professional for a payment guide; include text with steps",
            "shitpost": "Opt for Meme with payment humor; add text like 'Pay fast LOL!'",
            "longpost": "Use Professional with payment visuals; overlay text with tx details"
        },
        "identity": {
            "recommended_styles": "Minimalist (primary for recognition), Tech (for innovation)",
            "thread": "Blend Tech and Minimalist for an ID series; include text with features",
            "shitpost": "Opt for Meme with ID humor; add text like 'ID flex!'",
            "longpost": "Use Minimalist with ID visuals; overlay text with claim details"
        },
        "security": {
            "recommended_styles": "Minimalist (primary for attention), Data-Driven (for safety)",
            "thread": "Combine Minimalist and Data-Driven for a security guide; include text with metrics",
            "shitpost": "Opt for Hype with security memes; add text like 'Safe AF!'",
            "longpost": "Use Data-Driven with security stats; overlay text with safety details"
        },
        "tools": {
            "recommended_styles": "Tech (primary for features), Minimalist (for adoption)",
            "thread": "Blend Tech and Minimalist for a tool series; include text with steps",
            "shitpost": "Opt for Meme with tool humor; add text like 'Tool time!'",
            "longpost": "Use Tech with tool visuals; overlay text with feature highlights"
        },
        "analytics": {
            "recommended_styles": "Data-Driven (primary for insights), Professional (for authority)",
            "thread": "Combine Professional and Data-Driven for an analytics series; include text with data points",
            "shitpost": "Opt for Hype with data memes; add text like 'Data wins!'",
            "longpost": "Use Data-Driven with analytics charts; overlay text with insights"
        },
        "education": {
            "recommended_styles": "Warm (primary for engagement), Professional (for clarity)",
            "thread": "Blend Warm and Professional for a learning series; include text with lessons",
            "shitpost": "Opt for Meme with edu humor; add text like 'Learn LOL!'",
            "longpost": "Use Warm with educational visuals; overlay text with learning invites"
        },
        "other": {
            "recommended_styles": "Hype (primary for trends), Minimalist (for focus)",
            "thread": "Combine Hype and Minimalist for a trend series; include text with hooks",
            "shitpost": "Go for Hype with macro memes; add text like 'Trend AF!'",
            "longpost": "Use Minimalist with trend visuals; overlay text with insight invites"
        }
    }
    
    guidance = category_guidance.get(category_key, {})
    if not guidance:
        return ""
    
    post_guidance = guidance.get(post_type.lower(), "")
    recommended = guidance.get("recommended_styles", "")
    
    if not post_guidance:
        return f"**Category ({category_key.upper()}):** Recommended styles: {recommended}\n" if recommended else ""
    
    return f"""**CATEGORY-SPECIFIC GUIDANCE** ({category_key.upper()}):
- **Recommended Styles**: {recommended}
- **{post_type.upper()} Guidance**: {post_guidance}"""


def _get_image_character_instructions(no_characters: bool, human_characters_only: bool, web3_characters: bool) -> str:
    """Generate character instructions for IMAGE PROMPTS based on flags."""
    if no_characters:
        return """      - **CRITICAL: NO CHARACTERS REQUIREMENT**:
        * Do NOT include any human characters, meme characters, or animated characters in image prompts
        * Focus on product showcases, abstract visuals, data visualizations, landscapes, objects, and environments
        * Pure product/service presentation without character elements
        * If the visual concept requires characters for narrative, create character-free alternatives
        * Emphasize products, technology, environments, and brand elements instead"""

    elif human_characters_only:
        return """      - **CRITICAL: HUMAN CHARACTERS ONLY**:
        * Use ONLY human characters throughout the entire image
        * NO MEME CHARACTERS: Do not use comic, cartoon, or meme-style characters
        * PROFESSIONAL HUMANS: Use diverse, realistic human characters that represent the target audience
        * REALISTIC PORTRAYAL: Focus on authentic human experiences and relatable scenarios"""

    elif web3_characters:
        return """      - **CRITICAL: WEB3 CHARACTER OPTION**:
        * You have FULL AUTONOMY to decide whether to include characters or not based on what best serves the brand story
        * IF you decide characters would enhance the story, you may use popular Web3/crypto meme characters such as Pepe, Wojak, Chad, HODL guy, Diamond Hands, Paper Hands, Moon boy, Ape characters, Doge, Shiba Inu, etc.
        * BUT you are NOT limited to these examples - feel free to create or use ANY Web3/crypto-themed characters
        * PURE PRODUCT OPTION: You may also choose to focus entirely on products, technology, or brand elements without any characters if that tells a better story
        * NARRATIVE-FIRST APPROACH: Let the brand message guide your decision"""

    else:
        return """      - **OPTIONAL CHARACTER INTEGRATION** (Use ONLY when genuinely relevant):
        * You have creative freedom to include characters if they enhance the message
        * Web2 Examples: Drake, Distracted Boyfriend, Woman Yelling at Cat, This is Fine Dog, Expanding Brain, Stonks Man, Chad Yes
        * Web3/Crypto Examples: Pepe (various emotions), Wojak (FOMO/anxiety), Chad Crypto Trader, Bobo (bear market), Apu Apustaja (cute/helpful)
        * **CHARACTER GUIDELINES**: Only include if they genuinely add value; better no characters than forced ones
        * You may also focus entirely on products, services, or brand elements without any characters"""


def _get_character_instructions(no_characters: bool, human_characters_only: bool, web3_characters: bool) -> str:
    """Generate character instructions for CLIP PROMPTS based on no_characters, human_characters_only, and web3_characters flags."""
    if no_characters:
        return f"""🎭 CHARACTER CONTINUITY (NO NEW CHARACTERS - MAINTAIN EXISTING):
- CHARACTER CONTINUITY REQUIREMENT: If the initial image contains characters, you MUST maintain those same characters throughout all frames for visual continuity
- NO NEW CHARACTERS: Do NOT introduce any additional characters beyond what exists in the initial image/prompt
- EXISTING CHARACTER PRESERVATION: Keep any characters that are already established in the initial image - they are part of the established visual narrative
- CONSISTENT CHARACTER PORTRAYAL: If initial characters exist, maintain their appearance, style, and role throughout the video
- PRODUCT-FOCUSED EXPANSION: When adding new visual elements, focus on products, technology, environments, and brand elements rather than new characters
- NARRATIVE CONTINUITY: Use existing characters (if any) to tell the brand story, but don't add new ones
- VISUAL CONSISTENCY: Maintain the same character count and types as established in the initial image
- BRAND-CENTRIC ADDITIONS: Any new elements should be products, services, technology, or environmental features that support the brand message
- CHARACTER STABILITY: If the initial image has no characters, maintain that character-free approach throughout
- CONTINUITY OVER EXPANSION: Prioritize visual continuity and consistency over character variety or expansion"""

    elif human_characters_only:
        return f"""🎭 CHARACTER REQUIREMENTS (HUMAN CHARACTERS ONLY):
- MANDATORY: Use ONLY human characters throughout the entire video
- NO MEME CHARACTERS: Do not use comic, cartoon, or meme-style characters
- PROFESSIONAL HUMANS: Use diverse, realistic human characters that represent the target audience
- HUMAN INTERACTIONS: Show realistic human emotions, expressions, and interactions
- CHARACTER CONSISTENCY: Maintain the same human characters throughout the video for continuity
- REALISTIC PORTRAYAL: Focus on authentic human experiences and relatable scenarios"""

    elif web3_characters:
        return f"""🎭 CHARACTER AUTONOMY (WEB3 MEME OPTION):
- COMPLETE CREATIVE AUTONOMY: You have FULL AUTONOMY to decide whether to include characters or not based on what best serves the brand story
- CHARACTER DECISION FREEDOM: You may choose to include 0, 1, 2, or N characters - or focus purely on products if that creates better brand impact
- INITIAL IMAGE INDEPENDENCE: You are NOT required to add characters just because the initial image has them, nor avoid them if the initial image lacks them
- WEB3 CHARACTER EXAMPLES (NOT RESTRICTIONS): IF you decide characters would enhance the story, you may use popular Web3/crypto meme characters such as Pepe, Wojak, Chad, HODL guy, Diamond Hands, Paper Hands, Moon boy, Ape characters, Doge, Shiba Inu, etc. - BUT you are NOT limited to these examples. Feel free to create or use ANY Web3/crypto-themed characters that resonate with the community and serve the brand narrative
- STYLE FLEXIBILITY: IF characters are used, they can be in any style (realistic, comic, or mixed) - you decide what works best for the brand narrative
- PURE PRODUCT OPTION: You may also choose to focus entirely on products, technology, or brand elements without any characters if that tells a better story
- NARRATIVE-FIRST APPROACH: Let the brand message guide your decision - characters should only be included if they genuinely enhance the brand story
- CREATIVE FREEDOM: These examples are INSPIRATION, NOT requirements - generate the most effective content for the brand, with or without characters, using any character types you envision"""

    else:
        return f"""🎭 CHARACTER AUTONOMY (UNLIMITED CREATIVE OPTION):
- MAXIMUM CREATIVE AUTONOMY: You have COMPLETE FREEDOM to decide whether characters would enhance the brand story or if a character-free approach works better
- CHARACTER DECISION INDEPENDENCE: You may choose to include 0, 1, 2, or N characters - or focus purely on products/brand elements if that creates more impact
- INITIAL IMAGE INDEPENDENCE: You are NOT bound by the initial image - add characters if they enhance the story, keep existing ones if they work, or remove them if pure product focus is better
- UNLIMITED CHARACTER OPTIONS: IF you decide characters would enhance the story, choose from ANY character types that serve the brand narrative
- PURE PRODUCT OPTION: You may also choose to focus entirely on products, services, or brand elements without any characters if that creates a more compelling brand story
- COMIC FORM PREFERENCE: IF non-human characters are used, prefer comic/cartoon style over photorealistic
- NARRATIVE-FIRST APPROACH: Let the brand message guide your decision - characters should only be included if they genuinely enhance the brand story and engagement
- CREATIVE GUIDELINES: These are creative options and inspiration, NOT rigid requirements - generate the most effective content for the brand, with or without characters
- BRAND-FIRST DECISION: Always prioritize what serves the brand message best, whether that's character-driven storytelling or pure product showcase"""


def _build_clip_prompts_section(video_image_index: Optional[int], number_of_clips: int, voiceover: bool = False, 
                                  no_characters: bool = False, human_characters_only: bool = False, 
                                  web3_characters: bool = False) -> str:
    """Build the clip prompts section for Grok prompt"""
    if not video_image_index:
        return '3. **NO CLIP PROMPTS NEEDED** (no video generation requested):'
    
    clip_2_section = ''
    audio_prompts_section = ''
    voiceover_prompts_section = ''
    
    # Get character control instructions dynamically based on flags
    character_instructions = _get_character_instructions(no_characters, human_characters_only, web3_characters)
    
    if number_of_clips > 1:
        clip_2_section = f''' (and additional clips if number_of_clips > 2):
     * Generate `image_prompt_{video_image_index}_2` - a NEW image prompt for the starting frame of clip 2
     * This image should visually connect to the previous clip while advancing the narrative
     * Include color palette integration in the image prompt
     * Generate `clip_prompt_{video_image_index}_2` - motion description for the second 10-second clip
     * For clip 3: Generate `image_prompt_{video_image_index}_3` and `clip_prompt_{video_image_index}_3`, and so on'''
    
    # Audio prompts: Generate single_audio_prompt for entire video (ALWAYS generate - required for Pixverse audio)
    audio_prompts_section = f'''
   - **AUDIO PROMPT** (MANDATORY - always generate):
     * Generate `single_audio_prompt` - Create a continuous background music composition for the entire {number_of_clips * 10}-second video
     * Focus ONLY on music: instrumental arrangements, musical progression, tempo, mood, and atmospheric musical elements that build throughout the video
     * Create a cohesive musical theme that flows seamlessly from beginning to end
     * Include appropriate ending effects for cinematic finish (fade-out for subtle endings, crescendo for dramatic scenes)
     * NO sound effects, footsteps, car sounds, or environmental noises - ONLY MUSIC
     * Duration: {number_of_clips * 10} seconds'''
    
    # Voiceover prompts: Only generate if voiceover flag is True
    if voiceover:
        voiceover_prompts_section = f'''
   - **VOICEOVER PROMPTS** (generate ONLY if voiceover is enabled - one for each clip):
     * Generate `voiceover_{1}_prompt`, `voiceover_{2}_prompt`, etc. up to `voiceover_{number_of_clips}_prompt`
     * Break down the tweet text into each clip's portion with emotions, expressions, feelings, pauses, tone changes
     * Generate natural, flowing voiceover text
     * MUST START WITH [pause 1 second]
     * MAXIMUM 100 CHARACTERS (excluding [pause 1 second] marker)
     * NO HASHTAGS
     * Break down or modify the original text if needed to preserve the core message while staying within character limit
     * Each voiceover should flow naturally from the previous one'''
    else:
        voiceover_prompts_section = '''
   - **VOICEOVER PROMPTS**: NOT REQUIRED (voiceover is disabled)'''
    
    return f'''3. **CLIP PROMPTS FOR VIDEO GENERATION** (for image index {video_image_index}):
   - You will generate clip prompts for image index {video_image_index} to create a {number_of_clips}-clip video
   
{character_instructions}
   
   - **For Clip 1**:
     * Use the existing `image_prompt_{video_image_index}` as the starting frame
     * Generate `clip_prompt_{video_image_index}` that describes smooth, natural motion for a 10-second clip
     * The clip prompt should describe: camera movement, object animation, transitions, and engaging motion
     * Must align with the corresponding tweet text and image prompt
   - **For Clip 2{clip_2_section}
   - **Selection criteria**: Maximum visual impact, engaging motion potential, Twitter engagement
   - **Motion requirements**: Smooth, natural motion (camera movement, object animation, transitions), 10-second duration per clip
   - **Professional quality**: Shareable content that aligns with the corresponding tweet text and image prompts
   - IMPORTANT: Each clip prompt object MUST include the original image_prompt that it's based on{audio_prompts_section}{voiceover_prompts_section}
'''


def build_grok_prompt_for_projects(context: Dict, content_mix: Dict) -> str:
    """Build comprehensive Grok prompt for project daily posts generation"""
    num_threads = content_mix.get('threads', 4)
    num_shitposts = content_mix.get('shitpost', 4)
    num_longposts = content_mix.get('longpost', 2)
    
    project_context_str = build_project_context_string(context)
    color_palette = context.get('color_palette', {})
    
    # Get total number of posts from context (from config)
    total_posts = sum([num_threads, num_shitposts, num_longposts])
    
    # Get video image index from context (if available)
    video_image_index = context.get('video_image_index')
    number_of_clips = context.get('number_of_clips', NUMBER_OF_CLIPS)
    voiceover = context.get('voiceover', False)  # Default to False if not specified
    
    # Get character control flags from context
    no_characters = context.get('no_characters', False)
    human_characters_only = context.get('human_characters_only', False)
    web3_characters = context.get('web3_characters', False)
    
    # Build dynamic JSON example based on total_posts
    tweet_text_examples = ",\n  ".join([f'"tweet_text_{i}": {{"main_tweet": "...", "thread_array": [], "content_type": "thread|shitpost|longpost"}}' for i in range(1, total_posts + 1)])
    image_prompt_examples = ",\n  ".join([f'"image_prompt_{i}": "Detailed image generation prompt with color palette integration..."' for i in range(1, total_posts + 1)])
    
    # Build clip prompt examples based on video_image_index and number_of_clips
    clip_prompt_examples = []
    if video_image_index:
        # Clip 1: Uses existing image, needs clip prompt
        clip_prompt_examples.append(f'"clip_prompt_{video_image_index}": {{"image_index": {video_image_index}, "image_prompt": "Original image prompt for image {video_image_index}...", "clip_prompt": "Smooth motion description for first clip (10 seconds)...", "tweet_text_index": {video_image_index}}}')
        
        # Clips 2+: Need new image prompts and clip prompts
        for clip_num in range(2, number_of_clips + 1):
            clip_prompt_examples.append(f'"image_prompt_{video_image_index}_{clip_num}": "New image generation prompt for clip {clip_num} starting frame with color palette integration...",')
            clip_prompt_examples.append(f'"clip_prompt_{video_image_index}_{clip_num}": {{"image_index": {video_image_index}, "clip_number": {clip_num}, "image_prompt": "Original image prompt for image {video_image_index}_{clip_num}...", "clip_prompt": "Smooth motion description for clip {clip_num} (10 seconds)...", "tweet_text_index": {video_image_index}}}')
        
        # Add audio prompt example (ALWAYS include - mandatory)
        clip_prompt_examples.append(f'"single_audio_prompt": "Create a continuous background music composition for the entire {number_of_clips * 10}-second video that enhances the visual narrative. Focus ONLY on music: instrumental arrangements, musical progression, tempo, mood, and atmospheric musical elements that build throughout the video. NO sound effects, footsteps, car sounds, or environmental noises - ONLY MUSIC."')
        
        # Add voiceover prompt examples (ONLY if voiceover is enabled)
        if voiceover:
            for clip_num in range(1, number_of_clips + 1):
                clip_prompt_examples.append(f'"voiceover_{clip_num}_prompt": "[pause 1 second] Break down the tweet text into this clip portion with emotions, expressions, feelings. MAXIMUM 100 CHARACTERS. NO HASHTAGS."')
    
    clip_prompts_section = ",\n  ".join(clip_prompt_examples) if clip_prompt_examples else ""
    
    json_example = f"""{{
  {tweet_text_examples},
  
  {image_prompt_examples},
  
  {clip_prompts_section}
}}"""
    
    # Determine if this is a Web3 project or regular product
    has_chain = context.get('chain') and str(context.get('chain')).strip()
    has_token = context.get('token_symbol') and str(context.get('token_symbol')).strip()
    is_web3_project = bool(has_chain or has_token)
    
    project_type_instruction = "Web3 project" if is_web3_project else "product/service offering"
    web3_specific_instructions = """
- If chain and token symbol are provided: This is a Web3/blockchain project - incorporate blockchain terminology, token references, DeFi concepts, and Web3 culture naturally
- If chain and token symbol are NOT provided: This is a regular product/service - generate content as a standard market product offering without Web3/crypto/blockchain terminology
- NEVER assume blockchain/Web3 features if chain and token are not provided
- Use appropriate terminology based on what's available in the context""" if not is_web3_project else """
- This is a Web3/blockchain project - incorporate chain and token information naturally
- Use blockchain terminology, token references, DeFi concepts, and Web3 culture appropriately"""
    
    prompt = f"""Generate {total_posts} daily posts for a {project_type_instruction}. You must generate:

**CRITICAL: INTELLIGENT CONTEXT FUSION REQUIRED**
You have been provided with comprehensive context from multiple sources:
1. **Project Core Data**: Name, website, {f"chain, token symbol, " if is_web3_project else ""}tone, category, brand values, color palette
2. **Strategic Context**: Keywords, competitors, goals, details_text, content_text
3. **Document Context**: Uploaded documents with extracted text (prioritize recent documents)
4. **Live Search Context** (Last 10 Days):
   - **Website/Link Context**: Information from project links, competitor sites, industry studies
   - **Twitter/X Handle Context**: Recent discussions from handles about the project, industry trends, category happenings
   - **Combined Insights**: Overall patterns and trends from all live sources

**PROJECT TYPE AWARENESS**:
{web3_specific_instructions}

**YOUR TASK**: Intelligently fuse ALL this context to create compelling, relevant content:
- Extract key insights from live search data (websites + Twitter handles) - but NEVER mention that you're using "live search data" in the generated tweets
- Align project information with current industry trends and discussions - write naturally as if you organically know these trends
- Reference competitor information strategically (without copying) - but never say "according to competitor analysis" or similar
- Use recent document context to inform accurate details (prioritize documents with recent timestamps) - but never mention "documents" or "research" in the tweet text
- Incorporate brand values, tone, and color palette naturally
- Ensure tweet texts feel current and relevant (use live search data silently for freshness - never expose this usage in the content)
- **Write as if you naturally know all this information** - The tweet should never reveal that context, documents, or live search were used. It should read as authentic, organic content written by someone who simply knows these facts.

**CRITICAL: CONTENT VARIABILITY REQUIREMENT**
To ensure diverse and engaging content across all {total_posts} posts, you MUST vary the subcontexts you focus on:
- Use DIFFERENT combinations of context sources for each tweet/post
- Example variations:
  * Post 1: Focus on web_context (website insights) + recent documents + keywords
  * Post 2: Focus on twitter_context (X handle discussions) + competitors + goals
  * Post 3: Focus on combined_insights + brand_values + details_text
  * Post 4: Focus on documents_text (older but relevant) + live_search + content_text
  * And so on... mix and match creatively!
- This ensures each generated post feels unique and taps into different aspects of the provided context
- Generate image prompts that visually represent the fused context intelligently based on the specific subcontext chosen for each post

You must generate:

1. **{total_posts} TWEET TEXTS** (mix based on content_mix: {num_threads} threads, {num_shitposts} shitposts, {num_longposts} longposts):
   {"- Randomly select a different popular crypto Twitter handle style for EACH tweet" if is_web3_project else "- Use engaging Twitter content styles appropriate for product/service marketing"}
   {"- Generate tweet text in that handle's authentic style" if is_web3_project else "- Generate tweet text in authentic, engaging styles"}
   {f"- Incorporate blockchain/Web3 terminology and culture naturally (use chain: {context.get('chain')}, token: {context.get('token_symbol')})" if is_web3_project else "- Use standard product/service marketing language (NO blockchain/Web3/crypto terminology - this is a regular product offering)"}
   
   **CRITICAL CONTENT GENERATION RULES**:
   - **NEVER mention today's date** in tweet text or image prompts - Today's date is provided ONLY for your internal reference to determine if events are past/present/future
   - **NEVER mention context sources or data origins** - Absolutely DO NOT say:
     * "our context says..." or "according to our context..."
     * "live search data shows..." or "live search data says..."
     * "based on documents..." or "from Twitter handles..."
     * "the context indicates..." or "we found in our research..."
     * ANY reference to where information came from
   - **Generate naturally and intelligently** - Use the provided context silently and intelligently. Write as if you naturally know these facts. Never expose the fact that you're using context documents, live search data, or any data sources. The tweet should read as if written by someone who organically knows this information.
   - **NEVER mention word counts or character counts** - Don't say "this 2000-character post" or "this thread has 5 tweets" in the actual tweet text
   - **NEVER mention post type** - Don't say "this thread", "this longpost", "this shitpost" - just say "this post" or "here" or nothing at all
   - Generate authentic, natural content that flows organically without meta-commentary about sources, data gathering, or context usage
   
   - Follow post type requirements:
     * THREAD: main_tweet ≤240 chars, thread_array with 2-5 tweets (each ≤260 chars)
     * SHITPOST: main_tweet ≤260 chars, NO thread_array (empty array)
     * LONGPOST: main_tweet 8000-12000 chars (MARKDOWN format), NO thread_array (empty array)
   
   **CRITICAL DATE/TIME REQUIREMENTS**:
   - **TODAY'S DATE is provided in context ONLY for your internal reference** - Use it to determine if events are PAST or FUTURE
   - **NEVER mention today's date in the generated tweet text or image prompts** - It's purely for your analysis
   - Compare dates mentioned in documents/context with TODAY'S DATE to determine temporal status
   - Documents may contain old information where dates that are now PAST were referred to as FUTURE at the time
   - **Determining Past vs Future**:
     * If a document mentions "launching in Q1 2024" and today's date is after Q1 2024 → This is a PAST event (already happened)
     * If a document mentions "launching in Q1 2025" and today's date is before Q1 2025 → This is a FUTURE event (upcoming)
     * Always compare dates from context against TODAY'S DATE provided (but don't mention today's date in output)
   - For PLANNED/UPCOMING events: Use PRESENT or FUTURE dates only
   - For HISTORICAL events: Use EXACT dates from context (do NOT change past event dates to future)
   - Important distinction:
     * If context mentions a past event (e.g., "launched in Q4 2024", "announced in January 2024"):
       → Use the EXACT date from context (e.g., "launched in Q4 2024", "announced in January 2024")
       → Do NOT fabricate future dates for historical facts
     * If context mentions a future event (e.g., "launching soon", "coming Q1"):
       → Ensure the date is present or future (e.g., "Q1 2025", "Coming in 2025", "Launching next month")
       → Do NOT use past dates for planned/upcoming events
   - When mentioning quarters for FUTURE events: Use current quarter (Q1/Q2/Q3/Q4 2025) or future quarters only
   - When mentioning months for FUTURE events: Use current month or future months only
   - When mentioning years for FUTURE events: Use current year (2025) or future years only
   - Examples for FUTURE: "Q1 2025 launch", "Coming in 2025", "Launching next month" ✅
   - Examples for PAST (from context): "We launched in Q4 2024" ✅, "Announced in January 2024" ✅
   - NEVER: Use vague past references for planned events like "Last year", "Previous quarter", "Last month" ❌
   
2. **10 IMAGE PROMPTS** (one for each tweet):
   
   **AUTONOMOUS PROMPT GENERATION PROCESS** (CRITICAL):
   You are an AI visual expert who creates original, compelling prompts without relying on templates. Analyze tweet content and craft unique, high-impact visual prompts that perfectly complement the message.
   
   **STEP-BY-STEP PROCESS**:
   
   1. **Deep Content Analysis** (Post-Type Specific):
      - **FOR SHITPOST**: Analyze ONLY the main_tweet for humor, meme potential, and emotional expression
      - **FOR THREAD**: Analyze BOTH main_tweet AND complete thread_array to understand the full narrative
      - **FOR LONGPOST**: Analyze the comprehensive main_tweet (longpost content) thoroughly
      - Identify core emotions: excitement, urgency, community, innovation, FOMO, humor, etc.
      - Extract key concepts: project features, benefits, community aspects, timing, opportunities
      - Determine the primary message goal: inform, excite, create urgency, build community, etc.
      - **SHITPOST SPECIFIC**: Focus on meme potential, humor elements, relatable scenarios, and viral expressions
   
   2. **Intelligent Style Selection**:
      - Choose the most appropriate artistic style from the options below
      - **PRIORITIZE VARIETY**: Avoid repeating the same style across different posts
      - **SHITPOST STYLE PRIORITY**: For shitposts, prioritize Meme/Comic, Illustrated/Cartoon, or Pixel Art styles
      - **FULL STYLE FREEDOM**: You can choose ANY style for ANY content type based on what best fits the message
      - **STYLE DIVERSITY CHECK**: Avoid repetitive tech/futuristic aesthetics, embrace variety and humor
   
   **VISUAL STYLE OPTIONS**:
   - Professional: Clean, modern, business-focused with corporate aesthetics
   - Warm: Natural, community-focused, approachable with warm tones
   - Minimalist: Simple, elegant, clear messaging with clean design
   - Meme/Comic: Humorous, viral, engaging with meme culture elements and cartoon aesthetics
   - Illustrated/Cartoon: Fun, expressive, character-driven with comic book styling
   - Pixel Art/Retro: Nostalgic, gaming references, 8-bit aesthetics when appropriate
   - Photo Realistic: Authentic, trustworthy content with natural aesthetics
   - Vector Art/Clean: Professional, minimalist content with precision
   - Community/Social: Inclusive, gathering themes with warm colors
   - Hype: Energetic, exciting, attention-grabbing with dynamic elements
   - Data-Driven: Analytical, informative, chart-focused with clean graphics
   - Studio Lighting: Polished, professional look with controlled lighting
   - Cinematic: Dramatic, epic storytelling with atmospheric depth
   - Abstract/Conceptual: Complex ideas visualization with artistic interpretation
   - Tech: Modern, innovative (use ONLY when content specifically requires tech themes)
   
   **CRITICAL STYLE DIVERSITY REQUIREMENTS**:
   - AVOID overusing holographic, neon, cyberpunk, or futuristic aesthetics
   - PRIORITIZE variety across different posts
   - Consider professional, warm, natural, meme, and minimalist styles FIRST
   - Only use tech/futuristic when content explicitly requires technological themes
   
   3. **Original Concept Creation & Character Control**:
      - Generate a unique visual concept that amplifies the tweet's message
      - Create original scenes, characters, or compositions (do NOT copy templates)
      - Incorporate crypto/Web3 cultural elements naturally when relevant
      
{_get_image_character_instructions(no_characters, human_characters_only, web3_characters)}
   
   4. **Color Palette Integration** (MANDATORY):
      - Primary color: {color_palette.get('primary', 'N/A')}
      - Secondary color: {color_palette.get('secondary', 'N/A')}
      - Accent color: {color_palette.get('accent', 'N/A')}
      - **USE HEX CODES IN PROMPTS**: Include hex codes (e.g., {color_palette.get('primary', '#000000')}, {color_palette.get('secondary', '#000000')}) in your image prompts to ensure accurate color reproduction
      - **CRITICAL: HEX CODES MUST NOT APPEAR AS TEXT**: The hex codes should be used for color reference in the prompt, but they must NEVER appear as visible text, numbers, or symbols in the generated images themselves
      - Use these colors intelligently in visual design (backgrounds, accents, highlights, lighting)
      - Make color integration feel natural and contextual
      - Example CORRECT prompt: "...using {color_palette.get('primary', '#000000')} for highlights, {color_palette.get('secondary', '#000000')} for backgrounds, {color_palette.get('accent', '#000000')} for accents..."
      - The AI model will interpret the hex codes to apply colors correctly, but the hex codes themselves should remain invisible in the final image
   {f'''
   5. **REFERENCE LOGO INTEGRATION REQUIRED** (MANDATORY):
      - You MUST create dynamic prompts that naturally incorporate reference logo placement
      - When generating image prompts, include specific instructions for logo integration:
        * "...with the reference logo elegantly displayed on the [object/surface]..."
        * "...featuring the reference logo prominently on the [structure/device]..."
        * "...showing the reference logo integrated into the [scene/composition]..."
      - ALWAYS mention "reference logo" in your generated prompts when logo is available
      - The reference logo will be provided as an image_url parameter to the AI model
      - Make logo placement feel natural, contextual, and aligned with the visual concept
   
   6. **Professional Enhancement**:
   ''' if context.get('logo_url') else '''
   5. **Professional Enhancement**:
   '''}
      - Always include Essential Quality Keywords: "High resolution", "ultra-detailed", "sharp focus", "masterpiece", "award-winning art", "best quality"
      - Specify appropriate lighting that enhances the mood
      - Add technical specifications: "8K resolution", "cinematic composition", "Twitter-optimized dimensions"
      - For Meme/Comic styles: Add "vibrant cartoon style", "expressive character design", "meme aesthetic", "internet culture art"
      - For Professional styles: Add "professional photography", "studio lighting", "corporate aesthetics"
      - For Natural/Warm styles: Add "warm natural tones", "soft lighting", "atmospheric lighting"
   
   {"6" if context.get('logo_url') else "5"}. **Category-Specific Guidance**:
{get_category_specific_guidance(context.get('category', ''), 'thread') if num_threads > 0 else ''}
{get_category_specific_guidance(context.get('category', ''), 'shitpost') if num_shitposts > 0 else ''}
{get_category_specific_guidance(context.get('category', ''), 'longpost') if num_longposts > 0 else ''}
   
   {"7" if context.get('logo_url') else "6"}. **Infographic Data Requirements** (CRITICAL):
      - If generating image prompts for INFOGRAPHICS, DATA VISUALIZATIONS, CHARTS, or ANALYTICAL CONTENT:
        * You MUST extract ACTUAL DATA from the project context and explicitly include it in the image prompt
        * Include specific numbers, percentages, statistics, metrics, tokenomics data, TVL figures, APY rates, etc. from the context
        * DO NOT use placeholder data like "various metrics" or "relevant statistics"
        * Examples of required data types:
          - Token supply numbers (e.g., "1 billion FVS tokens")
          - Percentage allocations (e.g., "40% liquidity, 30% staking, 20% team")
          - APY/APR rates (e.g., "15-50% APY")
          - TVL figures (e.g., "$10M TVL")
          - Tokenomics breakdown (e.g., "400M liquidity, 300M staking, 200M team")
          - Launch dates (e.g., "Q1 2025 launch")
          - Any numerical data available in the project context
        * Format in prompt: "Infographic showing [specific data from context] with pie charts displaying [actual percentages], bar graphs showing [actual metrics]..."
        * The image MUST be able to render actual data, not generic placeholders
        * If context lacks specific data, clearly state what data should be shown based on available context
   
   {"8" if context.get('logo_url') else "7"}. **Prompt Structure Formula**:
      [Main Visual Concept] + [Specific Details] + [Style] + [Color Palette Integration] + [Quality Keywords] + [Technical Specs]
      - Keep prompts clear, specific, and actionable
      - Include emotional descriptors that match the tweet's tone
      - Ensure visual directly supports and amplifies the tweet message
      - For infographics: Include actual data points and metrics from context
   
   **TEXT HANDLING**: Include "text elements allowed" in prompts (model supports text rendering)
   
{_build_clip_prompts_section(video_image_index, number_of_clips, voiceover, no_characters, human_characters_only, web3_characters)}

PROJECT CONTEXT:
{project_context_str}

OUTPUT FORMAT (JSON only):
{json_example}

CRITICAL REQUIREMENTS:
- Tweet texts must be in authentic styles of popular crypto Twitter handles (randomly selected per tweet)
- Image prompts MUST incorporate the color palette naturally
- Image prompts MUST align perfectly with their corresponding tweet texts
- Clip prompts must intelligently select images with maximum video potential
- All content must be engaging and optimized for Twitter/X
- Use latest document information (prioritize recent documents)
- Use fresh information from live search URLs

Return ONLY the JSON object, no other text."""
    
    return prompt


async def generate_images(project_id: int, job_id: str, prompts: Dict, context: Dict, session_cookie: Optional[str] = None):
    """Generate images using Fal.ai with progressive database updates"""
    image_model = context.get('image_model', 'seedream')
    logo_url = context.get('logo_url')
    fal_model_id = map_model_name_to_fal_id(image_model)
    
    # Get total number of posts from context (from config)
    content_mix = context.get('content_mix', {'shitpost': 4, 'threads': 4, 'longpost': 2})
    num_threads = content_mix.get('threads', 4)
    num_shitposts = content_mix.get('shitpost', 4)
    num_longposts = content_mix.get('longpost', 2)
    total_posts = sum([num_threads, num_shitposts, num_longposts])
    
    # Get date for S3 path
    date_str = datetime.utcnow().strftime('%Y-%m-%d')
    
    generated_image_urls = []
    per_image_metadata = {}
    tweet_texts_array = []  # Array to store all tweet texts for tweet_texts column
    
    # Generate presigned URL for logo if needed
    presigned_logo_url = None
    if logo_url and image_model in ['nano-banana', 'seedream']:
        print("=" * 80)
        print(f"🏷️ LOGO INTEGRATION")
        print("=" * 80)
        print(f"📝 Original logo URL (S3 key): {logo_url}")
        logger.info(f"🏷️ Generating presigned URL for logo: {logo_url[:50]}...")
        presigned_logo_url = await generate_presigned_url(logo_url, project_id=project_id, session_cookie=session_cookie)
        if presigned_logo_url:
            print(f"✅ Presigned logo URL generated: {presigned_logo_url[:100]}...")
            logger.info(f"✅ Generated presigned URL for logo")
        else:
            print(f"⚠️ Failed to generate presigned URL for logo")
            logger.warning(f"⚠️ Failed to generate presigned URL for logo")
            print(f"⚠️ Switching to flux-pro/kontext model (doesn't require logo)")
            logger.warning(f"⚠️ Switching to flux-pro/kontext model (doesn't require logo)")
            # Switch to a model that doesn't require image_urls
            image_model = 'flux-pro-kontext'
            fal_model_id = map_model_name_to_fal_id(image_model)
            print(f"📊 New Image Model: {image_model} ({fal_model_id})")
        print("=" * 80)
    
    print(f"\n{'='*80}")
    print(f"🖼️ STARTING IMAGE GENERATION")
    print(f"{'='*80}")
    print(f"📊 Total Posts to Generate: {total_posts}")
    print(f"📊 Image Model: {image_model} ({fal_model_id})")
    print(f"📊 Logo Integration: {'Yes' if presigned_logo_url else 'No'}")
    print(f"{'='*80}\n")
    
    for i in range(1, total_posts + 1):
        image_prompt_key = f'image_prompt_{i}'
        tweet_text_key = f'tweet_text_{i}'
        
        if image_prompt_key not in prompts:
            logger.warning(f"⚠️ Missing image_prompt_{i}")
            continue
        
        image_prompt = prompts[image_prompt_key]
        tweet_data = prompts.get(tweet_text_key, {})
        
        # Extract tweet text and thread array
        tweet_text = ''
        thread_array = []
        content_type = 'tweet'
        
        if isinstance(tweet_data, dict):
            tweet_text = tweet_data.get('main_tweet', '')
            thread_array = tweet_data.get('thread_array', [])
            content_type = tweet_data.get('content_type', 'tweet')
        elif isinstance(tweet_data, str):
            tweet_text = tweet_data
        
        try:
            # Prepare image URLs for Fal.ai
            image_urls = []
            if presigned_logo_url:
                image_urls.append(presigned_logo_url)
            
            # COMPREHENSIVE LOGGING FOR IMAGE GENERATION
            print(f"\n{'='*80}")
            print(f"🖼️ GENERATING IMAGE {i}/{total_posts}")
            print(f"{'='*80}")
            print(f"📝 Input Prompt: {image_prompt}")
            print(f"🤖 Model: {image_model} (Fal.ai ID: {fal_model_id})")
            print(f"🏷️ Logo Integration: {'Yes' if image_urls else 'No'}")
            if image_urls:
                print(f"🔗 Presigned Logo URLs: {image_urls}")
            print(f"{'='*80}")
            
            # Generate image with Fal.ai
            logger.info(f"🖼️ Generating image {i}/{total_posts}")
            logger.info(f"   Model: {image_model} ({fal_model_id})")
            logger.info(f"   Prompt: {image_prompt[:100]}...")
            if image_urls:
                logger.info(f"   Logo URLs: {len(image_urls)} image(s)")
            
            result = await generate_image_with_fal(fal_model_id, image_model, image_prompt, image_urls)
            
            # COMPREHENSIVE LOGGING FOR FAL.AI OUTPUT
            fal_image_url = result.get('image_url', '')
            print(f"\n{'='*80}")
            print(f"✅ FAL.AI GENERATION COMPLETE - IMAGE {i}/{total_posts}")
            print(f"{'='*80}")
            print(f"🔗 Fal.ai Output URL: {fal_image_url}")
            print(f"{'='*80}\n")
            
            # Download and save to S3
            if fal_image_url:
                s3_key = f"web3_projects/{project_id}/content/{date_str}/{job_id}/images/{i}.jpg"
                
                print(f"📤 Downloading from Fal.ai and uploading to S3...")
                print(f"   S3 Key: {s3_key}")
                s3_url = await download_and_save_to_s3_project(fal_image_url, s3_key)
                print(f"✅ S3 Upload Complete: {s3_url}\n")
                
                generated_image_urls.append(s3_url)
                
                # Build metadata
                metadata = {
                    "image_url": s3_url,
                    "image_prompt": image_prompt,
                    "tweet_text": tweet_text,
                    "thread_array": thread_array,
                    "model_used": image_model,
                    "fal_model_id": fal_model_id,
                    "content_type": content_type,
                    "dimensions": "1792x1024",
                    "generated_at": datetime.utcnow().isoformat(),
                    "image_index": i
                }
                per_image_metadata[f"image_{i}"] = metadata
                
                # Add to tweet_texts array
                tweet_texts_array.append({
                    "image_index": i,
                    "main_tweet": tweet_text,
                    "thread_array": thread_array,
                    "content_type": content_type
                })
                
                # Update database progressively
                print(f"💾 Saving to database (progressive update {i}/{total_posts})...")
                await update_image_in_db(project_id, job_id, generated_image_urls, per_image_metadata, tweet_texts_array, i, session_cookie)
                print(f"✅ Database update complete\n")
                
                # Update progress
                progress = 50 + int((i / total_posts) * 40)  # 50-90%
                await update_progress_in_db(project_id, job_id, progress, f"Generated image {i}/{total_posts}", session_cookie)
                
                logger.info(f"✅ Image {i}/{total_posts} generated: {s3_url}")
            else:
                print(f"❌ ERROR: No image URL from Fal.ai for image {i}\n")
                logger.error(f"❌ No image URL from Fal.ai for image {i}")
                
        except Exception as e:
            logger.error(f"❌ Error generating image {i}: {str(e)}")
            # Continue with next image
            continue
    
    # Final update with all images
    print(f"\n{'='*80}")
    print(f"✅ IMAGE GENERATION COMPLETE")
    print(f"{'='*80}")
    print(f"📊 Total Images Generated: {len(generated_image_urls)}/{total_posts}")
    print(f"💾 Performing final database update...")
    await update_image_in_db(project_id, job_id, generated_image_urls, per_image_metadata, tweet_texts_array, total_posts, session_cookie)
    print(f"✅ Final database update complete")
    print(f"{'='*80}\n")


async def generate_image_with_fal(fal_model_id: str, model_name: str, prompt: str, image_urls: List[str]) -> Dict:
    """Generate single image using Fal.ai"""
    arguments = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd"
    }
    
    # nano-banana and seedream models require at least 1 image URL
    if 'nano-banana' in fal_model_id or 'seedream' in fal_model_id:
        if not image_urls or len(image_urls) == 0:
            raise ValueError(f"Model {fal_model_id} requires at least 1 image URL in image_urls, but got empty array. Logo generation may have failed.")
        arguments["image_urls"] = image_urls
        logger.info(f"🏷️ Passing logo to Fal.ai: {len(image_urls)} image(s)")
    elif image_urls:
        # For other models, only add if we have URLs
        arguments["image_urls"] = image_urls
        logger.info(f"🏷️ Passing logo to Fal.ai: {len(image_urls)} image(s)")
    
    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs:
                logger.debug(f"📋 {model_name} log: {log.get('message', '')}")
    
    result = fal_client.subscribe(
        fal_model_id,
        arguments=arguments,
        with_logs=True,
        on_queue_update=on_queue_update,
    )
    
    return {
        'image_url': result.get('images', [{}])[0].get('url', ''),
        'model': model_name
    }


async def download_and_save_to_s3_project(fal_image_url: str, s3_key: str) -> str:
    """Download image from Fal.ai and save to S3 with project path structure"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/projects/upload-generated-content",
                json={
                    "fal_image_url": fal_image_url,
                    "s3_key": s3_key
                },
                timeout=120.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('s3_url', s3_key)
            else:
                logger.error(f"❌ Failed to save image to S3: {response.status_code}")
                return s3_key
                
    except Exception as e:
        logger.error(f"❌ Error saving image to S3: {str(e)}")
        return s3_key


async def download_and_save_video_to_s3_project(fal_video_url: str, s3_key: str) -> str:
    """Download video from Fal.ai/Pixverse and save to S3 with project path structure"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        print(f"📥 Downloading video from: {fal_video_url[:100]}...")
        print(f"📤 Uploading to S3: {s3_key}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/projects/upload-generated-content",
                json={
                    "fal_video_url": fal_video_url,
                    "s3_key": s3_key,
                    "content_type": "video/mp4"
                },
                timeout=300.0  # Longer timeout for videos
            )
            
            if response.status_code == 200:
                data = response.json()
                s3_url = data.get('s3_url', s3_key)
                print(f"✅ Video saved to S3: {s3_url}")
                return s3_url
            else:
                error_text = await response.text()
                logger.error(f"❌ Failed to save video to S3: {response.status_code} - {error_text}")
                print(f"❌ Failed to save video to S3: {response.status_code}")
                return s3_key
                
    except Exception as e:
        logger.error(f"❌ Error saving video to S3: {str(e)}")
        print(f"❌ Error saving video to S3: {str(e)}")
        return s3_key


async def update_image_in_db(project_id: int, job_id: str, image_urls: List[str], per_image_metadata: Dict, tweet_texts: List[Dict], image_index: int, session_cookie: Optional[str] = None):
    """Update database record with generated images and metadata"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/images",
                headers=headers,
                json={
                    "generated_image_urls": image_urls,
                    "per_image_metadata": per_image_metadata,
                    "tweet_texts": tweet_texts,  # Save tweet texts as JSON array
                    "image_index": image_index
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                logger.warning(f"⚠️ Failed to update images in DB: {response.status_code}")
                
    except Exception as e:
        logger.warning(f"⚠️ Error updating images in DB: {str(e)}")


# ============================================
# ADDITIONAL IMAGE GENERATION FOR CLIPS
# ============================================

async def generate_additional_images_for_clips(project_id: int, job_id: str, prompts: Dict, context: Dict, video_image_index: int, session_cookie: Optional[str] = None):
    """Generate additional images needed for video clips (image_{index}_2, image_{index}_3, etc.)"""
    try:
        number_of_clips = context.get('number_of_clips', NUMBER_OF_CLIPS)
        image_model = context.get('image_model', 'seedream')
        logo_url = context.get('logo_url')
        fal_model_id = map_model_name_to_fal_id(image_model)
        
        # Get date for S3 path
        date_str = datetime.utcnow().strftime('%Y-%m-%d')
        
        # Generate presigned URL for logo if needed
        presigned_logo_url = None
        if logo_url and image_model in ['nano-banana', 'seedream']:
            logger.info(f"🏷️ Generating presigned URL for logo: {logo_url[:50]}...")
            presigned_logo_url = await generate_presigned_url(logo_url, project_id=project_id, session_cookie=session_cookie)
        
        additional_image_urls = []
        per_image_metadata = {}
        
        # Generate images for clips 2, 3, etc.
        for clip_num in range(2, number_of_clips + 1):
            image_prompt_key = f'image_prompt_{video_image_index}_{clip_num}'
            if image_prompt_key not in prompts:
                logger.warning(f"⚠️ Missing {image_prompt_key} for clip {clip_num}")
                continue
            
            image_prompt = prompts[image_prompt_key]
            
            try:
                # Prepare image URLs for Fal.ai
                image_urls = []
                if presigned_logo_url:
                    image_urls.append(presigned_logo_url)
                
                logger.info(f"🖼️ Generating additional image {video_image_index}_{clip_num} for clip {clip_num}")
                
                # Generate image with Fal.ai
                result = await generate_image_with_fal(fal_model_id, image_model, image_prompt, image_urls)
                
                fal_image_url = result.get('image_url', '')
                if fal_image_url:
                    s3_key = f"web3_projects/{project_id}/content/{date_str}/{job_id}/images/{video_image_index}_{clip_num}.jpg"
                    
                    logger.info(f"📤 Downloading and uploading to S3: {s3_key}")
                    s3_url = await download_and_save_to_s3_project(fal_image_url, s3_key)
                    
                    if s3_url:
                        additional_image_urls.append(s3_url)
                        
                        # Build metadata
                        metadata = {
                            "image_url": s3_url,
                            "image_prompt": image_prompt,
                            "model_used": image_model,
                            "fal_model_id": fal_model_id,
                            "generated_at": datetime.utcnow().isoformat(),
                            "image_index": f"{video_image_index}_{clip_num}",
                            "clip_number": clip_num,
                            "for_video": True
                        }
                        per_image_metadata[f"image_{video_image_index}_{clip_num}"] = metadata
                        
                        logger.info(f"✅ Additional image {video_image_index}_{clip_num} generated: {s3_url}")
                else:
                    logger.error(f"❌ No image URL from Fal.ai for image {video_image_index}_{clip_num}")
                    
            except Exception as e:
                logger.error(f"❌ Error generating additional image {video_image_index}_{clip_num}: {str(e)}")
                continue
        
        # Update database with all additional images at once
        if per_image_metadata:
            await update_additional_images_in_db(project_id, job_id, per_image_metadata, session_cookie)
        
        logger.info(f"✅ Generated {len(additional_image_urls)} additional images for video clips")
        
    except Exception as e:
        logger.error(f"❌ Error in generate_additional_images_for_clips: {str(e)}")
        raise


async def update_additional_images_in_db(project_id: int, job_id: str, per_image_metadata: Dict, session_cookie: Optional[str] = None):
    """Update database record with additional images for clips by merging into existing per_image_metadata"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        # Get current content to merge additional images
        async with httpx.AsyncClient() as client:
            # First, get the current record
            get_response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/job/{job_id}",
                headers=headers,
                timeout=10.0
            )
            
            if get_response.status_code != 200:
                logger.warning(f"⚠️ Failed to get current content: {get_response.status_code}")
                return
            
            current_data = get_response.json().get('data', {})
            existing_per_image_metadata = current_data.get('per_image_metadata', {})
            existing_image_urls = current_data.get('generated_image_urls', [])
            
            # Merge additional images into existing metadata
            merged_metadata = {**existing_per_image_metadata, **per_image_metadata}
            
            # Extract image URLs from additional metadata
            additional_image_urls = [metadata.get('image_url') for metadata in per_image_metadata.values() if metadata.get('image_url')]
            merged_image_urls = list(existing_image_urls) + additional_image_urls
            
            # Update with merged data
            update_response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/images",
                headers=headers,
                json={
                    "generated_image_urls": merged_image_urls,
                    "per_image_metadata": merged_metadata,
                    "tweet_texts": current_data.get('tweet_texts', []),  # Keep existing tweet texts
                    "image_index": None  # Not used for additional images
                },
                timeout=10.0
            )
            
            if update_response.status_code != 200:
                logger.warning(f"⚠️ Failed to update additional images in DB: {update_response.status_code}")
                error_text = await update_response.text()
                logger.warning(f"   Error details: {error_text}")
            else:
                logger.info(f"✅ Updated {len(per_image_metadata)} additional images in DB")
                
    except Exception as e:
        logger.warning(f"⚠️ Error updating additional images in DB: {str(e)}")


# ============================================
# VIDEO GENERATION METHODS
# ============================================

async def download_file_from_url(url: str, local_path: str) -> Optional[str]:
    """Download file from URL to local path"""
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        with open(local_path, 'wb') as f:
            f.write(response.content)
        return local_path
    except Exception as e:
        logger.error(f"❌ Error downloading {url}: {str(e)}")
        return None


async def generate_video_clips(project_id: int, job_id: str, prompts: Dict, context: Dict, video_image_index: int, session_cookie: Optional[str] = None):
    """Generate video clips using Kling and combine them"""
    try:
        number_of_clips = context.get('number_of_clips', NUMBER_OF_CLIPS)
        clip_duration = context.get('clip_duration', CLIP_DURATION)
        project_name = context.get('project_name', 'Web3 Project')
        voiceover = context.get('voiceover', False)
        
        # Log all flags and configuration
        logger.info("=" * 80)
        logger.info("🎬 VIDEO GENERATION CONFIGURATION")
        logger.info("=" * 80)
        logger.info(f"📋 Flags and Settings:")
        logger.info(f"   - Image Index: {video_image_index}")
        logger.info(f"   - Number of Clips: {number_of_clips}")
        logger.info(f"   - Clip Duration: {clip_duration}s")
        logger.info(f"   - Total Video Duration: {number_of_clips * clip_duration}s")
        logger.info(f"   - Video Model: Kling")
        logger.info(f"   - Voiceover Enabled: {voiceover}")
        logger.info(f"   - Project Name: {project_name}")
        logger.info(f"   - Project ID: {project_id}")
        logger.info(f"   - Job ID: {job_id}")
        logger.info("=" * 80)
        
        # Validate clip duration for Kling (5 or 10 seconds)
        if clip_duration not in [5, 10]:
            logger.warning(f"⚠️ Kling only supports 5 or 10 seconds, adjusting {clip_duration}s to 10s")
            clip_duration = 10 if clip_duration > 5 else 5
        
        # Get date for S3 path
        date_str = datetime.utcnow().strftime('%Y-%m-%d')
        
        # Step 1: Get image URLs (presigned S3 URLs)
        image_urls = []
        
        # Clip 1: Use existing image
        # Fetch generated images from database to get the presigned URL
        existing_image_url = await get_image_url_from_db(project_id, job_id, video_image_index, session_cookie)
        if not existing_image_url:
            logger.error(f"❌ Could not find image {video_image_index} in database")
            return
        
        # Generate presigned URL for existing image
        presigned_image_1 = await generate_presigned_url(existing_image_url, project_id=project_id, session_cookie=session_cookie)
        if not presigned_image_1:
            logger.error(f"❌ Could not generate presigned URL for image {video_image_index}")
            return
        
        image_urls.append(presigned_image_1)
        logger.info(f"📸 Clip 1 Image (Presigned S3 URL): {presigned_image_1[:100]}...")
        
        # Clips 2+: Get additional images
        for clip_num in range(2, number_of_clips + 1):
            additional_image_url = await get_image_url_from_db(project_id, job_id, f"{video_image_index}_{clip_num}", session_cookie)
            if additional_image_url:
                presigned_url = await generate_presigned_url(additional_image_url, project_id=project_id, session_cookie=session_cookie)
                if presigned_url:
                    image_urls.append(presigned_url)
                    logger.info(f"📸 Clip {clip_num} Image (Presigned S3 URL): {presigned_url[:100]}...")
                else:
                    logger.error(f"❌ Could not generate presigned URL for image {video_image_index}_{clip_num}")
                    return
            else:
                logger.error(f"❌ Could not find image {video_image_index}_{clip_num} in database")
                return
        
        # Step 2: Generate clips using Kling
        clip_urls = []
        temp_clip_files = []
        
        try:
            for clip_num in range(1, number_of_clips + 1):
                clip_prompt_key = f'clip_prompt_{video_image_index}' if clip_num == 1 else f'clip_prompt_{video_image_index}_{clip_num}'
                
                if clip_prompt_key not in prompts:
                    logger.error(f"❌ Missing {clip_prompt_key}")
                    return
                
                clip_prompt_data = prompts[clip_prompt_key]
                if isinstance(clip_prompt_data, dict):
                    clip_prompt = clip_prompt_data.get('clip_prompt', '')
                else:
                    clip_prompt = str(clip_prompt_data)
                
                if not clip_prompt:
                    logger.error(f"❌ Empty clip prompt for {clip_prompt_key}")
                    return
                
                image_url = image_urls[clip_num - 1]
                
                print(f"\n{'='*80}")
                print(f"🎬 GENERATING CLIP {clip_num}/{number_of_clips} WITH KLING")
                print(f"{'='*80}")
                print(f"📸 Image URL (Presigned): {image_url}")
                print(f"📝 Clip Prompt: {clip_prompt}")
                print(f"⏱️  Duration: {clip_duration}s")
                print(f"{'='*80}")
                
                logger.info("-" * 80)
                logger.info(f"🎬 Generating Clip {clip_num}/{number_of_clips} with Kling")
                logger.info("-" * 80)
                logger.info(f"📸 Image URL (Presigned): {image_url}")
                logger.info(f"📝 Clip Prompt: {clip_prompt}")
                logger.info(f"⏱️  Duration: {clip_duration}s")
                
                # Generate clip with Kling (will download and save to S3)
                clip_url = await generate_clip_with_kling(clip_prompt, image_url, clip_duration, project_id, job_id, clip_num)
                
                if not clip_url:
                    logger.error(f"❌ Failed to generate clip {clip_num}")
                    return
                
                clip_urls.append(clip_url)
                logger.info(f"✅ Clip {clip_num} Generated Successfully")
                logger.info(f"   Output URL: {clip_url}")
                logger.info("-" * 80)
            
            # Step 3: Get audio prompt from Grok output (or use fallback)
            total_video_duration = number_of_clips * clip_duration
            audio_prompt = prompts.get('single_audio_prompt', f"Create a continuous background music composition for a {total_video_duration}-second video that enhances the visual narrative. Focus ONLY on music: instrumental arrangements, musical progression, tempo, mood, and atmospheric musical elements that build throughout the video. Create a cohesive musical theme that flows seamlessly from beginning to end. Include appropriate ending effects for cinematic finish (fade-out for subtle endings, crescendo for dramatic scenes). NO sound effects, footsteps, car sounds, or environmental noises - ONLY MUSIC.")
            
            logger.info(f"🎵 Generating audio for entire video ({total_video_duration}s)...")
            logger.info(f"   Audio prompt: {audio_prompt[:100]}...")
            
            # Step 3a: Convert S3 URLs to presigned URLs for downloading
            logger.info("=" * 80)
            logger.info("🔗 PRE-FINAL VIDEO GENERATION: Combining Clips")
            logger.info("=" * 80)
            logger.info(f"📋 Input Clips: {len(clip_urls)} clips")
            presigned_clip_urls = []
            for i, clip_url in enumerate(clip_urls, 1):
                logger.info(f"   Clip {i} (original): {clip_url}")
                # Check if URL is an S3 key (starts with s3:// or doesn't start with http)
                if clip_url.startswith('s3://') or not clip_url.startswith('http'):
                    # Extract S3 key
                    s3_key = clip_url.replace('s3://', '').split('/', 1)[-1] if 's3://' in clip_url else clip_url
                    # Generate presigned URL
                    presigned_url = await generate_presigned_url(s3_key, project_id=project_id, session_cookie=session_cookie)
                    if presigned_url:
                        logger.info(f"   Clip {i} (presigned): {presigned_url[:100]}...")
                        presigned_clip_urls.append(presigned_url)
                    else:
                        logger.error(f"   ❌ Failed to generate presigned URL for clip {i}, using original URL")
                        presigned_clip_urls.append(clip_url)
                else:
                    # Already a valid HTTP(S) URL (fal.media or presigned S3 URL)
                    presigned_clip_urls.append(clip_url)
            logger.info(f"⚙️  Process: Downloading clips → Applying crossfade transitions → Fade in/out effects → Uploading")
            
            combined_clips_url = await combine_clips_simple(presigned_clip_urls, project_id, job_id, date_str)
            if not combined_clips_url:
                logger.error("❌ Failed to combine clips")
                return
            
            logger.info(f"✅ Pre-final video (combined clips) generated successfully")
            logger.info(f"   Pre-final URL: {combined_clips_url}")
            logger.info("=" * 80)
            
            # Step 3b: Generate audio using Pixverse
            print(f"\n{'='*80}")
            print(f"🎵 GENERATING AUDIO FOR ENTIRE VIDEO")
            print(f"{'='*80}")
            print(f"⏱️  Duration: {total_video_duration}s")
            print(f"📝 Audio Prompt: {audio_prompt}")
            print(f"📹 Video URL: {combined_clips_url[:100]}...")
            print(f"{'='*80}")
            
            logger.info("=" * 80)
            logger.info(f"🎵 GENERATING AUDIO FOR ENTIRE VIDEO")
            logger.info("=" * 80)
            logger.info(f"⏱️  Duration: {total_video_duration}s")
            logger.info(f"📝 Audio Prompt: {audio_prompt}")
            logger.info(f"📹 Video URL: {combined_clips_url[:100]}...")
            
            video_with_audio_url = await generate_video_with_audio(audio_prompt, combined_clips_url, total_video_duration, project_id, job_id)
            if not video_with_audio_url:
                logger.error("❌ Failed to generate audio")
                return
            
            logger.info(f"✅ Video with audio generated successfully")
            logger.info(f"   Video with Audio URL: {video_with_audio_url}")
            logger.info("=" * 80)
            
            # Step 3c: Add voiceover if enabled
            if voiceover:
                logger.info("=" * 80)
                logger.info("🎤 VOICEOVER PROCESSING")
                logger.info("=" * 80)
                logger.info(f"📋 Voiceover Enabled: Generating and mixing voiceovers for {number_of_clips} clips")
                # TODO: Implement voiceover generation and mixing when needed
                # This would involve:
                # 1. Generating voiceovers using ElevenLabs for each clip
                # 2. Mixing voiceovers with the video that has audio
                # 3. Updating final_video_url
                logger.warning("⚠️ Voiceover generation not yet implemented - using video with audio only")
                logger.info("=" * 80)
            
            # Step 4: Collect all video metadata for per_video_metadata
            per_video_metadata = {
                "video_url": video_with_audio_url,
                "image_index": video_image_index,
                "number_of_clips": number_of_clips,
                "clip_duration": clip_duration,
                "total_duration": total_video_duration,
                "generated_at": datetime.utcnow().isoformat(),
                "audio_prompt": audio_prompt,
                "clip_prompts": {},
                "voiceover_prompts": {},
                "clip_urls": clip_urls,
                "image_urls": image_urls
            }
            
            # Collect all clip prompts
            for clip_num in range(1, number_of_clips + 1):
                clip_prompt_key = f'clip_prompt_{video_image_index}' if clip_num == 1 else f'clip_prompt_{video_image_index}_{clip_num}'
                if clip_prompt_key in prompts:
                    per_video_metadata["clip_prompts"][f"clip_{clip_num}"] = prompts[clip_prompt_key]
            
            # Collect all voiceover prompts
            for clip_num in range(1, number_of_clips + 1):
                voiceover_key = f'voiceover_{clip_num}_prompt'
                if voiceover_key in prompts:
                    per_video_metadata["voiceover_prompts"][f"clip_{clip_num}"] = prompts[voiceover_key]
            
            # Save final video to database with complete metadata
            await update_video_in_db(project_id, job_id, video_image_index, video_with_audio_url, per_video_metadata, session_cookie)
            
            logger.info(f"✅ Video generation complete: {video_with_audio_url[:100]}...")
            
        finally:
            # Cleanup temp files
            for temp_file in temp_clip_files:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                except Exception as e:
                    logger.warning(f"⚠️ Could not cleanup {temp_file}: {e}")
        
    except Exception as e:
        logger.error(f"❌ Error in generate_video_clips: {str(e)}")
        raise


async def get_image_url_from_db(project_id: int, job_id: str, image_index: Any, session_cookie: Optional[str] = None) -> Optional[str]:
    """Get image URL from database by image index"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/job/{job_id}",
                headers=headers,
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                content_data = data.get('data', {})
                
                # Check generated_image_urls
                image_urls = content_data.get('generated_image_urls', [])
                per_image_metadata = content_data.get('per_image_metadata', {})
                
                # Search in per_image_metadata first
                image_key = f"image_{image_index}"
                if image_key in per_image_metadata:
                    return per_image_metadata[image_key].get('image_url')
                
                # Fallback: check by index in image_urls array
                if isinstance(image_index, int) and 1 <= image_index <= len(image_urls):
                    return image_urls[image_index - 1]
                
                # Check additional images
                additional_images = content_data.get('additional_image_urls', [])
                additional_metadata = content_data.get('additional_per_image_metadata', {})
                
                if image_key in additional_metadata:
                    return additional_metadata[image_key].get('image_url')
                
                logger.warning(f"⚠️ Image {image_index} not found in database")
                return None
            else:
                logger.error(f"⚠️ Failed to fetch content from DB: {response.status_code}")
                return None
                
    except Exception as e:
        logger.error(f"⚠️ Error fetching image from DB: {str(e)}")
        return None


async def generate_clip_with_kling(clip_prompt: str, image_url: str, duration: int, project_id: int, job_id: str, clip_num: int) -> Optional[str]:
    """Generate video clip using Kling image-to-video model and save to S3"""
    try:
        print(f"\n{'='*80}")
        print(f"🎬 GENERATING KLING CLIP {clip_num}")
        print(f"{'='*80}")
        print(f"📝 Clip Prompt: {clip_prompt}")
        print(f"📸 Image URL: {image_url[:100]}...")
        print(f"⏱️  Duration: {duration}s")
        print(f"{'='*80}")
        
        logger.info(f"🎬 Generating Kling clip (duration: {duration}s)...")
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    log_message = log.get('message', '')
                    print(f"📋 Kling: {log_message}")
                    logger.debug(f"📋 Kling log: {log_message}")
        
        print(f"🔄 Calling Fal.ai Kling model...")
        result = fal_client.subscribe(
            "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
            arguments={
                "prompt": clip_prompt,
                "image_url": image_url,
                "duration": str(duration),
                "negative_prompt": "blur, distort, low quality, pixelated, noisy, grainy, out of focus, poorly lit, poorly exposed, poorly composed, poorly framed, poorly cropped, poorly color corrected, poorly color graded, additional bubbles, particles, extra text, double logos",
                "cfg_scale": 0.5
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            fal_video_url = result['video']['url']
            print(f"✅ Kling clip generated from Fal.ai: {fal_video_url}")
            logger.info(f"✅ Kling clip generated: {fal_video_url}")
            
            # Download and save to S3
            date_str = datetime.utcnow().strftime('%Y-%m-%d')
            s3_key = f"web3_projects/{project_id}/content/{date_str}/{job_id}/videos/clip_{clip_num}.mp4"
            print(f"📤 Downloading video from Fal.ai and uploading to S3...")
            print(f"   S3 Key: {s3_key}")
            
            s3_url = await download_and_save_video_to_s3_project(fal_video_url, s3_key)
            
            if s3_url and s3_url != s3_key:  # Success if we got a proper S3 URL
                print(f"✅ Clip {clip_num} saved to S3: {s3_url}")
                logger.info(f"✅ Clip {clip_num} saved to S3: {s3_url}")
                return s3_url
            else:
                print(f"⚠️ Failed to save clip to S3, using Fal.ai URL as fallback")
                logger.warning(f"⚠️ Failed to save clip to S3, using Fal.ai URL as fallback")
                return fal_video_url  # Fallback to Fal.ai URL
        else:
            print(f"❌ No video result from Kling")
            logger.error("❌ No video result from Kling")
            return None
            
    except Exception as e:
        print(f"❌ Error generating Kling clip: {str(e)}")
        logger.error(f"❌ Error generating Kling clip: {str(e)}")
        return None


async def combine_clips_simple(clip_urls: List[str], project_id: int, job_id: str, date_str: str) -> Optional[str]:
    """Combine video clips with smooth crossfade transitions and fade effects"""
    if not MOVIEPY_AVAILABLE:
        logger.error("❌ MoviePy not available - cannot combine clips")
        return None
    
    try:
        if len(clip_urls) < 1:
            logger.error("❌ No clips to combine")
            return None
        
        # Create temp directory
        temp_dir = tempfile.mkdtemp()
        local_clip_paths = []
        
        try:
            # Download clips locally
            for i, clip_url in enumerate(clip_urls):
                local_path = os.path.join(temp_dir, f"temp_clip_{i}.mp4")
                downloaded = await download_file_from_url(clip_url, local_path)
                if not downloaded:
                    logger.error(f"❌ Failed to download clip {i}")
                    return None
                local_clip_paths.append(local_path)
            
            # Load all video clips
            clips = [VideoFileClip(path) for path in local_clip_paths]
            
            if len(clips) == 1:
                # Single clip: add audio fade-in at beginning and fade-out at end (visual fade-out only)
                logger.info("📹 Single clip detected - adding fade effects...")
                single_clip = clips[0]
                
                # Add audio fade-in at beginning (NO visual fade-in)
                start_fade_duration = 1.0
                if single_clip.audio is not None:
                    single_clip = single_clip.audio_fadein(start_fade_duration)
                    logger.info(f"🔊 Adding {start_fade_duration}s audio fade-in at beginning...")
                else:
                    logger.info(f"🔊 No audio track found - skipping audio fade-in")
                
                # Add visual fade-to-black ending
                end_fade_duration = 1.5
                single_clip = single_clip.fadeout(end_fade_duration)
                logger.info(f"🎬 Adding {end_fade_duration}s visual fade-to-black ending...")
                
                # Apply audio fade-out
                if single_clip.audio is not None:
                    single_clip = single_clip.audio_fadeout(end_fade_duration)
                    logger.info(f"🔊 Adding {end_fade_duration}s audio fade-out...")
                else:
                    logger.info(f"🔊 No audio track found - skipping audio fade-out")
                
                # Save combined clip
                output_path = os.path.join(temp_dir, "combined_video.mp4")
                single_clip.write_videofile(
                    output_path,
                    codec='libx264',
                    audio_codec='aac',
                    temp_audiofile=os.path.join(temp_dir, 'temp-audio.m4a'),
                    remove_temp=True
                )
                single_clip.close()
                
            else:
                # Multiple clips: combine with crossfade transitions
                min_duration = min(clip.duration for clip in clips)
                transition_duration = min(1.0, min_duration / 2)
                
                logger.info(f"📊 Using transition duration: {transition_duration:.2f}s")
                
                final_parts = []
                
                # Process each clip
                for i, clip in enumerate(clips):
                    clip_duration = clip.duration
                    
                    if i == 0:
                        # First clip: keep everything except last transition_duration
                        main_part = clip.subclip(0, clip_duration - transition_duration)
                        final_parts.append(main_part)
                        
                        # Create transition with next clip
                        clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                        next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                        
                        # Apply crossfade effects (overlap transition, no black fade)
                        clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                        next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                        
                        # Composite the transition (overlap with audio mixing)
                        clip_fade_out = clip_fade_out.set_start(0)
                        next_clip_fade_in = next_clip_fade_in.set_start(0)
                        transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                        final_parts.append(transition)
                        
                    elif i == len(clips) - 1:
                        # Last clip: skip first transition_duration (already in previous transition)
                        main_part = clip.subclip(transition_duration, clip_duration)
                        final_parts.append(main_part)
                        
                    else:
                        # Middle clips: skip first transition_duration, keep everything except last transition_duration
                        main_part = clip.subclip(transition_duration, clip_duration - transition_duration)
                        final_parts.append(main_part)
                        
                        # Create transition with next clip
                        clip_fade_out = clip.subclip(clip_duration - transition_duration, clip_duration)
                        next_clip_fade_in = clips[i + 1].subclip(0, transition_duration)
                        
                        # Apply crossfade effects (overlap transition, no black fade)
                        clip_fade_out = clip_fade_out.crossfadeout(transition_duration)
                        next_clip_fade_in = next_clip_fade_in.crossfadein(transition_duration)
                        
                        # Composite the transition (overlap with audio mixing)
                        clip_fade_out = clip_fade_out.set_start(0)
                        next_clip_fade_in = next_clip_fade_in.set_start(0)
                        transition = CompositeVideoClip([clip_fade_out, next_clip_fade_in])
                        final_parts.append(transition)
                
                # Concatenate all parts
                final_clip = concatenate_videoclips(final_parts)
                
                # Add audio fade-in at beginning
                start_fade_duration = 1.0
                if final_clip.audio is not None:
                    final_clip = final_clip.audio_fadein(start_fade_duration)
                    logger.info(f"🔊 Applying {start_fade_duration}s audio fade-in at beginning")
                else:
                    logger.info(f"🔊 No audio track found - skipping audio fade-in")
                
                # Add fade-to-black ending
                end_fade_duration = 1.5
                final_clip = final_clip.fadeout(end_fade_duration)
                logger.info(f"🎬 Applying {end_fade_duration}s visual fade-to-black ending")
                
                # Apply audio fade-out
                if final_clip.audio is not None:
                    final_clip = final_clip.audio_fadeout(end_fade_duration)
                    logger.info(f"🔊 Applying {end_fade_duration}s audio fade-out at end")
                else:
                    logger.info(f"🔊 No audio track found - skipping audio fade-out")
                
                logger.info(f"✨ All fade effects applied successfully")
                
                # Save combined clip
                output_path = os.path.join(temp_dir, "combined_video.mp4")
                final_clip.write_videofile(
                    output_path,
                    codec='libx264',
                    audio_codec='aac',
                    temp_audiofile=os.path.join(temp_dir, 'temp-audio.m4a'),
                    remove_temp=True
                )
                
                # Clean up clips
                for clip in clips:
                    clip.close()
                final_clip.close()
            
            # Upload combined video to S3
            s3_key = f"web3_projects/{project_id}/content/{date_str}/{job_id}/videos/combined_clips.mp4"
            s3_url = await upload_video_to_s3(output_path, s3_key, project_id)
            
            if s3_url:
                logger.info(f"✅ Combined clips uploaded: {s3_url}")
                return s3_url
            else:
                logger.error("❌ Failed to upload combined clips")
                return None
            
        finally:
            # Cleanup temp files
            for clip_path in local_clip_paths:
                try:
                    if os.path.exists(clip_path):
                        os.remove(clip_path)
                except Exception as e:
                    logger.warning(f"⚠️ Could not cleanup {clip_path}: {e}")
            
            try:
                if os.path.exists(temp_dir):
                    import shutil
                    shutil.rmtree(temp_dir)
            except Exception as e:
                logger.warning(f"⚠️ Could not cleanup temp dir: {e}")
                
    except Exception as e:
        logger.error(f"❌ Error combining clips: {str(e)}")
        return None


async def generate_video_with_audio(audio_prompt: str, video_url: str, duration: int, project_id: int, job_id: str) -> Optional[str]:
    """Generate final video with audio using Pixverse sound-effects and save to S3"""
    try:
        print(f"\n{'='*80}")
        print(f"🎵 GENERATING AUDIO FOR VIDEO")
        print(f"{'='*80}")
        print(f"📝 Audio Prompt: {audio_prompt}")
        print(f"📹 Video URL (to add audio): {video_url[:100]}...")
        print(f"⏱️  Duration: {duration}s")
        print(f"{'='*80}")
        
        logger.info(f"🎵 Generating audio for video ({duration}s)...")
        
        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                for log in update.logs:
                    log_message = log.get('message', '')
                    print(f"📋 Pixverse: {log_message}")
                    logger.debug(f"📋 Pixverse audio log: {log_message}")
        
        print(f"🔄 Calling Fal.ai Pixverse sound-effects...")
        result = fal_client.subscribe(
            "fal-ai/pixverse/sound-effects",
            arguments={
                "video_url": video_url,
                "prompt": audio_prompt,
                "duration": str(duration)
            },
            with_logs=True,
            on_queue_update=on_queue_update,
        )
        
        if result and 'video' in result:
            fal_video_url = result['video']['url']
            print(f"✅ Video with audio generated from Fal.ai: {fal_video_url}")
            logger.info(f"✅ Video with audio generated: {fal_video_url}")
            
            # Download and save to S3
            date_str = datetime.utcnow().strftime('%Y-%m-%d')
            s3_key = f"web3_projects/{project_id}/content/{date_str}/{job_id}/videos/final_with_audio.mp4"
            print(f"📤 Downloading final video from Fal.ai and uploading to S3...")
            print(f"   S3 Key: {s3_key}")
            
            s3_url = await download_and_save_video_to_s3_project(fal_video_url, s3_key)
            
            if s3_url and s3_url != s3_key:  # Success if we got a proper S3 URL
                print(f"✅ Final video with audio saved to S3: {s3_url}")
                logger.info(f"✅ Final video with audio saved to S3: {s3_url}")
                return s3_url
            else:
                print(f"⚠️ Failed to save final video to S3, using Fal.ai URL as fallback")
                logger.warning(f"⚠️ Failed to save final video to S3, using Fal.ai URL as fallback")
                return fal_video_url  # Fallback to Fal.ai URL
        else:
            print(f"❌ No video found in audio generation result")
            logger.error("❌ No video found in audio generation result")
            return None
            
    except Exception as e:
        print(f"❌ Error generating video with audio: {str(e)}")
        logger.error(f"❌ Error generating video with audio: {str(e)}")
        return None


async def upload_video_to_s3(local_path: str, s3_key: str, project_id: int) -> Optional[str]:
    """Upload video file to S3 and return presigned URL"""
    # Use direct S3 upload for videos
    return await upload_video_to_s3_direct(local_path, s3_key)


async def upload_video_to_s3_direct(local_path: str, s3_key: str) -> Optional[str]:
    """Fallback: Direct S3 upload using boto3"""
    try:
        import boto3
        from app.config.settings import settings
        
        s3_client = boto3.client(
            's3',
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region or 'us-east-1'
        )
        
        bucket_name = settings.s3_bucket_name
        
        s3_client.upload_file(
            local_path,
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': 'video/mp4',
                'CacheControl': 'max-age=31536000',
                'ServerSideEncryption': 'AES256'
            }
        )
        
        # Generate presigned URL
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': s3_key},
            ExpiresIn=3600
        )
        
        return presigned_url
        
    except Exception as e:
        logger.error(f"❌ Error in direct S3 upload: {str(e)}")
        return None


async def update_video_in_db(project_id: int, job_id: str, image_index: int, video_url: str, per_video_metadata: Dict, session_cookie: Optional[str] = None):
    """Update database record with generated video - stores in per_video_metadata with key image_{index}"""
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        headers = {}
        if session_cookie:
            headers['Cookie'] = f'project_twitter_user_id={session_cookie}'
        
        # Get current content to merge video metadata
        async with httpx.AsyncClient() as client:
            # First, get the current record
            get_response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/job/{job_id}",
                headers=headers,
                timeout=10.0
            )
            
            if get_response.status_code != 200:
                logger.warning(f"⚠️ Failed to get current content for video update: {get_response.status_code}")
                return
            
            current_data = get_response.json().get('data', {})
            existing_per_video_metadata = current_data.get('per_video_metadata', {})
            existing_video_urls = current_data.get('generated_video_urls', [])
            
            # Store video metadata with key image_{index}
            video_key = f"image_{image_index}"
            merged_video_metadata = {**existing_per_video_metadata, video_key: per_video_metadata}
            
            # Add video URL to generated_video_urls if not already present
            merged_video_urls = list(existing_video_urls)
            if video_url not in merged_video_urls:
                merged_video_urls.append(video_url)
            
            # Update with merged data using video endpoint
            update_response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/video",
                headers=headers,
                json={
                    "image_index": image_index,
                    "video_url": video_url,
                    "per_video_metadata": merged_video_metadata,
                    "generated_video_urls": merged_video_urls
                },
                timeout=10.0
            )
            
            if update_response.status_code != 200:
                logger.warning(f"⚠️ Failed to update video in DB: {update_response.status_code}")
                error_text = await update_response.text()
                logger.warning(f"   Error details: {error_text}")
            else:
                logger.info(f"✅ Video updated in database for image {image_index} with complete metadata")
                
    except Exception as e:
        logger.warning(f"⚠️ Error updating video in DB: {str(e)}")


# ============================================
# API ENDPOINTS
# ============================================

@router.post("/api/projects/{project_id}/unified-generation")
async def start_unified_generation(
    project_id: int, 
    request: ProjectUnifiedGenerationRequest,
    x_session_cookie: Optional[str] = Header(None, alias="X-Session-Cookie")
):
    """
    Start unified daily posts generation pipeline
    """
    try:
        # Extract session cookie from header (forwarded from TypeScript backend)
        session_cookie = x_session_cookie or request.session_cookie
        
        # Generate job_id if not provided
        job_id = request.job_id or str(uuid.uuid4())
        request.job_id = job_id
        request.session_cookie = session_cookie  # Store in request for pipeline
        
        # Create initial database record
        context = await gather_all_context(project_id, session_cookie)
        await create_initial_generation_record(project_id, job_id, context, session_cookie)
        
        # Store job in memory
        active_jobs[job_id] = {
            "project_id": project_id,
            "status": "running",
            "started_at": datetime.utcnow().isoformat()
        }
        
        # Start generation pipeline in background
        asyncio.create_task(run_generation_pipeline(job_id, request))
        
        return {
            "success": True,
            "job_id": job_id,
            "message": "Generation started"
        }
        
    except Exception as e:
        logger.error(f"❌ Error starting generation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/projects/{project_id}/unified-generation/progress/{job_id}")
async def get_generation_progress(project_id: int, job_id: str):
    """
    Get generation progress by job_id
    This endpoint is called by frontend via TypeScript backend
    """
    try:
        typescript_backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/job/{job_id}",
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data
            else:
                return {
                    "success": False,
                    "error": "Record not found"
                }
                
    except Exception as e:
        logger.error(f"❌ Error fetching progress: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

