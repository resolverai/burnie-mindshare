'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, HardDrive, Upload, Trash2, Cloud, Database, Zap, AlertTriangle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

interface CleanupStats {
  pendingCleanup: number
  totalLocalFiles: number
  totalS3Files: number
  uploadsDirectorySize: number
  uploadsDirectorySizeMB: number
}

interface CleanupStatus {
  cleanupTaskRunning: boolean
  dailyCleanupTaskRunning: boolean
  nextCleanupRun?: string
  nextDailyCleanupRun?: string
}

interface CleanupResult {
  processed?: number
  uploaded?: number
  deleted?: number
  failed?: number
  scanned?: number
  bytesFreed?: number
  bytesFreedMB?: number
}

export default function FileCleanupManager() {
  const [stats, setStats] = useState<CleanupStats | null>(null)
  const [status, setStatus] = useState<CleanupStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessingCleanup, setIsProcessingCleanup] = useState(false)
  const [isProcessingOldFiles, setIsProcessingOldFiles] = useState(false)
  const [isProcessingFull, setIsProcessingFull] = useState(false)
  const [lastCleanupResult, setLastCleanupResult] = useState<any>(null)

  useEffect(() => {
    fetchCleanupData()
    
    // Refresh data every 30 seconds
    const interval = setInterval(fetchCleanupData, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchCleanupData = async () => {
    try {
      setIsLoading(true)
      
      // Fetch both stats and status
      const [statsResponse, statusResponse] = await Promise.all([
        fetch('/api/admin/snapshots/cleanup/stats'),
        fetch('/api/admin/snapshots/cleanup/status')
      ])
      
      const statsData = await statsResponse.json()
      const statusData = await statusResponse.json()
      
      if (statsData.success) {
        setStats(statsData.stats)
      }
      
      if (statusData.success) {
        setStatus(statusData.status)
      }
    } catch (error) {
      console.error('Error fetching cleanup data:', error)
      toast.error('Failed to fetch cleanup information')
    } finally {
      setIsLoading(false)
    }
  }

  const handleProcessedCleanup = async () => {
    if (!confirm('Upload processed snapshots to S3 and delete local files?')) {
      return
    }

    try {
      setIsProcessingCleanup(true)
      toast.loading('Processing uploaded snapshots...', { id: 'cleanup-processed' })
      
      const response = await fetch('/api/admin/snapshots/cleanup/processed', {
        method: 'POST'
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast.success(data.message, { id: 'cleanup-processed' })
        setLastCleanupResult(data.result)
        setTimeout(fetchCleanupData, 1000)
      } else {
        toast.error(data.message || 'Cleanup failed', { id: 'cleanup-processed' })
      }
    } catch (error) {
      console.error('Error during processed cleanup:', error)
      toast.error('Cleanup failed', { id: 'cleanup-processed' })
    } finally {
      setIsProcessingCleanup(false)
    }
  }

  const handleOldFilesCleanup = async () => {
    const days = prompt('Delete local files older than how many days?', '7')
    if (!days || isNaN(parseInt(days))) {
      return
    }

    if (!confirm(`Delete local files older than ${days} days?`)) {
      return
    }

    try {
      setIsProcessingOldFiles(true)
      toast.loading('Cleaning up old files...', { id: 'cleanup-old' })
      
      const response = await fetch('/api/admin/snapshots/cleanup/old-files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ days: parseInt(days) })
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast.success(data.message, { id: 'cleanup-old' })
        setLastCleanupResult(data.result)
        setTimeout(fetchCleanupData, 1000)
      } else {
        toast.error(data.message || 'Old files cleanup failed', { id: 'cleanup-old' })
      }
    } catch (error) {
      console.error('Error during old files cleanup:', error)
      toast.error('Old files cleanup failed', { id: 'cleanup-old' })
    } finally {
      setIsProcessingOldFiles(false)
    }
  }

  const handleFullCleanup = async () => {
    if (!confirm('Run full cleanup process? This will upload processed files to S3 and clean up old local files.')) {
      return
    }

    try {
      setIsProcessingFull(true)
      toast.loading('Running full cleanup...', { id: 'cleanup-full' })
      
      const response = await fetch('/api/admin/snapshots/cleanup/full', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cleanupProcessed: true,
          cleanupOldFiles: true,
          oldFilesDays: 7
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast.success('Full cleanup completed successfully', { id: 'cleanup-full' })
        setLastCleanupResult(data.result)
        setTimeout(fetchCleanupData, 1000)
      } else {
        toast.error(data.message || 'Full cleanup failed', { id: 'cleanup-full' })
      }
    } catch (error) {
      console.error('Error during full cleanup:', error)
      toast.error('Full cleanup failed', { id: 'cleanup-full' })
    } finally {
      setIsProcessingFull(false)
    }
  }

  const getStorageWarningLevel = (sizeMB: number) => {
    if (sizeMB > 1000) return 'danger' // > 1GB
    if (sizeMB > 500) return 'warning' // > 500MB
    return 'safe'
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            File Cleanup Manager
          </CardTitle>
          <CardDescription>
            Automated S3 upload and local file cleanup
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

  const storageLevel = stats ? getStorageWarningLevel(stats.uploadsDirectorySizeMB) : 'safe'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          File Cleanup Manager
          {status?.cleanupTaskRunning && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <CheckCircle className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Automated S3 upload and local file cleanup to prevent Docker storage issues
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Storage Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{stats.pendingCleanup}</div>
              <div className="text-sm text-blue-600">Pending Cleanup</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{stats.totalLocalFiles}</div>
              <div className="text-sm text-yellow-600">Local Files</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{stats.totalS3Files}</div>
              <div className="text-sm text-green-600">S3 Files</div>
            </div>
            <div className={`text-center p-4 rounded-lg ${
              storageLevel === 'danger' ? 'bg-red-50' :
              storageLevel === 'warning' ? 'bg-orange-50' : 'bg-gray-50'
            }`}>
              <div className={`text-2xl font-bold ${
                storageLevel === 'danger' ? 'text-red-600' :
                storageLevel === 'warning' ? 'text-orange-600' : 'text-gray-600'
              }`}>
                {stats.uploadsDirectorySizeMB}
              </div>
              <div className={`text-sm ${
                storageLevel === 'danger' ? 'text-red-600' :
                storageLevel === 'warning' ? 'text-orange-600' : 'text-gray-600'
              }`}>
                MB Used
              </div>
            </div>
          </div>
        )}

        {/* Storage Warning */}
        {stats && storageLevel !== 'safe' && (
          <div className={`p-4 rounded-lg border ${
            storageLevel === 'danger' 
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-orange-50 border-orange-200 text-orange-800'
          }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">
                {storageLevel === 'danger' 
                  ? 'Critical: High storage usage detected!'
                  : 'Warning: Storage usage is elevated'
                }
              </span>
            </div>
            <p className="text-sm mt-1">
              Consider running cleanup to free up Docker storage space in production.
            </p>
          </div>
        )}

        {/* Scheduled Tasks Status */}
        {status && (
          <div className="space-y-3">
            <h4 className="font-medium text-gray-900">Scheduled Tasks</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">Processed Files</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={status.cleanupTaskRunning ? 'default' : 'secondary'}>
                    {status.cleanupTaskRunning ? 'Running' : 'Stopped'}
                  </Badge>
                  <span className="text-xs text-gray-500">Every 2h</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-orange-500" />
                  <span className="text-sm">Old Files</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={status.dailyCleanupTaskRunning ? 'default' : 'secondary'}>
                    {status.dailyCleanupTaskRunning ? 'Running' : 'Stopped'}
                  </Badge>
                  <span className="text-xs text-gray-500">Daily 2AM</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manual Cleanup Controls */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-gray-900">Manual Cleanup</h4>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={fetchCleanupData}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button 
              variant="outline"
              onClick={handleProcessedCleanup}
              disabled={isProcessingCleanup || !stats?.pendingCleanup}
              className="flex items-center gap-2"
            >
              {isProcessingCleanup ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload Processed
            </Button>
            
            <Button 
              variant="outline"
              onClick={handleOldFilesCleanup}
              disabled={isProcessingOldFiles}
              className="flex items-center gap-2"
            >
              {isProcessingOldFiles ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Clean Old Files
            </Button>
            
            <Button 
              onClick={handleFullCleanup}
              disabled={isProcessingFull}
              className="flex items-center gap-2"
            >
              {isProcessingFull ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Full Cleanup
            </Button>
          </div>
        </div>

        {/* Last Cleanup Result */}
        {lastCleanupResult && (
          <div className="space-y-3 pt-4 border-t">
            <h4 className="font-medium text-gray-900">Last Cleanup Result</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {lastCleanupResult.uploaded !== undefined && (
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-lg font-bold text-green-600">{lastCleanupResult.uploaded}</div>
                  <div className="text-xs text-green-600">Uploaded</div>
                </div>
              )}
              {lastCleanupResult.deleted !== undefined && (
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-lg font-bold text-blue-600">{lastCleanupResult.deleted}</div>
                  <div className="text-xs text-blue-600">Deleted</div>
                </div>
              )}
              {lastCleanupResult.bytesFreedMB !== undefined && (
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-lg font-bold text-purple-600">{lastCleanupResult.bytesFreedMB}</div>
                  <div className="text-xs text-purple-600">MB Freed</div>
                </div>
              )}
              {lastCleanupResult.failed !== undefined && lastCleanupResult.failed > 0 && (
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <div className="text-lg font-bold text-red-600">{lastCleanupResult.failed}</div>
                  <div className="text-xs text-red-600">Failed</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="text-xs text-gray-500 space-y-1 pt-4 border-t">
          <p><strong>How it works:</strong></p>
          <p>• Processed snapshots are automatically uploaded to S3 and local files deleted</p>
          <p>• S3 structure: daily-snapshots/YYYY-MM-DD/campaign_id/filename.jpg</p>
          <p>• Scheduled cleanup runs every 2 hours for processed files, daily at 2 AM for old files</p>
          <p>• Manual cleanup allows immediate processing without waiting for scheduled tasks</p>
        </div>
      </CardContent>
    </Card>
  )
}
