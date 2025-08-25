'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Upload, FileImage, AlertCircle, CheckCircle, Clock, Trash2, Eye, RefreshCw, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import PlatformSelector from './components/PlatformSelector'
import CampaignSelector from './components/CampaignSelector'
import ScreenshotUploader from './components/ScreenshotUploader'
import ProcessingStatus from './components/ProcessingStatus'
import HistoricalDataChart from './components/HistoricalDataChart'
import TrendVisualization from './components/TrendVisualization'
import PendingSnapshotsProcessor from './components/PendingSnapshotsProcessor'
import FileCleanupManager from './components/FileCleanupManager'
import LLMProviderManager from './components/LLMProviderManager'

interface Platform {
  value: string
  label: string
}

interface Campaign {
  value: number
  label: string
  platformSource: string
  description: string
}

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

export default function AdminSnapshotsPage() {
  const router = useRouter()
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<string>('cookie.fun')
  const [isClient, setIsClient] = useState(false)
  
  // Ensure we're on the client side to prevent hydration issues
  useEffect(() => {
    setIsClient(true)
  }, [])
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [snapshotDate, setSnapshotDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [snapshotMode, setSnapshotMode] = useState<'campaign' | 'yapper'>('campaign')
  const [yapperHandle, setYapperHandle] = useState<string>('')

  // Fetch platforms and campaigns on component mount
  useEffect(() => {
    fetchPlatforms()
    fetchSnapshots()
    
    // Removed automatic refresh - no longer needed
    // const pollInterval = setInterval(() => {
    //   if (!isProcessing && !isUploading) {
    //     fetchSnapshots(false) // Silent refresh
    //   }
    // }, 5000)
    
    // return () => clearInterval(pollInterval)
  }, [])

  // Fetch campaigns when platform changes
  useEffect(() => {
    if (selectedPlatform) {
      fetchCampaigns(selectedPlatform)
    }
  }, [selectedPlatform])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC key to go back to dashboard
      if (event.key === 'Escape') {
        router.push('/admin/dashboard')
      }
      // F5 or Ctrl/Cmd + R to refresh
      if (event.key === 'F5' || (event.key === 'r' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault()
        handleRefreshAll()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router])

  const fetchPlatforms = async () => {
    try {
      const response = await fetch('/api/admin/snapshots/platforms')
      const data = await response.json()
      if (data.success) {
        setPlatforms(data.platforms)
      }
    } catch (error) {
      console.error('Error fetching platforms:', error)
      toast.error('Failed to fetch platforms')
    }
  }

  const fetchCampaigns = async (platformSource: string) => {
    try {
      const response = await fetch(`/api/admin/snapshots/campaigns?platformSource=${platformSource}`)
      const data = await response.json()
      if (data.success) {
        setCampaigns(data.campaigns)
        // Reset selected campaign when platform changes
        setSelectedCampaign(null)
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error)
      toast.error('Failed to fetch campaigns')
    }
  }

  const fetchSnapshots = async (showRefreshToast = false) => {
    try {
      if (showRefreshToast) {
        setRefreshing(true)
        toast.loading('Refreshing snapshots...', { id: 'refresh-snapshots' })
      }
      
      const response = await fetch('/api/admin/snapshots/history?limit=50')
      const data = await response.json()
      if (data.success) {
        setSnapshots(data.snapshots)
        if (showRefreshToast) {
          toast.success('Snapshots refreshed successfully', { id: 'refresh-snapshots' })
        }
      }
    } catch (error) {
      console.error('Error fetching snapshots:', error)
      toast.error('Failed to fetch snapshots', { id: 'refresh-snapshots' })
    } finally {
      // Always set loading to false when initial load completes
      setLoading(false)
      if (showRefreshToast) {
        setRefreshing(false)
      }
    }
  }

  const handleFileUpload = (files: File[]) => {
    setUploadedFiles(files)
  }

  const handleRefreshAll = async () => {
    setRefreshing(true)
    toast.loading('Refreshing all data...', { id: 'refresh-all' })
    
    try {
      // Refresh platforms, campaigns, and snapshots in parallel
      await Promise.all([
        fetchPlatforms(),
        selectedPlatform ? fetchCampaigns(selectedPlatform) : Promise.resolve(),
        fetchSnapshots()
      ])
      
      toast.success('All data refreshed successfully', { id: 'refresh-all' })
    } catch (error) {
      toast.error('Failed to refresh data', { id: 'refresh-all' })
    } finally {
      setRefreshing(false)
    }
  }

  const handleUploadSubmit = async () => {
    if (uploadedFiles.length === 0) {
      toast.error('Please select files to upload')
      return
    }

    if (!selectedPlatform) {
      toast.error('Please select a platform')
      return
    }

    // Validate based on snapshot mode
    if (snapshotMode === 'campaign') {
      if (!selectedCampaign) {
        toast.error('Please select a campaign')
        return
      }
    } else {
      if (!yapperHandle.trim()) {
        toast.error('Please enter a yapper Twitter handle')
        return
      }
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      uploadedFiles.forEach(file => {
        formData.append('screenshots', file)
      })
      
      formData.append('platformSource', selectedPlatform)
      formData.append('snapshotDate', snapshotDate)
      
      if (snapshotMode === 'campaign' && selectedCampaign !== null) {
        formData.append('campaignId', selectedCampaign.toString())
        formData.append('snapshotType', 'leaderboard')
        formData.append('snapshotTimeframe', '24H')
      } else {
        // Clean up yapper handle (remove @ if present)
        const cleanHandle = yapperHandle.trim().replace(/^@/, '')
        formData.append('yapperTwitterHandle', cleanHandle)
        formData.append('snapshotType', 'yapper_profile')
        formData.append('snapshotTimeframe', '7D')
      }

      const response = await fetch('/api/admin/snapshots/upload', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (data.success) {
        toast.success(`${uploadedFiles.length} snapshot(s) uploaded successfully`)
        setUploadedFiles([])
        if (snapshotMode === 'yapper') {
          setYapperHandle('') // Clear yapper handle after successful upload
        }
        fetchSnapshots() // Refresh the list
      } else {
        toast.error(data.message || 'Upload failed')
      }
    } catch (error) {
      console.error('Error uploading files:', error)
      toast.error('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleProcessSnapshots = async (snapshotIds?: number[]) => {
    setIsProcessing(true)

    try {
      const response = await fetch('/api/admin/snapshots/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          snapshotIds,
          platformSource: selectedPlatform
        })
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        // Refresh snapshots after a short delay
        setTimeout(() => {
          fetchSnapshots()
        }, 2000)
      } else {
        toast.error(data.message || 'Processing failed')
      }
    } catch (error) {
      console.error('Error processing snapshots:', error)
      toast.error('Processing failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteSnapshot = async (snapshotId: number) => {
    if (!confirm('Are you sure you want to delete this snapshot?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/snapshots/${snapshotId}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Snapshot deleted successfully')
        fetchSnapshots()
      } else {
        toast.error(data.message || 'Delete failed')
      }
    } catch (error) {
      console.error('Error deleting snapshot:', error)
      toast.error('Delete failed')
    }
  }

  // Twitter queue processing is now handled automatically by cron job

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
        return 'bg-yellow-100 text-yellow-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'completed':
      case 'validated':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const pendingSnapshots = snapshots.filter(s => s.processingStatus === 'pending')

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid gap-6">
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Button 
              onClick={() => router.push('/admin/dashboard')}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Snapshot Management</h1>
          <p className="text-gray-600 mt-2">Upload and process attention economy platform screenshots for AI analysis</p>
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <p className="text-sm text-amber-800">
              <strong>⏱️ 24H Data Only:</strong> All snapshots must show "Last 24 Hours" data for optimal ML model training and time series predictions.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleRefreshAll} 
            variant="outline"
            size="sm"
            disabled={refreshing}
            className="text-gray-700 border-gray-300 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh All'}
          </Button>
                            {pendingSnapshots.length > 0 && (
                    <Button 
                      onClick={() => handleProcessSnapshots()}
                      disabled={isProcessing}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {isProcessing ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <FileImage className="h-4 w-4 mr-2" />
                      )}
                      Process Pending ({pendingSnapshots.length})
                    </Button>
                  )}
                  {/* Twitter Queue Processing is now automated via cron job - button removed */}
        </div>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Screenshots
          </CardTitle>
          <CardDescription>
            Upload platform screenshots with campaign association for ML model training
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Snapshot Mode Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              📷 Snapshot Type
            </label>
            <div className="flex space-x-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="snapshotMode"
                  value="campaign"
                  checked={snapshotMode === 'campaign'}
                  onChange={(e) => setSnapshotMode(e.target.value as 'campaign' | 'yapper')}
                  className="mr-2"
                />
                <span className="text-sm">🏆 Campaign/Leaderboard</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="snapshotMode"
                  value="yapper"
                  checked={snapshotMode === 'yapper'}
                  onChange={(e) => setSnapshotMode(e.target.value as 'campaign' | 'yapper')}
                  className="mr-2"
                />
                <span className="text-sm">👤 Individual Yapper Profile</span>
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {snapshotMode === 'campaign' 
                ? 'Upload leaderboard/campaign screenshots for extracting yapper rankings and campaign data'
                : 'Upload individual yapper profile screenshots for detailed profile analysis (7D focus)'
              }
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <PlatformSelector
              platforms={platforms}
              selectedPlatform={selectedPlatform}
              onPlatformChange={setSelectedPlatform}
            />
            
            {snapshotMode === 'campaign' ? (
              <div className="lg:col-span-2">
                <CampaignSelector
                  campaigns={campaigns}
                  selectedCampaign={selectedCampaign}
                  onCampaignChange={setSelectedCampaign}
                  disabled={!selectedPlatform}
                />
              </div>
            ) : (
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Yapper Twitter Handle
                </label>
                <input
                  type="text"
                  value={yapperHandle}
                  onChange={(e) => setYapperHandle(e.target.value)}
                  placeholder="Enter @handle or handle"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isUploading || isProcessing}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Twitter handle of the yapper whose profile you're uploading
                </p>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Snapshot Date ({snapshotMode === 'campaign' ? '24H' : '7D'} Data)
              </label>
              <input
                type="date"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                max={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs text-gray-500 mt-1">
                Date for which {snapshotMode === 'campaign' ? '24H' : '7D'} data was captured
              </p>
            </div>
          </div>

          <ScreenshotUploader
            onFileUpload={handleFileUpload}
            uploadedFiles={uploadedFiles}
            maxFiles={10}
          />

          <div className="flex justify-end">
            <Button 
              onClick={handleUploadSubmit}
              disabled={isUploading || uploadedFiles.length === 0 || 
                (snapshotMode === 'campaign' && !selectedCampaign) ||
                (snapshotMode === 'yapper' && !yapperHandle.trim())}
              className="min-w-32"
            >
              {isUploading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload {uploadedFiles.length > 0 && `(${uploadedFiles.length})`}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Processing Status */}
      <ProcessingStatus snapshots={snapshots} />
      
      {/* Pending Snapshots Processor */}
      <PendingSnapshotsProcessor onProcessingComplete={() => fetchSnapshots()} />
      
      {/* File Cleanup Manager */}
      <FileCleanupManager />
      
      {/* LLM Provider Manager */}
      <LLMProviderManager />

      {/* Trend Visualization */}
      {isClient && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TrendVisualization platformSource={String(selectedPlatform || 'cookie.fun')} />
          <HistoricalDataChart snapshots={snapshots} />
        </div>
      )}

      {/* Snapshot History */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Snapshots</CardTitle>
          <CardDescription>
            History of uploaded and processed screenshots
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {snapshots.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileImage className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No snapshots uploaded yet</p>
              </div>
            ) : (
              snapshots.map((snapshot) => (
                <div 
                  key={snapshot.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    {getStatusIcon(snapshot.processingStatus)}
                    <div>
                      <div className="font-medium">{snapshot.fileName}</div>
                      <div className="text-sm text-gray-500">
                        {typeof snapshot.platformSource === 'object' ? 'unknown' : String(snapshot.platformSource || '')} • {snapshot.campaignTitle || 'No campaign'}
                      </div>
                      <div className="text-xs text-gray-400">
                        Uploaded {new Date(snapshot.uploadedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Badge className={getStatusColor(snapshot.processingStatus)}>
                      {snapshot.statusDisplay}
                    </Badge>
                    
                    {snapshot.confidenceScore && (
                      <div className="text-sm text-gray-600">
                        {Math.round(snapshot.confidenceScore * 100)}% confidence
                      </div>
                    )}

                    {snapshot.progress > 0 && snapshot.progress < 100 && (
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${snapshot.progress}%` }}
                        ></div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {snapshot.hasData && (
                        <Button size="sm" variant="outline" className="text-gray-700 border-gray-300 hover:bg-gray-50">
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                        className="text-gray-700 border-gray-300 hover:bg-gray-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Help Section */}
      <div className="text-center text-sm text-gray-500 border-t pt-4">
        <p>💡 Keyboard shortcuts: <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">ESC</kbd> - Back to Dashboard | <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">F5</kbd> - Refresh All</p>
      </div>
    </div>
  )
}
