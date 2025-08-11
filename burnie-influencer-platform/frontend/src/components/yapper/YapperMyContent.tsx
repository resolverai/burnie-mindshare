'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { 
  DocumentDuplicateIcon,
  EyeIcon,
  StarIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import TweetThreadDisplay from '../TweetThreadDisplay'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[] // Array of tweet thread messages
  content_images: string[]
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
  payment_details: {
    payment_currency: string
    conversion_rate: number
    original_roast_price: number
    miner_payout_roast: number
  }
  transaction_hash?: string // BaseScan transaction hash
  treasury_transaction_hash?: string // Treasury payout transaction hash
  acquisition_type: 'bid' | 'purchase' // How the content was acquired
}

export default function YapperMyContent() {
  const { address } = useAccount()
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedQuality, setSelectedQuality] = useState('all')
  const [sortBy, setSortBy] = useState('newest') // newest, oldest, price_high, price_low, quality

  // Content parsing functions
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

  const formatTwitterContent = (contentText: string): { text: string; hashtags: string[]; characterCount: number; imageUrl: string | null } => {
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
    
    const finalText = twitterText.trim()
    const hashtags = finalText.match(/#\w+/g) || []
    
    return {
      text: finalText,
      hashtags,
      characterCount: finalText.length,
      imageUrl
    }
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

  const downloadImage = async (imageUrl: string, filename: string = 'ai-generated-image.png') => {
    try {
      // Try direct download first (for new images with Content-Disposition header)
      let downloadUrl = imageUrl
      
      // For S3 URLs, try using the backend proxy for better Content-Disposition support
      if (imageUrl.includes('s3.amazonaws.com') || imageUrl.includes('amazonaws.com')) {
        try {
          // Extract S3 key from URL
          const urlParts = imageUrl.split('amazonaws.com/')[1]
          if (urlParts) {
            const s3Key = urlParts.split('?')[0] // Remove query parameters
            downloadUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/download-image/${s3Key}`
          }
        } catch (e) {
          console.log('Using original URL for download')
        }
      }
      
      const response = await fetch(downloadUrl)
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      console.log('✅ Image download initiated')
    } catch (error) {
      console.error('❌ Failed to download image:', error)
      // Fallback: open image in new tab
      window.open(imageUrl, '_blank')
    }
  }

  const postToTwitter = (mainTweet: string, tweetThread?: string[]) => {
    if (tweetThread && tweetThread.length > 0) {
      // For threads: start with first tweet and thread indicator
      const firstTweet = `${mainTweet}\n\n🧵 Thread (1/${tweetThread.length + 1})`
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(firstTweet)}`
      
      // Open Twitter with first tweet
      window.open(twitterUrl, '_blank')
      
      // Show thread helper modal with remaining tweets
      showThreadHelper(tweetThread)
    } else {
      // Single tweet: post normally
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(mainTweet)}`
      window.open(twitterUrl, '_blank')
    }
  }

  const showThreadHelper = (tweetThread: string[]) => {
    // Create a temporary modal showing remaining tweets with copy buttons
    const modalId = `thread-helper-${Date.now()}`
    const modalContent = `
      <div id="${modalId}" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: system-ui;">
        <div style="background: white; border-radius: 12px; padding: 24px; max-width: 500px; max-height: 80vh; overflow-y: auto;">
          <h3 style="margin: 0 0 16px 0; color: #1d4ed8;">🧵 Complete Your Thread</h3>
          <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 14px;">
            First tweet is ready to post! After posting, use the <strong>+ button</strong> on Twitter to add these replies:
          </p>
          ${tweetThread.map((tweet, index) => `
            <div style="margin: 12px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="color: #374151;">Tweet ${index + 2}:</strong>
                <button onclick="navigator.clipboard.writeText('${tweet.replace(/'/g, "\\'")}'); this.textContent='✅ Copied!'; setTimeout(() => this.textContent='📋 Copy', 2000)" 
                        style="padding: 4px 8px; background: #dbeafe; color: #1d4ed8; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  📋 Copy
                </button>
              </div>
              <div style="color: #374151; font-size: 14px; line-height: 1.4;">${tweet}</div>
            </div>
          `).join('')}
          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 13px;">
              💡 <strong>How to thread:</strong> After posting the first tweet, click the <strong>+ button</strong> on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.
            </p>
            <button onclick="const modal = document.getElementById('${modalId}'); if(modal) modal.remove();" 
                    style="width: 100%; padding: 8px; background: #1d4ed8; color: white; border: none; border-radius: 6px; cursor: pointer;">
              Got it! Close
            </button>
          </div>
        </div>
      </div>
    `
    
    const modalDiv = document.createElement('div')
    modalDiv.innerHTML = modalContent
    document.body.appendChild(modalDiv)
  }

  const generateMinerId = (username: string): string => {
    // Convert username to a consistent miner ID
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash) % 900000 + 100000 // 6-digit number
    return `MINER-${minerId}`
  }

  const getBaseScanUrl = (transactionHash: string): string => {
    // Base network explorer URL
    return `https://basescan.org/tx/${transactionHash}`
  }

  // Calculate actual amount paid by user based on payment currency
  const calculateActualAmountPaid = (item: ContentItem): { amount: number; currency: string } => {
    const { payment_details } = item
    
    if (payment_details.payment_currency === 'USDC') {
      // User paid in USDC: (purchase_price * conversion_rate) + 0.03 USDC fee
      const usdcAmount = (item.winning_bid.amount * payment_details.conversion_rate) + 0.03
      return {
        amount: Number(usdcAmount.toFixed(3)), // Round to 3 decimal places for USDC
        currency: 'USDC'
      }
    } else {
      // User paid in ROAST: use the normalized purchase_price from winning_bid
      return {
        amount: item.winning_bid.amount,
        currency: 'ROAST'
      }
    }
  }

  // Fetch yapper's purchased content (immediate purchase system)
  const { data: content, isLoading } = useQuery({
    queryKey: ['yapper-content', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/my-content/yapper/wallet/${address}`)
        if (response.ok) {
          const data = await response.json()
          console.log('📦 Fetched yapper purchased content:', data)
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching yapper purchased content:', error)
        return []
      }
    },
    refetchInterval: 30000,
    enabled: !!address, // Only run query when address is available
  })

  // Filter and sort content
  const filteredAndSortedContent = content ? content
    .filter((item: ContentItem) => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const contentMatch = item.content_text.toLowerCase().includes(searchLower)
        const campaignMatch = item.campaign.title.toLowerCase().includes(searchLower)
        const creatorMatch = item.creator.username.toLowerCase().includes(searchLower)
        if (!contentMatch && !campaignMatch && !creatorMatch) return false
      }
      
      // Platform filter
      if (selectedPlatform !== 'all' && item.campaign.platform_source !== selectedPlatform) {
        return false
      }
      
      // Quality filter
      if (selectedQuality !== 'all') {
        const minQuality = parseInt(selectedQuality)
        if (item.quality_score < minQuality) return false
      }
      
      return true
    })
    .sort((a: ContentItem, b: ContentItem) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.winning_bid.bid_date).getTime() - new Date(b.winning_bid.bid_date).getTime()
        case 'price_high':
          return b.winning_bid.amount - a.winning_bid.amount
        case 'price_low':
          return a.winning_bid.amount - b.winning_bid.amount
        case 'quality':
          return b.quality_score - a.quality_score
        case 'newest':
        default:
          return new Date(b.winning_bid.bid_date).getTime() - new Date(a.winning_bid.bid_date).getTime()
      }
    }) : []

  return (
    <div className="bg-gray-50 h-screen overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Content</h1>
            <p className="text-gray-600">Content you've purchased - ready to use for your campaigns</p>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search content, campaigns, or creators..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent lg:w-48"
            >
              <option value="all">All Platforms</option>
              <option value="cookie.fun">Cookie.fun</option>
              <option value="yaps.kaito.ai">Yaps.Kaito.AI</option>
              <option value="yap.market">Yap.Market</option>
              <option value="burnie">🔥 Burnie (Internal)</option>
            </select>

            <select
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent lg:w-48"
            >
              <option value="all">All Quality Scores</option>
              <option value="90">90+ (Excellent)</option>
              <option value="80">80+ (Good)</option>
              <option value="70">70+ (Fair)</option>
              <option value="60">60+ (Basic)</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent lg:w-48"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="price_high">Price: High to Low</option>
              <option value="price_low">Price: Low to High</option>
              <option value="quality">Quality: High to Low</option>
            </select>
          </div>
          
          {/* Results Summary */}
          {searchTerm && (
            <p className="text-sm text-gray-600">
              Found {filteredAndSortedContent.length} result{filteredAndSortedContent.length !== 1 ? 's' : ''} matching "{searchTerm}"
            </p>
          )}
          
          {/* Content Count */}
          {content && content.length > 0 && (
            <div className="flex justify-between items-center text-sm text-gray-600">
              <span>
                Showing {filteredAndSortedContent.length} of {content.length} items
              </span>
              {(selectedPlatform !== 'all' || selectedQuality !== 'all') && (
                <button
                  onClick={() => {
                    setSearchTerm('')
                    setSelectedPlatform('all')
                    setSelectedQuality('all')
                    setSortBy('newest')
                  }}
                  className="text-orange-600 hover:text-orange-700 font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content Display - 2 Column Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-md animate-pulse">
                <div className="p-4 space-y-4">
                  <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-32 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredAndSortedContent && filteredAndSortedContent.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredAndSortedContent.map((item: ContentItem) => {
              const { text, hashtags, characterCount, imageUrl } = formatTwitterContent(item.content_text)
              const displayImage = item.content_images && item.content_images.length > 0 
                ? item.content_images[0] 
                : imageUrl
              
              return (
                <div key={item.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 border border-gray-200">
                  <div className="p-4 space-y-4">
                    {/* Header with Creator Info */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold text-sm">
                            {item.creator.username.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-gray-900 text-sm">{item.creator.username}</p>
                            {item.agent_name && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                🤖 {item.agent_name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-1">
                            <StarIconSolid className="h-3 w-3 text-yellow-400" />
                            <span className="text-xs text-gray-500">{item.creator.reputation_score}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-gray-700 mb-1 max-w-32 truncate" title={item.campaign.title}>
                          📢 {item.campaign.title}
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          item.acquisition_type === 'purchase' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {item.acquisition_type === 'purchase' ? '🛒 Purchased' : '🏆 Won'}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">{formatTimeAgo(item.winning_bid.bid_date)}</p>
                      </div>
                    </div>

                    {/* Content Text with Thread Display */}
                    <TweetThreadDisplay
                      mainTweet={text}
                      tweetThread={item.tweet_thread}
                      imageUrl={displayImage}
                      characterCount={characterCount}
                      hashtags={hashtags}
                      showImage={false}
                      isProtected={false}
                    />
                    
                    {/* Action Buttons */}
                    <div className="flex space-x-2">
                      {displayImage && (
                        <button
                          onClick={() => downloadImage(displayImage, `ai-content-${item.id}.png`)}
                          className="flex-1 text-xs bg-green-100 text-green-700 px-3 py-2 rounded hover:bg-green-200 transition-colors flex items-center justify-center"
                        >
                          <ArrowDownTrayIcon className="h-3 w-3 mr-1" />
                          Download Image
                        </button>
                      )}
                      <button
                        onClick={() => postToTwitter(text, item.tweet_thread)}
                        className="flex-1 text-xs bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 transition-colors"
                      >
                        {item.tweet_thread && item.tweet_thread.length > 0 ? 'Post Thread to Twitter' : 'Post to Twitter'}
                      </button>
                    </div>
                    
                    {/* Posting Instructions */}
                    <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 border border-gray-200">
                      <span className="font-semibold text-gray-700">💡 Quick Post: </span>
                      {displayImage ? (
                        <>Download image → Post to Twitter → Attach downloaded image → Share!</>
                      ) : (
                        <>Click "Post to Twitter" → Review content → Share!</>
                      )}
                      {item.tweet_thread && item.tweet_thread.length > 0 && (
                        <span className="block mt-1 text-blue-600">
                          🧵 First tweet opens in Twitter, then use the <strong>+ button</strong> to add replies!
                        </span>
                      )}
                    </div>

                    {/* Image - No Watermark (Owned Content) */}
                    {displayImage && (
                      <div className="relative">
                        <div className="relative overflow-hidden rounded-lg border border-gray-300">
                          <img 
                            src={displayImage} 
                            alt="AI Generated content"
                            className="w-full h-auto object-cover rounded-lg"
                            onLoad={() => console.log('✅ My content image loaded:', displayImage)}
                            onError={(e) => {
                              console.error('❌ My content image failed to load:', displayImage)
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget.nextElementSibling as HTMLElement
                              if (fallback) fallback.style.display = 'block'
                            }}
                          />
                          
                          {/* "OWNED" Badge instead of watermarks */}
                          <div className="absolute top-2 right-2">
                            <div className="bg-green-600 text-white px-2 py-1 rounded-full text-xs font-bold flex items-center space-x-1">
                              <CheckCircleIcon className="h-3 w-3" />
                              <span>OWNED</span>
                            </div>
                          </div>
                          
                          <div 
                            className="hidden bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg p-8 text-center h-40 flex items-center justify-center"
                          >
                            <span className="text-gray-500 text-sm">
                              🖼️ AI Generated Image
                              <br />
                              <span className="text-xs text-gray-400">Preview not available</span>
                            </span>
                          </div>
                        </div>
                        
                        {/* Image URL Display */}
                        <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600 font-mono break-all border border-gray-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-semibold text-gray-700">🖼️ Image URL:</span>
                            <button
                              onClick={() => copyToClipboard(displayImage)}
                              className="text-blue-600 hover:text-blue-800 underline"
                              title="Copy image URL"
                            >
                              Copy
                            </button>
                          </div>
                          <div className="text-gray-800">
                            {displayImage}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                        <div className="flex items-center space-x-1">
                          <EyeIcon className="h-3 w-3 text-blue-500" />
                          <span className="text-xs text-gray-600">Mindshare</span>
                        </div>
                        <p className="text-sm font-bold text-blue-600">{item.predicted_mindshare.toFixed(1)}%</p>
                      </div>
                      <div className="bg-yellow-50 rounded-lg p-2 border border-yellow-200">
                        <div className="flex items-center space-x-1">
                          <StarIcon className="h-3 w-3 text-yellow-500" />
                          <span className="text-xs text-gray-600">Quality</span>
                        </div>
                        <p className="text-sm font-bold text-yellow-600">{item.quality_score.toFixed(1)}/100</p>
                      </div>
                    </div>

                    {/* Purchase Information */}
                    <div className={`rounded-lg p-3 border ${
                      item.acquisition_type === 'purchase' 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-blue-50 border-blue-200'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <CurrencyDollarIcon className={`h-4 w-4 ${
                            item.acquisition_type === 'purchase' ? 'text-green-600' : 'text-blue-600'
                          }`} />
                          <span className={`text-sm font-semibold ${
                            item.acquisition_type === 'purchase' ? 'text-green-700' : 'text-blue-700'
                          }`}>
                            {(() => {
                              const actualPayment = calculateActualAmountPaid(item)
                              return `Paid: ${actualPayment.amount} ${actualPayment.currency}`
                            })()}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(item.winning_bid.bid_date).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {/* Payment Details */}
                      {item.payment_details.payment_currency === 'USDC' && (
                        <div className="text-xs text-gray-600 bg-gray-100 rounded px-2 py-1 mb-2">
                          💡 Paid in USDC (includes 0.03 USDC fee) • Rate: {item.payment_details.conversion_rate.toFixed(4)} ROAST/USD
                        </div>
                      )}
                      
                      {/* Transaction Links */}
                      {item.acquisition_type === 'purchase' && item.transaction_hash && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600">Purchase Transaction:</span>
                            <a
                              href={getBaseScanUrl(item.transaction_hash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center space-x-1 hover:underline"
                            >
                              <span>View</span>
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-2 pt-2 border-t border-green-200">
                        <p className="text-xs text-green-600">
                          ✅ This content is exclusively yours. Ready to use for campaigns.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : content && content.length > 0 ? (
          /* No results after filtering */
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No content matches your filters</div>
            <div className="text-gray-500">Try adjusting your search or filter criteria</div>
          </div>
        ) : (
          /* No content at all */
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg mb-2">No content owned yet</div>
            <div className="text-gray-500">Purchase content from the marketplace to see it here</div>
          </div>
        )}
      </div>
    </div>
  )
} 