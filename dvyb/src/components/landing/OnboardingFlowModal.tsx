"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Check, ArrowRight, Loader2, Upload, Plus, Globe } from "lucide-react";
import { brandsApi, authApi, contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  trackInspirationPageViewed,
  trackInspirationSelected,
  trackSignInClicked,
  trackOnboardingProductsFetched,
  trackOnboardingProductChosen,
  trackOnboardingRelevantAdsFetched,
  trackOnboardingInspirationSelected,
  trackWebsiteAnalysisStarted,
  trackWebsiteAnalysisCompleted,
  trackOnboardingFlowStepViewed,
} from "@/lib/mixpanel";

const ANALYSIS_STEPS = [
  { percent: 0, label: "Analyzing your brand identity" },
  { percent: 20, label: "Studying ads in your industry" },
  { percent: 35, label: "Learning what converts for similar brands" },
  { percent: 55, label: "Preparing your ad templates" },
  { percent: 65, label: "Creating brand profile" },
  { percent: 85, label: "Downloading product collateral" },
  { percent: 100, label: "Your brand is ready. Let's create ads." },
];

type Step = "website" | "analyzing" | "inspiration" | "product" | "login";

interface DiscoverAd {
  id: number;
  image: string | null;
  videoSrc: string | null;
  isVideo: boolean;
  brandName: string;
  brandLetter: string;
  category: string | null;
  creativeImageUrl: string | null;
  creativeVideoUrl: string | null;
}

const ALLOWED_PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

function isValidWebsiteUrl(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  const toParse = /^https?:\/\//i.test(value) ? value : "https://" + value;
  try {
    const parsed = new URL(toParse);
    const host = parsed.hostname;
    if (!host || host.includes(" ")) return false;
    const parts = host.split(".");
    if (parts.length < 2) return false;
    const tld = parts[parts.length - 1];
    return tld.length >= 2 && /^[a-zA-Z]{2,}$/.test(tld);
  } catch {
    return false;
  }
}

interface OnboardingFlowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, modal opens on "analyzing" step with this URL (from Hero); otherwise opens on "website" step. */
  initialWebsiteUrl?: string | null;
  /** Copy B for tracking (Copy A uses separate flow) */
  copy?: "B";
  /** When provided, show "No I will explore myself" on website step; on click close modal and go to discover. */
  onSkipToDiscover?: () => void;
  /** When true, after inspiration selection we skip the login step and call onProceedToGeneration instead. */
  isAuthenticated?: boolean;
  /** When user is authenticated and clicks "Create Ads" after inspiration, call this to start generation and open content dialog. */
  onProceedToGeneration?: () => void | Promise<void>;
}

export function OnboardingFlowModal({ open, onOpenChange, initialWebsiteUrl, copy = "B", onSkipToDiscover, isAuthenticated, onProceedToGeneration }: OnboardingFlowModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("website");

  // Website step (when opened without URL from Hero)
  const [websiteInputUrl, setWebsiteInputUrl] = useState("");
  const [websiteInputError, setWebsiteInputError] = useState<string | null>(null);

  // Analyzing step
  const [analyzingUrl, setAnalyzingUrl] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStepIndex, setAnalysisStepIndex] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analysisStartTimeRef = useRef<number>(0);

  // Inspiration state (discover ads from dvyb_brand_ads)
  const [discoverAds, setDiscoverAds] = useState<DiscoverAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [selectedAdIds, setSelectedAdIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const hasFetchedAds = useRef(false);

  // Custom inspiration (when no matching ads - drag & drop image only)
  const [customInspirationS3Url, setCustomInspirationS3Url] = useState<string | null>(null);
  const [customInspirationFile, setCustomInspirationFile] = useState<File | null>(null);
  const [isCustomInspirationUploading, setIsCustomInspirationUploading] = useState(false);
  const [isCustomInspirationDraggingOver, setIsCustomInspirationDraggingOver] = useState(false);
  const inspirationFileInputRef = useRef<HTMLInputElement>(null);

  // Product state
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [domainProductsLoading, setDomainProductsLoading] = useState(true);
  const [domainProducts, setDomainProducts] = useState<Array<{ id: number; s3Key: string; image: string }>>([]);
  const [domainProductsDone, setDomainProductsDone] = useState(false); // true when we've stopped polling
  const [isProductUploading, setIsProductUploading] = useState(false);
  const [isProductDraggingOver, setIsProductDraggingOver] = useState(false);
  const productFileInputRef = useRef<HTMLInputElement>(null);

  // Login state
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    hasFetchedAds.current = false;
    setDomainProductsLoading(true);
    setDomainProducts([]);
    setDomainProductsDone(false);
    setCustomInspirationS3Url(null);
    setCustomInspirationFile(null);
    setWebsiteInputUrl("");
    setWebsiteInputError(null);
    setAnalysisProgress(0);
    setAnalysisStepIndex(0);
    setIsAnalyzing(false);
    if (initialWebsiteUrl?.trim()) {
      setAnalyzingUrl(initialWebsiteUrl.trim());
      setStep("analyzing");
    } else {
      setAnalyzingUrl(null);
      setStep("website");
    }
  }, [open, initialWebsiteUrl]);

  // Track Copy B flow steps
  useEffect(() => {
    if (open && step) {
      trackOnboardingFlowStepViewed(copy, step);
    }
  }, [open, step, copy]);

  const analysisStartedRef = useRef(false);

  useEffect(() => {
    if (!open || step !== "analyzing" || !analyzingUrl?.trim()) return;
    if (analysisStartedRef.current) return;
    analysisStartedRef.current = true;
    const url = normalizeUrl(analyzingUrl);
    localStorage.setItem("dvyb_pending_website_url", url);
    trackWebsiteAnalysisStarted(url, { copy });
    analysisStartTimeRef.current = Date.now();
    setIsAnalyzing(true);
    setAnalysisProgress(ANALYSIS_STEPS[0].percent);
    setAnalysisStepIndex(0);

    let stepIdx = 0;
    const progressInterval = setInterval(() => {
      if (stepIdx < ANALYSIS_STEPS.length - 1) {
        stepIdx += 1;
        setAnalysisStepIndex(stepIdx);
        setAnalysisProgress(ANALYSIS_STEPS[stepIdx].percent);
      }
    }, 1200);

    const run = async () => {
      try {
        const response = await contextApi.analyzeWebsiteGuest(url);
        if (response.success && response.data) {
          localStorage.setItem("dvyb_website_analysis", JSON.stringify(response.data));
          trackWebsiteAnalysisCompleted(url, Date.now() - analysisStartTimeRef.current, { copy });
          setAnalysisProgress(100);
          setAnalysisStepIndex(ANALYSIS_STEPS.length - 1);
          setTimeout(() => setStep("product"), 800);
        } else {
          throw new Error("Website analysis failed");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not analyze your website. Please try again.";
        toast({ title: "Analysis Failed", description: message, variant: "destructive" });
      } finally {
        setIsAnalyzing(false);
      }
    };
    run();
    return () => {
      clearInterval(progressInterval);
    };
  }, [open, step, analyzingUrl, toast]);

  useEffect(() => {
    if (!open) analysisStartedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || step !== "inspiration") return;
    const load = async () => {
      if (hasFetchedAds.current) return;
      hasFetchedAds.current = true;
      setAdsLoading(true);
      try {
        let websiteCategory: string | undefined;
        let websiteUrl: string | undefined;
        let brandContext: { business_overview?: string | null; popular_products?: string[] | null; customer_demographics?: string | null; brand_story?: string | null } | undefined;
        let productImageS3Key: string | undefined;
        try {
          websiteUrl = localStorage.getItem("dvyb_pending_website_url")?.trim() || undefined;
        } catch {
          /* ignore */
        }
        try {
          const analysisStr = localStorage.getItem("dvyb_website_analysis");
          if (analysisStr) {
            const analysis = JSON.parse(analysisStr) as {
              industry?: string;
              business_overview_and_positioning?: string;
              most_popular_products_and_services?: string | string[];
              customer_demographics_and_psychographics?: string;
              brand_story?: string;
              source_urls?: string[];
              url?: string;
              domain?: string;
            };
            websiteCategory = analysis?.industry?.trim() || undefined;
            if (!websiteUrl && analysis?.source_urls?.[0]) websiteUrl = analysis.source_urls[0].trim();
            if (!websiteUrl && analysis?.url) websiteUrl = String(analysis.url).trim();
            if (!websiteUrl && analysis?.domain) websiteUrl = String(analysis.domain).trim();
            const pop = analysis?.most_popular_products_and_services;
            brandContext = {
              business_overview: analysis?.business_overview_and_positioning ?? null,
              popular_products: Array.isArray(pop) ? pop : typeof pop === "string" ? (pop ? [pop] : null) : null,
              customer_demographics: analysis?.customer_demographics_and_psychographics ?? null,
              brand_story: analysis?.brand_story ?? null,
            };
          }
        } catch {
          /* ignore */
        }
        try {
          const selectedStr = localStorage.getItem("dvyb_selected_products");
          if (selectedStr) {
            const selected = JSON.parse(selectedStr) as Array<{ id: number; s3Key: string; image?: string }>;
            if (Array.isArray(selected) && selected.length > 0 && selected[0]?.s3Key) {
              productImageS3Key = selected[0].s3Key;
            }
          }
        } catch {
          /* ignore */
        }
        const response = await brandsApi.getDiscoverAdsOnboarding({
          page: 1,
          limit: 24,
          sort: "latest",
          ...(productImageS3Key && { productImageS3Key }),
          ...(websiteCategory && { websiteCategory }),
          ...(brandContext && Object.values(brandContext).some((v) => v != null && (Array.isArray(v) ? v.length : true)) && { brandContext }),
        });
        if (response.success && response.data) {
          const ads = (response.data as Array<Record<string, unknown>>).map((ad) => ({
            id: ad.id as number,
            image: (ad.creativeImageUrl as string) ?? null,
            videoSrc: (ad.creativeVideoUrl as string) ?? null,
            isVideo: ad.mediaType === "video",
            brandName: (ad.brandName as string) || "Unknown",
            brandLetter: (ad.brandLetter as string) || "?",
            category: ad.category as string | null,
            creativeImageUrl: (ad.creativeImageUrl as string) ?? null,
            creativeVideoUrl: (ad.creativeVideoUrl as string) ?? null,
          }));
          setDiscoverAds(ads);
          trackOnboardingRelevantAdsFetched({
            adCount: ads.length,
            ...(ads.length === 0 && websiteUrl && { websiteUrl }),
          });
          trackInspirationPageViewed({ industry: "discover", inspirationCount: ads.length });
        }
      } catch (e) {
        console.error("Failed to load ads:", e);
        toast({ title: "Error", description: "Failed to load ads", variant: "destructive" });
      } finally {
        setAdsLoading(false);
      }
    };
    load();
  }, [open, step, toast, onOpenChange]);

  const filteredAds = searchQuery.trim()
    ? discoverAds.filter(
        (ad) =>
          ad.brandName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ad.category?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : discoverAds;

  const handleAdToggle = (id: number) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInspirationNext = () => {
    const selected = discoverAds.filter((ad) => selectedAdIds.has(ad.id));
    if (selected.length > 0) {
      trackOnboardingInspirationSelected({ adIds: selected.map((ad) => ad.id), count: selected.length });
      selected.forEach((ad) =>
        trackInspirationSelected({ inspirationId: ad.id, platform: "discover", category: ad.category || "" })
      );
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(selected));
    } else if (customInspirationS3Url) {
      const customInspiration = [{ creativeImageUrl: customInspirationS3Url, image: customInspirationS3Url }];
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(customInspiration));
    }
    if (isAuthenticated && onProceedToGeneration) {
      onProceedToGeneration();
      return;
    }
    setStep("login");
  };

  const handleProductNext = () => {
    const selected = domainProducts.filter((p) => selectedProductIds.has(p.id));
    if (selected.length > 0) {
      trackOnboardingProductChosen({ productIds: selected.map((p) => p.id), count: selected.length });
      localStorage.setItem(
        "dvyb_selected_products",
        JSON.stringify(selected.map((p) => ({ id: p.id, s3Key: p.s3Key, image: p.image })))
      );
    }
    setStep("inspiration");
  };

  const handleProductToggle = (id: number) => {
    setSelectedProductIds((prev) => {
      if (prev.has(id)) return new Set<number>();
      return new Set([id]);
    });
  };

  /** Get domain/url from localStorage for upload */
  const getDomainForUpload = useCallback(() => {
    const url =
      localStorage.getItem("dvyb_pending_website_url")?.trim() ||
      (() => {
        try {
          const analysisStr = localStorage.getItem("dvyb_website_analysis");
          if (analysisStr) {
            const analysis = JSON.parse(analysisStr);
            return analysis?.source_urls?.[0] || analysis?.url || analysis?.domain || "";
          }
        } catch {
          /* ignore */
        }
        return "";
      })();
    return url || "onboarding";
  }, []);

  const processProductFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
        toast({
          title: "Invalid file",
          description: "Please upload JPEG, PNG, or WebP image",
          variant: "destructive",
        });
        return;
      }
      setIsProductUploading(true);
      try {
        const domain = getDomainForUpload();
        const result = await contextApi.uploadDomainProductImage(file, domain);
        setDomainProducts([result]);
        setSelectedProductIds(new Set([result.id]));
        trackOnboardingProductsFetched({ productCount: 1, source: "upload" });
      } catch (e) {
        console.error("Failed to upload product:", e);
        toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" });
      } finally {
        setIsProductUploading(false);
      }
    },
    [getDomainForUpload, toast]
  );

  const handleProductFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processProductFile(file);
    e.target.value = "";
  };

  const handleProductDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(true);
  };

  const handleProductDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsProductDraggingOver(false);
    }
  };

  const handleProductDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processProductFile(file);
  };

  const processCustomInspirationFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
        toast({
          title: "Invalid file",
          description: "Please upload JPEG, PNG, or WebP image",
          variant: "destructive",
        });
        return;
      }
      setIsCustomInspirationUploading(true);
      try {
        const s3Url = await contextApi.uploadGuestInspirationImage(file);
        setCustomInspirationS3Url(s3Url);
        setCustomInspirationFile(file);
      } catch (e) {
        console.error("Failed to upload inspiration:", e);
        toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" });
      } finally {
        setIsCustomInspirationUploading(false);
      }
    },
    [toast]
  );

  const handleCustomInspirationFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processCustomInspirationFile(file);
    e.target.value = "";
  };

  const handleCustomInspirationDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCustomInspirationDraggingOver(true);
  };

  const handleCustomInspirationDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsCustomInspirationDraggingOver(false);
    }
  };

  const handleCustomInspirationDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCustomInspirationDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processCustomInspirationFile(file);
  };

  // Fetch domain product images when entering product step - poll every 4s; show all images saved in DB
  const POLL_INTERVAL_MS = 4000;
  const MAX_POLLS = 120; // ~8 min total (images can take time with Apify download)

  useEffect(() => {
    if (!open || step !== "product") return;
    const url =
      localStorage.getItem("dvyb_pending_website_url")?.trim() ||
      (() => {
        try {
          const analysisStr = localStorage.getItem("dvyb_website_analysis");
          if (analysisStr) {
            const analysis = JSON.parse(analysisStr);
            return analysis?.source_urls?.[0] || analysis?.url || analysis?.domain || "";
          }
        } catch {
          /* ignore */
        }
        return "";
      })();
    if (!url) {
      setDomainProductsLoading(false);
      setDomainProductsDone(true);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      pollCount += 1;
      try {
        const res = await contextApi.getDomainProductImages(url);
        if (cancelled) return;
        if (res.success && res.data?.images?.length > 0) {
          // Use all images returned by the API (backend returns up to 20)
          const images = res.data.images;
          setDomainProducts(images);
          setDomainProductsLoading(false);
          trackOnboardingProductsFetched({ productCount: images.length, source: "domain" });
          // Stop polling once we have the max the backend returns (20)
          if (images.length >= 20) {
            setDomainProductsDone(true);
            return;
          }
        }
      } catch {
        // ignore, continue polling
      }
      if (pollCount >= MAX_POLLS) {
        setDomainProductsLoading(false);
        setDomainProductsDone(true);
        return;
      }
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [open, step]);

  // Show all domain product images saved in the database
  const displayProducts = domainProducts;


  const handleGoogleLogin = async () => {
    if (isConnecting) return;
    trackSignInClicked("google", "onboarding_modal", { copy });
    setIsConnecting(true);
    try {
      localStorage.removeItem("dvyb_google_oauth_state");
      // Flag for callback: after OAuth, upload product, start generation, redirect to landing with content modal
      localStorage.setItem("dvyb_landing_onboarding_flow_pending", "true");
      const response = await authApi.getGoogleLoginUrl();
      if (response.success && response.data.oauth_url) {
        if (response.data.state) {
          localStorage.setItem("dvyb_google_oauth_state", response.data.state);
        }
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect with Google";
      toast({ title: "Sign In Failed", description: message, variant: "destructive" });
      setIsConnecting(false);
    }
  };

  const handleWebsiteContinue = () => {
    if (!websiteInputUrl.trim()) {
      setWebsiteInputError("Please enter your website URL.");
      return;
    }
    if (!isValidWebsiteUrl(websiteInputUrl)) {
      setWebsiteInputError("Please enter a valid URL (e.g. yourbrand.com or https://yourbrand.com).");
      return;
    }
    setWebsiteInputError(null);
    const url = normalizeUrl(websiteInputUrl);
    localStorage.setItem("dvyb_pending_website_url", url);
    setAnalyzingUrl(url);
    setStep("analyzing");
  };

  const handleInteractOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-floating-bar]")) {
      e.preventDefault();
    }
  };

  const modalShellClass =
    "max-w-[95vw] sm:max-w-[90vw] w-full h-[min(92vh,720px)] min-h-[min(80vh,560px)] sm:min-h-[min(90vh,720px)] max-h-[92vh] sm:max-h-[90vh] flex flex-col p-0 gap-0 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl overflow-hidden";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={modalShellClass} onInteractOutside={handleInteractOutside}>
        {/* Step: Website (when opened without URL from Hero) */}
        {step === "website" && (
          <div className="flex flex-col items-center justify-center flex-1 px-4 sm:px-6 py-8 sm:py-12 min-h-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-neutral-200/80 flex items-center justify-center shrink-0 mb-4">
              <Globe className="w-6 h-6 sm:w-7 sm:h-7 text-neutral-600" />
            </div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-center text-neutral-900 mb-2">
              Enter your website
            </h2>
            <p className="text-xs sm:text-sm text-neutral-600 text-center max-w-md mb-6">
              We&apos;ll analyze your brand and then take you through product and inspiration.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <Input
                type="text"
                placeholder="https://yourbrand.com"
                value={websiteInputUrl}
                onChange={(e) => {
                  setWebsiteInputUrl(e.target.value);
                  if (websiteInputError) setWebsiteInputError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleWebsiteContinue()}
                className="flex-1 min-w-0 h-12 rounded-2xl border-2 bg-white text-neutral-900"
              />
              <Button
                type="button"
                onClick={handleWebsiteContinue}
                disabled={!websiteInputUrl.trim()}
                className="rounded-2xl h-12 px-6 bg-neutral-900 text-white hover:bg-neutral-800"
              >
                Continue
              </Button>
            </div>
            {websiteInputError && (
              <p className="mt-2 text-xs text-red-500 text-center w-full max-w-md">{websiteInputError}</p>
            )}
            {onSkipToDiscover && (
              <button
                type="button"
                onClick={onSkipToDiscover}
                className="mt-4 text-sm text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors"
              >
                No I will explore myself
              </button>
            )}
          </div>
        )}

        {/* Step: Analyzing (after URL from Hero or website step) */}
        {step === "analyzing" && (
          <div className="flex flex-col items-center justify-center flex-1 px-4 sm:px-6 py-8 sm:py-12 min-h-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-neutral-200/80 flex items-center justify-center shrink-0 mb-4">
              <Globe className="w-6 h-6 sm:w-7 sm:h-7 text-neutral-600" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-center text-neutral-900 mb-4">
              {analysisProgress === 100 ? "Your brand is ready. Let's create ads." : "Understanding your brand and market"}
            </h2>
            <div className="w-full max-w-xl space-y-5">
              <div className="h-3 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neutral-900 transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                {ANALYSIS_STEPS.map((s, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
                      idx < analysisStepIndex
                        ? "bg-neutral-200 text-neutral-700"
                        : idx === analysisStepIndex
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {idx < analysisStepIndex && <Check className="w-3.5 h-3.5 shrink-0" />}
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
        )}

        {/* Step: Product */}
        {step === "product" && (
          <>
            <div className="px-4 sm:px-6 py-4 sm:py-6 border-b border-border shrink-0">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 text-center text-neutral-900">
                Select your product
              </h2>
              <p className="text-muted-foreground text-center mb-2 text-sm sm:text-base">Add one product image. We&apos;ll use it for your ad.</p>
              <p className="text-xs text-muted-foreground text-center">
                You can regenerate with a different product later.
              </p>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 ${selectedProductIds.size > 0 ? "pb-24" : "pb-4"}`}>
              <input
                ref={productFileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleProductFileSelect}
              />
              {domainProductsLoading && !domainProductsDone ? (
                <div className="flex flex-col items-center justify-center py-16 gap-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-neutral-200 border-t-neutral-900 animate-spin" />
                    <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-t-neutral-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                  </div>
                  <p className="text-muted-foreground text-center max-w-xs">
                    Please wait… we&apos;re pulling your brand products from your website.
                  </p>
                  <p className="text-xs text-muted-foreground">This usually takes a few seconds</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 content-start items-start">
                  <button
                    type="button"
                    onClick={() => !isProductUploading && productFileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsProductDraggingOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setIsProductDraggingOver(false);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsProductDraggingOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) processProductFile(file);
                    }}
                    disabled={isProductUploading}
                    className={`text-left rounded-xl overflow-hidden cursor-pointer shrink-0 flex flex-col border-2 border-dashed bg-secondary/50 transition-colors group ${
                      isProductDraggingOver ? "border-primary bg-primary/5" : "border-border hover:border-primary hover:bg-primary/5"
                    } ${isProductUploading ? "pointer-events-none opacity-70" : ""}`}
                  >
                    <div className="aspect-square flex flex-col items-center justify-center gap-2 text-muted-foreground group-hover:text-primary px-2">
                      {isProductUploading ? (
                        <Loader2 className="w-8 h-8 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-8 h-8" />
                          <span className="text-sm font-medium">Add Product</span>
                          <span className="text-xs text-center">or drag and drop here</span>
                        </>
                      )}
                    </div>
                  </button>
                  {displayProducts.map((product) => {
                    const isSelected = selectedProductIds.has(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleProductToggle(product.id)}
                        className={`text-left rounded-xl overflow-hidden cursor-pointer group transition-all shrink-0 border border-neutral-200 bg-white ${
                          isSelected ? "ring-4 ring-neutral-900 ring-offset-2 border-neutral-300" : "hover:shadow-lg hover:border-neutral-300"
                        }`}
                      >
                        <div className="aspect-square relative bg-neutral-200 flex items-center justify-center">
                          <img src={product.image} alt="Product" className="w-full h-full object-contain" />
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-6 h-6 bg-neutral-900 rounded-full flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: Inspiration */}
        {step === "inspiration" && (
          <>
            <div className="px-4 sm:px-6 py-4 sm:py-6 border-b border-border shrink-0">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 text-center text-neutral-900 px-1">
                Here are some live ads from your competitors
              </h2>
              <p className="text-muted-foreground text-center mb-4 sm:mb-6 text-sm sm:text-base">Choose one to recreate in your brand</p>
              <div className="max-w-md mx-auto px-1">
                <div className="flex items-center gap-3 bg-neutral-100 rounded-full px-4 sm:px-5 py-2.5 sm:py-3 border border-neutral-200">
                  <Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    placeholder="Search brands or keywords..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </div>
              </div>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 ${selectedAdIds.size > 0 || (discoverAds.length === 0 && customInspirationS3Url) ? "pb-24" : "pb-4"}`}>
              {adsLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-neutral-200 border-t-neutral-900 animate-spin" />
                    <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-t-neutral-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                  </div>
                  <p className="text-muted-foreground text-center max-w-xs">
                    Please wait… we&apos;re finding ads that match your product.
                  </p>
                  <p className="text-xs text-muted-foreground">This usually takes a few seconds</p>
                </div>
              ) : discoverAds.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-6">
                  <input
                    ref={inspirationFileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={handleCustomInspirationFileSelect}
                  />
                  {!customInspirationS3Url && (
                    <>
                      <p className="text-center text-muted-foreground font-medium">
                        No matching ads.
                      </p>
                      <p className="text-center text-sm text-muted-foreground max-w-md">
                        We&apos;re relentlessly enriching our ad library. Come back later — or use your own inspiration below to get started now.
                      </p>
                    </>
                  )}
                  {customInspirationS3Url ? (
                    <div className="flex justify-center w-full">
                      <div className="text-left rounded-xl overflow-hidden border-2 border-neutral-900 ring-4 ring-neutral-900 ring-offset-2 bg-white w-full max-w-md sm:max-w-lg">
                        <div className="relative bg-neutral-100 flex items-center justify-center overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={customInspirationS3Url}
                            alt="Your inspiration"
                            className="w-full h-auto max-h-[360px] sm:max-h-[440px] md:max-h-[500px] object-contain object-center block"
                          />
                          <div className="absolute top-2 right-2 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center z-10">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                            <p className="text-white text-xs font-medium truncate">Your inspiration</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={handleCustomInspirationDragOver}
                      onDragLeave={handleCustomInspirationDragLeave}
                      onDrop={handleCustomInspirationDrop}
                      onClick={() => !isCustomInspirationUploading && inspirationFileInputRef.current?.click()}
                      className={`w-full max-w-md flex flex-col items-center justify-center min-h-[200px] rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                        isCustomInspirationDraggingOver ? "border-primary bg-primary/5" : "border-border hover:border-primary hover:bg-primary/5"
                      } ${isCustomInspirationUploading ? "pointer-events-none opacity-70" : ""}`}
                    >
                      {isCustomInspirationUploading ? (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Uploading...</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
                          <Upload className="w-10 h-10 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">Drag & drop your inspiration image</span>
                          <span className="text-xs text-muted-foreground">or click to browse · JPEG, PNG, or WebP</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : filteredAds.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">No ads match your search.</div>
              ) : (
                <div
                  className={
                    filteredAds.length >= 8
                      ? "columns-[140px] sm:columns-[160px] md:columns-[180px] lg:columns-[200px] gap-3 sm:gap-4"
                      : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 max-w-5xl mx-auto"
                  }
                >
                  {filteredAds.map((ad) => {
                    const isSelected = selectedAdIds.has(ad.id);
                    const mediaUrl = ad.isVideo ? ad.videoSrc : ad.image;
                    const useMasonry = filteredAds.length >= 8;
                    return (
                      <button
                        key={ad.id}
                        type="button"
                        onClick={() => handleAdToggle(ad.id)}
                        className={`text-left rounded-xl overflow-hidden cursor-pointer transition-all border border-neutral-200 bg-white w-full min-w-0 ${
                          useMasonry ? "break-inside-avoid mb-3 sm:mb-4" : ""
                        } ${
                          isSelected ? "ring-4 ring-neutral-900 ring-offset-2" : "hover:shadow-lg hover:border-neutral-300"
                        }`}
                      >
                        <div className="relative bg-neutral-100 flex items-center justify-center overflow-hidden">
                          {mediaUrl ? (
                            ad.isVideo ? (
                              <div className="w-full aspect-video bg-neutral-200 flex items-center justify-center">
                                <video
                                  src={mediaUrl}
                                  className="w-full h-full object-contain max-h-[280px] sm:max-h-none"
                                  muted
                                  playsInline
                                />
                              </div>
                            ) : (
                              /* Responsive: contain image so it is not cut; use object-contain and max-h for consistency */
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={mediaUrl}
                                alt={ad.brandName}
                                className="w-full h-auto max-h-[320px] sm:max-h-[400px] object-contain object-center block"
                              />
                            )
                          ) : (
                            <div className="w-full aspect-square flex items-center justify-center bg-neutral-200 text-neutral-500">
                              <span className="text-xs">No preview</span>
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center z-10">
                              <Check className="w-4 h-4 text-white" />
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                            <p className="text-white text-xs font-medium truncate">
                              {ad.brandName} {ad.category ? `· ${ad.category}` : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 3: Login */}
        {step === "login" && (
          <div className="flex flex-col items-center justify-center flex-1 px-4 sm:px-6 py-6 sm:py-8 min-h-0">
            <div className="max-w-md w-full text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-neutral-200 rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <svg className="w-8 h-8 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2 text-neutral-900">Create your account</h2>
              <p className="text-muted-foreground mb-4 sm:mb-6 text-sm sm:text-base">Save your brand and unlock your personalized ads</p>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isConnecting}
                  className="w-full h-12 md:h-14 flex items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-900 font-medium transition-colors cursor-pointer disabled:opacity-70"
                >
                  {isConnecting ? (
                    <span className="animate-pulse">Connecting...</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Continue with Google
                    </>
                  )}
                </button>

                <p className="text-xs text-muted-foreground">
                  By creating an account, you agree to our{" "}
                  <a href="/terms" className="underline hover:text-foreground">Terms of Service</a> and{" "}
                  <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Floating bar for product step (Step 1) — Next goes to inspiration */}
      {open && step === "product" && typeof document !== "undefined" &&
        createPortal(
          <div
            data-floating-bar
            className={`fixed bottom-0 left-0 right-0 z-[300] flex justify-center px-[5vw] transition-transform duration-300 ease-out cursor-pointer ${
              selectedProductIds.size > 0 ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="w-full max-w-[90vw] mb-6 bg-neutral-900 text-white rounded-2xl px-6 py-4 flex items-center justify-between shadow-2xl pointer-events-auto cursor-pointer">
              <p className="font-medium">
                {selectedProductIds.size} product{selectedProductIds.size !== 1 ? "s" : ""} selected
              </p>
              <button
                type="button"
                onClick={handleProductNext}
                className="inline-flex items-center justify-center gap-2 h-10 px-8 rounded-md text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Floating bar for inspiration step — Create Ads goes to login */}
      {open && step === "inspiration" && typeof document !== "undefined" &&
        createPortal(
          <div
            data-floating-bar
            className={`fixed bottom-0 left-0 right-0 z-[300] flex justify-center px-[5vw] transition-transform duration-300 ease-out cursor-pointer ${
              selectedAdIds.size > 0 || (discoverAds.length === 0 && customInspirationS3Url) ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="w-full max-w-[90vw] mb-6 bg-neutral-900 text-white rounded-2xl px-6 py-4 flex items-center justify-between shadow-2xl pointer-events-auto cursor-pointer">
              <p className="font-medium">
                {selectedAdIds.size > 0
                  ? `${selectedAdIds.size} ad${selectedAdIds.size !== 1 ? "s" : ""} selected`
                  : "Custom inspiration added"}
              </p>
              <button
                type="button"
                onClick={handleInspirationNext}
                className="inline-flex items-center justify-center gap-2 h-10 px-8 rounded-md text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Create Ads
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
