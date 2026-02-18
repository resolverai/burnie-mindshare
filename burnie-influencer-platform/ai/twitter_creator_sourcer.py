#!/usr/bin/env python3
"""
Twitter/X Creator Sourcer
==========================
Automated pipeline to find micro-creators (1K-10K followers) in the
Meta/Facebook ads, DTC/Shopify, and marketing tools niche on Twitter/X.

Uses:
  - Apify (apidojo/tweet-scraper)           for tweet collection (includes author data)
  - Apify (apidojo/twitter-profile-scraper) for profile enrichment when needed
  - OpenAI GPT-4o for LLM-based relevance scoring

Engines:
  1. Hashtag Cluster Mining
  2. Search Phrase Deep Dive
  4. Affiliate-Mindset Mining

Dependencies:
  pip install apify-client openai python-dotenv

Usage:
  python twitter_creator_sourcer.py --target 50
  python twitter_creator_sourcer.py --target 1000
  python twitter_creator_sourcer.py --target 50 --resume
  python twitter_creator_sourcer.py --target 50 --skip-gpt
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
# Search Configuration — Twitter Advanced Search syntax
# ---------------------------------------------------------------------------
HASHTAG_SEARCHES = [
    "#metaads lang:en",
    "#facebookads lang:en",
    "#adcreative lang:en",
    "#creativetesting lang:en",
    "#ugcads lang:en",
    "#shopifytips lang:en",
    "#dtcbrand lang:en",
    "#marketingtools lang:en",
    "#aimarketing lang:en",
    "#adlibrary lang:en",
    "#paidmedia lang:en",
    "#facebookadstips lang:en",
]

SEARCH_PHRASES = [
    "meta ads breakdown",
    "creative testing strategy",
    "how I test ads",
    "winning ads 2025",
    "ad library hack",
    "UGC ads tutorial",
    "facebook ads tutorial",
    "shopify marketing tips",
]

AFFILIATE_PHRASES = [
    "canva affiliate",
    "jasper ai review",
    "clickfunnels review",
    "best AI marketing tools",
    "chrome extensions for marketers",
    "marketing tool review",
    "saas tool review",
]

# ---------------------------------------------------------------------------
# Filtering Defaults
# ---------------------------------------------------------------------------
MIN_FOLLOWERS = 1_000
MAX_FOLLOWERS = 10_000
GPT_SCORE_THRESHOLD = 60
GPT_BATCH_SIZE = 10

OUTPUT_DIR = Path(__file__).parent / "output" / "twitter_sourcer"


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
    print(f"[SAVE] {filename} -> {path}")


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
    """Run an Apify actor and return dataset items."""
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
# Tweet / author extraction
# ===================================================================

def extract_author_from_tweet(tweet: dict) -> dict | None:
    """
    Pull author info + tweet stats from a single tweet-scraper result item.
    The apidojo/tweet-scraper returns tweets with embedded author objects.
    """
    author_data = tweet.get("author") or {}
    if not isinstance(author_data, dict):
        return None

    username = (
        author_data.get("userName")
        or author_data.get("username")
        or author_data.get("screen_name")
        or ""
    ).strip().lower()

    if not username:
        return None

    author: dict = {
        "handle": username,
        "name": author_data.get("name") or "",
        "profile_url": author_data.get("url") or f"https://x.com/{username}",
        "follower_count": author_data.get("followers"),
        "following_count": author_data.get("following"),
        "verified": author_data.get("isVerified") or author_data.get("isBlueVerified") or False,
        "verified_type": author_data.get("verifiedType") or "",
        "avatar": author_data.get("profilePicture") or "",
        "bio": author_data.get("description") or "",
        "location": author_data.get("location") or "",
    }

    # Tweet-level stats
    tweet_data = {
        "text": tweet.get("text") or "",
        "likes": tweet.get("likeCount") or 0,
        "retweets": tweet.get("retweetCount") or 0,
        "replies": tweet.get("replyCount") or 0,
        "quotes": tweet.get("quoteCount") or 0,
        "bookmarks": tweet.get("bookmarkCount") or 0,
        "url": tweet.get("url") or "",
        "created_at": tweet.get("createdAt") or "",
        "lang": tweet.get("lang") or "",
    }

    author["tweets"] = [tweet_data]
    return author


def extract_profile_data(profile: dict) -> dict | None:
    """
    Extract author data from a twitter-profile-scraper result item.
    These results are tweet objects but with richer author info.
    """
    author_data = profile.get("author") or {}
    if not isinstance(author_data, dict):
        return None

    username = (
        author_data.get("userName")
        or author_data.get("username")
        or ""
    ).strip().lower()

    if not username:
        return None

    author: dict = {
        "handle": username,
        "name": author_data.get("name") or "",
        "profile_url": author_data.get("url") or f"https://x.com/{username}",
        "follower_count": author_data.get("followers"),
        "following_count": author_data.get("following"),
        "verified": author_data.get("isVerified") or author_data.get("isBlueVerified") or False,
        "verified_type": author_data.get("verifiedType") or "",
        "avatar": author_data.get("profilePicture") or "",
        "bio": author_data.get("description") or "",
        "location": author_data.get("location") or "",
    }

    tweet_data = {
        "text": profile.get("text") or "",
        "likes": profile.get("likeCount") or 0,
        "retweets": profile.get("retweetCount") or 0,
        "replies": profile.get("replyCount") or 0,
        "quotes": profile.get("quoteCount") or 0,
        "bookmarks": profile.get("bookmarkCount") or 0,
        "url": profile.get("url") or "",
        "created_at": profile.get("createdAt") or "",
        "lang": profile.get("lang") or "",
    }

    author["tweets"] = [tweet_data]
    return author


def merge_authors(existing: dict, new: dict) -> dict:
    """Merge new author data into existing, combining tweet lists."""
    merged = {**existing}

    for key in ("follower_count", "following_count", "bio", "name",
                "verified", "verified_type", "avatar", "location"):
        if new.get(key) and not existing.get(key):
            merged[key] = new[key]

    existing_urls = {t.get("url") for t in existing.get("tweets", []) if t.get("url")}
    for t in new.get("tweets", []):
        if t.get("url") and t["url"] not in existing_urls:
            merged.setdefault("tweets", []).append(t)
            existing_urls.add(t["url"])

    return merged


def calculate_engagement(author: dict) -> dict:
    """Compute avg_likes, avg_retweets, engagement_estimate from tweets."""
    tweets = author.get("tweets") or []
    recent = tweets[:5]

    if not recent:
        author["avg_likes"] = 0
        author["avg_retweets"] = 0
        author["avg_replies"] = 0
        author["engagement_estimate"] = 0.0
        return author

    total_likes = sum(t.get("likes", 0) for t in recent)
    total_retweets = sum(t.get("retweets", 0) for t in recent)
    total_replies = sum(t.get("replies", 0) for t in recent)

    author["avg_likes"] = round(total_likes / len(recent))
    author["avg_retweets"] = round(total_retweets / len(recent))
    author["avg_replies"] = round(total_replies / len(recent))

    followers = author.get("follower_count") or 0
    if followers > 0:
        avg_engagement = (total_likes + total_retweets + total_replies) / len(recent)
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
    Run Engines 1, 2, 4 via Apify Tweet Scraper.
    Returns {handle: author_dict}.
    """
    total_raw = target * multiplier
    hashtag_cap = max(100, int(total_raw * 0.40))
    search_cap = max(60, int(total_raw * 0.30))
    affiliate_cap = max(60, int(total_raw * 0.30))

    print(f"\n[PHASE 1] Plan: ~{hashtag_cap} tweets from hashtags  |  "
          f"~{search_cap} from search  |  "
          f"~{affiliate_cap} from affiliate")

    authors: dict[str, dict] = {}

    def _ingest(items: list[dict], source_tag: str):
        skipped_retweets = 0
        for tweet in items:
            if tweet.get("isRetweet"):
                skipped_retweets += 1
                continue
            a = extract_author_from_tweet(tweet)
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
        if skipped_retweets:
            print(f"  (skipped {skipped_retweets} retweets)")

    # --- Engine 1: Hashtag Mining ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 1: HASHTAG CLUSTER MINING  ({len(HASHTAG_SEARCHES)} tags, cap {hashtag_cap})")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apidojo/tweet-scraper", {
            "searchTerms": HASHTAG_SEARCHES,
            "maxItems": hashtag_cap,
            "sort": "Top",
            "tweetLanguage": "en",
        }, f"Hashtag mining: {len(HASHTAG_SEARCHES)} tags (cap {hashtag_cap} tweets)")
        _ingest(items, "hashtag")
        print(f"[ENGINE 1] Tweets scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 1] FAILED: {e}")

    # --- Engine 2: Search Phrase Deep Dive ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 2: SEARCH PHRASE DEEP DIVE  ({len(SEARCH_PHRASES)} phrases, cap {search_cap})")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apidojo/tweet-scraper", {
            "searchTerms": SEARCH_PHRASES,
            "maxItems": search_cap,
            "sort": "Top",
            "tweetLanguage": "en",
        }, f"Search phrases: {len(SEARCH_PHRASES)} queries (cap {search_cap} tweets)")
        _ingest(items, "search")
        print(f"[ENGINE 2] Tweets scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 2] FAILED: {e}")

    # --- Engine 4: Affiliate-Mindset Mining ---
    print(f"\n{'#'*60}")
    print(f"# ENGINE 4: AFFILIATE-MINDSET MINING  ({len(AFFILIATE_PHRASES)} phrases, cap {affiliate_cap})")
    print(f"{'#'*60}")
    try:
        items = run_apify_actor("apidojo/tweet-scraper", {
            "searchTerms": AFFILIATE_PHRASES,
            "maxItems": affiliate_cap,
            "sort": "Top",
            "tweetLanguage": "en",
        }, f"Affiliate phrases: {len(AFFILIATE_PHRASES)} queries (cap {affiliate_cap} tweets)")
        _ingest(items, "affiliate")
        print(f"[ENGINE 4] Tweets scraped: {len(items)}  |  Unique authors so far: {len(authors)}")
    except Exception as e:
        print(f"[ENGINE 4] FAILED: {e}")

    print(f"\n{'='*60}")
    print(f"[PHASE 1 DONE] Total unique authors collected: {len(authors)}")
    print(f"{'='*60}")

    with_followers = sum(1 for a in authors.values() if a.get("follower_count") is not None)
    print(f"  Authors with follower data: {with_followers}/{len(authors)}")

    return authors


# ===================================================================
# PHASE 2 — Enrichment & Filtering
# ===================================================================

def phase2_enrich(authors: dict[str, dict], target: int) -> list[dict]:
    """
    Filter to 1K-10K followers, enrich profiles missing data if needed,
    then calculate engagement.
    """
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

    # Enrich profiles without follower data via profile scraper
    if needs_enrichment:
        max_to_enrich = min(len(needs_enrichment), target * 3)
        to_enrich = needs_enrichment[:max_to_enrich]

        print(f"\n[PHASE 2] Enriching {len(to_enrich)} profiles via Twitter Profile Scraper...")

        batch_size = 20
        for i in range(0, len(to_enrich), batch_size):
            batch = to_enrich[i : i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(to_enrich) + batch_size - 1) // batch_size

            print(f"\n[ENRICH] Batch {batch_num}/{total_batches}  ({len(batch)} profiles)")

            try:
                items = run_apify_actor("apidojo/twitter-profile-scraper", {
                    "twitterHandles": batch,
                    "maxItems": len(batch) * 5,
                }, f"Profile enrichment batch {batch_num}/{total_batches}")

                enriched_handles = set()
                for tweet_item in items:
                    enriched = extract_profile_data(tweet_item)
                    if not enriched:
                        continue
                    h = enriched["handle"]
                    if h in enriched_handles:
                        if h in authors:
                            authors[h] = merge_authors(authors[h], enriched)
                        continue
                    enriched_handles.add(h)

                    if h in authors:
                        merged = merge_authors(authors[h], enriched)
                        fc = merged.get("follower_count")
                        if fc is not None and MIN_FOLLOWERS <= fc <= MAX_FOLLOWERS:
                            passed[h] = merged
                        elif fc is not None:
                            skipped_outside_range += 1
                        else:
                            passed[h] = merged

                print(f"[ENRICH] Batch done. Passed so far: {len(passed)}")
            except Exception as e:
                print(f"[ENRICH] Batch {batch_num} FAILED: {e}")

    # Calculate engagement for every passed creator
    result = []
    for handle, a in passed.items():
        a = calculate_engagement(a)
        result.append(a)

    result.sort(key=lambda x: x.get("engagement_estimate", 0), reverse=True)

    print(f"\n{'='*60}")
    print(f"[PHASE 2 DONE]")
    print(f"  Candidates ready for GPT scoring : {len(result)}")
    print(f"  Skipped (outside range)          : {skipped_outside_range}")
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

For each Twitter/X creator, score them 0-100 based on:
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
            tweet_texts = [t.get("text", "")[:200] for t in c.get("tweets", [])[:5]]
            summaries.append({
                "index": j,
                "handle": c.get("handle", ""),
                "bio": (c.get("bio") or "")[:300],
                "location": c.get("location", ""),
                "follower_count": c.get("follower_count", "unknown"),
                "following_count": c.get("following_count", "unknown"),
                "verified": c.get("verified", False),
                "avg_likes": c.get("avg_likes", 0),
                "avg_retweets": c.get("avg_retweets", 0),
                "avg_replies": c.get("avg_replies", 0),
                "engagement_rate": c.get("engagement_estimate", 0),
                "recent_tweet_texts": tweet_texts,
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

                    marker = "+" if creator["priority_score"] >= GPT_SCORE_THRESHOLD else "-"
                    print(f"  [{marker}] @{creator['handle']:25s}  "
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
    "following_count",
    "avg_likes",
    "avg_retweets",
    "avg_replies",
    "engagement_estimate",
    "email",
    "niche_category",
    "priority_score",
    "outreach_status",
    "profile_url",
    "bio",
    "location",
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
                "following_count": c.get("following_count", ""),
                "avg_likes": c.get("avg_likes", ""),
                "avg_retweets": c.get("avg_retweets", ""),
                "avg_replies": c.get("avg_replies", ""),
                "engagement_estimate": c.get("engagement_estimate", ""),
                "email": extract_email_from_bio(bio),
                "niche_category": c.get("niche_category", ""),
                "priority_score": c.get("priority_score", ""),
                "outreach_status": "not_contacted",
                "profile_url": c.get("profile_url", ""),
                "bio": bio,
                "location": c.get("location", ""),
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
        description="Twitter/X Creator Sourcer — find micro-creators in the ad/marketing niche"
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
        help="Output CSV file path (default: output/twitter_sourcer/twitter_creators_<timestamp>.csv)",
    )
    args = parser.parse_args()

    target = args.target
    gpt_threshold = args.gpt_threshold

    print(f"\n{'='*60}")
    print(f"  TWITTER/X CREATOR SOURCER")
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
    print(f"  PHASE 1: COLLECTION (Apify Tweet Scraper)")
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
        csv_path = OUTPUT_DIR / f"twitter_creators_{ts}.csv"

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

        verified_count = sum(1 for c in final if c.get("verified"))
        print(f"\n  Verified accounts: {verified_count}/{len(final)}")

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
