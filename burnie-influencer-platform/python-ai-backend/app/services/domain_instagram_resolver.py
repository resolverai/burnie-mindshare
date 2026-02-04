"""
Resolve Instagram handle for a brand domain using Gemini.
Used during domain product image fetch to also pull images from Instagram.
"""
import logging
import os
import re

import google.generativeai as genai

logger = logging.getLogger(__name__)

gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GEMINI_API_KEY")
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)


def resolve_instagram_handle(domain: str, website_url: str | None = None) -> str | None:
    """
    Ask Gemini for the Instagram handle associated with a brand domain.
    Returns the handle without @, or None if not found / API unavailable.
    """
    if not gemini_api_key:
        logger.warning("GEMINI_API_KEY not set, skipping Instagram handle resolution")
        return None

    domain = (domain or "").strip().lower()
    if not domain:
        return None

    url_hint = f" (website: {website_url})" if website_url else ""
    prompt = f"""Given the brand/company domain "{domain}"{url_hint}, what is their official Instagram handle?

Return ONLY the Instagram username (without @), e.g. "nike" or "starbucks".
If you don't know or can't find it, return exactly: NONE
Do not include any explanation, quotes, or other text."""

    try:
        model = genai.GenerativeModel(model_name="gemini-2.5-flash")
        response = model.generate_content(prompt)
        text = (response.text or "").strip().upper()
        if not text or text == "NONE" or text == "NULL" or text == "N/A":
            return None
        # Normalize: strip @, lowercase, alphanumeric + underscore only
        handle = re.sub(r"^@+", "", text).lower()
        handle = re.sub(r"[^a-z0-9_.]", "", handle)
        if len(handle) < 2 or len(handle) > 30:
            return None
        logger.info(f"📱 Resolved Instagram handle for {domain}: @{handle}")
        return handle
    except Exception as e:
        logger.warning(f"⚠️ Gemini Instagram resolution failed for {domain}: {e}")
        return None
