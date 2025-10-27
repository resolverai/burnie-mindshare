import { Request, Response, Router } from 'express';
import { UrlCacheService } from '../services/UrlCacheService';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route GET /api/cache/stats
 * @desc Get Redis cache statistics
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await UrlCacheService.getCacheStats();
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();
    
    res.json({
      success: true,
      data: {
        ...stats,
        redis_available: isRedisAvailable,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache stats',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/cache/test
 * @desc Test URL caching functionality
 */
router.post('/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const { s3_key, presigned_url } = req.body;
    
    if (!s3_key || !presigned_url) {
      res.status(400).json({
        success: false,
        message: 's3_key and presigned_url are required'
      });
      return;
    }
    
    // Test caching
    await UrlCacheService.cacheUrl(s3_key, presigned_url, 60); // 1 minute TTL for testing
    
    // Test retrieval
    const cachedUrl = await UrlCacheService.getCachedUrl(s3_key);
    
    res.json({
      success: true,
      data: {
        cached: cachedUrl === presigned_url,
        retrieved_url: cachedUrl,
        original_url: presigned_url,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error testing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route DELETE /api/cache/clear
 * @desc Clear all cached URLs
 */
router.delete('/clear', async (req: Request, res: Response): Promise<void> => {
  try {
    await UrlCacheService.clearAllCachedUrls();
    
    res.json({
      success: true,
      message: 'All cached URLs cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route DELETE /api/cache/:s3_key
 * @desc Remove specific cached URL
 */
router.delete('/:s3_key', async (req: Request, res: Response): Promise<void> => {
  try {
    const { s3_key } = req.params;
    
    if (!s3_key) {
      res.status(400).json({
        success: false,
        message: 's3_key is required'
      });
      return;
    }
    
    await UrlCacheService.removeCachedUrl(s3_key);
    
    res.json({
      success: true,
      message: `Cached URL for ${s3_key} removed`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error removing cached URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove cached URL',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
