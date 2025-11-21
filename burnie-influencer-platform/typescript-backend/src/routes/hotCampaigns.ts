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
  ratio: number | undefined; // undefined for new campaigns with no content
  totalCampaignPurchases: number;
  tokenTicker?: string; // Add token ticker field
  isSomniaWhitelisted?: boolean; // Add somnia whitelisted flag for priority sorting
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
    // Join with projects table to get somnia_whitelisted status
    const activeCampaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.project', 'project')
      .where('campaign.endDate >= :currentDate', { currentDate: new Date() })
      .andWhere('campaign.isActive = :isActive', { isActive: true })
      .select(['campaign.id', 'campaign.title', 'campaign.projectName', 'campaign.endDate', 'campaign.projectId', 'project.id', 'project.somniaWhitelisted'])
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

    // Step 2: Get campaign data with purchase counts and content counts
    const campaignData = await Promise.all(
      activeCampaigns.map(async (campaign) => {
        const totalPurchases = await purchaseRepository
          .createQueryBuilder('purchase')
          .innerJoin('purchase.content', 'content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .getCount();

        // Check if campaign has ANY content in content_marketplace
        const totalContentCount = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .getCount();

        // Check total available posts across all post types
        const totalAvailablePosts = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
          .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
          .andWhere('content.approvalStatus = :status', { status: 'approved' })
          .getCount();

        // Get somnia_whitelisted status from project relation
        const isSomniaWhitelisted = campaign.project?.somniaWhitelisted || false;

        return {
          campaign,
          totalPurchases,
          totalContentCount,
          totalAvailablePosts,
          isSomniaWhitelisted
        };
      })
    );

    // Step 3: Identify hot campaigns based on multiple criteria
    // PRIORITY 1: All Somnia whitelisted campaigns (regardless of other metrics)
    // PRIORITY 2: Top 10 by purchase volume (existing logic)
    // PRIORITY 3: Campaigns with NO content at all (newly created)
    // PRIORITY 4: Campaigns with purchases > 0 but total available posts = 0
    
    // PRIORITY 1: Somnia whitelisted campaigns (ALWAYS HOT)
    const somniaWhitelistedCampaigns = campaignData
      .filter(item => item.isSomniaWhitelisted);
    
    // PRIORITY 2: Top 10 by purchase volume (existing logic)
    const top10ByPurchases = campaignData
      .filter(item => item.totalPurchases > 0)
      .sort((a, b) => b.totalPurchases - a.totalPurchases)
      .slice(0, 10);

    // PRIORITY 3: Campaigns with no content at all (newly created)
    const campaignsWithNoContent = campaignData
      .filter(item => item.totalContentCount === 0);

    // PRIORITY 4: Campaigns with purchases > 0 but total available posts = 0
    const campaignsWithPurchasesButNoAvailable = campaignData
      .filter(item => item.totalPurchases > 0 && item.totalAvailablePosts === 0);

    // Combine all hot campaigns (unique by campaign ID)
    // IMPORTANT: Somnia whitelisted campaigns are added FIRST for priority
    const hotCampaignSet = new Set<number>();
    [
      ...somniaWhitelistedCampaigns,  // ← PRIORITY 1: Always first!
      ...top10ByPurchases, 
      ...campaignsWithNoContent, 
      ...campaignsWithPurchasesButNoAvailable
    ].forEach(item => {
      hotCampaignSet.add(item.campaign.id);
    });

    const hotCampaignsList = campaignData.filter(item => hotCampaignSet.has(item.campaign.id));

    logger.info(`🔥 Found ${hotCampaignsList.length} hot campaigns:`);
    logger.info(`   - ${somniaWhitelistedCampaigns.length} Somnia whitelisted (PRIORITY)`);
    logger.info(`   - ${top10ByPurchases.length} top by purchases`);
    logger.info(`   - ${campaignsWithNoContent.length} newly created (no content)`);
    logger.info(`   - ${campaignsWithPurchasesButNoAvailable.length} sold out (purchases but no available)`);

    if (hotCampaignsList.length === 0) {
      logger.info('📋 No hot campaigns found');
      return res.json({ 
        success: true, 
        data: [], 
        message: 'No hot campaigns found' 
      });
    }

    // Step 4: For each hot campaign, check post_types for hot criteria
    const hotCampaigns: HotCampaignPostType[] = [];
    const postTypes = ['thread', 'shitpost', 'longpost'];

    for (const { campaign, totalPurchases, totalContentCount, totalAvailablePosts, isSomniaWhitelisted } of hotCampaignsList) {
      // Determine if this campaign should have all post types as hot
      const isNewlyCreated = totalContentCount === 0;
      const hasPurchasesButNoAvailable = totalPurchases > 0 && totalAvailablePosts === 0;

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
        let ratio: number | undefined = undefined;

        // Case 1: Newly created campaign (no content at all) - all post types are hot
        if (isNewlyCreated) {
          isHot = true;
          ratio = undefined; // Ratio is undefined for new campaigns
        }
        // Case 2: Campaign has purchases > 0 but total available posts = 0 - all post types are hot
        else if (hasPurchasesButNoAvailable) {
          isHot = true;
          ratio = Infinity; // Ratio is Infinity when available = 0 but purchases > 0
        }
        // Case 3: Existing logic - available is 0 but purchases > 0 for this post type
        else if (availableCount === 0 && purchaseCount > 0) {
          isHot = true;
          ratio = Infinity;
        }
        // Case 4: Existing logic - ratio > 1 for this post type
        else if (availableCount > 0) {
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
            ratio: ratio === undefined ? undefined : (ratio === Infinity ? 999999 : ratio),
            totalCampaignPurchases: totalPurchases,
            tokenTicker: campaign.tokenTicker || '', // Include token ticker from database
            isSomniaWhitelisted // Include somnia whitelisted flag for priority sorting
          });

          const ratioStr = ratio === undefined ? 'undefined (new campaign)' : (ratio === Infinity ? 'Infinity' : ratio.toFixed(2));
          const priorityFlag = isSomniaWhitelisted ? ' [SOMNIA PRIORITY]' : '';
          logger.info(`🔥 Hot post_type found: ${campaign.title} (${postType})${priorityFlag} - Ratio: ${ratioStr}, Available: ${availableCount}, Purchased: ${purchaseCount}`);
        }
      }
    }

    logger.info(`🔥 Found ${hotCampaigns.length} hot campaign post_types from ${hotCampaignsList.length} hot campaigns`);

    // Sort hot campaigns: Somnia whitelisted campaigns FIRST, then others
    hotCampaigns.sort((a, b) => {
      // Prioritize Somnia whitelisted campaigns
      if (a.isSomniaWhitelisted && !b.isSomniaWhitelisted) return -1;
      if (!a.isSomniaWhitelisted && b.isSomniaWhitelisted) return 1;
      
      // For campaigns with same priority, sort by ratio (highest first)
      const ratioA = a.ratio === undefined ? 0 : a.ratio;
      const ratioB = b.ratio === undefined ? 0 : b.ratio;
      return ratioB - ratioA;
    });

    logger.info(`✅ Hot campaigns sorted with Somnia whitelisted projects prioritized`);

    return res.json({
      success: true,
      data: hotCampaigns,
      message: `Found ${hotCampaigns.length} hot campaign post_types from ${hotCampaignsList.length} hot campaigns`
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

// GET /api/hot-campaigns/text-regeneration - Get campaigns with 10+ purchases for text regeneration
router.get('/hot-campaigns/text-regeneration', async (req, res) => {
  try {
    logger.info('🔥 Fetching campaigns for text regeneration (10+ purchases)...');

    const campaignRepository = AppDataSource.getRepository(Campaign);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Step 1: Get campaigns with end_date >= current_date
    const activeCampaigns = await campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.endDate >= :currentDate', { currentDate: new Date() })
      .andWhere('campaign.isActive = :isActive', { isActive: true })
      .select(['campaign.id', 'campaign.title', 'campaign.projectName', 'campaign.tokenTicker'])
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

    // Step 2: Get campaigns with 10+ total purchases
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

    // Filter campaigns with 10+ purchases
    const qualifyingCampaigns = campaignPurchaseCounts
      .filter(item => item.totalPurchases >= 10);

    logger.info(`🔥 Found ${qualifyingCampaigns.length} campaigns with 10+ purchases`);

    if (qualifyingCampaigns.length === 0) {
      logger.info('📋 No campaigns with 10+ purchases found');
      return res.json({ 
        success: true, 
        data: [], 
        message: 'No campaigns with 10+ purchases found' 
      });
    }

    // Step 3: For each qualifying campaign, get all available content by post type
    const textRegenerationCampaigns: HotCampaignPostType[] = [];
    const postTypes = ['thread', 'shitpost', 'longpost'];

    for (const { campaign, totalPurchases } of qualifyingCampaigns) {
      for (const postType of postTypes) {
        // Get available content count (same logic as hot campaigns)
        const availableCount = await contentRepository
          .createQueryBuilder('content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
          .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
          .andWhere('content.approvalStatus = :status', { status: 'approved' })
          .getCount();

        // Get purchase count for this post type
        const purchaseCount = await purchaseRepository
          .createQueryBuilder('purchase')
          .innerJoin('purchase.content', 'content')
          .where('content.campaignId = :campaignId', { campaignId: campaign.id })
          .andWhere('content.postType = :postType', { postType })
          .getCount();

        // Include ALL post types that have available content (no ratio filtering)
        if (availableCount > 0) {
          const ratio = purchaseCount / availableCount;
          
          textRegenerationCampaigns.push({
            campaignId: campaign.id.toString(),
            campaignName: campaign.title,
            projectName: campaign.projectName || campaign.title,
            postType,
            availableCount,
            purchaseCount,
            ratio: ratio === Infinity ? 999999 : ratio,
            totalCampaignPurchases: totalPurchases,
            tokenTicker: campaign.tokenTicker || ''
          });

          logger.info(`📝 Text regeneration candidate: ${campaign.title} (${postType}) - Available: ${availableCount}, Purchased: ${purchaseCount}, Ratio: ${ratio.toFixed(2)}`);
        }
      }
    }

    logger.info(`📝 Found ${textRegenerationCampaigns.length} campaign post_types for text regeneration`);

    return res.json({
      success: true,
      data: textRegenerationCampaigns,
      message: `Found ${textRegenerationCampaigns.length} campaign post_types for text regeneration from ${qualifyingCampaigns.length} campaigns with 10+ purchases`
    });

  } catch (error) {
    logger.error('❌ Error fetching text regeneration campaigns:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch text regeneration campaigns',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
