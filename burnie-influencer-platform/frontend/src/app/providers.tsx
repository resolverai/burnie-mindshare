'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from './reown'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TwitterProvider } from '../contexts/TwitterContext'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isClient, setIsClient] = useState(false)
  
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Always return the same structure to avoid hydration mismatches
  // but conditionally initialize wallet functionality
  const isAdminPage = pathname?.startsWith('/admin')

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <TwitterProvider>
          {children}
        </TwitterProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
} 