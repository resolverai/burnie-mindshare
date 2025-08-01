'use client'

import { useState, useEffect } from 'react'
import dynamicImport from 'next/dynamic'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '@/hooks/useAuth'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import PublicLanding from '@/components/PublicLanding'

// Dynamic imports for components that need authentication
const YapperDashboard = dynamicImport(() => import('@/components/YapperDashboard'), { ssr: false })

// Force dynamic rendering for wallet functionality
export const dynamic = 'force-dynamic'

export default function HomePage() {
  const { isAuthenticated, isLoading, error, clearError, address, needsSignature, signIn } = useAuth()
  const router = useRouter()

  // Auto-trigger sign-in when wallet connects and signature is needed
  useEffect(() => {
    if (needsSignature && address && !isLoading) {
      console.log('🔐 Auto-triggering wallet sign-in confirmation')
      signIn()
    }
  }, [needsSignature, address, isLoading, signIn])

  // Redirect to dashboard when authenticated
  useEffect(() => {
    console.log('🔍 Auth state check:', { 
      isAuthenticated, 
      isLoading, 
      address 
    })
    
    if (isAuthenticated && !isLoading) {
      console.log('✅ Authenticated, redirecting to dashboard')
      router.push('/dashboard')
    }
  }, [isAuthenticated, isLoading, router, address])

  // Show loading screen while authenticating
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {needsSignature ? 'Confirm Sign-In' : 'Authenticating Wallet'}
          </h2>
          <p className="text-gray-600">
            {needsSignature 
              ? 'Please confirm the sign-in message in your wallet...' 
              : 'Checking your authentication status...'
            }
          </p>
        </div>
      </div>
    )
  }

  // Show error if authentication failed
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
            <h2 className="text-red-600 font-bold mb-2">Authentication Failed</h2>
            <p className="text-gray-700 mb-4">{error}</p>
            <button
              onClick={clearError}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show dashboard if authenticated (fallback before redirect)
  if (isAuthenticated) {
    return <YapperDashboard />
  }

  // Show public landing page (with wallet connection)
  return <PublicLanding />
} 