import * as cron from 'node-cron';
import { fileCleanupService } from './FileCleanupService';
import { logger } from '../config/logger';

export class ScheduledCleanupService {
  private cleanupTask: cron.ScheduledTask | null = null;
  private dailyCleanupTask: cron.ScheduledTask | null = null;

  /**
   * Start scheduled cleanup tasks
   */
  start(): void {
    // Schedule cleanup every 2 hours for processed snapshots
    this.cleanupTask = cron.schedule('0 */2 * * *', async () => {
      try {
        logger.info('⏰ Running scheduled cleanup for processed snapshots...');
        const result = await fileCleanupService.cleanupProcessedSnapshots();
        
        if (result.uploaded > 0 || result.deleted > 0) {
          logger.info(`✅ Scheduled cleanup completed: ${result.uploaded} uploaded, ${result.deleted} deleted`);
        } else {
          logger.debug('📝 No files to cleanup in scheduled run');
        }
      } catch (error) {
        logger.error('❌ Scheduled cleanup failed:', error);
      }
    });

    // Schedule daily cleanup for old files (runs at 2 AM)
    this.dailyCleanupTask = cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('🌙 Running daily cleanup for old files...');
        const result = await fileCleanupService.cleanupOldLocalFiles(7); // 7 days old
        
        if (result.deleted > 0) {
          const mbFreed = Math.round(result.bytesFreed / 1024 / 1024 * 100) / 100;
          logger.info(`✅ Daily cleanup completed: ${result.deleted} files deleted, ${mbFreed} MB freed`);
        } else {
          logger.debug('📝 No old files to cleanup in daily run');
        }
      } catch (error) {
        logger.error('❌ Daily cleanup failed:', error);
      }
    });

    // Start the tasks
    this.cleanupTask.start();
    this.dailyCleanupTask.start();

    logger.info('⏰ Scheduled cleanup service started:');
    logger.info('   📤 Processed snapshots cleanup: Every 2 hours');
    logger.info('   🗑️ Old files cleanup: Daily at 2 AM');
  }

  /**
   * Stop scheduled cleanup tasks
   */
  stop(): void {
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }
    
    if (this.dailyCleanupTask) {
      this.dailyCleanupTask.stop();
      this.dailyCleanupTask = null;
    }
    
    logger.info('⏹️ Scheduled cleanup service stopped');
  }

  /**
   * Get status of scheduled tasks
   */
  getStatus(): {
    cleanupTaskRunning: boolean;
    dailyCleanupTaskRunning: boolean;
    nextCleanupRun: string;
    nextDailyCleanupRun: string;
  } {
    return {
      cleanupTaskRunning: this.cleanupTask ? true : false,
      dailyCleanupTaskRunning: this.dailyCleanupTask ? true : false,
      nextCleanupRun: this.cleanupTask ? 'Every 2 hours' : 'Not scheduled',
      nextDailyCleanupRun: this.dailyCleanupTask ? 'Daily at 2:00 AM' : 'Not scheduled'
    };
  }

  /**
   * Run immediate cleanup (for testing/manual trigger)
   */
  async runImmediateCleanup(): Promise<any> {
    try {
      logger.info('🚀 Running immediate full cleanup...');
      const result = await fileCleanupService.runFullCleanup();
      logger.info('✅ Immediate cleanup completed successfully');
      return result;
    } catch (error) {
      logger.error('❌ Immediate cleanup failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const scheduledCleanupService = new ScheduledCleanupService();
