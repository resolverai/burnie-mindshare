'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { 
  ChartBarIcon, 
  TrophyIcon, 
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  EyeIcon,
  StarIcon,
  FireIcon,
  UsersIcon,
  CurrencyDollarIcon,
  ClockIcon,
  ShoppingBagIcon,
  GlobeAltIcon,
  CalendarIcon,
  BanknotesIcon,
  PresentationChartLineIcon,
  ChartPieIcon,
  MapIcon,
  LightBulbIcon,
  RocketLaunchIcon,
  HeartIcon,
  TagIcon,
  AcademicCapIcon,
  BeakerIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid,
  StarIcon as StarIconSolid,
  FireIcon as FireIconSolid
} from '@heroicons/react/24/solid'

interface YapperAnalytics {
  financial: {
    overview: any;
    profitability: any;
    trends: any[];
  };
  bidding: {
    competition: any[];
    timePatterns: any[];
    categoryPreferences: any[];
  };
  mindshare: {
    overview: any;
    platforms: any[];
    heatmap: any[];
    predictions: any;
  };
  portfolio: {
    overview: any;
    content: any[];
    topPerformers: any[];
    categoryBreakdown: any;
    insights: any;
  };
}

export default function YapperAnalytics() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'24h' | '7d' | '30d'>('7d')
  const [analyticsData, setAnalyticsData] = useState<YapperAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { address, isConnected } = useAccount()

  // Fetch comprehensive analytics data
  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!address || !isConnected) {
        setAnalyticsData(null)
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

        const [
          financialResponse,
          biddingResponse,
          mindshareResponse,
          portfolioResponse
        ] = await Promise.all([
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/financial/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/bidding/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/mindshare/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/portfolio/${address}`)
        ]);

        const [
          financial,
          bidding,
          mindshare,
          portfolio
        ] = await Promise.all([
          financialResponse.json(),
          biddingResponse.json(),
          mindshareResponse.json(),
          portfolioResponse.json()
        ]);

        setAnalyticsData({
          financial: financial.data || { overview: {}, profitability: {}, trends: [] },
          bidding: bidding.data || { competition: [], timePatterns: [], categoryPreferences: [] },
          mindshare: mindshare.data || { overview: {}, platforms: [], heatmap: [], predictions: {} },
          portfolio: portfolio.data || { overview: {}, content: [], topPerformers: [], categoryBreakdown: {}, insights: {} }
        });
      } catch (error) {
        console.error('Error fetching yapper analytics:', error);
        setAnalyticsData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, [address, isConnected]);

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Connect Your Wallet</h2>
          <p className="text-gray-600">Please connect your wallet to view your yapper analytics</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-1/3 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-300 rounded-xl"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-64 bg-gray-300 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!analyticsData) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No Data Available</h2>
          <p className="text-gray-600">Start bidding on content to see your analytics</p>
        </div>
      </div>
    )
  }

  const renderFinancialOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Net Profit */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 border border-green-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <CurrencyDollarIcon className="h-6 w-6 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">Net Profit</h3>
          </div>
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${
            (analyticsData.financial.profitability.roiPercentage || 0) >= 0 
              ? 'bg-green-100 text-green-700' 
              : 'bg-red-100 text-red-700'
          }`}>
            {(analyticsData.financial.profitability.roiPercentage || 0) >= 0 ? '+' : ''}{analyticsData.financial.profitability.roiPercentage || 0}%
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            ${analyticsData.financial.profitability.netProfit || 0}
          </p>
          <p className="text-sm text-green-600">
            ROI: {analyticsData.financial.profitability.roiPercentage || 0}%
          </p>
        </div>
      </div>

      {/* Total Mindshare */}
      <div className="bg-gradient-to-br from-purple-50 to-pink-100 rounded-xl p-6 border border-purple-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <StarIcon className="h-6 w-6 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">Total Mindshare</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            +{analyticsData.mindshare.overview.avgGrowth?.toFixed(1) || 0}%
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            {analyticsData.mindshare.overview.totalMindshare?.toLocaleString() || 0}
          </p>
          <p className="text-sm text-purple-600">
            Across {analyticsData.mindshare.platforms?.length || 0} platforms
          </p>
        </div>
      </div>

      {/* Win Rate */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-100 rounded-xl p-6 border border-blue-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <TrophyIcon className="h-6 w-6 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Win Rate</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            {analyticsData.financial.overview.totalBids || 0} bids
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            {analyticsData.financial.overview.winRate?.toFixed(1) || 0}%
          </p>
          <p className="text-sm text-blue-600">
            {analyticsData.financial.overview.wonBids || 0} / {analyticsData.financial.overview.totalBids || 0} won
          </p>
        </div>
      </div>

      {/* Total Investment */}
      <div className="bg-gradient-to-br from-orange-50 to-yellow-100 rounded-xl p-6 border border-orange-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <BanknotesIcon className="h-6 w-6 text-orange-600" />
            <h3 className="text-lg font-semibold text-gray-900">Total Invested</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            ${analyticsData.financial.overview.avgBidAmount?.toFixed(0) || 0} avg
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            ${analyticsData.financial.overview.totalInvestment || 0}
          </p>
          <p className="text-sm text-orange-600">
            Current portfolio value
          </p>
        </div>
      </div>
    </div>
  )

  const renderMindshareTracking = () => (
    <div className="bg-white rounded-xl p-6 mb-8 border border-gray-200 shadow-sm">
      <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
        <RocketLaunchIcon className="h-6 w-6 mr-2 text-purple-600" />
        Mindshare Platform Performance
      </h3>
      
      {analyticsData.mindshare.platforms?.length > 0 ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {analyticsData.mindshare.platforms.map((platform: any, index: number) => (
              <div key={platform.name} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-900">{platform.name}</h4>
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                    (platform.monthlyGrowth || 0) >= 0 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {(platform.monthlyGrowth || 0) >= 0 ? '+' : ''}{platform.monthlyGrowth?.toFixed(1) || 0}%
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Current Score:</span>
                    <span className="text-gray-900 font-medium">{platform.currentScore?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ranking:</span>
                    <span className="text-gray-900 font-medium">#{platform.ranking?.toLocaleString() || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Rewards:</span>
                    <span className="text-gray-900 font-medium">{platform.rewards || 0}</span>
                  </div>
                </div>

                {/* Mini line chart */}
                <div className="mt-4 h-16 bg-gray-100 rounded p-2">
                  <div className="flex items-end justify-between h-full">
                    {platform.data?.slice(-7).map((point: any, i: number) => (
                      <div 
                        key={i} 
                        className="bg-purple-500 rounded-sm w-1 transition-all duration-300"
                        style={{ 
                          height: `${Math.max((point.score / Math.max(...platform.data.map((p: any) => p.score))) * 100, 10)}%` 
                        }}
                      />
                    )) || <div className="text-gray-500 text-xs">No data</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Compact Growth Timeline */}
          <div className="mt-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
              <div className="flex items-center">
                <ArrowTrendingUpIcon className="h-5 w-5 mr-2 text-purple-600" />
                30-Day Growth Timeline
              </div>
              <div className="text-sm text-gray-600">
                {analyticsData.mindshare.heatmap?.length > 0 && 
                  `Avg: ${(analyticsData.mindshare.heatmap.reduce((sum: number, day: any) => sum + (day.growth || 0), 0) / analyticsData.mindshare.heatmap.length).toFixed(1)}%`
                }
              </div>
            </h4>
            {analyticsData.mindshare.heatmap?.length > 0 ? (
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
                {/* Compact timeline visualization */}
                <div className="flex items-end justify-between h-20 mb-3">
                  {analyticsData.mindshare.heatmap.map((day: any, index: number) => {
                    const maxGrowth = Math.max(...analyticsData.mindshare.heatmap.map((d: any) => Math.abs(d.growth || 0)));
                    const height = maxGrowth > 0 ? Math.abs(day.growth || 0) / maxGrowth * 100 : 0;
                    const isPositive = (day.growth || 0) >= 0;
                    
                    return (
                      <div 
                        key={index} 
                        className="flex flex-col items-center group cursor-pointer"
                        title={`Day ${index + 1}: ${day.growth?.toFixed(1) || 0}% growth`}
                      >
                        <div 
                          className={`w-1 rounded-full transition-all duration-200 group-hover:w-2 ${
                            isPositive ? 'bg-gradient-to-t from-green-400 to-green-600' : 'bg-gradient-to-t from-red-400 to-red-600'
                          }`}
                          style={{ 
                            height: `${Math.max(height, 8)}%`,
                            minHeight: '4px'
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                
                {/* Growth summary stats */}
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <div className="text-xs text-gray-600">Best Day</div>
                    <div className="text-sm font-semibold text-green-600">
                      +{Math.max(...(analyticsData.mindshare.heatmap.map((d: any) => d.growth || 0))).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <div className="text-xs text-gray-600">Worst Day</div>
                    <div className="text-sm font-semibold text-red-600">
                      {Math.min(...(analyticsData.mindshare.heatmap.map((d: any) => d.growth || 0))).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <div className="text-xs text-gray-600">Positive Days</div>
                    <div className="text-sm font-semibold text-purple-600">
                      {analyticsData.mindshare.heatmap.filter((d: any) => (d.growth || 0) > 0).length}/30
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-purple-100">
                    <div className="text-xs text-gray-600">Streak</div>
                    <div className="text-sm font-semibold text-blue-600">
                      {(() => {
                        let maxStreak = 0;
                        let currentStreak = 0;
                        analyticsData.mindshare.heatmap.forEach((d: any) => {
                          if ((d.growth || 0) > 0) {
                            currentStreak++;
                            maxStreak = Math.max(maxStreak, currentStreak);
                          } else {
                            currentStreak = 0;
                          }
                        });
                        return maxStreak;
                      })()}d
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 bg-gray-50 rounded-lg border border-gray-200">
                <ArrowTrendingUpIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No growth data available</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <RocketLaunchIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Platform Data</h4>
          <p className="text-gray-600">Start engaging with platforms to see your mindshare performance</p>
        </div>
      )}
    </div>
  )

  const renderBiddingPerformance = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* Time Pattern Analysis */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <ClockIcon className="h-6 w-6 mr-2 text-blue-600" />
          Optimal Bidding Times
        </h3>
        
        {analyticsData.bidding.timePatterns?.length > 0 ? (
          <div className="space-y-3">
            {analyticsData.bidding.timePatterns.map((pattern: any) => (
              <div key={pattern.hour} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-blue-600 font-semibold">{pattern.hour}:00</span>
                  </div>
                  <div>
                    <p className="text-gray-900 font-medium">{pattern.bidCount || 0} bids</p>
                    <p className="text-gray-600 text-sm">{pattern.winRate?.toFixed(1) || 0}% win rate</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-gray-900 font-semibold">${pattern.avgBid?.toFixed(0) || 0}</p>
                  <p className="text-gray-600 text-sm">avg bid</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <ClockIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No bidding time data</p>
            <p className="text-gray-400 text-sm">Place more bids to see optimal timing patterns</p>
          </div>
        )}
      </div>

      {/* Content Category Preferences */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <TagIcon className="h-6 w-6 mr-2 text-orange-600" />
          Content Category Performance
        </h3>
        
        {analyticsData.bidding.categoryPreferences?.length > 0 ? (
          <div className="space-y-4">
            {analyticsData.bidding.categoryPreferences.map((category: any, index: number) => (
              <div key={category.category} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-900 font-medium">{category.category}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-600 text-sm">{category.winCount || 0}/{category.bidCount || 0}</span>
                    <span className="text-orange-600 font-semibold">{category.winRate?.toFixed(1) || 0}%</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${category.winRate || 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <TagIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No category data</p>
            <p className="text-gray-400 text-sm">Bid on different content types to see preferences</p>
          </div>
        )}
      </div>
    </div>
  )

  const renderPortfolioAnalytics = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* Portfolio Overview */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <ShoppingBagIcon className="h-6 w-6 mr-2 text-green-600" />
          Content Portfolio
        </h3>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">{analyticsData.portfolio.overview.totalContent || 0}</p>
            <p className="text-gray-600 text-sm">Total Content</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-2xl font-bold text-green-600">{analyticsData.portfolio.overview.usedContent || 0}</p>
            <p className="text-gray-600 text-sm">Posted</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">{analyticsData.portfolio.overview.usageRate?.toFixed(1) || 0}%</p>
            <p className="text-gray-600 text-sm">Usage Rate</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-2xl font-bold text-green-600">{analyticsData.portfolio.overview.portfolioROI?.toFixed(1) || 0}%</p>
            <p className="text-gray-600 text-sm">Portfolio ROI</p>
          </div>
        </div>

        {/* Top Performers */}
        <div>
          <h4 className="text-lg font-semibold text-gray-900 mb-3">Top Performing Content</h4>
          {analyticsData.portfolio.topPerformers?.length > 0 ? (
            <div className="space-y-2">
              {analyticsData.portfolio.topPerformers.slice(0, 3).map((content: any, index: number) => (
                <div key={content.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                      index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-orange-600'
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium truncate w-32">{content.title || 'Untitled'}</p>
                      <p className="text-gray-600 text-sm">{content.engagementRate || 0}% engagement</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-green-600 font-semibold">+{content.mindshareGain || 0}</p>
                    <p className="text-gray-600 text-sm">mindshare</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <TrophyIcon className="h-10 w-10 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">No top performers yet</p>
              <p className="text-gray-400 text-sm">Post content to see performance metrics</p>
            </div>
          )}
        </div>
      </div>

      {/* Predictive Insights */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <LightBulbIcon className="h-6 w-6 mr-2 text-yellow-600" />
          AI Insights & Predictions
        </h3>
        
        <div className="space-y-4">
          {/* Predicted Growth */}
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center space-x-2 mb-2">
              <ArrowTrendingUpIcon className="h-5 w-5 text-yellow-600" />
              <span className="text-yellow-700 font-semibold">Growth Prediction</span>
            </div>
            <p className="text-gray-900">
              Expected {analyticsData.mindshare.predictions?.nextWeekGrowth || 0}% mindshare growth next week
            </p>
            <p className="text-gray-600 text-sm">
              Target: {analyticsData.mindshare.predictions?.nextMonthTarget?.toLocaleString() || 0} total mindshare
            </p>
          </div>

          {/* Best Category */}
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center space-x-2 mb-2">
              <TrophyIconSolid className="h-5 w-5 text-green-600" />
              <span className="text-green-700 font-semibold">Top Category</span>
            </div>
            <p className="text-gray-900">
              {analyticsData.portfolio.insights?.bestCategory?.category || 'No data'} content performs best
            </p>
            <p className="text-gray-600 text-sm">
              {analyticsData.portfolio.insights?.bestCategory?.avgROI || 0}% average ROI
            </p>
          </div>

          {/* Optimal Posting Times */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center space-x-2 mb-2">
              <ClockIcon className="h-5 w-5 text-blue-600" />
              <span className="text-blue-700 font-semibold">Optimal Times</span>
            </div>
            <p className="text-gray-900 mb-2">Best posting times for maximum engagement:</p>
            <div className="flex space-x-2">
              {analyticsData.mindshare.predictions?.optimalPostingTimes?.length > 0 ? 
                analyticsData.mindshare.predictions.optimalPostingTimes.map((time: string, index: number) => (
                  <span key={index} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
                    {time}
                  </span>
                )) : 
                <span className="text-gray-500 text-sm">No data available</span>
              }
            </div>
          </div>

          {/* Content Velocity */}
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center space-x-2 mb-2">
              <RocketLaunchIcon className="h-5 w-5 text-purple-600" />
              <span className="text-purple-700 font-semibold">Content Velocity</span>
            </div>
            <p className="text-gray-900">
              {analyticsData.portfolio.insights?.contentVelocity?.toFixed(1) || 0} content pieces per week
            </p>
            <p className="text-gray-600 text-sm">
              Avg time to use: {analyticsData.portfolio.insights?.avgTimeToUse?.toFixed(0) || 0} days
            </p>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="bg-gray-50 h-screen overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Yapper Analytics Dashboard</h1>
              <p className="text-gray-600">Comprehensive insights into your content trading performance</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 bg-white rounded-lg p-2 border border-gray-200 shadow-sm">
                {['24h', '7d', '30d'].map((period) => (
                  <button
                    key={period}
                    onClick={() => setSelectedTimeframe(period as any)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      selectedTimeframe === period
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Financial Overview Cards */}
        {renderFinancialOverview()}

        {/* Mindshare Tracking */}
        {renderMindshareTracking()}

        {/* Bidding Performance */}
        {renderBiddingPerformance()}

        {/* Portfolio Analytics */}
        {renderPortfolioAnalytics()}
      </div>
    </div>
  )
} 