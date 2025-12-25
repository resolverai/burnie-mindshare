"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ProductShotLanding } from "./ProductShotLanding";
import { ProductShotUpload } from "./ProductShotUpload";
import { ProductShotGeneration } from "./ProductShotGeneration";
import { useAuth } from "@/contexts/AuthContext";
import { PricingModal } from "@/components/PricingModal";
import { adhocGenerationApi, authApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { 
  trackSignInClicked, 
  trackProductShotUploaded,
  trackProductShotGenerationStarted,
  trackProductShotGenerationCompleted,
  trackProductShotSignupClicked,
  trackProductShotGenerateMoreClicked,
  trackProductShotPricingShown,
  trackProductShotFlowCompleted,
} from "@/lib/mixpanel";

type FlowStep = "landing" | "upload" | "generating";

export const ProductShotFlow = () => {
  const router = useRouter();
  const { toast } = useToast();
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  
  const [currentStep, setCurrentStep] = useState<FlowStep>("landing");
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productS3Key, setProductS3Key] = useState<string | null>(null);
  const [productPreviewUrl, setProductPreviewUrl] = useState<string | null>(null);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Check if user returned from signup with pending generation
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const pendingS3Key = localStorage.getItem("dvyb_product_shot_s3_key");
      const pendingGeneration = localStorage.getItem("dvyb_product_flow_pending_generation");
      const storedPreviewUrl = localStorage.getItem("dvyb_product_preview_url");
      
      if (pendingGeneration === "true" && pendingS3Key) {
        console.log("📦 User returned from auth, starting generation...");
        // Clear the pending flag
        localStorage.removeItem("dvyb_product_flow_pending_generation");
        
        // Restore preview URL if available
        if (storedPreviewUrl) {
          setProductPreviewUrl(storedPreviewUrl);
        }
        
        // Set state and start generation
        setProductS3Key(pendingS3Key);
        setCurrentStep("generating");
        setIsGenerating(true);
        
        // Start the actual generation
        startGeneration(pendingS3Key);
      } else {
        // Check for pending upload flow (user clicked Get Started but wasn't logged in)
        const pendingUpload = localStorage.getItem("dvyb_product_flow_pending_upload");
        if (pendingUpload === "true") {
          localStorage.removeItem("dvyb_product_flow_pending_upload");
          setCurrentStep("upload");
        }
      }
    }
  }, [isAuthenticated, isLoading]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const handleGetStarted = () => {
    // Always go directly to upload - no auth required to try the product
    setCurrentStep("upload");
  };

  const handleBackToLanding = () => {
    setCurrentStep("landing");
  };

  const handleProductUpload = async (file: File, s3Key: string, sessionId: string, presignedUrl: string) => {
    setProductFile(file);
    setProductS3Key(s3Key);
    setGuestSessionId(sessionId);
    
    // Use presigned URL for preview (works after OAuth redirect, unlike blob URLs)
    setProductPreviewUrl(presignedUrl);
    
    // Store for use after auth - use presigned URL which persists after page reload
    localStorage.setItem('dvyb_product_shot_s3_key', s3Key);
    localStorage.setItem('dvyb_guest_session_id', sessionId);
    localStorage.setItem('dvyb_product_preview_url', presignedUrl);

    console.log('🎨 Product uploaded, S3 key:', s3Key);
    
    // Track product upload
    trackProductShotUploaded({
      fileType: file.type,
      fileSizeMB: Math.round(file.size / 1024 / 1024 * 100) / 100,
    });

    if (isAuthenticated) {
      // User is already authenticated, start generation immediately
      setCurrentStep("generating");
      setIsGenerating(true);
      startGeneration(s3Key);
    } else {
      // User needs to sign up first
      // Don't set localStorage flags here - only set when user clicks Sign Up
      // This prevents stale flags if user just reloads the page
      
      // Show the generating screen with signup overlay
      setCurrentStep("generating");
      setIsGenerating(false); // Not actually generating yet
      setGeneratedImages([]); // Empty to trigger signup overlay
    }
  };

  const startGeneration = async (s3Key: string) => {
    try {
      console.log("🚀 Starting product shot generation...");
      
      // Track generation started
      trackProductShotGenerationStarted({
        isAuthenticated: isAuthenticated,
        imageCount: 4,
      });
      
      const response = await adhocGenerationApi.generateContent({
        topic: "Product Showcase",
        platforms: ["twitter"],
        number_of_posts: 4,
        number_of_images: 4,
        number_of_videos: 0,
        user_prompt: "Generate stunning professional product photography shots with varied environments, lighting, and angles",
        user_images: [s3Key],
        is_onboarding_product_image: true,
        force_product_marketing: true,
        is_product_shot_flow: true,  // Flow 2: Use product photography specialist persona
      });

      if (response.success && (response.job_id || response.uuid)) {
        const newJobId = response.job_id || response.uuid;
        console.log("✅ Generation started, job ID:", newJobId);
        setJobId(newJobId);
        setIsGenerating(true);
        
        // Store job ID for potential recovery
        localStorage.setItem('dvyb_product_shot_job_id', newJobId);
        
        // Start polling for status
        startPolling();
      } else {
        throw new Error(response.error || "Failed to start generation");
      }
    } catch (error: any) {
      console.error("❌ Generation failed:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to start product shot generation. Please try again.",
        variant: "destructive",
      });
      setIsGenerating(false);
    }
  };

  const startPolling = () => {
    // Poll every 3 seconds
    pollingRef.current = setInterval(async () => {
      try {
        const status = await adhocGenerationApi.getStatus();
        
        if (status.success && status.data) {
          const data = status.data;
          
          // Check for progressive content (real-time updates)
          const progressiveContent = data?.metadata?.progressiveContent || [];
          const imageUrls = data?.generatedImageUrls || [];
          
          // Collect all available images
          const availableImages: string[] = [];
          
          // Add progressive content images
          progressiveContent.forEach((item: any) => {
            if (item.imageUrl) {
              availableImages.push(item.imageUrl);
            }
          });
          
          // Add final image URLs if available
          if (imageUrls.length > 0) {
            imageUrls.forEach((url: string) => {
              if (url && !availableImages.includes(url)) {
                availableImages.push(url);
              }
            });
          }
          
          // Update state with available images
          if (availableImages.length > 0) {
            setGeneratedImages(availableImages);
          }
          
          // Check if generation is complete
          if (data.status === "completed" || data.status === "done") {
            console.log("✅ Generation completed!");
            setIsGenerating(false);
            
            // Track generation completed
            trackProductShotGenerationCompleted({
              imageCount: availableImages.length,
            });
            
            // Stop polling
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            
            // Clear job ID from storage
            localStorage.removeItem('dvyb_product_shot_job_id');
          } else if (data.status === "failed" || data.status === "error") {
            console.error("❌ Generation failed:", data.errorMessage);
            setIsGenerating(false);
            
            // Stop polling
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            
            toast({
              title: "Generation Failed",
              description: data.errorMessage || "Failed to generate product shots.",
              variant: "destructive",
            });
          }
        }
      } catch (error) {
        console.error("❌ Polling error:", error);
        // Don't stop polling on transient errors
      }
    }, 3000);
  };

  const handleSignupClick = async () => {
    // Store the S3 key for after signup
    if (productS3Key) {
      localStorage.setItem("dvyb_product_shot_s3_key", productS3Key);
    }
    if (productPreviewUrl) {
      localStorage.setItem("dvyb_product_preview_url", productPreviewUrl);
    }
    
    // Set flags for generation after signup
    localStorage.setItem("dvyb_product_flow_pending_generation", "true");
    localStorage.setItem("dvyb_product_flow_pending", "true");
    localStorage.setItem("dvyb_landing_flow", "product");
    
    // Track product shot signup clicked
    trackProductShotSignupClicked();
    
    // Track sign in clicked
    trackSignInClicked('google', 'landing_page');
    
    try {
      // Clear any stale OAuth state
      localStorage.removeItem('dvyb_google_oauth_state');
      
      // Get Google OAuth URL and redirect directly (like Flow 1 landing page)
      const response = await authApi.getGoogleLoginUrl();
      
      if (response.success && response.data.oauth_url) {
        if (response.data.state) {
          localStorage.setItem('dvyb_google_oauth_state', response.data.state);
        }
        // Redirect directly to Google OAuth
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error('Failed to get Google login URL');
      }
    } catch (err: any) {
      toast({
        title: "Sign In Failed",
        description: err.message || "Failed to connect with Google",
        variant: "destructive",
      });
    }
  };

  const handleGenerateMore = async () => {
    // Track generate more clicked
    trackProductShotGenerateMoreClicked({
      imageCount: generatedImages.length,
      isPaidCustomer: false, // Will update after checking
    });
    
    try {
      // Check account status and usage limits (similar to ContentLibrary)
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
        credentials: 'include',
        headers: {
          ...(() => {
            const accountId = localStorage.getItem('dvyb_account_id');
            return accountId ? { 'X-DVYB-Account-ID': accountId } : {};
          })(),
        },
      });
      const data = await response.json();
      
      if (data.success && data.data) {
        // Check if user has a paid plan (not free trial)
        const isPaidCustomer = data.data.planId && !data.data.isFreeTrialPlan;
        
        // Check quota limits
        const hasImagesLeft = data.data.remainingImages > 0;
        const hasVideosLeft = data.data.remainingVideos > 0;
        const hasQuotaAvailable = hasImagesLeft || hasVideosLeft;
        
        console.log('📊 Usage check:', { isPaidCustomer, hasQuotaAvailable, data: data.data });
        
        if (isPaidCustomer && hasQuotaAvailable) {
          // Paid customer with quota available - go directly to content library
          console.log('✅ Paid customer with quota - redirecting to content library');
          
          // Track flow completed
          trackProductShotFlowCompleted({
            totalImagesGenerated: generatedImages.length,
            signedUp: isAuthenticated,
          });
          
          // Set flags for content library
          localStorage.setItem("dvyb_flow_2_complete", "true");
          localStorage.setItem("dvyb_is_new_account", "false");
          
          // Clear product flow flags
          localStorage.removeItem("dvyb_product_shot_s3_key");
          localStorage.removeItem("dvyb_product_preview_url");
          localStorage.removeItem("dvyb_product_shot_job_id");
          localStorage.removeItem("dvyb_landing_flow");
          localStorage.removeItem("dvyb_product_flow_pending");
          
          router.push("/content-library");
          return;
        }
        
        // Otherwise show pricing modal (skippable)
        trackProductShotPricingShown();
        setShowPricingModal(true);
      } else {
        // On error, show pricing modal
        trackProductShotPricingShown();
        setShowPricingModal(true);
      }
    } catch (error) {
      console.error('Failed to check usage:', error);
      // On error, show pricing modal
      trackProductShotPricingShown();
      setShowPricingModal(true);
    }
  };

  const handlePricingClose = () => {
    setShowPricingModal(false);
    
    // Track flow completed
    trackProductShotFlowCompleted({
      totalImagesGenerated: generatedImages.length,
      signedUp: isAuthenticated,
    });
    
    // Set flag to indicate Flow 2 is complete (skip questionnaire on content library)
    localStorage.setItem("dvyb_flow_2_complete", "true");
    localStorage.setItem("dvyb_is_new_account", "false");
    
    // Clear product flow flags
    localStorage.removeItem("dvyb_product_shot_s3_key");
    localStorage.removeItem("dvyb_product_preview_url");
    localStorage.removeItem("dvyb_product_shot_job_id");
    localStorage.removeItem("dvyb_landing_flow");
    localStorage.removeItem("dvyb_product_flow_pending");
    
    // After closing pricing modal, redirect to content library
    router.push("/content-library");
  };

  // Render based on current step
  if (currentStep === "landing") {
    return <ProductShotLanding onGetStarted={handleGetStarted} />;
  }

  if (currentStep === "upload") {
    return (
      <ProductShotUpload 
        onUpload={handleProductUpload} 
        onBack={handleBackToLanding}
        isGenerating={isGenerating}
      />
    );
  }

  return (
    <>
      <ProductShotGeneration
        productPreviewUrl={productPreviewUrl}
        onSignupClick={handleSignupClick}
        onGenerateMore={handleGenerateMore}
        generatedImages={generatedImages}
        isGenerating={isGenerating}
        isAuthenticated={isAuthenticated}
      />
      
      {/* Pricing Modal */}
      <PricingModal
        open={showPricingModal}
        onClose={handlePricingClose}
        canSkip={true}
        reason="user_initiated"
        userFlow="product_photoshot"
      />
    </>
  );
};
