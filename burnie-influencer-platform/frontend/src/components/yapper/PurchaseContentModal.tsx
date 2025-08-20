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

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
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
  
  const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto")
  const [selectedTone, setSelectedTone] = useState("Select tone")
  const [selectedPayment, setSelectedPayment] = useState("roast")
  const [toneOpen, setToneOpen] = useState<boolean>(false)
  const [isPurchased, setIsPurchased] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showCopyProtection, setShowCopyProtection] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)

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

  // Twitter authentication for My Voice tab
  const handleTwitterAuth = async () => {
    if (!address) {
      setShowWalletModal(true)
      return
    }

    try {
      // Step 1: Get Twitter OAuth URL
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (!data.success || !data.data.oauth_url) {
        throw new Error('Invalid OAuth URL response')
      }

      // Store state, code verifier, and wallet address for later use
      localStorage.setItem('yapper_twitter_oauth_state', data.data.state)
      localStorage.setItem('yapper_twitter_code_verifier', data.data.code_verifier)
      localStorage.setItem('yapper_twitter_wallet_address', address || '')

      // Step 2: Open Twitter OAuth in a new window
      const authWindow = window.open(
        data.data.oauth_url,
        'yapper-twitter-auth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!authWindow) {
        alert('Failed to open authentication window. Please disable popup blocker.')
        return
      }

      // Step 3: Listen for messages from callback window
      const messageHandler = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return

        if (event.data.type === 'YAPPER_TWITTER_AUTH_SUCCESS') {
          authWindow.close()
          window.removeEventListener('message', messageHandler)
          
          // Fetch the actual Twitter profile info from backend
          try {
            const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`)
            if (statusResponse.ok) {
              const statusData = await statusResponse.json()
              if (statusData.success && statusData.data.connected) {
                // Twitter state now managed by global context
                console.log('✅ Twitter authentication successful:', statusData.data.twitter_username)
              } else {
                // Fallback to event data
                // Twitter state now managed by global context
                console.log('✅ Twitter authentication successful (fallback)')
              }
            } else {
              // Fallback to event data
              // Twitter state now managed by global context
              console.log('✅ Twitter authentication successful (fallback)')
            }
          } catch (error) {
            console.error('❌ Failed to fetch Twitter status after auth:', error)
            // Still mark as connected with fallback handle
            // Twitter state now managed by global context
          }
        } else if (event.data.type === 'YAPPER_TWITTER_AUTH_ERROR') {
          authWindow.close()
          window.removeEventListener('message', messageHandler)
          console.error('❌ Twitter authentication failed:', event.data.error)
        }
      }

      window.addEventListener('message', messageHandler)

      // Handle window closed manually
      const checkClosed = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkClosed)
          window.removeEventListener('message', messageHandler)
        }
      }, 1000)

    } catch (error) {
      console.error('❌ Twitter authentication failed:', error)
      alert('Twitter authentication failed. Please try again.')
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
            alert('Your Twitter access has expired and could not be refreshed. Please reconnect your Twitter account.')
            return
          }
          console.log('✅ Token refreshed successfully, proceeding with generation...')
        } else if (statusData.data.token_status === 'valid') {
          console.log('✅ Token is valid, proceeding with generation...')
        } else {
          console.log('⚠️ Token is missing, user needs to connect Twitter')
          alert('Please connect your Twitter account first.')
          return
        }
      }
    } catch (error) {
      console.error('❌ Error checking token status:', error)
      alert('Failed to verify Twitter connection. Please try again.')
      return
    }

    // If we reach here, token is valid and we can proceed with generation
    console.log('🚀 Proceeding with content generation...')
    // TODO: Add actual generation logic here
    alert('Generation would start here! (Token is valid and ready)')
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

    setIsLoading(true)
    try {
      let success = false
      
      // Get treasury address from environment or API
      const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b8D0a8e0E6a1e2cf47' // fallback address
      
      if (!treasuryAddress) {
        alert('Treasury wallet address not configured')
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
        alert(`Insufficient ${balanceData.data.tokenType} balance. You have ${balanceData.data.balance.toFixed(4)} ${balanceData.data.tokenType}, but need ${balanceData.data.requiredAmount} ${balanceData.data.tokenType}.`);
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
        alert('Transaction failed. Please try again.')
      }
    } catch (error) {
      console.error('Purchase failed:', error)
      alert('Purchase failed. Please try again.')
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
    
    // Use content_images array if available, otherwise fall back to extracted URL
    const imageUrl = content.content_images && content.content_images.length > 0 
      ? content.content_images[0] 
      : extractedImageUrl
    
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
                      <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10">
                        <span className="text-white font-bold text-sm">{content.creator.username.charAt(0).toUpperCase()}</span>
              </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-bold text-xs lg:text-sm">{content.creator.username}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                          <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                        </svg>
                        <span className="text-gray-500 text-xs lg:text-sm">@{content.creator.username.toLowerCase()}</span>
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
                              {/* CSS Blended Watermarks */}
                              <div className="absolute inset-0 pointer-events-none">
                                {/* Center - Buy to Access */}
                                <div 
                                  className="absolute text-white text-xl font-bold"
                                  style={{
                                    left: '50%',
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                                    mixBlendMode: 'overlay',
                                    opacity: 0.7
                                  }}
                                >
                                  BUY TO ACCESS
                                </div>
                                
                                {/* Center Bottom - @burnieio */}
                                <div 
                                  className="absolute text-white text-sm font-semibold"
                                  style={{
                                    left: '50%',
                                    top: '60%',
                                    transform: 'translate(-50%, -50%)',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    mixBlendMode: 'overlay',
                                    opacity: 0.6
                                  }}
                                >
                                  @burnieio
                                </div>
                                
                                {/* Four Corners - @burnieio */}
                                <div className="absolute text-white text-xs font-medium" style={{ left: '10px', top: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ right: '10px', top: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ left: '10px', bottom: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ right: '10px', bottom: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                              </div>
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
                              {/* CSS Blended Watermarks */}
                              <div className="absolute inset-0 pointer-events-none">
                                {/* Center - Buy to Access */}
                                <div 
                                  className="absolute text-white text-xl font-bold"
                                  style={{
                                    left: '50%',
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                                    mixBlendMode: 'overlay',
                                    opacity: 0.7
                                  }}
                                >
                                  BUY TO ACCESS
                                </div>
                                
                                {/* Center Bottom - @burnieio */}
                                <div 
                                  className="absolute text-white text-sm font-semibold"
                                  style={{
                                    left: '50%',
                                    top: '60%',
                                    transform: 'translate(-50%, -50%)',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    mixBlendMode: 'overlay',
                                    opacity: 0.6
                                  }}
                                >
                                  @burnieio
                                </div>
                                
                                {/* Four Corners - @burnieio */}
                                <div className="absolute text-white text-xs font-medium" style={{ left: '10px', top: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ right: '10px', top: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ left: '10px', bottom: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                                <div className="absolute text-white text-xs font-medium" style={{ right: '10px', bottom: '10px', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mixBlendMode: 'overlay', opacity: 0.5 }}>@burnieio</div>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* Tweet Actions */}
                      <div className="flex items-center justify-between text-gray-500 text-sm py-2 border-b border-gray-800">
                        <div className="flex items-center gap-6">
                          <button className="flex items-center gap-1 hover:text-white text-xs">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                            Tag people
                          </button>
                          <button className="flex items-center gap-1 hover:text-white text-xs">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            Reply
                          </button>
                          <button className="flex items-center gap-1 hover:text-white text-xs">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M17 1l4 4-4 4" />
                              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                              <path d="M7 23l-4-4 4-4" />
                              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                            </svg>
                            Repost
                          </button>
                        </div>
                    </div>
                    </div>
                  </div>
                </div>

                {/* Thread Replies - Only show for threads, not longposts */}
                {content.tweet_thread && content.tweet_thread.length > 1 && !contentData.shouldUseMarkdown && content.tweet_thread.slice(1).map((tweet, index) => (
                  <div key={index} className="relative pb-3">
                    <div className="flex gap-3 pr-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10">
                          <span className="text-white font-bold text-sm">{content.creator.username.charAt(0).toUpperCase()}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-xs lg:text-sm">{content.creator.username}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                            <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                          </svg>
                          <span className="text-gray-500 text-xs lg:text-sm">@{content.creator.username.toLowerCase()}</span>
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
                    {/* Content Creator Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FFCC00] rounded-full flex items-center justify-center">
                        <span className="text-black font-bold text-lg">{content.creator.username.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">{content.creator.username}</span>
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
                      
                      <div className="flex items-center justify-between flex-wrap bg-[#220808B2] rounded-full">
                        <button
                          onClick={() => setSelectedVoiceTone("auto")}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedVoiceTone === "auto"
                            ? "bg-white text-black"
                            : " text-white/80 "
                            }`}
                        >
                          Auto generated
                        </button>
                        <button
                          onClick={() => setSelectedVoiceTone("custom")}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedVoiceTone === "custom"
                            ? "bg-white text-black"
                            : " text-white/80 "
                            }`}
                        >
                          Choose Yapper
                </button>
                <button
                          onClick={() => setSelectedVoiceTone("mystyle")}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedVoiceTone === "mystyle"
                            ? "bg-white text-black"
                            : " text-white/80"
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
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setToneOpen((prev: boolean) => !prev)}
                            className="w-full bg-[#220808] border border-[#4A3636] rounded-md px-4 py-4 text-left text-white text-sm flex items-center justify-between focus:outline-none"
                          >
                            <span className={selectedTone === "Select tone" ? "text-white/80" : ""}>{selectedTone}</span>
                            <svg
                              className={`w-4 h-4 text-white/80 transition-transform ${toneOpen ? "rotate-180" : "rotate-0"}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {toneOpen && (
                            <div className="absolute z-10 w-full mt-1 bg-[#220808] border border-[#4A3636] rounded-md shadow-lg max-h-48 overflow-y-auto">
                              {toneOptions.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTone(option);
                                    setToneOpen(false);
                                  }}
                                  className="w-full text-left px-4 py-3 text-sm text-white hover:bg-[#4A3636] focus:outline-none transition-colors"
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Fee per tweet message */}
                          <div className="flex flex-row items-center justify-between gap-1 mt-3">
                            <div className="text-white/60 text-sm">Extra fee per tweet</div>
                            <div className="text-right text-white/60 text-xs">
                              <span className="line-through">25.00 Roasts/0.002 USDC</span>
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
                                onClick={handleTwitterAuth}
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
                                  <span className="line-through">25.00 Roasts+0.002 USDC</span>
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
                  onClick={onClose}
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
