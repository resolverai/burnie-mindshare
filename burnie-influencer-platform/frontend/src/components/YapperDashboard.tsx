'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useYapperTwitterConnection } from '../hooks/useYapperTwitterConnection'
import { 
  Bars3Icon, 
  HomeIcon, 
  CurrencyDollarIcon, 
  ClockIcon,
  WalletIcon,
  BellIcon,
  ChartBarIcon,
  MegaphoneIcon,
  EyeIcon,
  TrophyIcon,
  ArrowTrendingUpIcon,
  ArrowRightOnRectangleIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'
import { 
  HomeIcon as HomeIconSolid,
  CurrencyDollarIcon as CurrencyDollarIconSolid,
  ClockIcon as ClockIconSolid,
  MegaphoneIcon as MegaphoneIconSolid,
  DocumentTextIcon as DocumentTextIconSolid
} from '@heroicons/react/24/solid'

// Import dashboard components
import YapperAnalytics from './yapper/YapperAnalytics'
import BiddingInterface from './yapper/BiddingInterface'
import YapperHistory from './yapper/YapperHistory'
import YapperPortfolio from './yapper/YapperPortfolio'
import YapperMyContent from './yapper/YapperMyContent'
import YapperTwitterConnection from './yapper/YapperTwitterConnection'

interface YapperDashboardProps {
  activeSection?: string
}

export default function YapperDashboard({ activeSection = 'dashboard' }: YapperDashboardProps) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)
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
    { id: 'dashboard', label: 'Dashboard', icon: HomeIcon, iconSolid: HomeIconSolid, route: '/dashboard' },
    { id: 'bidding', label: 'Content Marketplace', icon: MegaphoneIcon, iconSolid: MegaphoneIconSolid, route: '/bidding' },
    { id: 'mycontent', label: 'My Content', icon: DocumentTextIcon, iconSolid: DocumentTextIconSolid, route: '/my-content' }
    // Temporarily hiding: history and portfolio sections
    // { id: 'history', label: 'History', icon: ClockIcon, iconSolid: ClockIconSolid, route: '/history' },
    // { id: 'portfolio', label: 'Portfolio', icon: CurrencyDollarIcon, iconSolid: CurrencyDollarIconSolid, route: '/portfolio' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': return <YapperAnalytics />
      case 'bidding': return <BiddingInterface />
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

  // Show Twitter connection if wallet is connected but Twitter is not
  if (isConnected && !isTwitterLoading && !isTwitterConnected) {
    return <YapperTwitterConnection onConnected={() => refetchTwitterStatus()} />
  }

  // Show loading while checking Twitter connection
  if (isConnected && isTwitterLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking Twitter connection...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen yapper-background flex overflow-hidden">
      {/* Left Sidebar Navigation - Fixed */}
      <div className={`${isSidebarExpanded ? 'w-72' : 'w-20'} bg-yapper-surface-2 border-r border-yapper transition-all duration-300 flex flex-col h-full shadow-sm flex-shrink-0`}>
        {/* Header */}
        <div className="p-6 border-b border-yapper flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                <MegaphoneIcon className="h-6 w-6 text-white" />
              </div>
              {isSidebarExpanded && (
                <div>
                  <h1 className="text-xl font-bold text-white font-nt-brick">BURNIE</h1>
                  <p className="text-xs text-yapper-muted uppercase tracking-wide font-silkscreen">
                    Yapper Platform
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <Bars3Icon className="h-5 w-5 text-yapper-muted" />
            </button>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navigationItems.map((item) => {
            const IconComponent = activeSection === item.id ? item.iconSolid : item.icon
            const isActive = activeSection === item.id
            
            return (
              <button
                key={item.id}
                onClick={() => router.push(item.route)}
                className={`w-full flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center px-2'} py-3 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg' 
                    : 'text-yapper-muted hover:bg-white/10 hover:text-white'
                }`}
              >
                <IconComponent className="h-5 w-5" />
                {isSidebarExpanded && (
                  <span className="ml-3 font-medium">{item.label}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Bottom Section - Wallet Info */}
        {isSidebarExpanded && (
          <div className="p-4 border-t border-yapper bg-yapper-surface flex-shrink-0">
            <div className="text-sm font-medium text-white font-silkscreen">Base Mainnet</div>
            <div className="text-xs text-yapper-muted font-mono">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
            </div>
            
            {/* Twitter Connection Status */}
            {isTwitterConnected && twitterUsername && (
              <div className="mt-2 text-xs text-green-400">
                Connected: @{twitterUsername}
              </div>
            )}
            
            {/* Twitter Reconnect Button */}
            <button
              onClick={handleTwitterReconnect}
              disabled={isReconnectingTwitter}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors block disabled:opacity-50"
            >
              {isReconnectingTwitter ? 'Reconnecting...' : 'Reconnect Twitter'}
            </button>
            
            <button
              onClick={handleLogout}
              className="mt-2 text-xs text-orange-400 hover:text-orange-300 transition-colors block"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header - Fixed */}
        <div className="bg-yapper-surface-2 border-b border-yapper flex-shrink-0 shadow-sm">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white capitalize font-nt-brick">
                  {activeSection === 'bidding' ? 'Content Marketplace' : activeSection.replace('-', ' ')}
                </h2>
                <p className="text-sm text-yapper-muted">
                  {activeSection === 'dashboard' && 'Analytics and performance overview'}
                  {activeSection === 'bidding' && 'Browse and purchase AI-generated content'}
                  {activeSection === 'mycontent' && 'Your purchased content ready to use'}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                {/* Status Indicators */}
                <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100/10 text-green-400">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                  <span>BASE NETWORK</span>
                </div>
                <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100/10 text-yellow-400">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                  <span>MARKETPLACE</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white font-silkscreen">0.00 ROAST</div>
                  <div className="text-xs text-yapper-muted">Available</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white font-silkscreen">0.00 USDC</div>
                  <div className="text-xs text-yapper-muted">Balance</div>
                </div>
                <ConnectButton 
                  showBalance={false}
                  chainStatus="icon"
                  accountStatus="avatar"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </div>
  )
} 