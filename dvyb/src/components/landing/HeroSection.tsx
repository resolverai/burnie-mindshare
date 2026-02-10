"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Globe, Check } from "lucide-react";
import { contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackWebsiteAnalysisStarted, trackWebsiteAnalysisCompleted } from "@/lib/mixpanel";
import { tileImages } from "@/lib/tileImages";

const rotatingWords = ["ad research", "ad agencies", "ad designers"];

const analysisSteps = [
  { percent: 0, label: "Analyzing your brand identity" },
  { percent: 20, label: "Studying ads in your industry" },
  { percent: 35, label: "Learning what converts for similar brands" },
  { percent: 55, label: "Preparing your ad templates" },
  { percent: 65, label: "Creating brand profile" },
  { percent: 85, label: "Downloading product collateral" },
  { percent: 100, label: "Your brand is ready. Let's create ads." },
];

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized) return "";
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = "https://" + normalized;
  }
  return normalized;
}

interface HeroSectionProps {
  onAnalysisComplete?: (url: string) => void;
  onShowInspirationModal?: () => void;
  websiteModalOpen?: boolean;
  onWebsiteModalOpenChange?: (open: boolean) => void;
  adCount?: number;
  floatingTiles?: { id: number; delay: number; imageIndex: number }[];
}

export function HeroSection({
  onAnalysisComplete,
  onShowInspirationModal,
  websiteModalOpen,
  onWebsiteModalOpenChange,
  adCount = 0,
  floatingTiles = [],
}: HeroSectionProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isModalOpen = websiteModalOpen ?? internalOpen;
  const setIsModalOpen = onWebsiteModalOpenChange ?? setInternalOpen;

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentProgress, setCurrentProgress] = useState(0);
  const router = useRouter();
  const { toast } = useToast();

  // Reset form when website modal opens
  useEffect(() => {
    if (isModalOpen) {
      setWebsiteUrl("");
      setIsAnalyzing(false);
      setCurrentStepIndex(0);
      setCurrentProgress(0);
    }
  }, [isModalOpen]);

  // Progress steps during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setCurrentStepIndex(0);
      setCurrentProgress(0);
      return;
    }
    setCurrentStepIndex(0);
    setCurrentProgress(analysisSteps[0].percent);
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < analysisSteps.length - 1) {
        stepIdx += 1;
        setCurrentStepIndex(stepIdx);
        setCurrentProgress(analysisSteps[stepIdx].percent);
      }
    }, 1200);
    return () => clearInterval(stepInterval);
  }, [isAnalyzing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteUrl.trim()) return;

    const normalizedUrl = normalizeUrl(websiteUrl);
    const startTime = Date.now();
    trackWebsiteAnalysisStarted(normalizedUrl);
    setIsAnalyzing(true);
    localStorage.setItem("dvyb_pending_website_url", normalizedUrl);

    try {
      const response = await contextApi.analyzeWebsiteGuest(normalizedUrl);
      if (response.success && response.data) {
        localStorage.setItem("dvyb_website_analysis", JSON.stringify(response.data));
        trackWebsiteAnalysisCompleted(normalizedUrl, Date.now() - startTime);
        onAnalysisComplete?.(normalizedUrl);
        setIsModalOpen(false);
        onShowInspirationModal ? onShowInspirationModal() : router.push("/onboarding/inspiration-selection");
      } else {
        throw new Error("Website analysis failed");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not analyze your website. Please try again.";
      toast({
        title: "Analysis Failed",
        description: message,
        variant: "destructive",
      });
      setIsAnalyzing(false);
    }
  };

  const stats = [
    { value: `${adCount.toLocaleString()}+`, label: "Ads created", hasAnimation: true },
    { value: "15+", label: "Industries served", hasAnimation: false },
    { value: "Weekly", label: "New teams joining", hasAnimation: false },
  ];

  return (
    <>
      {/* Hero: responsive padding and typography (wander-discover-connect style) */}
      <section className="relative pt-24 sm:pt-28 pb-6 sm:pb-8 px-4 sm:px-6 overflow-hidden">
        {/* Layered background */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "var(--gradient-hero)" }} />

        {/* Decorative floating shapes */}
        <div
          className="absolute top-20 left-[10%] w-72 h-72 rounded-full opacity-40 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(25 80% 70% / 0.3) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-40 right-[15%] w-96 h-96 rounded-full opacity-30 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(200 60% 70% / 0.2) 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-10 left-[30%] w-64 h-64 rounded-full opacity-25 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(280 50% 70% / 0.2) 0%, transparent 70%)" }}
        />

        {/* Orange accent glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(25 100% 55% / 0.15) 0%, transparent 70%)" }}
        />

        <div className="container mx-auto relative z-10">
          {/* Hero Text */}
          <div className="text-center max-w-4xl mx-auto">
            <div className="text-base sm:text-lg md:text-xl lg:text-2xl font-medium mb-4 sm:mb-6 animate-fade-up flex items-center justify-center gap-2 flex-wrap">
              <span className="text-cta font-display">Skip</span>
              <span
                className="relative inline-flex items-center justify-center w-[120px] sm:w-[140px] md:w-[160px] lg:w-[180px] h-[1.8em]"
                style={{ perspective: "300px" }}
              >
                {/* 3D Prism rotation */}
                <span
                  className="absolute animate-prism-rotate"
                  style={{
                    transformStyle: "preserve-3d",
                  }}
                >
                  {rotatingWords.map((word, index) => (
                    <span
                      key={word}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center bg-foreground text-background px-3 py-1 rounded-lg font-display whitespace-nowrap"
                      style={{
                        transform: `translateX(-50%) translateY(-50%) rotateX(${index * -120}deg) translateZ(28px)`,
                        backfaceVisibility: "hidden",
                      }}
                    >
                      {word}
                    </span>
                  ))}
                </span>
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 sm:mb-8 animate-fade-up font-display">
              winning Ads <span className="text-cta">in minutes</span>
            </h1>
            <p
              className="text-base sm:text-lg md:text-xl text-muted-foreground mb-8 sm:mb-10 animate-fade-up max-w-2xl mx-auto leading-relaxed px-1"
              style={{ animationDelay: "0.1s" }}
            >
              AI finds top-performing competitor ads and instantly recreates them in your brand
            </p>

            <div className="flex flex-col items-center gap-5 animate-fade-up" style={{ animationDelay: "0.2s" }}>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="group relative w-full sm:w-auto px-8 py-4 sm:px-10 sm:py-5 bg-cta text-cta-foreground rounded-full font-semibold text-base sm:text-lg transition-all duration-300 hover:scale-105"
                style={{ boxShadow: "0 0 40px -10px hsl(25 100% 55% / 0.5)" }}
              >
                <span className="relative z-10">Try for free</span>
                <div className="absolute inset-0 rounded-full bg-cta opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-300" />
              </button>
              <p className="text-sm text-muted-foreground tracking-wide">
                Takes ~2 minutes · No credit card required
              </p>
            </div>

            {/* Traction Stats */}
            <div className="mt-10 sm:mt-14 flex flex-wrap justify-center gap-6 sm:gap-10 md:gap-16 animate-fade-up" style={{ animationDelay: "0.3s" }}>
              {stats.map((stat) => (
                <div key={stat.label} className="text-center relative">
                  <p className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground">
                    {stat.value}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
                  {stat.hasAnimation &&
                    floatingTiles.map(({ id, delay, imageIndex }, index) => {
                      const offsetPercent = (index % 3 - 1) * 30;
                      return (
                        <div
                          key={id}
                          className="absolute w-8 h-10 rounded-sm overflow-hidden shadow-lg pointer-events-none animate-float-up border border-border/50"
                          style={{
                            top: "-15px",
                            left: `calc(50% + ${offsetPercent}%)`,
                            transform: "translateX(-50%)",
                            animationDelay: `${delay}ms`,
                            opacity: 0,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={tileImages[imageIndex]}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute -left-0.5 top-1 z-10">
                            <span
                              className="block pl-1 pr-1.5 py-0.5 bg-gradient-to-r from-green-700 via-green-600 to-green-500 text-white text-[5px] font-bold tracking-wide"
                              style={{
                                clipPath: "polygon(0 0, 100% 0, 85% 100%, 0 100%)",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                              }}
                            >
                              WINNER
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* dvyb website modal (replaces wander OnboardingModal) */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="w-[min(96vw,1120px)] sm:w-[min(92vw,1240px)] max-w-none min-h-[min(80vh,560px)] sm:min-h-[min(88vh,720px)] p-4 sm:p-8 md:p-14 lg:p-20 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl">
          <div className="flex flex-col items-center text-center space-y-4 sm:space-y-5 pt-1 max-w-xl mx-auto">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-neutral-200/80 flex items-center justify-center shrink-0">
              <Globe className="w-6 h-6 sm:w-7 sm:h-7 text-neutral-600" />
            </div>
            <div className="space-y-2 px-1">
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight text-neutral-900 leading-tight">
                Paste your website — we&apos;ll build ads that match your brand
              </h2>
              <p className="text-xs sm:text-sm text-neutral-600 max-w-md mx-auto">
                We analyze your visuals, tone, products, and audience to generate ads that actually fit.
              </p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 mt-4 sm:mt-6 max-w-xl mx-auto w-full px-0 sm:px-0">
            {isAnalyzing ? (
              <div className="flex flex-col items-center w-full">
                <div className="mb-6 w-full text-center">
                  <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900 mb-4">
                    {currentProgress === 100
                      ? "Your brand is ready. Let's create ads."
                      : "Understanding your brand and market"}
                  </h2>
                </div>
                <div className="space-y-5 w-full">
                  <div className="h-3 bg-neutral-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${currentProgress}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                    {analysisSteps.map((s, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
                          idx < currentStepIndex
                            ? "bg-neutral-200 text-neutral-700"
                            : idx === currentStepIndex
                              ? "bg-neutral-900 text-white"
                              : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {idx < currentStepIndex && (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{s.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-neutral-500 text-center mt-4 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  This takes about 30 seconds
                </p>
              </div>
            ) : (
              <>
                {/* Mobile: stack input and button in separate rows; tablet/desktop: side by side */}
                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <Input
                    type="text"
                    placeholder="Website or Instagram (e.g. yourbrand.com or @you)"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    className={`flex-1 min-w-0 rounded-2xl border-2 bg-white text-sm sm:text-base text-neutral-900 placeholder:text-neutral-400 h-12 sm:h-14 transition-colors focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
                      websiteUrl.trim()
                        ? "border-[hsl(var(--landing-accent-orange))]"
                        : "border-neutral-300 focus-visible:border-[hsl(var(--landing-accent-orange))]"
                    }`}
                    required
                    disabled={isAnalyzing}
                  />
                  <Button
                    type="submit"
                    disabled={!websiteUrl.trim() || isAnalyzing}
                    className="rounded-2xl bg-[hsl(var(--landing-cta-bg))] text-white hover:bg-[hsl(var(--landing-cta-bg))] hover:opacity-90 border-0 shadow-none px-6 font-medium shrink-0 flex items-center justify-center gap-2 h-12 sm:h-14 text-sm sm:text-base w-full sm:w-auto"
                  >
                    Analyze my brand
                    <span aria-hidden>→</span>
                  </Button>
                </div>
                <p className="text-xs text-neutral-500 text-center">
                  This takes about 30 seconds
                </p>
              </>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
