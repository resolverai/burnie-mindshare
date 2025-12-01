'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { authApi } from '@/lib/api'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

function DvybTwitterCallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing authentication...')
  const [isError, setIsError] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const process = async () => {
      if (processingRef.current) return
      processingRef.current = true
      
      try {
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        
        if (!code || !state) {
          throw new Error('Missing code or state')
        }
        
        console.log('Processing Twitter callback...', { code: code.substring(0, 10) + '...', state })
        
        // Call the callback endpoint
        const response = await authApi.handleTwitterCallback(code, state)
        
        if (!response.success) {
          throw new Error(String(('error' in response ? response.error : undefined) || 'Callback failed'))
        }
        
        setStatus('Connected! Redirecting...')
        
        // Send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'DVYB_TWITTER_AUTH_SUCCESS',
            account_id: (response as any).data?.account_id,
            twitter_handle: (response as any).data?.twitter_handle,
            is_new_account: (response as any).data?.is_new_account,
            onboarding_complete: (response as any).data?.onboarding_complete
          }, window.location.origin)
        }
        
        // Close window after a short delay
        setTimeout(() => window.close(), 1200)
      } catch (error: any) {
        console.error('Twitter callback error:', error)
        setIsError(true)
        setStatus(error?.message || 'Authentication failed')
        
        // Send error message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'DVYB_TWITTER_AUTH_ERROR',
            message: error?.message || 'Authentication failed'
          }, window.location.origin)
        }
        
        // Close window after showing error
        setTimeout(() => window.close(), 2000)
      }
    }
    
    process()
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
        </div>
      </div>
    </div>
  )
}

export default function DvybTwitterCallbackPage() {
  return <DvybTwitterCallbackContent />
}
