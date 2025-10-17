import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Account } from '../models/Account';
import { AccountUser } from '../models/AccountUser';
import { AccountSocialMediaConnection } from '../models/AccountSocialMediaConnection';
import { logger } from '../config/logger';
import crypto from 'crypto';

const router = Router();

/**
 * @route   GET /api/web2-auth/twitter/login
 * @desc    Initiate Twitter OAuth 2.0 flow for Web2 authentication
 * @access  Public
 */
router.get('/twitter/login', async (req: Request, res: Response): Promise<void> => {
  try {
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
    const tokenResponse = await fetch('https://twitter.com/2/oauth2/token', {
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

      res.json({
        success: true,
        token: access_token,
        accountId: accountUser.account_id,
        data: {
          user: {
            id: accountUser.id,
            account_id: accountUser.account_id,
            email: accountUser.email,
            full_name: accountUser.full_name,
            twitter_username: accountUser.twitter_username,
            role: accountUser.role
          },
          token: access_token,
          expires_in
        }
      });
    }

    // Create new account and user
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
      data: {
        user: {
          id: newAccountUser.id,
          account_id: newAccountUser.account_id,
          email: newAccountUser.email,
          full_name: newAccountUser.full_name,
          twitter_username: newAccountUser.twitter_username,
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

export default router;

