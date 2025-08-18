'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'

interface AnalyticsData {
  totalEarnings: number
  roastBalance: number
  contentPurchased: number
  successRate: number
  weeklyGrowth: number
  topCategories: Array<{
    name: string
    percentage: number
    growth: string
  }>
  recentActivity: Array<{
    type: string
    content: string
    earnings: number
    timestamp: string
  }>
}

export default function YapperAnalytics() {
  const { address, isConnected } = useAccount()
  const [selectedTimeframe, setSelectedTimeframe] = useState('7d')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAnalytics = async () => {
      setIsLoading(true)
      
      try {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Mock analytics data
        const mockData: AnalyticsData = {
          totalEarnings: 3450,
          roastBalance: 1240,
          contentPurchased: 24,
          successRate: 73.2,
          weeklyGrowth: 12.5,
          topCategories: [
            { name: 'Gaming DeFi', percentage: 45, growth: '+23%' },
            { name: 'Memes', percentage: 32, growth: '+15%' },
            { name: 'Trading', percentage: 23, growth: '+8%' }
          ],
          recentActivity: [
            {
              type: 'purchase',
              content: 'Gaming DeFi Strategy Post',
              earnings: 156,
              timestamp: '2 hours ago'
            },
            {
              type: 'reward',
              content: 'Meme Performance Bonus',
              earnings: 89,
              timestamp: '5 hours ago'
            }
          ]
        }
        
        setAnalyticsData(mockData)
      } catch (error) {
        console.error('Failed to fetch analytics:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchAnalytics()
  }, [address, isConnected])

  if (isLoading) {
    return (
      <div className="h-full p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-white/10 rounded w-1/3 mb-6"></div>
          <div className="flex gap-6">
            <div className="flex-1">
              <div className="h-64 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-32 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-48 bg-white/10 rounded-xl"></div>
            </div>
            <div className="w-96">
              <div className="h-48 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-96 bg-white/10 rounded-xl"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!analyticsData) {
    return (
      <div className="h-full p-6 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">No Data Available</h2>
          <p className="text-yapper-muted">Start purchasing content to see your performance analytics and AI insights</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex gap-6">
        {/* Left Main Content Area - ~828px equivalent */}
        <div className="flex-1 space-y-6">
          
          {/* Header Section - Hug content */}
          <div className="space-y-4">
            <h1 className="text-white text-2xl font-bold uppercase font-nt-brick">PERSONALISED GROWTH ANALYTICS</h1>
            <p className="text-yapper-muted text-sm">AI powered insights to maximise your platform rewards and leaderboard climbing</p>
          </div>

          {/* Top Metrics - Horizontal Layout (828px x 139px equivalent) */}
          <div className="flex gap-4">
            {/* Platform earning potential */}
            <div className="flex-1 bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
              <h3 className="text-white text-sm font-medium mb-2">Platform earning potential</h3>
              <p className="text-orange-400 text-xs mb-3">24 smart content investments available</p>
              <p className="text-white text-2xl font-bold mb-1">$3,450</p>
              <p className="text-green-400 text-xs">+12% next week</p>
            </div>

            {/* Leaderboard power */}
            <div className="flex-1 bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
              <h3 className="text-white text-sm font-medium mb-2">Leaderboard power</h3>
              <p className="text-orange-400 text-xs mb-3">+12 position, next milestone</p>
              <p className="text-white text-2xl font-bold mb-1">N/A</p>
              <p className="text-green-400 text-xs">+12% next week</p>
            </div>
          </div>

          {/* Second Row Metrics - Horizontal Layout */}
          <div className="flex gap-4">
            {/* AI success rate */}
            <div className="flex-1 bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
              <h3 className="text-white text-sm font-medium mb-2">AI success rate</h3>
              <p className="text-orange-400 text-xs mb-3">18/24 content outperformed</p>
              <p className="text-white text-2xl font-bold mb-1">73.2%</p>
              <p className="text-orange-400 text-xs">87% confident</p>
            </div>

            {/* Content ROI */}
            <div className="flex-1 bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
              <h3 className="text-white text-sm font-medium mb-2">Content ROI</h3>
              <p className="text-orange-400 text-xs mb-3">$22 avg investment per content</p>
              <p className="text-white text-2xl font-bold mb-1">155.7%</p>
              <p className="text-green-400 text-xs">+23% this month</p>
            </div>
          </div>

          {/* Live Opportunity Scanner - Larger section (~828px x 302px equivalent) */}
          <div className="bg-yapper-surface-2 rounded-xl p-6 border border-yapper">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="text-white text-lg font-semibold">LIVE OPPORTUNITY SCANNER - COOKIE.FUN ALGORITHM INTELLIGENCE</h3>
              </div>
              <div className="flex items-center space-x-2">
                <button className="p-2 bg-yapper-muted rounded-lg text-white hover:bg-yapper-muted-2 transition-colors">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <button className="p-2 bg-yapper-muted rounded-lg text-white hover:bg-yapper-muted-2 transition-colors">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Opportunity Cards in Grid */}
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((index) => (
                <div key={index} className="bg-yapper-muted rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-white font-semibold">Gaming DeFi</h4>
                    <span className="text-orange-400 text-sm font-semibold">+245</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-yapper-muted">Predicted SNAP:</span>
                      <span className="text-white">+245</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yapper-muted">Price Range:</span>
                      <span className="text-white">$15-25</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yapper-muted">Leaderboard Jump:</span>
                      <span className="text-green-400">+12 positions</span>
                    </div>
                  </div>
                  <button className="w-full mt-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-3 rounded-lg transition-colors text-sm">
                    3 Available content
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Your vs Community Performance - (~828px x 310px equivalent) */}
          <div className="bg-yapper-surface-2 rounded-xl p-6 border border-yapper">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-white text-lg font-semibold">YOUR VS COMMUNITY PERFORMANCE</h3>
            </div>

            <div className="space-y-4">
              {[1, 2, 3].map((index) => (
                <div key={index}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-white">Gaming content</span>
                    <span className="text-orange-400">You: 156, Community: 98</span>
                  </div>
                  <div className="w-full bg-yapper-muted rounded-full h-3">
                    <div className="bg-orange-500 h-3 rounded-full" style={{ width: '78%' }}></div>
                  </div>
                  <p className="text-yapper-muted text-sm mt-1">You outperformed 78% of similar yappers</p>
                </div>
              ))}
            </div>
          </div>

          {/* What's Working for Top Yappers - (~828px x 343px equivalent) */}
          <div className="bg-yapper-surface-2 rounded-xl p-6 border border-yapper">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white text-lg font-semibold">WHAT'S WORKING FOR TOP YAPPERS</h3>
              <button className="text-orange-400 text-sm hover:text-orange-300">View all</button>
            </div>

            <div className="space-y-4">
              {[1, 2, 3].map((index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-yapper-muted rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">G</span>
                    </div>
                    <div>
                      <p className="text-white font-semibold">Gaming DeFi</p>
                      <p className="text-yapper-muted text-sm">47 yappers bought this week</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-semibold">+254 SNAP</p>
                    <p className="text-yapper-muted text-sm">avg earned</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI-Recommendation Content */}
          <div className="bg-yapper-surface-2 rounded-xl p-6 border border-yapper">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white text-lg font-semibold">AI-RECOMMENDATION CONTENT (HIGH PREDICTION)</h3>
              <button className="text-orange-400 text-sm hover:text-orange-300">View all</button>
            </div>

            <div className="space-y-4">
              {[1, 2, 3].map((index) => (
                <div key={index} className="flex items-center justify-between p-4 bg-yapper-muted rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">G</span>
                    </div>
                    <div>
                      <p className="text-white font-semibold">Gaming DeFi</p>
                      <p className="text-yapper-muted text-sm">47 yappers bought this week</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-semibold">+254 SNAP</p>
                    <p className="text-yapper-muted text-sm">avg earned</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Sidebar - Fixed 480px width (~480px x 1530px equivalent) */}
        <div className="w-[480px] flex-shrink-0 space-y-6 border-l border-yapper pl-6">
          
          {/* AI Content Prediction - (~480px x 203px equivalent) */}
          <div className="bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
            <h3 className="text-white text-lg font-semibold mb-4">AI CONTENT PREDICTION (NEXT 7 DAYS)</h3>
            
            <div className="grid grid-cols-3 gap-2 mb-6">
              <div className="text-center">
                <p className="text-white text-2xl font-bold">+340</p>
                <p className="text-yapper-muted text-xs">Predicted SNAP</p>
              </div>
              <div className="text-center">
                <p className="text-white text-2xl font-bold">87%</p>
                <p className="text-yapper-muted text-xs">AI Confidence</p>
              </div>
              <div className="text-center">
                <p className="text-white text-2xl font-bold">87%</p>
                <p className="text-yapper-muted text-xs">AI Confidence</p>
              </div>
            </div>
          </div>

          {/* AI Insights & FOMO Alerts - (~480px x 578px equivalent) */}
          <div className="bg-yapper-surface-2 rounded-xl p-4 border border-yapper">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-lg font-semibold">AI INSIGHTS & FOMO ALERTS</h3>
              <span className="text-yapper-muted text-xs">Updated 5 min ago</span>
            </div>

            <div className="space-y-4">
              {/* Hot Opportunity Alert */}
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-red-400 text-sm font-semibold">Hot Opportunity Alert</span>
                </div>
                <p className="text-white text-sm mb-2">Gaming DeFi content showing 340% ROI spike - Window closes in 4 hours</p>
                <p className="text-yapper-muted text-xs">Only 3 high-prediction pieces available at optimal price</p>
              </div>

              {/* Your Best Category */}
              <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-green-400 text-sm font-semibold">Your Best Category</span>
                </div>
                <p className="text-white text-sm mb-2">Gaming content: 156% ROI</p>
                <p className="text-yapper-muted text-xs">You outperform 78% of similar yappers in this category</p>
              </div>

              {/* Competitive Intel */}
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-blue-400 text-sm font-semibold">Competitive Intel</span>
                </div>
                <p className="text-white text-sm mb-2">Top 10% yappers buy 3.2x more gaming content</p>
                <p className="text-yapper-muted text-xs">Your competitors spending average $97/week</p>
              </div>

              {/* AI Confidence Level */}
              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-yellow-400 text-sm font-semibold">AI Confidence Level</span>
                </div>
                <p className="text-white text-sm mb-2">Our AI is 87% confident in gaming content predictions</p>
                <p className="text-yapper-muted text-xs">Historical accuracy: 87% for your profile type</p>
              </div>

              {/* Today's Algorithm Intelligence */}
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-purple-400 text-sm font-semibold">TODAY'S ALGORITHM INTELLIGENCE</span>
                  <span className="text-yapper-muted text-xs">Updated 5 min ago</span>
                </div>
                
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-1.5 h-1.5 bg-blue-400 rounded-full"></div>
                      <span className="text-blue-400 font-semibold">Algorithm Update Detected</span>
                      <span className="text-yapper-muted">Peak performance 2-4 PM EST</span>
                    </div>
                    <p className="text-white">Gaming content getting 2.3x boost</p>
                    <p className="text-yapper-muted">Recommendation: Gaming memes showing 340% ROI</p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                      <span className="text-green-400 font-semibold">Trending Pattern</span>
                      <span className="text-yapper-muted">Pattern expires in 4 hours</span>
                    </div>
                    <p className="text-white">Achievement-framed content trending</p>
                    <p className="text-yapper-muted">Window: Next 2 hours for max impact 10</p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                      <span className="text-orange-400 font-semibold">Community Intel</span>
                      <span className="text-yapper-muted">Avg earnings +156 SNAP</span>
                    </div>
                    <p className="text-white">47 yappers bought gaming content today</p>
                    <p className="text-yapper-muted">Success rate: 73% for users like you</p>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div>
                      <span className="text-red-400 font-semibold">Time-Sensitive</span>
                      <span className="text-yapper-muted">Price locked until 11:59 PM</span>
                    </div>
                    <p className="text-white">Only 3 high-prediction pieces left</p>
                    <p className="text-yapper-muted">Expected: +400 SNAP, climb 20 positions</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}