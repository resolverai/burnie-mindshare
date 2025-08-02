'use client'

import { useEffect, useState } from 'react'
import { useConfig } from 'wagmi'

interface WagmiWrapperProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function WagmiWrapper({ children, fallback }: WagmiWrapperProps) {
  const [isReady, setIsReady] = useState(false)
  
  // Try to get wagmi config to check if provider is ready
  let config
  try {
    config = useConfig()
  } catch (error) {
    console.warn('WagmiConfig not ready:', error)
  }

  useEffect(() => {
    if (config) {
      // Small delay to ensure everything is properly initialized
      const timer = setTimeout(() => {
        setIsReady(true)
      }, 100)
      
      return () => clearTimeout(timer)
    }
  }, [config])

  if (!isReady || !config) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        {fallback || (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Initializing wallet connection...</p>
          </div>
        )}
      </div>
    )
  }

  return <>{children}</>
} 