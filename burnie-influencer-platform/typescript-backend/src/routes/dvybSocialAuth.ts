import { Router, Response } from 'express';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
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
 * @route GET /api/dvyb/auth/linkedin
 * @description Initiate LinkedIn OAuth flow
 * @access Private
 */
router.get('/linkedin', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
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
 * @route GET /api/dvyb/auth/linkedin/callback
 * @description Handle LinkedIn OAuth callback
 * @access Public
 */
router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error(`LinkedIn OAuth error: ${error} - ${error_description}`);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error_description as string || error as string)}`);
  }

  if (!code || !state) {
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=Missing code or state`);
  }

  try {
    const { accountId, connection } = await DvybLinkedInService.handleCallback(
      code as string,
      state as string
    );

    // Redirect back to frontend with success
    return res.redirect(`${env.dvybOAuth.frontendUrl}/home?linkedin_connected=true`);
  } catch (error: any) {
    logger.error('LinkedIn callback error:', error);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error.message)}`);
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
 * @route GET /api/dvyb/auth/tiktok
 * @description Initiate TikTok OAuth flow
 * @access Private
 */
router.get('/tiktok', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
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
 * @route GET /api/dvyb/auth/tiktok/callback
 * @description Handle TikTok OAuth callback
 * @access Public
 */
router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error(`TikTok OAuth error: ${error} - ${error_description}`);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error_description as string || error as string)}`);
  }

  if (!code || !state) {
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=Missing code or state`);
  }

  try {
    const { accountId, connection } = await DvybTikTokService.handleCallback(
      code as string,
      state as string
    );

    // Redirect back to frontend with success
    return res.redirect(`${env.dvybOAuth.frontendUrl}/home?tiktok_connected=true`);
  } catch (error: any) {
    logger.error('TikTok callback error:', error);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error.message)}`);
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
 * @route GET /api/dvyb/auth/instagram
 * @description Initiate Instagram OAuth flow
 * @access Private
 */
router.get('/instagram', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
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
 * @route GET /api/dvyb/auth/instagram/callback
 * @description Handle Instagram OAuth callback
 * @access Public
 */
router.get('/instagram/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error(`Instagram OAuth error: ${error} - ${error_description}`);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error_description as string || error as string)}`);
  }

  if (!code || !state) {
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=Missing code or state`);
  }

  try {
    const { accountId, connection } = await DvybInstagramService.handleCallback(
      code as string,
      state as string
    );

    // Redirect back to frontend with success
    return res.redirect(`${env.dvybOAuth.frontendUrl}/home?instagram_connected=true`);
  } catch (error: any) {
    logger.error('Instagram callback error:', error);
    return res.redirect(`${env.dvybOAuth.frontendUrl}?error=${encodeURIComponent(error.message)}`);
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

    const [instagramConnected, linkedinConnected, tiktokConnected] = await Promise.all([
      DvybInstagramService.isConnectionValid(accountId),
      DvybLinkedInService.isConnectionValid(accountId),
      DvybTikTokService.isConnectionValid(accountId),
    ]);

    return res.json({
      success: true,
      data: {
        instagram: instagramConnected,
        linkedin: linkedinConnected,
        tiktok: tiktokConnected,
      },
    });
  } catch (error: any) {
    logger.error('Connection status check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

