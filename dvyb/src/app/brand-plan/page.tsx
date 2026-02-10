"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { PricingModal } from "@/components/PricingModal";
import { Loader2, Menu } from "lucide-react";
import { TutorialButton } from "@/components/TutorialButton";
import { dvybApi } from "@/lib/api";
import { trackLimitsReached } from "@/lib/mixpanel";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function BrandPlanPage() {
  const [activeView] = useState("brand-plan");
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
          trackLimitsReached("brand_plan_create", "both");
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

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Redirect to landing page instead of login
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") router.push("/subscription/manage");
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
      {/* Sidebar */}
      <AppSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        onCreateAd={handleCreateAd}
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

        {/* Header - Desktop only */}
        <header className="hidden md:flex items-center justify-between px-4 md:px-8 py-4 md:py-6 border-b border-border bg-background">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-16 md:w-32 md:h-24">
                <Image src={dvybLogo} alt="Dvyb Logo" fill className="object-contain" priority />
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-2 md:px-3 lg:px-4 py-4 md:py-6">
            <div className="flex items-center justify-end gap-4 mb-6">
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-display mr-auto">Brand Plan</h1>
              <TutorialButton screen="brand-plan" />
            </div>
            <div className="text-center py-20">
              <p className="text-muted-foreground">Coming soon...</p>
            </div>
          </div>
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

