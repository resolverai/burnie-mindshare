import express, { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { Campaign } from '../models/Campaign';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';

const router = express.Router();

interface CarouselSlide {
  id: string;
  backgroundUrl: string;
  title: string;
  endText: string;
  tag?: string;
  gallery: string[];
}

// Helper function to generate presigned URL
async function generatePresignedUrl(s3Key: string): Promise<string | null> {
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
  if (!pythonBackendUrl) {
    logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
    return null;
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
    return null;
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

    // Get active campaigns sorted by end date ascending (urgency) - limited to 3
    // Let's be less restrictive to debug the issue
    const campaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.isActive = :isActive', { isActive: true })
      .orderBy('campaign.endDate', 'ASC') // Ascending for urgency (ending soonest first)
      .limit(3) // Limit to max 3 campaigns for carousel
      .getMany();

    logger.info(`🎠 Found ${campaigns.length} active campaigns for carousel`);
    campaigns.forEach(campaign => {
      logger.info(`📅 Campaign: ${campaign.title} (ID: ${campaign.id}) - Active: ${campaign.isActive}, End: ${campaign.endDate}, RewardPool: ${campaign.rewardPool}`);
    });

    if (!campaigns || campaigns.length === 0) {
      res.json([]);
      return;
    }

    const slides: CarouselSlide[] = [];

            for (const campaign of campaigns) {
          try {
            // Get top 2 quality content pieces for this campaign  
            const topQualityContent = await contentRepository
              .createQueryBuilder('content')
              .where('content.campaignId = :campaignId', { campaignId: campaign.id })
              .andWhere('content.contentImages IS NOT NULL')
              .andWhere('content.qualityScore IS NOT NULL')
              .orderBy('content.qualityScore', 'DESC')
              .limit(2)
              .getMany();

            // Get total content count (approved and biddable) for this campaign
            const totalContentCount = await contentRepository
              .createQueryBuilder('content')
              .where('content.campaignId = :campaignId', { campaignId: campaign.id })
              .andWhere('content.approvalStatus = :approvalStatus', { approvalStatus: 'approved' })
              .getCount();

            const gallery: string[] = [];
            
            // Process top 2 quality content images 
            for (const content of topQualityContent) {
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
            if (campaign.campaignBanner) {
              try {
                const bannerPresignedUrl = await generatePresignedUrl(campaign.campaignBanner);
                if (bannerPresignedUrl) {
                  backgroundUrl = bannerPresignedUrl;
                }
              } catch (error) {
                logger.warn(`Failed to generate presigned URL for campaign banner ${campaign.id}:`, error);
                // Fallback to first content image if banner fails
                if (gallery.length > 0 && gallery[0] && !gallery[0].match(/^\d+$/)) {
                  backgroundUrl = gallery[0];
                }
              }
            } else if (gallery.length > 0 && gallery[0] && !gallery[0].match(/^\d+$/)) {
              // Use first content image if no banner
              backgroundUrl = gallery[0];
            }

            // Format end date
            const endDate = campaign.endDate ? new Date(campaign.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const endText = `End date ${endDate.toLocaleDateString('en-US', { 
              day: '2-digit', 
              month: 'short', 
              year: 'numeric' 
            })}`;

            slides.push({
              id: campaign.id.toString(),
              backgroundUrl: backgroundUrl,
              title: campaign.title || 'Campaign',
              endText,
              tag: campaign.platformSource || 'Cookie.fun',
              gallery: gallery.slice(0, 3) // Ensure max 3 items (2 images + 1 count)
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
