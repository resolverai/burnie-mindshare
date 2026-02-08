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
   * Create Stripe deal prices on existing product (for promotional pricing)
   */
  static async createDealPrices(plan: DvybPricingPlan): Promise<{ monthlyPriceId: string; annualPriceId: string }> {
    if (!plan.stripeProductId || plan.dealMonthlyPrice == null || plan.dealAnnualPrice == null) {
      throw new Error('Plan must have stripeProductId and deal prices to create deal Stripe prices');
    }
    try {
      logger.info(`📦 Creating Stripe deal prices for plan: ${plan.planName}`);

      const monthlyPrice = await stripe.prices.create({
        product: plan.stripeProductId,
        currency: 'usd',
        unit_amount: Math.round(Number(plan.dealMonthlyPrice) * 100),
        recurring: { interval: 'month' },
        metadata: { dvybPlanId: plan.id.toString(), frequency: 'monthly', deal: 'true' },
      });

      const annualPrice = await stripe.prices.create({
        product: plan.stripeProductId,
        currency: 'usd',
        unit_amount: Math.round(Number(plan.dealAnnualPrice) * 100),
        recurring: { interval: 'year' },
        metadata: { dvybPlanId: plan.id.toString(), frequency: 'annual', deal: 'true' },
      });

      logger.info(`✅ Created Stripe deal prices: ${monthlyPrice.id}, ${annualPrice.id}`);
      return { monthlyPriceId: monthlyPrice.id, annualPriceId: annualPrice.id };
    } catch (error) {
      logger.error('❌ Error creating Stripe deal prices:', error);
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
   * Archive or unarchive a Stripe product
   * Archived products cannot be used to create new subscriptions
   */
  static async setProductArchived(productId: string, archived: boolean): Promise<void> {
    try {
      await stripe.products.update(productId, { active: !archived });
      logger.info(`✅ Stripe product ${productId} ${archived ? 'archived' : 'unarchived'}`);
    } catch (error) {
      logger.error(`❌ Error ${archived ? 'archiving' : 'unarchiving'} Stripe product ${productId}:`, error);
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
   * Check if an account has previously subscribed to a specific plan
   * Used to determine if they should get a free trial (only once per plan)
   */
  static async hasAccountPreviouslyHadPlan(accountId: number, planId: number): Promise<boolean> {
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    
    // Check if there's any historical record of this account having this plan
    const previousPlan = await accountPlanRepo.findOne({
      where: {
        accountId,
        planId,
      },
    });
    
    return !!previousPlan;
  }

  /**
   * Check if an account has ever been a paid customer (actually charged, not just trialing)
   * Used to determine if they should EVER get a trial on ANY plan
   * Once a user has paid once, no more trials on any plan upgrades/downgrades
   */
  static async hasAccountEverPaid(accountId: number): Promise<boolean> {
    const paymentRepo = AppDataSource.getRepository(DvybAccountPayment);
    
    // Check if there's any successful payment record for this account
    const payment = await paymentRepo.findOne({
      where: {
        accountId,
        status: 'succeeded',
      },
    });
    
    if (payment) {
      return true;
    }
    
    // Also check subscription records for any that have had their trial end
    // (meaning they were charged after trial or paid immediately)
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const paidSubscription = await subscriptionRepo.findOne({
      where: {
        accountId,
        status: 'active', // Active means they've been charged
      },
    });
    
    return !!paidSubscription;
  }

  /**
   * End a trial early and charge the customer immediately
   * Used when user wants to continue generating beyond trial limits
   */
  static async endTrialAndChargeImmediately(accountId: number): Promise<{
    success: boolean;
    message: string;
    invoiceId?: string;
  }> {
    let trialingSubscription: DvybAccountSubscription | null = null;
    
    try {
      // Find the trialing subscription for this account
      const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
      trialingSubscription = await subscriptionRepo.findOne({
        where: {
          accountId,
          status: 'trialing',
        },
        relations: ['plan'],
      });

      if (!trialingSubscription) {
        logger.warn(`⚠️ No trialing subscription found for account ${accountId}`);
        return {
          success: false,
          message: 'No active trial subscription found',
        };
      }

      if (!trialingSubscription.stripeSubscriptionId) {
        logger.warn(`⚠️ Subscription has no Stripe ID for account ${accountId}`);
        return {
          success: false,
          message: 'Subscription has no Stripe ID',
        };
      }

      logger.info(`⚡ Ending trial early for account ${accountId}, subscription ${trialingSubscription.stripeSubscriptionId}`);

      // Update the Stripe subscription to end the trial immediately
      // This will trigger an invoice and charge the customer
      // Use 'now' as a special value that Stripe accepts to end trial immediately
      logger.info(`📡 Calling Stripe API to end trial for ${trialingSubscription.stripeSubscriptionId}...`);
      
      let updatedSubscription;
      try {
        updatedSubscription = await stripe.subscriptions.update(
          trialingSubscription.stripeSubscriptionId,
          {
            trial_end: 'now' as unknown as number, // 'now' is a special Stripe value, cast for TypeScript
          }
        );
      } catch (stripeError: any) {
        logger.error(`❌ Stripe API error:`, {
          message: stripeError.message,
          type: stripeError.type,
          code: stripeError.code,
          statusCode: stripeError.statusCode,
        });
        throw stripeError;
      }

      logger.info(`✅ Trial ended for subscription ${trialingSubscription.stripeSubscriptionId}, new status: ${updatedSubscription.status}`);

      // Update our database record
      trialingSubscription.status = updatedSubscription.status;
      trialingSubscription.trialEnd = new Date();
      await subscriptionRepo.save(trialingSubscription);

      return {
        success: true,
        message: 'Trial ended and payment processed successfully',
        invoiceId: updatedSubscription.latest_invoice as string,
      };
    } catch (error: any) {
      logger.error(`❌ Error ending trial early for account ${accountId}:`, {
        error: error.message,
        type: error.type,
        code: error.code,
        stripeSubscriptionId: trialingSubscription?.stripeSubscriptionId,
        stack: error.stack,
      });
      
      // Handle specific Stripe errors
      if (error.type === 'StripeCardError') {
        return {
          success: false,
          message: `Payment failed: ${error.message}`,
        };
      }
      
      if (error.type === 'StripeInvalidRequestError') {
        return {
          success: false,
          message: `Invalid request: ${error.message}`,
        };
      }

      if (error.code === 'resource_missing') {
        return {
          success: false,
          message: 'Subscription not found in Stripe. Please contact support.',
        };
      }
      
      return {
        success: false,
        message: error.message || 'Failed to end trial and process payment',
      };
    }
  }

  /**
   * Get the Free Trial plan for a specific flow
   * Used to determine trial limits during freemium period
   */
  static async getFreeTrialPlanForFlow(planFlow: 'website_analysis' | 'product_photoshot'): Promise<DvybPricingPlan | null> {
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    
    // Find the free trial plan for this flow
    const freeTrialPlan = await planRepo.findOne({
      where: {
        planFlow,
        isFreeTrialPlan: true,
        isActive: true,
      },
    });
    
    // Fallback: find any active free trial plan for this flow
    if (!freeTrialPlan) {
      return await planRepo.findOne({
        where: {
          planFlow,
          monthlyPrice: 0,
          isActive: true,
        },
      });
    }
    
    return freeTrialPlan;
  }

  /**
   * Create a Stripe Checkout Session for subscription
   * Handles freemium plans with trial periods
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

    // Use deal price IDs when deal is active, else original prices
    const useDealPrices = plan.dealActive && plan.stripeDealMonthlyPriceId && plan.stripeDealAnnualPriceId;
    const priceId = frequency === 'monthly'
      ? (useDealPrices ? plan.stripeDealMonthlyPriceId : plan.stripeMonthlyPriceId)
      : (useDealPrices ? plan.stripeDealAnnualPriceId : plan.stripeAnnualPriceId);
    if (!priceId) {
      throw new Error(`Stripe price not configured for plan ${planId} (${frequency})`);
    }

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(accountId);

    // Determine if user should get an opt-out free trial
    // Trial is given ONLY if:
    // 1. Plan has opt-out trial enabled (isFreemium = true)
    // 2. User has NEVER PAID before (once a paid customer, no trials on any plan)
    let trialDays = 0;
    if (plan.isFreemium && !plan.isFreeTrialPlan) {
      // First check: Has user ever paid for ANY plan? If yes, no trial ever again
      const hasEverPaid = await this.hasAccountEverPaid(accountId);
      if (hasEverPaid) {
        logger.info(`⚡ Account ${accountId} is a previous paid customer - no trial on any plan, charging immediately`);
      } else {
        // Second check: Has user had THIS specific plan before? If yes, no trial for this plan
        const hadPlanBefore = await this.hasAccountPreviouslyHadPlan(accountId, planId);
        if (!hadPlanBefore) {
          trialDays = plan.freemiumTrialDays || 7;
          logger.info(`🎁 Account ${accountId} qualifies for ${trialDays}-day opt-out free trial on plan ${planId}`);
        } else {
          logger.info(`⚡ Account ${accountId} previously had plan ${planId} - no trial, charging immediately`);
        }
      }
    }

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
          isFreemium: plan.isFreemium ? 'true' : 'false',
          trialDays: trialDays.toString(),
        },
        // Add trial period if applicable
        ...(trialDays > 0 && { trial_period_days: trialDays }),
      },
      metadata: {
        dvybAccountId: accountId.toString(),
        dvybPlanId: planId.toString(),
        frequency,
        isFreemium: plan.isFreemium ? 'true' : 'false',
        trialDays: trialDays.toString(),
      },
      // Always require payment method for freemium plans (card is collected upfront)
      ...(plan.isFreemium && { payment_method_collection: 'always' }),
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
   * Cancel subscription - immediately for trialing, at period end for active
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

    // For trialing subscriptions, cancel immediately to avoid any charge
    // For active subscriptions, schedule cancellation at period end
    const isTrialing = subscription.status === 'trialing' || stripeSubscription.status === 'trialing';
    
    if (isTrialing) {
      // Immediately cancel trialing subscription - no charge will occur
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      
      subscription.status = 'canceled';
      subscription.cancelAtPeriodEnd = false;
      subscription.canceledAt = new Date();
      subscription.endedAt = new Date();
      subscription.pendingPlanId = null;
      subscription.pendingFrequency = null;
      await subscriptionRepo.save(subscription);

      // Immediately downgrade to free plan (don't wait for webhook)
      const planRepo = AppDataSource.getRepository(DvybPricingPlan);
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
      
      const freePlan = await planRepo.findOne({ where: { isFreeTrialPlan: true, isActive: true } });
      if (freePlan) {
        await accountRepo.update(accountId, { currentPlanId: freePlan.id });
        
        // End current active plans
        const activePlans = await accountPlanRepo.find({
          where: { accountId, status: 'active' },
        });
        for (const plan of activePlans) {
          plan.status = 'cancelled';
          plan.endDate = new Date();
          await accountPlanRepo.save(plan);
        }
        
        // Create new account plan entry for free plan
        const freeAccountPlan = accountPlanRepo.create({
          accountId,
          planId: freePlan.id,
          selectedFrequency: 'monthly',
          status: 'active',
          changeType: 'downgrade',
          startDate: new Date(),
          endDate: null,
          notes: 'Reverted to free plan after trial cancellation',
        });
        await accountPlanRepo.save(freeAccountPlan);
        
        logger.info(`✅ Downgraded account ${accountId} to free plan after trial cancellation`);
      }

      logger.info(`✅ Immediately canceled trialing subscription ${subscription.stripeSubscriptionId} - no charge will occur`);

      return { success: true, message: 'Your trial has been canceled. No charges will be made to your payment method.' };
    } else {
      // Schedule cancellation at period end for active subscriptions
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
   * Includes both active and trialing subscriptions
   */
  static async getAccountSubscription(accountId: number): Promise<DvybAccountSubscription | null> {
    const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
    const { In } = await import('typeorm');

    return subscriptionRepo.findOne({
      where: { accountId, status: In(['active', 'trialing']) },
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

