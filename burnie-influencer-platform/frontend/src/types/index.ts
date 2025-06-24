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
  title: string
  description: string
  contact_email: string
  website_url?: string
  created_by: string
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
  campaigns?: Campaign[]
}

export interface Campaign {
  id: string
  project_id: string
  title: string
  description: string
  topic: string
  guidelines?: string
  budget: number
  reward_per_roast: number
  max_submissions: number
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  start_date?: string
  end_date?: string
  created_at: string
  updated_at: string
  submissions_count?: number
  current_submissions?: number
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
  title: string
  description: string
  contact_email: string
  website_url?: string
}

export interface CreateCampaignRequest {
  project_id: string
  title: string
  description: string
  topic: string
  guidelines?: string
  budget: number
  reward_per_roast: number
  max_submissions: number
  start_date?: string
  end_date?: string
} 