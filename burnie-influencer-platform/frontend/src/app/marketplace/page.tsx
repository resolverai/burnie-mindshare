'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import Image from 'next/image'
import BiddingInterface from '@/components/yapper/BiddingInterface'
import { useROASTBalance } from '@/hooks/useROASTBalance'
import { useTokenRegistration } from '@/hooks/useTokenRegistration'
import { useAuth } from '@/hooks/useAuth'
import { useMarketplaceAccess } from '@/hooks/useMarketplaceAccess'
import { useUserReferralCode } from '@/hooks/useUserReferralCode'

export default function MarketplacePage() {
  console.log('🏪 Marketplace page loaded - no authentication required')
  
  const { address, isConnected } = useAccount()
  const { balance: roastBalance, isLoading: balanceLoading } = useROASTBalance()
  const { needsSignature, signIn, isLoading: authLoading, isAuthenticated } = useAuth()
  const { hasAccess, redirectToAccess } = useMarketplaceAccess()
  const { referralCode, copyToClipboard } = useUserReferralCode()
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  
  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Redirect users who need authentication/access to the access page
  useEffect(() => {
    // Only redirect if we're certain about the authentication state and access status
    if (!authLoading && isConnected && !hasAccess) {
      // Add a small delay to avoid redirect loops and ensure state is stable
      const timer = setTimeout(() => {
        console.log('🔒 Connected user without access, redirecting to access page')
        redirectToAccess()
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [authLoading, isConnected, hasAccess, redirectToAccess])
  
  // Note: Removed auto-signature trigger for marketplace to allow access page redirection
  // Users should be redirected to access page first for authentication
  
  // Auto-register ROAST token if wallet is connected (only on client)
  useTokenRegistration()

  const handleReferralCodeClick = async () => {
    if (referralCode?.code) {
      const success = await copyToClipboard(referralCode.code)
      if (success) {
        setShowCopySuccess(true)
        setTimeout(() => setShowCopySuccess(false), 2000)
      }
    }
  }

  const navigationItems = [
    { id: 'marketplace', label: 'Marketplace', icon: '/home.svg', route: '/marketplace', active: true },
    { id: 'dashboard', label: 'Dashboard', icon: '/dashboard.svg', route: '/dashboard', requiresAuth: true },
    { id: 'mycontent', label: 'My content', icon: '/content.svg', route: '/my-content', requiresAuth: true }
  ]

  return (
    <div className="min-h-screen yapper-background">
      {/* Public Header - Simplified version without auth requirements */}
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

          {/* Right Side - Social Icons + Optional Balance + Wallet */}
          <div className="flex items-center flex-row justify-end gap-2">
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

            {/* User Referral Code - only show if authenticated */}
            {mounted && isAuthenticated && referralCode && (
              <div className="relative">
                <button
                  onClick={handleReferralCodeClick}
                  className="px-3 py-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-full text-sm font-bold transition-all duration-200 transform hover:scale-105 md:flex hidden items-center gap-2"
                  title="Click to copy your referral code"
                >
                  <span>🔗</span>
                  <span>My Referral:</span>
                  <span className="font-mono">{referralCode.code}</span>
                </button>
                
                {/* Copy success tooltip */}
                {showCopySuccess && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    Copied!
                  </div>
                )}
              </div>
            )}

            {/* ROAST Balance Badge - only show if fully authenticated */}
            {mounted && isAuthenticated && (
              <div className="px-3 py-1 bg-white text-black rounded-full text-lg font-bold md:flex hidden font-silkscreen">
                🔥 {balanceLoading ? '...' : roastBalance}
              </div>
            )}

            {/* Wallet Connection */}
            <ConnectButton 
              showBalance={false}
              chainStatus="none"
              accountStatus="avatar"
            />
          </div>
        </div>
      </header>

      {/* Main Layout with Optional Sidebar */}
      <div className="flex">
        {/* Left Sidebar Navigation - Only show if fully authenticated (wallet connected + signature confirmed) */}
        {mounted && isAuthenticated && (
          <aside
            className={`${isSidebarExpanded ? 'w-52' : 'w-16'} bg-yapper-surface border-r border-yapper transition-[width] duration-300 ease-in-out flex flex-col h-[calc(100vh-64px)] shadow-sm flex-shrink-0 sticky top-16`}
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
          <main className="flex-1 overflow-y-auto">
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
      </div>
    )
} 