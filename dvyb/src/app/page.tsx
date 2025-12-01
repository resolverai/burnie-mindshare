"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WebsiteAnalysis } from "@/components/onboarding/WebsiteAnalysis";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, accountId, onboardingComplete, isLoading } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  // Fix hydration warning by only rendering after client mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || isLoading) return;

    const checkUserStatus = async () => {
      // If user is authenticated and onboarding is complete, redirect to home
      if (isAuthenticated && accountId && onboardingComplete) {
        console.log("✅ User authenticated & onboarded - redirecting to /home");
        router.push("/home");
        return;
      }

      // If user is authenticated but onboarding incomplete, check if we have analysis
      if (isAuthenticated && accountId && !onboardingComplete) {
        const analysisResult = localStorage.getItem('dvyb_website_analysis');
        if (analysisResult) {
          console.log("✅ User authenticated, analysis exists - redirecting to analysis-details");
          router.push("/onboarding/analysis-details");
          return;
        }
        // Otherwise show website analysis (authenticated user without analysis)
      }

      // If not authenticated, check if user has logged in before
      if (!isAuthenticated) {
        const hasAccountReference = localStorage.getItem('dvyb_account_id');
        
        if (hasAccountReference) {
          // User has an account but session expired/logged out
          // Redirect to Twitter auth to re-establish session
          console.log("🔄 Account exists but no session - redirecting to Twitter auth");
          router.push("/auth/login");
          return;
        }
        
        // Fresh new user - show website analysis form (landing page)
        console.log("👤 New user - showing website analysis form");
      }
    };

    checkUserStatus();
  }, [isAuthenticated, accountId, onboardingComplete, isLoading, isMounted, router]);

  const handleAnalysisComplete = (url: string) => {
    // User will be redirected to /onboarding/analysis-details from WebsiteAnalysis component
    console.log("Analysis completed for:", url);
  };

  if (!isMounted || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Landing page is ALWAYS unauthenticated - shows website analysis form
  return <WebsiteAnalysis onComplete={handleAnalysisComplete} />;
}
