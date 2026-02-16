#!/usr/bin/env python3
"""
TikTok Creator Sourcer
======================
Automated pipeline to find micro-creators (1K-10K followers) in the
Meta/Facebook ads, DTC/Shopify, and marketing tools niche on TikTok.

Uses:
  - Apify (clockworks/free-tiktok-scraper) for data collection & profile enrichment
  - OpenAI GPT-4o for LLM-based relevance scoring

Engines:
  1. Hashtag Cluster Mining
  2. Search Phrase Deep Dive
  4. Affiliate-Mindset Mining

Dependencies:
  pip install apify-client openai python-dotenv

Usage:
  python tiktok_creator_sourcer.py --target 50
  python tiktok_creator_sourcer.py --target 1000
  python tiktok_creator_sourcer.py --target 50 --resume
  python tiktok_creator_sourcer.py --target 50 --skip-gpt    # skip GPT scoring (dry run)
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
    "ugcad",
    "shopifytips",
    "dtcbrand",
    "marketingtools",
    "aiads",
    "adlibrary",
]

SEARCH_PHRASES = [
    "Meta ads breakdown",
    "Creative testing strategy",
    "How I test ads",
    "Winning ads 2025",
    "Ad library hack",
    "UGC ads tutorial",
]

AFFILIATE_PHRASES = [
    "Canva affiliate",
    "Jasper review",
    "ClickFunnels review",
    "Best AI marketing tools",
    "Chrome extensions for marketers",
]

# ---------------------------------------------------------------------------
# Filtering Defaults
# ---------------------------------------------------------------------------
MIN_FOLLOWERS = 1_000
MAX_FOLLOWERS = 10_000
GPT_SCORE_THRESHOLD = 60
GPT_BATCH_SIZE = 10

OUTPUT_DIR = Path(__file__).parent / "output" / "tiktok_sourcer"


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

def run_apify_actor(run_input: dict, description: str, timeout_secs: int = 600) -> list[dict]:
    """Run clockworks/free-tiktok-scraper and return dataset items."""
    from apify_client import ApifyClient

    print(f"\n{'='*60}")
    print(f"[APIFY] {description}")
    print(f"[APIFY] Input keys: {list(run_input.keys())}")
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

    try:
        run = client.actor("clockworks/free-tiktok-scraper").call(
            run_input=run_input,
            timeout_secs=timeout_secs,
        )
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
# Post / author extraction
# ===================================================================

def extract_author_from_post(post: dict) -> dict | None:
    """
    Pull author info + video stats from a single Apify result item.
    Handles both nested (authorMeta: {…}) and flat (authorMeta.name) formats.
    """
    author: dict = {}

    # --- Nested format ---
    if "authorMeta" in post and isinstance(post["authorMeta"], dict):
        m = post["authorMeta"]
        author["handle"] = m.get("name") or m.get("uniqueId") or ""
        author["nickname"] = m.get("nickName") or ""
        author["avatar"] = m.get("avatar") or m.get("originalAvatarUrl") or ""
        author["bio"] = m.get("signature") or ""
        author["bio_link"] = m.get("bioLink") or ""
        author["follower_count"] = m.get("fans")
        author["total_likes"] = m.get("heart")
        author["following_count"] = m.get("following")
        author["video_count"] = m.get("video")
        author["verified"] = m.get("verified", False)
        author["profile_url"] = m.get("profileUrl") or ""
    else:
        # --- Flat format ---
        author["handle"] = (
            post.get("authorMeta.name")
            or post.get("authorMeta/name")
            or post.get("author")
            or ""
        )
        author["nickname"] = post.get("authorMeta.nickName") or ""
        author["avatar"] = post.get("authorMeta.avatar") or ""
        author["bio"] = post.get("authorMeta.signature") or ""
        author["bio_link"] = post.get("authorMeta.bioLink") or ""
        author["follower_count"] = post.get("authorMeta.fans")
        author["total_likes"] = post.get("authorMeta.heart")
        author["following_count"] = post.get("authorMeta.following")
        author["video_count"] = post.get("authorMeta.video")
        author["verified"] = post.get("authorMeta.verified", False)
        author["profile_url"] = ""

    if not author["handle"]:
        return None

    if not author["profile_url"]:
        author["profile_url"] = f"https://www.tiktok.com/@{author['handle']}"

    # Video-level stats from this post
    video = {
        "text": post.get("text") or "",
        "play_count": post.get("playCount") or 0,
        "like_count": post.get("diggCount") or 0,
        "comment_count": post.get("commentCount") or 0,
        "share_count": post.get("shareCount") or 0,
        "url": post.get("webVideoUrl") or "",
        "created": post.get("createTimeISO") or "",
    }

    hashtags_raw = post.get("hashtags") or []
    if isinstance(hashtags_raw, list):
        video["hashtags"] = [
            (h.get("name") if isinstance(h, dict) else str(h))
            for h in hashtags_raw
        ]

    author["videos"] = [video]
    return author


def merge_authors(existing: dict, new: dict) -> dict:
    """Merge *new* author data into *existing*, combining video lists."""
    merged = {**existing}

    for key in ("follower_count", "total_likes", "bio", "bio_link",
                "following_count", "video_count", "avatar", "verified"):
        if new.get(key) and not existing.get(key):
            merged[key] = new[key]

    existing_urls = {v.get("url") for v in existing.get("videos", []) if v.get("url")}
    for v in new.get("videos", []):
        if v.get("url") and v["url"] not in existing_urls:
            merged.setdefault("videos", []).append(v)
            existing_urls.add(v["url"])

    return merged


def calculate_engagement(author: dict) -> dict:
    """Compute avg_views and engagement_estimate from the author's video list."""
    videos = author.get("videos") or []
    recent = videos[:5]

    if not recent:
        author["avg_views"] = 0
        author["engagement_estimate"] = 0.0
        return author

    total_views = sum(v.get("play_count", 0) for v in recent)
    total_likes = sum(v.get("like_count", 0) for v in recent)
    total_comments = sum(v.get("comment_count", 0) for v in recent)

    author["avg_views"] = round(total_views / len(recent))
    author["engagement_estimate"] = round(
        (total_likes + total_comments) / total_views, 4
    ) if total_views > 0 else 0.0
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
    Run Engines 1, 2, 4 via Apify.  Returns {handle: author_dict}.
    """
    total_raw = target * multiplier
    per_hashtag = max(5, int(total_raw * 0.40) // len(HASHTAGS))
    per_search = max(5, int(total_raw * 0.30) // len(SEARCH_PHRASES))
    per_affiliate = max(5, int(total_raw * 0.30) // len(AFFILIATE_PHRASES))

    print(f"\n[PHASE 1] Plan: {per_hashtag}/hashtag × {len(HASHTAGS)} htags  |  "
          f"{per_search}/phrase × {len(SEARCH_PHRASES)} search  |  "
          f"{per_affiliate}/phrase × {len(AFFILIATE_PHRASES)} affiliate")

    authors: dict[str, dict] = {}

    def _ingest(items: list[dict], source_tag: str):
        for post in items:
            a = extract_author_from_post(post)
            if not a:
                continue
            handle = a["handle"].lower().strip()
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
    print(f"# ENGINE 1: HASHTAG CLUSTER MINING  ({len(HASHTAGS)} tags, {per_hashtag} each)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor({
            "hashtags": HASHTAGS,
            "resultsPerPage": per_hashtag,
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSubtitles": False,
            "shouldDownloadSlideshowImages": False,
        }, f"Hashtag mining: {len(HASHTAGS)} tags × {per_hashtag}")
        _ingest(items, "hashtag")
        print(f"[ENGINE 1] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 1] FAILED: {e}")

    # --- Engine 2: Search Phrase Deep Dive ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 2: SEARCH PHRASE DEEP DIVE  ({len(SEARCH_PHRASES)} phrases, {per_search} each)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor({
            "searchQueries": SEARCH_PHRASES,
            "resultsPerPage": per_search,
            "searchSection": "",
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSubtitles": False,
            "shouldDownloadSlideshowImages": False,
        }, f"Search phrases: {len(SEARCH_PHRASES)} queries × {per_search}")
        _ingest(items, "search")
        print(f"[ENGINE 2] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 2] FAILED: {e}")

    # --- Engine 4: Affiliate-Mindset Mining ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 4: AFFILIATE-MINDSET MINING  ({len(AFFILIATE_PHRASES)} phrases, {per_affiliate} each)")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor({
            "searchQueries": AFFILIATE_PHRASES,
            "resultsPerPage": per_affiliate,
            "searchSection": "",
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSubtitles": False,
            "shouldDownloadSlideshowImages": False,
        }, f"Affiliate phrases: {len(AFFILIATE_PHRASES)} queries × {per_affiliate}")
        _ingest(items, "affiliate")
        print(f"[ENGINE 4] Posts scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 4] FAILED: {e}")

    print(f"\n{'='*60}")
    print(f"[PHASE 1 DONE] Total unique authors collected: {len(authors)}")
    print(f"{'='*60}")

    # Quick stats
    with_followers = sum(1 for a in authors.values() if a.get("follower_count") is not None)
    print(f"  Authors with follower data: {with_followers}/{len(authors)}")

    return authors


# ===================================================================
# PHASE 2 — Enrichment & Filtering
# ===================================================================

def phase2_enrich(authors: dict[str, dict], target: int) -> list[dict]:
    """
    Enrich profiles that lack follower data, filter to 1K-10K, calculate engagement.
    Returns a list of enriched author dicts.
    """
    # Split into already-filterable vs needs-enrichment
    passed: dict[str, dict] = {}
    needs_enrichment: list[str] = []
    skipped_outside_range = 0

    for handle, a in authors.items():
        fc = a.get("follower_count")
        if fc is not None:
            if MIN_FOLLOWERS <= fc <= MAX_FOLLOWERS:
                passed[handle] = a
            else:
                skipped_outside_range += 1
        else:
            needs_enrichment.append(handle)

    print(f"\n[PHASE 2] Already passed follower filter: {len(passed)}")
    print(f"[PHASE 2] Skipped (outside {MIN_FOLLOWERS:,}-{MAX_FOLLOWERS:,}): {skipped_outside_range}")
    print(f"[PHASE 2] Need enrichment (no follower data): {len(needs_enrichment)}")

    # Enrich profiles without follower data
    if needs_enrichment:
        max_to_enrich = min(len(needs_enrichment), target * 5)
        to_enrich = needs_enrichment[:max_to_enrich]

        print(f"\n[PHASE 2] Enriching {len(to_enrich)} profiles via Apify profile scraper...")

        batch_size = 25
        for i in range(0, len(to_enrich), batch_size):
            batch = to_enrich[i : i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(to_enrich) + batch_size - 1) // batch_size

            print(f"\n[ENRICH] Batch {batch_num}/{total_batches}  ({len(batch)} profiles)")

            try:
                items = run_apify_actor({
                    "profiles": batch,
                    "resultsPerPage": 5,
                    "shouldDownloadVideos": False,
                    "shouldDownloadCovers": False,
                    "shouldDownloadSubtitles": False,
                    "shouldDownloadSlideshowImages": False,
                }, f"Profile enrichment batch {batch_num}/{total_batches}")

                for post in items:
                    enriched = extract_author_from_post(post)
                    if not enriched:
                        continue
                    h = enriched["handle"].lower().strip()
                    if h in authors:
                        merged = merge_authors(authors[h], enriched)
                        fc = merged.get("follower_count")
                        if fc is not None and MIN_FOLLOWERS <= fc <= MAX_FOLLOWERS:
                            passed[h] = merged
                        elif fc is not None:
                            skipped_outside_range += 1

                print(f"[ENRICH] Batch done. Passed so far: {len(passed)}")
            except Exception as e:
                print(f"[ENRICH] Batch {batch_num} FAILED: {e}")

    # Calculate engagement for every passed creator
    result = []
    for handle, a in passed.items():
        a = calculate_engagement(a)
        result.append(a)

    result.sort(key=lambda x: x.get("avg_views", 0), reverse=True)

    print(f"\n{'='*60}")
    print(f"[PHASE 2 DONE] Candidates ready for GPT scoring: {len(result)}")
    print(f"{'='*60}")

    for c in result[:10]:
        fc = c.get("follower_count", "?")
        av = c.get("avg_views", "?")
        print(f"  @{c['handle']:25s}  followers={fc:>8}  avg_views={av:>10}  sources={c.get('sources', [])}")

    return result


# ===================================================================
# PHASE 3 — GPT-4o Scoring
# ===================================================================

GPT_SYSTEM_PROMPT = """You are a creator relevance classifier for a marketing tool affiliate program.

For each TikTok creator, score them 0-100 based on:
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
            video_descs = [v.get("text", "")[:200] for v in c.get("videos", [])[:5]]
            summaries.append({
                "index": j,
                "handle": c.get("handle", ""),
                "bio": (c.get("bio") or "")[:300],
                "follower_count": c.get("follower_count", "unknown"),
                "avg_views": c.get("avg_views", 0),
                "engagement_rate": c.get("engagement_estimate", 0),
                "recent_video_descriptions": video_descs,
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

            # Normalise — the model may wrap in different keys
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

                    emoji = "✅" if creator["priority_score"] >= GPT_SCORE_THRESHOLD else "❌"
                    print(f"  {emoji} @{creator['handle']:25s}  "
                          f"score={creator['priority_score']:>3}  "
                          f"cat={creator['niche_category']}")

            # If some indices were missing, add them unscored
            scored_indices = {e.get("index") for e in scores_list}
            for j, c in enumerate(batch):
                if j not in scored_indices:
                    c_copy = c.copy()
                    c_copy["priority_score"] = 0
                    c_copy["niche_category"] = "Parse Error"
                    c_copy["gpt_reasoning"] = "Index not returned by GPT"
                    scored.append(c_copy)

            print(f"  → mapped {mapped}/{len(batch)}")

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
    "avg_views",
    "engagement_estimate",
    "email",
    "niche_category",
    "priority_score",
    "outreach_status",
    "profile_url",
    "bio",
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
                "avg_views": c.get("avg_views", ""),
                "engagement_estimate": c.get("engagement_estimate", ""),
                "email": extract_email_from_bio(bio),
                "niche_category": c.get("niche_category", ""),
                "priority_score": c.get("priority_score", ""),
                "outreach_status": "not_contacted",
                "profile_url": c.get("profile_url", ""),
                "bio": bio,
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
        description="TikTok Creator Sourcer — find micro-creators in the ad/marketing niche"
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
        help="Output CSV file path (default: output/tiktok_sourcer/tiktok_creators_<timestamp>.csv)",
    )
    args = parser.parse_args()

    target = args.target
    gpt_threshold = args.gpt_threshold

    print(f"\n{'='*60}")
    print(f"  TIKTOK CREATOR SOURCER")
    print(f"{'='*60}")
    print(f"  Target creators   : {target}")
    print(f"  Follower range    : {MIN_FOLLOWERS:,} – {MAX_FOLLOWERS:,}")
    print(f"  GPT threshold     : {gpt_threshold}")
    print(f"  Raw multiplier    : {args.multiplier}")
    print(f"  Resume            : {args.resume}")
    print(f"  Skip GPT          : {args.skip_gpt}")
    print(f"  Output CSV        : {args.output or '<auto>'}")
    print(f"  Output dir        : {OUTPUT_DIR}")
    print(f"  Timestamp         : {datetime.now().isoformat()}")
    print(f"{'='*60}\n")

    # Pre-flight checks
    _check_dependencies()

    if not APIFY_TOKEN:
        print("ERROR: APIFY_TOKEN not found in .env")
        sys.exit(1)
    if not args.skip_gpt and not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not found in .env (use --skip-gpt to bypass)")
        sys.exit(1)

    print(f"[OK] APIFY_TOKEN  : {APIFY_TOKEN[:12]}…")
    if OPENAI_API_KEY:
        print(f"[OK] OPENAI_API_KEY: {OPENAI_API_KEY[:12]}…")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # PHASE 1 — Collection
    # ------------------------------------------------------------------
    print(f"\n{'*'*60}")
    print(f"  PHASE 1: COLLECTION (Apify)")
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
    # PHASE 2 — Enrichment & Follower Filtering
    # ------------------------------------------------------------------
    print(f"\n{'*'*60}")
    print(f"  PHASE 2: ENRICHMENT & FILTERING")
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
        print("\nWARNING: No candidates passed follower filter.")
        print("Possible causes: scraper didn't return follower data, or all creators are outside 1K-10K.")
        print("Falling back: including ALL authors without follower data for GPT scoring…\n")
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
        # Assign default score so export still works
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
        csv_path = OUTPUT_DIR / f"tiktok_creators_{ts}.csv"
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

        print(f"\n  Top 10 creators:")
        for c in final[:10]:
            print(
                f"    @{c.get('handle', '?'):25s}  "
                f"score={c.get('priority_score', '?'):>3}  "
                f"followers={str(c.get('follower_count', '?')):>8}  "
                f"avg_views={str(c.get('avg_views', '?')):>10}  "
                f"{c.get('niche_category', '')}"
            )

    print(f"\nDone!")


if __name__ == "__main__":
    main()
