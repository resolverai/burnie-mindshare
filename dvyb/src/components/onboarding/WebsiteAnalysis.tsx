"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { contextApi, authApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { trackWebsiteAnalysisStarted, trackWebsiteAnalysisCompleted, trackSignInClicked } from "@/lib/mixpanel";

interface WebsiteAnalysisProps {
  onComplete: (websiteUrl: string) => void;
}

const analysisSteps = [
  "Analyzing your website...",
  "Locating business...",
  "Looking up competitors...",
  "Understanding your brand...",
];

export const WebsiteAnalysis = ({ onComplete }: WebsiteAnalysisProps) => {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { isAuthenticated, logout } = useAuth();


  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    
    // Track sign in button clicked
    trackSignInClicked('google', 'landing_page');
    
    setIsSigningIn(true);

    try {
      // Clear any stale OAuth state before initiating new sign-in
      localStorage.removeItem('dvyb_google_oauth_state');
      
      const response = await authApi.getGoogleLoginUrl();
      
      if (response.success && response.data.oauth_url) {
        // Store new state for later verification
        if (response.data.state) {
          localStorage.setItem('dvyb_google_oauth_state', response.data.state);
        }

        // REDIRECT approach - navigate to Google OAuth directly
        // After auth, Google will redirect back to /auth/google/callback
        // The callback page will handle the redirect to the appropriate page
        console.log('🚀 Redirecting to Google OAuth...');
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error('Failed to get Google login URL');
      }
    } catch (err: any) {
      toast({
        title: "Sign In Failed",
        description: err.message || "Failed to connect with Google",
        variant: "destructive",
      });
      setIsSigningIn(false);
    }
  };

  useEffect(() => {
    if (isAnalyzing && !analysisComplete) {
      // Step progression: advances every 2 seconds
      const stepInterval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev < analysisSteps.length - 1) return prev + 1;
          return prev; // Stay at last step "Understanding your brand..."
        });
      }, 2000); // 2 seconds per step

      // Progress bar: reaches 100% in ~7 seconds
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(progressInterval); // Stop progress bar only
            return 100;
          }
          return prev + 1.5; // Slower increment (100 / (7000ms / 100ms) ≈ 1.4)
        });
      }, 100); // Update every 100ms

      return () => {
        clearInterval(stepInterval);
        clearInterval(progressInterval);
      };
    }
  }, [isAnalyzing, analysisComplete]);

  // Navigate to inspiration selection when complete
  useEffect(() => {
    if (analysisComplete) {
      setTimeout(() => {
        onComplete(websiteUrl);
        router.push('/onboarding/inspiration-selection');
      }, 500);
    }
  }, [analysisComplete, websiteUrl, onComplete, router]);

  // Normalize URL to ensure it has https://
  const normalizeUrl = (url: string): string => {
    let normalized = url.trim();
    
    // Remove any leading/trailing whitespace
    if (!normalized) return '';
    
    // If it doesn't start with http:// or https://, add https://
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = 'https://' + normalized;
    }
    
    return normalized;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (websiteUrl) {
      // Normalize the URL before processing
      const normalizedUrl = normalizeUrl(websiteUrl);
      
      // Track analysis started
      const startTime = Date.now();
      trackWebsiteAnalysisStarted(normalizedUrl);
      
      setIsAnalyzing(true);
      
      // Store normalized website URL in localStorage
      localStorage.setItem('dvyb_pending_website_url', normalizedUrl);
      
      try {
        // Call guest website analysis API (unauthenticated)
        const response = await contextApi.analyzeWebsiteGuest(normalizedUrl);
        
        if (response.success && response.data) {
          // Store analysis data in localStorage
          localStorage.setItem('dvyb_website_analysis', JSON.stringify(response.data));
          console.log("✅ Website analysis completed and stored in localStorage");
          
          // Track analysis completed
          trackWebsiteAnalysisCompleted(normalizedUrl, Date.now() - startTime);
          
          // Mark as complete (will trigger navigation after 500ms)
          setAnalysisComplete(true);
        } else {
          throw new Error('Website analysis failed');
        }
      } catch (error: any) {
        console.error("❌ Website analysis error:", error);
        toast({
          title: "Analysis Failed",
          description: error.message || "Could not analyze your website. Please try again.",
          variant: "destructive",
        });
        setIsAnalyzing(false);
        setProgress(0);
        setCurrentStep(0);
      }
    }
  };

  return (
    <div 
      className="min-h-screen flex flex-col p-4 md:p-6 lg:p-8 pb-24 md:pb-28"
      style={{
        backgroundImage: 'url(/onboarding-bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Top navigation with Sign In button - only show when NOT authenticated */}
      <div className="w-full flex justify-end items-center gap-2 md:gap-3 mb-4 md:mb-6 min-h-[40px]">
        {!isAuthenticated && (
          <>
            <span className="text-xs md:text-sm text-white">Already have an account?</span>
            <Button
              onClick={handleGoogleSignIn}
              disabled={isSigningIn || isAnalyzing}
              className="btn-gradient-cta font-semibold h-9 md:h-10 text-xs md:text-sm px-4 md:px-6 rounded-lg"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  <span className="hidden sm:inline">Signing in...</span>
                  <span className="sm:hidden">...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span className="hidden sm:inline">Sign in with Google</span>
                  <span className="sm:hidden">Sign In</span>
                </>
              )}
            </Button>
          </>
        )}
        {isAuthenticated && (
          <div className="flex items-center gap-2 md:gap-3">
            <span className="text-xs md:text-sm text-white">
              ✓ Signed in
            </span>
            <span className="text-white/50">•</span>
            <button
              onClick={() => logout()}
              className="text-xs md:text-sm text-white hover:text-white/80 transition-colors underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Main content centered */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl space-y-6 md:space-y-8 animate-fade-in">
          <div className="text-center space-y-3 md:space-y-4">
            <div className="w-32 h-24 md:w-48 md:h-32 mx-auto flex items-center justify-center">
              <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-foreground leading-tight tracking-tight text-center">
              Scroll stopping content without a single prompt, lets get started
            </h1>
          </div>

        {!isAnalyzing ? (
          <form id="website-form" onSubmit={handleSubmit} className="max-w-xl mx-auto">
            <div className="flex items-center bg-white rounded-full shadow-xl px-4 md:px-6 py-2">
              <Input
                id="website"
                type="text"
                placeholder="yourwebsite.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="flex-1 border-0 bg-transparent text-base md:text-lg text-gray-700 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 md:h-12"
                required
              />
              <Button 
                type="submit" 
                disabled={!websiteUrl.trim()}
                className="btn-gradient-cta rounded-full p-2.5 md:p-3 ml-2 shrink-0" 
                size="icon"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>
                </svg>
              </Button>
            </div>
          </form>
        ) : (
          <div className="max-w-xl mx-auto">
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 shadow-2xl">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-foreground font-medium text-base md:text-lg">
                    {analysisComplete ? "Analysis complete!" : analysisSteps[currentStep]}
                  </span>
                  <span className="text-foreground font-bold text-lg md:text-xl">{Math.round(progress)}%</span>
                </div>
                <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

    </div>
  );
};
