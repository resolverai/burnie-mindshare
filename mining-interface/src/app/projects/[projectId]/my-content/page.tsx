'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { XMarkIcon, MagnifyingGlassIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'
import SecureImage from '@/components/SecureImage'
import TweetThreadDisplay from '@/components/TweetThreadDisplay'
import { renderMarkdown } from '@/utils/markdownParser'

interface ContentItem {
  id: number
  job_id: string
  created_at: string
  generated_image_urls: string[]
  per_image_metadata: Record<string, {
    image_url: string
    tweet_text?: string
    thread_array?: string[]
    content_type?: string
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
  const [selectedPostIndex, setSelectedPostIndex] = useState<{ date: string; index: number; postData?: { item: ContentItem; imageIndex: number; imageUrl: string | null; postType: string; tweetText: string; threadArray: string[] } } | null>(null)
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalDates: 0 })

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

  // Flatten all posts from all jobs for a date, with optional post type filtering
  const getAllPostsForDate = (items: ContentItem[], filterPostType?: string): Array<{ item: ContentItem; imageIndex: number; imageUrl: string | null; postType: string; tweetText: string; threadArray: string[] }> => {
    const allPosts: Array<{ item: ContentItem; imageIndex: number; imageUrl: string | null; postType: string; tweetText: string; threadArray: string[] }> = []
    
    items.forEach(item => {
      // Get all images from this job
      const imageUrls = item.generated_image_urls || []
      const metadata = item.per_image_metadata || {}
      
      // For each image in this job, create a post entry
      imageUrls.forEach((imageUrl, index) => {
        const imageKey = `image_${index + 1}`
        const imgMetadata = metadata[imageKey]
        const postType = imgMetadata?.content_type || 'post'
        
        // Apply post type filter if provided
        if (filterPostType && filterPostType !== 'all' && postType !== filterPostType) {
          return // Skip this post if it doesn't match the filter
        }
        
        allPosts.push({
          item,
          imageIndex: index,
          imageUrl: imgMetadata?.image_url || imageUrl,
          postType,
          tweetText: imgMetadata?.tweet_text || '',
          threadArray: imgMetadata?.thread_array || []
        })
      })
      
      // Also check metadata for any additional images not in generated_image_urls
      Object.keys(metadata).forEach(key => {
        if (key.startsWith('image_')) {
          const index = parseInt(key.replace('image_', '')) - 1
          if (index >= imageUrls.length) {
            // This is an additional image from metadata
            const imgMetadata = metadata[key]
            if (imgMetadata && imgMetadata.image_url) {
              const postType = imgMetadata.content_type || 'post'
              
              // Apply post type filter if provided
              if (filterPostType && filterPostType !== 'all' && postType !== filterPostType) {
                return // Skip this post if it doesn't match the filter
              }
              
              allPosts.push({
                item,
                imageIndex: index,
                imageUrl: imgMetadata.image_url,
                postType,
                tweetText: imgMetadata.tweet_text || '',
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
                              if (post.imageUrl || post.tweetText) {
                                setSelectedPostIndex({ date, index: postIndex, postData: post })
                              }
                            }}
                          >
                            {/* Image */}
                            <div className="aspect-square relative bg-gray-700">
                              {post.imageUrl ? (
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
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gray-700">
                                  <div className="text-center">
                                    <div className="text-4xl mb-2">📝</div>
                                    <p className="text-sm text-gray-400">No image</p>
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
        let postType = 'post'
        let tweetText = ''
        let threadArray: string[] = []
        
        if (postData) {
          imageUrl = postData.imageUrl
          postType = postData.postType
          tweetText = postData.tweetText
          threadArray = postData.threadArray
        } else {
          // Fallback for backward compatibility
          const item = content[date]?.[index]
          if (!item) return null
          
          imageUrl = getImageUrl(item, index)
          postType = getPostType(item, index)
          tweetText = getTweetText(item, index)
          threadArray = getThreadArray(item, index)
        }
        
        if (!imageUrl && !tweetText) return null

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
                    {imageUrl ? (
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
                        {formatPostType(postType)}
                      </span>
                    </div>

                    {/* Content Display Based on Post Type */}
                    {postType === 'thread' ? (
                      <TweetThreadDisplay
                        mainTweet={tweetText}
                        tweetThread={threadArray}
                        showImage={false}
                        className="w-full"
                      />
                    ) : postType === 'longpost' ? (
                      <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600">
                        {renderMarkdown(tweetText, { className: 'longpost-content' })}
                      </div>
                    ) : (
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
