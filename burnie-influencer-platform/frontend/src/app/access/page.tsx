'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { appKit } from '@/app/reown'
// Note: We don't import useMarketplaceAccess here to avoid redirect loops
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import WalletDisplay from '@/components/WalletDisplay'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import Image from 'next/image'
import { useROASTBalance } from '@/hooks/useROASTBalance'

export default function AccessPage() {
  const { address, isConnected } = useAccount()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const { balance: roastBalance, isLoading: balanceLoading } = useROASTBalance()
  // State to track access checking
  const [accessStatus, setAccessStatus] = useState({
    hasAccess: false,
    status: 'PENDING_REFERRAL' as 'PENDING_REFERRAL' | 'PENDING_WAITLIST' | 'APPROVED' | 'REJECTED',
    isLoading: true
  })
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  const [activeForm, setActiveForm] = useState<'referral' | 'waitlist' | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')

  // Referral form state
  const [referralCode, setReferralCode] = useState('')

  // Removed waitlist form state - now using one-click join

  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Function to check access status directly
  const checkAccessStatus = async () => {
    if (!address || !isAuthenticated) {
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        isLoading: false
      })
      return
    }

    try {
      // Add cache-busting parameter to force fresh API call
      const timestamp = Date.now();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${address}?t=${timestamp}`
      )
      
      const result = await response.json()
      
      if (result.success) {
        if (result.data.hasAccess) {
          // APPROVED users should immediately go to marketplace
          console.log('✅ User has access (APPROVED), redirecting to marketplace')
          router.push('/marketplace')
          return
        } else {
          // Use the actual status from backend
          const actualStatus = result.data?.status || 'PENDING_REFERRAL'
          console.log(`🔒 User access status: ${actualStatus}`)
          setAccessStatus({
            hasAccess: false,
            status: actualStatus,
            isLoading: false
          })
        }
      } else {
        console.log('❌ Access check failed')
        setAccessStatus({
          hasAccess: false,
          status: 'PENDING_REFERRAL',
          isLoading: false
        })
      }
    } catch (error) {
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        isLoading: false
      })
    }
  }

  // Simple check: if authenticated, check status; if not, show access form
  useEffect(() => {
    if (!authLoading && isAuthenticated && address) {
      checkAccessStatus()
    } else if (!authLoading && !isAuthenticated) {
      setAccessStatus(prev => ({ ...prev, isLoading: false }))
    }
  }, [authLoading, isAuthenticated, address])

  // Poll for approval status when user is on waitlist
  useEffect(() => {
    if (!authLoading && isAuthenticated && address && accessStatus.status === 'PENDING_WAITLIST') {
      const pollInterval = setInterval(() => {
        checkAccessStatus()
      }, 5000) // Poll every 5 seconds for faster detection

      return () => {
        clearInterval(pollInterval)
      }
    }
  }, [authLoading, isAuthenticated, address, accessStatus.status])

  // Auto-redirect when access is granted
  useEffect(() => {
    if (!authLoading && isAuthenticated && accessStatus.hasAccess && !accessStatus.isLoading) {
      router.push('/marketplace')
    }
  }, [authLoading, isAuthenticated, accessStatus.hasAccess, accessStatus.isLoading, router])

  // Header component for access page
  const AccessHeader = () => (
    <header className="z-20 w-full sticky top-0 bg-yapper-surface/95 backdrop-blur border-b border-yapper">
      <div className="relative flex items-center justify-between px-6 h-16 max-w-none mx-auto">
        {/* Left side - empty for now */}
        <div className="flex-1"></div>

        {/* Center Logo */}
        <div className="absolute left-4 lg:left-1/2 lg:-translate-x-1/2 z-20">
          <div className="text-white text-xl sm:text-2xl lg:text-3xl xl:text-4xl font-bold relative group cursor-pointer">
            <span className="relative z-10 no-underline hover:no-underline transition-colors text-white font-nt-brick">
              YAP.BURNIE
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-orange-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg blur-sm"></div>
          </div>
        </div>

                  {/* Right Side - Social Icons + Balance + Wallet */}
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

            {/* Wallet Connection with Balance */}
            <WalletDisplay 
              showBalance={true}
              balance={roastBalance}
              balanceLoading={balanceLoading}
            />
        </div>
      </div>
    </header>
  )

  const handleReferralSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!referralCode.trim()) return

    setIsSubmitting(true)
    setSubmitMessage('')

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/validate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            code: referralCode.trim().toUpperCase(),
            walletAddress: address
          }),
        }
      )

      const result = await response.json()

      if (result.success) {
        setSubmitMessage('✅ Referral code accepted! Access granted.')
        setTimeout(() => {
          router.push('/marketplace')
        }, 1500)
      } else {
        setSubmitMessage(`❌ ${result.message || 'Invalid referral code'}`)
      }
    } catch (error) {
      console.error('Error validating referral code:', error)
      setSubmitMessage('❌ Error validating code. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleWaitlistJoin = async () => {
    // Prevent joining if already on waitlist
    if (accessStatus.status === 'PENDING_WAITLIST') {
      setSubmitMessage('❌ You are already on the waitlist')
      return
    }

    setIsSubmitting(true)
    setSubmitMessage('')

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            walletAddress: address,
          }),
        }
      )

      const result = await response.json()

      if (result.success) {
        setSubmitMessage('✅ You have been added to the waitlist! You\'ll be able to access the platform once approved by admin.')
        // Refresh access status after a delay
        setTimeout(() => {
          checkAccessStatus()
        }, 2000)
      } else {
        setSubmitMessage(`❌ ${result.message || 'Failed to join waitlist'}`)
      }
    } catch (error) {
      console.error('Error joining waitlist:', error)
      setSubmitMessage('❌ Error joining waitlist. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Show loading state
  if (authLoading || accessStatus.isLoading) {
    return (
      <div className="min-h-screen yapper-background">
        <AccessHeader />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-bold text-white mb-2 font-nt-brick">Loading...</h2>
            <p className="text-white/70 font-nt-brick">Checking your access status...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show wallet connection requirement
  if (!isConnected) {
    return (
      <div className="min-h-screen yapper-background">
        <AccessHeader />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-6">
          <div className="w-full max-w-md text-center">
            <h1 className="text-white text-xl font-nt-brick mb-4">Connect Your Wallet</h1>
            <p className="text-white/70 mt-2 mb-6 font-nt-brick">
              Connect your wallet to access the Burnie platform
            </p>
            <button
              onClick={() => {
                console.log("[AppKit] Connect button clicked from access page modal");
                const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/";
                localStorage.setItem("wc_return_path", currentPath);
                appKit.open();
              }}
              className="bg-[#FD7A10] hover:bg-[#e55a0d] text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Referral form
  if (activeForm === 'referral') {
    return (
      <div className="min-h-screen yapper-background">
        <AccessHeader />
        <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-6">
          <div className="w-full max-w-md text-center">
            <h1 className="text-white text-xl font-nt-brick mb-2">Enter Referral Code</h1>
            <p className="text-white/70 mt-2 mb-6 font-nt-brick">
              Enter your referral code to gain platform access
            </p>
            <form onSubmit={handleReferralSubmit} className="space-y-4">
              <div>
                <label htmlFor="referralCode" className="block text-white/80 text-sm font-medium mb-2 font-nt-brick">
                  Referral Code
                </label>
                <input
                  type="text"
                  id="referralCode"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="LEADER-COMMUNITY"
                  className="w-full px-3 py-2 bg-white border border-yapper-border rounded-md text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  disabled={isSubmitting}
                  required
                />
              </div>

              {submitMessage && (
                <div className="text-center text-sm">
                  {submitMessage.startsWith('✅') ? (
                    <span className="text-green-400">{submitMessage}</span>
                  ) : (
                    <span className="text-red-400">{submitMessage}</span>
                  )}
                </div>
              )}

              <div className="flex space-x-3">
                <Button
                  type="button"
                  onClick={() => setActiveForm(null)}
                  className="flex-1 bg-[#451616] hover:bg-[#743636] text-white font-nt-brick"
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-nt-brick"
                  disabled={isSubmitting || !referralCode.trim()}
                >
                  {isSubmitting ? 'Validating...' : 'Submit Code'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Waitlist form removed - now using one-click join

  // Main access selection screen
  return (
    <div className="min-h-screen yapper-background">
      <AccessHeader />
      <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-6">
        <div className="w-full max-w-md text-center">
          <h1 className="text-white text-xl font-nt-brick mb-4">Platform Access Required</h1>
          <p className="text-white/70 mt-2 mb-6 font-nt-brick">
            {accessStatus.status === 'PENDING_WAITLIST' 
              ? 'Your waitlist application is being reviewed. You\'ll be notified when approved.'
              : accessStatus.status === 'REJECTED'
              ? 'Your application was not approved at this time.'
              : 'Join the Burnie platform with a referral code or apply for the waitlist'
            }
          </p>
          
          {/* Burnie Character Image */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              {/* Animated glow effects positioned behind the image */}
              <div className="absolute top-4 left-4 right-4 bottom-4 rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-red-500 opacity-75 blur-lg animate-pulse pointer-events-none"></div>
              <div className="absolute top-2 left-2 right-2 bottom-2 rounded-full bg-gradient-to-r from-orange-300 to-orange-600 opacity-50 blur-xl animate-ping pointer-events-none"></div>
              
              {/* Main image with enhanced effects */}
              <Image
                src="/burnie_mira.png"
                alt="Burnie Character"
                width={320}
                height={320}
                className="relative z-10 rounded-lg shadow-[0_0_50px_rgba(255,165,0,0.8)] transform hover:scale-105 hover:rotate-1 transition-all duration-500 filter brightness-110 contrast-110 saturate-125"
              />
            </div>
          </div>
          {accessStatus.status === 'PENDING_WAITLIST' ? (
            <>
              <div className="text-orange-400 text-sm mb-3 font-nt-brick">⏳ Application pending review</div>
              <Button
                onClick={() => setActiveForm('referral')}
                className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-nt-brick"
              >
                Try Referral Code Instead
              </Button>
            </>
          ) : accessStatus.status === 'REJECTED' ? (
            <Button
              onClick={() => setActiveForm('referral')}
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-nt-brick"
            >
              Try Referral Code
            </Button>
          ) : (
            <>
              <Button
                onClick={() => setActiveForm('referral')}
                className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-nt-brick"
              >
                Enter Referral Code
              </Button>
              <div className="text-white/50 text-sm font-nt-brick">or</div>
              <Button
                onClick={handleWaitlistJoin}
                className="w-full bg-[#451616] hover:bg-[#743636] text-white font-nt-brick"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Joining...' : 'Join Waitlist'}
              </Button>
              
              {/* Show message after waitlist action */}
              {submitMessage && (
                <div className="mt-4 text-center text-sm">
                  {submitMessage.startsWith('✅') ? (
                    <span className="text-green-400 font-nt-brick">{submitMessage}</span>
                  ) : (
                    <span className="text-red-400 font-nt-brick">{submitMessage}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
