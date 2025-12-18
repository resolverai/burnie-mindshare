"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { BrandKit } from "@/components/onboarding/BrandKit";
import { Loader2 } from "lucide-react";
import { trackBrandProfileViewed, trackBrandProfileProceedClicked, trackAutoContentGenerationStarted } from "@/lib/mixpanel";

export default function BrandProfilePage() {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();
  const [showContent, setShowContent] = useState(false);
  const hasTrackedRef = useRef(false);

  useEffect(() => {
    // Always re-check authentication with backend
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        console.log('❌ Not authenticated, redirecting to landing page');
        // Redirect to landing page if not authenticated
        router.push('/');
      } else {
        console.log('✅ Authenticated, showing Brand Kit');
        setShowContent(true);
        
        // Track page view
        if (!hasTrackedRef.current) {
          hasTrackedRef.current = true;
          trackBrandProfileViewed();
        }
      }
    }
  }, [isAuthenticated, isLoading, router]);

  const handleContinue = async (productImageS3Key?: string) => {
    // Track proceed button click
    trackBrandProfileProceedClicked();
    
    // Mark onboarding as complete (skip all intermediate steps)
    localStorage.setItem("dvyb_is_new_account", "false");
    
    // Reset onboarding progress to ensure fresh start for this account
    // This is critical for deleted users who come back - they need fresh onboarding
    const ONBOARDING_STORAGE_KEY = 'dvyb_onboarding_guide_progress';
    try {
      // Start with a fresh progress object, only set auto_content_viewed
      const freshProgress = { auto_content_viewed: true };
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(freshProgress));
      console.log('🔄 Reset onboarding progress to fresh state');
    } catch (e) {
      console.error('Failed to update onboarding progress:', e);
    }
    
    // Prepare user_images array (product image is optional)
    const userImages: string[] = [];
    if (productImageS3Key) {
      userImages.push(productImageS3Key);
      console.log('📸 Using product image:', productImageS3Key);
    }
    
    // When user provides a product image, use product-focused topic and instructions
    // Otherwise, use suggested topic from website analysis
    const hasProductImage = userImages.length > 0;
    
    let contentTopic = 'Product Launch'; // Default fallback
    let topicDescription = '';
    
    if (hasProductImage) {
      // Product image provided - use product showcase topic
      contentTopic = 'Product Showcase';
      topicDescription = 'Generate Product marketing post for this product';
      console.log('🛍️ Product image provided - using Product Showcase topic');
    } else {
      // No product image - use suggested topic from website analysis
      try {
        const storedAnalysis = localStorage.getItem('dvyb_website_analysis');
        if (storedAnalysis) {
          const analysisData = JSON.parse(storedAnalysis);
          if (analysisData.suggested_first_topic?.title) {
            contentTopic = analysisData.suggested_first_topic.title;
            topicDescription = analysisData.suggested_first_topic.description || '';
            console.log('📝 Using suggested topic from analysis:', contentTopic);
          }
        }
      } catch (e) {
        console.warn('Could not read suggested topic from localStorage:', e);
      }
    }
    
    // Get selected inspiration from localStorage (set during inspiration-selection step)
    let inspirationLinks: string[] = [];
    try {
      const storedInspirations = localStorage.getItem('dvyb_selected_inspirations');
      if (storedInspirations) {
        const inspirations = JSON.parse(storedInspirations);
        if (Array.isArray(inspirations) && inspirations.length > 0) {
          // Extract URLs from the inspiration objects
          inspirationLinks = inspirations.map((insp: any) => insp.url).filter(Boolean);
          console.log('🎨 Using inspiration links:', inspirationLinks);
        }
      }
    } catch (e) {
      console.warn('Could not read selected inspirations from localStorage:', e);
    }
    
    // Start automatic content generation in background (wow experience!)
    console.log('🎨 Starting automatic content generation with topic:', contentTopic);
    
    // Track auto content generation started
    trackAutoContentGenerationStarted({
      topic: contentTopic,
      platforms: ['twitter'],
      imageCount: 2,
      videoCount: 0,
    });
    
    try {
      const { adhocGenerationApi } = await import('@/lib/api');
      
      const genResponse = await adhocGenerationApi.generateContent({
        topic: contentTopic,
        platforms: ['twitter'],  // Twitter only for faster demo
        number_of_posts: 2,
        number_of_images: 2,
        number_of_videos: 0,  // 2 images for faster onboarding experience
        user_prompt: topicDescription,  // Use topic description as additional context
        user_images: hasProductImage ? userImages : undefined,
        inspiration_links: inspirationLinks.length > 0 ? inspirationLinks : undefined,
        is_onboarding_product_image: hasProductImage,  // Tell backend this is explicitly a product image
        force_product_marketing: hasProductImage,  // Use product marketing style when product image provided
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
    
    // Clear the selected inspirations from localStorage after use
    localStorage.removeItem('dvyb_selected_inspirations');
    
    // Navigate to content library to show auto-generated content
    router.push('/content-library');
  };

  if (isLoading || !showContent) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{
          backgroundImage: 'url(/onboarding-bg.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        <p className="mt-4 text-base md:text-lg text-foreground text-center px-4">
          Loading your Brand Kit...
        </p>
      </div>
    );
  }

  return <BrandKit onContinue={handleContinue} />;
}
