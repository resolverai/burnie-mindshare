import { Router, Request, Response } from 'express';
import { IsNull } from 'typeorm';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybUpgradeRequest } from '../models/DvybUpgradeRequest';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { DvybAuthService } from '../services/DvybAuthService';

const router = Router();

/**
 * GET /api/dvyb/account
 * Get authenticated account details
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: account,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get DVYB account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve account',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PUT /api/dvyb/account
 * Update account details
 */
router.put('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { accountName, accountType, website, email, industry, logoS3Key } = req.body;

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Update fields
    if (accountName) account.accountName = accountName;
    if (accountType) account.accountType = accountType;
    if (website !== undefined) account.website = website;
    if (email !== undefined) account.primaryEmail = email;
    if (industry !== undefined) account.industry = industry;
    if (logoS3Key !== undefined) account.logoS3Key = logoS3Key;

    await accountRepo.save(account);

    logger.info(`✅ Updated DVYB account ${accountId}`);

    return res.json({
      success: true,
      data: account,
      message: 'Account updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Update DVYB account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update account',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/twitter-connection
 * Get Twitter connection status
 */
router.get('/twitter-connection', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    // Use the service method which handles auto-refresh
    const status = await DvybAuthService.getTwitterConnectionStatus(accountId);

    if (status === 'not_connected') {
      return res.json({
        success: true,
        data: {
          connected: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Get connection details
    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { accountId, isActive: true },
    });

    return res.json({
      success: true,
      data: {
        connected: status === 'connected',
        twitterHandle: connection?.twitterHandle,
        name: connection?.name,
        profileImageUrl: connection?.profileImageUrl,
        isExpired: status === 'expired',
        expiresAt: connection?.oauth2ExpiresAt,
        scopes: connection?.scopes,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get Twitter connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Twitter connection',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/instagram-connection
 * Get Instagram connection details
 */
router.get('/instagram-connection', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      return res.json({
        success: true,
        data: null,
        message: 'No Instagram connection found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        username: connection.username,
        instagramUserId: connection.instagramUserId,
        profileData: connection.profileData,
        status: connection.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get Instagram connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Instagram connection',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/linkedin-connection
 * Get LinkedIn connection details
 */
router.get('/linkedin-connection', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      return res.json({
        success: true,
        data: null,
        message: 'No LinkedIn connection found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        name: connection.name,
        email: connection.email,
        linkedInUserId: connection.linkedInUserId,
        profileData: connection.profileData,
        status: connection.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get LinkedIn connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve LinkedIn connection',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/tiktok-connection
 * Get TikTok connection details
 */
router.get('/tiktok-connection', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      return res.json({
        success: true,
        data: null,
        message: 'No TikTok connection found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        displayName: connection.displayName,
        openId: connection.openId,
        unionId: connection.unionId,
        profileData: connection.profileData,
        status: connection.status,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get TikTok connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve TikTok connection',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/usage
 * Get current account's usage and check against limits
 */
router.get('/usage', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    // First check if account is active
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Get current plan
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    const currentPlan = await accountPlanRepo.findOne({
      where: { 
        accountId, 
        status: 'active',
        endDate: IsNull(),
      },
      relations: ['plan'],
      order: { startDate: 'DESC' },
    });

    // Calculate limits and plan details
    let imageLimit = 0;
    let videoLimit = 0;
    let planName = 'Free Plan';
    let planId: number | null = null;
    let monthlyPrice = 0;
    let annualPrice = 0;
    let billingCycle: 'monthly' | 'annual' = 'monthly';
    let isFreeTrialPlan = false;

    if (currentPlan) {
      imageLimit = currentPlan.selectedFrequency === 'monthly' 
        ? currentPlan.plan.monthlyImageLimit 
        : currentPlan.plan.annualImageLimit;
      
      videoLimit = currentPlan.selectedFrequency === 'monthly'
        ? currentPlan.plan.monthlyVideoLimit
        : currentPlan.plan.annualVideoLimit;
      
      planName = currentPlan.plan.planName;
      planId = currentPlan.plan.id;
      monthlyPrice = Number(currentPlan.plan.monthlyPrice);
      annualPrice = Number(currentPlan.plan.annualPrice);
      billingCycle = currentPlan.selectedFrequency as 'monthly' | 'annual';
      isFreeTrialPlan = currentPlan.plan.isFreeTrialPlan;
    } else {
      // No active plan - use Free Trial plan limits (monthly frequency)
      const planRepo = AppDataSource.getRepository(DvybPricingPlan);
      const freeTrialPlan = await planRepo.findOne({
        where: { isFreeTrialPlan: true, isActive: true },
      });

      if (freeTrialPlan) {
        imageLimit = freeTrialPlan.monthlyImageLimit;
        videoLimit = freeTrialPlan.monthlyVideoLimit;
        planName = freeTrialPlan.planName;
        planId = freeTrialPlan.id;
        monthlyPrice = Number(freeTrialPlan.monthlyPrice);
        annualPrice = Number(freeTrialPlan.annualPrice);
        isFreeTrialPlan = true;
        logger.info(`✅ Using Free Trial plan limits for account ${accountId}: ${imageLimit} images, ${videoLimit} videos`);
      } else {
        logger.warn(`⚠️ No Free Trial plan found for account ${accountId} - using 0 limits`);
      }
    }

    // Calculate current usage from dvyb_generated_content (only completed generations)
    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const generatedContent = await contentRepo.find({
      where: { 
        accountId,
        status: 'completed',  // Only count successfully completed generations
      },
    });

    let imageUsage = 0;
    let videoUsage = 0;

    generatedContent.forEach(content => {
      // Count images from generatedImageUrls array (filter out null/undefined)
      if (content.generatedImageUrls && Array.isArray(content.generatedImageUrls)) {
        imageUsage += content.generatedImageUrls.filter(url => url !== null && url !== undefined).length;
      }
      
      // Count videos from generatedVideoUrls array (filter out null/undefined)
      if (content.generatedVideoUrls && Array.isArray(content.generatedVideoUrls)) {
        videoUsage += content.generatedVideoUrls.filter(url => url !== null && url !== undefined).length;
      }
    });
    
    logger.info(`📊 Usage for account ${accountId}: ${imageUsage} images, ${videoUsage} videos (from ${generatedContent.length} completed generations)`);

    const limitExceeded = imageUsage >= imageLimit || videoUsage >= videoLimit;
    const remainingImages = Math.max(0, imageLimit - imageUsage);
    const remainingVideos = Math.max(0, videoLimit - videoUsage);

    // Check if user has already submitted an upgrade request
    const upgradeRequestRepo = AppDataSource.getRepository(DvybUpgradeRequest);
    const existingRequest = await upgradeRequestRepo.findOne({
      where: { accountId, status: 'pending' },
      order: { requestedAt: 'DESC' },
    });

    return res.json({
      success: true,
      data: {
        isAccountActive: account.isActive,
        planName,
        planId,
        monthlyPrice,
        annualPrice,
        billingCycle,
        isFreeTrialPlan,
        imageLimit,
        videoLimit,
        imageUsage,
        videoUsage,
        limitExceeded,
        remainingImages,
        remainingVideos,
        hasUpgradeRequest: !!existingRequest,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get account usage error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve account usage',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/plan
 * Get current account's pricing plan details
 */
router.get('/plan', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    const currentPlan = await accountPlanRepo.findOne({
      where: { 
        accountId, 
        status: 'active',
        endDate: IsNull(),
      },
      relations: ['plan'],
      order: { startDate: 'DESC' },
    });

    if (!currentPlan) {
      // No plan found - return default "Free Plan"
      return res.json({
        success: true,
        data: {
          planId: null,
          planName: 'Free Plan',
          description: 'Default free plan',
          selectedFrequency: 'monthly',
          imagePostsLimit: 0,
          videoPostsLimit: 0,
          planPrice: 0,
          isFreeTrialPlan: false,
          startDate: null,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Calculate applicable limits based on selected frequency
    const imagePostsLimit = currentPlan.selectedFrequency === 'monthly' 
      ? currentPlan.plan.monthlyImageLimit 
      : currentPlan.plan.annualImageLimit;
    
    const videoPostsLimit = currentPlan.selectedFrequency === 'monthly'
      ? currentPlan.plan.monthlyVideoLimit
      : currentPlan.plan.annualVideoLimit;
    
    const planPrice = currentPlan.selectedFrequency === 'monthly'
      ? currentPlan.plan.monthlyPrice
      : currentPlan.plan.annualPrice;

    return res.json({
      success: true,
      data: {
        planId: currentPlan.plan.id,
        planName: currentPlan.plan.planName,
        description: currentPlan.plan.description,
        selectedFrequency: currentPlan.selectedFrequency,
        imagePostsLimit,
        videoPostsLimit,
        planPrice,
        isFreeTrialPlan: currentPlan.plan.isFreeTrialPlan,
        startDate: currentPlan.startDate,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get account plan error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve account plan',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/account/pricing-plans
 * Get all active pricing plans (public endpoint - no auth required)
 */
router.get('/pricing-plans', async (_req: Request, res: Response) => {
  try {
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    
    const plans = await planRepo.find({
      where: { isActive: true },
      order: { monthlyPrice: 'ASC' },
    });

    return res.json({
      success: true,
      data: plans.map(plan => ({
        id: plan.id,
        planName: plan.planName,
        description: plan.description,
        monthlyPrice: Number(plan.monthlyPrice),
        annualPrice: Number(plan.annualPrice),
        monthlyImageLimit: plan.monthlyImageLimit,
        monthlyVideoLimit: plan.monthlyVideoLimit,
        annualImageLimit: plan.annualImageLimit,
        annualVideoLimit: plan.annualVideoLimit,
        extraImagePostPrice: Number(plan.extraImagePostPrice),
        extraVideoPostPrice: Number(plan.extraVideoPostPrice),
        isFreeTrialPlan: plan.isFreeTrialPlan,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching pricing plans:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve pricing plans',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

