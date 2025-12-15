"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { ContentLibrary } from "@/components/pages/ContentLibrary";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";

export default function ContentLibraryPage() {
  const [activeView] = useState("content-library");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isEditDesignMode, setIsEditDesignMode] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const { completeStep, getCurrentHighlight } = useOnboardingGuide();
  const currentHighlight = getCurrentHighlight();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Redirect to landing page instead of login
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  // Mark content library as visited for onboarding
  useEffect(() => {
    completeStep('content_library_visited');
  }, [completeStep]);

  const handleViewChange = (view: string) => {
    if (view === "home") router.push("/home");
    else if (view === "calendar") router.push("/calendar");
    else if (view === "brand-kit") router.push("/brand-kit");
    else if (view === "subscription") router.push("/subscription/manage");
    else if (view === "brand-plan") return; // Disabled
  };

  // Handle clicks on highlighted onboarding items
  const handleOnboardingHighlightClick = (item: string) => {
    if (item === 'brand_kit') {
      completeStep('brand_kit_visited');
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
          <p className="text-base md:text-lg text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar - Collapse on desktop when Edit Design is active */}
      <AppSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        forceCollapsed={isEditDesignMode}
        onboardingHighlight={currentHighlight === 'brand_kit' ? currentHighlight : null}
        onHighlightClick={handleOnboardingHighlightClick}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header with Hamburger */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-foreground" />
          </button>
          
          <div className="flex items-center gap-2">
            <Image src={dvybLogo} alt="Dvyb Logo" width={80} height={32} className="object-contain" priority />
          </div>
          
          {/* Empty div for spacing */}
          <div className="w-10" />
        </div>

        {/* Content Library Component */}
        <div className="flex-1 overflow-y-auto">
          <ContentLibrary 
            onEditDesignModeChange={setIsEditDesignMode}
          />
        </div>
      </div>
    </div>
  );
}

