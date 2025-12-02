"""
DVYB Website Analysis Endpoint
Automatically extracts business information from a website URL using OpenAI web search.

Uses gpt-5-mini (Responses API) with web search to extract:
- Business Overview & Positioning
- Customer Demographics & Psychographics
- Most Popular Products & Services
- Why Customers Choose <Brand>
- Brand Story
- Color Palette (primary, secondary, accent)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import Optional, List, Dict, Any
import logging
import re
import urllib.parse
import time
import requests
from bs4 import BeautifulSoup
from collections import Counter

from openai import OpenAI
import os
import boto3
from botocore.exceptions import ClientError
import uuid
import io

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize OpenAI client
openai_client = None
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    logger.info("✅ OpenAI client initialized for website analysis")
else:
    logger.warning("⚠️ OPENAI_API_KEY not found - website analysis will not work")


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class WebsiteAnalysisRequest(BaseModel):
    """Request for website analysis"""
    url: str
    account_id: Optional[int] = None


class WebsiteAnalysisResponse(BaseModel):
    """Response from website analysis"""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ============================================
# UTILITY FUNCTIONS
# ============================================

HEX_RE = re.compile(r'#([0-9a-fA-F]{3,8})\b')
RGB_RE = re.compile(r'rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)')


def extract_base_name(url: str) -> str:
    """
    Extract base name from URL hostname.
    Example: https://dvyb.ai -> dvyb
             https://www.creatify.ai -> creatify
    """
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc or parsed.path
        host = host.lower()
        
        # Remove www.
        if host.startswith("www."):
            host = host[4:]
        
        # Remove port
        host = host.split(':')[0]
        
        # Take first segment before dot
        base = host.split('.')[0]
        
        # Clean up
        base = re.sub(r'[^a-z0-9\-]', '', base)
        
        return base
    except Exception as e:
        logger.error(f"Error extracting base name: {e}")
        return "brand"


def fetch_url(url: str, timeout=12):
    """Fetch URL content with proper headers"""
    headers = {
        "User-Agent": "DVYB-WebsiteAnalyzer/1.0 (+https://dvyb.ai)"
    }
    resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
    resp.raise_for_status()
    return resp


def extract_text_snippets(soup: BeautifulSoup, max_chars=3000) -> str:
    """Extract key text snippets from HTML"""
    parts = []
    
    # Title
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    if title:
        parts.append(f"Title: {title}")
    
    # Meta description
    meta_desc = soup.find("meta", attrs={"name": "description"}) or \
                soup.find("meta", attrs={"property": "og:description"})
    if meta_desc and meta_desc.get("content"):
        parts.append(f"Description: {meta_desc.get('content').strip()}")
    
    # Headings
    for tagname in ["h1", "h2", "h3"]:
        for t in soup.find_all(tagname)[:5]:
            text = t.get_text(separator=" ", strip=True)
            if text:
                parts.append(f"{tagname.upper()}: {text}")
    
    # Paragraphs
    for p in soup.find_all("p")[:10]:
        text = p.get_text(separator=" ", strip=True)
        if text and len(text) > 20:  # Skip very short paragraphs
            parts.append(text)
    
    joined = "\n\n".join(parts)
    return joined[:max_chars]


def find_css_links(soup: BeautifulSoup, base_url: str) -> List[str]:
    """Find all CSS links in HTML"""
    links = []
    for tag in soup.find_all("link", rel=lambda v: v and 'stylesheet' in v):
        href = tag.get("href")
        if href:
            links.append(urllib.parse.urljoin(base_url, href))
    return links


def find_hexes_in_text(text: str) -> List[str]:
    """Find all hex color codes in text"""
    hexes = HEX_RE.findall(text)
    normalized = []
    
    for h in hexes:
        if len(h) == 3:
            # Expand 'abc' -> 'aabbcc'
            normalized.append(''.join([c*2 for c in h.lower()]))
        elif len(h) == 6:
            normalized.append(h.lower())
        elif len(h) == 8:
            # Drop alpha channel
            normalized.append(h.lower()[:6])
    
    return ['#' + h for h in normalized]


def find_rgbs_in_text(text: str) -> List[str]:
    """Find all RGB color codes and convert to hex"""
    results = []
    for m in RGB_RE.finditer(text):
        r, g, b = m.groups()
        try:
            r, g, b = int(r), int(g), int(b)
            if 0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255:
                results.append('#{:02x}{:02x}{:02x}'.format(r, g, b))
        except:
            continue
    return results


def rank_colors(all_colors: List[str]) -> List[Optional[str]]:
    """
    Rank colors by frequency and return top 3.
    Filters out common colors (white, black, grays).
    """
    if not all_colors:
        return [None, None, None]
    
    # Filter out very common colors
    exclude_colors = {
        '#ffffff', '#fff', '#000000', '#000',
        '#f0f0f0', '#e0e0e0', '#d0d0d0', '#c0c0c0',
        '#808080', '#606060', '#404040', '#202020'
    }
    
    filtered = [c for c in all_colors if c.lower() not in exclude_colors]
    
    if not filtered:
        # If all were filtered, use originals
        filtered = all_colors
    
    c = Counter(filtered)
    ranked = [color for color, _ in c.most_common()]
    
    # Deduplicate while keeping order
    seen = set()
    unique = []
    for col in ranked:
        if col not in seen:
            unique.append(col)
            seen.add(col)
    
    # Pad to 3
    while len(unique) < 3:
        unique.append(None)
    
    return unique[:3]


def extract_colors_from_website(url: str, html: str, soup: BeautifulSoup) -> Dict[str, Optional[str]]:
    """Extract color palette from website"""
    try:
        # Find CSS links
        css_links = find_css_links(soup, url)
        css_texts = []
        
        # Inline <style> tags
        for st in soup.find_all("style"):
            if st.string:
                css_texts.append(st.string)
        
        # Fetch top few linked CSS files
        for link in css_links[:6]:
            try:
                r = fetch_url(link)
                css_texts.append(r.text)
                time.sleep(0.2)  # Be polite
            except Exception:
                continue
        
        # Combine all text for color extraction
        combined_text = html + "\n" + "\n".join(css_texts)
        
        # Extract colors
        hex_colors = find_hexes_in_text(combined_text)
        rgb_colors = find_rgbs_in_text(combined_text)
        all_colors = hex_colors + rgb_colors
        
        logger.info(f"  → Found {len(hex_colors)} hex colors and {len(rgb_colors)} rgb colors")
        print(f"  → Found {len(hex_colors)} hex colors and {len(rgb_colors)} rgb colors (total: {len(all_colors)})")
        
        # Rank colors
        ranked = rank_colors(all_colors)
        
        logger.info(f"  → Top ranked colors: {ranked[:5]}")
        
        return {
            "primary": ranked[0],
            "secondary": ranked[1],
            "accent": ranked[2],
        }
    except Exception as e:
        logger.error(f"Error extracting colors: {e}")
        return {
            "primary": None,
            "secondary": None,
            "accent": None,
        }


def extract_logo_url_from_html(url: str, soup: BeautifulSoup) -> Optional[str]:
    """
    Extract logo URL from website HTML.
    Tries multiple strategies to find the best logo.
    """
    try:
        logo_url = None
        
        # Strategy 1: Look for Open Graph image (og:image)
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            logo_url = og_image.get("content")
            logger.info(f"  → Found og:image: {logo_url}")
        
        # Strategy 2: Apple touch icon (usually high quality)
        if not logo_url:
            apple_icon = soup.find("link", rel=lambda v: v and 'apple-touch-icon' in v)
            if apple_icon and apple_icon.get("href"):
                logo_url = apple_icon.get("href")
                logger.info(f"  → Found apple-touch-icon: {logo_url}")
        
        # Strategy 3: Standard favicon
        if not logo_url:
            favicon = soup.find("link", rel=lambda v: v and 'icon' in v)
            if favicon and favicon.get("href"):
                logo_url = favicon.get("href")
                logger.info(f"  → Found favicon: {logo_url}")
        
        # Strategy 4: Default favicon location
        if not logo_url:
            parsed_url = urllib.parse.urlparse(url)
            logo_url = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"
            logger.info(f"  → Using default favicon: {logo_url}")
        
        # Convert relative URL to absolute
        if logo_url:
            logo_url = urllib.parse.urljoin(url, logo_url)
            logger.info(f"  → Final logo URL: {logo_url}")
        
        return logo_url
        
    except Exception as e:
        logger.error(f"Error extracting logo URL: {e}")
        return None


async def download_and_upload_logo_to_s3(logo_url: str, account_id: Optional[int] = None) -> Optional[Dict[str, str]]:
    """
    Download logo from URL and upload to S3.
    Returns dict with S3 key and presigned URL if successful, None otherwise.
    """
    try:
        logger.info(f"📥 Downloading logo from: {logo_url}")
        
        # Download logo
        headers = {
            "User-Agent": "DVYB-WebsiteAnalyzer/1.0 (+https://dvyb.ai)"
        }
        response = requests.get(logo_url, headers=headers, timeout=10, allow_redirects=True)
        response.raise_for_status()
        
        # Check if it's an image
        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            logger.warning(f"  ⚠️ Not an image: {content_type}")
            return None
        
        # Get file extension from content type
        ext_map = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/x-icon': 'ico',
            'image/vnd.microsoft.icon': 'ico',
        }
        ext = ext_map.get(content_type.lower(), 'png')
        
        logger.info(f"  → Downloaded {len(response.content)} bytes ({content_type})")
        
        # Upload to S3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION', 'us-east-1')
        )
        
        bucket_name = os.getenv('S3_BUCKET_NAME')  # Correct env var name
        if not bucket_name:
            logger.error("  ❌ S3_BUCKET_NAME not configured")
            return None
        
        # Generate S3 key
        account_folder = f"dvyb/logos/{account_id}" if account_id else "dvyb/logos/temp"
        filename = f"{uuid.uuid4()}.{ext}"
        s3_key = f"{account_folder}/{filename}"
        
        # Upload
        s3_client.upload_fileobj(
            io.BytesIO(response.content),
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': content_type,
                'CacheControl': 'max-age=31536000',  # 1 year cache
            }
        )
        
        logger.info(f"  ✅ Uploaded logo to S3: {s3_key}")
        
        # Generate presigned URL (expires in 1 hour)
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket_name,
                'Key': s3_key
            },
            ExpiresIn=3600  # 1 hour
        )
        
        print(f"\n🖼️  LOGO EXTRACTED AND UPLOADED TO S3:")
        print(f"   S3 Key: {s3_key}")
        print(f"   Presigned URL: {presigned_url[:80]}...")
        print(f"   Size: {len(response.content)} bytes")
        print(f"   Type: {content_type}\n")
        
        return {
            "s3_key": s3_key,
            "presigned_url": presigned_url
        }
        
    except Exception as e:
        logger.error(f"  ❌ Failed to download/upload logo: {e}")
        return None


def build_openai_prompt(base_name: str, url: str, site_snippet: str, extracted_colors: Dict) -> str:
    """Build prompt for OpenAI Responses API with web search"""
    
    color_hints = [c for c in [extracted_colors.get("primary"), extracted_colors.get("secondary"), extracted_colors.get("accent")] if c]
    color_hint_str = ", ".join(color_hints) if color_hints else "none found"
    
    prompt = f"""Analyze the website {url} (brand name: {base_name}) and provide a comprehensive business analysis.

**Extracted Site Content:**
{site_snippet[:1500]}

**Extracted Color Hints:** {color_hint_str}

**Task:** Conduct a DETAILED analysis using:
1. The provided URL ({url}) - search ALL pages (about, products, team, blog, etc.)
2. Customer reviews (ProductHunt, Trustpilot, G2, Capterra)
3. Social media (LinkedIn, Twitter, etc.)
4. Industry reports and competitive analysis
5. Press releases and news articles

Return a JSON object with this structure:

{{
  "base_name": "{base_name}",
  "business_overview_and_positioning": "Core Identity: [2-3 sentences]\\n\\nMarket Positioning:\\n• Primary Positioning: [statement]\\n• Secondary Positioning: [statement]\\n• Tertiary Positioning: [statement]\\n\\nDirect Competitors:\\nGlobal Competitors:\\n• [Competitor 1 with brief description]\\n• [Competitor 2 with brief description]\\n• [Competitor 3 with brief description]\\n• [Competitor 4 with brief description]\\n• [Competitor 5 with brief description]\\n\\nCompetitive Advantages:\\n1. [Advantage]: [explanation]\\n2. [Advantage]: [explanation]\\n3. [Advantage]: [explanation]\\n4. [Advantage]: [explanation]",
  "customer_demographics_and_psychographics": "Primary Customer Segments:\\n\\n1. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nKey need: [need]\\n\\n2. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nPain points: [pain points]\\n\\n3. [Segment] ([percentage]%)\\n• [characteristic]\\n• [characteristic]\\nKey interest: [interests]",
  "most_popular_products_and_services": ["Product 1: Description", "Product 2: Description", "Product 3: Description", "Product 4: Description", "Product 5: Description"],
  "why_customers_choose": "Primary Value Drivers:\\n1. [Driver]: [explanation]\\n2. [Driver]: [explanation]\\n3. [Driver]: [explanation]\\n4. [Driver]: [explanation]\\n\\nEmotional Benefits:\\n• [Benefit]: [how delivered]\\n• [Benefit]: [how delivered]\\n• [Benefit]: [how delivered]",
  "brand_story": "The Hero's Journey: [origin and evolution]\\n\\nMission Statement: [actual or inferred mission]\\n\\nBrand Personality:\\n• Archetype: [archetype]\\n• Voice: [tone]\\n• Values: [values]\\n\\n[Closing statement]",
  "color_palette": {{
    "primary": "{color_hints[0] if len(color_hints) > 0 else '#000000'}",
    "secondary": "{color_hints[1] if len(color_hints) > 1 else '#000000'}",
    "accent": "{color_hints[2] if len(color_hints) > 2 else '#000000'}"
  }},
  "source_urls": ["{url}", "other URLs used"]
}}

**CRITICAL REQUIREMENTS:**

1. **Direct Competitors:** You MUST list 3-5 actual, real competitors in the same industry. Research competitor analysis sites, industry reports, and "alternatives to [brand]" searches. DO NOT leave this section empty.

2. **Focus on {url}:** Start by thoroughly searching the main website ({url}) for all information - about page, products, services, team, blog, press, etc.

3. **Competitive Analysis:** Search for "[base_name] competitors", "[base_name] vs [competitor]", "best [industry] platforms", etc.

4. **Customer Reviews:** Find ProductHunt, Trustpilot, G2, or similar reviews to understand customer segments and value drivers.

5. **Color Palette:** Verify the extracted colors ({color_hint_str}) match the actual brand. If not, find the correct brand colors from the website or brand guidelines.

6. **Detailed Sections:** Provide specific, factual information. Avoid generic statements.

7. **JSON Only:** Return ONLY the JSON object. No markdown blocks, no explanatory text.

Return the JSON now:"""

    return prompt


async def call_openai_with_web_search(prompt: str, domain: str = None) -> str:
    """
    Call OpenAI Responses API with web_search tool.
    Uses domain filtering to focus search on the target website.
    
    Reference: https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
    """
    try:
        logger.info("🤖 Calling OpenAI Responses API (gpt-5-mini) with web_search tool...")
        
        # Build web_search tool configuration
        web_search_config = {
            "type": "web_search"
        }
        
        # Add domain filter if provided
        # Correct syntax: filters.allowed_domains (not domain_filter)
        if domain:
            # Extract clean domain (e.g., "creatify.ai" from "https://creatify.ai")
            import urllib.parse
            parsed = urllib.parse.urlparse(domain)
            clean_domain = parsed.netloc or parsed.path
            clean_domain = clean_domain.replace("www.", "")
            
            # Also include www version for broader coverage
            allowed_domains = [clean_domain]
            if not clean_domain.startswith("www."):
                allowed_domains.append(f"www.{clean_domain}")
            
            logger.info(f"  → Domain filters: {allowed_domains}")
            print(f"  → Domain filters: {allowed_domains}")
            
            # Correct Responses API syntax for domain filtering
            web_search_config["filters"] = {
                "allowed_domains": allowed_domains
            }
        
        # Use Responses API with web_search tool
        response = openai_client.responses.create(
            model="gpt-5-mini",  # gpt-5-mini supports web search via Responses API
            tools=[web_search_config],
            tool_choice="auto",
            input=prompt
        )
        
        # The Responses API returns output_text
        response_text = response.output_text or ""
        
        if not response_text:
            logger.error("❌ Empty response from OpenAI Responses API")
            raise Exception("Empty response from OpenAI")
        
        return response_text
        
    except AttributeError as e:
        logger.warning(f"⚠️  Responses API not available, falling back to Chat Completions API: {e}")
        print(f"⚠️  Responses API not available, falling back to Chat Completions API (gpt-5-mini)")
        
        # Fallback to Chat Completions API
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a business analysis assistant that returns valid JSON. Use web search to find accurate, up-to-date information about businesses."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            web_search_options={},  # Enable web search
            max_tokens=1500,
            temperature=0.7
        )
        
        response_text = response.choices[0].message.content.strip()
        
        logger.info(f"✅ OpenAI response received ({len(response_text)} chars)")
        logger.debug(f"Response preview: {response_text[:200]}...")
        
        return response_text
        
    except Exception as e:
        logger.error(f"❌ OpenAI API error: {e}")
        raise


def clean_markdown_formatting(text: str) -> str:
    """
    Clean markdown formatting from text content while preserving structure.
    Handles common markdown patterns that LLMs might include in JSON values.
    """
    if not text or not isinstance(text, str):
        return text
    
    # Remove markdown code blocks
    text = re.sub(r'```[\w]*\n?', '', text)
    
    # Remove markdown bold/italic (keep the text)
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)  # Bold italic
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)      # Bold
    text = re.sub(r'\*(.+?)\*', r'\1', text)          # Italic
    text = re.sub(r'__(.+?)__', r'\1', text)          # Bold alternative
    text = re.sub(r'_(.+?)_', r'\1', text)            # Italic alternative
    
    # Remove markdown links but keep the text
    text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text)
    
    # Remove markdown headers (keep the text, but remove # symbols)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    
    # Clean up extra whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)  # Max 2 consecutive newlines
    
    return text.strip()


def extract_json_from_response(response_text: str) -> str:
    """
    Extract JSON from LLM response with robust markdown handling.
    Handles various formats:
    - ```json ... ```
    - ``` ... ```
    - Plain JSON
    - JSON embedded in other text
    """
    # Try to extract from markdown code blocks first
    if "```json" in response_text.lower():
        # Case-insensitive search for ```json
        json_pattern = re.search(r'```json\s*\n?(.*?)\n?```', response_text, re.DOTALL | re.IGNORECASE)
        if json_pattern:
            return json_pattern.group(1).strip()
    
    # Try generic code blocks
    if "```" in response_text:
        code_pattern = re.search(r'```\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if code_pattern:
            potential_json = code_pattern.group(1).strip()
            # Check if it looks like JSON
            if potential_json.startswith("{") or potential_json.startswith("["):
                return potential_json
    
    # Try to find JSON object directly
    # Look for the outermost { } pair
    brace_count = 0
    start_idx = -1
    end_idx = -1
    
    for i, char in enumerate(response_text):
        if char == '{':
            if brace_count == 0:
                start_idx = i
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0 and start_idx != -1:
                end_idx = i + 1
                break
    
    if start_idx != -1 and end_idx != -1:
        return response_text[start_idx:end_idx].strip()
    
    # Last resort: try to find anything that looks like JSON
    if "{" in response_text and "}" in response_text:
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}") + 1
        if start_idx != -1 and end_idx > start_idx:
            return response_text[start_idx:end_idx].strip()
    
    raise ValueError("No valid JSON found in response")


# ============================================
# MAIN ANALYSIS FUNCTION
# ============================================

async def analyze_website(url: str) -> Dict[str, Any]:
    """
    Main function to analyze a website and extract business information.
    
    Args:
        url: Website URL to analyze
        
    Returns:
        Dictionary with extracted business information
    """
    try:
        logger.info(f"🔍 Starting website analysis for: {url}")
        
        # Step 1: Extract base name
        base_name = extract_base_name(url)
        logger.info(f"  → Base name: {base_name}")
        
        # Step 2: Fetch website HTML
        logger.info(f"  → Fetching website content...")
        try:
            resp = fetch_url(url)
            html = resp.text
            logger.info(f"  → Fetched {len(html)} chars of HTML")
        except Exception as e:
            logger.error(f"  ✗ Failed to fetch website: {e}")
            html = ""
        
        # Step 3: Parse HTML
        soup = BeautifulSoup(html, "html.parser")
        
        # Step 4: Extract text snippets
        site_snippet = extract_text_snippets(soup, max_chars=3500)
        logger.info(f"  → Extracted {len(site_snippet)} chars of text")
        
        # Step 5: Extract colors
        logger.info(f"  → Extracting color palette...")
        color_palette = extract_colors_from_website(url, html, soup)
        logger.info(f"  → Extracted Colors: {color_palette}")
        print(f"\n🎨 EXTRACTED COLOR PALETTE FROM WEBSITE:")
        print(f"   Primary: {color_palette.get('primary')}")
        print(f"   Secondary: {color_palette.get('secondary')}")
        print(f"   Accent: {color_palette.get('accent')}\n")
        
        # Step 6: Build OpenAI prompt
        prompt = build_openai_prompt(base_name, url, site_snippet, color_palette)
        
        # Step 7: Call OpenAI with web search (with domain filter for the URL)
        response_text = await call_openai_with_web_search(prompt, domain=url)
        
        # LOG THE RAW LLM RESPONSE FOR DEBUGGING
        logger.info("=" * 80)
        logger.info("🤖 RAW LLM RESPONSE:")
        logger.info("=" * 80)
        print("\n" + "=" * 80)
        print("🤖 RAW LLM RESPONSE FOR DEBUGGING:")
        print("=" * 80)
        print(response_text)
        print("=" * 80 + "\n")
        logger.info(response_text)
        logger.info("=" * 80)
        
        # Step 8: Parse JSON response
        logger.info(f"  → Parsing JSON response...")
        try:
            json_content = extract_json_from_response(response_text)
            import json
            data = json.loads(json_content)
            
            # LOG THE PARSED JSON DATA
            logger.info("📊 PARSED JSON DATA:")
            print("\n" + "=" * 80)
            print("📊 PARSED JSON DATA:")
            print(json.dumps(data, indent=2))
            print("=" * 80 + "\n")
            
            # Clean markdown formatting from all text fields
            business_overview = clean_markdown_formatting(data.get("business_overview_and_positioning", ""))
            customer_demographics = clean_markdown_formatting(data.get("customer_demographics_and_psychographics", ""))
            why_customers_choose = clean_markdown_formatting(data.get("why_customers_choose", ""))
            brand_story = clean_markdown_formatting(data.get("brand_story", ""))
            
            # Clean markdown from product/service names too
            products = data.get("most_popular_products_and_services", [])
            if isinstance(products, list):
                products = [clean_markdown_formatting(p) if isinstance(p, str) else p for p in products]
            
            # Ensure all required fields are present and use frontend-expected field names
            result = {
                "base_name": data.get("base_name", base_name),
                "business_overview_and_positioning": business_overview,
                "customer_demographics_and_psychographics": customer_demographics,
                "most_popular_products_and_services": products,
                "why_customers_choose": why_customers_choose,
                "brand_story": brand_story,
                "color_palette": data.get("color_palette", color_palette),
                "source_urls": data.get("source_urls", [url]),
            }
            
            logger.info(f"✅ Website analysis completed successfully (markdown cleaned)")
            print("\n✅ FINAL RESULT BEING RETURNED TO FRONTEND (after markdown cleanup):")
            print(json.dumps(result, indent=2))
            print("\n")
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to parse JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            
            # Fallback: return basic structure
            return {
                "base_name": base_name,
                "business_overview": f"Business analysis for {base_name}",
                "customer_demographics": "Analysis pending",
                "popular_products": [],
                "why_customers_choose": "",
                "brand_story": "",
                "color_palette": color_palette,
                "source_urls": [url],
                "error": "Failed to parse AI response",
            }
        
    except Exception as e:
        logger.error(f"❌ Website analysis failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


# ============================================
# API ENDPOINT
# ============================================

@router.post("/api/dvyb/analyze-website")
async def analyze_website_endpoint(request: WebsiteAnalysisRequest):
    """
    Analyze a website and extract business information.
    
    This endpoint:
    1. Fetches the website HTML
    2. Extracts text content and colors
    3. Uses OpenAI with web search to analyze the business
    4. Returns structured business information
    """
    try:
        if not openai_client:
            raise HTTPException(
                status_code=500,
                detail="OpenAI API not configured. Please set OPENAI_API_KEY."
            )
        
        logger.info(f"📥 Received website analysis request for: {request.url}")
        
        # Analyze website
        result = await analyze_website(request.url)
        
        return {
            "success": True,
            "data": result,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        
    except Exception as e:
        logger.error(f"❌ Website analysis endpoint error: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


# ============================================
# FAST ANALYSIS (Direct Fetch + GPT-4o)
# ============================================

def build_fast_analysis_prompt(base_name: str, url: str, site_text: str, extracted_colors: Dict) -> str:
    """
    Build prompt for GPT-4o Chat Completions API (no web search).
    Analyzes ONLY the provided website content.
    """
    color_hints = [c for c in [extracted_colors.get("primary"), extracted_colors.get("secondary"), extracted_colors.get("accent")] if c]
    color_hint_str = ", ".join(color_hints) if color_hints else "none found"
    
    prompt = f"""You are a business analyst. Analyze the following website content for {base_name} ({url}) and provide a comprehensive business analysis.

**Website Content Extracted:**
{site_text[:6000]}

**Extracted Brand Colors:** {color_hint_str}

**Task:** Based ONLY on the website content provided above, create a detailed business analysis. Infer information intelligently from the content, product descriptions, messaging, and tone.

Return a JSON object with this EXACT structure:

{{
  "base_name": "{base_name}",
  "business_overview_and_positioning": "Core Identity: [2-3 sentences based on website content]\\n\\nMarket Positioning:\\n• Primary Positioning: [inferred from messaging and value props]\\n• Secondary Positioning: [inferred from product offerings]\\n• Tertiary Positioning: [inferred from target market]\\n\\nDirect Competitors:\\nGlobal Competitors:\\n• [Competitor 1 - infer from industry/category mentions]\\n• [Competitor 2 - similar tools/services]\\n• [Competitor 3 - alternative solutions]\\n• [Competitor 4 - competing platforms]\\n• [Competitor 5 - market alternatives]\\n\\nCompetitive Advantages:\\n1. [Advantage from features/benefits]: [explanation from content]\\n2. [Advantage from differentiation]: [explanation from content]\\n3. [Advantage from value props]: [explanation from content]\\n4. [Advantage from unique approach]: [explanation from content]",
  "customer_demographics_and_psychographics": "Primary Customer Segments:\\n\\n1. [Segment inferred from messaging] (40%)\\n• [characteristic from content]\\n• [characteristic from tone]\\nKey need: [identified from value props]\\n\\n2. [Segment from use cases] (35%)\\n• [characteristic]\\n• [characteristic]\\nPain points: [from problem statements]\\n\\n3. [Segment from features] (25%)\\n• [characteristic]\\n• [characteristic]\\nKey interest: [from benefits]",
  "most_popular_products_and_services": ["Product/Service 1: [Description from website]", "Product/Service 2: [Description]", "Product/Service 3: [Description]", "Product/Service 4: [Description]", "Product/Service 5: [Description]"],
  "why_customers_choose": "Primary Value Drivers:\\n1. [Driver from benefits]: [explanation from content]\\n2. [Driver from features]: [explanation]\\n3. [Driver from outcomes]: [explanation]\\n4. [Driver from differentiation]: [explanation]\\n\\nEmotional Benefits:\\n• [Benefit from messaging]: [how it's delivered per content]\\n• [Benefit from brand voice]: [delivery method]\\n• [Benefit from value props]: [delivery approach]",
  "brand_story": "The Hero's Journey: [origin story from About page, or inferred from mission]\\n\\nMission Statement: [actual mission from content or inferred from purpose]\\n\\nBrand Personality:\\n• Archetype: [archetype inferred from voice and messaging]\\n• Voice: [tone inferred from content style]\\n• Values: [values from messaging and positioning]\\n\\n[Closing statement about brand evolution or vision]",
  "color_palette": {{
    "primary": "{color_hints[0] if len(color_hints) > 0 else '#000000'}",
    "secondary": "{color_hints[1] if len(color_hints) > 1 else '#000000'}",
    "accent": "{color_hints[2] if len(color_hints) > 2 else '#000000'}"
  }},
  "source_urls": ["{url}"]
}}

**CRITICAL REQUIREMENTS:**

1. **Base Analysis on Provided Content:** Use ONLY the website text provided above. Be specific and factual.

2. **Competitors:** Infer likely competitors based on the industry, product category, and use cases mentioned in the content. If the website is for "AI video generation", competitors would be other AI video tools. Be intelligent about this.

3. **Customer Segments:** Infer from the language, features, pricing, and use cases described in the content.

4. **Products/Services:** Extract from the actual offerings, features, and solutions described on the website.

5. **Value Drivers:** Identify from the benefits, outcomes, and unique selling points in the messaging.

6. **Brand Story:** Look for About, Mission, Vision, or Team sections. If not explicit, infer from the brand's purpose and positioning.

7. **Color Palette:** Use the extracted colors ({color_hint_str}). These were extracted from the website's CSS and design.

8. **Be Specific:** Avoid generic statements. Use actual content from the website. Quote features, benefits, and messaging where relevant.

9. **JSON Only:** Return ONLY the JSON object. No markdown blocks, no explanatory text, no preamble.

Return the JSON now:"""
    
    return prompt


async def call_gpt4o_chat(prompt: str) -> str:
    """
    Call OpenAI Chat Completions API with GPT-4o.
    Fast, no web search, analyzes provided content only.
    """
    try:
        logger.info("🤖 Calling OpenAI Chat Completions API (gpt-4o)...")
        
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a business analysis assistant that returns valid JSON. Analyze website content and provide detailed, specific insights based on the provided text."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=2000,
            temperature=0.7
        )
        
        response_text = response.choices[0].message.content.strip()
        
        logger.info(f"✅ GPT-4o response received ({len(response_text)} chars)")
        logger.debug(f"Response preview: {response_text[:200]}...")
        
        return response_text
        
    except Exception as e:
        logger.error(f"❌ OpenAI API error: {e}")
        raise


async def analyze_website_fast(url: str) -> Dict[str, Any]:
    """
    Fast website analysis using direct content fetch + GPT-4o.
    No web search - analyzes only the fetched website content.
    
    Args:
        url: Website URL to analyze
        
    Returns:
        Dictionary with extracted business information
    """
    try:
        logger.info(f"⚡ Starting FAST website analysis for: {url}")
        
        # Step 1: Extract base name
        base_name = extract_base_name(url)
        logger.info(f"  → Base name: {base_name}")
        
        # Step 2: Fetch website HTML
        logger.info(f"  → Fetching website content...")
        try:
            resp = fetch_url(url)
            html = resp.text
            logger.info(f"  → Fetched {len(html)} chars of HTML")
        except Exception as e:
            logger.error(f"  ✗ Failed to fetch website: {e}")
            html = ""
        
        # Step 3: Parse HTML
        soup = BeautifulSoup(html, "html.parser")
        
        # Step 4: Extract text snippets (more text since no web search)
        site_text = extract_text_snippets(soup, max_chars=6000)  # More text for GPT-4o
        logger.info(f"  → Extracted {len(site_text)} chars of text")
        
        # Step 5: Extract colors (same as before)
        logger.info(f"  → Extracting color palette...")
        color_palette = extract_colors_from_website(url, html, soup)
        logger.info(f"  → Extracted Colors: {color_palette}")
        print(f"\n🎨 EXTRACTED COLOR PALETTE FROM WEBSITE:")
        print(f"   Primary: {color_palette.get('primary')}")
        print(f"   Secondary: {color_palette.get('secondary')}")
        print(f"   Accent: {color_palette.get('accent')}\n")
        
        # Step 6: Extract and upload logo
        logger.info(f"  → Extracting logo...")
        logo_url = extract_logo_url_from_html(url, soup)
        logo_data = None
        if logo_url:
            logo_data = await download_and_upload_logo_to_s3(logo_url, None)  # account_id will be set later when saved
        
        # Step 7: Build GPT-4o prompt (no web search)
        prompt = build_fast_analysis_prompt(base_name, url, site_text, color_palette)
        
        # Step 8: Call GPT-4o (Chat Completions, no web search)
        response_text = await call_gpt4o_chat(prompt)
        
        # LOG THE RAW LLM RESPONSE FOR DEBUGGING
        logger.info("=" * 80)
        logger.info("RAW GPT-4O RESPONSE (FAST ANALYSIS):")
        logger.info("=" * 80)
        logger.info(response_text[:1000])
        logger.info("=" * 80)
        
        # Step 9: Parse JSON from response
        json_str = extract_json_from_response(response_text)
        
        import json
        analysis_data = json.loads(json_str)
        
        # Ensure color_palette is present and uses extracted colors
        if "color_palette" not in analysis_data or not analysis_data["color_palette"]:
            analysis_data["color_palette"] = color_palette
        else:
            # Override with extracted colors if LLM provided different ones
            analysis_data["color_palette"] = {
                "primary": color_palette.get("primary") or analysis_data["color_palette"].get("primary"),
                "secondary": color_palette.get("secondary") or analysis_data["color_palette"].get("secondary"),
                "accent": color_palette.get("accent") or analysis_data["color_palette"].get("accent"),
            }
        
        # Add logo data if extracted
        if logo_data:
            analysis_data["logo_s3_key"] = logo_data["s3_key"]
            analysis_data["logo_presigned_url"] = logo_data["presigned_url"]
        
        logger.info("✅ Fast website analysis complete!")
        print("\n✅ FAST ANALYSIS COMPLETE")
        print(f"   Base Name: {analysis_data.get('base_name')}")
        print(f"   Colors: {analysis_data.get('color_palette')}")
        print(f"   Logo S3 Key: {analysis_data.get('logo_s3_key')}")
        print(f"   Logo Presigned URL: {analysis_data.get('logo_presigned_url', 'N/A')[:80]}...")
        print(f"   Products: {len(analysis_data.get('most_popular_products_and_services', []))} items\n")
        
        return analysis_data
        
    except Exception as e:
        logger.error(f"❌ Fast website analysis failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


@router.post("/api/dvyb/analyze-website-fast")
async def analyze_website_fast_endpoint(request: WebsiteAnalysisRequest):
    """
    ⚡ FAST website analysis endpoint.
    
    This endpoint:
    1. Fetches the website HTML directly (no web search)
    2. Extracts text content and colors
    3. Uses GPT-4o Chat Completions API to analyze the content
    4. Returns structured business information
    
    Much faster than the web-search version but analyzes only the website content.
    """
    try:
        if not openai_client:
            raise HTTPException(
                status_code=500,
                detail="OpenAI API not configured. Please set OPENAI_API_KEY."
            )
        
        logger.info(f"⚡ Received FAST website analysis request for: {request.url}")
        
        # Analyze website (fast method)
        result = await analyze_website_fast(request.url)
        
        return {
            "success": True,
            "data": result,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        
    except Exception as e:
        logger.error(f"❌ Fast website analysis endpoint error: {e}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


@router.get("/api/dvyb/analyze-website/health")
async def website_analysis_health():
    """Health check for website analysis service"""
    return {
        "success": True,
        "service": "DVYB Website Analysis",
        "status": "operational" if openai_client else "degraded",
        "openai_configured": bool(openai_client),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

