import { logger } from '../config/logger';
import { env } from '../config/env';
import { AppDataSource } from '../config/database';
import { Submission } from '../models/Submission';
import { Campaign } from '../models/Campaign';
import { Miner } from '../models/Miner';
import { Block } from '../models/Block';
import { Reward } from '../models/Reward';
import { Repository } from 'typeorm';
import { BlockStatus, SubmissionStatus, RewardType } from '../types/index';

interface MiningSubmission {
  id: string;
  minerId: number;
  campaignId: number;
  content: string;
  tokensUsed: number;
  timestamp: number;
  minerWallet: string;
}

interface BlockResult {
  blockId: number;
  topMiners: MiningSubmission[];
  totalSubmissions: number;
  campaignsProcessed: number[];
}

export class MiningService {
  private static instance: MiningService;
  
  private submissionRepository?: Repository<Submission>;
  private campaignRepository?: Repository<Campaign>;
  private minerRepository?: Repository<Miner>;
  private blockRepository?: Repository<Block>;
  private rewardRepository?: Repository<Reward>;
  
  private miningInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private lastBlockTime = Date.now();
  
  // In-memory storage for mining data (Redis would be used in production)
  private activeSubmissions: Map<string, MiningSubmission> = new Map();
  private activeMiners: Set<number> = new Set();
  private campaignSubmissionCounts: Map<number, number> = new Map();

  public static getInstance(): MiningService {
    if (!MiningService.instance) {
      MiningService.instance = new MiningService();
    }
    return MiningService.instance;
  }

  constructor() {
    this.initializeRepositories();
  }

  private initializeRepositories(): void {
    if (AppDataSource.isInitialized) {
      this.submissionRepository = AppDataSource.getRepository(Submission);
      this.campaignRepository = AppDataSource.getRepository(Campaign);
      this.minerRepository = AppDataSource.getRepository(Miner);
      this.blockRepository = AppDataSource.getRepository(Block);
      this.rewardRepository = AppDataSource.getRepository(Reward);
      this.isInitialized = true;
      logger.info('✅ MiningService: Database repositories initialized');
    } else {
      logger.warn('⚠️ MiningService: Database not initialized, using in-memory storage');
    }
  }

  /**
   * Start the mining block system with 2-minute intervals
   */
  public startMining(): void {
    if (this.miningInterval) {
      logger.warn('⚠️ Mining already started');
      return;
    }

    logger.info('🚀 Starting mining block system');
    logger.info(`⏰ Block interval: ${env.mining.blockInterval}ms (${env.mining.blockInterval / 1000}s)`);
    logger.info(`👥 Minimum miners required: ${env.mining.minMiners}`);
    logger.info(`🏆 Top miners per block: ${env.mining.topMinersPerBlock}`);

    // Start the mining interval
    this.miningInterval = setInterval(() => {
      this.processBlock();
    }, env.mining.blockInterval);

    logger.info('✅ Mining block system started');
  }

  /**
   * Stop the mining block system
   */
  public stopMining(): void {
    if (this.miningInterval) {
      clearInterval(this.miningInterval);
      this.miningInterval = null;
      logger.info('⏹️ Mining block system stopped');
    }
  }

  /**
   * Add a miner as active
   */
  public addActiveMiner(minerId: number): void {
    this.activeMiners.add(minerId);
    logger.info(`👤 Miner ${minerId} is now active. Total active miners: ${this.activeMiners.size}`);
  }

  /**
   * Remove a miner from active list
   */
  public removeActiveMiner(minerId: number): void {
    this.activeMiners.delete(minerId);
    logger.info(`👤 Miner ${minerId} is now inactive. Total active miners: ${this.activeMiners.size}`);
  }

  /**
   * Submit content for mining
   */
  public async submitContent(submission: {
    minerId: number;
    campaignId: number;
    content: string;
    tokensUsed: number;
    minerWallet: string;
  }): Promise<{ success: boolean; submissionId: string; message: string }> {
    try {
      // Check if campaign is still accepting submissions
      const currentCount = this.campaignSubmissionCounts.get(submission.campaignId) || 0;
      if (currentCount >= env.mining.maxSubmissionsPerCampaign) {
        return {
          success: false,
          submissionId: '',
          message: `Campaign ${submission.campaignId} has reached maximum submissions (${env.mining.maxSubmissionsPerCampaign})`
        };
      }

      // Generate unique submission ID
      const submissionId = `${submission.minerId}_${submission.campaignId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create mining submission
      const miningSubmission: MiningSubmission = {
        id: submissionId,
        minerId: submission.minerId,
        campaignId: submission.campaignId,
        content: submission.content,
        tokensUsed: submission.tokensUsed,
        timestamp: Date.now(),
        minerWallet: submission.minerWallet
      };

      // Store in active submissions
      this.activeSubmissions.set(submissionId, miningSubmission);

      // Update campaign submission count
      this.campaignSubmissionCounts.set(submission.campaignId, currentCount + 1);

      // Add miner to active list
      this.addActiveMiner(submission.minerId);

      logger.info(`📝 Content submitted: ${submissionId} (Miner: ${submission.minerId}, Campaign: ${submission.campaignId}, Tokens: ${submission.tokensUsed})`);

      return {
        success: true,
        submissionId,
        message: 'Content submitted successfully'
      };

    } catch (error) {
      logger.error('❌ Failed to submit content:', error);
      return {
        success: false,
        submissionId: '',
        message: 'Failed to submit content'
      };
    }
  }

  /**
   * Process a mining block - called every 2 minutes
   */
  private async processBlock(): Promise<void> {
    try {
      logger.info('🔗 Processing mining block...');
      
      // Check if we have minimum miners
      if (this.activeMiners.size < env.mining.minMiners) {
        logger.info(`⏳ Insufficient miners for block processing. Required: ${env.mining.minMiners}, Active: ${this.activeMiners.size}`);
        return;
      }

      // Get all submissions from this block period
      const submissions = Array.from(this.activeSubmissions.values());
      
      if (submissions.length === 0) {
        logger.info('📭 No submissions in this block period');
        return;
      }

      logger.info(`📊 Processing ${submissions.length} submissions from ${this.activeMiners.size} active miners`);

      // Rank submissions by token usage (descending order)
      const rankedSubmissions = submissions.sort((a, b) => b.tokensUsed - a.tokensUsed);

      // Take top 50 miners
      const topSubmissions = rankedSubmissions.slice(0, env.mining.topMinersPerBlock);

      logger.info(`🏆 Selected top ${topSubmissions.length} submissions for block rewards`);

      // Save block to database
      const blockResult = await this.saveBlockToDatabase(topSubmissions);

      // Clear processed submissions
      this.clearProcessedSubmissions();

      // Update last block time
      this.lastBlockTime = Date.now();

      logger.info(`✅ Block ${blockResult.blockId} processed successfully with ${blockResult.topMiners.length} winners`);

    } catch (error) {
      logger.error('❌ Failed to process mining block:', error);
    }
  }

  /**
   * Save mining block results to database
   */
  private async saveBlockToDatabase(topSubmissions: MiningSubmission[]): Promise<BlockResult> {
    try {
      const blockId = Date.now();
      const campaignsProcessed = [...new Set(topSubmissions.map(s => s.campaignId))];

      if (this.isInitialized && this.blockRepository && this.rewardRepository) {
        // Save block to database
        const block = new Block();
        block.blockNumber = Math.floor(blockId / 1000);
        block.minedAt = new Date();
        block.status = BlockStatus.MINED;
        block.submissionCount = topSubmissions.length;
        block.minerIds = topSubmissions.map(s => s.minerId);
        block.totalRewards = topSubmissions.length * 100; // Base reward calculation
        block.metadata = {
          difficulty: 1,
          gasUsed: topSubmissions.reduce((sum, s) => sum + s.tokensUsed, 0),
          transactionHash: '0x' + Math.random().toString(16).substr(2, 64)
        };

        const savedBlock = await this.blockRepository.save(block);

        // Create rewards for top miners
        for (let i = 0; i < topSubmissions.length; i++) {
          const submission = topSubmissions[i];
          if (submission) {
            const reward = new Reward();
            reward.blockId = savedBlock.id;
            reward.minerId = submission.minerId;
            reward.amount = this.calculateReward(i, topSubmissions.length);
            reward.type = RewardType.MINING;
            reward.metadata = {
              campaignId: submission.campaignId,
              reason: `Mining reward for rank ${i + 1}, submission: ${submission.id}`,
              notes: `Tokens used: ${submission.tokensUsed}`
            };

            await this.rewardRepository.save(reward);
          }
        }

        logger.info(`💾 Block ${savedBlock.id} and ${topSubmissions.length} rewards saved to database`);
      }

      return {
        blockId,
        topMiners: topSubmissions,
        totalSubmissions: topSubmissions.length,
        campaignsProcessed
      };

    } catch (error) {
      logger.error('❌ Failed to save block to database:', error);
      throw error;
    }
  }

  /**
   * Calculate reward amount based on rank
   */
  private calculateReward(rank: number, totalWinners: number): number {
    // Simple reward distribution: higher ranks get more rewards
    const baseReward = 100;
    const rankMultiplier = Math.max(1, (totalWinners - rank) / totalWinners);
    return Math.floor(baseReward * rankMultiplier);
  }

  /**
   * Clear processed submissions from memory
   */
  private clearProcessedSubmissions(): void {
    this.activeSubmissions.clear();
    this.campaignSubmissionCounts.clear();
    logger.info('🧹 Cleared processed submissions from memory');
  }

  /**
   * Get mining statistics
   */
  public getMiningStats(): {
    activeMiners: number;
    pendingSubmissions: number;
    campaignCounts: Record<number, number>;
    nextBlockIn: number;
  } {
    const nextBlockIn = env.mining.blockInterval - (Date.now() - this.lastBlockTime);
    return {
      activeMiners: this.activeMiners.size,
      pendingSubmissions: this.activeSubmissions.size,
      campaignCounts: Object.fromEntries(this.campaignSubmissionCounts),
      nextBlockIn: Math.max(0, nextBlockIn)
    };
  }

  /**
   * Check if campaign is accepting submissions
   */
  public isCampaignAcceptingSubmissions(campaignId: number): boolean {
    const currentCount = this.campaignSubmissionCounts.get(campaignId) || 0;
    return currentCount < env.mining.maxSubmissionsPerCampaign;
  }

  /**
   * Get block mining status
   */
  public getBlockStatus(): {
    nextBlockIn: number;
    currentBlock: number;
    minersInQueue: number;
    topMinersRequired: number;
  } {
    const nextBlockIn = env.mining.blockInterval - (Date.now() - this.lastBlockTime);
    return {
      nextBlockIn: Math.max(0, nextBlockIn),
      currentBlock: Math.floor(Date.now() / env.mining.blockInterval),
      minersInQueue: this.activeMiners.size,
      topMinersRequired: env.mining.topMinersPerBlock,
    };
  }

  /**
   * Get current mining block info
   */
  public async getCurrentBlock(): Promise<any> {
    const status = this.getBlockStatus();
    return {
      blockNumber: status.currentBlock,
      timeRemaining: status.nextBlockIn,
      activeMiners: status.minersInQueue,
      pendingSubmissions: this.activeSubmissions.size,
    };
  }

  /**
   * Get mining schedule information
   */
  public getMiningSchedule(): {
    blockInterval: number;
    nextBlockTime: number;
    minMinersRequired: number;
    topMinersPerBlock: number;
    timeUntilNextBlock: number;
  } {
    const status = this.getBlockStatus();
    return {
      blockInterval: env.mining.blockInterval,
      nextBlockTime: this.lastBlockTime + env.mining.blockInterval,
      minMinersRequired: env.mining.minMiners,
      topMinersPerBlock: env.mining.topMinersPerBlock,
      timeUntilNextBlock: status.nextBlockIn,
    };
  }

  /**
   * Manually start block mining
   */
  public async startBlockMining(): Promise<any> {
    await this.processBlock();
    this.lastBlockTime = Date.now();
    return {
      message: 'Block mining completed',
      timestamp: new Date().toISOString(),
    };
  }
} 