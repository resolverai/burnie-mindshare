import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybAccount } from '../models/DvybAccount';
import { DvybGoogleConnection } from '../models/DvybGoogleConnection';
import { DvybContext } from '../models/DvybContext';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { env } from '../config/env';
import crypto from 'crypto';

export class DvybGoogleAuthService {
  /**
   * Generate Google OAuth2 URL for DVYB authentication
   */
  static async generateGoogleOAuthUrl(): Promise<{
    oauthUrl: string;
    state: string;
  }> {
    try {
      const state = crypto.randomBytes(16).toString('hex');

      const googleClientId = env.dvybOAuth.google.clientId;
      const redirectUri = env.dvybOAuth.google.redirectUri;

      if (!googleClientId) {
        throw new Error('Google Client ID not configured');
      }

      const params = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        state,
        access_type: 'offline', // Get refresh token
        prompt: 'consent', // Force consent screen to always get refresh token
      });

      const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      logger.info('✅ Generated DVYB Google OAuth URL');
      return { oauthUrl, state };
    } catch (error) {
      logger.error('❌ Failed to generate DVYB Google OAuth URL:', error);
      throw error;
    }
  }

  /**
   * Handle Google OAuth callback and create/update account
   * @param signInOnly - If true, only allow existing users; do not create new accounts. Throws ACCOUNT_NOT_FOUND if user not in dvyb_accounts.
   */
  static async handleGoogleCallback(
    code: string,
    state: string,
    initialAcquisitionFlow?: 'website_analysis' | 'product_photoshot',
    signInOnly?: boolean
  ): Promise<{
    account: DvybAccount;
    isNewAccount: boolean;
    onboardingComplete: boolean;
  }> {
    try {
      const googleClientId = env.dvybOAuth.google.clientId;
      const googleClientSecret = env.dvybOAuth.google.clientSecret;
      const redirectUri = env.dvybOAuth.google.redirectUri;

      if (!googleClientId || !googleClientSecret) {
        throw new Error('Google credentials not configured');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorData}`);
      }

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        id_token: string;
      };
      const { access_token, refresh_token, expires_in, id_token } = tokenData;

      // Get user info from Google
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Google user info');
      }

      const userData = await userResponse.json() as {
        id: string;
        email: string;
        name: string;
        picture: string;
        verified_email: boolean;
      };

      const { id: googleId, email, name, picture } = userData;

      logger.info(`✅ Google user authenticated: ${email} (${googleId})`);

      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const googleConnRepo = AppDataSource.getRepository(DvybGoogleConnection);
      const contextRepo = AppDataSource.getRepository(DvybContext);

      // Check if Google connection already exists
      let googleConnection = await googleConnRepo.findOne({
        where: { googleId },
      });

      let account: DvybAccount;
      let isNewAccount = false;

      if (googleConnection) {
        // Existing Google connection - load the account
        account = await accountRepo.findOne({
          where: { id: googleConnection.accountId },
        }) as DvybAccount;

        if (!account) {
          throw new Error('Account not found for existing Google connection');
        }

        // Update Google connection tokens
        googleConnection.accessToken = access_token;
        if (refresh_token) {
          googleConnection.refreshToken = refresh_token;
        }
        googleConnection.tokenExpiry = new Date(Date.now() + expires_in * 1000);
        googleConnection.name = name;
        googleConnection.profilePicture = picture;
        await googleConnRepo.save(googleConnection);

        logger.info(`✅ Updated existing Google connection for account ${account.id}`);
      } else {
        // New Google connection - check if account exists by email
        account = await accountRepo.findOne({
          where: { primaryEmail: email },
        }) as DvybAccount;

        if (account) {
          // Account exists with same email - link Google connection
          logger.info(`🔗 Linking Google to existing account ${account.id} via email ${email}`);
          
          googleConnection = googleConnRepo.create({
            accountId: account.id,
            googleId,
            email,
            name,
            profilePicture: picture,
            accessToken: access_token,
            refreshToken: refresh_token || '',
            tokenExpiry: new Date(Date.now() + expires_in * 1000),
          });
          await googleConnRepo.save(googleConnection);

          logger.info(`✅ Google linked to existing account ${account.id}`);
        } else {
          // Completely new account - create account + Google connection
          // Sign-in-only flow: do NOT create, throw so frontend can show "not registered" modal
          if (signInOnly) {
            logger.info(`⚠️ Sign-in-only flow: Google user ${email} not found in dvyb_accounts - rejecting`);
            const err = new Error('Account not found. Please sign up first.');
            (err as any).code = 'ACCOUNT_NOT_FOUND';
            throw err;
          }

          isNewAccount = true;

          account = accountRepo.create({
            accountName: name,
            primaryEmail: email,
            accountType: 'web2',
            // Set initial acquisition flow - only on first account creation, never updated
            initialAcquisitionFlow: initialAcquisitionFlow || null,
          });
          await accountRepo.save(account);
          
          logger.info(`📊 New account created with initialAcquisitionFlow: ${initialAcquisitionFlow || 'not specified'}`);

          googleConnection = googleConnRepo.create({
            accountId: account.id,
            googleId,
            email,
            name,
            profilePicture: picture,
            accessToken: access_token,
            refreshToken: refresh_token || '',
            tokenExpiry: new Date(Date.now() + expires_in * 1000),
          });
          await googleConnRepo.save(googleConnection);

          logger.info(`✅ Created new account ${account.id} with Google connection`);

          // 🎁 Auto-associate Free Trial plan with new account
          await this.associateFreeTrialPlan(account.id);
        }
      }

      // Check if onboarding is complete
      const context = await contextRepo.findOne({
        where: { accountId: account.id },
      });
      const onboardingComplete = !!context;

      return {
        account,
        isNewAccount,
        onboardingComplete,
      };
    } catch (error) {
      logger.error('❌ Google callback error:', error);
      throw error;
    }
  }

  /**
   * Refresh Google access token using refresh token
   */
  static async refreshGoogleToken(accountId: number): Promise<boolean> {
    try {
      const googleConnRepo = AppDataSource.getRepository(DvybGoogleConnection);
      const connection = await googleConnRepo.findOne({
        where: { accountId },
      });

      if (!connection || !connection.refreshToken) {
        logger.warn(`⚠️ No Google refresh token found for account ${accountId}`);
        return false;
      }

      const googleClientId = env.dvybOAuth.google.clientId;
      const googleClientSecret = env.dvybOAuth.google.clientSecret;

      logger.info(`🔄 Refreshing Google access token for account ${accountId}...`);

      // Request new access token using refresh token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          refresh_token: connection.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        logger.error(`❌ Google token refresh failed (${tokenResponse.status}): ${errorData}`);
        return false;
      }

      const tokenData = await tokenResponse.json() as {
        access_token: string;
        expires_in: number;
        scope: string;
        token_type: string;
      };

      // Update connection with new access token
      connection.accessToken = tokenData.access_token;
      connection.tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);
      await googleConnRepo.save(connection);

      logger.info(`✅ Google access token refreshed for account ${accountId}, new expiry: ${connection.tokenExpiry}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error refreshing Google token for account ${accountId}:`, error);
      return false;
    }
  }

  /**
   * Check if account has valid Google connection (auto-refreshes if needed)
   */
  static async hasValidGoogleConnection(accountId: number): Promise<boolean> {
    try {
      const googleConnRepo = AppDataSource.getRepository(DvybGoogleConnection);
      const connection = await googleConnRepo.findOne({
        where: { accountId },
      });

      if (!connection || !connection.tokenExpiry) {
        return false;
      }

      // Check if token is expired or expiring soon (within 5 minutes)
      const now = new Date();
      const expiryWithBuffer = new Date(connection.tokenExpiry.getTime() - 5 * 60 * 1000);
      
      if (now >= expiryWithBuffer) {
        // Token expired or expiring soon - try to refresh
        logger.info(`🔄 Google token expired/expiring for account ${accountId}, attempting refresh...`);
        return await this.refreshGoogleToken(accountId);
      }

      // Token is still valid
      return true;
    } catch (error) {
      logger.error(`❌ Error checking Google connection for account ${accountId}:`, error);
      return false;
    }
  }

  /**
   * Check if account exists
   */
  static async accountExists(accountId: number): Promise<boolean> {
    try {
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const account = await accountRepo.findOne({ where: { id: accountId } });
      return !!account;
    } catch (error) {
      logger.error(`❌ Error checking if DVYB account ${accountId} exists:`, error);
      return false;
    }
  }

  /**
   * Check if onboarding is complete for an account
   * Onboarding is complete when logoUrl is set in dvyb_context (brand-profile step completed)
   */
  static async isOnboardingComplete(accountId: number): Promise<boolean> {
    try {
      const contextRepo = AppDataSource.getRepository(DvybContext);
      const context = await contextRepo.findOne({
        where: { accountId },
      });
      
      if (!context) {
        return false;
      }
      
      // Onboarding is complete when user has uploaded their logo (brand-profile step)
      return !!(context.logoUrl && context.logoUrl.trim() !== '');
    } catch (error) {
      logger.error(`❌ Error checking onboarding status for account ${accountId}:`, error);
      return false;
    }
  }

  /**
   * Disconnect Google account by clearing tokens
   */
  static async disconnect(accountId: number): Promise<void> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybGoogleConnection);
      await connectionRepo.update(
        { accountId },
        { 
          accessToken: '',
          refreshToken: '',
          tokenExpiry: new Date(0), // Set to epoch (expired)
        }
      );

      logger.info(`✅ Google disconnected for DVYB account ${accountId}`);
    } catch (error) {
      logger.error('❌ Google disconnect error:', error);
      throw error;
    }
  }

  /**
   * Get user info for Mixpanel tracking (email, name, accountName)
   */
  static async getUserInfo(accountId: number): Promise<{
    email: string | null;
    name: string | null;
    accountName: string | null;
  }> {
    try {
      const googleConnRepo = AppDataSource.getRepository(DvybGoogleConnection);
      const contextRepo = AppDataSource.getRepository(DvybContext);

      // Get email and name from Google connection
      const googleConnection = await googleConnRepo.findOne({
        where: { accountId },
      });

      // Get accountName from context
      const context = await contextRepo.findOne({
        where: { accountId },
      });

      return {
        email: googleConnection?.email || null,
        name: googleConnection?.name || null,
        accountName: context?.accountName || null,
      };
    } catch (error) {
      logger.error(`❌ Error getting user info for account ${accountId}:`, error);
      return { email: null, name: null, accountName: null };
    }
  }

  /**
   * 🎁 Auto-associate Free Trial plan with new account
   */
  static async associateFreeTrialPlan(accountId: number): Promise<void> {
    try {
      const planRepo = AppDataSource.getRepository(DvybPricingPlan);
      const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);

      // Find the free trial plan (always use website_analysis flow)
      const freeTrialPlan = await planRepo.findOne({
        where: { isFreeTrialPlan: true, isActive: true, planFlow: 'website_analysis' },
      });

      if (!freeTrialPlan) {
        logger.warn(`⚠️ No active free trial plan found for account ${accountId} - skipping auto-association`);
        return;
      }

      // Create account plan association (default to monthly frequency)
      const newAccountPlan = accountPlanRepo.create({
        accountId,
        planId: freeTrialPlan.id,
        selectedFrequency: 'monthly', // Default to monthly for free trial
        startDate: new Date(),
        endDate: null,
        status: 'active',
        changeType: 'initial',
        notes: 'Auto-assigned free trial plan on account creation',
      });

      await accountPlanRepo.save(newAccountPlan);

      logger.info(`🎁 Auto-associated Free Trial plan "${freeTrialPlan.planName}" (ID: ${freeTrialPlan.id}) with new account ${accountId}`);
    } catch (error) {
      logger.error(`❌ Failed to auto-associate free trial plan with account ${accountId}:`, error);
      // Don't throw - account creation should succeed even if plan association fails
    }
  }
}

