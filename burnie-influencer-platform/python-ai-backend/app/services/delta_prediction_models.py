"""
Delta SNAP & Position Change Prediction Models

Replaces mindshare prediction with:
1. Delta SNAP prediction (how many SNAPs a content will earn)
2. Position change prediction (how many positions user will climb)
"""

import asyncio
import logging
import pickle
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import asyncpg
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, mean_absolute_error, accuracy_score, classification_report, r2_score
from sklearn.linear_model import LinearRegression, Ridge
import joblib

from app.config.settings import settings

logger = logging.getLogger(__name__)

class DeltaSNAPPredictor:
    """
    Predicts how many SNAPs a content will earn (delta SNAPs)
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.models = {}
        self.scalers = {}
        self.is_trained = False
        
        # Ensemble algorithms for SNAP prediction
        self.algorithms = {
            'random_forest': RandomForestRegressor(n_estimators=150, max_depth=12, random_state=42),
            'gradient_boosting': GradientBoostingRegressor(n_estimators=150, random_state=42),
            'linear_regression': LinearRegression(),
            'ridge_regression': Ridge(alpha=1.0)
        }
    
    async def train_delta_snap_models(self) -> Dict[str, Any]:
        """Train ensemble models for delta SNAP prediction"""
        try:
            logger.info(f"🎯 Training Delta SNAP models for {self.platform}")
            
            # Load training data
            training_data = await self._load_snap_training_data()
            
            if len(training_data) < 30:
                return {
                    'success': False,
                    'error': f'Insufficient training data: {len(training_data)} samples (need at least 30)'
                }
            
            # Prepare features and targets
            X, y, feature_names = await self._prepare_snap_features(training_data)
            
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
                    logger.info(f"🔄 Training {name} for SNAP prediction")
                    
                    # Train model
                    model = algorithm
                    model.fit(X_train_scaled, y_train)
                    
                    # Evaluate
                    y_pred = model.predict(X_test_scaled)
                    
                    metrics = {
                        'mse': mean_squared_error(y_test, y_pred),
                        'rmse': np.sqrt(mean_squared_error(y_test, y_pred)),
                        'mae': mean_absolute_error(y_test, y_pred)
                    }
                    
                    # Cross-validation
                    cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5, scoring='neg_mean_squared_error')
                    metrics['cv_rmse'] = np.sqrt(-cv_scores.mean())
                    metrics['cv_std'] = cv_scores.std()
                    
                    ensemble_models[name] = model
                    ensemble_metrics[name] = metrics
                    
                    logger.info(f"✅ {name}: RMSE = {metrics['rmse']:.2f}")
                    
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
                'mae': mean_absolute_error(y_test, ensemble_predictions)
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
            logger.error(f"❌ Delta SNAP training failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_delta_snaps(
        self, 
        content_features: Dict[str, Any],
        yapper_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Predict SNAP delta for content"""
        try:
            if not self.is_trained:
                return {'success': False, 'error': 'Models not trained'}
            
            # Prepare feature vector
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
                predictions.append(max(0, pred))  # Ensure non-negative SNAPs
            
            ensemble_prediction = np.mean(predictions)
            prediction_std = np.std(predictions)
            
            # Confidence interval
            confidence_interval = {
                'lower': max(0, ensemble_prediction - prediction_std),
                'upper': ensemble_prediction + prediction_std,
                'std': prediction_std
            }
            
            return {
                'success': True,
                'predicted_delta_snaps': float(ensemble_prediction),
                'confidence_interval': confidence_interval,
                'individual_predictions': {name: float(pred) for name, pred in zip(self.models.keys(), predictions)},
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ SNAP prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _load_snap_training_data(self) -> List[Dict]:
        """Load training data for SNAP prediction"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            # Query training data
            query = """
            SELECT * FROM primary_predictor_training_data 
            WHERE platform_source = $1 
                AND delta_snaps IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1000
            """
            
            records = await conn.fetch(query, self.platform)
            await conn.close()
            
            return [dict(record) for record in records]
            
        except Exception as e:
            logger.error(f"❌ Failed to load SNAP training data: {str(e)}")
            return []
    
    async def _prepare_snap_features(self, training_data: List[Dict]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare features for SNAP prediction"""
        try:
            df = pd.DataFrame(training_data)
            
            # Feature columns (all pre-computed)
            feature_columns = [
                # Basic content features
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'question_count', 'exclamation_count',
                'uppercase_ratio', 'emoji_count',
                
                # LLM features (pre-computed)
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_originality', 'llm_clarity', 'llm_emotional_impact',
                'llm_trending_relevance', 'llm_technical_depth', 'llm_humor_level',
                'llm_crypto_relevance', 'llm_predicted_snap_impact',
                
                # Yapper features
                'yapper_followers_count', 'yapper_following_count', 'yapper_tweet_count',
                'yapper_engagement_rate', 'yapper_mindshare_percent',
                
                # Temporal features
                'hour_of_day', 'day_of_week', 'is_weekend', 'is_prime_social_time',
                
                # Campaign context
                'campaign_reward_pool', 'competition_level',
                
                # Crypto features
                'crypto_keyword_count', 'trading_keyword_count', 'technical_keyword_count'
            ]
            
            # Filter existing columns
            available_columns = [col for col in feature_columns if col in df.columns]
            
            # Prepare feature matrix
            X = df[available_columns].fillna(0)
            
            # Encode categorical LLM features
            categorical_features = ['llm_category_classification', 'llm_sentiment_classification']
            for col in categorical_features:
                if col in df.columns:
                    le = LabelEncoder()
                    X[f'{col}_encoded'] = le.fit_transform(df[col].fillna('other'))
                    available_columns.append(f'{col}_encoded')
            
            # Target variable
            y = df['delta_snaps'].values
            
            logger.info(f"✅ Prepared SNAP features: {X.shape}, target: {y.shape}")
            return X.values, y, available_columns
            
        except Exception as e:
            logger.error(f"❌ SNAP feature preparation failed: {str(e)}")
            return np.array([]), np.array([]), []
    
    def _prepare_prediction_features(
        self, 
        content_features: Dict[str, Any], 
        yapper_context: Dict[str, Any] = None
    ) -> Optional[List[float]]:
        """Prepare feature vector for prediction"""
        try:
            # Expected feature order (must match training exactly - 37 features)
            feature_order = [
                # Basic content features (10)
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'question_count', 'exclamation_count',
                'uppercase_ratio', 'emoji_count',
                
                # LLM features (11)
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_originality', 'llm_clarity', 'llm_emotional_impact',
                'llm_trending_relevance', 'llm_technical_depth', 'llm_humor_level',
                'llm_crypto_relevance', 'llm_predicted_snap_impact',
                
                # Yapper features (5)
                'yapper_followers_count', 'yapper_following_count', 'yapper_tweet_count',
                'yapper_engagement_rate', 'yapper_mindshare_percent',
                
                # Temporal features (4)
                'hour_of_day', 'day_of_week', 'is_weekend', 'is_prime_social_time',
                
                # Campaign context (2)
                'campaign_reward_pool', 'competition_level',
                
                # Crypto features (3)
                'crypto_keyword_count', 'trading_keyword_count', 'technical_keyword_count',
                
                # Additional features that were in training (2)
                'url_count', 'total_snaps_before'
            ]
            
            # Set up defaults and merge contexts
            feature_defaults = {
                'char_length': 100, 'word_count': 20, 'sentiment_polarity': 0.0, 'sentiment_subjectivity': 0.5,
                'hashtag_count': 0, 'mention_count': 0, 'question_count': 0, 'exclamation_count': 0,
                'uppercase_ratio': 0.1, 'emoji_count': 0, 'url_count': 0,
                'llm_content_quality': 5.0, 'llm_viral_potential': 5.0, 'llm_engagement_potential': 5.0,
                'llm_originality': 5.0, 'llm_clarity': 5.0, 'llm_emotional_impact': 5.0,
                'llm_trending_relevance': 5.0, 'llm_technical_depth': 5.0, 'llm_humor_level': 5.0,
                'llm_crypto_relevance': 5.0, 'llm_predicted_snap_impact': 5.0,
                'yapper_followers_count': 1000, 'yapper_following_count': 500, 'yapper_tweet_count': 1000,
                'yapper_engagement_rate': 2.0, 'yapper_mindshare_percent': 1.0,
                'campaign_reward_pool': 100.0, 'competition_level': 5.0,
                'crypto_keyword_count': 0, 'trading_keyword_count': 0, 'technical_keyword_count': 0,
                'total_snaps_before': 50
            }
            
            # Add temporal features
            from datetime import datetime
            now = datetime.now()
            content_features.update({
                'hour_of_day': now.hour,
                'day_of_week': now.weekday(),
                'is_weekend': 1 if now.weekday() >= 5 else 0,
                'is_prime_social_time': 1 if 18 <= now.hour <= 22 else 0
            })
            
            # Map yapper_context to expected feature names
            if yapper_context:
                content_features.update({
                    'yapper_followers_count': yapper_context.get('followers_count', feature_defaults['yapper_followers_count']),
                    'yapper_following_count': yapper_context.get('following_count', feature_defaults['yapper_following_count']),
                    'yapper_tweet_count': yapper_context.get('tweet_count', feature_defaults['yapper_tweet_count']),
                    'yapper_engagement_rate': yapper_context.get('engagement_rate', feature_defaults['yapper_engagement_rate']),
                    'yapper_mindshare_percent': yapper_context.get('mindshare_percent', feature_defaults['yapper_mindshare_percent'])
                })
            
            feature_vector = []
            
            for feature in feature_order:
                value = content_features.get(feature, feature_defaults.get(feature, 0.0))
                feature_vector.append(float(value))
            
            logger.info(f"🔢 Prepared {len(feature_vector)} features for SNAP prediction")
            
            return feature_vector
            
        except Exception as e:
            logger.error(f"❌ Feature vector preparation failed: {str(e)}")
            return None
    
    async def save_model_to_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Save trained models to disk"""
        try:
            import os
            os.makedirs(f"{base_path}/{self.platform}", exist_ok=True)
            
            model_path = f"{base_path}/{self.platform}/delta_snap_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/delta_snap_scaler.pkl"
            
            # Save models and scaler
            joblib.dump(self.models, model_path)
            joblib.dump(self.scalers, scaler_path)
            
            return {
                'success': True,
                'model_path': model_path,
                'scaler_path': scaler_path
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to save delta SNAP models: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def load_model_from_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Load trained models from disk"""
        try:
            model_path = f"{base_path}/{self.platform}/delta_snap_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/delta_snap_scaler.pkl"
            
            self.models = joblib.load(model_path)
            self.scalers = joblib.load(scaler_path)
            self.is_trained = True
            
            return {
                'success': True,
                'models_loaded': list(self.models.keys())
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to load delta SNAP models: {str(e)}")
            return {'success': False, 'error': str(e)}


class PositionChangePredictor:
    """
    Predicts leaderboard position changes as number of positions climbed/dropped
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        self.platform = platform
        self.models = {}
        self.scalers = {}
        self.is_trained = False
        
        # Ensemble algorithms for position change prediction
        self.algorithms = {
            'random_forest': RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42),
            'gradient_boosting': GradientBoostingRegressor(n_estimators=100, random_state=42),
            'linear_regression': LinearRegression(),
            'ridge_regression': Ridge(alpha=1.0)
        }
    
    async def train_position_model(self) -> Dict[str, Any]:
        """Train ensemble position change prediction models"""
        try:
            logger.info(f"🎯 Training Position Change ensemble models for {self.platform}")
            
            # Load training data
            training_data = await self._load_position_training_data()
            
            if len(training_data) < 20:
                return {
                    'success': False,
                    'error': f'Insufficient training data: {len(training_data)} samples'
                }
            
            # Prepare features and targets
            X, y, feature_names = await self._prepare_position_features(training_data)
            
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
                    logger.info(f"🔄 Training {name} for position change prediction")
                    
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
            logger.error(f"❌ Position change training failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def predict_position_change(
        self, 
        content_features: Dict[str, Any],
        current_position: int,
        yapper_context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Predict position change as number of positions (positive = climb up, negative = drop down)"""
        try:
            if not self.is_trained:
                return {'success': False, 'error': 'Models not trained'}
            
            # Prepare features
            feature_vector = self._prepare_prediction_features(content_features, current_position, yapper_context)
            
            if feature_vector is None:
                return {'success': False, 'error': 'Feature preparation failed'}
            
            # Scale features
            scaler = self.scalers['ensemble']
            feature_vector_scaled = scaler.transform([feature_vector])
            
            # Make ensemble prediction
            predictions = []
            for model in self.models.values():
                pred = model.predict(feature_vector_scaled)[0]
                predictions.append(pred)
            
            ensemble_prediction = np.mean(predictions)
            prediction_std = np.std(predictions)
            
            # Round to nearest integer (positions are discrete)
            predicted_position_change = int(round(ensemble_prediction))
            
            # Calculate confidence interval
            confidence_interval = {
                'lower': ensemble_prediction - prediction_std,
                'upper': ensemble_prediction + prediction_std,
                'std': prediction_std
            }
            
            # Interpret the prediction
            if predicted_position_change > 0:
                direction = "climb up"
                impact = "positive"
            elif predicted_position_change < 0:
                direction = "drop down"  
                impact = "negative"
            else:
                direction = "stay stable"
                impact = "neutral"
            
            return {
                'success': True,
                'predicted_position_change': predicted_position_change,
                'current_position': current_position,
                'predicted_new_position': max(1, current_position - predicted_position_change),  # Can't go below position 1
                'direction': direction,
                'impact': impact,
                'confidence_interval': confidence_interval,
                'individual_predictions': {name: float(pred) for name, pred in zip(self.models.keys(), predictions)},
                'prediction_timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Position prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def _load_position_training_data(self) -> List[Dict]:
        """Load training data for position prediction"""
        try:
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            query = """
            SELECT * FROM primary_predictor_training_data 
            WHERE platform_source = $1 
                AND position_change IS NOT NULL
                AND position_change != 0
            ORDER BY created_at DESC
            LIMIT 500
            """
            
            records = await conn.fetch(query, self.platform)
            await conn.close()
            
            return [dict(record) for record in records]
            
        except Exception as e:
            logger.error(f"❌ Failed to load position training data: {str(e)}")
            return []
    
    async def _prepare_position_features(self, training_data: List[Dict]) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare features for position prediction"""
        try:
            df = pd.DataFrame(training_data)
            
            # Same features as SNAP + current position
            feature_columns = [
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'question_count', 'exclamation_count',
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_predicted_position_impact', 'leaderboard_position_before',
                'total_snaps_before', 'yapper_followers_count', 'competition_level'
            ]
            
            available_columns = [col for col in feature_columns if col in df.columns]
            X = df[available_columns].fillna(0)
            
            # Target variable: actual position change (not categorical)
            y = df['position_change'].fillna(0).values
            
            logger.info(f"✅ Prepared position features: {X.shape}, target: {y.shape}")
            logger.info(f"📊 Position change range: {y.min():.2f} to {y.max():.2f}")
            
            return X.values, y, available_columns
            
        except Exception as e:
            logger.error(f"❌ Position feature preparation failed: {str(e)}")
            return np.array([]), np.array([]), []
    
    def _prepare_prediction_features(
        self, 
        content_features: Dict[str, Any], 
        current_position: int,
        yapper_context: Dict[str, Any] = None
    ) -> Optional[List[float]]:
        """Prepare feature vector for position prediction"""
        try:
            # Include current position as important feature
            features = dict(content_features)
            features['leaderboard_position_before'] = current_position
            
            if yapper_context:
                features.update(yapper_context)
            
            # Extract in expected order
            feature_order = [
                'char_length', 'word_count', 'sentiment_polarity', 'sentiment_subjectivity',
                'hashtag_count', 'mention_count', 'question_count', 'exclamation_count',
                'llm_content_quality', 'llm_viral_potential', 'llm_engagement_potential',
                'llm_predicted_position_impact', 'leaderboard_position_before',
                'total_snaps_before', 'yapper_followers_count', 'competition_level'
            ]
            
            return [float(features.get(f, 0)) for f in feature_order]
            
        except Exception as e:
            logger.error(f"❌ Position feature preparation failed: {str(e)}")
            return None
    
    async def save_model_to_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Save trained models to disk"""
        try:
            import os
            os.makedirs(f"{base_path}/{self.platform}", exist_ok=True)
            
            model_path = f"{base_path}/{self.platform}/position_change_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/position_change_scalers.pkl"
            
            # Save models and scalers
            joblib.dump(self.models, model_path)
            joblib.dump(self.scalers, scaler_path)
            
            return {
                'success': True,
                'model_path': model_path,
                'scaler_path': scaler_path
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to save position change models: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def load_model_from_disk(self, base_path: str = "./models") -> Dict[str, Any]:
        """Load trained models from disk"""
        try:
            model_path = f"{base_path}/{self.platform}/position_change_models.pkl"
            scaler_path = f"{base_path}/{self.platform}/position_change_scalers.pkl"
            
            self.models = joblib.load(model_path)
            self.scalers = joblib.load(scaler_path)
            self.is_trained = True
            
            return {
                'success': True,
                'models_loaded': list(self.models.keys())
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to load position change models: {str(e)}")
            return {'success': False, 'error': str(e)}
