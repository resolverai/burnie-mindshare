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
