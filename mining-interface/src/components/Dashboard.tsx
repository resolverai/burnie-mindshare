import { useState } from 'react'
import { 
  ArrowTrendingUpIcon, ArrowTrendingDownIcon, Squares2X2Icon, ListBulletIcon, ChevronDownIcon, StarIcon, CpuChipIcon, TrophyIcon, SparklesIcon, DocumentTextIcon, BoltIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid
} from '@heroicons/react/24/solid'

interface TreemapCampaign {
  id: string;
  name: string;
  project: string;
  projectLogo: string;
  mindshare: number;
  change: number;
  tokens: number;
  color: string;
}

interface SocialGraphNode {
  id: string;
  name: string;
  avatar: string;
  profilePic: string;
  finalX: number;
  finalY: number;
  size: number;
  mindshare: number;
  type: 'self' | 'friend' | 'collaborator' | 'distant';
  delay: number;
}

interface SmartFeedPost {
  id: string;
  author: string;
  handle: string;
  avatar: string;
  date: string;
  content: string;
  metrics: {
    reposts: number;
    likes: string;
    comments: string;
    shares: number;
    views: string;
  };
  minerContent: string;
}

export default function Dashboard() {
  // State for treemap controls
  const [treemapView, setTreemapView] = useState<'treemap' | 'list'>('treemap')
  const [treemapTimeframe, setTreemapTimeframe] = useState<'7D' | '30D' | '3M'>('7D')
  const [treemapMetric, setTreemapMetric] = useState<'mindshare' | 'delta' | 'quality'>('mindshare')
  
  // State for other controls
  const [activeTimeframe, setActiveTimeframe] = useState<'1d' | '7d' | '30d' | '90d'>('7d')
  const [socialGraphFilter, setSocialGraphFilter] = useState<'top20' | 'top50' | 'top100'>('top20')

  // Mock data and functions (moved inside component)
  const mockTreemapData = [
    { id: 'AIXBT', name: 'AIXBT', logo: '🤖', mindshare: 23.4, delta: 12.5, quality: 92, tokens: 1250 },
    { id: 'VADER', name: 'VADER', logo: '⚡', mindshare: 18.7, delta: -3.2, quality: 87, tokens: 950 },
    { id: 'BASE', name: 'BASE', logo: '🔵', mindshare: 15.2, delta: 8.1, quality: 89, tokens: 780 },
    { id: 'SOL', name: 'SOL', logo: '☀️', mindshare: 12.8, delta: 6.2, quality: 94, tokens: 640 },
    { id: 'MATIC', name: 'MATIC', logo: '🔷', mindshare: 11.3, delta: -1.5, quality: 85, tokens: 470 },
    { id: 'ARB', name: 'ARB', logo: '💎', mindshare: 7.8, delta: 3.7, quality: 88, tokens: 320 },
    { id: 'AVAX', name: 'AVAX', logo: '🔺', mindshare: 6.2, delta: -2.1, quality: 83, tokens: 290 },
    { id: 'DOT', name: 'DOT', logo: '⚫', mindshare: 4.6, delta: 1.8, quality: 81, tokens: 180 }
  ]

  // Get color based on metric value and buckets
  const getTreemapColor = (item: any): string => {
    let value: number
    switch (treemapMetric) {
      case 'mindshare':
        value = item.mindshare
        break
      case 'delta':
        value = item.delta
        break
      case 'quality':
        value = item.quality
        break
      default:
        value = item.mindshare
    }

    // Color buckets based on metric type
    if (treemapMetric === 'delta') {
      // Delta: red for negative, yellow for small positive, green for high positive
      if (value < -2) return '#dc2626' // red-600
      if (value < 0) return '#f59e0b' // amber-500
      if (value < 5) return '#10b981' // emerald-500
      return '#059669' // emerald-600
    } else if (treemapMetric === 'quality') {
      // Quality: gradient from orange to green (80-100 range)
      if (value < 85) return '#f97316' // orange-500
      if (value < 90) return '#eab308' // yellow-500
      if (value < 95) return '#10b981' // emerald-500
      return '#059669' // emerald-600
    } else {
      // Mindshare: gradient from blue to orange based on percentage
      if (value < 5) return '#3b82f6' // blue-500
      if (value < 10) return '#6366f1' // indigo-500
      if (value < 15) return '#8b5cf6' // violet-500
      if (value < 20) return '#f59e0b' // amber-500
      return '#f97316' // orange-500
    }
  }

  // Calculate treemap layout for column-wise stacking
  const getTreemapLayout = () => {
    // Sort by current metric value in descending order
    const sortedData = [...mockTreemapData].sort((a, b) => {
      const valueA = treemapMetric === 'mindshare' ? a.mindshare : 
                     treemapMetric === 'delta' ? a.delta : a.quality
      const valueB = treemapMetric === 'mindshare' ? b.mindshare : 
                     treemapMetric === 'delta' ? b.delta : b.quality
      return valueB - valueA
    })

    const layouts = []
    const containerHeight = 100 // Full height percentage
    const numColumns = 4 // 4 columns for clean layout
    const columnWidth = 100 / numColumns // 25% each column
    
    // Calculate how many items can fit in each column based on container height
    const itemsPerColumn = Math.ceil(sortedData.length / numColumns)
    
    sortedData.forEach((item, index) => {
      const columnIndex = Math.floor(index / itemsPerColumn)
      const positionInColumn = index % itemsPerColumn
      
      // Calculate heights - larger for top items, smaller for lower items
      let itemHeight
      if (positionInColumn === 0) {
        itemHeight = 45 // Large box for top item in each column
      } else if (positionInColumn === 1) {
        itemHeight = 35 // Medium box for second item
      } else {
        itemHeight = 20 // Small box for remaining items
      }
      
      // Calculate Y position based on previous items in the same column
      let yPosition = 0
      for (let i = 0; i < positionInColumn; i++) {
        if (i === 0) yPosition += 45
        else if (i === 1) yPosition += 35
        else yPosition += 20
      }
      
      // Ensure we don't exceed container height
      if (yPosition + itemHeight > containerHeight) {
        itemHeight = Math.max(15, containerHeight - yPosition)
      }

      layouts.push({
        ...item,
        x: columnIndex * columnWidth,
        y: yPosition,
        width: columnWidth,
        height: itemHeight,
        rank: index + 1,
        isLarge: itemHeight >= 35,
        isMedium: itemHeight >= 25 && itemHeight < 35,
        isSmall: itemHeight < 25
      })
    })

    return layouts.filter(item => item.height > 10) // Filter out items that are too small
  }

  // Generate social graph nodes with proper positioning and collision detection
  const generateSocialGraphData = (): SocialGraphNode[] => {
    const profilePics = [
      '👨‍💼', '👩‍💻', '🧑‍🎨', '👨‍🔬', '👩‍🚀', '🧑‍⚕️', '👨‍🏫', '👩‍🎤',
      '🧑‍💼', '👨‍🎯', '👩‍🔧', '🧑‍🌾', '👨‍🍳', '👩‍🎨', '🧑‍💻', '👨‍⚖️',
      '👩‍🔬', '🧑‍🚀', '👨‍⚕️', '👩‍🏫', '🧑‍🎤', '👨‍🔧', '👩‍🌾', '🧑‍🍳',
      '👨‍🎨', '👩‍🎯', '🧑‍🔧', '👨‍🚀', '👩‍💼'
    ]
    
    const names = [
      'Neural Alpha', 'CryptoSage', 'DeFiMaster', 'MemeBot', 'AITrader', 'NFTQueen',
      'BaseBuilder', 'SolanaWiz', 'EthMiner', 'PolygonDev', 'ChainLink', 'MetaMask',
      'UniSwap', 'OpenSea', 'Binance', 'Coinbase', 'Kraken', 'Gemini', 'FTX', 'KuCoin',
      'Huobi', 'OKEx', 'Bitfinex', 'Bitstamp', 'PancakeSwap', 'Curve', 'Yearn', 'Compound', 'Aave'
    ]

    const mindshareValues = [
      85.5, 72.3, 68.1, 64.2, 59.8, 55.4, 51.2, 48.7, 45.3, 42.1,
      38.9, 35.6, 32.4, 29.8, 26.5, 23.7, 20.9, 18.3, 15.8, 12.4,
      10.2, 8.7, 7.3, 6.1, 5.2, 4.4, 3.8, 3.2, 2.7
    ]

    const containerWidth = 800
    const containerHeight = 400
    const centerX = containerWidth / 2
    const centerY = containerHeight / 2
    const minBubbleDistance = 8

    const placedBubbles: { x: number; y: number; radius: number }[] = []

    const checkCollision = (x: number, y: number, radius: number): boolean => {
      return placedBubbles.some(bubble => {
        const distance = Math.sqrt(Math.pow(x - bubble.x, 2) + Math.pow(y - bubble.y, 2))
        return distance < (radius + bubble.radius + minBubbleDistance)
      })
    }

    const findValidPosition = (nodeSize: number, isCenter: boolean, attempts = 100): { x: number; y: number } => {
      const radius = nodeSize / 2
      const margin = radius + 5
      
      if (isCenter) {
        return { x: centerX, y: centerY }
      }

      for (let i = 0; i < attempts; i++) {
        const x = margin + Math.random() * (containerWidth - 2 * margin)
        const y = margin + Math.random() * (containerHeight - 2 * margin)
        
        if (!checkCollision(x, y, radius)) {
          return { x, y }
        }
      }

      const gridStep = nodeSize * 0.8
      for (let y = margin; y <= containerHeight - margin; y += gridStep) {
        for (let x = margin; x <= containerWidth - margin; x += gridStep) {
          if (!checkCollision(x, y, radius)) {
            return { x, y }
          }
        }
      }

      const maxRadius = Math.min(containerWidth, containerHeight) / 2 - margin
      for (let r = nodeSize; r < maxRadius; r += nodeSize * 0.5) {
        for (let angle = 0; angle < 360; angle += 15) {
          const rad = (angle * Math.PI) / 180
          const x = centerX + Math.cos(rad) * r
          const y = centerY + Math.sin(rad) * r
          
          if (x >= margin && x <= containerWidth - margin && 
              y >= margin && y <= containerHeight - margin &&
              !checkCollision(x, y, radius)) {
            return { x, y }
          }
        }
      }

      return { x: Math.max(margin, Math.min(containerWidth - margin, centerX + Math.random() * 200 - 100)), 
               y: Math.max(margin, Math.min(containerHeight - margin, centerY + Math.random() * 100 - 50)) }
    }

    return names.slice(0, 29).map((name, index) => {
      const mindshare = mindshareValues[index]
      const nodeSize = 30 + (mindshare / 100) * 40
      const isCenter = index === 0
      
      const position = findValidPosition(nodeSize, isCenter)
      
      placedBubbles.push({
        x: position.x,
        y: position.y,
        radius: nodeSize / 2
      })

      return {
        id: `node${index}`,
        name,
        avatar: profilePics[index % profilePics.length],
        profilePic: profilePics[index % profilePics.length],
        finalX: position.x,
        finalY: position.y,
        size: nodeSize,
        mindshare,
        type: index === 0 ? 'self' : 
              index < 6 ? 'friend' : 
              index < 15 ? 'collaborator' : 'distant',
        delay: index * 0.08
      }
    })
  }

  const mockSocialGraphData = generateSocialGraphData()

  const mockMindshareData = [
    { date: 'Apr 14', value: 2.3 },
    { date: 'Apr 15', value: 3.7 },
    { date: 'Apr 16', value: 2.8 },
    { date: 'Apr 17', value: 4.2 },
    { date: 'Apr 18', value: 5.1 },
    { date: 'Apr 19', value: 3.9 },
    { date: 'Apr 20', value: 6.2 }
  ]

  const mockSmartFeedData: SmartFeedPost[] = [
    {
      id: '1',
      author: 'Solana Protocol',
      handle: '@solana',
      avatar: '☀️',
      date: 'Apr 18',
      content: 'We are rolling out text posts on @zora. You can post text on web currently by just typing in the create box.',
      metrics: {
        reposts: 17,
        likes: '261',
        comments: '68',
        shares: 15,
        views: '32.03K'
      },
      minerContent: 'AI-generated updates about platform features'
    },
    {
      id: '2',
      author: 'Base Protocol',
      handle: '@base',
      avatar: '🔵',
      date: 'Apr 17',
      content: 'Base is now live! Build onchain with the security of Ethereum and the speed of Coinbase. Start building today with our developer tools and ecosystem partners.',
      metrics: {
        reposts: 156,
        likes: '2.4K',
        comments: '892',
        shares: 89,
        views: '156.7K'
      },
      minerContent: 'AI-generated content about L2 scaling solutions'
    },
    {
      id: '3',
      author: 'AIXBT AI',
      handle: '@aixbt_agent',
      avatar: '🤖',
      date: 'Apr 16',
      content: 'Market update: DeFi TVL reached $50B+ across all chains. Major growth in lending protocols and yield farming. AI agents are becoming key players in automated trading strategies.',
      metrics: {
        reposts: 87,
        likes: '1.2K',
        comments: '234',
        shares: 45,
        views: '87.3K'
      },
      minerContent: 'AI-generated market analysis and DeFi insights'
    },
    {
      id: '4',
      author: 'Ethereum',
      handle: '@ethereum',
      avatar: '💎',
      date: 'Apr 15',
      content: 'The merge anniversary approaches! Ethereum has been proof-of-stake for over a year now, reducing energy consumption by 99.9%. The future is sustainable and scalable.',
      metrics: {
        reposts: 203,
        likes: '3.1K',
        comments: '567',
        shares: 128,
        views: '245.8K'
      },
      minerContent: 'AI-generated content about blockchain sustainability'
    },
    {
      id: '5',
      author: 'Polygon Labs',
      handle: '@0xPolygon',
      avatar: '🔷',
      date: 'Apr 14',
      content: 'Polygon zkEVM mainnet beta is now live! Experience Ethereum-equivalent security with near-instant finality. Developers can deploy existing smart contracts without modification.',
      metrics: {
        reposts: 94,
        likes: '1.8K',
        comments: '312',
        shares: 67,
        views: '123.5K'
      },
      minerContent: 'AI-generated updates about zero-knowledge technology'
    },
    {
      id: '6',
      author: 'Coinbase',
      handle: '@coinbase',
      avatar: '🟦',
      date: 'Apr 13',
      content: 'Introducing Coinbase Wallet SDK 2.0! Build seamless Web3 experiences with improved security, better UX, and cross-platform support. The future of finance is here.',
      metrics: {
        reposts: 142,
        likes: '2.7K',
        comments: '489',
        shares: 98,
        views: '198.4K'
      },
      minerContent: 'AI-generated content about Web3 development tools'
    }
  ]

  // Generate trend data for each item
  const generateTrendData = (baseValue: number, isPositive: boolean) => {
    const points = []
    let currentValue = baseValue * 0.8 // Start 20% lower
    
    for (let i = 0; i < 20; i++) {
      const variation = (Math.random() - 0.5) * 0.1 * baseValue
      const trend = isPositive ? i * 0.05 * baseValue : -i * 0.02 * baseValue
      currentValue += variation + trend
      points.push(Math.max(0, currentValue))
    }
    
    return points
  }

  const renderTreemap = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white">Mindshare Campaigns</h3>
        <div className="flex items-center space-x-4">
          {/* Metric Selection Dropdown */}
          <div className="flex bg-gray-700 rounded-lg p-1">
            <select
              value={treemapMetric}
              onChange={(e) => setTreemapMetric(e.target.value as 'mindshare' | 'delta' | 'quality')}
              className="bg-transparent text-white text-sm px-3 py-1 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="mindshare" className="bg-gray-700">Mindshare %</option>
              <option value="delta" className="bg-gray-700">Mindshare Δ%</option>
              <option value="quality" className="bg-gray-700">Content Quality</option>
            </select>
          </div>

          {/* View Toggle */}
          <div className="flex bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setTreemapView('treemap')}
              className={`p-2 rounded transition-all ${
                treemapView === 'treemap' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
            </button>
            <button
              onClick={() => setTreemapView('list')}
              className={`p-2 rounded transition-all ${
                treemapView === 'list' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 000 2h14a1 1 0 100-2H3zM3 8a1 1 0 000 2h14a1 1 0 100-2H3zM3 12a1 1 0 100 2h14a1 1 0 100-2H3z" />
              </svg>
            </button>
          </div>

          {/* Timeframe Selection */}
          <div className="flex bg-gray-700 rounded-lg p-1">
            {(['7D', '30D', '3M'] as const).map((timeframe) => (
              <button
                key={timeframe}
                onClick={() => setTreemapTimeframe(timeframe)}
                className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                  treemapTimeframe === timeframe
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                {timeframe}
              </button>
            ))}
          </div>
        </div>
      </div>

      {treemapView === 'treemap' ? (
        <div className="relative w-full h-80 bg-gray-900/50 rounded-lg overflow-hidden p-2">
          {getTreemapLayout().map((item) => {
            const currentValue = treemapMetric === 'mindshare' ? item.mindshare : 
                                treemapMetric === 'delta' ? item.delta : item.quality
            const isPositiveTrend = treemapMetric === 'delta' ? currentValue > 0 : true
            const trendPoints = generateTrendData(currentValue, isPositiveTrend)
            
            // Create SVG path for trend line
            const svgWidth = 60
            const svgHeight = 20
            const maxValue = Math.max(...trendPoints)
            const minValue = Math.min(...trendPoints)
            const valueRange = maxValue - minValue || 1
            
            const pathData = trendPoints.map((point, index) => {
              const x = (index / (trendPoints.length - 1)) * svgWidth
              const y = svgHeight - ((point - minValue) / valueRange) * svgHeight
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
            }).join(' ')

            return (
              <div
                key={item.id}
                className="absolute rounded-lg border border-gray-600/30 cursor-pointer hover:border-orange-500/50 transition-all duration-200 overflow-hidden"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  width: `${item.width - 0.5}%`, // Small gap between columns
                  height: `${item.height}%`,
                  backgroundColor: getTreemapColor(item),
                }}
              >
                {/* Rank Badge for top 3 */}
                {item.rank <= 3 && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-black">
                      {item.rank === 1 ? '👑' : item.rank === 2 ? '🥈' : '🥉'}
                    </span>
                  </div>
                )}

                <div className="p-3 h-full flex flex-col justify-between">
                  {/* Header with logo and name */}
                  <div className="flex items-center space-x-2">
                    <div className={`${item.isLarge ? 'text-2xl' : item.isMedium ? 'text-lg' : 'text-sm'}`}>
                      {item.logo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-bold text-white truncate ${item.isLarge ? 'text-base' : item.isMedium ? 'text-sm' : 'text-xs'}`}>
                        {item.name}
                      </div>
                      {!item.isSmall && (
                        <div className="text-gray-300 text-xs opacity-75">
                          {treemapMetric === 'mindshare' ? 'Mindshare' :
                           treemapMetric === 'delta' ? 'Change' : 'Quality'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Value Display */}
                  <div className="mt-2">
                    <div className={`font-bold text-white ${item.isLarge ? 'text-xl' : item.isMedium ? 'text-lg' : 'text-sm'}`}>
                      {treemapMetric === 'delta' ? 
                        `${currentValue > 0 ? '+' : ''}${currentValue.toFixed(2)}%` :
                        `${currentValue.toFixed(2)}${treemapMetric === 'quality' ? '' : '%'}`
                      }
                    </div>
                  </div>

                  {/* Trend Chart - only for medium and large boxes */}
                  {!item.isSmall && (
                    <div className="mt-2 flex items-end">
                      <svg 
                        width={svgWidth} 
                        height={svgHeight} 
                        className="opacity-80"
                      >
                        <defs>
                          <linearGradient id={`gradient-${item.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop 
                              offset="0%" 
                              stopColor={isPositiveTrend ? '#10b981' : '#ef4444'} 
                              stopOpacity="0.1" 
                            />
                            <stop 
                              offset="100%" 
                              stopColor={isPositiveTrend ? '#10b981' : '#ef4444'} 
                              stopOpacity="0.8" 
                            />
                          </linearGradient>
                        </defs>
                        
                        {/* Fill area under curve */}
                        <path
                          d={`${pathData} L ${svgWidth} ${svgHeight} L 0 ${svgHeight} Z`}
                          fill={`url(#gradient-${item.id})`}
                        />
                        
                        {/* Trend line */}
                        <path
                          d={pathData}
                          stroke={isPositiveTrend ? '#10b981' : '#ef4444'}
                          strokeWidth="1.5"
                          fill="none"
                          opacity="0.9"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Token count for large boxes only */}
                  {item.isLarge && (
                    <div className="mt-1">
                      <div className="text-gray-300 text-xs">
                        {item.tokens.toLocaleString()} tokens
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {mockTreemapData
            .sort((a, b) => {
              const valueA = treemapMetric === 'mindshare' ? a.mindshare : 
                           treemapMetric === 'delta' ? a.delta : a.quality
              const valueB = treemapMetric === 'mindshare' ? b.mindshare : 
                           treemapMetric === 'delta' ? b.delta : b.quality
              return valueB - valueA
            })
            .map((item, index) => {
              const currentValue = treemapMetric === 'mindshare' ? item.mindshare : 
                                 treemapMetric === 'delta' ? item.delta : item.quality
              return (
                <div key={item.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700/50">
                  <div className="flex items-center space-x-3">
                    <div className="text-xl">{item.logo}</div>
                    <div>
                      <div className="font-semibold text-white">{item.name}</div>
                      <div className="text-gray-400 text-sm">Tokens: {item.tokens.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-white text-lg">
                      {treemapMetric === 'delta' ? 
                        `${currentValue > 0 ? '+' : ''}${currentValue.toFixed(1)}%` :
                        `${currentValue.toFixed(1)}${treemapMetric === 'quality' ? '' : '%'}`
                      }
                    </div>
                    <div className="text-gray-400 text-sm">
                      {treemapMetric === 'mindshare' ? 'Mindshare' :
                       treemapMetric === 'delta' ? 'Delta' : 'Quality'}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )

  const renderBullishProjects = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-8">
      <h3 className="text-xl font-bold text-white mb-6">Bullish Projects</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mockTreemapData.slice(0, 2).map((project) => (
          <div key={project.id} className="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50">
            <div className="flex items-center space-x-3 mb-3">
              <div className="text-2xl">{project.logo}</div>
              <div>
                <div className="font-semibold text-white">{project.name}</div>
                <div className="text-sm text-gray-400">Mindshare: {project.mindshare}%</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-400">
                <div className={`font-semibold ${project.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {project.delta >= 0 ? '+' : ''}{project.delta.toFixed(1)}% change
                </div>
              </div>
              <div className="text-sm">
                <div className="text-orange-400 font-semibold">{project.tokens.toLocaleString()}</div>
                <div className="text-gray-400">tokens</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderMindshareGraph = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white">Mindshare Growth</h3>
        <div className="flex items-center space-x-2">
          <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium border border-blue-500/30">
            Avg. Mindshare (7D): 0.025%
          </span>
          <span className="text-sm text-gray-400">3K Smart Followers</span>
        </div>
      </div>
      <div className="relative h-80">
        <svg className="w-full h-full" viewBox="0 0 800 320">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(percent => (
            <line
              key={percent}
              x1="40"
              y1={`${(percent / 100) * 260 + 20}`}
              x2="760"
              y2={`${(percent / 100) * 260 + 20}`}
              stroke="#374151"
              strokeWidth="1"
              opacity="0.3"
            />
          ))}
          
          {/* Bar chart */}
          {mockMindshareData.map((item, index) => {
            const barHeight = (item.value / 0.07) * 240
            const x = 80 + (index * 100)
            return (
              <rect
                key={index}
                x={x - 25}
                y={290 - barHeight}
                width="50"
                height={barHeight}
                fill="#60a5fa"
                opacity="0.7"
                rx="3"
              />
            )
          })}
          
          {/* Trend line */}
          <polyline
            points={mockMindshareData.map((item, index) => {
              const x = 80 + (index * 100)
              const y = 290 - (item.value / 0.07) * 240
              return `${x},${y}`
            }).join(' ')}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Data points */}
          {mockMindshareData.map((item, index) => {
            const x = 80 + (index * 100)
            const y = 290 - (item.value / 0.07) * 240
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r="5"
                fill="#8b5cf6"
                stroke="#ffffff"
                strokeWidth="3"
              />
            )
          })}

          {/* X-axis labels */}
          {['2025', 'Apr 14', 'Apr 15', 'Apr 16', 'Apr 17', 'Apr 18', 'Apr 19'].map((label, index) => (
            <text
              key={label}
              x={80 + (index * 100)}
              y="310"
              textAnchor="middle"
              fontSize="14"
              fill="#9ca3af"
            >
              {label}
            </text>
          ))}

          {/* Y-axis labels */}
          {['0%', '0.02%', '0.04%', '0.06%', '0.08%'].map((label, index) => (
            <text
              key={label}
              x="25"
              y={295 - (index * 65)}
              textAnchor="end"
              fontSize="14"
              fill="#9ca3af"
            >
              {label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )

  const renderSocialGraph = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-white">Agent Social Network</h3>
        <div className="flex bg-gray-700 rounded-lg p-1">
          {(['top20', 'top50', 'top100'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setSocialGraphFilter(filter)}
              className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                socialGraphFilter === filter
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {filter === 'top20' ? 'Top 20' : filter === 'top50' ? 'Top 50' : 'Top 100'}
            </button>
          ))}
        </div>
      </div>
      <div className="relative w-full h-96 bg-gray-900/50 rounded-lg overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 800 400">
          {/* Render bubbles with reliable center ejection animation */}
          {mockSocialGraphData.slice(0, socialGraphFilter === 'top20' ? 20 : socialGraphFilter === 'top50' ? 25 : 29).map((node, index) => {
            const centerX = 400
            const centerY = 200
            
            return (
              <g key={node.id}>
                {/* Bubble circle with gradient */}
                <defs>
                  <radialGradient id={`gradient-${node.id}`}>
                    <stop offset="0%" stopColor={
                      node.type === 'self' ? '#f97316' :
                      node.type === 'friend' ? '#10b981' :
                      node.type === 'collaborator' ? '#3b82f6' :
                      '#6b7280'
                    } stopOpacity="0.8" />
                    <stop offset="70%" stopColor={
                      node.type === 'self' ? '#ea580c' :
                      node.type === 'friend' ? '#059669' :
                      node.type === 'collaborator' ? '#2563eb' :
                      '#4b5563'
                    } stopOpacity="0.6" />
                    <stop offset="100%" stopColor={
                      node.type === 'self' ? '#c2410c' :
                      node.type === 'friend' ? '#047857' :
                      node.type === 'collaborator' ? '#1d4ed8' :
                      '#374151'
                    } stopOpacity="0.8" />
                  </radialGradient>
                </defs>
                
                <circle
                  cx={centerX}
                  cy={centerY}
                  r={node.size / 2}
                  fill={`url(#gradient-${node.id})`}
                  stroke={node.type === 'self' ? '#ea580c' : '#374151'}
                  strokeWidth="2"
                  className="cursor-pointer hover:opacity-90 transition-opacity"
                  style={{
                    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
                    transformOrigin: `${centerX}px ${centerY}px`
                  }}
                >
                  {/* Simple center ejection animation */}
                  <animateTransform
                    attributeName="transform"
                    attributeType="XML"
                    type="translate"
                    values={index === 0 ? "0,0" : `0,0; ${node.finalX - centerX},${node.finalY - centerY}`}
                    dur={index === 0 ? "0.1s" : "1.5s"}
                    begin={`${node.delay}s`}
                    fill="freeze"
                    calcMode="spline"
                    keySplines={index === 0 ? "" : "0.25 0.1 0.25 1"}
                    keyTimes={index === 0 ? "" : "0;1"}
                  />
                  
                  {/* Continuous gentle oscillation */}
                  <animateTransform
                    attributeName="transform"
                    attributeType="XML"
                    type="translate"
                    values={`${node.finalX - centerX},${node.finalY - centerY}; ${node.finalX - centerX + Math.sin(index * 2) * 4},${node.finalY - centerY + Math.cos(index * 2) * 3}; ${node.finalX - centerX},${node.finalY - centerY}`}
                    dur="6s"
                    begin={`${node.delay + 1.5}s`}
                    repeatCount="indefinite"
                  />
                </circle>
                
                {/* Profile picture/avatar inside bubble */}
                <text
                  x={centerX}
                  y={centerY + (node.size > 50 ? 6 : 5)}
                  textAnchor="middle"
                  fontSize={node.size > 50 ? "20" : node.size > 35 ? "16" : "14"}
                  fill="white"
                  style={{
                    textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                    fontWeight: 'bold',
                    transformOrigin: `${centerX}px ${centerY}px`
                  }}
                >
                  {/* Follow bubble movement exactly */}
                  <animateTransform
                    attributeName="transform"
                    attributeType="XML"
                    type="translate"
                    values={index === 0 ? "0,0" : `0,0; ${node.finalX - centerX},${node.finalY - centerY}`}
                    dur={index === 0 ? "0.1s" : "1.5s"}
                    begin={`${node.delay}s`}
                    fill="freeze"
                    calcMode="spline"
                    keySplines={index === 0 ? "" : "0.25 0.1 0.25 1"}
                    keyTimes={index === 0 ? "" : "0;1"}
                  />
                  
                  <animateTransform
                    attributeName="transform"
                    attributeType="XML"
                    type="translate"
                    values={`${node.finalX - centerX},${node.finalY - centerY}; ${node.finalX - centerX + Math.sin(index * 2) * 4},${node.finalY - centerY + Math.cos(index * 2) * 3}; ${node.finalX - centerX},${node.finalY - centerY}`}
                    dur="6s"
                    begin={`${node.delay + 1.5}s`}
                    repeatCount="indefinite"
                  />
                  
                  {node.profilePic}
                </text>
                
                {/* Name label below bubble (only for larger bubbles) */}
                {node.size > 35 && (
                  <text
                    x={centerX}
                    y={centerY + node.size / 2 + 14}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#d1d5db"
                    className="font-medium"
                    style={{
                      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                      transformOrigin: `${centerX}px ${centerY}px`
                    }}
                  >
                    <animateTransform
                      attributeName="transform"
                      attributeType="XML"
                      type="translate"
                      values={index === 0 ? "0,0" : `0,0; ${node.finalX - centerX},${node.finalY - centerY}`}
                      dur={index === 0 ? "0.1s" : "1.5s"}
                      begin={`${node.delay}s`}
                      fill="freeze"
                      calcMode="spline"
                      keySplines={index === 0 ? "" : "0.25 0.1 0.25 1"}
                      keyTimes={index === 0 ? "" : "0;1"}
                    />
                    
                    <animateTransform
                      attributeName="transform"
                      attributeType="XML"
                      type="translate"
                      values={`${node.finalX - centerX},${node.finalY - centerY}; ${node.finalX - centerX + Math.sin(index * 2) * 4},${node.finalY - centerY + Math.cos(index * 2) * 3}; ${node.finalX - centerX},${node.finalY - centerY}`}
                      dur="6s"
                      begin={`${node.delay + 1.5}s`}
                      repeatCount="indefinite"
                    />
                    
                    {node.name}
                  </text>
                )}
                
                {/* Mindshare percentage for larger bubbles */}
                {node.size > 45 && (
                  <text
                    x={centerX}
                    y={centerY + node.size / 2 + 26}
                    textAnchor="middle"
                    fontSize="7"
                    fill="#9ca3af"
                    className="font-medium"
                    style={{
                      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                      transformOrigin: `${centerX}px ${centerY}px`
                    }}
                  >
                    <animateTransform
                      attributeName="transform"
                      attributeType="XML"
                      type="translate"
                      values={index === 0 ? "0,0" : `0,0; ${node.finalX - centerX},${node.finalY - centerY}`}
                      dur={index === 0 ? "0.1s" : "1.5s"}
                      begin={`${node.delay}s`}
                      fill="freeze"
                      calcMode="spline"
                      keySplines={index === 0 ? "" : "0.25 0.1 0.25 1"}
                      keyTimes={index === 0 ? "" : "0;1"}
                    />
                    
                    <animateTransform
                      attributeName="transform"
                      attributeType="XML"
                      type="translate"
                      values={`${node.finalX - centerX},${node.finalY - centerY}; ${node.finalX - centerX + Math.sin(index * 2) * 4},${node.finalY - centerY + Math.cos(index * 2) * 3}; ${node.finalX - centerX},${node.finalY - centerY}`}
                      dur="6s"
                      begin={`${node.delay + 1.5}s`}
                      repeatCount="indefinite"
                    />
                    
                    {node.mindshare.toFixed(1)}%
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )

  const renderSmartFeed = () => (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
      <div className="flex items-center space-x-3 mb-6">
        <div className="p-2 bg-blue-500/20 rounded-lg">
          <StarIcon className="h-5 w-5 text-blue-400" />
        </div>
        <h3 className="text-xl font-bold text-white">Smart Feed</h3>
      </div>
      <div className="space-y-6">
        {mockSmartFeedData.map((post) => (
          <div key={post.id} className="bg-gray-700/30 rounded-lg p-5">
            <div className="flex items-start space-x-4 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center text-xl flex-shrink-0">
                {post.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="font-semibold text-white">{post.author}</span>
                  <span className="text-gray-400 text-sm">{post.handle}</span>
                  <span className="text-gray-500 text-sm">•</span>
                  <span className="text-gray-500 text-sm">{post.date}</span>
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-4 break-words overflow-wrap-anywhere">
                  {post.content}
                </p>
                
                {/* Miner Content Attribution */}
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <CpuChipIcon className="h-4 w-4 text-orange-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-orange-400">AI-Generated Content Used</span>
                  </div>
                  <p className="text-xs text-gray-300 break-words">{post.minerContent}</p>
                </div>

                {/* Engagement Metrics */}
                <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-gray-400">
                  <div className="flex items-center space-x-1 text-sm">
                    <span>⚡</span>
                    <span>{post.metrics.reposts}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-sm">
                    <span>👍</span>
                    <span>{post.metrics.likes}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-sm">
                    <span>💬</span>
                    <span>{post.metrics.comments}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-sm">
                    <span>🔄</span>
                    <span>{post.metrics.shares}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-sm">
                    <span>👁️</span>
                    <span>{post.metrics.views}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8"
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      <div 
        className="max-w-7xl mx-auto h-full"
        style={{
          overflowY: 'auto',
          paddingRight: '16px',
          // Hide scrollbar for webkit browsers
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE and Edge
        }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        
        {/* Two-column layout like cookie.fun */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-full">
          {/* Left Column - Main Content (2/3 width) */}
          <div className="lg:col-span-2 space-y-8">
            {renderBullishProjects()}
            {renderMindshareGraph()}
            {renderTreemap()}
            {renderSocialGraph()}
          </div>

          {/* Right Column - Smart Feed (1/3 width) */}
          <div className="lg:col-span-1">
            {renderSmartFeed()}
          </div>
        </div>
      </div>
    </div>
  )
} 
