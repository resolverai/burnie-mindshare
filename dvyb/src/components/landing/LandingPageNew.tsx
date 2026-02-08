"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
import { tileImages } from "@/lib/tileImages";

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
 * New landing page design for dvyb (website analysis flow).
 * Hero has no website input — only CTAs. Website URL is collected in a modal
 * when the user clicks "Create your first brand ad" or nav "Get Started".
 * After analysis completes, the onboarding flow modal is shown: inspiration → product → login,
 * all in one seamless modal (no close/reopen between steps).
 * After Google login, user returns here with content generation job - GenerateContentDialog opens automatically.
 */
export function LandingPageNew({ onAnalysisComplete, initialOpenWebsiteModal }: LandingPageNewProps) {
  const router = useRouter();
  const { completeStep } = useOnboardingGuide();
  const [websiteModalOpen, setWebsiteModalOpen] = useState(false);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
  const [showNotRegisteredModal, setShowNotRegisteredModal] = useState(false);
  const [adCount, setAdCount] = useState(getInitialAdCount);
  const [floatingTiles, setFloatingTiles] = useState<{ id: number; delay: number; imageIndex: number }[]>([]);
  const nextImageIndexRef = useRef(0);
  const searchParams = useSearchParams();

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
      setWebsiteModalOpen(true);
    }
  }, [initialOpenWebsiteModal]);

  // After OAuth: user returns with content generation job - open GenerateContentDialog (like ContentLibrary)
  useEffect(() => {
    const storedJobId = localStorage.getItem("dvyb_onboarding_generation_job_id");
    if (storedJobId) {
      console.log("🎉 Landing: Onboarding generation job detected, opening GenerateContentDialog");
      setOnboardingJobId(storedJobId);
      localStorage.removeItem("dvyb_onboarding_generation_job_id");
      completeStep("auto_content_viewed");
      setTimeout(() => {
        setShowGenerateDialog(true);
      }, 800);
    }
  }, [completeStep]);

  const handleGetStarted = () => {
    setOnboardingModalOpen(false);
    setWebsiteModalOpen(true);
  };

  const handleWebsiteModalOpenChange = (open: boolean) => {
    if (open) {
      setOnboardingModalOpen(false);
    }
    setWebsiteModalOpen(open);
  };

  const handleShowInspirationModal = () => {
    setOnboardingModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <NavigationLanding onGetStarted={handleGetStarted} showSignIn hideExplore />
      <main>
        <HeroSection
          onAnalysisComplete={onAnalysisComplete}
          onShowInspirationModal={handleShowInspirationModal}
          websiteModalOpen={websiteModalOpen}
          onWebsiteModalOpenChange={handleWebsiteModalOpenChange}
          adCount={adCount}
          floatingTiles={floatingTiles}
        />
        <DiscoverPreview onOpenWebsiteModal={handleGetStarted} />
        <HowItWorksSection />
        <BrandsSection />
        <FeaturesSection />
        <TestimonialsSection />
      </main>
      <FooterLanding />
      <OnboardingFlowModal open={onboardingModalOpen} onOpenChange={setOnboardingModalOpen} />
      <NotRegisteredModal
        open={showNotRegisteredModal}
        onOpenChange={setShowNotRegisteredModal}
        onGetStarted={handleGetStarted}
      />
      <GenerateContentDialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          setShowGenerateDialog(open);
          if (!open) router.push("/discover");
        }}
        initialJobId={onboardingJobId}
        parentPage="home"
        landingStyle
        expectedImageCount={2}
        onDialogClosed={() => router.push("/discover")}
      />
    </div>
  );
}
