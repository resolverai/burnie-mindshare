'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import { XMarkIcon, MagnifyingGlassIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'
import SecureImage from '@/components/SecureImage'
import TweetThreadDisplay from '@/components/TweetThreadDisplay'
import VideoPlayer from '@/components/VideoPlayer'
import { renderMarkdown } from '@/utils/markdownParser'
import ScheduleModal from '@/components/projects/ScheduleModal'

interface ContentItem {
  id: number
  job_id: string
  created_at: string
  generated_image_urls: string[]
  generated_video_urls?: string[]
  per_image_metadata: Record<string, {
    image_url: string
    tweet_text?: string
    thread_array?: string[]
    content_type?: string
  }>
  per_video_metadata?: Record<string, {
    video_url?: string
    watermark_video_url?: string
    image_index?: number
    [key: string]: any
  }>
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

export default function ProjectMyContentPage() {
  const params = useParams()
  const projectId = params.projectId as string
  
  const [content, setContent] = useState<Record<string, ContentItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [postTypeFilter, setPostTypeFilter] = useState<string>('all')
  const [selectedPostIndex, setSelectedPostIndex] = useState<{ date: string; index: number; postData?: { item: ContentItem; imageIndex: number; imageUrl: string | null; postType: string; tweetText: string; threadArray: string[]; videoUrl?: string | null } } | null>(null)
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalDates: 0 })
  
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
  const [isPosting, setIsPosting] = useState(false)
  
  // Schedule state
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [postSchedules, setPostSchedules] = useState<Record<string, {
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

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
      setPage(1) // Reset to first page on search
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [postTypeFilter])

  // Fetch content
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true)
      setError(null)
      
      try {
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          throw new Error('API URL not configured')
        }

        const queryParams = new URLSearchParams({
          page: page.toString(),
          limitDates: '3'
          // No limitPerDate - backend returns all posts for each date
        })
        
        if (debouncedSearchTerm) {
          queryParams.append('search', debouncedSearchTerm)
        }
        
        if (postTypeFilter && postTypeFilter !== 'all') {
          queryParams.append('postType', postTypeFilter)
        }

        const response = await fetch(`${apiUrl}/projects/${projectId}/content?${queryParams}`)
        
        if (!response.ok) {
          throw new Error(`Failed to fetch content: ${response.statusText}`)
        }

        const data = await response.json()
        
        if (data.success) {
          setContent(data.data || {})
          setPagination(data.pagination || { page: 1, totalPages: 1, totalDates: 0 })
        } else {
          throw new Error(data.error || 'Failed to fetch content')
        }
      } catch (err) {
        console.error('Error fetching content:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch content')
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      fetchContent()
    }
  }, [projectId, page, debouncedSearchTerm, postTypeFilter])

  // Note: Content is displayed grouped by date, not flattened

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  // Get post type from metadata
  const getPostType = (item: ContentItem, index: number): string => {
    const imageKey = `image_${index + 1}`
    const metadata = item.per_image_metadata?.[imageKey]
    return metadata?.content_type || 'post'
  }

  // Get tweet text from metadata
  const getTweetText = (item: ContentItem, index: number): string => {
    const imageKey = `image_${index + 1}`
    const metadata = item.per_image_metadata?.[imageKey]
    return metadata?.tweet_text || ''
  }

  // Get thread array from metadata
  const getThreadArray = (item: ContentItem, index: number): string[] => {
    const imageKey = `image_${index + 1}`
    const metadata = item.per_image_metadata?.[imageKey]
    return metadata?.thread_array || []
  }

  // Get image URL
  const getImageUrl = (item: ContentItem, index: number): string | null => {
    const imageKey = `image_${index + 1}`
    const metadata = item.per_image_metadata?.[imageKey]
    return metadata?.image_url || item.generated_image_urls?.[index] || null
  }

  // Get video URL for a specific image index
  const getVideoUrl = (item: ContentItem, index: number): string | null => {
    const imageKey = `image_${index + 1}`
    const videoMetadata = item.per_video_metadata?.[imageKey]
    return videoMetadata?.video_url || null
  }

  // Validate tokens on mount
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
  }, [projectId])

  // Get button label for Post on X button
  const getPostButtonLabel = (postData: { videoUrl?: string | null }): 'Post on X' | 'Reconnect X' => {
    if (!tokenValidation) return 'Reconnect X'
    
    const hasVideo = !!postData.videoUrl
    
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
          // Open OAuth modal in new window
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
          
          // Listen for callback
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
  const handleReconnectClick = async (postData: { videoUrl?: string | null; imageUrl?: string | null }, forceReconnect: boolean = false) => {
    console.log('🔄 handleReconnectClick called for post data:', postData, 'forceReconnect:', forceReconnect)
    
    const hasVideo = !!postData.videoUrl
    const hasImage = !!postData.imageUrl
    
    console.log('🔍 Reconnect flow - hasVideo:', hasVideo, 'hasImage:', hasImage)
    
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
  const handlePostToX = async (postData: { imageUrl: string | null; videoUrl: string | null; tweetText: string; threadArray: string[]; postType: string }) => {
    if (!postData.imageUrl && !postData.videoUrl) return
    
    setIsPosting(true)
    
    try {
      const apiUrl = getApiUrlWithFallback()
      
      const response = await fetch(`${apiUrl}/projects/${projectId}/twitter/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mainTweet: postData.tweetText,
          thread: postData.threadArray,
          imageUrl: postData.imageUrl,
          videoUrl: postData.videoUrl
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
          await handleReconnectClick(postData, true) // forceReconnect = true
          return
        }
        
        alert(`Failed to post: ${errorResult.error || 'Unknown error'}`)
        return
      }
      
      const result = await response.json()
      
      if (result.success) {
        alert(`✅ Posted to Twitter! View: ${result.data?.tweetUrl || 'Tweet posted successfully'}`)
        // Re-validate tokens
        const validateResponse = await fetch(`${apiUrl}/projects/${projectId}/twitter-tokens/validate`)
        if (validateResponse.ok) {
          const validateData = await validateResponse.json()
          if (validateData.success) {
            setTokenValidation(validateData.data)
          }
        }
      } else {
        if (result.requiresAuth || result.requiresReauth) {
          // Trigger reconnection flow (force reconnect since backend confirmed auth is needed)
          console.log('🔐 Backend requires auth - starting OAuth flow directly')
          await handleReconnectClick({ videoUrl: postData.videoUrl, imageUrl: postData.imageUrl }, true) // forceReconnect = true
        } else {
          alert(`Failed to post: ${result.error}`)
        }
      }
    } catch (error) {
      console.error('Error posting to Twitter:', error)
      alert('Failed to post to Twitter. Please try again.')
    } finally {
      setIsPosting(false)
    }
  }

  // Helper to extract S3 URL from a URL (handles presigned URLs)
  const extractS3Url = (url: string | undefined | null): string | null => {
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
  const fetchSchedule = async (scheduleKey: string, mediaS3Url: string | null) => {
    if (!mediaS3Url || !projectId) return
    
    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/post/schedule?mediaS3Url=${encodeURIComponent(mediaS3Url)}`)
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          setPostSchedules(prev => ({
            ...prev,
            [scheduleKey]: data.data
          }))
        } else {
          setPostSchedules(prev => ({
            ...prev,
            [scheduleKey]: null
          }))
        }
      }
    } catch (error) {
      console.error('Error fetching schedule:', error)
    }
  }

  // Fetch schedules for all posts when content is loaded
  useEffect(() => {
    Object.entries(content).forEach(([date, items]) => {
      items.forEach((item, itemIndex) => {
        Object.entries(item.per_image_metadata || {}).forEach(([imageKey, metadata]: [string, any]) => {
          if (metadata.tweet_text) {
            const videoUrl = item.per_video_metadata?.[imageKey]?.video_url
            const imageUrl = metadata.image_url
            
            // Prioritize video URL if exists, otherwise use image URL
            const mediaUrl = videoUrl || imageUrl
            const mediaS3Url = extractS3Url(mediaUrl)
            const scheduleKey = `${date}-${item.id}-${imageKey}`
            
            if (mediaS3Url && !postSchedules[scheduleKey]) {
              fetchSchedule(scheduleKey, mediaS3Url)
            }
          }
        })
      })
    })
  }, [content, projectId])

  // Handle Schedule button click - open modal
  const handleScheduleClick = () => {
    setShowScheduleModal(true)
  }

  // Handle Edit button click (placeholder for now)
  const handleEditClick = () => {
    // TODO: Implement edit flow
    alert('Edit functionality coming soon!')
  }

  // Handle OAuth2 callback (check URL params)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('oauth2_success') === 'true') {
      // OAuth2 completed, if video content exists, start OAuth1
      if (selectedPostIndex?.postData?.videoUrl && tokenValidation?.needsOAuth1) {
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
  }, [projectId, selectedPostIndex, tokenValidation])

  // Flatten all posts from all jobs for a date, with optional post type filtering
  // Only include images that have tweet text (exclude clip-only images like image_X_2, image_X_3)
  const getAllPostsForDate = (items: ContentItem[], filterPostType?: string): Array<{ item: ContentItem; imageIndex: number; imageUrl: string | null; videoUrl: string | null; postType: string; tweetText: string; threadArray: string[] }> => {
    const allPosts: Array<{ item: ContentItem; imageIndex: number; imageUrl: string | null; videoUrl: string | null; postType: string; tweetText: string; threadArray: string[] }> = []
    
    items.forEach(item => {
      // Get all images from this job
      const imageUrls = item.generated_image_urls || []
      const metadata = item.per_image_metadata || {}
      
      // For each image in this job, create a post entry
      imageUrls.forEach((imageUrl, index) => {
        const imageKey = `image_${index + 1}`
        const imgMetadata = metadata[imageKey]
        const tweetText = imgMetadata?.tweet_text || ''
        
        // CRITICAL: Only include images that have tweet text
        // Images without tweet text are only for video clips (like image_X_2, image_X_3) and should not be displayed
        if (!tweetText || tweetText.trim() === '') {
          return // Skip this image - it's only for video clips, not a standalone post
        }
        
        const postType = imgMetadata?.content_type || 'post'
        
        // Apply post type filter if provided
        if (filterPostType && filterPostType !== 'all' && postType !== filterPostType) {
          return // Skip this post if it doesn't match the filter
        }
        
        // Get video URL for this image index
        const videoUrl = getVideoUrl(item, index)
        
        allPosts.push({
          item,
          imageIndex: index,
          imageUrl: imgMetadata?.image_url || imageUrl,
          videoUrl: videoUrl,
          postType,
          tweetText,
          threadArray: imgMetadata?.thread_array || []
        })
      })
      
      // Also check metadata for any additional images not in generated_image_urls
      // But only include them if they have tweet text (to avoid showing clip-only images)
      Object.keys(metadata).forEach(key => {
        if (key.startsWith('image_')) {
          // Extract the base index (e.g., "image_3_2" -> index would be for image_3)
          // But we only want to process if it's a main image (image_1, image_2, etc.) not a clip image (image_X_2, image_X_3)
          const match = key.match(/^image_(\d+)$/)
          if (!match) {
            // This is a clip image (image_X_2, image_X_3, etc.) - skip it
            return
          }
          
          const index = parseInt(match[1]) - 1
          if (index >= imageUrls.length) {
            // This is an additional image from metadata
            const imgMetadata = metadata[key]
            if (imgMetadata && imgMetadata.image_url) {
              const tweetText = imgMetadata.tweet_text || ''
              
              // CRITICAL: Only include if it has tweet text
              // Clip-only images (image_X_2, etc.) won't have tweet text
              if (!tweetText || tweetText.trim() === '') {
                return // Skip this image - it's only for video clips
              }
              
              const postType = imgMetadata.content_type || 'post'
              
              // Apply post type filter if provided
              if (filterPostType && filterPostType !== 'all' && postType !== filterPostType) {
                return // Skip this post if it doesn't match the filter
              }
              
              // Get video URL for this image index
              const videoUrl = getVideoUrl(item, index)
              
              allPosts.push({
                item,
                imageIndex: index,
                imageUrl: imgMetadata.image_url,
                videoUrl: videoUrl,
                postType,
                tweetText,
                threadArray: imgMetadata.thread_array || []
              })
            }
          }
        }
      })
    })
    
    return allPosts
  }

  if (loading && Object.keys(content).length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-gray-400">Loading content...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
          <p className="text-red-400">Error: {error}</p>
        </div>
      </div>
    )
  }

  const dates = Object.keys(content).sort().reverse()
  const hasContent = dates.length > 0

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">My Content</h1>
        <p className="text-gray-400">View and manage all your generated content</p>
      </div>

      {/* Search Bar and Filters */}
      <div className="mb-6">
        <div className="flex gap-4 items-center">
          {/* Search Bar */}
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by prompt, tweet text, post type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
          
          {/* Post Type Filter Dropdown */}
          <div className="relative">
            <select
              value={postTypeFilter}
              onChange={(e) => setPostTypeFilter(e.target.value)}
              className="px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer min-w-[140px] pr-8"
            >
              <option value="all">All Types</option>
              <option value="thread">Regular Post</option>
              <option value="shitpost">Meme Post</option>
              <option value="longpost">Long Post</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Content Grid by Date */}
      {hasContent ? (
        <>
          {dates.map((date) => {
            const items = content[date]
            if (!items || items.length === 0) return null

            return (
              <div key={date} className="mb-8">
                {/* Date Header */}
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-white">{formatDate(date)}</h2>
                  {(() => {
                    const allPosts = getAllPostsForDate(items, postTypeFilter)
                    return (
                      <p className="text-sm text-gray-400">{allPosts.length} post{allPosts.length !== 1 ? 's' : ''}</p>
                    )
                  })()}
                </div>

                {/* 4-Column Grid - Show filtered posts for this date */}
                {(() => {
                  const allPosts = getAllPostsForDate(items, postTypeFilter)
                  
                  if (allPosts.length === 0) {
                    return (
                      <div className="text-center py-8 text-gray-400">
                        <p>No posts available for this date</p>
                      </div>
                    )
                  }

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {allPosts.map((post, postIndex) => {
                        return (
                          <div
                            key={`${post.item.job_id}-${post.imageIndex}-${postIndex}`}
                            className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden hover:border-blue-500 transition-all cursor-pointer group"
                            onClick={() => {
                              if (post.imageUrl || post.videoUrl || post.tweetText) {
                                setSelectedPostIndex({ date, index: postIndex, postData: post })
                              }
                            }}
                          >
                            {/* Image/Video */}
                            <div className="aspect-square relative bg-gray-700">
                              {post.videoUrl ? (
                                <>
                                  {/* Scheduled Badge */}
                                  {(() => {
                                    const scheduleKey = `${date}-${post.item.id}-image_${post.imageIndex + 1}`
                                    return postSchedules[scheduleKey] ? (
                                      <div className="absolute top-2 left-2 bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded-full z-10">
                                        Scheduled
                                      </div>
                                    ) : null
                                  })()}
                                  <VideoPlayer
                                    src={post.videoUrl}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    controls={true}
                                    muted={false}
                                    loop={false}
                                  />
                                  {/* Video Icon Overlay */}
                                  <div className="absolute top-2 right-2 bg-black/70 rounded-full p-2 z-10">
                                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z"/>
                                    </svg>
                                  </div>
                                </>
                              ) : post.imageUrl ? (
                                <>
                                  {/* Scheduled Badge */}
                                  {(() => {
                                    const scheduleKey = `${date}-${post.item.id}-image_${post.imageIndex + 1}`
                                    return postSchedules[scheduleKey] ? (
                                      <div className="absolute top-2 left-2 bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded-full z-10">
                                        Scheduled
                                      </div>
                                    ) : null
                                  })()}
                                  <SecureImage
                                    src={post.imageUrl}
                                    alt={`Post ${postIndex + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    fallbackComponent={
                                      <div className="w-full h-full flex items-center justify-center bg-gray-700">
                                        <div className="text-center space-y-2">
                                          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                                          <p className="text-sm text-gray-400">Loading...</p>
                                        </div>
                                      </div>
                                    }
                                  />
                                </>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gray-700">
                                  <div className="text-center">
                                    <div className="text-4xl mb-2">📝</div>
                                    <p className="text-sm text-gray-400">No content</p>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Content Info */}
                            <div className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300 uppercase font-semibold">
                                  {formatPostType(post.postType)}
                                </span>
                              </div>
                              {post.tweetText && (
                                <p className="text-sm text-gray-300 line-clamp-2">{post.tweetText}</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )
          })}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-700">
              <div className="text-gray-400 text-sm">
                Page {pagination.page} of {pagination.totalPages} • {pagination.totalDates} date{pagination.totalDates !== 1 ? 's' : ''}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center space-x-1"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  <span>Previous</span>
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center space-x-1"
                >
                  <span>Next</span>
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-800/30 rounded-xl border border-gray-700">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-white mb-2">
            {debouncedSearchTerm ? 'No results found' : 'No content yet'}
          </h3>
          <p className="text-gray-400">
            {debouncedSearchTerm 
              ? 'Try adjusting your search terms' 
              : 'Generate your first content from the Daily Posts screen'}
          </p>
        </div>
      )}

      {/* Post Detail Modal */}
      {selectedPostIndex && (() => {
        const { date, index, postData } = selectedPostIndex
        
        // Use postData if available (from flattened posts), otherwise fallback to old method
        let imageUrl: string | null = null
        let videoUrl: string | null = null
        let postType = 'post'
        let tweetText = ''
        let threadArray: string[] = []
        
        if (postData) {
          imageUrl = postData.imageUrl
          videoUrl = postData.videoUrl || null
          postType = postData.postType
          tweetText = postData.tweetText
          threadArray = postData.threadArray
        } else {
          // Fallback for backward compatibility
          const item = content[date]?.[index]
          if (!item) return null
          
          imageUrl = getImageUrl(item, index)
          videoUrl = getVideoUrl(item, index)
          postType = getPostType(item, index)
          tweetText = getTweetText(item, index)
          threadArray = getThreadArray(item, index)
        }
        
        // Debug logging for modal
        console.log('🎬 Modal video data:', {
          videoUrl,
          imageUrl,
          hasVideo: !!videoUrl,
          hasImage: !!imageUrl,
          postType,
          tweetText: tweetText?.substring(0, 50) + '...'
        })
        
        if (!imageUrl && !videoUrl && !tweetText) return null

        return (
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 md:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedPostIndex(null)
                setShowScheduleModal(false)
              }
            }}
          >
            <div className="bg-gray-800 rounded-xl border border-gray-700 w-full h-full max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-700 flex-shrink-0">
                <h2 className="text-lg md:text-xl font-bold text-white">Post Details</h2>
                <button
                  onClick={() => {
                    setSelectedPostIndex(null)
                    setShowScheduleModal(false)
                  }}
                  className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                  aria-label="Close modal"
                >
                  <XMarkIcon className="h-5 w-5 text-gray-400" />
                </button>
              </div>

              {/* Modal Content - Image on Left, Content on Right */}
              <div className="flex-1 overflow-hidden">
                <div className="flex flex-col md:flex-row h-full">
                  {/* Left Side - Image/Video */}
                  <div className="w-full md:w-3/5 bg-gray-900 flex items-center justify-center overflow-hidden" style={{ minHeight: 0 }}>
                    {videoUrl ? (
                      <div className="w-full h-full flex items-center justify-center p-2 md:p-4" style={{ minHeight: 0 }}>
                        <div className="w-full h-full max-w-full max-h-full relative flex items-center justify-center" style={{ minHeight: 0 }}>
                          <VideoPlayer
                            key={`${date}-${index}-${videoUrl}`} // Force re-render when post changes or URL changes
                            src={videoUrl}
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
                    ) : imageUrl ? (
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
                        <p>No content available</p>
                      </div>
                    )}
                  </div>

                  {/* Right Side - Content */}
                  <div className="w-full md:w-2/5 p-4 md:p-8 overflow-y-auto bg-gray-800" style={{ minHeight: 0 }}>
                    {/* Post Type Badge */}
                    <div className="mb-4">
                      <span className="text-xs px-3 py-1 bg-gray-700 rounded-full text-gray-300 uppercase font-semibold">
                        {formatPostType(postType)}
                      </span>
                    </div>

                    {/* Action Buttons - Top */}
                    <div className="flex gap-2 mb-6 flex-wrap">
                      <button 
                        onClick={handleEditClick}
                        className="flex-1 min-w-[100px] px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
                        disabled={!imageUrl && !videoUrl && !tweetText}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (selectedPostIndex?.postData) {
                            handleScheduleClick()
                          }
                        }}
                        className="flex-1 min-w-[100px] px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                        disabled={!imageUrl && !videoUrl && !tweetText}
                      >
                        Schedule
                      </button>
                      <button 
                        onClick={() => {
                          const postButtonLabel = getPostButtonLabel({ videoUrl })
                          if (postButtonLabel === 'Reconnect X') {
                            handleReconnectClick({ videoUrl, imageUrl })
                          } else {
                            handlePostToX({ imageUrl, videoUrl, tweetText, threadArray, postType })
                          }
                        }}
                        className="flex-1 min-w-[100px] px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                        disabled={(!imageUrl && !videoUrl && !tweetText) || isPosting || isAuthorizing}
                      >
                        {isPosting ? 'Posting...' : getPostButtonLabel({ videoUrl })}
                      </button>
                    </div>

                    {/* Content Display Based on Post Type */}
                    {postType === 'thread' ? (
                      <TweetThreadDisplay
                        mainTweet={tweetText}
                        tweetThread={threadArray}
                        showImage={false}
                        className="w-full mb-6"
                      />
                    ) : postType === 'longpost' ? (
                      <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600 mb-6">
                        {renderMarkdown(tweetText, { className: 'longpost-content' })}
                      </div>
                    ) : (
                      <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600 mb-6">
                        <div className="text-white text-base leading-relaxed whitespace-pre-wrap break-words">
                          {tweetText}
                        </div>
                      </div>
                    )}

                    {/* Schedule Info Banner */}
                    {selectedPostIndex && (() => {
                      const scheduleKey = `${date}-${selectedPostIndex.postData?.item?.id || ''}-image_${(selectedPostIndex.postData?.imageIndex || 0) + 1}`
                      const schedule = postSchedules[scheduleKey]
                      
                      if (schedule) {
                        return (
                          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
                            <p className="text-sm text-green-300">
                              📅 This post is scheduled to be posted on Twitter on{' '}
                              <span className="font-semibold">
                                {new Date(schedule.scheduledAt).toLocaleString('en-US', {
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
                        )
                      }
                      return null
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Schedule Modal */}
      {showScheduleModal && selectedPostIndex && selectedPostIndex.postData && (() => {
        const { date, postData } = selectedPostIndex
        const videoUrl = postData.videoUrl
        const imageUrl = postData.imageUrl
        
        // Prioritize video URL if exists, otherwise use image URL
        const mediaUrl = videoUrl || imageUrl
        const mediaS3Url = extractS3Url(mediaUrl)
        const mediaType = videoUrl ? 'video' : 'image'
        const scheduleKey = `${date}-${postData.item?.id || ''}-image_${(postData.imageIndex || 0) + 1}`
        const schedule = postSchedules[scheduleKey] || null
        
        return (
          <ScheduleModal
            isOpen={showScheduleModal}
            onClose={() => {
              setShowScheduleModal(false)
              // Refresh schedules after modal closes
              if (mediaS3Url) {
                fetchSchedule(scheduleKey, mediaS3Url)
              }
            }}
            projectId={projectId}
            mediaS3Url={mediaS3Url || ''}
            mediaType={mediaType}
            tweetText={{
              main_tweet: postData.tweetText || '',
              thread_array: postData.threadArray || [],
              content_type: (postData.postType as 'thread' | 'shitpost' | 'longpost') || 'shitpost'
            }}
            currentSchedule={schedule}
          />
        )
      })()}
    </div>
  )
}
