import { ethers } from 'ethers';
import { IPFSUploadResponse } from './ipfs-service';

// Contract ABIs (simplified versions)
const CAMPAIGN_CONTRACT_ABI = [
  "function createCampaign() external returns (uint256)",
  "function addSubmission((uint256 campaignId, (string submissionString, string model, uint256 llmTokensUsed, address submitter) submission)[] calldata _content) external returns (uint256[] memory)",
  "function selectWinners(uint256 campaignId, uint256 winnerSubmissionId, address _winner) external",
  "function dispersePoints(uint256 campaignId, address winner, uint256 points) external",
  "function campaigns(uint256) view returns (uint8 status, address winner)",
  "function submissions(uint256) view returns (string submissionString, string model, uint256 llmTokensUsed, address submitter)",
  "function totalSubmissions(uint256) view returns (uint256)",
  "function pendingRewards(address) view returns (uint256)",
  "function campaignCounter() view returns (uint256)",
  "function submissionCounter() view returns (uint256)",
  "event CampaignCreated(uint256 indexed campaignId)",
  "event SubmissionAdded(uint256 indexed contentID)",
  "event WinnersSelected(uint256 indexed campaignId, uint256 winnerSubmissionId, address winner)",
  "event PointsDispersed(uint256 indexed campaignId, address winner, uint256 points)"
];

const ROAST_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) external",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  campaignContract: string;
  roastTokenContract: string;
  gasLimit: number;
  gasPrice?: string;
}

export interface SubmissionData {
  campaignId: number;
  content: string;
  model: string;
  tokensUsed: number;
  minerWallet: string;
  cid: string;
  contentHash: string;
}

export interface BatchSubmissionData {
  submissions: SubmissionData[];
  blockNumber?: number;
}

export interface TransactionResult {
  success: boolean;
  hash: string;
  blockNumber?: number;
  gasUsed?: number;
  cost?: string;
  error?: string;
}

export interface CampaignInfo {
  id: number;
  status: 'Active' | 'Inactive';
  totalSubmissions: number;
  winner?: string;
}

export interface SubmissionInfo {
  id: number;
  campaignId: number;
  cid: string;
  model: string;
  tokensUsed: number;
  submitter: string;
}

export class BlockchainService {
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Signer | null = null;
  private campaignContract: ethers.Contract | null = null;
  private roastTokenContract: ethers.Contract | null = null;
  private currentNetwork: NetworkConfig | null = null;

  // Network configurations
  private networks: Record<string, NetworkConfig> = {
    bnbTestnet: {
      name: 'BNB Testnet',
      chainId: 97,
      rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      explorerUrl: 'https://testnet.bscscan.com',
      campaignContract: '0xa8cfD45D9e2526A49Cf3600C9F7cc79Bf2D6F347',
      roastTokenContract: '0xF04F6222dD96f15466AEf22D7A9129dFeBb07F98',
      gasLimit: 500000,
      gasPrice: '5000000000' // 5 gwei
    },
    baseSepolia: {
      name: 'Base Sepolia',
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      explorerUrl: 'https://sepolia.basescan.org',
      campaignContract: '0x0000000000000000000000000000000000000000', // To be deployed
      roastTokenContract: '0x0000000000000000000000000000000000000000', // To be deployed
      gasLimit: 500000
    },
    baseMainnet: {
      name: 'Base Mainnet',
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      explorerUrl: 'https://basescan.org',
      campaignContract: '0x0000000000000000000000000000000000000000', // To be deployed
      roastTokenContract: '0x0000000000000000000000000000000000000000', // To be deployed
      gasLimit: 500000
    }
  };

  constructor() {
    this.loadConfiguration();
  }

  private loadConfiguration(): void {
    try {
      const config = localStorage.getItem('roastpower_blockchain_config');
      if (config) {
        const parsedConfig = JSON.parse(config);
        if (parsedConfig.networkName && this.networks[parsedConfig.networkName]) {
          this.initializeNetwork(parsedConfig.networkName);
        }
      }
    } catch (error) {
      console.error('Failed to load blockchain configuration:', error);
    }
  }

  private saveConfiguration(networkName: string): void {
    try {
      localStorage.setItem('roastpower_blockchain_config', JSON.stringify({ networkName }));
    } catch (error) {
      console.error('Failed to save blockchain configuration:', error);
    }
  }

  public async initializeNetwork(networkName: string): Promise<boolean> {
    try {
      const config = this.networks[networkName];
      if (!config) {
        throw new Error(`Unknown network: ${networkName}`);
      }

      // Initialize provider
      this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
      
      // Test connection
      await this.provider.getBlockNumber();

      this.currentNetwork = config;
      this.saveConfiguration(networkName);

      console.log(`✅ Connected to ${config.name} (Chain ID: ${config.chainId})`);
      return true;
    } catch (error) {
      console.error(`Failed to initialize network ${networkName}:`, error);
      return false;
    }
  }

  public async connectWallet(): Promise<boolean> {
    try {
      if (!this.provider) {
        throw new Error('Network not initialized');
      }

      if (typeof window !== 'undefined' && window.ethereum) {
        // Request account access
        await window.ethereum.request({ method: 'eth_requestAccounts', params: [] });

        // Create Web3Provider for wallet connection
        const browserProvider = new ethers.BrowserProvider(window.ethereum as any);
        this.signer = await browserProvider.getSigner();

        // Switch to correct network if needed
        if (this.currentNetwork) {
          await this.switchToNetwork(this.currentNetwork.chainId);
        }

        // Initialize contracts
        await this.initializeContracts();

        console.log('✅ Wallet connected successfully');
        return true;
      } else {
        throw new Error('No wallet found. Please install MetaMask or another Web3 wallet.');
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      return false;
    }
  }

  private async switchToNetwork(chainId: number): Promise<void> {
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
      } catch (switchError: any) {
        // Network not added to wallet
        if (switchError.code === 4902) {
          const config = Object.values(this.networks).find(n => n.chainId === chainId);
          if (config) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${chainId.toString(16)}`,
                chainName: config.name,
                rpcUrls: [config.rpcUrl],
                blockExplorerUrls: [config.explorerUrl],
              }],
            });
          }
        }
      }
    }
  }

  private async initializeContracts(): Promise<void> {
    if (!this.signer || !this.currentNetwork) {
      throw new Error('Signer or network not initialized');
    }

    try {
      // Initialize Campaign contract
      this.campaignContract = new ethers.Contract(
        this.currentNetwork.campaignContract,
        CAMPAIGN_CONTRACT_ABI,
        this.signer
      );

      // Initialize ROAST token contract
      this.roastTokenContract = new ethers.Contract(
        this.currentNetwork.roastTokenContract,
        ROAST_TOKEN_ABI,
        this.signer
      );

      console.log('✅ Smart contracts initialized');
    } catch (error) {
      console.error('Failed to initialize contracts:', error);
      throw error;
    }
  }

  public isWalletConnected(): boolean {
    return !!this.signer;
  }

  public isNetworkInitialized(): boolean {
    return !!this.currentNetwork;
  }

  public getCurrentNetwork(): NetworkConfig | null {
    return this.currentNetwork;
  }

  public async getWalletAddress(): Promise<string | null> {
    try {
      if (!this.signer) return null;
      return await this.signer.getAddress();
    } catch (error) {
      console.error('Failed to get wallet address:', error);
      return null;
    }
  }

  public async getROASTBalance(address?: string): Promise<string> {
    try {
      if (!this.roastTokenContract) {
        throw new Error('ROAST token contract not initialized');
      }

      const targetAddress = address || await this.getWalletAddress();
      if (!targetAddress) {
        throw new Error('No address provided and wallet not connected');
      }

      const balance = await this.roastTokenContract.balanceOf(targetAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Failed to get ROAST balance:', error);
      return '0';
    }
  }

  public async getCampaignInfo(campaignId: number): Promise<CampaignInfo | null> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const campaign = await this.campaignContract.campaigns(campaignId);
      const totalSubmissions = await this.campaignContract.totalSubmissions(campaignId);

      return {
        id: campaignId,
        status: campaign.status === 1 ? 'Active' : 'Inactive',
        totalSubmissions: Number(totalSubmissions),
        winner: campaign.winner !== ethers.ZeroAddress ? campaign.winner : undefined
      };
    } catch (error) {
      console.error(`Failed to get campaign ${campaignId} info:`, error);
      return null;
    }
  }

  public async getSubmissionInfo(submissionId: number): Promise<SubmissionInfo | null> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const submission = await this.campaignContract.submissions(submissionId);

      return {
        id: submissionId,
        campaignId: 0, // Would need additional tracking to get this
        cid: submission.submissionString,
        model: submission.model,
        tokensUsed: Number(submission.llmTokensUsed),
        submitter: submission.submitter
      };
    } catch (error) {
      console.error(`Failed to get submission ${submissionId} info:`, error);
      return null;
    }
  }

  public async submitContentBatch(batchData: BatchSubmissionData): Promise<TransactionResult> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      if (batchData.submissions.length !== 50) {
        throw new Error('Batch must contain exactly 50 submissions');
      }

      // Prepare submission data for contract
      const contentArray = batchData.submissions.map(sub => ({
        campaignId: sub.campaignId,
        submission: {
          submissionString: sub.cid, // Store IPFS CID
          model: sub.model,
          llmTokensUsed: sub.tokensUsed,
          submitter: sub.minerWallet
        }
      }));

      // Estimate gas
      const gasEstimate = await this.campaignContract.addSubmission.estimateGas(contentArray);
      const gasLimit = gasEstimate * BigInt(120) / BigInt(100); // Add 20% buffer

      // Submit transaction
      const tx = await this.campaignContract.addSubmission(contentArray, {
        gasLimit: gasLimit
      });

      console.log(`📤 Batch submission transaction sent: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      return {
        success: true,
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
        cost: ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
      };
    } catch (error: any) {
      console.error('Batch submission failed:', error);
      return {
        success: false,
        hash: '',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  public async createCampaign(): Promise<TransactionResult> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const tx = await this.campaignContract.createCampaign();
      console.log(`📤 Campaign creation transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();

      return {
        success: true,
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
        cost: ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
      };
    } catch (error: any) {
      console.error('Campaign creation failed:', error);
      return {
        success: false,
        hash: '',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  public async selectWinner(campaignId: number, winnerSubmissionId: number, winnerAddress: string): Promise<TransactionResult> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const tx = await this.campaignContract.selectWinners(campaignId, winnerSubmissionId, winnerAddress);
      console.log(`📤 Winner selection transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();

      return {
        success: true,
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
        cost: ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
      };
    } catch (error: any) {
      console.error('Winner selection failed:', error);
      return {
        success: false,
        hash: '',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  public async disperseRewards(campaignId: number, winner: string, points: number): Promise<TransactionResult> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const pointsWei = ethers.parseEther(points.toString());
      const tx = await this.campaignContract.dispersePoints(campaignId, winner, pointsWei);
      console.log(`📤 Reward dispersion transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();

      return {
        success: true,
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: Number(receipt.gasUsed),
        cost: ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
      };
    } catch (error: any) {
      console.error('Reward dispersion failed:', error);
      return {
        success: false,
        hash: '',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  public async getPendingRewards(address?: string): Promise<string> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const targetAddress = address || await this.getWalletAddress();
      if (!targetAddress) {
        throw new Error('No address provided and wallet not connected');
      }

      const rewards = await this.campaignContract.pendingRewards(targetAddress);
      return ethers.formatEther(rewards);
    } catch (error) {
      console.error('Failed to get pending rewards:', error);
      return '0';
    }
  }

  public async getTotalCampaigns(): Promise<number> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const count = await this.campaignContract.campaignCounter();
      return Number(count);
    } catch (error) {
      console.error('Failed to get campaign count:', error);
      return 0;
    }
  }

  public async getTotalSubmissions(): Promise<number> {
    try {
      if (!this.campaignContract) {
        throw new Error('Campaign contract not initialized');
      }

      const count = await this.campaignContract.submissionCounter();
      return Number(count);
    } catch (error) {
      console.error('Failed to get submission count:', error);
      return 0;
    }
  }

  public getTransactionUrl(hash: string): string {
    if (!this.currentNetwork) return '';
    return `${this.currentNetwork.explorerUrl}/tx/${hash}`;
  }

  public getAddressUrl(address: string): string {
    if (!this.currentNetwork) return '';
    return `${this.currentNetwork.explorerUrl}/address/${address}`;
  }

  public getAvailableNetworks(): NetworkConfig[] {
    return Object.values(this.networks);
  }

  public async switchNetwork(networkName: string): Promise<boolean> {
    try {
      const success = await this.initializeNetwork(networkName);
      if (success && this.isWalletConnected()) {
        await this.connectWallet(); // Reconnect with new network
      }
      return success;
    } catch (error) {
      console.error(`Failed to switch to network ${networkName}:`, error);
      return false;
    }
  }

  public disconnect(): void {
    this.signer = null;
    this.campaignContract = null;
    this.roastTokenContract = null;
    console.log('🔌 Wallet disconnected');
  }

  // Utility function to prepare submission for blockchain
  public prepareSubmissionForBlockchain(
    content: string,
    ipfsResult: IPFSUploadResponse,
    campaignId: number,
    model: string,
    tokensUsed: number,
    minerWallet: string
  ): SubmissionData {
    return {
      campaignId,
      content,
      model,
      tokensUsed,
      minerWallet,
      cid: ipfsResult.cid,
      contentHash: ipfsResult.contentHash
    };
  }
}

// Export singleton instance
export const blockchainService = new BlockchainService(); 