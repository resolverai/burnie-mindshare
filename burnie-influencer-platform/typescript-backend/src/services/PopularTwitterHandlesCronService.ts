import * as cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { PopularTwitterHandles } from '../models/PopularTwitterHandles';
import { logger } from '../config/logger';

export class PopularTwitterHandlesCronService {
  private cronTask: cron.ScheduledTask | null = null;
  private isProcessing: boolean = false;
  private pythonBackendUrl: string;

  constructor() {
    this.pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    if (!this.pythonBackendUrl) {
      throw new Error('PYTHON_AI_BACKEND_URL environment variable is required');
    }
  }

  /**
   * Start the popular Twitter handles cron job
   * Runs every 5 minutes to process pending handles
   */
  start(): void {
    // Schedule to run every 5 minutes
    // Cron expression: */5 * * * * (Every 5 minutes)
    this.cronTask = cron.schedule('*/5 * * * *', async () => {
      if (this.isProcessing) {
        logger.debug('⏭️ Popular Twitter handles processing already in progress, skipping this cycle');
        return;
      }

      try {
        this.isProcessing = true;
        await this.processPendingHandles();
      } catch (error) {
        logger.error('❌ Error in popular Twitter handles cron cycle:', error);
      } finally {
        this.isProcessing = false;
      }
    });

    this.cronTask.start();
    logger.info('⏰ Popular Twitter Handles Cron Service started:');
    logger.info('   🐦 Processing pending Twitter handles every 5 minutes');
    logger.info('   📅 Cron schedule: */5 * * * * (Every 5 minutes)');
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('⏹️ Popular Twitter Handles Cron Service stopped');
    }
  }

  /**
   * Process all pending Twitter handles
   */
  private async processPendingHandles(): Promise<void> {
    try {
      const repository = AppDataSource.getRepository(PopularTwitterHandles);
      
      // Get pending handles (newly added or failed with retries available)
      const pendingHandles = await repository.find({
        where: [
          { status: 'pending' },
          { status: 'error' } // Retry failed handles
        ],
        order: {
          priority: 'DESC',
          createdAt: 'ASC'
        },
        take: 10 // Process up to 10 handles per cycle
      });

      if (pendingHandles.length === 0) {
        logger.debug('📭 No pending Twitter handles to process');
        return;
      }

      logger.info(`🔄 Processing ${pendingHandles.length} pending Twitter handles`);

      // Process handles in batches to respect rate limits
      for (const handle of pendingHandles) {
        try {
          // Mark as processing
          handle.status = 'processing';
          await repository.save(handle);

          // Fetch Twitter data
          await this.fetchTwitterDataForHandle(handle);

          // Add delay between requests to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

        } catch (error) {
          logger.error(`❌ Error processing handle @${handle.twitter_handle}:`, error);
          
          // Mark as error
          handle.status = 'error';
          handle.error_message = error instanceof Error ? error.message : 'Unknown error';
          handle.fetch_count = (handle.fetch_count || 0) + 1;
          await repository.save(handle);
        }
      }

      logger.info(`✅ Completed processing ${pendingHandles.length} Twitter handles`);

    } catch (error) {
      logger.error('❌ Error in processPendingHandles:', error);
    }
  }

  /**
   * Fetch Twitter data for a specific handle
   */
  private async fetchTwitterDataForHandle(handle: PopularTwitterHandles): Promise<void> {
    try {
      logger.info(`🐦 Fetching Twitter data for @${handle.twitter_handle} (ID: ${handle.id})`);

      // Call Python backend to fetch Twitter data
      const response = await fetch(`${this.pythonBackendUrl}/api/twitter-handles/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle_ids: [handle.id],
          twitter_handles: [handle.twitter_handle],
          last_tweet_ids: [handle.last_tweet_id || null]
        })
      });

      if (!response.ok) {
        throw new Error(`Python backend error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.results && result.results.length > 0) {
        const handleResult = result.results[0];
        
        // Update handle with fetched data
        handle.followers_count = handleResult.followers_count || 0;
        handle.following_count = handleResult.following_count || 0;
        handle.tweet_count = handleResult.tweet_count || 0;
        handle.verified = handleResult.verified || false;
        handle.profile_image_url = handleResult.profile_image_url;
        handle.last_tweet_id = handleResult.latest_tweet_id;
        handle.last_fetch_at = new Date();
        handle.fetch_count = (handle.fetch_count || 0) + 1;
        handle.status = 'active';
        handle.error_message = null;

        await AppDataSource.getRepository(PopularTwitterHandles).save(handle);

        logger.info(`✅ Successfully updated @${handle.twitter_handle}: ${handleResult.tweets_count} tweets, ${handleResult.images_count} images`);

      } else if (result.errors && result.errors.length > 0) {
        const errorResult = result.errors[0];
        throw new Error(errorResult.error || 'Unknown error from Python backend');
      } else {
        throw new Error('No data returned from Python backend');
      }

    } catch (error) {
      logger.error(`❌ Error fetching Twitter data for @${handle.twitter_handle}:`, error);
      throw error;
    }
  }

  /**
   * Get processing status
   */
  getStatus(): { isProcessing: boolean; isRunning: boolean } {
    return {
      isProcessing: this.isProcessing,
      isRunning: this.cronTask !== null
    };
  }

  /**
   * Manually trigger processing of pending handles
   */
  async triggerProcessing(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('⚠️ Processing already in progress, skipping manual trigger');
      return;
    }

    try {
      this.isProcessing = true;
      await this.processPendingHandles();
    } catch (error) {
      logger.error('❌ Error in manual trigger:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
