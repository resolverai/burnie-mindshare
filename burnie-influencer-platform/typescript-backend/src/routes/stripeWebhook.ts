import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybAccountSubscription } from '../models/DvybAccountSubscription';
import { DvybAccountPayment } from '../models/DvybAccountPayment';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybAccountPlan } from '../models/DvybAccountPlan';

const router = Router();
const stripe = new Stripe(env.stripe.secretKey);

/**
 * Stripe Webhook Handler
 * This endpoint receives events from Stripe and updates our database accordingly
 * 
 * Required Webhook Events to configure in Stripe Dashboard:
 * - checkout.session.completed
 * - invoice.paid
 * - invoice.payment_failed
 * - invoice.payment_action_required (for 3D Secure / SCA / OTP)
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    // Verify webhook signature
    if (env.stripe.webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, env.stripe.webhookSecret);
    } else {
      // For development without webhook secret
      event = req.body as Stripe.Event;
      logger.warn('⚠️ Stripe webhook secret not configured - skipping signature verification');
    }
  } catch (err: any) {
    logger.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logger.info(`📩 Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_action_required':
        await handleInvoicePaymentActionRequired(event.data.object as Stripe.Invoice);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    return res.json({ received: true });
  } catch (error) {
    logger.error(`❌ Error processing webhook ${event.type}:`, error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle successful checkout session completion
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const accountId = parseInt(session.metadata?.dvybAccountId || '0');
  const planId = parseInt(session.metadata?.dvybPlanId || '0');
  const frequency = (session.metadata?.frequency || 'monthly') as 'monthly' | 'annual';

  if (!accountId || !planId) {
    logger.error('❌ Missing accountId or planId in checkout session metadata');
    return;
  }

  logger.info(`✅ Checkout completed for account ${accountId}, plan ${planId}`);

  // The subscription will be created via the subscription.created event
  // Just update the account's current plan here
  const accountRepo = AppDataSource.getRepository(DvybAccount);
  await accountRepo.update(accountId, { currentPlanId: planId });
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const accountId = parseInt(subscription.metadata?.dvybAccountId || '0');
  const planId = parseInt(subscription.metadata?.dvybPlanId || '0');
  const frequency = (subscription.metadata?.frequency || 'monthly') as 'monthly' | 'annual';

  if (!accountId) {
    // Try to get accountId from customer metadata
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    if ('metadata' in customer && customer.metadata?.dvybAccountId) {
      const acctId = parseInt(customer.metadata.dvybAccountId);
      await createSubscriptionRecord(subscription, acctId, planId, frequency);
    } else {
      logger.error('❌ Cannot determine accountId for subscription');
    }
    return;
  }

  await createSubscriptionRecord(subscription, accountId, planId, frequency);
}

async function createSubscriptionRecord(
  subscription: Stripe.Subscription,
  accountId: number,
  planId: number,
  frequency: 'monthly' | 'annual'
) {
  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
  const accountRepo = AppDataSource.getRepository(DvybAccount);

  // Check if subscription already exists
  let existingSub = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscription.id },
  });

  const priceId = subscription.items.data[0]?.price.id || '';

  // If planId not in metadata, try to find it from price ID
  if (!planId) {
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({
      where: [
        { stripeMonthlyPriceId: priceId },
        { stripeAnnualPriceId: priceId },
      ],
    });
    if (plan) {
      planId = plan.id;
      frequency = plan.stripeMonthlyPriceId === priceId ? 'monthly' : 'annual';
    }
  }

  // Access Stripe subscription dates (may be snake_case or camelCase depending on SDK version)
  const subData = subscription as any; // Use any for flexible property access
  const periodStart = subData.current_period_start || subData.currentPeriodStart;
  const periodEnd = subData.current_period_end || subData.currentPeriodEnd;
  const cancelAtPeriodEnd = subData.cancel_at_period_end ?? subData.cancelAtPeriodEnd ?? false;

  if (existingSub) {
    // Update existing subscription
    existingSub.status = subscription.status as any;
    existingSub.currentPeriodStart = periodStart ? new Date(periodStart * 1000) : null;
    existingSub.currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
    existingSub.cancelAtPeriodEnd = cancelAtPeriodEnd;
    existingSub.stripePriceId = priceId;
    if (planId) existingSub.planId = planId;
    existingSub.selectedFrequency = frequency;
    await subscriptionRepo.save(existingSub);
  } else {
    // Create new subscription record
    const newSub = subscriptionRepo.create({
      accountId,
      planId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      selectedFrequency: frequency,
      status: subscription.status as any,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: cancelAtPeriodEnd,
    });
    await subscriptionRepo.save(newSub);
    logger.info(`✅ Created subscription record for account ${accountId}`);
  }

  // Update account with current plan
  if (planId) {
    await accountRepo.update(accountId, { currentPlanId: planId, isActive: true });
    
    // Also update DvybAccountPlan for limit checking
    await updateAccountPlan(accountId, planId, frequency, 'initial');
  }
}

/**
 * Update or create DvybAccountPlan record (used for limit checking)
 */
async function updateAccountPlan(
  accountId: number,
  planId: number,
  frequency: 'monthly' | 'annual',
  changeType: 'initial' | 'upgrade' | 'downgrade' | 'renewal'
) {
  const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
  
  // End any existing active plan
  const existingPlans = await accountPlanRepo.find({
    where: { accountId, status: 'active' },
  });
  
  for (const plan of existingPlans) {
    plan.status = 'expired';
    plan.endDate = new Date();
    await accountPlanRepo.save(plan);
  }
  
  // Create new active plan
  const newAccountPlan = accountPlanRepo.create({
    accountId,
    planId,
    selectedFrequency: frequency,
    status: 'active',
    changeType,
    startDate: new Date(),
    endDate: null,
    notes: `Created via Stripe subscription (${changeType})`,
  });
  
  await accountPlanRepo.save(newAccountPlan);
  logger.info(`✅ Created DvybAccountPlan for account ${accountId}, plan ${planId}, type: ${changeType}`);
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
  const accountRepo = AppDataSource.getRepository(DvybAccount);
  const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
  const planRepo = AppDataSource.getRepository(DvybPricingPlan);

  const existingSub = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!existingSub) {
    logger.warn(`⚠️ Subscription ${subscription.id} not found in database`);
    return;
  }

  // Handle 'unpaid' status - downgrade to free plan (same as subscription deleted)
  // This happens when all payment retries have failed and Stripe marks subscription as unpaid
  if (subscription.status === 'unpaid' && existingSub.status !== 'unpaid') {
    logger.info(`⚠️ Subscription ${subscription.id} marked as unpaid - downgrading to free plan`);
    
    existingSub.status = 'unpaid';
    await subscriptionRepo.save(existingSub);

    // End current active plan in DvybAccountPlan
    const activePlans = await accountPlanRepo.find({
      where: { accountId: existingSub.accountId, status: 'active' },
    });
    
    for (const plan of activePlans) {
      plan.status = 'payment_failed';
      plan.endDate = new Date();
      plan.notes = 'Ended due to payment failure - subscription marked as unpaid';
      await accountPlanRepo.save(plan);
    }

    // Revert account to free plan
    const freePlan = await planRepo.findOne({ where: { isFreeTrialPlan: true } });
    
    if (freePlan) {
      await accountRepo.update(existingSub.accountId, { currentPlanId: freePlan.id });
      
      // Create a new account plan entry for the free plan
      const freeAccountPlan = accountPlanRepo.create({
        accountId: existingSub.accountId,
        planId: freePlan.id,
        selectedFrequency: 'monthly',
        status: 'active',
        changeType: 'downgrade',
        startDate: new Date(),
        endDate: null,
        notes: 'Reverted to free plan after subscription payment failure (unpaid status)',
      });
      await accountPlanRepo.save(freeAccountPlan);
      
      logger.info(`✅ Account ${existingSub.accountId} downgraded to free plan due to unpaid subscription`);
    }
    
    return; // No need to process further for unpaid subscriptions
  }

  const priceId = subscription.items.data[0]?.price.id || '';

  // Check if price changed (plan change)
  if (existingSub.stripePriceId !== priceId) {
    const newPlan = await planRepo.findOne({
      where: [
        { stripeMonthlyPriceId: priceId },
        { stripeAnnualPriceId: priceId },
      ],
    });

    if (newPlan) {
      const oldPlanId = existingSub.planId;
      existingSub.planId = newPlan.id;
      existingSub.selectedFrequency = newPlan.stripeMonthlyPriceId === priceId ? 'monthly' : 'annual';
      
      // Determine if this is an upgrade or downgrade
      const oldPlan = await planRepo.findOne({ where: { id: oldPlanId } });
      let changeType: 'upgrade' | 'downgrade' | 'renewal' = 'renewal';
      
      if (oldPlan) {
        const oldPrice = Number(oldPlan.monthlyPrice);
        const newPrice = Number(newPlan.monthlyPrice);
        changeType = newPrice > oldPrice ? 'upgrade' : 'downgrade';
      }
      
      // Clear pending downgrade if this was the scheduled change
      if (existingSub.pendingPlanId === newPlan.id) {
        existingSub.pendingPlanId = null;
        existingSub.pendingFrequency = null;
      }

      // Update account's current plan
      await accountRepo.update(existingSub.accountId, { currentPlanId: newPlan.id });
      
      // Also update DvybAccountPlan for limit checking
      await updateAccountPlan(
        existingSub.accountId, 
        newPlan.id, 
        existingSub.selectedFrequency, 
        changeType
      );
      
      logger.info(`✅ Updated account ${existingSub.accountId} to plan ${newPlan.id} (${changeType})`);
    }
  }

  // Access Stripe subscription dates (may be snake_case or camelCase depending on SDK version)
  const subDataUpdate = subscription as any;
  const periodStartUpdate = subDataUpdate.current_period_start || subDataUpdate.currentPeriodStart;
  const periodEndUpdate = subDataUpdate.current_period_end || subDataUpdate.currentPeriodEnd;
  const cancelAtPeriodEndUpdate = subDataUpdate.cancel_at_period_end ?? subDataUpdate.cancelAtPeriodEnd ?? false;
  const canceledAtUpdate = subDataUpdate.canceled_at || subDataUpdate.canceledAt;

  existingSub.stripePriceId = priceId;
  existingSub.status = subscription.status as any;
  existingSub.currentPeriodStart = periodStartUpdate ? new Date(periodStartUpdate * 1000) : null;
  existingSub.currentPeriodEnd = periodEndUpdate ? new Date(periodEndUpdate * 1000) : null;
  existingSub.cancelAtPeriodEnd = cancelAtPeriodEndUpdate;

  if (canceledAtUpdate) {
    existingSub.canceledAt = new Date(canceledAtUpdate * 1000);
  }
  if (subscription.ended_at) {
    existingSub.endedAt = new Date(subscription.ended_at * 1000);
  }

  await subscriptionRepo.save(existingSub);
  logger.info(`✅ Updated subscription ${subscription.id}`);
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
  const accountRepo = AppDataSource.getRepository(DvybAccount);
  const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
  const planRepo = AppDataSource.getRepository(DvybPricingPlan);

  const existingSub = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!existingSub) {
    logger.warn(`⚠️ Subscription ${subscription.id} not found in database`);
    return;
  }

  // Check if there's a pending plan change (billing cycle switch)
  // This happens when user switched from annual to monthly (or vice versa)
  const hasPendingPlanChange = existingSub.pendingPlanId && existingSub.pendingFrequency;
  
  if (hasPendingPlanChange) {
    logger.info(`🔄 Processing pending plan change for account ${existingSub.accountId}`);
    
    const pendingPlan = await planRepo.findOne({ where: { id: existingSub.pendingPlanId! } });
    
    if (pendingPlan) {
      const newPriceId = existingSub.pendingFrequency === 'monthly' 
        ? pendingPlan.stripeMonthlyPriceId 
        : pendingPlan.stripeAnnualPriceId;
      
      if (newPriceId) {
        try {
          // Get the customer ID from the deleted subscription
          const customerId = typeof subscription.customer === 'string' 
            ? subscription.customer 
            : subscription.customer.id;
          
          // Create a new subscription with the pending plan
          const newStripeSubscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: newPriceId }],
            metadata: {
              dvybAccountId: existingSub.accountId.toString(),
              dvybPlanId: pendingPlan.id.toString(),
              frequency: existingSub.pendingFrequency!,
            },
          });
          
          // Update the old subscription record
          existingSub.status = 'canceled';
          existingSub.endedAt = new Date();
          existingSub.pendingPlanId = null;
          existingSub.pendingFrequency = null;
          await subscriptionRepo.save(existingSub);
          
          // Create new subscription record
          const newSubData = newStripeSubscription as any;
          const newSub = subscriptionRepo.create({
            accountId: existingSub.accountId,
            planId: pendingPlan.id,
            stripeSubscriptionId: newStripeSubscription.id,
            stripePriceId: newPriceId,
            selectedFrequency: existingSub.pendingFrequency!,
            status: newStripeSubscription.status as any,
            currentPeriodStart: newSubData.current_period_start ? new Date(newSubData.current_period_start * 1000) : null,
            currentPeriodEnd: newSubData.current_period_end ? new Date(newSubData.current_period_end * 1000) : null,
            cancelAtPeriodEnd: false,
          });
          await subscriptionRepo.save(newSub);
          
          // Update account's current plan
          await accountRepo.update(existingSub.accountId, { currentPlanId: pendingPlan.id });
          
          // Update DvybAccountPlan for limit checking
          await updateAccountPlan(
            existingSub.accountId, 
            pendingPlan.id, 
            existingSub.pendingFrequency!, 
            'downgrade'
          );
          
          logger.info(`✅ Created new ${existingSub.pendingFrequency} subscription for account ${existingSub.accountId}`);
          return; // Exit - don't revert to free plan
        } catch (error) {
          logger.error(`❌ Failed to create new subscription for pending plan change:`, error);
          // Fall through to revert to free plan
        }
      }
    }
  }

  // No pending plan change or failed to create new subscription - revert to free plan
  existingSub.status = 'canceled';
  existingSub.endedAt = new Date();
  existingSub.pendingPlanId = null;
  existingSub.pendingFrequency = null;
  await subscriptionRepo.save(existingSub);

  // End current active plan in DvybAccountPlan
  const activePlans = await accountPlanRepo.find({
    where: { accountId: existingSub.accountId, status: 'active' },
  });
  
  for (const plan of activePlans) {
    plan.status = 'cancelled';
    plan.endDate = new Date();
    await accountPlanRepo.save(plan);
  }

  // Revert account to free plan
  const freePlan = await planRepo.findOne({ where: { isFreeTrialPlan: true } });
  
  if (freePlan) {
    await accountRepo.update(existingSub.accountId, { currentPlanId: freePlan.id });
    
    // Create a new account plan entry for the free plan
    const freeAccountPlan = accountPlanRepo.create({
      accountId: existingSub.accountId,
      planId: freePlan.id,
      selectedFrequency: 'monthly',
      status: 'active',
      changeType: 'downgrade',
      startDate: new Date(),
      endDate: null,
      notes: 'Reverted to free plan after subscription cancellation',
    });
    await accountPlanRepo.save(freeAccountPlan);
  }

  logger.info(`✅ Subscription ${subscription.id} canceled for account ${existingSub.accountId}`);
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Use any for flexible property access across SDK versions
  const invoiceData = invoice as any;
  const invoiceSubscription = invoiceData.subscription;
  
  if (!invoiceSubscription) {
    logger.info('Invoice not related to a subscription, skipping');
    return;
  }

  const paymentRepo = AppDataSource.getRepository(DvybAccountPayment);
  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);

  // Find the subscription
  const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
  const subscription = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!subscription) {
    logger.warn(`⚠️ Subscription for invoice ${invoice.id} not found`);
    return;
  }

  // Check if payment already recorded
  const existingPayment = await paymentRepo.findOne({
    where: { stripeInvoiceId: invoice.id },
  });

  const statusTransitions = invoiceData.status_transitions || invoiceData.statusTransitions;
  const paidAtTimestamp = statusTransitions?.paid_at || statusTransitions?.paidAt;

  if (existingPayment) {
    existingPayment.status = 'succeeded';
    existingPayment.paidAt = paidAtTimestamp
      ? new Date(paidAtTimestamp * 1000)
      : new Date();
    await paymentRepo.save(existingPayment);
    return;
  }

  const paymentIntent = invoiceData.payment_intent || invoiceData.paymentIntent;
  const amountPaid = invoiceData.amount_paid || invoiceData.amountPaid || 0;
  const totalDiscountAmounts = invoiceData.total_discount_amounts || invoiceData.totalDiscountAmounts || [];

  // Create payment record
  const payment = paymentRepo.create({
    accountId: subscription.accountId,
    subscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null,
    amount: amountPaid / 100, // Convert from cents
    currency: invoice.currency,
    status: 'succeeded',
    paymentType: 'subscription',
    description: `Subscription payment for ${subscription.selectedFrequency} plan`,
    paidAt: paidAtTimestamp
      ? new Date(paidAtTimestamp * 1000)
      : new Date(),
  });

  // Check for discounts
  const discounts = invoiceData.discounts || [];
  if (discounts.length > 0 && totalDiscountAmounts.length > 0) {
    const discountAmount = totalDiscountAmounts.reduce((sum: number, d: any) => sum + d.amount, 0) / 100;
    payment.discountAmount = discountAmount;
    
    const discount = discounts[0];
    const promoCode = discount?.promotion_code || discount?.promotionCode;
    if (promoCode && typeof promoCode === 'string') {
      payment.stripePromotionCodeId = promoCode;
    } else if (promoCode && typeof promoCode === 'object') {
      payment.stripePromotionCodeId = promoCode.id;
      payment.promoCodeName = promoCode.code;
    }
  }

  await paymentRepo.save(payment);
  logger.info(`✅ Recorded payment ${payment.id} for invoice ${invoice.id}`);
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // Use any for flexible property access across SDK versions
  const invoiceData = invoice as any;
  const invoiceSubscription = invoiceData.subscription;
  
  if (!invoiceSubscription) return;

  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
  const paymentRepo = AppDataSource.getRepository(DvybAccountPayment);

  const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
  const subscription = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!subscription) {
    logger.warn(`⚠️ Subscription for failed invoice ${invoice.id} not found`);
    return;
  }

  // Update subscription status
  subscription.status = 'past_due';
  await subscriptionRepo.save(subscription);

  const paymentIntent = invoiceData.payment_intent || invoiceData.paymentIntent;
  const amountDue = invoiceData.amount_due || invoiceData.amountDue || 0;

  // Record failed payment attempt
  const payment = paymentRepo.create({
    accountId: subscription.accountId,
    subscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null,
    amount: amountDue / 100,
    currency: invoice.currency,
    status: 'failed',
    paymentType: 'subscription',
    description: 'Failed subscription payment',
  });

  await paymentRepo.save(payment);
  logger.info(`⚠️ Recorded failed payment for invoice ${invoice.id}`);
}

/**
 * Handle invoice requiring payment action (3D Secure / SCA / OTP)
 * This is sent when a payment requires additional authentication
 * Stripe will automatically email the customer with a link to complete payment
 */
async function handleInvoicePaymentActionRequired(invoice: Stripe.Invoice) {
  const invoiceData = invoice as any;
  const invoiceSubscription = invoiceData.subscription;
  
  if (!invoiceSubscription) {
    logger.info('Invoice requiring action not related to a subscription, skipping');
    return;
  }

  const subscriptionRepo = AppDataSource.getRepository(DvybAccountSubscription);
  const paymentRepo = AppDataSource.getRepository(DvybAccountPayment);

  const subscriptionId = typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription.id;
  const subscription = await subscriptionRepo.findOne({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (!subscription) {
    logger.warn(`⚠️ Subscription for invoice ${invoice.id} requiring action not found`);
    return;
  }

  // Update subscription status to reflect pending payment
  subscription.status = 'incomplete';
  await subscriptionRepo.save(subscription);

  const paymentIntent = invoiceData.payment_intent || invoiceData.paymentIntent;
  const amountDue = invoiceData.amount_due || invoiceData.amountDue || 0;

  // Record payment as pending (requires action)
  const existingPayment = await paymentRepo.findOne({
    where: { stripeInvoiceId: invoice.id },
  });

  if (!existingPayment) {
    const payment = paymentRepo.create({
      accountId: subscription.accountId,
      subscriptionId: subscription.id,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null,
      amount: amountDue / 100,
      currency: invoice.currency,
      status: 'pending',
      paymentType: 'subscription',
      description: 'Payment requires authentication (3D Secure)',
    });
    await paymentRepo.save(payment);
  }

  // Note: Stripe automatically sends an email to the customer with a link to complete payment
  // The hosted_invoice_url can be used if you want to show a link in your UI
  const hostedInvoiceUrl = invoiceData.hosted_invoice_url;
  
  logger.info(`🔐 Invoice ${invoice.id} requires payment action for account ${subscription.accountId}`);
  logger.info(`   Customer can complete payment at: ${hostedInvoiceUrl}`);
  
  // TODO: Optionally send your own email notification to the user
  // with the hostedInvoiceUrl link
}

/**
 * Handle successful payment intent (for one-time payments or prorations)
 */
async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  // Payment intents for subscriptions are usually handled via invoices
  // This is mainly for one-time payments or immediate proration charges
  logger.info(`💰 Payment intent ${paymentIntent.id} succeeded: $${paymentIntent.amount / 100}`);
}

export default router;

