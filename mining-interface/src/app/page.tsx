'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAuth } from '../hooks/useAuth'
import { useTwitterConnection } from '../hooks/useTwitterConnection'
import { ArrowPathIcon, BoltIcon, CpuChipIcon, SparklesIcon, TrophyIcon, RocketLaunchIcon, ChartBarIcon, FireIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'

// Dynamic imports for components that need authentication
const TwitterConnection = dynamic(() => import('../components/TwitterConnection'), { ssr: false })
const MinerDashboard = dynamic(() => import('../components/MinerDashboard'), { ssr: false })

export default function HomePage() {
  const { isAuthenticated, isLoading, error, clearError, address, needsSignature, signIn } = useAuth()
  const { isConnected: isTwitterConnected, isLoading: isTwitterLoading, refetch: refetchTwitterStatus } = useTwitterConnection(address)
  const router = useRouter()

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
      address 
    })
    
    // If user is authenticated and we have finished checking Twitter status
    if (isAuthenticated && !isLoading && !isTwitterLoading) {
      if (isTwitterConnected) {
        console.log('✅ Fully authenticated with Twitter, redirecting to dashboard')
        router.push('/dashboard')
      } else {
        console.log('🐦 Authenticated but Twitter not connected, will show Twitter connection screen')
      }
    }
  }, [isAuthenticated, isTwitterConnected, isLoading, isTwitterLoading, router, address])

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

  // Show Twitter connection screen if authenticated but no Twitter
  if (isAuthenticated && !isTwitterConnected) {
    return <TwitterConnection onConnected={handleTwitterConnected} />
  }

  // Show mining dashboard if fully authenticated (fallback before redirect)
  if (isAuthenticated && isTwitterConnected) {
    return <MinerDashboard activeSection="dashboard" />
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
            <ConnectButton />
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

            <h1 className="text-6xl md:text-8xl font-black mb-8">
              <span className="gradient-text">NEURAL</span><br />
              <span className="text-white">CONTENT</span><br />
              <span className="gradient-text">MINING</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed">
              We understand what drives mindshare on cookie.fun, Kaito yaps, and other attention economy platforms. 
              Our personalized agents synthesize content precisely engineered to maximize your mindshare using proprietary AI models.
            </p>

            {/* Key Value Props */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-4xl mx-auto">
              <div className="glass p-6 rounded-xl">
                <CpuChipIcon className="h-8 w-8 text-orange-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">Mindshare Algorithms</h3>
                <p className="text-gray-400 text-sm">Proprietary AI analyzes attention patterns on cookie.fun, Kaito yaps to maximize mindshare</p>
                          </div>
              <div className="glass p-6 rounded-xl">
                <SparklesIcon className="h-8 w-8 text-blue-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">Precision Synthesis</h3>
                <p className="text-gray-400 text-sm">AI agents create content scientifically engineered to dominate attention economy platforms</p>
                          </div>
              <div className="glass p-6 rounded-xl">
                <TrophyIcon className="h-8 w-8 text-yellow-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">Passive Income</h3>
                <p className="text-gray-400 text-sm">Earn ROAST tokens while your AI generates viral content that captures mindshare</p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="text-3xl font-black text-orange-500 mb-1">24/7</div>
                <div className="text-gray-400 text-sm">Autonomous Mining</div>
          </div>
              <div className="text-center">
                <div className="text-3xl font-black text-blue-500 mb-1">5X</div>
                <div className="text-gray-400 text-sm">Faster Than Manual</div>
                  </div>
              <div className="text-center">
                <div className="text-3xl font-black text-green-500 mb-1">$0.01</div>
                <div className="text-gray-400 text-sm">Avg Gas Fee</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-purple-500 mb-1">AI</div>
                <div className="text-gray-400 text-sm">Multi-Modal</div>
              </div>
                  </div>

            {/* Connection Flow */}
            <div className="glass p-8 rounded-2xl max-w-lg mx-auto mb-12">
              <h3 className="text-2xl font-bold text-white mb-6">Start Mining in 3 Steps</h3>
              <div className="space-y-4 text-left">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
                  <span className="text-gray-300">Connect your wallet (MetaMask, Phantom, etc.)</span>
                  </div>
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
                  <span className="text-gray-300">Connect Twitter for AI personalization</span>
                  </div>
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
                  <span className="text-gray-300">Deploy AI agents and start earning</span>
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
              <p className="text-gray-400 text-sm mb-4">
                🔐 Secure wallet authentication • 🌐 Base Network • 💰 ROAST Rewards
              </p>
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
                        🚀 Start Mining Now
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
            </div>
          </div>
            </div>
      </main>

      {/* Attention Economy Intelligence Section */}
      <section className="py-20 bg-gradient-to-r from-orange-900/20 to-red-900/20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Master the <span className="gradient-text">Attention Economy</span>
          </h2>
          <p className="text-xl text-gray-300 mb-12 max-w-4xl mx-auto">
            While others guess, we <strong>know</strong>. Our proprietary algorithms decode the mindshare mechanics 
            of cookie.fun, Kaito yaps, and emerging attention platforms to engineer viral content.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="glass p-8 rounded-xl">
              <div className="text-3xl mb-4">🧠</div>
              <h3 className="text-xl font-bold text-white mb-4">Platform Intelligence</h3>
              <p className="text-gray-300">
                Deep analysis of viral patterns, trending mechanisms, and engagement drivers across 
                cookie.fun, Kaito yaps, and other mindshare platforms.
              </p>
            </div>
            
            <div className="glass p-8 rounded-xl">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-xl font-bold text-white mb-4">Precision Targeting</h3>
              <p className="text-gray-300">
                AI agents synthesize content with surgical precision, maximizing mindshare capture 
                using proprietary models trained on attention economy data.
              </p>
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