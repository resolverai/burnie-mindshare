"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dvybApi } from "@/lib/api";
import {
  trackPricingModalOpened,
  trackPlanUpgradeClicked,
  trackPlanDowngradeClicked,
  trackBillingCycleSwitchClicked,
  trackPlanChangeSuccess,
  trackPlanChangeFailed,
  trackCheckoutStarted,
} from "@/lib/mixpanel";
import { 
  X, 
  Check, 
  Sparkles, 
  Image as ImageIcon, 
  Video, 
  Zap,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowRightLeft,
  Gift,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

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
  isFreemium?: boolean;
  freemiumTrialDays?: number;
  planFlow?: 'website_analysis' | 'product_photoshot';
  dealActive?: boolean;
  dealMonthlyPrice?: number | null;
  dealAnnualPrice?: number | null;
}

interface CurrentPlanInfo {
  planName: string;
  planId: number | null;
  monthlyPrice: number;
  annualPrice: number;
  billingCycle: 'monthly' | 'annual';
  isFreeTrialPlan: boolean;
}

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  currentPlanInfo?: CurrentPlanInfo | null;
  quotaType?: 'image' | 'video' | 'both';
  isAuthenticated?: boolean;
  canSkip?: boolean; // If true, user can skip and proceed to generate (only one quota exhausted)
  reason?: 'quota_exhausted' | 'user_initiated' | 'freemium_required'; // Why the modal was opened
  userFlow?: 'website_analysis' | 'product_photoshot'; // User's acquisition flow - determines which plans to show
  mustSubscribe?: boolean; // If true, user MUST subscribe (no close/skip option) - for freemium enforcement
  /** When 'centered', shows a compact centered modal (like OnboardingFlowModal). Default 'fullscreen' for backward compatibility. */
  variant?: 'fullscreen' | 'centered';
  /** When true, Stripe success→My Ads, cancel→Discover. Otherwise redirect to same page. */
  isOnboardingFlow?: boolean;
}

// Billing Toggle — aligned with /pricing page (landing style)
function getAnnualSavingsPercent(plans: PricingPlan[]): number | null {
  const paidPlans = plans.filter((p) => !p.isFreeTrialPlan && p.monthlyPrice > 0);
  if (paidPlans.length === 0) return null;
  // If any plan has an annual deal, use the max deal % off
  const dealAnnualPcts = paidPlans
    .filter((p) => p.dealActive && p.dealAnnualPrice != null && p.annualPrice > 0)
    .map((p) => Math.round((1 - (p.dealAnnualPrice as number) / p.annualPrice) * 100));
  if (dealAnnualPcts.length > 0) return Math.max(...dealAnnualPcts);
  // No deal: use calculated annual savings from first paid plan
  const p = paidPlans[0];
  const monthlyCost = p.monthlyPrice * 12;
  if (monthlyCost <= 0) return null;
  const savings = Math.round(((monthlyCost - p.annualPrice) / monthlyCost) * 100);
  return savings > 0 ? savings : null;
}

const BillingToggle = ({ 
  billingCycle, 
  onChange,
  plans,
}: { 
  billingCycle: 'monthly' | 'annual'; 
  onChange: (cycle: 'monthly' | 'annual') => void;
  plans: PricingPlan[];
}) => {
  const annualSavings = getAnnualSavingsPercent(plans);
  const savingsLabel = annualSavings != null ? `Save ${annualSavings}%` : null;
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
        {savingsLabel && (
          <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${
            billingCycle === 'annual' ? "bg-white/20 text-white" : "bg-[hsl(var(--landing-accent-orange))] text-white"
          }`}>
            {savingsLabel}
          </span>
        )}
      </button>
    </div>
  );
};

// Extracted PlanCard component for reuse
interface PlanCardProps {
  plan: PricingPlan;
  displayPlans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  changeType: 'upgrade' | 'downgrade' | 'current' | 'get_started' | 'switch_to_annual' | 'switch_to_monthly';
  onSelect: (plan: PricingPlan, changeType: string) => void;
  hasActiveSubscription?: boolean; // Whether user already has an active paid subscription
  landingStyle?: boolean; // Match pricing page / wander lust Download All styling
}

const PlanCard = ({
  plan,
  displayPlans,
  billingCycle,
  changeType,
  onSelect,
  hasActiveSubscription = false,
  landingStyle = false,
}: PlanCardProps) => {
  const isCurrent = changeType === 'current';
  const isUsersPlanDifferentCycle = changeType === 'switch_to_annual' || changeType === 'switch_to_monthly';
  const paidPlans = displayPlans.filter(p => !p.isFreeTrialPlan);
  const isPopular = !plan.isFreeTrialPlan && paidPlans.length > 1 && 
    paidPlans[Math.floor(paidPlans.length / 2)]?.id === plan.id;
  const isFree = plan.isFreeTrialPlan;

  // Determine labels based on plan flow
  // Product Shots flow: "Images" / "Videos"
  // Website Analysis flow: "Image Posts" / "Video Posts"
  const isProductFlow = plan.planFlow === 'product_photoshot';
  const imageLabel = isProductFlow ? 'Images' : 'Image Posts';
  const videoLabel = isProductFlow ? 'Videos' : 'Video Posts';

  const hasDeal = !isFree && plan.dealActive && (plan.dealMonthlyPrice != null) && (plan.dealAnnualPrice != null);
  const originalPrice = billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
  const dealPrice = billingCycle === 'monthly' ? (plan.dealMonthlyPrice ?? 0) : (plan.dealAnnualPrice ?? 0);
  const getPrice = () => isFree ? 0 : (hasDeal ? dealPrice : originalPrice);
  const getDealDiscountPercent = () => hasDeal && originalPrice > 0 ? Math.round((1 - dealPrice / originalPrice) * 100) : 0;
  const getImageLimit = () => isFree ? plan.monthlyImageLimit : (billingCycle === 'monthly' ? plan.monthlyImageLimit : plan.annualImageLimit);
  const getVideoLimit = () => isFree ? plan.monthlyVideoLimit : (billingCycle === 'monthly' ? plan.monthlyVideoLimit : plan.annualVideoLimit);
  
  const getAnnualSavings = () => {
    if (isFree) return 0;
    const monthlyCost = plan.monthlyPrice * 12;
    const annualCost = plan.annualPrice;
    const savings = Math.round(((monthlyCost - annualCost) / monthlyCost) * 100);
    return savings > 0 ? savings : 0;
  };

  const getPeriod = () => (isFree ? "" : billingCycle === 'monthly' ? "/month" : "/year");

  // Landing style: wanderlust Download All modal (light popular card, black CTAs, pills for posts)
  if (landingStyle) {
    const popular = isPopular && !isCurrent && !isUsersPlanDifferentCycle;
    const isProductFlow = plan.planFlow === 'product_photoshot';
    const imageLabel = isProductFlow ? "Image Posts" : "Image Posts";
    const videoLabel = isProductFlow ? "Video Posts" : "Video Posts";
    const imageLimit = getImageLimit();
    const videoLimit = getVideoLimit();
    const otherFeatures = [
      "AI-powered content generation",
      "Multi-platform scheduling",
      "Brand kit & content library",
      "Analytics dashboard",
      ...(!isFree ? ["Priority support"] : []),
    ];
    return (
      <div
        className={`relative rounded-3xl p-6 h-full flex flex-col ${
          isCurrent
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-400 shadow-xl"
            : isUsersPlanDifferentCycle
            ? "bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 shadow-lg"
            : popular
            ? "bg-[hsl(var(--landing-accent-orange)/0.12)] border border-[hsl(var(--landing-accent-orange)/0.3)] shadow-card"
            : "bg-card border border-border shadow-soft"
        }`}
      >
        {isCurrent && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-emerald-500 text-white text-xs font-semibold">
              <Check className="h-4 w-4" />
              Current Plan
            </span>
          </div>
        )}
        {isUsersPlanDifferentCycle && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-amber-500 text-white text-xs font-semibold">
              <ArrowRightLeft className="h-4 w-4" />
              Your Plan
            </span>
          </div>
        )}
        {popular && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold flex items-center gap-1">
              <Check className="w-3 h-3" />
              Popular
            </span>
          </div>
        )}
        {isFree && !popular && !isCurrent && !isUsersPlanDifferentCycle && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold">
              Free Trial
            </span>
          </div>
        )}
        {hasDeal && !popular && !isCurrent && !isUsersPlanDifferentCycle && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="px-4 py-1 bg-green-500 text-white rounded-full text-xs font-semibold">
              {getDealDiscountPercent()}% OFF
            </span>
          </div>
        )}
        <div className="mb-4">
          <h3 className="text-xl font-semibold mb-1 text-foreground">{plan.planName}</h3>
          {plan.description && (
            <p className="text-sm text-muted-foreground mb-2">{plan.description}</p>
          )}
          <div className="flex items-baseline gap-1 flex-wrap">
            {hasDeal && (
              <span className="text-lg line-through text-muted-foreground">${originalPrice}</span>
            )}
            <span className="text-3xl font-bold text-foreground">{isFree ? "Free" : `$${getPrice()}`}</span>
            {!isFree && (
              <span className="text-muted-foreground text-sm">{getPeriod()}</span>
            )}
          </div>
          {(isFree || plan.isFreemium) && (
            <p className="text-xs text-muted-foreground mt-1">
              {isFree ? "7-day trial, no credit card required" : `${plan.freemiumTrialDays || 7}-day free trial, cancel anytime`}
            </p>
          )}
        </div>
        {/* Image/Video posts as pills with icons - hide when limit is 0, center when only one */}
        <div className={`flex flex-wrap gap-2 mb-4 ${(imageLimit > 0) !== (videoLimit > 0) ? 'justify-center' : ''}`}>
          {imageLimit > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 text-sm text-foreground">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              {imageLimit} {imageLabel}
            </span>
          )}
          {videoLimit > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/80 text-sm text-foreground">
              <Video className="w-4 h-4 text-muted-foreground" />
              {videoLimit} {videoLabel}
            </span>
          )}
        </div>
        <ul className="space-y-2 mb-6 flex-1">
          {otherFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-[hsl(var(--landing-accent-orange))]" />
              <span className="text-sm text-foreground">{feature}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => !isCurrent && onSelect(plan, changeType)}
          disabled={isCurrent}
          className={`w-full py-3 rounded-full font-medium transition-all ${
            isCurrent
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-[hsl(var(--landing-cta-bg))] text-white hover:opacity-90"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {isCurrent ? (
              <>
                <Check className="w-4 h-4" />
                Current Plan
              </>
            ) : changeType === "switch_to_annual" ? (
              <>
                <ArrowRightLeft className="w-4 h-4" />
                Switch to Annual
              </>
            ) : changeType === "switch_to_monthly" ? (
              <>
                <ArrowRightLeft className="w-4 h-4" />
                Switch to Monthly
              </>
            ) : (
              <>
                <Gift className="w-4 h-4" />
                {isFree ? "Start Free Trial" : plan.isFreemium ? `Start ${plan.freemiumTrialDays || 7}-Day Trial` : (changeType === "upgrade" ? "Upgrade" : "Get Started")}
              </>
            )}
          </span>
        </button>
        {!isFree && (plan.extraImagePostPrice > 0 || plan.extraVideoPostPrice > 0) && (
          <p className="text-center text-xs mt-3 text-muted-foreground">
            Extra posts: ${plan.extraImagePostPrice}/image post, ${plan.extraVideoPostPrice}/video post
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-3xl p-6 md:p-8 transition-all duration-200 h-full flex flex-col ${
        isCurrent
          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-400 shadow-xl'
          : isUsersPlanDifferentCycle
          ? 'bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 shadow-lg'
          : isPopular
          ? 'bg-[hsl(var(--landing-cta-bg))] text-white shadow-card scale-105'
          : isFree
          ? 'bg-card border border-border shadow-soft'
          : 'bg-card border border-border shadow-soft hover:shadow-lg'
      }`}
    >
      {/* Current Plan Badge - Green to distinguish from Most Popular */}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-emerald-500 text-white text-xs font-semibold">
            <Check className="h-4 w-4" />
            Current Plan
          </span>
        </div>
      )}

      {/* User's Plan (different billing cycle) Badge */}
      {isUsersPlanDifferentCycle && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-amber-500 text-white text-xs font-semibold">
            <ArrowRightLeft className="h-4 w-4" />
            Your Plan
          </span>
        </div>
      )}

      {/* Popular Badge - aligned with pricing page */}
      {isPopular && !isCurrent && !isUsersPlanDifferentCycle && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold">
            Most Popular
          </span>
        </div>
      )}

      {/* Free Badge */}
      {isFree && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 bg-[hsl(var(--landing-accent-orange))] text-white rounded-full text-xs font-semibold">
            Free Trial
          </span>
        </div>
      )}

      {/* Deal Badge */}
      {hasDeal && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-4 py-1 bg-green-500 text-white rounded-full text-xs font-semibold">
            {getDealDiscountPercent()}% OFF
          </span>
        </div>
      )}

      {/* Plan Name */}
      <h3 className={`text-2xl font-bold mb-2 mt-2 ${isPopular ? 'text-white' : 'text-foreground'}`}>
        {plan.planName}
      </h3>
      
      {plan.description && (
        <p className={`text-sm mb-5 ${isPopular ? 'text-white/80' : 'text-muted-foreground'}`}>
          {plan.description}
        </p>
      )}

      {/* Price */}
      <div className="mb-6">
        <div className="flex items-baseline gap-1 flex-wrap">
          {hasDeal && (
            <span className={`text-xl line-through ${isPopular ? 'text-white/50' : 'text-muted-foreground'}`}>${originalPrice}</span>
          )}
          <span className={`text-4xl font-bold ${isPopular ? 'text-white' : 'text-foreground'}`}>
            {isFree ? 'Free' : `$${getPrice()}`}
          </span>
          {!isFree && (
            <span className={isPopular ? 'text-white/70' : 'text-muted-foreground'}>
              /{billingCycle === 'monthly' ? 'mo' : 'yr'}
            </span>
          )}
        </div>
        {!isFree && billingCycle === 'annual' && getAnnualSavings() > 0 && (
          <p className={`text-sm mt-2 font-medium ${isPopular ? 'text-white/90' : 'text-[hsl(var(--landing-accent-orange))]'}`}>
            Save {getAnnualSavings()}% vs monthly
          </p>
        )}
        {/* Only show trial messaging if user does NOT have an active paid subscription */}
        {!isFree && plan.isFreemium && !hasActiveSubscription && (
          <p className={`text-sm mt-2 font-medium ${isPopular ? 'text-white/90' : 'text-[hsl(var(--landing-accent-orange))]'}`}>
            {plan.freemiumTrialDays || 7}-day free trial, cancel anytime
          </p>
        )}
        {isFree && (
          <p className={`text-sm mt-2 font-medium ${isPopular ? 'text-white/90' : 'text-muted-foreground'}`}>
            7-day trial, no credit card required
          </p>
        )}
      </div>

      {/* Features - hide Image/Video when limit is 0, center when only one */}
      <div className={`space-y-4 mb-8 flex-1 flex flex-col ${(getImageLimit() > 0) !== (getVideoLimit() > 0) ? 'items-center' : ''}`}>
        {getImageLimit() > 0 && (
          <div className="flex items-center gap-3">
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isPopular ? 'bg-white/20' : 'bg-[hsl(var(--landing-accent-orange)/0.15)]'}`}>
              <ImageIcon className={`h-5 w-5 ${isPopular ? 'text-white' : 'text-[hsl(var(--landing-accent-orange))]'}`} />
            </div>
            <div>
              <p className={isPopular ? 'text-white font-semibold' : 'text-foreground font-semibold'}>
                {getImageLimit()} {imageLabel}
              </p>
              <p className={`text-sm ${isPopular ? 'text-white/70' : 'text-muted-foreground'}`}>
                {isFree ? 'during trial' : `per ${billingCycle === 'monthly' ? 'month' : 'year'}`}
              </p>
            </div>
          </div>
        )}

        {getVideoLimit() > 0 && (
          <div className="flex items-center gap-3">
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isPopular ? 'bg-white/20' : 'bg-[hsl(var(--landing-accent-orange)/0.15)]'}`}>
              <Video className={`h-5 w-5 ${isPopular ? 'text-white' : 'text-[hsl(var(--landing-accent-orange))]'}`} />
            </div>
            <div>
              <p className={isPopular ? 'text-white font-semibold' : 'text-foreground font-semibold'}>
                {getVideoLimit()} {videoLabel}
              </p>
              <p className={`text-sm ${isPopular ? 'text-white/70' : 'text-muted-foreground'}`}>
                {isFree ? 'during trial' : `per ${billingCycle === 'monthly' ? 'month' : 'year'}`}
              </p>
            </div>
          </div>
        )}

        {/* Additional Features */}
        <div className={`pt-4 space-y-3 ${isPopular ? 'border-t border-white/20' : 'border-t border-border'}`}>
          {['AI-powered content generation', 'Multi-platform scheduling', 'Brand kit & content library', 'Analytics dashboard', ...(!isFree ? ['Priority support'] : [])].map((feature) => (
            <div key={feature} className="flex items-center gap-2">
              <Check className={`h-5 w-5 flex-shrink-0 ${isPopular ? 'text-[hsl(var(--landing-accent-orange))]' : 'text-[hsl(var(--landing-accent-orange))]'}`} />
              <span className={isPopular ? 'text-white/90' : 'text-foreground'}>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Button - aligned with pricing page */}
      <Button
        onClick={() => onSelect(plan, changeType)}
        disabled={isCurrent}
        className={`w-full py-6 text-base font-semibold rounded-full transition-all ${
          isCurrent
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : isFree
            ? 'bg-[hsl(var(--landing-cta-bg))] hover:opacity-90 text-white'
            : changeType === 'upgrade' || changeType === 'get_started' || changeType === 'switch_to_annual' || changeType === 'switch_to_monthly'
            ? isPopular
              ? 'bg-card text-foreground hover:shadow-soft'
              : 'bg-[hsl(var(--landing-cta-bg))] text-white hover:opacity-90'
            : 'bg-foreground hover:bg-foreground/90 text-background'
        }`}
      >
        {isCurrent ? (
          'Current Plan'
        ) : isFree ? (
          <>
            <Gift className="h-5 w-5 mr-2" />
            Start Free Trial
          </>
        ) : plan.isFreemium && !hasActiveSubscription && (changeType === 'get_started' || changeType === 'upgrade') ? (
          <>
            <Gift className="h-5 w-5 mr-2" />
            Start Free {plan.freemiumTrialDays || 7}-Day Trial
          </>
        ) : changeType === 'get_started' ? (
          <>
            <Zap className="h-5 w-5 mr-2" />
            Get Started
          </>
        ) : changeType === 'upgrade' ? (
          <>
            <ArrowUp className="h-5 w-5 mr-2" />
            Upgrade
          </>
        ) : changeType === 'switch_to_annual' ? (
          <>
            <ArrowRightLeft className="h-5 w-5 mr-2" />
            Switch to Annual
          </>
        ) : changeType === 'switch_to_monthly' ? (
          <>
            <ArrowRightLeft className="h-5 w-5 mr-2" />
            Switch to Monthly
          </>
        ) : (
          <>
            <ArrowDown className="h-5 w-5 mr-2" />
            Downgrade
          </>
        )}
      </Button>

      {/* Extra post pricing */}
      {!isFree && (plan.extraImagePostPrice > 0 || plan.extraVideoPostPrice > 0) && (
        <p className={`text-center text-sm mt-4 ${isPopular ? 'text-white/70' : 'text-muted-foreground'}`}>
          Extra {isProductFlow ? 'content' : 'posts'}: ${plan.extraImagePostPrice}/{isProductFlow ? 'image' : 'image post'}, ${plan.extraVideoPostPrice}/{isProductFlow ? 'video' : 'video post'}
        </p>
      )}
    </div>
  );
};

// Modal Plan Carousel Component with Arrow Navigation
const ModalPlanCarousel = ({
  plans,
  billingCycle,
  getPlanChangeType,
  onSelect,
  hasActiveSubscription = false,
  landingStyle = false,
}: {
  plans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  getPlanChangeType: (plan: PricingPlan) => 'upgrade' | 'downgrade' | 'current' | 'get_started' | 'switch_to_annual' | 'switch_to_monthly';
  onSelect: (plan: PricingPlan, changeType: string) => void;
  hasActiveSubscription?: boolean;
  landingStyle?: boolean;
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
  
  const goLeft = () => {
    if (canGoLeft) {
      setCurrentIndex(prev => prev - 1);
    }
  };
  
  const goRight = () => {
    if (canGoRight) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  // Gap sizes in pixels
  const gapSize = visibleCount === 3 ? 24 : 16; // lg:gap-6 = 24px, gap-4 = 16px

  // If all plans fit, just show grid (parent has pt-10 for badge clearance)
  if (plans.length <= visibleCount) {
    return (
      <div className="hidden md:block overflow-visible">
        <div className={`grid ${landingStyle ? 'gap-4' : 'gap-4 lg:gap-6'} ${
          plans.length === 1 ? 'grid-cols-1 max-w-md mx-auto' :
          plans.length === 2 ? 'grid-cols-2 max-w-3xl mx-auto' :
          'grid-cols-3'
        } pt-4`}>
          {plans.map((plan) => (
            <div key={plan.id} className="overflow-visible pt-4">
              <PlanCard 
                plan={plan} 
                displayPlans={plans}
                billingCycle={billingCycle}
                changeType={getPlanChangeType(plan)}
                onSelect={onSelect}
                hasActiveSubscription={hasActiveSubscription}
                landingStyle={landingStyle}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Carousel view with arrows (parent has pt-10 for badge clearance)
  return (
    <div className="hidden md:block relative overflow-visible">
      {/* Left Arrow */}
      <button
        onClick={goLeft}
        disabled={!canGoLeft}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full border shadow-soft flex items-center justify-center transition-all ${
          canGoLeft 
            ? (landingStyle ? 'bg-card border-[hsl(var(--landing-nav-bar-border))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))] cursor-pointer opacity-100' : 'bg-background border-border hover:bg-muted cursor-pointer opacity-100')
            : (landingStyle ? 'bg-[hsl(var(--landing-explore-pill-bg))] border-[hsl(var(--landing-nav-bar-border))] text-muted-foreground opacity-50 cursor-not-allowed' : 'opacity-30 cursor-not-allowed')
        }`}
        style={{ left: '-16px' }}
      >
        <ChevronLeft className="h-5 w-5 lg:h-6 lg:w-6 text-foreground" />
      </button>

      {/* Right Arrow */}
      <button
        onClick={goRight}
        disabled={!canGoRight}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full border shadow-soft flex items-center justify-center transition-all ${
          canGoRight 
            ? (landingStyle ? 'bg-card border-[hsl(var(--landing-nav-bar-border))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))] cursor-pointer opacity-100' : 'bg-background border-border hover:bg-muted cursor-pointer opacity-100')
            : (landingStyle ? 'bg-[hsl(var(--landing-explore-pill-bg))] border-[hsl(var(--landing-nav-bar-border))] text-muted-foreground opacity-50 cursor-not-allowed' : 'opacity-30 cursor-not-allowed')
        }`}
        style={{ right: '-16px' }}
      >
        <ChevronRight className="h-5 w-5 lg:h-6 lg:w-6 text-foreground" />
      </button>

      {/* Carousel Container - pt-4 for badge clearance */}
      <div className="overflow-hidden pt-4">
        <div 
          className="flex transition-transform duration-300 ease-out"
          style={{ 
            gap: `${gapSize}px`,
            transform: `translateX(calc(-${currentIndex} * (${100 / visibleCount}% + ${gapSize / visibleCount}px)))`,
          }}
        >
          {plans.map((plan) => (
            <div 
              key={plan.id} 
              className="flex-shrink-0 overflow-visible pt-4"
              style={{ 
                width: `calc((100% - ${(visibleCount - 1) * gapSize}px) / ${visibleCount})` 
              }}
            >
              <PlanCard 
                plan={plan} 
                displayPlans={plans}
                billingCycle={billingCycle}
                changeType={getPlanChangeType(plan)}
                onSelect={onSelect}
                hasActiveSubscription={hasActiveSubscription}
                landingStyle={landingStyle}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dots indicator */}
      {maxIndex > 0 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: maxIndex + 1 }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`h-2.5 rounded-full transition-all ${
                idx === currentIndex 
                  ? (landingStyle ? 'bg-[hsl(var(--landing-cta-bg))] w-6' : 'bg-primary w-6')
                  : (landingStyle ? 'w-2.5 bg-[hsl(var(--landing-nav-bar-border))] hover:bg-muted-foreground/50' : 'w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50')
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const PricingModal = ({ 
  open, 
  onClose, 
  currentPlanInfo,
  quotaType = 'both',
  isAuthenticated = true,
  canSkip = false,
  reason = 'user_initiated',
  userFlow = 'website_analysis',
  mustSubscribe = false,
  variant = 'fullscreen',
  isOnboardingFlow = false,
}: PricingModalProps) => {
  const router = useRouter();
  const pathname = usePathname() ?? '/home';
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [hasActiveStripeSubscription, setHasActiveStripeSubscription] = useState(false);
  const [confirmedPlanName, setConfirmedPlanName] = useState<string | null>(null);

  // Set initial billing cycle based on current plan
  useEffect(() => {
    if (currentPlanInfo?.billingCycle) {
      setBillingCycle(currentPlanInfo.billingCycle);
    }
  }, [currentPlanInfo?.billingCycle]);

  useEffect(() => {
    if (open) {
      fetchPlans();
      // Track modal open
      trackPricingModalOpened(
        reason === 'quota_exhausted' ? 'limit_exceeded' : 'user_initiated',
        reason === 'quota_exhausted' ? quotaType : undefined
      );
      document.body.style.overflow = 'hidden';
      const timeout = setTimeout(() => setIsVisible(true), 10);
      return () => clearTimeout(timeout);
    } else {
      setIsVisible(false);
      const timeout = setTimeout(() => {
        document.body.style.overflow = 'unset';
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [open, userFlow]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      
      // Fetch plans and subscription status in parallel
      // Pass flow parameter to filter plans by user's acquisition flow
      const [plansResponse, subscriptionData] = await Promise.all([
        fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/pricing-plans?includeFree=true&flow=${userFlow}`
        ).then(res => res.json()),
        isAuthenticated 
          ? dvybApi.subscription.getCurrentSubscription().catch(() => ({ success: false, data: null }))
          : Promise.resolve({ success: false, data: null }),
      ]);
      
      // Set subscription status first (affects plan display)
      const subData = subscriptionData as { success: boolean; data?: { isSubscribed?: boolean; planName?: string } | null };
      if (isAuthenticated && subData.success && subData.data?.isSubscribed) {
        setHasActiveStripeSubscription(true);
        // Store the confirmed plan name from subscription API (more reliable than props)
        if (subData.data.planName) {
          setConfirmedPlanName(subData.data.planName);
        }
      } else {
        setHasActiveStripeSubscription(false);
        setConfirmedPlanName(null);
      }
      
      // Then set plans (uses subscription status for filtering)
      if (plansResponse.success) {
        setPlans(plansResponse.data);
      }
    } catch (error) {
      console.error('Error fetching pricing plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const isCurrentPlan = (plan: PricingPlan) => {
    // Use confirmedPlanName from subscription API if available (more reliable)
    const effectivePlanName = confirmedPlanName || currentPlanInfo?.planName;
    if (!effectivePlanName) return false;
    return effectivePlanName.toLowerCase() === plan.planName.toLowerCase();
  };

  // Helper to check if current plan is free (by flag or name)
  // If user has an active Stripe subscription, they're NOT on a free plan
  const isCurrentPlanFree = () => {
    if (hasActiveStripeSubscription) return false; // Has paid subscription
    if (!currentPlanInfo) return false;
    return currentPlanInfo.isFreeTrialPlan || 
           currentPlanInfo.planName?.toLowerCase().includes('free') ||
           currentPlanInfo.monthlyPrice === 0;
  };

  const getPlanChangeType = (targetPlan: PricingPlan): 'upgrade' | 'downgrade' | 'current' | 'get_started' | 'switch_to_annual' | 'switch_to_monthly' => {
    if (!isAuthenticated) return 'get_started';
    if (!currentPlanInfo) return 'get_started'; // No plan info = show get started
    
    const currentIsFree = isCurrentPlanFree();
    const targetIsFree = targetPlan.isFreeTrialPlan;
    
    // If user is on free plan (no Stripe subscription), show "Get Started" for paid plans
    if (currentIsFree && !targetIsFree && !hasActiveStripeSubscription) {
      return 'get_started';
    }
    
    // If user is on free plan and looking at free plan, it's current
    if (currentIsFree && targetIsFree) {
      return 'current';
    }

    // If user is on free plan, any paid plan is upgrade
    if (currentIsFree && !targetIsFree) {
      return 'upgrade';
    }

    // If user is on paid plan and looking at free plan, it's downgrade
    if (!currentIsFree && targetIsFree) {
      return 'downgrade';
    }
    
    // Same plan check (for paid plans)
    if (isCurrentPlan(targetPlan) && currentPlanInfo.billingCycle === billingCycle) {
      return 'current';
    }

    // Same plan, different billing cycle (for paid plans) - show as switch, not upgrade/downgrade
    if (isCurrentPlan(targetPlan)) {
      if (currentPlanInfo.billingCycle === 'monthly' && billingCycle === 'annual') {
        return 'switch_to_annual';
      }
      if (currentPlanInfo.billingCycle === 'annual' && billingCycle === 'monthly') {
        return 'switch_to_monthly';
      }
    }

    // Compare ACTUAL amounts (not monthly equivalents) to match backend behavior
    // This ensures: if user pays MORE upfront → immediate charge (upgrade)
    //               if user pays LESS upfront → scheduled for period end (downgrade)
    const currentActualPrice = currentPlanInfo.billingCycle === 'monthly' 
      ? currentPlanInfo.monthlyPrice 
      : currentPlanInfo.annualPrice;
    
    const targetActualPrice = billingCycle === 'monthly' 
      ? targetPlan.monthlyPrice 
      : targetPlan.annualPrice;

    if (targetActualPrice > currentActualPrice) {
      return 'upgrade';
    } else if (targetActualPrice < currentActualPrice) {
      return 'downgrade';
    }

    return 'upgrade';
  };

  const handleSelectPlan = async (plan: PricingPlan, changeType: string) => {
    if (!isAuthenticated) {
      handleClose();
      router.push('/');
      return;
    }

    // Don't process free plans through Stripe
    if (plan.isFreeTrialPlan) {
      console.log('Free plan selected - no Stripe checkout needed');
      return;
    }

    setIsLoading(true);
    
    try {
      // If user doesn't have an active Stripe subscription, always go to checkout
      // This handles: free plan users, new users, expired subscriptions
      if (!hasActiveStripeSubscription) {
        console.log('No active Stripe subscription - redirecting to checkout');
        await redirectToCheckout(plan);
        return;
      }

      // User has active Stripe subscription - handle upgrade/downgrade/switch
      // Handle same-plan billing cycle switches separately
      if (changeType === 'switch_to_annual') {
        // Track billing cycle switch
        trackBillingCycleSwitchClicked({
          planName: plan.planName,
          fromCycle: 'monthly',
          toCycle: 'annual',
          fromPrice: currentPlanInfo?.monthlyPrice || 0,
          toPrice: plan.annualPrice,
        });

        // Same plan: Monthly → Annual (pay more upfront)
        const data = await dvybApi.subscription.switchBillingCycle('annual');
        
        if (data.success) {
          // Check if 3DS/SCA authentication is required
          if (data.requiresAction && data.checkoutUrl) {
            // Redirect to Stripe hosted invoice page for 3DS authentication
            window.location.href = data.checkoutUrl;
            return;
          }
          
          trackPlanChangeSuccess({
            action: 'switch_to_annual',
            planName: plan.planName,
            billingCycle: 'annual',
            price: plan.annualPrice,
          });
          handleClose();
          window.location.reload();
        } else {
          trackPlanChangeFailed({
            action: 'switch_to_annual',
            planName: plan.planName,
            billingCycle: 'annual',
            error: data.error || 'Unknown error',
          });
          console.error('Switch to annual failed:', data.error);
          alert('Failed to switch to annual: ' + (data.error || 'Unknown error'));
        }
      } else if (changeType === 'switch_to_monthly') {
        // Track billing cycle switch
        trackBillingCycleSwitchClicked({
          planName: plan.planName,
          fromCycle: 'annual',
          toCycle: 'monthly',
          fromPrice: currentPlanInfo?.annualPrice || 0,
          toPrice: plan.monthlyPrice,
        });

        // Same plan: Annual → Monthly (scheduled for end of period)
        const data = await dvybApi.subscription.switchBillingCycle('monthly');
        
        if (data.success) {
          trackPlanChangeSuccess({
            action: 'switch_to_monthly',
            planName: plan.planName,
            billingCycle: 'monthly',
            price: plan.monthlyPrice,
          });
          handleClose();
          alert(data.message || 'Switch to monthly scheduled for end of billing period');
          window.location.reload();
        } else {
          trackPlanChangeFailed({
            action: 'switch_to_monthly',
            planName: plan.planName,
            billingCycle: 'monthly',
            error: data.error || 'Unknown error',
          });
          console.error('Switch to monthly failed:', data.error);
          alert('Failed to schedule switch: ' + (data.error || 'Unknown error'));
        }
      } else if (changeType === 'upgrade') {
        // Track upgrade click
        trackPlanUpgradeClicked({
          currentPlan: currentPlanInfo?.planName || 'Unknown',
          targetPlan: plan.planName,
          currentBillingCycle: currentPlanInfo?.billingCycle || 'monthly',
          targetBillingCycle: billingCycle,
          currentPrice: currentPlanInfo?.billingCycle === 'monthly' 
            ? (currentPlanInfo?.monthlyPrice || 0) 
            : (currentPlanInfo?.annualPrice || 0),
          targetPrice: billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
        });

        // Different plan upgrade with immediate proration
        const data = await dvybApi.subscription.upgrade(plan.id, billingCycle);
        
        if (data.success) {
          // Check if 3DS/SCA authentication is required
          if (data.requiresAction && data.checkoutUrl) {
            // Redirect to Stripe hosted invoice page for 3DS authentication
            window.location.href = data.checkoutUrl;
            return;
          }
          
          trackPlanChangeSuccess({
            action: 'upgrade',
            planName: plan.planName,
            billingCycle: billingCycle,
            price: billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
          });
          handleClose();
          window.location.reload();
        } else if (data.error?.includes('No active subscription')) {
          // Fallback: no active subscription - redirect to checkout
          await redirectToCheckout(plan);
        } else {
          trackPlanChangeFailed({
            action: 'upgrade',
            planName: plan.planName,
            billingCycle: billingCycle,
            error: data.error || 'Unknown error',
          });
          console.error('Upgrade failed:', data.error);
          alert('Failed to upgrade: ' + (data.error || 'Unknown error'));
        }
      } else if (changeType === 'downgrade') {
        // Track downgrade click
        trackPlanDowngradeClicked({
          currentPlan: currentPlanInfo?.planName || 'Unknown',
          targetPlan: plan.planName,
          currentBillingCycle: currentPlanInfo?.billingCycle || 'monthly',
          targetBillingCycle: billingCycle,
          currentPrice: currentPlanInfo?.billingCycle === 'monthly' 
            ? (currentPlanInfo?.monthlyPrice || 0) 
            : (currentPlanInfo?.annualPrice || 0),
          targetPrice: billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
        });

        // Different plan downgrade scheduled for end of billing period
        const data = await dvybApi.subscription.downgrade(plan.id, billingCycle);
        
        if (data.success) {
          trackPlanChangeSuccess({
            action: 'downgrade',
            planName: plan.planName,
            billingCycle: billingCycle,
            price: billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
          });
          handleClose();
          alert(data.message || 'Downgrade scheduled for end of billing period');
          window.location.reload();
        } else {
          trackPlanChangeFailed({
            action: 'downgrade',
            planName: plan.planName,
            billingCycle: billingCycle,
            error: data.error || 'Unknown error',
          });
          console.error('Downgrade failed:', data.error);
          alert('Failed to schedule downgrade: ' + (data.error || 'Unknown error'));
        }
      } else {
        // New subscription or get_started - redirect to checkout
        await redirectToCheckout(plan);
      }
    } catch (error) {
      console.error('Error processing plan change:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const redirectToCheckout = async (plan: PricingPlan) => {
    try {
      // Track checkout started
      trackCheckoutStarted({
        planName: plan.planName,
        billingCycle: billingCycle,
        price: billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice,
        hasPromoCode: !!promoCode,
      });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const successPath = isOnboardingFlow ? '/content-library?tab=my-ads' : (pathname + search);
      const cancelPath = isOnboardingFlow ? '/discover' : (pathname + search);
      const data = await dvybApi.subscription.createCheckout(
        plan.id, 
        billingCycle, 
        promoCode || undefined,
        {
          successUrl: `${origin}${successPath.startsWith('/') ? successPath : '/' + successPath}`,
          cancelUrl: `${origin}${cancelPath.startsWith('/') ? cancelPath : '/' + cancelPath}`,
        }
      );
      
      if (data.success && data.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = data.checkoutUrl;
      } else if (data.hasActiveSubscription) {
        trackPlanChangeFailed({
          action: 'checkout',
          planName: plan.planName,
          billingCycle: billingCycle,
          error: 'Already has active subscription',
        });
        alert('You already have an active subscription. Please use upgrade/downgrade instead.');
      } else {
        trackPlanChangeFailed({
          action: 'checkout',
          planName: plan.planName,
          billingCycle: billingCycle,
          error: data.error || 'Unknown error',
        });
        console.error('Checkout failed:', data.error);
        alert('Failed to start checkout: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  if (!open) return null;

  // Sort plans: Free trial first, then by effective price (lowest value including deals)
  const effectiveMonthlyPrice = (p: PricingPlan) =>
    p.dealActive && p.dealMonthlyPrice != null ? p.dealMonthlyPrice : p.monthlyPrice;
  const sortedPlans = [...plans].sort((a, b) => {
    if (a.isFreeTrialPlan && !b.isFreeTrialPlan) return -1;
    if (!a.isFreeTrialPlan && b.isFreeTrialPlan) return 1;
    return effectiveMonthlyPrice(a) - effectiveMonthlyPrice(b);
  });

  // For authenticated users, always hide free/trial plans - show only paid plans
  // For non-authenticated users, show all plans including free
  const displayPlans = isAuthenticated 
    ? sortedPlans.filter(plan => {
        // Check if this is a free/trial plan (multiple detection methods for robustness)
        const isFreeOrTrialPlan = plan.isFreeTrialPlan || 
                                   plan.monthlyPrice === 0 || 
                                   plan.planName?.toLowerCase().includes('free trial');
        
        // ALWAYS hide free/trial plans from the pricing modal for authenticated users
        // Users should only see paid plans when upgrading
        if (isFreeOrTrialPlan) {
          console.log('🚫 [PricingModal] Filtering out free plan:', plan.planName);
          return false;
        }
        return true;
      })
    : sortedPlans;

  // Use portal to render modal at document body level to avoid clipping from parent containers
  if (typeof document === 'undefined') return null;
  
  const modalContent = (
    <>
      {/* Close Button - aligned with landing style */}
      <button
        onClick={handleClose}
        className={`z-[112] p-2.5 rounded-full bg-[hsl(var(--landing-explore-pill-bg))] hover:bg-[hsl(var(--landing-explore-pill-hover))] transition-colors border border-[hsl(var(--landing-nav-bar-border))] ${
          variant === 'centered' ? 'absolute top-4 right-4' : 'fixed top-4 right-4 md:top-6 md:right-6'
        }`}
        aria-label="Close pricing"
      >
        <X className="h-5 w-5 text-foreground" />
      </button>

      <div className={`flex-1 min-h-0 flex flex-col ${variant === 'centered' ? 'py-8 px-4 pt-14 pb-10 overflow-hidden' : 'py-6 md:py-10 px-4'}`}>
        <div className={`flex-1 min-h-0 flex flex-col ${variant === 'centered' ? 'max-w-6xl mx-auto w-full' : 'max-w-6xl mx-auto'}`}>
              {/* Header */}
              <div className={`text-center shrink-0 ${variant === 'centered' ? 'mb-3' : 'mb-6 md:mb-8'}`}>
                {mustSubscribe ? (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4 bg-[hsl(var(--landing-accent-orange)/0.15)]">
                    <Gift className="h-4 w-4 text-[hsl(var(--landing-accent-orange))]" />
                    <span className="text-sm font-medium text-[hsl(var(--landing-accent-orange))]">
                      Start your free trial to continue
                    </span>
                  </div>
                ) : reason === 'quota_exhausted' && quotaType && isAuthenticated && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4 bg-[hsl(var(--landing-accent-orange)/0.15)]">
                    <Sparkles className="h-4 w-4 text-[hsl(var(--landing-accent-orange))]" />
                    <span className="text-sm font-medium text-[hsl(var(--landing-accent-orange))]">
                      {quotaType === 'image' 
                        ? 'Image quota reached' 
                        : quotaType === 'video' 
                        ? 'Video quota reached' 
                        : 'Content quota reached'}
                    </span>
                  </div>
                )}
                
                <h1 className={`font-bold text-foreground mb-4 ${variant === 'centered' ? 'text-2xl md:text-3xl font-semibold' : 'text-3xl md:text-5xl'}`}>
                  {variant === 'centered' && reason === 'user_initiated'
                    ? 'Sign up for 7-day trial'
                    : mustSubscribe 
                    ? 'Choose Your Plan' 
                    : isAuthenticated 
                    ? 'Upgrade Your Plan' 
                    : 'Choose Your Plan'}
                </h1>
                <p className={`text-muted-foreground max-w-2xl mx-auto ${variant === 'centered' ? 'text-sm md:text-base' : 'text-lg md:text-xl'}`}>
                  {variant === 'centered' && reason === 'user_initiated'
                    ? 'cancel anytime'
                    : mustSubscribe 
                    ? 'Start with a free 7-day trial. Your card will only be charged after the trial ends.'
                    : 'Unlock more AI-powered content generation and take your brand to the next level'}
                </p>

                {/* Current Plan Info - hidden when centered+user_initiated (Download All flow) or mustSubscribe */}
                {isAuthenticated && currentPlanInfo && !mustSubscribe && !(variant === 'centered' && reason === 'user_initiated') && (
                  <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--landing-explore-pill-bg))] border border-[hsl(var(--landing-nav-bar-border))]">
                    <span className="text-sm text-muted-foreground">Current plan:</span>
                    <span className="text-sm font-semibold text-foreground">
                      {currentPlanInfo.planName}
                    </span>
                    {!currentPlanInfo.isFreeTrialPlan && (
                      <span className="text-xs text-muted-foreground">
                        ({currentPlanInfo.billingCycle})
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Billing Toggle */}
              <div className={`flex justify-center shrink-0 ${variant === 'centered' ? 'mb-3' : 'mb-4'}`}>
                <BillingToggle 
                  billingCycle={billingCycle} 
                  onChange={setBillingCycle}
                  plans={displayPlans}
                />
              </div>

              {/* Plans Grid */}
              {loading ? (
                <div className={`flex items-center justify-center flex-1 ${variant === 'centered' ? 'py-8' : 'py-20'}`}>
                  <Loader2 className={`h-10 w-10 animate-spin ${variant === 'centered' ? 'text-foreground' : 'text-primary'}`} />
                </div>
              ) : (
                <div className={`flex-1 min-h-0 flex flex-col ${variant === 'centered' ? 'overflow-hidden' : ''} pt-4`}>
                  {/* Mobile: Vertical stack */}
                  <div className={`md:hidden flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-visible ${variant === 'centered' ? 'gap-4' : 'gap-6'}`}>
                    {displayPlans.map((plan) => (
                      <div key={plan.id} className="overflow-visible pt-4">
                        <PlanCard 
                          plan={plan} 
                          displayPlans={displayPlans}
                          billingCycle={billingCycle}
                          changeType={getPlanChangeType(plan)}
                          onSelect={handleSelectPlan}
                          hasActiveSubscription={hasActiveStripeSubscription}
                          landingStyle={variant === 'centered'}
                        />
                      </div>
                    ))}
                  </div>
                  
                  {/* Tablet/Desktop Carousel */}
                  <div className="hidden md:block flex-1 min-h-0 overflow-hidden">
                    <ModalPlanCarousel 
                      plans={displayPlans}
                      billingCycle={billingCycle}
                      getPlanChangeType={getPlanChangeType}
                      onSelect={handleSelectPlan}
                      hasActiveSubscription={hasActiveStripeSubscription}
                      landingStyle={true}
                    />
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className={`text-center shrink-0 ${variant === 'centered' ? 'mt-4' : 'mt-6'}`}>
                {mustSubscribe || reason === 'freemium_required' ? (
                  // User MUST subscribe (opt-out trial enforcement) - no skip option
                  <div className="space-y-2">
                    <p className="text-foreground font-medium">
                      Subscribe to continue generating content
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Start your free trial today. Cancel anytime before the trial ends to avoid charges.
                    </p>
                  </div>
                ) : reason === 'quota_exhausted' && quotaType === 'both' && !canSkip ? (
                  // Both quotas exhausted - no skip option
                  <p className="text-muted-foreground text-sm">
                    You&apos;ve reached your content limit. Upgrade to continue creating.
                  </p>
                ) : reason === 'quota_exhausted' && canSkip ? (
                  // Only one quota exhausted - can skip and generate the other type
                  <button
                    onClick={handleClose}
                    className="text-[hsl(var(--landing-accent-orange))] hover:opacity-80 text-sm font-medium underline underline-offset-4 transition-colors"
                  >
                    Continue with {quotaType === 'image' ? 'videos' : 'images'} only →
                  </button>
                ) : (
                  // User-initiated modal or other case - show maybe later
                  <button
                    onClick={handleClose}
                    className="text-sm underline underline-offset-4 transition-colors text-muted-foreground hover:text-[hsl(var(--landing-accent-orange))]"
                  >
                    {variant === 'centered' && reason === 'user_initiated' ? 'Skip for now' : 'Maybe later'}
                  </button>
                )}
              </div>
            </div>
          </div>
    </>
  );

  return createPortal(
    <>
      {/* Backdrop - dark black alpha so background (e.g. GenerateContentDialog) is not visible; z-[110] above GenerateContentDialog (z-101) */}
      <div 
        className={`fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />
      
      {/* Modal Content - fullscreen or centered */}
      {variant === 'centered' ? (
        <div 
          className={`fixed inset-0 z-[111] flex items-center justify-center p-4 transition-opacity duration-300 ${
            isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div 
            className="relative max-w-[82vw] w-full max-h-[95vh] overflow-hidden rounded-2xl border border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--landing-hero-bg))] shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {modalContent}
          </div>
        </div>
      ) : (
        <div 
          className={`fixed inset-0 z-[111] overflow-y-auto transition-transform duration-300 ease-out ${
            isVisible ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="min-h-screen bg-[hsl(var(--landing-hero-bg))]">
            {modalContent}
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

