'use client'

import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Clock, CheckCircle, AlertCircle, RefreshCw, FileImage } from 'lucide-react'

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

interface ProcessingStatusProps {
  snapshots: SnapshotItem[]
}

export default function ProcessingStatus({ snapshots }: ProcessingStatusProps) {
  const getStatusStats = () => {
    const stats = {
      total: snapshots.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    }

    snapshots.forEach(snapshot => {
      switch (snapshot.processingStatus) {
        case 'pending':
          stats.pending++
          break
        case 'processing':
          stats.processing++
          break
        case 'completed':
        case 'validated':
          stats.completed++
          break
        case 'failed':
          stats.failed++
          break
      }
    })

    return stats
  }

  const stats = getStatusStats()
  const recentSnapshots = snapshots
    .filter(s => s.processingStatus === 'processing' || 
                 (s.processingStatus === 'pending' && snapshots.indexOf(s) < 5))
    .slice(0, 5)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'processing':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
      case 'completed':
      case 'validated':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'processing':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'completed':
      case 'validated':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileImage className="h-5 w-5" />
          Processing Status
        </CardTitle>
        <CardDescription>
          Current status of screenshot processing and AI analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Overview */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-600">Total</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-sm text-yellow-600">Pending</div>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{stats.processing}</div>
            <div className="text-sm text-blue-600">Processing</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-red-600">Failed</div>
          </div>
        </div>

        {/* Recent Activity */}
        {recentSnapshots.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900">Recent Activity</h4>
            <div className="space-y-3">
              {recentSnapshots.map((snapshot) => (
                <div key={snapshot.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(snapshot.processingStatus)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {snapshot.fileName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {typeof snapshot.platformSource === 'object' ? 'unknown' : String(snapshot.platformSource || '')} • {snapshot.campaignTitle || 'No campaign'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Badge className={`${getStatusColor(snapshot.processingStatus)} border`}>
                      {snapshot.statusDisplay}
                    </Badge>

                    {snapshot.processingStatus === 'processing' && snapshot.progress > 0 && (
                      <div className="w-24">
                        <Progress value={snapshot.progress} className="h-2" />
                      </div>
                    )}

                    {snapshot.confidenceScore && (
                      <div className="text-xs text-gray-600 min-w-0">
                        {Math.round(snapshot.confidenceScore * 100)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Processing Statistics */}
        {stats.total > 0 && (
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900">Processing Statistics</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Success Rate</span>
                <span className="text-sm font-medium">
                  {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
                </span>
              </div>
              <Progress 
                value={stats.total > 0 ? (stats.completed / stats.total) * 100 : 0} 
                className="h-2" 
              />
              
              <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                <div>Average Processing Time: ~45 seconds</div>
                <div>Queue Status: {stats.pending + stats.processing} in queue</div>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {stats.total === 0 && (
          <div className="text-center py-8 text-gray-500">
            <FileImage className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No snapshots to process</p>
            <p className="text-sm">Upload screenshots to begin processing</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
