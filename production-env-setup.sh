#!/bin/bash

set -e

echo "🔧 Setting up production environment files..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to copy production env files
copy_production_env() {
    local service_path="$1"
    local service_name="$2"
    
    if [ -f "$service_path/.env.production" ]; then
        cp "$service_path/.env.production" "$service_path/.env"
        echo -e "${GREEN}✅ $service_name: Copied .env.production to .env${NC}"
    else
        echo -e "${RED}❌ $service_name: .env.production file not found at $service_path${NC}"
        return 1
    fi
}

echo "📋 Copying production environment files..."
echo ""

# Copy production env files for all services
copy_production_env "burnie-influencer-platform/frontend" "Frontend"
copy_production_env "burnie-influencer-platform/typescript-backend" "TypeScript Backend"  
copy_production_env "burnie-influencer-platform/python-ai-backend" "Python AI Backend"
copy_production_env "mining-interface" "Mining Interface"

echo ""
echo -e "${YELLOW}⚠️  Important Notes:${NC}"
echo "1. Update DATABASE_HOST in backend .env files with your actual RDS endpoint"
echo "2. Update DATABASE_PASSWORD with your actual RDS password"
echo "3. The docker-compose.yml now overrides critical URLs for production"
echo "4. Make sure your AWS RDS security group allows connections from your EC2"
echo ""
echo -e "${GREEN}🎉 Production environment setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Update database credentials in backend .env files"
echo "2. Run: ./deploy.sh"
echo "" 