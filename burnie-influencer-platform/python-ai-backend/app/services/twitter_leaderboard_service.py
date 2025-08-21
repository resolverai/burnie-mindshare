"""
Twitter Leaderboard Service
Fetches Twitter data for leaderboard yappers including tweets and images
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import aiohttp
import tweepy
from tweepy import API, OAuth1UserHandler
import requests

from app.config.settings import get_settings
from app.services.llm_providers import MultiProviderLLMService
from app.services.comprehensive_llm_analyzer import ComprehensiveLLMAnalyzer
from app.services.training_data_populator import TrainingDataPopulator

logger = logging.getLogger(__name__)

class TwitterLeaderboardService:
    """
    Service to fetch Twitter data for leaderboard yappers
    
    Fetches:
    - Profile information
    - Last 20 tweets
    - Tweet images (URLs)
    - Engagement metrics
    """
    
    def __init__(self):
        self.settings = get_settings()
        self._setup_twitter_api()
        
        # Initialize LLM service with environment-configured providers
        default_provider = self.settings.default_llm_provider or 'anthropic'
        fallback_provider = self.settings.fallback_llm_provider or 'openai'
        self.llm_service = MultiProviderLLMService(
            primary_provider=default_provider,
            fallback_provider=fallback_provider
        )
        self.comprehensive_analyzer = ComprehensiveLLMAnalyzer()
        
    def _setup_twitter_api(self):
        """Setup Twitter API client using Bearer token"""
        try:
            if not self.settings.twitter_bearer_token:
                logger.error("❌ Twitter Bearer Token not found in settings")
                self.api = None
                return
                
            # Use Twitter API v2 client with Bearer token (same as TwitterService)
            self.api = tweepy.Client(
                bearer_token=self.settings.twitter_bearer_token,
                consumer_key=self.settings.twitter_api_key,
                consumer_secret=self.settings.twitter_api_secret,
                wait_on_rate_limit=False  # Don't block entire backend on rate limits
            )
            
            logger.info("✅ Twitter API client initialized with Bearer token")
            
        except Exception as e:
            logger.error(f"❌ Twitter API authentication failed: {str(e)}")
            self.api = None
    
    async def fetch_yapper_twitter_data(
        self, 
        twitter_handle: str, 
        yapper_name: str
    ) -> Dict[str, Any]:
        """
        Fetch comprehensive Twitter data for a yapper using Twitter API v2
        
        Args:
            twitter_handle: Twitter handle (without @)
            yapper_name: Display name from leaderboard
            
        Returns:
            Dict containing profile, tweets, and image data
        """
        if not self.api:
            return {"success": False, "error": "Twitter API not available"}
        
        try:
            # Clean Twitter handle
            handle = self._clean_twitter_handle(twitter_handle)
            
            if not handle:
                return {"success": False, "error": "Invalid Twitter handle"}
            
            logger.info(f"🐦 Fetching Twitter data for @{handle} ({yapper_name})")
            
            # Get user info and tweets using Twitter API v2
            user = self.api.get_user(username=handle, user_fields=['public_metrics', 'description', 'verified', 'location', 'profile_image_url'])
            
            if not user.data:
                return {"success": False, "error": "User not found"}
            
            user_data = user.data
            
            # Get user tweets with media
            tweets_response = self.api.get_users_tweets(
                user_data.id,
                max_results=20,
                tweet_fields=['created_at', 'public_metrics', 'attachments', 'entities'],
                media_fields=['type', 'url', 'preview_image_url'],
                expansions=['attachments.media_keys']
            )
            
            # Process profile data
            profile = {
                "id": user_data.id,
                "screen_name": handle,
                "name": user_data.name,
                "description": user_data.description or "",
                "followers_count": user_data.public_metrics.get('followers_count', 0),
                "following_count": user_data.public_metrics.get('following_count', 0),
                "tweets_count": user_data.public_metrics.get('tweet_count', 0),
                "verified": user_data.verified or False,
                "profile_image_url": user_data.profile_image_url,
                "location": user_data.location
            }
            
            # Process tweets data
            tweets = []
            image_urls = []
            
            if tweets_response.data:
                # Build media dictionary for easy lookup
                media_dict = {}
                if tweets_response.includes and 'media' in tweets_response.includes:
                    for media in tweets_response.includes['media']:
                        media_dict[media.media_key] = media
                
                for tweet in tweets_response.data:
                    tweet_data = {
                        "id": tweet.id,
                        "text": tweet.text,
                        "created_at": tweet.created_at.isoformat() if tweet.created_at else "",
                        "likes": tweet.public_metrics.get('like_count', 0),
                        "retweets": tweet.public_metrics.get('retweet_count', 0),
                        "replies": tweet.public_metrics.get('reply_count', 0),
                        "hashtags": [],
                        "mentions": [],
                        "urls": [],
                        "media": []
                    }
                    
                    # Extract hashtags and mentions from entities
                    if tweet.entities:
                        if 'hashtags' in tweet.entities:
                            tweet_data["hashtags"] = [tag['tag'] for tag in tweet.entities['hashtags']]
                        if 'mentions' in tweet.entities:
                            tweet_data["mentions"] = [mention['username'] for mention in tweet.entities['mentions']]
                        if 'urls' in tweet.entities:
                            tweet_data["urls"] = [url.get('expanded_url', url.get('url', '')) for url in tweet.entities['urls']]
                    
                    # Process media attachments
                    if tweet.attachments and 'media_keys' in tweet.attachments:
                        for media_key in tweet.attachments['media_keys']:
                            if media_key in media_dict:
                                media = media_dict[media_key]
                                media_data = {
                                    "type": media.type,
                                    "url": media.url or media.preview_image_url,
                                    "display_url": media.url or media.preview_image_url
                                }
                                tweet_data["media"].append(media_data)
                                
                                # Add to image URLs list
                                if media.url:
                                    image_urls.append(media.url)
                                elif media.preview_image_url:
                                    image_urls.append(media.preview_image_url)
                    
                    tweets.append(tweet_data)
            
            # Perform comprehensive LLM analysis (images + text) if content is available
            llm_analysis_result = None
            if image_urls or tweets:
                try:
                    logger.info(f"🎯 Running comprehensive LLM analysis for @{handle}")
                    logger.info(f"   Images: {len(image_urls)}, Tweets: {len(tweets)}")
                    
                    tweet_texts = [t['text'] for t in tweets if t.get('text')]
                    llm_analysis_result = await self.comprehensive_analyzer.analyze_twitter_content(
                        twitter_handle=handle,
                        tweet_texts=tweet_texts,
                        image_urls=image_urls,
                        context={
                            'platform_source': 'leaderboard',
                            'analysis_type': 'leaderboard_yapper',
                            'total_tweets': len(tweets),
                            'total_images': len(image_urls)
                        },
                        analysis_type='leaderboard_yapper'
                    )
                except Exception as e:
                    logger.error(f"❌ Comprehensive LLM analysis failed for @{handle}: {str(e)}")
                    llm_analysis_result = {
                        'success': False,
                        'error': str(e),
                        'provider_used': None,
                        'anthropic_analysis': None,
                        'openai_analysis': None
                    }
            
            # Populate training data immediately after LLM analysis (similar to platform yapper flow)
            training_data_populated = 0
            if llm_analysis_result and llm_analysis_result.get('success') and tweets:
                try:
                    logger.info(f"🎯 Populating training data for leaderboard yapper @{handle}")
                    populator = TrainingDataPopulator(platform="cookie.fun")
                    
                    # Create mock records similar to what platform yapper flow expects
                    for i, tweet in enumerate(tweets):
                        if not tweet.get('text'):
                            continue
                            
                        # Calculate engagement rate for this yapper
                        tweet_engagement = tweet.get('likes', 0) + tweet.get('retweets', 0) + tweet.get('replies', 0)
                        yapper_engagement_rate = (tweet_engagement / profile.get('followers_count', 1)) * 100 if profile.get('followers_count', 0) > 0 else 0
                        
                        # Create a mock record structure similar to platform_yapper_twitter_data
                        # Parse the created_at string to datetime object
                        created_at_str = tweet.get('created_at')
                        posted_at = datetime.now()  # Default fallback
                        if created_at_str:
                            try:
                                # Parse ISO format datetime string and remove timezone info
                                dt_with_tz = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                                posted_at = dt_with_tz.replace(tzinfo=None)  # Remove timezone to make it naive
                            except:
                                posted_at = datetime.now()
                        
                        mock_record = {
                            'twitter_handle': handle,
                            'tweet_text': tweet.get('text', ''),
                            'tweet_id': str(tweet.get('id', f"leaderboard_{handle}_{i}")),  # Convert to string
                            'posted_at': posted_at,  # Use parsed datetime object
                            'engagement_metrics': {
                                'like_count': tweet.get('likes', 0),
                                'retweet_count': tweet.get('retweets', 0),
                                'reply_count': tweet.get('replies', 0),
                                'quote_count': 0  # Not available in leaderboard data
                            },
                            'anthropic_analysis': llm_analysis_result.get('anthropic_analysis') if llm_analysis_result.get('provider_used') == 'anthropic' else None,
                            'openai_analysis': llm_analysis_result.get('openai_analysis') if llm_analysis_result.get('provider_used') == 'openai' else llm_analysis_result.get('analysis'),
                            'followers_count': profile.get('followers_count', 0),
                            'following_count': profile.get('following_count', 0),
                            'tweet_count': profile.get('tweets_count', 0),
                            'verified': profile.get('verified', False),
                            'engagement_rate': yapper_engagement_rate
                        }
                        
                        # Extract ML features and populate training data for this tweet
                        ml_features = populator._extract_ml_features_from_analysis(mock_record)
                        if ml_features:
                            # Connect to database and insert training data
                            import asyncpg
                            from app.config.settings import settings
                            
                            conn = await asyncpg.connect(
                                host=settings.database_host,
                                port=settings.database_port,
                                user=settings.database_user,
                                password=settings.database_password,
                                database=settings.database_name
                            )
                            
                            try:
                                await populator._insert_twitter_engagement_data(conn, mock_record, ml_features)
                                await populator._insert_primary_predictor_data(conn, mock_record, ml_features)
                                training_data_populated += 1
                            finally:
                                await conn.close()
                    
                    logger.info(f"✅ Populated {training_data_populated} training records for leaderboard yapper @{handle}")
                    
                except Exception as e:
                    logger.error(f"❌ Error populating training data for leaderboard yapper @{handle}: {str(e)}")
            
            # Calculate engagement metrics
            total_engagement = sum(tweet['likes'] + tweet['retweets'] + tweet['replies'] for tweet in tweets)
            tweets_count = len(tweets)
            avg_engagement = total_engagement / tweets_count if tweets_count > 0 else 0
            engagement_rate = (avg_engagement / profile['followers_count']) * 100 if profile['followers_count'] > 0 else 0
            
            engagement_metrics = {
                "engagement_rate": round(engagement_rate, 2),
                "avg_likes": round(sum(tweet['likes'] for tweet in tweets) / tweets_count, 2) if tweets_count > 0 else 0,
                "avg_retweets": round(sum(tweet['retweets'] for tweet in tweets) / tweets_count, 2) if tweets_count > 0 else 0,
                "avg_replies": round(sum(tweet['replies'] for tweet in tweets) / tweets_count, 2) if tweets_count > 0 else 0,
                "total_engagement": total_engagement,
                "tweets_analyzed": tweets_count
            }
            
            return {
                "success": True,
                "twitter_handle": handle,
                "yapper_name": yapper_name,
                "profile": profile,
                "recent_tweets": tweets,
                "tweet_image_urls": image_urls,
                "llm_analysis": llm_analysis_result,  # Comprehensive LLM analysis
                "engagement_metrics": engagement_metrics,
                "fetch_timestamp": datetime.utcnow().isoformat(),
                "tweets_count": tweets_count,
                "images_count": len(image_urls),
                "training_records_populated": training_data_populated  # Number of training records created
            }
            
        except tweepy.TooManyRequests:
            logger.warning(f"⚠️ Twitter API rate limit exceeded for @{handle}")
            logger.info(f"🔄 This will be handled by upper-level retry logic or scheduling")
            return {
                "success": False, 
                "error": "rate_limited",
                "retry_after": 900,  # 15 minutes
                "should_retry": True  # Indicate this can be retried
            }
        except tweepy.NotFound:
            logger.warning(f"User not found: @{handle}")
            return {
                "success": False, 
                "error": "User not found"
            }
        except tweepy.Unauthorized:
            logger.error("Twitter API unauthorized - check credentials")
            return {
                "success": False, 
                "error": "Unauthorized - check Twitter API credentials"
            }
        except Exception as e:
            logger.error(f"❌ Error fetching Twitter data for @{handle}: {str(e)}")
            return {
                "success": False, 
                "error": str(e)
            }
    
    async def _fetch_user_profile(self, handle: str) -> Dict[str, Any]:
        """Fetch user profile information"""
        try:
            # Run in executor to avoid blocking
            loop = asyncio.get_event_loop()
            user = await loop.run_in_executor(
                None, 
                self.api.get_user, 
                screen_name=handle
            )
            
            profile = {
                "id": user.id,
                "screen_name": user.screen_name,
                "name": user.name,
                "description": user.description,
                "followers_count": user.followers_count,
                "following_count": user.friends_count,
                "tweets_count": user.statuses_count,
                "verified": user.verified,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "profile_image_url": user.profile_image_url_https,
                "location": user.location,
                "url": user.url
            }
            
            return {"success": True, "profile": profile}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _fetch_recent_tweets(self, handle: str, count: int = 20) -> Dict[str, Any]:
        """Fetch recent tweets for user"""
        try:
            # Run in executor to avoid blocking
            loop = asyncio.get_event_loop()
            tweets = await loop.run_in_executor(
                None,
                lambda: self.api.user_timeline(
                    screen_name=handle,
                    count=count,
                    include_rts=False,  # Exclude retweets
                    tweet_mode='extended'  # Get full text
                )
            )
            
            tweet_data = []
            for tweet in tweets:
                tweet_obj = {
                    "id": tweet.id,
                    "text": tweet.full_text,
                    "created_at": tweet.created_at.isoformat(),
                    "likes": tweet.favorite_count,
                    "retweets": tweet.retweet_count,
                    "replies": getattr(tweet, 'reply_count', 0),  # May not be available
                    "hashtags": [tag['text'] for tag in tweet.entities.get('hashtags', [])],
                    "mentions": [mention['screen_name'] for mention in tweet.entities.get('user_mentions', [])],
                    "urls": [url.get('expanded_url', url.get('url', '')) for url in tweet.entities.get('urls', [])],
                    "media": []
                }
                
                # Extract media information
                if hasattr(tweet, 'extended_entities') and 'media' in tweet.extended_entities:
                    for media in tweet.extended_entities['media']:
                        tweet_obj["media"].append({
                            "type": media['type'],
                            "url": media['media_url_https'],
                            "display_url": media['display_url']
                        })
                
                tweet_data.append(tweet_obj)
            
            return {"success": True, "tweets": tweet_data}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _extract_tweet_images(self, tweets: List[Dict[str, Any]]) -> List[str]:
        """Extract image URLs from tweets"""
        image_urls = []
        
        for tweet in tweets:
            if "media" in tweet:
                for media in tweet["media"]:
                    if media["type"] in ["photo", "video_thumb"]:
                        image_urls.append(media["url"])
        
        return list(set(image_urls))  # Remove duplicates
    
    def _calculate_engagement_metrics(
        self, 
        tweets: List[Dict[str, Any]], 
        followers_count: int
    ) -> Dict[str, Any]:
        """Calculate engagement metrics"""
        if not tweets or followers_count <= 0:
            return {"engagement_rate": 0, "avg_likes": 0, "avg_retweets": 0}
        
        total_likes = sum(tweet.get("likes", 0) for tweet in tweets)
        total_retweets = sum(tweet.get("retweets", 0) for tweet in tweets)
        total_replies = sum(tweet.get("replies", 0) for tweet in tweets)
        
        total_engagement = total_likes + total_retweets + total_replies
        avg_engagement = total_engagement / len(tweets)
        engagement_rate = (avg_engagement / followers_count) * 100 if followers_count > 0 else 0
        
        return {
            "engagement_rate": round(engagement_rate, 4),
            "avg_likes": round(total_likes / len(tweets), 2),
            "avg_retweets": round(total_retweets / len(tweets), 2),
            "avg_replies": round(total_replies / len(tweets), 2),
            "total_engagement": total_engagement,
            "tweets_analyzed": len(tweets)
        }
    
    def _clean_twitter_handle(self, handle: str) -> Optional[str]:
        """Clean and validate Twitter handle"""
        if not handle:
            return None
        
        # Remove @ symbol if present
        handle = handle.lstrip('@')
        
        # Remove any whitespace
        handle = handle.strip()
        
        # Validate Twitter handle format (alphanumeric + underscore, 1-15 chars)
        if re.match(r'^[a-zA-Z0-9_]{1,15}$', handle):
            return handle
        
        return None
    
    async def fetch_multiple_yappers_data(
        self, 
        yapper_handles: List[Tuple[str, str]],  # List of (handle, name) tuples
        batch_size: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Fetch Twitter data for multiple yappers with rate limiting
        
        Args:
            yapper_handles: List of (twitter_handle, yapper_name) tuples
            batch_size: Number of concurrent requests
            
        Returns:
            List of Twitter data results
        """
        results = []
        
        # Process in batches to respect rate limits
        for i in range(0, len(yapper_handles), batch_size):
            batch = yapper_handles[i:i + batch_size]
            
            # Create tasks for current batch
            tasks = [
                self.fetch_yapper_twitter_data(handle, name) 
                for handle, name in batch
            ]
            
            # Execute batch
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for j, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    logger.error(f"Exception for {batch[j][0]}: {str(result)}")
                    results.append({
                        "success": False,
                        "twitter_handle": batch[j][0],
                        "yapper_name": batch[j][1],
                        "error": str(result)
                    })
                else:
                    results.append(result)
            
            # Wait between batches to respect rate limits
            if i + batch_size < len(yapper_handles):
                logger.info(f"Processed batch {i//batch_size + 1}, waiting before next batch...")
                await asyncio.sleep(60)  # 1 minute between batches
        
        return results
    
    def get_rate_limit_status(self) -> Dict[str, Any]:
        """Get current rate limit status"""
        if not self.api:
            return {"error": "Twitter API not available"}
        
        try:
            rate_limit = self.api.get_rate_limit_status()
            return {
                "users": rate_limit['resources']['users'],
                "statuses": rate_limit['resources']['statuses'],
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {"error": str(e)}
    
    async def _analyze_images_with_anthropic(self, image_urls: List[str], twitter_handle: str, tweets: List[Dict[str, Any]]) -> str:
        """
        Analyze tweet images using Anthropic multi-image analysis
        Returns a concise analysis (max 200 words) about the yapper's visual content patterns
        """
        try:
            if not image_urls:
                return None
                
            # Limit to first 10 images to avoid overwhelming the analysis
            limited_images = image_urls[:10]
            
            # Gather context from tweets with images
            tweet_contexts = []
            for tweet in tweets:
                if tweet.get('media') and len(tweet['media']) > 0:
                    tweet_contexts.append({
                        'text': tweet['text'][:100] + '...' if len(tweet['text']) > 100 else tweet['text'],
                        'engagement': tweet['likes'] + tweet['retweets'] + tweet['replies']
                    })
            
            # Create analysis prompt
            prompt = f"""
            Analyze the visual content patterns from @{twitter_handle}'s recent tweets with images. 
            
            Context - Tweet texts with these images:
            {chr(10).join([f"- {ctx['text']} (engagement: {ctx['engagement']})" for ctx in tweet_contexts[:5]])}
            
            Provide a concise analysis (MAX 200 words) covering:
            1. Visual content themes and patterns
            2. Content style (professional/casual/meme/educational)
            3. Engagement correlation with visual elements
            4. Unique visual characteristics that might contribute to platform success
            5. Recommendations for content optimization
            
            Focus on actionable insights for content creation and platform success.
            """
            
            # Use multi-image analysis with fallback
            result = await self.llm_service.analyze_multiple_images_with_fallback(
                image_paths=limited_images,
                prompt=prompt,
                context={
                    'yapper_handle': twitter_handle,
                    'analysis_type': 'leaderboard_content_patterns',
                    'image_count': len(limited_images)
                }
            )
            
            if result and result.get('success'):
                analysis_text = result.get('analysis', '')
                
                # Ensure the analysis is within 200 words
                words = analysis_text.split()
                if len(words) > 200:
                    truncated = ' '.join(words[:200]) + '...'
                    logger.info(f"🔄 Truncated Anthropic analysis for @{twitter_handle} from {len(words)} to 200 words")
                    return truncated
                
                logger.info(f"✅ Generated {len(words)}-word Anthropic analysis for @{twitter_handle}")
                return analysis_text
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                logger.error(f"❌ Anthropic analysis failed for @{twitter_handle}: {error_msg}")
                return f"Analysis unavailable: {error_msg}"
                
        except Exception as e:
            logger.error(f"❌ Error in Anthropic image analysis for @{twitter_handle}: {str(e)}")
            return f"Analysis error: {str(e)}"
