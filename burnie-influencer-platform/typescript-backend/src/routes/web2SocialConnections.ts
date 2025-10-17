import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AccountSocialMediaConnection } from '../models/AccountSocialMediaConnection';
import { Account } from '../models/Account';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route   GET /api/web2-social/:accountId/connections
 * @desc    Get all social media connections for an account
 * @access  Private
 */
router.get('/:accountId/connections', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;

    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const connections = await connectionRepo.find({
      where: { account_id: accountId as string },
      select: ['id', 'platform', 'platform_username', 'status', 'connected_at', 'last_used_at', 'token_expires_at']
    });

    res.json({
      success: true,
      data: connections
    });
  } catch (error) {
    logger.error('Error fetching social connections:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch social connections'
    });
  }
});

/**
 * @route   POST /api/web2-social/:accountId/connect/linkedin
 * @desc    Connect LinkedIn account
 * @access  Private
 */
router.post('/:accountId/connect/linkedin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { code, redirect_uri } = req.body;

    // Verify account exists
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    // Exchange code for token (LinkedIn OAuth 2.0)
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).json({
        success: false,
        error: 'LinkedIn OAuth not configured'
      });
      return;
    }

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect_uri || process.env.LINKEDIN_REDIRECT_URI || '',
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!tokenResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code'
      });
      return;
    }

    const tokenData = await tokenResponse.json() as any;
    const { access_token, expires_in } = tokenData;

    // Get user info
    const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
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
    const { sub: platform_user_id, name: platform_username } = userData;

    // Save connection
    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    
    // Check if connection already exists
    let connection = await connectionRepo.findOne({
      where: { account_id: accountId as string, platform: 'linkedin' }
    });

    if (connection) {
      connection.access_token = access_token;
      connection.token_expires_at = new Date(Date.now() + expires_in * 1000);
      connection.platform_user_id = platform_user_id;
      connection.platform_username = platform_username;
      connection.status = 'active';
    } else {
      connection = connectionRepo.create({ account_id: accountId as string,
        platform: 'linkedin',
        platform_user_id,
        platform_username,
        access_token,
        token_expires_at: new Date(Date.now() + expires_in * 1000),
        status: 'active'
      });
    }

    await connectionRepo.save(connection);

    res.json({
      success: true,
      data: {
        id: connection.id,
        platform: connection.platform,
        platform_username: connection.platform_username,
        status: connection.status
      }
    });
  } catch (error) {
    logger.error('Error connecting LinkedIn:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect LinkedIn'
    });
  }
});

/**
 * @route   POST /api/web2-social/:accountId/connect/youtube
 * @desc    Connect YouTube account
 * @access  Private
 */
router.post('/:accountId/connect/youtube', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { code, redirect_uri } = req.body;

    // Verify account exists
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    // Exchange code for token (Google OAuth 2.0)
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.status(500).json({
        success: false,
        error: 'Google OAuth not configured'
      });
      return;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect_uri || process.env.GOOGLE_REDIRECT_URI || '',
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!tokenResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to exchange authorization code'
      });
      return;
    }

    const tokenData = await tokenResponse.json() as any;
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get channel info
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    if (!channelResponse.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch channel information'
      });
      return;
    }

    const channelData = await channelResponse.json() as any;
    const channel = channelData.items?.[0];
    
    if (!channel) {
      res.status(400).json({
        success: false,
        error: 'No YouTube channel found'
      });
      return;
    }

    const platform_user_id = channel.id;
    const platform_username = channel.snippet.title;

    // Save connection
    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    
    let connection = await connectionRepo.findOne({
      where: { account_id: accountId as string, platform: 'youtube' }
    });

    if (connection) {
      connection.access_token = access_token;
      connection.refresh_token = refresh_token;
      connection.token_expires_at = new Date(Date.now() + expires_in * 1000);
      connection.platform_user_id = platform_user_id;
      connection.platform_username = platform_username;
      connection.status = 'active';
    } else {
      connection = connectionRepo.create({ account_id: accountId as string,
        platform: 'youtube',
        platform_user_id,
        platform_username,
        access_token,
        refresh_token,
        token_expires_at: new Date(Date.now() + expires_in * 1000),
        status: 'active'
      });
    }

    await connectionRepo.save(connection);

    res.json({
      success: true,
      data: {
        id: connection.id,
        platform: connection.platform,
        platform_username: connection.platform_username,
        status: connection.status
      }
    });
  } catch (error) {
    logger.error('Error connecting YouTube:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect YouTube'
    });
  }
});

/**
 * @route   DELETE /api/web2-social/:accountId/disconnect/:platform
 * @desc    Disconnect a social media account
 * @access  Private
 */
router.delete('/:accountId/disconnect/:platform', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, platform } = req.params;

    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const connection = await connectionRepo.findOne({
      where: { account_id: accountId as string, platform: platform as any }
    });

    if (!connection) {
      res.status(404).json({
        success: false,
        error: 'Connection not found'
      });
      return;
    }

    await connectionRepo.remove(connection);

    res.json({
      success: true,
      message: `${platform} disconnected successfully`
    });
  } catch (error) {
    logger.error('Error disconnecting social media:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect social media'
    });
  }
});

/**
 * @route   POST /api/web2-social/:accountId/refresh/:platform
 * @desc    Refresh access token for a platform
 * @access  Private
 */
router.post('/:accountId/refresh/:platform', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, platform } = req.params;

    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const connection = await connectionRepo.findOne({
      where: { account_id: accountId as string, platform: platform as any }
    });

    if (!connection || !connection.refresh_token) {
      res.status(404).json({
        success: false,
        error: 'Connection not found or no refresh token available'
      });
      return;
    }

    // Refresh token based on platform
    let tokenData: any;

    if (platform === 'youtube') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
          client_id: clientId!,
          client_secret: clientSecret!
        })
      });

      if (!tokenResponse.ok) {
        res.status(400).json({
          success: false,
          error: 'Failed to refresh token'
        });
      return;
      }

      tokenData = await tokenResponse.json();
    } else {
      res.status(400).json({
        success: false,
        error: 'Token refresh not supported for this platform'
      });
      return;
    }

    // Update connection
    connection.access_token = tokenData.access_token;
    connection.token_expires_at = new Date(Date.now() + tokenData.expires_in * 1000);
    connection.status = 'active';

    await connectionRepo.save(connection);

    res.json({
      success: true,
      message: 'Token refreshed successfully'
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

