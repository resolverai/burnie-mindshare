import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybContext } from '../models/DvybContext';
import crypto from 'crypto';
import { env } from '../config/env';

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
        scope: 'tweet.read tweet.write users.read offline.access media.write',
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

      // Get user info from Twitter (including profile image)
      const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
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
          email?: string;
          profile_image_url?: string;
        };
      };
      const { id: twitterUserId, username: twitterHandle, name, email, profile_image_url } = userData.data;

      logger.info(`✅ Twitter user authenticated: @${twitterHandle} (${twitterUserId}), email: ${email || 'not provided'}`);

      // Create or update account
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      
      // Check if Twitter connection already exists
      let connection = await connectionRepo.findOne({ where: { twitterUserId } });
      
      let account: DvybAccount | null = null;
      let isNewAccount = false;

      if (connection) {
        // Existing Twitter connection - load the account
        account = await accountRepo.findOne({ where: { id: connection.accountId } }) as DvybAccount;
        
        if (!account) {
          throw new Error('Account not found for existing Twitter connection');
        }
        
        // Update account (email only - Twitter fields are in connection table)
        if (email && !account.primaryEmail) {
          account.primaryEmail = email;
          await accountRepo.save(account);
        }
        logger.info(`✅ Updated existing DVYB account: ${account.id} (@${twitterHandle})`);
      } else {
        // New Twitter connection - check if account exists by email (auto-link)
        if (email) {
          account = await accountRepo.findOne({ where: { primaryEmail: email } }) as DvybAccount;
          
          if (account) {
            // Account exists with same email (e.g., signed in with Google before)
            // Auto-link Twitter to existing account
            logger.info(`🔗 Auto-linking Twitter to existing account ${account.id} via email ${email}`);
            
            // Twitter fields are stored in connection table, not account
            await accountRepo.save(account);
            
            logger.info(`✅ Twitter linked to existing account ${account.id}`);
          }
        }
        
        if (!account) {
          // Completely new account - create account
          isNewAccount = true;
          
          account = accountRepo.create({
            accountName: name || twitterHandle,
            primaryEmail: email || `twitter_${twitterUserId}@temp.dvyb.com`,
            accountType: 'web2',
            slug: twitterHandle.toLowerCase(),
          });
          await accountRepo.save(account);
          logger.info(`✅ Created new DVYB account: ${account.id} (@${twitterHandle})`);
        }
      }
      
      // Ensure account is defined before proceeding
      if (!account) {
        throw new Error('Failed to create or find account');
      }

      // Save/update Twitter connection
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      if (!connection) {
        // Create new Twitter connection
        connection = connectionRepo.create({
          accountId: account.id,
          twitterUserId,
          twitterHandle,
          name: name || null,
          profileImageUrl: profile_image_url || null,
          oauth2AccessToken: access_token,
          oauth2RefreshToken: refresh_token,
          oauth2ExpiresAt: expiresAt,
          scopes: 'tweet.read tweet.write users.read offline.access media.write',
          isActive: true,
        });
        logger.info(`✅ Created new Twitter connection for account ${account.id}`);
      } else {
        // Update existing Twitter connection
        connection.oauth2AccessToken = access_token;
        connection.oauth2RefreshToken = refresh_token;
        connection.oauth2ExpiresAt = expiresAt;
        connection.twitterHandle = twitterHandle;
        connection.name = name || connection.name;
        connection.profileImageUrl = profile_image_url || connection.profileImageUrl;
        connection.isActive = true;
        logger.info(`✅ Updated Twitter connection for account ${account.id}`);
      }

      await connectionRepo.save(connection);

      return { account, isNewAccount };
    } catch (error) {
      logger.error('❌ DVYB Twitter callback error:', error);
      throw error;
    }
  }

  /**
   * Check if account has valid Twitter connection
   */
  static async accountExists(accountId: number): Promise<boolean> {
    try {
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const account = await accountRepo.findOne({ where: { id: accountId } });
      return !!account;
    } catch (error) {
      logger.error('❌ Error checking if DVYB account exists:', error);
      return false;
    }
  }

  /**
   * Connect Twitter to an existing account (for users already logged in with Google)
   */
  static async connectTwitterToAccount(
    accountId: number,
    code: string,
    state: string,
    codeVerifier: string
  ): Promise<void> {
    try {
      const twitterClientId = process.env.TWITTER_CLIENT_ID;
      const twitterClientSecret = process.env.TWITTER_CLIENT_SECRET;
      const dvybCallbackUrl = process.env.DVYB_TWITTER_CALLBACK_URL || 'http://localhost:3005/auth/twitter/callback';

      if (!twitterClientId || !twitterClientSecret) {
        throw new Error('Twitter credentials not configured');
      }

      // Exchange code for tokens
      logger.info(`🔄 Connecting Twitter to account ${accountId}...`);
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
        logger.error(`❌ Twitter token exchange failed (${tokenResponse.status}): ${errorData}`);
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorData}`);
      }

      logger.info(`✅ Twitter token exchange successful`);

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      const { access_token, refresh_token, expires_in } = tokenData;

      // Get user info from Twitter (including profile image)
      const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        logger.error(`❌ Twitter API error (${userResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch Twitter user info: ${userResponse.status} ${errorText}`);
      }

      const userData = await userResponse.json() as {
        data: {
          id: string;
          username: string;
          name?: string;
          email?: string;
          profile_image_url?: string;
        };
      };
      const { id: twitterUserId, username: twitterHandle, name, profile_image_url } = userData.data;

      logger.info(`✅ Connecting Twitter @${twitterHandle} (${twitterUserId}) to account ${accountId}`);

      // Create or update Twitter connection
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      let connection = await connectionRepo.findOne({ where: { accountId } });

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      if (!connection) {
        // Create new Twitter connection
        connection = connectionRepo.create({
          accountId,
          twitterUserId,
          twitterHandle,
          name: name || null,
          profileImageUrl: profile_image_url || null,
          oauth2AccessToken: access_token,
          oauth2RefreshToken: refresh_token,
          oauth2ExpiresAt: expiresAt,
          scopes: 'tweet.read tweet.write users.read offline.access media.write',
          isActive: true,
        });
        logger.info(`✅ Created new Twitter connection for account ${accountId}`);
      } else {
        // Update existing Twitter connection
        connection.twitterUserId = twitterUserId;
        connection.twitterHandle = twitterHandle;
        connection.name = name || connection.name;
        connection.profileImageUrl = profile_image_url || connection.profileImageUrl;
        connection.oauth2AccessToken = access_token;
        connection.oauth2RefreshToken = refresh_token;
        connection.oauth2ExpiresAt = expiresAt;
        connection.isActive = true;
        logger.info(`✅ Updated Twitter connection for account ${accountId}`);
      }

      await connectionRepo.save(connection);
      logger.info(`✅ Twitter successfully connected to account ${accountId}`);
    } catch (error) {
      logger.error('❌ Twitter connection error:', error);
      throw error;
    }
  }

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
   * Onboarding is complete when logoUrl is set in dvyb_context (brand-profile step completed)
   */
  static async isOnboardingComplete(accountId: number): Promise<boolean> {
    try {
      const contextRepo = AppDataSource.getRepository(DvybContext);
      const context = await contextRepo.findOne({ where: { accountId } });

      if (!context) {
        return false;
      }

      // Onboarding is complete when user has uploaded their logo (brand-profile step)
      return !!(context.logoUrl && context.logoUrl.trim() !== '');
    } catch (error) {
      logger.error('❌ Error checking onboarding status:', error);
      return false;
    }
  }

  /**
   * Logout - invalidate session
   * Note: We don't mark Twitter connection as inactive since Google is the primary auth
   * Twitter is just a connected platform for posting/analytics
   */
  static async logout(accountId: number): Promise<void> {
    try {
      // Session is managed by Google auth, not Twitter
      // No need to mark Twitter connection as inactive
      logger.info(`✅ DVYB account ${accountId} logged out`);
    } catch (error) {
      logger.error('❌ DVYB logout error:', error);
      throw error;
    }
  }

  /**
   * Disconnect Twitter account
   */
  static async disconnectTwitter(accountId: number): Promise<void> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      await connectionRepo.update(
        { accountId },
        { isActive: false }
      );

      logger.info(`✅ Twitter disconnected for DVYB account ${accountId}`);
    } catch (error) {
      logger.error('❌ Twitter disconnect error:', error);
      throw error;
    }
  }

  /**
   * Get valid Twitter token (auto-refresh if needed)
   * Twitter tokens are valid for 2 hours, so we refresh proactively when < 1 hour remaining
   */
  static async getValidToken(accountId: number): Promise<string> {
    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({ where: { accountId, isActive: true } });

    if (!connection) {
      throw new Error('Twitter connection not found');
    }

    if (!connection.oauth2AccessToken) {
      throw new Error('Twitter access token not found');
    }

    const now = Date.now();
    const expiresAt = new Date(connection.oauth2ExpiresAt || 0).getTime();
    const hoursUntilExpiry = (expiresAt - now) / (60 * 60 * 1000);

    // Refresh if expiring in less than 1 hour (Twitter tokens valid for 2 hours)
    if (hoursUntilExpiry < 1) {
      logger.info(`🔄 Refreshing Twitter token for account ${accountId} (expires in ${hoursUntilExpiry.toFixed(1)} hours)`);
      
      const refreshed = await this.refreshTwitterToken(accountId);
      
      if (!refreshed) {
        throw new Error('Failed to refresh Twitter token');
      }
      
      // Reload connection after refresh
      const freshConnection = await connectionRepo.findOne({ where: { accountId, isActive: true } });
      
      if (!freshConnection || !freshConnection.oauth2AccessToken) {
        throw new Error('Failed to reload Twitter connection after refresh');
      }
      
      return freshConnection.oauth2AccessToken;
    }

    return connection.oauth2AccessToken;
  }

  /**
   * Refresh Twitter access token using refresh token
   */
  static async refreshTwitterToken(accountId: number): Promise<boolean> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({ where: { accountId, isActive: true } });

      if (!connection || !connection.oauth2RefreshToken) {
        logger.warn(`⚠️ No active Twitter connection or refresh token found for account ${accountId}`);
        return false;
      }

      logger.info(`🔄 Refreshing Twitter access token for account ${accountId}...`);

      const twitterClientId = env.dvybOAuth.twitter.clientId;
      const twitterClientSecret = env.dvybOAuth.twitter.clientSecret;

      const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${twitterClientId}:${twitterClientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          refresh_token: connection.oauth2RefreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        logger.error(`❌ Twitter token refresh failed (${tokenResponse.status}):`, errorData);
        
        // Only mark as inactive if the refresh token itself is invalid (401, 403)
        // Don't mark inactive for temporary errors (rate limits, network issues, etc.)
        if (tokenResponse.status === 401 || tokenResponse.status === 403) {
          logger.warn(`⚠️ Refresh token invalid for account ${accountId}, marking connection as inactive`);
          await connectionRepo.update({ accountId }, { isActive: false });
        } else {
          logger.warn(`⚠️ Temporary error refreshing token for account ${accountId}, keeping connection active`);
        }
        
        return false;
      }

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      const { access_token, refresh_token, expires_in } = tokenData;
      const newExpiresAt = new Date(Date.now() + expires_in * 1000);

      connection.oauth2AccessToken = access_token;
      if (refresh_token) {
        connection.oauth2RefreshToken = refresh_token; // Update if new refresh token provided
      }
      connection.oauth2ExpiresAt = newExpiresAt;
      connection.isActive = true;

      await connectionRepo.save(connection);

      logger.info(`✅ Twitter access token refreshed for account ${accountId}. New expiry: ${newExpiresAt}`);
      return true;
    } catch (error: any) {
      // For network errors or other exceptions, don't mark as inactive
      logger.error(`❌ Exception while refreshing Twitter token for account ${accountId}:`, error.message);
      logger.warn(`⚠️ Keeping connection active despite refresh error (network/temporary issue)`);
      return false;
    }
  }

  /**
   * Check Twitter connection status and return detailed state
   */
  static async getTwitterConnectionStatus(accountId: number): Promise<'connected' | 'expired' | 'not_connected'> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection) {
        return 'not_connected';
      }

      if (!connection.isActive) {
        return 'expired';
      }

      // Check if token is actually expired (not just expiring soon)
      const now = new Date();

      if (connection.oauth2ExpiresAt && connection.oauth2ExpiresAt < now) {
        // Token is expired - try to refresh it
        logger.info(`⚠️ Twitter token for account ${accountId} is expired. Attempting refresh...`);
        const refreshed = await this.refreshTwitterToken(accountId);
        return refreshed ? 'connected' : 'expired';
      }

      // Token is still valid (even if expiring soon)
      return 'connected';
    } catch (error) {
      logger.error('❌ Error checking Twitter connection status:', error);
      return 'not_connected';
    }
  }
}

