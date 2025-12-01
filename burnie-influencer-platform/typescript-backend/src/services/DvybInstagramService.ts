import axios from 'axios';
import { AppDataSource } from '../config/database';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybAccount } from '../models/DvybAccount';
import { env } from '../config/env';
import { logger } from '../config/logger';

export class DvybInstagramService {
  // Using Facebook Graph API for Instagram (more reliable than Instagram Basic Display)
  private static readonly AUTH_URL = 'https://www.facebook.com/v18.0/dialog/oauth';
  private static readonly TOKEN_URL = 'https://graph.facebook.com/v18.0/oauth/access_token';
  private static readonly GRAPH_API_URL = 'https://graph.facebook.com';
  // Instagram Business permissions via Facebook Login
  // These match the permissions added in Meta Developer Console
  private static readonly SCOPES = [
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_messages',
    'pages_read_engagement',
    'business_management',
    'pages_show_list'
  ];

  /**
   * Generate Instagram OAuth URL (via Facebook Login)
   */
  static getAuthUrl(accountId: number): string {
    const state = Buffer.from(JSON.stringify({ accountId, timestamp: Date.now() })).toString('base64');
    
    const params = new URLSearchParams({
      client_id: env.dvybOAuth.instagram.appId,
      redirect_uri: env.dvybOAuth.instagram.callbackUrl,
      scope: this.SCOPES.join(','), // Facebook OAuth uses comma-separated scopes
      response_type: 'code',
      state: state,
    });

    const authUrl = `${this.AUTH_URL}?${params.toString()}`;
    
    logger.info('📱 Instagram OAuth URL generated:', {
      client_id: env.dvybOAuth.instagram.appId,
      redirect_uri: env.dvybOAuth.instagram.callbackUrl,
      scopes: this.SCOPES,
      url_preview: authUrl.substring(0, 150) + '...',
    });

    return authUrl;
  }

  /**
   * Connect Instagram to an existing account (called from popup flow)
   */
  static async connectToAccount(
    accountId: number,
    code: string,
    state: string
  ): Promise<DvybInstagramConnection> {
    try {
      // Verify the state matches the accountId
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      if (decodedState.accountId !== accountId) {
        throw new Error('State mismatch - account ID does not match');
      }

      const { connection } = await this.handleCallback(code, state);
      return connection;
    } catch (error) {
      logger.error(`❌ Instagram connection error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  static async handleCallback(code: string, state: string): Promise<{
    accountId: number;
    connection: DvybInstagramConnection;
  }> {
    try {
      // Decode state to get accountId
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      const accountId = decodedState.accountId;

      // Verify account exists
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const account = await accountRepo.findOne({ where: { id: accountId } });
      if (!account) {
        throw new Error('Account not found');
      }

      // Step 1: Exchange code for Facebook access token
      logger.info('🔄 Step 1: Exchanging code for Facebook access token...');
      logger.info('📋 OAuth Config:', {
        client_id: env.dvybOAuth.instagram.appId,
        redirect_uri: env.dvybOAuth.instagram.callbackUrl,
        code_length: code?.length || 0,
      });
      
      const tokenResponse = await axios.get(this.TOKEN_URL, {
        params: {
          client_id: env.dvybOAuth.instagram.appId,
          client_secret: env.dvybOAuth.instagram.appSecret,
          redirect_uri: env.dvybOAuth.instagram.callbackUrl,
          code: code,
        },
      });

      const facebookAccessToken = tokenResponse.data.access_token;
      logger.info('✅ Got Facebook access token:', facebookAccessToken ? `${facebookAccessToken.substring(0, 20)}...` : 'MISSING');

      // Step 2: Get Facebook user's Pages with Instagram Business Accounts
      logger.info('🔄 Step 2: Getting Facebook Pages with Instagram Business Accounts...');
      const accountsResponse = await axios.get(
        `${this.GRAPH_API_URL}/v18.0/me/accounts`,
        {
          params: {
            access_token: facebookAccessToken,
            fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}',
          },
        }
      );

      const fbPages = accountsResponse.data.data;
      if (!fbPages || fbPages.length === 0) {
        throw new Error('No Facebook Pages found. You need a Facebook Page connected to an Instagram Business Account.');
      }

      // Find the first page with an Instagram Business Account
      const pageWithInstagram = fbPages.find((page: any) => page.instagram_business_account);
      if (!pageWithInstagram) {
        throw new Error('No Instagram Business Account found. Please convert your Instagram account to a Business account and connect it to a Facebook Page.');
      }

      const instagramAccount = pageWithInstagram.instagram_business_account;
      const instagramAccountId = instagramAccount.id;
      
      logger.info(`✅ Found Instagram Business Account: @${instagramAccount.username} (${instagramAccountId})`);

      // Step 3: Exchange short-lived token for long-lived token (60 days)
      logger.info('🔄 Step 3: Exchanging for long-lived token...');
      const longLivedTokenResponse = await axios.get(
        `${this.GRAPH_API_URL}/v18.0/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: env.dvybOAuth.instagram.appId,
            client_secret: env.dvybOAuth.instagram.appSecret,
            fb_exchange_token: facebookAccessToken,
          },
        }
      );

      const longLivedToken = longLivedTokenResponse.data.access_token;
      const expiresIn = longLivedTokenResponse.data.expires_in || 5184000; // 60 days default
      logger.info(`✅ Got long-lived token (expires in ${expiresIn}s)`);

      const userInfo = instagramAccount;

      // Save or update connection
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      let connection = await connectionRepo.findOne({ where: { accountId } });

      if (connection) {
        // Update existing connection
        connection.instagramUserId = instagramAccountId;
        connection.username = userInfo.username || '';
        connection.accessToken = longLivedToken;
        connection.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
        connection.profileData = {
          ...userInfo,
          page_id: pageWithInstagram.id, // Store FB Page ID for future use
        };
        connection.status = 'active';
        connection.errorMessage = null;
      } else {
        // Create new connection
        connection = connectionRepo.create({
          accountId,
          instagramUserId: instagramAccountId,
          username: userInfo.username || '',
          accessToken: longLivedToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          profileData: {
            ...userInfo,
            page_id: pageWithInstagram.id, // Store FB Page ID for future use
          },
          status: 'active',
        });
      }

      await connectionRepo.save(connection);

      logger.info(`✅ Instagram Business Account connected for account ${accountId}: @${userInfo.username} (${instagramAccountId})`);

      return { accountId, connection };
    } catch (error: any) {
      logger.error(`❌ Instagram OAuth error:`, error.response?.data || error.message);
      throw new Error(`Instagram authentication failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Refresh Instagram long-lived token (via Facebook Graph API)
   * Note: Facebook long-lived tokens are valid for 60 days and can be refreshed
   */
  static async refreshToken(accessToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    try {
      logger.info('🔄 Refreshing Instagram/Facebook long-lived token...');
      const response = await axios.get(
        `${this.GRAPH_API_URL}/v18.0/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: env.dvybOAuth.instagram.appId,
            client_secret: env.dvybOAuth.instagram.appSecret,
            fb_exchange_token: accessToken,
          },
        }
      );

      logger.info('✅ Token refreshed successfully');
      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in || 5184000, // 60 days default
      };
    } catch (error: any) {
      logger.error(`❌ Instagram token refresh failed:`, error.response?.data || error.message);
      throw new Error(`Instagram token refresh failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get valid Instagram token (auto-refresh if needed)
   */
  static async getValidToken(accountId: number): Promise<string> {
    const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      throw new Error('Instagram connection not found');
    }

    const now = Date.now();
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const daysUntilExpiry = (expiresAt - now) / (24 * 60 * 60 * 1000);

    // Refresh if expiring in less than 7 days (Instagram tokens valid for 60 days)
    if (daysUntilExpiry < 7) {
      logger.info(`🔄 Refreshing Instagram token for account ${accountId} (expires in ${daysUntilExpiry.toFixed(1)} days)`);
      
      const newTokens = await this.refreshToken(connection.accessToken);
      
      connection.accessToken = newTokens.accessToken;
      connection.tokenExpiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);
      connection.status = 'active';
      connection.errorMessage = null;
      
      await connectionRepo.save(connection);
      
      return newTokens.accessToken;
    }

    return connection.accessToken;
  }

  /**
   * Check if Instagram connection is valid
   */
  static async isConnectionValid(accountId: number): Promise<boolean> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection) {
        return false;
      }

      if (connection.status !== 'active') {
        return false;
      }

      const now = Date.now();
      const expiresAt = new Date(connection.tokenExpiresAt).getTime();

      // Consider valid if not expired yet
      return expiresAt > now;
    } catch (error) {
      logger.error(`❌ Error checking Instagram connection:`, error);
      return false;
    }
  }

  /**
   * Get Instagram connection status with detailed state
   */
  static async getConnectionStatus(accountId: number): Promise<'connected' | 'expired' | 'not_connected'> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection) {
        return 'not_connected';
      }

      if (connection.status !== 'active') {
        return 'expired';
      }

      const now = Date.now();
      const expiresAt = new Date(connection.tokenExpiresAt).getTime();

      // Check if token is expired
      if (expiresAt <= now) {
        return 'expired';
      }

      return 'connected';
    } catch (error) {
      logger.error(`❌ Error checking Instagram connection status:`, error);
      return 'not_connected';
    }
  }

  /**
   * Disconnect Instagram
   */
  static async disconnect(accountId: number): Promise<void> {
    const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
    await connectionRepo.delete({ accountId });
    logger.info(`✅ Instagram disconnected for account ${accountId}`);
  }
}

