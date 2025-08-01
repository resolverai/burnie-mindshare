#!/usr/bin/env node

import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { TwitterLearningService } from '../services/TwitterLearningService';
import { logger } from '../config/logger';

/**
 * Background job for continuous Twitter learning
 * This job runs continuously to analyze connected Twitter accounts
 * and update personalized agent configurations for all users
 */
class TwitterLearningJob {
  private twitterLearningService: TwitterLearningService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.twitterLearningService = new TwitterLearningService();
  }

  /**
   * Start the continuous learning job
   */
  async start(): Promise<void> {
    try {
      logger.info('🚀 Starting Twitter Learning Background Job...');

      // Initialize database connection
      await this.initializeDatabase();

      // Set running flag
      this.isRunning = true;

      // Run initial learning cycle
      await this.runLearningCycle();

      // Schedule recurring learning cycles
      this.scheduleRecurringLearning();

      // Handle graceful shutdown
      this.setupGracefulShutdown();

      logger.info('✅ Twitter Learning Background Job started successfully');
      logger.info('📅 Learning cycles will run every 30 minutes');

    } catch (error) {
      logger.error('❌ Failed to start Twitter Learning Background Job:', error);
      process.exit(1);
    }
  }

  /**
   * Initialize database connection
   */
  private async initializeDatabase(): Promise<void> {
    try {
      if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
        logger.info('✅ Database connection initialized');
      }
    } catch (error) {
      logger.error('❌ Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Run a single learning cycle
   */
  private async runLearningCycle(): Promise<void> {
    try {
      const startTime = Date.now();
      logger.info('🧠 Starting Twitter learning cycle...');

      await this.twitterLearningService.runContinuousLearning();

      const duration = Date.now() - startTime;
      logger.info(`✅ Twitter learning cycle completed in ${duration}ms`);

      // Log memory usage
      const memUsage = process.memoryUsage();
      logger.info(`📊 Memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);

    } catch (error) {
      logger.error('❌ Error in Twitter learning cycle:', error);
      
      // Continue running even if one cycle fails
      // This ensures the job doesn't stop due to temporary errors
    }
  }

  /**
   * Schedule recurring learning cycles
   */
  private scheduleRecurringLearning(): void {
    // Run every 30 minutes
    const intervalMs = 30 * 60 * 1000; // 30 minutes

    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runLearningCycle();
      }
    }, intervalMs);

    logger.info(`⏰ Scheduled recurring learning every ${intervalMs / 1000 / 60} minutes`);
  }

  /**
   * Stop the learning job
   */
  async stop(): Promise<void> {
    try {
      logger.info('🛑 Stopping Twitter Learning Background Job...');

      this.isRunning = false;

      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      // Close database connection
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
        logger.info('✅ Database connection closed');
      }

      logger.info('✅ Twitter Learning Background Job stopped successfully');

    } catch (error) {
      logger.error('❌ Error stopping Twitter Learning Background Job:', error);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`📨 Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }

  /**
   * Get job status
   */
  getStatus(): object {
    return {
      isRunning: this.isRunning,
      hasInterval: !!this.intervalId,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * CLI Interface for running the job
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const learningJob = new TwitterLearningJob();

  switch (command) {
    case 'start':
      await learningJob.start();
      break;

    case 'run-once':
      logger.info('🔄 Running single Twitter learning cycle...');
      await learningJob.start();
      // Run once and exit
      setTimeout(async () => {
        await learningJob.stop();
        process.exit(0);
      }, 5000);
      break;

    case 'status':
      console.log(JSON.stringify(learningJob.getStatus(), null, 2));
      process.exit(0);
      break;

    default:
      console.log('Usage:');
      console.log('  npm run twitter-learning start     # Start continuous learning job');
      console.log('  npm run twitter-learning run-once  # Run single learning cycle');
      console.log('  npm run twitter-learning status    # Get job status');
      process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('💥 Fatal error in Twitter Learning Job:', error);
    process.exit(1);
  });
}

export { TwitterLearningJob }; 