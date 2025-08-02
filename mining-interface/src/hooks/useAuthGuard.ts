'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './useAuth'

/**
 * Auth guard hook that redirects to landing page when user is not authenticated
 * Use this in protected pages to ensure only authenticated users can access them
 */
export function useAuthGuard() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log('🚪 Auth guard: User not authenticated, redirecting to landing page')
      router.push('/')
    }
  }, [isAuthenticated, isLoading, router])

  return {
    isAuthenticated,
    isLoading,
    // Return true when we should show content (authenticated and not loading)
    shouldShowContent: !isLoading && isAuthenticated
  }
} 