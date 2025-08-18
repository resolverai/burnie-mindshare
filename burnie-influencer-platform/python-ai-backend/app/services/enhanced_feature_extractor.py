"""
Enhanced Feature Extractor for ML Models

Extracts comprehensive features from all available database columns,
converting string/JSON data to numerical features using LLM analysis.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import asyncpg
import numpy as np
from textblob import TextBlob

from app.config.settings import settings
from app.services.llm_providers import MultiProviderLLMService

logger = logging.getLogger(__name__)

class EnhancedFeatureExtractor:
    """
    Advanced feature extraction using all available database columns
    """
    
    def __init__(self):
        self.llm_service = MultiProviderLLMService(
            primary_provider=settings.default_llm_provider or 'anthropic',
            fallback_provider=settings.fallback_llm_provider or 'openai'
        )
        
    async def extract_comprehensive_features(
        self, 
        yapper_id: Optional[int] = None,
        twitter_handle: Optional[str] = None,
        content_text: str = "",
        campaign_context: Dict[str, Any] = None,
        platform: str = "cookie.fun"
    ) -> Dict[str, Any]:
        """
        Extract comprehensive features from all available data sources
        
        Returns:
            Dictionary with categorized features ready for ML models
        """
        try:
            logger.info(f"🎯 Extracting comprehensive features for {twitter_handle or yapper_id}")
            
            # Initialize feature categories
            features = {
                'content_features': {},
                'yapper_profile_features': {},
                'historical_performance_features': {},
                'engagement_pattern_features': {},
                'network_features': {},
                'temporal_features': {},
                'campaign_context_features': {},
                'sentiment_features': {},
                'metadata_features': {}
            }
            
            # Extract content features from text
            if content_text:
                features['content_features'] = await self._extract_content_features(content_text)
            
            # Extract yapper-specific features
            if yapper_id or twitter_handle:
                yapper_features = await self._extract_yapper_features(yapper_id, twitter_handle, platform)
                features.update(yapper_features)
            
            # Extract campaign context features
            if campaign_context:
                features['campaign_context_features'] = await self._extract_campaign_features(campaign_context)
            
            # Extract temporal features
            features['temporal_features'] = self._extract_temporal_features()
            
            # Flatten features for ML model consumption
            flattened_features = self._flatten_features(features)
            
            return {
                'success': True,
                'features': flattened_features,
                'feature_categories': features,
                'feature_count': len(flattened_features),
                'extraction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Feature extraction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _extract_content_features(self, content_text: str) -> Dict[str, float]:
        """Extract advanced content features using LLM analysis"""
        try:
            # Ensure content_text is a string
            if not isinstance(content_text, str):
                logger.warning(f"⚠️ content_text is not a string: {type(content_text)}, converting...")
                content_text = str(content_text) if content_text else ""
            
            # Basic text features
            blob = TextBlob(content_text)
            basic_features = {
                'char_length': float(len(content_text)),
                'word_count': float(len(blob.words)),
                'sentence_count': float(len(blob.sentences)),
                'avg_word_length': float(np.mean([len(word) for word in blob.words]) if blob.words else 0),
                'sentiment_polarity': float(blob.sentiment.polarity),
                'sentiment_subjectivity': float(blob.sentiment.subjectivity),
            }
            
            # Advanced content analysis using LLM
            llm_analysis = await self._analyze_content_with_llm(content_text)
            
            # Crypto/Web3 specific features
            crypto_features = self._extract_crypto_features(content_text)
            
            # Engagement prediction features
            engagement_features = self._extract_engagement_signals(content_text)
            
            return {
                **basic_features,
                **llm_analysis,
                **crypto_features,
                **engagement_features
            }
            
        except Exception as e:
            logger.error(f"❌ Content feature extraction failed: {str(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            logger.error(f"Content text type: {type(content_text)}")
            logger.error(f"Content text value: {content_text}")
            return {}
    
    async def _analyze_content_with_llm(self, content_text: str) -> Dict[str, float]:
        """Use LLM to analyze content and convert to numerical features"""
        try:
            # Ensure content_text is a string
            if not isinstance(content_text, str):
                logger.warning(f"⚠️ content_text is not a string: {type(content_text)}, converting...")
                content_text = str(content_text) if content_text else ""
            
            # Skip LLM analysis for very short content
            if len(content_text.strip()) < 10:
                logger.info("⚠️ Content too short for LLM analysis, using defaults")
                return {
                    'llm_content_quality': 5.0,
                    'llm_viral_potential': 3.0,
                    'llm_engagement_potential': 4.0
                }
            
            analysis_prompt = f"""
            Analyze this content and provide numerical scores (0-10) for each metric:
            
            Content: "{content_text[:500]}"
            
            Return JSON with these numerical scores:
            {{
                "content_quality": <0-10>,
                "viral_potential": <0-10>,
                "engagement_potential": <0-10>,
                "originality": <0-10>,
                "clarity": <0-10>,
                "emotional_impact": <0-10>,
                "call_to_action_strength": <0-10>,
                "trending_relevance": <0-10>,
                "technical_depth": <0-10>,
                "humor_level": <0-10>,
                "controversy_level": <0-10>,
                "educational_value": <0-10>
            }}
            """
            
            result = await self.llm_service.analyze_text_content(analysis_prompt)
            
            # Enhanced error handling and type checking
            if not isinstance(result, dict):
                logger.warning(f"⚠️ LLM service returned non-dict result: {type(result)}")
                if isinstance(result, str):
                    # Try to parse as JSON directly
                    try:
                        scores = json.loads(self._clean_json_response(result))
                        return {f"llm_{key}": float(value) for key, value in scores.items() if isinstance(value, (int, float))}
                    except:
                        pass
                return {}
            
            if result.get('success'):
                analysis_text = result.get('content', '{}')
                
                # Ensure analysis_text is a string
                if not isinstance(analysis_text, str):
                    if isinstance(analysis_text, dict):
                        # If it's already a parsed dict, convert it back to JSON string for parsing
                        analysis_text = json.dumps(analysis_text)
                    else:
                        analysis_text = str(analysis_text) if analysis_text else '{}'
                        
            else:
                logger.warning(f"⚠️ LLM analysis failed: {result.get('error', 'Unknown error')}")
                return {}
            
            if not analysis_text or analysis_text.strip() == '':
                logger.warning("⚠️ Empty LLM analysis response")
                return {}
            
            # Parse JSON response
            try:
                scores = json.loads(self._clean_json_response(analysis_text))
                if not isinstance(scores, dict):
                    logger.warning(f"⚠️ LLM response is not a dict: {type(scores)}")
                    return {}
                
                result_scores = {}
                for key, value in scores.items():
                    if isinstance(value, (int, float)):
                        # Clamp values to 0-10 range
                        clamped_value = max(0.0, min(10.0, float(value)))
                        result_scores[f"llm_{key}"] = clamped_value
                    else:
                        logger.warning(f"⚠️ Non-numeric value for {key}: {value}")
                
                return result_scores
                
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Could not parse LLM JSON response: {e}")
                logger.debug(f"Raw response: {analysis_text[:200]}...")
                return {}
                
        except Exception as e:
            logger.error(f"❌ LLM content analysis failed: {str(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            logger.error(f"Content text type: {type(content_text)}")
            logger.error(f"Content text value: {content_text}")
            return {}
    
    def _extract_crypto_features(self, content_text: str) -> Dict[str, float]:
        """Extract cryptocurrency and Web3 specific features"""
        # Ensure content_text is a string
        if not isinstance(content_text, str):
            content_text = str(content_text) if content_text else ""
        
        content_lower = content_text.lower()
        
        # Crypto keyword categories
        crypto_keywords = ['bitcoin', 'ethereum', 'crypto', 'blockchain', 'defi', 'nft', 'web3']
        trading_keywords = ['bull', 'bear', 'pump', 'dump', 'moon', 'hodl', 'diamond', 'hands']
        technical_keywords = ['mining', 'staking', 'yield', 'dao', 'dapp', 'smart contract']
        sentiment_keywords = ['bullish', 'bearish', 'optimistic', 'pessimistic', 'fud', 'fomo']
        
        return {
            'crypto_keyword_count': float(sum(1 for kw in crypto_keywords if kw in content_lower)),
            'trading_keyword_count': float(sum(1 for kw in trading_keywords if kw in content_lower)),
            'technical_keyword_count': float(sum(1 for kw in technical_keywords if kw in content_lower)),
            'sentiment_keyword_count': float(sum(1 for kw in sentiment_keywords if kw in content_lower)),
            'crypto_keyword_density': float(sum(1 for kw in crypto_keywords if kw in content_lower) / len(content_text.split()) if content_text else 0),
            'hashtag_count': float(len(re.findall(r'#\w+', content_text))),
            'mention_count': float(len(re.findall(r'@\w+', content_text))),
            'url_count': float(len(re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', content_text)))
        }
    
    def _extract_engagement_signals(self, content_text: str) -> Dict[str, float]:
        """Extract signals that predict engagement"""
        # Ensure content_text is a string
        if not isinstance(content_text, str):
            content_text = str(content_text) if content_text else ""
        
        return {
            'question_count': float(content_text.count('?')),
            'exclamation_count': float(content_text.count('!')),
            'uppercase_ratio': float(sum(1 for c in content_text if c.isupper()) / len(content_text) if content_text else 0),
            'emoji_count': float(len(re.findall(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]', content_text))),
            'line_break_count': float(content_text.count('\n')),
            'caps_lock_words': float(len([word for word in content_text.split() if word.isupper() and len(word) > 2]))
        }
    
    async def _extract_yapper_features(
        self, 
        yapper_id: Optional[int], 
        twitter_handle: Optional[str], 
        platform: str
    ) -> Dict[str, Dict[str, float]]:
        """Extract comprehensive yapper features from all database tables"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            features = {
                'yapper_profile_features': {},
                'historical_performance_features': {},
                'engagement_pattern_features': {},
                'network_features': {},
                'sentiment_features': {}
            }
            
            # Extract from leaderboard_yapper_data
            leaderboard_features = await self._extract_leaderboard_features(conn, twitter_handle, platform)
            features['historical_performance_features'].update(leaderboard_features)
            
            # Extract from yapper_cookie_profile
            profile_features = await self._extract_profile_features(conn, twitter_handle)
            features['yapper_profile_features'].update(profile_features)
            
            # Extract from platform_yapper_twitter_profiles
            twitter_features = await self._extract_twitter_profile_features(conn, yapper_id, twitter_handle)
            features['yapper_profile_features'].update(twitter_features)
            
            # Extract engagement patterns from platform_yapper_twitter_data
            engagement_features = await self._extract_engagement_features(conn, yapper_id, twitter_handle)
            features['engagement_pattern_features'].update(engagement_features)
            
            await conn.close()
            return features
            
        except Exception as e:
            logger.error(f"❌ Yapper feature extraction failed: {str(e)}")
            return {
                'yapper_profile_features': {},
                'historical_performance_features': {},
                'engagement_pattern_features': {},
                'network_features': {},
                'sentiment_features': {}
            }
    
    async def _extract_leaderboard_features(
        self, 
        conn: asyncpg.Connection, 
        twitter_handle: Optional[str], 
        platform: str
    ) -> Dict[str, float]:
        """Extract features from leaderboard_yapper_data table"""
        if not twitter_handle:
            return {}
        
        try:
            # Get recent leaderboard performance
            query = """
            SELECT 
                "leaderboardPosition",
                "totalSnaps",
                "snaps24h", 
                "smartFollowers",
                "leaderboardData",
                "anthropic_analysis",
                "openai_analysis",
                "recentTweets",
                "tweetImageUrls",
                "followersCount",
                "followingCount",
                "tweetsCount"
            FROM leaderboard_yapper_data 
            WHERE "twitterHandle" = $1 
                AND "platformSource" = $2
                AND "twitterFetchStatus" = 'completed'
            ORDER BY "snapshotDate" DESC 
            LIMIT 5
            """
            
            records = await conn.fetch(query, twitter_handle, platform)
            
            if not records:
                return {}
            
            # Calculate aggregated features
            positions = [r['leaderboardPosition'] for r in records if r['leaderboardPosition']]
            snaps = [float(r['totalSnaps']) for r in records if r['totalSnaps']]
            snaps_24h = [float(r['snaps24h']) for r in records if r['snaps24h']]
            
            features = {
                'avg_leaderboard_position': float(np.mean(positions) if positions else 100),
                'best_leaderboard_position': float(min(positions) if positions else 100),
                'position_volatility': float(np.std(positions) if len(positions) > 1 else 0),
                'avg_total_snaps': float(np.mean(snaps) if snaps else 0),
                'avg_snaps_24h': float(np.mean(snaps_24h) if snaps_24h else 0),
                'snap_growth_rate': float((snaps[-1] - snaps[0]) / snaps[0] if len(snaps) > 1 and snaps[0] > 0 else 0),
                'leaderboard_consistency': float(len([p for p in positions if p <= 50]) / len(positions) if positions else 0)
            }
            
            # Extract features from LLM analysis
            latest_record = records[0]
            if latest_record['anthropic_analysis'] or latest_record['openai_analysis']:
                llm_features = await self._extract_llm_analysis_features(
                    latest_record['anthropic_analysis'] or latest_record['openai_analysis']
                )
                features.update(llm_features)
            
            # Extract tweet-based features
            if latest_record['recentTweets']:
                tweet_features = self._extract_tweet_features(latest_record['recentTweets'])
                features.update(tweet_features)
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Leaderboard feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_profile_features(
        self, 
        conn: asyncpg.Connection, 
        twitter_handle: Optional[str]
    ) -> Dict[str, float]:
        """Extract features from yapper_cookie_profile table"""
        if not twitter_handle:
            return {}
        
        try:
            query = """
            SELECT 
                "mindsharePercent",
                "totalSnaps7d",
                "totalSnaps30d", 
                "smartFollowers7d",
                "smartEngagement",
                "mindshareHistory",
                "smartFollowersTrend",
                "badgeTypes",
                "tokenSentiments",
                "engagementPatterns",
                "networkCentrality",
                "influenceScore"
            FROM yapper_cookie_profile 
            WHERE "twitterHandle" = $1 
            ORDER BY "snapshotDate" DESC 
            LIMIT 1
            """
            
            record = await conn.fetchrow(query, twitter_handle)
            
            if not record:
                return {}
            
            features = {}
            
            # Basic numerical features
            numerical_fields = [
                'mindsharePercent', 'totalSnaps7d', 'totalSnaps30d', 
                'smartFollowers7d', 'smartEngagement', 'networkCentrality', 'influenceScore'
            ]
            
            for field in numerical_fields:
                value = record[field]
                if value is not None:
                    features[f"profile_{field.lower()}"] = float(value)
            
            # Extract features from JSON fields
            if record['engagementPatterns']:
                engagement_features = await self._extract_json_features(
                    record['engagementPatterns'], 'engagement'
                )
                features.update(engagement_features)
            
            if record['tokenSentiments']:
                sentiment_features = self._extract_sentiment_features(record['tokenSentiments'])
                features.update(sentiment_features)
            
            if record['badgeTypes']:
                badge_features = self._extract_badge_features(record['badgeTypes'])
                features.update(badge_features)
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Profile feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_twitter_profile_features(
        self, 
        conn: asyncpg.Connection, 
        yapper_id: Optional[int], 
        twitter_handle: Optional[str]
    ) -> Dict[str, float]:
        """Extract features from platform_yapper_twitter_profiles table"""
        try:
            if yapper_id:
                query = """
                SELECT * FROM platform_yapper_twitter_profiles 
                WHERE yapper_id = $1 
                LIMIT 1
                """
                record = await conn.fetchrow(query, yapper_id)
            elif twitter_handle:
                query = """
                SELECT * FROM platform_yapper_twitter_profiles 
                WHERE twitter_handle = $1 
                LIMIT 1
                """
                record = await conn.fetchrow(query, twitter_handle)
            else:
                return {}
            
            if not record:
                return {}
            
            # Account age feature
            account_age_days = 0
            if record['account_created_at']:
                account_age_days = (datetime.now() - record['account_created_at']).days
            
            features = {
                'twitter_followers_count': float(record['followers_count'] or 0),
                'twitter_following_count': float(record['following_count'] or 0),
                'twitter_tweet_count': float(record['tweet_count'] or 0),
                'twitter_verified': float(1 if record['verified'] else 0),
                'twitter_engagement_rate': float(record['engagement_rate'] or 0),
                'account_age_days': float(account_age_days),
                'follower_following_ratio': float(
                    record['followers_count'] / record['following_count'] 
                    if record['following_count'] and record['following_count'] > 0 else 0
                )
            }
            
            # Extract features from JSON fields
            if record['content_style_analysis']:
                style_features = await self._extract_json_features(
                    record['content_style_analysis'], 'style'
                )
                features.update(style_features)
            
            if record['performance_patterns']:
                performance_features = await self._extract_json_features(
                    record['performance_patterns'], 'performance'
                )
                features.update(performance_features)
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Twitter profile feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_engagement_features(
        self, 
        conn: asyncpg.Connection, 
        yapper_id: Optional[int], 
        twitter_handle: Optional[str]
    ) -> Dict[str, float]:
        """Extract engagement features from platform_yapper_twitter_data table"""
        try:
            if yapper_id:
                query = """
                SELECT 
                    engagement_metrics,
                    anthropic_analysis,
                    posted_at,
                    is_thread,
                    content_category
                FROM platform_yapper_twitter_data 
                WHERE yapper_id = $1 
                ORDER BY posted_at DESC 
                LIMIT 50
                """
                records = await conn.fetch(query, yapper_id)
            elif twitter_handle:
                query = """
                SELECT 
                    engagement_metrics,
                    anthropic_analysis,
                    posted_at,
                    is_thread,
                    content_category
                FROM platform_yapper_twitter_data 
                WHERE twitter_handle = $1 
                ORDER BY posted_at DESC 
                LIMIT 50
                """
                records = await conn.fetch(query, twitter_handle)
            else:
                return {}
            
            if not records:
                return {}
            
            # Calculate engagement statistics
            engagement_data = []
            categories = []
            thread_count = 0
            
            for record in records:
                if record['engagement_metrics']:
                    metrics = record['engagement_metrics']
                    total_engagement = (metrics.get('likes', 0) + 
                                      metrics.get('retweets', 0) + 
                                      metrics.get('replies', 0))
                    engagement_data.append(total_engagement)
                
                if record['content_category']:
                    categories.append(record['content_category'])
                
                if record['is_thread']:
                    thread_count += 1
            
            features = {}
            
            if engagement_data:
                features.update({
                    'avg_engagement': float(np.mean(engagement_data)),
                    'max_engagement': float(np.max(engagement_data)),
                    'engagement_volatility': float(np.std(engagement_data)),
                    'high_engagement_rate': float(len([e for e in engagement_data if e > np.mean(engagement_data) * 2]) / len(engagement_data))
                })
            
            # Category distribution features
            if categories:
                category_counts = {}
                for cat in categories:
                    category_counts[cat] = category_counts.get(cat, 0) + 1
                
                total_categorized = len(categories)
                for category, count in category_counts.items():
                    features[f'category_{category}_ratio'] = float(count / total_categorized)
            
            features['thread_ratio'] = float(thread_count / len(records) if records else 0)
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Engagement feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_json_features(self, json_data: Any, prefix: str) -> Dict[str, float]:
        """Extract numerical features from JSON data using LLM if needed"""
        try:
            if not json_data:
                return {}
            
            # If already a dict, work with it directly
            if isinstance(json_data, dict):
                data = json_data
            else:
                # Try to parse as JSON
                try:
                    data = json.loads(json_data)
                except:
                    return {}
            
            features = {}
            
            # Extract numerical values directly
            for key, value in data.items():
                if isinstance(value, (int, float)):
                    features[f'{prefix}_{key}'] = float(value)
                elif isinstance(value, bool):
                    features[f'{prefix}_{key}'] = float(1 if value else 0)
                elif isinstance(value, list):
                    features[f'{prefix}_{key}_count'] = float(len(value))
                elif isinstance(value, str):
                    # Use LLM to convert string to numerical score if meaningful
                    if any(sentiment_word in value.lower() for sentiment_word in ['positive', 'negative', 'neutral', 'high', 'low', 'good', 'bad']):
                        score = await self._convert_string_to_score(value, key)
                        if score is not None:
                            features[f'{prefix}_{key}_score'] = score
            
            return features
            
        except Exception as e:
            logger.error(f"❌ JSON feature extraction failed: {str(e)}")
            return {}
    
    async def _convert_string_to_score(self, text: str, context: str) -> Optional[float]:
        """Convert string values to numerical scores using LLM"""
        try:
            prompt = f"""
            Convert this text to a numerical score (0-10):
            
            Context: {context}
            Text: "{text}"
            
            Return only a number between 0-10, where:
            - 0 = very negative/low/poor
            - 5 = neutral/average
            - 10 = very positive/high/excellent
            
            Number:
            """
            
            result = await self.llm_service.analyze_text_content(prompt)
            
            if isinstance(result, dict) and result.get('success'):
                score_text = result.get('content', '').strip()
            else:
                score_text = str(result).strip() if result else ''
            
            # Extract number from response
            import re
            numbers = re.findall(r'\d+\.?\d*', score_text)
            if numbers:
                score = float(numbers[0])
                return min(10.0, max(0.0, score))  # Clamp to 0-10
            
            return None
            
        except:
            return None
    
    def _extract_sentiment_features(self, token_sentiments: Any) -> Dict[str, float]:
        """Extract sentiment features from token sentiments data"""
        try:
            if not token_sentiments:
                return {}
            
            sentiments = token_sentiments if isinstance(token_sentiments, list) else []
            
            if not sentiments:
                return {}
            
            # Count sentiment types
            positive_count = len([s for s in sentiments if s.get('sentiment') == 'POSITIVE'])
            negative_count = len([s for s in sentiments if s.get('sentiment') == 'NEGATIVE'])
            neutral_count = len([s for s in sentiments if s.get('sentiment') == 'NEUTRAL'])
            
            total_sentiments = len(sentiments)
            
            return {
                'positive_sentiment_ratio': float(positive_count / total_sentiments if total_sentiments > 0 else 0),
                'negative_sentiment_ratio': float(negative_count / total_sentiments if total_sentiments > 0 else 0),
                'neutral_sentiment_ratio': float(neutral_count / total_sentiments if total_sentiments > 0 else 0),
                'sentiment_diversity': float(len(set(s.get('sentiment') for s in sentiments if s.get('sentiment')))),
                'avg_sentiment_confidence': float(np.mean([s.get('confidence', 0) for s in sentiments if s.get('confidence')]))
            }
            
        except Exception as e:
            logger.error(f"❌ Sentiment feature extraction failed: {str(e)}")
            return {}
    
    def _extract_badge_features(self, badge_types: Any) -> Dict[str, float]:
        """Extract features from badge types"""
        try:
            if not badge_types:
                return {}
            
            badges = badge_types if isinstance(badge_types, list) else []
            
            # Badge type counts
            badge_counts = {}
            for badge in badges:
                badge_type = badge.get('type', 'unknown') if isinstance(badge, dict) else str(badge)
                badge_counts[badge_type] = badge_counts.get(badge_type, 0) + 1
            
            features = {
                'total_badges': float(len(badges)),
                'unique_badge_types': float(len(badge_counts))
            }
            
            # Individual badge type features
            for badge_type, count in badge_counts.items():
                features[f'badge_{badge_type.lower()}_count'] = float(count)
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Badge feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_llm_analysis_features(self, llm_analysis: Any) -> Dict[str, float]:
        """Extract numerical features from LLM analysis data"""
        try:
            if not llm_analysis:
                return {}
            
            analysis = llm_analysis if isinstance(llm_analysis, dict) else {}
            features = {}
            
            # Extract numerical scores from analysis
            for section_name, section_data in analysis.items():
                if isinstance(section_data, dict):
                    for key, value in section_data.items():
                        if isinstance(value, (int, float)):
                            features[f'llm_{section_name}_{key}'] = float(value)
                        elif isinstance(value, list):
                            features[f'llm_{section_name}_{key}_count'] = float(len(value))
            
            return features
            
        except Exception as e:
            logger.error(f"❌ LLM analysis feature extraction failed: {str(e)}")
            return {}
    
    def _extract_tweet_features(self, recent_tweets: Any) -> Dict[str, float]:
        """Extract features from recent tweets data"""
        try:
            if not recent_tweets:
                return {}
            
            tweets = recent_tweets if isinstance(recent_tweets, list) else []
            
            if not tweets:
                return {}
            
            # Calculate tweet statistics
            likes = [tweet.get('likes', 0) for tweet in tweets if isinstance(tweet, dict)]
            retweets = [tweet.get('retweets', 0) for tweet in tweets if isinstance(tweet, dict)]
            replies = [tweet.get('replies', 0) for tweet in tweets if isinstance(tweet, dict)]
            
            features = {
                'avg_likes': float(np.mean(likes) if likes else 0),
                'avg_retweets': float(np.mean(retweets) if retweets else 0),
                'avg_replies': float(np.mean(replies) if replies else 0),
                'max_likes': float(np.max(likes) if likes else 0),
                'engagement_variance': float(np.var([l + r + rep for l, r, rep in zip(likes, retweets, replies)] if likes else [0])),
                'tweet_count_analyzed': float(len(tweets))
            }
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Tweet feature extraction failed: {str(e)}")
            return {}
    
    async def _extract_campaign_features(self, campaign_context: Dict[str, Any]) -> Dict[str, float]:
        """Extract features from campaign context"""
        try:
            features = {}
            
            # Direct numerical features
            numerical_fields = [
                'reward_pool', 'competition_level', 'timeframe', 
                'active_participants', 'campaign_id'
            ]
            
            for field in numerical_fields:
                if field in campaign_context and campaign_context[field] is not None:
                    features[f'campaign_{field}'] = float(campaign_context[field])
            
            # Category encoding
            if 'category' in campaign_context:
                category_mapping = {
                    'gaming': 1, 'defi': 2, 'nft': 3, 'meme': 4, 
                    'education': 5, 'trading': 6, 'social': 7, 'other': 8
                }
                category = campaign_context['category'].lower()
                features['campaign_category_encoded'] = float(category_mapping.get(category, 8))
            
            # Platform encoding
            if 'platform' in campaign_context:
                platform_mapping = {'cookie.fun': 1, 'kaito': 2, 'yap.market': 3, 'other': 4}
                platform = campaign_context['platform'].lower()
                features['campaign_platform_encoded'] = float(platform_mapping.get(platform, 4))
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Campaign feature extraction failed: {str(e)}")
            return {}
    
    def _extract_temporal_features(self) -> Dict[str, float]:
        """Extract time-based features"""
        now = datetime.now()
        
        return {
            'hour_of_day': float(now.hour),
            'day_of_week': float(now.weekday()),  # 0 = Monday
            'day_of_month': float(now.day),
            'month': float(now.month),
            'is_weekend': float(1 if now.weekday() >= 5 else 0),
            'is_business_hours': float(1 if 9 <= now.hour <= 17 else 0),
            'is_prime_social_time': float(1 if now.hour in [12, 13, 19, 20, 21] else 0)
        }
    
    def _flatten_features(self, features: Dict[str, Dict[str, float]]) -> Dict[str, float]:
        """Flatten nested feature dictionary for ML model consumption"""
        flattened = {}
        
        for category, category_features in features.items():
            if isinstance(category_features, dict):
                for feature_name, feature_value in category_features.items():
                    # Ensure all values are float
                    try:
                        flattened[feature_name] = float(feature_value)
                    except (ValueError, TypeError):
                        flattened[feature_name] = 0.0
        
        return flattened
    
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
