'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { authApi, contextApi } from '@/lib/api'
import { Loader2, XCircle } from 'lucide-react'
import { trackSignIn, identifyUser } from '@/lib/mixpanel'

function DvybGoogleCallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing authentication...')
  const [isError, setIsError] = useState(false)
  const [showRetry, setShowRetry] = useState(false)
  const processingRef = useRef(false)

  const handleRetry = () => {
    // Clear any stale OAuth state
    localStorage.removeItem('dvyb_google_oauth_state')
    
    // Check if this was a connect flow or sign-in flow
    const returnUrl = localStorage.getItem('dvyb_oauth_return_url') || '/'
    localStorage.removeItem('dvyb_oauth_return_url')
    localStorage.removeItem('dvyb_oauth_platform')
    
    window.location.href = returnUrl
  }

  useEffect(() => {
    const process = async () => {
      if (processingRef.current) return
      processingRef.current = true
      
      try {
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        
        console.log('📍 Google callback page loaded (redirect flow)')
        console.log('   - code:', code ? code.substring(0, 10) + '...' : 'MISSING')
        console.log('   - state:', state || 'MISSING')
        
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
        
        // Track sign-in and identify user
        trackSignIn('google')
        if (response.data?.account_id) {
          identifyUser(response.data.account_id, {
            email: response.data.email,
            name: response.data.account_name, // Google name is used as account_name
            accountName: response.data.account_name,
          })
        }
        
        setStatus('Connected! Redirecting...')
        
        // Store auth data in localStorage
        if (response.data?.account_id) {
          localStorage.setItem('dvyb_account_id', response.data.account_id.toString())
          localStorage.setItem('dvyb_auth_timestamp', Date.now().toString())
          localStorage.setItem('dvyb_session_active', 'true') // Mark session as active for header auth
          
          if (response.data.account_name) {
            localStorage.setItem('dvyb_account_name', response.data.account_name)
          }
          
          // Set cookie for backend auth
          const isProduction = window.location.protocol === 'https:'
          const cookieOptions = isProduction 
            ? 'path=/; max-age=604800; SameSite=None; Secure'
            : 'path=/; max-age=604800; SameSite=Lax'
          document.cookie = `dvyb_account_id=${response.data.account_id}; ${cookieOptions}`
          console.log('🍪 Auth cookie set')
          
          // IMPORTANT: If this is a NEW account (either first time or re-registration after deletion),
          // reset all onboarding-related localStorage to ensure fresh onboarding experience
          if (response.data.is_new_account) {
            console.log('🆕 New account detected - resetting ALL onboarding/OAuth localStorage')
            localStorage.removeItem('dvyb_is_new_account')
            localStorage.removeItem('dvyb_onboarding_guide_progress')
            localStorage.removeItem('dvyb_onboarding_generation_job_id')
            localStorage.removeItem('dvyb_onboarding_dialog_pending')
            // Clear any stale OAuth flow state from previous account
            localStorage.removeItem('dvyb_oauth_post_flow')
            localStorage.removeItem('dvyb_oauth_success')
            localStorage.removeItem('dvyb_oauth_return_url')
            localStorage.removeItem('dvyb_oauth_platform')
            // Set flag to indicate this is a new account that needs onboarding
            localStorage.setItem('dvyb_is_new_account', 'true')
          }
        }
        
        // Check if this is a "connect" flow (from Brand Kit or other pages) vs sign-in flow
        const oauthReturnUrl = localStorage.getItem('dvyb_oauth_return_url')
        const oauthPlatform = localStorage.getItem('dvyb_oauth_platform')
        
        if (oauthReturnUrl && oauthPlatform === 'google') {
          // This is a "connect Google" flow from another page (e.g., Brand Kit)
          console.log('🔗 Connect flow detected, returning to:', oauthReturnUrl)
          
          // Clean up
          localStorage.removeItem('dvyb_oauth_return_url')
          localStorage.removeItem('dvyb_oauth_platform')
          
          // Store success flag for the return page to show toast
          localStorage.setItem('dvyb_oauth_success', JSON.stringify({
            platform: 'google',
            message: 'Google connected successfully',
            timestamp: Date.now()
          }))
          
          // Redirect back to the return URL
          setTimeout(() => {
            console.log('🚀 Navigating to:', oauthReturnUrl)
            window.location.href = oauthReturnUrl
          }, 800)
          return
        }
        
        // This is a sign-in flow - determine where to redirect based on user state
        const isNewAccount = response.data?.is_new_account
        const onboardingComplete = response.data?.onboarding_complete
        
        // Check localStorage for analysis (in case user just did it before signing in)
        const storedAnalysis = localStorage.getItem('dvyb_website_analysis')
        const storedUrl = localStorage.getItem('dvyb_pending_website_url')
        const hasLocalAnalysis = !!storedAnalysis
        
        // ALWAYS check with backend if website analysis exists in dvyb_context
        // This is the authoritative source - if 'website' field is populated, analysis was done
        let hasBackendAnalysis = false
        try {
          console.log('🔍 Checking backend for website analysis...')
          const contextResponse = await contextApi.getContext()
          if (contextResponse.success && contextResponse.data) {
            // Check if website field is populated - this indicates analysis was done
            hasBackendAnalysis = !!contextResponse.data.website
            console.log('📊 Backend context check:')
            console.log('   - website:', contextResponse.data.website || 'NULL')
            console.log('   - hasBackendAnalysis:', hasBackendAnalysis)
          }
        } catch (contextError) {
          console.warn('⚠️ Could not fetch context from backend:', contextError)
        }
        
        // Analysis exists if either backend OR localStorage has it
        const hasAnalysis = hasBackendAnalysis || hasLocalAnalysis
        
        console.log('🧭 Determining redirect destination...')
        console.log('   - isNewAccount:', isNewAccount)
        console.log('   - onboardingComplete:', onboardingComplete)
        console.log('   - hasLocalAnalysis:', hasLocalAnalysis)
        console.log('   - hasBackendAnalysis:', hasBackendAnalysis)
        console.log('   - hasAnalysis (combined):', hasAnalysis)
        
        let redirectTo = '/home'
        
        if (onboardingComplete) {
          // Returning user with complete onboarding - go to home
          redirectTo = '/home'
          console.log('➡️ Redirecting to /home (onboarding complete)')
        } else if (hasLocalAnalysis && storedUrl) {
          // User has local analysis from unauthenticated flow - save to context and go to brand-profile
          console.log('📝 Saving local analysis to context...')
          try {
            const analysisData = JSON.parse(storedAnalysis)
            await contextApi.updateContext({
              website: storedUrl,
              accountName: analysisData.base_name,
              industry: analysisData.industry || null,
              suggestedFirstTopic: analysisData.suggested_first_topic || null,
              businessOverview: analysisData.business_overview_and_positioning,
              customerDemographics: analysisData.customer_demographics_and_psychographics,
              popularProducts: analysisData.most_popular_products_and_services,
              whyCustomersChoose: analysisData.why_customers_choose,
              brandStory: analysisData.brand_story,
              colorPalette: analysisData.color_palette,
              logoUrl: analysisData.logo_s3_key || null,
            })
            console.log('✅ Analysis saved to context')
          } catch (saveError) {
            console.error('⚠️ Failed to save analysis to context:', saveError)
          }
          redirectTo = '/onboarding/brand-profile'
          console.log('➡️ Redirecting to /onboarding/brand-profile (has local analysis, saved to context)')
        } else if (hasBackendAnalysis) {
          // User has analysis in backend - go to brand-profile
          redirectTo = '/onboarding/brand-profile'
          console.log('➡️ Redirecting to /onboarding/brand-profile (has backend analysis)')
        } else {
          // No analysis data - user needs to do website analysis first
          // This applies to both new users AND returning users who never completed analysis
          redirectTo = '/'
          console.log('➡️ Redirecting to / (no analysis, needs website analysis)')
        }
        
        // Small delay to ensure localStorage/cookie are set, then redirect
        // Use window.location.href for full page navigation to ensure fresh state
        console.log('⏳ Redirecting in 800ms...')
        setTimeout(() => {
          console.log('🚀 Navigating to:', redirectTo)
          window.location.href = redirectTo
        }, 800)
        
      } catch (error: any) {
        console.error('❌ Google callback error:', error)
        console.error('   - Error message:', error?.message)
        setIsError(true)
        
        // Check if it's a state verification error (expired/invalid state)
        const errorMsg = error?.message || 'Authentication failed'
        if (errorMsg.includes('expired') || errorMsg.includes('Invalid') || errorMsg.includes('state')) {
          setStatus('Your sign-in session expired. Please try again.')
          setShowRetry(true)
        } else {
          setStatus(errorMsg)
          // Redirect to landing page after showing error
          setTimeout(() => {
            window.location.href = '/'
          }, 3000)
        }
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
          {showRetry && (
            <button
              onClick={handleRetry}
              className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm md:text-base font-medium"
            >
              Try Again
            </button>
          )}
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
