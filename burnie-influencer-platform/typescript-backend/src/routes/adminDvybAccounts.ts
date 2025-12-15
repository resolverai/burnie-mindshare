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
import { DvybAccountSubscription } from '../models/DvybAccountSubscription';
import { DvybAccountPayment } from '../models/DvybAccountPayment';
import { DvybImageEdit } from '../models/DvybImageEdit';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import { UrlCacheService } from '../services/UrlCacheService';
import { IsNull } from 'typeorm';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';

const router = Router();
const s3Service = new S3PresignedUrlService();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for videos
  },
});

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';

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

      // 7a. Delete image edits
      const imageEditResult = await transactionalEntityManager.delete(DvybImageEdit, { accountId });
      logger.info(`  - Deleted ${imageEditResult.affected || 0} image edits`);

      // 7b. Delete Stripe payments (must be before subscriptions due to foreign key)
      const paymentResult = await transactionalEntityManager.delete(DvybAccountPayment, { accountId });
      logger.info(`  - Deleted ${paymentResult.affected || 0} account payments`);

      // 7c. Delete Stripe subscriptions
      const subscriptionResult = await transactionalEntityManager.delete(DvybAccountSubscription, { accountId });
      logger.info(`  - Deleted ${subscriptionResult.affected || 0} account subscriptions`);

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

/**
 * GET /api/admin/dvyb-accounts/:id/context
 * Get full context data for an account (for admin editing)
 */
router.get('/:id/context', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    const contextRepo = AppDataSource.getRepository(DvybContext);
    const context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'Context not found for this account',
      });
    }

    // Generate presigned URLs for media files
    let logoPresignedUrl: string | null = null;
    
    if (context.logoUrl) {
      try {
        logoPresignedUrl = await s3Service.generatePresignedUrl(context.logoUrl, 3600);
      } catch (error) {
        logger.error('Failed to generate presigned URL for logo:', error);
      }
    }

    // Generate presigned URLs for brand images
    const brandImagesWithUrls: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
    if (context.brandImages && Array.isArray(context.brandImages)) {
      for (const item of context.brandImages as any[]) {
        try {
          const s3Key = typeof item === 'string' ? item : item.url;
          const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
          brandImagesWithUrls.push({
            url: s3Key,
            presignedUrl: presignedUrl || s3Key,
            timestamp: typeof item === 'object' && item.timestamp ? item.timestamp : new Date().toISOString(),
          });
        } catch (error) {
          logger.error('Failed to generate presigned URL for brand image:', error);
        }
      }
    }

    // Generate presigned URLs for brand assets (videos)
    const brandAssetsWithUrls: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
    if (context.brandAssets && Array.isArray(context.brandAssets)) {
      for (const item of context.brandAssets as any[]) {
        try {
          const s3Key = typeof item === 'string' ? item : item.url;
          const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
          brandAssetsWithUrls.push({
            url: s3Key,
            presignedUrl: presignedUrl || s3Key,
            timestamp: typeof item === 'object' && item.timestamp ? item.timestamp : new Date().toISOString(),
          });
        } catch (error) {
          logger.error('Failed to generate presigned URL for brand asset:', error);
        }
      }
    }

    // Generate presigned URLs for additional logos
    const additionalLogosWithUrls: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
    if (context.additionalLogoUrls && Array.isArray(context.additionalLogoUrls)) {
      for (const item of context.additionalLogoUrls as any[]) {
        try {
          const s3Key = typeof item === 'string' ? item : item.url;
          const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
          additionalLogosWithUrls.push({
            url: s3Key,
            presignedUrl: presignedUrl || s3Key,
            timestamp: typeof item === 'object' && item.timestamp ? item.timestamp : new Date().toISOString(),
          });
        } catch (error) {
          logger.error('Failed to generate presigned URL for additional logo:', error);
        }
      }
    }

    return res.json({
      success: true,
      data: {
        ...context,
        logoPresignedUrl,
        brandImagesWithUrls,
        brandAssetsWithUrls,
        additionalLogosWithUrls,
      },
    });
  } catch (error) {
    logger.error('Error fetching context for admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch context',
    });
  }
});

/**
 * PUT /api/admin/dvyb-accounts/:id/context
 * Update context data for an account (admin editing)
 */
router.put('/:id/context', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'Context not found for this account',
      });
    }

    // Update context with provided data
    const updatableFields = [
      'accountName',
      'website',
      'linksJson',
      'documentUrls',
      'documentsText',
      'logoUrl',
      'additionalLogoUrls',
      'brandImages',
      'brandAssets',
      'businessOverview',
      'whyCustomersChoose',
      'competitors',
      'customerDemographics',
      'popularProducts',
      'brandStyles',
      'colorPalette',
      'brandFonts',
      'brandVoices',
      'contentPreferences',
      'websiteAnalysis',
    ];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        (context as any)[field] = req.body[field];
      }
    }

    await contextRepo.save(context);

    logger.info(`✅ Admin updated context for account ${accountId}`);

    // Fetch updated context with presigned URLs
    const updatedContext = await contextRepo.findOne({ where: { accountId } });
    
    // Generate presigned URL for logo
    let logoPresignedUrl: string | null = null;
    if (updatedContext?.logoUrl) {
      try {
        logoPresignedUrl = await s3Service.generatePresignedUrl(updatedContext.logoUrl, 3600);
      } catch (error) {
        logger.error('Failed to generate presigned URL for logo:', error);
      }
    }

    return res.json({
      success: true,
      data: {
        ...updatedContext,
        logoPresignedUrl,
      },
      message: 'Context updated successfully',
    });
  } catch (error) {
    logger.error('Error updating context for admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update context',
    });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload-logo
 * Upload logo for an account (admin editing)
 */
router.post('/:id/upload-logo', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    // Handle file upload using multer middleware would be ideal here
    // For now, we'll use a simpler approach - the frontend can upload directly
    // and send us the S3 key
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({
        success: false,
        error: 'S3 key is required',
      });
    }

    const contextRepo = AppDataSource.getRepository(DvybContext);
    const context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'Context not found for this account',
      });
    }

    context.logoUrl = s3Key;
    await contextRepo.save(context);

    // Generate presigned URL
    const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);

    return res.json({
      success: true,
      data: {
        s3_key: s3Key,
        presignedUrl,
      },
      message: 'Logo updated successfully',
    });
  } catch (error) {
    logger.error('Error uploading logo for admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload logo',
    });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload-media
 * Upload media files (images/videos) for an account (admin editing)
 */
router.post('/:id/upload-media', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    // Frontend uploads files directly to S3 and sends us the keys
    const { images, videos } = req.body;

    const contextRepo = AppDataSource.getRepository(DvybContext);
    const context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      return res.status(404).json({
        success: false,
        error: 'Context not found for this account',
      });
    }

    // Update brand images
    if (images && Array.isArray(images)) {
      context.brandImages = images;
    }

    // Update brand assets (videos)
    if (videos && Array.isArray(videos)) {
      context.brandAssets = videos;
    }

    await contextRepo.save(context);

    return res.json({
      success: true,
      message: 'Media updated successfully',
    });
  } catch (error) {
    logger.error('Error uploading media for admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload media',
    });
  }
});

/**
 * GET /api/admin/dvyb-accounts/:id/connections
 * Get social connections status for an account
 */
router.get('/:id/connections', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);

    if (isNaN(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account ID',
      });
    }

    // Check all platform connections
    const googleConn = await AppDataSource.getRepository(DvybGoogleConnection).findOne({
      where: { accountId },
    });
    const twitterConn = await AppDataSource.getRepository(DvybTwitterConnection).findOne({
      where: { accountId },
    });
    const instagramConn = await AppDataSource.getRepository(DvybInstagramConnection).findOne({
      where: { accountId },
    });
    const linkedinConn = await AppDataSource.getRepository(DvybLinkedInConnection).findOne({
      where: { accountId },
    });
    const tiktokConn = await AppDataSource.getRepository(DvybTikTokConnection).findOne({
      where: { accountId },
    });

    const getStatus = (conn: any) => {
      if (!conn) return 'not_connected';
      // Check if token is expired
      if (conn.tokenExpiresAt && new Date(conn.tokenExpiresAt) < new Date()) {
        return 'expired';
      }
      return 'connected';
    };

    return res.json({
      success: true,
      data: {
        google: getStatus(googleConn),
        twitter: getStatus(twitterConn),
        instagram: getStatus(instagramConn),
        linkedin: getStatus(linkedinConn),
        tiktok: getStatus(tiktokConn),
      },
    });
  } catch (error) {
    logger.error('Error fetching connections for admin:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch connections',
    });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload/logo
 * Admin upload logo for an account
 */
router.post('/:id/upload/logo', upload.single('logo'), async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const file = req.file;

    if (isNaN(accountId)) {
      return res.status(400).json({ success: false, error: 'Invalid account ID' });
    }

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Invalid file type' });
    }

    // Convert WEBP to PNG if needed
    let buffer = file.buffer;
    let contentType = file.mimetype;
    let fileExtension = path.extname(file.originalname).toLowerCase();

    if (file.mimetype === 'image/webp') {
      buffer = await sharp(file.buffer).png().toBuffer();
      contentType = 'image/png';
      fileExtension = '.png';
    }

    // Generate unique filename
    const uniqueFilename = `dvyb/logos/${accountId}/${crypto.randomUUID()}${fileExtension}`;

    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: uniqueFilename,
      Body: buffer,
      ContentType: contentType,
    }));

    // Generate presigned URL
    const presignedUrl = await s3Service.generatePresignedUrl(uniqueFilename, 3600);

    // Update context
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });
    if (!context) {
      context = contextRepo.create({ accountId });
    }
    context.logoUrl = uniqueFilename;
    await contextRepo.save(context);

    logger.info(`✅ Admin uploaded logo for account ${accountId}: ${uniqueFilename}`);

    return res.json({
      success: true,
      data: { s3_key: uniqueFilename, presignedUrl },
    });
  } catch (error) {
    logger.error('Error uploading logo (admin):', error);
    return res.status(500).json({ success: false, error: 'Failed to upload logo' });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload/additional-logos
 * Admin upload additional logos for an account
 */
router.post('/:id/upload/additional-logos', upload.array('logos', 10), async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const files = req.files as Express.Multer.File[];

    if (isNaN(accountId)) {
      return res.status(400).json({ success: false, error: 'Invalid account ID' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const uploadedLogos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];

    for (const file of files) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) continue;

      let buffer = file.buffer;
      let contentType = file.mimetype;
      let fileExtension = path.extname(file.originalname).toLowerCase();

      if (file.mimetype === 'image/webp') {
        buffer = await sharp(file.buffer).png().toBuffer();
        contentType = 'image/png';
        fileExtension = '.png';
      }

      const uniqueFilename = `dvyb/additional-logos/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      }));

      const presignedUrl = await s3Service.generatePresignedUrl(uniqueFilename, 3600);

      uploadedLogos.push({
        url: uniqueFilename,
        presignedUrl: presignedUrl || uniqueFilename,
        timestamp: new Date().toISOString(),
      });
    }

    // Update context
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });
    if (!context) {
      context = contextRepo.create({ accountId });
    }
    context.additionalLogoUrls = [...(context.additionalLogoUrls || []), ...uploadedLogos] as any;
    await contextRepo.save(context);

    logger.info(`✅ Admin uploaded ${uploadedLogos.length} additional logos for account ${accountId}`);

    return res.json({
      success: true,
      data: { logos: uploadedLogos },
    });
  } catch (error) {
    logger.error('Error uploading additional logos (admin):', error);
    return res.status(500).json({ success: false, error: 'Failed to upload additional logos' });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload/media
 * Admin upload images/videos for an account
 */
router.post('/:id/upload/media', upload.array('media', 50), async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const files = req.files as Express.Multer.File[];

    if (isNaN(accountId)) {
      return res.status(400).json({ success: false, error: 'Invalid account ID' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const images: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
    const videos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];

    for (const file of files) {
      const timestamp = new Date().toISOString();
      const isImage = file.mimetype.startsWith('image/');
      const isVideo = file.mimetype.startsWith('video/');

      if (!isImage && !isVideo) continue;

      let buffer = file.buffer;
      let contentType = file.mimetype;
      let fileExtension = path.extname(file.originalname);

      if (file.mimetype === 'image/webp') {
        buffer = await sharp(file.buffer).png().toBuffer();
        contentType = 'image/png';
        fileExtension = '.png';
      }

      const folder = isImage ? 'brand-images' : 'brand-videos';
      const uniqueFilename = `dvyb/${folder}/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: contentType,
      }));

      const presignedUrl = await s3Service.generatePresignedUrl(uniqueFilename, 3600);

      if (isImage) {
        images.push({ url: uniqueFilename, presignedUrl: presignedUrl || uniqueFilename, timestamp });
      } else {
        videos.push({ url: uniqueFilename, presignedUrl: presignedUrl || uniqueFilename, timestamp });
      }
    }

    // Update context
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });
    if (!context) {
      context = contextRepo.create({ accountId });
    }

    // Append new media to existing
    const existingImages = (context.brandImages || []) as any[];
    const existingVideos = (context.brandAssets || []) as any[];
    context.brandImages = [...existingImages, ...images] as any;
    context.brandAssets = [...existingVideos, ...videos] as any;
    await contextRepo.save(context);

    logger.info(`✅ Admin uploaded ${images.length} images and ${videos.length} videos for account ${accountId}`);

    return res.json({
      success: true,
      data: { images, videos },
    });
  } catch (error) {
    logger.error('Error uploading media (admin):', error);
    return res.status(500).json({ success: false, error: 'Failed to upload media' });
  }
});

/**
 * POST /api/admin/dvyb-accounts/:id/upload/documents
 * Admin upload documents with text extraction for an account
 */
router.post('/:id/upload/documents', upload.array('documents', 10), async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id!);
    const files = req.files as Express.Multer.File[];

    if (isNaN(accountId)) {
      return res.status(400).json({ success: false, error: 'Invalid account ID' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const documentsText: Array<{ name: string; url: string; text: string; timestamp: string }> = [];

    for (const file of files) {
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `dvyb-documents/${accountId}/${crypto.randomUUID()}${fileExtension}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: uniqueFilename,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));

      const fullS3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${uniqueFilename}`;

      // Extract text for PDF/DOCX
      let extractedText = '';
      if (
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        try {
          const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
          const extractResp = await axios.post(
            `${pythonBackendUrl}/api/utils/extract-text-from-url`,
            { url: fullS3Url, s3_key: uniqueFilename },
            { timeout: 120000 }
          );
          if (extractResp?.status === 200) {
            extractedText = extractResp.data?.text || '';
          }
        } catch (extractError: any) {
          logger.warn(`Failed to extract text from ${file.originalname}: ${extractError.message}`);
        }
      }

      documentsText.push({
        name: file.originalname,
        url: uniqueFilename,
        text: extractedText,
        timestamp: new Date().toISOString(),
      });
    }

    // Update context
    const contextRepo = AppDataSource.getRepository(DvybContext);
    let context = await contextRepo.findOne({ where: { accountId } });
    if (!context) {
      context = contextRepo.create({ accountId });
    }

    const existingDocs = (context.documentsText || []) as any[];
    context.documentsText = [...existingDocs, ...documentsText] as any;
    await contextRepo.save(context);

    logger.info(`✅ Admin uploaded ${documentsText.length} documents for account ${accountId}`);

    return res.json({
      success: true,
      data: { documents_text: documentsText },
    });
  } catch (error) {
    logger.error('Error uploading documents (admin):', error);
    return res.status(500).json({ success: false, error: 'Failed to upload documents' });
  }
});

export default router;

