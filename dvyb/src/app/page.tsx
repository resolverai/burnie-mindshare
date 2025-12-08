"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WebsiteAnalysis } from "@/components/onboarding/WebsiteAnalysis";
import { Loader2 } from "lucide-react";
import { trackLandingPageViewed } from "@/lib/mixpanel";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, accountId, onboardingComplete, isLoading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);
  const [shouldShowLanding, setShouldShowLanding] = useState(false);
  const hasTrackedRef = useRef(false);

  // Fix hydration warning by only rendering after client mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track landing page view when shown
  useEffect(() => {
    if (shouldShowLanding && !hasTrackedRef.current) {
      hasTrackedRef.current = true;
      trackLandingPageViewed(isAuthenticated);
    }
  }, [shouldShowLanding, isAuthenticated]);

  useEffect(() => {
    if (!isMounted || isLoading) return;

    const checkAndRedirect = async () => {
      // PRIORITY 1: Authenticated user
      if (isAuthenticated && accountId) {
        console.log("📍 User is authenticated, checking onboarding status...", { 
          onboardingComplete,
          accountId 
        });
        
        if (onboardingComplete) {
          // User has completed onboarding - ALWAYS go to home
          console.log("✅ Onboarding complete - redirecting to /home");
          // Clear old analysis data to prevent confusion
          localStorage.removeItem('dvyb_website_analysis');
          router.replace("/home");
          return;
        }
        
        // Onboarding NOT complete - check if we have analysis to continue
        const hasAnalysis = localStorage.getItem('dvyb_website_analysis');
        console.log("⚠️ Onboarding incomplete, hasAnalysis:", !!hasAnalysis);
        
        if (hasAnalysis) {
          // Continue onboarding from analysis details
          console.log("→ Has analysis - redirecting to analysis-details");
          router.replace("/onboarding/analysis-details");
          return;
        }
        
        // No analysis - show landing page to start/continue onboarding
        console.log("→ No analysis - showing website analysis form");
        setShouldShowLanding(true);
        return;
      }

      // PRIORITY 2: Not authenticated - show landing page
      if (!isAuthenticated) {
        console.log("👤 User not authenticated - showing landing page");
        setShouldShowLanding(true);
      }
    };

    checkAndRedirect();
  }, [isAuthenticated, accountId, onboardingComplete, isLoading, isMounted, router]);

  const handleAnalysisComplete = (url: string) => {
    // User will be redirected to /onboarding/analysis-details from WebsiteAnalysis component
    console.log("Analysis completed for:", url);
  };

  // Show loading while checking auth or if we haven't determined what to show yet
  if (!isMounted || isLoading || (!shouldShowLanding && !isAuthenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Only show landing page if explicitly allowed
  if (!shouldShowLanding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  // Landing page - for logged out users OR logged in users without website analysis
  return <WebsiteAnalysis onComplete={handleAnalysisComplete} />;
}
