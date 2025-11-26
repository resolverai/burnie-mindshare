"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { usePendingWebsiteAnalysis } from "@/hooks/usePendingWebsiteAnalysis";
import { AnalysisDetails } from "@/components/onboarding/AnalysisDetails";
import { Loader2 } from "lucide-react";

export default function AnalysisDetailsPage() {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();
  const { isSaving, saveComplete } = usePendingWebsiteAnalysis(isAuthenticated);
  const [showContent, setShowContent] = useState(false);

  // Re-check authentication with backend when page loads
  useEffect(() => {
    console.log('🔄 Analysis Details: Re-checking authentication with backend...');
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      console.log('✅ Analysis Details: Auth check complete, isAuthenticated:', isAuthenticated);
      setShowContent(true);
    }
  }, [isLoading, isAuthenticated]);

  const handleContinue = () => {
    if (!isAuthenticated) {
      // Not authenticated - go to login
      router.push('/auth/login');
    } else {
      // Authenticated - go to brand profile (data is in backend now)
      router.push('/onboarding/brand-profile');
    }
  };

  if (isLoading || !showContent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        {isSaving && (
          <p className="mt-4 text-base md:text-lg text-muted-foreground text-center">
            Saving your brand analysis...
          </p>
        )}
      </div>
    );
  }

  // Only render after client-side hydration to avoid hydration mismatch
  return <AnalysisDetails onContinue={handleContinue} isAuthenticated={isAuthenticated} />;
}

