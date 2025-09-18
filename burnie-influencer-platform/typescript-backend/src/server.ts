import 'reflect-metadata';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import { env } from './config/env';
import { logger } from './config/logger';
import { initializeDatabase, closeDatabase, startDatabaseKeepalive } from './config/database';
// import { initializeRedis, closeRedis } from './config/redis';
import { healthRoutes } from './routes/health';
import { minerRoutes } from './routes/miners';
import { campaignRoutes } from './routes/campaigns';
import { projectRoutes } from './routes/projects';
import { submissionRoutes } from './routes/submissions';
import { analyticsRoutes } from './routes/analytics';
import miningRoutes from './routes/mining';
import marketplaceRoutes from './routes/marketplace';
import { adminRoutes } from './routes/admin';
import adminSnapshotsRoutes from './routes/adminSnapshots';
import agentRoutes from './routes/agents';
import twitterAuthRoutes from './routes/twitter-auth';
import yapperTwitterAuthRoutes from './routes/yapper-twitter-auth';
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
import approvedMinersRoutes from './routes/approvedMiners';
import twitterHandlesRoutes from './routes/twitterHandles';
import { scheduledCleanupService } from './services/ScheduledCleanupService';
import { twitterQueueCronService } from './services/TwitterQueueCronService';
import { platformYapperCronService } from './services/PlatformYapperCronService';
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
    
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Handle preflight requests for all routes
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  // Only set origin header if it's in our allowed origins
  if (origin && env.cors.allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// API Routes
app.use('/health', healthRoutes); // Direct health endpoint for frontend
app.use('/api/health', healthRoutes);
app.use('/api/miners', minerRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/projects', projectRoutes);
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
app.use('/api/carousel', carouselRoutes); // Carousel data for hero banner
app.use('/api/filter-options', filterOptionsRoutes); // Filter options for platforms and projects
app.use('/api/referrals', referralRoutes); // Referral system routes
app.use('/api/waitlist', waitlistRoutes); // Waitlist management routes
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
    
    // await initializeRedis();
    
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
    logger.info('⏹️ Cron services stopped');
    
    // Close server
    server.close(() => {
      logger.info('📴 HTTP server closed');
    });
    
    // Close database connection
    await closeDatabase();
    
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