import { Router, Response } from 'express';
import { logger } from '../config/logger';
import { DvybTwitterPostingService } from '../services/DvybTwitterPostingService';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';

const router = Router();

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
 * POST /api/dvyb/post/schedule
 * Schedule a post
 */
router.post('/schedule', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { scheduledFor, generatedContentId, platform, metadata } = req.body;

    if (!scheduledFor) {
      return res.status(400).json({
        success: false,
        error: 'scheduledFor is required',
        timestamp: new Date().toISOString(),
      });
    }

    const schedule = await DvybTwitterPostingService.schedulePost(accountId, {
      scheduledFor: new Date(scheduledFor),
      generatedContentId,
      platform,
      metadata,
    });

    return res.json({
      success: true,
      data: schedule,
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

