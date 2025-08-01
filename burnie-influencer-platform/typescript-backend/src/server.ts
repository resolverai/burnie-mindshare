import 'reflect-metadata';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import { env } from './config/env';
import { logger } from './config/logger';
import { initializeDatabase, closeDatabase } from './config/database';
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
import agentRoutes from './routes/agents';
import twitterAuthRoutes from './routes/twitter-auth';

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

// CORS configuration - Allow all localhost origins in development
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all localhost origins
    if (env.api.nodeEnv === 'development') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
    }
    
    // Check against configured allowed origins
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Handle preflight requests for all routes
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
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
app.use('/api/agents', agentRoutes); // Agent routes
app.use('/api/twitter-auth', twitterAuthRoutes); // Twitter auth routes

// Start server
const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();
    // await initializeRedis();
    
    // Initialize and start mining service
    const { MiningService } = await import('./services/MiningService');
    const miningService = MiningService.getInstance();
    miningService.startMining();
    
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
  
  try {
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

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); 