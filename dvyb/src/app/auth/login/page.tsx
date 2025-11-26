"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Twitter, Loader2, Sparkles } from "lucide-react";
import { authApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function AuthLoginPage() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();

  // If already authenticated, redirect to brand profile
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.push('/onboarding/brand-profile');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleTwitterLogin = async () => {
    if (isConnecting) return; // Prevent multiple clicks
    
    setIsConnecting(true);
    setError(null);

    try {
      const response = await authApi.getTwitterLoginUrl();
      
      if (response.success && response.data.oauth_url) {
        console.log('✅ Got OAuth URL, opening popup...');
        
        // Store state for later verification
        if (response.data.state) {
          localStorage.setItem('dvyb_twitter_oauth_state', response.data.state);
        }
        if ('code_challenge' in response.data && response.data.code_challenge) {
          localStorage.setItem('dvyb_twitter_code_challenge', response.data.code_challenge as string);
        }

        // Open Twitter OAuth in a popup window (like web3 projects)
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const authWindow = window.open(
          response.data.oauth_url,
          'dvyb-twitter-auth',
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );

        // Listen for messages from callback window
        let messageReceived = false;
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            return; // Ignore messages from other origins
          }

          if (event.data.type === 'DVYB_TWITTER_AUTH_SUCCESS') {
            messageReceived = true;
            console.log('✅ Twitter auth successful!', event.data);
            
            // Clean up
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
            
            // Store account info in localStorage for AuthContext
            if (event.data.account_id) {
              localStorage.setItem('dvyb_account_id', event.data.account_id.toString());
            }
            if (event.data.twitter_handle) {
              localStorage.setItem('dvyb_twitter_handle', event.data.twitter_handle);
            }
            
            // Refresh auth state
            console.log('🔄 Refreshing auth state...');
            checkAuth().then(() => {
              // Small delay to ensure auth state propagates
              setTimeout(() => {
                // Check if analysis data exists
                const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
                
                console.log('🔄 Redirecting user...', { hasAnalysis: !!hasAnalysis });
                
                if (hasAnalysis) {
                  // Redirect to analysis details page (handles both authenticated and unauthenticated)
                  console.log('→ Going to analysis-details');
                  router.push('/onboarding/analysis-details');
                } else {
                  // Redirect to brand profile
                  console.log('→ Going to brand-profile');
                  router.push('/onboarding/brand-profile');
                }
              }, 300); // 300ms delay for auth state to propagate
            });
          } else if (event.data.type === 'DVYB_TWITTER_AUTH_ERROR') {
            messageReceived = true;
            console.error('❌ Twitter auth error:', event.data.message);
            
            window.removeEventListener('message', handleMessage);
            setError(event.data.message || 'Twitter authentication failed');
            setIsConnecting(false);
          }
        };

        window.addEventListener('message', handleMessage);

        // Check if popup was closed without completing auth
        const checkPopupClosed = setInterval(() => {
          if (authWindow?.closed && !messageReceived) {
            clearInterval(checkPopupClosed);
            window.removeEventListener('message', handleMessage);
            setError('Authentication cancelled');
            setIsConnecting(false);
          }
        }, 1000);

        // Cleanup interval after 5 minutes
        setTimeout(() => {
          clearInterval(checkPopupClosed);
          if (!messageReceived) {
            window.removeEventListener('message', handleMessage);
            setIsConnecting(false);
          }
        }, 300000);
      } else {
        throw new Error('Failed to get Twitter login URL');
      }
    } catch (err: any) {
      console.error('Twitter login error:', err);
      setError(err.message || 'Failed to connect with Twitter');
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
              onClick={handleTwitterLogin}
              disabled={isConnecting}
              className="w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-semibold h-12 md:h-14 text-base md:text-lg rounded-xl transition-all transform hover:scale-[1.02] disabled:hover:scale-100"
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  <span className="hidden sm:inline">Connecting to Twitter...</span>
                  <span className="sm:hidden">Connecting...</span>
                </>
              ) : (
                <>
                  <Twitter className="w-5 h-5 mr-2" />
                  Sign in with Twitter
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

