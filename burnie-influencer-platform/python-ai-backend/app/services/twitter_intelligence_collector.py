"""
Twitter Intelligence Collector Service

Collects and analyzes Twitter content from leaderboard yappers to extract success patterns.
Uses Anthropic image analysis to understand visual content patterns that correlate with platform success.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import tweepy
import aiofiles
import requests
from app.services.llm_providers import MultiProviderLLMService
from app.config.settings import settings
import logging

logger = logging.getLogger(__name__)

class TwitterIntelligenceCollector:
    """
    Collects intelligence from leaderboard yappers' Twitter content to identify success patterns
    """
    
    def __init__(self):
        """Initialize Twitter client and LLM service"""
        self.twitter_client = tweepy.Client(
            bearer_token=settings.TWITTER_BEARER_TOKEN,
            wait_on_rate_limit=False  # Don't block entire backend on rate limits
        )
        
        # Initialize LLM service with environment-configured providers
        default_provider = settings.default_llm_provider or 'anthropic'
        fallback_provider = settings.fallback_llm_provider or 'openai'
        
        logger.info(f"🔧 TwitterIntelligenceCollector: Initializing LLM with primary={default_provider}, fallback={fallback_provider}")
        
        self.llm_service = MultiProviderLLMService(
            primary_provider=default_provider,
            fallback_provider=fallback_provider
        )
        
    async def collect_yapper_intelligence(self, yapper_handle: str, platform_source: str, 
                                        leaderboard_position: int = None) -> Dict[str, Any]:
        """
        Collect and analyze intelligence from a specific yapper's Twitter content
        
        Args:
            yapper_handle: Twitter handle without @
            platform_source: e.g., 'cookie.fun', 'kaito'
            leaderboard_position: Current position on leaderboard
            
        Returns:
            Intelligence data ready for database storage
        """
        try:
            logger.info(f"🎯 Collecting intelligence for @{yapper_handle} on {platform_source}")
            
            # Fetch recent tweets (last 7 days)
            tweets = await self._fetch_recent_tweets(yapper_handle, days=7)
            
            if not tweets:
                logger.warning(f"No tweets found for @{yapper_handle}")
                return None
                
            # Process tweets with images separately and together
            intelligence_data = []
            image_tweets = []
            
            for tweet in tweets:
                tweet_intelligence = await self._analyze_single_tweet(tweet, platform_source, leaderboard_position)
                if tweet_intelligence:
                    intelligence_data.append(tweet_intelligence)
                    
                # Collect tweets with images for batch analysis
                if tweet.get('images'):
                    image_tweets.append(tweet)
            
            # Perform batch image analysis if we have multiple image tweets
            if len(image_tweets) > 1:
                batch_analysis = await self._analyze_image_batch(image_tweets, platform_source, leaderboard_position)
                if batch_analysis:
                    intelligence_data.append(batch_analysis)
                    
            # Store intelligence data
            stored_count = 0
            for intel in intelligence_data:
                if await self._store_intelligence_data(intel, yapper_handle, platform_source):
                    stored_count += 1
                    
            logger.info(f"✅ Stored {stored_count} intelligence records for @{yapper_handle}")
            return {"stored_records": stored_count, "total_tweets": len(tweets)}
            
        except Exception as e:
            logger.error(f"❌ Failed to collect intelligence for @{yapper_handle}: {str(e)}")
            return None
            
    async def _fetch_recent_tweets(self, username: str, days: int = 7) -> List[Dict]:
        """Fetch recent tweets from a user"""
        try:
            # Calculate date range
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(days=days)
            
            # Get user ID first
            user = self.twitter_client.get_user(username=username)
            if not user.data:
                return []
                
            user_id = user.data.id
            
            # Fetch tweets with media
            tweets = self.twitter_client.get_users_tweets(
                id=user_id,
                max_results=100,
                start_time=start_time,
                end_time=end_time,
                tweet_fields=['created_at', 'public_metrics', 'context_annotations'],
                media_fields=['url', 'type'],
                expansions=['attachments.media_keys']
            )
            
            if not tweets.data:
                return []
                
            # Process tweets and extract media
            processed_tweets = []
            media_dict = {}
            
            # Build media dictionary if media exists
            if tweets.includes and 'media' in tweets.includes:
                for media in tweets.includes['media']:
                    media_dict[media.media_key] = media
                    
            for tweet in tweets.data:
                tweet_data = {
                    'id': tweet.id,
                    'text': tweet.text,
                    'created_at': tweet.created_at,
                    'metrics': tweet.public_metrics,
                    'images': []
                }
                
                # Extract image URLs if available
                if tweet.attachments and 'media_keys' in tweet.attachments:
                    for media_key in tweet.attachments['media_keys']:
                        if media_key in media_dict:
                            media = media_dict[media_key]
                            if media.type == 'photo':
                                tweet_data['images'].append({
                                    'url': media.url,
                                    'media_key': media_key
                                })
                                
                processed_tweets.append(tweet_data)
                
            return processed_tweets
            
        except Exception as e:
            logger.error(f"Error fetching tweets for {username}: {str(e)}")
            return []
            
    async def _analyze_single_tweet(self, tweet: Dict, platform_source: str, 
                                  leaderboard_position: int) -> Optional[Dict]:
        """Analyze a single tweet for success patterns"""
        try:
            # Prepare analysis prompt
            analysis_prompt = self._build_intelligence_prompt(
                tweet_text=tweet['text'],
                platform_source=platform_source,
                leaderboard_position=leaderboard_position,
                engagement_metrics=tweet['metrics']
            )
            
            # Analyze images if present
            image_analysis = None
            if tweet['images']:
                image_urls = [img['url'] for img in tweet['images']]
                image_analysis = await self.llm_service.analyze_image_with_text(
                    image_paths=image_urls,
                    text_prompt=analysis_prompt,
                    provider="anthropic"
                )
                
            # Analyze text content
            text_analysis_result = await self.llm_service.analyze_text_content(
                prompt=analysis_prompt,
                provider="anthropic"
            )
            
            if isinstance(text_analysis_result, dict) and text_analysis_result.get('success'):
                text_analysis = text_analysis_result.get('content', '')
            else:
                text_analysis = text_analysis_result if isinstance(text_analysis_result, str) else ''
            
            return {
                'tweet_id': tweet['id'],
                'tweet_text': tweet['text'],
                'content_type': 'image' if tweet['images'] else 'text',
                'image_analysis_results': image_analysis,
                'anthropic_analysis': text_analysis,
                'engagement_metrics': tweet['metrics'],
                'posting_timing': tweet['created_at'],
                'extracted_at': datetime.utcnow()
            }
            
        except Exception as e:
            logger.error(f"Error analyzing tweet {tweet['id']}: {str(e)}")
            return None
            
    async def _analyze_image_batch(self, image_tweets: List[Dict], platform_source: str, 
                                 leaderboard_position: int) -> Optional[Dict]:
        """Analyze multiple image tweets together for pattern recognition"""
        try:
            # Collect all image URLs
            all_images = []
            tweet_texts = []
            
            for tweet in image_tweets:
                tweet_texts.append(tweet['text'])
                for img in tweet['images']:
                    all_images.append(img['url'])
                    
            if not all_images:
                return None
                
            # Build batch analysis prompt
            batch_prompt = self._build_batch_intelligence_prompt(
                tweet_texts=tweet_texts,
                platform_source=platform_source,
                leaderboard_position=leaderboard_position
            )
            
            # Perform multi-image analysis
            batch_analysis = await self.llm_service.analyze_image_with_text(
                image_paths=all_images,
                text_prompt=batch_prompt,
                provider="anthropic"
            )
            
            return {
                'tweet_id': 'batch_analysis',
                'tweet_text': ' | '.join(tweet_texts),
                'content_type': 'batch_image_analysis',
                'image_analysis_results': batch_analysis,
                'anthropic_analysis': batch_analysis,
                'engagement_metrics': self._aggregate_metrics([t['metrics'] for t in image_tweets]),
                'posting_timing': datetime.utcnow(),
                'extracted_at': datetime.utcnow()
            }
            
        except Exception as e:
            logger.error(f"Error in batch analysis: {str(e)}")
            return None
            
    def _build_intelligence_prompt(self, tweet_text: str, platform_source: str, 
                                 leaderboard_position: int, engagement_metrics: Dict) -> str:
        """Build prompt for single tweet intelligence analysis"""
        return f"""
        Analyze this Twitter content from a top-performing yapper on {platform_source}.

        YAPPER CONTEXT:
        - Platform: {platform_source}
        - Leaderboard Position: #{leaderboard_position if leaderboard_position else 'Top performer'}
        - Tweet Engagement: {engagement_metrics}

        TWEET CONTENT:
        "{tweet_text}"

        ANALYSIS REQUEST:
        Analyze this content and identify success patterns that likely contribute to this yapper's high platform ranking. Provide insights in JSON format:

        {{
            "content_quality_score": <score_out_of_10>,
            "viral_potential": <score_out_of_10>,
            "category_classification": "<gaming/defi/nft/meme/education/other>",
            "success_indicators": {{
                "engagement_hooks": ["hook1", "hook2"],
                "viral_elements": ["element1", "element2"],
                "platform_relevance": "<why_this_helps_on_{platform_source}>"
            }},
            "content_themes": ["theme1", "theme2"],
            "timing_insights": "<analysis_of_posting_timing>",
            "reasoning": "<detailed_explanation_of_success_factors>"
        }}

        Focus on WHY this content might contribute to success on {platform_source} specifically.
        """
        
    def _build_batch_intelligence_prompt(self, tweet_texts: List[str], platform_source: str, 
                                       leaderboard_position: int) -> str:
        """Build prompt for batch image analysis"""
        tweets_context = "\n".join([f"Tweet {i+1}: {text}" for i, text in enumerate(tweet_texts)])
        
        return f"""
        Analyze these multiple images and tweets from a top-performing yapper on {platform_source}.

        YAPPER CONTEXT:
        - Platform: {platform_source}
        - Leaderboard Position: #{leaderboard_position if leaderboard_position else 'Top performer'}

        TWEET TEXTS:
        {tweets_context}

        ANALYSIS REQUEST:
        Analyze the visual patterns across these images and identify consistent success elements. Provide insights in JSON format:

        {{
            "visual_pattern_analysis": {{
                "consistent_themes": ["theme1", "theme2"],
                "color_patterns": ["dominant_colors"],
                "composition_style": "<visual_composition_patterns>",
                "branding_elements": ["element1", "element2"]
            }},
            "content_strategy_insights": {{
                "posting_frequency": "<analysis>",
                "content_mix": "<text_vs_image_balance>",
                "engagement_optimization": ["factor1", "factor2"]
            }},
            "platform_success_correlation": {{
                "why_these_visuals_work": "<explanation>",
                "attention_economy_factors": ["factor1", "factor2"],
                "competitive_advantages": ["advantage1", "advantage2"]
            }},
            "overall_intelligence_score": <score_out_of_10>,
            "actionable_insights": ["insight1", "insight2"],
            "reasoning": "<comprehensive_analysis>"
        }}

        Focus on visual patterns that likely contribute to success on {platform_source}.
        """
        
    def _aggregate_metrics(self, metrics_list: List[Dict]) -> Dict:
        """Aggregate engagement metrics from multiple tweets"""
        if not metrics_list:
            return {}
            
        aggregated = {
            'total_retweet_count': sum(m.get('retweet_count', 0) for m in metrics_list),
            'total_like_count': sum(m.get('like_count', 0) for m in metrics_list),
            'total_reply_count': sum(m.get('reply_count', 0) for m in metrics_list),
            'avg_retweet_count': sum(m.get('retweet_count', 0) for m in metrics_list) / len(metrics_list),
            'avg_like_count': sum(m.get('like_count', 0) for m in metrics_list) / len(metrics_list),
            'avg_reply_count': sum(m.get('reply_count', 0) for m in metrics_list) / len(metrics_list),
            'tweet_count': len(metrics_list)
        }
        
        return aggregated
        
    async def _store_intelligence_data(self, intelligence: Dict, yapper_handle: str, 
                                     platform_source: str) -> bool:
        """Store intelligence data in the database"""
        try:
            # Prepare data for storage
            storage_data = {
                'yapper_twitter_handle': yapper_handle,
                'platform_source': platform_source,
                'leaderboard_position': None,  # Will be updated by caller if known
                'content_type': intelligence['content_type'],
                'tweet_id': intelligence['tweet_id'],
                'tweet_text': intelligence['tweet_text'],
                'image_analysis_results': intelligence.get('image_analysis_results'),
                'anthropic_analysis': intelligence.get('anthropic_analysis'),
                'engagement_metrics': intelligence['engagement_metrics'],
                'posting_timing': intelligence['posting_timing'],
                'extracted_at': intelligence['extracted_at']
            }
            
            # Extract structured data from analysis if available
            if intelligence.get('anthropic_analysis'):
                try:
                    analysis_json = json.loads(intelligence['anthropic_analysis'])
                    storage_data.update({
                        'content_themes': analysis_json.get('content_themes'),
                        'viral_elements': analysis_json.get('success_indicators', {}).get('viral_elements'),
                        'category_classification': analysis_json.get('category_classification'),
                        'success_indicators': analysis_json.get('success_indicators')
                    })
                except json.JSONDecodeError:
                    logger.warning(f"Could not parse analysis JSON for tweet {intelligence['tweet_id']}")
                    
            # Send to TypeScript backend for storage
            response = requests.post(
                f"{settings.TYPESCRIPT_BACKEND_URL}/api/intelligence/store-yapper-intelligence",
                json=storage_data,
                timeout=30
            )
            
            if response.status_code == 200:
                logger.info(f"✅ Stored intelligence for tweet {intelligence['tweet_id']}")
                return True
            else:
                logger.error(f"❌ Failed to store intelligence: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error storing intelligence data: {str(e)}")
            return False
            
    async def collect_batch_intelligence(self, yapper_handles: List[str], platform_source: str) -> Dict[str, Any]:
        """
        Collect intelligence from multiple yappers
        
        Args:
            yapper_handles: List of Twitter handles without @
            platform_source: Platform to analyze for
            
        Returns:
            Summary of collection results
        """
        results = {
            'successful_yappers': 0,
            'failed_yappers': 0,
            'total_records': 0,
            'errors': []
        }
        
        logger.info(f"🎯 Starting batch intelligence collection for {len(yapper_handles)} yappers on {platform_source}")
        
        for handle in yapper_handles:
            try:
                result = await self.collect_yapper_intelligence(handle, platform_source)
                if result:
                    results['successful_yappers'] += 1
                    results['total_records'] += result.get('stored_records', 0)
                else:
                    results['failed_yappers'] += 1
                    
                # Rate limiting - wait between requests
                await asyncio.sleep(2)
                
            except Exception as e:
                results['failed_yappers'] += 1
                results['errors'].append(f"{handle}: {str(e)}")
                logger.error(f"❌ Failed to process {handle}: {str(e)}")
                
        logger.info(f"✅ Batch collection complete: {results['successful_yappers']} successful, {results['failed_yappers']} failed")
        return results
