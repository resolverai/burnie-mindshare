"""
Pre-computed Feature Analyzer

Extracts ML-ready features during Twitter data collection to avoid 
expensive LLM calls during model training.
"""

import json
import logging
import re
from datetime import datetime
from typing import Dict, List, Any, Optional
from textblob import TextBlob

from app.services.llm_providers import MultiProviderLLMService
from app.config.settings import settings

logger = logging.getLogger(__name__)

class PrecomputedFeatureAnalyzer:
    """
    Analyzes content during Twitter data collection and pre-computes 
    all features needed for ML training
    """
    
    def __init__(self):
        self.llm_service = MultiProviderLLMService(
            primary_provider=settings.default_llm_provider or 'anthropic',
            fallback_provider=settings.fallback_llm_provider or 'openai'
        )
    
    async def analyze_content_for_training(
        self, 
        content_text: str, 
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Comprehensive content analysis for ML training data
        
        Returns all features needed for:
        - SNAP delta prediction
        - Position change prediction  
        - Twitter engagement prediction
        """
        try:
            logger.info(f"🎯 Analyzing content for ML training features")
            
            # Extract basic features immediately
            basic_features = self._extract_basic_features(content_text)
            
            # Extract crypto/web3 features
            crypto_features = self._extract_crypto_features(content_text)
            
            # Extract temporal features
            temporal_features = self._extract_temporal_features()
            
            # Get comprehensive LLM analysis
            llm_features = await self._get_comprehensive_llm_analysis(content_text, context)
            
            # Combine all features
            all_features = {
                **basic_features,
                **crypto_features, 
                **temporal_features,
                **llm_features
            }
            
            return {
                'success': True,
                'features': all_features,
                'llm_provider': llm_features.get('llm_provider', 'unknown'),
                'raw_llm_response': llm_features.get('raw_llm_response'),
                'analysis_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Content analysis failed: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'features': self._get_fallback_features(content_text)
            }
    
    def _extract_basic_features(self, content_text: str) -> Dict[str, Any]:
        """Extract basic text features without LLM"""
        try:
            blob = TextBlob(content_text)
            
            return {
                'char_length': len(content_text),
                'word_count': len(blob.words),
                'sentence_count': len(blob.sentences),
                'sentiment_polarity': float(blob.sentiment.polarity),
                'sentiment_subjectivity': float(blob.sentiment.subjectivity),
                'hashtag_count': len(re.findall(r'#\w+', content_text)),
                'mention_count': len(re.findall(r'@\w+', content_text)),
                'url_count': len(re.findall(r'http[s]?://\S+', content_text)),
                'emoji_count': len(re.findall(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]', content_text)),
                'question_count': content_text.count('?'),
                'exclamation_count': content_text.count('!'),
                'uppercase_ratio': sum(1 for c in content_text if c.isupper()) / len(content_text) if content_text else 0,
                'has_media': False,  # Will be set by caller if images/videos present
                'is_thread': False,  # Will be set by caller if thread
                'is_reply': False    # Will be set by caller if reply
            }
            
        except Exception as e:
            logger.error(f"❌ Basic feature extraction failed: {str(e)}")
            return {}
    
    def _extract_crypto_features(self, content_text: str) -> Dict[str, Any]:
        """Extract crypto/web3 specific features"""
        try:
            content_lower = content_text.lower()
            
            crypto_keywords = ['bitcoin', 'ethereum', 'crypto', 'blockchain', 'defi', 'nft', 'web3', 'btc', 'eth']
            trading_keywords = ['bull', 'bear', 'pump', 'dump', 'moon', 'hodl', 'diamond', 'hands', 'buy', 'sell']
            technical_keywords = ['mining', 'staking', 'yield', 'dao', 'dapp', 'smart contract', 'validator', 'node']
            
            return {
                'crypto_keyword_count': sum(1 for kw in crypto_keywords if kw in content_lower),
                'trading_keyword_count': sum(1 for kw in trading_keywords if kw in content_lower),
                'technical_keyword_count': sum(1 for kw in technical_keywords if kw in content_lower)
            }
            
        except Exception as e:
            logger.error(f"❌ Crypto feature extraction failed: {str(e)}")
            return {
                'crypto_keyword_count': 0,
                'trading_keyword_count': 0,
                'technical_keyword_count': 0
            }
    
    def _extract_temporal_features(self) -> Dict[str, Any]:
        """Extract time-based features"""
        now = datetime.now()
        
        return {
            'hour_of_day': now.hour,
            'day_of_week': now.weekday(),  # 0=Monday, 6=Sunday
            'is_weekend': now.weekday() >= 5,
            'is_prime_social_time': now.hour in [12, 13, 19, 20, 21]
        }
    
    async def _get_comprehensive_llm_analysis(
        self, 
        content_text: str, 
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Get comprehensive LLM analysis with all features needed for ML models
        """
        try:
            # Enhanced prompt for comprehensive analysis
            analysis_prompt = f"""
            Analyze this social media content and provide numerical scores and classifications for ML training.
            
            Content: "{content_text}"
            Context: {json.dumps(context or {}, default=str)}
            
            Provide EXACT JSON response with these metrics:
            {{
                "content_quality": <0-10 numerical score>,
                "viral_potential": <0-10 numerical score>,
                "engagement_potential": <0-10 numerical score>,
                "originality": <0-10 numerical score>,
                "clarity": <0-10 numerical score>,
                "emotional_impact": <0-10 numerical score>,
                "call_to_action_strength": <0-10 numerical score>,
                "trending_relevance": <0-10 numerical score>,
                "technical_depth": <0-10 numerical score>,
                "humor_level": <0-10 numerical score>,
                "controversy_level": <0-10 numerical score>,
                "crypto_relevance": <0-10 numerical score>,
                "category_classification": "<one of: gaming, defi, nft, meme, education, trading, social, other>",
                "sentiment_classification": "<one of: bullish, bearish, neutral, mixed>",
                "content_type": "<one of: educational, promotional, personal, meme, news, analysis>",
                "target_audience": "<one of: beginners, experts, traders, builders, general>",
                "predicted_snap_impact": <0-10 score for SNAP earning potential>,
                "predicted_position_impact": <0-10 score for leaderboard climbing potential>,
                "predicted_twitter_engagement": <0-10 score for Twitter engagement potential>
            }}
            
            Important: Return ONLY valid JSON, no explanations or markdown.
            """
            
            result = await self.llm_service.analyze_text_content(analysis_prompt)
            
            if not isinstance(result, dict) or not result.get('success'):
                logger.warning(f"⚠️ LLM analysis failed: {result}")
                return self._get_default_llm_features()
            
            # Extract and parse the analysis
            analysis_text = result.get('content', '{}')
            provider = result.get('provider', 'unknown')
            
            # Ensure analysis_text is a string
            if isinstance(analysis_text, dict):
                analysis_text = json.dumps(analysis_text)
            elif not isinstance(analysis_text, str):
                analysis_text = str(analysis_text)
            
            # Parse the LLM response
            try:
                parsed_analysis = json.loads(self._clean_json_response(analysis_text))
                
                if not isinstance(parsed_analysis, dict):
                    logger.warning(f"⚠️ LLM returned non-dict: {type(parsed_analysis)}")
                    return self._get_default_llm_features()
                
                # Convert to consistent format with validation
                llm_features = {}
                
                # Numerical scores (0-10)
                numerical_fields = [
                    'content_quality', 'viral_potential', 'engagement_potential',
                    'originality', 'clarity', 'emotional_impact', 'call_to_action_strength',
                    'trending_relevance', 'technical_depth', 'humor_level', 
                    'controversy_level', 'crypto_relevance', 'predicted_snap_impact',
                    'predicted_position_impact', 'predicted_twitter_engagement'
                ]
                
                for field in numerical_fields:
                    value = parsed_analysis.get(field, 5.0)
                    try:
                        llm_features[f'llm_{field}'] = float(max(0.0, min(10.0, value)))
                    except (ValueError, TypeError):
                        llm_features[f'llm_{field}'] = 5.0
                
                # Categorical fields
                categorical_fields = {
                    'category_classification': ['gaming', 'defi', 'nft', 'meme', 'education', 'trading', 'social', 'other'],
                    'sentiment_classification': ['bullish', 'bearish', 'neutral', 'mixed'],
                    'content_type': ['educational', 'promotional', 'personal', 'meme', 'news', 'analysis'],
                    'target_audience': ['beginners', 'experts', 'traders', 'builders', 'general']
                }
                
                for field, valid_values in categorical_fields.items():
                    value = parsed_analysis.get(field, valid_values[0])
                    if isinstance(value, str) and value.lower() in [v.lower() for v in valid_values]:
                        llm_features[f'llm_{field}'] = value.lower()
                    else:
                        llm_features[f'llm_{field}'] = valid_values[0]
                
                # Add metadata
                llm_features['llm_provider'] = provider
                llm_features['raw_llm_response'] = analysis_text[:1000]  # Truncate for storage
                
                logger.info(f"✅ LLM analysis completed with {provider}")
                return llm_features
                
            except json.JSONDecodeError as e:
                logger.warning(f"⚠️ Could not parse LLM JSON: {e}")
                logger.debug(f"Raw response: {analysis_text[:200]}...")
                return self._get_default_llm_features()
                
        except Exception as e:
            logger.error(f"❌ LLM analysis failed: {str(e)}")
            return self._get_default_llm_features()
    
    def _get_default_llm_features(self) -> Dict[str, Any]:
        """Return default LLM features when analysis fails"""
        return {
            'llm_content_quality': 5.0,
            'llm_viral_potential': 3.0,
            'llm_engagement_potential': 4.0,
            'llm_originality': 5.0,
            'llm_clarity': 5.0,
            'llm_emotional_impact': 4.0,
            'llm_call_to_action_strength': 3.0,
            'llm_trending_relevance': 4.0,
            'llm_technical_depth': 3.0,
            'llm_humor_level': 2.0,
            'llm_controversy_level': 2.0,
            'llm_crypto_relevance': 3.0,
            'llm_predicted_snap_impact': 4.0,
            'llm_predicted_position_impact': 4.0,
            'llm_predicted_twitter_engagement': 4.0,
            'llm_category_classification': 'other',
            'llm_sentiment_classification': 'neutral',
            'llm_content_type': 'personal',
            'llm_target_audience': 'general',
            'llm_provider': 'fallback',
            'raw_llm_response': 'Analysis failed, using defaults'
        }
    
    def _get_fallback_features(self, content_text: str) -> Dict[str, Any]:
        """Return basic features when everything fails"""
        basic = self._extract_basic_features(content_text)
        crypto = self._extract_crypto_features(content_text)
        temporal = self._extract_temporal_features()
        llm = self._get_default_llm_features()
        
        return {**basic, **crypto, **temporal, **llm}
    
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
    
    async def analyze_for_snap_prediction(self, content_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Specialized analysis for SNAP delta prediction"""
        analysis = await self.analyze_content_for_training(content_text, context)
        
        if analysis['success']:
            # Add SNAP-specific context
            features = analysis['features']
            features['platform_focus'] = 'snap_prediction'
            features['predicted_snap_category'] = features.get('llm_category_classification', 'other')
            
        return analysis
    
    async def analyze_for_position_prediction(self, content_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Specialized analysis for position change prediction"""
        analysis = await self.analyze_content_for_training(content_text, context)
        
        if analysis['success']:
            # Add position-specific context
            features = analysis['features']
            features['platform_focus'] = 'position_prediction'
            features['competition_factor'] = context.get('competition_level', 50)
            
        return analysis
