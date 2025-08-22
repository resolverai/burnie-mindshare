-- Migration: Fix biddingEnabledAt field for existing biddable content
-- This ensures all content marked as biddable has the biddingEnabledAt field populated

-- Update content that is biddable but missing biddingEnabledAt
-- Set it to the createdAt date as a fallback
UPDATE content_marketplace 
SET "biddingEnabledAt" = "createdAt"
WHERE "isBiddable" = true 
  AND "biddingEnabledAt" IS NULL
  AND "approvalStatus" = 'approved';

-- Log the number of records updated
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % content records with missing biddingEnabledAt field', updated_count;
END $$;

-- Verify the fix
SELECT 
    COUNT(*) as total_biddable,
    COUNT("biddingEnabledAt") as with_bidding_enabled_at,
    COUNT(*) - COUNT("biddingEnabledAt") as missing_bidding_enabled_at
FROM content_marketplace 
WHERE "isBiddable" = true 
  AND "approvalStatus" = 'approved';
