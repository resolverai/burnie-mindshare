// Common enums
export enum MinerStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  MINING = 'MINING',
  IDLE = 'IDLE',
}

export enum AgentPersonality {
  SAVAGE = 'SAVAGE',
  WITTY = 'WITTY',
  CHAOTIC = 'CHAOTIC',
  LEGENDARY = 'LEGENDARY',
}

export enum LLMProvider {
  OPENAI = 'OPENAI',
  CLAUDE = 'CLAUDE',
  CUSTOM = 'CUSTOM',
}

export enum CampaignType {
  ROAST = 'roast',
  MEME = 'meme',
  CREATIVE = 'creative',
  ANALYSIS = 'analysis',
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum SubmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  FLAGGED = 'FLAGGED',
}

export enum BlockStatus {
  PENDING = 'PENDING',
  MINED = 'MINED',
  CONFIRMED = 'CONFIRMED',
}

export enum RewardType {
  MINING = 'MINING',
  CAMPAIGN_WIN = 'CAMPAIGN_WIN',
  REFERRAL = 'REFERRAL',
  BONUS = 'BONUS',
}

export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum MetricType {
  SUBMISSIONS = 'SUBMISSIONS',
  EARNINGS = 'EARNINGS',
  ENGAGEMENT = 'ENGAGEMENT',
  QUALITY_SCORE = 'QUALITY_SCORE',
}

export enum TimeGranularity {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

// Common interfaces
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface SocketEvent {
  type: string;
  data: any;
  timestamp: string;
  minerId?: number;
}

export interface MinerHeartbeat {
  status: MinerStatus;
  isAvailable: boolean;
  roastBalance?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface ContentSubmissionData {
  campaignId: number;
  content: string;
  tokensSpent: number;
  transactionHash: string;
  metadata?: Record<string, any>;
}

export interface CampaignFilters {
  category?: string;
  campaignType?: CampaignType;
  status?: CampaignStatus;
  limit?: number;
}

export interface MinerRegistrationData {
  walletAddress: string;
  username?: string;
  nickname?: string;
  agentName?: string;
  agentPersonality: AgentPersonality;
  llmProvider: LLMProvider;
  llmModel?: string;
}

export interface SocialConnectionData {
  platform: string;
  username: string;
  accessToken?: string;
  refreshToken?: string;
  profileData?: Record<string, any>;
}

export interface ContentScoringWeights {
  humor: number;
  engagement: number;
  originality: number;
  relevance: number;
  personality: number;
}

export interface BlockData {
  blockNumber: number;
  minerIds: number[];
  submissions: number[];
  timestamp: Date;
  hash?: string;
}

export interface RewardCalculation {
  baseReward: number;
  bonusMultiplier: number;
  finalReward: number;
  breakdown: Record<string, number>;
} 