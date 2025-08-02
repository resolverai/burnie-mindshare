'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  MagnifyingGlassIcon,
  FunnelIcon,
  ClockIcon,
  StarIcon,
  CurrencyDollarIcon,
  EyeIcon,
  HeartIcon,
  ChatBubbleLeftIcon,
  ArrowUpIcon
} from '@heroicons/react/24/outline'
import { 
  HeartIcon as HeartIconSolid,
  StarIcon as StarIconSolid 
} from '@heroicons/react/24/solid'

interface ContentItem {
  id: number
  content_text: string
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  creator: {
    username: string
    reputation_score: number
  }
  campaign: {
    title: string
    platform_source: string
    reward_token: string
  }
  bids: Array<{
    amount: number
    currency: string
    bidder: string
    is_winning: boolean
  }>
  highest_bid?: {
    amount: number
    currency: string
    bidder: string
  }
  total_bids: number
  created_at: string
  is_liked?: boolean
}

export default function BiddingInterface() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [selectedSort, setSelectedSort] = useState<string>('quality')
  const [showBidModal, setShowBidModal] = useState<ContentItem | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [bidCurrency, setBidCurrency] = useState<'ROAST' | 'USDC'>('ROAST')

  // Fetch content from marketplace API
  const { data: content, isLoading } = useQuery({
    queryKey: ['marketplace-content', searchQuery, selectedPlatform, selectedSort],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (searchQuery) params.append('search', searchQuery)
      if (selectedPlatform !== 'all') params.append('platform_source', selectedPlatform)
      params.append('sort_by', selectedSort)
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content?${params}`)
        if (response.ok) {
          const data = await response.json()
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching content:', error)
        return []
      }
    },
    refetchInterval: 30000,
  })

  const handleBid = async (contentId: number) => {
    if (!bidAmount || !showBidModal) return

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content_id: contentId,
          bid_amount: parseFloat(bidAmount),
          bid_currency: bidCurrency,
          yapper_id: 1 // TODO: Get from wallet/auth
        }),
      })

      if (response.ok) {
        // Refresh content and close modal
        setShowBidModal(null)
        setBidAmount('')
        // Refetch data
      }
    } catch (error) {
      console.error('Error placing bid:', error)
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    return `${Math.floor(diffInHours / 24)}d ago`
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 space-y-6">
        {/* Header and Filters */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Content Marketplace</h1>
            <p className="text-gray-600">Browse and bid on AI-generated content</p>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="input-field md:w-48"
            >
              <option value="all">All Platforms</option>
              <option value="cookie.fun">Cookie.fun</option>
              <option value="yaps.kaito.ai">Yaps.Kaito.AI</option>
              <option value="yap.market">Yap.Market</option>
            </select>

            <select
              value={selectedSort}
              onChange={(e) => setSelectedSort(e.target.value)}
              className="input-field md:w-48"
            >
              <option value="quality">Quality Score</option>
              <option value="mindshare">Predicted Mindshare</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
              <option value="newest">Newest First</option>
            </select>
          </div>
        </div>

        {/* Content Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="card-content space-y-4">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-20 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.map((item: ContentItem) => (
              <div key={item.id} className="card hover:shadow-lg transition-shadow">
                <div className="card-content space-y-4">
                  {/* Creator Info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">
                          {item.creator.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{item.creator.username}</p>
                        <div className="flex items-center space-x-1">
                          <StarIconSolid className="h-3 w-3 text-yellow-400" />
                          <span className="text-xs text-gray-500">{item.creator.reputation_score}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">{formatTimeAgo(item.created_at)}</span>
                  </div>

                  {/* Content */}
                  <div className="space-y-3">
                    <p className="text-gray-900 text-sm leading-relaxed line-clamp-4">
                      {item.content_text}
                    </p>
                    
                    {/* Campaign Tag */}
                    <div className="flex items-center space-x-2">
                      <span className="status-indicator status-active text-xs">
                        {item.campaign.platform_source}
                      </span>
                      <span className="text-xs text-gray-500 truncate">
                        {item.campaign.title}
                      </span>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center space-x-1">
                      <EyeIcon className="h-4 w-4 text-blue-500" />
                      <span className="text-gray-600">Mindshare:</span>
                      <span className="font-medium text-blue-600">{item.predicted_mindshare.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <StarIcon className="h-4 w-4 text-yellow-500" />
                      <span className="text-gray-600">Quality:</span>
                      <span className="font-medium text-yellow-600">{item.quality_score.toFixed(1)}</span>
                    </div>
                  </div>

                  {/* Bidding Info */}
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm text-gray-600">Asking Price</p>
                        <p className="font-bold text-lg text-gray-900">
                          {item.asking_price} <span className="text-sm text-gray-500">ROAST</span>
                        </p>
                      </div>
                      {item.highest_bid && (
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Highest Bid</p>
                          <p className="font-bold text-green-600">
                            {item.highest_bid.amount} {item.highest_bid.currency}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setShowBidModal(item)}
                        className="flex-1 btn-primary text-sm py-2"
                      >
                        <ArrowUpIcon className="h-4 w-4 mr-1" />
                        Place Bid
                      </button>
                      <button className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <HeartIcon className="h-4 w-4 text-gray-400" />
                      </button>
                    </div>

                    {/* Bid Count */}
                    {item.total_bids > 0 && (
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        {item.total_bids} bid{item.total_bids !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No content found</p>
            <p className="text-gray-400 text-sm">Try adjusting your search or filters</p>
          </div>
        )}

        {/* Bidding Modal */}
        {showBidModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md w-full mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">Place Bid</h3>
                <button
                  onClick={() => setShowBidModal(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* Content Preview */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-900 line-clamp-3">
                    {showBidModal.content_text}
                  </p>
                  <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                    <span>Quality: {showBidModal.quality_score.toFixed(1)}</span>
                    <span>Mindshare: {showBidModal.predicted_mindshare.toFixed(1)}%</span>
                  </div>
                </div>

                {/* Current Pricing */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Asking Price</p>
                    <p className="font-bold text-gray-900">{showBidModal.asking_price} ROAST</p>
                  </div>
                  {showBidModal.highest_bid && (
                    <div>
                      <p className="text-gray-600">Highest Bid</p>
                      <p className="font-bold text-green-600">
                        {showBidModal.highest_bid.amount} {showBidModal.highest_bid.currency}
                      </p>
                    </div>
                  )}
                </div>

                {/* Bid Input */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Your Bid Amount
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        placeholder="Enter amount"
                        className="input-field flex-1"
                        min="0"
                        step="0.1"
                      />
                      <select
                        value={bidCurrency}
                        onChange={(e) => setBidCurrency(e.target.value as 'ROAST' | 'USDC')}
                        className="input-field w-20"
                      >
                        <option value="ROAST">ROAST</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      💡 <strong>Tip:</strong> Higher bids increase your chances of winning premium content.
                      Consider the quality score and predicted mindshare when bidding.
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-3 pt-4">
                  <button
                    onClick={() => setShowBidModal(null)}
                    className="flex-1 btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleBid(showBidModal.id)}
                    disabled={!bidAmount || parseFloat(bidAmount) <= 0}
                    className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Place Bid
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 