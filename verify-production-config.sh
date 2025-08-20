#!/bin/bash

echo "🔍 Verifying Production Configuration..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

check_env_var() {
    local file="$1"
    local var_name="$2"
    local expected_pattern="$3"
    local service_name="$4"
    
    if [ -f "$file" ]; then
        local value=$(grep "^$var_name=" "$file" | cut -d'=' -f2- | tr -d '"')
        if [ -n "$value" ]; then
            if [[ "$value" =~ $expected_pattern ]]; then
                echo -e "${GREEN}✅ $service_name: $var_name = $value${NC}"
            else
                echo -e "${RED}❌ $service_name: $var_name = $value (expected pattern: $expected_pattern)${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  $service_name: $var_name not found${NC}"
        fi
    else
        echo -e "${RED}❌ $service_name: .env file not found at $file${NC}"
    fi
}

echo ""
echo -e "${BLUE}📋 Checking Frontend Configuration:${NC}"
check_env_var "burnie-influencer-platform/frontend/.env" "NEXT_PUBLIC_BACKEND_URL" "https://mindshareapi.burnie.io" "Frontend"
check_env_var "burnie-influencer-platform/frontend/.env" "NEXT_PUBLIC_AI_BACKEND_URL" "https://attentionai.burnie.io" "Frontend"
check_env_var "burnie-influencer-platform/frontend/.env" "NODE_ENV" "production" "Frontend"

echo ""
echo -e "${BLUE}📋 Checking TypeScript Backend Configuration:${NC}"
check_env_var "burnie-influencer-platform/typescript-backend/.env" "ALLOWED_ORIGINS" "https://.*burnie.io" "TypeScript Backend"
check_env_var "burnie-influencer-platform/typescript-backend/.env" "PYTHON_AI_BACKEND_URL" "https://attentionai.burnie.io" "TypeScript Backend"
check_env_var "burnie-influencer-platform/typescript-backend/.env" "TWITTER_REDIRECT_URI" "https://mining.burnie.io" "TypeScript Backend"
check_env_var "burnie-influencer-platform/typescript-backend/.env" "NODE_ENV" "production" "TypeScript Backend"

echo ""
echo -e "${BLUE}📋 Checking Python AI Backend Configuration:${NC}"
check_env_var "burnie-influencer-platform/python-ai-backend/.env" "TYPESCRIPT_BACKEND_URL" "https://mindshareapi.burnie.io" "Python AI Backend"
check_env_var "burnie-influencer-platform/python-ai-backend/.env" "APP_ENV" "production" "Python AI Backend"
check_env_var "burnie-influencer-platform/python-ai-backend/.env" "APP_DEBUG" "false" "Python AI Backend"

echo ""
echo -e "${BLUE}📋 Checking Mining Interface Configuration:${NC}"
check_env_var "mining-interface/.env" "NEXT_PUBLIC_BURNIE_API_URL" "https://mindshareapi.burnie.io/api" "Mining Interface"
check_env_var "mining-interface/.env" "NEXT_PUBLIC_AI_API_URL" "https://attentionai.burnie.io" "Mining Interface"
check_env_var "mining-interface/.env" "NEXT_PUBLIC_BURNIE_WS_URL" "wss://mindshareapi.burnie.io" "Mining Interface"
check_env_var "mining-interface/.env" "NEXT_PUBLIC_TWITTER_REDIRECT_URI" "https://mining.burnie.io" "Mining Interface"
check_env_var "mining-interface/.env" "NODE_ENV" "production" "Mining Interface"

echo ""
echo -e "${BLUE}📋 Checking Docker Compose Overrides:${NC}"
echo "Docker Compose will override the following environment variables:"
echo -e "${YELLOW}Frontend:${NC}"
echo "  - NODE_ENV=production"
echo "  - NEXT_PUBLIC_API_URL=https://mindshareapi.burnie.io"
echo "  - NEXT_PUBLIC_BACKEND_URL=https://mindshareapi.burnie.io"
echo "  - NEXT_PUBLIC_AI_BACKEND_URL=https://attentionai.burnie.io"

echo -e "${YELLOW}TypeScript Backend:${NC}"
echo "  - NODE_ENV=production"
echo "  - ALLOWED_ORIGINS=https://mining.burnie.io,https://yap.burnie.io,https://mindshareapi.burnie.io,https://attentionai.burnie.io"
echo "  - PYTHON_AI_BACKEND_URL=https://attentionai.burnie.io"
echo "  - TWITTER_REDIRECT_URI=https://mining.burnie.io/twitter-callback"

echo -e "${YELLOW}Python AI Backend:${NC}"
echo "  - APP_ENV=production"
echo "  - APP_DEBUG=false"
echo "  - TYPESCRIPT_BACKEND_URL=https://mindshareapi.burnie.io"

echo -e "${YELLOW}Mining Interface:${NC}"
echo "  - NODE_ENV=production"
echo "  - NEXT_PUBLIC_BURNIE_API_URL=https://mindshareapi.burnie.io/api"
echo "  - NEXT_PUBLIC_AI_API_URL=https://attentionai.burnie.io"
echo "  - NEXT_PUBLIC_BURNIE_WS_URL=wss://mindshareapi.burnie.io/ws"

echo ""
echo -e "${GREEN}🎯 Production URLs Summary:${NC}"
echo "  Frontend: https://yap.burnie.io"
echo "  Mining Interface: https://mining.burnie.io"
echo "  TypeScript Backend: https://mindshareapi.burnie.io"
echo "  Python AI Backend: https://attentionai.burnie.io"
echo ""
echo -e "${BLUE}💡 If you see localhost URLs above, run: ./production-env-setup.sh${NC}" 