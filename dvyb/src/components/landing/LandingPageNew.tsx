"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { authApi, contextApi, adhocGenerationApi } from "@/lib/api";
import { NavigationLanding } from "./NavigationLanding";
import { HeroSection } from "./HeroSection";
import { NotRegisteredModal } from "./NotRegisteredModal";
import { DiscoverPreview } from "./DiscoverPreview";
import { BrandsSection } from "./BrandsSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { FeaturesSection } from "./FeaturesSection";
import { TestimonialsSection } from "./TestimonialsSection";
import { FooterLanding } from "./FooterLanding";
import { OnboardingFlowModal } from "./OnboardingFlowModal";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { trackLandingPageViewed, trackLandingTimeSpent, trackLandingScrolled, trackOnboardingFlowCompleted } from "@/lib/mixpanel";

interface LandingPageNewProps {
  onAnalysisComplete?: (url: string) => void;
  /** Open website modal on mount (e.g. when navigating from /explore with ?openModal=website). */
  initialOpenWebsiteModal?: boolean;
}

/**
 * New landing page design for dvyb (wander-connect style).
 * Hero has website URL input; on submit the unified onboarding modal opens and shows
 * analysis progress, then product → inspiration → login.
 * "Get Started" (nav or DiscoverPreview) opens the same modal with website step first.
 * After Google login, user returns here with content generation job - GenerateContentDialog opens automatically.
 */
export function LandingPageNew({ onAnalysisComplete, initialOpenWebsiteModal }: LandingPageNewProps) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();
  const isDarkTheme = resolvedTheme === "dark";
  const { completeStep } = useOnboardingGuide();
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [initialWebsiteUrl, setInitialWebsiteUrl] = useState<string | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
  const [showNotRegisteredModal, setShowNotRegisteredModal] = useState(false);
  const searchParams = useSearchParams();
  const hasTrackedLandingViewRef = useRef(false);

  // Copy B: default to light (applies on mount and when switching to Copy B via ?copy=b)
  useEffect(() => {
    setTheme("light");
  }, [setTheme]);

  // Redirect logged-in users to discover (safety net in case page.tsx redirect didn't run)
  // Skip redirect only when returning from OAuth with content generation modal (openModal=contentGeneration)
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const isOAuthReturnWithContentModal = searchParams.get("openModal") === "contentGeneration";
      if (isOAuthReturnWithContentModal) return;
      const hasOnboardingJobInStorage = !!localStorage.getItem("dvyb_onboarding_generation_job_id");
      const hasOnboardingJobInState = !!onboardingJobId;
      if (!hasOnboardingJobInStorage && !hasOnboardingJobInState) {
        router.replace("/discover");
      }
    }
  }, [isAuthenticated, isLoading, router, onboardingJobId, searchParams]);

  // Show "not registered" modal when user returns from Sign In with unregistered Google account
  useEffect(() => {
    if (searchParams.get("error") === "not_registered") {
      setShowNotRegisteredModal(true);
      const newSearch = new URLSearchParams(window.location.search);
      newSearch.delete("error");
      const qs = newSearch.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [searchParams]);

  useEffect(() => {
    if (initialOpenWebsiteModal) {
      const websiteFromUrl = searchParams.get("website");
      setInitialWebsiteUrl(websiteFromUrl?.trim() || null);
      setOnboardingModalOpen(true);
    }
  }, [initialOpenWebsiteModal, searchParams]);

  // Landing time spent (seconds) – send on unmount
  const landingStartTimeRef = useRef<number>(Date.now());
  useEffect(() => {
    landingStartTimeRef.current = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - landingStartTimeRef.current) / 1000);
      if (seconds > 0) trackLandingTimeSpent(seconds, "B");
    };
  }, []);

  // Landing scroll – fire once when user scrolls
  useEffect(() => {
    let sent = false;
    const onScroll = () => {
      if (sent) return;
      if (typeof window !== "undefined" && window.scrollY > 0) {
        sent = true;
        trackLandingScrolled("B");
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // When arriving from pricing "Start now" (?focus=hero), focus the hero website URL input
  useEffect(() => {
    if (searchParams.get("focus") !== "hero") return;
    const t = setTimeout(() => {
      document.getElementById("hero-website-input")?.focus();
      const newSearch = new URLSearchParams(window.location.search);
      newSearch.delete("focus");
      const qs = newSearch.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }, 400);
    return () => clearTimeout(t);
  }, [searchParams]);

  // After OAuth: user returns with content generation job - open GenerateContentDialog (like ContentLibrary)
  useEffect(() => {
    const storedJobId = localStorage.getItem("dvyb_onboarding_generation_job_id");
    if (storedJobId) {
      console.log("🎉 Landing: Onboarding generation job detected, opening GenerateContentDialog");
      setOnboardingJobId(storedJobId);
      completeStep("auto_content_viewed");
      setTimeout(() => {
        setShowGenerateDialog(true);
        // Clear only after dialog is shown - prevents redirect race with the safety-net effect
        localStorage.removeItem("dvyb_onboarding_generation_job_id");
      }, 800);
    }
  }, [completeStep]);

  const handleGetStarted = () => {
    setInitialWebsiteUrl(null);
    setOnboardingModalOpen(true);
  };

  const handleOpenOnboardingWithUrl = (url: string) => {
    setInitialWebsiteUrl(url);
    setOnboardingModalOpen(true);
  };

  const handleOnboardingModalOpenChange = (open: boolean) => {
    setOnboardingModalOpen(open);
    if (!open) {
      setInitialWebsiteUrl(null);
      if (isAuthenticated) router.replace("/discover");
    }
  };

  const handleCopyBPrimaryCta = useCallback(async () => {
    const websiteParam = searchParams.get("website");
    const returnBase = "/?copy=b&openModal=website";
    const returnUrl = websiteParam ? `${returnBase}&website=${encodeURIComponent(websiteParam)}` : returnBase;

    if (isAuthenticated) {
      setInitialWebsiteUrl(websiteParam?.trim() || null);
      setOnboardingModalOpen(true);
      return;
    }
    try {
      localStorage.removeItem("dvyb_google_oauth_state");
      localStorage.setItem("dvyb_oauth_return_url", returnUrl);
      localStorage.setItem("dvyb_oauth_platform", "google");
      const response = await authApi.getGoogleLoginUrl({ signInOnly: false });
      if (response.success && response.data?.oauth_url) {
        if (response.data.state) localStorage.setItem("dvyb_google_oauth_state", response.data.state);
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err) {
      console.error("Copy B primary CTA login error:", err);
    }
  }, [isAuthenticated, searchParams]);

  const handleSkipToDiscover = useCallback(() => {
    setOnboardingModalOpen(false);
    router.push("/discover");
  }, [router]);

  const handleProceedToGeneration = useCallback(async () => {
    try {
      const storedAnalysis = localStorage.getItem("dvyb_website_analysis");
      const storedUrl = localStorage.getItem("dvyb_pending_website_url");
      if (storedAnalysis && storedUrl) {
        try {
          const analysisData = JSON.parse(storedAnalysis) as Record<string, unknown>;
          await contextApi.updateContext({
            website: storedUrl,
            accountName: (analysisData.base_name as string) || undefined,
            industry: (analysisData.industry as string) || null,
            suggestedFirstTopic: (analysisData.suggested_first_topic as { title?: string; description?: string } | null) || null,
            businessOverview: (analysisData.business_overview_and_positioning as string) || undefined,
            customerDemographics: (analysisData.customer_demographics_and_psychographics as string) || undefined,
            popularProducts: analysisData.most_popular_products_and_services as string[] | undefined,
            whyCustomersChoose: (analysisData.why_customers_choose as string) || undefined,
            brandStory: (analysisData.brand_story as string) || undefined,
            colorPalette: analysisData.color_palette as unknown,
            logoUrl: (analysisData.logo_s3_key as string) || null,
          });
        } catch {
          /* ignore */
        }
      }
      let productImageS3Key: string | undefined;
      const selectedProductsStr = localStorage.getItem("dvyb_selected_products");
      if (selectedProductsStr) {
        try {
          const products = JSON.parse(selectedProductsStr) as Array<{ s3Key?: string; image?: string }>;
          const first = Array.isArray(products) ? products[0] : null;
          if (first?.s3Key) productImageS3Key = first.s3Key;
          else if (first?.image && typeof window !== "undefined") {
            const imagePath = (first.image as string).startsWith("/") ? first.image : `/${first.image}`;
            const imageUrl = `${window.location.origin}${imagePath}`;
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            const ext = (imagePath as string).split(".").pop() || "jpg";
            const file = new File([blob], `product.${ext}`, { type: blob.type || "image/jpeg" });
            const s3Url = await adhocGenerationApi.uploadImage(file);
            productImageS3Key = adhocGenerationApi.extractS3Key(s3Url);
          }
        } catch {
          /* ignore */
        }
      }
      let inspirationLinks: string[] = [];
      const storedInspirations = localStorage.getItem("dvyb_selected_inspirations");
      if (storedInspirations) {
        try {
          const inspirations = JSON.parse(storedInspirations) as Array<{ mediaUrl?: string; url?: string; creativeImageUrl?: string; creativeVideoUrl?: string }>;
          if (Array.isArray(inspirations) && inspirations.length > 0) {
            inspirationLinks = inspirations.flatMap((insp) =>
              [insp.mediaUrl, insp.url, insp.creativeImageUrl, insp.creativeVideoUrl].filter(Boolean) as string[]
            );
          }
        } catch {
          /* ignore */
        }
      }
      const hasProductImage = !!productImageS3Key;
      let contentTopic = "Product Launch";
      let topicDescription = "Generate Product marketing post for this product";
      if (hasProductImage) {
        contentTopic = "Product Showcase";
        topicDescription = "";
      } else if (storedAnalysis) {
        try {
          const analysisData = JSON.parse(storedAnalysis) as { suggested_first_topic?: { title?: string; description?: string } };
          if (analysisData.suggested_first_topic?.title) {
            contentTopic = analysisData.suggested_first_topic.title;
            topicDescription = analysisData.suggested_first_topic.description || topicDescription;
          }
        } catch {
          /* ignore */
        }
      }
      const genResponse = await adhocGenerationApi.generateContent({
        topic: contentTopic,
        platforms: ["instagram"],
        number_of_posts: 2,
        number_of_images: 2,
        number_of_videos: 0,
        user_prompt: topicDescription || undefined,
        user_images: hasProductImage && productImageS3Key ? [productImageS3Key] : undefined,
        inspiration_links: inspirationLinks.length > 0 ? inspirationLinks : undefined,
        is_onboarding_product_image: hasProductImage,
        force_product_marketing: hasProductImage,
      });
      if (genResponse.success && (genResponse.job_id || genResponse.uuid)) {
        const jobId = genResponse.job_id || genResponse.uuid;
        setOnboardingJobId(jobId);
        setOnboardingModalOpen(false);
        setShowGenerateDialog(true);
      }
      localStorage.removeItem("dvyb_selected_inspirations");
      localStorage.removeItem("dvyb_selected_products");
    } catch (err) {
      console.error("Copy B proceed to generation error:", err);
    }
  }, []);

  const showAiVideosButton = searchParams.get("ai-videos") === "true";

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {showAiVideosButton && (
        <button
          type="button"
          onClick={handleGetStarted}
          className="fixed bottom-6 right-4 z-50 px-4 py-2.5 rounded-full text-xs font-display font-bold text-white animate-pulse md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:right-6 md:px-5 md:py-3 md:text-sm"
          style={{
            background: "hsl(0 90% 50%)",
            boxShadow: "0 0 20px hsl(0 100% 50% / 0.6), 0 0 40px hsl(0 100% 50% / 0.3)",
          }}
        >
          CLICK FOR FREE AI VIDEOS
        </button>
      )}

      <NavigationLanding
          onGetStarted={handleCopyBPrimaryCta}
          hideExplore
          hidePricing
          showThemeToggle
          variant={isDarkTheme ? "dark" : "default"}
        />
      <main>
        <HeroSection
          onAnalysisComplete={onAnalysisComplete}
          onOpenOnboardingWithUrl={handleOpenOnboardingWithUrl}
          onCopyShown={(mainMessage) => {
            if (hasTrackedLandingViewRef.current) return;
            hasTrackedLandingViewRef.current = true;
            trackLandingPageViewed(isAuthenticated, { copy: "B", hero_main_message: mainMessage });
          }}
          loginFirstFlow
          onPrimaryCtaClick={handleCopyBPrimaryCta}
        />
        {/* Stats section hidden for Copy B */}
        {false && <DiscoverPreview onOpenWebsiteModal={handleGetStarted} />}
        <BrandsSection />
        {false && <HowItWorksSection />}
        {false && <FeaturesSection />}
        <TestimonialsSection
          onOpenOnboardingWithUrl={handleOpenOnboardingWithUrl}
          loginFirstFlow
          onPrimaryCtaClick={handleCopyBPrimaryCta}
        />
      </main>
      <FooterLanding />
      <OnboardingFlowModal
        open={onboardingModalOpen}
        onOpenChange={handleOnboardingModalOpenChange}
        initialWebsiteUrl={initialWebsiteUrl}
        copy="B"
        onSkipToDiscover={handleSkipToDiscover}
        isAuthenticated={isAuthenticated}
        onProceedToGeneration={handleProceedToGeneration}
      />
      <NotRegisteredModal
        open={showNotRegisteredModal}
        onOpenChange={setShowNotRegisteredModal}
        onGetStarted={handleGetStarted}
      />
      <GenerateContentDialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          setShowGenerateDialog(open);
          if (!open) {
            trackOnboardingFlowCompleted("B");
            router.replace("/discover");
          }
        }}
        initialJobId={onboardingJobId}
        parentPage="home"
        landingStyle
        expectedImageCount={2}
        onboardingCopy="B"
        onDialogClosed={() => {
          trackOnboardingFlowCompleted("B");
          router.replace("/discover");
        }}
      />
    </div>
  );
}
