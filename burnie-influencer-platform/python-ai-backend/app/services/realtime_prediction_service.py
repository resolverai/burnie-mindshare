"""
Real-time Prediction Service for Content Marketplace

Provides INSTANT predictions for content cards using ONLY pre-computed features.
NO LLM calls during predictions - everything is pre-computed during data collection.

Used by Burnie Influencer Platform's Content Marketplace interface.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
import asyncpg
import numpy as np

from app.services.delta_prediction_models import DeltaSNAPPredictor, PositionChangePredictor
from app.services.twitter_engagement_ml_model import TwitterEngagementMLModel
from app.config.settings import settings

logger = logging.getLogger(__name__)

class RealtimePredictionService:
    """
    Ultra-fast prediction service for Content Marketplace
    
    Key Features:
    - NO LLM calls during prediction (all features pre-computed)
    - Instant predictions for content cards
    - Uses existing data from platform_yapper_twitter_data and related tables
    - Supports batch predictions for marketplace listings
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.models_loaded = False
        
        # Initialize prediction models
        self.snap_predictor = DeltaSNAPPredictor(platform=platform)
        self.position_predictor = PositionChangePredictor(platform=platform)
        self.engagement_predictor = TwitterEngagementMLModel(platform=platform)
        
        # Model loading status
        self.model_status = {
            'snap_prediction': False,
            'position_prediction': False,
            'engagement_prediction': False
        }
    
    async def initialize_models(self) -> Dict[str, Any]:
        """
        Load all prediction models for fast inference
        """
        try:
            logger.info(f"🚀 Initializing prediction models for {self.platform}")
            
            results = {}
            
            # Load SNAP predictor
            snap_result = await self.snap_predictor.load_model_from_disk()
            self.model_status['snap_prediction'] = snap_result.get('success', False)
            results['snap_prediction'] = snap_result
            
            # Load position predictor
            position_result = await self.position_predictor.load_model_from_disk()
            self.model_status['position_prediction'] = position_result.get('success', False)
            results['position_prediction'] = position_result
            
            # Load engagement predictor
            engagement_result = await self.engagement_predictor.load_model_from_disk()
            self.model_status['engagement_prediction'] = engagement_result.get('success', False)
            results['engagement_prediction'] = engagement_result
            
            # Update overall status
            self.models_loaded = any(self.model_status.values())
            
            logger.info(f"✅ Model initialization completed:")
            logger.info(f"   SNAP Prediction: {'✅' if self.model_status['snap_prediction'] else '❌'}")
            logger.info(f"   Position Prediction: {'✅' if self.model_status['position_prediction'] else '❌'}")
            logger.info(f"   Engagement Prediction: {'✅' if self.model_status['engagement_prediction'] else '❌'}")
            
            return {
                'success': self.models_loaded,
                'models_loaded': self.model_status,
                'results': results,
                'initialization_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Model initialization failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'models_loaded': self.model_status
            }
    
    async def get_instant_predictions(
        self,
        yapper_twitter_handle: str,
        current_leaderboard_position: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Get instant predictions for a yapper using pre-computed features
        
        Uses data from:
        - platform_yapper_twitter_data (with anthropic_analysis/openai_analysis)
        - yapper_cookie_profile
        - platform_yapper_twitter_profiles
        """
        try:
            logger.info(f"⚡ Getting instant predictions for @{yapper_twitter_handle}")
            
            if not self.models_loaded:
                await self.initialize_models()
            
            # Load yapper's pre-computed data
            yapper_data = await self._load_yapper_precomputed_data(yapper_twitter_handle)
            
            if not yapper_data:
                return {
                    'success': False,
                    'error': f'No pre-computed data found for @{yapper_twitter_handle}'
                }
            
            # Extract features from pre-computed analysis
            features = await self._extract_features_from_precomputed_data(yapper_data)
            
            if not features:
                return {
                    'success': False,
                    'error': 'Could not extract features from pre-computed data'
                }
            
            # Make predictions using pre-computed features
            predictions = {}
            
            # SNAP prediction
            if self.model_status['snap_prediction']:
                snap_prediction = await self.snap_predictor.predict_delta_snaps(
                    content_features=features,
                    yapper_context=yapper_data.get('yapper_context', {})
                )
                predictions['snap_prediction'] = snap_prediction
            
            # Position change prediction
            if self.model_status['position_prediction'] and current_leaderboard_position:
                position_prediction = await self.position_predictor.predict_position_change(
                    content_features=features,
                    current_position=current_leaderboard_position,
                    yapper_context=yapper_data.get('yapper_context', {})
                )
                predictions['position_prediction'] = position_prediction
            
            # Twitter engagement prediction
            if self.model_status['engagement_prediction']:
                engagement_prediction = await self.engagement_predictor.predict_twitter_engagement(
                    content_features=features,
                    yapper_context=yapper_data.get('yapper_context', {})
                )
                predictions['engagement_prediction'] = engagement_prediction
            
            return {
                'success': True,
                'yapper_twitter_handle': yapper_twitter_handle,
                'predictions': predictions,
                'features_used': len(features),
                'data_sources': yapper_data.get('data_sources', []),
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Instant prediction failed for @{yapper_twitter_handle}: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'yapper_twitter_handle': yapper_twitter_handle
            }
    
    async def get_batch_predictions(
        self,
        yapper_handles: List[str],
        leaderboard_positions: Optional[Dict[str, int]] = None
    ) -> Dict[str, Any]:
        """
        Get predictions for multiple yappers (for marketplace listing)
        
        Optimized for marketplace interface where many content cards need predictions
        """
        try:
            logger.info(f"⚡ Getting batch predictions for {len(yapper_handles)} yappers")
            
            if not self.models_loaded:
                await self.initialize_models()
            
            # Process all yappers concurrently
            prediction_tasks = []
            for handle in yapper_handles:
                current_position = leaderboard_positions.get(handle) if leaderboard_positions else None
                task = self.get_instant_predictions(handle, current_position)
                prediction_tasks.append(task)
            
            # Execute all predictions concurrently
            results = await asyncio.gather(*prediction_tasks, return_exceptions=True)
            
            # Process results
            successful_predictions = {}
            failed_predictions = {}
            
            for i, result in enumerate(results):
                handle = yapper_handles[i]
                
                if isinstance(result, Exception):
                    failed_predictions[handle] = str(result)
                elif isinstance(result, dict) and result.get('success'):
                    successful_predictions[handle] = result['predictions']
                else:
                    failed_predictions[handle] = result.get('error', 'Unknown error')
            
            return {
                'success': True,
                'total_requested': len(yapper_handles),
                'successful_predictions': len(successful_predictions),
                'failed_predictions': len(failed_predictions),
                'predictions': successful_predictions,
                'errors': failed_predictions,
                'batch_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Batch prediction failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'total_requested': len(yapper_handles)
            }
    
    async def _load_yapper_precomputed_data(self, twitter_handle: str) -> Optional[Dict[str, Any]]:
        """
        Load yapper's pre-computed data from multiple tables
        """
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Query 1: Platform yapper Twitter data (with LLM analysis)
            twitter_query = """
            SELECT 
                pytd.*,
                pytp.engagement_rate,
                pytp.content_style_analysis,
                pytp.performance_patterns
            FROM platform_yapper_twitter_data pytd
            LEFT JOIN platform_yapper_twitter_profiles pytp 
                ON pytd.twitter_handle = pytp.twitter_handle
            WHERE pytd.twitter_handle = $1
            ORDER BY pytd.updated_at DESC
            LIMIT 1
            """
            
            twitter_data = await conn.fetchrow(twitter_query, twitter_handle)
            
            # Query 2: Yapper cookie profile
            profile_query = """
            SELECT * FROM yapper_cookie_profile 
            WHERE twitter_handle = $1
            ORDER BY updated_at DESC
            LIMIT 1
            """
            
            profile_data = await conn.fetchrow(profile_query, twitter_handle)
            
            await conn.close()
            
            if not twitter_data:
                logger.warning(f"⚠️ No Twitter data found for @{twitter_handle}")
                return None
            
            # Convert to dict and structure data
            result = {
                'twitter_data': dict(twitter_data) if twitter_data else {},
                'profile_data': dict(profile_data) if profile_data else {},
                'yapper_context': {
                    'followers_count': twitter_data.get('followers_count', 0) if twitter_data else 0,
                    'following_count': twitter_data.get('following_count', 0) if twitter_data else 0,
                    'tweet_count': twitter_data.get('tweet_count', 0) if twitter_data else 0,
                    'verified': twitter_data.get('verified', False) if twitter_data else False,
                    'engagement_rate': twitter_data.get('engagement_rate', 0.0) if twitter_data else 0.0
                },
                'data_sources': ['platform_yapper_twitter_data']
            }
            
            if profile_data:
                result['data_sources'].append('yapper_cookie_profile')
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to load pre-computed data for @{twitter_handle}: {str(e)}")
            return None
    
    async def _extract_features_from_precomputed_data(self, yapper_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Extract ML features from pre-computed LLM analysis
        
        NO new LLM calls - only use existing anthropic_analysis or openai_analysis
        """
        try:
            twitter_data = yapper_data.get('twitter_data', {})
            profile_data = yapper_data.get('profile_data', {})
            
            features = {}
            
            # Extract from LLM analysis (already computed)
            llm_analysis = None
            if twitter_data.get('anthropic_analysis'):
                llm_analysis = twitter_data['anthropic_analysis']
            elif twitter_data.get('openai_analysis'):
                llm_analysis = twitter_data['openai_analysis']
            
            if llm_analysis:
                # Parse LLM analysis to extract numerical features
                try:
                    if isinstance(llm_analysis, str):
                        import json
                        analysis_json = json.loads(llm_analysis)
                    else:
                        analysis_json = llm_analysis
                    
                    # Extract numerical scores if they exist
                    llm_features = {
                        'llm_content_quality': analysis_json.get('content_quality', 5.0),
                        'llm_viral_potential': analysis_json.get('viral_potential', 4.0),
                        'llm_engagement_potential': analysis_json.get('engagement_potential', 4.0),
                        'llm_originality': analysis_json.get('originality', 5.0),
                        'llm_clarity': analysis_json.get('clarity', 6.0),
                        'llm_emotional_impact': analysis_json.get('emotional_impact', 4.0),
                        'llm_call_to_action_strength': analysis_json.get('call_to_action_strength', 3.0),
                        'llm_trending_relevance': analysis_json.get('trending_relevance', 4.0),
                        'llm_technical_depth': analysis_json.get('technical_depth', 3.0),
                        'llm_humor_level': analysis_json.get('humor_level', 3.0),
                        'llm_crypto_relevance': analysis_json.get('crypto_relevance', 3.0),
                        'llm_predicted_snap_impact': analysis_json.get('predicted_snap_impact', 4.0),
                        'llm_predicted_position_impact': analysis_json.get('predicted_position_impact', 4.0),
                        'llm_predicted_twitter_engagement': analysis_json.get('predicted_twitter_engagement', 4.0)
                    }
                    
                    features.update(llm_features)
                    
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"⚠️ Could not parse LLM analysis: {e}")
                    # Use default values
                    features.update({
                        'llm_content_quality': 5.0,
                        'llm_viral_potential': 4.0,
                        'llm_engagement_potential': 4.0,
                        'llm_originality': 5.0,
                        'llm_clarity': 6.0,
                        'llm_emotional_impact': 4.0,
                        'llm_predicted_snap_impact': 4.0,
                        'llm_predicted_position_impact': 4.0,
                        'llm_predicted_twitter_engagement': 4.0
                    })
            
            # Extract basic features from Twitter data
            recent_tweets = twitter_data.get('recent_tweets', [])
            if recent_tweets and isinstance(recent_tweets, list) and len(recent_tweets) > 0:
                # Use most recent tweet for content features
                latest_tweet = recent_tweets[0]
                tweet_text = latest_tweet.get('text', '') if isinstance(latest_tweet, dict) else str(latest_tweet)
                
                # Basic content features
                features.update({
                    'char_length': len(tweet_text),
                    'word_count': len(tweet_text.split()) if tweet_text else 0,
                    'hashtag_count': tweet_text.count('#') if tweet_text else 0,
                    'mention_count': tweet_text.count('@') if tweet_text else 0,
                    'question_count': tweet_text.count('?') if tweet_text else 0,
                    'exclamation_count': tweet_text.count('!') if tweet_text else 0,
                    'emoji_count': len([c for c in tweet_text if ord(c) > 127]) if tweet_text else 0
                })
            
            # Extract yapper profile features
            features.update({
                'yapper_followers_count': twitter_data.get('followers_count', 0),
                'yapper_following_count': twitter_data.get('following_count', 0),
                'yapper_tweet_count': twitter_data.get('tweet_count', 0),
                'yapper_verified': twitter_data.get('verified', False),
                'yapper_engagement_rate': twitter_data.get('engagement_rate', 0.0)
            })
            
            # Temporal features (current time)
            now = datetime.now()
            features.update({
                'hour_of_day': now.hour,
                'day_of_week': now.weekday(),
                'is_weekend': now.weekday() >= 5,
                'is_prime_social_time': now.hour in [12, 13, 19, 20, 21]
            })
            
            # Default competition level
            features['competition_level'] = 50
            
            # Ensure all numeric values are properly typed
            for key, value in features.items():
                if isinstance(value, bool):
                    features[key] = int(value)
                elif value is None:
                    features[key] = 0
                else:
                    try:
                        features[key] = float(value)
                    except (ValueError, TypeError):
                        features[key] = 0
            
            logger.info(f"✅ Extracted {len(features)} features from pre-computed data")
            return features
            
        except Exception as e:
            logger.error(f"❌ Feature extraction from pre-computed data failed: {str(e)}")
            return None
    
    async def get_model_status(self) -> Dict[str, Any]:
        """Get current status of all prediction models"""
        return {
            'platform': self.platform,
            'models_loaded': self.models_loaded,
            'model_status': self.model_status,
            'status_timestamp': datetime.utcnow().isoformat()
        }
