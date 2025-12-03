import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { AppDataSource } from '../config/database';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { exchangeOAuthToken, getRequestToken } from '../utils/oauth1Utils';
import { env } from '../config/env';
import { DvybTwitterTokenService } from '../services/DvybTwitterTokenService';

const router = Router();

// In-memory store for OAuth1 state
// In production, use Redis or database
const oauth1States = new Map<string, { accountId: number; timestamp: number }>();

// Cleanup old states every 10 minutes
setInterval(() => {
  const now = Date.now();
  const expiry = 10 * 60 * 1000; // 10 minutes
  
  for (const [state, data] of oauth1States.entries()) {
    if (now - data.timestamp > expiry) {
      oauth1States.delete(state);
    }
  }
}, 10 * 60 * 1000);

/**
 * GET /api/dvyb/auth/oauth1/initiate
 * Initiate OAuth1 flow for video uploads
 */
router.get('/initiate', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    
    // Generate state for security
    const state = crypto.randomBytes(16).toString('hex');
    oauth1States.set(state, { accountId, timestamp: Date.now() });
    
    // Get request token from Twitter
    // OAuth1 callback URL - must point to FRONTEND callback page
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const callbackUrl = `${frontendUrl}/auth/twitter/oauth1/callback`;
    logger.info(`🔗 OAuth1 callback URL: ${callbackUrl}`);
    const { oauthToken, oauthTokenSecret } = await getRequestToken(callbackUrl);
    
    // Store token secret temporarily (needed for token exchange)
    oauth1States.set(`${state}_secret`, { 
      accountId, 
      timestamp: Date.now()
    });
    oauth1States.set(`${state}_token_secret`, {
      accountId,
      timestamp: Date.now()
    });
    // Store the actual token secret value for callback
    oauth1States.set(`${state}_token_secret_value`, {
      accountId,
      oauthTokenSecret,
      timestamp: Date.now()
    } as any);
    
    // Build authorization URL
    // Note: oauth_callback in authUrl is for display purposes; the actual callback is already in the request token
    const authUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}&state=${state}`;
    
    logger.info(`🔑 OAuth1 flow initiated for DVYB account ${accountId}`);
    logger.info(`   Request Token: ${oauthToken.substring(0, 15)}...`);
    logger.info(`   Request Token Secret: ${oauthTokenSecret.substring(0, 15)}...`);
    logger.info(`   State: ${state}`);
    logger.info(`   Auth URL: ${authUrl.substring(0, 100)}...`);
    
    return res.json({
      success: true,
      data: {
        authUrl,
        state,
        oauthToken,
        oauthTokenSecret, // Return to frontend to store temporarily
      },
    });
  } catch (error: any) {
    // Avoid circular structure error by logging only the message
    logger.error(`❌ OAuth1 initiation error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate OAuth1 flow',
    });
  }
});

/**
 * POST /api/dvyb/auth/oauth1/callback
 * Handle OAuth1 callback from frontend (receives oauth_token, oauth_verifier from frontend)
 * NOTE: Does NOT use dvybAuthMiddleware because cookies may not be sent from popup
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    // Frontend sends snake_case parameters
    const { oauth_token, oauth_verifier, state, oauth_token_secret } = req.body;
    
    logger.info(`📥 OAuth1 callback received from frontend`);
    logger.info(`   oauth_token: ${oauth_token?.substring(0, 15)}...`);
    logger.info(`   oauth_verifier: ${oauth_verifier?.substring(0, 15)}...`);
    logger.info(`   oauth_token_secret: ${oauth_token_secret?.substring(0, 15)}...`);
    logger.info(`   state: ${state?.substring(0, 15)}...`);
    
    if (!oauth_token || !oauth_verifier || !state || !oauth_token_secret) {
      logger.error('❌ Missing OAuth1 callback parameters', { 
        has_oauth_token: !!oauth_token,
        has_oauth_verifier: !!oauth_verifier,
        has_state: !!state,
        has_oauth_token_secret: !!oauth_token_secret
      });
      return res.status(400).json({
        success: false,
        error: 'Missing OAuth parameters',
      });
    }
    
    // Verify state and get accountId from stored state
    const storedState = oauth1States.get(state);
    if (!storedState) {
      logger.error('❌ Invalid or expired state', {
        state,
        stored_exists: false
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state parameter',
      });
    }
    
    const accountId = storedState.accountId;
    logger.info(`   accountId from state: ${accountId}`);
    
    // Exchange request token for access token
    logger.info('🔄 Exchanging OAuth1 request token for access token...');
    const { accessToken, accessTokenSecret, screenName } = await exchangeOAuthToken(
      oauth_token,
      oauth_token_secret,
      oauth_verifier
    );
    
    logger.info(`✅ Got OAuth1 access tokens for @${screenName}`);
    
    // Update Twitter connection with OAuth1 tokens
    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { accountId, isActive: true },
    });
    
    if (!connection) {
      logger.error(`❌ Twitter connection not found for account ${accountId}`);
      return res.status(404).json({
        success: false,
        error: 'Twitter connection not found. Please connect Twitter OAuth2 first.',
      });
    }
    
    // Save OAuth1 tokens
    connection.oauth1Token = accessToken;
    connection.oauth1TokenSecret = accessTokenSecret;
    connection.oauth1ExpiresAt = null; // OAuth1 tokens don't expire
    
    await connectionRepo.save(connection);
    
    // Cleanup state
    oauth1States.delete(state);
    oauth1States.delete(`${state}_secret`);
    oauth1States.delete(`${state}_token_secret`);
    oauth1States.delete(`${state}_token_secret_value`);
    
    logger.info(`✅ OAuth1 tokens saved for DVYB account ${accountId} (@${screenName})`);
    
    return res.json({
      success: true,
      data: {
        message: 'OAuth1 authorization successful',
        screenName,
      },
    });
  } catch (error: any) {
    // Avoid circular structure error by logging only the message
    logger.error(`❌ OAuth1 callback error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to complete OAuth1 flow',
    });
  }
});

/**
 * GET /api/dvyb/auth/oauth1/status
 * Check if OAuth1 tokens are available and valid
 */
router.get('/status', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    
    // Validate tokens using token service
    const tokenValidation = await DvybTwitterTokenService.validateTokens(accountId);
    
    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { accountId, isActive: true },
    });
    
    if (!connection) {
      return res.json({
        success: true,
        data: {
          hasOAuth1: false,
          oauth1Valid: false,
          oauth2Valid: false,
          message: 'Twitter not connected',
        },
      });
    }
    
    const hasOAuth1 = !!(connection.oauth1Token && connection.oauth1TokenSecret);
    
    return res.json({
      success: true,
      data: {
        hasOAuth1,
        oauth1Valid: tokenValidation.oauth1Valid,
        oauth2Valid: tokenValidation.oauth2Valid,
        twitterHandle: connection.twitterHandle,
        message: tokenValidation.oauth1Valid 
          ? 'OAuth1 tokens valid and available' 
          : hasOAuth1
          ? 'OAuth1 tokens found but invalid/expired'
          : 'OAuth1 tokens not found',
      },
    });
  } catch (error: any) {
    // Avoid circular structure error by logging only the message
    logger.error(`❌ OAuth1 status check error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check OAuth1 status',
    });
  }
});

export default router;

