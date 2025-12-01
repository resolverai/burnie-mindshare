import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
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

export default router;

