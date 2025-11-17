import { AppDataSource } from '../config/database';
import { SomniaAirdrop } from '../models/SomniaAirdrop';
import { User } from '../models/User';
import { somniaBlockchainService } from './somniaBlockchainService';
import { logger } from '../config/logger';

export class AirdropService {
  private airdropAmount: string;
  private gasAmount: string; // STT for gas
  private processingAirdrops: Set<string>; // Track in-progress airdrops

  constructor() {
    // Get airdrop amount from environment (default: 50000 TOAST)
    this.airdropAmount = process.env.SOMNIA_AIRDROP_AMOUNT || '50000';
    // Get gas amount from environment (default: 0.5 STT)
    this.gasAmount = process.env.SOMNIA_GAS_AIRDROP_AMOUNT || '0.5';
    this.processingAirdrops = new Set();
  }

  /**
   * Check if user or wallet address has already received airdrop
   * @param userId User ID
   * @param walletAddress Wallet address
   * @param network Network (somnia_testnet)
   * @returns True if already received
   */
  async hasReceivedAirdrop(
    userId: number,
    walletAddress: string,
    network: string = 'somnia_testnet'
  ): Promise<boolean> {
    try {
      const airdropRepo = AppDataSource.getRepository(SomniaAirdrop);
      
      // Check by both userId AND walletAddress to prevent duplicates
      const existingAirdrop = await airdropRepo.findOne({
        where: [
          { userId, network },
          { walletAddress: walletAddress.toLowerCase(), network },
        ],
      });

      return existingAirdrop !== null;
    } catch (error) {
      logger.error('❌ Failed to check airdrop status:', error);
      return false;
    }
  }

  /**
   * Process airdrop for a user
   * @param userId User ID
   * @param walletAddress User's wallet address
   * @param network Network (somnia_testnet)
   * @returns Airdrop details
   */
  async processAirdrop(
    userId: number,
    walletAddress: string,
    network: string = 'somnia_testnet'
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    amount?: string;
    error?: string;
  }> {
    // Create unique key for this airdrop attempt
    const airdropKey = `${userId}-${walletAddress.toLowerCase()}-${network}`;
    
    try {
      // Check if already processing this airdrop
      if (this.processingAirdrops.has(airdropKey)) {
        logger.warn(`⏳ Airdrop already in progress for user ${userId} (${walletAddress})`);
        return {
          success: false,
          error: 'Airdrop already in progress',
        };
      }

      // Mark as processing
      this.processingAirdrops.add(airdropKey);

      // Check if already received (by userId OR walletAddress)
      const alreadyReceived = await this.hasReceivedAirdrop(userId, walletAddress, network);
      if (alreadyReceived) {
        logger.info(`⏭️ User ${userId} or wallet ${walletAddress} already received airdrop on ${network}`);
        this.processingAirdrops.delete(airdropKey);
        return {
          success: false,
          error: 'Airdrop already claimed',
        };
      }

      logger.info(`🎁 Processing airdrop for user ${userId} (${walletAddress}): ${this.airdropAmount} TOAST + ${this.gasAmount} STT`);

      // Transfer TOAST tokens
      const toastTxHash = await somniaBlockchainService.transferToast(
        walletAddress,
        this.airdropAmount
      );

      // Transfer STT tokens (gas)
      const sttTxHash = await somniaBlockchainService.transferSTT(
        walletAddress,
        this.gasAmount
      );

      logger.info(`✅ TOAST transferred: ${toastTxHash}`);
      logger.info(`⛽ STT (gas) transferred: ${sttTxHash}`);

      // Record in database (store TOAST tx hash as primary, STT tx hash in separate field)
      const airdropRepo = AppDataSource.getRepository(SomniaAirdrop);
      const airdrop = airdropRepo.create({
        userId,
        walletAddress: walletAddress.toLowerCase(),
        airdropAmount: parseFloat(this.airdropAmount),
        transactionHash: toastTxHash,
        network,
      });

      await airdropRepo.save(airdrop);

      logger.info(`✅ Airdrop successful: TOAST=${toastTxHash}, STT=${sttTxHash}`);

      return {
        success: true,
        transactionHash: toastTxHash,
        amount: this.airdropAmount,
      };
    } catch (error) {
      logger.error('❌ Airdrop failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // Always remove from processing set
      this.processingAirdrops.delete(airdropKey);
    }
  }

  /**
   * Get airdrop history for a user
   * @param userId User ID
   * @returns List of airdrops
   */
  async getUserAirdrops(userId: number): Promise<SomniaAirdrop[]> {
    try {
      const airdropRepo = AppDataSource.getRepository(SomniaAirdrop);
      const airdrops = await airdropRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      return airdrops;
    } catch (error) {
      logger.error('❌ Failed to get user airdrops:', error);
      return [];
    }
  }

  /**
   * Get total airdrops distributed
   * @returns Statistics
   */
  async getAirdropStats(): Promise<{
    totalAirdrops: number;
    totalAmount: string;
    totalUsers: number;
  }> {
    try {
      const airdropRepo = AppDataSource.getRepository(SomniaAirdrop);
      
      const [airdrops, count] = await airdropRepo.findAndCount();
      
      const totalAmount = airdrops.reduce((sum, airdrop) => sum + parseFloat(airdrop.airdropAmount.toString()), 0);
      
      const uniqueUsers = new Set(airdrops.map(a => a.userId)).size;

      return {
        totalAirdrops: count,
        totalAmount: totalAmount.toFixed(2),
        totalUsers: uniqueUsers,
      };
    } catch (error) {
      logger.error('❌ Failed to get airdrop stats:', error);
      return {
        totalAirdrops: 0,
        totalAmount: '0',
        totalUsers: 0,
      };
    }
  }

  /**
   * Process airdrop on network switch
   * @param userId User ID
   * @param walletAddress User's wallet address
   * @param fromNetwork Previous network
   * @param toNetwork New network
   * @returns Airdrop result
   */
  async processNetworkSwitchAirdrop(
    userId: number,
    walletAddress: string,
    fromNetwork: string,
    toNetwork: string
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    amount?: string;
    error?: string;
  }> {
    // Only process airdrop when switching TO somnia_testnet
    if (toNetwork !== 'somnia_testnet') {
      return {
        success: false,
        error: 'Airdrops only available on Somnia Testnet',
      };
    }

    // Process airdrop
    return await this.processAirdrop(userId, walletAddress, toNetwork);
  }
}

// Export singleton instance
export const airdropService = new AirdropService();

