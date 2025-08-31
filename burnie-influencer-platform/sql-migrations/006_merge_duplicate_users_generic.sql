-- Migration: Merge duplicate user records with different wallet address cases (GENERIC VERSION)
-- File: 006_merge_duplicate_users_generic.sql
-- Description: Generic migration that merges ANY duplicate users with mixed-case wallet addresses
-- Run this BEFORE the wallet address normalization migration if you have duplicate users
-- This works with any wallet addresses, not hardcoded to specific ones
--
-- ⚠️  IMPORTANT: This migration handles:
-- - Duplicate usernames (appends '_merged' suffix to avoid conflicts)
-- - Wallet address uniqueness constraints (temporarily renames duplicates)
-- - All foreign key references before deletion
-- - Proper data merging with default value handling
-- - Column name differences between local (wallet_address) and production (walletAddress)

-- Step 1: Create a temporary table to store the merged user data
CREATE TEMP TABLE merged_users AS
SELECT 
    -- Use the lowercase wallet address as the primary key
    LOWER(u1."walletAddress") as wallet_address_lower,
    
    -- Keep the record with the most complete data (prefer the one with more non-null fields)
    CASE 
        WHEN (CASE WHEN u1.username IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1.email IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterHandle" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterUserId" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterOauthToken" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."referralCode" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."referredByUserId" IS NOT NULL THEN 1 ELSE 0 END) >=
             (CASE WHEN u2.username IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2.email IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterHandle" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterUserId" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterOauthToken" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."referralCode" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."referredByUserId" IS NOT NULL THEN 1 ELSE 0 END)
        THEN u1.id
        ELSE u2.id
    END as id_to_keep,
    
    -- The other record to delete
    CASE 
        WHEN (CASE WHEN u1.username IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1.email IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterHandle" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterUserId" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."twitterOauthToken" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."referralCode" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u1."referredByUserId" IS NOT NULL THEN 1 ELSE 0 END) >=
             (CASE WHEN u2.username IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2.email IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterHandle" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterUserId" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."twitterOauthToken" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."referralCode" IS NOT NULL THEN 1 ELSE 0 END) + 
             (CASE WHEN u2."referredByUserId" IS NOT NULL THEN 1 ELSE 0 END)
        THEN u2.id
        ELSE u1.id
    END as id_to_delete,
    
    -- Preserve username from whichever record has it, handle duplicates
    CASE 
        WHEN u1.username IS NOT NULL AND u2.username IS NOT NULL AND u1.username != u2.username THEN
            -- If both have different usernames, append a suffix to avoid conflicts
            -- Use shorter suffix to avoid length issues
            u1.username || '_m'
        WHEN u1.username IS NOT NULL THEN u1.username
        WHEN u2.username IS NOT NULL THEN u2.username
        ELSE NULL
    END as username,
    
    -- Preserve email from whichever record has it
    COALESCE(u1.email, u2.email) as email,
    
    -- Preserve twitter handle from whichever record has it
    COALESCE(u1."twitterHandle", u2."twitterHandle") as twitter_handle,
    
    -- Preserve twitter user ID from whichever record has it
    COALESCE(u1."twitterUserId", u2."twitterUserId") as twitter_user_id,
    
    -- Preserve OAuth token from whichever record has it
    COALESCE(u1."twitterOauthToken", u2."twitterOauthToken") as twitter_oauth_token,
    
    -- Handle roleType logic: if one is 'miner' and another is 'yapper', combine to 'both'
    -- Default is 'both', so we need to check if it's the actual value or just default
    CASE 
        WHEN u1."roleType" = 'both' OR u2."roleType" = 'both' THEN 'both'
        WHEN u1."roleType" != u2."roleType" AND u1."roleType" IS NOT NULL AND u2."roleType" IS NOT NULL THEN 'both'
        WHEN u1."roleType" IS NOT NULL AND u1."roleType" != 'both' THEN u1."roleType"
        WHEN u2."roleType" IS NOT NULL AND u2."roleType" != 'both' THEN u2."roleType"
        ELSE 'both'
    END as role_type,
    
    -- Preserve referral code from whichever record has it
    COALESCE(u1."referralCode", u2."referralCode") as referral_code,
    
    -- Preserve referred by user ID from whichever record has it
    COALESCE(u1."referredByUserId", u2."referredByUserId") as referred_by_user_id,
    
    -- Sum the referral counts (avoid default value 0)
    CASE 
        WHEN u1."referralCount" IS NOT NULL AND u2."referralCount" IS NOT NULL THEN u1."referralCount" + u2."referralCount"
        WHEN u1."referralCount" IS NOT NULL THEN u1."referralCount"
        WHEN u2."referralCount" IS NOT NULL THEN u2."referralCount"
        ELSE 0
    END as referral_count,
    
    -- Sum the total referral earnings (avoid default value 0)
    CASE 
        WHEN u1."totalReferralEarnings" IS NOT NULL AND u2."totalReferralEarnings" IS NOT NULL THEN u1."totalReferralEarnings" + u2."totalReferralEarnings"
        WHEN u1."totalReferralEarnings" IS NOT NULL THEN u1."totalReferralEarnings"
        WHEN u2."totalReferralEarnings" IS NOT NULL THEN u2."totalReferralEarnings"
        ELSE 0
    END as total_referral_earnings,
    
    -- Sum the total earnings (avoid default value 0)
    CASE 
        WHEN u1."totalEarnings" IS NOT NULL AND u2."totalEarnings" IS NOT NULL THEN u1."totalEarnings" + u2."totalEarnings"
        WHEN u1."totalEarnings" IS NOT NULL THEN u1."totalEarnings"
        WHEN u2."totalEarnings" IS NOT NULL THEN u2."totalEarnings"
        ELSE 0
    END as total_earnings,
    
    -- Sum the roast balance (avoid default value 0)
    CASE 
        WHEN u1."roastBalance" IS NOT NULL AND u2."roastBalance" IS NOT NULL THEN u1."roastBalance" + u2."roastBalance"
        WHEN u1."roastBalance" IS NOT NULL THEN u1."roastBalance"
        WHEN u2."roastBalance" IS NOT NULL THEN u2."roastBalance"
        ELSE 0
    END as roast_balance,
    
    -- Sum the USDC balance (avoid default value 0)
    CASE 
        WHEN u1."usdcBalance" IS NOT NULL AND u2."usdcBalance" IS NOT NULL THEN u1."usdcBalance" + u2."usdcBalance"
        WHEN u1."usdcBalance" IS NOT NULL THEN u1."usdcBalance"
        WHEN u2."usdcBalance" IS NOT NULL THEN u2."usdcBalance"
        ELSE 0
    END as usdc_balance,
    
    -- Take the higher reputation score (avoid default value 0)
    CASE 
        WHEN u1."reputationScore" IS NOT NULL AND u2."reputationScore" IS NOT NULL THEN 
            CASE WHEN u1."reputationScore" > u2."reputationScore" THEN u1."reputationScore" ELSE u2."reputationScore" END
        WHEN u1."reputationScore" IS NOT NULL THEN u1."reputationScore"
        WHEN u2."reputationScore" IS NOT NULL THEN u2."reputationScore"
        ELSE 0
    END as reputation_score,
    
    -- Preserve verification status (if either is verified, keep verified)
    COALESCE(u1."isVerified", false) as is_verified_1,
    COALESCE(u2."isVerified", false) as is_verified_2,
    
    -- Preserve admin status (if either is admin, keep admin)
    COALESCE(u1."isAdmin", false) as is_admin_1,
    COALESCE(u2."isAdmin", false) as is_admin_2,
    
    -- Preserve access status (APPROVED takes priority over PENDING_REFERRAL)
    CASE 
        WHEN u1."accessStatus" = 'APPROVED' OR u2."accessStatus" = 'APPROVED' THEN 'APPROVED'
        WHEN u1."accessStatus" = 'PENDING_REFERRAL' OR u2."accessStatus" = 'PENDING_REFERRAL' THEN 'PENDING_REFERRAL'
        ELSE COALESCE(u1."accessStatus", u2."accessStatus")
    END as access_status,
    
    -- Merge profiles (keep non-null values)
    COALESCE(u1.profile, u2.profile) as profile,
    
    -- Merge preferences (keep non-null values)
    COALESCE(u1.preferences, u2.preferences) as preferences,
    
    -- Take the most recent last active time (avoid default now() values)
    CASE 
        WHEN u1."lastActiveAt" IS NOT NULL AND u2."lastActiveAt" IS NOT NULL THEN 
            CASE WHEN u1."lastActiveAt" > u2."lastActiveAt" THEN u1."lastActiveAt" ELSE u2."lastActiveAt" END
        WHEN u1."lastActiveAt" IS NOT NULL THEN u1."lastActiveAt"
        WHEN u2."lastActiveAt" IS NOT NULL THEN u2."lastActiveAt"
        ELSE NULL
    END as last_active_at,
    
    -- Take the earliest creation time (avoid default now() values)
    CASE 
        WHEN u1."createdAt" IS NOT NULL AND u2."createdAt" IS NOT NULL THEN 
            CASE WHEN u1."createdAt" < u2."createdAt" THEN u1."createdAt" ELSE u2."createdAt" END
        WHEN u1."createdAt" IS NOT NULL THEN u1."createdAt"
        WHEN u2."createdAt" IS NOT NULL THEN u2."createdAt"
        ELSE NULL
    END as created_at,
    
    -- Take the most recent update time (avoid default now() values)
    CASE 
        WHEN u1."updatedAt" IS NOT NULL AND u2."updatedAt" IS NOT NULL THEN 
            CASE WHEN u1."updatedAt" > u2."updatedAt" THEN u1."updatedAt" ELSE u2."updatedAt" END
        WHEN u1."updatedAt" IS NOT NULL THEN u1."updatedAt"
        WHEN u2."updatedAt" IS NOT NULL THEN u2."updatedAt"
        ELSE NULL
    END as updated_at

FROM users u1
INNER JOIN users u2 ON LOWER(u1."walletAddress") = LOWER(u2."walletAddress") AND u1.id != u2.id
WHERE u1."walletAddress" != u2."walletAddress"  -- Different cases
  AND LOWER(u1."walletAddress") = LOWER(u2."walletAddress");  -- Same when lowercased

            -- Step 2: Update the record we want to keep with merged data
            UPDATE users
            SET
                username = CASE 
                    -- If username would cause conflict, generate a unique one
                    WHEN EXISTS (
                        SELECT 1 FROM users u2 
                        WHERE u2.username = mu.username AND u2.id != mu.id_to_keep
                    ) THEN 
                        COALESCE(mu.username, 'User') || '_' || mu.id_to_keep
                    ELSE mu.username
                END,
                email = mu.email,
                "twitterHandle" = mu.twitter_handle,
                "twitterUserId" = mu.twitter_user_id,
                "twitterOauthToken" = mu.twitter_oauth_token,
                "roleType" = mu.role_type::users_roletype_enum,
                "referralCode" = mu.referral_code,
                "referredByUserId" = mu.referred_by_user_id,
                "referralCount" = mu.referral_count,
                "totalReferralEarnings" = mu.total_referral_earnings,
                "totalEarnings" = mu.total_earnings,
                "roastBalance" = mu.roast_balance,
                "usdcBalance" = mu.usdc_balance,
                "reputationScore" = mu.reputation_score,
                "isVerified" = (mu.is_verified_1 OR mu.is_verified_2),
                "isAdmin" = (mu.is_admin_1 OR mu.is_admin_2),
                "accessStatus" = mu.access_status::users_accessstatus_enum,
                profile = mu.profile,
                preferences = mu.preferences,
                "lastActiveAt" = mu.last_active_at,
                "createdAt" = mu.created_at,
                "updatedAt" = mu.updated_at
            FROM merged_users mu
            WHERE users.id = mu.id_to_keep;

-- Step 3: Update ALL foreign key references that use user ID FIRST
-- Update content_marketplace.creatorId
UPDATE content_marketplace 
SET "creatorId" = mu.id_to_keep
FROM merged_users mu
WHERE content_marketplace."creatorId" = mu.id_to_delete;

-- Update miners.userId
UPDATE miners 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE miners."userId" = mu.id_to_delete;

-- Update waitlist.approvedByUserId
UPDATE waitlist 
SET "approvedByUserId" = mu.id_to_keep
FROM merged_users mu
WHERE waitlist."approvedByUserId" = mu.id_to_delete;

-- Update projects.ownerId
UPDATE projects 
SET "ownerId" = mu.id_to_keep
FROM merged_users mu
WHERE projects."ownerId" = mu.id_to_delete;

-- Update agent_configurations.userId
UPDATE agent_configurations 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE agent_configurations."userId" = mu.id_to_delete;

-- Update bidding_system.bidderId
UPDATE bidding_system 
SET "bidderId" = mu.id_to_keep
FROM merged_users mu
WHERE bidding_system."bidderId" = mu.id_to_delete;

-- Update payment_transactions.fromUserId
UPDATE payment_transactions 
SET "fromUserId" = mu.id_to_keep
FROM merged_users mu
WHERE payment_transactions."fromUserId" = mu.id_to_delete;

-- Update payment_transactions.toUserId
UPDATE payment_transactions 
SET "toUserId" = mu.id_to_keep
FROM merged_users mu
WHERE payment_transactions."toUserId" = mu.id_to_delete;

-- Update twitter_learning_data.userId
UPDATE twitter_learning_data 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE twitter_learning_data."userId" = mu.id_to_delete;

-- Update twitter_user_connections.userId
UPDATE twitter_user_connections 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE twitter_user_connections."userId" = mu.id_to_delete;

            -- Update yapper_twitter_connections.userId
            UPDATE yapper_twitter_connections
            SET "userId" = mu.id_to_keep
            FROM merged_users mu
            WHERE yapper_twitter_connections."userId" = mu.id_to_delete;

            -- Update yapper_twitter_connections.connectedUserId (if this column exists)
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'yapper_twitter_connections' AND column_name = 'connectedUserId'
                ) THEN
                    UPDATE yapper_twitter_connections
                    SET "connectedUserId" = mu.id_to_keep
                    FROM merged_users mu
                    WHERE yapper_twitter_connections."connectedUserId" = mu.id_to_delete;
                END IF;
            END $$;

-- Update snap_predictions.yapperId
UPDATE snap_predictions 
SET "yapperId" = mu.id_to_keep
FROM merged_users mu
WHERE snap_predictions."yapperId" = mu.id_to_delete;

-- Update platform_snapshots.createdBy
UPDATE platform_snapshots 
SET "createdBy" = mu.id_to_keep
FROM merged_users mu
WHERE platform_snapshots."createdBy" = mu.id_to_delete;

-- Update user_referrals.userId
UPDATE user_referrals 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE user_referrals."userId" = mu.id_to_delete;

-- Update user_referrals.directReferrerId
UPDATE user_referrals 
SET "directReferrerId" = mu.id_to_keep
FROM merged_users mu
WHERE user_referrals."directReferrerId" = mu.id_to_delete;

-- Update user_referrals.grandReferrerId
UPDATE user_referrals 
SET "grandReferrerId" = mu.id_to_keep
FROM merged_users mu
WHERE user_referrals."grandReferrerId" = mu.id_to_delete;

-- Update execution_tracking.userId
UPDATE execution_tracking 
SET "userId" = mu.id_to_keep
FROM merged_users mu
WHERE execution_tracking."userId" = mu.id_to_delete;

-- Step 4: Update all wallet address references to point to the kept record
-- Update content_purchases.buyer_wallet_address references
UPDATE content_purchases 
SET "buyer_wallet_address" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE content_purchases."buyer_wallet_address" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

-- Update content_purchases.miner_wallet_address references
UPDATE content_purchases 
SET "miner_wallet_address" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE content_purchases."miner_wallet_address" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

            -- Update content_marketplace wallet address references (handle both column names)
            -- Try walletAddress first (production), fallback to wallet_address (local)
            DO $$
            BEGIN
                -- Check if walletAddress column exists
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'content_marketplace' AND column_name = 'walletAddress'
                ) THEN
                    -- Production: use walletAddress
                    UPDATE content_marketplace
                    SET "walletAddress" = LOWER(mu.wallet_address_lower)
                    FROM merged_users mu
                    WHERE content_marketplace."walletAddress" IN (
                        SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
                    );
                ELSE
                    -- Local: use wallet_address
                    UPDATE content_marketplace
                    SET wallet_address = LOWER(mu.wallet_address_lower)
                    FROM merged_users mu
                    WHERE content_marketplace.wallet_address IN (
                        SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
                    );
                END IF;
            END $$;

-- Update miners.walletAddress references
UPDATE miners 
SET "walletAddress" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE miners."walletAddress" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

-- Update waitlist.walletAddress references
UPDATE waitlist 
SET "walletAddress" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE waitlist."walletAddress" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

-- Update referral_codes.leaderWalletAddress references
UPDATE referral_codes 
SET "leaderWalletAddress" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE referral_codes."leaderWalletAddress" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

-- Update referral_payouts.payoutWalletAddress references
UPDATE referral_payouts 
SET "payoutWalletAddress" = LOWER(mu.wallet_address_lower)
FROM merged_users mu
WHERE referral_payouts."payoutWalletAddress" IN (
    SELECT "walletAddress" FROM users WHERE id IN (mu.id_to_keep, mu.id_to_delete)
);

            -- Step 5: Handle wallet address uniqueness constraint
            -- First, temporarily update the duplicate wallet address to avoid constraint violation
            -- Use shorter suffix to stay within 42 character limit
            UPDATE users
            SET "walletAddress" = LEFT("walletAddress", 38) || '_' || id
            FROM merged_users mu
            WHERE users.id = mu.id_to_delete;

            -- Step 6: NOW update the wallet address to lowercase for the kept record
            UPDATE users
            SET "walletAddress" = LOWER("walletAddress")
            FROM merged_users mu
            WHERE users.id = mu.id_to_keep;

            -- Step 7: Delete the duplicate records
            DELETE FROM users
            WHERE id IN (
                SELECT id_to_delete FROM merged_users
            );

            -- Step 8: Clean up temporary table
            DROP TABLE merged_users;

-- Migration completed successfully
-- All duplicate user records have been merged
-- Wallet addresses are now normalized to lowercase
-- ALL foreign key references have been updated
-- Ready to run the wallet address normalization migration
