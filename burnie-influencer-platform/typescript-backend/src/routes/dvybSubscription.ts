import { Router, Response } from 'express';
import { In } from 'typeorm';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { StripeService } from '../services/StripeService';
import { AppDataSource } from '../config/database';
import { DvybAccountSubscription } from '../models/DvybAccountSubscription';
import { DvybAccountPayment } from '../models/DvybAccountPayment';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybAccount } from '../models/DvybAccount';
import { logger } from '../config/logger';
import { env } from '../config/env';

const router = Router();

/**
 * POST /api/dvyb/subscription/checkout
 * Create a Stripe Checkout session for subscription
 */
router.post('/checkout', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { planId, frequency, promoCode, successUrl: customSuccessUrl, cancelUrl: customCancelUrl } = req.body;

    if (!planId || !frequency) {
      return res.status(400).json({ success: false, error: 'planId and frequency are required' });
    }

    // Verify plan exists and has Stripe configuration
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({ where: { id: planId, isActive: true } });

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const priceId = frequency === 'monthly' ? plan.stripeMonthlyPriceId : plan.stripeAnnualPriceId;
    if (!priceId) {
      return res.status(400).json({ success: false, error: 'Stripe not configured for this plan' });
    }

    // Check if user already has an active subscription
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const existingSubscription = await subscriptionRepo.findOne({
      where: { accountId, status: 'active' },
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: 'You already have an active subscription. Use upgrade/downgrade instead.',
        hasActiveSubscription: true,
      });
    }

    // Create checkout session - use custom URLs if provided and valid (same origin)
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';
    const baseUrl = frontendUrl.replace(/\/$/, '');
    const isValidUrl = (url: string) => typeof url === 'string' && url.startsWith(baseUrl);
    const successUrl = (customSuccessUrl && isValidUrl(customSuccessUrl))
      ? customSuccessUrl
      : `${frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = (customCancelUrl && isValidUrl(customCancelUrl))
      ? customCancelUrl
      : `${frontendUrl}/subscription/cancel`;

    const checkoutUrl = await StripeService.createCheckoutSession({
      accountId,
      planId,
      frequency,
      promoCode,
      successUrl,
      cancelUrl,
    });

    return res.json({ success: true, checkoutUrl });
  } catch (error: any) {
    logger.error('Error creating checkout session:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create checkout session' });
  }
});

/**
 * POST /api/dvyb/subscription/upgrade
 * Upgrade to a higher plan with immediate proration
 */
router.post('/upgrade', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { planId, frequency } = req.body;

    if (!planId || !frequency) {
      return res.status(400).json({ success: false, error: 'planId and frequency are required' });
    }

    // Get current subscription
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const currentSubscription = await subscriptionRepo.findOne({
      where: { accountId, status: 'active' },
      relations: ['plan'],
    });

    if (!currentSubscription) {
      return res.status(400).json({ success: false, error: 'No active subscription found' });
    }

    // Verify new plan
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const newPlan = await planRepo.findOne({ where: { id: planId, isActive: true } });

    if (!newPlan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    // Determine if this is an upgrade (higher price)
    const currentPrice = currentSubscription.selectedFrequency === 'monthly'
      ? Number(currentSubscription.plan.monthlyPrice)
      : Number(currentSubscription.plan.annualPrice);
    const newPrice = frequency === 'monthly'
      ? Number(newPlan.monthlyPrice)
      : Number(newPlan.annualPrice);

    if (newPrice <= currentPrice) {
      return res.status(400).json({
        success: false,
        error: 'This is not an upgrade. Use the downgrade endpoint instead.',
      });
    }

    const result = await StripeService.upgradeSubscription({
      accountId,
      currentSubscriptionId: currentSubscription.id,
      newPlanId: planId,
      newFrequency: frequency,
    });

    return res.json(result);
  } catch (error: any) {
    logger.error('Error upgrading subscription:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to upgrade subscription' });
  }
});

/**
 * POST /api/dvyb/subscription/downgrade
 * Schedule a downgrade for end of billing period
 */
router.post('/downgrade', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { planId, frequency } = req.body;

    if (!planId || !frequency) {
      return res.status(400).json({ success: false, error: 'planId and frequency are required' });
    }

    // Get current subscription
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const currentSubscription = await subscriptionRepo.findOne({
      where: { accountId, status: 'active' },
      relations: ['plan'],
    });

    if (!currentSubscription) {
      return res.status(400).json({ success: false, error: 'No active subscription found' });
    }

    // Verify new plan
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const newPlan = await planRepo.findOne({ where: { id: planId, isActive: true } });

    if (!newPlan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const result = await StripeService.scheduleDowngrade({
      accountId,
      currentSubscriptionId: currentSubscription.id,
      newPlanId: planId,
      newFrequency: frequency,
    });

    return res.json(result);
  } catch (error: any) {
    logger.error('Error scheduling downgrade:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to schedule downgrade' });
  }
});

/**
 * POST /api/dvyb/subscription/switch-billing-cycle
 * Switch billing cycle on same plan (monthly <-> annual)
 */
router.post('/switch-billing-cycle', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { newFrequency } = req.body;

    if (!newFrequency || !['monthly', 'annual'].includes(newFrequency)) {
      return res.status(400).json({ success: false, error: 'Valid newFrequency (monthly or annual) is required' });
    }

    // Get current subscription with plan
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const currentSubscription = await subscriptionRepo.findOne({
      where: { accountId, status: 'active' },
      relations: ['plan'],
    });

    if (!currentSubscription) {
      return res.status(400).json({ success: false, error: 'No active subscription found' });
    }

    if (!currentSubscription.plan) {
      return res.status(400).json({ success: false, error: 'Subscription plan not found' });
    }

    // Check if already on the same frequency
    if (currentSubscription.selectedFrequency === newFrequency) {
      return res.status(400).json({ success: false, error: `Already on ${newFrequency} billing` });
    }

    const planId = currentSubscription.planId;

    if (newFrequency === 'annual') {
      // Monthly → Annual: User pays more upfront, use upgrade flow with proration
      logger.info(`🔄 Switching account ${accountId} from monthly to annual on plan ${planId}`);
      
      const result = await StripeService.upgradeSubscription({
        accountId,
        currentSubscriptionId: currentSubscription.id,
        newPlanId: planId,
        newFrequency: 'annual',
      });

      return res.json(result);
    } else {
      // Annual → Monthly: Schedule for end of billing period (no immediate charge)
      logger.info(`🔄 Scheduling account ${accountId} switch from annual to monthly on plan ${planId}`);
      
      const result = await StripeService.scheduleDowngrade({
        accountId,
        currentSubscriptionId: currentSubscription.id,
        newPlanId: planId,
        newFrequency: 'monthly',
      });

      return res.json(result);
    }
  } catch (error: any) {
    logger.error('Error switching billing cycle:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to switch billing cycle' });
  }
});

/**
 * POST /api/dvyb/subscription/cancel
 * Cancel subscription - immediately for trialing, at period end for active
 */
router.post('/cancel', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    // Get current subscription (including both active and trialing)
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const subscription = await subscriptionRepo.findOne({
      where: { accountId, status: In(['active', 'trialing']) },
    });

    if (!subscription) {
      return res.status(400).json({ success: false, error: 'No active subscription found' });
    }

    const result = await StripeService.cancelSubscription(accountId, subscription.id);
    return res.json(result);
  } catch (error: any) {
    logger.error('Error canceling subscription:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/dvyb/subscription/resume
 * Resume a subscription scheduled for cancellation
 */
router.post('/resume', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const subscription = await subscriptionRepo.findOne({
      where: { accountId, cancelAtPeriodEnd: true },
    });

    if (!subscription) {
      return res.status(400).json({ success: false, error: 'No subscription scheduled for cancellation' });
    }

    const result = await StripeService.resumeSubscription(accountId, subscription.id);
    return res.json(result);
  } catch (error: any) {
    logger.error('Error resuming subscription:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to resume subscription' });
  }
});

/**
 * GET /api/dvyb/subscription/current
 * Get current subscription details
 */
router.get('/current', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    // Always fetch account to get initialAcquisitionFlow
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({
      where: { id: accountId },
    });

    const subscription = await StripeService.getAccountSubscription(accountId);

    if (!subscription) {
      // Check if user has a free plan
      const planRepo = AppDataSource.getRepository(DvybPricingPlan);

      if (account?.currentPlanId) {
        const currentPlan = await planRepo.findOne({ where: { id: account.currentPlanId } });
        if (currentPlan) {
          return res.json({
            success: true,
            data: {
              isSubscribed: false,
              currentPlan: currentPlan,
              isFree: currentPlan.isFreeTrialPlan,
              initialAcquisitionFlow: account.initialAcquisitionFlow,
            },
          });
        }
      }

      return res.json({ 
        success: true, 
        data: { 
          isSubscribed: false, 
          currentPlan: null,
          initialAcquisitionFlow: account?.initialAcquisitionFlow || null,
        } 
      });
    }

    return res.json({
      success: true,
      data: {
        isSubscribed: true,
        initialAcquisitionFlow: account?.initialAcquisitionFlow || null,
        subscription: {
          id: subscription.id,
          planId: subscription.planId,
          plan: subscription.plan,
          frequency: subscription.selectedFrequency,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          pendingPlanId: subscription.pendingPlanId,
          pendingFrequency: subscription.pendingFrequency,
          trialStart: subscription.trialStart,
          trialEnd: subscription.trialEnd,
        },
      },
    });
  } catch (error: any) {
    logger.error('Error fetching subscription:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch subscription' });
  }
});

/**
 * GET /api/dvyb/subscription/billing-portal
 * Get a link to the Stripe billing portal
 */
router.get('/billing-portal', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const frontendUrl = env.dvybOAuth.frontendUrl || 'http://localhost:3005';

    const portalUrl = await StripeService.createBillingPortalSession(accountId, `${frontendUrl}/brand-kit`);

    return res.json({ success: true, portalUrl });
  } catch (error: any) {
    logger.error('Error creating billing portal session:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create billing portal session' });
  }
});

/**
 * GET /api/dvyb/subscription/payments
 * Get payment history
 */
router.get('/payments', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const limit = parseInt(req.query.limit as string) || 10;

    const payments = await StripeService.getPaymentHistory(accountId, limit);

    return res.json({ success: true, data: payments });
  } catch (error: any) {
    logger.error('Error fetching payment history:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch payment history' });
  }
});

export default router;

