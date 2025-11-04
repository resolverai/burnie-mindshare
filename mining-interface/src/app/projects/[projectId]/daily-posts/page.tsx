'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'
import SecureImage from '@/components/SecureImage'
import TweetThreadDisplay from '@/components/TweetThreadDisplay'
import VideoPlayer from '@/components/VideoPlayer'
import { renderMarkdown } from '@/utils/markdownParser'
import ScheduleModal from '@/components/projects/ScheduleModal'

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
  videoUrl?: string
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
  const [dailyPostsCount, setDailyPostsCount] = useState<number | null>(null) // Start as null, fetch from config
  const [contentMix, setContentMix] = useState<{threads: number, shitpost: number, longpost: number} | null>(null) // Start as null, fetch from config
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null)
  
  // Token validation state
  const [tokenValidation, setTokenValidation] = useState<{
    oauth2Valid: boolean
    oauth1Valid: boolean
    oauth2ExpiresAt: string | null
    oauth1ExpiresAt: string | null
    needsOAuth2: boolean
    needsOAuth1: boolean
  } | null>(null)
  
  // Authorization and posting state
  const [isAuthorizing, setIsAuthorizing] = useState(false)
  const [isPosting, setIsPosting] = useState<Record<number, boolean>>({})
  const [showScheduleModal, setShowScheduleModal] = useState<number | null>(null)
  const [showReconnectModal, setShowReconnectModal] = useState<number | null>(null)
  
  // Video URLs from metadata
  const [videoUrls, setVideoUrls] = useState<Record<number, string>>({})
  const [videoImageIndex, setVideoImageIndex] = useState<number | null>(null) // Track which post index is generating video (1-based)
  
  // Schedule state - maps post index to schedule info
  const [postSchedules, setPostSchedules] = useState<Record<number, {
    scheduleId: number
    scheduledAt: string
    mediaS3Url: string
    mediaType: 'image' | 'video'
    tweetText?: {
      main_tweet: string
      thread_array?: string[]
      content_type: 'thread' | 'shitpost' | 'longpost'
    }
  } | null>>({})

  // Fetch configurations on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl || !projectId) return
        
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const response = await fetch(`${apiUrl}/projects/${projectId}/configurations?user_timezone=${encodeURIComponent(userTimezone)}`)
        
        if (response.ok) {
          // The endpoint returns the config directly (not wrapped in { success, data })
          const config = await response.json()
          
          // Check if response is an error object
          if (!config.error) {
            // Only set if we have valid values (not null/undefined)
            if (config.daily_posts_count != null) {
              setDailyPostsCount(config.daily_posts_count)
            }
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

  // Validate tokens on mount and when posts change
  useEffect(() => {
    const validateTokens = async () => {
      if (!projectId) return
      
      try {
        const apiUrl = getApiUrlWithFallback()
        const response = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            setTokenValidation(data.data)
          }
        }
      } catch (error) {
        console.error('Error validating tokens:', error)
      }
    }
    
    validateTokens()
  }, [projectId, posts])

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
    
    // Extract video_image_index from workflow_metadata (1-based index)
    if (progress.workflow_metadata?.video_image_index) {
      setVideoImageIndex(progress.workflow_metadata.video_image_index)
    }
    
    // Update generated images progressively
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      console.log('🖼️ Updating generated images:', progress.generated_image_urls.length, 'images')
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Update per_image_metadata (even if no images yet)
    if (progress.per_image_metadata) {
      console.log('📊 Updating per_image_metadata, keys:', Object.keys(progress.per_image_metadata))
      setPerImageMetadata(progress.per_image_metadata)
      
      // Check for video URLs in progress (video metadata is keyed by image index that has video)
      if (progress.per_video_metadata) {
        const videoUrlMap: Record<number, string> = {}
        Object.entries(progress.per_video_metadata).forEach(([key, metadata]: [string, any]) => {
          // Video metadata keys might be "image_3" or similar - extract the index
          const match = key.match(/image_(\d+)/)
          if (match && metadata?.video_url) {
            const index = parseInt(match[1]) - 1
            videoUrlMap[index] = metadata.video_url
          }
        })
        if (Object.keys(videoUrlMap).length > 0) {
          setVideoUrls(prev => ({ ...prev, ...videoUrlMap }))
        }
      }
      
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
              videoUrl: progress.per_video_metadata?.[imageKey]?.video_url || post.videoUrl,
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
    
    // Extract video_image_index from workflow_metadata if not already set
    if (progress.workflow_metadata?.video_image_index) {
      setVideoImageIndex(progress.workflow_metadata.video_image_index)
    }
    
    // Final update with all images and metadata
    if (progress.generated_image_urls) {
      console.log('🖼️ Final images update:', progress.generated_image_urls.length, 'images')
      setGeneratedImages(progress.generated_image_urls)
    }
    
    if (progress.per_image_metadata) {
      console.log('📊 Final metadata update, keys:', Object.keys(progress.per_image_metadata))
      setPerImageMetadata(progress.per_image_metadata)
      
      // Check for video URLs in progress
      if (progress.per_video_metadata) {
        const videoUrlMap: Record<number, string> = {}
        Object.entries(progress.per_video_metadata).forEach(([key, metadata]: [string, any]) => {
          const match = key.match(/image_(\d+)/)
          if (match && metadata?.video_url) {
            const index = parseInt(match[1]) - 1
            videoUrlMap[index] = metadata.video_url
          }
        })
        if (Object.keys(videoUrlMap).length > 0) {
          setVideoUrls(prev => ({ ...prev, ...videoUrlMap }))
        }
      }
      
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
              videoUrl: progress.per_video_metadata?.[imageKey]?.video_url || post.videoUrl,
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

  // Get button label for Post on X button
  const getPostButtonLabel = (postIndex: number): 'Post on X' | 'Reconnect X' => {
    if (!tokenValidation) return 'Reconnect X'
    
    const post = posts[postIndex]
    const hasVideo = !!(post?.videoUrl || videoUrls[postIndex])
    
    if (hasVideo) {
      // For video, both tokens must be valid
      if (tokenValidation.oauth2Valid && tokenValidation.oauth1Valid) {
        return 'Post on X'
      }
      return 'Reconnect X'
    } else {
      // For image, only OAuth2 is needed
      if (tokenValidation.oauth2Valid) {
        return 'Post on X'
      }
      return 'Reconnect X'
    }
  }

  // Handle OAuth2 authorization
  const handleOAuth2Auth = async () => {
    if (!projectId || isAuthorizing) return
    
    setIsAuthorizing(true)
    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/twitter-auth/oauth2/initiate`, {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data?.oauth_url) {
          // Open OAuth modal in new window (similar to project sign-in flow)
          const authWindow = window.open(data.data.oauth_url, 'twitter-auth', 'width=600,height=700')
          
          // Listen for OAuth callback via URL params
          const checkAuthComplete = setInterval(() => {
            try {
              if (authWindow?.closed) {
                clearInterval(checkAuthComplete)
                setIsAuthorizing(false)
                
                // Re-validate tokens
                setTimeout(() => {
                  const validateTokens = async () => {
                    const validateResponse = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
                    if (validateResponse.ok) {
                      const validateData = await validateResponse.json()
                      if (validateData.success) {
                        setTokenValidation(validateData.data)
                      }
                    }
                  }
                  validateTokens()
                }, 2000)
              }
            } catch (error) {
              console.error('Error checking auth window:', error)
            }
          }, 1000)
          
          // Cleanup interval after 5 minutes
          setTimeout(() => clearInterval(checkAuthComplete), 300000)
        }
      }
    } catch (error) {
      console.error('Error initiating OAuth2:', error)
      setIsAuthorizing(false)
      alert('Failed to start Twitter authorization')
    }
  }

  // Handle OAuth1 authorization (for video)
  const handleOAuth1Auth = async () => {
    if (!projectId || isAuthorizing) return
    
    setIsAuthorizing(true)
    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/twitter-auth/oauth1/initiate`, {
        method: 'POST'
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data?.authUrl) {
          // Open OAuth1 modal
          const authWindow = window.open(data.data.authUrl, 'twitter-oauth1-auth', 'width=600,height=700')
          
          // Store sessionId for callback
          const sessionId = data.data.sessionId
          
          // Listen for callback (OAuth1 uses PIN/verifier)
          const checkAuthComplete = setInterval(() => {
            try {
              if (authWindow?.closed) {
                clearInterval(checkAuthComplete)
                setIsAuthorizing(false)
                
                // OAuth1 callback will be handled separately via callback endpoint
                // Re-validate tokens after a delay
                setTimeout(() => {
                  const validateTokens = async () => {
                    const validateResponse = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
                    if (validateResponse.ok) {
                      const validateData = await validateResponse.json()
                      if (validateData.success) {
                        setTokenValidation(validateData.data)
                      }
                    }
                  }
                  validateTokens()
                }, 2000)
              }
            } catch (error) {
              console.error('Error checking auth window:', error)
            }
          }, 1000)
          
          setTimeout(() => clearInterval(checkAuthComplete), 300000)
        }
      }
    } catch (error) {
      console.error('Error initiating OAuth1:', error)
      setIsAuthorizing(false)
      alert('Failed to start Twitter OAuth1 authorization')
    }
  }

  // Handle Reconnect X button click
  // When called from 401 error, we trust the backend and start OAuth directly
  // Don't refresh validation here - backend already tested the token and said it's invalid
  const handleReconnectClick = async (postIndex: number, forceReconnect: boolean = false) => {
    console.log('🔄 handleReconnectClick called for post index:', postIndex, 'forceReconnect:', forceReconnect)
    
    const post = posts[postIndex]
    const hasVideo = !!(post?.videoUrl || videoUrls[postIndex])
    
    console.log('🔍 Reconnect flow - hasVideo:', hasVideo)
    
    // If forceReconnect is true (from 401 error), skip validation check and start OAuth directly
    if (forceReconnect) {
      console.log('🔐 Force reconnect mode - starting OAuth flow directly (backend confirmed token invalid)')
      
      if (hasVideo) {
        // Video: Need both OAuth2 and OAuth1
        // Start OAuth2 first, then OAuth1 will be triggered after OAuth2 completes
        console.log('🎬 Video content - starting OAuth2 (OAuth1 will follow)...')
        await handleOAuth2Auth()
      } else {
        // Image only: OAuth2 only
        console.log('🖼️ Image content - starting OAuth2...')
        await handleOAuth2Auth()
      }
      return
    }
    
    // Otherwise, check validation first (for manual reconnect button clicks)
    const apiUrl = getApiUrlWithFallback()
    try {
      const validateResponse = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
      if (validateResponse.ok) {
        const validateData = await validateResponse.json()
        if (validateData.success) {
          setTokenValidation(validateData.data)
          console.log('📋 Refreshed token validation:', validateData.data)
        }
      }
    } catch (error) {
      console.error('Error refreshing token validation:', error)
    }
    
    console.log('🔍 Reconnect flow - tokenValidation:', tokenValidation)
    
    // Determine which auth flows are needed based on validation
    if (hasVideo) {
      // Video: Need both OAuth2 and OAuth1
      const needsOAuth2 = !tokenValidation?.oauth2Valid
      const needsOAuth1 = !tokenValidation?.oauth1Valid
      
      console.log('🎬 Video content - needsOAuth2:', needsOAuth2, 'needsOAuth1:', needsOAuth1)
      
      if (needsOAuth2 && needsOAuth1) {
        // Both invalid: Start OAuth2, then auto-start OAuth1
        console.log('🔐 Starting OAuth2 (both tokens invalid)...')
        await handleOAuth2Auth()
      } else if (needsOAuth2) {
        // Only OAuth2 invalid
        console.log('🔐 Starting OAuth2 only...')
        await handleOAuth2Auth()
      } else if (needsOAuth1) {
        // Only OAuth1 invalid
        console.log('🔐 Starting OAuth1 only...')
        await handleOAuth1Auth()
      } else {
        console.log('✅ Both tokens valid, no reconnect needed')
      }
    } else {
      // Image only: OAuth2 only
      const needsOAuth2 = !tokenValidation?.oauth2Valid
      console.log('🖼️ Image content - needsOAuth2:', needsOAuth2)
      
      if (needsOAuth2 || !tokenValidation) {
        // OAuth2 invalid or validation not available - start OAuth2
        console.log('🔐 Starting OAuth2 for image...')
        await handleOAuth2Auth()
      } else {
        console.log('✅ OAuth2 token valid, no reconnect needed')
      }
    }
  }

  // Handle Post on X button click
  const handlePostToX = async (postIndex: number) => {
    const post = posts[postIndex]
    if (!post || (!post.imageUrl && !post.videoUrl && !videoUrls[postIndex])) return
    
    setIsPosting(prev => ({ ...prev, [postIndex]: true }))
    
    try {
      const apiUrl = getApiUrlWithFallback()
      const metadata = perImageMetadata[`image_${postIndex + 1}`]
      const tweetText = metadata?.tweet_text || post.tweetText || post.text || ''
      const threadArray = metadata?.thread_array || post.threadArray || []
      const imageUrl = post.imageUrl
      const videoUrl = post.videoUrl || videoUrls[postIndex]
      
      const response = await fetch(`${apiUrl}/projects/${projectId}/twitter/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mainTweet: tweetText,
          thread: threadArray,
          imageUrl: imageUrl,
          videoUrl: videoUrl
        })
      })
      
      // Handle non-OK responses (including 401)
      if (!response.ok) {
        let errorResult
        try {
          errorResult = await response.json()
        } catch (e) {
          // If response is not JSON, create error object
          errorResult = {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            requiresAuth: response.status === 401
          }
        }
        
        // Check for auth-related errors (401, 403, or requiresAuth flag)
        if (response.status === 401 || response.status === 403 || errorResult.requiresAuth || errorResult.requiresReauth) {
          console.log('🔄 Authentication required, triggering reconnect flow...')
          console.log('📋 Error result:', errorResult)
          console.log('📋 Response status:', response.status)
          console.log('🔐 Backend confirmed token is invalid - starting OAuth flow directly (skipping validation check)')
          // Backend already tested the token and returned 401 - trust it and force reconnect
          // Don't check validation again as it might give false positives
          await handleReconnectClick(postIndex, true) // forceReconnect = true
          return
        }
        
        alert(`Failed to post: ${errorResult.error || 'Unknown error'}`)
        return
      }
      
      const result = await response.json()
      
      if (result.success) {
        alert(`✅ Posted to Twitter! View: ${result.data?.tweetUrl || 'Tweet posted successfully'}`)
        // Optionally refresh token validation
        const validateResponse = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
        if (validateResponse.ok) {
          const validateData = await validateResponse.json()
          if (validateData.success) {
            setTokenValidation(validateData.data)
          }
        }
      } else {
        // Handle success: false responses
        if (result.requiresAuth || result.requiresReauth) {
          // Trigger reconnection flow (force reconnect since backend confirmed auth is needed)
          console.log('🔐 Backend requires auth - starting OAuth flow directly')
          await handleReconnectClick(postIndex, true) // forceReconnect = true
        } else {
          alert(`Failed to post: ${result.error || 'Unknown error'}`)
        }
      }
    } catch (error) {
      console.error('Error posting to Twitter:', error)
      alert('Failed to post to Twitter. Please try again.')
    } finally {
      setIsPosting(prev => ({ ...prev, [postIndex]: false }))
    }
  }

  // Handle Schedule button click
  // Helper to extract S3 URL from a URL (handles presigned URLs)
  const extractS3Url = (url: string | undefined): string | null => {
    if (!url) return null
    
    // If it's a fal.media URL, return null (no schedule for these)
    if (url.includes('fal.media')) {
      return null
    }
    
    // If it's already an S3 URL (s3:// or s3.amazonaws.com)
    if (url.includes('s3.amazonaws.com')) {
      // Extract bucket and key from presigned URL or regular S3 URL
      // Pattern: https://s3.amazonaws.com/BUCKET/KEY?query or https://BUCKET.s3.amazonaws.com/KEY
      let bucket = ''
      let key = ''
      
      // Try pattern: s3.amazonaws.com/BUCKET/KEY
      const match1 = url.match(/s3\.amazonaws\.com\/([^\/]+)\/(.+?)(\?|$)/)
      if (match1) {
        bucket = match1[1]
        key = match1[2]
      } else {
        // Try pattern: BUCKET.s3.amazonaws.com/KEY
        const match2 = url.match(/([^\.]+)\.s3\.amazonaws\.com\/(.+?)(\?|$)/)
        if (match2) {
          bucket = match2[1]
          key = match2[2]
        }
      }
      
      if (bucket && key) {
        // Return normalized S3 URL (bucket/key format for consistent lookups)
        return `s3://${bucket}/${key}`
      }
    }
    
    // If it's an s3:// URL, return as-is
    if (url.startsWith('s3://')) {
      return url
    }
    
    return null
  }

  // Fetch schedule for a specific post by media S3 URL
  const fetchSchedule = async (postIndex: number, mediaS3Url: string | null) => {
    if (!mediaS3Url || !projectId) return
    
    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/post/schedule?mediaS3Url=${encodeURIComponent(mediaS3Url)}`)
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          setPostSchedules(prev => ({
            ...prev,
            [postIndex]: data.data
          }))
        } else {
          setPostSchedules(prev => ({
            ...prev,
            [postIndex]: null
          }))
        }
      }
    } catch (error) {
      console.error('Error fetching schedule:', error)
    }
  }

  // Fetch schedules for all posts when they're updated
  useEffect(() => {
    posts.forEach((post, index) => {
      const videoUrl = videoUrls[index]
      // Use the same priority order as in the modal: metadata first, then generatedImages, then post.imageUrl
      const imageKey = `image_${index + 1}`
      const metadata = perImageMetadata[imageKey]
      const imageUrl = metadata?.image_url || generatedImages[index] || post.imageUrl
      
      // Prioritize video URL if exists, otherwise use image URL
      const mediaUrl = videoUrl || imageUrl
      const mediaS3Url = extractS3Url(mediaUrl)
      
      if (mediaS3Url && !postSchedules[index]) {
        fetchSchedule(index, mediaS3Url)
      }
    })
  }, [posts, videoUrls, generatedImages, perImageMetadata, projectId])

  const handleScheduleClick = (postIndex: number) => {
    setShowScheduleModal(postIndex)
  }

  // Handle Edit button click (placeholder for now)
  const handleEditClick = (postIndex: number) => {
    // TODO: Implement edit flow
    alert('Edit functionality coming soon!')
  }

  // Handle OAuth2 callback (check URL params)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    
    // Check for OAuth errors first
    const oauthError = urlParams.get('oauth2_error')
    if (oauthError) {
      console.error('❌ OAuth2 error:', oauthError)
      alert(`Twitter authorization failed: ${oauthError.replace(/_/g, ' ')}. Please try again.`)
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
      return
    }
    
    if (urlParams.get('oauth2_success') === 'true') {
      // OAuth2 completed, if video content exists, start OAuth1
      const hasAnyVideo = posts.some((post, idx) => post.videoUrl || videoUrls[idx])
      if (hasAnyVideo && tokenValidation?.needsOAuth1) {
        setTimeout(() => {
          handleOAuth1Auth()
        }, 1000)
      }
      
      // Re-validate tokens
      const validateTokens = async () => {
        const apiUrl = getApiUrlWithFallback()
        const response = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setTokenValidation(data.data)
          }
        }
      }
      validateTokens()
      
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, posts, videoUrls, tokenValidation])

  const generate = async () => {
    if (!projectId) {
      alert('Project ID not found')
      return
    }

    // Fetch fresh configuration before generating to ensure we have the latest values
    // This is REQUIRED - don't proceed without valid config
    let currentDailyPostsCount: number | null = null
    let currentContentMix: {threads: number, shitpost: number, longpost: number} | null = null
    
    try {
      const apiUrl = getApiUrlWithFallback()
      if (!apiUrl) {
        alert('API URL not configured. Please check your environment settings.')
        return
      }
      
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const response = await fetch(`${apiUrl}/projects/${projectId}/configurations?user_timezone=${encodeURIComponent(userTimezone)}`)
      
      if (!response.ok) {
        alert(`Failed to fetch project configuration: ${response.statusText}`)
        return
      }
      
      // The endpoint returns the config directly (not wrapped in { success, data })
      const config = await response.json()
      
      // Check if response is an error object
      if (config.error) {
        alert(`Failed to fetch configuration: ${config.error}`)
        return
      }
      
      // Validate that we have required config values
      if (config.daily_posts_count == null || config.daily_posts_count < 1) {
        alert(`Invalid daily_posts_count in configuration: ${config.daily_posts_count}. Please configure it in project settings.`)
        return
      }
      
      if (!config.content_mix || typeof config.content_mix !== 'object') {
        alert('Invalid content_mix in configuration. Please configure it in project settings.')
        return
      }
      
      currentDailyPostsCount = config.daily_posts_count
      currentContentMix = config.content_mix
      
      // Update state for future renders
      setDailyPostsCount(currentDailyPostsCount)
      setContentMix(currentContentMix)
      
    } catch (error) {
      console.error('Error fetching fresh config before generation:', error)
      alert(`Failed to fetch configuration: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return // Don't proceed without valid config
    }
    
    // Final validation - ensure we have valid values
    if (currentDailyPostsCount == null || currentContentMix == null) {
      alert('Configuration incomplete. Please configure daily posts count and content mix in project settings.')
      return
    }

    // Initialize empty posts based EXACTLY on daily_posts_count and content mix from config
    // The content mix should match daily_posts_count, but if it doesn't, we'll use proportional distribution
    const contentMixSum = currentContentMix.threads + currentContentMix.shitpost + currentContentMix.longpost
    
    console.log(`📊 Initializing posts:`, {
      dailyPostsCount: currentDailyPostsCount,
      contentMix: currentContentMix,
      contentMixSum
    })
    
    const emptyPosts: PostData[] = []
    let postIndex = 0
    
    // Always use content mix values directly - they should match daily_posts_count
    // Add threads
    for (let i = 0; i < currentContentMix.threads; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'thread',
        text: ''
      })
      postIndex++
    }
    
    // Add shitposts
    for (let i = 0; i < currentContentMix.shitpost; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'shitpost',
        text: ''
      })
      postIndex++
    }
    
    // Add longposts
    for (let i = 0; i < currentContentMix.longpost; i++) {
      emptyPosts.push({
        id: `post-${postIndex + 1}`,
        type: 'longpost',
        text: ''
      })
      postIndex++
    }
    
    // Verify final count matches daily_posts_count exactly
    const finalPostCount = emptyPosts.length
    if (finalPostCount !== currentDailyPostsCount) {
      console.warn(`⚠️ Content mix sum (${finalPostCount}) doesn't match daily_posts_count (${currentDailyPostsCount})`)
      console.warn(`   Adjusting to match daily_posts_count (${currentDailyPostsCount})`)
      
      // Trim or pad to match daily_posts_count EXACTLY
      if (finalPostCount > currentDailyPostsCount) {
        // Remove excess posts (keep first N)
        emptyPosts.splice(currentDailyPostsCount)
        console.log(`   Trimmed ${finalPostCount - currentDailyPostsCount} excess posts`)
      } else {
        // Pad with threads to match daily_posts_count
        while (emptyPosts.length < currentDailyPostsCount) {
          emptyPosts.push({
            id: `post-${emptyPosts.length + 1}`,
            type: 'thread',
            text: ''
          })
        }
        console.log(`   Added ${currentDailyPostsCount - finalPostCount} posts to match daily_posts_count`)
      }
    }
    
    const verifiedPostCount = emptyPosts.length
    console.log(`✅ Setting ${verifiedPostCount} empty posts for generation (matches daily_posts_count: ${currentDailyPostsCount})`)
    setPosts(emptyPosts)

    setIsGenerating(true)
    setProgressMessage('Starting generation...')
    setProgressPercent(0)
    setGeneratedImages([])
    setPerImageMetadata({})
    setVideoImageIndex(null) // Reset video index when starting new generation
    setVideoUrls({}) // Reset video URLs

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
          
          // Check if this post index is generating video (videoImageIndex is 1-based, index is 0-based)
          const isVideoPost = videoImageIndex === (index + 1)
          const hasVideo = !!(post?.videoUrl || videoUrls[index])
          const videoUrl = post?.videoUrl || videoUrls[index]
          // Show video generation indicator if: this is the video post AND video is not ready yet AND we're still generating
          const isGeneratingVideo = isVideoPost && !hasVideo && isGenerating
          
          // Debug logging
          if (isVideoPost) {
            console.log(`🎬 Post ${index + 1} is video post:`, {
              videoImageIndex,
              hasVideo,
              isGenerating,
              isGeneratingVideo,
              videoUrl: videoUrl ? 'has URL' : 'no URL'
            })
          }
          
          // Get dynamic content type from metadata or fall back to post.type
          const displayContentType = metadata?.content_type || post.type

          return (
            <div key={post.id} className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
              {/* Image/Video Section - Clickable */}
              <div 
                className="aspect-square relative bg-gray-700 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  if (hasImage || hasVideo || metadata?.tweet_text || post.tweetText) {
                    setSelectedPostIndex(index)
                  }
                }}
                onTouchStart={(e) => {
                  // Ensure touch events work on mobile
                  e.stopPropagation()
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation()
                  if (hasImage || hasVideo || metadata?.tweet_text || post.tweetText) {
                    setSelectedPostIndex(index)
                  }
                }}
              >
                {/* Scheduled Badge */}
                {postSchedules[index] && (
                  <div className="absolute top-2 left-2 bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded-full z-10">
                    Scheduled
                  </div>
                )}
                
                {/* Show VideoPlayer if video is available */}
                {hasVideo && videoUrl ? (
                  <>
                    <VideoPlayer
                      src={videoUrl}
                      className="w-full h-full"
                      controls={true}
                      muted={false}
                      loop={false}
                    />
                    {/* Video Icon Overlay */}
                    <div className="absolute top-2 right-2 bg-black/70 rounded-full p-2">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                  </>
                ) : hasImage && imageUrl ? (
                  <>
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
                    {/* Show "Video is being generated" indicator overlay if this is the video post */}
                    {isGeneratingVideo && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
                        <div className="text-center space-y-2">
                          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          <p className="text-sm text-white font-semibold">Video is being generated...</p>
                        </div>
                      </div>
                    )}
                  </>
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
                  {/* Status indicators */}
                  {isGeneratingVideo && (
                    <span className="text-xs text-purple-400 animate-pulse flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      Generating video...
                    </span>
                  )}
                  {!isGeneratingVideo && isGenerating && !hasImage && !hasVideo && (
                    <span className="text-xs text-gray-500 animate-pulse">
                      Generating...
                    </span>
                  )}
                  {hasVideo && (
                    <span className="text-xs text-purple-500 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      Video Ready
                    </span>
                  )}
                  {hasImage && !hasVideo && !isGeneratingVideo && (
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
                    onClick={() => handleEditClick(index)}
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
                    disabled={!hasImage && !post.videoUrl && !videoUrls[index]}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleScheduleClick(index)}
                    className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                    disabled={!hasImage && !post.videoUrl && !videoUrls[index]}
                  >
                    Schedule
                  </button>
                  <button 
                    onClick={() => {
                      const label = getPostButtonLabel(index)
                      if (label === 'Reconnect X') {
                        handleReconnectClick(index)
                      } else {
                        handlePostToX(index)
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                    disabled={(!hasImage && !post.videoUrl && !videoUrls[index]) || isPosting[index] || isAuthorizing}
                  >
                    {isPosting[index] ? 'Posting...' : getPostButtonLabel(index)}
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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedPostIndex(null)
              }
            }}
          >
            <div className="bg-gray-800 rounded-xl border border-gray-700 w-full h-full max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-700 flex-shrink-0">
                <h2 className="text-lg md:text-xl font-bold text-white">Post Details</h2>
                <button
                  onClick={() => setSelectedPostIndex(null)}
                  className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                  aria-label="Close modal"
                >
                  <XMarkIcon className="h-5 w-5 text-gray-400" />
                </button>
              </div>

              {/* Schedule Info Banner */}
              {postSchedules[selectedPostIndex] && (
                <div className="bg-green-500/10 border-b border-green-500/30 px-4 md:px-6 py-3 flex-shrink-0">
                  <p className="text-sm text-green-300">
                    📅 This post is scheduled to be posted on Twitter on{' '}
                    <span className="font-semibold">
                      {new Date(postSchedules[selectedPostIndex]!.scheduledAt).toLocaleString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </span>
                  </p>
                </div>
              )}

              {/* Modal Content - Image on Left, Content on Right */}
              <div className="flex-1 overflow-hidden">
                <div className="flex flex-col md:flex-row h-full">
                  {/* Left Side - Image/Video */}
                  <div className="w-full md:w-3/5 bg-gray-900 flex items-center justify-center overflow-hidden" style={{ minHeight: 0 }}>
                    {(() => {
                      const modalImageKey = `image_${selectedPostIndex + 1}`
                      const modalMetadata = perImageMetadata[modalImageKey]
                      const modalHasImage = generatedImages[selectedPostIndex] || modalMetadata?.image_url || post.imageUrl
                      const modalImageUrl = modalMetadata?.image_url || generatedImages[selectedPostIndex] || post.imageUrl
                      const modalHasVideo = !!(post?.videoUrl || videoUrls[selectedPostIndex])
                      const modalVideoUrl = post?.videoUrl || videoUrls[selectedPostIndex]
                      
                      // Show video if available, otherwise show image
                      if (modalHasVideo && modalVideoUrl) {
                        return (
                          <div className="w-full h-full flex items-center justify-center p-2 md:p-4" style={{ minHeight: 0 }}>
                            <div className="w-full h-full max-w-full max-h-full relative flex items-center justify-center" style={{ minHeight: 0 }}>
                              <VideoPlayer
                                key={`${selectedPostIndex}-${modalVideoUrl}`}
                                src={modalVideoUrl}
                                className="w-full h-full rounded-lg"
                                controls={true}
                                muted={false}
                                loop={false}
                              />
                              {/* Video Icon Overlay */}
                              <div className="absolute top-2 right-2 bg-black/70 rounded-full p-2 z-10 pointer-events-none">
                                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            </div>
                          </div>
                        )
                      } else if (modalHasImage && modalImageUrl) {
                        return (
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
                                src={modalImageUrl}
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
                        )
                      } else {
                        return (
                          <div className="text-center text-gray-400">
                            <div className="text-6xl mb-4">📝</div>
                            <p>No content available</p>
                          </div>
                        )
                      }
                    })()}
                  </div>

                  {/* Right Side - Content */}
                  <div className="w-full md:w-2/5 p-4 md:p-8 overflow-y-auto bg-gray-800" style={{ minHeight: 0 }}>
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

      {/* Schedule Modal */}
      {showScheduleModal !== null && posts[showScheduleModal] && (() => {
        const postIndex = showScheduleModal
        const post = posts[postIndex]
        const videoUrl = videoUrls[postIndex]
        const imageKey = `image_${postIndex + 1}`
        const metadata = perImageMetadata[imageKey]
        const imageUrl = metadata?.image_url || generatedImages[postIndex] || post.imageUrl
        
        // Prioritize video URL if exists, otherwise use image URL
        const mediaUrl = videoUrl || imageUrl
        const mediaS3Url = extractS3Url(mediaUrl)
        const mediaType = videoUrl ? 'video' : 'image'
        const schedule = postSchedules[postIndex] || null
        
        return (
          <ScheduleModal
            isOpen={showScheduleModal !== null}
            onClose={() => setShowScheduleModal(null)}
            projectId={projectId}
            mediaS3Url={mediaS3Url || ''}
            mediaType={mediaType}
            tweetText={{
              main_tweet: post.tweetText || post.text || metadata?.tweet_text || '',
              thread_array: post.threadArray || metadata?.thread_array || [],
              content_type: post.type || metadata?.content_type || 'shitpost'
            }}
            currentSchedule={schedule}
          />
        )
      })()}
    </div>
  )
}


