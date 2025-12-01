import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();

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
    const s3Service = new S3PresignedUrlService();

    // Get date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Fetch posts
    const posts = await instagramRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    // Generate presigned URLs for media using S3PresignedUrlService
    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedMediaUrl = post.mediaUrl;
        if (post.mediaUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.mediaUrl, 3600, true);
          if (newUrl) {
            presignedMediaUrl = newUrl;
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
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
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
    const s3Service = new S3PresignedUrlService();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await twitterRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedImageUrl = post.imageUrl;
        let presignedVideoUrl = post.videoUrl;
        
        // Generate presigned URL for image using S3PresignedUrlService
        if (post.imageUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.imageUrl, 3600, true);
          if (newUrl) {
            presignedImageUrl = newUrl;
          }
        }
        
        // Generate presigned URL for video using S3PresignedUrlService
        if (post.videoUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.videoUrl, 3600, true);
          if (newUrl) {
            presignedVideoUrl = newUrl;
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
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
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
    const s3Service = new S3PresignedUrlService();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await tiktokRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedVideoUrl = post.videoUrl;
        let presignedCoverUrl = post.coverImageUrl;

        // Generate presigned URL for video using S3PresignedUrlService
        if (post.videoUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.videoUrl, 3600, true);
          if (newUrl) {
            presignedVideoUrl = newUrl;
          }
        }

        // Generate presigned URL for cover image using S3PresignedUrlService
        if (post.coverImageUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.coverImageUrl, 3600, true);
          if (newUrl) {
            presignedCoverUrl = newUrl;
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
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
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
    const s3Service = new S3PresignedUrlService();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const posts = await linkedinRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
      .orderBy('post.postedAt', 'DESC')
      .limit(5)
      .getMany();

    const postsWithPresignedUrls = await Promise.all(
      posts.map(async (post) => {
        let presignedMediaUrl = post.mediaUrl;
        if (post.mediaUrl) {
          const newUrl = await s3Service.generatePresignedUrl(post.mediaUrl, 3600, true);
          if (newUrl) {
            presignedMediaUrl = newUrl;
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
      .andWhere('post.postedAt >= :startDate', { startDate })
      .andWhere('post.postedAt IS NOT NULL', {})
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

/**
 * Get growth metrics comparison (current period vs previous period)
 * GET /api/dvyb/analytics/growth
 */
router.get('/growth', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    const { days = 30 } = req.query;
    const daysNum = Number(days);

    const calculatePeriodMetrics = async (startDate: Date, endDate: Date) => {
      const repos = {
        instagram: AppDataSource.getRepository(DvybInstagramPost),
        twitter: AppDataSource.getRepository(DvybTwitterPost),
        tiktok: AppDataSource.getRepository(DvybTikTokPost),
        linkedin: AppDataSource.getRepository(DvybLinkedInPost),
      };

      const results: any = {
        instagram: { impressions: 0, engagement: 0, followers: 0 },
        twitter: { impressions: 0, engagement: 0, followers: 0 },
        tiktok: { views: 0, engagement: 0, followers: 0 },
        linkedin: { impressions: 0, engagement: 0, followers: 0 },
      };

      // Instagram
      const instagramPosts = await repos.instagram
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt >= :startDate', { startDate })
        .andWhere('post.postedAt < :endDate', { endDate })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany();

      instagramPosts.forEach(post => {
        const metrics = post.engagementMetrics || {};
        results.instagram.impressions += metrics.impressions || 0;
        results.instagram.engagement += (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0);
        // Followers would need to be tracked differently - using latest value
      });

      // Twitter
      const twitterPosts = await repos.twitter
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt >= :startDate', { startDate })
        .andWhere('post.postedAt < :endDate', { endDate })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany();

      twitterPosts.forEach(post => {
        const metrics = post.engagementMetrics || {};
        results.twitter.impressions += metrics.impressions || 0;
        results.twitter.engagement += (metrics.likes || 0) + (metrics.retweets || 0) + (metrics.replies || 0);
      });

      // TikTok
      const tiktokPosts = await repos.tiktok
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt >= :startDate', { startDate })
        .andWhere('post.postedAt < :endDate', { endDate })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany();

      tiktokPosts.forEach(post => {
        const metrics = post.engagementMetrics || {};
        results.tiktok.views += metrics.views || 0;
        results.tiktok.engagement += (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0);
      });

      // LinkedIn
      const linkedinPosts = await repos.linkedin
        .createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId })
        .andWhere('post.postedAt >= :startDate', { startDate })
        .andWhere('post.postedAt < :endDate', { endDate })
        .andWhere('post.postedAt IS NOT NULL')
        .getMany();

      linkedinPosts.forEach(post => {
        const metrics = post.engagementMetrics || {};
        results.linkedin.impressions += metrics.impressions || 0;
        results.linkedin.engagement += (metrics.reactions || 0) + (metrics.comments || 0) + (metrics.shares || 0);
      });

      return results;
    };

    const calculateGrowth = (current: number, previous: number): string => {
      if (previous === 0) return current > 0 ? '+100%' : '+0%';
      const growth = ((current - previous) / previous) * 100;
      const sign = growth >= 0 ? '+' : '';
      return `${sign}${Math.round(growth)}%`;
    };

    // Current period
    const currentEnd = new Date();
    const currentStart = new Date();
    currentStart.setDate(currentStart.getDate() - daysNum);

    // Previous period
    const previousEnd = new Date(currentStart);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - daysNum);

    const currentMetrics = await calculatePeriodMetrics(currentStart, currentEnd);
    const previousMetrics = await calculatePeriodMetrics(previousStart, previousEnd);

    const growth = {
      instagram: {
        impressions: calculateGrowth(currentMetrics.instagram.impressions, previousMetrics.instagram.impressions),
        engagement: calculateGrowth(currentMetrics.instagram.engagement, previousMetrics.instagram.engagement),
        followers: calculateGrowth(currentMetrics.instagram.followers, previousMetrics.instagram.followers),
      },
      twitter: {
        impressions: calculateGrowth(currentMetrics.twitter.impressions, previousMetrics.twitter.impressions),
        engagement: calculateGrowth(currentMetrics.twitter.engagement, previousMetrics.twitter.engagement),
        followers: calculateGrowth(currentMetrics.twitter.followers, previousMetrics.twitter.followers),
      },
      tiktok: {
        views: calculateGrowth(currentMetrics.tiktok.views, previousMetrics.tiktok.views),
        engagement: calculateGrowth(currentMetrics.tiktok.engagement, previousMetrics.tiktok.engagement),
        followers: calculateGrowth(currentMetrics.tiktok.followers, previousMetrics.tiktok.followers),
      },
      linkedin: {
        impressions: calculateGrowth(currentMetrics.linkedin.impressions, previousMetrics.linkedin.impressions),
        engagement: calculateGrowth(currentMetrics.linkedin.engagement, previousMetrics.linkedin.engagement),
        followers: calculateGrowth(currentMetrics.linkedin.followers, previousMetrics.linkedin.followers),
      },
    };

    return res.json({
      success: true,
      data: growth,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Growth metrics error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to calculate growth metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
