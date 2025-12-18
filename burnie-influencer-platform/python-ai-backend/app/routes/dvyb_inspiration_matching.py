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


class InspirationMatchRequest(BaseModel):
    """Request for matching industry to categories"""
    industry: str
    categories: List[str]
    inspiration_links: List[InspirationLink]
    count: int = 6  # Number of videos to return


class InspirationMatchResponse(BaseModel):
    """Response from inspiration matching"""
    success: bool
    data: Optional[Dict[str, Any]] = None
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
        
        # Step 1: Use OpenAI to match industry to categories
        match_result = await match_industry_to_categories(
            request.industry, 
            request.categories
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


async def match_industry_to_categories(industry: str, categories: List[str]) -> Dict[str, Any]:
    """
    Use OpenAI GPT-4o to match an industry to the most relevant categories.
    Returns a dict with matched_categories and reasoning.
    
    Response format (JSON):
    {
        "matched_categories": ["Category1", "Category2"],
        "reasoning": "Why these categories were selected"
    }
    
    If no categories match:
    {
        "matched_categories": [],
        "reasoning": "No matching category - explanation"
    }
    """
    try:
        categories_str = ", ".join(categories)
        
        prompt = f"""You are an AI assistant that matches business industries to content inspiration categories.

## Input
- **Industry/Business Type**: {industry}
- **Available Categories**: {categories_str}

## Task
Analyze the given industry and determine which of the available categories would be MOST RELEVANT for creating content inspiration for a business in this industry.

Consider:
1. What types of content styles would resonate with this industry's audience?
2. What content topics are commonly used in this industry?
3. Which categories have the most overlap with this industry's content needs?

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
        logger.info(f"OpenAI raw response: {response_text[:500]}")
        
        # Parse JSON response
        try:
            json_str = extract_json_from_response(response_text)
            result = json.loads(json_str)
            
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
            return {
                "matched_categories": validated[:2],
                "reasoning": reasoning
            }
            
        except (json.JSONDecodeError, ValueError) as parse_error:
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
