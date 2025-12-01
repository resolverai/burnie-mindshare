import axios from 'axios';
import { AppDataSource } from '../config/database';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybAccount } from '../models/DvybAccount';
import { env } from '../config/env';
import { logger } from '../config/logger';

export class DvybLinkedInService {
  private static readonly AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
  private static readonly TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
  private static readonly USER_INFO_URL = 'https://api.linkedin.com/v2/userinfo';
  private static readonly SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

  /**
   * Generate LinkedIn OAuth URL
   */
  static getAuthUrl(accountId: number): string {
    const state = Buffer.from(JSON.stringify({ accountId, timestamp: Date.now() })).toString('base64');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.dvybOAuth.linkedin.clientId,
      redirect_uri: env.dvybOAuth.linkedin.callbackUrl,
      state: state,
      scope: this.SCOPES.join(' '),
    });

    return `${this.AUTH_URL}?${params.toString()}`;
  }

  /**
   * Connect LinkedIn to an existing account (called from popup flow)
   */
  static async connectToAccount(
    accountId: number,
    code: string,
    state: string
  ): Promise<DvybLinkedInConnection> {
    try {
      // Verify the state matches the accountId
      const decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
      if (decodedState.accountId !== accountId) {
        throw new Error('State mismatch - account ID does not match');
      }

      const { connection } = await this.handleCallback(code, state);
      return connection;
    } catch (error) {
      logger.error(`❌ LinkedIn connection error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  static async handleCallback(code: string, state: string): Promise<{
    accountId: number;
    connection: DvybLinkedInConnection;
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
          grant_type: 'authorization_code',
          code: code,
          client_id: env.dvybOAuth.linkedin.clientId,
          client_secret: env.dvybOAuth.linkedin.clientSecret,
          redirect_uri: env.dvybOAuth.linkedin.callbackUrl,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in, refresh_token } = tokenResponse.data;

      // Get user info
      const userInfoResponse = await axios.get(this.USER_INFO_URL, {
        headers: {
          'Authorization': `Bearer ${access_token}`,
        },
      });

      const userInfo = userInfoResponse.data;

      // LinkedIn access tokens are valid for 60 days (2 months)
      // Use expires_in if provided, otherwise default to 60 days
      const expirationMs = expires_in ? expires_in * 1000 : 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
      
      // Save or update connection
      const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
      let connection = await connectionRepo.findOne({ where: { accountId } });

      if (connection) {
        // Update existing connection
        connection.linkedInUserId = userInfo.sub;
        connection.name = userInfo.name;
        connection.email = userInfo.email;
        connection.accessToken = access_token;
        connection.refreshToken = refresh_token || null;
        connection.tokenExpiresAt = new Date(Date.now() + expirationMs);
        connection.profileData = userInfo;
        connection.status = 'active';
        connection.errorMessage = null;
      } else {
        // Create new connection
        connection = connectionRepo.create({
          accountId,
          linkedInUserId: userInfo.sub,
          name: userInfo.name,
          email: userInfo.email,
          accessToken: access_token,
          refreshToken: refresh_token || null,
          tokenExpiresAt: new Date(Date.now() + expirationMs),
          profileData: userInfo,
          status: 'active',
        });
      }

      await connectionRepo.save(connection);

      logger.info(`✅ LinkedIn connected for account ${accountId}: ${userInfo.name}`);

      return { accountId, connection };
    } catch (error: any) {
      logger.error(`❌ LinkedIn OAuth error:`, error.response?.data || error.message);
      throw new Error(`LinkedIn authentication failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Refresh LinkedIn access token
   */
  static async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    try {
      const response = await axios.post(
        this.TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: env.dvybOAuth.linkedin.clientId,
          client_secret: env.dvybOAuth.linkedin.clientSecret,
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
      };
    } catch (error: any) {
      logger.error(`❌ LinkedIn token refresh failed:`, error.response?.data || error.message);
      throw new Error(`LinkedIn token refresh failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get valid LinkedIn token (auto-refresh if needed)
   */
  static async getValidToken(accountId: number): Promise<string> {
    const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
    const connection = await connectionRepo.findOne({ where: { accountId } });

    if (!connection) {
      throw new Error('LinkedIn connection not found');
    }

    const now = Date.now();
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const daysUntilExpiry = (expiresAt - now) / (24 * 60 * 60 * 1000);

    // Refresh if expiring in less than 7 days (LinkedIn tokens valid for 60 days)
    if (daysUntilExpiry < 7 && connection.refreshToken) {
      logger.info(`🔄 Refreshing LinkedIn token for account ${accountId} (expires in ${daysUntilExpiry.toFixed(1)} days)`);
      
      const newTokens = await this.refreshToken(connection.refreshToken);
      
      connection.accessToken = newTokens.accessToken;
      connection.refreshToken = newTokens.refreshToken;
      connection.tokenExpiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);
      connection.status = 'active';
      connection.errorMessage = null;
      
      await connectionRepo.save(connection);
      
      return newTokens.accessToken;
    }

    return connection.accessToken;
  }

  /**
   * Check if LinkedIn connection is valid
   */
  static async isConnectionValid(accountId: number): Promise<boolean> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
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
      logger.error(`❌ Error checking LinkedIn connection:`, error);
      return false;
    }
  }

  /**
   * Get LinkedIn connection status with detailed state
   */
  static async getConnectionStatus(accountId: number): Promise<'connected' | 'expired' | 'not_connected'> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
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
      logger.error(`❌ Error checking LinkedIn connection status:`, error);
      return 'not_connected';
    }
  }

  /**
   * Disconnect LinkedIn
   */
  static async disconnect(accountId: number): Promise<void> {
    const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
    await connectionRepo.delete({ accountId });
    logger.info(`✅ LinkedIn disconnected for account ${accountId}`);
  }
}

