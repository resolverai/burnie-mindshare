import { Router } from 'express';
import { ILike } from 'typeorm';
import { AppDataSource } from '../config/database';
import { DedicatedMinerExecution } from '../models/DedicatedMinerExecution';
import { ApprovedMiner } from '../models/ApprovedMiner';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ContentPurchase } from '../models/ContentPurchase';
import { User } from '../models/User';
import { logger } from '../config/logger';
import { env } from '../config/env';

const router = Router();

interface ExecutionCheckResult {
  canGenerate: boolean;
  reason?: string;
  neededPieces: number;
  activeGenerations: number;
  slotsAvailable: number;
}

/**
 * Check if a miner can generate content for a campaign/post_type combination
 * and reserve an execution slot if possible
 */
router.post('/executions/check-and-reserve', async (req, res) => {
  try {
    const { minerWalletAddress, campaignId, postType } = req.body;

    if (!minerWalletAddress || !campaignId || !postType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: minerWalletAddress, campaignId, postType'
      });
    }

    // Check if miner is approved for automated mining
    const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);
    const normalizedWalletAddress = minerWalletAddress.toLowerCase().trim();
    
    const approvedMiner = await approvedMinerRepository.findOne({
      where: { walletAddress: ILike(normalizedWalletAddress) }
    });

    if (!approvedMiner) {
      logger.warn(`❌ Unapproved miner attempted to reserve execution: ${normalizedWalletAddress}`);
      return res.status(403).json({
        success: false,
        message: 'You are not approved for automated mining. Contact an admin to request approval for automated content generation.',
        error: 'MINER_NOT_APPROVED',
        requiresApproval: true
      });
    }

    logger.info(`🔍 Checking execution availability for approved miner ${minerWalletAddress}, campaign ${campaignId}, postType ${postType}`);

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Check if miner already has an active generation (use case-insensitive comparison)
    const existingMinerExecution = await executionRepository.findOne({
      where: {
        minerWalletAddress: ILike(minerWalletAddress.toLowerCase()),
        status: 'generating'
      }
    });

    if (existingMinerExecution) {
      logger.info(`❌ Miner ${minerWalletAddress} already has active generation`);
      return res.json({
        success: true,
        canGenerate: false,
        reason: 'Miner already has an active generation',
        executionId: null
      });
    }

    // Calculate current hot criteria for this campaign/post_type
    // First check campaign-level metrics
    const totalContentCount = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .getCount();

    const totalAvailablePosts = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
      .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getCount();

    const totalPurchases = await purchaseRepository
      .createQueryBuilder('purchase')
      .innerJoin('purchase.content', 'content')
      .where('content.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .getCount();

    // Check post_type specific metrics
    const availableCount = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .andWhere('content.postType = :postType', { postType })
      .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
      .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getCount();

    const purchaseCount = await purchaseRepository
      .createQueryBuilder('purchase')
      .innerJoin('purchase.content', 'content')
      .where('content.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .andWhere('content.postType = :postType', { postType })
      .getCount();

    // Check if criteria is still hot
    let isHot = false;
    let neededPieces = 0;

    // Case 1: Campaign has no content at all (newly created) - all post types are hot
    const isNewlyCreated = totalContentCount === 0;
    
    // Case 2: Campaign has purchases > 0 but total available posts = 0 - all post types are hot
    const hasPurchasesButNoAvailable = totalPurchases > 0 && totalAvailablePosts === 0;

    if (isNewlyCreated) {
      isHot = true;
      neededPieces = 1; // Need at least 1 piece for new campaigns
    } else if (hasPurchasesButNoAvailable) {
      isHot = true;
      neededPieces = 1; // Need at least 1 piece to make it available
    } else if (availableCount === 0 && purchaseCount > 0) {
      // Case 3: Existing logic - available is 0 but purchases > 0 for this post type
      isHot = true;
      neededPieces = 1; // Need at least 1 piece to make it available
    } else if (availableCount > 0) {
      // Case 4: Existing logic - ratio > 1 for this post type
      const ratio = purchaseCount / availableCount;
      if (ratio > 1) {
        isHot = true;
        // Calculate how many pieces needed to bring ratio to 1.0
        neededPieces = Math.ceil(purchaseCount - availableCount);
      }
    }

    if (!isHot) {
      logger.info(`❌ Campaign ${campaignId} (${postType}) no longer hot. Available: ${availableCount}, Purchased: ${purchaseCount}`);
      return res.json({
        success: true,
        canGenerate: false,
        reason: 'Campaign/post_type no longer meets hot criteria',
        executionId: null
      });
    }

    // Count active generations for this campaign/post_type
    const activeGenerations = await executionRepository
      .createQueryBuilder('execution')
      .where('execution.campaignId = :campaignId', { campaignId: parseInt(campaignId) })
      .andWhere('execution.postType = :postType', { postType })
      .andWhere('execution.status = :status', { status: 'generating' })
      .getCount();

    const slotsAvailable = neededPieces - activeGenerations;

    if (slotsAvailable <= 0) {
      logger.info(`❌ No slots available for campaign ${campaignId} (${postType}). Needed: ${neededPieces}, Active: ${activeGenerations}`);
      return res.json({
        success: true,
        canGenerate: false,
        reason: 'No execution slots available',
        executionId: null
      });
    }

    // Reserve execution slot (store wallet address in lowercase)
    const execution = executionRepository.create({
      minerWalletAddress: minerWalletAddress.toLowerCase(),
      campaignId: parseInt(campaignId),
      postType,
      status: 'generating',
      executionStartedAt: new Date()
    });

    const savedExecution = await executionRepository.save(execution);

    logger.info(`✅ Execution reserved for miner ${minerWalletAddress}, campaign ${campaignId} (${postType}). Execution ID: ${savedExecution.id}`);

    return res.json({
      success: true,
      canGenerate: true,
      executionId: savedExecution.id,
      neededPieces,
      activeGenerations: activeGenerations + 1,
      slotsAvailable: slotsAvailable - 1
    });

  } catch (error) {
    logger.error('❌ Error checking execution availability:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check execution availability',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Mark an execution as completed
 */
router.put('/executions/:executionId/complete', async (req, res) => {
  try {
    const { executionId } = req.params;

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    const execution = await executionRepository.findOne({
      where: { id: executionId }
    });

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Execution not found'
      });
    }

    if (execution.status !== 'generating') {
      return res.status(400).json({
        success: false,
        message: 'Execution is not in generating status'
      });
    }

    execution.markAsCompleted();
    await executionRepository.save(execution);

    logger.info(`✅ Execution ${executionId} marked as completed`);

    // Automatically assign content to admin for approval
    try {
      await assignContentToAdmin(execution);
    } catch (assignError) {
      logger.error(`❌ Failed to assign content to admin for execution ${executionId}:`, assignError);
      // Don't fail the request if assignment fails - log and continue
    }

    return res.json({
      success: true,
      message: 'Execution marked as completed',
      execution: {
        id: execution.id,
        status: execution.status,
        completedAt: execution.executionCompletedAt
      }
    });

  } catch (error) {
    logger.error('❌ Error completing execution:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete execution',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Mark an execution as failed
 */
router.put('/executions/:executionId/failed', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { errorMessage } = req.body;

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    const execution = await executionRepository.findOne({
      where: { id: executionId }
    });

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Execution not found'
      });
    }

    if (execution.status !== 'generating') {
      return res.status(400).json({
        success: false,
        message: 'Execution is not in generating status'
      });
    }

    execution.markAsFailed(errorMessage);
    await executionRepository.save(execution);

    logger.info(`❌ Execution ${executionId} marked as failed: ${errorMessage || 'Unknown error'}`);

    return res.json({
      success: true,
      message: 'Execution marked as failed',
      execution: {
        id: execution.id,
        status: execution.status,
        failedAt: execution.executionCompletedAt,
        errorMessage: execution.errorMessage
      }
    });

  } catch (error) {
    logger.error('❌ Error failing execution:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark execution as failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get execution status for a miner
 */
router.get('/executions/miner/:walletAddress/status', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    const executions = await executionRepository.find({
      where: { minerWalletAddress: ILike(walletAddress.toLowerCase()) },
      order: { createdAt: 'DESC' },
      take: 10 // Get last 10 executions
    });

    const activeExecution = executions.find(e => e.status === 'generating');

    return res.json({
      success: true,
      data: {
        activeExecution: activeExecution ? {
          id: activeExecution.id,
          campaignId: activeExecution.campaignId,
          postType: activeExecution.postType,
          status: activeExecution.status,
          startedAt: activeExecution.executionStartedAt
        } : null,
        recentExecutions: executions.map(e => ({
          id: e.id,
          campaignId: e.campaignId,
          postType: e.postType,
          status: e.status,
          startedAt: e.executionStartedAt,
          completedAt: e.executionCompletedAt,
          errorMessage: e.errorMessage
        }))
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching miner execution status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch execution status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/executions/miner/:walletAddress/total-completed
 * Get total count of completed executions for a miner
 */
router.get('/executions/miner/:walletAddress/total-completed', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    
    // Count completed executions for this miner (use case-insensitive comparison)
    const totalCompleted = await executionRepository.count({
      where: { 
        minerWalletAddress: ILike(walletAddress.toLowerCase()),
        status: 'completed'
      }
    });

    return res.json({
      success: true,
      data: {
        walletAddress,
        totalCompleted
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching miner total completed count:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch total completed count',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Helper function to assign content to admin for approval
 */
async function assignContentToAdmin(execution: DedicatedMinerExecution): Promise<void> {
  try {
    // Get admin wallets from environment
    const adminWallets = env.miner.adminWalletAddresses;
    if (adminWallets.length === 0) {
      logger.warn('⚠️ No admin wallets configured - cannot assign content for approval');
      return;
    }

    // Find the user by miner wallet address to get creatorId
    const userRepository = AppDataSource.getRepository(User);
    const minerUser = await userRepository.findOne({
      where: { walletAddress: ILike(execution.minerWalletAddress.toLowerCase()) }
    });

    if (!minerUser) {
      logger.warn(`⚠️ Miner user not found for wallet ${execution.minerWalletAddress} - cannot assign content`);
      return;
    }

    // Find the most recent pending content for this campaign, postType, and creator
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: execution.campaignId })
      .andWhere('content.postType = :postType', { postType: execution.postType })
      .andWhere('content.creatorId = :creatorId', { creatorId: minerUser.id })
      .andWhere('content.approvalStatus = :status', { status: 'pending' })
      .orderBy('content.createdAt', 'DESC')
      .getOne();

    if (!content) {
      logger.warn(`⚠️ No pending content found for execution ${execution.id} - cannot assign to admin`);
      return;
    }

    // Check if content is already assigned
    const { AdminContentApproval } = await import('../models/AdminContentApproval');
    const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
    const existingApproval = await approvalRepository.findOne({
      where: { contentId: content.id }
    });

    if (existingApproval) {
      logger.info(`ℹ️ Content ${content.id} already assigned to admin ${existingApproval.adminWalletAddress}`);
      return;
    }

    // Randomly select an admin
    const randomAdmin = adminWallets[Math.floor(Math.random() * adminWallets.length)];

    // Create approval record
    const approval = approvalRepository.create({
      adminWalletAddress: randomAdmin.toLowerCase(),
      contentId: content.id,
      minerWalletAddress: execution.minerWalletAddress.toLowerCase(),
      status: 'pending'
    });

    await approvalRepository.save(approval);

    logger.info(`✅ Assigned content ${content.id} to admin ${randomAdmin} for review (execution ${execution.id})`);
  } catch (error) {
    logger.error(`❌ Error assigning content to admin: ${error}`);
    throw error;
  }
}

export default router;
