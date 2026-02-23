"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { NavigationLanding } from "./NavigationLanding";
import { HeroSection } from "./HeroSection";
import { NotRegisteredModal } from "./NotRegisteredModal";
import { DiscoverPreview } from "./DiscoverPreview";
import { BrandsSection } from "./BrandsSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { LandingHeroStatsSection } from "./LandingHeroStatsSection";
import { FeaturesSection } from "./FeaturesSection";
import { TestimonialsSection } from "./TestimonialsSection";
import { FooterLanding } from "./FooterLanding";
import { OnboardingFlowModal } from "./OnboardingFlowModal";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { tileImages } from "@/lib/tileImages";
import { trackLandingPageViewed, trackOnboardingFlowCompleted } from "@/lib/mixpanel";

function getInitialAdCount() {
  const startDate = new Date("2026-02-04");
  const today = new Date();
  const hoursDiff = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60));
  return 538 + Math.max(0, hoursDiff) * 10;
}

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
  const [adCount, setAdCount] = useState(getInitialAdCount);
  const [floatingTiles, setFloatingTiles] = useState<{ id: number; delay: number; imageIndex: number }[]>([]);
  const nextImageIndexRef = useRef(0);
  const searchParams = useSearchParams();
  const hasTrackedLandingViewRef = useRef(false);

  // Copy B: default to light (applies on mount and when switching to Copy B via ?copy=b)
  useEffect(() => {
    setTheme("light");
  }, [setTheme]);

  // Traction stats: ad count + floating tiles (shared by Hero and Stats)
  useEffect(() => {
    const interval = setInterval(() => {
      const increment = Math.floor(Math.random() * 4);
      if (increment > 0) {
        setAdCount((prev) => prev + increment);
        const newTiles = Array.from({ length: increment }, (_, i) => ({
          id: Date.now() + i,
          delay: i * 100,
          imageIndex: (nextImageIndexRef.current + i) % tileImages.length,
        }));
        nextImageIndexRef.current = (nextImageIndexRef.current + increment) % tileImages.length;
        setFloatingTiles((prev) => [...prev, ...newTiles]);
        setTimeout(() => {
          setFloatingTiles((prev) => prev.filter((t) => !newTiles.find((n) => n.id === t.id)));
        }, 4000);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Redirect logged-in users to discover (safety net in case page.tsx redirect didn't run)
  // Skip redirect when user has onboarding generation job - they need to see their content modal
  // Skip redirect when returning from OAuth with openModal=contentGeneration (Google callback sends this)
  // Must check BOTH localStorage AND onboardingJobId state: we remove from localStorage when opening
  // the dialog, so a later run (e.g. when auth loads) would otherwise redirect before dialog shows
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const isOAuthReturnWithContentModal = searchParams.get("openModal") === "contentGeneration";
      if (isOAuthReturnWithContentModal) {
        return; // User just returned from OAuth - show landing with GenerateContentDialog, don't redirect
      }
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
      setInitialWebsiteUrl(null);
      setOnboardingModalOpen(true);
    }
  }, [initialOpenWebsiteModal]);

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
    if (!open) setInitialWebsiteUrl(null);
  };

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
          onGetStarted={handleGetStarted}
          showSignIn
          hideExplore
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
        />
        <LandingHeroStatsSection adCount={adCount} floatingTiles={floatingTiles} />
        {false && <DiscoverPreview onOpenWebsiteModal={handleGetStarted} />}
        <BrandsSection />
        {false && <HowItWorksSection />}
        {false && <FeaturesSection />}
        <TestimonialsSection onOpenOnboardingWithUrl={handleOpenOnboardingWithUrl} />
      </main>
      <FooterLanding />
      <OnboardingFlowModal
        open={onboardingModalOpen}
        onOpenChange={handleOnboardingModalOpenChange}
        initialWebsiteUrl={initialWebsiteUrl}
        copy="B"
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
            router.push("/discover?from_onboarding=1");
          }
        }}
        initialJobId={onboardingJobId}
        parentPage="home"
        landingStyle
        expectedImageCount={2}
        onboardingCopy="B"
        onDialogClosed={() => {
          trackOnboardingFlowCompleted("B");
          router.push("/discover?from_onboarding=1");
        }}
      />
    </div>
  );
}
