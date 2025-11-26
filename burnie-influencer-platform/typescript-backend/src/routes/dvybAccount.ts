import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

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
    if (email !== undefined) account.email = email;
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

    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { accountId, isActive: true },
    });

    if (!connection) {
      return res.json({
        success: true,
        data: {
          connected: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Check if token is expired
    const isExpired = connection.oauth2ExpiresAt && connection.oauth2ExpiresAt < new Date();

    return res.json({
      success: true,
      data: {
        connected: true,
        twitterHandle: connection.twitterHandle,
        isExpired,
        expiresAt: connection.oauth2ExpiresAt,
        scopes: connection.scopes,
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

export default router;

