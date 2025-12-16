import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybContentStrategy } from '../models/DvybContentStrategy';
import { DvybContext } from '../models/DvybContext';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import axios from 'axios';

const router = Router();

// Apply auth middleware to all routes
router.use(dvybAuthMiddleware);

const PYTHON_AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/dvyb/content-strategy/generate
 * Trigger strategy generation after questionnaire completion
 */
router.post('/generate', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { strategyPreferences } = req.body;

    // Get website analysis from context
    const contextRepo = AppDataSource.getRepository(DvybContext);
    const context = await contextRepo.findOne({ where: { accountId } });

    if (!context) {
      return res.status(400).json({
        success: false,
        error: 'No website analysis found. Please complete website analysis first.',
      });
    }

    // Store strategy preferences in context
    if (strategyPreferences) {
      context.strategyPreferences = {
        ...strategyPreferences,
        completedAt: new Date().toISOString(),
      };
      await contextRepo.save(context);
    }

    // Call Python AI backend to generate strategy
    try {
      const response = await axios.post(
        `${PYTHON_AI_BACKEND_URL}/api/dvyb/content-strategy/generate`,
        {
          account_id: accountId,
          website_analysis: {
            industry: context.industry,
            description: context.description,
            topics: context.topics,
            brandName: context.brandName,
            logoUrl: context.logoUrl,
          },
          strategy_preferences: strategyPreferences || context.strategyPreferences,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000, // 2 minutes timeout for LLM
        }
      );

      if (response.data.success) {
        const { week_themes, content_packages } = response.data;
        
        // Save strategy items to database
        const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);
        
        // Get unique months from the content packages to delete existing items
        const monthsToUpdate = new Set<string>();
        for (const pkg of content_packages || []) {
          if (pkg.date) {
            // Extract month from date (YYYY-MM-DD -> YYYY-MM)
            const itemMonth = pkg.date.substring(0, 7);
            monthsToUpdate.add(itemMonth);
          }
        }
        
        // Delete existing strategy items for this account in affected months
        for (const month of monthsToUpdate) {
          await strategyRepo.delete({ accountId, strategyMonth: month });
        }
        
        let itemCount = 0;
        for (const pkg of content_packages || []) {
          const weekNumber = pkg.week_number || 1;
          const weekTheme = pkg.week_theme || week_themes?.[String(weekNumber)] || `Week ${weekNumber}`;
          
          // Set strategyMonth based on the item's actual date
          const itemStrategyMonth = pkg.date ? pkg.date.substring(0, 7) : new Date().toISOString().substring(0, 7);
          
          const strategyItem = strategyRepo.create({
            accountId,
            date: pkg.date,
            platform: pkg.platform || 'instagram',
            contentType: pkg.content_type || 'image',
            topic: pkg.topic || 'Content post',
            weekTheme,
            weekNumber,
            metadata: pkg.metadata || {},
            status: 'suggested',
            strategyMonth: itemStrategyMonth,
          });
          
          await strategyRepo.save(strategyItem);
          itemCount++;
        }
        
        logger.info(`✅ Strategy generated and saved for account ${accountId}: ${itemCount} items`);
        return res.json({
          success: true,
          message: 'Content strategy generated successfully',
          data: {
            itemCount,
            strategyMonth: strategy_month,
          },
        });
      } else {
        throw new Error(response.data.error || 'Strategy generation failed');
      }
    } catch (aiError: any) {
      logger.error('❌ Python AI backend error:', aiError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate content strategy. Please try again.',
      });
    }
  } catch (error: any) {
    logger.error('❌ Error in strategy generation:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/dvyb/content-strategy/calendar
 * Get strategy items for calendar view
 */
router.get('/calendar', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { month } = req.query; // Format: "2025-01"

    const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);

    let queryBuilder = strategyRepo
      .createQueryBuilder('strategy')
      .where('strategy.accountId = :accountId', { accountId })
      .andWhere('strategy.status != :deleted', { deleted: 'deleted' })
      .orderBy('strategy.date', 'ASC')
      .addOrderBy('strategy.id', 'ASC');

    if (month) {
      // Filter by actual date range only (more reliable than strategyMonth field)
      const [year, monthNum] = month.split('-').map(Number);
      const startDate = `${month}-01`;
      // Get last day of month
      const lastDay = new Date(year, monthNum, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
      
      queryBuilder = queryBuilder.andWhere(
        'strategy.date >= :startDate AND strategy.date <= :endDate',
        { startDate, endDate }
      );
    }

    const items = await queryBuilder.getMany();

    // Group week themes
    const weekThemes: Record<number, string> = {};
    items.forEach((item) => {
      if (item.weekNumber && item.weekTheme && !weekThemes[item.weekNumber]) {
        weekThemes[item.weekNumber] = item.weekTheme;
      }
    });

    return res.json({
      success: true,
      data: {
        weekThemes,
        items: items.map((item) => ({
          id: item.id,
          date: item.date,
          platform: item.platform,
          contentType: item.contentType,
          topic: item.topic,
          weekTheme: item.weekTheme,
          weekNumber: item.weekNumber,
          metadata: item.metadata,
          status: item.status,
          generatedContentId: item.generatedContentId,
        })),
      },
    });
  } catch (error: any) {
    logger.error('❌ Error fetching calendar:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch calendar',
    });
  }
});

/**
 * GET /api/dvyb/content-strategy/check/status
 * Check if strategy has been generated for this account
 * NOTE: This must be defined BEFORE /:id route
 */
router.get('/check/status', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);
    const count = await strategyRepo.count({
      where: { accountId, status: 'suggested' },
    });

    return res.json({
      success: true,
      data: {
        hasStrategy: count > 0,
        itemCount: count,
      },
    });
  } catch (error: any) {
    logger.error('❌ Error checking strategy status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check status',
    });
  }
});

/**
 * GET /api/dvyb/content-strategy/available-months
 * Get list of months that have strategy items
 * NOTE: This must be defined BEFORE /:id route
 */
router.get('/available-months', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);
    
    // Get all non-deleted items and extract unique months from dates
    const items = await strategyRepo.find({
      where: { accountId },
      select: ['date', 'strategyMonth'],
    });
    
    const months = new Set<string>();
    items.forEach(item => {
      // Add strategyMonth if exists
      if (item.strategyMonth) {
        months.add(item.strategyMonth);
      }
      // Also add month from actual date
      if (item.date) {
        const dateStr = typeof item.date === 'string' ? item.date : item.date.toISOString().split('T')[0];
        months.add(dateStr.substring(0, 7));
      }
    });

    return res.json({
      success: true,
      data: {
        months: Array.from(months).sort(),
      },
    });
  } catch (error: any) {
    logger.error('❌ Error fetching available months:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch available months',
    });
  }
});

/**
 * GET /api/dvyb/content-strategy/:id
 * Get single strategy item details
 * NOTE: This must be defined AFTER specific routes like /check/status and /available-months
 */
router.get('/:id', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) {
      return res.status(400).json({ success: false, error: 'Invalid item ID' });
    }

    const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);
    const item = await strategyRepo.findOne({
      where: { id: itemId, accountId },
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    return res.json({
      success: true,
      data: {
        id: item.id,
        date: item.date,
        platform: item.platform,
        contentType: item.contentType,
        topic: item.topic,
        weekTheme: item.weekTheme,
        weekNumber: item.weekNumber,
        metadata: item.metadata,
        status: item.status,
        generatedContentId: item.generatedContentId,
        strategyMonth: item.strategyMonth,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
  } catch (error: any) {
    logger.error('❌ Error fetching strategy item:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch item',
    });
  }
});

/**
 * DELETE /api/dvyb/content-strategy/:id
 * Delete/remove item from strategy
 */
router.delete('/:id', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) {
      return res.status(400).json({ success: false, error: 'Invalid item ID' });
    }

    const strategyRepo = AppDataSource.getRepository(DvybContentStrategy);
    const item = await strategyRepo.findOne({
      where: { id: itemId, accountId },
    });

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Soft delete by setting status to 'deleted'
    item.status = 'deleted';
    await strategyRepo.save(item);

    logger.info(`🗑️ Strategy item ${itemId} deleted for account ${accountId}`);

    return res.json({
      success: true,
      message: 'Item removed from strategy',
    });
  } catch (error: any) {
    logger.error('❌ Error deleting strategy item:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete item',
    });
  }
});

export { router as dvybContentStrategyRoutes };

