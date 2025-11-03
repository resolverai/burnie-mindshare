'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { 
  PhotoIcon, 
  CalendarIcon, 
  ArrowUpOnSquareIcon, 
  HeartIcon,
  ArrowRightIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'

interface DashboardMetrics {
  totalGenerated: number
  scheduledCount: number
  totalPosted: number
  totalEngagement: number
  engagementBreakdown: {
    likes: number
    retweets: number
    replies: number
    quotes: number
    views: number
  }
}

interface RecentPost {
  id: number
  mainTweet: string
  postType: string
  postedAt: string
  engagement: {
    likes: number
    retweets: number
    replies: number
    quotes: number
    views: number
  }
  mainTweetId: string
}

interface UpcomingSchedule {
  id: number
  scheduledAt: string
  mediaType: 'image' | 'video'
  mainTweet: string
}

interface RecentGenerated {
  id: number
  jobId?: string
  status: string
  createdAt: string
  contentCount: number
  hasVideo: boolean
}

interface DashboardData {
  metrics: DashboardMetrics
  recentActivity: {
    recentPosts: RecentPost[]
    upcomingSchedules: UpcomingSchedule[]
    recentGenerated: RecentGenerated[]
  }
}

export default function ProjectDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const apiUrl = getApiUrlWithFallback()
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!apiUrl || !projectId) {
        setError('API URL or Project ID not configured')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`${apiUrl}/projects/${projectId}/dashboard`)
        
        if (!response.ok) {
          throw new Error(`Failed to fetch dashboard data: ${response.statusText}`)
        }

        const result = await response.json()
        
        if (result.success && result.data) {
          setDashboardData(result.data)
        } else {
          throw new Error(result.error || 'Failed to load dashboard data')
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [apiUrl, projectId])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-gray-400">Loading dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-300">Error: {error}</p>
        </div>
      </div>
    )
  }

  if (!dashboardData) {
    return (
      <div className="p-8">
        <div className="text-center py-16">
          <p className="text-gray-400">No dashboard data available</p>
        </div>
      </div>
    )
  }

  const { metrics, recentActivity } = dashboardData

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">Overview of your project activity and performance</p>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Total Generated */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <PhotoIcon className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.totalGenerated}</p>
            <p className="text-sm text-gray-400">Posts Generated</p>
          </div>
        </div>

        {/* Scheduled */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <CalendarIcon className="w-6 h-6 text-purple-400" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.scheduledCount}</p>
            <p className="text-sm text-gray-400">Scheduled</p>
          </div>
        </div>

        {/* Total Posted */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <ArrowUpOnSquareIcon className="w-6 h-6 text-green-400" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.totalPosted}</p>
            <p className="text-sm text-gray-400">Posted to Twitter</p>
          </div>
        </div>

        {/* Total Engagement */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 hover:border-gray-600 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-red-500/20 rounded-lg">
              <HeartIcon className="w-6 h-6 text-red-400" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{metrics.totalEngagement.toLocaleString()}</p>
            <p className="text-sm text-gray-400">Total Engagement</p>
            {metrics.totalEngagement > 0 && (
              <div className="mt-2 text-xs text-gray-500 space-y-1">
                <div>❤️ {metrics.engagementBreakdown.likes.toLocaleString()} likes</div>
                <div>🔄 {metrics.engagementBreakdown.retweets.toLocaleString()} retweets</div>
                <div>💬 {metrics.engagementBreakdown.replies.toLocaleString()} replies</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => router.push(`/projects/${projectId}/daily-posts`)}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-xl p-6 text-left transition-all transform hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Generate Daily Posts</h3>
                <p className="text-sm text-blue-200">Create today's content</p>
              </div>
              <ArrowRightIcon className="w-6 h-6 text-white" />
            </div>
          </button>

          <button
            onClick={() => router.push(`/projects/${projectId}/my-content`)}
            className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 rounded-xl p-6 text-left transition-all transform hover:scale-[1.02]"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">View All Content</h3>
                <p className="text-sm text-purple-200">Browse your content library</p>
              </div>
              <ArrowRightIcon className="w-6 h-6 text-white" />
            </div>
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Posts */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <ArrowUpOnSquareIcon className="w-5 h-5 text-green-400" />
                Posted to Twitter
              </h3>
            </div>
            <div className="space-y-3">
              {recentActivity.recentPosts.length > 0 ? (
                recentActivity.recentPosts.map((post) => (
                  <div
                    key={post.id}
                    className="bg-gray-700/30 rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer"
                    onClick={() => {
                      window.open(`https://twitter.com/i/web/status/${post.mainTweetId}`, '_blank')
                    }}
                  >
                    <p className="text-sm text-white mb-2 line-clamp-2">{post.mainTweet}</p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{formatDate(post.postedAt)}</span>
                      <div className="flex items-center gap-2">
                        <span>❤️ {post.engagement.likes}</span>
                        <span>🔄 {post.engagement.retweets}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No posts yet</p>
              )}
            </div>
          </div>

          {/* Upcoming Schedules */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-purple-400" />
                Scheduled
              </h3>
            </div>
            <div className="space-y-3">
              {recentActivity.upcomingSchedules.length > 0 ? (
                recentActivity.upcomingSchedules.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="bg-gray-700/30 rounded-lg p-3"
                  >
                    <p className="text-sm text-white mb-2 line-clamp-2">{schedule.mainTweet}</p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{formatDate(schedule.scheduledAt)}</span>
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded">
                        {schedule.mediaType === 'video' ? '🎬' : '🖼️'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No scheduled posts</p>
              )}
            </div>
          </div>

          {/* Recent Generated */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <DocumentTextIcon className="w-5 h-5 text-blue-400" />
                Generated Content
              </h3>
            </div>
            <div className="space-y-3">
              {recentActivity.recentGenerated.length > 0 ? (
                recentActivity.recentGenerated.map((content) => (
                  <div
                    key={content.id}
                    className="bg-gray-700/30 rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/projects/${projectId}/my-content`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        content.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                        content.status === 'generating' ? 'bg-yellow-500/20 text-yellow-300' :
                        'bg-gray-500/20 text-gray-300'
                      }`}>
                        {content.status}
                      </span>
                      {content.hasVideo && (
                        <span className="text-xs text-purple-300">🎬</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-1">
                      {content.contentCount} {content.contentCount === 1 ? 'post' : 'posts'}
                    </p>
                    <p className="text-xs text-gray-500">{formatDateShort(content.createdAt)}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No generated content</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
