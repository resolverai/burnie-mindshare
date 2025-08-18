"""
Platform Yapper Service

Handles Twitter data collection and analysis for yappers who sign up on Burnie Influencer Platform.
Includes special handling for novice yappers (not on leaderboards) vs experienced yappers.
"""

import asyncio
import json
import requests
import tweepy
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import logging

from app.services.llm_providers import MultiProviderLLMService
from app.config.settings import settings

logger = logging.getLogger(__name__)

class PlatformYapperService:
    """
    Service for managing platform yappers' Twitter data and predictions
    """
    
    def __init__(self):
        """Initialize Twitter client and LLM service"""
        self.twitter_client = tweepy.Client(
            bearer_token=settings.TWITTER_BEARER_TOKEN,
            wait_on_rate_limit=False  # Don't block entire backend on rate limits
        )
        
        # Initialize LLM service with environment-configured providers
        default_provider = settings.DEFAULT_LLM_PROVIDER or 'anthropic'
        fallback_provider = settings.FALLBACK_LLM_PROVIDER or 'openai'
        self.llm_service = MultiProviderLLMService(
            primary_provider=default_provider,
            fallback_provider=fallback_provider
        )
        
    async def collect_yapper_twitter_profile(self, yapper_id: int, twitter_handle: str) -> Dict[str, Any]:
        """
        Collect comprehensive Twitter profile data for a platform yapper
        
        Args:
            yapper_id: Internal user ID
            twitter_handle: Twitter handle without @
            
        Returns:
            Profile data and collection status
        """
        try:
            logger.info(f"🎯 Collecting Twitter profile for yapper {yapper_id} (@{twitter_handle})")
            
            # Get user profile
            user = self.twitter_client.get_user(
                username=twitter_handle,
                user_fields=['created_at', 'description', 'public_metrics', 'verified']
            )
            
            if not user.data:
                return {'success': False, 'error': f'Twitter user @{twitter_handle} not found'}
            
            user_data = user.data
            
            # Get recent tweets (last 30 days for analysis)
            tweets = await self._fetch_user_tweets(twitter_handle, days=30)
            
            # Analyze content style and patterns
            content_analysis = await self._analyze_yapper_content_style(tweets, twitter_handle)
            
            # Calculate engagement metrics
            engagement_metrics = self._calculate_engagement_metrics(tweets, user_data.public_metrics)
            
            # Determine yapper experience level
            experience_level = await self._assess_yapper_experience(
                yapper_id, twitter_handle, user_data, tweets, engagement_metrics
            )
            
            # Prepare profile data
            profile_data = {
                'yapper_id': yapper_id,
                'twitter_handle': twitter_handle,
                'followers_count': user_data.public_metrics['followers_count'],
                'following_count': user_data.public_metrics['following_count'],
                'tweet_count': user_data.public_metrics['tweet_count'],
                'account_created_at': user_data.created_at,
                'verified': user_data.verified or False,
                'engagement_rate': engagement_metrics['avg_engagement_rate'],
                'optimal_posting_times': engagement_metrics['optimal_times'],
                'content_style_analysis': content_analysis,
                'performance_patterns': {
                    'avg_likes': engagement_metrics['avg_likes'],
                    'avg_retweets': engagement_metrics['avg_retweets'],
                    'avg_replies': engagement_metrics['avg_replies'],
                    'posting_frequency': engagement_metrics['posting_frequency'],
                    'content_consistency': engagement_metrics['content_consistency']
                },
                'experience_level': experience_level,
                'total_tweets_analyzed': len(tweets)
            }
            
            # Store profile data
            await self._store_yapper_profile(profile_data)
            
            # Store individual tweets for detailed analysis
            stored_tweets = 0
            for tweet in tweets:
                if await self._store_yapper_tweet(yapper_id, twitter_handle, tweet):
                    stored_tweets += 1
                    
            logger.info(f"✅ Collected profile for @{twitter_handle}: {len(tweets)} tweets, experience: {experience_level['level']}")
            
            return {
                'success': True,
                'profile_data': profile_data,
                'tweets_stored': stored_tweets,
                'experience_level': experience_level
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to collect Twitter profile for yapper {yapper_id}: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def _fetch_user_tweets(self, username: str, days: int = 30) -> List[Dict]:
        """Fetch recent tweets from a user"""
        try:
            # Get user ID
            user = self.twitter_client.get_user(username=username)
            if not user.data:
                return []
                
            user_id = user.data.id
            
            # Calculate date range
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(days=days)
            
            # Fetch tweets
            tweets = self.twitter_client.get_users_tweets(
                id=user_id,
                max_results=100,
                start_time=start_time,
                end_time=end_time,
                tweet_fields=['created_at', 'public_metrics', 'context_annotations', 'conversation_id'],
                media_fields=['url', 'type'],
                expansions=['attachments.media_keys']
            )
            
            if not tweets.data:
                return []
                
            # Process tweets
            processed_tweets = []
            media_dict = {}
            
            # Build media dictionary
            if tweets.includes and 'media' in tweets.includes:
                for media in tweets.includes['media']:
                    media_dict[media.media_key] = media
                    
            for tweet in tweets.data:
                tweet_data = {
                    'id': tweet.id,
                    'text': tweet.text,
                    'created_at': tweet.created_at,
                    'metrics': tweet.public_metrics,
                    'conversation_id': tweet.conversation_id,
                    'images': []
                }
                
                # Extract images
                if tweet.attachments and 'media_keys' in tweet.attachments:
                    for media_key in tweet.attachments['media_keys']:
                        if media_key in media_dict:
                            media = media_dict[media_key]
                            if media.type == 'photo':
                                tweet_data['images'].append({
                                    'url': media.url,
                                    'media_key': media_key
                                })
                                
                # Determine if it's part of a thread
                tweet_data['is_thread'] = tweet.conversation_id != tweet.id
                
                processed_tweets.append(tweet_data)
                
            return processed_tweets
            
        except Exception as e:
            logger.error(f"Error fetching tweets for {username}: {str(e)}")
            return []
            
    async def _analyze_yapper_content_style(self, tweets: List[Dict], twitter_handle: str) -> Dict[str, Any]:
        """Analyze yapper's content style using Anthropic"""
        try:
            if not tweets:
                return {'analysis': 'No tweets available for analysis'}
                
            # Sample tweets for analysis (up to 20)
            sample_tweets = tweets[:20]
            tweet_texts = [tweet['text'] for tweet in sample_tweets]
            
            analysis_prompt = f"""
            Analyze the content style and patterns of Twitter user @{twitter_handle} based on their recent tweets.
            
            Recent Tweets:
            {chr(10).join([f"{i+1}. {text}" for i, text in enumerate(tweet_texts)])}
            
            Provide analysis in JSON format:
            {{
                "writing_style": {{
                    "tone": "<casual/professional/humorous/technical>",
                    "personality_traits": ["trait1", "trait2"],
                    "communication_approach": "<direct/storytelling/analytical>"
                }},
                "content_patterns": {{
                    "main_topics": ["topic1", "topic2"],
                    "hashtag_usage": "<frequent/moderate/rare>",
                    "emoji_usage": "<heavy/moderate/minimal>",
                    "thread_tendency": "<high/medium/low>"
                }},
                "engagement_style": {{
                    "interaction_frequency": "<high/medium/low>",
                    "question_asking": "<frequent/occasional/rare>",
                    "call_to_action_usage": "<frequent/occasional/rare>"
                }},
                "crypto_web3_focus": {{
                    "expertise_level": "<expert/intermediate/beginner>",
                    "focus_areas": ["defi", "nft", "trading", "technology"],
                    "technical_depth": "<deep/moderate/surface>"
                }},
                "predicted_performance_factors": {{
                    "strengths": ["strength1", "strength2"],
                    "improvement_areas": ["area1", "area2"],
                    "viral_potential": <score_out_of_10>,
                    "authenticity_score": <score_out_of_10>
                }}
            }}
            """
            
            analysis = await self.llm_service.analyze_text_content(analysis_prompt, provider="anthropic")
            
            try:
                return json.loads(self._clean_json_response(analysis))
            except json.JSONDecodeError:
                return {'analysis': analysis, 'parsed': False}
                
        except Exception as e:
            logger.error(f"Error analyzing content style for @{twitter_handle}: {str(e)}")
            return {'error': str(e)}
            
    def _calculate_engagement_metrics(self, tweets: List[Dict], user_metrics: Dict) -> Dict[str, Any]:
        """Calculate engagement metrics from tweets"""
        if not tweets:
            return {
                'avg_engagement_rate': 0,
                'avg_likes': 0,
                'avg_retweets': 0,
                'avg_replies': 0,
                'posting_frequency': 0,
                'content_consistency': 0,
                'optimal_times': []
            }
            
        # Calculate averages
        total_likes = sum(tweet['metrics']['like_count'] for tweet in tweets)
        total_retweets = sum(tweet['metrics']['retweet_count'] for tweet in tweets)
        total_replies = sum(tweet['metrics']['reply_count'] for tweet in tweets)
        total_engagement = total_likes + total_retweets + total_replies
        
        avg_likes = total_likes / len(tweets)
        avg_retweets = total_retweets / len(tweets)
        avg_replies = total_replies / len(tweets)
        
        # Engagement rate = (total engagement / tweets) / followers * 100
        followers = max(user_metrics.get('followers_count', 1), 1)  # Avoid division by zero
        avg_engagement_rate = (total_engagement / len(tweets)) / followers * 100
        
        # Analyze posting times
        posting_hours = [tweet['created_at'].hour for tweet in tweets]
        optimal_times = self._find_optimal_posting_times(tweets)
        
        # Calculate posting frequency (tweets per day)
        if tweets:
            time_span = (tweets[0]['created_at'] - tweets[-1]['created_at']).days
            posting_frequency = len(tweets) / max(time_span, 1)
        else:
            posting_frequency = 0
            
        # Content consistency (variance in engagement)
        if len(tweets) > 1:
            engagements = [tweet['metrics']['like_count'] + tweet['metrics']['retweet_count'] 
                          for tweet in tweets]
            avg_engagement = sum(engagements) / len(engagements)
            variance = sum((e - avg_engagement) ** 2 for e in engagements) / len(engagements)
            content_consistency = max(0, 10 - (variance / avg_engagement if avg_engagement > 0 else 10))
        else:
            content_consistency = 5
            
        return {
            'avg_engagement_rate': round(avg_engagement_rate, 4),
            'avg_likes': round(avg_likes, 2),
            'avg_retweets': round(avg_retweets, 2),
            'avg_replies': round(avg_replies, 2),
            'posting_frequency': round(posting_frequency, 2),
            'content_consistency': round(content_consistency, 2),
            'optimal_times': optimal_times
        }
        
    def _find_optimal_posting_times(self, tweets: List[Dict]) -> List[Dict]:
        """Find optimal posting times based on engagement"""
        if not tweets:
            return []
            
        # Group by hour and calculate average engagement
        hour_engagement = {}
        for tweet in tweets:
            hour = tweet['created_at'].hour
            engagement = (tweet['metrics']['like_count'] + 
                         tweet['metrics']['retweet_count'] + 
                         tweet['metrics']['reply_count'])
            
            if hour not in hour_engagement:
                hour_engagement[hour] = []
            hour_engagement[hour].append(engagement)
            
        # Calculate average engagement per hour
        optimal_times = []
        for hour, engagements in hour_engagement.items():
            avg_engagement = sum(engagements) / len(engagements)
            optimal_times.append({
                'hour': hour,
                'avg_engagement': round(avg_engagement, 2),
                'sample_size': len(engagements)
            })
            
        # Sort by engagement
        optimal_times.sort(key=lambda x: x['avg_engagement'], reverse=True)
        
        return optimal_times[:5]  # Top 5 optimal times
        
    async def _assess_yapper_experience(self, yapper_id: int, twitter_handle: str, 
                                      user_data: Any, tweets: List[Dict], 
                                      engagement_metrics: Dict) -> Dict[str, Any]:
        """
        Assess yapper experience level and provide guidance for predictions
        
        This is crucial for handling novice vs experienced yappers
        """
        try:
            # Check if yapper exists in leaderboard data
            leaderboard_data = await self._check_leaderboard_presence(twitter_handle)
            
            # Calculate experience factors
            account_age_days = (datetime.utcnow() - user_data.created_at.replace(tzinfo=None)).days
            followers_count = user_data.public_metrics['followers_count']
            tweet_count = user_data.public_metrics['tweet_count']
            avg_engagement = engagement_metrics['avg_engagement_rate']
            
            # Experience scoring
            experience_score = 0
            
            # Factor 1: Account age (0-3 points)
            if account_age_days > 365 * 2:  # 2+ years
                experience_score += 3
            elif account_age_days > 365:  # 1+ year
                experience_score += 2
            elif account_age_days > 180:  # 6+ months
                experience_score += 1
                
            # Factor 2: Followers (0-3 points)
            if followers_count > 10000:
                experience_score += 3
            elif followers_count > 1000:
                experience_score += 2
            elif followers_count > 100:
                experience_score += 1
                
            # Factor 3: Tweet activity (0-2 points)
            if tweet_count > 1000:
                experience_score += 2
            elif tweet_count > 100:
                experience_score += 1
                
            # Factor 4: Engagement rate (0-2 points)
            if avg_engagement > 5:
                experience_score += 2
            elif avg_engagement > 1:
                experience_score += 1
                
            # Factor 5: Leaderboard presence (0-5 points - most important)
            leaderboard_bonus = 0
            if leaderboard_data['present']:
                leaderboard_bonus = 5
                if leaderboard_data['avg_position'] <= 10:
                    leaderboard_bonus += 2  # Top 10 performer
                experience_score += leaderboard_bonus
                
            # Determine experience level
            if experience_score >= 12:
                level = "expert"
                confidence = "high"
            elif experience_score >= 8:
                level = "intermediate"
                confidence = "medium"
            elif experience_score >= 4:
                level = "beginner"
                confidence = "medium"
            else:
                level = "novice"
                confidence = "low"
                
            # Provide prediction strategy
            prediction_strategy = self._get_prediction_strategy(level, leaderboard_data, experience_score)
            
            return {
                'level': level,
                'score': experience_score,
                'confidence': confidence,
                'factors': {
                    'account_age_days': account_age_days,
                    'followers_count': followers_count,
                    'tweet_count': tweet_count,
                    'avg_engagement_rate': avg_engagement,
                    'leaderboard_present': leaderboard_data['present'],
                    'leaderboard_bonus': leaderboard_bonus
                },
                'leaderboard_data': leaderboard_data,
                'prediction_strategy': prediction_strategy
            }
            
        except Exception as e:
            logger.error(f"Error assessing yapper experience: {str(e)}")
            return {
                'level': 'unknown',
                'score': 0,
                'confidence': 'low',
                'error': str(e),
                'prediction_strategy': self._get_prediction_strategy('novice', {'present': False}, 0)
            }
            
    async def _check_leaderboard_presence(self, twitter_handle: str) -> Dict[str, Any]:
        """Check if yapper is present in leaderboard data"""
        try:
            response = requests.get(
                f"{settings.TYPESCRIPT_BACKEND_URL}/api/leaderboard-yapper/check-presence",
                params={'twitter_handle': twitter_handle},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                return {
                    'present': data.get('present', False),
                    'platforms': data.get('platforms', []),
                    'avg_position': data.get('avg_position'),
                    'best_position': data.get('best_position'),
                    'total_campaigns': data.get('total_campaigns', 0),
                    'total_snap': data.get('total_snap', 0)
                }
            else:
                return {'present': False, 'platforms': [], 'total_campaigns': 0}
                
        except Exception as e:
            logger.error(f"Error checking leaderboard presence: {str(e)}")
            return {'present': False, 'platforms': [], 'total_campaigns': 0}
            
    def _get_prediction_strategy(self, level: str, leaderboard_data: Dict, score: int) -> Dict[str, Any]:
        """
        Get prediction strategy based on yapper experience level
        
        This is the key method for handling novice vs experienced yappers
        """
        
        if level in ['expert', 'intermediate'] and leaderboard_data.get('present'):
            # Experienced yapper with leaderboard data
            return {
                'approach': 'data_driven',
                'confidence_multiplier': 1.0,
                'feature_sources': [
                    'historical_leaderboard_performance',
                    'twitter_content_analysis',
                    'engagement_patterns',
                    'success_pattern_matching'
                ],
                'prediction_method': 'ml_model_with_historical_data',
                'fallback_strategy': 'platform_averages_with_personal_adjustment',
                'explanation': 'Use full ML model with historical performance data'
            }
            
        elif level == 'beginner' and leaderboard_data.get('present'):
            # Some leaderboard presence but limited
            return {
                'approach': 'hybrid',
                'confidence_multiplier': 0.8,
                'feature_sources': [
                    'limited_leaderboard_data',
                    'twitter_content_analysis',
                    'engagement_patterns',
                    'similar_yapper_patterns'
                ],
                'prediction_method': 'ml_model_with_imputation',
                'fallback_strategy': 'content_based_prediction',
                'explanation': 'Use ML model with data imputation and content analysis'
            }
            
        elif level in ['novice', 'beginner']:
            # No or minimal leaderboard data - content-based prediction
            return {
                'approach': 'content_based',
                'confidence_multiplier': 0.6,
                'feature_sources': [
                    'twitter_content_analysis',
                    'engagement_patterns',
                    'similar_profile_benchmarking',
                    'platform_baseline_metrics'
                ],
                'prediction_method': 'content_similarity_matching',
                'fallback_strategy': 'platform_baseline_with_adjustments',
                'explanation': 'Use content analysis and similar profile matching'
            }
            
        else:
            # Unknown or error case
            return {
                'approach': 'conservative_baseline',
                'confidence_multiplier': 0.4,
                'feature_sources': [
                    'platform_baseline_metrics',
                    'basic_twitter_metrics'
                ],
                'prediction_method': 'platform_averages',
                'fallback_strategy': 'minimum_viable_prediction',
                'explanation': 'Use conservative platform baseline predictions'
            }
            
    async def _store_yapper_profile(self, profile_data: Dict) -> bool:
        """Store yapper profile data in database"""
        try:
            response = requests.post(
                f"{settings.TYPESCRIPT_BACKEND_URL}/api/intelligence/update-platform-yapper-profile",
                json=profile_data,
                timeout=30
            )
            
            return response.status_code == 200
            
        except Exception as e:
            logger.error(f"Error storing yapper profile: {str(e)}")
            return False
            
    async def _store_yapper_tweet(self, yapper_id: int, twitter_handle: str, tweet: Dict) -> bool:
        """Store individual yapper tweet data"""
        try:
            # Analyze tweet content with Anthropic
            content_analysis = None
            if tweet.get('text'):
                analysis_prompt = f"""
                Analyze this tweet for content quality and potential platform success.
                
                Tweet: "{tweet['text']}"
                
                Provide analysis in JSON format:
                {{
                    "content_quality": <score_out_of_10>,
                    "viral_potential": <score_out_of_10>,
                    "engagement_prediction": <score_out_of_10>,
                    "category": "<gaming/defi/nft/meme/education/other>",
                    "sentiment": "<positive/neutral/negative>",
                    "key_elements": ["element1", "element2"]
                }}
                """
                
                try:
                    analysis_result = await self.llm_service.analyze_text_content(analysis_prompt, provider="anthropic")
                    if isinstance(analysis_result, dict) and analysis_result.get('success'):
                        analysis_text = analysis_result.get('content', '')
                    else:
                        analysis_text = analysis_result if isinstance(analysis_result, str) else ''
                    
                    content_analysis = json.loads(self._clean_json_response(analysis_text))
                except:
                    content_analysis = None
                    
            tweet_data = {
                'yapper_id': yapper_id,
                'twitter_handle': twitter_handle,
                'tweet_id': tweet['id'],
                'tweet_text': tweet['text'],
                'tweet_images': tweet.get('images', []),
                'is_thread': tweet.get('is_thread', False),
                'thread_position': None,  # Would need conversation analysis
                'parent_tweet_id': tweet['conversation_id'] if tweet.get('is_thread') else None,
                'engagement_metrics': tweet['metrics'],
                'posted_at': tweet['created_at'],
                'content_category': content_analysis.get('category') if content_analysis else None,
                'anthropic_analysis': content_analysis
            }
            
            response = requests.post(
                f"{settings.TYPESCRIPT_BACKEND_URL}/api/intelligence/store-platform-yapper-data",
                json=tweet_data,
                timeout=30
            )
            
            return response.status_code == 200
            
        except Exception as e:
            logger.error(f"Error storing yapper tweet: {str(e)}")
            return False
            
    def _clean_json_response(self, response: str) -> str:
        """Clean LLM response to extract JSON"""
        # Remove markdown code blocks
        response = response.replace('```json', '').replace('```', '')
        
        # Find JSON object
        start = response.find('{')
        end = response.rfind('}') + 1
        
        if start != -1 and end != 0:
            return response[start:end]
        
        return response.strip()
        
    async def get_yapper_prediction_features(self, yapper_id: int, content_text: str, 
                                           campaign_context: Dict) -> Dict[str, Any]:
        """
        Get comprehensive features for yapper prediction including handling of novice yappers
        
        This is the main method called by ML models for getting features
        """
        try:
            logger.info(f"🎯 Getting prediction features for yapper {yapper_id}")
            
            # Get yapper profile data
            profile_response = requests.get(
                f"{settings.TYPESCRIPT_BACKEND_URL}/api/intelligence/yapper-profile/{yapper_id}",
                timeout=10
            )
            
            if profile_response.status_code == 200:
                profile_data = profile_response.json()
            else:
                # Yapper profile not found - need to collect it first
                logger.warning(f"⚠️ Yapper {yapper_id} profile not found, using defaults")
                profile_data = self._get_default_profile_features()
                
            # Analyze the content they want to post
            content_features = await self._analyze_content_for_prediction(content_text, campaign_context)
            
            # Get experience-based features
            experience_level = profile_data.get('experience_level', {})
            prediction_strategy = experience_level.get('prediction_strategy', {})
            
            # Build comprehensive feature set
            features = {
                # Content features (from Anthropic analysis)
                'quality_score': content_features.get('quality_score', 5.0),
                'viral_potential': content_features.get('viral_potential', 5.0),
                'category_relevance': content_features.get('category_relevance', 5.0),
                'content_length': len(content_text),
                'hashtag_count': content_text.count('#'),
                'predicted_engagement': content_features.get('predicted_engagement', 100),
                
                # Yapper profile features
                'historical_performance': self._get_historical_performance(profile_data, prediction_strategy),
                'followers_count': profile_data.get('followers_count', 100),
                'engagement_rate': profile_data.get('engagement_rate', 1.0),
                'experience_score': experience_level.get('score', 0),
                'account_age_days': experience_level.get('factors', {}).get('account_age_days', 30),
                
                # Campaign features
                'reward_pool': campaign_context.get('reward_pool', 10000),
                'competition_level': campaign_context.get('competition_level', 50),
                'campaign_category': campaign_context.get('category', 'other'),
                
                # Timing features
                'hour_of_day': datetime.now().hour,
                'day_of_week': datetime.now().weekday(),
                
                # Experience-based adjustments
                'confidence_multiplier': prediction_strategy.get('confidence_multiplier', 0.5),
                'prediction_approach': prediction_strategy.get('approach', 'content_based'),
                'has_leaderboard_data': experience_level.get('leaderboard_data', {}).get('present', False)
            }
            
            return {
                'success': True,
                'features': features,
                'prediction_strategy': prediction_strategy,
                'experience_level': experience_level.get('level', 'novice')
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting yapper prediction features: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'features': self._get_fallback_features(content_text, campaign_context)
            }
            
    def _get_historical_performance(self, profile_data: Dict, prediction_strategy: Dict) -> float:
        """
        Get historical performance metric with proper handling for novice yappers
        """
        approach = prediction_strategy.get('approach', 'content_based')
        
        if approach == 'data_driven':
            # Use actual leaderboard performance
            leaderboard_data = profile_data.get('experience_level', {}).get('leaderboard_data', {})
            avg_position = leaderboard_data.get('avg_position', 50)
            return max(0, 100 - avg_position)  # Convert position to score (lower position = higher score)
            
        elif approach == 'hybrid':
            # Mix of limited data and content analysis
            performance_patterns = profile_data.get('performance_patterns', {})
            content_score = profile_data.get('content_style_analysis', {}).get('predicted_performance_factors', {}).get('viral_potential', 5)
            return (performance_patterns.get('avg_likes', 10) / 100) + (content_score * 5)
            
        elif approach == 'content_based':
            # Use content analysis as proxy
            content_analysis = profile_data.get('content_style_analysis', {})
            predicted_factors = content_analysis.get('predicted_performance_factors', {})
            return predicted_factors.get('viral_potential', 5) * 10  # Scale to 0-100
            
        else:
            # Conservative baseline
            return 25.0  # Platform average
            
    async def _analyze_content_for_prediction(self, content_text: str, campaign_context: Dict) -> Dict[str, Any]:
        """Analyze content for prediction features"""
        try:
            analysis_prompt = f"""
            Analyze this content for {campaign_context.get('platform', 'attention economy')} platform success prediction.
            
            Content: "{content_text}"
            Campaign Category: {campaign_context.get('category', 'general')}
            Platform: {campaign_context.get('platform', 'cookie.fun')}
            
            Provide analysis in JSON format:
            {{
                "quality_score": <score_out_of_10>,
                "viral_potential": <score_out_of_10>,
                "category_relevance": <score_out_of_10>,
                "predicted_engagement": <estimated_likes_retweets>,
                "platform_fit": <score_out_of_10>,
                "reasoning": "<explanation>"
            }}
            """
            
            analysis = await self.llm_service.analyze_text_content(analysis_prompt, provider="anthropic")
            return json.loads(self._clean_json_response(analysis))
            
        except Exception as e:
            logger.error(f"Error analyzing content: {str(e)}")
            return {
                'quality_score': 5.0,
                'viral_potential': 5.0,
                'category_relevance': 5.0,
                'predicted_engagement': 100,
                'platform_fit': 5.0
            }
            
    def _get_default_profile_features(self) -> Dict[str, Any]:
        """Get default features for unknown yappers"""
        return {
            'followers_count': 100,
            'engagement_rate': 1.0,
            'experience_level': {
                'level': 'novice',
                'score': 0,
                'confidence': 'low',
                'prediction_strategy': self._get_prediction_strategy('novice', {'present': False}, 0)
            }
        }
        
    def _get_fallback_features(self, content_text: str, campaign_context: Dict) -> Dict[str, Any]:
        """Get fallback features when everything fails"""
        return {
            'quality_score': 5.0,
            'viral_potential': 5.0,
            'category_relevance': 5.0,
            'content_length': len(content_text),
            'hashtag_count': content_text.count('#'),
            'predicted_engagement': 100,
            'historical_performance': 25.0,
            'followers_count': 100,
            'engagement_rate': 1.0,
            'experience_score': 0,
            'account_age_days': 30,
            'reward_pool': campaign_context.get('reward_pool', 10000),
            'competition_level': 50,
            'hour_of_day': datetime.now().hour,
            'day_of_week': datetime.now().weekday(),
            'confidence_multiplier': 0.4,
            'prediction_approach': 'conservative_baseline',
            'has_leaderboard_data': False
        }
