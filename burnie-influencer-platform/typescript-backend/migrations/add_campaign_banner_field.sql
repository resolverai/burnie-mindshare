-- Add campaignBanner field to campaigns table
-- This field will store S3 URLs for campaign banner images

ALTER TABLE campaigns 
ADD COLUMN campaignBanner TEXT;

-- Add a comment to document the field
COMMENT ON COLUMN campaigns.campaignBanner IS 'S3 URL for campaign banner image used in carousel display';
