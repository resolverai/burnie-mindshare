'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { XMarkIcon, ShoppingCartIcon, CurrencyDollarIcon, EyeIcon, StarIcon } from '@heroicons/react/24/outline'

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto relative">
        {/* Subtle Modal Watermarks */}
        <div 
          className="absolute pointer-events-none z-10 text-gray-500 opacity-15 text-lg font-medium transform -rotate-45"
          style={{
            left: `${watermarkPosition.x}%`,
            top: `${watermarkPosition.y}%`,
            transition: 'all 4s ease-in-out',
            textShadow: '1px 1px 1px rgba(0,0,0,0.2)'
          }}
        >
          PROTECTED
        </div>
        
        <div 
          className="absolute pointer-events-none z-10 text-gray-500 opacity-12 text-sm font-medium transform rotate-12"
          style={{
            right: `${watermarkPosition.x}%`,
            bottom: `${watermarkPosition.y}%`,
            transition: 'all 4s ease-in-out',
            textShadow: '1px 1px 1px rgba(0,0,0,0.2)'
          }}
        >
          PREVIEW ONLY
        </div>

        <div className="p-6 relative z-20">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                <ShoppingCartIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Purchase Content</h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content Preview */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-blue-600 mb-3">🐦 Content Preview</h4>
              
              {/* Miner Info */}
              <div className="flex items-center space-x-3 mb-4 p-3 bg-white rounded-lg border border-gray-200">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">
                    {generateMinerId(content.creator.username).charAt(6).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <p className="font-medium text-gray-900">{generateMinerId(content.creator.username)}</p>
                    {content.agent_name && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                        🤖 {content.agent_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1 text-xs text-gray-500">
                    <span>{content.creator.reputation_score} reputation</span>
                    <span>•</span>
                    <span>{content.campaign.platform_source}</span>
                  </div>
                </div>
              </div>

              {/* Content Display - Markdown for longposts, TweetThread for others */}
              <div className="mb-4">
                {forceMarkdown ? (
                  // Render longpost with markdown formatting
                  <div className="relative">
                    <div className="absolute top-2 right-2 z-10">
                      <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getPostTypeInfo(content.post_type).className}`}>
                        {getPostTypeInfo(content.post_type).text}
                      </span>
                    </div>
                    {renderMarkdown(text, { className: 'longpost-content' })}
                  </div>
                ) : (
                  <TweetThreadDisplay 
                    mainTweet={text}
                    tweetThread={content.tweet_thread}
                    imageUrl={displayImage}
                    characterCount={characterCount}
                    hashtags={hashtags}
                    showImage={false} // We'll display image separately with watermarks
                    isProtected={true} // Enable protected watermarks
                  />
                )}
              </div>
              
              {/* Content Image with Watermark - Only for non-longpost content */}
              {content.content_images && content.content_images.length > 0 && !forceMarkdown && (
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="relative w-full">
                    <div className="relative overflow-hidden rounded-lg border border-gray-300">
                      <img 
                        src={content.content_images[0]} 
                        alt="AI Generated content image"
                        className="w-full h-auto object-cover rounded-lg shadow-sm"
                        onError={(e) => {
                          console.error('❌ Purchase modal image failed to load:', content.content_images?.[0])
                          e.currentTarget.style.display = 'none'
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement
                          if (fallback) fallback.style.display = 'block'
                        }}
                      />
                      
                      {/* AI-Resistant Blended Watermarks */}
                      <div className="absolute inset-0 pointer-events-none">
                        {/* Primary Call-to-Action - Overlay Blend */}
                        <div 
                          className="absolute text-white opacity-35 text-lg font-semibold transform rotate-0"
                          style={{
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
                            mixBlendMode: 'overlay'
                          }}
                        >
                          BUY TO ACCESS
                        </div>
                        
                        {/* Central Brand Watermark - Below CTA */}
                        <div 
                          className="absolute text-white opacity-30 text-sm font-medium"
                          style={{
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%) translateY(24px)',
                            textShadow: '1px 1px 3px rgba(0,0,0,0.6)',
                            mixBlendMode: 'screen'
                          }}
                        >
                          @burnieio
                        </div>
                        
                        {/* Corner Watermarks - Multiple Blend Modes for AI Resistance */}
                        <div 
                          className="absolute text-white opacity-40 text-sm font-medium"
                          style={{
                            left: '8px',
                            top: '8px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
                            mixBlendMode: 'multiply'
                          }}
                        >
                          @burnieio
                        </div>
                        <div 
                          className="absolute text-white opacity-40 text-sm font-medium"
                          style={{
                            right: '8px',
                            top: '8px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
                            mixBlendMode: 'difference'
                          }}
                        >
                          @burnieio
                        </div>
                        <div 
                          className="absolute text-white opacity-40 text-sm font-medium"
                          style={{
                            left: '8px',
                            bottom: '8px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
                            mixBlendMode: 'soft-light'
                          }}
                        >
                          @burnieio
                        </div>
                        <div 
                          className="absolute text-white opacity-40 text-sm font-medium"
                          style={{
                            right: '8px',
                            bottom: '8px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
                            mixBlendMode: 'hard-light'
                          }}
                        >
                          @burnieio
                        </div>
                      </div>
                      
                      {/* Additional Blend Layer - Micro Pattern Protection */}
                      <div 
                        className="absolute inset-0 pointer-events-none opacity-10"
                        style={{
                          mixBlendMode: 'multiply',
                          background: `repeating-linear-gradient(
                            45deg,
                            transparent,
                            transparent 20px,
                            rgba(255,255,255,0.1) 20px,
                            rgba(255,255,255,0.1) 22px
                          )`
                        }}
                      />
                      
                      {/* Subtle Brand Pattern Overlay */}
                      <div 
                        className="absolute inset-0 pointer-events-none text-white opacity-5 text-xs font-light"
                        style={{
                          mixBlendMode: 'overlay',
                          background: `repeating-conic-gradient(
                            from 0deg at 50% 50%,
                            transparent 0deg,
                            rgba(255,255,255,0.03) 72deg,
                            transparent 144deg
                          )`
                        }}
                      />
                    </div>
                    
                    <div 
                      className="hidden bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg border border-gray-300 p-8 text-center"
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
              
              {/* Longpost Image with Watermark - Only for longpost content */}
              {content.content_images && content.content_images.length > 0 && forceMarkdown && (
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="relative w-full">
                    <div className="relative overflow-hidden rounded-lg border border-gray-300">
                      <img 
                        src={content.content_images[0]} 
                        alt="AI Generated longpost image"
                        className="w-full h-auto object-contain rounded-lg shadow-sm"
                        onError={(e) => {
                          console.error('❌ Purchase modal longpost image failed to load:', content.content_images?.[0])
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                      
                      {/* Image Watermarks */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div 
                          className="absolute text-white opacity-70 text-3xl font-black transform -rotate-45"
                          style={{
                            left: '25%',
                            top: '35%',
                            textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                          }}
                        >
                          PROTECTED
                        </div>
                        <div 
                          className="absolute text-white opacity-60 text-2xl font-black transform rotate-12"
                          style={{
                            right: '20%',
                            bottom: '25%',
                            textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                          }}
                        >
                          BUY TO ACCESS
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Content Metrics */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
              <div className="flex items-center space-x-2">
                <EyeIcon className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-gray-600">Predicted Mindshare</span>
              </div>
              <p className="text-lg font-bold text-blue-600">{content.predicted_mindshare.toFixed(1)}%</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
              <div className="flex items-center space-x-2">
                <StarIcon className="h-4 w-4 text-yellow-500" />
                <span className="text-sm text-gray-600">Quality Score</span>
              </div>
              <p className="text-lg font-bold text-yellow-600">{content.quality_score.toFixed(1)}/100</p>
            </div>
          </div>

          {/* Currency Selection & Price */}
          <div className="border-t border-gray-200 pt-6">
            {/* Currency Selection */}
            <div className="mb-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Choose Payment Currency</h4>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSelectedCurrency('ROAST')}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedCurrency === 'ROAST'
                      ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200'
                      : 'border-gray-200 bg-white hover:border-orange-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="font-semibold text-orange-600">ROAST</div>
                      <div className="text-2xl font-bold text-gray-900">{roastPriceAmount}</div>
                      <div className="text-xs text-gray-500">Platform Token</div>
                    </div>
                    <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">R</span>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedCurrency('USDC')}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedCurrency === 'USDC'
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
              <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="font-semibold text-blue-600">USDC</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatUSDCPrice(usdcPriceWithFee)}
                      </div>
                      <div className="text-xs text-red-500">+0.03 USDC fee</div>
                    </div>
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">$</span>
                    </div>
                  </div>
                </button>
              </div>

              {/* Fee Information */}
              {selectedCurrency === 'USDC' && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <div className="flex-shrink-0">
                      <svg className="h-4 w-4 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1 text-xs text-yellow-800">
                      <div className="font-medium">USDC Payment Notice</div>
                      <div className="mt-1">
                        • Base content price: {formatUSDCPrice(usdcPriceWithoutFee)} USDC<br/>
                        • Platform fee: +0.03 USDC<br/>
                        • <strong>Total: {formatUSDCPrice(usdcPriceWithFee)} USDC</strong><br/>
                        • 💡 Save money by using ROAST tokens (no extra fees!)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedCurrency === 'ROAST' && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <div className="flex-shrink-0">
                      <svg className="h-4 w-4 text-green-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1 text-xs text-green-800">
                      <div className="font-medium">ROAST Payment - No Extra Fees! 🎉</div>
                      <div className="mt-1">
                        • No platform fees when using ROAST<br/>
                        • Equivalent value: ~{formatUSDCPrice(usdcPriceWithoutFee)} USDC<br/>
                        • Support the platform ecosystem with native tokens
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Purchase Button */}
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePurchase}
                disabled={!isConnected || isPurchasing}
                className={`flex-1 font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 ${
                  selectedCurrency === 'ROAST'
                    ? 'bg-orange-600 hover:bg-orange-700 text-white disabled:hover:bg-orange-600'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:hover:bg-blue-600'
                }`}
              >
                {isPurchasing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <ShoppingCartIcon className="h-4 w-4" />
                    <span>
                      Buy with {selectedCurrency === 'ROAST' ? `${roastPriceAmount} ROAST` : `${formatUSDCPrice(usdcPriceWithFee)} USDC`}
                    </span>
                  </>
                )}
              </button>
            </div>



            {!isConnected && (
              <p className="text-sm text-red-600 text-center mt-3">
                Please connect your wallet to purchase content
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 