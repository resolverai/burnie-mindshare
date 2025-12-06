'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, XCircle, CheckCircle } from 'lucide-react'
import { oauth1Api } from '@/lib/api'
import { getOAuthFlowState, updateOAuthFlowState, getOAuthReturnUrl } from '@/lib/oauthFlowState'

function OAuth1CallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing video authorization...')
  const [isError, setIsError] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [showRetry, setShowRetry] = useState(false)
  const processingRef = useRef(false)

  const handleRetry = () => {
    const returnUrl = getOAuthReturnUrl()
    window.location.href = returnUrl
  }

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
        
        // Get state and token secret from localStorage (stored before redirect)
        const storedState = localStorage.getItem('oauth1_state')
        const storedTokenSecret = localStorage.getItem('oauth1_token_secret')
        
        if (!storedState || !storedTokenSecret) {
          throw new Error('Session expired. Please try again.')
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
        
        setStatus('Video authorization complete! Redirecting...')
        setIsSuccess(true)
        
        // Clean up OAuth1 state
        localStorage.removeItem('oauth1_state')
        localStorage.removeItem('oauth1_token_secret')
        
        // Check if this is part of a post flow
        const flowState = getOAuthFlowState()
        
        if (flowState) {
          console.log('📋 OAuth post flow detected, marking OAuth1 complete...')
          
          // Mark OAuth1 as complete
          updateOAuthFlowState({ oauth1Completed: true })
          
          // Store success for toast
          localStorage.setItem('dvyb_oauth_success', JSON.stringify({
            platform: 'twitter',
            message: 'Video authorization complete! Ready to post.',
            oauth1Complete: true,
            allComplete: true,
            timestamp: Date.now()
          }))
          
          // Redirect to source page - dialog will resume and complete the post
          const returnUrl = getOAuthReturnUrl()
          console.log('🚀 Redirecting to', returnUrl, 'for flow completion...')
          setTimeout(() => {
            window.location.href = returnUrl
          }, 500)
          return
        }
        
        // Not part of a post flow - just store success and redirect
        localStorage.setItem('dvyb_oauth_success', JSON.stringify({
          platform: 'twitter',
          message: 'Video authorization complete!',
          oauth1Complete: true,
          timestamp: Date.now()
        }))
        
        const fallbackUrl = localStorage.getItem('dvyb_oauth_return_url') || '/home'
        localStorage.removeItem('dvyb_oauth_return_url')
        setTimeout(() => {
          window.location.href = fallbackUrl
        }, 800)
      } catch (error: any) {
        console.error('OAuth1 callback error:', error)
        setIsError(true)
        
        const errorMsg = error?.message || 'Video authorization failed'
        if (errorMsg.includes('expired') || errorMsg.includes('Session')) {
          setStatus('Your authorization session expired. Please try again.')
          setShowRetry(true)
        } else {
          setStatus(errorMsg)
          const errorReturnUrl = getOAuthReturnUrl()
          setTimeout(() => {
            window.location.href = errorReturnUrl
          }, 2000)
        }
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
          {showRetry && (
            <button
              onClick={handleRetry}
              className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm md:text-base font-medium"
            >
              Go Back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OAuth1CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <div className="p-6 md:p-8 rounded-lg border bg-card border-border">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-12 h-12 md:w-16 md:h-16 animate-spin text-primary" />
            <p className="text-sm md:text-base text-center text-foreground">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <OAuth1CallbackContent />
    </Suspense>
  )
}
