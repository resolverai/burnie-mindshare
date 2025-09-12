import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { logger } from '../config/logger';

const router = Router();

interface HotCampaignPostType {
  campaignId: string;
  campaignName: string;
  postType: string;
  availableCount: number;
  purchaseCount: number;
  ratio: number;
}

// GET /api/hot-campaigns - Get campaigns that are "hot" (purchase/available > 1 or available=0 with purchases)
router.get('/hot-campaigns', async (req, res) => {
  try {
    logger.info('🔥 Fetching hot campaigns...');

    // Get all campaigns
    const campaignRepository = AppDataSource.getRepository(Campaign);
    const campaigns = await campaignRepository.find({
      where: { isActive: true },
      relations: ['project']
    });

    if (campaigns.length === 0) {
      logger.info('📋 No active campaigns found');
      return res.json({ 
        success: true, 
        data: [], 
        message: 'No active campaigns found' 
      });
    }

    const hotCampaigns: HotCampaignPostType[] = [];

    // For each campaign, check all post types
    for (const campaign of campaigns) {
      // Define the post types to check
      const postTypes = ['thread', 'shitpost', 'longpost'];
      
      for (const postType of postTypes) {
        // Get content counts for this campaign and post_type
        const contentRepository = AppDataSource.getRepository(ContentMarketplace);
        
        const availableCount = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .andWhere('content.approvalStatus = :status', { status: 'approved' })
          .andWhere('content.isBiddable = :biddingEnabled', { biddingEnabled: false })
          .getCount();

        const purchaseCount = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .andWhere('content.approvalStatus = :status', { status: 'approved' })
          .andWhere('content.isBiddable = :biddingEnabled', { biddingEnabled: true })
          .getCount();

        // Check if this post_type is "hot"
        let isHot = false;
        let ratio = 0;

        if (availableCount === 0 && purchaseCount > 0) {
          // Available is 0 but purchases > 0
          isHot = true;
          ratio = Infinity; // or a very high number
        } else if (availableCount > 0) {
          ratio = purchaseCount / availableCount;
          if (ratio > 1) {
            isHot = true;
          }
        }

        if (isHot) {
          hotCampaigns.push({
            campaignId: campaign.id.toString(),
            campaignName: campaign.title,
            postType,
            availableCount,
            purchaseCount,
            ratio: ratio === Infinity ? 999999 : ratio
          });

          logger.info(`🔥 Hot campaign found: ${campaign.title} (${postType}) - Ratio: ${ratio.toFixed(2)}, Available: ${availableCount}, Purchased: ${purchaseCount}`);
        }
      }
    }

    logger.info(`🔥 Found ${hotCampaigns.length} hot campaign post_types`);

    return res.json({
      success: true,
      data: hotCampaigns,
      message: `Found ${hotCampaigns.length} hot campaign post_types`
    });

  } catch (error) {
    logger.error('❌ Error fetching hot campaigns:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch hot campaigns',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
