"""
Fetch product/brand images from an Instagram profile (handle).
Downloads via instaloader, uploads to S3, returns s3_key + presigned_url.
Used for onboarding: mix with website images for product selection.
"""
from __future__ import annotations

import logging
import mimetypes
import tempfile
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import requests

from app.utils.image_validation import validate_image_for_grok
from app.utils.web2_s3_helper import web2_s3_helper

logger = logging.getLogger(__name__)

try:
    import instaloader
except ImportError:
    instaloader = None


def download_image_to_path(url: str, path: Path, referer: str | None = None) -> bool:
    """Download image from URL to path. Optional referer (e.g. Instagram)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    try:
        r = requests.get(url, headers=headers, timeout=30, stream=True)
        r.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception:
        return False


def fetch_images_from_instagram(
    handle: str,
    domain_hash: str,
    max_images: int = 5,
    on_image_ready: Callable[[dict], None] | None = None,
) -> list[dict]:
    """
    Fetch images from Instagram profile, upload to S3.
    Returns list of {s3_key, presigned_url, sourceLabel} for use in onboarding.
    If on_image_ready is provided, call it for each image immediately after upload (for incremental saves).
    """
    if not instaloader:
        logger.warning("instaloader not installed, skipping Instagram fetch")
        return []

    handle = (handle or "").strip().lstrip("@")
    if not handle:
        return []

    results: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="dvyb_ig_fetch_") as tmpdir:
        out_dir = Path(tmpdir)
        L = instaloader.Instaloader(
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
        )

        try:
            profile = instaloader.Profile.from_username(L.context, handle)
        except Exception as e:
            logger.warning(f"⚠️ Instagram profile @{handle} not loadable: {e}")
            return []

        downloaded = 0
        for post in profile.get_posts():
            if downloaded >= max_images:
                break
            if post.typename == "GraphVideo":
                continue
            try:
                if post.typename == "GraphSidecar":
                    for idx, node in enumerate(post.get_sidecar_nodes()):
                        if downloaded >= max_images:
                            break
                        path = out_dir / f"{post.shortcode}_{idx}.jpg"
                        if download_image_to_path(
                            node.display_url, path, referer="https://www.instagram.com/"
                        ):
                            s3_key, presigned = _upload_to_s3(path, domain_hash, f"ig_{downloaded}")
                            if s3_key:
                                img_data = {
                                    "s3_key": s3_key,
                                    "presigned_url": presigned or "",
                                    "sourceLabel": "instagram",
                                }
                                results.append(img_data)
                                if on_image_ready:
                                    on_image_ready(img_data)
                                downloaded += 1
                else:
                    path = out_dir / f"{post.shortcode}.jpg"
                    if download_image_to_path(
                        post.url, path, referer="https://www.instagram.com/"
                    ):
                        s3_key, presigned = _upload_to_s3(path, domain_hash, f"ig_{downloaded}")
                        if s3_key:
                            img_data = {
                                "s3_key": s3_key,
                                "presigned_url": presigned or "",
                                "sourceLabel": "instagram",
                            }
                            results.append(img_data)
                            if on_image_ready:
                                on_image_ready(img_data)
                            downloaded += 1
            except Exception as e:
                logger.debug(f"Skipped post {getattr(post, 'shortcode', '?')}: {e}")

    return results


def _upload_to_s3(local_path: Path, domain_hash: str, base_name: str) -> tuple[str | None, str | None]:
    """Upload local file to S3, return (s3_key, presigned_url). Skips if not valid JPG/PNG/WebP."""
    validated = validate_image_for_grok(local_path)
    if not validated:
        return None, None
    ext, content_type = validated
    s3_key = f"dvyb/domain-products/{domain_hash}/{base_name}{ext}"
    upload_result = web2_s3_helper.upload_file_to_s3(str(local_path), s3_key, content_type)
    if upload_result.get("success"):
        presigned = web2_s3_helper.generate_presigned_url(s3_key)
        return s3_key, presigned
    return None, None
