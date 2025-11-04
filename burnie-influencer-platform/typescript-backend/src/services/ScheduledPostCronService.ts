import * as cron from 'node-cron';
import { ScheduledPostSchedulerService } from './ScheduledPostQueueService';
import { logger } from '../config/logger';

export class ScheduledPostCronService {
  private cronTask: cron.ScheduledTask | null = null;
  private readonly schedule = '* * * * *'; // Every minute

  /**
   * Start the cron service to check for upcoming scheduled posts
   */
  start(): void {
    if (this.cronTask) {
      logger.warn('⚠️ Scheduled post cron service already running');
      return;
    }

    logger.info('📅 Starting Scheduled Post Cron Service...');
    logger.info(`⏰ Schedule: ${this.schedule} (every minute)`);

    this.cronTask = cron.schedule(this.schedule, async () => {
      try {
        await ScheduledPostSchedulerService.checkAndQueueUpcomingPosts();
      } catch (error: any) {
        logger.error(`❌ Error in scheduled post cron cycle: ${error.message}`);
      }
    });

    // Run immediately on start to catch any missed posts
    ScheduledPostSchedulerService.checkAndQueueUpcomingPosts().catch(error => {
      logger.error(`❌ Error in initial scheduled post check: ${error.message}`);
    });

    logger.info('✅ Scheduled Post Cron Service started');
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('⏹️ Scheduled Post Cron Service stopped');
    }
  }

  /**
   * Get the current status of the cron service
   */
  getStatus(): { running: boolean; schedule: string } {
    return {
      running: this.cronTask !== null,
      schedule: this.schedule
    };
  }
}

export const scheduledPostCronService = new ScheduledPostCronService();

