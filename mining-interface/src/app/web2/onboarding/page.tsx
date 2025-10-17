'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BoltIcon, CheckCircleIcon } from '@heroicons/react/24/solid'

export default function Web2OnboardingPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [accountData, setAccountData] = useState<any>(null)

  useEffect(() => {
    // Check if user is authenticated
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')

    if (!web2Auth || !accountId) {
      // Not authenticated, redirect to auth page
      router.push('/web2/auth')
      return
    }

    // Fetch account data
    const fetchAccountData = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-auth/me`,
          {
            headers: {
              'Authorization': `Bearer ${web2Auth}`
            }
          }
        )

        if (response.ok) {
          const data = await response.json()
          setAccountData(data.data)
        } else {
          const errorData = await response.json()
          
          // Check if reconnection is required
          if (errorData.requiresReconnect) {
            console.log('Twitter connection missing or expired, redirecting to reconnect...')
            // Clear tokens and redirect to auth
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            router.push('/web2/auth')
          } else if (errorData.requiresAuth) {
            // Token completely invalid, redirect to auth
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            router.push('/web2/auth')
          } else {
            // Other error
            console.error('Error fetching account:', errorData.error)
            router.push('/web2/auth')
          }
        }
      } catch (error) {
        console.error('Error fetching account data:', error)
        router.push('/web2/auth')
      } finally {
        setIsLoading(false)
      }
    }

    fetchAccountData()
  }, [router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading your account...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-green-500/20 rounded-full">
              <CheckCircleIcon className="h-16 w-16 text-green-400" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Welcome to BURNIE! 🎉</h1>
          <p className="text-xl text-gray-300">
            Your account has been successfully created
          </p>
        </div>

        {/* Account Info */}
        {accountData && (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-6">
            <h2 className="text-xl font-bold text-white mb-4">Account Details</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Name:</span>
                <span className="text-white font-medium">{accountData.user?.full_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">𝕏 Username:</span>
                <span className="text-white font-medium">@{accountData.user?.twitter_username}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Account Type:</span>
                <span className="text-white font-medium capitalize">{accountData.user?.account?.account_type}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Role:</span>
                <span className="text-white font-medium capitalize">{accountData.user?.role}</span>
              </div>
            </div>
          </div>
        )}

        {/* Next Steps */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Next Steps</h2>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                1
              </div>
              <div>
                <p className="text-white font-medium">Complete Your Brand Profile</p>
                <p className="text-sm text-gray-400">Tell us about your brand, products, and target audience</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                2
              </div>
              <div>
                <p className="text-white font-medium">Connect Social Media Accounts</p>
                <p className="text-sm text-gray-400">Link LinkedIn, YouTube, and Instagram for multi-platform publishing</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                3
              </div>
              <div>
                <p className="text-white font-medium">Generate Your First Content</p>
                <p className="text-sm text-gray-400">Create AI-powered images and videos for your brand</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => {
              // Navigate to brand profile setup
              router.push('/web2/brand-profile')
            }}
            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105"
          >
            Complete Brand Profile →
          </button>
          
          <p className="text-gray-400 text-sm mt-4">
            This will take about 5 minutes
          </p>
        </div>
      </div>
    </div>
  )
}
