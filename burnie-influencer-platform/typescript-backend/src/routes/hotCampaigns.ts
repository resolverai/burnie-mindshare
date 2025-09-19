import { Router } from 'express';
import { ILike } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ContentPurchase } from '../models/ContentPurchase';
import { ApprovedMiner } from '../models/ApprovedMiner';
import { logger } from '../config/logger';

const router = Router();

interface HotCampaignPostType {
  campaignId: string;
  campaignName: string;
  projectName: string;
  postType: string;
  availableCount: number;
  purchaseCount: number;
  ratio: number;
  totalCampaignPurchases: number;
  tokenTicker?: string; // Add token ticker field
}

// GET /api/hot-campaigns - Get top 10 campaigns by purchase volume, then identify hot post_types
router.get('/hot-campaigns', async (req, res) => {
  try {
    logger.info('🔥 Fetching hot campaigns with enhanced logic...');

    // Check if wallet address is provided (for dedicated miners)
    const walletAddress = req.query.walletAddress as string;
    
    if (walletAddress) {
      // Check if miner is approved for automated mining
      const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);
      const normalizedWalletAddress = walletAddress.toLowerCase().trim();
      
      const approvedMiner = await approvedMinerRepository.findOne({
        where: { walletAddress: ILike(normalizedWalletAddress) }
      });

      if (!approvedMiner) {
        logger.warn(`❌ Unapproved miner attempted to fetch hot campaigns: ${normalizedWalletAddress}`);
        return res.status(403).json({
          success: false,
          message: 'You are not approved for automated mining. Contact an admin to request approval for automated content generation.',
          error: 'MINER_NOT_APPROVED',
          requiresApproval: true
        });
      }
      
      logger.info(`✅ Approved miner fetching hot campaigns: ${normalizedWalletAddress}`);
    }

    const campaignRepository = AppDataSource.getRepository(Campaign);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Step 1: Get campaigns with end_date >= current_date
    const activeCampaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.endDate >= :currentDate', { currentDate: new Date() })
      .andWhere('campaign.isActive = :isActive', { isActive: true })
      .select(['campaign.id', 'campaign.title', 'campaign.projectName', 'campaign.endDate'])
      .getMany();

    if (activeCampaigns.length === 0) {
      logger.info('📋 No active campaigns with valid end dates found');
      return res.json({ 
        success: true, 
        data: [], 
        message: 'No active campaigns with valid end dates found' 
      });
    }

    logger.info(`📋 Found ${activeCampaigns.length} active campaigns with valid end dates`);

    // Step 2: Get top 10 campaigns by total purchase count
    const campaignPurchaseCounts = await Promise.all(
      activeCampaigns.map(async (campaign) => {
        const totalPurchases = await purchaseRepository
          .createQueryBuilder('purchase')
          .innerJoin('purchase.content', 'content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .getCount();

        return {
          campaign,
          totalPurchases
        };
      })
    );

    // Sort by purchase count (descending) and take top 10
    const top10Campaigns = campaignPurchaseCounts
      .filter(item => item.totalPurchases > 0) // Only campaigns with purchases
      .sort((a, b) => b.totalPurchases - a.totalPurchases)
      .slice(0, 10);

    logger.info(`🔥 Top 10 campaigns by purchase volume: ${top10Campaigns.map(c => `${c.campaign.title} (${c.totalPurchases} purchases)`).join(', ')}`);

    if (top10Campaigns.length === 0) {
      logger.info('📋 No campaigns with purchases found');
      return res.json({ 
        success: true, 
        data: [], 
        message: 'No campaigns with purchases found' 
      });
    }

    // Step 3: For each top 10 campaign, check post_types for hot criteria
    const hotCampaigns: HotCampaignPostType[] = [];
    const postTypes = ['thread', 'shitpost', 'longpost'];

    for (const { campaign, totalPurchases } of top10Campaigns) {
      for (const postType of postTypes) {
        // Use Content Meter logic: Available = isAvailable=true, isBiddable=true, approvalStatus='approved'
        const availableCount = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
          .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
          .andWhere('content.approvalStatus = :status', { status: 'approved' })
          .getCount();

        // Use Content Meter logic: Purchased = real purchases from content_purchases table
        const purchaseCount = await purchaseRepository
          .createQueryBuilder('purchase')
          .innerJoin('purchase.content', 'content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .getCount();

        // Check if this post_type is "hot" using the criteria
        let isHot = false;
        let ratio = 0;

        if (availableCount === 0 && purchaseCount > 0) {
          // Available is 0 but purchases > 0
          isHot = true;
          ratio = Infinity;
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
            projectName: campaign.projectName || campaign.title,
            postType,
            availableCount,
            purchaseCount,
            ratio: ratio === Infinity ? 999999 : ratio,
            totalCampaignPurchases: totalPurchases,
            tokenTicker: campaign.tokenTicker || '' // Include token ticker from database
          });

          logger.info(`🔥 Hot post_type found: ${campaign.title} (${postType}) - Ratio: ${ratio.toFixed(2)}, Available: ${availableCount}, Purchased: ${purchaseCount}`);
        }
      }
    }

    logger.info(`🔥 Found ${hotCampaigns.length} hot campaign post_types from top 10 campaigns`);

    return res.json({
      success: true,
      data: hotCampaigns,
      message: `Found ${hotCampaigns.length} hot campaign post_types from top 10 campaigns by purchase volume`
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
