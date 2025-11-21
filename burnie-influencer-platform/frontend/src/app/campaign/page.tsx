'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Season2CampaignComponent from '@/components/sections/Season2Campaign'
import MobileBottomNav from '@/components/MobileBottomNav'
import { useAuth } from '@/hooks/useAuth'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import { useUserReferralCode } from '@/hooks/useUserReferralCode'
import WalletDisplay from '@/components/WalletDisplay'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { useAccount } from 'wagmi'
import { useMixpanel } from '@/hooks/useMixpanel'
import { useTimeTracking } from '@/hooks/useTimeTracking'

// Countdown Banner Component
function CountdownBanner() {
  const router = useRouter()
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date()
      const currentET = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}))
      
      // Season 2: First weekly snapshot is Tuesday, Nov 18, 2025 at 10 AM ET
      const firstSnapshot = new Date(2025, 10, 18, 10, 0, 0, 0) // Month is 0-indexed, so 10 = November
      
      let nextSnapshot: Date
      
      if (currentET < firstSnapshot) {
        // Before first snapshot - countdown to Nov 18th, 2025 10 AM ET
        nextSnapshot = firstSnapshot
      } else {
        // After first snapshot - weekly Tuesday 10 AM ET snapshots
        nextSnapshot = new Date(currentET)
        
        // Get current day of week (0 = Sunday, 1 = Monday, 2 = Tuesday, 6 = Saturday)
        const dayOfWeek = currentET.getDay()
        
        // Calculate days until next Tuesday
        let daysUntilTuesday = (2 - dayOfWeek + 7) % 7
        if (daysUntilTuesday === 0) daysUntilTuesday = 7; // If today is Tuesday but past 10 AM
        
        // If today is Tuesday
        if (dayOfWeek === 2) {
          // If it's already past 10 AM, next snapshot is next Tuesday
          if (currentET.getHours() >= 10) {
            daysUntilTuesday = 7
          } else {
            daysUntilTuesday = 0
          }
        }
        
        // Set to next Tuesday at 10 AM
        nextSnapshot.setDate(nextSnapshot.getDate() + daysUntilTuesday)
        nextSnapshot.setHours(10, 0, 0, 0) // 10 AM ET
      }
      
      const timeDiff = nextSnapshot.getTime() - currentET.getTime()
      
      if (timeDiff > 0) {
        const hours = Math.floor(timeDiff / (1000 * 60 * 60))
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000)
        
        setTimeLeft({ hours, minutes, seconds })
      } else {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 })
      }
    }

    calculateTimeLeft()
    const interval = setInterval(calculateTimeLeft, 1000)

    return () => clearInterval(interval)
  }, [])

  const formatTime = (value: number) => value.toString().padStart(2, '0')

  return (
    <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-2 transition-all duration-200 border border-white/10 ml-5">
      <div className="flex items-center gap-2 text-white font-mono text-sm">
        <span className="text-lg font-bold">
          {formatTime(timeLeft.hours)}:{formatTime(timeLeft.minutes)}:{formatTime(timeLeft.seconds)}
        </span>
      </div>
      <div className="text-white/90 text-xs font-medium">
        UNTIL NEXT SNAPSHOT
      </div>
    </div>
  )
}

export default function CampaignPage() {
  const { address } = useAccount()
  console.log('Campaign page loaded for user:', address) // Keep address usage to avoid lint error
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  useAuthGuard({ redirectTo: '/', requiresAuth: true })
  const { referralCode, copyReferralLink } = useUserReferralCode()
  const { balance: tokenBalance, isLoading: balanceLoading, tokenSymbol } = useTokenBalance()
  const router = useRouter()
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showCopySuccess, setShowCopySuccess] = useState(false)

  // Mixpanel tracking
  const mixpanel = useMixpanel()
  const { getTimeSpentSeconds } = useTimeTracking()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Track page view when component mounts
  useEffect(() => {
    if (mounted && isAuthenticated) {
      mixpanel.yapperCampaignPageViewed({
        screenName: 'YapperCampaign',
        timeSpent: getTimeSpentSeconds()
      })
    }
  }, [mounted, isAuthenticated, mixpanel, getTimeSpentSeconds])

  const navigationItems = [
    { id: 'marketplace', label: 'Marketplace', icon: '/home.svg', route: '/marketplace' },
    { id: 'dashboard', label: 'Dashboard', icon: '/dashboard.svg', route: '/dashboard' },
    { id: 'mycontent', label: 'My content', icon: '/content.svg', route: '/my-content' },
    { id: 'campaign', label: 'Yapping Campaign', icon: '/megaphone.svg', route: '/campaign' },
    { id: 'rewards', label: 'My Rewards', icon: '/rewards.svg', route: '/rewards' },
  ]

  // Loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen yapper-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 animate-spin border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-white mb-2">Loading</h2>
          <p className="text-white/70">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const handleReferralCodeClick = async () => {
    if (referralCode?.code) {
      const success = await copyReferralLink(referralCode.code)
      if (success) {
        setShowCopySuccess(true)
        setTimeout(() => setShowCopySuccess(false), 2000)
      }
    }
  }

  return (
    <div className="min-h-screen yapper-background">
      {/* Top Header - consistent across pages */}
      <header className="z-20 w-full sticky top-0 bg-yapper-surface/95 backdrop-blur border-b border-yapper">
        <div className="relative flex items-center justify-between px-6 h-16 max-w-none mx-auto">
          <div className="hidden lg:flex items-center space-x-6 xl:space-x-8">
            <CountdownBanner />
          </div>
          <div className="absolute left-4 lg:left-1/2 lg:-translate-x-1/2 z-20">
            <div className="text-white text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold relative group cursor-pointer">
              <span className="relative z-10 no-underline hover:no-underline transition-colors text-white font-nt-brick">
                YAP.BURNIE
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg blur-sm"></div>
            </div>
          </div>
          <div className="flex items-center flex-row justify-end gap-2 ml-auto">
            {/* Referral code pill */}
            {mounted && isAuthenticated && referralCode && (
              <div className="relative">
                <button
                  onClick={handleReferralCodeClick}
                  className="px-3 py-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-full text-sm font-bold transition-all duration-200 transform hover:scale-105 xl:flex hidden items-center gap-2"
                  title="Click to copy your referral link"
                >
                  <span>🔗</span>
                  <span>My Referral:</span>
                  <span className="font-mono">{referralCode.code}</span>
                </button>
                {showCopySuccess && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-orange-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50">
                    Copied!
                  </div>
                )}
              </div>
            )}
            {/* Wallet display */}
            <WalletDisplay 
              showBalance={true}
              balance={tokenBalance}
              balanceLoading={balanceLoading}
              tokenSymbol={tokenSymbol}
            />
          </div>
        </div>
      </header>
      <div className="flex">
        {/* Desktop Sidebar (auth-gated) */}
        {mounted && isAuthenticated && (
          <aside
            className={`hidden lg:flex ${isSidebarExpanded ? 'w-52' : 'w-16'} bg-yapper-surface border-r border-yapper transition-[width] duration-300 ease-in-out flex-col h-[calc(100vh-64px)] shadow-sm flex-shrink-0 sticky top-16`}
            style={{ willChange: 'width' }}
          >
            <div className="flex items-center justify-start px-2 py-4">
              <button
                className="w-8 h-8 rounded-md hover:bg-yapper-muted transition-colors ml-2"
                aria-label={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
              >
                {isSidebarExpanded ? (
                  <Image src="/sidebarclose.svg" alt="Collapse sidebar" width={20} height={20} className="w-5 h-5 text-white" />
                ) : (
                  <Image src="/sidebaropen.svg" alt="Expand sidebar" width={20} height={20} className="w-5 h-5 text-white" />
                )}
              </button>
            </div>
            <div className="h-px bg-yapper-border mx-2"></div>
            <nav className="flex flex-col gap-1 p-2 flex-1">
              {navigationItems.map((item) => {
                const isSpecialItem = item.id === 'campaign' || item.id === 'rewards'
                
                return (
                  <div key={item.id} className="relative group">
                    <button
                      onClick={() => router.push(item.route)}
                      className={`w-full group flex items-center rounded-md px-2 py-2 text-sm transition-colors overflow-hidden justify-start text-white/90 hover:bg-yapper-muted hover:text-white ${isSpecialItem ? (isSidebarExpanded ? 'nav-item-special-expanded' : 'nav-item-special-glow') : ''}`}
                  >
                    <span className="w-5 h-5 inline-flex items-center justify-center text-white/90 mr-3 shrink-0">
                      <Image src={item.icon} alt={item.label} width={20} height={20} className="w-5 h-5" />
                    </span>
                    <span className="relative overflow-hidden shrink-0 w-[160px]">
                      <span
                        className="block"
                        style={{
                          clipPath: isSidebarExpanded ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
                          transition: 'clip-path 300ms ease-in-out',
                          willChange: 'clip-path',
                        }}
                        aria-hidden={!isSidebarExpanded}
                      >
                        {item.label}
                      </span>
                    </span>
                  </button>
                  
                  {/* Tooltip - only show when sidebar is collapsed */}
                  {!isSidebarExpanded && (
                    <div className="sidebar-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-[#220808] text-white text-sm px-3 py-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap" style={{ zIndex: 2147483647 }}>
                      {item.label}
                      <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-b-[6px] border-r-[6px] border-transparent border-r-[#220808]"></div>
                    </div>
                  )}
                </div>
                )
              })}
            </nav>
          </aside>
        )}

        {/* Main Content Area */}
        <div className="flex-1 min-h-[calc(100vh-64px)] flex flex-col overflow-x-hidden max-w-[100vw]">
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-0 md:px-6 lg:px-6 pb-24">
        <section className="space-y-6 py-6">
          <Season2CampaignComponent mixpanel={mixpanel} />
        </section>
      </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav 
        navigationItems={navigationItems}
        isAuthenticated={!!isAuthenticated}
      />

      {/* Mobile & Tablet Bottom Padding */}
      <div className="lg:hidden h-20"></div>
    </div>
  )
}


