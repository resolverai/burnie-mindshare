'use client'

import { useState, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { 
  XMarkIcon as TwitterIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline'
import { BoltIcon } from '@heroicons/react/24/solid'

interface TwitterConnectionProps {
  onConnected: () => void
}

export default function TwitterConnection({ onConnected }: TwitterConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const { address } = useAccount()
  const router = useRouter()
  const connectingRef = useRef(false)

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
      console.log('🔗 Starting Twitter OAuth flow for address:', address)

      // Step 1: Get Twitter OAuth URL from backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/twitter-auth/twitter/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (data.success && data.data.oauth_url) {
        console.log('✅ Got OAuth URL, opening popup...')
        
        // Store state, code verifier, and wallet address for later use
        localStorage.setItem('twitter_oauth_state', data.data.state)
        localStorage.setItem('twitter_code_verifier', data.data.code_verifier)
        localStorage.setItem('twitter_wallet_address', address || '')

        // Step 2: Open Twitter OAuth in a new window
        const authWindow = window.open(
          data.data.oauth_url,
          'twitter-auth',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        )

        // Step 3: Listen for messages from callback window
        let messageReceived = false
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            return // Ignore messages from other origins
          }

          if (event.data.type === 'TWITTER_AUTH_SUCCESS') {
            messageReceived = true
            console.log('✅ Received TWITTER_AUTH_SUCCESS message')
            window.removeEventListener('message', handleMessage)
            clearInterval(checkForClose)
            connectingRef.current = false
            setIsConnecting(false)
            onConnected() // Call the success callback
            
            // BACKUP: Direct navigation to dashboard after Twitter success
            setTimeout(() => {
              console.log('🚀 Twitter success - navigating to dashboard as backup')
              window.location.href = '/dashboard'
            }, 1000)
          } else if (event.data.type === 'TWITTER_AUTH_ERROR') {
            messageReceived = true
            console.log('❌ Received TWITTER_AUTH_ERROR message:', event.data.error)
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
            
            // Only check connection status if we didn't receive a message
            if (!messageReceived) {
              setTimeout(() => {
                checkTwitterConnection()
              }, 1000)
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

  const checkTwitterConnection = async () => {
    try {
      console.log('🔍 Checking Twitter connection status as fallback...')
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/twitter-auth/twitter/status/${address}`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data.connected) {
          // Twitter connection successful
          console.log('✅ Twitter connection verified via fallback check')
          connectingRef.current = false
          onConnected()
          return
        }
      }
      
      console.log('❌ Twitter connection verification failed')
      connectingRef.current = false
      setError('Twitter connection verification failed. Please try again.')
    } catch (error) {
      console.error('Error verifying Twitter connection:', error)
      connectingRef.current = false
      setError('Failed to verify Twitter connection.')
    }
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
          <h1 className="text-3xl font-bold text-white mb-2">Connect Twitter Account</h1>
          <p className="text-gray-400">
            Connect your Twitter/X account to start content mining with personalized AI agents
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
            
            <h3 className="text-xl font-semibold text-white mb-2">Twitter/X Integration</h3>
            <p className="text-sm text-gray-400 mb-6">
              Your AI agents will learn from your Twitter style and preferences to create personalized content
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
              className="w-full flex items-center justify-center space-x-3 bg-black hover:bg-gray-900 text-white py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <TwitterIcon className="h-5 w-5" />
                  <span>Connect with Twitter/X</span>
                  <ArrowRightIcon className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Benefits */}
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">Personalized Content Generation</p>
              <p className="text-xs text-gray-400">AI learns your writing style and preferences</p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">Content Performance Optimization</p>
              <p className="text-xs text-gray-400">Analyze what works best for your audience</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white font-medium">Secure & Private</p>
              <p className="text-xs text-gray-400">We only access public tweets for training</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-gray-500">
            By connecting Twitter, you agree to our terms of service and privacy policy
          </p>
        </div>
      </div>
    </div>
  )
} 