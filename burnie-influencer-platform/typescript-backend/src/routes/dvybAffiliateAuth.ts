import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { AppDataSource } from '../config/database';
import { DvybAffiliate } from '../models/DvybAffiliate';
import { dvybAffiliateAuthMiddleware, DvybAffiliateAuthRequest } from '../middleware/dvybAffiliateAuthMiddleware';
import crypto from 'crypto';

const router = Router();

// Store OAuth states temporarily
const affiliateOAuthStates = new Map<string, { timestamp: number }>();

// Cleanup old states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of affiliateOAuthStates.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      affiliateOAuthStates.delete(state);
    }
  }
}, 10 * 60 * 1000);

/**
 * Generate a unique referral code
 */
function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'DVYB-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Determine commission tier based on current date (founding = first 3 months from launch)
 */
function getCommissionTier(): { tier: 'founding' | 'standard'; rate: number; secondTierRate: number; durationMonths: number } {
  const launchDate = new Date(process.env.DVYB_AFFILIATE_LAUNCH_DATE || '2026-03-01');
  const foundingEndDate = new Date(launchDate);
  foundingEndDate.setMonth(foundingEndDate.getMonth() + 3);
  const now = new Date();

  if (now <= foundingEndDate) {
    return { tier: 'founding', rate: 40, secondTierRate: 10, durationMonths: 0 }; // 0 = lifetime
  }
  return { tier: 'standard', rate: 25, secondTierRate: 0, durationMonths: 12 };
}

/**
 * GET /api/dvyb/affiliate/auth/google/login
 * Generate Google OAuth URL for affiliate signup/login
 */
router.get('/google/login', async (req: Request, res: Response) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    const googleClientId = env.dvybOAuth.google.clientId;
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const redirectUri = `${frontendUrl}/affiliates/auth/google/callback`;

    if (!googleClientId) {
      throw new Error('Google Client ID not configured');
    }

    affiliateOAuthStates.set(state, { timestamp: Date.now() });

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    logger.info('✅ Generated affiliate Google OAuth URL');
    return res.json({
      success: true,
      data: { oauth_url: oauthUrl, state },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate Google OAuth URL error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate Google login URL',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/affiliate/auth/google/callback
 * Handle Google OAuth callback for affiliates
 */
router.post('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify state
    const stateData = affiliateOAuthStates.get(state);
    if (!stateData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired state',
        timestamp: new Date().toISOString(),
      });
    }
    affiliateOAuthStates.delete(state);

    const googleClientId = env.dvybOAuth.google.clientId;
    const googleClientSecret = env.dvybOAuth.google.clientSecret;
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const redirectUri = `${frontendUrl}/affiliates/auth/google/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

    const tokenData = await tokenResponse.json() as { access_token: string; id_token: string };

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info from Google');
    }

    const userInfo = await userInfoResponse.json() as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
    };

    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);

    // Check if affiliate already exists
    let affiliate = await affiliateRepo.findOne({ where: { email: userInfo.email } });
    let isNewAffiliate = false;

    if (!affiliate) {
      // Create new affiliate
      isNewAffiliate = true;
      const { tier, rate, secondTierRate, durationMonths } = getCommissionTier();

      // Check for parent referral code in request
      const parentReferralCode = req.body.parentReferralCode;
      let parentAffiliateId: number | null = null;
      if (parentReferralCode) {
        const parent = await affiliateRepo.findOne({ where: { referralCode: parentReferralCode, isActive: true } });
        if (parent) {
          parentAffiliateId = parent.id;
        }
      }

      // Generate unique referral code
      let referralCode = generateReferralCode();
      while (await affiliateRepo.findOne({ where: { referralCode } })) {
        referralCode = generateReferralCode();
      }

      affiliate = affiliateRepo.create({
        name: userInfo.name,
        email: userInfo.email,
        profilePicture: userInfo.picture || null,
        googleId: userInfo.sub,
        referralCode,
        commissionTier: tier,
        commissionRate: rate,
        secondTierRate,
        commissionDurationMonths: durationMonths,
        parentAffiliateId,
        isActive: true,
      });

      await affiliateRepo.save(affiliate);
      logger.info(`✅ New affiliate created: ${affiliate.email} (${tier} tier, ${rate}% commission)`);
    } else {
      // Update profile picture and Google ID if changed
      let needsSave = false;
      if (userInfo.picture && affiliate.profilePicture !== userInfo.picture) {
        affiliate.profilePicture = userInfo.picture;
        needsSave = true;
      }
      if (userInfo.sub && affiliate.googleId !== userInfo.sub) {
        affiliate.googleId = userInfo.sub;
        needsSave = true;
      }
      if (needsSave) {
        await affiliateRepo.save(affiliate);
      }
      logger.info(`✅ Existing affiliate logged in: ${affiliate.email}`);
    }

    // Set session cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('dvyb_affiliate_id', affiliate.id.toString(), {
      httpOnly: false,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return res.json({
      success: true,
      data: {
        affiliate: {
          id: affiliate.id,
          name: affiliate.name,
          email: affiliate.email,
          profilePicture: affiliate.profilePicture,
          referralCode: affiliate.referralCode,
          commissionTier: affiliate.commissionTier,
          commissionRate: Number(affiliate.commissionRate),
          secondTierRate: Number(affiliate.secondTierRate),
          commissionDurationMonths: affiliate.commissionDurationMonths,
        },
        isNewAffiliate,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate Google OAuth callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/affiliate/auth/status
 * Check affiliate authentication status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const affiliateIdFromCookie = req.cookies?.dvyb_affiliate_id;
    const affiliateIdFromHeader = req.headers['x-dvyb-affiliate-id'] as string;
    const affiliateId = affiliateIdFromCookie || affiliateIdFromHeader;

    if (!affiliateId) {
      return res.json({
        success: true,
        data: { authenticated: false },
        timestamp: new Date().toISOString(),
      });
    }

    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);
    const affiliate = await affiliateRepo.findOne({ where: { id: parseInt(affiliateId, 10) } });

    if (!affiliate || !affiliate.isActive) {
      return res.json({
        success: true,
        data: { authenticated: false },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        authenticated: true,
        affiliateId: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        profilePicture: affiliate.profilePicture,
        referralCode: affiliate.referralCode,
        commissionTier: affiliate.commissionTier,
        commissionRate: Number(affiliate.commissionRate),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate auth status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check authentication status',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/affiliate/auth/logout
 * Logout affiliate
 */
router.post('/logout', (req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('dvyb_affiliate_id', '', {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 0,
    path: '/',
  });

  return res.json({
    success: true,
    message: 'Logged out successfully',
    timestamp: new Date().toISOString(),
  });
});

export default router;
