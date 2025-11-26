"""
DVYB Ad-Hoc Content Generation Endpoint
Handles on-demand content generation from the "Generate Content Now" button.

Generation Flow:
1. Gather context from dvyb_context table
2. Analyze user-uploaded images with Grok (inventory analysis)
3. Analyze user-provided links with OpenAI (web search)
4. Generate prompts with Grok (image + clip prompts)
5. Generate images with FAL
6. Generate clips with Kling
7. Save progressively to dvyb_generated_content table
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, File, Form, UploadFile
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
import uuid
import math
import random
from datetime import datetime
import asyncio
import httpx

from app.services.grok_prompt_service import grok_service
from app.utils.web2_s3_helper import web2_s3_helper
import fal_client
import os
from app.config.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Configure fal_client
fal_api_key = settings.fal_api_key
if fal_api_key:
    os.environ['FAL_KEY'] = fal_api_key

# Track active generation jobs
active_jobs: Dict[str, Any] = {}


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class DvybAdhocGenerationRequest(BaseModel):
    """Request for ad-hoc content generation"""
    account_id: int
    topic: str
    platforms: List[str]  # e.g., ["instagram", "twitter", "linkedin", "tiktok"]
    number_of_posts: int  # 1-4
    user_prompt: Optional[str] = None
    user_images: Optional[List[str]] = None  # S3 URLs
    inspiration_links: Optional[List[str]] = None


class DvybAdhocGenerationResponse(BaseModel):
    """Response from ad-hoc generation"""
    success: bool
    job_id: Optional[str] = None
    uuid: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


class GenerationStatus(BaseModel):
    """Status of a generation job"""
    success: bool
    status: str
    progress_percent: int
    progress_message: str
    data: Optional[Dict[str, Any]] = None


# ============================================
# DATABASE HELPERS
# ============================================

async def create_generation_record(account_id: int, request: DvybAdhocGenerationRequest, job_id: str, generation_uuid: str):
    """Create initial generation record in database"""
    import httpx
    
    try:
        backend_url = settings.typescript_backend_url
        
        data = {
            "accountId": account_id,
            "uuid": generation_uuid,
            "jobId": job_id,
            "generationType": "on_demand",
            "topic": request.topic,
            "userPrompt": request.user_prompt,
            "userImages": request.user_images,
            "numberOfPosts": request.number_of_posts,
            "status": "generating",
            "progressPercent": 0,
            "progressMessage": "Starting generation...",
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{backend_url}/api/dvyb/create",
                json=data
            )
            response.raise_for_status()
            
        logger.info(f"✅ Created generation record: {generation_uuid}")
        
    except Exception as e:
        logger.error(f"❌ Failed to create generation record: {e}")
        raise


async def update_progress_in_db(account_id: int, progress: int, message: str, metadata: Dict = None):
    """Update generation progress in database"""
    import httpx
    
    try:
        backend_url = settings.typescript_backend_url
        
        data = {
            "accountId": account_id,
            "progressPercent": progress,
            "progressMessage": message,
        }
        
        if metadata:
            data["metadata"] = metadata
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{backend_url}/api/dvyb/update-progress",
                json=data
            )
            response.raise_for_status()
            
        logger.info(f"✅ Updated progress: {progress}% - {message}")
        
    except Exception as e:
        logger.error(f"❌ Failed to update progress: {e}")


async def save_generated_content_to_db(account_id: int, generation_uuid: str, platform_texts: List, frame_prompts: List, clip_prompts: List, image_urls: List, video_urls: List):
    """Save generated content to database"""
    import httpx
    
    try:
        backend_url = settings.typescript_backend_url
        
        data = {
            "uuid": generation_uuid,
            "platformTexts": platform_texts,
            "framePrompts": frame_prompts,
            "clipPrompts": clip_prompts,
            "generatedImageUrls": image_urls,
            "generatedVideoUrls": video_urls,
            "status": "completed",
            "progressPercent": 100,
            "progressMessage": "Generation completed!",
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{backend_url}/api/dvyb/save-content",
                json=data
            )
            response.raise_for_status()
            
        logger.info(f"✅ Saved generated content to database")
        
    except Exception as e:
        logger.error(f"❌ Failed to save content: {e}")
        raise


# ============================================
# CONTEXT GATHERING
# ============================================

async def gather_context(request: DvybAdhocGenerationRequest) -> Dict:
    """Gather all context for generation"""
    import httpx
    
    context = {
        "topic": request.topic,
        "platforms": request.platforms,
        "number_of_posts": request.number_of_posts,
        "user_prompt": request.user_prompt,
    }
    
    # Fetch dvyb_context from backend (internal endpoint, no auth required)
    try:
        backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{backend_url}/api/dvyb/context/internal",
                params={"accountId": request.account_id}
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success") and result.get("data"):
                context["dvyb_context"] = result["data"]
                logger.info(f"✅ Fetched dvyb_context for account {request.account_id}")
            else:
                logger.warning(f"⚠️ No dvyb_context found for account {request.account_id}")
                context["dvyb_context"] = {}
                
    except Exception as e:
        logger.error(f"❌ Failed to fetch dvyb_context: {e}")
        context["dvyb_context"] = {}
    
    return context


# ============================================
# IMAGE ANALYSIS (GROK INVENTORY ANALYSIS)
# ============================================

async def analyze_user_images(user_images: List[str], context: Dict) -> Dict:
    """Analyze user-uploaded images with Grok using full brand context"""
    if not user_images:
        return {}
    
    try:
        print("=" * 80)
        print("🔍 GROK INVENTORY ANALYSIS (WITH BRAND CONTEXT)")
        print("=" * 80)
        print(f"📸 Number of images: {len(user_images)}")
        print(f"📸 Image URLs: {user_images}")
        
        # Get full brand context
        dvyb_context = context.get("dvyb_context", {})
        
        # Extract relevant brand information
        brand_info = {
            "account_name": dvyb_context.get("accountName", ""),
            "website": dvyb_context.get("website", ""),
            "industry": dvyb_context.get("industry", "General"),
            "business_overview": dvyb_context.get("businessOverview", ""),
            "customer_demographics": dvyb_context.get("customerDemographics", ""),
            "popular_products": dvyb_context.get("popularProducts", []),
            "brand_voice": dvyb_context.get("brandVoice", ""),
            "why_customers_choose": dvyb_context.get("whyCustomersChoose", ""),
        }
        
        print(f"🏢 Brand: {brand_info['account_name']}")
        print(f"🏢 Industry: {brand_info['industry']}")
        print(f"🏢 Business Overview: {brand_info['business_overview'][:100] if brand_info['business_overview'] else 'N/A'}...")
        
        # Generate presigned URLs for Grok
        presigned_urls = []
        for url in user_images:
            try:
                presigned_url = web2_s3_helper.generate_presigned_url(url)
                presigned_urls.append(presigned_url)
            except Exception as e:
                logger.error(f"❌ Failed to generate presigned URL for {url}: {e}")
                presigned_urls.append(url)  # Fallback to original URL
        
        print(f"🔗 Presigned URLs generated: {len(presigned_urls)}")
        
        # Call Grok inventory analysis with brand context
        from xai_sdk import Client
        from xai_sdk.chat import user, system, image
        import json
        
        # Build dynamic, context-aware analysis prompt
        analysis_prompt = f"""You are an expert visual analyst for {brand_info['account_name']}.

BRAND CONTEXT:
- Business: {brand_info['account_name']}
- Industry: {brand_info['industry']}
- Website: {brand_info['website']}
- What we do: {brand_info['business_overview'][:500] if brand_info['business_overview'] else 'N/A'}
- Target Customers: {brand_info['customer_demographics'][:300] if brand_info['customer_demographics'] else 'N/A'}
- Popular Products/Services: {brand_info['popular_products'][:300] if isinstance(brand_info['popular_products'], str) else str(brand_info['popular_products'])[:300] if brand_info['popular_products'] else 'N/A'}
- Brand Voice: {brand_info['brand_voice'][:200] if brand_info['brand_voice'] else 'N/A'}

TASK:
The user has uploaded {len(presigned_urls)} inspiration image(s) for content generation. These images are DIRECTLY RELATED to their business.

Analyze each image and determine:
- What type of image is this? (product, location, person, art style, interior, food, object, abstract, etc.)
- What are the key visual elements, colors, styles, and mood?
- How does this relate to {brand_info['account_name']}'s business?
- What insights can be extracted for content generation?

IMPORTANT:
- Generate DYNAMIC JSON keys based on what you actually see in the images
- Do NOT use hardcoded structures - adapt to the image content
- Be specific and detailed
- Focus on actionable insights for content creation
- Consider the brand context when analyzing

OUTPUT FORMAT:
Return ONLY a JSON object. Use "image_1", "image_2", etc. as top-level keys.
For each image, create DYNAMIC nested keys based on your analysis.

Example for a product image:
{{
  "image_1": {{
    "type": "product_photo",
    "category": "athletic footwear",
    "visual_elements": {{
      "colors": ["black", "white", "neon green"],
      "style": "modern minimalist",
      "composition": "centered product shot with clean background"
    }},
    "brand_alignment": "matches brand's focus on performance and style",
    "content_suggestions": "emphasize durability and design innovation"
  }}
}}

Example for a location image:
{{
  "image_1": {{
    "type": "location_photo",
    "setting": "mountain landscape at sunrise",
    "visual_elements": {{
      "colors": ["golden orange", "deep blue", "purple hues"],
      "mood": "inspirational and peaceful",
      "composition": "wide angle with dramatic lighting"
    }},
    "brand_alignment": "aligns with brand's adventure travel focus",
    "content_suggestions": "use for aspirational content about outdoor experiences"
  }}
}}

Analyze the {len(presigned_urls)} image(s) and provide insights relevant to {brand_info['account_name']}.
"""

        print(f"🤖 Calling Grok with brand-aware analysis...")
        
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(
            f"You are an expert visual analyst for {brand_info['account_name']}. "
            f"Analyze images in the context of their business and provide detailed, "
            f"actionable insights in dynamic JSON format. NEVER use hardcoded structures - "
            f"adapt your analysis to what you actually see in the images."
        ))
        
        # Create image objects
        image_objects = [image(image_url=url, detail="high") for url in presigned_urls]
        
        chat.append(user(analysis_prompt, *image_objects))
        
        response = chat.sample()
        analysis_text = response.content.strip()
        
        print(f"📝 Grok raw response: {analysis_text[:300]}...")
        
        # Parse JSON response (handle markdown)
        import re
        
        try:
            # Remove markdown code blocks if present
            if "```json" in analysis_text:
                json_start = analysis_text.find("```json") + 7
                json_end = analysis_text.find("```", json_start)
                json_content = analysis_text[json_start:json_end].strip()
            elif "```" in analysis_text:
                # Handle generic code blocks
                json_start = analysis_text.find("```") + 3
                json_end = analysis_text.find("```", json_start)
                json_content = analysis_text[json_start:json_end].strip()
            elif analysis_text.startswith("{") and analysis_text.endswith("}"):
                json_content = analysis_text
            else:
                # Try to find JSON object
                start_idx = analysis_text.find("{")
                end_idx = analysis_text.rfind("}") + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_content = analysis_text[start_idx:end_idx]
                else:
                    raise ValueError("No valid JSON found in response")
            
            # Parse JSON
            inventory_analysis = json.loads(json_content)
            
            print(f"✅ Inventory analysis completed")
            print(f"📊 Analysis keys: {list(inventory_analysis.keys())}")
            print(f"📊 Full analysis: {json.dumps(inventory_analysis, indent=2)}")
            print("=" * 80)
            
            return inventory_analysis
            
        except (json.JSONDecodeError, ValueError) as e:
            print(f"❌ Failed to parse JSON: {e}")
            print(f"❌ Raw response: {analysis_text}")
            # Return minimal fallback
            return {
                f"image_{i+1}": {
                    "type": "uploaded_image",
                    "note": "Analysis temporarily unavailable",
                    "raw_response": analysis_text[:200]
                }
                for i in range(len(presigned_urls))
            }
        
    except Exception as e:
        logger.error(f"❌ Image analysis failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return {}


# ============================================
# LINK ANALYSIS (OPENAI WEB SEARCH)
# ============================================

async def analyze_inspiration_links(links: List[str]) -> Dict:
    """Analyze inspiration links with OpenAI web search"""
    if not links or all(not link.strip() for link in links):
        return {}
    
    try:
        print("=" * 80)
        print("🔗 OPENAI LINK ANALYSIS")
        print("=" * 80)
        
        # Filter out empty links
        valid_links = [link.strip() for link in links if link.strip()]
        print(f"🔗 Number of links: {len(valid_links)}")
        print(f"🔗 Links: {valid_links}")
        
        from openai import OpenAI
        import os
        
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        
        # Extract domains for filtering
        import urllib.parse
        domains = []
        for link in valid_links:
            try:
                parsed = urllib.parse.urlparse(link)
                domain = parsed.netloc or parsed.path
                if domain:
                    domains.append(domain)
            except:
                continue
        
        print(f"🌐 Domains extracted: {domains}")
        
        # Use Responses API with web search
        response = openai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a web content analyzer. Extract and summarize key information from the specified websites."
                },
                {
                    "role": "user",
                    "content": f"""Please gather comprehensive information from these websites:
{', '.join(valid_links)}

Extract and summarize:
1. Key features, products, or services
2. Important metrics, statistics, or data points
3. Design styles, aesthetics, or visual elements
4. Content strategies or messaging approaches
5. Any unique or notable characteristics

Return a concise summary of insights from all links combined."""
                }
            ],
            extra_body={
                "web_search_options": {
                    "domain_filter": domains if domains else None
                }
            }
        )
        
        link_analysis_text = response.choices[0].message.content
        
        print(f"✅ Link analysis completed")
        print(f"📊 Analysis result: {link_analysis_text[:300]}...")
        print("=" * 80)
        
        # Handle potential markdown in response
        import re
        
        # Remove markdown formatting if present
        cleaned_text = link_analysis_text
        
        # Remove markdown code blocks
        cleaned_text = re.sub(r'```[\s\S]*?```', '', cleaned_text)
        
        # Remove markdown headers
        cleaned_text = re.sub(r'#{1,6}\s+', '', cleaned_text)
        
        # Remove bold/italic markers
        cleaned_text = re.sub(r'\*\*([^\*]+)\*\*', r'\1', cleaned_text)
        cleaned_text = re.sub(r'\*([^\*]+)\*', r'\1', cleaned_text)
        cleaned_text = re.sub(r'__([^_]+)__', r'\1', cleaned_text)
        cleaned_text = re.sub(r'_([^_]+)_', r'\1', cleaned_text)
        
        # Clean up extra whitespace
        cleaned_text = re.sub(r'\n\s*\n', '\n\n', cleaned_text).strip()
        
        return {
            "summary": cleaned_text,
            "raw_summary": link_analysis_text  # Keep original for context
        }
        
    except Exception as e:
        logger.error(f"❌ Link analysis failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return {}


# ============================================
# PROMPT GENERATION
# ============================================

async def generate_prompts_with_grok(request: DvybAdhocGenerationRequest, context: Dict) -> Dict:
    """Generate image and clip prompts with Grok"""
    
    # Calculate number of images and clips
    number_of_posts = request.number_of_posts
    num_clips = math.ceil(number_of_posts / 2)
    num_images = number_of_posts - num_clips
    
    print("=" * 80)
    print("🤖 GROK PROMPT GENERATION")
    print("=" * 80)
    print(f"📝 Topic: {request.topic}")
    print(f"📝 Platforms: {request.platforms}")
    print(f"📝 Number of posts: {number_of_posts}")
    print(f"📝 Number of clips: {num_clips}")
    print(f"📝 Number of images: {num_images}")
    print(f"📝 User prompt: {request.user_prompt}")
    print(f"📝 User images: {len(request.user_images) if request.user_images else 0}")
    print(f"📝 Inspiration links: {len(request.inspiration_links) if request.inspiration_links else 0}")
    print(f"📝 Context keys: {list(context.keys())}")
    
    # Randomly determine which posts will be clips
    all_indices = list(range(number_of_posts))
    random.shuffle(all_indices)
    clip_indices = set(all_indices[:num_clips])
    
    print(f"🎲 Clip indices: {sorted(clip_indices)}")
    print(f"🖼️ Image indices: {sorted([i for i in all_indices if i not in clip_indices])}")
    
    # Build comprehensive prompt for Grok
    dvyb_context = context.get("dvyb_context", {})
    inventory_analysis = context.get("inventory_analysis", {})
    link_analysis = context.get("link_analysis", {})
    
    # Format inventory analysis for Grok (pass as-is with dynamic structure)
    inventory_analysis_str = "None"
    if inventory_analysis:
        import json
        inventory_analysis_str = json.dumps(inventory_analysis, indent=2)
    
    # Format link analysis for Grok
    link_analysis_str = "None"
    if link_analysis:
        link_analysis_str = link_analysis.get("summary", "None")
    
    system_prompt = f"""You are an expert content creator for social media marketing.

Generate {number_of_posts} pieces of content for the topic: "{request.topic}"

BRAND CONTEXT:
- Business: {dvyb_context.get('accountName', 'N/A')}
- Industry: {dvyb_context.get('industry', 'N/A')}
- Brand Voice: {dvyb_context.get('brandVoice', 'N/A')}
- Brand Colors: {dvyb_context.get('colorPalette', 'N/A')}
- Social Post Colors: {dvyb_context.get('socialPostColors', dvyb_context.get('colorPalette', 'N/A'))}
- Target Audience: {dvyb_context.get('customerDemographics', 'N/A')[:500] if dvyb_context.get('customerDemographics') else 'N/A'}
- Business Overview: {dvyb_context.get('businessOverview', 'N/A')[:500] if dvyb_context.get('businessOverview') else 'N/A'}
- Popular Products/Services: {str(dvyb_context.get('popularProducts', 'N/A'))[:300] if dvyb_context.get('popularProducts') else 'N/A'}

USER INSTRUCTIONS: {request.user_prompt if request.user_prompt else 'None'}

UPLOADED IMAGES ANALYSIS (Dynamic structure - use these insights for content generation):
{inventory_analysis_str}

INSPIRATION LINKS ANALYSIS:
{link_analysis_str}

GENERATE:
1. {number_of_posts} image prompts (for FAL image generation) - highly detailed, visual descriptions
2. Platform-specific text for: {', '.join(request.platforms)}
   - Twitter: Single post only (no threads, no longposts, max 280 chars)
   - Instagram: Caption with relevant hashtags
   - LinkedIn: Professional post
   - TikTok: Engaging caption

Return ONLY valid JSON with this structure:
{{
  "image_prompts": [
    "Detailed visual prompt 1...",
    "Detailed visual prompt 2...",
    ...
  ],
  "platform_texts": [
    {{
      "post_index": 0,
      "topic": "{request.topic}",
      "content_type": "image" or "clip",
      "platforms": {{
        "instagram": "Caption text...",
        "twitter": "Tweet text...",
        "linkedin": "Post text...",
        "tiktok": "Caption text..."
      }}
    }},
    ...
  ]
}}

IMPORTANT:
- Image prompts should be highly detailed for AI image generation
- Prompts should incorporate brand colors: {dvyb_context.get('socialPostColors', dvyb_context.get('colorPalette', {}))}
- Content should align with brand voice and target audience
- Post {num_clips} entries will be clips (indices: {sorted(clip_indices)}), rest are images
"""
    
    # Debug logging
    print(f"\n📊 INVENTORY ANALYSIS PASSED TO GROK:")
    print(inventory_analysis_str[:500] if len(inventory_analysis_str) > 500 else inventory_analysis_str)
    print(f"\n📊 LINK ANALYSIS PASSED TO GROK:")
    print(link_analysis_str[:500] if len(link_analysis_str) > 500 else link_analysis_str)
    print(f"\n📊 FULL SYSTEM PROMPT (first 1000 chars):")
    print(system_prompt[:1000] if len(system_prompt) > 1000 else system_prompt)
    print("=" * 80)

    try:
        # Call Grok
        from xai_sdk import Client
        from xai_sdk.chat import user, system
        
        client = Client(api_key=settings.xai_api_key, timeout=3600)
        chat = client.chat.create(model="grok-4-latest")
        
        chat.append(system(system_prompt))
        chat.append(user(f"Generate {number_of_posts} pieces of content for: {request.topic}"))
        
        print("🤖 Calling Grok for prompt generation...")
        response = chat.sample()
        response_text = response.content.strip()
        
        # LOG FULL GROK OUTPUT (NOT TRUNCATED)
        print("=" * 80)
        print("🤖 GROK RAW OUTPUT (FULL)")
        print("=" * 80)
        print(response_text)
        print("=" * 80)
        
        # Parse JSON response (handle markdown and code blocks)
        import json
        import re
        
        # Extract JSON from response (robust markdown handling)
        json_content = None
        
        # Method 1: Look for ```json code block
        if "```json" in response_text:
            json_start = response_text.find("```json") + 7
            json_end = response_text.find("```", json_start)
            if json_end > json_start:
                json_content = response_text[json_start:json_end].strip()
                print(f"✅ Found JSON in ```json code block")
        
        # Method 2: Look for generic ``` code block
        elif "```" in response_text:
            json_start = response_text.find("```") + 3
            json_end = response_text.find("```", json_start)
            if json_end > json_start:
                potential_json = response_text[json_start:json_end].strip()
                # Check if it starts with { (likely JSON)
                if potential_json.startswith("{"):
                    json_content = potential_json
                    print(f"✅ Found JSON in generic ``` code block")
        
        # Method 3: Response is pure JSON
        if not json_content and response_text.startswith("{") and response_text.endswith("}"):
            json_content = response_text
            print(f"✅ Response is pure JSON")
        
        # Method 4: Search for JSON object
        if not json_content:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                json_content = json_match.group(0)
                print(f"✅ Found JSON via regex search")
        
        if not json_content:
            raise ValueError("No valid JSON found in Grok response")
        
        print(f"\n📝 EXTRACTED JSON (first 500 chars):")
        print(json_content[:500])
        print("=" * 80)
        
        # Remove any remaining markdown formatting within JSON values
        # (Grok might include markdown in text fields)
        # NOTE: Don't remove underscores as they're used in JSON keys (image_prompts, platform_texts)
        json_content = re.sub(r'\*\*([^\*]+)\*\*', r'\1', json_content)  # Bold
        json_content = re.sub(r'__([^_]+)__', r'\1', json_content)  # Bold (double underscore only)
        # Skip single underscore/asterisk removal - they might be in JSON keys or valid text
        
        prompts_data = json.loads(json_content)
        
        # DEBUG: Log parsed JSON structure
        print("\n🔍 DEBUG: Parsed JSON structure:")
        print(f"  Keys: {list(prompts_data.keys())}")
        print(f"  image_prompts type: {type(prompts_data.get('image_prompts'))}")
        print(f"  image_prompts length: {len(prompts_data.get('image_prompts', [])) if isinstance(prompts_data.get('image_prompts'), list) else 'N/A'}")
        print(f"  platform_texts type: {type(prompts_data.get('platform_texts'))}")
        print(f"  platform_texts length: {len(prompts_data.get('platform_texts', [])) if isinstance(prompts_data.get('platform_texts'), list) else 'N/A'}")
        
        # Extract image prompts and platform texts
        image_prompts = prompts_data.get("image_prompts", [])
        platform_texts = prompts_data.get("platform_texts", [])
        
        # DEBUG: Log extracted data
        print(f"\n🔍 DEBUG: After extraction:")
        print(f"  image_prompts: {len(image_prompts)} items")
        print(f"  platform_texts: {len(platform_texts)} items")
        print(f"  clip_indices: {clip_indices}")
        
        # Generate clip prompts from randomly selected image prompts
        clip_prompts = []
        frame_prompts = []
        
        for i, prompt in enumerate(image_prompts):
            if i in clip_indices:
                # This is a clip - generate clip prompt based on image prompt
                clip_prompt = f"10-second video clip: {prompt}. Smooth camera movement, cinematic lighting, engaging motion."
                clip_prompts.append(clip_prompt)
            
            # All image prompts are frame prompts
            frame_prompts.append(prompt)
        
        # Update platform_texts with correct content_type
        for i, text_entry in enumerate(platform_texts):
            text_entry["content_type"] = "clip" if i in clip_indices else "image"
        
        print(f"✅ Generated {len(frame_prompts)} frame prompts")
        print(f"✅ Generated {len(clip_prompts)} clip prompts")
        print(f"✅ Generated platform texts for {len(platform_texts)} posts")
        print("=" * 80)
        
        return {
            "frame_prompts": frame_prompts,
            "clip_prompts": clip_prompts,
            "platform_texts": platform_texts,
            "clip_indices": sorted(clip_indices),
        }
        
    except Exception as e:
        logger.error(f"❌ Prompt generation failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        raise


# ============================================
# CONTENT GENERATION
# ============================================

async def generate_content(request: DvybAdhocGenerationRequest, prompts: Dict, context: Dict, generation_uuid: str):
    """Generate images and clips with FAL and Kling"""
    
    frame_prompts = prompts["frame_prompts"]
    clip_prompts = prompts["clip_prompts"]
    clip_indices = prompts["clip_indices"]
    
    generated_images = []
    generated_videos = []
    
    # Generate all images first
    print("=" * 80)
    print("🎨 FAL IMAGE GENERATION")
    print("=" * 80)
    
    for i, prompt in enumerate(frame_prompts):
        if i in clip_indices:
            print(f"⏭️ Skipping image {i} (will be used for clip)")
            generated_images.append(None)
            continue
        
        try:
            print(f"🎨 Generating image {i+1}/{len(frame_prompts)}...")
            print(f"📝 Prompt: {prompt[:100]}...")
            
            # Generate image with FAL
            arguments = {
                "prompt": prompt,
                "image_size": "landscape_16_9",
                "num_inference_steps": 28,
                "guidance_scale": 3.5,
                "num_images": 1,
                "enable_safety_checker": False,
                "output_format": "png"
            }
            
            result = await asyncio.to_thread(
                fal_client.subscribe,
                "fal-ai/fast-sdxl",
                arguments=arguments,
                with_logs=True
            )
            
            image_url = None
            if result and "images" in result and len(result["images"]) > 0:
                image_url = result["images"][0]["url"]
            
            if image_url:
                # Upload to S3
                s3_url = web2_s3_helper.upload_from_url(
                    url=image_url,
                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}",
                    filename=f"image_{i}.png"
                )
                generated_images.append(s3_url)
                print(f"✅ Image {i} generated and uploaded: {s3_url}")
                
                # Update progress
                progress = 40 + int((i + 1) / len(frame_prompts) * 30)
                await update_progress_in_db(
                    request.account_id,
                    progress,
                    f"Generated image {i+1}/{len(frame_prompts)}"
                )
            else:
                generated_images.append(None)
                print(f"❌ Failed to generate image {i}")
                
        except Exception as e:
            logger.error(f"❌ Image generation failed for prompt {i}: {e}")
            generated_images.append(None)
    
    print("=" * 80)
    
    # Generate clips
    print("=" * 80)
    print("🎬 KLING CLIP GENERATION")
    print("=" * 80)
    
    for clip_idx, (i, prompt) in enumerate(zip(clip_indices, clip_prompts)):
        try:
            print(f"🎬 Generating clip {clip_idx+1}/{len(clip_prompts)} (post index {i})...")
            print(f"📝 Prompt: {prompt[:100]}...")
            
            # Generate first frame image for the clip
            frame_prompt = frame_prompts[i]
            print(f"🖼️ Generating frame image for clip...")
            
            # Generate frame with FAL
            frame_arguments = {
                "prompt": frame_prompt,
                "image_size": "landscape_16_9",
                "num_inference_steps": 28,
                "guidance_scale": 3.5,
                "num_images": 1,
                "enable_safety_checker": False,
                "output_format": "png"
            }
            
            frame_result = await asyncio.to_thread(
                fal_client.subscribe,
                "fal-ai/fast-sdxl",
                arguments=frame_arguments,
                with_logs=True
            )
            
            frame_url = None
            if frame_result and "images" in frame_result and len(frame_result["images"]) > 0:
                frame_url = frame_result["images"][0]["url"]
            
            if not frame_url:
                print(f"❌ Failed to generate frame image for clip {i}")
                generated_videos.append(None)
                continue
            
            print(f"✅ Frame image generated (FAL URL): {frame_url}")
            
            # Upload frame to S3 first
            try:
                frame_s3_url = web2_s3_helper.upload_from_url(
                    url=frame_url,
                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}/frames",
                    filename=f"frame_{i}.png"
                )
                print(f"✅ Frame uploaded to S3: {frame_s3_url}")
                
                # Generate presigned URL for Kling
                frame_presigned_url = web2_s3_helper.generate_presigned_url(frame_s3_url)
                print(f"✅ Frame presigned URL generated: {frame_presigned_url[:100]}...")
                
            except Exception as e:
                print(f"⚠️ Failed to upload frame to S3: {e}, using FAL URL directly")
                frame_presigned_url = frame_url  # Fallback to FAL URL
            
            # Generate clip with Kling using presigned URL
            kling_api_key = settings.kling_api_key
            if not kling_api_key:
                print(f"❌ Kling API key not configured, skipping clip generation")
                generated_videos.append(None)
                continue
            
            headers = {
                "Authorization": f"Bearer {kling_api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "prompt": prompt,
                "image": frame_presigned_url,
                "duration": 10,  # 10 seconds
                "aspect_ratio": "16:9",
                "cfg_scale": 0.5,
            }
            
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    "https://api.piapi.ai/api/kling/v1/video/generations",
                    headers=headers,
                    json=payload
                )
                
                if response.status_code != 200:
                    print(f"❌ Kling API error: {response.status_code}")
                    generated_videos.append(None)
                    continue
                
                result = response.json()
                task_id = result.get("data", {}).get("task_id")
                
                if not task_id:
                    print(f"❌ No task ID returned from Kling")
                    generated_videos.append(None)
                    continue
                
                print(f"✅ Kling task started: {task_id}")
                
                # Poll for completion
                max_attempts = 60  # 5 minutes max
                clip_url = None
                
                for attempt in range(max_attempts):
                    await asyncio.sleep(5)
                    
                    status_response = await client.get(
                        f"https://api.piapi.ai/api/kling/v1/video/generations/{task_id}",
                        headers=headers
                    )
                    
                    if status_response.status_code == 200:
                        status_data = status_response.json()
                        task_status = status_data.get("data", {}).get("task_status")
                        
                        if task_status == "succeed":
                            clip_url = status_data.get("data", {}).get("task_result", {}).get("videos", [{}])[0].get("url")
                            if clip_url:
                                print(f"✅ Kling clip generated: {clip_url}")
                                break
                        elif task_status == "failed":
                            print(f"❌ Kling video generation failed")
                            break
                    
                    print(f"⏳ Waiting for Kling... attempt {attempt + 1}/{max_attempts}")
                
                if not clip_url:
                    print(f"❌ Kling video generation timed out or failed")
                    generated_videos.append(None)
                    continue
            
            if clip_url:
                # Upload to S3
                s3_url = web2_s3_helper.upload_from_url(
                    url=clip_url,
                    folder=f"dvyb/generated/{request.account_id}/{generation_uuid}",
                    filename=f"clip_{i}.mp4"
                )
                generated_videos.append(s3_url)
                print(f"✅ Clip {i} generated and uploaded: {s3_url}")
                
                # Update progress
                progress = 70 + int((clip_idx + 1) / len(clip_prompts) * 25)
                await update_progress_in_db(
                    request.account_id,
                    progress,
                    f"Generated clip {clip_idx+1}/{len(clip_prompts)}"
                )
            else:
                generated_videos.append(None)
                print(f"❌ Failed to generate clip {i}")
                
        except Exception as e:
            logger.error(f"❌ Clip generation failed for prompt {i}: {e}")
            generated_videos.append(None)
    
    print("=" * 80)
    
    return {
        "images": [url for url in generated_images if url],
        "videos": [url for url in generated_videos if url],
    }


# ============================================
# MAIN GENERATION PIPELINE
# ============================================

async def run_adhoc_generation_pipeline(job_id: str, request: DvybAdhocGenerationRequest, generation_uuid: str):
    """Run the complete ad-hoc generation pipeline"""
    
    try:
        print("\n" + "=" * 80)
        print("🚀 DVYB AD-HOC GENERATION PIPELINE STARTED")
        print("=" * 80)
        print(f"📋 Job ID: {job_id}")
        print(f"📋 UUID: {generation_uuid}")
        print(f"📋 Account ID: {request.account_id}")
        print(f"📋 Topic: {request.topic}")
        print(f"📋 Platforms: {request.platforms}")
        print(f"📋 Number of posts: {request.number_of_posts}")
        print("=" * 80 + "\n")
        
        # Step 1: Gather context (10%)
        await update_progress_in_db(request.account_id, 10, "Gathering context...")
        context = await gather_context(request)
        print(f"✅ Context gathered: {list(context.keys())}")
        
        # Step 2: Analyze user images (20%)
        if request.user_images:
            await update_progress_in_db(request.account_id, 20, "Analyzing uploaded images...")
            inventory_analysis = await analyze_user_images(request.user_images, context)
            context["inventory_analysis"] = inventory_analysis
        else:
            print("⏭️ Skipping inventory analysis - no user images provided")
        
        # Step 3: Analyze inspiration links (25%)
        if request.inspiration_links:
            await update_progress_in_db(request.account_id, 25, "Analyzing inspiration links...")
            link_analysis = await analyze_inspiration_links(request.inspiration_links)
            context["link_analysis"] = link_analysis
        else:
            print("⏭️ Skipping link analysis - no inspiration links provided")
        
        # Step 4: Generate prompts (35%)
        await update_progress_in_db(request.account_id, 35, "Generating prompts...")
        prompts = await generate_prompts_with_grok(request, context)
        
        # Step 5: Generate content (40-95%)
        await update_progress_in_db(request.account_id, 40, "Generating images and clips...")
        generated_content = await generate_content(request, prompts, context, generation_uuid)
        
        # Step 6: Save to database (100%)
        await update_progress_in_db(request.account_id, 98, "Saving content...")
        await save_generated_content_to_db(
            account_id=request.account_id,
            generation_uuid=generation_uuid,
            platform_texts=prompts["platform_texts"],
            frame_prompts=prompts["frame_prompts"],
            clip_prompts=prompts["clip_prompts"],
            image_urls=generated_content["images"],
            video_urls=generated_content["videos"],
        )
        
        await update_progress_in_db(request.account_id, 100, "Generation completed!")
        
        print("\n" + "=" * 80)
        print("✅ DVYB AD-HOC GENERATION PIPELINE COMPLETED")
        print("=" * 80)
        print(f"📊 Generated {len(generated_content['images'])} images")
        print(f"📊 Generated {len(generated_content['videos'])} clips")
        print(f"📊 Generated {len(prompts['platform_texts'])} platform texts")
        print("=" * 80 + "\n")
        
    except Exception as e:
        logger.error(f"❌ Generation pipeline failed: {e}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        
        # Update database with error
        try:
            await update_progress_in_db(
                request.account_id,
                0,
                f"Generation failed: {str(e)}",
                {"error": str(e)}
            )
        except:
            pass


# ============================================
# FILE UPLOAD
# ============================================

@router.post("/upload")
async def upload_user_image(
    file: UploadFile = File(...),
    accountId: int = Form(...)
):
    """Upload user image for ad-hoc generation"""
    
    try:
        from fastapi import File, Form, UploadFile
        import tempfile
        import os
        
        # Validate file type
        allowed_types = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Invalid file type. Only PNG, JPG, JPEG, and WEBP allowed")
        
        # Generate unique filename
        file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'png'
        unique_filename = f"{uuid.uuid4()}.{file_extension}"
        
        # Save temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}") as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Upload to S3
            s3_url = web2_s3_helper.upload_file(
                file_path=temp_file_path,
                folder=f"dvyb/user-uploads/{accountId}",
                filename=unique_filename
            )
            
            logger.info(f"✅ Uploaded user image to S3: {s3_url}")
            
            return {
                "success": True,
                "s3_url": s3_url,
                "filename": unique_filename,
            }
            
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        
    except Exception as e:
        logger.error(f"❌ Image upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# API ENDPOINTS
# ============================================

@router.post("/generate", response_model=DvybAdhocGenerationResponse)
async def generate_adhoc_content(request: DvybAdhocGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate ad-hoc content from "Generate Content Now" button
    
    This endpoint:
    1. Creates a generation job
    2. Starts background generation pipeline
    3. Returns job_id for progress tracking
    """
    
    try:
        # Generate unique identifiers
        job_id = str(uuid.uuid4())
        generation_uuid = str(uuid.uuid4())
        
        # Create generation record
        await create_generation_record(request.account_id, request, job_id, generation_uuid)
        
        # Start background generation
        background_tasks.add_task(
            run_adhoc_generation_pipeline,
            job_id,
            request,
            generation_uuid
        )
        
        logger.info(f"✅ Started ad-hoc generation job: {job_id}")
        
        return DvybAdhocGenerationResponse(
            success=True,
            job_id=job_id,
            uuid=generation_uuid,
            message="Generation started"
        )
        
    except Exception as e:
        logger.error(f"❌ Failed to start generation: {e}")
        return DvybAdhocGenerationResponse(
            success=False,
            error=str(e)
        )


@router.get("/status/{account_id}", response_model=GenerationStatus)
async def get_generation_status(account_id: int):
    """Get the status of the latest generation for an account"""
    
    try:
        import httpx
        backend_url = settings.typescript_backend_url
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{backend_url}/api/dvyb/latest",
                params={"accountId": account_id}
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("success") and result.get("data"):
                data = result["data"]
                return GenerationStatus(
                    success=True,
                    status=data.get("status", "unknown"),
                    progress_percent=data.get("progressPercent", 0),
                    progress_message=data.get("progressMessage", ""),
                    data=data
                )
            else:
                return GenerationStatus(
                    success=False,
                    status="not_found",
                    progress_percent=0,
                    progress_message="No generation found"
                )
                
    except Exception as e:
        logger.error(f"❌ Failed to get generation status: {e}")
        return GenerationStatus(
            success=False,
            status="error",
            progress_percent=0,
            progress_message=str(e)
        )

