import 'reflect-metadata';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { env } from './config/env';
import { logger } from './config/logger';
import { initializeDatabase, closeDatabase, startDatabaseKeepalive } from './config/database';
import { initializeRedis, closeRedis } from './config/redis';
import { healthRoutes } from './routes/health';
import { minerRoutes } from './routes/miners';
import { campaignRoutes } from './routes/campaigns';
import { projectRoutes } from './routes/projects';
import { projectAuthRoutes, projectAuthStatusRoutes } from './routes/projectAuth';
import { projectContextRoutes } from './routes/projectContext';
import { projectContentRoutes } from './routes/projectContent';
import { projectStorageRoutes } from './routes/projectStorage';
import { projectConfigurationsRoutes } from './routes/projectConfigurations';
import { projectTwitterAuthRoutes } from './routes/projectTwitterAuth';
import { projectTwitterPostingRoutes } from './routes/projectTwitterPosting';
import { projectScheduleRoutes } from './routes/projectSchedule';
import { submissionRoutes } from './routes/submissions';
import { analyticsRoutes } from './routes/analytics';
import miningRoutes from './routes/mining';
import marketplaceRoutes from './routes/marketplace';
import { adminRoutes } from './routes/admin';
import adminSnapshotsRoutes from './routes/adminSnapshots';
import agentRoutes from './routes/agents';
import twitterAuthRoutes from './routes/twitter-auth';
import yapperTwitterAuthRoutes from './routes/yapper-twitter-auth';
import oauth1AuthRoutes from './routes/oauth1Auth';
import twitterQueueRoutes from './routes/twitterQueue';
import yapperProfileRoutes from './routes/yapperProfiles';
import leaderboardYapperRoutes from './routes/leaderboardYapper';
import usersRoutes from './routes/users';
import campaignMindshareRoutes from './routes/campaignMindshare';
import intelligenceRoutes from './routes/intelligence';
import platformYapperCronRoutes from './routes/platformYapperCron';
import platformYapperDataRoutes from './routes/platformYapperData';
import twitterLearningAnalysisRoutes from './routes/twitterLearningAnalysis';
import carouselRoutes from './routes/carousel';
import filterOptionsRoutes from './routes/filterOptions';
import referralRoutes from './routes/referrals';
import rewardsRoutes from './routes/rewards';
import season2RewardsRoutes from './routes/season2Rewards';
import waitlistRoutes from './routes/waitlist';
import twitterPostingRoutes from './routes/twitterPosting';
import executionRoutes from './routes/execution';
import yapperInterfaceRoutes from './routes/yapperInterface';
import contentApprovalRoutes from './routes/contentApproval';
import textOnlyRegenerationRoutes from './routes/textOnlyRegeneration';
import contentRequestRoutes from './routes/contentRequestRoutes';
import hotCampaignsRoutes from './routes/hotCampaigns';
import adminContentApprovalsRoutes from './routes/adminContentApprovals';
import dedicatedMinerExecutionsRoutes from './routes/dedicatedMinerExecutions';
import adminDvybAccountsRoutes from './routes/adminDvybAccounts';
import adminDvybAutomatedContentRoutes from './routes/adminDvybAutomatedContent';
import adminDvybPlansRoutes from './routes/adminDvybPlans';
import adminDvybUpgradeRequestsRoutes from './routes/adminDvybUpgradeRequests';
import adminDvybInspirationsRoutes from './routes/adminDvybInspirations';
import adminDvybPromosRoutes from './routes/adminDvybPromos';
import approvedMinersRoutes from './routes/approvedMiners';
import twitterHandlesRoutes from './routes/twitterHandles';
import editTweetRoutes from './routes/editTweet';
import userTwitterPostsRoutes from './routes/userTwitterPosts';
import videoAnalyticsRoutes from './routes/videoAnalytics';
import web2AuthRoutes from './routes/web2Auth';
import web2AccountsRoutes from './routes/web2Accounts';
import web2BrandContextRoutes from './routes/web2BrandContext';
import web2SocialConnectionsRoutes from './routes/web2SocialConnections';
import web2AccountConfigurationsRoutes from './routes/web2AccountConfigurations';
import web2AccountConnectionsRoutes from './routes/web2AccountConnections';
import web2ContextManagementRoutes from './routes/web2ContextManagement';
const web2GeneratedContentRoutes = require('./routes/web2GeneratedContent');
import dvybAuthRoutes from './routes/dvybAuth';
import dvybAccountRoutes from './routes/dvybAccount';
import dvybContextRoutes from './routes/dvybContext';
import dvybUploadRoutes from './routes/dvybUpload';
import dvybUpgradeRequestsRoutes from './routes/dvybUpgradeRequests';
import dvybTopicsRoutes from './routes/dvybTopics';
import dvybGenerationRoutes from './routes/dvybGeneration';
import dvybAdhocGenerationRoutes from './routes/dvybAdhocGeneration';
import dvybCaptionsRoutes from './routes/dvybCaptions';
import dvybImageEditsRoutes from './routes/dvybImageEdits';
import dvybImageRegenerationRoutes from './routes/dvybImageRegeneration';
import dvybSubscriptionRoutes from './routes/dvybSubscription';
import stripeWebhookRoutes from './routes/stripeWebhook';
import dvybDashboardRoutes from './routes/dvybDashboard';
import dvybPostingRoutes from './routes/dvybPosting';
import dvybInternalRoutes from './routes/dvybInternal';
import dvybAnalyticsRoutes from './routes/dvybAnalytics';
import dvybContentLibraryRoutes from './routes/dvybContentLibrary';
import { dvybContentStrategyRoutes } from './routes/dvybContentStrategy';
import dvybScheduleDebugRoutes from './routes/dvybScheduleDebug';
import dvybSocialAuthRoutes from './routes/dvybSocialAuth';
import dvybOAuth1AuthRoutes from './routes/dvybOAuth1Auth';
import dvybInspirationsRoutes from './routes/dvybInspirations';
import cacheRoutes from './routes/cache';
import s3PresignedRoutes from './routes/s3Presigned';
import networkRoutes from './routes/networkRoutes';
import miningContextRoutes from './routes/miningContext';
import { scheduledCleanupService } from './services/ScheduledCleanupService';
import { twitterQueueCronService } from './services/TwitterQueueCronService';
import { platformYapperCronService } from './services/PlatformYapperCronService';
import { scheduledPostCronService } from './services/ScheduledPostCronService';
import { scheduledPostWorker, scheduledPostQueue } from './services/ScheduledPostQueueService';
import { dvybScheduledPostWorker, dvybScheduledPostQueue } from './services/DvybScheduledPostQueueService';
import { dvybAutoGenerationCronService } from './services/DvybAutoGenerationCronService';
import { dvybAutoGenerationWorker, dvybAutoGenerationQueue } from './services/DvybAutoGenerationQueueService';
import { inspirationAnalysisWorker } from './services/InspirationAnalysisQueueService';
// DISABLED: Commented out to prevent automatic fetching of latest tweets data
// import { PopularTwitterHandlesCronService } from './services/PopularTwitterHandlesCronService';
import { AppDataSource } from './config/database';
import { ContentMarketplace } from './models/ContentMarketplace';

const app = express();
const server = createServer(app);

// Global middleware
// Configure helmet for development - allow cross-origin requests
if (env.api.nodeEnv === 'development') {
  app.use(helmet({
    crossOriginResourcePolicy: false, // Disable to allow cross-origin requests
    contentSecurityPolicy: false, // Disable CSP in development
  }));
} else {
  app.use(helmet()); // Use default secure settings in production
}
app.use(compression());

// CORS configuration - ALWAYS use environment variables only
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check against configured allowed origins from environment only
    if (env.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check for nodeops.network subdomains
    if (origin.endsWith('.nodeops.network')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-DVYB-Account-ID'],
  exposedHeaders: ['X-Total-Count'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(cookieParser()); // Parse cookies for session management

// Stripe webhook must come BEFORE express.json() to receive raw body for signature verification
app.use('/api/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Handle preflight requests for all routes
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  // Only set origin header if it's in our allowed origins or nodeops.network subdomain
  if (origin && (env.cors.allowedOrigins.includes(origin) || origin.endsWith('.nodeops.network'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-DVYB-Account-ID');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// API Routes
app.use('/health', healthRoutes); // Direct health endpoint for frontend
app.use('/api/health', healthRoutes);
app.use('/api/miners', minerRoutes);
app.use('/api/campaigns', campaignRoutes);
// Mount Season 2 rewards routes before projects routes to avoid route conflicts
// (somnia-whitelisted route must be matched before :id routes in projectRoutes)
app.use('/api', season2RewardsRoutes); // Season 2 rewards and leaderboard routes
// Mount projectAuthStatusRoutes BEFORE projectRoutes to avoid route conflicts
// (my-project route must be matched before :id routes)
app.use('/api/projects', projectAuthStatusRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectAuthRoutes);
app.use('/api/projects', projectContextRoutes);
app.use('/api/projects', projectContentRoutes);
app.use('/api/projects', projectStorageRoutes);
app.use('/api/projects', projectConfigurationsRoutes);
app.use('/api/projects', projectTwitterAuthRoutes);
app.use('/api/projects', projectTwitterPostingRoutes);
app.use('/api/projects', projectScheduleRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/marketplace', marketplaceRoutes); // MVP Marketplace for content bidding
app.use('/api/admin', adminRoutes); // Admin routes
app.use('/api/admin/snapshots', adminSnapshotsRoutes); // Admin snapshot management routes
app.use('/api/twitter-queue', twitterQueueRoutes);
app.use('/api/yapper-profiles', yapperProfileRoutes); // Twitter fetch queue management
app.use('/api/leaderboard-yapper', leaderboardYapperRoutes); // Leaderboard yapper data management
app.use('/api/users', usersRoutes); // User profile management
app.use('/api/campaign-mindshare', campaignMindshareRoutes); // Campaign mindshare and sentiment data
app.use('/api/intelligence', intelligenceRoutes); // ML intelligence and training data endpoints
app.use('/api/platform-yapper-cron', platformYapperCronRoutes); // Platform yapper cron management
app.use('/api', platformYapperDataRoutes); // Platform yapper data storage
app.use('/api', twitterLearningAnalysisRoutes); // Twitter learning LLM analysis
app.use('/api/agents', agentRoutes); // Agent routes
app.use('/api/twitter-auth', twitterAuthRoutes); // Twitter auth routes for miners
app.use('/api/yapper-twitter-auth', yapperTwitterAuthRoutes); // Twitter auth routes for yappers
app.use('/api/auth/twitter/oauth1', oauth1AuthRoutes); // OAuth 1.0a routes for video uploads
app.use('/api/carousel', carouselRoutes); // Carousel data for hero banner
app.use('/api/filter-options', filterOptionsRoutes); // Filter options for platforms and projects
app.use('/api/referrals', referralRoutes); // Referral system routes
app.use('/api/rewards', rewardsRoutes); // Rewards and leaderboard routes
app.use('/api/waitlist', waitlistRoutes); // Waitlist management routes
app.use('/api/network', networkRoutes); // Network selection and Somnia integration routes
app.use('/api/mining-context', miningContextRoutes); // Mining context management for user-controlled campaign context
app.use('/api/twitter', twitterPostingRoutes); // Twitter posting and management routes
app.use('/api/execution', executionRoutes); // Execution tracking for yapper interface
app.use('/api/yapper-interface', yapperInterfaceRoutes); // Yapper interface content generation
app.use('/api/content-approval', contentApprovalRoutes); // Content approval and biddable marking
app.use('/api/text-only-regeneration', textOnlyRegenerationRoutes); // Text-only content regeneration
app.use('/api', contentRequestRoutes); // Content request management
app.use('/api', hotCampaignsRoutes); // Hot campaigns for miner mode
app.use('/api', adminContentApprovalsRoutes); // Admin content approvals for miner mode
app.use('/api', dedicatedMinerExecutionsRoutes); // Dedicated miner execution tracking
app.use('/api', approvedMinersRoutes); // Approved miners management
app.use('/api/admin/twitter-handles', twitterHandlesRoutes); // Twitter handles management
app.use('/api/admin/dvyb-accounts', adminDvybAccountsRoutes); // DVYB accounts management
app.use('/api/admin/dvyb-automated-content', adminDvybAutomatedContentRoutes); // DVYB auto-generated content approval management
app.use('/api/admin/dvyb-plans', adminDvybPlansRoutes); // DVYB pricing plans management
app.use('/api/admin/dvyb-upgrade-requests', adminDvybUpgradeRequestsRoutes); // DVYB upgrade requests management
app.use('/api/admin/dvyb-inspirations', adminDvybInspirationsRoutes); // DVYB inspiration links management
app.use('/api/admin/dvyb-promos', adminDvybPromosRoutes); // DVYB promo codes management
app.use('/api/edit-tweet', editTweetRoutes); // Edit tweet functionality with avatar fusion
app.use('/api/user-twitter-posts', userTwitterPostsRoutes); // User Twitter posts tracking and engagement
app.use('/api', videoAnalyticsRoutes); // Video analytics and performance metrics
app.use('/api/web2-auth', web2AuthRoutes); // Web2 authentication (Twitter OAuth)
app.use('/api/web2-accounts', web2AccountsRoutes); // Web2 account management
app.use('/api/web2-account-context', web2BrandContextRoutes); // Web2 account context management
app.use('/api/web2-context', web2ContextManagementRoutes); // Web2 context management (new comprehensive system)
app.use('/api/web2-social', web2SocialConnectionsRoutes); // Web2 social media connections
app.use('/api/web2-account-configurations', web2AccountConfigurationsRoutes); // Web2 account configuration settings
app.use('/api/web2-account-connections', web2AccountConnectionsRoutes); // Web2 social media connection management
app.use('/api/web2-generated-content', web2GeneratedContentRoutes); // Web2 generated content management
app.use('/api/dvyb/auth', dvybAuthRoutes); // DVYB authentication routes
app.use('/api/dvyb/auth', dvybSocialAuthRoutes); // DVYB social media OAuth routes (Instagram, LinkedIn, TikTok)
app.use('/api/dvyb/auth/oauth1', dvybOAuth1AuthRoutes); // DVYB OAuth1 routes for Twitter video uploads
app.use('/api/dvyb/account', dvybAccountRoutes); // DVYB account management
app.use('/api/dvyb/context', dvybContextRoutes); // DVYB context management
app.use('/api/dvyb/upload', dvybUploadRoutes); // DVYB file upload routes
app.use('/api/dvyb/upgrade-requests', dvybUpgradeRequestsRoutes); // DVYB upgrade requests
app.use('/api/dvyb/topics', dvybTopicsRoutes); // DVYB topic generation
app.use('/api/dvyb/analytics', dvybAnalyticsRoutes); // DVYB analytics for home page
app.use('/api/dvyb/dashboard', dvybDashboardRoutes); // DVYB dashboard and analytics
app.use('/api/dvyb/posts', dvybPostingRoutes); // DVYB Twitter posting
app.use('/api/dvyb/internal', dvybInternalRoutes); // DVYB internal routes (Python AI backend)
app.use('/api/dvyb/content-library', dvybContentLibraryRoutes);
app.use('/api/dvyb/content-strategy', dvybContentStrategyRoutes);
app.use('/api/dvyb/debug/schedules', dvybScheduleDebugRoutes); // DVYB content library
app.use('/api/dvyb/adhoc', dvybAdhocGenerationRoutes); // DVYB ad-hoc generation (proxies to Python backend)
app.use('/api/dvyb/captions', dvybCaptionsRoutes); // DVYB user-edited captions
app.use('/api/dvyb/image-edits', dvybImageEditsRoutes); // DVYB image edits (text overlays, emojis, stickers)
app.use('/api/dvyb/image-regeneration', dvybImageRegenerationRoutes); // DVYB image regeneration (AI-based image changes)
app.use('/api/dvyb/subscription', dvybSubscriptionRoutes); // DVYB subscription management (Stripe integration)
app.use('/api/dvyb/inspirations', dvybInspirationsRoutes); // DVYB inspiration matching for onboarding
app.use('/api/dvyb', dvybGenerationRoutes); // DVYB content generation routes (has /:uuid catch-all, must be last)
app.use('/api/cache', cacheRoutes); // Redis URL cache management
app.use('/api/s3', s3PresignedRoutes); // S3 presigned URL generation (local TypeScript service)

// Start server
const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Start database keepalive
    startDatabaseKeepalive();

    // Start purchase flow cleanup job - only after database is fully initialized
    const startPurchaseFlowCleanup = () => {
      // Wait for database to be fully ready before starting cleanup
      const checkAndStartCleanup = () => {
        if (AppDataSource.isInitialized) {
          logger.info('🔄 Starting purchase flow cleanup service...');
          
          setInterval(async () => {
            try {
              // Double-check database connection before each cleanup
              if (AppDataSource.isInitialized) {
                await AppDataSource.query('SELECT 1'); // Test connection
                
                const contentRepository = AppDataSource.getRepository(ContentMarketplace);
                
                // Find and reset expired purchase flows
                const expiredFlows = await contentRepository
                  .createQueryBuilder('content')
                  .where('content.inPurchaseFlow = :inPurchaseFlow', { inPurchaseFlow: true })
                  .getMany();
                
                if (expiredFlows.length > 0) {
                  for (const content of expiredFlows) {
                    content.inPurchaseFlow = false;
                    content.purchaseFlowInitiatedBy = null;
                    content.purchaseFlowInitiatedAt = null;
                    await contentRepository.save(content);
                  }
                  
                  logger.info(`🔄 Cleaned up ${expiredFlows.length} expired purchase flows`);
                }
              }
            } catch (error) {
              logger.error('❌ Purchase flow cleanup failed:', error);
              // Don't crash the service, just log the error
            }
          }, 5 * 60 * 1000); // Run every 5 minutes
        } else {
          // Database not ready yet, retry in 5 seconds
          logger.info('⏳ Database not ready yet, retrying purchase flow cleanup setup in 5 seconds...');
          setTimeout(checkAndStartCleanup, 5000);
        }
      };
      
      // Start the check process
      checkAndStartCleanup();
    };

    startPurchaseFlowCleanup();
    
    await initializeRedis();
    
    // Initialize mining service (but don't start it automatically to prevent high CPU usage)
    const { MiningService } = await import('./services/MiningService');
    const miningService = MiningService.getInstance();
    // miningService.startMining(); // DISABLED: Can cause high CPU and memory usage
    
    // Start scheduled file cleanup service
    scheduledCleanupService.start();
    logger.info('🧹 File cleanup service started');
    
    // Start Twitter queue processing cron service
    twitterQueueCronService.start();
    logger.info('🐦 Twitter queue cron service started');
    
    // Start scheduled post cron service and workers
    // Note: Workers are created when modules are imported, but we verify they're ready
    logger.info('👷 Scheduled post workers status check...');
    logger.info('   - Web3 scheduled post worker: ready');
    logger.info('   - DVYB scheduled post worker: ready');
    scheduledPostCronService.start();
    logger.info('📅 Scheduled post cron service started');
    
    // Start DVYB auto-generation cron service and workers
    logger.info('🤖 DVYB auto-generation worker status check...');
    logger.info('   - DVYB auto-generation worker: ready');
    dvybAutoGenerationCronService.start();
    logger.info('🤖 DVYB auto-generation cron service started');
    
    // Verify worker is ready (wait a bit for Redis connection)
    setTimeout(async () => {
      try {
        const waitingCount = await scheduledPostQueue.getWaitingCount();
        const delayedCount = await scheduledPostQueue.getDelayedCount();
        logger.info(`📊 Scheduled post queue status: ${waitingCount} waiting, ${delayedCount} delayed`);
        
        // Also check auto-generation queue
        const autoGenDelayed = await dvybAutoGenerationQueue.getDelayedCount();
        const autoGenActive = await dvybAutoGenerationQueue.getActiveCount();
        logger.info(`📊 Auto-generation queue status: ${autoGenDelayed} delayed, ${autoGenActive} active`);
      } catch (error: any) {
        logger.warn(`⚠️ Could not check queue status: ${error.message}`);
      }
    }, 2000);
    
    // Start popular Twitter handles cron service
    // DISABLED: Commented out to prevent automatic fetching of latest tweets data
    // const popularTwitterHandlesCronService = new PopularTwitterHandlesCronService();
    // popularTwitterHandlesCronService.start();
    // logger.info('🐦 Popular Twitter handles cron service started');
    
    // Start platform yapper Twitter data collection cron service
    // DISABLED: Integrated into reconnect flow instead
    // platformYapperCronService.start();
    // logger.info('👥 Platform yapper cron service started');
    
    // Make mining service available globally for routes
    (global as any).miningService = miningService;
    
    server.listen(env.api.port, env.api.host, () => {
      logger.info(`🚀 RoastPower Backend running on ${env.api.host}:${env.api.port}`);
      logger.info(`🌍 Environment: ${env.api.nodeEnv}`);
      logger.info(`📡 WebSocket enabled on port ${env.api.port}`);
      logger.info(`🔗 CORS origins: ${env.cors.allowedOrigins.join(', ')}`);
      logger.info(`📋 Available endpoints:`);
      logger.info(`   GET  /api/health`);
      logger.info(`   GET  /api/analytics/dashboard`);
      logger.info(`   GET  /api/campaigns/active`);
      logger.info(`   GET  /api/campaigns?page=1&size=10`);
      logger.info(`   GET  /api/projects?page=1&size=10`);
      logger.info(`   POST /api/miners/register`);
      logger.info(`   GET  /api/miners`);
      logger.info(`   POST /api/submissions`);
      logger.info(`   GET  /api/mining/block-status`);
      logger.info(`   GET  /api/mining/schedule`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`🔄 Received ${signal}. Starting graceful shutdown...`);
  logger.info(`📊 Process stats at shutdown - PID: ${process.pid}, Uptime: ${Math.floor(process.uptime())}s`);
  
  try {
    // Stop cron services
    twitterQueueCronService.stop();
    // platformYapperCronService.stop(); // DISABLED: Service not started
    scheduledCleanupService.stop();
    scheduledPostCronService.stop();
    dvybAutoGenerationCronService.stop();
    // Close scheduled post workers
    await scheduledPostWorker.close();
    await dvybScheduledPostWorker.close();
    await dvybAutoGenerationWorker.close();
    await inspirationAnalysisWorker.close();
    logger.info('⏹️ Cron services and workers stopped');
    
    // Close server
    server.close(() => {
      logger.info('📴 HTTP server closed');
    });
    
    // Close database connection
    await closeDatabase();
    
    // Close Redis connection
    await closeRedis();
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process for unhandled rejections in development
  if (env.api.nodeEnv === 'production') {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle memory warnings
process.on('warning', (warning) => {
  logger.warn('⚠️ Process Warning:', warning.name, warning.message);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); 