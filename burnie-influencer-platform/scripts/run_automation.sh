#!/bin/bash

# Automated Text Regeneration Runner Script
# This script sets up and runs the automated text regeneration

echo "🚀 Starting Automated Text Regeneration Setup..."

# Change to the project root directory (one level up from scripts)
cd "$(dirname "$0")/.."

# Check if .env files exist
if [ ! -f "typescript-backend/.env" ]; then
    echo "❌ Error: typescript-backend/.env file not found!"
    echo "Please ensure the TypeScript backend .env file exists with:"
    echo "TYPESCRIPT_BACKEND_URL=http://your-typescript-backend-url"
    echo "PYTHON_AI_BACKEND_URL=http://your-python-backend-url"
    exit 1
fi

if [ ! -f "python-ai-backend/.env" ]; then
    echo "❌ Error: python-ai-backend/.env file not found!"
    echo "Please ensure the Python backend .env file exists with database configuration"
    exit 1
fi

# Install requirements if needed
echo "📦 Installing Python requirements..."
pip install -r scripts/requirements_automation.txt

# Make the scripts executable
chmod +x scripts/automated_text_regeneration.py
chmod +x scripts/test_automation.py

# Run the automation
echo "🔄 Starting automated text regeneration..."
echo "📝 Logs will be written to: scripts/automated_text_regeneration.log"
echo "🛑 Press Ctrl+C to stop"

# Run in screen if requested
if [ "$1" = "screen" ]; then
    echo "🖥️  Running in screen session 'text-regeneration'..."
    screen -S text-regeneration -dm python scripts/automated_text_regeneration.py
    echo "✅ Screen session started. Use 'screen -r text-regeneration' to attach."
    echo "📝 Monitor logs with: tail -f scripts/automated_text_regeneration.log"
else
    python scripts/automated_text_regeneration.py
fi
