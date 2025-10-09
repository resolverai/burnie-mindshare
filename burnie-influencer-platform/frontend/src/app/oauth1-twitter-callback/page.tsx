'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

function OAuth1TwitterCallbackPageContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing OAuth 1.0a Twitter authentication...')
  const [isError, setIsError] = useState(false)

  const processingRef = useRef(false)

  useEffect(() => {
    const processCallback = async () => {
      // Prevent multiple executions
      if (processingRef.current) {
        console.log('⏭️ OAuth 1.0a callback already processing, skipping...')
        return
      }
      
      processingRef.current = true
      
      try {
        console.log('🔄 Processing OAuth 1.0a Twitter callback...')
        
        // Extract OAuth 1.0a parameters from URL
        const oauthToken = searchParams?.get('oauth_token')
        const oauthVerifier = searchParams?.get('oauth_verifier')
        const denied = searchParams?.get('denied')

        if (denied) {
          console.error('❌ OAuth 1.0a Twitter authorization denied')
          setStatus('Twitter authorization was denied')
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH1_TWITTER_AUTH_ERROR',
              error: 'Authorization denied by user'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        if (!oauthToken || !oauthVerifier) {
          console.error('❌ Missing OAuth 1.0a parameters:', { oauthToken, oauthVerifier })
          setStatus('Invalid OAuth 1.0a callback parameters')
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH1_TWITTER_AUTH_ERROR',
              error: 'Missing OAuth parameters'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        // Get stored session ID from localStorage
        const sessionId = localStorage.getItem('oauth1_session_id')

        if (!sessionId) {
          console.error('❌ Missing OAuth 1.0a session ID')
          setStatus('Missing authentication session data')
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH1_TWITTER_AUTH_ERROR',
              error: 'Missing session data'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        setStatus('Exchanging OAuth tokens...')

        // Step 2: Exchange verifier for access tokens
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/auth/twitter/oauth1/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: sessionId,
            oauthToken: oauthToken,
            oauthVerifier: oauthVerifier
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('❌ OAuth 1.0a callback failed:', response.status, errorText)
          throw new Error(`OAuth callback failed: ${response.status}`)
        }

        const data = await response.json()
        
        if (!data.success) {
          console.error('❌ OAuth 1.0a callback unsuccessful:', data.message)
          throw new Error(data.message || 'OAuth callback unsuccessful')
        }

        console.log('✅ OAuth 1.0a authentication successful!')
        setStatus('OAuth 1.0a authentication successful! You can now upload videos to Twitter.')

        // Clean up localStorage
        localStorage.removeItem('oauth1_session_id')

        // Send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'OAUTH1_TWITTER_AUTH_SUCCESS',
            data: data.data
          }, window.location.origin)
        }

        // Close popup after delay
        setTimeout(() => window.close(), 2000)

      } catch (error: any) {
        console.error('❌ OAuth 1.0a callback processing error:', error)
        setStatus(`Authentication failed: ${error.message}`)
        setIsError(true)
        
        // Send error message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'OAUTH1_TWITTER_AUTH_ERROR',
            error: error.message || 'Authentication processing failed'
          }, window.location.origin)
        }
        
        // Close popup after delay
        setTimeout(() => window.close(), 5000)
      }
    }

    processCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-center">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500 flex items-center justify-center">
            {isError ? (
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
          </div>
          <h1 className="text-xl font-bold text-white mb-2">
            {isError ? 'Authentication Failed' : 'Authenticating...'}
          </h1>
          <p className={`text-sm ${isError ? 'text-red-400' : 'text-gray-300'}`}>
            {status}
          </p>
        </div>
        
        {isError && (
          <div className="text-xs text-gray-500">
            This window will close automatically in a few seconds.
          </div>
        )}
      </div>
    </div>
  )
}

export default function OAuth1TwitterCallbackPage() {
  return (
    <div>
      <OAuth1TwitterCallbackPageContent />
    </div>
  )
}
