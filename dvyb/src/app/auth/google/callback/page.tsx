'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { authApi } from '@/lib/api'
import { Loader2, XCircle } from 'lucide-react'

function DvybGoogleCallbackContent() {
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
        
        console.log('📍 Google callback page loaded')
        console.log('   - code:', code ? code.substring(0, 10) + '...' : 'MISSING')
        console.log('   - state:', state || 'MISSING')
        console.log('   - window.opener:', window.opener ? 'EXISTS' : 'NULL')
        console.log('   - origin:', window.location.origin)
        
        if (!code || !state) {
          throw new Error('Missing code or state')
        }
        
        console.log('📡 Calling backend callback endpoint...')
        
        // Call the callback endpoint
        const response = await authApi.handleGoogleCallback(code, state)
        
        console.log('📥 Backend response:', JSON.stringify(response, null, 2))
        
        if (!response.success) {
          const errorMsg = ('error' in response ? response.error : undefined) || 'Callback failed'
          console.error('❌ Backend returned success: false -', errorMsg)
          throw new Error(String(errorMsg))
        }
        
        console.log('✅ Backend callback successful!')
        console.log('   - account_id:', response.data?.account_id)
        console.log('   - account_name:', response.data?.account_name)
        console.log('   - email:', response.data?.email)
        console.log('   - is_new_account:', response.data?.is_new_account)
        console.log('   - onboarding_complete:', response.data?.onboarding_complete)
        
        setStatus('Connected! Redirecting...')
        
        // ALWAYS store auth result in localStorage first (Safari doesn't reliably deliver postMessage)
        const authResult = {
          type: 'DVYB_GOOGLE_AUTH_SUCCESS',
          account_id: response.data?.account_id,
          account_name: response.data?.account_name,
          email: response.data?.email,
          is_new_account: response.data?.is_new_account,
          onboarding_complete: response.data?.onboarding_complete,
          timestamp: Date.now()
        };
        
        try {
          localStorage.setItem('dvyb_auth_result', JSON.stringify(authResult));
          console.log('✅ Auth result stored in localStorage');
        } catch (storageError) {
          console.error('❌ Failed to store in localStorage:', storageError);
        }
        
        // Also try to send via postMessage (works in Chrome/Firefox)
        if (window.opener) {
          console.log('📤 Sending success message to parent window...')
          try {
            window.opener.postMessage(authResult, window.location.origin)
            console.log('✅ Message sent to parent')
          } catch (msgError) {
            console.error('❌ Failed to send message to parent:', msgError)
          }
        } else {
          console.warn('⚠️ No window.opener - relying on localStorage fallback')
        }
        
        // Close window after a short delay
        console.log('⏳ Closing window in 1.2 seconds...')
        setTimeout(() => window.close(), 1200)
      } catch (error: any) {
        console.error('❌ Google callback error:', error)
        console.error('   - Error message:', error?.message)
        console.error('   - Error stack:', error?.stack)
        setIsError(true)
        setStatus(error?.message || 'Authentication failed')
        
        // Send error message to parent window
        if (window.opener) {
          console.log('📤 Sending error message to parent window...')
          window.opener.postMessage({
            type: 'DVYB_GOOGLE_AUTH_ERROR',
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

export default function DvybGoogleCallbackPage() {
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
      <DvybGoogleCallbackContent />
    </Suspense>
  )
}

