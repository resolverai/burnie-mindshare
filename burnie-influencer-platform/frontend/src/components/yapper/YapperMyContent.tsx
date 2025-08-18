'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
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
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images: string[]
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
  transaction_hash?: string
  treasury_transaction_hash?: string
  acquisition_type: 'bid' | 'purchase'
}

export default function YapperMyContent() {
  const { address } = useAccount()
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedPostType, setSelectedPostType] = useState('all')
  const [sortBy, setSortBy] = useState<'mindshare' | 'quality'>('mindshare')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

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
      let downloadUrl = imageUrl
      
      if (imageUrl.includes('s3.amazonaws.com') || imageUrl.includes('amazonaws.com')) {
        try {
          const urlParts = imageUrl.split('amazonaws.com/')[1]
          if (urlParts) {
            const s3Key = urlParts.split('?')[0]
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
      window.open(imageUrl, '_blank')
    }
  }

  const postToTwitter = (mainTweet: string, tweetThread?: string[]) => {
    if (tweetThread && tweetThread.length > 0) {
      const firstTweet = `${mainTweet}\n\n🧵 Thread (1/${tweetThread.length + 1})`
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(firstTweet)}`
      
      window.open(twitterUrl, '_blank')
      
      showThreadHelper(tweetThread)
    } else {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(mainTweet)}`
      window.open(twitterUrl, '_blank')
    }
  }

  const showThreadHelper = (tweetThread: string[]) => {
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
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash) % 900000 + 100000
    return `MINER-${minerId}`
  }

  const getBaseScanUrl = (transactionHash: string): string => {
    return `https://basescan.org/tx/${transactionHash}`
  }

  const calculateActualAmountPaid = (item: ContentItem): { amount: number; currency: string } => {
    const { payment_details } = item
    
    if (payment_details.payment_currency === 'USDC') {
      const usdcAmount = (item.winning_bid.amount * payment_details.conversion_rate) + 0.03
      return {
        amount: Number(usdcAmount.toFixed(3)),
        currency: 'USDC'
      }
    } else {
      return {
        amount: item.winning_bid.amount,
        currency: 'ROAST'
      }
    }
  }

  // Fetch yapper's purchased content
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
    enabled: !!address,
  })

  // Filter and sort content
  const filteredAndSortedContent = content ? content
    .filter((item: ContentItem) => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const contentMatch = item.content_text.toLowerCase().includes(searchLower)
        const campaignMatch = item.campaign.title.toLowerCase().includes(searchLower)
        const creatorMatch = item.creator.username.toLowerCase().includes(searchLower)
        if (!contentMatch && !campaignMatch && !creatorMatch) return false
      }
      
      if (selectedPlatform !== 'all' && item.campaign.platform_source !== selectedPlatform) {
        return false
      }
      
      const matchesPostType = selectedPostType === 'all' || 
        (item.post_type || 'thread') === selectedPostType
      
      return matchesPostType
    })
    .sort((a: ContentItem, b: ContentItem) => {
      let aValue: number, bValue: number
      if (sortBy === 'mindshare') {
        aValue = a.predicted_mindshare || 0
        bValue = b.predicted_mindshare || 0
      } else {
        aValue = a.quality_score || 0
        bValue = b.quality_score || 0
      }
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    }) : []

  // Stats data
  const stats = [
    {
      key: "tweets",
      label: "Tweets bought",
      value: content?.length?.toString() || "0",
      icon: "/tweetsbag.svg",
    },
    {
      key: "roast",
      label: "Total spent (ROAST+USDC)",
      value: content ? content.reduce((sum: number, item: ContentItem) => {
        const payment = calculateActualAmountPaid(item)
        return sum + payment.amount
      }, 0).toFixed(0) : "0",
      icon: "/roastusdc.svg",
    },
    {
      key: "msgenerated",
      label: "Mindshare generated",
      value: content ? (content.reduce((sum: number, item: ContentItem) => sum + item.predicted_mindshare, 0) / content.length).toFixed(1) + '%' : "0%",
      icon: "/msgenerated.svg",
    },
  ]

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
    <div className="px-4 py-6 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4">
          <h1 className="text-white text-2xl font-bold uppercase">MY CONTENT</h1>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {stats.map((stat, idx) => ( 
              <div key={stat.key} className="relative rounded-[16px] bg-white/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white text-sm font-medium">{stat.label}</div>
                    <div className="text-white text-2xl font-bold mt-1">{stat.value}</div>
                  </div>
                  <div className="rounded-full flex items-center justify-center">
                    <Image src={stat.icon} alt={stat.label} width={16} height={16} className="w-7 h-7" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

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
        ) : filteredAndSortedContent && filteredAndSortedContent.length > 0 ? (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {filteredAndSortedContent.map((item: ContentItem) => {
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
                <article key={item.id} className="group relative yapper-card">
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

                    {/* Overlay content (always visible on My Content) */}
                    <div className="absolute inset-0 bg-white/10 backdrop-blur-xs">
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

                        {/* Bottom bar - Tweet button for My Content */}
                        <div className="mt-auto px-4 md:px-5 pb-4 md:pb-5">
                          <div className="flex items-center justify-center">
                            <button
                              onClick={() => postToTwitter(text, item.tweet_thread)}
                              className="btn-yapper-primary h-9 md:h-10 px-4 md:px-5 glow-button-orange w-full"
                            >
                              Tweet
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* "OWNED" Badge */}
                      <div className="absolute top-2 right-2">
                        <div className="bg-green-600 text-white px-2 py-1 rounded-full text-xs font-bold flex items-center space-x-1">
                          <CheckCircleIcon className="h-3 w-3" />
                          <span>OWNED</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : content && content.length > 0 ? (
          <div className="text-center py-12">
            <div className="text-white/70 text-lg mb-2">No content matches your filters</div>
            <div className="text-white/50">Try adjusting your search or filter criteria</div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-white/70 text-lg mb-2">No content owned yet</div>
            <div className="text-white/50">Purchase content from the marketplace to see it here</div>
          </div>
        )}
    </div>
  )
}