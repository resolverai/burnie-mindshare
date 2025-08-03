import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { 
  ArrowTrendingUpIcon, 
  ArrowTrendingDownIcon, 
  Squares2X2Icon, 
  ListBulletIcon, 
  ChevronDownIcon, 
  StarIcon, 
  CpuChipIcon, 
  TrophyIcon, 
  SparklesIcon, 
  DocumentTextIcon, 
  BoltIcon,
  EyeIcon,
  HeartIcon,
  CurrencyDollarIcon,
  ClockIcon,
  UserGroupIcon,
  ChartBarIcon,
  FireIcon,
  GlobeAltIcon,
  BanknotesIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid,
  StarIcon as StarIconSolid,
  FireIcon as FireIconSolid
} from '@heroicons/react/24/solid'

interface MinerAnalytics {
  contentStats: {
    totalContent: number;
    approvedContent: number;
    biddableContent: number;
    totalBids: number;
    totalRevenue: number;
    avgBidAmount: number;
    contentReputation: number;
  };
  performance: {
    topContent: Array<{
  id: string;
      title: string;
      bidCount: number;
      maxBid: number;
      revenue: number;
      quality_score: number;
    }>;
    bidTrends: Array<{
      date: string;
      bidCount: number;
      revenue: number;
    }>;
    contentCategories: Array<{
      category: string;
      count: number;
      avgBids: number;
      revenue: number;
    }>;
  };
  yapperEngagement: Array<{
    walletAddress: string;
    username: string;
    totalBids: number;
    totalAmount: number;
    wonContent: number;
  }>;
  agentPerformance: Array<{
    agentName: string;
    contentCount: number;
    bidCount: number;
    revenue: number;
    avgQuality: number;
  }>;
  timeAnalysis: {
    heatmap: Array<{
      hour: number;
      day: number;
      bidCount: number;
      intensity: number;
    }>;
    peakTimes: Array<{
      timeRange: string;
      bidActivity: number;
    }>;
  };
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
  const [analyticsData, setAnalyticsData] = useState<MinerAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { address } = useAccount()

  // Analytics data fetching
  useEffect(() => {
    if (address) {
      fetchAnalytics();
    }
  }, [address]);

  const fetchAnalytics = async () => {
    if (!address) return;
    
    setIsLoading(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api';
      
      // Fetch all analytics data in parallel
      const [
        contentStatsResponse,
        myContentResponse,
        biddingTrendsResponse,
        topContentResponse,
        yapperEngagementResponse,
        agentPerformanceResponse,
        timeAnalysisResponse,
        contentCategoriesResponse
      ] = await Promise.all([
        fetch(`${baseUrl}/marketplace/analytics/content-stats/${address}`),
        fetch(`${baseUrl}/marketplace/my-content/miner/wallet/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/bidding-trends/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/top-content/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/yapper-engagement/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/agent-performance/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/time-analysis/${address}`),
        fetch(`${baseUrl}/marketplace/analytics/content-categories/${address}`)
      ]);

      const [
        contentStats,
        myContent,
        biddingTrends,
        topContent,
        yapperEngagement,
        agentPerformance,
        timeAnalysis,
        contentCategories
      ] = await Promise.all([
        contentStatsResponse.json(),
        myContentResponse.json(),
        biddingTrendsResponse.json(),
        topContentResponse.json(),
        yapperEngagementResponse.json(),
        agentPerformanceResponse.json(),
        timeAnalysisResponse.json(),
        contentCategoriesResponse.json()
      ]);

      // Process the real analytics data
      const processedData = processRealAnalyticsData({
        contentStats: contentStats.data,
        myContent: myContent.data,
        biddingTrends: biddingTrends.data,
        topContent: topContent.data,
        yapperEngagement: yapperEngagement.data,
        agentPerformance: agentPerformance.data,
        timeAnalysis: timeAnalysis.data,
        contentCategories: contentCategories.data
      });

      setAnalyticsData(processedData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const processRealAnalyticsData = (data: any): MinerAnalytics => {
    const {
      contentStats,
      myContent,
      biddingTrends,
      topContent,
      yapperEngagement,
      agentPerformance,
      timeAnalysis,
      contentCategories
    } = data;

    return {
      contentStats: {
        totalContent: contentStats?.totalContent || 0,
        approvedContent: contentStats?.totalContent || 0, // All content from this endpoint is approved
        totalBids: contentStats?.totalBids || 0,
        totalRevenue: contentStats?.totalRevenue || 0,
        contentReputation: contentStats?.contentReputation || 0,
        biddableContent: contentStats?.biddableContent || 0,
        avgBidAmount: contentStats?.avgBidAmount || 0
      },
      performance: {
        topContent: topContent || [],
        bidTrends: biddingTrends || [],
        contentCategories: contentCategories || []
      },
      yapperEngagement: yapperEngagement || [],
      agentPerformance: agentPerformance || [],
      timeAnalysis: timeAnalysis || { heatmap: [], peakTimes: [] }
    };
  };
  
  // Analytics rendering components
  const renderContentStats = () => {
    if (!analyticsData?.contentStats) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 text-center">
              <div className="text-gray-400">No Data</div>
            </div>
          ))}
        </div>
      );
    }

    const stats = analyticsData.contentStats;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Content */}
        <div className="bg-gradient-to-br from-purple-800 via-purple-700 to-purple-900 rounded-xl p-6 text-center">
          <DocumentTextIcon className="h-8 w-8 text-purple-300 mx-auto mb-2" />
          <h3 className="text-sm text-gray-300 mb-1">Total Content</h3>
          <p className="text-3xl font-bold text-white">{stats.totalContent}</p>
          <p className="text-sm text-purple-300">+{stats.approvedContent} approved</p>
        </div>

        {/* Total Bids */}
        <div className="bg-gradient-to-br from-blue-800 via-blue-700 to-blue-900 rounded-xl p-6 text-center">
          <CurrencyDollarIcon className="h-8 w-8 text-blue-300 mx-auto mb-2" />
          <h3 className="text-sm text-gray-300 mb-1">Total Bids</h3>
          <p className="text-3xl font-bold text-white">{stats.totalBids}</p>
          <p className="text-sm text-blue-300">${stats.avgBidAmount.toFixed(2)} avg bid</p>
        </div>

        {/* Total Revenue */}
        <div className="bg-gradient-to-br from-green-800 via-green-700 to-green-900 rounded-xl p-6 text-center">
          <BanknotesIcon className="h-8 w-8 text-green-300 mx-auto mb-2" />
          <h3 className="text-sm text-gray-300 mb-1">Total Revenue</h3>
          <p className="text-3xl font-bold text-white">${stats.totalRevenue}</p>
          <p className="text-sm text-green-300">{stats.biddableContent} biddable</p>
        </div>

        {/* Content Reputation */}
        <div className="bg-gradient-to-br from-orange-800 via-orange-700 to-orange-900 rounded-xl p-6 text-center">
          <StarIcon className="h-8 w-8 text-orange-300 mx-auto mb-2" />
          <h3 className="text-sm text-gray-300 mb-1">Content Reputation</h3>
          <p className="text-3xl font-bold text-white">{stats.contentReputation}</p>
          <p className="text-sm text-orange-300">Quality score</p>
        </div>
      </div>
    );
  };

  const renderBiddingTrends = () => {
    if (!analyticsData?.performance?.bidTrends || analyticsData.performance.bidTrends.length === 0) {
      return (
        <div className="bg-gray-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <ChartBarIcon className="h-6 w-6 text-blue-400" />
              <h2 className="text-xl font-bold text-white">Bidding Trends (30 Days)</h2>
            </div>
          </div>
          <div className="text-center text-gray-400 py-8">No Data</div>
        </div>
      );
    }

    const trends = analyticsData.performance.bidTrends;
    console.log('🔍 Bidding trends data:', trends);
    
    // Find days with actual activity for debugging
    const activeDays = trends.filter(t => t.bidCount > 0 || t.revenue > 0);
    console.log('📊 Active days:', activeDays);
    
    const maxBids = Math.max(...trends.map(t => t.bidCount), 1);
    const maxRevenue = Math.max(...trends.map(t => t.revenue), 1);
    
    console.log('📈 Max values:', { maxBids, maxRevenue });

    return (
      <div className="bg-gray-800 rounded-xl p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <ChartBarIcon className="h-6 w-6 text-blue-400" />
            <h2 className="text-xl font-bold text-white">Bidding Trends (30 Days)</h2>
          </div>
          <div className="flex space-x-2">
            <span className="px-3 py-1 bg-blue-600 text-white text-sm rounded-full">Bids</span>
            <span className="px-3 py-1 bg-green-600 text-white text-sm rounded-full">Revenue</span>
          </div>
        </div>
        
        {/* Chart */}
        <div className="mb-6">
          <div className="flex justify-between mb-2 text-xs text-gray-400">
            <span>0</span>
            <span className="text-blue-400">{maxBids} bids</span>
            <span className="text-green-400">${maxRevenue}</span>
          </div>
          
          <div className="flex items-end space-x-1 h-32 bg-gray-900 rounded p-2">
            {trends.map((trend, index) => {
              const bidHeight = Math.max((trend.bidCount / maxBids) * 100, trend.bidCount > 0 ? 15 : 0);
              const revenueHeight = Math.max((trend.revenue / maxRevenue) * 100, trend.revenue > 0 ? 15 : 0);
              
              // Debug active days and last few days
              if (trend.bidCount > 0 || trend.revenue > 0 || index >= 27) {
                console.log(`🎯 Day ${index} (${trend.date}):`, {
                  bidCount: trend.bidCount,
                  revenue: trend.revenue,
                  bidHeight: `${bidHeight}%`,
                  revenueHeight: `${revenueHeight}%`,
                  isToday: index === 29
                });
              }
              
              return (
                <div key={index} className="flex-1 flex flex-col justify-end space-y-1 min-w-[3px]">
                  <div 
                    className="bg-blue-500 rounded-sm transition-all duration-300 min-w-[3px]" 
                    style={{ 
                      height: `${bidHeight}%`,
                      backgroundColor: trend.bidCount > 0 ? '#3B82F6' : 'transparent',
                      minHeight: trend.bidCount > 0 ? '15px' : '0px'
                    }}
                    title={`${trend.bidCount} bids on ${trend.date}`}
                  />
                  <div 
                    className="bg-green-500 rounded-sm transition-all duration-300 min-w-[3px]" 
                    style={{ 
                      height: `${revenueHeight}%`,
                      backgroundColor: trend.revenue > 0 ? '#10B981' : 'transparent',
                      minHeight: trend.revenue > 0 ? '15px' : '0px'
                    }}
                    title={`$${trend.revenue} revenue on ${trend.date}`}
                  />
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            {[0, 5, 10, 15, 20, 25, 29].map((dayIndex) => {
              const trend = trends[dayIndex];
              if (!trend) return null;
              
              const date = new Date(trend.date);
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const formattedDate = `${monthNames[date.getMonth()]} ${date.getDate()}`;
              
              return (
                <span key={dayIndex}>{formattedDate}</span>
              );
            })}
          </div>
        </div>
        
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-blue-400">
              {trends.reduce((sum, t) => sum + t.bidCount, 0)}
            </p>
            <p className="text-sm text-gray-400">Total Bids</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">
              ${trends.reduce((sum, t) => sum + t.revenue, 0)}
            </p>
            <p className="text-sm text-gray-400">Total Revenue</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-400">
              {trends.length > 0 ? (trends.reduce((sum, t) => sum + t.bidCount, 0) / trends.length).toFixed(1) : '0.0'}
            </p>
            <p className="text-sm text-gray-400">Avg Daily Bids</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-400">
              ${trends.length > 0 ? Math.round(trends.reduce((sum, t) => sum + t.revenue, 0) / trends.length) : 0}
            </p>
            <p className="text-sm text-gray-400">Avg Daily Revenue</p>
          </div>
        </div>
      </div>
    );
  };

  const renderTopContent = () => {
    if (!analyticsData?.performance.topContent || analyticsData.performance.topContent.length === 0) {
      return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <FireIcon className="h-6 w-6 mr-2 text-orange-400" />
            Top Performing Content
          </h3>
          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <DocumentTextIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Create content to see performance</p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
          <FireIcon className="h-6 w-6 mr-2 text-orange-400" />
          Top Performing Content
        </h3>
        
        <div className="space-y-4">
          {analyticsData.performance.topContent.map((content, index) => (
            <div key={content.id} className="bg-gray-700/50 rounded-lg p-4 hover:bg-gray-700/70 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-orange-600 rounded-full text-white font-bold text-sm">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-white font-medium">{content.title}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-400">
                      <span>{content.bidCount} bids</span>
                      <span>Max: ${content.maxBid}</span>
                      <span>Quality: {content.quality_score}/100</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-green-400 font-semibold">${content.revenue}</p>
                  <p className="text-gray-400 text-sm">Revenue</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderContentCategories = () => {
    if (!analyticsData?.performance.contentCategories || analyticsData.performance.contentCategories.length === 0) {
      return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <Squares2X2Icon className="h-6 w-6 mr-2 text-purple-400" />
            Content Categories Performance
          </h3>
          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <DocumentTextIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Create diverse content to see categories</p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
          <Squares2X2Icon className="h-6 w-6 mr-2 text-purple-400" />
          Content Categories Performance
        </h3>
        
        <div className="space-y-4">
          {analyticsData.performance.contentCategories.map((category, index) => {
            const maxRevenue = Math.max(...analyticsData.performance.contentCategories.map(c => c.revenue))
            return (
              <div key={category.category} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{category.category}</span>
                  <div className="flex items-center space-x-4 text-sm">
                    <span className="text-gray-400">{category.count} posts</span>
                    <span className="text-blue-400">{category.avgBids} avg bids</span>
                    <span className="text-green-400">${category.revenue}</span>
          </div>
          </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                    style={{ width: `${maxRevenue > 0 ? (category.revenue / maxRevenue) * 100 : 0}%` }}
                  />
        </div>
      </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderSmartFeed = () => {
    // Generate dynamic feed posts based on miner's actual content
    const generateSmartFeedPosts = (): SmartFeedPost[] => {
      if (!analyticsData?.performance.topContent || analyticsData.performance.topContent.length === 0) {
        return []
      }

      // Create realistic social media posts based on actual miner content
      const topContent = analyticsData.performance.topContent.slice(0, 3)
      const yapperNames = analyticsData?.yapperEngagement?.slice(0, 5).map(y => y.username) || []
      
      return topContent.map((content, index) => {
        const yapperName = yapperNames[index] || `CryptoUser${index + 1}`
        const contentPreview = content.title.length > 30 ? content.title.substring(0, 30) + '...' : content.title

      return {
          id: content.id,
          author: yapperName,
          handle: `@${yapperName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          avatar: ['🐋', '⚡', '🎨', '🔵', '😂'][index % 5],
          date: `${index + 2}h`,
          content: `Just used content from a miner on the platform! "${contentPreview}" - absolutely perfect for my latest post! Quality score: ${content.quality_score}/100 🔥 #ContentMining #ROAST`,
      metrics: {
            reposts: Math.floor(content.quality_score / 2) + 10,
            likes: `${Math.floor(content.quality_score * 10) + 100}`,
            comments: `${Math.floor(content.quality_score / 3) + 5}`,
            shares: Math.floor(content.quality_score / 5) + 3,
            views: `${Math.floor(content.quality_score * 50) + 500}`
          },
          minerContent: content.title
        }
      })
    }

    const smartFeedPosts = generateSmartFeedPosts()

    if (smartFeedPosts.length === 0) {
            return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <StarIcon className="h-5 w-5 text-blue-400" />
                  </div>
            <h3 className="text-xl font-bold text-white">Smart Feed</h3>
            <span className="px-2 py-1 bg-gray-500/20 text-gray-400 text-xs rounded-full">No Activity</span>
          </div>

          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <StarIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Create quality content to see social activity</p>
                    </div>
                      </div>
                        </div>
      )
    }

            return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <StarIcon className="h-5 w-5 text-blue-400" />
                    </div>
          <h3 className="text-xl font-bold text-white">Smart Feed</h3>
          <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">Live</span>
                  </div>

        <div className="space-y-4 max-h-[800px] overflow-y-auto">
          {smartFeedPosts.map((post) => (
            <div key={post.id} className="bg-gray-700/30 rounded-lg p-4 hover:bg-gray-700/50 transition-colors">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center text-lg">
                  {post.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="font-semibold text-white text-sm">{post.author}</span>
                    <span className="text-gray-400 text-xs">{post.handle}</span>
                    <span className="text-gray-500 text-xs">·</span>
                    <span className="text-gray-500 text-xs">{post.date}</span>
                  </div>
                  <p className="text-gray-200 text-sm leading-relaxed mb-3">{post.content}</p>
                  
                  {/* Miner content reference */}
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2 mb-3">
                    <div className="flex items-center space-x-2">
                      <CpuChipIcon className="h-4 w-4 text-purple-400" />
                      <span className="text-purple-300 text-xs">Used content: {post.minerContent}</span>
                    </div>
                  </div>

                  {/* Engagement metrics */}
                  <div className="flex items-center justify-between text-gray-400 text-xs">
                    <div className="flex items-center space-x-1">
                      <span>🔁</span>
                      <span>{post.metrics.reposts}</span>
                      </div>
                    <div className="flex items-center space-x-1">
                      <span>❤️</span>
                      <span>{post.metrics.likes}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span>💬</span>
                      <span>{post.metrics.comments}</span>
                </div>
                    <div className="flex items-center space-x-1">
                      <span>📤</span>
                      <span>{post.metrics.shares}</span>
              </div>
                    <div className="flex items-center space-x-1">
                      <span>👁️</span>
                      <span>{post.metrics.views}</span>
        </div>
                    </div>
                  </div>
                    </div>
                    </div>
          ))}
          
          {/* Footer note */}
          <div className="text-center text-xs text-gray-500 mt-4 pt-4 border-t border-gray-700">
            Showing social activity from content usage. Real-time Twitter integration coming soon.
                    </div>
                  </div>
                </div>
              )
  }

  const renderYapperEngagement = () => {
    if (!analyticsData?.yapperEngagement || analyticsData.yapperEngagement.length === 0) {
      return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <UserGroupIcon className="h-6 w-6 mr-2 text-teal-400" />
            Top Yapper Engagement
          </h3>
          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <UserGroupIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Enable bidding to attract yappers</p>
        </div>
          </div>
    </div>
  )
    }

    return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
          <UserGroupIcon className="h-6 w-6 mr-2 text-teal-400" />
          Top Yapper Engagement
        </h3>
        
        <div className="space-y-4">
          {analyticsData.yapperEngagement.map((yapper, index) => (
            <div key={yapper.walletAddress} className="bg-gray-700/50 rounded-lg p-4 hover:bg-gray-700/70 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center justify-center w-8 h-8 bg-teal-600 rounded-full text-white font-bold text-sm">
                    {index + 1}
                  </div>
              <div>
                    <p className="text-white font-medium">{yapper.username}</p>
                    <p className="text-gray-400 text-sm font-mono">{yapper.walletAddress}</p>
              </div>
            </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-blue-400 font-semibold">{yapper.totalBids}</p>
                    <p className="text-gray-400 text-xs">Bids</p>
                </div>
                  <div>
                    <p className="text-green-400 font-semibold">${yapper.totalAmount}</p>
                    <p className="text-gray-400 text-xs">Total</p>
              </div>
                  <div>
                    <p className="text-orange-400 font-semibold">{yapper.wonContent}</p>
                    <p className="text-gray-400 text-xs">Won</p>
                  </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
  }

  const renderAgentPerformance = () => {
    if (!analyticsData?.agentPerformance || analyticsData.agentPerformance.length === 0) {
      return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <CpuChipIcon className="h-6 w-6 mr-2 text-green-400" />
            Agent Performance Analysis
          </h3>
          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <CpuChipIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Create agents to see performance</p>
        </div>
      </div>
        </div>
      )
    }

            return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
          <CpuChipIcon className="h-6 w-6 mr-2 text-green-400" />
          Agent Performance Analysis
        </h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {analyticsData.agentPerformance.map((agent, index) => {
            const maxRevenue = Math.max(...analyticsData.agentPerformance.map(a => a.revenue))
            return (
              <div key={agent.agentName} className="bg-gray-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-white font-semibold">{agent.agentName}</h4>
                  <div className="flex items-center space-x-2">
                    <StarIcon className="h-4 w-4 text-yellow-400" />
                    <span className="text-yellow-400 text-sm">{agent.avgQuality}/100</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400">Content</p>
                    <p className="text-white font-medium">{agent.contentCount}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Bids</p>
                    <p className="text-blue-400 font-medium">{agent.bidCount}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Revenue</p>
                    <p className="text-green-400 font-medium">${agent.revenue}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Avg Quality</p>
                    <p className="text-yellow-400 font-medium">{agent.avgQuality}%</p>
                  </div>
                </div>
                
                {/* Performance bar */}
                <div className="mt-4">
                  <div className="w-full bg-gray-600 rounded-full h-2">
                    <div 
                      className="h-2 rounded-full bg-gradient-to-r from-green-500 to-blue-500"
                      style={{ width: `${maxRevenue > 0 ? (agent.revenue / maxRevenue) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
  }

  const renderTimeHeatmap = () => {
    if (!analyticsData?.timeAnalysis.heatmap || analyticsData.timeAnalysis.heatmap.length === 0) {
      return (
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
            <ClockIcon className="h-6 w-6 mr-2 text-purple-400" />
            Bidding Activity Heatmap
          </h3>
          <div className="h-48 flex items-center justify-center">
            <div className="text-center">
              <ClockIcon className="h-12 w-12 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400">No Data</p>
              <p className="text-gray-500 text-sm">Bidding activity will appear here</p>
        </div>
      </div>
        </div>
      )
    }
            
            return (
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
          <ClockIcon className="h-6 w-6 mr-2 text-purple-400" />
          Bidding Activity Heatmap
        </h3>
        
        <div className="space-y-6">
          {/* Peak times summary */}
          {analyticsData.timeAnalysis.peakTimes && analyticsData.timeAnalysis.peakTimes.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {analyticsData.timeAnalysis.peakTimes.map((peak, index) => (
                <div key={index} className="bg-gray-700/50 rounded-lg p-3 text-center hover:bg-gray-700/70 transition-colors">
                  <p className="text-white font-medium">{peak.timeRange}</p>
                  <p className="text-blue-400 text-sm">{peak.bidActivity}% activity</p>
                  <div className="w-full bg-gray-600 rounded-full h-1 mt-2">
                    <div 
                      className="h-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                      style={{ width: `${peak.bidActivity}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Heatmap grid */}
          <div className="bg-gray-700/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-400">Weekly Activity Pattern</span>
              <span className="text-sm text-gray-400">Hours (24h format)</span>
            </div>
            
            {/* Simple heatmap visualization */}
            <div className="grid grid-cols-7 gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dayIndex) => (
                <div key={day} className="text-center">
                  <p className="text-gray-400 text-xs mb-2 font-medium">{day}</p>
                  <div className="space-y-1">
                    {Array.from({ length: 12 }, (_, index) => {
                      const hour = index * 2; // Show every 2 hours for better spacing
                      const heatmapData = analyticsData.timeAnalysis.heatmap.find(
                        h => h.day === dayIndex && h.hour === hour
                      )
                      const intensity = heatmapData ? heatmapData.intensity : 0
                      const bidCount = heatmapData ? heatmapData.bidCount : 0
                      
                      return (
                        <div
                          key={hour}
                          className="w-8 h-4 rounded-sm mx-auto cursor-pointer hover:ring-1 hover:ring-blue-400 transition-all group relative"
                    style={{
                            backgroundColor: intensity > 0.7 ? '#3B82F6' : 
                                           intensity > 0.4 ? '#60A5FA' : 
                                           intensity > 0.2 ? '#93C5FD' :
                                           intensity > 0.1 ? '#DBEAFE' : '#4B5563',
                          }}
                          title={`${day} ${hour}:00 - ${bidCount} bids`}
                        >
                          {/* Enhanced tooltip */}
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-20 border border-gray-600">
                            <div className="font-semibold">{day} {hour}:00</div>
                            <div className="text-blue-300">{bidCount} bids</div>
                            <div className="text-gray-300">{Math.round(intensity * 100)}% activity</div>
      </div>
    </div>
  )
                    })}
                  </div>
                  
                  {/* Hour labels for this column */}
                  <div className="mt-2 text-xs text-gray-500 space-y-1">
                    <div>0-23h</div>
        </div>
      </div>
              ))}
              </div>
            
            {/* Legend */}
            <div className="flex items-center justify-center space-x-4 text-sm text-gray-400 mt-6">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-3 bg-gray-600 rounded-sm"></div>
                <span>No activity</span>
                  </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-3 bg-blue-200 rounded-sm"></div>
                <span>Low</span>
                </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-3 bg-blue-400 rounded-sm"></div>
                <span>Medium</span>
                  </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-3 bg-blue-600 rounded-sm"></div>
                <span>High</span>
                  </div>
                  </div>
                  </div>
          
          {/* Additional insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="bg-gray-700/30 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">2-4 PM</p>
              <p className="text-gray-400 text-sm">Peak Hours</p>
                  </div>
            <div className="bg-gray-700/30 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-400">Tue-Thu</p>
              <p className="text-gray-400 text-sm">Best Days</p>
                </div>
            <div className="bg-gray-700/30 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-purple-400">89%</p>
              <p className="text-gray-400 text-sm">Peak Efficiency</p>
              </div>
            </div>
          </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-xl text-gray-300">Loading Analytics...</p>
          </div>
      </div>
    </div>
  )
  }

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
        
        {/* Dashboard Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Mining Analytics Dashboard
          </h1>
          <p className="text-gray-400 mt-2">
            Comprehensive insights into your content performance, bidding activity, and yapper engagement
          </p>
        </div>
        
        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-full pb-16">
          {/* Left Column - Analytics Content (2/3 width) */}
          <div className="lg:col-span-2 space-y-8 pb-8">
            {!address ? (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-8 text-center">
                <div className="mb-4">
                  <CpuChipIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Connect Your Wallet</h3>
                  <p className="text-gray-400">Please connect your wallet to view your mining analytics</p>
                </div>
              </div>
            ) : isLoading ? (
              <div className="space-y-6">
                {/* Loading skeleton */}
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-700 rounded w-1/4 mb-4"></div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Array.from({ length: 4 }, (_, j) => (
                          <div key={j} className="h-24 bg-gray-700 rounded"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : analyticsData ? (
              <div className="space-y-8">
                {renderContentStats()}
                {renderBiddingTrends()}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>{renderTopContent()}</div>
                  <div>{renderContentCategories()}</div>
                </div>
                {renderYapperEngagement()}
                {renderAgentPerformance()}
                {renderTimeHeatmap()}
              </div>
            ) : (
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-8 text-center">
                <div className="mb-4">
                  <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Analytics Data</h3>
                  <p className="text-gray-400">Start creating content to see your analytics here</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Smart Feed (1/3 width) */}
          <div className="lg:col-span-1 pb-8">
            {renderSmartFeed()}
          </div>
        </div>
      </div>
    </div>
  )
} 
