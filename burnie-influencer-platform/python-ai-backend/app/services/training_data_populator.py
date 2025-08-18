"""
Training Data Populator

Extracts ML features from existing LLM analysis and populates training tables
"""

import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, List, Any, Optional
import asyncpg
from textblob import TextBlob

from app.config.settings import settings

logger = logging.getLogger(__name__)

class TrainingDataPopulator:
    """
    Populates training data tables from existing LLM analysis
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
    
    async def populate_from_existing_analysis(self) -> Dict[str, Any]:
        """
        Extract ML features from existing LLM analysis in platform_yapper_twitter_data
        and populate training tables
        """
        try:
            logger.info(f"🔄 Populating training data for {self.platform}")
            
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Get existing LLM analysis data
            query = """
            SELECT 
                pytd.twitter_handle,
                pytd.tweet_text,
                pytd.tweet_id,
                pytd.posted_at,
                pytd.engagement_metrics,
                pytd.anthropic_analysis,
                pytd.openai_analysis,
                pytp.followers_count,
                pytp.following_count,
                pytp.tweet_count,
                pytp.verified,
                pytp.engagement_rate
            FROM platform_yapper_twitter_data pytd
            LEFT JOIN platform_yapper_twitter_profiles pytp 
                ON pytd.twitter_handle = pytp.twitter_handle
            WHERE (pytd.anthropic_analysis IS NOT NULL OR pytd.openai_analysis IS NOT NULL)
                AND pytd.tweet_text IS NOT NULL
            ORDER BY pytd.updated_at DESC
            LIMIT 100
            """
            
            records = await conn.fetch(query)
            logger.info(f"📊 Found {len(records)} records with LLM analysis")
            
            if len(records) == 0:
                await conn.close()
                return {
                    'success': False,
                    'error': 'No records with LLM analysis found',
                    'records_processed': 0
                }
            
            # Process each record
            processed_count = 0
            for record in records:
                try:
                    # Extract ML features from LLM analysis
                    ml_features = self._extract_ml_features_from_analysis(record)
                    
                    if ml_features:
                        # Insert into twitter_engagement_training_data
                        await self._insert_twitter_engagement_data(conn, record, ml_features)
                        
                        # Insert into primary_predictor_training_data (if we have platform context)
                        await self._insert_primary_predictor_data(conn, record, ml_features)
                        
                        processed_count += 1
                        
                except Exception as e:
                    logger.warning(f"⚠️ Failed to process record for {record.get('twitter_handle')}: {str(e)}")
                    continue
            
            await conn.close()
            
            logger.info(f"✅ Processed {processed_count} records into training tables")
            
            return {
                'success': True,
                'records_found': len(records),
                'records_processed': processed_count,
                'platform': self.platform
            }
            
        except Exception as e:
            logger.error(f"❌ Training data population failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'records_processed': 0
            }
    
    def _extract_ml_features_from_analysis(self, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract ML features from existing LLM analysis"""
        try:
            # Get LLM analysis (prefer anthropic)
            analysis_json = None
            provider = None
            
            if record.get('anthropic_analysis'):
                analysis_text = record['anthropic_analysis']
                provider = 'anthropic'
            elif record.get('openai_analysis'):
                analysis_text = record['openai_analysis']
                provider = 'openai'
            else:
                return None
            
            # Parse the analysis
            if isinstance(analysis_text, str):
                try:
                    analysis_json = json.loads(analysis_text)
                except json.JSONDecodeError:
                    logger.warning(f"⚠️ Could not parse LLM analysis for {record.get('twitter_handle')}")
                    return None
            elif isinstance(analysis_text, dict):
                analysis_json = analysis_text
            else:
                return None
            
            # Extract ML features
            ml_features = analysis_json.get('ml_features', {})
            
            if not ml_features:
                logger.warning(f"⚠️ No ml_features found in analysis for {record.get('twitter_handle')}")
                return None
            
            # Add basic content features
            tweet_text = record.get('tweet_text', '')
            blob = TextBlob(tweet_text)
            
            basic_features = {
                'char_length': len(tweet_text),
                'word_count': len(tweet_text.split()) if tweet_text else 0,
                'sentiment_polarity': float(blob.sentiment.polarity),
                'sentiment_subjectivity': float(blob.sentiment.subjectivity),
                'hashtag_count': tweet_text.count('#') if tweet_text else 0,
                'mention_count': tweet_text.count('@') if tweet_text else 0,
                'question_count': tweet_text.count('?') if tweet_text else 0,
                'exclamation_count': tweet_text.count('!') if tweet_text else 0,
                'uppercase_ratio': sum(1 for c in tweet_text if c.isupper()) / len(tweet_text) if tweet_text else 0,
                'emoji_count': len([c for c in tweet_text if ord(c) > 127]) if tweet_text else 0,
                'url_count': tweet_text.count('http') if tweet_text else 0
            }
            
            # Temporal features
            posted_at = record.get('posted_at') or datetime.now()
            if isinstance(posted_at, str):
                posted_at = datetime.fromisoformat(posted_at.replace('Z', '+00:00'))
            
            temporal_features = {
                'hour_of_day': posted_at.hour,
                'day_of_week': posted_at.weekday(),
                'is_weekend': posted_at.weekday() >= 5,
                'is_prime_social_time': posted_at.hour in [12, 13, 19, 20, 21]
            }
            
            # Crypto features
            tweet_lower = tweet_text.lower() if tweet_text else ''
            crypto_features = {
                'crypto_keyword_count': sum(1 for kw in ['bitcoin', 'ethereum', 'crypto', 'defi', 'nft'] if kw in tweet_lower),
                'trading_keyword_count': sum(1 for kw in ['bull', 'bear', 'pump', 'dump', 'moon'] if kw in tweet_lower),
                'technical_keyword_count': sum(1 for kw in ['staking', 'yield', 'dao', 'dapp'] if kw in tweet_lower)
            }
            
            # Combine all features
            all_features = {
                **ml_features,
                **basic_features,
                **temporal_features,
                **crypto_features,
                'llm_provider': provider
            }
            
            return all_features
            
        except Exception as e:
            logger.error(f"❌ ML feature extraction failed: {str(e)}")
            return None
    
    async def _insert_twitter_engagement_data(self, conn: Any, record: Dict[str, Any], ml_features: Dict[str, Any]):
        """Insert data into twitter_engagement_training_data table"""
        try:
            # Extract engagement metrics
            engagement_metrics = record.get('engagement_metrics', {})
            if isinstance(engagement_metrics, str):
                engagement_metrics = json.loads(engagement_metrics)
            
            likes = engagement_metrics.get('like_count', 0)
            retweets = engagement_metrics.get('retweet_count', 0)
            replies = engagement_metrics.get('reply_count', 0)
            quotes = engagement_metrics.get('quote_count', 0)
            
            insert_query = """
            INSERT INTO twitter_engagement_training_data (
                yapper_twitter_handle, tweet_id, tweet_text, posted_at,
                likes_count, retweets_count, replies_count, quotes_count, total_engagement,
                llm_content_quality, llm_viral_potential, llm_engagement_potential,
                llm_originality, llm_clarity, llm_emotional_impact, llm_call_to_action_strength,
                llm_trending_relevance, llm_humor_level, llm_content_type, llm_target_audience,
                char_length, word_count, sentiment_polarity, sentiment_subjectivity,
                hashtag_count, mention_count, url_count, emoji_count, question_count, exclamation_count,
                has_media, is_thread, is_reply,
                yapper_followers_count, yapper_following_count, yapper_tweet_count, yapper_verified,
                hour_of_day, day_of_week, is_weekend, is_prime_social_time,
                crypto_keyword_count, trading_keyword_count, technical_keyword_count,
                llm_provider, platform_source
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
                $39, $40, $41, $42, $43, $44, $45, $46
            )
            ON CONFLICT (tweet_id) DO NOTHING
            """
            
            # Helper function to clamp values for precision 5,2 fields (max 999.99)
            def clamp_score(value, default=5.0, min_val=0.0, max_val=10.0):
                """Clamp score values to fit precision 5,2 database constraint"""
                try:
                    val = float(value) if value is not None else default
                    return max(min_val, min(max_val, val))
                except (ValueError, TypeError):
                    return default
            
            await conn.execute(
                insert_query,
                record.get('twitter_handle', ''),
                record.get('tweet_id', ''),
                record.get('tweet_text', ''),
                record.get('posted_at', datetime.now()),
                likes, retweets, replies, quotes, likes + retweets + replies + quotes,
                clamp_score(ml_features.get('content_quality', 5.0)),
                clamp_score(ml_features.get('viral_potential', 5.0)),
                clamp_score(ml_features.get('engagement_potential', 5.0)),
                clamp_score(ml_features.get('originality', 5.0)),
                clamp_score(ml_features.get('clarity', 5.0)),
                clamp_score(ml_features.get('emotional_impact', 5.0)),
                clamp_score(ml_features.get('call_to_action_strength', 5.0)),
                clamp_score(ml_features.get('trending_relevance', 5.0)),
                clamp_score(ml_features.get('humor_level', 5.0)),
                ml_features.get('content_type', 'personal'),
                ml_features.get('target_audience', 'general'),
                ml_features.get('char_length', 0),
                ml_features.get('word_count', 0),
                clamp_score(ml_features.get('sentiment_polarity', 0.0), default=0.0, min_val=-1.0, max_val=1.0),
                clamp_score(ml_features.get('sentiment_subjectivity', 0.0), default=0.0, min_val=0.0, max_val=1.0),
                ml_features.get('hashtag_count', 0),
                ml_features.get('mention_count', 0),
                ml_features.get('url_count', 0),
                ml_features.get('emoji_count', 0),
                ml_features.get('question_count', 0),
                ml_features.get('exclamation_count', 0),
                ml_features.get('has_media', False),  # Default to False if not specified
                ml_features.get('is_thread', False),  # Default to False if not specified  
                ml_features.get('is_reply', False),   # Default to False if not specified
                record.get('followers_count', 0),
                record.get('following_count', 0),
                record.get('tweet_count', 0),
                record.get('verified', False),
                ml_features.get('hour_of_day', 12),
                ml_features.get('day_of_week', 1),
                ml_features.get('is_weekend', False),
                ml_features.get('is_prime_social_time', False),
                ml_features.get('crypto_keyword_count', 0),
                ml_features.get('trading_keyword_count', 0),
                ml_features.get('technical_keyword_count', 0),
                ml_features.get('llm_provider', 'anthropic'),
                self.platform
            )
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to insert Twitter engagement data: {str(e)}")
    
    async def _insert_primary_predictor_data(self, conn: Any, record: Dict[str, Any], ml_features: Dict[str, Any]):
        """Insert data into primary_predictor_training_data table (for SNAP/position prediction)"""
        try:
            # For now, we'll use mock SNAP data since we don't have actual before/after SNAP counts
            # In production, this would come from actual platform data
            mock_snap_delta = ml_features.get('predicted_snap_impact', 5.0) * 10  # Scale to realistic range
            mock_position_change = int(ml_features.get('predicted_position_impact', 5.0) - 5)  # -5 to +5 range
            
            insert_query = """
            INSERT INTO primary_predictor_training_data (
                yapper_twitter_handle, content_text, tweet_id, posted_at, platform_source,
                delta_snaps, position_change,
                llm_content_quality, llm_viral_potential, llm_engagement_potential,
                llm_originality, llm_clarity, llm_emotional_impact, llm_trending_relevance,
                llm_technical_depth, llm_humor_level, llm_controversy_level, llm_crypto_relevance,
                llm_predicted_snap_impact, llm_predicted_position_impact, llm_predicted_twitter_engagement,
                llm_category_classification, llm_sentiment_classification, llm_content_type, llm_target_audience,
                char_length, word_count, sentiment_polarity, sentiment_subjectivity,
                hashtag_count, mention_count, question_count, exclamation_count, uppercase_ratio, emoji_count,
                yapper_followers_count, yapper_following_count, yapper_tweet_count, yapper_engagement_rate,
                hour_of_day, day_of_week, is_weekend, is_prime_social_time,
                crypto_keyword_count, trading_keyword_count, technical_keyword_count,
                llm_provider, training_status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
                $41, $42, $43, $44, $45, $46, $47, $48
            )
            ON CONFLICT (tweet_id) DO NOTHING
            """
            
            # Helper function to clamp values for precision 5,2 fields (max 999.99)
            def clamp_score(value, default=5.0, min_val=0.0, max_val=10.0):
                """Clamp score values to fit precision 5,2 database constraint"""
                try:
                    val = float(value) if value is not None else default
                    return max(min_val, min(max_val, val))
                except (ValueError, TypeError):
                    return default
            
            await conn.execute(
                insert_query,
                record.get('twitter_handle', ''),
                record.get('tweet_text', ''),
                record.get('tweet_id', ''),
                record.get('posted_at', datetime.now()),
                self.platform,
                mock_snap_delta,
                mock_position_change,
                clamp_score(ml_features.get('content_quality', 5.0)),
                clamp_score(ml_features.get('viral_potential', 5.0)),
                clamp_score(ml_features.get('engagement_potential', 5.0)),
                clamp_score(ml_features.get('originality', 5.0)),
                clamp_score(ml_features.get('clarity', 5.0)),
                clamp_score(ml_features.get('emotional_impact', 5.0)),
                clamp_score(ml_features.get('trending_relevance', 5.0)),
                clamp_score(ml_features.get('technical_depth', 5.0)),
                clamp_score(ml_features.get('humor_level', 5.0)),
                clamp_score(ml_features.get('controversy_level', 5.0)),
                clamp_score(ml_features.get('crypto_relevance', 5.0)),
                clamp_score(ml_features.get('predicted_snap_impact', 5.0)),
                clamp_score(ml_features.get('predicted_position_impact', 5.0)),
                clamp_score(ml_features.get('predicted_twitter_engagement', 5.0)),
                ml_features.get('category_classification', 'other'),
                ml_features.get('sentiment_classification', 'neutral'),
                ml_features.get('content_type', 'personal'),
                ml_features.get('target_audience', 'general'),
                ml_features.get('char_length', 0),
                ml_features.get('word_count', 0),
                clamp_score(ml_features.get('sentiment_polarity', 0.0), default=0.0, min_val=-1.0, max_val=1.0),
                clamp_score(ml_features.get('sentiment_subjectivity', 0.0), default=0.0, min_val=0.0, max_val=1.0),
                ml_features.get('hashtag_count', 0),
                ml_features.get('mention_count', 0),
                ml_features.get('question_count', 0),
                ml_features.get('exclamation_count', 0),
                clamp_score(ml_features.get('uppercase_ratio', 0.0), default=0.0, min_val=0.0, max_val=1.0),
                ml_features.get('emoji_count', 0),
                record.get('followers_count', 0),
                record.get('following_count', 0),
                record.get('tweet_count', 0),
                clamp_score(record.get('engagement_rate', 0.0), default=0.0, min_val=0.0, max_val=10.0),
                ml_features.get('hour_of_day', 12),
                ml_features.get('day_of_week', 1),
                ml_features.get('is_weekend', False),
                ml_features.get('is_prime_social_time', False),
                ml_features.get('crypto_keyword_count', 0),
                ml_features.get('trading_keyword_count', 0),
                ml_features.get('technical_keyword_count', 0),
                ml_features.get('llm_provider', 'anthropic'),
                'completed'
            )
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to insert primary predictor data: {str(e)}")
