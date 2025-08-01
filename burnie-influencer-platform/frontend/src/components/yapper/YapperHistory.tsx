'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  CurrencyDollarIcon,
  EyeIcon,
  CalendarDaysIcon,
  ArrowTopRightOnSquareIcon
} from '@heroicons/react/24/outline'

interface HistoryItem {
  id: number
  type: 'bid' | 'win' | 'transaction'
  content_preview: string
  campaign_title: string
  platform_source: string
  amount: number
  currency: string
  status: 'pending' | 'won' | 'lost' | 'completed'
  created_at: string
  quality_score?: number
  mindshare_generated?: number
}

export default function YapperHistory() {
  const [selectedTab, setSelectedTab] = useState<'all' | 'bids' | 'wins' | 'transactions'>('all')
  const [selectedTimeframe, setSelectedTimeframe] = useState<'7d' | '30d' | '90d'>('30d')

  // Mock history data - in real implementation, fetch from API
  const mockHistory: HistoryItem[] = [
    {
      id: 1,
      type: 'win',
      content_preview: '🤖 AI trading bots are evolving faster than ever! The future of automated trading is here...',
      campaign_title: 'AIXBT Mindshare Campaign',
      platform_source: 'cookie.fun',
      amount: 45.5,
      currency: 'ROAST',
      status: 'won',
      created_at: '2024-01-15T10:30:00Z',
      quality_score: 87.3,
      mindshare_generated: 12.4
    },
    {
      id: 2,
      type: 'bid',
      content_preview: 'DeFi protocols be like: "We\'re revolutionizing finance!" Also DeFi protocols: *gets drained...',
      campaign_title: 'DeFi Protocol Roast',
      platform_source: 'yaps.kaito.ai',
      amount: 32.0,
      currency: 'ROAST',
      status: 'pending',
      created_at: '2024-01-14T15:45:00Z',
      quality_score: 92.1
    },
    {
      id: 3,
      type: 'transaction',
      content_preview: 'Understanding Blockchain Beyond the Hype - Thread: 1/ Blockchain isn\'t just about crypto...',
      campaign_title: 'Blockchain Education Push',
      platform_source: 'yap.market',
      amount: 28.5,
      currency: 'USDC',
      status: 'completed',
      created_at: '2024-01-13T09:20:00Z',
      quality_score: 84.7,
      mindshare_generated: 8.9
    },
    {
      id: 4,
      type: 'bid',
      content_preview: 'NFT market analysis shows interesting trends in user behavior and pricing dynamics...',
      campaign_title: 'NFT Market Analysis',
      platform_source: 'cookie.fun',
      amount: 25.0,
      currency: 'ROAST',
      status: 'lost',
      created_at: '2024-01-12T14:15:00Z',
      quality_score: 79.2
    }
  ]

  const filteredHistory = mockHistory.filter(item => {
    if (selectedTab === 'all') return true
    if (selectedTab === 'bids') return item.type === 'bid'
    if (selectedTab === 'wins') return item.type === 'win'
    if (selectedTab === 'transactions') return item.type === 'transaction'
    return true
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'won':
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'lost':
        return <XCircleIcon className="h-5 w-5 text-red-500" />
      case 'pending':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />
      default:
        return <ClockIcon className="h-5 w-5 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'won':
        return 'status-indicator bg-green-100 text-green-800'
      case 'completed':
        return 'status-indicator bg-blue-100 text-blue-800'
      case 'lost':
        return 'status-indicator bg-red-100 text-red-800'
      case 'pending':
        return 'status-indicator bg-yellow-100 text-yellow-800'
      default:
        return 'status-indicator bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Activity History</h1>
          <p className="text-gray-600">Track your bidding activity and performance</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Bids</p>
                <p className="text-2xl font-bold text-gray-900">127</p>
              </div>
              <CurrencyDollarIcon className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Won Content</p>
                <p className="text-2xl font-bold text-gray-900">89</p>
                <p className="text-xs text-green-600">70.1% success rate</p>
              </div>
              <CheckCircleIcon className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Spent</p>
                <p className="text-2xl font-bold text-gray-900">2,847</p>
                <p className="text-xs text-gray-500">ROAST + USDC</p>
              </div>
              <CurrencyDollarIcon className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Mindshare Generated</p>
                <p className="text-2xl font-bold text-gray-900">94.2%</p>
                <p className="text-xs text-green-600">+12.4% this month</p>
              </div>
              <EyeIcon className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex space-x-2">
            {[
              { id: 'all', label: 'All Activity' },
              { id: 'bids', label: 'Bids' },
              { id: 'wins', label: 'Wins' },
              { id: 'transactions', label: 'Transactions' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedTab === tab.id
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={selectedTimeframe}
            onChange={(e) => setSelectedTimeframe(e.target.value as any)}
            className="input-field w-auto"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>

        {/* History List */}
        <div className="space-y-4">
          {filteredHistory.map((item) => (
            <div key={item.id} className="card hover:shadow-md transition-shadow">
              <div className="card-content">
                <div className="flex items-start space-x-4">
                  {/* Status Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {getStatusIcon(item.status)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Content Preview */}
                        <p className="text-gray-900 font-medium line-clamp-2 mb-2">
                          {item.content_preview}
                        </p>

                        {/* Campaign Info */}
                        <div className="flex items-center space-x-3 mb-3">
                          <span className="status-indicator status-active text-xs">
                            {item.platform_source}
                          </span>
                          <span className="text-sm text-gray-600">{item.campaign_title}</span>
                        </div>

                        {/* Metrics */}
                        <div className="flex items-center space-x-6 text-sm text-gray-600">
                          <div className="flex items-center space-x-1">
                            <CalendarDaysIcon className="h-4 w-4" />
                            <span>{formatDate(item.created_at)}</span>
                          </div>
                          {item.quality_score && (
                            <div className="flex items-center space-x-1">
                              <span>Quality: {item.quality_score}</span>
                            </div>
                          )}
                          {item.mindshare_generated && (
                            <div className="flex items-center space-x-1">
                              <EyeIcon className="h-4 w-4" />
                              <span>{item.mindshare_generated}% mindshare</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Status and Amount */}
                      <div className="flex-shrink-0 text-right">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className={getStatusBadge(item.status)}>
                            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </span>
                        </div>
                        <div className="text-lg font-bold text-gray-900">
                          {item.amount} {item.currency}
                        </div>
                        <div className="text-xs text-gray-500 capitalize">
                          {item.type}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {item.status === 'won' && (
                      <div className="flex items-center space-x-3 mt-4 pt-4 border-t border-gray-200">
                        <button className="btn-secondary text-sm">
                          <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-1" />
                          Share Content
                        </button>
                        <button className="btn-primary text-sm">
                          View Analytics
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredHistory.length === 0 && (
          <div className="text-center py-12">
            <ClockIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No activity found</p>
            <p className="text-gray-400 text-sm">Your bidding history will appear here</p>
          </div>
        )}
      </div>
    </div>
  )
} 