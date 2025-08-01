'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useDisconnect } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../hooks/useAuth'
import { useRouter } from 'next/navigation'
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
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline'
import { 
  HomeIcon as HomeIconSolid,
  CurrencyDollarIcon as CurrencyDollarIconSolid,
  ClockIcon as ClockIconSolid,
  MegaphoneIcon as MegaphoneIconSolid
} from '@heroicons/react/24/solid'

// Import dashboard components
import YapperAnalytics from './yapper/YapperAnalytics'
import BiddingInterface from './yapper/BiddingInterface'
import YapperHistory from './yapper/YapperHistory'
import YapperPortfolio from './yapper/YapperPortfolio'

interface YapperDashboardProps {
  activeSection?: string
}

export default function YapperDashboard({ activeSection = 'dashboard' }: YapperDashboardProps) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { logout } = useAuth()
  const router = useRouter()

  // Handle manual logout
  const handleLogout = () => {
    logout() // This will also disconnect the wallet
    router.push('/')
  }

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: HomeIcon, iconSolid: HomeIconSolid, route: '/dashboard' },
    { id: 'bidding', label: 'Bidding', icon: MegaphoneIcon, iconSolid: MegaphoneIconSolid, route: '/bidding' },
    { id: 'history', label: 'History', icon: ClockIcon, iconSolid: ClockIconSolid, route: '/history' },
    { id: 'portfolio', label: 'Portfolio', icon: CurrencyDollarIcon, iconSolid: CurrencyDollarIconSolid, route: '/portfolio' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': return <YapperAnalytics />
      case 'bidding': return <BiddingInterface />
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex overflow-hidden">
      {/* Left Sidebar Navigation */}
      <div className={`${isSidebarExpanded ? 'w-72' : 'w-20'} bg-white border-r border-gray-200 transition-all duration-300 flex flex-col h-screen shadow-sm`}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                <MegaphoneIcon className="h-6 w-6 text-white" />
              </div>
              {isSidebarExpanded && (
                <div>
                  <h1 className="text-xl font-bold gradient-text">BURNIE</h1>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Yapper Platform
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Bars3Icon className="h-5 w-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {navigationItems.map((item) => {
              const Icon = activeSection === item.id ? item.iconSolid : item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(item.route)}
                  className={`nav-item w-full ${
                    activeSection === item.id ? 'nav-item-active' : 'nav-item-inactive'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {isSidebarExpanded && (
                    <span>{item.label}</span>
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Wallet Info - Fixed at bottom */}
        {isSidebarExpanded && (
          <div className="p-4 border-t border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Wallet</span>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <div className="text-sm font-medium text-gray-900">Base Mainnet</div>
            <div className="text-xs text-gray-500 font-mono">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
            </div>
            <button
              onClick={handleLogout}
              className="mt-2 text-xs text-orange-600 hover:text-orange-700 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <div className="bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 capitalize">
                  {activeSection === 'bidding' ? 'Content Bidding' : activeSection.replace('-', ' ')}
                </h2>
                <p className="text-sm text-gray-500">
                  {activeSection === 'dashboard' && 'Analytics and performance overview'}
                  {activeSection === 'bidding' && 'Browse and bid on AI-generated content'}
                  {activeSection === 'history' && 'View your bidding and transaction history'}
                  {activeSection === 'portfolio' && 'Track your ROAST and USDC holdings'}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                {/* Status Indicators */}
                <div className="status-indicator status-active">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                  <span>BASE NETWORK</span>
                </div>
                <div className="status-indicator status-pending">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></div>
                  <span>MARKETPLACE</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">0.00 ROAST</div>
                  <div className="text-xs text-gray-500">Available</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">0.00 USDC</div>
                  <div className="text-xs text-gray-500">Balance</div>
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

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  )
} 