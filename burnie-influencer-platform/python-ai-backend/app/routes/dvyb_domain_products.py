"""
DVYB Domain Product Images
Fetch product/brand images from website URL and Instagram (if needed) for onboarding product selection.
Flow: (1) Fetch up to 20 images from website, save all directly (no Grok). (2) If website returned
fewer than SUFFICIENT_WEBSITE_COUNT, fetch up to 10 from Instagram, run Grok to keep only product images
relevant to the brand, save only those via callback.
Uses Apify when APIFY_TOKEN is set; falls back to custom/instaloader otherwise.
"""
import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config.settings import settings
from app.services.domain_instagram_resolver import resolve_instagram_handle
from app.services.instagram_image_fetcher import fetch_images_from_instagram
from app.services.instagram_image_fetcher_apify import (
    download_instagram_batch,
    fetch_images_from_instagram_apify,
    get_instagram_image_urls,
)
from app.services.website_image_fetcher import fetch_images_from_website
from app.services.website_image_fetcher_apify import fetch_images_from_website_apify

logger = logging.getLogger(__name__)

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=4)

# Website: fetch up to 20, save all (no Grok). Instagram: only if website < SUFFICIENT, fetch 10, Grok-filter then save.
MAX_WEBSITE_IMAGES = 20
MAX_INSTAGRAM_IMAGES = 10
SUFFICIENT_WEBSITE_COUNT = 10  # If website returns >= this, skip Instagram
GROK_BATCH_SIZE = 8

# When False, skip Instagram image fetch (website images only).
FETCH_INSTAGRAM_IMAGES = True


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
    s3_key = img.get("s3_key", "?")
    try:
        print(f"[fetch-domain-images] POSTing image to callback: s3_key={s3_key}")
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
        if r.ok:
            print(f"[fetch-domain-images] Callback OK for {s3_key} (status={r.status_code})")
        else:
            print(f"[fetch-domain-images] Callback FAILED for {s3_key}: status={r.status_code}, body={r.text[:200]}")
            logger.warning(f"⚠️ Callback POST failed {r.status_code} for {s3_key}")
    except Exception as e:
        print(f"[fetch-domain-images] Callback POST error for {s3_key}: {e}")
        logger.warning(f"⚠️ Callback POST error for {s3_key}: {e}")


# Grok only supports these content types when fetching images; exclude others to avoid FAILED_PRECONDITION
GROK_SUPPORTED_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


def _is_grok_supported_image(img: dict) -> bool:
    """True if image format is supported by Grok (jpeg, jpg, png, webp only)."""
    s3_key = (img.get("s3_key") or "").lower()
    return any(s3_key.endswith(ext) for ext in GROK_SUPPORTED_EXTENSIONS)


def _filter_product_images_with_grok(
    all_images: list[dict],
    brand_context: dict[str, Any] | None = None,
) -> list[dict]:
    """
    Filter images with Grok AI - keep only product images (product as hero) relevant to the brand.
    When brand_context is provided, also require that the product is relevant to the brand (industry/category).
    Images are sent in batches of 8 (Grok limit). Returns only images that pass the AI check.
    Only jpeg/jpg/png/webp are sent to Grok; unsupported formats (gif, avif, etc.) are kept without analysis.
    """
    if not all_images:
        return []
    grok_api_key = settings.xai_api_key
    if not grok_api_key:
        print(f"[fetch-domain-images] ERROR: XAI_API_KEY not configured, skipping Grok filter - saving all {len(all_images)} images")
        logger.warning("XAI_API_KEY not configured - skipping Grok product filter")
        return all_images

    print(f"[fetch-domain-images] Grok filter: analyzing {len(all_images)} images in batches of {GROK_BATCH_SIZE}" + (" with brand context" if brand_context else ""))

    try:
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
    except ImportError:
        print(f"[fetch-domain-images] ERROR: xai_sdk not installed, skipping Grok filter - saving all {len(all_images)} images")
        return all_images

    # Separate supported (jpeg/png/webp) from unsupported (gif, avif, etc.) - Grok rejects unsupported content types
    grok_images = [img for img in all_images if _is_grok_supported_image(img)]
    unsupported_images = [img for img in all_images if not _is_grok_supported_image(img)]
    if unsupported_images:
        print(f"[fetch-domain-images] Grok filter: skipping {len(unsupported_images)} unsupported format(s) (gif/avif/etc), keeping without analysis")

    product_images: list[dict] = list(unsupported_images)  # Keep unsupported as-is (no Grok analysis)

    # Build brand context string for prompt (same style as other Grok calls that take brand context)
    brand_context_str = ""
    if brand_context and isinstance(brand_context, dict):
        parts = []
        if brand_context.get("industry"):
            parts.append(f"Industry: {brand_context.get('industry')}")
        if brand_context.get("business_overview"):
            parts.append(f"Business: {brand_context.get('business_overview')}")
        if brand_context.get("popular_products"):
            p = brand_context.get("popular_products")
            parts.append(f"Popular products: {p if isinstance(p, str) else ', '.join(p) if isinstance(p, list) else str(p)}")
        if parts:
            brand_context_str = "\n\nBRAND CONTEXT (product in image should be relevant to this brand):\n" + "\n".join(parts)

    try:
        for batch_start in range(0, len(grok_images), GROK_BATCH_SIZE):
            batch = grok_images[batch_start : batch_start + GROK_BATCH_SIZE]
            batch_num = (batch_start // GROK_BATCH_SIZE) + 1
            total_batches = (len(grok_images) + GROK_BATCH_SIZE - 1) // GROK_BATCH_SIZE
            print(f"[fetch-domain-images] Grok batch {batch_num}/{total_batches}: {len(batch)} images (indices {batch_start + 1}-{batch_start + len(batch)})")

            presigned_urls = []
            s3_keys = []
            for img in batch:
                url = img.get("presigned_url")
                if url and (url.startswith("http://") or url.startswith("https://")):
                    presigned_urls.append(url)
                    s3_keys.append(img.get("s3_key", "?"))
                else:
                    print(f"[fetch-domain-images] Grok batch {batch_num}: skipping image without valid URL: {img.get('s3_key', '?')}")

            if not presigned_urls:
                print(f"[fetch-domain-images] Grok batch {batch_num}: no valid URLs, skipping")
                continue

            system_prompt = """You are an expert visual analyst for e-commerce product catalogs. Your task: classify images as PRODUCT IMAGE or not.

PRODUCT IMAGE = INCLUDE images where:
- A single product (or one cohesive outfit/set sold as one product) is the clear hero of the image. This INCLUDES:
  - One person modeling/wearing the product (e.g. model wearing one top, one dress, one swimsuit, one matching set). These are strong product images—the product is showcased on the person.
  - Product alone on white/neutral background.
  - Product held or worn by one person, close-up of one product.
- When brand context is given, the product is relevant to that brand (same industry/category).

NOT product image = EXCLUDE only if:
- MULTIPLE distinct products in one image: grid/collage of several different items, catalog shot with many separate SKUs, or multiple people each modeling different products. (One person wearing one outfit or one set counts as ONE product—include it.)
- General non-product imagery: social event, party, group photo, selfie with no product focus, landscape, meme, infographic.
- Product clearly unrelated to the brand (e.g. random food when brand is fashion).

Important: Do NOT exclude an image just because a person is wearing the product. Fashion and apparel brands rely on "model wearing product" shots—treat them as product images when there is one main product/outfit focus."""

            image_list_str = "\n".join([f"- Image {i + 1}: s3_key={s3_keys[i]}" for i in range(len(s3_keys))])
            user_prompt = f"""Analyze these {len(s3_keys)} images. For each: (1) Is this a product image (product as hero—including one person wearing one product/outfit)? (2) If brand context is given, is the product relevant to the brand? Include model-wearing-product shots when the product is the focus.
{brand_context_str}

Images in this batch:
{image_list_str}

Return a JSON object with this EXACT structure:
{{
  "product_image_s3_keys": ["s3_key_1", "s3_key_2"]
}}

Include s3_keys for: product on white background, one person wearing/showing one product or one outfit, close-up of one product. Exclude: grids of multiple items, multiple people modeling different things, non-product lifestyle shots. Use the exact s3_key strings from the list above. If none qualify, return empty array: "product_image_s3_keys": []"""

            max_retries = 2
            for retry in range(max_retries + 1):
                try:
                    client = Client(api_key=grok_api_key, timeout=3600)
                    chat = client.chat.create(model="grok-4-fast-reasoning")
                    chat.append(system(system_prompt))
                    image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
                    chat.append(user(user_prompt, *image_objects))
                    if retry > 0:
                        print(f"[fetch-domain-images] Grok batch {batch_num} retry {retry}/{max_retries}...")
                    else:
                        print(f"[fetch-domain-images] Grok batch {batch_num}: calling Grok...")
                    response = chat.sample()
                    response_text = response.content.strip()

                    # Extract JSON
                    if "```json" in response_text:
                        start = response_text.find("```json") + 7
                        end = response_text.find("```", start)
                        json_content = response_text[start:end].strip()
                    elif "```" in response_text:
                        start = response_text.find("```") + 3
                        end = response_text.find("```", start)
                        json_content = response_text[start:end].strip()
                    elif response_text.startswith("{"):
                        json_content = response_text
                    else:
                        i = response_text.find("{")
                        j = response_text.rfind("}") + 1
                        json_content = response_text[i:j] if i >= 0 and j > i else "{}"
                    json_content = re.sub(r",(\s*[}\]])", r"\1", json_content)
                    data = json.loads(json_content)

                    passed_keys = set(data.get("product_image_s3_keys") or [])
                    print(f"[fetch-domain-images] Grok batch {batch_num}: passed {len(passed_keys)} product images: {passed_keys}")

                    for img in batch:
                        s3_key = img.get("s3_key")
                        if s3_key and s3_key in passed_keys:
                            product_images.append(img)
                            print(f"[fetch-domain-images] Grok filter PASS: {s3_key}")
                        else:
                            print(f"[fetch-domain-images] Grok filter SKIP: {s3_key} (not product image)")

                    break
                except Exception as e:
                    print(f"[fetch-domain-images] Grok batch {batch_num} error: {e}")
                    logger.warning(f"Grok filter batch {batch_num} failed: {e}")
                    if retry < max_retries:
                        continue
                    print(f"[fetch-domain-images] Grok batch {batch_num}: all retries failed, keeping all {len(batch)} images from batch")
                    product_images.extend(batch)

    except Exception as e:
        print(f"[fetch-domain-images] Grok filter fatal error: {e}")
        logger.warning(f"Grok filter failed: {e}")
        return all_images

    print(f"[fetch-domain-images] Grok filter done: {len(product_images)} product images kept from {len(all_images)} total")
    return product_images


def _fetch_website_images(
    url: str,
    domain_hash: str,
    callback_url: str | None = None,
    domain: str | None = None,
    max_images: int = MAX_WEBSITE_IMAGES,
) -> list[dict]:
    """Fetch website images (Apify if token set, else custom). Target max_images (default 20). No Grok - save all.
    When callback_url and domain are set, each image is POSTed to callback as soon as it's downloaded.
    """
    on_image_ready = None
    if callback_url and domain:
        on_image_ready = lambda img: _post_image_to_callback(callback_url, domain, img)

    use_apify = bool(settings.apify_token)
    print(f"[fetch-domain-images BG] Website fetch starting (Apify={use_apify}), target max {max_images}")
    try:
        if use_apify:
            return fetch_images_from_website_apify(
                page_url=url,
                max_images=max_images,
                domain_hash=domain_hash,
                on_image_ready=on_image_ready,
            )
        return fetch_images_from_website(
            page_url=url, max_images=max_images, on_image_ready=on_image_ready
        )
    except Exception as e:
        print(f"[fetch-domain-images BG] Website fetch failed: {e}")
        logger.warning(f"⚠️ Website fetch failed: {e}")
        return []


def _fetch_instagram_images(
    domain: str,
    url: str,
    domain_hash: str,
    callback_url: str | None = None,
    domain_for_callback: str | None = None,
    max_images: int = MAX_INSTAGRAM_IMAGES,
) -> list[dict]:
    """Fetch Instagram images (Apify if token set, else instaloader). Target max_images (default 10).
    When callback_url and domain_for_callback are set, each image is POSTed to callback as downloaded.
    When callback not set, returns list only (for Grok filter then save).
    """
    on_image_ready = None
    if callback_url and domain_for_callback:
        on_image_ready = lambda img: _post_image_to_callback(callback_url, domain_for_callback, img)

    use_apify = bool(settings.apify_token)
    print(f"[fetch-domain-images BG] Instagram fetch starting (Apify={use_apify}), target max {max_images}")
    try:
        ig_handle = resolve_instagram_handle(domain, website_url=url)
        if not ig_handle:
            print(f"[fetch-domain-images BG] No Instagram handle for {domain}")
            return []
        print(f"[fetch-domain-images BG] Instagram handle: @{ig_handle}")
        if use_apify:
            return fetch_images_from_instagram_apify(
                handle=ig_handle,
                domain_hash=domain_hash,
                max_images=max_images,
                on_image_ready=on_image_ready,
            )
        return fetch_images_from_instagram(
            handle=ig_handle,
            domain_hash=domain_hash,
            max_images=max_images,
            on_image_ready=on_image_ready,
        )
    except Exception as e:
        print(f"[fetch-domain-images BG] Instagram fetch failed: {e}")
        logger.warning(f"⚠️ Instagram fetch failed: {e}")
        return []


def _run_fetch_in_background(
    url: str,
    domain: str,
    domain_hash: str,
    callback_url: str,
    brand_context: dict[str, Any] | None = None,
) -> None:
    """Run fetch in thread. (1) Fetch up to 20 website images, save each via callback (no Grok).
    (2) If website returned < SUFFICIENT_WEBSITE_COUNT, fetch up to 10 Instagram images, run Grok
    (product + brand-relevant), save only those that pass via callback.
    """
    print(f"[fetch-domain-images BG] Starting background fetch for domain={domain} (website 20 then Instagram if needed, Grok on IG only)")

    # 1. Fetch website only, max 20, save each via callback (no Grok)
    website_images = _fetch_website_images(url, domain_hash, callback_url, domain, max_images=MAX_WEBSITE_IMAGES)
    print(f"[fetch-domain-images BG] Website returned {len(website_images)} images (saved via callback)")
    logger.info(f"   Website: {len(website_images)} images")

    total_saved = len(website_images)

    # 2. If not enough from website, fetch Instagram: download in batches of 8, Grok each batch, save only passes until we have 10 product images
    if FETCH_INSTAGRAM_IMAGES and len(website_images) < SUFFICIENT_WEBSITE_COUNT:
        ig_handle = resolve_instagram_handle(domain, website_url=url)
        if ig_handle:
            use_apify = bool(settings.apify_token)
            if use_apify:
                urls = get_instagram_image_urls(ig_handle)
                if not urls:
                    print(f"[fetch-domain-images BG] Instagram @{ig_handle}: no image URLs returned, skipping")
                else:
                    print(f"[fetch-domain-images BG] Instagram @{ig_handle}: {len(urls)} image URLs, download in batches of {GROK_BATCH_SIZE}, Grok filter each batch until {MAX_INSTAGRAM_IMAGES} product images")
                    product_saved = 0
                    start_idx = 0
                    while product_saved < MAX_INSTAGRAM_IMAGES and urls:
                        batch_urls = urls[:GROK_BATCH_SIZE]
                        urls = urls[GROK_BATCH_SIZE:]
                        if not batch_urls:
                            break
                        downloaded = download_instagram_batch(batch_urls, domain_hash, start_idx)
                        start_idx += len(downloaded)
                        if not downloaded:
                            continue
                        print(f"[fetch-domain-images BG] Instagram batch: downloaded {len(downloaded)}, running Grok (brand_context={bool(brand_context)})")
                        passed = _filter_product_images_with_grok(downloaded, brand_context=brand_context)
                        for img in passed:
                            _post_image_to_callback(callback_url, domain, img)
                            total_saved += 1
                            product_saved += 1
                            if product_saved >= MAX_INSTAGRAM_IMAGES:
                                break
                        print(f"[fetch-domain-images BG] Grok kept {len(passed)}/{len(downloaded)} from batch → {product_saved} Instagram product images so far")
                        if product_saved >= MAX_INSTAGRAM_IMAGES:
                            break
                    print(f"[fetch-domain-images BG] Instagram done: {product_saved} product images saved via callback")
            else:
                # No Apify: download up to 10 then Grok filter (legacy)
                ig_images = _fetch_instagram_images(
                    domain, url, domain_hash,
                    callback_url=None,
                    domain_for_callback=None,
                    max_images=MAX_INSTAGRAM_IMAGES,
                )
                if ig_images:
                    product_ig = _filter_product_images_with_grok(ig_images, brand_context=brand_context)
                    for img in product_ig:
                        _post_image_to_callback(callback_url, domain, img)
                    total_saved += len(product_ig)
                    print(f"[fetch-domain-images BG] Grok kept {len(product_ig)}/{len(ig_images)} Instagram images (non-Apify path)")
        else:
            print(f"[fetch-domain-images BG] No Instagram handle for {domain}, skipping")
    else:
        if len(website_images) >= SUFFICIENT_WEBSITE_COUNT:
            print(f"[fetch-domain-images BG] Sufficient website images ({len(website_images)}), skipping Instagram")

    print(f"[fetch-domain-images BG] Done. {total_saved} images saved to DB for {domain}")
    logger.info(f"✅ Fetched {total_saved} images saved for {domain} (website + optional IG with Grok)")


class FetchDomainImagesRequest(BaseModel):
    url: str
    callback_url: str | None = None  # If set, return 202 and POST each image as it's ready
    # Optional brand context for Grok when filtering Instagram images (industry, business_overview, popular_products)
    brand_context: dict[str, Any] | None = None


class FetchDomainImagesResponse(BaseModel):
    success: bool
    domain: str
    images: list[dict]  # [{s3_key, presigned_url, sourceLabel?}]
    error: str | None = None
    accepted: bool = False  # True when 202 - fetch running in background


@router.post("/api/dvyb/fetch-domain-images", response_model=FetchDomainImagesResponse)
async def fetch_domain_images(request: FetchDomainImagesRequest):
    """
    Fetch product images: (1) Website up to 20 images, save all. (2) If website < 10, fetch
    Instagram up to 10, run Grok (product + brand-relevant), save only those. Optional brand_context
    for Grok (industry, business_overview, popular_products). If callback_url: return 202, run in background.
    """
    print(f"[fetch-domain-images] Received request: url={request.url!r}, callback_url={request.callback_url!r}, brand_context={bool(request.brand_context)}")

    url = (request.url or "").strip()
    if not url:
        print("[fetch-domain-images] ERROR: url is required")
        raise HTTPException(status_code=400, detail="url is required")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    domain = normalize_domain(url)
    if not domain:
        print(f"[fetch-domain-images] ERROR: Invalid URL, domain empty")
        return FetchDomainImagesResponse(success=False, domain="", images=[], error="Invalid URL")

    callback_url = (request.callback_url or "").strip() or None
    brand_context = request.brand_context if isinstance(request.brand_context, dict) else None
    domain_hash = _domain_hash(url)
    print(f"[fetch-domain-images] domain={domain}, domain_hash={domain_hash}, mode={'async (callback)' if callback_url else 'sync'}")

    if callback_url:
        # Incremental mode: return 202, run in background
        print(f"[fetch-domain-images] Submitting background fetch for {domain}")
        _executor.submit(_run_fetch_in_background, url, domain, domain_hash, callback_url, brand_context)
        return FetchDomainImagesResponse(
            success=True,
            domain=domain,
            images=[],
            accepted=True,
        )

    # Sync mode: website 20 (no Grok), then if < 10 fetch Instagram 10 and Grok-filter
    website_images = _fetch_website_images(url, domain_hash, callback_url=None, domain=None, max_images=MAX_WEBSITE_IMAGES)
    print(f"[fetch-domain-images] Website returned {len(website_images)} images")
    all_images: list[dict] = list(website_images)
    if FETCH_INSTAGRAM_IMAGES and len(website_images) < SUFFICIENT_WEBSITE_COUNT:
        ig_images = _fetch_instagram_images(
            domain, url, domain_hash,
            callback_url=None,
            domain_for_callback=None,
            max_images=MAX_INSTAGRAM_IMAGES,
        )
        if ig_images:
            product_ig = _filter_product_images_with_grok(ig_images, brand_context=brand_context)
            all_images.extend(product_ig)
            print(f"[fetch-domain-images] Instagram Grok kept {len(product_ig)}/{len(ig_images)} images")
    print(f"[fetch-domain-images] Done. Returning {len(all_images)} images for {domain}")
    return FetchDomainImagesResponse(success=True, domain=domain, images=all_images)
