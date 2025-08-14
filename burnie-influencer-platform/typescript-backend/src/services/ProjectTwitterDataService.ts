import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { ProjectTwitterData } from '../models/ProjectTwitterData';
import { Project } from '../models/Project';
import { logger } from '../config/logger';

interface TwitterPostData {
  tweetId: string;
  conversationId?: string;
  contentType: 'single' | 'thread_start' | 'thread_reply';
  tweetText: string;
  threadPosition?: number;
  isThreadStart: boolean;
  threadTweets?: string[];
  hashtagsUsed?: string[];
  engagementMetrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  postedAt: Date;
}

export class ProjectTwitterDataService {
  private repository: Repository<ProjectTwitterData>;
  private projectRepository: Repository<Project>;

  constructor() {
    this.repository = AppDataSource.getRepository(ProjectTwitterData);
    this.projectRepository = AppDataSource.getRepository(Project);
  }

  /**
   * Check if Twitter data was already fetched for a project today
   */
  async wasDataFetchedToday(projectId: number, twitterHandle: string): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const count = await this.repository.count({
        where: {
          projectId,
          twitterHandle,
          createdAt: {
            $gte: today,
            $lt: tomorrow
          } as any
        }
      });

      return count > 0;
    } catch (error) {
      logger.error(`❌ Error checking daily fetch status for project ${projectId}:`, error);
      return true; // Return true to prevent duplicate attempts on error
    }
  }

  /**
   * Get the latest tweet ID for a project to use as since_id parameter
   */
  async getLatestTweetId(projectId: number, twitterHandle: string): Promise<string | null> {
    try {
      const latestRecord = await this.repository.findOne({
        where: {
          projectId,
          twitterHandle
        },
        order: {
          postedAt: 'DESC'
        }
      });

      return latestRecord?.tweetId || null;
    } catch (error) {
      logger.error(`❌ Error getting latest tweet ID for project ${projectId}:`, error);
      return null;
    }
  }

  /**
   * Save Twitter posts data for a project
   */
  async saveTwitterPosts(
    projectId: number,
    twitterHandle: string,
    posts: TwitterPostData[],
    fetchSessionId: string
  ): Promise<void> {
    try {
      // Mark previous data as not latest
      await this.repository.update(
        { projectId, twitterHandle },
        { isLatestBatch: false }
      );

      // Prepare new records
      const newRecords = posts.map(post => {
        const record = new ProjectTwitterData();
        record.projectId = projectId;
        record.twitterHandle = twitterHandle;
        record.tweetId = post.tweetId;
        
        // Handle optional fields properly
        if (post.conversationId !== undefined) {
          record.conversationId = post.conversationId;
        }
        
        record.contentType = post.contentType;
        record.tweetText = post.tweetText;
        
        if (post.threadPosition !== undefined) {
          record.threadPosition = post.threadPosition;
        }
        
        record.isThreadStart = post.isThreadStart;
        
        if (post.threadTweets !== undefined) {
          record.threadTweets = post.threadTweets;
        }
        
        if (post.hashtagsUsed !== undefined) {
          record.hashtagsUsed = post.hashtagsUsed;
        }
        
        if (post.engagementMetrics !== undefined) {
          record.engagementMetrics = post.engagementMetrics;
        }
        
        record.postedAt = post.postedAt;
        record.fetchSessionId = fetchSessionId;
        record.isLatestBatch = true;
        return record;
      });

      // Save in batches to avoid memory issues with UPSERT to handle duplicates
      const batchSize = 50;
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize);
        
        // Use UPSERT to handle duplicate tweet_ids gracefully
        await this.repository
          .createQueryBuilder()
          .insert()
          .into(ProjectTwitterData)
          .values(batch)
          .orIgnore() // PostgreSQL: ON CONFLICT DO NOTHING
          .execute();
      }

      logger.info(`✅ Saved ${posts.length} Twitter posts for project ${projectId} (@${twitterHandle})`);
    } catch (error) {
      logger.error(`❌ Error saving Twitter posts for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Get latest Twitter posts for a project (for AI context)
   */
  async getLatestPostsForAI(projectId: number, limit: number = 20): Promise<ProjectTwitterData[]> {
    try {
      const posts = await this.repository.find({
        where: {
          projectId,
          isLatestBatch: true
        },
        order: {
          postedAt: 'DESC'
        },
        take: limit
      });

      return posts;
    } catch (error) {
      logger.error(`❌ Error fetching latest posts for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Get Twitter data summary for a project
   */
  async getProjectTwitterSummary(projectId: number): Promise<{
    totalPosts: number;
    lastFetchDate: Date | null;
    lastPostDate: Date | null;
    twitterHandle: string | null;
  }> {
    try {
      const [totalPosts, latestRecord] = await Promise.all([
        this.repository.count({ where: { projectId } }),
        this.repository.findOne({
          where: { projectId },
          order: { createdAt: 'DESC' }
        })
      ]);

      return {
        totalPosts,
        lastFetchDate: latestRecord?.createdAt || null,
        lastPostDate: latestRecord?.postedAt || null,
        twitterHandle: latestRecord?.twitterHandle || null
      };
    } catch (error) {
      logger.error(`❌ Error getting Twitter summary for project ${projectId}:`, error);
      return {
        totalPosts: 0,
        lastFetchDate: null,
        lastPostDate: null,
        twitterHandle: null
      };
    }
  }

  /**
   * Format Twitter posts for AI content generation context
   */
  formatPostsForAI(posts: ProjectTwitterData[]): string {
    if (!posts.length) {
      return "";
    }

    const contextParts: string[] = [];
    
    // Group by content type
    const individualPosts = posts.filter(p => p.contentType === 'single');
    const threadStarters = posts.filter(p => p.contentType === 'thread_start');

    if (individualPosts.length > 0) {
      contextParts.push("=== PROJECT'S RECENT INDIVIDUAL TWEETS ===");
      individualPosts.slice(0, 10).forEach(post => {
        const date = post.postedAt.toISOString().split('T')[0];
        contextParts.push(`[${date}] ${post.tweetText}`);
      });
      contextParts.push("");
    }

    if (threadStarters.length > 0) {
      contextParts.push("=== PROJECT'S RECENT TWEET THREADS ===");
      threadStarters.slice(0, 5).forEach(post => {
        const date = post.postedAt.toISOString().split('T')[0];
        contextParts.push(`[${date}] THREAD:`);
        contextParts.push(`Main Tweet: ${post.tweetText}`);
        
        if (post.threadTweets && post.threadTweets.length > 0) {
          post.threadTweets.slice(0, 5).forEach((tweet, index) => {
            contextParts.push(`Tweet ${index + 2}: ${tweet}`);
          });
          
          if (post.threadTweets.length > 5) {
            contextParts.push(`... (thread continues with ${post.threadTweets.length - 5} more tweets)`);
          }
        }
        
        contextParts.push("");
      });
    }

    return contextParts.join("\n");
  }

  /**
   * Clean up old Twitter data (keep only last 100 posts per project)
   */
  async cleanupOldData(projectId: number): Promise<void> {
    try {
      const totalPosts = await this.repository.count({ where: { projectId } });
      
      if (totalPosts <= 100) {
        return; // No cleanup needed
      }

      // Get IDs of posts to keep (100 most recent)
      const postsToKeep = await this.repository.find({
        where: { projectId },
        order: { postedAt: 'DESC' },
        take: 100,
        select: ['id']
      });

      const idsToKeep = postsToKeep.map(p => p.id);

      // Delete old posts
      await this.repository
        .createQueryBuilder()
        .delete()
        .where('projectId = :projectId', { projectId })
        .andWhere('id NOT IN (:...idsToKeep)', { idsToKeep })
        .execute();

      logger.info(`🧹 Cleaned up old Twitter data for project ${projectId}, kept ${idsToKeep.length} recent posts`);
    } catch (error) {
      logger.error(`❌ Error cleaning up Twitter data for project ${projectId}:`, error);
    }
  }
}

export const projectTwitterDataService = new ProjectTwitterDataService(); 