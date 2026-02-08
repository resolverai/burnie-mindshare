"""
DVYB Domain Product Images
Fetch product/brand images from website URL and Instagram (if resolvable) for onboarding product selection.
Images are saved incrementally via callback so users see them as they arrive (no wait for full batch).
All downloaded images go through Grok AI filter - only product images (product as hero) are saved.

Website and Instagram fetches run in parallel and are independent: neither blocks the other on error.
Uses Apify when APIFY_TOKEN is set (avoids blocking); falls back to custom/instaloader otherwise.
"""
import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config.settings import settings
from app.services.domain_instagram_resolver import resolve_instagram_handle
from app.services.instagram_image_fetcher import fetch_images_from_instagram
from app.services.instagram_image_fetcher_apify import fetch_images_from_instagram_apify
from app.services.website_image_fetcher import fetch_images_from_website
from app.services.website_image_fetcher_apify import fetch_images_from_website_apify

logger = logging.getLogger(__name__)

router = APIRouter()
_executor = ThreadPoolExecutor(max_workers=4)

# Max 10 images total; website preferred, Instagram only to fill if website has fewer
MAX_PRODUCT_IMAGES = 10
GROK_BATCH_SIZE = 8


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


def _filter_product_images_with_grok(all_images: list[dict]) -> list[dict]:
    """
    Filter images with Grok AI - keep only product images (product as hero).
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

    print(f"[fetch-domain-images] Grok filter: analyzing {len(all_images)} images in batches of {GROK_BATCH_SIZE}")

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

            system_prompt = """You are an expert visual analyst for e-commerce product catalogs. Your single task: classify images.

PRODUCT IMAGE = The product is the HERO of the image. Examples:
- Product alone on white/neutral background
- Product worn by model/influencer (product clearly visible)
- Product held by person (product is main focus)
- Close-up of product

NOT product image = General social media, event, or lifestyle imagery:
- Social event, party, group photo
- Selfie without product focus
- Landscape, scenery, food scene
- Meme, screenshot, infographic
- Generic lifestyle without product

Output ONLY valid JSON. Return ONLY the s3_keys of images that ARE product images (product as hero)."""

            image_list_str = "\n".join([f"- Image {i + 1}: s3_key={s3_keys[i]}" for i in range(len(s3_keys))])
            user_prompt = f"""Analyze these {len(s3_keys)} images. For each image, determine: Is this a PRODUCT IMAGE (product as hero) or a general social/media/event image?

Images in this batch:
{image_list_str}

Return a JSON object with this EXACT structure:
{{
  "product_image_s3_keys": ["s3_key_1", "s3_key_2"]
}}

Include ONLY the s3_keys of images where the product is the hero. Use the exact s3_key strings from the list above. If none qualify, return empty array: "product_image_s3_keys": []"""

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
    url: str, domain_hash: str, callback_url: str | None = None, domain: str | None = None
) -> list[dict]:
    """Fetch website images (Apify if token set, else custom). Target max 10 images. Independent of Instagram.
    When callback_url and domain are set, each image is POSTed to callback as soon as it's downloaded (incremental display).
    """
    on_image_ready = None
    if callback_url and domain:
        on_image_ready = lambda img: _post_image_to_callback(callback_url, domain, img)

    use_apify = bool(settings.apify_token)
    print(f"[fetch-domain-images BG] Website fetch starting (Apify={use_apify}), target max {MAX_PRODUCT_IMAGES}")
    try:
        if use_apify:
            return fetch_images_from_website_apify(
                page_url=url,
                max_images=MAX_PRODUCT_IMAGES,
                domain_hash=domain_hash,
                on_image_ready=on_image_ready,
            )
        return fetch_images_from_website(
            page_url=url, max_images=MAX_PRODUCT_IMAGES, on_image_ready=on_image_ready
        )
    except Exception as e:
        print(f"[fetch-domain-images BG] Website fetch failed: {e}")
        logger.warning(f"⚠️ Website fetch failed: {e}")
        return []


def _fetch_instagram_images(
    domain: str, url: str, domain_hash: str, callback_url: str | None = None
) -> list[dict]:
    """Fetch Instagram images (Apify if token set, else instaloader). Independent of website.
    When callback_url is set, each image is POSTed to callback as soon as it's downloaded (incremental display).
    """
    on_image_ready = None
    if callback_url and domain:
        on_image_ready = lambda img: _post_image_to_callback(callback_url, domain, img)

    use_apify = bool(settings.apify_token)
    print(f"[fetch-domain-images BG] Instagram fetch starting (Apify={use_apify})")
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
                max_images=MAX_PRODUCT_IMAGES,
                on_image_ready=on_image_ready,
            )
        return fetch_images_from_instagram(
            handle=ig_handle,
            domain_hash=domain_hash,
            max_images=MAX_PRODUCT_IMAGES,
            on_image_ready=on_image_ready,
        )
    except Exception as e:
        print(f"[fetch-domain-images BG] Instagram fetch failed: {e}")
        logger.warning(f"⚠️ Instagram fetch failed: {e}")
        return []


def _run_fetch_in_background(url: str, domain: str, domain_hash: str, callback_url: str) -> None:
    """Run fetch in thread; website and Instagram in PARALLEL (independent - neither blocks the other).
    When callback_url is set: each image is saved to DB immediately via on_image_ready (incremental display).
    No batch Grok filter in incremental mode - images shown as they arrive for faster feedback.
    """
    print(f"[fetch-domain-images BG] Starting background fetch for domain={domain} (incremental via callback)")

    # 1. Fetch website and Instagram IN PARALLEL - each image is POSTed to callback as soon as it's downloaded
    website_images: list[dict] = []
    ig_images: list[dict] = []

    future_to_src = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_web = pool.submit(_fetch_website_images, url, domain_hash, callback_url, domain)
        f_ig = pool.submit(_fetch_instagram_images, domain, url, domain_hash, callback_url)
        future_to_src[f_web] = "web"
        future_to_src[f_ig] = "ig"
        for future in as_completed([f_web, f_ig]):
            try:
                result = future.result() or []
                src = future_to_src.get(future, "")
                if src == "web":
                    website_images = result
                    print(f"[fetch-domain-images BG] Website returned {len(website_images)} images (already saved via callback)")
                    logger.info(f"   Website: {len(website_images)} images")
                else:
                    ig_images = result
                    print(f"[fetch-domain-images BG] Instagram returned {len(ig_images)} images (already saved via callback)")
                    logger.info(f"   Instagram: {len(ig_images)} images")
            except Exception as e:
                print(f"[fetch-domain-images BG] One fetch failed: {e}")
                logger.warning(f"⚠️ Fetch error (non-blocking): {e}")

    total_saved = len(website_images) + len(ig_images)
    print(f"[fetch-domain-images BG] Done. {total_saved} images saved to DB for {domain}")
    logger.info(f"✅ Fetched {total_saved} images saved for {domain} (incremental)")


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
    print(f"[fetch-domain-images] Received request: url={request.url!r}, callback_url={request.callback_url!r}")

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
    domain_hash = _domain_hash(url)
    print(f"[fetch-domain-images] domain={domain}, domain_hash={domain_hash}, mode={'async (callback)' if callback_url else 'sync'}")

    if callback_url:
        # Incremental mode: return 202, run in background, POST each image to callback
        print(f"[fetch-domain-images] Submitting background fetch for {domain}")
        _executor.submit(_run_fetch_in_background, url, domain, domain_hash, callback_url)
        return FetchDomainImagesResponse(
            success=True,
            domain=domain,
            images=[],
            accepted=True,
        )

    # Legacy sync mode: website and Instagram in PARALLEL (independent errors)
    all_images: list[dict] = []
    website_images: list[dict] = []
    ig_images: list[dict] = []

    future_to_src = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_web = pool.submit(_fetch_website_images, url, domain_hash)
        f_ig = pool.submit(_fetch_instagram_images, domain, url, domain_hash)
        future_to_src[f_web] = "web"
        future_to_src[f_ig] = "ig"
        for future in as_completed([f_web, f_ig]):
            try:
                result = future.result() or []
                src = future_to_src.get(future, "")
                if src == "web":
                    website_images = result
                    print(f"[fetch-domain-images] Website returned {len(website_images)} images")
                else:
                    ig_images = result
                    print(f"[fetch-domain-images] Instagram returned {len(ig_images)} images")
            except Exception as e:
                print(f"[fetch-domain-images] One fetch failed: {e}")
                logger.warning(f"⚠️ Fetch error (non-blocking): {e}")

    all_images.extend(website_images)
    needed = MAX_PRODUCT_IMAGES - len(website_images)
    if needed > 0 and ig_images:
        all_images.extend(ig_images[:needed])

    # Grok filter - keep only product images
    product_images = _filter_product_images_with_grok(all_images) if all_images else []
    print(f"[fetch-domain-images] Done. Returning {len(product_images)} product images (from {len(all_images)} downloaded) for {domain}")
    return FetchDomainImagesResponse(success=True, domain=domain, images=product_images)
