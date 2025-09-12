#!/bin/bash

# Burnie Mining Interface - Simple Docker Deployment Script
# This script provides an easy way to run the mining interface container

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Burnie Mining Interface - Docker Deployment${NC}"
echo "=================================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}❌ Docker is not installed. Please install Docker first.${NC}"
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${YELLOW}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Default configuration
IMAGE_NAME="burnieai/mining-interface"
TAG="latest"
PORT="3000"
CONTAINER_NAME="burnie-mining-interface"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --image|-i)
            IMAGE_NAME="$2"
            shift 2
            ;;
        --tag|-t)
            TAG="$2"
            shift 2
            ;;
        --name|-n)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -p, --port PORT        Port to run on (default: 3000)"
            echo "  -i, --image IMAGE      Image name (default: burnie-mining-interface)"
            echo "  -t, --tag TAG          Image tag (default: latest)"
            echo "  -n, --name NAME        Container name (default: burnie-mining-interface)"
            echo "  -h, --help             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                     # Run with defaults"
            echo "  $0 --port 3001         # Run on port 3001"
            echo "  $0 --image my-image    # Use custom image name"
            exit 0
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Check if port is available
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port $PORT is already in use. Please choose a different port.${NC}"
    echo "Usage: $0 --port 3001"
    exit 1
fi

# Check if container already exists
if docker ps -a --format "table {{.Names}}" | grep -q "^$CONTAINER_NAME$"; then
    echo -e "${YELLOW}⚠️  Container '$CONTAINER_NAME' already exists.${NC}"
    read -p "Do you want to remove it and continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing existing container..."
        docker rm -f $CONTAINER_NAME
    else
        echo "Aborted."
        exit 1
    fi
fi

# Build full image name
FULL_IMAGE_NAME="$IMAGE_NAME:$TAG"

echo -e "${BLUE}📦 Image: $FULL_IMAGE_NAME${NC}"
echo -e "${BLUE}🌐 Port: $PORT${NC}"
echo -e "${BLUE}📝 Container: $CONTAINER_NAME${NC}"
echo ""

# Check if image exists locally
if ! docker images --format "table {{.Repository}}:{{.Tag}}" | grep -q "^$FULL_IMAGE_NAME$"; then
    echo -e "${YELLOW}⚠️  Image '$FULL_IMAGE_NAME' not found locally.${NC}"
    echo "Please build the image first or pull it from a registry."
    echo ""
    echo "To build: docker build -t $FULL_IMAGE_NAME ."
    echo "To pull: docker pull $FULL_IMAGE_NAME"
    exit 1
fi

echo -e "${GREEN}🚀 Starting Burnie Mining Interface...${NC}"

# Run the container
docker run -d \
    --name $CONTAINER_NAME \
    -p $PORT:3000 \
    --restart unless-stopped \
    $FULL_IMAGE_NAME

# Wait a moment for container to start
sleep 3

# Check if container is running
if docker ps --format "table {{.Names}}" | grep -q "^$CONTAINER_NAME$"; then
    echo -e "${GREEN}✅ Container started successfully!${NC}"
    echo ""
    echo -e "${BLUE}🌐 Access the application at: http://localhost:$PORT${NC}"
    echo ""
    echo -e "${BLUE}📋 Useful commands:${NC}"
    echo "  docker logs $CONTAINER_NAME              # View logs"
    echo "  docker logs -f $CONTAINER_NAME           # Follow logs"
    echo "  docker stop $CONTAINER_NAME              # Stop container"
    echo "  docker rm $CONTAINER_NAME                # Remove container"
    echo ""
    echo -e "${GREEN}🎉 Mining interface is ready to use!${NC}"
    echo "Connect your wallet and start mining content!"
else
    echo -e "${YELLOW}❌ Container failed to start.${NC}"
    echo "Checking logs..."
    docker logs $CONTAINER_NAME
    exit 1
fi
