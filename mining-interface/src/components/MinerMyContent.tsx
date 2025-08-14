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
import TweetThreadDisplay from './TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../utils/markdownParser'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[] // Array of tweet thread messages
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
  post_type?: string // Type of post: 'shitpost', 'longpost', or 'thread'
  status?: 'pending' | 'approved' | 'rejected' // Add status field
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
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

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
    
    // Start with the full content
    let cleanText = contentText
    
    // Remove image URL patterns from the text
    cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '')
    
    // Extract just the Twitter text (before the stats and metadata)
    const lines = cleanText.split('\n')
    let twitterText = ""
    
    for (const line of lines) {
      if (line.includes('📊 Content Stats') || 
          line.includes('🖼️ [Image will be attached') ||
          line.includes('💡 To post:') ||
          line.includes('AWSAccessKeyId=') ||
          line.includes('Signature=') ||
          line.includes('Expires=')) {
        break
      }
      
      const trimmedLine = line.trim()
      // Skip lines that are just URLs or AWS parameters
      if (trimmedLine && 
          !trimmedLine.startsWith('http') && 
          !trimmedLine.includes('AWSAccessKeyId') &&
          !trimmedLine.includes('Signature=') &&
          !trimmedLine.includes('Expires=')) {
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

  // Fetch miner's content (including pending content)
  const { data: content, isLoading } = useQuery({
    queryKey: ['miner-content', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/my-content/miner/wallet/${address}?include_pending=true`)
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

  // Approve content mutation
  const approveMutation = useMutation({
    mutationFn: async (contentId: number) => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/approve-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          walletAddress: address
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to approve content')
      }
      
      return response.json()
    },
    onSuccess: (data) => {
      console.log('✅ Content approved successfully:', data)
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
    },
    onError: (error) => {
      console.error('❌ Failed to approve content:', error)
      alert(`Failed to approve content: ${error.message}`)
    }
  })

  // Reject content mutation
  const rejectMutation = useMutation({
    mutationFn: async (contentId: number) => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/reject-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          walletAddress: address
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to reject content')
      }
      
      return response.json()
    },
    onSuccess: (data) => {
      console.log('✅ Content rejected successfully:', data)
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
    },
    onError: (error) => {
      console.error('❌ Failed to reject content:', error)
      alert(`Failed to reject content: ${error.message}`)
    }
  })

  const handleEnableBidding = () => {
    if (!showBiddingModal) return

    biddingMutation.mutate({
      contentId: showBiddingModal.contentId,
      is_biddable: true,
      biddingEndDate: biddingEndDate || undefined,
      biddingAskPrice: biddingAskPrice ? parseFloat(biddingAskPrice) : undefined
    })
  }

  // Filter content based on search term and status
  const filteredContent = content?.filter((item: ContentItem) => {
    // Status filter
    const statusMatch = statusFilter === 'all' || 
      (statusFilter === 'pending' && item.status === 'pending') ||
      (statusFilter === 'approved' && (item.status === 'approved' || !item.status)) || // Backward compatibility
      (statusFilter === 'rejected' && item.status === 'rejected')
    
    if (!statusMatch) return false
    
    // Search filter
    if (!searchTerm) return true
    
    const searchLower = searchTerm.toLowerCase()
    const textMatch = item.content_text?.toLowerCase().includes(searchLower)
    const campaignMatch = item.campaign?.title?.toLowerCase().includes(searchLower)
    const agentMatch = item.agent_name?.toLowerCase().includes(searchLower)
    const threadMatch = item.tweet_thread?.some(tweet => tweet.toLowerCase().includes(searchLower))
    
    return textMatch || campaignMatch || agentMatch || threadMatch
  }) || []

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white">My Content</h1>
            <p className="text-gray-400">Manage your content, approve pending items, and configure bidding settings</p>
          </div>
          
          {/* Search and Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Bar */}
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search your content..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            
            {/* Status Filter Dropdown */}
            <div className="relative sm:w-48">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pending' | 'approved' | 'rejected')}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="pending">🟡 Pending</option>
                <option value="approved">🟢 Approved</option>
                <option value="rejected">🔴 Rejected</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Content Stats */}
        {content && content.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
              <div className="text-2xl font-bold text-white">
                {content.length}
              </div>
              <div className="text-sm text-gray-400">Total Content</div>
            </div>
            <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-600/30">
              <div className="text-2xl font-bold text-yellow-400">
                {content.filter(item => item.status === 'pending').length}
              </div>
              <div className="text-sm text-yellow-300">Pending Review</div>
            </div>
            <div className="bg-green-900/20 rounded-lg p-4 border border-green-600/30">
              <div className="text-2xl font-bold text-green-400">
                {content.filter(item => item.status === 'approved' || !item.status).length}
              </div>
              <div className="text-sm text-green-300">Approved</div>
            </div>
            <div className="bg-red-900/20 rounded-lg p-4 border border-red-600/30">
              <div className="text-2xl font-bold text-red-400">
                {content.filter(item => item.status === 'rejected').length}
              </div>
              <div className="text-sm text-red-300">Rejected</div>
            </div>
          </div>
        )}

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
        ) : filteredContent && filteredContent.length > 0 ? (
          <div className="space-y-8">
            {filteredContent.map((item: ContentItem) => {
              // Check if this is a longpost that should be rendered as markdown
              const shouldUseMarkdown = isMarkdownContent(item.post_type)
              
              // FORCE TEST: Check if content has markdown syntax
              const hasMarkdownSyntax = item.content_text?.includes('##') || item.content_text?.includes('**')
              
              // FORCE TEST: Override markdown detection for testing
              const forceMarkdown = hasMarkdownSyntax // Force markdown if we detect markdown syntax
              
              // For longposts, use raw content; for others, use parsed content
              const { text, imageUrl: extractedImageUrl } = (shouldUseMarkdown || forceMarkdown)
                ? { text: item.content_text, imageUrl: null }
                : formatTwitterContent(item.content_text)
              
              // Use content_images array if available, otherwise fall back to extracted URL
              const imageUrl = item.content_images && item.content_images.length > 0 
                ? item.content_images[0] 
                : extractedImageUrl
              const hashtags = extractHashtags(text)
              
              // Debug logging
              console.log('🖼️ MyContent: Content images array:', item.content_images)
              console.log('🖼️ MyContent: Selected image URL:', imageUrl)
              console.log('🔍 MyContent: Post type:', item.post_type)
              console.log('🔍 MyContent: Should use markdown:', shouldUseMarkdown)
              console.log('🔍 MyContent: Has markdown syntax:', hasMarkdownSyntax)
              console.log('🔍 MyContent: Force markdown:', forceMarkdown)
              console.log('🔍 MyContent: Raw content length:', item.content_text?.length)
              console.log('🔍 MyContent: Processed text length:', text?.length)
              console.log('🔍 MyContent: Raw content preview:', item.content_text?.substring(0, 200))
              console.log('🔍 MyContent: Processed text preview:', text?.substring(0, 200))
              
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
                          {/* Status Badge */}
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            item.status === 'approved' ? 'bg-green-100 text-green-700' :
                            item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            item.status === 'rejected' ? 'bg-red-100 text-red-700' :
                            'bg-green-100 text-green-700' // Default to approved for backward compatibility
                          }`}>
                            {item.status === 'approved' ? 'Approved' :
                             item.status === 'pending' ? 'Pending' :
                             item.status === 'rejected' ? 'Rejected' :
                             'Approved'}
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
                      
                      {/* Content Display - Markdown for longposts, regular for others */}
                      {forceMarkdown ? (
                        // Render longpost with markdown formatting
                        <div className="relative">
                          <div className="absolute top-2 right-2 z-10">
                            <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(item.post_type).className}`}>
                              {getPostTypeInfo(item.post_type).text}
                            </span>
                          </div>
                          {renderMarkdown(text, { className: 'longpost-content' })}
                          {imageUrl && (
                            <div className="mt-3 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                              <img 
                                src={imageUrl} 
                                alt="Content image" 
                                className="w-full h-auto object-contain"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.style.display = 'none'
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        // Use regular TweetThreadDisplay for other post types
                        <div className="relative">
                          <div className="absolute top-2 right-2 z-10">
                            <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(item.post_type).className}`}>
                              {getPostTypeInfo(item.post_type).text}
                            </span>
                          </div>
                          <TweetThreadDisplay
                            mainTweet={text}
                            tweetThread={item.tweet_thread}
                            imageUrl={imageUrl}
                            characterCount={text.length}
                            hashtags={hashtags}
                            showImage={true}
                            isProtected={false} // Mining interface doesn't need protection for owned content
                          />
                        </div>
                      )}
                      
                      {/* Image URL display for mining interface */}
                        {imageUrl && (
                        <div className="mt-4 text-xs text-gray-400 bg-gray-800 p-2 rounded font-mono break-all">
                                  <strong>Image URL:</strong> {imageUrl}
                          </div>
                        )}
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

                    {/* Approve/Reject Section for Pending Content */}
                    {item.status === 'pending' && (
                      <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-600/50">
                        <h4 className="text-sm font-semibold text-yellow-400 mb-4">Content Review Required</h4>
                        <div className="flex space-x-4">
                          <button
                            onClick={() => {
                              console.log('🔍 Approve button clicked for content ID:', item.id, 'with wallet:', address)
                              approveMutation.mutate(item.id)
                            }}
                            disabled={approveMutation.isPending}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
                          >
                            <CheckIcon className="h-5 w-5 mr-2" />
                            {approveMutation.isPending ? 'Approving...' : 'Approve & Publish'}
                          </button>
                          <button
                            onClick={() => {
                              console.log('🔍 Reject button clicked for content ID:', item.id, 'with wallet:', address)
                              rejectMutation.mutate(item.id)
                            }}
                            disabled={rejectMutation.isPending}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
                          >
                            <XMarkIcon className="h-5 w-5 mr-2" />
                            {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Bidding Management Section - Only show for approved content */}
                    {(item.status === 'approved' || !item.status) && (
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
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">
              {searchTerm ? 'No content matches your search' : 
               statusFilter === 'pending' ? 'No pending content' :
               statusFilter === 'approved' ? 'No approved content' :
               statusFilter === 'rejected' ? 'No rejected content' :
               'No content yet'}
            </div>
            <div className="text-gray-500">
              {searchTerm ? 'Try adjusting your search terms or status filter' : 
               statusFilter === 'pending' ? 'Content awaiting review will appear here' :
               statusFilter === 'approved' ? 'Approved content will appear here' :
               statusFilter === 'rejected' ? 'Rejected content will appear here' :
               'Start mining to create content that can be reviewed and published'}
            </div>
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