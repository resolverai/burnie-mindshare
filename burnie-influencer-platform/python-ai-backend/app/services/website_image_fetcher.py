"""
Fetch product/brand images from a website URL.
Ported from ai/instagram_profile_images.py (website URL mode).
Used for onboarding: extract images from user's domain for product selection.
"""
from __future__ import annotations

import hashlib
import mimetypes
import re
import tempfile
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from app.utils.web2_s3_helper import web2_s3_helper

# Min size when we have many candidates (skip small logos); when few candidates accept any non-empty file
WEBSITE_MIN_IMAGE_BYTES = 15_000
WEBSITE_MIN_WHEN_FEW_CANDIDATES = 0

# URL path substrings that indicate logo/icon (skip these)
LOGO_URL_HINTS = (
    "logo", "favicon", "/icon/", "/icons/", "sprite", "badge", ".ico", "brand-logo", "site-logo",
    "meta-logo", "meta_logo", "fb_logo", "rsrc.php",
)

# URL path/query substrings that indicate tracking pixel (skip these)
TRACKING_PIXEL_HINTS = (
    "pixel", "1x1", "clear.gif", "spacer", "tracking", "empty.gif", "transparent.gif",
    "blank.gif", "beacon", "tracker",
)

BROWSER_HEADERS = [
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    },
]

SRCSET_DESCRIPTOR_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(w|x)$", re.I)


def _srcset_descriptor_to_size(desc: str) -> int:
    m = SRCSET_DESCRIPTOR_RE.match(desc.strip())
    if not m:
        return 0
    num = float(m.group(1))
    unit = (m.group(2) or "w").lower()
    if unit == "w":
        return int(num)
    return int(num * 100)


def _best_url_from_srcset(srcset: str, base_url: str) -> str | None:
    if not srcset or not srcset.strip():
        return None
    best_url: str | None = None
    best_size = 0
    for part in srcset.split(","):
        part = part.strip()
        if not part:
            continue
        tokens = part.split()
        if not tokens:
            continue
        descriptors: list[str] = []
        i = len(tokens) - 1
        while i >= 0 and SRCSET_DESCRIPTOR_RE.match(tokens[i]):
            descriptors.append(tokens[i])
            i -= 1
        url_str = " ".join(tokens[: i + 1]).strip()
        if not url_str:
            continue
        full_url = urljoin(base_url, url_str)
        size = max((_srcset_descriptor_to_size(d) for d in descriptors), default=100)
        if size > best_size:
            best_size = size
            best_url = full_url
    return best_url


def fetch_images_from_website(
    page_url: str,
    max_images: int = 10,
    on_image_ready: Callable[[dict], None] | None = None,
) -> list[dict]:
    """
    Fetch page, extract image URLs, download and upload to S3.
    Returns list of {s3_key, presigned_url, sourceLabel} for use in onboarding.
    If on_image_ready is provided, call it for each image immediately after upload (for incremental saves).
    """
    response = None
    last_error = None
    headers = None
    for try_headers in BROWSER_HEADERS:
        try:
            response = requests.get(
                page_url, headers=try_headers, timeout=15, allow_redirects=True
            )
            response.raise_for_status()
            headers = try_headers
            break
        except requests.HTTPError as e:
            last_error = e
            if e.response.status_code == 403:
                continue
            raise
        except Exception as e:
            last_error = e
            continue
    if response is None or not response.ok or headers is None:
        if last_error:
            raise last_error
        raise requests.RequestException("Failed to fetch page")

    base_url = response.url
    soup = BeautifulSoup(response.content, "html.parser")

    seen_urls: set[str] = set()
    collected: list[tuple[str, str]] = []

    def looks_like_logo_url(full_url: str) -> bool:
        path = urlparse(full_url).path.lower()
        return any(hint in path for hint in LOGO_URL_HINTS)

    def looks_like_tracking_pixel(full_url: str) -> bool:
        parsed = urlparse(full_url)
        path_query = (parsed.path + " " + parsed.query).lower()
        return any(hint in path_query for hint in TRACKING_PIXEL_HINTS)

    def add(url: str, label: str) -> None:
        full = urljoin(base_url, url)
        if full in seen_urls or full.startswith("data:") or full.lower().endswith(".svg"):
            return
        if looks_like_logo_url(full):
            return
        if looks_like_tracking_pixel(full):
            return
        seen_urls.add(full)
        collected.append((full, label))

    # Priority 1: og:image
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        add(og["content"], "og:image")
    og_secure = soup.find("meta", property="og:image:secure_url")
    if og_secure and og_secure.get("content"):
        add(og_secure["content"], "og:image:secure_url")
    # Priority 2: twitter:image
    tw = soup.find("meta", attrs={"name": "twitter:image"})
    if tw and tw.get("content"):
        add(tw["content"], "twitter:image")
    # Priority 3: picture/source
    for picture in soup.find_all("picture"):
        for source in picture.find_all("source", srcset=True):
            u = _best_url_from_srcset(source["srcset"], base_url)
            if u:
                add(u, "picture/source")
                break
    # Priority 4: featured/hero
    for kw in ("featured", "hero", "main", "lead", "article"):
        img = soup.find("img", class_=lambda c: c and kw in " ".join(c).lower())
        if img:
            srcset = img.get("srcset") or img.get("data-srcset")
            u = _best_url_from_srcset(srcset, base_url) if srcset else None
            if not u:
                u = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
            if u and isinstance(u, str):
                add(u, f"featured({kw})")
                break
    # Priority 5: all img
    for img in soup.find_all("img"):
        try:
            w = img.get("width")
            h = img.get("height")
            if w is not None and h is not None:
                w_val = int(str(w).replace("px", "").strip()) if str(w).replace("px", "").strip().isdigit() else None
                h_val = int(str(h).replace("px", "").strip()) if str(h).replace("px", "").strip().isdigit() else None
                if w_val is not None and h_val is not None and w_val <= 20 and h_val <= 20:
                    continue
        except (ValueError, TypeError):
            pass
        srcset = img.get("srcset") or img.get("data-srcset")
        u = _best_url_from_srcset(srcset, base_url) if srcset else None
        if not u:
            u = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
        if not u or not isinstance(u, str):
            continue
        alt = (img.get("alt") or "").lower()
        cls = " ".join(img.get("class", [])).lower()
        if any(k in alt or k in cls for k in ("icon", "logo", "avatar", "sprite", "badge", "button", "brand", "pixel", "tracking")):
            continue
        add(u, "page image")

    # Priority 6: raw HTML
    raw = response.text
    for key in ("full_picture", "image_url", "picture", "creative_image", "ad_image", "image_src"):
        for m in re.finditer(rf'["\']?{re.escape(key)}["\']?\s*:\s*["\'](https?://[^"\']+)["\']', raw, re.I):
            add(m.group(1), f"raw_html({key})")
    for m in re.finditer(
        r"https?://(?:scontent[^.\s\"'<>]*\.)?fbcdn\.net/[^\s\"'<>]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s\"'<>]*)?",
        raw, re.I,
    ):
        add(m.group(0), "raw_html(fbcdn)")
    for m in re.finditer(r'["\']?(?:og:image|og:image:secure_url)["\']?\s*[=:]\s*["\'](https?://[^"\']+)["\']', raw, re.I):
        add(m.group(1), "raw_html(og:image)")
    for m in re.finditer(r'content\s*=\s*["\'](https?://[^"\']+\.(?:jpg|jpeg|png|webp|gif)[^"\']*)["\']', raw, re.I):
        add(m.group(1), "raw_html(content)")

    if not collected:
        return []

    effective_min_bytes = (
        WEBSITE_MIN_IMAGE_BYTES
        if len(collected) > max_images
        else WEBSITE_MIN_WHEN_FEW_CANDIDATES
    )

    req_headers = {**headers, "Referer": base_url}

    def size_for(url: str) -> int:
        try:
            r = requests.head(url, headers=req_headers, timeout=8, allow_redirects=True)
            if r.status_code != 200:
                return 0
            cl = r.headers.get("content-length")
            return int(cl) if cl else 0
        except Exception:
            return 0

    collected_with_size = [(url, label, size_for(url)) for url, label in collected]
    collected_with_size.sort(key=lambda x: -x[2])
    collected = [(url, label) for url, label, _ in collected_with_size]

    results: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="dvyb_domain_fetch_") as tmpdir:
        out_dir = Path(tmpdir)
        for i, (img_url, label) in enumerate(collected):
            if len(results) >= max_images:
                break
            try:
                r = requests.get(img_url, headers={**req_headers, "Referer": base_url}, timeout=15, stream=True)
                r.raise_for_status()
                ct = r.headers.get("content-type", "").lower()
                if "image" not in ct and "octet-stream" not in ct:
                    if len(collected) > max_images:
                        continue
                cl = r.headers.get("content-length")
                if cl:
                    try:
                        if int(cl) < effective_min_bytes:
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
                if size < effective_min_bytes:
                    continue
                # Upload to S3 - use dvyb/domain-products/domain_hash/idx.ext
                domain_hash = hashlib.md5(page_url.encode()).hexdigest()[:12]
                s3_key = f"dvyb/domain-products/{domain_hash}/web_{i}{ext}"
                content_type = ct if ct and "image" in ct else "image/jpeg"
                upload_result = web2_s3_helper.upload_file_to_s3(str(local_path), s3_key, content_type)
                if upload_result.get("success"):
                    presigned = web2_s3_helper.generate_presigned_url(s3_key)
                    img_data = {"s3_key": s3_key, "presigned_url": presigned or "", "sourceLabel": "website"}
                    results.append(img_data)
                    if on_image_ready:
                        on_image_ready(img_data)
            except Exception:
                continue

    return results
