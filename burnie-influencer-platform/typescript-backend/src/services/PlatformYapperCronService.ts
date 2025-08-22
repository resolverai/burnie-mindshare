import * as cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { PlatformYapperTwitterData } from '../models/PlatformYapperTwitterData';
import { PlatformYapperTwitterProfile } from '../models/PlatformYapperTwitterProfile';
import { logger } from '../config/logger';

export class PlatformYapperCronService {
  private cronTask: cron.ScheduledTask | null = null;
  private isProcessing: boolean = false;

  constructor() {
    // Empty constructor
  }

  /**
   * Start the platform yapper Twitter data collection cron job
   * Runs every 2 days to collect Twitter data for all platform yappers
   */
  start(): void {
    // Schedule to run every 2 days at 2 AM
    // Cron expression: 0 2 */2 * * (At 2:00 AM every 2 days)
    this.cronTask = cron.schedule('0 2 */2 * *', async () => {
      if (this.isProcessing) {
        logger.debug('⏭️ Platform yapper processing already in progress, skipping this cycle');
        return;
      }

      try {
        this.isProcessing = true;
        await this.processAllPlatformYappers();
      } catch (error) {
        logger.error('❌ Error in platform yapper cron cycle:', error);
      } finally {
        this.isProcessing = false;
      }
    });

    this.cronTask.start();
    logger.info('⏰ Platform Yapper Cron Service started:');
    logger.info('   🐦 Collecting Twitter data for all platform yappers every 2 days');
    logger.info('   📅 Cron schedule: 0 2 */2 * * (At 2:00 AM every 2 days)');
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('⏹️ Platform Yapper Cron Service stopped');
    }
  }

  /**
   * Process all platform yappers' Twitter data
   */
  private async processAllPlatformYappers(): Promise<void> {
    try {
      logger.info('🎯 Starting platform yapper Twitter data collection...');

      // Get all active yapper Twitter connections
      const yapperConnections = await AppDataSource.getRepository(YapperTwitterConnection).find({
        where: { isConnected: true },
        order: { updatedAt: 'ASC' } // Process oldest first
      });

      if (yapperConnections.length === 0) {
        logger.info('📭 No active platform yapper connections found');
        return;
      }

      logger.info(`🔍 Found ${yapperConnections.length} active platform yappers to process`);

      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      // Process each yapper with delays to respect rate limits
      for (const connection of yapperConnections) {
        try {
          logger.info(`🔄 Processing platform yapper ${processed + 1}/${yapperConnections.length}: @${connection.twitterUsername}`);

          const result = await this.processPlatformYapper(connection);

          if (result.success) {
            succeeded++;
            logger.info(`✅ Successfully processed @${connection.twitterUsername} - ${result.tweets_collected} tweets, ${result.images_found} images`);
          } else {
            failed++;
            logger.warn(`⚠️ Failed to process @${connection.twitterUsername}: ${result.error}`);
          }

          processed++;

          // Add delay between yappers to respect rate limits (5 seconds)
          if (processed < yapperConnections.length) {
            await this.delay(5000);
          }

        } catch (error) {
          failed++;
          logger.error(`❌ Error processing platform yapper @${connection.twitterUsername}:`, error);
        }
      }

      logger.info(`🎉 Platform yapper processing completed: ${succeeded} succeeded, ${failed} failed out of ${processed} total`);

    } catch (error) {
      logger.error('❌ Error in platform yapper processing:', error);
      throw error;
    }
  }

  /**
   * Process individual platform yapper's Twitter data
   */
  private async processPlatformYapper(connection: YapperTwitterConnection): Promise<{
    success: boolean;
    tweets_collected?: number;
    images_found?: number;
    error?: string;
  }> {
    try {
      // Check if we've fetched data recently (within 1.5 days to avoid duplicates)
      const lastFetch = connection.lastSyncAt;
      if (lastFetch) {
        const hoursSinceLastFetch = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastFetch < 36) { // 1.5 days
          logger.info(`⏭️ Skipping @${connection.twitterUsername} - data fetched ${Math.round(hoursSinceLastFetch)} hours ago`);
          return { success: true, tweets_collected: 0, images_found: 0 };
        }
      }

      // Call Python backend to collect Twitter data using Bearer token
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch(`${process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000'}/api/ml-models/collect-platform-yapper-profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yapper_id: connection.userId,
            twitter_handle: connection.twitterUsername
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Python backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as any;

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Unknown error from Python backend'
          };
        }

        // Update the connection's last sync time
        connection.lastSyncAt = new Date();
        await AppDataSource.getRepository(YapperTwitterConnection).save(connection);

        return {
          success: true,
          tweets_collected: result.tweets_stored || 0,
          images_found: result.profile_data?.total_tweets_analyzed || 0
        };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }

    } catch (error) {
      logger.error(`❌ Error processing platform yapper @${connection.twitterUsername}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Manual trigger for testing purposes
   */
  async triggerManualProcess(): Promise<void> {
    if (this.isProcessing) {
      throw new Error('Processing already in progress');
    }

    logger.info('🔧 Manual trigger: Processing all platform yappers...');
    await this.processAllPlatformYappers();
  }

  /**
   * Get the current status of the cron service
   */
  getStatus(): { isRunning: boolean; isProcessing: boolean; nextRun?: string } {
    const nextRun = this.cronTask ? 'Every 2 days at 2:00 AM' : undefined;
    return {
      isRunning: this.cronTask !== null,
      isProcessing: this.isProcessing,
      ...(nextRun && { nextRun })
    };
  }

  /**
   * Get statistics about platform yappers
   */
  async getStats(): Promise<{
    total_connections: number;
    active_connections: number;
    last_processed: string | null;
    processing_status: string;
  }> {
    try {
      const total = await AppDataSource.getRepository(YapperTwitterConnection).count();
      const active = await AppDataSource.getRepository(YapperTwitterConnection).count({
        where: { isConnected: true }
      });

      const lastProcessed = await AppDataSource.getRepository(YapperTwitterConnection)
        .createQueryBuilder('conn')
        .where('conn.isConnected = :isConnected', { isConnected: true })
        .andWhere('conn.lastSyncAt IS NOT NULL')
        .orderBy('conn.lastSyncAt', 'DESC')
        .limit(1)
        .getOne();

      return {
        total_connections: total,
        active_connections: active,
        last_processed: lastProcessed?.lastSyncAt?.toISOString() || null,
        processing_status: this.isProcessing ? 'in_progress' : 'idle'
      };

    } catch (error) {
      logger.error('❌ Error getting platform yapper stats:', error);
      return {
        total_connections: 0,
        active_connections: 0,
        last_processed: null,
        processing_status: 'error'
      };
    }
  }

  /**
   * Helper method to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const platformYapperCronService = new PlatformYapperCronService();
