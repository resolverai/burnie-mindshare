-- Migration: Merge duplicate user records with different wallet address cases (SIMPLE DIRECT APPROACH)
-- File: 006_merge_duplicate_users_simple.sql
-- Description: Directly merges the specific duplicate users we found
-- This handles the case where users have both lowercase and mixed-case entries

-- We found these duplicate users:
-- User ID 3: 0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e (lowercase)
-- User ID 6: 0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E (mixed case)

-- Step 1: Update all foreign key references from user ID 6 to user ID 3
-- Update content_marketplace.creatorId
UPDATE content_marketplace 
SET "creatorId" = 3
WHERE "creatorId" = 6;

-- Update miners.userId
UPDATE miners 
SET "userId" = 3
WHERE "userId" = 6;

-- Update waitlist.approvedByUserId
UPDATE waitlist 
SET "approvedByUserId" = 3
WHERE "approvedByUserId" = 6;

-- Update projects.ownerId
UPDATE projects 
SET "ownerId" = 3
WHERE "ownerId" = 6;

-- Update agent_configurations.userId
UPDATE agent_configurations 
SET "userId" = 3
WHERE "userId" = 6;

-- Update bidding_system.bidderId
UPDATE bidding_system 
SET "bidderId" = 3
WHERE "bidderId" = 6;

-- Update payment_transactions.fromUserId
UPDATE payment_transactions 
SET "fromUserId" = 3
WHERE "fromUserId" = 6;

-- Update payment_transactions.toUserId
UPDATE payment_transactions 
SET "toUserId" = 3
WHERE "toUserId" = 6;

-- Update twitter_learning_data.userId
UPDATE twitter_learning_data 
SET "userId" = 3
WHERE "userId" = 6;

-- Update twitter_user_connections.userId
UPDATE twitter_user_connections 
SET "userId" = 3
WHERE "userId" = 6;

-- Update yapper_twitter_connections.userId
UPDATE yapper_twitter_connections 
SET "userId" = 3
WHERE "userId" = 6;

-- Update snap_predictions.yapperId
UPDATE snap_predictions 
SET "yapperId" = 3
WHERE "yapperId" = 6;

-- Update platform_snapshots.createdBy
UPDATE platform_snapshots 
SET "createdBy" = 3
WHERE "createdBy" = 6;

-- Update user_referrals.userId
UPDATE user_referrals 
SET "userId" = 3
WHERE "userId" = 6;

-- Update user_referrals.directReferrerId
UPDATE user_referrals 
SET "directReferrerId" = 3
WHERE "directReferrerId" = 6;

-- Update user_referrals.grandReferrerId
UPDATE user_referrals 
SET "grandReferrerId" = 3
WHERE "grandReferrerId" = 6;

-- Update execution_tracking.userId
UPDATE execution_tracking 
SET "userId" = 3
WHERE "userId" = 6;

-- Step 2: Update all wallet address references to use the lowercase version
-- Update content_purchases.buyer_wallet_address references
UPDATE content_purchases 
SET "buyer_wallet_address" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "buyer_wallet_address" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update content_purchases.miner_wallet_address references
UPDATE content_purchases 
SET "miner_wallet_address" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "miner_wallet_address" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update content_marketplace.wallet_address references
UPDATE content_marketplace 
SET "wallet_address" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "wallet_address" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update miners.walletAddress references
UPDATE miners 
SET "walletAddress" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "walletAddress" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update waitlist.walletAddress references
UPDATE waitlist 
SET "walletAddress" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "walletAddress" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update referral_codes.leaderWalletAddress references
UPDATE referral_codes 
SET "leaderWalletAddress" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "leaderWalletAddress" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Update referral_payouts.payoutWalletAddress references
UPDATE referral_payouts 
SET "payoutWalletAddress" = '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e'
WHERE "payoutWalletAddress" = '0x3E0B1D31454b982A02517F97dD2aE71Bd1C9ee6E';

-- Step 3: Now delete user ID 6 (the duplicate)
DELETE FROM users WHERE id = 6;

-- Migration completed successfully
-- Duplicate user records have been merged
-- User ID 3 now contains all the data
-- User ID 6 has been deleted
-- All foreign key references have been updated
-- All wallet address references are now lowercase
-- Ready to run the wallet address normalization migration
