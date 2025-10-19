import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Account } from '../models/Account';
import { AccountUser } from '../models/AccountUser';
import { AccountSocialMediaConnection } from '../models/AccountSocialMediaConnection';
import { BrandContext } from '../models/BrandContext';
import { logger } from '../config/logger';
import crypto from 'crypto';
import { IsNull } from 'typeorm';

const router = Router();

/**
 * @route   GET /api/web2-auth/twitter/login
 * @desc    Initiate Twitter OAuth 2.0 flow for Web2 authentication
 * @access  Public
 */
router.get('/twitter/login', async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if database is connected (for logging purposes, not critical for this endpoint)
    if (!AppDataSource.isInitialized) {
      logger.warn('Twitter login initiated but database not ready yet');
    }

    const { redirect_uri } = req.query;

    // Twitter OAuth 2.0 configuration
    const clientId = process.env.TWITTER_CLIENT_ID;
    const callbackUrl = (redirect_uri as string) || process.env.TWITTER_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/twitter-callback';

    if (!clientId) {
      res.status(500).json({
        success: false,
        error: 'Twitter OAuth not configured'
      });
      return;
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in session or return it to client
    // For now, we'll return it to the client to pass back
    const codeChallenge = crypto.randomBytes(32).toString('base64url');

    // Build Twitter OAuth URL
    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', callbackUrl);
    authUrl.searchParams.append('scope', 'tweet.read tweet.write users.read offline.access');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'plain');

    res.json({
      success: true,
      data: {
        oauth_url: authUrl.toString(),
        state,
        code_challenge: codeChallenge
      }
    });
  } catch (error) {
    logger.error('Error initiating Twitter OAuth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate Twitter authentication'
    });
  }
});

/**
 * @route   GET/POST /api/web2-auth/twitter/callback
 * @desc    Handle Twitter OAuth callback and create/login user
 * @access  Public
 */
const handleTwitterCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if database is connected
    if (!AppDataSource.isInitialized) {
      res.status(503).json({
        success: false,
        error: 'Database not ready. Please try again in a moment.'
      });
      return;
    }

    // Support both GET (from Twitter redirect) and POST (from frontend)
    const code = req.query.code as string || req.body.code;
    const state = req.query.state as string || req.body.state;
    const code_verifier = req.body.code_verifier || req.query.code_verifier as string;

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }

    // Exchange code for access token
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    const callbackUrl = process.env.TWITTER_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/twitter-callback';

    if (!clientId || !clientSecret) {
      res.status(500).json({
        success: false,
        error: 'Twitter OAuth not configured'
      });
      return;
    }

    // Exchange code for token
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
        code_verifier: code_verifier || state
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      logger.error('Twitter token exchange failed:', errorData);
      res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code'
      });
      return;
    }

    const tokenData = await tokenResponse.json() as any;
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get user info from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    if (!userResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch user information'
      });
      return;
    }

    const userData = await userResponse.json() as any;
    const { id: twitter_user_id, username: twitter_username, name } = userData.data;

    // Check if user already exists
    const accountUserRepo = AppDataSource.getRepository(AccountUser);
    let accountUser = await accountUserRepo.findOne({
      where: { twitter_user_id },
      relations: ['account']
    });

    if (accountUser) {
      // Update existing user's tokens (7 days expiry)
      accountUser.twitter_access_token = access_token;
      accountUser.twitter_refresh_token = refresh_token;
      accountUser.twitter_token_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      accountUser.last_login = new Date();
      await accountUserRepo.save(accountUser);

      // Update or create social media connection
      const socialConnectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
      let socialConnection = await socialConnectionRepo.findOne({
        where: {
          account_id: accountUser.account_id,
          platform: 'twitter',
          platform_user_id: twitter_user_id
        }
      });

      if (socialConnection) {
        // Update existing connection (7 days expiry)
        socialConnection.access_token = access_token;
        socialConnection.refresh_token = refresh_token;
        socialConnection.token_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        socialConnection.last_used_at = new Date();
        socialConnection.status = 'active';
        socialConnection.platform_username = twitter_username;
        await socialConnectionRepo.save(socialConnection);
        logger.info(`Updated Twitter connection for account ${accountUser.account_id}`);
      } else {
        // Create new connection (7 days expiry)
        const newConnection = socialConnectionRepo.create({
          account_id: accountUser.account_id,
          platform: 'twitter',
          platform_user_id: twitter_user_id,
          platform_username: twitter_username,
          access_token: access_token,
          refresh_token: refresh_token,
          token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          status: 'active',
          last_used_at: new Date()
        });
        await socialConnectionRepo.save(newConnection);
        logger.info(`Created Twitter connection for account ${accountUser.account_id}`);
      }

      // Check if user has completed profile (has brand context)
      const brandContextRepo = AppDataSource.getRepository(BrandContext);
      const brandContext = await brandContextRepo.findOne({
        where: { 
          account_id: accountUser.account_id,
          account_client_id: IsNull()
        }
      });

      res.json({
        success: true,
        token: access_token,
        accountId: accountUser.account_id,
        username: accountUser.twitter_username,
        hasCompletedProfile: !!brandContext,
        data: {
          user: {
            id: accountUser.id,
            account_id: accountUser.account_id,
            email: accountUser.email,
            full_name: accountUser.full_name,
            twitter_username: accountUser.twitter_username,
            username: accountUser.twitter_username,
            role: accountUser.role
          },
          token: access_token,
          expires_in
        }
      });
      return;
    }

    // Create new account and user (only if not found above)
    const accountRepo = AppDataSource.getRepository(Account);
    const newAccount = accountRepo.create({
      account_type: 'individual',
      business_name: name,
      status: 'active'
    });
    await accountRepo.save(newAccount);

    const newAccountUser = accountUserRepo.create({
      account_id: newAccount.id,
      email: `${twitter_username}@twitter.placeholder`, // Placeholder email
      full_name: name,
      role: 'owner',
      is_primary: true,
      twitter_user_id,
      twitter_username,
      twitter_access_token: access_token,
      twitter_refresh_token: refresh_token,
      twitter_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      last_login: new Date(),
      status: 'active'
    });
    await accountUserRepo.save(newAccountUser);

    // Create social media connection for new user (7 days expiry)
    const socialConnectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const newConnection = socialConnectionRepo.create({
      account_id: newAccount.id,
      platform: 'twitter',
      platform_user_id: twitter_user_id,
      platform_username: twitter_username,
      access_token: access_token,
      refresh_token: refresh_token,
      token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'active',
      last_used_at: new Date()
    });
    await socialConnectionRepo.save(newConnection);
    logger.info(`Created Twitter connection for new account ${newAccount.id}`);

    res.json({
      success: true,
      token: access_token,
      accountId: newAccount.id,
      username: newAccountUser.twitter_username,
      hasCompletedProfile: false, // New user hasn't completed profile yet
      data: {
        user: {
          id: newAccountUser.id,
          account_id: newAccountUser.account_id,
          email: newAccountUser.email,
          full_name: newAccountUser.full_name,
          twitter_username: newAccountUser.twitter_username,
          username: newAccountUser.twitter_username,
          role: newAccountUser.role
        },
        token: access_token,
        expires_in,
        is_new_user: true
      }
    });
  } catch (error) {
    logger.error('Error handling Twitter callback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete authentication'
    });
  }
};

// Register both GET and POST routes for callback
router.get('/twitter/callback', handleTwitterCallback);
router.post('/twitter/callback', handleTwitterCallback);

/**
 * @route   GET /api/web2-auth/me
 * @desc    Get current authenticated user and validate connection
 * @access  Private (requires Bearer token)
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No authorization token provided',
        requiresAuth: true
      });
      return;
    }

    const token = authHeader.substring(7);

    // Verify token with Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!userResponse.ok) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        requiresAuth: true
      });
      return;
    }

    const userData = await userResponse.json() as any;
    const { id: twitter_user_id } = userData.data;

    // Get user from database
    const accountUserRepo = AppDataSource.getRepository(AccountUser);
    const accountUser = await accountUserRepo.findOne({
      where: { twitter_user_id },
      relations: ['account']
    });

    if (!accountUser) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        requiresAuth: true
      });
      return;
    }

    // Check if social media connection exists and is valid
    const socialConnectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const socialConnection = await socialConnectionRepo.findOne({
      where: {
        account_id: accountUser.account_id,
        platform: 'twitter',
        platform_user_id: twitter_user_id
      }
    });

    if (!socialConnection) {
      logger.warn(`No Twitter connection found for account ${accountUser.account_id}`);
      res.status(401).json({
        success: false,
        error: 'No Twitter connection found. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    // Check if token is expired
    if (socialConnection.token_expires_at && socialConnection.token_expires_at < new Date()) {
      logger.warn(`Twitter token expired for account ${accountUser.account_id}`);
      res.status(401).json({
        success: false,
        error: 'Twitter token has expired. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    // Check if connection is active
    if (socialConnection.status !== 'active') {
      logger.warn(`Twitter connection not active for account ${accountUser.account_id}`);
      res.status(401).json({
        success: false,
        error: 'Twitter connection is not active. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: accountUser.id,
          account_id: accountUser.account_id,
          email: accountUser.email,
          full_name: accountUser.full_name,
          twitter_username: accountUser.twitter_username,
          role: accountUser.role,
          account: {
            id: accountUser.account.id,
            account_type: accountUser.account.account_type,
            business_name: accountUser.account.business_name,
            industry: accountUser.account.industry
          }
        },
        connection: {
          platform: 'twitter',
          username: socialConnection.platform_username,
          connected_at: socialConnection.connected_at,
          status: socialConnection.status
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching current user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user information'
    });
  }
});

/**
 * @route   POST /api/web2-auth/refresh
 * @desc    Refresh Twitter access token
 * @access  Public
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
      return;
    }

    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;

    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        refresh_token,
        grant_type: 'refresh_token'
      })
    });

    if (!tokenResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to refresh token'
      });
      return;
    }

    const tokenData = await tokenResponse.json();

    res.json({
      success: true,
      data: tokenData
    });
  } catch (error) {
    logger.error('Error refreshing token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token'
    });
  }
});

/**
 * @route   GET /api/web2-auth/check-session
 * @desc    Check if user has valid Twitter authentication
 * @access  Public
 */
router.get('/check-session', async (req: Request, res: Response): Promise<void> => {
  try {
    const { twitter_username } = req.query;
    
    if (!twitter_username || typeof twitter_username !== 'string') {
      res.json({
        success: true,
        hasValidSession: false
      });
      return;
    }

    // Find account by Twitter username from social connections
    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const connection = await connectionRepo.findOne({
      where: {
        platform: 'twitter',
        platform_username: twitter_username,
        status: 'active'
      }
    });

    if (!connection) {
      res.json({
        success: true,
        hasValidSession: false
      });
      return;
    }

    // Check if token is expired
    const now = new Date();
    const hasValidToken = connection.token_expires_at && connection.token_expires_at > now;

    if (hasValidToken && connection.access_token) {
      // Check if account has completed profile (has brand context)
      const brandContextRepo = AppDataSource.getRepository(BrandContext);
      const brandContext = await brandContextRepo.findOne({
        where: { 
          account_id: connection.account_id,
          account_client_id: IsNull()
        }
      });

      // Return session info
      res.json({
        success: true,
        hasValidSession: true,
        data: {
          account_id: connection.account_id,
          username: connection.platform_username,
          hasCompletedProfile: !!brandContext
        }
      });
    } else {
      res.json({
        success: true,
        hasValidSession: false
      });
    }
  } catch (error) {
    logger.error('Error checking session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check session'
    });
  }
});

/**
 * @route   POST /api/web2-auth/logout
 * @desc    Logout user and clear Twitter tokens
 * @access  Private
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const { account_id } = req.body;
    
    if (!account_id) {
      res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
      return;
    }

    // Clear Twitter tokens from database
    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const connection = await connectionRepo.findOne({
      where: {
        account_id: parseInt(account_id, 10),
        platform: 'twitter'
      }
    });

    if (connection) {
      // Set tokens to null
      connection.access_token = undefined as any;
      connection.refresh_token = undefined as any;
      connection.token_expires_at = undefined as any;
      connection.status = 'revoked';
      
      await connectionRepo.save(connection);
      logger.info(`✅ Logged out and cleared tokens for account ${account_id}`);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Error during logout:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
});

/**
 * @route   GET /api/web2-auth/linkedin/login
 * @desc    Initiate LinkedIn OAuth 2.0 flow
 * @access  Public
 */
router.get('/linkedin/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { redirect_uri } = req.query;
    
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const callbackUrl = (redirect_uri as string) || process.env.LINKEDIN_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/linkedin-callback';
    
    if (!clientId) {
      res.status(500).json({
        success: false,
        error: 'LinkedIn OAuth not configured'
      });
      return;
    }
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Build LinkedIn OAuth URL
    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', callbackUrl);
    authUrl.searchParams.append('scope', 'openid profile email w_member_social');
    authUrl.searchParams.append('state', state);
    
    res.json({
      success: true,
      data: {
        oauth_url: authUrl.toString(),
        state
      }
    });
  } catch (error) {
    logger.error('Error initiating LinkedIn OAuth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate LinkedIn authentication'
    });
  }
});

/**
 * @route   POST /api/web2-auth/linkedin/callback
 * @desc    Handle LinkedIn OAuth callback
 * @access  Public
 */
router.post('/linkedin/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, account_id } = req.body;
    
    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }
    
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const callbackUrl = process.env.LINKEDIN_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/linkedin-callback';
    
    if (!clientId || !clientSecret) {
      res.status(500).json({
        success: false,
        error: 'LinkedIn OAuth not configured'
      });
      return;
    }
    
    // Exchange code for token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('LinkedIn token exchange failed:', errorText);
      res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code'
      });
      return;
    }
    
    const tokenData = await tokenResponse.json() as any;
    
    // Get user info
    const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    
    if (!userResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch LinkedIn user data'
      });
      return;
    }
    
    const userData = await userResponse.json() as any;
    
    // Save connection to database
    if (account_id) {
      const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
      
      // Check if connection already exists
      let connection = await connectionRepo.findOne({
        where: {
          account_id: parseInt(account_id, 10),
          platform: 'linkedin'
        }
      });
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60); // LinkedIn tokens expire in 60 days
      
      if (connection) {
        // Update existing connection
        connection.access_token = tokenData.access_token;
        connection.refresh_token = tokenData.refresh_token;
        connection.token_expires_at = expiresAt;
        connection.platform_user_id = userData.sub;
        connection.platform_username = userData.name;
        connection.status = 'active';
      } else {
        // Create new connection
        connection = connectionRepo.create({
          account_id: parseInt(account_id, 10),
          platform: 'linkedin',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          platform_user_id: userData.sub,
          platform_username: userData.name,
          status: 'active'
        });
      }
      
      await connectionRepo.save(connection);
      logger.info(`LinkedIn connection saved for account ${account_id}`);
    }
    
    res.json({
      success: true,
      data: {
        access_token: tokenData.access_token,
        user: userData
      }
    });
  } catch (error) {
    logger.error('Error in LinkedIn callback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete LinkedIn authentication'
    });
  }
});

/**
 * @route   GET /api/web2-auth/youtube/login
 * @desc    Initiate Google/YouTube OAuth 2.0 flow
 * @access  Public
 */
router.get('/youtube/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { redirect_uri } = req.query;
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const callbackUrl = (redirect_uri as string) || process.env.YOUTUBE_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/youtube-callback';
    
    if (!clientId) {
      res.status(500).json({
        success: false,
        error: 'Google OAuth not configured'
      });
      return;
    }
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Build Google OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', callbackUrl);
    authUrl.searchParams.append('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('access_type', 'offline'); // Get refresh token
    authUrl.searchParams.append('prompt', 'consent'); // Force consent to get refresh token
    
    res.json({
      success: true,
      data: {
        oauth_url: authUrl.toString(),
        state
      }
    });
  } catch (error) {
    logger.error('Error initiating YouTube OAuth:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate YouTube authentication'
    });
  }
});

/**
 * @route   POST /api/web2-auth/youtube/callback
 * @desc    Handle Google/YouTube OAuth callback
 * @access  Public
 */
router.post('/youtube/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, account_id } = req.body;
    
    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.YOUTUBE_CALLBACK_URL_WEB2 || 'http://localhost:3000/web2/youtube-callback';
    
    if (!clientId || !clientSecret) {
      res.status(500).json({
        success: false,
        error: 'Google OAuth not configured'
      });
      return;
    }
    
    // Exchange code for token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('Google token exchange failed:', errorText);
      res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code'
      });
      return;
    }
    
    const tokenData = await tokenResponse.json() as any;
    
    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    
    if (!userResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch Google user data'
      });
      return;
    }
    
    const userData = await userResponse.json() as any;
    
    // Save connection to database
    if (account_id) {
      const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
      
      // Check if connection already exists
      let connection = await connectionRepo.findOne({
        where: {
          account_id: parseInt(account_id, 10),
          platform: 'youtube'
        }
      });
      
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
      
      if (connection) {
        // Update existing connection
        connection.access_token = tokenData.access_token;
        connection.refresh_token = tokenData.refresh_token || connection.refresh_token; // Keep old refresh token if new one not provided
        connection.token_expires_at = expiresAt;
        connection.platform_user_id = userData.id;
        connection.platform_username = userData.name || userData.email;
        connection.status = 'active';
      } else {
        // Create new connection
        connection = connectionRepo.create({
          account_id: parseInt(account_id, 10),
          platform: 'youtube',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          platform_user_id: userData.id,
          platform_username: userData.name || userData.email,
          status: 'active'
        });
      }
      
      await connectionRepo.save(connection);
      logger.info(`YouTube connection saved for account ${account_id}`);
    }
    
    res.json({
      success: true,
      data: {
        access_token: tokenData.access_token,
        user: userData
      }
    });
  } catch (error) {
    logger.error('Error in YouTube callback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete YouTube authentication'
    });
  }
});

export default router;

