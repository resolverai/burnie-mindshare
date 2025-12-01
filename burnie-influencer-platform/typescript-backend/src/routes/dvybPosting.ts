import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { DvybPostingService, PostNowRequest } from '../services/DvybPostingService';
import { DvybTwitterPostingService } from '../services/DvybTwitterPostingService';
import { DvybTokenValidationService } from '../services/DvybTokenValidationService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { AppDataSource } from '../config/database';

const router = Router();

/**
 * POST /api/dvyb/post/now
 * Post content immediately to selected platforms
 */
router.post('/now', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { platforms, content } = req.body;

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'platforms array is required',
        timestamp: new Date().toISOString(),
      });
    }

    if (!content || !content.caption || !content.mediaUrl || !content.mediaType) {
      return res.status(400).json({
        success: false,
        error: 'content object with caption, mediaUrl, and mediaType is required',
        timestamp: new Date().toISOString(),
      });
    }

    const request: PostNowRequest = {
      accountId,
      platforms,
      content,
    };

    const result = await DvybPostingService.postNow(request);

    return res.json({
      success: result.success,
      data: result,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ DVYB post now error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to post content',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/post/tweet
 * Post a single tweet
 */
router.post('/tweet', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { tweetText, generatedContentId, imageUrl, videoUrl, mediaIds } = req.body;

    if (!tweetText) {
      return res.status(400).json({
        success: false,
        error: 'tweetText is required',
        timestamp: new Date().toISOString(),
      });
    }

    const post = await DvybTwitterPostingService.postTweet(accountId, {
      tweetText,
      generatedContentId,
      imageUrl,
      videoUrl,
      mediaIds,
    });

    return res.json({
      success: true,
      data: post,
      message: 'Tweet posted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ DVYB post tweet error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to post tweet',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/post/thread
 * Post a thread
 */
router.post('/thread', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { tweets, generatedContentId, mediaUrls } = req.body;

    if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'tweets array is required',
        timestamp: new Date().toISOString(),
      });
    }

    const post = await DvybTwitterPostingService.postThread(accountId, {
      tweets,
      generatedContentId,
      mediaUrls,
    });

    return res.json({
      success: true,
      data: post,
      message: 'Thread posted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ DVYB post thread error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to post thread',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/posts/schedule
 * Schedule a post to multiple platforms
 * Body: { scheduledFor, platforms, content: { caption, mediaUrl, mediaType, generatedContentId, postIndex } }
 */
router.post('/schedule', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { scheduledFor, platforms, content, timezone } = req.body;

    // Validate inputs
    if (!scheduledFor) {
      return res.status(400).json({
        success: false,
        error: 'scheduledFor is required',
        timestamp: new Date().toISOString(),
      });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'platforms array is required',
        timestamp: new Date().toISOString(),
      });
    }

    if (!content || !content.caption || !content.mediaUrl || !content.mediaType) {
      return res.status(400).json({
        success: false,
        error: 'content object with caption, mediaUrl, and mediaType is required',
        timestamp: new Date().toISOString(),
      });
    }

    // Server-side validation: Verify mediaType matches mediaUrl to prevent upload failures
    const urlLower = content.mediaUrl.toLowerCase();
    const isVideoUrl = urlLower.includes('.mp4') || urlLower.includes('.mov') || 
                       urlLower.includes('.avi') || urlLower.includes('.webm') ||
                       urlLower.includes('video') || urlLower.includes('stitched_video');
    
    if (isVideoUrl && content.mediaType === 'image') {
      logger.warn(`⚠️ Media type mismatch detected! URL suggests video but mediaType is 'image'. Auto-correcting to 'video'`);
      logger.warn(`   URL: ${content.mediaUrl.substring(0, 100)}...`);
      content.mediaType = 'video'; // Auto-correct to prevent upload failures
    } else if (!isVideoUrl && content.mediaType === 'video') {
      logger.warn(`⚠️ Media type mismatch detected! URL suggests image but mediaType is 'video'. Auto-correcting to 'image'`);
      logger.warn(`   URL: ${content.mediaUrl.substring(0, 100)}...`);
      content.mediaType = 'image'; // Auto-correct to prevent upload failures
    }
    
    logger.info(`✅ Media type validated: ${content.mediaType} for URL: ${content.mediaUrl.substring(0, 80)}...`);

    // Validate scheduledFor is a valid future date
    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid scheduledFor date format',
        timestamp: new Date().toISOString(),
      });
    }

    if (scheduledDate <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'scheduledFor must be in the future',
        timestamp: new Date().toISOString(),
      });
    }

    // Import DvybScheduledPostQueueService
    const { queueDvybScheduledPost, removeScheduledPost } = await import('../services/DvybScheduledPostQueueService');
    const { DvybSchedule } = await import('../models/DvybSchedule');
    
    const scheduleRepo = AppDataSource.getRepository(DvybSchedule);

    // Check if a schedule already exists for this content/post
    let schedule: any = null;
    
    if (content.generatedContentId && content.postIndex !== undefined) {
      // Try to find existing schedule for this specific content and post
      // Search for: pending, failed, OR posted-with-errors (to allow retries)
      const existingSchedules = await scheduleRepo
        .createQueryBuilder('schedule')
        .where('schedule.accountId = :accountId', { accountId })
        .andWhere('schedule.generatedContentId = :generatedContentId', { 
          generatedContentId: content.generatedContentId 
        })
        .andWhere(
          '(schedule.status = :pendingStatus OR schedule.status = :failedStatus OR (schedule.status = :postedStatus AND schedule.errorMessage IS NOT NULL))',
          { 
            pendingStatus: 'pending', 
            failedStatus: 'failed',
            postedStatus: 'posted'
          }
        )
        .getMany();
      
      // Filter by postIndex in postMetadata
      schedule = existingSchedules.find(s => {
        const metadata = s.postMetadata || {};
        return metadata.postIndex === content.postIndex;
      });
      
      if (schedule) {
        logger.info(`📝 Found existing schedule ${schedule.id} (status: ${schedule.status}) - updating for retry`);
        
        // Remove old BullMQ job before updating (if any)
        try {
          await removeScheduledPost(schedule.id);
          logger.info(`🗑️ Removed old BullMQ job for schedule ${schedule.id}`);
        } catch (error: any) {
          logger.warn(`⚠️ Could not remove old BullMQ job: ${error.message}`);
        }
        
        // Update existing schedule and reset to pending
        schedule.scheduledFor = scheduledDate;
        schedule.timezone = timezone || 'UTC';
        schedule.platform = platforms.join(',');
        schedule.status = 'pending'; // Reset to pending for retry
        schedule.postedAt = null; // Clear postedAt for retry
        schedule.errorMessage = null; // Clear previous errors
        schedule.postMetadata = {
          platforms,
          content,
          postIndex: content.postIndex,
        };
        
        logger.info(`🔄 Schedule ${schedule.id} reset to pending for retry at ${scheduledDate.toISOString()}`);
      }
    }
    
    // If no existing schedule found, create new one
    if (!schedule) {
      logger.info(`✨ Creating new schedule for content ${content.generatedContentId}, post ${content.postIndex}`);
      schedule = scheduleRepo.create({
        accountId,
        generatedContentId: content.generatedContentId || null,
        scheduledFor: scheduledDate,
        timezone: timezone || 'UTC',
        platform: platforms.join(','),
        status: 'pending',
        postMetadata: {
          platforms,
          content,
          postIndex: content.postIndex,
        },
        postedAt: null,
        errorMessage: null,
      });
    }

    await scheduleRepo.save(schedule);
    logger.info(`✅ ${schedule.id ? 'Updated' : 'Created'} DVYB schedule ${schedule.id} for account ${accountId}`);

    // Queue to BullMQ
    try {
      await queueDvybScheduledPost(schedule.id, scheduledDate);
      logger.info(`📅 Queued DVYB schedule ${schedule.id} for execution`);
    } catch (error: any) {
      logger.error(`❌ Failed to queue DVYB schedule ${schedule.id}: ${error.message}`);
      // Don't fail the request - cron service will pick it up
    }

    return res.json({
      success: true,
      data: {
        scheduleId: schedule.id,
        scheduledFor: schedule.scheduledFor,
        platforms,
        status: schedule.status,
      },
      message: 'Post scheduled successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ DVYB schedule post error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to schedule post',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/posts/validate-tokens
 * Validate tokens for multiple platforms before scheduling
 * Body: { platforms: string[], requireOAuth1ForTwitterVideo: boolean }
 */
router.post('/validate-tokens', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { platforms, requireOAuth1ForTwitterVideo } = req.body;

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'platforms array is required',
        timestamp: new Date().toISOString(),
      });
    }

    const validation = await DvybTokenValidationService.validatePlatformTokens(
      accountId,
      platforms,
      requireOAuth1ForTwitterVideo || false
    );

    return res.json({
      success: true,
      data: validation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Token validation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate tokens',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/posts/schedules
 * Get schedules for generated content
 */
router.get('/schedules', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const generatedContentId = req.query.generatedContentId 
      ? parseInt(req.query.generatedContentId as string) 
      : null;

    const { DvybSchedule } = await import('../models/DvybSchedule');
    const scheduleRepo = AppDataSource.getRepository(DvybSchedule);

    let query = scheduleRepo.createQueryBuilder('schedule')
      .where('schedule.accountId = :accountId', { accountId });

    if (generatedContentId) {
      query = query.andWhere('schedule.generatedContentId = :generatedContentId', { generatedContentId });
    }

    const schedules = await query
      .orderBy('schedule.scheduledFor', 'DESC')
      .getMany();

    return res.json({
      success: true,
      data: schedules,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Get schedules error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get schedules',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/posts
 * Get all posts
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const posts = await DvybTwitterPostingService.getAllPosts(accountId, limit);

    return res.json({
      success: true,
      data: posts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get DVYB posts error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve posts',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/posts/scheduled
 * Get scheduled posts
 */
router.get('/scheduled', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;

    const scheduled = await DvybTwitterPostingService.getScheduledPosts(accountId);

    return res.json({
      success: true,
      data: scheduled,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Get scheduled posts error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve scheduled posts',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/dvyb/posts/scheduled/:scheduleId
 * Cancel a scheduled post
 */
router.delete('/scheduled/:scheduleId', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    if (!req.params.scheduleId) {
      return res.status(400).json({ success: false, error: 'scheduleId is required' });
    }
    const scheduleId = parseInt(req.params.scheduleId, 10);

    await DvybTwitterPostingService.deleteScheduledPost(accountId, scheduleId);

    return res.json({
      success: true,
      message: 'Scheduled post cancelled',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Cancel scheduled post error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel scheduled post',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/dvyb/posts/:postId/refresh-metrics
 * Refresh engagement metrics for a post
 */
router.post('/:postId/refresh-metrics', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    if (!req.params.postId) {
      return res.status(400).json({ success: false, error: 'postId is required' });
    }
    const postId = parseInt(req.params.postId, 10);

    await DvybTwitterPostingService.fetchEngagementMetrics(accountId, postId);

    return res.json({
      success: true,
      message: 'Engagement metrics updated',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Refresh metrics error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to refresh metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
