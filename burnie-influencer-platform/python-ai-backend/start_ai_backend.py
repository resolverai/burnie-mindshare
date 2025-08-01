#!/usr/bin/env python3
"""
Burnie AI Backend Startup Script

This script starts the Python AI backend with the CrewAI multi-agentic system.
"""

import os
import sys
import subprocess
import asyncio
import uvicorn
from pathlib import Path

def check_dependencies():
    """Check if all required dependencies are installed"""
    try:
        import fastapi
        import crewai
        import databases
        import asyncpg
        print("✅ All dependencies found")
        return True
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("💡 Run: pip install -r requirements.txt")
        return False

def setup_environment():
    """Set up environment variables with defaults"""
    env_defaults = {
        'DB_HOST': 'localhost',
        'DB_PORT': '5432',
        'DB_NAME': 'burnie_platform',
        'DB_USER': 'postgres',
        'DB_PASSWORD': 'password',
        'OPENAI_API_KEY': 'your-openai-key-here',
        'LOG_LEVEL': 'INFO',
        'DEBUG': 'true'
    }
    
    for key, default_value in env_defaults.items():
        if key not in os.environ:
            os.environ[key] = default_value
    
    print("🔧 Environment variables configured")

def create_log_directory():
    """Create logs directory if it doesn't exist"""
    log_dir = Path('logs')
    log_dir.mkdir(exist_ok=True)
    print("📁 Log directory created")

def print_startup_info():
    """Print startup information"""
    print("=" * 60)
    print("🚀 BURNIE AI BACKEND - MULTI-AGENTIC CONTENT GENERATION")
    print("=" * 60)
    print("📍 FastAPI Server: http://localhost:8000")
    print("📍 API Docs: http://localhost:8000/docs")
    print("📍 Health Check: http://localhost:8000/health")
    print("📍 WebSocket: ws://localhost:8000/ws/{session_id}")
    print("=" * 60)
    print("🤖 AI Agents:")
    print("   • Data Analyst Agent")
    print("   • Content Strategist Agent") 
    print("   • Text Content Agent")
    print("   • Visual Creator Agent")
    print("   • Orchestrator Agent")
    print("=" * 60)
    print("💡 Connect your React frontend to:")
    print("   • Mining API: http://localhost:8000/api/mining/start")
    print("   • Progress WebSocket: ws://localhost:8000/ws/{session_id}")
    print("=" * 60)

def main():
    """Main startup function"""
    print("🔄 Starting Burnie AI Backend...")
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Setup environment
    setup_environment()
    
    # Create necessary directories
    create_log_directory()
    
    # Print startup info
    print_startup_info()
    
    # Check if we're in the right directory
    if not Path('app/main.py').exists():
        print("❌ Error: app/main.py not found")
        print("💡 Make sure you're running this from the python-ai-backend directory")
        sys.exit(1)
    
    try:
        # Start the FastAPI server
        print("🚀 Starting FastAPI server...")
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info",
            access_log=True
        )
    except KeyboardInterrupt:
        print("\n🛑 Shutting down AI backend...")
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 