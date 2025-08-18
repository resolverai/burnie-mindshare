"""
ML Model Framework for Attention Economy Platforms

Generic framework for building and deploying ML models across different platforms (Cookie.fun, Kaito, etc.)
Supports SNAP prediction, position change prediction, and other platform-specific metrics.
"""

import pickle
import json
import boto3
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, mean_absolute_error, accuracy_score, classification_report
import joblib
import logging
from pathlib import Path

from app.config.settings import settings

logger = logging.getLogger(__name__)

class MLModelFramework:
    """
    Generic ML model framework for attention economy platforms
    """
    
    def __init__(self, platform: str = "cookie.fun"):
        """
        Initialize the ML framework for a specific platform
        
        Args:
            platform: Platform identifier (e.g., 'cookie.fun', 'kaito')
        """
        self.platform = platform
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION
        )
        self.bucket_name = settings.S3_BUCKET_NAME
        self.models = {}
        self.scalers = {}
        self.encoders = {}
        
        # Platform-specific configurations
        self.platform_configs = {
            'cookie.fun': {
                'primary_metric': 'snap',
                'position_tiers': [1, 5, 10, 25, 50, 100],
                'features': {
                    'content': ['quality_score', 'viral_potential', 'category_relevance'],
                    'yapper': ['historical_performance', 'followers_count', 'engagement_rate'],
                    'campaign': ['competition_level', 'reward_pool', 'timeframe'],
                    'timing': ['hour_of_day', 'day_of_week', 'days_remaining']
                }
            },
            'kaito': {
                'primary_metric': 'bps',
                'position_tiers': [1, 5, 10, 20, 50],
                'features': {
                    'content': ['quality_score', 'viral_potential', 'category_relevance'],
                    'yapper': ['historical_performance', 'followers_count', 'engagement_rate'],
                    'campaign': ['competition_level', 'reward_pool', 'timeframe'],
                    'timing': ['hour_of_day', 'day_of_week', 'days_remaining']
                }
            }
        }
        
    def get_s3_model_path(self, model_type: str, version: str = "latest") -> str:
        """
        Generate S3 path for model storage
        
        Args:
            model_type: Type of model (e.g., 'snap_predictor', 'position_predictor')
            version: Model version
            
        Returns:
            S3 path for the model
        """
        return f"models/{self.platform}/{model_type}/{version}/"
        
    async def train_snap_predictor(self, training_data: pd.DataFrame) -> Dict[str, Any]:
        """
        Train SNAP/primary metric prediction model
        
        Args:
            training_data: DataFrame with features and target values
            
        Returns:
            Training results and metrics
        """
        try:
            logger.info(f"🎯 Training SNAP predictor for {self.platform}")
            
            # Prepare features and target
            feature_columns = self._get_feature_columns('snap_predictor')
            X, y, feature_names = self._prepare_features(training_data, feature_columns, 'snap_earned')
            
            if len(X) < 100:
                logger.warning(f"⚠️ Limited training data: {len(X)} samples. Consider collecting more data.")
                
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
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1
            )
            
            model.fit(X_train_scaled, y_train)
            
            # Evaluate model
            train_predictions = model.predict(X_train_scaled)
            test_predictions = model.predict(X_test_scaled)
            
            metrics = {
                'train_rmse': np.sqrt(mean_squared_error(y_train, train_predictions)),
                'test_rmse': np.sqrt(mean_squared_error(y_test, test_predictions)),
                'train_mae': mean_absolute_error(y_train, train_predictions),
                'test_mae': mean_absolute_error(y_test, test_predictions),
                'train_r2': model.score(X_train_scaled, y_train),
                'test_r2': model.score(X_test_scaled, y_test),
                'feature_importance': dict(zip(feature_names, model.feature_importances_)),
                'training_samples': len(X_train),
                'test_samples': len(X_test)
            }
            
            # Cross-validation
            cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=5, scoring='r2')
            metrics['cv_r2_mean'] = cv_scores.mean()
            metrics['cv_r2_std'] = cv_scores.std()
            
            # Store model artifacts
            model_artifacts = {
                'model': model,
                'scaler': scaler,
                'feature_names': feature_names,
                'metrics': metrics,
                'platform': self.platform,
                'model_type': 'snap_predictor',
                'trained_at': datetime.utcnow(),
                'training_data_size': len(training_data)
            }
            
            # Save to S3
            model_path = await self._save_model_to_s3(model_artifacts, 'snap_predictor')
            
            logger.info(f"✅ SNAP predictor trained successfully. Test R²: {metrics['test_r2']:.3f}")
            logger.info(f"📁 Model saved to: {model_path}")
            
            return {
                'success': True,
                'metrics': metrics,
                'model_path': model_path,
                'feature_importance': metrics['feature_importance']
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to train SNAP predictor: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def train_position_predictor(self, training_data: pd.DataFrame) -> Dict[str, Any]:
        """
        Train leaderboard position change prediction model
        
        Args:
            training_data: DataFrame with features and position change targets
            
        Returns:
            Training results and metrics
        """
        try:
            logger.info(f"🎯 Training position predictor for {self.platform}")
            
            # Prepare features and target
            feature_columns = self._get_feature_columns('position_predictor')
            X, y, feature_names = self._prepare_features(training_data, feature_columns, 'position_change')
            
            # Convert position changes to categories (up, down, stable)
            y_categorical = self._categorize_position_changes(y)
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y_categorical, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Encode labels
            label_encoder = LabelEncoder()
            y_train_encoded = label_encoder.fit_transform(y_train)
            y_test_encoded = label_encoder.transform(y_test)
            
            # Train Random Forest classifier
            model = RandomForestClassifier(
                n_estimators=100,
                max_depth=8,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1,
                class_weight='balanced'
            )
            
            model.fit(X_train_scaled, y_train_encoded)
            
            # Evaluate model
            train_predictions = model.predict(X_train_scaled)
            test_predictions = model.predict(X_test_scaled)
            
            metrics = {
                'train_accuracy': accuracy_score(y_train_encoded, train_predictions),
                'test_accuracy': accuracy_score(y_test_encoded, test_predictions),
                'classification_report': classification_report(y_test_encoded, test_predictions, target_names=label_encoder.classes_),
                'feature_importance': dict(zip(feature_names, model.feature_importances_)),
                'training_samples': len(X_train),
                'test_samples': len(X_test),
                'class_distribution': dict(zip(*np.unique(y_train_encoded, return_counts=True)))
            }
            
            # Cross-validation
            cv_scores = cross_val_score(model, X_train_scaled, y_train_encoded, cv=5, scoring='accuracy')
            metrics['cv_accuracy_mean'] = cv_scores.mean()
            metrics['cv_accuracy_std'] = cv_scores.std()
            
            # Store model artifacts
            model_artifacts = {
                'model': model,
                'scaler': scaler,
                'label_encoder': label_encoder,
                'feature_names': feature_names,
                'metrics': metrics,
                'platform': self.platform,
                'model_type': 'position_predictor',
                'trained_at': datetime.utcnow(),
                'training_data_size': len(training_data)
            }
            
            # Save to S3
            model_path = await self._save_model_to_s3(model_artifacts, 'position_predictor')
            
            logger.info(f"✅ Position predictor trained successfully. Test accuracy: {metrics['test_accuracy']:.3f}")
            logger.info(f"📁 Model saved to: {model_path}")
            
            return {
                'success': True,
                'metrics': metrics,
                'model_path': model_path,
                'feature_importance': metrics['feature_importance']
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to train position predictor: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def predict_snap_for_yapper(self, yapper_id: int, content_text: str, 
                                    campaign_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predict SNAP earnings for a specific yapper with comprehensive feature extraction
        Handles both novice and experienced yappers
        
        Args:
            yapper_id: Platform yapper ID
            content_text: Content to predict for
            campaign_context: Campaign information
            
        Returns:
            Prediction results with confidence and strategy used
        """
        try:
            from app.services.platform_yapper_service import PlatformYapperService
            
            # Get comprehensive yapper features
            yapper_service = PlatformYapperService()
            feature_result = await yapper_service.get_yapper_prediction_features(
                yapper_id, content_text, campaign_context
            )
            
            if not feature_result['success']:
                return {'success': False, 'error': feature_result['error']}
                
            features = feature_result['features']
            prediction_strategy = feature_result['prediction_strategy']
            experience_level = feature_result['experience_level']
            
            # Make prediction based on strategy
            if prediction_strategy['approach'] == 'data_driven':
                # Use full ML model
                result = await self.predict_snap(features)
                
            elif prediction_strategy['approach'] == 'hybrid':
                # Use ML model with confidence adjustment
                result = await self.predict_snap(features)
                if result['success']:
                    # Adjust confidence based on limited data
                    result['confidence_interval']['lower'] *= 0.8
                    result['confidence_interval']['upper'] *= 1.2
                    result['prediction'] *= prediction_strategy['confidence_multiplier']
                    
            elif prediction_strategy['approach'] == 'content_based':
                # Use content-based prediction for novice yappers
                result = await self._predict_snap_content_based(features, campaign_context)
                
            else:
                # Conservative baseline
                result = await self._predict_snap_baseline(features, campaign_context)
                
            if result['success']:
                result['experience_level'] = experience_level
                result['prediction_strategy'] = prediction_strategy['approach']
                result['yapper_id'] = yapper_id
                
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to predict SNAP for yapper {yapper_id}: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def _predict_snap_content_based(self, features: Dict[str, Any], 
                                         campaign_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Content-based SNAP prediction for novice yappers without historical data
        Uses content quality and platform baselines
        """
        try:
            # Get platform baseline metrics
            platform_baseline = await self._get_platform_baseline_snap(self.platform)
            
            # Calculate content score (weighted combination)
            content_score = (
                features.get('quality_score', 5) * 0.3 +
                features.get('viral_potential', 5) * 0.4 +
                features.get('category_relevance', 5) * 0.3
            ) / 10.0  # Normalize to 0-1
            
            # Engagement multiplier based on predicted engagement
            engagement_multiplier = min(2.0, features.get('predicted_engagement', 100) / 100.0)
            
            # Campaign context multiplier
            reward_pool = campaign_context.get('reward_pool', 10000)
            competition_level = features.get('competition_level', 50)
            campaign_multiplier = (reward_pool / 10000) * (1.0 - competition_level / 200.0)
            
            # Calculate base prediction
            base_prediction = platform_baseline * content_score * engagement_multiplier * campaign_multiplier
            
            # Confidence interval (wider for content-based)
            std_dev = base_prediction * 0.4  # 40% standard deviation
            confidence_interval = {
                'lower': max(0, base_prediction - std_dev),
                'upper': base_prediction + std_dev,
                'std': std_dev
            }
            
            return {
                'success': True,
                'prediction': float(base_prediction),
                'confidence_interval': confidence_interval,
                'method': 'content_based',
                'factors': {
                    'platform_baseline': platform_baseline,
                    'content_score': content_score,
                    'engagement_multiplier': engagement_multiplier,
                    'campaign_multiplier': campaign_multiplier
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Content-based prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def _predict_snap_baseline(self, features: Dict[str, Any], 
                                   campaign_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Conservative baseline prediction for unknown yappers
        """
        try:
            # Very conservative baseline
            platform_baseline = await self._get_platform_baseline_snap(self.platform)
            conservative_prediction = platform_baseline * 0.5  # 50% of baseline
            
            # Adjust based on campaign reward pool
            reward_multiplier = min(2.0, campaign_context.get('reward_pool', 10000) / 10000.0)
            final_prediction = conservative_prediction * reward_multiplier
            
            # Wide confidence interval
            std_dev = final_prediction * 0.6  # 60% standard deviation
            confidence_interval = {
                'lower': max(0, final_prediction - std_dev),
                'upper': final_prediction + std_dev,
                'std': std_dev
            }
            
            return {
                'success': True,
                'prediction': float(final_prediction),
                'confidence_interval': confidence_interval,
                'method': 'conservative_baseline',
                'factors': {
                    'platform_baseline': platform_baseline,
                    'conservative_factor': 0.5,
                    'reward_multiplier': reward_multiplier
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Baseline prediction failed: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def _get_platform_baseline_snap(self, platform: str) -> float:
        """Get platform baseline SNAP values"""
        platform_baselines = {
            'cookie.fun': 150.0,
            'kaito': 100.0,
            'default': 125.0
        }
        
        return platform_baselines.get(platform, platform_baselines['default'])

    async def predict_snap(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predict SNAP earnings for given content and context
        
        Args:
            features: Feature dictionary containing content, yapper, campaign, and timing features
            
        Returns:
            Prediction results with confidence intervals
        """
        try:
            # Load model if not already loaded
            if 'snap_predictor' not in self.models:
                await self._load_model_from_s3('snap_predictor')
                
            model_artifacts = self.models['snap_predictor']
            model = model_artifacts['model']
            scaler = model_artifacts['scaler']
            feature_names = model_artifacts['feature_names']
            
            # Prepare features
            feature_vector = self._prepare_feature_vector(features, feature_names)
            feature_vector_scaled = scaler.transform([feature_vector])
            
            # Make prediction
            prediction = model.predict(feature_vector_scaled)[0]
            
            # Calculate confidence interval using prediction interval from Random Forest
            predictions_trees = np.array([tree.predict(feature_vector_scaled)[0] for tree in model.estimators_])
            confidence_interval = {
                'lower': np.percentile(predictions_trees, 25),
                'upper': np.percentile(predictions_trees, 75),
                'std': np.std(predictions_trees)
            }
            
            return {
                'success': True,
                'prediction': float(prediction),
                'confidence_interval': confidence_interval,
                'feature_importance': dict(zip(feature_names, model.feature_importances_)),
                'model_version': model_artifacts.get('trained_at', 'unknown')
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to predict SNAP: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def predict_position_change(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predict leaderboard position change
        
        Args:
            features: Feature dictionary
            
        Returns:
            Position change prediction with probabilities
        """
        try:
            # Load model if not already loaded
            if 'position_predictor' not in self.models:
                await self._load_model_from_s3('position_predictor')
                
            model_artifacts = self.models['position_predictor']
            model = model_artifacts['model']
            scaler = model_artifacts['scaler']
            label_encoder = model_artifacts['label_encoder']
            feature_names = model_artifacts['feature_names']
            
            # Prepare features
            feature_vector = self._prepare_feature_vector(features, feature_names)
            feature_vector_scaled = scaler.transform([feature_vector])
            
            # Make prediction
            prediction_encoded = model.predict(feature_vector_scaled)[0]
            prediction_proba = model.predict_proba(feature_vector_scaled)[0]
            
            # Decode prediction
            prediction = label_encoder.inverse_transform([prediction_encoded])[0]
            
            # Get class probabilities
            class_probabilities = dict(zip(label_encoder.classes_, prediction_proba))
            
            return {
                'success': True,
                'prediction': prediction,
                'probabilities': class_probabilities,
                'confidence': float(max(prediction_proba)),
                'feature_importance': dict(zip(feature_names, model.feature_importances_)),
                'model_version': model_artifacts.get('trained_at', 'unknown')
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to predict position change: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    def _get_feature_columns(self, model_type: str) -> List[str]:
        """Get feature columns for specific model type"""
        config = self.platform_configs.get(self.platform, {})
        features = config.get('features', {})
        
        all_features = []
        for category, feature_list in features.items():
            all_features.extend(feature_list)
            
        # Add model-specific features
        if model_type == 'snap_predictor':
            all_features.extend(['predicted_engagement', 'content_length', 'hashtag_count'])
        elif model_type == 'position_predictor':
            all_features.extend(['current_position', 'predicted_snap', 'competitor_activity'])
            
        return all_features
        
    def _prepare_features(self, data: pd.DataFrame, feature_columns: List[str], 
                         target_column: str) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare features and target from DataFrame"""
        
        # Filter to available columns
        available_features = [col for col in feature_columns if col in data.columns]
        missing_features = [col for col in feature_columns if col not in data.columns]
        
        if missing_features:
            logger.warning(f"⚠️ Missing features: {missing_features}")
            
        # Handle missing values
        X = data[available_features].fillna(0).values
        y = data[target_column].fillna(0).values
        
        return X, y, available_features
        
    def _prepare_feature_vector(self, features: Dict[str, Any], feature_names: List[str]) -> List[float]:
        """Prepare feature vector from feature dictionary"""
        feature_vector = []
        
        for feature_name in feature_names:
            value = features.get(feature_name, 0)
            # Handle different data types
            if isinstance(value, (int, float)):
                feature_vector.append(float(value))
            elif isinstance(value, bool):
                feature_vector.append(float(value))
            else:
                feature_vector.append(0.0)  # Default for missing or non-numeric features
                
        return feature_vector
        
    def _categorize_position_changes(self, position_changes: np.ndarray) -> np.ndarray:
        """Categorize position changes into meaningful classes"""
        categories = []
        
        for change in position_changes:
            if change > 5:
                categories.append('significant_up')
            elif change > 0:
                categories.append('slight_up')
            elif change == 0:
                categories.append('stable')
            elif change > -5:
                categories.append('slight_down')
            else:
                categories.append('significant_down')
                
        return np.array(categories)
        
    async def _save_model_to_s3(self, model_artifacts: Dict[str, Any], model_type: str) -> str:
        """Save model artifacts to S3"""
        try:
            # Create timestamp for versioning
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            
            # S3 paths
            base_path = self.get_s3_model_path(model_type, timestamp)
            model_key = f"{base_path}model.pkl"
            metadata_key = f"{base_path}metadata.json"
            
            # Serialize model artifacts
            model_bytes = pickle.dumps(model_artifacts)
            
            # Upload model
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=model_key,
                Body=model_bytes,
                ContentType='application/octet-stream'
            )
            
            # Upload metadata
            metadata = {
                'platform': self.platform,
                'model_type': model_type,
                'trained_at': model_artifacts['trained_at'].isoformat(),
                'training_data_size': model_artifacts['training_data_size'],
                'metrics': model_artifacts['metrics'],
                'feature_names': model_artifacts['feature_names']
            }
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=metadata_key,
                Body=json.dumps(metadata, indent=2),
                ContentType='application/json'
            )
            
            # Update latest version
            latest_model_key = self.get_s3_model_path(model_type, "latest") + "model.pkl"
            latest_metadata_key = self.get_s3_model_path(model_type, "latest") + "metadata.json"
            
            # Copy to latest
            self.s3_client.copy_object(
                Bucket=self.bucket_name,
                CopySource={'Bucket': self.bucket_name, 'Key': model_key},
                Key=latest_model_key
            )
            
            self.s3_client.copy_object(
                Bucket=self.bucket_name,
                CopySource={'Bucket': self.bucket_name, 'Key': metadata_key},
                Key=latest_metadata_key
            )
            
            logger.info(f"✅ Model saved to S3: {model_key}")
            return f"s3://{self.bucket_name}/{model_key}"
            
        except Exception as e:
            logger.error(f"❌ Failed to save model to S3: {str(e)}")
            raise
            
    async def _load_model_from_s3(self, model_type: str, version: str = "latest") -> bool:
        """Load model artifacts from S3"""
        try:
            model_key = self.get_s3_model_path(model_type, version) + "model.pkl"
            
            # Download model
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=model_key)
            model_artifacts = pickle.loads(response['Body'].read())
            
            # Store in memory
            self.models[model_type] = model_artifacts
            
            logger.info(f"✅ Loaded model from S3: {model_key}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to load model from S3: {str(e)}")
            return False
            
    async def get_model_info(self, model_type: str) -> Dict[str, Any]:
        """Get information about a specific model"""
        try:
            metadata_key = self.get_s3_model_path(model_type, "latest") + "metadata.json"
            
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=metadata_key)
            metadata = json.loads(response['Body'].read())
            
            return {'success': True, 'metadata': metadata}
            
        except Exception as e:
            logger.error(f"❌ Failed to get model info: {str(e)}")
            return {'success': False, 'error': str(e)}
            
    async def list_available_models(self) -> Dict[str, Any]:
        """List all available models for this platform"""
        try:
            prefix = f"models/{self.platform}/"
            
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                Delimiter='/'
            )
            
            model_types = []
            if 'CommonPrefixes' in response:
                for prefix_info in response['CommonPrefixes']:
                    model_type = prefix_info['Prefix'].split('/')[-2]
                    model_types.append(model_type)
                    
            return {'success': True, 'available_models': model_types}
            
        except Exception as e:
            logger.error(f"❌ Failed to list models: {str(e)}")
            return {'success': False, 'error': str(e)}
