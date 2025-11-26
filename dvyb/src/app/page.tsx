"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WebsiteAnalysis } from "@/components/onboarding/WebsiteAnalysis";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, accountId, onboardingComplete, isLoading } = useAuth();
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  useEffect(() => {
    const checkUserStatus = async () => {
      if (isLoading) return;

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
        // Otherwise show website analysis
      }

      // If not authenticated, redirect to Twitter auth
      if (!isAuthenticated) {
        console.log("❌ User not authenticated - redirecting to /auth/twitter");
        router.push("/auth/twitter");
        return;
      }

      // Default: show website analysis (for authenticated users without analysis)
      setIsCheckingStatus(false);
    };

    checkUserStatus();
  }, [isAuthenticated, accountId, onboardingComplete, isLoading, router]);

  const handleAnalysisComplete = (url: string) => {
    // User will be redirected to /onboarding/analysis-details from WebsiteAnalysis component
    console.log("Analysis completed for:", url);
  };

  if (isLoading || isCheckingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show website analysis for authenticated users without completed analysis
  return <WebsiteAnalysis onComplete={handleAnalysisComplete} />;
}
