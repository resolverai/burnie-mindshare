'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import YapperDashboard from '@/components/YapperDashboard'
import { useMarketplaceAccess } from '@/hooks/useMarketplaceAccess'

// Force dynamic rendering for wallet functionality
export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const { hasAccess, redirectToAccess } = useMarketplaceAccess()
  const router = useRouter()

  // Simple redirect logic - only redirect when we're certain user is not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log('🔄 Not authenticated, redirecting to marketplace')
      router.push('/marketplace')
    }
  }, [isLoading, isAuthenticated, router])

  // Redirect authenticated users without access to the access page
  useEffect(() => {
    // Add a delay to ensure access status has been properly checked
    if (!isLoading && isAuthenticated && !hasAccess) {
      const timer = setTimeout(() => {
        console.log('🔒 Authenticated user without access, redirecting to access page')
        redirectToAccess()
      }, 1000) // Wait 1 second for access status to stabilize
      
      return () => clearTimeout(timer)
    }
  }, [isLoading, isAuthenticated, hasAccess, redirectToAccess])

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

  // Don't render anything if authenticated but no access (redirect will handle it)
  if (!hasAccess) {
    return null
  }

  // Render dashboard if authenticated and has access
  return (
    <YapperDashboard activeSection="dashboard" />
  )
} 