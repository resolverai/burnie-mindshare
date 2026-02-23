"""
DVYB Brands Fetch API
=====================
Fetches competitor ads from Meta Ad Library + Apify, enriches with Gemini,
uploads creatives to S3, and callbacks to TypeScript backend.
All in-memory: no file I/O, no subprocess, no stdout.
"""

import html
import json
import logging
import mimetypes
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import requests

from app.config.settings import settings
from app.services.s3_storage_service import S3StorageService

logger = logging.getLogger(__name__)

# Video extensions for image-only filter (only save ads with image creatives, not video)
_VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".m4v")


def _is_video_url(url: str) -> bool:
    """True if URL path or extension suggests video. Used to filter image-only when media=image."""
    if not url or not isinstance(url, str):
        return False
    path = (urlparse(url).path or "").lower()
    return any(ext in path for ext in _VIDEO_EXTENSIONS)


def _is_video_content_type(ct: str) -> bool:
    """True if Content-Type indicates video."""
    if not ct:
        return False
    ct_lower = ct.lower().split(";")[0].strip()
    return ct_lower.startswith("video/")

router = APIRouter(prefix="/api/dvyb/brands", tags=["dvyb-brands"])


class CountryInput(BaseModel):
    code: str
    name: str


class BrandsFetchRequest(BaseModel):
    """Request body: brandDomain (stored on ads); facebookHandle + optional facebookPageId for Meta Ads Library."""
    brandId: int
    brandDomain: str
    facebookHandle: str | None = None  # Facebook page handle for Meta search
    facebookPageId: str | None = None  # From Ads Library URL view_all_page_id=...; when set, fetch only that page's ads
    callbackUrl: str
    countries: list[CountryInput] | None = None  # Empty/None = All (fetch for all). Single = one. Multiple = each.
    limit: int = 300  # Fetch this many ads from Meta
    saveLimit: int | None = None  # If set (e.g. 20 for initial fetch), only download creatives and save this many
    excludeMetaAdIds: list[str] | None = None  # Ads already in DB with ad copy + creatives (skip re-fetch)
    media: str = "image"  # image, video, or both
    localCompetitors: int = 5
    globalCompetitors: int = 2
    noKeywordFilter: bool = False  # Use for domains like flipkart.com where keyword filter gives 0


def _sanitize_meta_ad_id(meta_ad_id: str) -> str:
    """Sanitize metaAdId for use in S3 path."""
    s = re.sub(r"[^a-zA-Z0-9_-]", "_", str(meta_ad_id or "").strip())
    return s[:100] if s else "unknown"


def _file_safe_id(meta_ad_id: str) -> str:
    """Same as meta-ads-fetch: used for matching downloaded filenames."""
    return re.sub(r"[/\\]", "_", str(meta_ad_id or "").strip())


def _upload_local_creative_to_s3(
    s3_service: S3StorageService,
    local_path: Path,
    brand_id: int,
    meta_ad_id: str,
    content_type: str,  # "image" or "video"
) -> str | None:
    """Upload a locally downloaded creative file (from meta-ads-fetch) to S3. Returns S3 key or None."""
    try:
        content = local_path.read_bytes()
        ext = local_path.suffix or ".jpg"
        mime, _ = mimetypes.guess_type(str(local_path))
        ct = mime or ("image/jpeg" if content_type == "image" else "video/mp4")
        safe_id = _sanitize_meta_ad_id(meta_ad_id)
        s3_key = f"dvyb_brands/{brand_id}/ads/{safe_id}/{content_type}{ext}"
        result = s3_service._upload_to_s3(content, s3_key, ct)
        if result.get("success"):
            return s3_key
        logger.warning(f"Failed to upload creative to S3: {result.get('error')}")
        return None
    except Exception as e:
        logger.warning(f"Failed to upload creative {local_path}: {e}")
        return None


def _download_url_content(url: str) -> tuple[bytes, str] | None:
    """Download URL and return (content, content_type) or None on failure."""
    if not url or not str(url).strip():
        return None
    # Decode HTML entities (e.g. &amp; -> &) so the request URL is valid; Facebook may 403 without Referer
    url = html.unescape(str(url).strip())
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.facebook.com/",
        }
        resp = requests.get(url, headers=headers, timeout=60)
        resp.raise_for_status()
        content = resp.content
        ct = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
        return (content, ct)
    except Exception as e:
        logger.warning(f"Failed to download from {url[:60]}...: {e}")
        return None


# Facebook CDN uses _s60x60_, _s600x600_ etc. Treat small sizes as thumbnails/icons to skip (same as extension flow).
_SMALL_THUMBNAIL_SIZE = 200


def _is_small_thumbnail_url(url: str) -> bool:
    """True if URL looks like a small thumbnail (e.g. s60x60, s120x120). s600x600 and larger are kept."""
    if not url or not isinstance(url, str):
        return True
    m = re.search(r"[/_]s(\d+)x(\d+)[/_]", url, re.I)
    if not m:
        return False
    w, h = int(m.group(1)), int(m.group(2))
    return max(w, h) <= _SMALL_THUMBNAIL_SIZE


def _normalize_image_url(url: str) -> str:
    """Normalize URL for deduplication (e.g. &amp; -> &)."""
    return html.unescape((url or "").strip())


def _filter_non_thumbnail_image_urls(urls: list[str]) -> list[str]:
    """Dedupe by normalized URL and drop small thumbnail/icon URLs (max dimension ≤200 from _sWxH_ in URL)."""
    seen: set[str] = set()
    out: list[str] = []
    for u in ((u or "").strip() for u in urls if u):
        if not u:
            continue
        norm = _normalize_image_url(u)
        if norm in seen or _is_small_thumbnail_url(u):
            continue
        seen.add(norm)
        out.append(u)
    return out


def _download_all_images_and_upload_to_s3(
    s3_service: S3StorageService,
    urls: list[str],
    brand_id: int,
    meta_ad_id: str,
) -> tuple[str | None, list[str]]:
    """
    Filter out thumbnails/small images, then download each and upload to S3 (image, image_1, image_2, ...).
    Returns (primary_s3_key, extra_s3_keys). Skips small thumbnail/icon URLs (max dimension ≤200).
    """
    filtered = _filter_non_thumbnail_image_urls(urls)
    if not filtered:
        return (None, [])
    primary_key: str | None = None
    extra_keys: list[str] = []
    safe_id = _sanitize_meta_ad_id(meta_ad_id)
    for i, url in enumerate(filtered):
        result = _download_url_content(url)
        if not result:
            continue
        content, raw_ct = result
        if _is_video_content_type(raw_ct or ""):
            continue
        ext = ".jpg"
        if "png" in (raw_ct or ""):
            ext = ".png"
        elif "gif" in (raw_ct or ""):
            ext = ".gif"
        elif "webp" in (raw_ct or ""):
            ext = ".webp"
        ct = raw_ct or "image/jpeg"
        sub_key = "image" if i == 0 else f"image_{i}"
        s3_key = f"dvyb_brands/{brand_id}/ads/{safe_id}/{sub_key}{ext}"
        if s3_service._upload_to_s3(content, s3_key, ct).get("success"):
            if i == 0:
                primary_key = s3_key
            else:
                extra_keys.append(s3_key)
    return (primary_key, extra_keys)


def _download_largest_and_upload_to_s3(
    s3_service: S3StorageService,
    urls: list[str],
    brand_id: int,
    meta_ad_id: str,
    content_type: str,  # "image" or "video"
    image_only: bool = False,  # When True, reject video URLs and video Content-Type (only save image creatives)
) -> str | None:
    """
    Download all creatives from URLs, pick the one with maximum size, upload to S3.
    When image_only=True (media=image): only accept image URLs and image Content-Type; reject video.
    Returns S3 key or None.
    """
    if not urls:
        return None
    if image_only:
        urls = [u for u in urls if not _is_video_url(u)]
        if not urls:
            return None
    candidates: list[tuple[bytes, str]] = []
    for url in urls:
        result = _download_url_content(url)
        if result:
            _, raw_ct = result
            if image_only and _is_video_content_type(raw_ct or ""):
                continue  # Skip video content when we only want images
            candidates.append(result)
    if not candidates:
        return None
    content, raw_ct = max(candidates, key=lambda x: len(x[0]))
    ct = raw_ct or "application/octet-stream"
    if content_type == "image":
        ext = ".jpg" if "jpeg" in ct or "jpg" in ct else ".png" if "png" in ct else ".gif" if "gif" in ct else ".webp" if "webp" in ct else ".jpg"
        ct = ct if ct and ct != "application/octet-stream" else "image/jpeg"
    else:
        ext = ".mp4" if "mp4" in ct else ".webm" if "webm" in ct else ".mov" if "quicktime" in ct else ".mp4"
        ct = ct if ct and ct != "application/octet-stream" else "video/mp4"
    safe_id = _sanitize_meta_ad_id(meta_ad_id)
    s3_key = f"dvyb_brands/{brand_id}/ads/{safe_id}/{content_type}{ext}"
    result = s3_service._upload_to_s3(content, s3_key, ct)
    if result.get("success"):
        return s3_key
    logger.warning(f"Failed to upload creative to S3: {result.get('error')}")
    return None


# When countries empty/None from frontend = "all countries": one fetch with ALL (single call)
ALL_COUNTRY_SENTINEL = "ALL"


def _run_brands_fetch_task(
    brand_id: int,
    brand_domain: str,
    callback_url: str,
    countries: list[dict] | None,
    limit: int,
    save_limit: int | None,
    exclude_meta_ad_ids: list[str] | None,
    media: str,
    local_competitors: int,
    global_competitors: int,
    no_keyword_filter: bool = False,
    facebook_handle: str | None = None,
    facebook_page_id: str | None = None,
):
    """
    Background task: fetch ads, enrich with Gemini (before download), then download creatives
    and callback incrementally as each ad's creatives are uploaded to S3.
    Ads are saved to dvyb_brand_ads as soon as creatives are ready.
    """
    meta_token = settings.meta_ad_library_access_token or os.environ.get("META_AD_LIBRARY_ACCESS_TOKEN") or ""
    apify_token = settings.apify_token or os.environ.get("APIFY_TOKEN") or ""
    if not meta_token or not apify_token:
        _callback_failed(callback_url, brand_id, "META_AD_LIBRARY_ACCESS_TOKEN and APIFY_TOKEN required")
        return

    # Use only what frontend passed: empty/None = one run with ALL; otherwise exact list (one or more).
    requested_all_countries = not countries or len(countries) == 0
    if requested_all_countries:
        country_codes = [ALL_COUNTRY_SENTINEL]  # single fetch, not 5 separate countries
    else:
        country_codes = [c.get("code", c) if isinstance(c, dict) else str(c) for c in countries if c]
        if not country_codes:
            country_codes = [ALL_COUNTRY_SENTINEL]

    enrichment: dict | None = None

    try:
        from app.services.gemini_competitor_analysis import (
            fetch_ad_pool_for_brand,
            enrich_ads_with_gemini,
        )
        from app.services import meta_ads_fetch
    except ImportError as e:
        logger.error(f"Failed to import fetch modules: {e}")
        _callback_failed(callback_url, brand_id, "Fetch module not available")
        return

    tmpdir = tempfile.mkdtemp(prefix="dvyb_fetch_")
    out_dir = Path(tmpdir)
    want_image = media in ("image", "both")
    want_video = media in ("video", "both")
    s3_service = S3StorageService()
    target_save = save_limit if save_limit and save_limit > 0 else 20
    # Strategy: fetch 100 ads in one shot, filter (DB exclude + keyword), use as pool.
    # Process 20 at a time from pool (no re-fetch until pool exhausted).
    # When pool exhausted and <20 saved: increase limit (100->200->...), fetch again.
    POOL_INITIAL = 100
    BATCH_SIZE = 20

    try:
        for country_code in country_codes:
            code = str(country_code).strip().upper() or "US"
            if code == ALL_COUNTRY_SENTINEL:
                logger.info("Fetching ads (all countries): pool of 100, process 20 at a time until %d saved", target_save)
            total_with_creatives = 0
            all_processed_ids: set[str] = set(exclude_meta_ad_ids or [])
            fetch_limit = POOL_INITIAL
            pool: list[dict] = []
            pool_idx = 0

            while total_with_creatives < target_save:
                # Refill pool when exhausted
                if pool_idx >= len(pool):
                    try:
                        pool = fetch_ad_pool_for_brand(
                            brand_domain=brand_domain,
                            country=code,
                            limit=fetch_limit,
                            exclude_meta_ad_ids=all_processed_ids,
                            pool_size=fetch_limit,
                            media=media,
                            meta_token=meta_token,
                            apify_token=apify_token,
                            no_keyword_filter=no_keyword_filter,
                            facebook_handle=facebook_handle,
                            facebook_page_id=facebook_page_id,
                        )
                    except (Exception, SystemExit) as e:
                        err_msg = str(e)[:500] if e else "Unknown error"
                        logger.error("fetch_ad_pool_for_brand failed for %s: %s", code, e)
                        if len(country_codes) == 1:
                            _callback_failed(callback_url, brand_id, err_msg)
                            return
                        break
                    pool_idx = 0
                    if not pool:
                        logger.info("   No more ads from API. Stopping.")
                        break
                    # Next time fetch more if we need to continue
                    fetch_limit = min(fetch_limit * 2, 500)

                batch = pool[pool_idx : pool_idx + BATCH_SIZE]
                pool_idx += BATCH_SIZE
                for ad in batch:
                    aid = str(ad.get("id") or "").strip()
                    if aid:
                        all_processed_ids.add(aid)

                logger.info(
                    "   Batch: processing %d ads from pool (target: %d saved, have %d)",
                    len(batch),
                    target_save,
                    total_with_creatives,
                )

                # Save batch to meta_ads.json for enrich
                meta_path = out_dir / "meta_ads.json"
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(batch, f, indent=2, ensure_ascii=False)

                # Run Puppeteer on batch snapshot URLs
                _, apify_path = meta_ads_fetch.run_puppeteer_snapshot_for_ads(
                    batch, apify_token, out_dir
                )

                # Enrich (Gemini only on first batch; reuse enrichment_override for rest)
                out_data = enrich_ads_with_gemini(
                    meta_path,
                    None,
                    apify_results_path=apify_path,
                    search_brand=brand_domain,
                    keywords=[brand_domain] if brand_domain else [],
                    keyword_filter=False,  # batch already filtered at fetch
                    local_limit=local_competitors,
                    global_limit=global_competitors,
                    media=media,
                    enrichment_override=enrichment,
                )
                if enrichment is None:
                    enrichment = {
                        "category": out_data.get("category"),
                        "similarCompetitors": out_data.get("similarCompetitors"),
                        "searchBrandInstagram": out_data.get("searchBrandInstagram"),
                        "searchBrandRevenue": out_data.get("searchBrandRevenue"),
                    }

                ads_ui = out_data.get("ads") or []

                for ad in ads_ui:
                    meta_ad_id = str(ad.get("id") or ad.get("metaAdId") or "").strip()
                    ad["creativeImageS3Key"] = None
                    ad["extraImageS3Keys"] = []
                    ad["creativeVideoS3Key"] = None
                    img_urls = ad.get("creativeImageUrls") or []
                    if not img_urls and ad.get("creativeImageUrl"):
                        img_urls = [ad.get("creativeImageUrl")]
                    vid_urls = ad.get("creativeVideoUrls") or []
                    if not vid_urls and ad.get("creativeVideoUrl"):
                        vid_urls = [ad.get("creativeVideoUrl")]

                    if want_image and img_urls:
                        primary_key, extra_keys = _download_all_images_and_upload_to_s3(
                            s3_service, img_urls, brand_id, meta_ad_id
                        )
                        if primary_key:
                            ad["creativeImageS3Key"] = primary_key
                        if extra_keys:
                            ad["extraImageS3Keys"] = extra_keys
                        if primary_key or extra_keys:
                            logger.info(
                                "Uploaded images for %s: primary=%s, extras=%d",
                                meta_ad_id, bool(primary_key), len(extra_keys),
                            )
                    if want_video and vid_urls:
                        s3_key = _download_largest_and_upload_to_s3(
                            s3_service, vid_urls, brand_id, meta_ad_id, "video"
                        )
                        if s3_key:
                            ad["creativeVideoS3Key"] = s3_key
                            logger.info("Uploaded video (max of %d): %s -> %s", len(vid_urls), meta_ad_id, s3_key)

                saved_this_batch = 0
                for ad in ads_ui:
                    if ad.get("creativeImageS3Key") or ad.get("creativeVideoS3Key"):
                        _callback_success(callback_url, [ad], enrichment, is_complete=False)
                        saved_this_batch += 1
                    else:
                        meta_ad_id_skip = str(ad.get("id") or ad.get("metaAdId") or "").strip()
                        logger.info(
                            "   Skipped %s: no creatives extracted (img=%d, vid=%d)",
                            meta_ad_id_skip,
                            len(ad.get("creativeImageUrls") or []),
                            len(ad.get("creativeVideoUrls") or []),
                        )

                total_with_creatives += saved_this_batch
                logger.info(
                    "   Batch result: %d processed, %d saved to DB, total=%d/%d",
                    len(ads_ui),
                    saved_this_batch,
                    total_with_creatives,
                    target_save,
                )

                if total_with_creatives >= target_save:
                    break

        _callback_success(callback_url, [], enrichment, is_complete=True)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _callback_success(callback_url: str, ads: list, enrichment: dict | None = None, is_complete: bool = True):
    """POST ads and enrichment to TypeScript callback. is_complete=True marks fetch done."""
    payload: dict = {"ads": ads, "isComplete": is_complete}
    if enrichment:
        payload["category"] = enrichment.get("category")
        payload["similarCompetitors"] = enrichment.get("similarCompetitors")
        payload["searchBrandInstagram"] = enrichment.get("searchBrandInstagram")
        payload["searchBrandRevenue"] = enrichment.get("searchBrandRevenue")
    try:
        resp = requests.post(
            callback_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        if resp.status_code >= 200 and resp.status_code < 300:
            logger.info(f"Callback OK: {len(ads)} ads, isComplete={is_complete}")
        else:
            logger.warning(f"Callback returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"Callback failed: {e}")


def _callback_failed(callback_url: str, brand_id: int, error: str):
    """Notify TypeScript of failure (optional - TypeScript may poll status)."""
    try:
        resp = requests.post(
            callback_url,
            json={"ads": [], "error": error},
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        logger.info(f"Failure callback: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failure callback failed: {e}")


class RunInventoryAnalysisRequest(BaseModel):
    """Request body for run-inventory-analysis: list of ads to analyze."""
    items: list[dict]  # [{ "adId": str, "presignedUrl": str, "category": str | None }]


@router.post("/run-inventory-analysis")
async def run_inventory_analysis(request: RunInventoryAnalysisRequest):
    """
    Run Grok inventory analysis on ad images. Used by admin dashboard and scripts
    to backfill subcategory/inventoryAnalysis for ads that don't have it.
    items: [{ adId, presignedUrl, category }]
    Returns: { success, results: { adId: { inventoryAnalysis, subcategory } } }
    """
    items = request.items or []
    if not items:
        return {"success": True, "results": {}}
    try:
        from app.services.brand_ad_inventory_analysis import analyze_ad_images_with_grok
    except ImportError as e:
        logger.warning(f"Could not import Grok inventory analysis: {e}")
        return {"success": False, "error": "Grok module not available", "results": {}}
    image_items = []
    for it in items:
        ad_id = str(it.get("adId") or it.get("ad_id") or "").strip()
        url = (it.get("presignedUrl") or it.get("presigned_url") or "").strip()
        if ad_id and url and (url.startswith("http://") or url.startswith("https://")):
            image_items.append({
                "ad_id": ad_id,
                "presigned_url": url,
                "category": it.get("category") or "Others",
            })
    if not image_items:
        return {"success": True, "results": {}}
    results = analyze_ad_images_with_grok(image_items)
    return {"success": True, "results": results}


@router.post("/fetch")
async def start_brands_fetch(request: BrandsFetchRequest, background_tasks: BackgroundTasks):
    """
    Start brand ads fetch. Runs in background:
    - Fetches ads from Meta + Apify
    - Enriches with Gemini
    - Downloads creatives and uploads to S3
    - POSTs to callbackUrl with ads (creativeImageS3Key, creativeVideoS3Key)
    """
    if not settings.meta_ad_library_access_token or not settings.apify_token:
        raise HTTPException(
            status_code=503,
            detail="META_AD_LIBRARY_ACCESS_TOKEN and APIFY_TOKEN required in python-ai-backend .env",
        )
    if not settings.google_gemini_api_key and not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY required in python-ai-backend .env",
        )

    countries_list = None
    if request.countries:
        countries_list = [{"code": c.code.strip(), "name": c.name.strip()} for c in request.countries if c.code]

    exclude_ids = request.excludeMetaAdIds if request.excludeMetaAdIds is not None else []

    facebook_handle = None
    if request.facebookHandle and str(request.facebookHandle).strip():
        facebook_handle = str(request.facebookHandle).strip().lstrip("@")
    facebook_page_id = None
    if request.facebookPageId and str(request.facebookPageId).strip():
        facebook_page_id = str(request.facebookPageId).strip().replace(" ", "")

    background_tasks.add_task(
        _run_brands_fetch_task,
        request.brandId,
        request.brandDomain.strip(),
        request.callbackUrl.strip(),
        countries_list,
        request.limit,
        request.saveLimit,
        exclude_ids,
        request.media,
        request.localCompetitors,
        request.globalCompetitors,
        request.noKeywordFilter,
        facebook_handle,
        facebook_page_id,
    )

    return {
        "success": True,
        "message": "Fetch started",
        "brandId": request.brandId,
    }
