"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
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
  Crown,
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
}

// Animated Toggle Switch Component
const BillingToggle = ({ 
  billingCycle, 
  onChange 
}: { 
  billingCycle: 'monthly' | 'annual'; 
  onChange: (cycle: 'monthly' | 'annual') => void;
}) => {
  return (
    <div className="inline-flex items-center p-1 rounded-full bg-primary/10 border border-primary/20">
      {/* Monthly button */}
      <button
        onClick={() => onChange('monthly')}
        className={`relative px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
          billingCycle === 'monthly'
            ? 'bg-primary text-primary-foreground shadow-md'
            : 'text-foreground hover:text-foreground/80'
        }`}
      >
        Monthly
      </button>
      
      {/* Annual button */}
      <button
        onClick={() => onChange('annual')}
        className={`relative px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
          billingCycle === 'annual'
            ? 'bg-primary text-primary-foreground shadow-md'
            : 'text-foreground hover:text-foreground/80'
        }`}
      >
        Annual
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
}

const PlanCard = ({
  plan,
  displayPlans,
  billingCycle,
  changeType,
  onSelect,
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

  // Free plan always uses monthly values
  const getPrice = () => isFree ? 0 : (billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice);
  const getImageLimit = () => isFree ? plan.monthlyImageLimit : (billingCycle === 'monthly' ? plan.monthlyImageLimit : plan.annualImageLimit);
  const getVideoLimit = () => isFree ? plan.monthlyVideoLimit : (billingCycle === 'monthly' ? plan.monthlyVideoLimit : plan.annualVideoLimit);
  
  const getAnnualSavings = () => {
    if (isFree) return 0;
    const monthlyCost = plan.monthlyPrice * 12;
    const annualCost = plan.annualPrice;
    const savings = Math.round(((monthlyCost - annualCost) / monthlyCost) * 100);
    return savings > 0 ? savings : 0;
  };

  return (
    <div
      className={`relative rounded-2xl p-6 md:p-8 transition-all duration-200 h-full ${
        isCurrent
          ? 'bg-emerald-50 border-2 border-emerald-400 shadow-xl ring-1 ring-emerald-200'
          : isUsersPlanDifferentCycle
          ? 'bg-amber-50 border-2 border-amber-300 shadow-lg ring-1 ring-amber-200'
          : isPopular
          ? 'bg-primary/5 border-2 border-primary/50 shadow-lg'
          : isFree
          ? 'bg-green-50 border-2 border-green-200'
          : 'bg-card border border-border hover:border-primary/30 hover:shadow-lg'
      }`}
    >
      {/* Current Plan Badge - Green to distinguish from Most Popular */}
      {isCurrent && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-500 text-white text-sm font-semibold shadow-lg">
            <Check className="h-4 w-4" />
            Current Plan
          </div>
        </div>
      )}

      {/* User's Plan (different billing cycle) Badge */}
      {isUsersPlanDifferentCycle && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-amber-500 text-white text-sm font-semibold shadow-lg">
            <ArrowRightLeft className="h-4 w-4" />
            Your Plan
          </div>
        </div>
      )}

      {/* Popular Badge */}
      {isPopular && !isCurrent && !isUsersPlanDifferentCycle && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg">
            <Crown className="h-4 w-4" />
            Most Popular
          </div>
        </div>
      )}

      {/* Free Badge */}
      {isFree && !isCurrent && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-green-500 text-white text-sm font-semibold shadow-lg">
            <Gift className="h-4 w-4" />
            Free Trial
          </div>
        </div>
      )}

      {/* Plan Name */}
      <h3 className="text-2xl font-bold text-foreground mb-2 mt-2">
        {plan.planName}
      </h3>
      
      {plan.description && (
        <p className="text-muted-foreground text-sm mb-5">
          {plan.description}
        </p>
      )}

      {/* Price */}
      <div className="mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-bold text-foreground">
            {isFree ? 'Free' : `$${getPrice()}`}
          </span>
          {!isFree && (
            <span className="text-muted-foreground">
              /{billingCycle === 'monthly' ? 'mo' : 'yr'}
            </span>
          )}
        </div>
        {!isFree && billingCycle === 'annual' && getAnnualSavings() > 0 && (
          <p className="text-green-600 text-sm mt-2 font-medium">
            Save {getAnnualSavings()}% vs monthly
          </p>
        )}
        {!isFree && plan.isFreemium && (
          <p className="text-purple-600 text-sm mt-2 font-medium">
            {plan.freemiumTrialDays || 7}-day free trial, cancel anytime
          </p>
        )}
        {isFree && (
          <p className="text-green-600 text-sm mt-2 font-medium">
            7-day trial, no credit card required
          </p>
        )}
      </div>

      {/* Features */}
      <div className="space-y-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <ImageIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-foreground font-semibold">
              {getImageLimit()} {imageLabel}
            </p>
            <p className="text-muted-foreground text-sm">
              {isFree ? 'during trial' : `per ${billingCycle === 'monthly' ? 'month' : 'year'}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pink-500/10 flex items-center justify-center">
            <Video className="h-5 w-5 text-pink-500" />
          </div>
          <div>
            <p className="text-foreground font-semibold">
              {getVideoLimit()} {videoLabel}
            </p>
            <p className="text-muted-foreground text-sm">
              {isFree ? 'during trial' : `per ${billingCycle === 'monthly' ? 'month' : 'year'}`}
            </p>
          </div>
        </div>

        {/* Additional Features */}
        <div className="pt-4 border-t border-border space-y-3">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-foreground">AI-powered content generation</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-foreground">Multi-platform scheduling</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-foreground">Brand kit & content library</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-foreground">Analytics dashboard</span>
          </div>
          {!isFree && (
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-foreground">Priority support</span>
            </div>
          )}
        </div>
      </div>

      {/* CTA Button */}
      <Button
        onClick={() => onSelect(plan, changeType)}
        disabled={isCurrent}
        className={`w-full py-6 text-base font-semibold transition-all ${
          isCurrent
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : isFree
            ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
            : changeType === 'upgrade' || changeType === 'get_started' || changeType === 'switch_to_annual'
            ? 'btn-gradient-cta'
            : changeType === 'switch_to_monthly'
            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg'
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
        ) : plan.isFreemium && (changeType === 'get_started' || changeType === 'upgrade') ? (
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
        <p className="text-center text-muted-foreground text-sm mt-4">
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
}: {
  plans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  getPlanChangeType: (plan: PricingPlan) => 'upgrade' | 'downgrade' | 'current' | 'get_started' | 'switch_to_annual' | 'switch_to_monthly';
  onSelect: (plan: PricingPlan, changeType: string) => void;
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

  // If all plans fit, just show grid
  if (plans.length <= visibleCount) {
    return (
      <div className="hidden md:block pt-5">
        <div className={`grid gap-4 lg:gap-6 ${
          plans.length === 1 ? 'grid-cols-1 max-w-md mx-auto' :
          plans.length === 2 ? 'grid-cols-2 max-w-3xl mx-auto' :
          'grid-cols-3'
        }`}>
          {plans.map((plan) => (
            <PlanCard 
              key={plan.id} 
              plan={plan} 
              displayPlans={plans}
              billingCycle={billingCycle}
              changeType={getPlanChangeType(plan)}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    );
  }

  // Carousel view with arrows
  return (
    <div className="hidden md:block relative pt-5">
      {/* Left Arrow */}
      <button
        onClick={goLeft}
        disabled={!canGoLeft}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-background border border-border shadow-lg flex items-center justify-center transition-all ${
          canGoLeft 
            ? 'hover:bg-muted cursor-pointer opacity-100' 
            : 'opacity-30 cursor-not-allowed'
        }`}
        style={{ left: '-16px' }}
      >
        <ChevronLeft className="h-5 w-5 lg:h-6 lg:w-6 text-foreground" />
      </button>

      {/* Right Arrow */}
      <button
        onClick={goRight}
        disabled={!canGoRight}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-background border border-border shadow-lg flex items-center justify-center transition-all ${
          canGoRight 
            ? 'hover:bg-muted cursor-pointer opacity-100' 
            : 'opacity-30 cursor-not-allowed'
        }`}
        style={{ right: '-16px' }}
      >
        <ChevronRight className="h-5 w-5 lg:h-6 lg:w-6 text-foreground" />
      </button>

      {/* Carousel Container */}
      <div className="overflow-hidden pt-5">
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
              className="flex-shrink-0"
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
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                idx === currentIndex 
                  ? 'bg-primary w-6' 
                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
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
  mustSubscribe = false
}: PricingModalProps) => {
  const router = useRouter();
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

      const data = await dvybApi.subscription.createCheckout(
        plan.id, 
        billingCycle, 
        promoCode || undefined
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

  // Sort plans: Free trial first, then by price
  const sortedPlans = [...plans].sort((a, b) => {
    if (a.isFreeTrialPlan && !b.isFreeTrialPlan) return -1;
    if (!a.isFreeTrialPlan && b.isFreeTrialPlan) return 1;
    return a.monthlyPrice - b.monthlyPrice;
  });

  // For authenticated users, show free plan only if user is on it
  // For non-authenticated users, show all plans including free
  // Use confirmedPlanName from subscription API (more reliable) with fallback to props
  const effectivePlanName = confirmedPlanName || currentPlanInfo?.planName;
  const isUserOnFreePlan = !hasActiveStripeSubscription && (
    currentPlanInfo?.isFreeTrialPlan || 
    effectivePlanName?.toLowerCase().includes('free')
  );
  
  const displayPlans = isAuthenticated 
    ? sortedPlans.filter(plan => {
        if (plan.isFreeTrialPlan) {
          // When mustSubscribe is true, NEVER show free plan - user must choose a paid opt-out plan
          if (mustSubscribe) {
            return false;
          }
          // Show free plan only if user is actually on it (and doesn't have a Stripe subscription)
          return isUserOnFreePlan;
        }
        return true;
      })
    : sortedPlans;

  // Use portal to render modal at document body level to avoid clipping from parent containers
  if (typeof document === 'undefined') return null;
  
  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 z-[100] bg-black/50 transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />
      
      {/* Modal Content */}
      <div 
        className={`fixed inset-0 z-[101] overflow-y-auto transition-transform duration-300 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="min-h-screen bg-background">
          {/* Close Button - always visible */}
          <button
            onClick={handleClose}
            className="fixed top-4 right-4 md:top-6 md:right-6 z-[102] p-2.5 rounded-full bg-muted hover:bg-muted/80 transition-colors border border-border"
            aria-label="Close pricing"
          >
            <X className="h-5 w-5 text-foreground" />
          </button>

          <div className="py-8 md:py-16 px-4">
            <div className="max-w-6xl mx-auto">
              {/* Header */}
              <div className="text-center mb-8 md:mb-12">
                {mustSubscribe ? (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-100 mb-4">
                    <Gift className="h-4 w-4 text-purple-600" />
                    <span className="text-purple-600 text-sm font-medium">
                      Start your free trial to continue
                    </span>
                  </div>
                ) : reason === 'quota_exhausted' && quotaType && isAuthenticated && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-primary text-sm font-medium">
                      {quotaType === 'image' 
                        ? 'Image quota reached' 
                        : quotaType === 'video' 
                        ? 'Video quota reached' 
                        : 'Content quota reached'}
                    </span>
                  </div>
                )}
                
                <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
                  {mustSubscribe 
                    ? 'Choose Your Plan' 
                    : isAuthenticated 
                    ? 'Upgrade Your Plan' 
                    : 'Choose Your Plan'}
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
                  {mustSubscribe 
                    ? 'Start with a free 7-day trial. Your card will only be charged after the trial ends.'
                    : 'Unlock more AI-powered content generation and take your brand to the next level'}
                </p>

                {/* Current Plan Info - hidden when mustSubscribe is true (user is on free trial, not helpful to show) */}
                {isAuthenticated && currentPlanInfo && !mustSubscribe && (
                  <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted border border-border">
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
              <div className="flex justify-center mb-6">
                <BillingToggle 
                  billingCycle={billingCycle} 
                  onChange={setBillingCycle} 
                />
              </div>

              {/* Plans Grid */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {/* Mobile: Vertical stack */}
                  <div className="md:hidden flex flex-col gap-6">
                    {displayPlans.map((plan) => (
                      <PlanCard 
                        key={plan.id} 
                        plan={plan} 
                        displayPlans={displayPlans}
                        billingCycle={billingCycle}
                        changeType={getPlanChangeType(plan)}
                        onSelect={handleSelectPlan}
                      />
                    ))}
                  </div>
                  
                  {/* Tablet/Desktop Carousel */}
                  <ModalPlanCarousel 
                    plans={displayPlans}
                    billingCycle={billingCycle}
                    getPlanChangeType={getPlanChangeType}
                    onSelect={handleSelectPlan}
                  />
                </>
              )}

              {/* Footer */}
              <div className="mt-10 text-center">
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
                    className="text-primary hover:text-primary/80 text-sm font-medium underline underline-offset-4 transition-colors"
                  >
                    Continue with {quotaType === 'image' ? 'videos' : 'images'} only →
                  </button>
                ) : (
                  // User-initiated modal or other case - show maybe later
                  <button
                    onClick={handleClose}
                    className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
                  >
                    Maybe later
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

