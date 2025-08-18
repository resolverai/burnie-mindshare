'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Play, Clock, AlertCircle, CheckCircle, Package, Calendar, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface PendingBatch {
  platform: string
  campaignId: number | null
  campaignTitle: string
  snapshotDate: string
  count: number
}

interface PendingSnapshotsSummary {
  totalPending: number
  totalBatches: number
  batches: PendingBatch[]
}

interface ProcessedBatch {
  groupKey: string
  platform: string
  campaignId: number | null
  campaignTitle: string
  snapshotDate: string
  snapshotCount: number
  snapshotIds: number[]
}

interface PendingSnapshotsProcessorProps {
  onProcessingComplete?: () => void
}

export default function PendingSnapshotsProcessor({ onProcessingComplete }: PendingSnapshotsProcessorProps) {
  const [summary, setSummary] = useState<PendingSnapshotsSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processedBatches, setProcessedBatches] = useState<ProcessedBatch[]>([])
  const [showProcessedBatches, setShowProcessedBatches] = useState(false)

  useEffect(() => {
    fetchPendingSummary()
  }, [])

  const fetchPendingSummary = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/snapshots/pending-summary')
      const data = await response.json()
      
      if (data.success) {
        setSummary(data)
      } else {
        toast.error(data.message || 'Failed to fetch pending snapshots summary')
      }
    } catch (error) {
      console.error('Error fetching pending summary:', error)
      toast.error('Failed to fetch pending snapshots summary')
    } finally {
      setIsLoading(false)
    }
  }

  const startPollingForCompletion = () => {
    let pollCount = 0
    const maxPolls = 30 // Poll for max 60 seconds
    
    const pollInterval = setInterval(async () => {
      pollCount++
      
      try {
        await fetchPendingSummary()
        
        // Check if processing is complete (no more pending batches)
        if (summary && summary.totalPending === 0) {
          clearInterval(pollInterval)
          setIsProcessing(false)
          onProcessingComplete?.()
          toast.success('All snapshots processed successfully!', { id: 'process-pending' })
          return
        }
        
        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval)
          setIsProcessing(false)
          toast.info('Processing may still be in progress. Please refresh manually.', { id: 'process-pending' })
        }
      } catch (error) {
        console.error('Error during polling:', error)
        // Continue polling even if one request fails
      }
    }, 2000) // Poll every 2 seconds
  }

  const handleProcessPendingSnapshots = async () => {
    if (!summary || summary.totalPending === 0) {
      toast.error('No pending snapshots to process')
      return
    }

    if (!confirm(`Are you sure you want to process ${summary.totalBatches} batch(es) containing ${summary.totalPending} pending snapshots?`)) {
      return
    }

    try {
      setIsProcessing(true)
      toast.loading('Processing pending snapshots...', { id: 'process-pending' })
      
      const response = await fetch('/api/admin/snapshots/process-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message, { id: 'process-pending' })
        setProcessedBatches(data.batches || [])
        setShowProcessedBatches(true)
        
        // Start polling for completion
        startPollingForCompletion()
      } else {
        toast.error(data.message || 'Failed to process pending snapshots', { id: 'process-pending' })
      }
    } catch (error) {
      console.error('Error processing pending snapshots:', error)
      toast.error('Failed to process pending snapshots', { id: 'process-pending' })
    } finally {
      setIsProcessing(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getPlatformEmoji = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'cookie.fun': return '🍪'
      case 'yaps.kaito.ai': return '🤖'
      case 'yap.market': return '💬'
      case 'amplifi.now': return '📢'
      case 'arbus': return '🚌'
      case 'trendsage.xyz': return '📈'
      case 'bantr': return '💬'
      default: return '📸'
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pending Snapshots Processor
          </CardTitle>
          <CardDescription>
            Process failed or pending snapshots in batches
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded w-1/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Pending Snapshots Processor
          {summary && summary.totalPending > 0 && (
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
              {summary.totalPending} pending
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Process failed or pending snapshots grouped by platform, campaign, and date
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{summary.totalPending}</div>
              <div className="text-sm text-yellow-600">Pending Snapshots</div>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{summary.totalBatches}</div>
              <div className="text-sm text-blue-600">Processing Batches</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg md:col-span-1 col-span-2">
              <Button 
                onClick={handleProcessPendingSnapshots}
                disabled={isProcessing || !summary.totalPending}
                className="w-full"
                size="sm"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Process All Batches
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Refresh Button */}
        <div className="flex justify-between items-center">
          <h4 className="font-medium text-gray-900">
            {summary?.totalPending ? 'Pending Batches' : 'No Pending Snapshots'}
          </h4>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchPendingSummary}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Pending Batches List */}
        {summary && summary.batches.length > 0 ? (
          <div className="space-y-3">
            {summary.batches.map((batch, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-yellow-50/50">
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <div>
                    <div className="font-medium text-gray-900">
                      {getPlatformEmoji(batch.platform)} {batch.platform}
                    </div>
                    <div className="text-sm text-gray-500">
                      {batch.campaignTitle} • {formatDate(batch.snapshotDate)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                    {batch.count} snapshots
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : summary?.totalPending === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p className="font-medium">All snapshots processed!</p>
            <p className="text-sm">No pending or failed snapshots found</p>
          </div>
        ) : null}

        {/* Recently Processed Batches */}
        {showProcessedBatches && processedBatches.length > 0 && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              <h4 className="font-medium text-gray-900">Recently Processed Batches</h4>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                {processedBatches.length} batches
              </Badge>
            </div>
            
            <div className="space-y-2">
              {processedBatches.map((batch, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-green-50/50">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <div className="font-medium text-gray-900">
                        {getPlatformEmoji(batch.platform)} {batch.platform}
                      </div>
                      <div className="text-sm text-gray-500">
                        {batch.campaignTitle} • {formatDate(batch.snapshotDate)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                      {batch.snapshotCount} snapshots
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowProcessedBatches(false)}
              >
                Hide Processed Batches
              </Button>
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="text-xs text-gray-500 space-y-1 pt-4 border-t">
          <p><strong>How it works:</strong></p>
          <p>• Snapshots are grouped by platform, campaign, and date</p>
          <p>• Each group is processed as a separate batch for better organization</p>
          <p>• Failed snapshots are automatically included for reprocessing</p>
          <p>• Processing happens in the background - you can continue using the interface</p>
        </div>
      </CardContent>
    </Card>
  )
}
