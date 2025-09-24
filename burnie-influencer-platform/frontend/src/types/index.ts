export interface User {
  id: string
  username: string
  email: string
  wallet_address?: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string
  website_url?: string
  created_by: string
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
  campaigns?: Campaign[]
}

export interface Campaign {
  id: string
  project_id?: string
  projectName?: string
  projectLogo?: string
  title: string
  description: string
  tokenTicker?: string
  category: string
  campaignType: string
  platformSource?: string
  rewardPool: number | string
  maxYappers?: number
  brandGuidelines?: string
  max_submissions?: number
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_date?: string
  end_date?: string
  created_at: string
  updated_at: string
  submissions_count?: number
  current_submissions?: number
  project?: Project
  // Legacy fields for backward compatibility
  topic?: string
  guidelines?: string
  budget?: number
  reward_per_roast?: number
}

export interface Submission {
  id: string
  campaign_id: string
  miner_id: string
  content: string
  ai_provider: string
  personality_used: string
  content_hash: string
  ai_scores: {
    humor: number
    engagement: number
    originality: number
    relevance: number
    personality: number
    overall: number
  }
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
}

export interface Miner {
  id: string
  wallet_address: string
  username?: string
  agent_personality: 'savage' | 'witty' | 'chaotic' | 'legendary'
  total_earnings: number
  submissions_count: number
  average_score: number
  is_active: boolean
  last_active: string
  created_at: string
  updated_at: string
}

export interface Analytics {
  total_projects: number
  active_campaigns: number
  total_campaigns: number
  total_submissions: number
  total_miners: number
  pending_submissions: number
  approved_submissions: number
  rejected_submissions: number
  total_rewards_distributed: number
  avg_submission_score: number
  top_performing_campaigns: Array<{
    id: number
    title: string
    submission_count: number
    avg_score: number
    status: string
    budget: number
  }>
  recent_activity: Array<{
    type: string
    id: number
    title: string
    campaign_title: string
    status: string
    score: number
    created_at: string
  }>
  growth_metrics: {
    projects_growth: number
    campaigns_growth: number
    submissions_growth: number
    current_period: {
      projects: number
      campaigns: number
      submissions: number
    }
    previous_period: {
      projects: number
      campaigns: number
      submissions: number
    }
  }
  performance_metrics: {
    avg_submissions_per_campaign: number
    approval_rate: number
    avg_reward_per_submission: number
    active_campaign_percentage: number
  }
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface CreateProjectRequest {
  name: string
  description: string
  website?: string
}

export interface CreateCampaignRequest {
  projectId?: number
  title: string
  description: string
  category: string
  campaignType: string
  rewardPool: string
  entryFee?: number
  maxSubmissions: number
  startDate: string
  endDate: string
  requirements?: any
  metadata?: any
  isActive?: boolean
}

export interface VideoContent {
  is_video: boolean
  video_url?: string
  watermark_video_url?: string
  video_duration?: number
  subsequent_frame_prompts?: Record<string, string>
  clip_prompts?: Record<string, string>
  audio_prompt?: string
}

export interface ContentItem extends VideoContent {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images: string[]
  watermark_image?: string
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  post_type?: string
  creator: {
    username: string
    reputation_score: number
  }
  campaign: {
    title: string
    platform_source: string
    reward_token: string
  }
  agent_name?: string
  created_at: string
  approved_at?: string
  winning_bid?: {
    amount: number
    currency: string
    bid_date: string
  }
} 