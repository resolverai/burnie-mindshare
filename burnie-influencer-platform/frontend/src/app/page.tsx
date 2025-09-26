'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Image from 'next/image'
import BiddingInterface from '@/components/yapper/BiddingInterface'
import { useROASTBalance } from '@/hooks/useROASTBalance'
import WalletDisplay from '@/components/WalletDisplay'

import { useAuth } from '@/hooks/useAuth'
import { useMarketplaceAccess } from '@/hooks/useMarketplaceAccess'
import { useRouter, useSearchParams } from 'next/navigation'
import MobileBottomNav from '@/components/MobileBottomNav'
import useMixpanel from '@/hooks/useMixpanel'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export default function HomePage() {
  console.log('🏠 Homepage loaded - showing marketplace content at base URL')
  
  const { address, isConnected } = useAccount()
  const { balance: roastBalance, isLoading: balanceLoading } = useROASTBalance()
  const { needsSignature, signIn, isLoading: authLoading, isAuthenticated } = useAuth()
  const { checkAccessOnly } = useMarketplaceAccess()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isProcessingReferral, setIsProcessingReferral] = useState(false)
  const mixpanel = useMixpanel()

  
  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Track homepage view when page loads
  useEffect(() => {
    if (mounted) {
      mixpanel.marketplaceViewed({
        screenName: 'Homepage',
        userAuthenticated: !!address
      })
    }
  }, [mounted, mixpanel, address])

  // Smart auto-trigger signature when wallet connects on homepage
  useEffect(() => {
    console.log('🔍 Homepage signature trigger check:', { 
      mounted, 
      needsSignature, 
      address: !!address, 
      authLoading, 
      isAuthenticated
    });
    
    // Only auto-trigger if:
    // 1. Component is mounted (avoid SSR issues)
    // 2. Wallet needs signature (new connection)
    // 3. Wallet is connected 
    // 4. Not currently loading auth
    // 5. Not already authenticated
    if (mounted && needsSignature && address && !authLoading && !isAuthenticated) {
      console.log('🔐 Auto-triggering signature confirmation for new wallet connection')
      signIn().catch(error => {
        console.error('❌ Auto-signature failed:', error)
      })
    }
  }, [needsSignature, address, authLoading, isAuthenticated, signIn, mounted])

  // Homepage routing logic
  useEffect(() => {
    const handleHomepageRouting = async () => {
      if (!authLoading && mounted && isAuthenticated && address) {
        console.log('🔍 Authenticated user on homepage, checking access status...');
        const hasAccess = await checkAccessOnly();
        if (hasAccess) {
          console.log('🔄 APPROVED user on homepage, redirecting to /marketplace');
          router.push('/marketplace');
        } else {
          // Check if there's a referral parameter for direct approval
          const referralCode = searchParams?.get('ref');
          if (referralCode) {
            console.log('🔗 Referral code detected in URL, attempting direct approval:', referralCode);
            setIsProcessingReferral(true);
            // Try to directly approve the user with the referral code
            try {
              const response = await fetch(
                `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/validate`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ 
                    code: referralCode.toUpperCase(),
                    walletAddress: address
                  }),
                }
              );

              const result = await response.json();

              if (result.success) {
                console.log('✅ Direct referral approval successful, redirecting to marketplace');
                router.push('/marketplace');
              } else {
                // Check if it's a security-related error (already approved user)
                if (result.message.includes('already have platform access') || 
                    result.message.includes('already used a referral code') ||
                    result.message.includes('already part of the referral system')) {
                  console.log('🚫 Already approved user with referral link - silently redirecting to marketplace');
                  // User is already approved, silently redirect to marketplace (no error message)
                  router.push('/marketplace');
                } else {
                  console.log('❌ Direct referral approval failed:', result.message);
                  setIsProcessingReferral(false);
                  // Other errors, redirect to access page
                  router.push(`/access?ref=${referralCode}`);
                }
              }
            } catch (error) {
              console.error('❌ Error during direct referral approval:', error);
              setIsProcessingReferral(false);
              router.push(`/access?ref=${referralCode}`);
            }
          } else {
            console.log('🔄 No referral code, redirecting to access page');
            router.push('/access');
          }
        }
      }
      // If not authenticated, stay on homepage (public browsing)
    };

    handleHomepageRouting();
  }, [isAuthenticated, address, authLoading, mounted, checkAccessOnly, router, searchParams])
  


  const navigationItems = [
    { id: 'marketplace', label: 'Marketplace', icon: '/home.svg', route: '/marketplace', active: true },
    { id: 'dashboard', label: 'Dashboard', icon: '/dashboard.svg', route: '/dashboard', requiresAuth: true },
    { id: 'mycontent', label: 'My content', icon: '/content.svg', route: '/my-content', requiresAuth: true },
    { id: 'campaign', label: 'Yapping Campaign', icon: '/megaphone.svg', route: '/campaign' },
    { id: 'rewards', label: 'My Rewards', icon: '/rewards.svg', route: '/rewards' }
  ]

  return (
    <div className="min-h-screen yapper-background">
      {/* Referral Processing Overlay */}
      {isProcessingReferral && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-yapper-surface border border-yapper-border rounded-lg p-8 text-center max-w-md mx-4">
            <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-bold text-white mb-2 font-nt-brick">Processing Referral</h2>
            <p className="text-white/70 font-nt-brick">Validating your referral code and granting access...</p>
            {searchParams?.get('ref') && (
              <p className="text-orange-400 text-sm font-mono mt-2">
                Code: {searchParams.get('ref')}
              </p>
            )}
          </div>
        </div>
      )}
      {/* Public Header - Simplified version without auth requirements */}
      <header className="z-20 w-full sticky top-0 bg-yapper-surface/95 backdrop-blur border-b border-yapper">
        <div className="relative flex items-center justify-between px-6 h-16 max-w-none mx-auto">
          {/* Left Navigation Links - Hidden per user request */}
          <div className="hidden lg:flex items-center space-x-6 xl:space-x-8">
            {/* About and Tokenomics links hidden */}
          </div>

          {/* Center Logo */}
          <div className="absolute left-4 lg:left-1/2 lg:-translate-x-1/2 z-20">
            <div className="text-white text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold relative group cursor-pointer">
              <span className="relative z-10 no-underline hover:no-underline transition-colors text-white font-nt-brick">
                YAP.BURNIE
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg blur-sm"></div>
            </div>
          </div>

          {/* Right Side - Social Icons + Optional Balance + Wallet */}
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

            {/* Wallet Connection with Balance */}
            <WalletDisplay 
              showBalance={true}
              balance={roastBalance}
              balanceLoading={balanceLoading}
            />
          </div>
        </div>
      </header>

      {/* Main Layout with Optional Sidebar */}
      <div className="flex">
        {/* Left Sidebar Navigation - Only show if fully authenticated (wallet connected + signature confirmed) */}
        {/* Hidden on mobile, tablet landscape (iPad Mini, iPad Air) - only show on desktop (lg: 1024px+) */}
        {mounted && isAuthenticated && (
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
                const isActive = item.active
                const isDisabled = item.requiresAuth && !isAuthenticated
                
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (!isDisabled) {
                        window.location.href = item.route
                      }
                    }}
                    disabled={isDisabled}
                    className={`group flex items-center rounded-md px-2 py-2 text-sm transition-colors overflow-hidden justify-start ${
                      isActive 
                        ? 'bg-yapper-muted text-white' 
                        : isDisabled
                        ? 'text-white/40 cursor-not-allowed'
                        : 'text-white/90 hover:bg-yapper-muted hover:text-white'
                    }`}
                  >
                    <span className="w-5 h-5 inline-flex items-center justify-center text-white/90 mr-3 shrink-0">
                      <Image src={item.icon} alt={item.label} width={20} height={20} className="w-5 h-5" />
                    </span>
                    <span className="relative overflow-hidden shrink-0 w-[160px]">
                      <span
                        className={`block ${isActive ? 'text-white' : isDisabled ? 'text-white/40' : 'text-white/90'}`}
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
                <div className="w-6 h-6 opacity-80 shrink-0 text-white flex items-center justify-center">
                  💼
                </div>
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
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <div className="flex-1 min-h-[calc(100vh-64px)] flex flex-col">
          <main className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-6 touch-pan-y overscroll-contain">
            <BiddingInterface />
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
      {mounted && isAuthenticated && (
        <MobileBottomNav 
          navigationItems={navigationItems}
          isAuthenticated={isAuthenticated}
        />
      )}

      {/* Mobile & Tablet Bottom Padding to prevent content from being hidden behind bottom nav */}
      <div className="lg:hidden h-20"></div>
    </div>
  )
} 