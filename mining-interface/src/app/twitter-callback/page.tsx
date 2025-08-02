'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

function TwitterCallbackPageContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing Twitter authentication...')
  const [isError, setIsError] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const processCallback = async () => {
      // Prevent multiple executions
      if (processingRef.current) {
        console.log('⏭️ Callback already processing, skipping...')
        return
      }
      
      processingRef.current = true
      
      try {
        console.log('🔄 Processing Twitter OAuth callback...')
        
        // Extract OAuth parameters from URL
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        const error = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')

        if (error) {
          console.error('❌ Twitter OAuth error:', error, errorDescription)
          setStatus(`Twitter authorization failed: ${errorDescription || error}`)
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'TWITTER_AUTH_ERROR',
              error: errorDescription || error || 'Authorization failed'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        if (!code || !state) {
          console.error('❌ Missing OAuth parameters:', { code: !!code, state: !!state })
          setStatus('Missing authorization parameters')
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'TWITTER_AUTH_ERROR',
              error: 'Missing authorization parameters'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('✅ Got OAuth parameters:', { code: code.substring(0, 10) + '...', state })
        
        // Get stored state, code_verifier, and wallet address from localStorage of parent window
        const storedState = window.opener?.localStorage.getItem('twitter_oauth_state')
        const codeVerifier = window.opener?.localStorage.getItem('twitter_code_verifier')
        const walletAddress = window.opener?.localStorage.getItem('twitter_wallet_address')

        if (!storedState || !codeVerifier || !walletAddress) {
          console.error('❌ Missing stored OAuth data:', { 
            hasState: !!storedState, 
            hasCodeVerifier: !!codeVerifier, 
            hasWalletAddress: !!walletAddress 
          })
          setStatus('Missing stored authentication data')
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'TWITTER_AUTH_ERROR',
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
              type: 'TWITTER_AUTH_ERROR',
              error: 'Authentication state mismatch'
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('🔄 Exchanging code for tokens...')
        setStatus('Exchanging authorization code...')

        // Send the code to backend to complete OAuth flow
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL}/twitter-auth/exchange-code`, {
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
              type: 'TWITTER_AUTH_ERROR',
              error: `Authentication failed: ${response.status}`
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        const result = await response.json()
        console.log('✅ Twitter OAuth successful:', result)
        
        setStatus('Twitter connected successfully! Closing window...')
        
        // Clean up stored OAuth data
        if (window.opener) {
          window.opener.localStorage.removeItem('twitter_oauth_state')
          window.opener.localStorage.removeItem('twitter_code_verifier')
          window.opener.localStorage.removeItem('twitter_wallet_address')
          
          // Send success message to parent window
          window.opener.postMessage({
            type: 'TWITTER_AUTH_SUCCESS',
            data: result
          }, window.location.origin)
        }
        
        // Close popup after short delay
        setTimeout(() => window.close(), 1500)

      } catch (error) {
        console.error('❌ Twitter callback error:', error)
        setStatus('An unexpected error occurred')
        setIsError(true)
        
        if (window.opener) {
          window.opener.postMessage({
            type: 'TWITTER_AUTH_ERROR',
            error: error instanceof Error ? error.message : 'Unexpected error'
          }, window.location.origin)
        }
        
        setTimeout(() => window.close(), 3000)
      } finally {
        processingRef.current = false
      }
    }

    processCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
      <div className="text-center">
        <h1 className={`text-2xl font-bold mb-4 ${isError ? 'text-red-400' : 'text-white'}`}>
          {isError ? 'Connection Failed' : 'Connecting Twitter...'}
        </h1>
        <p className={`${isError ? 'text-red-300' : 'text-gray-400'}`}>
          {status}
        </p>
        {!isError && (
          <div className="mt-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TwitterCallbackPage() {
  return <TwitterCallbackPageContent />
}
