"""
Delta Models Training Endpoints

API endpoints for training:
1. Delta SNAP prediction models
2. Position change prediction models  
3. Twitter engagement prediction models
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.delta_prediction_models import DeltaSNAPPredictor, PositionChangePredictor
from app.services.twitter_engagement_ml_model import TwitterEngagementMLModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/delta-training", tags=["Delta Model Training"])

# Request models
class ModelTrainingRequest(BaseModel):
    platform: str = "cookie.fun"
    upload_to_s3: bool = False

class TrainingResponse(BaseModel):
    success: bool
    model_type: str
    platform: str
    training_metrics: Optional[dict] = None
    s3_model_path: Optional[str] = None
    local_model_path: Optional[str] = None
    feature_count: Optional[int] = None
    training_samples: Optional[int] = None
    execution_time: Optional[float] = None
    error: Optional[str] = None
    timestamp: str

@router.post("/train-delta-snap", response_model=TrainingResponse)
async def train_delta_snap_predictor(request: ModelTrainingRequest):
    """
    Train Delta SNAP prediction ensemble models
    
    Predicts how many SNAPs content will earn based on:
    - Pre-computed LLM features (content quality, viral potential, etc.)
    - Basic content features (length, sentiment, hashtags, etc.)
    - Yapper profile features
    - Temporal features
    - Campaign context
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training Delta SNAP predictor for {request.platform}")
        
        # Initialize predictor
        predictor = DeltaSNAPPredictor(platform=request.platform)
        
        # Train models
        training_result = await predictor.train_delta_snap_models()
        
        s3_path = None
        if request.upload_to_s3 and training_result.get('success'):
            # Save models locally first
            save_result = await predictor.save_model_to_disk()
            if save_result.get('success'):
                # TODO: Upload to S3 (implement S3 upload logic)
                s3_path = f"s3://models/{request.platform}/delta_snap_models/"
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result.get('success', False),
            model_type="delta_snap_predictor",
            platform=request.platform,
            training_metrics=training_result.get('ensemble_metrics'),
            s3_model_path=s3_path,
            local_model_path=f"./models/{request.platform}/delta_snap_models.pkl",
            feature_count=training_result.get('feature_count'),
            training_samples=training_result.get('training_samples'),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Delta SNAP training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="delta_snap_predictor",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/train-position-change", response_model=TrainingResponse)
async def train_position_change_predictor(request: ModelTrainingRequest):
    """
    Train leaderboard position change prediction model
    
    Predicts if content will help yapper climb up, stay stable, or go down
    on the leaderboard based on pre-computed features.
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training Position Change predictor for {request.platform}")
        
        # Initialize predictor
        predictor = PositionChangePredictor(platform=request.platform)
        
        # Train model
        training_result = await predictor.train_position_model()
        
        s3_path = None
        if request.upload_to_s3 and training_result.get('success'):
            # Save model locally first
            save_result = await predictor.save_model_to_disk()
            if save_result.get('success'):
                # TODO: Upload to S3
                s3_path = f"s3://models/{request.platform}/position_change_model/"
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result.get('success', False),
            model_type="position_change_predictor",
            platform=request.platform,
            training_metrics={'accuracy': training_result.get('accuracy')},
            s3_model_path=s3_path,
            local_model_path=f"./models/{request.platform}/position_change_model.pkl",
            feature_count=training_result.get('feature_count'),
            training_samples=training_result.get('training_samples'),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Position change training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="position_change_predictor",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/train-twitter-engagement", response_model=TrainingResponse)
async def train_twitter_engagement_predictor(request: ModelTrainingRequest):
    """
    Train Twitter engagement prediction ensemble models
    
    Predicts likes, retweets, replies based on:
    - Pre-computed LLM features (extracted during data collection)
    - Content features
    - Yapper profile features
    - Temporal features
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Training Twitter Engagement predictor for {request.platform}")
        
        # Initialize model
        engagement_model = TwitterEngagementMLModel(platform=request.platform)
        
        # Train models
        training_result = await engagement_model.train_engagement_models()
        
        s3_path = None
        if request.upload_to_s3 and training_result.get('success'):
            # Save models locally first
            save_result = await engagement_model.save_model_to_disk()
            if save_result.get('success'):
                # TODO: Upload to S3
                s3_path = f"s3://models/{request.platform}/twitter_engagement_models/"
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TrainingResponse(
            success=training_result.get('success', False),
            model_type="twitter_engagement_predictor",
            platform=request.platform,
            training_metrics=training_result.get('ensemble_metrics'),
            s3_model_path=s3_path,
            local_model_path=f"./models/{request.platform}/twitter_engagement_models.pkl",
            feature_count=training_result.get('feature_count'),
            training_samples=training_result.get('training_samples'),
            execution_time=execution_time,
            error=training_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Twitter engagement training failed: {str(e)}")
        return TrainingResponse(
            success=False,
            model_type="twitter_engagement_predictor",
            platform=request.platform,
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# Prediction endpoints (using ONLY pre-computed features)
class PredictionRequest(BaseModel):
    platform: str = "cookie.fun"
    content_features: dict  # Pre-computed features
    yapper_context: Optional[dict] = None  # Yapper profile data
    current_position: Optional[int] = None  # For position change prediction

class PredictionResponse(BaseModel):
    success: bool
    predictions: Optional[dict] = None
    model_type: str
    platform: str
    error: Optional[str] = None
    timestamp: str

@router.post("/predict-delta-snap", response_model=PredictionResponse)
async def predict_delta_snap(request: PredictionRequest):
    """
    Predict delta SNAPs for content using ONLY pre-computed features
    NO LLM calls during prediction!
    """
    try:
        predictor = DeltaSNAPPredictor(platform=request.platform)
        
        # Load model if not already loaded
        load_result = await predictor.load_model_from_disk()
        if not load_result.get('success'):
            raise HTTPException(status_code=404, detail="SNAP prediction model not found. Train the model first.")
        
        # Make prediction
        prediction_result = await predictor.predict_delta_snaps(
            content_features=request.content_features,
            yapper_context=request.yapper_context
        )
        
        return PredictionResponse(
            success=prediction_result.get('success', False),
            predictions=prediction_result,
            model_type="delta_snap_predictor",
            platform=request.platform,
            error=prediction_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Delta SNAP prediction failed: {str(e)}")
        return PredictionResponse(
            success=False,
            predictions=None,
            model_type="delta_snap_predictor",
            platform=request.platform,
            error=str(e),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/predict-position-change", response_model=PredictionResponse)
async def predict_position_change(request: PredictionRequest):
    """
    Predict leaderboard position change using ONLY pre-computed features
    NO LLM calls during prediction!
    """
    try:
        if request.current_position is None:
            raise HTTPException(status_code=400, detail="current_position is required for position change prediction")
        
        predictor = PositionChangePredictor(platform=request.platform)
        
        # Load model if not already loaded
        load_result = await predictor.load_model_from_disk()
        if not load_result.get('success'):
            raise HTTPException(status_code=404, detail="Position change model not found. Train the model first.")
        
        # Make prediction
        prediction_result = await predictor.predict_position_change(
            content_features=request.content_features,
            current_position=request.current_position,
            yapper_context=request.yapper_context
        )
        
        return PredictionResponse(
            success=prediction_result.get('success', False),
            predictions=prediction_result,
            model_type="position_change_predictor",
            platform=request.platform,
            error=prediction_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Position change prediction failed: {str(e)}")
        return PredictionResponse(
            success=False,
            predictions=None,
            model_type="position_change_predictor",
            platform=request.platform,
            error=str(e),
            timestamp=datetime.utcnow().isoformat()
        )

@router.post("/predict-twitter-engagement", response_model=PredictionResponse)
async def predict_twitter_engagement(request: PredictionRequest):
    """
    Predict Twitter engagement using ONLY pre-computed features
    NO LLM calls during prediction!
    """
    try:
        engagement_model = TwitterEngagementMLModel(platform=request.platform)
        
        # Load model if not already loaded
        load_result = await engagement_model.load_model_from_disk()
        if not load_result.get('success'):
            raise HTTPException(status_code=404, detail="Twitter engagement model not found. Train the model first.")
        
        # Make prediction
        prediction_result = await engagement_model.predict_twitter_engagement(
            content_features=request.content_features,
            yapper_context=request.yapper_context
        )
        
        return PredictionResponse(
            success=prediction_result.get('success', False),
            predictions=prediction_result,
            model_type="twitter_engagement_predictor",
            platform=request.platform,
            error=prediction_result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Twitter engagement prediction failed: {str(e)}")
        return PredictionResponse(
            success=False,
            predictions=None,
            model_type="twitter_engagement_predictor",
            platform=request.platform,
            error=str(e),
            timestamp=datetime.utcnow().isoformat()
        )

# Model status endpoints
@router.get("/model-status/{platform}")
async def get_model_status(platform: str):
    """Get status of all delta prediction models for a platform"""
    try:
        status = {}
        
        # Check Delta SNAP model
        snap_predictor = DeltaSNAPPredictor(platform=platform)
        snap_load = await snap_predictor.load_model_from_disk()
        status['delta_snap'] = {
            'available': snap_load.get('success', False),
            'models': snap_load.get('models_loaded', [])
        }
        
        # Check Position Change model
        position_predictor = PositionChangePredictor(platform=platform)
        position_load = await position_predictor.load_model_from_disk()
        status['position_change'] = {
            'available': position_load.get('success', False)
        }
        
        # Check Twitter Engagement model
        engagement_model = TwitterEngagementMLModel(platform=platform)
        engagement_load = await engagement_model.load_model_from_disk()
        status['twitter_engagement'] = {
            'available': engagement_load.get('success', False),
            'models': engagement_load.get('models_loaded', [])
        }
        
        return {
            'success': True,
            'platform': platform,
            'models': status,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Model status check failed: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }
