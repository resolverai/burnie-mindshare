'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  ChartBarIcon, 
  TrophyIcon, 
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  EyeIcon,
  StarIcon,
  FireIcon,
  UsersIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid,
  StarIcon as StarIconSolid 
} from '@heroicons/react/24/solid'

interface CampaignMindshare {
  id: string
  title: string
  mindshare_percentage: number
  mindshare_delta: number
  platform_source: string
  reward_token: string
  content_count: number
  quality_score: number
}

interface YapperLeaderboard {
  rank: number
  address: string
  username: string
  total_bids: number
  successful_bids: number
  total_spent: number
  mindshare_generated: number
  quality_score: number
  badge: 'diamond' | 'gold' | 'silver' | 'bronze' | null
}

export default function YapperAnalytics() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'24h' | '7d' | '30d'>('7d')

  // Mock data for treemap campaigns
  const mockCampaigns: CampaignMindshare[] = [
    {
      id: '1',
      title: 'AIXBT Mindshare Campaign',
      mindshare_percentage: 24.8,
      mindshare_delta: 5.2,
      platform_source: 'cookie.fun',
      reward_token: 'KAITO',
      content_count: 42,
      quality_score: 87.3
    },
    {
      id: '2',
      title: 'DeFi Protocol Roast',
      mindshare_percentage: 18.6,
      mindshare_delta: -2.1,
      platform_source: 'yaps.kaito.ai',
      reward_token: 'SNAP',
      content_count: 31,
      quality_score: 92.1
    },
    {
      id: '3',
      title: 'Blockchain Education Push',
      mindshare_percentage: 15.2,
      mindshare_delta: 3.8,
      platform_source: 'yap.market',
      reward_token: 'BURNIE',
      content_count: 28,
      quality_score: 84.7
    },
    {
      id: '4',
      title: 'NFT Market Analysis',
      mindshare_percentage: 12.4,
      mindshare_delta: 1.5,
      platform_source: 'cookie.fun',
      reward_token: 'KAITO',
      content_count: 19,
      quality_score: 79.2
    },
    {
      id: '5',
      title: 'Layer 2 Solutions Deep Dive',
      mindshare_percentage: 10.8,
      mindshare_delta: -0.8,
      platform_source: 'yaps.kaito.ai',
      reward_token: 'SNAP',
      content_count: 15,
      quality_score: 88.9
    },
    {
      id: '6',
      title: 'Web3 Gaming Revolution',
      mindshare_percentage: 8.7,
      mindshare_delta: 2.3,
      platform_source: 'yap.market',
      reward_token: 'BURNIE',
      content_count: 12,
      quality_score: 85.4
    }
  ]

  // Mock leaderboard data
  const mockLeaderboard: YapperLeaderboard[] = [
    {
      rank: 1,
      address: '0x1234...5678',
      username: 'CryptoYapper',
      total_bids: 127,
      successful_bids: 89,
      total_spent: 2840.5,
      mindshare_generated: 94.2,
      quality_score: 92.8,
      badge: 'diamond'
    },
    {
      rank: 2,
      address: '0x2345...6789',
      username: 'MemeAmplifier',
      total_bids: 98,
      successful_bids: 71,
      total_spent: 2156.3,
      mindshare_generated: 87.6,
      quality_score: 89.4,
      badge: 'gold'
    },
    {
      rank: 3,
      address: '0x3456...7890',
      username: 'ViralBooster',
      total_bids: 84,
      successful_bids: 62,
      total_spent: 1892.7,
      mindshare_generated: 83.1,
      quality_score: 85.9,
      badge: 'silver'
    }
  ]

  const getBadgeIcon = (badge: YapperLeaderboard['badge']) => {
    switch (badge) {
      case 'diamond': return <StarIconSolid className="h-4 w-4 text-cyan-500" />
      case 'gold': return <TrophyIconSolid className="h-4 w-4 text-yellow-500" />
      case 'silver': return <TrophyIcon className="h-4 w-4 text-gray-400" />
      case 'bronze': return <TrophyIcon className="h-4 w-4 text-orange-600" />
      default: return null
    }
  }

  const getTreemapSize = (percentage: number) => {
    const base = 120
    const scale = percentage / 25 // Scale relative to max expected percentage
    return Math.max(base, base + (scale * 180))
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 space-y-6">
        {/* Header with timeframe selector */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
            <p className="text-gray-600">Track campaign mindshare and yapper performance</p>
          </div>
          <div className="flex space-x-2">
            {['24h', '7d', '30d'].map((timeframe) => (
              <button
                key={timeframe}
                onClick={() => setSelectedTimeframe(timeframe as any)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedTimeframe === timeframe
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {timeframe}
              </button>
            ))}
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Mindshare</p>
                <p className="text-2xl font-bold text-gray-900">87.3%</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+5.2%</span>
                </div>
              </div>
              <ChartBarIcon className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Active Bids</p>
                <p className="text-2xl font-bold text-gray-900">24</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+8.1%</span>
                </div>
              </div>
              <EyeIcon className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Quality Score</p>
                <p className="text-2xl font-bold text-gray-900">92.8</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingDownIcon className="h-4 w-4 text-red-500 mr-1" />
                  <span className="text-sm text-red-600">-1.2%</span>
                </div>
              </div>
              <StarIcon className="h-8 w-8 text-yellow-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">ROAST Earned</p>
                <p className="text-2xl font-bold text-gray-900">1,247</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+12.5%</span>
                </div>
              </div>
              <FireIcon className="h-8 w-8 text-red-500" />
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Mindshare Treemap */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-semibold text-gray-900">Campaign Mindshare Distribution</h3>
                <p className="text-sm text-gray-500">Real-time mindshare percentages across active campaigns</p>
              </div>
              <div className="card-content">
                <div className="flex flex-wrap gap-3 justify-center">
                  {mockCampaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className="relative bg-gradient-to-br from-orange-500 to-red-600 rounded-lg text-white p-4 cursor-pointer hover:shadow-lg transition-all"
                      style={{
                        width: `${getTreemapSize(campaign.mindshare_percentage)}px`,
                        height: `${getTreemapSize(campaign.mindshare_percentage) * 0.7}px`,
                        minWidth: '140px',
                        minHeight: '100px'
                      }}
                    >
                      <div className="h-full flex flex-col justify-between">
                        <div>
                          <div className="text-lg font-bold">{campaign.mindshare_percentage}%</div>
                          <div className="text-xs opacity-90 truncate" title={campaign.title}>
                            {campaign.title}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="bg-white/20 px-2 py-1 rounded">
                            {campaign.platform_source}
                          </span>
                          <div className="flex items-center">
                            {campaign.mindshare_delta > 0 ? (
                              <ArrowTrendingUpIcon className="h-3 w-3 mr-1" />
                            ) : (
                              <ArrowTrendingDownIcon className="h-3 w-3 mr-1" />
                            )}
                            <span>{Math.abs(campaign.mindshare_delta)}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Yapper Leaderboard */}
          <div>
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-semibold text-gray-900">Top Yappers</h3>
                <p className="text-sm text-gray-500">Leading performers this week</p>
              </div>
              <div className="card-content space-y-4">
                {mockLeaderboard.map((yapper) => (
                  <div key={yapper.rank} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        yapper.rank === 1 ? 'bg-yellow-100 text-yellow-800' :
                        yapper.rank === 2 ? 'bg-gray-100 text-gray-800' :
                        yapper.rank === 3 ? 'bg-orange-100 text-orange-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {yapper.rank}
                      </div>
                      {getBadgeIcon(yapper.badge)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="font-medium text-gray-900 truncate">{yapper.username}</p>
                      </div>
                      <p className="text-xs text-gray-500 font-mono">{yapper.address}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-600 mt-1">
                        <span>{yapper.successful_bids}/{yapper.total_bids} bids</span>
                        <span>{yapper.mindshare_generated}% mindshare</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Campaign Performance Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-gray-900">Campaign Performance Details</h3>
            <p className="text-sm text-gray-500">Detailed breakdown of campaign metrics</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mindshare %</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delta</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Content</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quality</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mockCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900">{campaign.title}</div>
                        <div className="text-sm text-gray-500">{campaign.reward_token}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="status-indicator status-active">{campaign.platform_source}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-900">{campaign.mindshare_percentage}%</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center ${campaign.mindshare_delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {campaign.mindshare_delta > 0 ? (
                          <ArrowTrendingUpIcon className="h-4 w-4 mr-1" />
                        ) : (
                          <ArrowTrendingDownIcon className="h-4 w-4 mr-1" />
                        )}
                        {Math.abs(campaign.mindshare_delta)}%
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-900">{campaign.content_count}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                          <div 
                            className="bg-orange-500 h-2 rounded-full" 
                            style={{ width: `${campaign.quality_score}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium text-gray-700">{campaign.quality_score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
} 