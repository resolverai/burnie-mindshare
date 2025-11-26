import axios from 'axios';
import { AppDataSource } from '../config/database';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
import { DvybAccount } from '../models/DvybAccount';
import { env } from '../config/env';
import { logger } from '../config/logger';

export class DvybTikTokService {
  private static readonly AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize';
  private static readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  private static readonly USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
  private static readonly SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];

  /**
   * Generate TikTok OAuth URL
   */
  static getAuthUrl(accountId: number): string {
    const state = Buffer.from(JSON.stringify({ accountId, timestamp: Date.now() })).toString('base64');
    
    const params = new URLSearchParams({
      client_key: env.dvybOAuth.tiktok.clientKey,
      response_type: 'code',
      scope: this.SCOPES.join(','),
      redirect_uri: env.dvybOAuth.tiktok.callbackUrl,
      state: state,
    });

    return `${this.AUTH_URL}?${params.toString()}`;
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  static async handleCallback(code: string, state: string): Promise<{
    accountId: number;
    connection: DvybTikTokConnection;
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

      // Exchange code for access token
      const tokenResponse = await axios.post(
        this.TOKEN_URL,
        new URLSearchParams({
          client_key: env.dvybOAuth.tiktok.clientKey,
          client_secret: env.dvybOAuth.tiktok.clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: env.dvybOAuth.tiktok.callbackUrl,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const {
        access_token,
        refresh_token,
        expires_in,
        refresh_expires_in,
        open_id,
      } = tokenResponse.data;

      // Get user info
      const userInfoResponse = await axios.get(this.USER_INFO_URL, {
        params: {
          fields: 'open_id,union_id,avatar_url,display_name',
        },
        headers: {
          'Authorization': `Bearer ${access_token}`,
        },
      });

      const userInfo = userInfoResponse.data.data.user;

      // Save or update connection
      const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
      let connection = await connectionRepo.findOne({ where: { accountId } });

      if (connection) {
        // Update existing connection
        connection.openId = open_id;
        connection.unionId = userInfo.union_id;
        connection.displayName = userInfo.display_name;
        connection.accessToken = access_token;
        connection.refreshToken = refresh_token;
        connection.tokenExpiresAt = new Date(Date.now() + expires_in * 1000);
        connection.refreshTokenExpiresAt = new Date(Date.now() + refresh_expires_in * 1000);
        connection.profileData = userInfo;
        connection.status = 'active';
        connection.errorMessage = null;
      } else {
        // Create new connection
        connection = connectionRepo.create({
          accountId,
          openId: open_id,
          unionId: userInfo.union_id,
          displayName: userInfo.display_name,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + refresh_expires_in * 1000),
          profileData: userInfo,
          status: 'active',
        });
      }

      await connectionRepo.save(connection);

      logger.info(`✅ TikTok connected for account ${accountId}: ${userInfo.display_name}`);

      return { accountId, connection };
    } catch (error: any) {
      logger.error(`❌ TikTok OAuth error:`, error.response?.data || error.message);
      throw new Error(`TikTok authentication failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Refresh TikTok access token
   */
  static async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
  }> {
    try {
      const response = await axios.post(
        this.TOKEN_URL,
        new URLSearchParams({
          client_key: env.dvybOAuth.tiktok.clientKey,
          client_secret: env.dvybOAuth.tiktok.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        refreshExpiresIn: response.data.refresh_expires_in,
      };
    } catch (error: any) {
      logger.error(`❌ TikTok token refresh failed:`, error.response?.data || error.message);
      throw new Error(`TikTok token refresh failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get valid TikTok token (auto-refresh if needed)
   */
  static async getValidToken(accountId: number): Promise<string> {
    const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      throw new Error('TikTok connection not found');
    }

    const now = Date.now();
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const hoursUntilExpiry = (expiresAt - now) / (60 * 60 * 1000);

    // Refresh if expiring in less than 6 hours (TikTok tokens valid for 24 hours)
    if (hoursUntilExpiry < 6) {
      logger.info(`🔄 Refreshing TikTok token for account ${accountId} (expires in ${hoursUntilExpiry.toFixed(1)} hours)`);
      
      const newTokens = await this.refreshToken(connection.refreshToken);
      
      connection.accessToken = newTokens.accessToken;
      connection.refreshToken = newTokens.refreshToken;
      connection.tokenExpiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);
      connection.refreshTokenExpiresAt = new Date(Date.now() + newTokens.refreshExpiresIn * 1000);
      connection.status = 'active';
      connection.errorMessage = null;
      
      await connectionRepo.save(connection);
      
      return newTokens.accessToken;
    }

    return connection.accessToken;
  }

  /**
   * Check if TikTok connection is valid
   */
  static async isConnectionValid(accountId: number): Promise<boolean> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection) {
        return false;
      }

      if (connection.status !== 'active') {
        return false;
      }

      const now = Date.now();
      const expiresAt = new Date(connection.tokenExpiresAt).getTime();
      const refreshExpiresAt = new Date(connection.refreshTokenExpiresAt).getTime();

      // Check if refresh token is still valid (can refresh access token)
      return refreshExpiresAt > now;
    } catch (error) {
      logger.error(`❌ Error checking TikTok connection:`, error);
      return false;
    }
  }

  /**
   * Disconnect TikTok
   */
  static async disconnect(accountId: number): Promise<void> {
    const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
    await connectionRepo.delete({ accountId });
    logger.info(`✅ TikTok disconnected for account ${accountId}`);
  }
}

