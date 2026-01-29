#!/usr/bin/env python3
"""
Article to Video Generator

Captures screenshots of webpage folds and creates highlight videos.
Supports URL input OR search terms to automatically find relevant articles.

Features:
  - Search for articles using keywords (Google Custom Search)
  - Captures multiple "folds" (screen-sized sections) of an article
  - Uses Google Vision API OCR for precise text bounding boxes
  - Auto-suggests highlight text if none provided (via Grok)
  - Creates highlight videos with customizable colors and effects

Usage:
  # From URL with specific text:
  python article_to_video.py --url https://example.com/article ./output \\
    --highlight "Important text to highlight"

  # From search terms with auto-highlight:
  python article_to_video.py --search "lab grown diamonds controversy" ./output

  # From search with specific text:
  python article_to_video.py --search "climate change 2024" ./output \\
    --highlight "specific quote to find"

Requirements:
  pip install playwright moviepy pillow numpy xai-sdk requests python-dotenv
  playwright install chromium
  
Environment Variables (in python-ai-backend/.env):
  SERPAPI_KEY - SerpAPI key (preferred search API, more reliable)
  GOOGLE_API_KEY - Google Cloud API key with Vision API and Custom Search enabled
  GOOGLE_CSE_ID - Google Custom Search Engine ID (fallback for search)
  XAI_API_KEY - Grok API key
"""

import sys
import os
import argparse
import json
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright
import time
from typing import Optional, Tuple, List
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
if env_path.exists():
    load_dotenv(env_path)

GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
GOOGLE_CSE_ID = os.getenv('GOOGLE_CSE_ID')
SERPAPI_KEY = os.getenv('SERPAPI_KEY')


def search_articles(query: str, num_results: int = 10, search_type: str = "news", geo: str = "in") -> List[dict]:
    """
    Search for articles using SerpAPI (preferred) or Google Custom Search API (fallback).
    
    SerpAPI Benefits:
    - More reliable and accurate Google results
    - Dedicated Google News endpoint for news searches
    - Better date filtering options
    - Cleaner structured data
    - Handles CAPTCHAs and blocks automatically
    
    Args:
        query: Search query string
        num_results: Number of results to return (default: 10)
        search_type: Type of content - "news", "blog", "report", "twitter", "social", or "all"
        geo: Geolocation for search (default: "in" for India)
        
    Returns:
        List of article dictionaries with 'title', 'url', 'snippet'
    """
    print(f"\n{'='*60}")
    print(f"🔍 SEARCHING FOR ARTICLES")
    print(f"{'='*60}")
    print(f"  Query: {query}")
    print(f"  Type: {search_type}")
    print(f"  Geo: {geo}")
    print(f"  Results requested: {num_results}")
    
    # Try SERP API first (preferred)
    if SERPAPI_KEY:
        print(f"  🚀 Using SerpAPI (preferred)")
        results = _serpapi_search(query, num_results, search_type, geo)
        if results:
            return results
        print(f"  ⚠️ SerpAPI returned no results, trying fallbacks...")
    else:
        print(f"  ⚠️ SERPAPI_KEY not set - trying Google Custom Search")
    
    # Fallback to Google Custom Search
    if GOOGLE_API_KEY and GOOGLE_CSE_ID:
        print(f"  📤 Falling back to Google Custom Search API...")
        results = _google_cse_search(query, num_results, search_type)
        if results:
            return results
    
    # Final fallback to DuckDuckGo
    print(f"  🦆 Falling back to DuckDuckGo...")
    return _fallback_search(query, num_results, search_type)


def _serpapi_search(query: str, num_results: int = 10, search_type: str = "news", geo: str = "in") -> List[dict]:
    """
    Search using SerpAPI - provides real Google search results.
    
    Benefits over Google Custom Search:
    - Real Google results (not just indexed sites)
    - Google News engine for news searches
    - Better relevance ranking
    - Date sorting options
    """
    if not SERPAPI_KEY:
        return []
    
    try:
        # Extract key terms for relevance filtering
        key_terms = _extract_key_terms(query)
        print(f"  Key terms for relevance: {key_terms}")
        
        # Build SerpAPI request
        url = "https://serpapi.com/search.json"
        
        # Base parameters
        params = {
            "api_key": SERPAPI_KEY,
            "q": query,
            "num": min(num_results, 20),  # SerpAPI supports up to 100
            "hl": "en",  # Language
            "gl": geo,  # Geolocation for regional results
        }
        
        # Configure engine and parameters based on search type
        if search_type == "news":
            # Use Google News engine for news - best for recent news articles
            params["engine"] = "google_news"
            # Google News specific - sort by relevance but get recent
            # SerpAPI's Google News returns sorted by relevance by default
            print(f"  📰 Using Google News engine (geo: India, sorted by relevance)")
        elif search_type in ["twitter", "social"]:
            # Use regular Google with site restriction for social
            params["engine"] = "google"
            if search_type == "twitter":
                params["q"] = f"{query} site:twitter.com OR site:x.com"
            else:
                params["q"] = f"{query} (site:twitter.com OR site:x.com OR site:facebook.com OR site:instagram.com)"
            # Sort by date for social media
            params["tbs"] = "qdr:w"  # Last week for social
            print(f"  📱 Social media search with date filter")
        elif search_type == "blog":
            params["engine"] = "google"
            params["q"] = f"{query} blog analysis opinion"
            params["tbs"] = "qdr:m"  # Last month
        elif search_type == "report":
            params["engine"] = "google"
            params["q"] = f"{query} industry report analysis"
            params["tbs"] = "qdr:y"  # Last year for reports
        else:
            # Default Google search
            params["engine"] = "google"
            params["tbs"] = "qdr:m"  # Last month
        
        print(f"  📤 SerpAPI request: engine={params.get('engine', 'google')}")
        print(f"  Query: {params['q'][:80]}{'...' if len(params['q']) > 80 else ''}")
        
        response = requests.get(url, params=params, timeout=30)
        
        if response.status_code != 200:
            print(f"  ❌ SerpAPI Error: {response.status_code}")
            print(f"     Response: {response.text[:200]}")
            return []
        
        data = response.json()
        
        # Handle different response formats based on engine
        if params["engine"] == "google_news":
            # Google News has 'news_results'
            items = data.get("news_results", [])
            print(f"  📰 Google News returned {len(items)} results")
        else:
            # Regular Google has 'organic_results'
            items = data.get("organic_results", [])
            print(f"  🔎 Google Search returned {len(items)} results")
        
        if not items:
            # Check for error
            if "error" in data:
                print(f"  ❌ SerpAPI error: {data['error']}")
            return []
        
        # Convert to standard format and filter
        results = []
        for item in items:
            # Google News format
            if params["engine"] == "google_news":
                result = {
                    "title": item.get("title", ""),
                    "url": item.get("link", ""),
                    "snippet": item.get("snippet", item.get("source", {}).get("name", "")),
                    "source": item.get("source", {}).get("name", ""),
                    "date": item.get("date", ""),
                }
            else:
                # Regular Google format
                result = {
                    "title": item.get("title", ""),
                    "url": item.get("link", ""),
                    "snippet": item.get("snippet", ""),
                    "date": item.get("date", ""),
                }
            
            # Skip if no URL
            if not result["url"]:
                continue
                
            results.append(result)
        
        # Filter out e-commerce and irrelevant sites
        filtered_results = _filter_serpapi_results(results)
        
        # For news, skip additional relevance filtering - Google News ranking is good
        # For other types, apply relevance filter
        if search_type in ["twitter", "social", "news"]:
            final_results = filtered_results
        else:
            final_results = _filter_by_relevance_serpapi(filtered_results, key_terms)
            if not final_results:
                print(f"  ⚠️ No relevant results after filtering, using all results")
                final_results = filtered_results
        
        print(f"\n  ✅ Found {len(final_results)} relevant articles:")
        for i, result in enumerate(final_results[:num_results], 1):
            date_str = f" ({result.get('date', '')})" if result.get('date') else ""
            source_str = f" [{result.get('source', '')}]" if result.get('source') else ""
            print(f"\n  {i}. {result['title'][:55]}...{source_str}{date_str}")
            print(f"     {result['url'][:70]}{'...' if len(result['url']) > 70 else ''}")
        
        return final_results[:num_results]
        
    except Exception as e:
        print(f"  ❌ SerpAPI error: {e}")
        import traceback
        print(traceback.format_exc())
        return []


def _filter_serpapi_results(items: List[dict]) -> List[dict]:
    """Filter SerpAPI results to remove e-commerce and irrelevant sites."""
    excluded_patterns = [
        "shop.", "store.", "buy.", "cart.", 
        "/product/", "/products/", "/shop/", "/cart/",
        "amazon.com", "ebay.com", "etsy.com", "alibaba.com",
        "walmart.com", "target.com", "bestbuy.com",
        ".shop", "shopify.com", "pinterest.com",
    ]
    
    filtered = []
    for item in items:
        url = item.get("url", "").lower()
        
        # Skip excluded domains
        if any(pattern in url for pattern in excluded_patterns):
            continue
        
        filtered.append(item)
    
    return filtered


def _filter_by_relevance_serpapi(items: List[dict], key_terms: List[str]) -> List[dict]:
    """Filter SerpAPI results for relevance based on key terms."""
    if not key_terms:
        return items
    
    min_matches = max(1, int(len(key_terms) * 0.4))
    relevant = []
    
    for item in items:
        title = item.get("title", "").lower()
        snippet = item.get("snippet", "").lower()
        url = item.get("url", "").lower()
        combined = f"{title} {snippet} {url}"
        
        # Count key term matches
        matches = sum(1 for term in key_terms if term in combined)
        
        if matches >= min_matches:
            relevant.append(item)
        else:
            print(f"    ⏭️ Low relevance ({matches}/{min_matches}): {title[:45]}...")
    
    return relevant


def _google_cse_search(query: str, num_results: int = 10, search_type: str = "news") -> List[dict]:
    """
    Fallback search using Google Custom Search API.
    """
    try:
        # Extract key terms for relevance filtering
        key_terms = _extract_key_terms(query)
        
        # Enhance query based on search type
        enhanced_query = _enhance_query_for_type(query, search_type)
        
        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": GOOGLE_CSE_ID,
            "q": enhanced_query,
            "num": min(num_results, 10),
        }
        
        if search_type in ["twitter", "social"]:
            params["sort"] = "date"
        else:
            params["dateRestrict"] = "m1"
        
        print(f"  Enhanced query: {enhanced_query[:100]}...")
        response = requests.get(url, params=params, timeout=30)
        
        if response.status_code != 200:
            print(f"  ❌ Google CSE Error: {response.status_code}")
            return []
        
        data = response.json()
        items = data.get("items", [])
        
        if not items:
            return []
        
        filtered_items = _filter_news_articles(items)
        
        if search_type in ["twitter", "social"]:
            relevant_items = filtered_items
        else:
            relevant_items = _filter_by_relevance(filtered_items, key_terms)
            if not relevant_items:
                relevant_items = filtered_items
        
        results = []
        print(f"\n  ✅ Found {len(relevant_items)} articles (Google CSE):")
        for i, item in enumerate(relevant_items, 1):
            result = {
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            }
            results.append(result)
            print(f"\n  {i}. {result['title'][:60]}...")
            print(f"     {result['url']}")
        
        return results
        
    except Exception as e:
        print(f"  ❌ Google CSE error: {e}")
        return []


def _extract_key_terms(query: str) -> List[str]:
    """Extract key terms from query for relevance filtering.
    
    Removes common/filler words, keeps important terms, removes duplicates.
    """
    # Common words to ignore (including short common words)
    stop_words = {
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
        'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
        'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
        'through', 'during', 'before', 'after', 'above', 'below', 'between',
        'and', 'or', 'but', 'if', 'because', 'until', 'while', 'although',
        'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
        'vs', 'versus', 'about', 'how', 'when', 'where', 'why',
        'news', 'article', 'report', 'blog', 'latest', 'update', 'updates',
        # Short common words that match too broadly
        'new', 'old', 'big', 'top', 'best', 'first', 'last', 'year', 'day',
        'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'january', 'february', 'march', 'april', 'june', 'july', 'august', 
        'september', 'october', 'november', 'december',
    }
    
    words = query.lower().split()
    # Keep words that are not stop words and are at least 3 chars
    # But keep numbers (like years) that are 4+ digits
    key_terms = []
    seen = set()  # Track seen terms to avoid duplicates
    
    for w in words:
        if w in seen:
            continue
        seen.add(w)
        
        if w.isdigit() and len(w) >= 4:  # Keep years like 2025, 2026
            key_terms.append(w)
        elif w not in stop_words and len(w) >= 3:
            key_terms.append(w)
    
    # Return key terms (no duplicates)
    return key_terms[:6] if key_terms else words[:3]


def _filter_by_relevance(items: List[dict], key_terms: List[str]) -> List[dict]:
    """Filter results to only include those that mention key terms.
    
    A result is relevant if its title or snippet contains at least 
    40% of the key terms. More lenient to avoid filtering out good results.
    """
    if not key_terms:
        return items
    
    # Remove duplicates from key terms
    key_terms = list(dict.fromkeys(key_terms))
    
    # Require at least 40% of terms (more lenient)
    min_matches = max(1, int(len(key_terms) * 0.4))
    relevant = []
    
    for item in items:
        title = item.get("title", "").lower()
        snippet = item.get("snippet", "").lower()
        url = item.get("link", "").lower()
        combined = f"{title} {snippet} {url}"
        
        # Only skip obvious homepages - exact domain matches
        # Don't skip URLs with paths like /blog/, /news/, /article/
        is_homepage = (
            url.rstrip('/').endswith('.com') or
            url.rstrip('/').endswith('.org') or
            url.rstrip('/').endswith('.net') or
            url.rstrip('/').endswith('.in') or
            url.rstrip('/').endswith('.gov') or
            # Generic index pages
            url.endswith('/news/') or
            url.endswith('/news') or
            url.endswith('/blog/') or
            url.endswith('/blog')
        )
        
        # But allow if URL has article-like patterns
        has_article_pattern = any(p in url for p in [
            '/article/', '/post/', '/story/', '/news-detail/', 
            '/p/', '/status/', '/watch/', '-news', 
            '/2024/', '/2025/', '/2026/'  # Year patterns in URLs
        ])
        
        if is_homepage and not has_article_pattern:
            print(f"    ⏭️ Skipping homepage: {url[:60]}...")
            continue
        
        # Count how many key terms appear
        matches = sum(1 for term in key_terms if term in combined)
        
        if matches >= min_matches:
            relevant.append(item)
        else:
            print(f"    ⏭️ Low relevance ({matches}/{min_matches} terms): {title[:50]}...")
    
    return relevant


def _enhance_query_for_type(query: str, search_type: str) -> str:
    """Add type-specific keywords and exclusions to improve search results.
    
    Google uses AND logic by default - all words must be present.
    We just add type-specific keywords to filter content type.
    """
    
    # Keep the original query - Google uses AND by default
    base_query = query.strip()
    
    # Minimal exclusions - only shopping/irrelevant sites
    # Allow social media like Twitter/X for real-time news
    exclusions = "-site:pinterest.com -site:ebay.com -site:amazon.com"
    
    if search_type == "news":
        # Add news-related keywords
        return f'{base_query} news article {exclusions}'
    elif search_type == "blog":
        return f'{base_query} blog opinion analysis {exclusions}'
    elif search_type == "report":
        # For industry reports
        return f'{base_query} industry report {exclusions}'
    elif search_type == "twitter":
        # Search ONLY Twitter/X
        return f'{base_query} (site:twitter.com OR site:x.com)'
    elif search_type == "social":
        # Search social media sites
        return f'{base_query} (site:twitter.com OR site:x.com OR site:facebook.com OR site:instagram.com OR site:threads.net)'
    return f'{base_query} {exclusions}'


def _filter_news_articles(items: List[dict]) -> List[dict]:
    """Filter out e-commerce and non-article sites."""
    # Domains to exclude (e-commerce, product pages)
    excluded_patterns = [
        "shop.", "store.", "buy.", "cart.", 
        "/product/", "/products/", "/shop/", "/cart/",
        "amazon.com", "ebay.com", "etsy.com", "alibaba.com",
        "walmart.com", "target.com", "bestbuy.com",
        ".shop", "shopify.com",
    ]
    
    # Domains to prefer (news, blogs, reports)
    preferred_domains = [
        # International
        "nytimes.com", "washingtonpost.com", "wsj.com", "bbc.com",
        "cnn.com", "reuters.com", "bloomberg.com", "forbes.com",
        "theguardian.com", "vogue.com", "wired.com", "techcrunch.com",
        "medium.com", "substack.com", "theatlantic.com", "newyorker.com",
        "economist.com", "fortune.com", "businessinsider.com",
        "huffpost.com", "vice.com", "buzzfeednews.com",
        # Indian news sites
        "timesofindia.indiatimes.com", "hindustantimes.com", "indianexpress.com",
        "ndtv.com", "thehindu.com", "economictimes.indiatimes.com",
        "livemint.com", "moneycontrol.com", "business-standard.com",
        "firstpost.com", "news18.com", "zeenews.india.com",
        "scroll.in", "thewire.in", "theprint.in", "newslaundry.com",
        "india.com", "indiatoday.in", "outlookindia.com",
        "deccanherald.com", "telegraphindia.com", "tribuneindia.com",
        "yourstory.com", "inc42.com",  # Indian startup/business
        # URL patterns
        "/news/", "/article/", "/blog/", "/story/", "/opinion/",
    ]
    
    filtered = []
    preferred = []
    
    for item in items:
        url = item.get("link", "").lower()
        
        # Skip excluded domains
        if any(pattern in url for pattern in excluded_patterns):
            continue
        
        # Prioritize preferred domains
        if any(domain in url for domain in preferred_domains):
            preferred.append(item)
        else:
            filtered.append(item)
    
    # Return preferred first, then others
    return preferred + filtered


def _extract_ddg_url(redirect_url: str) -> str:
    """Extract actual URL from DuckDuckGo redirect link."""
    from urllib.parse import urlparse, parse_qs, unquote
    
    # Handle relative URLs
    if redirect_url.startswith("//"):
        redirect_url = "https:" + redirect_url
    
    # Parse the redirect URL and extract 'uddg' parameter
    try:
        parsed = urlparse(redirect_url)
        if "duckduckgo.com" in parsed.netloc:
            params = parse_qs(parsed.query)
            if "uddg" in params:
                return unquote(params["uddg"][0])
        return redirect_url
    except:
        return redirect_url


def _fallback_search(query: str, num_results: int = 10, search_type: str = "news") -> List[dict]:
    """
    Fallback search using DuckDuckGo HTML (no API key required).
    """
    print(f"  🦆 Using DuckDuckGo fallback search...")
    
    try:
        # Enhance query for news/article content
        enhanced_query = _enhance_query_for_type(query, search_type)
        
        # Use DuckDuckGo HTML search
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        
        search_url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(enhanced_query)}"
        response = requests.get(search_url, headers=headers, timeout=30)
        
        if response.status_code != 200:
            print(f"  ❌ Fallback search failed")
            return []
        
        # Simple HTML parsing for results
        from html.parser import HTMLParser
        
        class DDGParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self.current_result = {}
                self.in_result = False
                self.in_title = False
                self.in_snippet = False
                
            def handle_starttag(self, tag, attrs):
                attrs_dict = dict(attrs)
                if tag == "a" and "result__a" in attrs_dict.get("class", ""):
                    self.in_result = True
                    self.in_title = True
                    # Extract actual URL from DuckDuckGo redirect
                    raw_url = attrs_dict.get("href", "")
                    actual_url = _extract_ddg_url(raw_url)
                    self.current_result = {
                        "url": actual_url,
                        "title": "",
                        "snippet": ""
                    }
                elif tag == "a" and "result__snippet" in attrs_dict.get("class", ""):
                    self.in_snippet = True
                    
            def handle_endtag(self, tag):
                if tag == "a" and self.in_title:
                    self.in_title = False
                elif tag == "a" and self.in_snippet:
                    self.in_snippet = False
                    if self.current_result.get("url"):
                        self.results.append(self.current_result)
                    self.current_result = {}
                    self.in_result = False
                    
            def handle_data(self, data):
                if self.in_title:
                    self.current_result["title"] += data.strip()
                elif self.in_snippet:
                    self.current_result["snippet"] += data.strip()
        
        parser = DDGParser()
        parser.feed(response.text)
        
        # Filter for news/articles
        filtered_results = _filter_news_articles([{"link": r["url"], "title": r["title"], "snippet": r["snippet"]} for r in parser.results])
        results = [{"url": r["link"], "title": r["title"], "snippet": r["snippet"]} for r in filtered_results][:num_results]
        
        if results:
            print(f"\n  ✅ Found {len(results)} articles:")
            for i, result in enumerate(results, 1):
                print(f"\n  {i}. {result['title'][:60]}{'...' if len(result['title']) > 60 else ''}")
                print(f"     {result['url']}")
        else:
            print(f"  ⚠️ No results found")
            
        return results
        
    except Exception as e:
        print(f"  ❌ Fallback search error: {e}")
        return []


def _detect_captcha_or_block(page) -> Tuple[bool, str]:
    """
    Detect if a page has CAPTCHA, paywall, or other blocking mechanism.
    
    Returns:
        Tuple of (is_blocked, reason)
    """
    try:
        page_title = page.title().lower()
        page_url = page.url.lower()
        
        # Check title for clear block indicators (most reliable)
        title_block_indicators = [
            "access denied", "403 forbidden", "404 not found",
            "just a moment", "checking your browser",
            "attention required", "security check",
            "please wait", "ddos protection",
        ]
        
        for indicator in title_block_indicators:
            if indicator in page_title:
                return True, f"Block detected in title: '{indicator}'"
        
        # Check for Cloudflare challenge page specifically
        # Cloudflare pages have specific HTML structure
        try:
            is_cloudflare = page.evaluate("""
                () => {
                    // Check for Cloudflare challenge
                    const cf_challenge = document.querySelector('#cf-challenge-running, .cf-browser-verification');
                    const cf_ray = document.querySelector('[data-cf-ray], #cf-ray');
                    const challenge_form = document.querySelector('form#challenge-form');
                    return !!(cf_challenge || cf_ray || challenge_form);
                }
            """)
            if is_cloudflare:
                return True, "Cloudflare challenge page detected"
        except:
            pass
        
        # Check for reCAPTCHA/hCAPTCHA iframes (actual CAPTCHA elements)
        try:
            has_captcha_element = page.evaluate("""
                () => {
                    const recaptcha = document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha');
                    const captchaForm = document.querySelector('form[action*="captcha"]');
                    return !!(recaptcha || captchaForm);
                }
            """)
            if has_captcha_element:
                return True, "CAPTCHA form element detected"
        except:
            pass
        
        # Check for very short content (might be blocked)
        # But be more lenient - require very little content
        try:
            body_text = page.evaluate("document.body ? document.body.innerText : ''")
            # Only flag if content is extremely short (less than 200 chars)
            # and doesn't look like a normal page
            if len(body_text.strip()) < 200:
                # Double-check it's not just a loading page
                has_article = page.evaluate("""
                    () => {
                        const article = document.querySelector('article, .article, .post, .content, main, [role="main"]');
                        return !!article;
                    }
                """)
                if not has_article:
                    return True, "Page has almost no content (likely blocked)"
        except:
            pass
        
        # Check for error pages
        try:
            is_error_page = page.evaluate("""
                () => {
                    const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
                    // Only flag if the ENTIRE page is about the error (short page with error message)
                    if (bodyText.length < 1000) {
                        if (bodyText.includes('403') && bodyText.includes('forbidden')) return true;
                        if (bodyText.includes('access denied') && bodyText.length < 500) return true;
                        if (bodyText.includes('page not found') && bodyText.includes('404')) return true;
                    }
                    return false;
                }
            """)
            if is_error_page:
                return True, "Error page detected (403/404)"
        except:
            pass
        
        return False, ""
        
    except Exception as e:
        # Don't block on detection errors - let it try
        print(f"  ⚠️ Detection error (continuing anyway): {e}")
        return False, ""


def capture_multiple_folds(url, output_dir, width=1920, height=1080, num_folds=3, scroll_offset=100, mobile=False):
    """
    Capture screenshots of multiple folds of a webpage.
    
    Args:
        url: The article URL to capture
        output_dir: Directory where screenshots will be saved
        width: Viewport width (default: 1920, ignored if mobile=True)
        height: Viewport height (default: 1080, ignored if mobile=True)
        num_folds: Number of folds to capture (default: 3)
        scroll_offset: Pixels to scroll before first fold (default: 100)
        mobile: If True, use mobile viewport for portrait/9:16 capture
        
    Returns:
        Tuple of (captured_paths, is_blocked, block_reason)
    """
    captured_paths = []
    
    # Mobile viewport settings for 9:16 portrait capture
    if mobile:
        width = 430   # iPhone 14 Pro Max width
        height = 932  # iPhone 14 Pro Max height
        user_agent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        device_scale = 3  # Retina display
    else:
        user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        device_scale = 1
    
    try:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        print(f"\n{'='*60}")
        print(f"📸 CAPTURING ARTICLE FOLDS")
        print(f"{'='*60}")
        print(f"  URL: {url}")
        print(f"  Output: {output_path.absolute()}")
        print(f"  Mode: {'📱 MOBILE' if mobile else '🖥️ DESKTOP'}")
        print(f"  Viewport: {width}x{height}")
        print(f"  Folds: {num_folds}")
        print(f"  Scroll offset: {scroll_offset}px")
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={'width': width, 'height': height},
                user_agent=user_agent,
                device_scale_factor=device_scale,
                is_mobile=mobile,
                has_touch=mobile
            )
            page = context.new_page()
            
            print(f"\n  Loading page...")
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            time.sleep(3)
            
            # Check for CAPTCHA or blocking
            is_blocked, block_reason = _detect_captcha_or_block(page)
            if is_blocked:
                print(f"\n  ⚠️ {block_reason}")
                browser.close()
                return [], True, block_reason
            
            print(f"  ✅ Page accessible (no CAPTCHA/block detected)")
            
            for fold_num in range(1, num_folds + 1):
                print(f"  Capturing fold {fold_num}...")
                
                scroll_y = scroll_offset + (fold_num - 1) * height
                page.evaluate(f"window.scrollTo(0, {scroll_y})")
                time.sleep(0.5)
                
                output_filename = output_path / f"fold_{fold_num}.png"
                page.screenshot(
                    path=str(output_filename),
                    clip={'x': 0, 'y': 0, 'width': width, 'height': height}
                )
                
                captured_paths.append(str(output_filename))
                print(f"    ✓ Saved: {output_filename}")
            
            browser.close()
        
        print(f"\n  ✅ All {num_folds} folds captured")
        return captured_paths, False, ""
        
    except Exception as e:
        print(f"\n  ❌ Error capturing folds: {str(e)}", file=sys.stderr)
        return captured_paths, True, str(e)


def suggest_highlight_text(fold_images: List[str], search_query: Optional[str] = None) -> Tuple[Optional[str], Optional[int]]:
    """
    Use Grok to analyze fold images and suggest the most impactful text to highlight.
    
    Args:
        fold_images: List of paths to fold images
        search_query: Original search terms used to find this article (helps Grok suggest relevant text)
        
    Returns:
        Tuple of (suggested_text, fold_index) or (None, None) if failed
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system, image
    import base64
    
    print(f"\n{'='*60}")
    print(f"🤖 GROK: SUGGESTING HIGHLIGHT TEXT")
    print(f"{'='*60}")
    print(f"  Analyzing {len(fold_images)} fold images...")
    if search_query:
        print(f"  Search context: '{search_query}'")
    
    # Prepare images
    image_data_urls = []
    for i, img_path in enumerate(fold_images):
        try:
            with open(img_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
            
            ext = img_path.lower().split('.')[-1]
            mime_types = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png'}
            mime_type = mime_types.get(ext, 'image/png')
            
            image_data_urls.append(f"data:{mime_type};base64,{image_data}")
            print(f"  Loaded fold {i+1}: {img_path}")
        except Exception as e:
            print(f"  ⚠️ Error loading {img_path}: {e}")
            continue
    
    if not image_data_urls:
        print(f"  ❌ No images loaded")
        return None, None
    
    # Build context-aware system prompt
    search_context = ""
    if search_query:
        search_context = f"""
IMPORTANT CONTEXT:
The user searched for: "{search_query}"
Your suggested text should be DIRECTLY RELEVANT to this search query.
Find text that best relates to or answers what the user was searching for.
"""
    
    system_prompt = f"""You are an expert at analyzing news articles and identifying the most impactful, 
quotable, or controversial text that would make a great video highlight.

You will be shown images (labeled as Image 1, Image 2, etc.) which are consecutive "folds" 
(screen-sized sections) of a webpage article.
{search_context}
Your task is to:
1. Read and understand the article content across all images
2. Identify the most impactful text - this could be:
   - A controversial or surprising statement
   - A key quote from someone
   - An important statistic or fact
   - A thought-provoking claim
   - Something that would grab attention on social media
   - Text that is MOST RELEVANT to the search query (if provided)

Return your response in this exact JSON format:
{{
    "image_index": <1-based index of image containing the text>,
    "suggested_text": "<the exact text to highlight, 1-3 sentences max>",
    "reason": "<brief explanation of why this text is impactful and relevant>"
}}

IMPORTANT:
- The suggested_text MUST be the EXACT text as it appears in the image
- Keep the text to 1-3 sentences (not too long)
- Choose text that would make people stop scrolling
- If a search query was provided, PRIORITIZE text relevant to that query
- Return ONLY valid JSON, no other text"""

    if search_query:
        user_prompt = f"""Analyze these {len(image_data_urls)} article images.

The user searched for: "{search_query}"

Find and suggest the most impactful text to highlight that is RELEVANT to this search.
Return JSON with: image_index, suggested_text, and reason."""
    else:
        user_prompt = f"""Analyze these {len(image_data_urls)} article images and suggest the most impactful text to highlight.

Return JSON with: image_index, suggested_text, and reason."""

    try:
        print(f"\n  🔗 Connecting to Grok-4-latest...")
        client = Client(api_key=os.getenv('XAI_API_KEY'), timeout=3600)
        chat = client.chat.create(model="grok-4-fast-reasoning")
        
        chat.append(system(system_prompt))
        
        content_items = [user_prompt]
        for img_url in image_data_urls:
            content_items.append(image(image_url=img_url, detail="high"))
        
        chat.append(user(*content_items))
        
        print(f"  📤 Sending {len(image_data_urls)} images to Grok...")
        response = chat.sample()
        response_text = response.content.strip()
        
        print(f"\n{'='*60}")
        print(f"📄 GROK SUGGESTION:")
        print(f"{'='*60}")
        print(response_text)
        print(f"{'='*60}")
        
        # Parse JSON response
        # Clean up response if wrapped in markdown
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
        
        result = json.loads(response_text)
        
        image_index = result.get("image_index", 1)
        suggested_text = result.get("suggested_text", "")
        reason = result.get("reason", "")
        
        print(f"\n  ✅ Grok suggests highlighting:")
        print(f"     Image: {image_index}")
        print(f"     Text: '{suggested_text[:80]}{'...' if len(suggested_text) > 80 else ''}'")
        print(f"     Reason: {reason}")
        
        return suggested_text, image_index
        
    except Exception as e:
        print(f"  ❌ Error getting suggestion: {e}")
        import traceback
        print(traceback.format_exc())
        return None, None


def create_highlight_video(
    fold_images: list,
    search_text: str,
    output_video_path: str,
    duration: float = 4.0,
    aspect_ratio: str = "9:16",
    highlight_color: str = "yellow",
    highlight_alpha: float = 0.7,
    fps: int = 30,
    mobile: bool = False,
    highlight_style: str = "sweep",
    known_fold_index: int = None
):
    """
    Create a highlight video from fold images.
    
    Args:
        mobile: If True, skip zoom/pan effects (mobile viewport is too small for zoom)
        highlight_style: "sweep" (L→R), "sweep-down" (top→bottom), or "static" (full box)
        known_fold_index: If Grok already identified the fold (1-based), skip redundant search
    """
    from dynamic_video_generator import (
        analyze_multiple_folds_for_highlight,
        EffectEngine,
        ASPECT_RATIOS
    )
    
    print(f"\n{'='*60}")
    print(f"🎬 CREATING HIGHLIGHT VIDEO")
    print(f"{'='*60}")
    print(f"  Search text: '{search_text[:60]}{'...' if len(search_text) > 60 else ''}'")
    print(f"  Duration: {duration}s")
    print(f"  Aspect ratio: {aspect_ratio}")
    print(f"  Highlight: {highlight_color} @ {highlight_alpha} alpha")
    print(f"  Highlight style: {highlight_style}")
    print(f"  Fold images: {len(fold_images)}")
    print(f"  Mobile mode: {mobile} {'(zoom disabled)' if mobile else ''}")
    
    selected_image, effects_plan = analyze_multiple_folds_for_highlight(
        fold_image_paths=fold_images,
        duration=duration,
        aspect_ratio=aspect_ratio,
        search_text=search_text,
        skip_zoom=mobile,  # Skip zoom for mobile viewport
        highlight_style=highlight_style,  # Highlight animation style
        known_fold_index=known_fold_index  # Skip Grok fold search if already known
    )
    
    if not selected_image:
        print(f"\n  ❌ Could not find text in any fold image")
        print(f"  💡 Try adjusting the search text or capturing more folds")
        return None
    
    print(f"\n  📍 Text found in: {selected_image}")
    
    output_size = ASPECT_RATIOS.get(aspect_ratio, (1080, 1920))
    
    engine = EffectEngine(
        image_path=selected_image,
        output_size=output_size,
        duration=duration,
        fps=fps,
        highlight_color=highlight_color,
        highlight_alpha=highlight_alpha
    )
    
    engine.set_effects_plan(effects_plan)
    engine.generate_video(output_video_path)
    
    return output_video_path


def main():
    parser = argparse.ArgumentParser(
        description='Create highlight videos from web articles',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search for articles and auto-suggest highlight:
  python article_to_video.py --search "lab grown diamonds debate" ./output

  # Search with specific text to highlight:
  python article_to_video.py --search "AI regulation 2024" ./output \\
    --highlight "specific quote to find"

  # From URL with specific text:
  python article_to_video.py --url https://example.com/article ./output \\
    --highlight "Important quote"

  # From URL with auto-suggest:
  python article_to_video.py --url https://example.com/article ./output

  # Full options:
  python article_to_video.py --search "topic keywords" ./output \\
    --folds 5 --duration 6 -a 9:16 -hc orange -ha 0.5

Output:
  - fold_1.png, fold_2.png, etc. in the output directory
  - article_highlight.mp4 video with highlighted text

Available Aspect Ratios:
  9:16  - TikTok, Reels, Shorts (1080x1920) [default]
  16:9  - YouTube landscape (1920x1080)
  1:1   - Instagram square (1080x1080)
  4:5   - Instagram portrait (1080x1350)
  4:3   - Traditional (1440x1080)

Highlight Colors:
  Basic:    black, white, red, green, blue, yellow, cyan, magenta
  Extended: orange, pink, purple, lime, navy, teal, coral, gold, gray
  Light:    lightyellow, lightgreen, lightblue, lightpink, lavender, mint, cream
  Vibrant:  hotpink, tomato, chartreuse, turquoise, violet, indigo, crimson
  Neon:     neongreen, neonpink, neonyellow, neonorange, neonblue
  Hex:      #FF6B6B, #00FF00, #123456, etc.

Environment Variables (in python-ai-backend/.env):
  SERPAPI_KEY     - SerpAPI key (PREFERRED - more reliable search)
  GOOGLE_API_KEY  - Google API key (Vision + Custom Search fallback)
  GOOGLE_CSE_ID   - Google Custom Search Engine ID (fallback)
  XAI_API_KEY     - Grok API key

Search API Priority:
  1. SerpAPI (best) - Real Google results, Google News engine, accurate ranking
  2. Google Custom Search - Fallback if SerpAPI unavailable
  3. DuckDuckGo - Final fallback (no API key needed)
        """
    )
    
    # Input options (URL or search)
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument('--url', '-u', type=str, help='URL of article to capture')
    input_group.add_argument('--search', '-s', type=str, help='Search terms to find articles')
    
    # Positional argument for legacy support (treated as URL if provided)
    parser.add_argument('legacy_url', nargs='?', help=argparse.SUPPRESS)
    
    # Output directory
    parser.add_argument('output_dir', help='Output directory for screenshots and video')
    
    # Screenshot options
    parser.add_argument('--width', type=int, default=1920, help='Viewport width (default: 1920)')
    parser.add_argument('--height', type=int, default=1080, help='Viewport height (default: 1080)')
    parser.add_argument('--folds', type=int, default=3, help='Number of folds to capture (default: 3)')
    parser.add_argument('--scroll-offset', type=int, default=100, 
                        help='Scroll offset in pixels (default: 100)')
    parser.add_argument('--mobile', '-m', action='store_true',
                        help='Capture in mobile viewport (portrait mode for 9:16 reels)')
    
    # Video generation options
    parser.add_argument('--highlight', '-hl', type=str, default=None,
                        help='Text to highlight. If not provided, Grok will suggest.')
    parser.add_argument('--duration', '-d', type=float, default=4.0,
                        help='Video duration in seconds (default: 4)')
    parser.add_argument('--aspect-ratio', '-a', default='9:16',
                        help='Output video aspect ratio (default: 9:16)')
    parser.add_argument('--highlight-color', '-hc', default='yellow',
                        help='Highlight color (default: yellow)')
    parser.add_argument('--highlight-alpha', '-ha', type=float, default=0.7,
                        help='Highlight opacity 0.0-1.0 (default: 0.7)')
    parser.add_argument('--highlight-style', '-hs', default='sweep',
                        choices=['sweep', 'sweep-down', 'static'],
                        help='Highlight animation style: sweep (L→R), sweep-down (top→bottom for multi-line), static (full box)')
    parser.add_argument('--output-video', '-o', type=str, default=None,
                        help='Output video filename (default: article_highlight.mp4)')
    parser.add_argument('--fps', type=int, default=30,
                        help='Video frames per second (default: 30)')
    
    # Control options
    parser.add_argument('--skip-capture', action='store_true',
                        help='Skip screenshot capture, use existing fold images')
    parser.add_argument('--no-video', action='store_true',
                        help='Only capture screenshots, do not create video')
    parser.add_argument('--article-index', type=int, default=1,
                        help='Which search result to use (default: 1, first result)')
    parser.add_argument('--search-type', '-st', default='news',
                        choices=['news', 'blog', 'report', 'twitter', 'social', 'all'],
                        help='Type of content: news, blog, report, twitter (X only), social (all social media), all')
    parser.add_argument('--geo', '-g', default='in',
                        help='Geolocation for search (default: in for India). Use us, uk, etc.')
    
    args = parser.parse_args()
    
    # Handle legacy positional URL
    if args.legacy_url and not args.url and not args.search:
        args.url = args.legacy_url
    
    # Determine article URL
    article_url = None
    
    # Store search results for retry logic
    search_results = []
    
    if args.search:
        # Search for articles
        search_results = search_articles(args.search, search_type=args.search_type, geo=args.geo)
        if not search_results:
            print("\n❌ No articles found for search query", file=sys.stderr)
            sys.exit(1)
        
        # Select initial article by index (may change if blocked)
        idx = max(0, min(args.article_index - 1, len(search_results) - 1))
        article_url = search_results[idx]["url"]
        print(f"\n  📰 Selected article #{args.article_index}: {search_results[idx]['title'][:50]}...")
        print(f"     URL: {article_url}")
        
    elif args.url:
        article_url = args.url
    else:
        print("Error: Must provide either --url or --search", file=sys.stderr)
        parser.print_help()
        sys.exit(1)
    
    # Validate URL
    if not article_url.startswith(('http://', 'https://')):
        print(f"Error: Invalid URL: {article_url}", file=sys.stderr)
        sys.exit(1)
    
    # Validate options
    if args.folds < 1:
        print("Error: Number of folds must be at least 1", file=sys.stderr)
        sys.exit(1)
    
    if args.highlight_alpha < 0.0 or args.highlight_alpha > 1.0:
        args.highlight_alpha = max(0.0, min(1.0, args.highlight_alpha))
    
    # Step 1: Capture fold screenshots
    output_path = Path(args.output_dir)
    
    if args.skip_capture:
        fold_images = []
        for i in range(1, args.folds + 1):
            img_path = output_path / f"fold_{i}.png"
            if img_path.exists():
                fold_images.append(str(img_path))
        
        if not fold_images:
            print("Error: No fold images found. Run without --skip-capture first.", file=sys.stderr)
            sys.exit(1)
        
        print(f"\n📂 Using {len(fold_images)} existing fold images")
    else:
        # Try to capture folds, with automatic retry on CAPTCHA/block
        # Use SEQUENTIAL selection by relevance (top results first)
        fold_images = None
        available_articles = list(search_results) if args.search else [{"url": article_url, "title": "Direct URL"}]
        attempted_count = 0
        total_articles = len(available_articles)
        
        print(f"\n  📊 Sequential article selection (by relevance) from {total_articles} results...")
        
        while available_articles and not fold_images:
            # Pick first article (most relevant) from remaining pool
            article = available_articles.pop(0)  # Remove from front
            attempted_count += 1
            
            current_url = article.get("url", article_url)
            current_title = article.get("title", "")[:50]
            
            print(f"\n  📰 Attempting article {attempted_count}/{total_articles} (rank #{attempted_count}): {current_title}...")
            print(f"     URL: {current_url}")
            
            captured, is_blocked, block_reason = capture_multiple_folds(
                url=current_url,
                output_dir=args.output_dir,
                width=args.width,
                height=args.height,
                num_folds=args.folds,
                scroll_offset=args.scroll_offset,
                mobile=args.mobile
            )
            
            if not is_blocked and captured:
                fold_images = captured
                article_url = current_url  # Update to successful URL
                print(f"\n  ✅ Successfully captured article #{attempted_count}: {current_url}")
                break
            elif is_blocked:
                print(f"\n  ⏭️ Blocked - trying next article ({len(available_articles)} remaining)...")
                continue
            else:
                print(f"\n  ⚠️ Failed - trying next article ({len(available_articles)} remaining)...")
                continue
        
        if not fold_images:
            print(f"\n❌ Error: Failed to capture any fold images", file=sys.stderr)
            print(f"   Tried {attempted_count} articles - all blocked by CAPTCHA or paywalls.")
            sys.exit(1)
    
    # Step 2: Skip video if requested
    if args.no_video:
        print(f"\n{'='*60}")
        print(f"✅ SCREENSHOTS CAPTURED")
        print(f"{'='*60}")
        print(f"  Location: {output_path.absolute()}")
        return
    
    # Step 3: Get highlight text (from args or auto-suggest)
    highlight_text = args.highlight
    known_fold_index = None  # If Grok suggests text, it also tells us which fold
    
    if not highlight_text:
        print(f"\n  💡 No highlight text provided, asking Grok to suggest...")
        # Pass search query to help Grok suggest relevant text
        suggested_text, suggested_fold = suggest_highlight_text(fold_images, search_query=args.search)
        
        if suggested_text:
            highlight_text = suggested_text
            known_fold_index = suggested_fold  # Grok already told us which fold!
            print(f"\n  ✅ Using Grok's suggestion: '{highlight_text[:60]}...'")
            print(f"     📍 Grok identified fold #{known_fold_index} (will skip redundant fold search)")
        else:
            print(f"\n  ❌ Could not get highlight suggestion")
            print(f"  💡 Please provide --highlight text manually")
            sys.exit(1)
    
    # Step 4: Create highlight video
    if args.output_video:
        video_path = output_path / args.output_video
    else:
        video_path = output_path / "article_highlight.mp4"
    
    result = create_highlight_video(
        fold_images=fold_images,
        search_text=highlight_text,
        output_video_path=str(video_path),
        duration=args.duration,
        aspect_ratio=args.aspect_ratio,
        highlight_color=args.highlight_color,
        highlight_alpha=args.highlight_alpha,
        fps=args.fps,
        mobile=args.mobile,  # Skip zoom for mobile viewport
        highlight_style=args.highlight_style,  # Highlight animation style
        known_fold_index=known_fold_index  # Skip Grok fold search if already known
    )
    
    if result:
        print(f"\n{'='*60}")
        print(f"🎉 SUCCESS!")
        print(f"{'='*60}")
        print(f"  Article: {article_url}")
        print(f"  Screenshots: {output_path.absolute()}")
        print(f"  Video: {video_path.absolute()}")
        print(f"  Highlighted: '{highlight_text[:60]}{'...' if len(highlight_text) > 60 else ''}'")
    else:
        print(f"\n⚠️ Screenshots captured but video creation failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
