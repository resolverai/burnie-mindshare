"""
Mining Context Service

Gathers comprehensive context for mining content generation (CrewAI).
Similar to unified generation approach but tailored for miners.

Combines:
1. Admin context (campaigns + projects tables)
2. User-specific context (user_mining_context table)
3. Document decay (30 days)
4. Live search (links + Twitter handles)
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse

from app.config.settings import settings
from app.database.repositories.campaign_repository import CampaignRepository
from app.database.repositories.user_repository import UserRepository

logger = logging.getLogger(__name__)

# Document decay: 30 days
DOCUMENT_DECAY_DAYS = 30


def apply_document_decay(documents_text: List[Dict], decay_days: int = DOCUMENT_DECAY_DAYS) -> List[Dict]:
    """
    Apply time decay to documents.
    Returns only documents uploaded within the last N days.
    """
    if not documents_text or not isinstance(documents_text, list):
        return []
    
    cutoff_date = datetime.utcnow() - timedelta(days=decay_days)
    valid_documents = []
    
    for doc in documents_text:
        if not isinstance(doc, dict):
            continue
        
        timestamp_str = doc.get('timestamp')
        if not timestamp_str:
            continue
        
        try:
            doc_date = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            if doc_date.tzinfo:
                doc_date = doc_date.replace(tzinfo=None)
            
            if doc_date >= cutoff_date:
                valid_documents.append(doc)
        except Exception as e:
            logger.warning(f"⚠️ Error parsing document timestamp: {e}")
            valid_documents.append(doc)
    
    logger.info(f"📚 Document decay: {len(documents_text)} total → {len(valid_documents)} within {decay_days} days")
    return valid_documents


async def fetch_live_search_web_context(links: List[Dict]) -> Dict[str, str]:
    """
    Use Grok live search with web_source (NO date range for comprehensive context).
    Fetches context from website links.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    from xai_sdk.search import SearchParameters, web_source
    
    # Extract URLs from links (limit to 10 for performance)
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
    
    logger.info(f"📎 Fetching web context from {len(allowed_websites)} websites...")
    
    try:
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            logger.warning("⚠️ No Grok API key for web live search")
            return {}
        
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # Use web_source with allowed_websites, max_results, and citations
        # NO date range for comprehensive historical + current context
        chat = client.chat.create(
            model="grok-4-fast-reasoning",
            search_parameters=SearchParameters(
                mode="on",  # Force live search
                sources=[web_source(allowed_websites=allowed_websites)],
                max_search_results=20,  # Get comprehensive results
                return_citations=True  # Get source citations
            )
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
        
        logger.info("🔄 Calling Grok for web context with live search (max 20 results)...")
        response = chat.sample()
        
        response_text = response.content.strip()
        
        # Log citations if available
        if hasattr(response, 'citations') and response.citations:
            logger.info(f"📚 Received {len(response.citations)} citations from Grok")
        
        # Extract JSON from response
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            json_content = response_text[json_start:json_end]
            web_data = json.loads(json_content)
            logger.info(f"✅ Fetched web context from {len(web_data)} websites")
            return web_data
        else:
            logger.warning("⚠️ No JSON found in web search response")
            return {}
        
    except Exception as e:
        logger.error(f"❌ Error in web live search: {e}")
        return {}


async def fetch_live_search_twitter_context(platform_handles: Dict) -> Dict[str, str]:
    """
    Use Grok live search with x_source for Twitter/X handles (with date range for recent content).
    Fetches recent Twitter discussions.
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    from xai_sdk.search import SearchParameters, x_source
    from datetime import datetime, timedelta
    
    twitter_handles = platform_handles.get('twitter', [])
    if not twitter_handles:
        return {}
    
    logger.info(f"🐦 Fetching Twitter context for {len(twitter_handles)} handles...")
    
    try:
        grok_api_key = settings.xai_api_key
        if not grok_api_key:
            logger.warning("⚠️ No Grok API key for Twitter live search")
            return {}
        
        client = Client(api_key=grok_api_key, timeout=3600)
        
        # Clean handles (remove @ if present)
        clean_handles = []
        for handle in twitter_handles[:10]:  # Limit to 10 handles
            if isinstance(handle, str):
                clean_handle = handle.strip().replace('@', '')
                if clean_handle:
                    clean_handles.append(clean_handle)
        
        if not clean_handles:
            return {}
        
        # Date range: last 10 days for recent context
        to_date = datetime.now()
        from_date = to_date - timedelta(days=10)
        
        # Use x_source with included_x_handles and date range
        chat = client.chat.create(
            model="grok-4-fast-reasoning",
            search_parameters=SearchParameters(
                mode="on",  # Force live search
                sources=[x_source(included_x_handles=clean_handles)],
                from_date=from_date,
                to_date=to_date,
                max_search_results=20,  # Limit results for performance
                return_citations=True  # Get source citations
            )
        )
        
        system_prompt = """You are a Twitter content analyzer. Extract and summarize recent Twitter discussions.

Return a JSON object with Twitter handle as key and summary as value.
Example: {"@project": "Summary...", "@founder": "Summary..."}

Focus on:
- Recent announcements and updates (last 10 days)
- Community sentiment and reactions
- Key discussions and trending topics
- Important replies and mentions"""
        
        user_prompt = f"""Please gather recent Twitter discussions (last 10 days) from these accounts:
{', '.join(['@' + h for h in clean_handles])}

Extract and summarize:
1. Recent tweets and announcements
2. Community reactions and sentiment
3. Key discussions and trending topics
4. Important replies and mentions
5. Any significant news or updates

Return ONLY a JSON object with Twitter handles (include @) as keys and summaries as values."""
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        logger.info("🔄 Calling Grok for Twitter context with live search (10 days, max 20 results)...")
        response = chat.sample()
        
        response_text = response.content.strip()
        
        # Log citations if available
        if hasattr(response, 'citations') and response.citations:
            logger.info(f"📚 Received {len(response.citations)} citations from Grok")
        
        # Extract JSON from response
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        if json_start >= 0 and json_end > json_start:
            json_content = response_text[json_start:json_end]
            twitter_data = json.loads(json_content)
            logger.info(f"✅ Fetched Twitter context for {len(twitter_data)} handles")
            return twitter_data
        else:
            logger.warning("⚠️ No JSON found in Twitter search response")
            return {}
        
    except Exception as e:
        logger.error(f"❌ Error in Twitter live search: {e}")
        return {}


async def fetch_live_search_data_for_links(links: List[Dict], platform_handles: Dict) -> Dict[str, Any]:
    """
    Fetch live search data from both web sources and Twitter handles.
    """
    logger.info("=" * 80)
    logger.info("🔍 STARTING LIVE SEARCH FOR MINING CONTEXT GATHERING")
    logger.info("=" * 80)
    
    # Fetch in parallel
    web_context_task = fetch_live_search_web_context(links if links else [])
    twitter_context_task = fetch_live_search_twitter_context(platform_handles if platform_handles else {})
    
    web_context, twitter_context = await asyncio.gather(web_context_task, twitter_context_task)
    
    combined_data = {
        "web_context": web_context,
        "twitter_context": twitter_context,
        "combined_insights": f"Web sources: {len(web_context)}, Twitter sources: {len(twitter_context)}"
    }
    
    logger.info(f"✅ Live search complete: {len(web_context)} web, {len(twitter_context)} Twitter")
    logger.info("=" * 80)
    
    return combined_data


async def fetch_user_mining_context_from_ts_backend(user_id: int, campaign_id: int) -> Optional[Dict]:
    """
    Fetch user mining context from TypeScript backend API.
    """
    try:
        import httpx
        
        ts_backend_url = settings.typescript_backend_url or 'http://localhost:4000'
        
        # Get user's wallet address
        user_repo = UserRepository()
        user_data = user_repo.get_user_by_id(user_id)
        if not user_data:
            logger.info(f"ℹ️ No user found for user_id {user_id}")
            return None
        
        wallet_address = user_data.get('walletAddress')
        if not wallet_address:
            logger.info(f"ℹ️ No wallet address for user_id {user_id}")
            return None
        
        url = f"{ts_backend_url}/api/mining-context/user/{wallet_address}/campaign/{campaign_id}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            
            if response.status_code == 200:
                result = response.json()
                context_data = result.get('data')
                
                if context_data:
                    logger.info(f"✅ Fetched user mining context for user {user_id}, campaign {campaign_id}")
                    return context_data
                else:
                    logger.info(f"ℹ️ No user mining context found for user {user_id}, campaign {campaign_id}")
                    return None
            else:
                logger.warning(f"⚠️ Failed to fetch user mining context: HTTP {response.status_code}")
                return None
                
    except Exception as e:
        logger.error(f"❌ Error fetching user mining context: {e}")
        return None


async def gather_miner_context(user_id: int, campaign_id: int) -> Dict:
    """
    Gather comprehensive context for mining content generation.
    
    Combines:
    1. Admin context (campaigns + projects)
    2. User-specific context (user_mining_context)
    3. Document decay
    4. Live search
    
    Returns unified context dict similar to web3 projects.
    """
    logger.info(f"📚 Gathering miner context for user {user_id}, campaign {campaign_id}")
    
    # Step 1: Fetch admin context (campaigns + projects)
    campaign_repo = CampaignRepository()
    campaign_data = campaign_repo.get_campaign_by_id(campaign_id)
    
    if not campaign_data:
        logger.error(f"❌ Campaign {campaign_id} not found")
        return {}
    
    admin_context = {
        'campaign_id': campaign_id,
        'campaign_title': campaign_data.get('title', ''),
        'campaign_description': campaign_data.get('description', ''),
        'campaign_category': campaign_data.get('category', ''),
        'brand_guidelines': campaign_data.get('brandGuidelines', ''),
        'platform_source': campaign_data.get('platformSource', 'twitter'),
        'project_id': campaign_data.get('projectId'),
        'project_name': campaign_data.get('projectName', ''),
        'project_logo': campaign_data.get('projectLogo', ''),
        'token_ticker': campaign_data.get('tokenTicker', ''),
        'project_twitter_handle': campaign_data.get('projectTwitterHandle', ''),
        'admin_documents_text': campaign_data.get('documents_text') or [],  # ADMIN DOCUMENTS (ensure list)
        'admin_color_palette': campaign_data.get('color_palette') or {},    # ADMIN COLOR PALETTE (ensure dict)
    }
    
    print(f"\n🔍 === ADMIN CONTEXT LOADED ===")
    print(f"   - Description: {len(admin_context.get('campaign_description') or '')} chars")
    print(f"   - Brand Guidelines: {len(admin_context.get('brand_guidelines') or '')} chars")
    print(f"   - Admin Documents: {len(admin_context.get('admin_documents_text') or [])} docs")
    print(f"   - Admin Color Palette: {admin_context.get('admin_color_palette') or {}}")
    print(f"================================\n")
    
    logger.info(f"✅ Admin context fetched: {admin_context['project_name']}")
    
    # Step 2: Fetch user-specific context (user_mining_context)
    user_context_data = await fetch_user_mining_context_from_ts_backend(user_id, campaign_id)
    
    # Step 3: Process user context (if exists)
    user_context = {}
    live_search_data = {}
    
    if user_context_data:
        logger.info(f"✅ User-specific context found")
        
        print(f"\n🔍 === USER CONTEXT LOADED ===")
        print(f"   - brand_values: {len(user_context_data.get('brand_values', '') or '')} chars")
        print(f"   - details_text: {len(user_context_data.get('details_text', '') or '')} chars")
        print(f"   - content_text: {len(user_context_data.get('content_text', '') or '')} chars")
        print(f"   - keywords: {user_context_data.get('keywords', 'N/A')}")
        print(f"   - goals: {len(user_context_data.get('goals', '') or '')} chars")
        print(f"   - competitors: {len(user_context_data.get('competitors', '') or '')} chars")
        print(f"================================\n")
        
        # Apply document decay
        documents_text_raw = user_context_data.get('documents_text')
        documents_text = documents_text_raw if isinstance(documents_text_raw, list) else []
        valid_documents = apply_document_decay(documents_text, DOCUMENT_DECAY_DAYS) if documents_text else []
        
        # Filter out images (documents without extracted text)
        # Only include documents that have actual text content
        documents_with_text = []
        if valid_documents:
            for doc in valid_documents:
                if isinstance(doc, dict):
                    doc_text = doc.get('text', '').strip()
                    doc_type = doc.get('type', 'document')
                    # Include only if:
                    # 1. It has text content, OR
                    # 2. It's explicitly a document (not an image)
                    if doc_text:  # Has extracted text
                        documents_with_text.append(doc)
                    elif doc_type == 'image':  # Explicitly marked as image
                        logger.info(f"🖼️ Skipping image without text: {doc.get('name', 'Unknown')}")
                        continue
                    else:  # Document type but no text (extraction failed)
                        logger.warning(f"⚠️ Document has no text (extraction may have failed): {doc.get('name', 'Unknown')}")
                        # Still skip if no text
            
            logger.info(f"📄 Filtered documents: {len(valid_documents)} total → {len(documents_with_text)} with text content")
            valid_documents = documents_with_text
        
        # Get links and platform handles
        links = user_context_data.get('linksJson', [])
        platform_handles = user_context_data.get('platform_handles', {})
        
        # Step 4: Live search (if user provided links/handles)
        has_links = links and isinstance(links, list) and len(links) > 0
        has_twitter_handles = platform_handles and isinstance(platform_handles, dict) and platform_handles.get('twitter')
        
        if has_links or has_twitter_handles:
            logger.info(f"🔍 Performing live search: {len(links) if has_links else 0} links, {len(platform_handles.get('twitter', [])) if has_twitter_handles else 0} Twitter handles")
            live_search_data = await fetch_live_search_data_for_links(
                links if has_links else [],
                platform_handles if has_twitter_handles else {}
            )
        
        # Build user context with safe null/None handling
        user_context = {
            'brand_values': user_context_data.get('brand_values') or '',
            'details_text': user_context_data.get('details_text') or '',
            'content_text': user_context_data.get('content_text') or '',
            'keywords': user_context_data.get('keywords') or '',
            'goals': user_context_data.get('goals') or '',
            'competitors': user_context_data.get('competitors') or '',
            'color_palette': user_context_data.get('color_palette') or {},
            'documents_text': valid_documents or [],
            'links': links or [],
            'platform_handles': platform_handles or {},
            'tone': user_context_data.get('tone') or '',
            'website': user_context_data.get('website') or '',
            'chain': user_context_data.get('chain') or '',
            'token_symbol': user_context_data.get('tokenSymbol') or '',
        }
    else:
        logger.info(f"ℹ️ No user-specific context found, using empty defaults")
        # Set empty defaults when no user context
        user_context = {
            'brand_values': '',
            'details_text': '',
            'content_text': '',
            'keywords': '',
            'goals': '',
            'competitors': '',
            'color_palette': {},
            'documents_text': [],
            'links': [],
            'platform_handles': {},
            'tone': '',
            'website': '',
            'chain': '',
            'token_symbol': '',
        }
    
    # Step 5: Combine all contexts (careful not to overwrite admin fields)
    combined_context = {
        # Admin context (core campaign info)
        **admin_context,
        
        # Add 'description' key for backward compatibility (points to campaign description)
        'description': admin_context['campaign_description'],
        
        # Color palette: User overrides admin if set, otherwise use admin, with final fallback to defaults
        'color_palette': user_context.get('color_palette') or admin_context.get('admin_color_palette') or {
            'primary': '#1DA1F2',
            'secondary': '#14171A',
            'accent': '#FFAD1F'
        },
        
        # User-specific context fields (prefixed to avoid conflicts)
        'user_context': user_context,
        'has_user_context': bool(user_context_data),
        
        # Documents: Keep user and admin separate
        'documents_text': user_context.get('documents_text', []),  # User documents
        'documents_count': len(user_context.get('documents_text', [])) + len(admin_context['admin_documents_text']),
        
        # Links and handles (user only)
        'links': user_context.get('links', []),
        'links_count': len(user_context.get('links', [])),
        'platform_handles': user_context.get('platform_handles', {}),
        
        # Live search
        'live_search_data': live_search_data,
        'has_live_search': bool(live_search_data),
    }
    
    logger.info(f"✅ Context gathering complete:")
    logger.info(f"   - Has user context: {combined_context['has_user_context']}")
    logger.info(f"   - Has live search: {combined_context['has_live_search']}")
    logger.info(f"   - Admin documents: {len(admin_context['admin_documents_text'])}")
    logger.info(f"   - User documents: {len(user_context.get('documents_text', []))}")
    logger.info(f"   - Total documents: {combined_context['documents_count']}")
    logger.info(f"   - Links: {combined_context['links_count']}")
    
    return combined_context

