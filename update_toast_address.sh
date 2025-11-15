#!/bin/bash
NEW_TOAST_ADDRESS="0x24dAeA2E04497e7894D7E0b3761A09B88700Cc9D"

# Update web3/.env
sed -i '' "s/TOAST_TOKEN_ADDRESS=.*/TOAST_TOKEN_ADDRESS=$NEW_TOAST_ADDRESS/" web3/.env

# Update typescript-backend/.env
sed -i '' "s/TOAST_TOKEN_ADDRESS=.*/TOAST_TOKEN_ADDRESS=$NEW_TOAST_ADDRESS/" burnie-influencer-platform/typescript-backend/.env

# Update frontend/.env (if exists)
if [ -f burnie-influencer-platform/frontend/.env ]; then
  sed -i '' "s/NEXT_PUBLIC_TOAST_TOKEN_ADDRESS=.*/NEXT_PUBLIC_TOAST_TOKEN_ADDRESS=$NEW_TOAST_ADDRESS/" burnie-influencer-platform/frontend/.env
fi

echo "✅ Updated TOAST token address to $NEW_TOAST_ADDRESS in all .env files"
