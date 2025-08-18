"""
ML Model Testing Endpoints

Comprehensive testing endpoints for all ML models:
1. SNAP Prediction Model
2. Position Change Predictor  
3. Twitter Engagement Prediction
4. Category Intelligence
5. ML-based ROI Calculator
6. Enhanced Feature Extraction
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from app.services.ml_model_framework import MLModelFramework
from app.services.advanced_ml_models import CategoryIntelligenceModel, TwitterEngagementMLModel, MLROICalculator
from app.services.enhanced_feature_extractor import EnhancedFeatureExtractor
from app.services.platform_yapper_service import PlatformYapperService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ml-testing", tags=["ML Model Testing"])

# ================================
# Request/Response Models
# ================================

class ContentTestRequest(BaseModel):
    content_text: str = Field(..., description="Content to analyze")
    platform: str = Field(default="cookie.fun", description="Platform (cookie.fun, kaito)")
    category: Optional[str] = Field(default=None, description="Content category")
    yapper_id: Optional[int] = Field(default=None, description="Platform yapper ID")
    twitter_handle: Optional[str] = Field(default=None, description="Twitter handle")
    campaign_context: Optional[Dict[str, Any]] = Field(default=None, description="Campaign context")

class EngagementTestRequest(BaseModel):
    content_text: str = Field(..., description="Content to analyze")
    platform: str = Field(default="cookie.fun", description="Platform")
    yapper_id: Optional[int] = Field(default=None, description="Platform yapper ID")
    twitter_handle: Optional[str] = Field(default=None, description="Twitter handle")

class ROITestRequest(BaseModel):
    content_text: str = Field(..., description="Content to analyze")
    content_cost: float = Field(..., description="Cost of content in USD")
    platform: str = Field(default="cookie.fun", description="Platform")
    yapper_id: Optional[int] = Field(default=None, description="Platform yapper ID")
    twitter_handle: Optional[str] = Field(default=None, description="Twitter handle")
    campaign_context: Optional[Dict[str, Any]] = Field(default=None, description="Campaign context")

class CategoryTestRequest(BaseModel):
    content_text: str = Field(..., description="Content to analyze")
    category: str = Field(..., description="Target category (gaming, defi, nft, meme, education)")
    platform: str = Field(default="cookie.fun", description="Platform")

class FeatureExtractionRequest(BaseModel):
    content_text: str = Field(default="", description="Content to analyze")
    platform: str = Field(default="cookie.fun", description="Platform")
    yapper_id: Optional[int] = Field(default=None, description="Platform yapper ID")
    twitter_handle: Optional[str] = Field(default=None, description="Twitter handle")
    campaign_context: Optional[Dict[str, Any]] = Field(default=None, description="Campaign context")

class ModelTrainingRequest(BaseModel):
    platform: str = Field(default="cookie.fun", description="Platform to train for")
    model_type: str = Field(..., description="Model type (engagement, roi, category)")
    force_retrain: bool = Field(default=False, description="Force retraining even if model exists")

class TestResult(BaseModel):
    success: bool
    model_type: str
    prediction: Optional[Dict[str, Any]] = None
    performance: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    execution_time: Optional[float] = None
    timestamp: str

# ================================
# SNAP Prediction Testing
# ================================

@router.post("/snap-prediction", response_model=TestResult)
async def test_snap_prediction(request: ContentTestRequest):
    """
    Test SNAP prediction model with content
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing SNAP prediction for platform: {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # Get platform yapper features if available
        yapper_service = PlatformYapperService()
        feature_result = await yapper_service.get_yapper_prediction_features(
            request.yapper_id, 
            request.content_text, 
            request.campaign_context or {}
        )
        
        if not feature_result['success']:
            return TestResult(
                success=False,
                model_type="snap_prediction",
                error=feature_result.get('error', 'Feature extraction failed'),
                execution_time=(datetime.now() - start_time).total_seconds(),
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Make SNAP prediction
        prediction_result = await ml_framework.predict_snap_for_yapper(
            request.yapper_id or 0,
            request.content_text,
            request.campaign_context or {}
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=prediction_result['success'],
            model_type="snap_prediction",
            prediction=prediction_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ SNAP prediction test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="snap_prediction",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Position Change Prediction Testing
# ================================

@router.post("/position-prediction", response_model=TestResult)
async def test_position_prediction(request: ContentTestRequest):
    """
    Test position change prediction model
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing position change prediction for platform: {request.platform}")
        
        # Initialize ML framework
        ml_framework = MLModelFramework(platform=request.platform)
        
        # First get SNAP prediction (required for position prediction)
        yapper_service = PlatformYapperService()
        feature_result = await yapper_service.get_yapper_prediction_features(
            request.yapper_id, 
            request.content_text, 
            request.campaign_context or {}
        )
        
        if not feature_result['success']:
            return TestResult(
                success=False,
                model_type="position_prediction",
                error="Feature extraction failed",
                execution_time=(datetime.now() - start_time).total_seconds(),
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Get SNAP prediction first
        snap_result = await ml_framework.predict_snap_for_yapper(
            request.yapper_id or 0,
            request.content_text,
            request.campaign_context or {}
        )
        
        if not snap_result['success']:
            return TestResult(
                success=False,
                model_type="position_prediction",
                error="SNAP prediction failed",
                execution_time=(datetime.now() - start_time).total_seconds(),
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Add SNAP prediction to features
        features = feature_result['features']
        features['predicted_snap'] = snap_result['prediction']
        
        # Predict position change
        position_result = await ml_framework.predict_position_change(features)
        
        # Combine results
        combined_result = {
            'snap_prediction': snap_result,
            'position_prediction': position_result,
            'experience_level': feature_result.get('experience_level')
        }
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=position_result['success'],
            model_type="position_prediction",
            prediction=combined_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Position prediction test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="position_prediction",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Twitter Engagement Prediction Testing
# ================================

@router.post("/engagement-prediction", response_model=TestResult)
async def test_engagement_prediction(request: EngagementTestRequest):
    """
    Test Twitter engagement prediction model
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing engagement prediction for platform: {request.platform}")
        
        # Initialize engagement model
        engagement_model = TwitterEngagementMLModel(platform=request.platform)
        
        # Predict engagement
        prediction_result = await engagement_model.predict_engagement(
            request.content_text,
            request.yapper_id,
            request.twitter_handle
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=prediction_result['success'],
            model_type="engagement_prediction",
            prediction=prediction_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Engagement prediction test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="engagement_prediction",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Category Intelligence Testing
# ================================

@router.post("/category-intelligence", response_model=TestResult)
async def test_category_intelligence(request: CategoryTestRequest):
    """
    Test category intelligence model
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing category intelligence for category: {request.category}")
        
        # Initialize category model
        category_model = CategoryIntelligenceModel(platform=request.platform)
        
        # Analyze category patterns
        pattern_result = await category_model.analyze_category_patterns(
            request.category, 
            request.platform
        )
        
        # Predict content success in category
        success_result = await category_model.predict_category_success(
            request.content_text,
            request.category
        )
        
        # Combine results
        combined_result = {
            'category_patterns': pattern_result,
            'content_success_prediction': success_result
        }
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=pattern_result['success'] and success_result['success'],
            model_type="category_intelligence",
            prediction=combined_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Category intelligence test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="category_intelligence",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# ROI Prediction Testing
# ================================

@router.post("/roi-prediction", response_model=TestResult)
async def test_roi_prediction(request: ROITestRequest):
    """
    Test ML-based ROI prediction model
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing ROI prediction for content cost: ${request.content_cost}")
        
        # Initialize ROI calculator
        roi_calculator = MLROICalculator(platform=request.platform)
        
        # Predict ROI
        prediction_result = await roi_calculator.predict_roi(
            request.content_text,
            request.content_cost,
            request.yapper_id,
            request.twitter_handle,
            request.campaign_context
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=prediction_result['success'],
            model_type="roi_prediction",
            prediction=prediction_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ ROI prediction test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="roi_prediction",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Feature Extraction Testing
# ================================

@router.post("/feature-extraction", response_model=TestResult)
async def test_feature_extraction(request: FeatureExtractionRequest):
    """
    Test enhanced feature extraction
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing feature extraction for platform: {request.platform}")
        
        # Initialize feature extractor
        feature_extractor = EnhancedFeatureExtractor()
        
        # Extract features
        extraction_result = await feature_extractor.extract_comprehensive_features(
            yapper_id=request.yapper_id,
            twitter_handle=request.twitter_handle,
            content_text=request.content_text,
            campaign_context=request.campaign_context,
            platform=request.platform
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=extraction_result['success'],
            model_type="feature_extraction",
            prediction=extraction_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Feature extraction test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type="feature_extraction",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Model Training Testing
# ================================

@router.post("/train-model", response_model=TestResult)
async def test_model_training(request: ModelTrainingRequest):
    """
    Test model training for different ML models
    """
    start_time = datetime.now()
    
    try:
        logger.info(f"🎯 Testing {request.model_type} model training for platform: {request.platform}")
        
        training_result = {}
        
        if request.model_type == "engagement":
            # Train engagement model
            engagement_model = TwitterEngagementMLModel(platform=request.platform)
            training_result = await engagement_model.train_engagement_models()
            
        elif request.model_type == "roi":
            # Train ROI model
            roi_calculator = MLROICalculator(platform=request.platform)
            training_result = await roi_calculator.train_roi_model()
            
        elif request.model_type == "snap":
            # Train SNAP model
            ml_framework = MLModelFramework(platform=request.platform)
            
            # Load training data (simplified - would need actual implementation)
            training_result = {
                'success': True,
                'message': 'SNAP model training would be implemented here',
                'note': 'SNAP model training requires additional implementation'
            }
            
        else:
            return TestResult(
                success=False,
                model_type=f"{request.model_type}_training",
                error=f"Unknown model type: {request.model_type}",
                execution_time=(datetime.now() - start_time).total_seconds(),
                timestamp=datetime.utcnow().isoformat()
            )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        return TestResult(
            success=training_result['success'],
            model_type=f"{request.model_type}_training",
            prediction=training_result,
            execution_time=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"❌ Model training test failed: {str(e)}")
        return TestResult(
            success=False,
            model_type=f"{request.model_type}_training",
            error=str(e),
            execution_time=(datetime.now() - start_time).total_seconds(),
            timestamp=datetime.utcnow().isoformat()
        )

# ================================
# Comprehensive Model Testing
# ================================

@router.post("/comprehensive-test", response_model=Dict[str, TestResult])
async def comprehensive_model_test(request: ContentTestRequest):
    """
    Run comprehensive test across all ML models
    """
    try:
        logger.info(f"🎯 Running comprehensive ML model test")
        
        results = {}
        
        # Test SNAP prediction
        try:
            snap_result = await test_snap_prediction(request)
            results['snap_prediction'] = snap_result
        except Exception as e:
            results['snap_prediction'] = TestResult(
                success=False,
                model_type="snap_prediction",
                error=str(e),
                execution_time=0,
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Test position prediction
        try:
            position_result = await test_position_prediction(request)
            results['position_prediction'] = position_result
        except Exception as e:
            results['position_prediction'] = TestResult(
                success=False,
                model_type="position_prediction",
                error=str(e),
                execution_time=0,
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Test engagement prediction
        try:
            engagement_request = EngagementTestRequest(
                content_text=request.content_text,
                platform=request.platform,
                yapper_id=request.yapper_id,
                twitter_handle=request.twitter_handle
            )
            engagement_result = await test_engagement_prediction(engagement_request)
            results['engagement_prediction'] = engagement_result
        except Exception as e:
            results['engagement_prediction'] = TestResult(
                success=False,
                model_type="engagement_prediction",
                error=str(e),
                execution_time=0,
                timestamp=datetime.utcnow().isoformat()
            )
        
        # Test category intelligence (if category provided)
        if request.category:
            try:
                category_request = CategoryTestRequest(
                    content_text=request.content_text,
                    category=request.category,
                    platform=request.platform
                )
                category_result = await test_category_intelligence(category_request)
                results['category_intelligence'] = category_result
            except Exception as e:
                results['category_intelligence'] = TestResult(
                    success=False,
                    model_type="category_intelligence",
                    error=str(e),
                    execution_time=0,
                    timestamp=datetime.utcnow().isoformat()
                )
        
        # Test feature extraction
        try:
            feature_request = FeatureExtractionRequest(
                content_text=request.content_text,
                platform=request.platform,
                yapper_id=request.yapper_id,
                twitter_handle=request.twitter_handle,
                campaign_context=request.campaign_context
            )
            feature_result = await test_feature_extraction(feature_request)
            results['feature_extraction'] = feature_result
        except Exception as e:
            results['feature_extraction'] = TestResult(
                success=False,
                model_type="feature_extraction",
                error=str(e),
                execution_time=0,
                timestamp=datetime.utcnow().isoformat()
            )
        
        return results
        
    except Exception as e:
        logger.error(f"❌ Comprehensive test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Model Performance Testing
# ================================

@router.get("/model-status/{platform}")
async def get_model_status(platform: str):
    """
    Get status of all ML models for a platform
    """
    try:
        status = {
            'platform': platform,
            'models': {},
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Check SNAP model
        try:
            ml_framework = MLModelFramework(platform=platform)
            status['models']['snap_predictor'] = {
                'available': True,
                'type': 'ml_framework',
                'status': 'ready'
            }
        except Exception as e:
            status['models']['snap_predictor'] = {
                'available': False,
                'error': str(e)
            }
        
        # Check engagement model
        try:
            engagement_model = TwitterEngagementMLModel(platform=platform)
            status['models']['engagement_predictor'] = {
                'available': True,
                'trained': engagement_model.is_trained,
                'type': 'twitter_engagement',
                'status': 'ready' if engagement_model.is_trained else 'needs_training'
            }
        except Exception as e:
            status['models']['engagement_predictor'] = {
                'available': False,
                'error': str(e)
            }
        
        # Check ROI model
        try:
            roi_calculator = MLROICalculator(platform=platform)
            status['models']['roi_calculator'] = {
                'available': True,
                'trained': roi_calculator.is_trained,
                'type': 'ml_roi',
                'status': 'ready' if roi_calculator.is_trained else 'needs_training'
            }
        except Exception as e:
            status['models']['roi_calculator'] = {
                'available': False,
                'error': str(e)
            }
        
        # Check category intelligence
        try:
            category_model = CategoryIntelligenceModel(platform=platform)
            status['models']['category_intelligence'] = {
                'available': True,
                'type': 'category_intelligence',
                'status': 'ready'
            }
        except Exception as e:
            status['models']['category_intelligence'] = {
                'available': False,
                'error': str(e)
            }
        
        # Check feature extractor
        try:
            feature_extractor = EnhancedFeatureExtractor()
            status['models']['feature_extractor'] = {
                'available': True,
                'type': 'enhanced_features',
                'status': 'ready'
            }
        except Exception as e:
            status['models']['feature_extractor'] = {
                'available': False,
                'error': str(e)
            }
        
        return status
        
    except Exception as e:
        logger.error(f"❌ Model status check failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# Quick Test Endpoints (Simplified)
# ================================

@router.get("/quick-test/{platform}")
async def quick_model_test(platform: str):
    """
    Quick test of all models with sample data
    """
    try:
        sample_content = "Excited about this new DeFi protocol! The yield farming opportunities look incredible. #DeFi #YieldFarming #Crypto"
        
        test_request = ContentTestRequest(
            content_text=sample_content,
            platform=platform,
            category="defi",
            campaign_context={
                'reward_pool': 10000,
                'category': 'defi',
                'competition_level': 50
            }
        )
        
        results = await comprehensive_model_test(test_request)
        
        # Summarize results
        summary = {
            'platform': platform,
            'test_content': sample_content,
            'models_tested': len(results),
            'successful_tests': len([r for r in results.values() if r.success]),
            'failed_tests': len([r for r in results.values() if not r.success]),
            'total_execution_time': sum(r.execution_time or 0 for r in results.values()),
            'test_results': results,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return summary
        
    except Exception as e:
        logger.error(f"❌ Quick test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
