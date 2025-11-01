'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'
import SecureImage from '@/components/SecureImage'
import TweetThreadDisplay from '@/components/TweetThreadDisplay'
import { renderMarkdown } from '@/utils/markdownParser'

// Custom polling for projects (different endpoint than Web2)
// Move ref outside hook to persist across renders
const pollingIntervalRef = { current: null as NodeJS.Timeout | null }

const useProjectPolling = () => {
  const startPolling = (
    projectId: string,
    jobId: string,
    onProgress: (progress: any) => void,
    onComplete: (progress: any) => void,
    onError: (error: string) => void
  ) => {
    console.log('🎯 startPolling called with:', { projectId, jobId })
    
    // Stop any existing polling first
    if (pollingIntervalRef.current) {
      console.log('🛑 Clearing existing polling interval')
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    
    const apiUrl = getApiUrlWithFallback()
    if (!apiUrl || !projectId || !jobId) {
      console.error('Missing required parameters for polling', { apiUrl: !!apiUrl, projectId: !!projectId, jobId: !!jobId })
      onError('API URL, Project ID, or Job ID not configured')
      return () => {} // Return no-op cleanup function
    }
    
    const stopPollingLocal = () => {
      if (pollingIntervalRef.current) {
        console.log('🛑 Stopping polling, interval ID:', pollingIntervalRef.current)
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
        console.log('✅ Polling stopped, interval cleared')
      } else {
        console.log('⚠️ No polling interval to stop')
      }
    }
    
    let pollCount = 0
    const poll = async () => {
      pollCount++
      console.log(`🔄 Polling attempt #${pollCount} for job ${jobId}`)
      
      if (!apiUrl || !projectId || !jobId) {
        console.error('Missing required parameters for polling')
        return
      }
      
      try {
        // apiUrl already includes /api, so use /projects directly
        const url = `${apiUrl}/projects/${projectId}/generate/progress/${jobId}`
        console.log(`📡 Polling URL: ${url}`)
        
        const response = await fetch(url)
        console.log(`📥 Poll response status: ${response.status}`)
        
        if (!response.ok) {
          console.error(`❌ Polling failed: ${response.status}`)
          // Continue polling even on error (might be temporary)
          return
        }
        
        const data = await response.json()
        console.log(`📊 Poll response data:`, data)
        
        if (data.success && data.data) {
          const progress = data.data
          console.log(`✅ Progress update: status=${progress.status}, percent=${progress.progress_percent}%`)
          onProgress(progress)
          
          if (progress.status === 'completed') {
            console.log('✅ Generation completed, stopping polling')
            stopPollingLocal()
            onComplete(progress)
          } else if (progress.status === 'failed' || progress.status === 'error') {
            console.log('❌ Generation failed, stopping polling')
            stopPollingLocal()
            onError(progress.error_message || 'Generation failed')
          } else {
            console.log(`⏳ Still generating (${progress.status}), will continue polling...`)
          }
        } else {
          console.warn('⚠️ Polling: Invalid response format', data)
        }
      } catch (error) {
        console.error('❌ Polling error:', error)
        // Continue polling even on error (might be network issue)
      }
    }
    
    // Poll immediately, then every 3 seconds
    console.log('🚀 Starting polling for job:', jobId)
    console.log('🚀 Polling parameters:', { projectId, jobId, apiUrl })
    
    // Immediate poll
    console.log('📞 Executing immediate poll...')
    poll().catch(error => {
      console.error('❌ Error in immediate poll:', error)
    })
    
    // Set up interval for repeated polling
    console.log('⏱️ Setting up polling interval (every 3 seconds)...')
    const intervalId = setInterval(() => {
      console.log('⏱️ Interval callback triggered - calling poll()...', new Date().toISOString())
      poll().catch(error => {
        console.error('❌ Error in interval poll:', error)
      })
    }, 3000)
    
    pollingIntervalRef.current = intervalId
    console.log('✅ Polling interval set with ID:', intervalId)
    console.log('✅ pollingIntervalRef.current:', pollingIntervalRef.current)
    console.log('✅ Polling setup complete. Should see polls every 3 seconds now.')
    
    // Verify interval is actually running
    setTimeout(() => {
      if (pollingIntervalRef.current === intervalId) {
        console.log('✅ Interval still active after 5 seconds')
      } else {
        console.error('❌ Interval was cleared or changed!')
      }
    }, 5000)
    
    // Stop after 15 minutes
    setTimeout(() => {
      console.log('⏰ 15 minute timeout reached, stopping polling')
      stopPollingLocal()
    }, 900000)
    
    return stopPollingLocal
  }
  
  const stopPolling = () => {
    // Only log if actually clearing something (reduce noise from Strict Mode unmounts)
    if (pollingIntervalRef.current) {
      console.log('🛑 stopPolling called, clearing interval:', pollingIntervalRef.current)
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      console.log('✅ Interval cleared')
    }
    // Silently return if no interval exists (common during development Strict Mode)
  }
  
  return { startPolling, stopPolling }
}

type PostType = 'thread' | 'shitpost' | 'longpost'

interface PostData {
  id: string
  type: PostType
  text: string
  imageUrl?: string
  tweetText?: string
  threadArray?: string[]
}

// Helper function to format post type labels
const formatPostType = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'shitpost':
      return 'Meme Post'
    case 'thread':
      return 'Regular Post'
    case 'longpost':
      return 'Long Post'
    default:
      return type || 'Post'
  }
}

export default function ProjectDailyPostsPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params.projectId as string
  const { startPolling, stopPolling } = useProjectPolling()
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [posts, setPosts] = useState<PostData[]>([])
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [perImageMetadata, setPerImageMetadata] = useState<any>({})
  const [dailyPostsCount, setDailyPostsCount] = useState<number>(10) // Default to 10
  const [contentMix, setContentMix] = useState<{threads: number, shitpost: number, longpost: number}>({threads: 4, shitpost: 4, longpost: 2})
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null)

  // Fetch configurations on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl || !projectId) return
        
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const response = await fetch(`${apiUrl}/projects/${projectId}/configurations?user_timezone=${encodeURIComponent(userTimezone)}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            const config = data.data
            setDailyPostsCount(config.daily_posts_count || 10)
            if (config.content_mix) {
              setContentMix(config.content_mix)
            }
          }
        }
      } catch (error) {
        console.error('Error fetching configurations:', error)
        // Use defaults if fetch fails
      }
    }
    
    fetchConfig()
  }, [projectId])

  // Cleanup polling on unmount only
  useEffect(() => {
    // Note: In React Strict Mode (development), this cleanup runs on mount too
    // This is expected behavior - the warning "No interval to clear" is harmless
    return () => {
      // Only log if there's actually polling to stop (to reduce noise)
      if (pollingIntervalRef.current) {
        console.log('🧹 Cleanup: Component unmounting, stopping polling')
        stopPolling()
      }
      // Silently handle case where polling hasn't started yet (common in Strict Mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - only cleanup on unmount

  const handleProgress = async (progress: any) => {
    console.log('🔄 handleProgress called with:', progress)
    console.log('📊 Updating UI state:', {
      progress_message: progress.progress_message,
      progress_percent: progress.progress_percent,
      images_count: progress.generated_image_urls?.length || 0
    })
    
    setProgressMessage(progress.progress_message || 'Generating...')
    setProgressPercent(progress.progress_percent || 0)
    
    // Update generated images progressively
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      console.log('🖼️ Updating generated images:', progress.generated_image_urls.length, 'images')
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Update per_image_metadata (even if no images yet)
    if (progress.per_image_metadata) {
      console.log('📊 Updating per_image_metadata, keys:', Object.keys(progress.per_image_metadata))
      setPerImageMetadata(progress.per_image_metadata)
      
      // Update posts with tweet text, thread arrays, images, and content type progressively
      // Use functional update to ensure we have the latest posts array
      setPosts(currentPosts => {
        // If posts array is empty, don't update (shouldn't happen but safety check)
        if (currentPosts.length === 0) {
          console.warn('⚠️ Cannot update posts: posts array is empty')
          return currentPosts
        }
        
        const updatedPosts = currentPosts.map((post, index) => {
          const imageKey = `image_${index + 1}`
          const metadata = progress.per_image_metadata[imageKey]
          
          if (metadata) {
            // Update post type dynamically from metadata if available
            const contentType = metadata.content_type || post.type
            console.log(`📝 Updating post ${index + 1}: type=${contentType}, hasImage=${!!metadata.image_url}`)
            return {
              ...post,
              type: contentType as PostType, // Update type dynamically
              imageUrl: metadata.image_url || post.imageUrl,
              tweetText: metadata.tweet_text || post.tweetText,
              text: metadata.tweet_text || post.text || post.tweetText,
              threadArray: metadata.thread_array || post.threadArray || []
            }
          }
          // Keep existing post data even if no metadata yet
          return post
        })
        return updatedPosts
      })
    }
  }

  const handleComplete = async (progress: any) => {
    console.log('✅ handleComplete called with progress:', progress)
    setIsGenerating(false)
    setProgressMessage('Generation complete!')
    setProgressPercent(100)
    
    // Final update with all images and metadata
    if (progress.generated_image_urls) {
      console.log('🖼️ Final images update:', progress.generated_image_urls.length, 'images')
      setGeneratedImages(progress.generated_image_urls)
    }
    
    if (progress.per_image_metadata) {
      console.log('📊 Final metadata update, keys:', Object.keys(progress.per_image_metadata))
      setPerImageMetadata(progress.per_image_metadata)
      
      // Final posts update - use functional update
      setPosts(currentPosts => {
        // Safety check
        if (currentPosts.length === 0) {
          console.warn('⚠️ Cannot update posts in handleComplete: posts array is empty')
          return currentPosts
        }
        
        const finalPosts = currentPosts.map((post, index) => {
          const imageKey = `image_${index + 1}`
          const metadata = progress.per_image_metadata[imageKey]
          
          if (metadata) {
            // Update post type dynamically from metadata if available
            const contentType = metadata.content_type || post.type
            return {
              ...post,
              type: contentType as PostType, // Update type dynamically
              imageUrl: metadata.image_url || post.imageUrl,
              tweetText: metadata.tweet_text || post.tweetText,
              text: metadata.tweet_text || post.text || post.tweetText,
              threadArray: metadata.thread_array || post.threadArray || []
            }
          }
          return post
        })
        console.log('✅ Final posts updated:', finalPosts.length, 'posts')
        return finalPosts
      })
    }
  }

  const handleError = (error: string) => {
    setIsGenerating(false)
    setProgressMessage('')
    setProgressPercent(0)
    alert('Generation failed: ' + error)
  }

  const generate = async () => {
    if (!projectId) {
      alert('Project ID not found')
      return
    }

    // Initialize empty posts based on content mix from config
    const emptyPosts: PostData[] = []
    let postIndex = 0
    
    // Add threads
    for (let i = 0; i < contentMix.threads; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'thread',
        text: ''
      })
      postIndex++
    }
    
    // Add shitposts
    for (let i = 0; i < contentMix.shitpost; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'shitpost',
        text: ''
      })
      postIndex++
    }
    
    // Add longposts
    for (let i = 0; i < contentMix.longpost; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'longpost',
        text: ''
      })
      postIndex++
    }
    
    setPosts(emptyPosts)

    setIsGenerating(true)
    setProgressMessage('Starting generation...')
    setProgressPercent(0)
    setGeneratedImages([])
    setPerImageMetadata({})

    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/generate/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error('Failed to start generation')
      }

      const data = await response.json()
      const newJobId = data.job_id

      if (!newJobId) {
        throw new Error('No job ID returned')
      }

      setJobId(newJobId)
      console.log('✅ Generation started with job_id:', newJobId)
      console.log('📋 About to start polling with:', { projectId, newJobId })

      // Start polling after 1 second
      setTimeout(() => {
        console.log('⏰ setTimeout callback executing - starting polling now...')
        console.log('📋 Calling startPolling with:', { projectId, newJobId })
        try {
          const stopFn = startPolling(projectId, newJobId, handleProgress, handleComplete, handleError)
          console.log('✅ startPolling returned, stop function:', typeof stopFn === 'function' ? 'function' : stopFn)
        } catch (error) {
          console.error('❌ Error calling startPolling:', error)
        }
      }, 1000)

    } catch (error) {
      console.error('Generation error:', error)
      setIsGenerating(false)
      setProgressMessage('')
      setProgressPercent(0)
      alert('Error generating posts: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Posts</h1>
          <p className="text-gray-400 mt-1">Generate today's content mix for your project</p>
        </div>
        <button 
          onClick={generate} 
          disabled={isGenerating} 
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Generating...</span>
            </>
          ) : (
            <span>🚀 Generate Today's Posts</span>
          )}
        </button>
      </div>

      {/* Progress Bar */}
      {isGenerating && (
        <div className="mb-6 bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">{progressMessage}</span>
            <span className="text-sm text-blue-400 font-semibold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-indigo-600 to-purple-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Dynamic Grid (2 columns) - Always show if posts exist, even after generation */}
      {/* Number of posts is based on daily_posts_count and content_mix from settings */}
      {posts.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          {posts.map((post, index) => {
          const imageKey = `image_${index + 1}`
          const metadata = perImageMetadata[imageKey]
          const hasImage = generatedImages[index] || metadata?.image_url || post.imageUrl
          const imageUrl = metadata?.image_url || generatedImages[index] || post.imageUrl
          
          // Get dynamic content type from metadata or fall back to post.type
          const displayContentType = metadata?.content_type || post.type

          return (
            <div key={post.id} className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
              {/* Image/Video Section - Clickable */}
              <div 
                className="aspect-square relative bg-gray-700 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => {
                  if (hasImage || metadata?.tweet_text || post.tweetText) {
                    setSelectedPostIndex(index)
                  }
                }}
              >
                {hasImage && imageUrl ? (
                  <SecureImage
                    src={imageUrl}
                    alt={`Post ${index + 1}`}
                    className="w-full h-full object-cover"
                    fallbackComponent={
                      <div className="w-full h-full flex items-center justify-center bg-gray-700">
                        <div className="text-center space-y-2">
                          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          <p className="text-sm text-gray-400">Loading image...</p>
                        </div>
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-700">
                    <div className="text-center space-y-2">
                      {isGenerating ? (
                        <>
                          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          <p className="text-sm text-gray-400">Generating...</p>
                        </>
                      ) : (
                        <>
                          <div className="text-4xl mb-2">📝</div>
                          <p className="text-sm text-gray-400">No content yet</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Content Section */}
              <div className="p-4 space-y-3">
                {/* Post Type Badge - Dynamic based on actual content */}
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300 uppercase font-semibold">
                    {formatPostType(displayContentType)}
                  </span>
                  {isGenerating && !hasImage && (
                    <span className="text-xs text-gray-500 animate-pulse">
                      Generating...
                    </span>
                  )}
                  {hasImage && (
                    <span className="text-xs text-green-500">
                      ✓ Ready
                    </span>
                  )}
                </div>

                {/* Tweet Text Preview - Show progressively as images are generated */}
                {(metadata?.tweet_text || post.tweetText) && (
                  <div className="bg-gray-700/50 rounded-lg p-3">
                    <p className="text-sm text-gray-300 line-clamp-3">
                      {metadata?.tweet_text || post.tweetText}
                    </p>
                    {(metadata?.thread_array && metadata.thread_array.length > 0) || (post.threadArray && post.threadArray.length > 0) ? (
                      <p className="text-xs text-gray-500 mt-1">
                        +{(metadata?.thread_array || post.threadArray || []).length} thread replies
                      </p>
                    ) : null}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button 
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
                    disabled={!hasImage}
                  >
                    Edit
                  </button>
                  <button 
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                    disabled={!hasImage}
                  >
                    Post to 𝕏
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        </div>
      )}
      
      {/* Show empty state if no posts */}
      {posts.length === 0 && !isGenerating && (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-800/30 rounded-xl border border-gray-700">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-white mb-2">No posts generated yet</h3>
          <p className="text-gray-400 mb-6">Click "Generate Today's Posts" to create your content</p>
        </div>
      )}

      {/* Post Detail Modal */}
      {selectedPostIndex !== null && (() => {
        const post = posts[selectedPostIndex]
        const imageKey = `image_${selectedPostIndex + 1}`
        const metadata = perImageMetadata[imageKey]
        const hasImage = generatedImages[selectedPostIndex] || metadata?.image_url || post.imageUrl
        const imageUrl = metadata?.image_url || generatedImages[selectedPostIndex] || post.imageUrl
        const displayContentType = metadata?.content_type || post.type
        const tweetText = metadata?.tweet_text || post.tweetText || post.text || ''
        const threadArray = metadata?.thread_array || post.threadArray || []
        
        return (
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedPostIndex(null)
              }
            }}
          >
            <div className="bg-gray-800 rounded-xl border border-gray-700 w-full h-full max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-700 flex-shrink-0">
                <h2 className="text-xl font-bold text-white">Post Details</h2>
                <button
                  onClick={() => setSelectedPostIndex(null)}
                  className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <XMarkIcon className="h-5 w-5 text-gray-400" />
                </button>
              </div>

              {/* Modal Content - Image on Left, Content on Right */}
              <div className="flex-1 overflow-hidden">
                <div className="flex flex-col md:flex-row h-full">
                  {/* Left Side - Image */}
                  <div className="md:w-3/5 bg-gray-900 flex items-center justify-center overflow-hidden">
                    {hasImage && imageUrl ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <div 
                          className="flex items-center justify-center" 
                          style={{ 
                            width: '100%',
                            aspectRatio: '1 / 1',
                            maxHeight: '100%',
                            maxWidth: '100%'
                          }}
                        >
                          <SecureImage
                            src={imageUrl}
                            alt="Post image"
                            className="w-full h-full rounded-lg object-contain"
                            fallbackComponent={
                              <div className="w-full h-full flex items-center justify-center bg-gray-700 rounded-lg">
                                <div className="text-center space-y-2">
                                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                                  <p className="text-sm text-gray-400">Loading image...</p>
                                </div>
                              </div>
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-gray-400">
                        <div className="text-6xl mb-4">📝</div>
                        <p>No image available</p>
                      </div>
                    )}
                  </div>

                  {/* Right Side - Content */}
                  <div className="md:w-2/5 p-8 overflow-y-auto bg-gray-800">
                    {/* Post Type Badge */}
                    <div className="mb-4">
                      <span className="text-xs px-3 py-1 bg-gray-700 rounded-full text-gray-300 uppercase font-semibold">
                        {displayContentType}
                      </span>
                    </div>

                    {/* Content Display Based on Post Type */}
                    {displayContentType === 'thread' ? (
                      // Thread: Use TweetThreadDisplay
                      <TweetThreadDisplay
                        mainTweet={tweetText}
                        tweetThread={threadArray}
                        showImage={false}
                        className="w-full"
                      />
                    ) : displayContentType === 'longpost' ? (
                      // Longpost: Render markdown
                      <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                        {renderMarkdown(tweetText, { className: 'longpost-content' })}
                      </div>
                    ) : (
                      // Shitpost: Simple text
                      <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                        <div className="text-white text-base leading-relaxed whitespace-pre-wrap break-words">
                          {tweetText}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}


