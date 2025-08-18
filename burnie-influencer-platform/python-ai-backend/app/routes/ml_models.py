"""
ML Models API Routes

Provides endpoints for training and inference with ML models for attention economy platforms.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional
import pandas as pd
import logging
from datetime import datetime

from app.services.ml_model_framework import MLModelFramework
from app.services.twitter_intelligence_collector import TwitterIntelligenceCollector

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ml-models", tags=["ML Models"])

# Pydantic models for request/response
class TrainingRequest(BaseModel):
    platform: str = Field(..., description="Platform identifier (e.g., 'cookie.fun', 'kaito')")
    model_type: str = Field(..., description="Type of model to train ('snap_predictor', 'position_predictor')")
    data_source: str = Field(default="database", description="Source of training data")
    
class PredictionRequest(BaseModel):
    platform: str = Field(..., description="Platform identifier")
    model_type: str = Field(..., description="Type of model for prediction")
    features: Dict[str, Any] = Field(..., description="Feature dictionary for prediction")

class YapperPredictionRequest(BaseModel):
    platform: str = Field(..., description="Platform identifier")
    model_type: str = Field(..., description="Type of model for prediction")
    yapper_id: int = Field(..., description="Platform yapper ID")
    content_text: str = Field(..., description="Content to predict for")
    campaign_context: Dict[str, Any] = Field(..., description="Campaign information")
    
class IntelligenceCollectionRequest(BaseModel):
    platform_source: str = Field(..., description="Platform to collect intelligence for")
    yapper_handles: List[str] = Field(..., description="List of Twitter handles (without @)")
    batch_size: int = Field(default=10, description="Number of yappers to process in batch")

class TrainingResponse(BaseModel):
    success: bool
    message: str
    metrics: Optional[Dict[str, Any]] = None
    model_path: Optional[str] = None
    feature_importance: Optional[Dict[str, float]] = None
    
class PredictionResponse(BaseModel):
    success: bool
    prediction: Optional[Any] = None
    confidence: Optional[float] = None
    confidence_interval: Optional[Dict[str, float]] = None
    probabilities: Optional[Dict[str, float]] = None
    feature_importance: Optional[Dict[str, float]] = None
    model_version: Optional[str] = None
    error: Optional[str] = None

@router.post("/train", response_model=TrainingResponse)
async def train_model(request: TrainingRequest, background_tasks: BackgroundTasks):
    """
    Train ML model for specified platform and model type
    """
    try:
        logger.info(f"🎯 Training {request.model_type} for {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # Get training data
        training_data = await _get_training_data(request.platform, request.model_type)
        
        if training_data.empty:
            raise HTTPException(
                status_code=400, 
                detail=f"No training data available for {request.platform} {request.model_type}"
            )
            
        # Train model based on type
        if request.model_type == "snap_predictor":
            result = await ml_framework.train_snap_predictor(training_data)
        elif request.model_type == "position_predictor":
            result = await ml_framework.train_position_predictor(training_data)
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported model type: {request.model_type}"
            )
            
        if result['success']:
            return TrainingResponse(
                success=True,
                message=f"Successfully trained {request.model_type} for {request.platform}",
                metrics=result['metrics'],
                model_path=result['model_path'],
                feature_importance=result.get('feature_importance')
            )
        else:
            raise HTTPException(status_code=500, detail=result.get('error', 'Training failed'))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Training failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict-for-yapper", response_model=PredictionResponse)
async def predict_for_yapper(request: YapperPredictionRequest):
    """
    Make prediction for a specific platform yapper with comprehensive feature extraction
    Handles both novice and experienced yappers
    """
    try:
        logger.info(f"🎯 Making prediction for yapper {request.yapper_id} on {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # Make yapper-specific prediction
        if request.model_type == "snap_predictor":
            result = await ml_framework.predict_snap_for_yapper(
                request.yapper_id, request.content_text, request.campaign_context
            )
        elif request.model_type == "position_predictor":
            # For position predictor, we first need SNAP prediction
            snap_result = await ml_framework.predict_snap_for_yapper(
                request.yapper_id, request.content_text, request.campaign_context
            )
            
            if snap_result['success']:
                # Add predicted SNAP to campaign context for position prediction
                extended_context = {**request.campaign_context, 'predicted_snap': snap_result['prediction']}
                # Get features and then predict position
                from app.services.platform_yapper_service import PlatformYapperService
                yapper_service = PlatformYapperService()
                feature_result = await yapper_service.get_yapper_prediction_features(
                    request.yapper_id, request.content_text, extended_context
                )
                
                if feature_result['success']:
                    features = feature_result['features']
                    features['predicted_snap'] = snap_result['prediction']
                    result = await ml_framework.predict_position_change(features)
                    if result['success']:
                        result['snap_prediction'] = snap_result['prediction']
                        result['experience_level'] = feature_result['experience_level']
                else:
                    result = {'success': False, 'error': 'Failed to get yapper features'}
            else:
                result = {'success': False, 'error': 'Failed to predict SNAP for position calculation'}
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported model type: {request.model_type}"
            )
            
        if result['success']:
            return PredictionResponse(
                success=True,
                prediction=result.get('prediction'),
                confidence=result.get('confidence'),
                confidence_interval=result.get('confidence_interval'),
                probabilities=result.get('probabilities'),
                feature_importance=result.get('feature_importance'),
                model_version=result.get('model_version')
            )
        else:
            return PredictionResponse(
                success=False,
                error=result.get('error', 'Prediction failed')
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Yapper prediction failed: {str(e)}")
        return PredictionResponse(success=False, error=str(e))

@router.post("/predict", response_model=PredictionResponse)
async def make_prediction(request: PredictionRequest):
    """
    Make prediction using trained ML model
    """
    try:
        logger.info(f"🎯 Making prediction with {request.model_type} for {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # Make prediction based on type
        if request.model_type == "snap_predictor":
            result = await ml_framework.predict_snap(request.features)
        elif request.model_type == "position_predictor":
            result = await ml_framework.predict_position_change(request.features)
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported model type: {request.model_type}"
            )
            
        if result['success']:
            return PredictionResponse(
                success=True,
                prediction=result.get('prediction'),
                confidence=result.get('confidence'),
                confidence_interval=result.get('confidence_interval'),
                probabilities=result.get('probabilities'),
                feature_importance=result.get('feature_importance'),
                model_version=result.get('model_version')
            )
        else:
            return PredictionResponse(
                success=False,
                error=result.get('error', 'Prediction failed')
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Prediction failed: {str(e)}")
        return PredictionResponse(success=False, error=str(e))

@router.get("/models/{platform}")
async def list_platform_models(platform: str):
    """
    List available models for a platform
    """
    try:
        ml_framework = MLModelFramework(platform=platform)
        result = await ml_framework.list_available_models()
        
        if result['success']:
            return {
                "success": True,
                "platform": platform,
                "available_models": result['available_models']
            }
        else:
            raise HTTPException(status_code=500, detail=result.get('error'))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to list models: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/models/{platform}/{model_type}/info")
async def get_model_info(platform: str, model_type: str):
    """
    Get information about a specific model
    """
    try:
        ml_framework = MLModelFramework(platform=platform)
        result = await ml_framework.get_model_info(model_type)
        
        if result['success']:
            return {
                "success": True,
                "platform": platform,
                "model_type": model_type,
                "metadata": result['metadata']
            }
        else:
            raise HTTPException(status_code=404, detail=f"Model not found: {platform}/{model_type}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get model info: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/intelligence/collect")
async def collect_yapper_intelligence(request: IntelligenceCollectionRequest, background_tasks: BackgroundTasks):
    """
    Collect intelligence from leaderboard yappers' Twitter content
    """
    try:
        logger.info(f"🎯 Starting intelligence collection for {len(request.yapper_handles)} yappers on {request.platform_source}")
        
        # Initialize intelligence collector
        collector = TwitterIntelligenceCollector()
        
        # Process in background for large batches
        if len(request.yapper_handles) > request.batch_size:
            background_tasks.add_task(
                _process_intelligence_collection_background,
                collector,
                request.yapper_handles,
                request.platform_source
            )
            
            return {
                "success": True,
                "message": f"Started background processing for {len(request.yapper_handles)} yappers",
                "processing_mode": "background"
            }
        else:
            # Process immediately for small batches
            result = await collector.collect_batch_intelligence(
                request.yapper_handles, 
                request.platform_source
            )
            
            return {
                "success": True,
                "message": "Intelligence collection completed",
                "results": result,
                "processing_mode": "immediate"
            }
            
    except Exception as e:
        logger.error(f"❌ Intelligence collection failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/collect-platform-yapper-profile")
async def collect_platform_yapper_profile(yapper_id: int, twitter_handle: str):
    """
    Collect comprehensive Twitter profile for a platform yapper
    """
    try:
        from app.services.platform_yapper_service import PlatformYapperService
        
        yapper_service = PlatformYapperService()
        result = await yapper_service.collect_yapper_twitter_profile(yapper_id, twitter_handle)
        
        if result['success']:
            return {
                "success": True,
                "message": f"Successfully collected profile for yapper {yapper_id} (@{twitter_handle})",
                "profile_data": result['profile_data'],
                "tweets_stored": result['tweets_stored'],
                "experience_level": result['experience_level']
            }
        else:
            return {
                "success": False,
                "message": f"Failed to collect profile for yapper {yapper_id}",
                "error": result['error']
            }
            
    except Exception as e:
        logger.error(f"❌ Platform yapper profile collection failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/intelligence/analyze-single")
async def analyze_single_yapper(yapper_handle: str, platform_source: str):
    """
    Analyze intelligence for a single yapper
    """
    try:
        collector = TwitterIntelligenceCollector()
        result = await collector.collect_yapper_intelligence(yapper_handle, platform_source)
        
        if result:
            return {
                "success": True,
                "yapper_handle": yapper_handle,
                "platform_source": platform_source,
                "results": result
            }
        else:
            return {
                "success": False,
                "message": f"Failed to collect intelligence for @{yapper_handle}"
            }
            
    except Exception as e:
        logger.error(f"❌ Single yapper analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/features/extract")
async def extract_content_features(content_text: str, platform: str):
    """
    Extract features from content for model prediction
    """
    try:
        # This would integrate with the Anthropic analysis
        from app.services.llm_providers import LLMProviderService
        
        llm_service = LLMProviderService()
        
        # Analyze content with Anthropic
        analysis_prompt = f"""
        Analyze this content for {platform} platform success prediction.
        
        Content: "{content_text}"
        
        Provide analysis in JSON format:
        {{
            "quality_score": <score_out_of_10>,
            "viral_potential": <score_out_of_10>,
            "category_relevance": <score_out_of_10>,
            "engagement_hooks": <count_of_hooks>,
            "content_length": <character_count>,
            "hashtag_count": <number_of_hashtags>,
            "mention_count": <number_of_mentions>,
            "sentiment_score": <-1_to_1>,
            "category_classification": "<gaming/defi/nft/meme/education/other>",
            "predicted_engagement": <estimated_engagement_score>
        }}
        """
        
        analysis = await llm_service.analyze_text_content(analysis_prompt, provider="anthropic")
        
        # Parse JSON response
        import json
        try:
            features = json.loads(analysis)
            return {
                "success": True,
                "features": features,
                "content_text": content_text,
                "platform": platform
            }
        except json.JSONDecodeError:
            # Fallback to basic feature extraction
            features = _extract_basic_features(content_text)
            return {
                "success": True,
                "features": features,
                "content_text": content_text,
                "platform": platform,
                "note": "Used basic feature extraction due to JSON parsing error"
            }
            
    except Exception as e:
        logger.error(f"❌ Feature extraction failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Helper functions

async def _get_training_data(platform: str, model_type: str) -> pd.DataFrame:
    """
    Fetch training data from database based on platform and model type
    """
    try:
        # This would connect to the TypeScript backend to get training data
        import requests
        from app.config.settings import settings
        
        response = requests.get(
            f"{settings.TYPESCRIPT_BACKEND_URL}/api/ml-training-data/{platform}/{model_type}",
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            return pd.DataFrame(data.get('training_data', []))
        else:
            logger.error(f"Failed to fetch training data: {response.status_code}")
            return pd.DataFrame()
            
    except Exception as e:
        logger.error(f"❌ Error fetching training data: {str(e)}")
        return pd.DataFrame()

async def _process_intelligence_collection_background(collector: TwitterIntelligenceCollector, 
                                                    yapper_handles: List[str], 
                                                    platform_source: str):
    """
    Background task for processing large intelligence collection batches
    """
    try:
        logger.info(f"🎯 Starting background intelligence collection for {len(yapper_handles)} yappers")
        
        result = await collector.collect_batch_intelligence(yapper_handles, platform_source)
        
        logger.info(f"✅ Background intelligence collection completed: {result}")
        
        # Optionally send notification or webhook about completion
        
    except Exception as e:
        logger.error(f"❌ Background intelligence collection failed: {str(e)}")

def _extract_basic_features(content_text: str) -> Dict[str, Any]:
    """
    Extract basic features from content text as fallback
    """
    import re
    
    features = {
        "content_length": len(content_text),
        "word_count": len(content_text.split()),
        "hashtag_count": len(re.findall(r'#\w+', content_text)),
        "mention_count": len(re.findall(r'@\w+', content_text)),
        "url_count": len(re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', content_text)),
        "exclamation_count": content_text.count('!'),
        "question_count": content_text.count('?'),
        "uppercase_ratio": sum(1 for c in content_text if c.isupper()) / len(content_text) if content_text else 0,
        "quality_score": 5.0,  # Default neutral score
        "viral_potential": 5.0,
        "category_relevance": 5.0,
        "predicted_engagement": 100.0  # Default baseline
    }
    
    return features
