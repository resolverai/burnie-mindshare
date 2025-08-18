"""
Enhanced LLM Analyzer Service

Extends ComprehensiveLLMAnalyzer to include pre-computed numerical features
for ML training. This ensures NO LLM calls are needed during model training
or prediction phases.
"""

import logging
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

from app.services.comprehensive_llm_analyzer import ComprehensiveLLMAnalyzer
from app.services.precomputed_feature_analyzer import PrecomputedFeatureAnalyzer

logger = logging.getLogger(__name__)

class EnhancedLLMAnalyzer(ComprehensiveLLMAnalyzer):
    """
    Enhanced LLM analyzer that pre-computes all ML features during data collection
    """
    
    def __init__(self):
        super().__init__()
        self.feature_analyzer = PrecomputedFeatureAnalyzer()
        logger.info("🚀 Enhanced LLM Analyzer initialized with pre-computed feature extraction")
    
    async def analyze_twitter_content_enhanced(
        self, 
        twitter_handle: str,
        tweet_texts: List[str],
        image_urls: List[str],
        context: Dict[str, Any],
        analysis_type: str = 'comprehensive'
    ) -> Dict[str, Any]:
        """
        Enhanced Twitter content analysis with pre-computed ML features
        
        This method:
        1. Performs standard LLM analysis (for human insights)
        2. Extracts ALL numerical features needed for ML models
        3. Stores both in the database for instant predictions
        """
        try:
            logger.info(f"🚀 Starting enhanced analysis for @{twitter_handle}")
            
            # Step 1: Perform standard LLM analysis
            standard_analysis = await self.analyze_twitter_content(
                twitter_handle, tweet_texts, image_urls, context, analysis_type
            )
            
            if not standard_analysis.get('success'):
                logger.error(f"❌ Standard analysis failed for @{twitter_handle}")
                return standard_analysis
            
            # Step 2: Extract pre-computed features for each tweet
            enhanced_features = []
            
            for i, tweet_text in enumerate(tweet_texts):
                logger.info(f"🎯 Extracting ML features for tweet {i+1}/{len(tweet_texts)}")
                
                # Extract comprehensive features
                feature_analysis = await self.feature_analyzer.analyze_content_for_training(
                    content_text=tweet_text,
                    context={
                        'twitter_handle': twitter_handle,
                        'analysis_type': analysis_type,
                        'platform_source': context.get('platform_source', 'cookie.fun'),
                        'has_images': len(image_urls) > 0,
                        'image_count': len(image_urls),
                        'tweet_index': i,
                        'total_tweets': len(tweet_texts)
                    }
                )
                
                if feature_analysis.get('success'):
                    enhanced_features.append({
                        'tweet_text': tweet_text,
                        'tweet_index': i,
                        'features': feature_analysis['features'],
                        'llm_provider': feature_analysis.get('llm_provider'),
                        'raw_llm_response': feature_analysis.get('raw_llm_response')
                    })
                    logger.info(f"✅ Extracted {len(feature_analysis['features'])} features for tweet {i+1}")
                else:
                    logger.warning(f"⚠️ Feature extraction failed for tweet {i+1}: {feature_analysis.get('error')}")
                    enhanced_features.append({
                        'tweet_text': tweet_text,
                        'tweet_index': i,
                        'features': {},
                        'error': feature_analysis.get('error')
                    })
            
            # Step 3: Combine standard analysis with enhanced features
            enhanced_result = {
                **standard_analysis,
                'enhanced_features': enhanced_features,
                'total_features_extracted': sum(1 for f in enhanced_features if f.get('features')),
                'feature_extraction_timestamp': datetime.utcnow().isoformat()
            }
            
            logger.info(f"✅ Enhanced analysis completed for @{twitter_handle}")
            logger.info(f"   Features extracted for {enhanced_result['total_features_extracted']}/{len(tweet_texts)} tweets")
            
            return enhanced_result
            
        except Exception as e:
            logger.error(f"❌ Enhanced analysis failed for @{twitter_handle}: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'twitter_handle': twitter_handle
            }
    
    async def analyze_single_content_for_prediction(
        self,
        content_text: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Analyze single content for real-time prediction
        
        This is used when yappers want to preview predictions before posting.
        MUST use pre-computed features only - NO new LLM calls!
        """
        try:
            logger.info("🎯 Analyzing content for prediction (no LLM calls)")
            
            # Extract features using pre-computed analyzer
            feature_analysis = await self.feature_analyzer.analyze_content_for_training(
                content_text=content_text,
                context=context
            )
            
            if not feature_analysis.get('success'):
                return {
                    'success': False,
                    'error': feature_analysis.get('error', 'Feature extraction failed')
                }
            
            return {
                'success': True,
                'features': feature_analysis['features'],
                'llm_provider': feature_analysis.get('llm_provider'),
                'analysis_timestamp': datetime.utcnow().isoformat(),
                'ready_for_prediction': True
            }
            
        except Exception as e:
            logger.error(f"❌ Single content analysis failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    async def extract_numerical_features_from_existing_analysis(
        self,
        existing_analysis: Dict[str, Any],
        content_text: str
    ) -> Dict[str, Any]:
        """
        Extract numerical features from existing LLM analysis
        
        Used to backfill numerical features for existing data
        """
        try:
            logger.info("🔄 Extracting numerical features from existing analysis")
            
            # Get the LLM analysis content
            analysis_content = None
            provider_used = None
            
            if existing_analysis.get('anthropic_analysis'):
                analysis_content = existing_analysis['anthropic_analysis']
                provider_used = 'anthropic'
            elif existing_analysis.get('openai_analysis'):
                analysis_content = existing_analysis['openai_analysis']
                provider_used = 'openai'
            else:
                # No existing analysis, create new one
                return await self.feature_analyzer.analyze_content_for_training(
                    content_text=content_text,
                    context={'backfill': True}
                )
            
            # Parse existing analysis to extract numerical scores
            try:
                if isinstance(analysis_content, str):
                    analysis_json = json.loads(analysis_content)
                else:
                    analysis_json = analysis_content
                
                # Extract numerical features from existing analysis
                numerical_features = self._extract_numbers_from_analysis(analysis_json)
                
                # Combine with basic features
                basic_features = self.feature_analyzer._extract_basic_features(content_text)
                crypto_features = self.feature_analyzer._extract_crypto_features(content_text)
                temporal_features = self.feature_analyzer._extract_temporal_features()
                
                all_features = {
                    **basic_features,
                    **crypto_features,
                    **temporal_features,
                    **numerical_features
                }
                
                return {
                    'success': True,
                    'features': all_features,
                    'source': 'backfill_from_existing',
                    'original_provider': provider_used,
                    'extraction_timestamp': datetime.utcnow().isoformat()
                }
                
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"⚠️ Could not parse existing analysis: {e}")
                # Fallback to new analysis
                return await self.feature_analyzer.analyze_content_for_training(
                    content_text=content_text,
                    context={'backfill_fallback': True}
                )
                
        except Exception as e:
            logger.error(f"❌ Feature extraction from existing analysis failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _extract_numbers_from_analysis(self, analysis_json: Dict[str, Any]) -> Dict[str, float]:
        """
        Extract numerical features from existing LLM analysis JSON
        
        Maps existing text-based analysis to numerical scores for ML models
        """
        features = {}
        
        try:
            # Map existing analysis fields to numerical scores
            if 'content_themes' in analysis_json:
                themes = analysis_json['content_themes']
                if isinstance(themes, list) and themes:
                    # Score based on theme variety and relevance
                    features['llm_content_quality'] = min(10.0, len(themes) * 2.0)
                    
                    # Check for viral themes
                    viral_keywords = ['trending', 'viral', 'popular', 'engaging', 'compelling']
                    viral_score = sum(1 for theme in themes if any(kw in str(theme).lower() for kw in viral_keywords))
                    features['llm_viral_potential'] = min(10.0, viral_score * 3.0)
            
            if 'success_indicators' in analysis_json:
                indicators = analysis_json['success_indicators']
                if isinstance(indicators, dict):
                    # Extract engagement potential
                    engagement_elements = indicators.get('viral_elements', [])
                    if isinstance(engagement_elements, list):
                        features['llm_engagement_potential'] = min(10.0, len(engagement_elements) * 2.5)
                    
                    # Extract originality score
                    if 'uniqueness_factors' in indicators:
                        uniqueness = indicators['uniqueness_factors']
                        if isinstance(uniqueness, list):
                            features['llm_originality'] = min(10.0, len(uniqueness) * 2.0)
            
            if 'category_classification' in analysis_json:
                category = analysis_json['category_classification']
                if isinstance(category, str):
                    features['llm_category_classification'] = category.lower()
                    
                    # Score crypto relevance based on category
                    crypto_categories = ['defi', 'nft', 'crypto', 'trading', 'blockchain']
                    if any(cat in category.lower() for cat in crypto_categories):
                        features['llm_crypto_relevance'] = 9.0
                    else:
                        features['llm_crypto_relevance'] = 3.0
            
            # Default values for missing fields
            default_scores = {
                'llm_content_quality': 5.0,
                'llm_viral_potential': 4.0,
                'llm_engagement_potential': 4.0,
                'llm_originality': 5.0,
                'llm_clarity': 6.0,
                'llm_emotional_impact': 4.0,
                'llm_call_to_action_strength': 3.0,
                'llm_trending_relevance': 4.0,
                'llm_technical_depth': 3.0,
                'llm_humor_level': 3.0,
                'llm_controversy_level': 2.0,
                'llm_crypto_relevance': 3.0,
                'llm_predicted_snap_impact': 4.0,
                'llm_predicted_position_impact': 4.0,
                'llm_predicted_twitter_engagement': 4.0,
                'llm_category_classification': 'other',
                'llm_sentiment_classification': 'neutral',
                'llm_content_type': 'personal',
                'llm_target_audience': 'general'
            }
            
            # Fill missing values
            for key, default_value in default_scores.items():
                if key not in features:
                    features[key] = default_value
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Number extraction failed: {str(e)}")
            return {}
    
    async def prepare_training_data_entry(
        self,
        twitter_handle: str,
        tweet_text: str,
        tweet_id: str,
        engagement_metrics: Dict[str, Any],
        yapper_context: Dict[str, Any],
        platform_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Prepare a complete training data entry for storage
        
        Used by Twitter collection services to create training data entries
        with all pre-computed features
        """
        try:
            logger.info(f"📊 Preparing training data entry for tweet {tweet_id}")
            
            # Extract all features
            feature_analysis = await self.feature_analyzer.analyze_content_for_training(
                content_text=tweet_text,
                context={
                    'twitter_handle': twitter_handle,
                    'tweet_id': tweet_id,
                    'platform_source': platform_context.get('platform_source', 'cookie.fun'),
                    'preparation_for': 'training_data'
                }
            )
            
            if not feature_analysis.get('success'):
                logger.error(f"❌ Feature extraction failed for tweet {tweet_id}")
                return {'success': False, 'error': feature_analysis.get('error')}
            
            # Prepare complete training entry
            training_entry = {
                # Basic identification
                'yapper_twitter_handle': twitter_handle,
                'content_text': tweet_text,
                'tweet_id': tweet_id,
                'platform_source': platform_context.get('platform_source', 'cookie.fun'),
                
                # Pre-computed features (all numerical for instant ML training)
                **feature_analysis['features'],
                
                # Engagement metrics (targets for Twitter engagement model)
                'likes_count': engagement_metrics.get('likes', 0),
                'retweets_count': engagement_metrics.get('retweets', 0),
                'replies_count': engagement_metrics.get('replies', 0),
                'quotes_count': engagement_metrics.get('quotes', 0),
                'total_engagement': sum([
                    engagement_metrics.get('likes', 0),
                    engagement_metrics.get('retweets', 0),
                    engagement_metrics.get('replies', 0),
                    engagement_metrics.get('quotes', 0)
                ]),
                
                # Yapper context
                'yapper_followers_count': yapper_context.get('followers_count', 0),
                'yapper_following_count': yapper_context.get('following_count', 0),
                'yapper_tweet_count': yapper_context.get('tweet_count', 0),
                'yapper_verified': yapper_context.get('verified', False),
                'yapper_engagement_rate': yapper_context.get('engagement_rate', 0.0),
                
                # Platform context (for SNAP/position prediction)
                'campaign_id': platform_context.get('campaign_id'),
                'campaign_reward_pool': platform_context.get('campaign_reward_pool'),
                'competition_level': platform_context.get('competition_level', 50),
                
                # Metadata
                'llm_provider': feature_analysis.get('llm_provider', 'unknown'),
                'raw_llm_response': feature_analysis.get('raw_llm_response'),
                'posted_at': datetime.utcnow(),  # Will be updated with actual posting time
                'training_status': 'pending'
            }
            
            return {
                'success': True,
                'training_entry': training_entry,
                'features_count': len([k for k, v in training_entry.items() if k.startswith('llm_') and isinstance(v, (int, float))]),
                'preparation_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Training data preparation failed: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
