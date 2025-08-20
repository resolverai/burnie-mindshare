'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import YapperDashboard from '@/components/YapperDashboard'

// Force dynamic rendering for wallet functionality
export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  // Simple redirect logic - only redirect when we're certain user is not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log('🔄 Not authenticated, redirecting to marketplace')
      router.push('/marketplace')
    }
  }, [isLoading, isAuthenticated, router])

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Loading Dashboard</h2>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // Don't render anything if not authenticated (redirect will handle it)
  if (!isAuthenticated) {
    return null
  }

  // Render dashboard if authenticated
  return <YapperDashboard activeSection="dashboard" />
} 