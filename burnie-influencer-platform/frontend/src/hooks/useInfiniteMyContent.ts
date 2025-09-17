import { useInfiniteQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'

interface MyContentItem {
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
    project_name?: string
    reward_token: string
  }
  agent_name?: string
  created_at: string
  approved_at: string
  purchased_at: string
  acquisition_type: 'purchase'
  payment_details: {
    payment_currency: string
    conversion_rate: number
    original_roast_price: number
    miner_payout_roast: number
  }
  transaction_hash?: string
  treasury_transaction_hash?: string
  // Text-only regeneration support
  updatedTweet?: string
  updatedThread?: string[]
  imagePrompt?: string
}

interface MyContentResponse {
  success: boolean
  data: MyContentItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
  metadata: {
    total: number
    won_bids: number
    direct_purchases: number
  }
}

interface UseInfiniteMyContentParams {
  search?: string
  platform_source?: string
  project_name?: string
  post_type?: string
  limit?: number
}

const fetchMyContent = async (
  walletAddress: string,
  page: number,
  params: UseInfiniteMyContentParams
): Promise<MyContentResponse> => {
  const searchParams = new URLSearchParams({
    page: page.toString(),
    limit: (params.limit || 18).toString(),
  })

  if (params.search) searchParams.append('search', params.search)
  if (params.platform_source && params.platform_source !== 'all') {
    searchParams.append('platform_source', params.platform_source)
  }
  if (params.project_name && params.project_name !== 'all') {
    searchParams.append('project_name', params.project_name)
  }
  if (params.post_type && params.post_type !== 'all') {
    searchParams.append('post_type', params.post_type)
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/my-content/yapper/wallet/${walletAddress}?${searchParams.toString()}`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch my content')
  }

  return response.json()
}

export const useInfiniteMyContent = (params: UseInfiniteMyContentParams = {}) => {
  const { address } = useAccount()

  return useInfiniteQuery({
    queryKey: ['my-content', address, params],
    queryFn: ({ pageParam = 1 }) => {
      if (!address) throw new Error('Wallet not connected')
      return fetchMyContent(address, pageParam, params)
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage.pagination.hasNextPage) return undefined
      return lastPage.pagination.page + 1
    },
    enabled: !!address,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
