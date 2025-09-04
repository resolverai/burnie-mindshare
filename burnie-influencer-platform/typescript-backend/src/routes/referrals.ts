import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { ReferralCode, LeaderTier } from '../models/ReferralCode';
import { UserReferral, ReferralStatus } from '../models/UserReferral';
import { User, UserAccessStatus } from '../models/User';
import { ReferralPayout } from '../models/ReferralPayout';

const router = Router();

/**
 * @route POST /api/referrals/codes
 * @desc Create a new referral code (Admin only)
 */
router.post('/codes', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      communityName,
      leaderName,
      leaderWalletAddress,
      tier = LeaderTier.SILVER,
      maxUses = 500
    } = req.body;

    if (!communityName || !leaderName || !leaderWalletAddress) {
      res.status(400).json({
        success: false,
        message: 'Community name, leader name, and wallet address are required'
      });
      return;
    }

    // Generate referral code
    const code = `LEADER-${communityName.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;

    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    
    // Check if code already exists
    const existingCode = await referralCodeRepository.findOne({ where: { code } });
    if (existingCode) {
      res.status(400).json({
        success: false,
        message: 'Referral code already exists'
      });
      return;
    }

    // Set expiry date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const referralCode = referralCodeRepository.create({
      code,
      communityName,
      leaderName,
      leaderWalletAddress: leaderWalletAddress.toLowerCase(),
      tier,
      maxUses,
      expiresAt
    });

    await referralCodeRepository.save(referralCode);

    logger.info(`✅ Created referral code: ${code} for ${leaderName}`);

    res.json({
      success: true,
      data: referralCode,
      message: 'Referral code created successfully'
    });

  } catch (error) {
    logger.error('❌ Error creating referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create referral code'
    });
  }
});

/**
 * @route GET /api/referrals/codes
 * @desc Get all referral codes (Admin only)
 */
router.get('/codes', async (req: Request, res: Response) => {
  try {
    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    
    const codes = await referralCodeRepository.find({
      relations: ['referrals'],
      order: { createdAt: 'DESC' }
    });

    res.json({
      success: true,
      data: codes
    });

  } catch (error) {
    logger.error('❌ Error fetching referral codes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral codes'
    });
  }
});

/**
 * @route PUT /api/referrals/codes/:id/tier
 * @desc Update referral code tier (Admin only)
 */
router.put('/codes/:id/tier', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { tier } = req.body;

    if (!tier || !Object.values(LeaderTier).includes(tier)) {
      res.status(400).json({
        success: false,
        message: 'Valid tier required (SILVER, GOLD, PLATINUM)'
      });
      return;
    }

    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    const referralCode = await referralCodeRepository.findOne({ where: { id: parseInt(id!) } });

    if (!referralCode) {
      res.status(404).json({
        success: false,
        message: 'Referral code not found'
      });
      return;
    }

    referralCode.tier = tier;
    await referralCodeRepository.save(referralCode);

    logger.info(`✅ Updated referral code ${referralCode.code} tier to ${tier}`);

    res.json({
      success: true,
      data: referralCode,
      message: 'Referral code tier updated successfully'
    });

  } catch (error) {
    logger.error('❌ Error updating referral code tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update referral code tier'
    });
  }
});

/**
 * @route POST /api/referrals/validate
 * @desc Validate referral code and process referral
 */
router.post('/validate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, walletAddress } = req.body;

    if (!code || !walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Referral code and wallet address are required'
      });
      return;
    }

    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    const userRepository = AppDataSource.getRepository(User);
    const userReferralRepository = AppDataSource.getRepository(UserReferral);

    // Find referral code
    const referralCode = await referralCodeRepository.findOne({ where: { code } });
    
    if (!referralCode) {
      res.status(404).json({
        success: false,
        message: 'Invalid referral code'
      });
      return;
    }

    // Check if code can be used
    if (!referralCode.canBeUsed()) {
      let reason = 'Referral code cannot be used';
      if (referralCode.isExpired()) reason = 'Referral code has expired';
      if (referralCode.isMaxUsesReached()) reason = 'Referral code has reached maximum uses';
      if (!referralCode.isActive) reason = 'Referral code is inactive';

      // Log detailed debugging information
      logger.info(`❌ Referral code validation failed: ${code}`);
      logger.info(`📅 Code expires at: ${referralCode.expiresAt}`);
      logger.info(`⏰ Current time: ${new Date()}`);
      logger.info(`⏰ Time until expiry: ${referralCode.getTimeUntilExpiry()} ms`);
      logger.info(`🔍 isExpired(): ${referralCode.isExpired()}`);
      logger.info(`🔍 isMaxUsesReached(): ${referralCode.isMaxUsesReached()}`);
      logger.info(`🔍 isActive: ${referralCode.isActive}`);
      logger.info(`🔍 Reason: ${reason}`);

      res.status(400).json({
        success: false,
        message: reason
      });
      return;
    }

    // Find or create user
    let user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });

    if (!user) {
      // Create new user - this is fine
      user = userRepository.create({
        walletAddress: walletAddress.toLowerCase(),
        accessStatus: UserAccessStatus.APPROVED,
        referralCode: code,
        roleType: 'yapper' as any
      });
      await userRepository.save(user);
      logger.info(`👤 Created new user via referral: ${walletAddress}`);
    } else {
      // SECURITY CHECK: Prevent misuse by already approved users
      if (user.accessStatus === UserAccessStatus.APPROVED) {
        logger.warn(`🚫 APPROVED user ${walletAddress} attempted to use referral code ${code} - blocked`);
        res.status(400).json({
          success: false,
          message: 'You already have platform access. Referral codes can only be used by new users.'
        });
        return;
      }

      // SECURITY CHECK: Prevent users who already have a referral code
      if (user.referralCode) {
        logger.warn(`🚫 User ${walletAddress} already has referral code ${user.referralCode} - attempted to use ${code} - blocked`);
        res.status(400).json({
          success: false,
          message: 'You have already used a referral code. Each user can only use one referral code.'
        });
        return;
      }

      // SECURITY CHECK: Prevent users who are already in the referral system
      const existingReferral = await userReferralRepository.findOne({
        where: { userId: user.id }
      });

      if (existingReferral) {
        logger.warn(`🚫 User ${walletAddress} already has referral record - attempted to use ${code} - blocked`);
        res.status(400).json({
          success: false,
          message: 'You are already part of the referral system. Each user can only be referred once.'
        });
        return;
      }

      // Only update if user is pending access and doesn't have referral code
      user.accessStatus = UserAccessStatus.APPROVED;
      user.referralCode = code;
      await userRepository.save(user);
      logger.info(`👤 Updated existing user via referral: ${walletAddress}`);
    }

    // Find referrer (community leader)
    const referrer = await userRepository.findOne({
      where: { walletAddress: referralCode.leaderWalletAddress.toLowerCase() }
    });

    // Find grand referrer (who referred the community leader)
    let grandReferrer: User | null = null;
    if (referrer && referrer.referredByUserId) {
      grandReferrer = await userRepository.findOne({
        where: { id: referrer.referredByUserId }
      });
    }

    // Create user referral record
    const userReferralData: Partial<UserReferral> = {
      userId: user.id,
      referralCodeId: referralCode.id,
      status: ReferralStatus.APPROVED
    };
    
    if (referrer?.id) {
      userReferralData.directReferrerId = referrer.id;
    }
    
    if (grandReferrer?.id) {
      userReferralData.grandReferrerId = grandReferrer.id;
    }
    
    const userReferral = userReferralRepository.create(userReferralData);

    await userReferralRepository.save(userReferral);

    // Update referral code usage
    referralCode.currentUses += 1;
    await referralCodeRepository.save(referralCode);

    // Update referrer's referral count
    if (referrer) {
      referrer.referralCount += 1;
      await userRepository.save(referrer);
    }

    logger.info(`✅ Processed referral for ${walletAddress} using code ${code}`);

    res.json({
      success: true,
      data: {
        user,
        referralCode,
        referrer: referrer ? {
          walletAddress: referrer.walletAddress,
          username: referrer.username
        } : null
      },
      message: 'Referral processed successfully'
    });

  } catch (error) {
    logger.error('❌ Error validating referral:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate referral'
    });
  }
});

/**
 * @route GET /api/referrals/analytics/:walletAddress
 * @desc Get referral analytics for a community leader
 */
router.get('/analytics/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;

    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    const userReferralRepository = AppDataSource.getRepository(UserReferral);
    const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);

    // Find referral codes for this leader
    const referralCodes = await referralCodeRepository.find({
      where: { leaderWalletAddress: walletAddress!.toLowerCase() },
      relations: ['referrals']
    });

    if (referralCodes.length === 0) {
      res.json({
        success: true,
        data: {
          totalReferrals: 0,
          totalEarnings: 0,
          activeReferrals: 0,
          codes: []
        }
      });
      return;
    }

    // Get total payouts for this leader
    const totalPayouts = await referralPayoutRepository
      .createQueryBuilder('payout')
      .where('payout.payoutWalletAddress = :walletAddress', { walletAddress: walletAddress!.toLowerCase() })
      .andWhere('payout.status = :status', { status: 'PAID' })
      .select('SUM(payout.roastAmount)', 'total')
      .getRawOne();

    // Calculate analytics
    const analytics = {
      totalReferrals: referralCodes.reduce((sum, code) => sum + code.currentUses, 0),
      totalEarnings: Number(totalPayouts?.total || 0),
      activeReferrals: referralCodes.filter(code => code.canBeUsed()).length,
      codes: referralCodes.map(code => ({
        id: code.id,
        code: code.code,
        communityName: code.communityName,
        tier: code.tier,
        currentUses: code.currentUses,
        maxUses: code.maxUses,
        totalVolumeGenerated: Number(code.totalVolumeGenerated),
        totalCommissionsEarned: Number(code.totalCommissionsEarned),
        isActive: code.isActive,
        expiresAt: code.expiresAt,
        commissionRate: code.getCommissionRate() * 100 // Convert to percentage
      }))
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('❌ Error fetching referral analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch referral analytics'
    });
  }
});

/**
 * @route GET /api/referrals/check-access/:walletAddress
 * @desc Check if user has marketplace access
 */
router.get('/check-access/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress!.toLowerCase() }
    });

    if (!user) {
      res.json({
        success: true,
        data: {
          hasAccess: false,
          status: 'PENDING_REFERRAL',
          requiresReferral: true
        }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        hasAccess: user.hasMarketplaceAccess(),
        status: user.accessStatus,
        requiresReferral: user.isPendingAccess(),
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          username: user.username,
          referralCode: user.referralCode
        }
      }
    });

  } catch (error) {
    logger.error('❌ Error checking access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check access'
    });
  }
});

/**
 * @route GET /api/referrals/my-code/:walletAddress
 * @desc Get or generate user's personal referral code
 */
router.get('/my-code/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;

    const userRepository = AppDataSource.getRepository(User);
    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);

    // Find user
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress!.toLowerCase() }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check if user already has a personal referral code
    let userReferralCode = await referralCodeRepository.findOne({
      where: { leaderWalletAddress: walletAddress!.toLowerCase() }
    });

    if (!userReferralCode) {
      // Generate unique 8-character alphanumeric code
      let code: string;
      let isUnique = false;
      
      while (!isUnique) {
        code = generateUserReferralCode();
        const existingCode = await referralCodeRepository.findOne({ where: { code } });
        if (!existingCode) {
          isUnique = true;
        }
      }

      // Create referral code for user
      userReferralCode = referralCodeRepository.create({
        code: code!,
        communityName: user.username || `User-${user.id}`,
        leaderName: user.username || `User ${user.id}`,
        leaderWalletAddress: (walletAddress as string).toLowerCase(),
        tier: 'SILVER' as any,
        maxUses: 500,
        expiresAt: (() => {
          // Create expiry date 1 year from now, ensuring proper date handling
          const now = new Date();
          const expiryDate = new Date(now);
          expiryDate.setFullYear(now.getFullYear() + 1);
          return expiryDate;
        })()
      });

      await referralCodeRepository.save(userReferralCode);
      
      // Log the expiry date for debugging
      logger.info(`✅ Generated personal referral code ${code!} for user ${walletAddress}`);
      logger.info(`📅 Referral code expires at: ${userReferralCode.expiresAt}`);
      logger.info(`⏰ Current time: ${new Date()}`);
      logger.info(`⏰ Time until expiry: ${userReferralCode.expiresAt ? userReferralCode.expiresAt.getTime() - Date.now() : 'N/A'} ms`);
    }

    res.json({
      success: true,
      data: {
        code: userReferralCode.code,
        currentUses: userReferralCode.currentUses,
        maxUses: userReferralCode.maxUses,
        tier: userReferralCode.tier
      }
    });

  } catch (error) {
    logger.error('❌ Error generating user referral code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate referral code'
    });
  }
});

// Helper function to generate random 8-character alphanumeric code
function generateUserReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default router;
