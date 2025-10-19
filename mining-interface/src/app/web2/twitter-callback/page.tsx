'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

function Web2TwitterCallbackPageContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing 𝕏 authentication...')
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
        console.log('🔄 Processing Web2 Twitter OAuth callback...')
        
        // Extract OAuth parameters from URL
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        const error = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')

        if (error) {
          console.error('❌ Twitter OAuth error:', error, errorDescription)
          setStatus(`𝕏 authorization failed: ${errorDescription || error}`)
          setIsError(true)
          
          // Send error message to parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'WEB2_TWITTER_AUTH_ERROR',
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
              type: 'WEB2_TWITTER_AUTH_ERROR',
              error: 'Missing authorization parameters'
            }, window.location.origin)
          }
          
          // Close popup after delay
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('✅ Got OAuth parameters:', { code: code.substring(0, 10) + '...', state })
        
        // Get stored state and code_challenge from localStorage of parent window
        const storedState = window.opener?.localStorage.getItem('web2_twitter_oauth_state')
        const codeChallenge = window.opener?.localStorage.getItem('web2_twitter_code_challenge')

        if (!storedState || !codeChallenge) {
          console.error('❌ Missing stored OAuth data:', { hasState: !!storedState, hasCodeChallenge: !!codeChallenge })
          setStatus('Missing stored authentication data')
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'WEB2_TWITTER_AUTH_ERROR',
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
              type: 'WEB2_TWITTER_AUTH_ERROR',
              error: 'Authentication state mismatch'
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        console.log('🔄 Exchanging code for tokens...')
        setStatus('Exchanging authorization code...')

        // Send the code to backend to complete OAuth flow
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-auth/twitter/callback?code=${code}&state=${state}&code_verifier=${codeChallenge}`, {
          method: 'GET',
          credentials: 'include', // Important for session cookies if using them
        })

        if (!response.ok) {
          const errorData = await response.text()
          console.error('❌ Backend callback failed:', response.status, errorData)
          setStatus(`Authentication failed: ${response.status}`)
          setIsError(true)
          
          if (window.opener) {
            window.opener.postMessage({
              type: 'WEB2_TWITTER_AUTH_ERROR',
              error: `Authentication failed: ${response.status}`
            }, window.location.origin)
          }
          
          setTimeout(() => window.close(), 3000)
          return
        }

        const result = await response.json()
        console.log('✅ Web2 Twitter OAuth successful:', result)
        
        setStatus('𝕏 connected successfully! Closing window...')
        
        // Clean up stored OAuth data
        if (window.opener) {
          window.opener.localStorage.removeItem('web2_twitter_oauth_state')
          window.opener.localStorage.removeItem('web2_twitter_code_challenge')
          
          // Send success message to parent window with token and account info
          window.opener.postMessage({
            type: 'WEB2_TWITTER_AUTH_SUCCESS',
            token: result.token,
            accountId: result.accountId,
            username: result.username || result.data?.user?.username,
            hasCompletedProfile: result.hasCompletedProfile,
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
            type: 'WEB2_TWITTER_AUTH_ERROR',
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
          {isError ? 'Connection Failed' : 'Connecting 𝕏...'}
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

export default function Web2TwitterCallbackPage() {
  return <Web2TwitterCallbackPageContent />
}

