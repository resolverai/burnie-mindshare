"""
Creator Image Analysis Route
Handles Anthropic/OpenAI image analysis for creators/miners Twitter data
"""

import logging
import json
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_providers import MultiProviderLLMService
from app.services.comprehensive_llm_analyzer import ComprehensiveLLMAnalyzer

logger = logging.getLogger(__name__)

router = APIRouter()

class CreatorImageAnalysisRequest(BaseModel):
    image_urls: List[str] = Field(..., description="URLs of images to analyze")
    tweet_text: str = Field(..., description="Text content of the tweet")
    user_id: int = Field(..., description="Creator/miner user ID")
    analysis_type: str = Field(default="creator_content_analysis", description="Type of analysis")

class CreatorImageAnalysisResponse(BaseModel):
    success: bool
    analysis: str | None = None
    error: str | None = None
    images_processed: int = 0
    provider_used: str | None = None

@router.post("/analyze-creator-images", response_model=CreatorImageAnalysisResponse)
async def analyze_creator_images(request: CreatorImageAnalysisRequest):
    """
    Analyze creator/miner tweet images using Anthropic with OpenAI fallback
    
    Provides insights about visual content quality, style, and engagement potential
    """
    try:
        logger.info(f"🎯 Starting creator image analysis for user {request.user_id}")
        logger.info(f"   Images to analyze: {len(request.image_urls)}")
        logger.info(f"   Tweet text preview: {request.tweet_text[:100]}...")

        if not request.image_urls:
            return CreatorImageAnalysisResponse(
                success=False,
                error="No image URLs provided",
                images_processed=0
            )

        # Initialize comprehensive LLM analyzer
        analyzer = ComprehensiveLLMAnalyzer()

        # Perform comprehensive analysis (images + text)
        result = await analyzer.analyze_twitter_content(
            twitter_handle=f"user_{request.user_id}",  # Will be replaced with actual handle
            tweet_texts=[request.tweet_text],
            image_urls=request.image_urls,
            context={
                'user_id': request.user_id,
                'analysis_type': 'creator',
                'tweet_text': request.tweet_text,
                'image_count': len(request.image_urls)
            },
            analysis_type='creator'
        )

        if result and result.get('success'):
            analysis_data = result.get('analysis', {})
            provider_used = result.get('provider_used', 'unknown')
            
            # Parse and validate the comprehensive analysis
            if isinstance(analysis_data, str):
                try:
                    # Parse JSON string if needed
                    parsed_analysis = analyzer.parse_and_validate_analysis(analysis_data)
                except:
                    parsed_analysis = {"raw_text": analysis_data}
            else:
                parsed_analysis = analysis_data
            
            logger.info(f"✅ Creator comprehensive analysis completed for user {request.user_id}")
            logger.info(f"   Provider used: {provider_used}")
            logger.info(f"   Analysis structure: {list(parsed_analysis.keys())}")
            
            return CreatorImageAnalysisResponse(
                success=True,
                analysis=json.dumps(parsed_analysis),  # Return as JSON string for backward compatibility
                images_processed=len(request.image_urls),
                provider_used=provider_used
            )
        else:
            error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
            logger.error(f"❌ Creator image analysis failed for user {request.user_id}: {error_msg}")
            
            return CreatorImageAnalysisResponse(
                success=False,
                error=f"Analysis failed: {error_msg}",
                images_processed=0
            )

    except Exception as e:
        logger.error(f"❌ Error in creator image analysis for user {request.user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Image analysis failed: {str(e)}"
        )

@router.get("/creator-analysis-status")
async def get_creator_analysis_status():
    """
    Get the status of the creator image analysis service
    """
    try:
        # Check if LLM service is available with proper environment configuration
        from app.config.settings import get_settings
        settings = get_settings()
        default_provider = settings.default_llm_provider or 'anthropic'
        fallback_provider = settings.fallback_llm_provider or 'openai'
        llm_service = MultiProviderLLMService(
            primary_provider=default_provider,
            fallback_provider=fallback_provider
        )
        
        return {
            "success": True,
            "service_status": "active",
            "providers_available": {
                "anthropic": "available",
                "openai": "available" 
            },
            "analysis_types_supported": [
                "creator_content_analysis",
                "visual_quality_assessment",
                "engagement_potential_analysis"
            ],
            "max_images_per_request": 10,
            "max_analysis_words": 300
        }
        
    except Exception as e:
        logger.error(f"❌ Error checking creator analysis service status: {str(e)}")
        return {
            "success": False,
            "service_status": "error",
            "error": str(e)
        }
