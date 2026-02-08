"""
Fetch product images from a website URL using Apify Puppeteer Scraper.
Uses Apify proxy to avoid blocking. Extracts images from page, downloads and uploads to S3.
Replaces custom requests+BeautifulSoup flow that often gets blocked.
"""
from __future__ import annotations

import hashlib
import logging
import mimetypes
import tempfile
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import requests

from app.config.settings import settings
from app.utils.image_validation import validate_image_for_grok
from app.utils.web2_s3_helper import web2_s3_helper

logger = logging.getLogger(__name__)

# Page function for Puppeteer Scraper: extract image URLs from product/website page
PUPPETEER_WEBSITE_IMAGE_PAGE_FUNCTION = r"""
async function pageFunction(context) {
    const { page, request } = context;
    const images = [];
    const skipHints = ['logo', 'favicon', 'icon', 'sprite', 'badge', 'pixel', 'tracking', '1x1'];
    function shouldSkip(url) {
        if (!url || url.startsWith('data:')) return true;
        const low = url.toLowerCase();
        if (low.endsWith('.svg') || low.endsWith('.ico')) return true;
        return skipHints.some(h => low.includes(h));
    }
    try {
        const ogImage = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
        if (ogImage && !shouldSkip(ogImage)) images.push(ogImage);
        const ogSecure = await page.$eval('meta[property="og:image:secure_url"]', el => el.content).catch(() => null);
        if (ogSecure && !shouldSkip(ogSecure) && !images.includes(ogSecure)) images.push(ogSecure);
        const twImage = await page.$eval('meta[name="twitter:image"]', el => el.content).catch(() => null);
        if (twImage && !shouldSkip(twImage) && !images.includes(twImage)) images.push(twImage);
        const imgs = await page.$$eval('img[src]', els => els.map(e => e.src).filter(Boolean));
        for (const src of imgs) {
            if (!shouldSkip(src) && !images.includes(src)) images.push(src);
        }
        const srcsetAll = await page.$$eval('img[srcset], source[srcset]', els =>
            els.flatMap(e => (e.srcset || '').split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean))
        );
        for (const u of srcsetAll) {
            if (u && !shouldSkip(u) && !images.includes(u)) images.push(u);
        }
    } catch (e) {}
    return { url: request.url, images: [...new Set(images)].slice(0, 50) };
}
"""

WEBSITE_MIN_IMAGE_BYTES = 15_000
WEBSITE_MIN_WHEN_FEW_CANDIDATES = 0


def fetch_images_from_website_apify(
    page_url: str,
    max_images: int = 10,
    domain_hash: str | None = None,
    on_image_ready: Callable[[dict], None] | None = None,
) -> list[dict]:
    """
    Fetch website images via Apify Puppeteer Scraper (proxy, less blocking).
    Returns list of {s3_key, presigned_url, sourceLabel}.
    """
    apify_token = settings.apify_token or ""
    if not apify_token:
        logger.warning("APIFY_TOKEN not set, cannot use Apify website fetcher")
        return []

    if not page_url or not page_url.startswith(("http://", "https://")):
        return []

    try:
        from apify_client import ApifyClient
    except ImportError:
        logger.warning("apify-client not installed")
        return []

    run_input = {
        "startUrls": [{"url": page_url}],
        "pageFunction": PUPPETEER_WEBSITE_IMAGE_PAGE_FUNCTION,
        "proxyConfiguration": {"useApifyProxy": True},
        "maxCrawlingDepth": 0,
        "maxPagesPerCrawl": 1,
    }

    try:
        print(f"[fetch-domain-images] Apify website: starting Puppeteer scrape for {page_url[:60]}...")
        client = ApifyClient(apify_token)
        run = client.actor("apify/puppeteer-scraper").call(run_input=run_input)
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        print(f"[fetch-domain-images] Apify website: scrape done, {len(items)} page(s)")
    except Exception as e:
        print(f"[fetch-domain-images] Apify website: scrape failed: {e}")
        logger.warning(f"Apify website image fetch failed: {e}")
        return []

    image_urls: list[str] = []
    for item in items:
        urls = item.get("images") or []
        for u in urls:
            if isinstance(u, str) and u.strip() and u not in image_urls:
                image_urls.append(u.strip())

    if not image_urls:
        print(f"[fetch-domain-images] Apify website: no image URLs extracted from page")
        return []

    print(f"[fetch-domain-images] Apify website: {len(image_urls)} URLs to try, target max {max_images}")
    dh = domain_hash or hashlib.md5(page_url.encode()).hexdigest()[:12]
    effective_min = (
        WEBSITE_MIN_IMAGE_BYTES
        if len(image_urls) > max_images
        else WEBSITE_MIN_WHEN_FEW_CANDIDATES
    )

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "image/avif,image/webp,image/apng,*/*;q=0.8",
        "Referer": page_url,
    }

    results: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="dvyb_web_apify_") as tmpdir:
        out_dir = Path(tmpdir)
        for i, img_url in enumerate(image_urls):
            if len(results) >= max_images:
                break
            try:
                r = requests.get(img_url, headers=headers, timeout=15, stream=True)
                r.raise_for_status()
                ct = r.headers.get("content-type", "").lower()
                if "image" not in ct and "octet-stream" not in ct:
                    if len(image_urls) > max_images:
                        continue
                cl = r.headers.get("content-length")
                if cl:
                    try:
                        if int(cl) < effective_min:
                            continue
                    except ValueError:
                        pass
                ext = mimetypes.guess_extension(ct.split(";")[0].strip()) if ct else None
                if not ext or ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                    path_part = urlparse(img_url).path
                    if path_part.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
                        ext = path_part[path_part.rfind(".") :].lower()
                    else:
                        ext = ".jpg"
                local_path = out_dir / f"web_{i}{ext}"
                with open(local_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                size = local_path.stat().st_size
                if size < effective_min:
                    continue
                # Validate actual binary content (Grok rejects HTML/placeholders)
                validated = validate_image_for_grok(local_path)
                if not validated:
                    print(f"[fetch-domain-images] Apify website: skip URL {i+1} (invalid binary, not JPG/PNG/WebP): {img_url[:70]}...")
                    continue
                ext, content_type = validated
                if local_path.suffix.lower() != ext.lower():
                    local_path_final = out_dir / f"web_{i}{ext}"
                    local_path.rename(local_path_final)
                else:
                    local_path_final = local_path
                s3_key = f"dvyb/domain-products/{dh}/web_{i}{ext}"
                upload_result = web2_s3_helper.upload_file_to_s3(
                    str(local_path_final), s3_key, content_type
                )
                if upload_result.get("success"):
                    presigned = web2_s3_helper.generate_presigned_url(s3_key)
                    img_data = {
                        "s3_key": s3_key,
                        "presigned_url": presigned or "",
                        "sourceLabel": "website",
                    }
                    results.append(img_data)
                    if on_image_ready:
                        on_image_ready(img_data)
                    print(f"[fetch-domain-images] Apify website: saved {len(results)}/{max_images} - {s3_key}")
            except Exception as ex:
                print(f"[fetch-domain-images] Apify website: URL {i+1} failed: {ex}")
                continue

    print(f"[fetch-domain-images] Apify website: done, {len(results)} images saved (target {max_images})")
    return results
