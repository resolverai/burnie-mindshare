'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Image from 'next/image'

import { useROASTPrice, formatUSDCPrice } from '../../utils/priceUtils'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo } from '../../utils/markdownParser'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[] // Add tweet thread support
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
  post_type?: string // Type of post: 'shitpost', 'longpost', or 'thread'
}

interface PurchaseContentModalProps {
  content: ContentItem | null
  isOpen: boolean
  onClose: () => void
  onPurchase: (contentId: number, price: number, currency: 'ROAST' | 'USDC') => Promise<void>
}

export default function PurchaseContentModal({
  content,
  isOpen,
  onClose,
  onPurchase
}: PurchaseContentModalProps) {
  const { address, isConnected } = useAccount()
  const { price: roastPrice } = useROASTPrice()
  const [isPurchasing, setIsPurchasing] = useState(false)
  const [watermarkPosition, setWatermarkPosition] = useState({ x: 0, y: 0 })
  const [selectedCurrency, setSelectedCurrency] = useState<'ROAST' | 'USDC'>('ROAST')

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

  // Constants
  const USDC_FEE = 0.03 // 0.03 USDC fee for USDC purchases

  // Generate a consistent miner ID from username
  const generateMinerId = (username: string): string => {
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash).toString().slice(0, 6).padStart(6, '0')
    return `MINER-${minerId}`
  }

  // Dynamic watermark positioning for modal
  useEffect(() => {
    if (isOpen) {
      const moveWatermark = () => {
        setWatermarkPosition({
          x: Math.random() * 60, // Smaller range for modal
          y: Math.random() * 60
        })
      }
      
      moveWatermark()
      const interval = setInterval(moveWatermark, 4000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  // ESC key to close modal
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey)
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [isOpen, onClose])

  // Calculate prices for both currencies
  const roastPriceAmount = content?.asking_price || 0
  const usdcPriceWithoutFee = roastPriceAmount * roastPrice
  const usdcPriceWithFee = usdcPriceWithoutFee + USDC_FEE

  const handlePurchase = async () => {
    if (!content || !isConnected || !address) return

    setIsPurchasing(true)
    try {
      const finalPrice = selectedCurrency === 'ROAST' 
        ? content.asking_price 
        : parseFloat(usdcPriceWithFee.toFixed(6))

      console.log('🛒 Purchase initiated:', {
        contentId: content.id,
        price: finalPrice,
        currency: selectedCurrency,
        userAddress: address,
        treasuryAddress: process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS
      });

      if (selectedCurrency === 'ROAST') {
        console.log(`💰 You will transfer ${finalPrice} ROAST tokens to treasury wallet`);
      console.log(`📍 ROAST Contract: ${process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN}`);
      } else {
        console.log(`💰 You will transfer ${finalPrice} USDC (including 0.03 USDC fee) to treasury wallet`);
        console.log(`📍 USDC Contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`); // BASE USDC
      }
      console.log(`📍 Treasury Address: ${process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS}`);

      await onPurchase(content.id, finalPrice, selectedCurrency)
      onClose()
    } catch (error) {
      console.error('Purchase failed:', error)
      alert(`Purchase failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsPurchasing(false)
    }
  }

  if (!isOpen || !content) return null

  // Check if this is a longpost that should be rendered as markdown
  const shouldUseMarkdown = isMarkdownContent(content.post_type)
  
  // FORCE TEST: Check if content has markdown syntax
  const hasMarkdownSyntax = content.content_text?.includes('##') || content.content_text?.includes('**')
  
  // FORCE TEST: Override markdown detection for testing
  const forceMarkdown = hasMarkdownSyntax // Force markdown if we detect markdown syntax
  
  // For longposts, use raw content; for others, use parsed content
  const { text, hashtags, characterCount, imageUrl } = (shouldUseMarkdown || forceMarkdown)
    ? { text: content.content_text, hashtags: [], characterCount: content.content_text?.length || 0, imageUrl: null }
    : formatTwitterContent(content.content_text)

  // Use content_images array if available, otherwise fall back to extracted URL
  const displayImage = content.content_images && content.content_images.length > 0 
    ? content.content_images[0] 
    : imageUrl

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="fixed top-0 left-0 w-full h-full bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto touch-pan-y"
      onClick={handleBackdropClick}
      style={{ height: '100vh', minHeight: '100vh' }}
    >
      <div className="relative w-full max-w-[95vw] lg:max-w-6xl rounded-2xl bg-[#492222] max-h-[92vh] overflow-y-auto shadow-2xl p-4 lg:p-6 overscroll-contain">
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
          {/* Left Panel - Content Preview */}
          <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8 bg-[#121418] rounded-2xl min-h-0">
            <h2 className="text-white/80 text-base lg:text-lg font-medium mb-4 lg:mb-6">Content preview</h2>

            {/* Content Container */}
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

              {/* Content Display */}
              {forceMarkdown ? (
                // Longpost content
                <div className="relative p-4 bg-[#1a1d23] rounded-lg">
                  <div className="absolute top-2 right-2 z-10">
                    <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(content.post_type).className}`}>
                      {getPostTypeInfo(content.post_type).text}
                    </span>
                  </div>
                  <div className="text-white text-sm leading-relaxed">
                    {renderMarkdown(text, { className: 'text-white' })}
                  </div>
                </div>
              ) : (
                // Twitter thread structure
                <div className="relative">
                  {/* Continuous Thread Line */}
                  <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-600 z-0"></div>

                  {/* Main Tweet */}
                  <div className="relative pb-3">
                    <div className="flex gap-3 pr-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 lg:w-10 lg:h-10 bg-[#FFCC00] rounded-full flex items-center justify-center relative z-10">
                          <span className="text-black font-bold text-lg">
                            {generateMinerId(content.creator.username).charAt(6).toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-xs lg:text-sm">{generateMinerId(content.creator.username)}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                            <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                          </svg>
                          <span className="text-gray-500 text-xs lg:text-sm">@{content.creator.username}</span>
                        </div>

                        <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                          {text}
                        </div>

                        {/* Tweet Image */}
                        {displayImage && (
                          <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                            <Image
                              src={displayImage}
                              alt="Tweet content"
                              width={500}
                              height={300}
                              className="w-full h-auto object-cover"
                            />
                            {/* Watermarks */}
                            <div className="absolute inset-0 pointer-events-none">
                              <div 
                                className="absolute text-white opacity-50 text-xl font-semibold"
                                style={{
                                  left: '50%',
                                  top: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                                  mixBlendMode: 'overlay'
                                }}
                              >
                                BUY TO ACCESS
                              </div>
                            </div>
                          </div>
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
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1" />
                              </svg>
                              Descriptions
                            </button>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 text-xs">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#F59E0B">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                              Quality
                            </span>
                            <button className="hover:text-white">⋯</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Thread Replies (if tweet_thread exists) */}
                  {content.tweet_thread && content.tweet_thread.map((tweet, idx) => (
                    <div key={idx} className="relative pt-3">
                      <div className="flex gap-3 pr-2">
                        <div className="relative flex-shrink-0">
                          <div className="w-7 h-7 lg:w-8 lg:h-8 bg-[#FFCC00] rounded-full flex items-center justify-center relative z-10 mr-2">
                            <span className="text-black font-bold text-sm">
                              {generateMinerId(content.creator.username).charAt(6).toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-bold text-xs lg:text-sm">{generateMinerId(content.creator.username)}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1DA1F2">
                              <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                            </svg>
                            <span className="text-gray-500 text-xs lg:text-sm">@{content.creator.username}</span>
                          </div>
                          <div className="text-white text-xs lg:text-sm leading-relaxed pr-2">
                            {tweet}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Purchase Options */}
          <div className="w-full lg:w-1/2 px-4 pt-4 lg:px-8 lg:pt-8 flex flex-col gap-4 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-4">
              {/* Miner Info */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#FFCC00] rounded-full flex items-center justify-center">
                  <span className="text-black font-bold text-lg">
                    {generateMinerId(content.creator.username).charAt(6).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{generateMinerId(content.creator.username)}</span>
                    {content.agent_name && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-400 text-xs rounded-2xl font-semibold">
                        🤖 {content.agent_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <div className="flex items-center gap-2">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFCC00">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-white">{content.creator.reputation_score} reputation</span>
                      <span className="text-white">•</span>
                      <span className="text-white">{new Date(content.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="flex flex-row items-center justify-start px-4">
                <div className="flex flex-col w-[40%]">
                  <div className="text-white/80 text-xs">Predicted Mindshare</div>
                  <div className="text-white text-md font-semibold">{content.predicted_mindshare.toFixed(1)}%</div>
                </div>
                <div className="flex flex-col w-[60%]">
                  <div className="text-white/80 text-xs">Quality Score</div>
                  <div className="text-white text-md font-semibold">{content.quality_score.toFixed(1)}/100</div>
                </div>
              </div>

              {/* Purchase Options */}
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div
                    onClick={() => setSelectedCurrency('ROAST')}
                    className={`p-4 rounded-md cursor-pointer transition-colors bg-[#12141866] ${
                      selectedCurrency === 'ROAST' ? 'ring-2 ring-orange-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-semibold">$ROAST</span>
                      <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${
                        selectedCurrency === 'ROAST' ? "border-orange-500" : "border-orange-500"
                      }`}>
                        {selectedCurrency === 'ROAST' && (
                          <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                        )}
                      </div>
                    </div>
                    <div className="text-white text-xl font-bold">{roastPriceAmount}</div>
                    <div className="text-white/60 text-xs">Platform Token</div>
                  </div>

                  <div
                    onClick={() => setSelectedCurrency('USDC')}
                    className={`p-4 rounded-md cursor-pointer transition-colors bg-[#12141866] ${
                      selectedCurrency === 'USDC' ? 'ring-2 ring-orange-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-semibold">USDC</span>
                      <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${
                        selectedCurrency === 'USDC' ? "border-orange-500" : "border-orange-500"
                      }`}>
                        {selectedCurrency === 'USDC' && (
                          <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                        )}
                      </div>
                    </div>
                    <div className="text-white text-xl font-bold">{formatUSDCPrice(usdcPriceWithFee)}</div>
                    <div className="text-white/60 text-xs">Including 0.03 USDC fee</div>
                  </div>
                </div>

                <button 
                  onClick={handlePurchase}
                  disabled={!isConnected || isPurchasing}
                  className="w-full bg-[#FD7A10] glow-orange-button text-white font-semibold py-4 rounded-sm text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isPurchasing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>Buy content</span>
                  )}
                </button>

                {!isConnected && (
                  <p className="text-sm text-red-400 text-center mt-3">
                    Please connect your wallet to purchase content
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
