import { Router, Request, Response } from 'express';

// Extend Request type to include user
type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    walletAddress: string;
    username?: string;
  };
}
import { LeaderboardYapperService, QueueYapperRequest, YapperFetchStats } from '../services/LeaderboardYapperService';
import { TwitterLeaderboardService } from '../services/TwitterLeaderboardService';
import { twitterQueueCronService } from '../services/TwitterQueueCronService';
import { logger } from '../config/logger';
import { PlatformSource } from '../models/LeaderboardYapperData';

const router = Router();
const yapperService = new LeaderboardYapperService();

// Batch queue Twitter fetches
router.post('/batch-queue', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { requests }: { requests: QueueYapperRequest[] } = req.body;

    if (!requests || !Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Requests array is required and must not be empty'
      });
    }

    // Validate requests
    for (const request of requests) {
      if (!request.twitterHandle || !request.campaignId || !request.snapshotDate || !request.platformSource || !request.snapshotId) {
        return res.status(400).json({
          success: false,
          message: 'Each request must have twitterHandle, campaignId, snapshotId, snapshotDate, and platformSource'
        });
      }

      // Convert snapshotDate string to Date
      request.snapshotDate = new Date(request.snapshotDate);
    }

    const queuedCount = await yapperService.queueYappers(requests);

    logger.info(`📥 Batch queued ${queuedCount} Twitter fetches from ${requests.length} requests`);

    return res.json({
      success: true,
      queued_count: queuedCount,
      total_requests: requests.length,
      message: `Successfully queued ${queuedCount} Twitter fetches`
    });

  } catch (error) {
    logger.error('❌ Error in batch queue endpoint:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get queue statistics
router.get('/stats', async (req: Request, res: Response): Promise<Response> => {
  try {
    const stats: YapperFetchStats = await yapperService.getQueueStats();
    
    return res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('❌ Error getting queue stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get queue statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process Twitter fetch queue with rate limiting
router.post('/process', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { batchSize = 10, maxProcessingTime = 30 } = req.body; // maxProcessingTime in minutes

    logger.info(`🚀 Starting Twitter queue processing (batch: ${batchSize}, max time: ${maxProcessingTime}min)`);

    // Create Twitter service
    const twitterService = new TwitterLeaderboardService();

    // Get next batch to process
    const queueItems = await yapperService.getNextBatch(batchSize);
    
    if (queueItems.length === 0) {
      return res.json({
        success: true,
        message: 'No items in queue to process',
        processed: 0,
        skipped: 0,
        failed: 0
      });
    }

    logger.info(`📋 Processing ${queueItems.length} items from queue`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const startTime = Date.now();
    const maxProcessingMs = maxProcessingTime * 60 * 1000;

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      
      if (!item) {
        logger.warn(`⚠️ Skipping undefined item at index ${i}`);
        continue;
      }

      // Check if we've exceeded max processing time
      if (Date.now() - startTime > maxProcessingMs) {
        logger.warn(`⏰ Max processing time reached, stopping at item ${i + 1}/${queueItems.length}`);
        break;
      }

      try {
        logger.info(`🔄 Processing ${i + 1}/${queueItems.length}: @${item.twitterHandle} (ID: ${item.id})`);

        // Mark as in progress
        item.markAsInProgress();
        await yapperService.repository.save(item);

        // Check if this is a duplicate that needs data copying
        if (item.isDataDuplicated && item.sourceDuplicateRecordId) {
          // Data already copied during queuing
          skipped++;
          logger.info(`📋 Duplicated data for @${item.twitterHandle}`);
        } else {
          // Fetch fresh Twitter data
          const twitterResult = await twitterService.fetchYapperTwitterData(
            item.twitterHandle,
            item.displayName || 'Unknown'
          );

          if (twitterResult.success) {
            await yapperService.markAsCompleted(item.id, twitterResult);
            processed++;
            logger.info(`✅ Completed @${item.twitterHandle}`);
          } else {
            if (twitterResult.error === 'rate_limited') {
              await yapperService.markAsRateLimited(item.id);
              logger.warn(`⏳ Rate limited @${item.twitterHandle}`);
            } else {
              await yapperService.markAsFailed(item.id, twitterResult.error || 'Unknown error');
              failed++;
              logger.error(`❌ Failed @${item.twitterHandle}: ${twitterResult.error}`);
            }
          }
        }

        // 1-minute cooling period between API calls (only for non-duplicated items)
        if (!item.isDataDuplicated && i < queueItems.length - 1) {
          logger.info(`⏱️ Cooling down for 60 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 60000));
        }

      } catch (itemError) {
        logger.error(`❌ Error processing queue item ${item.id}:`, itemError);
        await yapperService.markAsFailed(item.id, itemError instanceof Error ? itemError.message : 'Unknown error');
        failed++;
      }
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    
    logger.info(`🏁 Queue processing completed: ${processed} processed, ${skipped} skipped, ${failed} failed in ${totalTime}s`);

    return res.json({
      success: true,
      message: `Processed ${queueItems.length} queue items`,
      processed,
      skipped,
      failed,
      total_items: queueItems.length,
      processing_time_seconds: totalTime
    });

  } catch (error) {
    logger.error('❌ Error processing Twitter queue:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process Twitter queue',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clean up old queue items
router.post('/cleanup', async (req: Request, res: Response): Promise<Response> => {
  try {
    const cleanedCount = await yapperService.cleanupOldItems();
    
    return res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} old queue items`,
      cleaned_count: cleanedCount
    });

  } catch (error) {
    logger.error('❌ Error cleaning up queue:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup queue',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current queue status
router.get('/status', async (req: Request, res: Response): Promise<Response> => {
  try {
    const stats = await yapperService.getQueueStats();
    
    return res.json({
      success: true,
      queue_status: {
        total_pending: stats.totalPending,
        total_in_progress: stats.totalInProgress,
        total_completed: stats.totalCompleted,
        total_failed: stats.totalFailed,
        total_skipped: stats.totalSkipped,
        total_rate_limited: stats.totalRateLimited,
        estimated_completion: stats.estimatedCompletionTime,
        is_processing_needed: stats.totalPending > 0 || stats.totalRateLimited > 0
      }
    });

  } catch (error) {
    logger.error('❌ Error getting queue status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get queue status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get cron service status
router.get('/cron-status', async (req: Request, res: Response): Promise<Response> => {
  try {
    const cronStatus = twitterQueueCronService.getStatus();
    const queueStats = await yapperService.getQueueStats();
    
    return res.json({
      success: true,
      cron_service: cronStatus,
      queue_stats: queueStats,
      automation_info: {
        processing_rate: "1 yapper per minute",
        daily_capacity: "1440 yappers per day",
        rate_limit_compliance: "1 minute between Twitter API calls"
      }
    });
  } catch (error) {
    logger.error('❌ Error getting cron status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get cron status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manual trigger for testing (optional)
router.post('/trigger-manual', async (req: Request, res: Response): Promise<Response> => {
  try {
    await twitterQueueCronService.triggerManualProcess();
    return res.json({
      success: true,
      message: 'Manual processing triggered successfully'
    });
  } catch (error) {
    logger.error('❌ Error triggering manual process:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger manual processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
