'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'

interface TweetThreadDisplayProps {
  mainTweet: string
  tweetThread?: string[] | null
  className?: string
  showImage?: boolean
  imageUrl?: string | null
  characterCount?: number
  hashtags?: string[]
  isProtected?: boolean // Add protected content support
}

export default function TweetThreadDisplay({
  mainTweet,
  tweetThread,
  className = '',
  showImage = true,
  imageUrl,
  characterCount,
  hashtags,
  isProtected = false
}: TweetThreadDisplayProps) {
  const [isThreadExpanded, setIsThreadExpanded] = useState(false)
  
  const hasThread = tweetThread && Array.isArray(tweetThread) && tweetThread.length > 0
  const threadCount = hasThread ? tweetThread.length : 0
  
  // For protected content, we rely on the existing visual watermark overlays
  // No need to modify the text content itself
  const addWatermarkToText = (text: string): string => {
    return text // Return original text, visual watermarks are handled by parent containers
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Main Tweet */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
            🐦
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
              <span className="font-medium text-gray-900">AI Generated Content</span>
              <span>•</span>
              <span>now</span>
              {characterCount && (
                <>
                  <span>•</span>
                  <span className={characterCount > 280 ? 'text-red-500' : 'text-green-600'}>
                    {characterCount}/280 chars
                  </span>
                </>
              )}
            </div>
            
            <div className="text-gray-900 text-base leading-relaxed whitespace-pre-wrap break-words">
              {addWatermarkToText(mainTweet)}
            </div>
            
            {hashtags && hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {hashtags.map((tag, index) => (
                  <span 
                    key={index}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Show image if available */}
            {showImage && imageUrl && (
              <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
                <img
                  src={imageUrl}
                  alt="Generated content image"
                  className="w-full h-auto max-h-64 object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                  }}
                />
              </div>
            )}
            
            {/* Thread expand/collapse button */}
            {hasThread && (
              <button
                onClick={() => setIsThreadExpanded(!isThreadExpanded)}
                className="mt-3 flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                {isThreadExpanded ? (
                  <>
                    <ChevronUpIcon className="h-4 w-4" />
                    <span>Hide thread ({threadCount} tweets)</span>
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="h-4 w-4" />
                    <span>Show thread ({threadCount} tweets)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tweet Thread */}
      {hasThread && isThreadExpanded && (
        <div className="space-y-2 ml-6">
          {tweetThread.map((tweet, index) => (
            <div key={index} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  {index + 2}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-500 mb-1">
                    Reply • {index + 2}/{threadCount + 1}
                  </div>
                  <div className="text-gray-900 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {addWatermarkToText(tweet)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Thread summary when collapsed */}
      {hasThread && !isThreadExpanded && (
        <div className="ml-6 p-2 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="text-sm text-blue-700">
            💬 This tweet has a {threadCount}-part thread with additional project details
          </div>
        </div>
      )}
    </div>
  )
} 