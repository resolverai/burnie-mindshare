import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybPromoCode } from '../models/DvybPromoCode';
import { logger } from '../config/logger';
import { StripeService } from '../services/StripeService';
import { env } from '../config/env';

const router = Router();

/**
 * GET /api/admin/dvyb-promos
 * Get all promo codes with pagination and search
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const statusFilter = req.query.status as string;

    const promoRepo = AppDataSource.getRepository(DvybPromoCode);

    let query = promoRepo.createQueryBuilder('promo');

    if (search) {
      query = query.where(
        'LOWER(promo.code) LIKE LOWER(:search) OR LOWER(promo.description) LIKE LOWER(:search)',
        { search: `%${search}%` }
      );
    }

    if (statusFilter === 'active') {
      query = query.andWhere('promo.isActive = :isActive', { isActive: true });
    } else if (statusFilter === 'inactive') {
      query = query.andWhere('promo.isActive = :isActive', { isActive: false });
    }

    const total = await query.getCount();
    const skip = (page - 1) * limit;
    const promos = await query
      .orderBy('promo.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return res.json({
      success: true,
      data: promos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error fetching promo codes:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch promo codes' });
  }
});

/**
 * POST /api/admin/dvyb-promos
 * Create a new promo code
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      maxRedemptions,
      validFrom,
      validUntil,
      firstMonthOnly,
      applicablePlanId,
      createStripePromo, // Flag to auto-create in Stripe
    } = req.body;

    if (!code || !discountType || discountValue === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Code, discount type, and discount value are required',
      });
    }

    const promoRepo = AppDataSource.getRepository(DvybPromoCode);

    // Check for duplicate code
    const existingPromo = await promoRepo.findOne({
      where: { code: code.toUpperCase() },
    });

    if (existingPromo) {
      return res.status(400).json({
        success: false,
        error: 'A promo code with this code already exists',
      });
    }

    const newPromo = promoRepo.create({
      code: code.toUpperCase(),
      description: description || null,
      discountType,
      discountValue,
      maxRedemptions: maxRedemptions || null,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      firstMonthOnly: firstMonthOnly !== undefined ? firstMonthOnly : true,
      applicablePlanId: applicablePlanId || null,
      isActive: true,
    });

    await promoRepo.save(newPromo);

    // Create in Stripe if requested
    if (createStripePromo && env.stripe.secretKey) {
      try {
        const stripeData = await StripeService.createPromoCode(newPromo);
        newPromo.stripeCouponId = stripeData.couponId;
        newPromo.stripePromotionCodeId = stripeData.promotionCodeId;
        await promoRepo.save(newPromo);
        logger.info(`✅ Created Stripe promo code for ${newPromo.code}`);
      } catch (stripeError) {
        logger.error('⚠️ Failed to create Stripe promo code:', stripeError);
      }
    }

    logger.info(`✅ Created promo code: ${newPromo.code}`);

    return res.json({
      success: true,
      data: newPromo,
      message: 'Promo code created successfully',
    });
  } catch (error) {
    logger.error('Error creating promo code:', error);
    return res.status(500).json({ success: false, error: 'Failed to create promo code' });
  }
});

/**
 * PATCH /api/admin/dvyb-promos/:id
 * Update a promo code
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const promoId = parseInt(req.params.id!);

    if (isNaN(promoId)) {
      return res.status(400).json({ success: false, error: 'Invalid promo ID' });
    }

    const promoRepo = AppDataSource.getRepository(DvybPromoCode);
    const promo = await promoRepo.findOne({ where: { id: promoId } });

    if (!promo) {
      return res.status(404).json({ success: false, error: 'Promo code not found' });
    }

    const {
      description,
      discountType,
      discountValue,
      maxRedemptions,
      validFrom,
      validUntil,
      firstMonthOnly,
      applicablePlanId,
      isActive,
      stripePromotionCodeId,
      stripeCouponId,
    } = req.body;

    // Update fields
    if (description !== undefined) promo.description = description;
    if (discountType !== undefined) promo.discountType = discountType;
    if (discountValue !== undefined) promo.discountValue = discountValue;
    if (maxRedemptions !== undefined) promo.maxRedemptions = maxRedemptions;
    if (validFrom !== undefined) promo.validFrom = validFrom ? new Date(validFrom) : null;
    if (validUntil !== undefined) promo.validUntil = validUntil ? new Date(validUntil) : null;
    if (firstMonthOnly !== undefined) promo.firstMonthOnly = firstMonthOnly;
    if (applicablePlanId !== undefined) promo.applicablePlanId = applicablePlanId;
    if (isActive !== undefined) promo.isActive = isActive;
    if (stripePromotionCodeId !== undefined) promo.stripePromotionCodeId = stripePromotionCodeId || null;
    if (stripeCouponId !== undefined) promo.stripeCouponId = stripeCouponId || null;

    await promoRepo.save(promo);

    logger.info(`✅ Updated promo code: ${promo.code}`);

    return res.json({
      success: true,
      data: promo,
      message: 'Promo code updated successfully',
    });
  } catch (error) {
    logger.error('Error updating promo code:', error);
    return res.status(500).json({ success: false, error: 'Failed to update promo code' });
  }
});

/**
 * DELETE /api/admin/dvyb-promos/:id
 * Delete a promo code
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const promoId = parseInt(req.params.id!);

    if (isNaN(promoId)) {
      return res.status(400).json({ success: false, error: 'Invalid promo ID' });
    }

    const promoRepo = AppDataSource.getRepository(DvybPromoCode);
    const promo = await promoRepo.findOne({ where: { id: promoId } });

    if (!promo) {
      return res.status(404).json({ success: false, error: 'Promo code not found' });
    }

    await promoRepo.remove(promo);

    logger.info(`✅ Deleted promo code: ${promo.code}`);

    return res.json({
      success: true,
      message: 'Promo code deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting promo code:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete promo code' });
  }
});

/**
 * PATCH /api/admin/dvyb-promos/:id/toggle-status
 * Toggle promo code active/inactive status
 */
router.patch('/:id/toggle-status', async (req: Request, res: Response) => {
  try {
    const promoId = parseInt(req.params.id!);

    if (isNaN(promoId)) {
      return res.status(400).json({ success: false, error: 'Invalid promo ID' });
    }

    const promoRepo = AppDataSource.getRepository(DvybPromoCode);
    const promo = await promoRepo.findOne({ where: { id: promoId } });

    if (!promo) {
      return res.status(404).json({ success: false, error: 'Promo code not found' });
    }

    promo.isActive = !promo.isActive;
    await promoRepo.save(promo);

    logger.info(`✅ Promo ${promo.code} ${promo.isActive ? 'activated' : 'deactivated'}`);

    return res.json({
      success: true,
      data: { id: promo.id, isActive: promo.isActive },
      message: `Promo code ${promo.isActive ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    logger.error('Error toggling promo code status:', error);
    return res.status(500).json({ success: false, error: 'Failed to update promo code status' });
  }
});

export default router;

