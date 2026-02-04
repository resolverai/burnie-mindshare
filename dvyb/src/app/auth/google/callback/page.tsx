'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { authApi, contextApi, adhocGenerationApi } from '@/lib/api'
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
        
        // Determine which flow the user came from for acquisition tracking
        const currentLandingFlow = localStorage.getItem('dvyb_landing_flow')
        const currentProductFlowPending = localStorage.getItem('dvyb_product_flow_pending')
        const currentProductFlowPendingGeneration = localStorage.getItem('dvyb_product_flow_pending_generation')
        
        // Determine initial acquisition flow for new accounts
        let initialAcquisitionFlow: 'website_analysis' | 'product_photoshot' | undefined
        if (currentLandingFlow === 'product' || currentProductFlowPending === 'true' || currentProductFlowPendingGeneration === 'true') {
          initialAcquisitionFlow = 'product_photoshot'
        } else {
          initialAcquisitionFlow = 'website_analysis'
        }
        
        console.log('   - initialAcquisitionFlow:', initialAcquisitionFlow)
        
        // Call the callback endpoint with flow information
        const response = await authApi.handleGoogleCallback(code, state, initialAcquisitionFlow)
        
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
        
        // Check if user was in product shot flow (Flow 2)
        const productFlowPending = localStorage.getItem('dvyb_product_flow_pending')
        const productFlowPendingUpload = localStorage.getItem('dvyb_product_flow_pending_upload')
        const productFlowPendingGeneration = localStorage.getItem('dvyb_product_flow_pending_generation')
        const productShotSession = localStorage.getItem('dvyb_product_shot_session')
        const landingFlow = localStorage.getItem('dvyb_landing_flow')
        const isProductFlow = productFlowPending === 'true' || productFlowPendingUpload === 'true' || productFlowPendingGeneration === 'true' || !!productShotSession || landingFlow === 'product'
        
        if (isProductFlow) {
          console.log('📦 Product shot flow detected - redirecting to /')
          // Clear some pending flags but KEEP dvyb_product_flow_pending_generation for ProductShotFlow to detect
          localStorage.removeItem('dvyb_product_flow_pending')
          localStorage.removeItem('dvyb_product_flow_pending_upload')
          // Keep dvyb_product_flow_pending_generation - ProductShotFlow will clear it after starting generation
          // Keep dvyb_product_shot_s3_key - needed for generation
          // Keep dvyb_landing_flow so page.tsx routes to ProductShotFlow
          
          setTimeout(() => {
            console.log('🚀 Navigating to / (product flow)')
            window.location.href = '/'
          }, 800)
          return
        }
        
        // NEW: Landing onboarding flow (website -> inspiration -> product -> login)
        // Upload product to S3, start adhoc generation, redirect to landing with content modal
        const landingOnboardingPending = localStorage.getItem('dvyb_landing_onboarding_flow_pending')
        if (landingOnboardingPending === 'true') {
          console.log('🎯 Landing onboarding flow detected - upload product, start generation, redirect to /')
          localStorage.removeItem('dvyb_landing_onboarding_flow_pending')
          
          setStatus('Preparing your content...')
          
          try {
            // Save analysis to context (same as brand-profile flow)
            const storedAnalysis = localStorage.getItem('dvyb_website_analysis')
            const storedUrl = localStorage.getItem('dvyb_pending_website_url')
            if (storedAnalysis && storedUrl) {
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
            }
            
            // Get selected product and upload to S3 (or use existing S3 key from domain products)
            let productImageS3Key: string | undefined
            const selectedProductsStr = localStorage.getItem('dvyb_selected_products')
            if (selectedProductsStr) {
              try {
                const products = JSON.parse(selectedProductsStr)
                const firstProduct = Array.isArray(products) ? products[0] : null
                if (firstProduct?.s3Key) {
                  // Domain product: already in S3, use key directly
                  productImageS3Key = firstProduct.s3Key
                  console.log('✅ Using domain product S3 key:', productImageS3Key)
                } else if (firstProduct?.image) {
                  // Static product: fetch from origin and upload
                  const imagePath = firstProduct.image.startsWith('/') ? firstProduct.image : `/${firstProduct.image}`
                  const imageUrl = `${window.location.origin}${imagePath}`
                  console.log('📸 Fetching product image from:', imageUrl)
                  const res = await fetch(imageUrl)
                  const blob = await res.blob()
                  const ext = imagePath.split('.').pop() || 'jpg'
                  const file = new File([blob], `product.${ext}`, { type: blob.type || 'image/jpeg' })
                  const s3Url = await adhocGenerationApi.uploadImage(file)
                  productImageS3Key = adhocGenerationApi.extractS3Key(s3Url)
                  console.log('✅ Product uploaded to S3:', productImageS3Key)
                }
              } catch (uploadErr) {
                console.error('⚠️ Failed to upload product image:', uploadErr)
              }
            }
            
            // Get inspiration links (from dvyb_inspirations or dvyb_brand_ads / discover ads)
            let inspirationLinks: string[] = []
            const storedInspirations = localStorage.getItem('dvyb_selected_inspirations')
            if (storedInspirations) {
              try {
                const inspirations = JSON.parse(storedInspirations)
                if (Array.isArray(inspirations) && inspirations.length > 0) {
                  inspirationLinks = inspirations.flatMap((insp: any) =>
                    [insp.mediaUrl, insp.url, insp.creativeImageUrl, insp.creativeVideoUrl].filter(Boolean)
                  )
                  console.log('🎨 Using inspiration links:', inspirationLinks.length, inspirationLinks)
                }
              } catch (e) {
                console.warn('Could not read inspirations:', e)
              }
            }
            
            // Topic and user instructions: when product image is passed (onboarding flow),
            // override to 'Product Showcase' and blank instructions so Grok uses inspiration + product image.
            // When no product chosen, use topic/instructions from website analysis.
            const hasProductImage = !!productImageS3Key
            let contentTopic = 'Product Launch'
            let topicDescription = 'Generate Product marketing post for this product'
            if (hasProductImage) {
              contentTopic = 'Product Showcase'
              topicDescription = ''
            } else if (storedAnalysis) {
              try {
                const analysisData = JSON.parse(storedAnalysis)
                if (analysisData.suggested_first_topic?.title) {
                  contentTopic = analysisData.suggested_first_topic.title
                  topicDescription = analysisData.suggested_first_topic.description || topicDescription
                }
              } catch (e) {
                console.warn('Could not read topic from analysis:', e)
              }
            }
            
            const userImages = hasProductImage ? [productImageS3Key] : []
            
            const genResponse = await adhocGenerationApi.generateContent({
              topic: contentTopic,
              platforms: ['instagram'],
              number_of_posts: 4,
              number_of_images: 4,
              number_of_videos: 0,
              user_prompt: topicDescription || undefined,
              user_images: userImages.length > 0 ? userImages : undefined,
              inspiration_links: inspirationLinks.length > 0 ? inspirationLinks : undefined,
              is_onboarding_product_image: hasProductImage,
              force_product_marketing: hasProductImage,
            })
            
            if (genResponse.success && (genResponse.job_id || genResponse.uuid)) {
              const jobId = genResponse.job_id || genResponse.uuid
              localStorage.setItem('dvyb_onboarding_generation_job_id', jobId)
              console.log('✅ Content generation started:', jobId)
            }
            
            localStorage.removeItem('dvyb_selected_inspirations')
            localStorage.removeItem('dvyb_selected_products')
          } catch (genError) {
            console.error('⚠️ Landing onboarding flow error:', genError)
          }
          
          setStatus('Connected! Redirecting...')
          setTimeout(() => {
            console.log('🚀 Navigating to / (landing with content modal)')
            window.location.href = '/?openModal=contentGeneration'
          }, 800)
          return
        }
        
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
        // Sign-in-only flow: account not found - redirect immediately without showing error UI
        // The landing page will show the "not registered" modal
        if (error?.code === 'ACCOUNT_NOT_FOUND' || error?.message?.includes('Account not found')) {
          console.log('⚠️ Account not found (sign-in-only flow) - redirecting to landing with not_registered')
          window.location.href = '/?error=not_registered'
          return
        }

        console.error('❌ Google callback error:', error)
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
