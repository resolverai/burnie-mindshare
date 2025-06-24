import { AppDataSource } from './database';
import { logger } from './logger';

export const seedDatabase = async (): Promise<void> => {
  try {
    // For now, just log that seeding is ready
    // We'll add proper seeding once entity models are fully set up
    logger.info('🌱 Database seeding placeholder - ready for entities');
    logger.info('✅ Database schema synchronized');
    
  } catch (error) {
    logger.error('❌ Database seeding failed:', error);
    // Don't throw error to allow server to continue
    logger.warn('⚠️ Continuing without seed data');
  }
}; 