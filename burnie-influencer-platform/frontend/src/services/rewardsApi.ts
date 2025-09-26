// API service for rewards and leaderboard functionality

export type TierLevel = 'SILVER' | 'GOLD' | 'PLATINUM' | 'EMERALD' | 'DIAMOND' | 'UNICORN';

export interface LeaderboardUser {
  rank: number;
  walletAddress: string;
  twitterHandle?: string;
  name?: string;
  tier: TierLevel;
  mindshare: number;
  totalReferrals: number;
  totalPoints: number;
  profileImageUrl?: string;
  isCurrentUser?: boolean;
}

export interface UserStats {
  totalPoints: number;
  totalRoastEarned: number;
  totalReferrals: number;
  currentTier: TierLevel;
  mindshare: number;
  referralLink: string;
}

export interface TierProgress {
  currentTier: TierLevel;
  tiers: Array<{
    name: string;
    level: TierLevel;
    requirements: string;
    isUnlocked: boolean;
    isCurrent: boolean;
  }>;
}

export interface LeaderboardResponse {
  users: LeaderboardUser[];
  pagination: {
    page: number;
    limit: number | string;
    total: number;
  };
}

export interface EarningsCalculation {
  baseEarnings: string;
  nodeBonus: string;
  totalEarnings: string;
  commissionRate: string;
  avgPurchasePerReferral: number;
}

export interface UserContext {
  currentTier: TierLevel;
  totalReferrals: number;
  isRunningNode: boolean;
  availableTiers: string[];
}

export interface PotentialEarnings {
  baseEarnings: string;
  nodeBonus: string;
  totalEarnings: string;
  commissionRate: string;
  calculation: {
    referrals: number;
    pricePerReferral: number;
    commissionRate: number;
    isRunningNode: boolean;
    nodeBonusApplicable: boolean;
  };
}

const BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api`;

// Helper function to get auth token
const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };
};

export const rewardsApi = {
  // Get current user's reward stats
  async getUserStats(walletAddress: string): Promise<UserStats> {
    const response = await fetch(`${BASE_URL}/rewards/user-stats/${walletAddress}`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch user stats');
    }
    
    return response.json();
  },

  // Get user's tier progression
  async getTierProgress(walletAddress: string): Promise<TierProgress> {
    const response = await fetch(`${BASE_URL}/rewards/tier-progress/${walletAddress}`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch tier progress');
    }
    
    return response.json();
  },

  // Get leaderboard data
  async getLeaderboard(period: 'now' | '7d' | '1m' = 'now', limit: number = 50, page: number = 1): Promise<LeaderboardResponse> {
    const response = await fetch(`${BASE_URL}/rewards/leaderboard?period=${period}&limit=${limit}&page=${page}`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch leaderboard data');
    }
    
    return response.json();
  },

  // Get top 3 users for podium
  async getTopThree(period: 'now' | '7d' | '1m' = 'now'): Promise<LeaderboardUser[]> {
    const response = await fetch(`${BASE_URL}/rewards/leaderboard/top-three?period=${period}`, {
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch top three users');
    }
    
    return response.json();
  },

  // Calculate potential earnings
  async calculateEarnings(tierLevel: string, referralCount: number, isRunningNode: boolean): Promise<EarningsCalculation> {
    const response = await fetch(`${BASE_URL}/rewards/calculate-earnings`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        tierLevel,
        referralCount,
        isRunningNode
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to calculate earnings');
    }
    
    return response.json();
  },

  async getUserContext(walletAddress: string): Promise<UserContext> {
    const response = await fetch(`${BASE_URL}/rewards/user-context/${walletAddress}`, {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user context');
    }

    return response.json();
  },

  async calculatePotentialEarnings(walletAddress: string, tierLevel: string, referralCount: number, isRunningNode: boolean): Promise<PotentialEarnings> {
    const response = await fetch(`${BASE_URL}/rewards/calculate-potential-earnings`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ walletAddress, tierLevel, referralCount, isRunningNode })
    });

    if (!response.ok) {
      throw new Error('Failed to calculate potential earnings');
    }

    return response.json();
  }
};
