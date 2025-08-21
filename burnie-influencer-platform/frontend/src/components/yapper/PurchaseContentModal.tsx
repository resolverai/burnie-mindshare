'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Image from 'next/image'
import { generateRandomMindshare, formatMindshare } from '../../utils/mindshareUtils'

import { useROASTPrice, formatUSDCPrice } from '../../utils/priceUtils'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance, ensureROASTTokenDisplay } from '../../utils/walletUtils'
import { executeROASTPayment, prepareROASTDisplay } from '../../services/roastPaymentService'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'
import WalletConnectionModal from '../WalletConnectionModal'
import { useTwitter } from '../../contexts/TwitterContext'
import { useMarketplaceAccess } from '../../hooks/useMarketplaceAccess'
import { useAuth } from '../../hooks/useAuth'
import { useTwitterPosting } from '../../hooks/useTwitterPosting'

interface ContentItem {
  id: number
  creatorId: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
  watermark_image?: string
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
  post_type?: string
}

interface PurchaseContentModalProps {
  content: ContentItem | null
  isOpen: boolean
  onClose: () => void
  onPurchase?: (contentId: number, price: number, currency: 'ROAST' | 'USDC', transactionHash?: string) => void
}

export default function PurchaseContentModal({
  content,
  isOpen,
  onClose,
  onPurchase
}: PurchaseContentModalProps) {
  
  const { address } = useAccount()
  const { price: roastPrice } = useROASTPrice()
  const { twitter, connect, disconnect, refreshToken, isTwitterReady } = useTwitter()
  const { hasAccess, redirectToAccess } = useMarketplaceAccess()
  const { isAuthenticated } = useAuth()
  const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting()
  
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
  const [minerInfo, setMinerInfo] = useState<{
    username: string;
    twitterUsername?: string;
    twitterDisplayName?: string;
    profileImageUrl?: string;
  } | null>(null)
  const [isLoadingMiner, setIsLoadingMiner] = useState(false)
  const [showTweetManagement, setShowTweetManagement] = useState(false)
  const [postingMethod, setPostingMethod] = useState<'twitter' | 'manual'>('twitter')
  const [isPostingToTwitter, setIsPostingToTwitter] = useState(false)
  const [twitterPostingResult, setTwitterPostingResult] = useState<{
    success: boolean;
    message: string;
    tweetUrl?: string;
  } | null>(null)

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

  // Fetch miner information
  const fetchMinerInfo = async () => {
    if (!content?.creatorId) return

    setIsLoadingMiner(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/user/${content.creatorId}/profile`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setMinerInfo({
            username: data.user.username,
            twitterUsername: data.twitterConnection?.twitterUsername,
            twitterDisplayName: data.twitterConnection?.twitterDisplayName,
            profileImageUrl: data.twitterConnection?.profileImageUrl
          })
        }
      } else {
        console.error('Failed to fetch miner info')
      }
    } catch (error) {
      console.error('Error fetching miner info:', error)
    } finally {
      setIsLoadingMiner(false)
    }
  }

  // Fetch miner info when modal opens
  useEffect(() => {
    if (content?.creatorId) {
      fetchMinerInfo()
    }
  }, [content?.creatorId])

  // Filter yappers based on search query
  const filteredYappers = allYappers.filter((yapper) => {
    const searchLower = yapperSearchQuery.toLowerCase()
    return (
      yapper.twitter_handle.toLowerCase().includes(searchLower) ||
      yapper.display_name.toLowerCase().includes(searchLower)
    )
  })

  // Helper functions to get display data based on Twitter connection (for tweet preview only)
  const getDisplayName = () => {
    return twitter.profile?.displayName || twitter.profile?.username || content?.creator.username || 'User'
  }

  const getTwitterHandle = () => {
    return twitter.profile?.username || content?.creator.username.toLowerCase() || 'user'
  }

  const getInitialLetter = () => {
    const name = twitter.profile?.username || content?.creator.username || 'U'
    return name.charAt(0).toUpperCase()
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
    if (!content) return

    setIsPostingToTwitter(true)
    try {
      const { text: tweetText, imageUrl: extractedImageUrl } = formatTwitterContentForManagement(content.content_text)
      // Use original image for posting (after purchase), not watermarked
      const displayImage = content.content_images && content.content_images.length > 0 
          ? content.content_images[0] 
          : extractedImageUrl

      // Prepare tweet data
      const tweetData = {
        mainTweet: tweetText,
        thread: content.tweet_thread || [],
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

  // Generate consistent random mindshare for this content item
  const getRandomMindshare = (itemId: string) => {
    const seed = itemId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    const random = (Math.sin(seed) * 10000) % 1
    const min = 85.0
    const max = 100.0
    const value = Math.abs(random) * (max - min) + min
    return Math.round(value * 10) / 10
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
      return
    }

    // Show wallet connection modal if not connected
    if (!address) {
      setShowWalletModal(true)
      return
    }

    // Check marketplace access for authenticated features (authenticated users only)
    if (isAuthenticated && !hasAccess) {
      redirectToAccess()
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

      // Check balance via backend (no wallet confirmation needed)
      let requiredAmount: number;
      let tokenType: string;
      
      if (selectedPayment === 'roast') {
        requiredAmount = content.asking_price;
        tokenType = 'roast';
      } else {
        const usdcPrice = roastPrice ? (content.asking_price * roastPrice) : 0;
        requiredAmount = usdcPrice + 0.03; // Add 0.03 USDC fee
        tokenType = 'usdc';
      }

      console.log(`🔍 Checking ${tokenType.toUpperCase()} balance via backend...`);
      
      // Backend balance check
      const balanceResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/check-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address,
          tokenType: tokenType,
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

      // Prepare ROAST token display using working implementation pattern
      if (selectedPayment === 'roast') {
        console.log('🏷️ Preparing ROAST token for optimal wallet display...');
        
        try {
          // Use the working implementation approach
          await prepareROASTDisplay();
          console.log('✅ ROAST token prepared for wallet display');
        } catch (error) {
          console.log('⚠️ Token preparation failed - proceeding anyway:', error);
        }
      }

      // Execute transaction using working implementation pattern
      let result: any;
      if (selectedPayment === 'roast') {
        console.log(`🔄 Executing ROAST payment: ${content.asking_price} ROAST to ${treasuryAddress}`)
        
        try {
          // Use the working implementation service for better wallet display
          const transactionHash = await executeROASTPayment(content.asking_price, treasuryAddress);
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
        console.log(`🔄 Initiating USDC transfer: ${requiredAmount} USDC to ${treasuryAddress}`)
        result = await transferUSDC(requiredAmount, treasuryAddress)
        success = result.success
      }

      if (success) {
        // Call the onPurchase callback with transaction hash (this will handle backend recording)
        if (onPurchase) {
          const transactionHash = result.transactionHash;
          await onPurchase(content.id, content.asking_price, selectedPayment === 'roast' ? 'ROAST' : 'USDC', transactionHash)
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
    if (!content) return { text: '', hashtags: [], characterCount: 0, imageUrl: null, shouldUseMarkdown: false }

    // Check if this is a longpost that should be rendered as markdown
    const shouldUseMarkdown = isMarkdownContent(content.post_type)
    
    // Check if content has markdown syntax
    const hasMarkdownSyntax = content.content_text?.includes('##') || content.content_text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    // For longposts, use raw content; for others, use parsed content
    const { text, imageUrl: extractedImageUrl } = (shouldUseMarkdown || forceMarkdown)
      ? { text: content.content_text, imageUrl: null }
      : formatTwitterContent(content.content_text)
    
    // Use watermarked image for preview, original for purchased content
    const imageUrl = isPurchased 
      ? (content.content_images && content.content_images.length > 0 ? content.content_images[0] : extractedImageUrl)
      : (content.watermark_image || (content.content_images && content.content_images.length > 0 ? content.content_images[0] : extractedImageUrl))
    
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
  console.log('🔍 PurchaseModal: Post type:', content?.post_type)
  console.log('🔍 PurchaseModal: Should use markdown:', contentData.shouldUseMarkdown)
  console.log('🔍 PurchaseModal: Has markdown syntax:', content?.content_text?.includes('##') || content?.content_text?.includes('**'))
  console.log('🔍 PurchaseModal: Raw content length:', content?.content_text?.length)
  console.log('🔍 PurchaseModal: Parsed text length:', contentData.text?.length)
  console.log('🖼️ PurchaseModal: Image URL:', contentData.imageUrl)

  // Calculate USDC price
  const usdcPrice = roastPrice ? (content.asking_price * roastPrice).toFixed(2) : '0.00'
  const usdcFee = '0.030' // Constant 0.03 USDC fee
  const totalUSDC = roastPrice ? (parseFloat(usdcPrice) + parseFloat(usdcFee)).toFixed(2) : '0.00'

  return (
    <div
      className="fixed top-0 left-0 w-full h-full bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto touch-pan-y"
      onClick={handleBackdropClick}
      onContextMenu={preventRightClick}
      onKeyDown={preventKeyboardCopy}
      style={{ height: '100vh', minHeight: '100vh' }}
      tabIndex={0}
    >
      <div className="relative w-full max-w-[95vw] lg:max-w-6xl rounded-2xl bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-y-hidden shadow-2xl p-4 lg:p-6 overscroll-contain">
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

        <div className="flex flex-col lg:flex-row max-h-[90vh] gap-4 overflow-y-auto lg:overflow-hidden">
          {/* Left Panel - Tweet Preview */}
          <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8 bg-[#121418] rounded-2xl">
            <h2 className="text-white/80 text-base lg:text-lg font-medium mb-4 lg:mb-6">Tweet preview</h2>

            {/* Twitter Thread Container */}
            <div className="w-full flex-1 overflow-y-auto pr-1 lg:pr-2 rounded-2xl">
              <style jsx>{`
                div::-webkit-scrollbar {
                  width: 6px;
                }
                div::-webkit-scrollbar-track {
                  background: transparent;
                }
                div::-webkit-scrollbar-thumb {
                  background-color: #374151;
                  border-radius: 3px;
                }
                div::-webkit-scrollbar-thumb:hover {
                  background-color: #4B5563;
                }
              `}</style>

              {/* Single Tweet Container with Thread Structure */}
              <div className="relative">
                {/* Continuous Thread Line - Only show for threads, not longposts */}
                {content.tweet_thread && content.tweet_thread.length > 1 && !contentData.shouldUseMarkdown && (
                  <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-600 z-0"></div>
                )}

                {/* Main Tweet */}
                <div className="relative pb-3">
                  <div className="flex gap-3 pr-2">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                        {twitter.profile?.profileImage ? (
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
                        <span className={`text-white font-bold text-sm ${twitter.profile?.profileImage ? 'hidden' : ''}`}>{getInitialLetter()}</span>
              </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-bold text-xs lg:text-sm">{getDisplayName()}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                          <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                        </svg>
                        <span className="text-gray-500 text-xs lg:text-sm">@{getTwitterHandle()}</span>
                  </div>

                      {/* For longposts: Image first, then content */}
                      {contentData.shouldUseMarkdown ? (
                        <>
                          {/* Longpost Image at top */}
                          {contentData.imageUrl && (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                              />

                            </div>
                          )}
                          
                          {/* Longpost Content with white text styling */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            <div 
                              className="longpost-markdown-content"
                              style={{
                                color: 'white'
                              }}
                            >
                              {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Regular content (shitpost/thread): Content first, then image */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                          </div>
                          
                          {/* Tweet Images for regular content */}
                          {contentData.imageUrl && (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                              />

                            </div>
                          )}
                        </>
                      )}


                    </div>
                  </div>
                </div>

                {/* Thread Replies - Only show for threads, not longposts */}
                {content.tweet_thread && content.tweet_thread.length > 1 && !contentData.shouldUseMarkdown && content.tweet_thread.slice(1).map((tweet, index) => (
                  <div key={index} className="relative pb-3">
                    <div className="flex gap-3 pr-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                          {twitter.profile?.profileImage ? (
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
                          <span className={`text-white font-bold text-sm ${twitter.profile?.profileImage ? 'hidden' : ''}`}>{getInitialLetter()}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-xs lg:text-sm">{getDisplayName()}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                            <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                          </svg>
                          <span className="text-gray-500 text-xs lg:text-sm">@{getTwitterHandle()}</span>
                        </div>
                        <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                          {tweet}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="w-full lg:w-1/2 px-4 pt-4 lg:px-8 lg:pt-8 flex flex-col gap-4 overflow-y-auto justify-between">
            {!isPurchased ? (
              <>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4">
                    {/* Content Miner Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FFCC00] rounded-full flex items-center justify-center overflow-hidden">
                        <span className="text-black font-bold text-lg">
                          {minerInfo ? minerInfo.username.charAt(0).toUpperCase() : (content?.creator?.username?.charAt(0).toUpperCase() || 'U')}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">
                            {minerInfo ? minerInfo.username : (content?.creator?.username || 'User')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <div className="flex items-center gap-2">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFCC00">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
              </div>
                          <div className="flex items-center gap-1 text-xs">
                            {/* <span className="text-white">{content.creator.reputation_score} reputation</span>
                            <span className="text-white">•</span> */}
                            <span className="text-white">{new Date(content.created_at).toLocaleDateString()}</span>
            </div>
                          {/* {content.agent_name && (
                            <div className="flex items-start justify-start gap-1">
                              <span className="px-2 py-1 bg-blue-100 text-blue-400 text-xs rounded-2xl font-semibold">🤖 {content.agent_name}</span>
              </div>
                          )} */}
            </div>
          </div>
                    </div>

                    {/* Stats */}
                    <div className="flex flex-row items-center justify-start px-4">
                      <div className="flex flex-col w-[50%]">
                        <div className="text-white/80 text-xs">Predicted Mindshare</div>
                        <div className="text-white text-md font-semibold">{getRandomMindshare(content.id.toString()).toFixed(1)}%</div>
                      </div>
                      <div className="flex flex-col w-[50%]">
                        <div className="text-white/80 text-xs">Quality Score</div>
                        <div className="text-white text-md font-semibold">{content.quality_score.toFixed(1)}/100</div>
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
                            <div className="text-white/60 text-xs">Extra fee per tweet</div>
                            <div className="text-right text-white/60 text-xs">
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
                              <div className="flex items-center justify-between bg-[#220808] rounded-sm px-4 py-2">
                                <div className="text-white/80 text-sm">Twitter profile</div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white/80 text-sm">@{twitter.profile?.username || 'profile'}</span>
                                  <button
                                    type="button"
                                    onClick={() => disconnect()}
                                    className="text-white/60 hover:text-white/90 text-xs underline"
                                    disabled={twitter.isLoading}
                                  >
                                    {twitter.isLoading ? 'Disconnecting...' : 'Disconnect'}
                                  </button>
                                </div>
                              </div>

                              {/* Fee row + Generate button */}
                              <div className="flex flex-row items-center justify-between gap-1">
                                <div className="text-white/60 text-sm">Extra fee per tweet</div>
                                <div className="text-right text-white/60 text-xs">
                                  <span className="line-through">500 ROAST</span>
                                  <span className="text-green-400 ml-2 font-semibold">FREE</span>
                                </div>
                              </div>
                              <div className="">
                                <button 
                                  onClick={handleGenerate}
                                  className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-sm py-3 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors"
                                >
                                  <svg className="w-4 h-4 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  Generate
                                </button>
                              </div>
                      </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

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
                      <div className="text-white text-xl font-bold">{content.asking_price}</div>
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
                onClick={handlePurchase}
                disabled={isLoading}
                className={`w-full font-semibold py-4 rounded-sm text-lg transition-all duration-200 ${
                  isLoading 
                    ? 'bg-gray-500 cursor-not-allowed' 
                    : 'bg-[#FD7A10] glow-orange-button hover:bg-[#e86d0f]'
                } text-white`}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Processing...</span>
                  </div>
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
                      Purchased • {content.asking_price} ROAST
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
                      // Parse content for display
                      const { text: tweetText, imageUrl: extractedImageUrl } = content ? formatTwitterContentForManagement(content.content_text) : { text: '', imageUrl: null };
                      // Use original image for purchased content (post-purchase), watermarked for preview
                      const displayImage = isPurchased 
                        ? (content?.content_images && content.content_images.length > 0 ? content.content_images[0] : extractedImageUrl)
                        : (content?.watermark_image || (content?.content_images && content.content_images.length > 0 ? content.content_images[0] : extractedImageUrl));

                      // Prepare tweets for copy
                      const tweetsData = [
                          { 
                              title: 'Tweet 1', 
                              text: tweetText || 'Sample tweet content will appear here...' 
                          },
                          ...(displayImage ? [{ 
                              title: 'Tweet 1 (Image)', 
                              image: displayImage 
                          }] : []),
                          ...(content?.tweet_thread ? content.tweet_thread.map((tweet, idx) => ({ 
                              title: `Tweet ${idx + 2}`, 
                              text: tweet 
                          })) : [])
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
                            <div className="text-white/80 text-sm leading-relaxed">{section.text}</div>
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
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
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
