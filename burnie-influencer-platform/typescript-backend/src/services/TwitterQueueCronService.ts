import * as cron from 'node-cron';
import { LeaderboardYapperService } from './LeaderboardYapperService';
import { TwitterLeaderboardService } from './TwitterLeaderboardService';
import { TwitterFetchStatus } from '../models/LeaderboardYapperData';
import { logger } from '../config/logger';

export class TwitterQueueCronService {
  private cronTask: cron.ScheduledTask | null = null;
  private yapperService: LeaderboardYapperService;
  private twitterService: TwitterLeaderboardService;
  private isProcessing: boolean = false;
  private isRateLimited: boolean = false;
  private rateLimitBackoffTimeout: NodeJS.Timeout | null = null;
  private normalSchedule: string = '* * * * *'; // Every minute
  private consecutiveSuccesses: number = 0;
  private consecutiveRateLimits: number = 0;

  constructor() {
    this.yapperService = new LeaderboardYapperService();
    this.twitterService = new TwitterLeaderboardService();
  }

  /**
   * Start the Twitter queue processing cron job
   * Runs every minute to process 1 yapper (respecting 1-minute rate limit)
   */
  start(): void {
    this.startNormalSchedule();
  }

  /**
   * Start normal cron schedule (every minute)
   */
  private startNormalSchedule(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask.destroy();
    }

    // Schedule to run every minute
    this.cronTask = cron.schedule(this.normalSchedule, async () => {
      if (this.isProcessing) {
        logger.debug('⏭️ Twitter queue processing already in progress, skipping this cycle');
        return;
      }

      if (this.isRateLimited) {
        logger.debug('⏳ Still in rate limit backoff mode, skipping this cycle');
        return;
      }

      try {
        this.isProcessing = true;
        await this.processSingleItem();
      } catch (error) {
        logger.error('❌ Error in Twitter queue cron cycle:', error);
      } finally {
        this.isProcessing = false;
      }
    });

    this.cronTask.start();
    logger.info('⏰ Twitter Queue Cron Service started:');
    logger.info('   🐦 Processing 1 yapper every minute (max 1440 per day)');
    logger.info('   📅 Cron schedule: * * * * * (every minute)');
  }

  /**
   * Handle rate limit by implementing exponential backoff
   */
  private handleRateLimit(): void {
    this.consecutiveRateLimits++;
    this.consecutiveSuccesses = 0;
    this.isRateLimited = true;

    // Clear any existing backoff timeout
    if (this.rateLimitBackoffTimeout) {
      clearTimeout(this.rateLimitBackoffTimeout);
    }

    // Calculate backoff time: start with 5 minutes, increase exponentially up to 30 minutes
    const baseBackoffMs = 5 * 60 * 1000; // 5 minutes
    const maxBackoffMs = 30 * 60 * 1000; // 30 minutes
    const exponentialBackoff = Math.min(
      baseBackoffMs * Math.pow(2, this.consecutiveRateLimits - 1),
      maxBackoffMs
    );

    logger.warn(`⏳ Rate limit detected (consecutive: ${this.consecutiveRateLimits}). Backing off for ${Math.round(exponentialBackoff / 60000)} minutes`);

    // Set timeout to resume normal operation
    this.rateLimitBackoffTimeout = setTimeout(() => {
      this.isRateLimited = false;
      logger.info('🔄 Rate limit backoff period ended. Resuming normal Twitter queue processing...');
    }, exponentialBackoff);
  }

  /**
   * Handle successful API call - reset rate limit counters
   */
  private handleSuccess(): void {
    this.consecutiveSuccesses++;
    
    // Reset rate limit counter after 3 consecutive successes
    if (this.consecutiveSuccesses >= 3 && this.consecutiveRateLimits > 0) {
      const previousRateLimits = this.consecutiveRateLimits;
      this.consecutiveRateLimits = 0;
      logger.info(`✅ Twitter API recovered after ${previousRateLimits} rate limits. Reset backoff counter.`);
    }
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask.destroy(); // Properly destroy the cron task
      this.cronTask = null;
    }

    // Clear rate limit backoff timeout
    if (this.rateLimitBackoffTimeout) {
      clearTimeout(this.rateLimitBackoffTimeout);
      this.rateLimitBackoffTimeout = null;
    }

    // Reset state
    this.isRateLimited = false;
    this.consecutiveRateLimits = 0;
    this.consecutiveSuccesses = 0;

    logger.info('⏹️ Twitter Queue Cron Service stopped');
  }



  /**
   * Process a single item from the queue
   * This ensures we respect the 1-minute rate limit perfectly
   */
  private async processSingleItem(): Promise<void> {
    try {
      logger.info('🔄 Twitter Queue Cron: Starting processing cycle...');
      
      // Get next item for cron processing (bypasses scheduling restrictions)
      const queueItems = await this.yapperService.getNextItemForCron();

      if (queueItems.length === 0) {
        logger.info('📭 No items in Twitter queue ready to process');
        // Enhanced debugging info about why no items are ready
        try {
          const stats = await this.yapperService.getQueueStats();
          logger.info(`📊 Queue status: ${stats.totalPending} pending, ${stats.totalCompleted} completed, ${stats.totalFailed} failed`);
          
          // Check for stuck items
          const stuckItems = await this.yapperService.repository.createQueryBuilder('yapper')
            .where('yapper.twitterFetchStatus = :inProgress', { inProgress: TwitterFetchStatus.IN_PROGRESS })
            .andWhere('yapper.updatedAt < :threshold', { threshold: new Date(Date.now() - 10 * 60 * 1000) }) // 10 minutes ago
            .getCount();
          
          if (stuckItems > 0) {
            logger.warn(`⚠️ Found ${stuckItems} items stuck in 'in_progress' status for >10 minutes`);
            
            // Reset stuck items to pending
            await this.yapperService.repository.createQueryBuilder()
              .update()
              .set({ 
                twitterFetchStatus: TwitterFetchStatus.PENDING,
                retryCount: () => '"retryCount" + 1'
              })
              .where('twitterFetchStatus = :inProgress', { inProgress: TwitterFetchStatus.IN_PROGRESS })
              .andWhere('updatedAt < :threshold', { threshold: new Date(Date.now() - 10 * 60 * 1000) })
              .execute();
              
            logger.info(`🔄 Reset ${stuckItems} stuck items back to pending status`);
          }
          
        } catch (debugError) {
          logger.error('❌ Error in debugging queue stats:', debugError);
        }
        return;
      }

      const item = queueItems[0];
      if (!item) {
        logger.warn('⚠️ Queue items array was empty after checking length');
        return;
      }

      logger.info(`🔄 Processing Twitter queue item: @${item.twitterHandle} (ID: ${item.id})`);

      // Mark as in progress
      item.markAsInProgress();
      await this.yapperService.repository.save(item);

      // Check if this is a duplicate that needs data copying
      if (item.isDataDuplicated && item.sourceDuplicateRecordId) {
        // Data already copied during queuing - mark as completed
        await this.yapperService.markAsCompleted(item.id, {
          success: true,
          twitter_handle: item.twitterHandle,
          copied_from_record: item.sourceDuplicateRecordId
        });
        logger.info(`📋 Marked duplicated data as completed for @${item.twitterHandle} from record ${item.sourceDuplicateRecordId}`);
        return;
      }

      // Fetch fresh Twitter data
      const twitterResult = await this.twitterService.fetchYapperTwitterData(
        item.twitterHandle,
        item.displayName || 'Unknown'
      );

      if (twitterResult.success) {
        await this.yapperService.markAsCompleted(item.id, twitterResult);
        logger.info(`✅ Completed Twitter fetch for @${item.twitterHandle}`);
        
        // Handle successful API call
        this.handleSuccess();
        
        // Log progress
        const stats = await this.yapperService.getQueueStats();
        logger.info(`📊 Queue progress: ${stats.totalCompleted} completed, ${stats.totalPending} pending`);
        
      } else {
        if (twitterResult.error === 'rate_limited') {
          await this.yapperService.markAsRateLimited(item.id);
          logger.warn(`⏳ Rate limited for @${item.twitterHandle} - will retry later`);
          
          // Handle rate limit with intelligent backoff
          this.handleRateLimit();
          
        } else {
          await this.yapperService.markAsFailed(item.id, twitterResult.error || 'Unknown error');
          logger.error(`❌ Failed to fetch Twitter data for @${item.twitterHandle}: ${twitterResult.error}`);
        }
      }

    } catch (error) {
      logger.error('❌ Error processing Twitter queue item:', error);
    }
  }

  /**
   * Get the current status of the cron service
   */
  getStatus(): { 
    isRunning: boolean; 
    isProcessing: boolean; 
    isRateLimited: boolean;
    consecutiveSuccesses: number;
    consecutiveRateLimits: number;
    hasBackoffTimeout: boolean;
    schedule: string;
    nextRun?: string;
  } {
    const nextRun = this.cronTask ? 'Next minute' : undefined;
    return {
      isRunning: this.cronTask !== null,
      isProcessing: this.isProcessing,
      isRateLimited: this.isRateLimited,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveRateLimits: this.consecutiveRateLimits,
      hasBackoffTimeout: this.rateLimitBackoffTimeout !== null,
      schedule: this.normalSchedule,
      ...(nextRun && { nextRun })
    };
  }

  /**
   * Manually trigger processing (for testing)
   */
  async triggerManualProcess(): Promise<void> {
    if (this.isProcessing) {
      throw new Error('Processing already in progress');
    }

    logger.info('🔧 Manual trigger: Processing Twitter queue item...');
    await this.processSingleItem();
  }
}

// Export singleton instance
export const twitterQueueCronService = new TwitterQueueCronService();
