const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface MarketplaceContent {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  // Video fields
  is_video?: boolean
  video_url?: string
  watermark_video_url?: string
  video_duration?: number
  subsequent_frame_prompts?: Record<string, string>
  clip_prompts?: Record<string, string>
  audio_prompt?: string
  creator: {
    id: number
    username: string
    reputation_score: number
    wallet_address?: string
  }
  campaign: {
    id: number
    title: string
    platform_source: string
    project_name?: string
    reward_token: string
  }
  agent_name?: string
  created_at: string
  post_type?: string
  approved_at?: string
  bidding_enabled_at?: string
}

export interface MarketplaceResponse {
  success: boolean
  data: MarketplaceContent[]
  pagination: {
    currentPage: number
    limit: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    nextPage: number | null
  }
}

export interface SearchSuggestions {
  platforms: string[]
  projects: string[]
  postTypes: string[]
}

export interface MarketplaceParams {
  search?: string
  platform_source?: string
  project_name?: string
  post_type?: string
  sort_by?: string
  page?: number
  limit?: number
}

const marketplaceService = {
  async getContent(params: MarketplaceParams = {}): Promise<MarketplaceResponse> {
    const queryParams = new URLSearchParams()
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        queryParams.append(key, value.toString())
      }
    })
    
    const url = `${API_BASE_URL}/api/marketplace/content?${queryParams.toString()}`
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch marketplace content: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        return data
      } else {
        throw new Error(data.message || 'Failed to fetch content')
      }
    } catch (error) {
      console.error('Marketplace service error:', error)
      throw error
    }
  },

  async getSearchSuggestions(): Promise<SearchSuggestions> {
    const url = `${API_BASE_URL}/api/marketplace/search-suggestions`
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch search suggestions: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        return data.data
      } else {
        throw new Error(data.message || 'Failed to fetch search suggestions')
      }
    } catch (error) {
      console.error('Search suggestions error:', error)
      throw error
    }
  },

  async purchaseContent(contentId: number, buyerWalletAddress: string, purchasePrice: number, currency: string = 'ROAST'): Promise<any> {
    const url = `${API_BASE_URL}/api/marketplace/purchase`
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          buyerWalletAddress,
          purchasePrice,
          currency
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to purchase content: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        return data
      } else {
        throw new Error(data.message || 'Purchase failed')
      }
    } catch (error) {
      console.error('Purchase service error:', error)
      throw error
    }
  }
}

export default marketplaceService
