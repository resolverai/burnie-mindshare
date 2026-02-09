"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { StrategyCalendarView } from "@/components/calendar/StrategyCalendarView";
import { AppSidebar } from "@/components/AppSidebar";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { PricingModal } from "@/components/PricingModal";
import { Loader2, Menu } from "lucide-react";
import { dvybApi } from "@/lib/api";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function CalendarPage() {
  const router = useRouter();
  const { isAuthenticated, accountId, isLoading } = useAuth();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [activeView] = useState("calendar");
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

  const handleCreateAd = useCallback(async () => {
    if (hasActiveSubscription === false) {
      setShowPricingModal(true);
      return;
    }
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
        if (data.data.mustSubscribeToFreemium) {
          setMustSubscribeToFreemium(true);
          setQuotaType("both");
          setCanSkipPricingModal(false);
          setShowUpgradePricingModal(true);
          return;
        }
        setMustSubscribeToFreemium(false);
        const noImagesLeft = data.data.remainingImages === 0;
        if (noImagesLeft) {
          setQuotaType("both");
          setCanSkipPricingModal(false);
          setShowUpgradePricingModal(true);
        } else {
          setShowCreateAdFlow(true);
        }
      } else {
        setShowCreateAdFlow(true);
      }
    } catch {
      setShowCreateAdFlow(true);
    }
  }, [hasActiveSubscription]);

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
    const checkOnboardingStatus = async () => {
      if (isLoading) return;

      if (!isAuthenticated || !accountId) {
        // Redirect to landing page if not authenticated
        router.push("/");
        return;
      }

      // Check if onboarding is complete by checking localStorage
      // If user just completed onboarding, is_new_account would be in localStorage
      const isNewAccount = localStorage.getItem("dvyb_is_new_account");
      
      if (isNewAccount === "true") {
        // First time landing - onboarding just completed
        console.log("✅ First time user - onboarding completed");
        // Clear the flag
        localStorage.removeItem("dvyb_is_new_account");
      }

      setIsCheckingOnboarding(false);
    };

    checkOnboardingStatus();
  }, [isAuthenticated, accountId, isLoading, router]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") router.push("/subscription/manage");
    else if (view === "subscription") router.push("/subscription/manage");
    else if (view === "brand-plan") return; // Disabled
    // calendar is current page, no navigation needed
  };

  if (isLoading || isCheckingOnboarding) {
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

        {/* Strategy Calendar View */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <StrategyCalendarView />
        </div>
      </div>
      <OnboardingPricingModal
        open={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        userFlow={userFlow}
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

