'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, XCircle } from 'lucide-react'
import { socialConnectionsApi } from '@/lib/api'
import { getOAuthFlowState, updateOAuthFlowState, getOAuthReturnUrl } from '@/lib/oauthFlowState'

function LinkedInCallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing LinkedIn connection...')
  const [isError, setIsError] = useState(false)
  const [showRetry, setShowRetry] = useState(false)
  const processingRef = useRef(false)

  const handleRetry = () => {
    const returnUrl = localStorage.getItem('dvyb_oauth_return_url') || '/home'
    window.location.href = returnUrl
  }

  useEffect(() => {
    const handleCallback = async () => {
      if (processingRef.current) return
      processingRef.current = true
      
      try {
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        const error = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')
        
        if (error) {
          throw new Error(errorDescription || error || 'LinkedIn authorization failed')
        }
        
        if (!code || !state) {
          throw new Error('Missing code or state from LinkedIn callback')
        }
        
        console.log('Processing LinkedIn callback...', { code: code.substring(0, 10) + '...', state })
        
        // Call the backend to complete LinkedIn connection
        const response = await socialConnectionsApi.handleLinkedInConnectCallback(code, state)
        
        if (!response.success) {
          throw new Error(String(('error' in response ? response.error : undefined) || 'Callback failed'))
        }
        
        setStatus('LinkedIn connected! Redirecting...')
        
        // Check if this is part of a post flow
        const flowState = getOAuthFlowState()
        
        if (flowState) {
          console.log('📋 OAuth post flow detected, updating state...')
          
          // ALWAYS increment index to mark this platform as done
          const currentIndex = flowState.currentPlatformIndex
          const nextIndex = currentIndex + 1
          
          // Always update the index so dialog knows this platform is complete
          updateOAuthFlowState({ currentPlatformIndex: nextIndex })
          
          if (nextIndex < flowState.platformsToAuth.length) {
            // More platforms need auth
            const nextPlatform = flowState.platformsToAuth[nextIndex]
            
            localStorage.setItem('dvyb_oauth_success', JSON.stringify({
              platform: 'linkedin',
              message: 'LinkedIn connected! Connecting next platform...',
              nextPlatform: nextPlatform,
              timestamp: Date.now()
            }))
          } else {
            // All OAuth2 platforms done
            localStorage.setItem('dvyb_oauth_success', JSON.stringify({
              platform: 'linkedin',
              message: 'LinkedIn connected successfully!',
              allOAuth2Complete: true,
              timestamp: Date.now()
            }))
          }
          
          // Redirect to source page - dialog will resume flow
          const returnUrl = getOAuthReturnUrl()
          console.log('🚀 Redirecting to', returnUrl, 'for flow continuation...')
          setTimeout(() => {
            window.location.href = returnUrl
          }, 500)
          return
        }
        
        // Not a post flow - regular connection
        const returnUrl = localStorage.getItem('dvyb_oauth_return_url') || '/home'
        
        // Clean up
        localStorage.removeItem('dvyb_oauth_return_url')
        localStorage.removeItem('dvyb_oauth_platform')
        
        // Store success flag for the return page to show toast
        localStorage.setItem('dvyb_oauth_success', JSON.stringify({
          platform: 'linkedin',
          message: 'LinkedIn connected successfully',
          timestamp: Date.now()
        }))
        
        // Redirect back to the return URL
        console.log('🚀 Redirecting to:', returnUrl)
        setTimeout(() => {
          window.location.href = returnUrl
        }, 800)
      } catch (error: any) {
        console.error('LinkedIn callback error:', error)
        setIsError(true)
        
        const errorMsg = error?.message || 'LinkedIn connection failed'
        if (errorMsg.includes('expired') || errorMsg.includes('Invalid') || errorMsg.includes('state')) {
          setStatus('Your authorization session expired. Please try again.')
          setShowRetry(true)
        } else {
          setStatus(errorMsg)
          // Redirect back after showing error
          const returnUrl = localStorage.getItem('dvyb_oauth_return_url') || '/home'
          setTimeout(() => {
            window.location.href = returnUrl
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
          : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
      }`}>
        <div className="flex flex-col items-center space-y-4">
          {isError ? (
            <XCircle className="w-12 h-12 md:w-16 md:h-16 text-destructive" />
          ) : (
            <Loader2 className="w-12 h-12 md:w-16 md:h-16 animate-spin text-primary" />
          )}
          <p className={`text-sm md:text-base text-center ${
            isError ? 'text-destructive' : 'text-foreground'
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

export default function LinkedInCallbackPage() {
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
      <LinkedInCallbackContent />
    </Suspense>
  )
}
