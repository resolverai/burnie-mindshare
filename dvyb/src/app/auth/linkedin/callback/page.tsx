'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, XCircle } from 'lucide-react'

function LinkedInCallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing authentication...')
  const [isError, setIsError] = useState(false)
  const processingRef = useRef(false)

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
          throw new Error('Missing code or state')
        }
        
        console.log('Processing LinkedIn callback...', { code: code.substring(0, 10) + '...', state: state.substring(0, 10) + '...' })
        
        // Call the backend to complete LinkedIn connection
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
        const response = await fetch(`${API_URL}/dvyb/auth/linkedin/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Include cookies for authentication
          body: JSON.stringify({ code, state }),
        })
        
        const data = await response.json()
        
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'LinkedIn connection failed')
        }
        
        setStatus('Connected! Closing...')
        
        // Send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'linkedin_connected',
            success: true,
          }, window.location.origin)
        }
        
        // Close window after a short delay
        setTimeout(() => window.close(), 1200)
      } catch (error: any) {
        console.error('LinkedIn callback error:', error)
        setIsError(true)
        setStatus(error?.message || 'Connection failed')
        
        // Send error message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'linkedin_error',
            message: error?.message || 'Connection failed'
          }, window.location.origin)
        }
        
        // Close window after showing error
        setTimeout(() => window.close(), 2000)
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

