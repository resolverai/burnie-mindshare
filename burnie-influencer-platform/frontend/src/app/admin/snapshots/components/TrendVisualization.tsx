'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Users, Zap, Target } from 'lucide-react'

interface DailyIntelligence {
  date: string
  trendingTopicsCount: number
  algorithmConfidence: number
  topPerformers: any[]
  insights: string[]
  recommendations: any[]
}

interface TrendVisualizationProps {
  platformSource: string
}

export default function TrendVisualization({ platformSource }: TrendVisualizationProps) {
  const [intelligence, setIntelligence] = useState<DailyIntelligence[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchIntelligence()
  }, [platformSource])

  const fetchIntelligence = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/admin/snapshots/intelligence/${platformSource}?days=7`)
      const data = await response.json()
      
      if (data.success) {
        setIntelligence(data.intelligence)
      }
    } catch (error) {
      console.error('Error fetching intelligence:', error)
    } finally {
      setLoading(false)
    }
  }

  const latestIntelligence = intelligence[0]
  const hasData = intelligence.length > 0

  // Mock trending data for demonstration
  const mockTrends = [
    { topic: 'Gaming DeFi Integration', change: '+45%', type: 'up' },
    { topic: 'Achievement-Based Rewards', change: '+32%', type: 'up' },
    { topic: 'Community Tournaments', change: '+28%', type: 'up' },
    { topic: 'NFT Gaming Assets', change: '-12%', type: 'down' },
    { topic: 'Cross-Chain Gaming', change: '+15%', type: 'up' }
  ]

  const mockTopPerformers = [
    { username: 'gaming_legend', score: 1250, platform: 'cookie.fun' },
    { username: 'crypto_master', score: 1180, platform: 'cookie.fun' },
    { username: 'defi_warrior', score: 1150, platform: 'cookie.fun' }
  ]

  const mockInsights = [
    'Gaming terminology increases engagement by 35%',
    'Achievement language drives 2.5x more SNAP earnings',
    'Peak posting times: 2-4 PM EST for gaming community',
    'Tournament announcements get 300% more engagement'
  ]

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trend Analysis</CardTitle>
          <CardDescription>Platform-specific trending patterns</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Trend Analysis
        </CardTitle>
        <CardDescription>
          {String(platformSource || 'unknown')} trending patterns and algorithm insights
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Algorithm Confidence */}
        {hasData && latestIntelligence && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Algorithm Confidence</span>
              <span className="text-sm text-gray-600">
                {Math.round((latestIntelligence.algorithmConfidence || 0.85) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full" 
                style={{ width: `${(latestIntelligence.algorithmConfidence || 0.85) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Trending Topics */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Trending Topics
          </h4>
          <div className="space-y-2">
            {mockTrends.map((trend, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="text-sm text-gray-900">{trend.topic}</span>
                <div className="flex items-center gap-2">
                  {trend.type === 'up' ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                  <span className={`text-xs font-medium ${
                    trend.type === 'up' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {trend.change}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Performers */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Top Performers
          </h4>
          <div className="space-y-2">
            {mockTopPerformers.map((performer, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    {index + 1}
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {performer.username}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {performer.score} SNAP
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Algorithm Insights */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <Target className="h-4 w-4" />
            Algorithm Insights
          </h4>
          <div className="space-y-2">
            {mockInsights.map((insight, index) => (
              <div key={index} className="flex items-start gap-2 p-2 bg-blue-50 rounded">
                <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <span className="text-sm text-blue-900">{insight}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Platform Stats */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900">
              {hasData ? latestIntelligence?.trendingTopicsCount || 5 : 5}
            </div>
            <div className="text-xs text-gray-600">Trending Topics</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900">
              {intelligence.length || 7}
            </div>
            <div className="text-xs text-gray-600">Days of Data</div>
          </div>
        </div>

        {/* Empty State */}
        {!hasData && (
          <div className="text-center py-6 text-gray-500">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No trend data available</p>
            <p className="text-xs">Process some snapshots to see trends</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
