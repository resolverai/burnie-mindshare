import { Router, Request, Response } from 'express';
import { platformYapperCronService } from '../services/PlatformYapperCronService';
import { logger } from '../config/logger';

const router = Router();

// Get platform yapper cron status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = platformYapperCronService.getStatus();
    const stats = await platformYapperCronService.getStats();

    return res.json({
      success: true,
      cron_status: status,
      statistics: stats
    });

  } catch (error) {
    logger.error('❌ Error getting platform yapper cron status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get cron status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manually trigger platform yapper processing
router.post('/trigger-manual', async (req: Request, res: Response) => {
  try {
    logger.info('🔧 Manual platform yapper processing triggered via API');
    
    // Run processing in background
    platformYapperCronService.triggerManualProcess().catch(error => {
      logger.error('❌ Manual platform yapper processing failed:', error);
    });

    return res.json({
      success: true,
      message: 'Platform yapper processing triggered manually',
      note: 'Processing is running in the background'
    });

  } catch (error) {
    logger.error('❌ Error triggering manual platform yapper processing:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger manual processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get detailed stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await platformYapperCronService.getStats();

    return res.json({
      success: true,
      statistics: stats,
      description: {
        total_connections: 'Total number of yapper Twitter connections',
        active_connections: 'Number of active (connected) yappers',
        last_processed: 'Timestamp of most recent yapper processing',
        processing_status: 'Current processing status (idle/in_progress/error)'
      }
    });

  } catch (error) {
    logger.error('❌ Error getting platform yapper stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
