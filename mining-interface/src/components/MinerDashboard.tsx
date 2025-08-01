'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../hooks/useAuth'
import { 
  HomeIcon, 
  MegaphoneIcon, 
  UserGroupIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  CpuChipIcon,
  KeyIcon,
  BoltIcon,
  Bars3Icon
} from '@heroicons/react/24/outline'

import Dashboard from './Dashboard'
import Agents from './Agents'
import Mining from './Mining'
import { NeuralKeysModal } from './NeuralKeysModal'

interface MinerDashboardProps {
  activeSection?: string
}

export default function MinerDashboard({ activeSection = 'dashboard' }: MinerDashboardProps) {
  const router = useRouter()
  const { address } = useAccount()
  const { logout, isLoading } = useAuth()
  const [showNeuralKeys, setShowNeuralKeys] = useState(false)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)

  // Handle manual logout
  const handleLogout = () => {
    logout()
    router.push('/')
  }

  // Fetch user agents from centralized Burnie database
  const { data: userAgents, isLoading: agentsLoading } = useQuery({
    queryKey: ['user-agents', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL}/agents/user/${address}`)
        if (response.ok) {
          const data = await response.json()
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching user agents:', error)
        return []
      }
    },
    enabled: !!address,
    refetchInterval: 60000,
  })

  // Get primary agent (first one or most recently used)
  const primaryAgent = userAgents?.[0] || null

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: HomeIcon, iconSolid: HomeIcon, route: '/dashboard' },
    { id: 'agents', label: 'Agents', icon: UserGroupIcon, iconSolid: UserGroupIcon, route: '/agents' },
    { id: 'mining', label: 'Mining', icon: MegaphoneIcon, iconSolid: MegaphoneIcon, route: '/mining' },
    { id: 'portfolio', label: 'Portfolio', icon: ChartBarIcon, iconSolid: ChartBarIcon, route: '/portfolio' },
    { id: 'teams', label: 'Teams', icon: CpuChipIcon, iconSolid: CpuChipIcon, route: '/teams' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': 
        return <Dashboard />
      case 'agents': 
        return <Agents />
      case 'mining': 
        return <Mining />
      case 'campaigns': 
        return (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-white mb-4">Campaigns</h2>
            <p className="text-gray-400">Browse and select campaigns to participate in</p>
          </div>
        )
      case 'portfolio': 
        return (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-white mb-4">Portfolio</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-2">Total Earnings</h3>
                <p className="text-3xl font-bold text-orange-400">Loading...</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-2">Active Campaigns</h3>
                <p className="text-3xl font-bold text-blue-400">Loading...</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-2">Content Generated</h3>
                <p className="text-3xl font-bold text-green-400">Loading...</p>
              </div>
            </div>
          </div>
        )
      case 'teams': 
        return (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-white mb-4">Teams</h2>
            <p className="text-gray-400 mb-6">Collaborate with other miners and share agents</p>
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Team Features</h3>
              <div className="text-center py-8">
                <UserGroupIcon className="h-16 w-16 text-gray-500 mx-auto mb-4" />
                <p className="text-gray-400">Team collaboration features coming soon...</p>
              </div>
            </div>
          </div>
        )
      default: 
        return <Dashboard />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex overflow-hidden">
      {/* Left Sidebar Navigation - Fixed Height */}
      <div className={`${isSidebarExpanded ? 'w-72' : 'w-20'} bg-gray-900/90 backdrop-blur-md border-r border-gray-700/50 transition-all duration-300 flex flex-col h-screen`}>
        {/* Header */}
        <div className="p-6 border-b border-gray-700/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                <BoltIcon className="h-6 w-6 text-white" />
              </div>
              {isSidebarExpanded && (
                <div>
                  <h1 className="text-xl font-bold text-white">BURNIE</h1>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Content Mining Interface
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
              className="p-2 hover:bg-gray-700/50 rounded-lg transition-colors"
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
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                    activeSection === item.id
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {isSidebarExpanded && (
                    <span className="font-medium">{item.label}</span>
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Wallet Info - Fixed at bottom */}
        {isSidebarExpanded && (
          <div className="p-4 border-t border-gray-700/50 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 uppercase tracking-wide">Wallet</span>
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <div className="text-sm font-medium text-white">Base Mainnet</div>
            <div className="text-xs text-gray-400 font-mono">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
            </div>
            <button
              onClick={handleLogout}
              className="mt-2 flex items-center space-x-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
              <span>Disconnect & Logout</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area - Scrollable */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header - Fixed */}
        <div className="bg-gray-900/80 backdrop-blur-md border-b border-gray-700/50 flex-shrink-0">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white capitalize">{activeSection.replace('-', ' ')}</h2>
                <p className="text-sm text-gray-400">
                  {activeSection === 'dashboard' && 'Analytics and performance overview'}
                  {activeSection === 'agents' && 'Manage your AI agents'}
                  {activeSection === 'mining' && 'Select campaigns and start content mining'}
                  {activeSection === 'campaigns' && 'View available campaigns'}
                  {activeSection === 'portfolio' && 'Track your token earnings'}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                {/* Status Indicators */}
                <div className="flex items-center space-x-2 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg text-xs font-medium border border-green-500/30">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span>BASE NETWORK</span>
                </div>
                <div className="flex items-center space-x-2 px-3 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium border border-blue-500/30">
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  <span>AGENTS: {userAgents?.length || 0}</span>
                </div>
                <button
                  onClick={() => setShowNeuralKeys(true)}
                  className="flex items-center space-x-2 px-3 py-2 bg-purple-500/20 text-purple-400 rounded-lg text-xs font-medium border border-purple-500/30 hover:bg-purple-500/30 transition-colors cursor-pointer"
                >
                  <KeyIcon className="h-3 w-3" />
                  <span>NEURAL KEYS</span>
                </button>
                <div className="text-right">
                  <div className="text-sm font-medium text-white">Level {primaryAgent?.level || 1}</div>
                  <div className="text-xs text-gray-400">{primaryAgent?.experience || 0} EXP</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white">0.00 ROAST</div>
                  <div className="text-xs text-gray-400">Available</div>
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

        {/* Content - Render appropriate component */}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>

      {/* Neural Keys Modal */}
      <NeuralKeysModal
        isOpen={showNeuralKeys}
        onClose={() => setShowNeuralKeys(false)}
      />
    </div>
  )
} 