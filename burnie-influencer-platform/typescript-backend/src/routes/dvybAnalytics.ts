import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3Service } from '../services/S3Service';
import { UrlCacheService } from '../services/UrlCacheService';

const router = Router();
const s3Service = new S3Service();

const emptyAnalytics = {
  success: true,
  data: {
    metrics: {
      impressions: 0,
      reach: 0,
      views: 0,
      engagement: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      retweets: 0,
      replies: 0,
      reactions: 0,
      clicks: 0,
      followers: 0,
    },
    topPosts: [],
  },
};

/**
 * Get Instagram analytics for the home page
 * GET /api/dvyb/analytics/instagram
 */
router.get('/instagram', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { days = 30 } = req.query;

    const instagramRepo = AppDataSource.getRepository(DvybInstagramPost);
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();

    // Get date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Fetch posts
    const posts = await instagramRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    // Generate presigned URLs for media
    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedMediaUrl = post.mediaUrl;
        if (post.mediaUrl && post.mediaUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.mediaUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedMediaUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedMediaUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }
        return {
          ...post,
          mediaUrl: presignedMediaUrl,
        };
      })
    );

    // Calculate metrics
    const allPosts = await instagramRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .getMany();

    const metrics = allPosts.reduce(
      (acc, post) => {
        const engagement = post.engagementMetrics || {};
        return {
          impressions: acc.impressions + (engagement.impressions || 0),
          reach: acc.reach + (engagement.reach || 0),
          likes: acc.likes + (engagement.likes || 0),
          comments: acc.comments + (engagement.comments || 0),
          shares: acc.shares + (engagement.shares || 0),
          saves: acc.saves + (engagement.saves || 0),
        };
      },
      { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
    );

    const followers = 0;

    return res.json({
      success: true,
      data: {
        metrics: {
          impressions: metrics.impressions,
          reach: metrics.reach,
          engagement: metrics.likes + metrics.comments + metrics.shares,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          saves: metrics.saves,
          followers: followers,
        },
        topPosts: postsWithPresignedUrls,
      },
    });
  } catch (error: any) {
    // Return empty data if table doesn't exist or other DB errors
    logger.warn(`Instagram analytics error (returning empty data): ${error.message}`);
    return res.json(emptyAnalytics);
  }
});

/**
 * Get Twitter analytics for the home page
 * GET /api/dvyb/analytics/twitter
 */
router.get('/twitter', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { days = 30 } = req.query;

    const twitterRepo = AppDataSource.getRepository(DvybTwitterPost);
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await twitterRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedImageUrl = post.imageUrl;
        let presignedVideoUrl = post.videoUrl;
        
        // Generate presigned URL for image if exists
        if (post.imageUrl && post.imageUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.imageUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedImageUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedImageUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }
        
        // Generate presigned URL for video if exists
        if (post.videoUrl && post.videoUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.videoUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedVideoUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedVideoUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }
        
        return {
          ...post,
          imageUrl: presignedImageUrl,
          videoUrl: presignedVideoUrl,
        };
      })
    );

    const allPosts = await twitterRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .getMany();

    const metrics = allPosts.reduce(
      (acc, post) => {
        const engagement = post.engagementMetrics || {};
        return {
          impressions: acc.impressions + (engagement.impressions || 0),
          likes: acc.likes + (engagement.likes || 0),
          retweets: acc.retweets + (engagement.retweets || 0),
          replies: acc.replies + (engagement.replies || 0),
          quotes: acc.quotes + (engagement.quotes || 0),
        };
      },
      { impressions: 0, likes: 0, retweets: 0, replies: 0, quotes: 0 }
    );

    const followers = 0;

    return res.json({
      success: true,
      data: {
        metrics: {
          impressions: metrics.impressions,
          engagement: metrics.likes + metrics.retweets + metrics.replies + metrics.quotes,
          likes: metrics.likes,
          retweets: metrics.retweets,
          replies: metrics.replies,
          followers: followers,
        },
        topPosts: postsWithPresignedUrls,
      },
    });
  } catch (error: any) {
    logger.warn(`Twitter analytics error (returning empty data): ${error.message}`);
    return res.json(emptyAnalytics);
  }
});

/**
 * Get TikTok analytics for the home page
 * GET /api/dvyb/analytics/tiktok
 */
router.get('/tiktok', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { days = 30 } = req.query;

    const tiktokRepo = AppDataSource.getRepository(DvybTikTokPost);
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await tiktokRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedVideoUrl = post.videoUrl;
        let presignedCoverUrl = post.coverImageUrl;

        if (post.videoUrl && post.videoUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.videoUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedVideoUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedVideoUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }

        if (post.coverImageUrl && post.coverImageUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.coverImageUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedCoverUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedCoverUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }

        return {
          ...post,
          videoUrl: presignedVideoUrl,
          coverImageUrl: presignedCoverUrl,
        };
      })
    );

    const allPosts = await tiktokRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .getMany();

    const metrics = allPosts.reduce(
      (acc, post) => {
        const engagement = post.engagementMetrics || {};
        return {
          views: acc.views + (engagement.views || 0),
          likes: acc.likes + (engagement.likes || 0),
          comments: acc.comments + (engagement.comments || 0),
          shares: acc.shares + (engagement.shares || 0),
        };
      },
      { views: 0, likes: 0, comments: 0, shares: 0 }
    );

    const followers = 0;

    return res.json({
      success: true,
      data: {
        metrics: {
          views: metrics.views,
          engagement: metrics.likes + metrics.comments + metrics.shares,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          followers: followers,
        },
        topPosts: postsWithPresignedUrls,
      },
    });
  } catch (error: any) {
    logger.warn(`TikTok analytics error (returning empty data): ${error.message}`);
    return res.json(emptyAnalytics);
  }
});

/**
 * Get LinkedIn analytics for the home page
 * GET /api/dvyb/analytics/linkedin
 */
router.get('/linkedin', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { days = 30 } = req.query;

    const linkedinRepo = AppDataSource.getRepository(DvybLinkedInPost);
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await linkedinRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedMediaUrl = post.mediaUrl;
        if (post.mediaUrl && post.mediaUrl.includes('s3.amazonaws.com')) {
          const urlParts = post.mediaUrl.split('.com/');
          if (urlParts.length > 1) {
            const s3Key = urlParts[1];
            if (s3Key) {
              const cachedUrl = isRedisAvailable ? await UrlCacheService.getCachedUrl(s3Key) : null;
              if (cachedUrl) {
                presignedMediaUrl = cachedUrl;
              } else {
                const newPresignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
                presignedMediaUrl = newPresignedUrl;
                if (isRedisAvailable && newPresignedUrl) {
                  await UrlCacheService.cacheUrl(s3Key, newPresignedUrl);
                }
              }
            }
          }
        }
        return {
          ...post,
          mediaUrl: presignedMediaUrl,
        };
      })
    );

    const allPosts = await linkedinRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.status = :status', { status: 'posted' })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .getMany();

    const metrics = allPosts.reduce(
      (acc, post) => {
        const engagement = post.engagementMetrics || {};
        return {
          impressions: acc.impressions + (engagement.impressions || 0),
          reactions: acc.reactions + (engagement.reactions || 0),
          comments: acc.comments + (engagement.comments || 0),
          shares: acc.shares + (engagement.shares || 0),
          clicks: acc.clicks + (engagement.clicks || 0),
        };
      },
      { impressions: 0, reactions: 0, comments: 0, shares: 0, clicks: 0 }
    );

    const followers = 0;

    return res.json({
      success: true,
      data: {
        metrics: {
          impressions: metrics.impressions,
          engagement: metrics.reactions + metrics.comments + metrics.shares,
          reactions: metrics.reactions,
          comments: metrics.comments,
          shares: metrics.shares,
          followers: followers,
        },
        topPosts: postsWithPresignedUrls,
      },
    });
  } catch (error: any) {
    logger.warn(`LinkedIn analytics error (returning empty data): ${error.message}`);
    return res.json(emptyAnalytics);
  }
});

export default router;
