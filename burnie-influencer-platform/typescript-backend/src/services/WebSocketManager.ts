import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Miner } from '../models/Miner';
import { Submission } from '../models/Submission';
import { Campaign } from '../models/Campaign';
import { Reward } from '../models/Reward';

export class WebSocketManager {
  private io: SocketIOServer;
  private minerRepository = AppDataSource.isInitialized ? AppDataSource.getRepository(Miner) : null;
  private submissionRepository = AppDataSource.isInitialized ? AppDataSource.getRepository(Submission) : null;
  private campaignRepository = AppDataSource.isInitialized ? AppDataSource.getRepository(Campaign) : null;
  private rewardRepository = AppDataSource.isInitialized ? AppDataSource.getRepository(Reward) : null;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupPeriodicUpdates();
  }

  // Broadcast real-time miner status updates
  async broadcastMinerStatus(minerId: number, status: string): Promise<void> {
    try {
      let minerData;
      
      if (this.minerRepository) {
        const miner = await this.minerRepository.findOne({
          where: { id: minerId },
          relations: ['user'],
        });
        
        if (miner) {
          minerData = {
            id: miner.id,
            username: miner.username,
            status: miner.status,
            isAvailable: miner.isAvailable,
            roastBalance: miner.roastBalance,
            agentPersonality: miner.agentPersonality,
            lastActiveAt: miner.lastActiveAt,
          };
        }
      }

      // Fallback to mock data
      if (!minerData) {
        minerData = {
          id: minerId,
          username: `Miner_${minerId}`,
          status,
          isAvailable: status === 'ONLINE',
          roastBalance: 1000,
          agentPersonality: 'WITTY',
          lastActiveAt: new Date(),
        };
      }

      this.io.to('dashboard').emit('minerStatusUpdate', {
        ...minerData,
        timestamp: new Date().toISOString(),
      });

      this.io.to(`miner_${minerId}`).emit('statusUpdate', {
        status,
        timestamp: new Date().toISOString(),
      });

      logger.info(`📡 Broadcasted miner ${minerId} status: ${status}`);
    } catch (error) {
      logger.error('❌ Failed to broadcast miner status:', error);
    }
  }

  // Broadcast new submission with real data
  async broadcastNewSubmission(submissionId: number): Promise<void> {
    try {
      let submissionData;

      if (this.submissionRepository) {
        const submission = await this.submissionRepository.findOne({
          where: { id: submissionId },
          relations: ['miner', 'campaign', 'user'],
        });

        if (submission) {
          submissionData = {
            id: submission.id,
            content: submission.content.substring(0, 100) + '...',
            status: submission.status,
            tokensSpent: submission.tokensSpent,
            campaignId: submission.campaign?.id,
            campaignTitle: submission.campaign?.title,
            minerId: submission.miner?.id,
            minerName: submission.miner?.username,
            createdAt: submission.createdAt,
          };
        }
      }

      // Only proceed if we have real data
      if (!submissionData) {
        logger.warn(`⚠️ No submission data found for ID ${submissionId}, skipping broadcast`);
        return;
      }

      // Broadcast to dashboard
      this.io.to('dashboard').emit('newSubmission', {
        ...submissionData,
        timestamp: new Date().toISOString(),
      });

      // Broadcast to campaign participants
      this.io.to(`campaign_${submissionData.campaignId}`).emit('campaignActivity', {
        type: 'NEW_SUBMISSION',
        submissionId: submissionData.id,
        minerId: submissionData.minerId,
        timestamp: new Date().toISOString(),
      });

      logger.info(`📡 Broadcasted new submission ${submissionId}`);
    } catch (error) {
      logger.error('❌ Failed to broadcast new submission:', error);
    }
  }

  // Broadcast AI analysis completion
  async broadcastAnalysisComplete(submissionId: number, scores: any): Promise<void> {
    try {
      let submissionData;

      if (this.submissionRepository) {
        const submission = await this.submissionRepository.findOne({
          where: { id: submissionId },
          relations: ['miner', 'campaign'],
        });

        if (submission) {
          submissionData = {
            id: submission.id,
            minerId: submission.miner?.id,
            campaignId: submission.campaign?.id,
            scores: {
              humor: submission.humorScore,
              engagement: submission.engagementScore,
              originality: submission.originalityScore,
              relevance: submission.relevanceScore,
              personality: submission.personalityScore,
              total: submission.totalScore,
            },
            aiAnalysis: submission.aiAnalysis,
          };
        }
      }

      // Use provided scores or generate mock scores
      if (!submissionData) {
        submissionData = {
          id: submissionId,
          minerId: 1,
          campaignId: 1,
          scores: scores || {
            humor: Math.random() * 3 + 7,
            engagement: Math.random() * 3 + 7,
            originality: Math.random() * 3 + 7,
            relevance: Math.random() * 3 + 7,
            personality: Math.random() * 3 + 7,
            total: Math.random() * 3 + 7,
          },
          aiAnalysis: {
            sentiment: 'humorous',
            confidence: 0.95,
            keywords: ['crypto', 'humor', 'content'],
          },
        };
      }

      // Notify the specific miner
      this.io.to(`miner_${submissionData.minerId}`).emit('analysisComplete', {
        submissionId: submissionData.id,
        scores: submissionData.scores,
        analysis: submissionData.aiAnalysis,
        timestamp: new Date().toISOString(),
      });

      // Notify dashboard
      this.io.to('dashboard').emit('analysisUpdate', {
        submissionId: submissionData.id,
        minerId: submissionData.minerId,
        totalScore: submissionData.scores.total,
        timestamp: new Date().toISOString(),
      });

      logger.info(`📡 Broadcasted analysis completion for submission ${submissionId}`);
    } catch (error) {
      logger.error('❌ Failed to broadcast analysis completion:', error);
    }
  }

  // Broadcast reward distribution
  async broadcastRewardDistribution(rewardId: number): Promise<void> {
    try {
      let rewardData;

      if (this.rewardRepository) {
        const reward = await this.rewardRepository.findOne({
          where: { id: rewardId },
          relations: ['miner', 'submission', 'block'],
        });

        if (reward) {
          rewardData = {
            id: reward.id,
            amount: reward.amount,
            rewardType: reward.type,
            minerId: reward.miner?.id,
            minerName: reward.miner?.username,
            submissionId: reward.metadata?.submissionId,
            blockId: reward.block?.id,
            transactionHash: reward.transactionHash,
          };
        }
      }

      // Fallback mock data
      if (!rewardData) {
        rewardData = {
          id: rewardId,
          amount: 500,
          rewardType: 'SUBMISSION_REWARD',
          minerId: 1,
          minerName: 'MockMiner',
          submissionId: 1,
          blockId: 1,
          transactionHash: `0x${Math.random().toString(16).substr(2, 40)}`,
        };
      }

      // Notify specific miner
      this.io.to(`miner_${rewardData.minerId}`).emit('rewardReceived', {
        ...rewardData,
        timestamp: new Date().toISOString(),
      });

      // Notify dashboard
      this.io.to('dashboard').emit('rewardDistributed', {
        ...rewardData,
        timestamp: new Date().toISOString(),
      });

      logger.info(`📡 Broadcasted reward distribution: ${rewardData.amount} ROAST to miner ${rewardData.minerId}`);
    } catch (error) {
      logger.error('❌ Failed to broadcast reward distribution:', error);
    }
  }

  // Broadcast campaign updates
  async broadcastCampaignUpdate(campaignId: number, updateType: string): Promise<void> {
    try {
      let campaignData;

      if (this.campaignRepository) {
        const campaign = await this.campaignRepository.findOne({
          where: { id: campaignId },
          relations: ['project'],
        });

        if (campaign) {
          campaignData = {
            id: campaign.id,
            title: campaign.title,
            status: campaign.status,
            currentSubmissions: campaign.currentSubmissions,
            maxSubmissions: campaign.maxSubmissions,
            endDate: campaign.endDate,
            rewardPool: campaign.rewardPool,
          };
        }
      }

      // Fallback mock data
      if (!campaignData) {
        campaignData = {
          id: campaignId,
          title: 'Mock Campaign',
          status: 'ACTIVE',
          currentSubmissions: 100,
          maxSubmissions: 1000,
          endDate: new Date(Date.now() + 86400000),
          rewardPool: 50000,
        };
      }

      // Broadcast to campaign participants
      this.io.to(`campaign_${campaignId}`).emit('campaignUpdate', {
        ...campaignData,
        updateType,
        timestamp: new Date().toISOString(),
      });

      // Broadcast to dashboard
      this.io.to('dashboard').emit('campaignStatusUpdate', {
        ...campaignData,
        updateType,
        timestamp: new Date().toISOString(),
      });

      logger.info(`📡 Broadcasted campaign ${campaignId} update: ${updateType}`);
    } catch (error) {
      logger.error('❌ Failed to broadcast campaign update:', error);
    }
  }

  // Setup periodic updates for real-time dashboard
  private setupPeriodicUpdates(): void {
    // Broadcast system stats every 10 seconds
    setInterval(async () => {
      try {
        const stats = await this.getSystemStats();
        this.io.to('dashboard').emit('systemStats', {
          ...stats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('❌ Failed to broadcast system stats:', error);
      }
    }, 10000);

    // Broadcast active miners update every 30 seconds
    setInterval(async () => {
      try {
        const activeMiners = await this.getActiveMiners();
        this.io.to('dashboard').emit('activeMinersList', {
          miners: activeMiners,
          count: activeMiners.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('❌ Failed to broadcast active miners:', error);
      }
    }, 30000);

    // Simulate real-time activity every 45 seconds
    setInterval(async () => {
      try {
        await this.simulateActivity();
      } catch (error) {
        logger.error('❌ Failed to simulate activity:', error);
      }
    }, 45000);
  }

  // Get real system stats
  private async getSystemStats(): Promise<any> {
    try {
      let stats = {
        activeMiners: 0,
        totalSubmissions: 0,
        totalRewards: 0,
        averageScore: 0,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        websocketConnections: this.io.sockets.sockets.size,
      };

      if (this.minerRepository && this.submissionRepository) {
        const [activeMinersCount, totalSubmissions, avgScoreResult] = await Promise.all([
          this.minerRepository.count({ where: { status: 'ONLINE' as any } }),
          this.submissionRepository.count(),
          this.submissionRepository
            .createQueryBuilder('submission')
            .select('AVG(submission.totalScore)', 'avg')
            .where('submission.totalScore IS NOT NULL')
            .getRawOne(),
        ]);

        stats.activeMiners = activeMinersCount;
        stats.totalSubmissions = totalSubmissions;
        stats.averageScore = parseFloat(avgScoreResult?.avg || '0');
      } else {
        // Mock stats
        stats = {
          activeMiners: 4,
          totalSubmissions: 1247,
          totalRewards: 125000,
          averageScore: 8.7,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          websocketConnections: this.io.sockets.sockets.size,
        };
      }

      return stats;
    } catch (error) {
      logger.error('❌ Failed to get system stats:', error);
      return {
        activeMiners: 0,
        totalSubmissions: 0,
        totalRewards: 0,
        averageScore: 0,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        websocketConnections: this.io.sockets.sockets.size,
      };
    }
  }

  // Get active miners
  private async getActiveMiners(): Promise<any[]> {
    try {
      if (this.minerRepository) {
        const miners = await this.minerRepository.find({
          where: { status: 'ONLINE' as any },
          take: 10,
          order: { lastActiveAt: 'DESC' },
        });

        return miners.map(miner => ({
          id: miner.id,
          username: miner.username,
          personality: miner.agentPersonality,
          status: miner.status,
          roastBalance: miner.roastBalance,
          lastActiveAt: miner.lastActiveAt,
        }));
      }

      // Mock active miners
      return [
        {
          id: 1,
          username: 'SavageRoaster_007',
          personality: 'SAVAGE',
          status: 'ONLINE',
          roastBalance: 1500,
          lastActiveAt: new Date(),
        },
        {
          id: 2,
          username: 'MemeKing_420',
          personality: 'CHAOTIC',
          status: 'MINING',
          roastBalance: 800,
          lastActiveAt: new Date(Date.now() - 120000),
        },
      ];
    } catch (error) {
      logger.error('❌ Failed to get active miners:', error);
      return [];
    }
  }

  // Simulate activity for demo purposes
  private async simulateActivity(): Promise<void> {
    const activities = [
      { type: 'MINER_STATUS', action: () => this.broadcastMinerStatus(Math.floor(Math.random() * 4) + 1, 'ONLINE') },
      { type: 'NEW_SUBMISSION', action: () => this.broadcastNewSubmission(Math.floor(Math.random() * 1000) + 1000) },
      { type: 'ANALYSIS_COMPLETE', action: () => this.broadcastAnalysisComplete(Math.floor(Math.random() * 1000) + 1000, null) },
      { type: 'REWARD_DISTRIBUTION', action: () => this.broadcastRewardDistribution(Math.floor(Math.random() * 100) + 100) },
    ];

    if (Math.random() > 0.7 && activities.length > 0) { // 30% chance of activity
      const randomIndex = Math.floor(Math.random() * activities.length);
      const randomActivity = activities[randomIndex];
      if (randomActivity) {
        await randomActivity.action();
        logger.info(`🎭 Simulated activity: ${randomActivity.type}`);
      }
    }
  }
}

// Export singleton instance
let webSocketManager: WebSocketManager | null = null;

export const initializeWebSocketManager = (io: SocketIOServer): WebSocketManager => {
  webSocketManager = new WebSocketManager(io);
  return webSocketManager;
};

export const getWebSocketManager = (): WebSocketManager | null => {
  return webSocketManager;
}; 