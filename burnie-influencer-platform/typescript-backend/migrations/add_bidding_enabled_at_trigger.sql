-- Migration: Add database trigger to automatically set biddingEnabledAt
-- This ensures the field is always populated when content becomes biddable

-- Create a function to automatically set biddingEnabledAt
CREATE OR REPLACE FUNCTION set_bidding_enabled_at()
RETURNS TRIGGER AS $$
BEGIN
    -- If content is being enabled for bidding and biddingEnabledAt is not set
    IF NEW."isBiddable" = true AND (NEW."biddingEnabledAt" IS NULL OR OLD."biddingEnabledAt" IS NULL) THEN
        NEW."biddingEnabledAt" = COALESCE(NEW."biddingEnabledAt", NOW());
        RAISE NOTICE 'Automatically set biddingEnabledAt for content ID %', NEW.id;
    END IF;
    
    -- If content is being disabled for bidding, clear the field
    IF NEW."isBiddable" = false THEN
        NEW."biddingEnabledAt" = NULL;
        RAISE NOTICE 'Cleared biddingEnabledAt for content ID %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_set_bidding_enabled_at ON content_marketplace;
CREATE TRIGGER trigger_set_bidding_enabled_at
    BEFORE UPDATE ON content_marketplace
    FOR EACH ROW
    EXECUTE FUNCTION set_bidding_enabled_at();

-- Also create a trigger for INSERT operations
DROP TRIGGER IF EXISTS trigger_set_bidding_enabled_at_insert ON content_marketplace;
CREATE TRIGGER trigger_set_bidding_enabled_at_insert
    BEFORE INSERT ON content_marketplace
    FOR EACH ROW
    EXECUTE FUNCTION set_bidding_enabled_at();

-- Test the trigger
-- This will show if the trigger was created successfully
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name LIKE '%bidding_enabled_at%';
