"""
DVYB Domain Product Images
Fetch product/brand images from website URL and Instagram (if resolvable) for onboarding product selection.
Images are saved incrementally via callback so users see them as they arrive (no wait for full batch).
"""
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.domain_instagram_resolver import resolve_instagram_handle
from app.services.instagram_image_fetcher import fetch_images_from_instagram
from app.services.website_image_fetcher import fetch_images_from_website

logger = logging.getLogger(__name__)

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=4)

# Max 4 images total; website preferred, Instagram only to fill if website has fewer
MAX_PRODUCT_IMAGES = 4


def normalize_domain(url: str) -> str:
    """Extract normalized domain for cache key (e.g. example.com)."""
    url = (url or "").strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        return host or url
    except Exception:
        return url


def _domain_hash(url: str) -> str:
    """Hash for S3 path prefix."""
    return hashlib.md5((url or "").encode()).hexdigest()[:12]


def _post_image_to_callback(callback_url: str, domain: str, img: dict) -> None:
    """POST a single image to TypeScript callback for incremental DB save."""
    try:
        r = requests.post(
            callback_url,
            json={
                "domain": domain,
                "s3_key": img["s3_key"],
                "presigned_url": img.get("presigned_url", ""),
                "sourceLabel": img.get("sourceLabel"),
            },
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if not r.ok:
            logger.warning(f"⚠️ Callback POST failed {r.status_code} for {img.get('s3_key', '?')}")
    except Exception as e:
        logger.warning(f"⚠️ Callback POST error for {img.get('s3_key', '?')}: {e}")


def _run_fetch_in_background(url: str, domain: str, domain_hash: str, callback_url: str) -> None:
    """Run fetch in thread; website first (preferred), Instagram only to fill if website has fewer than 4."""
    def on_image(img: dict) -> None:
        _post_image_to_callback(callback_url, domain, img)

    website_count = 0

    # 1. Website images first (preferred) - up to MAX_PRODUCT_IMAGES
    try:
        logger.info(f"📸 Fetching domain product images for: {domain}")
        website_images = fetch_images_from_website(
            page_url=url, max_images=MAX_PRODUCT_IMAGES, on_image_ready=on_image
        )
        website_count = len(website_images)
        logger.info(f"   Website: {website_count} images")
    except Exception as e:
        logger.warning(f"⚠️ Website fetch failed for {domain} (continuing with Instagram): {e}")

    # 2. Instagram only if we need more to reach MAX_PRODUCT_IMAGES
    ig_count = 0
    needed = MAX_PRODUCT_IMAGES - website_count
    if needed > 0:
        try:
            ig_handle = resolve_instagram_handle(domain, website_url=url)
            if ig_handle:
                ig_images = fetch_images_from_instagram(
                    handle=ig_handle,
                    domain_hash=domain_hash,
                    max_images=needed,
                    on_image_ready=on_image,
                )
                ig_count = len(ig_images)
                logger.info(f"   Instagram @{ig_handle}: {ig_count} images (filled gap)")
        except Exception as e:
            logger.warning(f"⚠️ Instagram fetch failed for {domain}: {e}")

    logger.info(f"✅ Fetched {website_count + ig_count} total for {domain}")


class FetchDomainImagesRequest(BaseModel):
    url: str
    callback_url: str | None = None  # If set, return 202 and POST each image as it's ready


class FetchDomainImagesResponse(BaseModel):
    success: bool
    domain: str
    images: list[dict]  # [{s3_key, presigned_url, sourceLabel?}]
    error: str | None = None
    accepted: bool = False  # True when 202 - fetch running in background


@router.post("/api/dvyb/fetch-domain-images", response_model=FetchDomainImagesResponse)
async def fetch_domain_images(request: FetchDomainImagesRequest):
    """
    Fetch product/brand images from website (5) and Instagram (5 if handle resolvable).
    If callback_url is provided: return 202 immediately, run fetch in background, POST each image
    to callback as it's ready (incremental saves - user sees images as they arrive).
    If no callback_url: synchronous, return full batch when done (legacy).
    """
    url = (request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    domain = normalize_domain(url)
    if not domain:
        return FetchDomainImagesResponse(success=False, domain="", images=[], error="Invalid URL")

    callback_url = (request.callback_url or "").strip() or None
    domain_hash = _domain_hash(url)

    if callback_url:
        # Incremental mode: return 202, run in background, POST each image to callback
        _executor.submit(_run_fetch_in_background, url, domain, domain_hash, callback_url)
        return FetchDomainImagesResponse(
            success=True,
            domain=domain,
            images=[],
            accepted=True,
        )

    # Legacy sync mode: website first (preferred), Instagram only to fill
    all_images: list[dict] = []
    try:
        website_images = fetch_images_from_website(page_url=url, max_images=MAX_PRODUCT_IMAGES)
        all_images.extend(website_images)
    except Exception as e:
        logger.warning(f"⚠️ Website fetch failed for {domain} (continuing with Instagram): {e}")
    needed = MAX_PRODUCT_IMAGES - len(all_images)
    if needed > 0:
        try:
            ig_handle = resolve_instagram_handle(domain, website_url=url)
            if ig_handle:
                ig_images = fetch_images_from_instagram(
                    handle=ig_handle, domain_hash=domain_hash, max_images=needed
                )
                all_images.extend(ig_images)
        except Exception as e:
            logger.warning(f"⚠️ Instagram fetch failed for {domain}: {e}")
    return FetchDomainImagesResponse(success=True, domain=domain, images=all_images)
