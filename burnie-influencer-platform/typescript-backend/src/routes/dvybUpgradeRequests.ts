import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybUpgradeRequest } from '../models/DvybUpgradeRequest';
import { DvybAccount } from '../models/DvybAccount';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

/**
 * POST /api/dvyb/upgrade-requests
 * Submit a new upgrade request
 */
router.post('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const {
      currentPlan,
      currentImageUsage,
      currentVideoUsage,
      imageLimit,
      videoLimit,
    } = req.body;

    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        timestamp: new Date().toISOString(),
      });
    }

    const upgradeRequestRepo = AppDataSource.getRepository(DvybUpgradeRequest);
    
    // Create upgrade request
    const upgradeRequest = upgradeRequestRepo.create({
      accountId,
      email: account.primaryEmail,
      accountName: account.accountName,
      currentPlan: currentPlan || 'Free Plan',
      currentImageUsage: currentImageUsage || 0,
      currentVideoUsage: currentVideoUsage || 0,
      imageLimit: imageLimit || 0,
      videoLimit: videoLimit || 0,
      status: 'pending',
    });

    await upgradeRequestRepo.save(upgradeRequest);

    logger.info(`✅ Upgrade request submitted for account ${accountId} (${account.accountName})`);

    return res.json({
      success: true,
      data: upgradeRequest,
      message: 'Upgrade request submitted successfully. Our team will contact you soon.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Submit upgrade request error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to submit upgrade request',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

