import axios, { AxiosInstance } from 'axios';

// Type definitions
export interface Campaign {
  id: number;
  title: string;
  slug: string;
  description: string;
  topic: string;
  campaign_type: string;
  category?: string;
  keywords?: string[];
  guidelines?: string;
  min_token_spend: number;
  winner_reward: number;
  max_submissions: number;
  current_submissions: number;
  submission_deadline: string;
  time_remaining: number;
  submission_rate: number;
  is_full: boolean;
}

export interface MinerHeartbeat {
  status: 'ONLINE' | 'OFFLINE' | 'MINING' | 'IDLE';
  is_available: boolean;
  roast_balance?: number;
  ip_address?: string;
  user_agent?: string;
}

export interface MinerRegistration {
  wallet_address: string;
  username?: string;
  nickname?: string;
  agent_name?: string;
  agent_personality: 'SAVAGE' | 'WITTY' | 'CHAOTIC' | 'LEGENDARY';
  llm_provider: 'OPENAI' | 'CLAUDE' | 'CUSTOM';
  llm_model?: string;
}

export interface ContentSubmission {
  minerId: number;
  campaignId: number;
  content: string;
  tokensUsed: number;
  minerWallet: string;
  transactionHash?: string;
  metadata?: Record<string, any>;
}

export class BurnieAPIClient {
  private api: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api';
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseURL.replace('/api', '')}/health`);
      return response.status === 200;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }

  // Miner registration and management
  async registerMiner(minerData: MinerRegistration): Promise<any> {
    try {
      console.log('🔧 Registering miner with data:', minerData);
      const response = await this.api.post('/miners/register', minerData);
      console.log('✅ Miner registration response:', response.data);
      
      // Backend returns {success: true, data: {id, username, ...}} so extract the data object
      if (response.data.success && response.data.data) {
        console.log('✅ Miner registered successfully with ID:', response.data.data.id);
        return response.data.data;
      } else {
        console.error('❌ Unexpected registration response format:', response.data);
        throw new Error('Invalid registration response format');
      }
    } catch (error) {
      console.error('❌ Miner registration failed:', error);
      throw new Error(`Miner registration failed: ${error}`);
    }
  }

  async sendHeartbeat(minerId: number, heartbeat: MinerHeartbeat): Promise<void> {
    try {
      console.log(`💓 Sending heartbeat for miner ${minerId}:`, heartbeat);
      if (!minerId || minerId === undefined) {
        throw new Error('Miner ID is required for heartbeat');
      }
      await this.api.put(`/miners/${minerId}/heartbeat`, heartbeat);
      console.log(`✅ Heartbeat sent successfully for miner ${minerId}`);
    } catch (error) {
      console.error(`❌ Heartbeat failed for miner ${minerId}:`, error);
      throw new Error(`Heartbeat failed: ${error}`);
    }
  }

  async getMinerStatus(minerId: number): Promise<any> {
    try {
      const response = await this.api.get(`/miners/${minerId}/status`);
      return response.data;
    } catch (error) {
      throw new Error(`Get miner status failed: ${error}`);
    }
  }

  async updateSocialConnections(minerId: number, socialData: any): Promise<any> {
    try {
      const response = await this.api.put(`/miners/${minerId}/social`, socialData);
      return response.data;
    } catch (error) {
      throw new Error(`Social connection update failed: ${error}`);
    }
  }

  // Campaign management
  async getActiveCampaigns(filters?: {
    category?: string;
    campaign_type?: string;
    limit?: number;
  }): Promise<Campaign[]> {
    try {
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', filters.category);
      if (filters?.campaign_type) params.append('campaign_type', filters.campaign_type);
      if (filters?.limit) params.append('limit', filters.limit.toString());

      const response = await this.api.get(`/campaigns/active?${params.toString()}`);
      // Backend returns {success: true, data: [...]} so extract the data array
      return Array.isArray(response.data.data) ? response.data.data : [];
    } catch (error) {
      console.error('Get active campaigns failed:', error);
      // Return empty array on error to prevent filter issues
      return [];
    }
  }

  async getCampaign(campaignId: number): Promise<Campaign> {
    try {
      const response = await this.api.get(`/campaigns/${campaignId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Get campaign failed: ${error}`);
    }
  }

  async getCampaignSubmissionsCount(campaignId: number): Promise<any> {
    try {
      const response = await this.api.get(`/campaigns/${campaignId}/submissions/count`);
      return response.data;
    } catch (error) {
      throw new Error(`Get submissions count failed: ${error}`);
    }
  }

  // Content submission for mining
  async submitContent(submission: ContentSubmission): Promise<any> {
    try {
      console.log('📝 Submitting content:', submission);
      const response = await this.api.post('/submissions', submission);
      console.log('✅ Content submitted successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Content submission failed:', error);
      throw new Error(`Content submission failed: ${error}`);
    }
  }

  // Mining information
  async getCurrentBlock(): Promise<any> {
    try {
      const response = await this.api.get('/mining/blocks/current');
      return response.data;
    } catch (error) {
      throw new Error(`Get current block failed: ${error}`);
    }
  }

  async getMiningSchedule(): Promise<any> {
    try {
      const response = await this.api.get('/mining/schedule');
      return response.data;
    } catch (error) {
      throw new Error(`Get mining schedule failed: ${error}`);
    }
  }

  // Analytics and stats
  async getLeaderboard(metric: string = 'total_earnings', limit: number = 10): Promise<any> {
    try {
      const response = await this.api.get(`/analytics/leaderboard?metric=${metric}&limit=${limit}`);
      return response.data;
    } catch (error) {
      throw new Error(`Get leaderboard failed: ${error}`);
    }
  }

  async getActiveMinerCount(): Promise<number> {
    try {
      const response = await this.api.get('/analytics/miners/active');
      return response.data.count || 0;
    } catch (error) {
      console.error('Get active miner count failed:', error);
      return 0;
    }
  }

  // Block mining status
  async getBlockStatus(): Promise<any> {
    try {
      const response = await this.api.get('/mining/block-status');
      return response.data;
    } catch (error) {
      console.error('Get block status failed:', error);
      return { blockMiningStarting: false };
    }
  }

  // Utility methods
  async verifyConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Create a singleton instance for easy use
export const api = new BurnieAPIClient()
export default api 