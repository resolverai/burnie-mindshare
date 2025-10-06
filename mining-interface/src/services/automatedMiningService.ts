import { buildApiUrl } from '../utils/api-config';

export interface HotCampaign {
  campaignId: string;
  campaignName: string;
  projectName: string;
  postType: string;
  availableCount: number;
  purchaseCount: number;
  ratio: number;
  totalCampaignPurchases: number;
  tokenTicker?: string; // Add token ticker field
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
  private completionCheckId: NodeJS.Timeout | null = null;
  private currentCampaign: HotCampaign | null = null;
  private totalGenerated = 0;
  private lastGeneration: Date | null = null;
  private listeners: ((status: MiningStatus) => void)[] = [];

  // Check if user has agents and neural keys configured
  async checkMiningReadiness(walletAddress: string): Promise<{
    canStart: boolean;
    isApproved: boolean;
    hasAgents: boolean;
    hasNeuralKeys: boolean;
    message: string;
  }> {
    try {
      // FIRST CHECK: Is miner approved for automated mining?
      const approvalResponse = await fetch(
        buildApiUrl(`miner-approval/${walletAddress}`)
      );
      
      if (!approvalResponse.ok) {
        return {
          canStart: false,
          isApproved: false,
          hasAgents: false,
          hasNeuralKeys: false,
          message: 'Failed to check miner approval status'
        };
      }

      const approvalData = await approvalResponse.json();
      const isApproved = approvalData.data?.isApproved || false;

      if (!isApproved) {
        return {
          canStart: false,
          isApproved: false,
          hasAgents: false,
          hasNeuralKeys: false,
          message: 'You are not approved for automated mining. Contact admin for approval.'
        };
      }

      // SECOND CHECK: Does user have agents?
      const agentsResponse = await fetch(
        buildApiUrl(`agents/user/${walletAddress}`)
      );
      
      if (!agentsResponse.ok) {
        return {
          canStart: false,
          isApproved: true,
          hasAgents: false,
          hasNeuralKeys: false,
          message: 'Failed to check agents'
        };
      }

      const agentsData = await agentsResponse.json();
      const hasAgents = agentsData.data && agentsData.data.length > 0;

      // THIRD CHECK: Does user have neural keys configured?
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

      const canStart = isApproved && hasAgents && hasNeuralKeys;

      // Generate appropriate message based on what's missing
      let message = '';
      if (canStart) {
        message = 'Ready to start automated mining';
      } else {
        const missing = [];
        if (!hasAgents) missing.push('Agents');
        if (!hasNeuralKeys) missing.push('Neural Keys');
        message = `Missing: ${missing.join(' and ')}`;
      }

      return {
        canStart,
        isApproved,
        hasAgents,
        hasNeuralKeys,
        message
      };

    } catch (error) {
      console.error('Error checking mining readiness:', error);
      return {
        canStart: false,
        isApproved: false,
        hasAgents: false,
        hasNeuralKeys: false,
        message: 'Error checking mining readiness'
      };
    }
  }

  // Get hot campaigns from backend
  async getHotCampaigns(walletAddress: string): Promise<HotCampaign[]> {
    try {
      const response = await fetch(buildApiUrl(`hot-campaigns?walletAddress=${encodeURIComponent(walletAddress)}`));
      if (!response.ok) {
        const errorData = await response.json();
        
        // Check if this is an approval error
        if (response.status === 403 && errorData.error === 'MINER_NOT_APPROVED') {
          throw new Error(errorData.message);
        }
        
        throw new Error('Failed to fetch hot campaigns');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching hot campaigns:', error);
      throw error; // Re-throw to allow proper error handling
    }
  }

  // Fetch total completed executions from database
  async getTotalCompleted(walletAddress: string): Promise<number> {
    try {
      const response = await fetch(buildApiUrl(`executions/miner/${walletAddress}/total-completed`));
      if (!response.ok) {
        throw new Error('Failed to fetch total completed count');
      }
      const data = await response.json();
      return data.data?.totalCompleted || 0;
    } catch (error) {
      console.error('Error fetching total completed count:', error);
      return 0; // Return 0 on error to avoid breaking the UI
    }
  }

  // Generate content for a specific campaign and post type using execution tracking
  async generateContentForCampaign(
    walletAddress: string,
    campaignId: string,
    postType: string,
    campaignName: string,
    projectName: string,
    campaign: HotCampaign
  ): Promise<boolean> {
    let executionId: string | null = null;
    
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

      // Check execution availability and reserve slot
      const executionCheckResponse = await fetch(buildApiUrl('executions/check-and-reserve'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          minerWalletAddress: walletAddress,
          campaignId: parseInt(campaignId),
          postType: postType
        })
      });

      if (!executionCheckResponse.ok) {
        console.error(`Failed to check execution availability for ${campaignId} (${postType})`);
        return false;
      }

      const executionCheckData = await executionCheckResponse.json();
      
      if (!executionCheckData.canGenerate) {
        console.log(`Cannot generate for ${campaignId} (${postType}): ${executionCheckData.reason}`);
        return false;
      }

      executionId = executionCheckData.executionId;
      console.log(`Execution reserved: ${executionId} for ${campaignId} (${postType})`);

      // Get agent configuration for the miner
      const agentResponse = await fetch(
        buildApiUrl(`agents/user/${walletAddress}`)
      );
      
      if (!agentResponse.ok) {
        console.error('Failed to fetch agent configuration');
        return false;
      }

      const agentData = await agentResponse.json();
      const agents = agentData.data || [];
      
      if (agents.length === 0) {
        console.error('No agents found for miner');
        return false;
      }

      // Use the first available agent
      const selectedAgent = agents[0];

      // Get neural keys from localStorage
      const neuralKeys = localStorage.getItem(`burnie_api_keys_${walletAddress}`);
      if (!neuralKeys) {
        console.error('No neural keys found for miner');
        return false;
      }

      const apiKeys = JSON.parse(neuralKeys);

      // Prepare campaigns data in the same format as Mining screen
      const campaignsData = [{
        campaign_id: parseInt(campaignId),
        agent_id: selectedAgent.id,
        post_type: postType,
        include_brand_logo: true, // Default to true for automated generation
        post_index: 1,
        // Dedicated miners: NEVER include video generation
        include_video: false,
        video_duration: 0,
        advanced_video_options: null,
        campaign_context: {
          title: campaignName,
          description: `${campaignName} content generation`,
          category: 'automated',
          campaign_type: 'automated',
          topic: campaignName,
          guidelines: `Generate engaging ${postType} content for ${campaignName}`,
          winner_reward: 'ROAST',
          platform_source: 'automated',
          projectId: null,
          projectName: projectName,
          projectLogoUrl: null,
          tokenTicker: campaign.tokenTicker || '' // Use token ticker from campaign data
        }
      }];

      // Use the same mining endpoint as the Mining screen
      const miningResponse = await fetch(`${process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8000'}/api/mining/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          campaigns: campaignsData,
          execution_id: executionId, // Pass the execution ID to Python AI backend
          source: "dedicated_miner", // Identify this as a dedicated miner request
          user_preferences: {
            preferred_tone: "engaging",
            preferred_length: 250,
            hashtag_preference: 3,
            emoji_usage: "moderate"
          },
          user_api_keys: Object.fromEntries(
            Object.entries({
              openai: apiKeys?.openai,
              anthropic: apiKeys?.anthropic,
              google: apiKeys?.google,
              replicate: apiKeys?.replicate,
              elevenlabs: apiKeys?.elevenlabs,
              stability: apiKeys?.stability,
              fal: apiKeys?.fal
            }).filter(([key, value]) => value && value.trim() !== '')
          ),
          // Dedicated miners: NEVER generate video - only text and images
          include_video: false,
          video_duration: 0,
          advanced_video_options: null
        })
      });

      if (miningResponse.ok) {
        const result = await miningResponse.json();
        console.log(`Mining process started successfully for ${campaignId} (${postType}):`, result);
        console.log(`Session ID: ${result.session_id}, Status: ${result.status}`);
        
        // NOTE: Do NOT mark execution as completed here!
        // The Python AI backend will continue processing in the background.
        // The execution should remain in 'generating' status until the actual
        // content generation completes or fails in the CrewAI service.
        
        // Update last generation attempt time (not completion time)
        this.lastGeneration = new Date();
        this.notifyListeners();
        
        console.log(`Execution ${executionId} remains in 'generating' status - awaiting completion from Python AI backend`);
        console.log(`Total generated count will be updated when Python AI backend completes the actual content generation`);
        
        return true;
      } else {
        const errorText = await miningResponse.text();
        console.error(`Failed to generate content for ${campaignId} (${postType}):`, errorText);
        
        // Mark execution as failed
        await fetch(buildApiUrl(`executions/${executionId}/failed`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            errorMessage: `Content generation failed: ${errorText}`
          })
        });
        
        return false;
      }
    } catch (error) {
      console.error(`Error generating content for ${campaignId} (${postType}):`, error);
      
      // Mark execution as failed if we have an executionId
      if (executionId) {
        try {
          await fetch(buildApiUrl(`executions/${executionId}/failed`), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              errorMessage: `Content generation error: ${error instanceof Error ? error.message : 'Unknown error'}`
            })
          });
        } catch (markFailedError) {
          console.error('Failed to mark execution as failed:', markFailedError);
        }
      }
      
      return false;
    }
  }

  // Check for completed executions and update counters
  private async checkExecutionCompletions(walletAddress: string): Promise<void> {
    try {
      const statusResponse = await fetch(buildApiUrl(`executions/miner/${walletAddress}/status`));
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        const recentExecutions = statusData.data.recentExecutions || [];
        
        // Check if any executions have completed since last check
        // Instead of incrementing locally, fetch the actual total from database
        try {
          const actualTotal = await this.getTotalCompleted(walletAddress);
          if (actualTotal !== this.totalGenerated) {
            console.log(`Total generated count updated from ${this.totalGenerated} to ${actualTotal}`);
            this.totalGenerated = actualTotal;
            this.notifyListeners();
          }
        } catch (error) {
          console.error('Failed to fetch updated total count:', error);
          // Fallback to local increment logic if API fails
          const completedExecutions = recentExecutions.filter((exec: any) => 
            exec.status === 'completed' && 
            exec.completedAt && 
            new Date(exec.completedAt) > this.lastGeneration
          );
          
          if (completedExecutions.length > 0) {
            console.log(`Found ${completedExecutions.length} completed executions, updating counter`);
            this.totalGenerated += completedExecutions.length;
            this.notifyListeners();
          }
        }
      }
    } catch (error) {
      console.error('Error checking execution completions:', error);
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
    
    // Fetch the actual total from database instead of using local counter
    try {
      this.totalGenerated = await this.getTotalCompleted(walletAddress);
      console.log(`Initialized total generated count from database: ${this.totalGenerated}`);
    } catch (error) {
      console.error('Failed to fetch initial total count:', error);
      this.totalGenerated = 0; // Fallback to 0
    }
    
    this.notifyListeners();

    // Start periodic execution completion checking
    this.completionCheckId = setInterval(() => {
      this.checkExecutionCompletions(walletAddress);
    }, 30000); // Check every 30 seconds for completed executions

    // Start the mining loop with proper sequential execution
    this.intervalId = setInterval(async () => {
      try {
        // Check if miner already has an active generation
        const statusResponse = await fetch(buildApiUrl(`executions/miner/${walletAddress}/status`));
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (statusData.data.activeExecution) {
            console.log(`Miner already has active generation: ${statusData.data.activeExecution.id}`);
            return; // Skip this cycle if miner is already generating
          }
        }

        let hotCampaigns;
        try {
          hotCampaigns = await this.getHotCampaigns(walletAddress);
          
          if (hotCampaigns.length === 0) {
            console.log('No hot campaigns available');
            return;
          }
        } catch (error) {
          // Handle approval errors specifically
          if (error instanceof Error && error.message.includes('not approved for automated mining')) {
            console.error('❌ Miner not approved:', error.message);
            this.stopMining(); // Stop automated mining
            this.notifyListeners(); // Notify UI to show approval message
            return;
          }
          throw error; // Re-throw other errors
        }

        // Process only ONE campaign per cycle to ensure sequential execution
        const campaign = hotCampaigns[0]; // Take the first (highest priority) campaign
        this.currentCampaign = campaign;
        this.notifyListeners();

        console.log(`Attempting to generate content for ${campaign.campaignName} (${campaign.postType})`);
        
        const generated = await this.generateContentForCampaign(
          walletAddress,
          campaign.campaignId,
          campaign.postType,
          campaign.campaignName,
          campaign.projectName,
          campaign
        );

        if (generated) {
          console.log(`Successfully generated content for ${campaign.campaignName} (${campaign.postType})`);
          // Wait longer before next cycle to ensure content is processed
          await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
          console.log(`Failed to generate content for ${campaign.campaignName} (${campaign.postType})`);
        }

        this.currentCampaign = null;
        this.notifyListeners();

      } catch (error) {
        console.error('Error in mining loop:', error);
        this.currentCampaign = null;
        this.notifyListeners();
      }
    }, 60000); // Check every 60 seconds to give more time between generations
  }

  // Stop automated mining
  stopMining(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.completionCheckId) {
      clearInterval(this.completionCheckId);
      this.completionCheckId = null;
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
