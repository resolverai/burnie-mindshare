"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { NavigationLanding } from "@/components/landing/NavigationLanding";
import { getOnboardingCopyForPage } from "@/lib/abCopy";
import { Button } from "@/components/ui/button";
import { affiliateApi } from "@/lib/api";
import {
  DollarSign,
  Users,
  BarChart3,
  Zap,
  ChevronDown,
  ChevronUp,
  Share2,
  TrendingUp,
  Clock,
  Headphones,
  CreditCard,
  ArrowRight,
} from "lucide-react";

interface PricingPlan {
  id: number;
  planName: string;
  monthlyPrice: number;
  annualPrice: number;
}

const COMMISSION_RATE = 40;

const FAQ_ITEMS = [
  {
    question: "How much can I earn?",
    answer: `You earn a ${COMMISSION_RATE}% recurring commission on every sale made through your unique affiliate link. This applies for the lifetime of the customer's subscription. The more you refer, the more you earn!`,
  },
  {
    question: "How do I get paid?",
    answer:
      "We process payouts monthly. Once your earned commissions reach the minimum threshold, we'll send payment to your preferred method — bank transfer or PayPal.",
  },
  {
    question: "How do you track sales?",
    answer:
      "We use cookie-based tracking with a 90-day attribution window. When someone clicks your referral link and signs up within 90 days, the referral is attributed to you.",
  },
  {
    question: "What if I need help?",
    answer:
      "We provide dedicated support for all affiliates. You'll have access to marketing materials, a dedicated affiliate manager, and our support team.",
  },
  {
    question: "Do I need to be a dvyb customer?",
    answer:
      "No, you don't need to be a paying customer to join the affiliate program. However, we recommend trying the platform so you can authentically share your experience.",
  },
];

export default function AffiliateLandingPage() {
  const { resolvedTheme } = useTheme();
  const isCopyA = getOnboardingCopyForPage() === "A";
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [referralCount, setReferralCount] = useState(10);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    affiliateApi.getPricingPlans().then((res) => {
      if (res.success && res.data.plans.length > 0) {
        setPlans(res.data.plans);
      }
    }).catch(() => {});
  }, []);

  // Use the middle plan for the hero calculator, fallback to $49
  const middlePlan = plans.length > 0 ? plans[Math.floor(plans.length / 2)] : null;
  const perReferralMonthly = middlePlan
    ? middlePlan.monthlyPrice * (COMMISSION_RATE / 100)
    : 49 * (COMMISSION_RATE / 100);
  const estimatedMonthly = perReferralMonthly * referralCount;
  const estimatedAnnual = estimatedMonthly * 12;

  const openAffiliateLogin = () => {
    window.open("/affiliates/login", "_blank", "noopener,noreferrer");
  };

  return (
    <div className={cn("min-h-screen bg-[hsl(var(--background))]", isCopyA && "font-hind")}>
      <NavigationLanding
        variant={resolvedTheme === "dark" ? "dark" : "default"}
        hideExplore
        hidePricing
        onGetStarted={openAffiliateLogin}
        navStyle={isCopyA ? "wander" : "default"}
        showSignIn={isCopyA}
        showThemeToggle={isCopyA}
      />

      {/* Hero Section */}
      <section className="pt-32 sm:pt-40 pb-16 sm:pb-24 px-4">
        <div className="container mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[hsl(var(--landing-cta-orange))/0.1] text-[hsl(var(--landing-cta-orange))] text-base font-semibold mb-8">
            <Zap className="w-5 h-5" />
            Affiliate Program
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground leading-tight">
            Earn{" "}
            <span className="text-[hsl(var(--landing-cta-orange))]">
              {COMMISSION_RATE}% LIFETIME
            </span>{" "}
            commission on every referral.
            <br />
            Passive income guaranteed
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto">
            That&apos;s{" "}
            <span className="font-semibold text-[hsl(var(--landing-cta-orange))]">
              ${Math.round(estimatedAnnual).toLocaleString()}/year
            </span>{" "}
            with {referralCount} referrals, each year, every year
          </p>

          {/* Referral Slider */}
          <div className="mt-10 max-w-xl mx-auto flex items-center gap-6">
            <input
              type="range"
              min={0}
              max={1000}
              value={referralCount}
              onChange={(e) => setReferralCount(parseInt(e.target.value))}
              className="flex-1 h-2.5 bg-secondary rounded-full appearance-none cursor-pointer accent-[hsl(var(--landing-cta-orange))]"
            />
            <div className="flex items-center gap-2 text-sm font-medium text-foreground min-w-[110px]">
              <span className="text-3xl font-bold">{referralCount}</span>
              <span className="text-muted-foreground">referrals</span>
            </div>
          </div>

          <div className="mt-10">
            <Button
              onClick={openAffiliateLogin}
              className="px-10 py-4 h-auto text-lg font-semibold bg-[hsl(var(--landing-cta-orange))] text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 hover:opacity-90"
            >
              Apply Now
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 sm:py-24 px-4 bg-[hsl(var(--secondary))/0.3]">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "1. Join",
                title: "Sign up in minutes",
                description:
                  "Sign up through our affiliate portal. It's free and you get instant approval.",
                icon: Users,
              },
              {
                step: "2. Promote",
                title: "Share your link",
                description:
                  "Share your unique referral link with your audience using our marketing kits and resources.",
                icon: Share2,
              },
              {
                step: "3. Earn",
                title: "Earn commissions",
                description: `Earn a ${COMMISSION_RATE}% lifetime commission for every customer who signs up through your link.`,
                icon: DollarSign,
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-card rounded-2xl p-10 border border-border/50 hover:shadow-lg transition-all duration-300"
              >
                <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--landing-cta-orange))/0.1] flex items-center justify-center mb-5">
                  <item.icon className="w-7 h-7 text-[hsl(var(--landing-cta-orange))]" />
                </div>
                <p className="text-sm font-semibold text-[hsl(var(--landing-cta-orange))] mb-2">{item.step}</p>
                <h3 className="text-2xl font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Commission Structure */}
      <section className="py-16 sm:py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-foreground mb-4">
            Commission Structure
          </h2>
          <p className="text-center text-muted-foreground text-lg mb-12">
            Earn{" "}
            <span className="text-[hsl(var(--landing-cta-orange))] font-semibold">
              {COMMISSION_RATE}% commission
            </span>{" "}
            on every plan. Higher-tier referrals mean higher earnings.
          </p>

          {plans.length > 0 ? (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden shadow-sm">
              <div className="grid grid-cols-4 gap-4 px-8 py-5 bg-secondary/30 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                <div>Plan</div>
                <div className="text-center">Plan Price</div>
                <div className="text-center">Your Commission</div>
                <div className="text-center">Annual Potential</div>
              </div>
              {plans
                .filter((p) => p.monthlyPrice > 0)
                .map((plan) => (
                  <div
                    key={plan.id}
                    className="grid grid-cols-4 gap-4 px-8 py-6 border-t border-border/30 items-center"
                  >
                    <div>
                      <p className="font-semibold text-foreground text-lg">{plan.planName}</p>
                    </div>
                    <div className="text-center text-muted-foreground text-base">
                      ${plan.monthlyPrice}/mo
                    </div>
                    <div className="text-center">
                      <span className="text-[hsl(var(--landing-cta-orange))] font-bold text-lg">
                        ${(plan.monthlyPrice * COMMISSION_RATE / 100).toFixed(1)}
                      </span>
                      <span className="text-muted-foreground text-sm ml-1.5">per referral monthly</span>
                    </div>
                    <div className="text-center text-muted-foreground text-base">
                      ${(plan.annualPrice * COMMISSION_RATE / 100).toFixed(1)}
                      <span className="text-sm ml-1.5">per referral annually</span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-border/50 p-12 text-center text-muted-foreground text-lg">
              Commission details loading...
            </div>
          )}

          {/* Benefits Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-14">
            {[
              {
                icon: DollarSign,
                title: "Lifetime Commissions",
                description: `Earn ${COMMISSION_RATE}% commission for as long as your referrals stay subscribed`,
              },
              {
                icon: TrendingUp,
                title: "Higher Plans = Higher Earnings",
                description: "Focus on promoting premium plans to maximize your earning potential",
              },
              {
                icon: BarChart3,
                title: "Real-Time Tracking",
                description: "Monitor your referrals and earnings with detailed analytics",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex flex-col items-center text-center p-8 bg-card rounded-2xl border border-border/50 hover:shadow-md transition-all duration-300"
              >
                <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--landing-cta-orange))/0.1] flex items-center justify-center mb-5">
                  <item.icon className="w-8 h-8 text-[hsl(var(--landing-cta-orange))]" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Marketing Resources */}
      <section className="py-16 sm:py-24 px-4 bg-[hsl(var(--secondary))/0.3]">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-foreground mb-4">
            Marketing Resources
          </h2>
          <p className="text-center text-muted-foreground text-lg mb-12">
            Professional tools and templates to accelerate your affiliate success
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Brand Assets Pack",
                tags: ["Assets", "Use in your content"],
                description:
                  "Professional logos, banners, and promotional materials you can use in your content and marketing.",
                popular: true,
              },
              {
                title: "Viral Hooks About dvyb",
                tags: ["Copy", "Use in posts & videos"],
                description:
                  "30 attention-grabbing hooks specifically crafted for promoting dvyb that drive engagement.",
                popular: true,
              },
              {
                title: "Sample AI Ads",
                tags: ["Examples", "Show in videos"],
                description:
                  "Real ads generated with dvyb that you can show in your videos as examples or use as inspiration.",
              },
              {
                title: "5-Minute Campaign Tutorial",
                tags: ["Tutorial", "Post on social media"],
                description:
                  "Share this tutorial on X, LinkedIn, etc. to show your audience how to create winning ad campaigns with dvyb.",
              },
              {
                title: "UGC Video Ideas",
                tags: ["Templates", "Create your own videos"],
                description:
                  "30 proven video concepts and templates you can use to showcase dvyb's capabilities and features.",
              },
              {
                title: "Viral Content Guide",
                tags: ["Guide", "Learn & apply"],
                description:
                  "Step-by-step guide to creating engaging videos and posts that your audience will love and share.",
              },
            ].map((resource) => (
              <div
                key={resource.title}
                className="bg-card rounded-2xl p-8 border border-border/50 flex flex-col relative hover:shadow-md transition-all duration-300"
              >
                {resource.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[hsl(var(--landing-cta-orange))] text-white text-xs font-semibold rounded-full">
                    Popular
                  </span>
                )}
                <h3 className="text-lg font-bold text-foreground mt-1 mb-3">{resource.title}</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {resource.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 text-xs rounded-full bg-secondary text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-muted-foreground flex-1 leading-relaxed">{resource.description}</p>
                <div className="mt-6">
                  <Button variant="outline" disabled className="w-full rounded-xl py-3 h-auto text-sm">
                    Coming Soon
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ready to Start Section */}
      <section className="py-16 sm:py-24 px-4">
        <div className="container mx-auto max-w-5xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Ready to Start Earning?
          </h2>
          <p className="text-muted-foreground text-lg mb-12">
            Join our successful affiliates already earning with dvyb
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-14">
            {[
              { label: "Active Affiliates", value: "100+" },
              { label: "Avg. Monthly", value: "$1,200" },
              { label: "Top Earner", value: "$8K+" },
              { label: "Conversion Rate", value: "3.5%" },
            ].map((stat) => (
              <div key={stat.label} className="bg-card rounded-2xl p-6 border border-border/50">
                <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-2">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Key benefits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto mb-14">
            {[
              {
                icon: DollarSign,
                title: `${COMMISSION_RATE}% Lifetime Commission`,
                description: "Earn recurring revenue for every subscribed customer",
              },
              {
                icon: Clock,
                title: "90-Day Cookie Duration",
                description: "Get credit for conversions up to 90 days",
              },
              {
                icon: Headphones,
                title: "Dedicated Support",
                description: "Marketing materials & affiliate manager",
              },
              {
                icon: CreditCard,
                title: "Monthly Payouts",
                description: "Reliable payments with real-time tracking",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 bg-card rounded-2xl p-6 border border-border/50 text-left hover:shadow-md transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-[hsl(var(--landing-cta-orange))/0.1] flex items-center justify-center shrink-0">
                  <item.icon className="w-6 h-6 text-[hsl(var(--landing-cta-orange))]" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground mb-1">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="px-4 pb-16 sm:pb-24">
        <div className="container mx-auto max-w-5xl">
          <div className="bg-gradient-to-r from-[hsl(var(--landing-cta-orange))] to-[hsl(24_100%_60%)] rounded-3xl p-10 sm:p-14 text-center text-white">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Join Our Affiliate Program</h2>
            <p className="text-white/80 text-lg mb-8">
              Start earning {COMMISSION_RATE}% commission on every referral with instant approval.
            </p>
            <Button
              onClick={openAffiliateLogin}
              className="bg-white text-foreground hover:bg-white/90 px-10 py-4 h-auto text-lg font-semibold rounded-full shadow-lg"
            >
              Join Now <ArrowRight className="w-5 h-5 ml-1" />
            </Button>
            <p className="text-white/60 text-sm mt-5">
              Instant approval &middot; No monthly minimums &middot; 24/7 support
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24 px-4 bg-[hsl(var(--secondary))/0.3]">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-foreground mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-center text-muted-foreground text-lg mb-12">
            Find answers to common questions about our affiliate program
          </p>

          <div className="space-y-4">
            {FAQ_ITEMS.map((faq, index) => (
              <div
                key={index}
                className="bg-card rounded-2xl border border-border/50 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className="font-semibold text-foreground text-base">{faq.question}</span>
                  {openFaq === index ? (
                    <ChevronUp className="w-5 h-5 text-[hsl(var(--landing-cta-orange))] shrink-0 ml-4" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 ml-4" />
                  )}
                </button>
                {openFaq === index && (
                  <div className="px-6 pb-6 text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 text-center text-sm text-muted-foreground border-t border-border/50">
        Questions?{" "}
        <a
          href="mailto:hello@dvyb.ai"
          className="text-[hsl(var(--landing-cta-orange))] hover:underline"
        >
          Contact our team
        </a>
      </footer>
    </div>
  );
}
