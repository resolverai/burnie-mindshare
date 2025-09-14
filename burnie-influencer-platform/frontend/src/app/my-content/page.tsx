'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import YapperDashboard from '@/components/YapperDashboard'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import useMixpanel from '../../hooks/useMixpanel'

export default function MyContentPage() {
  const { isAuthenticated, isLoading } = useAuthGuard({ 
    redirectTo: '/', 
    requiresAuth: true 
  })
  const mixpanel = useMixpanel()

  // Track my content viewed when page loads
  useEffect(() => {
    if (isAuthenticated) {
      mixpanel.myContentViewed({
        screenName: 'YapperMyContent'
      })
    }
  }, [isAuthenticated, mixpanel])

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-yapper-background flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Loading My Content</h2>
          <p className="text-white/70">Checking authentication...</p>
        </div>
      </div>
    )
  }

  // Don't render anything if not authenticated (redirect will handle it)
  if (!isAuthenticated) {
    return null
  }

  // Render my content if authenticated
  return (
    <>
      <YapperDashboard activeSection="mycontent" />
    </>
  )
} 