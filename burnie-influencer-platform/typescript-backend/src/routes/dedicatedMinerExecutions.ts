import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { DedicatedMinerExecution } from '../models/DedicatedMinerExecution';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ContentPurchase } from '../models/ContentPurchase';
import { logger } from '../config/logger';

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

    logger.info(`🔍 Checking execution availability for miner ${minerWalletAddress}, campaign ${campaignId}, postType ${postType}`);

    const executionRepository = AppDataSource.getRepository(DedicatedMinerExecution);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Check if miner already has an active generation
    const existingMinerExecution = await executionRepository.findOne({
      where: {
        minerWalletAddress,
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

    if (availableCount === 0 && purchaseCount > 0) {
      isHot = true;
      neededPieces = 1; // Need at least 1 piece to make it available
    } else if (availableCount > 0) {
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

    // Reserve execution slot
    const execution = executionRepository.create({
      minerWalletAddress,
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
      where: { minerWalletAddress: walletAddress },
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

export default router;
