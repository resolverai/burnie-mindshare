import argparse
import json
import os
import re
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables from python-ai-backend/.env (when running inside python-ai-backend container)
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY from .env
gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GEMINI_API_KEY")
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)


def _parse_json_response(text):
    """Extract and parse JSON from model response, handling markdown code blocks and common issues."""
    text = (text or "").strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        text = match.group(1).strip()
    # Extract JSON object if wrapped in prose
    if "{" in text and "}" in text and not text.strip().startswith("{"):
        start = text.find("{")
        depth = 0
        end = -1
        for i, c in enumerate(text[start:], start):
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end > start:
            text = text[start : end + 1]
    # Fix common JSON issues: trailing commas before ] or }
    text = re.sub(r",\s*([}\]])", r"\1", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        try:
            from json_repair import repair_json

            repaired = repair_json(text)
            return json.loads(repaired)
        except ImportError:
            raise e
        except json.JSONDecodeError:
            raise e
        except Exception:
            raise e


# Valid categories - use "Others" if brand/competitor doesn't fit any
CATEGORIES = [
    "Fashion", "Food & Beverage", "Tech", "Health", "Retail", "Beauty", "E-Commerce",
    "Jewellery", "Sports & Fitness", "Travel & Hospitality", "Automotive", "Entertainment & Media",
    "Home & Garden", "Education", "Financial Services", "Real Estate", "Others"
]


def _format_runtime(start_str: str | None, stop_str: str | None) -> str:
    """Format ad runtime as '15h', '1d', '42h', etc."""
    if not start_str or not str(start_str).strip():
        return ""
    try:
        s = str(start_str).strip()[:19].replace("Z", "+00:00")
        start = datetime.fromisoformat(s)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return ""
    end = datetime.now(timezone.utc)
    if stop_str and str(stop_str).strip():
        try:
            s = str(stop_str).strip()[:19].replace("Z", "+00:00")
            end = datetime.fromisoformat(s)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            pass
    try:
        delta = end - start
    except TypeError:
        return ""
    total_hours = delta.total_seconds() / 3600
    if total_hours < 0:
        return ""
    if total_hours < 1:
        return f"{int(delta.total_seconds() / 60)}m"
    if total_hours < 24:
        return f"{int(total_hours)}h"
    days = int(total_hours / 24)
    return f"{days}d"


def _decode_url(u: str) -> str:
    """Decode HTML entities in URL (e.g. &amp; -> &)."""
    return (u or "").replace("&amp;", "&").replace("&#38;", "&").strip()


# Skip fbcdn image URLs that look like thumbnails (s60x60, s200x200, etc) - same logic as meta-ads-fetch
_THUMBNAIL_PATTERN = re.compile(r"/s\d+x\d+/", re.I)


def _derive_platform(publisher_platforms: list) -> str:
    """
    Derive platform from publisher_platforms (Meta Ads Library).
    Returns: meta, instagram, facebook, google, youtube, tiktok.
    For Meta: if only instagram -> instagram, only facebook -> facebook, else meta.
    """
    if not publisher_platforms or not isinstance(publisher_platforms, list):
        return "meta"
    platforms = [str(p).lower().strip() for p in publisher_platforms if p]
    if not platforms:
        return "meta"
    if len(platforms) == 1:
        p = platforms[0]
        if p == "instagram":
            return "instagram"
        if p == "facebook":
            return "facebook"
        if p in ("messenger", "audience_network"):
            return "meta"
    return "meta"


def _is_thumbnail_url(url: str) -> bool:
    """True if URL looks like a small thumbnail (e.g. s60x60, s200x200 in fbcdn path)."""
    if not url or not isinstance(url, str):
        return True
    return bool(_THUMBNAIL_PATTERN.search(url))


def _get_creative_urls_from_apify(
    apify_items: list,
    ad_id: str,
    ad_snapshot_url: str | None = None,
) -> tuple[list[str], list[str]]:
    """
    Match ad by id/adId or by ad_snapshot_url, return (image_urls, video_urls).
    Skips thumbnail-sized image URLs (s60x60, s200x200, etc) - same logic as meta-ads-fetch.
    Returns all non-thumbnail image URLs and all video URLs for max-size selection downstream.
    """
    ad_id_str = str(ad_id).strip()
    snapshot_url = (ad_snapshot_url or "").strip()
    suffix = ad_id_str.split("_")[-1] if "_" in ad_id_str else ad_id_str

    def _match_item(item: dict) -> bool:
        lid = (
            (item.get("adId") or item.get("id") or item.get("ad_id") or item.get("library_id")) or ""
        )
        lid_str = str(lid).strip()
        if lid_str == ad_id_str or lid_str == suffix:
            return True
        if snapshot_url and str(item.get("url") or "").strip() == snapshot_url:
            return True
        return False

    for item in apify_items:
        if not _match_item(item):
            continue
        images = item.get("images") or []
        videos = item.get("videos") or []
        img_urls: list[str] = []
        for i in images:
            u = i.get("url") or i.get("src") if isinstance(i, dict) else i
            if u and not _is_thumbnail_url(str(u)):
                img_urls.append(_decode_url(str(u)))
        if not img_urls and images:
            u = images[0]
            u = u.get("url") or u.get("src") if isinstance(u, dict) else u
            if u:
                img_urls.append(_decode_url(str(u)))
        vid_urls: list[str] = []
        for v in videos:
            u = v.get("url") or v.get("src") if isinstance(v, dict) else v
            if u:
                vid_urls.append(_decode_url(str(u)))
        return (img_urls, vid_urls)
    return ([], [])


def get_competitor_json(domain, local_limit=5, global_limit=2):
    # Using 'gemini-2.5-flash' for speed and structured output
    model = genai.GenerativeModel(
        model_name='gemini-2.5-flash',
        generation_config={"response_mime_type": "application/json"}
    )
    
    categories_str = ", ".join(f'"{c}"' for c in CATEGORIES)
    total = local_limit + global_limit
    prompt = f"""
    1. Identify the primary geographic market and industry niche for {domain}.
    2. Estimate the annual revenue of {domain} (in USD).
    3. Assign a category to {domain} from this exact list: {categories_str}. Use "Others" only if none fit.
    4. Identify {total} competitors with revenue GREATER than this brand: {local_limit} LOCAL competitors (same region/market) and {global_limit} GLOBAL competitors (international/major players).
    5. Sort competitors by annual revenue in descending order (highest revenue first). List local competitors first, then global.
    6. Assign each competitor a category from the same list. Use "Others" only if none fit.
    7. Return a JSON object with the following structure:
    {{
      "brand_identity": {{
        "detected_region": "string",
        "primary_niche": "string",
        "category": "string (one of: {categories_str})",
        "estimated_annual_revenue_usd": "string (e.g. 5.2M, 500K)"
      }},
      "competitors": [
        {{
          "name": "string",
          "website": "string",
          "instagram_handle": "string",
          "category": "string (one of: {categories_str})",
          "annual_revenue_usd": "string (e.g. 5.2M, 500K)",
          "tier": "Local Leader | Global Giant",
          "competitive_advantage": "string"
        }}
      ]
    }}
    Use your best estimates for revenue figures based on publicly available data, market size, and comparable companies. Format revenue as strings with M for millions and K for thousands (e.g. "5.2M", "500K", "1.8M"). Category must be exactly one of the listed values.
    """
    
    try:
        response = model.generate_content(prompt)
        raw_text = response.text if response else ""
        data = _parse_json_response(raw_text)
        print(json.dumps(data, indent=2))
        return data
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print("Raw response:", raw_text[:500] if raw_text else "empty")
    except Exception as e:
        print(f"Error: {e}")


def _parse_revenue_to_number(s: str | None) -> float:
    """Parse revenue string (e.g. '5.2M', '500K') to numeric for sorting."""
    if not s or not isinstance(s, str):
        return 0.0
    t = str(s).strip().upper().replace(",", "")
    m = re.search(r"([\d.]+)\s*([KMB])?", t)
    if not m:
        return 0.0
    n = float(m.group(1) or 0)
    unit = (m.group(2) or "").upper()
    if unit == "K":
        n *= 1_000
    elif unit == "M":
        n *= 1_000_000
    elif unit == "B":
        n *= 1_000_000_000
    return n


def _get_brand_enrichment_from_gemini(
    brand_name: str,
    sample_ad_copy: str,
    landing_domain: str | None,
    local_limit: int = 5,
    global_limit: int = 2,
) -> dict:
    """Call Gemini to get category, revenue, and similar competitors (local + global) for a brand."""
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        generation_config={"response_mime_type": "application/json"},
    )
    categories_str = ", ".join(f'"{c}"' for c in CATEGORIES)
    total = local_limit + global_limit
    context = f"Brand: {brand_name}"
    if sample_ad_copy:
        context += f"\nSample ad copy: {sample_ad_copy[:800]}"
    if landing_domain:
        context += f"\nLanding page/domain: {landing_domain}"

    prompt = f"""
    Based on this brand's ad data:
    {context}

    1. Estimate the annual revenue of this brand in USD. Format as string with M for millions, K for thousands (e.g. "5.2M", "500K").
    2. Find the Instagram handle for this brand (e.g. @sneakersnstuff, without @ or with @ both OK).
    3. Assign a category from this exact list: {categories_str}. Use "Others" only if none fit.
    4. Identify {total} similar competitors (DTC brands in the same niche/category): {local_limit} LOCAL competitors (same region/market) and {global_limit} GLOBAL competitors (international/major players). List local first, then global.
    5. For each competitor, estimate annual revenue in USD (format: "5.2M", "500K") and include Instagram handle. Sort competitors by annual revenue in descending order (highest first).
    6. Return JSON:
    {{
      "category": "string (exactly one of: {categories_str})",
      "estimated_annual_revenue_usd": "string (e.g. 5.2M, 500K)",
      "instagram_handle": "string (e.g. sneakersnstuff or @sneakersnstuff)",
      "similar_competitors": [
        {{
          "name": "string",
          "website": "string (domain e.g. competitor.com)",
          "instagram_handle": "string (e.g. competitor_handle or @competitor_handle)",
          "annual_revenue_usd": "string (e.g. 5.2M, 500K)",
          "reason": "string (brief why similar)",
          "tier": "Local Leader | Global Giant"
        }}
      ]
    }}
    Focus on small-to-mid DTC brands, not giant corporations. Category must be exactly one of the listed values. tier must be "Local Leader" for local competitors and "Global Giant" for global. Use your best estimates for revenue based on publicly available data.
    """
    try:
        response = model.generate_content(prompt)
        raw_text = response.text if response else ""
        data = _parse_json_response(raw_text)
        return data
    except json.JSONDecodeError as e:
        print(f"   Warning: Gemini JSON parse failed for {brand_name}: {e}")
        return {"category": "Others", "similar_competitors": []}
    except Exception as e:
        print(f"   Warning: Gemini enrichment failed for {brand_name}: {e}")
        return {"category": "Others", "similar_competitors": []}


def _expand_keywords_for_matching(keywords: list[str]) -> list[str]:
    """
    Expand keywords for flexible matching in ad_creative_link_captions.
    E.g. lululemon.com -> [lululemon.com, lululemon]; titikaactive -> [titikaactive].
    Matches keyword in any form (domain or brand name).
    """
    expanded = set()
    for k in keywords:
        k = str(k).strip().lower()
        if not k:
            continue
        expanded.add(k)
        if "." in k and not k.startswith("."):
            base = k.split(".")[0]
            if len(base) >= 2:
                expanded.add(base)
    return list(expanded)


def _filter_ads_by_keyword_in_captions(ads: list[dict], keywords: list[str]) -> list[dict]:
    """
    Keep only ads where keyword appears in ad_creative_link_captions or ad_creative_link_titles.
    Keyword can be anything (lululemon, titikaactive, lululemon.com). Matches substring (any form).
    """
    if not keywords:
        return ads
    kw_lower = _expand_keywords_for_matching(keywords)
    if not kw_lower:
        return ads

    def _ad_contains_keyword(ad: dict) -> bool:
        def _matches(text: str) -> bool:
            return text and any(kw in (text or "").lower() for kw in kw_lower)

        def _extract_texts(field_val: list) -> list[str]:
            texts = []
            for item in (field_val or []):
                if isinstance(item, str):
                    texts.append(item)
                elif isinstance(item, dict):
                    texts.append(item.get("text") or item.get("caption") or item.get("name") or item.get("value") or "")
                else:
                    texts.append(str(item))
            return texts

        for field_key in ("ad_creative_link_captions", "ad_creative_link_titles"):
            field_val = ad.get(field_key) or []
            for text in _extract_texts(field_val if isinstance(field_val, list) else [field_val]):
                if _matches(str(text)):
                    return True
        return False

    return [ad for ad in ads if _ad_contains_keyword(ad)]


def enrich_ads_with_gemini(
    meta_ads_path: Path,
    output_path: Path | None,
    apify_results_path: Path | None = None,
    search_brand: str | None = None,
    keywords: list[str] | None = None,
    keyword_filter: bool = True,
    local_limit: int = 5,
    global_limit: int = 2,
    media: str = "both",
) -> None:
    """
    Read meta_ads.json, enrich with Gemini (category + similar competitors) for the search_brand
    (the keyword from CLI, e.g. nike.com), transform to UI-ready format, and save to output JSON.
    Gemini runs only for search_brand, not for brands in the ad results.
    Filters ads by keyword in link_captions/link_titles when keyword_filter=True and keywords provided.
    """
    with open(meta_ads_path, encoding="utf-8") as f:
        meta_ads = json.load(f)
    if not isinstance(meta_ads, list):
        meta_ads = [meta_ads]

    if keyword_filter:
        kw = keywords or ([search_brand] if search_brand and str(search_brand).strip() else [])
        if kw:
            before = len(meta_ads)
            meta_ads = _filter_ads_by_keyword_in_captions(meta_ads, kw)
            if before > 0 and len(meta_ads) < before:
                print(f"   Keyword filter (in link_captions/link_titles): {before} → {len(meta_ads)}")
            if not meta_ads:
                raise SystemExit("No ads have keyword in ad creative fields. Nothing saved.")

    apify_items: list = []
    if apify_results_path and apify_results_path.exists():
        with open(apify_results_path, encoding="utf-8") as f:
            apify_items = json.load(f)
        if not isinstance(apify_items, list):
            apify_items = [apify_items]
        print(f"Loaded {len(apify_items)} Apify items for creative URLs")
    else:
        print("No apify_results.json found; creative URLs may be missing")

    # Run Gemini only for the search brand (from CLI keywords), not for each brand in ads
    category = "Others"
    search_brand_revenue: str | None = None
    search_brand_instagram: str | None = None
    similar_competitors: list = []
    if search_brand and search_brand.strip():
        print(f"Enriching search brand '{search_brand}' with Gemini (category + revenue + similar competitors)...")
        result = _get_brand_enrichment_from_gemini(
            search_brand.strip(),
            sample_ad_copy="",
            landing_domain=search_brand.strip(),
            local_limit=local_limit,
            global_limit=global_limit,
        )
        category = result.get("category") or "Others"
        search_brand_revenue = result.get("estimated_annual_revenue_usd") or None
        search_brand_instagram = result.get("instagram_handle") or None
        similar_competitors = result.get("similar_competitors") or []
        # Sort competitors by revenue descending (highest first)
        similar_competitors = sorted(
            similar_competitors,
            key=lambda c: _parse_revenue_to_number(c.get("annual_revenue_usd")),
            reverse=True,
        )
        print(f"   {search_brand} -> {category} (revenue: {search_brand_revenue or 'N/A'}, ig: {search_brand_instagram or 'N/A'}, {len(similar_competitors)} competitors)")
    else:
        print("No search brand (keywords) provided; skipping Gemini enrichment")

    # Build UI-ready ad objects; respect media: image=image only, video=video only, both=both
    want_image = media in ("image", "both")
    want_video = media in ("video", "both")
    ads_ui: list[dict] = []
    for ad in meta_ads:
        ad_id = (ad.get("id") or "").strip()
        brand_name = (ad.get("page_name") or "").strip() or "Unknown"
        snapshot_url = (ad.get("ad_snapshot_url") or "").strip()
        # Use creatives already on ad (e.g. from Apify Ad Library page scrape fallback) or look up from apify_items
        if ad.get("creativeImageUrls") is not None or ad.get("creativeVideoUrls") is not None:
            creative_img_urls = list(ad.get("creativeImageUrls") or [])
            creative_vid_urls = list(ad.get("creativeVideoUrls") or [])
        else:
            creative_img_urls, creative_vid_urls = _get_creative_urls_from_apify(
                apify_items, ad_id, ad_snapshot_url=snapshot_url
            )
        if not want_image:
            creative_img_urls = []
        if not want_video:
            creative_vid_urls = []

        bodies = ad.get("ad_creative_bodies") or []
        titles = ad.get("ad_creative_link_titles") or []
        descriptions = ad.get("ad_creative_link_descriptions") or []
        captions = ad.get("ad_creative_link_captions") or []

        publisher_platforms = ad.get("publisher_platforms") or []
        platform = _derive_platform(publisher_platforms)

        # Always store the safe Ad Library URL (no access token). Never persist render_ad URLs with token.
        if ad_id:
            ad_snapshot_url_for_db = f"https://www.facebook.com/ads/library/?id={ad_id}"
        elif snapshot_url and "access_token" not in snapshot_url:
            ad_snapshot_url_for_db = snapshot_url
        else:
            ad_snapshot_url_for_db = None

        ads_ui.append({
            "id": ad_id,
            "adSnapshotUrl": ad_snapshot_url_for_db,
            "platform": platform,
            "creativeImageUrls": creative_img_urls,
            "creativeVideoUrls": creative_vid_urls,
            "creativeImageUrl": creative_img_urls[0] if creative_img_urls else None,
            "creativeVideoUrl": creative_vid_urls[0] if creative_vid_urls else None,
            "mediaType": "video" if creative_vid_urls else "image",
            "brandName": brand_name,
            "pageId": (ad.get("page_id") or "").strip(),
            "category": category,
            "status": "active" if not (ad.get("ad_delivery_stop_time") or "").strip() else "inactive",
            "runtime": _format_runtime(
                ad.get("ad_delivery_start_time"),
                ad.get("ad_delivery_stop_time"),
            ),
            "firstSeen": (ad.get("ad_delivery_start_time") or ad.get("ad_creation_time") or "")[:10],
            "adCopy": {
                "bodies": bodies,
                "titles": titles,
                "descriptions": descriptions,
                "captions": captions,
            },
            "targetLanguage": (ad.get("languages") or ["en"])[0] if ad.get("languages") else "en",
            "targetCountries": [
                (loc.get("name") or loc.get("key") or str(loc))
                for loc in (ad.get("target_locations") or [])
                if isinstance(loc, dict)
            ][:20],
            "targetAges": ad.get("target_ages") or [],
            "targetGender": (ad.get("target_gender") or "").strip(),
            "publisherPlatforms": ad.get("publisher_platforms") or [],
            "landingPage": (ad.get("landing_page_url") or "").strip() or (str(captions[0]).strip() if captions and captions[0] else ""),
            "reach": {
                "eu_total_reach": ad.get("eu_total_reach"),
                "total_reach_by_location": ad.get("total_reach_by_location"),
            },
            "beneficiaryPayers": ad.get("beneficiary_payers") or [],
        })

    out_data = {
        "searchBrand": search_brand.strip() if search_brand and search_brand.strip() else None,
        "searchBrandRevenue": search_brand_revenue,
        "searchBrandInstagram": search_brand_instagram,
        "category": category,
        "similarCompetitors": similar_competitors,
        "ads": ads_ui,
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(out_data, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(ads_ui)} enriched ads to {output_path}")
    return out_data


def _load_meta_ads_fetch():
    """Load meta_ads_fetch module from app/services (same directory)."""
    import importlib.util
    mod_path = Path(__file__).parent / "meta_ads_fetch.py"
    spec = importlib.util.spec_from_file_location("meta_ads_fetch", mod_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fetch_and_enrich_ads(
    *,
    brand_domain: str,
    country: str = "US",
    limit: int = 20,
    exclude_meta_ad_ids: list[str] | None = None,
    media: str = "both",
    meta_token: str,
    apify_token: str,
    no_keyword_filter: bool = False,
    local_limit: int = 5,
    global_limit: int = 2,
    out_dir: Path | None = None,
    download_media: bool = False,
    facebook_handle: str | None = None,
    facebook_page_id: str | None = None,
) -> dict:
    """
    Fetch ads from Meta + Apify, enrich with Gemini. Returns dict with 'ads' key.
    When facebook_page_id is set (from Ads Library URL view_all_page_id=...), fetch only that page's ads.
    When facebook_handle is set (no page_id), Meta search uses @handle. Filter keeps domain or handle in creatives.
    """
    meta_fetch = _load_meta_ads_fetch()
    use_temp = out_dir is None
    if use_temp:
        tmpdir = tempfile.mkdtemp(prefix="dvyb_fetch_")
        out_dir = Path(tmpdir)
    try:
        exclude_set = set(exclude_meta_ad_ids or [])
        search_page_ids = None
        meta_keywords = [brand_domain]
        meta_search_type = "KEYWORD_UNORDERED"
        filter_domain = brand_domain.strip() if brand_domain and str(brand_domain).strip() else None
        filter_handle = None  # set when we have a handle; filter uses exact match (± @)
        if facebook_page_id and str(facebook_page_id).strip().replace(" ", "").isdigit():
            # User provided page ID from Ads Library URL (view_all_page_id=...) – fetch only that page's ads.
            search_page_ids = [int(str(facebook_page_id).strip().replace(" ", ""))]
            print(f"   Using Facebook Page ID from request: {search_page_ids[0]} (fetching only that page's ads).")
            meta_keywords = []
            if facebook_handle and str(facebook_handle).strip():
                filter_handle = str(facebook_handle).strip().lstrip("@")
        elif facebook_handle and str(facebook_handle).strip():
            filter_handle = str(facebook_handle).strip().lstrip("@")
            # Try resolve handle -> page_id; else keyword search with @handle.
            page_id_str = meta_fetch.resolve_facebook_handle_to_page_id(meta_token, filter_handle)
            if page_id_str and page_id_str.isdigit():
                search_page_ids = [int(page_id_str)]
                meta_keywords = []
                print(f"   Using resolved page_id={page_id_str} for handle '@{filter_handle}'.")
            else:
                meta_keywords = [f"@{filter_handle}"]
                meta_search_type = "KEYWORD_UNORDERED"
                print(f"   Using keyword search with @{filter_handle} (page_id not resolved or not provided).")
        else:
            print(f"   Using keyword search with domain: {brand_domain} (no Facebook handle or Page ID).")
        # Skip keyword filter only when user explicitly provided a Page ID (Ads Library URL). When domain or
        # FB handle is used (even if handle resolved to page_id), keep keyword filter for sanitised data.
        explicit_page_id = bool(facebook_page_id and str(facebook_page_id).strip().replace(" ", "").isdigit())
        use_keyword_filter = not no_keyword_filter and not explicit_page_id
        _, meta_path, apify_path = meta_fetch.run_fetch(
            output=out_dir,
            keywords=meta_keywords,
            country=country,
            limit=limit,
            exclude_meta_ad_ids=exclude_set,
            max_ads_to_save=20,
            media=media,
            meta_token=meta_token,
            apify_token=apify_token,
            creatives_from="apify-snapshot",
            recent=True,
            download_media=download_media,
            keyword_filter=use_keyword_filter,
            meta_search_type=meta_search_type,
            search_page_ids=search_page_ids,
            filter_domain=filter_domain if use_keyword_filter else None,
            filter_handle=filter_handle if use_keyword_filter else None,
        )
        enrich_filter_kw = [brand_domain] if filter_domain else []
        if filter_handle:
            enrich_filter_kw.append(filter_handle)
        out_data = enrich_ads_with_gemini(
            meta_path,
            None,  # no file output
            apify_results_path=apify_path,
            search_brand=brand_domain,
            keywords=enrich_filter_kw,
            keyword_filter=use_keyword_filter,
            local_limit=local_limit,
            global_limit=global_limit,
            media=media,
        )
        return out_data
    finally:
        if use_temp and out_dir and out_dir.exists():
            import shutil
            shutil.rmtree(out_dir, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Single script: fetch competitor ads from Meta + Apify, enrich with Gemini (category + similar competitors), output UI-ready JSON"
    )
    # Full flow: fetch + enrich
    parser.add_argument("-k", "--keywords", nargs="+", help="Search keywords (e.g. nike.com)")
    parser.add_argument("-o", "--output", type=Path, help="Output directory")
    parser.add_argument("--meta-token", help="Meta Graph API access token")
    parser.add_argument("-t", "--token", help="Apify API token (required for apify/apify-snapshot)")
    parser.add_argument("-c", "--country", default="US", help="Country code (default: US)")
    parser.add_argument("-l", "--limit", type=int, default=20, help="Max ads from Meta (default: 20)")
    parser.add_argument("-m", "--media", choices=["image", "video", "both"], default="both")
    parser.add_argument(
        "--creatives-from",
        choices=["snapshot", "apify", "apify-snapshot"],
        default="apify-snapshot",
        help="How to get creatives (default: apify-snapshot)",
    )
    parser.add_argument(
        "-r",
        "--recent",
        action="store_true",
        default=False,
        help="Filter to 3 buckets: (1) running >15d, (2) stopped in last 15d+ran long, (3) any running ad. Default: off (show all ads).",
    )
    parser.add_argument("--min-running-days", type=int, default=15, help="Min days for long-running (default: 15)")
    parser.add_argument("--stopped-within-days", type=int, default=15, help="Bucket 2: stopped within X days (default: 15)")
    parser.add_argument(
        "--ad-active-status",
        choices=["ACTIVE", "INACTIVE", "ALL"],
        default="ACTIVE",
        help="Meta API: ACTIVE (default), INACTIVE, or ALL. ACTIVE = only ads eligible for delivery.",
    )
    parser.add_argument(
        "--delivery-date-min-days",
        type=int,
        default=None,
        metavar="N",
        help="Meta API recency: only ads delivered in last N days.",
    )
    parser.add_argument(
        "--delivery-date-min",
        default=None,
        metavar="YYYY-MM-DD",
        help="Meta API: only ads delivered on/after this date.",
    )
    parser.add_argument(
        "--no-keyword-filter",
        action="store_true",
        help="Skip keyword filter. Use when Meta returns ads but keyword filter gives 0 (e.g. flipkart.com not in link_captions/titles).",
    )
    parser.add_argument("--no-download-media", action="store_true", help="Skip downloading creatives")
    parser.add_argument("--local", type=int, default=5, help="Local competitors per brand (same region, default: 5)")
    parser.add_argument("--global", dest="global_count", type=int, default=2, help="Global competitors per brand (default: 2)")
    # DVYB brands: callback to TypeScript backend when done
    parser.add_argument("--brand-id", type=int, default=None, help="Brand ID for callback (dvyb_brands)")
    parser.add_argument("--callback-url", default=None, help="POST enriched ads JSON to this URL when done")
    # Legacy modes
    parser.add_argument("brand", nargs="?", help="Brand domain for competitor analysis (e.g. thedropdate.com)")
    parser.add_argument("--enrich-ads", metavar="DIR", help="Enrich existing meta_ads.json in directory")
    args = parser.parse_args()

    # Tokens: prefer CLI args, fall back to env (from python-ai-backend .env)
    meta_token = (args.meta_token or os.getenv("META_AD_LIBRARY_ACCESS_TOKEN") or "").strip()
    apify_token = (args.token or os.getenv("APIFY_TOKEN") or "").strip()

    # Full flow: fetch ads + enrich with Gemini
    if args.keywords and args.output and meta_token:
        if not gemini_api_key:
            print("❌ Error: GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY not set in python-ai-backend .env!")
            exit(1)
        if args.creatives_from in ("apify", "apify-snapshot") and not apify_token:
            print("❌ Error: APIFY_TOKEN required in python-ai-backend .env when --creatives-from=apify or apify-snapshot")
            exit(1)
        ad_delivery_date_min = args.delivery_date_min
        if ad_delivery_date_min is None and args.delivery_date_min_days is not None:
            d = (datetime.now(timezone.utc) - timedelta(days=args.delivery_date_min_days)).date()
            ad_delivery_date_min = d.isoformat()
        print("=== Step 1: Fetch ads from Meta + Apify ===\n")
        meta_fetch = _load_meta_ads_fetch()
        out_dir, meta_path, apify_path = meta_fetch.run_fetch(
            output=args.output,
            keywords=args.keywords,
            country=args.country,
            limit=args.limit,
            media=args.media,
            meta_token=meta_token,
            apify_token=apify_token,
            creatives_from=args.creatives_from,
            recent=args.recent,
            download_media=not args.no_download_media,
            min_running_days=args.min_running_days,
            stopped_within_days=args.stopped_within_days,
            ad_active_status=args.ad_active_status,
            ad_delivery_date_min=ad_delivery_date_min,
            keyword_filter=not args.no_keyword_filter,
        )
        print("\n=== Step 2: Enrich with Gemini (category + similar competitors) ===\n")
        output_json = out_dir / "ads_ui_enriched.json"
        out_data = enrich_ads_with_gemini(
            meta_path,
            output_json,
            apify_results_path=apify_path,
            search_brand=args.keywords[0] if args.keywords else None,
            keywords=args.keywords,
            keyword_filter=not args.no_keyword_filter,
            local_limit=args.local,
            global_limit=args.global_count,
        )
        print(f"\n✅ Done. Output in {out_dir}")

        # DVYB: POST to callback URL if provided (use in-memory data)
        if args.callback_url and args.callback_url.strip():
            try:
                payload = out_data
                req = urllib.request.Request(
                    args.callback_url.strip(),
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    if resp.status in (200, 201, 204):
                        print(f"   Callback OK: {args.callback_url}")
                    else:
                        print(f"   Callback returned {resp.status}")
            except Exception as e:
                print(f"   Callback failed: {e}")
        exit(0)

    # Enrich existing meta_ads.json
    if args.enrich_ads:
        if not gemini_api_key:
            print("❌ Error: GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY not set!")
            exit(1)
        dir_path = Path(args.enrich_ads)
        meta_path = dir_path / "meta_ads.json"
        apify_path = dir_path / "apify_results.json"
        if not meta_path.exists():
            print(f"❌ Error: {meta_path} not found")
            exit(1)
        enrich_ads_with_gemini(
            meta_path,
            dir_path / "ads_ui_enriched.json",
            apify_results_path=apify_path if apify_path.exists() else None,
            search_brand=args.keywords[0] if args.keywords else None,
            keywords=args.keywords,
            keyword_filter=not args.no_keyword_filter,
            local_limit=args.local,
            global_limit=args.global_count,
        )
        exit(0)

    # Brand competitor analysis (legacy)
    if args.brand:
        if not gemini_api_key:
            print("❌ Error: GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY not set!")
            exit(1)
        get_competitor_json(args.brand, local_limit=args.local, global_limit=args.global_count)
        exit(0)

    parser.print_help()
    print("\nExamples:")
    print("  # Full flow: fetch ads + enrich (single command)")
    print("  python gemini_competitor_analysis.py -k nike.com -o ~/Downloads/meta_creatives \\")
    print("    --meta-token META_TOKEN -t APIFY_TOKEN --creatives-from apify-snapshot")
    print("  # Brand competitor analysis only")
    print("  python gemini_competitor_analysis.py thedropdate.com")
    print("  # Enrich existing meta_ads.json")
    print("  python gemini_competitor_analysis.py --enrich-ads ~/Downloads/meta_creatives")
    exit(1)
