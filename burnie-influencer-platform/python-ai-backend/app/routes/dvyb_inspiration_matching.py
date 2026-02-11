"""
DVYB Inspiration Matching Endpoint
Matches detected industry from website analysis to inspiration link categories using OpenAI.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
import random
import re
import json

from openai import OpenAI
import os

from app.config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize OpenAI client
openai_client = None
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    logger.info("✅ OpenAI client initialized for inspiration matching")
else:
    logger.warning("⚠️ OPENAI_API_KEY not found - inspiration matching will not work")


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class InspirationLink(BaseModel):
    """An inspiration link from the database"""
    id: int
    platform: str
    category: str
    url: str
    title: Optional[str] = None
    mediaType: Optional[str] = "image"
    mediaUrl: Optional[str] = None


class BrandContextOptional(BaseModel):
    """Optional brand context from localStorage (business overview, etc.)"""
    business_overview: Optional[str] = None
    popular_products: Optional[List[str]] = None
    customer_demographics: Optional[str] = None
    brand_story: Optional[str] = None


class InspirationMatchRequest(BaseModel):
    """Request for matching industry to categories"""
    industry: str
    categories: List[str]
    inspiration_links: List[InspirationLink]
    count: int = 6  # Number of videos to return
    brand_context: Optional[BrandContextOptional] = None  # From localStorage for better matching


class InspirationMatchResponse(BaseModel):
    """Response from inspiration matching"""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class MatchWebsiteCategoryRequest(BaseModel):
    """Request for matching website/domain category to brand ad categories"""
    website_category: str
    available_categories: List[str]
    brand_context: Optional[BrandContextOptional] = None  # From dvyb_context for better matching


class MatchWebsiteCategoryResponse(BaseModel):
    """Response from website category matching (for discover ads onboarding)"""
    success: bool
    matched_categories: List[str] = []
    reasoning: Optional[str] = None
    error: Optional[str] = None


class CategorySubcategoryPair(BaseModel):
    """Category and subcategory from dvyb_brand_ads"""
    category: str
    subcategory: str


class MatchProductToAdsRequest(BaseModel):
    """Request for matching product image to brand ad category+subcategory via Grok"""
    product_image_url: str  # Presigned S3 URL
    category_subcategory_pairs: List[CategorySubcategoryPair]
    brand_context: Optional[BrandContextOptional] = None


class MatchProductToAdsResponse(BaseModel):
    """Response from product-to-ads matching"""
    success: bool
    matched_pairs: List[CategorySubcategoryPair] = []
    reasoning: Optional[str] = None
    error: Optional[str] = None


# ============================================
# JSON PARSING UTILITIES
# ============================================

def extract_json_from_response(response_text: str) -> str:
    """
    Extract JSON from LLM response with robust markdown handling.
    Strategy: Try json.loads FIRST, repair if needed, then fall back to manual extraction.
    """
    # Handle empty or None response
    if not response_text or not response_text.strip():
        raise ValueError("Empty response from LLM")
    
    logger.info(f"🔍 JSON EXTRACTION - Input length: {len(response_text)} chars")

    def _try_parse_json(text: str) -> bool:
        """Try to parse text as JSON. Returns True if valid, False if not."""
        try:
            json.loads(text)
            return True
        except Exception as e:
            logger.debug(f"JSON parse error: {str(e)[:100]}")
            return False

    def _extract_from_first_to_last_brace(text: str) -> str:
        """Simple extraction from first { to last }"""
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end > start:
            return text[start:end + 1]
        return text
    
    def _repair_truncated_json(text: str) -> str:
        """
        Attempt to repair truncated/malformed JSON by properly closing it.
        """
        try:
            json.loads(text)
            return text
        except json.JSONDecodeError:
            # Count unclosed braces and brackets
            brace_count = 0
            bracket_count = 0
            in_string = False
            escape_next = False
            
            for char in text:
                if escape_next:
                    escape_next = False
                    continue
                if char == '\\' and in_string:
                    escape_next = True
                    continue
                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                elif char == '[':
                    bracket_count += 1
                elif char == ']':
                    bracket_count -= 1
            
            repaired = text
            if in_string:
                repaired = repaired + '"'
            if bracket_count > 0:
                repaired = repaired + (']' * bracket_count)
            if brace_count > 0:
                repaired = repaired + ('}' * brace_count)
            
            return repaired

    def _extract_and_repair(text: str, source: str) -> Optional[str]:
        """Extract JSON from text and try to repair if needed"""
        extracted = _extract_from_first_to_last_brace(text)
        
        if _try_parse_json(extracted):
            logger.info(f"✅ Valid JSON from {source}")
            return extracted
        
        repaired = _repair_truncated_json(extracted)
        if _try_parse_json(repaired):
            logger.info(f"✅ Repaired JSON from {source}")
            return repaired
        
        return None

    # 1) Try ```json``` fenced blocks first
    if "```json" in response_text.lower():
        json_pattern = re.search(r'```json\s*\n?(.*?)\n?```', response_text, re.DOTALL | re.IGNORECASE)
        if json_pattern:
            block = json_pattern.group(1).strip()
            result = _extract_and_repair(block, "```json block")
            if result:
                return result
    
    # 2) Try generic ``` ``` fenced blocks
    if "```" in response_text:
        code_pattern = re.search(r'```\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if code_pattern:
            block = code_pattern.group(1).strip()
            if block.startswith("{") or block.startswith("["):
                result = _extract_and_repair(block, "``` block")
                if result:
                    return result
    
    # 3) Try the whole response
    result = _extract_and_repair(response_text, "raw response")
    if result:
        return result
    
    # 4) Last resort - return best extraction attempt
    extracted = _extract_from_first_to_last_brace(response_text)
    repaired = _repair_truncated_json(extracted)
    logger.warning(f"⚠️ Returning best effort JSON: {len(repaired)} chars")
    return repaired


# ============================================
# API ENDPOINTS
# ============================================

@router.post("/match-inspirations", response_model=InspirationMatchResponse)
async def match_inspirations(request: InspirationMatchRequest):
    """
    Match industry to inspiration categories using OpenAI.
    Returns weighted random selection of inspiration videos.
    
    Flow:
    1. Use GPT-4o to identify top 2 categories that best match the industry
    2. Pick videos from those categories with weighted distribution (4 from top, 2 from second)
    """
    try:
        if not openai_client:
            raise HTTPException(status_code=500, detail="OpenAI client not initialized")
        
        if not request.categories:
            return InspirationMatchResponse(
                success=False,
                error="No categories provided"
            )
        
        if not request.inspiration_links:
            return InspirationMatchResponse(
                success=False,
                error="No inspiration links provided"
            )
        
        logger.info(f"🎯 Matching industry '{request.industry}' to categories: {request.categories}")
        
        # Step 1: Use OpenAI to match industry + brand context to categories
        brand_ctx = None
        if request.brand_context:
            brand_ctx = {
                "business_overview": request.brand_context.business_overview,
                "popular_products": request.brand_context.popular_products,
                "customer_demographics": request.brand_context.customer_demographics,
                "brand_story": request.brand_context.brand_story,
            }
        match_result = await match_industry_to_categories(
            request.industry, 
            request.categories,
            brand_context=brand_ctx
        )
        
        matched_categories = match_result.get("matched_categories", [])
        match_reasoning = match_result.get("reasoning", "")
        
        if not matched_categories:
            # No categories matched
            logger.info(f"No matching categories found for industry: {request.industry}")
            return InspirationMatchResponse(
                success=True,
                data={
                    "matched_categories": [],
                    "inspiration_videos": [],
                    "reasoning": match_reasoning or "No categories matched the given industry"
                }
            )
        
        logger.info(f"✅ Matched categories: {matched_categories}")
        
        # Step 2: Select videos with weighted distribution
        selected_videos = select_weighted_videos(
            matched_categories,
            request.inspiration_links,
            request.count
        )
        
        logger.info(f"✅ Selected {len(selected_videos)} inspiration videos")
        
        return InspirationMatchResponse(
            success=True,
            data={
                "matched_categories": matched_categories,
                "inspiration_videos": [v.dict() for v in selected_videos],
                "reasoning": match_reasoning
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Inspiration matching error: {e}", exc_info=True)
        return InspirationMatchResponse(
            success=False,
            error=str(e)
        )


@router.post("/match-website-category", response_model=MatchWebsiteCategoryResponse)
async def match_website_category(request: MatchWebsiteCategoryRequest):
    """
    Match website/domain category from website analysis to available brand ad categories.
    Uses GPT-4o to pick the best-matching category from dvyb_brand_ads.
    Used by discover ads onboarding to serve relevant ads based on user's website industry.
    """
    try:
        print(f"\n[match-website-category] REQUEST: website_category={request.website_category!r}, "
              f"available_categories={len(request.available_categories)}, brand_context={request.brand_context is not None}")

        if not openai_client:
            return MatchWebsiteCategoryResponse(
                success=False,
                error="OpenAI client not initialized"
            )
        if not request.website_category or not request.website_category.strip():
            return MatchWebsiteCategoryResponse(success=True, matched_categories=[])
        if not request.available_categories:
            return MatchWebsiteCategoryResponse(success=True, matched_categories=[])

        logger.info(
            f"🎯 Matching website category '{request.website_category}' to "
            f"{len(request.available_categories)} brand ad categories"
            + (" (with brand context)" if request.brand_context else "")
        )
        brand_ctx = None
        if request.brand_context:
            brand_ctx = {
                "business_overview": request.brand_context.business_overview,
                "popular_products": request.brand_context.popular_products,
                "customer_demographics": request.brand_context.customer_demographics,
                "brand_story": request.brand_context.brand_story,
            }
        result = await match_industry_to_categories(
            request.website_category.strip(),
            request.available_categories,
            brand_context=brand_ctx,
        )
        matched = result.get("matched_categories", []) or []
        reasoning = result.get("reasoning")
        reasoning_preview = (reasoning[:100] + "...") if reasoning else None
        print(f"[match-website-category] RESPONSE: matched_categories={matched}, reasoning={reasoning_preview}\n")
        logger.info(f"✅ GPT-4o matched categories: {matched}")
        return MatchWebsiteCategoryResponse(
            success=True,
            matched_categories=matched,
            reasoning=reasoning,
        )
    except Exception as e:
        logger.error(f"❌ match_website_category error: {e}", exc_info=True)
        return MatchWebsiteCategoryResponse(
            success=False,
            matched_categories=[],
            error=str(e),
        )


@router.post("/match-product-to-ads", response_model=MatchProductToAdsResponse)
async def match_product_to_ads(request: MatchProductToAdsRequest):
    """
    Match product image to brand ad category+subcategory combinations using Grok.
    Used by unified onboarding inspiration step: user chose a product, we show relevant ads.
    Grok receives the product image + list of (category, subcategory) pairs from dvyb_brand_ads,
    and returns which combinations are most relevant for this product.
    """
    try:
        xai_key = (settings.xai_api_key or "").strip()
        if not xai_key:
            return MatchProductToAdsResponse(
                success=False,
                error="XAI_API_KEY not configured",
            )
        if not request.product_image_url or not request.product_image_url.strip().startswith(("http://", "https://")):
            print("[match-product-to-ads] No valid product image URL, returning empty")
            return MatchProductToAdsResponse(success=True, matched_pairs=[])
        if not request.category_subcategory_pairs:
            print("[match-product-to-ads] No category_subcategory_pairs, returning empty")
            return MatchProductToAdsResponse(success=True, matched_pairs=[])

        pairs = request.category_subcategory_pairs
        pairs_str = "\n".join([f"- {p.category} / {p.subcategory}" for p in pairs])
        print(f"\n[match-product-to-ads] REQUEST: product_image_url={request.product_image_url[:80]}...")
        print(f"[match-product-to-ads] Pairs ({len(pairs)}): {pairs[:5]}{'...' if len(pairs) > 5 else ''}")
        print(f"[match-product-to-ads] Brand context: {'yes' if request.brand_context else 'no'}")

        brand_context_section = ""
        if request.brand_context:
            parts = []
            bc = request.brand_context
            if bc.business_overview and str(bc.business_overview).strip():
                parts.append(f"- **Business Overview**: {str(bc.business_overview)[:800]}")
            if bc.popular_products:
                prods = bc.popular_products
                prods_str = ", ".join(str(p)[:100] for p in (prods[:10] if isinstance(prods, list) else [prods]))
                if prods_str:
                    parts.append(f"- **Popular Products**: {prods_str}")
            if bc.customer_demographics and str(bc.customer_demographics).strip():
                parts.append(f"- **Customer Demographics**: {str(bc.customer_demographics)[:600]}")
            if bc.brand_story and str(bc.brand_story).strip():
                parts.append(f"- **Brand Story**: {str(bc.brand_story)[:500]}")
            if parts:
                brand_context_section = "\n\n## Brand Context\n" + "\n".join(parts)

        system_prompt = """You are an expert at matching products to advertising creative styles. Your role is to identify which ad categories and subcategories are somewhat related to a given product image and brand.

You will receive:
1. A product image (the user's chosen product)
2. A list of (category, subcategory) pairs from our ad creative database
3. Optional brand context

Your task: Return ONLY (category, subcategory) pairs that are somewhat related to the product and brand. Consider product type, industry, target audience, and visual/creative relevance. If a category is completely unrelated (e.g. antivirus software company vs fashion ads), do NOT include it. You are free to return zero pairs if nothing is related—for example, showing fashion ads to an antivirus company is irrelevant, so in that case return empty matched_pairs.

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON."""

        user_prompt = f"""Look at the product image provided. From the list below, select only (category, subcategory) pairs that are somewhat related to this product and brand. Do not include pairs that are unrelated (e.g. antivirus brand vs fashion/beauty ads).
{pairs_str}
{brand_context_section}

Return a JSON object:
{{
  "matched_pairs": [
    {{ "category": "exact category from list", "subcategory": "exact subcategory from list" }}
  ],
  "reasoning": "Brief explanation"
}}

Include only pairs that have some relevance. Order by relevance with the best match first, up to 20 pairs. Use EXACT category and subcategory strings from the list. If no categories are related at all, return empty matched_pairs: []."""

        try:
            from xai_sdk import Client
            from xai_sdk.chat import user, system, image
        except ImportError:
            logger.warning("xai_sdk not installed")
            return MatchProductToAdsResponse(success=False, error="Grok SDK not available")

        client = Client(api_key=xai_key, timeout=60)
        chat = client.chat.create(model="grok-4-fast-reasoning")
        chat.append(system(system_prompt))
        chat.append(user(user_prompt, image(image_url=request.product_image_url.strip(), detail="high")))
        print("[match-product-to-ads] Calling Grok...")
        response = chat.sample()
        response_text = response.content.strip()
        print(f"[match-product-to-ads] GROK RAW OUTPUT:\n{response_text}\n")

        try:
            json_str = extract_json_from_response(response_text)
            data = json.loads(json_str)
            raw_matched = data.get("matched_pairs") or []
            reasoning = data.get("reasoning", "")
            print(f"[match-product-to-ads] PARSED: raw_matched={raw_matched}, reasoning={reasoning[:150] if reasoning else 'nil'}...")
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Grok match-product-to-ads parse error: {e}")
            print(f"[match-product-to-ads] PARSE ERROR: {e}")
            return MatchProductToAdsResponse(success=True, matched_pairs=[], reasoning="Parse error")

        validated: List[CategorySubcategoryPair] = []
        pair_map = {(p.category.lower(), p.subcategory.lower()): p for p in pairs}
        seen_keys: set[tuple[str, str]] = set()
        for m in raw_matched:
            if len(validated) >= 20:
                break
            if isinstance(m, dict):
                cat = (m.get("category") or "").strip()
                sub = (m.get("subcategory") or "").strip()
                key = (cat.lower(), sub.lower())
                if key in pair_map and key not in seen_keys:
                    validated.append(pair_map[key])
                    seen_keys.add(key)
                elif key not in pair_map:
                    print(f"[match-product-to-ads] WARN: Grok returned ({cat!r}, {sub!r}) - not in pair_map")

        print(f"[match-product-to-ads] RESULT: {len(validated)} validated pairs (top 20) -> {[(p.category, p.subcategory) for p in validated]}")
        logger.info(f"Grok match-product-to-ads: {len(validated)} pairs matched for product image")
        return MatchProductToAdsResponse(
            success=True,
            matched_pairs=validated,
            reasoning=reasoning,
        )
    except Exception as e:
        logger.error(f"match_product_to_ads error: {e}", exc_info=True)
        return MatchProductToAdsResponse(
            success=False,
            matched_pairs=[],
            error=str(e),
        )


async def match_industry_to_categories(
    industry: str, 
    categories: List[str],
    brand_context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Use OpenAI GPT-4o to match industry + brand context to the most relevant inspiration categories.
    Returns a dict with matched_categories and reasoning.
    
    When brand_context is provided (business overview, popular products, customer demographics, brand story),
    GPT uses it to pick the best-matching category for more relevant ad inspirations.
    """
    try:
        print(f"\n[GPT-4o match_industry_to_categories] INPUT:")
        print(f"  industry: {industry!r}")
        print(f"  categories ({len(categories)}): {categories}")
        print(f"  brand_context: {brand_context}")

        categories_str = ", ".join(categories)

        brand_context_section = ""
        if brand_context:
            parts = []
            if brand_context.get("business_overview") and str(brand_context["business_overview"]).strip():
                parts.append(f"- **Business Overview**: {str(brand_context['business_overview'])[:800]}")
            if brand_context.get("popular_products"):
                prods = brand_context["popular_products"]
                if isinstance(prods, list):
                    prods_str = ", ".join(str(p)[:100] for p in prods[:10])
                else:
                    prods_str = str(prods)[:500]
                if prods_str:
                    parts.append(f"- **Popular Products/Services**: {prods_str}")
            if brand_context.get("customer_demographics") and str(brand_context["customer_demographics"]).strip():
                parts.append(f"- **Customer Demographics**: {str(brand_context['customer_demographics'])[:600]}")
            if brand_context.get("brand_story") and str(brand_context["brand_story"]).strip():
                parts.append(f"- **Brand Story**: {str(brand_context['brand_story'])[:500]}")
            if parts:
                brand_context_section = "\n\n## Brand Context (from website analysis)\n" + "\n".join(parts)
        
        prompt = f"""You are an AI assistant that matches businesses to content inspiration categories for ad creatives.

## Input
- **Industry/Business Type**: {industry}
- **Available Categories**: {categories_str}
{brand_context_section}

## Task
Determine which of the available categories would be MOST RELEVANT for showing ad inspiration to this business.
Use the industry and any brand context (business overview, products, demographics, brand story) to pick the best-matching category.

Consider:
1. What content styles would resonate with this brand's audience?
2. What products/services does the brand offer?
3. Who are their target customers?
4. Which category has the most overlap with their content needs?

## Rules
- ONLY select categories from the available list above
- Select at most 2 categories (the TOP 2 most relevant)
- If NONE of the available categories are a good match for the industry, return an empty array
- The categories you return MUST match EXACTLY (case-sensitive) from the available list

## Required Output Format
You MUST respond with a valid JSON object in this exact format:

```json
{{
    "matched_categories": ["Category1", "Category2"],
    "reasoning": "Brief explanation of why these categories match this industry"
}}
```

If no categories are relevant:
```json
{{
    "matched_categories": [],
    "reasoning": "No matching category - brief explanation of why none of the categories fit"
}}
```

Now analyze and respond with JSON only:"""

        prompt_preview = prompt[:800] + ("..." if len(prompt) > 800 else "")
        print(f"\n[GPT-4o match_industry_to_categories] PROMPT:\n{prompt_preview}")

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that responds only in valid JSON format. Do not include any text outside the JSON object."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=500
        )
        
        response_text = response.choices[0].message.content.strip()
        print(f"\n[GPT-4o match_industry_to_categories] RAW OUTPUT:\n{response_text}")
        logger.info(f"OpenAI raw response: {response_text[:500]}")
        
        # Parse JSON response
        try:
            json_str = extract_json_from_response(response_text)
            result = json.loads(json_str)

            print(f"\n[GPT-4o match_industry_to_categories] PARSED RESULT: {result}")
            logger.info(f"Parsed LLM response: {result}")
            
            # Validate structure
            matched = result.get("matched_categories", [])
            reasoning = result.get("reasoning", "")
            
            # Ensure matched_categories is a list
            if not isinstance(matched, list):
                matched = []
            
            # Validate that returned categories exist in the original list (exact match)
            validated = []
            for cat in matched:
                if isinstance(cat, str) and cat in categories:
                    validated.append(cat)
                else:
                    # Try case-insensitive match as fallback
                    for orig_cat in categories:
                        if orig_cat.lower() == str(cat).lower():
                            validated.append(orig_cat)
                            break
            
            # Return at most 2 categories
            result_to_return = {
                "matched_categories": validated[:2],
                "reasoning": reasoning
            }
            print(f"[GPT-4o match_industry_to_categories] FINAL OUTPUT: {result_to_return}\n")
            return result_to_return
            
        except (json.JSONDecodeError, ValueError) as parse_error:
            print(f"[GPT-4o match_industry_to_categories] PARSE ERROR: {parse_error}")
            logger.error(f"Failed to parse LLM JSON response: {parse_error}")
            logger.error(f"Raw response: {response_text}")
            return {
                "matched_categories": [],
                "reasoning": f"Failed to parse LLM response: {str(parse_error)}"
            }
        
    except Exception as e:
        logger.error(f"Error matching categories with OpenAI: {e}", exc_info=True)
        return {
            "matched_categories": [],
            "reasoning": f"Error during matching: {str(e)}"
        }


def select_weighted_videos(
    matched_categories: List[str],
    inspiration_links: List[InspirationLink],
    count: int
) -> List[InspirationLink]:
    """
    Select videos from matched categories with weighted distribution.
    For 6 videos: 4 from top category, 2 from second category.
    """
    if len(matched_categories) == 0:
        # No categories matched, return empty
        return []
    
    # Group links by category (case-insensitive matching)
    category_links: Dict[str, List[InspirationLink]] = {}
    for link in inspiration_links:
        cat_lower = link.category.lower()
        if cat_lower not in category_links:
            category_links[cat_lower] = []
        category_links[cat_lower].append(link)
    
    selected: List[InspirationLink] = []
    
    if len(matched_categories) >= 2:
        # Weighted distribution: 4 from first, 2 from second (for count=6)
        first_count = int(count * 2 / 3)  # 4 out of 6
        second_count = count - first_count  # 2 out of 6
        
        first_cat = matched_categories[0].lower()
        second_cat = matched_categories[1].lower()
        
        # Get links from first category
        first_links = category_links.get(first_cat, [])
        if first_links:
            selected.extend(random.sample(first_links, min(first_count, len(first_links))))
        
        # Get links from second category
        second_links = category_links.get(second_cat, [])
        if second_links:
            selected.extend(random.sample(second_links, min(second_count, len(second_links))))
    
    elif len(matched_categories) == 1:
        # Only one category, get all from it
        cat = matched_categories[0].lower()
        cat_links = category_links.get(cat, [])
        if cat_links:
            selected.extend(random.sample(cat_links, min(count, len(cat_links))))
    
    # If we don't have enough, fill with random from matched categories only
    if len(selected) < count:
        # Collect all links from matched categories
        all_matched_links = []
        for cat in matched_categories:
            all_matched_links.extend(category_links.get(cat.lower(), []))
        
        remaining_links = [l for l in all_matched_links if l not in selected]
        if remaining_links:
            additional = min(count - len(selected), len(remaining_links))
            selected.extend(random.sample(remaining_links, additional))
    
    return selected[:count]
