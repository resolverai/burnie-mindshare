"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { PricingModal } from "@/components/PricingModal";
import { Loader2 } from "lucide-react";
import { dvybApi } from "@/lib/api";
import { trackLimitsReached } from "@/lib/mixpanel";

export default function ManageSubscriptionPage() {
  const [activeView] = useState("settings");
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
          trackLimitsReached("subscription_manage_create", "both");
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
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") return; // Already on settings/subscription
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
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        onCreateAd={handleCreateAd}
      />

      <main className="flex-1 flex flex-col overflow-hidden overflow-y-auto pb-24 lg:pb-0 order-2 min-h-0">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <SettingsPage />
        </div>
      </main>
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

