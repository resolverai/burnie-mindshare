"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { MyContentPage } from "@/components/pages/MyContentPage";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";

type TabId = "my-ads" | "my-products" | "saved-ads";

function ContentLibraryPageInner() {
  const [activeView] = useState("content-library");
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeSubView, setActiveSubView] = useState<TabId>(() => {
    if (tabParam === "my-ads" || tabParam === "my-products" || tabParam === "saved-ads") return tabParam;
    return "my-ads";
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isEditDesignMode, setIsEditDesignMode] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const { completeStep, getCurrentHighlight } = useOnboardingGuide();
  const currentHighlight = getCurrentHighlight();

  useEffect(() => {
    if (tabParam === "my-ads" || tabParam === "my-products" || tabParam === "saved-ads") {
      setActiveSubView(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    completeStep("content_library_visited");
  }, [completeStep]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") {
      if (subView) {
        setActiveSubView(subView as TabId);
        router.replace(`/content-library?tab=${subView}`, { scroll: false });
      }
      return;
    } else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") router.push("/subscription/manage");
  };

  const handleTabChange = (tab: TabId) => {
    setActiveSubView(tab);
    router.replace(`/content-library?tab=${tab}`, { scroll: false });
  };

  const handleOnboardingHighlightClick = (item: string) => {
    if (item === "brand_kit") {
      completeStep("brand_kit_visited");
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
    <div className="flex h-screen bg-[hsl(var(--app-content-bg))] overflow-hidden">
      <AppSidebar
        activeView={activeView}
        activeSubView={activeSubView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        forceCollapsed={isEditDesignMode}
        onboardingHighlight={currentHighlight === "brand_kit" ? currentHighlight : null}
        onHighlightClick={handleOnboardingHighlightClick}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
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
          <div className="w-10" />
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <MyContentPage
            activeTab={activeSubView}
            onTabChange={handleTabChange}
            onEditDesignModeChange={setIsEditDesignMode}
          />
        </div>
      </div>
    </div>
  );
}

export default function ContentLibraryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    }>
      <ContentLibraryPageInner />
    </Suspense>
  );
}
