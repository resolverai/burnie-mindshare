#!/usr/bin/env python3
"""
Download images from an Instagram profile (handle) or a brand website URL.

Sources:
- Instagram handle: uses instaloader (anonymous). Up to N images (default 5)
  from posts and carousels. Public profiles only.
- Website URL: fetches the page, extracts images (og:image, twitter:image,
  featured/hero, then page images by score). Downloads up to N images (default 5).
"""

import argparse
import mimetypes
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:
    print("Error: requests is required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None  # only needed for website mode

try:
    import instaloader
except ImportError:
    instaloader = None  # only needed for Instagram mode


def download_image_to_path(url: str, path: Path, referer: str | None = None) -> bool:
    """Download image from URL to path. Optional referer (e.g. Instagram or page URL)."""
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


# Min size when we have many candidates (skip small logos); when few candidates accept any non-empty file
WEBSITE_MIN_IMAGE_BYTES = 15_000
WEBSITE_MIN_WHEN_FEW_CANDIDATES = 0  # accept any size when we have <= max_images candidates (user can inspect)

# URL path substrings that indicate logo/icon (skip these)
LOGO_URL_HINTS = (
    "logo", "favicon", "/icon/", "/icons/", "sprite", "badge", ".ico", "brand-logo", "site-logo",
    "meta-logo", "meta_logo", "fb_logo", "rsrc.php",  # Meta/Facebook logos and static assets
)

# URL path/query substrings that indicate tracking pixel or empty/placeholder image (skip these)
TRACKING_PIXEL_HINTS = ("pixel", "1x1", "clear.gif", "spacer", "tracking", "empty.gif", "transparent.gif", "blank.gif", "clear.gif", "beacon", "tracker")

# Browser-like headers to reduce 403 from bot protection (use for page fetch)
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

# srcset descriptor: e.g. "200w", "2x", "1.5x"
SRCSET_DESCRIPTOR_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(w|x)$", re.I)


def _srcset_descriptor_to_size(desc: str) -> int:
    """Convert srcset descriptor to a numeric size (width-equivalent). '200w' -> 200, '2x' -> 200."""
    m = SRCSET_DESCRIPTOR_RE.match(desc.strip())
    if not m:
        return 0
    num = float(m.group(1))
    unit = (m.group(2) or "w").lower()
    if unit == "w":
        return int(num)
    return int(num * 100)  # 2x -> 200 so we prefer over 100w


def _best_url_from_srcset(srcset: str, base_url: str) -> str | None:
    """Parse srcset string and return the full URL for the largest variant (by width or density)."""
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
        # Last token(s) can be descriptors (e.g. "200w" or "200w", "2x")
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


def download_from_website(
    page_url: str,
    output_dir: Path,
    max_images: int,
) -> int:
    """Fetch page, extract image URLs, download up to max_images. Returns count downloaded."""
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
    if response is None or not response.ok or headers is None:
        if last_error:
            raise last_error
        raise requests.RequestException("Failed to fetch page")

    base_url = response.url
    soup = BeautifulSoup(response.content, "html.parser")

    seen_urls: set[str] = set()
    collected: list[tuple[str, str]] = []  # (url, label)

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

    # Priority 1: og:image (and og:image:secure_url)
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
    # Priority 3: <picture> with <source srcset> (often high-res)
    for picture in soup.find_all("picture"):
        for source in picture.find_all("source", srcset=True):
            u = _best_url_from_srcset(source["srcset"], base_url)
            if u:
                add(u, "picture/source")
                break
    # Priority 4: featured/hero/main image by class (prefer srcset for high-res)
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
    # Priority 5: all <img> (skip icons/logos/tracking pixels); prefer srcset for high-res
    for img in soup.find_all("img"):
        # Skip known 1x1 or tiny tracking/placeholder images
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

    # Priority 6: scan raw HTML for embedded image URLs (Facebook ad archive, JSON-LD, etc.)
    raw = response.text
    # Facebook ad creative: full_picture, image_url, creative image (often in JSON)
    for key in ("full_picture", "image_url", "picture", "creative_image", "ad_image", "image_src"):
        for m in re.finditer(rf'["\']?{re.escape(key)}["\']?\s*:\s*["\'](https?://[^"\']+)["\']', raw, re.I):
            add(m.group(1), f"raw_html({key})")
    # Facebook CDN: scontent.xx.fbcdn.net (avoid rsrc.php - those are logos; prefer scontent for creatives)
    for m in re.finditer(
        r"https?://(?:scontent[^.\s\"'<>]*\.)?fbcdn\.net/[^\s\"'<>]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s\"'<>]*)?",
        raw,
        re.I,
    ):
        add(m.group(0), "raw_html(fbcdn)")
    # og:image content="..." in case meta wasn't parsed
    for m in re.finditer(r'["\']?(?:og:image|og:image:secure_url)["\']?\s*[=:]\s*["\'](https?://[^"\']+)["\']', raw, re.I):
        add(m.group(1), "raw_html(og:image)")
    for m in re.finditer(r'content\s*=\s*["\'](https?://[^"\']+\.(?:jpg|jpeg|png|webp|gif)[^"\']*)["\']', raw, re.I):
        add(m.group(1), "raw_html(content)")

    # Many sites (e.g. Amazon) require Referer to serve images
    def save_one(img_url: str, label: str, index: int) -> bool:
        try:
            req_headers = {**headers, "Referer": base_url}
            r = requests.get(img_url, headers=req_headers, timeout=15, stream=True)
            r.raise_for_status()
            ct = r.headers.get("content-type", "").lower()
            # Accept image/* or application/octet-stream; when few candidates accept any non-empty body
            if "image" not in ct and "octet-stream" not in ct:
                # Some CDNs don't set content-type; if we have few candidates, try saving by URL extension
                if len(collected) > max_images:
                    print(f"  Skipped {label}: content-type is {ct or '(empty)'}, not image", file=sys.stderr)
                    return False
                # Fall through and save; we'll check file size / magic later
            cl = r.headers.get("content-length")
            if cl:
                try:
                    size = int(cl)
                    if size < effective_min_bytes:
                        print(f"  Skipped {label}: content-length {size} < {effective_min_bytes} bytes", file=sys.stderr)
                        return False
                except ValueError:
                    pass
            ext = mimetypes.guess_extension(ct.split(";")[0].strip()) if ct else None
            if not ext or ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                path_part = urlparse(img_url).path
                if path_part.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
                    ext = path_part[path_part.rfind(".") :].lower()
                else:
                    ext = ".jpg"
            path = output_dir / f"web_{index}{ext}"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            size = path.stat().st_size
            if size < effective_min_bytes:
                path.unlink(missing_ok=True)
                print(f"  Skipped {label}: downloaded file size {size} < {effective_min_bytes} bytes", file=sys.stderr)
                return False
            return True
        except requests.HTTPError as e:
            print(f"  Skipped {label}: HTTP {e.response.status_code} {e.response.reason}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"  Skipped {label}: {type(e).__name__}: {e}", file=sys.stderr)
            return False

    print(f"  Found {len(collected)} image candidate(s) on page")
    if not collected:
        return 0

    # When few candidates, accept smaller images (1KB min); when many, use 15KB min to skip logos
    effective_min_bytes = (
        WEBSITE_MIN_IMAGE_BYTES
        if len(collected) > max_images
        else WEBSITE_MIN_WHEN_FEW_CANDIDATES
    )

    # Prefer larger images: sort by content-length (HEAD) descending so we try high-res first
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
    collected_with_size.sort(key=lambda x: -x[2])  # largest first
    collected = [(url, label) for url, label, _ in collected_with_size]

    downloaded = 0
    for i, (img_url, label) in enumerate(collected):
        if downloaded >= max_images:
            break
        if save_one(img_url, label, downloaded):
            downloaded += 1
            print(f"  [{downloaded}/{max_images}] {label}")

    return downloaded


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download images from an Instagram profile or a brand website into an output folder."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "-i", "--instagram",
        metavar="HANDLE",
        help="Instagram handle (username).",
    )
    group.add_argument(
        "-u", "--url",
        metavar="URL",
        help="Brand website URL.",
    )
    parser.add_argument(
        "-o", "--output",
        required=True,
        help="Output folder path. Created if it does not exist.",
    )
    parser.add_argument(
        "-n", "--limit",
        type=int,
        default=5,
        metavar="N",
        help="Maximum number of images to download in total (default: 5).",
    )
    args = parser.parse_args()

    output_dir = Path(args.output).resolve()
    max_images = max(1, args.limit)
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output folder: {output_dir}")

    if args.url is not None:
        # Website URL: scrape page and download images
        page_url = args.url.strip()
        if not page_url:
            print("Error: URL cannot be empty.", file=sys.stderr)
            sys.exit(1)
        if not BeautifulSoup:
            print("Error: BeautifulSoup4 is required for website URLs. Install with: pip install beautifulsoup4", file=sys.stderr)
            sys.exit(1)
        print(f"Downloading up to {max_images} image(s) from website: {page_url[:80]}...")
        try:
            downloaded = download_from_website(page_url, output_dir, max_images)
        except requests.RequestException as e:
            print(f"Error fetching website: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        # Instagram handle
        handle = (args.instagram or "").strip().lstrip("@")
        if not handle:
            print("Error: Instagram handle cannot be empty.", file=sys.stderr)
            sys.exit(1)
        if not instaloader:
            print("Error: instaloader is required for Instagram. Install with: pip install instaloader", file=sys.stderr)
            sys.exit(1)
        print(f"Downloading up to {max_images} image(s) from @{handle}...")

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
        except instaloader.exceptions.ProfileNotExistsException:
            print(f"Error: Profile '@{handle}' does not exist.", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"Error loading profile: {e}", file=sys.stderr)
            sys.exit(1)

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
                        path = output_dir / f"{post.shortcode}_{idx}.jpg"
                        if download_image_to_path(node.display_url, path, referer="https://www.instagram.com/"):
                            downloaded += 1
                            print(f"  [{downloaded}/{max_images}] {post.shortcode}_{idx}")
                else:
                    path = output_dir / f"{post.shortcode}.jpg"
                    if download_image_to_path(post.url, path, referer="https://www.instagram.com/"):
                        downloaded += 1
                        print(f"  [{downloaded}/{max_images}] {post.shortcode}")
            except Exception as e:
                print(f"  Skipped {post.shortcode}: {e}", file=sys.stderr)

    print(f"Done. Downloaded {downloaded} image(s) to {output_dir}")


if __name__ == "__main__":
    main()
