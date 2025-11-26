import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { DvybDashboardService } from '../services/DvybDashboardService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

/**
 * GET /api/dvyb/dashboard
 * Get dashboard data for authenticated account
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const dashboardData = await DvybDashboardService.getDashboardData(accountId);

    return res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB dashboard error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard data',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/dashboard/analytics
 * Get analytics data for charts
 */
router.get('/analytics', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { startDate, endDate, groupBy } = req.query;

    const filters: {
      startDate?: Date;
      endDate?: Date;
      groupBy?: 'day' | 'week' | 'month';
    } = {
      groupBy: (groupBy as 'day' | 'week' | 'month') || 'day',
    };
    
    if (startDate) {
      filters.startDate = new Date(startDate as string);
    }
    if (endDate) {
      filters.endDate = new Date(endDate as string);
    }

    const analyticsData = await DvybDashboardService.getAnalytics(accountId, filters);

    return res.json({
      success: true,
      data: analyticsData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ DVYB analytics error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

