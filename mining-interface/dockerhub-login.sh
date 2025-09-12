#!/bin/bash

# DockerHub Login Script for Burnie Mining Interface
# This script helps you login to DockerHub with new credentials

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 DockerHub Login for Burnie Mining Interface${NC}"
echo "=================================================="

# Check if already logged in
if docker info | grep -q "Username:"; then
    CURRENT_USER=$(docker info | grep "Username:" | cut -d' ' -f2)
    echo -e "${YELLOW}⚠️  Already logged in as: $CURRENT_USER${NC}"
    echo -e "${YELLOW}Do you want to logout and login with different credentials? (y/N):${NC}"
    read -p "" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker logout
        echo -e "${GREEN}✅ Logged out from DockerHub${NC}"
    else
        echo -e "${BLUE}✅ Using existing credentials${NC}"
        exit 0
    fi
fi

echo -e "${BLUE}🔑 DockerHub Authentication Options:${NC}"
echo "1. Login with username and password"
echo "2. Login with username and access token"
echo "3. Login with access token only"
echo -e "${YELLOW}Choose option (1/2/3):${NC}"
read -p "" -n 1 -r auth_option
echo

case $auth_option in
    1)
        echo -e "${BLUE}🔑 Please enter your DockerHub credentials:${NC}"
        echo -e "${YELLOW}Username:${NC}"
        read -p "" dockerhub_username
        echo -e "${YELLOW}Password:${NC}"
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
    2)
        echo -e "${BLUE}🔑 Please enter your DockerHub credentials:${NC}"
        echo -e "${YELLOW}Username:${NC}"
        read -p "" dockerhub_username
        echo -e "${YELLOW}Access Token:${NC}"
        read -s dockerhub_token
        echo
        
        echo -e "${BLUE}🔐 Logging in to DockerHub with token...${NC}"
        echo "$dockerhub_token" | docker login --username "$dockerhub_username" --password-stdin
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully logged in as $dockerhub_username${NC}"
        else
            echo -e "${RED}❌ Login failed${NC}"
            exit 1
        fi
        ;;
    3)
        echo -e "${BLUE}🔑 Please enter your DockerHub access token:${NC}"
        echo -e "${YELLOW}Access Token:${NC}"
        read -s dockerhub_token
        echo
        
        echo -e "${BLUE}🔐 Logging in to DockerHub with token...${NC}"
        echo "$dockerhub_token" | docker login --username "burnieai" --password-stdin
        
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

echo ""
echo -e "${GREEN}🎉 DockerHub login completed!${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Run the build script: ./build-and-push.sh latest"
echo "2. Choose option 1 (use existing login) when prompted"
echo "3. The container will be pushed to burnieai/mining-interface"
echo ""
echo -e "${YELLOW}💡 To logout later: docker logout${NC}"
