-- ML Models Database Fixes Migration
-- This file contains all the database schema fixes applied during ML model training and prediction setup
-- Date: 2025-08-17
-- Purpose: Fix missing columns, constraints, and data types for ML training tables

-- =====================================================
-- 1. Add missing LLM prediction columns to primary_predictor_training_data
-- =====================================================

-- Add missing LLM predicted columns
ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS llm_predicted_snap_impact DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS llm_predicted_position_impact DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS llm_predicted_twitter_engagement DECIMAL(5,2) DEFAULT NULL;

-- Add missing LLM classification columns
ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS llm_content_type VARCHAR(50) DEFAULT NULL;

ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS llm_target_audience VARCHAR(50) DEFAULT NULL;

-- Add missing crypto/web3 keyword columns
ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS crypto_keyword_count INTEGER DEFAULT 0;

ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS trading_keyword_count INTEGER DEFAULT 0;

ALTER TABLE primary_predictor_training_data 
ADD COLUMN IF NOT EXISTS technical_keyword_count INTEGER DEFAULT 0;

-- =====================================================
-- 2. Add unique constraints for preventing duplicate training data
-- =====================================================

-- Add unique constraint on tweet_id for primary_predictor_training_data
ALTER TABLE primary_predictor_training_data 
ADD CONSTRAINT unique_tweet_id_primary 
UNIQUE (tweet_id) 
ON CONFLICT DO NOTHING;

-- Add unique constraint on tweet_id for twitter_engagement_training_data
ALTER TABLE twitter_engagement_training_data 
ADD CONSTRAINT unique_tweet_id_engagement 
UNIQUE (tweet_id) 
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. Fix NOT NULL constraints for twitter_engagement_training_data
-- =====================================================

-- Add missing columns to twitter_engagement_training_data if they don't exist
ALTER TABLE twitter_engagement_training_data 
ADD COLUMN IF NOT EXISTS has_media BOOLEAN DEFAULT FALSE;

ALTER TABLE twitter_engagement_training_data 
ADD COLUMN IF NOT EXISTS is_thread BOOLEAN DEFAULT FALSE;

ALTER TABLE twitter_engagement_training_data 
ADD COLUMN IF NOT EXISTS is_reply BOOLEAN DEFAULT FALSE;

-- Update any existing NULL values to FALSE for boolean columns
UPDATE twitter_engagement_training_data 
SET has_media = FALSE 
WHERE has_media IS NULL;

UPDATE twitter_engagement_training_data 
SET is_thread = FALSE 
WHERE is_thread IS NULL;

UPDATE twitter_engagement_training_data 
SET is_reply = FALSE 
WHERE is_reply IS NULL;

-- Set NOT NULL constraints after updating values
ALTER TABLE twitter_engagement_training_data 
ALTER COLUMN has_media SET NOT NULL;

ALTER TABLE twitter_engagement_training_data 
ALTER COLUMN is_thread SET NOT NULL;

ALTER TABLE twitter_engagement_training_data 
ALTER COLUMN is_reply SET NOT NULL;

-- =====================================================
-- 4. Fix incorrect twitter_handle data in platform_yapper_twitter_data
-- =====================================================

-- Note: This requires manual verification and update based on actual data
-- The following is a template - you may need to adjust based on your actual data

-- Example fix for incorrect twitter handles (replace with actual correct mappings)
-- UPDATE platform_yapper_twitter_data 
-- SET twitter_handle = 'correct_username' 
-- WHERE twitter_handle = 'incorrect_user_id' 
-- AND yapper_id = specific_yapper_id;

-- Add a comment for manual review
-- COMMENT: Review platform_yapper_twitter_data.twitter_handle column for any user IDs 
-- that should be actual Twitter usernames. Update manually based on actual data.

-- =====================================================
-- 5. Create indexes for better query performance
-- =====================================================

-- Index for platform-based queries
CREATE INDEX IF NOT EXISTS idx_primary_predictor_platform_created 
ON primary_predictor_training_data(platform_source, created_at);

-- Index for yapper-based queries  
CREATE INDEX IF NOT EXISTS idx_primary_predictor_yapper_platform 
ON primary_predictor_training_data(yapper_twitter_handle, platform_source);

-- Index for training status queries
CREATE INDEX IF NOT EXISTS idx_primary_predictor_training_status 
ON primary_predictor_training_data(training_status, platform_source);

-- Index for engagement training table
CREATE INDEX IF NOT EXISTS idx_engagement_platform_created 
ON twitter_engagement_training_data(platform_source, created_at);

CREATE INDEX IF NOT EXISTS idx_engagement_yapper_platform 
ON twitter_engagement_training_data(yapper_twitter_handle, platform_source);

-- =====================================================
-- 6. Update existing NULL values with defaults
-- =====================================================

-- Update NULL values in primary_predictor_training_data with reasonable defaults
UPDATE primary_predictor_training_data 
SET crypto_keyword_count = 0 
WHERE crypto_keyword_count IS NULL;

UPDATE primary_predictor_training_data 
SET trading_keyword_count = 0 
WHERE trading_keyword_count IS NULL;

UPDATE primary_predictor_training_data 
SET technical_keyword_count = 0 
WHERE technical_keyword_count IS NULL;

-- Update training_status to 'completed' if it's currently NULL or 'pending'
UPDATE primary_predictor_training_data 
SET training_status = 'completed' 
WHERE training_status IS NULL OR training_status = 'pending';

-- =====================================================
-- 7. Data validation and cleanup
-- =====================================================

-- Remove any records with NULL tweet_id (these can't be used for training)
DELETE FROM primary_predictor_training_data 
WHERE tweet_id IS NULL OR tweet_id = '';

DELETE FROM twitter_engagement_training_data 
WHERE tweet_id IS NULL OR tweet_id = '';

-- Update any negative engagement counts to 0
UPDATE twitter_engagement_training_data 
SET likes_count = GREATEST(likes_count, 0),
    retweets_count = GREATEST(retweets_count, 0),
    replies_count = GREATEST(replies_count, 0),
    quotes_count = GREATEST(quotes_count, 0);

-- Recalculate total_engagement
UPDATE twitter_engagement_training_data 
SET total_engagement = likes_count + retweets_count + replies_count + quotes_count;

-- =====================================================
-- 8. Add helpful comments to tables
-- =====================================================

COMMENT ON TABLE primary_predictor_training_data IS 'Main training data for SNAP and position prediction models. Each record represents a yapper content post with actual performance metrics and pre-computed LLM features.';

COMMENT ON TABLE twitter_engagement_training_data IS 'Specialized training data for Twitter engagement prediction. Contains detailed engagement metrics and social media specific features.';

COMMENT ON COLUMN primary_predictor_training_data.delta_snaps IS 'Target variable: SNAPs earned after posting (snaps_after - snaps_before)';

COMMENT ON COLUMN primary_predictor_training_data.position_change IS 'Target variable: Leaderboard position change (position_before - position_after, positive = climb up)';

COMMENT ON COLUMN twitter_engagement_training_data.total_engagement IS 'Target variable: Sum of likes + retweets + replies + quotes';

-- =====================================================
-- Migration completion
-- =====================================================

-- Log the migration completion
DO $$
BEGIN
    RAISE NOTICE 'ML Models Database Migration Completed Successfully at %', NOW();
    RAISE NOTICE 'Tables updated: primary_predictor_training_data, twitter_engagement_training_data';
    RAISE NOTICE 'Total changes: Added columns, constraints, indexes, and data cleanup';
END $$;
