import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { DvybAuthService } from '../services/DvybAuthService';
import { DvybGoogleAuthService } from '../services/DvybGoogleAuthService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

// Store OAuth states temporarily (in production, use Redis)
const oauthStates = new Map<string, { codeVerifier: string; timestamp: number }>();

// Cleanup old states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
      oauthStates.delete(state);
    }
  }
}, 10 * 60 * 1000);

/**
 * GET /api/dvyb/auth/twitter/connect
 * Initiate Twitter OAuth flow for connecting account (not login)
 */
router.get('/twitter/connect', async (req: Request, res: Response) => {
  try {
    const { oauthUrl, state, codeVerifier } = await DvybAuthService.generateTwitterOAuthUrl();

    // Store state and code verifier
    oauthStates.set(state, {
      codeVerifier,
      timestamp: Date.now(),
    });

    logger.info('✅ DVYB Twitter connection initiated');

    return res.json({
      success: true,
      data: {
        oauth_url: oauthUrl,
        state,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Twitter connection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate Twitter connection',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/auth/twitter/callback
 * Handle Twitter OAuth callback for connecting account (not login)
 */
router.post('/twitter/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
        timestamp: new Date().toISOString(),
      });
    }

    // Retrieve code verifier
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state',
        timestamp: new Date().toISOString(),
      });
    }

    const { codeVerifier } = stateData;
    oauthStates.delete(state); // Clean up

    // Get account ID from cookies (user must be logged in)
    const accountId = req.cookies?.dvyb_account_id;
    if (!accountId) {
      return res.status(401).json({
        success: false,
        error: 'User must be logged in to connect Twitter',
        timestamp: new Date().toISOString(),
      });
    }

    // Connect Twitter to existing account
    await DvybAuthService.connectTwitterToAccount(
      parseInt(accountId as string, 10),
      code,
      state,
      codeVerifier
    );

    logger.info(`✅ Twitter connected to account ${accountId}`);

    return res.json({
      success: true,
      data: {
        message: 'Twitter connected successfully',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Twitter connection callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'Twitter connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/auth/google/login
 * Initiate Google OAuth flow for authentication
 */
router.get('/google/login', async (req: Request, res: Response) => {
  try {
    const { oauthUrl, state } = await DvybGoogleAuthService.generateGoogleOAuthUrl();

    // Store state for validation
    oauthStates.set(state, {
      codeVerifier: '', // Google doesn't use PKCE code verifier
      timestamp: Date.now(),
    });

    logger.info('✅ DVYB Google login initiated');

    return res.json({
      success: true,
      data: {
        oauth_url: oauthUrl,
        state,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Google login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate Google login',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/auth/google/callback
 * Handle Google OAuth callback
 */
router.post('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify state
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state',
        timestamp: new Date().toISOString(),
      });
    }

    oauthStates.delete(state); // Clean up

    // Handle callback
    const { account, isNewAccount, onboardingComplete } = await DvybGoogleAuthService.handleGoogleCallback(
      code,
      state
    );

    // Set authentication cookie
    res.cookie('dvyb_account_id', account.id.toString(), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production', // Required for HTTPS
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-domain in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    logger.info(`✅ DVYB Google authentication successful for account ${account.id}, onboarding complete: ${onboardingComplete}`);

    return res.json({
      success: true,
      data: {
        account_id: account.id,
        account_name: account.accountName,
        email: account.primaryEmail,
        is_new_account: isNewAccount,
        onboarding_complete: onboardingComplete,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Google callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'Google authentication failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/auth/status
 * Check authentication status
 */
router.get('/status', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.cookies?.dvyb_account_id;

    if (!accountId) {
      logger.info('📊 DVYB Auth Status: No account ID in session/cookies');
      return res.json({
        success: true,
        data: {
          authenticated: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Verify that account actually exists in database
    const accountIdNum = parseInt(accountId as string, 10);
    const accountExists = await DvybAuthService.accountExists(accountIdNum);

    if (!accountExists) {
      logger.info(`📊 DVYB Auth Status: Account ${accountId} does not exist in database`);
      
      // Clear invalid cookies - account was deleted
      res.clearCookie('dvyb_account_id');
      
      return res.json({
        success: true,
        data: {
          authenticated: false,
          accountExists: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Account exists - user is authenticated via Google
    // Check if Google connection is valid (not expired)
    const hasValidGoogleConnection = await DvybGoogleAuthService.hasValidGoogleConnection(accountIdNum);
    
    // Check if Twitter connection exists (optional, for engagement tracking)
    const hasValidTwitterConnection = await DvybAuthService.hasValidTwitterConnection(accountIdNum);
    
    // Check if onboarding is complete
    const onboardingComplete = await DvybAuthService.isOnboardingComplete(accountIdNum);

    logger.info(`📊 DVYB Auth Status: Account ${accountId} authenticated, onboarding: ${onboardingComplete}, Google: ${hasValidGoogleConnection ? 'valid' : 'expired'}, Twitter: ${hasValidTwitterConnection ? 'connected' : 'not connected'}`);
    
    return res.json({
      success: true,
      data: {
        authenticated: true, // ✅ User is authenticated if account exists
        accountId: accountIdNum,
        accountExists: true,
        hasValidGoogleConnection,
        hasValidTwitterConnection,
        onboardingComplete,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB auth status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check authentication status',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/auth/logout
 * Logout current user
 */
router.post('/logout', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    await DvybAuthService.logout(accountId);

    // Clear cookies
    res.clearCookie('dvyb_account_id');

    logger.info(`✅ DVYB account ${accountId} logged out successfully`);

    return res.json({
      success: true,
      message: 'Logged out successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'Logout failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/dvyb/auth/google/disconnect
 * Disconnect Google account
 */
router.delete('/google/disconnect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    await DvybGoogleAuthService.disconnect(accountId);

    logger.info(`✅ Google disconnected for DVYB account ${accountId}`);

    return res.json({
      success: true,
      message: 'Google disconnected successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Google disconnect error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect Google',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/dvyb/auth/twitter/disconnect
 * Disconnect Twitter account
 */
router.delete('/twitter/disconnect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    await DvybAuthService.disconnectTwitter(accountId);

    logger.info(`✅ Twitter disconnected for DVYB account ${accountId}`);

    return res.json({
      success: true,
      message: 'Twitter disconnected successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Twitter disconnect error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect Twitter',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

