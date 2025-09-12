#!/bin/bash

# Burnie Mining Interface - Build and Push Script
set -e

# Configuration
REPO_NAME="burnieai/mining-interface"
VERSION=${1:-"latest"}

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Building Burnie Mining Interface Docker Container${NC}"
echo "Repository: $REPO_NAME"
echo "Version: $VERSION"
echo "=================================================="

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Build the container
echo -e "${BLUE}📦 Building container...${NC}"
docker build -t $REPO_NAME:$VERSION .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Container built successfully!${NC}"
else
    echo -e "${RED}❌ Container build failed!${NC}"
    exit 1
fi

# Test the container (optional)
echo -e "${BLUE}🧪 Testing container...${NC}"
docker run -d --name test-mining-interface -p 3001:3000 $REPO_NAME:$VERSION
sleep 5

# Check if container is running
if docker ps --filter "name=test-mining-interface" --filter "status=running" | grep -q "test-mining-interface"; then
    echo -e "${GREEN}✅ Container test successful!${NC}"
    docker stop test-mining-interface
    docker rm test-mining-interface
else
    echo -e "${RED}❌ Container test failed!${NC}"
    echo "Container logs:"
    docker logs test-mining-interface
    docker rm test-mining-interface
    exit 1
fi

# Check if user wants to push to DockerHub
echo -e "${YELLOW}📤 Do you want to push to DockerHub? (y/N):${NC}"
read -p "" -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Ask for authentication method
    echo -e "${BLUE}🔐 DockerHub Authentication Options:${NC}"
    echo "1. Use existing login (if already logged in)"
    echo "2. Login with username and password/token"
    echo "3. Use access token directly"
    echo -e "${YELLOW}Choose option (1/2/3):${NC}"
    read -p "" -n 1 -r auth_option
    echo
    
    case $auth_option in
        1)
            # Check if already logged in
            if docker info | grep -q "Username:"; then
                echo -e "${GREEN}✅ Using existing DockerHub credentials${NC}"
                CURRENT_USER=$(docker info | grep "Username:" | cut -d' ' -f2)
                echo -e "${BLUE}Logged in as: $CURRENT_USER${NC}"
            else
                echo -e "${RED}❌ Not logged in to DockerHub${NC}"
                exit 1
            fi
            ;;
        2)
            echo -e "${BLUE}🔑 Please enter your DockerHub credentials:${NC}"
            echo -e "${YELLOW}Username:${NC}"
            read -p "" dockerhub_username
            echo -e "${YELLOW}Password/Token:${NC}"
            read -s dockerhub_password
            echo
            
            echo -e "${BLUE}🔐 Logging in to DockerHub...${NC}"
            echo "$dockerhub_password" | docker login --username "$dockerhub_username" --password-stdin
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Successfully logged in as $dockerhub_username${NC}"
            else
                echo -e "${RED}❌ Login failed${NC}"
                exit 1
            fi
            ;;
        3)
            echo -e "${BLUE}🔑 Please enter your DockerHub access token:${NC}"
            read -s dockerhub_token
            echo
            
            echo -e "${BLUE}🔐 Logging in to DockerHub with token...${NC}"
            echo "$dockerhub_token" | docker login --username "$REPO_NAME" --password-stdin
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Successfully logged in with token${NC}"
            else
                echo -e "${RED}❌ Login failed${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}❌ Invalid option. Exiting.${NC}"
            exit 1
            ;;
    esac
    
    # Push to DockerHub
    echo -e "${BLUE}📤 Pushing to DockerHub...${NC}"
    docker push $REPO_NAME:$VERSION
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Push to DockerHub successful!${NC}"
        
        # Ask if user wants to logout (for security)
        if [ "$auth_option" = "2" ] || [ "$auth_option" = "3" ]; then
            echo -e "${YELLOW}🔒 Do you want to logout from DockerHub for security? (y/N):${NC}"
            read -p "" -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                docker logout
                echo -e "${GREEN}✅ Logged out from DockerHub${NC}"
            fi
        fi
    else
        echo -e "${RED}❌ Push to DockerHub failed!${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⏭️  Skipping DockerHub push${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Build completed successfully!${NC}"
echo ""
echo -e "${BLUE}🌐 External users can now run:${NC}"
echo "docker run -p 3000:3000 $REPO_NAME:$VERSION"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Test the container locally if needed"
echo "2. Push to DockerHub when ready"
echo "3. Update documentation with new version"
echo "4. Share with external users"
