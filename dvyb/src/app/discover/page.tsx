"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { DiscoverScreen } from "@/components/pages/DiscoverScreen";
import { CreateAdFlowModal, type PreselectedInspiration } from "@/components/pages/CreateAdFlowModal";
import { OnboardingPricingModal } from "@/components/OnboardingPricingModal";
import { Loader2 } from "lucide-react";
import { dvybApi } from "@/lib/api";
import { trackLimitsReached } from "@/lib/mixpanel";

function DiscoverPageInner() {
  const [activeView] = useState("discover");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showCreateAdFlow, setShowCreateAdFlow] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [preselectedInspiration, setPreselectedInspiration] = useState<PreselectedInspiration | null>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null);
  const [userFlow, setUserFlow] = useState<"website_analysis" | "product_photoshot">("website_analysis");
  const [usageData, setUsageData] = useState<any>(null);
  const [createAdReturnPath, setCreateAdReturnPath] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();

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

  const handleCreateAd = useCallback(
    async (inspiration?: PreselectedInspiration) => {
      setPreselectedInspiration(inspiration ?? null);
      try {
        const res = await dvybApi.account.getUsage();
        if (res.success && res.data) {
          setUsageData(res.data);
          if (res.data.isAccountActive === false) return;
          const noImagesLeft = res.data.remainingImages === 0;
          if (noImagesLeft) {
            trackLimitsReached("discover_create_ad", "both");
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
    },
    []
  );

  useEffect(() => {
    if (searchParams.get("createAd") === "1" && isAuthenticated) {
      const returnPath = searchParams.get("return");
      if (returnPath) setCreateAdReturnPath(decodeURIComponent(returnPath));
      router.replace("/discover");
      handleCreateAd();
    }
  }, [searchParams, isAuthenticated, handleCreateAd]);

  const handleViewChange = (view: string, subView?: string) => {
    if (view === "discover") return;
    else if (view === "brands") router.push("/brands");
    else if (view === "content-library") router.push(subView ? `/content-library?tab=${subView}` : "/content-library");
    else if (view === "brand-kit") router.push(subView ? `/brand-kit?tab=${subView}` : "/brand-kit");
    else if (view === "settings") router.push("/subscription/manage");
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--landing-hero-bg))]">
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
        onCreateAd={() => handleCreateAd()}
      />

      <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto pb-24 lg:pb-0 order-2 min-h-0">
        <DiscoverScreen
          onCreateAd={handleCreateAd}
          hasActiveSubscription={hasActiveSubscription === true}
          onShowPricingModal={() => setShowPricingModal(true)}
        />
      </div>

      <OnboardingPricingModal
        open={showPricingModal}
        onClose={() => {
          setShowPricingModal(false);
          if (createAdReturnPath) {
            router.push(createAdReturnPath);
            setCreateAdReturnPath(null);
          }
        }}
        userFlow={usageData?.initialAcquisitionFlow || userFlow}
        isOnboardingFlow={true}
      />

      <CreateAdFlowModal
        open={showCreateAdFlow}
        onOpenChange={(open) => {
          setShowCreateAdFlow(open);
          if (!open) setPreselectedInspiration(null);
        }}
        preselectedInspiration={preselectedInspiration}
      />
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--landing-hero-bg))]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    }>
      <DiscoverPageInner />
    </Suspense>
  );
}
