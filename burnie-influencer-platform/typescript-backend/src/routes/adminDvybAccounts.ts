import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybContext } from '../models/DvybContext';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
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

    // Get total count
    const total = await query.getCount();

    // Apply pagination
    const skip = (page - 1) * limit;
    const accounts = await query
      .orderBy('account.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    // Fetch context data and current plan for each account
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
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
          accountName: account.accountName,
          primaryEmail: account.primaryEmail,
          accountType: account.accountType,
          isActive: account.isActive,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          // Context data
          website: context?.website || null,
          logoUrl: context?.logoUrl || null,
          logoPresignedUrl,
          hasContext: !!context,
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

export default router;

