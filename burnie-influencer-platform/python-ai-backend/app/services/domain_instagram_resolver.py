"""
Resolve Instagram handle for a brand domain.
Primary: scrape website URL via Apify and extract Instagram link from page.
Fallback: Gemini when no website_url, no Apify token, or scrape finds no link.
"""
import logging
import os
import re
from urllib.parse import urlparse

import google.generativeai as genai

from app.config.settings import settings

logger = logging.getLogger(__name__)

gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GEMINI_API_KEY")
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)

# Page function for Apify Puppeteer: extract all links from the page (to find social links).
PUPPETEER_EXTRACT_LINKS_PAGE_FUNCTION = r"""
async function pageFunction(context) {
    const { page, request } = context;
    const links = [];
    try {
        const hrefs = await page.$$eval('a[href]', els => els.map(e => e.href).filter(Boolean));
        for (const h of hrefs) {
            if (h && typeof h === 'string' && !links.includes(h)) links.push(h);
        }
    } catch (e) {}
    return { url: request.url, links: [...new Set(links)] };
}
"""

# Instagram URL path segments that are not profile usernames (post/reel/story pages, etc.)
INSTAGRAM_NON_PROFILE_PATHS = frozenset({
    "p", "reel", "reels", "tv", "stories", "explore", "accounts", "about",
    "legal", "developer", "contact", "direct", "tagged", "channels", "hashtag",
})


def _extract_instagram_handle_from_website_apify(website_url: str) -> str | None:
    """
    Scrape website_url with Apify Puppeteer, collect all links, return Instagram handle if found.
    Returns handle without @, or None.
    """
    apify_token = (settings.apify_token or "").strip()
    if not apify_token:
        return None
    if not website_url or not website_url.startswith(("http://", "https://")):
        return None
    try:
        from apify_client import ApifyClient
    except ImportError:
        return None
    run_input = {
        "startUrls": [{"url": website_url}],
        "pageFunction": PUPPETEER_EXTRACT_LINKS_PAGE_FUNCTION,
        "proxyConfiguration": {"useApifyProxy": True},
        "maxCrawlingDepth": 0,
        "maxPagesPerCrawl": 1,
    }
    try:
        client = ApifyClient(apify_token)
        run = client.actor("apify/puppeteer-scraper").call(run_input=run_input)
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as e:
        logger.warning(f"Apify website scrape for Instagram links failed: {e}")
        return None
    # Collect all links and find instagram.com profile URLs
    seen_handles: set[str] = set()
    for item in items:
        for raw in item.get("links") or []:
            if not isinstance(raw, str) or "instagram.com" not in raw.lower():
                continue
            try:
                parsed = urlparse(raw)
                if "instagram.com" not in parsed.netloc.lower():
                    continue
                path = (parsed.path or "").strip("/")
                segment = path.split("/")[0] if path else ""
                segment = segment.split("?")[0].lower()
                segment = re.sub(r"[^a-z0-9_.]", "", segment)
                if not segment or len(segment) < 2 or len(segment) > 30:
                    continue
                if segment in INSTAGRAM_NON_PROFILE_PATHS:
                    continue
                seen_handles.add(segment)
            except Exception:
                continue
    if not seen_handles:
        return None
    # Prefer handle that looks like brand (e.g. matches domain); otherwise return first
    return next(iter(seen_handles))


def _resolve_instagram_handle_via_gemini(domain: str, website_url: str | None) -> str | None:
    """Ask Gemini for Instagram handle. Returns handle without @ or None."""
    if not gemini_api_key:
        return None
    domain = (domain or "").strip().lower()
    if not domain:
        return None
    url_hint = f" (website: {website_url})" if website_url else ""
    prompt = f"""Given the brand/company domain "{domain}"{url_hint}, return their official Instagram handle.

Return ONLY the Instagram username (without @), e.g. "skims" or "nike".
Only return exactly: NONE if you are certain the brand has no public Instagram presence.
Do not include any explanation, quotes, or other text."""
    try:
        model = genai.GenerativeModel(model_name="gemini-2.5-flash")
        response = model.generate_content(prompt)
        text = (response.text or "").strip()
        if text and text.upper() not in ("NONE", "NULL", "N/A"):
            handle = re.sub(r"^@+", "", text).lower()
            handle = re.sub(r"[^a-z0-9_.]", "", handle)
            if 2 <= len(handle) <= 30:
                return handle
    except Exception as e:
        logger.warning(f"Gemini Instagram resolution failed for {domain}: {e}")
    return None


def resolve_instagram_handle(domain: str, website_url: str | None = None) -> str | None:
    """
    Resolve Instagram handle for a brand domain.
    Primary: scrape website_url via Apify and extract Instagram link from page.
    Fallback: Gemini when no website_url, no Apify, or scrape finds no link.
    Returns the handle without @, or None.
    """
    domain = (domain or "").strip().lower()
    if not domain:
        return None

    # 1) Prefer scraping the website for Instagram links (most reliable for any business)
    if website_url:
        handle = _extract_instagram_handle_from_website_apify(website_url)
        if handle:
            logger.info(f"📱 Resolved Instagram handle for {domain} from website: @{handle}")
            return handle

    # 2) Fallback: Gemini (when no website_url or scrape found nothing)
    handle = _resolve_instagram_handle_via_gemini(domain, website_url)
    if handle:
        logger.info(f"📱 Resolved Instagram handle for {domain} via Gemini: @{handle}")
        return handle

    return None
