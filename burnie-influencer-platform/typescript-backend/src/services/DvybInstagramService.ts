import axios from 'axios';
import { AppDataSource } from '../config/database';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybAccount } from '../models/DvybAccount';
import { env } from '../config/env';
import { logger } from '../config/logger';

export class DvybInstagramService {
  private static readonly AUTH_URL = 'https://api.instagram.com/oauth/authorize';
  private static readonly TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
  private static readonly GRAPH_API_URL = 'https://graph.instagram.com';
  private static readonly SCOPES = ['user_profile', 'user_media'];

  /**
   * Generate Instagram OAuth URL
   */
  static getAuthUrl(accountId: number): string {
    const state = Buffer.from(JSON.stringify({ accountId, timestamp: Date.now() })).toString('base64');
    
    const params = new URLSearchParams({
      client_id: env.dvybOAuth.instagram.appId,
      redirect_uri: env.dvybOAuth.instagram.callbackUrl,
      scope: this.SCOPES.join(','),
      response_type: 'code',
      state: state,
    });

    return `${this.AUTH_URL}?${params.toString()}`;
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

      // Exchange code for short-lived access token
      const tokenResponse = await axios.post(
        this.TOKEN_URL,
        new URLSearchParams({
          client_id: env.dvybOAuth.instagram.appId,
          client_secret: env.dvybOAuth.instagram.appSecret,
          grant_type: 'authorization_code',
          redirect_uri: env.dvybOAuth.instagram.callbackUrl,
          code: code,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const shortLivedToken = tokenResponse.data.access_token;
      const userId = tokenResponse.data.user_id;

      // Exchange short-lived token for long-lived token (60 days)
      const longLivedTokenResponse = await axios.get(
        `${this.GRAPH_API_URL}/access_token`,
        {
          params: {
            grant_type: 'ig_exchange_token',
            client_secret: env.dvybOAuth.instagram.appSecret,
            access_token: shortLivedToken,
          },
        }
      );

      const longLivedToken = longLivedTokenResponse.data.access_token;
      const expiresIn = longLivedTokenResponse.data.expires_in; // 60 days in seconds

      // Get user profile info
      const userInfoResponse = await axios.get(
        `${this.GRAPH_API_URL}/me`,
        {
          params: {
            fields: 'id,username,account_type,media_count',
            access_token: longLivedToken,
          },
        }
      );

      const userInfo = userInfoResponse.data;

      // Save or update connection
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      let connection = await connectionRepo.findOne({ where: { accountId } });

      if (connection) {
        // Update existing connection
        connection.instagramUserId = userId.toString();
        connection.username = userInfo.username;
        connection.accessToken = longLivedToken;
        connection.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
        connection.profileData = userInfo;
        connection.status = 'active';
        connection.errorMessage = null;
      } else {
        // Create new connection
        connection = connectionRepo.create({
          accountId,
          instagramUserId: userId.toString(),
          username: userInfo.username,
          accessToken: longLivedToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          profileData: userInfo,
          status: 'active',
        });
      }

      await connectionRepo.save(connection);

      logger.info(`✅ Instagram connected for account ${accountId}: @${userInfo.username}`);

      return { accountId, connection };
    } catch (error: any) {
      logger.error(`❌ Instagram OAuth error:`, error.response?.data || error.message);
      throw new Error(`Instagram authentication failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Refresh Instagram long-lived token
   * Note: Instagram long-lived tokens are valid for 60 days and can be refreshed
   */
  static async refreshToken(accessToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    try {
      const response = await axios.get(
        `${this.GRAPH_API_URL}/refresh_access_token`,
        {
          params: {
            grant_type: 'ig_refresh_token',
            access_token: accessToken,
          },
        }
      );

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
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
   * Disconnect Instagram
   */
  static async disconnect(accountId: number): Promise<void> {
    const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
    await connectionRepo.delete({ accountId });
    logger.info(`✅ Instagram disconnected for account ${accountId}`);
  }
}

