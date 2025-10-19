'use client'

import { useState, useEffect } from 'react'
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
import VideoPlayer from './VideoPlayer'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../utils/markdownParser'
import { buildApiUrl } from '../utils/api-config'
import { showToast } from '../utils/toast'
import { automatedMiningService, MiningStatus } from '../services/automatedMiningService'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[] // Array of tweet thread messages
  content_images?: string[]
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  // Video fields
  is_video?: boolean
  video_url?: string
  watermark_video_url?: string
  video_duration?: number
  subsequent_frame_prompts?: Record<string, string>
  clip_prompts?: Record<string, string>
  audio_prompt?: string
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
  is_available?: boolean // Add availability field
}

interface BiddingModalData {
  contentId: number
  currentPrice: number
  isEnabled: boolean
}

export default function MinerMyContent() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const [showBiddingModal, setShowBiddingModal] = useState<{
    contentId: number
    currentPrice: number
    isEnabled: boolean
  } | null>(null)

  // MINER mode state
  const isMinerMode = process.env.NEXT_PUBLIC_MINER === '1'
  const [miningStatus, setMiningStatus] = useState<MiningStatus>(automatedMiningService.getStatus())
  const [miningReadiness, setMiningReadiness] = useState<{
    canStart: boolean;
    isApproved: boolean;
    hasAgents: boolean;
    hasNeuralKeys: boolean;
    message: string;
  } | null>(null)
  const [biddingAskPrice, setBiddingAskPrice] = useState('')
  const [biddingEndDate, setBiddingEndDate] = useState('')
  const [updatingContentId, setUpdatingContentId] = useState<number | null>(null)
  const [approvingContentIds, setApprovingContentIds] = useState<Set<number>>(new Set())
  const [rejectingContentIds, setRejectingContentIds] = useState<Set<number>>(new Set())
  const [showRejectModal, setShowRejectModal] = useState<{
    contentId: number
    contentTitle: string
  } | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [biddingFilter, setBiddingFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [manuallyStopped, setManuallyStopped] = useState(false) // Track if user manually stopped mining
  const [pagination, setPagination] = useState<{
    currentPage: number
    limit: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
    nextPage: number | null
    prevPage: number | null
  } | null>(null)

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

  // Fetch miner's content (including pending content) with pagination
  const { data: contentData, isLoading } = useQuery({
    queryKey: ['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage],
    queryFn: async () => {
      if (!address) return { data: [], pagination: null }
      
      try {
        const params = new URLSearchParams()
        params.append('include_pending', 'true')
        params.append('page', currentPage.toString())
        params.append('limit', '20')
        
        // Add filter parameters
        if (searchTerm.trim()) {
          params.append('search', searchTerm.trim())
        }
        if (statusFilter !== 'all') {
          params.append('status_filter', statusFilter)
        }
        if (biddingFilter !== 'all') {
          params.append('bidding_filter', biddingFilter)
        }
        if (availabilityFilter !== 'all') {
          params.append('availability_filter', availabilityFilter)
        }
        
        const response = await fetch(buildApiUrl(`marketplace/my-content/miner/wallet/${address}?${params.toString()}`))
        const result = await response.json()
        return {
          data: result.data || [],
          pagination: result.pagination || null
        }
      } catch (error) {
        console.error('Error fetching content:', error)
        return { data: [], pagination: null }
      }
    },
    enabled: !!address
  })

  const content = contentData?.data || []

  // Fetch total metrics (all content without pagination)
  const { data: totalMetrics } = useQuery({
    queryKey: ['miner-content-totals', address, searchTerm, statusFilter, biddingFilter, availabilityFilter],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const params = new URLSearchParams()
        params.append('include_pending', 'true')
        
        // Add filter parameters to totals query
        if (searchTerm.trim()) {
          params.append('search', searchTerm.trim())
        }
        if (statusFilter !== 'all') {
          params.append('status_filter', statusFilter)
        }
        if (biddingFilter !== 'all') {
          params.append('bidding_filter', biddingFilter)
        }
        if (availabilityFilter !== 'all') {
          params.append('availability_filter', availabilityFilter)
        }
        
        const response = await fetch(buildApiUrl(`marketplace/my-content/miner/wallet/${address}/totals?${params.toString()}`))
        const result = await response.json()
        return result.data || []
      } catch (error) {
        console.error('Error fetching total metrics:', error)
        return []
      }
    },
    enabled: !!address
  })

  // Update pagination state when data changes
  useEffect(() => {
    if (contentData?.pagination) {
      setPagination(contentData.pagination)
    }
  }, [contentData])

  // MINER mode: Check mining readiness and setup status listener
  useEffect(() => {
    if (isMinerMode && address) {
      // Check mining readiness
      automatedMiningService.checkMiningReadiness(address).then(setMiningReadiness)

      // Setup status listener
      const handleStatusChange = (status: MiningStatus) => {
        setMiningStatus(status)
      }

      automatedMiningService.addStatusListener(handleStatusChange)

      return () => {
        automatedMiningService.removeStatusListener(handleStatusChange)
      }
    }
  }, [isMinerMode, address])

  // MINER mode: Start mining automatically when ready (only if not manually stopped)
  useEffect(() => {
    if (isMinerMode && address && miningReadiness?.canStart && !miningStatus.isRunning && !manuallyStopped) {
      automatedMiningService.startMining(address).catch(error => {
        console.error('Failed to start automated mining:', error)
        showToast('Failed to start automated mining: ' + error.message, 'error')
      })
    }
  }, [isMinerMode, address, miningReadiness, miningStatus.isRunning, manuallyStopped])

  // MINER mode: Periodic checks to refresh hot campaigns and prevent over-generation
  useEffect(() => {
    if (isMinerMode && address && miningStatus.isRunning && !manuallyStopped) {
      const intervalId = setInterval(() => {
        // Only refresh content data if not currently generating to avoid confusion
        if (!miningStatus.currentCampaign) {
          queryClient.invalidateQueries({
            queryKey: ['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage]
          })
          queryClient.invalidateQueries({
            queryKey: ['miner-content-totals', address, searchTerm, statusFilter, biddingFilter, availabilityFilter]
          })
        }
        
        // Check mining readiness again to ensure conditions are still met (only if not manually stopped)
        if (!manuallyStopped) {
          automatedMiningService.checkMiningReadiness(address).then(newReadiness => {
            if (!newReadiness.canStart && miningStatus.isRunning) {
              console.log('Mining readiness lost, stopping automated mining')
              automatedMiningService.stopMining()
              showToast('Automated mining stopped: requirements no longer met', 'warning')
            }
          }).catch(error => {
            console.error('Error checking mining readiness:', error)
          })
        }
      }, 120000) // Check every 2 minutes to reduce frequency

      return () => clearInterval(intervalId)
    }
  }, [isMinerMode, address, miningStatus.isRunning, miningStatus.currentCampaign, manuallyStopped, queryClient, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage])

  // Pagination handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handleNextPage = () => {
    if (pagination?.hasNextPage) {
      setCurrentPage(pagination.nextPage!)
    }
  }

  const handlePrevPage = () => {
    if (pagination?.hasPrevPage) {
      setCurrentPage(pagination.prevPage!)
    }
  }

  // Reset to page 1 when filters change
  const handleFilterChange = (newFilter: any, setter: any) => {
    setter(newFilter)
    setCurrentPage(1)
  }

  // MINER mode: Handle start/stop mining
  const handleStartMining = async () => {
    if (!address) return

    try {
      setManuallyStopped(false) // Reset the manually stopped flag
      await automatedMiningService.startMining(address)
      showToast('Automated mining started successfully!', 'success')
    } catch (error) {
      console.error('Failed to start mining:', error)
      showToast('Failed to start mining: ' + (error as Error).message, 'error')
    }
  }

  const handleStopMining = () => {
    automatedMiningService.stopMining()
    setManuallyStopped(true) // Mark as manually stopped to prevent auto-restart
    showToast('Automated mining stopped', 'info')
  }

  // Pagination component
  const PaginationComponent = () => {
    if (!pagination || pagination.totalPages <= 1) return null

    const { currentPage, totalPages, hasNextPage, hasPrevPage } = pagination

    // Generate page numbers to show
    const getPageNumbers = () => {
      const pages = []
      const maxVisible = 5
      
      if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        const start = Math.max(1, currentPage - 2)
        const end = Math.min(totalPages, start + maxVisible - 1)
        
        if (start > 1) {
          pages.push(1)
          if (start > 2) pages.push('...')
        }
        
        for (let i = start; i <= end; i++) {
          pages.push(i)
        }
        
        if (end < totalPages) {
          if (end < totalPages - 1) pages.push('...')
          pages.push(totalPages)
        }
      }
      
      return pages
    }

    return (
      <div className="flex items-center justify-between bg-gray-800/30 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-400">
            Page {currentPage} of {totalPages}
          </span>
          <span className="text-sm text-gray-500">•</span>
          <span className="text-sm text-gray-400">
            {pagination.totalItems} total items
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Previous button */}
          <button
            onClick={handlePrevPage}
            disabled={!hasPrevPage}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center space-x-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Previous</span>
          </button>

          {/* Page numbers */}
          <div className="flex items-center space-x-1">
            {getPageNumbers().map((page, index) => (
              <button
                key={index}
                onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
                disabled={typeof page !== 'number'}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  page === currentPage
                    ? 'bg-orange-600 text-white'
                    : typeof page === 'number'
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-gray-800 text-gray-500 cursor-default'
                }`}
              >
                {page}
              </button>
            ))}
          </div>

          {/* Next button */}
          <button
            onClick={handleNextPage}
            disabled={!hasNextPage}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center space-x-1"
          >
            <span>Next</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  const biddingMutation = useMutation({
    mutationFn: async ({ contentId, is_biddable, biddingEndDate, biddingAskPrice }: {
      contentId: number
      is_biddable: boolean
      biddingEndDate?: string
      biddingAskPrice?: number
    }) => {
      // Create AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
      
      try {
        const response = await fetch(buildApiUrl(`marketplace/content/${contentId}/bidding`), {
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
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`)
        }
        
        return response.json()
      } catch (error) {
        clearTimeout(timeoutId)
        
        if (error.name === 'AbortError') {
          throw new Error('Request timed out. Please try again.')
        }
        
        throw error
      }
    },
    onMutate: async ({ contentId, is_biddable, biddingAskPrice }) => {
      console.log(`🔄 Starting optimistic update for content ${contentId}`)
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['miner-content'] })
      
      // Snapshot the previous value
      const previousContent = queryClient.getQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage])
      
      // Optimistically update the UI
      queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], (old: any) => {
        if (!old || !old.data || !Array.isArray(old.data)) return old
        
        return {
          ...old,
          data: old.data.map((item: ContentItem) => 
            item.id === contentId 
              ? { 
                  ...item, 
                  is_biddable,
                  bidding_ask_price: is_biddable ? biddingAskPrice : null,
                  bidding_enabled_at: is_biddable ? new Date().toISOString() : null
                }
              : item
          )
        }
      })
      
      console.log(`✨ Optimistic update completed for content ${contentId}`)
      return { previousContent }
    },
    onError: (err, variables, context) => {
      console.log(`❌ Bidding update failed for content ${variables.contentId}:`, err.message)
      // Revert optimistic update on error
      if (context?.previousContent) {
        queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], context.previousContent)
        console.log(`🔄 Reverted optimistic update for content ${variables.contentId}`)
      }
      console.error('❌ Bidding update failed:', err)
      
      // Show error toast
      showToast(`Failed to ${variables.is_biddable ? 'enable' : 'disable'} bidding: ${err.message}`, 'error')
    },
    onSettled: () => {
      console.log(`🏁 Bidding mutation settled, clearing loading state`)
      // Always refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
      queryClient.invalidateQueries({ queryKey: ['miner-content-totals'] })
      setUpdatingContentId(null) // Clear updating state after mutation settles
    },
    onSuccess: (data, variables) => {
      console.log(`✅ Bidding update successful for content ${variables.contentId}`)
      setShowBiddingModal(null)
      
      // Show success toast
      const action = variables.is_biddable ? 'enabled' : 'disabled'
      const priceText = variables.biddingAskPrice ? ` with price ${variables.biddingAskPrice} ROAST` : ''
      showToast(`Bidding ${action} successfully${priceText}!`, 'success')
    },
  })

  const handleBiddingToggle = (contentId: number, isEnabled: boolean, postType?: string) => {
    console.log(`🚀 Starting bidding toggle for content ${contentId}: ${isEnabled ? 'enable' : 'disable'}`)
    setUpdatingContentId(contentId)
    
    if (isEnabled) {
      // Immediately enable bidding with default pricing
      const defaultPrice = postType === 'longpost' ? 1999 : 999
      console.log(`💰 Setting default price for ${postType}: ${defaultPrice} ROAST`)
      
      // Make the call asynchronous - don't await
      biddingMutation.mutate({
        contentId,
        is_biddable: true,
        biddingAskPrice: defaultPrice
      })
      console.log(`✅ Bidding mutation triggered asynchronously for content ${contentId}`)
    } else {
      // Disable bidding directly
      console.log(`⏸️ Disabling bidding for content ${contentId}`)
      // Make the call asynchronous - don't await
      biddingMutation.mutate({
        contentId,
        is_biddable: false
      })
      console.log(`✅ Bidding disable mutation triggered asynchronously for content ${contentId}`)
    }
  }

  const handlePriceUpdate = (contentId: number, currentPrice: number) => {
    // Show modal to update price
    setShowBiddingModal({
      contentId,
      currentPrice,
      isEnabled: true
    })
    setBiddingAskPrice(currentPrice.toString())
    setBiddingEndDate('')
  }

  const handleRejectContent = (contentId: number, contentTitle: string) => {
    // Show confirmation modal for rejecting approved content
    setShowRejectModal({
      contentId,
      contentTitle
    })
  }

  // Approve content mutation
  const approveMutation = useMutation({
    mutationFn: async (contentId: number) => {
      const response = await fetch(buildApiUrl('marketplace/approve-content'), {
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
    onMutate: async (contentId: number) => {
      // Add this content ID to the approving set
      setApprovingContentIds(prev => new Set(Array.from(prev).concat(contentId)))
      
      // Cancel any outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['miner-content'] })
      
      // Snapshot the previous value
      const previousContent = queryClient.getQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage])
      
      // Optimistically update the content status to prevent button from re-appearing
      queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], (old: any) => {
        if (!old || !old.data || !Array.isArray(old.data)) return old
        
        return {
          ...old,
          data: old.data.map((item: any) => 
            item.id === contentId 
              ? { ...item, status: 'approved', approvedAt: new Date().toISOString(), isAvailable: true }
              : item
          )
        }
      })
      
      return { previousContent }
    },
    onSuccess: (data, contentId) => {
      console.log('✅ Content approved successfully:', data)
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
      queryClient.invalidateQueries({ queryKey: ['miner-content-totals'] })
      showToast('Content approved and published successfully!', 'success')
    },
    onError: (error, contentId, context) => {
      console.error('❌ Failed to approve content:', error)
      
      // Revert optimistic update on error
      if (context?.previousContent) {
        queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], context.previousContent)
      }
      
      showToast(`Failed to approve content: ${error.message}`, 'error')
    },
    onSettled: (data, error, contentId) => {
      // Remove this content ID from the approving set
      setApprovingContentIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(contentId)
        return newSet
      })
    }
  })

  // Reject content mutation
  const rejectMutation = useMutation({
    mutationFn: async (contentId: number) => {
      console.log('🚀 Starting reject mutation for content ID:', contentId, 'with wallet:', address)
      
      if (!contentId || isNaN(contentId)) {
        throw new Error(`Invalid content ID: ${contentId}`)
      }
      
      if (!address) {
        throw new Error('Wallet address is required')
      }
      
      const response = await fetch(buildApiUrl('marketplace/reject-content'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          walletAddress: address
        }),
      })
      
      console.log('📡 Reject API response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('❌ Reject API error response:', errorData)
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      console.log('✅ Reject API success response:', result)
      return result
    },
    onMutate: async (contentId: number) => {
      // Add this content ID to the rejecting set
      setRejectingContentIds(prev => new Set(Array.from(prev).concat(contentId)))
      
      // Cancel any outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['miner-content'] })
      
      // Snapshot the previous value
      const previousContent = queryClient.getQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage])
      
      // Optimistically update the content status to prevent button from re-appearing
      queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], (old: any) => {
        if (!old || !old.data || !Array.isArray(old.data)) return old
        
        return {
          ...old,
          data: old.data.map((item: any) => 
            item.id === contentId 
              ? { ...item, status: 'rejected', rejectedAt: new Date().toISOString(), isAvailable: false }
              : item
          )
        }
      })
      
      return { previousContent }
    },
    onSuccess: (data, contentId) => {
      console.log('✅ Content rejected successfully:', { data, contentId })
      queryClient.invalidateQueries({ queryKey: ['miner-content'] })
      queryClient.invalidateQueries({ queryKey: ['miner-content-totals'] })
      showToast('Content rejected successfully!', 'success')
    },
    onError: (error, contentId, context) => {
      console.error('❌ Failed to reject content:', { error, contentId })
      
      // Revert optimistic update on error
      if (context?.previousContent) {
        queryClient.setQueryData(['miner-content', address, searchTerm, statusFilter, biddingFilter, availabilityFilter, currentPage], context.previousContent)
      }
      
      showToast(`Failed to reject content: ${error.message}`, 'error')
    },
    onSettled: (data, error, contentId) => {
      // Remove this content ID from the rejecting set
      setRejectingContentIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(contentId)
        return newSet
      })
    }
  })

  const handleEnableBidding = () => {
    if (!showBiddingModal) return

    if (showBiddingModal.isEnabled) {
      // Update existing bidding price
      biddingMutation.mutate({
        contentId: showBiddingModal.contentId,
        is_biddable: true,
        biddingAskPrice: biddingAskPrice ? parseFloat(biddingAskPrice) : undefined,
        biddingEndDate: biddingEndDate || undefined
      })
    } else {
      // Enable new bidding
      biddingMutation.mutate({
        contentId: showBiddingModal.contentId,
        is_biddable: true,
        biddingEndDate: biddingEndDate || undefined,
        biddingAskPrice: biddingAskPrice ? parseFloat(biddingAskPrice) : undefined
      })
    }
  }

  // Content is already filtered on the backend, no need for frontend filtering
  const filteredContent = content || []

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white">My Content</h1>
            <p className="text-gray-400">
              {isMinerMode 
                ? 'View your automated content generation and mining status'
                : 'Manage your content, approve pending items, and configure bidding settings'
              }
            </p>
          </div>

          {/* MINER Mode: Start/Stop Mining Controls */}
          {isMinerMode && (
            <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${miningStatus.isRunning ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                    <span className="text-sm font-medium text-white">
                      {miningStatus.isRunning ? 'Mining Active' : 'Mining Stopped'}
                    </span>
                  </div>
                  {miningStatus.currentCampaign && (
                    <div className="text-sm text-gray-300">
                      Processing: <span className="text-orange-400">{miningStatus.currentCampaign.campaignName}</span>
                      <span className="text-gray-500"> ({miningStatus.currentCampaign.postType})</span>
                    </div>
                  )}
                  <div className="text-sm text-gray-400">
                    Generated: <span className="text-green-400">{miningStatus.totalGenerated}</span>
                  </div>
                  {miningStatus.lastGeneration && (
                    <div className="text-sm text-gray-400">
                      Last: {miningStatus.lastGeneration.toLocaleTimeString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-3">
                  {miningReadiness && !miningReadiness.canStart && (
                    <div className={`text-sm ${
                      !miningReadiness.isApproved 
                        ? 'text-red-400' 
                        : miningReadiness.message.includes('Missing') 
                          ? 'text-yellow-400' 
                          : 'text-gray-400'
                    }`}>
                      {miningReadiness.message}
                    </div>
                  )}
                  {miningStatus.isRunning ? (
                    <button
                      onClick={handleStopMining}
                      className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors flex items-center space-x-2"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      <span>Stop Mining</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleStartMining}
                      disabled={!miningReadiness?.canStart}
                      className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                        miningReadiness?.canStart
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                          : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 cursor-not-allowed'
                      }`}
                    >
                      <CheckIcon className="h-4 w-4" />
                      <span>Start Mining</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* MINER Mode: Approval Status Banner */}
          {isMinerMode && miningReadiness && !miningReadiness.isApproved && (
            <div className="bg-gradient-to-r from-red-500/10 to-red-600/10 border border-red-500/20 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-red-500/20 rounded-full">
                  <XMarkIcon className="h-5 w-5 text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-red-400 mb-1">Mining Access Not Approved</h3>
                  <p className="text-sm text-red-300">
                    You are not approved for automated mining. Contact an admin to request approval for automated content generation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* MINER Mode: Approved Status Banner */}
          {isMinerMode && miningReadiness && miningReadiness.isApproved && miningReadiness.canStart && (
            <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-green-500/20 rounded-full">
                  <CheckIcon className="h-5 w-5 text-green-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-green-400 mb-1">Mining Access Approved</h3>
                  <p className="text-sm text-green-300">
                    You are approved for automated mining. Your content will be automatically generated based on hot campaigns.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Search and Filter Controls */}
          <div className="flex flex-col lg:flex-row gap-4">
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
            
            {/* Filter Dropdowns */}
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Status Filter Dropdown */}
              <div className="relative sm:w-48">
                <select
                  value={statusFilter}
                  onChange={(e) => handleFilterChange(e.target.value as 'all' | 'pending' | 'approved' | 'rejected', setStatusFilter)}
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

              {/* Bidding Filter Dropdown */}
              <div className="relative sm:w-48">
                <select
                  value={biddingFilter}
                  onChange={(e) => handleFilterChange(e.target.value as 'all' | 'enabled' | 'disabled', setBiddingFilter)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                >
                  <option value="all">All Bidding</option>
                  <option value="enabled">💰 Bidding Enabled</option>
                  <option value="disabled">⏸️ Bidding Disabled</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Availability Filter Dropdown */}
              <div className="relative sm:w-48">
                <select
                  value={availabilityFilter}
                  onChange={(e) => handleFilterChange(e.target.value as 'all' | 'available' | 'unavailable', setAvailabilityFilter)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                >
                  <option value="all">All Availability</option>
                  <option value="available">🟢 Available</option>
                  <option value="unavailable">🔴 Unavailable</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content Stats */}
        {totalMetrics && totalMetrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
            <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
              <div className="text-2xl font-bold text-white">
                {totalMetrics.length}
              </div>
              <div className="text-sm text-gray-400">Total Content</div>
            </div>
            <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-600/30">
              <div className="text-2xl font-bold text-yellow-400">
                {totalMetrics.filter(item => item.status === 'pending').length}
              </div>
              <div className="text-sm text-yellow-300">Pending Review</div>
            </div>
            <div className="bg-green-900/20 rounded-lg p-4 border border-green-600/30">
              <div className="text-2xl font-bold text-green-400">
                {totalMetrics.filter(item => item.status === 'approved' || !item.status).length}
              </div>
              <div className="text-sm text-green-300">Approved</div>
              <div className="text-xs text-green-400 mt-1">
                {totalMetrics.filter(item => (item.status === 'approved' || !item.status) && item.is_available).length} available
              </div>
            </div>
            <div className="bg-red-900/20 rounded-lg p-4 border border-red-600/30">
              <div className="text-2xl font-bold text-red-400">
                {totalMetrics.filter(item => item.status === 'rejected').length}
              </div>
              <div className="text-sm text-red-300">Rejected</div>
            </div>
            <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-600/30">
              <div className="text-2xl font-bold text-blue-400">
                {totalMetrics.filter(item => item.is_biddable).length}
              </div>
              <div className="text-sm text-blue-300">Bidding Enabled</div>
            </div>
            <div className="bg-purple-900/20 rounded-lg p-4 border border-purple-600/30">
              <div className="text-2xl font-bold text-purple-400">
                {totalMetrics.filter(item => !item.is_biddable).length}
              </div>
              <div className="text-sm text-purple-300">Bidding Disabled</div>
            </div>
            <div className="bg-emerald-900/20 rounded-lg p-4 border border-emerald-600/30">
              <div className="text-2xl font-bold text-emerald-400">
                {totalMetrics.filter(item => item.is_available).length}
              </div>
              <div className="text-sm text-emerald-300">Available</div>
            </div>
          </div>
        )}

        {/* Top Pagination */}
        <PaginationComponent />

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

              // Video URL handling - same as Mining screen
              const videoUrl = item.video_url || null
              
              const hashtags = extractHashtags(text)
              
              // Debug logging
              console.log('🖼️ MyContent: Content images array:', item.content_images)
              console.log('🖼️ MyContent: Selected image URL:', imageUrl)
              console.log('🎬 MyContent: Video data:', {
                is_video: item.is_video,
                video_url: item.video_url,
                watermark_video_url: item.watermark_video_url,
                video_duration: item.video_duration,
                videoUrl: videoUrl
              })
              console.log('🔍 MyContent: Post type:', item.post_type)
              console.log('🔍 MyContent: Should use markdown:', shouldUseMarkdown)
              console.log('🔍 MyContent: Has markdown syntax:', hasMarkdownSyntax)
              console.log('🔍 MyContent: Force markdown:', forceMarkdown)
              console.log('🔍 MyContent: Final condition (shouldUseMarkdown || forceMarkdown):', (shouldUseMarkdown || forceMarkdown))
              
              return (
                <div key={item.id} className={`bg-gray-800/50 rounded-lg border transition-all duration-300 relative ${
                  updatingContentId === item.id 
                    ? 'opacity-75 border-orange-500/50 shadow-lg shadow-orange-500/20' 
                    : 'border-gray-700 hover:border-orange-500/50'
                }`}>
                  {/* Individual Loading Overlay - Only shows for this specific content item */}
                  {updatingContentId === item.id && (
                    <div className="absolute inset-0 bg-black/20 rounded-lg flex items-center justify-center z-10">
                      <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 shadow-lg">
                        <div className="flex items-center space-x-3">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500"></div>
                          <span className="text-white font-medium">Updating bidding settings...</span>
                        </div>
                      </div>
                    </div>
                  )}
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
                      {(shouldUseMarkdown || forceMarkdown) ? (
                        // Render longpost with markdown formatting
                        <div className="relative">
                          <div className="absolute top-2 right-2 z-10">
                            <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(item.post_type).className}`}>
                              {getPostTypeInfo(item.post_type).text}
                            </span>
                          </div>
                          {renderMarkdown(text, { className: 'longpost-content' })}
                          {videoUrl ? (
                            <div className="mt-3 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                              <VideoPlayer
                                src={videoUrl}
                                poster={imageUrl || undefined}
                                autoPlay={false}
                                muted={true}
                                controls={true}
                                className="w-full h-auto"
                              />
                              {item.video_duration && (
                                <div className="mt-2 text-xs text-gray-400 text-center">
                                  Duration: {item.video_duration}s
                                </div>
                              )}
                              {/* Video Watermark Status Badge - Only show for approved video content */}
                              {(item.status === 'approved' || !item.status) && item.is_video && item.video_url && !item.watermark_video_url ? (
                                <div className="mt-2 flex items-center justify-center space-x-2 bg-orange-900/20 border border-orange-600/30 rounded-lg p-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
                                  <span className="text-xs text-orange-400 font-medium">🎬 Video watermarking in progress...</span>
                                </div>
                              ) : (item.status === 'approved' || !item.status) && item.is_video && item.video_url && item.watermark_video_url ? (
                                <div className="mt-2 flex items-center justify-center space-x-2 bg-green-900/20 border border-green-600/30 rounded-lg p-2">
                                  <CheckIcon className="h-4 w-4 text-green-400" />
                                  <span className="text-xs text-green-400 font-medium">✅ Video watermark ready</span>
                                </div>
                              ) : null}
                            </div>
                          ) : imageUrl && (
                            <div className="mt-3 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                              <img 
                                src={imageUrl} 
                                alt="Content image" 
                                className="w-full h-auto"
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
                            is_video={!!videoUrl}
                            video_url={videoUrl || undefined}
                            watermark_video_url={item.watermark_video_url}
                            video_duration={item.video_duration}
                            autoPlay={false} // Don't autoplay videos in MinerMyContent
                          />
                          {/* Video Watermark Status Badge for TweetThreadDisplay - Only show for approved video content */}
                          {videoUrl && (item.status === 'approved' || !item.status) && item.is_video && (
                            <div className="mt-3">
                              {item.video_url && !item.watermark_video_url ? (
                                <div className="flex items-center justify-center space-x-2 bg-orange-900/20 border border-orange-600/30 rounded-lg p-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
                                  <span className="text-xs text-orange-400 font-medium">🎬 Video watermarking in progress...</span>
                                </div>
                              ) : item.video_url && item.watermark_video_url ? (
                                <div className="flex items-center justify-center space-x-2 bg-green-900/20 border border-green-600/30 rounded-lg p-2">
                                  <CheckIcon className="h-4 w-4 text-green-400" />
                                  <span className="text-xs text-green-400 font-medium">✅ Video watermark ready</span>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                      
                    </div>

                    {/* Performance Metrics - Hidden for now, may be required in future */}
                    {false && (
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
                    )}

                    {/* Approve/Reject Section for Pending Content */}
                    {item.status === 'pending' && !isMinerMode && (
                      <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-600/50">
                        <h4 className="text-sm font-semibold text-yellow-400 mb-4">Content Review Required</h4>
                        <div className="flex space-x-4">
                          <button
                            onClick={() => {
                              console.log('🔍 Approve button clicked for content ID:', item.id, 'with wallet:', address)
                              approveMutation.mutate(item.id)
                            }}
                            disabled={approvingContentIds.has(item.id)}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
                          >
                            <CheckIcon className="h-5 w-5 mr-2" />
                            {approvingContentIds.has(item.id) ? 'Approving...' : 'Approve & Publish'}
                          </button>
                          <button
                            onClick={() => {
                              console.log('🔍 Reject button clicked for content ID:', item.id, 'with wallet:', address)
                              rejectMutation.mutate(item.id)
                            }}
                            disabled={rejectingContentIds.has(item.id)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
                          >
                            <XMarkIcon className="h-5 w-5 mr-2" />
                            {rejectingContentIds.has(item.id) ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* MINER Mode: Show pending status message */}
                    {item.status === 'pending' && isMinerMode && (
                      <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-600/50">
                        <h4 className="text-sm font-semibold text-yellow-400 mb-2">Content Pending Review</h4>
                        <p className="text-sm text-yellow-300">
                          This content is waiting for admin approval. Admins will review and approve/reject your content automatically.
                        </p>
                      </div>
                    )}

                    {/* Bidding Management Section - Only show for approved content and not in MINER mode */}
                    {(item.status === 'approved' || !item.status) && !isMinerMode && (
                      <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-600">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-semibold text-orange-400">Bidding Management</h4>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-300">Enable Bidding</span>
                            <input
                              type="checkbox"
                              checked={item.is_biddable}
                              onChange={(e) => handleBiddingToggle(item.id, e.target.checked, item.post_type)}
                              disabled={updatingContentId === item.id}
                              className="w-4 h-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            {updatingContentId === item.id && (
                              <div className="ml-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Content Moderation Section - Show for available and approved content that is NOT biddable */}
                        {item.is_available && (item.status === 'approved' || !item.status) && !item.is_biddable && (
                          <div className="mb-4 p-3 bg-yellow-900/20 rounded-lg border border-yellow-600/30">
                            <h5 className="text-sm font-medium text-yellow-400 mb-2">Content Moderation</h5>
                            <p className="text-xs text-yellow-300 mb-3">
                              This content is currently available and approved but not enabled for bidding. You can reject it if needed.
                            </p>
                            <button
                              onClick={() => {
                                console.log('🔍 Reject button clicked for content:', {
                                  id: item.id,
                                  title: item.campaign.title,
                                  status: item.status,
                                  is_available: item.is_available,
                                  is_biddable: item.is_biddable
                                })
                                handleRejectContent(item.id, item.campaign.title)
                              }}
                              disabled={rejectingContentIds.has(item.id)}
                              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                              <XMarkIcon className="h-4 w-4 mr-2" />
                              {rejectingContentIds.has(item.id) ? 'Rejecting...' : 'Reject Content'}
                            </button>
                          </div>
                        )}

                        {/* Info message for content that can't be rejected */}
                        {item.is_available && (item.status === 'approved' || !item.status) && item.is_biddable && (
                          <div className="mb-4 p-3 bg-blue-900/20 rounded-lg border border-blue-600/30">
                            <h5 className="text-sm font-medium text-blue-400 mb-2">Content Status</h5>
                            <p className="text-xs text-blue-300">
                              This content is currently available, approved, and enabled for bidding. 
                              To reject it, first disable bidding using the checkbox above.
                            </p>
                          </div>
                        )}

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
                          
                          {/* Price Update Button */}
                          <div className="pt-2">
                            <button
                              onClick={() => handlePriceUpdate(item.id, item.bidding_ask_price || 0)}
                              disabled={updatingContentId === item.id}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {updatingContentId === item.id ? 'Updating...' : '💰 Update Price'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    )}

                    {/* MINER Mode: Show bidding status for approved content */}
                    {(item.status === 'approved' || !item.status) && isMinerMode && (
                      <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-600">
                        <h4 className="text-sm font-semibold text-orange-400 mb-2">Bidding Status</h4>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className={`text-sm px-2 py-1 rounded-full ${
                              item.is_biddable 
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                            }`}>
                              {item.is_biddable ? 'Bidding Enabled' : 'Bidding Disabled'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400">
                            Bidding is managed by admins
                          </p>
                        </div>
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
               statusFilter !== 'all' && biddingFilter !== 'all' && availabilityFilter !== 'all' ? `No ${statusFilter} content with ${biddingFilter} bidding and ${availabilityFilter} availability` :
               statusFilter !== 'all' && biddingFilter !== 'all' ? `No ${statusFilter} content with ${biddingFilter} bidding` :
               statusFilter !== 'all' && availabilityFilter !== 'all' ? `No ${statusFilter} content with ${availabilityFilter} availability` :
               statusFilter === 'pending' ? 'No pending content' :
               statusFilter === 'approved' ? 'No approved content' :
               statusFilter === 'rejected' ? 'No rejected content' :
               biddingFilter === 'enabled' ? 'No content with bidding enabled' :
               biddingFilter === 'disabled' ? 'No content with bidding disabled' :
               availabilityFilter === 'available' ? 'No available content' :
               availabilityFilter === 'unavailable' ? 'No unavailable content' :
               'No content yet'}
            </div>
            <div className="text-gray-500">
              {searchTerm ? 'Try adjusting your search terms or filters' : 
               statusFilter !== 'all' || biddingFilter !== 'all' || availabilityFilter !== 'all' ? 'Try changing your filter settings to see more content' :
               'Start mining to create content that can be reviewed and published'}
            </div>
          </div>
        )}

        {/* Bottom Pagination */}
        <PaginationComponent />

        {/* Bidding Settings Modal */}
        {showBiddingModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl border border-gray-600 p-6 max-w-md w-full mx-4 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-4">
                {showBiddingModal.isEnabled ? 'Update Bidding Price' : 'Enable Bidding'}
              </h3>
              
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
                  disabled={updatingContentId === showBiddingModal?.contentId}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                >
                  {updatingContentId === showBiddingModal?.contentId ? 'Updating...' : (showBiddingModal?.isEnabled ? 'Update Price' : 'Enable Bidding')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Content Confirmation Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl border border-gray-600 p-6 max-w-md w-full mx-4 shadow-xl">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center">
                  <XMarkIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Reject Approved Content</h3>
                  <p className="text-sm text-gray-400">This action cannot be undone</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-gray-300 mb-3">
                  Are you sure you want to reject the content from campaign:
                </p>
                <div className="bg-gray-700 rounded-lg p-3 border border-gray-600">
                  <p className="text-white font-medium">"{showRejectModal.contentTitle}"</p>
                </div>
                <p className="text-sm text-red-400 mt-2">
                  ⚠️ This will immediately remove the content from the marketplace and disable bidding.
                </p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowRejectModal(null)}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (showRejectModal) {
                      console.log('🔍 Confirmed rejection for content:', {
                        contentId: showRejectModal.contentId,
                        contentTitle: showRejectModal.contentTitle,
                        wallet: address
                      })
                      rejectMutation.mutate(showRejectModal.contentId)
                      setShowRejectModal(null)
                    }
                  }}
                  disabled={showRejectModal ? rejectingContentIds.has(showRejectModal.contentId) : false}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {showRejectModal && rejectingContentIds.has(showRejectModal.contentId) ? 'Rejecting...' : 'Yes, Reject Content'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 