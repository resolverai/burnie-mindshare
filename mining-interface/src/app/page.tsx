'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../hooks/useAuth'
import { useTwitterConnection } from '../hooks/useTwitterConnection'
import { ArrowPathIcon, BoltIcon, CpuChipIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, ChartBarIcon, FireIcon } from '@heroicons/react/24/outline'


// Dynamic imports for components that need authentication
const TwitterConnection = dynamic(() => import('../components/TwitterConnection'), { ssr: false })
const MinerDashboard = dynamic(() => import('../components/MinerDashboard'), { ssr: false })

function HomePageContent() {
  const { isAuthenticated, isLoading, error, clearError, address, needsSignature, signIn } = useAuth()
  const { isConnected: isTwitterConnected, isLoading: isTwitterLoading, refetch: refetchTwitterStatus } = useTwitterConnection(address)
  const router = useRouter()
  const [showFlowChoice, setShowFlowChoice] = useState(false)
  const [selectedFlow, setSelectedFlow] = useState<'web3' | 'web2' | null>(null)
  const [web2HasValidSession, setWeb2HasValidSession] = useState(false)
  const [checkingWeb2Session, setCheckingWeb2Session] = useState(false)

  // Check if we're in dedicated miner mode
  const isDedicatedMiner = process.env.NEXT_PUBLIC_MINER === '1'
  
  // TEMPORARY: Skip Twitter for both regular and dedicated miners
  // TODO: Re-enable Twitter requirement for regular miners later
  const skipTwitter = true // Set to false to re-enable Twitter requirement
  
  // Check Web2 session status when selectedFlow is web2 or on initial load
  useEffect(() => {
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    if ((selectedFlow === 'web2' || web2Auth) && !web2HasValidSession && !checkingWeb2Session) {
      checkWeb2Session()
    }
  }, [selectedFlow])

  const checkWeb2Session = async () => {
    setCheckingWeb2Session(true)
    try {
      // Check localStorage first for quick check
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const web2AccountId = localStorage.getItem('burnie_web2_account_id')
      const web2Username = localStorage.getItem('burnie_web2_username')
      
      if (web2Auth && web2AccountId && web2Username) {
        // Verify with backend and check if profile is completed
        const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
        const response = await fetch(`${apiUrl}/web2-auth/check-session?twitter_username=${encodeURIComponent(web2Username)}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.hasValidSession) {
            // Only set valid session if user has completed profile
            if (data.data?.hasCompletedProfile) {
              setWeb2HasValidSession(true)
              console.log('✅ Web2 has valid session with completed profile')
            } else {
              // User has valid tokens but hasn't completed profile
              setWeb2HasValidSession(false)
              console.log('⚠️ Web2 session exists but profile not completed')
            }
          } else {
            // Clear invalid session data
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            localStorage.removeItem('burnie_web2_username')
            setWeb2HasValidSession(false)
          }
        }
      } else {
        setWeb2HasValidSession(false)
      }
    } catch (error) {
      console.error('Error checking Web2 session:', error)
      setWeb2HasValidSession(false)
    } finally {
      setCheckingWeb2Session(false)
    }
  }

  // Check if user has already created an account (only then lock the flow)
  useEffect(() => {
    const web3Auth = localStorage.getItem('burnie_auth_token') // Web3 auth token
    const web2Auth = localStorage.getItem('burnie_web2_auth') // Web2 auth token
    
    // Only lock the flow if user has actually authenticated
    if (web3Auth) {
      setSelectedFlow('web3')
    } else if (web2Auth) {
      setSelectedFlow('web2')
    }
    // Otherwise, let them choose freely (don't load from localStorage)
  }, [])
  
  // Debug logging for environment variables
  useEffect(() => {
    console.log('🔧 Environment Debug:', {
      NEXT_PUBLIC_MINER: process.env.NEXT_PUBLIC_MINER,
      isDedicatedMiner,
      skipTwitter,
      NODE_ENV: process.env.NODE_ENV
    })
  }, [])

  // Auto-trigger sign-in when wallet connects and signature is needed
  useEffect(() => {
    if (needsSignature && address && !isLoading) {
      console.log('🔐 Auto-triggering wallet sign-in confirmation')
      signIn()
    }
  }, [needsSignature, address, isLoading, signIn])

  // Redirect to dashboard when fully authenticated
  useEffect(() => {
    console.log('🔍 Auth state check:', { 
      isAuthenticated, 
      isTwitterConnected, 
      isLoading, 
      isTwitterLoading,
      address,
      isDedicatedMiner,
      NEXT_PUBLIC_MINER_RAW: process.env.NEXT_PUBLIC_MINER,
      NEXT_PUBLIC_MINER_TYPE: typeof process.env.NEXT_PUBLIC_MINER
    })
    
    // If user is authenticated and we have finished checking Twitter status
    if (isAuthenticated && !isLoading && !isTwitterLoading) {
      // TEMPORARY: Skip Twitter requirement for all miners
      if (skipTwitter || isDedicatedMiner) {
        console.log('✅ Miner authenticated (Twitter bypassed), redirecting to dashboard')
        router.push('/dashboard')
      } else {
        // For regular miners, require Twitter connection (when skipTwitter is false)
        if (isTwitterConnected) {
          console.log('✅ Regular miner fully authenticated with Twitter, redirecting to dashboard')
          router.push('/dashboard')
        } else {
          console.log('🐦 Regular miner authenticated but Twitter not connected, will show Twitter connection screen')
        }
      }
    }
  }, [isAuthenticated, isTwitterConnected, isLoading, isTwitterLoading, router, address, isDedicatedMiner])

  // Handle Twitter connection completion
  const handleTwitterConnected = async () => {
    console.log('🐦 Twitter connected successfully, refreshing status...')
    
    // Refresh Twitter status
    setTimeout(async () => {
      await refetchTwitterStatus()
      
      // Force redirect to dashboard after Twitter status is refreshed
      setTimeout(() => {
        if (isAuthenticated) {
          console.log('🚀 Forcing redirect to dashboard after Twitter connection')
          router.push('/dashboard')
        }
      }, 200) // Small delay to ensure state is updated
      
    }, 500)
  }

  // Show loading screen while authenticating or checking states
  if (isLoading || isTwitterLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="w-16 h-16 animate-spin text-orange-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">
            {needsSignature ? 'Confirm Sign-In' : 'Authenticating Wallet'}
          </h2>
          <p className="text-gray-400">
            {needsSignature 
              ? 'Please confirm the sign-in message in your wallet...' 
              : 'Checking your authentication status...'
            }
          </p>
        </div>
      </div>
    )
  }

  // Show error if authentication failed
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 max-w-md">
            <h2 className="text-red-400 font-bold mb-2">Authentication Failed</h2>
            <p className="text-gray-300 mb-4">{error}</p>
            <button
              onClick={clearError}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show Twitter connection screen if authenticated but no Twitter (only for regular miners when Twitter is not bypassed)
  if (isAuthenticated && !skipTwitter && !isDedicatedMiner && !isTwitterConnected) {
    return <TwitterConnection onConnected={handleTwitterConnected} />
  }

  // Show mining dashboard if fully authenticated (fallback before redirect)
  // TEMPORARY: Twitter bypassed for all miners
  // For dedicated miners: only wallet auth required
  // For regular miners: both wallet auth and Twitter required (when skipTwitter is false)
  if (isAuthenticated && (skipTwitter || isDedicatedMiner || isTwitterConnected)) {
    return <MinerDashboard activeSection="dashboard" />
  }

  // Handle flow selection
  const handleFlowSelection = (flow: 'web3' | 'web2') => {
    setSelectedFlow(flow)
    // Don't save to localStorage yet - only save after actual authentication
    
    if (flow === 'web3') {
      // For Web3, show the wallet connection
      setShowFlowChoice(false)
    } else {
      // For Web2, check if session exists
      if (web2HasValidSession) {
        // User has valid session, go directly to dashboard
        router.push('/web2/dashboard')
      } else {
        // No valid session, redirect to Twitter auth
        router.push('/web2/auth')
      }
    }
  }

  // Allow user to change their path (reset selection)
  const handleResetPath = () => {
    setSelectedFlow(null)
    setShowFlowChoice(false)
    // Don't clear auth tokens - only clear the temporary selection
  }

  // Show flow choice modal for regular miners (MINER=0)
  if (!isDedicatedMiner && showFlowChoice && !selectedFlow) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="max-w-5xl mx-auto px-6">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center space-x-3 mb-6">
              <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                <BoltIcon className="h-10 w-10 text-white" />
              </div>
              <h1 className="text-4xl font-bold text-white">BURNIE</h1>
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">
              Choose Your <span className="gradient-text">Content Journey</span>
            </h2>
            <p className="text-xl text-gray-300">
              Select the experience that fits your needs
            </p>
          </div>

          {/* Flow Choice Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Web3 Miner Card */}
            <div 
              onClick={() => handleFlowSelection('web3')}
              className="glass p-8 rounded-2xl border-2 border-gray-700 hover:border-orange-500 transition-all cursor-pointer hover:scale-105 transform"
            >
              <div className="text-center">
                <div className="w-20 h-20 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl flex items-center justify-center mx-auto mb-6">
                  <CpuChipIcon className="h-12 w-12 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">🌐 Web3 Miner</h3>
                <ul className="text-left space-y-3 mb-6">
                  <li className="flex items-start text-gray-300">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Mine ROAST tokens by generating content</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Participate in platform campaigns</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Wallet-based authentication</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Earn rewards for quality content</span>
                  </li>
                </ul>
                <button className="btn-primary w-full">
                  Start Mining →
                </button>
              </div>
            </div>

            {/* Web2 Business Card */}
            <div 
              onClick={() => handleFlowSelection('web2')}
              className="glass p-8 rounded-2xl border-2 border-gray-700 hover:border-blue-500 transition-all cursor-pointer hover:scale-105 transform"
            >
              <div className="text-center">
                <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl flex items-center justify-center mx-auto mb-6">
                  <SparklesIcon className="h-12 w-12 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">💼 Web2 Business</h3>
                <ul className="text-left space-y-3 mb-6">
                  <li className="flex items-start text-gray-300">
                    <span className="text-blue-400 mr-2">✓</span>
                    <span>AI-powered social media automation</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-blue-400 mr-2">✓</span>
                    <span>Brand-specific content generation</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-blue-400 mr-2">✓</span>
                    <span>Multi-platform publishing</span>
                  </li>
                  <li className="flex items-start text-gray-300">
                    <span className="text-blue-400 mr-2">✓</span>
                    <span>Perfect for agencies & businesses</span>
                  </li>
                </ul>
                     <button 
                       className="bg-black hover:bg-gray-900 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105 w-full"
                       disabled={checkingWeb2Session}
                     >
                       {checkingWeb2Session ? 'Checking...' : web2HasValidSession ? 'Go To Dashboard →' : 'Start Journey →'}
                     </button>
              </div>
            </div>
          </div>

          {/* Back button */}
          <div className="text-center mt-8">
            <button
              onClick={() => setShowFlowChoice(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show public landing page (with wallet connection)
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800">
      {/* Header */}
      <header className="relative z-10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <BoltIcon className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">BURNIE</h1>
          </div>
          <div className="flex items-center space-x-4">
            {!isDedicatedMiner && (
              <>
                {(() => {
                  const web3Auth = typeof window !== 'undefined' ? localStorage.getItem('burnie_auth_token') : null
                  const web2Auth = typeof window !== 'undefined' ? localStorage.getItem('burnie_web2_auth') : null
                  
                  if (web3Auth) {
                    // Web3 user is logged in
                    return (
                      <>
                        <button
                          onClick={() => router.push('/dashboard')}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          Go to Dashboard
                        </button>
                        <button
                          onClick={() => {
                            localStorage.removeItem('burnie_auth_token')
                            window.location.reload()
                          }}
                          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                        >
                          Logout
                        </button>
                      </>
                    )
                  } else if (web2Auth) {
                    // Web2 user is logged in
                    return (
                      <>
                        <button
                          onClick={() => router.push('/web2/dashboard')}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          Go to Dashboard
                        </button>
                        <button
                          onClick={async () => {
                            // Call backend logout endpoint
                            try {
                              const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
                              const accountId = localStorage.getItem('burnie_web2_account_id')
                              await fetch(`${apiUrl}/web2-auth/logout`, {
                                method: 'POST',
                                headers: {
                                  'Authorization': `Bearer ${web2Auth}`,
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ account_id: accountId })
                              })
                            } catch (error) {
                              console.error('Logout error:', error)
                            }
                            
                            // Clear localStorage
                            localStorage.removeItem('burnie_web2_auth')
                            localStorage.removeItem('burnie_web2_account_id')
                            localStorage.removeItem('burnie_web2_username')
                            window.location.reload()
                          }}
                          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                        >
                          Logout
                        </button>
                      </>
                    )
                  } else {
                    // No user logged in - show Get Started button
                    return (
                      <button
                        onClick={() => setShowFlowChoice(true)}
                        className="btn-secondary"
                      >
                        Get Started
                      </button>
                    )
                  }
                })()}
              </>
            )}
            {selectedFlow === 'web3' && !localStorage.getItem('burnie_auth_token') && <ConnectButton />}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 px-6 pt-20 pb-32">
        <div className="max-w-6xl mx-auto text-center">
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/20 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
          </div>

          <div className="relative z-10">
            {/* Status indicator */}
            <div className="flex justify-center mb-6">
              <div className="flex items-center space-x-2 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-green-300 font-medium">AI Mining Network Live</span>
              </div>
            </div>

            <h1 className="text-5xl md:text-7xl font-black mb-6">
              <span className="gradient-text">AI-POWERED</span><br />
              <span className="text-white">CONTENT CREATION</span><br />
              <span className="gradient-text">FOR EVERYONE</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-4xl mx-auto leading-relaxed">
              Whether you're a <strong className="text-white">Web3 miner</strong>, <strong className="text-white">business owner</strong>, 
              <strong className="text-white"> social media manager</strong>, <strong className="text-white">design agency</strong>, 
              or <strong className="text-white">influencer</strong> — create viral content with AI in seconds.
            </p>

            {/* Use Cases */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12 max-w-6xl mx-auto">
              <div className="glass p-6 rounded-xl hover:scale-105 transition-transform">
                <div className="text-4xl mb-3">🚀</div>
                <h3 className="text-lg font-bold text-white mb-2">Web3 Miners</h3>
                <p className="text-gray-400 text-sm">Mine ROAST tokens by generating viral content for campaigns</p>
              </div>
              <div className="glass p-6 rounded-xl hover:scale-105 transition-transform">
                <div className="text-4xl mb-3">🏢</div>
                <h3 className="text-lg font-bold text-white mb-2">Businesses</h3>
                <p className="text-gray-400 text-sm">Automate social media with AI-powered brand content</p>
              </div>
              <div className="glass p-6 rounded-xl hover:scale-105 transition-transform">
                <div className="text-4xl mb-3">🎨</div>
                <h3 className="text-lg font-bold text-white mb-2">Design Agencies</h3>
                <p className="text-gray-400 text-sm">Create stunning visuals for multiple clients instantly</p>
              </div>
              <div className="glass p-6 rounded-xl hover:scale-105 transition-transform">
                <div className="text-4xl mb-3">📱</div>
                <h3 className="text-lg font-bold text-white mb-2">Influencers</h3>
                <p className="text-gray-400 text-sm">Generate engaging content for all your social channels</p>
              </div>
            </div>

            {/* What We Offer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-5xl mx-auto">
              <div className="glass p-6 rounded-xl">
                <SparklesIcon className="h-8 w-8 text-orange-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">AI Content Generation</h3>
                <p className="text-gray-400 text-sm">Images, videos, and text optimized for maximum engagement across all platforms</p>
              </div>
              <div className="glass p-6 rounded-xl">
                <CpuChipIcon className="h-8 w-8 text-blue-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">Brand Intelligence</h3>
                <p className="text-gray-400 text-sm">AI learns your brand voice and creates on-brand content automatically</p>
              </div>
              <div className="glass p-6 rounded-xl">
                <TrophyIcon className="h-8 w-8 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">Multi-Platform</h3>
                <p className="text-gray-400 text-sm">Publish directly to Twitter, LinkedIn, YouTube, and more</p>
              </div>
            </div>
            
            {/* CTA Section */}
            <div className="glass p-8 rounded-2xl max-w-2xl mx-auto mb-12">
              <h3 className="text-2xl font-bold text-white mb-4 text-center">Choose Your Path</h3>
              <p className="text-gray-400 mb-6 text-center">
                Select the experience that matches your needs
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-gray-700/30 rounded-lg border border-gray-600">
                  <div className="text-3xl mb-2">🌐</div>
                  <h4 className="text-white font-bold mb-1">Web3 Miner</h4>
                  <p className="text-gray-400 text-sm mb-3">Generate content for campaigns and earn ROAST tokens</p>
                  <ul className="text-xs text-gray-400 space-y-1">
                    <li>✓ Wallet-based auth</li>
                    <li>✓ Campaign participation</li>
                    <li>✓ Token rewards</li>
                  </ul>
                </div>
                
                <div className="p-4 bg-gray-700/30 rounded-lg border border-gray-600">
                  <div className="text-3xl mb-2">💼</div>
                  <h4 className="text-white font-bold mb-1">Web2 Business</h4>
                  <p className="text-gray-400 text-sm mb-3">Automate content creation for your brand or clients</p>
                  <ul className="text-xs text-gray-400 space-y-1">
                    <li>✓ Social media automation</li>
                    <li>✓ Brand-specific content</li>
                    <li>✓ Multi-platform publishing</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-8 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 max-w-md mx-auto">
                <p className="font-medium">Authentication Error</p>
                <p className="text-sm mt-1">{error}</p>
                <button
                  onClick={clearError}
                  className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Call to Action */}
            <div className="text-center">
              {(() => {
                const web3Auth = typeof window !== 'undefined' ? localStorage.getItem('burnie_auth_token') : null
                const web2Auth = typeof window !== 'undefined' ? localStorage.getItem('burnie_web2_auth') : null
                
                // If user is already logged in, show dashboard button
                if (web3Auth) {
                  return (
                    <button
                      onClick={() => router.push('/dashboard')}
                      className="btn-primary text-lg px-12 py-4 mb-4"
                    >
                      🚀 Go to Web3 Dashboard
                    </button>
                  )
                } else if (web2Auth) {
                  return (
                    <button
                      onClick={() => router.push('/web2/dashboard')}
                      className="btn-primary text-lg px-12 py-4 mb-4"
                    >
                      🚀 Go to Web2 Dashboard
                    </button>
                  )
                }
                
                // Otherwise show the flow selection
                return !selectedFlow ? (
                  <>
                    <button
                      onClick={() => setShowFlowChoice(true)}
                      className="btn-primary text-lg px-12 py-4 mb-4"
                    >
                      🚀 Get Started Now
                    </button>
                    <p className="text-gray-400 text-sm">
                      No credit card required • Start creating in minutes
                    </p>
                  </>
                ) : selectedFlow === 'web3' ? (
                <ConnectButton.Custom>
                  {({ account, chain, openConnectModal, mounted }) => {
                    const ready = mounted
                    const connected = ready && account && chain

                    if (!ready) return null

                    if (!connected) {
                      return (
                        <button
                          onClick={openConnectModal}
                          className="btn-primary text-lg px-8 py-4"
                        >
                          🚀 Connect Wallet to Start
                        </button>
                      )
                    }

                    return (
                      <div className="text-center">
                        <div className="text-green-400 font-medium mb-2">✅ Wallet Connected</div>
                        <div className="text-gray-400 text-sm">
                          {isLoading ? 'Please sign the message in your wallet...' : 'Setting up your mining interface...'}
                        </div>
                      </div>
                    )
                  }}
                </ConnectButton.Custom>
                ) : (
                  <button
                    onClick={() => {
                      if (web2HasValidSession) {
                        router.push('/web2/dashboard')
                      } else {
                        router.push('/web2/auth')
                      }
                    }}
                    disabled={checkingWeb2Session}
                    className="bg-black hover:bg-gray-900 text-white font-bold text-lg px-12 py-4 rounded-xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkingWeb2Session ? (
                      <span>Checking session...</span>
                    ) : web2HasValidSession ? (
                      <span>Go To Dashboard</span>
                    ) : (
                      <span className="flex items-center justify-center space-x-2">
                        <span>Sign in with</span>
                        <span className="font-black">𝕏</span>
                      </span>
                    )}
                  </button>
                )
              })()}
            </div>
          </div>
        </div>
      </main>

      {/* Use Cases Section */}
      <section className="py-20 bg-gradient-to-r from-orange-900/20 to-red-900/20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Built For <span className="gradient-text">Every Creator</span>
          </h2>
          <p className="text-xl text-gray-300 mb-12 max-w-4xl mx-auto">
            From Web3 miners to Fortune 500 brands, our AI adapts to your unique needs
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="glass p-8 rounded-xl text-left">
              <div className="flex items-center space-x-3 mb-4">
                <div className="text-3xl">📱</div>
                <h3 className="text-xl font-bold text-white">Social Media Managers</h3>
              </div>
              <p className="text-gray-300 mb-4">
                Schedule weeks of content in minutes. Our AI learns your brand voice and creates 
                approval-ready posts for Twitter, LinkedIn, YouTube, and Instagram.
              </p>
              <ul className="text-sm text-gray-400 space-y-2">
                <li>✓ Automated daily content suggestions</li>
                <li>✓ Multi-platform scheduling</li>
                <li>✓ Performance analytics</li>
              </ul>
            </div>
            
            <div className="glass p-8 rounded-xl text-left">
              <div className="flex items-center space-x-3 mb-4">
                <div className="text-3xl">🎨</div>
                <h3 className="text-xl font-bold text-white">Design Agencies</h3>
              </div>
              <p className="text-gray-300 mb-4">
                Manage multiple clients with ease. Generate stunning visuals and videos for each 
                brand while maintaining their unique identity and style.
              </p>
              <ul className="text-sm text-gray-400 space-y-2">
                <li>✓ Per-client brand contexts</li>
                <li>✓ Team collaboration tools</li>
                <li>✓ Bulk content generation</li>
              </ul>
            </div>

            <div className="glass p-8 rounded-xl text-left">
              <div className="flex items-center space-x-3 mb-4">
                <div className="text-3xl">👔</div>
                <h3 className="text-xl font-bold text-white">Fashion & E-commerce</h3>
              </div>
              <p className="text-gray-300 mb-4">
                Generate product photos with models, create promotional videos, and showcase your 
                products in stunning AI-generated scenes.
              </p>
              <ul className="text-sm text-gray-400 space-y-2">
                <li>✓ Product visualization</li>
                <li>✓ Model integration</li>
                <li>✓ Lifestyle scenes</li>
              </ul>
            </div>
            
            <div className="glass p-8 rounded-xl text-left">
              <div className="flex items-center space-x-3 mb-4">
                <div className="text-3xl">⛏️</div>
                <h3 className="text-xl font-bold text-white">Web3 Content Miners</h3>
              </div>
              <p className="text-gray-300 mb-4">
                Generate viral content for cookie.fun, Kaito yaps, and other Web3 platforms. 
                Earn ROAST tokens while your AI creates mindshare-optimized content.
              </p>
              <ul className="text-sm text-gray-400 space-y-2">
                <li>✓ Campaign participation</li>
                <li>✓ Token rewards</li>
                <li>✓ Mindshare optimization</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gray-900/50">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-center text-white mb-12">
            Why Choose <span className="gradient-text">Burnie</span>?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: RocketLaunchIcon,
                title: 'Mindshare Intelligence',
                description: 'Proprietary algorithms analyze what drives engagement on cookie.fun, Kaito yaps, and other attention platforms'
              },
              {
                icon: ChartBarIcon,
                title: 'Attention Economy Mastery',
                description: 'Deep understanding of viral mechanics and trending patterns across decentralized social platforms'
              },
              {
                icon: FireIcon,
                title: 'Precision Content Synthesis',
                description: 'AI agents craft content scientifically designed to maximize mindshare and attention capture'
              },
              {
                icon: TrophyIcon,
                title: 'Competitive Rewards',
                description: 'Earn ROAST tokens based on content quality and mindshare performance metrics'
              },
              {
                icon: SparklesIcon,
                title: 'Multi-Modal Generation',
                description: 'Text, images, and videos optimized for maximum engagement across all platforms'
              },
              {
                icon: BoltIcon,
                title: 'Base Network Speed',
                description: 'Lightning-fast content deployment with minimal fees on Coinbase L2'
              }
            ].map((feature, index) => {
              const Icon = feature.icon
              return (
                <div key={index} className="glass p-6 rounded-xl hover:bg-gray-800/50 transition-all">
                  <Icon className="h-8 w-8 text-orange-500 mb-4" />
                  <h3 className="text-lg font-bold text-white mb-3">{feature.title}</h3>
                  <p className="text-gray-400 text-sm">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function HomePage() {
  return <HomePageContent />
} 