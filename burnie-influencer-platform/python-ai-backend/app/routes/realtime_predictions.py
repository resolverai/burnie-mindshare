"""
Real-time Prediction API Endpoints

Ultra-fast predictions for Content Marketplace interface.
NO LLM calls during predictions - uses only pre-computed features.
"""

import logging
from datetime import datetime
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.realtime_prediction_service import RealtimePredictionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/predictions", tags=["Real-time Predictions"])

# Request/Response models
class BatchPredictionRequest(BaseModel):
    yapper_handles: List[str]
    leaderboard_positions: Optional[Dict[str, int]] = None
    platform: str = "cookie.fun"

class PredictionResponse(BaseModel):
    success: bool
    predictions: Optional[dict] = None
    error: Optional[str] = None
    yapper_twitter_handle: Optional[str] = None
    features_used: Optional[int] = None
    data_sources: Optional[List[str]] = None
    prediction_timestamp: str

class BatchPredictionResponse(BaseModel):
    success: bool
    total_requested: int
    successful_predictions: int
    failed_predictions: int
    predictions: Optional[Dict[str, dict]] = None
    errors: Optional[Dict[str, str]] = None
    batch_timestamp: str

class ModelStatusResponse(BaseModel):
    platform: str
    models_loaded: bool
    model_status: Dict[str, bool]
    status_timestamp: str

# Global prediction service instances
_prediction_services = {}

def get_prediction_service(platform: str) -> RealtimePredictionService:
    """Get or create prediction service for platform"""
    if platform not in _prediction_services:
        _prediction_services[platform] = RealtimePredictionService(platform=platform)
    return _prediction_services[platform]

@router.post("/initialize/{platform}")
async def initialize_prediction_models(platform: str):
    """
    Initialize prediction models for a platform
    
    Call this endpoint once when starting the application to load all models
    for fast predictions.
    """
    try:
        logger.info(f"🚀 Initializing prediction models for {platform}")
        
        service = get_prediction_service(platform)
        result = await service.initialize_models()
        
        return {
            'success': result.get('success', False),
            'platform': platform,
            'models_initialized': result.get('models_loaded', {}),
            'details': result,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Model initialization failed for {platform}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/predict/{platform}/{twitter_handle}", response_model=PredictionResponse)
async def get_instant_prediction(
    platform: str, 
    twitter_handle: str,
    leaderboard_position: Optional[int] = Query(None, description="Current leaderboard position for position change prediction")
):
    """
    Get instant predictions for a single yapper
    
    Uses ONLY pre-computed features from:
    - platform_yapper_twitter_data (anthropic_analysis/openai_analysis)
    - yapper_cookie_profile  
    - platform_yapper_twitter_profiles
    
    NO LLM calls during prediction!
    """
    try:
        logger.info(f"⚡ Getting instant prediction for @{twitter_handle} on {platform}")
        
        service = get_prediction_service(platform)
        result = await service.get_instant_predictions(
            yapper_twitter_handle=twitter_handle,
            current_leaderboard_position=leaderboard_position
        )
        
        if not result.get('success'):
            raise HTTPException(status_code=404, detail=result.get('error', 'Prediction failed'))
        
        return PredictionResponse(
            success=result['success'],
            predictions=result.get('predictions'),
            yapper_twitter_handle=twitter_handle,
            features_used=result.get('features_used'),
            data_sources=result.get('data_sources'),
            prediction_timestamp=result.get('prediction_timestamp', datetime.utcnow().isoformat())
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Instant prediction failed for @{twitter_handle}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict-batch", response_model=BatchPredictionResponse)
async def get_batch_predictions(request: BatchPredictionRequest):
    """
    Get predictions for multiple yappers (Content Marketplace interface)
    
    Optimized for marketplace where many content cards need predictions.
    Processes all yappers concurrently for maximum speed.
    
    Uses ONLY pre-computed features - NO LLM calls!
    """
    try:
        logger.info(f"⚡ Getting batch predictions for {len(request.yapper_handles)} yappers on {request.platform}")
        
        if len(request.yapper_handles) == 0:
            raise HTTPException(status_code=400, detail="No yapper handles provided")
        
        if len(request.yapper_handles) > 100:
            raise HTTPException(status_code=400, detail="Maximum 100 yappers per batch request")
        
        service = get_prediction_service(request.platform)
        result = await service.get_batch_predictions(
            yapper_handles=request.yapper_handles,
            leaderboard_positions=request.leaderboard_positions
        )
        
        return BatchPredictionResponse(
            success=result['success'],
            total_requested=result['total_requested'],
            successful_predictions=result['successful_predictions'],
            failed_predictions=result['failed_predictions'],
            predictions=result.get('predictions'),
            errors=result.get('errors'),
            batch_timestamp=result.get('batch_timestamp', datetime.utcnow().isoformat())
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Batch prediction failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{platform}", response_model=ModelStatusResponse)
async def get_model_status(platform: str):
    """
    Get status of prediction models for a platform
    
    Check if models are loaded and ready for predictions.
    """
    try:
        service = get_prediction_service(platform)
        status = await service.get_model_status()
        
        return ModelStatusResponse(
            platform=status['platform'],
            models_loaded=status['models_loaded'],
            model_status=status['model_status'],
            status_timestamp=status['status_timestamp']
        )
        
    except Exception as e:
        logger.error(f"❌ Status check failed for {platform}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/available-platforms")
async def get_available_platforms():
    """
    Get list of platforms with active prediction services
    """
    try:
        platforms = {}
        
        for platform, service in _prediction_services.items():
            status = await service.get_model_status()
            platforms[platform] = {
                'models_loaded': status['models_loaded'],
                'model_status': status['model_status']
            }
        
        return {
            'success': True,
            'platforms': platforms,
            'total_platforms': len(platforms),
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Platform listing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Health check endpoint
@router.get("/health")
async def prediction_service_health():
    """
    Health check for prediction service
    """
    return {
        'status': 'healthy',
        'service': 'realtime_predictions',
        'active_platforms': len(_prediction_services),
        'timestamp': datetime.utcnow().isoformat()
    }

# Performance test endpoint  
@router.get("/performance-test/{platform}")
async def performance_test(
    platform: str,
    num_predictions: int = Query(10, description="Number of test predictions to make"),
    test_handle: str = Query("testuser", description="Test Twitter handle to use")
):
    """
    Performance test for prediction speed
    
    Measures how fast predictions can be made (should be sub-second)
    """
    try:
        if num_predictions > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 test predictions")
        
        service = get_prediction_service(platform)
        
        # Ensure models are loaded
        await service.initialize_models()
        
        start_time = datetime.now()
        
        # Make multiple predictions
        tasks = []
        import asyncio
        for i in range(num_predictions):
            task = service.get_instant_predictions(f"{test_handle}_{i}")
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        end_time = datetime.now()
        total_time = (end_time - start_time).total_seconds()
        
        successful = sum(1 for r in results if isinstance(r, dict) and r.get('success'))
        failed = len(results) - successful
        
        return {
            'success': True,
            'platform': platform,
            'test_predictions': num_predictions,
            'successful_predictions': successful,
            'failed_predictions': failed,
            'total_time_seconds': total_time,
            'average_time_per_prediction': total_time / num_predictions,
            'predictions_per_second': num_predictions / total_time if total_time > 0 else 0,
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Performance test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
