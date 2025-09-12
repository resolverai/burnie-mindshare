import { buildApiUrl } from '../utils/api-config';

export interface HotCampaign {
  campaignId: string;
  campaignName: string;
  postType: string;
  availableCount: number;
  purchaseCount: number;
  ratio: number;
}

export interface MiningStatus {
  isRunning: boolean;
  currentCampaign?: HotCampaign;
  totalGenerated: number;
  lastGeneration?: Date;
}

class AutomatedMiningService {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private currentCampaign: HotCampaign | null = null;
  private totalGenerated = 0;
  private lastGeneration: Date | null = null;
  private listeners: ((status: MiningStatus) => void)[] = [];

  // Check if user has agents and neural keys configured
  async checkMiningReadiness(walletAddress: string): Promise<{
    canStart: boolean;
    hasAgents: boolean;
    hasNeuralKeys: boolean;
    message: string;
  }> {
    try {
      // Check if user has agents
      const agentsResponse = await fetch(
        buildApiUrl(`agents/user/${walletAddress}`)
      );
      
      if (!agentsResponse.ok) {
        return {
          canStart: false,
          hasAgents: false,
          hasNeuralKeys: false,
          message: 'Failed to check agents'
        };
      }

      const agentsData = await agentsResponse.json();
      const hasAgents = agentsData.data && agentsData.data.length > 0;

      // Check if user has neural keys configured
      const apiKeys = localStorage.getItem(`burnie_api_keys_${walletAddress}`);
      let hasNeuralKeys = false;
      
      if (apiKeys) {
        try {
          const parsedKeys = JSON.parse(apiKeys);
          // Check if any provider has a non-empty key
          hasNeuralKeys = Object.values(parsedKeys).some(value => 
            typeof value === 'string' && value.trim() !== ''
          );
        } catch (error) {
          console.error('Error parsing API keys:', error);
          hasNeuralKeys = false;
        }
      }

      const canStart = hasAgents && hasNeuralKeys;

      return {
        canStart,
        hasAgents,
        hasNeuralKeys,
        message: canStart 
          ? 'Ready to start automated mining'
          : `Missing: ${!hasAgents ? 'Agents' : ''} ${!hasAgents && !hasNeuralKeys ? 'and' : ''} ${!hasNeuralKeys ? 'Neural Keys' : ''}`
      };

    } catch (error) {
      console.error('Error checking mining readiness:', error);
      return {
        canStart: false,
        hasAgents: false,
        hasNeuralKeys: false,
        message: 'Error checking readiness'
      };
    }
  }

  // Get hot campaigns from backend
  async getHotCampaigns(): Promise<HotCampaign[]> {
    try {
      const response = await fetch(buildApiUrl('hot-campaigns'));
      if (!response.ok) {
        throw new Error('Failed to fetch hot campaigns');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching hot campaigns:', error);
      return [];
    }
  }

  // Generate content for a specific campaign and post type
  async generateContentForCampaign(
    walletAddress: string,
    campaignId: string,
    postType: string
  ): Promise<boolean> {
    try {
      // Check if miner has already generated 5 posts for this post_type
      const contentResponse = await fetch(
        buildApiUrl(`marketplace/my-content/miner/wallet/${walletAddress}/totals`)
      );
      
      if (contentResponse.ok) {
        const contentData = await contentResponse.json();
        const existingContent = contentData.data || [];
        
        // Count posts for this campaign and post type
        const count = existingContent.filter((item: any) => 
          item.campaignId === campaignId && item.postType === postType
        ).length;

        if (count >= 5) {
          console.log(`Already generated 5 posts for ${campaignId} (${postType})`);
          return false;
        }
      }

      // Use the existing mining endpoint to generate content
      const miningResponse = await fetch(buildApiUrl('mining/start'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId,
          postType,
          walletAddress
        }),
      });

      if (!miningResponse.ok) {
        throw new Error('Failed to generate content');
      }

      this.totalGenerated++;
      this.lastGeneration = new Date();
      this.notifyListeners();

      return true;
    } catch (error) {
      console.error('Error generating content:', error);
      return false;
    }
  }

  // Start automated mining
  async startMining(walletAddress: string): Promise<void> {
    if (this.isRunning) {
      console.log('Mining is already running');
      return;
    }

    // Check readiness first
    const readiness = await this.checkMiningReadiness(walletAddress);
    if (!readiness.canStart) {
      throw new Error(readiness.message);
    }

    this.isRunning = true;
    this.notifyListeners();

    // Start the mining loop
    this.intervalId = setInterval(async () => {
      try {
        const hotCampaigns = await this.getHotCampaigns();
        
        if (hotCampaigns.length === 0) {
          console.log('No hot campaigns available');
          return;
        }

        // Process campaigns sequentially
        for (const campaign of hotCampaigns) {
          this.currentCampaign = campaign;
          this.notifyListeners();

          const generated = await this.generateContentForCampaign(
            walletAddress,
            campaign.campaignId,
            campaign.postType
          );

          if (generated) {
            console.log(`Generated content for ${campaign.campaignName} (${campaign.postType})`);
            // Wait a bit before next generation
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }

        this.currentCampaign = null;
        this.notifyListeners();

      } catch (error) {
        console.error('Error in mining loop:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  // Stop automated mining
  stopMining(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.currentCampaign = null;
    this.notifyListeners();
  }

  // Get current mining status
  getStatus(): MiningStatus {
    return {
      isRunning: this.isRunning,
      currentCampaign: this.currentCampaign || undefined,
      totalGenerated: this.totalGenerated,
      lastGeneration: this.lastGeneration || undefined,
    };
  }

  // Add status listener
  addStatusListener(listener: (status: MiningStatus) => void): void {
    this.listeners.push(listener);
  }

  // Remove status listener
  removeStatusListener(listener: (status: MiningStatus) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  // Notify all listeners of status change
  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => listener(status));
  }
}

// Export singleton instance
export const automatedMiningService = new AutomatedMiningService();
