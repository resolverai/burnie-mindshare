#!/bin/bash
# Integration Verification Script
# This script verifies that all contract addresses and ABIs are correctly configured

echo "🔍 SOMNIA INTEGRATION VERIFICATION"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Expected values
EXPECTED_TOAST="0x73e051113358CaBaAF6eC8d8C0E0FC97FC687379"
EXPECTED_CONTENT="0x2ba09c364187B4e97A15D4EC6F41c596150Cb5C8"
EXPECTED_REWARD="0xBc6e117dC467B0F276203d5015eea5B57547e7e6"
EXPECTED_RPC="https://dream-rpc.somnia.network"

# Function to check if value matches expected
check_value() {
    local name=$1
    local actual=$2
    local expected=$3
    
    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✅${NC} $name: $actual"
        return 0
    else
        echo -e "  ${RED}❌${NC} $name: $actual (Expected: $expected)"
        return 1
    fi
}

# Check TypeScript Backend
echo "📦 TypeScript Backend (.env)"
echo "----------------------------"
BACKEND_ENV="burnie-influencer-platform/typescript-backend/.env"

if [ -f "$BACKEND_ENV" ]; then
    BACKEND_TOAST=$(grep "^TOAST_TOKEN_ADDRESS=" "$BACKEND_ENV" | cut -d'=' -f2)
    BACKEND_CONTENT=$(grep "^CONTENT_REGISTRY_ADDRESS=" "$BACKEND_ENV" | cut -d'=' -f2)
    BACKEND_REWARD=$(grep "^REWARD_DISTRIBUTION_ADDRESS=" "$BACKEND_ENV" | cut -d'=' -f2)
    BACKEND_RPC=$(grep "^SOMNIA_TESTNET_RPC_URL=" "$BACKEND_ENV" | cut -d'=' -f2)
    
    check_value "TOAST Token" "$BACKEND_TOAST" "$EXPECTED_TOAST"
    check_value "Content Registry" "$BACKEND_CONTENT" "$EXPECTED_CONTENT"
    check_value "Reward Distribution" "$BACKEND_REWARD" "$EXPECTED_REWARD"
    check_value "RPC URL" "$BACKEND_RPC" "$EXPECTED_RPC"
else
    echo -e "  ${RED}❌${NC} File not found: $BACKEND_ENV"
fi

echo ""

# Check Frontend
echo "🎨 Frontend (.env)"
echo "------------------"
FRONTEND_ENV="burnie-influencer-platform/frontend/.env"

if [ -f "$FRONTEND_ENV" ]; then
    FRONTEND_TOAST=$(grep "^NEXT_PUBLIC_TOAST_TOKEN_ADDRESS=" "$FRONTEND_ENV" | cut -d'=' -f2)
    FRONTEND_CONTENT=$(grep "^NEXT_PUBLIC_CONTENT_REGISTRY_ADDRESS=" "$FRONTEND_ENV" | cut -d'=' -f2)
    FRONTEND_REWARD=$(grep "^NEXT_PUBLIC_REWARD_DISTRIBUTION_ADDRESS=" "$FRONTEND_ENV" | cut -d'=' -f2)
    FRONTEND_RPC=$(grep "^NEXT_PUBLIC_SOMNIA_RPC_URL=" "$FRONTEND_ENV" | cut -d'=' -f2)
    
    check_value "TOAST Token" "$FRONTEND_TOAST" "$EXPECTED_TOAST"
    check_value "Content Registry" "$FRONTEND_CONTENT" "$EXPECTED_CONTENT"
    check_value "Reward Distribution" "$FRONTEND_REWARD" "$EXPECTED_REWARD"
    check_value "RPC URL" "$FRONTEND_RPC" "$EXPECTED_RPC"
else
    echo -e "  ${RED}❌${NC} File not found: $FRONTEND_ENV"
fi

echo ""

# Check Frontend Production
echo "🎨 Frontend (.env.production)"
echo "------------------------------"
FRONTEND_PROD_ENV="burnie-influencer-platform/frontend/.env.production"

if [ -f "$FRONTEND_PROD_ENV" ]; then
    FRONTEND_PROD_TOAST=$(grep "^NEXT_PUBLIC_TOAST_TOKEN_ADDRESS=" "$FRONTEND_PROD_ENV" | cut -d'=' -f2)
    FRONTEND_PROD_CONTENT=$(grep "^NEXT_PUBLIC_CONTENT_REGISTRY_ADDRESS=" "$FRONTEND_PROD_ENV" | cut -d'=' -f2)
    FRONTEND_PROD_REWARD=$(grep "^NEXT_PUBLIC_REWARD_DISTRIBUTION_ADDRESS=" "$FRONTEND_PROD_ENV" | cut -d'=' -f2)
    FRONTEND_PROD_RPC=$(grep "^NEXT_PUBLIC_SOMNIA_RPC_URL=" "$FRONTEND_PROD_ENV" | cut -d'=' -f2)
    
    check_value "TOAST Token" "$FRONTEND_PROD_TOAST" "$EXPECTED_TOAST"
    check_value "Content Registry" "$FRONTEND_PROD_CONTENT" "$EXPECTED_CONTENT"
    check_value "Reward Distribution" "$FRONTEND_PROD_REWARD" "$EXPECTED_REWARD"
    check_value "RPC URL" "$FRONTEND_PROD_RPC" "$EXPECTED_RPC"
else
    echo -e "  ${RED}❌${NC} File not found: $FRONTEND_PROD_ENV"
fi

echo ""

# Check Web3 Repository
echo "⚙️  Web3 Repository (.env)"
echo "--------------------------"
WEB3_ENV="web3/.env"

if [ -f "$WEB3_ENV" ]; then
    WEB3_TOAST=$(grep "^TOAST_TOKEN_ADDRESS=" "$WEB3_ENV" | cut -d'=' -f2)
    WEB3_CONTENT=$(grep "^CONTENT_REGISTRY_ADDRESS=" "$WEB3_ENV" | cut -d'=' -f2)
    WEB3_REWARD=$(grep "^REWARD_DISTRIBUTION_ADDRESS=" "$WEB3_ENV" | cut -d'=' -f2)
    WEB3_RPC=$(grep "^SOMNIA_TESTNET_RPC_URL=" "$WEB3_ENV" | cut -d'=' -f2)
    
    check_value "TOAST Token" "$WEB3_TOAST" "$EXPECTED_TOAST"
    check_value "Content Registry" "$WEB3_CONTENT" "$EXPECTED_CONTENT"
    check_value "Reward Distribution" "$WEB3_REWARD" "$EXPECTED_REWARD"
    check_value "RPC URL" "$WEB3_RPC" "$EXPECTED_RPC"
else
    echo -e "  ${RED}❌${NC} File not found: $WEB3_ENV"
fi

echo ""

# Check ABIs
echo "📄 Contract ABIs"
echo "----------------"

# Check Frontend ABIs
FRONTEND_CONTRACTS="burnie-influencer-platform/frontend/src/contracts"
if [ -d "$FRONTEND_CONTRACTS" ]; then
    if [ -f "$FRONTEND_CONTRACTS/TOASTToken.json" ]; then
        echo -e "  ${GREEN}✅${NC} Frontend: TOASTToken.json exists"
    else
        echo -e "  ${RED}❌${NC} Frontend: TOASTToken.json missing"
    fi
    
    if [ -f "$FRONTEND_CONTRACTS/ContentRegistry.json" ]; then
        echo -e "  ${GREEN}✅${NC} Frontend: ContentRegistry.json exists"
    else
        echo -e "  ${RED}❌${NC} Frontend: ContentRegistry.json missing"
    fi
    
    if [ -f "$FRONTEND_CONTRACTS/ContentRewardDistribution.json" ]; then
        echo -e "  ${GREEN}✅${NC} Frontend: ContentRewardDistribution.json exists"
    else
        echo -e "  ${RED}❌${NC} Frontend: ContentRewardDistribution.json missing"
    fi
else
    echo -e "  ${RED}❌${NC} Frontend contracts directory not found"
fi

# Check Web3 Artifacts
WEB3_ARTIFACTS="web3/artifacts/contracts"
if [ -d "$WEB3_ARTIFACTS" ]; then
    if [ -f "$WEB3_ARTIFACTS/TOASTToken.sol/TOASTToken.json" ]; then
        echo -e "  ${GREEN}✅${NC} Web3: TOASTToken.json artifact exists"
    else
        echo -e "  ${RED}❌${NC} Web3: TOASTToken.json artifact missing"
    fi
    
    if [ -f "$WEB3_ARTIFACTS/ContentRegistry.sol/ContentRegistry.json" ]; then
        echo -e "  ${GREEN}✅${NC} Web3: ContentRegistry.json artifact exists"
    else
        echo -e "  ${RED}❌${NC} Web3: ContentRegistry.json artifact missing"
    fi
    
    if [ -f "$WEB3_ARTIFACTS/ContentRewardDistribution.sol/ContentRewardDistribution.json" ]; then
        echo -e "  ${GREEN}✅${NC} Web3: ContentRewardDistribution.json artifact exists"
    else
        echo -e "  ${RED}❌${NC} Web3: ContentRewardDistribution.json artifact missing"
    fi
else
    echo -e "  ${RED}❌${NC} Web3 artifacts directory not found"
fi

echo ""

# Check Backend Services
echo "🔧 Backend Services"
echo "-------------------"
BACKEND_SERVICE="burnie-influencer-platform/typescript-backend/src/services/somniaBlockchainService.ts"
if [ -f "$BACKEND_SERVICE" ]; then
    echo -e "  ${GREEN}✅${NC} somniaBlockchainService.ts exists"
    
    # Check if it imports the correct ABIs or defines them
    if grep -q "TOAST_TOKEN_ABI" "$BACKEND_SERVICE"; then
        echo -e "  ${GREEN}✅${NC} TOAST Token ABI defined"
    else
        echo -e "  ${YELLOW}⚠️${NC}  TOAST Token ABI not found"
    fi
    
    if grep -q "CONTENT_REGISTRY_ABI" "$BACKEND_SERVICE"; then
        echo -e "  ${GREEN}✅${NC} Content Registry ABI defined"
    else
        echo -e "  ${YELLOW}⚠️${NC}  Content Registry ABI not found"
    fi
    
    if grep -q "REWARD_DISTRIBUTION_ABI" "$BACKEND_SERVICE"; then
        echo -e "  ${GREEN}✅${NC} Reward Distribution ABI defined"
    else
        echo -e "  ${YELLOW}⚠️${NC}  Reward Distribution ABI not found"
    fi
else
    echo -e "  ${RED}❌${NC} somniaBlockchainService.ts not found"
fi

echo ""

# Check Frontend Hooks
echo "🪝 Frontend Hooks"
echo "-----------------"
FRONTEND_HOOK="burnie-influencer-platform/frontend/src/hooks/useSomniaPurchase.ts"
if [ -f "$FRONTEND_HOOK" ]; then
    echo -e "  ${GREEN}✅${NC} useSomniaPurchase.ts exists"
    
    # Check if it imports the correct ABIs
    if grep -q "import TOASTTokenABI from" "$FRONTEND_HOOK"; then
        echo -e "  ${GREEN}✅${NC} TOASTToken ABI imported"
    else
        echo -e "  ${RED}❌${NC} TOASTToken ABI import missing"
    fi
    
    if grep -q "import ContentRegistryABI from" "$FRONTEND_HOOK"; then
        echo -e "  ${GREEN}✅${NC} ContentRegistry ABI imported"
    else
        echo -e "  ${RED}❌${NC} ContentRegistry ABI import missing"
    fi
else
    echo -e "  ${RED}❌${NC} useSomniaPurchase.ts not found"
fi

echo ""
echo "=================================="
echo "✅ Verification Complete!"
echo ""
echo "📋 Contract Addresses:"
echo "  TOAST Token:         $EXPECTED_TOAST"
echo "  Content Registry:    $EXPECTED_CONTENT"
echo "  Reward Distribution: $EXPECTED_REWARD"
echo ""
echo "🔗 Somnia Explorer Links:"
echo "  TOAST:   https://somnia.w3us.site/address/$EXPECTED_TOAST"
echo "  Content: https://somnia.w3us.site/address/$EXPECTED_CONTENT"
echo "  Rewards: https://somnia.w3us.site/address/$EXPECTED_REWARD"
echo ""

