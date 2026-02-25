"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { NavigationLanding } from "./NavigationLanding";
import { CopyAWelcomeScreen } from "./copy-a/CopyAWelcomeScreen";
import { CopyAWebsiteInputScreen } from "./copy-a/CopyAWebsiteInputScreen";
import { CopyAAnalyzingScreen } from "./copy-a/CopyAAnalyzingScreen";
import { CopyABusinessDnaScreen } from "./copy-a/CopyABusinessDnaScreen";
import { CopyAInspirationSelectScreen } from "./copy-a/CopyAInspirationSelectScreen";
import { CopyASignUpScreen } from "./copy-a/CopyASignUpScreen";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { NotRegisteredModal } from "./NotRegisteredModal";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { contextApi, authApi, adhocGenerationApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  trackWebsiteAnalysisStarted,
  trackWebsiteAnalysisCompleted,
  trackLandingPageViewed,
  trackLandingTimeSpent,
  trackLandingScrolled,
  trackOnboardingFlowStepViewed,
  trackOnboardingFlowCompleted,
} from "@/lib/mixpanel";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Wander-and-seek hero: ad images + videos for stack→burst→done animation
const BASE = "/landing/ads";
type MediaItem = { src: string; isVideo: boolean };
const NEW_IMAGES: MediaItem[] = [
  "Allbirds.jpg",
  "Anker.jpg",
  "Article.jpg",
  "Bags.jpg",
  "Gymshark.jpg",
  "Lulu.jpg",
  "Olly.jpg",
  "Paula-s-Choice.jpg",
  "Sephora.jpg",
  "Swarowski.jpg",
].map((name) => ({ src: `${BASE}/${name}`, isVideo: false }));
const VIDEOS: MediaItem[] = [
  "video-celsius.mp4",
  "video-daise.mp4",
  "video-lip.mp4",
  "video-multi.mp4",
  "video-step.mp4",
  "video-watch.mp4",
].map((name) => ({ src: `${BASE}/${name}`, isVideo: true }));

// Interleave new images with videos (image, video, image, video...)
const ALL_ITEMS: MediaItem[] = (() => {
  const out: MediaItem[] = [];
  for (let i = 0; i < 20; i++) {
    out.push(i % 2 === 0 ? NEW_IMAGES[i % NEW_IMAGES.length] : VIDEOS[i % VIDEOS.length]);
  }
  return out;
})();
const LEFT_ITEMS: MediaItem[] = [
  NEW_IMAGES[0],
  VIDEOS[0],
  NEW_IMAGES[1],
  NEW_IMAGES[2],
  VIDEOS[1],
  NEW_IMAGES[3],
  NEW_IMAGES[4],
  VIDEOS[2],
  NEW_IMAGES[5],
  NEW_IMAGES[6],
];
const RIGHT_ITEMS: MediaItem[] = [
  NEW_IMAGES[7],
  NEW_IMAGES[8],
  NEW_IMAGES[9],
  VIDEOS[3],
  NEW_IMAGES[0],
  NEW_IMAGES[1],
  NEW_IMAGES[2],
  VIDEOS[4],
  NEW_IMAGES[3],
  NEW_IMAGES[4],
  NEW_IMAGES[5],
  NEW_IMAGES[6],
];

const MediaTile = ({ item, className }: { item: MediaItem; className?: string }) =>
  item.isVideo ? (
    <video src={item.src} className={className} autoPlay loop muted playsInline />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={item.src} alt="" className={className} />
  );

const ScrollStripV = ({
  items,
  duration,
  direction = "up",
}: {
  items: MediaItem[];
  duration: number;
  direction?: "up" | "down";
}) => (
  <div className="w-44 lg:w-52 h-full overflow-hidden">
    <div
      style={{ animation: `scroll-${direction} ${duration}s linear infinite` }}
      className="flex flex-col gap-48 lg:gap-56"
    >
      {[...items, ...items].map((item, i) => (
        <div key={i} className="rounded-lg overflow-hidden w-full">
          <MediaTile item={item} className="w-full h-auto" />
        </div>
      ))}
    </div>
  </div>
);

const ScrollStripH = ({
  items,
  duration,
  direction = "left",
}: {
  items: MediaItem[];
  duration: number;
  direction?: "left" | "right";
}) => (
  <div className="h-28 w-full overflow-hidden">
    <div
      style={{ animation: `scroll-${direction} ${duration}s linear infinite` }}
      className="flex flex-row gap-20"
    >
      {[...items, ...items].map((item, i) => (
        <div key={i} className="rounded-lg overflow-hidden h-28 flex-shrink-0">
          <MediaTile item={item} className="h-full w-auto" />
        </div>
      ))}
    </div>
  </div>
);

const HAS_PLAYED_KEY = "dvyb_copy_a_intro_played";

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

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "onboarding";
  }
}

type CopyAStep = "hero" | "welcome" | "input" | "analyzing" | "dna" | "inspirations" | "signup";

interface AnalysisData {
  base_name?: string;
  industry?: string;
  business_overview_and_positioning?: string;
  color_palette?: { primary?: string; secondary?: string; accent?: string } | string[];
  most_popular_products_and_services?: string | string[];
  brand_story?: string;
  detected_font?: string;
  tagline?: string;
  [key: string]: unknown;
}

export function LandingPageCopyA() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const { completeStep } = useOnboardingGuide();
  const { toast } = useToast();

  // When arriving from pricing "Start now" (?step=input) or with ?website= in URL, start at input so analysis can run without login
  const stepParam = searchParams.get("step");
  const websiteParamFromUrl = searchParams.get("website");
  const initialStep: CopyAStep = stepParam === "input" || (!!websiteParamFromUrl?.trim()) ? "input" : "hero";
  const [step, setStep] = useState<CopyAStep>(initialStep);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [websiteSnapshotUrl, setWebsiteSnapshotUrl] = useState<string | null>(null);
  const [domainProducts, setDomainProducts] = useState<Array<{ id: number; s3Key: string; image: string }>>([]);
  const [selectedProduct, setSelectedProduct] = useState<{ id: number; s3Key: string; image: string } | null>(null);
  const [editedColors, setEditedColors] = useState<string[]>([]);
  const [editedFont, setEditedFont] = useState("Inter");
  const [isProductUploading, setIsProductUploading] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
  const [showNotRegisteredModal, setShowNotRegisteredModal] = useState(false);
  const hasPlayed = typeof window !== "undefined" ? sessionStorage.getItem(HAS_PLAYED_KEY) === "true" : false;
  const [phase, setPhase] = useState<"stack" | "burst" | "done">(hasPlayed ? "done" : "stack");
  const [stackCount, setStackCount] = useState(0);

  const analysisStartTimeRef = useRef<number>(0);
  const isDarkTheme = resolvedTheme === "dark";
  const hasTrackedLandingRef = useRef(false);

  // Copy A: default to dark (applies on mount and when switching to Copy A via ?copy=a)
  useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  // Track landing view and Copy A flow steps
  useEffect(() => {
    if (!hasTrackedLandingRef.current) {
      hasTrackedLandingRef.current = true;
      trackLandingPageViewed(isAuthenticated, { copy: "A" });
    }
  }, [isAuthenticated]);
  useEffect(() => {
    trackOnboardingFlowStepViewed("A", step);
  }, [step]);

  // Landing time spent (seconds) – send on unmount
  const landingStartTimeRef = useRef<number>(Date.now());
  useEffect(() => {
    landingStartTimeRef.current = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - landingStartTimeRef.current) / 1000);
      if (seconds > 0) trackLandingTimeSpent(seconds, "A");
    };
  }, []);

  // Landing scroll – fire once when user scrolls
  useEffect(() => {
    let sent = false;
    const onScroll = () => {
      if (sent) return;
      if (typeof window !== "undefined" && window.scrollY > 0) {
        sent = true;
        trackLandingScrolled("A");
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Stack → burst → done animation (wander-and-seek)
  useEffect(() => {
    if (phase !== "stack") return;
    if (stackCount >= ALL_ITEMS.length) {
      const t = setTimeout(() => setPhase("burst"), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStackCount((c) => c + 1), 50);
    return () => clearTimeout(t);
  }, [stackCount, phase]);

  useEffect(() => {
    if (phase !== "burst") return;
    const t = setTimeout(() => {
      setPhase("done");
      if (typeof window !== "undefined") sessionStorage.setItem(HAS_PLAYED_KEY, "true");
    }, 900);
    return () => clearTimeout(t);
  }, [phase]);

  const burstTargets = useMemo(() => {
    if (typeof window === "undefined") return ALL_ITEMS.map(() => ({ x: 0, y: 0, rotate: 0 }));
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = w < 768;
    return ALL_ITEMS.map((_, i) => {
      const isEven = i % 2 === 0;
      const side = isEven ? -1 : 1;
      const indexInSide = Math.floor(i / 2);
      const totalPerSide = Math.ceil(ALL_ITEMS.length / 2);
      if (isMobile) {
        return {
          x: (indexInSide - totalPerSide / 2) * 80,
          y: side * (h * 0.45 + Math.random() * 30),
          rotate: side * (3 + Math.random() * 8),
        };
      }
      return {
        x: side * (w * 0.4 + Math.random() * 30),
        y: (indexInSide - totalPerSide / 2) * 160,
        rotate: side * (3 + Math.random() * 8),
      };
    });
  }, []);

  // Show "not registered" modal when user returns from Sign In with unregistered Google account
  useEffect(() => {
    if (searchParams.get("error") === "not_registered") {
      setShowNotRegisteredModal(true);
      const newSearch = new URLSearchParams(window.location.search);
      newSearch.delete("error");
      const qs = newSearch.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [searchParams]);

  // Initialize edited colors from analysis when entering DNA step (one-time)
  const hasInitializedColors = useRef(false);
  useEffect(() => {
    if (step !== "dna" || !analysisData?.color_palette || hasInitializedColors.current) return;
    hasInitializedColors.current = true;
    const cp = analysisData.color_palette;
    const arr = Array.isArray(cp)
      ? (cp as string[]).filter((c) => typeof c === "string" && (c as string).startsWith("#"))
      : cp && typeof cp === "object"
        ? [cp.primary, cp.secondary, cp.accent].filter((c): c is string => typeof c === "string")
        : [];
    if (arr.length > 0) setEditedColors(arr);
  }, [step, analysisData]);

  // Initialize font from analysis detected_font (guest flow - font is auto-detected, not user-selectable)
  const hasInitializedFont = useRef(false);
  useEffect(() => {
    if (step !== "dna" || !analysisData || hasInitializedFont.current) return;
    hasInitializedFont.current = true;
    const detected = analysisData.detected_font;
    if (typeof detected === "string" && detected) setEditedFont(detected);
  }, [step, analysisData]);

  // When returning from Google with ?step=input&website=..., auto-submit website and start analysis so user lands on DNA
  const hasAutoStartedWithWebsite = useRef(false);
  useEffect(() => {
    if (step !== "input" || !websiteParamFromUrl?.trim() || hasAutoStartedWithWebsite.current) return;
    if (!isValidWebsiteUrl(websiteParamFromUrl)) return;
    hasAutoStartedWithWebsite.current = true;
    const normalized = normalizeUrl(websiteParamFromUrl.trim());
    setWebsiteUrl(normalized);
    localStorage.setItem("dvyb_pending_website_url", normalized);
    setStep("analyzing");
  }, [step, websiteParamFromUrl]);

  // Redirect logged-in users to discover (except when returning from OAuth with content generation modal)
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const isOAuthReturnWithContentModal = searchParams.get("openModal") === "contentGeneration";
      if (isOAuthReturnWithContentModal) return;
      const hasJob = !!localStorage.getItem("dvyb_onboarding_generation_job_id") || !!onboardingJobId;
      if (!hasJob) router.replace("/discover");
    }
  }, [isAuthenticated, isLoading, router, onboardingJobId, searchParams]);

  // OAuth return: open GenerateContentDialog
  useEffect(() => {
    const storedJobId = localStorage.getItem("dvyb_onboarding_generation_job_id");
    if (storedJobId) {
      setOnboardingJobId(storedJobId);
      completeStep("auto_content_viewed");
      setTimeout(() => {
        setShowGenerateDialog(true);
        localStorage.removeItem("dvyb_onboarding_generation_job_id");
      }, 800);
    }
  }, [completeStep]);

  const handleInputContinue = useCallback(
    async (data: { url?: string; file?: File }) => {
      const url = data.url?.trim();
      const hasValidUrl = !!url && isValidWebsiteUrl(url);
      const hasFile = !!data.file;

      if (hasValidUrl) {
        const normalized = normalizeUrl(url);
        setWebsiteUrl(normalized);
        localStorage.setItem("dvyb_pending_website_url", normalized);
        setStep("analyzing");
        return;
      }

      if (hasFile && !hasValidUrl) {
        setIsProductUploading(true);
        try {
          const result = await contextApi.uploadDomainProductImage(data.file!, "onboarding");
          localStorage.setItem("dvyb_selected_products", JSON.stringify([result]));
          setSelectedProduct(result);
          setStep("inspirations");
        } catch (err) {
          toast({ title: "Upload failed", description: "Could not upload image.", variant: "destructive" });
        } finally {
          setIsProductUploading(false);
        }
        return;
      }

      toast({ title: "Invalid URL", description: "Please enter a valid website URL or upload a product photo.", variant: "destructive" });
    },
    [toast]
  );

  const runAnalysis = useCallback(async () => {
    const url = websiteUrl;
    if (!url) return;
    const normalized = normalizeUrl(url);
    analysisStartTimeRef.current = Date.now();
    trackWebsiteAnalysisStarted(normalized, { copy: "A" });
    try {
      const [analysisRes, screenshotRes] = await Promise.all([
        contextApi.analyzeWebsiteGuest(normalized),
        contextApi.captureWebsiteScreenshot(normalized).catch(() => ({ success: false, data: null })),
      ]);
      if (analysisRes.success && analysisRes.data) {
        localStorage.setItem("dvyb_website_analysis", JSON.stringify(analysisRes.data));
        trackWebsiteAnalysisCompleted(normalized, Date.now() - analysisStartTimeRef.current, { copy: "A" });
        setAnalysisData(analysisRes.data);
      } else {
        throw new Error("Website analysis failed");
      }
      if (screenshotRes.success && screenshotRes.data?.presignedUrl) {
        setWebsiteSnapshotUrl(screenshotRes.data.presignedUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not analyze your website.";
      toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
      setStep("input");
    }
  }, [websiteUrl, toast]);

  // Analyzing: run real analysis (CopyAAnalyzingScreen is mostly visual; we drive from here)
  // When analyzing step mounts, run real analysis in parent
  const [analysisDone, setAnalysisDone] = useState(false);
  useEffect(() => {
    if (step !== "analyzing" || !websiteUrl) return;
    setAnalysisDone(false);
    const run = async () => {
      const normalized = normalizeUrl(websiteUrl);
      analysisStartTimeRef.current = Date.now();
      trackWebsiteAnalysisStarted(normalized, { copy: "A" });
      try {
        // Capture screenshot first so it can be shown while analysis runs
        const screenshotRes = await contextApi.captureWebsiteScreenshot(normalized).catch(() => ({ success: false, data: null }));
        if (screenshotRes.success && screenshotRes.data?.presignedUrl) {
          setWebsiteSnapshotUrl(screenshotRes.data.presignedUrl);
        }
        // Run analysis (snapshot may already be visible while this runs)
        const analysisRes = await contextApi.analyzeWebsiteGuest(normalized);
        if (analysisRes.success && analysisRes.data) {
          localStorage.setItem("dvyb_website_analysis", JSON.stringify(analysisRes.data));
          trackWebsiteAnalysisCompleted(normalized, Date.now() - analysisStartTimeRef.current, { copy: "A" });
          setAnalysisData(analysisRes.data);
          setAnalysisDone(true);
        } else {
          throw new Error("Website analysis failed");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not analyze your website.";
        toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
        setStep("input");
      }
    };
    run();
  }, [step, websiteUrl, toast]);

  const handleAnalyzingScreenDone = useCallback(() => {
    if (analysisDone) setStep("dna");
  }, [analysisDone]);

  // Poll domain products when on dna step
  const domain = extractDomain(websiteUrl);
  useEffect(() => {
    if (step !== "dna" || !domain) return;
    let cancelled = false;
    let pollCount = 0;
    const maxPolls = 15;
    const poll = async () => {
      if (cancelled || pollCount >= maxPolls) return;
      try {
        const res = await contextApi.getDomainProductImages(domain);
        if (cancelled) return;
        if (res.success && res.data?.images?.length) {
          setDomainProducts(res.data.images);
        }
        pollCount += 1;
        if (pollCount < maxPolls) setTimeout(poll, 3000);
      } catch {
        if (pollCount < maxPolls) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [step, domain]);

  const handleProductUpload = useCallback(
    async (file: File) => {
      if (!domain) return;
      setIsProductUploading(true);
      try {
        const result = await contextApi.uploadDomainProductImage(file, domain);
        setDomainProducts((prev) => [...prev, result]);
        setSelectedProduct(result);
      } catch (err) {
        toast({ title: "Upload failed", description: "Could not upload image.", variant: "destructive" });
      } finally {
        setIsProductUploading(false);
      }
    },
    [domain, toast]
  );

  const handleDnaContinue = useCallback(() => {
    if (selectedProduct) {
      localStorage.setItem("dvyb_selected_products", JSON.stringify([selectedProduct]));
    } else {
      localStorage.removeItem("dvyb_selected_products");
    }
    const stored = localStorage.getItem("dvyb_website_analysis");
    if (stored && (editedColors.length > 0 || editedFont !== "Inter")) {
      try {
        const data = JSON.parse(stored) as Record<string, unknown>;
        if (editedColors.length > 0) data.color_palette = editedColors;
        if (editedFont) data.edited_font = editedFont;
        localStorage.setItem("dvyb_website_analysis", JSON.stringify(data));
      } catch {
        /* ignore */
      }
    }
    setStep("inspirations");
  }, [selectedProduct, editedColors, editedFont]);

  const handleInspirationsContinue = useCallback(async () => {
    if (isAuthenticated) {
      // Already logged in (login-first flow): start generation and open dialog
      try {
        const storedAnalysis = localStorage.getItem("dvyb_website_analysis");
        const storedUrl = localStorage.getItem("dvyb_pending_website_url");
        if (storedAnalysis && storedUrl) {
          try {
            const analysisData = JSON.parse(storedAnalysis) as Record<string, unknown>;
            await contextApi.updateContext({
              website: storedUrl,
              accountName: (analysisData.base_name as string) || undefined,
              industry: (analysisData.industry as string) || null,
              suggestedFirstTopic: (analysisData.suggested_first_topic as { title?: string; description?: string } | null) || null,
              businessOverview: (analysisData.business_overview_and_positioning as string) || undefined,
              customerDemographics: (analysisData.customer_demographics_and_psychographics as string) || undefined,
              popularProducts: analysisData.most_popular_products_and_services as string[] | undefined,
              whyCustomersChoose: undefined,
              brandStory: (analysisData.brand_story as string) || undefined,
              colorPalette: analysisData.color_palette as unknown,
              logoUrl: (analysisData.logo_s3_key as string) || null,
            });
          } catch {
            /* ignore */
          }
        }
        let productImageS3Key: string | undefined;
        const selectedProductsStr = localStorage.getItem("dvyb_selected_products");
        if (selectedProductsStr) {
          try {
            const products = JSON.parse(selectedProductsStr) as Array<{ s3Key?: string; image?: string }>;
            const first = Array.isArray(products) ? products[0] : null;
            if (first?.s3Key) productImageS3Key = first.s3Key;
            else if (first?.image && typeof window !== "undefined") {
              const imagePath = first.image.startsWith("/") ? first.image : `/${first.image}`;
              const imageUrl = `${window.location.origin}${imagePath}`;
              const res = await fetch(imageUrl);
              const blob = await res.blob();
              const ext = imagePath.split(".").pop() || "jpg";
              const file = new File([blob], `product.${ext}`, { type: blob.type || "image/jpeg" });
              const s3Url = await adhocGenerationApi.uploadImage(file);
              productImageS3Key = adhocGenerationApi.extractS3Key(s3Url);
            }
          } catch {
            /* ignore */
          }
        }
        let inspirationLinks: string[] = [];
        const storedInspirations = localStorage.getItem("dvyb_selected_inspirations");
        if (storedInspirations) {
          try {
            const inspirations = JSON.parse(storedInspirations) as Array<{ mediaUrl?: string; url?: string; creativeImageUrl?: string; creativeVideoUrl?: string }>;
            if (Array.isArray(inspirations) && inspirations.length > 0) {
              inspirationLinks = inspirations.flatMap((insp) =>
                [insp.mediaUrl, insp.url, insp.creativeImageUrl, insp.creativeVideoUrl].filter(Boolean) as string[]
              );
            }
          } catch {
            /* ignore */
          }
        }
        const hasProductImage = !!productImageS3Key;
        let contentTopic = "Product Launch";
        let topicDescription = "Generate Product marketing post for this product";
        if (hasProductImage) {
          contentTopic = "Product Showcase";
          topicDescription = "";
        } else if (storedAnalysis) {
          try {
            const analysisData = JSON.parse(storedAnalysis) as { suggested_first_topic?: { title?: string; description?: string } };
            if (analysisData.suggested_first_topic?.title) {
              contentTopic = analysisData.suggested_first_topic.title;
              topicDescription = analysisData.suggested_first_topic.description || topicDescription;
            }
          } catch {
            /* ignore */
          }
        }
        const genResponse = await adhocGenerationApi.generateContent({
          topic: contentTopic,
          platforms: ["instagram"],
          number_of_posts: 2,
          number_of_images: 2,
          number_of_videos: 0,
          user_prompt: topicDescription || undefined,
          user_images: hasProductImage && productImageS3Key ? [productImageS3Key] : undefined,
          inspiration_links: inspirationLinks.length > 0 ? inspirationLinks : undefined,
          is_onboarding_product_image: hasProductImage,
          force_product_marketing: hasProductImage,
        });
        if (genResponse.success && (genResponse.job_id || genResponse.uuid)) {
          const jobId = genResponse.job_id || genResponse.uuid;
          setOnboardingJobId(jobId);
          setShowGenerateDialog(true);
        }
        localStorage.removeItem("dvyb_selected_inspirations");
        localStorage.removeItem("dvyb_selected_products");
      } catch (err) {
        console.error("Copy A onboarding generation error:", err);
        toast({ title: "Something went wrong", description: "Could not start content generation.", variant: "destructive" });
      }
      return;
    }
    setStep("signup");
  }, [isAuthenticated, toast]);

  const heroBgDark =
    "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

  const handleGetStartedCopyA = useCallback(async () => {
    const websiteParam = searchParams.get("website");
    const returnBase = "/?copy=a&step=input";
    const returnUrl = websiteParam ? `${returnBase}&website=${encodeURIComponent(websiteParam)}` : returnBase;

    if (isAuthenticated) {
      if (websiteParam?.trim() && isValidWebsiteUrl(websiteParam)) {
        const normalized = normalizeUrl(websiteParam.trim());
        setWebsiteUrl(normalized);
        localStorage.setItem("dvyb_pending_website_url", normalized);
        setStep("analyzing");
      } else {
        setStep("input");
      }
      return;
    }
    try {
      localStorage.removeItem("dvyb_google_oauth_state");
      localStorage.setItem("dvyb_oauth_return_url", returnUrl);
      localStorage.setItem("dvyb_oauth_platform", "google");
      const response = await authApi.getGoogleLoginUrl({ signInOnly: false });
      if (response.success && response.data?.oauth_url) {
        if (response.data.state) localStorage.setItem("dvyb_google_oauth_state", response.data.state);
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err) {
      console.error("Copy A get started login error:", err);
      toast({ title: "Sign-in failed", description: "Could not start sign-in.", variant: "destructive" });
    }
  }, [isAuthenticated, toast, searchParams]);

  return (
    <div className={cn("min-h-screen overflow-x-hidden font-hind", isDarkTheme ? "bg-[hsl(240_10%_4%)]" : "bg-background")}>
      <NavigationLanding variant={isDarkTheme ? "dark" : "default"} hideExplore hidePricing showThemeToggle navStyle="wander" onGetStarted={handleGetStartedCopyA} />
      <main>
        <AnimatePresence mode="wait">
          {step === "hero" && (
            <motion.div
              key="hero"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative min-h-screen overflow-hidden"
              style={{
                background: isDarkTheme
                  ? "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(240 10% 12%) 0%, hsl(240 10% 4%) 60%), radial-gradient(ellipse 60% 50% at 80% 80%, hsl(25 100% 55% / 0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 20% 90%, hsl(240 15% 10%) 0%, transparent 60%), hsl(240 10% 4%)"
                  : "transparent",
              }}
            >
              {/* Solid overlay during stack */}
              {phase === "stack" && (
                <div className="fixed inset-0 z-40 bg-background" style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
              )}
              {/* Fading overlay during burst */}
              {phase === "burst" && (
                <motion.div
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.7 }}
                  className="fixed inset-0 z-40 bg-background pointer-events-none"
                />
              )}
              {/* Stacking + bursting images */}
              {phase !== "done" && (
                <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
                  {ALL_ITEMS.slice(0, stackCount).map((item, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.3, y: 80 }}
                      animate={
                        phase === "burst"
                          ? {
                              x: burstTargets[i].x,
                              y: burstTargets[i].y,
                              rotate: burstTargets[i].rotate,
                              opacity: 0,
                              scale: 0.85,
                            }
                          : {
                              opacity: 1,
                              scale: 1,
                              y: 0,
                              rotate: (i - ALL_ITEMS.length / 2) * 2.5,
                            }
                      }
                      transition={
                        phase === "burst"
                          ? { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.015 }
                          : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
                      }
                      className="absolute w-20 h-28 md:w-28 md:h-40 rounded-lg overflow-hidden shadow-2xl border border-white/10"
                      style={{ zIndex: i }}
                    >
                      <MediaTile item={item} className="w-full h-full object-cover" />
                    </motion.div>
                  ))}
                </div>
              )}
              {/* Scroll strips — fade in during burst */}
              {phase !== "stack" && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isDarkTheme ? 0.5 : 1 }}
                    transition={{ duration: 0.8 }}
                    className="absolute top-20 left-0 right-0 z-0 md:hidden"
                  >
                    <ScrollStripH items={LEFT_ITEMS} duration={30} direction="left" />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isDarkTheme ? 0.5 : 1 }}
                    transition={{ duration: 0.8 }}
                    className="absolute bottom-0 left-0 right-0 z-0 md:hidden"
                  >
                    <ScrollStripH items={RIGHT_ITEMS} duration={26} direction="right" />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isDarkTheme ? 0.5 : 1 }}
                    transition={{ duration: 0.8 }}
                    className="absolute left-8 top-0 bottom-0 z-0 hidden md:block"
                  >
                    <ScrollStripV items={LEFT_ITEMS} duration={120} direction="up" />
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: isDarkTheme ? 0.5 : 1 }}
                    transition={{ duration: 0.8 }}
                    className="absolute right-8 top-0 bottom-0 z-0 hidden md:block"
                  >
                    <ScrollStripV items={RIGHT_ITEMS} duration={104} direction="down" />
                  </motion.div>
                </>
              )}
              {/* Hero text + button */}
              {phase !== "stack" && (
                <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center pt-32 sm:pt-36 pb-16">
                  <div className="flex flex-col items-center max-w-4xl">
                    {/* Mobile: "AI photoshoots that convert" / "window shoppers to clients" */}
                    <div className="flex flex-col items-center md:hidden">
                      {["AI photoshoots that convert", "window shoppers to clients"].map((line, lineIdx) => (
                        <div key={lineIdx} className="flex flex-nowrap justify-center gap-x-4 whitespace-nowrap">
                          {line.split(" ").map((word, i) => {
                            const globalIdx = lineIdx === 0 ? i : i + 5;
                            return (
                              <motion.span
                                key={`m-${globalIdx}`}
                                initial={hasPlayed ? false : { opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={
                                  hasPlayed
                                    ? { duration: 0 }
                                    : { duration: 0.5, delay: 1.3 + globalIdx * 0.12, ease: [0.16, 1, 0.3, 1] }
                                }
                                className="text-[2.1rem] font-agdasima font-medium tracking-tight text-foreground"
                              >
                                {word}
                              </motion.span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    {/* Desktop: "AI photoshoots that convert" / "window shoppers to clients" */}
                    <div className="hidden md:flex flex-col items-center">
                      {["AI photoshoots that convert", "window shoppers to clients"].map((line, lineIdx) => (
                        <div key={lineIdx} className="flex flex-nowrap justify-center gap-x-4 whitespace-nowrap">
                          {line.split(" ").map((word, i) => {
                            const globalIdx = lineIdx === 0 ? i : i + 5;
                            return (
                              <motion.span
                                key={`d-${globalIdx}`}
                                initial={hasPlayed ? false : { opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={
                                  hasPlayed
                                    ? { duration: 0 }
                                    : { duration: 0.5, delay: 1.3 + globalIdx * 0.12, ease: [0.16, 1, 0.3, 1] }
                                }
                                className="text-[4rem] lg:text-[5.2rem] font-agdasima font-medium tracking-tight text-foreground"
                              >
                                {word}
                              </motion.span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <motion.p
                    initial={hasPlayed ? false : { opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={hasPlayed ? { duration: 0 } : { duration: 0.5, delay: 1.9, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-6 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto px-2"
                  >
                    Our AI identifies million $ photoshoots from large brands and recreates them for you. Better, cheaper and no migraines.
                  </motion.p>
                  <motion.button
                    initial={hasPlayed ? false : { opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={hasPlayed ? { duration: 0 } : { duration: 0.6, delay: 2.3, ease: [0.16, 1, 0.3, 1] }}
                    onClick={handleGetStartedCopyA}
                    className="mt-8 px-10 py-4 bg-cta text-cta-foreground rounded-full text-xl font-display font-semibold hover:scale-105 transition-all duration-300"
                    style={{ boxShadow: "0 0 30px -5px hsl(25 100% 55% / 0.5)" }}
                  >
                    Absolutely Free
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}

          {step === "welcome" && (
            <CopyAWelcomeScreen key="welcome" onStart={() => setStep("input")} isDarkTheme={isDarkTheme} />
          )}

          {step === "input" && (
            <CopyAWebsiteInputScreen key="input" onContinue={handleInputContinue} onSkip={() => router.push("/discover")} isDarkTheme={isDarkTheme} isUploading={isProductUploading} />
          )}

          {step === "analyzing" && (
            <CopyAAnalyzingScreen
              key="analyzing"
              url={websiteUrl}
              onDone={handleAnalyzingScreenDone}
              analysisDone={analysisDone}
              isDarkTheme={isDarkTheme}
              websiteSnapshotUrl={websiteSnapshotUrl}
            />
          )}

          {step === "dna" && analysisData && (
            <CopyABusinessDnaScreen
              isDarkTheme={isDarkTheme}
              key="dna"
              url={websiteUrl}
              analysisData={analysisData}
              websiteSnapshotUrl={websiteSnapshotUrl}
              domainProducts={domainProducts}
              onProductSelect={setSelectedProduct}
              selectedProduct={selectedProduct}
              onProductUpload={handleProductUpload}
              isProductUploading={isProductUploading}
              editedColors={editedColors}
              onColorsChange={setEditedColors}
              editedFont={editedFont}
              onFontChange={setEditedFont}
              onContinue={handleDnaContinue}
            />
          )}

          {step === "inspirations" && (
            <CopyAInspirationSelectScreen key="inspirations" onContinue={handleInspirationsContinue} onSkip={() => router.push("/discover")} isDarkTheme={isDarkTheme} />
          )}

          {step === "signup" && (
            <CopyASignUpScreen key="signup" onContinue={() => {}} isDarkTheme={isDarkTheme} />
          )}
        </AnimatePresence>
      </main>

      <NotRegisteredModal
        open={showNotRegisteredModal}
        onOpenChange={setShowNotRegisteredModal}
        onGetStarted={() => setStep("welcome")}
      />
      <GenerateContentDialog
        open={showGenerateDialog}
        onOpenChange={(open) => {
          setShowGenerateDialog(open);
          if (!open) {
            trackOnboardingFlowCompleted("A");
            router.push("/discover?from_onboarding=1");
          }
        }}
        initialJobId={onboardingJobId}
        parentPage="home"
        landingStyle
        isDarkTheme={isDarkTheme}
        onboardingCopy="A"
        expectedImageCount={2}
        onDialogClosed={() => {
          trackOnboardingFlowCompleted("A");
          router.push("/discover?from_onboarding=1");
        }}
      />
    </div>
  );
}
