"""
Admin ML Routes
===============

Admin endpoints for managing mindshare ML models including training, 
retraining, and model information.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
import os
import asyncio

try:
    from app.utils.mindshare_ml_trainer import trainer
    ML_TRAINER_AVAILABLE = True
except ImportError as e:
    logger.warning(f"⚠️ ML trainer not available due to dependency issue: {e}")
    trainer = None
    ML_TRAINER_AVAILABLE = False

from app.models.content_generation import MiningSession
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/ml", tags=["Admin ML"])

class TrainingRequest(BaseModel):
    platform_source: Optional[str] = None  # If None, train all platforms
    algorithm: Optional[str] = None  # If None, use default
    force_retrain: bool = False

class TrainingResponse(BaseModel):
    success: bool
    message: str
    training_id: str
    platforms: List[str]
    algorithm: str
    estimated_duration: str

class ModelInfo(BaseModel):
    platform_source: str
    algorithm: str
    training_samples: int
    test_samples: int
    metrics: Dict[str, float]
    trained_at: str
    model_path: str

# Background training status storage
training_status = {}

@router.post("/train-models", response_model=TrainingResponse)
async def train_mindshare_models(request: TrainingRequest, background_tasks: BackgroundTasks):
    """
    Train mindshare prediction models for specified platforms or all platforms.
    This operation runs in the background and can take several minutes.
    """
    if not ML_TRAINER_AVAILABLE:
        raise HTTPException(
            status_code=503, 
            detail="ML trainer not available. Please fix dependency conflicts and restart the server."
        )
    
    try:
        # Generate training ID
        training_id = f"training_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Initialize training status
        training_status[training_id] = {
            "status": "initializing",
            "progress": 0,
            "message": "Initializing training process...",
            "started_at": datetime.now().isoformat(),
            "platforms": [],
            "algorithm": request.algorithm or trainer.default_algorithm,
            "results": {}
        }
        
        # Determine platforms to train
        if request.platform_source:
            platforms = [request.platform_source]
        else:
            # Get all available platforms from data
            df = await trainer.load_training_data()
            platforms = df['platform_source'].unique().tolist()
        
        training_status[training_id]["platforms"] = platforms
        
        # Start background training
        background_tasks.add_task(
            run_training_background,
            training_id,
            platforms,
            request.algorithm,
            request.force_retrain
        )
        
        estimated_duration = f"{len(platforms) * 2-5} minutes"
        
        return TrainingResponse(
            success=True,
            message=f"Training started for {len(platforms)} platform(s)",
            training_id=training_id,
            platforms=platforms,
            algorithm=request.algorithm or trainer.default_algorithm,
            estimated_duration=estimated_duration
        )
        
    except Exception as e:
        logger.error(f"❌ Failed to start training: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start training: {str(e)}")

async def run_training_background(training_id: str, platforms: List[str], algorithm: Optional[str], force_retrain: bool):
    """Background task to run model training"""
    try:
        algorithm = algorithm or trainer.default_algorithm
        total_platforms = len(platforms)
        
        # Update status
        training_status[training_id].update({
            "status": "training",
            "progress": 10,
            "message": f"Starting training for {total_platforms} platforms using {algorithm}..."
        })
        
        results = {}
        
        for i, platform in enumerate(platforms):
            platform_progress = int(10 + (i / total_platforms) * 80)
            training_status[training_id].update({
                "progress": platform_progress,
                "message": f"Training model for {platform} ({i+1}/{total_platforms})..."
            })
            
            try:
                # Check if model already exists
                ensemble_model_path = os.path.join(trainer.models_dir, f"{platform}_ensemble_models.pkl")
                if os.path.exists(ensemble_model_path) and not force_retrain:
                    results[platform] = {
                        "status": "skipped",
                        "message": "Ensemble model already exists. Use force_retrain=true to retrain."
                    }
                    continue
                
                # Train platform ensemble model
                metadata = await trainer.train_platform_ensemble(platform)
                if metadata:
                    results[platform] = {
                        "status": "success",
                        "metadata": metadata
                    }
                    logger.info(f"✅ Successfully trained ensemble for {platform}")
                else:
                    results[platform] = {
                        "status": "failed",
                        "message": "Ensemble training failed - check logs for details"
                    }
                    
            except Exception as e:
                logger.error(f"❌ Failed to train ensemble for {platform}: {e}")
                results[platform] = {
                    "status": "error",
                    "message": str(e)
                }
        
        # Final status update
        successful_platforms = [p for p, r in results.items() if r["status"] == "success"]
        failed_platforms = [p for p, r in results.items() if r["status"] in ["failed", "error"]]
        
        training_status[training_id].update({
            "status": "completed",
            "progress": 100,
            "message": f"Training completed. Success: {len(successful_platforms)}, Failed: {len(failed_platforms)}",
            "completed_at": datetime.now().isoformat(),
            "results": results,
            "summary": {
                "total_platforms": total_platforms,
                "successful": len(successful_platforms),
                "failed": len(failed_platforms),
                "skipped": len([p for p, r in results.items() if r["status"] == "skipped"])
            }
        })
        
        logger.info(f"🎉 Training {training_id} completed - {len(successful_platforms)}/{total_platforms} successful")
        
    except Exception as e:
        logger.error(f"❌ Background training failed: {e}")
        training_status[training_id].update({
            "status": "error",
            "progress": 0,
            "message": f"Training failed: {str(e)}",
            "error": str(e)
        })

@router.get("/training-status/{training_id}")
async def get_training_status(training_id: str):
    """Get the status of a training job"""
    if training_id not in training_status:
        raise HTTPException(status_code=404, detail="Training ID not found")
    
    return JSONResponse(content={
        "training_id": training_id,
        **training_status[training_id]
    })

@router.get("/training-history")
async def get_training_history():
    """Get history of all training jobs"""
    return JSONResponse(content={
        "training_jobs": list(training_status.keys()),
        "total_jobs": len(training_status),
        "active_jobs": len([t for t in training_status.values() if t["status"] in ["initializing", "training"]]),
        "completed_jobs": len([t for t in training_status.values() if t["status"] == "completed"]),
        "failed_jobs": len([t for t in training_status.values() if t["status"] == "error"]),
        "jobs": training_status
    })

@router.get("/models/info")
async def get_models_info():
    """Get information about all trained models"""
    if not ML_TRAINER_AVAILABLE:
        return JSONResponse(content={
            "error": "ML trainer not available due to dependency conflicts",
            "models_directory": None,
            "available_algorithms": [],
            "total_training_records": 0
        })
    
    try:
        model_info = trainer.get_model_info()
        
        # Add training data statistics
        df = await trainer.load_training_data()
        platform_stats = df.groupby('platform_source').agg({
            'mindshare_score': ['count', 'mean', 'std'],
            'content_text': 'count'
        }).round(4)
        
        model_info['training_data_stats'] = platform_stats.to_dict() if not platform_stats.empty else {}
        model_info['total_training_records'] = len(df)
        
        return JSONResponse(content=model_info)
        
    except Exception as e:
        logger.error(f"❌ Failed to get model info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get model info: {str(e)}")

@router.get("/models/performance")
async def get_model_performance():
    """Get detailed performance metrics for all trained models"""
    try:
        performance_data = {}
        
        if os.path.exists(trainer.models_dir):
            for file in os.listdir(trainer.models_dir):
                if file.endswith('_metadata.json'):
                    metadata_path = os.path.join(trainer.models_dir, file)
                    try:
                        import json
                        with open(metadata_path, 'r') as f:
                            metadata = json.load(f)
                        
                        platform = metadata.get('platform_source', 'unknown')
                        algorithm = metadata.get('algorithm', 'unknown')
                        key = f"{platform}_{algorithm}"
                        
                        performance_data[key] = {
                            'platform': platform,
                            'algorithm': algorithm,
                            'metrics': metadata.get('metrics', {}),
                            'training_info': {
                                'training_samples': metadata.get('training_samples', 0),
                                'test_samples': metadata.get('test_samples', 0),
                                'feature_count': metadata.get('feature_count', 0),
                                'trained_at': metadata.get('trained_at', '')
                            }
                        }
                    except Exception as e:
                        logger.error(f"Failed to read metadata file {file}: {e}")
        
        return JSONResponse(content={
            "total_models": len(performance_data),
            "models": performance_data
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to get model performance: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get model performance: {str(e)}")

@router.delete("/models/{platform_source}/{algorithm}")
async def delete_model(platform_source: str, algorithm: str):
    """Delete a specific trained model"""
    try:
        model_files = [
            os.path.join(trainer.models_dir, f"{platform_source}_{algorithm}_model.pkl"),
            os.path.join(trainer.models_dir, f"{platform_source}_{algorithm}_scaler.pkl"),
            os.path.join(trainer.models_dir, f"{platform_source}_{algorithm}_metadata.json")
        ]
        
        deleted_files = []
        for file_path in model_files:
            if os.path.exists(file_path):
                os.remove(file_path)
                deleted_files.append(os.path.basename(file_path))
        
        # Remove from memory if loaded
        model_key = f"{platform_source}_{algorithm}"
        if model_key in trainer.models:
            del trainer.models[model_key]
        if model_key in trainer.scalers:
            del trainer.scalers[model_key]
        
        return JSONResponse(content={
            "success": True,
            "message": f"Deleted model for {platform_source} using {algorithm}",
            "deleted_files": deleted_files
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to delete model: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {str(e)}")

@router.post("/retrain-all")
async def retrain_all_models(background_tasks: BackgroundTasks, algorithm: Optional[str] = None):
    """Retrain all models with latest data"""
    try:
        request = TrainingRequest(
            platform_source=None,  # All platforms
            algorithm=algorithm,
            force_retrain=True
        )
        
        return await train_mindshare_models(request, background_tasks)
        
    except Exception as e:
        logger.error(f"❌ Failed to start retraining: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start retraining: {str(e)}")

@router.get("/algorithms")
async def get_available_algorithms():
    """Get list of available ML algorithms"""
    return JSONResponse(content={
        "available_algorithms": list(trainer.algorithms.keys()),
        "default_algorithm": trainer.default_algorithm,
        "algorithm_descriptions": {
            "random_forest": "Random Forest - Ensemble method, good balance of performance and interpretability",
            "gradient_boosting": "Gradient Boosting - Sequential ensemble, often high accuracy",
            "linear_regression": "Linear Regression - Simple, fast, interpretable",
            "ridge_regression": "Ridge Regression - Linear with L2 regularization",
            "svr": "Support Vector Regression - Kernel-based, good for non-linear patterns"
        }
    })

@router.get("/health")
async def ml_health_check():
    """Health check for ML training system"""
    try:
        # Check models directory
        models_exist = os.path.exists(trainer.models_dir)
        
        # Check training data
        df = await trainer.load_training_data()
        data_available = len(df) > 0
        
        # Check loaded models
        models_loaded = len(trainer.models)
        
        health_status = {
            "status": "healthy" if models_exist and data_available else "degraded",
            "models_directory_exists": models_exist,
            "training_data_available": data_available,
            "training_records_count": len(df) if data_available else 0,
            "models_loaded_in_memory": models_loaded,
            "active_training_jobs": len([t for t in training_status.values() if t["status"] in ["initializing", "training"]]),
            "timestamp": datetime.now().isoformat()
        }
        
        return JSONResponse(content=health_status)
        
    except Exception as e:
        logger.error(f"❌ ML health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        ) 