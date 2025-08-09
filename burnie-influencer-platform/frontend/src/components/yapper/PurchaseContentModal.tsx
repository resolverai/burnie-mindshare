'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { XMarkIcon, ShoppingCartIcon, CurrencyDollarIcon, EyeIcon, StarIcon } from '@heroicons/react/24/outline'
import { addROASTTokenToWallet } from '../../utils/walletUtils'

interface ContentItem {
  id: number
  content_text: string
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
}

interface PurchaseContentModalProps {
  content: ContentItem | null
  isOpen: boolean
  onClose: () => void
  onPurchase: (contentId: number, price: number) => Promise<void>
}

export default function PurchaseContentModal({
  content,
  isOpen,
  onClose,
  onPurchase
}: PurchaseContentModalProps) {
  const { address, isConnected } = useAccount()
  const [isPurchasing, setIsPurchasing] = useState(false)
  const [watermarkPosition, setWatermarkPosition] = useState({ x: 0, y: 0 })

  // Generate a consistent miner ID from username
  const generateMinerId = (username: string): string => {
    const hash = username.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    const minerId = Math.abs(hash).toString().slice(0, 6).padStart(6, '0')
    return `MINER-${minerId}`
  }

  // Content parsing function
  const formatTwitterContent = (contentText: string): { text: string; hashtags: string[]; characterCount: number } => {
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
      characterCount: finalText.length
    }
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

  const handlePurchase = async () => {
    if (!content || !isConnected || !address) return

    setIsPurchasing(true)
    try {
      console.log('🛒 Purchase initiated:', {
        contentId: content.id,
        price: content.asking_price,
        userAddress: address,
        treasuryAddress: process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS
      });

      // Show user what's happening
      console.log(`💰 You will transfer ${content.asking_price} ROAST tokens to treasury wallet`);
      console.log(`📍 ROAST Contract: ${process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN}`);
      console.log(`📍 Treasury Address: ${process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS}`);

      await onPurchase(content.id, content.asking_price)
      onClose()
    } catch (error) {
      console.error('Purchase failed:', error)
      alert(`Purchase failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsPurchasing(false)
    }
  }

  const handleAddROASTToken = async () => {
    try {
      const success = await addROASTTokenToWallet();
      if (success) {
        alert('✅ ROAST token added to your wallet! You should now see your ROAST balance and the token amount in transactions.');
      } else {
        alert('❌ Failed to add ROAST token. Your wallet may not support this feature.');
      }
    } catch (error) {
      console.error('Failed to add ROAST token:', error);
      alert('❌ Failed to add ROAST token to wallet.');
    }
  }

  if (!isOpen || !content) return null

  const { text, hashtags, characterCount } = formatTwitterContent(content.content_text)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto relative">
        {/* Modal Watermarks */}
        <div 
          className="absolute pointer-events-none z-10 text-red-600 opacity-25 text-3xl font-black transform -rotate-45"
          style={{
            left: `${watermarkPosition.x}%`,
            top: `${watermarkPosition.y}%`,
            transition: 'all 4s ease-in-out',
            textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
          }}
        >
          PROTECTED
        </div>
        
        <div 
          className="absolute pointer-events-none z-10 text-red-600 opacity-20 text-2xl font-black transform rotate-12"
          style={{
            right: `${watermarkPosition.x}%`,
            bottom: `${watermarkPosition.y}%`,
            transition: 'all 4s ease-in-out',
            textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
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

              {/* Content Text */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 mb-4">
                <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                  {text}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>Characters: {characterCount}/280</span>
                  {hashtags.length > 0 && (
                    <div className="flex items-center space-x-1">
                      <span>Hashtags:</span>
                      <div className="flex space-x-1">
                        {hashtags.slice(0, 3).map((tag, index) => (
                          <span key={index} className="bg-blue-100 text-blue-700 px-1 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                        {hashtags.length > 3 && <span>+{hashtags.length - 3}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Content Image with Watermark */}
              {content.content_images && content.content_images.length > 0 && (
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
                        <div 
                          className="absolute text-white opacity-50 text-lg font-black transform -rotate-12"
                          style={{
                            left: '15%',
                            bottom: '15%',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                          }}
                        >
                          PREVIEW ONLY
                        </div>
                      </div>
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

          {/* Price & Purchase */}
          <div className="border-t border-gray-200 pt-6">
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Purchase Price</p>
                  <div className="flex items-center space-x-2">
                    <CurrencyDollarIcon className="h-5 w-5 text-orange-600" />
                    <span className="text-2xl font-bold text-orange-600">{content.asking_price}</span>
                    <span className="text-lg text-orange-600 font-semibold">ROAST</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Instant Purchase</p>
                  <p className="text-xs text-gray-500">No bidding required</p>
                </div>
              </div>
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
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-orange-600 flex items-center justify-center space-x-2"
              >
                {isPurchasing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <ShoppingCartIcon className="h-4 w-4" />
                    <span>Buy Content for {content.asking_price} ROAST</span>
                  </>
                )}
              </button>
            </div>

            {/* Wallet Transaction Info */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start space-x-2">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-blue-800">Wallet Transaction Info</h4>
                  <div className="mt-1 text-xs text-blue-700 space-y-1">
                    <p>• Your wallet will open to confirm a ROAST token transfer</p>
                    <p>• Amount: <strong>{content.asking_price} ROAST</strong></p>
                    <p>• To: Treasury Wallet ({process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS?.slice(0,10)}...)</p>
                    <p>• The wallet may not show the token amount if ROAST isn't recognized</p>
                    <p>• This is normal - the transaction is correct!</p>
                  </div>
                  <button
                    onClick={handleAddROASTToken}
                    className="mt-2 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors"
                  >
                    ➕ Add ROAST Token to Wallet
                  </button>
                </div>
              </div>
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