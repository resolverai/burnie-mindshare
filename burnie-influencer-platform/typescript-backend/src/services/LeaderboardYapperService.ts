import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { LeaderboardYapperData, TwitterFetchStatus, PlatformSource } from '../models/LeaderboardYapperData';
import { logger } from '../config/logger';

export interface QueueYapperRequest {
  twitterHandle: string;
  displayName?: string;
  campaignId: number;
  snapshotId: number;
  platformSource: PlatformSource;
  snapshotDate: Date;
  leaderboardPosition: number;
  totalSnaps?: number;
  snapshots24h?: number;
  smartFollowers?: number;
  leaderboardData?: any;
  priority?: number;
}

export interface YapperFetchStats {
  totalPending: number;
  totalInProgress: number;
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
  totalRateLimited: number;
  estimatedCompletionTime: string;
}

export class LeaderboardYapperService {
  public repository: Repository<LeaderboardYapperData>; // Made public for queue processing

  constructor() {
    this.repository = AppDataSource.getRepository(LeaderboardYapperData);
  }

  /**
   * Add multiple yappers to the processing queue
   */
  async queueYappers(requests: QueueYapperRequest[]): Promise<number> {
    try {
      const queueItems: LeaderboardYapperData[] = [];
      let skippedCount = 0;

      for (const request of requests) {
        // Check if this exact combination already exists
        const existing = await this.repository.findOne({
          where: {
            twitterHandle: request.twitterHandle,
            campaignId: request.campaignId,
            platformSource: request.platformSource,
            snapshotDate: request.snapshotDate
          }
        });

        if (existing) {
          logger.info(`🔄 Yapper already exists for @${request.twitterHandle} - ${request.platformSource} - ${request.campaignId}`);
          skippedCount++;
          continue;
        }

        // Check if we already have recent Twitter data for this yapper today
        const existingTwitterData = await this.checkExistingTwitterData(
          request.twitterHandle, 
          request.snapshotDate, 
          request.platformSource
        );

        const yapperData = new LeaderboardYapperData();
        yapperData.twitterHandle = request.twitterHandle;
        if (request.displayName) {
          yapperData.displayName = request.displayName;
        }
        yapperData.campaignId = request.campaignId;
        yapperData.snapshotId = request.snapshotId;
        yapperData.platformSource = request.platformSource;
        yapperData.snapshotDate = request.snapshotDate;
        yapperData.leaderboardPosition = request.leaderboardPosition;
        if (request.totalSnaps !== undefined) {
          yapperData.totalSnaps = request.totalSnaps;
        }
        if (request.snapshots24h !== undefined) {
          yapperData.snaps24h = request.snapshots24h;
        }
        if (request.smartFollowers !== undefined) {
          yapperData.smartFollowers = request.smartFollowers;
        }
        yapperData.leaderboardData = request.leaderboardData;
        yapperData.priority = request.priority || 5;

        if (existingTwitterData) {
          // Mark as skipped and reference the existing data
          yapperData.markAsSkipped(
            `Twitter data already fetched for @${request.twitterHandle} on ${request.snapshotDate.toISOString().split('T')[0]} from campaign ${existingTwitterData.campaignId}/${existingTwitterData.platformSource}`, 
            existingTwitterData.id
          );
          
          // Copy Twitter data from existing record
          yapperData.twitterProfile = existingTwitterData.twitterProfile;
          yapperData.recentTweets = existingTwitterData.recentTweets;
          if (existingTwitterData.tweetImageUrls) {
            yapperData.tweetImageUrls = existingTwitterData.tweetImageUrls;
          }
          if (existingTwitterData.followersCount !== undefined) {
            yapperData.followersCount = existingTwitterData.followersCount;
          }
          if (existingTwitterData.followingCount !== undefined) {
            yapperData.followingCount = existingTwitterData.followingCount;
          }
          if (existingTwitterData.tweetsCount !== undefined) {
            yapperData.tweetsCount = existingTwitterData.tweetsCount;
          }
          if (existingTwitterData.lastTwitterFetch) {
            yapperData.lastTwitterFetch = existingTwitterData.lastTwitterFetch;
          }
          yapperData.twitterFetchStatus = TwitterFetchStatus.COMPLETED;
          
          logger.info(`📋 Copying Twitter data for @${request.twitterHandle} from record ${existingTwitterData.id}`);
        } else {
          // Set as pending for Twitter fetch
          yapperData.twitterFetchStatus = TwitterFetchStatus.PENDING;
        }

        queueItems.push(yapperData);
      }

      if (queueItems.length > 0) {
        await this.repository.save(queueItems);
        logger.info(`📥 Queued ${queueItems.length} yappers (${skippedCount} skipped as duplicates)`);
      }

      return queueItems.length;

    } catch (error) {
      logger.error('❌ Error queuing yappers:', error);
      throw error;
    }
  }

  /**
   * Check if we already have Twitter data for this yapper on this date
   * (regardless of campaign or platform - Twitter data is yapper-specific, not campaign-specific)
   */
  private async checkExistingTwitterData(
    twitterHandle: string, 
    snapshotDate: Date, 
    platformSource: PlatformSource
  ): Promise<LeaderboardYapperData | null> {
    try {
      const existing = await this.repository.findOne({
        where: {
          twitterHandle,
          snapshotDate,
          // Remove platformSource and campaignId filters - Twitter data is universal for the yapper
          twitterFetchStatus: TwitterFetchStatus.COMPLETED
        },
        order: { createdAt: 'DESC' }
      });

      if (existing) {
        logger.info(`🔄 Found existing Twitter data for @${twitterHandle} on ${snapshotDate.toISOString().split('T')[0]} from ${existing.platformSource} campaign ${existing.campaignId}`);
      }

      return existing;
    } catch (error) {
      logger.error('❌ Error checking existing Twitter data:', error);
      return null;
    }
  }

  /**
   * Get next batch of items to process with rate limiting
   */
  async getNextBatch(batchSize: number = 10): Promise<LeaderboardYapperData[]> {
    try {
      // Use query builder to exclude permanently failed items
      const queryBuilder = this.repository.createQueryBuilder('yapper')
        .where('yapper.twitterFetchStatus = :pending', { pending: TwitterFetchStatus.PENDING })
        .orWhere('(yapper.twitterFetchStatus = :failed AND yapper.retryCount < yapper.maxRetries)', { failed: TwitterFetchStatus.FAILED })
        .orWhere('(yapper.twitterFetchStatus = :rateLimited AND yapper.retryCount < yapper.maxRetries)', { rateLimited: TwitterFetchStatus.RATE_LIMITED })
        .orderBy('yapper.priority', 'DESC')
        .addOrderBy('yapper.createdAt', 'ASC')
        .take(batchSize);

      const items = await queryBuilder.getMany();

      // Filter items that are ready to process (considering scheduled time)
      const now = new Date();
      const readyItems = items.filter(item => 
        item.canProcess() || 
        (item.needsRetry() && (!item.scheduledAt || item.scheduledAt <= now))
      );

      logger.debug(`📋 getNextBatch: Found ${items.length} items, ${readyItems.length} ready to process`);

      return readyItems;

    } catch (error) {
      logger.error('❌ Error getting next batch:', error);
      return [];
    }
  }

  /**
   * Get next item for cron processing (bypasses scheduling restrictions)
   * Used by automated cron service which already enforces 1-minute rate limiting
   */
  async getNextItemForCron(): Promise<LeaderboardYapperData[]> {
    try {
      // Use query builder to exclude permanently failed items
      const queryBuilder = this.repository.createQueryBuilder('yapper')
        .where('yapper.twitterFetchStatus = :pending', { pending: TwitterFetchStatus.PENDING })
        .orWhere('(yapper.twitterFetchStatus = :failed AND yapper.retryCount < yapper.maxRetries)', { failed: TwitterFetchStatus.FAILED })
        .orWhere('(yapper.twitterFetchStatus = :rateLimited AND yapper.retryCount < yapper.maxRetries)', { rateLimited: TwitterFetchStatus.RATE_LIMITED })
        .orderBy('yapper.priority', 'DESC')
        .addOrderBy('yapper.createdAt', 'ASC')
        .take(1);

      const items = await queryBuilder.getMany();
      
      logger.info(`🔍 Database query returned ${items.length} items for cron processing`);
      if (items.length > 0) {
        items.forEach((item, index) => {
          logger.info(`  ${index + 1}. @${item.twitterHandle} - Status: ${item.twitterFetchStatus}, Retries: ${item.retryCount}/${item.maxRetries}`);
        });
      }

      // For cron processing, ALL items returned by the database query should be processed
      // since the SQL query already filters for the correct conditions
      const readyItems = items;
      
      logger.info(`📋 All ${items.length} items from database are ready for cron processing`);

      logger.debug(`📋 getNextItemForCron: Found ${items.length} items, ${readyItems.length} ready for cron processing`);

      return readyItems;

    } catch (error) {
      logger.error('❌ Error getting next item for cron:', error);
      return [];
    }
  }

  /**
   * Mark item as completed and update Twitter data
   */
  async markAsCompleted(yapperDataId: number, twitterData: any): Promise<void> {
    try {
      const yapperData = await this.repository.findOne({ where: { id: yapperDataId } });
      if (!yapperData) {
        throw new Error(`Yapper data ${yapperDataId} not found`);
      }

      // Update Twitter data
      yapperData.twitterProfile = twitterData.profile;
      yapperData.recentTweets = twitterData.recent_tweets;
      yapperData.tweetImageUrls = twitterData.tweet_image_urls;
      
      // Store comprehensive LLM analysis
      const llmAnalysis = twitterData.llm_analysis;
      if (llmAnalysis && llmAnalysis.success) {
        if (llmAnalysis.provider_used === 'anthropic') {
          yapperData.anthropic_analysis = llmAnalysis.anthropic_analysis;
          yapperData.openai_analysis = null;
        } else if (llmAnalysis.provider_used === 'openai') {
          yapperData.anthropic_analysis = null;
          yapperData.openai_analysis = llmAnalysis.openai_analysis;
        }
        logger.info(`✅ Stored ${llmAnalysis.provider_used} analysis for @${yapperData.twitterHandle}`);
      } else {
        logger.warn(`⚠️ No LLM analysis available for @${yapperData.twitterHandle}`);
      }
      
      yapperData.followersCount = twitterData.profile?.followers_count;
      yapperData.followingCount = twitterData.profile?.following_count;
      yapperData.tweetsCount = twitterData.profile?.tweets_count;
      yapperData.lastTwitterFetch = new Date();
      yapperData.markAsCompleted();

      await this.repository.save(yapperData);

      logger.info(`✅ Completed Twitter fetch for @${yapperData.twitterHandle} (ID: ${yapperDataId})`);

    } catch (error) {
      logger.error(`❌ Error marking yapper ${yapperDataId} as completed:`, error);
      throw error;
    }
  }

  /**
   * Mark item as failed
   */
  async markAsFailed(yapperDataId: number, error: string): Promise<void> {
    try {
      const yapperData = await this.repository.findOne({ where: { id: yapperDataId } });
      if (!yapperData) {
        throw new Error(`Yapper data ${yapperDataId} not found`);
      }

      yapperData.markAsFailed(error);
      await this.repository.save(yapperData);

      logger.warn(`⚠️ Failed Twitter fetch for @${yapperData.twitterHandle}: ${error}`);

    } catch (dbError) {
      logger.error(`❌ Error marking yapper ${yapperDataId} as failed:`, dbError);
      throw dbError;
    }
  }

  /**
   * Mark item as rate limited
   */
  async markAsRateLimited(yapperDataId: number): Promise<void> {
    try {
      const yapperData = await this.repository.findOne({ where: { id: yapperDataId } });
      if (!yapperData) {
        throw new Error(`Yapper data ${yapperDataId} not found`);
      }

      yapperData.markAsRateLimited();
      await this.repository.save(yapperData);

      logger.warn(`⏳ Rate limited Twitter fetch for @${yapperData.twitterHandle}, scheduled retry: ${yapperData.scheduledAt}`);

    } catch (error) {
      logger.error(`❌ Error marking yapper ${yapperDataId} as rate limited:`, error);
      throw error;
    }
  }

  /**
   * Get queue statistics with accurate processing eligibility
   */
  async getQueueStats(): Promise<YapperFetchStats> {
    try {
      // Get accurate counts using query builder to match getNextBatch logic
      const [
        pending,
        inProgress, 
        completed,
        skipped,
        failedRetryable,
        failedPermanent,
        rateLimitedRetryable,
        rateLimitedPermanent
      ] = await Promise.all([
        this.repository.count({ where: { twitterFetchStatus: TwitterFetchStatus.PENDING } }),
        this.repository.count({ where: { twitterFetchStatus: TwitterFetchStatus.IN_PROGRESS } }),
        this.repository.count({ where: { twitterFetchStatus: TwitterFetchStatus.COMPLETED } }),
        this.repository.count({ where: { twitterFetchStatus: TwitterFetchStatus.SKIPPED } }),
        this.repository.createQueryBuilder('yapper')
          .where('yapper.twitterFetchStatus = :failed', { failed: TwitterFetchStatus.FAILED })
          .andWhere('yapper.retryCount < yapper.maxRetries')
          .getCount(),
        this.repository.createQueryBuilder('yapper')
          .where('yapper.twitterFetchStatus = :failed', { failed: TwitterFetchStatus.FAILED })
          .andWhere('yapper.retryCount >= yapper.maxRetries')
          .getCount(),
        this.repository.createQueryBuilder('yapper')
          .where('yapper.twitterFetchStatus = :rateLimited', { rateLimited: TwitterFetchStatus.RATE_LIMITED })
          .andWhere('yapper.retryCount < yapper.maxRetries')
          .getCount(),
        this.repository.createQueryBuilder('yapper')
          .where('yapper.twitterFetchStatus = :rateLimited', { rateLimited: TwitterFetchStatus.RATE_LIMITED })
          .andWhere('yapper.retryCount >= yapper.maxRetries')
          .getCount()
      ]);

      // Calculate actual pending items that will be processed
      const actualPendingItems = pending + failedRetryable + rateLimitedRetryable;
      const totalFailed = failedRetryable + failedPermanent;
      const totalRateLimited = rateLimitedRetryable + rateLimitedPermanent;

      // Estimate completion time (1 minute per processable item)
      const estimatedMinutes = actualPendingItems * 1; // 1 minute cooling period
      const estimatedCompletionTime = new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();

      return {
        totalPending: actualPendingItems, // Only items that will actually be processed
        totalInProgress: inProgress,
        totalCompleted: completed,
        totalFailed: totalFailed, // All failed items (retryable + permanent)
        totalSkipped: skipped,
        totalRateLimited: totalRateLimited, // All rate limited items
        estimatedCompletionTime
      };

    } catch (error) {
      logger.error('❌ Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed/failed items (older than 7 days)
   */
  async cleanupOldItems(): Promise<number> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const result = await this.repository
        .createQueryBuilder()
        .delete()
        .where('twitterFetchStatus IN (:...statuses)', { 
          statuses: [TwitterFetchStatus.COMPLETED, TwitterFetchStatus.SKIPPED] 
        })
        .andWhere('updatedAt < :date', { date: sevenDaysAgo })
        .execute();

      logger.info(`🧹 Cleaned up ${result.affected} old yapper records`);
      return result.affected || 0;

    } catch (error) {
      logger.error('❌ Error cleaning up yapper records:', error);
      throw error;
    }
  }

  /**
   * Get all yapper data for a campaign (with Twitter data)
   */
  async getYappersForCampaign(
    campaignId: number, 
    platformSource?: PlatformSource,
    includeTwitterData: boolean = true
  ): Promise<LeaderboardYapperData[]> {
    try {
      const whereConditions: any = { campaignId };
      
      if (platformSource) {
        whereConditions.platformSource = platformSource;
      }

      if (includeTwitterData) {
        whereConditions.twitterFetchStatus = TwitterFetchStatus.COMPLETED;
      }

      const yappers = await this.repository.find({
        where: whereConditions,
        order: { leaderboardPosition: 'ASC' },
        relations: ['campaign', 'snapshot']
      });

      return yappers;

    } catch (error) {
      logger.error(`❌ Error getting yappers for campaign ${campaignId}:`, error);
      throw error;
    }
  }

  /**
   * Get all data for ML training (across all campaigns/platforms)
   */
  async getMLTrainingData(
    startDate?: Date,
    endDate?: Date,
    platformSource?: PlatformSource
  ): Promise<LeaderboardYapperData[]> {
    try {
      const queryBuilder = this.repository.createQueryBuilder('yapper')
        .leftJoinAndSelect('yapper.campaign', 'campaign')
        .leftJoinAndSelect('yapper.snapshot', 'snapshot')
        .where('yapper.twitterFetchStatus = :status', { status: TwitterFetchStatus.COMPLETED });

      if (startDate) {
        queryBuilder.andWhere('yapper.snapshotDate >= :startDate', { startDate });
      }

      if (endDate) {
        queryBuilder.andWhere('yapper.snapshotDate <= :endDate', { endDate });
      }

      if (platformSource) {
        queryBuilder.andWhere('yapper.platformSource = :platformSource', { platformSource });
      }

      const data = await queryBuilder
        .orderBy('yapper.snapshotDate', 'DESC')
        .addOrderBy('yapper.leaderboardPosition', 'ASC')
        .getMany();

      logger.info(`📊 Retrieved ${data.length} yapper records for ML training`);
      return data;

    } catch (error) {
      logger.error('❌ Error getting ML training data:', error);
      throw error;
    }
  }
}
