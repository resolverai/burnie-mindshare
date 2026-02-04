#!/usr/bin/env python3
"""
Meta Ads Library (same logic as TS meta-ads-fetch.ts: running or recent ads with decent reach)
-> get library ids -> Apify to download creatives for those ads only.
Snapshot URL from Apify is used as-is (not parsed for id).
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from apify_client import ApifyClient

# Meta Graph API ads_archive – full fields (same as typescript-backend meta-ads-fetch.ts)
META_AD_ARCHIVE_FIELDS = [
    "id",
    "ad_snapshot_url",
    "snapshot",
    "ad_creation_time",
    "ad_creative_bodies",
    "ad_creative_link_titles",
    "ad_creative_link_descriptions",
    "ad_creative_link_captions",
    "page_id",
    "page_name",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "publisher_platforms",
    "languages",
    "impressions",
    "spend",
    "currency",
    "bylines",
    "demographic_distribution",
    "delivery_by_region",
    "estimated_audience_size",
    "target_ages",
    "target_gender",
    "target_locations",
    "age_country_gender_reach_breakdown",
    "beneficiary_payers",
    "br_total_reach",
    "eu_total_reach",
    "total_reach_by_location",
]

# EU member state ISO codes (27). When --country=EU we fetch from each and merge/dedupe by id.
EU_COUNTRY_CODES = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]

# Same logic as TS meta-ads-fetch.ts: running or recent ads with decent reach
DECENT_REACH_MIN = 1000

# Skip downloading images smaller than this (favicons, thumbnails like s60x60 are irrelevant)
MIN_IMAGE_SIZE_KB = 10


def _parse_reach_to_number(s: str | None) -> int:
    """Parse API reach string (e.g. '1K-5K', '<1000', '1000') to numeric lower bound."""
    if not s or not isinstance(s, str):
        return 0
    t = s.strip()
    if t.startswith("<"):
        return 0
    num_part = re.sub(r"\s*[-–].*$", "", t.replace(",", "")).strip()
    m = re.match(r"^([\d.]+)\s*([KkMm])?", num_part)
    if not m or not m.group(1):
        return 0
    n = float(m.group(1))
    if m.group(2):
        u = m.group(2).upper()
        if u == "K":
            n *= 1000
        elif u == "M":
            n *= 1_000_000
    return int(n)


def _has_no_stop_time(ad: dict) -> bool:
    """True if ad_delivery_stop_time is null or empty (ad still running)."""
    stop = ad.get("ad_delivery_stop_time")
    return stop is None or not str(stop).strip()


def _parse_date(date_str: str | None) -> datetime | None:
    """Parse date string to date. Returns None if invalid."""
    if not date_str or not str(date_str).strip():
        return None
    s = str(date_str).strip()
    date_only = s[:10] if len(s) >= 10 else s
    try:
        d = datetime.strptime(date_only, "%Y-%m-%d").date()
        return datetime.combine(d, datetime.min.time())
    except (ValueError, TypeError):
        return None


def _today_utc() -> date:
    """Current date in UTC (for consistent comparison with Meta API dates)."""
    return datetime.now(timezone.utc).date()


def _is_date_within_last_n_days(date_str: str | None, n: int) -> bool:
    """
    True if date falls between (today - n) and today inclusive.
    Uses ad_delivery_start_time or ad_delivery_stop_time - NOT ad_creation_time.
    E.g. stopped_within_days=15: ads that stopped between (today-15) and today.
    """
    d = _parse_date(date_str)
    if not d:
        return False
    today = _today_utc()
    cutoff = today - timedelta(days=n)
    return cutoff <= d.date() <= today


def _is_date_older_than_n_days(date_str: str | None, n: int) -> bool:
    """
    True if date is strictly before (today - n).
    Uses ad_delivery_start_time - NOT ad_creation_time.
    E.g. min_running_days=15: ad started more than 15 days ago.
    """
    d = _parse_date(date_str)
    if not d:
        return False
    today = _today_utc()
    cutoff = today - timedelta(days=n)
    return d.date() < cutoff


def _is_date_within_last_15_days(date_str: str | None) -> bool:
    """True if date string is within the last 15 days from today (inclusive). Same as TS."""
    return _is_date_within_last_n_days(date_str, 15)


def _has_stopped_within_last_15_days(ad: dict) -> bool:
    """True if ad has stop time and it falls within the last 15 days."""
    stop = ad.get("ad_delivery_stop_time")
    if stop is None or not str(stop).strip():
        return False
    return _is_date_within_last_15_days(stop)


def _is_start_time_within_last_15_days(ad: dict) -> bool:
    """True if start time is within the last 15 days."""
    return _is_date_within_last_15_days(ad.get("ad_delivery_start_time"))


def _has_decent_reach(ad: dict) -> bool:
    """True if ad has decent reach (>= DECENT_REACH_MIN from impressions/reach data)."""
    imp = ad.get("impressions")
    if imp and isinstance(imp, dict):
        lower = _parse_reach_to_number(imp.get("lower_bound"))
        upper = _parse_reach_to_number(imp.get("upper_bound"))
        if lower >= DECENT_REACH_MIN or upper >= DECENT_REACH_MIN:
            return True
    total_reach = ad.get("total_reach_by_location")
    if total_reach and isinstance(total_reach, list):
        total = sum(int(item.get("value") or 0) for item in total_reach)
        if total >= DECENT_REACH_MIN:
            return True
        if total_reach:
            max_val = max(int(item.get("value") or 0) for item in total_reach)
            if max_val >= DECENT_REACH_MIN:
                return True
    if isinstance(ad.get("eu_total_reach"), (int, float)) and ad["eu_total_reach"] >= DECENT_REACH_MIN:
        return True
    if isinstance(ad.get("br_total_reach"), (int, float)) and ad["br_total_reach"] >= DECENT_REACH_MIN:
        return True
    est = ad.get("estimated_audience_size")
    if est and isinstance(est, dict):
        lower = _parse_reach_to_number(est.get("lower_bound"))
        upper = _parse_reach_to_number(est.get("upper_bound"))
        if lower >= DECENT_REACH_MIN or upper >= DECENT_REACH_MIN:
            return True
    return False


def filter_ads_to_save(ads: list[dict]) -> list[dict]:
    """
    Keep ads that are: (A) still running + ad_delivery_start_time in last 15d, OR
    (B) ad_delivery_stop_time in last 15d + decent reach. Uses delivery times, NOT ad_creation_time.
    """
    return [
        ad
        for ad in ads
        if (_has_no_stop_time(ad) and _is_start_time_within_last_15_days(ad))
        or (_has_stopped_within_last_15_days(ad) and _has_decent_reach(ad))
    ]


def filter_ads_by_three_buckets(
    ads: list[dict],
    min_running_days: int = 15,
    stopped_within_days: int = 15,
) -> list[dict]:
    """
    Keep only ads matching the 3 priority buckets. All use ad_delivery_start_time /
    ad_delivery_stop_time (NOT ad_creation_time).

    1) Long running, still running: ad_delivery_start_time > min_running_days ago, still active
    2) Ran long, stopped recently: ad_delivery_stop_time between (today - stopped_within_days) and today,
       and ran for >= min_running_days before stopping
    3) Any running ad: still active (no start-date filter)
    """
    result = []
    for ad in ads:
        start = _parse_date(ad.get("ad_delivery_start_time"))
        stop = _parse_date(ad.get("ad_delivery_stop_time"))
        still_running = _has_no_stop_time(ad)

        # Bucket 1: Running > min_running_days, still running
        if still_running and start and _is_date_older_than_n_days(ad.get("ad_delivery_start_time"), min_running_days):
            result.append(ad)
            continue

        # Bucket 2: Stopped in last X days, ran for > min_running_days before stopping
        if stop and _is_date_within_last_n_days(ad.get("ad_delivery_stop_time"), stopped_within_days):
            if start and (stop - start).days >= min_running_days:
                result.append(ad)
                continue

        # Bucket 3: Any running ad (irrespective of when started)
        if still_running:
            result.append(ad)
    return result


# ISO code -> possible display names in target_locations (Meta uses country/region names). Same as TS.
COUNTRY_CODE_TO_NAMES: dict[str, list[str]] = {
    "US": ["United States", "United States of America"],
    "GB": ["United Kingdom", "England, United Kingdom", "England", "Scotland", "Wales", "Northern Ireland"],
    "DE": ["Germany"],
    "FR": ["France"],
    "ES": ["Spain"],
    "IT": ["Italy"],
    "NL": ["Netherlands"],
    "BE": ["Belgium"],
    "AT": ["Austria"],
    "SE": ["Sweden"],
    "PL": ["Poland"],
    "GR": ["Greece"],
    "PT": ["Portugal"],
    "IE": ["Ireland"],
    "IN": ["India"],
    "AU": ["Australia"],
    "CA": ["Canada"],
    "BR": ["Brazil"],
    "MX": ["Mexico"],
    "JP": ["Japan"],
    "KR": ["South Korea"],
    "CZ": ["Czech Republic", "Czechia"],
    "RO": ["Romania"],
    "HU": ["Hungary"],
    "BG": ["Bulgaria"],
    "SK": ["Slovakia"],
    "HR": ["Croatia"],
    "SI": ["Slovenia"],
    "LT": ["Lithuania"],
    "LV": ["Latvia"],
    "EE": ["Estonia"],
    "CY": ["Cyprus"],
    "LU": ["Luxembourg"],
    "MT": ["Malta"],
    "DK": ["Denmark"],
    "FI": ["Finland"],
}


def _ad_targets_country(ad: dict, code: str) -> bool:
    """True if ad has no location data, or its location includes the given country code."""
    c = code.upper()
    breakdown = ad.get("age_country_gender_reach_breakdown") or []
    target_locs = ad.get("target_locations") or []
    if not breakdown and not target_locs:
        return True
    if isinstance(breakdown, list):
        for item in breakdown:
            if isinstance(item, dict) and (item.get("country") or "").upper() == c:
                return True
    if isinstance(target_locs, list):
        names = COUNTRY_CODE_TO_NAMES.get(c, [c])
        name_to_match = names[0] if names else c
        for loc in target_locs:
            loc_name = (loc.get("name") or "").strip() if isinstance(loc, dict) else ""
            if not loc_name:
                continue
            loc_lower = loc_name.lower()
            if any(n.lower() in loc_lower or loc_lower in n.lower() for n in names):
                return True
            if name_to_match.lower() in loc_lower:
                return True
    return False


def filter_ads_by_country(ads: list[dict], requested_country: str) -> list[dict]:
    """Keep only ads whose location data includes the requested country (same as TS)."""
    code = requested_country.upper()
    if code == "ALL":
        return ads
    if code == "EU":
        return [ad for ad in ads if any(_ad_targets_country(ad, cc) for cc in EU_COUNTRY_CODES)]
    return [ad for ad in ads if _ad_targets_country(ad, code)]


def _ad_contains_keyword(ad: dict, kw_lower: list[str]) -> bool:
    """True if any keyword appears in ad_creative_link_captions or ad_creative_link_titles."""
    def _matches(text: str) -> bool:
        return text and any(kw in (text or "").lower() for kw in kw_lower)

    def _extract_texts(field_val: list) -> list[str]:
        texts = []
        for item in (field_val or []):
            if isinstance(item, str):
                texts.append(item)
            elif isinstance(item, dict):
                texts.append(item.get("text") or item.get("caption") or item.get("name") or item.get("value") or "")
            else:
                texts.append(str(item))
        return texts

    fields_to_check = [
        ad.get("ad_creative_link_captions") or [],
        ad.get("ad_creative_link_titles") or [],
    ]
    for field_val in fields_to_check:
        for text in _extract_texts(field_val if isinstance(field_val, list) else [field_val]):
            if _matches(str(text)):
                return True
    return False


def _search_terms_for_meta_api(keywords: list[str]) -> str:
    """
    Build search terms for Meta API. Keyword can be anything (lululemon, titikaactive, lululemon.com).
    For domain-like keywords, use base part (e.g. lululemon) for better Meta results.
    """
    terms = []
    for k in keywords:
        k = str(k).strip()
        if not k:
            continue
        if "." in k and not k.startswith("."):
            base = k.split(".")[0]
            if len(base) >= 2:
                terms.append(base)
            else:
                terms.append(k)
        else:
            terms.append(k)
    return " ".join(terms) if terms else " ".join(str(k).strip() for k in keywords if k)


def _expand_keywords_for_matching(keywords: list[str]) -> list[str]:
    """
    Expand keywords for flexible matching in ad_creative_link_captions.
    E.g. lululemon.com -> [lululemon.com, lululemon]; titikaactive -> [titikaactive].
    Matches keyword in any form (domain or brand name).
    """
    expanded = set()
    for k in keywords:
        k = str(k).strip().lower()
        if not k:
            continue
        expanded.add(k)
        # If domain-like (has TLD), also add base part for matching "lululemon" when keyword is "lululemon.com"
        if "." in k and not k.startswith("."):
            base = k.split(".")[0]
            if len(base) >= 2:
                expanded.add(base)
    return list(expanded)


def filter_ads_by_keyword_in_captions(ads: list[dict], keywords: list[str]) -> list[dict]:
    """
    Keep only ads where keyword appears in ad_creative_link_captions or ad_creative_link_titles.
    Keyword can be anything (lululemon, titikaactive, lululemon.com). Matches substring (any form).
    """
    if not keywords:
        return ads
    kw_lower = _expand_keywords_for_matching(keywords)
    if not kw_lower:
        return ads
    return [ad for ad in ads if _ad_contains_keyword(ad, kw_lower)]


# Common video extensions / URL patterns
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
VIDEO_QUERY_PATHS = re.compile(r"\.(mp4|webm|mov|m4v)(\?|$)", re.I)


def get_extension(url: str, content_type: str | None = None) -> str:
    """Infer file extension from URL or Content-Type."""
    if content_type:
        ct = content_type.lower()
        if "jpeg" in ct or "jpg" in ct:
            return ".jpg"
        if "png" in ct:
            return ".png"
        if "gif" in ct:
            return ".gif"
        if "webp" in ct:
            return ".webp"
        if "mp4" in ct:
            return ".mp4"
        if "webm" in ct:
            return ".webm"
    path = urlparse(url).path or ""
    path = path.split("?")[0]
    match = re.search(r"\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|m4v)(\?|$)", path, re.I)
    if match:
        return "." + match.group(1).lower()
    return ".jpg"


def is_video_url(url: str) -> bool:
    """Heuristic: treat URL as video if path or query suggests video."""
    path = (urlparse(url).path or "").lower()
    if VIDEO_QUERY_PATHS.search(path):
        return True
    for ext in VIDEO_EXTENSIONS:
        if ext in path:
            return True
    return False


def collect_creative_urls(item: dict) -> tuple[list[str], list[str]]:
    """
    Extract image and video URLs from a single ad item (Apify or Meta API format).
    Handles images=[{url}], videos=[{url}], snapshot.images/videos (Meta API), and ad_creative_link.
    Returns (image_urls, video_urls).
    """
    image_urls: list[str] = []
    video_urls: list[str] = []

    # Meta API: snapshot.images / snapshot.videos
    snapshot = item.get("snapshot") or {}
    if isinstance(snapshot, dict):
        images = snapshot.get("images") or []
        videos = snapshot.get("videos") or []
        for img in images if isinstance(images, list) else []:
            u = img.get("url") or img.get("src") if isinstance(img, dict) else (img if isinstance(img, str) else None)
            if u and isinstance(u, str) and u.strip():
                image_urls.append(u.strip())
        for vid in videos if isinstance(videos, list) else []:
            u = vid.get("url") or vid.get("src") if isinstance(vid, dict) else (vid if isinstance(vid, str) else None)
            if u and isinstance(u, str) and u.strip():
                video_urls.append(u.strip())

    # Array of image objects with 'url' (or similar) – Apify / flat format
    images = item.get("images") or item.get("image_urls") or []
    if isinstance(images, list):
        for img in images:
            if isinstance(img, dict):
                u = img.get("url") or img.get("src")
            elif isinstance(img, str):
                u = img
            else:
                u = None
            if u and isinstance(u, str) and u.strip() and u not in image_urls:
                image_urls.append(u.strip())

    # Array of video objects with 'url' – Apify / flat format
    videos = item.get("videos") or item.get("video_urls") or []
    if isinstance(videos, list):
        for vid in videos:
            if isinstance(vid, dict):
                u = vid.get("url") or vid.get("src")
            elif isinstance(vid, str):
                u = vid
            else:
                u = None
            if u and isinstance(u, str) and u.strip() and u not in video_urls:
                video_urls.append(u.strip())

    # Fallback: single ad_creative_link (could be image or video)
    single = item.get("ad_creative_link") or item.get("creative_link") or item.get("creative_url")
    if single and isinstance(single, str) and single.strip():
        if is_video_url(single):
            video_urls.append(single.strip())
        else:
            image_urls.append(single.strip())

    return image_urls, video_urls


def _decode_url(u: str) -> str:
    """Decode HTML entities in URL so it works when requested (e.g. &amp; -> &)."""
    if not u or not isinstance(u, str):
        return u or ""
    s = u.strip()
    s = s.replace("&amp;", "&")
    s = s.replace("&#38;", "&")
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    return s


def fetch_snapshot_html(snapshot_url: str, timeout: int = 20) -> str:
    """Fetch snapshot page HTML (browser-like User-Agent). Facebook may return 400 for server requests."""
    uas = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.facebook.com/ads/library/",
    }
    last_err: Exception | None = None
    for ua in uas:
        try:
            req = urllib.request.Request(
                snapshot_url,
                headers={**headers, "User-Agent": ua},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    body = resp.read().decode(errors="replace")
                    if body:
                        return body
        except Exception as e:
            last_err = e
    raise last_err or RuntimeError("Request failed")


def extract_media_urls_from_snapshot_html(html: str) -> tuple[list[str], list[str]]:
    """Extract image and video URLs from snapshot page HTML (same patterns as TS meta-ads-fetch)."""
    image_urls: list[str] = []
    video_urls: list[str] = []
    seen_i: set[str] = set()
    seen_v: set[str] = set()

    def add_image(url: str) -> None:
        u = _decode_url(url)
        if u and u not in seen_i:
            seen_i.add(u)
            image_urls.append(u)

    def add_video(url: str) -> None:
        u = _decode_url(url)
        if u and u not in seen_v:
            seen_v.add(u)
            video_urls.append(u)

    # 1) <video ... src="..."> and poster="..."
    for tag in re.finditer(r"<video\s[^>]*>", html, re.I):
        t = tag.group(0)
        m = re.search(r'\ssrc=["\']([^"\']+)["\']', t, re.I)
        if m:
            add_video(m.group(1))
        m = re.search(r'\sposter=["\']([^"\']+)["\']', t, re.I)
        if m:
            add_image(m.group(1))

    # 2) og:image / og:video meta tags
    for m in re.finditer(r'property=["\']og:image["\']\s+content=["\']([^"\']+)["\']', html, re.I):
        add_image(m.group(1))
    for m in re.finditer(r'property=["\']og:video(?::url)?["\']\s+content=["\']([^"\']+)["\']', html, re.I):
        add_video(m.group(1))

    # 3) fbcdn video URLs
    for m in re.finditer(
        r"(https://video[^\"'\s]+\.fbcdn\.net/[^\"'\s]+\.(?:mp4|webm)(?:\?[^\"'\s]*)?)",
        html,
        re.I,
    ):
        add_video(m.group(1))

    # 4) scontent image URLs (skip video extensions)
    for m in re.finditer(r"(https://scontent[^\"'\s]+\.fbcdn\.net/[^\"'\s]+)", html):
        u = m.group(1)
        if u and not re.search(r"\.(mp4|webm|mov)(\?|$)", u, re.I):
            add_image(u)

    return image_urls, video_urls


# Page function for Apify Puppeteer Scraper when scraping ad_snapshot_url: extract images/videos from page.
PUPPETEER_SNAPSHOT_PAGE_FUNCTION = r"""
async function pageFunction(context) {
    const { page, request } = context;
    const adId = (request.userData && request.userData.adId) || request.url;
    const images = [];
    const videos = [];
    try {
        const videoEls = await page.$$('video');
        for (const v of videoEls) {
            const src = await v.evaluate(el => el.src);
            if (src) videos.push(src);
            const poster = await v.evaluate(el => el.poster || '');
            if (poster) images.push(poster);
        }
        const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
        if (ogImage) images.push(ogImage);
        const ogVideoSel = 'meta[property="og:video:url"], meta[property="og:video"]';
        const ogVideo = await page.$(ogVideoSel).then(el => el ? el.evaluate(n => n.getAttribute('content')) : null).catch(() => null);
        if (ogVideo) videos.push(ogVideo);
        const html = await page.content();
        const fbcdnVideoRe = /https:\/\/video[^"'\s]+\.fbcdn\.net\/[^"'\s]+\.(?:mp4|webm)(?:\?[^"'\s]*)?/gi;
        let m;
        while ((m = fbcdnVideoRe.exec(html)) !== null) { if (m[0] && !videos.includes(m[0])) videos.push(m[0]); }
        const fbcdnImageRe = /https:\/\/scontent[^"'\s]+\.fbcdn\.net\/[^"'\s]+/g;
        while ((m = fbcdnImageRe.exec(html)) !== null) {
            const u = m[0];
            if (u && !/\.(mp4|webm|mov)(\?|$)/i.test(u) && !images.includes(u)) images.push(u);
        }
    } catch (e) {}
    return { adId, url: request.url, images: [...new Set(images)], videos: [...new Set(videos)] };
}
"""


def _meta_api_request(url: str, timeout: int = 60) -> dict:
    """GET Meta Graph API URL and return parsed JSON."""
    req = urllib.request.Request(url, headers={"User-Agent": "MetaAdFetch/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_ads_via_meta_api(
    meta_token: str,
    search_terms: str,
    country: str,
    limit: int,
    media_type: str | None,
    max_pages: int = 10,
    ad_active_status: str = "ACTIVE",
    ad_delivery_date_min: str | None = None,
) -> list[dict]:
    """
    Fetch ads from Meta Graph API ads_archive (same flow as TS meta-ads-fetch.ts).
    Supports pagination and EU (fetch per EU country then merge/dedupe by id).
    Returns list of ad objects with full metadata.

    ad_active_status: ACTIVE (default), INACTIVE, or ALL - filters by delivery status.
    ad_delivery_date_min: YYYY-MM-DD - only ads delivered on/after this date (recency).
    """
    limit_per_request = min(limit, 100)
    all_ads: list[dict] = []
    seen_ids: set[str] = set()

    def fetch_page(ad_reached_countries: str, next_url: str | None = None) -> tuple[list[dict], str | None]:
        if next_url:
            data = _meta_api_request(next_url)
        else:
            params = {
                "access_token": meta_token,
                "search_terms": search_terms,
                "ad_reached_countries": ad_reached_countries,
                "ad_active_status": (ad_active_status or "ACTIVE").upper(),
                "search_type": "KEYWORD_UNORDERED",
                "fields": ",".join(META_AD_ARCHIVE_FIELDS),
                "limit": limit_per_request,
            }
            if ad_delivery_date_min:
                params["ad_delivery_date_min"] = ad_delivery_date_min
            if media_type and media_type != "both":
                params["media_type"] = media_type.upper()
            url = "https://graph.facebook.com/v18.0/ads_archive?" + urllib.parse.urlencode(params)
            data = _meta_api_request(url)
        return data.get("data") or [], (data.get("paging") or {}).get("next")

    if country.upper() == "EU":
        # Fetch one page per EU country, then merge and dedupe by ad id (like TS); cap at limit
        for i, cc in enumerate(EU_COUNTRY_CODES):
            if len(all_ads) >= limit:
                break
            page, _ = fetch_page(cc)
            for ad in page:
                if len(all_ads) >= limit:
                    break
                aid = (ad.get("id") or "").strip()
                if aid and aid not in seen_ids:
                    seen_ids.add(aid)
                    all_ads.append(ad)
            if i < len(EU_COUNTRY_CODES) - 1:
                time.sleep(0.4)
        print(f"   EU: fetched from {len(EU_COUNTRY_CODES)} countries → {len(all_ads)} unique ads")
        # Fallback: if media_type filter gave 0, retry first EU country without media filter
        if len(all_ads) == 0 and media_type and media_type != "both":
            print(f"   No ads with media_type={media_type}; retrying EU without media filter...")
            params = {
                "access_token": meta_token,
                "search_terms": search_terms,
                "ad_reached_countries": EU_COUNTRY_CODES[0],
                "ad_active_status": (ad_active_status or "ACTIVE").upper(),
                "search_type": "KEYWORD_UNORDERED",
                "fields": ",".join(META_AD_ARCHIVE_FIELDS),
                "limit": limit_per_request,
            }
            if ad_delivery_date_min:
                params["ad_delivery_date_min"] = ad_delivery_date_min
            url = "https://graph.facebook.com/v18.0/ads_archive?" + urllib.parse.urlencode(params)
            data = _meta_api_request(url)
            for ad in (data.get("data") or []):
                if len(all_ads) >= limit:
                    break
                aid = (ad.get("id") or "").strip()
                if aid and aid not in seen_ids:
                    seen_ids.add(aid)
                    all_ads.append(ad)
            if all_ads:
                print(f"   Got {len(all_ads)} ad(s) without media filter")
        return all_ads[:limit]

    # Single country: fetch pages until we have enough; respect -l
    next_url: str | None = None
    page_count = 0
    while page_count < max_pages and len(all_ads) < limit:
        page, next_url = fetch_page(country.upper(), next_url)
        for ad in page:
            if len(all_ads) >= limit:
                break
            aid = (ad.get("id") or "").strip()
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                all_ads.append(ad)
        page_count += 1
        if not next_url or len(page) == 0:
            break
        time.sleep(0.5)

    # Fallback: if media_type filter gave 0 results, retry without it (Meta API can return 0 for IMAGE/VIDEO when ads exist)
    if len(all_ads) == 0 and media_type and media_type != "both":
        print(f"   No ads with media_type={media_type}; retrying without media filter...")
        params = {
            "access_token": meta_token,
            "search_terms": search_terms,
            "ad_reached_countries": country.upper(),
            "ad_active_status": (ad_active_status or "ACTIVE").upper(),
            "search_type": "KEYWORD_UNORDERED",
            "fields": ",".join(META_AD_ARCHIVE_FIELDS),
            "limit": limit_per_request,
        }
        if ad_delivery_date_min:
            params["ad_delivery_date_min"] = ad_delivery_date_min
        url = "https://graph.facebook.com/v18.0/ads_archive?" + urllib.parse.urlencode(params)
        data = _meta_api_request(url)
        page = data.get("data") or []
        for ad in page:
            if len(all_ads) >= limit:
                break
            aid = (ad.get("id") or "").strip()
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                all_ads.append(ad)
        if all_ads:
            print(f"   Got {len(all_ads)} ad(s) without media filter (download will prefer {media_type})")

    return all_ads[:limit]


def download_url(
    url: str,
    filepath: Path,
    timeout: int = 60,
    min_size_bytes: int | None = None,
) -> bool:
    """Download URL to filepath; append extension if needed. Returns True on success.
    When min_size_bytes is set (e.g. for images), skips if Content-Length or actual size is smaller.
    """
    # Decode HTML entities (e.g. &amp; -> &) so fbcdn URLs work; otherwise "Bad URL hash" / 400
    url = _decode_url(url)
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.facebook.com/",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        if min_size_bytes is not None:
            # HEAD first to avoid downloading small images (favicons, thumbnails)
            head_req = urllib.request.Request(url, headers=headers, method="HEAD")
            try:
                with urllib.request.urlopen(head_req, timeout=timeout) as head_resp:
                    cl = head_resp.headers.get("Content-Length")
                    if cl is not None:
                        try:
                            if int(cl) < min_size_bytes:
                                return False
                        except ValueError:
                            pass
            except Exception:
                pass  # no HEAD support or error; proceed with GET and check size after
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type")
            data = resp.read()
        if min_size_bytes is not None and len(data) < min_size_bytes:
            return False
        ext = get_extension(url, content_type)
        final_path = filepath if filepath.suffix else filepath.with_suffix(ext)
        final_path.write_bytes(data)
        return True
    except Exception as e:
        print(f"   Warning: failed to download {url[:60]}... : {e}", file=sys.stderr)
        return False


def _library_id_from_item(item: dict) -> str | None:
    """
    Extract Meta Ad Library id from Apify result (id, ad_id, library_id only).
    If Apify returns ad_snapshot_url, use that URL as-is; we do not parse it for id.
    """
    for key in ("id", "ad_id", "library_id"):
        val = item.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def run_fetch(
    *,
    output: Path,
    keywords: list[str],
    country: str = "US",
    limit: int = 10,
    exclude_meta_ad_ids: set[str] | None = None,
    max_ads_to_save: int = 10,
    media: str = "both",
    meta_token: str,
    apify_token: str = "",
    creatives_from: str = "snapshot",
    recent: bool = False,
    download_media: bool = True,
    min_running_days: int = 15,
    stopped_within_days: int = 15,
    ad_active_status: str = "ACTIVE",
    ad_delivery_date_min: str | None = None,
    keyword_filter: bool = True,
) -> tuple[Path, Path, Path | None]:
    """
    Run full Meta ads fetch: Meta API -> filter -> Apify (if needed) -> download (if enabled).
    Returns (out_dir, meta_path, apify_path or None).
    """
    out_dir = output.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    want_image = media in ("image", "both")
    want_video = media in ("video", "both")

    search_terms = _search_terms_for_meta_api(keywords)
    api_filters = []
    if ad_active_status and ad_active_status.upper() != "ALL":
        api_filters.append(f"ad_active_status={ad_active_status}")
    if ad_delivery_date_min:
        api_filters.append(f"delivery_date_min={ad_delivery_date_min}")
    filter_str = f" ({', '.join(api_filters)})" if api_filters else ""
    print(f"Fetching ads from Meta Graph API (ads_archive){filter_str}...")
    fetched_ads = fetch_ads_via_meta_api(
        meta_token,
        search_terms,
        country,
        limit,
        media,
        ad_active_status=ad_active_status or "ACTIVE",
        ad_delivery_date_min=ad_delivery_date_min,
    )
    print(f"Fetched {len(fetched_ads)} ad(s) from Meta API.")

    exclude_ids = exclude_meta_ad_ids or set()
    if exclude_ids:
        before_exclude = len(fetched_ads)
        fetched_ads = [a for a in fetched_ads if (a.get("id") or "").strip() not in exclude_ids]
        if before_exclude > 0 and len(fetched_ads) < before_exclude:
            print(f"   Excluded {before_exclude - len(fetched_ads)} ad(s) already in DB (ad copy + creatives fetched).")

    if recent:
        meta_ads = filter_ads_by_three_buckets(
            fetched_ads,
            min_running_days=min_running_days,
            stopped_within_days=stopped_within_days,
        )
        if fetched_ads and len(meta_ads) < len(fetched_ads):
            print(f"   Filter (3 buckets): {len(fetched_ads)} → {len(meta_ads)} (running>{min_running_days}d | stopped in last {stopped_within_days}d+ran long | any running)")
        if not meta_ads:
            raise SystemExit("No ads match the 3-bucket filter. Nothing saved.")
    else:
        meta_ads = fetched_ads

    country_upper = country.upper()
    if country_upper in ("EU", "ALL"):
        before_country = len(meta_ads)
        meta_ads = filter_ads_by_country(meta_ads, country)
        if before_country > 0 and len(meta_ads) < before_country:
            print(f"   Country filter ({country}): {before_country} → {len(meta_ads)}")
    if not meta_ads:
        raise SystemExit("No ads after filters. Nothing saved.")

    if keyword_filter and keywords:
        before_caption = len(meta_ads)
        meta_ads = filter_ads_by_keyword_in_captions(meta_ads, keywords)
        if before_caption > 0 and len(meta_ads) < before_caption:
            print(f"   Keyword filter (in link_captions/link_titles): {before_caption} → {len(meta_ads)}")
        if not meta_ads:
            raise SystemExit("No ads have keyword in ad creative fields. Nothing saved.")
    else:
        if not keyword_filter:
            print("   Keyword filter: skipped (--no-keyword-filter)")

    if len(meta_ads) > max_ads_to_save:
        meta_ads = meta_ads[:max_ads_to_save]
        print(f"   Capped to {max_ads_to_save} ad(s) for save (limit was for filtering pool).")

    meta_path = out_dir / "meta_ads.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_ads, f, indent=2, ensure_ascii=False)
    print(f"Saved Meta ads ({len(meta_ads)} ad(s)) to {meta_path}")

    apify_path: Path | None = None
    downloaded = 0

    if creatives_from == "snapshot":
        if download_media:
            for ad in meta_ads:
                snapshot_url = (ad.get("ad_snapshot_url") or "").strip()
                if not snapshot_url:
                    continue
                ad_id = (ad.get("id") or "unknown").strip()
                try:
                    html = fetch_snapshot_html(snapshot_url)
                    image_urls, video_urls = extract_media_urls_from_snapshot_html(html)
                except Exception as e:
                    print(f"   Warning: failed to fetch snapshot for {ad_id}: {e}", file=sys.stderr)
                    continue
                if want_image and want_video:
                    urls_to_download = [(u, "image") for u in image_urls] + [(u, "video") for u in video_urls[:1]]
                elif want_image:
                    urls_to_download = [(u, "image") for u in image_urls]
                elif want_video:
                    urls_to_download = [(u, "video") for u in video_urls[:1]]
                else:
                    urls_to_download = []
                safe_id = re.sub(r"[/\\]", "_", ad_id)
                for i, (url, kind) in enumerate(urls_to_download):
                    min_bytes = (MIN_IMAGE_SIZE_KB * 1024) if kind == "image" else None
                    stem = f"{safe_id}_{kind}"
                    if len(urls_to_download) > 1:
                        stem += f"_{i}"
                    filepath = out_dir / stem
                    if download_url(url, filepath, min_size_bytes=min_bytes):
                        downloaded += 1
                        print(f"   Saved: {filepath.name}")
    elif creatives_from == "apify-snapshot":
        start_urls = []
        for ad in meta_ads:
            snapshot_url = (ad.get("ad_snapshot_url") or "").strip()
            if not snapshot_url:
                continue
            ad_id = (ad.get("id") or "unknown").strip()
            start_urls.append({"url": snapshot_url, "userData": {"adId": ad_id}})
        if start_urls:
            print(f"Running Apify Puppeteer Scraper on {len(start_urls)} snapshot URL(s)...")
            client = ApifyClient(apify_token)
            run_input = {
                "startUrls": start_urls,
                "pageFunction": PUPPETEER_SNAPSHOT_PAGE_FUNCTION,
                "proxyConfiguration": {"useApifyProxy": True},
                "maxCrawlingDepth": 0,
            }
            run = client.actor("apify/puppeteer-scraper").call(run_input=run_input)
            apify_items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
            apify_path = out_dir / "apify_results.json"
            with open(apify_path, "w", encoding="utf-8") as f:
                json.dump(apify_items, f, indent=2, ensure_ascii=False)
            print(f"Saved Apify snapshot results ({len(apify_items)} item(s)) to {apify_path}")
            if download_media:
                for item in apify_items:
                    ad_id = (item.get("adId") or "unknown").strip()
                    image_urls = item.get("images") or []
                    video_urls = item.get("videos") or []
                    if want_image and want_video:
                        urls_to_download = [(u, "image") for u in image_urls] + [(u, "video") for u in video_urls[:1]]
                    elif want_image:
                        urls_to_download = [(u, "image") for u in image_urls]
                    elif want_video:
                        urls_to_download = [(u, "video") for u in video_urls[:1]]
                    else:
                        urls_to_download = []
                    safe_id = re.sub(r"[/\\]", "_", ad_id)
                    for i, (url, kind) in enumerate(urls_to_download):
                        min_bytes = (MIN_IMAGE_SIZE_KB * 1024) if kind == "image" else None
                        stem = f"{safe_id}_{kind}"
                        if len(urls_to_download) > 1:
                            stem += f"_{i}"
                        filepath = out_dir / stem
                        if download_url(url, filepath, min_size_bytes=min_bytes):
                            downloaded += 1
                            print(f"   Saved: {filepath.name}")
    else:
        meta_ids = set()
        for ad in meta_ads:
            raw = ad.get("id")
            if raw is None or not str(raw).strip():
                continue
            sid = str(raw).strip()
            meta_ids.add(sid)
            if "_" in sid:
                meta_ids.add(sid.split("_")[-1])
        if meta_ids:
            run_input = {
                "keywords": keywords,
                "country": country,
                "resultsLimit": max(limit, len(meta_ads), 30),
            }
            if media == "image":
                run_input["mediaType"] = "image"
            elif media == "video":
                run_input["mediaType"] = "video"
            print("Running Apify actor (meta-ad-library-multi-search-scraper) for creatives...")
            client = ApifyClient(apify_token)
            run = client.actor("jy-labs/meta-ad-library-multi-search-scraper").call(run_input=run_input)
            apify_items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
            apify_path = out_dir / "apify_results.json"
            with open(apify_path, "w", encoding="utf-8") as f:
                json.dump(apify_items, f, indent=2, ensure_ascii=False)
            print(f"Saved Apify results ({len(apify_items)} item(s)) to {apify_path}")
            if download_media:
                apify_by_library_id = {}
                for item in apify_items:
                    lid = _library_id_from_item(item)
                    if lid and lid in meta_ids:
                        apify_by_library_id[lid] = item
                for library_id, item in apify_by_library_id.items():
                    image_urls, video_urls = collect_creative_urls(item)
                    if want_image and want_video:
                        urls_to_download = [(u, "image") for u in image_urls] + [(u, "video") for u in video_urls[:1]]
                    elif want_image:
                        urls_to_download = [(u, "image") for u in image_urls]
                    elif want_video:
                        urls_to_download = [(u, "video") for u in video_urls[:1]]
                    else:
                        urls_to_download = []
                    if not urls_to_download:
                        continue
                    safe_id = re.sub(r"[/\\]", "_", library_id)
                    for i, (url, kind) in enumerate(urls_to_download):
                        min_bytes = (MIN_IMAGE_SIZE_KB * 1024) if kind == "image" else None
                        stem = f"{safe_id}_{kind}"
                        if len(urls_to_download) > 1:
                            stem += f"_{i}"
                        filepath = out_dir / stem
                        if download_url(url, filepath, min_size_bytes=min_bytes):
                            downloaded += 1
                            print(f"   Saved: {filepath.name}")

    if download_media:
        print(f"\nDownloaded {downloaded} creative(s) to {out_dir}")
    apify_path_resolved = out_dir / "apify_results.json" if (out_dir / "apify_results.json").exists() else None
    return (out_dir, meta_path, apify_path_resolved)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Meta Graph API for ads metadata (ad_snapshot_url, targeting); Apify for creatives only. Maps by library id."
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        type=Path,
        help="Output folder path where creatives will be saved",
    )
    parser.add_argument(
        "-m",
        "--media",
        choices=["image", "video", "both"],
        default="both",
        help="Which creatives to download: image only, video only, or both (default: both)",
    )
    parser.add_argument(
        "-k",
        "--keywords",
        nargs="+",
        default=["nike.com"],
        help="Search keywords (default: nike.com)",
    )
    parser.add_argument(
        "-c",
        "--country",
        default="US",
        help="Country code (default: US). Use EU for all EU countries, ALL for no country filter.",
    )
    parser.add_argument(
        "-l",
        "--limit",
        type=int,
        default=10,
        help="Max results to fetch from Meta API (default: 10)",
    )
    parser.add_argument(
        "-t",
        "--token",
        default=None,
        help="Apify API token (required when --creatives-from=apify or apify-snapshot)",
    )
    parser.add_argument(
        "--creatives-from",
        choices=["snapshot", "apify", "apify-snapshot"],
        default="snapshot",
        help="Get creatives: snapshot=scrape ad_snapshot_url in Python; apify=keyword search actor; apify-snapshot=Apify scrapes each ad_snapshot_url. Default: snapshot.",
    )
    parser.add_argument(
        "--meta-token",
        required=True,
        help="Meta Graph API access token – used for full ads metadata (ad_snapshot_url, targeting)",
    )
    parser.add_argument(
        "-r",
        "--recent",
        action="store_true",
        help="Filter to 3 buckets: (1) running >15d, (2) stopped in last 15d+ran long, (3) any running ad",
    )
    parser.add_argument("--min-running-days", type=int, default=15, help="Min days for long-running (default: 15)")
    parser.add_argument("--stopped-within-days", type=int, default=15, help="Stopped within X days for bucket 2 (default: 15)")
    parser.add_argument(
        "--ad-active-status",
        choices=["ACTIVE", "INACTIVE", "ALL"],
        default="ACTIVE",
        help="Meta API: ACTIVE (default), INACTIVE, or ALL. ACTIVE = only ads eligible for delivery.",
    )
    parser.add_argument(
        "--delivery-date-min-days",
        type=int,
        default=None,
        metavar="N",
        help="Meta API recency: only ads delivered in last N days (sets ad_delivery_date_min).",
    )
    parser.add_argument(
        "--delivery-date-min",
        default=None,
        metavar="YYYY-MM-DD",
        help="Meta API: only ads delivered on/after this date (overrides --delivery-date-min-days).",
    )
    parser.add_argument(
        "--no-keyword-filter",
        action="store_true",
        help="Skip keyword filter in link_captions/link_titles. Meta API already filters by search term; use when you get 0 results due to strict filter.",
    )
    parser.add_argument(
        "--no-download-media",
        action="store_true",
        help="Skip downloading creatives (still save meta_ads.json and apify_results.json)",
    )
    args = parser.parse_args()

    ad_delivery_date_min = args.delivery_date_min
    if ad_delivery_date_min is None and args.delivery_date_min_days is not None:
        d = (datetime.now(timezone.utc) - timedelta(days=args.delivery_date_min_days)).date()
        ad_delivery_date_min = d.isoformat()

    meta_token = (args.meta_token or "").strip()
    apify_token = (args.token or "").strip() if args.token else ""
    if not meta_token:
        print("Error: --meta-token is required.", file=sys.stderr)
        sys.exit(1)
    if args.creatives_from in ("apify", "apify-snapshot") and not apify_token:
        print("Error: -t/--token (Apify) is required when --creatives-from=apify or apify-snapshot.", file=sys.stderr)
        sys.exit(1)

    run_fetch(
        output=args.output,
        keywords=args.keywords,
        country=args.country,
        limit=args.limit,
        media=args.media,
        meta_token=meta_token,
        apify_token=apify_token,
        creatives_from=args.creatives_from,
        recent=args.recent,
        download_media=not args.no_download_media,
        min_running_days=args.min_running_days,
        stopped_within_days=args.stopped_within_days,
        ad_active_status=args.ad_active_status,
        ad_delivery_date_min=ad_delivery_date_min,
        keyword_filter=not args.no_keyword_filter,
    )


if __name__ == "__main__":
    main()
