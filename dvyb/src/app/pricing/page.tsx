"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { 
  Check, 
  Sparkles, 
  Image as ImageIcon, 
  Video, 
  Zap,
  Crown,
  Loader2,
  ArrowLeft,
  Gift,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

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
        className={`relative px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-2 ${
          billingCycle === 'annual'
            ? 'bg-primary text-primary-foreground shadow-md'
            : 'text-foreground hover:text-foreground/80'
        }`}
      >
        Annual
        <span className={`px-2 py-0.5 text-xs rounded-full font-semibold transition-colors duration-300 ${
          billingCycle === 'annual' 
            ? 'bg-white/20 text-primary-foreground' 
            : 'bg-green-500 text-white'
        }`}>
          Save 20%
        </span>
      </button>
    </div>
  );
};

// Plan Card Component
const PlanCard = ({
  plan,
  displayPlans,
  billingCycle,
  onGetStarted,
  isSelected,
}: {
  plan: PricingPlan;
  displayPlans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  onGetStarted: () => void;
  isSelected?: boolean;
}) => {
  const paidPlans = displayPlans.filter(p => !p.isFreeTrialPlan);
  const isPopular = !plan.isFreeTrialPlan && paidPlans.length > 1 && paidPlans[Math.floor(paidPlans.length / 2)]?.id === plan.id;
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
        isSelected
          ? 'bg-green-50 border-2 border-green-500 shadow-xl ring-2 ring-green-200'
          : isPopular
          ? 'bg-primary/5 border-2 border-primary shadow-xl ring-1 ring-primary/20'
          : isFree
          ? 'bg-green-50 border-2 border-green-200'
          : 'bg-card border border-border hover:border-primary/30 hover:shadow-lg'
      }`}
    >
      {/* Selected Badge (for free plan) */}
      {isSelected && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-green-500 text-white text-sm font-semibold shadow-lg">
            <Check className="h-4 w-4" />
            Recommended
          </div>
        </div>
      )}

      {/* Popular Badge */}
      {isPopular && !isSelected && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg">
            <Crown className="h-4 w-4" />
            Most Popular
          </div>
        </div>
      )}

      {/* Free Badge */}
      {isFree && !isSelected && (
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
        onClick={onGetStarted}
        className={`w-full py-6 text-base font-semibold transition-all ${
          isFree || isSelected
            ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
            : isPopular
            ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg'
            : 'bg-foreground hover:bg-foreground/90 text-background'
        }`}
      >
        {isFree ? (
          <>
            <Gift className="h-5 w-5 mr-2" />
            Start Free Trial
          </>
        ) : (
          <>
            <Zap className="h-5 w-5 mr-2" />
            Get Started
          </>
        )}
      </Button>

      {/* Extra post pricing */}
      {!isFree && (plan.extraImagePostPrice > 0 || plan.extraVideoPostPrice > 0) && (
        <p className="text-center text-muted-foreground text-sm mt-4">
          Extra posts: ${plan.extraImagePostPrice}/image, ${plan.extraVideoPostPrice}/video
        </p>
      )}
    </div>
  );
};

// Plan Carousel Component with Arrow Navigation
const PlanCarousel = ({
  plans,
  billingCycle,
  onGetStarted,
  selectedPlanId,
}: {
  plans: PricingPlan[];
  billingCycle: 'monthly' | 'annual';
  onGetStarted: () => void;
  selectedPlanId: number | null;
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Tablet: 2 visible, Desktop: 3 visible
  const getVisibleCount = () => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024 ? 3 : 2;
    }
    return 3;
  };
  
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
              onGetStarted={onGetStarted}
              isSelected={plan.id === selectedPlanId}
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
                onGetStarted={onGetStarted}
                isSelected={plan.id === selectedPlanId}
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

// Inner component that uses useSearchParams
function PricingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  // Get flow from URL parameter, default to 'website_analysis'
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
      
      if (data.success) {
        setPlans(data.data);
        // Select free plan by default
        const freePlan = data.data.find((p: PricingPlan) => p.isFreeTrialPlan);
        if (freePlan) {
          setSelectedPlanId(freePlan.id);
        }
      }
    } catch (error) {
      console.error('Error fetching pricing plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGetStarted = () => {
    router.push('/');
  };

  // Sort plans: Free first, then by price
  const displayPlans = [...plans].sort((a, b) => {
    if (a.isFreeTrialPlan && !b.isFreeTrialPlan) return -1;
    if (!a.isFreeTrialPlan && b.isFreeTrialPlan) return 1;
    return a.monthlyPrice - b.monthlyPrice;
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </button>
            <Image src={dvybLogo} alt="Dvyb Logo" width={80} height={32} className="object-contain" priority />
          </div>
          <Button
            onClick={handleGetStarted}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Get Started Free
          </Button>
        </div>
      </header>

      <div className="py-12 md:py-20 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10 md:mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 mb-4">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-primary text-sm font-medium">
                Simple, transparent pricing
              </span>
            </div>
            
            <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
              Choose Your Plan
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Start with a free trial, upgrade when you&apos;re ready. All plans include our core AI-powered features.
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
                    onGetStarted={handleGetStarted}
                    isSelected={plan.id === selectedPlanId}
                  />
                ))}
              </div>
              
              {/* Tablet/Desktop Carousel */}
              <PlanCarousel 
                plans={displayPlans}
                billingCycle={billingCycle}
                onGetStarted={handleGetStarted}
                selectedPlanId={selectedPlanId}
              />
            </>
          )}

          {/* Footer CTA */}
          <div className="mt-16 text-center">
            <div className="bg-muted rounded-2xl p-8 md:p-12 max-w-3xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
                Ready to Get Started?
              </h2>
              <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                Join thousands of businesses using Dvyb to create AI-powered content in minutes.
              </p>
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg"
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Start Free Trial
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loading fallback component
function PricingPageLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
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
