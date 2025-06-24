import { AppDataSource } from './database';
import { logger } from './logger';
import { User } from '../models/User';

export const seedDatabase = async (): Promise<void> => {
  try {
    if (!AppDataSource.isInitialized) {
      logger.warn('⚠️ Database not initialized, skipping seed data');
      return;
    }

    const userRepository = AppDataSource.getRepository(User);
    
    // Check if default user already exists
    const existingUser = await userRepository.findOne({ where: { id: 1 } });
    
    if (!existingUser) {
      // Create default user for foreign key constraints
      const defaultUser = userRepository.create({
        walletAddress: '0x0000000000000000000000000000000000000001',
        username: 'admin',
        email: 'admin@roastpower.com',
        isVerified: true,
        isAdmin: true,
        profile: {
          displayName: 'System Admin',
          bio: 'Default system administrator account',
          website: 'https://roastpower.com'
        },
        preferences: {
          notifications: false,
          newsletter: false,
          theme: 'dark',
          language: 'en'
        },
        totalEarnings: 0,
        roastBalance: 0
      });

      await userRepository.save(defaultUser);
      logger.info('✅ Default user created for foreign key constraints');
    } else {
      logger.info('✅ Default user already exists');
    }

    logger.info('🌱 Database seeding completed successfully');
    
  } catch (error) {
    logger.error('❌ Database seeding failed:', error);
    // Don't throw error to allow server to continue
    logger.warn('⚠️ Continuing without seed data');
  }
}; 