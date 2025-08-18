#!/usr/bin/env python3
"""
Test script for ML Model Framework

This script tests the basic functionality of the ML models framework
including Twitter intelligence collection and model training.
"""

import asyncio
import pandas as pd
import numpy as np
from datetime import datetime
import sys
import os

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from app.services.ml_model_framework import MLModelFramework
from app.services.twitter_intelligence_collector import TwitterIntelligenceCollector

async def test_platform_yapper_service():
    """Test platform yapper service for novice vs experienced yappers"""
    print("🎯 Testing Platform Yapper Service...")
    
    try:
        from app.services.platform_yapper_service import PlatformYapperService
        
        yapper_service = PlatformYapperService()
        
        # Test with a known crypto Twitter handle (simulating a platform yapper)
        test_yapper_id = 12345  # Mock yapper ID
        test_handle = "elonmusk"  # Public figure for testing
        
        print(f"📊 Collecting profile for yapper {test_yapper_id} (@{test_handle})")
        
        result = await yapper_service.collect_yapper_twitter_profile(test_yapper_id, test_handle)
        
        if result['success']:
            print(f"✅ Profile collection successful!")
            print(f"📊 Experience level: {result['experience_level']['level']}")
            print(f"📊 Experience score: {result['experience_level']['score']}")
            print(f"📊 Prediction strategy: {result['experience_level']['prediction_strategy']['approach']}")
            print(f"📊 Tweets stored: {result['tweets_stored']}")
        else:
            print(f"❌ Profile collection failed: {result['error']}")
            
        # Test feature extraction for prediction
        print(f"📊 Testing feature extraction for predictions...")
        
        content_text = "Excited about the latest DeFi innovations! #crypto #blockchain"
        campaign_context = {
            'platform': 'cookie.fun',
            'category': 'defi',
            'reward_pool': 50000,
            'competition_level': 60
        }
        
        feature_result = await yapper_service.get_yapper_prediction_features(
            test_yapper_id, content_text, campaign_context
        )
        
        if feature_result['success']:
            print(f"✅ Feature extraction successful!")
            print(f"📊 Experience level: {feature_result['experience_level']}")
            print(f"📊 Prediction approach: {feature_result['prediction_strategy']['approach']}")
            print(f"📊 Confidence multiplier: {feature_result['prediction_strategy']['confidence_multiplier']}")
            print(f"📊 Content quality score: {feature_result['features']['quality_score']}")
            print(f"📊 Historical performance: {feature_result['features']['historical_performance']}")
        else:
            print(f"❌ Feature extraction failed: {feature_result['error']}")
            
    except Exception as e:
        print(f"❌ Error in platform yapper service: {str(e)}")

async def test_twitter_intelligence():
    """Test Twitter intelligence collection"""
    print("🎯 Testing Twitter Intelligence Collection...")
    
    try:
        collector = TwitterIntelligenceCollector()
        
        # Test with a known crypto Twitter handle
        test_handle = "elonmusk"  # Public figure for testing
        platform = "cookie.fun"
        
        print(f"📊 Collecting intelligence for @{test_handle} on {platform}")
        
        result = await collector.collect_yapper_intelligence(test_handle, platform, leaderboard_position=1)
        
        if result:
            print(f"✅ Intelligence collection successful: {result}")
        else:
            print("❌ Intelligence collection failed")
            
    except Exception as e:
        print(f"❌ Error in intelligence collection: {str(e)}")

def test_ml_framework():
    """Test ML model framework with synthetic data"""
    print("🎯 Testing ML Model Framework...")
    
    try:
        # Initialize framework for Cookie.fun
        ml_framework = MLModelFramework(platform="cookie.fun")
        
        # Generate synthetic training data
        print("📊 Generating synthetic training data...")
        
        n_samples = 1000
        np.random.seed(42)
        
        training_data = pd.DataFrame({
            # Target variables
            'snap_earned': np.random.randint(0, 1000, n_samples),
            'position_change': np.random.randint(-20, 20, n_samples),
            
            # Content features
            'quality_score': np.random.uniform(1, 10, n_samples),
            'viral_potential': np.random.uniform(1, 10, n_samples),
            'category_relevance': np.random.uniform(1, 10, n_samples),
            'content_length': np.random.randint(50, 500, n_samples),
            'hashtag_count': np.random.randint(0, 10, n_samples),
            
            # Yapper features
            'historical_performance': np.random.uniform(0, 100, n_samples),
            'followers_count': np.random.randint(100, 100000, n_samples),
            'engagement_rate': np.random.uniform(0, 10, n_samples),
            'current_position': np.random.randint(1, 100, n_samples),
            
            # Campaign features
            'reward_pool': np.random.randint(1000, 100000, n_samples),
            'competition_level': np.random.uniform(1, 100, n_samples),
            
            # Timing features
            'hour_of_day': np.random.randint(0, 24, n_samples),
            'day_of_week': np.random.randint(0, 7, n_samples),
            
            # Engagement features
            'predicted_engagement': np.random.randint(0, 1000, n_samples),
        })
        
        print(f"✅ Generated {len(training_data)} training samples")
        print(f"📋 Features: {list(training_data.columns)}")
        
        return training_data, ml_framework
        
    except Exception as e:
        print(f"❌ Error in ML framework setup: {str(e)}")
        return None, None

async def test_snap_predictor(training_data, ml_framework):
    """Test SNAP prediction model training"""
    print("🎯 Testing SNAP Predictor Training...")
    
    try:
        result = await ml_framework.train_snap_predictor(training_data)
        
        if result['success']:
            print(f"✅ SNAP predictor trained successfully!")
            print(f"📊 Test R²: {result['metrics']['test_r2']:.3f}")
            print(f"📊 Test RMSE: {result['metrics']['test_rmse']:.3f}")
            print(f"📁 Model saved to: {result['model_path']}")
            
            # Test prediction
            test_features = {
                'quality_score': 8.5,
                'viral_potential': 7.2,
                'category_relevance': 9.0,
                'content_length': 280,
                'hashtag_count': 3,
                'historical_performance': 75.5,
                'followers_count': 10000,
                'engagement_rate': 5.5,
                'current_position': 25,
                'reward_pool': 50000,
                'competition_level': 60,
                'hour_of_day': 14,
                'day_of_week': 2,
                'predicted_engagement': 250,
            }
            
            print("🔮 Testing prediction...")
            prediction_result = await ml_framework.predict_snap(test_features)
            
            if prediction_result['success']:
                print(f"✅ Prediction successful: {prediction_result['prediction']:.2f} SNAP")
                print(f"📊 Confidence interval: {prediction_result['confidence_interval']['lower']:.2f} - {prediction_result['confidence_interval']['upper']:.2f}")
            else:
                print(f"❌ Prediction failed: {prediction_result['error']}")
                
        else:
            print(f"❌ SNAP predictor training failed: {result['error']}")
            
    except Exception as e:
        print(f"❌ Error in SNAP predictor testing: {str(e)}")

async def test_position_predictor(training_data, ml_framework):
    """Test position change prediction model training"""
    print("🎯 Testing Position Predictor Training...")
    
    try:
        result = await ml_framework.train_position_predictor(training_data)
        
        if result['success']:
            print(f"✅ Position predictor trained successfully!")
            print(f"📊 Test accuracy: {result['metrics']['test_accuracy']:.3f}")
            print(f"📁 Model saved to: {result['model_path']}")
            
            # Test prediction
            test_features = {
                'quality_score': 8.5,
                'viral_potential': 7.2,
                'category_relevance': 9.0,
                'content_length': 280,
                'hashtag_count': 3,
                'historical_performance': 75.5,
                'followers_count': 10000,
                'engagement_rate': 5.5,
                'current_position': 25,
                'reward_pool': 50000,
                'competition_level': 60,
                'hour_of_day': 14,
                'day_of_week': 2,
                'predicted_engagement': 250,
                'predicted_snap': 150,  # Added for position predictor
                'competitor_activity': 50,  # Added for position predictor
            }
            
            print("🔮 Testing position change prediction...")
            prediction_result = await ml_framework.predict_position_change(test_features)
            
            if prediction_result['success']:
                print(f"✅ Position prediction successful: {prediction_result['prediction']}")
                print(f"📊 Confidence: {prediction_result['confidence']:.3f}")
                print(f"📊 Probabilities: {prediction_result['probabilities']}")
            else:
                print(f"❌ Position prediction failed: {prediction_result['error']}")
                
        else:
            print(f"❌ Position predictor training failed: {result['error']}")
            
    except Exception as e:
        print(f"❌ Error in position predictor testing: {str(e)}")

async def test_model_management(ml_framework):
    """Test model management functionality"""
    print("🎯 Testing Model Management...")
    
    try:
        # List available models
        result = await ml_framework.list_available_models()
        if result['success']:
            print(f"✅ Available models: {result['available_models']}")
        else:
            print(f"❌ Failed to list models: {result['error']}")
            
        # Get model info
        for model_type in ['snap_predictor', 'position_predictor']:
            info_result = await ml_framework.get_model_info(model_type)
            if info_result['success']:
                metadata = info_result['metadata']
                print(f"✅ {model_type} info:")
                print(f"   - Trained at: {metadata['trained_at']}")
                print(f"   - Training samples: {metadata['training_data_size']}")
                print(f"   - Platform: {metadata['platform']}")
            else:
                print(f"❌ Failed to get {model_type} info: {info_result['error']}")
                
    except Exception as e:
        print(f"❌ Error in model management testing: {str(e)}")

async def main():
    """Main test function"""
    print("🚀 Starting ML Framework Tests...")
    print("=" * 60)
    
    # Test 1: ML Framework with synthetic data
    training_data, ml_framework = test_ml_framework()
    
    if training_data is not None and ml_framework is not None:
        print("\n" + "=" * 60)
        
        # Test 2: SNAP Predictor
        await test_snap_predictor(training_data, ml_framework)
        
        print("\n" + "=" * 60)
        
        # Test 3: Position Predictor  
        await test_position_predictor(training_data, ml_framework)
        
        print("\n" + "=" * 60)
        
        # Test 4: Model Management
        await test_model_management(ml_framework)
    
    print("\n" + "=" * 60)
    
    # Test 5: Platform Yapper Service (novice vs experienced)
    await test_platform_yapper_service()
    
    print("\n" + "=" * 60)
    
    # Test 6: Twitter Intelligence (requires API keys)
    print("⚠️  Skipping Twitter intelligence test (requires Twitter API keys)")
    # await test_twitter_intelligence()
    
    print("\n🎉 ML Framework tests completed!")

if __name__ == "__main__":
    asyncio.run(main())
