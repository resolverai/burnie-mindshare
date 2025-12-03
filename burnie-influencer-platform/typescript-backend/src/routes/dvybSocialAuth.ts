import { Router, Response } from 'express';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { DvybAuthService } from '../services/DvybAuthService';
import { DvybGoogleAuthService } from '../services/DvybGoogleAuthService';
import { DvybLinkedInService } from '../services/DvybLinkedInService';
import { DvybTikTokService } from '../services/DvybTikTokService';
import { DvybInstagramService } from '../services/DvybInstagramService';
import { env } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

// ============================================
// LINKEDIN OAUTH ROUTES
// ============================================

/**
 * @route GET /api/dvyb/auth/linkedin/auth-url
 * @description Initiate LinkedIn OAuth flow
 * @access Private
 */
router.get('/linkedin/auth-url', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const authUrl = DvybLinkedInService.getAuthUrl(accountId);
    return res.json({ success: true, data: { authUrl } });
  } catch (error: any) {
    logger.error('LinkedIn auth initiation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route POST /api/dvyb/auth/linkedin/connect
 * @description Handle LinkedIn OAuth callback (called from frontend popup)
 * @access Public (accountId extracted from state to avoid cookie dependency in popups)
 */
router.post('/linkedin/connect', async (req: DvybAuthRequest, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
      });
    }

    // Extract accountId from state (base64 encoded JSON)
    let accountId: number;
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      accountId = decodedState.accountId;
      
      if (!accountId) {
        throw new Error('accountId not found in state');
      }
    } catch (error) {
      logger.error('❌ Failed to decode state:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter',
      });
    }

    logger.info(`🔄 Connecting LinkedIn to account ${accountId}...`);

    // Connect LinkedIn using the service
    const connection = await DvybLinkedInService.connectToAccount(
      accountId,
      code,
      state
    );

    logger.info(`✅ LinkedIn connected successfully to account ${accountId}`);

    return res.json({
      success: true,
      data: {
        message: 'LinkedIn connected successfully',
      },
    });
  } catch (error: any) {
    logger.error('❌ LinkedIn connection error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'LinkedIn connection failed',
    });
  }
});

/**
 * @route GET /api/dvyb/auth/linkedin/status
 * @description Check LinkedIn connection status
 * @access Private
 */
router.get('/linkedin/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const isValid = await DvybLinkedInService.isConnectionValid(accountId);
    return res.json({ success: true, data: { isConnected: isValid } });
  } catch (error: any) {
    logger.error('LinkedIn status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route DELETE /api/dvyb/auth/linkedin/disconnect
 * @description Disconnect LinkedIn
 * @access Private
 */
router.delete('/linkedin/disconnect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await DvybLinkedInService.disconnect(accountId);
    return res.json({ success: true, message: 'LinkedIn disconnected successfully' });
  } catch (error: any) {
    logger.error('LinkedIn disconnect error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// TIKTOK OAUTH ROUTES
// ============================================

/**
 * @route GET /api/dvyb/auth/tiktok/auth-url
 * @description Initiate TikTok OAuth flow
 * @access Private
 */
router.get('/tiktok/auth-url', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const authUrl = DvybTikTokService.getAuthUrl(accountId);
    return res.json({ success: true, data: { authUrl } });
  } catch (error: any) {
    logger.error('TikTok auth initiation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route POST /api/dvyb/auth/tiktok/connect
 * @description Handle TikTok OAuth callback (called from frontend popup)
 * @access Public (accountId extracted from state to avoid cookie dependency in popups)
 */
router.post('/tiktok/connect', async (req: DvybAuthRequest, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
      });
    }

    // Extract accountId from state (base64 encoded JSON)
    let accountId: number;
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      accountId = decodedState.accountId;
      
      if (!accountId) {
        throw new Error('accountId not found in state');
      }
    } catch (error) {
      logger.error('❌ Failed to decode state:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter',
      });
    }

    logger.info(`🔄 Connecting TikTok to account ${accountId}...`);

    // Connect TikTok using the service
    const connection = await DvybTikTokService.connectToAccount(
      accountId,
      code,
      state
    );

    logger.info(`✅ TikTok connected successfully to account ${accountId}`);

    return res.json({
      success: true,
      data: {
        message: 'TikTok connected successfully',
      },
    });
  } catch (error: any) {
    logger.error('❌ TikTok connection error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'TikTok connection failed',
    });
  }
});

/**
 * @route GET /api/dvyb/auth/tiktok/status
 * @description Check TikTok connection status
 * @access Private
 */
router.get('/tiktok/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const isValid = await DvybTikTokService.isConnectionValid(accountId);
    return res.json({ success: true, data: { isConnected: isValid } });
  } catch (error: any) {
    logger.error('TikTok status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route DELETE /api/dvyb/auth/tiktok/disconnect
 * @description Disconnect TikTok
 * @access Private
 */
router.delete('/tiktok/disconnect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await DvybTikTokService.disconnect(accountId);
    return res.json({ success: true, message: 'TikTok disconnected successfully' });
  } catch (error: any) {
    logger.error('TikTok disconnect error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// INSTAGRAM OAUTH ROUTES
// ============================================

/**
 * @route GET /api/dvyb/auth/instagram/auth-url
 * @description Initiate Instagram OAuth flow
 * @access Private
 */
router.get('/instagram/auth-url', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const authUrl = DvybInstagramService.getAuthUrl(accountId);
    return res.json({ success: true, data: { authUrl } });
  } catch (error: any) {
    logger.error('Instagram auth initiation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route POST /api/dvyb/auth/instagram/connect
 * @description Handle Instagram OAuth callback (called from frontend popup)
 * @access Public (accountId extracted from state to avoid cookie dependency in popups)
 */
router.post('/instagram/connect', async (req: DvybAuthRequest, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
      });
    }

    // Extract accountId from state (base64 encoded JSON)
    let accountId: number;
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      accountId = decodedState.accountId;
      
      if (!accountId) {
        throw new Error('accountId not found in state');
      }
    } catch (error) {
      logger.error('❌ Failed to decode state:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter',
      });
    }

    logger.info(`🔄 Connecting Instagram to account ${accountId}...`);

    // Connect Instagram using the service
    const connection = await DvybInstagramService.connectToAccount(
      accountId,
      code,
      state
    );

    logger.info(`✅ Instagram connected successfully to account ${accountId}`);

    return res.json({
      success: true,
      data: {
        message: 'Instagram connected successfully',
        username: connection.username,
      },
    });
  } catch (error: any) {
    logger.error('❌ Instagram connection error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Instagram connection failed',
    });
  }
});

/**
 * @route GET /api/dvyb/auth/instagram/status
 * @description Check Instagram connection status
 * @access Private
 */
router.get('/instagram/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const isValid = await DvybInstagramService.isConnectionValid(accountId);
    return res.json({ success: true, data: { isConnected: isValid } });
  } catch (error: any) {
    logger.error('Instagram status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route DELETE /api/dvyb/auth/instagram/disconnect
 * @description Disconnect Instagram
 * @access Private
 */
router.delete('/instagram/disconnect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await DvybInstagramService.disconnect(accountId);
    return res.json({ success: true, message: 'Instagram disconnected successfully' });
  } catch (error: any) {
    logger.error('Instagram disconnect error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ALL PLATFORMS STATUS CHECK
// ============================================

/**
 * @route GET /api/dvyb/auth/connections/status
 * @description Check all social media connection statuses
 * @access Private
 */
router.get('/connections/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Get detailed status for each platform using new getConnectionStatus methods
    const [googleStatus, twitterStatus, instagramStatus, linkedinStatus, tiktokStatus] = await Promise.all([
      (async () => {
        const valid = await DvybGoogleAuthService.hasValidGoogleConnection(accountId);
        return valid ? 'connected' : 'not_connected';
      })(),
      DvybAuthService.getTwitterConnectionStatus(accountId),
      DvybInstagramService.getConnectionStatus(accountId),
      DvybLinkedInService.getConnectionStatus(accountId),
      DvybTikTokService.getConnectionStatus(accountId),
    ]);

    return res.json({
      success: true,
      data: {
        google: googleStatus,
        twitter: twitterStatus,
        instagram: instagramStatus,
        linkedin: linkedinStatus,
        tiktok: tiktokStatus,
      },
    });
  } catch (error: any) {
    logger.error('Connection status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

