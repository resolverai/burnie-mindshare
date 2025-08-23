'use client'

import { useState, useEffect, useCallback } from 'react'
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


// Use MarketplaceContent type directly from the service
type ContentItem = MarketplaceContent & {
  watermark_image?: string
}



export default function BiddingInterface() {
  const { address } = useAccount()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const { price: roastPrice } = useROASTPrice()
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedProject, setSelectedProject] = useState('all')
  const [sortBy, setSortBy] = useState<'bidding_enabled' | 'mindshare' | 'quality' | 'price_low' | 'price_high' | 'newest'>('bidding_enabled')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showPurchaseModal, setShowPurchaseModal] = useState<ContentItem | null>(null)
  // Copy protection state removed - no longer needed in public marketplace
  const [isScreenshotDetected, setIsScreenshotDetected] = useState(false)
  const [expandedLongposts, setExpandedLongposts] = useState<Set<number>>(new Set())
  const [heroPosition, setHeroPosition] = useState(0)


  // Generate consistent random mindshare for each item (using id as seed)
  const getRandomMindshare = useCallback((itemId: string) => {
    // Use item id to generate consistent random value
    const seed = itemId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    const random = (Math.sin(seed) * 10000) % 1
    const min = 85.0
    const max = 100.0
    const value = Math.abs(random) * (max - min) + min
    return Math.round(value * 10) / 10
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
    sort_by: sortBy,
    limit: 18
  })



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
        alert('Payment completed but there was an issue confirming with our servers. Your transaction hash: ' + transactionHash);
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



  // Memoized search handler to prevent re-renders
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }, [])

  // Memoized platform change handler
  const handlePlatformChange = useCallback((platform: string) => {
    setSelectedPlatform(platform)
  }, [])

  const handleProjectChange = useCallback((project: string) => {
    setSelectedProject(project)
  }, [])

  // Filters Component - memoized to prevent unnecessary re-renders
  const FiltersBar = useCallback(() => (
    <div className="flex flex-col gap-4">
      {/* Dynamic Platform and Project Filters */}
      <DynamicFilters
        selectedPlatform={selectedPlatform}
        selectedProject={selectedProject}
        onPlatformChange={handlePlatformChange}
        onProjectChange={handleProjectChange}
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
      />
    </div>
  ), [searchTerm, selectedPlatform, selectedProject, handleSearchChange, handlePlatformChange, handleProjectChange])

  return (
    <div className="relative">
      {/* Marketplace is now public - no copy protection on main interface */}
      <div className="px-4 py-6 space-y-6">
        {/* Hero Carousel Section */}
        {!isCarouselLoading && carouselSlides.length > 0 && (
          <HeroCarousel slides={carouselSlides} onProgressChange={setHeroPosition} />
        )}
        
        {/* Progress Slider */}
        {carouselSlides.length > 1 && (
          <ProgressSlider 
            segments={carouselSlides.length} 
            position={heroPosition} 
            className="w-32 md:w-44 mx-auto" 
          />
        )}
        

        
        {/* Filters */}
        {FiltersBar()}

        {/* Content Grid */}
        {isContentLoading ? (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="yapper-card animate-pulse">
                <div className="aspect-[16/10] bg-gray-300"></div>
              </div>
            ))}
          </div>
        ) : content && content.length > 0 ? (
                    <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 px-4 py-8">
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
                    <article key={item.id} className="group relative rounded-[28px] overflow-hidden bg-yapper-surface content-card-3d hover:z-50 cursor-pointer">
                      <div className="relative aspect-[16/10]">
                        {/* Background layer */}
                        {displayImage ? (
                          <Image 
                            src={displayImage} 
                            alt="Project" 
                            fill 
                            sizes="(min-width: 768px) 50vw, 100vw" 
                            className="object-cover transition-all duration-300 group-hover:blur-sm"
                            unoptimized={isPresignedS3Url(displayImage)}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-yapper-muted transition-all duration-300 group-hover:blur-sm">
                            <div className="text-white/50 text-center">
                              <div className="text-4xl mb-2">📝</div>
                              <div className="text-sm">AI Generated Content</div>
                            </div>
                          </div>
                        )}

                        {/* Base overlay when not hovered */}
                        <div className="absolute inset-0 hidden md:flex flex-col justify-end p-4 md:p-5 transition-opacity duration-300 opacity-100 group-hover:opacity-0 gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-md md:text-xl font-medium font-nt-brick">{item.campaign.title}</span>
                          </div>
                                        <div className="text-white text-xs md:text-sm font-medium">
                Predicted Mindshare: <span className="font-semibold">{getRandomMindshare(item.id.toString()).toFixed(1)}%</span>
              </div>
                        </div>

                        {/* Overlay content (hover-reveal on md+) */}
                        <div className="absolute inset-0 transition-opacity duration-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 bg-white/10 backdrop-blur-sm">
                          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/25 to-black/40" aria-hidden />

                          <div className="relative z-10 h-full w-full flex flex-col">
                            {/* Top badges */}
                            <div className="px-4 md:px-5 pt-4 md:pt-5 flex items-center justify-between">
                              <span className="inline-flex h-9 items-center rounded-[12px] px-3 bg-[#451616] hover:bg-[#743636] transition-colors text-white text-sm font-medium max-w-[200px]">
                                <Image src="/openledger.svg" alt="Project" width={16} height={16} className="mr-2 flex-shrink-0" />
                                <span className="truncate">
                                  {(item.campaign as any).project_name || item.campaign.title || 'Project'}
                                </span>
                              </span>
                              {((item.campaign as any).platformSource || (item.campaign as any).platform_source) && (
                                <span className="inline-flex h-9 items-center rounded-full bg-[#FFEB68] px-4 text-[#3b2a00] text-sm font-semibold shadow-[0_6px_20px_rgba(0,0,0,0.25)]">
                                  {(item.campaign as any).platformSource || (item.campaign as any).platform_source}
                                </span>
                              )}
                            </div>

                            {/* Title and stats */}
                            <div className="px-4 md:px-5 mt-6 md:mt-12">
                              <h3 className="text-white text-base md:text-[16px] font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] truncate whitespace-nowrap overflow-hidden font-nt-brick">
                                {item.campaign.title && item.campaign.title.length > 45 
                                  ? item.campaign.title.substring(0, 45) + '...' 
                                  : (item.campaign.title || 'Campaign Title')}
                              </h3>
                              <div className="grid grid-cols-2 gap-4 md:gap-8 text-white/85 mt-4">
                                <div>
                                  <div className="text-xs md:text-sm font-semibold">Predicted Mindshare</div>
                                  <div className="text-lg md:text-xl font-semibold">{getRandomMindshare(item.id.toString()).toFixed(1)}%</div>
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
            ) : (
          <div className="text-center py-12">
            <div className="text-white/70 text-lg mb-2">No content found</div>
            <div className="text-white/50 text-sm">Try adjusting your search or filters, or check back later for new AI-generated content</div>
          </div>
        )}

        {/* Infinite Scroll Loading Indicator */}
        {isFetchingNextPage && (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-white/70">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              <span>Loading more content...</span>
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
        onClose={() => setShowPurchaseModal(null)}
        onPurchase={handlePurchaseCallback}
        onContentUpdate={handleContentUpdate}
      />

      {/* Copy protection removed from marketplace - now public */}
    </div>
  )
}