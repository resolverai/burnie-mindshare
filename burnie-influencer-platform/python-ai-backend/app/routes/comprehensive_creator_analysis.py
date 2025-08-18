"""
Comprehensive Creator Analysis Route
Handles complete LLM analysis for creators/miners and stores results in database
"""

import logging
import json
import requests
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.services.comprehensive_llm_analyzer import ComprehensiveLLMAnalyzer

logger = logging.getLogger(__name__)

router = APIRouter()

class ComprehensiveCreatorAnalysisRequest(BaseModel):
    user_id: int = Field(..., description="Creator/miner user ID")
    tweet_id: str = Field(..., description="Tweet ID")
    tweet_text: str = Field(..., description="Tweet text content")
    image_urls: List[str] = Field(default=[], description="Image URLs from tweet")
    learning_data_id: int = Field(..., description="TwitterLearningData record ID")
    analysis_type: str = Field(default="creator", description="Type of analysis")

class ComprehensiveCreatorAnalysisResponse(BaseModel):
    success: bool
    message: str
    analysis_triggered: bool = False
    error: str | None = None

class BatchTweetData(BaseModel):
    tweet_id: str = Field(..., description="Tweet ID")
    tweet_text: str = Field(..., description="Tweet text content")
    image_urls: List[str] = Field(default=[], description="Image URLs from tweet")
    learning_data_id: int = Field(..., description="TwitterLearningData record ID")

class ComprehensiveBatchCreatorAnalysisRequest(BaseModel):
    user_id: int = Field(..., description="Creator/miner user ID")
    tweets_data: List[BatchTweetData] = Field(..., description="List of tweets to analyze")
    analysis_type: str = Field(default="creator", description="Type of analysis")

class ComprehensiveBatchCreatorAnalysisResponse(BaseModel):
    success: bool
    message: str
    tweets_processed: int = 0
    analysis_triggered: bool = False
    error: str | None = None

@router.post("/comprehensive-creator-analysis", response_model=ComprehensiveCreatorAnalysisResponse)
async def comprehensive_creator_analysis(
    request: ComprehensiveCreatorAnalysisRequest,
    background_tasks: BackgroundTasks
):
    """
    Trigger comprehensive LLM analysis for creator content and store in database
    
    This endpoint performs analysis in the background and updates the database
    """
    try:
        logger.info(f"🎯 Starting comprehensive creator analysis for user {request.user_id}")
        logger.info(f"   Tweet ID: {request.tweet_id}")
        logger.info(f"   Learning Data ID: {request.learning_data_id}")
        logger.info(f"   Images: {len(request.image_urls)}")

        # Add background task for analysis
        background_tasks.add_task(
            process_creator_analysis,
            request.user_id,
            request.tweet_id,
            request.tweet_text,
            request.image_urls,
            request.learning_data_id,
            request.analysis_type
        )

        return ComprehensiveCreatorAnalysisResponse(
            success=True,
            message="Comprehensive analysis triggered successfully",
            analysis_triggered=True
        )

    except Exception as e:
        logger.error(f"❌ Error triggering comprehensive creator analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to trigger analysis: {str(e)}"
        )

async def process_creator_analysis(
    user_id: int,
    tweet_id: str,
    tweet_text: str,
    image_urls: List[str],
    learning_data_id: int,
    analysis_type: str
):
    """
    Background task to process comprehensive creator analysis
    """
    try:
        logger.info(f"🧠 Processing comprehensive analysis for user {user_id}, tweet {tweet_id}")

        # Initialize comprehensive analyzer
        analyzer = ComprehensiveLLMAnalyzer()

        # Perform comprehensive analysis
        result = await analyzer.analyze_twitter_content(
            twitter_handle=f"user_{user_id}",  # Will be updated with actual handle
            tweet_texts=[tweet_text],
            image_urls=image_urls,
            context={
                'user_id': user_id,
                'tweet_id': tweet_id,
                'learning_data_id': learning_data_id,
                'analysis_type': analysis_type,
                'total_tweets': 1,
                'total_images': len(image_urls)
            },
            analysis_type=analysis_type
        )

        if result and result.get('success'):
            # Store analysis results in database
            await store_creator_analysis_results(
                learning_data_id=learning_data_id,
                analysis_result=result,
                user_id=user_id,
                tweet_id=tweet_id
            )
            logger.info(f"✅ Comprehensive analysis completed and stored for user {user_id}")
        else:
            error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
            logger.error(f"❌ Comprehensive analysis failed for user {user_id}: {error_msg}")

    except Exception as e:
        logger.error(f"❌ Error in background analysis for user {user_id}: {str(e)}")

async def store_creator_analysis_results(
    learning_data_id: int,
    analysis_result: Dict[str, Any],
    user_id: int,
    tweet_id: str
):
    """
    Store comprehensive analysis results in TwitterLearningData table
    """
    try:
        provider_used = analysis_result.get('provider_used')
        
        # Prepare update payload
        update_data = {
            'learning_data_id': learning_data_id,
            'provider_used': provider_used
        }

        # Add the appropriate analysis based on provider used
        if provider_used == 'anthropic':
            update_data['anthropic_analysis'] = analysis_result.get('anthropic_analysis')
            update_data['openai_analysis'] = None
        elif provider_used == 'openai':
            update_data['anthropic_analysis'] = None
            update_data['openai_analysis'] = analysis_result.get('openai_analysis')

        # Call TypeScript backend to update the TwitterLearningData record
        response = requests.patch(
            f"{get_typescript_backend_url()}/api/twitter-learning-data/{learning_data_id}/llm-analysis",
            json=update_data,
            timeout=10
        )

        if response.ok:
            logger.info(f"✅ Stored {provider_used} analysis for TwitterLearningData {learning_data_id}")
        else:
            logger.error(f"❌ Failed to store analysis: {response.status_code} - {response.text}")

    except Exception as e:
        logger.error(f"❌ Error storing analysis results for learning_data_id {learning_data_id}: {str(e)}")

async def process_batch_creator_analysis(
    user_id: int,
    tweets_data: List[BatchTweetData],
    all_tweet_texts: List[str],
    all_image_urls: List[str],
    analysis_type: str
):
    """
    Background task to process batch comprehensive creator analysis
    """
    try:
        logger.info(f"🧠 Processing batch comprehensive analysis for user {user_id}")
        logger.info(f"   Tweets: {len(tweets_data)}, Texts: {len(all_tweet_texts)}, Images: {len(all_image_urls)}")

        # Initialize comprehensive analyzer
        analyzer = ComprehensiveLLMAnalyzer()

        # Perform batch comprehensive analysis
        result = await analyzer.analyze_twitter_content(
            twitter_handle=f"user_{user_id}",
            tweet_texts=all_tweet_texts,  # All tweet texts combined
            image_urls=all_image_urls,    # All images combined
            context={
                'user_id': user_id,
                'analysis_type': analysis_type,
                'total_tweets': len(tweets_data),
                'total_images': len(all_image_urls),
                'batch_processing': True
            },
            analysis_type=analysis_type
        )

        if result and result.get('success'):
            # Store analysis results for each tweet
            for tweet_data in tweets_data:
                await store_creator_analysis_results(
                    learning_data_id=tweet_data.learning_data_id,
                    analysis_result=result,
                    user_id=user_id,
                    tweet_id=tweet_data.tweet_id
                )
            
            logger.info(f"✅ Batch comprehensive analysis completed and stored for {len(tweets_data)} tweets")
        else:
            error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
            logger.error(f"❌ Batch comprehensive analysis failed for user {user_id}: {error_msg}")

    except Exception as e:
        logger.error(f"❌ Error processing batch comprehensive analysis for user {user_id}: {str(e)}")

def get_typescript_backend_url() -> str:
    """Get TypeScript backend URL from environment or use default"""
    import os
    return os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:5000')

@router.post("/comprehensive-creator-batch-analysis", response_model=ComprehensiveBatchCreatorAnalysisResponse)
async def comprehensive_batch_creator_analysis(
    request: ComprehensiveBatchCreatorAnalysisRequest,
    background_tasks: BackgroundTasks
):
    """
    Trigger comprehensive LLM analysis for multiple tweets in batch
    
    This endpoint processes multiple tweets together for efficiency
    """
    try:
        logger.info(f"🎯 Starting batch comprehensive creator analysis for user {request.user_id}")
        logger.info(f"   Total tweets: {len(request.tweets_data)}")
        
        # Collect all tweet texts and images for batch analysis
        all_tweet_texts = []
        all_image_urls = []
        learning_data_ids = []
        
        for tweet_data in request.tweets_data:
            all_tweet_texts.append(tweet_data.tweet_text)
            all_image_urls.extend(tweet_data.image_urls)
            learning_data_ids.append(tweet_data.learning_data_id)
        
        logger.info(f"   Combined texts: {len(all_tweet_texts)}")
        logger.info(f"   Combined images: {len(all_image_urls)}")

        # Add background task for batch analysis
        background_tasks.add_task(
            process_batch_creator_analysis,
            request.user_id,
            request.tweets_data,
            all_tweet_texts,
            all_image_urls,
            request.analysis_type
        )

        return ComprehensiveBatchCreatorAnalysisResponse(
            success=True,
            message="Batch comprehensive analysis triggered successfully",
            tweets_processed=len(request.tweets_data),
            analysis_triggered=True
        )

    except Exception as e:
        logger.error(f"❌ Error triggering batch comprehensive creator analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to trigger batch analysis: {str(e)}"
        )

@router.get("/comprehensive-creator-analysis-status")
async def get_comprehensive_analysis_status():
    """
    Get the status of the comprehensive creator analysis service
    """
    try:
        return {
            "success": True,
            "service_status": "active",
            "analysis_types": {
                "creator": "Content creation optimization analysis",
                "leaderboard_yapper": "Competitive intelligence analysis", 
                "platform_yapper": "Content marketplace insights"
            },
            "llm_providers": {
                "anthropic": "Primary provider for comprehensive analysis",
                "openai": "Fallback provider for comprehensive analysis"
            },
            "data_structure": {
                "images": "Visual content analysis and insights",
                "text": "Text content patterns and optimization",
                "overall_insights": "Combined insights for decision making"
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error checking comprehensive analysis service status: {str(e)}")
        return {
            "success": False,
            "service_status": "error",
            "error": str(e)
        }
