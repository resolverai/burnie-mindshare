'use client'

import { useAuth } from '@/hooks/useAuth'
import { useTwitterConnection } from '@/hooks/useTwitterConnection'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import MinerDashboard from '@/components/MinerDashboard'
import TwitterConnection from '@/components/TwitterConnection'

export default function CampaignsPage() {
  const { isAuthenticated, isLoading, address } = useAuth()
  const { isConnected: isTwitterConnected, isLoading: isTwitterLoading, refetch: refetchTwitterStatus } = useTwitterConnection(address)
  const router = useRouter()

  // Simple redirect logic - only redirect when we're certain user is not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log('🔄 Not authenticated, redirecting to landing page')
      router.push('/')
    }
  }, [isLoading, isAuthenticated, router])

  // Handle Twitter connection completion
  const handleTwitterConnected = async () => {
    setTimeout(async () => {
      await refetchTwitterStatus()
    }, 500)
  }

  // Show loading while checking authentication
  if (isLoading || isTwitterLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Loading Campaigns</h2>
          <p className="text-gray-400">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // Don't render anything if not authenticated (redirect will handle it)
  if (!isAuthenticated) {
    return null
  }

  // Show Twitter connection if needed
  if (isAuthenticated && !isTwitterConnected) {
    return <TwitterConnection onConnected={handleTwitterConnected} />
  }

  // Render campaigns if fully authenticated
  return <MinerDashboard activeSection="campaigns" />
} 