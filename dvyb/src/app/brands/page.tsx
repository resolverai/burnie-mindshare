"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { BrandsScreen } from "@/components/pages/BrandsScreen";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { dvybApi } from "@/lib/api";
import { trackLimitsReached } from "@/lib/mixpanel";

export default function BrandsPage() {
  const [activeView] = useState("brands");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showCreateAdFlow, setShowCreateAdFlow] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null);
  const [userFlow, setUserFlow] = useState<"website_analysis" | "product_photoshot">("website_analysis");
  const [usageData, setUsageData] = useState<any>(null);
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
        const noImagesLeft = data.data.remainingImages === 0;
        if (noImagesLeft) {
          trackLimitsReached("brands_create", "both");
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
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const res = await dvybApi.subscription.getCurrentSubscription();
        if (res.success && res.data) {
          const sub = res.data.subscription;
          const isSubscribed = res.data.isSubscribed === true;
          const status = sub?.status;
          setHasActiveSubscription(
            isSubscribed && (status === "active" || status === "trialing")
          );
          const flow =
            res.data.currentPlan?.initialAcquisitionFlow ??
            res.data.subscription?.plan?.initialAcquisitionFlow;
          if (flow === "product_photoshot" || flow === "website_analysis") {
            setUserFlow(flow);
          }
        } else {
          setHasActiveSubscription(false);
        }
      } catch {
        setHasActiveSubscription(false);
      }
    };
    const fetchPlanForFlow = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "https://mindshareapi.burnie.io"}/dvyb/account/plan`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (data.success && data.data?.initialAcquisitionFlow) {
          const flow = data.data.initialAcquisitionFlow;
          if (flow === "product_photoshot" || flow === "website_analysis") {
            setUserFlow(flow);
          }
        }
      } catch {
        /* ignore */
      }
    };
    if (isAuthenticated) {
      fetchSubscription();
      fetchPlanForFlow();
    }
  }, [isAuthenticated]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") router.push("/discover");
    else if (view === "brands") return;
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") router.push("/subscription/manage");
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--app-content-bg))]">
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
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        onCreateAd={handleCreateAd}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--app-content-bg))]">
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

        <BrandsScreen
          hasActiveSubscription={hasActiveSubscription === true}
          onShowPricingModal={() => setShowPricingModal(true)}
        />
      </div>

      <OnboardingPricingModal
        open={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        userFlow={usageData?.initialAcquisitionFlow || userFlow}
        isOnboardingFlow={true}
      />

      <CreateAdFlowModal
        open={showCreateAdFlow}
        onOpenChange={setShowCreateAdFlow}
      />
    </div>
  );
}
