"""
Training Data Population Endpoints

API endpoints to populate training tables from existing LLM analysis
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.training_data_populator import TrainingDataPopulator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/training-data", tags=["Training Data Population"])

class PopulationResponse(BaseModel):
    success: bool
    records_found: Optional[int] = None
    records_processed: Optional[int] = None
    platform: Optional[str] = None
    error: Optional[str] = None
    timestamp: str

@router.post("/populate-from-existing/{platform}", response_model=PopulationResponse)
async def populate_training_data_from_existing(platform: str):
    """
    Populate training data tables from existing LLM analysis
    
    This endpoint extracts ML features from existing LLM analysis in the database
    and populates the training tables for model training.
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🔄 Starting training data population for {platform}")
        
        # Initialize populator
        populator = TrainingDataPopulator(platform=platform)
        
        # Populate training data
        result = await populator.populate_from_existing_analysis()
        
        execution_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"⏱️ Training data population completed in {execution_time:.2f}s")
        
        return PopulationResponse(
            success=result.get('success', False),
            records_found=result.get('records_found'),
            records_processed=result.get('records_processed'),
            platform=platform,
            error=result.get('error'),
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Training data population failed: {str(e)}")
        return PopulationResponse(
            success=False,
            error=str(e),
            platform=platform,
            timestamp=datetime.utcnow().isoformat()
        )

@router.get("/status/{platform}")
async def get_training_data_status(platform: str):
    """
    Get training data status for a platform
    
    Returns counts of training data available for model training.
    """
    try:
        import asyncpg
        from app.config.settings import settings
        
        conn = await asyncpg.connect(
            host=settings.database_host,
            port=settings.database_port,
            user=settings.database_user,
            password=settings.database_password,
            database=settings.database_name
        )
        
        # Count training data
        primary_count = await conn.fetchval(
            "SELECT COUNT(*) FROM primary_predictor_training_data WHERE platform_source = $1",
            platform
        )
        
        twitter_count = await conn.fetchval(
            "SELECT COUNT(*) FROM twitter_engagement_training_data WHERE platform_source = $1",
            platform
        )
        
        await conn.close()
        
        return {
            'success': True,
            'platform': platform,
            'training_data_counts': {
                'primary_predictor_training_data': primary_count,
                'twitter_engagement_training_data': twitter_count,
                'total': primary_count + twitter_count
            },
            'ready_for_training': {
                'snap_model': primary_count >= 30,
                'position_model': primary_count >= 20,
                'engagement_model': twitter_count >= 25
            },
            'timestamp': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Status check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
