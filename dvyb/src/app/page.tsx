"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WebsiteAnalysis } from "@/components/onboarding/WebsiteAnalysis";
import { ProductShotFlow } from "@/components/onboarding/ProductShotFlow";
import { Loader2 } from "lucide-react";
import { trackLandingPageViewed } from "@/lib/mixpanel";

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, accountId, onboardingComplete, isLoading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);
  const [shouldShowLanding, setShouldShowLanding] = useState(false);
  const [flowType, setFlowType] = useState<"website" | "product">("website");
  const hasTrackedRef = useRef(false);

  // Fix hydration warning by only rendering after client mount
  useEffect(() => {
    setIsMounted(true);
    
    // Check for ref parameter to determine flow type
    const ref = searchParams.get("ref");
    if (ref === "product" || ref === "productshot" || ref === "product-shot") {
      // Explicit product flow from URL parameter
      setFlowType("product");
      // Don't set localStorage here - only set when user actively enters OAuth
    } else if (ref) {
      // Any other ref parameter means website flow (Flow 1)
      setFlowType("website");
      clearProductFlowFlags();
    } else {
      // No ref parameter - ONLY restore product flow if user is returning from OAuth
      // This requires BOTH: pending_generation flag AND a valid S3 key (meaning they uploaded AND clicked signup)
      const pendingGeneration = localStorage.getItem("dvyb_product_flow_pending_generation");
      const productS3Key = localStorage.getItem("dvyb_product_shot_s3_key");
      
      // Only restore product flow if user was in the middle of OAuth redirect
      // (has pending generation AND has an S3 key from upload)
      const isActiveOAuthReturn = pendingGeneration === "true" && !!productS3Key;
      
      if (isActiveOAuthReturn) {
        console.log("🔄 Restoring product flow from OAuth return");
        setFlowType("product");
      } else {
        // Default to website analysis flow (Flow 1)
        console.log("🏠 Default flow: website analysis (Flow 1)");
        setFlowType("website");
        // Clear any stale product flow flags to prevent future issues
        clearProductFlowFlags();
      }
    }
  }, [searchParams]);

  // Helper to clear ALL product flow localStorage flags
  const clearProductFlowFlags = () => {
    localStorage.removeItem("dvyb_landing_flow");
    localStorage.removeItem("dvyb_product_flow_pending");
    localStorage.removeItem("dvyb_product_flow_pending_upload");
    localStorage.removeItem("dvyb_product_flow_pending_generation");
    localStorage.removeItem("dvyb_product_shot_s3_key");
    localStorage.removeItem("dvyb_product_preview_url");
    localStorage.removeItem("dvyb_product_shot_session");
    localStorage.removeItem("dvyb_product_shot_job_id");
    localStorage.removeItem("dvyb_guest_session_id");
  };

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
      // PRIORITY 0: Check if user is in product flow (Flow 2)
      // Product flow users should ALWAYS see the product flow, even if authenticated
      if (flowType === "product") {
        console.log("📦 Product flow detected - showing product shot flow");
        setShouldShowLanding(true);
        return;
      }
      
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
  }, [isAuthenticated, accountId, onboardingComplete, isLoading, isMounted, router, flowType]);

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
  // Show different flow based on ref parameter
  if (flowType === "product") {
    return <ProductShotFlow />;
  }
  
  return <WebsiteAnalysis onComplete={handleAnalysisComplete} />;
}

// Wrap in Suspense boundary for useSearchParams
export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
