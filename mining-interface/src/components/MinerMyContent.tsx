'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  DocumentDuplicateIcon,
  CheckIcon,
  XMarkIcon,
  EyeIcon,
  StarIcon,
  CalendarIcon,
  CurrencyDollarIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'

interface ContentItem {
  id: number
  content_text: string
  content_images?: string[]
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
  agent_name?: string
  created_at: string
  approved_at?: string
  is_biddable: boolean
  bidding_end_date?: string
  bidding_ask_price?: number
  bidding_enabled_at?: string
}

interface BiddingModalData {
  contentId: number
  currentPrice: number
  isEnabled: boolean
}

export default function MinerMyContent() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const [showBiddingModal, setShowBiddingModal] = useState<BiddingModalData | null>(null)
  const [biddingEndDate, setBiddingEndDate] = useState('')
  const [biddingAskPrice, setBiddingAskPrice] = useState('')

  // Content parsing functions (same as bidding interface)
  const extractImageUrl = (contentText: string): string | null => {
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i)
    if (prefixMatch) {
      return prefixMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i)
    if (dalleMatch) {
      return dalleMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i)
    if (blobMatch) {
      return blobMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    return null
  }

  const formatTwitterContent = (contentText: string): { text: string; imageUrl: string | null } => {
    const imageUrl = extractImageUrl(contentText)
    
    const lines = contentText.split('\n')
    let twitterText = ""
    
    for (const line of lines) {
      if (line.includes('📊 Content Stats') || 
          line.includes('🖼️ [Image will be attached') ||
          line.includes('💡 To post:')) {
        break
      }
      if (line.trim() && !line.includes('Image URL:')) {
        twitterText += line + "\n"
      }
    }
    
    return {
      text: twitterText.trim(),
      imageUrl
    }
  }

  const extractHashtags = (text: string): string[] => {
    const hashtagRegex = /#\w+/g
    return text.match(hashtagRegex) || []
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      console.log('✅ Copied to clipboard')
    } catch (err) {
      console.error('❌ Failed to copy:', err)
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const past = new Date(dateString)
    const diffInMinutes = Math.floor((now.getTime() - past.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `${diffInHours}h ago`
    
    return `${Math.floor(diffInHours / 24)}d ago`
  }

  // Fetch miner's content
  const { data: content, isLoading } = useQuery({
    queryKey: ['miner-content', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/my-content/miner/wallet/${address}`)
        const result = await response.json()
        return result.data || []
      } catch (error) {
        console.error('Error fetching content:', error)
        return []
      }
    },
    enabled: !!address
  })

  const biddingMutation = useMutation({
    mutationFn: async ({ contentId, is_biddable, biddingEndDate, biddingAskPrice }: {
      contentId: number
      is_biddable: boolean
      biddingEndDate?: string
      biddingAskPrice?: number
    }) => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/content/${contentId}/bidding`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_biddable,
          bidding_end_date: biddingEndDate,
          bidding_ask_price: biddingAskPrice,
          wallet_address: address
        }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to update bidding settings')
      }
      
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
      setShowBiddingModal(null)
    },
  })

  const handleBiddingToggle = (contentId: number, isEnabled: boolean) => {
    if (isEnabled) {
      // Show modal to set pricing and end date
      setShowBiddingModal({
        contentId,
        currentPrice: 0,
        isEnabled: false
      })
      setBiddingEndDate('')
      setBiddingAskPrice('')
    } else {
      // Disable bidding directly
      biddingMutation.mutate({
        contentId,
        is_biddable: false
      })
    }
  }

  const handleEnableBidding = () => {
    if (!showBiddingModal) return

    biddingMutation.mutate({
      contentId: showBiddingModal.contentId,
      is_biddable: true,
      biddingEndDate: biddingEndDate || undefined,
      biddingAskPrice: biddingAskPrice ? parseFloat(biddingAskPrice) : undefined
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white">My Content</h1>
            <p className="text-gray-400">Manage your approved content and bidding settings</p>
          </div>
        </div>

        {/* Content Display */}
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-6 animate-pulse">
                <div className="space-y-4">
                  <div className="h-6 bg-gray-700 rounded w-3/4"></div>
                  <div className="h-32 bg-gray-700 rounded"></div>
                  <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
          <div className="space-y-8">
            {content.map((item: ContentItem) => {
              // Use content_images array directly instead of extracting from text
              const text = item.content_text
              const imageUrl = item.content_images && item.content_images.length > 0 
                ? item.content_images[0] 
                : null
              const hashtags = extractHashtags(text)
              
              // Debug logging
              console.log('🖼️ MyContent: Content images array:', item.content_images)
              console.log('🖼️ MyContent: Selected image URL:', imageUrl)
              
              return (
                <div key={item.id} className="bg-gray-800/50 rounded-lg border border-gray-700 hover:border-orange-500/50 transition-all duration-300">
                  <div className="p-6 space-y-6">
                    {/* Header with Content Info */}
                    <div className="flex items-center justify-between pb-4 border-b border-gray-700">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold">
                            {item.creator.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-white">{item.creator.username}</p>
                            {item.agent_name && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                🤖 {item.agent_name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-1">
                            <StarIconSolid className="h-3 w-3 text-yellow-400" />
                            <span className="text-xs text-gray-400">{item.creator.reputation_score} reputation</span>
                            <span className="text-xs text-gray-500">•</span>
                            <span className="text-xs text-gray-400">{formatTimeAgo(item.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {item.campaign.platform_source}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{item.campaign.title}</p>
                      </div>
                    </div>

                    {/* Twitter-Ready Content Display */}
                    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-600">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-blue-400 flex items-center">
                          🐦 Twitter-Ready Content
                        </h4>
                        <button
                          onClick={() => copyToClipboard(text)}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition-colors flex items-center"
                        >
                          <DocumentDuplicateIcon className="h-3 w-3 mr-1" />
                          Copy Text
                        </button>
                      </div>
                      
                      <div className="space-y-4">
                        {/* Twitter Text */}
                        <div className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                          <div className="text-gray-200 whitespace-pre-wrap font-medium leading-relaxed">
                            {text}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                            <span>Characters: {text.length}/280</span>
                            {hashtags.length > 0 && (
                              <div className="flex items-center space-x-1">
                                <span>Hashtags:</span>
                                <div className="flex space-x-1">
                                  {hashtags.slice(0, 3).map((tag, index) => (
                                    <span key={index} className="bg-blue-100 text-blue-700 px-1 rounded text-xs">
                                      {tag}
                                    </span>
                                  ))}
                                  {hashtags.length > 3 && <span>+{hashtags.length - 3}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Visual Content */}
                        {imageUrl && (
                          <div className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                            <h5 className="text-sm font-semibold text-purple-400 mb-3 flex items-center">
                              🖼️ Generated Visuals
                            </h5>
                            <div className="space-y-4">
                              {/* AI Generated Image */}
                              <div className="space-y-2">
                                <div className="relative">
                                  <img 
                                    src={imageUrl} 
                                    alt="AI Generated content image"
                                    className="w-full max-w-md rounded-lg border border-gray-500 shadow-md"
                                    onLoad={() => console.log('✅ MyContent image loaded:', imageUrl)}
                                    onError={(e) => {
                                      console.error('❌ MyContent image failed to load:', imageUrl)
                                      e.currentTarget.style.display = 'none'
                                      const fallback = e.currentTarget.nextElementSibling as HTMLElement
                                      if (fallback) fallback.style.display = 'block'
                                    }}
                                  />
                                  <div 
                                    className="hidden bg-gradient-to-br from-gray-600 to-gray-700 rounded-lg border border-gray-500 p-8 text-center"
                                  >
                                    <span className="text-gray-300 text-sm">
                                      🖼️ AI Generated Image
                                      <br />
                                      <span className="text-xs text-gray-400">Preview not available</span>
                                    </span>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-400 bg-gray-800 p-2 rounded font-mono break-all">
                                  <strong>Image URL:</strong> {imageUrl}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-900/30 rounded-lg p-3 border border-blue-500/30">
                        <div className="flex items-center space-x-2">
                          <EyeIcon className="h-4 w-4 text-blue-400" />
                          <span className="text-sm text-gray-300">Predicted Mindshare</span>
                        </div>
                        <p className="text-lg font-bold text-blue-400">{item.predicted_mindshare.toFixed(1)}%</p>
                      </div>
                      <div className="bg-yellow-900/30 rounded-lg p-3 border border-yellow-500/30">
                        <div className="flex items-center space-x-2">
                          <StarIcon className="h-4 w-4 text-yellow-400" />
                          <span className="text-sm text-gray-300">Quality Score</span>
                        </div>
                        <p className="text-lg font-bold text-yellow-400">{item.quality_score.toFixed(1)}/100</p>
                      </div>
                    </div>

                    {/* Bidding Management Section */}
                    <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-600">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-semibold text-orange-400">Bidding Management</h4>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-300">Enable Bidding</span>
                          <input
                            type="checkbox"
                            checked={item.is_biddable}
                            onChange={(e) => handleBiddingToggle(item.id, e.target.checked)}
                            className="w-4 h-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500"
                          />
                        </div>
                      </div>

                      {item.is_biddable && (
                        <div className="space-y-3 pt-3 border-t border-gray-700">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            {item.bidding_ask_price && (
                              <div>
                                <span className="text-gray-400">Ask Price:</span>
                                <span className="text-white font-medium ml-2">{item.bidding_ask_price} ROAST</span>
                              </div>
                            )}
                            {item.bidding_end_date && (
                              <div>
                                <span className="text-gray-400">Ends:</span>
                                <span className="text-white font-medium ml-2">{new Date(item.bidding_end_date).toLocaleDateString()}</span>
                              </div>
                            )}
                          </div>
                          {item.bidding_enabled_at && (
                            <p className="text-xs text-green-400">
                              Bidding enabled {formatTimeAgo(item.bidding_enabled_at)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No approved content yet</div>
            <div className="text-gray-500">Start mining to create content that can be made available for bidding</div>
          </div>
        )}

        {/* Bidding Settings Modal */}
        {showBiddingModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl border border-gray-600 p-6 max-w-md w-full mx-4 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-4">Enable Bidding</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ask Price (ROAST)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={biddingAskPrice}
                    onChange={(e) => setBiddingAskPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter asking price"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Bidding End Date (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={biddingEndDate}
                    onChange={(e) => setBiddingEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave empty for no end date</p>
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowBiddingModal(null)}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEnableBidding}
                  disabled={biddingMutation.isPending}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                >
                  {biddingMutation.isPending ? 'Enabling...' : 'Enable Bidding'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 