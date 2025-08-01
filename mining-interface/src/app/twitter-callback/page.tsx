'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export default function TwitterCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const searchParams = useSearchParams()
  const callbackExecuted = useRef(false)

  useEffect(() => {
    // Prevent duplicate executions
    if (callbackExecuted.current) {
      return
    }
    callbackExecuted.current = true

    const handleCallback = async () => {
      try {
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        const error = searchParams.get('error')

        console.log('🔄 Processing Twitter OAuth callback...')
        console.log('📋 Callback params:', { code: !!code, state: !!state, error })

        if (error) {
          throw new Error(`Twitter OAuth error: ${error}`)
        }

        if (!code || !state) {
          throw new Error('Missing authorization code or state parameter')
        }

        // Get stored values from localStorage
        const storedState = localStorage.getItem('twitter_oauth_state')
        const codeVerifier = localStorage.getItem('twitter_code_verifier')
        const walletAddress = localStorage.getItem('burnie_auth_user')

        console.log('📋 Stored values:', { 
          hasStoredState: !!storedState, 
          hasCodeVerifier: !!codeVerifier, 
          hasWalletAddress: !!walletAddress 
        })

        // Verify state parameter
        if (state !== storedState) {
          throw new Error('Invalid state parameter - possible CSRF attack')
        }
        
        if (!walletAddress || !codeVerifier) {
          throw new Error('Missing required authentication data')
        }

        const userAddress = JSON.parse(walletAddress).address

        console.log('📤 Sending token exchange request to backend...')
        console.log('🔗 Backend URL:', `${process.env.NEXT_PUBLIC_BURNIE_API_URL}/twitter-auth/exchange-code`)

        // FIXED: Use correct endpoint and parameter names
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL}/twitter-auth/exchange-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            state,
            walletAddress: userAddress, // FIXED: was wallet_address
            codeVerifier: codeVerifier,  // FIXED: was code_verifier
          }),
        })

        console.log('📨 Response status:', response.status)
        console.log('📨 Response headers:', Object.fromEntries(response.headers.entries()))

        if (!response.ok) {
          const errorText = await response.text()
          console.error('❌ Backend error response:', errorText)
          throw new Error(`Backend error: ${response.status} - ${errorText}`)
        }

        const data = await response.json()
        console.log('✅ Backend response data:', data)

        if (!data.success) {
          throw new Error(data.error || 'Failed to complete Twitter authentication')
        }

        console.log('✅ Twitter authentication successful!')

        // Clean up localStorage
        localStorage.removeItem('twitter_oauth_state')
        localStorage.removeItem('twitter_code_verifier')

        setStatus('success')
        setMessage('Twitter account connected successfully!')

        // Notify parent window and close immediately
        if (window.opener) {
          console.log('📤 Sending success message to parent window...')
          window.opener.postMessage({ 
            type: 'TWITTER_AUTH_SUCCESS', 
            data: data.data 
          }, window.location.origin)
          
          // Close immediately after sending message to prevent race conditions
          setTimeout(() => {
            window.close()
          }, 100)
        } else {
          // If no opener, close after showing success briefly
          setTimeout(() => {
            window.close()
          }, 1500)
        }

      } catch (error) {
        console.error('❌ Twitter OAuth callback error:', error)
        setStatus('error')
        setMessage(error instanceof Error ? error.message : 'Unknown error occurred')

        // Clean up localStorage on error
        localStorage.removeItem('twitter_oauth_state')
        localStorage.removeItem('twitter_code_verifier')

        // Notify parent window of error
        if (window.opener) {
          console.log('📤 Sending error message to parent window...')
          window.opener.postMessage({ 
            type: 'TWITTER_AUTH_ERROR', 
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          }, window.location.origin)
          
          setTimeout(() => {
            window.close()
          }, 2000)
        }
      }
    }

    handleCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <div className="mb-6">
            {status === 'loading' && (
              <ArrowPathIcon className="h-16 w-16 text-blue-500 animate-spin mx-auto" />
            )}
            {status === 'success' && (
              <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto" />
            )}
            {status === 'error' && (
              <XCircleIcon className="h-16 w-16 text-red-500 mx-auto" />
            )}
          </div>

          <h2 className="text-2xl font-bold text-white mb-4">
            {status === 'loading' && 'Connecting Twitter...'}
            {status === 'success' && 'Success!'}
            {status === 'error' && 'Connection Failed'}
          </h2>

          <p className="text-gray-300 mb-6">
            {status === 'loading' && 'Authenticating your Twitter account...'}
            {message}
          </p>

          {status === 'loading' && (
            <div className="text-sm text-gray-400">
              This window will close automatically when complete.
            </div>
          )}

          {status === 'error' && (
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Close Window
            </button>
          )}
        </div>
      </div>
    </div>
  )
} 