#!/usr/bin/env python3
"""
Shopify Partners Directory Scraper
====================================
Scrapes partner/agency details from any Shopify Partners Directory category
page, including contact info, social links, supported locations, and
business details.  Exports to CSV.

Uses:
  - requests + BeautifulSoup for HTML scraping (no Apify needed)

Dependencies:
  pip install requests beautifulsoup4 python-dotenv

Usage:
  python shopify_partner_scraper.py --url "https://www.shopify.com/ca/partners/directory/services/marketing-and-sales/social-media-marketing"
  python shopify_partner_scraper.py --url "https://www.shopify.com/ca/partners/directory/services/marketing-and-sales/content-marketing"
  python shopify_partner_scraper.py --max-pages 2            # test run
  python shopify_partner_scraper.py --output ~/my_file.csv
  python shopify_partner_scraper.py --resume                 # continue from saved JSON
"""

import argparse
import csv
import json
import math
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Optional .env loading (same pattern as sibling scripts)
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_URL = "https://www.shopify.com/ca/partners/directory/services/marketing-and-sales/social-media-marketing"
DETAIL_BASE = "https://www.shopify.com"
PARTNERS_PER_PAGE = 16

OUTPUT_BASE = Path(__file__).parent.parent / "output"


def _output_dir_for_url(url: str) -> Path:
    """Derive a unique intermediate-data folder name from the directory URL."""
    # e.g. ".../services/marketing-and-sales/social-media-marketing"
    #   -> "shopify_social-media-marketing"
    slug = url.rstrip("/").split("/")[-1]
    return OUTPUT_BASE / f"shopify_{slug}"

CSV_FIELDS = [
    "name",
    "slug",
    "url",
    "rating",
    "review_count",
    "partner_since",
    "partner_tier",
    "price_range",
    "website",
    "phone",
    "email",
    "facebook",
    "instagram",
    "linkedin",
    "primary_location",
    "supported_locations",
    "languages",
    "business_description",
    "services",
    "industries",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
def _check_dependencies():
    missing = []
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    try:
        from bs4 import BeautifulSoup  # noqa: F401
    except ImportError:
        missing.append("beautifulsoup4")
    if missing:
        print(f"[ERROR] Missing packages: {', '.join(missing)}")
        print(f"        pip install {' '.join(missing)}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def fetch_page(url: str, delay: float = 1.0, retries: int = 3) -> str | None:
    """Fetch a URL with retries and rate limiting."""
    import requests as _requests

    for attempt in range(1, retries + 1):
        try:
            resp = _requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 200:
                if delay > 0:
                    time.sleep(delay)
                return resp.text
            elif resp.status_code == 429:
                wait = min(60, delay * (2 ** attempt))
                print(f"  [WARN] Rate limited (429). Waiting {wait:.0f}s ...")
                time.sleep(wait)
            else:
                print(f"  [WARN] HTTP {resp.status_code} for {url} (attempt {attempt}/{retries})")
                time.sleep(delay * attempt)
        except Exception as e:
            print(f"  [ERROR] Request failed: {e} (attempt {attempt}/{retries})")
            time.sleep(delay * attempt)
    print(f"  [ERROR] Giving up on {url} after {retries} attempts")
    return None


# ---------------------------------------------------------------------------
# Phase 1: Collect partner URLs from listing pages
# ---------------------------------------------------------------------------
def parse_listing_page(html: str) -> tuple[list[dict], int]:
    """Parse a listing page.  Returns (partners_list, total_count)."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    partners = []

    for link in soup.find_all("a", href=lambda h: h and "/partner/" in h):
        classes = link.get("class", [])
        if "w-full" not in classes:
            continue

        href = link["href"]
        slug = href.rstrip("/").split("/")[-1]

        name_el = link.find("h3")
        name = name_el.get_text(strip=True) if name_el else ""

        # Rating
        rating = ""
        review_count = ""
        star_svg = link.find("svg")
        if star_svg:
            rating_span = star_svg.find_next_sibling("span")
            if rating_span:
                rating = rating_span.get_text(strip=True)
            count_span = rating_span.find_next_sibling("span") if rating_span else None
            if count_span:
                raw = count_span.get_text(strip=True)
                review_count = re.sub(r"[^\d]", "", raw)

        # Location
        location = ""
        loc_spans = link.find_all("span", class_=lambda c: c and "text-gray-500" in c)
        for s in loc_spans:
            text = s.get_text(strip=True)
            if text and text != "|" and "Price" not in text:
                location = text
                break

        # Price range
        price_range = ""
        price_labels = link.find_all("span", class_=lambda c: c and "font-medium" in c)
        for pl in price_labels:
            text = pl.get_text(strip=True)
            if text and ("$" in text or "Contact" in text or "Starting" in text):
                price_range = text
                break

        partners.append({
            "slug": slug,
            "url": f"{DETAIL_BASE}{href}",
            "name": name,
            "rating": rating,
            "review_count": review_count,
            "primary_location": location,
            "price_range": price_range,
        })

    # Total count from "Showing X - Y of Z partners"
    total = 0
    showing_p = soup.find("p", class_=lambda c: c and "flex-initial" in c)
    if showing_p:
        text = showing_p.get_text(separator=" ", strip=True)
        m = re.search(r"of\s+([\d,]+)", text)
        if m:
            total = int(m.group(1).replace(",", ""))

    return partners, total


def phase1_collect(args) -> list[dict]:
    """Paginate listing pages and collect all partner basic info."""
    print("\n" + "=" * 60)
    print("PHASE 1: Collecting partner URLs from listing pages")
    print("=" * 60)
    print(f"  Directory URL: {args.url}")

    all_partners = []
    page = args.start_page
    total_pages = None

    while True:
        url = f"{args.url}?page={page}"
        print(f"\n[PAGE {page}] Fetching {url}")

        html = fetch_page(url, delay=args.delay)
        if html is None:
            print(f"  [WARN] Skipping page {page} (fetch failed)")
            page += 1
            if total_pages and page > total_pages:
                break
            continue

        partners, total_count = parse_listing_page(html)

        if total_count > 0 and total_pages is None:
            total_pages = math.ceil(total_count / PARTNERS_PER_PAGE)
            print(f"  Total partners: {total_count}  |  Total pages: {total_pages}")

        if not partners:
            print(f"  No partners found on page {page}. Stopping pagination.")
            break

        all_partners.extend(partners)
        print(f"  Found {len(partners)} partners  |  Cumulative: {len(all_partners)}")

        if args.max_pages > 0 and (page - args.start_page + 1) >= args.max_pages:
            print(f"\n  Reached --max-pages limit ({args.max_pages}). Stopping.")
            break

        if total_pages and page >= total_pages:
            break

        page += 1

    # Deduplicate by slug
    seen = set()
    unique = []
    for p in all_partners:
        if p["slug"] not in seen:
            seen.add(p["slug"])
            unique.append(p)

    print(f"\n[PHASE 1 COMPLETE] {len(unique)} unique partners collected")
    return unique


# ---------------------------------------------------------------------------
# Phase 2: Scrape each partner detail page
# ---------------------------------------------------------------------------
def _find_section_value(soup, label_text: str) -> str:
    """Find a <p class='...text-t7'> label and return the text of its next sibling."""
    from bs4 import BeautifulSoup  # noqa: F811

    for p in soup.find_all("p", class_=lambda c: c and "text-t7" in c):
        if p.get_text(strip=True) == label_text:
            parent = p.parent
            siblings = [s for s in parent.children if s.name and s != p]
            texts = []
            for sib in siblings:
                t = sib.get_text(separator=", ", strip=True)
                if t:
                    texts.append(t)
            return "; ".join(texts)
    return ""


def parse_detail_page(html: str, basic_info: dict) -> dict:
    """Parse a partner detail page and merge with basic listing info."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    data = dict(basic_info)

    # ---------- Name (h1 if available) ----------
    h1 = soup.find("h1")
    if h1:
        data["name"] = h1.get_text(strip=True)

    # ---------- Partner tier badge ----------
    tier = ""
    for div in soup.find_all("div", class_=lambda c: c and "rounded-full" in c and "border" in c):
        t = div.get_text(strip=True)
        if t:
            tier = t
            break
    data["partner_tier"] = tier

    # ---------- Partner since ----------
    partner_since = ""
    for p in soup.find_all("p", class_="richtext"):
        t = p.get_text(strip=True)
        if "Partner since" in t:
            partner_since = t.replace("Partner since", "").strip()
            break
    data["partner_since"] = partner_since

    # ---------- Price range ----------
    price = _find_section_value(soup, "Price range for selected services")
    if price:
        data["price_range"] = price

    # ---------- Contact information ----------
    website = ""
    phone = ""
    email = ""

    # Find the "Contact information" section and extract links from it
    for p_tag in soup.find_all("p", class_=lambda c: c and "text-t7" in c):
        if p_tag.get_text(strip=True) == "Contact information":
            container = p_tag.parent
            for a in container.find_all("a", href=True):
                href = a["href"]
                text = a.get_text(strip=True)
                if href.startswith("mailto:") and text and not email:
                    email = text
                elif href.startswith("tel:") and text and not phone:
                    phone = text
                elif text and not website and not href.startswith(("mailto:", "tel:")):
                    website = re.sub(r"\?utm_source=sref.*", "", href)
            break

    data["website"] = website
    data["phone"] = phone
    data["email"] = email

    # ---------- Social links ----------
    facebook = ""
    instagram = ""
    linkedin = ""

    # Find the "Social links" section
    for p_tag in soup.find_all("p", class_=lambda c: c and "text-t7" in c):
        if p_tag.get_text(strip=True) == "Social links":
            container = p_tag.parent
            for a in container.find_all("a", href=True):
                href = a["href"]
                if "facebook.com" in href and "shopify" not in href.lower():
                    facebook = href
                elif "instagram.com" in href and "shopify" not in href.lower():
                    instagram = href
                elif "linkedin.com" in href and "shopify" not in href.lower():
                    linkedin = href
            break

    data["facebook"] = facebook
    data["instagram"] = instagram
    data["linkedin"] = linkedin

    # ---------- Primary location ----------
    primary_loc = _find_section_value(soup, "Primary location")
    if primary_loc:
        primary_loc = re.sub(r"(,\s*)+", ", ", primary_loc).strip(", ")
        data["primary_location"] = primary_loc

    # ---------- Supported locations ----------
    supported_loc = _find_section_value(soup, "Supported locations")
    if supported_loc:
        supported_loc = re.sub(r";\s*\+\d+ more", "", supported_loc).strip("; ")
        supported_loc = re.sub(r"(,\s*)+", ", ", supported_loc).strip(", ")
        data["supported_locations"] = supported_loc

    # ---------- Languages ----------
    data["languages"] = _find_section_value(soup, "Languages")

    # ---------- Business description ----------
    bio = ""
    for el in soup.find_all("h3"):
        if el.get_text(strip=True) == "Business description":
            next_el = el.find_next_sibling()
            if next_el:
                bio = next_el.get_text(strip=True)
            break
    data["business_description"] = bio

    # ---------- Services ----------
    services = []

    # Specialized services
    for h2 in soup.find_all("h2"):
        if "Specialized services" in h2.get_text(strip=True):
            section = h2.parent
            for h3 in section.find_all("h3"):
                svc = h3.get_text(strip=True)
                if svc and svc != "Business description":
                    services.append(svc)
            break

    # Other services
    for h2 in soup.find_all("h2"):
        if h2.get_text(strip=True) == "Other services":
            next_el = h2.find_next_sibling()
            if next_el:
                others = [s.strip() for s in next_el.get_text(separator=",", strip=True).split(",") if s.strip()]
                services.extend(others)
            break

    data["services"] = ", ".join(services) if services else ""

    # ---------- Industries ----------
    industries = ""
    for h2 in soup.find_all("h2"):
        if h2.get_text(strip=True) == "Industries":
            next_el = h2.find_next_sibling()
            if next_el:
                industries = next_el.get_text(separator=", ", strip=True)
            break
    data["industries"] = industries

    # ---------- Rating from detail page (more precise) ----------
    for h2 in soup.find_all("h2"):
        text = h2.get_text(strip=True)
        m = re.match(r"Rating([\d.]+)\((\d+)\)", text)
        if m:
            data["rating"] = m.group(1)
            data["review_count"] = m.group(2)
            break

    return data


def phase2_scrape_details(partners: list[dict], args, output_dir: Path) -> list[dict]:
    """Visit each partner detail page and extract full data."""
    print("\n" + "=" * 60)
    print("PHASE 2: Scraping partner detail pages")
    print("=" * 60)
    print(f"  Partners to scrape: {len(partners)}")

    detailed = []
    total = len(partners)

    for i, partner in enumerate(partners, 1):
        url = partner["url"]
        slug = partner["slug"]

        print(f"\n[{i}/{total}] {partner.get('name', slug)}")
        print(f"  URL: {url}")

        html = fetch_page(url, delay=args.delay)
        if html is None:
            print("  [WARN] Skipping (fetch failed)")
            detailed.append(partner)
            continue

        data = parse_detail_page(html, partner)
        detailed.append(data)

        contact_parts = []
        if data.get("email"):
            contact_parts.append(f"email={data['email']}")
        if data.get("phone"):
            contact_parts.append(f"phone={data['phone']}")
        if data.get("website"):
            contact_parts.append(f"web={data['website']}")
        social_parts = []
        if data.get("facebook"):
            social_parts.append("FB")
        if data.get("instagram"):
            social_parts.append("IG")
        if data.get("linkedin"):
            social_parts.append("LI")

        print(f"  Contact: {', '.join(contact_parts) or 'none'}")
        print(f"  Social:  {', '.join(social_parts) or 'none'}")
        print(f"  Location: {data.get('primary_location', 'N/A')}")

        # Save intermediate every 50 partners
        if i % 50 == 0:
            _save_json(detailed, output_dir / "phase2_details.json")
            print(f"  [CHECKPOINT] Saved {len(detailed)} detailed records")

    print(f"\n[PHASE 2 COMPLETE] {len(detailed)} partners scraped")
    return detailed


# ---------------------------------------------------------------------------
# Phase 3: Export to CSV
# ---------------------------------------------------------------------------
def phase3_export(partners: list[dict], output_path: str):
    """Write partners to CSV."""
    print("\n" + "=" * 60)
    print("PHASE 3: Exporting to CSV")
    print("=" * 60)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for p in partners:
            writer.writerow(p)

    print(f"  Wrote {len(partners)} rows to {output_path}")

    # Summary stats
    has_email = sum(1 for p in partners if p.get("email"))
    has_phone = sum(1 for p in partners if p.get("phone"))
    has_website = sum(1 for p in partners if p.get("website"))
    has_fb = sum(1 for p in partners if p.get("facebook"))
    has_ig = sum(1 for p in partners if p.get("instagram"))
    has_li = sum(1 for p in partners if p.get("linkedin"))

    print(f"\n  --- Summary ---")
    print(f"  Total partners:    {len(partners)}")
    print(f"  With email:        {has_email} ({100*has_email/max(1,len(partners)):.1f}%)")
    print(f"  With phone:        {has_phone} ({100*has_phone/max(1,len(partners)):.1f}%)")
    print(f"  With website:      {has_website} ({100*has_website/max(1,len(partners)):.1f}%)")
    print(f"  With Facebook:     {has_fb} ({100*has_fb/max(1,len(partners)):.1f}%)")
    print(f"  With Instagram:    {has_ig} ({100*has_ig/max(1,len(partners)):.1f}%)")
    print(f"  With LinkedIn:     {has_li} ({100*has_li/max(1,len(partners)):.1f}%)")


# ---------------------------------------------------------------------------
# JSON persistence
# ---------------------------------------------------------------------------
def _save_json(data, path: Path):
    os.makedirs(path.parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_json(path: Path) -> list[dict] | None:
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    _check_dependencies()

    parser = argparse.ArgumentParser(
        description="Scrape any Shopify Partners Directory category page"
    )
    parser.add_argument(
        "--url",
        type=str,
        default=DEFAULT_URL,
        help=(
            "Shopify Partners Directory URL to scrape. "
            "Default: social-media-marketing category"
        ),
    )
    parser.add_argument(
        "--output",
        type=str,
        default="",
        help="Output CSV path (default: ~/Downloads/shopify_<category>.csv)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Max listing pages to scrape (0 = all). Useful for testing.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds between HTTP requests (default: 1.0)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from intermediate JSON files if available",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=1,
        help="Listing page to start from (default: 1)",
    )

    args = parser.parse_args()

    # Derive category slug from URL for naming
    category_slug = args.url.rstrip("/").split("/")[-1]
    output_dir = _output_dir_for_url(args.url)

    # Output path
    if args.output:
        output_path = os.path.expanduser(args.output)
    else:
        output_path = os.path.expanduser(
            f"~/Downloads/shopify_{category_slug}.csv"
        )

    print("=" * 60)
    print("  Shopify Partners Directory Scraper")
    print("=" * 60)
    print(f"  URL:         {args.url}")
    print(f"  Category:    {category_slug}")
    print(f"  Output:      {output_path}")
    print(f"  Max pages:   {'all' if args.max_pages == 0 else args.max_pages}")
    print(f"  Delay:       {args.delay}s")
    print(f"  Start page:  {args.start_page}")
    print(f"  Resume:      {args.resume}")
    print(f"  Intermediate: {output_dir}")
    print("=" * 60)

    os.makedirs(output_dir, exist_ok=True)

    # ---- Phase 1 ----
    phase1_file = output_dir / "phase1_partners.json"
    partners = None

    if args.resume:
        partners = _load_json(phase1_file)
        if partners:
            print(f"\n[RESUME] Loaded {len(partners)} partners from {phase1_file}")

    if partners is None:
        partners = phase1_collect(args)
        _save_json(partners, phase1_file)
        print(f"  Saved Phase 1 data to {phase1_file}")

    # ---- Phase 2 ----
    phase2_file = output_dir / "phase2_details.json"
    detailed = None

    if args.resume:
        detailed = _load_json(phase2_file)
        if detailed:
            print(f"\n[RESUME] Loaded {len(detailed)} detailed records from {phase2_file}")
            # Check if we need to scrape remaining partners
            scraped_slugs = {d["slug"] for d in detailed if d.get("partner_since") or d.get("email") or d.get("business_description")}
            remaining = [p for p in partners if p["slug"] not in scraped_slugs]
            if remaining:
                print(f"  {len(remaining)} partners still need detail scraping")
                new_detailed = phase2_scrape_details(remaining, args, output_dir)
                detailed.extend(new_detailed)
                _save_json(detailed, phase2_file)

    if detailed is None:
        detailed = phase2_scrape_details(partners, args, output_dir)
        _save_json(detailed, phase2_file)
        print(f"  Saved Phase 2 data to {phase2_file}")

    # ---- Phase 3 ----
    phase3_export(detailed, output_path)

    print("\n" + "=" * 60)
    print("  DONE!")
    print("=" * 60)


if __name__ == "__main__":
    main()
