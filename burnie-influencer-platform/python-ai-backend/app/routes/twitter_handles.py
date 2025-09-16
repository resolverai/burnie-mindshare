"""
Twitter Handles Management API
Handles fetching Twitter data for popular handles and storing individual tweets
"""

import asyncio
import logging
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import requests
from datetime import datetime, timezone
import json
from sqlalchemy import text

from app.config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Pydantic models
class TwitterHandleRefreshRequest(BaseModel):
    handle_ids: List[int]
    twitter_handles: List[str]
    last_tweet_ids: Optional[List[str]] = None

class TwitterHandleRefreshResponse(BaseModel):
    success: bool
    message: str
    results: List[Dict[str, Any]]
    errors: List[Dict[str, Any]]

class TwitterPost(BaseModel):
    id: str
    text: str
    created_at: str
    public_metrics: Dict[str, int]
    conversation_id: str
    attachments: Optional[Dict[str, Any]] = None
    entities: Optional[Dict[str, Any]] = None

class TwitterProfile(BaseModel):
    id: str
    username: str
    name: str
    description: Optional[str] = None
    followers_count: int
    following_count: int
    tweet_count: int
    verified: bool
    profile_image_url: Optional[str] = None

class TwitterHandleData(BaseModel):
    handle_id: int
    twitter_handle: str
    profile: TwitterProfile
    tweets: List[TwitterPost]
    images: List[str]
    tweet_media_map: Dict[str, List[str]]  # Map tweet_id to list of image URLs
    success: bool
    error: Optional[str] = None

class TwitterService:
    """Service for fetching Twitter data using Bearer token"""
    
    def __init__(self):
        self.settings = get_settings()
        self.bearer_token = self.settings.twitter_bearer_token
        self.base_url = "https://api.twitter.com/2"
        
        if not self.bearer_token:
            logger.error("❌ Twitter Bearer token not configured")
            raise ValueError("Twitter Bearer token is required")
    
    def _make_request(self, url: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Make authenticated request to Twitter API"""
        headers = {
            'Authorization': f'Bearer {self.bearer_token}',
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.get(url, headers=headers, params=params, timeout=30)
            
            if response.status_code == 429:
                logger.warning("⚠️ Twitter API rate limit exceeded")
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            
            if not response.ok:
                logger.error(f"❌ Twitter API error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=response.status_code, detail=response.text)
            
            return response.json()
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Request failed: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Request failed: {str(e)}")
    
    async def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get user data by username"""
        try:
            # Clean username (remove @ if present)
            clean_username = username.lstrip('@')
            
            url = f"{self.base_url}/users/by/username/{clean_username}"
            params = {
                'user.fields': 'id,username,name,description,public_metrics,verified,profile_image_url,created_at'
            }
            
            data = self._make_request(url, params)
            
            if 'data' in data:
                return data['data']
            else:
                logger.warning(f"⚠️ User not found: @{clean_username}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error fetching user @{username}: {str(e)}")
            return None
    
    async def fetch_user_tweets(
        self, 
        user_id: str, 
        max_results: int = 30,
        since_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Fetch user tweets with optional since_id for incremental updates"""
        try:
            url = f"{self.base_url}/users/{user_id}/tweets"
            params = {
                'max_results': min(max_results, 100),  # API limit is 100
                'tweet.fields': 'id,text,created_at,public_metrics,attachments,entities,conversation_id',
                'exclude': 'retweets,replies',  # Only original tweets
                'expansions': 'attachments.media_keys',
                'media.fields': 'type,url,preview_image_url'
            }
            
            if since_id:
                params['since_id'] = since_id
            
            data = self._make_request(url, params)
            
            tweets = data.get('data', [])
            media_dict = {}
            
            # Process media expansions
            if 'includes' in data and 'media' in data['includes']:
                for media in data['includes']['media']:
                    media_dict[media['media_key']] = media
            
            # Add media URLs to tweets
            for tweet in tweets:
                tweet['media_urls'] = []
                if 'attachments' in tweet and 'media_keys' in tweet['attachments']:
                    for media_key in tweet['attachments']['media_keys']:
                        if media_key in media_dict:
                            media = media_dict[media_key]
                            if media['type'] == 'photo':
                                tweet['media_urls'].append(media['url'])
                            elif media['type'] == 'video' and 'preview_image_url' in media:
                                tweet['media_urls'].append(media['preview_image_url'])
            
            logger.info(f"📥 Fetched {len(tweets)} tweets for user {user_id}")
            return tweets
            
        except Exception as e:
            logger.error(f"❌ Error fetching tweets for user {user_id}: {str(e)}")
            return []
    
    async def fetch_handle_data(
        self, 
        handle_id: int, 
        twitter_handle: str,
        last_tweet_id: Optional[str] = None
    ) -> TwitterHandleData:
        """Fetch complete data for a Twitter handle"""
        try:
            logger.info(f"🐦 Fetching data for @{twitter_handle} (ID: {handle_id})")
            
            # Get user profile
            user_data = await self.get_user_by_username(twitter_handle)
            if not user_data:
                return TwitterHandleData(
                    handle_id=handle_id,
                    twitter_handle=twitter_handle,
                    profile=TwitterProfile(
                        id="",
                        username=twitter_handle,
                        name="",
                        followers_count=0,
                        following_count=0,
                        tweet_count=0,
                        verified=False
                    ),
                    tweets=[],
                    images=[],
                    tweet_media_map={},
                    success=False,
                    error="User not found"
                )
            
            # Determine fetch strategy
            if last_tweet_id and last_tweet_id.strip():
                # Incremental fetch - get tweets since last tweet ID
                max_results = 100  # Get more for incremental updates
                logger.info(f"🔄 Incremental fetch for @{twitter_handle} since tweet {last_tweet_id}")
            else:
                # First-time fetch - get latest 30 tweets
                max_results = 30
                logger.info(f"🆕 First-time fetch for @{twitter_handle} - getting {max_results} tweets")
            
            # Fetch tweets
            tweets = await self.fetch_user_tweets(
                user_data['id'], 
                max_results=max_results,
                since_id=last_tweet_id
            )
            
            # Extract image URLs and create tweet-to-media mapping
            images = []
            tweet_media_map = {}
            for tweet in tweets:
                tweet_id = tweet['id']
                tweet_images = tweet.get('media_urls', [])
                tweet_media_map[tweet_id] = tweet_images
                images.extend(tweet_images)
                
                # Debug logging
                if tweet_images:
                    logger.info(f"📸 Tweet {tweet_id} has {len(tweet_images)} images: {tweet_images}")
                else:
                    logger.debug(f"📝 Tweet {tweet_id} has no images")
            
            # Create profile object
            profile = TwitterProfile(
                id=user_data['id'],
                username=user_data['username'],
                name=user_data['name'],
                description=user_data.get('description'),
                followers_count=user_data['public_metrics']['followers_count'],
                following_count=user_data['public_metrics']['following_count'],
                tweet_count=user_data['public_metrics']['tweet_count'],
                verified=user_data.get('verified', False),
                profile_image_url=user_data.get('profile_image_url')
            )
            
            # Create tweet objects
            tweet_objects = []
            for tweet in tweets:
                tweet_objects.append(TwitterPost(
                    id=tweet['id'],
                    text=tweet['text'],
                    created_at=tweet['created_at'],
                    public_metrics=tweet['public_metrics'],
                    conversation_id=tweet['conversation_id'],
                    attachments=tweet.get('attachments'),
                    entities=tweet.get('entities')
                ))
            
            logger.info(f"✅ Successfully fetched data for @{twitter_handle}: {len(tweet_objects)} tweets, {len(images)} images")
            
            return TwitterHandleData(
                handle_id=handle_id,
                twitter_handle=twitter_handle,
                profile=profile,
                tweets=tweet_objects,
                images=images,
                tweet_media_map=tweet_media_map,
                success=True
            )
            
        except Exception as e:
            logger.error(f"❌ Error fetching data for @{twitter_handle}: {str(e)}")
            return TwitterHandleData(
                handle_id=handle_id,
                twitter_handle=twitter_handle,
                profile=TwitterProfile(
                    id="",
                    username=twitter_handle,
                    name="",
                    followers_count=0,
                    following_count=0,
                    tweet_count=0,
                    verified=False
                ),
                tweets=[],
                images=[],
                tweet_media_map={},
                success=False,
                error=str(e)
            )

@router.post("/refresh", response_model=TwitterHandleRefreshResponse)
async def refresh_twitter_handles_data(request: TwitterHandleRefreshRequest):
    """
    Refresh Twitter data for popular handles and store individual tweets
    
    - First time: Fetches latest 30 tweets
    - Subsequent: Fetches tweets since last_tweet_id
    """
    try:
        logger.info(f"🔄 Refreshing Twitter data for {len(request.twitter_handles)} handles")
        
        # Initialize Twitter service
        twitter_service = TwitterService()
        
        # Fetch data for each handle
        results = []
        errors = []
        
        for i, (handle_id, twitter_handle) in enumerate(zip(request.handle_ids, request.twitter_handles)):
            try:
                # Add delay between requests to respect rate limits
                if i > 0:
                    await asyncio.sleep(1)  # 1 second delay between requests
                
                # Get last_tweet_id from TypeScript backend
                last_tweet_id = None
                if request.last_tweet_ids and i < len(request.last_tweet_ids):
                    last_tweet_id = request.last_tweet_ids[i] if request.last_tweet_ids[i] else None
                
                # Determine fetch strategy based on last_tweet_id
                if last_tweet_id:
                    logger.info(f"🔄 Incremental fetch for @{twitter_handle} since tweet {last_tweet_id}")
                else:
                    logger.info(f"🆕 First-time fetch for @{twitter_handle} - getting 30 tweets")
                
                handle_data = await twitter_service.fetch_handle_data(
                    handle_id=handle_id,
                    twitter_handle=twitter_handle,
                    last_tweet_id=last_tweet_id
                )
                
                if handle_data.success:
                    # Store individual tweets in database via TypeScript backend
                    logger.info(f"🔄 Calling store_tweets_in_database for @{twitter_handle}")
                    await store_tweets_in_database(handle_data)
                    logger.info(f"✅ Completed store_tweets_in_database for @{twitter_handle}")
                    
                    results.append({
                        'handle_id': handle_id,
                        'twitter_handle': twitter_handle,
                        'tweets_count': len(handle_data.tweets),
                        'images_count': len(handle_data.images),
                        'followers_count': handle_data.profile.followers_count,
                        'following_count': handle_data.profile.following_count,
                        'verified': handle_data.profile.verified,
                        'profile_image_url': handle_data.profile.profile_image_url,
                        'latest_tweet_id': handle_data.tweets[0].id if handle_data.tweets else None
                    })
                else:
                    errors.append({
                        'handle_id': handle_id,
                        'twitter_handle': twitter_handle,
                        'error': handle_data.error
                    })
                    
            except Exception as e:
                logger.error(f"❌ Error processing @{twitter_handle}: {str(e)}")
                errors.append({
                    'handle_id': handle_id,
                    'twitter_handle': twitter_handle,
                    'error': str(e)
                })
        
        logger.info(f"✅ Refresh completed: {len(results)} successful, {len(errors)} errors")
        
        return TwitterHandleRefreshResponse(
            success=len(errors) == 0,
            message=f"Processed {len(request.twitter_handles)} handles: {len(results)} successful, {len(errors)} errors",
            results=results,
            errors=errors
        )
        
    except Exception as e:
        logger.error(f"❌ Error in refresh endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def store_tweets_in_database(handle_data: TwitterHandleData):
    """Store individual tweets in the database via TypeScript backend"""
    try:
        print(f"🚀 STORE_TWEETS_IN_DATABASE CALLED for @{handle_data.twitter_handle} with {len(handle_data.tweets)} tweets")
        logger.info(f"💾 Starting to store {len(handle_data.tweets)} tweets for @{handle_data.twitter_handle}")
        
        # Import here to avoid circular imports
        from app.database.connection import get_db_session
        
        # Get database session
        session = get_db_session()
        print(f"🔗 Database session created: {session}")
        
        try:
            logger.info(f"💾 Processing {len(handle_data.tweets)} tweets for storage")
            
            # Group tweets by conversation_id to identify threads
            conversation_groups = {}
            for tweet in handle_data.tweets:
                conv_id = tweet.conversation_id
                logger.info(f"🔍 Tweet {tweet.id} has conversation_id: {conv_id}")
                if conv_id not in conversation_groups:
                    conversation_groups[conv_id] = []
                conversation_groups[conv_id].append(tweet)
            
            # Debug: Print conversation groups
            for conv_id, tweets in conversation_groups.items():
                logger.info(f"📊 Conversation {conv_id}: {len(tweets)} tweets")
                for tweet in tweets:
                    logger.info(f"  - Tweet {tweet.id} at {tweet.created_at}")
            
            # Sort tweets within each conversation by created_at to determine thread position
            for conv_id, tweets_in_conversation in conversation_groups.items():
                tweets_in_conversation.sort(key=lambda x: x.created_at)
            
            logger.info(f"📊 Found {len(conversation_groups)} conversations, {sum(1 for conv in conversation_groups.values() if len(conv) > 1)} with multiple tweets")
            
            # Prepare tweets for insertion
            tweets_to_insert = []
            for tweet in handle_data.tweets:
                # Parse engagement metrics
                engagement_metrics = {
                    'like_count': tweet.public_metrics.get('like_count', 0),
                    'retweet_count': tweet.public_metrics.get('retweet_count', 0),
                    'reply_count': tweet.public_metrics.get('reply_count', 0),
                    'quote_count': tweet.public_metrics.get('quote_count', 0)
                }
                
                # Get tweet images from the tweet_media_map
                tweet_images = handle_data.tweet_media_map.get(tweet.id, [])
                
                # Determine thread information
                conv_id = tweet.conversation_id
                tweets_in_conversation = conversation_groups[conv_id]
                is_thread = len(tweets_in_conversation) > 1
                
                logger.info(f"🔍 Tweet {tweet.id}: conv_id={conv_id}, tweets_in_conversation={len(tweets_in_conversation)}, is_thread={is_thread}")
                
                # Debug: Check if conversation_id is being accessed correctly
                logger.info(f"🔍 Tweet {tweet.id}: conversation_id field = {getattr(tweet, 'conversation_id', 'NOT_FOUND')}")
                
                # Find thread position and parent tweet
                thread_position = None
                parent_tweet_id = None
                
                if is_thread:
                    # Find this tweet's position in the conversation
                    for i, conv_tweet in enumerate(tweets_in_conversation):
                        if conv_tweet.id == tweet.id:
                            thread_position = i + 1  # 1-based position
                            if i > 0:
                                parent_tweet_id = tweets_in_conversation[0].id  # First tweet is the parent
                            break
                
                # Debug logging
                if tweet_images:
                    logger.info(f"📸 Storing {len(tweet_images)} images for tweet {tweet.id}: {tweet_images}")
                else:
                    logger.debug(f"📝 No images for tweet {tweet.id}")
                
                if is_thread:
                    logger.info(f"🧵 Thread tweet {tweet.id}: position {thread_position}, parent {parent_tweet_id}")
                
                # Debug: Check what we're actually storing
                tweet_images_json = json.dumps(tweet_images) if tweet_images else None
                logger.info(f"🔍 Tweet {tweet.id} - tweet_images: {tweet_images}, JSON: {tweet_images_json}")
                
                # Parse posted_at timestamp
                posted_at = datetime.fromisoformat(tweet.created_at.replace('Z', '+00:00'))
                
                # Use raw SQL to insert tweets
                insert_query = text("""
                    INSERT INTO popular_twitter_handles 
                    (twitter_handle, tweet_id, tweet_text, tweet_images, is_thread, thread_position, 
                     parent_tweet_id, engagement_metrics, posted_at, content_category, 
                     anthropic_analysis, openai_analysis, fetched_at, updated_at)
                    VALUES (:twitter_handle, :tweet_id, :tweet_text, :tweet_images, :is_thread, :thread_position, 
                            :parent_tweet_id, :engagement_metrics, :posted_at, :content_category, 
                            :anthropic_analysis, :openai_analysis, :fetched_at, :updated_at)
                    ON CONFLICT (tweet_id) DO UPDATE SET
                        tweet_text = EXCLUDED.tweet_text,
                        tweet_images = EXCLUDED.tweet_images,
                        engagement_metrics = EXCLUDED.engagement_metrics,
                        updated_at = EXCLUDED.updated_at
                """)
                
                try:
                    session.execute(insert_query, {
                        'twitter_handle': handle_data.twitter_handle,
                        'tweet_id': tweet.id,
                        'tweet_text': tweet.text,
                        'tweet_images': json.dumps(tweet_images) if tweet_images else None,
                        'is_thread': is_thread,
                        'thread_position': thread_position,
                        'parent_tweet_id': parent_tweet_id,
                        'engagement_metrics': json.dumps(engagement_metrics),
                        'posted_at': posted_at,
                        'content_category': None,  # Could be auto-classified later
                        'anthropic_analysis': None,
                        'openai_analysis': None,
                        'fetched_at': datetime.now(timezone.utc),
                        'updated_at': datetime.now(timezone.utc)
                    })
                    logger.info(f"✅ Inserted tweet {tweet.id} with {len(tweet_images)} images")
                except Exception as e:
                    logger.error(f"❌ Error inserting tweet {tweet.id}: {str(e)}")
                    raise
            
            # Commit all tweets
            print(f"💾 Committing {len(handle_data.tweets)} tweets to database")
            session.commit()
            print(f"✅ Successfully committed tweets to database")
            logger.info(f"✅ Stored {len(handle_data.tweets)} tweets for @{handle_data.twitter_handle}")
            
        finally:
            print(f"🔌 Closing database session")
            session.close()
            
    except Exception as e:
        logger.error(f"❌ Error storing tweets in database: {str(e)}")
        # Don't raise the error, just log it so the main flow continues

@router.get("/test-db")
async def test_database():
    """Test database connection and insert a test tweet"""
    try:
        from app.database.connection import get_db_session
        session = get_db_session()
        
        # Test insert
        test_query = text("""
            INSERT INTO popular_twitter_handles 
            (twitter_handle, tweet_id, tweet_text, tweet_images, engagement_metrics, posted_at, fetched_at, updated_at)
            VALUES (:twitter_handle, :tweet_id, :tweet_text, :tweet_images, :engagement_metrics, :posted_at, :fetched_at, :updated_at)
            ON CONFLICT (tweet_id) DO NOTHING
        """)
        
        session.execute(test_query, {
            'twitter_handle': 'test_handle',
            'tweet_id': 'test_tweet_123',
            'tweet_text': 'Test tweet with images',
            'tweet_images': json.dumps(['https://example.com/image1.jpg', 'https://example.com/image2.jpg']),
            'engagement_metrics': json.dumps({'like_count': 10, 'retweet_count': 5}),
            'posted_at': datetime.now(timezone.utc),
            'fetched_at': datetime.now(timezone.utc),
            'updated_at': datetime.now(timezone.utc)
        })
        
        session.commit()
        session.close()
        
        return {"status": "success", "message": "Test tweet inserted successfully"}
        
    except Exception as e:
        logger.error(f"❌ Database test failed: {str(e)}")
        return {"status": "error", "message": str(e)}

@router.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        twitter_service = TwitterService()
        return {"status": "healthy", "twitter_api": "available"}
    except Exception as e:
        return {"status": "unhealthy", "twitter_api": "unavailable", "error": str(e)}