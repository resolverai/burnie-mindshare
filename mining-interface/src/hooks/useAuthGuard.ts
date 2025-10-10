'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './useAuth'
import { useTwitterConnection } from './useTwitterConnection'

/**
 * Auth guard hook that redirects to landing page when user is not authenticated
 * For dedicated miners (MINER=1): Only wallet authentication required
 * For regular miners (MINER=0): Both wallet authentication and Twitter connection required
 * TEMPORARY: Twitter requirement bypassed for all miners
 */
export function useAuthGuard() {
  const router = useRouter()
  const { isAuthenticated, isLoading, address } = useAuth()
  const { isConnected: isTwitterConnected, isLoading: isTwitterLoading } = useTwitterConnection(address)

  // Check if we're in dedicated miner mode
  const isDedicatedMiner = process.env.NEXT_PUBLIC_MINER === '1'
  
  // TEMPORARY: Skip Twitter for both regular and dedicated miners
  // TODO: Re-enable Twitter requirement for regular miners later
  const skipTwitter = true // Set to false to re-enable Twitter requirement

  useEffect(() => {
    if (!isLoading && !isTwitterLoading) {
      if (!isAuthenticated) {
        console.log('🚪 Auth guard: User not authenticated, redirecting to landing page')
        router.push('/')
      } else if (!skipTwitter && !isDedicatedMiner && !isTwitterConnected) {
        // Only check Twitter requirement if skipTwitter is false and it's a regular miner
        console.log('🚪 Auth guard: Regular miner without Twitter connection, redirecting to landing page')
        router.push('/')
      }
    }
  }, [isAuthenticated, isLoading, isTwitterConnected, isTwitterLoading, isDedicatedMiner, skipTwitter, router])

  // Determine if content should be shown based on miner type and Twitter bypass
  const shouldShowContent = !isLoading && !isTwitterLoading && isAuthenticated && (skipTwitter || isDedicatedMiner || isTwitterConnected)

  return {
    isAuthenticated,
    isLoading,
    isTwitterConnected,
    isTwitterLoading,
    isDedicatedMiner,
    // Return true when we should show content
    shouldShowContent
  }
} 