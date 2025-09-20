import express, { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { Campaign } from '../models/Campaign';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import AWS from 'aws-sdk';

const router = express.Router();

// Configure AWS S3 (same as campaigns route)
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: process.env.AWS_REGION || 'us-east-1'
});

interface CarouselSlide {
  id: string;
  backgroundUrl: string;
  title: string;
  endText: string;
  tag?: string;
  gallery: string[];
}

// Helper function to generate presigned URL using the TypeScript backend (same as admin dashboard)
async function generatePresignedUrlLocal(s3Key: string): Promise<string | null> {
  try {
    logger.info(`🔗 Requesting presigned URL for S3 key using local backend: ${s3Key}`);
    logger.info(`🔗 Using bucket: ${process.env.S3_BUCKET_NAME || 'burnie-storage'}`);
    logger.info(`🔗 AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
    
    // Generate presigned URL directly (same as campaigns route)
    const presignedUrl = s3.getSignedUrl('getObject', {
      Bucket: process.env.S3_BUCKET_NAME || 'burnie-storage',
      Key: s3Key,
      Expires: 3600 // URL expires in 1 hour
    });

    logger.info(`✅ Generated presigned URL locally for S3 key: ${s3Key}`);
    logger.info(`✅ Presigned URL: ${presignedUrl.substring(0, 150)}...`);
    return presignedUrl;
  } catch (error) {
    logger.error(`❌ Error generating presigned URL locally for S3 key: ${s3Key}`, error);
    return null;
  }
}

// Helper function to generate presigned URL (fallback to Python backend for content images)
async function generatePresignedUrl(s3Key: string): Promise<string | null> {
  // For campaign banners, use local generation (same as admin dashboard)
  if (s3Key.startsWith('campaign_banners/') || s3Key.startsWith('brand_logos/')) {
    return generatePresignedUrlLocal(s3Key);
  }
  
  // For AI-generated content images, use Python backend
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
  if (!pythonBackendUrl) {
    logger.error('PYTHON_AI_BACKEND_URL environment variable is not set, falling back to local generation');
    return generatePresignedUrlLocal(s3Key);
  }

  try {
    logger.info(`🔗 Requesting presigned URL for S3 key: ${s3Key}`);
    
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Python backend responded with ${response.status}`);
    }

    const result = await response.json() as {
      status: string;
      presigned_url?: string;
      error?: string;
    };

    if (result.status === 'success' && result.presigned_url) {
      logger.info(`✅ Generated presigned URL for S3 key: ${s3Key}`);
      return result.presigned_url;
    } else {
      logger.error(`Failed to generate presigned URL: ${result.error}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error generating presigned URL for S3 key: ${s3Key}`, error);
    // Fallback to local generation
    return generatePresignedUrlLocal(s3Key);
  }
}

/**
 * GET /api/carousel - Get carousel data for hero banner
 * Returns active campaigns with their content images
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    const contentRepository: Repository<ContentMarketplace> = AppDataSource.getRepository(ContentMarketplace);

    // Step 1: Get all active campaigns with future end dates, sorted in descending order by ID
    const currentDate = new Date();
    const allActiveCampaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.isActive = :isActive', { isActive: true })
      .andWhere('campaign.endDate > :currentDate', { currentDate })
      .orderBy('campaign.id', 'DESC') // Descending order by ID (newest first)
      .getMany();

    // Step 2: Filter campaigns that have at least one content which is approved, biddable and available
    const campaignsWithValidContent: Campaign[] = [];
    
    for (const campaign of allActiveCampaigns) {
      const validContentCount = await contentRepository
        .createQueryBuilder('content')
        .where('content.campaignId = :campaignId', { campaignId: campaign.id })
        .andWhere('content.approvalStatus = :approvalStatus', { approvalStatus: 'approved' })
        .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
        .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
        .getCount();
      
      if (validContentCount > 0) {
        campaignsWithValidContent.push(campaign);
      }
    }

    // Step 3: Take first 3 campaigns for carousel
    const campaigns = campaignsWithValidContent.slice(0, 3);

    logger.info(`🎠 Found ${campaigns.length} active campaigns for carousel`);
    campaigns.forEach(campaign => {
      logger.info(`📅 Campaign: ${campaign.title} (ID: ${campaign.id}) - Active: ${campaign.isActive}, End: ${campaign.endDate}, RewardPool: ${campaign.rewardPool}`);
      logger.info(`🎨 Campaign banner: ${campaign.campaignBanner || 'No banner set'}`);
    });

    if (!campaigns || campaigns.length === 0) {
      res.json([]);
      return;
    }

    const slides: CarouselSlide[] = [];

            for (const campaign of campaigns) {
          try {
            // Apply 15-day shelf life filter for gallery images
            const fifteenDaysAgo = new Date();
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

            // Get latest content pieces for this campaign with post type priority
            // Priority: shitpost > thread > others, sorted by creation date (newest first)
            const latestContent = await contentRepository
              .createQueryBuilder('content')
              .where('content.campaignId = :campaignId', { campaignId: campaign.id })
              .andWhere('content.approvalStatus = :approvalStatus', { approvalStatus: 'approved' })
              .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
              .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
              .andWhere('content.contentImages IS NOT NULL')
              .andWhere('content.biddingEnabledAt >= :fifteenDaysAgo', { fifteenDaysAgo })
              .orderBy(
                'CASE WHEN content.postType = \'shitpost\' THEN 1 WHEN content.postType = \'thread\' THEN 2 ELSE 3 END',
                'ASC'
              )
              .addOrderBy('content.createdAt', 'DESC')
              .limit(2)
              .getMany();

            // Get total content count (approved, biddable and available) for this campaign with 15-day filter
            const totalContentCount = await contentRepository
              .createQueryBuilder('content')
              .where('content.campaignId = :campaignId', { campaignId: campaign.id })
              .andWhere('content.approvalStatus = :approvalStatus', { approvalStatus: 'approved' })
              .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
              .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
              .andWhere('content.biddingEnabledAt >= :fifteenDaysAgo', { fifteenDaysAgo })
              .getCount();

            const gallery: string[] = [];
            
            // Process latest 2 content images 
            for (const content of latestContent) {
              if (content.contentImages && Array.isArray(content.contentImages)) {
                // Get the first image from the content images array
                const firstImage = content.contentImages[0];
                if (firstImage) {
                  try {
                    let s3Key = firstImage;
                    
                    // If it's a presigned URL, extract the S3 key
                    if (firstImage.includes('amazonaws.com')) {
                      // Extract S3 key from presigned URL
                      // URL format: https://bucket.s3.amazonaws.com/key?params
                      const url = new URL(firstImage);
                      s3Key = url.pathname.substring(1); // Remove leading slash
                      logger.info(`📷 Extracted S3 key from presigned URL: ${s3Key}`);
                    }
                    
                    // Generate fresh presigned URL
                    const presignedUrl = await generatePresignedUrl(s3Key);
                    if (presignedUrl) {
                      gallery.push(presignedUrl);
                      logger.info(`📷 Generated fresh presigned URL for content ${content.id}`);
                    }
                  } catch (error) {
                    logger.warn(`Failed to process image URL for content ${content.id}:`, error);
                  }
                }
              }
            }

            // Add total content count as third item
            gallery.push(`${totalContentCount}`);

            // Use campaign banner as background, fallback to first content image or default
            let backgroundUrl = '/hero.svg';
            logger.info(`🎨 Processing background for campaign ${campaign.id}: ${campaign.title}`);
            logger.info(`🎨 Campaign banner URL: ${campaign.campaignBanner || 'None'}`);
            
            if (campaign.campaignBanner) {
              try {
                // Extract S3 key from banner URL if it's a full S3 URL
                let s3Key = campaign.campaignBanner;
                logger.info(`🎨 Original banner URL: ${campaign.campaignBanner}`);
                
                if (campaign.campaignBanner.includes('amazonaws.com')) {
                  const url = new URL(campaign.campaignBanner);
                  s3Key = decodeURIComponent(url.pathname.substring(1)); // Remove leading slash and decode
                  logger.info(`🎨 Extracted and decoded S3 key from campaign banner URL: ${s3Key}`);
                } else {
                  // Decode the S3 key if it's already encoded
                  s3Key = decodeURIComponent(s3Key);
                  logger.info(`🎨 Banner URL is not amazonaws.com format, decoded key: ${s3Key}`);
                }
                
                logger.info(`🎨 Attempting to generate presigned URL for S3 key: ${s3Key}`);
                const bannerPresignedUrl = await generatePresignedUrl(s3Key);
                
                if (bannerPresignedUrl) {
                  backgroundUrl = bannerPresignedUrl;
                  logger.info(`🎨 ✅ Successfully generated presigned URL for campaign banner ${campaign.id}`);
                  logger.info(`🎨 Final background URL: ${backgroundUrl.substring(0, 100)}...`);
                } else {
                  logger.warn(`🎨 ❌ Failed to generate presigned URL for campaign banner ${campaign.id}`);
                }
              } catch (error) {
                logger.error(`🎨 ❌ Error processing campaign banner ${campaign.id}:`, error);
                // Fallback to first content image if banner fails
                if (gallery.length > 0 && gallery[0] && !gallery[0].match(/^\d+$/)) {
                  backgroundUrl = gallery[0];
                  logger.info(`🎨 Using content image as fallback: ${backgroundUrl.substring(0, 50)}...`);
                }
              }
            } else {
              logger.info(`🎨 No campaign banner set, checking for content image fallback`);
              if (gallery.length > 0 && gallery[0] && !gallery[0].match(/^\d+$/)) {
                // Use first content image if no banner
                backgroundUrl = gallery[0];
                logger.info(`🎨 Using first content image: ${backgroundUrl.substring(0, 50)}...`);
              } else {
                logger.info(`🎨 No content images available, using default hero.svg`);
              }
            }

            // Format end date
            const endDate = campaign.endDate ? new Date(campaign.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const endText = `End date ${endDate.toLocaleDateString('en-US', { 
              day: '2-digit', 
              month: 'short', 
              year: 'numeric' 
            })}`;

            const slideData = {
              id: campaign.id.toString(),
              backgroundUrl: backgroundUrl,
              title: campaign.title || 'Campaign',
              endText,
              tag: campaign.platformSource || 'Cookie.fun',
              gallery: gallery.slice(0, 3) // Ensure max 3 items (2 images + 1 count)
            };
            
            slides.push(slideData);
            logger.info(`🎠 ✅ Created slide for campaign ${campaign.id}:`, {
              id: slideData.id,
              title: slideData.title,
              backgroundUrl: slideData.backgroundUrl.substring(0, 100) + (slideData.backgroundUrl.length > 100 ? '...' : ''),
              tag: slideData.tag,
              galleryCount: slideData.gallery.length
            });

          } catch (error) {
            logger.error(`Error processing campaign ${campaign.id} for carousel:`, error);
            continue;
          }
        }

    // If no slides with content, create a default slide
    if (slides.length === 0) {
      slides.push({
        id: 'default',
        backgroundUrl: '/hero.svg',
        title: 'Content Marketplace',
        endText: 'Active campaigns available',
        tag: 'Cookie.fun',
        gallery: []
      });
    }

    res.json(slides);

  } catch (error) {
    logger.error('Error fetching carousel data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch carousel data',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

export default router;
