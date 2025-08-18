'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit'
import { config } from './wagmi'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

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
      {isClient && !isAdminPage ? (
        <WagmiProvider config={config}>
          <RainbowKitProvider 
            theme={lightTheme({
              accentColor: '#f97316', // Orange accent for light theme
              accentColorForeground: 'white',
              borderRadius: 'medium',
              fontStack: 'system',
              overlayBlur: 'small',
            })}
            appInfo={{
              appName: 'Burnie - Attention Economy Infrastructure',
              learnMoreUrl: 'https://burnie.co',
            }}
          >
            {children}
          </RainbowKitProvider>
        </WagmiProvider>
      ) : (
        children
      )}
    </QueryClientProvider>
  )
} 