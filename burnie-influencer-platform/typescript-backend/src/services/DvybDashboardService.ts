import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybSchedule } from '../models/DvybSchedule';

export class DvybDashboardService {
  /**
   * Get dashboard metrics and data for an account
   */
  static async getDashboardData(accountId: number): Promise<any> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const scheduleRepo = AppDataSource.getRepository(DvybSchedule);

      // Get content stats
      const totalContent = await contentRepo.count({ where: { accountId } });
      const completedContent = await contentRepo.count({
        where: { accountId, status: 'completed' },
      });
      const processingContent = await contentRepo.count({
        where: { accountId, status: 'processing' },
      });

      // Get posted content stats
      const totalPosts = await postRepo.count({ where: { accountId } });

      // Get engagement metrics
      const posts = await postRepo.find({
        where: { accountId },
        order: { postedAt: 'DESC' },
        take: 100, // Last 100 posts
      });

      let totalLikes = 0;
      let totalRetweets = 0;
      let totalReplies = 0;
      let totalViews = 0;

      posts.forEach((post) => {
        if (post.engagementMetrics) {
          totalLikes += post.engagementMetrics.likes || 0;
          totalRetweets += post.engagementMetrics.retweets || 0;
          totalReplies += post.engagementMetrics.replies || 0;
          totalViews += post.engagementMetrics.views || 0;
        }
      });

      // Get scheduled posts
      const upcomingScheduled = await scheduleRepo.count({
        where: {
          accountId,
          status: 'pending',
        },
      });

      // Get recent activity
      const recentContent = await contentRepo.find({
        where: { accountId },
        order: { createdAt: 'DESC' },
        take: 10,
      });

      const recentPosts = await postRepo.find({
        where: { accountId },
        order: { postedAt: 'DESC' },
        take: 10,
      });

      // Calculate engagement rate
      const avgEngagementRate = totalPosts > 0
        ? ((totalLikes + totalRetweets + totalReplies) / totalPosts).toFixed(2)
        : '0';

      logger.debug(`📊 Retrieved dashboard data for DVYB account ${accountId}`);

      return {
        metrics: {
          total_content: totalContent,
          completed_content: completedContent,
          processing_content: processingContent,
          total_posts: totalPosts,
          upcoming_scheduled: upcomingScheduled,
          total_engagement: totalLikes + totalRetweets + totalReplies,
          total_likes: totalLikes,
          total_retweets: totalRetweets,
          total_replies: totalReplies,
          total_views: totalViews,
          avg_engagement_rate: parseFloat(avgEngagementRate),
        },
        recent_content: recentContent,
        recent_posts: recentPosts,
      };
    } catch (error) {
      logger.error('❌ DVYB dashboard data error:', error);
      throw error;
    }
  }

  /**
   * Get analytics data for charts
   */
  static async getAnalytics(
    accountId: number,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      groupBy?: 'day' | 'week' | 'month';
    }
  ): Promise<any> {
    try {
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);

      const query = postRepo.createQueryBuilder('post')
        .where('post.accountId = :accountId', { accountId });

      if (filters?.startDate) {
        query.andWhere('post.postedAt >= :startDate', { startDate: filters.startDate });
      }
      if (filters?.endDate) {
        query.andWhere('post.postedAt <= :endDate', { endDate: filters.endDate });
      }

      const posts = await query
        .orderBy('post.postedAt', 'ASC')
        .getMany();

      // Group by time period
      const groupedData: Record<string, any> = {};

      posts.forEach((post) => {
        let groupKey: string;
        const date = new Date(post.postedAt);

        switch (filters?.groupBy) {
          case 'week':
            // Get start of week
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            groupKey = weekStart.toISOString().split('T')[0] || '';
            break;
          case 'month':
            groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            break;
          case 'day':
          default:
            groupKey = date.toISOString().split('T')[0] || '';
            break;
        }

        if (!groupedData[groupKey]) {
          groupedData[groupKey] = {
            date: groupKey,
            posts: 0,
            likes: 0,
            retweets: 0,
            replies: 0,
            views: 0,
          };
        }

        groupedData[groupKey].posts += 1;
        groupedData[groupKey].likes += post.engagementMetrics?.likes || 0;
        groupedData[groupKey].retweets += post.engagementMetrics?.retweets || 0;
        groupedData[groupKey].replies += post.engagementMetrics?.replies || 0;
        groupedData[groupKey].views += post.engagementMetrics?.views || 0;
      });

      const analyticsData = Object.values(groupedData);

      logger.debug(`📈 Retrieved analytics for DVYB account ${accountId}`);
      return analyticsData;
    } catch (error) {
      logger.error('❌ DVYB analytics error:', error);
      throw error;
    }
  }
}

