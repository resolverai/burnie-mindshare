'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { authApi } from '@/lib/api'
import { Loader2, Twitter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import dvybLogo from '@/assets/dvyb-logo.png'

export default function TwitterAuthPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const processingRef = useRef(false)

  // Handle message from OAuth callback popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return

      if (event.data?.type === 'DVYB_TWITTER_AUTH_SUCCESS') {
        console.log('✅ Twitter auth successful:', event.data)
        
        const { onboarding_complete } = event.data
        
        // Reset loading and processing state
        setIsLoading(false)
        processingRef.current = false
        
        // Redirect based on onboarding status
        if (onboarding_complete) {
          console.log('✅ Onboarding complete - redirecting to /home')
          // Use window.location for hard redirect to ensure auth state is refreshed
          window.location.href = '/home'
        } else {
          console.log('⏳ Onboarding incomplete - redirecting to analysis-details')
          // Check if we have analysis in localStorage
          const analysisResult = localStorage.getItem('dvyb_website_analysis')
          if (analysisResult) {
            window.location.href = '/onboarding/analysis-details'
          } else {
            // No analysis yet, start from website analysis
            window.location.href = '/'
          }
        }
      } else if (event.data?.type === 'DVYB_TWITTER_AUTH_ERROR') {
        console.error('❌ Twitter auth error:', event.data.message)
        setError(event.data.message || 'Authentication failed')
        setIsLoading(false)
        processingRef.current = false
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [router])

  const handleTwitterLogin = async () => {
    if (processingRef.current) return
    processingRef.current = true
    
    setIsLoading(true)
    setError(null)

    try {
      const response = await authApi.getTwitterLoginUrl()
      
      if (!response.success || !response.data.oauth_url) {
        throw new Error('Failed to get Twitter login URL')
      }

      // Open Twitter auth in a popup
      const width = 600
      const height = 700
      const left = window.screen.width / 2 - width / 2
      const top = window.screen.height / 2 - height / 2

      window.open(
        response.data.oauth_url,
        'twitter_oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      )
    } catch (error: any) {
      console.error('Twitter login error:', error)
      setError(error?.message || 'Failed to initiate Twitter login')
      setIsLoading(false)
      processingRef.current = false
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="w-32 h-20 flex items-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-card rounded-lg border border-border shadow-lg p-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2 text-center">
            Sign in to Continue
          </h1>
          <p className="text-muted-foreground text-center mb-8">
            Connect your Twitter account to get started with DVYB
          </p>

          {error && (
            <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive text-center">{error}</p>
            </div>
          )}

          <Button
            onClick={handleTwitterLogin}
            disabled={isLoading}
            className="w-full gap-2 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white h-12 text-base"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Twitter className="w-5 h-5 fill-white" />
                Continue with Twitter
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center mt-6">
            By continuing, you agree to DVYB&apos;s Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  )
}

