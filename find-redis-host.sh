#!/bin/bash

# Script to find the correct Redis host IP for Docker containers
# Run this script to determine the best Redis host configuration

echo "🔍 Finding Redis Host Configuration for Docker Containers"
echo "========================================================"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Docker is running"

# Check if Redis is running locally
if ! redis-cli ping >/dev/null 2>&1; then
    echo "❌ Redis is not running locally. Please start Redis first."
    echo "   On macOS: brew services start redis"
    echo "   On Ubuntu: sudo systemctl start redis"
    exit 1
fi

echo "✅ Redis is running locally"

# Get Docker bridge network IP
DOCKER_BRIDGE_IP=$(docker network inspect bridge | grep -o '"Gateway": "[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$DOCKER_BRIDGE_IP" ]; then
    echo "✅ Docker bridge gateway IP: $DOCKER_BRIDGE_IP"
else
    echo "⚠️  Could not determine Docker bridge IP"
fi

# Test different Redis host configurations
echo ""
echo "🧪 Testing Redis connectivity from containers..."
echo ""

# Test 1: host.docker.internal
echo "Testing host.docker.internal..."
docker run --rm redis:alpine redis-cli -h host.docker.internal -p 6379 ping 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ host.docker.internal works"
    REDIS_HOST="host.docker.internal"
else
    echo "❌ host.docker.internal failed"
fi

# Test 2: Docker bridge IP
if [ -n "$DOCKER_BRIDGE_IP" ]; then
    echo "Testing $DOCKER_BRIDGE_IP..."
    docker run --rm redis:alpine redis-cli -h $DOCKER_BRIDGE_IP -p 6379 ping 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✅ $DOCKER_BRIDGE_IP works"
        REDIS_HOST="$DOCKER_BRIDGE_IP"
    else
        echo "❌ $DOCKER_BRIDGE_IP failed"
    fi
fi

# Test 3: 172.17.0.1 (default Docker bridge)
echo "Testing 172.17.0.1..."
docker run --rm redis:alpine redis-cli -h 172.17.0.1 -p 6379 ping 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ 172.17.0.1 works"
    REDIS_HOST="172.17.0.1"
else
    echo "❌ 172.17.0.1 failed"
fi

echo ""
echo "📋 RECOMMENDED CONFIGURATION:"
echo "============================="

if [ -n "$REDIS_HOST" ]; then
    echo "✅ Use REDIS_HOST=$REDIS_HOST"
    echo ""
    echo "Update your docker-compose.yml:"
    echo "environment:"
    echo "  - REDIS_HOST=$REDIS_HOST"
    echo "  - REDIS_PORT=6379"
    echo "  - REDIS_PASSWORD="
else
    echo "❌ No working Redis host found"
    echo ""
    echo "🔧 ALTERNATIVE SOLUTIONS:"
    echo "1. Use host network mode (see docker-compose-host-network.yml)"
    echo "2. Run Redis in a Docker container"
    echo "3. Use a different Redis host configuration"
fi

echo ""
echo "🚀 To apply the fix:"
echo "1. Update docker-compose.yml with the recommended REDIS_HOST"
echo "2. Restart containers: docker-compose down && docker-compose up -d"
