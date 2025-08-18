"""
Platform Yapper OAuth Twitter Data Collection
Handles Twitter data fetching for platform yappers using their OAuth access tokens
"""

import logging
import requests
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.comprehensive_llm_analyzer import ComprehensiveLLMAnalyzer
from app.services.training_data_populator import TrainingDataPopulator

logger = logging.getLogger(__name__)

router = APIRouter()

class PlatformYapperOAuthRequest(BaseModel):
    yapper_id: int = Field(..., description="Platform yapper user ID")
    twitter_user_id: str = Field(..., description="Twitter user ID")
    twitter_username: str = Field(..., description="Twitter username")
    access_token: str = Field(..., description="OAuth access token")
    refresh_token: str | None = Field(None, description="OAuth refresh token")

class PlatformYapperOAuthResponse(BaseModel):
    success: bool
    tweets_stored: int = 0
    profile_updated: bool = False
    training_records_populated: int = 0
    error: str | None = None

@router.post("/platform-yapper-oauth-data", response_model=PlatformYapperOAuthResponse)
async def collect_platform_yapper_oauth_data(request: PlatformYapperOAuthRequest):
    """
    Collect Twitter data for a platform yapper using their OAuth access token
    
    This endpoint is called when a yapper reconnects their Twitter account
    and fetches their latest tweets and profile data using OAuth tokens
    """
    try:
        logger.info(f"🎯 Starting OAuth Twitter data collection for yapper {request.yapper_id}")
        logger.info(f"   Twitter User: @{request.twitter_username} ({request.twitter_user_id})")
        logger.info(f"   Access Token: ...{request.access_token[-10:] if len(request.access_token) > 10 else 'SHORT'}")

        # Fetch Twitter data using OAuth access token
        twitter_data = await fetch_twitter_data_oauth(
            user_id=request.twitter_user_id,
            username=request.twitter_username,
            access_token=request.access_token
        )

        if not twitter_data['success']:
            return PlatformYapperOAuthResponse(
                success=False,
                error=f"Twitter data fetch failed: {twitter_data.get('error', 'Unknown error')}"
            )

        # Store profile data
        profile_updated = await store_yapper_profile_data(
            yapper_id=request.yapper_id,
            twitter_user_id=request.twitter_user_id,
            profile_data=twitter_data['profile']
        )

        # Perform comprehensive LLM analysis
        llm_analysis = None
        if twitter_data['tweets'] or twitter_data['image_urls']:
            try:
                logger.info(f"🧠 Running comprehensive LLM analysis for platform yapper {request.yapper_id}")
                analyzer = ComprehensiveLLMAnalyzer()
                
                tweet_texts = [tweet.get('text', '') for tweet in twitter_data['tweets']]
                llm_analysis = await analyzer.analyze_twitter_content(
                    twitter_handle=request.twitter_username,
                    tweet_texts=tweet_texts,
                    image_urls=twitter_data['image_urls'],
                    context={
                        'yapper_id': request.yapper_id,
                        'analysis_type': 'platform_yapper',
                        'total_tweets': len(twitter_data['tweets']),
                        'total_images': len(twitter_data['image_urls'])
                    },
                    analysis_type='platform_yapper'
                )
            except Exception as e:
                logger.error(f"❌ LLM analysis failed for yapper {request.yapper_id}: {str(e)}")
                llm_analysis = {
                    'success': False,
                    'error': str(e),
                    'provider_used': None,
                    'anthropic_analysis': None,
                    'openai_analysis': None
                }

        # Store tweet data with LLM analysis
        tweets_stored = await store_yapper_tweet_data(
            yapper_id=request.yapper_id,
            twitter_user_id=request.twitter_user_id,
            twitter_username=request.twitter_username,
            tweets_data=twitter_data['tweets'],
            llm_analysis=llm_analysis
        )

        # Populate training data immediately after storing tweets
        training_data_populated = 0
        if tweets_stored > 0 and llm_analysis and llm_analysis.get('success'):
            try:
                logger.info(f"🎯 Populating training data for yapper {request.yapper_id}")
                populator = TrainingDataPopulator(platform="cookie.fun")
                
                # Get the newly stored data and populate training tables
                result = await populator.populate_from_existing_analysis()
                
                if result.get('success'):
                    training_data_populated = result.get('records_processed', 0)
                    logger.info(f"✅ Populated {training_data_populated} training records for yapper {request.yapper_id}")
                else:
                    logger.warning(f"⚠️ Training data population failed for yapper {request.yapper_id}: {result.get('error')}")
                    
            except Exception as e:
                logger.error(f"❌ Error populating training data for yapper {request.yapper_id}: {str(e)}")

        logger.info(f"✅ OAuth data collection completed for yapper {request.yapper_id}")
        logger.info(f"   Profile updated: {profile_updated}")
        logger.info(f"   Tweets stored: {tweets_stored}")
        logger.info(f"   Training records populated: {training_data_populated}")

        return PlatformYapperOAuthResponse(
            success=True,
            tweets_stored=tweets_stored,
            profile_updated=profile_updated,
            training_records_populated=training_data_populated
        )

    except Exception as e:
        logger.error(f"❌ Error in OAuth data collection for yapper {request.yapper_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"OAuth data collection failed: {str(e)}"
        )

async def fetch_twitter_data_oauth(user_id: str, username: str, access_token: str) -> Dict[str, Any]:
    """
    Fetch Twitter data using OAuth access token
    """
    try:
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }

        # Fetch user profile
        profile_url = f'https://api.twitter.com/2/users/{user_id}'
        profile_params = {
            'user.fields': 'created_at,description,entities,location,pinned_tweet_id,profile_image_url,protected,public_metrics,url,username,verified'
        }

        profile_response = requests.get(profile_url, headers=headers, params=profile_params, timeout=10)
        
        if not profile_response.ok:
            logger.error(f"❌ Profile fetch failed: {profile_response.status_code} - {profile_response.text}")
            return {
                'success': False,
                'error': f'Profile fetch failed: {profile_response.status_code}'
            }

        profile_data = profile_response.json()

        # Fetch user tweets
        tweets_url = f'https://api.twitter.com/2/users/{user_id}/tweets'
        tweets_params = {
            'max_results': 50,
            'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments,author_id,conversation_id',
            'exclude': 'retweets,replies',
            'expansions': 'attachments.media_keys',
            'media.fields': 'type,url,preview_image_url'
        }

        tweets_response = requests.get(tweets_url, headers=headers, params=tweets_params, timeout=15)

        if not tweets_response.ok:
            logger.error(f"❌ Tweets fetch failed: {tweets_response.status_code} - {tweets_response.text}")
            return {
                'success': False,
                'error': f'Tweets fetch failed: {tweets_response.status_code}'
            }

        tweets_data = tweets_response.json()

        # Extract image URLs from media expansions
        image_urls = []
        media_dict = {}
        
        if 'includes' in tweets_data and 'media' in tweets_data['includes']:
            for media in tweets_data['includes']['media']:
                media_dict[media['media_key']] = media
                if media['type'] in ['photo', 'video'] and 'url' in media:
                    image_urls.append(media['url'])
                elif media['type'] == 'video' and 'preview_image_url' in media:
                    image_urls.append(media['preview_image_url'])

        logger.info(f"✅ OAuth Twitter data fetched for @{username}")
        logger.info(f"   Profile: {profile_data.get('data', {}).get('name', 'N/A')}")
        logger.info(f"   Tweets: {len(tweets_data.get('data', []))}")
        logger.info(f"   Images: {len(image_urls)}")

        return {
            'success': True,
            'profile': profile_data.get('data', {}),
            'tweets': tweets_data.get('data', []),
            'media': media_dict,
            'image_urls': image_urls
        }

    except requests.RequestException as e:
        logger.error(f"❌ Twitter API request failed for @{username}: {str(e)}")
        return {
            'success': False,
            'error': f'Twitter API request failed: {str(e)}'
        }
    except Exception as e:
        logger.error(f"❌ Unexpected error fetching Twitter data for @{username}: {str(e)}")
        return {
            'success': False,
            'error': f'Unexpected error: {str(e)}'
        }

async def store_yapper_profile_data(yapper_id: int, twitter_user_id: str, profile_data: Dict[str, Any]) -> bool:
    """
    Store platform yapper profile data
    """
    try:
        # Call TypeScript backend to store profile data
        response = requests.post(
            f"{get_typescript_backend_url()}/api/platform-yapper-profile",
            json={
                'yapper_id': yapper_id,
                'twitter_user_id': twitter_user_id,
                'profile_data': profile_data,
                'updated_at': datetime.utcnow().isoformat()
            },
            timeout=10
        )

        if response.ok:
            logger.info(f"✅ Profile data stored for yapper {yapper_id}")
            return True
        else:
            logger.error(f"❌ Failed to store profile data: {response.status_code} - {response.text}")
            return False

    except Exception as e:
        logger.error(f"❌ Error storing profile data for yapper {yapper_id}: {str(e)}")
        return False

async def store_yapper_tweet_data(yapper_id: int, twitter_user_id: str, twitter_username: str, tweets_data: List[Dict[str, Any]], llm_analysis: Dict[str, Any] = None) -> int:
    """
    Store platform yapper tweet data
    """
    try:
        if not tweets_data:
            logger.info(f"📭 No tweets to store for yapper {yapper_id}")
            return 0

        # Call TypeScript backend to store tweet data with LLM analysis
        response = requests.post(
            f"{get_typescript_backend_url()}/api/platform-yapper-tweets",
            json={
                'yapper_id': yapper_id,
                'twitter_user_id': twitter_user_id,
                'twitter_username': twitter_username,  # Pass the actual username
                'tweets': tweets_data,
                'llm_analysis': llm_analysis,
                'collected_at': datetime.utcnow().isoformat()
            },
            timeout=15
        )

        if response.ok:
            result = response.json()
            tweets_stored = result.get('tweets_stored', 0)
            logger.info(f"✅ Stored {tweets_stored} tweets for yapper {yapper_id}")
            return tweets_stored
        else:
            logger.error(f"❌ Failed to store tweet data: {response.status_code} - {response.text}")
            return 0

    except Exception as e:
        logger.error(f"❌ Error storing tweet data for yapper {yapper_id}: {str(e)}")
        return 0

def get_typescript_backend_url() -> str:
    """Get TypeScript backend URL from environment or use default"""
    import os
    return os.getenv('TYPESCRIPT_BACKEND_URL', 'http://localhost:5000')

@router.get("/platform-yapper-oauth-status")
async def get_oauth_service_status():
    """
    Get the status of the platform yapper OAuth service
    """
    try:
        return {
            "success": True,
            "service_status": "active",
            "oauth_flow": "enabled",
            "data_collection": {
                "profile_data": "enabled",
                "tweet_data": "enabled",
                "media_extraction": "enabled"
            },
            "endpoints": {
                "collect_data": "/api/platform-yapper-oauth-data",
                "status": "/api/platform-yapper-oauth-status"
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error checking OAuth service status: {str(e)}")
        return {
            "success": False,
            "service_status": "error",
            "error": str(e)
        }
