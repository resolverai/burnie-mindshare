"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { BrandKitPage as BrandKitContent } from "@/components/pages/BrandKitPage";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { PricingModal } from "@/components/PricingModal";
import { Loader2 } from "lucide-react";
import { dvybApi } from "@/lib/api";
import { trackLimitsReached } from "@/lib/mixpanel";
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
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showUpgradePricingModal, setShowUpgradePricingModal] = useState(false);
  const [showCreateAdFlow, setShowCreateAdFlow] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null);
  const [userFlow, setUserFlow] = useState<"website_analysis" | "product_photoshot">("website_analysis");
  const [usageData, setUsageData] = useState<any>(null);
  const [quotaType, setQuotaType] = useState<"image" | "video" | "both">("both");
  const [canSkipPricingModal, setCanSkipPricingModal] = useState(false);
  const [mustSubscribeToFreemium, setMustSubscribeToFreemium] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const { completeStep } = useOnboardingGuide();

  const handleCreateAd = useCallback(async () => {
    // Ad creation: only show pricing when limits exhausted (not when free trial with quota left)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "https://mindshareapi.burnie.io"}/dvyb/account/usage`,
        {
          credentials: "include",
          headers: {
            ...(() => {
              const accountId = localStorage.getItem("dvyb_account_id");
              return accountId ? { "X-DVYB-Account-ID": accountId } : {};
            })(),
          },
        }
      );
      const data = await response.json();
      if (data.success && data.data) {
        setUsageData(data.data);
        if (data.data.isAccountActive === false) return;
        // Same as Discover/Brands: quota takes precedence; only show pricing when no images left
        const noImagesLeft = data.data.remainingImages === 0;
        if (noImagesLeft) {
          trackLimitsReached("brand_kit_create", "both");
          setShowPricingModal(true);
        } else {
          setShowCreateAdFlow(true);
        }
      } else {
        setShowCreateAdFlow(true);
      }
    } catch {
      setShowCreateAdFlow(true);
    }
  }, []);

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const res = await dvybApi.subscription.getCurrentSubscription();
        if (res.success && res.data) {
          const sub = res.data.subscription;
          const isSubscribed = res.data.isSubscribed === true;
          const status = sub?.status;
          setHasActiveSubscription(isSubscribed && (status === "active" || status === "trialing"));
          const flow = res.data.currentPlan?.initialAcquisitionFlow ?? res.data.subscription?.plan?.initialAcquisitionFlow;
          if (flow === "product_photoshot" || flow === "website_analysis") setUserFlow(flow);
        } else {
          setHasActiveSubscription(false);
        }
      } catch {
        setHasActiveSubscription(false);
      }
    };
    if (isAuthenticated) fetchSubscription();
  }, [isAuthenticated]);

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
    <div className="flex flex-col lg:flex-row h-screen bg-[hsl(var(--app-content-bg))] overflow-hidden">
      <AppSidebar
        activeView={activeView}
        activeSubView={activeSubView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        onCreateAd={handleCreateAd}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto pb-24 lg:pb-0 order-2 min-h-0">
        {/* Brand Kit Page with Style and Source Materials tabs */}
        <div className="flex-1 overflow-y-auto">
          <BrandKitContent
            activeTab={activeSubView}
            onTabChange={handleTabChange}
          />
        </div>
      </div>
      <OnboardingPricingModal
        open={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        userFlow={usageData?.initialAcquisitionFlow || userFlow}
        isOnboardingFlow={true}
      />

      <PricingModal
        open={showUpgradePricingModal}
        onClose={() => {
          setShowUpgradePricingModal(false);
          if (canSkipPricingModal && !mustSubscribeToFreemium) {
            setShowCreateAdFlow(true);
          }
        }}
        currentPlanInfo={
          usageData
            ? {
                planName: usageData.planName || "Free Trial",
                planId: usageData.planId || null,
                monthlyPrice: usageData.monthlyPrice || 0,
                annualPrice: usageData.annualPrice || 0,
                billingCycle: usageData.billingCycle || "monthly",
                isFreeTrialPlan: usageData.isFreeTrialPlan || false,
              }
            : null
        }
        quotaType={quotaType}
        isAuthenticated={true}
        canSkip={!mustSubscribeToFreemium && canSkipPricingModal}
        reason={mustSubscribeToFreemium ? "freemium_required" : "quota_exhausted"}
        userFlow={usageData?.initialAcquisitionFlow || "website_analysis"}
        mustSubscribe={mustSubscribeToFreemium}
      />

      <CreateAdFlowModal
        open={showCreateAdFlow}
        onOpenChange={setShowCreateAdFlow}
      />
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

