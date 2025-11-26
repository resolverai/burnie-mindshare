"""
DVYB Topic Generation Endpoint
Generates content topics for brands based on their context
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import openai
import os
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter()

# OpenAI client
openai.api_key = os.getenv("OPENAI_API_KEY")

class TopicGenerationRequest(BaseModel):
    account_id: int
    business_overview: Optional[str] = None
    customer_demographics: Optional[str] = None
    popular_products: Optional[List[str]] = None
    why_customers_choose: Optional[str] = None
    brand_story: Optional[str] = None
    media_channels: Optional[dict] = None

class TopicGenerationResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None


@router.post("/generate-topics", response_model=TopicGenerationResponse)
async def generate_brand_topics(request: TopicGenerationRequest):
    """
    Generate 10 unique content topics for a brand based on their context
    """
    try:
        logger.info(f"🎯 Generating topics for account {request.account_id}")

        # Build context for the LLM
        context_parts = []
        
        if request.business_overview:
            context_parts.append(f"Business Overview: {request.business_overview}")
        
        if request.customer_demographics:
            context_parts.append(f"Target Audience: {request.customer_demographics}")
        
        if request.popular_products:
            products_str = ", ".join(request.popular_products[:5])  # Limit to first 5
            context_parts.append(f"Products/Services: {products_str}")
        
        if request.why_customers_choose:
            context_parts.append(f"Value Proposition: {request.why_customers_choose}")
        
        if request.brand_story:
            # Limit brand story to first 500 characters to avoid token limits
            brand_story_short = request.brand_story[:500] + "..." if len(request.brand_story) > 500 else request.brand_story
            context_parts.append(f"Brand Story: {brand_story_short}")
        
        # Determine content channels
        channels = []
        if request.media_channels:
            social = request.media_channels.get('social', [])
            video = request.media_channels.get('video', [])
            channels = social + video
        
        channels_str = ", ".join(channels) if channels else "social media and video platforms"
        
        context_text = "\n\n".join(context_parts)
        
        # Create the prompt
        prompt = f"""You are a content strategist for a brand. Based on the following brand information, generate exactly 10 unique content topics/themes with example post ideas that would resonate with their audience.

Brand Information:
{context_text}

Content will be published on: {channels_str}

Requirements:
1. Each topic must be between 10 to 15 WORDS (not characters). Count the words carefully.
2. For each topic, provide an example post with:
   - title: maximum 30 CHARACTERS (including spaces)
   - subtitle: maximum 40 CHARACTERS (including spaces)
3. Topics should be diverse and cover different angles (educational, inspirational, promotional, behind-the-scenes, user-generated content, etc.)
4. Topics should be specific enough to guide content creation but broad enough to allow creativity
5. Focus on topics that would engage their target audience
6. Make topics actionable and relevant to their business
7. Examples should be engaging, social media-friendly, and reflect the brand's voice
8. Examples should be in ALL CAPS for visual impact

Return ONLY a valid JSON object with this exact structure:
{{
  "topics": [
    {{
      "topic": "Topic 1 here (10-15 words)",
      "example": {{
        "title": "TITLE HERE (max 30 chars)",
        "subtitle": "SUBTITLE HERE (max 40 chars)"
      }}
    }},
    ...10 topics total
  ]
}}

Do not include any additional text, explanations, or markdown formatting. Return only the JSON object."""

        logger.info(f"📝 Calling OpenAI GPT-4o for topic generation")
        
        # Call OpenAI API
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert content strategist who generates relevant, engaging content topics for brands. You always respond with valid JSON only."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.8,  # Higher temperature for more creative/diverse topics
            max_tokens=1000,
        )

        # Extract the response
        raw_response = response.choices[0].message.content.strip()
        logger.info(f"🤖 RAW LLM RESPONSE:\n{raw_response}")

        # Parse JSON response
        try:
            # Remove markdown code blocks if present
            if raw_response.startswith("```"):
                # Find the JSON content between ``` markers
                lines = raw_response.split("\n")
                json_lines = []
                in_code_block = False
                for line in lines:
                    if line.strip().startswith("```"):
                        in_code_block = not in_code_block
                        continue
                    if in_code_block or (not line.strip().startswith("```")):
                        json_lines.append(line)
                raw_response = "\n".join(json_lines).strip()

            topics_data = json.loads(raw_response)
            topics = topics_data.get("topics", [])

            if not topics or len(topics) < 10:
                raise ValueError(f"Expected 10 topics, but got {len(topics)}")

            # Validate structure - each topic should have topic text and example
            for idx, topic_item in enumerate(topics):
                if not isinstance(topic_item, dict):
                    raise ValueError(f"Topic {idx+1} is not a valid object")
                if "topic" not in topic_item or "example" not in topic_item:
                    raise ValueError(f"Topic {idx+1} missing 'topic' or 'example' field")
                if "title" not in topic_item["example"] or "subtitle" not in topic_item["example"]:
                    raise ValueError(f"Topic {idx+1} example missing 'title' or 'subtitle'")

            logger.info(f"✅ Successfully generated {len(topics)} topics with examples for account {request.account_id}")
            logger.info(f"📊 Topics: {[t['topic'] for t in topics]}")

            return TopicGenerationResponse(
                success=True,
                data={
                    "topics": topics,
                    "account_id": request.account_id
                }
            )

        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON parsing error: {str(e)}")
            logger.error(f"Raw response: {raw_response}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse LLM response as JSON: {str(e)}"
            )

    except openai.APIError as e:
        logger.error(f"❌ OpenAI API error: {str(e)}")
        return TopicGenerationResponse(
            success=False,
            error=f"OpenAI API error: {str(e)}"
        )
    except Exception as e:
        logger.error(f"❌ Topic generation error: {str(e)}")
        logger.exception(e)
        return TopicGenerationResponse(
            success=False,
            error=f"Topic generation failed: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "dvyb-topic-generation"}

