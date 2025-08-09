'use client'

import { useState, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'

interface YapperTwitterConnectionProps {
  onConnected?: () => void
}

export default function YapperTwitterConnection({ onConnected }: YapperTwitterConnectionProps) {
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
      console.log('🔗 Starting Twitter OAuth flow for Yapper address:', address)

      // Step 1: Get Twitter OAuth URL from backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/url`, {
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
        console.log('🔗 Got OAuth URL, opening Twitter auth window...')
        
        // Store state, code verifier, and wallet address for later use
        localStorage.setItem('yapper_twitter_oauth_state', data.data.state)
        localStorage.setItem('yapper_twitter_code_verifier', data.data.code_verifier)
        localStorage.setItem('yapper_twitter_wallet_address', address || '')

        // Step 2: Open Twitter OAuth in a new window
        const authWindow = window.open(
          data.data.oauth_url,
          'yapper-twitter-auth',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        )

        if (!authWindow) {
          throw new Error('Failed to open authentication window. Please disable popup blocker.')
        }

        // Step 3: Listen for messages from callback window
        const messageHandler = (event: MessageEvent) => {
          // Only accept messages from our domain for security
          if (event.origin !== window.location.origin) {
            console.log('⚠️ Ignoring message from foreign origin:', event.origin)
            return
          }

          if (event.data.type === 'YAPPER_TWITTER_AUTH_SUCCESS') {
            console.log('✅ Yapper Twitter authentication successful!')
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            
            // Clean up state
            setIsConnecting(false)
            connectingRef.current = false
            
            // Call success callback
            if (onConnected) {
              onConnected()
            }
            
            // Reload the page to refresh the dashboard
            window.location.reload()
            
          } else if (event.data.type === 'YAPPER_TWITTER_AUTH_ERROR') {
            console.error('❌ Yapper Twitter authentication failed:', event.data.error)
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            setError(event.data.error || 'Twitter authentication failed')
            setIsConnecting(false)
            connectingRef.current = false
          }
        }

        window.addEventListener('message', messageHandler)

        // Handle window closed manually
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            if (isConnecting) {
              setError('Authentication window was closed')
              setIsConnecting(false)
              connectingRef.current = false
            }
          }
        }, 1000)

      } else {
        throw new Error('Invalid OAuth URL response')
      }

    } catch (error: any) {
      console.error('❌ Failed to start Yapper Twitter OAuth:', error)
      setError(error.message || 'Failed to connect Twitter account')
      setIsConnecting(false)
      connectingRef.current = false
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full mx-auto">
        <div className="bg-white shadow-lg rounded-lg p-8 text-center">
          {/* Twitter Icon */}
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
              </svg>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect Twitter Account</h2>
          <p className="text-gray-600 mb-6">
            Connect your Twitter account to access the Yapper platform and participate in content creation and bidding.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <button
            onClick={handleTwitterConnect}
            disabled={isConnecting || !address}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
          >
            {isConnecting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                </svg>
                <span>Connect Twitter</span>
              </>
            )}
          </button>

          <div className="mt-4 text-sm text-gray-500">
            <p>You'll be redirected to Twitter to authorize the connection.</p>
            <p className="mt-1">Your Twitter data will be used to enhance your Yapper experience.</p>
          </div>
        </div>
      </div>
    </div>
  )
} 