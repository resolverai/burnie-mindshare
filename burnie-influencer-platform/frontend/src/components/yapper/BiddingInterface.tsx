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
  ExclamationTriangleIcon,
  ShoppingCartIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from '@heroicons/react/24/outline'
import { 
  HeartIcon as HeartIconSolid,
  StarIcon as StarIconSolid 
} from '@heroicons/react/24/solid'

// Import the new Purchase Content Modal
import PurchaseContentModal from './PurchaseContentModal'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance } from '../../utils/walletUtils'
import { useROASTPrice, convertROASTToUSDC, formatUSDCPrice } from '../../utils/priceUtils'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[] // Array of tweet thread messages
  content_images?: string[] // Array of image URLs
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  post_type?: string // Type of post: 'shitpost', 'longpost', or 'thread'
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
  const [searchTerm, setSearchTerm] = useState('')
  const { price: roastPrice } = useROASTPrice()
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedPostType, setSelectedPostType] = useState('all')
  const [sortBy, setSortBy] = useState<'mindshare' | 'quality'>('mindshare')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  // Keep bidding state for future use but don't expose UI for now
  const [showBidModal, setShowBidModal] = useState<ContentItem | null>(null)
  const [showPurchaseModal, setShowPurchaseModal] = useState<ContentItem | null>(null)
  const [bidAmount, setBidAmount] = useState('')
  const [bidCurrency, setBidCurrency] = useState<'ROAST' | 'USDC' | 'KAITO' | 'COOKIE' | 'AXR' | 'NYKO'>('ROAST')
  const [isPlacingBid, setIsPlacingBid] = useState(false)
  const [showCopyProtection, setShowCopyProtection] = useState(false)
  const [isScreenshotDetected, setIsScreenshotDetected] = useState(false)
  const [watermarkPosition, setWatermarkPosition] = useState({ x: 0, y: 0 })
  const [expandedLongposts, setExpandedLongposts] = useState<Set<number>>(new Set())
  
  // Price display component
  const PriceDisplay = ({ roastAmount }: { roastAmount: number }) => {
    const [usdcAmount, setUsdcAmount] = useState<number>(0)

    useEffect(() => {
      if (roastPrice > 0) {
        setUsdcAmount(roastAmount * roastPrice)
      }
    }, [roastAmount, roastPrice])

    return (
      <div className="flex flex-col">
        <div className="text-lg font-bold text-orange-600">
          {roastAmount} <span className="text-sm text-gray-500">ROAST</span>
        </div>
        {roastPrice > 0 && (
          <div className="text-sm text-gray-600">
            ({formatUSDCPrice(usdcAmount)} USDC)
          </div>
        )}
      </div>
    )
  }
  
  // Content parsing functions
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

  // Generate a consistent miner ID from username
  const generateMinerId = (username: string): string => {
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash).toString().slice(0, 6).padStart(6, '0')
    return `MINER-${minerId}`
  }

  // Toggle longpost expansion
  const toggleLongpostExpansion = (contentId: number) => {
    setExpandedLongposts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(contentId)) {
        newSet.delete(contentId)
      } else {
        newSet.add(contentId)
      }
      return newSet
    })
  }

  // Truncate longpost content for preview
  const truncateLongpost = (content: string, maxLength: number = 300): string => {
    if (content.length <= maxLength) return content
    
    // Find a good breaking point (end of sentence or paragraph)
    let truncatedContent = content.substring(0, maxLength)
    const lastSentence = truncatedContent.lastIndexOf('.')
    const lastParagraph = truncatedContent.lastIndexOf('\n\n')
    
    if (lastSentence > maxLength * 0.7) {
      truncatedContent = content.substring(0, lastSentence + 1)
    } else if (lastParagraph > maxLength * 0.5) {
      truncatedContent = content.substring(0, lastParagraph)
    }
    
    return truncatedContent + '...'
  }

  // Copy protection modal component
  const CopyProtectionModal = () => (
    showCopyProtection && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
        <div className="bg-white rounded-lg p-8 max-w-md mx-4 text-center">
          <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-4">Content Protected</h3>
          <p className="text-gray-600 mb-6">
            This content is proprietary and protected. Copying, screenshots, and screen recording are prohibited. 
            You can only access this content after purchasing it.
          </p>
          <button
            onClick={() => setShowCopyProtection(false)}
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
      setIsScreenshotDetected(true)
      setTimeout(() => setIsScreenshotDetected(false), 3000)
    }
  }

  const handleBlur = () => {
    setIsScreenshotDetected(true)
    setTimeout(() => setIsScreenshotDetected(false), 2000)
  }

  const preventScreenshot = () => {
    setShowCopyProtection(true)
  }

  // Block screen capture APIs
  const blockScreenCapture = () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia
      navigator.mediaDevices.getDisplayMedia = () => {
        preventScreenshot()
        return Promise.reject(new Error('Screen capture blocked'))
      }
    }

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
        x: Math.random() * 70,
        y: Math.random() * 70
      })
    }
    
    moveWatermark()
    const interval = setInterval(moveWatermark, 3000)
    return () => clearInterval(interval)
  }, [])

  // Copy protection functions
  const preventCopy = (e: Event) => {
    e.preventDefault()
    setShowCopyProtection(true)
    return false
  }

  const preventRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowCopyProtection(true)
  }

  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault()
    setShowCopyProtection(true)
  }

  const preventImageRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowCopyProtection(true)
  }

  const preventKeyboardCopy = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (['c', 'a', 's', 'p', 'v', 'x'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        setShowCopyProtection(true)
      }
    }
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
      e.preventDefault()
      setShowCopyProtection(true)
    }
  }

  // Add copy protection and screenshot detection on component mount
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => preventCopy(e)
    const handleCut = (e: ClipboardEvent) => preventCopy(e)
    const handlePrint = (e: Event) => preventCopy(e)
    const handleSelectStart = (e: Event) => preventCopy(e)
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('copy', handleCopy)
    document.addEventListener('cut', handleCut)
    document.addEventListener('selectstart', handleSelectStart)
    document.addEventListener('dragstart', preventCopy)
    window.addEventListener('beforeprint', handlePrint)
    
    blockScreenCapture()
    
    const handleMobileScreenshot = () => {
      setIsScreenshotDetected(true)
      preventScreenshot()
      setTimeout(() => setIsScreenshotDetected(false), 5000)
    }
    
    document.addEventListener('deviceorientation', handleMobileScreenshot)
    
    const handleKeyboardScreenshot = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        e.preventDefault()
        preventScreenshot()
      }
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
    queryKey: ['marketplace-content', searchTerm, selectedPlatform, selectedPostType],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (searchTerm) params.append('search', searchTerm)
      if (selectedPlatform !== 'all') params.append('platform_source', selectedPlatform)
              if (selectedPostType !== 'all') params.append('post_type', selectedPostType)
      
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

  // Handle purchase function
  const handlePurchase = async (contentId: number, price: number, currency: 'ROAST' | 'USDC' = 'ROAST') => {
    if (!address) {
      alert('Please connect your wallet to purchase content');
      return;
    }

    try {
      console.log('🛒 Starting purchase process for content:', contentId, 'Price:', price, currency);
      
      // Step 1: Check balance for selected currency
      console.log(`🔍 Checking ${currency} balance...`);
      let hasBalance = false;
      
      if (currency === 'ROAST') {
        hasBalance = await checkROASTBalance(address, price);
        if (!hasBalance) {
          alert(`Insufficient ROAST balance. You need ${price} ROAST tokens to purchase this content.`);
          return;
        }
      } else {
        hasBalance = await checkUSDCBalance(address, price);
        if (!hasBalance) {
          alert(`Insufficient USDC balance. You need ${price} USDC to purchase this content.`);
          return;
        }
      }

      // Step 2: Create purchase record
      console.log('📝 Creating purchase record...');
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          buyerWalletAddress: address,
          purchasePrice: price,
          currency: currency
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to initiate purchase');
      }

      console.log('✅ Purchase record created:', result);

      // Step 3: Execute token transfer to treasury
      const treasuryAddress = result.data.treasuryAddress || process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS;
      
      if (!treasuryAddress) {
        throw new Error('Treasury wallet address not configured');
      }

      console.log(`💰 Executing ${currency} token transfer...`);
      console.log(`📤 From: ${address}`);
      console.log(`📥 To: ${treasuryAddress}`);
      console.log(`💎 Amount: ${price} ${currency}`);

      let transferResult;
      if (currency === 'ROAST') {
        transferResult = await transferROAST(price, treasuryAddress);
      } else {
        transferResult = await transferUSDC(price, treasuryAddress);
      }
      
      if (!transferResult.success) {
        console.error('❌ Wallet transaction failed or cancelled:', transferResult.error);
        alert(`Payment failed or cancelled: ${transferResult.error}. The content remains available for purchase.`);
        // DO NOT refresh content list here - user cancelled or failed transaction
        return;
      }

      console.log('🎉 Wallet transaction successful:', transferResult.transactionHash);

      // Step 4: Transaction is verified by the wallet - proceed with confirmation
      console.log('✅ Transaction confirmed by wallet');

      // Step 5: Confirm purchase with backend
      console.log('📋 Confirming purchase with backend...');
      const confirmResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/purchase/${result.data.purchaseId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionHash: transferResult.transactionHash
        }),
      });

      const confirmResult = await confirmResponse.json();
      
      if (!confirmResponse.ok) {
        console.error('❌ Failed to confirm purchase:', confirmResult);
        alert('Payment completed but there was an issue confirming with our servers. Your transaction hash: ' + transferResult.transactionHash);
        return;
      }

      console.log('🎊 Purchase confirmed:', confirmResult);

      // Step 6: Trigger treasury-to-miner distribution
      console.log('💸 Triggering treasury-to-miner distribution...');
      try {
        const distributionResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/purchase/${result.data.purchaseId}/distribute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const distributionResult = await distributionResponse.json();
        
        if (distributionResponse.ok) {
          console.log('✅ Treasury distribution successful:', distributionResult);
        } else {
          console.warn('⚠️ Treasury distribution will be processed automatically:', distributionResult.message);
        }
      } catch (error) {
        console.warn('⚠️ Treasury distribution will be processed automatically:', error);
      }

      // ONLY refresh content list after successful purchase confirmation
      alert('🎉 Purchase successful! Content has been added to your library.');
      refetch(); // Refresh the content list only on successful purchase
      
    } catch (error) {
      console.error('❌ Purchase error:', error);
      alert(`Purchase failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // DO NOT refresh content list on error - content should remain available
    }
  }

  // Keep bidding function for future use (but don't expose in UI for now)
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
        setShowBidModal(null)
        setBidAmount('')
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
      {/* Dynamic Watermarks */}
      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-25 text-5xl font-black transform -rotate-45"
        style={{
          left: `${watermarkPosition.x}%`,
          top: `${watermarkPosition.y}%`,
          transition: 'all 3s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        PROTECTED CONTENT
      </div>
      
      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-20 text-3xl font-black transform rotate-12"
        style={{
          left: `${(watermarkPosition.x + 30) % 100}%`,
          top: `${(watermarkPosition.y + 20) % 100}%`,
          transition: 'all 3s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        NO SCREENSHOTS
      </div>

      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-22 text-4xl font-black transform -rotate-12"
        style={{
          left: `${(watermarkPosition.x + 55) % 100}%`,
          top: `${(watermarkPosition.y + 40) % 100}%`,
          transition: 'all 3s ease-in-out',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
        }}
      >
        BUY TO ACCESS
      </div>

      <div 
        className="fixed pointer-events-none z-30 text-red-600 opacity-18 text-2xl font-black transform rotate-30"
        style={{
          left: `${(watermarkPosition.x + 15) % 100}%`,
          top: `${(watermarkPosition.y + 65) % 100}%`,
          transition: 'all 3s ease-in-out',
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
            <p className="text-gray-600">Browse and purchase AI-generated content</p>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search content..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
              value={selectedPostType}
              onChange={(e) => setSelectedPostType(e.target.value)}
              className="input-field md:w-48"
            >
              <option value="all">All Post Types</option>
              <option value="thread">Thread</option>
              <option value="longpost">Long Post</option>
                              <option value="shitpost">Meme Post</option>
            </select>

            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [newSortBy, newSortOrder] = e.target.value.split('-') as ['mindshare' | 'quality', 'asc' | 'desc']
                setSortBy(newSortBy)
                setSortOrder(newSortOrder)
              }}
              className="input-field md:w-48"
            >
              <option value="mindshare-desc">Mindshare: High to Low</option>
              <option value="mindshare-asc">Mindshare: Low to High</option>
              <option value="quality-desc">Quality: High to Low</option>
              <option value="quality-asc">Quality: Low to High</option>
            </select>
          </div>
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
        ) : content && content.length > 0 ? (
          (() => {
            // Filter and sort content
            let filteredContent = content.filter((item: ContentItem) => {
              // Search filter
              const matchesSearch = !searchTerm || 
                item.content_text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.campaign.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.creator.username?.toLowerCase().includes(searchTerm.toLowerCase())
              
              // Platform filter
              const matchesPlatform = selectedPlatform === 'all' || 
                item.campaign.platform_source === selectedPlatform
              
              // Post type filter
              const matchesPostType = selectedPostType === 'all' || 
                (item.post_type || 'thread') === selectedPostType
              
              return matchesSearch && matchesPlatform && matchesPostType
            })
            
            // Sort content
            filteredContent.sort((a: ContentItem, b: ContentItem) => {
              let aValue: number, bValue: number
              
              if (sortBy === 'mindshare') {
                aValue = a.predicted_mindshare || 0
                bValue = b.predicted_mindshare || 0
              } else {
                aValue = a.quality_score || 0
                bValue = b.quality_score || 0
              }
              
              return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
            })
            
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredContent.map((item: ContentItem) => {
              // Check if this is a longpost that should be rendered as markdown
              const shouldUseMarkdown = isMarkdownContent(item.post_type)
              
              // FORCE TEST: Check if content has markdown syntax
              const hasMarkdownSyntax = item.content_text?.includes('##') || item.content_text?.includes('**')
              
              // FORCE TEST: Override markdown detection for testing
              const forceMarkdown = hasMarkdownSyntax // Force markdown if we detect markdown syntax
              
              // For longposts, use raw content; for others, use parsed content
              const { text, hashtags, characterCount, imageUrl } = (shouldUseMarkdown || forceMarkdown)
                ? { text: item.content_text, hashtags: [], characterCount: item.content_text?.length || 0, imageUrl: null }
                : formatTwitterContent(item.content_text)
              
              const displayImage = item.content_images && item.content_images.length > 0 
                ? item.content_images[0] 
                : imageUrl
              
              // Debug logging for tweet thread
              console.log('🔍 BiddingInterface item:', {
                id: item.id,
                tweet_thread: item.tweet_thread,
                type: typeof item.tweet_thread,
                length: item.tweet_thread?.length,
                isArray: Array.isArray(item.tweet_thread),
                post_type: item.post_type,
                shouldUseMarkdown,
                hasMarkdownSyntax,
                forceMarkdown,
                content_length: item.content_text?.length
              })
              
              return (
                <div key={item.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 border border-gray-200">
                  <div className="p-4 space-y-4">
                    {/* Header with Creator Info */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold text-sm">
                            {generateMinerId(item.creator.username).charAt(6).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{generateMinerId(item.creator.username)}</p>
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
                        <div className="flex flex-wrap gap-1 justify-end">
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                            {item.campaign.platform_source}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${getPostTypeInfo(item.post_type).className}`}>
                            {getPostTypeInfo(item.post_type).text}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{formatTimeAgo(item.created_at)}</p>
                      </div>
                    </div>

                    {/* Tweet Thread Display */}
                    {forceMarkdown ? (
                      // Render longpost with markdown formatting and show/hide details
                      <div className="relative">
                        <div className="absolute top-2 right-2 z-10">
                          <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(item.post_type).className}`}>
                            {getPostTypeInfo(item.post_type).text}
                          </span>
                        </div>
                        
                        {/* Longpost content - truncated or full */}
                        {expandedLongposts.has(item.id) ? (
                          <div>
                            {renderMarkdown(text, { className: 'longpost-content' })}
                            
                            {/* Show/Hide details button - above image when expanded */}
                            {text.length > 300 && (
                              <button
                                onClick={() => toggleLongpostExpansion(item.id)}
                                className="mt-3 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                              >
                                <ChevronUpIcon className="h-4 w-4" />
                                <span>Hide details</span>
                              </button>
                            )}
                            
                            {displayImage && (
                              <div className="mt-4">
                                <img 
                                  src={displayImage} 
                                  alt="Content image" 
                                  className="w-full h-auto object-contain rounded-lg"
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            {renderMarkdown(truncateLongpost(text), { className: 'longpost-content' })}
                            
                            {/* Show/Hide details button - above image when collapsed */}
                            {text.length > 300 && (
                              <button
                                onClick={() => toggleLongpostExpansion(item.id)}
                                className="mt-3 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                              >
                                <ChevronDownIcon className="h-4 w-4" />
                                <span>Show details</span>
                              </button>
                            )}
                            
                            {displayImage && (
                              <div className="mt-4">
                                <img 
                                  src={displayImage} 
                                  alt="Content image" 
                                  className="w-full h-auto object-contain rounded-lg"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <TweetThreadDisplay 
                        mainTweet={text}
                        tweetThread={item.tweet_thread}
                        imageUrl={displayImage}
                        characterCount={characterCount}
                        hashtags={hashtags}
                        className="relative"
                        showImage={false} // We'll add watermark separately if needed
                        isProtected={true} // Enable protected watermarks
                      />
                    )}

                    {/* Image with Watermark - Only for non-longpost content */}
                    {displayImage && !forceMarkdown && (
                      <div className="relative">
                        <div className="relative overflow-hidden rounded-lg border border-gray-300">
                          <img 
                            src={displayImage} 
                            alt="AI Generated content"
                            className="w-full h-auto object-cover rounded-lg"
                            onLoad={() => console.log('✅ Card image loaded:', displayImage)}
                            onError={(e) => {
                              console.error('❌ Card image failed to load:', displayImage)
                              e.currentTarget.style.display = 'none'
                              const fallback = e.currentTarget.nextElementSibling as HTMLElement
                              if (fallback) fallback.style.display = 'block'
                            }}
                            onDragStart={preventDrag}
                            onContextMenu={preventImageRightClick}
                            style={{ userSelect: 'none' }}
                          />
                          
                          {/* Enhanced Image Watermarks */}
                          <div className="absolute inset-0 pointer-events-none">
                            <div 
                              className="absolute text-white opacity-70 text-3xl font-black transform -rotate-45"
                              style={{
                                left: '20%',
                                top: '30%',
                                textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                              }}
                            >
                              PROTECTED
                            </div>
                            <div 
                              className="absolute text-white opacity-60 text-xl font-black transform rotate-12"
                              style={{
                                right: '15%',
                                bottom: '20%',
                                textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                              }}
                            >
                              BUY TO ACCESS
                            </div>
                            <div 
                              className="absolute text-white opacity-50 text-lg font-black transform -rotate-12"
                              style={{
                                left: '10%',
                                bottom: '10%',
                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                              }}
                            >
                              PREVIEW ONLY
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

                    {/* Purchase Section */}
                    <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs text-gray-600">Price</p>
                          <PriceDisplay roastAmount={item.asking_price} />
                        </div>
                        <button
                          onClick={() => setShowPurchaseModal(item)}
                          className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center space-x-2 text-sm"
                        >
                          <ShoppingCartIcon className="h-4 w-4" />
                          <span>Buy Now</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
                })}
              </div>
            )
          })()
        ) : (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No content found</p>
            <p className="text-gray-400 text-sm">Try adjusting your search or filters, or check back later for new AI-generated content</p>
          </div>
        )}

        {/* Hidden Bidding Modal (keep for future use) */}
        {false && showBidModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            {/* Bidding modal content - hidden for now */}
          </div>
        )}
      </div>
      
      <CopyProtectionModal />
      
      {/* Purchase Content Modal */}
      <PurchaseContentModal
        content={showPurchaseModal}
        isOpen={!!showPurchaseModal}
        onClose={() => setShowPurchaseModal(null)}
        onPurchase={handlePurchase}
      />
    </div>
  )
} 