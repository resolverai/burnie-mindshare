"""
Advanced ML Models for Attention Economy Platforms

Implements the missing models:
1. Category Intelligence Model
2. Twitter Engagement Prediction Model  
3. ML-based ROI Calculator
"""

import asyncio
import json
import logging
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import asyncpg
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, mean_absolute_error, accuracy_score, classification_report
from sklearn.linear_model import LinearRegression, Ridge
import joblib

from app.config.settings import settings
from app.services.enhanced_feature_extractor import EnhancedFeatureExtractor
from app.services.llm_providers import MultiProviderLLMService

logger = logging.getLogger(__name__)

class CategoryIntelligenceModel:
    """
    Category Intelligence Model for content optimization
    
    Provides category-specific insights and optimization recommendations
    based on successful leaderboard yapper patterns
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.feature_extractor = EnhancedFeatureExtractor()
        self.llm_service = MultiProviderLLMService(
            primary_provider=settings.default_llm_provider or 'anthropic',
            fallback_provider=settings.fallback_llm_provider or 'openai'
        )
        self.models = {}
        self.scalers = {}
        self.category_patterns = {}
    
    async def analyze_category_patterns(self, category: str, platform: str = None) -> Dict[str, Any]:
        """
        Analyze success patterns for a specific category
        
        Args:
            category: Content category (gaming, defi, nft, meme, etc.)
            platform: Platform source (defaults to self.platform)
            
        Returns:
            Category intelligence analysis
        """
        try:
            platform = platform or self.platform
            logger.info(f"🎯 Analyzing category patterns for {category} on {platform}")
            
            # Get successful content from leaderboard yappers in this category
            successful_content = await self._get_category_success_patterns(category, platform)
            
            if not successful_content:
                return {
                    'success': False,
                    'error': f'No successful content found for category {category}'
                }
            
            # Analyze patterns using LLM
            pattern_analysis = await self._analyze_patterns_with_llm(successful_content, category)
            
            # Extract quantitative patterns
            quantitative_patterns = await self._extract_quantitative_patterns(successful_content)
            
            # Generate optimization recommendations
            recommendations = await self._generate_category_recommendations(
                pattern_analysis, quantitative_patterns, category
            )
            
            return {
                'success': True,
                'category': category,
                'platform': platform,
                'pattern_analysis': pattern_analysis,
                'quantitative_patterns': quantitative_patterns,
                'recommendations': recommendations,
                'sample_size': len(successful_content),
                'analysis_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Category analysis failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_category_success(self, content_text: str, category: str) -> Dict[str, Any]:
        """
        Predict content success within a specific category
        
        Args:
            content_text: Content to analyze
            category: Target category
            
        Returns:
            Success prediction and optimization suggestions
        """
        try:
            # Extract content features
            feature_result = await self.feature_extractor.extract_comprehensive_features(
                content_text=content_text,
                campaign_context={'category': category, 'platform': self.platform}
            )
            
            if not feature_result['success']:
                return {'success': False, 'error': 'Feature extraction failed'}
            
            # Get category patterns
            category_analysis = await self.analyze_category_patterns(category)
            
            if not category_analysis['success']:
                return {'success': False, 'error': 'Category analysis failed'}
            
            # Calculate category-specific success score
            success_score = await self._calculate_category_success_score(
                feature_result['features'], category_analysis
            )
            
            # Generate specific recommendations
            optimization_suggestions = await self._generate_content_optimization(
                content_text, category, success_score, category_analysis
            )
            
            return {
                'success': True,
                'category': category,
                'success_score': success_score,
                'confidence': min(100, success_score * 10),  # Convert to percentage
                'optimization_suggestions': optimization_suggestions,
                'category_insights': category_analysis['recommendations'],
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Category success prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _get_category_success_patterns(self, category: str, platform: str) -> List[Dict]:
        """Get successful content patterns for a category"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Query for successful content in category
            query = """
            SELECT 
                lyd."twitterHandle",
                lyd."leaderboardPosition",
                lyd."totalSnaps",
                lyd."recentTweets",
                lyd."anthropic_analysis",
                lyd."tweetImageUrls",
                ycp."mindsharePercent",
                ycp."smartEngagement"
            FROM leaderboard_yapper_data lyd
            LEFT JOIN yapper_cookie_profile ycp ON lyd."twitterHandle" = ycp."twitterHandle"
            WHERE lyd."platformSource" = $1 
                AND lyd."leaderboardPosition" <= 50
                AND lyd."twitterFetchStatus" = 'completed'
                AND (lyd."anthropic_analysis" IS NOT NULL OR lyd."openai_analysis" IS NOT NULL)
            ORDER BY lyd."leaderboardPosition" ASC
            LIMIT 100
            """
            
            records = await conn.fetch(query, platform)
            await conn.close()
            
            # Filter by category using LLM analysis
            category_content = []
            for record in records:
                analysis = record['anthropic_analysis'] or {}
                
                # Check if content matches category
                if await self._content_matches_category(record, category):
                    category_content.append(dict(record))
            
            return category_content
            
        except Exception as e:
            logger.error(f"❌ Failed to get category patterns: {str(e)}")
            return []
    
    async def _content_matches_category(self, record: Dict, target_category: str) -> bool:
        """Check if content matches target category"""
        try:
            # Extract text from recent tweets
            tweets = record.get('recentTweets', [])
            if not tweets:
                return False
            
            # Get sample of tweet texts
            tweet_texts = [tweet.get('text', '') for tweet in tweets[:5] if tweet.get('text')]
            combined_text = ' '.join(tweet_texts)[:500]  # Limit text length
            
            if not combined_text.strip():
                return False
            
            # Use LLM to classify category
            classification_prompt = f"""
            Classify this content into one of these categories: gaming, defi, nft, meme, education, trading, social, other
            
            Content: "{combined_text}"
            
            Return only the category name (lowercase):
            """
            
            result = await self.llm_service.analyze_text_content(classification_prompt)
            
            if isinstance(result, dict) and result.get('success'):
                predicted_category = result.get('content', '').strip().lower()
            else:
                predicted_category = str(result).strip().lower() if result else ''
            
            return predicted_category == target_category.lower()
            
        except Exception as e:
            logger.error(f"❌ Category matching failed: {str(e)}")
            return False
    
    async def _analyze_patterns_with_llm(self, successful_content: List[Dict], category: str) -> Dict[str, Any]:
        """Analyze success patterns using LLM"""
        try:
            if not successful_content:
                return {}
            
            # Extract key data for analysis
            analysis_data = []
            for content in successful_content[:10]:  # Limit to top 10
                tweets = content.get('recentTweets', [])
                if tweets:
                    sample_tweets = [tweet.get('text', '') for tweet in tweets[:3]]
                    analysis_data.append({
                        'position': content.get('leaderboardPosition'),
                        'snaps': content.get('totalSnaps'),
                        'tweets': sample_tweets
                    })
            
            # Create analysis prompt
            prompt = f"""
            Analyze these successful {category} content patterns from top-performing yappers:
            
            {json.dumps(analysis_data, indent=2)}
            
            Provide analysis in JSON format:
            {{
                "common_themes": ["theme1", "theme2"],
                "successful_elements": ["element1", "element2"],
                "content_styles": ["style1", "style2"],
                "engagement_triggers": ["trigger1", "trigger2"],
                "timing_patterns": "description",
                "language_patterns": "description",
                "success_factors": ["factor1", "factor2"]
            }}
            """
            
            result = await self.llm_service.analyze_text_content(prompt)
            
            if isinstance(result, dict) and result.get('success'):
                analysis_text = result.get('content', '{}')
            else:
                analysis_text = result if isinstance(result, str) else '{}'
            
            try:
                return json.loads(self._clean_json_response(analysis_text))
            except:
                logger.warning("⚠️ Could not parse LLM pattern analysis")
                return {}
                
        except Exception as e:
            logger.error(f"❌ LLM pattern analysis failed: {str(e)}")
            return {}
    
    async def _extract_quantitative_patterns(self, successful_content: List[Dict]) -> Dict[str, Any]:
        """Extract quantitative patterns from successful content"""
        try:
            if not successful_content:
                return {}
            
            # Aggregate metrics
            positions = [c.get('leaderboardPosition', 100) for c in successful_content]
            snaps = [float(c.get('totalSnaps', 0)) for c in successful_content if c.get('totalSnaps')]
            mindshare = [float(c.get('mindsharePercent', 0)) for c in successful_content if c.get('mindsharePercent')]
            
            # Tweet analysis
            tweet_lengths = []
            hashtag_counts = []
            mention_counts = []
            
            for content in successful_content:
                tweets = content.get('recentTweets', [])
                for tweet in tweets:
                    if tweet.get('text'):
                        text = tweet['text']
                        tweet_lengths.append(len(text))
                        hashtag_counts.append(len([word for word in text.split() if word.startswith('#')]))
                        mention_counts.append(len([word for word in text.split() if word.startswith('@')]))
            
            return {
                'avg_position': float(np.mean(positions)) if positions else 100,
                'avg_snaps': float(np.mean(snaps)) if snaps else 0,
                'avg_mindshare': float(np.mean(mindshare)) if mindshare else 0,
                'avg_tweet_length': float(np.mean(tweet_lengths)) if tweet_lengths else 0,
                'avg_hashtags': float(np.mean(hashtag_counts)) if hashtag_counts else 0,
                'avg_mentions': float(np.mean(mention_counts)) if mention_counts else 0,
                'sample_size': len(successful_content),
                'top_position': float(min(positions)) if positions else 100,
                'max_snaps': float(max(snaps)) if snaps else 0
            }
            
        except Exception as e:
            logger.error(f"❌ Quantitative pattern extraction failed: {str(e)}")
            return {}
    
    async def _generate_category_recommendations(
        self, 
        pattern_analysis: Dict, 
        quantitative_patterns: Dict, 
        category: str
    ) -> Dict[str, Any]:
        """Generate optimization recommendations for category"""
        try:
            prompt = f"""
            Based on this analysis of successful {category} content, generate specific optimization recommendations:
            
            Pattern Analysis: {json.dumps(pattern_analysis)}
            Quantitative Patterns: {json.dumps(quantitative_patterns)}
            
            Provide actionable recommendations in JSON format:
            {{
                "content_strategy": "specific strategy advice",
                "optimal_length": "recommended text length",
                "hashtag_strategy": "hashtag recommendations",
                "timing_advice": "when to post",
                "engagement_tactics": ["tactic1", "tactic2"],
                "avoid_patterns": ["what to avoid"],
                "success_multipliers": ["proven success elements"]
            }}
            """
            
            result = await self.llm_service.analyze_text_content(prompt)
            
            if isinstance(result, dict) and result.get('success'):
                recommendations_text = result.get('content', '{}')
            else:
                recommendations_text = result if isinstance(result, str) else '{}'
            
            try:
                return json.loads(self._clean_json_response(recommendations_text))
            except:
                return {"content_strategy": "Focus on proven themes and engagement patterns from successful yappers"}
                
        except Exception as e:
            logger.error(f"❌ Recommendation generation failed: {str(e)}")
            return {}
    
    async def _calculate_category_success_score(
        self, 
        content_features: Dict, 
        category_analysis: Dict
    ) -> float:
        """Calculate success score for content within category"""
        try:
            # Base score from content quality
            base_score = content_features.get('llm_content_quality', 5.0) / 10.0
            
            # Adjust based on category patterns
            quantitative = category_analysis.get('quantitative_patterns', {})
            
            # Length optimization
            content_length = content_features.get('char_length', 0)
            optimal_length = quantitative.get('avg_tweet_length', 150)
            length_score = 1.0 - min(1.0, abs(content_length - optimal_length) / optimal_length)
            
            # Hashtag optimization  
            hashtag_count = content_features.get('hashtag_count', 0)
            optimal_hashtags = quantitative.get('avg_hashtags', 2)
            hashtag_score = 1.0 - min(1.0, abs(hashtag_count - optimal_hashtags) / max(1, optimal_hashtags))
            
            # Combine scores
            final_score = (
                base_score * 0.5 +
                length_score * 0.2 +
                hashtag_score * 0.2 +
                content_features.get('llm_viral_potential', 5.0) / 10.0 * 0.1
            )
            
            return min(10.0, max(0.0, final_score * 10))
            
        except Exception as e:
            logger.error(f"❌ Success score calculation failed: {str(e)}")
            return 5.0
    
    async def _generate_content_optimization(
        self, 
        content_text: str, 
        category: str, 
        success_score: float, 
        category_analysis: Dict
    ) -> Dict[str, Any]:
        """Generate specific optimization suggestions for content"""
        try:
            prompt = f"""
            Optimize this {category} content based on successful patterns:
            
            Current Content: "{content_text}"
            Success Score: {success_score}/10
            
            Successful Patterns: {json.dumps(category_analysis.get('recommendations', {}))}
            
            Provide specific optimization suggestions in JSON format:
            {{
                "strength_score": {success_score},
                "weaknesses": ["weakness1", "weakness2"],
                "specific_improvements": ["improvement1", "improvement2"],
                "suggested_edits": "specific text suggestions",
                "hashtag_suggestions": ["#tag1", "#tag2"],
                "timing_recommendation": "best time to post",
                "potential_impact": "expected improvement"
            }}
            """
            
            result = await self.llm_service.analyze_text_content(prompt)
            
            if isinstance(result, dict) and result.get('success'):
                optimization_text = result.get('content', '{}')
            else:
                optimization_text = result if isinstance(result, str) else '{}'
            
            try:
                return json.loads(self._clean_json_response(optimization_text))
            except:
                return {
                    "strength_score": success_score,
                    "specific_improvements": ["Incorporate successful themes from top performers"],
                    "timing_recommendation": "Post during peak engagement hours"
                }
                
        except Exception as e:
            logger.error(f"❌ Content optimization failed: {str(e)}")
            return {}
    
    def _clean_json_response(self, response: str) -> str:
        """Clean LLM response to extract JSON"""
        response = response.replace('```json', '').replace('```', '')
        start = response.find('{')
        end = response.rfind('}') + 1
        if start != -1 and end != 0:
            return response[start:end]
        return response.strip()


class TwitterEngagementMLModel:
    """
    ML Model for predicting Twitter engagement
    
    Uses historical Twitter data to predict likes, retweets, replies
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.feature_extractor = EnhancedFeatureExtractor()
        self.models = {
            'likes_predictor': None,
            'retweets_predictor': None,
            'replies_predictor': None,
            'total_engagement_predictor': None
        }
        self.scalers = {}
        self.is_trained = False
    
    async def train_engagement_models(self) -> Dict[str, Any]:
        """
        Train engagement prediction models using available Twitter data
        """
        try:
            logger.info(f"🎯 Training Twitter engagement models for {self.platform}")
            
            # Load training data
            training_data = await self._load_engagement_training_data()
            
            if len(training_data) < 50:
                return {
                    'success': False,
                    'error': f'Insufficient training data: {len(training_data)} samples (need at least 50)'
                }
            
            # Prepare features and targets
            feature_result = await self._prepare_engagement_features(training_data)
            
            if not feature_result['success']:
                return feature_result
            
            X = feature_result['features']
            engagement_targets = feature_result['targets']
            
            # Train individual models
            model_results = {}
            
            for engagement_type, y in engagement_targets.items():
                if len(y) == 0:
                    continue
                    
                # Split data
                X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
                
                # Scale features
                scaler = StandardScaler()
                X_train_scaled = scaler.fit_transform(X_train)
                X_test_scaled = scaler.transform(X_test)
                
                # Train Random Forest model
                model = RandomForestRegressor(
                    n_estimators=100,
                    max_depth=10,
                    min_samples_split=5,
                    random_state=42,
                    n_jobs=-1
                )
                
                model.fit(X_train_scaled, y_train)
                
                # Evaluate
                y_pred = model.predict(X_test_scaled)
                mse = mean_squared_error(y_test, y_pred)
                mae = mean_absolute_error(y_test, y_pred)
                
                # Store model and scaler
                self.models[f'{engagement_type}_predictor'] = model
                self.scalers[f'{engagement_type}_predictor'] = scaler
                
                model_results[engagement_type] = {
                    'mse': float(mse),
                    'mae': float(mae),
                    'rmse': float(np.sqrt(mse)),
                    'feature_importance': dict(zip(
                        feature_result['feature_names'], 
                        model.feature_importances_
                    ))
                }
            
            self.is_trained = True
            
            return {
                'success': True,
                'models_trained': list(model_results.keys()),
                'training_samples': len(training_data),
                'feature_count': X.shape[1],
                'model_performance': model_results,
                'training_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Engagement model training failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_engagement(
        self, 
        content_text: str, 
        yapper_id: Optional[int] = None, 
        twitter_handle: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Predict engagement metrics for content
        """
        try:
            if not self.is_trained:
                # Try to train models if not already trained
                training_result = await self.train_engagement_models()
                if not training_result['success']:
                    return training_result
            
            # Extract features
            feature_result = await self.feature_extractor.extract_comprehensive_features(
                yapper_id=yapper_id,
                twitter_handle=twitter_handle,
                content_text=content_text,
                platform=self.platform
            )
            
            if not feature_result['success']:
                return {'success': False, 'error': 'Feature extraction failed'}
            
            # Prepare features for prediction
            features = feature_result['features']
            feature_vector = np.array(list(features.values())).reshape(1, -1)
            
            # Make predictions
            predictions = {}
            
            for engagement_type in ['likes', 'retweets', 'replies', 'total_engagement']:
                model_key = f'{engagement_type}_predictor'
                
                if model_key in self.models and self.models[model_key] is not None:
                    # Scale features
                    scaler = self.scalers[model_key]
                    features_scaled = scaler.transform(feature_vector)
                    
                    # Predict
                    prediction = self.models[model_key].predict(features_scaled)[0]
                    predictions[engagement_type] = max(0, float(prediction))  # Ensure non-negative
            
            # Calculate engagement rate
            follower_count = features.get('twitter_followers_count', 1000)
            total_engagement = predictions.get('total_engagement', 0)
            engagement_rate = (total_engagement / follower_count * 100) if follower_count > 0 else 0
            
            return {
                'success': True,
                'predictions': predictions,
                'engagement_rate': engagement_rate,
                'confidence': 'medium',  # Could be calculated based on feature quality
                'feature_count': len(features),
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Engagement prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _load_engagement_training_data(self) -> List[Dict]:
        """Load training data for engagement prediction"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Query for Twitter data with engagement metrics
            query = """
            SELECT 
                lyd."twitterHandle",
                lyd."recentTweets",
                lyd."followersCount",
                lyd."followingCount",
                lyd."tweetsCount",
                lyd."anthropic_analysis",
                pytp.engagement_rate,
                pytp.content_style_analysis,
                pytp.performance_patterns
            FROM leaderboard_yapper_data lyd
            LEFT JOIN platform_yapper_twitter_profiles pytp ON lyd."twitterHandle" = pytp.twitter_handle
            WHERE lyd."platformSource" = $1 
                AND lyd."recentTweets" IS NOT NULL
                AND lyd."twitterFetchStatus" = 'completed'
            ORDER BY lyd."snapshotDate" DESC
            LIMIT 500
            """
            
            records = await conn.fetch(query, self.platform)
            await conn.close()
            
            # Process records and parse JSON fields
            processed_records = []
            for record in records:
                record_dict = dict(record)
                
                # Parse recentTweets if it's a string
                if record_dict.get('recentTweets'):
                    if isinstance(record_dict['recentTweets'], str):
                        try:
                            import json
                            record_dict['recentTweets'] = json.loads(record_dict['recentTweets'])
                        except json.JSONDecodeError:
                            logger.warning(f"⚠️ Could not parse recentTweets for {record_dict.get('twitterHandle')}")
                            record_dict['recentTweets'] = []
                
                processed_records.append(record_dict)
            
            return processed_records
            
        except Exception as e:
            logger.error(f"❌ Failed to load engagement training data: {str(e)}")
            return []
    
    async def _prepare_engagement_features(self, training_data: List[Dict]) -> Dict[str, Any]:
        """Prepare features and targets for engagement prediction"""
        try:
            all_features = []
            engagement_targets = {'likes': [], 'retweets': [], 'replies': [], 'total_engagement': []}
            
            for record in training_data:
                tweets = record.get('recentTweets', [])
                if not tweets:
                    continue
                
                # Process each tweet
                for tweet in tweets[:5]:  # Limit to recent tweets
                    if not tweet.get('text'):
                        continue
                    
                    # Debug: Check tweet structure
                    tweet_text = tweet.get('text')
                    logger.debug(f"Tweet text type: {type(tweet_text)}, value: {tweet_text}")
                    
                    # Ensure tweet text is a string
                    if not isinstance(tweet_text, str):
                        logger.warning(f"⚠️ Tweet text is not a string: {type(tweet_text)}, converting...")
                        tweet_text = str(tweet_text) if tweet_text else ""
                    
                    # Extract features for this tweet
                    try:
                        # Use comprehensive feature extraction with better error handling
                        feature_result = await self.feature_extractor.extract_comprehensive_features(
                            twitter_handle=record.get('twitterHandle'),
                            content_text=tweet_text,
                            platform=self.platform
                        )
                        
                        # Fallback to simple features if comprehensive fails
                        if not feature_result.get('success'):
                            logger.warning(f"⚠️ Comprehensive feature extraction failed, using simple features")
                            feature_result = await self._extract_simple_tweet_features(
                                tweet_text,
                                record.get('twitterHandle'),
                                record
                            )
                    except Exception as e:
                        logger.warning(f"⚠️ Feature extraction failed for tweet: {e}")
                        continue
                    
                    if not feature_result['success']:
                        continue
                    
                    features = feature_result['features']
                    
                    # Add yapper-specific features
                    features.update({
                        'yapper_followers': float(record.get('followersCount', 0) or 0),
                        'yapper_following': float(record.get('followingCount', 0) or 0),
                        'yapper_tweets': float(record.get('tweetsCount', 0) or 0),
                        'yapper_engagement_rate': float(record.get('engagement_rate', 0) or 0)
                    })
                    
                    all_features.append(features)
                    
                    # Extract engagement targets
                    likes = tweet.get('likes', 0) or 0
                    retweets = tweet.get('retweets', 0) or 0
                    replies = tweet.get('replies', 0) or 0
                    total = likes + retweets + replies
                    
                    engagement_targets['likes'].append(float(likes))
                    engagement_targets['retweets'].append(float(retweets))
                    engagement_targets['replies'].append(float(replies))
                    engagement_targets['total_engagement'].append(float(total))
            
            if not all_features:
                return {'success': False, 'error': 'No valid features extracted'}
            
            # Convert to DataFrame for easier handling
            df = pd.DataFrame(all_features)
            
            # Fill missing values
            df = df.fillna(0)
            
            # Get feature names
            feature_names = list(df.columns)
            
            # Convert to numpy arrays
            X = df.values
            
            return {
                'success': True,
                'features': X,
                'targets': engagement_targets,
                'feature_names': feature_names
            }
            
        except Exception as e:
            logger.error(f"❌ Feature preparation failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _extract_simple_tweet_features(self, tweet_text: str, twitter_handle: str, record: Dict) -> Dict[str, Any]:
        """Extract simple features without LLM (for testing)"""
        try:
            from textblob import TextBlob
            import re
            
            # Ensure tweet_text is a string
            if not isinstance(tweet_text, str):
                logger.warning(f"⚠️ Tweet text is not a string: {type(tweet_text)}, converting...")
                tweet_text = str(tweet_text) if tweet_text else ""
            
            blob = TextBlob(tweet_text)
            
            # Basic text features
            features = {
                'char_length': float(len(tweet_text)),
                'word_count': float(len(blob.words)),
                'sentence_count': float(len(blob.sentences)),
                'sentiment_polarity': float(blob.sentiment.polarity),
                'sentiment_subjectivity': float(blob.sentiment.subjectivity),
                'hashtag_count': float(len(re.findall(r'#\w+', tweet_text))),
                'mention_count': float(len(re.findall(r'@\w+', tweet_text))),
                'question_count': float(tweet_text.count('?')),
                'exclamation_count': float(tweet_text.count('!')),
                'uppercase_ratio': float(sum(1 for c in tweet_text if c.isupper()) / len(tweet_text) if tweet_text else 0),
                
                # Yapper features
                'yapper_followers': float(record.get('followersCount', 0) or 0),
                'yapper_following': float(record.get('followingCount', 0) or 0),
                'yapper_tweets': float(record.get('tweetsCount', 0) or 0),
                'yapper_engagement_rate': float(record.get('engagement_rate', 0) or 0),
                
                # Crypto features
                'has_crypto_keywords': float(1 if any(kw in tweet_text.lower() for kw in ['crypto', 'bitcoin', 'eth', 'defi', 'nft']) else 0),
                'has_trading_keywords': float(1 if any(kw in tweet_text.lower() for kw in ['pump', 'moon', 'bull', 'bear']) else 0),
            }
            
            return {'success': True, 'features': features}
            
        except Exception as e:
            logger.error(f"❌ Simple feature extraction failed: {str(e)}")
            return {'success': False, 'error': str(e)}


class MLROICalculator:
    """
    ML-based ROI Calculator
    
    Predicts ROI using machine learning instead of simple formulas
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.feature_extractor = EnhancedFeatureExtractor()
        self.snap_predictor = None
        self.position_predictor = None
        self.roi_model = None
        self.roi_scaler = None
        self.is_trained = False
    
    async def train_roi_model(self) -> Dict[str, Any]:
        """
        Train ML-based ROI prediction model
        """
        try:
            logger.info(f"🎯 Training ML-based ROI model for {self.platform}")
            
            # Load historical content performance data
            training_data = await self._load_roi_training_data()
            
            if len(training_data) < 30:
                return {
                    'success': False,
                    'error': f'Insufficient ROI training data: {len(training_data)} samples (need at least 30)'
                }
            
            # Prepare features and targets
            feature_result = await self._prepare_roi_features(training_data)
            
            if not feature_result['success']:
                return feature_result
            
            X = feature_result['features']
            y = feature_result['roi_targets']
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train ROI model
            roi_model = RandomForestRegressor(
                n_estimators=100,
                max_depth=8,
                min_samples_split=3,
                random_state=42,
                n_jobs=-1
            )
            
            roi_model.fit(X_train_scaled, y_train)
            
            # Evaluate
            y_pred = roi_model.predict(X_test_scaled)
            mse = mean_squared_error(y_test, y_pred)
            mae = mean_absolute_error(y_test, y_pred)
            
            # Store model
            self.roi_model = roi_model
            self.roi_scaler = scaler
            self.is_trained = True
            
            return {
                'success': True,
                'training_samples': len(training_data),
                'feature_count': X.shape[1],
                'performance': {
                    'mse': float(mse),
                    'mae': float(mae),
                    'rmse': float(np.sqrt(mse))
                },
                'feature_importance': dict(zip(
                    feature_result['feature_names'], 
                    roi_model.feature_importances_
                )),
                'training_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ ROI model training failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_roi(
        self, 
        content_text: str, 
        content_cost: float,
        yapper_id: Optional[int] = None,
        twitter_handle: Optional[str] = None,
        campaign_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Predict ROI using ML model
        """
        try:
            if not self.is_trained:
                # Try to train model if not already trained
                training_result = await self.train_roi_model()
                if not training_result['success']:
                    # Fall back to formula-based calculation
                    return await self._fallback_roi_calculation(
                        content_text, content_cost, yapper_id, twitter_handle, campaign_context
                    )
            
            # Extract features
            feature_result = await self.feature_extractor.extract_comprehensive_features(
                yapper_id=yapper_id,
                twitter_handle=twitter_handle,
                content_text=content_text,
                campaign_context=campaign_context,
                platform=self.platform
            )
            
            if not feature_result['success']:
                return {'success': False, 'error': 'Feature extraction failed'}
            
            # Add cost as feature
            features = feature_result['features']
            features['content_cost'] = float(content_cost)
            
            # Prepare feature vector
            feature_vector = np.array(list(features.values())).reshape(1, -1)
            
            # Scale features
            features_scaled = self.roi_scaler.transform(feature_vector)
            
            # Predict ROI
            roi_prediction = self.roi_model.predict(features_scaled)[0]
            
            # Calculate confidence interval (simplified)
            roi_std = roi_prediction * 0.3  # 30% standard deviation
            confidence_interval = {
                'lower': roi_prediction - roi_std,
                'upper': roi_prediction + roi_std,
                'std': roi_std
            }
            
            # Calculate related metrics
            break_even_probability = min(100, max(0, (roi_prediction + 100) / 200 * 100))
            
            return {
                'success': True,
                'roi_prediction': float(roi_prediction),
                'confidence_interval': confidence_interval,
                'break_even_probability': break_even_probability,
                'content_cost': content_cost,
                'expected_profit': content_cost * (roi_prediction / 100),
                'prediction_method': 'ml_model',
                'feature_count': len(features),
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ ML ROI prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _load_roi_training_data(self) -> List[Dict]:
        """Load historical ROI data for training"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Query for content performance tracking data
            query = """
            SELECT 
                cpt.content_text,
                cpt.snap_earned,
                cpt.roi_actual,
                cpt.yapper_id,
                pytp.twitter_handle,
                pytp.followers_count,
                pytp.engagement_rate,
                c.reward_pool,
                c.category
            FROM content_performance_tracking cpt
            LEFT JOIN platform_yapper_twitter_profiles pytp ON cpt.yapper_id = pytp.yapper_id
            LEFT JOIN campaigns c ON cpt.campaign_id = c.id
            WHERE cpt.platform_source = $1 
                AND cpt.roi_actual IS NOT NULL
                AND cpt.content_text IS NOT NULL
            ORDER BY cpt.created_at DESC
            LIMIT 200
            """
            
            records = await conn.fetch(query, self.platform)
            await conn.close()
            
            return [dict(record) for record in records]
            
        except Exception as e:
            logger.error(f"❌ Failed to load ROI training data: {str(e)}")
            return []
    
    async def _prepare_roi_features(self, training_data: List[Dict]) -> Dict[str, Any]:
        """Prepare features and targets for ROI prediction"""
        try:
            all_features = []
            roi_targets = []
            
            for record in training_data:
                content_text = record.get('content_text', '')
                roi_actual = record.get('roi_actual')
                
                if not content_text or roi_actual is None:
                    continue
                
                # Extract features
                feature_result = await self.feature_extractor.extract_comprehensive_features(
                    twitter_handle=record.get('twitter_handle'),
                    content_text=content_text,
                    campaign_context={
                        'reward_pool': record.get('reward_pool', 10000),
                        'category': record.get('category', 'other'),
                        'platform': self.platform
                    },
                    platform=self.platform
                )
                
                if not feature_result['success']:
                    continue
                
                features = feature_result['features']
                
                # Add performance features
                features.update({
                    'snap_earned': float(record.get('snap_earned', 0) or 0),
                    'yapper_followers': float(record.get('followers_count', 0) or 0),
                    'yapper_engagement_rate': float(record.get('engagement_rate', 0) or 0),
                    'campaign_reward_pool': float(record.get('reward_pool', 10000) or 10000)
                })
                
                all_features.append(features)
                roi_targets.append(float(roi_actual))
            
            if not all_features:
                return {'success': False, 'error': 'No valid ROI training data'}
            
            # Convert to DataFrame
            df = pd.DataFrame(all_features)
            df = df.fillna(0)
            
            feature_names = list(df.columns)
            X = df.values
            y = np.array(roi_targets)
            
            return {
                'success': True,
                'features': X,
                'roi_targets': y,
                'feature_names': feature_names
            }
            
        except Exception as e:
            logger.error(f"❌ ROI feature preparation failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _fallback_roi_calculation(
        self, 
        content_text: str, 
        content_cost: float,
        yapper_id: Optional[int] = None,
        twitter_handle: Optional[str] = None,
        campaign_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Fallback to formula-based ROI calculation"""
        try:
            # Simple formula-based ROI calculation
            # This would use the existing ML framework for SNAP prediction
            from app.services.ml_model_framework import MLModelFramework
            
            ml_framework = MLModelFramework(platform=self.platform)
            
            # Get features
            feature_result = await self.feature_extractor.extract_comprehensive_features(
                yapper_id=yapper_id,
                twitter_handle=twitter_handle,
                content_text=content_text,
                campaign_context=campaign_context,
                platform=self.platform
            )
            
            if not feature_result['success']:
                return {'success': False, 'error': 'Feature extraction failed'}
            
            # Predict SNAP
            snap_result = await ml_framework.predict_snap(feature_result['features'])
            
            if not snap_result['success']:
                return {'success': False, 'error': 'SNAP prediction failed'}
            
            predicted_snap = snap_result['prediction']
            
            # Estimate position and rewards (simplified)
            campaign_avg_snap = campaign_context.get('average_snap', 150) if campaign_context else 150
            position_estimate = max(1, min(100, int(100 * (campaign_avg_snap / predicted_snap))))
            
            # Estimate rewards based on position (simplified tier system)
            reward_pool = campaign_context.get('reward_pool', 10000) if campaign_context else 10000
            
            if position_estimate <= 5:
                reward_percentage = 0.4  # Top 5 get 40% of pool
            elif position_estimate <= 10:
                reward_percentage = 0.3  # Next 5 get 30% of pool
            elif position_estimate <= 25:
                reward_percentage = 0.2  # Next 15 get 20% of pool
            else:
                reward_percentage = 0.1  # Rest get 10% of pool
            
            estimated_reward = (reward_pool * reward_percentage) / min(position_estimate, 25)
            roi_percentage = ((estimated_reward - content_cost) / content_cost) * 100
            
            return {
                'success': True,
                'roi_prediction': float(roi_percentage),
                'confidence_interval': {
                    'lower': roi_percentage * 0.6,
                    'upper': roi_percentage * 1.4,
                    'std': roi_percentage * 0.2
                },
                'break_even_probability': min(100, max(0, (roi_percentage + 100) / 200 * 100)),
                'content_cost': content_cost,
                'expected_profit': content_cost * (roi_percentage / 100),
                'prediction_method': 'formula_based_fallback',
                'snap_prediction': predicted_snap,
                'position_estimate': position_estimate,
                'estimated_reward': estimated_reward,
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Fallback ROI calculation failed: {str(e)}")
            return {'success': False, 'error': str(e)}
