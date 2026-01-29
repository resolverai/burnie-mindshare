"""
DVYB Content Strategy Generation

Uses Grok-4-latest to generate a 1-month content strategy based on:
- Website analysis data
- User's strategy preferences from questionnaire

NOTE: This endpoint does NOT connect to database. It only generates strategy using AI
and returns the data to TypeScript backend which handles database operations.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import json
import re

from app.config.settings import settings

router = APIRouter(prefix="/api/dvyb/content-strategy", tags=["dvyb-content-strategy"])


class WebsiteAnalysis(BaseModel):
    industry: Optional[str] = None
    description: Optional[str] = None
    topics: Optional[List[str]] = None
    brandName: Optional[str] = None
    logoUrl: Optional[str] = None


class PlatformFollowers(BaseModel):
    instagram: Optional[int] = None
    tiktok: Optional[int] = None
    twitter: Optional[int] = None
    linkedin: Optional[int] = None


class StrategyPreferences(BaseModel):
    goal: Optional[str] = None  # 'grow_followers' | 'get_leads' | 'drive_sales' | 'build_community'
    platforms: Optional[List[str]] = None  # ['instagram', 'twitter', 'linkedin', 'tiktok']
    platformFollowers: Optional[PlatformFollowers] = None
    idealCustomer: Optional[str] = None
    postingFrequency: Optional[str] = None  # 'daily' | 'few_times_week' | 'weekly'
    businessAge: Optional[str] = None
    revenueRange: Optional[str] = None
    contentTypes: Optional[List[str]] = None  # ['images', 'videos', 'both']
    biggestChallenge: Optional[str] = None  # 'ideas' | 'time' | 'engagement' | 'consistency'


class GenerateStrategyRequest(BaseModel):
    account_id: int
    website_analysis: WebsiteAnalysis
    strategy_preferences: Optional[StrategyPreferences] = None


def get_posting_frequency_guidance(frequency: str) -> dict:
    """Convert frequency preference to posting guidance"""
    frequencies = {
        "daily": {"posts_per_week": 7, "description": "daily posting"},
        "few_times_week": {"posts_per_week": 4, "description": "3-4 posts per week"},
        "weekly": {"posts_per_week": 2, "description": "1-2 posts per week"},
    }
    return frequencies.get(frequency, {"posts_per_week": 3, "description": "a few posts per week"})


def get_goal_guidance(goal: str) -> dict:
    """Get content strategy guidance based on goal with 1.5X growth focus"""
    goals = {
        "grow_followers": {
            "focus": "Shareable, entertaining, and visually appealing content that encourages follows",
            "target_metric": "follower count",
            "tactics": "viral-worthy hooks, trending topics, user-generated content features, collaborations"
        },
        "get_leads": {
            "focus": "Educational and valuable content with clear calls-to-action",
            "target_metric": "lead generation",
            "tactics": "lead magnets, DM-to-download offers, email list building, exclusive content"
        },
        "drive_sales": {
            "focus": "Product showcases, testimonials, and promotional content",
            "target_metric": "sales conversions",
            "tactics": "product demos, customer success stories, limited-time offers, social proof"
        },
        "build_community": {
            "focus": "Interactive content that fosters discussions and participation",
            "target_metric": "engagement rate",
            "tactics": "Q&A sessions, polls, behind-the-scenes, member spotlights, challenges"
        },
    }
    return goals.get(goal, {
        "focus": "Create engaging content that builds brand awareness",
        "target_metric": "overall engagement",
        "tactics": "diverse content mix"
    })


def get_challenge_solutions(challenge: str) -> str:
    """Get solutions for content challenges"""
    solutions = {
        "ideas": "Include a variety of content pillars and themes to never run out of ideas",
        "time": "Focus on repurposable content that can be adapted across platforms",
        "engagement": "Prioritize interactive content formats and strong CTAs",
        "consistency": "Create themed days and a predictable posting schedule",
    }
    return solutions.get(challenge, "Balanced content mix across all dimensions")


def generate_strategy_with_grok(
    account_id: int,
    website_analysis: dict,
    strategy_preferences: dict
) -> dict:
    """
    Generate content strategy using Grok-4-latest
    Returns structured strategy with weekly themes and daily content packages
    Focus: Achieve 1.5X growth in the user's primary goal metric
    """
    from xai_sdk import Client
    from xai_sdk.chat import user, system
    
    print(f"\n{'='*80}")
    print(f"🎯 GENERATING 1.5X GROWTH CONTENT STRATEGY WITH GROK-4-LATEST")
    print(f"{'='*80}")
    print(f"Account ID: {account_id}")
    print(f"Industry: {website_analysis.get('industry', 'Unknown')}")
    print(f"Brand: {website_analysis.get('brandName', 'Unknown')}")
    
    # Get preferences or defaults
    prefs = strategy_preferences or {}
    platforms = prefs.get('platforms', ['instagram', 'twitter'])
    goal = prefs.get('goal', 'grow_followers')
    posting_freq = get_posting_frequency_guidance(prefs.get('postingFrequency', 'few_times_week'))
    goal_guidance = get_goal_guidance(goal)
    ideal_customer = prefs.get('idealCustomer', 'general audience')
    business_age = prefs.get('businessAge', 'established')
    
    # New fields
    platform_followers = prefs.get('platformFollowers', {})
    content_types = prefs.get('contentTypes', ['both'])
    biggest_challenge = prefs.get('biggestChallenge', '')
    challenge_solution = get_challenge_solutions(biggest_challenge) if biggest_challenge else ""
    
    # Build follower summary
    follower_info = []
    if platform_followers:
        for platform, count in platform_followers.items():
            if count and count > 0:
                follower_info.append(f"{platform.title()}: {count:,} followers")
    follower_summary = ", ".join(follower_info) if follower_info else "Not specified"
    
    # Determine content format preference
    content_format = "Mix of images and videos"
    if 'images' in content_types and 'videos' not in content_types:
        content_format = "Primarily image-based content"
    elif 'videos' in content_types and 'images' not in content_types:
        content_format = "Primarily video-based content"
    
    # Calculate dates for the next 4 weeks
    today = datetime.now()
    # Start from next Monday
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    start_date = today + timedelta(days=days_until_monday)
    end_date = start_date + timedelta(days=27)  # 4 weeks
    
    print(f"Platforms: {platforms}")
    print(f"Goal: {goal}")
    print(f"Posting frequency: {posting_freq['description']}")
    print(f"Strategy period: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    
    system_prompt = """You are an elite social media growth strategist. Your expertise is in creating high-impact content strategies that deliver measurable results.

Your mission: Create a 4-week content strategy designed to achieve 1.5X GROWTH in the client's primary goal metric.

You must return ONLY valid JSON with no additional text or markdown formatting.
The response must be a valid JSON object that can be parsed directly."""

    # Build challenge-specific guidance
    challenge_guidance = ""
    if biggest_challenge and challenge_solution:
        challenge_guidance = f"""
CONTENT CHALLENGE TO ADDRESS:
- Biggest Challenge: {biggest_challenge.replace('_', ' ').title()}
- Solution Approach: {challenge_solution}
"""

    user_prompt = f"""Create a HIGH-IMPACT 4-week content strategy designed to achieve 1.5X GROWTH:

🎯 GROWTH OBJECTIVE:
- Primary Goal: {goal.replace('_', ' ').title()}
- Target Metric: {goal_guidance.get('target_metric', 'engagement')}
- Focus: {goal_guidance.get('focus', 'engaging content')}
- Key Tactics: {goal_guidance.get('tactics', 'diverse content mix')}

📊 CURRENT STATUS:
- Current Followers: {follower_summary}
- 1.5X Target: Grow {goal_guidance.get('target_metric', 'engagement')} by 50% in 4 weeks

🏢 BRAND INFORMATION:
- Brand Name: {website_analysis.get('brandName', 'The Brand')}
- Industry: {website_analysis.get('industry', 'General')}
- Description: {website_analysis.get('description', 'A business looking to grow their social media presence')}
- Topics/Products: {', '.join(website_analysis.get('topics', ['general content'])) if website_analysis.get('topics') else 'various topics'}

👥 TARGET AUDIENCE:
- Ideal Customer: {ideal_customer}
- Business Stage: {business_age}
{challenge_guidance}
📱 CONTENT PREFERENCES:
- Active Platforms: {', '.join(platforms)}
- Content Format: {content_format}
- Posting Frequency: {posting_freq['description']} ({posting_freq['posts_per_week']} posts/week)

📅 STRATEGY PERIOD:
- Start: {start_date.strftime('%Y-%m-%d')} (Monday)
- End: {end_date.strftime('%Y-%m-%d')}

CREATE A STRATEGY WITH:
1. Progressive weekly themes that build momentum toward the 1.5X goal
2. Content specifically designed to maximize {goal_guidance.get('target_metric', 'engagement')}
3. Strategic mix of content types based on preference: {content_format}
4. Platform-specific optimization for each channel
5. Clear calls-to-action aligned with the primary goal

Generate exactly {posting_freq['posts_per_week'] * 4} high-impact content packages.

Return ONLY this JSON structure (no markdown, no code blocks):
{{
    "week_themes": {{
        "1": "Week 1 theme title",
        "2": "Week 2 theme title",
        "3": "Week 3 theme title",
        "4": "Week 4 theme title"
    }},
    "content_packages": [
        {{
            "date": "YYYY-MM-DD",
            "platform": "instagram|twitter|linkedin|tiktok",
            "content_type": "image|video",
            "topic": "Specific topic for this post",
            "week_number": 1,
            "week_theme": "Week 1 theme title",
            "metadata": {{
                "caption_hint": "Brief guidance for the caption",
                "hashtags": ["relevant", "hashtags"],
                "call_to_action": "What action should viewers take",
                "visual_style": "Description of the visual style",
                "tone_of_voice": "Tone for this content"
            }}
        }}
    ]
}}

CRITICAL REQUIREMENTS:
- Generate exactly {posting_freq['posts_per_week'] * 4} content packages total
- Distribute posts evenly across the 4 weeks
- MANDATORY: You MUST distribute posts across ALL these platforms: {platforms}
- If there are {len(platforms)} platforms, each platform should get approximately {(posting_freq['posts_per_week'] * 4) // len(platforms)} posts
- Each post should have a unique, specific topic related to the brand
- Dates must be between {start_date.strftime('%Y-%m-%d')} and {end_date.strftime('%Y-%m-%d')}
- For TikTok and Instagram Reels, prefer video content type
- For Twitter/X, prefer image or text-based image content  
- For LinkedIn, focus on professional/educational content
- DO NOT generate all posts for only one platform - DISTRIBUTE EVENLY across: {', '.join(platforms)}"""

    try:
        print(f"\n🤖 Calling Grok-4-latest for strategy generation...")
        
        client = Client(api_key=settings.xai_api_key, timeout=120)
        chat = client.chat.create(model="grok-4-fast-reasoning")
        
        chat.append(system(system_prompt))
        chat.append(user(user_prompt))
        
        response = chat.sample()
        response_text = response.content.strip()
        
        print(f"📝 Grok response length: {len(response_text)} chars")
        print(f"📝 Grok response preview: {response_text[:500]}...")
        
        # Parse JSON response (handle potential markdown code blocks)
        json_text = response_text
        
        # Remove markdown code blocks if present
        if "```json" in json_text:
            json_start = json_text.find("```json") + 7
            json_end = json_text.find("```", json_start)
            json_text = json_text[json_start:json_end].strip()
        elif "```" in json_text:
            json_start = json_text.find("```") + 3
            json_end = json_text.find("```", json_start)
            json_text = json_text[json_start:json_end].strip()
        
        # Try to find JSON object boundaries
        if not json_text.startswith("{"):
            start_idx = json_text.find("{")
            end_idx = json_text.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                json_text = json_text[start_idx:end_idx]
        
        # Fix common JSON issues (trailing commas)
        json_text = re.sub(r',(\s*[}\]])', r'\1', json_text)
        
        # Parse JSON
        strategy = json.loads(json_text)
        
        print(f"✅ Strategy parsed successfully")
        print(f"   Week themes: {len(strategy.get('week_themes', {}))}")
        print(f"   Content packages: {len(strategy.get('content_packages', []))}")
        
        return strategy
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON parse error: {e}")
        print(f"   Raw response: {response_text[:1000]}")
        raise HTTPException(status_code=500, detail=f"Failed to parse strategy response: {str(e)}")
    except Exception as e:
        print(f"❌ Grok error: {e}")
        raise HTTPException(status_code=500, detail=f"Strategy generation failed: {str(e)}")


@router.post("/generate")
async def generate_content_strategy(request: GenerateStrategyRequest):
    """
    Generate a 4-week content strategy using Grok-4-latest
    Returns strategy data to TypeScript backend which handles database storage
    """
    print(f"\n{'='*80}")
    print(f"📅 CONTENT STRATEGY GENERATION REQUEST")
    print(f"{'='*80}")
    print(f"Account ID: {request.account_id}")
    
    try:
        # Convert to dicts
        website_analysis = request.website_analysis.dict() if request.website_analysis else {}
        strategy_preferences = request.strategy_preferences.dict() if request.strategy_preferences else {}
        
        print(f"Website analysis: {website_analysis}")
        print(f"Strategy preferences: {strategy_preferences}")
        
        # Generate strategy with Grok
        strategy = generate_strategy_with_grok(
            request.account_id,
            website_analysis,
            strategy_preferences
        )
        
        # Calculate strategy month (format: YYYY-MM)
        today = datetime.now()
        days_until_monday = (7 - today.weekday()) % 7
        if days_until_monday == 0:
            days_until_monday = 7
        start_date = today + timedelta(days=days_until_monday)
        strategy_month = start_date.strftime('%Y-%m')
        
        print(f"\n✅ Strategy generation complete!")
        print(f"   Content packages: {len(strategy.get('content_packages', []))}")
        print(f"   Strategy month: {strategy_month}")
        
        # Return strategy data to TypeScript backend for database storage
        return {
            "success": True,
            "message": "Content strategy generated successfully",
            "strategy_month": strategy_month,
            "week_themes": strategy.get('week_themes', {}),
            "content_packages": strategy.get('content_packages', [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Strategy generation error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

