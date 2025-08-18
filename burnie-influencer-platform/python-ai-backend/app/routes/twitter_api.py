"""
Twitter API routes for fetching leaderboard yapper data
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.services.twitter_leaderboard_service import TwitterLeaderboardService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/twitter", tags=["Twitter API"])

# Create thread pool executor for isolating Twitter API calls
twitter_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="twitter-api")

def sync_fetch_twitter_data(twitter_handle: str, yapper_name: str):
    """Synchronous wrapper for Twitter API calls - runs in separate thread"""
    try:
        twitter_service = TwitterLeaderboardService()
        # This will run the async method in a new event loop in the thread
        return asyncio.run(twitter_service.fetch_yapper_twitter_data(
            twitter_handle=twitter_handle,
            yapper_name=yapper_name
        ))
    except Exception as e:
        logger.error(f"❌ Error in sync Twitter fetch: {e}")
        return {
            "success": False,
            "error": str(e)
        }

class FetchYapperRequest(BaseModel):
    twitter_handle: str
    yapper_name: str

class FetchYapperResponse(BaseModel):
    success: bool
    twitter_handle: Optional[str] = None
    yapper_name: Optional[str] = None
    profile: Optional[Dict[str, Any]] = None
    recent_tweets: Optional[list] = None
    tweet_image_urls: Optional[list] = None
    llm_analysis: Optional[Dict[str, Any]] = None  # Comprehensive LLM analysis (images + text)
    engagement_metrics: Optional[Dict[str, Any]] = None
    fetch_timestamp: Optional[str] = None
    tweets_count: Optional[int] = None
    images_count: Optional[int] = None
    error: Optional[str] = None
    retry_after: Optional[int] = None

@router.get("/queue-status")
async def get_twitter_queue_status():
    """Get status of Twitter queue processing for debugging"""
    try:
        # This would require importing and checking the TypeScript cron service status
        # For now, just return basic Python backend status
        return {
            "python_backend_status": "running",
            "message": "Check TypeScript backend logs for detailed cron queue status"
        }
    except Exception as e:
        logger.error(f"❌ Error getting queue status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fetch-yapper-data", response_model=FetchYapperResponse)
async def fetch_yapper_twitter_data(request: FetchYapperRequest, background_tasks: BackgroundTasks) -> FetchYapperResponse:
    """
    Fetch Twitter data for a leaderboard yapper
    
    This endpoint fetches:
    - Profile information
    - Last 20 tweets
    - Tweet images (URLs)
    - Engagement metrics
    """
    try:
        logger.info(f"🐦 API request for Twitter data: @{request.twitter_handle}")
        
        # Run Twitter API call in isolated thread to prevent rate limit blocking
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            twitter_executor,
            sync_fetch_twitter_data,
            request.twitter_handle,
            request.yapper_name
        )
        
        # Convert to response model
        response = FetchYapperResponse(
            success=result["success"],
            twitter_handle=result.get("twitter_handle"),
            yapper_name=result.get("yapper_name"),
            profile=result.get("profile"),
            recent_tweets=result.get("recent_tweets"),
            tweet_image_urls=result.get("tweet_image_urls"),
            llm_analysis=result.get("llm_analysis"),  # Include comprehensive LLM analysis
            engagement_metrics=result.get("engagement_metrics"),
            fetch_timestamp=result.get("fetch_timestamp"),
            tweets_count=result.get("tweets_count"),
            images_count=result.get("images_count"),
            error=result.get("error"),
            retry_after=result.get("retry_after")
        )
        
        if result["success"]:
            logger.info(f"✅ Successfully fetched Twitter data for @{request.twitter_handle}")
        else:
            if result.get("error") == "rate_limited":
                logger.warn(f"⏳ Rate limited for @{request.twitter_handle}")
                raise HTTPException(status_code=429, detail="Rate limited")
            else:
                logger.error(f"❌ Failed to fetch Twitter data for @{request.twitter_handle}: {result.get('error')}")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error in fetch yapper data API: {str(e)}")
        return FetchYapperResponse(
            success=False,
            error=str(e)
        )

@router.get("/rate-limit-status")
async def get_rate_limit_status():
    """Get current Twitter API rate limit status"""
    try:
        twitter_service = TwitterLeaderboardService()
        rate_limit_info = twitter_service.get_rate_limit_status()
        
        return {
            "success": True,
            "rate_limit_status": rate_limit_info,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Error getting rate limit status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def twitter_health_check():
    """Health check for Twitter API service"""
    try:
        twitter_service = TwitterLeaderboardService()
        
        # Test if Twitter API is accessible
        is_healthy = twitter_service.api is not None
        
        return {
            "status": "healthy" if is_healthy else "unhealthy",
            "service": "twitter_api",
            "api_available": is_healthy,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Twitter health check failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Twitter service unhealthy")

class BatchFetchRequest(BaseModel):
    yapper_handles: list  # List of (handle, name) tuples
    batch_size: int = 5

@router.post("/batch-fetch")
async def batch_fetch_twitter_data(
    request: BatchFetchRequest,
    background_tasks: BackgroundTasks
):
    """
    Batch fetch Twitter data for multiple yappers
    
    Note: This endpoint is mainly for testing. In production, use the queue system
    for better rate limiting and reliability.
    """
    try:
        logger.info(f"🐦 Batch Twitter fetch request for {len(request.yapper_handles)} yappers")
        
        twitter_service = TwitterLeaderboardService()
        
        # Convert list of lists to list of tuples
        yapper_tuples = [tuple(handle_data) for handle_data in request.yapper_handles]
        
        results = await twitter_service.fetch_multiple_yappers_data(
            yapper_handles=yapper_tuples,
            batch_size=request.batch_size
        )
        
        successful = sum(1 for result in results if result.get("success"))
        failed = len(results) - successful
        
        logger.info(f"✅ Batch fetch completed: {successful} successful, {failed} failed")
        
        return {
            "success": True,
            "total_requested": len(request.yapper_handles),
            "successful_fetches": successful,
            "failed_fetches": failed,
            "results": results
        }
        
    except Exception as e:
        logger.error(f"❌ Error in batch fetch: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
