import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User, UserRoleType } from '../models/User';
import { TwitterUserConnection } from '../models/TwitterUserConnection';
import { logger } from '../config/logger';
import { Repository } from 'typeorm';
import crypto from 'crypto';

const router = Router();

// Twitter OAuth 2.0 configuration
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const TWITTER_REDIRECT_URI = process.env.TWITTER_REDIRECT_URI || 'http://localhost:3000/twitter-callback';

// Simple in-memory cache to prevent duplicate authorization code processing
const processedCodes = new Map<string, { timestamp: number, wallet: string }>();

// Clean up old entries every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  for (const [code, data] of processedCodes.entries()) {
    if (data.timestamp < tenMinutesAgo) {
      processedCodes.delete(code);
    }
  }
}, 10 * 60 * 1000);

// Type definitions for Twitter API responses
interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TwitterUserData {
  data: {
    id: string;
    name: string;
    username: string;
    profile_image_url?: string;
    public_metrics?: {
      followers_count: number;
      following_count: number;
      tweet_count: number;
      listed_count: number;
    };
  };
  error?: string;
  error_description?: string;
}

/**
 * @route POST /api/twitter-auth/twitter/url
 * @desc Generate Twitter OAuth URL for mining interface
 */
router.post('/twitter/url', async (req: Request, res: Response) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    // Generate state parameter for security
    const state = crypto.randomBytes(32).toString('hex');
    
    // Generate code challenge for PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const oauthUrl = new URL('https://twitter.com/i/oauth2/authorize');
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('client_id', TWITTER_CLIENT_ID);
    oauthUrl.searchParams.set('redirect_uri', TWITTER_REDIRECT_URI);
    oauthUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
    oauthUrl.searchParams.set('state', state);
    oauthUrl.searchParams.set('code_challenge', codeChallenge);
    oauthUrl.searchParams.set('code_challenge_method', 'S256');

    logger.info(`🔗 Generated Twitter OAuth URL for wallet: ${wallet_address}`);

    return res.json({
      success: true,
      data: {
        oauth_url: oauthUrl.toString(),
        state,
        code_verifier: codeVerifier,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    logger.error('❌ Failed to generate Twitter OAuth URL:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate OAuth URL',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/twitter-auth/exchange-code
 * Exchange authorization code for tokens and save user connection
 */
router.post('/exchange-code', async (req: Request, res: Response) => {
  try {
    const { code, walletAddress, codeVerifier, state } = req.body;

    if (!code || !walletAddress || !codeVerifier) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, walletAddress, codeVerifier'
      });
    }

    logger.info(`🔄 Exchanging code for tokens for wallet: ${walletAddress}`);

    // Check for duplicate code processing
    if (processedCodes.has(code)) {
      logger.warn(`⚠️ Authorization code already processed for wallet: ${walletAddress}`);
      
      // Check if user already has a Twitter connection
      const userRepository: Repository<User> = AppDataSource.getRepository(User);
      const existingUser = await userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() }
      });

      if (existingUser && existingUser.twitterHandle) {
        logger.info(`✅ User already has Twitter connection: ${existingUser.twitterHandle}`);
        return res.status(200).json({
          success: true,
          message: 'Twitter account already connected',
          data: {
            user: {
              walletAddress: existingUser.walletAddress,
              twitterHandle: existingUser.twitterHandle,
              twitterUserId: existingUser.twitterUserId
            }
          }
        });
      }
      
      // If no connection exists, this is a real duplicate code issue
      return res.status(400).json({
        success: false,
        error: 'This authorization code has already been processed'
      });
    }

    // Mark code as being processed
    processedCodes.set(code, { timestamp: Date.now(), wallet: walletAddress });

    // Exchange authorization code for access token
    const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
    const tokenData = {
      grant_type: 'authorization_code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: TWITTER_REDIRECT_URI,
      code: code,
      code_verifier: codeVerifier
    };

    // Create Basic Authentication header (required by Twitter)
    const authHeader = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    logger.info(`📤 Making token exchange request to Twitter...`);
    logger.info(`🔧 Using redirect URI: ${TWITTER_REDIRECT_URI}`);

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`, // FIXED: Added required auth header
        'User-Agent': 'BurnieAI/1.0'
      },
      body: new URLSearchParams(tokenData)
    });

    logger.info(`📨 Twitter token response status: ${tokenResponse.status}`);

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(`❌ Token exchange failed: ${tokenResponse.status}`, errorData);
      logger.error(`🔧 Full error response:`, errorData);
      return res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code',
        details: errorData
      });
    }

    const tokenResult = await tokenResponse.json() as TwitterTokenResponse;
    logger.info(`✅ Received access token for wallet: ${walletAddress}`);

    // Fetch user data from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${tokenResult.access_token}`,
        'User-Agent': 'BurnieAI/1.0'
      }
    });

    if (!userResponse.ok) {
      logger.error(`❌ Failed to fetch user data: ${userResponse.status}`);
      return res.status(400).json({
        success: false,
        error: 'Failed to fetch user data from Twitter'
      });
    }

    const userData = await userResponse.json() as TwitterUserData;
    const twitterUser = userData.data;

    // Find or create user by wallet address
    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      user = new User();
      user.walletAddress = walletAddress.toLowerCase();
      user.username = twitterUser.username;
      user = await userRepository.save(user);
      logger.info(`👤 Created new user for wallet: ${walletAddress}`);
    }

    // Check if this Twitter account is already connected to ANY user
    const twitterConnectionRepository = AppDataSource.getRepository(TwitterUserConnection);
    const existingConnection = await twitterConnectionRepository.findOne({
      where: { twitterUserId: twitterUser.id }
    });

    if (existingConnection && existingConnection.userId !== user.id) {
      // Twitter account connected to different user - UPDATE to current user
      logger.info(`🔄 Switching Twitter account @${twitterUser.username} from user ${existingConnection.userId} to user ${user.id}`);
      
      // Deactivate old connection
      existingConnection.isConnected = false;
      await twitterConnectionRepository.save(existingConnection);
      
      // Create new connection for current user
      const newConnection = new TwitterUserConnection();
      newConnection.userId = user.id;
      newConnection.twitterUserId = twitterUser.id;
      newConnection.twitterUsername = twitterUser.username;
      newConnection.twitterDisplayName = twitterUser.name;
      newConnection.accessToken = tokenResult.access_token;
      newConnection.refreshToken = tokenResult.refresh_token || null;
      newConnection.isConnected = true;
      
      await twitterConnectionRepository.save(newConnection);
      
    } else if (existingConnection && existingConnection.userId === user.id) {
      // Same user, same Twitter account - UPDATE tokens
      logger.info(`🔄 Refreshing tokens for existing connection @${twitterUser.username}`);
      
      existingConnection.accessToken = tokenResult.access_token;
      existingConnection.refreshToken = tokenResult.refresh_token || null;
      existingConnection.isConnected = true;
      
      await twitterConnectionRepository.save(existingConnection);

      // Trigger Twitter data processing for reconnected creators/miners
      logger.info(`🔄 Triggering Twitter data processing for reconnected creator/miner @${twitterUser.username}`);
      try {
        const { TwitterLearningService } = await import('../services/TwitterLearningService');
        const twitterLearningService = new TwitterLearningService();
        
        // Process Twitter data in background
        twitterLearningService.processUserTwitterData(user).then(result => {
          if (result.success) {
            logger.info(`✅ Twitter data processed for reconnected creator @${twitterUser.username}: ${result.tweetsProcessed} tweets`);
          } else {
            logger.warn(`⚠️ Twitter data processing failed for reconnected creator @${twitterUser.username}: ${result.error}`);
          }
        }).catch(error => {
          logger.error(`❌ Twitter data processing error for reconnected creator @${twitterUser.username}:`, error);
        });
      } catch (error) {
        logger.error(`❌ Error triggering Twitter data processing for @${twitterUser.username}:`, error);
      }
      
    } else {
      // New Twitter connection for this user
      logger.info(`✨ Creating new Twitter connection for @${twitterUser.username}`);
      
      const newConnection = new TwitterUserConnection();
      newConnection.userId = user.id;
      newConnection.twitterUserId = twitterUser.id;
      newConnection.twitterUsername = twitterUser.username;
      newConnection.twitterDisplayName = twitterUser.name;
      newConnection.accessToken = tokenResult.access_token;
      newConnection.refreshToken = tokenResult.refresh_token || null;
      newConnection.isConnected = true;
      
      await twitterConnectionRepository.save(newConnection);

      // Trigger Twitter data processing for new creators/miners
      logger.info(`🔄 Triggering Twitter data processing for new creator/miner @${twitterUser.username}`);
      try {
        const { TwitterLearningService } = await import('../services/TwitterLearningService');
        const twitterLearningService = new TwitterLearningService();
        
        // Process Twitter data in background
        twitterLearningService.processUserTwitterData(user).then(result => {
          if (result.success) {
            logger.info(`✅ Twitter data processed for new creator @${twitterUser.username}: ${result.tweetsProcessed} tweets`);
          } else {
            logger.warn(`⚠️ Twitter data processing failed for new creator @${twitterUser.username}: ${result.error}`);
          }
        }).catch(error => {
          logger.error(`❌ Twitter data processing error for new creator @${twitterUser.username}:`, error);
        });
      } catch (error) {
        logger.error(`❌ Error triggering Twitter data processing for @${twitterUser.username}:`, error);
      }
    }

    // Update user's Twitter info
    user.twitterHandle = `@${twitterUser.username}`;
    user.twitterUserId = twitterUser.id;
    await userRepository.save(user);

    logger.info(`✅ Twitter connection successful for wallet ${walletAddress} -> @${twitterUser.username}`);

    return res.json({
      success: true,
      message: 'Twitter account connected successfully',
      data: {
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          username: user.username,
          twitterHandle: user.twitterHandle
        },
        twitter: {
          username: twitterUser.username,
          name: twitterUser.name,
          id: twitterUser.id
        }
      }
    });

  } catch (error) {
    logger.error('❌ Error in Twitter OAuth exchange:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during Twitter authentication'
    });
  }
});

/**
 * @route POST /api/twitter-auth/refresh-token
 * @desc Refresh Twitter access token using refresh token
 */
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🔄 Manual token refresh request for wallet: ${wallet_address}`);

    // Find user by wallet address
    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: wallet_address.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Find Twitter connection
    const twitterConnectionRepository: Repository<TwitterUserConnection> = AppDataSource.getRepository(TwitterUserConnection);
    const twitterConnection = await twitterConnectionRepository.findOne({
      where: { userId: user.id, isConnected: true }
    });

    if (!twitterConnection) {
      return res.status(404).json({
        success: false,
        error: 'No active Twitter connection found',
        timestamp: new Date().toISOString(),
      });
    }

    if (!twitterConnection.refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'No refresh token available',
        timestamp: new Date().toISOString(),
      });
    }

    // Refresh the token
    const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
    const tokenData = {
      grant_type: 'refresh_token',
      refresh_token: twitterConnection.refreshToken,
      client_id: TWITTER_CLIENT_ID
    };

    const authHeader = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    logger.info(`📤 Making token refresh request to Twitter...`);

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`,
        'User-Agent': 'BurnieAI/1.0'
      },
      body: new URLSearchParams(tokenData)
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(`❌ Token refresh failed: ${tokenResponse.status}`, errorData);
      
      // If refresh token is invalid, mark connection as disconnected
      if (tokenResponse.status === 400 || tokenResponse.status === 401) {
        logger.error(`🔑 Refresh token invalid for user ${user.id} - marking as disconnected`);
        twitterConnection.isConnected = false;
        await twitterConnectionRepository.save(twitterConnection);
        
        return res.status(401).json({
          success: false,
          error: 'Refresh token expired. Please reconnect your Twitter account.',
          requires_reconnection: true,
          timestamp: new Date().toISOString(),
        });
      }
      
      return res.status(400).json({
        success: false,
        error: 'Failed to refresh token',
        details: errorData,
        timestamp: new Date().toISOString(),
      });
    }

    const tokenResult = await tokenResponse.json() as TwitterTokenResponse;
    logger.info(`✅ Successfully refreshed access token for user ${user.id}`);

    // Update the connection with new tokens
    twitterConnection.accessToken = tokenResult.access_token;
    if (tokenResult.refresh_token) {
      twitterConnection.refreshToken = tokenResult.refresh_token;
    }
    twitterConnection.lastSyncAt = new Date();

    await twitterConnectionRepository.save(twitterConnection);

    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        user: {
          walletAddress: user.walletAddress,
          twitterHandle: user.twitterHandle,
          twitterUserId: user.twitterUserId
        },
        token_refreshed_at: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    logger.error('❌ Error refreshing Twitter token:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh Twitter token',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/twitter-auth/twitter/status/:walletAddress
 * @desc Check Twitter connection status for a wallet
 */
router.get('/twitter/status/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const twitterRepository: Repository<TwitterUserConnection> = AppDataSource.getRepository(TwitterUserConnection);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({
        success: true,
        data: { connected: false },
        timestamp: new Date().toISOString(),
      });
    }

    const twitterData = await twitterRepository.findOne({
      where: { userId: user.id }
    });

    if (!twitterData || !twitterData.isConnected) {
      return res.json({
        success: true,
        data: { connected: false },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        connected: true,
        twitter_username: twitterData.twitterUsername,
        twitter_display_name: twitterData.twitterDisplayName,
        profile_image_url: twitterData.profileImageUrl,
        last_sync: twitterData.lastSyncAt
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to check Twitter status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check Twitter status',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/twitter-auth/test-refresh/:walletAddress
 * @desc Test endpoint to manually trigger token refresh for debugging
 */
router.post('/test-refresh/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🧪 Test token refresh for wallet: ${walletAddress}`);

    // Find user by wallet address
    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Find Twitter connection (including disconnected ones for testing)
    const twitterConnectionRepository: Repository<TwitterUserConnection> = AppDataSource.getRepository(TwitterUserConnection);
    const twitterConnection = await twitterConnectionRepository.findOne({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' }  // Get the most recent connection
    });

    if (!twitterConnection) {
      return res.status(404).json({
        success: false,
        error: 'No Twitter connection found',
        timestamp: new Date().toISOString(),
      });
    }

    // Test the refresh flow using TwitterLearningService
    const { TwitterLearningService } = await import('../services/TwitterLearningService');
    const twitterService = new TwitterLearningService();
    
    // Access the private method via reflection for testing
    const refreshMethod = (twitterService as any).refreshTwitterToken.bind(twitterService);
    
    logger.info(`🔧 Before refresh - Access token: ...${twitterConnection.accessToken.slice(-10)}`);
    
    const refreshResult = await refreshMethod(twitterConnection);
    
    if (refreshResult) {
      logger.info(`🔧 After refresh - Access token: ...${refreshResult.accessToken.slice(-10)}`);
      
      return res.json({
        success: true,
        message: 'Token refresh test completed successfully',
        data: {
          oldTokenLastChars: `...${twitterConnection.accessToken.slice(-10)}`,
          newTokenLastChars: `...${refreshResult.accessToken.slice(-10)}`,
          tokensChanged: twitterConnection.accessToken !== refreshResult.accessToken,
          refreshTokenUpdated: refreshResult.refreshToken ? true : false,
          lastSyncAt: refreshResult.lastSyncAt
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Token refresh failed',
        message: 'Check server logs for detailed error information',
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error: any) {
    logger.error('❌ Error in token refresh test:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to test token refresh',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/twitter-auth/debug/:walletAddress
 * @desc Debug endpoint to check Twitter connection status and token info
 */
router.get('/debug/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🔍 Debug Twitter connection for wallet: ${walletAddress}`);

    // Find user by wallet address
    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Find Twitter connection (including disconnected ones for debugging)
    const twitterConnectionRepository: Repository<TwitterUserConnection> = AppDataSource.getRepository(TwitterUserConnection);
    const twitterConnection = await twitterConnectionRepository.findOne({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' }  // Get the most recent connection
    });

    if (!twitterConnection) {
      return res.status(404).json({
        success: false,
        error: 'No Twitter connection found',
        data: {
          userId: user.id,
          walletAddress: user.walletAddress,
          twitterHandle: user.twitterHandle,
          connections: await twitterConnectionRepository.find({ where: { userId: user.id } })
        },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        userId: user.id,
        walletAddress: user.walletAddress,
        twitterHandle: user.twitterHandle,
        connection: {
          id: twitterConnection.id,
          twitterUserId: twitterConnection.twitterUserId,
          twitterUsername: twitterConnection.twitterUsername,
          isConnected: twitterConnection.isConnected,
          connectionStatus: twitterConnection.isConnected ? 'ACTIVE' : 'DISCONNECTED',
          accessTokenValid: twitterConnection.accessToken ? true : false,
          accessTokenLastChars: twitterConnection.accessToken ? `...${twitterConnection.accessToken.slice(-10)}` : 'NONE',
          refreshTokenAvailable: twitterConnection.refreshToken ? true : false,
          refreshTokenLastChars: twitterConnection.refreshToken ? `...${twitterConnection.refreshToken.slice(-10)}` : 'NONE',
          lastSyncAt: twitterConnection.lastSyncAt,
          createdAt: twitterConnection.createdAt,
          updatedAt: twitterConnection.updatedAt
        }
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    logger.error('❌ Error in Twitter debug:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to debug Twitter connection',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router; 