'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useBalance } from 'wagmi'
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

// Import components
import PurchaseContentModal from './PurchaseContentModal'
import HeroCarousel, { HeroSlide } from './HeroCarousel'
import { generateRandomMindshare, formatMindshare } from '../../utils/mindshareUtils'
import ProgressSlider from './ProgressSlider'
import DynamicFilters from './DynamicFilters'
import carouselService from '../../services/carouselService'
import marketplaceService, { type MarketplaceContent } from '../../services/marketplaceService'
import { useROASTPrice, convertROASTToUSDC, formatUSDCPrice } from '../../utils/priceUtils'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'
import { useInfiniteMarketplace } from '../../hooks/useInfiniteMarketplace'
import { useUserReferralCode } from '@/hooks/useUserReferralCode'
import { useAuth } from '@/hooks/useAuth'
// Scroll restoration removed - using page reload instead
import NoContentFound from '../NoContentFound'
import { ContentRequestService } from '../../services/contentRequestService'
import useMixpanel from '../../hooks/useMixpanel'


// Referral Code Section Component
const ReferralCodeSection = () => {
  const { referralCode, copyReferralLink } = useUserReferralCode()
  const { isAuthenticated } = useAuth()
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [mounted, setMounted] = useState(false)
  const mixpanel = useMixpanel()

  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleReferralCodeClick = async () => {
    if (referralCode?.code) {
      const success = await copyReferralLink(referralCode.code)
      if (success) {
        setShowCopySuccess(true)
        setTimeout(() => setShowCopySuccess(false), 2000)
        
        // Track referral code copy
        mixpanel.referralCodeCopied({
          referralCode: referralCode.code,
          copySource: 'referralSection',
          copySuccess: true,
          deviceType: window.innerWidth < 768 ? 'mobile' : 'desktop'
        })
      }
    }
  }

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return <div></div>
  }

  if (!isAuthenticated || !referralCode) return null

  return (
    <div className="flex justify-end -mt-2 mb-1 relative">
      <div className="relative">
        <button
          onClick={handleReferralCodeClick}
          className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white/90 rounded text-[10px] font-medium transition-all duration-200 flex items-center gap-1 backdrop-blur-sm"
          title="Click to copy your referral link"
        >
          <span className="text-[8px]">🔗</span>
          <span className="text-[10px]">Ref: {referralCode.code}</span>
        </button>
        
        {/* Copy success tooltip */}
        {showCopySuccess && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-orange-500 text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap z-[9999] shadow-lg">
            Copied!
          </div>
        )}
      </div>
    </div>
  )
}

// Use MarketplaceContent type directly from the service
type ContentItem = MarketplaceContent & {
  watermark_image?: string
}



export default function BiddingInterface() {
  const { address } = useAccount()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const { price: roastPrice } = useROASTPrice()
  const mixpanel = useMixpanel()
  // Get ROAST balance (raw numeric value)
  const ROAST_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN as `0x${string}`
  const { data: roastBalance } = useBalance({
    address: address,
    token: ROAST_TOKEN_ADDRESS,
    query: {
      enabled: !!address && !!ROAST_TOKEN_ADDRESS,
    },
  })
  
  // Get USDC balance
  const { data: usdcBalance } = useBalance({
    address: address,
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    query: {
      enabled: !!address,
    },
  })
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedPostType, setSelectedPostType] = useState('all')
  const [sortBy, setSortBy] = useState<'bidding_enabled' | 'mindshare' | 'quality' | 'price_low' | 'price_high' | 'newest'>('bidding_enabled')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showPurchaseModal, setShowPurchaseModal] = useState<ContentItem | null>(null)
  // Copy protection state removed - no longer needed in public marketplace
  const [isScreenshotDetected, setIsScreenshotDetected] = useState(false)
  const [expandedLongposts, setExpandedLongposts] = useState<Set<number>>(new Set())
  const [heroPosition, setHeroPosition] = useState(0)
  const [clickedCards, setClickedCards] = useState<Set<number>>(new Set())


  // Generate consistent random leaderboard position change for each item (using id as seed)
  // Intelligent distribution: higher for tweets with 2+ Twitter handles, lower for others
  const getRandomLeaderboardPositionChange = useCallback((itemId: string, contentText: string, tweetThread?: string[]) => {
    // Use item id to generate consistent random value
    const seed = itemId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    
    // Count Twitter handles in the content
    const allText = [contentText, ...(tweetThread || [])].join(' ')
    const twitterHandleMatches = allText.match(/@[\w]+/g) || []
    const uniqueHandles = new Set(twitterHandleMatches.map(handle => handle.toLowerCase()))
    const handleCount = uniqueHandles.size
    
    // Determine distribution type based on handle count
    const hasMultipleHandles = handleCount >= 2
    
    // Generate two pseudo-random numbers using different seeds
    const random1 = (Math.sin(seed) * 10000) % 1
    const random2 = (Math.sin(seed * 2) * 10000) % 1
    
    // Ensure we don't get 0 or 1 (which cause issues with log)
    const u1 = Math.max(0.0001, Math.min(0.9999, Math.abs(random1)))
    const u2 = Math.max(0.0001, Math.min(0.9999, Math.abs(random2)))
    
    // Use a simpler approach: combine two random numbers with intelligent skew
    const combined = (u1 + u2) / 2 // Average of two random numbers
    
    let skewed: number
    let position: number
    
    if (hasMultipleHandles) {
      // Higher distribution for tweets with 2+ handles (skewed towards higher numbers)
      // Use inverse power function to bias towards higher values
      skewed = 1 - Math.pow(1 - combined, 1.5) // Inverse power skews towards higher values
      position = Math.floor(skewed * 45) + 5
    } else {
      // Lower distribution for tweets with 0-1 handles (skewed towards lower numbers)
      // Use power function to bias towards lower values
      skewed = Math.pow(combined, 1.5) // Power > 1 skews towards lower values
      position = Math.floor(skewed * 45) + 5
    }
    
    // Ensure we're within bounds and return a valid number
    const result = Math.max(5, Math.min(50, position))
    
    // Debug logging to catch any remaining issues
    if (isNaN(result) || !isFinite(result)) {
      console.error('❌ Invalid leaderboard position generated:', {
        itemId,
        handleCount,
        hasMultipleHandles,
        seed,
        random1,
        random2,
        u1,
        u2,
        combined,
        skewed,
        position,
        result
      })
      return hasMultipleHandles ? 35 : 15 // Fallback values based on distribution type
    }
    
    return result
  }, [])



  // Fetch carousel data for hero banner
  const { data: carouselSlides = [], isLoading: isCarouselLoading } = useQuery({
    queryKey: ['carousel'],
    queryFn: carouselService.getCarouselSlides,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Fetch marketplace content with infinite scroll
  const {
    content,
    pagination,
    isLoading: isContentLoading,
    isError: isContentError,
    error: contentError,
    isFetchingNextPage,
    hasNextPage,
    lastElementRef,
    refetch
  } = useInfiniteMarketplace({
    search: debouncedSearchTerm,
    platform_source: selectedPlatform !== 'all' ? selectedPlatform : undefined,
    project_name: selectedProject !== 'all' ? selectedProject : undefined,
    post_type: selectedPostType !== 'all' ? selectedPostType : undefined,
    sort_by: sortBy,
    limit: 18
  })



  // Page view tracking moved to individual page components to avoid duplicates

  // Debug carousel data
  useEffect(() => {
    if (carouselSlides.length > 0) {
      console.log('🎠 Carousel slides loaded:', carouselSlides);
    }
  }, [carouselSlides])

  // Debounced search - only search after user stops typing for 500ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm])

  // Track search only when debouncedSearchTerm changes (user stops typing)
  useEffect(() => {
    if (debouncedSearchTerm !== '' && debouncedSearchTerm !== searchTerm) {
      // This means the user has stopped typing and the debounced value is different from current
      // This effect will only run when the debounce completes
      const isHomepage = window.location.pathname === '/'
      const marketplaceType = isHomepage ? 'unauthenticated' : 'authenticated'
      const screenName = isHomepage ? 'Homepage' : 'Marketplace'
      
      // Track search performed only when debounce completes
      mixpanel.contentSearchPerformed({
        searchQuery: debouncedSearchTerm,
        resultsCount: content?.length || 0,
        searchTime: 500, // Debounce time
        screenName: screenName,
        marketplaceType: marketplaceType,
        userAuthenticated: !!address
      })
    }
  }, [debouncedSearchTerm, content, mixpanel, address])


  
  // Price display component
  const PriceDisplay = ({ roastAmount }: { roastAmount: number }) => {
    const [usdcAmount, setUsdcAmount] = useState<number>(0)

    useEffect(() => {
      if (roastPrice > 0) {
        setUsdcAmount(roastAmount * roastPrice)
      }
    }, [roastAmount, roastPrice])

              return (
      <div className="text-white text-[10px] xs:text-xs sm:text-lg md:text-lg lg:text-2xl font-semibold">
        <div className="flex flex-row items-baseline gap-1 xs:gap-2 sm:gap-2">
          <span className="text-center xs:text-left sm:text-left">{roastAmount} <span className="text-[8px] xs:text-[9px] sm:text-sm md:text-sm lg:text-base align-middle font-semibold">$ROAST</span></span>
          {roastPrice > 0 && (
            <span className="text-xs xs:text-xs sm:text-sm md:hidden lg:block text-white/80 text-center xs:text-left sm:text-left">
              ({formatUSDCPrice(usdcAmount)} USDC)
            </span>
          )}
        </div>
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

  // Copy protection removed from BiddingInterface - marketplace is now public
  // Copy protection is only active within PurchaseContentModal



  // Copy protection event listeners removed - marketplace is now public

  // Handle content update after successful purchase
  const handleContentUpdate = (updatedContent: ContentItem) => {
    console.log('🔄 Content updated with fresh URLs:', updatedContent);
    // Update the showPurchaseModal state with fresh URLs if it's the same content
    if (showPurchaseModal && showPurchaseModal.id === updatedContent.id) {
      setShowPurchaseModal(updatedContent);
    }
  };

  const handleCardClick = (item: ContentItem) => {
    // Determine if this is homepage (unauthenticated) or marketplace (authenticated)
    const isHomepage = window.location.pathname === '/'
    const marketplaceType = isHomepage ? 'unauthenticated' : 'authenticated'
    const screenName = isHomepage ? 'Homepage' : 'Marketplace'
    
    // Debug logging for mobile event tracking
    console.log('🎯 Mobile contentItemClicked event:', {
      contentId: item.id,
      contentType: item.post_type === 'visual' ? 'visual' : 'text',
      screenName: screenName,
      marketplaceType: marketplaceType,
      deviceType: window.innerWidth < 768 ? 'mobile' : 'desktop'
    });
    
    // Track combined content item clicked event (replaces contentItemViewed + purchaseModalOpened)
    mixpanel.contentItemClicked({
      contentId: item.id,
      contentType: item.post_type === 'visual' ? 'visual' : 'text',
      campaignId: item.campaign.id,
      contentPrice: item.asking_price,
      contentMindshare: item.predicted_mindshare,
      contentQuality: item.quality_score,
      campaignTitle: item.campaign.title,
      platformSource: (item.campaign as any).platform_source || '',
      projectName: (item.campaign as any).project_name || '',
      screenName: screenName,
      marketplaceType: marketplaceType,
      userROASTBalance: Math.floor(parseFloat(roastBalance?.formatted || '0')),
      userUSDCBalance: Math.floor(parseFloat(usdcBalance?.formatted || '0')),
      userAuthenticated: !!address
    });
    
    // Open PurchaseContentModal instead of expanding card
    setShowPurchaseModal(item);
  };

  // Close all cards when clicking outside
  const handleOutsideClick = () => {
    setClickedCards(new Set());
  };

  // Handle purchase function (updated to use marketplace service)
  const handlePurchaseCallback = async (contentId: number, price: number, currency: 'ROAST' | 'USDC' = 'ROAST', transactionHash?: string) => {
    if (!address) {
      alert('Please connect your wallet to purchase content');
      return;
    }

    try {
      console.log('🛒 Processing purchase confirmation for content:', contentId, 'Price:', price, currency, 'TxHash:', transactionHash);
      
      // PurchaseContentModal already handled the wallet transaction and provided the hash
      // Now we need to create the purchase record and confirm the payment
      if (!transactionHash) {
        throw new Error('Transaction hash is required for purchase confirmation');
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
          currency: currency,
          transactionHash: transactionHash // Include the transaction hash
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to create purchase record');
      }

      const confirmResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/purchase/${result.data.purchaseId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionHash: transactionHash // Use the transaction hash from PurchaseContentModal
        }),
      });

      const confirmResult = await confirmResponse.json();
      
      if (!confirmResponse.ok) {
        console.error('❌ Failed to confirm purchase:', confirmResult);
        
        // Try to rollback the purchase to restore content availability
        try {
          console.log('🔄 Attempting to rollback purchase to restore content availability...');
          const rollbackResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/purchase/${result.data.purchaseId}/rollback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transactionHash: transactionHash,
              reason: 'Purchase confirmation failed'
            }),
          });
          
          if (rollbackResponse.ok) {
            console.log('✅ Purchase rollback successful - content restored to marketplace');
            alert('Payment completed but there was an issue confirming with our servers. Your transaction hash: ' + transactionHash + '\n\nContent has been restored to the marketplace. Please try purchasing again.');
          } else {
            console.error('❌ Purchase rollback failed');
            alert('Payment completed but there was an issue confirming with our servers. Your transaction hash: ' + transactionHash + '\n\nPlease contact support to restore the content to the marketplace.');
          }
        } catch (rollbackError) {
          console.error('❌ Purchase rollback error:', rollbackError);
          alert('Payment completed but there was an issue confirming with our servers. Your transaction hash: ' + transactionHash + '\n\nPlease contact support to restore the content to the marketplace.');
        }
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

      // Refetch marketplace data to remove purchased content
      refetch()
      
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

  // Handle content request submission
  const handleContentRequest = async (data: {
    projectName: string;
    platform: string;
    campaignLinks: string;
  }) => {
    try {
      await ContentRequestService.createContentRequest({
        ...data,
        walletAddress: address || undefined,
      });
      
      // Show success message
      alert('Content request submitted successfully! We will review your request and create content accordingly.');
    } catch (error) {
      console.error('Error submitting content request:', error);
      alert('Failed to submit content request. Please try again.');
    }
  }



  // Memoized search handler to prevent re-renders
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }, [])

  // Memoized platform change handler
  const handlePlatformChange = useCallback((platform: string) => {
    const previousValue = selectedPlatform
    setSelectedPlatform(platform)
    
    // Determine if this is homepage (unauthenticated) or marketplace (authenticated)
    const isHomepage = window.location.pathname === '/'
    const marketplaceType = isHomepage ? 'unauthenticated' : 'authenticated'
    const screenName = isHomepage ? 'Homepage' : 'Marketplace'
    
    // Track filter applied
    mixpanel.contentFilterApplied({
      filterType: 'platform',
      filterValue: platform,
      resultsCount: content?.length || 0,
      previousFilterValue: previousValue,
      screenName: screenName,
      marketplaceType: marketplaceType,
      userAuthenticated: !!address
    })
  }, [selectedPlatform, content, mixpanel, address])

  const handleProjectChange = useCallback((project: string) => {
    const previousValue = selectedProject
    setSelectedProject(project)
    
    // Determine if this is homepage (unauthenticated) or marketplace (authenticated)
    const isHomepage = window.location.pathname === '/'
    const marketplaceType = isHomepage ? 'unauthenticated' : 'authenticated'
    const screenName = isHomepage ? 'Homepage' : 'Marketplace'
    
    // Track filter applied
    mixpanel.contentFilterApplied({
      filterType: 'project',
      filterValue: project,
      resultsCount: content?.length || 0,
      previousFilterValue: previousValue,
      screenName: screenName,
      marketplaceType: marketplaceType,
      userAuthenticated: !!address
    })
  }, [selectedProject, content, mixpanel, address])

  const handlePostTypeChange = useCallback((postType: string) => {
    const previousValue = selectedPostType
    setSelectedPostType(postType)
    
    // Determine if this is homepage (unauthenticated) or marketplace (authenticated)
    const isHomepage = window.location.pathname === '/'
    const marketplaceType = isHomepage ? 'unauthenticated' : 'authenticated'
    const screenName = isHomepage ? 'Homepage' : 'Marketplace'
    
    // Track filter applied
    mixpanel.contentFilterApplied({
      filterType: 'postType',
      filterValue: postType,
      resultsCount: content?.length || 0,
      previousFilterValue: previousValue,
      screenName: screenName,
      marketplaceType: marketplaceType,
      userAuthenticated: !!address
    })
  }, [selectedPostType, content, mixpanel, address])

  // Filters Component - memoized to prevent unnecessary re-renders
  const FiltersBar = useCallback(() => (
    <div className="flex flex-col gap-2.5 xs:gap-3 sm:gap-4">
      {/* Dynamic Platform and Project Filters */}
      <DynamicFilters
        selectedPlatform={selectedPlatform}
        selectedProject={selectedProject}
        selectedPostType={selectedPostType}
        onPlatformChange={handlePlatformChange}
        onProjectChange={handleProjectChange}
        onPostTypeChange={handlePostTypeChange}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
      />
    </div>
  ), [searchTerm, selectedPlatform, selectedProject, selectedPostType, handleSearchChange, handlePlatformChange, handleProjectChange, handlePostTypeChange])

  return (
    <div className="relative" onClick={handleOutsideClick}>
      {/* Marketplace is now public - no copy protection on main interface */}
      <div className="px-2.5 xs:px-3 sm:px-4 md:px-6 py-3 xs:py-4 sm:py-6 space-y-3 xs:space-y-4 sm:space-y-6 max-w-full overflow-hidden">
        {/* Hero Carousel Section */}
        {!isCarouselLoading && carouselSlides.length > 0 && (
          <HeroCarousel slides={carouselSlides} onProgressChange={setHeroPosition} />
        )}
        
        {/* Progress Slider */}
        {carouselSlides.length > 1 && (
          <ProgressSlider 
            segments={carouselSlides.length} 
            position={heroPosition} 
            className="w-20 xs:w-24 sm:w-32 md:w-44 mx-auto" 
          />
        )}
        
        {/* Referral Code Section - Show on mobile and tablet, hidden on desktop */}
        <div className="xl:hidden">
          <ReferralCodeSection />
        </div>
        
        {/* Filters */}
        {FiltersBar()}

        {/* Content Grid */}
        {isContentLoading ? (
          <div className="grid gap-3 xs:gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="yapper-card animate-pulse">
                <div className="aspect-[16/10] bg-gray-300"></div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
                    <div 
                      className="grid gap-2.5 xs:gap-3 sm:gap-4 md:gap-6 lg:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 px-1 xs:px-1.5 sm:px-2 md:px-4 py-2.5 xs:py-3 sm:py-4 md:py-8 touch-pan-y max-w-full"
                      onClick={handleOutsideClick}
                    >
            {content.map((item: ContentItem) => {
              const shouldUseMarkdown = isMarkdownContent(item.post_type)
                  const hasMarkdownSyntax = item.content_text?.includes('##') || item.content_text?.includes('**')
                  const forceMarkdown = hasMarkdownSyntax
                  
                  const { text, hashtags, characterCount, imageUrl } = (shouldUseMarkdown || forceMarkdown)
                    ? { text: item.content_text, hashtags: [], characterCount: item.content_text?.length || 0, imageUrl: null }
                    : formatTwitterContent(item.content_text)
                  
                  // Use watermarked image for marketplace display, fallback to original for purchased content
                  const displayImage = item.watermark_image || 
                    (item.content_images && item.content_images.length > 0 ? item.content_images[0] : imageUrl)
                  
                  // Helper function to check if URL is a presigned S3 URL
                  const isPresignedS3Url = (url: string) => {
                    return url.includes('s3.amazonaws.com') && url.includes('?') && 
                           (url.includes('X-Amz-Signature') || url.includes('Signature'))
                  }
                  
                  return (
                    <article 
                      key={item.id} 
                      className={`group relative rounded-xl xs:rounded-2xl sm:rounded-[28px] overflow-hidden bg-yapper-surface content-card-3d hover:z-50 cursor-pointer touch-pan-y transition-all duration-300 w-full max-w-[calc(100%-0.5rem)] xs:max-w-[calc(100%-0.5rem)] sm:max-w-full md:max-w-full mx-auto xs:mx-auto sm:mx-0 ${
                        clickedCards.has(item.id) ? 'scale-105 z-50 shadow-2xl my-2' : 'scale-100'
                      }`}
                    >
                      <div 
                        className="relative aspect-[16/10] h-[220px] xs:h-[240px] sm:h-[260px] md:h-[280px] lg:h-auto"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCardClick(item);
                        }}
                      >
                        {/* Background layer */}
                        {displayImage ? (
                          <Image 
                            src={displayImage} 
                            alt="Project" 
                            fill 
                            sizes="(max-width: 375px) 100vw, (max-width: 430px) 100vw, (max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" 
                            className={`object-cover transition-all duration-300 ${
                              clickedCards.has(item.id) || false ? 'blur-sm' : 'md:group-hover:blur-sm'
                            }`}
                            unoptimized={isPresignedS3Url(displayImage)}
                          />
                        ) : (
                          <div className={`absolute inset-0 flex items-center justify-center bg-yapper-muted transition-all duration-300 ${
                            clickedCards.has(item.id) || false ? 'blur-sm' : 'md:group-hover:blur-sm'
                          }`}>
                            <div className="text-white/50 text-center px-1.5 xs:px-2">
                              <div className="text-2xl xs:text-3xl sm:text-4xl mb-1.5 xs:mb-2">📝</div>
                              <div className="text-xs xs:text-xs sm:text-sm">AI Generated Content</div>
                            </div>
                          </div>
                        )}

                        {/* Base overlay when not hovered (visible on all devices) */}
                        <div 
                          className="absolute inset-0 flex flex-col justify-end p-3 md:p-5 transition-opacity duration-300 opacity-100 group-hover:opacity-0 gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCardClick(item);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-white text-xs xs:text-sm sm:text-base md:text-lg font-medium font-nt-brick truncate">{item.campaign.title}</span>
                          </div>
                        </div>

                        {/* Overlay content (click-reveal on mobile, hover-reveal on desktop) */}
                        <div 
                          className={`absolute inset-0 transition-all duration-300 bg-white/10 backdrop-blur-sm ${
                            clickedCards.has(item.id) || false ? 'opacity-100 scale-105 z-10' : 'opacity-0 md:group-hover:opacity-100 md:group-hover:scale-105'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCardClick(item);
                          }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/25 to-black/40" aria-hidden />

                          <div className="relative z-10 h-full w-full flex flex-col">
                            {/* Top badges */}
                            <div className="px-1.5 xs:px-2 sm:px-3 md:px-5 pt-1.5 xs:pt-2 sm:pt-3 md:pt-5 flex flex-row items-start sm:items-center justify-between sm:justify-start gap-2 xs:gap-3 sm:gap-4 md:gap-20 lg:gap-60 ml-0 xs:ml-[10px] sm:ml-[15px] md:ml-0 mt-1.5 xs:mt-2 sm:mt-3 md:mt-0 max-w-[85vw] xs:max-w-[70vw] sm:max-w-[85vw] md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-full">
                              <span className="inline-flex h-8 xs:h-9 sm:h-9 items-center rounded-md xs:rounded-lg sm:rounded-[10px] md:rounded-[12px] px-1.5 xs:px-2 sm:px-3 md:px-3 bg-[#451616] hover:bg-[#743636] transition-colors text-white text-xs xs:text-xs sm:text-sm font-medium max-w-[70px] xs:max-w-[80px] sm:max-w-[100px] md:max-w-[200px]">
                                <Image src="/openledger.svg" alt="Project" width={12} height={12} className="mr-1 xs:mr-1 sm:mr-2 flex-shrink-0 w-3 h-3 xs:w-4 xs:h-4 sm:w-4 sm:h-4" />
                                <span className="truncate text-xs xs:text-xs sm:text-sm">
                                  {(item.campaign as any).project_name || item.campaign.title || 'Project'}
                                </span>
                              </span>
                              {((item.campaign as any).platformSource || (item.campaign as any).platform_source) && (
                                <span className="inline-flex h-8 xs:h-9 sm:h-9 items-center rounded-full bg-[#FFEB68] px-1.5 xs:px-2 sm:px-3 md:px-4 text-[#3b2a00] text-xs xs:text-xs sm:text-sm font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.25)] md:shadow-[0_6px_20px_rgba(0,0,0,0.25)] max-w-[70px] xs:max-w-[80px] sm:max-w-full">
                                  {(item.campaign as any).platformSource || (item.campaign as any).platform_source}
                                </span>
                              )}
                            </div>

                            {/* Title only - stats removed */}
                            <div className="px-1.5 xs:px-2 sm:px-3 md:px-5 mt-2 xs:mt-2.5 sm:mt-4 md:mt-4 lg:mt-6 max-w-[85vw] xs:max-w-[70vw] sm:max-w-[300px] md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-none ml-0 xs:ml-[10px] sm:ml-[15px] md:ml-0">
                              <h3 className="text-white text-xs xs:text-xs sm:text-sm md:text-base lg:text-[16px] font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] line-clamp-2 font-nt-brick leading-tight mb-1 xs:mb-1.5 sm:mb-2 md:mb-3 text-left">
                                {item.campaign.title && item.campaign.title.length > 45
                                  ? item.campaign.title.substring(0, 45) + '...' 
                                  : (item.campaign.title || 'Campaign Title')}
                              </h3>
                            </div>

                            {/* Bottom bar */}
                            <div className="mt-auto px-1.5 xs:px-2 sm:px-3 md:px-5 pb-2 xs:pb-2.5 sm:pb-4 md:pb-5 w-full max-w-[calc(100%-1rem)] xs:max-w-[calc(100%-1rem)] sm:max-w-full ml-0 xs:ml-[10px] sm:ml-[15px] md:ml-0">
                              <div className="flex flex-col sm:flex-row items-center justify-between sm:justify-between md:justify-start lg:justify-between rounded-md xs:rounded-lg sm:rounded-[10px] md:rounded-[12px] bg-white/10 backdrop-blur-md px-2 xs:px-2.5 sm:px-4 md:px-4 lg:px-5 py-2.5 xs:py-3 sm:py-3 md:py-2.5 lg:py-3 shadow-[0_6px_20px_rgba(0,0,0,0.25)] md:shadow-[0_10px_30px_rgba(0,0,0,0.25)] gap-2 xs:gap-2.5 sm:gap-3 md:gap-20 lg:gap-3 max-w-[85vw] xs:max-w-[70vw] sm:max-w-[85vw] md:max-w-[90vw] lg:max-w-[85vw] xl:max-w-full">
                                <PriceDisplay roastAmount={item.asking_price} />
                                <button
                                  onClick={() => handleCardClick(item)}
                                  className="btn-yapper-primary h-9 xs:h-10 sm:h-10 md:h-10 lg:h-12 px-2.5 xs:px-3 sm:px-5 md:px-4 lg:px-5 glow-button-orange w-full sm:w-auto min-w-[70px] xs:min-w-[80px] sm:min-w-[100px] md:min-w-[80px] lg:min-w-[100px] xl:min-w-[100px] text-xs xs:text-xs sm:text-sm md:text-xs lg:text-base font-medium flex-shrink-0 shadow-lg touch-manipulation"
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
            ) : (
              <NoContentFound 
                searchQuery={debouncedSearchTerm || `${selectedPlatform !== 'all' ? selectedPlatform : ''} ${selectedProject !== 'all' ? selectedProject : ''}`.trim() || 'your search'}
                onRequestContent={handleContentRequest}
              />
            )}

        {/* Infinite Scroll Loading Indicator */}
        {isFetchingNextPage && (
          <div className="text-center py-5 xs:py-6 sm:py-8">
            <div className="inline-flex items-center gap-2 text-white/70">
              <div className="animate-spin rounded-full h-4 w-4 xs:h-5 xs:w-5 sm:h-6 sm:w-6 border-b-2 border-white"></div>
              <span className="text-xs xs:text-sm sm:text-base">Loading more content...</span>
            </div>
          </div>
        )}

        {/* Intersection Observer Target for Infinite Scroll */}
        {hasNextPage && (
          <div ref={lastElementRef} className="h-4" />
        )}
      </div>
      
      {/* Purchase Content Modal */}
      <PurchaseContentModal 
        content={showPurchaseModal}
        isOpen={!!showPurchaseModal}
        onClose={() => {
          setShowPurchaseModal(null);
        }}
        onPurchase={handlePurchaseCallback}
        onContentUpdate={handleContentUpdate}
      />

      {/* Copy protection removed from marketplace - now public */}
    </div>
  )
}