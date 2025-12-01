import { Queue, Worker, Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { DvybSchedule } from '../models/DvybSchedule';
import { DvybPostingService } from './DvybPostingService';
import { logger } from '../config/logger';
import { env } from '../config/env';

// Redis connection config
const redisConfig: {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} = {
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
};

if (env.redis.password && env.redis.password.trim() !== '') {
  redisConfig.password = env.redis.password;
}

logger.info(`🔧 DVYB Scheduled Posts - Redis configuration:`);
logger.info(`   - Host: ${redisConfig.host}`);
logger.info(`   - Port: ${redisConfig.port}`);
logger.info(`   - Password: ${redisConfig.password ? '***set***' : 'not set'}`);

// Queue name for DVYB scheduled posts
const QUEUE_NAME = 'dvyb-scheduled-posts';

// Create BullMQ queue
export const dvybScheduledPostQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100,
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours
      count: 100,
    },
  },
});

/**
 * Process a DVYB scheduled post job
 */
export async function processDvybScheduledPost(job: Job): Promise<void> {
  const { scheduleId } = job.data;
  
  logger.info(`🔄 Processing DVYB scheduled post job ${job.id} for schedule ${scheduleId}`);
  
  const scheduleRepo = AppDataSource.getRepository(DvybSchedule);
  
  try {
    // Load schedule from database
    const schedule = await scheduleRepo.findOne({ where: { id: scheduleId } });
    
    if (!schedule) {
      logger.error(`❌ Schedule ${scheduleId} not found in database`);
      throw new Error(`Schedule ${scheduleId} not found`);
    }
    
    // Check if already processed
    if (schedule.status !== 'pending') {
      logger.warn(`⚠️ Schedule ${scheduleId} already processed with status: ${schedule.status}`);
      return;
    }
    
    // Extract posting data from postMetadata
    const { platforms, content } = schedule.postMetadata;
    
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      throw new Error('No platforms specified in schedule metadata');
    }
    
    if (!content || !content.caption || !content.mediaUrl || !content.mediaType) {
      throw new Error('Invalid content data in schedule metadata');
    }
    
    logger.info(`📤 Posting to platforms: ${platforms.join(', ')}`);
    logger.info(`📝 Content type: ${content.mediaType}`);
    
    // Call DvybPostingService to post to all platforms
    const result = await DvybPostingService.postNow({
      accountId: schedule.accountId,
      platforms,
      content,
    });
    
    // Update schedule based on results
    const successCount = result.results.filter(r => r.success).length;
    const failedResults = result.results.filter(r => !r.success);
    
    if (successCount === platforms.length) {
      // All platforms succeeded
      schedule.status = 'posted';
      schedule.postedAt = new Date();
      schedule.errorMessage = null;
      logger.info(`✅ Schedule ${scheduleId} completed successfully on all ${successCount} platforms`);
    } else if (successCount > 0) {
      // Partial success
      schedule.status = 'posted';
      schedule.postedAt = new Date();
      schedule.errorMessage = `Partial success: ${successCount}/${platforms.length} platforms. Failed: ${failedResults.map(r => `${r.platform}: ${r.error}`).join('; ')}`;
      logger.warn(`⚠️ Schedule ${scheduleId} partially completed: ${successCount}/${platforms.length} platforms`);
    } else {
      // All failed
      schedule.status = 'failed';
      schedule.postedAt = null;
      schedule.errorMessage = `All platforms failed: ${failedResults.map(r => `${r.platform}: ${r.error}`).join('; ')}`;
      logger.error(`❌ Schedule ${scheduleId} failed on all platforms`);
    }
    
    // Store detailed results in postMetadata
    schedule.postMetadata = {
      ...schedule.postMetadata,
      postingResults: result.results,
      processedAt: new Date().toISOString(),
    };
    
    await scheduleRepo.save(schedule);
    
    logger.info(`✅ Schedule ${scheduleId} status updated to: ${schedule.status}`);
  } catch (error: any) {
    logger.error(`❌ Error processing scheduled post ${scheduleId}: ${error.message}`);
    
    // Update schedule with error
    try {
      const schedule = await scheduleRepo.findOne({ where: { id: scheduleId } });
      if (schedule && schedule.status === 'pending') {
        schedule.status = 'failed';
        schedule.errorMessage = error.message || 'Unknown error during scheduled posting';
        schedule.postMetadata = {
          ...schedule.postMetadata,
          error: error.message,
          errorStack: error.stack,
          failedAt: new Date().toISOString(),
        };
        await scheduleRepo.save(schedule);
        logger.info(`✅ Schedule ${scheduleId} marked as failed in database`);
      }
    } catch (saveError: any) {
      logger.error(`❌ Failed to update schedule ${scheduleId} with error status: ${saveError.message}`);
    }
    
    throw error;
  }
}

/**
 * Create BullMQ worker to process DVYB scheduled posts
 */
export const dvybScheduledPostWorker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    logger.info(`🔄 DVYB Worker processing job ${job.id} for schedule ${job.data.scheduleId}`);
    logger.info(`⏰ Job delay was: ${job.opts?.delay}ms`);
    await processDvybScheduledPost(job);
  },
  {
    connection: redisConfig,
    concurrency: 5, // Process up to 5 posts concurrently
    limiter: {
      max: 10,
      duration: 60000, // Max 10 jobs per minute
    },
  }
);

// Worker event handlers
dvybScheduledPostWorker.on('completed', (job: Job) => {
  logger.info(`✅ DVYB scheduled post job ${job.id} completed successfully`);
});

dvybScheduledPostWorker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error(`❌ DVYB scheduled post job ${job?.id} failed: ${err.message}`);
});

dvybScheduledPostWorker.on('error', (err: Error) => {
  logger.error(`❌ DVYB worker error: ${err.message}`);
});

dvybScheduledPostWorker.on('ready', () => {
  logger.info('✅ DVYB scheduled post worker is ready and listening for jobs');
});

/**
 * Queue a DVYB scheduled post for execution at the scheduled time
 */
export async function queueDvybScheduledPost(scheduleId: number, scheduledFor: Date): Promise<void> {
  try {
    // Calculate delay in milliseconds
    const delay = scheduledFor.getTime() - Date.now();
    
    logger.info(`📅 Queueing DVYB schedule ${scheduleId} for ${scheduledFor.toISOString()}`);
    logger.info(`⏰ Current time: ${new Date().toISOString()}`);
    logger.info(`⏱️ Delay: ${delay}ms (${Math.round(delay / 1000)}s)`);
    
    if (delay < 0) {
      // If scheduled time is in the past, queue immediately
      logger.warn(`⚠️ DVYB Schedule ${scheduleId} is in the past, queuing immediately`);
      const job = await dvybScheduledPostQueue.add(
        `dvyb-scheduled-post-${scheduleId}`,
        { scheduleId },
        { delay: 0 }
      );
      logger.info(`✅ Job ${job.id} added to queue (immediate execution)`);
    } else {
      // Queue for future execution
      const job = await dvybScheduledPostQueue.add(
        `dvyb-scheduled-post-${scheduleId}`,
        { scheduleId },
        { delay }
      );
      logger.info(`✅ Job ${job.id} added to queue for ${scheduledFor.toISOString()} (${Math.round(delay / 1000)}s delay)`);
    }
    
    // Log queue status
    const waitingCount = await dvybScheduledPostQueue.getWaitingCount();
    const delayedCount = await dvybScheduledPostQueue.getDelayedCount();
    const activeCount = await dvybScheduledPostQueue.getActiveCount();
    logger.info(`📊 DVYB Queue status: ${waitingCount} waiting, ${delayedCount} delayed, ${activeCount} active`);
  } catch (error: any) {
    logger.error(`❌ Error queueing DVYB scheduled post ${scheduleId}: ${error.message}`);
    if (error.stack) {
      logger.error(`❌ Stack: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Service to check for upcoming DVYB scheduled posts and queue them
 */
export class DvybScheduledPostSchedulerService {
  static async checkAndQueueUpcomingPosts(): Promise<void> {
    try {
      const scheduleRepo = AppDataSource.getRepository(DvybSchedule);
      const now = new Date();
      
      // Find all pending posts scheduled within the next hour
      const upcomingTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour ahead
      
      const upcomingSchedules = await scheduleRepo
        .createQueryBuilder('schedule')
        .where('schedule.status = :status', { status: 'pending' })
        .andWhere('schedule.scheduledFor <= :upcomingTime', { upcomingTime })
        .andWhere('schedule.scheduledFor > :now', { now })
        .getMany();

      // Also include posts that are scheduled in the past but still pending
      const pastPendingSchedules = await scheduleRepo
        .createQueryBuilder('schedule')
        .where('schedule.status = :status', { status: 'pending' })
        .andWhere('schedule.scheduledFor <= :now', { now })
        .getMany();

      const allSchedules = [...upcomingSchedules, ...pastPendingSchedules];
      
      logger.info(`📋 Found ${allSchedules.length} pending DVYB scheduled posts to queue`);
      
      // Check if jobs are already queued to avoid duplicates
      const activeJobs = await dvybScheduledPostQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
      const queuedScheduleIds = new Set(
        activeJobs.map(job => job.data?.scheduleId).filter(Boolean)
      );
      
      logger.info(`📋 Found ${queuedScheduleIds.size} already queued DVYB schedules`);
      
      let queuedCount = 0;
      let skippedCount = 0;
      
      for (const schedule of allSchedules) {
        if (queuedScheduleIds.has(schedule.id)) {
          logger.info(`⏭️ Skipping DVYB schedule ${schedule.id} - already queued`);
          skippedCount++;
          continue;
        }
        
        await queueDvybScheduledPost(schedule.id, schedule.scheduledFor);
        queuedCount++;
      }
      
      logger.info(`✅ DVYB Scheduler: Queued ${queuedCount} new posts, skipped ${skippedCount} already queued`);
    } catch (error: any) {
      logger.error(`❌ Error checking DVYB upcoming scheduled posts: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Remove a scheduled post from the queue (for rescheduling or cancellation)
 */
export async function removeScheduledPost(scheduleId: number): Promise<void> {
  const jobName = `dvyb-scheduled-post-${scheduleId}`;
  
  try {
    // Get all jobs in the queue (waiting and delayed)
    const jobs = await dvybScheduledPostQueue.getJobs(['waiting', 'delayed']);
    
    // Find the job with matching schedule ID
    const job = jobs.find(j => j.data.scheduleId === scheduleId);
    
    if (job) {
      // Remove the job from the queue
      await job.remove();
      logger.info(`🗑️ Removed scheduled post job for schedule ${scheduleId} from queue`);
    } else {
      logger.info(`ℹ️ No queued job found for schedule ${scheduleId} (may have already been processed or removed)`);
    }
  } catch (error: any) {
    logger.error(`❌ Error removing job for schedule ${scheduleId}: ${error.message}`);
    // Don't throw - this is non-critical, schedule update can proceed
  }
}

