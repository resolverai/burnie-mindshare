#!/bin/bash
# Simple command to run the content_purchases migration

# Method 1: Run the SQL file directly
psql -h 127.0.0.1 -p 5434 -U postgres -d roastpower -f fix_content_purchases_migration.sql

# Method 2: One-liner command (alternative)
# psql -h 127.0.0.1 -p 5434 -U postgres -d roastpower -c "
# BEGIN;
# ALTER TABLE content_purchases ADD COLUMN IF NOT EXISTS payment_currency VARCHAR(20), ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(20,8), ADD COLUMN IF NOT EXISTS original_roast_price NUMERIC(20,8), ADD COLUMN IF NOT EXISTS miner_payout_roast NUMERIC(20,8) DEFAULT 0;
# UPDATE content_purchases SET payment_currency = 'ROAST' WHERE payment_currency IS NULL;
# UPDATE content_purchases SET conversion_rate = 0.05 WHERE conversion_rate IS NULL;
# UPDATE content_purchases SET original_roast_price = COALESCE(purchase_price, 0) WHERE original_roast_price IS NULL;
# UPDATE content_purchases SET miner_payout_roast = COALESCE(purchase_price * 0.8, 0) WHERE miner_payout_roast IS NULL;
# ALTER TABLE content_purchases ALTER COLUMN payment_currency SET NOT NULL, ALTER COLUMN payment_currency SET DEFAULT 'ROAST';
# ALTER TABLE content_purchases ALTER COLUMN conversion_rate SET NOT NULL, ALTER COLUMN conversion_rate SET DEFAULT 0.05;
# ALTER TABLE content_purchases ALTER COLUMN original_roast_price SET NOT NULL, ALTER COLUMN original_roast_price SET DEFAULT 0;
# COMMIT;
# " 