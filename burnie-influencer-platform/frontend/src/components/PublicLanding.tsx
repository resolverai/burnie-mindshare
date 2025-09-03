'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import WalletDisplay from './WalletDisplay'
import { analyticsApi } from '@/services/api'
import { 
  FireIcon, 
  ChartBarIcon, 
  UsersIcon, 
  CpuChipIcon,
  SparklesIcon,
  TrophyIcon,
  RocketLaunchIcon,
  BoltIcon,
  MegaphoneIcon,
  EyeIcon,
  ArrowTrendingUpIcon,
  WalletIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  CurrencyDollarIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'

export default function PublicLanding() {
  const { isAuthenticated, needsSignature, signIn, error } = useAuth()

  // Analytics data
  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: analyticsApi.getDashboard,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <BoltIcon className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Burnie</h1>
            </div>
            <nav className="flex items-center space-x-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">Features</a>
              <a href="#marketplace" className="text-gray-600 hover:text-gray-900 transition-colors">Marketplace</a>
              <a href="/admin" className="text-gray-600 hover:text-gray-900 transition-colors">Admin</a>
              <WalletDisplay />
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-20 pb-32 bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-5xl mx-auto">
            {/* Live indicator */}
            <div className="flex justify-center mb-6">
              <div className="flex items-center space-x-2 px-4 py-2 bg-green-100 border border-green-200 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-green-700 font-medium">Content Marketplace Live</span>
              </div>
            </div>

            <h1 className="text-5xl md:text-7xl font-black text-gray-900 mb-6">
              <span className="gradient-text">AI-Powered</span><br />
              Content Marketplace<br />
              for <span className="gradient-text">Yappers</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-600 mb-8 max-w-4xl mx-auto">
              Bid on premium AI-generated content, amplify your reach across attention economy platforms, 
              and earn mindshare rewards. Where yappers meet cutting-edge AI content generation.
            </p>

            {/* Value propositions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-4xl mx-auto">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <MegaphoneIcon className="h-8 w-8 text-orange-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">Premium Content Bidding</h3>
                <p className="text-gray-600 text-sm">Access AI-generated content optimized for viral performance and engagement</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <ArrowTrendingUpIcon className="h-8 w-8 text-blue-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">Mindshare Analytics</h3>
                <p className="text-gray-600 text-sm">Real-time tracking of your influence and content performance metrics</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <CurrencyDollarIcon className="h-8 w-8 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">ROAST Token Rewards</h3>
                <p className="text-gray-600 text-sm">Earn cryptocurrency rewards for successful content amplification</p>
              </div>
            </div>

            {/* Call to Action */}
            <div className="text-center mb-12">
              <WalletDisplay />
              
              <a
                href={process.env.NEXT_PUBLIC_MINING_INTERFACE_URL || 'http://localhost:3000'}
                className="btn-secondary text-lg px-8 py-4 ml-4"
              >
                Become Content Creator
              </a>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
              <div className="text-center">
                <div className="text-3xl font-bold text-orange-600 mb-2">
                  {analytics?.total_submissions || '2,847'}
                </div>
                <div className="text-gray-600">Active Yappers</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 mb-2">
                  {analytics?.active_campaigns || '156'}
                </div>
                <div className="text-gray-600">Live Campaigns</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 mb-2">
                  {analytics?.total_rewards_distributed || '₹4.2M'}
                </div>
                <div className="text-gray-600">Total Rewards</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 mb-2">
                  24/7
                </div>
                <div className="text-gray-600">AI Content Generation</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">How Burnie Works</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              The complete ecosystem for AI-powered content amplification and mindshare generation
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <WalletIcon className="h-8 w-8 text-orange-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">1. Connect & Authenticate</h3>
              <p className="text-gray-600">Connect your Web3 wallet with secure message signing</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <EyeIcon className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">2. Browse AI Content</h3>
              <p className="text-gray-600">Explore marketplace of AI-generated content optimized for engagement</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CurrencyDollarIcon className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">3. Bid & Purchase</h3>
              <p className="text-gray-600">Bid on premium content using ROAST tokens or USDC</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrophyIcon className="h-8 w-8 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">4. Amplify & Earn</h3>
              <p className="text-gray-600">Share content and earn rewards based on performance</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content Marketplace Preview */}
      <section id="marketplace" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              AI Content <span className="gradient-text">Marketplace</span>
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Premium content generated by 5-agent AI constellations, trained on viral patterns and optimized for maximum engagement
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: SparklesIcon,
                title: 'Viral Text Content',
                description: 'AI-generated posts optimized for Twitter, Reddit, and other social platforms',
                price: '50 ROAST',
                engagement: '95%'
              },
              {
                icon: CpuChipIcon,
                title: 'Visual Memes',
                description: 'Custom memes and graphics designed for maximum shareability',
                price: '75 ROAST',
                engagement: '87%'
              },
              {
                icon: RocketLaunchIcon,
                title: 'Video Content',
                description: 'Short-form videos optimized for TikTok, Instagram, and YouTube Shorts',
                price: '150 ROAST',
                engagement: '92%'
              }
            ].map((item, index) => {
              const Icon = item.icon
              return (
                <div key={index} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all">
                  <Icon className="h-8 w-8 text-orange-500 mb-4" />
                  <h3 className="text-lg font-bold text-gray-900 mb-3">{item.title}</h3>
                  <p className="text-gray-600 text-sm mb-4">{item.description}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-green-600 font-semibold">{item.price}</span>
                    <span className="text-blue-600 text-sm">{item.engagement} avg engagement</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Why Choose Burnie */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Why Choose <span className="gradient-text">Burnie</span>?
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              The only platform that combines AI content generation with attention economy infrastructure
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: ChartBarIcon,
                title: 'Data-Driven Content',
                description: 'AI analyzes viral patterns and engagement metrics to create high-performing content'
              },
              {
                icon: GlobeAltIcon,
                title: 'Multi-Platform Optimization',
                description: 'Content optimized for cookie.fun, yaps.kaito.ai, yap.market and more'
              },
              {
                icon: BoltIcon,
                title: 'Base Network Speed',
                description: 'Lightning-fast transactions with minimal fees on Coinbase L2'
              },
              {
                icon: TrophyIcon,
                title: 'Performance Rewards',
                description: 'Earn more for content that generates higher engagement and mindshare'
              },
              {
                icon: UsersIcon,
                title: 'Creator Economy',
                description: 'Direct connection between content creators and amplifiers'
              },
              {
                icon: FireIcon,
                title: 'Real-Time Analytics',
                description: 'Track mindshare, engagement, and earning potential in real-time'
              }
            ].map((feature, index) => {
              const Icon = feature.icon
              return (
                <div key={index} className="text-center p-6">
                  <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">{feature.title}</h3>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-3 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                <BoltIcon className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text">Burnie</span>
            </div>
            <p className="text-gray-400 text-sm max-w-2xl mx-auto">
              The premier marketplace for AI-powered content amplification and mindshare generation. 
              Built on Base Network. Powered by AI.
            </p>
            <div className="mt-6 text-xs text-gray-500">
              © 2024 Burnie. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
} 