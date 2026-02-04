"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { BrandKitPage as BrandKitContent } from "@/components/pages/BrandKitPage";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";

function BrandKitPageInner() {
  const [activeView] = useState("brand-kit");
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeSubView, setActiveSubView] = useState<"style" | "source-materials">(() => {
    if (tabParam === "source-materials" || tabParam === "style") return tabParam;
    return "style"; // Default: Style tab
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const { completeStep } = useOnboardingGuide();

  // Sync activeSubView with URL tab param on mount and when tab param changes
  useEffect(() => {
    if (tabParam === "source-materials" || tabParam === "style") {
      setActiveSubView(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Redirect to landing page instead of login
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  // Mark brand kit as visited for onboarding
  useEffect(() => {
    completeStep('brand_kit_visited');
  }, [completeStep]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") {
      if (subView) {
        setActiveSubView(subView as "style" | "source-materials");
        router.replace(`/brand-kit?tab=${subView}`, { scroll: false });
      }
      return;
    }
    else if (view === "settings") router.push("/subscription/manage");
  };

  const handleTabChange = (tab: string) => {
    setActiveSubView(tab as "style" | "source-materials");
    router.replace(`/brand-kit?tab=${tab}`, { scroll: false });
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
    <div className="flex h-screen bg-[hsl(var(--app-content-bg))] overflow-hidden">
      {/* Sidebar */}
      <AppSidebar
        activeView={activeView}
        activeSubView={activeSubView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header with Hamburger */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-[hsl(var(--app-content-bg))]">
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

        {/* Brand Kit Page with Style and Source Materials tabs */}
        <div className="flex-1 overflow-y-auto">
          <BrandKitContent
            activeTab={activeSubView}
            onTabChange={handleTabChange}
          />
        </div>
      </div>
    </div>
  );
}

export default function BrandKitPageRoute() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    }>
      <BrandKitPageInner />
    </Suspense>
  );
}

