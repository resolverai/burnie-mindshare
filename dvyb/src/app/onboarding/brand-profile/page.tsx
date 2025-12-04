"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { BrandKit } from "@/components/onboarding/BrandKit";
import { Loader2 } from "lucide-react";

export default function BrandProfilePage() {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Always re-check authentication with backend
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        console.log('❌ Not authenticated, redirecting to login');
        // Redirect to login if not authenticated
        router.push('/auth/login');
      } else {
        console.log('✅ Authenticated, showing Brand Kit');
        setShowContent(true);
      }
    }
  }, [isAuthenticated, isLoading, router]);

  const handleContinue = async () => {
    // Mark onboarding as complete (skip all intermediate steps)
    localStorage.setItem("dvyb_is_new_account", "false");
    
    // Mark auto_content_viewed as complete immediately
    // This ensures onboarding rings will show even if user reloads before dialog appears
    const ONBOARDING_STORAGE_KEY = 'dvyb_onboarding_guide_progress';
    try {
      const storedProgress = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      console.log('🔧 Brand Profile - Current localStorage:', storedProgress);
      const progress = storedProgress ? JSON.parse(storedProgress) : {};
      progress.auto_content_viewed = true;
      const newProgressStr = JSON.stringify(progress);
      localStorage.setItem(ONBOARDING_STORAGE_KEY, newProgressStr);
      console.log('✅ Brand Profile - Wrote to localStorage:', newProgressStr);
      // Verify it was written
      const verify = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      console.log('✅ Brand Profile - Verification read:', verify);
    } catch (e) {
      console.error('Failed to update onboarding progress:', e);
    }
    
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
    
    // Navigate directly to home (hassle-free onboarding!)
    router.push('/home');
  };

  if (isLoading || !showContent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        <p className="mt-4 text-base md:text-lg text-muted-foreground text-center px-4">
          Loading your Brand Kit...
        </p>
      </div>
    );
  }

  return <BrandKit onContinue={handleContinue} />;
}

