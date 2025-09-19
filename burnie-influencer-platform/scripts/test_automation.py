#!/usr/bin/env python3
"""
Test script for automated text regeneration setup

This script tests the environment configuration and API connectivity
before running the full automation.
"""

import os
import asyncio
import aiohttp
import asyncpg
from dotenv import load_dotenv

# Load environment variables from existing .env files
# Load TypeScript backend .env first (for PYTHON_AI_BACKEND_URL)
load_dotenv("typescript-backend/.env")
# Load Python backend .env for database config
load_dotenv("python-ai-backend/.env")

async def test_environment():
    """Test environment configuration"""
    print("🔍 Testing Environment Configuration...")
    
    required_vars = [
        'TYPESCRIPT_BACKEND_URL',
        'PYTHON_AI_BACKEND_URL',
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD'
    ]
    
    missing_vars = []
    for var in required_vars:
        value = os.getenv(var)
        if not value:
            missing_vars.append(var)
        else:
            print(f"✅ {var}: {value}")
    
    if missing_vars:
        print(f"❌ Missing environment variables: {', '.join(missing_vars)}")
        return False
    
    print("✅ All environment variables configured")
    return True

async def test_api_connectivity():
    """Test API connectivity"""
    print("\n🔍 Testing API Connectivity...")
    
    typescript_url = os.getenv('TYPESCRIPT_BACKEND_URL')
    python_url = os.getenv('PYTHON_AI_BACKEND_URL')
    
    async with aiohttp.ClientSession() as session:
        # Test TypeScript backend
        try:
            async with session.get(f"{typescript_url}/api/hot-campaigns") as response:
                if response.status == 200:
                    print(f"✅ TypeScript Backend: {typescript_url} - OK")
                else:
                    print(f"❌ TypeScript Backend: {typescript_url} - Status {response.status}")
                    return False
        except Exception as e:
            print(f"❌ TypeScript Backend: {typescript_url} - Error: {str(e)}")
            return False
        
        # Test Python backend
        try:
            async with session.get(f"{python_url}/health") as response:
                if response.status == 200:
                    print(f"✅ Python Backend: {python_url} - OK")
                else:
                    print(f"❌ Python Backend: {python_url} - Status {response.status}")
                    return False
        except Exception as e:
            print(f"❌ Python Backend: {python_url} - Error: {str(e)}")
            return False
    
    return True

async def test_database_connectivity():
    """Test database connectivity"""
    print("\n🔍 Testing Database Connectivity...")
    
    try:
        conn = await asyncpg.connect(
            host=os.getenv('DATABASE_HOST'),
            port=int(os.getenv('DATABASE_PORT', 5432)),
            database=os.getenv('DATABASE_NAME'),
            user=os.getenv('DATABASE_USER'),
            password=os.getenv('DATABASE_PASSWORD')
        )
        
        # Test query
        result = await conn.fetchval("SELECT COUNT(*) FROM content_marketplace")
        print(f"✅ Database: Connected successfully")
        print(f"📊 Content items in database: {result}")
        
        await conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Database: Connection failed - {str(e)}")
        return False

async def test_hot_campaigns_endpoint():
    """Test hot campaigns endpoint"""
    print("\n🔍 Testing Hot Campaigns Endpoint...")
    
    try:
        typescript_url = os.getenv('TYPESCRIPT_BACKEND_URL')
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{typescript_url}/api/hot-campaigns") as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('success'):
                        hot_campaigns = data.get('data', [])
                        print(f"✅ Hot Campaigns Endpoint: Found {len(hot_campaigns)} hot campaigns")
                        
                        if hot_campaigns:
                            print("📊 Sample hot campaign:")
                            sample = hot_campaigns[0]
                            print(f"   Campaign: {sample.get('campaignName')}")
                            print(f"   Post Type: {sample.get('postType')}")
                            print(f"   Ratio: {sample.get('ratio')}")
                        
                        return True
                    else:
                        print(f"❌ Hot Campaigns Endpoint: API returned error - {data.get('message')}")
                        return False
                else:
                    print(f"❌ Hot Campaigns Endpoint: HTTP {response.status}")
                    return False
    except Exception as e:
        print(f"❌ Hot Campaigns Endpoint: Error - {str(e)}")
        return False

async def main():
    """Run all tests"""
    print("🚀 Automated Text Regeneration - Setup Test")
    print("=" * 50)
    
    tests = [
        ("Environment Configuration", test_environment),
        ("API Connectivity", test_api_connectivity),
        ("Database Connectivity", test_database_connectivity),
        ("Hot Campaigns Endpoint", test_hot_campaigns_endpoint)
    ]
    
    all_passed = True
    
    for test_name, test_func in tests:
        try:
            result = await test_func()
            if not result:
                all_passed = False
        except Exception as e:
            print(f"❌ {test_name}: Unexpected error - {str(e)}")
            all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("✅ All tests passed! Ready to run automation.")
        print("\nTo start automation:")
        print("  python automated_text_regeneration.py --once")
        print("  python automated_text_regeneration.py")
        print("  ./run_automation.sh")
    else:
        print("❌ Some tests failed. Please fix the issues before running automation.")
    
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(main())
