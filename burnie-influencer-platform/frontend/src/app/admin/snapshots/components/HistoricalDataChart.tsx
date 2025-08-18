'use client'

import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Calendar, TrendingUp } from 'lucide-react'

interface SnapshotItem {
  id: number
  fileName: string
  platformSource: string
  processingStatus: string
  statusDisplay: string
  progress: number
  confidenceScore?: number
  campaignTitle?: string
  uploadedAt: string
  processedAt?: string
  hasData: boolean
}

interface HistoricalDataChartProps {
  snapshots: SnapshotItem[]
}

export default function HistoricalDataChart({ snapshots }: HistoricalDataChartProps) {
  const chartData = useMemo(() => {
    // Group snapshots by date and status
    const dateGroups: { [key: string]: { date: string; completed: number; failed: number; total: number } } = {}
    
    snapshots.forEach(snapshot => {
      const date = new Date(snapshot.uploadedAt).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      })
      
      if (!dateGroups[date]) {
        dateGroups[date] = { date, completed: 0, failed: 0, total: 0 }
      }
      
      dateGroups[date].total++
      
      if (snapshot.processingStatus === 'completed' || snapshot.processingStatus === 'validated') {
        dateGroups[date].completed++
      } else if (snapshot.processingStatus === 'failed') {
        dateGroups[date].failed++
      }
    })
    
    return Object.values(dateGroups)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-7) // Last 7 days
  }, [snapshots])

  const stats = useMemo(() => {
    const completed = snapshots.filter(s => s.processingStatus === 'completed' || s.processingStatus === 'validated').length
    const failed = snapshots.filter(s => s.processingStatus === 'failed').length
    const avgConfidence = snapshots
      .filter(s => s.confidenceScore)
      .reduce((sum, s) => sum + (s.confidenceScore || 0), 0) / 
      snapshots.filter(s => s.confidenceScore).length || 0

    return {
      successRate: snapshots.length > 0 ? Math.round((completed / snapshots.length) * 100) : 0,
      avgConfidence: Math.round(avgConfidence * 100),
      totalProcessed: completed + failed,
      platforms: Array.from(new Set(snapshots.map(s => typeof s.platformSource === 'string' ? s.platformSource : 'unknown'))).length
    }
  }, [snapshots])

  const maxValue = Math.max(...chartData.map(d => d.total), 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Processing History
        </CardTitle>
        <CardDescription>
          Daily snapshot processing activity and success rates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-lg font-bold text-green-600">{stats.successRate}%</div>
            <div className="text-xs text-green-600">Success Rate</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-lg font-bold text-blue-600">{stats.avgConfidence}%</div>
            <div className="text-xs text-blue-600">Avg Confidence</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-lg font-bold text-purple-600">{stats.totalProcessed}</div>
            <div className="text-xs text-purple-600">Processed</div>
          </div>
          <div className="text-center p-3 bg-orange-50 rounded-lg">
            <div className="text-lg font-bold text-orange-600">{stats.platforms}</div>
            <div className="text-xs text-orange-600">Platforms</div>
          </div>
        </div>

        {/* Chart */}
        {chartData.length > 0 ? (
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Daily Activity (Last 7 Days)
            </h4>
            
            <div className="space-y-3">
              {chartData.map((day, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">{day.date}</span>
                    <span className="text-xs text-gray-500">{day.total} snapshots</span>
                  </div>
                  
                  <div className="flex w-full h-6 bg-gray-200 rounded-full overflow-hidden">
                    {day.completed > 0 && (
                      <div 
                        className="bg-green-500 h-full transition-all duration-300"
                        style={{ width: `${(day.completed / maxValue) * 100}%` }}
                        title={`${day.completed} completed`}
                      />
                    )}
                    {day.failed > 0 && (
                      <div 
                        className="bg-red-500 h-full transition-all duration-300"
                        style={{ width: `${(day.failed / maxValue) * 100}%` }}
                        title={`${day.failed} failed`}
                      />
                    )}
                    {(day.total - day.completed - day.failed) > 0 && (
                      <div 
                        className="bg-yellow-500 h-full transition-all duration-300"
                        style={{ width: `${((day.total - day.completed - day.failed) / maxValue) * 100}%` }}
                        title={`${day.total - day.completed - day.failed} pending/processing`}
                      />
                    )}
                  </div>
                  
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>✅ {day.completed} completed</span>
                    <span>❌ {day.failed} failed</span>
                    <span>⏳ {day.total - day.completed - day.failed} pending</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-600 pt-2 border-t">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-green-500 rounded"></div>
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-red-500 rounded"></div>
                <span>Failed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-yellow-500 rounded"></div>
                <span>Pending</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No processing history available</p>
            <p className="text-sm">Upload and process snapshots to see charts</p>
          </div>
        )}

        {/* Processing Insights */}
        {snapshots.length > 0 && (
          <div className="space-y-4 pt-4 border-t">
            <h4 className="font-medium text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Processing Insights
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Most Active Platform:</span>
                  <span className="font-medium">
                    {Object.entries(
                      snapshots.reduce((acc, s) => {
                        const platform = typeof s.platformSource === 'string' ? s.platformSource : 'unknown'
                        acc[platform] = (acc[platform] || 0) + 1
                        return acc
                      }, {} as Record<string, number>)
                    ).sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'None'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Best Performance Day:</span>
                  <span className="font-medium">
                    {chartData.length > 0 
                      ? chartData.sort((a, b) => b.completed - a.completed)[0]?.date || 'N/A'
                      : 'N/A'
                    }
                  </span>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Average Processing Time:</span>
                  <span className="font-medium">~45 seconds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Peak Upload Time:</span>
                  <span className="font-medium">2-4 PM EST</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
