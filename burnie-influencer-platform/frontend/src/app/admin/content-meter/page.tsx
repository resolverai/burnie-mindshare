'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { 
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline'

interface CampaignContentSummary {
  campaignId: string
  campaignTitle: string
  projectName: string
  availableCounts: {
    shitpost: number
    thread: number
    longpost: number
  }
  purchasedCounts: {
    shitpost: number
    thread: number
    longpost: number
  }
  totalAvailable: number
  totalPurchased: number
}

interface AdminUser {
  id: number
  username: string
  last_login?: string
}

export default function ContentMeterPage() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const router = useRouter()

  // Check admin authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('adminToken')
    const user = localStorage.getItem('adminUser')
    
    if (!token || !user) {
      router.push('/admin')
      return
    }

    try {
      setAdminUser(JSON.parse(user))
    } catch (error) {
      router.push('/admin')
    }
  }, [router])

  // Get admin token for API calls
  const getAdminToken = () => {
    return localStorage.getItem('adminToken')
  }

  // Fetch content meter data
  const { data: contentMeterData, isLoading, error } = useQuery({
    queryKey: ['admin-content-meter'],
    queryFn: async () => {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/content-meter`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch content meter data')
      }

      const data = await response.json()
      return data.data
    },
    enabled: !!adminUser,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Filter campaigns by search term
  const filteredCampaigns = contentMeterData?.campaigns?.filter((campaign: CampaignContentSummary) =>
    campaign.campaignTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.projectName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || []

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    router.push('/admin')
  }

  if (!adminUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading content meter...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="p-2 text-gray-700 hover:text-gray-900 transition-colors border border-gray-300 rounded-lg hover:bg-gray-50"
                title="Back to Dashboard"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                  <ChartBarIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold gradient-text">Content Meter</h1>
                  <p className="text-xs text-gray-500">Campaign Content Overview</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {adminUser.username}</span>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Content Meter</h2>
          <p className="text-gray-600">Monitor content availability across campaigns by post type</p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <input
              type="text"
              placeholder="Search campaigns by title or project name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
          </div>
          {searchTerm && (
            <p className="mt-2 text-sm text-gray-600">
              Found {filteredCampaigns.length} campaign{filteredCampaigns.length !== 1 ? 's' : ''} matching "{searchTerm}"
            </p>
          )}
        </div>

        {/* Content Overview */}
        {isLoading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading content meter data...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600">Failed to load content meter data</p>
            <p className="text-gray-500 text-sm mt-2">Please try refreshing the page</p>
          </div>
        ) : filteredCampaigns.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="grid grid-cols-12 gap-4 text-sm font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">Campaign</div>
                <div className="col-span-2 text-center">
                  <div className="text-xs">Shitposts</div>
                  <div className="text-xs font-normal text-gray-400 mt-1">Available | Purchased</div>
                </div>
                <div className="col-span-2 text-center">
                  <div className="text-xs">Threads</div>
                  <div className="text-xs font-normal text-gray-400 mt-1">Available | Purchased</div>
                </div>
                <div className="col-span-2 text-center">
                  <div className="text-xs">Longposts</div>
                  <div className="text-xs font-normal text-gray-400 mt-1">Available | Purchased</div>
                </div>
                <div className="col-span-2 text-center">
                  <div className="text-xs">Total</div>
                  <div className="text-xs font-normal text-gray-400 mt-1">Available | Purchased</div>
                </div>
              </div>
            </div>

            {/* Campaign Rows */}
            <div className="divide-y divide-gray-200">
              {filteredCampaigns.map((campaign: CampaignContentSummary) => (
                <div key={campaign.campaignId} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Campaign Info */}
                    <div className="col-span-4">
                      <div className="font-medium text-gray-900">{campaign.campaignTitle}</div>
                      <div className="text-sm text-gray-500">{campaign.projectName}</div>
                    </div>

                    {/* Shitposts */}
                    <div className="col-span-2 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <div className="flex items-center space-x-1">
                          <div className="flex items-center space-x-1">
                            <span className={`text-sm font-semibold ${
                              campaign.availableCounts.shitpost < 5 ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {campaign.availableCounts.shitpost}
                            </span>
                            {campaign.availableCounts.shitpost < 5 && (
                              <ExclamationTriangleIcon className="h-4 w-4 text-red-500" title="Low available content count" />
                            )}
                          </div>
                          <span className="text-xs text-gray-500">|</span>
                          <span className="text-sm font-semibold text-blue-600">
                            {campaign.purchasedCounts.shitpost}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Threads */}
                    <div className="col-span-2 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <div className="flex items-center space-x-1">
                          <div className="flex items-center space-x-1">
                            <span className={`text-sm font-semibold ${
                              campaign.availableCounts.thread < 5 ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {campaign.availableCounts.thread}
                            </span>
                            {campaign.availableCounts.thread < 5 && (
                              <ExclamationTriangleIcon className="h-4 w-4 text-red-500" title="Low available content count" />
                            )}
                          </div>
                          <span className="text-xs text-gray-500">|</span>
                          <span className="text-sm font-semibold text-blue-600">
                            {campaign.purchasedCounts.thread}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Longposts */}
                    <div className="col-span-2 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <div className="flex items-center space-x-1">
                          <div className="flex items-center space-x-1">
                            <span className={`text-sm font-semibold ${
                              campaign.availableCounts.longpost < 5 ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {campaign.availableCounts.longpost}
                            </span>
                            {campaign.availableCounts.longpost < 5 && (
                              <ExclamationTriangleIcon className="h-4 w-4 text-red-500" title="Low available content count" />
                            )}
                          </div>
                          <span className="text-xs text-gray-500">|</span>
                          <span className="text-sm font-semibold text-blue-600">
                            {campaign.purchasedCounts.longpost}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Total */}
                    <div className="col-span-2 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <span className="text-sm font-semibold text-gray-900">
                          {campaign.totalAvailable}
                        </span>
                        <span className="text-xs text-gray-500">|</span>
                        <span className="text-sm font-semibold text-blue-600">
                          {campaign.totalPurchased}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <ChartBarIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500 text-lg">No campaigns found</p>
            <p className="text-gray-400 text-sm">
              {searchTerm ? 'Try adjusting your search terms' : 'No campaigns have content available yet'}
            </p>
          </div>
        )}

        {/* Legend */}
        {filteredCampaigns.length > 0 && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
              <span className="text-sm font-medium text-blue-900">Content Alert</span>
            </div>
            <div className="text-sm text-blue-800 space-y-1">
              <p>
                <span className="font-semibold">Available:</span> Content that is available, approved, and biddable for purchase.
              </p>
              <p>
                <span className="font-semibold">Purchased:</span> Content that has been purchased by users (shown in blue).
              </p>
              <p>
                <span className="font-semibold">Warning:</span> Red numbers and warning icons indicate post types with less than 5 available content pieces.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
