'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Image from 'next/image'
import { generateRandomMindshare, formatMindshare } from '../../utils/mindshareUtils'

import { useROASTPrice, formatUSDCPrice } from '../../utils/priceUtils'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance } from '../../utils/walletUtils'
import { executeROASTPayment } from '../../services/roastPaymentService'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo, markdownToPlainText, markdownToHTML } from '../../utils/markdownParser'
import WalletConnectionModal from '../WalletConnectionModal'
import { useTwitter } from '../../contexts/TwitterContext'
import { useMarketplaceAccess } from '../../hooks/useMarketplaceAccess'
import { useAuth } from '../../hooks/useAuth'
import { useTwitterPosting } from '../../hooks/useTwitterPosting'
import { useRouter } from 'next/navigation'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
  watermark_image?: string
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  bidding_ask_price?: number  // Add bidding ask price field
  creator: {
    id: number
    username: string
    reputation_score: number
    wallet_address?: string
  }
  campaign: {
    id: number
    title: string
    platform_source: string
    project_name?: string
    reward_token: string
  }
  agent_name?: string
  created_at: string
  post_type?: string
  approved_at?: string
  bidding_enabled_at?: string
}

interface PurchaseContentModalProps {
  content: ContentItem | null
  isOpen: boolean
  onClose: () => void
  onPurchase?: (contentId: number, price: number, currency: 'ROAST' | 'USDC', transactionHash?: string) => void
  onContentUpdate?: (updatedContent: ContentItem) => void
}

export default function PurchaseContentModal({
  content,
  isOpen,
  onClose,
  onPurchase,
  onContentUpdate
}: PurchaseContentModalProps) {
  
  const { address } = useAccount()
  const { price: roastPrice } = useROASTPrice()
  const { twitter, connect, disconnect, refreshToken, isTwitterReady } = useTwitter()
  const { hasAccess } = useMarketplaceAccess()
  const { isAuthenticated, signIn } = useAuth()
  const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting()
  const router = useRouter()
  
  // Helper function to check if URL is a presigned S3 URL
  const isPresignedS3Url = (url: string) => {
    return url.includes('s3.amazonaws.com') && url.includes('?') && 
           (url.includes('X-Amz-Signature') || url.includes('Signature'))
  }
  
  // Helper function to get the correct price (bidding_ask_price if available, otherwise asking_price)
  const getDisplayPrice = (content: ContentItem | null) => {
    if (!content) return 0
    return content.bidding_ask_price || content.asking_price || 0
  }
  
  // Yapper interface content generation functions
  const generateContentFromYapper = async () => {
    if (!selectedYapper || !localContent) return
    
    try {
      setIsGeneratingContent(true)
      setGenerationStatus('Starting content generation...')
      setGenerationProgress(0)
      
      // Call TypeScript backend to start content generation
      const response = await fetch('/api/yapper-interface/generate-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
          campaigns: [{
            campaign_id: typeof localContent.campaign.id === 'string' ? parseInt(localContent.campaign.id) : localContent.campaign.id,
            agent_id: 1, // Default agent
            campaign_context: {
              // Provide some basic context for the campaign
              campaign_title: localContent.campaign.title || 'Unknown Campaign',
              platform_source: localContent.campaign.platform_source || 'Unknown Platform',
              project_name: localContent.campaign.project_name || 'Unknown Project',
              reward_token: localContent.campaign.reward_token || 'Unknown Token',
              post_type: localContent.post_type || 'thread'
            },
            post_type: localContent.post_type || 'thread',
            include_brand_logo: true,
            source: 'yapper_interface',
            selected_yapper_handle: selectedYapper,
            price: getDisplayPrice(localContent)
          }],
          user_preferences: {},
          user_api_keys: {}, // Empty for yapper interface - system will use system keys
          source: 'yapper_interface'
        })
      })
      
      if (!response.ok) {
        throw new Error('Failed to start content generation')
      }
      
      const result = await response.json()
      setExecutionId(result.execution_id)
      setGenerationStatus('Content generation started. Polling for updates...')
      setGenerationProgress(10)
      
      // Start polling for execution status
      startExecutionPolling(result.execution_id)
      
    } catch (error) {
      console.error('Error starting content generation:', error)
      setGenerationStatus('Failed to start content generation')
      setIsGeneratingContent(false)
    }
  }
  
  const startExecutionPolling = async (execId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/yapper-interface/status/${execId}`)
        
        if (!response.ok) {
          clearInterval(pollInterval)
          setGenerationStatus('Failed to get execution status')
          setIsGeneratingContent(false)
          return
        }
        
        const status = await response.json()
        setGenerationProgress(status.progress || 0)
        setGenerationStatus(status.message || 'Processing...')
        
        if (status.status === 'completed') {
          clearInterval(pollInterval)
          // Keep shimmer active during approval process
          setGenerationStatus('Content generation completed! Starting approval process...')
          
          // Store execution ID for the next steps
          setExecutionId(execId)
          
          // Start approval process (shimmer continues until approval is complete)
          await startApprovalProcess(execId)
        } else if (status.status === 'failed') {
          clearInterval(pollInterval)
          setIsGeneratingContent(false)
          setGenerationStatus(`Generation failed: ${status.error || 'Unknown error'}`)
        }
        
      } catch (error) {
        console.error('Error polling execution status:', error)
        clearInterval(pollInterval)
        setGenerationStatus('Error checking status')
        setIsGeneratingContent(false)
      }
    }, 2000) // Poll every 2 seconds
  }
  
  const startApprovalProcess = async (execId: string) => {
    try {
      setGenerationStatus('Starting content approval process...')
      
      // Get execution details to find content ID
      const execResponse = await fetch(`/api/execution/status/${execId}`)
      if (!execResponse.ok) {
        throw new Error('Failed to get execution details')
      }
      
      const execDetails = await execResponse.json()
      console.log('🔍 Execution details:', execDetails)
      
      if (!execDetails.content_id) {
        throw new Error('Content ID not found in execution details. Content may not have been generated properly.')
      }
      
      // Validate that content generation was successful
      if (execDetails.status !== 'completed') {
        throw new Error(`Execution status is ${execDetails.status}, expected 'completed'. Content generation may have failed.`)
      }
      
      // No need to validate content images here - they will be watermarked during approval
      console.log('🔍 Starting approval process for content ID:', execDetails.content_id)
      
      // Step 1: Approve content and create watermarks
      setGenerationStatus('Creating watermarks and approving content...')
      const approveResponse = await fetch(`/api/marketplace/approve-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId: execDetails.content_id,
          walletAddress: address
        })
      })
      
      if (!approveResponse.ok) {
        const errorData = await approveResponse.json().catch(() => ({}))
        throw new Error(`Failed to approve content: ${errorData.message || approveResponse.statusText}`)
      }
      
      const approveResult = await approveResponse.json()
      setGenerationStatus('Content approved! Making it available for purchase...')
      
      // Step 2: Enable bidding (pushes content to marketplace)
      const biddableResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}/bidding`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_biddable: true,
          bidding_ask_price: getDisplayPrice(localContent) || 100,
          wallet_address: address
        })
      })
      
      if (!biddableResponse.ok) {
        const errorData = await biddableResponse.json().catch(() => ({}))
        throw new Error(`Failed to enable bidding: ${errorData.message || biddableResponse.statusText}`)
      }
      
      const biddableResult = await biddableResponse.json()
      
      // Success! Content is now available on marketplace
      setGenerationStatus('🎉 Content successfully generated and available on marketplace!')
      
      // Fetch the final watermarked content to replace the modal content
      try {
        const contentResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}`)
        if (contentResponse.ok) {
          const responseData = await contentResponse.json()
          console.log('✅ API response received:', responseData)
          
          // Extract content from the nested data structure
          const newContent = responseData.data?.content
          if (!newContent) {
            throw new Error('Content not found in API response')
          }
          
          console.log('✅ New watermarked content extracted:', newContent)
          
          // Now refresh the URLs to get presigned URLs for images
          console.log('🔄 Refreshing presigned URLs for content...')
          const refreshResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}/refresh-urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
          
          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json()
            console.log('✅ URLs refreshed:', refreshData)
            
            if (refreshData.success && refreshData.data) {
              // Use the refreshed content with presigned URLs
              const refreshedContent = refreshData.data
              console.log('✅ Refreshed content with presigned URLs:', refreshedContent)
              
              // Update local content state to show new content in modal
              setLocalContent(refreshedContent)
              setGeneratedContent(refreshedContent)
              
              console.log('🔍 State updates applied:')
              console.log('  - localContent set to:', refreshedContent)
              console.log('  - generatedContent set to:', refreshedContent)
              console.log('  - Content ID:', refreshedContent.id)
              console.log('  - Content text length:', refreshedContent.content_text?.length)
              console.log('  - Has images:', refreshedContent.content_images?.length > 0)
              console.log('  - Watermark image:', refreshedContent.watermark_image)
              
              // Notify parent component about content update
              if (onContentUpdate) {
                onContentUpdate(refreshedContent)
              }
              
              // Update the content state to show the new content
              // This will trigger a re-render with the new content
              setGenerationStatus('✅ Content replaced! You can now preview and purchase the generated content.')
              
              // Only now hide the shimmer - content is fully ready
              setIsGeneratingContent(false)
            } else {
              throw new Error('Failed to refresh URLs')
            }
          } else {
            console.warn('⚠️ Failed to refresh URLs, using original content')
            // Fallback to original content without presigned URLs
            setLocalContent(newContent)
            setGeneratedContent(newContent)
            
            if (onContentUpdate) {
              onContentUpdate(newContent)
            }
            
            setGenerationStatus('✅ Content replaced! You can now preview and purchase the generated content.')
            setIsGeneratingContent(false)
          }
        } else {
          throw new Error(`Failed to fetch content: ${contentResponse.status} ${contentResponse.statusText}`)
        }
      } catch (error) {
        console.error('Error fetching generated content:', error)
        setGenerationStatus('✅ Content generated! You can now preview and purchase.')
        setIsGeneratingContent(false) // Hide shimmer even on error
      }
      
    } catch (error) {
      console.error('Error in approval process:', error)
      setGenerationStatus(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      
      // Show error to user
      alert(`Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto")
  const [selectedTone, setSelectedTone] = useState("Select tone")
  const [selectedPayment, setSelectedPayment] = useState("roast")
  const [toneOpen, setToneOpen] = useState<boolean>(false)
  const [isPurchased, setIsPurchased] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showCopyProtection, setShowCopyProtection] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [allYappers, setAllYappers] = useState<Array<{
    id: number;
    twitter_handle: string;
    display_name: string;
  }>>([])
  const [selectedYapper, setSelectedYapper] = useState<string>("")
  const [isLoadingYappers, setIsLoadingYappers] = useState(false)
  const [yapperSearchQuery, setYapperSearchQuery] = useState<string>("")
  // Removed minerInfo state to protect privacy - only show username from users table
  const [showTweetManagement, setShowTweetManagement] = useState(false)
  const [postingMethod, setPostingMethod] = useState<'twitter' | 'manual'>('twitter')
  const [loggedInUserInfo, setLoggedInUserInfo] = useState<{
    username: string;
    profileImage?: string;
  } | null>(null)
  
  // Local content state that can be updated when new content is generated
  const [localContent, setLocalContent] = useState<ContentItem | null>(content)
  
  // Yapper interface content generation state
  const [isGeneratingContent, setIsGeneratingContent] = useState(false)
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string>('')
  const [generatedContent, setGeneratedContent] = useState<ContentItem | null>(null)
  
  // Store original content for fallback
  const [originalContent, setOriginalContent] = useState<ContentItem | null>(content)
  
  // Update local content when content prop changes
  useEffect(() => {
    setLocalContent(content)
    setOriginalContent(content)
  }, [content])
  
  // Handle purchase with content management
  const handlePurchaseWithContentManagement = async (contentToPurchase: ContentItem, price: number, currency: 'ROAST' | 'USDC') => {
    try {
      // If this is generated content, mark it as unavailable after purchase
      if (generatedContent && contentToPurchase.id === generatedContent.id) {
        // Mark generated content as unavailable
        await fetch(`/api/content-approval/mark-unavailable/${contentToPurchase.id}`, {
          method: 'POST'
        })
        
        // Restore original content to marketplace (make it available again)
        if (originalContent) {
          await fetch(`/api/content-approval/restore-availability/${originalContent.id}`, {
            method: 'POST'
          })
        }
        
        // Call the original purchase handler
        if (onPurchase) {
          onPurchase(contentToPurchase.id, price, currency)
        }
        
        // Close modal
        onClose()
      } else {
        // Regular purchase flow for original content
        if (onPurchase) {
          onPurchase(contentToPurchase.id, price, currency)
        }
      }
    } catch (error) {
      console.error('Error in purchase with content management:', error)
    }
  }
  
  // Individual shimmer components for different content elements
  const TextShimmer = () => (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-1/2"></div>
    </div>
  )

  const ImageShimmer = () => (
    <div className="w-full h-48 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 animate-pulse rounded-2xl"></div>
  )

  const ThreadItemShimmer = () => (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-full"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-4/5"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
    </div>
  )

  // Full shimmer loading component for tweet preview (fallback)
  const TweetPreviewShimmer = () => (
    <div className="animate-pulse">
      {/* Image shimmer */}
      <div className="w-full h-48 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded-2xl mb-4"></div>
      
      {/* Text shimmer */}
      <div className="space-y-3">
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-1/2"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-5/6"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-2/3"></div>
      </div>
      
      {/* Thread shimmer */}
      <div className="mt-6 space-y-3">
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-full"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-4/5"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
      </div>
    </div>
  )
  
  const [isLoadingUserInfo, setIsLoadingUserInfo] = useState(false)
  const [isPostingToTwitter, setIsPostingToTwitter] = useState(false)
  const [twitterPostingResult, setTwitterPostingResult] = useState<{
    success: boolean;
    message: string;
    tweetUrl?: string;
  } | null>(null)

  // Store original content when modal opens
  useEffect(() => {
    if (content && !originalContent) {
      setOriginalContent(content)
    }
  }, [content, originalContent])
  


  // Auto-close wallet modal when wallet connects
  useEffect(() => {
    if (address && showWalletModal) {
      setShowWalletModal(false)
    }
  }, [address, showWalletModal])

  // Twitter connection is now handled by global context - no local effects needed

  // Twitter connection checking now handled by global context

  // Twitter token refresh now handled by global context

  // Twitter disconnect now handled by global context

  // Fetch all yappers from leaderboard
  const fetchAllYappers = async () => {
    setIsLoadingYappers(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/leaderboard-yapper/all`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.yappers) {
          // Map to simplified structure without ranking/snaps
          const simplifiedYappers = data.yappers.map((yapper: any) => ({
            id: yapper.id,
            twitter_handle: yapper.twitter_handle,
            display_name: yapper.display_name
          }))
          setAllYappers(simplifiedYappers)
        }
      } else {
        console.error('Failed to fetch yappers')
      }
    } catch (error) {
      console.error('Error fetching yappers:', error)
    } finally {
      setIsLoadingYappers(false)
    }
  }

  // Fetch yappers when Choose Yapper tab is selected
  useEffect(() => {
    if (selectedVoiceTone === "custom") {
      fetchAllYappers()
    }
  }, [selectedVoiceTone])

  // Fetch logged-in user's information from users table
  const fetchLoggedInUserInfo = async () => {
    if (!address || !isAuthenticated) return

    setIsLoadingUserInfo(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/users/profile/${address}`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setLoggedInUserInfo({
            username: data.user.username,
            profileImage: data.user.profile?.profileImage
          })
        }
      } else {
        console.error('Failed to fetch user info')
      }
    } catch (error) {
      console.error('Error fetching user info:', error)
    } finally {
      setIsLoadingUserInfo(false)
    }
  }

  // Fetch user info when modal opens and user is authenticated
  useEffect(() => {
    if (address && isAuthenticated) {
      fetchLoggedInUserInfo()
    }
  }, [address, isAuthenticated])

  // Filter yappers based on search query
  const filteredYappers = allYappers.filter((yapper) => {
    const searchLower = yapperSearchQuery.toLowerCase()
    return (
      yapper.twitter_handle.toLowerCase().includes(searchLower) ||
      yapper.display_name.toLowerCase().includes(searchLower)
    )
  })

  // Helper functions to get display data based on Twitter connection (for tweet preview only)
  // Priority: Twitter handle > Logged-in user username > Miner username (for non-logged-in users)
  const getDisplayName = () => {
    if (twitter.isConnected && twitter.profile?.displayName) {
      return twitter.profile.displayName
    }
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username || 'User'
  }

  const getTwitterHandle = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.toLowerCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.toLowerCase() || 'user'
  }

  const getInitialLetter = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username.charAt(0).toUpperCase()
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.charAt(0).toUpperCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.charAt(0).toUpperCase() || 'U'
  }

  // Content parsing functions for tweet management (from TweetPreviewModal)
  const extractImageUrlForManagement = (contentText: string): string | null => {
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

  const formatTwitterContentForManagement = (contentText: string): { text: string; hashtags: string[]; characterCount: number; imageUrl: string | null } => {
    const imageUrl = extractImageUrlForManagement(contentText)
    
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

  const getTweetManagementData = () => {
    if (!localContent) return { tweetText: '', formatted: null, displayImage: '', processedThread: [] }

    // Check if this is a longpost that should be rendered as markdown
    const shouldUseMarkdown = isMarkdownContent(localContent.post_type)
    
    // Check if content has markdown syntax
    const hasMarkdownSyntax = localContent.content_text?.includes('##') || localContent.content_text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    let tweetText = ''
    if (shouldUseMarkdown || forceMarkdown) {
      tweetText = markdownToPlainText(localContent.content_text)
    } else {
      const formatted = formatTwitterContentForManagement(localContent.content_text)
      tweetText = formatted.text || ''
    }
    
    const displayImage = localContent.content_images && localContent.content_images.length > 0
      ? localContent.content_images[0]
      : ''
    
    const processedThread = localContent.tweet_thread ? localContent.tweet_thread.map(tweet => {
      return {
        text: tweet,
        imageUrl: null
      }
    }) : []
    
    return {
      tweetText,
      formatted: null,
      displayImage,
      processedThread
    }
  }

  // Download image function (from TweetPreviewModal)
  const downloadImage = async (imageUrl: string, filename: string = 'tweet-image.png') => {
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

  // Twitter posting function
  const handlePostToTwitter = async () => {
    if (!localContent) return

    setIsPostingToTwitter(true)
    try {
      // Check if this is markdown content (longpost)
      const shouldUseMarkdown = isMarkdownContent(localContent.post_type)
      const hasMarkdownSyntax = localContent.content_text?.includes('##') || localContent.content_text?.includes('**')
      const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
      
      let tweetText: string
      let extractedImageUrl: string | null = null
      
      if (forceMarkdown) {
        // For longpost content, convert markdown to plain text for Twitter
        tweetText = markdownToPlainText(localContent.content_text)
      } else {
        // For regular content, use existing formatting
        const formatted = formatTwitterContentForManagement(localContent.content_text)
        tweetText = formatted.text
        extractedImageUrl = formatted.imageUrl
      }
      
      // Use original image for posting (after purchase), not watermarked
      const displayImage = localContent.content_images && localContent.content_images.length > 0 
          ? localContent.content_images[0] 
          : extractedImageUrl

      // Prepare tweet data - also convert thread items if they contain markdown
      const processedThread = localContent.tweet_thread ? localContent.tweet_thread.map(tweet => {
        // Check if thread item contains markdown
        if (tweet.includes('##') || tweet.includes('**')) {
          return markdownToPlainText(tweet)
        }
        return tweet
      }) : []

      const tweetData = {
        mainTweet: tweetText,
        thread: processedThread,
        imageUrl: displayImage
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/twitter/post-thread`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${address}` // Use wallet address as identifier
        },
        body: JSON.stringify(tweetData)
      })

      console.log('🔍 Posting with wallet address:', address)

      const result = await response.json()

      if (result.success) {
        // Show success message within modal
        setTwitterPostingResult({
          success: true,
          message: 'Thread posted successfully!',
          tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`
        })
      } else {
        throw new Error(result.error || 'Failed to post to Twitter')
      }
    } catch (error) {
      console.error('Error posting to Twitter:', error)
      setTwitterPostingResult({
        success: false,
        message: 'Failed to post to Twitter. Please try again or use manual posting.'
      })
    } finally {
      setIsPostingToTwitter(false)
    }
  }

  // Twitter authentication for posting - use global Twitter context
  const handleTwitterAuth = async () => {
    if (!address) {
      setShowWalletModal(true)
      return
    }

    try {
      // Use the global Twitter context connect method
      await connect()
      // Refresh Twitter posting status after successful auth
      setTimeout(() => {
        refreshTwitterStatus()
      }, 1000)
    } catch (error) {
      console.error('Error initiating Twitter auth:', error)
    }
  }

  // Original Twitter authentication for My Voice tab
  const handleTwitterAuthVoice = async () => {
    if (!address) {
      setShowWalletModal(true)
      return
    }

    try {
      const success = await connect()
      if (success) {
        console.log('✅ Twitter connection successful in modal')
      } else {
        console.error('❌ Twitter connection failed in modal')
      }
    } catch (error) {
      console.error('❌ Twitter authentication error:', error)
    }
  }

  // Generate button handler with trigger-based token refresh
  const handleGenerate = async () => {
    if (!address) {
      setShowWalletModal(true)
      return
    }

    // Only proceed if user has connected Twitter (My Voice tab)
    if (!twitter.isConnected) {
      console.log('⚠️ Cannot generate - Twitter not connected')
      alert('Please connect your Twitter account first.')
      return
    }

    console.log('🎯 Generate button clicked - checking if token needs refresh...')

    // Check if token is expired based on tokenExpiresAt timestamp
    // This is the ONLY place where we check and refresh tokens
    try {
      const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`)
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json()
        
        if (statusData.success && statusData.data.token_status === 'expired') {
          console.log('🔄 Token expired based on tokenExpiresAt, attempting refresh...')
          const refreshSuccess = await refreshToken()
          
          if (!refreshSuccess) {
            console.log('❌ Token refresh failed, user needs to reconnect')
            console.error('Your Twitter access has expired and could not be refreshed. Please reconnect your Twitter account.')
            return
          }
          console.log('✅ Token refreshed successfully, proceeding with generation...')
        } else if (statusData.data.token_status === 'valid') {
          console.log('✅ Token is valid, proceeding with generation...')
        } else {
          console.log('⚠️ Token is missing, user needs to connect Twitter')
          console.error('Please connect your Twitter account first.')
          return
        }
      }
    } catch (error) {
      console.error('❌ Error checking token status:', error)
      console.error('Failed to verify Twitter connection. Please try again.')
      return
    }

    // If we reach here, token is valid and we can proceed with generation
    console.log('🚀 Proceeding with content generation...')
    // TODO: Add actual generation logic here
    console.log('Generation would start here! (Token is valid and ready)')
  }

  // Generate consistent random leaderboard position change for this content item
  // Intelligent distribution: higher for tweets with 2+ Twitter handles, lower for others
  const getRandomLeaderboardPositionChange = (itemId: string, contentText: string, tweetThread?: string[]) => {
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
    }
    
    // Transform to 5-50 range
    position = Math.floor(skewed * 45) + 5
    
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
  }

  // Copy protection functions
  const preventRightClick = (e: React.MouseEvent) => {
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

  // Purchase functionality
  const handlePurchase = async () => {
    if (!content) {
      console.error('No content to purchase')
      return
    }

    // Handle different authentication states
    if (!address) {
      console.log('🔗 No wallet connected - opening wallet modal')
      setShowWalletModal(true)
      return
    }

    if (!isAuthenticated) {
      console.log('🔐 Wallet connected but not authenticated - need signature')
      try {
        const authResult = await signIn()
        if (authResult) {
          console.log('✅ Authentication successful, continuing purchase...')
          // Don't return here - continue with purchase flow since auth is now complete
        } else {
          console.log('❌ Authentication failed or cancelled')
          return
        }
      } catch (error) {
        console.error('❌ Authentication error:', error)
        return
      }
    }

    if (isAuthenticated && !hasAccess) {
      console.log('🚫 User authenticated but no marketplace access - redirect to access page')
      router.push('/access')
      return
    }

    setIsLoading(true)
    try {
      let success = false
      
      // Get treasury address from environment or API
      const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b8D0a8e0E6a1e2cf47' // fallback address
      
      if (!treasuryAddress) {
        console.error('Treasury wallet address not configured')
        return
      }

      // Calculate required amount
      if (!localContent) {
        throw new Error('No content available for purchase');
      }
      
      const requiredAmount = getDisplayPrice(localContent);
      
      // Calculate USDC equivalent
              const usdcPrice = roastPrice ? (getDisplayPrice(localContent) * roastPrice) : 0;
      
      // Add 0.03 USDC fee
      const usdcFee = 0.03;
      const totalUSDC = usdcPrice + usdcFee;

      console.log(`🔍 Checking ${'ROAST'.toUpperCase()} balance via backend...`);
      
      // Backend balance check
      const balanceResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/check-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address,
          tokenType: 'roast',
          requiredAmount: requiredAmount
        }),
      });

      if (!balanceResponse.ok) {
        throw new Error('Failed to check balance');
      }

      const balanceData = await balanceResponse.json();
      
      if (!balanceData.success) {
        throw new Error(balanceData.error || 'Balance check failed');
      }

      // If insufficient balance, show error in modal (no wallet confirmation needed)
      if (!balanceData.data.hasBalance) {
        console.error(`Insufficient ${balanceData.data.tokenType} balance. You have ${balanceData.data.balance.toFixed(4)} ${balanceData.data.tokenType}, but need ${balanceData.data.requiredAmount} ${balanceData.data.tokenType}.`)
        return;
      }

      console.log(`✅ Balance check passed: ${balanceData.data.balance} ${balanceData.data.tokenType} available`);

      // Execute payment directly without token registration

      // Execute transaction using working implementation pattern
      let result: any;
      if (selectedPayment === 'roast') {
        console.log(`🔄 Executing ROAST payment: ${requiredAmount} ROAST to ${treasuryAddress}`)
        
        try {
          // Use the working implementation service for better wallet display
          const transactionHash = await executeROASTPayment(requiredAmount, treasuryAddress);
          result = {
            success: true,
            transactionHash: transactionHash,
            hash: transactionHash
          };
          success = true;
          console.log('✅ ROAST payment successful with proper wallet display:', result);
        } catch (error) {
          console.error('❌ ROAST payment failed:', error);
          result = {
            success: false,
            error: error
          };
          success = false;
        }
      } else {
        console.log(`🔄 Initiating USDC transfer: ${totalUSDC} USDC to ${treasuryAddress}`)
        result = await transferUSDC(totalUSDC, treasuryAddress)
        success = result.success
      }

      if (success) {
        // Call the content management purchase handler
        if (result.success) {
          const transactionHash = result.transactionHash;
          await handlePurchaseWithContentManagement(localContent, requiredAmount, selectedPayment === 'roast' ? 'ROAST' : 'USDC')
          
          // Also call the original onPurchase callback if provided
          if (onPurchase) {
            await onPurchase(localContent.id, requiredAmount, selectedPayment === 'roast' ? 'ROAST' : 'USDC', transactionHash)
          }
          
          // Refresh presigned URLs for purchased content
          console.log('🔄 Refreshing presigned URLs for purchased content...');
          try {
            const refreshResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content/${localContent.id}/refresh-urls`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              }
            });
            
            if (refreshResponse.ok) {
              const refreshData = await refreshResponse.json();
              if (refreshData.success && refreshData.data) {
                console.log('✅ Successfully refreshed presigned URLs');
                // Update the content with fresh URLs
                if (onContentUpdate) {
                  onContentUpdate(refreshData.data);
                }
              } else {
                console.warn('⚠️ Failed to refresh presigned URLs:', refreshData.error);
              }
            } else {
              console.warn('⚠️ Presigned URL refresh API call failed:', refreshResponse.status);
            }
          } catch (error) {
            console.warn('⚠️ Error refreshing presigned URLs:', error);
            // Don't fail the purchase if URL refresh fails
          }
        }
        
        // Set purchase success state
        setIsPurchased(true)
      } else {
        console.error('Transaction failed. Please try again.')
      }
    } catch (error) {
      console.error('Purchase failed:', error)
      console.error('Purchase failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsPurchased(false)
      setIsLoading(false)
      setSelectedVoiceTone("auto")
      setSelectedPayment("roast")
      // Twitter state reset handled by global context
    }
  }, [isOpen])

  const toneOptions = [
    "Select tone",
    "Professional",
    "Casual", 
    "Funny",
    "Technical",
    "Bullish",
    "Contrarian",
  ]

  if (!isOpen || !content) return null

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Content parsing functions (same as BiddingInterface and mining interface)
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

  const formatTwitterContent = (contentText: string) => {
    if (!contentText) return { text: '', hashtags: [], characterCount: 0, imageUrl: null }
    
    // Extract image URL and remove it from text
    const imageUrl = extractImageUrl(contentText)
    let cleanedText = contentText
    
    if (imageUrl) {
      cleanedText = cleanedText
        .replace(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i, '')
        .replace(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i, '')
        .replace(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i, '')
        .trim()
    }
    
    const hashtagRegex = /#[\w]+/g
    const hashtags = cleanedText.match(hashtagRegex) || []
    
    return {
      text: cleanedText,
      hashtags,
      characterCount: cleanedText.length,
      imageUrl
    }
  }

  const extractHashtags = (text: string): string[] => {
    const hashtagRegex = /#[\w]+/g
    return text.match(hashtagRegex) || []
  }

  // Comprehensive content parsing logic (same as BiddingInterface and mining interface)
  const getContentData = () => {
    if (!localContent) return { text: '', hashtags: [], characterCount: 0, imageUrl: null, shouldUseMarkdown: false }

    // Check if this is a longpost that should be rendered as markdown
    const shouldUseMarkdown = isMarkdownContent(localContent.post_type)
    
    // Check if content has markdown syntax
    const hasMarkdownSyntax = localContent.content_text?.includes('##') || localContent.content_text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    // For longposts, use raw content; for others, use parsed content
    const { text, imageUrl: extractedImageUrl } = (shouldUseMarkdown || forceMarkdown)
      ? { text: localContent.content_text, imageUrl: null }
      : formatTwitterContent(localContent.content_text)
    
    // Use watermarked image for preview, original for purchased content
    const imageUrl = isPurchased 
      ? (localContent.content_images && localContent.content_images.length > 0 ? localContent.content_images[0] : extractedImageUrl)
      : (localContent.watermark_image || (localContent.content_images && localContent.content_images.length > 0 ? localContent.content_images[0] : extractedImageUrl))
    
    const hashtags = extractHashtags(text)
    
    return {
      text: text || '',
      hashtags,
      characterCount: text?.length || 0,
      imageUrl,
      shouldUseMarkdown: Boolean(shouldUseMarkdown || forceMarkdown)
    }
  }

  // Format content text for display
  const formatContentText = (text: string, shouldUseMarkdown: boolean) => {
    if (shouldUseMarkdown) {
      return renderMarkdown(text)
    }
    return formatPlainText(text)
  }

  // Get parsed content data
  const contentData = getContentData()

  // Debug logging for content parsing (similar to mining interface)
  console.log('🔍 PurchaseModal: Post type:', localContent?.post_type)
  console.log('🔍 PurchaseModal: Should use markdown:', contentData.shouldUseMarkdown)
  console.log('🔍 PurchaseModal: Has markdown syntax:', localContent?.content_text?.includes('##') || localContent?.content_text?.includes('**'))
  console.log('🔍 PurchaseModal: Raw content length:', localContent?.content_text?.length)
  console.log('🔍 PurchaseModal: Parsed text length:', contentData.text?.length)
  console.log('🖼️ PurchaseModal: Image URL:', contentData.imageUrl)

  // Calculate USDC price
          const usdcPrice = roastPrice && localContent ? (getDisplayPrice(localContent) * roastPrice).toFixed(2) : '0.00'
  const usdcFee = '0.030' // Constant 0.03 USDC fee
  const totalUSDC = roastPrice && localContent ? (parseFloat(usdcPrice) + parseFloat(usdcFee)).toFixed(2) : '0.00'

  // Helper functions to get display data based on Twitter connection (for tweet preview only)
  const getDisplayUsername = () => {
    if (twitter.isConnected && twitter.profile?.displayName) {
      return twitter.profile.displayName
    }
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username || 'User'
  }

  const getDisplayUsernameLower = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.toLowerCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.toLowerCase() || 'user'
  }

  const getDisplayUsernameInitial = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username.charAt(0).toUpperCase()
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.charAt(0).toUpperCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.charAt(0).toUpperCase() || 'U'
  }

  return (
    <div
      className="fixed top-0 left-0 w-full h-full bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto touch-pan-y"
      onClick={handleBackdropClick}
      onContextMenu={preventRightClick}
      onKeyDown={preventKeyboardCopy}
      style={{ height: '100vh', minHeight: '100vh' }}
      tabIndex={0}
    >
      <div className="relative w-full max-w-none lg:max-w-6xl rounded-none lg:rounded-2xl bg-transparent lg:bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-y-hidden shadow-none lg:shadow-2xl p-0 lg:p-6 overscroll-contain touch-pan-y modal-scrollable">
        {/* Close Button */}
            <button
              onClick={onClose}
          className="absolute right-4 top-4 z-50 hover:opacity-80 transition-opacity text-white/60 hover:text-white"
          type="button"
            >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" />
          </svg>
            </button>

        <div className="flex flex-col lg:flex-row max-h-[90vh] gap-0 lg:gap-4 overflow-y-auto lg:overflow-hidden touch-pan-y">
          {/* Left Panel - Tweet Preview + Mobile Purchase Options Combined */}
          <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8 bg-[#121418] rounded-none lg:rounded-2xl min-h-screen lg:min-h-0">
            <h2 className="text-white/80 text-base lg:text-lg font-medium mb-4 lg:mb-6">Tweet preview</h2>

            {/* Twitter Thread Container */}
            <div className="w-full flex-1 overflow-y-auto pr-0 lg:pr-2 rounded-none lg:rounded-2xl touch-pan-y overscroll-contain modal-scrollable scrollbar-hide">
              

              <style jsx>{`
                div::-webkit-scrollbar {
                  width: 0px !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-track {
                  background: #121418 !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-thumb {
                  background-color: transparent !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-thumb:hover {
                  background-color: transparent !important;
                  display: none !important;
                }
                .scrollbar-hide {
                  -ms-overflow-style: none !important;
                  scrollbar-width: none !important;
                }
                .scrollbar-hide::-webkit-scrollbar {
                  width: 0px !important;
                  display: none !important;
                }
              `}</style>

              {/* Single Tweet Container with Thread Structure */}
              <div className="relative">
                {/* Continuous Thread Line - Only show for threads, not longposts */}
                {localContent?.tweet_thread && localContent.tweet_thread.length > 1 && !contentData.shouldUseMarkdown && (
                  <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-600 z-0"></div>
                )}

                {/* Main Tweet */}
                <div className="relative pb-3">
                  <div className="flex gap-3 pr-2">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                        {twitter.isConnected && twitter.profile?.profileImage ? (
                          <img 
                            src={twitter.profile.profileImage} 
                            alt={`${getDisplayName()} profile`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <span className={`text-white font-bold text-sm ${(twitter.isConnected && twitter.profile?.profileImage) ? 'hidden' : ''}`}>{getDisplayUsernameInitial()}</span>
              </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-bold text-xs lg:text-sm">{getDisplayUsername()}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                          <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.58 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                        </svg>
                        <span className="text-gray-500 text-xs lg:text-sm">@{getDisplayUsernameLower()}</span>
                  </div>

                      {/* For longposts: Image first, then content */}
                      {contentData.shouldUseMarkdown ? (
                        <>
                          {/* Longpost Image at top */}
                          {isGeneratingContent ? (
                            <ImageShimmer />
                          ) : (
                            contentData.imageUrl ? (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                                  unoptimized={isPresignedS3Url(contentData.imageUrl)}
                              />

                            </div>
                            ) : null
                          )}
                          
                          {/* Longpost Content with white text styling */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            {isGeneratingContent ? (
                              <TextShimmer />
                            ) : (
                            <div 
                              className="longpost-markdown-content"
                              style={{
                                color: 'white'
                              }}
                            >
                              {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                            </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Regular content (shitpost/thread): Content first, then image */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            {isGeneratingContent ? (
                              <TextShimmer />
                            ) : (
                              formatContentText(contentData.text, contentData.shouldUseMarkdown)
                            )}
                          </div>
                          
                          {/* Tweet Images for regular content */}
                          {isGeneratingContent ? (
                            <ImageShimmer />
                          ) : (
                            contentData.imageUrl ? (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                                  unoptimized={isPresignedS3Url(contentData.imageUrl)}
                              />

                            </div>
                            ) : null
                          )}
                        </>
                      )}


                    </div>
                  </div>
                </div>

                {/* Thread Replies - Only show for threads, not longposts */}
                {localContent?.tweet_thread && localContent.tweet_thread.length > 1 && !contentData.shouldUseMarkdown && localContent.tweet_thread.slice(1).map((tweet, index) => (
                  <div key={index} className="relative pb-3">
                    <div className="flex gap-3 pr-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                          {twitter.isConnected && twitter.profile?.profileImage ? (
                            <img 
                              src={twitter.profile.profileImage} 
                              alt={`${getDisplayName()} profile`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                target.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <span className={`text-white font-bold text-sm ${(twitter.isConnected && twitter.profile?.profileImage) ? 'hidden' : ''}`}>{getDisplayUsernameInitial()}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-xs lg:text-sm">{getDisplayUsername()}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                            <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.58 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                          </svg>
                          <span className="text-gray-500 text-xs lg:text-sm">@{getDisplayUsernameLower()}</span>
                        </div>
                        <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                          {isGeneratingContent ? (
                            <ThreadItemShimmer />
                          ) : (
                            tweet
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                </div>

              {/* Longpost Warning Message - Only show on mobile for longposts */}
              {contentData.shouldUseMarkdown && (
                <div className="lg:hidden mt-4 p-3 bg-orange-500/20 border border-orange-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span className="text-orange-400 text-sm font-medium">Longpost Content</span>
            </div>
                  <p className="text-orange-300 text-xs mt-1">
                    This is a longpost that will be posted as a single tweet. Make sure your X account supports long tweets.
                  </p>
          </div>
              )}

              {/* Mobile Purchase Options - Now inside the same scrollable container */}
              <div className="lg:hidden mt-6 p-4 bg-[#12141866] rounded-2xl border border-white/20 mb-32">
                  {/* Voice Tone Selection - Mobile/Tablet */}
                  <div className="mb-6">
                    <h3 className="text-white text-[12px] xs:text-[10px] sm:text-[12px] md:text-[16px] font-semibold mb-2 xs:mb-3 md:mb-4">Select tweet voice tone</h3>
                    <p className="text-white/60 text-[10px] xs:text-[8px] sm:text-[10px] md:text-[12px] mb-3 xs:mb-4 md:mb-4">Tweet content and tone will be updated as per your preferences</p>
                    
                    <div className="grid grid-cols-3 bg-[#220808B2] rounded-full p-1 gap-1">
                      <button
                        onClick={() => setSelectedVoiceTone("auto")}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "auto"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Automated
                      </button>
                      <button
                        onClick={() => setSelectedVoiceTone("custom")}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "custom"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Choose Yapper
                      </button>
                      <button
                        onClick={() => setSelectedVoiceTone("mystyle")}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "mystyle"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        My Voice
                      </button>
                    </div>

                    {/* Voice Tone Specific Content */}
                    {selectedVoiceTone === "auto" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 p-2.5 xs:p-3 md:p-3 bg-[#220808]/50 rounded-lg border border-white/10">
                        <div className="flex items-center justify-between">
                          <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                          <span className="text-green-400 font-semibold text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">FREE</span>
                        </div>
                      </div>
                    )}

                    {selectedVoiceTone === "custom" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 space-y-2.5 xs:space-y-3 md:space-y-3">
                        {/* Search input */}
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search yappers..."
                            value={yapperSearchQuery}
                            onChange={(e) => setYapperSearchQuery(e.target.value)}
                            className="w-full bg-[#220808] border border-[#4A3636] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5 text-white text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] placeholder-white/50 focus:outline-none focus:border-[#FD7A10] focus:ring-1 focus:ring-[#FD7A10]/20"
                          />
                          <svg
                            className="absolute right-2.5 xs:right-3 md:right-3 top-1/2 transform -translate-y-1/2 w-3.5 xs:w-4 md:w-4 h-3.5 xs:h-4 md:h-4 text-white/50"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        
                        {isLoadingYappers ? (
                          <div className="flex items-center justify-center py-2.5 xs:py-3 md:py-3">
                            <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Loading yappers...</div>
                          </div>
                        ) : filteredYappers.length > 0 ? (
                          <div className="space-y-1.5 xs:space-y-2 md:space-y-2 max-h-28 xs:max-h-32 md:max-h-32 overflow-y-auto">
                            {filteredYappers.map((yapper) => (
                              <button
                                key={yapper.id}
                                type="button"
                                onClick={() => setSelectedYapper(yapper.twitter_handle)}
                                className={`w-full text-left p-2 xs:p-2.5 md:p-2.5 rounded-lg border transition-all duration-200 ${
                                  selectedYapper === yapper.twitter_handle
                                    ? 'bg-[#FD7A10] border-[#FD7A10] text-black shadow-lg'
                                    : 'bg-[#220808] border-[#4A3636] text-white hover:bg-[#2a1212] hover:border-[#FD7A10]/30'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                  <div className="w-4 xs:w-5 md:w-5 h-4 xs:h-5 md:h-5 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                                    @
                                  </div>
                                  <div>
                                    <div className="font-medium font-nt-brick text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">@{yapper.twitter_handle}</div>
                                    <div className={`text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] ${selectedYapper === yapper.twitter_handle ? 'text-black/60' : 'text-white/50'}`}>
                                      {yapper.display_name}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center py-2.5 xs:py-3 md:py-3">
                            <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] text-center">
                              {yapperSearchQuery ? 'No yappers found matching your search' : 'No yappers available'}
                            </div>
                          </div>
                        )}

                        {/* Fee message */}
                        <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                          <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                          <div className="text-right text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                            <span className="line-through">500 ROAST</span>
                            <span className="text-green-400 ml-2 font-semibold">FREE</span>
                          </div>
                        </div>
                        
                        {/* Generate Content Button - Removed since main action button now handles this */}
                        
                        {/* Generation Status */}
                        {isGeneratingContent && (
                          <div className="p-3 bg-[#220808]/80 rounded-lg border border-[#FD7A10]/30">
                            <div className="text-[#FD7A10] text-[10px] xs:text-[12px] md:text-[14px] font-medium mb-2">
                              {generationStatus}
                            </div>
                            {/* Progress Bar */}
                            <div className="w-full bg-[#4A3636] rounded-full h-2 mb-2">
                              <div 
                                className="bg-[#FD7A10] h-2 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${generationProgress}%` }}
                              ></div>
                            </div>
                            <div className="text-white/60 text-[10px] xs:text-[12px] md:text-[14px] text-center">
                              {generationProgress}% Complete
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-[#FD7A10] h-2 rounded-full transition-all duration-300"
                                style={{ width: `${generationProgress}%` }}
                              ></div>
                            </div>
                            <div className="text-white/60 text-[8px] xs:text-[10px] md:text-[12px] mt-1">
                              {generationProgress}% Complete
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedVoiceTone === "mystyle" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 space-y-2.5 xs:space-y-3 md:space-y-3">
                        {!twitter.isConnected ? (
                          <div className="text-center p-3 xs:p-4 md:p-4 bg-[#220808]/50 rounded-lg border border-white/10">
                            <h4 className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-semibold mb-1.5 xs:mb-2 md:mb-2">
                              {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                ? 'Twitter reconnection required' 
                                : 'Twitter access required'}
                            </h4>
                            <p className="text-white/60 text-[6px] xs:text-[12px] md:text-[16px] mb-2 xs:mb-3 md:mb-3">
                              {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                ? 'Your Twitter access has been disconnected. Please reconnect to continue using your voice tone.'
                                : 'By getting access to your previous tweets, our AI model can generate content in your voice of tone'}
                            </p>
                            <button
                              onClick={handleTwitterAuthVoice}
                              className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-lg py-2 xs:py-2.5 md:py-2.5 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors text-[6px] xs:text-[12px] md:text-[16px]"
                              disabled={twitter.isLoading}
                            >
                              {twitter.isLoading ? 'Connecting...' : (
                                twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Reconnect Twitter' 
                                  : 'Grant twitter access'
                              )}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5 xs:space-y-3 md:space-y-3">
                            {/* Connected bar */}
                            <div className="flex items-center justify-between bg-[#220808] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5">
                              <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">Twitter profile</span>
                              <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">@{twitter.profile?.username || 'profile'}</span>
                                <button
                                  type="button"
                                  onClick={() => disconnect()}
                                  className="text-white/60 hover:text-white/90 text-[6px] xs:text-[12px] md:text-[16px] underline"
                                  disabled={twitter.isLoading}
                                >
                                  {twitter.isLoading ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                              </div>
                            </div>

                            {/* Fee row + Generate button */}
                            <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                              <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                              <div className="text-right text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                                <span className="line-through">500 ROAST</span>
                                <span className="text-green-400 ml-2 font-semibold">FREE</span>
                              </div>
                            </div>
                            
                            <button 
                              onClick={handleGenerate}
                              className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-lg py-2 xs:py-2.5 md:py-2.5 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors text-[6px] xs:text-[12px] md:text-[16px] font-medium"
                            >
                              <svg className="w-3.5 xs:w-4 md:w-4 h-3.5 xs:h-4 md:h-4 mr-1.5 xs:mr-2 md:mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              Generate
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Payment Options - Mobile/Tablet */}
                  <div className="mb-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        onClick={() => setSelectedPayment("roast")}
                        className={`p-3 rounded-lg cursor-pointer transition-colors bg-[#12141866] border-2 ${
                          selectedPayment === "roast" ? 'border-[#FD7A10]' : 'border-transparent'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-semibold text-[6px] xs:text-[12px] md:text-[16px]">$ROAST</span>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedPayment === "roast" ? "border-[#FD7A10] bg-[#FD7A10]" : "border-[#FD7A10]"
                          }`}>
                            {selectedPayment === "roast" && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                        </div>
                        <div className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-bold">{Math.round(getDisplayPrice(localContent))}</div>
                        <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Platform Token</div>
                      </div>

                      <div
                        onClick={() => setSelectedPayment("usdc")}
                        className={`p-3 rounded-lg cursor-pointer transition-colors bg-[#12141866] border-2 ${
                          selectedPayment === "usdc" ? 'border-[#FD7A10]' : 'border-transparent'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-semibold text-[6px] xs:text-[12px] md:text-[16px]">USDC</span>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedPayment === "usdc" ? "border-[#FD7A10] bg-[#FD7A10]" : "border-[#FD7A10]"
                          }`}>
                            {selectedPayment === "usdc" && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                        </div>
                        <div className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-bold">${totalUSDC}</div>
                        <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Including 0.03 USDC fee</div>
                      </div>
                    </div>

                    {/* Motivational message for USDC users */}
                    {selectedPayment === "usdc" && (
                      <div className="mt-3 bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12z" clipRule="evenodd" />
                          </svg>
                          <span className="text-orange-400 font-semibold text-[6px] xs:text-[12px] md:text-[16px]">💡 Save Money with ROAST</span>
                        </div>
                        <p className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px] leading-relaxed">
                          Pay with <span className="text-orange-400 font-semibold">ROAST tokens</span> and save <span className="text-green-400 font-semibold">0.03 USDC</span> in fees! 
                          ROAST holders also get <span className="text-orange-400 font-semibold">exclusive access</span> to premium content and <span className="text-orange-400 font-semibold">early features</span>.
                        </p>
                      </div>
                    )}
                  </div>
                  


                  {/* Action Button - Changes based on selected voice tone */}
                  {selectedVoiceTone === "custom" && selectedYapper ? (
                    <button

                      onClick={generateContentFromYapper}
                      disabled={isGeneratingContent || !address}
                      className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingContent ? 'Generating...' : `Generate Content from @${selectedYapper}`}
                    </button>
                  ) : (
                    <button

                      onClick={handlePurchase}
                      disabled={isLoading}
                      className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? 'Processing...' : 'Buy Tweet'}
                    </button>
                  )}
                </div>
            </div>
          </div>

          {/* Right Panel - Hidden on mobile, shown on desktop */}
          <div className="hidden lg:flex w-full lg:w-1/2 px-4 pt-4 lg:px-8 lg:pt-8 flex-col gap-4 overflow-y-auto justify-between">
            {!isPurchased ? (
              <>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4">
                    {/* Content Miner Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FFCC00] rounded-full flex items-center justify-center overflow-hidden">
                        <span className="text-black font-bold text-lg">
                          {getDisplayUsernameInitial()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">
                            {getDisplayUsername()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <div className="flex items-center gap-2">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFCC00">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            {/* <span className="text-white">{localContent?.creator?.reputation_score} reputation</span>
                            <span className="text-white">•</span> */}
                            <span className="text-white">{new Date(localContent?.created_at || '').toLocaleDateString()}</span>
                          </div>
                          {/* {localContent?.agent_name && (
                            <div className="flex items-start justify-start gap-1">
                              <span className="px-2 py-1 bg-blue-100 text-blue-400 text-xs rounded-2xl font-semibold">🤖 {localContent.agent_name}</span>
                            </div>
                          )} */}
            </div>
          </div>
                    </div>




                  </div>

                  {/* Voice Tone Selection */}
                  <div className="flex flex-col">
                    <div className="bg-[#12141866] rounded-t-md p-4 flex flex-col border-b border-white/40">
                      <h3 className="text-white text-md font-semibold">Select tweet voice tone</h3>
                      <p className="text-white/60 text-sm">Tweet content and tone will be updated as per your preferences</p>
                    </div>
                    <div className="flex flex-col gap-6 rounded-b-md p-4 bg-[#12141866]">
                      
                      <div className="grid grid-cols-3 bg-[#220808B2] rounded-full p-1">
                        <button
                          onClick={() => setSelectedVoiceTone("auto")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "auto"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          Auto generated
                        </button>
                        <button
                          onClick={() => setSelectedVoiceTone("custom")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "custom"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          Choose Yapper
                          {selectedVoiceTone === "custom" && selectedYapper && (
                            <span className="ml-1 text-xs">✨</span>
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedVoiceTone("mystyle")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "mystyle"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          My Voice
                        </button>
                      </div>

                      {selectedVoiceTone === "auto" && (
                        <div className="flex flex-row items-center justify-between gap-1 mt-3">
                          <div className="text-white/60 text-sm">Extra fee per tweet</div>
                          <div className="text-right text-white/60 text-xs">
                            <span className="text-green-400 font-semibold">FREE</span>
                          </div>
                        </div>
                      )}

                      {selectedVoiceTone === "custom" && (
                        <div className="space-y-3">
                          {/* Search input */}
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search yappers..."
                              value={yapperSearchQuery}
                              onChange={(e) => setYapperSearchQuery(e.target.value)}
                              className="w-full bg-[#220808] border border-[#4A3636] rounded-md px-3 py-2 text-white text-xs placeholder-white/50 focus:outline-none focus:border-[#FD7A10]"
                            />
                            <svg
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-white/50"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </div>
                          
                          {isLoadingYappers ? (
                            <div className="flex items-center justify-center py-4">
                              <div className="text-white/60 text-xs">Loading yappers...</div>
                            </div>
                          ) : filteredYappers.length > 0 ? (
                            <div className="space-y-1 max-h-44 overflow-y-auto">
                              {filteredYappers.map((yapper) => (
                                <button
                                  key={yapper.id}
                                  type="button"
                                  onClick={() => setSelectedYapper(yapper.twitter_handle)}
                                  className={`w-full text-left p-2 rounded border transition-colors ${
                                    selectedYapper === yapper.twitter_handle
                                      ? 'bg-[#FD7A10] border-[#FD7A10] text-black'
                                      : 'bg-[#220808] border-[#4A3636] text-white hover:bg-[#2a1212]'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                                      @
                                    </div>
                                    <div>
                                      <div className="font-medium font-nt-brick text-xs">@{yapper.twitter_handle}</div>
                                      <div className={`text-xs ${selectedYapper === yapper.twitter_handle ? 'text-black/60' : 'text-white/50'}`}>
                                        {yapper.display_name}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center justify-center py-4">
                              <div className="text-white/60 text-xs text-center">
                                {yapperSearchQuery ? 'No yappers found matching your search' : 'No yappers available'}
                              </div>
                            </div>
                          )}

                          {/* Fee per tweet message */}
                          <div className="flex flex-row items-center justify-between gap-1 mt-2">
                            <div className="text-white/60 text-[8px] xs:text-[8px] md:text-[12px]">Extra fee per tweet</div>
                            <div className="text-right text-white/60 text-[8px] xs:text-[8px] md:text-[12px]">
                              <span className="line-through">500 ROAST</span>
                              <span className="text-green-400 ml-2 font-semibold">FREE</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedVoiceTone === "mystyle" && (
                        <>
                          {/* Removed duplicate fee message - now only shows after Twitter connection */}

                          {!twitter.isConnected ? (
                            <div className="flex flex-col items-center justify-center text-center">
                              <h3 className="text-white text-lg font-semibold mb-3">
                                {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Twitter reconnection required' 
                                  : 'Twitter access required'}
                              </h3>
                              <p className="text-white/60 text-sm mb-6 px-4">
                                {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Your Twitter access has been disconnected. Please reconnect to continue using your voice tone.'
                                  : 'By getting access to your previous tweets, our AI model can generate content in your voice of tone'}
                              </p>
                              <button
                                onClick={handleTwitterAuthVoice}
                                className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-sm py-3 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors"
                                disabled={twitter.isLoading}
                              >
                                {twitter.isLoading ? 'Connecting...' : (
                                  twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                    ? 'Reconnect Twitter' 
                                    : 'Grant twitter access'
                                )}
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-4">
                              {/* Connected bar */}
                              <div className="flex items-center justify-between bg-[#220808] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5">
                                <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">Twitter profile</span>
                                <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                  <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">@{twitter.profile?.username || 'profile'}</span>
                                  <button
                                    type="button"
                                    onClick={() => disconnect()}
                                    className="text-white/60 hover:text-white/90 text-[6px] xs:text-[12px] md:text-[16px] underline"
                                    disabled={twitter.isLoading}
                                  >
                                    {twitter.isLoading ? 'Disconnecting...' : 'Disconnect'}
                                  </button>
                                </div>
                              </div>

                              {/* Fee row + Generate button */}
                              <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                                <span className="text-white/60 text-[8px] xs:text-[12px] md:text-[16px]">Extra fee per tweet</span>
                                <div className="text-right text-white/60 text-[6px] xs:text-[12px] md:text-[16px]">
                                  <span className="line-through">500 ROAST</span>
                                  <span className="text-green-400 ml-2 font-semibold">FREE</span>
                                </div>
                              </div>
                              
                                <button 
                                  onClick={handleGenerate}
                                className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-lg py-2 xs:py-2.5 md:py-2.5 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors text-[6px] xs:text-[12px] md:text-[16px] font-medium"
                                >
                                <svg className="w-3.5 xs:w-4 md:w-4 h-3.5 xs:h-4 md:h-4 mr-1.5 xs:mr-2 md:mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  Generate
                                </button>
                      </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Longpost Premium X Account Warning */}
                {localContent?.post_type === 'longpost' && (
                  <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <span className="text-blue-400 font-semibold text-sm">ℹ️ Premium X Account Required</span>
                    </div>
                    <p className="text-white/80 text-xs leading-relaxed">
                      This is a <span className="text-blue-400 font-semibold">longpost content</span>. You must have a <span className="text-blue-400 font-semibold">premium X (Twitter) account</span> that allows posting longer content to use this tweet effectively.
                    </p>
                  </div>
                )}

                {/* Payment Options */}
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div
                      onClick={() => setSelectedPayment("roast")}
                      className={'p-4 rounded-md cursor-pointer transition-colors bg-[#12141866] '}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-semibold">$ROAST</span>
                        <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${selectedPayment === "roast"
                          ? "border-orange-500"
                          : "border-orange-500"
                          }`}>
                          {selectedPayment === "roast" && (
                            <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                          )}
                        </div>
                      </div>
                      <div className="text-white text-xl font-bold">{Math.round(getDisplayPrice(localContent))}</div>
                      <div className="text-white/60 text-xs">Platform Token</div>
                    </div>

                    <div
                      onClick={() => setSelectedPayment("usdc")}
                      className={'p-4 rounded-md cursor-pointer transition-colors bg-[#12141866]'}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-semibold">USDC</span>
                        <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${selectedPayment === "usdc"
                          ? "border-orange-500"
                          : "border-orange-500"
                          }`}>
                          {selectedPayment === "usdc" && (
                            <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                          )}
                        </div>
                      </div>
                      <div className="text-white text-xl font-bold">${totalUSDC}</div>
                      <div className="text-white/60 text-xs">Including 0.03 USDC fee</div>
                    </div>
                  </div>

                  {/* Motivational message for USDC users */}
                  {selectedPayment === "usdc" && (
                    <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12z" clipRule="evenodd" />
                        </svg>
                        <span className="text-orange-400 font-semibold text-sm">💡 Save Money with ROAST</span>
                      </div>
                      <p className="text-white/80 text-xs leading-relaxed">
                        Pay with <span className="text-orange-400 font-semibold">ROAST tokens</span> and save <span className="text-green-400 font-semibold">0.03 USDC</span> in fees! 
                        ROAST holders also get <span className="text-orange-400 font-semibold">exclusive access</span> to premium content and <span className="text-orange-400 font-semibold">early features</span>.
                      </p>
                </div>
              )}
              


              <button

                onClick={selectedVoiceTone === "custom" && selectedYapper !== "" ? generateContentFromYapper : handlePurchase}
                disabled={isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent)}
                className={`w-full font-semibold py-4 rounded-sm text-lg transition-all duration-200 ${
                  isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent)
                    ? 'bg-gray-500 cursor-not-allowed' 
                    : !address
                    ? 'bg-[#FD7A10] hover:bg-[#e86d0f] glow-orange-button'
                    : !isAuthenticated
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : !hasAccess
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-[#FD7A10] glow-orange-button hover:bg-[#e86d0f]'
                } text-white`}
              >
                {isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent) ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>{isGeneratingContent ? 'Generating...' : 'Processing...'}</span>
                  </div>
                ) : !address ? (
                  'Connect Wallet'
                ) : !isAuthenticated ? (
                  'Sign Message to Authenticate'
                ) : !hasAccess ? (
                  'Get Marketplace Access'
                ) : selectedVoiceTone === "custom" && selectedYapper !== "" ? (
                  `Generate Content from @${selectedYapper}`
                ) : (
                  'Buy Tweet'
                )}
              </button>
                </div>
                  </>
                ) : showTweetManagement ? (
              /* Tweet Management State */
              <div className="flex flex-col gap-4 h-full">
                {/* Header with back button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowTweetManagement(false)}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                  </button>
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-white font-bold">Content Owned</div>
                    <div className="text-white text-xs">
                      Purchased • {Math.round(getDisplayPrice(localContent))} ROAST
                    </div>
                  </div>
                </div>

                {/* Posting Method Selection */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="relative">
                    <input
                      type="radio"
                      id="post-twitter"
                      name="posting-method"
                      value="twitter"
                      checked={postingMethod === 'twitter'}
                      onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                      className="sr-only"
                    />
                    <label htmlFor="post-twitter" className="flex items-center gap-2 cursor-pointer">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        postingMethod === 'twitter' 
                          ? 'border-[#FD7A10] bg-[#FD7A10]' 
                          : 'border-white/40'
                      }`}>
                        {postingMethod === 'twitter' && (
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        )}
                      </div>
                      <span className="text-white text-sm font-medium">Post on X</span>
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type="radio"
                      id="post-manual"
                      name="posting-method"
                      value="manual"
                      checked={postingMethod === 'manual'}
                      onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                      className="sr-only"
                    />
                    <label htmlFor="post-manual" className="flex items-center gap-2 cursor-pointer">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        postingMethod === 'manual' 
                          ? 'border-[#FD7A10] bg-[#FD7A10]' 
                          : 'border-white/40'
                      }`}>
                        {postingMethod === 'manual' && (
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        )}
                      </div>
                      <span className="text-white text-sm font-medium">I will do it manually</span>
                    </label>
                  </div>
                </div>

                {postingMethod === 'manual' && (
                  /* How to thread info for manual posting */
                  <div className="bg-[#331C1E] rounded-md px-4 py-2 flex items-start gap-3">
                    <div className="flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="#FD7A10">
                        <path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7z" />
                      </svg>
                    </div>
                    <div className="text-white/80 text-sm">
                      <div className="font-medium mb-1">How to thread: After posting the first tweet, click the + button on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.</div>
                    </div>
                  </div>
                )}

                {/* Content Area - Twitter Posting or Manual */}
                <div className="flex-1 overflow-y-auto space-y-4">
                  {twitterPostingResult?.success ? (
                    /* Tweet Success State - Same position as Purchase Success */
                    <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-white text-xl font-bold mb-2">{twitterPostingResult.message}</h3>
                        {twitterPostingResult.tweetUrl && (
                          <a 
                            href={twitterPostingResult.tweetUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-green-300 hover:text-green-200 underline"
                          >
                            View Tweet on X
                          </a>
                        )}
                      </div>
                    </div>
                  ) : postingMethod === 'twitter' ? (
                    /* Twitter Posting Interface */
                    <div className="flex flex-col h-full">
                      {(() => {
                        // Debug logging
                        console.log('🔍 Twitter Status Debug:', {
                          isConnected: twitter.isConnected,
                          tokenStatus: twitter.tokenStatus,
                          hasPreviousConnection: twitter.hasPreviousConnection,
                          postingStatus: twitterPostingStatus
                        });
                        return null;
                      })()}
                      {twitter.isConnected && twitter.tokenStatus === 'valid' ? (
                        /* Ready to Post - Show green messages */
                        <div className="flex-1 flex flex-col justify-end">
                          <div className="space-y-3 mb-6 px-4">
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We don't store or share any personal details from twitter</span>
                            </div>
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We never post on our behalf. Write access is just for post draft creation</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Twitter Access Required or Expired */
                        <div className="flex-1 flex flex-col justify-center">
                          {/* Combined X logo and message unit */}
                          <div className="bg-[#331C1E] rounded-xl p-6 mx-4 mb-8">
                            <div className="flex justify-center mb-4">
                              <div className="w-20 h-20 bg-[#331C1E] rounded-2xl flex items-center justify-center">
                                <img src="/twitter-logo-white.png" alt="X" className="w-12 h-12" />
                              </div>
                            </div>
                            <h3 className="text-white text-xl font-semibold mb-3 text-center">Twitter access required</h3>
                            <p className="text-white/80 text-sm text-center">
                              To create draft on your twitter account we require write access
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {/* Fixed Bottom Section */}
                      <div className="pt-4">
                        {/* Green checkmark messages - Only when auth is required and tweet not posted */}
                        {(!twitter.isConnected || twitter.tokenStatus !== 'valid') && !twitterPostingResult?.success && (
                          <div className="space-y-2 mb-4 px-4">
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We don't store or share any personal details from twitter</span>
                            </div>
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We never post on our behalf. Write access is just for post draft creation</span>
                            </div>
                          </div>
                        )}

                        {/* Error Messages */}
                        {twitterPostingResult && !twitterPostingResult.success && (
                          <div className="mb-3 px-4 py-2 rounded text-sm text-red-400 bg-red-400/10">
                            ❌ {twitterPostingResult.message}
                          </div>
                        )}

                        {/* Tweet Button - Hide after successful posting */}
                        {!twitterPostingResult?.success && (
                          <button
                            onClick={handlePostToTwitter}
                            disabled={isPostingToTwitter}
                            className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ display: (twitter.isConnected && twitter.tokenStatus === 'valid') ? 'block' : 'none' }}
                          >
                            {isPostingToTwitter ? (
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Posting...</span>
                              </div>
                            ) : (
                              'Tweet'
                            )}
                          </button>
                        )}
                        
                        {/* Auth Button - Shows when auth is required */}
                        <button
                          onClick={handleTwitterAuth}
                          disabled={twitter.isLoading}
                          className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors"
                          style={{ display: (!twitter.isConnected || twitter.tokenStatus !== 'valid') ? 'block' : 'none' }}
                        >
                          {twitter.isLoading ? 'Connecting...' : 'Grant access on X'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Manual Posting Interface - Original tweets list */
                    (() => {
                      // Parse content for display - handle markdown properly
                      if (!localContent) {
                        return null;
                      }
                      
                      // Check if this is markdown content (longpost)
                      const shouldUseMarkdown = isMarkdownContent(localContent.post_type)
                      const hasMarkdownSyntax = localContent.content_text?.includes('##') || localContent.content_text?.includes('**')
                      const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
                      
                      let tweetText: string
                      let extractedImageUrl: string | null = null
                      
                      if (forceMarkdown) {
                        // For longpost content, convert markdown to plain text for copying/posting
                        tweetText = markdownToPlainText(localContent.content_text)
                      } else {
                        // For regular content, use existing formatting
                        const formatted = formatTwitterContentForManagement(localContent.content_text)
                        tweetText = formatted.text
                        extractedImageUrl = formatted.imageUrl
                      }
                      
                      // Use original image for purchased content (post-purchase), watermarked for preview
                      const displayImage = isPurchased 
                        ? (localContent?.content_images && localContent.content_images.length > 0 ? localContent.content_images[0] : extractedImageUrl)
                        : (localContent?.watermark_image || (localContent?.content_images && localContent.content_images.length > 0 ? localContent.content_images[0] : extractedImageUrl));

                      // Prepare tweets for copy - also process thread items if they contain markdown
                      const processedThreadItems = localContent?.tweet_thread ? localContent.tweet_thread.map(tweet => {
                        // Check if thread item contains markdown
                        if (tweet.includes('##') || tweet.includes('**')) {
                          return markdownToPlainText(tweet)
                        }
                        return tweet
                      }) : []

                      const tweetsData = [
                          { 
                              title: 'Tweet 1', 
                              text: tweetText || 'Sample tweet content will appear here...' 
                          },
                          ...(displayImage ? [{ 
                              title: 'Tweet 1 (Image)', 
                              image: displayImage 
                          }] : []),
                          ...(processedThreadItems.map((tweet, idx) => ({ 
                              title: `Tweet ${idx + 2}`, 
                              text: tweet 
                          })))
                      ];

                      return tweetsData.map((section, idx) => (
                        <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-white/90 text-sm">{section.title}</div>
                            <button
                              type="button" 
                              onClick={() => {
                                if (section.text) {
                                  navigator.clipboard?.writeText(section.text);
                                } else if (section.image) {
                                  downloadImage(String(section.image), `tweet-image-${idx + 1}.png`);
                                }
                              }}
                              className="text-[#FD7A10] border border-[#FD7A10] rounded-sm px-2 py-1 text-xs flex flex-row gap-1 items-center cursor-pointer hover:bg-[#FD7A10] hover:text-white transition-colors"
                            >
                              {section.image ? (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7,10 12,15 17,10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  <span className="text-xs">Download</span>
                                </>
                              ) : (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                                  </svg>
                                  <span className="text-xs">Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                          {section.text && (
                            <div className="text-white/80 text-sm leading-relaxed">
                              {forceMarkdown ? (
                                <div 
                                  className="markdown-content max-w-none"
                                  dangerouslySetInnerHTML={{ 
                                    __html: markdownToHTML(section.text)
                                  }}
                                />
                              ) : (
                                section.text
                              )}
                            </div>
                          )}
                          {section.image && (
                            <div className="mt-3 rounded-md overflow-hidden">
                              <img src={String(section.image)} alt="Tweet image" className="w-[50%] h-auto object-cover" />
                            </div>
                          )}
                        </div>
                      ));
                    })()
                  )}
                </div>
              </div>
            ) : (
              /* Purchase Success State */
              <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-white text-xl font-bold mb-2">Purchase Successful!</h3>
                  <p className="text-white/60">Your content is now ready to tweet</p>
                </div>
                <button 
                  onClick={() => setShowTweetManagement(true)}
                  className="w-full bg-[#FD7A10] glow-orange-button text-white font-semibold py-4 rounded-sm text-lg"
                >
                  Tweet Now
              </button>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Copy Protection Modal */}
      {showCopyProtection && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-75">
          <div className="bg-white rounded-lg p-8 max-w-md mx-4 text-center">
            <div className="h-16 w-16 text-red-500 mx-auto mb-4">
              <svg className="w-full h-full" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
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
      )}

      {/* Wallet Connection Modal */}
      <WalletConnectionModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        title="Connect Your Wallet"
        message="Please connect your wallet to purchase content from the marketplace"
      />
    </div>
  )
} 
