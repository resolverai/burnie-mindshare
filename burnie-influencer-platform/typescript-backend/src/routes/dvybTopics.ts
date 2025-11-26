import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { DvybTopicsService } from '../services/DvybTopicsService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

/**
 * POST /api/dvyb/topics/generate
 * Generate brand topics for an account
 */
router.post('/generate', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    logger.info(`🎯 Generating topics for account ${accountId}`);

    const topics = await DvybTopicsService.generateBrandTopics(accountId);

    return res.json({
      success: true,
      data: { topics },
      message: 'Topics generated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Generate topics error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate topics',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/topics
 * Get brand topics for authenticated account
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const brandTopics = await DvybTopicsService.getBrandTopics(accountId);

    if (!brandTopics) {
      return res.json({
        success: true,
        data: null,
        message: 'No topics found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: brandTopics,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Get topics error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve topics',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/topics/unused
 * Get unused topics for authenticated account
 */
router.get('/unused', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const unusedTopics = await DvybTopicsService.getUnusedTopics(accountId);

    return res.json({
      success: true,
      data: { topics: unusedTopics },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Get unused topics error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve unused topics',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

