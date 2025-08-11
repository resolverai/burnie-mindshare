-- Manual Migration: Convert rewardPool from bigint to text
-- Run this before starting the TypeScript backend
-- Note: TypeORM uses camelCase column names

-- Step 1: Add a temporary text column
ALTER TABLE campaigns ADD COLUMN "rewardPoolText" TEXT;

-- Step 2: Copy data from bigint to text column (handle the camelCase column name)
UPDATE campaigns SET "rewardPoolText" = "rewardPool"::text WHERE "rewardPool" IS NOT NULL;

-- Step 3: Drop the old bigint column
ALTER TABLE campaigns DROP COLUMN "rewardPool";

-- Step 4: Rename the new column to the original name
ALTER TABLE campaigns RENAME COLUMN "rewardPoolText" TO "rewardPool";

-- Step 5: Add NOT NULL constraint if needed (optional, depends on your requirements)
-- ALTER TABLE campaigns ALTER COLUMN "rewardPool" SET NOT NULL;

-- Verify the migration
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'campaigns' AND column_name = 'rewardPool'; 