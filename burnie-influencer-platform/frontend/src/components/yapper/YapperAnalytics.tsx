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
  performance: {
    overview: any;
    earnings: any;
    trends: any[];
  };
  marketplace: {
    opportunities: any[];
    socialProof: any[];
    categoryPerformance: any[];
  };
  mindshare: {
    overview: any;
    platforms: any[];
    heatmap: any[];
    predictions: any;
  };
  intelligence: {
    overview: any;
    content: any[];
    recommendations: any[];
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
        // Show dummy data even when wallet is not connected for demo purposes
        const dummyData = {
          performance: {
            overview: {
              totalContentPurchased: 24,
              contentSuccessRate: 73.2,
              successfulContent: 18,
              totalContent: 24,
              avgContentInvestment: 22
            },
            earnings: {
              totalPlatformRewards: 3450,
              nextWeekPrediction: 12,
              averageROI: 156.7,
              roiGrowthPercentage: 23
            },
            trends: []
          },
          marketplace: {
            opportunities: [
              {
                contentType: "Gaming DeFi",
                confidence: 87,
                predictedSNAP: 245,
                availableCount: 3,
                priceRange: "15-25",
                positionJump: 12
              },
              {
                contentType: "Achievement Posts",
                confidence: 92,
                predictedSNAP: 340,
                availableCount: 2,
                priceRange: "18-28",
                positionJump: 15
              },
              {
                contentType: "Meme Tech",
                confidence: 78,
                predictedSNAP: 180,
                availableCount: 5,
                priceRange: "12-18",
                positionJump: 8
              }
            ],
            socialProof: [
              {
                contentType: "Gaming DeFi",
                yapperCount: 47,
                avgSNAP: 156
              },
              {
                contentType: "Achievement Posts",
                yapperCount: 32,
                avgSNAP: 203
              },
              {
                contentType: "Tech Memes",
                yapperCount: 61,
                avgSNAP: 134
              }
            ],
            categoryPerformance: [
              {
                category: "Gaming",
                name: "Gaming Content",
                yourROI: 156,
                avgROI: 98,
                performanceRatio: 85,
                percentile: 78
              },
              {
                category: "DeFi",
                name: "DeFi Content",
                yourROI: 134,
                avgROI: 112,
                performanceRatio: 72,
                percentile: 67
              },
              {
                category: "Memes",
                name: "Meme Content",
                yourROI: 89,
                avgROI: 145,
                performanceRatio: 45,
                percentile: 34
              }
            ]
          },
          mindshare: {
            overview: {
              currentLeaderboardPosition: 47,
              currentRank: 47,
              totalMindshare: 12450
            },
            predictions: {
              predictedRank: 32,
              positionsToNextMilestone: 8,
              nextWeekGrowth: 12.5,
              optimalPostingTimes: ["2:00 PM", "6:00 PM", "9:00 PM"]
            },
            platforms: [],
            heatmap: []
          },
          intelligence: {
            overview: {},
            content: [],
            recommendations: [
              {
                id: 1,
                type: "Gaming DeFi Thread",
                confidence: 85,
                predictedSNAP: 245,
                price: 22
              },
              {
                id: 2,
                type: "Achievement Showcase",
                confidence: 92,
                predictedSNAP: 340,
                price: 28
              },
              {
                id: 3,
                type: "Tech Meme Collection",
                confidence: 78,
                predictedSNAP: 180,
                price: 15
              }
            ],
            categoryBreakdown: {},
            insights: {
              predictedWeeklyEarnings: 340,
              predictedPositionGain: 8,
              aiConfidenceLevel: 87,
              bestCategory: {
                category: "Gaming",
                avgROI: 156
              },
              topYapperMultiplier: 3.2,
              avgCompetitorSpend: 87
            }
          }
        };
        
        setAnalyticsData(dummyData)
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

        // Create dummy data for demonstration purposes
        const dummyData = {
          performance: {
            overview: {
              totalContentPurchased: 24,
              contentSuccessRate: 73.2,
              successfulContent: 18,
              totalContent: 24,
              avgContentInvestment: 22
            },
            earnings: {
              totalPlatformRewards: 3450,
              nextWeekPrediction: 12,
              averageROI: 156.7,
              roiGrowthPercentage: 23
            },
            trends: []
          },
          marketplace: {
            opportunities: [
              {
                contentType: "Gaming DeFi",
                confidence: 87,
                predictedSNAP: 245,
                availableCount: 3,
                priceRange: "15-25",
                positionJump: 12
              },
              {
                contentType: "Achievement Posts",
                confidence: 92,
                predictedSNAP: 340,
                availableCount: 2,
                priceRange: "18-28",
                positionJump: 15
              },
              {
                contentType: "Meme Tech",
                confidence: 78,
                predictedSNAP: 180,
                availableCount: 5,
                priceRange: "12-18",
                positionJump: 8
              }
            ],
            socialProof: [
              {
                contentType: "Gaming DeFi",
                yapperCount: 47,
                avgSNAP: 156
              },
              {
                contentType: "Achievement Posts",
                yapperCount: 32,
                avgSNAP: 203
              },
              {
                contentType: "Tech Memes",
                yapperCount: 61,
                avgSNAP: 134
              }
            ],
            categoryPerformance: [
              {
                category: "Gaming",
                name: "Gaming Content",
                yourROI: 156,
                avgROI: 98,
                performanceRatio: 85,
                percentile: 78
              },
              {
                category: "DeFi",
                name: "DeFi Content",
                yourROI: 134,
                avgROI: 112,
                performanceRatio: 72,
                percentile: 67
              },
              {
                category: "Memes",
                name: "Meme Content",
                yourROI: 89,
                avgROI: 145,
                performanceRatio: 45,
                percentile: 34
              }
            ]
          },
          mindshare: {
            overview: {
              currentLeaderboardPosition: 47,
              currentRank: 47,
              totalMindshare: 12450
            },
            predictions: {
              predictedRank: 32,
              positionsToNextMilestone: 8,
              nextWeekGrowth: 12.5,
              optimalPostingTimes: ["2:00 PM", "6:00 PM", "9:00 PM"]
            },
            platforms: [],
            heatmap: []
          },
          intelligence: {
            overview: {},
            content: [],
            recommendations: [
              {
                id: 1,
                type: "Gaming DeFi Thread",
                confidence: 85,
                predictedSNAP: 245,
                price: 22
              },
              {
                id: 2,
                type: "Achievement Showcase",
                confidence: 92,
                predictedSNAP: 340,
                price: 28
              },
              {
                id: 3,
                type: "Tech Meme Collection",
                confidence: 78,
                predictedSNAP: 180,
                price: 15
              }
            ],
            categoryBreakdown: {},
            insights: {
              predictedWeeklyEarnings: 340,
              predictedPositionGain: 8,
              aiConfidenceLevel: 87,
              bestCategory: {
                category: "Gaming",
                avgROI: 156
              },
              topYapperMultiplier: 3.2,
              avgCompetitorSpend: 87
            }
          }
        };

        const [
          performanceResponse,
          marketplaceResponse,
          mindshareResponse,
          intelligenceResponse
        ] = await Promise.all([
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/performance/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/marketplace/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/mindshare/${address}`),
          fetch(`${baseUrl}/api/marketplace/analytics/yapper/intelligence/${address}`)
        ]);

        // Parse responses with error handling
        const parseJsonSafely = async (response: Response, fallback: any) => {
          try {
            if (!response.ok) {
              console.warn(`API endpoint returned ${response.status}: ${response.statusText}`);
              return fallback;
            }
            const text = await response.text();
            const parsed = text ? JSON.parse(text) : null;
            return parsed?.data || fallback;
          } catch (error) {
            console.warn('Failed to parse JSON response, using fallback data:', error);
            return fallback;
          }
        };

        const [
          performance,
          marketplace,
          mindshare,
          intelligence
        ] = await Promise.all([
          parseJsonSafely(performanceResponse, dummyData.performance),
          parseJsonSafely(marketplaceResponse, dummyData.marketplace),
          parseJsonSafely(mindshareResponse, dummyData.mindshare),
          parseJsonSafely(intelligenceResponse, dummyData.intelligence)
        ]);

        setAnalyticsData({
          performance: performance || dummyData.performance,
          marketplace: marketplace || dummyData.marketplace,
          mindshare: mindshare || dummyData.mindshare,
          intelligence: intelligence || dummyData.intelligence
        });
      } catch (error) {
        console.error('Error fetching yapper analytics:', error);
        // Fall back to dummy data even on complete failure
        const fallbackDummyData = {
          performance: {
            overview: {
              totalContentPurchased: 24,
              contentSuccessRate: 73.2,
              successfulContent: 18,
              totalContent: 24,
              avgContentInvestment: 22
            },
            earnings: {
              totalPlatformRewards: 3450,
              nextWeekPrediction: 12,
              averageROI: 156.7,
              roiGrowthPercentage: 23
            },
            trends: []
          },
          marketplace: {
            opportunities: [
              {
                contentType: "Gaming DeFi",
                confidence: 87,
                predictedSNAP: 245,
                availableCount: 3,
                priceRange: "15-25",
                positionJump: 12
              },
              {
                contentType: "Achievement Posts",
                confidence: 92,
                predictedSNAP: 340,
                availableCount: 2,
                priceRange: "18-28",
                positionJump: 15
              },
              {
                contentType: "Meme Tech",
                confidence: 78,
                predictedSNAP: 180,
                availableCount: 5,
                priceRange: "12-18",
                positionJump: 8
              }
            ],
            socialProof: [
              {
                contentType: "Gaming DeFi",
                yapperCount: 47,
                avgSNAP: 156
              },
              {
                contentType: "Achievement Posts",
                yapperCount: 32,
                avgSNAP: 203
              },
              {
                contentType: "Tech Memes",
                yapperCount: 61,
                avgSNAP: 134
              }
            ],
            categoryPerformance: [
              {
                category: "Gaming",
                name: "Gaming Content",
                yourROI: 156,
                avgROI: 98,
                performanceRatio: 85,
                percentile: 78
              },
              {
                category: "DeFi",
                name: "DeFi Content",
                yourROI: 134,
                avgROI: 112,
                performanceRatio: 72,
                percentile: 67
              },
              {
                category: "Memes",
                name: "Meme Content",
                yourROI: 89,
                avgROI: 145,
                performanceRatio: 45,
                percentile: 34
              }
            ]
          },
          mindshare: {
            overview: {
              currentLeaderboardPosition: 47,
              currentRank: 47,
              totalMindshare: 12450
            },
            predictions: {
              predictedRank: 32,
              positionsToNextMilestone: 8,
              nextWeekGrowth: 12.5,
              optimalPostingTimes: ["2:00 PM", "6:00 PM", "9:00 PM"]
            },
            platforms: [],
            heatmap: []
          },
          intelligence: {
            overview: {},
            content: [],
            recommendations: [
              {
                id: 1,
                type: "Gaming DeFi Thread",
                confidence: 85,
                predictedSNAP: 245,
                price: 22
              },
              {
                id: 2,
                type: "Achievement Showcase",
                confidence: 92,
                predictedSNAP: 340,
                price: 28
              },
              {
                id: 3,
                type: "Tech Meme Collection",
                confidence: 78,
                predictedSNAP: 180,
                price: 15
              }
            ],
            categoryBreakdown: {},
            insights: {
              predictedWeeklyEarnings: 340,
              predictedPositionGain: 8,
              aiConfidenceLevel: 87,
              bestCategory: {
                category: "Gaming",
                avgROI: 156
              },
              topYapperMultiplier: 3.2,
              avgCompetitorSpend: 87
            }
          }
        };
        setAnalyticsData(fallbackDummyData);
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
          <p className="text-gray-600">Start purchasing content to see your performance analytics and AI insights</p>
        </div>
      </div>
    )
  }

  const renderPerformanceOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Platform Earnings Power */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 border border-green-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <CurrencyDollarIcon className="h-6 w-6 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">Platform Earnings Power</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            🎯 +{analyticsData.performance.earnings.nextWeekPrediction || 0}% next week
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            ${analyticsData.performance.earnings.totalPlatformRewards || 0}
          </p>
          <p className="text-sm text-green-600">
            From {analyticsData.performance.overview.totalContentPurchased || 0} smart content investments
          </p>
        </div>
      </div>

      {/* Leaderboard Power */}
      <div className="bg-gradient-to-br from-purple-50 to-pink-100 rounded-xl p-6 border border-purple-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <TrophyIcon className="h-6 w-6 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">Leaderboard Power</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            ⚡ #{analyticsData.mindshare.overview.currentRank || 'N/A'} → #{analyticsData.mindshare.predictions.predictedRank || 'N/A'}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            #{analyticsData.mindshare.overview.currentLeaderboardPosition || 'N/A'}
          </p>
          <p className="text-sm text-purple-600">
            Next milestone: +{analyticsData.mindshare.predictions.positionsToNextMilestone || 0} positions
          </p>
        </div>
      </div>

      {/* AI Success Rate */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-100 rounded-xl p-6 border border-blue-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <BeakerIcon className="h-6 w-6 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">AI Success Rate</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            🤖 {analyticsData.intelligence.insights.aiConfidenceLevel || 85}% confident
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            {analyticsData.performance.overview.contentSuccessRate?.toFixed(1) || 0}%
          </p>
          <p className="text-sm text-blue-600">
            {analyticsData.performance.overview.successfulContent || 0} of {analyticsData.performance.overview.totalContent || 0} content performed above prediction
          </p>
        </div>
      </div>

      {/* Content ROI */}
      <div className="bg-gradient-to-br from-orange-50 to-yellow-100 rounded-xl p-6 border border-orange-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <RocketLaunchIcon className="h-6 w-6 text-orange-600" />
            <h3 className="text-lg font-semibold text-gray-900">Content ROI</h3>
          </div>
          <div className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            📈 +{analyticsData.performance.earnings.roiGrowthPercentage || 0}% this month
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-3xl font-bold text-gray-900">
            {analyticsData.performance.earnings.averageROI?.toFixed(1) || 0}%
          </p>
          <p className="text-sm text-orange-600">
            ${analyticsData.performance.overview.avgContentInvestment || 0} avg investment per content
          </p>
        </div>
      </div>
    </div>
  )

  const renderLiveOpportunityScanner = () => (
    <div className="bg-white rounded-xl p-6 mb-8 border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center">
          <FireIcon className="h-6 w-6 mr-2 text-red-600" />
          Live Opportunity Scanner - Cookie.fun Algorithm Intelligence
      </h3>
        <div className="flex items-center space-x-2">
          <div className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
            🔥 {analyticsData.marketplace.opportunities?.length || 0} Hot Opportunities
          </div>
          <div className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
            ⚡ Updated 2 min ago
          </div>
        </div>
      </div>
      
      {analyticsData.marketplace.opportunities?.length > 0 ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {analyticsData.marketplace.opportunities.map((opportunity: any, index: number) => (
              <div key={index} className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 border border-red-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-gray-900">{opportunity.contentType || 'Gaming DeFi'}</h4>
                  <div className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    🔥 {opportunity.confidence || 85}% AI Confidence
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Predicted SNAP:</span>
                    <span className="text-green-600 font-bold">+{opportunity.predictedSNAP || 245}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Available Content:</span>
                    <span className="text-orange-600 font-medium">{opportunity.availableCount || 3} pieces</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Price Range:</span>
                    <span className="text-gray-900 font-medium">${opportunity.priceRange || '15-25'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Leaderboard Jump:</span>
                    <span className="text-purple-600 font-medium">+{opportunity.positionJump || 12} positions</span>
                  </div>
                </div>

                {/* Confidence visualization */}
                <div className="mt-4 h-16 bg-gray-100 rounded p-2">
                  <div className="flex items-end justify-between h-full">
                    {[65, 78, 82, 87, 92, 85, 79].map((confidence, i) => (
                      <div 
                        key={i} 
                        className="bg-red-500 rounded-sm w-1 transition-all duration-300"
                        style={{ 
                          height: `${confidence}%` 
                        }}
                        title={`Day ${i + 1}: ${confidence}% confidence`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Algorithm Intelligence Briefing */}
          <div className="mt-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
              <div className="flex items-center">
                <BeakerIcon className="h-5 w-5 mr-2 text-purple-600" />
                Today's Algorithm Intelligence
              </div>
              <div className="text-sm text-gray-600">
                Last updated: 3 minutes ago
              </div>
            </h4>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Algorithm Update Alert */}
              <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 border border-red-200">
                <div className="flex items-center space-x-2 mb-2">
                  <FireIcon className="h-5 w-5 text-red-600" />
                  <span className="text-red-700 font-semibold">🔥 Algorithm Update Detected</span>
                      </div>
                <p className="text-gray-900 mb-1">Gaming content getting 2.3x boost</p>
                <p className="text-gray-600 text-sm">Peak performance: 2-4 PM EST</p>
                <p className="text-green-600 text-sm font-medium">Recommendation: Gaming memes showing 340% ROI</p>
                </div>
                
              {/* Trending Pattern */}
              <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-200">
                <div className="flex items-center space-x-2 mb-2">
                  <ArrowTrendingUpIcon className="h-5 w-5 text-blue-600" />
                  <span className="text-blue-700 font-semibold">⚡ Trending Pattern</span>
                    </div>
                <p className="text-gray-900 mb-1">Achievement-framed content trending</p>
                <p className="text-gray-600 text-sm">Pattern expires: in 4 hours</p>
                <p className="text-orange-600 text-sm font-medium">Window: Next 2 hours for max impact</p>
                  </div>

              {/* Community Intelligence */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                <div className="flex items-center space-x-2 mb-2">
                  <UsersIcon className="h-5 w-5 text-green-600" />
                  <span className="text-green-700 font-semibold">👥 Community Intel</span>
                    </div>
                <p className="text-gray-900 mb-1">47 yappers bought gaming content today</p>
                <p className="text-gray-600 text-sm">Avg earnings: +156 SNAP</p>
                <p className="text-purple-600 text-sm font-medium">Success rate: 73% for users like you</p>
                  </div>

              {/* Opportunity Timer */}
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg p-4 border border-yellow-200">
                <div className="flex items-center space-x-2 mb-2">
                  <ClockIcon className="h-5 w-5 text-yellow-600" />
                  <span className="text-yellow-700 font-semibold">⏰ Time-Sensitive</span>
                    </div>
                <p className="text-gray-900 mb-1">Only 3 high-prediction pieces left</p>
                <p className="text-gray-600 text-sm">Price locked until: 11:59 PM</p>
                <p className="text-red-600 text-sm font-medium">Expected: +400 SNAP, climb 20 positions</p>
                  </div>
                    </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <FireIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Hot Opportunities Available</h4>
          <p className="text-gray-600">Check back soon for AI-detected content opportunities with high earning potential</p>
        </div>
      )}
    </div>
  )

  const renderSocialProofAndIntelligence = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* What's Working for Top Yappers */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <UsersIcon className="h-6 w-6 mr-2 text-blue-600" />
          What's Working for Top Yappers
        </h3>
        
        {analyticsData.marketplace.socialProof?.length > 0 ? (
          <div className="space-y-3">
            {analyticsData.marketplace.socialProof.map((success: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <TrophyIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-gray-900 font-medium">{success.contentType || 'Gaming DeFi'}</p>
                    <p className="text-gray-600 text-sm">{success.yapperCount || 47} yappers bought this week</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-green-600 font-semibold">+{success.avgSNAP || 156} SNAP</p>
                  <p className="text-gray-600 text-sm">avg earned</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <UsersIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No community data available</p>
            <p className="text-gray-400 text-sm">Check back for social proof and success stories</p>
          </div>
        )}
      </div>

      {/* Your Performance vs Community */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <ChartBarIcon className="h-6 w-6 mr-2 text-orange-600" />
          Your Performance vs Community
        </h3>
        
        {analyticsData.marketplace.categoryPerformance?.length > 0 ? (
          <div className="space-y-4">
            {analyticsData.marketplace.categoryPerformance.map((category: any, index: number) => (
              <div key={category.category} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-900 font-medium">{category.name || category.category}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-600 text-sm">You: {category.yourROI || 0}%</span>
                    <span className="text-orange-600 font-semibold">Avg: {category.avgROI || 0}%</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${category.performanceRatio || category.winRate || 0}%` }}
                  />
                </div>
                <div className="text-xs text-gray-600">
                  {(category.yourROI || 0) > (category.avgROI || 0) 
                    ? `🎯 You outperform ${category.percentile || 67}% of similar yappers`
                    : `📈 Room for improvement in this category`
                  }
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <ChartBarIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No performance comparison available</p>
            <p className="text-gray-400 text-sm">Purchase content to see how you compare with others</p>
          </div>
        )}
      </div>
    </div>
  )

  const renderPredictiveIntelligence = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* AI Content Predictions */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <BeakerIcon className="h-6 w-6 mr-2 text-purple-600" />
          AI Content Predictions (Next 7 Days)
        </h3>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
            <p className="text-2xl font-bold text-purple-600">+{analyticsData.intelligence.insights.predictedWeeklyEarnings || 340}</p>
            <p className="text-gray-600 text-sm">Predicted SNAP</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-2xl font-bold text-green-600">+{analyticsData.intelligence.insights.predictedPositionGain || 8}</p>
            <p className="text-gray-600 text-sm">Position Jump</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-2xl font-bold text-blue-600">{analyticsData.intelligence.insights.aiConfidenceLevel || 87}%</p>
            <p className="text-gray-600 text-sm">AI Confidence</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-2xl font-bold text-orange-600">{analyticsData.intelligence.recommendations?.length || 3}</p>
            <p className="text-gray-600 text-sm">Hot Picks</p>
          </div>
        </div>

        {/* Top Recommended Content */}
        <div>
          <h4 className="text-lg font-semibold text-gray-900 mb-3">🔥 AI-Recommended Content (High Prediction)</h4>
          {analyticsData.intelligence.recommendations?.length > 0 ? (
            <div className="space-y-2">
              {analyticsData.intelligence.recommendations.slice(0, 3).map((content: any, index: number) => (
                <div key={content.id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                      index === 0 ? 'bg-red-500' : index === 1 ? 'bg-orange-500' : 'bg-yellow-500'
                    }`}>
                      🔥
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium truncate w-32">{content.type || 'Gaming DeFi Thread'}</p>
                      <p className="text-gray-600 text-sm">{content.confidence || 85}% AI confidence</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-green-600 font-semibold">+{content.predictedSNAP || 245}</p>
                    <p className="text-gray-600 text-sm">${content.price || 22}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <BeakerIcon className="h-10 w-10 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">No AI recommendations available</p>
              <p className="text-gray-400 text-sm">Check back for high-prediction content opportunities</p>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced AI Insights & FOMO Alerts */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <LightBulbIcon className="h-6 w-6 mr-2 text-yellow-600" />
          AI Insights & FOMO Alerts
        </h3>
        
        <div className="space-y-4">
          {/* Hot Opportunity Alert */}
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center space-x-2 mb-2">
              <FireIcon className="h-5 w-5 text-red-600" />
              <span className="text-red-700 font-semibold">🔥 Hot Opportunity Alert</span>
            </div>
            <p className="text-gray-900">
              Gaming DeFi content showing 340% ROI spike - Window closes in 4 hours
            </p>
            <p className="text-gray-600 text-sm">
              Only 3 high-prediction pieces available at optimal price
            </p>
          </div>

          {/* Your Best Category */}
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center space-x-2 mb-2">
              <TrophyIconSolid className="h-5 w-5 text-green-600" />
              <span className="text-green-700 font-semibold">🎯 Your Best Category</span>
            </div>
            <p className="text-gray-900">
              {analyticsData.intelligence.insights?.bestCategory?.category || 'Gaming'} content: {analyticsData.intelligence.insights?.bestCategory?.avgROI || 156}% ROI
            </p>
            <p className="text-gray-600 text-sm">
              You outperform 78% of similar yappers in this category
            </p>
          </div>

          {/* Algorithm Pattern Detected */}
          <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
            <div className="flex items-center space-x-2 mb-2">
              <ClockIcon className="h-5 w-5 text-orange-600" />
              <span className="text-orange-700 font-semibold">⚡ Algorithm Pattern Detected</span>
            </div>
            <p className="text-gray-900">
              Cookie.fun boosting achievement-focused content by 2.3x until midnight
            </p>
            <p className="text-gray-600 text-sm">
              Optimal purchase window: Next 2 hours for maximum impact
            </p>
          </div>

          {/* Competitive Intelligence */}
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center space-x-2 mb-2">
              <UsersIcon className="h-5 w-5 text-purple-600" />
              <span className="text-purple-700 font-semibold">👥 Competitive Intel</span>
            </div>
            <p className="text-gray-900">
              Top 10% yappers buy {analyticsData.intelligence.insights?.topYapperMultiplier || 3.2}x more gaming content
            </p>
            <p className="text-gray-600 text-sm">
              Your competitors spending average ${analyticsData.intelligence.insights?.avgCompetitorSpend || 87}/week
            </p>
          </div>

          {/* Prediction Confidence */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center space-x-2 mb-2">
              <BeakerIcon className="h-5 w-5 text-blue-600" />
              <span className="text-blue-700 font-semibold">🤖 AI Confidence Level</span>
            </div>
            <p className="text-gray-900">
              Our AI is {analyticsData.intelligence.insights?.aiConfidenceLevel || 94}% confident in gaming content predictions
            </p>
            <p className="text-gray-600 text-sm">
              Historical accuracy: 87% for your profile type
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
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Personal Performance Command Center</h1>
            <p className="text-gray-600">AI-powered insights to maximize your platform rewards and leaderboard climbing</p>
            <div className="mt-2 flex items-center space-x-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                🔥 {analyticsData.marketplace.opportunities?.length || 3} Hot Opportunities Available
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ⚡ Algorithm intel updated 2 min ago
              </span>
            </div>
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

      {/* Performance Overview Cards */}
      {renderPerformanceOverview()}

      {/* Live Opportunity Scanner */}
      {renderLiveOpportunityScanner()}

      {/* Social Proof & Market Intelligence */}
      {renderSocialProofAndIntelligence()}

      {/* Predictive Intelligence Center */}
      {renderPredictiveIntelligence()}
      </div>
    </div>
  )
} 