"""
DVYB Chrome Extension: fetch single ad by Meta Library ID and upload creatives to S3.
Used when a user saves an ad from Meta Ad Library that is not yet on the platform.
"""

import html
import logging
import re

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config.settings import settings
from app.services.meta_ads_fetch import fetch_single_ad_by_library_id
from app.services.s3_storage_service import S3StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dvyb/extension", tags=["dvyb-extension"])


def _sanitize_meta_ad_id(meta_ad_id: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]", "_", str(meta_ad_id or "").strip())
    return s[:100] if s else "unknown"


# Facebook CDN uses _s60x60_, _s600x600_ etc. in URLs. Treat small sizes as thumbnails/icons to skip.
_SMALL_THUMBNAIL_SIZE = 200  # max dimension; e.g. s60x60, s120x120 are thumbnails; s600x600 is creative


def _is_small_thumbnail_url(url: str) -> bool:
    """True if URL looks like a small thumbnail (e.g. s60x60, s120x120). s600x600 and larger are kept."""
    if not url or not isinstance(url, str):
        return True
    # Match _s123x456_ or /s123x456/ in path/query
    m = re.search(r"[/_]s(\d+)x(\d+)[/_]", url, re.I)
    if not m:
        return False  # No size in URL -> assume full size
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


def _download_url_content(url: str) -> tuple[bytes, str] | None:
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
        logger.warning("Failed to download from %s: %s", url[:60], e)
        return None


class FetchSingleAdRequest(BaseModel):
    metaAdId: str


class UploadAdCreativesRequest(BaseModel):
    brandId: int
    metaAdId: str
    creativeImageUrls: list[str] = []
    creativeVideoUrls: list[str] = []


@router.post("/fetch-single-ad")
async def fetch_single_ad(request: FetchSingleAdRequest):
    """
    Fetch a single ad by its Meta Ad Library ID.

    When META_AD_LIBRARY_ACCESS_TOKEN is set: uses Meta Ad Library Graph API for
    metadata (pageId, pageName, ad copy, dates) then Puppeteer only for creative
    image/video URLs. When the token is missing or the ad is not in API scope
    (e.g. non-political, non-EU/UK), uses Puppeteer for everything.
    Returns ad metadata for the TypeScript backend to create brand and ad.
    """
    apify_token = (settings.apify_token or "").strip()
    if not apify_token:
        raise HTTPException(status_code=503, detail="APIFY_TOKEN required")
    meta_ad_id = (request.metaAdId or "").strip()
    if not meta_ad_id:
        raise HTTPException(status_code=400, detail="metaAdId is required")
    meta_token = (settings.meta_ad_library_access_token or "").strip() or None

    ad = fetch_single_ad_by_library_id(apify_token, meta_ad_id, meta_token=meta_token)
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found or scrape failed")

    bodies = ad.get("ad_creative_bodies") or []
    ad_copy = None
    if bodies:
        ad_copy = {"bodies": bodies, "titles": [], "descriptions": [], "captions": []}

    img_urls = _filter_non_thumbnail_image_urls(ad.get("creativeImageUrls") or [])
    vid_urls = ad.get("creativeVideoUrls") or []

    # Targeting/reach: Meta API returns these only for ads delivered to UK & EU (and political in Brazil)
    target_locations = ad.get("target_locations") or []
    target_countries = [
        (loc.get("name") or loc.get("key") or str(loc))
        for loc in target_locations
        if isinstance(loc, dict)
    ][:20]
    reach = None
    if (
        ad.get("eu_total_reach") is not None
        or ad.get("total_reach_by_location")
        or ad.get("br_total_reach") is not None
    ):
        reach = {
            "eu_total_reach": ad.get("eu_total_reach"),
            "total_reach_by_location": ad.get("total_reach_by_location"),
            "br_total_reach": ad.get("br_total_reach"),
        }

    response = {
        "success": True,
        "data": {
            "metaAdId": ad.get("id"),
            "pageId": (ad.get("page_id") or "").strip() or None,
            "pageName": (ad.get("page_name") or "Unknown").strip(),
            "adSnapshotUrl": ad.get("ad_snapshot_url"),
            "creativeImageUrls": img_urls,
            "creativeImageUrl": (img_urls[0] if img_urls else None),
            "creativeVideoUrls": vid_urls,
            "creativeVideoUrl": (ad.get("creativeVideoUrl") or (vid_urls[0] if vid_urls else None)),
            "adCopy": ad_copy,
            "adDeliveryStartTime": ad.get("ad_delivery_start_time"),
            "adDeliveryStopTime": ad.get("ad_delivery_stop_time"),
            "runtime": ad.get("runtime"),
            "firstSeen": ad.get("firstSeen") or (str(ad.get("ad_delivery_start_time") or "")[:10] or None),
            "publisherPlatforms": ad.get("publisher_platforms") or [],
            "brandName": (ad.get("page_name") or "Unknown").strip(),
            "targetCountries": target_countries if target_countries else None,
            "targetAges": ad.get("target_ages") or None,
            "targetGender": (ad.get("target_gender") or "").strip() or None,
            "landingPage": None,
            "reach": reach,
            "beneficiaryPayers": ad.get("beneficiary_payers") or None,
        },
    }
    return response


def _upload_creative_to_s3_with_key(
    s3_service: S3StorageService,
    url: str,
    brand_id: int,
    meta_ad_id: str,
    content_type: str,
    sub_key: str,
) -> str | None:
    """Download one URL and upload to S3 with a specific sub_key (e.g. 'image' or 'image_1'). Returns S3 key or None."""
    result = _download_url_content(url)
    if not result:
        return None
    content, raw_ct = result
    safe_id = _sanitize_meta_ad_id(meta_ad_id)
    if content_type == "image":
        ext = ".jpg"
        if "png" in (raw_ct or ""):
            ext = ".png"
        elif "gif" in (raw_ct or ""):
            ext = ".gif"
        elif "webp" in (raw_ct or ""):
            ext = ".webp"
        ct = raw_ct or "image/jpeg"
    else:
        ext = ".mp4"
        if "webm" in (raw_ct or ""):
            ext = ".webm"
        ct = raw_ct or "video/mp4"
    s3_key = f"dvyb_brands/{brand_id}/ads/{safe_id}/{sub_key}{ext}"
    if s3_service._upload_to_s3(content, s3_key, ct).get("success"):
        return s3_key
    return None


@router.post("/upload-ad-creatives")
async def upload_ad_creatives(request: UploadAdCreativesRequest):
    """
    Download all creative image URLs (excluding small thumbnails/icons), upload each to S3.
    Returns primary image in creativeImageS3Key and all others in extraImageS3Keys.
    """
    brand_id = request.brandId
    meta_ad_id = (request.metaAdId or "").strip()
    if not meta_ad_id:
        raise HTTPException(status_code=400, detail="metaAdId is required")

    raw_count = len(request.creativeImageUrls or [])
    image_urls = _filter_non_thumbnail_image_urls(list(request.creativeImageUrls or []))
    print(f"[upload-ad-creatives] metaAdId={meta_ad_id} input image URLs={raw_count} after filter={len(image_urls)}")
    s3_service = S3StorageService()
    creative_image_s3_key: str | None = None
    extra_image_s3_keys: list[str] = []

    for i, url in enumerate(image_urls):
        sub_key = "image" if i == 0 else f"image_{i}"
        s3_key = _upload_creative_to_s3_with_key(
            s3_service, url, brand_id, meta_ad_id, "image", sub_key
        )
        if s3_key:
            if i == 0:
                creative_image_s3_key = s3_key
            else:
                extra_image_s3_keys.append(s3_key)
        print(f"[upload-ad-creatives] url_i={i} sub_key={sub_key} s3_key={s3_key or 'FAILED'}")

    print(f"[upload-ad-creatives] result primary={creative_image_s3_key} extras={extra_image_s3_keys}")
    return {
        "success": True,
        "data": {
            "creativeImageS3Key": creative_image_s3_key,
            "extraImageS3Keys": extra_image_s3_keys,
            "creativeVideoS3Key": None,
        },
    }
