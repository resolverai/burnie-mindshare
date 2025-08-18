"""
Twitter Engagement Prediction Model

Predicts Twitter engagement (likes, retweets, replies) using ONLY pre-computed features.
NO real-time LLM calls for predictions.
"""

import asyncio
import logging
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import asyncpg
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.linear_model import LinearRegression, Ridge
import joblib

from app.config.settings import settings

logger = logging.getLogger(__name__)

class TwitterEngagementMLModel:
    """
    Predicts Twitter engagement using ONLY pre-computed LLM features
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.models = {}
        self.scalers = {}
        self.label_encoders = {}
        self.is_trained = False
        
        # Ensemble for engagement prediction
        self.algorithms = {
            'random_forest': RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42),
            'gradient_boosting': GradientBoostingRegressor(n_estimators=100, random_state=42),
            'linear_regression': LinearRegression(),
            'ridge_regression': Ridge(alpha=1.0)
        }
    
    async def train_engagement_models(self) -> Dict[str, Any]:
        """Train ensemble models for Twitter engagement prediction"""
        try:
            logger.info(f"🎯 Training Twitter Engagement models for {self.platform}")
            
            # Load training data from new dedicated table
            training_data = await self._load_engagement_training_data()
            
            if len(training_data) < 25:
                return {
                    'success': False,
                    'error': f'Insufficient training data: {len(training_data)} samples (need at least 25)'
                }
            
            # Prepare features and targets
            X, y, feature_names = await self._prepare_engagement_features(training_data)
            
            if len(X) == 0:
                return {'success': False, 'error': 'No valid features extracted'}
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train ensemble models
            ensemble_models = {}
            ensemble_metrics = {}
            
            for name, algorithm in self.algorithms.items():
                try:
                    logger.info(f"🔄 Training {name} for engagement prediction")
                    
                    # Train model
                    model = algorithm
                    model.fit(X_train_scaled, y_train)
                    
                    # Evaluate
                    y_pred = model.predict(X_test_scaled)
                    
                    metrics = {
                        'mse': mean_squared_error(y_test, y_pred),
                        'rmse': np.sqrt(mean_squared_error(y_test, y_pred)),
                        'mae': mean_absolute_error(y_test, y_pred),
                        'r2': r2_score(y_test, y_pred)
                    }
                    
                    # Cross-validation
                    cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5, scoring='neg_mean_squared_error')
                    metrics['cv_rmse'] = np.sqrt(-cv_scores.mean())
                    metrics['cv_std'] = cv_scores.std()
                    
                    ensemble_models[name] = model
                    ensemble_metrics[name] = metrics
                    
                    logger.info(f"✅ {name}: RMSE = {metrics['rmse']:.2f}, R² = {metrics['r2']:.3f}")
                    
                except Exception as e:
                    logger.error(f"❌ Failed to train {name}: {str(e)}")
                    continue
            
            if not ensemble_models:
                return {'success': False, 'error': 'Failed to train any models'}
            
            # Calculate ensemble predictions
            ensemble_predictions = np.zeros(len(y_test))
            for model in ensemble_models.values():
                ensemble_predictions += model.predict(X_test_scaled)
            ensemble_predictions /= len(ensemble_models)
            
            # Ensemble metrics
            ensemble_final_metrics = {
                'mse': mean_squared_error(y_test, ensemble_predictions),
                'rmse': np.sqrt(mean_squared_error(y_test, ensemble_predictions)),
                'mae': mean_absolute_error(y_test, ensemble_predictions),
                'r2': r2_score(y_test, ensemble_predictions)
            }
            
            # Store models
            self.models = ensemble_models
            self.scalers['ensemble'] = scaler
            self.is_trained = True
            
            return {
                'success': True,
                'models_trained': list(ensemble_models.keys()),
                'training_samples': len(training_data),
                'feature_count': X.shape[1],
                'feature_names': feature_names,
                'individual_metrics': ensemble_metrics,
                'ensemble_metrics': ensemble_final_metrics,
                'training_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Twitter engagement training failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_twitter_engagement(
        self, 
        content_features: Dict[str, Any],
        yapper_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Predict Twitter engagement using ONLY pre-computed features
        NO LLM calls during prediction!
        """
        try:
            if not self.is_trained:
                return {'success': False, 'error': 'Models not trained'}
            
            # Prepare feature vector from pre-computed data only
            feature_vector = self._prepare_prediction_features(content_features, yapper_context)
            
            if feature_vector is None:
                return {'success': False, 'error': 'Feature preparation failed'}
            
            # Scale features
            scaler = self.scalers['ensemble']
            feature_vector_scaled = scaler.transform([feature_vector])
            
            # Make ensemble prediction
            predictions = []
            for model in self.models.values():
                pred = model.predict(feature_vector_scaled)[0]
                predictions.append(max(0, pred))  # Ensure non-negative engagement
            
            ensemble_prediction = np.mean(predictions)
            prediction_std = np.std(predictions)
            
            # Break down to individual engagement types
            # Simple heuristic based on total engagement
            total_engagement = ensemble_prediction
            likes_ratio = 0.7  # 70% of engagement typically likes
            retweets_ratio = 0.2  # 20% retweets
            replies_ratio = 0.1   # 10% replies
            
            predicted_engagement = {
                'total_engagement': float(total_engagement),
                'predicted_likes': float(total_engagement * likes_ratio),
                'predicted_retweets': float(total_engagement * retweets_ratio),
                'predicted_replies': float(total_engagement * replies_ratio),
                'confidence_interval': {
                    'lower': max(0, total_engagement - prediction_std),
                    'upper': total_engagement + prediction_std,
                    'std': prediction_std
                }
            }
            
            return {
                'success': True,
                'predicted_engagement': predicted_engagement,
                'individual_model_predictions': {name: float(pred) for name, pred in zip(self.models.keys(), predictions)},
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Twitter engagement prediction failed: {str(e)}")
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
            
            # Query from new dedicated engagement training table
            query = """
            SELECT * FROM twitter_engagement_training_data 
            WHERE platform_source = $1 
                AND total_engagement IS NOT NULL
                AND total_engagement > 0
                AND llm_content_quality IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1000
            """
            
            records = await conn.fetch(query, self.platform)
            await conn.close()
            
            logger.info(f"✅ Loaded {len(records)} engagement training samples")
            return [dict(record) for record in records]
            
        except Exception as e:
            logger.error(f"❌ Failed to load engagement training data: {str(e)}")
            return []
    
    async def _prepare_engagement_features(self, training_data: List[Dict]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare features for engagement prediction using ONLY pre-computed data"""
        try:
            df = pd.DataFrame(training_data)
            
            # All features are pre-computed (NO LLM calls here!)
            feature_columns = [
                # Basic content features
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'url_count', 'emoji_count',
                'question_count', 'exclamation_count', 'has_media', 'is_thread', 'is_reply',
                
                # PRE-COMPUTED LLM features (extracted during data collection)
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_originality', 'llm_clarity', 'llm_emotional_impact',
                'llm_call_to_action_strength', 'llm_trending_relevance', 'llm_humor_level',
                
                # Yapper profile features (at time of posting)
                'yapper_followers_count', 'yapper_following_count', 'yapper_tweet_count',
                'yapper_verified', 'yapper_avg_engagement_rate',
                
                # Temporal features
                'hour_of_day', 'day_of_week', 'is_weekend', 'is_prime_social_time',
                
                # Crypto/web3 features
                'crypto_keyword_count', 'trading_keyword_count', 'technical_keyword_count'
            ]
            
            # Filter existing columns
            available_columns = [col for col in feature_columns if col in df.columns]
            
            # Prepare feature matrix
            X = df[available_columns].fillna(0)
            
            # Convert boolean columns to numeric
            bool_columns = ['has_media', 'is_thread', 'is_reply', 'yapper_verified', 'is_weekend', 'is_prime_social_time']
            for col in bool_columns:
                if col in X.columns:
                    X[col] = X[col].astype(int)
            
            # Encode categorical LLM features (pre-computed)
            categorical_features = ['llm_content_type', 'llm_target_audience']
            for col in categorical_features:
                if col in df.columns:
                    le = LabelEncoder()
                    X[f'{col}_encoded'] = le.fit_transform(df[col].fillna('unknown'))
                    available_columns.append(f'{col}_encoded')
                    self.label_encoders[col] = le
            
            # Target variable (total engagement)
            y = df['total_engagement'].values
            
            logger.info(f"✅ Prepared engagement features: {X.shape}, target: {y.shape}")
            logger.info(f"📊 Features used: {', '.join(available_columns)}")
            
            return X.values, y, available_columns
            
        except Exception as e:
            logger.error(f"❌ Engagement feature preparation failed: {str(e)}")
            return np.array([]), np.array([]), []
    
    def _prepare_prediction_features(
        self, 
        content_features: Dict[str, Any], 
        yapper_context: Dict[str, Any] = None
    ) -> Optional[List[float]]:
        """
        Prepare feature vector for prediction using ONLY pre-computed data
        NO LLM calls allowed here!
        """
        try:
            # Expected feature order (must match training)
            feature_order = [
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'url_count', 'emoji_count',
                'question_count', 'exclamation_count', 'has_media', 'is_thread', 'is_reply',
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_originality', 'llm_clarity', 'llm_emotional_impact',
                'llm_call_to_action_strength', 'llm_trending_relevance', 'llm_humor_level',
                'yapper_followers_count', 'yapper_following_count', 'yapper_tweet_count',
                'yapper_verified', 'yapper_avg_engagement_rate', 'hour_of_day', 'day_of_week',
                'is_weekend', 'is_prime_social_time', 'crypto_keyword_count',
                'trading_keyword_count', 'technical_keyword_count'
            ]
            
            feature_vector = []
            
            for feature in feature_order:
                value = content_features.get(feature, 0)
                
                # Get yapper context if needed
                if yapper_context and feature.startswith('yapper_'):
                    value = yapper_context.get(feature, value)
                
                # Convert boolean to int
                if isinstance(value, bool):
                    value = int(value)
                
                feature_vector.append(float(value))
            
            return feature_vector
            
        except Exception as e:
            logger.error(f"❌ Engagement feature vector preparation failed: {str(e)}")
            return None
    
    async def save_model_to_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Save trained models to disk"""
        try:
            import os
            os.makedirs(f"{base_path}/{self.platform}", exist_ok=True)
            
            model_path = f"{base_path}/{self.platform}/twitter_engagement_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/twitter_engagement_scaler.pkl"
            
            # Save models and scaler
            joblib.dump(self.models, model_path)
            joblib.dump(self.scalers, scaler_path)
            
            return {
                'success': True,
                'model_path': model_path,
                'scaler_path': scaler_path
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to save engagement models: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def load_model_from_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Load trained models from disk"""
        try:
            model_path = f"{base_path}/{self.platform}/twitter_engagement_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/twitter_engagement_scaler.pkl"
            
            self.models = joblib.load(model_path)
            self.scalers = joblib.load(scaler_path)
            self.is_trained = True
            
            return {
                'success': True,
                'models_loaded': list(self.models.keys())
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to load engagement models: {str(e)}")
            return {'success': False, 'error': str(e)}
