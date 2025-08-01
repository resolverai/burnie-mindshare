#!/bin/bash

# RoastPower Mining Interface Deployment Script
set -e

echo "🔥 RoastPower Mining Interface Deployment"
echo "========================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if image file exists
if [ ! -f "roastpower-mining-interface.tar.gz" ]; then
    echo "❌ roastpower-mining-interface.tar.gz not found!"
    echo "Please ensure the image file is in the current directory."
    exit 1
fi

# Load the Docker image
echo "📦 Loading Docker image..."
gunzip -c roastpower-mining-interface.tar.gz | docker load

# Stop and remove existing container if it exists
echo "🛑 Stopping existing container (if any)..."
docker stop roastpower-mining 2>/dev/null || true
docker rm roastpower-mining 2>/dev/null || true

# Get the backend URL from user or use default
echo ""
read -p "Enter backend API URL (default: http://localhost:8000): " BACKEND_URL
BACKEND_URL=${BACKEND_URL:-http://localhost:8000}

# Get the port from user or use default
echo ""
read -p "Enter port to run on (default: 3000): " PORT
PORT=${PORT:-3000}

# Run the container
echo "🚀 Starting RoastPower Mining Interface..."
docker run -d \
  --name roastpower-mining \
  -p $PORT:3000 \
  -e NEXT_PUBLIC_API_URL=$BACKEND_URL \
  -e NODE_ENV=production \
  --restart unless-stopped \
  roastpower-mining-interface:latest

# Wait a moment for container to start
sleep 3

# Check if container is running
if docker ps | grep -q roastpower-mining; then
    echo "✅ RoastPower Mining Interface is running!"
    echo ""
    echo "🌐 Access your application at: http://localhost:$PORT"
    echo "🔧 Backend API URL: $BACKEND_URL"
    echo ""
    echo "📊 To check logs: docker logs roastpower-mining"
    echo "🛑 To stop: docker stop roastpower-mining"
    echo "🔄 To restart: docker restart roastpower-mining"
else
    echo "❌ Failed to start container. Check logs with:"
    echo "docker logs roastpower-mining"
    exit 1
fi 