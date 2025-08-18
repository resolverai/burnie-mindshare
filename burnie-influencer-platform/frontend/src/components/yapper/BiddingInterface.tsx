'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import Image from 'next/image'
import { 
  MagnifyingGlassIcon,
  EyeIcon,
  StarIcon,
  ShoppingCartIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { 
  StarIcon as StarIconSolid 
} from '@heroicons/react/24/solid'

// Import the Purchase Content Modal
import PurchaseContentModal from './PurchaseContentModal'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance } from '../../utils/walletUtils'
import { useROASTPrice, convertROASTToUSDC, formatUSDCPrice } from '../../utils/priceUtils'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
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

interface HeroSlide {
  backgroundUrl: string
  title: string
  amount: string
  amountLabel: string
  endText: string
  tag?: string
  gallery?: string[]
}

export default function BiddingInterface() {
  const [searchTerm, setSearchTerm] = useState('')
  const { price: roastPrice } = useROASTPrice()
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedPostType, setSelectedPostType] = useState('all')
  const [sortBy, setSortBy] = useState<'mindshare' | 'quality'>('mindshare')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showPurchaseModal, setShowPurchaseModal] = useState<ContentItem | null>(null)
  const [showCopyProtection, setShowCopyProtection] = useState(false)
  const [isScreenshotDetected, setIsScreenshotDetected] = useState(false)
  const [expandedLongposts, setExpandedLongposts] = useState<Set<number>>(new Set())
  const [heroPosition, setHeroPosition] = useState(0)
  
  // Price display component
  const PriceDisplay = ({ roastAmount }: { roastAmount: number }) => {
    const [usdcAmount, setUsdcAmount] = useState<number>(0)

    useEffect(() => {
      if (roastPrice > 0) {
        setUsdcAmount(roastAmount * roastPrice)
      }
    }, [roastAmount, roastPrice])

    return (
      <div className="text-white text-lg md:text-2xl font-semibold">
        {roastAmount} <span className="text-sm md:text-base align-middle font-semibold">$ROAST</span>
        {roastPrice > 0 && (
          <div className="text-sm text-white/80">
            ({formatUSDCPrice(usdcAmount)} USDC)
          </div>
        )}
      </div>
    )
  }
  
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
    
    let cleanText = contentText
    
    cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '')
    
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

  const generateMinerId = (username: string): string => {
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash).toString().slice(0, 6).padStart(6, '0')
    return `MINER-${minerId}`
  }

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

  // Add copy protection on component mount
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => preventCopy(e)
    const handleCut = (e: ClipboardEvent) => preventCopy(e)
    const handleSelectStart = (e: Event) => preventCopy(e)
    
    document.addEventListener('copy', handleCopy)
    document.addEventListener('cut', handleCut)
    document.addEventListener('selectstart', handleSelectStart)
    document.addEventListener('dragstart', preventCopy)
    
    return () => {
      document.removeEventListener('copy', handleCopy)
      document.removeEventListener('cut', handleCut)
      document.removeEventListener('selectstart', handleSelectStart)
      document.removeEventListener('dragstart', preventCopy)
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

      const treasuryAddress = result.data.treasuryAddress || process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS;
      
      if (!treasuryAddress) {
        throw new Error('Treasury wallet address not configured');
      }

      let transferResult;
      if (currency === 'ROAST') {
        transferResult = await transferROAST(price, treasuryAddress);
      } else {
        transferResult = await transferUSDC(price, treasuryAddress);
      }
      
      if (!transferResult.success) {
        console.error('❌ Wallet transaction failed or cancelled:', transferResult.error);
        alert(`Payment failed or cancelled: ${transferResult.error}. The content remains available for purchase.`);
        return;
      }

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

      alert('🎉 Purchase successful! Content has been added to your library.');
      refetch();
      
    } catch (error) {
      console.error('❌ Purchase error:', error);
      alert(`Purchase failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  // Hero slides data
  const slides: HeroSlide[] = [
    {
      backgroundUrl: "/hero.svg",
      title: "Cookie.fun Campaign",
      amount: "5,000,000",
      amountLabel: "ARBUS",
      endText: "End date 30-Aug-2025",
      tag: "Cookie.fun",
      gallery: ["/card02.svg", "/card03.svg", "/card04.svg"],
    },
    {
      backgroundUrl: "/hero.svg",
      title: "Kaito Morning Drop",
      amount: "1,200,000",
      amountLabel: "BEAN",
      tag: "Kaito.ai",
      endText: "End date 14-Sep-2025",
      gallery: ["/card05.svg", "/card06.svg"],
    },
  ]

  const active = slides[Math.floor(heroPosition)] || slides[0]

  // Hero Component
  const Hero = () => (
    <section className="relative bg-yapper-surface">
      <div className="relative w-full aspect-[8/5] md:aspect-[10/2] rounded-[24px] overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
        <div className="absolute inset-0 rounded-[24px] overflow-hidden">
          <Image src={active.backgroundUrl} alt="Campaign background" fill priority sizes="100vw" className="object-cover" />
        </div>

        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/30" aria-hidden />

        <div className="relative h-full px-4 py-4 md:px-6 md:py-6 flex flex-col md:flex-row items-center md:items-end">
          <div className="inline-block rounded-[var(--radius)] bg-gradient-to-b from-[#FFFFFF]/20 via-[#FFFFFF]/20 to-[#FFFFFF]/20 p-4 md:p-5">
            {active.tag ? (
              <span className="badge-yapper-highlight mb-2">
                {active.tag}
              </span>
            ) : null}
            <h2 className="text-lg md:text-xl font-semibold tracking-tight text-white">{active.title}</h2>
            <div className="mt-1 md:mt-2 flex items-baseline gap-3">
              <span className="text-4xl md:text-5xl font-extrabold tracking-tight text-white">{active.amount}</span>
              <span className="text-xs md:text-sm font-semibold opacity-90 text-white">{active.amountLabel}</span>
            </div>
            <p className="mt-2 text-xs md:text-sm font-semibold text-white/80">{active.endText}</p>
          </div>

          {active.gallery && active.gallery.length ? (
            <div className="ml-auto hidden md:flex items-end gap-6">
              {active.gallery.slice(0, 2).map((g, idx) => (
                <div key={g + idx} className="relative w-[180px] h-[120px] rounded-[16px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                  <Image src={g} alt="gallery" fill className="object-cover" />
                </div>
              ))}
              <div className="relative w-[180px] h-[120px] rounded-[16px] overflow-hidden bg-white/30 backdrop-blur-sm flex items-center justify-center text-white/90 text-lg font-semibold">
                +2,324 more
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )

  // Progress Slider Component
  const ProgressSlider = () => (
    <div className="w-32 md:w-44 mx-auto">
      <div className="flex gap-2">
        {slides.map((_, idx) => (
          <div 
            key={idx} 
            className={`h-1 rounded-full transition-all duration-300 ${
              Math.floor(heroPosition) === idx ? 'bg-white flex-1' : 'bg-white/30 w-2'
            }`}
          />
        ))}
      </div>
    </div>
  )

  // Filters Bar Component
  const FiltersBar = () => (
    <div className="grid grid-cols-1 md:grid-cols-[auto_auto_auto] items-start md:items-end gap-6">
      <div className="flex flex-col items-start gap-3">
        <div className="flex">
          <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Platforms</span>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <button 
            onClick={() => setSelectedPlatform('all')}
            className={`badge-yapper ${selectedPlatform === 'all' ? 'bg-white/20' : ''}`}
          >
            All
          </button>
          <button 
            onClick={() => setSelectedPlatform('cookie.fun')}
            className={`badge-yapper flex items-center gap-2 ${selectedPlatform === 'cookie.fun' ? 'bg-white/20' : ''}`}
          >
            <Image src="/openledger.svg" alt="Cookie" width={16} height={16} />
            Cookie.fun
          </button>
          <button 
            onClick={() => setSelectedPlatform('yaps.kaito.ai')}
            className={`badge-yapper flex items-center gap-2 ${selectedPlatform === 'yaps.kaito.ai' ? 'bg-white/20' : ''}`}
          >
            <Image src="/sapien.svg" alt="Kaito" width={16} height={16} />
            Kaito.ai
          </button>
          <button className="badge-yapper flex items-center gap-2">
            2 more
            <Image src="/arrowdown.svg" alt="Arrow down" width={12} height={12} />
          </button>
        </div>
      </div>
      <div className="flex flex-col items-start gap-3 mr-0 md:mr-60">
        <div className="flex">
          <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Sectors</span>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <button 
            onClick={() => setSelectedPostType('all')}
            className={`badge-yapper ${selectedPostType === 'all' ? 'bg-white/20' : ''}`}
          >
            All
          </button>
          <button 
            onClick={() => setSelectedPostType('longpost')}
            className={`badge-yapper ${selectedPostType === 'longpost' ? 'bg-white/20' : ''}`}
          >
            DeFi
          </button>
          <button 
            onClick={() => setSelectedPostType('shitpost')}
            className={`badge-yapper ${selectedPostType === 'shitpost' ? 'bg-white/20' : ''}`}
          >
            Meme
          </button>
          <button 
            onClick={() => setSelectedPostType('thread')}
            className={`badge-yapper ${selectedPostType === 'thread' ? 'bg-white/20' : ''}`}
          >
            InfoFi
          </button>
        </div>
      </div>
      <div className="max-w-full flex justify-end items-end">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/70" />
          <input
            type="text"
            placeholder="Search by campaign, platform sector"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-[8px] h-8 bg-white/10 placeholder:text-white/30 text-white pl-10 pr-4 border border-white/20 focus:border-white/40 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )

  return (
    <div 
      className="select-none relative"
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
      <div className="px-4 py-6 space-y-6">
        {/* Hero Section */}
        <Hero />
        
        {/* Progress Slider */}
        <ProgressSlider />
        
        {/* Content Repository Header */}
        <div className="flex flex-col items-start justify-center gap-1">
          <span className="text-white/85 text-xl uppercase font-semibold">Content repository</span>
          <span className="text-white/85 text-sm">for Active campaigns on Cookie , Kaito etc</span>
        </div>
        
        {/* Filters */}
        <FiltersBar />

        {/* Content Grid */}
        {isLoading ? (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="yapper-card animate-pulse">
                <div className="aspect-[16/10] bg-gray-300"></div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
          (() => {
            // Filter and sort content
            let filteredContent = content.filter((item: ContentItem) => {
              const matchesSearch = !searchTerm || 
                item.content_text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.campaign.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.creator.username?.toLowerCase().includes(searchTerm.toLowerCase())
              
              const matchesPlatform = selectedPlatform === 'all' || 
                item.campaign.platform_source === selectedPlatform
              
              const matchesPostType = selectedPostType === 'all' || 
                (item.post_type || 'thread') === selectedPostType
              
              return matchesSearch && matchesPlatform && matchesPostType
            })
            
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
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {filteredContent.map((item: ContentItem) => {
                  const shouldUseMarkdown = isMarkdownContent(item.post_type)
                  const hasMarkdownSyntax = item.content_text?.includes('##') || item.content_text?.includes('**')
                  const forceMarkdown = hasMarkdownSyntax
                  
                  const { text, hashtags, characterCount, imageUrl } = (shouldUseMarkdown || forceMarkdown)
                    ? { text: item.content_text, hashtags: [], characterCount: item.content_text?.length || 0, imageUrl: null }
                    : formatTwitterContent(item.content_text)
                  
                  const displayImage = item.content_images && item.content_images.length > 0 
                    ? item.content_images[0] 
                    : imageUrl
                  
                  return (
                    <article key={item.id} className="group relative yapper-card-interactive">
                      <div className="relative aspect-[16/10]">
                        {/* Background layer */}
                        {displayImage ? (
                          <Image src={displayImage} alt="Project" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-yapper-muted">
                            <div className="text-white/50 text-center">
                              <div className="text-4xl mb-2">📝</div>
                              <div className="text-sm">AI Generated Content</div>
                            </div>
                          </div>
                        )}

                        {/* Base overlay when not hovered */}
                        <div className="absolute inset-0 hidden md:flex flex-col justify-end p-4 md:p-5 transition-opacity duration-300 opacity-100 group-hover:opacity-0 gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-md md:text-xl font-medium">{item.campaign.title}</span>
                          </div>
                          <div className="text-white text-xs md:text-sm font-medium">
                            Predicted Mindshare: <span className="font-semibold">{item.predicted_mindshare.toFixed(1)}%</span>
                          </div>
                        </div>

                        {/* Overlay content (hover-reveal on md+) */}
                        <div className="absolute inset-0 transition-opacity duration-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 bg-white/10 backdrop-blur-xs">
                          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/25 to-black/40" aria-hidden />

                          <div className="relative z-10 h-full w-full flex flex-col">
                            {/* Top badges */}
                            <div className="px-4 md:px-5 pt-4 md:pt-5 flex items-center justify-between">
                              <div className="badge-yapper flex items-center gap-2">
                                <Image src="/openledger.svg" alt="Platform" width={16} height={16} />
                                {item.campaign.platform_source}
                              </div>
                              {item.campaign.platform_source && (
                                <span className="badge-yapper-highlight">
                                  {item.campaign.platform_source}
                                </span>
                              )}
                            </div>

                            {/* Title and stats */}
                            <div className="px-4 md:px-5 mt-6 md:mt-12">
                              <h3 className="text-white text-base md:text-[16px] font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] truncate">
                                {text.length > 60 ? text.substring(0, 60) + '...' : text}
                              </h3>
                              <div className="grid grid-cols-2 gap-4 md:gap-8 text-white/85 mt-4">
                                <div>
                                  <div className="text-xs md:text-sm font-semibold">Predicted Mindshare</div>
                                  <div className="text-lg md:text-xl font-semibold">{item.predicted_mindshare.toFixed(1)}%</div>
                                </div>
                                <div>
                                  <div className="text-xs md:text-sm font-semibold">Quality Score</div>
                                  <div className="text-lg md:text-xl font-semibold">{item.quality_score.toFixed(1)}/100</div>
                                </div>
                              </div>
                            </div>

                            {/* Bottom bar */}
                            <div className="mt-auto px-4 md:px-5 pb-4 md:pb-5">
                              <div className="flex items-center justify-between rounded-[12px] bg-white/10 backdrop-blur-md px-4 md:px-5 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                                <PriceDisplay roastAmount={item.asking_price} />
                                <button
                                  onClick={() => setShowPurchaseModal(item)}
                                  className="btn-yapper-primary h-9 md:h-10 px-4 md:px-5 glow-button-orange"
                                >
                                  Preview
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )
          })()
        ) : (
          <div className="text-center py-12">
            <div className="text-white/70 text-lg mb-2">No content found</div>
            <div className="text-white/50 text-sm">Try adjusting your search or filters, or check back later for new AI-generated content</div>
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