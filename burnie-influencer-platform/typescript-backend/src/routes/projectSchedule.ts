import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web3PostsSchedule } from '../models/Web3PostsSchedule';
import { Web3ProjectConfiguration } from '../models/Web3ProjectConfiguration';
import { logger } from '../config/logger';

const router = Router();

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
          tweetText: schedule.tweetText
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
      schedule = await scheduleRepository.save(schedule);
      logger.info(`✅ Created schedule for project ${projectId}, media: ${mediaS3Url.substring(0, 50)}...`);
    }

    return res.json({
      success: true,
      data: {
        scheduleId: schedule.id,
        scheduledAt: schedule.scheduledAt,
        mediaS3Url: schedule.mediaS3Url,
        mediaType: schedule.mediaType
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

export { router as projectScheduleRoutes };

