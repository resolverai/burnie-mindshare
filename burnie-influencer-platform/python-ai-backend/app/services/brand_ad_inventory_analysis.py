"""
Grok inventory analysis for brand ad images.
Analyzes ad creatives to extract product/inventory details and subcategory.
Used for matching relevant ad creatives during inspiration selection and ad creation.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.config.settings import settings

logger = logging.getLogger(__name__)

GROK_BATCH_SIZE = 8


def analyze_ad_images_with_grok(
    image_items: list[dict],
    batch_size: int = GROK_BATCH_SIZE,
) -> dict[str, dict[str, Any]]:
    """
    Analyze ad images with Grok: inventory analysis + subcategory per image.
    image_items: list of { "ad_id": str, "presigned_url": str, "category": str | None }
    Returns: { ad_id: { "inventoryAnalysis": {...}, "subcategory": str } }
    """
    if not image_items:
        return {}

    xai_key = (settings.xai_api_key or "").strip()
    if not xai_key:
        logger.warning("XAI_API_KEY not set, skipping Grok inventory analysis")
        return {}

    try:
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
    except ImportError:
        logger.warning("xai_sdk not installed, skipping Grok inventory analysis")
        return {}

    results: dict[str, dict[str, Any]] = {}

    for batch_start in range(0, len(image_items), batch_size):
        batch = image_items[batch_start : batch_start + batch_size]
        batch_num = (batch_start // batch_size) + 1
        total_batches = (len(image_items) + batch_size - 1) // batch_size

        presigned_urls = []
        ad_ids = []
        categories = []
        for item in batch:
            url = (item.get("presigned_url") or "").strip()
            ad_id = str(item.get("ad_id") or "").strip()
            if url and ad_id and (url.startswith("http://") or url.startswith("https://")):
                presigned_urls.append(url)
                ad_ids.append(ad_id)
                categories.append(item.get("category") or "Others")

        if not presigned_urls:
            continue

        system_prompt = """You are an expert e-commerce and retail inventory analyst. Your role is to analyze advertising creative images and extract:

1. INVENTORY ANALYSIS: For each image, provide a detailed analysis including:
   - Main products/items visible (e.g. shoes, bra, dress, lipstick, watch, bag)
   - Product type and style (e.g. athletic shoes, sports bra, cocktail dress)
   - Colors, materials, and visual details
   - Setting/context (e.g. lifestyle shot, product on white,模特 wearing)
   - Any text or branding visible
   - Overall composition and mood

2. SUBCATEGORY: The most specific product subcategory. This is CRITICAL for matching.
   - Examples: Sportswear → "athletic shoes", "sports bra", "running shorts"
   - Fashion → "maxi dress", "silk scarf", "leather handbag"
   - Beauty → "lipstick", "skincare serum", "mascara"
   - Home → "throw pillow", "candle", "vase"
   - Use 1-3 words, lowercase, specific (e.g. "running shoes" not just "shoes")

Respond ONLY with valid JSON. No markdown, no explanation."""

        image_list_str = "\n".join([f"- Image {i+1}: ad_id={ad_ids[i]}" for i in range(len(ad_ids))])
        user_prompt = f"""Analyze each of these {len(ad_ids)} ad creative images. For each image, the brand category may be: {", ".join(set(categories))}.

Images in this batch:
{image_list_str}

Return a JSON object with this EXACT structure:
{{
  "images": [
    {{
      "image_number": 1,
      "ad_id": "exact ad_id from the list above",
      "inventory_analysis": {{
        "objects": ["list of main products/items visible"],
        "product_type": "e.g. athletic footwear, lingerie, outerwear",
        "colors": ["primary colors"],
        "materials": ["if visible"],
        "setting": "brief description of scene/context",
        "text_or_branding": "any visible text or logos",
        "composition": "overall layout and mood"
      }},
      "subcategory": "specific subcategory 1-3 words e.g. running shoes, sports bra"
    }}
  ]
}}

Include ONE entry for EVERY image. Use exact ad_id from the list. subcategory MUST be specific and useful for matching (e.g. "yoga pants" not "clothing")."""

        max_retries = 2
        for retry in range(max_retries + 1):
            try:
                client = Client(api_key=xai_key, timeout=3600)
                chat = client.chat.create(model="grok-4-fast-reasoning")
                chat.append(system(system_prompt))
                image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
                chat.append(user(user_prompt, *image_objects))
                if retry > 0:
                    logger.info(f"Grok inventory batch {batch_num} retry {retry}/{max_retries}")
                response = chat.sample()
                response_text = response.content.strip()

                # Extract JSON
                if "```json" in response_text:
                    start = response_text.find("```json") + 7
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif "```" in response_text:
                    start = response_text.find("```") + 3
                    end = response_text.find("```", start)
                    json_content = response_text[start:end].strip()
                elif response_text.startswith("{"):
                    json_content = response_text
                else:
                    i = response_text.find("{")
                    j = response_text.rfind("}") + 1
                    json_content = response_text[i:j] if i >= 0 and j > i else "{}"
                json_content = re.sub(r",(\s*[}\]])", r"\1", json_content)
                data = json.loads(json_content)

                if "images" in data:
                    for entry in data["images"]:
                        num = entry.get("image_number", 0)
                        ad_id = entry.get("ad_id") or (ad_ids[num - 1] if 1 <= num <= len(ad_ids) else None)
                        inv = entry.get("inventory_analysis") or {}
                        subcat = (entry.get("subcategory") or "").strip() or None
                        if ad_id:
                            results[ad_id] = {
                                "inventoryAnalysis": inv,
                                "subcategory": subcat,
                            }
                    logger.info(f"Grok inventory batch {batch_num}/{total_batches}: {len(data['images'])} ads analyzed")
                break
            except Exception as e:
                err = str(e)
                retriable = "Failed to fetch response body" in err or "DATA_LOSS" in err or "downloading image" in err.lower()
                if retriable and retry < max_retries:
                    continue
                logger.warning(f"Grok inventory batch {batch_num} failed: {e}")
                break

    return results
