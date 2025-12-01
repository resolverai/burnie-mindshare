import * as cron from 'node-cron';
import { ScheduledPostSchedulerService } from './ScheduledPostQueueService';
import { DvybScheduledPostSchedulerService } from './DvybScheduledPostQueueService';
import { logger } from '../config/logger';

export class ScheduledPostCronService {
  private cronTask: cron.ScheduledTask | null = null;
  private readonly schedule = '* * * * *'; // Every minute

  /**
   * Start the cron service to check for upcoming scheduled posts (Web3 and DVYB)
   */
  start(): void {
    if (this.cronTask) {
      logger.warn('⚠️ Scheduled post cron service already running');
      return;
    }

    logger.info('📅 Starting Scheduled Post Cron Service (Web3 + DVYB)...');
    logger.info(`⏰ Schedule: ${this.schedule} (every minute)`);

    this.cronTask = cron.schedule(this.schedule, async () => {
      try {
        // Check Web3 scheduled posts
        await ScheduledPostSchedulerService.checkAndQueueUpcomingPosts();
        
        // Check DVYB scheduled posts
        await DvybScheduledPostSchedulerService.checkAndQueueUpcomingPosts();
      } catch (error: any) {
        logger.error(`❌ Error in scheduled post cron cycle: ${error.message}`);
      }
    });

    // Run immediately on start to catch any missed posts
    Promise.all([
      ScheduledPostSchedulerService.checkAndQueueUpcomingPosts(),
      DvybScheduledPostSchedulerService.checkAndQueueUpcomingPosts(),
    ]).catch(error => {
      logger.error(`❌ Error in initial scheduled post check: ${error.message}`);
    });

    logger.info('✅ Scheduled Post Cron Service started (Web3 + DVYB)');
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

