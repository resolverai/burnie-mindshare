#!/bin/bash

# Burnie Mining Interface - Multi-Architecture Build and Push Script
set -e

# Configuration
REPO_NAME="burnieai/mining-interface"
VERSION=${1:-"latest"}
ARCHITECTURES=${2:-"linux/amd64,linux/arm64"}

# Help function
show_help() {
    echo "Burnie Mining Interface - Multi-Architecture Build and Push Script"
    echo ""
    echo "Usage: $0 [VERSION] [ARCHITECTURES]"
    echo ""
    echo "Arguments:"
    echo "  VERSION        Docker image version (default: latest)"
    echo "  ARCHITECTURES  Comma-separated list of architectures (default: linux/amd64,linux/arm64)"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Build latest for amd64,arm64"
    echo "  $0 v2.1.0                            # Build v2.1.0 for amd64,arm64"
    echo "  $0 v2.1.0 linux/amd64                # Build v2.1.0 for amd64 only"
    echo "  $0 v2.1.0 linux/amd64,linux/arm64,linux/arm/v7  # Build for multiple architectures"
    echo ""
    echo "Build Options (for multi-architecture):"
    echo "  1. Build and push to DockerHub       - Build multi-arch and push immediately"
    echo "  2. Build locally only (no push)      - Build multi-arch to cache (not loadable)"
    echo "  3. Build and deploy locally          - Build for local arch and optionally deploy"
    echo ""
    echo "Supported architectures:"
    echo "  - linux/amd64    (Intel/AMD 64-bit)"
    echo "  - linux/arm64    (ARM 64-bit)"
    echo "  - linux/arm/v7   (ARM 32-bit)"
    echo "  - linux/arm/v6   (ARM 32-bit, older)"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker with Buildx support"
    echo "  - DockerHub account (for pushing)"
    echo ""
}

# Check for help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_help
    exit 0
fi

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Building Burnie Mining Interface Docker Container${NC}"
echo "Repository: $REPO_NAME"
echo "Version: $VERSION"
echo "Architectures: $ARCHITECTURES"
echo "=================================================="

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if buildx is available
if ! docker buildx version &> /dev/null; then
    echo -e "${RED}❌ Docker Buildx is not available. Please install Docker Buildx for multi-architecture builds.${NC}"
    echo -e "${YELLOW}💡 You can install it by running: docker buildx install${NC}"
    exit 1
fi

# Create and use buildx builder if it doesn't exist
echo -e "${BLUE}🔧 Setting up buildx builder...${NC}"
if ! docker buildx inspect multiarch-builder &> /dev/null; then
    docker buildx create --name multiarch-builder --use
    echo -e "${GREEN}✅ Created new buildx builder: multiarch-builder${NC}"
else
    docker buildx use multiarch-builder
    echo -e "${GREEN}✅ Using existing buildx builder: multiarch-builder${NC}"
fi

# Detect current architecture
CURRENT_ARCH=$(uname -m)
case $CURRENT_ARCH in
    x86_64)
        LOCAL_PLATFORM="linux/amd64"
        ;;
    aarch64|arm64)
        LOCAL_PLATFORM="linux/arm64"
        ;;
    armv7l)
        LOCAL_PLATFORM="linux/arm/v7"
        ;;
    *)
        LOCAL_PLATFORM="linux/amd64"
        echo -e "${YELLOW}⚠️  Unknown architecture: $CURRENT_ARCH, defaulting to linux/amd64${NC}"
        ;;
esac

# Check if we're building for multiple architectures
if [[ "$ARCHITECTURES" == *","* ]]; then
    # Multi-architecture build
    echo -e "${BLUE}📦 Building multi-architecture container for: $ARCHITECTURES${NC}"
    echo -e "${BLUE}🔧 Choose build option:${NC}"
    echo "1. Build and push to DockerHub"
    echo "2. Build locally only (no push)"
    echo "3. Build for local architecture and deploy ($LOCAL_PLATFORM)"
    echo "4. Cancel"
    echo -e "${YELLOW}Choose option (1/2/3/4):${NC}"
    read -p "" -n 1 -r build_option
    echo
    
    if [[ $build_option == "1" ]]; then
        # Build and push option
        # Check DockerHub authentication first
        echo -e "${BLUE}🔐 Checking DockerHub authentication...${NC}"
        if ! docker info | grep -q "Username:"; then
            echo -e "${YELLOW}⚠️  Not logged in to DockerHub. Please authenticate first.${NC}"
            echo -e "${BLUE}🔐 DockerHub Authentication Options:${NC}"
            echo "1. Login with username and password/token"
            echo "2. Use access token directly"
            echo -e "${YELLOW}Choose option (1/2):${NC}"
            read -p "" -n 1 -r auth_option
            echo
            
            case $auth_option in
                1)
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
                2)
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
        else
            CURRENT_USER=$(docker info | grep "Username:" | cut -d' ' -f2)
            echo -e "${GREEN}✅ Already logged in as: $CURRENT_USER${NC}"
        fi
        
        # Build and push multi-architecture images
        echo -e "${BLUE}📦 Building and pushing multi-architecture images...${NC}"
        docker buildx build \
            --platform $ARCHITECTURES \
            --tag $REPO_NAME:$VERSION \
            --tag $REPO_NAME:latest \
            --push \
            .
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Multi-architecture container built and pushed successfully!${NC}"
            MULTIARCH_BUILT=true
            MULTIARCH_PUSHED=true
            
            # Ask if user wants to logout (for security)
            if [ "$auth_option" = "1" ] || [ "$auth_option" = "2" ]; then
                echo -e "${YELLOW}🔒 Do you want to logout from DockerHub for security? (y/N):${NC}"
                read -p "" -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    docker logout
                    echo -e "${GREEN}✅ Logged out from DockerHub${NC}"
                fi
            fi
        else
            echo -e "${RED}❌ Multi-architecture container build failed!${NC}"
            exit 1
        fi
    elif [[ $build_option == "2" ]]; then
        # Build locally only option
        echo -e "${BLUE}📦 Building multi-architecture images locally (no push)...${NC}"
        echo -e "${YELLOW}⚠️  Note: Multi-arch builds will be stored in buildx cache only${NC}"
        
        docker buildx build \
            --platform $ARCHITECTURES \
            --tag $REPO_NAME:$VERSION \
            --tag $REPO_NAME:latest \
            .
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Multi-architecture container built successfully (local cache)!${NC}"
            echo -e "${YELLOW}💡 To push later, run: docker buildx build --platform $ARCHITECTURES --tag $REPO_NAME:$VERSION --push .${NC}"
            MULTIARCH_BUILT=true
            MULTIARCH_PUSHED=false
        else
            echo -e "${RED}❌ Multi-architecture container build failed!${NC}"
            exit 1
        fi
    elif [[ $build_option == "3" ]]; then
        # Build for local architecture and deploy
        echo -e "${BLUE}📦 Building for local architecture: $LOCAL_PLATFORM${NC}"
        docker buildx build \
            --platform $LOCAL_PLATFORM \
            --tag $REPO_NAME:$VERSION \
            --tag $REPO_NAME:latest \
            --load \
            .
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Local architecture container built and loaded successfully!${NC}"
            MULTIARCH_BUILT=true
            MULTIARCH_PUSHED=false
            LOCAL_DEPLOY=true
            
            # Ask if user wants to deploy now
            echo -e "${YELLOW}🚀 Do you want to deploy the container now? (y/N):${NC}"
            read -p "" -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                # Stop and remove existing container if it exists
                if docker ps -a --filter "name=mining-interface" | grep -q "mining-interface"; then
                    echo -e "${BLUE}🛑 Stopping existing mining-interface container...${NC}"
                    docker stop mining-interface 2>/dev/null || true
                    docker rm mining-interface 2>/dev/null || true
                fi
                
                # Deploy the container
                echo -e "${BLUE}🚀 Deploying mining-interface container...${NC}"
                echo -e "${YELLOW}📝 Enter port to expose (default: 3000):${NC}"
                read -p "" expose_port
                expose_port=${expose_port:-3000}
                
                docker run -d \
                    --name mining-interface \
                    --restart unless-stopped \
                    -p $expose_port:3000 \
                    $REPO_NAME:$VERSION
                
                if [ $? -eq 0 ]; then
                    echo -e "${GREEN}✅ Container deployed successfully!${NC}"
                    echo -e "${BLUE}📋 Container details:${NC}"
                    echo "  - Name: mining-interface"
                    echo "  - Image: $REPO_NAME:$VERSION"
                    echo "  - Port: http://localhost:$expose_port"
                    echo ""
                    echo -e "${BLUE}🔍 Check status:${NC} docker ps -f name=mining-interface"
                    echo -e "${BLUE}📄 View logs:${NC} docker logs -f mining-interface"
                    echo -e "${BLUE}🛑 Stop container:${NC} docker stop mining-interface"
                    DEPLOYED=true
                else
                    echo -e "${RED}❌ Failed to deploy container!${NC}"
                    exit 1
                fi
            else
                echo -e "${YELLOW}⏭️  Skipping deployment. Image is available locally as: $REPO_NAME:$VERSION${NC}"
            fi
        else
            echo -e "${RED}❌ Local architecture container build failed!${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⏭️  Cancelled multi-architecture build${NC}"
        MULTIARCH_BUILT=false
        MULTIARCH_PUSHED=false
    fi
else
    # Single architecture build - can load locally
    echo -e "${BLUE}📦 Building single architecture container for: $ARCHITECTURES${NC}"
    docker buildx build \
        --platform $ARCHITECTURES \
        --tag $REPO_NAME:$VERSION \
        --tag $REPO_NAME:latest \
        --load \
        .
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Single architecture container built successfully!${NC}"
        MULTIARCH_BUILT=true
        LOCAL_DEPLOY=true
        
        # Ask if user wants to deploy now
        echo -e "${YELLOW}🚀 Do you want to deploy the container now? (y/N):${NC}"
        read -p "" -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Stop and remove existing container if it exists
            if docker ps -a --filter "name=mining-interface" | grep -q "mining-interface"; then
                echo -e "${BLUE}🛑 Stopping existing mining-interface container...${NC}"
                docker stop mining-interface 2>/dev/null || true
                docker rm mining-interface 2>/dev/null || true
            fi
            
            # Deploy the container
            echo -e "${BLUE}🚀 Deploying mining-interface container...${NC}"
            echo -e "${YELLOW}📝 Enter port to expose (default: 3000):${NC}"
            read -p "" expose_port
            expose_port=${expose_port:-3000}
            
            docker run -d \
                --name mining-interface \
                --restart unless-stopped \
                -p $expose_port:3000 \
                $REPO_NAME:$VERSION
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Container deployed successfully!${NC}"
                echo -e "${BLUE}📋 Container details:${NC}"
                echo "  - Name: mining-interface"
                echo "  - Image: $REPO_NAME:$VERSION"
                echo "  - Port: http://localhost:$expose_port"
                echo ""
                echo -e "${BLUE}🔍 Check status:${NC} docker ps -f name=mining-interface"
                echo -e "${BLUE}📄 View logs:${NC} docker logs -f mining-interface"
                echo -e "${BLUE}🛑 Stop container:${NC} docker stop mining-interface"
                DEPLOYED=true
            else
                echo -e "${RED}❌ Failed to deploy container!${NC}"
                exit 1
            fi
        fi
    else
        echo -e "${RED}❌ Single architecture container build failed!${NC}"
        exit 1
    fi
fi

# Test the container (only for single architecture builds that weren't deployed)
if [ "$MULTIARCH_BUILT" = "true" ] && [[ "$ARCHITECTURES" != *","* ]] && [ "$DEPLOYED" != "true" ]; then
    echo -e "${YELLOW}🧪 Do you want to test the container? (y/N):${NC}"
    read -p "" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Test the single architecture container
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
    fi
fi

# Check if user wants to push to DockerHub
if [ "$MULTIARCH_PUSHED" = "true" ]; then
    echo -e "${GREEN}✅ Multi-architecture images already pushed to DockerHub!${NC}"
    echo -e "${BLUE}📋 Pushed images:${NC}"
    echo "  - $REPO_NAME:$VERSION (multi-arch: $ARCHITECTURES)"
    echo "  - $REPO_NAME:latest (multi-arch: $ARCHITECTURES)"
elif [ "$DEPLOYED" = "true" ]; then
    echo -e "${GREEN}✅ Container deployed locally!${NC}"
    echo -e "${YELLOW}💡 To push to DockerHub later, run: docker push $REPO_NAME:$VERSION${NC}"
elif [ "$MULTIARCH_BUILT" = "true" ] && [[ "$ARCHITECTURES" == *","* ]] && [ "$MULTIARCH_PUSHED" = "false" ]; then
    echo -e "${YELLOW}📤 Multi-architecture images built locally. Do you want to push to DockerHub now? (y/N):${NC}"
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
        
        # Push multi-architecture images to DockerHub
        echo -e "${BLUE}📤 Pushing multi-architecture images to DockerHub...${NC}"
        docker buildx build \
            --platform $ARCHITECTURES \
            --tag $REPO_NAME:$VERSION \
            --tag $REPO_NAME:latest \
            --push \
            .
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully pushed multi-architecture images${NC}"
            MULTIARCH_PUSHED=true
        else
            echo -e "${RED}❌ Failed to push multi-architecture images${NC}"
            exit 1
        fi
        
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
    fi
elif [ "$MULTIARCH_BUILT" = "true" ] && [[ "$ARCHITECTURES" != *","* ]]; then
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
        
        # Push single architecture images to DockerHub
        echo -e "${BLUE}📤 Pushing single architecture images to DockerHub...${NC}"
        
        # Push both tags
        docker push $REPO_NAME:$VERSION
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully pushed $REPO_NAME:$VERSION${NC}"
        else
            echo -e "${RED}❌ Failed to push $REPO_NAME:$VERSION${NC}"
            exit 1
        fi
        
        docker push $REPO_NAME:latest
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully pushed $REPO_NAME:latest${NC}"
        else
            echo -e "${RED}❌ Failed to push $REPO_NAME:latest${NC}"
            exit 1
        fi
        
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
        echo -e "${YELLOW}⏭️  Skipping DockerHub push${NC}"
    fi
else
    echo -e "${YELLOW}⏭️  No container built, skipping push${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Multi-architecture build completed successfully!${NC}"
echo ""
echo -e "${BLUE}🌐 External users can now run:${NC}"
echo "docker run -p 3000:3000 $REPO_NAME:$VERSION"
echo ""
echo -e "${BLUE}🏗️  Supported architectures:${NC}"
echo "$ARCHITECTURES" | tr ',' '\n' | sed 's/^/  - /'
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Test the container locally if needed"
echo "2. Verify multi-architecture images on DockerHub"
echo "3. Update documentation with new version"
echo "4. Share with external users"
echo ""
echo -e "${BLUE}💡 Usage examples:${NC}"
echo "  # Build for specific architectures:"
echo "  ./build-and-push.sh v2.1.0 linux/amd64,linux/arm64"
echo "  # Build for AMD64 only:"
echo "  ./build-and-push.sh v2.1.0 linux/amd64"
echo "  # Build for all common architectures:"
echo "  ./build-and-push.sh v2.1.0 linux/amd64,linux/arm64,linux/arm/v7"
