"""
Mindshare Prediction Routes
===========================

Public endpoints for mindshare prediction using trained ML models.
These endpoints can be used to test and debug mindshare models.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
from pydantic import BaseModel

try:
    from app.utils.mindshare_ml_trainer import trainer
    ML_TRAINER_AVAILABLE = True
except ImportError as e:
    trainer = None
    ML_TRAINER_AVAILABLE = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mindshare", tags=["Mindshare Prediction"])

class PredictionRequest(BaseModel):
    content_text: str
    platform_source: str
    campaign_context: Optional[Dict[str, Any]] = None
    algorithm: Optional[str] = None

class PredictionResponse(BaseModel):
    success: bool
    mindshare_score: float
    confidence_level: float
    platform_source: str
    algorithm: str
    feature_count: int
    prediction_timestamp: str
    content_analysis: Optional[Dict[str, Any]] = None

class BatchPredictionRequest(BaseModel):
    predictions: List[PredictionRequest]

class ComparisonRequest(BaseModel):
    content_text: str
    platforms: List[str]
    campaign_context: Optional[Dict[str, Any]] = None
    algorithm: Optional[str] = None

@router.post("/predict", response_model=PredictionResponse)
async def predict_mindshare(request: PredictionRequest):
    """
    Predict mindshare score for given content on a specific platform.
    
    This endpoint uses trained ML models to predict the mindshare performance
    of content based on various features including text analysis, platform-specific
    patterns, and campaign context.
    """
    if not ML_TRAINER_AVAILABLE:
        raise HTTPException(
            status_code=503, 
            detail="ML prediction not available. Please fix dependency conflicts and restart the server."
        )
    
    try:
        # Validate platform
        df = await trainer.load_training_data()
        available_platforms = df['platform_source'].unique().tolist()
        
        if request.platform_source not in available_platforms:
            raise HTTPException(
                status_code=400, 
                detail=f"Platform '{request.platform_source}' not available. Available platforms: {available_platforms}"
            )
        
        # Make prediction
        result = await trainer.predict(
            content_text=request.content_text,
            platform_source=request.platform_source,
            campaign_context=request.campaign_context,
            algorithm=request.algorithm
        )
        
        if 'error' in result:
            raise HTTPException(status_code=500, detail=result['error'])
        
        # Extract content features for analysis
        content_features = trainer.extract_content_features(request.content_text)
        
        return PredictionResponse(
            success=True,
            mindshare_score=result['mindshare_score'],
            confidence_level=result['confidence_level'],
            platform_source=result['platform_source'],
            algorithm=result['algorithm'],
            feature_count=result['feature_count'],
            prediction_timestamp=result['prediction_timestamp'],
            content_analysis=content_features
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@router.post("/predict-batch")
async def predict_mindshare_batch(request: BatchPredictionRequest):
    """
    Predict mindshare scores for multiple content pieces in batch.
    Useful for testing multiple variations or platforms at once.
    """
    try:
        if len(request.predictions) > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 predictions per batch")
        
        results = []
        errors = []
        
        for i, pred_request in enumerate(request.predictions):
            try:
                result = await trainer.predict(
                    content_text=pred_request.content_text,
                    platform_source=pred_request.platform_source,
                    campaign_context=pred_request.campaign_context,
                    algorithm=pred_request.algorithm
                )
                
                if 'error' not in result:
                    results.append({
                        "index": i,
                        "success": True,
                        **result
                    })
                else:
                    errors.append({
                        "index": i,
                        "error": result['error']
                    })
                    
            except Exception as e:
                errors.append({
                    "index": i,
                    "error": str(e)
                })
        
        return JSONResponse(content={
            "total_predictions": len(request.predictions),
            "successful_predictions": len(results),
            "failed_predictions": len(errors),
            "results": results,
            "errors": errors
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Batch prediction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Batch prediction failed: {str(e)}")

@router.post("/compare-platforms")
async def compare_platforms(request: ComparisonRequest):
    """
    Compare predicted mindshare scores across multiple platforms for the same content.
    Useful for determining the best platform for a piece of content.
    """
    try:
        # Get available platforms
        df = await trainer.load_training_data()
        available_platforms = df['platform_source'].unique().tolist()
        
        # Validate requested platforms
        invalid_platforms = [p for p in request.platforms if p not in available_platforms]
        if invalid_platforms:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid platforms: {invalid_platforms}. Available: {available_platforms}"
            )
        
        comparisons = []
        for platform in request.platforms:
            try:
                result = await trainer.predict(
                    content_text=request.content_text,
                    platform_source=platform,
                    campaign_context=request.campaign_context,
                    algorithm=request.algorithm
                )
                
                if 'error' not in result:
                    comparisons.append({
                        "platform": platform,
                        "mindshare_score": result['mindshare_score'],
                        "confidence_level": result['confidence_level'],
                        "algorithm": result['algorithm']
                    })
                else:
                    comparisons.append({
                        "platform": platform,
                        "error": result['error']
                    })
                    
            except Exception as e:
                comparisons.append({
                    "platform": platform,
                    "error": str(e)
                })
        
        # Sort by mindshare score (highest first)
        successful_comparisons = [c for c in comparisons if 'error' not in c]
        failed_comparisons = [c for c in comparisons if 'error' in c]
        
        successful_comparisons.sort(key=lambda x: x['mindshare_score'], reverse=True)
        
        # Add recommendations
        recommendation = None
        if successful_comparisons:
            best_platform = successful_comparisons[0]
            recommendation = {
                "recommended_platform": best_platform['platform'],
                "expected_mindshare": best_platform['mindshare_score'],
                "confidence": best_platform['confidence_level'],
                "reason": f"Highest predicted mindshare score of {best_platform['mindshare_score']:.2f}"
            }
        
        return JSONResponse(content={
            "content_preview": request.content_text[:100] + "..." if len(request.content_text) > 100 else request.content_text,
            "platforms_compared": len(request.platforms),
            "successful_predictions": len(successful_comparisons),
            "failed_predictions": len(failed_comparisons),
            "comparisons": successful_comparisons,
            "failures": failed_comparisons,
            "recommendation": recommendation
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Platform comparison failed: {e}")
        raise HTTPException(status_code=500, detail=f"Platform comparison failed: {str(e)}")

@router.get("/analyze-content")
async def analyze_content(content_text: str):
    """
    Analyze content features without making predictions.
    Useful for understanding what features the ML model extracts from content.
    """
    try:
        if len(content_text) > 10000:
            raise HTTPException(status_code=400, detail="Content too long. Maximum 10,000 characters.")
        
        features = trainer.extract_content_features(content_text)
        
        # Add some analysis insights
        insights = []
        
        # Content length insights
        if features.get('content_length', 0) < 50:
            insights.append("Content is very short - consider expanding for better engagement")
        elif features.get('content_length', 0) > 280:
            insights.append("Content is long - consider shortening for social media")
        
        # Hashtag insights
        hashtag_count = features.get('hashtag_count', 0)
        if hashtag_count == 0:
            insights.append("No hashtags found - consider adding 1-3 relevant hashtags")
        elif hashtag_count > 5:
            insights.append("Too many hashtags - consider reducing to 3-5 for better appearance")
        
        # Emoji insights
        emoji_count = features.get('emoji_count', 0)
        if emoji_count == 0:
            insights.append("No emojis found - consider adding relevant emojis for visual appeal")
        elif emoji_count > 10:
            insights.append("Too many emojis - consider reducing for professional balance")
        
        # Crypto relevance
        crypto_terms = features.get('crypto_term_count', 0)
        if crypto_terms > 0:
            insights.append(f"Contains {crypto_terms} crypto-related terms - good for crypto audiences")
        
        # Readability
        reading_ease = features.get('flesch_reading_ease', 0)
        if reading_ease > 70:
            insights.append("High readability - easy to understand")
        elif reading_ease < 30:
            insights.append("Low readability - consider simplifying language")
        
        return JSONResponse(content={
            "content_preview": content_text[:200] + "..." if len(content_text) > 200 else content_text,
            "features": features,
            "insights": insights,
            "feature_count": len(features),
            "analysis_timestamp": datetime.now().isoformat()
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Content analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Content analysis failed: {str(e)}")

@router.get("/platforms")
async def get_available_platforms():
    """Get list of platforms available for prediction"""
    try:
        df = await trainer.load_training_data()
        platforms = df['platform_source'].unique().tolist()
        
        # Get platform statistics
        platform_stats = {}
        for platform in platforms:
            platform_data = df[df['platform_source'] == platform]
            platform_stats[platform] = {
                "training_samples": len(platform_data),
                "avg_mindshare_score": float(platform_data['mindshare_score'].mean()),
                "score_std": float(platform_data['mindshare_score'].std()),
                "min_score": float(platform_data['mindshare_score'].min()),
                "max_score": float(platform_data['mindshare_score'].max())
            }
        
        return JSONResponse(content={
            "available_platforms": platforms,
            "total_platforms": len(platforms),
            "platform_statistics": platform_stats
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to get platforms: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get platforms: {str(e)}")

@router.get("/health")
async def prediction_health_check():
    """Health check for prediction endpoints"""
    try:
        # Check if trainer is working
        df = await trainer.load_training_data()
        data_available = len(df) > 0
        
        # Check models directory
        import os
        models_exist = os.path.exists(trainer.models_dir)
        
        # Check if any models are trained
        trained_models = 0
        if models_exist:
            model_files = [f for f in os.listdir(trainer.models_dir) if f.endswith('_model.pkl')]
            trained_models = len(model_files)
        
        status = "healthy" if data_available and trained_models > 0 else "degraded"
        
        return JSONResponse(content={
            "status": status,
            "training_data_available": data_available,
            "training_records": len(df) if data_available else 0,
            "models_directory_exists": models_exist,
            "trained_models_count": trained_models,
            "available_platforms": df['platform_source'].unique().tolist() if data_available else [],
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"❌ Prediction health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        ) 