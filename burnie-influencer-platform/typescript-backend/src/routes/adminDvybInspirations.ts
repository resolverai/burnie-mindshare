/**
 * Admin DVYB Inspirations Routes
 * Manages inspiration links for AI content generation
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybInspirationLink } from '../models/DvybInspirationLink';
import { logger } from '../config/logger';
import { Like } from 'typeorm';

const router = Router();

/**
 * GET /api/admin/dvyb-inspirations
 * Get all inspiration links with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { platform, category, search, page = '1', limit = '20' } = req.query;
    
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    const queryBuilder = inspirationRepo.createQueryBuilder('inspiration')
      .where('inspiration.isActive = :isActive', { isActive: true });
    
    if (platform) {
      queryBuilder.andWhere('inspiration.platform = :platform', { platform });
    }
    
    if (category) {
      queryBuilder.andWhere('inspiration.category = :category', { category });
    }
    
    if (search) {
      queryBuilder.andWhere(
        '(inspiration.url ILIKE :search OR inspiration.title ILIKE :search OR inspiration.category ILIKE :search)',
        { search: `%${search}%` }
      );
    }
    
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    
    const [inspirations, total] = await queryBuilder
      .orderBy('inspiration.createdAt', 'DESC')
      .skip((pageNum - 1) * limitNum)
      .take(limitNum)
      .getManyAndCount();
    
    return res.json({
      success: true,
      data: inspirations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching inspiration links:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch inspiration links' });
  }
});

/**
 * GET /api/admin/dvyb-inspirations/categories
 * Get all unique categories (for dropdown)
 */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    const categories = await inspirationRepo
      .createQueryBuilder('inspiration')
      .select('DISTINCT inspiration.category', 'category')
      .where('inspiration.isActive = :isActive', { isActive: true })
      .orderBy('inspiration.category', 'ASC')
      .getRawMany();
    
    return res.json({
      success: true,
      data: categories.map(c => c.category).filter(Boolean),
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

/**
 * POST /api/admin/dvyb-inspirations
 * Add a new inspiration link
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { platform, category, url, title, addedBy } = req.body;
    
    if (!platform || !category || !url) {
      return res.status(400).json({
        success: false,
        error: 'platform, category, and url are required',
      });
    }
    
    // Validate platform
    const validPlatforms = ['youtube', 'instagram', 'twitter', 'tiktok'];
    if (!validPlatforms.includes(platform.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`,
      });
    }
    
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    // Check if URL already exists
    const existing = await inspirationRepo.findOne({ where: { url } });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'This URL has already been added',
      });
    }
    
    const inspiration = inspirationRepo.create({
      platform: platform.toLowerCase(),
      category: category.trim(),
      url: url.trim(),
      title: title?.trim() || null,
      addedBy: addedBy || null,
      isActive: true,
    });
    
    await inspirationRepo.save(inspiration);
    
    logger.info(`✅ Added inspiration link: ${platform} - ${category} - ${url}`);
    
    return res.json({
      success: true,
      data: inspiration,
      message: 'Inspiration link added successfully',
    });
  } catch (error) {
    logger.error('Error adding inspiration link:', error);
    return res.status(500).json({ success: false, error: 'Failed to add inspiration link' });
  }
});

/**
 * PUT /api/admin/dvyb-inspirations/:id
 * Update an inspiration link
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id!);
    const { platform, category, url, title, isActive } = req.body;
    
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    const inspiration = await inspirationRepo.findOne({ where: { id } });
    if (!inspiration) {
      return res.status(404).json({ success: false, error: 'Inspiration link not found' });
    }
    
    if (platform) inspiration.platform = platform.toLowerCase();
    if (category) inspiration.category = category.trim();
    if (url) inspiration.url = url.trim();
    if (title !== undefined) inspiration.title = title?.trim() || null;
    if (isActive !== undefined) inspiration.isActive = isActive;
    
    await inspirationRepo.save(inspiration);
    
    logger.info(`✅ Updated inspiration link ${id}`);
    
    return res.json({
      success: true,
      data: inspiration,
      message: 'Inspiration link updated successfully',
    });
  } catch (error) {
    logger.error('Error updating inspiration link:', error);
    return res.status(500).json({ success: false, error: 'Failed to update inspiration link' });
  }
});

/**
 * DELETE /api/admin/dvyb-inspirations/:id
 * Soft delete an inspiration link (set isActive to false)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id!);
    
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    const inspiration = await inspirationRepo.findOne({ where: { id } });
    if (!inspiration) {
      return res.status(404).json({ success: false, error: 'Inspiration link not found' });
    }
    
    // Soft delete
    inspiration.isActive = false;
    await inspirationRepo.save(inspiration);
    
    logger.info(`🗑️ Deleted inspiration link ${id}`);
    
    return res.json({
      success: true,
      message: 'Inspiration link deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting inspiration link:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete inspiration link' });
  }
});

/**
 * GET /api/admin/dvyb-inspirations/stats
 * Get stats about inspiration links
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    
    const stats = await inspirationRepo
      .createQueryBuilder('inspiration')
      .select('inspiration.platform', 'platform')
      .addSelect('COUNT(*)', 'count')
      .where('inspiration.isActive = :isActive', { isActive: true })
      .groupBy('inspiration.platform')
      .getRawMany();
    
    const total = await inspirationRepo.count({ where: { isActive: true } });
    const categoryCount = await inspirationRepo
      .createQueryBuilder('inspiration')
      .select('COUNT(DISTINCT inspiration.category)', 'count')
      .where('inspiration.isActive = :isActive', { isActive: true })
      .getRawOne();
    
    return res.json({
      success: true,
      data: {
        total,
        byPlatform: stats,
        categoryCount: parseInt(categoryCount?.count || '0'),
      },
    });
  } catch (error) {
    logger.error('Error fetching inspiration stats:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

export default router;

