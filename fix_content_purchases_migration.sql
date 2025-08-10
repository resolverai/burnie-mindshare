-- Fix content_purchases table migration script
-- Run this script to fix NULL constraint issues and add missing columns

-- Connect to database: psql -h 127.0.0.1 -p 5434 -U postgres -d roastpower

BEGIN;

-- Step 1: Add missing columns if they don't exist (no constraints yet)
ALTER TABLE content_purchases 
ADD COLUMN IF NOT EXISTS payment_currency VARCHAR(20),
ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(20,8),
ADD COLUMN IF NOT EXISTS original_roast_price NUMERIC(20,8),
ADD COLUMN IF NOT EXISTS miner_payout_roast NUMERIC(20,8) DEFAULT 0;

-- Step 2: Update NULL values with appropriate defaults
UPDATE content_purchases 
SET payment_currency = 'ROAST' 
WHERE payment_currency IS NULL;

UPDATE content_purchases 
SET conversion_rate = 0.05 
WHERE conversion_rate IS NULL;

UPDATE content_purchases 
SET original_roast_price = COALESCE(purchase_price, 0)
WHERE original_roast_price IS NULL;

UPDATE content_purchases 
SET miner_payout_roast = COALESCE(purchase_price * 0.8, 0)
WHERE miner_payout_roast IS NULL;

-- Step 3: Apply NOT NULL constraints after fixing NULL values
ALTER TABLE content_purchases 
ALTER COLUMN payment_currency SET NOT NULL,
ALTER COLUMN payment_currency SET DEFAULT 'ROAST';

ALTER TABLE content_purchases 
ALTER COLUMN conversion_rate SET NOT NULL,
ALTER COLUMN conversion_rate SET DEFAULT 0.05;

ALTER TABLE content_purchases 
ALTER COLUMN original_roast_price SET NOT NULL,
ALTER COLUMN original_roast_price SET DEFAULT 0;

-- Step 4: Verify the changes
SELECT 
    COUNT(*) as total_records,
    COUNT(payment_currency) as non_null_payment_currency,
    COUNT(conversion_rate) as non_null_conversion_rate,
    COUNT(original_roast_price) as non_null_original_roast_price,
    COUNT(miner_payout_roast) as non_null_miner_payout_roast
FROM content_purchases;

-- Show sample data
SELECT id, purchase_price, payment_currency, conversion_rate, original_roast_price, miner_payout_roast 
FROM content_purchases 
LIMIT 5;

COMMIT;

-- Success message
\echo 'Migration completed successfully! All content_purchases columns are now properly configured.' 