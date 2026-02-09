"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { LandingPageNew } from "@/components/landing/LandingPageNew";
import { ProductShotFlow } from "@/components/onboarding/ProductShotFlow";
import { Loader2 } from "lucide-react";
import { trackLandingPageViewed } from "@/lib/mixpanel";

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, accountId, isLoading } = useAuth();
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
      const openModalParam = searchParams.get("openModal");

      // PRIORITY 0: OAuth return flows - must show landing/product (user just completed signup)
      // openModal=contentGeneration is ONLY set by the Google callback - when present, always show
      // landing so GenerateContentDialog can open (job_id in localStorage). Never redirect here.
      const onboardingJobId = localStorage.getItem("dvyb_onboarding_generation_job_id");
      const pendingGeneration = localStorage.getItem("dvyb_product_flow_pending_generation");
      const productS3Key = localStorage.getItem("dvyb_product_shot_s3_key");
      const isProductOAuthReturn = pendingGeneration === "true" && !!productS3Key;

      if (openModalParam === "contentGeneration") {
        // OAuth callback sent us here - show landing so GenerateContentDialog can poll & display
        console.log("🎯 OAuth return with contentGeneration - showing landing");
        setShouldShowLanding(true);
        return;
      }

      if (onboardingJobId) {
        console.log("🎉 Onboarding generation job detected - showing landing with content modal");
        setShouldShowLanding(true);
        return;
      }
      if (isProductOAuthReturn) {
        console.log("📦 Product flow OAuth return - showing product shot flow");
        setShouldShowLanding(true);
        return;
      }

      // PRIORITY 1: Logged-in user visiting landing directly → redirect to discover
      if (isAuthenticated) {
        console.log("✅ User already logged in - redirecting to /discover");
        localStorage.removeItem("dvyb_website_analysis");
        router.replace("/discover");
        return;
      }

      // PRIORITY 2: Not authenticated or no account - show landing
      if (flowType === "product") {
        console.log("📦 Product flow (ref param) - showing product shot flow");
        setShouldShowLanding(true);
        return;
      }
      console.log("👤 User not authenticated - showing landing page");
      setShouldShowLanding(true);
    };

    checkAndRedirect();
  }, [isAuthenticated, isLoading, isMounted, router, flowType, searchParams]);

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
  // New landing (website flow): LandingPageNew. Old landing kept in @/components/onboarding/WebsiteAnalysis.tsx for reference.
  if (flowType === "product") {
    return <ProductShotFlow />;
  }

  const openModal = searchParams.get("openModal") === "website";
  return <LandingPageNew onAnalysisComplete={handleAnalysisComplete} initialOpenWebsiteModal={openModal} />;
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
