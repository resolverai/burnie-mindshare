#!/usr/bin/env python3
"""
Instagram Creator Sourcer
=========================
Automated pipeline to find micro-creators (1K-10K followers) in the
Meta/Facebook ads, DTC/Shopify, and marketing tools niche on Instagram.

Uses:
  - Apify (apify/instagram-hashtag-scraper) for hashtag & keyword collection
  - Apify (apify/instagram-profile-scraper)  for profile enrichment
  - OpenAI GPT-4o for LLM-based relevance scoring

Engines:
  1. Hashtag Cluster Mining
  2. Search Phrase Deep Dive (keyword mode)
  4. Affiliate-Mindset Mining (keyword mode)

Dependencies:
  pip install apify-client openai python-dotenv

Usage:
  python instagram_creator_sourcer.py --target 50
  python instagram_creator_sourcer.py --target 1000
  python instagram_creator_sourcer.py --target 50 --resume
  python instagram_creator_sourcer.py --target 50 --skip-gpt
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

APIFY_TOKEN = os.getenv("APIFY_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# ---------------------------------------------------------------------------
# Search Configuration
# ---------------------------------------------------------------------------
HASHTAGS = [
    "metaads",
    "facebookads",
    "adcreative",
    "creativetesting",
    "ugcads",
    "shopifytips",
    "dtcbrand",
    "marketingtools",
    "aimarketing",
    "adlibrary",
    "paidmedia",
    "facebookadstips",
]

SEARCH_KEYWORDS = [
    "meta ads breakdown",
    "creative testing strategy",
    "how I test ads",
    "winning ads 2025",
    "ad library hack",
    "ugc ads tutorial",
    "facebook ads tutorial",
    "shopify marketing tips",
]

AFFILIATE_KEYWORDS = [
    "canva affiliate",
    "jasper ai review",
    "clickfunnels review",
    "best ai marketing tools",
    "chrome extensions for marketers",
    "marketing tool review",
    "saas tool review marketing",
]

# ---------------------------------------------------------------------------
# Filtering Defaults
# ---------------------------------------------------------------------------
MIN_FOLLOWERS = 1_000
MAX_FOLLOWERS = 10_000
GPT_SCORE_THRESHOLD = 60
GPT_BATCH_SIZE = 10

OUTPUT_DIR = Path(__file__).parent / "output" / "instagram_sourcer"


# ===================================================================
# Helpers
# ===================================================================

def _check_dependencies():
    """Verify required packages are installed."""
    missing = []
    try:
        import apify_client  # noqa: F401
    except ImportError:
        missing.append("apify-client")
    try:
        import openai  # noqa: F401
    except ImportError:
        missing.append("openai")
    if missing:
        print(f"ERROR: Missing packages: {', '.join(missing)}")
        print(f"  pip install {' '.join(missing)}")
        sys.exit(1)


def save_json(data, filename: str):
    """Save intermediate data to JSON in the output directory."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / filename

    def _default(obj):
        if isinstance(obj, set):
            return list(obj)
        raise TypeError(f"Not serializable: {type(obj)}")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=_default)
    print(f"[SAVE] {filename} → {path}")


def load_json(filename: str):
    """Load intermediate JSON if it exists, else None."""
    path = OUTPUT_DIR / filename
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


# ===================================================================
# Apify helpers
# ===================================================================

def run_apify_actor(actor_id: str, run_input: dict, description: str,
                    timeout_secs: int = 600,
                    max_items: int | None = None) -> list[dict]:
    """Run an Apify actor and return dataset items.

    max_items: Platform-level cap on total dataset items.  This is the
    reliable way to limit pay-per-event actors like instagram-hashtag-scraper
    (their input schemas don't always expose a per-query limit).
    """
    from apify_client import ApifyClient

    print(f"\n{'='*60}")
    print(f"[APIFY] {description}")
    print(f"[APIFY] Actor: {actor_id}")
    if max_items is not None:
        print(f"[APIFY] max_items (platform cap): {max_items}")
    for k, v in run_input.items():
        if isinstance(v, list) and len(v) <= 15:
            print(f"  {k}: {v}")
        elif isinstance(v, list):
            print(f"  {k}: [{len(v)} items]")
        else:
            print(f"  {k}: {v}")
    print(f"{'='*60}")

    client = ApifyClient(APIFY_TOKEN)
    start = time.time()

    call_kwargs: dict = {
        "run_input": run_input,
        "timeout_secs": timeout_secs,
    }
    if max_items is not None:
        call_kwargs["max_items"] = max_items

    try:
        run = client.actor(actor_id).call(**call_kwargs)
    except Exception as e:
        print(f"[APIFY] Actor call FAILED: {e}")
        return []

    elapsed = time.time() - start
    dataset_id = run["defaultDatasetId"]
    print(f"[APIFY] Completed in {elapsed:.1f}s  |  dataset: {dataset_id}")

    items = list(client.dataset(dataset_id).iterate_items())
    print(f"[APIFY] Returned {len(items)} items")
    return items


# ===================================================================
# Post / author extraction from hashtag scraper
# ===================================================================

def extract_username_from_post(post: dict) -> dict | None:
    """
    Pull author username + post stats from an Instagram hashtag scraper result.
    The hashtag scraper returns posts, NOT full profiles — so we only get username,
    not follower count. Enrichment is always needed.
    """
    username = (
        post.get("ownerUsername")
        or post.get("owner_username")
        or post.get("username")
        or ""
    ).strip().lower()

    if not username:
        return None

    author: dict = {
        "handle": username,
        "full_name": post.get("ownerFullName") or post.get("owner_full_name") or "",
        "owner_id": post.get("ownerId") or post.get("owner_id") or "",
        "profile_url": f"https://www.instagram.com/{username}/",
        "follower_count": None,
        "bio": "",
        "external_url": "",
        "is_business": None,
        "business_category": "",
        "verified": None,
    }

    # Capture post-level stats for engagement estimation
    video_play = post.get("videoPlayCount") or post.get("igPlayCount") or 0
    post_data = {
        "caption": (post.get("caption") or "")[:500],
        "likes": post.get("likesCount") or 0,
        "comments": post.get("commentsCount") or 0,
        "plays": video_play,
        "url": post.get("url") or "",
        "timestamp": post.get("timestamp") or "",
        "type": post.get("type") or post.get("productType") or "",
        "hashtags": post.get("hashtags") or [],
    }

    author["posts"] = [post_data]
    return author


def extract_profile_data(profile: dict) -> dict | None:
    """
    Extract structured creator data from an Instagram profile scraper result.
    The profile scraper returns rich data including followers, bio, posts.
    """
    username = (
        profile.get("username")
        or profile.get("handle")
        or ""
    ).strip().lower()

    if not username:
        return None

    author: dict = {
        "handle": username,
        "full_name": profile.get("fullName") or profile.get("full_name") or "",
        "owner_id": profile.get("id") or "",
        "profile_url": profile.get("url") or f"https://www.instagram.com/{username}/",
        "follower_count": profile.get("followersCount") or profile.get("followers_count"),
        "following_count": profile.get("followsCount") or profile.get("follows_count"),
        "posts_count": profile.get("postsCount") or profile.get("posts_count"),
        "bio": profile.get("biography") or profile.get("bio") or "",
        "external_url": profile.get("externalUrl") or "",
        "is_business": profile.get("isBusinessAccount"),
        "business_category": profile.get("businessCategoryName") or "",
        "verified": profile.get("verified"),
        "private": profile.get("private", False),
        "profile_pic": profile.get("profilePicUrl") or "",
    }

    # Extract external URLs list
    ext_urls = profile.get("externalUrls") or []
    if ext_urls and isinstance(ext_urls, list):
        author["external_urls"] = [
            u.get("url") or u.get("title") or ""
            for u in ext_urls if isinstance(u, dict)
        ]

    # Extract latest posts for engagement calculation
    latest = profile.get("latestPosts") or profile.get("latest_posts") or []
    posts = []
    for p in latest[:10]:
        if not isinstance(p, dict):
            continue
        posts.append({
            "caption": (p.get("caption") or "")[:500],
            "likes": p.get("likesCount") or 0,
            "comments": p.get("commentsCount") or 0,
            "plays": p.get("videoPlayCount") or p.get("videoViewCount") or 0,
            "url": p.get("url") or "",
            "timestamp": p.get("timestamp") or "",
            "type": p.get("type") or p.get("productType") or "",
            "hashtags": p.get("hashtags") or [],
        })

    author["posts"] = posts

    # Related profiles (useful for future expansion)
    related = profile.get("relatedProfiles") or []
    author["related_profiles"] = [
        r.get("username") for r in related
        if isinstance(r, dict) and r.get("username")
    ]

    return author


def merge_authors(existing: dict, new: dict) -> dict:
    """Merge new author data into existing, combining post lists."""
    merged = {**existing}

    for key in ("follower_count", "following_count", "posts_count", "bio",
                "external_url", "is_business", "business_category", "verified",
                "full_name", "profile_pic", "private", "external_urls",
                "related_profiles"):
        if new.get(key) and not existing.get(key):
            merged[key] = new[key]

    existing_urls = {p.get("url") for p in existing.get("posts", []) if p.get("url")}
    for p in new.get("posts", []):
        if p.get("url") and p["url"] not in existing_urls:
            merged.setdefault("posts", []).append(p)
            existing_urls.add(p["url"])

    return merged


def calculate_engagement(author: dict) -> dict:
    """Compute avg_likes, avg_comments, engagement_estimate from posts."""
    posts = author.get("posts") or []
    recent = posts[:5]

    if not recent:
        author["avg_likes"] = 0
        author["avg_comments"] = 0
        author["engagement_estimate"] = 0.0
        return author

    total_likes = sum(p.get("likes", 0) for p in recent)
    total_comments = sum(p.get("comments", 0) for p in recent)

    author["avg_likes"] = round(total_likes / len(recent))
    author["avg_comments"] = round(total_comments / len(recent))

    followers = author.get("follower_count") or 0
    if followers > 0:
        avg_engagement = (total_likes + total_comments) / len(recent)
        author["engagement_estimate"] = round(avg_engagement / followers, 4)
    else:
        author["engagement_estimate"] = 0.0

    return author


def extract_email_from_bio(bio: str) -> str:
    """Best-effort email extraction from bio text."""
    if not bio:
        return ""
    matches = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", bio)
    return matches[0] if matches else ""


# ===================================================================
# PHASE 1 — Collection
# ===================================================================

def phase1_collect(target: int, multiplier: int) -> dict[str, dict]:
    """
    Run Engines 1, 2, 4 via Apify Instagram Hashtag Scraper.
    Returns {handle: author_dict}.
    """
    total_raw = target * multiplier
    hashtag_total = max(50, int(total_raw * 0.40))
    search_total = max(30, int(total_raw * 0.30))
    affiliate_total = max(30, int(total_raw * 0.30))

    print(f"\n[PHASE 1] Plan: {hashtag_total} items from hashtags  |  "
          f"{search_total} items from search  |  "
          f"{affiliate_total} items from affiliate")

    authors: dict[str, dict] = {}

    def _ingest(items: list[dict], source_tag: str):
        for post in items:
            a = extract_username_from_post(post)
            if not a:
                continue
            handle = a["handle"]
            if handle in authors:
                authors[handle] = merge_authors(authors[handle], a)
                authors[handle].setdefault("sources", [])
                if source_tag not in authors[handle]["sources"]:
                    authors[handle]["sources"].append(source_tag)
            else:
                a["sources"] = [source_tag]
                authors[handle] = a

    # --- Engine 1: Hashtag Mining ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 1: HASHTAG CLUSTER MINING  ({len(HASHTAGS)} tags, max {hashtag_total} total items)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apify/instagram-hashtag-scraper", {
            "hashtags": HASHTAGS,
        }, f"Hashtag mining: {len(HASHTAGS)} tags (cap {hashtag_total} items)",
            max_items=hashtag_total)
        _ingest(items, "hashtag")
        print(f"[ENGINE 1] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 1] FAILED: {e}")

    # --- Engine 2: Search Keyword Deep Dive ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 2: KEYWORD DEEP DIVE  ({len(SEARCH_KEYWORDS)} keywords, max {search_total} total items)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apify/instagram-hashtag-scraper", {
            "hashtags": SEARCH_KEYWORDS,
        }, f"Keyword search: {len(SEARCH_KEYWORDS)} queries (cap {search_total} items)",
            max_items=search_total)
        _ingest(items, "search")
        print(f"[ENGINE 2] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 2] FAILED: {e}")

    # --- Engine 4: Affiliate-Mindset Mining ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 4: AFFILIATE-MINDSET MINING  ({len(AFFILIATE_KEYWORDS)} keywords, max {affiliate_total} total items)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apify/instagram-hashtag-scraper", {
            "hashtags": AFFILIATE_KEYWORDS,
        }, f"Affiliate keywords: {len(AFFILIATE_KEYWORDS)} queries (cap {affiliate_total} items)",
            max_items=affiliate_total)
        _ingest(items, "affiliate")
        print(f"[ENGINE 4] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 4] FAILED: {e}")

    print(f"\n{'='*60}")
    print(f"[PHASE 1 DONE] Total unique authors collected: {len(authors)}")
    print(f"{'='*60}")

    return authors


# ===================================================================
# PHASE 2 — Profile Enrichment & Filtering
# ===================================================================

def phase2_enrich(authors: dict[str, dict], target: int) -> list[dict]:
    """
    Enrich all discovered profiles via apify/instagram-profile-scraper,
    then filter to 1K-10K followers and calculate engagement.
    """
    handles = list(authors.keys())
    max_to_enrich = min(len(handles), target * 5)
    to_enrich = handles[:max_to_enrich]

    print(f"\n[PHASE 2] Enriching {len(to_enrich)} profiles via Instagram Profile Scraper...")

    enriched_profiles: dict[str, dict] = {}
    batch_size = 20
    skipped_outside_range = 0
    skipped_private = 0

    for i in range(0, len(to_enrich), batch_size):
        batch = to_enrich[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(to_enrich) + batch_size - 1) // batch_size

        print(f"\n[ENRICH] Batch {batch_num}/{total_batches}  ({len(batch)} profiles)")

        try:
            items = run_apify_actor("apify/instagram-profile-scraper", {
                "usernames": batch,
            }, f"Profile enrichment batch {batch_num}/{total_batches}")

            for profile in items:
                enriched = extract_profile_data(profile)
                if not enriched:
                    continue

                handle = enriched["handle"]

                # Skip private accounts
                if enriched.get("private"):
                    skipped_private += 1
                    continue

                # Merge with Phase 1 data
                if handle in authors:
                    enriched = merge_authors(authors[handle], enriched)
                    enriched["sources"] = authors[handle].get("sources", [])

                fc = enriched.get("follower_count")
                if fc is not None:
                    if MIN_FOLLOWERS <= fc <= MAX_FOLLOWERS:
                        enriched_profiles[handle] = enriched
                    else:
                        skipped_outside_range += 1
                else:
                    # No follower data — include but flag
                    enriched_profiles[handle] = enriched

            print(f"[ENRICH] Batch done. Qualified so far: {len(enriched_profiles)}")

        except Exception as e:
            print(f"[ENRICH] Batch {batch_num} FAILED: {e}")

    # Calculate engagement for every passed creator
    result = []
    for handle, a in enriched_profiles.items():
        a = calculate_engagement(a)
        result.append(a)

    result.sort(key=lambda x: x.get("engagement_estimate", 0), reverse=True)

    print(f"\n{'='*60}")
    print(f"[PHASE 2 DONE]")
    print(f"  Profiles enriched       : {len(to_enrich)}")
    print(f"  Passed follower filter  : {len(enriched_profiles)}")
    print(f"  Skipped (outside range) : {skipped_outside_range}")
    print(f"  Skipped (private)       : {skipped_private}")
    print(f"{'='*60}")

    for c in result[:10]:
        fc = c.get("follower_count", "?")
        er = c.get("engagement_estimate", "?")
        print(f"  @{c['handle']:25s}  followers={str(fc):>8}  "
              f"engagement={str(er):>8}  sources={c.get('sources', [])}")

    return result


# ===================================================================
# PHASE 3 — GPT-4o Scoring
# ===================================================================

GPT_SYSTEM_PROMPT = """You are a creator relevance classifier for a marketing tool affiliate program.

For each Instagram creator, score them 0-100 based on:
1. Do they consistently create content about Meta/Facebook ads, ad creatives, DTC/Shopify growth, marketing tools, creative testing, UGC ads, or ad libraries?
2. Are they a genuine micro-expert (not generic motivational, dropshipping spam, or low-signal)?
3. Would they likely promote a marketing/ad-related SaaS tool as an affiliate?
4. Quality signals: real engagement, consistent niche focus, educational value.

Scoring guide:
  80-100  Perfect fit — clearly creates niche ad/marketing content consistently.
  60-79   Good fit — mostly niche, some general posts mixed in.
  40-59   Marginal — some relevant content but not consistent.
  0-39    Poor fit — generic, spam, or unrelated.

Respond with ONLY valid JSON in this exact structure:
{
  "results": [
    {"index": 0, "score": 85, "niche_category": "Meta Ads Expert", "reasoning": "..."},
    ...
  ]
}

Niche categories (pick one):
  "Meta Ads Expert", "Ad Creative Specialist", "DTC/Shopify Growth",
  "Marketing Tools Reviewer", "UGC Ads Creator", "Creative Testing",
  "General Marketing", "Not Relevant"
"""


def phase3_gpt_score(candidates: list[dict]) -> list[dict]:
    """Score each candidate with GPT-4o. Returns list with score fields added."""
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)
    scored: list[dict] = []
    total_batches = (len(candidates) + GPT_BATCH_SIZE - 1) // GPT_BATCH_SIZE

    for i in range(0, len(candidates), GPT_BATCH_SIZE):
        batch = candidates[i : i + GPT_BATCH_SIZE]
        batch_num = (i // GPT_BATCH_SIZE) + 1

        print(f"\n[GPT-4o] Batch {batch_num}/{total_batches}  ({len(batch)} creators)")

        summaries = []
        for j, c in enumerate(batch):
            post_captions = [p.get("caption", "")[:200] for p in c.get("posts", [])[:5]]
            post_hashtags = []
            for p in c.get("posts", [])[:5]:
                post_hashtags.extend(p.get("hashtags", []))

            summaries.append({
                "index": j,
                "handle": c.get("handle", ""),
                "bio": (c.get("bio") or "")[:300],
                "external_url": c.get("external_url") or "",
                "follower_count": c.get("follower_count", "unknown"),
                "is_business": c.get("is_business"),
                "business_category": c.get("business_category", ""),
                "avg_likes": c.get("avg_likes", 0),
                "avg_comments": c.get("avg_comments", 0),
                "engagement_rate": c.get("engagement_estimate", 0),
                "recent_post_captions": post_captions,
                "hashtags_used": list(set(post_hashtags))[:20],
                "sources_found_via": c.get("sources", []),
            })

        try:
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": GPT_SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(summaries, ensure_ascii=False)},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            )

            raw = json.loads(resp.choices[0].message.content)

            scores_list = []
            if isinstance(raw, dict):
                for v in raw.values():
                    if isinstance(v, list):
                        scores_list = v
                        break
            elif isinstance(raw, list):
                scores_list = raw

            mapped = 0
            for entry in scores_list:
                idx = entry.get("index", -1)
                if 0 <= idx < len(batch):
                    creator = batch[idx].copy()
                    creator["priority_score"] = entry.get("score", 0)
                    creator["niche_category"] = entry.get("niche_category", "Unknown")
                    creator["gpt_reasoning"] = entry.get("reasoning", "")
                    scored.append(creator)
                    mapped += 1

                    emoji = "+" if creator["priority_score"] >= GPT_SCORE_THRESHOLD else "-"
                    print(f"  [{emoji}] @{creator['handle']:25s}  "
                          f"score={creator['priority_score']:>3}  "
                          f"cat={creator['niche_category']}")

            scored_indices = {e.get("index") for e in scores_list}
            for j, c in enumerate(batch):
                if j not in scored_indices:
                    c_copy = c.copy()
                    c_copy["priority_score"] = 0
                    c_copy["niche_category"] = "Parse Error"
                    c_copy["gpt_reasoning"] = "Index not returned by GPT"
                    scored.append(c_copy)

            print(f"  -> mapped {mapped}/{len(batch)}")

        except Exception as e:
            print(f"[GPT-4o] Batch {batch_num} FAILED: {e}")
            for c in batch:
                c_copy = c.copy()
                c_copy["priority_score"] = 0
                c_copy["niche_category"] = "Error"
                c_copy["gpt_reasoning"] = f"GPT call failed: {e}"
                scored.append(c_copy)

    return scored


# ===================================================================
# PHASE 4 — Export CSV
# ===================================================================

CSV_FIELDS = [
    "handle",
    "follower_count",
    "avg_likes",
    "avg_comments",
    "engagement_estimate",
    "email",
    "niche_category",
    "priority_score",
    "outreach_status",
    "profile_url",
    "bio",
    "external_url",
    "is_business",
    "business_category",
    "verified",
    "gpt_reasoning",
    "sources",
]


def phase4_export(creators: list[dict], csv_path: Path):
    """Write the final CSV."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()

        for c in creators:
            bio = c.get("bio") or ""
            writer.writerow({
                "handle": c.get("handle", ""),
                "follower_count": c.get("follower_count", ""),
                "avg_likes": c.get("avg_likes", ""),
                "avg_comments": c.get("avg_comments", ""),
                "engagement_estimate": c.get("engagement_estimate", ""),
                "email": extract_email_from_bio(bio),
                "niche_category": c.get("niche_category", ""),
                "priority_score": c.get("priority_score", ""),
                "outreach_status": "not_contacted",
                "profile_url": c.get("profile_url", ""),
                "bio": bio,
                "external_url": c.get("external_url", ""),
                "is_business": c.get("is_business", ""),
                "business_category": c.get("business_category", ""),
                "verified": c.get("verified", ""),
                "gpt_reasoning": c.get("gpt_reasoning", ""),
                "sources": ", ".join(c.get("sources", [])),
            })

    print(f"\n[EXPORT] CSV saved: {csv_path}")
    print(f"[EXPORT] Rows: {len(creators)}")


# ===================================================================
# Main
# ===================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Instagram Creator Sourcer — find micro-creators in the ad/marketing niche"
    )
    parser.add_argument(
        "--target", type=int, default=50,
        help="Target number of qualified creators (default: 50)",
    )
    parser.add_argument(
        "--multiplier", type=int, default=6,
        help="Raw-results multiplier to overshoot target (default: 6)",
    )
    parser.add_argument(
        "--gpt-threshold", type=int, default=GPT_SCORE_THRESHOLD,
        help=f"Min GPT relevance score to include (default: {GPT_SCORE_THRESHOLD})",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from previously saved intermediate JSON files",
    )
    parser.add_argument(
        "--skip-gpt", action="store_true",
        help="Skip GPT-4o scoring (useful for dry-run / inspecting raw data)",
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output CSV file path (default: output/instagram_sourcer/instagram_creators_<timestamp>.csv)",
    )
    args = parser.parse_args()

    target = args.target
    gpt_threshold = args.gpt_threshold

    print(f"\n{'='*60}")
    print(f"  INSTAGRAM CREATOR SOURCER")
    print(f"{'='*60}")
    print(f"  Target creators   : {target}")
    print(f"  Follower range    : {MIN_FOLLOWERS:,} - {MAX_FOLLOWERS:,}")
    print(f"  GPT threshold     : {gpt_threshold}")
    print(f"  Raw multiplier    : {args.multiplier}")
    print(f"  Resume            : {args.resume}")
    print(f"  Skip GPT          : {args.skip_gpt}")
    print(f"  Output CSV        : {args.output or '<auto>'}")
    print(f"  Output dir        : {OUTPUT_DIR}")
    print(f"  Timestamp         : {datetime.now().isoformat()}")
    print(f"{'='*60}\n")

    _check_dependencies()

    if not APIFY_TOKEN:
        print("ERROR: APIFY_TOKEN not found in .env")
        sys.exit(1)
    if not args.skip_gpt and not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not found in .env (use --skip-gpt to bypass)")
        sys.exit(1)

    print(f"[OK] APIFY_TOKEN  : {APIFY_TOKEN[:12]}...")
    if OPENAI_API_KEY:
        print(f"[OK] OPENAI_API_KEY: {OPENAI_API_KEY[:12]}...")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # PHASE 1 — Collection
    # ------------------------------------------------------------------
    print(f"\n{'*'*60}")
    print(f"  PHASE 1: COLLECTION (Apify Instagram Hashtag Scraper)")
    print(f"{'*'*60}")

    authors = None
    if args.resume:
        authors = load_json("phase1_authors.json")
        if authors:
            print(f"[RESUME] Loaded {len(authors)} authors from phase1_authors.json")

    if authors is None:
        authors = phase1_collect(target, args.multiplier)
        save_json(authors, "phase1_authors.json")

    if not authors:
        print("\nERROR: No authors found in Phase 1. Check Apify logs / input.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # PHASE 2 — Profile Enrichment & Follower Filtering
    # ------------------------------------------------------------------
    print(f"\n{'*'*60}")
    print(f"  PHASE 2: PROFILE ENRICHMENT & FILTERING")
    print(f"{'*'*60}")

    enriched = None
    if args.resume:
        enriched = load_json("phase2_enriched.json")
        if enriched:
            print(f"[RESUME] Loaded {len(enriched)} enriched candidates from phase2_enriched.json")

    if enriched is None:
        enriched = phase2_enrich(authors, target)
        save_json(enriched, "phase2_enriched.json")

    if not enriched:
        print("\nWARNING: No candidates passed enrichment/follower filter.")
        print("Falling back: including ALL Phase 1 authors for GPT scoring...\n")
        enriched = []
        for handle, a in authors.items():
            a = calculate_engagement(a)
            enriched.append(a)
        save_json(enriched, "phase2_enriched.json")

    # ------------------------------------------------------------------
    # PHASE 3 — GPT-4o Scoring
    # ------------------------------------------------------------------
    if args.skip_gpt:
        print(f"\n{'*'*60}")
        print(f"  PHASE 3: SKIPPED (--skip-gpt)")
        print(f"{'*'*60}")
        for c in enriched:
            c.setdefault("priority_score", 50)
            c.setdefault("niche_category", "Unscored")
            c.setdefault("gpt_reasoning", "GPT scoring skipped")
        final = enriched[:target]
    else:
        print(f"\n{'*'*60}")
        print(f"  PHASE 3: GPT-4o RELEVANCE SCORING")
        print(f"{'*'*60}")

        scored = None
        if args.resume:
            scored = load_json("phase3_scored.json")
            if scored:
                print(f"[RESUME] Loaded {len(scored)} scored creators from phase3_scored.json")

        if scored is None:
            scored = phase3_gpt_score(enriched)
            save_json(scored, "phase3_scored.json")

        qualified = [c for c in scored if c.get("priority_score", 0) >= gpt_threshold]
        qualified.sort(key=lambda c: c.get("priority_score", 0), reverse=True)
        final = qualified[:target]

        print(f"\n[PHASE 3 DONE]")
        print(f"  Total scored        : {len(scored)}")
        print(f"  Above threshold ({gpt_threshold}) : {len(qualified)}")
        print(f"  Final selection     : {len(final)}")

    # ------------------------------------------------------------------
    # PHASE 4 — Export
    # ------------------------------------------------------------------
    print(f"\n{'*'*60}")
    print(f"  PHASE 4: EXPORT")
    print(f"{'*'*60}")

    if args.output:
        csv_path = Path(args.output).resolve()
    else:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = OUTPUT_DIR / f"instagram_creators_{ts}.csv"

    phase4_export(final, csv_path)
    save_json(final, "final_creators.json")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print(f"\n{'='*60}")
    print(f"  SOURCING COMPLETE")
    print(f"{'='*60}")
    print(f"  Target  : {target}")
    print(f"  Found   : {len(final)}")
    print(f"  CSV     : {csv_path}")

    if final:
        scores = [c.get("priority_score", 0) for c in final]
        print(f"\n  Score distribution:")
        print(f"    Avg : {sum(scores) / len(scores):.1f}")
        print(f"    Max : {max(scores)}")
        print(f"    Min : {min(scores)}")

        cats: dict[str, int] = {}
        for c in final:
            cat = c.get("niche_category", "Unknown")
            cats[cat] = cats.get(cat, 0) + 1
        print(f"\n  Niche categories:")
        for cat, cnt in sorted(cats.items(), key=lambda x: x[1], reverse=True):
            print(f"    {cat}: {cnt}")

        # Business vs personal breakdown
        biz = sum(1 for c in final if c.get("is_business"))
        print(f"\n  Business accounts: {biz}/{len(final)}")

        # Email availability
        emails = sum(1 for c in final if extract_email_from_bio(c.get("bio", "")))
        print(f"  With email in bio: {emails}/{len(final)}")

        print(f"\n  Top 10 creators:")
        for c in final[:10]:
            print(
                f"    @{c.get('handle', '?'):25s}  "
                f"score={c.get('priority_score', '?'):>3}  "
                f"followers={str(c.get('follower_count', '?')):>8}  "
                f"eng={str(c.get('engagement_estimate', '?')):>8}  "
                f"{c.get('niche_category', '')}"
            )

    print(f"\nDone!")


if __name__ == "__main__":
    main()
