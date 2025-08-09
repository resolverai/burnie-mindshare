'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

function YapperTwitterCallbackPageContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing Twitter authentication...')
  const [isError, setIsError] = useState(false)

  const processingRef = useRef(false)

  useEffect(() => {
    const processCallback = async () => {
      // Prevent multiple executions
      if (processingRef.current) {
        console.log('⏭️ Yapper callback already processing, skipping...')
        return
      }
      
      processingRef.current = true
      
      try {
        console.log('🔄 Processing Yapper Twitter OAuth callback...')
        
        // Extract OAuth parameters from URL
        const code = searchParams?.get('code')
        const state = searchParams?.get('state')
        const error = searchParams?.get('error')
        const errorDescription = searchParams?.get('error_description')

        if (error) {
          console.error('❌ Yapper Twitter OAuth error:', error, errorDescription)
          setStatus(`Twitter authorization failed: ${errorDescription || error}`)
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'YAPPER_TWITTER_AUTH_ERROR',
              error: errorDescription || error || 'Authorization failed'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        if (!code || !state) {
          console.error('❌ Missing required parameters:', { code: !!code, state: !!state })
          setStatus('Missing required authentication parameters')
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'YAPPER_TWITTER_AUTH_ERROR',
              error: 'Missing required authentication parameters'
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('📋 OAuth callback parameters:', { 
          code: code?.substring(0, 10) + '...', 
          state: state?.substring(0, 10) + '...' 
        })

        // Get stored OAuth data from localStorage
        const storedState = localStorage.getItem('yapper_twitter_oauth_state')
        const codeVerifier = localStorage.getItem('yapper_twitter_code_verifier')
        const walletAddress = localStorage.getItem('yapper_twitter_wallet_address')

        console.log('📦 Stored OAuth data:', {
          storedState: storedState?.substring(0, 10) + '...',
          codeVerifier: codeVerifier?.substring(0, 10) + '...',
          walletAddress
        })

        if (!storedState || !codeVerifier || !walletAddress) {
          console.error('❌ Missing stored OAuth data')
          setStatus('Missing stored authentication data')
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'YAPPER_TWITTER_AUTH_ERROR',
              error: 'Missing stored authentication data'
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        if (state !== storedState) {
          console.error('❌ State mismatch:', { received: state, expected: storedState })
          setStatus('Authentication state mismatch')
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'YAPPER_TWITTER_AUTH_ERROR',
              error: 'Authentication state mismatch'
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('🔄 Exchanging code for tokens...')
        setStatus('Exchanging authorization code...')

        // Send the code to backend to complete OAuth flow
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/exchange-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            state,
            walletAddress,
            codeVerifier
          })
        })

        if (!response.ok) {
          const errorData = await response.text()
          console.error('❌ Backend callback failed:', response.status, errorData)
          setStatus(`Authentication failed: ${response.status}`)
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'YAPPER_TWITTER_AUTH_ERROR',
              error: `Authentication failed: ${response.status}`
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        const result = await response.json()
        console.log('✅ Yapper Twitter OAuth successful:', result)
        
        setStatus('Twitter connected successfully! Closing window...')
        
        // Clean up stored OAuth data
        if (window.opener) {
          localStorage.removeItem('yapper_twitter_oauth_state')
          localStorage.removeItem('yapper_twitter_code_verifier')
          localStorage.removeItem('yapper_twitter_wallet_address')
          
          // Send success message to parent window
          window.opener.postMessage({
            type: 'YAPPER_TWITTER_AUTH_SUCCESS',
            data: result
          }, window.location.origin)
        }
        
        setTimeout(() => window.close(), 1500)

      } catch (error) {
        console.error('❌ OAuth callback processing failed:', error)
        setStatus('Failed to process authentication')
        setIsError(true)
        
        if (window.opener) {
          window.opener.postMessage({
            type: 'YAPPER_TWITTER_AUTH_ERROR',
            error: 'Failed to process authentication'
          }, window.location.origin)
        }
        
        setTimeout(() => window.close(), 3000)
      }
    }

    processCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4">
        <div className="text-center">
          {/* Icon */}
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
            {isError ? (
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            )}
          </div>
          
          {/* Status */}
          <h3 className={`text-lg font-medium ${isError ? 'text-red-900' : 'text-gray-900'} mb-2`}>
            {isError ? 'Authentication Failed' : 'Processing...'}
          </h3>
          
          <p className={`text-sm ${isError ? 'text-red-600' : 'text-gray-600'}`}>
            {status}
          </p>
          
          {isError && (
            <p className="text-xs text-gray-500 mt-2">
              This window will close automatically.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function YapperTwitterCallbackPage() {
  return (
    <YapperTwitterCallbackPageContent />
  )
} 