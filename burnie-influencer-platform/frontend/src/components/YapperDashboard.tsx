'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useROASTBalance } from '../hooks/useROASTBalance'

import { useAuth } from '../hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useYapperTwitterConnection } from '../hooks/useYapperTwitterConnection'
import { 
  WalletIcon
} from '@heroicons/react/24/outline'
import Image from 'next/image'

// Import dashboard components
import YapperAnalytics from './yapper/YapperAnalytics'
import BiddingInterface from './yapper/BiddingInterface'
import YapperHistory from './yapper/YapperHistory'
import YapperPortfolio from './yapper/YapperPortfolio'
import YapperMyContent from './yapper/YapperMyContent'
import YapperTwitterConnection from './yapper/YapperTwitterConnection'
import MobileBottomNav from './MobileBottomNav'

interface YapperDashboardProps {
  activeSection?: string
}

export default function YapperDashboard({ activeSection = 'dashboard' }: YapperDashboardProps) {
  const { balance: roastBalance, isLoading: balanceLoading } = useROASTBalance()
  

  
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false) // Default to closed
  const [isReconnectingTwitter, setIsReconnectingTwitter] = useState(false)
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { logout } = useAuth()
  const router = useRouter()
  
  // Check Twitter connection status for Yappers
  const { 
    isConnected: isTwitterConnected, 
    isLoading: isTwitterLoading, 
    twitterUsername,
    refetch: refetchTwitterStatus 
  } = useYapperTwitterConnection(address)

  // Handle manual logout
  const handleLogout = () => {
    logout() // This will also disconnect the wallet
    router.push('/')
  }

  // Twitter re-connection mutation
  const twitterReconnectMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('No wallet connected')
      
      setIsReconnectingTwitter(true)
      
      // Step 1: Get Twitter OAuth URL
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (!data.success || !data.data.oauth_url) {
        throw new Error('Invalid OAuth URL response')
      }

      // Store state, code verifier, and wallet address for later use
      localStorage.setItem('yapper_twitter_oauth_state', data.data.state)
      localStorage.setItem('yapper_twitter_code_verifier', data.data.code_verifier)
      localStorage.setItem('yapper_twitter_wallet_address', address || '')

      // Step 2: Open Twitter OAuth in a new window
      const authWindow = window.open(
        data.data.oauth_url,
        'yapper-twitter-auth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!authWindow) {
        throw new Error('Failed to open authentication window. Please disable popup blocker.')
      }

      // Step 3: Listen for messages from callback window
      return new Promise((resolve, reject) => {
        const messageHandler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return

          if (event.data.type === 'YAPPER_TWITTER_AUTH_SUCCESS') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            setIsReconnectingTwitter(false)
            refetchTwitterStatus()
            resolve(event.data)
          } else if (event.data.type === 'YAPPER_TWITTER_AUTH_ERROR') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            setIsReconnectingTwitter(false)
            reject(new Error(event.data.error))
          }
        }

        window.addEventListener('message', messageHandler)

        // Handle window closed manually
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            setIsReconnectingTwitter(false)
            reject(new Error('Authentication window was closed'))
          }
        }, 1000)
      })
    },
    onSuccess: () => {
      console.log('✅ Twitter reconnection successful')
    },
    onError: (error) => {
      console.error('❌ Twitter reconnection failed:', error)
    }
  })

  const handleTwitterReconnect = () => {
    twitterReconnectMutation.mutate()
  }

  const navigationItems = [
    { id: 'marketplace', label: 'Marketplace', icon: '/home.svg', route: '/marketplace' },
    { id: 'dashboard', label: 'Dashboard', icon: '/dashboard.svg', route: '/dashboard' },
    { id: 'mycontent', label: 'My content', icon: '/content.svg', route: '/my-content' }
    // Temporarily hiding: history and portfolio sections
    // { id: 'history', label: 'History', icon: '/history.svg', route: '/history' },
    // { id: 'portfolio', label: 'Portfolio', icon: '/portfolio.svg', route: '/portfolio' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': return <YapperAnalytics />
      case 'marketplace': 
      case 'bidding': return <BiddingInterface /> // Support both for backward compatibility
      case 'mycontent': return <YapperMyContent />
      case 'history': return <YapperHistory />
      case 'portfolio': return <YapperPortfolio />
      default: return <YapperAnalytics />
    }
  }

  // Redirect to landing if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="p-6 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl mb-6 w-24 h-24 flex items-center justify-center mx-auto">
            <WalletIcon className="h-12 w-12 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect Your Wallet</h2>
          <p className="text-gray-600 mb-6">Connect your wallet to access the Burnie yapper platform</p>
          <ConnectButton />
        </div>
      </div>
    )
  }

  // Twitter connection check disabled per user request
  // if (isConnected && !isTwitterLoading && !isTwitterConnected) {
  //   return <YapperTwitterConnection onConnected={() => refetchTwitterStatus()} />
  // }

  // Twitter connection loading check disabled per user request
  // if (isConnected && isTwitterLoading) {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto mb-4"></div>
  //         <p className="text-gray-600">Checking Twitter connection...</p>
  //       </div>
  //     </div>
  //   )
  // }

  return (
    <div className="min-h-screen yapper-background">
      {/* Single Combined Header - Matching New UI */}
      <header className="z-20 w-full sticky top-0 bg-yapper-surface/95 backdrop-blur border-b border-yapper">
        <div className="relative flex items-center justify-between px-6 h-16 max-w-none mx-auto">
          {/* Left Navigation Links - Hidden per user request */}
          <div className="hidden lg:flex items-center space-x-6 xl:space-x-8">
            {/* About and Tokenomics links hidden */}
          </div>

          {/* Center Logo */}
          <div className="absolute left-1/2 -translate-x-1/2 z-20">
            <div className="text-white text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold relative group cursor-pointer">
              <span className="relative z-10 no-underline hover:no-underline transition-colors text-white font-nt-brick">
                YAP.BURNIE
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg blur-sm"></div>
            </div>
          </div>

          {/* Right Side - Social Icons + Points + Status + Wallet */}
          <div className="flex items-center flex-row justify-end gap-2 ml-auto">
            {/* Social Icons */}
            <div className="items-center md:flex hidden gap-2">
              <a href="https://x.com/burnieio" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center p-1">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              <a href="https://t.me/burnieai" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center p-1">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14.171.142.27.293.27.293-.271 1.469-1.428 6.943-2.008 9.218-.245 1.164-.726 1.555-1.192 1.597-.964.089-1.7-.636-2.637-1.247-1.466-.957-2.297-1.552-3.716-2.48-1.64-1.073-.578-1.668.36-2.633.246-.252 4.486-4.107 4.576-4.456.014-.041.015-.192-.077-.272-.092-.08-.226-.053-.323-.03-.137.032-2.294 1.451-6.476 4.257-.612.424-.966.632-1.064.633-.352.003-.987-.198-1.47-.36-1.174-.404-2.107-.616-2.027-.982.042-.19.283-.385.725-.583 2.855-1.259 4.758-2.08 5.71-2.463 2.713-1.145 3.278-1.344 3.648-1.351z"/>
                </svg>
              </a>
            </div>

            {/* ROAST Balance Badge */}
            <div className="px-3 py-1 bg-white text-black rounded-full text-lg font-bold xl:flex hidden font-silkscreen">
              🔥 {balanceLoading ? '...' : roastBalance}
            </div>

            {/* Wallet Connection */}
            <ConnectButton 
              showBalance={false}
              chainStatus="none"
              accountStatus="avatar"
            />
          </div>
        </div>
      </header>

      {/* Main Layout with Sidebar */}
      <div className="flex">
        {/* Left Sidebar Navigation - Fixed, starts after header */}
        {/* Hidden on mobile, tablet landscape (iPad Mini, iPad Air) - only show on desktop (lg: 1024px+) */}
                  <aside
            className={`hidden lg:flex ${isSidebarExpanded ? 'w-52' : 'w-16'} bg-yapper-surface border-r border-yapper transition-[width] duration-300 ease-in-out flex-col h-[calc(100vh-64px)] shadow-sm flex-shrink-0 sticky top-16`}
          style={{ willChange: "width" }}
        >
          {/* Collapse/Expand Button */}
          <div className="flex items-center justify-start px-2 py-4">
            <button
            className="w-8 h-8 rounded-md hover:bg-yapper-muted transition-colors ml-2"
            aria-label={isSidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
          >
            {isSidebarExpanded ? (
              <Image src="/sidebarclose.svg" alt="Collapse sidebar" width={20} height={20} className="w-5 h-5 text-white" />
            ) : (
              <Image src="/sidebaropen.svg" alt="Expand sidebar" width={20} height={20} className="w-5 h-5 text-white" />
            )}
          </button>
        </div>

        {/* Separator */}
        <div className="h-px bg-yapper-border mx-2"></div>

        {/* Navigation Items */}
        <nav className="flex flex-col gap-1 p-2 flex-1">
          {navigationItems.map((item) => {
            const isActive = activeSection === item.id
            
            return (
              <button
                key={item.id}
                onClick={() => router.push(item.route)}
                className={`group flex items-center rounded-md px-2 py-2 text-sm transition-colors overflow-hidden justify-start ${
                  isActive 
                    ? 'bg-yapper-muted text-white' 
                    : 'text-white/90 hover:bg-yapper-muted hover:text-white'
                }`}
              >
                <span className="w-5 h-5 inline-flex items-center justify-center text-white/90 mr-3 shrink-0">
                  <Image src={item.icon} alt={item.label} width={20} height={20} className="w-5 h-5" />
                </span>
                <span className="relative overflow-hidden shrink-0 w-[160px]">
                  <span
                    className={`block ${isActive ? 'text-white' : 'text-white/90'}`}
                    style={{
                      clipPath: isSidebarExpanded ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
                      transition: "clip-path 300ms ease-in-out",
                      willChange: "clip-path",
                    }}
                    aria-hidden={!isSidebarExpanded}
                  >
                    {item.label}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* Bottom Section - Wallet Info */}
        <div className={`mt-auto p-4 ${isSidebarExpanded ? "" : "flex items-center justify-center"}`}>
          <div className={`flex items-start gap-2 w-full ${isSidebarExpanded ? "justify-start" : "justify-start"}`}>
            <WalletIcon className={`w-6 h-6 opacity-80 shrink-0 text-white ${isSidebarExpanded ? "hidden" : "flex"}`} />
            <div className={`relative overflow-hidden w-[140px] text-xs ${isSidebarExpanded ? "flex" : "hidden"}`}>
              <div
                className="text-white/60 space-y-0.5"
                style={{
                  clipPath: isSidebarExpanded ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
                  transition: "clip-path 300ms ease-in-out",
                  willChange: "clip-path",
                }}
                aria-hidden={!isSidebarExpanded}
              >
                <div>Base Mainnet</div>
                <div className="mt-1">
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
                </div>
                {isTwitterConnected && twitterUsername && (
                  <div className="text-xs text-green-400 mt-1">
                    @{twitterUsername}
                  </div>
                )}
                <button
                  onClick={handleTwitterReconnect}
                  disabled={isReconnectingTwitter}
                  className="mt-2 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                >
                  {isReconnectingTwitter ? 'Reconnecting...' : 'Reconnect Twitter'}
                </button>
                <button
                  onClick={handleLogout}
                  className="mt-2 text-orange-400 hover:text-orange-300 transition-colors block"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

              {/* Main Content Area - Direct content */}
        <div className="flex-1 min-h-[calc(100vh-64px)] flex flex-col">
        <main className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-6 touch-pan-y overscroll-contain">
          {renderContent()}
        </main>
        
        {/* Copyright Footer */}
        <footer className="border-t border-yapper bg-yapper-surface/50 backdrop-blur">
          <div className="px-6 py-4 text-center">
            <div className="text-white/70 text-sm font-nt-brick">
              ©@burnieio 2025 | <a href="https://burnie.io" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white transition-colors underline">burnie.io</a>
            </div>
          </div>
        </footer>
              </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav 
        navigationItems={navigationItems}
        isAuthenticated={true}
      />

      {/* Mobile & Tablet Bottom Padding to prevent content from being hidden behind bottom nav */}
      <div className="lg:hidden h-20"></div>
    </div>
  )
} 