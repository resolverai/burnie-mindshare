import asyncio
import logging
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
import requests
import os

from .twitter_service import twitter_service, TwitterPost, TwitterThread

# Configure logging
logger = logging.getLogger(__name__)

class ProjectTwitterIntegration:
    """Service to integrate Twitter data fetching with project management"""
    
    def __init__(self):
        self.typescript_backend_url = os.getenv('TYPESCRIPT_BACKEND_URL')
        if not self.typescript_backend_url:
            raise ValueError("TYPESCRIPT_BACKEND_URL environment variable is required")
        
    def format_twitter_handle(self, handle: str) -> str:
        """Format Twitter handle for consistency - preserve @ symbol as database stores it"""
        if not handle:
            return ""
        
        original_handle = handle
        # Clean whitespace but preserve @ symbol since database stores handles with @
        handle = handle.strip()
        
        # Ensure @ symbol is present (add if missing)
        if not handle.startswith('@'):
            handle = '@' + handle
            

        return handle
    
    async def fetch_and_store_project_tweets(
        self, 
        project_id: int,
        twitter_handle: str,
        count: int = 30,
        since_id: Optional[str] = None,
        fetch_all_since_id: bool = False
    ) -> Dict[str, Any]:
        """
        Fetch Twitter posts for a project and store them in the database
        
        Args:
            project_id: Project ID in the database
            twitter_handle: Twitter username (with or without @)
            count: Number of tweets to fetch
            since_id: Only fetch tweets after this ID
            
        Returns:
            Dictionary with fetch results
        """
        if not twitter_service.is_available():
            logger.warning("⚠️ Twitter service not available - skipping fetch")
            return {
                'success': False,
                'error': 'Twitter service not available',
                'posts_fetched': 0
            }
        
        logger.info(f"✅ Twitter service is available, proceeding with fetch")
        logger.info(f"🔧 Twitter service details: client={twitter_service.client is not None}, bearer_token_present={bool(twitter_service.bearer_token)}")
        
        handle = self.format_twitter_handle(twitter_handle)
        logger.info(f"🧹 Formatted Twitter handle: '@{twitter_handle}' -> '{handle}'")
        
        if not handle:
            logger.error(f"❌ Invalid Twitter handle after formatting: '{twitter_handle}' -> '{handle}'")
            return {
                'success': False,
                'error': 'Invalid Twitter handle',
                'posts_fetched': 0
            }
        
        try:
            logger.info(f"🐦 Fetching Twitter data for project {project_id} (@{handle})")
            logger.info(f"🔧 Fetch parameters: count={count}, since_id={since_id}, fetch_all_since_id={fetch_all_since_id}")
            
            all_individual_posts = []
            all_threads = []
            
            if fetch_all_since_id and since_id:
                # Fetch ALL tweets since last tweet ID

                logger.info(f"📜 Fetching ALL tweets since tweet ID: {since_id}")
                
                # For now, make a single call with max count to get all recent tweets
                # The Twitter API with since_id will return all tweets newer than that ID
                # up to the max_results limit (100)
                try:
                    individual_posts, threads = await twitter_service.get_latest_tweets_with_threads(
                        username=handle,
                        count=100,  # Get up to 100 tweets since last ID
                        since_id=since_id
                    )
                    all_individual_posts = individual_posts
                    all_threads = threads
                    logger.info(f"📊 Fetch all since {since_id}: {len(individual_posts)} individual posts, {len(threads)} threads")
                    
                    # If we got exactly 100 tweets, there might be more
                    if len(individual_posts) + len(threads) >= 100:
                        logger.warning(f"⚠️ Got 100+ tweets, there might be more tweets available. Consider implementing full pagination.")
                        
                except Exception as api_error:
                    logger.error(f"❌ Twitter API call failed: {api_error}")
                    return {
                        'success': False,
                        'error': f'Twitter API call failed: {str(api_error)}',
                        'posts_fetched': 0
                    }
                
            else:
                # Single fetch (for campaign creation or normal limited fetch)
                logger.info(f"📡 Single fetch mode: calling Twitter API for user: {handle}")
                try:
                    individual_posts, threads = await twitter_service.get_latest_tweets_with_threads(
                        username=handle,
                        count=count,
                        since_id=since_id
                    )
                    all_individual_posts = individual_posts
                    all_threads = threads
                    logger.info(f"📊 Single fetch result: {len(individual_posts)} individual posts, {len(threads)} threads")
                except Exception as api_error:
                    logger.error(f"❌ Twitter API call failed: {api_error}")
                    return {
                        'success': False,
                        'error': f'Twitter API call failed: {str(api_error)}',
                        'posts_fetched': 0
                    }
            
            if not all_individual_posts and not all_threads:
                logger.info(f"📭 No new tweets found for @{handle}")
                return {
                    'success': True,
                    'posts_fetched': 0,
                    'message': 'No new tweets found'
                }
            
            # Convert to storage format
            posts_data = []
            fetch_session_id = str(uuid.uuid4())
            
            # Process individual posts
            for post in all_individual_posts:
                posts_data.append({
                    'tweetId': post.tweet_id,
                    'conversationId': post.conversation_id,
                    'contentType': 'single',
                    'tweetText': post.text,
                    'threadPosition': 1,
                    'isThreadStart': False,
                    'threadTweets': None,
                    'hashtagsUsed': post.hashtags,
                    'engagementMetrics': post.engagement_metrics,
                    'postedAt': post.created_at.isoformat()
                })
            
            # Process threads
            for thread in all_threads:
                # Store main thread tweet
                thread_tweets_text = [tweet.text for tweet in thread.thread_tweets]
                posts_data.append({
                    'tweetId': thread.main_tweet.tweet_id,
                    'conversationId': thread.main_tweet.conversation_id,
                    'contentType': 'thread_start',
                    'tweetText': thread.main_tweet.text,
                    'threadPosition': 1,
                    'isThreadStart': True,
                    'threadTweets': thread_tweets_text,
                    'hashtagsUsed': thread.main_tweet.hashtags,
                    'engagementMetrics': thread.main_tweet.engagement_metrics,
                    'postedAt': thread.main_tweet.created_at.isoformat()
                })
            
            # Store in database via TypeScript backend
            storage_result = await self.store_twitter_data(
                project_id=project_id,
                twitter_handle=f"@{handle}",
                posts_data=posts_data,
                fetch_session_id=fetch_session_id
            )
            
            if storage_result['success']:
                logger.info(f"✅ Successfully processed {len(posts_data)} posts for project {project_id}")
                return {
                    'success': True,
                    'posts_fetched': len(posts_data),
                    'individual_posts': len(individual_posts),
                    'threads': len(threads),
                    'fetch_session_id': fetch_session_id
                }
            else:
                import traceback
                logger.error(f"❌ Failed to store Twitter data: {storage_result.get('error', 'Unknown error')}")
                logger.error(f"❌ Storage result details: {storage_result}")
                logger.error(f"❌ Current traceback for storage failure:")
                logger.error(traceback.format_exc())
                traceback.print_exc()
                return {
                    'success': False,
                    'error': f"Storage failed: {storage_result.get('error', 'Unknown error')}",
                    'posts_fetched': 0
                }
                
        except Exception as e:
            import traceback
            logger.error(f"❌ Error fetching Twitter data for project {project_id}: {e}")
            logger.error(f"❌ Full traceback in fetch_and_store_project_tweets:")
            logger.error(traceback.format_exc())
            traceback.print_exc()  # Print to console as well
            return {
                'success': False,
                'error': str(e),
                'posts_fetched': 0
            }
    
    async def store_twitter_data(
        self,
        project_id: int,
        twitter_handle: str,
        posts_data: List[Dict[str, Any]],
        fetch_session_id: str
    ) -> Dict[str, Any]:
        """
        Store Twitter data via TypeScript backend API
        
        Args:
            project_id: Project ID
            twitter_handle: Twitter handle
            posts_data: List of post data dictionaries
            fetch_session_id: Unique session ID for this fetch
            
        Returns:
            Dictionary with storage result
        """
        try:
            payload = {
                'projectId': project_id,
                'twitterHandle': twitter_handle,
                'posts': posts_data,
                'fetchSessionId': fetch_session_id
            }
            
            url = f"{self.typescript_backend_url}/api/projects/twitter-data"
            logger.info(f"🔗 Storing Twitter data: POST {url}")
            logger.info(f"📦 Payload: projectId={project_id}, twitterHandle='{twitter_handle}', posts_count={len(posts_data)}, fetchSessionId='{fetch_session_id}'")
            
            response = requests.post(url, json=payload, timeout=30)
            
            logger.info(f"📡 Storage response: status={response.status_code}")
            if response.status_code != 200:
                logger.error(f"❌ Storage response text: {response.text}")
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ Storage successful: {result}")
                return {
                    'success': True,
                    'data': result
                }
            else:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.error(f"❌ Failed to store Twitter data: {error_msg}")
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except requests.RequestException as e:
            import traceback
            logger.error(f"❌ Network error storing Twitter data: {e}")
            logger.error(f"❌ Network error traceback:")
            logger.error(traceback.format_exc())
            traceback.print_exc()
            return {
                'success': False,
                'error': f"Network error: {str(e)}"
            }
        except Exception as e:
            import traceback
            logger.error(f"❌ Unexpected error storing Twitter data: {e}")
            logger.error(f"❌ Unexpected error traceback:")
            logger.error(traceback.format_exc())
            traceback.print_exc()
            return {
                'success': False,
                'error': f"Unexpected error: {str(e)}"
            }
    
    async def check_daily_fetch_status(self, project_id: int, twitter_handle: str) -> Dict[str, Any]:
        """
        Check if Twitter data was already fetched today for a project
        
        Args:
            project_id: Project ID
            twitter_handle: Twitter handle
            
        Returns:
            Dictionary with fetch status
        """
        try:
            formatted_handle = self.format_twitter_handle(twitter_handle)
            
            url = f"{self.typescript_backend_url}/api/projects/{project_id}/twitter-status"
            params = {'twitterHandle': formatted_handle}
            

            
            logger.info(f"🔗 Checking daily status: {url} with params {params}")
            
            response = requests.get(url, params=params, timeout=10)
            

            logger.info(f"📡 Daily status response: status={response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ Daily status result: {result}")
                return result
            else:
                logger.warning(f"⚠️ Daily status check failed with HTTP {response.status_code}: {response.text}")
                logger.info(f"🔄 Will attempt fetch since daily status check failed")
                return {
                    'success': False,
                    'fetched_today': False,  # Try to fetch when status check fails
                    'error': f"HTTP {response.status_code}"
                }
                
        except Exception as e:
            logger.error(f"❌ Error checking daily fetch status: {e}")
            logger.info(f"🔄 Will attempt fetch since daily status check failed with error")
            return {
                'success': False,
                'fetched_today': False,  # Try to fetch when status check fails
                'error': str(e)
            }
    
    async def get_project_twitter_handle(self, project_id: int) -> Optional[str]:
        """
        Get the Twitter handle for a project from project_twitter_data table
        
        Args:
            project_id: Project ID
            
        Returns:
            Twitter handle if found, None otherwise
        """
        try:
    
            
            url = f"{self.typescript_backend_url}/api/projects/{project_id}/twitter-handle"
            

            response = requests.get(url, timeout=10)
            

            
            if response.status_code == 200:
                data = response.json()

                
                if data.get('success') and data.get('twitterHandle'):
                    handle = data['twitterHandle']

                    return handle
                else:

                    return None
            else:

                logger.error(f"❌ Error getting project Twitter handle: HTTP {response.status_code}")
                return None
                
        except Exception as e:

            logger.error(f"❌ Error getting project Twitter handle: {e}")
            return None

    async def get_latest_tweet_id(self, project_id: int, twitter_handle: str) -> Optional[str]:
        """
        Get the latest tweet ID for a project (for since_id parameter)
        
        Args:
            project_id: Project ID
            twitter_handle: Twitter handle
            
        Returns:
            Latest tweet ID or None
        """
        try:
            response = requests.get(
                f"{self.typescript_backend_url}/api/projects/{project_id}/latest-tweet-id",
                params={'twitterHandle': self.format_twitter_handle(twitter_handle)},
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                return result.get('latestTweetId')
            else:
                logger.warning(f"⚠️ Failed to get latest tweet ID: HTTP {response.status_code}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error getting latest tweet ID: {e}")
            return None
    
    async def get_project_twitter_context(self, project_id: int) -> str:
        """
        Get formatted Twitter context for AI content generation
        
        Args:
            project_id: Project ID
            
        Returns:
            Formatted Twitter context string
        """
        try:
            response = requests.get(
                f"{self.typescript_backend_url}/api/projects/{project_id}/twitter-context",
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                return result.get('context', '')
            else:
                logger.warning(f"⚠️ Failed to get Twitter context: HTTP {response.status_code}")
                return ''
                
        except Exception as e:
            logger.error(f"❌ Error getting Twitter context: {e}")
            return ''
    
    async def handle_campaign_creation_fetch(
        self,
        project_id: int,
        project_name: str,
        twitter_handle: str
    ) -> Dict[str, Any]:
        """
        Handle Twitter data fetching when a campaign is created
        
        Args:
            project_id: Project ID
            project_name: Project name (for logging)
            twitter_handle: Twitter handle
            
        Returns:
            Dictionary with fetch results
        """
        try:
            logger.info(f"🚀 Campaign created for {project_name} - fetching Twitter data")
            logger.info(f"🔍 handle_campaign_creation_fetch called with: project_id={project_id}, twitter_handle='{twitter_handle}'")
            
            result = await self.fetch_and_store_project_tweets(
                project_id=project_id,
                twitter_handle=twitter_handle,
                count=30  # Initial fetch: 30 posts
            )
            
            if result['success']:
                logger.info(f"✅ Initial Twitter fetch completed for {project_name}: {result['posts_fetched']} posts")
            else:
                logger.warning(f"⚠️ Initial Twitter fetch failed for {project_name}: {result.get('error', 'Unknown error')}")
            
            return result
            
        except Exception as e:
            import traceback
            logger.error(f"❌ Exception in handle_campaign_creation_fetch: {e}")
            logger.error(f"❌ Full traceback in handle_campaign_creation_fetch:")
            logger.error(traceback.format_exc())
            traceback.print_exc()  # Print to console as well
            return {
                'success': False,
                'error': f'Exception in campaign creation fetch: {str(e)}',
                'posts_fetched': 0
            }
    
    async def handle_campaign_edit_fetch(
        self,
        project_id: int,
        project_name: str,
        twitter_handle: str
    ) -> Dict[str, Any]:
        """
        Handle Twitter data fetching when a campaign is edited (fetch all since last tweet)
        
        Args:
            project_id: Project ID
            project_name: Project name (for logging)
            twitter_handle: Twitter handle
            
        Returns:
            Dictionary with fetch results
        """
        try:
            logger.info(f"✏️ Campaign edited for {project_name} - fetching all new Twitter data since last tweet")
            
            # Get latest tweet ID for incremental fetch
            since_id = await self.get_latest_tweet_id(project_id, twitter_handle)
            
            logger.info(f"🔄 Campaign edit triggered for {project_name} - fetching all tweets since last ID")
            
            result = await self.fetch_and_store_project_tweets(
                project_id=project_id,
                twitter_handle=twitter_handle,
                count=50,  # Not used when fetch_all_since_id=True
                since_id=since_id,
                fetch_all_since_id=True  # Fetch ALL tweets since last tweet ID
            )
            
            if result['success']:
                if result['posts_fetched'] > 0:
                    logger.info(f"✅ Campaign edit Twitter fetch completed for {project_name}: {result['posts_fetched']} new posts")
                else:
                    logger.info(f"📭 No new tweets found for {project_name} since last fetch")
            else:
                logger.warning(f"⚠️ Campaign edit Twitter fetch failed for {project_name}: {result.get('error', 'Unknown error')}")
            
            return result
            
        except Exception as e:
            import traceback
            logger.error(f"❌ Exception in handle_campaign_edit_fetch: {e}")
            logger.error(f"❌ Full traceback in handle_campaign_edit_fetch:")
            logger.error(traceback.format_exc())
            traceback.print_exc()  # Print to console as well
            return {
                'success': False,
                'error': f'Exception in campaign edit fetch: {str(e)}',
                'posts_fetched': 0
            }

    async def handle_content_generation_fetch(
        self,
        project_id: int,
        project_name: str,
        twitter_handle: str
    ) -> Dict[str, Any]:
        """
        Handle Twitter data fetching when content is generated (with daily limit)
        
        Args:
            project_id: Project ID
            project_name: Project name (for logging)
            twitter_handle: Twitter handle
            
        Returns:
            Dictionary with fetch results
        """

        
        logger.info(f"🔍 handle_content_generation_fetch called with: project_id={project_id}, twitter_handle='{twitter_handle}'")
        
        # Check if we already fetched today

        logger.info(f"📅 Checking daily fetch status for project {project_id}")
        daily_status = await self.check_daily_fetch_status(project_id, twitter_handle)

        logger.info(f"📊 Daily status result: {daily_status}")
        
        if daily_status.get('fetched_today', False):
            logger.info(f"📅 Twitter data already fetched today for {project_name} - skipping")
            return {
                'success': True,
                'posts_fetched': 0,
                'message': 'Already fetched today',
                'skipped': True
            }
        
        # Get latest tweet ID for incremental fetch
        since_id = await self.get_latest_tweet_id(project_id, twitter_handle)
        
        logger.info(f"🔄 Content generation triggered for {project_name} - checking for new tweets")
        
        result = await self.fetch_and_store_project_tweets(
            project_id=project_id,
            twitter_handle=twitter_handle,
            count=50,  # Not used when fetch_all_since_id=True
            since_id=since_id,
            fetch_all_since_id=True  # Fetch ALL tweets since last tweet ID
        )
        
        if result['success']:
            if result['posts_fetched'] > 0:
                logger.info(f"✅ Daily Twitter fetch completed for {project_name}: {result['posts_fetched']} new posts")
            else:
                logger.info(f"📭 No new tweets found for {project_name}")
        else:
            logger.warning(f"⚠️ Daily Twitter fetch failed for {project_name}: {result.get('error', 'Unknown error')}")
        
        return result

# Global instance
project_twitter_integration = ProjectTwitterIntegration() 