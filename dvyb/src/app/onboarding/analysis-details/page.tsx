"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AnalysisDetails } from "@/components/onboarding/AnalysisDetails";
import { Loader2 } from "lucide-react";
import { contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackAnalysisDetailsViewed, trackAnalysisDetailsContinue } from "@/lib/mixpanel";

export default function AnalysisDetailsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const hasTrackedRef = useRef(false);

  // Fix hydration warning
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track page view
  useEffect(() => {
    if (isMounted && !isLoading && !hasTrackedRef.current) {
      hasTrackedRef.current = true;
      trackAnalysisDetailsViewed(isAuthenticated);
    }
  }, [isMounted, isLoading, isAuthenticated]);

  const handleContinue = async () => {
    // Track continue button click
    trackAnalysisDetailsContinue(isAuthenticated);
    
    if (!isAuthenticated) {
      // Not authenticated - go to login page (user explicitly wants to sign in)
      console.log('👤 Not authenticated - redirecting to login page');
      router.push('/auth/login');
    } else {
      // Authenticated - save to database and proceed to brand profile
      console.log('✅ Authenticated - saving context to database and proceeding to brand profile');
      setIsSaving(true);
      
      try {
        // Get analysis from localStorage
        const storedAnalysis = localStorage.getItem('dvyb_website_analysis');
        const storedUrl = localStorage.getItem('dvyb_pending_website_url');
        
        if (!storedAnalysis || !storedUrl) {
          throw new Error('No analysis data found');
        }
        
        const analysisData = JSON.parse(storedAnalysis);
        
        // Save to database (including logo S3 key if extracted)
        const response = await contextApi.updateContext({
          website: storedUrl,
          accountName: analysisData.base_name,
          industry: analysisData.industry || null,
          suggestedFirstTopic: analysisData.suggested_first_topic || null,
          businessOverview: analysisData.business_overview_and_positioning,
          customerDemographics: analysisData.customer_demographics_and_psychographics,
          popularProducts: analysisData.most_popular_products_and_services,
          whyCustomersChoose: analysisData.why_customers_choose,
          brandStory: analysisData.brand_story,
          colorPalette: analysisData.color_palette,
          logoUrl: analysisData.logo_s3_key || null, // Save extracted logo S3 key
        });
        
        if (response.success) {
          console.log('✅ Context saved to database');
          toast({
            title: "Success!",
            description: "Your brand analysis has been saved.",
          });
          
          // Proceed to brand profile (auto content generation will happen after logo upload)
          router.push('/onboarding/brand-profile');
        } else {
          throw new Error('Failed to save context');
        }
      } catch (error) {
        console.error('❌ Failed to save context:', error);
        toast({
          title: "Error",
          description: "Failed to save your brand analysis. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    }
  };

  if (!isMounted || isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        <p className="mt-4 text-base md:text-lg text-muted-foreground text-center">
          Loading...
        </p>
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        <p className="mt-4 text-base md:text-lg text-muted-foreground text-center">
          Saving your brand analysis...
        </p>
      </div>
    );
  }

  // Only render after client-side hydration to avoid hydration mismatch
  return <AnalysisDetails onContinue={handleContinue} isAuthenticated={isAuthenticated} />;
}

