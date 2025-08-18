"""
Enhanced Model Training Endpoints with S3 Integration

Comprehensive training endpoints for all ML models with proper S3 storage:
1. SNAP Prediction Models (Random Forest, Ensemble)
2. Twitter Engagement Prediction Models
3. Category Intelligence Models 
4. ML-based ROI Prediction Models
5. Enhanced Feature Extraction Models
"""

import asyncio
import json
import logging
import pickle
import boto3
from datetime import datetime
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.services.ml_model_framework import MLModelFramework
from app.services.advanced_ml_models import CategoryIntelligenceModel, TwitterEngagementMLModel, MLROICalculator
from app.services.enhanced_feature_extractor import EnhancedFeatureExtractor
from app.utils.mindshare_ml_trainer import MindshareMLTrainer
from app.config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enhanced-training", tags=["Enhanced Model Training"])

# ================================
# Request/Response Models
# ================================

class ModelTrainingRequest(BaseModel):
    platform: str = Field(default="cookie.fun", description="Platform (cookie.fun, kaito)")
    model_type: str = Field(..., description="Model type to train")
    force_retrain: bool = Field(default=False, description="Force retraining even if model exists")
    upload_to_s3: bool = Field(default=True, description="Upload trained model to S3")
    training_parameters: Optional[Dict[str, Any]] = Field(default=None, description="Custom training parameters")

class TrainingResponse(BaseModel):
    success: bool
    model_type: str
    platform: str
    training_metrics: Optional[Dict[str, Any]] = None
    s3_model_path: Optional[str] = None
    local_model_path: Optional[str] = None
    feature_count: Optional[int] = None
    training_samples: Optional[int] = None
    execution_time: Optional[float] = None
    error: Optional[str] = None
    timestamp: str

class BulkTrainingRequest(BaseModel):
    platform: str = Field(default="cookie.fun", description="Platform to train models for")
    model_types: List[str] = Field(..., description="List of model types to train")
    upload_to_s3: bool = Field(default=True, description="Upload all models to S3")
    force_retrain: bool = Field(default=False, description="Force retrain all models")

class ModelListResponse(BaseModel):
    platform: str
    available_models: Dict[str, Dict[str, Any]]
    s3_models: List[str]
    local_models: List[str]
    timestamp: str

# ================================
# S3 Model Storage Integration
# ================================

class EnhancedS3ModelStorage:
    """Enhanced S3 model storage with organized structure"""
    
    def __init__(self, platform: str):
        self.platform = platform
        self.bucket_name = settings.s3_bucket_name or "burnie-ai-models"
        
        # Initialize S3 client if credentials available
        try:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.aws_access_key_id,
                aws_secret_access_key=settings.aws_secret_access_key,
                region_name=settings.aws_region or 'us-east-1'
            )
            self.s3_available = True
        except Exception as e:
            logger.warning(f"⚠️ S3 not available: {e}")
            self.s3_client = None
            self.s3_available = False
    
    def get_model_s3_path(self, model_type: str, version: str = None) -> str:
        """Generate organized S3 path for model storage
        Format: models/<Platform>/latest/ or models/<Platform>/<current_date>/
        """
        if version is None:
            version = "latest"
        elif version != "latest":
            # Convert timestamp to date format if needed
            if len(version) > 10:  # timestamp format
                try:
                    dt = datetime.strptime(version, "%Y%m%d_%H%M%S")
                    version = dt.strftime("%Y-%m-%d")
                except:
                    version = datetime.utcnow().strftime("%Y-%m-%d")
        
        return f"models/{self.platform}/{version}/"
    
    async def save_model_to_s3(
        self, 
        model_artifacts: Dict[str, Any], 
        model_type: str,
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """Save model artifacts to S3 with required structure:
        - models/<Platform>/latest/ (overwrite)
        - models/<Platform>/<current_date>/ (archive copy)
        """
        try:
            if not self.s3_available:
                return {'success': False, 'error': 'S3 not available'}
            
            current_date = datetime.utcnow().strftime("%Y-%m-%d")
            
            # Paths for both latest and date-based storage
            latest_path = self.get_model_s3_path(model_type, "latest")
            date_path = self.get_model_s3_path(model_type, current_date)
            
            # Prepare metadata
            full_metadata = {
                'model_type': model_type,
                'platform': self.platform,
                'date': current_date,
                'created_at': datetime.utcnow().isoformat(),
                'training_metadata': metadata or {},
                'latest_path': f"s3://{self.bucket_name}/{latest_path}",
                'archive_path': f"s3://{self.bucket_name}/{date_path}"
            }
            
            # Save all model files (support multiple pickle files + ensemble)
            saved_files = []
            
            # Handle different artifact structures
            if isinstance(model_artifacts, dict):
                # If artifacts is a dict of models, save each one
                for artifact_name, artifact_data in model_artifacts.items():
                    if artifact_data is not None:
                        # Save to date-based folder (archive)
                        date_key = f"{date_path}{artifact_name}.pkl"
                        latest_key = f"{latest_path}{artifact_name}.pkl"
                        
                        artifact_bytes = pickle.dumps(artifact_data)
                        
                        # Upload to date folder
                        self.s3_client.put_object(
                            Bucket=self.bucket_name,
                            Key=date_key,
                            Body=artifact_bytes,
                            ContentType='application/octet-stream'
                        )
                        
                        # Upload/overwrite to latest folder
                        self.s3_client.put_object(
                            Bucket=self.bucket_name,
                            Key=latest_key,
                            Body=artifact_bytes,
                            ContentType='application/octet-stream'
                        )
                        
                        saved_files.append(artifact_name)
            else:
                # Single model artifact
                artifact_bytes = pickle.dumps(model_artifacts)
                
                # Save to date-based folder
                date_key = f"{date_path}{model_type}.pkl"
                latest_key = f"{latest_path}{model_type}.pkl"
                
                # Upload to date folder
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=date_key,
                    Body=artifact_bytes,
                    ContentType='application/octet-stream'
                )
                
                # Upload/overwrite to latest folder
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=latest_key,
                    Body=artifact_bytes,
                    ContentType='application/octet-stream'
                )
                
                saved_files.append(model_type)
            
            # Save metadata to both locations
            metadata_bytes = json.dumps(full_metadata, indent=2).encode('utf-8')
            
            # Date-based metadata
            date_metadata_key = f"{date_path}metadata.json"
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=date_metadata_key,
                Body=metadata_bytes,
                ContentType='application/json'
            )
            
            # Latest metadata (overwrite)
            latest_metadata_key = f"{latest_path}metadata.json"
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=latest_metadata_key,
                Body=metadata_bytes,
                ContentType='application/json'
            )
            
            logger.info(f"✅ Models saved to S3:")
            logger.info(f"   📁 Latest: s3://{self.bucket_name}/{latest_path}")
            logger.info(f"   📁 Archive: s3://{self.bucket_name}/{date_path}")
            logger.info(f"   📦 Files: {saved_files}")
            
            return {
                'success': True,
                'latest_path': f"s3://{self.bucket_name}/{latest_path}",
                'archive_path': f"s3://{self.bucket_name}/{date_path}",
                'saved_files': saved_files,
                'date': current_date
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to save model to S3: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def load_model_from_s3(self, model_type: str, version: str = "latest") -> Dict[str, Any]:
        """Load model artifacts from S3"""
        try:
            if not self.s3_available:
                return {'success': False, 'error': 'S3 not available'}
            
            model_key = self.get_model_s3_path(model_type, version) + "model.pkl"
            
            # Download model
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=model_key)
            model_artifacts = pickle.loads(response['Body'].read())
            
            return {
                'success': True,
                'model_artifacts': model_artifacts,
                's3_path': f"s3://{self.bucket_name}/{model_key}"
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to load model from S3: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    async def list_s3_models(self) -> List[str]:
        """List all available models in S3 for this platform"""
        try:
            if not self.s3_available:
                return []
            
            prefix = f"ml-models/{self.platform}/"
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                Delimiter='/'
            )
            
            models = []
            for obj in response.get('CommonPrefixes', []):
                model_path = obj['Prefix']
                # Extract model type from path
                model_type = model_path.replace(prefix, '').rstrip('/')
                models.append(model_type)
            
            return models
            
        except Exception as e:
            logger.error(f"❌ Failed to list S3 models: {str(e)}")
            return []

# ================================
# Training Endpoints
# ================================

@router.post("/train-snap-predictor", response_model=TrainingResponse)
async def train_snap_predictor(request: ModelTrainingRequest):
    """Train SNAP prediction model with S3 storage"""
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training SNAP predictor for {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # Load training data from mindshare_training_data table
        trainer = MindshareMLTrainer()
        training_data = await trainer.load_training_data(request.platform)
        
        if training_data.empty:
            return TrainingResponse(
                success=False,
                model_type="snap_predictor",
                platform=request.platform,
                error=f"No training data available for {request.platform}",
                execution_time=(datetime.now() - start_time).total_seconds(),
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Train model
        training_result = await ml_framework.train_snap_predictor(training_data)
        
        s3_path = None
        if request.upload_to_s3 and training_result['success']:
            # Save to S3
            s3_storage = EnhancedS3ModelStorage(request.platform)
            s3_result = await s3_storage.save_model_to_s3(
                model_artifacts=ml_framework.models.get('snap_predictor'),
                model_type='snap_predictor',
                metadata=training_result
            )
            
            if s3_result['success']:
                s3_path = s3_result.get('latest_path', s3_result.get('s3_path'))
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result['success'],
            model_type="snap_predictor",
            platform=request.platform,
            training_metrics=training_result.get('metrics'),
            s3_model_path=s3_path,
            local_model_path=training_result.get('model_path'),
            feature_count=training_result.get('feature_count'),
            training_samples=len(training_data),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ SNAP predictor training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="snap_predictor",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/train-engagement-predictor", response_model=TrainingResponse)
async def train_engagement_predictor(request: ModelTrainingRequest):
    """Train Twitter engagement prediction model"""
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training engagement predictor for {request.platform}")
        
        # Initialize engagement model
        engagement_model = TwitterEngagementMLModel(platform=request.platform)
        
        # Train model
        training_result = await engagement_model.train_engagement_models()
        
        s3_path = None
        if request.upload_to_s3 and training_result['success']:
            # Prepare model artifacts
            model_artifacts = {
                'models': engagement_model.models,
                'scalers': engagement_model.scalers,
                'is_trained': engagement_model.is_trained
            }
            
            # Save to S3
            s3_storage = EnhancedS3ModelStorage(request.platform)
            s3_result = await s3_storage.save_model_to_s3(
                model_artifacts=model_artifacts,
                model_type='engagement_predictor',
                metadata=training_result
            )
            
            if s3_result['success']:
                s3_path = s3_result.get('latest_path', s3_result.get('s3_path'))
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result['success'],
            model_type="engagement_predictor",
            platform=request.platform,
            training_metrics=training_result.get('model_performance'),
            s3_model_path=s3_path,
            feature_count=training_result.get('feature_count'),
            training_samples=training_result.get('training_samples'),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Engagement predictor training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="engagement_predictor",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/train-roi-calculator", response_model=TrainingResponse)
async def train_roi_calculator(request: ModelTrainingRequest):
    """Train ML-based ROI calculator"""
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training ROI calculator for {request.platform}")
        
        # Initialize ROI calculator
        roi_calculator = MLROICalculator(platform=request.platform)
        
        # Train model
        training_result = await roi_calculator.train_roi_model()
        
        s3_path = None
        if request.upload_to_s3 and training_result['success']:
            # Prepare model artifacts
            model_artifacts = {
                'roi_model': roi_calculator.roi_model,
                'roi_scaler': roi_calculator.roi_scaler,
                'is_trained': roi_calculator.is_trained
            }
            
            # Save to S3
            s3_storage = EnhancedS3ModelStorage(request.platform)
            s3_result = await s3_storage.save_model_to_s3(
                model_artifacts=model_artifacts,
                model_type='roi_calculator',
                metadata=training_result
            )
            
            if s3_result['success']:
                s3_path = s3_result.get('latest_path', s3_result.get('s3_path'))
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result['success'],
            model_type="roi_calculator",
            platform=request.platform,
            training_metrics=training_result.get('performance'),
            s3_model_path=s3_path,
            feature_count=training_result.get('feature_count'),
            training_samples=training_result.get('training_samples'),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ ROI calculator training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="roi_calculator",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/train-ensemble-models", response_model=TrainingResponse)
async def train_ensemble_models(request: ModelTrainingRequest):
    """Train ensemble models using existing MindshareMLTrainer"""
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training ensemble models for {request.platform}")
        
        # Initialize trainer
        trainer = MindshareMLTrainer()
        
        # Train ensemble for platform
        training_result = await trainer.train_platform_ensemble(request.platform)
        
        s3_path = None
        # Check if training_result is valid (has platform_source key which indicates success)
        training_success = isinstance(training_result, dict) and 'platform_source' in training_result
        
        if request.upload_to_s3 and training_success:
            # The MindshareMLTrainer already saves locally, we just need to upload to S3
            model_artifacts = {
                'ensemble_metadata': training_result,
                'training_metrics': training_result.get('ensemble_metrics'),
                'platform': request.platform
            }
            
            # Save to S3
            s3_storage = EnhancedS3ModelStorage(request.platform)
            s3_result = await s3_storage.save_model_to_s3(
                model_artifacts=model_artifacts,
                model_type='ensemble_models',
                metadata=training_result
            )
            
            if s3_result['success']:
                s3_path = s3_result.get('latest_path', s3_result.get('s3_path'))
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_success,
            model_type="ensemble_models",
            platform=request.platform,
            training_metrics=training_result.get('ensemble_metrics') if training_success else None,
            s3_model_path=s3_path,
            local_model_path=training_result.get('ensemble_path') if training_success else None,
            feature_count=training_result.get('feature_count') if training_success else None,
            training_samples=training_result.get('training_samples') if training_success else None,
            execution_time=execution_time,
            error=None if training_success else str(training_result),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Ensemble models training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="ensemble_models",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/bulk-train", response_model=Dict[str, TrainingResponse])
async def bulk_train_models(request: BulkTrainingRequest, background_tasks: BackgroundTasks):
    """Train multiple models in bulk"""
    try:
        logger.info(f"🎯 Bulk training models for {request.platform}: {request.model_types}")
        
        results = {}
        
        # Available model types
        available_trainers = {
            'snap_predictor': train_snap_predictor,
            'engagement_predictor': train_engagement_predictor,
            'roi_calculator': train_roi_calculator,
            'ensemble_models': train_ensemble_models
        }
        
        # Train each requested model
        for model_type in request.model_types:
            if model_type not in available_trainers:
                results[model_type] = TrainingResponse(
                    success=False,
                    model_type=model_type,
                    platform=request.platform,
                    error=f"Unknown model type: {model_type}",
                    execution_time=0,
                    timestamp=datetime.utcnow().isoformat()
                )
                continue
            
            # Create training request
            training_request = ModelTrainingRequest(
                platform=request.platform,
                model_type=model_type,
                force_retrain=request.force_retrain,
                upload_to_s3=request.upload_to_s3
            )
            
            # Train model
            try:
                result = await available_trainers[model_type](training_request)
                results[model_type] = result
            except Exception as e:
                results[model_type] = TrainingResponse(
                    success=False,
                    model_type=model_type,
                    platform=request.platform,
                    error=str(e),
                    execution_time=0,
                    timestamp=datetime.utcnow().isoformat()
                )
        
        return results
        
    except Exception as e:
        logger.error(f"❌ Bulk training failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Model Management Endpoints
# ================================

@router.get("/list-models/{platform}", response_model=ModelListResponse)
async def list_available_models(platform: str):
    """List all available models for a platform"""
    try:
        # Check S3 models
        s3_storage = EnhancedS3ModelStorage(platform)
        s3_models = await s3_storage.list_s3_models()
        
        # Check local models
        local_models = []
        try:
            import os
            models_dir = f"models/mindshare"
            if os.path.exists(models_dir):
                for file in os.listdir(models_dir):
                    if file.startswith(platform) and file.endswith('.pkl'):
                        model_name = file.replace(f'{platform}_', '').replace('.pkl', '')
                        local_models.append(model_name)
        except Exception as e:
            logger.warning(f"⚠️ Could not list local models: {e}")
        
        # Get model info
        available_models = {}
        all_model_types = ['snap_predictor', 'engagement_predictor', 'roi_calculator', 'ensemble_models']
        
        for model_type in all_model_types:
            model_info = {
                'type': model_type,
                'available_in_s3': model_type in s3_models,
                'available_locally': any(model_type in model for model in local_models),
                'last_trained': None,
                'performance_metrics': None
            }
            
            # Try to get metadata from S3
            if model_info['available_in_s3']:
                try:
                    metadata_key = s3_storage.get_model_s3_path(model_type, "latest") + "metadata.json"
                    response = s3_storage.s3_client.get_object(
                        Bucket=s3_storage.bucket_name, 
                        Key=metadata_key
                    )
                    metadata = json.loads(response['Body'].read())
                    model_info['last_trained'] = metadata.get('created_at')
                    model_info['performance_metrics'] = metadata.get('training_metadata', {}).get('metrics')
                except Exception as e:
                    logger.warning(f"⚠️ Could not get S3 metadata for {model_type}: {e}")
            
            available_models[model_type] = model_info
        
        return ModelListResponse(
            platform=platform,
            available_models=available_models,
            s3_models=s3_models,
            local_models=local_models,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Failed to list models: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/download-model-from-s3")
async def download_model_from_s3(platform: str, model_type: str, version: str = "latest"):
    """Download a model from S3 to local storage"""
    try:
        s3_storage = EnhancedS3ModelStorage(platform)
        
        # Load model from S3
        result = await s3_storage.load_model_from_s3(model_type, version)
        
        if not result['success']:
            raise HTTPException(status_code=404, detail=result['error'])
        
        # Save locally (optional - could be used for caching)
        # This is just for demonstration - in production you might want to cache models locally
        
        return {
            'success': True,
            'message': f'Model {model_type} loaded from S3',
            's3_path': result['s3_path'],
            'version': version
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to download model from S3: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/delete-model")
async def delete_model(platform: str, model_type: str, version: str = None, delete_from_s3: bool = False):
    """Delete model from local storage and optionally from S3"""
    try:
        deleted_items = []
        
        # Delete from S3 if requested
        if delete_from_s3:
            s3_storage = EnhancedS3ModelStorage(platform)
            if s3_storage.s3_available:
                try:
                    if version:
                        # Delete specific version
                        model_key = s3_storage.get_model_s3_path(model_type, version) + "model.pkl"
                        metadata_key = s3_storage.get_model_s3_path(model_type, version) + "metadata.json"
                        
                        s3_storage.s3_client.delete_object(Bucket=s3_storage.bucket_name, Key=model_key)
                        s3_storage.s3_client.delete_object(Bucket=s3_storage.bucket_name, Key=metadata_key)
                        deleted_items.append(f"S3 version {version}")
                    else:
                        # Delete all versions (dangerous!)
                        prefix = f"ml-models/{platform}/{model_type}/"
                        response = s3_storage.s3_client.list_objects_v2(
                            Bucket=s3_storage.bucket_name,
                            Prefix=prefix
                        )
                        
                        for obj in response.get('Contents', []):
                            s3_storage.s3_client.delete_object(
                                Bucket=s3_storage.bucket_name, 
                                Key=obj['Key']
                            )
                        
                        deleted_items.append("All S3 versions")
                        
                except Exception as e:
                    logger.error(f"❌ Failed to delete from S3: {e}")
        
        # Delete local files
        try:
            import os
            models_dir = "models/mindshare"
            if os.path.exists(models_dir):
                for file in os.listdir(models_dir):
                    if file.startswith(f"{platform}_{model_type}"):
                        file_path = os.path.join(models_dir, file)
                        os.remove(file_path)
                        deleted_items.append(f"Local file: {file}")
        except Exception as e:
            logger.warning(f"⚠️ Could not delete local files: {e}")
        
        return {
            'success': True,
            'deleted_items': deleted_items,
            'platform': platform,
            'model_type': model_type
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to delete model: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Quick Training Endpoints
# ================================

@router.post("/quick-train-all")
async def quick_train_all_models(
    platform: str = "cookie.fun", 
    upload_to_s3: bool = True,
    background_tasks: BackgroundTasks = None
):
    """Quick endpoint to train all available models"""
    try:
        request = BulkTrainingRequest(
            platform=platform,
            model_types=['snap_predictor', 'engagement_predictor', 'roi_calculator', 'ensemble_models'],
            upload_to_s3=upload_to_s3,
            force_retrain=True
        )
        
        return await bulk_train_models(request, background_tasks)
        
    except Exception as e:
        logger.error(f"❌ Quick train all failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
