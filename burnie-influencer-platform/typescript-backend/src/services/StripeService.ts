import Stripe from 'stripe';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybAccountSubscription } from '../models/DvybAccountSubscription';
import { DvybAccountPayment } from '../models/DvybAccountPayment';
import { DvybPromoCode } from '../models/DvybPromoCode';
import { DvybGoogleConnection } from '../models/DvybGoogleConnection';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { IsNull } from 'typeorm';

// Initialize Stripe with secret key
const stripe = new Stripe(env.stripe.secretKey);

export class StripeService {
  /**
   * Create a Stripe Product and Price for a new pricing plan
   */
  static async createStripeProductAndPrices(plan: DvybPricingPlan): Promise<{
    productId: string;
    monthlyPriceId: string;
    annualPriceId: string;
  }> {
    try {
      logger.info(`📦 Creating Stripe product for plan: ${plan.planName}`);

      // Create the Stripe product
      const productParams: Stripe.ProductCreateParams = {
        name: plan.planName,
        metadata: {
          dvybPlanId: plan.id.toString(),
        },
      };
      if (plan.description) {
        productParams.description = plan.description;
      }
      const product = await stripe.products.create(productParams);

      // Create monthly price
      const monthlyPrice = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: Math.round(Number(plan.monthlyPrice) * 100), // Convert to cents
        recurring: {
          interval: 'month',
        },
        metadata: {
          dvybPlanId: plan.id.toString(),
          frequency: 'monthly',
        },
      });

      // Create annual price
      const annualPrice = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: Math.round(Number(plan.annualPrice) * 100), // Convert to cents
        recurring: {
          interval: 'year',
        },
        metadata: {
          dvybPlanId: plan.id.toString(),
          frequency: 'annual',
        },
      });

      logger.info(`✅ Created Stripe product ${product.id} with monthly price ${monthlyPrice.id} and annual price ${annualPrice.id}`);

      return {
        productId: product.id,
        monthlyPriceId: monthlyPrice.id,
        annualPriceId: annualPrice.id,
      };
    } catch (error) {
      logger.error('❌ Error creating Stripe product and prices:', error);
      throw error;
    }
  }

  /**
   * Update Stripe product details when plan is modified
   */
  static async updateStripeProduct(productId: string, updates: { name?: string; description?: string }): Promise<void> {
    try {
      const updateParams: Stripe.ProductUpdateParams = {};
      if (updates.name) updateParams.name = updates.name;
      if (updates.description) updateParams.description = updates.description;
      
      await stripe.products.update(productId, updateParams);
      logger.info(`✅ Updated Stripe product ${productId}`);
    } catch (error) {
      logger.error(`❌ Error updating Stripe product ${productId}:`, error);
      throw error;
    }
  }

  /**
   * Get or create a Stripe Customer for a DVYB account
   */
  static async getOrCreateCustomer(accountId: number): Promise<string> {
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Return existing customer if we have one
    if (account.stripeCustomerId) {
      return account.stripeCustomerId;
    }

    // Get email from Google connection
    const googleConnectionRepo = AppDataSource.getRepository(DvybGoogleConnection);
    const googleConnection = await googleConnectionRepo.findOne({ where: { accountId } });

    const email = googleConnection?.email;
    const name = account.accountName || googleConnection?.name;

    // Create new customer
    const customerParams: Stripe.CustomerCreateParams = {
      metadata: {
        dvybAccountId: accountId.toString(),
      },
    };
    if (email) customerParams.email = email;
    if (name) customerParams.name = name;
    
    const customer = await stripe.customers.create(customerParams);

    // Save customer ID to account
    account.stripeCustomerId = customer.id;
    await accountRepo.save(account);

    logger.info(`✅ Created Stripe customer ${customer.id} for account ${accountId}`);
    return customer.id;
  }

  /**
   * Create a Stripe Checkout Session for subscription
   */
  static async createCheckoutSession(params: {
    accountId: number;
    planId: number;
    frequency: 'monthly' | 'annual';
    promoCode?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const { accountId, planId, frequency, promoCode, successUrl, cancelUrl } = params;

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({ where: { id: planId } });

    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const priceId = frequency === 'monthly' ? plan.stripeMonthlyPriceId : plan.stripeAnnualPriceId;
    if (!priceId) {
      throw new Error(`Stripe price not configured for plan ${planId} (${frequency})`);
    }

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(accountId);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          dvybAccountId: accountId.toString(),
          dvybPlanId: planId.toString(),
          frequency,
        },
      },
      metadata: {
        dvybAccountId: accountId.toString(),
        dvybPlanId: planId.toString(),
        frequency,
      },
    };

    // Apply promo code if provided
    if (promoCode) {
      const promoCodeRepo = AppDataSource.getRepository(DvybPromoCode);
      const promo = await promoCodeRepo.findOne({
        where: { code: promoCode.toUpperCase(), isActive: true },
      });

      if (promo && promo.stripePromotionCodeId) {
        sessionParams.discounts = [{ promotion_code: promo.stripePromotionCodeId }];
      } else {
        logger.warn(`Promo code ${promoCode} not found or not linked to Stripe`);
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info(`✅ Created Checkout Session ${session.id} for account ${accountId}`);
    return session.url!;
  }

  /**
   * Create a billing portal session for managing subscriptions
   */
  static async createBillingPortalSession(accountId: number, returnUrl: string): Promise<string> {
    const customerId = await this.getOrCreateCustomer(accountId);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Handle subscription upgrade with immediate proration
   * Returns checkoutUrl if 3DS/SCA authentication is required
   */
  static async upgradeSubscription(params: {
    accountId: number;
    currentSubscriptionId: number;
    newPlanId: number;
    newFrequency: 'monthly' | 'annual';
  }): Promise<{ success: boolean; message: string; requiresAction?: boolean; checkoutUrl?: string }> {
    const { accountId, currentSubscriptionId, newPlanId, newFrequency } = params;

    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);

    const currentSubscription = await subscriptionRepo.findOne({
      where: { id: currentSubscriptionId, accountId },
    });

    if (!currentSubscription) {
      throw new Error('Subscription not found');
    }

    const newPlan = await planRepo.findOne({ where: { id: newPlanId } });
    if (!newPlan) {
      throw new Error('New plan not found');
    }

    const newPriceId = newFrequency === 'monthly' ? newPlan.stripeMonthlyPriceId : newPlan.stripeAnnualPriceId;
    if (!newPriceId) {
      throw new Error('Stripe price not configured for new plan');
    }

    // Get the Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId);

    // Get the first subscription item
    const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
    if (!subscriptionItemId) {
      throw new Error('No subscription item found');
    }

    // Update with proration - use 'pending_if_incomplete' to allow for 3DS handling
    const updatedSubscription = await stripe.subscriptions.update(currentSubscription.stripeSubscriptionId, {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      proration_behavior: 'always_invoice', // Immediate charge for proration
      payment_behavior: 'error_if_incomplete', // Throw error if payment fails (we'll catch and redirect)
      metadata: {
        dvybPlanId: newPlanId.toString(),
        frequency: newFrequency,
      },
    });

    // Check if subscription requires payment action (3DS/SCA)
    if (updatedSubscription.status === 'incomplete' || updatedSubscription.status === 'past_due') {
      // Get the latest invoice to check if it requires action
      const latestInvoiceId = (updatedSubscription as any).latest_invoice;
      if (latestInvoiceId) {
        const invoice = await stripe.invoices.retrieve(
          typeof latestInvoiceId === 'string' ? latestInvoiceId : latestInvoiceId.id,
          { expand: ['payment_intent'] }
        );
        
        const paymentIntent = (invoice as any).payment_intent;
        
        // Check if payment requires action (3DS/SCA)
        if (paymentIntent && 
            (paymentIntent.status === 'requires_action' || 
             paymentIntent.status === 'requires_payment_method')) {
          
          // Return the hosted invoice URL for the user to complete payment
          const hostedInvoiceUrl = (invoice as any).hosted_invoice_url;
          
          logger.info(`🔐 Upgrade requires 3DS authentication for account ${accountId}`);
          logger.info(`   Redirect URL: ${hostedInvoiceUrl}`);
          
          // Update subscription status to reflect pending payment
          currentSubscription.status = 'incomplete';
          await subscriptionRepo.save(currentSubscription);
          
          return { 
            success: true, 
            message: 'Payment requires authentication',
            requiresAction: true,
            checkoutUrl: hostedInvoiceUrl,
          };
        }
      }
    }

    // Payment succeeded - update our database
    const subData = updatedSubscription as any;
    const periodStart = subData.current_period_start || subData.currentPeriodStart;
    const periodEnd = subData.current_period_end || subData.currentPeriodEnd;

    currentSubscription.planId = newPlanId;
    currentSubscription.stripePriceId = newPriceId;
    currentSubscription.selectedFrequency = newFrequency;
    currentSubscription.status = updatedSubscription.status as any;
    currentSubscription.currentPeriodStart = periodStart ? new Date(periodStart * 1000) : null;
    currentSubscription.currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
    await subscriptionRepo.save(currentSubscription);

    // Update account's current plan
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    await accountRepo.update(accountId, { currentPlanId: newPlanId });

    // Update DvybAccountPlan for limit checking (with new frequency!)
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    
    // End any existing active plan
    const existingPlans = await accountPlanRepo.find({
      where: { accountId, status: 'active', endDate: IsNull() },
    });
    
    for (const existingPlan of existingPlans) {
      existingPlan.status = 'expired';
      existingPlan.endDate = new Date();
      await accountPlanRepo.save(existingPlan);
    }
    
    // Create new account plan with updated frequency
    const newAccountPlan = accountPlanRepo.create({
      accountId,
      planId: newPlanId,
      selectedFrequency: newFrequency,
      status: 'active',
      changeType: 'upgrade',
      startDate: new Date(),
      endDate: null,
      notes: `Upgraded via Stripe (frequency: ${newFrequency})`,
    });
    
    await accountPlanRepo.save(newAccountPlan);
    logger.info(`✅ Updated DvybAccountPlan for account ${accountId}, plan ${newPlanId}, frequency: ${newFrequency}`);

    logger.info(`✅ Upgraded subscription ${currentSubscription.stripeSubscriptionId} to plan ${newPlanId}`);

    return { success: true, message: 'Subscription upgraded successfully with immediate proration' };
  }

  /**
   * Schedule subscription downgrade for end of billing period
   */
  static async scheduleDowngrade(params: {
    accountId: number;
    currentSubscriptionId: number;
    newPlanId: number;
    newFrequency: 'monthly' | 'annual';
  }): Promise<{ success: boolean; message: string; effectiveDate: Date }> {
    const { accountId, currentSubscriptionId, newPlanId, newFrequency } = params;

    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);

    const currentSubscription = await subscriptionRepo.findOne({
      where: { id: currentSubscriptionId, accountId },
    });

    if (!currentSubscription) {
      throw new Error('Subscription not found');
    }

    const newPlan = await planRepo.findOne({ where: { id: newPlanId } });
    if (!newPlan) {
      throw new Error('New plan not found');
    }

    // Verify the new price exists
    const newPriceId = newFrequency === 'monthly' ? newPlan.stripeMonthlyPriceId : newPlan.stripeAnnualPriceId;
    if (!newPriceId) {
      throw new Error('Stripe price not configured for new plan');
    }

    // Get the Stripe subscription to find the period end
    let stripeSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId);
    let subData = stripeSubscription as any;

    // Check if subscription has a schedule attached - if so, release it first
    const scheduleId = subData.schedule;
    if (scheduleId) {
      logger.info(`🔓 Releasing subscription schedule ${scheduleId} before updating subscription`);
      await stripe.subscriptionSchedules.release(scheduleId);
      // Re-fetch subscription after releasing schedule
      stripeSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripeSubscriptionId);
      subData = stripeSubscription as any;
    }

    // Get period end - try multiple property access methods
    // Stripe SDK can use different property names depending on version
    let periodEnd: number | undefined;
    
    // Try direct property access first
    if (typeof subData.current_period_end === 'number') {
      periodEnd = subData.current_period_end;
    } else if (typeof subData.currentPeriodEnd === 'number') {
      periodEnd = subData.currentPeriodEnd;
    } else if (typeof (stripeSubscription as any).current_period_end === 'number') {
      periodEnd = (stripeSubscription as any).current_period_end;
    }
    
    // Fallback to our database record if Stripe data is unavailable
    if (!periodEnd && currentSubscription.currentPeriodEnd) {
      periodEnd = Math.floor(currentSubscription.currentPeriodEnd.getTime() / 1000);
      logger.info(`📅 Using period end from database: ${currentSubscription.currentPeriodEnd}`);
    }
    
    if (!periodEnd) {
      // Log what we actually received from Stripe for debugging
      logger.error(`❌ Could not find period end. Subscription keys: ${Object.keys(subData).join(', ')}`);
      throw new Error('Could not determine subscription period end date');
    }
    
    const effectiveDate = new Date(periodEnd * 1000);
    logger.info(`📅 Subscription period end: ${effectiveDate.toISOString()}`);

    // For billing interval changes (annual ↔ monthly), use cancel-and-recreate approach:
    // 1. Set current subscription to cancel at period end
    // 2. Store the pending plan change in our database
    // 3. When subscription.deleted webhook fires, we'll create a new subscription with the new plan
    
    await stripe.subscriptions.update(currentSubscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: {
        pendingPlanId: newPlanId.toString(),
        pendingFrequency: newFrequency,
        pendingPriceId: newPriceId,
      },
    });

    // Track pending change in our database
    currentSubscription.pendingPlanId = newPlanId;
    currentSubscription.pendingFrequency = newFrequency;
    currentSubscription.cancelAtPeriodEnd = true;
    await subscriptionRepo.save(currentSubscription);

    logger.info(`✅ Scheduled billing cycle change to ${newFrequency} on plan ${newPlanId}, effective ${effectiveDate.toISOString()}`);

    return {
      success: true,
      message: `Billing cycle change scheduled. New ${newFrequency} billing will start on ${effectiveDate.toLocaleDateString()}`,
      effectiveDate,
    };
  }

  /**
   * Cancel subscription at end of billing period
   */
  static async cancelSubscription(accountId: number, subscriptionId: number): Promise<{ success: boolean; message: string }> {
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);

    const subscription = await subscriptionRepo.findOne({
      where: { id: subscriptionId, accountId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Check if subscription has a schedule attached - if so, release it first
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subData = stripeSubscription as any;
    const scheduleId = subData.schedule;
    if (scheduleId) {
      logger.info(`🔓 Releasing subscription schedule ${scheduleId} before canceling`);
      await stripe.subscriptionSchedules.release(scheduleId);
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    subscription.cancelAtPeriodEnd = true;
    subscription.pendingPlanId = null;
    subscription.pendingFrequency = null;
    await subscriptionRepo.save(subscription);

    logger.info(`✅ Scheduled cancellation for subscription ${subscription.stripeSubscriptionId}`);

    return { success: true, message: 'Subscription will be canceled at the end of the billing period' };
  }

  /**
   * Resume a subscription that was scheduled for cancellation
   */
  static async resumeSubscription(accountId: number, subscriptionId: number): Promise<{ success: boolean; message: string }> {
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);

    const subscription = await subscriptionRepo.findOne({
      where: { id: subscriptionId, accountId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Check if subscription has a schedule attached - if so, release it first
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const subData = stripeSubscription as any;
    const scheduleId = subData.schedule;
    if (scheduleId) {
      logger.info(`🔓 Releasing subscription schedule ${scheduleId} before resuming`);
      await stripe.subscriptionSchedules.release(scheduleId);
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    subscription.cancelAtPeriodEnd = false;
    subscription.pendingPlanId = null;
    subscription.pendingFrequency = null;
    await subscriptionRepo.save(subscription);

    logger.info(`✅ Resumed subscription ${subscription.stripeSubscriptionId}`);

    return { success: true, message: 'Subscription resumed successfully' };
  }

  /**
   * Create a Stripe Coupon and Promotion Code
   */
  static async createPromoCode(promo: DvybPromoCode): Promise<{ couponId: string; promotionCodeId: string }> {
    try {
      // Create the coupon first
      const couponParams: Stripe.CouponCreateParams = {
        duration: promo.firstMonthOnly ? 'once' : 'forever',
        metadata: {
          dvybPromoId: promo.id.toString(),
        },
      };

      if (promo.discountType === 'percent') {
        couponParams.percent_off = Number(promo.discountValue);
      } else {
        couponParams.amount_off = Math.round(Number(promo.discountValue) * 100);
        couponParams.currency = 'usd';
      }

      if (promo.maxRedemptions) {
        couponParams.max_redemptions = promo.maxRedemptions;
      }

      if (promo.validUntil) {
        couponParams.redeem_by = Math.floor(new Date(promo.validUntil).getTime() / 1000);
      }

      const coupon = await stripe.coupons.create(couponParams);

      // Create the promotion code (the actual code users enter)
      // Use any to work around SDK version differences
      const promoParams = {
        coupon: coupon.id,
        code: promo.code.toUpperCase(),
        metadata: {
          dvybPromoId: promo.id.toString(),
        },
      } as any;
      const promotionCode = await stripe.promotionCodes.create(promoParams);

      logger.info(`✅ Created Stripe coupon ${coupon.id} and promotion code ${promotionCode.id}`);

      return {
        couponId: coupon.id,
        promotionCodeId: promotionCode.id,
      };
    } catch (error) {
      logger.error('❌ Error creating Stripe promo code:', error);
      throw error;
    }
  }

  /**
   * Get subscription details for an account
   */
  static async getAccountSubscription(accountId: number): Promise<DvybAccountSubscription | null> {
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);

    return subscriptionRepo.findOne({
      where: { accountId, status: 'active' },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get payment history for an account with invoice URLs
   */
  static async getPaymentHistory(accountId: number, limit = 10): Promise<(DvybAccountPayment & { invoiceUrl?: string })[]> {
    const paymentRepo = AppDataSource.getRepository(DvybAccountPayment);

    const payments = await paymentRepo.find({
      where: { accountId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    // Fetch invoice URLs from Stripe for each payment
    const paymentsWithInvoices = await Promise.all(
      payments.map(async (payment) => {
        if (payment.stripeInvoiceId) {
          try {
            const invoice = await stripe.invoices.retrieve(payment.stripeInvoiceId);
            if (invoice.hosted_invoice_url) {
              return { ...payment, invoiceUrl: invoice.hosted_invoice_url };
            }
          } catch (error) {
            logger.warn(`Could not fetch invoice ${payment.stripeInvoiceId}:`, error);
          }
        }
        
        return payment as DvybAccountPayment & { invoiceUrl?: string };
      })
    );

    return paymentsWithInvoices;
  }
}

