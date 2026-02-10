"use client";

import { useState, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Search, Building2, Users, Image as ImageIcon, Loader2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dvybApi } from "@/lib/api";
import { trackCheckoutStarted, trackStartNowClicked, trackExploreMoreFeaturesClicked } from "@/lib/mixpanel";

interface PricingPlan {
  id: number;
  planName: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  annualImageLimit: number;
  annualVideoLimit: number;
  isFreeTrialPlan: boolean;
  planFlow?: "website_analysis" | "product_photoshot";
  dealActive?: boolean;
  dealMonthlyPrice?: number | null;
  dealAnnualPrice?: number | null;
}

const features = [
  { icon: Search, title: "Unlimited discovery", description: "Browse and search as many ads as you want" },
  { icon: Building2, title: "Unlimited brands", description: "Search and track all relevant brands" },
  { icon: Users, title: "Unlimited saving", description: "Like an ad? Save it. No cap." },
];

interface OnboardingPricingModalProps {
  open: boolean;
  onClose: () => void;
  userFlow?: "website_analysis" | "product_photoshot";
  /** When true, success→My Ads, cancel→Discover. Otherwise redirect to same page. */
  isOnboardingFlow?: boolean;
}

export function OnboardingPricingModal({
  open,
  onClose,
  userFlow = "website_analysis",
  isOnboardingFlow = false,
}: OnboardingPricingModalProps) {
  const pathname = usePathname() ?? "/home";
  const router = useRouter();
  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [hasVisitedDiscover, setHasVisitedDiscover] = useState<boolean | null>(null);

  useEffect(() => {
    if (open) {
      fetchLowestPlan();
    }
  }, [open, userFlow]);

  useEffect(() => {
    if (open) {
      const fetchHasVisitedDiscover = async () => {
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "https://mindshareapi.burnie.io"}/dvyb/account/usage`,
            { credentials: "include", headers: { ...(typeof window !== "undefined" && localStorage.getItem("dvyb_account_id") ? { "X-DVYB-Account-ID": localStorage.getItem("dvyb_account_id")! } : {}) } }
          );
          const data = await res.json();
          if (data.success && data.data) {
            setHasVisitedDiscover(data.data.hasVisitedDiscover === true);
          }
        } catch {
          /* ignore */
        }
      };
      fetchHasVisitedDiscover();
    }
  }, [open]);

  const fetchLowestPlan = async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "https://mindshareapi.burnie.io"}/dvyb/account/pricing-plans?includeFree=true&flow=${userFlow}`
      );
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const paidPlans = data.data.filter(
          (p: PricingPlan) => !p.isFreeTrialPlan && p.monthlyPrice > 0
        );
        // Sort by effective monthly price (deal price if active, else base price) to show lowest value
        const effectivePrice = (p: PricingPlan) =>
          p.dealActive && p.dealMonthlyPrice != null ? p.dealMonthlyPrice : p.monthlyPrice;
        const sorted = [...paidPlans].sort(
          (a: PricingPlan, b: PricingPlan) => effectivePrice(a) - effectivePrice(b)
        );
        setPlan(sorted[0] || null);
      }
    } catch (e) {
      console.error("Error fetching pricing plans:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleStartNow = async () => {
    if (!plan || isLoading) return;

    trackStartNowClicked({
      planName: plan.planName,
      billingCycle,
      source: isOnboardingFlow ? "onboarding_pricing_modal" : "pricing_page",
    });
    setIsLoading(true);
    try {
      const priceToCharge = billingCycle === "monthly"
        ? (plan.dealActive && plan.dealMonthlyPrice != null ? plan.dealMonthlyPrice : plan.monthlyPrice)
        : (plan.dealActive && plan.dealAnnualPrice != null ? plan.dealAnnualPrice : plan.annualPrice);
      trackCheckoutStarted({
        planName: plan.planName,
        billingCycle,
        price: priceToCharge,
        hasPromoCode: false,
      });

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const search = typeof window !== "undefined" ? window.location.search : "";
      const successPath = isOnboardingFlow ? "/content-library?tab=my-ads" : (pathname + search);
      const cancelPath = isOnboardingFlow ? "/discover" : (pathname + search);
      const data = await dvybApi.subscription.createCheckout(plan.id, billingCycle, undefined, {
        successUrl: `${origin}${successPath.startsWith("/") ? successPath : "/" + successPath}`,
        cancelUrl: `${origin}${cancelPath.startsWith("/") ? cancelPath : "/" + cancelPath}`,
      });
      if (data.success && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        console.error("Checkout failed:", data.error);
        alert("Failed to start checkout. Please try again.");
      }
    } catch (e) {
      console.error("Checkout error:", e);
      alert("Failed to start checkout. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const hasDeal = plan?.dealActive && plan.dealMonthlyPrice != null && plan.dealAnnualPrice != null;
  const originalMonthly = plan?.monthlyPrice ?? 0;
  const originalAnnual = plan?.annualPrice ?? 0;
  const dealMonthly = plan?.dealMonthlyPrice ?? 0;
  const dealAnnual = plan?.dealAnnualPrice ?? 0;

  const displayPrice = billingCycle === "monthly"
    ? (hasDeal ? dealMonthly : originalMonthly)
    : (hasDeal ? dealAnnual : originalAnnual);

  const originalPrice = billingCycle === "monthly" ? originalMonthly : originalAnnual;
  const dealPercent = hasDeal && originalPrice > 0
    ? Math.round((1 - (billingCycle === "monthly" ? dealMonthly : dealAnnual) / originalPrice) * 100)
    : 0;

  // Annual toggle "save %": when deal exists, show deal discount (e.g. 76% off); otherwise annual vs monthly savings
  const annualSavings = useMemo(() => {
    if (!plan) return 0;
    if (hasDeal && plan.dealAnnualPrice != null && plan.annualPrice > 0) {
      return Math.round((1 - plan.dealAnnualPrice / plan.annualPrice) * 100);
    }
    const monthlyCost12 = plan.monthlyPrice * 12;
    if (monthlyCost12 <= 0) return 0;
    return Math.round(((monthlyCost12 - plan.annualPrice) / monthlyCost12) * 100);
  }, [plan, hasDeal]);

  const imageLimit = plan
    ? billingCycle === "monthly"
      ? plan.monthlyImageLimit
      : plan.annualImageLimit
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setHasVisitedDiscover(null); onClose(); } }}>
      <DialogContent
        className="max-w-md w-[95vw] sm:w-full max-h-[90vh] p-0 overflow-hidden flex flex-col"
        hideCloseButton={true}
      >
        {/* Sticky close button: always visible on mobile when content scrolls */}
        <div className="sticky top-0 z-10 flex justify-end shrink-0 bg-background pt-3 pr-3 pb-0 pl-0 rounded-t-lg">
          <button
            type="button"
            onClick={() => { setHasVisitedDiscover(null); onClose(); }}
            className="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 pt-2">
          <h2 className="sr-only">Upgrade to {plan?.planName || "Pro"}</h2>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Loading plans...</p>
            </div>
          ) : plan ? (
            <>
              {/* Billing Toggle - Monthly / Annual (wander style) */}
              <div className="flex items-center justify-center mb-6">
                <div className="flex items-center bg-secondary rounded-full p-1">
                  <button
                    type="button"
                    onClick={() => setBillingCycle("monthly")}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      billingCycle === "monthly"
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingCycle("annual")}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                      billingCycle === "annual"
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Annual
                    {annualSavings > 0 && (
                      <span className="text-xs text-green-500 font-semibold">
                        (save {annualSavings}%)
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-3xl font-bold mb-1">{plan.planName}</h2>
                <p className="text-muted-foreground">
                  {plan.description || "For serious brands & agencies"}
                </p>
              </div>

              {/* Pricing */}
              <div className="flex items-baseline gap-2 mb-4">
                {hasDeal && originalPrice > displayPrice && (
                  <span className="text-2xl text-muted-foreground line-through">
                    ${originalPrice}
                  </span>
                )}
                <span className="text-4xl font-bold">${displayPrice}</span>
                <span className="text-muted-foreground">
                  {billingCycle === "monthly" ? "/month" : "/year"}
                </span>
                {hasDeal && dealPercent > 0 && (
                  <span className="text-sm text-green-500 font-semibold ml-2">
                    ({dealPercent}% off)
                  </span>
                )}
              </div>

              {/* Image Ads - Main Value */}
              <div className="flex items-center gap-3 mb-8 p-4 rounded-2xl bg-orange-100 dark:bg-orange-500/20">
                <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold">
                  {imageLimit} image Ads
                </span>
              </div>

              {/* Features */}
              <div className="mb-8">
                <p className="font-medium mb-4">Full access to:</p>
                <div className="space-y-4">
                  {features.map((f) => (
                    <div key={f.title} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                          <f.icon className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{f.title}</p>
                          <p className="text-sm text-muted-foreground">{f.description}</p>
                        </div>
                      </div>
                      <Check className="w-5 h-5 text-orange-500 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA Button */}
              <Button
                onClick={handleStartNow}
                disabled={isLoading}
                className="w-full py-6 text-lg font-semibold rounded-full bg-orange-500 hover:bg-orange-600 text-white"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  "Start now"
                )}
              </Button>

              {/* Explore More - secondary CTA: only show when user hasn't visited discover yet */}
              {hasVisitedDiscover === false && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    trackExploreMoreFeaturesClicked("pricing_modal");
                    onClose();
                    router.push("/discover");
                  }}
                  className="w-full py-5 mt-3 text-base font-medium rounded-full bg-neutral-900 hover:bg-neutral-800 text-white"
                >
                  No I will Explore More
                </Button>
              )}

              {/* Footer */}
              <p className="text-center text-xs text-muted-foreground mt-6 pt-6 border-t border-border">
                *Prices shown in USD
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">No plans available. Please try again later.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
