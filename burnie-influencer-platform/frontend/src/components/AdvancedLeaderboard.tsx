'use client'

import { useState, useEffect } from 'react'
import { 
  ChevronDownIcon, 
  TrophyIcon, 
  ChartBarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ClockIcon,
  EyeIcon,
  CpuChipIcon,
  MegaphoneIcon,
  RocketLaunchIcon,
  Squares2X2Icon,
  ListBulletIcon
} from '@heroicons/react/24/outline'

interface LeaderboardEntry {
  id: string;
  name: string;
  avatar?: string;
  current: number;
  delta7d: number;
  delta30d: number;
  delta3m: number;
  delta6m: number;
  absoluteChange: number;
  relativeChange: number;
  rank: number;
  category: 'miner' | 'yapper' | 'project';
  tokens: number;
  submissions: number;
  mindshare: number;
  sentiment?: number;
  price?: number;
  marketCap?: number;
  volume24h?: number;
}

interface TreemapItem {
  id: string;
  name: string;
  value: number;
  change: number;
  color: string;
  size: number;
}

const mockLeaderboardData: LeaderboardEntry[] = [
  {
    id: '1',
    name: 'Haseeb 💎',
    current: 0.56,
    delta7d: 420,
    delta30d: 32,
    delta3m: 43,
    delta6m: 44,
    absoluteChange: 420,
    relativeChange: 32.5,
    rank: 1,
    category: 'yapper',
    tokens: 15420,
    submissions: 342,
    mindshare: 0.56,
    sentiment: 87.2
  },
  {
    id: '2', 
    name: 'Garga.eth',
    current: 0.66,
    delta7d: 480,
    delta30d: 24,
    delta3m: 30,
    delta6m: 47,
    absoluteChange: 480,
    relativeChange: 24.3,
    rank: 2,
    category: 'yapper',
    tokens: 12890,
    submissions: 298,
    mindshare: 0.66,
    sentiment: 92.1
  },
  {
    id: '3',
    name: 'Clem 🚀',
    current: 0.74,
    delta7d: 260,
    delta30d: 21,
    delta3m: 29,
    delta6m: 34,
    absoluteChange: 260,
    relativeChange: 21.8,
    rank: 3,
    category: 'miner',
    tokens: 11240,
    submissions: 267,
    mindshare: 0.74,
    sentiment: 78.9
  },
  {
    id: '4',
    name: 'voh',
    current: 0.50,
    delta7d: 250,
    delta30d: 19,
    delta3m: 22,
    delta6m: 31,
    absoluteChange: 250,
    relativeChange: 19.2,
    rank: 4,
    category: 'miner',
    tokens: 10150,
    submissions: 234,
    mindshare: 0.50,
    sentiment: 85.4
  },
  {
    id: '5',
    name: 'nathanh.eth',
    current: 0.36,
    delta7d: 170,
    delta30d: 18,
    delta3m: 29,
    delta6m: 32,
    absoluteChange: 170,
    relativeChange: 18.7,
    rank: 5,
    category: 'project',
    tokens: 9830,
    submissions: 221,
    mindshare: 0.36,
    sentiment: 73.2,
    price: 0.0784,
    marketCap: 248920000,
    volume24h: 39.39
  }
];

const mockTopLosers: LeaderboardEntry[] = [
  {
    id: '6',
    name: 'Unipcs (aka @fikachu)',
    current: 0.47,
    delta7d: -310,
    delta30d: -34,
    delta3m: -50,
    delta6m: -80,
    absoluteChange: -310,
    relativeChange: -34.2,
    rank: 6,
    category: 'yapper',
    tokens: 8420,
    submissions: 156,
    mindshare: 0.47,
    sentiment: 45.2
  },
  {
    id: '7',
    name: 'Ansem',
    current: 0.09,
    delta7d: -380,
    delta30d: -27,
    delta3m: -26,
    delta6m: -16,
    absoluteChange: -380,
    relativeChange: -27.1,
    rank: 7,
    category: 'yapper',
    tokens: 7234,
    submissions: 142,
    mindshare: 0.09,
    sentiment: 38.7
  }
];

export default function AdvancedLeaderboard() {
  const [viewMode, setViewMode] = useState<'list' | 'treemap'>('treemap')
  const [timeFilter, setTimeFilter] = useState<'7D' | '30D' | '3M' | '6M' | '12M'>('30D')
  const [metricFilter, setMetricFilter] = useState<'mindshare' | 'mindshare_delta' | 'sentiment' | 'sentiment_delta' | 'market_cap' | 'market_cap_delta'>('mindshare')
  const [sortFilter, setSortFilter] = useState<'highest_first' | 'lowest_first'>('highest_first')
  const [showTopGainers, setShowTopGainers] = useState(true)
  const [activeCategory, setActiveCategory] = useState<'all' | 'miners' | 'yappers' | 'projects'>('all')

  const generateTreemapData = (): TreemapItem[] => {
    const allData = [...mockLeaderboardData, ...mockTopLosers]
    return allData.slice(0, 20).map((entry, index) => {
      const changeValue = metricFilter.includes('delta') ? entry.relativeChange : entry.mindshare * 100
      const isPositive = changeValue >= 0
      
      return {
        id: entry.id,
        name: entry.name.length > 15 ? entry.name.substring(0, 12) + '...' : entry.name,
        value: Math.abs(changeValue),
        change: changeValue,
        color: isPositive ? 
          (changeValue > 20 ? '#10b981' : changeValue > 10 ? '#34d399' : '#6ee7b7') :
          (changeValue < -20 ? '#ef4444' : changeValue < -10 ? '#f87171' : '#fca5a5'),
        size: Math.max(0.5, entry.mindshare * 100)
      }
    })
  }

  const TreemapView = () => {
    const data = generateTreemapData()
    
    // Define the exact layout pattern from yaps.kaito.ai
    const getGridClass = (index: number) => {
      switch (index) {
        case 0: return 'col-span-2 row-span-2' // Top performer - large square
        case 1: return 'col-span-2 row-span-2' // Second performer - large square
        case 2: return 'col-span-1 row-span-2' // Third - tall rectangle
        case 3: return 'col-span-1 row-span-2' // Fourth - tall rectangle  
        case 4: return 'col-span-1 row-span-2' // Fifth - tall rectangle
        case 5: return 'col-span-1 row-span-1' // Small squares from here
        case 6: return 'col-span-1 row-span-1'
        case 7: return 'col-span-1 row-span-1'
        case 8: return 'col-span-1 row-span-1'
        case 9: return 'col-span-1 row-span-1'
        case 10: return 'col-span-1 row-span-1'
        case 11: return 'col-span-1 row-span-1'
        case 12: return 'col-span-1 row-span-1'
        case 13: return 'col-span-1 row-span-1'
        case 14: return 'col-span-1 row-span-1'
        case 15: return 'col-span-1 row-span-1'
        case 16: return 'col-span-1 row-span-1'
        case 17: return 'col-span-1 row-span-1'
        case 18: return 'col-span-1 row-span-1'
        case 19: return 'col-span-1 row-span-1'
        default: return 'col-span-1 row-span-1'
      }
    }

    // Color scheme based on performance tiers (matching yaps.kaito.ai)
    const getPerformanceColor = (value: number, index: number) => {
      if (index === 0) return '#8B4513' // Brown for top performer
      if (value > 0.6) return '#1F4E3D' // Dark green for high performers
      if (value > 0.5) return '#7C2D92' // Purple for mid-high performers
      if (value > 0.4) return '#8B5A8C' // Magenta for mid performers
      if (value > 0.35) return '#2D4A3E' // Medium green for decent performers
      if (value > 0.3) return '#3D2D4A' // Dark purple for lower-mid
      return '#2D3D4A' // Dark blue-gray for lowest performers
    }

    return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Top20</h3>
            <div className="flex items-center space-x-4">
              {['7D', '30D', '3M', '6M', '12M'].map((period) => (
                <button
                  key={period}
                  onClick={() => setTimeFilter(period as any)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    timeFilter === period 
                      ? 'bg-green-500 text-white' 
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Grid layout matching yaps.kaito.ai exactly */}
        <div className="grid grid-cols-6 grid-rows-4 gap-2 h-96">
          {data.map((item, index) => {
            const gridClass = getGridClass(index)
            const bgColor = getPerformanceColor(item.value, index)
            
            return (
              <div
                key={item.id}
                className={`${gridClass} rounded-lg p-3 flex flex-col justify-between transition-all hover:scale-105 cursor-pointer relative overflow-hidden`}
                style={{ backgroundColor: bgColor }}
              >
                {/* Content based on size */}
                {index < 2 && (
                  // Large boxes (2x2) - Full content
                  <div className="h-full flex flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div className="text-white">
                        <div className="flex items-center space-x-2 mb-2">
                          {index === 0 && <TrophyIcon className="h-4 w-4 text-yellow-400" />}
                          <span className="text-sm font-semibold">{item.name}</span>
                        </div>
                        <div className="text-lg font-bold">
                          {item.value.toFixed(2)}%
                        </div>
                      </div>
                      <div className="text-white/80">
                        {item.change >= 0 ? (
                          <ArrowUpIcon className="h-4 w-4" />
                        ) : (
                          <ArrowDownIcon className="h-4 w-4" />
                        )}
                      </div>
                    </div>
                    <div className="text-white/80 text-xs">
                      {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                    </div>
                  </div>
                )}
                
                {index >= 2 && index < 5 && (
                  // Medium boxes (1x2) - Compact content
                  <div className="h-full flex flex-col justify-between">
                    <div className="text-white">
                      <div className="text-xs font-medium mb-1 truncate">
                        {item.name}
                      </div>
                      <div className="text-sm font-bold">
                        {item.value.toFixed(2)}%
                      </div>
                    </div>
                    <div className="text-white/80 text-xs">
                      {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}%
                    </div>
                  </div>
                )}
                
                {index >= 5 && (
                  // Small boxes (1x1) - Minimal content
                  <div className="h-full flex flex-col justify-center">
                    <div className="text-white text-center">
                      <div className="text-xs font-medium mb-1 truncate">
                        {item.name.length > 8 ? item.name.substring(0, 6) + '...' : item.name}
                      </div>
                      <div className="text-xs font-bold">
                        {item.value.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Performance indicator overlay for large boxes */}
                {index < 2 && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white/30"></div>
                )}
              </div>
            )
          })}
        </div>

        {/* Grid explanation */}
        <div className="mt-4 text-xs text-gray-400 flex items-center justify-between">
          <span>Sorted by mindshare percentage • Updates every hour</span>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#8B4513' }}></div>
              <span>Top Performer</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#1F4E3D' }}></div>
              <span>High Performance</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#7C2D92' }}></div>
              <span>Mid Performance</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const ListView = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 overflow-hidden">
      <div className="p-6 border-b border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">CT Yapper Mindshare</h3>
          <button className="text-green-400 hover:text-green-300 text-sm font-medium">
            See Top 100 ↗
          </button>
        </div>
        
        <div className="flex items-center space-x-4 mb-4">
          <div className="relative">
            <select 
              value={metricFilter}
              onChange={(e) => setMetricFilter(e.target.value as any)}
              className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm appearance-none pr-8"
            >
              <option value="mindshare">Mindshare</option>
              <option value="mindshare_delta">Mindshare Δ</option>
              <option value="sentiment">Sentiment</option>
              <option value="sentiment_delta">Sentiment Δ</option>
              <option value="market_cap">Market Cap</option>
              <option value="market_cap_delta">Market Cap Δ</option>
            </select>
            <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
          
          <div className="relative">
            <select 
              value={sortFilter}
              onChange={(e) => setSortFilter(e.target.value as any)}
              className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm appearance-none pr-8"
            >
              <option value="highest_first">Highest first</option>
              <option value="lowest_first">Lowest first</option>
            </select>
            <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>

          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <ClockIcon className="h-4 w-4" />
            <span>Now</span>
          </div>
          
          <div className="flex items-center space-x-4">
            {['7D', '1M', '3M', 'YTD'].map((period) => (
              <button
                key={period}
                onClick={() => setTimeFilter(period as any)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  timeFilter === period 
                    ? 'bg-green-500 text-white' 
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top Gainer/Loser Section */}
      <div className="p-6 border-b border-gray-700/50">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Gainer */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                <span>Top Gainer</span>
                <div className="flex items-center space-x-1 text-xs">
                  <span className="text-green-400">Δ Absolute (bps)</span>
                  <span className="text-gray-400">Δ Relative (%)</span>
                </div>
              </h4>
            </div>
            
            <div className="space-y-3">
              {mockLeaderboardData.slice(0, 5).map((entry, index) => (
                <div key={entry.id} className="flex items-center justify-between py-2 hover:bg-gray-700/30 rounded-lg px-2 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className={`${
                      index === 0 ? 'bg-yellow-500' :
                      index === 1 ? 'bg-gray-400' :
                      index === 2 ? 'bg-orange-600' :
                      'bg-gray-600'
                    } w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold`}>
                      {index < 3 ? <TrophyIcon className="h-3 w-3" /> : index + 1}
                    </div>
                    <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-xs">{entry.name[0]}</span>
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium">{entry.name}</div>
                      <div className="text-gray-400 text-xs">{entry.mindshare.toFixed(2)}%</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-4 text-sm">
                      <span className="text-green-400">+{entry.delta7d}bps</span>
                      <span className="text-green-400">+{entry.delta30d}bps</span>
                      <span className="text-green-400">+{entry.delta3m}bps</span>
                      <span className="text-green-400">+{entry.delta6m}bps</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Loser */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                <span>Top Loser</span>
                <div className="flex items-center space-x-1 text-xs">
                  <span className="text-green-400">Δ Absolute (bps)</span>
                  <span className="text-gray-400">Δ Relative (%)</span>
                </div>
              </h4>
            </div>
            
            <div className="space-y-3">
              {mockTopLosers.map((entry, index) => (
                <div key={entry.id} className="flex items-center justify-between py-2 hover:bg-gray-700/30 rounded-lg px-2 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {entry.rank}
                    </div>
                    <div className="w-8 h-8 bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-xs">{entry.name[0]}</span>
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium">{entry.name}</div>
                      <div className="text-gray-400 text-xs">{entry.mindshare.toFixed(2)}%</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-4 text-sm">
                      <span className="text-red-400">{entry.delta7d}bps</span>
                      <span className="text-red-400">{entry.delta30d}bps</span>
                      <span className="text-red-400">{entry.delta3m}bps</span>
                      <span className="text-red-400">{entry.delta6m}bps</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="mt-4 text-xs text-gray-400">
          Data updates every hour
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Leaderboards</h2>
          <p className="text-gray-400">Real-time rankings and mindshare analytics</p>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Category Filter */}
          <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-1 border border-gray-700">
            {[
              { key: 'all', label: 'All', icon: ChartBarIcon },
              { key: 'miners', label: 'Miners', icon: CpuChipIcon },
              { key: 'yappers', label: 'Yappers', icon: MegaphoneIcon },
              { key: 'projects', label: 'Projects', icon: RocketLaunchIcon },
            ].map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.key}
                  onClick={() => setActiveCategory(category.key as any)}
                  className={`${
                    activeCategory === category.key
                      ? 'bg-orange-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  } px-3 py-2 rounded-lg font-medium transition-all flex items-center space-x-2 text-sm`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{category.label}</span>
                </button>
              )
            })}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-1 border border-gray-700">
            <button
              onClick={() => setViewMode('treemap')}
              className={`${
                viewMode === 'treemap'
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:text-white'
              } px-3 py-2 rounded-lg transition-all flex items-center space-x-2`}
            >
              <Squares2X2Icon className="h-4 w-4" />
              <span className="text-sm font-medium">Treemap</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`${
                viewMode === 'list'
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:text-white'
              } px-3 py-2 rounded-lg transition-all flex items-center space-x-2`}
            >
              <ListBulletIcon className="h-4 w-4" />
              <span className="text-sm font-medium">List</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'treemap' ? <TreemapView /> : <ListView />}
    </div>
  )
} 