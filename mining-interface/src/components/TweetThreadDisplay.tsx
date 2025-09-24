'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import VideoPlayer from './VideoPlayer'

interface TweetThreadDisplayProps {
  mainTweet: string
  tweetThread?: string[] | null
  className?: string
  showImage?: boolean
  imageUrl?: string | null
  characterCount?: number
  hashtags?: string[]
  isProtected?: boolean
  // Video fields
  is_video?: boolean
  video_url?: string
  watermark_video_url?: string
  video_duration?: number
}

export default function TweetThreadDisplay({
  mainTweet,
  tweetThread,
  className = '',
  showImage = true,
  imageUrl,
  characterCount,
  hashtags,
  isProtected = false,
  is_video = false,
  video_url,
  watermark_video_url,
  video_duration
}: TweetThreadDisplayProps) {
  const [isThreadExpanded, setIsThreadExpanded] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  
  // Debug logging
  console.log('🔍 TweetThreadDisplay Debug:', {
    tweetThread,
    tweetThreadType: typeof tweetThread,
    tweetThreadLength: tweetThread?.length,
    hasArray: Array.isArray(tweetThread)
  })
  
  const hasThread = tweetThread && Array.isArray(tweetThread) && tweetThread.length > 0
  const threadCount = hasThread ? tweetThread.length : 0
  
  // Return original text without any modifications
  const addWatermarkToText = (text: string): string => {
    return text // No text modifications needed
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Main Tweet */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
            🐦
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 text-sm text-gray-400 mb-2">
              <span className="font-medium text-white">AI Generated Content</span>
              <span>•</span>
              <span>now</span>
              {characterCount && (
                <>
                  <span>•</span>
                  <span className={characterCount > 280 ? 'text-red-400' : 'text-green-400'}>
                    {characterCount}/280 chars
                  </span>
                </>
              )}
            </div>
            
            <div className="text-white text-base leading-relaxed whitespace-pre-wrap break-words">
              {addWatermarkToText(mainTweet)}
            </div>
            
            {hashtags && hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {hashtags.map((tag, index) => (
                  <span 
                    key={index}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Show video (preferred) or image fallback */}
            {showImage && !videoFailed && video_url ? (
              <div className="mt-3 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                <VideoPlayer
                  src={video_url}
                  poster={imageUrl || undefined}
                  autoPlay={true}
                  controls={true}
                  className="w-full h-auto"
                  onError={() => {
                    console.warn('⚠️ TweetThreadDisplay: Video failed. Falling back to image', { video_url, imageUrl })
                    setVideoFailed(true)
                  }}
                />
                {video_duration && (
                  <div className="mt-2 text-xs text-gray-400 text-center">
                    Duration: {video_duration}s
                  </div>
                )}
              </div>
            ) : showImage && imageUrl && (
              <div className="mt-3 rounded-lg overflow-hidden border border-gray-600 bg-gray-800">
                <img
                  src={imageUrl}
                  alt="Generated content image"
                  className="w-full h-auto object-contain"
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
                className="mt-3 flex items-center space-x-2 text-sm text-orange-400 hover:text-orange-300 font-medium transition-colors"
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
            <div key={index} className="bg-gray-700/30 rounded-lg p-3 border border-gray-600">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-700 rounded-full flex items-center justify-center text-white font-bold text-xs">
                  {index + 2}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-400 mb-1">
                    Reply • {index + 2}/{threadCount + 1}
                  </div>
                  <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap break-words">
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
        <div className="ml-6 p-2 bg-orange-900/20 border border-orange-700 rounded-lg">
          <div className="text-sm text-orange-300">
            💬 This tweet has a {threadCount}-part thread with additional project details
          </div>
        </div>
      )}
    </div>
  )
} 