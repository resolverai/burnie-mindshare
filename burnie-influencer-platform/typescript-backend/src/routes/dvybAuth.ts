import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { DvybAuthService } from '../services/DvybAuthService';
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
 * GET /api/dvyb/auth/twitter/login
 * Initiate Twitter OAuth flow
 */
router.get('/twitter/login', async (req: Request, res: Response) => {
  try {
    const { oauthUrl, state, codeVerifier } = await DvybAuthService.generateTwitterOAuthUrl();

    // Store state and code verifier
    oauthStates.set(state, {
      codeVerifier,
      timestamp: Date.now(),
    });

    logger.info('✅ DVYB Twitter login initiated');

    return res.json({
      success: true,
      data: {
        oauth_url: oauthUrl,
        state,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Twitter login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate Twitter login',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/auth/twitter/callback
 * Handle Twitter OAuth callback
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

    // Handle callback
    const { account, isNewAccount } = await DvybAuthService.handleTwitterCallback(
      code,
      state,
      codeVerifier
    );

    // Check if onboarding is complete
    const onboardingComplete = await DvybAuthService.isOnboardingComplete(account.id);

    // Set cookies for authentication
    res.cookie('dvyb_account_id', account.id.toString(), {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    });
    res.cookie('dvyb_twitter_handle', account.twitterHandle, {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });

    logger.info(`✅ DVYB Twitter callback successful for account ${account.id}, onboarding complete: ${onboardingComplete}`);

    return res.json({
      success: true,
      data: {
        account_id: account.id,
        twitter_handle: account.twitterHandle,
        is_new_account: isNewAccount,
        onboarding_complete: onboardingComplete,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB Twitter callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'Twitter authentication failed',
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

    // Verify that account and Twitter connection actually exist in database
    const accountIdNum = parseInt(accountId as string, 10);
    const hasValidConnection = await DvybAuthService.hasValidTwitterConnection(accountIdNum);

    if (!hasValidConnection) {
      logger.info(`📊 DVYB Auth Status: No valid Twitter connection for account ${accountId}`);
      
      // Clear invalid cookies
      res.clearCookie('dvyb_account_id');
      res.clearCookie('dvyb_twitter_handle');
      
      return res.json({
        success: true,
        data: {
          authenticated: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Check if onboarding is complete
    const onboardingComplete = await DvybAuthService.isOnboardingComplete(accountIdNum);

    logger.info(`📊 DVYB Auth Status: Account ${accountId} authenticated, onboarding complete: ${onboardingComplete}`);
    
    return res.json({
      success: true,
      data: {
        authenticated: true,
        accountId: accountIdNum,
        hasValidTwitterConnection: hasValidConnection,
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
    res.clearCookie('dvyb_twitter_handle');

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

export default router;

