"""
DVYB Auto-Generation Topic & Instructions Endpoint

This endpoint generates creative topics and user instructions for automated
daily content generation using Grok LLM (grok-4-fast-reasoning).

Called by TypeScript backend's DvybAutoGenerationCronService.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
import json
from datetime import datetime, timedelta
from xai_sdk import Client
from xai_sdk.chat import user, system
from xai_sdk.search import SearchParameters
from app.config.settings import settings
import os

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class BrandContext(BaseModel):
    """Brand context for topic generation"""
    accountName: Optional[str] = None
    businessOverview: Optional[str] = None
    customerDemographics: Optional[str] = None
    popularProducts: Optional[List[str]] = None
    whyCustomersChoose: Optional[str] = None
    brandStory: Optional[str] = None
    industry: Optional[str] = None
    targetAudience: Optional[str] = None
    brandVoices: Optional[Dict[str, Any]] = None
    brandStyles: Optional[Dict[str, Any]] = None
    contentPillars: Optional[Any] = None
    keywords: Optional[str] = None


class DocumentInfo(BaseModel):
    """Document with timestamp for decay calculation"""
    name: str
    text: Optional[str] = None
    timestamp: str
    url: Optional[str] = None


class PreviousGeneration(BaseModel):
    """Previous generation for topic diversity"""
    topic: Optional[str] = None
    platformTexts: Optional[List[Dict[str, Any]]] = None


class AutoGenerationTopicRequest(BaseModel):
    """Request for auto-generation topic/instructions"""
    account_id: int
    brand_context: BrandContext
    documents_text: Optional[List[DocumentInfo]] = None
    previous_generations: Optional[List[PreviousGeneration]] = None


class InfluencerSpecs(BaseModel):
    """Influencer specifications for content"""
    ethnicity: str
    skinColor: str
    ageRange: str
    hairStyle: str
    hairColor: str
    environment: str
    ambience: str


class AutoGenerationTopicResponse(BaseModel):
    """Response with generated topic and instructions"""
    success: bool
    topic: Optional[str] = None
    userPrompt: Optional[str] = None
    influencerSpecs: Optional[InfluencerSpecs] = None
    error: Optional[str] = None


# ============================================
# GROK TOPIC GENERATION
# ============================================

def generate_topic_with_grok(
    brand_context: BrandContext,
    documents_text: List[DocumentInfo],
    previous_generations: List[PreviousGeneration]
) -> Dict[str, Any]:
    """
    Generate creative topic and user instructions using Grok (grok-4-fast-reasoning).
    Uses live search for trending topics.
    """
    api_key = settings.xai_api_key or os.getenv("XAI_API_KEY")
    
    if not api_key:
        raise ValueError("XAI_API_KEY not configured")
    
    client = Client(api_key=api_key, timeout=3600)
    
    # Build brand context dict
    brand_dict = {
        "accountName": brand_context.accountName,
        "businessOverview": brand_context.businessOverview,
        "customerDemographics": brand_context.customerDemographics,
        "popularProducts": brand_context.popularProducts,
        "whyCustomersChoose": brand_context.whyCustomersChoose,
        "brandStory": brand_context.brandStory,
        "industry": brand_context.industry,
        "targetAudience": brand_context.targetAudience,
        "brandVoices": brand_context.brandVoices,
        "brandStyles": brand_context.brandStyles,
        "contentPillars": brand_context.contentPillars,
        "keywords": brand_context.keywords,
    }
    # Remove None values
    brand_dict = {k: v for k, v in brand_dict.items() if v is not None}
    
    # DEBUG: Log brand context being sent to Grok
    try:
        print("\n" + "=" * 80)
        print("📦 AUTO-GEN BRAND CONTEXT FOR GROK")
        print("=" * 80)
        print(json.dumps(brand_dict, indent=2, ensure_ascii=False))
        print("=" * 80)
    except Exception as e:
        logger.warning(f"⚠️ Failed to print brand_dict for debugging: {e}")
    
    # Format previous generations (last 20)
    previous_topics_and_texts = []
    for gen in previous_generations[:20]:
        entry = {"topic": gen.topic}
        if gen.platformTexts:
            entry["platformTexts"] = [
                {"topic": pt.get("topic"), "platforms": pt.get("platforms")}
                for pt in gen.platformTexts
            ]
        previous_topics_and_texts.append(entry)
    
    # Format documents with 30-day decay context
    current_date = datetime.utcnow()
    formatted_docs = []
    for doc in documents_text:
        try:
            doc_date = datetime.fromisoformat(doc.timestamp.replace('Z', '+00:00'))
            days_since_upload = (current_date - doc_date.replace(tzinfo=None)).days
        except:
            days_since_upload = 30  # Default if parsing fails
        
        relevance_note = (
            'VERY RECENT - high relevance' if days_since_upload < 3 else
            'RECENT - good relevance' if days_since_upload < 7 else
            'OLDER - moderate relevance' if days_since_upload < 10 else
            'EXPIRED - outside 10-day window'
        )
        
        formatted_docs.append({
            "name": doc.name,
            "text": doc.text[:2000] if doc.text else None,  # Limit text length
            "timestamp": doc.timestamp,
            "daysSinceUpload": days_since_upload,
            "relevanceNote": relevance_note,
        })
    
    # DEBUG: Log documents and previous generations context
    try:
        print("\n" + "=" * 80)
        print("📚 AUTO-GEN DOCUMENTS CONTEXT FOR GROK")
        print("=" * 80)
        if formatted_docs:
            print(json.dumps(formatted_docs, indent=2, ensure_ascii=False))
        else:
            print("No recent documents")
        print("=" * 80)
        
        print("\n" + "=" * 80)
        print("🕒 AUTO-GEN PREVIOUS GENERATIONS CONTEXT FOR GROK (last 20)")
        print("=" * 80)
        if previous_topics_and_texts:
            print(json.dumps(previous_topics_and_texts, indent=2, ensure_ascii=False))
        else:
            print("No previous generations")
        print("=" * 80)
    except Exception as e:
        logger.warning(f"⚠️ Failed to print context for debugging: {e}")
    
    system_prompt = """You are an AUTONOMOUS CREATIVE DIRECTOR for social media content generation. Your role is to generate scroll-stopping, engaging content ideas for brands.

CRITICAL RULES FOR userPrompt:
- Keep it CONCISE (2-3 sentences max)
- MUST START with style: "UGC style", "Product marketing style", or "Brand marketing style"
- NO special effects (no glowing, lightning, sparkles, rewards popping out, explosions, etc.)
- NO text overlays on images/videos
- NEVER use words: "pause", "stop", "notification", "alert", "ping", "beep", "freeze"
- Plain, simple, realistic scene descriptions only
- Focus on the person, product, and environment - nothing fancy

You MUST respond with a valid JSON object only, no other text. The JSON must have this exact structure:
{
  "topic": "string - creative topic for content (keep it short)",
  "userPrompt": "string - CONCISE instructions (2-3 sentences, no effects, no text overlays)",
  "influencerSpecs": {
    "ethnicity": "string - e.g., South Asian, East Asian, Caucasian, African, Latino, Middle Eastern, Mixed",
    "skinColor": "string - e.g., fair, light, medium, olive, tan, brown, dark",
    "ageRange": "string - e.g., 18-25, 25-35, 35-45, 45-55",
    "hairStyle": "string - e.g., short curly, long straight, wavy medium length, braided",
    "hairColor": "string - e.g., black, brown, blonde, auburn, gray, colored",
    "environment": "string - specific setting for the content",
    "ambience": "string - mood and lighting description"
  }
}"""

    user_prompt = f"""Generate a unique, scroll-stopping content idea for this brand:

=== BRAND CONTEXT ===
{json.dumps(brand_dict, indent=2)}

=== BRAND DOCUMENTS (Apply 10-day decay - more recent = more relevant) ===
{json.dumps(formatted_docs, indent=2) if formatted_docs else 'No recent documents'}

=== PREVIOUS 20 GENERATIONS (AVOID similar topics/approaches) ===
{json.dumps(previous_topics_and_texts, indent=2) if previous_topics_and_texts else 'No previous generations'}

=== YOUR MISSION ===
1. Be FULLY AUTONOMOUS and CREATIVE - don't just rehash old topics
2. Generate a UNIQUE topic that will create scroll-stopping content
3. If you must use a similar topic to previous ones, make the approach/angle COMPLETELY DIFFERENT
4. Consider current trends and what performs well on social media
5. Match the influencer specs to the brand's target audience

=== CRITICAL: userPrompt RULES ===
- CONCISE: Maximum 2-3 sentences
- MUST SPECIFY STYLE: Always include one of these styles:
  * "UGC style" - User-generated content, authentic, casual, phone-recorded feel
  * "Product marketing style" - Professional product showcase, clean, polished
  * "Brand marketing style" - Brand storytelling, lifestyle, emotional connection
- NO EFFECTS: Do NOT include glowing effects, lightning, sparkles, rewards popping out, explosions, confetti, or any fancy visual effects
- NO TEXT OVERLAYS: Do NOT mention any text, captions, titles, or words to be displayed on the image/video
- FORBIDDEN WORDS: NEVER use these words in userPrompt: "pause", "stop", "notification", "notifications", "alert", "ping", "beep", "sound effect", "freeze"
- PLAIN & SIMPLE: Just describe a realistic scene with person + product + environment
- Think of it as a simple instruction a user would type

GOOD userPrompt example: "UGC style - Young professional casually using the headphones while working at a modern coffee shop. Natural lighting, relaxed vibe."
BAD userPrompt example: "Create an epic scene with glowing headphones, text saying 'Best Sound Ever', pause for effect, notification sounds popping out with sparkles."

TOPICS TO CONSIDER (be creative beyond these):
- Product Launch, Behind the Scenes, Customer Stories, Lifestyle, Seasonal/Trending
- Brand Values, Day in the Life, Tips & Tricks, Product in Action, Tutorial

Generate content that will STAND OUT. Be creative but keep instructions SIMPLE and REALISTIC.

Respond ONLY with valid JSON, no markdown or other text."""

    try:
        # DEBUG: Log final user prompt going to Grok (truncated for safety)
        try:
            print("\n" + "=" * 80)
            print("🧠 AUTO-GEN GROK SYSTEM PROMPT (first 800 chars)")
            print("=" * 80)
            print(system_prompt[:800] + ("..." if len(system_prompt) > 800 else ""))
            print("\n" + "=" * 80)
            print("🧠 AUTO-GEN GROK USER PROMPT (first 800 chars)")
            print("=" * 80)
            print(user_prompt[:800] + ("..." if len(user_prompt) > 800 else ""))
            print("=" * 80)
        except Exception as e:
            logger.warning(f"⚠️ Failed to print Grok prompts for debugging: {e}")
        
        # Use Grok with live search for trending topics
        print(f"🤖 Using Grok (grok-4-fast-reasoning) with live search for auto-generation topic...")
        chat = client.chat.create(
            model="grok-4-fast-reasoning",
            search_parameters=SearchParameters(mode="auto"),
        )
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        response = chat.sample()
        response_text = response.content.strip()
        
        if not response_text:
            raise ValueError("Empty response from Grok")
        
        print(f"📝 Grok response received: {len(response_text)} chars")
        try:
            # Log a truncated view of raw response for debugging
            print("\n" + "=" * 80)
            print("🧾 RAW GROK RESPONSE (first 1000 chars)")
            print("=" * 80)
            print(response_text[:1000] + ("..." if len(response_text) > 1000 else ""))
            print("=" * 80)
        except Exception as e:
            logger.warning(f"⚠️ Failed to print raw Grok response for debugging: {e}")
        
        # Parse JSON response
        json_text = response_text
        if "```json" in response_text:
            start = response_text.find("```json") + 7
            end = response_text.find("```", start)
            json_text = response_text[start:end].strip()
        elif "```" in response_text:
            start = response_text.find("```") + 3
            end = response_text.find("```", start)
            json_text = response_text[start:end].strip()
        elif not response_text.startswith("{"):
            # Try to find JSON object
            start = response_text.find("{")
            end = response_text.rfind("}") + 1
            if start != -1 and end > start:
                json_text = response_text[start:end]
        
        parsed = json.loads(json_text)
        
        # DEBUG: Log parsed Grok output (topic, userPrompt, influencerSpecs)
        try:
            print("\n" + "=" * 80)
            print("✅ PARSED GROK AUTO-GEN OUTPUT")
            print("=" * 80)
            print(f"🧩 Topic: {parsed.get('topic')}")
            print("\n📝 User Instructions (userPrompt):")
            user_prompt_out = parsed.get('userPrompt') or ''
            print(user_prompt_out if len(user_prompt_out) <= 1200 else user_prompt_out[:1200] + "...")
            print("\n👤 Influencer Specs:")
            print(json.dumps(parsed.get('influencerSpecs', {}), indent=2, ensure_ascii=False))
            print("=" * 80)
        except Exception as e:
            logger.warning(f"⚠️ Failed to print parsed Grok output for debugging: {e}")
        
        # Validate required fields
        if not parsed.get("topic") or not parsed.get("userPrompt") or not parsed.get("influencerSpecs"):
            raise ValueError("Grok response missing required fields")
        
        logger.info(f"✅ Grok generated topic: \"{parsed['topic']}\"")
        return parsed
        
    except json.JSONDecodeError as e:
        logger.error(f"❌ Failed to parse Grok response: {response_text[:500]}")
        raise ValueError(f"Failed to parse Grok response as JSON: {e}")
    except Exception as e:
        logger.error(f"❌ Error calling Grok: {e}")
        raise


# ============================================
# ENDPOINTS
# ============================================

@router.post("/generate-topic", response_model=AutoGenerationTopicResponse)
async def generate_auto_generation_topic(request: AutoGenerationTopicRequest):
    """
    Generate topic and user instructions for automated content generation.
    
    This endpoint is called by the TypeScript backend's DvybAutoGenerationCronService
    to get creative, varied content ideas for daily automated generation.
    
    Uses Grok (grok-4-fast-reasoning) with live search for trending topics.
    """
    try:
        logger.info(f"🎯 Generating auto-generation topic for account {request.account_id}")
        
        # Generate topic with Grok
        result = generate_topic_with_grok(
            brand_context=request.brand_context,
            documents_text=request.documents_text or [],
            previous_generations=request.previous_generations or [],
        )
        
        # Build response
        influencer_specs = InfluencerSpecs(
            ethnicity=result["influencerSpecs"].get("ethnicity", "Mixed"),
            skinColor=result["influencerSpecs"].get("skinColor", "medium"),
            ageRange=result["influencerSpecs"].get("ageRange", "25-35"),
            hairStyle=result["influencerSpecs"].get("hairStyle", "natural"),
            hairColor=result["influencerSpecs"].get("hairColor", "brown"),
            environment=result["influencerSpecs"].get("environment", "modern studio"),
            ambience=result["influencerSpecs"].get("ambience", "warm natural lighting"),
        )
        
        return AutoGenerationTopicResponse(
            success=True,
            topic=result["topic"],
            userPrompt=result["userPrompt"],
            influencerSpecs=influencer_specs,
        )
        
    except ValueError as e:
        logger.error(f"❌ Validation error: {e}")
        return AutoGenerationTopicResponse(
            success=False,
            error=str(e),
        )
    except Exception as e:
        logger.error(f"❌ Error generating topic: {e}")
        return AutoGenerationTopicResponse(
            success=False,
            error=f"Failed to generate topic: {str(e)}",
        )

