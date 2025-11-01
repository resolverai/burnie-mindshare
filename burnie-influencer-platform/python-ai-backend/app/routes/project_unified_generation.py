"""
Unified Web3 Project Daily Posts Generation Endpoint
Handles complete flow: Context Gathering → Prompt Generation → Content Generation
With real-time progress updates via polling
"""
from fastapi import APIRouter, HTTPException
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
from app.config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Document decay configuration (N days)
DOCUMENT_DECAY_DAYS = 30  # Documents older than 30 days are excluded from context


# ============================================
# REQUEST MODELS
# ============================================

class ProjectUnifiedGenerationRequest(BaseModel):
    """Request for unified daily posts generation"""
    project_id: int
    job_id: Optional[str] = None  # If not provided, will be generated


# ============================================
# PROGRESS TRACKING (stored in database)
# ============================================

# Store active generation jobs in memory for quick access
active_jobs: Dict[str, Dict[str, Any]] = {}


# ============================================
# HELPER FUNCTIONS
# ============================================

async def fetch_project_context(project_id: int) -> Dict:
    """Fetch project context from TypeScript backend"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/context",
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


async def fetch_project_configuration(project_id: int) -> Dict:
    """Fetch project configuration from TypeScript backend"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{typescript_backend_url}/api/projects/{project_id}/configurations",
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


async def generate_presigned_url(s3_key: str, expiration: int = 3600, project_id: int = None) -> Optional[str]:
    """Generate presigned URL for S3 object"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
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
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                endpoint,
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


async def gather_all_context(project_id: int) -> Dict:
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
    context = await fetch_project_context(project_id)
    
    # Step 1.2: Fetch project configuration
    logger.info("  → Fetching project configuration...")
    config = await fetch_project_configuration(project_id)
    
    # Step 1.3: Apply document decay (filter out old documents)
    logger.info("  → Applying document decay (filtering old documents)...")
    documents_text = context.get('documents_text', [])
    if documents_text:
        valid_documents = apply_document_decay(documents_text)
        context['documents_text'] = valid_documents
        logger.info(f"  → Documents after decay: {len(valid_documents)}/{len(documents_text)}")
    
    # Step 1.4: Fetch live search data for links and Twitter handles (USES GROK LIVE SEARCH)
    links = context.get('linksJson', [])
    platform_handles = context.get('platform_handles', {})
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
    color_palette = context.get('color_palette', {})
    
    # Get content mix from configuration
    content_mix = config.get('content_mix', {'shitpost': 4, 'threads': 4, 'longpost': 2})
    
    # Get image model (video model is fixed to 'kling')
    image_model = config.get('image_model', 'seedream')
    
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
        'documents_text': valid_documents if documents_text else [],
        'platform_handles': context.get('platform_handles', {}),
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


async def create_initial_generation_record(project_id: int, job_id: str, context: Dict) -> bool:
    """Create initial database record for generation tracking"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
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
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content",
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


async def update_progress_in_db(project_id: int, job_id: str, progress_percent: int, progress_message: str):
    """Update progress in database"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/progress",
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
        await update_progress_in_db(project_id, job_id, 10, "Gathering context (including live search for links)...")
        context = await gather_all_context(project_id)
        logger.info(f"✅ Context gathering complete. Ready to generate prompts with all context.")
        
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
        print(f"🏢 Image Model: {context.get('image_model')}")
        print("=" * 80)
        
        # Step 2: Generate prompts with Grok (30%)
        # This is a SINGLE Grok call that uses ALL the pre-gathered context (including live_search_data)
        # No additional Grok calls are made here - all context is already gathered
        await update_progress_in_db(project_id, job_id, 30, "Generating prompts with Grok (using pre-gathered context)...")
        prompts = await generate_prompts(context)
        
        # Log parsed prompts (already logged raw output in generate_prompts)
        logger.info(f"✅ Successfully parsed {len(prompts)} prompt keys from Grok response")
        
        # Step 3: Generate images (50-90%)
        await update_progress_in_db(project_id, job_id, 50, "Generating images...")
        await generate_images(project_id, job_id, prompts, context)
        
        # Step 4: Complete (100%)
        await update_progress_in_db(project_id, job_id, 100, "Generation completed!")
        
        # Update status to completed
        try:
            typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
            async with httpx.AsyncClient() as client:
                await client.put(
                    f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/progress",
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
        await update_progress_in_db(project_id, job_id, 0, f"Error: {str(e)}")
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


def build_grok_prompt_for_projects(context: Dict, content_mix: Dict) -> str:
    """Build comprehensive Grok prompt for project daily posts generation"""
    num_threads = content_mix.get('threads', 4)
    num_shitposts = content_mix.get('shitpost', 4)
    num_longposts = content_mix.get('longpost', 2)
    
    project_context_str = build_project_context_string(context)
    color_palette = context.get('color_palette', {})
    
    # Get total number of posts from context (from config)
    total_posts = sum([num_threads, num_shitposts, num_longposts])
    
    # Build dynamic JSON example based on total_posts
    tweet_text_examples = ",\n  ".join([f'"tweet_text_{i}": {{"main_tweet": "...", "thread_array": [], "content_type": "thread|shitpost|longpost"}}' for i in range(1, total_posts + 1)])
    image_prompt_examples = ",\n  ".join([f'"image_prompt_{i}": "Detailed image generation prompt with color palette integration..."' for i in range(1, total_posts + 1)])
    json_example = f"""{{
  {tweet_text_examples},
  
  {image_prompt_examples},
  
  "clip_prompt_for_image_3": {{"image_index": 3, "image_prompt": "Original image prompt...", "clip_prompt": "Smooth motion description...", "tweet_text_index": 3}},
  "clip_prompt_for_image_7": {{"image_index": 7, "image_prompt": "Original image prompt...", "clip_prompt": "Smooth motion description...", "tweet_text_index": 7}},
  "clip_prompt_for_image_9": {{"image_index": 9, "image_prompt": "Original image prompt...", "clip_prompt": "Smooth motion description...", "tweet_text_index": 9}}
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
- Extract key insights from live search data (websites + Twitter handles)
- Align project information with current industry trends and discussions
- Reference competitor information strategically (without copying)
- Use recent document context to inform accurate details (prioritize documents with recent timestamps)
- Incorporate brand values, tone, and color palette naturally
- Ensure tweet texts feel current and relevant (use live search data for freshness)

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
   - **NEVER mention what context sources were used** - Don't say "based on documents" or "from Twitter handles" - just generate natural content
   - **NEVER mention word counts or character counts** - Don't say "this 2000-character post" or "this thread has 5 tweets" in the actual tweet text
   - **NEVER mention post type** - Don't say "this thread", "this longpost", "this shitpost" - just say "this post" or "here" or nothing at all
   - Generate authentic, natural content that flows organically without meta-commentary
   
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
   
   3. **Original Concept Creation & Optional Meme Character Integration**:
      - Generate a unique visual concept that amplifies the tweet's message
      - Create original scenes, characters, or compositions (do NOT copy templates)
      - Incorporate crypto/Web3 cultural elements naturally when relevant
      - **OPTIONAL MEME CHARACTERS** (Use ONLY when genuinely relevant):
        * Web2: Drake, Distracted Boyfriend, Woman Yelling at Cat, This is Fine Dog, Expanding Brain, Stonks Man, Chad Yes
        * Web3/Crypto: Pepe (various emotions), Wojak (FOMO/anxiety), Chad Crypto Trader, Bobo (bear market), Apu Apustaja (cute/helpful)
      - **CHARACTER GUIDELINES**: Only include if they genuinely add value; better no characters than forced ones
   
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
   
3. **3 CLIP PROMPTS** (for video generation):
   - Intelligently select 3 image prompts (out of 10) that would work BEST as videos
   - Selection criteria: maximum visual impact, engaging motion potential, Twitter engagement
   - For each selected image, generate a clip prompt that describes:
     * Smooth, natural motion (camera movement, object animation, transitions)
     * 10-second duration
     * Professional, shareable content
     * Must align with the corresponding tweet text and image prompt
   - IMPORTANT: Each clip prompt object MUST include the original image_prompt that it's based on

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


async def generate_images(project_id: int, job_id: str, prompts: Dict, context: Dict):
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
        presigned_logo_url = await generate_presigned_url(logo_url, project_id=project_id)
        if presigned_logo_url:
            print(f"✅ Presigned logo URL generated: {presigned_logo_url[:100]}...")
            logger.info(f"✅ Generated presigned URL for logo")
        else:
            print(f"⚠️ Failed to generate presigned URL for logo - continuing without logo")
            logger.warning(f"⚠️ Failed to generate presigned URL for logo - continuing without logo")
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
                await update_image_in_db(project_id, job_id, generated_image_urls, per_image_metadata, tweet_texts_array, i)
                print(f"✅ Database update complete\n")
                
                # Update progress
                progress = 50 + int((i / total_posts) * 40)  # 50-90%
                await update_progress_in_db(project_id, job_id, progress, f"Generated image {i}/{total_posts}")
                
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
    await update_image_in_db(project_id, job_id, generated_image_urls, per_image_metadata, tweet_texts_array, total_posts)
    print(f"✅ Final database update complete")
    print(f"{'='*80}\n")


async def generate_image_with_fal(fal_model_id: str, model_name: str, prompt: str, image_urls: List[str]) -> Dict:
    """Generate single image using Fal.ai"""
    arguments = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd"
    }
    
    # Always pass image_urls as array (even if empty) for nano-banana/seedream models
    if 'nano-banana' in fal_model_id or 'seedream' in fal_model_id:
        arguments["image_urls"] = image_urls if image_urls else []
        if image_urls:
            logger.info(f"🏷️ Passing logo to Fal.ai: {len(image_urls)} image(s)")
        else:
            logger.info(f"⚠️ No logo provided, generating without logo")
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
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
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


async def update_image_in_db(project_id: int, job_id: str, image_urls: List[str], per_image_metadata: Dict, tweet_texts: List[Dict], image_index: int):
    """Update database record with generated images and metadata"""
    try:
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
        async with httpx.AsyncClient() as client:
            response = await client.put(
                f"{typescript_backend_url}/api/projects/{project_id}/generated-content/{job_id}/images",
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
# API ENDPOINTS
# ============================================

@router.post("/api/projects/{project_id}/unified-generation")
async def start_unified_generation(project_id: int, request: ProjectUnifiedGenerationRequest):
    """
    Start unified daily posts generation pipeline
    """
    try:
        # Generate job_id if not provided
        job_id = request.job_id or str(uuid.uuid4())
        request.job_id = job_id
        
        # Create initial database record
        context = await gather_all_context(project_id)
        await create_initial_generation_record(project_id, job_id, context)
        
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
        typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:3001')
        
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

