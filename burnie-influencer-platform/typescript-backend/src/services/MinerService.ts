import { AppDataSource } from '../config/database';
import { Miner } from '../models/Miner';
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
      const { walletAddress, personality, username, sessionToken } = data;
      
      logger.info('🔧 MinerService.registerMiner called with:', {
        walletAddress,
        personality,
        username,
        hasRepository: !!this.minerRepository
      });

      // If database is available, use it
      if (this.minerRepository) {
        logger.info('💾 Using database for miner registration');
        
        const existingMiner = await this.minerRepository.findOne({
          where: { walletAddress },
        });

        if (existingMiner) {
          logger.info(`🔄 Found existing miner in database: ${existingMiner.id}`);
          return {
            id: existingMiner.id,
            username: existingMiner.username,
            personality: existingMiner.agentPersonality,
            walletAddress: existingMiner.walletAddress,
            roastBalance: existingMiner.roastBalance,
            totalEarnings: existingMiner.totalEarnings,
            submissionCount: existingMiner.submissionCount,
            averageScore: existingMiner.averageScore || 0,
            isActive: existingMiner.isAvailable,
            registeredAt: existingMiner.createdAt,
          };
        }

        // Create new miner
        logger.info('🆕 Creating new miner in database');
        const newMiner = this.minerRepository.create({
          walletAddress,
          agentPersonality: personality as any,
          username: username || `Miner_${walletAddress.slice(-6)}`,
          roastBalance: 1000, // Starting balance
          totalEarnings: 0,
          submissionCount: 0,
          isAvailable: true,
          userId: 1, // TODO: Proper user association
        });

        const savedMiner = await this.minerRepository.save(newMiner);
        logger.info(`✅ New miner saved to database with ID: ${savedMiner.id}`);

        return {
          id: savedMiner.id,
          username: savedMiner.username,
          personality: savedMiner.agentPersonality,
          walletAddress: savedMiner.walletAddress,
          roastBalance: savedMiner.roastBalance,
          totalEarnings: savedMiner.totalEarnings,
          submissionCount: savedMiner.submissionCount,
          averageScore: savedMiner.averageScore || 0,
          isActive: savedMiner.isAvailable,
          registeredAt: savedMiner.createdAt,
        };
      }

      // Fallback to mock data if no database
      logger.warn('⚠️ Database not available, using mock data for miner registration');
      const mockMiner = {
        id: Date.now(),
        username: username || `Miner_${walletAddress.slice(-6)}`,
        personality,
        walletAddress,
        roastBalance: 1000,
        totalEarnings: 0,
        submissionCount: 0,
        averageScore: 0,
        isActive: true,
        registeredAt: new Date().toISOString(),
      };

      logger.info(`🆕 Mock miner created with ID: ${mockMiner.id}`);
      return mockMiner;
    } catch (error) {
      logger.error('❌ Failed to register miner:', error);
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

      // Mock data
      return {
        id,
        username: `SavageRoaster_${id}`,
        personality: 'SAVAGE',
        walletAddress: '0x1234567890abcdef',
        roastBalance: 1500,
        totalEarnings: 2500,
        submissionCount: 42,
        averageScore: 8.7,
        isActive: true,
        registeredAt: new Date(Date.now() - 2592000000).toISOString(),
      };
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

      // Mock data
      const mockMiners = [
        {
          id: 42,
          username: 'SavageRoaster_007',
          personality: 'SAVAGE',
          walletAddress: '0x1234567890abcdef',
          roastBalance: 1500,
          totalEarnings: 12500,
          submissionCount: 234,
          averageScore: 9.1,
          isActive: true,
          registeredAt: new Date(Date.now() - 2592000000).toISOString(),
        },
        {
          id: 17,
          username: 'MemeKing_420',
          personality: 'CHAOTIC',
          walletAddress: '0xabcdef1234567890',
          roastBalance: 800,
          totalEarnings: 9800,
          submissionCount: 189,
          averageScore: 8.8,
          isActive: true,
          registeredAt: new Date(Date.now() - 1728000000).toISOString(),
        },
        {
          id: 73,
          username: 'WittyWriter_101',
          personality: 'WITTY',
          walletAddress: '0x567890abcdef1234',
          roastBalance: 1200,
          totalEarnings: 8900,
          submissionCount: 156,
          averageScore: 8.9,
          isActive: true,
          registeredAt: new Date(Date.now() - 1209600000).toISOString(),
        },
      ];

      // Apply filtering
      let filteredMiners = mockMiners;
      
      if (personality) {
        filteredMiners = filteredMiners.filter(m => 
          m.personality.toLowerCase() === personality.toLowerCase()
        );
      }

      if (status) {
        const isActive = status === 'active';
        filteredMiners = filteredMiners.filter(m => m.isActive === isActive);
      }

      // Apply pagination
      const total = filteredMiners.length;
      const startIndex = (page - 1) * size;
      const endIndex = startIndex + size;
      const paginatedMiners = filteredMiners.slice(startIndex, endIndex);

      return {
        data: paginatedMiners,
        total,
        page,
        size,
        totalPages: Math.ceil(total / size),
      };
    } catch (error) {
      logger.error('❌ Failed to list miners:', error);
      throw error;
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
      // In a real implementation, this would aggregate data from submissions, rewards, etc.
      return {
        totalSubmissions: 234,
        approvedSubmissions: 198,
        rejectedSubmissions: 36,
        averageScore: 8.7,
        totalEarnings: 12500,
        currentStreak: 7,
        rank: 3,
        recentActivity: [
          {
            type: 'submission',
            campaignId: 1,
            score: 9.2,
            timestamp: new Date(Date.now() - 300000).toISOString(),
          },
          {
            type: 'reward',
            amount: 500,
            timestamp: new Date(Date.now() - 600000).toISOString(),
          },
        ],
      };
    } catch (error) {
      logger.error('❌ Failed to get miner stats:', error);
      throw error;
    }
  }
} 