import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAffiliate } from '../models/DvybAffiliate';
import { DvybAffiliateReferral } from '../models/DvybAffiliateReferral';
import { DvybAffiliateCommission } from '../models/DvybAffiliateCommission';
import { DvybAffiliatePayout } from '../models/DvybAffiliatePayout';
import { DvybAffiliateBankingDetails } from '../models/DvybAffiliateBankingDetails';
import { DvybAccount } from '../models/DvybAccount';
import { DvybAccountSubscription } from '../models/DvybAccountSubscription';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { dvybAffiliateAuthMiddleware, DvybAffiliateAuthRequest } from '../middleware/dvybAffiliateAuthMiddleware';
import { env } from '../config/env';

const router = Router();

/**
 * GET /api/dvyb/affiliate/dashboard
 * Get affiliate dashboard stats
 */
router.get('/dashboard', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);
    const referralRepo = AppDataSource.getRepository(DvybAffiliateReferral);
    const commissionRepo = AppDataSource.getRepository(DvybAffiliateCommission);
    const payoutRepo = AppDataSource.getRepository(DvybAffiliatePayout);

    const affiliate = await affiliateRepo.findOne({ where: { id: affiliateId } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: 'Affiliate not found' });
    }

    // Count referrals
    const totalSignups = await referralRepo.count({ where: { affiliateId } });
    const subscribedReferrals = await referralRepo.count({ where: { affiliateId, status: 'subscribed' } });

    // Commission totals
    const commissionResult = await commissionRepo
      .createQueryBuilder('c')
      .select('SUM(c.commissionAmount)', 'total')
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .andWhere('c.status != :cancelled', { cancelled: 'cancelled' })
      .getRawOne();

    const totalCommission = parseFloat(commissionResult?.total || '0');

    // Pending commission (not yet paid)
    const pendingResult = await commissionRepo
      .createQueryBuilder('c')
      .select('SUM(c.commissionAmount)', 'total')
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .andWhere('c.status IN (:...statuses)', { statuses: ['pending', 'approved'] })
      .getRawOne();

    const pendingCommission = parseFloat(pendingResult?.total || '0');

    // Total paid out
    const paidResult = await payoutRepo
      .createQueryBuilder('p')
      .select('SUM(p.amount)', 'total')
      .where('p.affiliateId = :affiliateId', { affiliateId })
      .andWhere('p.status = :completed', { completed: 'completed' })
      .getRawOne();

    const totalPaid = parseFloat(paidResult?.total || '0');

    // Monthly commission (current month)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyResult = await commissionRepo
      .createQueryBuilder('c')
      .select('SUM(c.commissionAmount)', 'total')
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .andWhere('c.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('c.createdAt >= :monthStart', { monthStart })
      .getRawOne();

    const monthlyCommission = parseFloat(monthlyResult?.total || '0');

    // Monthly breakdown for charts (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyBreakdown = await commissionRepo
      .createQueryBuilder('c')
      .select("TO_CHAR(c.createdAt, 'YYYY-MM')", 'month')
      .addSelect('SUM(c.commissionAmount)', 'total')
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .andWhere('c.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('c.createdAt >= :twelveMonthsAgo', { twelveMonthsAgo })
      .groupBy("TO_CHAR(c.createdAt, 'YYYY-MM')")
      .orderBy("TO_CHAR(c.createdAt, 'YYYY-MM')", 'ASC')
      .getRawMany();

    // Build full 12-month series (fill gaps with 0)
    const monthlyEarnings: { month: string; earnings: number }[] = [];
    const current = new Date(twelveMonthsAgo);
    while (current <= now) {
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      const found = monthlyBreakdown.find((m: any) => m.month === key);
      monthlyEarnings.push({ month: key, earnings: parseFloat(found?.total || '0') });
      current.setMonth(current.getMonth() + 1);
    }

    // Generate referral link
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const referralLink = `${frontendUrl}?ref=${affiliate.referralCode}`;

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
          createdAt: affiliate.createdAt,
        },
        stats: {
          totalClicks: affiliate.totalClicks,
          totalSignups,
          subscribedReferrals,
          conversionRate: totalSignups > 0 ? ((subscribedReferrals / totalSignups) * 100).toFixed(1) : '0.0',
          totalCommission,
          pendingCommission,
          monthlyCommission,
          totalPaid,
          availableBalance: totalCommission - totalPaid,
        },
        monthlyEarnings,
        referralLink,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate dashboard error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/dvyb/affiliate/referrals
 * Get referred users list
 */
router.get('/referrals', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const referralRepo = AppDataSource.getRepository(DvybAffiliateReferral);

    const queryBuilder = referralRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.referredAccount', 'account')
      .where('r.affiliateId = :affiliateId', { affiliateId })
      .orderBy('r.createdAt', 'DESC');

    if (status && ['signed_up', 'subscribed', 'churned'].includes(status)) {
      queryBuilder.andWhere('r.status = :status', { status });
    }

    const total = await queryBuilder.getCount();
    const referrals = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Get subscription info for each referred account
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);

    const referralData = await Promise.all(
      referrals.map(async (ref) => {
        let subscription = null;
        let plan = null;

        if (ref.referredAccount) {
          subscription = await subscriptionRepo.findOne({
            where: { accountId: ref.referredAccountId },
            order: { createdAt: 'DESC' },
          });
          if (subscription) {
            plan = await planRepo.findOne({ where: { id: subscription.planId } });
          }
        }

        return {
          id: ref.id,
          referredAccount: ref.referredAccount ? {
            id: ref.referredAccount.id,
            name: ref.referredAccount.accountName,
            email: ref.referredAccount.primaryEmail,
            createdAt: ref.referredAccount.createdAt,
          } : null,
          status: ref.status,
          referralCode: ref.referralCode,
          signedUpAt: ref.createdAt,
          subscription: subscription ? {
            planName: plan?.planName || 'Unknown',
            billingCycle: subscription.selectedFrequency,
            status: subscription.status,
            monthlyPrice: plan ? Number(plan.monthlyPrice) : 0,
            annualPrice: plan ? Number(plan.annualPrice) : 0,
          } : null,
        };
      })
    );

    return res.json({
      success: true,
      data: {
        referrals: referralData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate referrals error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load referrals' });
  }
});

/**
 * GET /api/dvyb/affiliate/revenue
 * Get revenue/commission details
 */
router.get('/revenue', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const commissionRepo = AppDataSource.getRepository(DvybAffiliateCommission);
    const payoutRepo = AppDataSource.getRepository(DvybAffiliatePayout);

    // Get commissions with referral info
    const [commissions, totalCommissions] = await commissionRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.referral', 'referral')
      .leftJoin('referral.referredAccount', 'account')
      .addSelect(['account.id', 'account.accountName', 'account.primaryEmail'])
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const commissionData = commissions.map((c) => ({
      id: c.id,
      referredUser: c.referral?.referredAccount ? {
        name: c.referral.referredAccount.accountName,
        email: c.referral.referredAccount.primaryEmail,
      } : null,
      commissionType: c.commissionType,
      subscriptionAmount: Number(c.subscriptionAmount),
      commissionRate: Number(c.commissionRate),
      commissionAmount: Number(c.commissionAmount),
      billingCycle: c.billingCycle,
      periodLabel: c.periodLabel,
      status: c.status,
      createdAt: c.createdAt,
    }));

    // Get payouts
    const [payouts, totalPayouts] = await payoutRepo.findAndCount({
      where: { affiliateId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const payoutData = payouts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      periodLabel: p.periodLabel,
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));

    // Monthly breakdown (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyBreakdown = await commissionRepo
      .createQueryBuilder('c')
      .select("TO_CHAR(c.createdAt, 'YYYY-MM')", 'month')
      .addSelect('SUM(c.commissionAmount)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('c.affiliateId = :affiliateId', { affiliateId })
      .andWhere('c.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('c.createdAt >= :sixMonthsAgo', { sixMonthsAgo })
      .groupBy("TO_CHAR(c.createdAt, 'YYYY-MM')")
      .orderBy("TO_CHAR(c.createdAt, 'YYYY-MM')", 'DESC')
      .getRawMany();

    return res.json({
      success: true,
      data: {
        commissions: commissionData,
        pagination: {
          page,
          limit,
          total: totalCommissions,
          totalPages: Math.ceil(totalCommissions / limit),
        },
        payouts: payoutData,
        monthlyBreakdown: monthlyBreakdown.map((m: any) => ({
          month: m.month,
          total: parseFloat(m.total || '0'),
          count: parseInt(m.count || '0'),
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate revenue error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load revenue data' });
  }
});

/**
 * GET /api/dvyb/affiliate/banking
 * Get banking details
 */
router.get('/banking', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const bankingRepo = AppDataSource.getRepository(DvybAffiliateBankingDetails);

    const banking = await bankingRepo.findOne({ where: { affiliateId } });

    if (!banking) {
      return res.json({
        success: true,
        data: { banking: null },
        timestamp: new Date().toISOString(),
      });
    }

    // Mask account number for security
    const maskedAccountNumber = banking.accountNumber
      ? '****' + banking.accountNumber.slice(-4)
      : null;

    return res.json({
      success: true,
      data: {
        banking: {
          id: banking.id,
          accountHolderName: banking.accountHolderName,
          bankName: banking.bankName,
          accountNumber: maskedAccountNumber,
          routingNumber: banking.routingNumber,
          accountType: banking.accountType,
          country: banking.country,
          currency: banking.currency,
          paypalEmail: banking.paypalEmail,
          preferredMethod: banking.preferredMethod,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate banking get error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load banking details' });
  }
});

/**
 * PUT /api/dvyb/affiliate/banking
 * Update banking details
 */
router.put('/banking', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const bankingRepo = AppDataSource.getRepository(DvybAffiliateBankingDetails);

    const {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountType,
      country,
      currency,
      paypalEmail,
      preferredMethod,
    } = req.body;

    let banking = await bankingRepo.findOne({ where: { affiliateId } });

    if (!banking) {
      banking = bankingRepo.create({ affiliateId });
    }

    if (accountHolderName !== undefined) banking.accountHolderName = accountHolderName;
    if (bankName !== undefined) banking.bankName = bankName;
    if (accountNumber !== undefined) banking.accountNumber = accountNumber;
    if (routingNumber !== undefined) banking.routingNumber = routingNumber;
    if (accountType !== undefined) banking.accountType = accountType;
    if (country !== undefined) banking.country = country;
    if (currency !== undefined) banking.currency = currency;
    if (paypalEmail !== undefined) banking.paypalEmail = paypalEmail;
    if (preferredMethod !== undefined) banking.preferredMethod = preferredMethod;

    await bankingRepo.save(banking);

    logger.info(`✅ Updated banking details for affiliate ${affiliateId}`);

    return res.json({
      success: true,
      message: 'Banking details updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate banking update error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update banking details' });
  }
});

/**
 * GET /api/dvyb/affiliate/link
 * Get referral link for the affiliate
 */
router.get('/link', dvybAffiliateAuthMiddleware, async (req: DvybAffiliateAuthRequest, res: Response) => {
  try {
    const affiliateId = req.dvybAffiliateId!;
    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);

    const affiliate = await affiliateRepo.findOne({ where: { id: affiliateId } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: 'Affiliate not found' });
    }

    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const referralLink = `${frontendUrl}?ref=${affiliate.referralCode}`;
    const affiliateRecruitLink = `${frontendUrl}/affiliates/login?ref=${affiliate.referralCode}`;

    return res.json({
      success: true,
      data: {
        referralCode: affiliate.referralCode,
        referralLink,
        affiliateRecruitLink,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Affiliate link error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get referral link' });
  }
});

/**
 * POST /api/dvyb/affiliate/track-click
 * Track a click on an affiliate referral link (public, no auth required)
 */
router.post('/track-click', async (req: any, res: Response) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) {
      return res.status(400).json({ success: false, error: 'Missing referral code' });
    }

    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);
    const affiliate = await affiliateRepo.findOne({ where: { referralCode, isActive: true } });

    if (affiliate) {
      affiliate.totalClicks += 1;
      await affiliateRepo.save(affiliate);
    }

    return res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('❌ Track click error:', error);
    return res.json({ success: true, timestamp: new Date().toISOString() });
  }
});

/**
 * POST /api/dvyb/affiliate/track-signup
 * Track a signup from an affiliate referral (called internally when a new DVYB account is created)
 */
router.post('/track-signup', async (req: any, res: Response) => {
  try {
    const { referralCode, accountId } = req.body;
    if (!referralCode || !accountId) {
      return res.status(400).json({ success: false, error: 'Missing referral code or account ID' });
    }

    const affiliateRepo = AppDataSource.getRepository(DvybAffiliate);
    const referralRepo = AppDataSource.getRepository(DvybAffiliateReferral);

    const affiliate = await affiliateRepo.findOne({ where: { referralCode, isActive: true } });
    if (!affiliate) {
      return res.status(404).json({ success: false, error: 'Invalid referral code' });
    }

    // Check if this account is already referred
    const existing = await referralRepo.findOne({ where: { referredAccountId: accountId } });
    if (existing) {
      return res.json({ success: true, message: 'Already tracked', timestamp: new Date().toISOString() });
    }

    // Create referral record
    const referral = referralRepo.create({
      affiliateId: affiliate.id,
      referredAccountId: accountId,
      referralCode,
      status: 'signed_up',
    });
    await referralRepo.save(referral);

    // Update affiliate stats
    affiliate.totalSignups += 1;
    await affiliateRepo.save(affiliate);

    logger.info(`✅ Affiliate referral tracked: Account ${accountId} referred by ${affiliate.referralCode}`);

    return res.json({
      success: true,
      message: 'Signup tracked',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Track signup error:', error);
    return res.status(500).json({ success: false, error: 'Failed to track signup' });
  }
});

/**
 * GET /api/dvyb/affiliate/pricing-plans
 * Get pricing plans for commission calculation display (public).
 * Returns effective prices: deal prices when a deal is active, otherwise regular prices.
 * Deduplicates by plan name (keeps the one with the lowest effective monthly price).
 */
router.get('/pricing-plans', async (req: any, res: Response) => {
  try {
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plans = await planRepo.find({
      where: { isActive: true },
      order: { monthlyPrice: 'ASC' },
    });

    // Map to effective prices (use deal price when deal is active)
    const mapped = plans.map((p) => {
      const effectiveMonthly = p.dealActive && p.dealMonthlyPrice != null
        ? Number(p.dealMonthlyPrice)
        : Number(p.monthlyPrice);
      const effectiveAnnual = p.dealActive && p.dealAnnualPrice != null
        ? Number(p.dealAnnualPrice)
        : Number(p.annualPrice);
      return {
        id: p.id,
        planName: p.planName,
        monthlyPrice: effectiveMonthly,
        annualPrice: effectiveAnnual,
      };
    });

    // Deduplicate by plan name, keeping the entry with the lowest effective monthly price
    const deduped = new Map<string, typeof mapped[0]>();
    for (const plan of mapped) {
      const existing = deduped.get(plan.planName);
      if (!existing || plan.monthlyPrice < existing.monthlyPrice) {
        deduped.set(plan.planName, plan);
      }
    }

    const uniquePlans = Array.from(deduped.values()).sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    return res.json({
      success: true,
      data: { plans: uniquePlans },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Pricing plans error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load pricing plans' });
  }
});

export default router;
