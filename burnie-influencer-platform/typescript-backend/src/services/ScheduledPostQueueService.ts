import { Queue, Worker, Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { Web3PostsSchedule } from '../models/Web3PostsSchedule';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { Web3ProjectTwitterPost } from '../models/Web3ProjectTwitterPost';
import { ProjectTwitterTokenService } from './ProjectTwitterTokenService';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { uploadVideoOAuth1 } from '../utils/oauth1Utils';
import { 
  uploadImageToTwitter, 
  createTweet, 
  refreshOAuth2Token, 
  storeProjectTwitterPost,
  generatePresignedUrlForTwitter
} from '../routes/projectTwitterPosting';
import FormData from 'form-data';
import fetch from 'node-fetch';

// Redis connection config using environment variables from env config
// No hardcoded URLs - all values come from environment variables
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

// Only add password if it's set in environment (not empty string)
if (env.redis.password && env.redis.password.trim() !== '') {
  redisConfig.password = env.redis.password;
}

logger.info(`🔧 Redis configuration for BullMQ:`);
logger.info(`   - Host: ${redisConfig.host}`);
logger.info(`   - Port: ${redisConfig.port}`);
logger.info(`   - Password: ${redisConfig.password ? '***set***' : 'not set'}`);

// Queue name for scheduled posts
const QUEUE_NAME = 'scheduled-posts';

// Create BullMQ queue
export const scheduledPostQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour (reduced from 24 hours for cleanup)
      count: 100, // Keep only last 100 completed jobs
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours (reduced from 7 days)
      count: 100, // Keep only last 100 failed jobs
    },
  },
});

// Helper function to extract storage key from URL or S3 URI (supports AWS S3 and GCS)
function extractS3KeyFromUrl(url: string): string | null {
  try {
    if (url.startsWith('s3://')) {
      const s3Key = url.substring(5);
      logger.info(`Extracted key from s3:// URI: ${s3Key}`);
      return s3Key;
    }
    
    // Handle both AWS S3 and GCS URLs
    if (url.includes('s3.amazonaws.com') || url.includes('storage.googleapis.com')) {
      const urlObj = new URL(url);
      let path = urlObj.pathname.substring(1).split('?')[0] ?? '';
      // GCS path-style: /bucket/key — strip bucket prefix
      if (url.includes('storage.googleapis.com')) {
        const slashIdx = path.indexOf('/');
        if (slashIdx !== -1) path = path.substring(slashIdx + 1);
      }
      return path && path.length > 0 ? path : null;
    }
    
    return null;
  } catch (error) {
    logger.error('Error extracting storage key from URL:', error);
    return null;
  }
}

// Use exported functions from projectTwitterPosting to ensure identical behavior
// This guarantees automated posting uses the exact same code path as manual posting

// Helper function to upload video to Twitter
// Uses the same logic as manual posting but with presigned URL generation
async function uploadVideoToTwitterInternal(
  videoUrl: string,
  oauth1Token: string,
  oauth1TokenSecret: string
): Promise<string | null> {
  try {
    logger.info('🎬 Starting video upload for scheduled post using OAuth1.0a...');
    
    // Generate fresh presigned URL if it's from S3
    // Handle both S3 URI format (s3://bucket/key) and HTTPS S3 URLs
    let freshVideoUrl = videoUrl;
    if (videoUrl.startsWith('s3://') || videoUrl.includes('s3.amazonaws.com') || videoUrl.includes('storage.googleapis.com')) {
      logger.info(`🔍 Detected S3 URL/URI for video, extracting S3 key: ${videoUrl.substring(0, 100)}...`);
      const s3Key = extractS3KeyFromUrl(videoUrl);
      if (s3Key) {
        logger.info(`🔑 Extracted S3 key: ${s3Key}`);
        const presignedUrl = await generatePresignedUrlForTwitter(s3Key);
        if (presignedUrl) {
          freshVideoUrl = presignedUrl;
          logger.info('✅ Generated fresh presigned URL for video upload');
        } else {
          logger.error('❌ Failed to generate presigned URL for S3 key');
        }
      } else {
        logger.error(`❌ Could not extract S3 key from video URL: ${videoUrl}`);
      }
    } else {
      logger.info(`📎 Video URL is not an S3 URL, using as-is: ${videoUrl.substring(0, 100)}...`);
    }
    
    // Use the same uploadVideoOAuth1 function as manual posting
    // This uses TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET from oauth1Utils
    const mediaId = await uploadVideoOAuth1(freshVideoUrl, oauth1Token, oauth1TokenSecret);
    if (mediaId) {
      logger.info(`✅ Video uploaded successfully via OAuth1.0a, media ID: ${mediaId}`);
    } else {
      logger.error('❌ Video upload returned null media ID');
    }
    return mediaId;
  } catch (error: any) {
    logger.error(`❌ Error uploading video: ${error.message}`);
    return null;
  }
}

/**
 * Process a scheduled post job
 */
export async function processScheduledPost(job: Job): Promise<void> {
  const { scheduleId } = job.data;
  
  if (!scheduleId) {
    throw new Error('Schedule ID is missing from job data');
  }
  
  logger.info(`🔄 Processing scheduled post job: ${scheduleId}`);
  logger.info(`📋 Job data: ${JSON.stringify(job.data)}`);
  
  const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
  const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
  
  try {
    // Get the schedule
    const schedule = await scheduleRepository.findOne({
      where: { id: scheduleId }
    });

    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    // Check if already processed
    if (schedule.status === 'completed') {
      logger.info(`⏭️ Schedule ${scheduleId} already completed, skipping`);
      return;
    }

    if (schedule.status === 'failed') {
      logger.warn(`⚠️ Schedule ${scheduleId} already failed with reason: ${schedule.failureReason || 'Unknown'}`);
      logger.warn(`⚠️ Skipping failed schedule. To retry, use POST /api/projects/${schedule.projectId}/post/schedule/reset/${scheduleId} or manually update status to 'pending' in database`);
      return;
    }

    // Get project Twitter connection
    const connection = await connectionRepository.findOne({
      where: { projectId: schedule.projectId }
    });

    if (!connection) {
      const errorMsg = 'Twitter not connected for this project';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Validate tokens based on media type
    const tokenValidation = await ProjectTwitterTokenService.validateTokens(schedule.projectId);
    
    if (schedule.mediaType === 'video') {
      // For videos, need both OAuth1 and OAuth2
      if (!tokenValidation.oauth1Valid || !tokenValidation.oauth2Valid) {
        const errorMsg = `Invalid tokens for video posting. OAuth1: ${tokenValidation.oauth1Valid ? 'valid' : 'invalid'}, OAuth2: ${tokenValidation.oauth2Valid ? 'valid' : 'invalid'}`;
        schedule.status = 'failed';
        schedule.failureReason = errorMsg;
        await scheduleRepository.save(schedule);
        throw new Error(errorMsg);
      }
    } else {
      // For images, need OAuth2
      if (!tokenValidation.oauth2Valid) {
        const errorMsg = 'Invalid OAuth2 token for image posting';
        schedule.status = 'failed';
        schedule.failureReason = errorMsg;
        await scheduleRepository.save(schedule);
        throw new Error(errorMsg);
      }
    }

    // Reload connection from database to get latest tokens
    let freshConnection = await connectionRepository.findOne({
      where: { projectId: schedule.projectId }
    });

    if (!freshConnection) {
      const errorMsg = 'Failed to reload Twitter connection';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Check OAuth scopes
    const userScopes = freshConnection.scopes || '';
    const hasWriteAccess = userScopes.includes('tweet.write');
    
    if (!hasWriteAccess) {
      const errorMsg = 'Insufficient Twitter permissions (missing tweet.write scope)';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Get OAuth2 token and refresh if needed
    let oauth2Token = freshConnection.oauth2AccessToken;
    
    if (!oauth2Token) {
      const errorMsg = 'OAuth2 access token not found';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Proactively refresh token if it's expired or will expire within 5 minutes
    // Twitter tokens expire in 2 hours (7200 seconds), so we refresh early to avoid failures
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes buffer
    
    if (freshConnection.oauth2ExpiresAt) {
      const expiresAt = new Date(freshConnection.oauth2ExpiresAt);
      
      if (expiresAt <= fiveMinutesFromNow) {
        if (expiresAt <= now) {
          logger.info('🔄 OAuth2 token expired, refreshing...');
        } else {
          const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 60000);
          logger.info(`🔄 OAuth2 token expires in ${minutesUntilExpiry} minutes, proactively refreshing...`);
        }
        
        if (!freshConnection.oauth2RefreshToken) {
          const errorMsg = 'OAuth2 refresh token not found. Please reconnect your Twitter account.';
          schedule.status = 'failed';
          schedule.failureReason = errorMsg;
          await scheduleRepository.save(schedule);
          throw new Error(errorMsg);
        }
        
        const refreshed = await refreshOAuth2Token(freshConnection);
        if (!refreshed) {
          const errorMsg = 'Token refresh failed. Please reconnect your Twitter account.';
          schedule.status = 'failed';
          schedule.failureReason = errorMsg;
          await scheduleRepository.save(schedule);
          throw new Error(errorMsg);
        }
        
        // Reload connection after refresh
        freshConnection = await connectionRepository.findOne({
          where: { projectId: schedule.projectId }
        });
        
        if (!freshConnection || !freshConnection.oauth2AccessToken) {
          const errorMsg = 'Failed to reload connection after token refresh';
          schedule.status = 'failed';
          schedule.failureReason = errorMsg;
          await scheduleRepository.save(schedule);
          throw new Error(errorMsg);
        }
        
        oauth2Token = freshConnection.oauth2AccessToken;
        logger.info('✅ Token refreshed successfully. New expiration:', freshConnection.oauth2ExpiresAt);
      } else {
        const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 60000);
        logger.info(`✅ OAuth2 token is valid for ${minutesUntilExpiry} more minutes`);
      }
    } else {
      logger.warn('⚠️ OAuth2 token expiration not set, proceeding with caution');
    }

    // Validate token by making a test API call before uploading media
    logger.info('🔍 Validating OAuth2 token with Twitter API before media upload...');
    try {
      const testResponse = await fetch('https://api.twitter.com/2/users/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${oauth2Token}`,
          'User-Agent': 'BurnieAI/1.0'
        }
      });

      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        logger.error(`❌ OAuth2 token validation failed: ${testResponse.status} - ${errorText}`);
        
        if (testResponse.status === 401 || testResponse.status === 403) {
          const errorMsg = 'OAuth2 token is invalid or expired. Please reconnect your Twitter account.';
          schedule.status = 'failed';
          schedule.failureReason = errorMsg;
          await scheduleRepository.save(schedule);
          throw new Error(errorMsg);
        }
      } else {
        logger.info('✅ OAuth2 token validated successfully with Twitter API');
      }
    } catch (validationError: any) {
      logger.error(`❌ Token validation error: ${validationError.message}`);
      schedule.status = 'failed';
      schedule.failureReason = `Token validation failed: ${validationError.message}`;
      await scheduleRepository.save(schedule);
      throw validationError;
    }

    // Check for media.write scope (required for image uploads)
    const hasMediaWrite = freshConnection.scopes?.includes('media.write') || false;
    if (!hasMediaWrite) {
      logger.warn('⚠️ Warning: media.write scope not found in token scopes');
      logger.warn(`📋 Available scopes: ${freshConnection.scopes || 'none'}`);
      // Continue anyway - some tokens might work without explicit scope check
    } else {
      logger.info('✅ Token has media.write scope');
    }

    // Upload media
    let mediaId: string | null = null;
    let uploadError: string | null = null;
    
    try {
      if (schedule.mediaType === 'video') {
        logger.info('🎬 Video content detected - using OAuth1.0a for upload...');
        logger.info(`📹 Video URL: ${schedule.mediaS3Url}`);
        
        // Reload connection for OAuth1 tokens
        const oauth1Connection = await connectionRepository.findOne({
          where: { projectId: schedule.projectId }
        });
        
        if (!oauth1Connection || !oauth1Connection.oauth1Token || !oauth1Connection.oauth1TokenSecret) {
          const errorMsg = 'OAuth1 tokens required for video upload';
          logger.error(`❌ ${errorMsg}. OAuth1Token: ${!!oauth1Connection?.oauth1Token}, OAuth1TokenSecret: ${!!oauth1Connection?.oauth1TokenSecret}`);
          schedule.status = 'failed';
          schedule.failureReason = errorMsg;
          await scheduleRepository.save(schedule);
          throw new Error(errorMsg);
        }
        
        logger.info(`🔑 Using OAuth1 tokens from database for video upload`);
        mediaId = await uploadVideoToTwitterInternal(
          schedule.mediaS3Url,
          oauth1Connection.oauth1Token,
          oauth1Connection.oauth1TokenSecret
        );
        
        if (!mediaId) {
          uploadError = 'Video upload returned null media ID';
          logger.error(`❌ ${uploadError}`);
        }
      } else {
        logger.info('🖼️ Image content detected - using OAuth2 for upload...');
        logger.info(`🖼️ Image URL: ${schedule.mediaS3Url}`);
        logger.info(`🔑 Using OAuth2 token: ${oauth2Token.substring(0, 20)}... (length: ${oauth2Token.length})`);
        
        // Reload connection one more time right before upload to ensure we have the latest token
        const finalConnection = await connectionRepository.findOne({
          where: { projectId: schedule.projectId }
        });
        if (finalConnection?.oauth2AccessToken) {
          oauth2Token = finalConnection.oauth2AccessToken;
          logger.info('✅ Reloaded OAuth2 token from database before upload');
        }
        
        // Use the exact same function as manual posting to ensure identical behavior
        // This function logs detailed errors internally, so we'll see them in logs
        logger.info(`📤 Calling uploadImageToTwitter with token length ${oauth2Token.length} and image URL: ${schedule.mediaS3Url.substring(0, 100)}...`);
        mediaId = await uploadImageToTwitter(oauth2Token, schedule.mediaS3Url);
        
        if (!mediaId) {
          uploadError = 'Image upload returned null media ID. Check logs above for Twitter API error details.';
          logger.error(`❌ ${uploadError}`);
          logger.error(`❌ Image upload failed. Check logs for Twitter API response details.`);
        } else {
          logger.info(`✅ Image upload successful, media ID: ${mediaId}`);
        }
      }
    } catch (uploadException: any) {
      uploadError = uploadException.message || 'Unknown upload error';
      logger.error(`❌ Exception during media upload: ${uploadError}`);
      logger.error(`❌ Upload exception stack: ${uploadException.stack}`);
      mediaId = null;
    }

    if (mediaId === null && (schedule.mediaType === 'video' || schedule.mediaType === 'image')) {
      // Construct detailed error message
      const errorMsg = uploadError || 'Failed to upload media to Twitter. Check server logs for Twitter API error details.';
      logger.error(`❌ Media upload failed for schedule ${scheduleId}`);
      logger.error(`❌ Media type: ${schedule.mediaType}`);
      logger.error(`❌ Media URL: ${schedule.mediaS3Url}`);
      logger.error(`❌ Error: ${errorMsg}`);
      logger.error(`❌ Note: Check logs above for detailed Twitter API error response (status code, error message, etc.)`);
      
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Final reload before creating tweet
    const finalConnection = await connectionRepository.findOne({
      where: { projectId: schedule.projectId }
    });
    
    if (!finalConnection || !finalConnection.oauth2AccessToken) {
      const errorMsg = 'Failed to reload connection before creating tweet';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }
    
    const finalOAuth2Token = finalConnection.oauth2AccessToken;
    
    // Create main tweet using the exact same function as manual posting
    const mainTweet = schedule.tweetText.main_tweet;
    const mainTweetId = await createTweet(finalOAuth2Token, mainTweet, mediaId || undefined);

    if (!mainTweetId) {
      const errorMsg = 'Failed to create tweet';
      schedule.status = 'failed';
      schedule.failureReason = errorMsg;
      await scheduleRepository.save(schedule);
      throw new Error(errorMsg);
    }

    // Create thread tweets if any using the exact same function as manual posting
    const threadTweetIds = [mainTweetId];
    const thread = schedule.tweetText.thread_array;
    if (thread && thread.length > 0) {
      for (const threadTweet of thread) {
        const threadTweetId = await createTweet(finalOAuth2Token, threadTweet, undefined, threadTweetIds[threadTweetIds.length - 1]);
        if (threadTweetId) {
          threadTweetIds.push(threadTweetId);
        } else {
          logger.warn(`Failed to create thread tweet: ${threadTweet}`);
        }
      }
    }

    // Store in database
    await storeProjectTwitterPost(
      schedule.projectId,
      mainTweet,
      mainTweetId,
      threadTweetIds,
      thread,
      mediaId || undefined,
      schedule.mediaType === 'image' ? schedule.mediaS3Url : undefined,
      schedule.mediaType === 'video' ? schedule.mediaS3Url : undefined,
      schedule.id
    );

    // Mark schedule as completed
    schedule.status = 'completed';
    schedule.failureReason = null;
    await scheduleRepository.save(schedule);

    logger.info(`✅ Successfully posted scheduled post ${scheduleId} to Twitter`);
  } catch (error: any) {
    logger.error(`❌ Error processing scheduled post ${scheduleId}: ${error.message}`);
    if (error.stack) {
      logger.error(`❌ Full error stack: ${error.stack}`);
    }
    
    // Update schedule status to failed (even if it was already failed, update with latest error)
    try {
      const schedule = await scheduleRepository.findOne({
        where: { id: scheduleId }
      });
      
      if (schedule) {
        // Always update failed status with latest error (allows tracking of retry attempts)
        schedule.status = 'failed';
        schedule.failureReason = error.message || 'Unknown error';
        await scheduleRepository.save(schedule);
        logger.info(`📝 Updated schedule ${scheduleId} status to failed with reason: ${schedule.failureReason}`);
      }
    } catch (saveError) {
      logger.error(`❌ Failed to update schedule status: ${saveError}`);
    }
    
    throw error;
  }
}

/**
 * Create BullMQ worker to process scheduled posts
 */
export const scheduledPostWorker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    logger.info(`🔄 Worker processing job ${job.id} for schedule ${job.data.scheduleId}`);
    logger.info(`⏰ Job delay was: ${job.opts?.delay}ms`);
    await processScheduledPost(job);
  },
  {
    connection: redisConfig,
    concurrency: 5, // Process up to 5 posts concurrently
    limiter: {
      max: 10,
      duration: 60000, // Max 10 jobs per minute (Twitter rate limit consideration)
    },
    // BullMQ automatically processes delayed jobs when delay expires
    // No special configuration needed for delayed jobs
  }
);

// Worker event handlers
scheduledPostWorker.on('completed', async (job) => {
  logger.info(`✅ Scheduled post job ${job.id} (schedule ${job.data?.scheduleId}) completed successfully`);
  
  // Clean up the completed job from Redis immediately
  // BullMQ will automatically clean up based on removeOnComplete settings,
  // but we can also explicitly remove it for immediate cleanup
  try {
    // Use clean() method to remove old jobs, or job.remove() for individual cleanup
    await job.remove();
    logger.info(`🧹 Cleaned up completed job ${job.id} from Redis`);
  } catch (error: any) {
    // If job.remove() fails, it's okay - BullMQ will clean it up based on removeOnComplete settings
    logger.debug(`ℹ️ Job ${job.id} will be cleaned up automatically by BullMQ`);
  }
});

scheduledPostWorker.on('failed', async (job, err) => {
  logger.error(`❌ Scheduled post job ${job?.id} (schedule ${job?.data?.scheduleId}) failed: ${err.message}`);
  if (err.stack) {
    logger.error(`❌ Error stack: ${err.stack}`);
  }
  
  // Clean up the failed job from Redis after logging (keep for debugging)
  // Note: We'll keep failed jobs for a bit longer to debug issues
  if (job) {
    try {
      // Only remove if job has been retried max times
      const jobState = await job.getState();
      if (jobState === 'failed') {
        // Wait a bit before cleanup to allow for debugging
        setTimeout(async () => {
          try {
            await job.remove();
            logger.info(`🧹 Cleaned up failed job ${job.id} from Redis`);
          } catch (error: any) {
            logger.warn(`⚠️ Could not remove failed job ${job.id}: ${error.message}`);
          }
        }, 60000); // Remove after 1 minute
      }
    } catch (error: any) {
      logger.warn(`⚠️ Could not check job state for cleanup: ${error.message}`);
    }
  }
});

scheduledPostWorker.on('error', (error) => {
  logger.error(`❌ Scheduled post worker error: ${error.message}`);
  if (error.stack) {
    logger.error(`❌ Worker error stack: ${error.stack}`);
  }
});

scheduledPostWorker.on('active', (job) => {
  logger.info(`🔄 Scheduled post job ${job.id} (schedule ${job.data?.scheduleId}) is now active`);
});

scheduledPostWorker.on('stalled', (jobId) => {
  logger.warn(`⚠️ Scheduled post job ${jobId} stalled`);
});

scheduledPostWorker.on('ready', () => {
  logger.info('✅ Scheduled post worker is ready and listening for jobs');
});

/**
 * Queue a scheduled post for execution at the scheduled time
 */
export async function queueScheduledPost(scheduleId: number, scheduledAt: Date): Promise<void> {
  try {
    // Calculate delay in milliseconds
    const delay = scheduledAt.getTime() - Date.now();
    
    logger.info(`📅 Queueing schedule ${scheduleId} for ${scheduledAt.toISOString()}`);
    logger.info(`⏰ Current time: ${new Date().toISOString()}`);
    logger.info(`⏱️ Delay: ${delay}ms (${Math.round(delay / 1000)}s)`);
    
    if (delay < 0) {
      // If scheduled time is in the past, queue immediately
      logger.warn(`⚠️ Schedule ${scheduleId} is in the past, queuing immediately`);
      const job = await scheduledPostQueue.add(
        `scheduled-post-${scheduleId}`,
        { scheduleId },
        { delay: 0 }
      );
      logger.info(`✅ Job ${job.id} added to queue (immediate execution)`);
    } else {
      // Queue for future execution
      const job = await scheduledPostQueue.add(
        `scheduled-post-${scheduleId}`,
        { scheduleId },
        { delay }
      );
      logger.info(`✅ Job ${job.id} added to queue for ${scheduledAt.toISOString()} (${Math.round(delay / 1000)}s delay)`);
    }
    
    // Log queue status for debugging
    const waitingCount = await scheduledPostQueue.getWaitingCount();
    const delayedCount = await scheduledPostQueue.getDelayedCount();
    const activeCount = await scheduledPostQueue.getActiveCount();
    logger.info(`📊 Queue status: ${waitingCount} waiting, ${delayedCount} delayed, ${activeCount} active`);
  } catch (error: any) {
    logger.error(`❌ Error queuing scheduled post ${scheduleId}: ${error.message}`);
    if (error.stack) {
      logger.error(`❌ Stack: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Service to check for upcoming scheduled posts and queue them
 * This should be called periodically (e.g., every minute via cron)
 */
export class ScheduledPostSchedulerService {
  /**
   * Check for upcoming scheduled posts and queue them
   */
  static async checkAndQueueUpcomingPosts(): Promise<void> {
    try {
      const scheduleRepository = AppDataSource.getRepository(Web3PostsSchedule);
      const now = new Date();
      
      // Find all pending posts scheduled within the next hour
      // This ensures we queue posts in advance
      const upcomingTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour ahead
      
      const upcomingSchedules = await scheduleRepository
        .createQueryBuilder('schedule')
        .where('schedule.status = :status', { status: 'pending' })
        .andWhere('schedule.scheduledAt <= :upcomingTime', { upcomingTime })
        .andWhere('schedule.scheduledAt > :now', { now })
        .getMany();

      // Also include posts that are scheduled in the past but still pending (should be processed immediately)
      const pastPendingSchedules = await scheduleRepository
        .createQueryBuilder('schedule')
        .where('schedule.status = :status', { status: 'pending' })
        .andWhere('schedule.scheduledAt <= :now', { now })
        .getMany();

      const allSchedules = [...upcomingSchedules, ...pastPendingSchedules];
      
      logger.info(`📋 Found ${allSchedules.length} pending scheduled posts to queue`);
      
      // Check if jobs are already queued to avoid duplicates
      // Note: We check all states including completed/failed to avoid re-queueing
      const activeJobs = await scheduledPostQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
      const queuedScheduleIds = new Set(
        activeJobs.map(job => job.data?.scheduleId).filter(Boolean)
      );
      
      logger.info(`📋 Found ${queuedScheduleIds.size} already queued schedules`);
      
      let queuedCount = 0;
      let skippedCount = 0;
      for (const schedule of allSchedules) {
        // Skip if already queued (but only if it's in a non-final state)
        const existingJob = activeJobs.find(job => job.data?.scheduleId === schedule.id);
        if (existingJob) {
          const jobState = await existingJob.getState();
          // Only skip if job is still in a processing state (not completed/failed)
          if (['waiting', 'delayed', 'active'].includes(jobState)) {
            skippedCount++;
            logger.debug(`⏭️ Schedule ${schedule.id} already queued (state: ${jobState}), skipping`);
            continue;
          }
          // If job is completed or failed, we can re-queue if schedule is still pending
          if (jobState === 'completed' && schedule.status === 'completed') {
            skippedCount++;
            logger.debug(`⏭️ Schedule ${schedule.id} already completed, skipping`);
            continue;
          }
        }
        
        try {
          await queueScheduledPost(schedule.id, schedule.scheduledAt);
          queuedCount++;
        } catch (error: any) {
          logger.error(`❌ Failed to queue schedule ${schedule.id}: ${error.message}`);
        }
      }
      
      if (skippedCount > 0) {
        logger.info(`⏭️ Skipped ${skippedCount} already queued schedules`);
      }
      
      if (queuedCount > 0) {
        logger.info(`✅ Queued ${queuedCount} new scheduled posts`);
      }
    } catch (error: any) {
      logger.error(`❌ Error checking and queueing scheduled posts: ${error.message}`);
    }
  }
}

