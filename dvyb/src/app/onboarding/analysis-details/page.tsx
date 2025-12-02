"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AnalysisDetails } from "@/components/onboarding/AnalysisDetails";
import { Loader2 } from "lucide-react";
import { contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function AnalysisDetailsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // Fix hydration warning
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleContinue = async () => {
    if (!isAuthenticated) {
      // Not authenticated - go to Twitter auth
      console.log('👤 Not authenticated - redirecting to Twitter auth');
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
          
          // Start automatic content generation in background (wow experience!)
          console.log('🎨 Starting automatic content generation...');
          try {
            const { adhocGenerationApi } = await import('@/lib/api');
            const genResponse = await adhocGenerationApi.generateContent({
              topic: 'Product Launch',
              platforms: ['twitter'],  // Twitter only for faster demo
              number_of_posts: 2,
              number_of_images: 2,
              number_of_videos: 0,
              user_prompt: 'Generate Posts to showcase new feature launch on our platform',
            });
            
            if (genResponse.success && (genResponse.job_id || genResponse.uuid)) {
              const jobId = genResponse.job_id || genResponse.uuid;
              console.log('✅ Content generation started:', jobId);
              // Store job_id for home screen to pick up
              localStorage.setItem('dvyb_onboarding_generation_job_id', jobId);
            } else {
              console.warn('⚠️ Content generation failed to start:', genResponse.error);
            }
          } catch (genError) {
            console.error('⚠️ Could not start automatic generation:', genError);
            // Don't block onboarding if generation fails
          }
          
          // Proceed to brand profile
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

