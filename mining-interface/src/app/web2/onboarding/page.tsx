'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BoltIcon, CheckCircleIcon } from '@heroicons/react/24/solid'

export default function Web2OnboardingPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [accountData, setAccountData] = useState<any>(null)
  const [accountType, setAccountType] = useState<'individual' | 'business'>('individual')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isMounted = true
    
    // Check if user is authenticated
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')

    if (!web2Auth || !accountId) {
      // Not authenticated, redirect to auth page
      if (isMounted) {
        router.push('/web2/auth')
      }
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
          // Set account type from fetched data
          setAccountType(data.data.user?.account?.account_type || 'individual')
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
    
    return () => {
      isMounted = false
    }
  }, []) // Empty dependency array to run only once

  const handleAccountTypeChange = async (newType: 'individual' | 'business') => {
    setAccountType(newType)
    setIsSaving(true)

    try {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const accountId = localStorage.getItem('burnie_web2_account_id')

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-accounts/${accountId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${web2Auth}`
          },
          body: JSON.stringify({
            account_type: newType
          })
        }
      )

      if (!response.ok) {
        console.error('Failed to update account type')
        // Revert on error
        setAccountType(accountData.user?.account?.account_type || 'individual')
      }
    } catch (error) {
      console.error('Error updating account type:', error)
      // Revert on error
      setAccountType(accountData.user?.account?.account_type || 'individual')
    } finally {
      setIsSaving(false)
    }
  }

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
                <div className="relative">
                  <select
                    value={accountType}
                    onChange={(e) => handleAccountTypeChange(e.target.value as 'individual' | 'business')}
                    disabled={isSaving}
                    className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500 appearance-none cursor-pointer pr-10"
                  >
                    <option value="individual" className="bg-gray-800">Individual</option>
                    <option value="business" className="bg-gray-800">Business</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
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
                <p className="text-white font-medium">Complete Your Account Profile</p>
                <p className="text-sm text-gray-400">Tell us about your account, products, and target audience</p>
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
                <p className="text-sm text-gray-400">Create AI-powered images and videos for your account</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => {
              // Navigate to account profile setup
              router.push('/web2/account-profile')
            }}
            className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105"
          >
            Complete Account Profile →
          </button>
          
          <p className="text-gray-400 text-sm mt-4">
            This will take about 5 minutes
          </p>
        </div>
      </div>
    </div>
  )
}
