'use client'

import React, { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import RewardCampaigning from '@/components/sections/RewardCampaigning'
import { createPortal } from 'react-dom'
import { appKit } from '@/app/reown'

// Countdown Banner Component
function CountdownBanner() {
  const router = useRouter()
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date()
      const currentET = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}))
      
      // First snapshot: October 2nd, 2025 at 10 PM ET
      const firstSnapshot = new Date(2025, 9, 2, 22, 0, 0, 0) // Month is 0-indexed, so 9 = October
      
      let nextSnapshot: Date
      
      if (currentET < firstSnapshot) {
        // Before first snapshot - countdown to Oct 2nd, 2025 10 PM ET
        nextSnapshot = firstSnapshot
      } else {
        // After first snapshot - daily 10 PM ET snapshots
        nextSnapshot = new Date(currentET)
        nextSnapshot.setHours(22, 0, 0, 0) // 10 PM ET
        
        // If it's already past 10 PM today, set for tomorrow
        if (currentET.getHours() >= 22) {
          nextSnapshot.setDate(nextSnapshot.getDate() + 1)
        }
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

export default function UnauthenticatedYappingCampaignPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [tooltipData, setTooltipData] = useState<{ label: string; x: number; y: number } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleWalletConnect = () => {
    console.log("[AppKit] Connect button clicked from campaign page")
    const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/"
    localStorage.setItem("wc_return_path", currentPath)
    
    // Only set timestamp for mobile devices to enable mobile recovery
    const isMobile = typeof window !== "undefined" && (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
      window.innerWidth < 768
    )
    
    if (isMobile) {
      localStorage.setItem("wc_connection_timestamp", Date.now().toString())
      console.log('📱 Mobile wallet connection initiated from campaign page:', currentPath)
    } else {
      console.log('🖥️ Desktop wallet connection initiated from campaign page:', currentPath)
    }
    
    appKit.open()
  }

  const handleTooltipShow = (event: React.MouseEvent, label: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltipData({
      label,
      x: rect.right + 8,
      y: rect.top + rect.height / 2
    })
  }

  const handleTooltipHide = () => {
    setTooltipData(null)
  }

  const navigationItems = [
    { id: 'home', label: 'Home', icon: '/home.svg', route: '/' },
    { id: 'campaign', label: 'Yapping Campaign', icon: '/megaphone.svg', route: '/yapping-campaign' },
  ]

  return (
    <div className="min-h-screen yapper-background">
      {/* Top Header */}
      <header className="z-20 w-full sticky top-0 bg-yapper-surface/95 backdrop-blur border-b border-yapper">
        <div className="relative flex items-center justify-between px-6 h-16 max-w-none mx-auto">
          {/* Desktop Navigation Link - Left of YAP.BURNIE */}
          <div className="hidden lg:flex items-center space-x-6">
            <CountdownBanner />
          </div>
          
          {/* YAP.BURNIE Logo - Center */}
          <div className="absolute left-4 lg:left-1/2 lg:-translate-x-1/2 z-20">
            <button 
              onClick={() => router.push('/')}
              className="text-white text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold relative group cursor-pointer"
            >
              <span className="relative z-10 no-underline hover:no-underline transition-colors text-white font-nt-brick">
                YAP.BURNIE
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg blur-sm"></div>
            </button>
          </div>
          
          {/* Connect Wallet Button - Right */}
          <div className="flex items-center flex-row justify-end gap-2 ml-auto">
            <button
              onClick={() => router.push('/')}
              className="bg-[#FD7A10] hover:bg-[#e55a0d] text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-[calc(100vh-64px)] flex flex-col overflow-x-hidden max-w-[100vw]">
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-0 md:px-6 lg:px-6 pb-24">
          <section className="space-y-6 py-6">
            <RewardCampaigning mixpanel={null} onWalletConnect={handleWalletConnect} />
          </section>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-yapper-surface/95 backdrop-blur border-t border-yapper z-50">
        <div className="flex items-center justify-around py-2 px-4 max-w-md mx-auto">
          {navigationItems.map((item) => {
            const isActive = item.route === '/yapping-campaign'
            const isSpecialItem = item.id === 'campaign'

            return (
              <button
                key={item.id}
                onClick={() => router.push(item.route)}
                className={`relative flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-[60px] ${
                  isActive 
                    ? 'text-white bg-yapper-muted/50' 
                    : 'text-white/70 hover:text-white hover:bg-yapper-muted/30'
                }`}
              >
                <div className="relative">
                  <Image 
                    src={item.icon} 
                    alt={item.label} 
                    width={20} 
                    height={20} 
                    className={`w-5 h-5 mb-1 ${
                      isActive ? 'opacity-100' : 'opacity-70'
                    }`}
                  />
                  {isSpecialItem && <div className="nav-badge"></div>}
                </div>
                <span className="text-xs font-medium leading-tight text-center">
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile & Tablet Bottom Padding */}
      <div className="lg:hidden h-20"></div>

      {/* Portal Tooltip */}
      {mounted && tooltipData && createPortal(
        <div 
          className="fixed bg-[#220808] text-white text-sm px-3 py-2 rounded-lg shadow-xl pointer-events-none whitespace-nowrap z-[2147483647]"
          style={{
            left: tooltipData.x,
            top: tooltipData.y,
            transform: 'translateY(-50%)',
            zIndex: 2147483647
          }}
        >
          {tooltipData.label}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-[6px] border-b-[6px] border-r-[6px] border-transparent border-r-[#220808]"></div>
        </div>,
        document.body
      )}
    </div>
  )
}
