'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import YapperDashboard from '@/components/YapperDashboard'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import useMixpanel from '../../hooks/useMixpanel'

// Force dynamic rendering for wallet functionality
export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuthGuard({ 
    redirectTo: '/', 
    requiresAuth: true 
  })
  const mixpanel = useMixpanel()

  // Track analytics dashboard viewed when page loads
  useEffect(() => {
    if (isAuthenticated) {
      mixpanel.analyticsDashboardViewed({
        screenName: 'AnalyticsDashboard'
      })
    }
  }, [isAuthenticated, mixpanel])

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-yapper-background flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Loading Dashboard</h2>
          <p className="text-white/70">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // Don't render anything if not authenticated (redirect will handle it)
  if (!isAuthenticated) {
    return null
  }

  // Render dashboard if authenticated
  return (
    <YapperDashboard activeSection="dashboard" />
  )
} 