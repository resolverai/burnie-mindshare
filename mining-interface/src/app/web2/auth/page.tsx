'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  XMarkIcon as TwitterIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline'
import { BoltIcon } from '@heroicons/react/24/solid'

export default function Web2AuthPage() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const connectingRef = useRef(false)
  const redirectingRef = useRef(false)

  // Check if user has valid session
  useEffect(() => {
    let isMounted = true
    
    const checkSession = async () => {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const web2AccountId = localStorage.getItem('burnie_web2_account_id')
      const web2Username = localStorage.getItem('burnie_web2_username')
      
      if (!web2Auth || !web2AccountId) {
        return // No auth data, stay on auth page
      }
      
      // Verify session with backend
      try {
        const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
        const response = await fetch(`${apiUrl}/web2-auth/check-session?twitter_username=${encodeURIComponent(web2Username || '')}`)
        
        if (!isMounted) return // Component unmounted, don't proceed
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.hasValidSession) {
            // User has valid session, redirect to dashboard
            console.log('✅ Auth page: Valid Web2 session found, redirecting to dashboard')
            // Prevent multiple redirects
            if (!redirectingRef.current) {
              redirectingRef.current = true
              // Add a small delay to prevent race condition
              setTimeout(() => {
                if (isMounted) {
                  router.push('/web2/dashboard')
                }
              }, 100)
            }
            return
          }
        }
        
        // Invalid session, clear data
        if (isMounted) {
          localStorage.removeItem('burnie_web2_auth')
          localStorage.removeItem('burnie_web2_account_id')
          localStorage.removeItem('burnie_web2_username')
        }
      } catch (error) {
        console.error('Error checking session:', error)
        if (isMounted) {
          // Clear potentially corrupted auth data
          localStorage.removeItem('burnie_web2_auth')
          localStorage.removeItem('burnie_web2_account_id')
          localStorage.removeItem('burnie_web2_username')
        }
      }
    }
    
    checkSession()
    
    return () => {
      isMounted = false
    }
  }, []) // Empty dependency array to run only once

  // Cleanup function to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clean up any pending auth state
      connectingRef.current = false
    }
  }, [])

  const handleTwitterConnect = async () => {
    // Prevent multiple simultaneous connections
    if (connectingRef.current || isConnecting) {
      console.log('🚫 Twitter connection already in progress, ignoring...')
      return
    }

    connectingRef.current = true
    setIsConnecting(true)
    setError('')

    try {
      console.log('🔗 Starting Web2 Twitter OAuth flow...')

      // Step 1: Get Twitter OAuth URL from backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-auth/twitter/login`, {
        method: 'GET',
        credentials: 'include', // Important for session cookies if using them
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (data.success && data.data.oauth_url) {
        console.log('✅ Got OAuth URL, opening popup...')
        
        // Store state and code_challenge for later verification
        localStorage.setItem('web2_twitter_oauth_state', data.data.state)
        localStorage.setItem('web2_twitter_code_challenge', data.data.code_challenge)

        // Step 2: Open Twitter OAuth in a popup window (not redirect)
        const authWindow = window.open(
          data.data.oauth_url,
          'twitter-auth-web2',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        )

        // Step 3: Listen for messages from callback window
        let messageReceived = false
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            return // Ignore messages from other origins
          }

          if (event.data.type === 'WEB2_TWITTER_AUTH_SUCCESS') {
            messageReceived = true
            console.log('✅ Received WEB2_TWITTER_AUTH_SUCCESS message')
            window.removeEventListener('message', handleMessage)
            clearInterval(checkForClose)
            connectingRef.current = false
            setIsConnecting(false)
            
            // Store auth token and account info (separate from Web3)
            if (event.data.token) {
              localStorage.setItem('burnie_web2_auth', event.data.token)
            }
            if (event.data.accountId) {
              localStorage.setItem('burnie_web2_account_id', event.data.accountId)
            }
            if (event.data.username) {
              localStorage.setItem('burnie_web2_username', event.data.username)
            }
            
            // Check if user has completed profile
            const hasCompletedProfile = event.data.hasCompletedProfile || event.data.data?.hasCompletedProfile
            
            // Navigate based on profile completion status
            setTimeout(() => {
              if (hasCompletedProfile) {
                console.log('🚀 Returning user - navigating to dashboard')
                router.push('/web2/dashboard')
              } else {
                console.log('🚀 New user - navigating to onboarding')
                router.push('/web2/onboarding')
              }
            }, 500)
          } else if (event.data.type === 'WEB2_TWITTER_AUTH_ERROR') {
            messageReceived = true
            console.log('❌ Received WEB2_TWITTER_AUTH_ERROR message:', event.data.error)
            window.removeEventListener('message', handleMessage)
            clearInterval(checkForClose)
            connectingRef.current = false
            setIsConnecting(false)
            setError(event.data.error || 'Twitter authentication failed')
          }
        }

        window.addEventListener('message', handleMessage)

        // Check if window is closed manually (fallback)
        const checkForClose = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkForClose)
            window.removeEventListener('message', handleMessage)
            connectingRef.current = false
            setIsConnecting(false)
            
            // Only show error if we didn't receive a message
            if (!messageReceived) {
              setError('Authentication window was closed. Please try again.')
            }
          }
        }, 1000)

        // Auto-close after 5 minutes
        setTimeout(() => {
          if (authWindow && !authWindow.closed) {
            authWindow.close()
            clearInterval(checkForClose)
            window.removeEventListener('message', handleMessage)
            connectingRef.current = false
            setIsConnecting(false)
            setError('Authentication timed out. Please try again.')
          }
        }, 300000) // 5 minutes

      } else {
        throw new Error('Invalid response from auth endpoint')
      }
    } catch (error: any) {
      console.error('Twitter connection error:', error)
      connectingRef.current = false
      setIsConnecting(false)
      setError(error.message || 'Failed to connect Twitter account')
    }
  }

  const handleGoBack = () => {
    // Clear any temporary selection and go back to landing page
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
              <BoltIcon className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Sign in with 𝕏</h1>
          <p className="text-gray-400">
            Connect your 𝕏 (Twitter) account to start creating AI-powered content for your business
          </p>
        </div>

        {/* Connection Card */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 mb-6">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-black rounded-xl flex items-center justify-center">
                <TwitterIcon className="h-8 w-8 text-white" />
              </div>
            </div>
            
            <h3 className="text-xl font-semibold text-white mb-2">𝕏 Integration</h3>
            <p className="text-sm text-gray-400 mb-6">
              Your AI will learn your brand voice and create personalized content optimized for engagement
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center space-x-2">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={handleTwitterConnect}
              disabled={isConnecting}
              className="w-full flex items-center justify-center space-x-3 bg-black hover:bg-gray-900 text-white py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {isConnecting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <TwitterIcon className="h-5 w-5" />
                  <span>Sign in with 𝕏</span>
                  <ArrowRightIcon className="h-4 w-4" />
                </>
              )}
            </button>

            <button
              onClick={handleGoBack}
              disabled={isConnecting}
              className="w-full flex items-center justify-center space-x-2 text-gray-400 hover:text-white py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              <span>Back to Home</span>
            </button>
          </div>
        </div>

        {/* Benefits */}
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">AI-Powered Content Creation</p>
              <p className="text-xs text-gray-400">Generate images, videos, and text optimized for your brand</p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">Multi-Platform Publishing</p>
              <p className="text-xs text-gray-400">Post directly to 𝕏, LinkedIn, YouTube, and more</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">Brand Intelligence</p>
              <p className="text-xs text-gray-400">AI learns your style and maintains brand consistency</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-gray-500">
            By connecting 𝕏, you agree to our terms of service and privacy policy
          </p>
        </div>
      </div>
    </div>
  )
}
