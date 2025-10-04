import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { UserTwitterPost } from '../models/UserTwitterPost';
import { twitterEngagementService } from '../services/TwitterEngagementService';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route GET /api/user-twitter-posts/:walletAddress
 * @desc Get all Twitter posts for a user with engagement metrics
 */
router.get('/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const { refresh } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    logger.info(`📱 Fetching Twitter posts for wallet: ${walletAddress}`);

    // If refresh is requested, update engagement metrics first
    if (refresh === 'true') {
      logger.info(`🔄 Refreshing engagement metrics for wallet: ${walletAddress}`);
      
      const updateResult = await twitterEngagementService.updateUserEngagement(walletAddress);
      
      if (!updateResult.success) {
        logger.warn(`⚠️ Failed to update engagement metrics for ${walletAddress}`);
      } else {
        logger.info(`✅ Updated engagement for ${updateResult.updatedPosts}/${updateResult.totalPosts} posts`);
      }
    }

    // Get posts with engagement data
    const posts = await twitterEngagementService.getUserPostsWithEngagement(walletAddress);

    // Transform posts for frontend
    const transformedPosts = posts.map(post => ({
      id: post.id,
      walletAddress: post.walletAddress,
      postType: post.postType,
      mainTweet: post.mainTweet,
      mainTweetId: post.mainTweetId,
      tweetThread: post.tweetThread,
      imageUrl: post.imageUrl,
      videoUrl: post.videoUrl,
      engagementMetrics: post.engagementMetrics,
      totalEngagement: post.getTotalEngagement(),
      postedAt: post.postedAt,
      contentId: post.contentId,
      platformSource: post.platformSource,
      threadCount: post.threadCount,
      lastEngagementFetch: post.lastEngagementFetch,
      isThread: post.isThread(),
      hasEngagementData: post.hasEngagementData(),
      needsEngagementUpdate: post.needsEngagementUpdate(),
      tweetUrl: `https://twitter.com/i/web/status/${post.mainTweetId}`,
      content: post.content ? {
        id: post.content.id,
        contentText: post.content.contentText,
        predictedMindshare: post.content.predictedMindshare,
        qualityScore: post.content.qualityScore
      } : null
    }));

    return res.json({
      success: true,
      data: {
        posts: transformedPosts,
        totalPosts: transformedPosts.length,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching user Twitter posts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Twitter posts',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/user-twitter-posts/:walletAddress/refresh-engagement
 * @desc Refresh engagement metrics for all posts by a user
 */
router.post('/:walletAddress/refresh-engagement', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    logger.info(`🔄 Manual engagement refresh requested for wallet: ${walletAddress}`);

    const updateResult = await twitterEngagementService.updateUserEngagement(walletAddress);

    if (!updateResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to update engagement metrics. Please check your Twitter connection.',
        data: updateResult
      });
    }

    return res.json({
      success: true,
      message: `Updated engagement metrics for ${updateResult.updatedPosts} posts`,
      data: updateResult
    });

  } catch (error) {
    logger.error('❌ Error refreshing engagement metrics:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh engagement metrics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/user-twitter-posts/:walletAddress/stats
 * @desc Get Twitter posting statistics for a user
 */
router.get('/:walletAddress/stats', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    const postRepository = AppDataSource.getRepository(UserTwitterPost);

    // Get all posts for stats calculation
    const posts = await postRepository.find({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { postedAt: 'DESC' }
    });

    // Calculate statistics
    const stats = {
      totalPosts: posts.length,
      postTypes: {
        shitpost: posts.filter(p => p.postType === 'shitpost').length,
        longpost: posts.filter(p => p.postType === 'longpost').length,
        thread: posts.filter(p => p.postType === 'thread').length
      },
      totalEngagement: {
        likes: 0,
        retweets: 0,
        replies: 0,
        quotes: 0,
        views: 0
      },
      averageEngagement: {
        likes: 0,
        retweets: 0,
        replies: 0,
        quotes: 0,
        views: 0
      },
      postsWithEngagement: 0,
      lastPosted: posts.length > 0 ? posts[0].postedAt : null,
      firstPosted: posts.length > 0 ? posts[posts.length - 1].postedAt : null
    };

    // Calculate total and average engagement
    let postsWithEngagement = 0;
    posts.forEach(post => {
      if (post.hasEngagementData()) {
        postsWithEngagement++;
        const totalEng = post.getTotalEngagement();
        stats.totalEngagement.likes += totalEng.likes;
        stats.totalEngagement.retweets += totalEng.retweets;
        stats.totalEngagement.replies += totalEng.replies;
        stats.totalEngagement.quotes += totalEng.quotes;
        stats.totalEngagement.views += totalEng.views;
      }
    });

    stats.postsWithEngagement = postsWithEngagement;

    if (postsWithEngagement > 0) {
      stats.averageEngagement = {
        likes: Math.round(stats.totalEngagement.likes / postsWithEngagement),
        retweets: Math.round(stats.totalEngagement.retweets / postsWithEngagement),
        replies: Math.round(stats.totalEngagement.replies / postsWithEngagement),
        quotes: Math.round(stats.totalEngagement.quotes / postsWithEngagement),
        views: Math.round(stats.totalEngagement.views / postsWithEngagement)
      };
    }

    return res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('❌ Error fetching user Twitter stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Twitter statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route DELETE /api/user-twitter-posts/:postId
 * @desc Delete a Twitter post record (not the actual tweet)
 */
router.delete('/:postId', async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');

    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        message: 'Wallet address required'
      });
    }

    const postRepository = AppDataSource.getRepository(UserTwitterPost);

    // Find the post and verify ownership
    const post = await postRepository.findOne({
      where: { 
        id: parseInt(postId),
        walletAddress: walletAddress.toLowerCase()
      }
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or not owned by this wallet'
      });
    }

    await postRepository.remove(post);

    logger.info(`🗑️ Deleted Twitter post record ${postId} for wallet ${walletAddress}`);

    return res.json({
      success: true,
      message: 'Post record deleted successfully'
    });

  } catch (error) {
    logger.error('❌ Error deleting Twitter post record:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete post record',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
