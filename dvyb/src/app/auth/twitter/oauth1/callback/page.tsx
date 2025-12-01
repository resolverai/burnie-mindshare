'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, XCircle, CheckCircle } from 'lucide-react'
import { oauth1Api } from '@/lib/api'

function OAuth1CallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing OAuth1 authorization...')
  const [isError, setIsError] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const handleCallback = async () => {
      if (processingRef.current) return
      processingRef.current = true
      
      try {
        const oauthToken = searchParams.get('oauth_token')
        const oauthVerifier = searchParams.get('oauth_verifier')
        const denied = searchParams.get('denied')
        
        if (denied) {
          throw new Error('Authorization was denied')
        }
        
        if (!oauthToken || !oauthVerifier) {
          throw new Error('Missing OAuth parameters from Twitter callback')
        }
        
        // Get state and token secret from localStorage (stored by parent window)
        const storedState = localStorage.getItem('oauth1_state')
        const storedTokenSecret = localStorage.getItem('oauth1_token_secret')
        
        if (!storedState || !storedTokenSecret) {
          throw new Error('Missing OAuth1 state or token secret')
        }
        
        console.log('Processing OAuth1 callback...', { 
          oauthToken: oauthToken.substring(0, 10) + '...',
          oauthVerifier: oauthVerifier.substring(0, 10) + '...',
          state: storedState.substring(0, 10) + '...'
        })
        
        // Call the backend to complete OAuth1 flow
        const response = await oauth1Api.handleOAuth1Callback({
          oauthToken,
          oauthVerifier,
          state: storedState,
          oauthTokenSecret: storedTokenSecret,
        })
        
        if (!response.success) {
          throw new Error(String(('error' in response ? response.error : undefined) || 'Callback failed'))
        }
        
        setStatus('OAuth1 authorization successful!')
        setIsSuccess(true)
        
        // Clean up localStorage
        localStorage.removeItem('oauth1_state')
        localStorage.removeItem('oauth1_token_secret')
        
        // Send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'oauth1_success',
            screenName: response.data?.screenName,
          }, window.location.origin)
        }
        
        // Close window after a short delay
        setTimeout(() => window.close(), 1500)
      } catch (error: any) {
        console.error('OAuth1 callback error:', error)
        setIsError(true)
        setStatus(error?.message || 'OAuth1 authorization failed')
        
        // Send error message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'oauth1_error',
            message: error?.message || 'OAuth1 authorization failed'
          }, window.location.origin)
        }
        
        // Close window after showing error
        setTimeout(() => window.close(), 3000)
      }
    }
    
    handleCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
      <div className={`p-6 md:p-8 rounded-lg border ${
        isError 
          ? 'bg-destructive/10 border-destructive/20' 
          : isSuccess
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
      }`}>
        <div className="flex flex-col items-center space-y-4">
          {isError ? (
            <XCircle className="w-12 h-12 md:w-16 md:h-16 text-destructive" />
          ) : isSuccess ? (
            <CheckCircle className="w-12 h-12 md:w-16 md:h-16 text-green-600" />
          ) : (
            <Loader2 className="w-12 h-12 md:w-16 md:h-16 animate-spin text-primary" />
          )}
          <p className={`text-sm md:text-base text-center ${
            isError ? 'text-destructive' : isSuccess ? 'text-green-700 dark:text-green-400' : 'text-foreground'
          }`}>
            {status}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function OAuth1CallbackPage() {
  return <OAuth1CallbackContent />
}

