import os
import tweepy
import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timezone
import asyncio
from dataclasses import dataclass
import re
import random
import time
from functools import wraps

from app.config.settings import settings

# Configure logging
logger = logging.getLogger(__name__)

def retry_on_rate_limit(max_retries: int = 3, base_delay: float = 60.0):
    """
    Decorator to retry Twitter API calls with exponential backoff on rate limits
    
    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds (Twitter rate limit window is typically 15 minutes)
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                    
                except tweepy.TooManyRequests as e:
                    last_exception = e
                    
                    if attempt == max_retries:
                        logger.error(f"❌ Twitter API rate limit exceeded after {max_retries} retries")
                        raise e
                    
                    # Calculate delay with exponential backoff + jitter
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 5)
                    
                    logger.warning(f"⚠️ Twitter API rate limit exceeded (attempt {attempt + 1}/{max_retries + 1})")
                    logger.info(f"🔄 Retrying in {delay:.1f} seconds with exponential backoff...")
                    
                    await asyncio.sleep(delay)
                    continue
                    
                except Exception as e:
                    # For non-rate-limit exceptions, don't retry
                    logger.error(f"❌ Twitter API error (non-rate-limit): {e}")
                    raise e
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
                
        return wrapper
    return decorator

@dataclass
class TwitterPost:
    """Data class to represent a Twitter post"""
    tweet_id: str
    conversation_id: str
    text: str
    created_at: datetime
    author_username: str
    is_thread_start: bool
    thread_position: int
    hashtags: List[str]
    engagement_metrics: Dict[str, int]

@dataclass
class TwitterThread:
    """Data class to represent a complete Twitter thread"""
    main_tweet: TwitterPost
    thread_tweets: List[TwitterPost]
    total_tweets: int

class TwitterService:
    """Service for fetching Twitter data using Twitter API v2"""
    
    def __init__(self):
        self.api_key = settings.twitter_api_key
        self.api_secret = settings.twitter_api_secret
        self.bearer_token = settings.twitter_bearer_token
        
        if not self.bearer_token:
            logger.warning("⚠️ Twitter Bearer Token not found. Twitter features will be disabled.")
            self.client = None
            return
            
        logger.info("🐦 Initializing Twitter API client with loaded credentials...")
            
        try:
            # Initialize Twitter API v2 client
            self.client = tweepy.Client(
                bearer_token=self.bearer_token,
                consumer_key=self.api_key,
                consumer_secret=self.api_secret,
                wait_on_rate_limit=False  # Don't block entire backend on rate limits
            )
            logger.info("✅ Twitter API client initialized successfully")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Twitter API client: {e}")
            self.client = None
    
    def is_available(self) -> bool:
        """Check if Twitter API is available"""
        return self.client is not None
    
    def clean_username(self, username: str) -> str:
        """Clean and validate Twitter username"""
        if not username:
            return ""
        
        # Remove @ symbol if present
        username = username.strip().lstrip('@')
        
        # Basic validation (alphanumeric and underscore only)
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            logger.warning(f"⚠️ Invalid Twitter username format: {username}")
            return ""
        
        return username
    
    def extract_hashtags(self, text: str) -> List[str]:
        """Extract hashtags from tweet text"""
        hashtag_pattern = r'#\w+'
        hashtags = re.findall(hashtag_pattern, text)
        return [tag.lower() for tag in hashtags]
    
    @retry_on_rate_limit(max_retries=3, base_delay=60.0)
    async def get_user_id(self, username: str) -> Optional[str]:
        """Get Twitter user ID from username"""
        if not self.client:
            logger.error("❌ Twitter client not available")
            return None
        
        username = self.clean_username(username)
        if not username:
            return None
        
        try:
            user = self.client.get_user(username=username)
            if user.data:
                logger.info(f"✅ Found user ID for @{username}: {user.data.id}")
                return user.data.id
            else:
                logger.warning(f"⚠️ User not found: @{username}")
                return None
        except tweepy.NotFound:
            logger.warning(f"⚠️ Twitter user not found: @{username}")
            return None
        except tweepy.Unauthorized:
            logger.error("❌ Twitter API unauthorized - check credentials")
            return None
        except tweepy.TooManyRequests:
            # Let the decorator handle rate limits
            raise
        except Exception as e:
            logger.error(f"❌ Error fetching user ID for @{username}: {e}")
            return None
    
    @retry_on_rate_limit(max_retries=3, base_delay=60.0)
    async def fetch_user_tweets(
        self, 
        username: str, 
        max_results: int = 30,
        since_id: Optional[str] = None
    ) -> List[TwitterPost]:
        """
        Fetch recent tweets from a user
        
        Args:
            username: Twitter username (with or without @)
            max_results: Maximum number of tweets to fetch (max 100)
            since_id: Only fetch tweets after this tweet ID
            
        Returns:
            List of TwitterPost objects
        """
        if not self.client:
            logger.error("❌ Twitter client not available")
            return []
        
        user_id = await self.get_user_id(username)
        if not user_id:
            return []
        
        # Prepare tweet fields to fetch
        tweet_fields = [
            'id', 'text', 'created_at', 'conversation_id', 
            'public_metrics', 'referenced_tweets', 'entities'
        ]
        
        # Build query parameters
        kwargs = {
            'max_results': min(max_results, 100),  # API limit is 100
            'tweet_fields': tweet_fields,
            'exclude': ['retweets', 'replies']  # Get only original tweets
        }
        
        if since_id:
            kwargs['since_id'] = since_id
        
        # Fetch tweets (rate limit handling is done by decorator)
        tweets = self.client.get_users_tweets(user_id, **kwargs)
        
        if not tweets.data:
            logger.info(f"📭 No tweets found for @{username}")
            return []
        
        logger.info(f"📥 Fetched {len(tweets.data)} tweets for @{username}")
        
        # Convert to TwitterPost objects
        twitter_posts = []
        for tweet in tweets.data:
            # Extract hashtags
            hashtags = self.extract_hashtags(tweet.text)
            
            # Get engagement metrics
            metrics = tweet.public_metrics or {}
            engagement = {
                'likes': metrics.get('like_count', 0),
                'retweets': metrics.get('retweet_count', 0),
                'replies': metrics.get('reply_count', 0),
                'views': metrics.get('impression_count', 0)
            }
            
            # Create TwitterPost object
            post = TwitterPost(
                tweet_id=tweet.id,
                conversation_id=tweet.conversation_id or tweet.id,
                text=tweet.text,
                created_at=tweet.created_at,
                author_username=username,
                is_thread_start=tweet.conversation_id == tweet.id,
                thread_position=1,  # Will be updated if part of thread
                hashtags=hashtags,
                engagement_metrics=engagement
            )
            
            twitter_posts.append(post)
        
        # Sort by creation date (newest first)
        twitter_posts.sort(key=lambda x: x.created_at, reverse=True)
        
        return twitter_posts
    
    @retry_on_rate_limit(max_retries=3, base_delay=60.0)
    async def fetch_thread_tweets(self, conversation_id: str) -> List[TwitterPost]:
        """
        Fetch all tweets in a thread/conversation
        
        Args:
            conversation_id: Twitter conversation ID
            
        Returns:
            List of TwitterPost objects in thread order
        """
        if not self.client:
            logger.error("❌ Twitter client not available")
            return []
        
        # Search for tweets in this conversation
        query = f"conversation_id:{conversation_id}"
        
        tweets = self.client.search_recent_tweets(
            query=query,
            max_results=100,  # Max results per request
            tweet_fields=['id', 'text', 'created_at', 'conversation_id', 'author_id', 'public_metrics']
        )
        
        if not tweets.data:
            return []
        
        # Convert to TwitterPost objects and sort by creation time
        thread_posts = []
        for i, tweet in enumerate(sorted(tweets.data, key=lambda x: x.created_at)):
            hashtags = self.extract_hashtags(tweet.text)
            
            metrics = tweet.public_metrics or {}
            engagement = {
                'likes': metrics.get('like_count', 0),
                'retweets': metrics.get('retweet_count', 0),
                'replies': metrics.get('reply_count', 0),
                'views': metrics.get('impression_count', 0)
            }
            
            post = TwitterPost(
                tweet_id=tweet.id,
                conversation_id=conversation_id,
                text=tweet.text,
                created_at=tweet.created_at,
                author_username="", # Will be filled by caller
                is_thread_start=(i == 0),
                thread_position=i + 1,
                hashtags=hashtags,
                engagement_metrics=engagement
            )
            
            thread_posts.append(post)
        
        return thread_posts
    
    async def identify_and_fetch_threads(self, posts: List[TwitterPost]) -> List[TwitterThread]:
        """
        Identify thread starter tweets and fetch complete threads
        
        Args:
            posts: List of TwitterPost objects
            
        Returns:
            List of TwitterThread objects
        """
        threads = []
        
        for post in posts:
            # Check if this could be a thread starter
            # Heuristics: tweet ends with common thread indicators
            thread_indicators = ['👇', '🧵', '1/', '1.', 'thread', 'Thread', '(1/']
            is_likely_thread = any(indicator in post.text for indicator in thread_indicators)
            
            if is_likely_thread or post.conversation_id != post.tweet_id:
                # Fetch the complete thread
                thread_tweets = await self.fetch_thread_tweets(post.conversation_id)
                
                if len(thread_tweets) > 1:  # It's actually a thread
                    # Update author usernames
                    for tweet in thread_tweets:
                        tweet.author_username = post.author_username
                    
                    thread = TwitterThread(
                        main_tweet=thread_tweets[0],
                        thread_tweets=thread_tweets[1:],
                        total_tweets=len(thread_tweets)
                    )
                    threads.append(thread)
        
        return threads
    
    async def get_latest_tweets_with_threads(
        self, 
        username: str, 
        count: int = 30,
        since_id: Optional[str] = None
    ) -> Tuple[List[TwitterPost], List[TwitterThread]]:
        """
        Get latest tweets and identify/fetch complete threads
        
        Args:
            username: Twitter username
            count: Number of tweets to fetch
            since_id: Only fetch tweets after this ID
            
        Returns:
            Tuple of (individual_posts, complete_threads)
        """
        if not self.client:
            logger.error("❌ Twitter client not available")
            return [], []
        
        logger.info(f"🐦 Fetching latest {count} tweets for @{username}")
        
        # Fetch user's recent tweets
        posts = await self.fetch_user_tweets(username, count, since_id)
        
        if not posts:
            return [], []
        
        # Identify and fetch complete threads
        threads = await self.identify_and_fetch_threads(posts)
        
        # Remove thread starter tweets from individual posts if they're part of threads
        thread_starter_ids = {thread.main_tweet.tweet_id for thread in threads}
        individual_posts = [post for post in posts if post.tweet_id not in thread_starter_ids]
        
        logger.info(f"✅ Processed {len(individual_posts)} individual tweets and {len(threads)} threads")
        
        return individual_posts, threads
    
    def format_posts_for_ai_context(self, posts: List[TwitterPost], threads: List[TwitterThread]) -> str:
        """
        Format posts and threads for AI context in content generation
        
        Args:
            posts: Individual Twitter posts
            threads: Complete Twitter threads
            
        Returns:
            Formatted string for AI consumption
        """
        context_parts = []
        
        # Add individual posts
        if posts:
            context_parts.append("=== RECENT INDIVIDUAL TWEETS ===")
            for post in posts[:10]:  # Limit to 10 most recent
                created = post.created_at.strftime("%Y-%m-%d")
                context_parts.append(f"[{created}] {post.text}")
            context_parts.append("")
        
        # Add threads
        if threads:
            context_parts.append("=== RECENT TWEET THREADS ===")
            for thread in threads[:5]:  # Limit to 5 most recent threads
                created = thread.main_tweet.created_at.strftime("%Y-%m-%d")
                context_parts.append(f"[{created}] THREAD:")
                context_parts.append(f"Main Tweet: {thread.main_tweet.text}")
                
                for i, tweet in enumerate(thread.thread_tweets[:5], 2):  # Max 5 follow-up tweets
                    context_parts.append(f"Tweet {i}: {tweet.text}")
                
                if len(thread.thread_tweets) > 5:
                    context_parts.append(f"... (thread continues with {len(thread.thread_tweets) - 5} more tweets)")
                
                context_parts.append("")
        
        return "\n".join(context_parts)

# Global instance
twitter_service = TwitterService() 