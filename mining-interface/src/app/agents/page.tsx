'use client'

import { useAuth } from '@/hooks/useAuth'
import { useTwitterConnection } from '@/hooks/useTwitterConnection'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import MinerDashboard from '@/components/MinerDashboard'
import TwitterConnection from '@/components/TwitterConnection'


function AgentsPageContent() {
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

  // Show loading while checking authentication
  if (isLoading || isTwitterLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-300">Loading agents...</p>
        </div>
      </div>
    )
  }

  // Show Twitter connection if authenticated but Twitter not connected
  if (isAuthenticated && !isTwitterConnected) {
    return (
      <TwitterConnection 
        onConnected={() => {
          console.log('✅ Twitter connected from agents page')
          refetchTwitterStatus()
        }}
      />
    )
  }

  // Show mining dashboard with agents focus
  if (isAuthenticated && isTwitterConnected) {
    return <MinerDashboard activeSection="agents" />
  }

  // This should not render due to redirect, but just in case
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-300">Redirecting...</p>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  return <AgentsPageContent />
} 