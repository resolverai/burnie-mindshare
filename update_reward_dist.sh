#!/bin/bash
NEW_REWARD_DIST="0xe1472DF839155CCB8987418EB5102Ea1f2eb783D"

# Update web3/.env
sed -i '' "s/REWARD_DISTRIBUTION_ADDRESS=.*/REWARD_DISTRIBUTION_ADDRESS=$NEW_REWARD_DIST/" web3/.env

# Update typescript-backend/.env
sed -i '' "s/REWARD_DISTRIBUTION_ADDRESS=.*/REWARD_DISTRIBUTION_ADDRESS=$NEW_REWARD_DIST/" burnie-influencer-platform/typescript-backend/.env

# Update frontend/.env (if exists)
if [ -f burnie-influencer-platform/frontend/.env ]; then
  sed -i '' "s/NEXT_PUBLIC_REWARD_DISTRIBUTION_ADDRESS=.*/NEXT_PUBLIC_REWARD_DISTRIBUTION_ADDRESS=$NEW_REWARD_DIST/" burnie-influencer-platform/frontend/.env
fi

echo "✅ Updated RewardDistribution address to $NEW_REWARD_DIST in all .env files"
