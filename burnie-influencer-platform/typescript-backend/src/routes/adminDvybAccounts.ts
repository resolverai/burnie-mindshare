import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybContext } from '../models/DvybContext';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybGoogleConnection } from '../models/DvybGoogleConnection';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybSchedule } from '../models/DvybSchedule';
import { DvybCaption } from '../models/DvybCaption';
import { DvybUpgradeRequest } from '../models/DvybUpgradeRequest';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import { UrlCacheService } from '../services/UrlCacheService';
import { IsNull } from 'typeorm';

const router = Router();
const s3Service = new S3PresignedUrlService();

/**
 * GET /api/admin/dvyb-accounts
 * Get all DVYB accounts with pagination and search
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const statusFilter = req.query.status as string; // 'active', 'inactive', or 'all'

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const contextRepo = AppDataSource.getRepository(DvybContext);

    // Build query
    let query = accountRepo.createQueryBuilder('account');

    // Search filter
    if (search) {
      query = query.where(
        'LOWER(account.accountName) LIKE LOWER(:search) OR LOWER(account.primaryEmail) LIKE LOWER(:search)',
        { search: `%${search}%` }
      );
    }

    // Status filter
    if (statusFilter === 'active') {
      query = query.andWhere('account.isActive = :isActive', { isActive: true });
    } else if (statusFilter === 'inactive') {
      query = query.andWhere('account.isActive = :isActive', { isActive: false });
    }

    // Get total count for current filter
    const total = await query.getCount();

    // Get total counts for stats (without search/status filters)
    const totalActiveAccounts = await accountRepo.count({ where: { isActive: true } });
    const totalInactiveAccounts = await accountRepo.count({ where: { isActive: false } });
    const totalAllAccounts = totalActiveAccounts + totalInactiveAccounts;

    // Apply pagination
    const skip = (page - 1) * limit;
    const accounts = await query
      .orderBy('account.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    // Fetch context data and current plan for each account
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    
    const accountsWithContext = await Promise.all(
      accounts.map(async (account) => {
        const context = await contextRepo.findOne({
          where: { accountId: account.id },
        });

        // Get current active plan
        const currentPlan = await accountPlanRepo.findOne({
          where: {
            accountId: account.id,
            status: 'active',
            endDate: IsNull(),
          },
          relations: ['plan'],
          order: { createdAt: 'DESC' },
        });

        // Calculate usage (images and videos generated)
        const generatedContent = await generatedContentRepo.find({
          where: {
            accountId: account.id,
            status: 'completed',
          },
        });

        let totalImagesGenerated = 0;
        let totalVideosGenerated = 0;

        generatedContent.forEach((content) => {
          // Count only non-null image URLs
          if (content.generatedImageUrls && Array.isArray(content.generatedImageUrls)) {
            totalImagesGenerated += content.generatedImageUrls.filter((url) => url !== null && url !== undefined).length;
          }
          // Count only non-null video URLs
          if (content.generatedVideoUrls && Array.isArray(content.generatedVideoUrls)) {
            totalVideosGenerated += content.generatedVideoUrls.filter((url) => url !== null && url !== undefined).length;
          }
        });

        logger.info(`📊 Account ${account.id} usage: ${totalImagesGenerated} images, ${totalVideosGenerated} videos from ${generatedContent.length} completed records`);

        let logoPresignedUrl: string | null = null;

        // Generate presigned URL for logo if it exists
        if (context?.logoUrl) {
          try {
            // Helper function to extract S3 key from URL
            const extractS3Key = (url: string): string => {
              // Handle https://bucket.s3.region.amazonaws.com/key format
              if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
                const keyStart = url.indexOf('.amazonaws.com/') + '.amazonaws.com/'.length;
                const key = url.substring(keyStart).split('?')[0]; // Remove query params if presigned
                return key || url;
              }
              // Already an S3 key
              return url;
            };
            
            // If logoUrl is already just an S3 key (doesn't start with http), use it directly
            // Otherwise, extract the key from the full URL
            let logoS3Key: string | null = null;
            
            if (context.logoUrl.startsWith('http://') || context.logoUrl.startsWith('https://')) {
              logoS3Key = extractS3Key(context.logoUrl);
            } else {
              // Already an S3 key
              logoS3Key = context.logoUrl;
            }

            if (logoS3Key) {
              // Check Redis cache
              const isRedisAvailable = await UrlCacheService.isRedisAvailable();
              let presignedUrl: string | null = null;

              if (isRedisAvailable) {
                presignedUrl = await UrlCacheService.getCachedUrl(logoS3Key);
              }

              // Generate if not cached
              if (!presignedUrl) {
                presignedUrl = await s3Service.generatePresignedUrl(logoS3Key, 3600);

                // Cache in Redis if available
                if (isRedisAvailable && presignedUrl) {
                  await UrlCacheService.cacheUrl(logoS3Key, presignedUrl, 3300);
                }
              }

              logoPresignedUrl = presignedUrl;
            }
          } catch (error) {
            logger.error(`Failed to generate presigned URL for logo: ${error}`);
          }
        }

        return {
          id: account.id,
          accountName: context?.accountName || account.accountName, // ✅ Use context accountName first, fallback to account
          primaryEmail: account.primaryEmail, // Always from dvyb_accounts
          accountType: account.accountType,
          isActive: account.isActive,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          // Context data
          website: context?.website || null,
          logoUrl: context?.logoUrl || null,
          logoPresignedUrl,
          hasContext: !!context,
          // Usage data
          usage: {
            imagesGenerated: totalImagesGenerated,
            videosGenerated: totalVideosGenerated,
          },
          // Current plan data
          currentPlan: currentPlan
            ? {
                planId: currentPlan.plan.id,
                planName: currentPlan.plan.planName,
                selectedFrequency: currentPlan.selectedFrequency,
                imagePostsLimit: currentPlan.selectedFrequency === 'monthly' 
                  ? currentPlan.plan.monthlyImageLimit 
                  : currentPlan.plan.annualImageLimit,
                videoPostsLimit: currentPlan.selectedFrequency === 'monthly'
                  ? currentPlan.plan.monthlyVideoLimit
                  : currentPlan.plan.annualVideoLimit,
                planPrice: currentPlan.selectedFrequency === 'monthly'
                  ? currentPlan.plan.monthlyPrice
                  : currentPlan.plan.annualPrice,
                startDate: currentPlan.startDate,
              }
            : null,
          // Auto-generation data
          autoGeneration: {
            enabled: account.autoGenerationEnabled,
            status: account.autoGenerationStatus,
            lastGenerationDate: account.lastAutoGenerationDate,
            scheduledTime: account.autoGenerationTime,
            lastError: account.lastAutoGenerationError,
            retryCount: account.autoGenerationRetryCount,
          },
        };
      })
    );

    return res.json({
      success: true,
      data: accountsWithContext,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        totalActive: totalActiveAccounts,
        totalInactive: totalInactiveAccounts,
        totalAll: totalAllAccounts,
      },
    });
  } catch (error) {
    logger.error('Error fetching DVYB accounts:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch DVYB accounts',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-accounts/:id/toggle-status
 * Activate or deactivate a DVYB account
 */
router.patch('/:id/toggle-status', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    // Toggle the isActive status
    account.isActive = !account.isActive;
    await accountRepo.save(account);

    logger.info(`✅ Account ${accountId} ${account.isActive ? 'activated' : 'deactivated'}`);

    return res.json({
      success: true,
      data: {
        id: account.id,
        isActive: account.isActive,
      },
      message: `Account ${account.isActive ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    logger.error('Error toggling account status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update account status',
    });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/associate-plan
 * Associate or change a pricing plan for an account
 */
router.post('/:id/associate-plan', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const { planId, selectedFrequency, notes } = req.body;

    if (isNaN(accountId) || !planId || !selectedFrequency) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID, plan ID, or frequency',
      });
    }

    if (selectedFrequency !== 'monthly' && selectedFrequency !== 'annual') {
      return res.status(400).json({
        success: false,
        error: 'Frequency must be either monthly or annual',
      });
    }

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);

    // Verify account exists
    const account = await accountRepo.findOne({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    // Verify plan exists
    const plan = await planRepo.findOne({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Pricing plan not found',
      });
    }

    // Get current active plan (if any)
    const currentPlan = await accountPlanRepo.findOne({
      where: {
        accountId,
        status: 'active',
        endDate: IsNull(),
      },
      relations: ['plan'],
    });

    // Determine change type
    let changeType: 'initial' | 'upgrade' | 'downgrade' | 'renewal' = 'initial';
    
    if (currentPlan) {
      // End the current plan
      currentPlan.endDate = new Date();
      currentPlan.status = 'expired';
      await accountPlanRepo.save(currentPlan);

      // Get current and new prices based on selected frequency
      const currentPrice = currentPlan.selectedFrequency === 'monthly' 
        ? currentPlan.plan.monthlyPrice 
        : currentPlan.plan.annualPrice;
      
      const newPrice = selectedFrequency === 'monthly' 
        ? plan.monthlyPrice 
        : plan.annualPrice;

      // Determine if it's an upgrade or downgrade based on price
      if (newPrice > currentPrice) {
        changeType = 'upgrade';
      } else if (newPrice < currentPrice) {
        changeType = 'downgrade';
      } else {
        changeType = 'renewal';
      }

      logger.info(
        `📊 Plan change for account ${accountId}: ${currentPlan.plan.planName} (${currentPlan.selectedFrequency}) → ${plan.planName} (${selectedFrequency}) - ${changeType}`
      );
    } else {
      logger.info(`📊 Initial plan for account ${accountId}: ${plan.planName} (${selectedFrequency})`);
    }

    // Create new plan association
    const newAccountPlan = accountPlanRepo.create({
      accountId,
      planId,
      selectedFrequency,
      startDate: new Date(),
      endDate: null,
      status: 'active',
      changeType,
      notes: notes || null,
    });

    await accountPlanRepo.save(newAccountPlan);

    // Fetch the complete plan details to return
    const createdPlan = await accountPlanRepo.findOne({
      where: { id: newAccountPlan.id },
      relations: ['plan'],
    });

    logger.info(`✅ Associated plan ${plan.planName} to account ${accountId}`);

    return res.json({
      success: true,
      data: createdPlan,
      message: `Plan ${changeType === 'initial' ? 'associated' : changeType + 'd'} successfully`,
    });
  } catch (error) {
    logger.error('Error associating plan to account:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to associate plan',
    });
  }
});

/**
 * GET /api/admin/dvyb-accounts/:id/plan-history
 * Get plan history for an account
 */
router.get('/:id/plan-history', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);

    const planHistory = await accountPlanRepo.find({
      where: { accountId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    return res.json({
      success: true,
      data: planHistory,
    });
  } catch (error) {
    logger.error('Error fetching plan history:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch plan history',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-accounts/:id/toggle-auto-generation
 * Enable or disable auto-generation for an account
 */
router.patch('/:id/toggle-auto-generation', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    // Toggle the autoGenerationEnabled status
    account.autoGenerationEnabled = !account.autoGenerationEnabled;
    
    // Reset status when toggling
    if (account.autoGenerationEnabled) {
      account.autoGenerationStatus = 'pending';
    } else {
      account.autoGenerationStatus = null;
    }
    
    await accountRepo.save(account);

    logger.info(`✅ Auto-generation for account ${accountId} ${account.autoGenerationEnabled ? 'enabled' : 'disabled'}`);

    return res.json({
      success: true,
      data: {
        id: account.id,
        autoGenerationEnabled: account.autoGenerationEnabled,
        autoGenerationStatus: account.autoGenerationStatus,
      },
      message: `Auto-generation ${account.autoGenerationEnabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    logger.error('Error toggling auto-generation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update auto-generation status',
    });
  }
});

/**
 * POST /api/admin/dvyb-accounts/trigger-auto-generation
 * Manually trigger auto-generation scheduling for testing
 */
router.post('/trigger-auto-generation', async (req: Request, res: Response) => {
  try {
    const { dvybAutoGenerationCronService } = await import('../services/DvybAutoGenerationCronService');
    
    const result = await dvybAutoGenerationCronService.triggerNow();

    logger.info(`🔧 Manual auto-generation trigger: ${result.scheduled} jobs scheduled`);

    return res.json({
      success: true,
      data: result,
      message: `Scheduled ${result.scheduled} auto-generation jobs`,
    });
  } catch (error) {
    logger.error('Error triggering auto-generation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger auto-generation',
    });
  }
});

/**
 * GET /api/admin/dvyb-accounts/auto-generation-status
 * Get auto-generation queue status
 */
router.get('/auto-generation-status', async (req: Request, res: Response) => {
  try {
    const { getAutoGenerationQueueStatus } = await import('../services/DvybAutoGenerationQueueService');
    const { dvybAutoGenerationCronService } = await import('../services/DvybAutoGenerationCronService');
    
    const queueStatus = await getAutoGenerationQueueStatus();
    const cronStatus = dvybAutoGenerationCronService.getStatus();

    return res.json({
      success: true,
      data: {
        cron: cronStatus,
        queue: queueStatus,
      },
    });
  } catch (error) {
    logger.error('Error getting auto-generation status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get auto-generation status',
    });
  }
});

/**
 * DELETE /api/admin/dvyb-accounts/:id
 * Permanently delete a DVYB account and all related data
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const { confirmationText } = req.body;

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    // Verify confirmation text
    if (confirmationText !== 'delete') {
      return res.status(400).json({
        success: false,
        error: 'Invalid confirmation. Please type "delete" to confirm.',
      });
    }

    // Check if account exists
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
      });
    }

    logger.info(`🗑️ Starting deletion of DVYB account ${accountId} (${account.accountName})`);

    // Delete all related records in order (to handle foreign key constraints)
    // Using transactions for data consistency
    await AppDataSource.transaction(async (transactionalEntityManager) => {
      // 1. Delete captions
      const captionResult = await transactionalEntityManager.delete(DvybCaption, { accountId });
      logger.info(`  - Deleted ${captionResult.affected || 0} captions`);

      // 2. Delete schedules
      const scheduleResult = await transactionalEntityManager.delete(DvybSchedule, { accountId });
      logger.info(`  - Deleted ${scheduleResult.affected || 0} schedules`);

      // 3. Delete platform posts
      const twitterPostResult = await transactionalEntityManager.delete(DvybTwitterPost, { accountId });
      logger.info(`  - Deleted ${twitterPostResult.affected || 0} Twitter posts`);

      const instagramPostResult = await transactionalEntityManager.delete(DvybInstagramPost, { accountId });
      logger.info(`  - Deleted ${instagramPostResult.affected || 0} Instagram posts`);

      const linkedinPostResult = await transactionalEntityManager.delete(DvybLinkedInPost, { accountId });
      logger.info(`  - Deleted ${linkedinPostResult.affected || 0} LinkedIn posts`);

      const tiktokPostResult = await transactionalEntityManager.delete(DvybTikTokPost, { accountId });
      logger.info(`  - Deleted ${tiktokPostResult.affected || 0} TikTok posts`);

      // 4. Delete generated content
      const contentResult = await transactionalEntityManager.delete(DvybGeneratedContent, { accountId });
      logger.info(`  - Deleted ${contentResult.affected || 0} generated content records`);

      // 5. Delete platform connections
      const twitterConnResult = await transactionalEntityManager.delete(DvybTwitterConnection, { accountId });
      logger.info(`  - Deleted ${twitterConnResult.affected || 0} Twitter connections`);

      const instagramConnResult = await transactionalEntityManager.delete(DvybInstagramConnection, { accountId });
      logger.info(`  - Deleted ${instagramConnResult.affected || 0} Instagram connections`);

      const linkedinConnResult = await transactionalEntityManager.delete(DvybLinkedInConnection, { accountId });
      logger.info(`  - Deleted ${linkedinConnResult.affected || 0} LinkedIn connections`);

      const tiktokConnResult = await transactionalEntityManager.delete(DvybTikTokConnection, { accountId });
      logger.info(`  - Deleted ${tiktokConnResult.affected || 0} TikTok connections`);

      const googleConnResult = await transactionalEntityManager.delete(DvybGoogleConnection, { accountId });
      logger.info(`  - Deleted ${googleConnResult.affected || 0} Google connections`);

      // 6. Delete account plans
      const planResult = await transactionalEntityManager.delete(DvybAccountPlan, { accountId });
      logger.info(`  - Deleted ${planResult.affected || 0} account plans`);

      // 7. Delete upgrade requests
      const upgradeResult = await transactionalEntityManager.delete(DvybUpgradeRequest, { accountId });
      logger.info(`  - Deleted ${upgradeResult.affected || 0} upgrade requests`);

      // 8. Delete brand topics (using raw query as model might not exist)
      try {
        await transactionalEntityManager.query('DELETE FROM dvyb_brand_topics WHERE "accountId" = $1', [accountId]);
        logger.info(`  - Deleted brand topics`);
      } catch (e) {
        logger.warn(`  - No brand topics to delete or table doesn't exist`);
      }

      // 9. Delete content library (using raw query as model might not exist)
      try {
        await transactionalEntityManager.query('DELETE FROM dvyb_content_library WHERE "accountId" = $1', [accountId]);
        logger.info(`  - Deleted content library records`);
      } catch (e) {
        logger.warn(`  - No content library records to delete or table doesn't exist`);
      }

      // 10. Delete context
      const contextResult = await transactionalEntityManager.delete(DvybContext, { accountId });
      logger.info(`  - Deleted ${contextResult.affected || 0} context records`);

      // 11. Finally delete the account itself
      const accountResult = await transactionalEntityManager.delete(DvybAccount, { id: accountId });
      logger.info(`  - Deleted ${accountResult.affected || 0} account record`);
    });

    logger.info(`✅ Successfully deleted DVYB account ${accountId} and all related data`);

    return res.json({
      success: true,
      message: `Account "${account.accountName}" and all related data have been permanently deleted`,
    });
  } catch (error) {
    logger.error('Error deleting DVYB account:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete account. Please try again.',
    });
  }
});

export default router;

