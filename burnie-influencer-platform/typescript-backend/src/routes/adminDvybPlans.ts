import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { logger } from '../config/logger';
import { StripeService } from '../services/StripeService';
import { env } from '../config/env';

const router = Router();

/**
 * GET /api/admin/dvyb-plans
 * Get all pricing plans with pagination and search
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const statusFilter = req.query.status as string; // 'active', 'inactive', or 'all'

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);

    // Build query
    let query = planRepo.createQueryBuilder('plan');

    // Search filter
    if (search) {
      query = query.where(
        'LOWER(plan.planName) LIKE LOWER(:search) OR LOWER(plan.description) LIKE LOWER(:search)',
        { search: `%${search}%` }
      );
    }

    // Status filter
    if (statusFilter === 'active') {
      query = query.andWhere('plan.isActive = :isActive', { isActive: true });
    } else if (statusFilter === 'inactive') {
      query = query.andWhere('plan.isActive = :isActive', { isActive: false });
    }

    // Get total count
    const total = await query.getCount();

    // Apply pagination and sorting
    const skip = (page - 1) * limit;
    const plans = await query
      .orderBy('plan.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return res.json({
      success: true,
      data: plans,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error fetching pricing plans:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch pricing plans',
    });
  }
});

/**
 * POST /api/admin/dvyb-plans
 * Create a new pricing plan
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      planName,
      description,
      monthlyPrice,
      annualPrice,
      monthlyImageLimit,
      monthlyVideoLimit,
      annualImageLimit,
      annualVideoLimit,
      extraImagePostPrice,
      extraVideoPostPrice,
      isActive,
      isFreeTrialPlan,
      createStripeProduct, // Flag to auto-create Stripe product
    } = req.body;

    if (!planName || monthlyPrice === undefined || annualPrice === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Plan name, monthly price, and annual price are required',
      });
    }

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);

    // If marking as free trial, unmark any existing free trial plans
    if (isFreeTrialPlan) {
      await planRepo.update({ isFreeTrialPlan: true }, { isFreeTrialPlan: false });
      logger.info('📝 Unmarked existing free trial plan(s)');
    }

    const newPlan = planRepo.create({
      planName,
      description: description || null,
      monthlyPrice,
      annualPrice,
      monthlyImageLimit: monthlyImageLimit || 0,
      monthlyVideoLimit: monthlyVideoLimit || 0,
      annualImageLimit: annualImageLimit || 0,
      annualVideoLimit: annualVideoLimit || 0,
      extraImagePostPrice: extraImagePostPrice || 0,
      extraVideoPostPrice: extraVideoPostPrice || 0,
      isActive: isActive !== undefined ? isActive : true,
      isFreeTrialPlan: isFreeTrialPlan || false,
    });

    await planRepo.save(newPlan);

    logger.info(`✅ Created pricing plan: ${newPlan.planName} (ID: ${newPlan.id})`);

    // Auto-create Stripe product and prices if requested and not a free plan
    if (createStripeProduct && !isFreeTrialPlan && env.stripe.secretKey) {
      try {
        const stripeData = await StripeService.createStripeProductAndPrices(newPlan);
        newPlan.stripeProductId = stripeData.productId;
        newPlan.stripeMonthlyPriceId = stripeData.monthlyPriceId;
        newPlan.stripeAnnualPriceId = stripeData.annualPriceId;
        await planRepo.save(newPlan);
        logger.info(`✅ Created Stripe product for plan ${newPlan.id}`);
      } catch (stripeError) {
        logger.error('⚠️ Failed to create Stripe product (plan created without Stripe):', stripeError);
        // Continue without failing - plan is created, Stripe IDs can be added manually
      }
    }

    return res.json({
      success: true,
      data: newPlan,
      message: 'Pricing plan created successfully',
    });
  } catch (error) {
    logger.error('Error creating pricing plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create pricing plan',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-plans/:id
 * Update a pricing plan
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params.id!);

    if (isNaN(planId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan ID',
      });
    }

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({ where: { id: planId } });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Pricing plan not found',
      });
    }

    const {
      planName,
      description,
      monthlyPrice,
      annualPrice,
      monthlyImageLimit,
      monthlyVideoLimit,
      annualImageLimit,
      annualVideoLimit,
      extraImagePostPrice,
      extraVideoPostPrice,
      isActive,
      isFreeTrialPlan,
      // Stripe fields - can be manually updated
      stripeProductId,
      stripeMonthlyPriceId,
      stripeAnnualPriceId,
      createStripeProduct, // Flag to create Stripe product if not exists
    } = req.body;

    // If marking as free trial, unmark any existing free trial plans
    if (isFreeTrialPlan && !plan.isFreeTrialPlan) {
      await planRepo.update({ isFreeTrialPlan: true }, { isFreeTrialPlan: false });
      logger.info('📝 Unmarked existing free trial plan(s)');
    }

    // Update fields
    if (planName !== undefined) plan.planName = planName;
    if (description !== undefined) plan.description = description;
    if (monthlyPrice !== undefined) plan.monthlyPrice = monthlyPrice;
    if (annualPrice !== undefined) plan.annualPrice = annualPrice;
    if (monthlyImageLimit !== undefined) plan.monthlyImageLimit = monthlyImageLimit;
    if (monthlyVideoLimit !== undefined) plan.monthlyVideoLimit = monthlyVideoLimit;
    if (annualImageLimit !== undefined) plan.annualImageLimit = annualImageLimit;
    if (annualVideoLimit !== undefined) plan.annualVideoLimit = annualVideoLimit;
    if (extraImagePostPrice !== undefined) plan.extraImagePostPrice = extraImagePostPrice;
    if (extraVideoPostPrice !== undefined) plan.extraVideoPostPrice = extraVideoPostPrice;
    if (isActive !== undefined) plan.isActive = isActive;
    if (isFreeTrialPlan !== undefined) plan.isFreeTrialPlan = isFreeTrialPlan;

    // Update Stripe IDs (manual entry)
    if (stripeProductId !== undefined) plan.stripeProductId = stripeProductId || null;
    if (stripeMonthlyPriceId !== undefined) plan.stripeMonthlyPriceId = stripeMonthlyPriceId || null;
    if (stripeAnnualPriceId !== undefined) plan.stripeAnnualPriceId = stripeAnnualPriceId || null;

    // Auto-create Stripe product if requested and doesn't exist
    if (createStripeProduct && !plan.stripeProductId && !plan.isFreeTrialPlan && env.stripe.secretKey) {
      try {
        const stripeData = await StripeService.createStripeProductAndPrices(plan);
        plan.stripeProductId = stripeData.productId;
        plan.stripeMonthlyPriceId = stripeData.monthlyPriceId;
        plan.stripeAnnualPriceId = stripeData.annualPriceId;
        logger.info(`✅ Created Stripe product for existing plan ${plan.id}`);
      } catch (stripeError) {
        logger.error('⚠️ Failed to create Stripe product:', stripeError);
      }
    }

    // Update Stripe product name/description if we have a product ID
    if (plan.stripeProductId && (planName !== undefined || description !== undefined) && env.stripe.secretKey) {
      try {
        const stripeUpdates: { name?: string; description?: string } = {};
        if (plan.planName) stripeUpdates.name = plan.planName;
        if (plan.description) stripeUpdates.description = plan.description;
        await StripeService.updateStripeProduct(plan.stripeProductId, stripeUpdates);
      } catch (stripeError) {
        logger.error('⚠️ Failed to update Stripe product:', stripeError);
      }
    }

    await planRepo.save(plan);

    logger.info(`✅ Updated pricing plan: ${plan.planName} (ID: ${plan.id})`);

    return res.json({
      success: true,
      data: plan,
      message: 'Pricing plan updated successfully',
    });
  } catch (error) {
    logger.error('Error updating pricing plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update pricing plan',
    });
  }
});

/**
 * DELETE /api/admin/dvyb-plans/:id
 * Delete a pricing plan
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params.id!);

    if (isNaN(planId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan ID',
      });
    }

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({ where: { id: planId } });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Pricing plan not found',
      });
    }

    await planRepo.remove(plan);

    logger.info(`✅ Deleted pricing plan: ${plan.planName} (ID: ${planId})`);

    return res.json({
      success: true,
      message: 'Pricing plan deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting pricing plan:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete pricing plan',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-plans/:id/toggle-status
 * Toggle plan active/inactive status
 */
router.patch('/:id/toggle-status', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params.id!);

    if (isNaN(planId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan ID',
      });
    }

    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const plan = await planRepo.findOne({ where: { id: planId } });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: 'Pricing plan not found',
      });
    }

    const newStatus = !plan.isActive;
    plan.isActive = newStatus;
    await planRepo.save(plan);

    // Archive/unarchive Stripe product if it exists
    if (plan.stripeProductId && env.stripe.secretKey) {
      try {
        await StripeService.setProductArchived(plan.stripeProductId, !newStatus);
        logger.info(`✅ Stripe product ${plan.stripeProductId} ${newStatus ? 'unarchived' : 'archived'}`);
      } catch (stripeError) {
        logger.error('⚠️ Failed to update Stripe product archive status:', stripeError);
        // Don't fail the request - the plan status is already updated in our DB
      }
    }

    logger.info(`✅ Plan ${planId} ${newStatus ? 'activated' : 'deactivated'}`);

    return res.json({
      success: true,
      data: {
        id: plan.id,
        isActive: plan.isActive,
      },
      message: `Plan ${newStatus ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    logger.error('Error toggling plan status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update plan status',
    });
  }
});

export default router;

