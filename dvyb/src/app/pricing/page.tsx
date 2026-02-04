"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Check, 
  Loader2,
  Gift,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { NavigationLanding } from "@/components/landing/NavigationLanding";
import { FooterLanding } from "@/components/landing/FooterLanding";

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
  extraImagePostPrice: number;
  extraVideoPostPrice: number;
  isFreeTrialPlan: boolean;
  planFlow?: 'website_analysis' | 'product_photoshot';
}

// Billing toggle — aligned with new frontend pill style (landing)
const BillingToggle = ({ 
  billingCycle, 
  onChange 
}: { 
  billingCycle: 'monthly' | 'annual'; 
  onChange: (cycle: 'monthly' | 'annual') => void;
}) => {
  return (
    <div className="inline-flex items-center gap-1 rounded-full p-1 bg-[hsl(var(--landing-explore-pill-bg))] border border-[hsl(var(--landing-nav-bar-border))]">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
          billingCycle === 'monthly'
            ? "bg-[hsl(var(--landing-cta-bg))] text-white shadow-soft"
            : "text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange('annual')}
        className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
          billingCycle === 'annual'
            ? "bg-[hsl(var(--landing-cta-bg))] text-white shadow-soft"
            : "text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]"
        }`}
      >
        Annual
        <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${
          billingCycle === 'annual' ? "bg-white/20 text-white" : "bg-[hsl(var(--landing-accent-orange))] text-white"
        }`}>
          Save 20%
        </span>
      </button>
    </div>
  );
};

// Build feature list for card (new frontend style: simple list with Check)
function getPlanFeatures(plan: PricingPlan, billingCycle: 'monthly' | 'annual'): string[] {
  const isFree = plan.isFreeTrialPlan;
  const isProductFlow = plan.planFlow === 'product_photoshot';
  const imageLabel = isProductFlow ? "images" : "image posts";
  const videoLabel = isProductFlow ? "videos" : "video posts";
  const imageLimit = isFree ? plan.monthlyImageLimit : (billingCycle === 'monthly' ? plan.monthlyImageLimit : plan.annualImageLimit);
  const videoLimit = isFree ? plan.monthlyVideoLimit : (billingCycle === 'monthly' ? plan.monthlyVideoLimit : plan.annualVideoLimit);
  const period = isFree ? "during trial" : (billingCycle === 'monthly' ? "per month" : "per year");
  const features: string[] = [
    `${imageLimit} ${imageLabel} ${period}`,
    `${videoLimit} ${videoLabel} ${period}`,
    "AI-powered content generation",
    "Multi-platform scheduling",
    "Brand kit & content library",
    "Analytics dashboard",
  ];
  if (!isFree) features.push("Priority support");
  return features;
}

// Plan Card — aligned with new frontend (rounded-3xl, popular = dark card, accent badge, list + CTA)
const PlanCard = ({
  plan,
  displayPlans,
  billingCycle,
  onGetStarted,
  index,
}: {
  plan: PricingPlan;
  displayPlans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  onGetStarted: () => void;
  index: number;
}) => {
  const paidPlans = displayPlans.filter(p => !p.isFreeTrialPlan);
  const isPopular = !plan.isFreeTrialPlan && paidPlans.length > 1 && paidPlans[Math.floor(paidPlans.length / 2)]?.id === plan.id;
  const isFree = plan.isFreeTrialPlan;

  const getPrice = () => isFree ? 0 : (billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice);
  const getPeriod = () => (isFree ? "" : billingCycle === 'monthly' ? "/month" : "/year");
  const getAnnualSavings = () => {
    if (isFree) return 0;
    const monthlyCost = plan.monthlyPrice * 12;
    const annualCost = plan.annualPrice;
    const savings = Math.round(((monthlyCost - annualCost) / monthlyCost) * 100);
    return savings > 0 ? savings : 0;
  };

  const features = getPlanFeatures(plan, billingCycle);
  const popular = isPopular;

  return (
    <div
      className={`relative rounded-3xl p-8 animate-fade-up h-full flex flex-col ${
        popular
          ? "bg-[hsl(var(--landing-cta-bg))] text-white shadow-card scale-105"
          : "bg-card border border-border shadow-soft"
      }`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold">
            Most Popular
          </span>
        </div>
      )}
      {isFree && !popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold">
            Free Trial
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{plan.planName}</h3>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold">{isFree ? "Free" : `$${getPrice()}`}</span>
          {!isFree && (
            <span className={popular ? "text-white/70" : "text-muted-foreground"}>
              {getPeriod()}
            </span>
          )}
        </div>
        {plan.description && (
          <p className={`mt-2 text-sm ${popular ? "text-white/80" : "text-muted-foreground"}`}>
            {plan.description}
          </p>
        )}
        {!isFree && billingCycle === "annual" && getAnnualSavings() > 0 && (
          <p className={`mt-1 text-sm font-medium ${popular ? "text-white/90" : "text-[hsl(var(--landing-accent-orange))]"}`}>
            Save {getAnnualSavings()}% vs monthly
          </p>
        )}
      </div>
      {isFree && (
        <p className={`text-sm -mt-2 mb-2 ${popular ? "text-white/90" : "text-muted-foreground"}`}>
          7-day trial, no credit card required
        </p>
      )}

      <ul className="space-y-3 mb-8 flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <Check className={`w-5 h-5 flex-shrink-0 ${popular ? "text-[hsl(var(--landing-accent-orange))]" : "text-[hsl(var(--landing-accent-orange))]"}`} />
            <span className={`text-sm ${popular ? "text-white/90" : ""}`}>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onGetStarted}
        className={`w-full py-3 rounded-full font-medium transition-all ${
          popular
            ? "bg-card text-foreground hover:shadow-soft"
            : "bg-[hsl(var(--landing-cta-bg))] text-white hover:opacity-90"
        }`}
      >
        {isFree ? (
          <span className="inline-flex items-center gap-2">
            <Gift className="w-4 h-4" />
            Start Free Trial
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Get Started
          </span>
        )}
      </button>

      {!isFree && (plan.extraImagePostPrice > 0 || plan.extraVideoPostPrice > 0) && (
        <p className={`text-center text-sm mt-4 ${popular ? "text-white/70" : "text-muted-foreground"}`}>
          Extra: ${plan.extraImagePostPrice}/image, ${plan.extraVideoPostPrice}/video
        </p>
      )}
    </div>
  );
};

// Arrow-based carousel for desktop/tablet when there are more plans than fit in one row (2 on tablet, 3 on desktop)
const PlanCarousel = ({
  plans,
  billingCycle,
  onGetStarted,
}: {
  plans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  onGetStarted: () => void;
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(3);

  useEffect(() => {
    const updateVisibleCount = () => {
      setVisibleCount(window.innerWidth >= 1024 ? 3 : 2);
    };
    updateVisibleCount();
    window.addEventListener('resize', updateVisibleCount);
    return () => window.removeEventListener('resize', updateVisibleCount);
  }, []);

  const maxIndex = Math.max(0, plans.length - visibleCount);
  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < maxIndex;
  const gapPx = visibleCount === 3 ? 32 : 24; // gap-8 = 32px, gap-6 = 24px

  // All plans fit in one row — show simple grid, no arrows
  if (plans.length <= visibleCount) {
    return (
      <div className={`grid gap-6 md:gap-8 max-w-5xl mx-auto ${
        plans.length === 1 ? 'grid-cols-1 max-w-md mx-auto' :
        plans.length === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto' :
        'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
      }`}>
        {plans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            displayPlans={plans}
            billingCycle={billingCycle}
            onGetStarted={onGetStarted}
            index={index}
          />
        ))}
      </div>
    );
  }

  const cardWidthPercent = (100 - (visibleCount - 1) * (gapPx / 16)) / visibleCount; // approximate

  return (
    <div className="relative max-w-5xl mx-auto">
      <button
        type="button"
        onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
        disabled={!canGoLeft}
        aria-label="Previous plans"
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full border shadow-soft flex items-center justify-center transition-all ${
          canGoLeft
            ? 'bg-card border-[hsl(var(--landing-nav-bar-border))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]'
            : 'bg-[hsl(var(--landing-explore-pill-bg))] border-[hsl(var(--landing-nav-bar-border))] text-muted-foreground opacity-50 cursor-not-allowed'
        }`}
        style={{ left: '-12px' }}
      >
        <ChevronLeft className="w-5 h-5 lg:w-6 lg:h-6" />
      </button>

      <button
        type="button"
        onClick={() => setCurrentIndex((i) => Math.min(maxIndex, i + 1))}
        disabled={!canGoRight}
        aria-label="Next plans"
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full border shadow-soft flex items-center justify-center transition-all ${
          canGoRight
            ? 'bg-card border-[hsl(var(--landing-nav-bar-border))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]'
            : 'bg-[hsl(var(--landing-explore-pill-bg))] border-[hsl(var(--landing-nav-bar-border))] text-muted-foreground opacity-50 cursor-not-allowed'
        }`}
        style={{ right: '-12px' }}
      >
        <ChevronRight className="w-5 h-5 lg:w-6 lg:h-6" />
      </button>

      <div className="overflow-hidden px-1 pt-8 pb-2">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            gap: `${gapPx}px`,
            transform: `translateX(calc(-${currentIndex} * ( (100% - ${(visibleCount - 1) * gapPx}px) / ${visibleCount} + ${gapPx}px ) ))`,
          }}
        >
          {plans.map((plan, index) => (
            <div
              key={plan.id}
              className="flex-shrink-0"
              style={{
                width: `calc((100% - ${(visibleCount - 1) * gapPx}px) / ${visibleCount})`,
                minWidth: `calc((100% - ${(visibleCount - 1) * gapPx}px) / ${visibleCount})`,
              }}
            >
              <PlanCard
                plan={plan}
                displayPlans={plans}
                billingCycle={billingCycle}
                onGetStarted={onGetStarted}
                index={index}
              />
            </div>
          ))}
        </div>
      </div>

      {maxIndex > 0 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: maxIndex + 1 }).map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Go to page ${idx + 1}`}
              className={`h-2.5 rounded-full transition-all ${
                idx === currentIndex
                  ? 'bg-[hsl(var(--landing-cta-bg))] w-6'
                  : 'w-2.5 bg-[hsl(var(--landing-nav-bar-border))] hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Inner component that uses useSearchParams
function PricingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const flowParam = searchParams.get('flow');
  const planFlow = (flowParam === 'website_analysis' || flowParam === 'product_photoshot') 
    ? flowParam 
    : 'website_analysis';

  useEffect(() => {
    fetchPlans();
  }, [planFlow]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/pricing-plans?includeFree=true&flow=${planFlow}`
      );
      const data = await response.json();
      if (data.success) setPlans(data.data);
    } catch (error) {
      console.error('Error fetching pricing plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGetStarted = () => router.push('/');

  const displayPlans = [...plans].sort((a, b) => {
    if (a.isFreeTrialPlan && !b.isFreeTrialPlan) return -1;
    if (!a.isFreeTrialPlan && b.isFreeTrialPlan) return 1;
    return a.monthlyPrice - b.monthlyPrice;
  });

  return (
    <div className="min-h-screen bg-[hsl(var(--landing-hero-bg))]">
      <NavigationLanding onGetStarted={handleGetStarted} hideExplore />
      <main className="pt-20 sm:pt-28 pb-20 px-4 sm:px-6">
        <div className="container mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
            <h1 className="text-4xl md:text-5xl font-semibold mb-4 animate-fade-up text-foreground">
              Simple, transparent pricing
            </h1>
            <p className="text-lg text-muted-foreground animate-fade-up" style={{ animationDelay: "0.1s" }}>
              Choose the plan that&apos;s right for your team. All plans include a 14-day free trial.
            </p>
          </div>

          {/* Billing Toggle */}
          <div className="flex justify-center mb-6">
            <BillingToggle 
              billingCycle={billingCycle} 
              onChange={setBillingCycle} 
            />
          </div>

          {/* Plans Grid */}
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-foreground" />
            </div>
          ) : (
            <>
              {/* Mobile: vertical stack */}
              <div className="md:hidden flex flex-col gap-6 max-w-md mx-auto">
                {displayPlans.map((plan, index) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    displayPlans={displayPlans}
                    billingCycle={billingCycle}
                    onGetStarted={handleGetStarted}
                    index={index}
                  />
                ))}
              </div>
              {/* Desktop/tablet: arrow carousel when many plans, grid when 1–3 */}
              <div className="hidden md:block pt-2">
                <PlanCarousel
                  plans={displayPlans}
                  billingCycle={billingCycle}
                  onGetStarted={handleGetStarted}
                />
              </div>
            </>
          )}

          <div className="text-center mt-12 sm:mt-16">
            <p className="text-muted-foreground">
              Have questions?{" "}
              <a href="#" className="text-foreground font-medium underline underline-offset-4 hover:text-[hsl(var(--landing-accent-orange))] transition-colors">
                Check our FAQ
              </a>
            </p>
          </div>
        </div>
      </main>
      <FooterLanding />
    </div>
  );
}

// Loading fallback component
function PricingPageLoading() {
  return (
    <div className="min-h-screen bg-[hsl(var(--landing-hero-bg))] flex items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-foreground" />
    </div>
  );
}

// Main page component wrapped in Suspense
export default function PricingPage() {
  return (
    <Suspense fallback={<PricingPageLoading />}>
      <PricingPageContent />
    </Suspense>
  );
}
