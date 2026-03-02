import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { DvybAuthService } from '../services/DvybAuthService';
import { DvybGoogleAuthService } from '../services/DvybGoogleAuthService';
import { addLeadToSignupsCampaign } from '../services/InstantlyService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

// Store OAuth states temporarily (in production, use Redis)
const oauthStates = new Map<string, { codeVerifier: string; accountId?: number; timestamp: number; signInOnly?: boolean }>();

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
router.get('/twitter/connect', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { oauthUrl, state, codeVerifier } = await DvybAuthService.generateTwitterOAuthUrl();

    // Store state, code verifier, AND accountId
    oauthStates.set(state, {
      codeVerifier,
      accountId, // Store accountId for callback
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

    // Retrieve code verifier and accountId from stored state
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state',
        timestamp: new Date().toISOString(),
      });
    }

    const { codeVerifier, accountId } = stateData as any;
    
    if (!accountId) {
      logger.error('❌ No accountId in stored state for Twitter callback');
      return res.status(400).json({
        success: false,
        error: 'Invalid state data',
        timestamp: new Date().toISOString(),
      });
    }
    
    oauthStates.delete(state); // Clean up

    logger.info(`🔄 Connecting Twitter to account ${accountId} from popup callback`);

    // Connect Twitter to existing account
    await DvybAuthService.connectTwitterToAccount(
      accountId,
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
 * Query param: sign_in_only=true - only allow existing users, don't create new accounts
 */
router.get('/google/login', async (req: Request, res: Response) => {
  try {
    const signInOnly = req.query.sign_in_only === 'true';
    const { oauthUrl, state } = await DvybGoogleAuthService.generateGoogleOAuthUrl();

    // Store state for validation (include signInOnly for callback)
    oauthStates.set(state, {
      codeVerifier: '', // Google doesn't use PKCE code verifier
      timestamp: Date.now(),
      ...(signInOnly ? { signInOnly: true } : {}),
    });

    logger.info(`✅ DVYB Google login initiated${signInOnly ? ' (sign-in only, existing users)' : ''}`);

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
    logger.info('📥 DVYB Google callback received');
    logger.info(`   - Request body keys: ${Object.keys(req.body || {}).join(', ')}`);
    
    const { code, state, initial_acquisition_flow } = req.body;

    logger.info(`   - code: ${code ? code.substring(0, 20) + '...' : 'MISSING'}`);
    logger.info(`   - state: ${state || 'MISSING'}`);
    logger.info(`   - initial_acquisition_flow: ${initial_acquisition_flow || 'not provided'}`);

    if (!code || !state) {
      logger.warn('❌ Missing code or state in callback');
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify state
    logger.info(`🔍 Checking state in oauthStates map (${oauthStates.size} entries)`);
    const stateData = oauthStates.get(state);
    if (!stateData) {
      logger.warn(`❌ State not found in oauthStates map: ${state}`);
      logger.warn(`   Available states: ${Array.from(oauthStates.keys()).join(', ') || 'none'}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('✅ State verified successfully');
    const signInOnly = (stateData as any).signInOnly === true;
    oauthStates.delete(state); // Clean up

    // Handle callback
    logger.info(`🔄 Calling DvybGoogleAuthService.handleGoogleCallback... (signInOnly: ${signInOnly})`);
    let account;
    let isNewAccount;
    let onboardingComplete;
    try {
      const result = await DvybGoogleAuthService.handleGoogleCallback(
        code,
        state,
        initial_acquisition_flow as 'website_analysis' | 'product_photoshot' | 'chrome_extension' | undefined,
        signInOnly
      );
      account = result.account;
      isNewAccount = result.isNewAccount;
      onboardingComplete = result.onboardingComplete;
    } catch (callbackError: any) {
      if (callbackError?.code === 'ACCOUNT_NOT_FOUND') {
        logger.info('⚠️ Sign-in-only: Account not found, returning 403');
        return res.status(403).json({
          success: false,
          error: callbackError.message || 'Account not found. Please sign up first.',
          error_code: 'ACCOUNT_NOT_FOUND',
          timestamp: new Date().toISOString(),
        });
      }
      throw callbackError;
    }
    
    logger.info(`✅ Google callback handled - Account ID: ${account.id}, isNew: ${isNewAccount}`);

    // First-time login only: add lead to Instantly Signups campaign (fire-and-forget)
    if (isNewAccount && account.primaryEmail) {
      const name = (account.accountName || '').trim();
      const space = name.indexOf(' ');
      const firstName = space > 0 ? name.slice(0, space) : name || undefined;
      const lastName = space > 0 ? name.slice(space + 1).trim() || undefined : undefined;
      addLeadToSignupsCampaign({
        email: account.primaryEmail,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
      }).catch((err) => logger.warn('Instantly add lead (first-time signup):', err));
    }

    // Set authentication cookie
    const cookieOptions = {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
    logger.info(`🍪 Setting cookie with options: ${JSON.stringify(cookieOptions)}`);
    res.cookie('dvyb_account_id', account.id.toString(), cookieOptions);

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
  } catch (error: any) {
    logger.error('❌ DVYB Google callback error:', error);
    logger.error(`   - Error message: ${error?.message}`);
    logger.error(`   - Error stack: ${error?.stack}`);
    return res.status(500).json({
      success: false,
      error: 'Google authentication failed',
      details: process.env.NODE_ENV !== 'production' ? error?.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/auth/status
 * Check authentication status
 * Supports both cookies (primary) and X-DVYB-Account-ID header (fallback for Safari/ITP)
 */
router.get('/status', async (req: DvybAuthRequest, res: Response) => {
  try {
    // Check for account ID in cookies first, then fall back to header for Safari/ITP
    const accountIdFromCookie = req.cookies?.dvyb_account_id;
    const accountIdFromHeader = req.headers['x-dvyb-account-id'] as string;
    const accountId = accountIdFromCookie || accountIdFromHeader;

    if (!accountId) {
      logger.info('📊 DVYB Auth Status: No account ID in cookies or headers');
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
      
      // Clear invalid cookies - account was deleted (use same options as when cookie was set)
      res.clearCookie('dvyb_account_id', {
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });
      
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

    // Get user info for Mixpanel tracking
    const userInfo = await DvybGoogleAuthService.getUserInfo(accountIdNum);

    const authSource = accountIdFromCookie ? 'cookie' : 'header';
    logger.info(`📊 DVYB Auth Status: Account ${accountId} authenticated (via ${authSource}), onboarding: ${onboardingComplete}, Google: ${hasValidGoogleConnection ? 'valid' : 'expired'}, Twitter: ${hasValidTwitterConnection ? 'connected' : 'not connected'}`);
    
    return res.json({
      success: true,
      data: {
        authenticated: true, // ✅ User is authenticated if account exists
        accountId: accountIdNum,
        accountExists: true,
        hasValidGoogleConnection,
        hasValidTwitterConnection,
        onboardingComplete,
        // User info for Mixpanel tracking
        email: userInfo.email,
        name: userInfo.name,
        accountName: userInfo.accountName,
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

    // Clear cookies with same options as when they were set
    res.clearCookie('dvyb_account_id', {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

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

