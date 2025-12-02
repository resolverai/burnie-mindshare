import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybUpgradeRequest } from '../models/DvybUpgradeRequest';
import { logger } from '../config/logger';
import { Like } from 'typeorm';

const router = Router();

/**
 * GET /api/admin/dvyb-upgrade-requests
 * Get all upgrade requests with pagination and search
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;

    const upgradeRequestRepo = AppDataSource.getRepository(DvybUpgradeRequest);

    // Build query
    const queryBuilder = upgradeRequestRepo.createQueryBuilder('request');

    // Apply search filter
    if (search) {
      queryBuilder.where(
        '(request.accountName ILIKE :search OR request.email ILIKE :search OR request.currentPlan ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Apply status filter
    if (status && status !== 'ALL') {
      if (search) {
        queryBuilder.andWhere('request.status = :status', { status: status.toLowerCase() });
      } else {
        queryBuilder.where('request.status = :status', { status: status.toLowerCase() });
      }
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Get paginated results
    const skip = (page - 1) * limit;
    const requests = await queryBuilder
      .orderBy('request.requestedAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return res.json({
      success: true,
      data: requests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error fetching DVYB upgrade requests:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch upgrade requests',
    });
  }
});

/**
 * PATCH /api/admin/dvyb-upgrade-requests/:id/status
 * Update upgrade request status
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status || !['pending', 'contacted', 'upgraded', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    const upgradeRequestRepo = AppDataSource.getRepository(DvybUpgradeRequest);
    const request = await upgradeRequestRepo.findOne({ where: { id: parseInt(id!) } });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Upgrade request not found',
      });
    }

    request.status = status;
    if (notes) {
      request.notes = notes;
    }

    await upgradeRequestRepo.save(request);

    logger.info(`✅ Updated upgrade request ${id} status to ${status}`);

    return res.json({
      success: true,
      data: request,
      message: 'Status updated successfully',
    });
  } catch (error) {
    logger.error('Error updating upgrade request status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update status',
    });
  }
});

export default router;

