"""
Fetch product images from Instagram profile using Apify Instagram Profile Scraper.
Uses Apify to avoid instaloader blocking and rate limits.
"""
from __future__ import annotations

import logging
import mimetypes
import tempfile
from pathlib import Path
from typing import Callable

import requests

from app.config.settings import settings
from app.utils.image_validation import validate_image_for_grok
from app.utils.web2_s3_helper import web2_s3_helper

logger = logging.getLogger(__name__)


def _download_and_upload(
    url: str,
    domain_hash: str,
    idx: int,
    referer: str = "https://www.instagram.com/",
) -> dict | None:
    """Download image from URL and upload to S3. Returns {s3_key, presigned_url, sourceLabel} or None."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "image/avif,image/webp,image/apng,*/*;q=0.8",
        "Referer": referer,
    }
    try:
        r = requests.get(url, headers=headers, timeout=30, stream=True)
        r.raise_for_status()
        ct = r.headers.get("content-type", "").lower()
        ext = mimetypes.guess_extension(ct.split(";")[0].strip()) if ct else None
        if not ext or ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".jpg"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            for chunk in r.iter_content(chunk_size=8192):
                tmp.write(chunk)
            tmp_path = tmp.name
        try:
            validated = validate_image_for_grok(tmp_path)
            if not validated:
                return None
            ext, content_type = validated
            s3_key = f"dvyb/domain-products/{domain_hash}/ig_{idx}{ext}"
            upload_result = web2_s3_helper.upload_file_to_s3(
                tmp_path, s3_key, content_type
            )
            if upload_result.get("success"):
                presigned = web2_s3_helper.generate_presigned_url(s3_key)
                return {
                    "s3_key": s3_key,
                    "presigned_url": presigned or "",
                    "sourceLabel": "instagram",
                }
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    except Exception as e:
        logger.debug(f"Failed to download/upload Instagram image: {e}")
    return None


def get_instagram_image_urls(handle: str) -> list[str]:
    """
    Run Apify Instagram profile scraper and return list of image URLs (no download).
    Used so caller can download in batches, run Grok, and stop when enough product images are found.
    """
    apify_token = settings.apify_token or ""
    if not apify_token:
        return []

    handle = (handle or "").strip().lstrip("@")
    if not handle:
        return []

    try:
        from apify_client import ApifyClient
    except ImportError:
        return []

    try:
        client = ApifyClient(apify_token)
        run = client.actor("apify/instagram-profile-scraper").call(run_input={"usernames": [handle]})
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as e:
        logger.warning(f"Apify Instagram scrape failed for @{handle}: {e}")
        return []

    urls: list[str] = []
    for item in items:
        if isinstance(item, dict):
            urls.extend(_extract_image_urls_from_profile(item))
        elif isinstance(item, list):
            for sub in item:
                if isinstance(sub, dict):
                    urls.extend(_extract_image_urls_from_profile(sub))
    return urls


def download_instagram_batch(
    urls: list[str],
    domain_hash: str,
    start_idx: int,
    referer: str = "https://www.instagram.com/",
) -> list[dict]:
    """
    Download up to len(urls) images and upload to S3. Returns list of {s3_key, presigned_url, sourceLabel}.
    Uses start_idx, start_idx+1, ... for S3 keys (ig_{start_idx}.jpg etc).
    """
    results: list[dict] = []
    for i, url in enumerate(urls):
        img = _download_and_upload(url, domain_hash, start_idx + i, referer)
        if img:
            results.append(img)
    return results


def _extract_image_urls_from_profile(profile: dict) -> list[str]:
    """Extract image URLs from Apify Instagram profile output."""
    urls: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        if u and isinstance(u, str) and u.strip() and u not in seen:
            seen.add(u.strip())
            urls.append(u.strip())

    # Profile picture
    pp = profile.get("profilePicUrl") or profile.get("profilePic") or profile.get("profile_pic_url")
    if pp:
        add(pp)

    # Latest posts - common field names across actors
    posts = (
        profile.get("latestPosts")
        or profile.get("posts")
        or profile.get("latest_posts")
        or []
    )
    if not isinstance(posts, list):
        posts = []

    for post in posts:
        if not isinstance(post, dict):
            continue
        # Various field names used by different Instagram scrapers
        for key in ("displayUrl", "imageUrl", "url", "image_url", "display_url"):
            u = post.get(key)
            if u:
                add(u)
                break
        # Sidecar / multiple images
        nodes = post.get("images") or post.get("imageUrls") or post.get("sidecarImages") or []
        for node in nodes if isinstance(nodes, list) else []:
            if isinstance(node, dict):
                u = node.get("url") or node.get("displayUrl") or node.get("imageUrl")
                if u:
                    add(u)
            elif isinstance(node, str):
                add(node)

    return urls


def fetch_images_from_instagram_apify(
    handle: str,
    domain_hash: str,
    max_images: int = 5,
    on_image_ready: Callable[[dict], None] | None = None,
) -> list[dict]:
    """
    Fetch images from Instagram profile via Apify (apify/instagram-profile-scraper).
    Returns list of {s3_key, presigned_url, sourceLabel}.
    """
    apify_token = settings.apify_token or ""
    if not apify_token:
        logger.warning("APIFY_TOKEN not set, cannot use Apify Instagram fetcher")
        return []

    handle = (handle or "").strip().lstrip("@")
    if not handle:
        return []

    try:
        from apify_client import ApifyClient
    except ImportError:
        logger.warning("apify-client not installed")
        return []

    run_input = {
        "usernames": [handle],
    }

    try:
        print(f"[fetch-domain-images] Apify Instagram: scraping @{handle} (target max {max_images})")
        client = ApifyClient(apify_token)
        run = client.actor("apify/instagram-profile-scraper").call(run_input=run_input)
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        print(f"[fetch-domain-images] Apify Instagram: got {len(items)} profile item(s)")
    except Exception as e:
        print(f"[fetch-domain-images] Apify Instagram: scrape failed for @{handle}: {e}")
        logger.warning(f"Apify Instagram fetch failed for @{handle}: {e}")
        return []

    image_urls: list[str] = []
    for item in items:
        # Actor may return list of profiles or single profile object
        if isinstance(item, dict):
            image_urls.extend(_extract_image_urls_from_profile(item))
        elif isinstance(item, list):
            for sub in item:
                if isinstance(sub, dict):
                    image_urls.extend(_extract_image_urls_from_profile(sub))

    print(f"[fetch-domain-images] Apify Instagram: {len(image_urls)} image URLs to try")
    results: list[dict] = []
    for i, url in enumerate(image_urls):
        if len(results) >= max_images:
            break
        img_data = _download_and_upload(url, domain_hash, len(results))
        if img_data:
            results.append(img_data)
            if on_image_ready:
                on_image_ready(img_data)
            print(f"[fetch-domain-images] Apify Instagram: saved {len(results)}/{max_images} - {img_data.get('s3_key', '?')}")

    print(f"[fetch-domain-images] Apify Instagram: done, {len(results)} images saved (target {max_images})")
    return results
