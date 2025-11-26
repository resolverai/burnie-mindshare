import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybContext } from '../models/DvybContext';
import crypto from 'crypto';

export class DvybAuthService {
  /**
   * Generate Twitter OAuth2 URL for DVYB authentication
   */
  static async generateTwitterOAuthUrl(): Promise<{
    oauthUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const twitterClientId = process.env.TWITTER_CLIENT_ID;
      const dvybCallbackUrl = process.env.DVYB_TWITTER_CALLBACK_URL || 'http://localhost:3005/auth/twitter/callback';

      if (!twitterClientId) {
        throw new Error('Twitter Client ID not configured');
      }

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: twitterClientId,
        redirect_uri: dvybCallbackUrl,
        scope: 'tweet.read tweet.write media.write users.read follows.read offline.access',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const oauthUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

      logger.info('✅ Generated DVYB Twitter OAuth URL');
      return { oauthUrl, state, codeVerifier };
    } catch (error) {
      logger.error('❌ Failed to generate DVYB Twitter OAuth URL:', error);
      throw error;
    }
  }

  /**
   * Handle Twitter OAuth callback and create/update account
   */
  static async handleTwitterCallback(
    code: string,
    state: string,
    codeVerifier: string
  ): Promise<{
    account: DvybAccount;
    isNewAccount: boolean;
  }> {
    try {
      const twitterClientId = process.env.TWITTER_CLIENT_ID;
      const twitterClientSecret = process.env.TWITTER_CLIENT_SECRET;
      const dvybCallbackUrl = process.env.DVYB_TWITTER_CALLBACK_URL || 'http://localhost:3005/auth/twitter/callback';

      if (!twitterClientId || !twitterClientSecret) {
        throw new Error('Twitter credentials not configured');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${twitterClientId}:${twitterClientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: dvybCallbackUrl,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorData}`);
      }

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      const { access_token, refresh_token, expires_in } = tokenData;

      // Get user info from Twitter
      const userResponse = await fetch('https://api.twitter.com/2/users/me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Twitter user info');
      }

      const userData = await userResponse.json() as {
        data: {
          id: string;
          username: string;
          name?: string;
        };
      };
      const { id: twitterUserId, username: twitterHandle, name } = userData.data;

      // Create or update account
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      let account = await accountRepo.findOne({ where: { twitterUserId } });
      let isNewAccount = false;

      if (!account) {
        // Create new account
        account = accountRepo.create({
          twitterUserId,
          twitterHandle,
          accountName: name || twitterHandle,
          accountType: 'web2', // Default
          slug: twitterHandle.toLowerCase(),
        });
        await accountRepo.save(account);
        isNewAccount = true;
        logger.info(`✅ Created new DVYB account: ${account.id} (@${twitterHandle})`);
      } else {
        // Update existing account
        account.twitterHandle = twitterHandle;
        await accountRepo.save(account);
        logger.info(`✅ Updated existing DVYB account: ${account.id} (@${twitterHandle})`);
      }

      // Save/update Twitter connection
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      let connection = await connectionRepo.findOne({ where: { accountId: account.id } });

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      if (!connection) {
        connection = connectionRepo.create({
          accountId: account.id,
          twitterUserId,
          twitterHandle,
          oauth2AccessToken: access_token,
          oauth2RefreshToken: refresh_token,
          oauth2ExpiresAt: expiresAt,
          scopes: 'tweet.read tweet.write media.write users.read follows.read offline.access',
          isActive: true,
        });
      } else {
        connection.oauth2AccessToken = access_token;
        connection.oauth2RefreshToken = refresh_token;
        connection.oauth2ExpiresAt = expiresAt;
        connection.isActive = true;
      }

      await connectionRepo.save(connection);
      logger.info(`✅ Saved DVYB Twitter connection for account ${account.id}`);

      return { account, isNewAccount };
    } catch (error) {
      logger.error('❌ DVYB Twitter callback error:', error);
      throw error;
    }
  }

  /**
   * Check if account has valid Twitter connection
   */
  static async hasValidTwitterConnection(accountId: number): Promise<boolean> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true },
      });

      if (!connection || !connection.oauth2AccessToken) {
        return false;
      }

      // Check if token is expired
      if (connection.oauth2ExpiresAt && connection.oauth2ExpiresAt < new Date()) {
        logger.warn(`⚠️ DVYB Twitter token expired for account ${accountId}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('❌ Error checking DVYB Twitter connection:', error);
      return false;
    }
  }

  /**
   * Check if user has completed onboarding
   * Onboarding is complete when mediaChannels field is set in dvyb_context
   */
  static async isOnboardingComplete(accountId: number): Promise<boolean> {
    try {
      const contextRepo = AppDataSource.getRepository(DvybContext);
      const context = await contextRepo.findOne({ where: { accountId } });

      if (!context) {
        return false;
      }

      // Check if media channels have been selected (content-channels step completed)
      return !!(context.mediaChannels && Object.keys(context.mediaChannels).length > 0);
    } catch (error) {
      logger.error('❌ Error checking onboarding status:', error);
      return false;
    }
  }

  /**
   * Logout - invalidate session
   */
  static async logout(accountId: number): Promise<void> {
    try {
      // Optionally mark connection as inactive
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      await connectionRepo.update(
        { accountId },
        { isActive: false }
      );

      logger.info(`✅ DVYB account ${accountId} logged out`);
    } catch (error) {
      logger.error('❌ DVYB logout error:', error);
      throw error;
    }
  }
}

