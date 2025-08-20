'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit'
import { config } from './wagmi'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TwitterProvider } from '../contexts/TwitterContext'

import '@rainbow-me/rainbowkit/styles.css'

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
      <WagmiProvider config={config}>
        <TwitterProvider>
          {isClient && !isAdminPage ? (
            <RainbowKitProvider 
              theme={darkTheme({
                accentColor: '#FD7A10',
                accentColorForeground: '#FFFFFF',
                borderRadius: 'medium',
                fontStack: 'system',
                overlayBlur: 'small',
              })}
              appInfo={{
                appName: 'Burnie - Yapper Platform',
                learnMoreUrl: 'https://burnie.co',
              }}
              modalSize="wide"
            >
              {children}
            </RainbowKitProvider>
          ) : (
            children
          )}
        </TwitterProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
} 