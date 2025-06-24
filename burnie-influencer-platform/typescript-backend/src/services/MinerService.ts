import { AppDataSource } from '../config/database';
import { Miner } from '../models/Miner';
import { User } from '../models/User';
import { logger } from '../config/logger';
import { Repository } from 'typeorm';

export class MinerService {
  private minerRepository?: Repository<Miner>;

  constructor() {
    // Initialize repository if database is available
    logger.info('🔧 MinerService constructor called');
    logger.info('📊 AppDataSource.isInitialized:', AppDataSource.isInitialized);
    
    if (AppDataSource.isInitialized) {
      this.minerRepository = AppDataSource.getRepository(Miner);
      logger.info('✅ MinerService: Database repository initialized');
    } else {
      logger.warn('⚠️ MinerService: Database not initialized, will use mock data');
    }
  }

  async registerMiner(data: {
    walletAddress: string;
    personality: string;
    username?: string;
    sessionToken?: string;
  }): Promise<any> {
    try {
      logger.info('🔧 MinerService.registerMiner called with data:', {
        walletAddress: data.walletAddress,
        personality: data.personality,
        username: data.username,
        hasSessionToken: !!data.sessionToken
      });

      if (!this.minerRepository) {
        logger.error('❌ MinerService: Repository not initialized - database not available');
        // Return a mock miner for development when database is not available
        const mockMiner = {
          id: Date.now(), // Use timestamp as unique ID
          username: data.username || `Miner_${data.walletAddress.slice(-6)}`,
          personality: data.personality,
          walletAddress: data.walletAddress,
          roastBalance: 1000,
          totalEarnings: 0,
          submissionCount: 0,
          averageScore: 0,
          isActive: true,
          registeredAt: new Date().toISOString(),
        };
        
        logger.info('✅ Created mock miner (database unavailable):', mockMiner);
        return mockMiner;
      }

      logger.info('📊 Checking for existing miner...');
      // Check if miner already exists
      const existingMiner = await this.minerRepository.findOne({
        where: { walletAddress: data.walletAddress },
      });

      if (existingMiner) {
        logger.info(`🔄 Existing miner found: ${existingMiner.id}`);
        return {
          id: existingMiner.id,
          username: existingMiner.username,
          personality: existingMiner.agentPersonality,
          walletAddress: existingMiner.walletAddress,
          roastBalance: existingMiner.roastBalance,
          totalEarnings: existingMiner.totalEarnings,
          submissionCount: existingMiner.submissionCount,
          averageScore: existingMiner.averageScore,
          isActive: existingMiner.isAvailable,
          registeredAt: existingMiner.createdAt.toISOString(),
        };
      }

      logger.info('👤 Ensuring default user exists for foreign key constraint...');
      // Ensure default user exists for foreign key constraint
      const userRepository = AppDataSource.getRepository(User);
      const defaultUser = await userRepository.findOne({ where: { id: 1 } });
      if (!defaultUser) {
        logger.info('🔧 Creating default user...');
        // Create default user if it doesn't exist
        const newUser = userRepository.create({
          walletAddress: '0x0000000000000000000000000000000000000001',
          username: 'admin',
          email: 'admin@roastpower.com',
          isVerified: true,
          isAdmin: true,
          profile: {
            displayName: 'System Admin',
            bio: 'Default system administrator account',
            website: 'https://roastpower.com'
          }
        });
        await userRepository.save(newUser);
        logger.info('✅ Created default user for miner registration');
      } else {
        logger.info('✅ Default user already exists');
      }

      logger.info('🆕 Creating new miner...');
      // Create new miner
      const minerData = {
        walletAddress: data.walletAddress,
        agentPersonality: data.personality as any,
        username: data.username || `Miner_${Date.now()}`,
        roastBalance: 1000, // Starting balance
        totalEarnings: 0,
        submissionCount: 0,
        averageScore: 0,
        isAvailable: true,
        lastActiveAt: new Date(),
        userId: 1, // TODO: Get from auth context
      };

      logger.info('📝 Miner data to be created:', minerData);

      const newMiner = this.minerRepository.create(minerData);
      logger.info('💾 Saving new miner to database...');
      
      const savedMiner = await this.minerRepository.save(newMiner);
      logger.info(`✅ New miner registered successfully: ${savedMiner.id}`);
      
      const result = {
        id: savedMiner.id,
        username: savedMiner.username,
        personality: savedMiner.agentPersonality,
        walletAddress: savedMiner.walletAddress,
        roastBalance: savedMiner.roastBalance,
        totalEarnings: savedMiner.totalEarnings,
        submissionCount: savedMiner.submissionCount,
        averageScore: savedMiner.averageScore,
        isActive: savedMiner.isAvailable,
        registeredAt: savedMiner.createdAt.toISOString(),
      };

      logger.info('🎉 Returning miner registration result:', result);
      return result;
    } catch (error) {
      logger.error('❌ Failed to register miner - Detailed error:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        walletAddress: data.walletAddress,
        personality: data.personality
      });
      
      // If database error, return mock miner as fallback
      if (error instanceof Error && (
        error.message.includes('database') || 
        error.message.includes('connection') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('relation') ||
        error.message.includes('foreign key')
      )) {
        logger.warn('⚠️ Database error detected, falling back to mock miner');
        const fallbackMiner = {
          id: Date.now(), // Use timestamp as unique ID
          username: data.username || `Miner_${data.walletAddress.slice(-6)}`,
          personality: data.personality,
          walletAddress: data.walletAddress,
          roastBalance: 1000,
          totalEarnings: 0,
          submissionCount: 0,
          averageScore: 0,
          isActive: true,
          registeredAt: new Date().toISOString(),
        };
        
        logger.info('✅ Returning fallback miner:', fallbackMiner);
        return fallbackMiner;
      }
      
      throw error;
    }
  }

  async getMiner(id: number): Promise<any> {
    try {
      if (this.minerRepository) {
        const miner = await this.minerRepository.findOne({
          where: { id },
        });
        
        if (miner) {
          return miner;
        }
      }

      // Return null if not found or no database
      return null;
    } catch (error) {
      logger.error('❌ Failed to get miner:', error);
      throw error;
    }
  }

  async listMiners(options: {
    page?: number;
    size?: number;
    personality?: string;
    status?: string;
  } = {}): Promise<any> {
    try {
      const { page = 1, size = 10, personality, status } = options;

      if (this.minerRepository) {
        const query = this.minerRepository.createQueryBuilder('miner');

        if (personality) {
          query.andWhere('miner.agentPersonality = :personality', { personality });
        }

        if (status) {
          const isAvailable = status === 'active';
          query.andWhere('miner.isAvailable = :isAvailable', { isAvailable });
        }

        const [miners, total] = await query
          .skip((page - 1) * size)
          .take(size)
          .getManyAndCount();

        return {
          data: miners,
          total,
          page,
          size,
          totalPages: Math.ceil(total / size),
        };
      }

      // Return empty result if no database
      return {
        data: [],
        total: 0,
        page: options.page || 1,
        size: options.size || 10,
        totalPages: 0,
      };
    } catch (error) {
      logger.error('❌ Failed to list miners:', error);
      return {
        data: [],
        total: 0,
        page: options.page || 1,
        size: options.size || 10,
        totalPages: 0,
      };
    }
  }

  async updateMinerBalance(minerId: number, amount: number): Promise<void> {
    try {
      if (this.minerRepository) {
        await this.minerRepository.update(minerId, {
          roastBalance: () => `roast_balance + ${amount}`,
        });
      }

      logger.info(`💰 Updated miner ${minerId} balance by ${amount}`);
    } catch (error) {
      logger.error('❌ Failed to update miner balance:', error);
      throw error;
    }
  }

  async getMinerStats(minerId: number): Promise<any> {
    try {
      if (this.minerRepository) {
        // In a real implementation, this would aggregate data from submissions, rewards, etc.
        // For now, return basic stats or calculate from related entities
        const miner = await this.minerRepository.findOne({
          where: { id: minerId },
          relations: ['submissions'],
        });

        if (miner) {
          return {
            totalSubmissions: miner.submissionCount || 0,
            approvedSubmissions: 0, // Calculate from submissions
            rejectedSubmissions: 0, // Calculate from submissions
            averageScore: miner.averageScore || 0,
            totalEarnings: miner.totalEarnings || 0,
            currentStreak: 0, // Calculate from recent submissions
            rank: 0, // Calculate based on performance
            recentActivity: [],
          };
        }
      }

      // Return empty stats if no database or miner not found
      return {
        totalSubmissions: 0,
        approvedSubmissions: 0,
        rejectedSubmissions: 0,
        averageScore: 0,
        totalEarnings: 0,
        currentStreak: 0,
        rank: 0,
        recentActivity: [],
      };
    } catch (error) {
      logger.error('❌ Failed to get miner stats:', error);
      throw error;
    }
  }
} 