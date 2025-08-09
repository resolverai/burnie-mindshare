import { DataSource } from 'typeorm';
import { env } from './env';
import { logger } from './logger';

// Import all entities
import { User } from '../models/User';
import { Miner } from '../models/Miner';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Submission } from '../models/Submission';
import { Block } from '../models/Block';
import { Reward } from '../models/Reward';
import { SocialAccount } from '../models/SocialAccount';
import { Analytics } from '../models/Analytics';

// Import new entities for multi-agentic system
import { AgentConfiguration } from '../models/AgentConfiguration';
import { MindshareTrainingData } from '../models/MindshareTrainingData';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { BiddingSystem } from '../models/BiddingSystem';
import { PaymentTransaction } from '../models/PaymentTransaction';
import { TwitterLearningData } from '../models/TwitterLearningData';
import { Admin } from '../models/Admin';
import { TwitterUserConnection } from '../models/TwitterUserConnection';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { ContentPurchase } from '../models/ContentPurchase';

// Import seed data functions
import { seedDatabase } from './seedData';

// Create TypeORM DataSource
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.database.host,
  port: env.database.port,
  username: env.database.username,
  password: env.database.password,
  database: env.database.name,
  synchronize: env.database.synchronize, // Auto-create/update tables
  logging: env.database.logging,
  entities: [
    // Original entities
    User,
    Miner,
    Campaign,
    Project,
    Submission,
    Block,
    Reward,
    SocialAccount,
    Analytics,
    // New multi-agentic system entities
    AgentConfiguration,
    MindshareTrainingData,
    ContentMarketplace,
    BiddingSystem,
    PaymentTransaction,
    TwitterLearningData,
    Admin,
    TwitterUserConnection,
    YapperTwitterConnection,
    ContentPurchase,
  ],
  migrations: [],
  subscribers: [],
  cache: {
    duration: 30000, // 30 seconds
  },
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  extra: {
    connectionLimit: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});

// Initialize database connection
export const initializeDatabase = async (): Promise<void> => {
  try {
    logger.info('🗄️ Initializing database connection...');
    logger.info(`📍 Connecting to: ${env.database.host}:${env.database.port}/${env.database.name}`);
    logger.info(`👤 Using credentials: ${env.database.username}${env.database.password ? ' (with password)' : ' (no password)'}`);
    
    // Check if DataSource is already initialized
    if (AppDataSource.isInitialized) {
      logger.info('📋 Database already initialized, skipping...');
      return;
    }
    
    await AppDataSource.initialize();
    logger.info('✅ Database connection established successfully');
    
    // Log entities
    const entityCount = AppDataSource.entityMetadatas.length;
    const entityNames = AppDataSource.entityMetadatas.map(meta => meta.name);
    logger.info(`📊 Loaded ${entityCount} entities: ${entityNames.join(', ')}`);
    
    if (env.database.synchronize) {
      logger.info('🔄 Running database schema synchronization...');
      await AppDataSource.synchronize(false); // false = don't drop existing tables
      logger.info('📋 Database tables synchronized');
      
      // List created tables
      const tables = await AppDataSource.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);
      logger.info(`📋 Database tables: ${tables.map((t: any) => t.table_name).join(', ')}`);
      
      // Seed database with mock data for development
      logger.info('🌱 Seeding database with mock data...');
      await seedDatabase();
      logger.info('✅ Database seeded successfully');
    }
    
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    
    // Log more specific error information
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
      if (error.message.includes('ECONNREFUSED')) {
        logger.error('💡 Tip: Make sure PostgreSQL is running on the specified host and port');
      } else if (error.message.includes('authentication failed')) {
        logger.error('💡 Tip: Check your database username and password');
      } else if (error.message.includes('database') && error.message.includes('does not exist')) {
        logger.error('💡 Tip: Create the database manually or use a different database name');
      }
    }
    
    logger.warn('⚠️ Server will continue with mock data. Database features disabled.');
    
    // In development, continue without database
    // In production, you might want to fail hard
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
};

// Close database connection
export const closeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.destroy();
    logger.info('📴 Database connection closed');
  } catch (error) {
    logger.error('❌ Error closing database connection:', error);
  }
};

// Health check for database
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await AppDataSource.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}; 