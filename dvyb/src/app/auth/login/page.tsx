"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { authApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { trackSignInClicked } from "@/lib/mixpanel";

export default function AuthLoginPage() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, onboardingComplete, isLoading } = useAuth();
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
    
    // Track sign in button clicked
    trackSignInClicked('google', 'login_page');
    
    setIsConnecting(true);
    setError(null);

    try {
      // Clear any stale OAuth state before initiating new sign-in
      localStorage.removeItem('dvyb_google_oauth_state');
      
      const response = await authApi.getGoogleLoginUrl();
      
      if (response.success && response.data.oauth_url) {
        console.log('✅ Got Google OAuth URL, redirecting...');
        
        // Store new state for later verification
        if (response.data.state) {
          localStorage.setItem('dvyb_google_oauth_state', response.data.state);
        }

        // REDIRECT approach - navigate to Google OAuth directly
        // After auth, Google will redirect back to /auth/google/callback
        // The callback page will handle the redirect to the appropriate page
        window.location.href = response.data.oauth_url;
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
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundImage: 'url(/onboarding-bg.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 md:p-6 lg:p-8"
      style={{
        backgroundImage: 'url(/onboarding-bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="w-full max-w-md space-y-6 md:space-y-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center space-y-3 md:space-y-4">
          <div className="w-32 h-24 md:w-48 md:h-32 mx-auto flex items-center justify-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground flex items-center justify-center gap-2 flex-wrap px-4">
            Welcome to Dvyb <Sparkles className="text-accent w-6 h-6 md:w-8 md:h-8" />
          </h1>
          <p className="text-base md:text-lg text-foreground/80 px-4">
            Sign in to create amazing social media content
          </p>
        </div>

        {/* Auth Card */}
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 md:p-8 shadow-2xl space-y-4 md:space-y-6">
          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-700 text-center">{error}</p>
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

          <div className="pt-4 border-t border-white/20">
            <p className="text-xs md:text-sm text-center text-foreground/70">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-3 md:space-y-4 px-2">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">AI-Powered Content Generation</h3>
              <p className="text-xs md:text-sm text-foreground/70">Create engaging posts tailored to your brand</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">Smart Scheduling</h3>
              <p className="text-xs md:text-sm text-foreground/70">Plan and schedule your content calendar</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base text-foreground">Secure & Private</h3>
              <p className="text-xs md:text-sm text-foreground/70">Your data is safe with enterprise-grade security</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

