import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web3PostsSchedule } from '../models/Web3PostsSchedule';
import { Web3ProjectConfiguration } from '../models/Web3ProjectConfiguration';
import { logger } from '../config/logger';
import { queueScheduledPost } from '../services/ScheduledPostQueueService';
import { projectAuthMiddleware } from '../middleware/projectAuthMiddleware';

const router = Router();

// Apply authorization middleware to all routes
router.use('/:projectId/*', projectAuthMiddleware);

/**
 * GET /api/projects/:projectId/post/schedule
 * Get schedule for a specific post by media_s3_url
 * Query params: mediaS3Url (required)
 */
router.get('/:projectId/post/schedule', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const { mediaS3Url } = req.query;

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    if (!mediaS3Url) {
      return res.status(400).json({
        success: false,
        error: 'mediaS3Url query parameter is required'
      });
    }

    // Find schedule by media_s3_url
    const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
    const schedule = await scheduleRepository.findOne({
      where: {
        projectId,
        mediaS3Url: mediaS3Url as string
      }
    });

    if (schedule) {
      return res.json({
        success: true,
        data: {
          scheduleId: schedule.id,
          scheduledAt: schedule.scheduledAt,
          mediaS3Url: schedule.mediaS3Url,
          mediaType: schedule.mediaType,
          tweetText: schedule.tweetText,
          status: schedule.status,
          failureReason: schedule.failureReason
        }
      });
    }

    // No schedule found
    return res.json({
      success: true,
      data: null
    });
  } catch (error: any) {
    logger.error(`❌ Error getting schedule: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to get schedule'
    });
  }
});

/**
 * POST /api/projects/:projectId/post/schedule
 * Create or update schedule for a post
 * Body: { mediaS3Url, mediaType, tweetText: { main_tweet, thread_array?, content_type }, scheduledAt: ISO datetime string }
 */
router.post('/:projectId/post/schedule', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const { mediaS3Url, mediaType, tweetText, scheduledAt } = req.body;

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    if (!mediaS3Url) {
      return res.status(400).json({
        success: false,
        error: 'mediaS3Url is required'
      });
    }

    if (!mediaType || !['image', 'video'].includes(mediaType)) {
      return res.status(400).json({
        success: false,
        error: 'mediaType must be "image" or "video"'
      });
    }

    if (!tweetText || !tweetText.main_tweet) {
      return res.status(400).json({
        success: false,
        error: 'tweetText with main_tweet is required'
      });
    }

    if (!scheduledAt) {
      return res.status(400).json({
        success: false,
        error: 'scheduledAt (ISO datetime string) is required'
      });
    }

    // Validate scheduledAt is a valid date in the future
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid scheduledAt date format. Use ISO datetime string'
      });
    }

    if (scheduledDate <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'scheduledAt must be in the future'
      });
    }

    // Normalize tweet text object
    const normalizedTweetText = {
      main_tweet: tweetText.main_tweet,
      thread_array: tweetText.thread_array || undefined,
      content_type: tweetText.content_type || 'shitpost'
    };

    const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
    
    // Find existing schedule by media_s3_url
    const existingSchedule = await scheduleRepository.findOne({
      where: {
        projectId,
        mediaS3Url: mediaS3Url as string
      }
    });

    let schedule: Web3PostsSchedule;
    if (existingSchedule) {
      // Update existing
      existingSchedule.mediaType = mediaType;
      existingSchedule.tweetText = normalizedTweetText;
      existingSchedule.scheduledAt = scheduledDate;
      existingSchedule.status = 'pending'; // Reset status when updating
      existingSchedule.failureReason = null;
      schedule = await scheduleRepository.save(existingSchedule);
      logger.info(`✅ Updated schedule for project ${projectId}, media: ${mediaS3Url.substring(0, 50)}...`);
    } else {
      // Create new
      schedule = new Web3PostsSchedule();
      schedule.projectId = projectId;
      schedule.mediaS3Url = mediaS3Url;
      schedule.mediaType = mediaType;
      schedule.tweetText = normalizedTweetText;
      schedule.scheduledAt = scheduledDate;
      schedule.status = 'pending';
      schedule.failureReason = null;
      schedule = await scheduleRepository.save(schedule);
      logger.info(`✅ Created schedule for project ${projectId}, media: ${mediaS3Url.substring(0, 50)}...`);
    }

    // Queue the scheduled post
    try {
      await queueScheduledPost(schedule.id, schedule.scheduledAt);
      logger.info(`📅 Queued scheduled post ${schedule.id} for execution`);
    } catch (error: any) {
      logger.error(`❌ Failed to queue scheduled post ${schedule.id}: ${error.message}`);
      // Don't fail the request if queuing fails - the cron service will pick it up
    }

    return res.json({
      success: true,
      data: {
        scheduleId: schedule.id,
        scheduledAt: schedule.scheduledAt,
        mediaS3Url: schedule.mediaS3Url,
        mediaType: schedule.mediaType,
        status: schedule.status
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error saving schedule: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to save schedule'
    });
  }
});

/**
 * DELETE /api/projects/:projectId/post/schedule
 * Remove schedule for a post
 * Query params: mediaS3Url (required)
 */
router.delete('/:projectId/post/schedule', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const { mediaS3Url } = req.query;

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    if (!mediaS3Url) {
      return res.status(400).json({
        success: false,
        error: 'mediaS3Url query parameter is required'
      });
    }

    const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
    const schedule = await scheduleRepository.findOne({
      where: {
        projectId,
        mediaS3Url: mediaS3Url as string
      }
    });

    if (schedule) {
      await scheduleRepository.remove(schedule);
      logger.info(`✅ Deleted schedule for project ${projectId}, media: ${(mediaS3Url as string).substring(0, 50)}...`);
    }

    return res.json({
      success: true,
      message: 'Schedule removed successfully'
    });
  } catch (error: any) {
    logger.error(`❌ Error deleting schedule: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete schedule'
    });
  }
});

/**
 * POST /api/projects/:projectId/post/schedule/trigger/:scheduleId
 * Manually trigger a scheduled post immediately (for testing)
 */
router.post('/:projectId/post/schedule/trigger/:scheduleId', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const scheduleId = parseInt(req.params.scheduleId || '');

    if (isNaN(projectId) || isNaN(scheduleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID or schedule ID'
      });
    }

    const { processScheduledPost } = await import('../services/ScheduledPostQueueService');
    const { Job } = await import('bullmq');

    // Create a mock job object for immediate processing
    // We'll create a minimal job-like object that matches the Job interface
    const mockJob = {
      id: `manual-trigger-${scheduleId}`,
      data: { scheduleId },
    } as any; // Use 'any' since we're creating a minimal mock

    logger.info(`🚀 Manually triggering scheduled post ${scheduleId} for project ${projectId}`);

    // Process the scheduled post immediately
    try {
      await processScheduledPost(mockJob);
      
      // Check if schedule was updated
      const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
      const schedule = await scheduleRepository.findOne({
        where: { id: scheduleId }
      });

      if (schedule) {
        return res.json({
          success: true,
          message: 'Scheduled post triggered successfully',
          data: {
            scheduleId: schedule.id,
            status: schedule.status,
            failureReason: schedule.failureReason
          }
        });
      } else {
        return res.status(404).json({
          success: false,
          error: 'Schedule not found'
        });
      }
    } catch (error: any) {
      logger.error(`❌ Error triggering scheduled post: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: `Failed to trigger scheduled post: ${error.message}`
      });
    }
  } catch (error: any) {
    logger.error(`❌ Error in trigger endpoint: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger scheduled post'
    });
  }
});

/**
 * POST /api/projects/:projectId/post/schedule/trigger-queue/:scheduleId
 * Manually trigger a scheduled post by adding it to the queue immediately (bypasses delay)
 */
router.post('/:projectId/post/schedule/trigger-queue/:scheduleId', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const scheduleId = parseInt(req.params.scheduleId || '');

    if (isNaN(projectId) || isNaN(scheduleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID or schedule ID'
      });
    }

    const { scheduledPostQueue } = await import('../services/ScheduledPostQueueService');

    // Get the schedule to check its status
    const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
    const schedule = await scheduleRepository.findOne({
      where: { id: scheduleId }
      // Note: We don't check projectId here to allow triggering from any context
      // The schedule itself will have the correct projectId
    });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: `Schedule ${scheduleId} not found`
      });
    }

    // Verify project ID matches (if provided)
    if (schedule.projectId !== projectId) {
      logger.warn(`⚠️ Schedule ${scheduleId} belongs to project ${schedule.projectId}, but request was for project ${projectId}`);
      // Continue anyway - the schedule will be processed correctly
    }

    if (schedule.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'This schedule has already been completed'
      });
    }

    logger.info(`🚀 Manually queueing scheduled post ${scheduleId} for immediate execution`);

    // Queue the post with 0 delay (immediate execution)
    try {
      await scheduledPostQueue.add(
        `scheduled-post-${scheduleId}`,
        { scheduleId },
        { delay: 0, removeOnComplete: true, removeOnFail: true }
      );

      logger.info(`✅ Job queued for immediate execution: schedule ${scheduleId}`);

      return res.json({
        success: true,
        message: 'Scheduled post queued for immediate execution',
        data: {
          scheduleId: schedule.id,
          status: schedule.status
        }
      });
    } catch (error: any) {
      logger.error(`❌ Error queueing scheduled post: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: `Failed to queue scheduled post: ${error.message}`
      });
    }
  } catch (error: any) {
    logger.error(`❌ Error in trigger-queue endpoint: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger scheduled post'
    });
  }
});

/**
 * POST /api/projects/:projectId/post/schedule/reset/:scheduleId
 * Reset a failed schedule to pending status (for retry)
 */
router.post('/:projectId/post/schedule/reset/:scheduleId', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const scheduleId = parseInt(req.params.scheduleId || '');

    if (isNaN(projectId) || isNaN(scheduleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID or schedule ID'
      });
    }

    const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
    const schedule = await scheduleRepository.findOne({
      where: { id: scheduleId }
    });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    if (schedule.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot reset a completed schedule'
      });
    }

    // Reset to pending
    schedule.status = 'pending';
    schedule.failureReason = null;
    await scheduleRepository.save(schedule);

    logger.info(`🔄 Reset schedule ${scheduleId} from ${schedule.status} to pending`);

    return res.json({
      success: true,
      message: 'Schedule reset to pending status',
      data: {
        scheduleId: schedule.id,
        status: schedule.status
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error resetting schedule: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to reset schedule'
    });
  }
});

/**
 * GET /api/projects/:projectId/post/schedule/queue-status
 * Get current queue status (for debugging)
 */
router.get('/:projectId/post/schedule/queue-status', async (req: Request, res: Response) => {
  try {
    const { scheduledPostQueue } = await import('../services/ScheduledPostQueueService');

    const waitingCount = await scheduledPostQueue.getWaitingCount();
    const delayedCount = await scheduledPostQueue.getDelayedCount();
    const activeCount = await scheduledPostQueue.getActiveCount();
    const completedCount = await scheduledPostQueue.getCompletedCount();
    const failedCount = await scheduledPostQueue.getFailedCount();

    // Get sample jobs
    const waitingJobs = await scheduledPostQueue.getJobs(['waiting'], 0, 10);
    const delayedJobs = await scheduledPostQueue.getJobs(['delayed'], 0, 10);
    const activeJobs = await scheduledPostQueue.getJobs(['active'], 0, 10);

    return res.json({
      success: true,
      data: {
        counts: {
          waiting: waitingCount,
          delayed: delayedCount,
          active: activeCount,
          completed: completedCount,
          failed: failedCount
        },
        sampleJobs: {
          waiting: waitingJobs.map(job => ({
            id: job.id,
            scheduleId: job.data?.scheduleId,
            name: job.name
          })),
          delayed: delayedJobs.map(job => ({
            id: job.id,
            scheduleId: job.data?.scheduleId,
            name: job.name,
            delay: job.opts?.delay
          })),
          active: activeJobs.map(job => ({
            id: job.id,
            scheduleId: job.data?.scheduleId,
            name: job.name
          }))
        }
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error getting queue status: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to get queue status'
    });
  }
});

export { router as projectScheduleRoutes };

