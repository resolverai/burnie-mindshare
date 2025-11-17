// @ts-nocheck - Disable strict checks for ethers contract methods
import { ethers } from 'ethers';
import { logger } from '../config/logger';

// Contract ABIs (simplified - only functions we need)
const TOAST_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const CONTENT_REGISTRY_ABI = [
  'function registerContent(uint256 _contentId, address _creator, string memory _contentHash, string memory _contentType) external',
  'function approveContent(uint256 _contentId, uint256 _price) external',
  'function updatePrice(uint256 _contentId, uint256 _newPrice) external',
  'function purchaseContent(uint256 _contentId) external',
  'function purchaseContentWithPermit(uint256 _contentId, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s) external',
  'function getContent(uint256 _contentId) view returns (tuple(uint256 contentId, address creator, address currentOwner, string contentHash, string personalizedHash, uint256 price, bool isAvailable, bool isApproved, bool isPersonalized, uint256 createdAt, uint256 approvedAt, uint256 soldAt, uint256 personalizedAt, string contentType))',
  'function getContentOwner(uint256 _contentId) view returns (address)',
  'function isContentAvailable(uint256 _contentId) view returns (bool)',
  'function setRewardDistribution(address _rewardDistribution) external',
];

const REWARD_DISTRIBUTION_ABI = [
  'function registerReferral(address _user, address _directReferrer, address _grandReferrer, uint8 _tier) external',
  'function getUserReferralData(address _user) view returns (tuple(address directReferrer, address grandReferrer, uint8 tier, bool isActive, uint256 totalEarnings, uint256 totalReferrals))',
  'function calculateReferralPayout(address _buyer, uint256 _purchaseAmount) view returns (uint256 directAmount, uint256 grandAmount, uint256 totalAmount)',
];

export class SomniaBlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contractOwnerWallet: ethers.Wallet; // For admin operations (register, approve, price set)
  private treasuryWallet: ethers.Wallet; // For airdrops only
  private toastToken: ethers.Contract;
  private toastTokenTreasury: ethers.Contract; // For airdrops
  private contentRegistry: ethers.Contract;
  private rewardDistribution: ethers.Contract;
  
  // Nonce management for preventing collisions
  private contractOwnerNonce: number | null = null;
  private treasuryNonce: number | null = null;
  private contractOwnerTxQueue: Promise<any> = Promise.resolve();
  private treasuryTxQueue: Promise<any> = Promise.resolve();

  constructor() {
    const rpcUrl = process.env.SOMNIA_TESTNET_RPC_URL || 'https://dream-rpc.somnia.network';
    const contractOwnerPrivateKey = process.env.CONTRACT_OWNER_PRIVATE_KEY || '';
    const treasuryPrivateKey = process.env.SOMNIA_TREASURY_WALLET_PRIVATE_KEY || '';
    const toastTokenAddress = process.env.TOAST_TOKEN_ADDRESS || '';
    const contentRegistryAddress = process.env.CONTENT_REGISTRY_ADDRESS || '';
    const rewardDistributionAddress = process.env.REWARD_DISTRIBUTION_ADDRESS || '';

    if (!contractOwnerPrivateKey) {
      logger.warn('⚠️ CONTRACT_OWNER_PRIVATE_KEY not set');
    }

    if (!treasuryPrivateKey) {
      logger.warn('⚠️ SOMNIA_TREASURY_WALLET_PRIVATE_KEY not set');
    }

    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Initialize wallets
    this.contractOwnerWallet = new ethers.Wallet(contractOwnerPrivateKey, this.provider);
    this.treasuryWallet = new ethers.Wallet(treasuryPrivateKey, this.provider);

    // Initialize contracts with contract owner wallet (for admin operations)
    this.toastToken = new ethers.Contract(toastTokenAddress, TOAST_TOKEN_ABI, this.contractOwnerWallet);
    this.contentRegistry = new ethers.Contract(contentRegistryAddress, CONTENT_REGISTRY_ABI, this.contractOwnerWallet);
    this.rewardDistribution = new ethers.Contract(rewardDistributionAddress, REWARD_DISTRIBUTION_ABI, this.contractOwnerWallet);

    // Initialize TOAST token with treasury wallet (for airdrops)
    this.toastTokenTreasury = new ethers.Contract(toastTokenAddress, TOAST_TOKEN_ABI, this.treasuryWallet);

    logger.info('✅ Somnia blockchain service initialized');
    logger.info(`   RPC: ${rpcUrl}`);
    logger.info(`   Contract Owner: ${this.contractOwnerWallet.address}`);
    logger.info(`   Treasury Wallet: ${this.treasuryWallet.address}`);
  }

  /**
   * Get and increment nonce for contract owner wallet
   * Ensures sequential nonce management to prevent collisions
   */
  private async getContractOwnerNonce(): Promise<number> {
    if (this.contractOwnerNonce === null) {
      // First time - fetch from network
      this.contractOwnerNonce = await this.provider.getTransactionCount(
        this.contractOwnerWallet.address,
        'pending' // Include pending transactions
      );
      logger.info(`📊 Initial contract owner nonce: ${this.contractOwnerNonce}`);
    } else {
      // Increment local nonce
      this.contractOwnerNonce++;
      logger.info(`📊 Incremented contract owner nonce: ${this.contractOwnerNonce}`);
    }
    return this.contractOwnerNonce;
  }

  /**
   * Get and increment nonce for treasury wallet
   * Ensures sequential nonce management to prevent collisions
   */
  private async getTreasuryNonce(): Promise<number> {
    if (this.treasuryNonce === null) {
      // First time - fetch from network
      this.treasuryNonce = await this.provider.getTransactionCount(
        this.treasuryWallet.address,
        'pending' // Include pending transactions
      );
      logger.info(`📊 Initial treasury nonce: ${this.treasuryNonce}`);
    } else {
      // Increment local nonce
      this.treasuryNonce++;
      logger.info(`📊 Incremented treasury nonce: ${this.treasuryNonce}`);
    }
    return this.treasuryNonce;
  }

  /**
   * Reset nonce (in case of errors or manual intervention)
   */
  private resetContractOwnerNonce() {
    this.contractOwnerNonce = null;
  }

  private resetTreasuryNonce() {
    this.treasuryNonce = null;
  }

  /**
   * Queue a transaction for contract owner to ensure sequential execution
   * @param txFunction Function that sends the transaction
   * @returns Promise that resolves with transaction hash
   */
  private async queueContractOwnerTransaction<T>(txFunction: (nonce: number) => Promise<T>): Promise<T> {
    // Add to queue to ensure sequential execution
    this.contractOwnerTxQueue = this.contractOwnerTxQueue
      .then(async () => {
        try {
          const nonce = await this.getContractOwnerNonce();
          return await txFunction(nonce);
        } catch (error: any) {
          // If nonce error, reset and retry once
          if (error.code === 'NONCE_EXPIRED' || error.message?.includes('nonce')) {
            logger.warn('⚠️ Nonce error detected, resetting and retrying...');
            this.resetContractOwnerNonce();
            const nonce = await this.getContractOwnerNonce();
            return await txFunction(nonce);
          }
          throw error;
        }
      });
    
    return this.contractOwnerTxQueue;
  }

  /**
   * Queue a transaction for treasury to ensure sequential execution
   * @param txFunction Function that sends the transaction
   * @returns Promise that resolves with transaction hash
   */
  private async queueTreasuryTransaction<T>(txFunction: (nonce: number) => Promise<T>): Promise<T> {
    // Add to queue to ensure sequential execution
    this.treasuryTxQueue = this.treasuryTxQueue
      .then(async () => {
        try {
          const nonce = await this.getTreasuryNonce();
          return await txFunction(nonce);
        } catch (error: any) {
          // If nonce error, reset and retry once
          if (error.code === 'NONCE_EXPIRED' || error.message?.includes('nonce')) {
            logger.warn('⚠️ Nonce error detected, resetting and retrying...');
            this.resetTreasuryNonce();
            const nonce = await this.getTreasuryNonce();
            return await txFunction(nonce);
          }
          throw error;
        }
      });
    
    return this.treasuryTxQueue;
  }

  /**
   * Register content on-chain (backend calls this with miner's address as creator)
   * @param contentId Content ID from database
   * @param minerWalletAddress Miner's wallet address (becomes owner)
   * @param ipfsCID IPFS CID of the content
   * @param contentType Type of content (text, image, video, etc.)
   * @returns Transaction hash
   */
  async registerContent(
    contentId: number,
    minerWalletAddress: string,
    ipfsCID: string,
    contentType: string
  ): Promise<string> {
    logger.info(`📝 Queuing content registration: contentId=${contentId}, creator=${minerWalletAddress}`);
    
    return this.queueContractOwnerTransaction(async (nonce) => {
      try {
        logger.info(`📝 Registering content on-chain with nonce ${nonce}: contentId=${contentId}`);

        const tx = await this.contentRegistry.registerContent(
          contentId,
          minerWalletAddress,
          ipfsCID,
          contentType,
          { nonce } // Explicitly set nonce
        );

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ Content registered on-chain: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to register content on-chain:', error);
        throw error;
      }
    });
  }

  /**
   * Approve content and set price (backend calls this after admin approval)
   * @param contentId Content ID
   * @param priceInTokens Price in TOAST tokens (as string, e.g., "100")
   * @returns Transaction hash
   */
  async approveContent(contentId: number, priceInTokens: string): Promise<string> {
    logger.info(`📝 Queuing content approval: contentId=${contentId}, price=${priceInTokens} TOAST`);
    
    return this.queueContractOwnerTransaction(async (nonce) => {
      try {
        logger.info(`✅ Approving content on-chain with nonce ${nonce}: contentId=${contentId}`);

        const priceInWei = ethers.parseEther(priceInTokens);
        const tx = await this.contentRegistry.approveContent(contentId, priceInWei, { nonce });

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ Content approved on-chain: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to approve content on-chain:', error);
        throw error;
      }
    });
  }

  /**
   * Update content price after approval
   * @param contentId Content ID
   * @param newPriceInTokens New price in TOAST tokens (as string, e.g., "999")
   * @returns Transaction hash
   */
  async updatePrice(contentId: number, newPriceInTokens: string): Promise<string> {
    logger.info(`📝 Queuing price update: contentId=${contentId}, newPrice=${newPriceInTokens} TOAST`);
    
    return this.queueContractOwnerTransaction(async (nonce) => {
      try {
        logger.info(`💰 Updating price on-chain with nonce ${nonce}: contentId=${contentId}`);

        const priceInWei = ethers.parseEther(newPriceInTokens);
        const tx = await this.contentRegistry.updatePrice(contentId, priceInWei, { nonce });

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ Price updated on-chain: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to update price on-chain:', error);
        throw error;
      }
    });
  }

  /**
   * Get content details from blockchain
   * @param contentId Content ID
   * @returns Content details
   */
  async getContent(contentId: number): Promise<any> {
    try {
      const content = await this.contentRegistry.getContent(contentId);
      return {
        contentId: Number(content.contentId),
        creator: content.creator,
        currentOwner: content.currentOwner,
        contentHash: content.contentHash,
        personalizedHash: content.personalizedHash,
        price: ethers.formatEther(content.price),
        isAvailable: content.isAvailable,
        isApproved: content.isApproved,
        isPersonalized: content.isPersonalized,
        createdAt: Number(content.createdAt),
        approvedAt: Number(content.approvedAt),
        soldAt: Number(content.soldAt),
        personalizedAt: Number(content.personalizedAt),
        contentType: content.contentType,
      };
    } catch (error) {
      logger.error('❌ Failed to get content from blockchain:', error);
      throw error;
    }
  }

  /**
   * Check if content is available for purchase
   * @param contentId Content ID
   * @returns True if available
   */
  async isContentAvailable(contentId: number): Promise<boolean> {
    try {
      return await this.contentRegistry.isContentAvailable(contentId);
    } catch (error) {
      logger.error('❌ Failed to check content availability:', error);
      return false;
    }
  }

  /**
   * Get TOAST token balance
   * @param address Wallet address
   * @returns Balance in TOAST tokens
   */
  async getToastBalance(address: string): Promise<string> {
    try {
      const balance = await this.toastToken.balanceOf(address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error('❌ Failed to get TOAST balance:', error);
      return '0';
    }
  }

  /**
   * Transfer TOAST tokens (for airdrops)
   * @param toAddress Recipient address
   * @param amount Amount in TOAST tokens (as string, e.g., "50000")
   * @returns Transaction hash
   */
  async transferToast(toAddress: string, amount: string): Promise<string> {
    logger.info(`📝 Queuing TOAST transfer: ${amount} TOAST to ${toAddress} (from treasury)`);
    
    return this.queueTreasuryTransaction(async (nonce) => {
      try {
        logger.info(`💰 Transferring TOAST with nonce ${nonce}: ${amount} to ${toAddress}`);

        const amountInWei = ethers.parseEther(amount);
        // Use treasury wallet for airdrops
        const tx = await this.toastTokenTreasury.transfer(toAddress, amountInWei, { nonce });

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ TOAST transferred: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to transfer TOAST:', error);
        throw error;
      }
    });
  }

  /**
   * Transfer native STT tokens (for gas)
   * @param toAddress Recipient address
   * @param amount Amount in STT tokens (as string, e.g., "0.5")
   * @returns Transaction hash
   */
  async transferSTT(toAddress: string, amount: string): Promise<string> {
    logger.info(`📝 Queuing STT transfer: ${amount} STT to ${toAddress} (from treasury)`);
    
    return this.queueTreasuryTransaction(async (nonce) => {
      try {
        logger.info(`⛽ Transferring STT (gas) with nonce ${nonce}: ${amount} to ${toAddress}`);

        const amountInWei = ethers.parseEther(amount);
        
        // Send native token transfer
        const tx = await this.treasuryWallet.sendTransaction({
          to: toAddress,
          value: amountInWei,
          nonce,
        });

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ STT transferred: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to transfer STT:', error);
        throw error;
      }
    });
  }

  /**
   * Register referral on-chain
   * @param userAddress User wallet address
   * @param directReferrerAddress Direct referrer address
   * @param grandReferrerAddress Grand referrer address
   * @param tier Referral tier (0=SILVER, 1=GOLD, 2=PLATINUM)
   * @returns Transaction hash
   */
  async registerReferral(
    userAddress: string,
    directReferrerAddress: string,
    grandReferrerAddress: string,
    tier: number
  ): Promise<string> {
    logger.info(`📝 Queuing referral registration: user=${userAddress}, tier=${tier}`);
    
    return this.queueContractOwnerTransaction(async (nonce) => {
      try {
        logger.info(`🔗 Registering referral on-chain with nonce ${nonce}: user=${userAddress}`);

        const tx = await this.rewardDistribution.registerReferral(
          userAddress,
          directReferrerAddress,
          grandReferrerAddress,
          tier,
          { nonce }
        );

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }
        logger.info(`✅ Referral registered on-chain: ${receipt.hash}`);

        return receipt.hash;
      } catch (error) {
        logger.error('❌ Failed to register referral on-chain:', error);
        throw error;
      }
    });
  }

  /**
   * Get user referral data from on-chain
   * @param userAddress User wallet address
   * @returns Referral data
   */
  async getUserReferralData(userAddress: string): Promise<{
    directReferrer: string;
    grandReferrer: string;
    tier: number;
    isActive: boolean;
    totalEarnings: bigint;
    totalReferrals: bigint;
  }> {
    try {
      logger.info(`🔍 Getting referral data for: ${userAddress}`);

      const data = await this.rewardDistribution.getUserReferralData(userAddress);
      
      return {
        directReferrer: data[0],
        grandReferrer: data[1],
        tier: Number(data[2]),
        isActive: data[3],
        totalEarnings: data[4],
        totalReferrals: data[5]
      };
    } catch (error) {
      logger.error('❌ Failed to get referral data:', error);
      throw error;
    }
  }

  /**
   * Get treasury wallet address
   * @returns Treasury wallet address
   */
  getTreasuryAddress(): string {
    return this.treasuryWallet.address;
  }

  /**
   * Get contract owner address
   * @returns Contract owner wallet address
   */
  getContractOwnerAddress(): string {
    return this.contractOwnerWallet.address;
  }

  /**
   * Get contract addresses
   * @returns Contract addresses
   */
  getContractAddresses() {
    return {
      toastToken: process.env.TOAST_TOKEN_ADDRESS,
      contentRegistry: process.env.CONTENT_REGISTRY_ADDRESS,
      rewardDistribution: process.env.REWARD_DISTRIBUTION_ADDRESS,
    };
  }
}

// Export singleton instance
export const somniaBlockchainService = new SomniaBlockchainService();

