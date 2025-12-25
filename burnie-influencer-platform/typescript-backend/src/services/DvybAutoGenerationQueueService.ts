import { Queue, Worker, Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybContext } from '../models/DvybContext';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { logger } from '../config/logger';
import { env } from '../config/env';
import axios from 'axios';

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

// Queue name for DVYB auto-generation
const QUEUE_NAME = 'dvyb-auto-generation';

// Create BullMQ queue
export const dvybAutoGenerationQueue = new Queue(QUEUE_NAME, {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 2, // Retry once if fails
    backoff: {
      type: 'exponential',
      delay: 60000, // 1 minute delay between retries
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

interface AutoGenerationJobData {
  accountId: number;
  scheduledTime: string;
}

interface GrokGenerationOutput {
  topic: string;
  userPrompt: string;
  influencerSpecs: {
    ethnicity: string;
    skinColor: string;
    ageRange: string;
    hairStyle: string;
    hairColor: string;
    environment: string;
    ambience: string;
  };
}

/**
 * Call Python AI backend to generate topic and user instructions using Grok
 * This follows the codebase pattern where TypeScript calls Python for LLM tasks.
 */
async function generateTopicWithGrok(
  accountId: number,
  context: DvybContext,
  previousGenerations: Array<{ topic: string; platformTexts: any }>,
  documentsText: Array<{ name: string; text: string; timestamp: string; url?: string }>
): Promise<GrokGenerationOutput> {
  const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8001';
  
  // Build brand context for Python endpoint
  const brandContext = {
    accountName: context.accountName,
    businessOverview: context.businessOverview,
    customerDemographics: context.customerDemographics,
    popularProducts: context.popularProducts,
    whyCustomersChoose: context.whyCustomersChoose,
    brandStory: context.brandStory,
    industry: context.industry,
    targetAudience: context.targetAudience,
    brandVoices: context.brandVoices,
    brandStyles: context.brandStyles,
    contentPillars: context.contentPillars,
    keywords: context.keywords,
  };

  // Format previous generations (last 20)
  const previousGenData = previousGenerations.slice(0, 20).map(gen => ({
    topic: gen.topic,
    platformTexts: gen.platformTexts?.map((pt: any) => ({
      topic: pt.topic,
      platforms: pt.platforms,
    })),
  }));

  // Format documents
  const docsData = documentsText.map(doc => ({
    name: doc.name,
    text: doc.text,
    timestamp: doc.timestamp,
    url: doc.url,
  }));

  try {
    logger.info(`🤖 Calling Python AI backend for topic generation...`);
    
    const response = await axios.post(
      `${pythonBackendUrl}/api/dvyb/auto-generation/generate-topic`,
      {
        account_id: accountId,
        brand_context: brandContext,
        documents_text: docsData,
        previous_generations: previousGenData,
      },
      {
        timeout: 180000, // 3 minute timeout for Grok with live search
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to generate topic');
    }

    const result: GrokGenerationOutput = {
      topic: response.data.topic,
      userPrompt: response.data.userPrompt,
      influencerSpecs: response.data.influencerSpecs,
    };

    logger.info(`✅ Python backend generated topic: "${result.topic}"`);
    return result;

  } catch (error: any) {
    logger.error(`❌ Error calling Python AI backend: ${error.message}`);
    throw error;
  }
}

/**
 * Get connected platforms for an account
 */
async function getConnectedPlatforms(accountId: number): Promise<string[]> {
  const platforms: string[] = [];

  try {
    const twitterRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const instagramRepo = AppDataSource.getRepository(DvybInstagramConnection);
    const linkedinRepo = AppDataSource.getRepository(DvybLinkedInConnection);

    const [twitter, instagram, linkedin] = await Promise.all([
      twitterRepo.findOne({ where: { accountId } }),
      instagramRepo.findOne({ where: { accountId } }),
      linkedinRepo.findOne({ where: { accountId } }),
    ]);

    if (twitter?.oauth2AccessToken) platforms.push('twitter');
    if (instagram?.accessToken) platforms.push('instagram');
    if (linkedin?.accessToken) platforms.push('linkedin');

  } catch (error: any) {
    logger.error(`❌ Error getting connected platforms for account ${accountId}: ${error.message}`);
  }

  return platforms;
}

/**
 * Get usage limits and current usage for an account
 */
async function getAccountUsage(accountId: number): Promise<{
  imageLimit: number;
  videoLimit: number;
  imagesUsed: number;
  videosUsed: number;
  imagesRemaining: number;
  videosRemaining: number;
}> {
  const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
  const planRepo = AppDataSource.getRepository(DvybPricingPlan);
  const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);

  // Get current plan
  const accountPlan = await accountPlanRepo.findOne({
    where: { accountId, status: 'active' },
    order: { createdAt: 'DESC' },
  });

  let imageLimit = 0;
  let videoLimit = 0;

  if (accountPlan) {
    const plan = await planRepo.findOne({ where: { id: accountPlan.planId } });
    if (plan) {
      if (accountPlan.selectedFrequency === 'monthly') {
        imageLimit = plan.monthlyImageLimit;
        videoLimit = plan.monthlyVideoLimit;
      } else {
        imageLimit = plan.annualImageLimit;
        videoLimit = plan.annualVideoLimit;
      }
    }
  }

  // Get current usage
  const generations = await generatedContentRepo.find({
    where: { accountId, status: 'completed' },
  });

  let imagesUsed = 0;
  let videosUsed = 0;

  for (const gen of generations) {
    if (gen.generatedImageUrls) {
      imagesUsed += gen.generatedImageUrls.filter((url: string | null) => url != null).length;
    }
    if (gen.generatedVideoUrls) {
      videosUsed += gen.generatedVideoUrls.filter((url: string | null) => url != null).length;
    }
  }

  return {
    imageLimit,
    videoLimit,
    imagesUsed,
    videosUsed,
    imagesRemaining: Math.max(0, imageLimit - imagesUsed),
    videosRemaining: Math.max(0, videoLimit - videosUsed),
  };
}

/**
 * Process an auto-generation job
 */
async function processAutoGeneration(job: Job<AutoGenerationJobData>): Promise<void> {
  const { accountId } = job.data;
  
  logger.info(`🤖 Processing auto-generation for account ${accountId}`);
  
  const accountRepo = AppDataSource.getRepository(DvybAccount);
  const contextRepo = AppDataSource.getRepository(DvybContext);
  const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);

  try {
    // Load account
    const account = await accountRepo.findOne({ where: { id: accountId } });
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Update status to generating
    account.autoGenerationStatus = 'generating';
    await accountRepo.save(account);

    // Check if account is still active
    if (!account.isActive) {
      logger.info(`⏭️ Account ${accountId} is inactive, skipping auto-generation`);
      account.autoGenerationStatus = 'skipped';
      await accountRepo.save(account);
      return;
    }

    // Check if auto-generation is still enabled
    if (!account.autoGenerationEnabled) {
      logger.info(`⏭️ Auto-generation disabled for account ${accountId}, skipping`);
      account.autoGenerationStatus = 'skipped';
      await accountRepo.save(account);
      return;
    }

    // Load context
    const context = await contextRepo.findOne({ where: { accountId } });
    if (!context) {
      throw new Error(`Context not found for account ${accountId}`);
    }

    // Check usage limits
    const usage = await getAccountUsage(accountId);
    logger.info(`📊 Account ${accountId} usage: Images ${usage.imagesUsed}/${usage.imageLimit}, Videos ${usage.videosUsed}/${usage.videoLimit}`);

    // Determine what to generate based on limits
    let numberOfImages = 0;
    let numberOfVideos = 0;

    // Default: 1 image + 1 video on weekdays
    if (usage.imagesRemaining >= 1 && usage.videosRemaining >= 1) {
      numberOfImages = 1;
      numberOfVideos = 1;
    } else if (usage.videosRemaining === 0 && usage.imagesRemaining > 0) {
      // Video limit exhausted, generate up to 2 images
      numberOfImages = Math.min(2, usage.imagesRemaining);
      numberOfVideos = 0;
    } else if (usage.imagesRemaining === 0 && usage.videosRemaining > 0) {
      // Image limit exhausted, generate up to 2 videos
      numberOfImages = 0;
      numberOfVideos = Math.min(2, usage.videosRemaining);
    } else {
      // Both limits exhausted
      logger.info(`⏭️ Account ${accountId} has no remaining limits, skipping`);
      account.autoGenerationStatus = 'skipped';
      account.lastAutoGenerationDate = new Date();
      await accountRepo.save(account);
      return;
    }

    const totalPosts = numberOfImages + numberOfVideos;
    logger.info(`🎯 Will generate ${numberOfImages} images + ${numberOfVideos} videos = ${totalPosts} posts`);

    // Get connected platforms
    let platforms = await getConnectedPlatforms(accountId);
    
    // If no platforms connected, default to Twitter so content still gets generated
    // Users can connect their platforms later and post the generated content
    if (platforms.length === 0) {
      logger.warn(`⚠️ Account ${accountId} has no connected platforms, defaulting to Twitter`);
      platforms = ['twitter'];
    } else {
    logger.info(`📱 Connected platforms: ${platforms.join(', ')}`);
    }

    // Get previous generations for topic diversity
    const previousGenerations = await generatedContentRepo.find({
      where: { accountId, status: 'completed' },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const previousGenData = previousGenerations.map(gen => ({
      topic: gen.topic || '',
      platformTexts: gen.platformTexts,
    }));

    // Get documents with 10-day decay (same as links)
    const documentsText: Array<{ name: string; text: string; timestamp: string; url?: string }> = [];
    if (context.documentsText && Array.isArray(context.documentsText)) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 10);

      for (const doc of context.documentsText) {
        if (doc.timestamp) {
          const docDate = new Date(doc.timestamp);
          if (docDate >= cutoffDate) {
            documentsText.push(doc);
          }
        }
      }
    }

    // Call Python AI backend (which uses Grok) to generate topic and instructions
    logger.info(`🤖 Calling Python AI backend to generate topic and instructions...`);
    const grokOutput = await generateTopicWithGrok(accountId, context, previousGenData, documentsText);

    // Build user prompt with influencer specs
    const enhancedUserPrompt = `${grokOutput.userPrompt}

INFLUENCER/MODEL SPECIFICATIONS:
- Ethnicity: ${grokOutput.influencerSpecs.ethnicity}
- Skin Color: ${grokOutput.influencerSpecs.skinColor}
- Age Range: ${grokOutput.influencerSpecs.ageRange}
- Hair Style: ${grokOutput.influencerSpecs.hairStyle}
- Hair Color: ${grokOutput.influencerSpecs.hairColor}
- Environment: ${grokOutput.influencerSpecs.environment}
- Ambience/Mood: ${grokOutput.influencerSpecs.ambience}`;

    // Call Python AI backend for content generation
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8001';
    
    logger.info(`📤 Calling Python backend for content generation...`);
    logger.info(`   Topic: ${grokOutput.topic}`);
    logger.info(`   Platforms: ${platforms.join(', ')}`);
    logger.info(`   Images: ${numberOfImages}, Videos: ${numberOfVideos}`);

    const generationResponse = await axios.post(
      // Use the same Python endpoint as the manual "Generate Content Now" flow
      `${pythonBackendUrl}/api/dvyb/adhoc/generate`,
      {
        account_id: accountId,
        topic: grokOutput.topic,
        platforms: platforms,
        number_of_posts: totalPosts,
        number_of_images: numberOfImages,
        number_of_videos: numberOfVideos,
        user_prompt: enhancedUserPrompt,
        user_images: null,
        inspiration_links: null,
        video_length_mode: 'standard',  // NEW: Default to standard (16s) for auto-generation
        generation_type: 'auto',  // Mark as auto-generated for admin approval workflow
      },
      {
        timeout: 600000, // 10 minutes timeout
      }
    );

    if (generationResponse.data.success) {
      logger.info(`✅ Auto-generation started for account ${accountId}`);
      logger.info(`   Job ID: ${generationResponse.data.job_id}`);
      logger.info(`   UUID: ${generationResponse.data.uuid}`);

      // Update account status
      account.autoGenerationStatus = 'completed';
      account.lastAutoGenerationDate = new Date();
      account.lastAutoGenerationError = null;
      account.autoGenerationRetryCount = 0;
      await accountRepo.save(account);
    } else {
      throw new Error(generationResponse.data.error || 'Unknown error from Python backend');
    }

  } catch (error: any) {
    logger.error(`❌ Error in auto-generation for account ${accountId}: ${error.message}`);

    // Update account with error
    try {
      const account = await accountRepo.findOne({ where: { id: accountId } });
      if (account) {
        account.autoGenerationStatus = 'failed';
        account.lastAutoGenerationError = error.message;
        account.autoGenerationRetryCount = (account.autoGenerationRetryCount || 0) + 1;
        await accountRepo.save(account);
      }
    } catch (saveError: any) {
      logger.error(`❌ Failed to update account error status: ${saveError.message}`);
    }

    throw error;
  }
}

/**
 * Create BullMQ worker to process auto-generation jobs
 */
export const dvybAutoGenerationWorker = new Worker(
  QUEUE_NAME,
  async (job: Job<AutoGenerationJobData>) => {
    logger.info(`🔄 Auto-generation worker processing job ${job.id} for account ${job.data.accountId}`);
    await processAutoGeneration(job);
  },
  {
    connection: redisConfig,
    concurrency: 2, // Process 2 accounts at a time to limit server load
    limiter: {
      max: 5,
      duration: 60000, // Max 5 jobs per minute
    },
  }
);

// Worker event handlers
dvybAutoGenerationWorker.on('completed', (job: Job) => {
  logger.info(`✅ Auto-generation job ${job.id} completed for account ${job.data.accountId}`);
});

dvybAutoGenerationWorker.on('failed', (job: Job | undefined, err: Error) => {
  logger.error(`❌ Auto-generation job ${job?.id} failed for account ${job?.data?.accountId}: ${err.message}`);
});

dvybAutoGenerationWorker.on('error', (err: Error) => {
  logger.error(`❌ Auto-generation worker error: ${err.message}`);
});

dvybAutoGenerationWorker.on('ready', () => {
  logger.info('✅ DVYB Auto-generation worker is ready and listening for jobs');
});

/**
 * Queue an auto-generation job for an account
 */
export async function queueAutoGeneration(accountId: number, delayMs: number): Promise<void> {
  try {
    const scheduledTime = new Date(Date.now() + delayMs).toISOString();
    
    logger.info(`📅 Queueing auto-generation for account ${accountId}`);
    logger.info(`⏰ Scheduled for: ${scheduledTime} (delay: ${delayMs}ms)`);

    const job = await dvybAutoGenerationQueue.add(
      `auto-gen-${accountId}-${Date.now()}`,
      { accountId, scheduledTime },
      { delay: delayMs }
    );

    logger.info(`✅ Auto-generation job ${job.id} queued for account ${accountId}`);

    // Log queue status
    const delayedCount = await dvybAutoGenerationQueue.getDelayedCount();
    const activeCount = await dvybAutoGenerationQueue.getActiveCount();
    logger.info(`📊 Auto-generation queue: ${delayedCount} delayed, ${activeCount} active`);

  } catch (error: any) {
    logger.error(`❌ Error queueing auto-generation for account ${accountId}: ${error.message}`);
    throw error;
  }
}

/**
 * Get queue status
 */
export async function getAutoGenerationQueueStatus(): Promise<{
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
}> {
  return {
    waiting: await dvybAutoGenerationQueue.getWaitingCount(),
    delayed: await dvybAutoGenerationQueue.getDelayedCount(),
    active: await dvybAutoGenerationQueue.getActiveCount(),
    completed: await dvybAutoGenerationQueue.getCompletedCount(),
    failed: await dvybAutoGenerationQueue.getFailedCount(),
  };
}

