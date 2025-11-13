"""
Context Pack Builder - Standalone Script (v2.0)
================================================

Purpose:
  Generate renewable context packs for content generation from external sources.
  Solves the "context exhaustion" problem for SMBs and web3 projects.

Sources:
  1. RSS Feeds (industry news, trending topics)
  2. Eventbrite Events (local wellness/industry events)
  3. Public Holidays (Nager.Date API)
  4. Local Context (OpenAI web search - local businesses, schools, news)
  5. Twitter/X Trends (Grok live search with x_source)

Output:
  JSON file with context packs (max 2 packs per run)

Requirements:
  pip install xai-sdk python-dateutil feedparser requests pytz openai python-dotenv
"""

import os
import sys
import json
import hashlib
import uuid
import datetime as dt
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple
from dateutil import tz
import requests
import feedparser
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
print(f"📁 Loading environment variables from: {env_path}")
load_dotenv(env_path)

# ---------- Configuration ----------
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EVENTBRITE_TOKEN = os.getenv("EVENTBRITE_TOKEN", "")

# Initialize OpenAI client
openai_client = None
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    print("✅ OpenAI client initialized")
else:
    print("⚠️  Warning: OPENAI_API_KEY not found")

# Recency and pack sizing knobs
RECENCY_DAYS_DEFAULT = 30
TWITTER_RECENCY_DAYS = 10
MAX_ITEMS_PER_SOURCE = 25
MAX_CONTEXT_PACKS = 2  # Maximum 2 packs per run
ITEMS_PER_PACK = 6

# ---------- Data Models ----------
@dataclass
class ContextItem:
    """Single piece of context from a source"""
    id: str
    source: str  # "rss" | "eventbrite" | "holiday" | "local" | "twitter"
    title: str
    url: Optional[str]
    summary: str
    location: Optional[str]
    industry_tags: List[str]
    topic_tags: List[str]
    published_at: Optional[str]
    event_start: Optional[str] = None
    event_end: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ContextPack:
    """Bundle of context items with freshness/diversity scores"""
    id: str
    client_id: str
    created_at: str
    use_before: str
    freshness_score: float
    diversity_score: float
    items: List[ContextItem]
    keywords: List[str]
    notes: str = ""


# ---------- Utility Functions ----------
def now_iso(timezone: tz.tzfile) -> str:
    """Return current time in ISO format"""
    return dt.datetime.now(tz=timezone).isoformat()


def days_from_now(days: int, timezone: tz.tzfile) -> str:
    """Return ISO timestamp N days from now"""
    return (dt.datetime.now(tz=timezone) + dt.timedelta(days=days)).isoformat()


def sha1(s: str) -> str:
    """Generate SHA1 hash of string"""
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def unique(items: List[ContextItem]) -> List[ContextItem]:
    """Deduplicate context items by URL + title"""
    seen = set()
    out = []
    for it in items:
        key = sha1((it.url or "") + "|" + it.title)
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out


def score_freshness(published_iso: Optional[str], timezone: tz.tzfile) -> float:
    """Score freshness of content (0.0-1.0)"""
    if not published_iso:
        return 0.5
    try:
        then = dt.datetime.fromisoformat(published_iso)
        now = dt.datetime.now(tz=timezone)
        delta_days = max(0.0, (now - then).total_seconds() / 86400.0)
        return max(0.0, min(1.0, 1.0 - (delta_days / 30.0)))
    except Exception:
        return 0.5


def score_diversity(item: ContextItem) -> float:
    """Score diversity of content (0.0-1.0)"""
    base = 0.3 + 0.1 * len(set(item.topic_tags + item.industry_tags))
    base += {
        "rss": 0.1,
        "eventbrite": 0.2,
        "holiday": 0.15,
        "local": 0.2,
        "twitter": 0.2
    }.get(item.source, 0.1)
    return min(1.0, base)


def extract_json_from_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if "```json" in response_text:
        json_start = response_text.find("```json") + 7
        json_end = response_text.find("```", json_start)
        return response_text[json_start:json_end].strip()
    elif "```" in response_text:
        json_start = response_text.find("```") + 3
        json_end = response_text.find("```", json_start)
        return response_text[json_start:json_end].strip()
    elif response_text.startswith("{") and response_text.endswith("}"):
        return response_text
    else:
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}") + 1
        if start_idx != -1 and end_idx > start_idx:
            return response_text[start_idx:end_idx]
        else:
            raise ValueError("No valid JSON found in response")


# ---------- OpenAI Keyword Generation (First LLM Call) ----------
def generate_keywords_with_openai(signup: Dict[str, Any]) -> Dict[str, Any]:
    """
    Use OpenAI to intelligently generate keywords for RSS feeds and local context search.
    Also determines timezone for the client's location.
    
    Returns:
        {
            "keywords_rss": ["keyword1", "keyword2", ...],
            "keywords_local_context": ["local keyword1", "local keyword2", ...],
            "timezone": "America/Toronto"
        }
    """
    print(f"\n{'='*80}")
    print("🤖 OPENAI KEYWORD GENERATION (First LLM Call)")
    print(f"{'='*80}")
    print(f"Industry: {signup.get('industry', 'N/A')}")
    print(f"Location: {signup.get('city', 'N/A')}, {signup.get('region', 'N/A')}, {signup.get('country', 'N/A')}")
    print(f"Website: {signup.get('website', 'N/A')}")
    
    if not openai_client:
        print("❌ ERROR: OpenAI client not initialized (missing OPENAI_API_KEY)")
        sys.exit(1)
    
    # Build context for LLM
    industry = signup.get("industry", "")
    city = signup.get("city", "")
    region = signup.get("region", "")
    country = signup.get("country", "")
    website = signup.get("website", "")
    
    system_prompt = """You are an expert marketing and content strategy AI specializing in keyword research and local context analysis.

Your task is to analyze a business's industry and location to generate TWO types of keywords:

1. **RSS Feed Keywords**: Broad industry terms for filtering news feeds
   - Industry-specific terminology
   - Related services, products, technologies
   - Trending topics and hashtags
   - Professional jargon and acronyms
   - 10-20 keywords total

2. **Local Context Keywords**: Geo-specific search queries for finding local relevance
   - Local businesses, clinics, centers, startups
   - Schools, colleges, universities (with programs/initiatives)
   - Community organizations, nonprofits
   - Regional news, events, and trends
   - Government programs and resources
   - 10-20 keywords total
   - MUST include location (city/region/country) in each keyword

3. **Timezone**: The IANA timezone string for the business location (e.g., "America/Toronto", "Europe/London")

**CRITICAL INSTRUCTIONS:**
- For SMBs (e.g., speech therapy, wellness, fitness, dental): Focus on local community connections, schools, health organizations
- For Web3/Tech (e.g., DeFi, NFT, Gaming): Focus on industry news, local tech hubs, blockchain communities, regional crypto events
- Local context keywords MUST be actionable search queries (e.g., "Toronto schools speech programs 2025", "Bay Area DeFi startups")
- Think about what LOCAL information would help create FRESH, RELEVANT, ENGAGING content for this business
- Consider seasonal/temporal aspects (e.g., back-to-school, tax season, conference seasons)

Return ONLY a JSON object with this exact structure:
{
  "keywords_rss": ["keyword1", "keyword2", ...],
  "keywords_local_context": ["local query 1", "local query 2", ...],
  "timezone": "America/Toronto"
}"""
    
    user_prompt = f"""Analyze this business and generate comprehensive keywords:

**Business Information:**
- Industry: {industry}
- City: {city}
- Region: {region}
- Country: {country}
- Website: {website}

Generate:
1. RSS feed keywords (broad industry terms)
2. Local context keywords (geo-specific search queries with location)
3. Timezone (IANA string)

Return ONLY the JSON object."""
    
    try:
        print("  → Calling OpenAI (gpt-4o-mini)...")
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=1500
        )
        
        response_text = response.choices[0].message.content.strip()
        
        print(f"  ← Received response ({len(response_text)} chars)")
        print(f"\n{'─'*80}")
        print("📄 OPENAI RAW OUTPUT:")
        print(f"{'─'*80}")
        print(response_text)
        print(f"{'─'*80}\n")
        
        # Parse JSON
        json_content = extract_json_from_response(response_text)
        data = json.loads(json_content)
        
        keywords_rss = data.get("keywords_rss", [])
        keywords_local = data.get("keywords_local_context", [])
        timezone_str = data.get("timezone", "America/Toronto")
        
        print(f"✅ Extracted {len(keywords_rss)} RSS keywords")
        print(f"✅ Extracted {len(keywords_local)} local context keywords")
        print(f"✅ Timezone: {timezone_str}")
        print(f"{'='*80}\n")
        
        return {
            "keywords_rss": keywords_rss,
            "keywords_local_context": keywords_local,
            "timezone": timezone_str
        }
        
    except Exception as e:
        print(f"❌ ERROR in OpenAI keyword generation: {e}")
        print("→ Falling back to simple keyword generation")
        
        # Fallback: simple keyword generation
        keywords_rss = [industry] if industry else []
        keywords_local = [f"{industry} in {city}"] if industry and city else []
        
        return {
            "keywords_rss": keywords_rss,
            "keywords_local_context": keywords_local,
            "timezone": "America/Toronto"
        }


# ---------- RSS Feeds ----------
def get_rss_feeds_for_keywords(keywords: List[str]) -> List[str]:
    """
    Dynamically select RSS feeds based on keywords.
    Returns industry-specific feeds.
    """
    feeds = []
    
    # Check if keywords contain health/wellness terms
    health_wellness_keywords = ["speech", "therapy", "wellness", "health", "fitness", "dental", "mental", "nutrition"]
    if any(kw in " ".join(keywords).lower() for kw in health_wellness_keywords):
        feeds.extend([
            "https://www.medicalnewstoday.com/rss",
            "https://www.psychologytoday.com/intl/front/feed",
            "https://news.google.com/rss/search?q=health+wellness&hl=en-CA&gl=CA&ceid=CA:en",
        ])
    
    # Check if keywords contain web3/crypto terms
    web3_crypto_keywords = ["defi", "nft", "gaming", "blockchain", "crypto", "web3", "dao", "metaverse", "token"]
    if any(kw in " ".join(keywords).lower() for kw in web3_crypto_keywords):
        feeds.extend([
            "https://cointelegraph.com/rss",
            "https://decrypt.co/feed",
            "https://news.google.com/rss/search?q=web3+crypto+blockchain&hl=en-US&gl=US&ceid=US:en",
        ])
    
    # If no specific category, add general tech/business feeds
    if not feeds:
        feeds.extend([
            "https://news.google.com/rss/search?q=business+technology&hl=en&gl=US&ceid=US:en",
        ])
    
    return feeds


def fetch_rss_items(keywords: List[str], location_hint: str, timezone: tz.tzfile, max_items: int = MAX_ITEMS_PER_SOURCE) -> List[ContextItem]:
    """Fetch items from RSS feeds - only filter by recency (last 30 days)"""
    print(f"\n{'='*80}")
    print("📰 FETCHING RSS FEEDS")
    print(f"{'='*80}")
    print(f"Keywords: {', '.join(keywords[:5])}{'...' if len(keywords) > 5 else ''}")
    print(f"Location: {location_hint}")
    
    # Get relevant RSS feeds based on keywords
    rss_feeds = get_rss_feeds_for_keywords(keywords)
    print(f"Selected {len(rss_feeds)} relevant RSS feeds based on keywords")
    
    # Calculate cutoff date (30 days ago)
    cutoff_date = dt.datetime.now(tz=timezone) - dt.timedelta(days=30)
    print(f"  ℹ️  Fetching items published after: {cutoff_date.strftime('%Y-%m-%d')}")
    
    items: List[ContextItem] = []
    for feed_url in rss_feeds:
        try:
            print(f"  → Parsing feed: {feed_url}")
            d = feedparser.parse(feed_url)
            feed_items = 0
            
            # Parse all entries from the feed
            for e in d.entries:
                title = getattr(e, "title", "")
                link = getattr(e, "link", None)
                summary = getattr(e, "summary", "") or getattr(e, "description", "")
                
                # Get publication date from pubDate (published_parsed in feedparser)
                pub_date = None
                pub_iso = None
                
                # Try to parse published_parsed (this is from <pubDate> in XML)
                if getattr(e, "published_parsed", None):
                    try:
                        pub_date = dt.datetime(*e.published_parsed[:6], tzinfo=timezone)
                        pub_iso = pub_date.isoformat()
                    except Exception:
                        pass
                
                # Only include items from last 30 days
                if pub_date and pub_date >= cutoff_date:
                    items.append(ContextItem(
                        id=str(uuid.uuid4()),
                        source="rss",
                        title=title[:200],
                        url=link,
                        summary=summary[:500],
                        location=location_hint,
                        industry_tags=[],
                        topic_tags=["rss", "news"],
                        published_at=pub_iso
                    ))
                    feed_items += 1
                    
                    # Stop after collecting max_items from this feed
                    if feed_items >= max_items:
                        break
            
            print(f"    ✓ Found {feed_items} items from last 30 days")
        except Exception as e:
            print(f"    ✗ Error parsing feed: {e}")
    
    print(f"\n✅ Total RSS items: {len(items)}")
    return items[:max_items * 3]  # Allow more items across all feeds


# ---------- Eventbrite Events ----------
def fetch_eventbrite_events(location: str, keywords: List[str], timezone: tz.tzfile, max_items: int = MAX_ITEMS_PER_SOURCE) -> List[ContextItem]:
    """
    Fetch local events from Eventbrite API
    
    Based on official API documentation:
    - Endpoint: GET /v3/events/search/
    - Authentication: Bearer token in Authorization header OR token query parameter
    - Reference: https://www.eventbrite.com/platform/api#/reference/event-search
    """
    print(f"\n{'='*80}")
    print("🎟️  FETCHING EVENTBRITE EVENTS")
    print(f"{'='*80}")
    print(f"Location: {location}")
    print(f"Keywords: {', '.join(keywords[:5])}{'...' if len(keywords) > 5 else ''}")
    
    items: List[ContextItem] = []
    
    if EVENTBRITE_TOKEN:
        print("  → Using Eventbrite API v3")
        
        # Authentication: Bearer token in Authorization header (recommended)
        headers = {
            "Authorization": f"Bearer {EVENTBRITE_TOKEN}",
            "Content-Type": "application/json"
        }
        
        # Build search query - use first 2-3 keywords for better results
        # Eventbrite q parameter supports space-separated keywords
        q = " ".join(keywords[:2]) if len(keywords) >= 2 else (keywords[0] if keywords else "events")
        
        # Correct API endpoint and parameters based on official docs
        # https://www.eventbrite.com/platform/api#/reference/event-search
        params = {
            "q": q,  # Search query
            "location.address": location,  # Location search
            "location.within": "50km",  # Search radius
            "start_date.range_start": dt.datetime.now(tz=timezone).isoformat(),  # Only future events
            "expand": "venue",  # Include venue details
            "page_size": min(max_items, 50),  # Max 50 per page (API limit)
            "sort_by": "date"  # Sort by date
        }
        
        try:
            print(f"  → Query: '{q}'")
            print(f"  → Location: {location}")
            print(f"  → Endpoint: GET https://www.eventbriteapi.com/v3/events/search/")
            
            # Make the API request
            # Note: Using Authorization header (recommended over token query param)
            r = requests.get(
                "https://www.eventbriteapi.com/v3/events/search/",
                headers=headers,
                params=params,
                timeout=30
            )
            
            print(f"  → Response status: {r.status_code}")
            
            if r.status_code == 200:
                data = r.json()
                events = data.get("events", [])
                pagination = data.get("pagination", {})
                
                print(f"    ✓ API returned {len(events)} events")
                print(f"    ℹ️  Pagination: {pagination.get('object_count', 0)} total results, page {pagination.get('page_number', 1)}")
                
                for ev in events[:max_items]:
                    name = ev.get("name", {})
                    title = name.get("text", "") if isinstance(name, dict) else str(name)
                    url = ev.get("url")
                    
                    desc_obj = ev.get("description", {}) or {}
                    desc = desc_obj.get("text", "") if isinstance(desc_obj, dict) else ""
                    
                    start_obj = ev.get("start", {}) or {}
                    start = start_obj.get("utc") or start_obj.get("local")
                    
                    end_obj = ev.get("end", {}) or {}
                    end = end_obj.get("utc") or end_obj.get("local")
                    
                    # Extract venue info if available
                    venue = ev.get("venue")
                    venue_name = ""
                    if venue and isinstance(venue, dict):
                        venue_name = venue.get("name", "")
                    
                    items.append(ContextItem(
                        id=str(uuid.uuid4()),
                        source="eventbrite",
                        title=title[:200],
                        url=url,
                        summary=(desc[:450] + f" | Venue: {venue_name}")[:500] if venue_name else desc[:500],
                        location=location,
                        industry_tags=[],
                        topic_tags=["event", "local"],
                        published_at=start,
                        event_start=start,
                        event_end=end
                    ))
                
                print(f"    ✓ Extracted {len(items)} events")
                
            elif r.status_code == 401:
                print(f"    ✗ Authentication failed: Invalid Eventbrite token")
                print(f"    → Please check your EVENTBRITE_TOKEN in .env")
                
            elif r.status_code == 404:
                print(f"    ✗ Eventbrite API error: 404 - Endpoint not found")
                error_data = r.json() if r.text else {}
                print(f"    → Error: {error_data.get('error_description', 'Unknown error')}")
                print(f"    → This might indicate no events found for the query")
                
            else:
                error_text = r.text[:300] if r.text else "No error details"
                print(f"    ✗ Eventbrite API error: {r.status_code}")
                print(f"    → Response: {error_text}")
                
        except requests.exceptions.Timeout:
            print(f"    ✗ Eventbrite API timeout (30s)")
        except requests.exceptions.RequestException as e:
            print(f"    ✗ Eventbrite API request error: {e}")
        except Exception as e:
            print(f"    ✗ Eventbrite API error: {e}")
            import traceback
            print(f"    → Traceback: {traceback.format_exc()[:500]}")
    else:
        print("  ℹ️  Eventbrite API token not configured (EVENTBRITE_TOKEN missing in .env)")
        print("  → Skipping Eventbrite events...")
    
    print(f"\n✅ Total Eventbrite items: {len(items)}")
    return items[:max_items]


# ---------- Public Holidays ----------
def fetch_holidays(country_code: str, year: int, max_items: int = MAX_ITEMS_PER_SOURCE) -> List[ContextItem]:
    """Fetch public holidays from Nager.Date API"""
    print(f"\n{'='*80}")
    print("📅 FETCHING PUBLIC HOLIDAYS")
    print(f"{'='*80}")
    print(f"Country: {country_code.upper()}")
    print(f"Year: {year}")
    
    items: List[ContextItem] = []
    try:
        url = f"https://date.nager.at/api/v3/PublicHolidays/{year}/{country_code.upper()}"
        print(f"  → Calling: {url}")
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        
        for h in r.json()[:max_items]:
            name = h.get("localName") or h.get("name")
            date = h.get("date")
            iso = f"{date}T00:00:00"
            items.append(ContextItem(
                id=str(uuid.uuid4()),
                source="holiday",
                title=f"Holiday: {name}",
                url=None,
                summary=h.get("name", ""),
                location=country_code.upper(),
                industry_tags=[],
                topic_tags=["holiday", "calendar"],
                published_at=iso,
                event_start=iso,
                event_end=iso,
                extra={"types": h.get("types")}
            ))
        print(f"    ✓ Found {len(items)} holidays")
    except Exception as e:
        print(f"    ✗ Holiday API error: {e}")
    
    print(f"\n✅ Total holiday items: {len(items)}")
    return items


# ---------- OpenAI Local Context Search (Second Call with Web Search) ----------
def fetch_local_context_with_openai(keywords_local: List[str], location: str, timezone: tz.tzfile, max_items: int = MAX_ITEMS_PER_SOURCE) -> List[ContextItem]:
    """
    Use OpenAI Responses API with web_search tool to fetch local context.
    This is the SECOND call that uses web search capabilities.
    
    Reference: https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
    """
    print(f"\n{'='*80}")
    print("🌐 OPENAI LOCAL CONTEXT SEARCH (Second Call with Web Search)")
    print(f"{'='*80}")
    print(f"Keywords: {', '.join(keywords_local[:3])}{'...' if len(keywords_local) > 3 else ''}")
    print(f"Location: {location}")
    
    if not openai_client:
        print("❌ ERROR: OpenAI client not initialized")
        return []
    
    items: List[ContextItem] = []
    
    # Combine keywords into a comprehensive search query
    search_query = " ".join(keywords_local[:5])  # Top 5 keywords
    
    # Parse location for user_location parameter
    location_parts = [x.strip() for x in location.split(',') if x.strip()]
    city = location_parts[0] if len(location_parts) > 0 else ""
    region = location_parts[1] if len(location_parts) > 1 else ""
    country = location_parts[2] if len(location_parts) > 2 else ""
    
    # Map country names to ISO codes (add more as needed)
    country_codes = {
        "Canada": "CA",
        "United States": "US",
        "United Kingdom": "GB",
        "Australia": "AU",
        # Add more mappings as needed
    }
    country_code = country_codes.get(country, "US")  # Default to US
    
    try:
        print(f"  → Calling OpenAI Responses API with web_search tool (gpt-5-mini)...")
        print(f"  → Search query: {search_query}")
        print(f"  → User location: {city}, {region}, {country_code}")
        
        # Use Responses API with web_search tool
        # Correct structure based on official examples
        response = openai_client.responses.create(
            model="gpt-5-mini",  # gpt-5-mini or gpt-5 or o4-mini support web_search
            tools=[{
                "type": "web_search",
                "user_location": {
                    "type": "approximate",
                    "country": country_code,
                    "city": city,
                    "region": region,
                } if city and country_code else None
            }],
            tool_choice="auto",
            input=f"""Find recent, relevant information about {search_query} in {location}.

Focus on:
- Local businesses, clinics, centers, startups
- Schools, colleges, universities (programs and initiatives)
- Community organizations and nonprofits
- Regional news and events
- Government programs and resources

For each result, extract:
- Title
- URL
- Brief summary (200-500 chars)
- Published date (if available)

Return as a JSON array: [{{"title": "...", "url": "...", "summary": "...", "published_date": "2025-01-15"}}]"""
        )
        
        # The Responses API returns output_text
        response_text = response.output_text or ""
        
        print(f"  ← Received response ({len(response_text)} chars)")
        print(f"\n{'─'*80}")
        print("📄 OPENAI LOCAL CONTEXT RAW OUTPUT:")
        print(f"{'─'*80}")
        print(response_text[:800] + "..." if len(response_text) > 800 else response_text)
        print(f"{'─'*80}\n")
        
        # Parse JSON from response
        try:
            json_content = extract_json_from_response(response_text)
            data = json.loads(json_content)
            
            if isinstance(data, dict):
                data = [data]
            
            for item in data[:max_items]:
                title = item.get("title", "Local Context")
                url = item.get("url")
                summary = item.get("summary", "")
                published = item.get("published_date")
                
                pub_iso = None
                if published:
                    try:
                        pub_dt = dt.datetime.fromisoformat(published.replace("Z", ""))
                        pub_iso = pub_dt.replace(tzinfo=timezone).isoformat()
                    except Exception:
                        pub_iso = now_iso(timezone)
                else:
                    pub_iso = now_iso(timezone)
                
                items.append(ContextItem(
                    id=str(uuid.uuid4()),
                    source="local",
                    title=title[:200],
                    url=url,
                    summary=summary[:500],
                    location=location,
                    industry_tags=[],
                    topic_tags=["local", "context", "fresh"],
                    published_at=pub_iso
                ))
            print(f"    ✓ Extracted {len(items)} items from JSON")
        except json.JSONDecodeError as e:
            print(f"    ✗ JSON parse error: {e}")
            print(f"    → Attempting text-based extraction...")
            # Fallback: extract any URLs and context from text
            items = extract_items_from_text(response_text, ["local", "context"], location, timezone)
    
    except Exception as e:
        print(f"  ✗ OpenAI local context search error: {e}")
        import traceback
        print(f"  → Error details: {traceback.format_exc()}")
    
    print(f"\n✅ Total local context items: {len(items)}")
    return items[:max_items]


def extract_items_from_text(text: str, topic_tags: List[str], location_hint: Optional[str], timezone: tz.tzfile) -> List[ContextItem]:
    """
    Fallback: Extract URLs and titles from text response.
    """
    import re
    items: List[ContextItem] = []
    
    for line in text.splitlines():
        m = re.search(r'(https?://[^\s\)]*)', line)
        if m:
            url = m.group(1).strip().rstrip(").,;")
            title = re.sub(r'https?://[^\s\)]*', '', line).strip(" -:\t")
            if not title:
                title = "Local Link"
            items.append(ContextItem(
                id=str(uuid.uuid4()),
                source="local",
                title=title[:200],
                url=url,
                summary=line.strip()[:500],
                location=location_hint,
                industry_tags=[],
                topic_tags=list(set(topic_tags + ["local"])),
                published_at=now_iso(timezone)
            ))
    
    return items


# ---------- Grok Twitter/X Search ----------
def grok_twitter_search_items(keywords: List[str], location: str, timezone: tz.tzfile, max_items: int = MAX_ITEMS_PER_SOURCE) -> List[ContextItem]:
    """
    Use Grok live search with x_source for Twitter/X trends.
    Follows exact pattern from project_unified_generation.py
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    from xai_sdk.search import SearchParameters, x_source
    
    print(f"\n{'='*80}")
    print("🐦 GROK TWITTER/X SEARCH (grok-4-latest)")
    print(f"{'='*80}")
    print(f"Keywords: {', '.join(keywords[:5])}{'...' if len(keywords) > 5 else ''}")
    print(f"Location: {location}")
    
    if not XAI_API_KEY:
        print("  ✗ No XAI_API_KEY found (skipping Twitter/X search)")
        return []
    
    items: List[ContextItem] = []
    
    # Calculate date range: last 10 days
    to_date = dt.datetime.now(tz=timezone)
    from_date = to_date - dt.timedelta(days=TWITTER_RECENCY_DAYS)
    
    print(f"  Date range: {from_date.strftime('%Y-%m-%d')} to {to_date.strftime('%Y-%m-%d')}")
    print(f"  Max search results: 20")
    
    try:
        client = Client(api_key=XAI_API_KEY, timeout=3600)
        
        # X source: WITH date range and max_results (exactly like unified generation)
        chat = client.chat.create(
            model="grok-4-latest",
            search_parameters=SearchParameters(
                mode="auto",
                max_search_results=20,
                from_date=from_date,
                to_date=to_date,
                sources=[x_source()]  # Open X search (no handle restrictions)
            ),
        )
        
        system_prompt = """You are a Twitter/X trends analyzer. Search for trending topics, discussions, and sentiment.

Return a JSON array of objects:
[
  {
    "title": "Topic or hashtag",
    "url": "https://twitter.com/...",
    "summary": "Summary of discussion/sentiment (200-500 chars)",
    "published_date": "2025-01-15T10:00:00"
  }
]

Focus on:
- Trending topics and hashtags
- Industry discussions
- Community sentiment
- Recent developments
- Engagement patterns"""
        
        user_prompt = f"""Search Twitter/X for trending discussions about: {', '.join(keywords[:5])}

Location context: {location}

Extract and return relevant tweets/trends with:
1. Topic or hashtag as title
2. Tweet URL (if available)
3. Brief summary of discussion
4. Timestamp (if available)

Return ONLY a JSON array of objects."""
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        print("  → Calling Grok (with date range and max_results)...")
        response = chat.sample()
        
        response_text = response.content.strip()
        print(f"  ← Received response ({len(response_text)} chars)")
        print(f"\n{'─'*80}")
        print("📄 GROK TWITTER RAW OUTPUT:")
        print(f"{'─'*80}")
        print(response_text[:800] + "..." if len(response_text) > 800 else response_text)
        print(f"{'─'*80}\n")
        
        # Parse JSON
        try:
            json_content = extract_json_from_response(response_text)
            data = json.loads(json_content)
            
            if isinstance(data, dict):
                data = [data]
            
            for item in data[:max_items]:
                title = item.get("title", "Twitter Trend")
                url = item.get("url")
                summary = item.get("summary", "")
                published = item.get("published_date")
                
                pub_iso = None
                if published:
                    try:
                        pub_dt = dt.datetime.fromisoformat(published.replace("Z", ""))
                        pub_iso = pub_dt.replace(tzinfo=timezone).isoformat()
                    except Exception:
                        pub_iso = now_iso(timezone)
                else:
                    pub_iso = now_iso(timezone)
                
                items.append(ContextItem(
                    id=str(uuid.uuid4()),
                    source="twitter",
                    title=title[:200],
                    url=url,
                    summary=summary[:500],
                    location=location,
                    industry_tags=[],
                    topic_tags=["twitter", "social", "trends"],
                    published_at=pub_iso
                ))
            print(f"    ✓ Extracted {len(items)} items from JSON")
        except json.JSONDecodeError as e:
            print(f"    ✗ JSON parse error: {e}")
            print(f"    → Attempting text-based extraction...")
            items = extract_items_from_text(response_text, ["twitter", "social"], location, timezone)
    
    except Exception as e:
        print(f"  ✗ Grok Twitter search error: {e}")
        import traceback
        print(f"  → Error details: {traceback.format_exc()}")
    
    print(f"\n✅ Total Twitter items: {len(items)}")
    return items[:max_items]


# ---------- Context Pack Builder ----------
def compute_use_before(items: List[ContextItem], timezone: tz.tzfile) -> str:
    """Compute use_before timestamp for a pack"""
    soonest_event = None
    for it in items:
        if it.event_start:
            try:
                t = dt.datetime.fromisoformat(it.event_start)
                soonest_event = t if (soonest_event is None or t < soonest_event) else soonest_event
            except Exception:
                pass
    
    if soonest_event:
        dt_local = soonest_event.astimezone(timezone).replace(hour=9, minute=0, second=0, microsecond=0)
        return (dt_local - dt.timedelta(days=1)).isoformat()
    
    avg_fresh = sum(score_freshness(it.published_at or it.event_start, timezone) for it in items) / max(1, len(items))
    days_out = int(round(21 - 14 * avg_fresh))
    return days_from_now(days_out, timezone)


def build_context_packs(
    client_id: str,
    signup: Dict[str, Any],
    existing_packs: List[ContextPack] = None,
    max_packs: int = MAX_CONTEXT_PACKS
) -> Tuple[List[ContextPack], List[ContextPack]]:
    """Build context packs from all sources"""
    if existing_packs is None:
        existing_packs = []
    
    print(f"\n{'='*80}")
    print("🚀 STARTING CONTEXT PACK GENERATION")
    print(f"{'='*80}")
    print(f"Client ID: {client_id}")
    print(f"Industry: {signup.get('industry', 'N/A')}")
    print(f"Location: {signup.get('city', 'N/A')}, {signup.get('region', 'N/A')}, {signup.get('country', 'N/A')}")
    print(f"Max Packs: {max_packs}")
    print(f"{'='*80}\n")
    
    # FIRST LLM CALL: Generate keywords + timezone
    keyword_data = generate_keywords_with_openai(signup)
    keywords_rss = keyword_data["keywords_rss"]
    keywords_local = keyword_data["keywords_local_context"]
    timezone_str = keyword_data["timezone"]
    
    # Get timezone object
    timezone = tz.gettz(timezone_str)
    if not timezone:
        print(f"⚠️  Warning: Invalid timezone '{timezone_str}', using America/Toronto")
        timezone = tz.gettz("America/Toronto")
    
    location_label = ", ".join([x for x in [signup.get('city'), signup.get('region'), signup.get('country')] if x])
    
    # Gather from all sources
    rss_items = fetch_rss_items(keywords_rss, location_label, timezone)
    event_items = fetch_eventbrite_events(location_label, keywords_rss, timezone)
    holiday_items = fetch_holidays(signup.get("country_code", "CA"), dt.datetime.now().year)
    
    # SECOND CALL: OpenAI local context search (with web search)
    local_items = fetch_local_context_with_openai(keywords_local, location_label, timezone)
    
    # Grok Twitter/X search
    twitter_items = grok_twitter_search_items(keywords_rss, location_label, timezone)
    
    # Combine and deduplicate
    all_items = unique(rss_items + event_items + holiday_items + local_items + twitter_items)
    
    print(f"\n{'='*80}")
    print("📊 CONTEXT ITEMS SUMMARY")
    print(f"{'='*80}")
    print(f"RSS: {len(rss_items)}")
    print(f"Eventbrite: {len(event_items)}")
    print(f"Holidays: {len(holiday_items)}")
    print(f"Local Context (OpenAI): {len(local_items)}")
    print(f"Twitter (Grok): {len(twitter_items)}")
    print(f"Total (after deduplication): {len(all_items)}")
    print(f"{'='*80}\n")
    
    # Filter by recency
    cutoff = dt.datetime.now(tz=timezone) - dt.timedelta(days=RECENCY_DAYS_DEFAULT)
    
    def is_recent(ci: ContextItem) -> bool:
        for iso in [ci.published_at, ci.event_start]:
            if iso:
                try:
                    t = dt.datetime.fromisoformat(iso)
                    if t >= cutoff:
                        return True
                except Exception:
                    continue
        return True
    
    fresh_items = [ci for ci in all_items if is_recent(ci)]
    print(f"🕒 Items after {RECENCY_DAYS_DEFAULT}-day recency filter: {len(fresh_items)}\n")
    
    # Score and sort items
    def item_score(ci: ContextItem) -> float:
        return 0.6 * score_freshness(ci.published_at or ci.event_start, timezone) + 0.4 * score_diversity(ci)
    
    fresh_items.sort(key=item_score, reverse=True)
    
    # Build packs
    print(f"{'='*80}")
    print("📦 BUILDING CONTEXT PACKS")
    print(f"{'='*80}\n")
    
    new_packs: List[ContextPack] = []
    bucket: List[ContextItem] = []
    
    all_keywords = keywords_rss + keywords_local
    
    for ci in fresh_items:
        bucket.append(ci)
        if len(bucket) >= ITEMS_PER_PACK:
            use_before = compute_use_before(bucket, timezone)
            pack = ContextPack(
                id=str(uuid.uuid4()),
                client_id=client_id,
                created_at=now_iso(timezone),
                use_before=use_before,
                freshness_score=sum(score_freshness(x.published_at or x.event_start, timezone) for x in bucket) / len(bucket),
                diversity_score=sum(score_diversity(x) for x in bucket) / len(bucket),
                items=bucket[:],
                keywords=all_keywords,
                notes="Auto-generated pack"
            )
            new_packs.append(pack)
            print(f"  ✓ Pack {len(new_packs)}: {len(bucket)} items, freshness={pack.freshness_score:.2f}, diversity={pack.diversity_score:.2f}")
            bucket = []
        
        if len(new_packs) >= max_packs:
            break
    
    # Add residual items if any
    if bucket and len(new_packs) < max_packs:
        use_before = compute_use_before(bucket, timezone)
        pack = ContextPack(
            id=str(uuid.uuid4()),
            client_id=client_id,
            created_at=now_iso(timezone),
            use_before=use_before,
            freshness_score=sum(score_freshness(x.published_at or x.event_start, timezone) for x in bucket) / len(bucket),
            diversity_score=sum(score_diversity(x) for x in bucket) / len(bucket),
            items=bucket[:],
            keywords=all_keywords,
            notes="Residual pack"
        )
        new_packs.append(pack)
        print(f"  ✓ Pack {len(new_packs)} (residual): {len(bucket)} items, freshness={pack.freshness_score:.2f}, diversity={pack.diversity_score:.2f}")
    
    # Deduplicate against existing packs
    existing_keys = set()
    for p in existing_packs:
        for it in p.items:
            existing_keys.add(sha1((it.url or "") + "|" + it.title))
    
    filtered_new: List[ContextPack] = []
    for p in new_packs:
        filtered_items = [it for it in p.items if sha1((it.url or "") + "|" + it.title) not in existing_keys]
        if filtered_items:
            p.items = filtered_items
            filtered_new.append(p)
    
    print(f"\n  → {len(filtered_new)} new packs after deduplication against existing packs")
    
    all_packs_sorted = sorted(existing_packs + filtered_new, key=lambda p: p.use_before)
    
    print(f"\n{'='*80}")
    print("✅ CONTEXT PACK GENERATION COMPLETE")
    print(f"{'='*80}")
    print(f"New packs: {len(filtered_new)}")
    print(f"Total packs: {len(all_packs_sorted)}")
    print(f"{'='*80}\n")
    
    return (filtered_new, all_packs_sorted)


# ---------- Main Execution ----------
def main():
    """Main entry point"""
    
    # Check for API keys
    if not OPENAI_API_KEY:
        print("❌ ERROR: OPENAI_API_KEY not found in .env file")
        sys.exit(1)
    
    print(f"\n{'='*80}")
    print("🎯 CONTEXT PACK BUILDER v2.0")
    print(f"{'='*80}")
    print(f"✅ OPENAI_API_KEY: {OPENAI_API_KEY[:20]}...")
    print(f"✅ XAI_API_KEY: {XAI_API_KEY[:20] if XAI_API_KEY else 'Not configured'}")
    print(f"✅ EVENTBRITE_TOKEN: {'Configured' if EVENTBRITE_TOKEN else 'Not configured'}")
    print(f"{'='*80}\n")
    
    # Example signup data (modify as needed)
    signup = {
        "industry": "Speech Therapy & Wellness",
        "city": "Toronto",
        "region": "Ontario",
        "country": "Canada",
        "country_code": "CA",
        "website": "https://speechwellnesscentre.com",
    }
    
    # For Web3 project example, uncomment:
    # signup = {
    #     "industry": "DeFi",
    #     "city": "San Francisco",
    #     "region": "California",
    #     "country": "United States",
    #     "country_code": "US",
    #     "website": "https://example-defi.com",
    # }
    
    client_id = "client_demo_001"
    
    # Build context packs
    new_packs, all_packs = build_context_packs(
        client_id=client_id,
        signup=signup,
        existing_packs=[],
        max_packs=MAX_CONTEXT_PACKS
    )
    
    # Convert to dict for JSON serialization
    def pack_to_dict(p: ContextPack) -> Dict[str, Any]:
        d = asdict(p)
        d["items"] = [asdict(i) for i in p.items]
        return d
    
    output = {
        "generated_at": dt.datetime.now().isoformat(),
        "client_id": client_id,
        "signup": signup,
        "new_packs_count": len(new_packs),
        "all_packs_count": len(all_packs),
        "new_packs": [pack_to_dict(p) for p in new_packs]
    }
    
    # Save to JSON file
    output_file = f"context_packs_{client_id}_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n{'='*80}")
    print(f"💾 OUTPUT SAVED TO: {output_file}")
    print(f"{'='*80}")
    print(f"\nGenerated {len(new_packs)} context packs with {sum(len(p.items) for p in new_packs)} total items")
    print(f"\nTo view the output:")
    print(f"  cat {output_file} | jq .")
    print(f"\nOr open in your editor:")
    print(f"  open {output_file}")
    print()


if __name__ == "__main__":
    main()
