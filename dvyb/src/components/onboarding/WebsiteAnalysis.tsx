"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Rocket, Loader2 } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { contextApi, authApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

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
  const { checkAuth, isAuthenticated, logout } = useAuth();


  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    
    setIsSigningIn(true);

    try {
      const response = await authApi.getGoogleLoginUrl();
      
      if (response.success && response.data.oauth_url) {
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

        let messageReceived = false;
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;

          if (event.data.type === 'DVYB_GOOGLE_AUTH_SUCCESS') {
            messageReceived = true;
            window.removeEventListener('message', handleMessage);
            setIsSigningIn(false);
            
            // Store account info
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
            
            // Refresh auth state and redirect
            checkAuth().then(() => {
              setTimeout(() => {
                if (event.data.onboarding_complete) {
                  // Returning user with complete onboarding - go to home
                  console.log('→ Returning user (onboarding complete) - going to /home');
                  router.push('/home');
                } else {
                  // New user or incomplete onboarding
                  const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
                  if (hasAnalysis) {
                    // Has analysis - continue to analysis details
                    console.log('→ Has analysis - going to analysis-details');
                    router.push('/onboarding/analysis-details');
                  } else {
                    // New user without analysis - stay on this page (now authenticated)
                    // Just refresh the page state - user can now do website analysis
                    console.log('→ New user without analysis - staying on landing page');
                    // Force re-render to update the UI (user is now authenticated)
                    window.location.reload();
                  }
                }
              }, 300);
            });
          } else if (event.data.type === 'DVYB_GOOGLE_AUTH_ERROR') {
            messageReceived = true;
            window.removeEventListener('message', handleMessage);
            toast({
              title: "Sign In Failed",
              description: event.data.message || "Authentication failed. Please try again.",
              variant: "destructive",
            });
            setIsSigningIn(false);
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
                  
                  setIsSigningIn(false);
                  checkAuth().then(() => {
                    setTimeout(() => {
                      if (authResult.onboarding_complete) {
                        console.log('→ Redirecting to /home');
                        router.push('/home');
                      } else {
                        const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
                        if (hasAnalysis) {
                          console.log('→ Redirecting to /onboarding/analysis-details');
                          router.push('/onboarding/analysis-details');
                        } else {
                          console.log('→ Reloading page');
                          window.location.reload();
                        }
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
            setIsSigningIn(false);
          }
        }, 500);

        // Cleanup after 5 minutes
        setTimeout(() => {
          clearInterval(checkPopupClosed);
          if (!messageReceived) {
            console.log('⏰ Timeout waiting for auth');
            window.removeEventListener('message', handleMessage);
            setIsSigningIn(false);
          }
        }, 300000);
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

  // Navigate to analysis details when complete
  useEffect(() => {
    if (analysisComplete) {
      setTimeout(() => {
        onComplete(websiteUrl);
        router.push('/onboarding/analysis-details');
      }, 500);
    }
  }, [analysisComplete, websiteUrl, onComplete, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (websiteUrl) {
      setIsAnalyzing(true);
      
      // Store website URL in localStorage
      localStorage.setItem('dvyb_pending_website_url', websiteUrl);
      
      try {
        // Call guest website analysis API (unauthenticated)
        const response = await contextApi.analyzeWebsiteGuest(websiteUrl);
        
        if (response.success && response.data) {
          // Store analysis data in localStorage
          localStorage.setItem('dvyb_website_analysis', JSON.stringify(response.data));
          console.log("✅ Website analysis completed and stored in localStorage");
          
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
    <div className="min-h-screen flex flex-col p-4 md:p-6 lg:p-8 bg-gradient-to-br from-background via-background to-muted">
      {/* Top navigation with Sign In button - only show when NOT authenticated */}
      <div className="w-full flex justify-end items-center gap-2 md:gap-3 mb-4 md:mb-6 min-h-[40px]">
        {!isAuthenticated && (
          <>
            <span className="text-xs md:text-sm text-muted-foreground">Already have an account?</span>
            <Button
              onClick={handleGoogleSignIn}
              disabled={isSigningIn || isAnalyzing}
              variant="outline"
              className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-medium h-9 md:h-10 text-xs md:text-sm px-3 md:px-4 rounded-lg transition-all"
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
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
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
            <span className="text-xs md:text-sm text-muted-foreground">
              ✓ Signed in
            </span>
            <span className="text-muted-foreground/50">•</span>
            <button
              onClick={() => logout()}
              className="text-xs md:text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Main content centered */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-2xl space-y-6 md:space-y-8 animate-fade-in">
          <div className="text-center space-y-3 md:space-y-4">
            <div className="w-32 h-24 md:w-48 md:h-32 mx-auto flex items-center justify-center">
              <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
            </div>
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground px-4">
              Turning your identity and "vibe" into
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              Social media content
            </h1>
          </div>

        {!isAnalyzing ? (
          <Card className="p-6 md:p-8 shadow-card-hover">
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
              <div className="space-y-2">
                <label htmlFor="website" className="text-sm md:text-base font-medium text-foreground">
                  Enter your website URL
                </label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://yourwebsite.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="text-base md:text-lg h-12"
                  required
                />
              </div>
              <Button type="submit" className="w-full h-12 md:h-14 text-base md:text-lg" size="lg">
                Start Analysis
              </Button>
            </form>
          </Card>
        ) : (
          <div className="space-y-4 md:space-y-6">
            <Card className="p-4 md:p-6 bg-primary/10 border-primary/20">
              <div className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-primary font-medium text-sm md:text-base">{analysisSteps[currentStep]}</span>
                  <span className="text-primary font-bold text-lg md:text-xl">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 md:h-2.5 bg-background rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </Card>

            <div className="space-y-2 md:space-y-3">
              {analysisSteps.map((step, index) => (
                <Card
                  key={step}
                  className={`p-3 md:p-4 transition-all duration-300 ${
                    index <= currentStep ? "bg-card border-primary/50" : "bg-muted/50 border-border/50"
                  } ${index === currentStep ? "animate-pulse-slow" : ""}`}
                >
                  <span className={`text-sm md:text-base ${index <= currentStep ? "text-foreground" : "text-muted-foreground"}`}>
                    {step}
                  </span>
                </Card>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};
