'use client'

import React, { useState, useEffect } from 'react'
import { format, subDays, startOfDay } from 'date-fns'

// Types for analytics data
interface DailyMetrics {
  date: string
  roasts_distributed: number
  new_participants: number
  content_pieces: number
  mindshare_generated: number
  engagement_rate: number
}

interface SocialEngagement {
  total_views: number
  total_likes: number
  total_shares: number
  total_comments: number
  viral_content_count: number
}

interface TopPerformer {
  user_id: string
  username?: string
  avatar?: string
  roasts_earned: number
  content_count?: number
  engagement_generated?: number
  rank: number
}

interface CampaignAnalytics {
  total_roasts_distributed: number
  total_participants: number
  content_generated: number
  social_engagement: SocialEngagement
  daily_metrics: DailyMetrics[]
  top_performers: {
    roasters: TopPerformer[]
    yappers: TopPerformer[]
  }
  roi_metrics: {
    investment_amount: number
    mindshare_value: number
    engagement_value: number
    cost_per_engagement: number
    viral_coefficient: number
  }
}

interface Campaign {
  id: string
  title: string
  description: string
  category: string
  status: string
  total_reward_pool: number
  reward_token_type: string
  start_date: Date
  end_date: Date
  total_submissions_count: number
  max_submissions: number
  total_participants_count: number
  total_roasts_distributed: number
  completion_rate: number
  sentiment_tracking: {
    bulls: number
    bears: number
    neutral: number
  }
  analytics: CampaignAnalytics
}

interface CampaignAnalyticsDashboardProps {
  campaign: Campaign
  onRefresh?: () => void
}

export default function CampaignAnalyticsDashboard({ 
  campaign, 
  onRefresh 
}: CampaignAnalyticsDashboardProps) {
  const [selectedTimeRange, setSelectedTimeRange] = useState<'7d' | '30d' | 'all'>('7d')
  const [selectedTab, setSelectedTab] = useState<'overview' | 'leaderboard' | 'engagement' | 'roi'>('overview')
  const [isLoading, setIsLoading] = useState(false)

  // Calculate time-filtered metrics
  const getFilteredMetrics = () => {
    const now = new Date()
    let startDate: Date
    
    switch (selectedTimeRange) {
      case '7d':
        startDate = subDays(now, 7)
        break
      case '30d':
        startDate = subDays(now, 30)
        break
      default:
        return campaign.analytics.daily_metrics
    }

    return campaign.analytics.daily_metrics.filter(metric => 
      new Date(metric.date) >= startDate
    )
  }

  const filteredMetrics = getFilteredMetrics()

  // Calculate summary stats for filtered period
  const summaryStats = filteredMetrics.reduce(
    (acc, metric) => ({
      totalROASTS: acc.totalROASTS + metric.roasts_distributed,
      totalParticipants: acc.totalParticipants + metric.new_participants,
      totalContent: acc.totalContent + metric.content_pieces,
      totalMindshare: acc.totalMindshare + metric.mindshare_generated,
      avgEngagement: acc.avgEngagement + metric.engagement_rate,
    }),
    { totalROASTS: 0, totalParticipants: 0, totalContent: 0, totalMindshare: 0, avgEngagement: 0 }
  )

  if (filteredMetrics.length > 0) {
    summaryStats.avgEngagement = summaryStats.avgEngagement / filteredMetrics.length
  }

  const refreshData = async () => {
    setIsLoading(true)
    try {
      await onRefresh?.()
    } finally {
      setIsLoading(false)
    }
  }

  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total ROASTS Distributed</p>
              <p className="text-2xl font-bold text-orange-400">
                {campaign.total_roasts_distributed.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">🔥</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            +{summaryStats.totalROASTS.toLocaleString()} in {selectedTimeRange}
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Participants</p>
              <p className="text-2xl font-bold text-blue-400">
                {campaign.total_participants_count.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">👥</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            +{summaryStats.totalParticipants.toLocaleString()} in {selectedTimeRange}
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Content Generated</p>
              <p className="text-2xl font-bold text-green-400">
                {campaign.analytics.content_generated.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">📝</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            +{summaryStats.totalContent.toLocaleString()} in {selectedTimeRange}
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Completion Rate</p>
              <p className="text-2xl font-bold text-purple-400">
                {campaign.completion_rate.toFixed(1)}%
              </p>
            </div>
            <div className="text-3xl">📊</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {campaign.total_submissions_count}/{campaign.max_submissions} submissions
          </div>
        </div>
      </div>

      {/* ROASTS Distribution Chart (Cookie.fun inspired) */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">ROASTS Distribution Over Time</h3>
          <div className="flex space-x-2">
            {(['7d', '30d', 'all'] as const).map(range => (
              <button
                key={range}
                onClick={() => setSelectedTimeRange(range)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  selectedTimeRange === range
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`}
              >
                {range === 'all' ? 'All Time' : range.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Simple chart visualization */}
        <div className="space-y-2">
          {filteredMetrics.slice(-7).map((metric, index) => {
            const maxValue = Math.max(...filteredMetrics.map(m => m.roasts_distributed))
            const percentage = maxValue > 0 ? (metric.roasts_distributed / maxValue) * 100 : 0
            
            return (
              <div key={metric.date} className="flex items-center space-x-4">
                <div className="w-16 text-xs text-gray-400">
                  {format(new Date(metric.date), 'MMM dd')}
                </div>
                <div className="flex-1 bg-gray-600 rounded-full h-6 relative">
                  <div
                    className="bg-gradient-to-r from-orange-500 to-red-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-medium">
                    {metric.roasts_distributed.toLocaleString()}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sentiment Tracking (Bulls/Bears like cookie.fun) */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">Market Sentiment</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl mb-2">🐂</div>
            <div className="text-xl font-bold text-green-400">
              {campaign.sentiment_tracking.bulls}
            </div>
            <div className="text-sm text-gray-400">Bulls</div>
          </div>
          <div className="text-center">
            <div className="text-2xl mb-2">😐</div>
            <div className="text-xl font-bold text-gray-400">
              {campaign.sentiment_tracking.neutral}
            </div>
            <div className="text-sm text-gray-400">Neutral</div>
          </div>
          <div className="text-center">
            <div className="text-2xl mb-2">🐻</div>
            <div className="text-xl font-bold text-red-400">
              {campaign.sentiment_tracking.bears}
            </div>
            <div className="text-sm text-gray-400">Bears</div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderLeaderboardTab = () => (
    <div className="space-y-6">
      {/* Roasters Leaderboard */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">Top Roasters (Content Creators)</h3>
        <div className="space-y-3">
          {campaign.analytics.top_performers.roasters.slice(0, 10).map((performer, index) => (
            <div key={performer.user_id} className="flex items-center justify-between p-3 bg-gray-600/50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-500 text-black' :
                  index === 1 ? 'bg-gray-400 text-black' :
                  index === 2 ? 'bg-orange-600 text-white' :
                  'bg-gray-600 text-white'
                }`}>
                  {index + 1}
                </div>
                {performer.avatar ? (
                  <img 
                    src={performer.avatar} 
                    alt={performer.username || 'User'} 
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                    🤖
                  </div>
                )}
                <div>
                  <div className="font-medium text-white">
                    {performer.username || `User ${performer.user_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-400">
                    {performer.content_count} pieces generated
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-orange-400">
                  {performer.roasts_earned.toLocaleString()} ROASTS
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Yappers Leaderboard */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">Top Yappers (Social Promoters)</h3>
        <div className="space-y-3">
          {campaign.analytics.top_performers.yappers.slice(0, 10).map((performer, index) => (
            <div key={performer.user_id} className="flex items-center justify-between p-3 bg-gray-600/50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-500 text-black' :
                  index === 1 ? 'bg-gray-400 text-black' :
                  index === 2 ? 'bg-orange-600 text-white' :
                  'bg-gray-600 text-white'
                }`}>
                  {index + 1}
                </div>
                {performer.avatar ? (
                  <img 
                    src={performer.avatar} 
                    alt={performer.username || 'User'} 
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <div className="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center">
                    📢
                  </div>
                )}
                <div>
                  <div className="font-medium text-white">
                    {performer.username || `User ${performer.user_id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-400">
                    {performer.engagement_generated?.toLocaleString()} engagement points
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-blue-400">
                  {performer.roasts_earned.toLocaleString()} ROASTS
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  const renderEngagementTab = () => (
    <div className="space-y-6">
      {/* Social Media Engagement */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Views</p>
              <p className="text-2xl font-bold text-white">
                {campaign.analytics.social_engagement.total_views.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">👁️</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Likes</p>
              <p className="text-2xl font-bold text-red-400">
                {campaign.analytics.social_engagement.total_likes.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">❤️</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Shares</p>
              <p className="text-2xl font-bold text-green-400">
                {campaign.analytics.social_engagement.total_shares.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">🔄</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Viral Content</p>
              <p className="text-2xl font-bold text-purple-400">
                {campaign.analytics.social_engagement.viral_content_count}
              </p>
            </div>
            <div className="text-3xl">🚀</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Content with 10k+ views
          </div>
        </div>
      </div>

      {/* Engagement Rate Over Time */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">Engagement Rate Trend</h3>
        <div className="space-y-2">
          {filteredMetrics.slice(-7).map((metric) => {
            const maxEngagement = Math.max(...filteredMetrics.map(m => m.engagement_rate))
            const percentage = maxEngagement > 0 ? (metric.engagement_rate / maxEngagement) * 100 : 0
            
            return (
              <div key={metric.date} className="flex items-center space-x-4">
                <div className="w-16 text-xs text-gray-400">
                  {format(new Date(metric.date), 'MMM dd')}
                </div>
                <div className="flex-1 bg-gray-600 rounded-full h-6 relative">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-white font-medium">
                    {metric.engagement_rate.toFixed(1)}%
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  const renderROITab = () => (
    <div className="space-y-6">
      {/* ROI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Investment</p>
              <p className="text-2xl font-bold text-white">
                ${campaign.analytics.roi_metrics.investment_amount.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">💰</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Mindshare Value</p>
              <p className="text-2xl font-bold text-green-400">
                ${campaign.analytics.roi_metrics.mindshare_value.toLocaleString()}
              </p>
            </div>
            <div className="text-3xl">🧠</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Cost per Engagement</p>
              <p className="text-2xl font-bold text-blue-400">
                ${campaign.analytics.roi_metrics.cost_per_engagement.toFixed(4)}
              </p>
            </div>
            <div className="text-3xl">📊</div>
          </div>
        </div>

        <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Viral Coefficient</p>
              <p className="text-2xl font-bold text-purple-400">
                {campaign.analytics.roi_metrics.viral_coefficient.toFixed(2)}x
              </p>
            </div>
            <div className="text-3xl">📈</div>
          </div>
        </div>
      </div>

      {/* ROI Calculation Breakdown */}
      <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">ROI Breakdown</h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center py-2 border-b border-gray-600">
            <span className="text-gray-400">Total Investment</span>
            <span className="text-white font-bold">
              ${campaign.analytics.roi_metrics.investment_amount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gray-600">
            <span className="text-gray-400">Mindshare Generated</span>
            <span className="text-white font-bold">
              ${campaign.analytics.roi_metrics.mindshare_value.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gray-600">
            <span className="text-gray-400">Engagement Value</span>
            <span className="text-white font-bold">
              ${campaign.analytics.roi_metrics.engagement_value.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center py-2 pt-4">
            <span className="text-lg font-semibold text-white">Total ROI</span>
            <span className={`text-lg font-bold ${
              (campaign.analytics.roi_metrics.mindshare_value + campaign.analytics.roi_metrics.engagement_value) > campaign.analytics.roi_metrics.investment_amount
                ? 'text-green-400'
                : 'text-red-400'
            }`}>
              {(((campaign.analytics.roi_metrics.mindshare_value + campaign.analytics.roi_metrics.engagement_value) / campaign.analytics.roi_metrics.investment_amount - 1) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{campaign.title}</h2>
          <p className="text-gray-400 mt-1">{campaign.description}</p>
        </div>
        <button
          onClick={refreshData}
          disabled={isLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
        >
          <span className={isLoading ? 'animate-spin' : ''}>🔄</span>
          <span>{isLoading ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
            { id: 'engagement', label: 'Engagement', icon: '📱' },
            { id: 'roi', label: 'ROI', icon: '💰' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                selectedTab === tab.id
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {selectedTab === 'overview' && renderOverviewTab()}
        {selectedTab === 'leaderboard' && renderLeaderboardTab()}
        {selectedTab === 'engagement' && renderEngagementTab()}
        {selectedTab === 'roi' && renderROITab()}
      </div>
    </div>
  )
} 