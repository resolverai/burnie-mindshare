"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { authApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function AuthLoginPage() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, onboardingComplete, isLoading, checkAuth } = useAuth();
  const router = useRouter();

  // If already authenticated, redirect based on onboarding status
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      if (onboardingComplete) {
        console.log('✅ Already authenticated & onboarded - redirecting to /home');
        router.push('/home');
      } else {
        console.log('⚠️ Authenticated but onboarding incomplete - redirecting to brand-profile');
        router.push('/onboarding/brand-profile');
      }
    }
  }, [isAuthenticated, onboardingComplete, isLoading, router]);

  const handleGoogleLogin = async () => {
    if (isConnecting) return; // Prevent multiple clicks
    
    setIsConnecting(true);
    setError(null);

    try {
      const response = await authApi.getGoogleLoginUrl();
      
      if (response.success && response.data.oauth_url) {
        console.log('✅ Got Google OAuth URL, opening popup...');
        
        // Store state for later verification
        if (response.data.state) {
          localStorage.setItem('dvyb_google_oauth_state', response.data.state);
        }

        // Open Google OAuth in a popup window
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const authWindow = window.open(
          response.data.oauth_url,
          'dvyb-google-auth',
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );

        // Listen for messages from callback window
        let messageReceived = false;
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            return; // Ignore messages from other origins
          }

          if (event.data.type === 'DVYB_GOOGLE_AUTH_SUCCESS') {
            messageReceived = true;
            console.log('✅ Google auth successful!', event.data);
            
            // Clean up
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
            
            // Store account info in localStorage for AuthContext
            if (event.data.account_id) {
              localStorage.setItem('dvyb_account_id', event.data.account_id.toString());
              
              // Set timestamp to prevent AuthContext from clearing data if cookie doesn't work
              localStorage.setItem('dvyb_auth_timestamp', Date.now().toString());
              
              // CRITICAL: Also set the cookie in the parent window context
              // This ensures checkAuth() can find the account ID even if popup cookie isn't shared
              const isProduction = window.location.protocol === 'https:';
              const cookieOptions = isProduction 
                ? 'path=/; max-age=604800; SameSite=None; Secure'  // 7 days, cross-site safe
                : 'path=/; max-age=604800; SameSite=Lax';          // 7 days, same-site only
              document.cookie = `dvyb_account_id=${event.data.account_id}; ${cookieOptions}`;
              console.log('🍪 Set account cookie in parent window');
            }
            if (event.data.account_name) {
              localStorage.setItem('dvyb_account_name', event.data.account_name);
            }
            
            // Refresh auth state
            console.log('🔄 Refreshing auth state...');
            checkAuth().then(() => {
              // Small delay to ensure auth state propagates
              setTimeout(() => {
                // Check if onboarding was already complete
                const onboardingComplete = event.data.onboarding_complete;
                
                console.log('🔄 Redirecting user...', { 
                  onboardingComplete, 
                  isNewAccount: event.data.is_new_account 
                });
                
                if (onboardingComplete) {
                  // User has already completed onboarding - go to home
                  console.log('→ Onboarding complete - going to /home');
                  router.push('/home');
                } else {
                  // Onboarding not complete - continue onboarding flow
                  const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
                  
                  if (hasAnalysis) {
                    // Redirect to analysis details page
                    console.log('→ Has analysis - going to analysis-details');
                    router.push('/onboarding/analysis-details');
                  } else {
                    // Redirect to brand profile to start onboarding
                    console.log('→ No analysis - going to brand-profile');
                    router.push('/onboarding/brand-profile');
                  }
                }
              }, 300); // 300ms delay for auth state to propagate
            });
          } else if (event.data.type === 'DVYB_GOOGLE_AUTH_ERROR') {
            messageReceived = true;
            console.error('❌ Google auth error:', event.data.message);
            
            window.removeEventListener('message', handleMessage);
            setError(event.data.message || 'Google authentication failed');
            setIsConnecting(false);
          }
        };

        window.addEventListener('message', handleMessage);

        // Helper function to process auth result from localStorage
        const processLocalStorageFallback = () => {
          try {
            const fallbackData = localStorage.getItem('dvyb_auth_result');
            console.log('🔍 Checking localStorage fallback:', fallbackData ? 'FOUND' : 'not found');
            
            if (fallbackData) {
              const authResult = JSON.parse(fallbackData);
              console.log('📦 Auth result from localStorage:', authResult);
              
              // Check if this is a recent result (within last 60 seconds)
              if (authResult.timestamp && (Date.now() - authResult.timestamp) < 60000) {
                console.log('✅ Found valid auth result in localStorage fallback');
                localStorage.removeItem('dvyb_auth_result'); // Clear it
                
                if (authResult.type === 'DVYB_GOOGLE_AUTH_SUCCESS' && authResult.account_id) {
                  // Process the success
                  localStorage.setItem('dvyb_account_id', authResult.account_id.toString());
                  localStorage.setItem('dvyb_auth_timestamp', Date.now().toString());
                  
                  const isProduction = window.location.protocol === 'https:';
                  const cookieOptions = isProduction 
                    ? 'path=/; max-age=604800; SameSite=None; Secure'
                    : 'path=/; max-age=604800; SameSite=Lax';
                  document.cookie = `dvyb_account_id=${authResult.account_id}; ${cookieOptions}`;
                  console.log('🍪 Cookie set from localStorage fallback');
                  
                  if (authResult.account_name) {
                    localStorage.setItem('dvyb_account_name', authResult.account_name);
                  }
                  
                  setIsConnecting(false);
                  checkAuth().then(() => {
                    setTimeout(() => {
                      if (authResult.onboarding_complete) {
                        console.log('→ Redirecting to /home');
                        router.push('/home');
                      } else {
                        const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
                        console.log('→ Redirecting to', hasAnalysis ? '/onboarding/analysis-details' : '/onboarding/brand-profile');
                        router.push(hasAnalysis ? '/onboarding/analysis-details' : '/onboarding/brand-profile');
                      }
                    }, 300);
                  });
                  return true; // Success
                }
              } else {
                console.log('⚠️ Auth result too old, ignoring');
                localStorage.removeItem('dvyb_auth_result');
              }
            }
          } catch (e) {
            console.error('Error checking fallback:', e);
          }
          return false;
        };

        // Check if popup was closed - also check for localStorage fallback
        let checkCount = 0;
        const checkPopupClosed = setInterval(() => {
          checkCount++;
          
          // Check localStorage on EVERY tick (popup might write before closing)
          if (!messageReceived && processLocalStorageFallback()) {
            console.log('✅ Processed auth from localStorage fallback');
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            return;
          }
          
          // Also check if popup is closed (might be null, closed, or undefined)
          const isClosed = !authWindow || authWindow.closed;
          
          if (checkCount % 4 === 0) { // Log every 2 seconds
            console.log(`🔄 Popup check #${checkCount}: closed=${isClosed}, messageReceived=${messageReceived}`);
          }
          
          // After popup is definitely closed and no message, give up after a few more checks
          if (isClosed && !messageReceived && checkCount > 10) {
            console.log('⚠️ Popup closed without auth completion');
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            setError('Authentication cancelled');
            setIsConnecting(false);
          }
        }, 500);

        // Cleanup after 5 minutes
        setTimeout(() => {
          clearInterval(checkPopupClosed);
          if (!messageReceived) {
            console.log('⏰ Timeout waiting for auth');
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
          }
        }, 300000);
      } else {
        throw new Error('Failed to get Google login URL');
      }
    } catch (err: any) {
      console.error('Google login error:', err);
      setError(err.message || 'Failed to connect with Google');
      setIsConnecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-6 lg:p-8 bg-gradient-to-br from-background via-background to-muted">
      <div className="w-full max-w-md space-y-6 md:space-y-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center space-y-3 md:space-y-4">
          <div className="w-32 h-24 md:w-48 md:h-32 mx-auto flex items-center justify-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground flex items-center justify-center gap-2 flex-wrap px-4">
            Welcome to Dvyb <Sparkles className="text-accent w-6 h-6 md:w-8 md:h-8" />
          </h1>
          <p className="text-base md:text-lg text-muted-foreground px-4">
            Sign in to create amazing social media content
          </p>
        </div>

        {/* Auth Card */}
        <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow space-y-4 md:space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive text-center">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <Button
              onClick={handleGoogleLogin}
              disabled={isConnecting}
              className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold h-12 md:h-14 text-base md:text-lg rounded-xl transition-all transform hover:scale-[1.02] disabled:hover:scale-100"
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  <span className="hidden sm:inline">Connecting to Google...</span>
                  <span className="sm:hidden">Connecting...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </Button>
          </div>

          <div className="pt-4 border-t border-border">
            <p className="text-xs md:text-sm text-center text-muted-foreground">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </Card>

        {/* Features */}
        <div className="space-y-3 md:space-y-4 px-2">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">AI-Powered Content Generation</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Create engaging posts tailored to your brand</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">Smart Scheduling</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Plan and schedule your content calendar</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">Secure & Private</h3>
              <p className="text-xs md:text-sm text-muted-foreground">Your data is safe with enterprise-grade security</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

