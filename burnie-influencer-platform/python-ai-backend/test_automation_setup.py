#!/usr/bin/env python3
"""
Test script to verify automated content generation setup

This script tests the configuration and database connectivity
before running the full automation.
"""

import json
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

def test_configuration():
    """Test configuration file loading"""
    print("🔧 Testing configuration...")
    
    try:
        config_path = os.path.join(os.path.dirname(__file__), 'wallet_config.json')
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        print(f"✅ Configuration loaded from {config_path}")
        
        # Check wallet addresses
        wallets = config.get("wallet_addresses", [])
        print(f"💰 Found {len(wallets)} wallet addresses")
        
        for i, wallet in enumerate(wallets):
            if wallet.startswith("0x") and len(wallet) == 42:
                print(f"   ✅ Wallet {i+1}: {wallet[:10]}...{wallet[-10:]}")
            else:
                print(f"   ⚠️ Wallet {i+1}: Invalid format - {wallet}")
        
        # Check content generation settings
        content_config = config.get("content_generation", {})
        print(f"📝 Content types: {content_config.get('content_types', [])}")
        print(f"🔢 Content per type: {content_config.get('content_count_per_type', 0)}")
        
        return True
        
    except Exception as e:
        print(f"❌ Configuration test failed: {e}")
        return False

def test_environment():
    """Test environment variables"""
    print("\n🌍 Testing environment variables...")
    
    required_vars = [
        "DATABASE_HOST",
        "DATABASE_PORT", 
        "DATABASE_NAME",
        "DATABASE_USER",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "FAL_API_KEY"
    ]
    
    missing_vars = []
    
    for var in required_vars:
        value = os.getenv(var)
        if value:
            if "KEY" in var:
                print(f"   ✅ {var}: {'*' * 10}...{value[-4:]}")
            else:
                print(f"   ✅ {var}: {value}")
        else:
            print(f"   ❌ {var}: Not set")
            missing_vars.append(var)
    
    if missing_vars:
        print(f"⚠️ Missing environment variables: {missing_vars}")
        print(f"💡 Make sure .env file is in the same directory as the test script")
        return False
    
    print(f"✅ All required environment variables are set")
    return True

def test_database_connection():
    """Test database connection"""
    print("\n🗄️ Testing database connection...")
    
    try:
        from app.database.connection import get_db_session
        from app.database.repositories.campaign_repository import CampaignRepository
        
        db = get_db_session()
        campaign_repo = CampaignRepository()
        
        # Test connection by fetching campaigns
        campaigns = campaign_repo.get_active_campaigns()
        
        print(f"✅ Database connection successful")
        print(f"📊 Found {len(campaigns)} active campaigns")
        
        for campaign in campaigns[:3]:  # Show first 3 campaigns
            print(f"   📋 Campaign: {campaign.get('name', 'Unknown')} (ID: {campaign.get('id', 'Unknown')})")
        
        if len(campaigns) > 3:
            print(f"   ... and {len(campaigns) - 3} more campaigns")
        
        return True
        
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

def test_api_keys():
    """Test API key validity (basic check)"""
    print("\n🔑 Testing API keys...")
    
    try:
        from app.config.settings import settings
        
        # Check if keys are loaded
        openai_key = settings.openai_api_key
        anthropic_key = settings.anthropic_api_key
        fal_key = settings.fal_api_key
        
        if openai_key and len(openai_key) > 20:
            print(f"   ✅ OpenAI API Key: Valid format")
        else:
            print(f"   ❌ OpenAI API Key: Invalid or missing")
        
        if anthropic_key and len(anthropic_key) > 20:
            print(f"   ✅ Anthropic API Key: Valid format")
        else:
            print(f"   ❌ Anthropic API Key: Invalid or missing")
        
        if fal_key and len(fal_key) > 20:
            print(f"   ✅ FAL API Key: Valid format")
        else:
            print(f"   ❌ FAL API Key: Invalid or missing")
        
        return True
        
    except Exception as e:
        print(f"❌ API key test failed: {e}")
        return False

def test_content_marketplace_table():
    """Test content marketplace table access"""
    print("\n📦 Testing content marketplace table...")
    
    try:
        from app.database.connection import get_db_session
        from sqlalchemy import text
        
        db = get_db_session()
        
        # Test query to content_marketplace table
        query = text("""
            SELECT COUNT(*) as total_content,
                   COUNT("contentImages") as content_with_images,
                   COUNT("watermarkImage") as content_with_watermarks
            FROM content_marketplace 
            WHERE "createdAt" >= NOW() - INTERVAL '7 days'
        """)
        
        result = db.execute(query).fetchone()
        
        if result:
            total, with_images, with_watermarks = result
            print(f"   📊 Total content (7 days): {total}")
            print(f"   🖼️ Content with images: {with_images}")
            print(f"   🏷️ Content with watermarks: {with_watermarks}")
        
        print(f"   ✅ Content marketplace table accessible")
        return True
        
    except Exception as e:
        print(f"   ❌ Content marketplace table test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Automated Content Generation Setup Test")
    print("=" * 50)
    print(f"🕐 Test started at: {datetime.now()}")
    
    tests = [
        ("Configuration", test_configuration),
        ("Environment Variables", test_environment),
        ("Database Connection", test_database_connection),
        ("API Keys", test_api_keys),
        ("Content Marketplace Table", test_content_marketplace_table)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n{'='*20} {test_name} {'='*20}")
        try:
            if test_func():
                passed += 1
                print(f"✅ {test_name} test PASSED")
            else:
                print(f"❌ {test_name} test FAILED")
        except Exception as e:
            print(f"❌ {test_name} test ERROR: {e}")
    
    print(f"\n{'='*50}")
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Ready to run automated content generation.")
        print("\nTo start the automation:")
        print("   python automated_content_generator.py")
        print("\nFor production (background):")
        print("   nohup python automated_content_generator.py > content_generation.log 2>&1 &")
    else:
        print("⚠️ Some tests failed. Please fix the issues before running automation.")
        print("\nCommon fixes:")
        print("   1. Update wallet addresses in wallet_config.json")
        print("   2. Set environment variables in .env file")
        print("   3. Check database connection")
        print("   4. Verify API keys are valid")

if __name__ == "__main__":
    main()
