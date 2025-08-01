"""
Mindshare ML Model Training System
==================================

This module provides comprehensive machine learning training capabilities for mindshare prediction models.
It supports multiple algorithms, feature engineering, and model persistence.
"""

import asyncpg
import numpy as np
import pandas as pd
import pickle
import json
import os
import logging
from datetime import datetime
from typing import Dict, List, Any, Tuple, Optional
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.svm import SVR
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
from sklearn.pipeline import Pipeline
import re
from textstat import flesch_reading_ease, flesch_kincaid_grade
from app.config.settings import settings

logger = logging.getLogger(__name__)

class MindshareMLTrainer:
    """Advanced ML training system for mindshare prediction models"""
    
    def __init__(self, models_dir: str = "/app/models/mindshare"):
        self.models_dir = models_dir
        self.models = {}
        self.scalers = {}
        self.vectorizers = {}
        self.label_encoders = {}
        
        # Ensure models directory exists
        os.makedirs(self.models_dir, exist_ok=True)
        
        # Available algorithms
        self.algorithms = {
            'random_forest': RandomForestRegressor(n_estimators=100, random_state=42),
            'gradient_boosting': GradientBoostingRegressor(n_estimators=100, random_state=42),
            'linear_regression': LinearRegression(),
            'ridge_regression': Ridge(alpha=1.0),
            'svr': SVR(kernel='rbf', C=1.0, gamma='scale')
        }
        
        # Default algorithm
        self.default_algorithm = 'random_forest'
    
    async def load_training_data(self, platform_source: str = None) -> pd.DataFrame:
        """Load training data from database"""
        try:
            # Create database connection
            conn = await asyncpg.connect(
                host=settings.database_host,
                port=settings.database_port,
                user=settings.database_user,
                password=settings.database_password,
                database=settings.database_name
            )
            
            query = """
            SELECT 
                "platformSource",
                "contentText",
                "engagementMetrics",
                "mindshareScore",
                "timestampPosted",
                "campaignContext"
            FROM mindshare_training_data
            """
            
            params = []
            if platform_source:
                query += ' WHERE "platformSource" = $1'
                params.append(platform_source)
            
            query += ' ORDER BY "scrapedAt" DESC LIMIT 500'
            
            # Execute query
            records = await conn.fetch(query, *params)
            await conn.close()
            
            if not records:
                logger.warning(f"⚠️ No training data found" + (f" for platform: {platform_source}" if platform_source else ""))
                return pd.DataFrame()
            
            # Convert to DataFrame
            data = []
            for record in records:
                data.append({
                    'platform_source': record['platformSource'],
                    'content_text': record['contentText'] or '',
                    'engagement_metrics': record['engagementMetrics'] or {},
                    'mindshare_score': float(record['mindshareScore']) if record['mindshareScore'] else 0.0,
                    'timestamp_posted': record['timestampPosted'],
                    'campaign_context': record['campaignContext'] or {}
                })
            
            df = pd.DataFrame(data)
            logger.info(f"📊 Loaded {len(df)} training records" + (f" for {platform_source}" if platform_source else ""))
            
            return df
            
        except Exception as e:
            logger.error(f"❌ Error loading training data: {e}")
            return pd.DataFrame()
    
    def extract_content_features(self, content_text: str) -> Dict[str, float]:
        """Extract comprehensive features from content text"""
        try:
            features = {}
            
            # Basic text features
            features['content_length'] = len(content_text)
            features['word_count'] = len(content_text.split())
            features['sentence_count'] = len(re.split(r'[.!?]+', content_text))
            features['avg_word_length'] = np.mean([len(word) for word in content_text.split()]) if content_text.split() else 0
            
            # Social media specific features
            features['hashtag_count'] = content_text.count('#')
            features['mention_count'] = content_text.count('@')
            features['emoji_count'] = len([c for c in content_text if ord(c) > 127])
            features['url_count'] = len(re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', content_text))
            
            # Readability features
            try:
                features['flesch_reading_ease'] = flesch_reading_ease(content_text)
                features['flesch_kincaid_grade'] = flesch_kincaid_grade(content_text)
            except:
                features['flesch_reading_ease'] = 0
                features['flesch_kincaid_grade'] = 0
            
            # Sentiment indicators (simple heuristics)
            positive_words = ['good', 'great', 'awesome', 'amazing', 'love', 'best', 'excellent', '🚀', '💎', '🔥']
            negative_words = ['bad', 'worst', 'hate', 'terrible', 'awful', 'scam', 'rug', 'dump']
            
            features['positive_word_count'] = sum(1 for word in positive_words if word.lower() in content_text.lower())
            features['negative_word_count'] = sum(1 for word in negative_words if word.lower() in content_text.lower())
            
            # Crypto/Web3 specific features
            crypto_terms = ['crypto', 'bitcoin', 'eth', 'defi', 'nft', 'dao', 'web3', 'blockchain', 'token']
            features['crypto_term_count'] = sum(1 for term in crypto_terms if term.lower() in content_text.lower())
            
            # Question/Call-to-action features
            features['has_question'] = 1 if '?' in content_text else 0
            features['has_exclamation'] = 1 if '!' in content_text else 0
            features['has_caps'] = 1 if any(word.isupper() for word in content_text.split()) else 0
            
            return features
            
        except Exception as e:
            logger.error(f"❌ Error extracting content features: {e}")
            return {}
    
    def prepare_features(self, df: pd.DataFrame, platform_source: str = None) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare feature matrix and target vector"""
        try:
            # Filter by platform if specified
            if platform_source:
                df = df[df['platform_source'] == platform_source].copy()
            
            if len(df) == 0:
                raise ValueError(f"No data available for platform: {platform_source}")
            
            # Extract engagement metrics from JSON
            engagement_data = []
            for metrics in df['engagement_metrics']:
                engagement_data.append({
                    'likes': metrics.get('likes', 0) if isinstance(metrics, dict) else 0,
                    'shares': metrics.get('shares', 0) if isinstance(metrics, dict) else 0,
                    'comments': metrics.get('comments', 0) if isinstance(metrics, dict) else 0,
                    'views': metrics.get('views', 0) if isinstance(metrics, dict) else 0,
                    'retweets': metrics.get('retweets', 0) if isinstance(metrics, dict) else 0,
                    'replies': metrics.get('replies', 0) if isinstance(metrics, dict) else 0
                })
            
            engagement_df = pd.DataFrame(engagement_data)
            
            # Extract campaign context from JSON
            campaign_data = []
            for context in df['campaign_context']:
                campaign_data.append({
                    'campaign_type': context.get('campaign_type', 'unknown') if isinstance(context, dict) else 'unknown',
                    'topic': context.get('topic', 'unknown') if isinstance(context, dict) else 'unknown',
                    'category': context.get('category', 'general') if isinstance(context, dict) else 'general'
                })
            
            campaign_df = pd.DataFrame(campaign_data)
            
            # Extract content features
            content_features = []
            for text in df['content_text']:
                features = self.extract_content_features(text or '')
                content_features.append(features)
            
            content_df = pd.DataFrame(content_features)
            
            # Engagement features
            engagement_df['total_engagement'] = engagement_df[['likes', 'shares', 'comments', 'retweets', 'replies']].sum(axis=1)
            engagement_df['engagement_rate'] = engagement_df['total_engagement'] / (engagement_df['views'] + 1)
            
            # Categorical features
            categorical_features = pd.get_dummies(campaign_df, prefix=['type', 'topic', 'cat'])
            
            # Time features
            df['timestamp_posted'] = pd.to_datetime(df['timestamp_posted'])
            df['hour'] = df['timestamp_posted'].dt.hour
            df['day_of_week'] = df['timestamp_posted'].dt.dayofweek
            df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
            
            time_features = df[['hour', 'day_of_week', 'is_weekend']]
            
            # Combine all features
            X = pd.concat([
                content_df,
                engagement_df,
                categorical_features,
                time_features
            ], axis=1)
            
            # Fill any NaN values
            X = X.fillna(0)
            
            # Target variable
            y = df['mindshare_score'].values
            
            logger.info(f"✅ Prepared feature matrix: {X.shape}, target vector: {y.shape}")
            return X.values, y
            
        except Exception as e:
            logger.error(f"❌ Error preparing features: {e}")
            return np.array([]), np.array([])
    
    async def train_platform_model(self, platform_source: str, algorithm: str = None) -> Dict[str, Any]:
        """Train a model for a specific platform"""
        try:
            if algorithm is None:
                algorithm = self.default_algorithm
            
            # Load data
            df = await self.load_training_data(platform_source)
            if len(df) == 0:
                raise ValueError(f"No training data available for platform: {platform_source}")
            
            # Check minimum data requirement
            MIN_RECORDS_REQUIRED = 20
            if len(df) < MIN_RECORDS_REQUIRED:
                raise ValueError(f"Insufficient training data for platform: {platform_source}. "
                               f"Found {len(df)} records, minimum {MIN_RECORDS_REQUIRED} required.")
            
            logger.info(f"📊 Training model for {platform_source} with {len(df)} records")
            
            # Prepare features
            X, y = self.prepare_features(df, platform_source)
            if len(X) == 0:
                raise ValueError(f"Failed to prepare features for platform: {platform_source}")
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train model
            model = self.algorithms[algorithm]
            model.fit(X_train_scaled, y_train)
            
            # Evaluate model
            y_pred = model.predict(X_test_scaled)
            
            metrics = {
                'mse': mean_squared_error(y_test, y_pred),
                'rmse': np.sqrt(mean_squared_error(y_test, y_pred)),
                'mae': mean_absolute_error(y_test, y_pred),
                'r2': r2_score(y_test, y_pred)
            }
            
            # Cross-validation
            cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5, scoring='r2')
            metrics['cv_mean'] = cv_scores.mean()
            metrics['cv_std'] = cv_scores.std()
            
            # Save model and scaler
            model_path = os.path.join(self.models_dir, f"{platform_source}_{algorithm}_model.pkl")
            scaler_path = os.path.join(self.models_dir, f"{platform_source}_{algorithm}_scaler.pkl")
            
            with open(model_path, 'wb') as f:
                pickle.dump(model, f)
            
            with open(scaler_path, 'wb') as f:
                pickle.dump(scaler, f)
            
            # Save model metadata
            metadata = {
                'platform_source': platform_source,
                'algorithm': algorithm,
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'feature_count': X.shape[1],
                'metrics': metrics,
                'trained_at': datetime.now().isoformat(),
                'model_path': model_path,
                'scaler_path': scaler_path
            }
            
            metadata_path = os.path.join(self.models_dir, f"{platform_source}_{algorithm}_metadata.json")
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Store in memory
            self.models[f"{platform_source}_{algorithm}"] = model
            self.scalers[f"{platform_source}_{algorithm}"] = scaler
            
            logger.info(f"✅ Trained {algorithm} model for {platform_source} - R²: {metrics['r2']:.4f}")
            return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to train model for {platform_source}: {e}")
            return {}
    
    async def train_all_platform_models(self, algorithm: str = None) -> Dict[str, Any]:
        """Train models for all available platforms"""
        try:
            if algorithm is None:
                algorithm = self.default_algorithm
            
            # Get all platforms
            df = await self.load_training_data()
            platforms = df['platform_source'].unique()
            
            results = {}
            for platform in platforms:
                logger.info(f"🚀 Training model for platform: {platform}")
                metadata = await self.train_platform_model(platform, algorithm)
                results[platform] = metadata
            
            # Save combined metadata
            combined_metadata = {
                'algorithm': algorithm,
                'platforms': list(platforms),
                'training_completed_at': datetime.now().isoformat(),
                'results': results
            }
            
            combined_path = os.path.join(self.models_dir, f"all_platforms_{algorithm}_training_results.json")
            with open(combined_path, 'w') as f:
                json.dump(combined_metadata, f, indent=2)
            
            logger.info(f"✅ Completed training for all platforms using {algorithm}")
            return combined_metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to train all platform models: {e}")
            return {}
    
    async def train_platform_ensemble(self, platform_source: str) -> Dict[str, Any]:
        """Train an ensemble of models for a specific platform"""
        try:
            # Load data
            df = await self.load_training_data(platform_source)
            if len(df) == 0:
                raise ValueError(f"No training data available for platform: {platform_source}")
            
            # Check minimum data requirement
            MIN_RECORDS_REQUIRED = 20
            if len(df) < MIN_RECORDS_REQUIRED:
                raise ValueError(f"Insufficient training data for platform: {platform_source}. "
                               f"Found {len(df)} records, minimum {MIN_RECORDS_REQUIRED} required.")
            
            logger.info(f"🎯 Training ensemble for {platform_source} with {len(df)} records")
            
            # Prepare features
            X, y = self.prepare_features(df, platform_source)
            if len(X) == 0:
                raise ValueError(f"Failed to prepare features for platform: {platform_source}")
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train all algorithms
            ensemble_models = {}
            ensemble_metrics = {}
            
            for algorithm_name, algorithm in self.algorithms.items():
                try:
                    logger.info(f"🔄 Training {algorithm_name} for {platform_source}")
                    
                    # Clone the algorithm to avoid conflicts
                    if algorithm_name == 'random_forest':
                        model = RandomForestRegressor(n_estimators=100, random_state=42)
                    elif algorithm_name == 'gradient_boosting':
                        model = GradientBoostingRegressor(n_estimators=100, random_state=42)
                    elif algorithm_name == 'linear_regression':
                        model = LinearRegression()
                    elif algorithm_name == 'ridge_regression':
                        model = Ridge(alpha=1.0)
                    elif algorithm_name == 'svr':
                        model = SVR(kernel='rbf', C=1.0, gamma='scale')
                    else:
                        model = algorithm
                    
                    # Train model
                    model.fit(X_train_scaled, y_train)
                    
                    # Evaluate model
                    y_pred = model.predict(X_test_scaled)
                    
                    metrics = {
                        'mse': mean_squared_error(y_test, y_pred),
                        'rmse': np.sqrt(mean_squared_error(y_test, y_pred)),
                        'mae': mean_absolute_error(y_test, y_pred),
                        'r2': r2_score(y_test, y_pred)
                    }
                    
                    # Cross-validation
                    cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5, scoring='r2')
                    metrics['cv_mean'] = cv_scores.mean()
                    metrics['cv_std'] = cv_scores.std()
                    
                    ensemble_models[algorithm_name] = model
                    ensemble_metrics[algorithm_name] = metrics
                    
                    logger.info(f"✅ {algorithm_name}: R² = {metrics['r2']:.4f}")
                    
                except Exception as e:
                    logger.error(f"❌ Failed to train {algorithm_name} for {platform_source}: {e}")
                    continue
            
            if not ensemble_models:
                raise ValueError(f"Failed to train any models for platform: {platform_source}")
            
            # Create ensemble predictions (simple averaging)
            ensemble_predictions = np.zeros(len(y_test))
            for model in ensemble_models.values():
                ensemble_predictions += model.predict(X_test_scaled)
            ensemble_predictions /= len(ensemble_models)
            
            # Calculate ensemble metrics
            ensemble_metrics_final = {
                'mse': mean_squared_error(y_test, ensemble_predictions),
                'rmse': np.sqrt(mean_squared_error(y_test, ensemble_predictions)),
                'mae': mean_absolute_error(y_test, ensemble_predictions),
                'r2': r2_score(y_test, ensemble_predictions)
            }
            
            # Save ensemble models and scaler
            ensemble_path = os.path.join(self.models_dir, f"{platform_source}_ensemble_models.pkl")
            scaler_path = os.path.join(self.models_dir, f"{platform_source}_ensemble_scaler.pkl")
            
            with open(ensemble_path, 'wb') as f:
                pickle.dump(ensemble_models, f)
            
            with open(scaler_path, 'wb') as f:
                pickle.dump(scaler, f)
            
            # Save metadata
            metadata = {
                'platform_source': platform_source,
                'model_type': 'ensemble',
                'algorithms': list(ensemble_models.keys()),
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'feature_count': X.shape[1],
                'individual_metrics': ensemble_metrics,
                'ensemble_metrics': ensemble_metrics_final,
                'trained_at': datetime.now().isoformat(),
                'ensemble_path': ensemble_path,
                'scaler_path': scaler_path
            }
            
            metadata_path = os.path.join(self.models_dir, f"{platform_source}_ensemble_metadata.json")
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2, default=str)
            
            logger.info(f"🎉 Ensemble training completed for {platform_source}")
            logger.info(f"📊 Ensemble R² Score: {ensemble_metrics_final['r2']:.4f}")
            
            return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to train ensemble for {platform_source}: {e}")
            raise
    
    def load_model(self, platform_source: str, algorithm: str = None) -> Tuple[Any, Any]:
        """Load a trained model and scaler"""
        try:
            if algorithm is None:
                algorithm = self.default_algorithm
            
            model_key = f"{platform_source}_{algorithm}"
            
            # Check if already loaded in memory
            if model_key in self.models:
                return self.models[model_key], self.scalers[model_key]
            
            # Load from disk
            model_path = os.path.join(self.models_dir, f"{platform_source}_{algorithm}_model.pkl")
            scaler_path = os.path.join(self.models_dir, f"{platform_source}_{algorithm}_scaler.pkl")
            
            if not os.path.exists(model_path) or not os.path.exists(scaler_path):
                raise FileNotFoundError(f"Model files not found for {platform_source}_{algorithm}")
            
            with open(model_path, 'rb') as f:
                model = pickle.load(f)
            
            with open(scaler_path, 'rb') as f:
                scaler = pickle.load(f)
            
            # Store in memory
            self.models[model_key] = model
            self.scalers[model_key] = scaler
            
            return model, scaler
            
        except Exception as e:
            logger.error(f"❌ Failed to load model for {platform_source}: {e}")
            return None, None
    
    async def predict(self, content_text: str, platform_source: str, campaign_context: Dict[str, Any] = None, algorithm: str = None) -> Dict[str, float]:
        """Make prediction using trained model"""
        try:
            if algorithm is None:
                algorithm = self.default_algorithm
            
            # Load model
            model, scaler = self.load_model(platform_source, algorithm)
            if model is None or scaler is None:
                raise ValueError(f"No trained model available for {platform_source}")
            
            # Prepare single prediction features
            content_features = self.extract_content_features(content_text)
            
            # Mock engagement features for prediction (would come from user's historical data)
            engagement_features = {
                'likes': 100,  # Default values, would use user's historical average
                'shares': 25,
                'comments': 15,
                'views': 1000,
                'total_engagement': 140,
                'engagement_rate': 0.14
            }
            
            # Mock categorical features
            campaign_type = campaign_context.get('campaign_type', 'social') if campaign_context else 'social'
            topic = campaign_context.get('topic', 'general') if campaign_context else 'general'
            category = campaign_context.get('category', 'general') if campaign_context else 'general'
            
            # Time features (current time)
            now = datetime.now()
            time_features = {
                'hour_of_day': now.hour,
                'day_of_week': now.weekday()
            }
            
            # Combine features (this needs to match training feature structure)
            features = {**content_features, **engagement_features, **time_features}
            
            # Convert to array (this is simplified - in production you'd need to match exact feature structure)
            feature_array = np.array([list(features.values())]).reshape(1, -1)
            
            # Scale features
            feature_array_scaled = scaler.transform(feature_array)
            
            # Make prediction
            prediction = model.predict(feature_array_scaled)[0]
            
            # Get confidence interval (for tree-based models)
            confidence = 0.85  # Default confidence
            if hasattr(model, 'estimators_'):
                # For ensemble models, calculate prediction variance
                predictions = [tree.predict(feature_array_scaled)[0] for tree in model.estimators_]
                std = np.std(predictions)
                confidence = max(0.1, min(0.95, 1.0 - (std / max(prediction, 1))))
            
            result = {
                'mindshare_score': float(prediction),
                'confidence_level': float(confidence * 100),
                'platform_source': platform_source,
                'algorithm': algorithm,
                'feature_count': feature_array.shape[1],
                'prediction_timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"✅ Prediction for {platform_source}: {prediction:.2f} (confidence: {confidence*100:.1f}%)")
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to make prediction: {e}")
            return {
                'error': str(e),
                'mindshare_score': 60.0,  # Fallback prediction
                'confidence_level': 50.0
            }
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about trained models"""
        try:
            model_info = {
                'models_directory': self.models_dir,
                'available_algorithms': list(self.algorithms.keys()),
                'default_algorithm': self.default_algorithm,
                'loaded_models': list(self.models.keys()),
                'model_files': []
            }
            
            # Scan models directory
            if os.path.exists(self.models_dir):
                for file in os.listdir(self.models_dir):
                    if file.endswith('.json'):
                        metadata_path = os.path.join(self.models_dir, file)
                        try:
                            with open(metadata_path, 'r') as f:
                                metadata = json.load(f)
                            model_info['model_files'].append(metadata)
                        except:
                            pass
            
            return model_info
            
        except Exception as e:
            logger.error(f"❌ Failed to get model info: {e}")
            return {}

    def load_ensemble_model(self, platform_source: str) -> Tuple[Dict[str, Any], Any]:
        """Load ensemble models and scaler for a platform"""
        try:
            ensemble_path = os.path.join(self.models_dir, f"{platform_source}_ensemble_models.pkl")
            scaler_path = os.path.join(self.models_dir, f"{platform_source}_ensemble_scaler.pkl")
            
            if not os.path.exists(ensemble_path) or not os.path.exists(scaler_path):
                raise FileNotFoundError(f"Ensemble models not found for platform: {platform_source}")
            
            with open(ensemble_path, 'rb') as f:
                ensemble_models = pickle.load(f)
            
            with open(scaler_path, 'rb') as f:
                scaler = pickle.load(f)
            
            logger.info(f"✅ Loaded ensemble models for {platform_source}: {list(ensemble_models.keys())}")
            return ensemble_models, scaler
            
        except Exception as e:
            logger.error(f"❌ Failed to load ensemble models for {platform_source}: {e}")
            raise

    def predict_with_ensemble(self, platform_source: str, features: np.ndarray) -> float:
        """Make prediction using ensemble models"""
        try:
            ensemble_models, scaler = self.load_ensemble_model(platform_source)
            
            # Scale features
            features_scaled = scaler.transform(features.reshape(1, -1))
            
            # Get predictions from all models
            predictions = []
            for algorithm_name, model in ensemble_models.items():
                try:
                    pred = model.predict(features_scaled)[0]
                    predictions.append(pred)
                    logger.debug(f"🔮 {algorithm_name} prediction: {pred:.4f}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to get prediction from {algorithm_name}: {e}")
                    continue
            
            if not predictions:
                raise ValueError(f"No models could make predictions for platform: {platform_source}")
            
            # Simple ensemble averaging
            ensemble_prediction = np.mean(predictions)
            
            logger.info(f"🎯 Ensemble prediction for {platform_source}: {ensemble_prediction:.4f} (from {len(predictions)} models)")
            
            return float(ensemble_prediction)
            
        except Exception as e:
            logger.error(f"❌ Failed to make ensemble prediction for {platform_source}: {e}")
            # Fallback to random baseline
            return 0.5

# Global trainer instance
trainer = MindshareMLTrainer() 