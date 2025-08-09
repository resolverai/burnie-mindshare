import { logger } from '../config/logger';
import { ethers } from 'ethers';

// ROAST Token ABI (ERC-20 transfer function)
const ROAST_TOKEN_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

export interface TreasuryDistributionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export class TreasuryService {
  private treasuryPrivateKey: string;
  private roastTokenAddress: string;
  private treasuryAddress: string;
  private rpcUrl: string;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor() {
    this.treasuryPrivateKey = process.env.TREASURY_WALLET_PRIVATE_KEY || '';
    this.roastTokenAddress = process.env.CONTRACT_ROAST_TOKEN || '';
    this.treasuryAddress = process.env.TREASURY_WALLET_ADDRESS || '';
    this.rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

    if (!this.treasuryPrivateKey || !this.roastTokenAddress || !this.treasuryAddress) {
      throw new Error('Treasury configuration incomplete');
    }

    // Initialize Web3 provider and wallet
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.wallet = new ethers.Wallet(this.treasuryPrivateKey, this.provider);
    
    logger.info(`🏦 Treasury service initialized for address: ${this.treasuryAddress}`);
  }

  /**
   * Distribute ROAST tokens from treasury to miner
   */
  async distributeToMiner(
    minerAddress: string,
    amount: number
  ): Promise<TreasuryDistributionResult> {
    try {
      logger.info(`🏦 Treasury distribution: ${amount} ROAST to ${minerAddress}`);

      // Create contract instance
      const roastContract = new ethers.Contract(
        this.roastTokenAddress,
        ROAST_TOKEN_ABI,
        this.wallet
      );

      // Get token decimals
      const decimals = await (roastContract.decimals as any)();
      logger.info(`📏 ROAST token decimals: ${decimals}`);

      // Convert amount to Wei (with proper decimals)
      const amountInWei = ethers.parseUnits(amount.toString(), decimals);
      logger.info(`💰 Amount in wei: ${amountInWei.toString()}`);

      // Check treasury balance before transfer
      const balance = await (roastContract.balanceOf as any)(this.treasuryAddress);
      const balanceInTokens = Number(ethers.formatUnits(balance, decimals));
      
      if (balanceInTokens < amount) {
        throw new Error(`Insufficient treasury balance: ${balanceInTokens} ROAST < ${amount} ROAST`);
      }

      logger.info(`💰 Treasury balance: ${balanceInTokens} ROAST`);

      // Execute the transfer transaction
      logger.info(`🚀 Executing transfer from treasury to miner...`);
      const tx = await (roastContract.transfer as any)(minerAddress, amountInWei);
      
      logger.info(`📤 Transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      logger.info(`⏳ Waiting for transaction confirmation...`);
      const receipt = await tx.wait(1); // Wait for 1 confirmation
      
      if (receipt.status === 1) {
        logger.info(`✅ Treasury distribution successful: ${tx.hash}`);
        return {
          success: true,
          transactionHash: tx.hash
        };
      } else {
        throw new Error('Transaction failed on blockchain');
      }

    } catch (error) {
      logger.error('❌ Treasury distribution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get treasury ROAST balance
   */
  async getTreasuryBalance(): Promise<number> {
    try {
      // Create contract instance for reading
      const roastContract = new ethers.Contract(
        this.roastTokenAddress,
        ROAST_TOKEN_ABI,
        this.provider
      );

      // Get decimals and balance
      const decimals = await (roastContract.decimals as any)();
      const balance = await (roastContract.balanceOf as any)(this.treasuryAddress);
      
      // Convert to human-readable format
      const balanceInTokens = Number(ethers.formatUnits(balance, decimals));
      
      logger.info(`💰 Treasury balance: ${balanceInTokens} ROAST`);
      return balanceInTokens;

    } catch (error) {
      logger.error('❌ Failed to get treasury balance:', error);
      return 0;
    }
  }

  /**
   * Validate treasury has sufficient balance for payout
   */
  async validateSufficientBalance(amount: number): Promise<boolean> {
    try {
      const balance = await this.getTreasuryBalance();
      return balance >= amount;
    } catch (error) {
      logger.error('❌ Failed to validate treasury balance:', error);
      return false;
    }
  }
} 