'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { 
  DocumentDuplicateIcon,
  EyeIcon,
  StarIcon,
  CurrencyDollarIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'

interface ContentItem {
  id: number
  content_text: string
  content_images?: any
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
  winning_bid: {
    amount: number
    currency: string
    bid_date: string
  }
}

export default function YapperMyContent() {
  const { address } = useAccount()

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

  const postToTwitter = (text: string) => {
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
    window.open(twitterUrl, '_blank')
  }

  // Fetch yapper's won content
  const { data: content, isLoading } = useQuery({
    queryKey: ['yapper-content', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/my-content/yapper/wallet/${address}`)
        if (response.ok) {
          const data = await response.json()
          console.log('📦 Fetched yapper content:', data)
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching yapper content:', error)
        return []
      }
    },
    refetchInterval: 30000,
    enabled: !!address, // Only run query when address is available
  })

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Content</h1>
            <p className="text-gray-600">Content you've won through bidding and own</p>
          </div>
        </div>

        {/* Content Display */}
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="card-content space-y-4">
                  <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-32 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
          <div className="space-y-8">
            {content.map((item: ContentItem) => {
              const { text, imageUrl } = formatTwitterContent(item.content_text)
              const hashtags = extractHashtags(text)
              
              return (
                <div key={item.id} className="card hover:shadow-xl transition-all duration-300 border-l-4 border-l-green-500">
                  <div className="card-content space-y-6">
                    {/* Header with Creator Info */}
                    <div className="flex items-center justify-between pb-4 border-b border-gray-200">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold">
                            {item.creator.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-gray-900">{item.creator.username}</p>
                            {item.agent_name && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                🤖 {item.agent_name}
                              </span>
                            )}
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                              ✅ Owned
                            </span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <StarIconSolid className="h-3 w-3 text-yellow-400" />
                            <span className="text-xs text-gray-500">{item.creator.reputation_score} reputation</span>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500">Won {formatTimeAgo(item.winning_bid.bid_date)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center space-x-2">
                          <span className="status-indicator status-active text-xs">
                            {item.campaign.platform_source}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{item.campaign.title}</p>
                      </div>
                    </div>

                    {/* Twitter-Ready Content Display */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-blue-600 flex items-center">
                          🐦 Twitter-Ready Content
                        </h4>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => copyToClipboard(text)}
                            className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition-colors flex items-center"
                          >
                            <DocumentDuplicateIcon className="h-3 w-3 mr-1" />
                            Copy
                          </button>
                          <button
                            onClick={() => postToTwitter(text)}
                            className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition-colors"
                          >
                            Post to Twitter
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {/* Twitter Text */}
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                          <div className="text-gray-900 whitespace-pre-wrap font-medium leading-relaxed">
                            {text}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
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
                        {(imageUrl || (item.content_images && item.content_images.length > 0)) && (
                          <div className="bg-white rounded-lg p-4 border border-gray-200">
                            <h5 className="text-sm font-semibold text-purple-600 mb-3 flex items-center">
                              🖼️ Generated Visuals
                            </h5>
                            <div className="space-y-4">
                              {/* Primary Image from AI Generation */}
                              {imageUrl && (
                                <div className="space-y-2">
                                  <div className="relative">
                                    <img 
                                      src={imageUrl} 
                                      alt="AI Generated content image"
                                      className="w-full max-w-md rounded-lg border border-gray-300 shadow-md"
                                      onLoad={() => console.log('✅ Primary image loaded:', imageUrl)}
                                      onError={(e) => {
                                        console.error('❌ Primary image failed to load:', imageUrl)
                                        e.currentTarget.style.display = 'none'
                                        const fallback = e.currentTarget.nextElementSibling as HTMLElement
                                        if (fallback) fallback.style.display = 'block'
                                      }}
                                    />
                                    <div 
                                      className="hidden bg-gradient-to-br from-gray-200 to-gray-300 rounded-lg border border-gray-300 p-8 text-center"
                                    >
                                      <span className="text-gray-600 text-sm">
                                        🖼️ AI Generated Image
                                        <br />
                                        <span className="text-xs text-gray-500">Preview not available</span>
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded font-mono break-all">
                                    <strong>Image URL:</strong> {imageUrl}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                        <div className="flex items-center space-x-2">
                          <EyeIcon className="h-4 w-4 text-blue-500" />
                          <span className="text-sm text-gray-600">Predicted Mindshare</span>
                        </div>
                        <p className="text-lg font-bold text-blue-600">{item.predicted_mindshare.toFixed(1)}%</p>
                      </div>
                      <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                        <div className="flex items-center space-x-2">
                          <StarIcon className="h-4 w-4 text-yellow-500" />
                          <span className="text-sm text-gray-600">Quality Score</span>
                        </div>
                        <p className="text-lg font-bold text-yellow-600">{item.quality_score.toFixed(1)}/100</p>
                      </div>
                    </div>

                    {/* Purchase Information */}
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-green-700">Purchase Details</h4>
                        <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full">
                          Winning Bid
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Amount Paid:</span>
                          <span className="text-green-700 font-bold ml-2">
                            {item.winning_bid.amount} {item.winning_bid.currency}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600">Purchase Date:</span>
                          <span className="text-gray-900 font-medium ml-2">
                            {new Date(item.winning_bid.bid_date).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <p className="text-xs text-green-600">
                          This content is now exclusively yours. You can use it for your Twitter campaigns.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No content owned yet</div>
            <div className="text-gray-500">Start bidding on content in the marketplace to see it here</div>
          </div>
        )}
      </div>
    </div>
  )
} 