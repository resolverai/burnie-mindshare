"""
DVYB Discover category ranking: rank ad categories by semantic match to account industry using GPT-4o.
Used by TypeScript backend when serving Discover ads to put industry-relevant categories first.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import logging
import json

from openai import OpenAI

from app.config.settings import settings

logger = logging.getLogger(__name__)


def _parse_ranked_pairs_json(text: str) -> list:
    """
    Parse JSON array of {category, subcategory} from LLM response.
    On truncation (Unterminated string, etc.) attempt repair and parse;
    if still invalid, return empty list so caller can fall back to original order.
    """
    if not text or not text.strip():
        return []
    text = text.strip()
    # Strip markdown code fence if present
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Repair truncated JSON: close unterminated string, then close brackets/braces
    repaired = text
    brace_count = 0
    bracket_count = 0
    in_string = False
    escape_next = False
    i = 0
    while i < len(repaired):
        c = repaired[i]
        if escape_next:
            escape_next = False
            i += 1
            continue
        if c == "\\" and in_string:
            escape_next = True
            i += 1
            continue
        if c == '"' and not escape_next:
            in_string = not in_string
            i += 1
            continue
        if in_string:
            i += 1
            continue
        if c == "{":
            brace_count += 1
        elif c == "}":
            brace_count -= 1
        elif c == "[":
            bracket_count += 1
        elif c == "]":
            bracket_count -= 1
        i += 1
    if in_string:
        repaired = repaired + '"'
    if bracket_count > 0:
        repaired = repaired + ("]" * bracket_count)
    if brace_count > 0:
        repaired = repaired + ("}" * brace_count)
    try:
        out = json.loads(repaired)
        return out if isinstance(out, list) else []
    except json.JSONDecodeError:
        logger.warning("rank-pairs: could not repair truncated JSON, using original order")
        return []

router = APIRouter(prefix="/api/dvyb/discover", tags=["dvyb-discover-ranking"])


class RankCategoriesRequest(BaseModel):
    """Request: account industry + list of ad categories to rank."""
    industry: str
    categories: List[str]


class RankCategoriesResponse(BaseModel):
    """Response: same categories in order of best semantic match first (rank 1 = best)."""
    success: bool
    ranked_categories: List[str] = []
    error: Optional[str] = None


class CategorySubcategoryPair(BaseModel):
    category: str
    subcategory: str


class BrandContextOptional(BaseModel):
    business_overview: Optional[str] = None
    popular_products: Optional[List[str]] = None
    customer_demographics: Optional[str] = None
    brand_story: Optional[str] = None


class RankPairsRequest(BaseModel):
    """Request: account industry + brand context + (category, subcategory) pairs from current result set."""
    industry: str
    pairs: List[CategorySubcategoryPair]
    brand_context: Optional[BrandContextOptional] = None


class RankPairsResponse(BaseModel):
    """Response: same pairs in order of best semantic match to industry/brand first (rank 1 = best)."""
    success: bool
    ranked_pairs: List[CategorySubcategoryPair] = []
    error: Optional[str] = None


def _get_openai_client() -> Optional[OpenAI]:
    key = (settings.openai_api_key or "").strip()
    if not key:
        return None
    return OpenAI(api_key=key)


@router.post("/rank-categories", response_model=RankCategoriesResponse)
async def rank_categories(request: RankCategoriesRequest):
    """
    Rank ad categories by semantic relevance to the account's industry using GPT-4o.
    Returns the same list of categories reordered: best match at index 0, worst at the end.
    """
    try:
        if not request.industry or not request.industry.strip():
            return RankCategoriesResponse(success=True, ranked_categories=request.categories or [])
        if not request.categories:
            return RankCategoriesResponse(success=True, ranked_categories=[])

        client = _get_openai_client()
        if not client:
            logger.warning("rank-categories: OPENAI_API_KEY not set, returning original order")
            return RankCategoriesResponse(success=True, ranked_categories=request.categories)

        industry = request.industry.strip()
        categories = [c.strip() for c in request.categories if (c or "").strip()]

        print(f"[rank-categories] account category (industry): {industry!r}")
        print(f"[rank-categories] available categories: {categories}")

        prompt = f"""You are given:
1) The account's industry (from the brand/account profile): "{industry}"
2) A list of ad categories (from our ad library): {json.dumps(categories)}

Task: Rank the ad categories by how semantically relevant they are to the account's industry. 
Categories that mean the same or very similar to the industry should be ranked first. 
Return ONLY a JSON array of the same category strings in order: best match first (rank 1), then next best, and so on. 
Include every category exactly once. Use the exact strings from the input list.

Output format (no other text): ["Category A", "Category B", ...]"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You output only valid JSON arrays. No markdown, no explanation."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        text = (response.choices[0].message.content or "").strip()
        # Strip markdown code block if present
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)
        ranked = json.loads(text)
        if not isinstance(ranked, list):
            ranked = request.categories
        # Map back to exact input strings (input_set by lowercase for matching)
        input_by_lower = {c.lower(): c for c in categories}
        ranked_dedup = []
        seen = set()
        for c in ranked:
            if not isinstance(c, str) or not c.strip():
                continue
            key = c.strip().lower()
            if key in input_by_lower:
                exact = input_by_lower[key]
                if exact not in seen:
                    ranked_dedup.append(exact)
                    seen.add(exact)
        for c in categories:
            if c not in seen:
                ranked_dedup.append(c)
        print(f"[rank-categories] ranked categories: {ranked_dedup}")
        logger.info(f"rank-categories: industry={industry!r} -> {len(ranked_dedup)} categories ranked")
        return RankCategoriesResponse(success=True, ranked_categories=ranked_dedup)
    except Exception as e:
        logger.exception("rank-categories error")
        return RankCategoriesResponse(
            success=False,
            ranked_categories=request.categories if request else [],
            error=str(e),
        )


@router.post("/rank-pairs", response_model=RankPairsResponse)
async def rank_pairs(request: RankPairsRequest):
    """
    Rank (category, subcategory) pairs by semantic relevance to the account's industry and brand context.
    Uses GPT-4o (no image). Same idea as match-product-to-ads but with industry/brand text only.
    Returns the same list of pairs reordered: best match at index 0, worst at the end.
    Used by Discover: re-order filtered result set so relevant ads appear first.
    """
    try:
        if not request.industry or not request.industry.strip():
            return RankPairsResponse(success=True, ranked_pairs=request.pairs or [])
        if not request.pairs:
            return RankPairsResponse(success=True, ranked_pairs=[])

        client = _get_openai_client()
        if not client:
            logger.warning("rank-pairs: OPENAI_API_KEY not set, returning original order")
            return RankPairsResponse(success=True, ranked_pairs=request.pairs)

        industry = request.industry.strip()
        pairs = [
            (p.category.strip(), p.subcategory.strip())
            for p in request.pairs
            if (p.category or "").strip() and (p.subcategory or "").strip()
        ]
        if not pairs:
            return RankPairsResponse(success=True, ranked_pairs=[])

        print(f"\n[rank-pairs] REQUEST: industry={industry!r}, pairs_count={len(pairs)}")
        brand_section = ""
        brand_context_trimmed = None
        if request.brand_context:
            bc = request.brand_context
            parts = []
            if bc.business_overview and bc.business_overview.strip():
                parts.append(f"Business overview: {bc.business_overview[:600]}")
            if bc.popular_products:
                parts.append(f"Popular products: {', '.join(str(x)[:80] for x in bc.popular_products[:10])}")
            if bc.customer_demographics and bc.customer_demographics.strip():
                parts.append(f"Customer demographics: {bc.customer_demographics[:400]}")
            if bc.brand_story and bc.brand_story.strip():
                parts.append(f"Brand story: {bc.brand_story[:400]}")
            if parts:
                brand_section = "\n\nBrand context:\n" + "\n".join(parts)
                brand_context_trimmed = "\n".join(parts)
        if brand_context_trimmed:
            print(f"[rank-pairs] brand_context (trimmed):\n{brand_context_trimmed}")
        else:
            print("[rank-pairs] brand_context: (none)")

        pairs_str = json.dumps([{"category": c, "subcategory": s} for c, s in pairs])
        prompt = f"""You are given:
1) The account's industry (same as category): "{industry}"
2) A list of (category, subcategory) pairs from our ad library (from the current filtered result set): {pairs_str}
{brand_section}

Task: Rank these (category, subcategory) pairs by how semantically relevant they are to the account's industry and brand.
Pairs that match or are very related to the industry should be ranked first. Use brand context if provided to improve relevance.
Return ONLY a JSON array of objects, each with "category" and "subcategory" keys, in order: best match first (rank 1), then next best.
Include every pair exactly once. Use the exact category and subcategory strings from the input list.

Output format (no other text): [{{"category": "X", "subcategory": "Y"}}, ...]"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You output only valid JSON arrays of objects with category and subcategory. No markdown, no explanation."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=8192,  # enough for large pair lists; avoids truncation
        )
        text = (response.choices[0].message.content or "").strip()
        raw_ranked = _parse_ranked_pairs_json(text)
        if not raw_ranked:
            return RankPairsResponse(success=True, ranked_pairs=request.pairs)

        pair_set = {(c.lower(), s.lower()) for c, s in pairs}
        input_by_key = {(c.lower(), s.lower()): (c, s) for c, s in pairs}
        ranked_dedup = []
        seen = set()
        for item in raw_ranked:
            if not isinstance(item, dict):
                continue
            cat = (item.get("category") or "").strip()
            sub = (item.get("subcategory") or "").strip()
            key = (cat.lower(), sub.lower())
            if key in pair_set and key not in seen:
                ranked_dedup.append(CategorySubcategoryPair(category=input_by_key[key][0], subcategory=input_by_key[key][1]))
                seen.add(key)
        for c, s in pairs:
            key = (c.lower(), s.lower())
            if key not in seen:
                ranked_dedup.append(CategorySubcategoryPair(category=c, subcategory=s))
        print(f"[rank-pairs] OUTPUT ranked (category, subcategory) pairs for this account ({len(ranked_dedup)}):")
        for i, p in enumerate(ranked_dedup, 1):
            print(f"  {i}. {p.category!r} / {p.subcategory!r}")
        logger.info(f"rank-pairs: industry={industry!r} -> {len(ranked_dedup)} pairs ranked")
        return RankPairsResponse(success=True, ranked_pairs=ranked_dedup)
    except Exception as e:
        logger.exception("rank-pairs error")
        return RankPairsResponse(
            success=False,
            ranked_pairs=request.pairs if request else [],
            error=str(e),
        )
