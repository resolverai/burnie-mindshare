import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User, UserRoleType } from '../models/User';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { logger } from '../config/logger';
import { Repository } from 'typeorm';
import crypto from 'crypto';
import { platformYapperTwitterService } from '../services/PlatformYapperTwitterService';

const router = Router();

// Twitter OAuth 2.0 configuration
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const TWITTER_REDIRECT_URI = process.env.YAPPER_TWITTER_REDIRECT_URI || 'http://localhost:3000/yapper-twitter-callback';

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
  expires_in?: number;
  scope?: string;
}

interface TwitterUserData {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

/**
 * POST /api/yapper-twitter-auth/twitter/url
 * Generate Twitter OAuth URL for Yappers
 */
router.post('/twitter/url', async (req: Request, res: Response) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'wallet_address is required',
        timestamp: new Date().toISOString(),
      });
    }

    if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Twitter OAuth credentials not configured',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🔗 Generating Twitter OAuth URL for Yapper wallet: ${wallet_address}`);

    // Generate state parameter for security
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Build OAuth URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: TWITTER_REDIRECT_URI,
      scope: 'tweet.read users.read follows.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

    logger.info(`✅ Generated Twitter OAuth URL for Yapper: ${wallet_address}`);

    return res.json({
      success: true,
      data: {
        oauth_url: authUrl,
        state,
        code_verifier: codeVerifier,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to generate Twitter OAuth URL for Yapper:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate OAuth URL',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/yapper-twitter-auth/exchange-code
 * Exchange authorization code for tokens and save Yapper connection
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

    // Check database connection before proceeding
    if (!AppDataSource.isInitialized) {
      logger.error('❌ Database not initialized for Yapper Twitter auth');
      return res.status(503).json({
        success: false,
        error: 'Database service unavailable. Please try again later.'
      });
    }

    logger.info(`🔄 Exchanging code for tokens for Yapper wallet: ${walletAddress}`);

    // Check for duplicate code processing
    if (processedCodes.has(code)) {
      logger.warn(`⚠️ Authorization code already processed for Yapper wallet: ${walletAddress}`);
      
      // Check if user already has a Yapper Twitter connection
      const userRepository: Repository<User> = AppDataSource.getRepository(User);
      const existingUser = await userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() }
      });

      if (existingUser) {
        const yapperTwitterRepository: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);
        const existingConnection = await yapperTwitterRepository.findOne({
          where: { userId: existingUser.id, isConnected: true }
        });

        if (existingConnection) {
          logger.info(`✅ Yapper already has Twitter connection: @${existingConnection.twitterUsername}`);
          return res.status(200).json({
            success: true,
            message: 'Twitter account already connected for Yapper',
            data: {
              user: {
                walletAddress: existingUser.walletAddress,
                twitterHandle: `@${existingConnection.twitterUsername}`,
                twitterUserId: existingConnection.twitterUserId
              }
            }
          });
        }
      }
      
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
      code,
      redirect_uri: TWITTER_REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: TWITTER_CLIENT_ID,
    };

    const authString = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authString}`,
      },
      body: new URLSearchParams(tokenData),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error(`❌ Twitter token exchange failed: ${tokenResponse.status} - ${errorText}`);
      return res.status(400).json({
        success: false,
        error: `Twitter authentication failed: ${tokenResponse.status}`,
      });
    }

    const tokenResult = await tokenResponse.json() as TwitterTokenResponse;
    logger.info(`✅ Token exchange successful for Yapper: ${walletAddress}`);

    // Get user data from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: {
        'Authorization': `Bearer ${tokenResult.access_token}`,
      },
    });

    if (!userResponse.ok) {
      logger.error(`❌ Failed to fetch Twitter user data: ${userResponse.status}`);
      return res.status(400).json({
        success: false,
        error: 'Failed to fetch Twitter user data',
      });
    }

    const userData = await userResponse.json() as { data: TwitterUserData };
    const twitterUser: TwitterUserData = userData.data;

    logger.info(`👤 Twitter user data for Yapper: @${twitterUser.username} (${twitterUser.name})`);

    // Check database connection again before saving (connection might have been lost during API calls)
    if (!AppDataSource.isInitialized) {
      logger.error('❌ Database connection lost during Yapper Twitter auth process');
      return res.status(503).json({
        success: false,
        error: 'Database connection lost. Please try again.'
      });
    }

    // Save to database
    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const yapperTwitterRepository: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

    // Find or create user
    let user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      user = new User();
      user.walletAddress = walletAddress.toLowerCase();
      user.roleType = UserRoleType.YAPPER;
      user = await userRepository.save(user);
      logger.info(`✨ Created new Yapper user: ${user.walletAddress}`);
    } else {
      // Update role to include Yapper if not already
      if (user.roleType === UserRoleType.MINER) {
        user.roleType = UserRoleType.BOTH;
      } else if (user.roleType !== UserRoleType.YAPPER && user.roleType !== UserRoleType.BOTH) {
        user.roleType = UserRoleType.YAPPER;
      }
      await userRepository.save(user);
    }

    // Check for existing Twitter connection for this specific Twitter account
    const existingConnection = await yapperTwitterRepository.findOne({
      where: { twitterUserId: twitterUser.id }
    });

    if (existingConnection && existingConnection.userId !== user.id) {
      logger.error(`❌ Twitter account @${twitterUser.username} already connected to another Yapper`);
      return res.status(400).json({
        success: false,
        error: 'This Twitter account is already connected to another Yapper account'
      });
    } else if (existingConnection && existingConnection.userId === user.id) {
      // Same user, same Twitter account - UPDATE tokens
      logger.info(`🔄 Refreshing tokens for existing Yapper connection @${twitterUser.username}`);
      
      existingConnection.accessToken = tokenResult.access_token;
      existingConnection.refreshToken = tokenResult.refresh_token || null;
      existingConnection.isConnected = true;
      existingConnection.profileImageUrl = twitterUser.profile_image_url || null;
      
      // Set token expiration (Twitter tokens typically expire in 2 hours)
      const expiresIn = tokenResult.expires_in || 7200; // Default to 2 hours if not provided
      existingConnection.tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000));
      
      const savedConnection = await yapperTwitterRepository.save(existingConnection);

      // Fetch Twitter data immediately after token refresh
      logger.info(`🔄 Fetching Twitter data for reconnected yapper @${twitterUser.username}`);
      platformYapperTwitterService.fetchYapperTwitterData(savedConnection).then(result => {
        if (result.success) {
          logger.info(`✅ Twitter data fetched for @${twitterUser.username}: ${result.tweets_collected} tweets`);
        } else {
          logger.warn(`⚠️ Twitter data fetch failed for @${twitterUser.username}: ${result.error}`);
        }
      }).catch(error => {
        logger.error(`❌ Twitter data fetch error for @${twitterUser.username}:`, error);
      });
      
    } else {
      // New Twitter connection for this Yapper
      logger.info(`✨ Creating new Yapper Twitter connection for @${twitterUser.username}`);
      
      const newConnection = new YapperTwitterConnection();
      newConnection.userId = user.id;
      newConnection.twitterUserId = twitterUser.id;
      newConnection.twitterUsername = twitterUser.username;
      newConnection.twitterDisplayName = twitterUser.name;
      newConnection.accessToken = tokenResult.access_token;
      newConnection.refreshToken = tokenResult.refresh_token || null;
      newConnection.isConnected = true;
      newConnection.profileImageUrl = twitterUser.profile_image_url || null;
      
      // Set token expiration (Twitter tokens typically expire in 2 hours)
      const expiresIn = tokenResult.expires_in || 7200; // Default to 2 hours if not provided
      newConnection.tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000));
      
      const savedNewConnection = await yapperTwitterRepository.save(newConnection);

      // Fetch Twitter data immediately after new connection
      logger.info(`🔄 Fetching Twitter data for new yapper connection @${twitterUser.username}`);
      platformYapperTwitterService.fetchYapperTwitterData(savedNewConnection).then(result => {
        if (result.success) {
          logger.info(`✅ Twitter data fetched for new yapper @${twitterUser.username}: ${result.tweets_collected} tweets`);
        } else {
          logger.warn(`⚠️ Twitter data fetch failed for new yapper @${twitterUser.username}: ${result.error}`);
        }
      }).catch(error => {
        logger.error(`❌ Twitter data fetch error for new yapper @${twitterUser.username}:`, error);
      });
    }

    logger.info(`✅ Yapper Twitter connection successful for wallet ${walletAddress} -> @${twitterUser.username}`);

    return res.json({
      success: true,
      message: 'Twitter account connected successfully for Yapper',
      data: {
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          roleType: user.roleType
        },
        twitter: {
          username: twitterUser.username,
          name: twitterUser.name,
          id: twitterUser.id,
          profile_image_url: twitterUser.profile_image_url
        }
      }
    });

  } catch (error) {
    logger.error('❌ Twitter OAuth exchange failed for Yapper:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during Twitter authentication',
    });
  }
});

/**
 * @route GET /api/yapper-twitter-auth/twitter/status/:walletAddress
 * @desc Check Twitter connection status for a Yapper wallet
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
    const yapperTwitterRepository: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

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

    // Find all Twitter connections for this user
    const allConnections = await yapperTwitterRepository.find({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' }
    });

    if (allConnections.length === 0) {
      return res.json({
        success: true,
        data: { 
          connected: false,
          has_previous_connection: false
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Prioritize active connections (with valid, non-null tokens) over disconnected ones
    const activeConnection = allConnections.find(conn => 
      conn.accessToken && 
      conn.accessToken !== null && 
      conn.refreshToken && 
      conn.refreshToken !== null &&
      conn.isConnected
    );

    // Use active connection if available, otherwise fall back to most recent
    const twitterData = activeConnection || allConnections[0];
    const hasPreviousConnection = allConnections.length > 0;

    // Handle case where no connection exists (shouldn't happen due to check above, but TypeScript safety)
    if (!twitterData) {
      return res.json({
        success: true,
        data: { 
          connected: false,
          has_previous_connection: false
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Determine connection and token status
    const tokenStatus = twitterData.getTokenStatus();
    const isConnected = twitterData.isConnected && tokenStatus === 'valid';

    return res.json({
      success: true,
      data: {
        connected: isConnected,
        has_previous_connection: hasPreviousConnection,
        token_status: tokenStatus, // 'valid', 'expired', 'missing'
        twitter_username: twitterData.twitterUsername,
        twitter_display_name: twitterData.twitterDisplayName,
        profile_image_url: twitterData.profileImageUrl,
        last_sync: twitterData.lastSyncAt,
        token_expires_at: twitterData.tokenExpiresAt,
        needs_reconnection: tokenStatus !== 'valid'
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to check Yapper Twitter status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check Twitter status',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/yapper-twitter-auth/disconnect/:walletAddress
 * @desc Disconnect Twitter account for a Yapper
 */
router.post('/disconnect/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
      });
    }

    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const yapperTwitterRepository: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Find active connection with valid tokens to disconnect
    const allConnections = await yapperTwitterRepository.find({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' }
    });

    const activeConnection = allConnections.find(conn => 
      conn.accessToken && 
      conn.accessToken !== null && 
      conn.refreshToken && 
      conn.refreshToken !== null &&
      conn.isConnected
    );

    const twitterConnection = activeConnection || allConnections[0];

    if (twitterConnection) {
      twitterConnection.isConnected = false;
      twitterConnection.accessToken = null;
      twitterConnection.refreshToken = null;
      twitterConnection.tokenExpiresAt = null;
      await yapperTwitterRepository.save(twitterConnection);
    }

    logger.info(`🔌 Disconnected Twitter for Yapper: ${walletAddress}`);

    return res.json({
      success: true,
      message: 'Twitter account disconnected successfully',
    });

  } catch (error) {
    logger.error('❌ Failed to disconnect Yapper Twitter:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect Twitter account',
    });
  }
});

/**
 * @route POST /api/yapper-twitter-auth/refresh-token/:walletAddress
 * @desc Refresh Twitter access token for a Yapper using refresh token
 */
router.post('/refresh-token/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        timestamp: new Date().toISOString(),
      });
    }

    const userRepository: Repository<User> = AppDataSource.getRepository(User);
    const yapperTwitterRepository: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

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

    // Find active connection with valid tokens, prioritize over disconnected ones
    const allConnections = await yapperTwitterRepository.find({
      where: { userId: user.id },
      order: { updatedAt: 'DESC' }
    });

    const activeConnection = allConnections.find(conn => 
      conn.accessToken && 
      conn.accessToken !== null && 
      conn.refreshToken && 
      conn.refreshToken !== null
    );

    const twitterConnection = activeConnection || allConnections[0];

    if (!twitterConnection) {
      return res.status(404).json({
        success: false,
        error: 'No Twitter connection found',
        timestamp: new Date().toISOString(),
      });
    }

    if (!twitterConnection.refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'No refresh token available. Please reconnect your Twitter account.',
        requires_reconnection: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Prepare token refresh request
    const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
    const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;

    if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
      logger.error('❌ Twitter credentials not configured');
      return res.status(500).json({
        success: false,
        error: 'Twitter authentication not configured',
        timestamp: new Date().toISOString(),
      });
    }

    const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
    const tokenData = {
      grant_type: 'refresh_token',
      refresh_token: twitterConnection.refreshToken,
      client_id: TWITTER_CLIENT_ID
    };

    const authHeader = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    logger.info(`🔄 Refreshing Twitter token for Yapper: ${walletAddress}`);

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
      
      // If refresh token is invalid, mark connection as needs reconnection
      if (tokenResponse.status === 400 || tokenResponse.status === 401) {
        logger.error(`🔑 Refresh token invalid for Yapper ${user.id} - marking as needs reconnection`);
        twitterConnection.accessToken = '';
        twitterConnection.tokenExpiresAt = null;
        await yapperTwitterRepository.save(twitterConnection);
        
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
    logger.info(`✅ Successfully refreshed access token for Yapper ${user.id}`);

    // Update the connection with new tokens and expiration
    const expiresIn = tokenResult.expires_in || 7200; // Default to 2 hours if not provided
    const expirationDate = new Date(Date.now() + (expiresIn * 1000));

    twitterConnection.accessToken = tokenResult.access_token;
    if (tokenResult.refresh_token) {
      twitterConnection.refreshToken = tokenResult.refresh_token;
    }
    twitterConnection.tokenExpiresAt = expirationDate;
    twitterConnection.isConnected = true;
    twitterConnection.lastSyncAt = new Date();

    await yapperTwitterRepository.save(twitterConnection);

    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        connected: true,
        twitter_username: twitterConnection.twitterUsername,
        twitter_display_name: twitterConnection.twitterDisplayName,
        token_expires_at: twitterConnection.tokenExpiresAt,
        token_status: 'valid'
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to refresh Yapper Twitter token:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh Twitter token',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router; 