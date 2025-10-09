/**
 * OAuth 1.0a Authentication Routes for Twitter Video Uploads
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { User } from '../models/User';
import { 
  getRequestToken, 
  getAuthorizationUrl, 
  getAccessToken,
  OAuth1RequestTokens,
  OAuth1Tokens
} from '../utils/oauth1Utils';

const router = Router();

// Temporary storage for request tokens (in production, use Redis or database)
const requestTokenStore = new Map<string, { 
  requestToken: string; 
  requestTokenSecret: string; 
  userId: number;
  expiresAt: Date;
}>();

/**
 * Step 1: Initialize OAuth 1.0a flow
 * POST /api/auth/twitter/oauth1/init
 */
router.post('/init', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId: walletAddress } = req.body;

    if (!walletAddress) {
      res.status(400).json({ 
        success: false, 
        error: 'Wallet address is required' 
      });
      return;
    }

    // Find user by wallet address
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });
    
    if (!user) {
      res.status(404).json({ 
        success: false, 
        error: 'User not found for wallet address' 
      });
      return;
    }

    const userId = user.id;

    // Get request token from Twitter with callback URL
    const callbackUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3004'}/oauth1-twitter-callback`;
    const { requestToken, requestTokenSecret } = await getRequestToken(callbackUrl);

    // Store request token temporarily (expires in 15 minutes)
    const sessionId = `${userId}_${Date.now()}`;
    requestTokenStore.set(sessionId, {
      requestToken,
      requestTokenSecret,
      userId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });

    // Generate authorization URL - we'll handle the redirect in our callback page
    // Generate authorization URL with callback
    const authUrl = getAuthorizationUrl(requestToken, callbackUrl);

    res.json({
      success: true,
      data: {
        sessionId,
        authUrl,
        requestToken,
        requestTokenSecret
      }
    });

  } catch (error: any) {
    console.error('❌ OAuth 1.0a init error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initialize OAuth 1.0a flow',
      details: error.message
    });
  }
});

/**
 * Step 2: Complete OAuth 1.0a flow with PIN
 * POST /api/auth/twitter/oauth1/callback
 */
router.post('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, oauthToken, oauthVerifier } = req.body;

    if (!sessionId || !oauthToken || !oauthVerifier) {
      res.status(400).json({ 
        success: false, 
        error: 'Session ID, OAuth token, and verifier are required' 
      });
      return;
    }

    // Retrieve stored request token data
    const tokenData = requestTokenStore.get(sessionId);
    if (!tokenData) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired session' 
      });
      return;
    }

    const { requestTokenSecret, userId } = tokenData;

    // Find user by ID from session
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { id: userId } 
    });
    
    if (!user) {
      res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
      return;
    }

    // Exchange request token for access token
    const { accessToken, accessTokenSecret, screenName } = await getAccessToken(
      oauthToken,
      requestTokenSecret,
      oauthVerifier
    );

    // Save OAuth 1.0a tokens to database
    const connectionRepository = AppDataSource.getRepository(YapperTwitterConnection);
    
    // Find existing connection for this user
    let connection = await connectionRepository.findOne({
      where: { userId: userId }
    });

    if (connection) {
      // Update existing connection with OAuth 1.0a tokens
      connection.oauth1AccessToken = accessToken;
      connection.oauth1AccessTokenSecret = accessTokenSecret;
      connection.oauth1Connected = true;
      // Set OAuth 1.0a token expiration to 1 day from now (for security/refresh purposes)
      connection.oauth1TokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else {
      // This shouldn't happen in normal flow, but handle it gracefully
      res.status(400).json({ 
        success: false, 
        error: 'No existing Twitter connection found. Please connect with OAuth 2.0 first.' 
      });
      return;
    }

    await connectionRepository.save(connection);

    // Clean up session data
    requestTokenStore.delete(sessionId);

    // OAuth 1.0a flow completed successfully

    // Return connection capabilities
    const capabilities = connection.getConnectionCapabilities();

    res.json({
      success: true,
      data: {
        screenName,
        capabilities,
        message: 'OAuth 1.0a connection successful! Video uploads are now enabled.'
      }
    });

  } catch (error: any) {
    console.error('❌ OAuth 1.0a callback error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to complete OAuth 1.0a flow',
      details: error.message
    });
  }
});

/**
 * Get OAuth 1.0a connection status for a user
 * GET /api/auth/twitter/oauth1/status/:userId
 */
router.get('/status/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ 
        success: false, 
        error: 'User ID is required' 
      });
      return;
    }

    const connectionRepository = AppDataSource.getRepository(YapperTwitterConnection);
    const connection = await connectionRepository.findOne({
      where: { userId: parseInt(userId) }
    });

    if (!connection) {
      res.json({
        success: true,
        data: {
          connected: false,
          capabilities: {
            canTweet: false,
            canUploadImages: false,
            canUploadVideos: false,
            needsReconnection: true,
            oauth2Status: 'missing',
            oauth1Status: 'missing'
          }
        }
      });
      return;
    }

    const capabilities = connection.getConnectionCapabilities();

    res.json({
      success: true,
      data: {
        connected: connection.isConnected,
        oauth1Connected: connection.oauth1Connected,
        capabilities
      }
    });

  } catch (error: any) {
    console.error('❌ OAuth 1.0a status error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get OAuth 1.0a status',
      details: error.message
    });
  }
});

/**
 * Disconnect OAuth 1.0a (remove video upload capability)
 * DELETE /api/auth/twitter/oauth1/disconnect/:userId
 */
router.delete('/disconnect/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ 
        success: false, 
        error: 'User ID is required' 
      });
      return;
    }

    const connectionRepository = AppDataSource.getRepository(YapperTwitterConnection);
    const connection = await connectionRepository.findOne({
      where: { userId: parseInt(userId) }
    });

    if (!connection) {
      res.status(404).json({ 
        success: false, 
        error: 'Twitter connection not found' 
      });
      return;
    }

    // Remove OAuth 1.0a tokens
    connection.oauth1AccessToken = null;
    connection.oauth1AccessTokenSecret = null;
    connection.oauth1Connected = false;
    connection.oauth1TokenExpiresAt = null;

    await connectionRepository.save(connection);

    const capabilities = connection.getConnectionCapabilities();

    res.json({
      success: true,
      data: {
        message: 'OAuth 1.0a disconnected. Video uploads are no longer available.',
        capabilities
      }
    });

  } catch (error: any) {
    console.error('❌ OAuth 1.0a disconnect error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to disconnect OAuth 1.0a',
      details: error.message
    });
  }
});

// Cleanup expired request tokens (run periodically)
setInterval(() => {
  const now = new Date();
  for (const [sessionId, tokenData] of requestTokenStore.entries()) {
    if (now > tokenData.expiresAt) {
      requestTokenStore.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

export default router;
