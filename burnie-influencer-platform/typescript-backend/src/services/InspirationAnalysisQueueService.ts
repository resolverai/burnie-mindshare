import { Queue, Worker, Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { DvybInspirationLink } from '../models/DvybInspirationLink';
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

// Queue name for inspiration analysis
const QUEUE_NAME = 'inspiration-analysis';

// Create BullMQ queue
export const inspirationAnalysisQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 2, // Retry once if fails
    backoff: {
      type: 'exponential',
      delay: 30000, // 30 second delay between retries
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 500,
    },
    removeOnFail: {
      age: 7 * 86400, // Keep failed jobs for 7 days
      count: 500,
    },
  },
});

interface InspirationAnalysisJobData {
  inspirationId: number;
  url: string;
  mediaType?: 'image' | 'video';
}

interface InspirationAnalysisResponse {
  success: boolean;
  analysis?: any;
  error?: string;
}

/**
 * Process inspiration analysis job
 * Calls Python backend to analyze the inspiration and saves result to database
 */
async function processInspirationAnalysis(job: Job<InspirationAnalysisJobData>): Promise<void> {
  const { inspirationId, url, mediaType } = job.data;
  
  try {
    logger.info(`🔍 Processing inspiration analysis job ${job.id} for inspiration ${inspirationId}`);
    logger.info(`   URL: ${url.substring(0, 80)}...`);
    
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      throw new Error('Python AI backend URL not configured');
    }
    
    // Call Python backend for analysis
    const response = await fetch(`${pythonBackendUrl}/api/dvyb/adhoc/analyze-inspiration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        media_type: mediaType,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python backend error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json() as InspirationAnalysisResponse;
    
    if (!result.success || !result.analysis) {
      const errorMsg = result.error || 'Unknown error';
      logger.warn(`⚠️ Inspiration analysis returned no result for ${inspirationId}: ${errorMsg}`);
      // Don't throw - just log and mark as completed (analysis failed but job succeeded)
      return;
    }
    
    // Save analysis result to database
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);
    const inspiration = await inspirationRepo.findOne({ where: { id: inspirationId } });
    
    if (!inspiration) {
      logger.warn(`⚠️ Inspiration ${inspirationId} not found, cannot save analysis`);
      return;
    }
    
    // Store analysis as JSON string
    inspiration.inspirationAnalysis = JSON.stringify(result.analysis);
    await inspirationRepo.save(inspiration);
    
    logger.info(`✅ Inspiration analysis saved for ${inspirationId}`);
    
  } catch (error: any) {
    logger.error(`❌ Error processing inspiration analysis job ${job.id}:`, error.message);
    throw error; // Re-throw to mark job as failed
  }
}

/**
 * Create BullMQ worker to process inspiration analysis jobs
 * Concurrency is set to 1 to process jobs one by one (avoid memory issues)
 */
export const inspirationAnalysisWorker = new Worker(
  QUEUE_NAME,
  async (job: Job<InspirationAnalysisJobData>) => {
    logger.info(`🔄 Inspiration analysis worker processing job ${job.id} for inspiration ${job.data.inspirationId}`);
    await processInspirationAnalysis(job);
  },
  {
    connection: redisConfig,
    concurrency: 1, // Process ONE job at a time to avoid memory issues
    limiter: {
      max: 10,
      duration: 60000, // Max 10 jobs per minute (rate limiting)
    },
  }
);

// Worker event handlers
inspirationAnalysisWorker.on('completed', (job: Job) => {
  logger.info(`✅ Inspiration analysis job ${job.id} completed for inspiration ${job.data.inspirationId}`);
});

inspirationAnalysisWorker.on('failed', (job: Job | undefined, error: Error) => {
  if (job) {
    logger.error(`❌ Inspiration analysis job ${job.id} failed for inspiration ${job.data.inspirationId}:`, error.message);
  } else {
    logger.error(`❌ Inspiration analysis job failed:`, error.message);
  }
});

inspirationAnalysisWorker.on('error', (error: Error) => {
  logger.error(`❌ Inspiration analysis worker error:`, error.message);
});

/**
 * Add inspiration analysis job to queue
 */
export async function queueInspirationAnalysis(
  inspirationId: number,
  url: string,
  mediaType?: 'image' | 'video'
): Promise<void> {
  try {
    logger.info(`📅 Queueing inspiration analysis for inspiration ${inspirationId}`);
    logger.info(`   URL: ${url.substring(0, 80)}...`);
    
    const job = await inspirationAnalysisQueue.add(
      `inspiration-analysis-${inspirationId}-${Date.now()}`,
      { inspirationId, url, mediaType },
      {
        // No delay - process immediately (but one at a time due to concurrency: 1)
      }
    );
    
    logger.info(`✅ Inspiration analysis job ${job.id} queued for inspiration ${inspirationId}`);
    
    // Log queue status
    const waitingCount = await inspirationAnalysisQueue.getWaitingCount();
    const activeCount = await inspirationAnalysisQueue.getActiveCount();
    logger.info(`📊 Inspiration analysis queue: ${waitingCount} waiting, ${activeCount} active`);
    
  } catch (error: any) {
    logger.error(`❌ Error queueing inspiration analysis for inspiration ${inspirationId}:`, error.message);
    throw error;
  }
}

/**
 * Get queue status
 */
export async function getInspirationAnalysisQueueStatus(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const [waiting, active, completed, failed] = await Promise.all([
    inspirationAnalysisQueue.getWaitingCount(),
    inspirationAnalysisQueue.getActiveCount(),
    inspirationAnalysisQueue.getCompletedCount(),
    inspirationAnalysisQueue.getFailedCount(),
  ]);
  
  return { waiting, active, completed, failed };
}

/**
 * Clear all waiting/pending jobs from the queue
 * This will NOT stop the currently active job - only pending jobs will be removed
 */
export async function clearPendingInspirationAnalysisJobs(): Promise<{
  cleared: number;
  active: number;
}> {
  try {
    // Get waiting jobs count before clearing
    const waitingCount = await inspirationAnalysisQueue.getWaitingCount();
    const activeCount = await inspirationAnalysisQueue.getActiveCount();
    
    // Get all waiting jobs
    const waitingJobs = await inspirationAnalysisQueue.getWaiting();
    
    // Remove all waiting jobs
    let clearedCount = 0;
    for (const job of waitingJobs) {
      await job.remove();
      clearedCount++;
    }
    
    logger.info(`🗑️  Cleared ${clearedCount} pending inspiration analysis jobs (${activeCount} active job(s) continue running)`);
    
    return {
      cleared: clearedCount,
      active: activeCount,
    };
  } catch (error: any) {
    logger.error(`❌ Error clearing pending inspiration analysis jobs:`, error.message);
    throw error;
  }
}

