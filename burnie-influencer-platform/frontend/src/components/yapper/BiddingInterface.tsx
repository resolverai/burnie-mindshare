'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { 
  MagnifyingGlassIcon,
  FunnelIcon,
  ClockIcon,
  StarIcon,
  CurrencyDollarIcon,
  EyeIcon,
  HeartIcon,
  ChatBubbleLeftIcon,
  ArrowUpIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { 
  HeartIcon as HeartIconSolid,
  StarIcon as StarIconSolid 
} from '@heroicons/react/24/solid'

interface ContentItem {
  id: number
  content_text: string
  content_images?: string[] // Array of image URLs
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
  agent_name?: string
}

export default function BiddingInterface() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [selectedSort, setSelectedSort] = useState<string>('quality')
  const [showBidModal, setShowBidModal] = useState<ContentItem | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [bidCurrency, setBidCurrency] = useState<'ROAST' | 'USDC' | 'KAITO' | 'COOKIE' | 'AXR' | 'NYKO'>('ROAST')
  const [showCopyProtectionModal, setShowCopyProtectionModal] = useState(false)
  const [isScreenshotDetected, setIsScreenshotDetected] = useState(false)
  const [watermarkPosition, setWatermarkPosition] = useState({ x: 0, y: 0 })
  
  // Content parsing functions similar to mining interface
  const extractImageUrl = (contentText: string): string | null => {
    // Pattern 1: Look for Image URL: prefix (backend format)
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i)
    if (prefixMatch) {
      return prefixMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    // Pattern 2: Look for OpenAI DALL-E URLs specifically
    const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i)
    if (dalleMatch) {
      return dalleMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    // Pattern 3: General blob URL detection
    const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i)
    if (blobMatch) {
      return blobMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    return null
  }

  const formatTwitterContent = (contentText: string): { text: string; imageUrl: string | null } => {
    const imageUrl = extractImageUrl(contentText)
    
    // Extract just the Twitter text (before the stats)
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

  // Generate a consistent miner ID from username
  const generateMinerId = (username: string): string => {
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash).toString().slice(0, 6).padStart(6, '0')
    return `MINER-${minerId}`
  }

  // Copy protection modal component
  const CopyProtectionModal = () => (
    showCopyProtectionModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
        <div className="bg-white rounded-lg p-8 max-w-md mx-4 text-center">
          <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-4">Content Protected</h3>
          <p className="text-gray-600 mb-6">
            This content is proprietary and protected. Copying, screenshots, and screen recording are prohibited. 
            You can only access this content after winning the bid auction.
          </p>
          <button
            onClick={() => setShowCopyProtectionModal(false)}
            className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    )
  )

  // Get wallet address and connection status
  const { address, isConnected } = useAccount()

  // Screenshot protection functions
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // User switched away - potential screenshot attempt
      setIsScreenshotDetected(true)
      setTimeout(() => setIsScreenshotDetected(false), 3000)
    }
  }

  const handleBlur = () => {
    // Window lost focus - potential screenshot attempt
    setIsScreenshotDetected(true)
    setTimeout(() => setIsScreenshotDetected(false), 2000)
  }

  const preventScreenshot = () => {
    setShowCopyProtectionModal(true)
  }

  // Block screen capture APIs
  const blockScreenCapture = () => {
    // Block getDisplayMedia (screen sharing/recording)
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia
      navigator.mediaDevices.getDisplayMedia = () => {
        preventScreenshot()
        return Promise.reject(new Error('Screen capture blocked'))
      }
    }

    // Block getUserMedia for screen capture
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia
      navigator.mediaDevices.getUserMedia = (constraints: any) => {
        if (constraints?.video?.mediaSource === 'screen') {
          preventScreenshot()
          return Promise.reject(new Error('Screen capture blocked'))
        }
        return originalGetUserMedia.call(navigator.mediaDevices, constraints)
      }
    }
  }

  // Dynamic watermark positioning
  useEffect(() => {
    const moveWatermark = () => {
      setWatermarkPosition({
        x: Math.random() * 70, // 0-70% to keep within bounds
        y: Math.random() * 70
      })
    }
    
    moveWatermark() // Initial position
    const interval = setInterval(moveWatermark, 2000) // Move every 2 seconds (faster)
    return () => clearInterval(interval)
  }, [])

  // Copy protection functions
  const preventCopy = (e: Event) => {
    e.preventDefault()
    setShowCopyProtectionModal(true)
    return false
  }

  const preventRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowCopyProtectionModal(true)
  }

  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault()
    setShowCopyProtectionModal(true)
  }

  const preventImageRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowCopyProtectionModal(true)
  }

  const preventKeyboardCopy = (e: React.KeyboardEvent) => {
    // Prevent Ctrl+C, Ctrl+A, Ctrl+S, Ctrl+P, etc. but allow arrow keys for scrolling
    if (e.ctrlKey || e.metaKey) {
      if (['c', 'a', 's', 'p', 'v', 'x'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        setShowCopyProtectionModal(true)
      }
    }
    // Prevent F12, Ctrl+Shift+I, etc.
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
      e.preventDefault()
      setShowCopyProtectionModal(true)
    }
  }

  // Add copy protection and screenshot detection on component mount
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => preventCopy(e)
    const handleCut = (e: ClipboardEvent) => preventCopy(e)
    const handlePrint = (e: Event) => preventCopy(e)
    const handleSelectStart = (e: Event) => preventCopy(e)
    
    // Screenshot detection events
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    
    // Copy protection events
    document.addEventListener('copy', handleCopy)
    document.addEventListener('cut', handleCut)
    document.addEventListener('selectstart', handleSelectStart)
    document.addEventListener('dragstart', preventCopy)
    window.addEventListener('beforeprint', handlePrint)
    
    // Block screen capture APIs
    blockScreenCapture()
    
    // Mobile screenshot detection (Android/iOS)
    const handleMobileScreenshot = () => {
      setIsScreenshotDetected(true)
      preventScreenshot()
      setTimeout(() => setIsScreenshotDetected(false), 5000)
    }
    
    // Android screenshot detection
    document.addEventListener('deviceorientation', handleMobileScreenshot)
    
    // Keyboard screenshot shortcuts
    const handleKeyboardScreenshot = (e: KeyboardEvent) => {
      // Windows: PrintScreen, Alt+PrintScreen, Win+PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault()
        preventScreenshot()
      }
      // Mac: Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5
      if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) {
        e.preventDefault()
        preventScreenshot()
      }
    }
    
    document.addEventListener('keydown', handleKeyboardScreenshot)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('cut', handleCut)
      document.removeEventListener('selectstart', handleSelectStart)
      document.removeEventListener('dragstart', preventCopy)
      window.removeEventListener('beforeprint', handlePrint)
      document.removeEventListener('deviceorientation', handleMobileScreenshot)
      document.removeEventListener('keydown', handleKeyboardScreenshot)
    }
  }, [])

  // Fetch content from marketplace API
  const { data: content, isLoading, refetch } = useQuery({
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
          console.log('📦 Fetched marketplace content:', data)
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
    if (!bidAmount || !showBidModal) {
      alert('Please enter a bid amount');
      return;
    }

    if (!isConnected || !address) {
      alert('Please connect your wallet first');
      return;
    }

    try {
      console.log('Placing bid with wallet address:', address);
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content_id: contentId,
          bid_amount: parseFloat(bidAmount),
          bid_currency: bidCurrency,
          wallet_address: address
        }),
      })

      const result = await response.json();
      console.log('Bid response:', result);

      if (response.ok) {
        alert(`Bid placed successfully! ${result.message}`);
        // Refresh content and close modal
        setShowBidModal(null)
        setBidAmount('')
        // Refetch data to show updated bids
        refetch();
      } else {
        console.error('Bid failed:', result);
        alert(`Failed to place bid: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error placing bid:', error)
      alert('Network error occurred while placing bid');
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
    <div 
      className={`bg-gray-50 h-screen select-none overflow-y-auto relative ${isScreenshotDetected ? 'blur-lg' : ''}`}
      onContextMenu={preventRightClick}
      onKeyDown={preventKeyboardCopy}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {/* Balanced Dynamic Watermarks - Less Distracting */}
      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-25 text-6xl font-black transform -rotate-45"
        style={{
          left: `${watermarkPosition.x}%`,
          top: `${watermarkPosition.y}%`,
          transition: 'all 2s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        PROTECTED CONTENT
      </div>
      
      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-20 text-4xl font-black transform rotate-12"
        style={{
          left: `${(watermarkPosition.x + 30) % 100}%`,
          top: `${(watermarkPosition.y + 20) % 100}%`,
          transition: 'all 2s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        NO SCREENSHOTS
      </div>

      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-22 text-5xl font-black transform -rotate-12"
        style={{
          left: `${(watermarkPosition.x + 55) % 100}%`,
          top: `${(watermarkPosition.y + 40) % 100}%`,
          transition: 'all 2s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        BID TO ACCESS
      </div>

      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-18 text-3xl font-black transform rotate-30"
        style={{
          left: `${(watermarkPosition.x + 15) % 100}%`,
          top: `${(watermarkPosition.y + 65) % 100}%`,
          transition: 'all 2s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        PREVIEW ONLY
      </div>

      {/* Screenshot Detection Overlay */}
      {isScreenshotDetected && (
        <div className="fixed inset-0 z-40 bg-red-500 bg-opacity-80 flex items-center justify-center">
          <div className="text-white text-center">
            <ExclamationTriangleIcon className="h-24 w-24 mx-auto mb-4" />
            <h2 className="text-4xl font-bold mb-4">SCREENSHOT DETECTED</h2>
            <p className="text-xl">This action has been logged</p>
          </div>
        </div>
      )}
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
              // Use content_images array directly instead of extracting from text
              const text = item.content_text
              const imageUrl = item.content_images && item.content_images.length > 0 
                ? item.content_images[0] 
                : null
              
              // Debug logging
              console.log('🖼️ BiddingInterface: Content images array:', item.content_images)
              console.log('🖼️ BiddingInterface: Selected image URL:', imageUrl)
              
              return (
                <div key={item.id} className="card hover:shadow-xl transition-all duration-300 border-l-4 border-l-orange-500">
                  <div className="card-content space-y-6">
                    {/* Header with Creator Info */}
                    <div className="flex items-center justify-between pb-4 border-b border-gray-200">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold">
                          {generateMinerId(item.creator.username).charAt(6).toUpperCase()}
                        </span>
                      </div>
                      <div>
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-gray-900">{generateMinerId(item.creator.username)}</p>
                            {item.agent_name && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                🤖 {item.agent_name}
                              </span>
                            )}
                          </div>
                        <div className="flex items-center space-x-1">
                          <StarIconSolid className="h-3 w-3 text-yellow-400" />
                            <span className="text-xs text-gray-500">{item.creator.reputation_score} reputation</span>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500">{formatTimeAgo(item.created_at)}</span>
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

                    {/* Clean Content Display */}
                    <div className="space-y-4">
                      {/* Tweet Text */}
                      <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-gray-900 whitespace-pre-wrap font-medium leading-relaxed">
                          {text}
                        </div>
                      </div>

                      {/* Image */}
                      {imageUrl && (
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                          <div className="relative">
                            <img 
                              src={imageUrl} 
                              alt="AI Generated content image"
                              className="w-full max-w-md rounded-lg border border-gray-300 shadow-md"
                              onLoad={() => console.log('✅ BiddingInterface image loaded:', imageUrl)}
                              onError={(e) => {
                                console.error('❌ BiddingInterface image failed to load:', imageUrl)
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget.nextElementSibling as HTMLElement
                                if (fallback) fallback.style.display = 'block'
                              }}
                              onDragStart={preventDrag}
                              onContextMenu={preventImageRightClick}
                              style={{ userSelect: 'none' }}
                            />
                            <div 
                              className="hidden bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg border border-gray-300 p-8 text-center"
                            >
                              <span className="text-gray-500 text-sm">
                                🖼️ AI Generated Image
                                <br />
                                <span className="text-xs text-gray-400">Preview not available</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
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

                    {/* Bidding Section */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-sm text-gray-600">Asking Price</p>
                          <p className="text-2xl font-bold text-gray-900">
                            {item.asking_price} <span className="text-base text-gray-500">ROAST</span>
                        </p>
                      </div>
                      {item.highest_bid && (
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Highest Bid</p>
                            <p className="text-xl font-bold text-green-600">
                              {item.highest_bid.amount} <span className="text-sm">{item.highest_bid.currency}</span>
                          </p>
                            <p className="text-xs text-gray-500">by {item.highest_bid.bidder}</p>
                        </div>
                      )}
                    </div>

                      <div className="flex space-x-3">
                      <button
                        onClick={() => setShowBidModal(item)}
                          className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
                      >
                          <ArrowUpIcon className="h-5 w-5 mr-2" />
                        Place Bid
                      </button>
                    </div>

                    {item.total_bids > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-500">{item.total_bids} bid{item.total_bids !== 1 ? 's' : ''} received</p>
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
            <MagnifyingGlassIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No content found</p>
            <p className="text-gray-400 text-sm">Try adjusting your search or filters, or check back later for new AI-generated content</p>
          </div>
        )}

        {/* Bidding Modal */}
        {showBidModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div 
              className={`bg-white rounded-xl border border-gray-200 p-6 max-w-4xl w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto relative select-none ${isScreenshotDetected ? 'blur-lg' : ''}`}
              onContextMenu={preventRightClick}
              onKeyDown={preventKeyboardCopy}
              style={{
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
            >
              {/* Enhanced Modal Watermarks */}
              <div 
                className="absolute pointer-events-none z-10 text-red-600 opacity-30 text-4xl font-black transform -rotate-45"
                style={{
                  left: `${watermarkPosition.x}%`,
                  top: `${watermarkPosition.y}%`,
                  transition: 'all 2s ease-in-out',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
                }}
              >
                PROTECTED
              </div>
              
              <div 
                className="absolute pointer-events-none z-10 text-red-600 opacity-25 text-3xl font-black transform rotate-45"
                style={{
                  right: `${watermarkPosition.x}%`,
                  bottom: `${watermarkPosition.y}%`,
                  transition: 'all 2s ease-in-out',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
                }}
              >
                NO SCREENSHOTS
              </div>

              <div 
                className="absolute pointer-events-none z-10 text-red-600 opacity-20 text-2xl font-black transform rotate-12"
                style={{
                  left: `${(watermarkPosition.x + 40) % 100}%`,
                  top: `${(watermarkPosition.y + 50) % 100}%`,
                  transition: 'all 2s ease-in-out',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
                }}
              >
                PREVIEW ONLY
              </div>

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
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-blue-600 mb-2">🐦 Content Preview</h4>
                    <div className="bg-white rounded-lg p-4 border border-gray-200 max-h-96 overflow-y-auto">
                      <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                        {showBidModal.content_text}
                      </p>
                    </div>
                    
                    {/* Image */}
                    {showBidModal.content_images && showBidModal.content_images.length > 0 && (
                      <div className="mt-4">
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                          <div className="relative max-w-md mx-auto">
                            <img 
                              src={showBidModal.content_images?.[0] || ''} 
                              alt="AI Generated content image"
                              className="w-full rounded-lg border border-gray-300 shadow-sm"
                              onLoad={() => console.log('✅ BidModal image loaded:', showBidModal.content_images?.[0])}
                              onError={(e) => {
                                console.error('❌ BidModal image failed to load:', showBidModal.content_images?.[0])
                                e.currentTarget.style.display = 'none'
                                const fallback = e.currentTarget.nextElementSibling as HTMLElement
                                if (fallback) fallback.style.display = 'block'
                              }}
                            />
                            <div 
                              className="hidden bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg border border-gray-300 p-8 text-center"
                            >
                              <span className="text-gray-500 text-sm">
                                🖼️ AI Generated Image
                                <br />
                                <span className="text-xs text-gray-400">Preview not available</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Current Pricing */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <p className="text-blue-600 font-medium">Asking Price</p>
                    <p className="font-bold text-blue-900 text-lg">{showBidModal.asking_price} ROAST</p>
                  </div>
                  {showBidModal.highest_bid && (
                    <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                      <p className="text-green-600 font-medium">Highest Bid</p>
                      <p className="font-bold text-green-700 text-lg">
                        {showBidModal.highest_bid.amount} {showBidModal.highest_bid.currency}
                      </p>
                    </div>
                  )}
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                    <p className="text-purple-600 font-medium">Total Bids</p>
                    <p className="font-bold text-purple-700 text-lg">{showBidModal.total_bids || 0}</p>
                  </div>
                </div>

                {/* Bid Input */}
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Your Bid Amount
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                      <input
                        type="number"
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        placeholder="Enter amount"
                          className="input-field w-full text-lg"
                        min="0"
                        step="0.1"
                      />
                      </div>
                      <div>
                      <select
                        value={bidCurrency}
                        onChange={(e) => setBidCurrency(e.target.value as 'ROAST' | 'USDC' | 'KAITO' | 'COOKIE' | 'AXR' | 'NYKO')}
                          className="input-field w-full text-lg"
                      >
                        <option value="ROAST">🔥 ROAST</option>
                        <option value="USDC">💰 USDC</option>
                        <option value="KAITO">🤖 KAITO</option>
                        <option value="COOKIE">🍪 COOKIE</option>
                        <option value="AXR">⚡ AXR</option>
                        <option value="NYKO">🎯 NYKO</option>
                      </select>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      💡 <strong>Tip:</strong> Higher bids increase your chances of winning premium content.
                      Consider the quality score and predicted mindshare when bidding.
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-4 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => setShowBidModal(null)}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleBid(showBidModal.id)}
                    disabled={!bidAmount || parseFloat(bidAmount) <= 0}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-orange-600"
                  >
                    Place Bid
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <CopyProtectionModal />
    </div>
  )
} 