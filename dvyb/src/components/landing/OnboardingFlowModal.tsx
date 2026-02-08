"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, Check, ArrowRight, Loader2, Upload } from "lucide-react";
import { brandsApi, authApi, contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackInspirationPageViewed, trackInspirationSelected, trackSignInClicked } from "@/lib/mixpanel";

type Step = "inspiration" | "product" | "login";

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

interface OnboardingFlowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingFlowModal({ open, onOpenChange }: OnboardingFlowModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("product");

  // Inspiration state (discover ads from dvyb_brand_ads)
  const [discoverAds, setDiscoverAds] = useState<DiscoverAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [selectedAdIds, setSelectedAdIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const hasFetchedAds = useRef(false);

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
    setStep("product");
    setDomainProductsLoading(true);
    setDomainProducts([]);
    setDomainProductsDone(false);
  }, [open]);

  useEffect(() => {
    if (!open || step !== "inspiration") return;
    const load = async () => {
      if (hasFetchedAds.current) return;
      hasFetchedAds.current = true;
      setAdsLoading(true);
      try {
        let websiteCategory: string | undefined;
        let brandContext: { business_overview?: string | null; popular_products?: string[] | null; customer_demographics?: string | null; brand_story?: string | null } | undefined;
        try {
          const analysisStr = localStorage.getItem("dvyb_website_analysis");
          if (analysisStr) {
            const analysis = JSON.parse(analysisStr) as {
              industry?: string;
              business_overview_and_positioning?: string;
              most_popular_products_and_services?: string | string[];
              customer_demographics_and_psychographics?: string;
              brand_story?: string;
            };
            websiteCategory = analysis?.industry?.trim() || undefined;
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
        const response = await brandsApi.getDiscoverAdsOnboarding({
          page: 1,
          limit: 24,
          sort: "latest",
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
      selected.forEach((ad) =>
        trackInspirationSelected({ inspirationId: ad.id, platform: "discover", category: ad.category || "" })
      );
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(selected));
    }
    setStep("login");
  };

  const handleProductNext = () => {
    const selected = domainProducts.filter((p) => selectedProductIds.has(p.id));
    if (selected.length > 0) {
      localStorage.setItem(
        "dvyb_selected_products",
        JSON.stringify(selected.map((p) => ({ id: p.id, s3Key: p.s3Key, image: p.image })))
      );
    }
    setStep("inspiration");
  };

  const handleProductToggle = (id: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
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
        setDomainProducts((prev) => [...prev, result]);
        setSelectedProductIds((prev) => new Set([...prev, result.id]));
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

  // Fetch domain product images when entering product step - poll every 3s until we have 10 images or max polls
  const MAX_FETCH_IMAGES = 10;
  const DISPLAY_IMAGES_COUNT = 4; // Show 4 random from fetched
  const POLL_INTERVAL_MS = 3000;
  const MAX_POLLS = 40; // ~2 min total

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
          const images = res.data.images.slice(0, MAX_FETCH_IMAGES);
          setDomainProducts(images);
          setDomainProductsLoading(false);
          // Stop polling only when we have max images or hit max polls
          if (images.length >= MAX_FETCH_IMAGES || pollCount >= MAX_POLLS) {
            setDomainProductsDone(true);
            return;
          }
        }
      } catch {
        // ignore, continue polling
      }
      if (pollCount >= MAX_POLLS) {
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

  // Show 4 random images from fetched domain products (only re-pick when the set of ids changes)
  const productIdsKey = useMemo(
    () => domainProducts.map((p) => p.id).sort((a, b) => a - b).join(","),
    [domainProducts]
  );
  const displayProducts = useMemo(() => {
    if (domainProducts.length === 0) return [];
    // Show all when we have few; when many from fetch, show random subset
    if (domainProducts.length <= 6) return domainProducts;
    const shuffled = [...domainProducts].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
    // Only re-pick when productIdsKey changes (avoids re-shuffling on every poll with same data)
  }, [productIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleGoogleLogin = async () => {
    if (isConnecting) return;
    trackSignInClicked("google", "onboarding_modal");
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

  const handleInteractOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-floating-bar]")) {
      e.preventDefault();
    }
  };

  const modalShellClass =
    "max-w-[90vw] w-full h-[min(90vh,720px)] min-h-[min(90vh,720px)] max-h-[90vh] flex flex-col p-0 gap-0 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl overflow-hidden";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={modalShellClass} onInteractOutside={handleInteractOutside}>
        {/* Step 1: Product */}
        {step === "product" && (
          <>
            <div className="px-6 py-6 border-b border-border shrink-0">
              <h2 className="text-2xl md:text-3xl font-bold mb-2 text-center text-neutral-900">
                Select your product photos
              </h2>
              <p className="text-muted-foreground text-center mb-2">Choose 1–3 products. We&apos;ll handle the rest.</p>
              <p className="text-xs text-muted-foreground text-center">
                You can regenerate with different products later.
              </p>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto p-6 ${selectedProductIds.size > 0 ? "pb-24" : "pb-4"}`}>
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
              ) : domainProducts.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {displayProducts.map((product) => {
                      const isSelected = selectedProductIds.has(product.id);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => handleProductToggle(product.id)}
                          className={`text-left rounded-xl overflow-hidden cursor-pointer group transition-all ${
                            isSelected ? "ring-4 ring-neutral-900 ring-offset-2" : "hover:shadow-lg"
                          }`}
                        >
                          <div className="aspect-square relative bg-neutral-200">
                            <img src={product.image} alt="Product" className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute top-3 right-3 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      );
                    })}
                    {/* Add another product (for users who uploaded and want more) */}
                    <button
                      type="button"
                      onClick={() => !isProductUploading && productFileInputRef.current?.click()}
                      disabled={isProductUploading || domainProducts.length >= 3}
                      className={`text-left rounded-xl overflow-hidden cursor-pointer border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-all aspect-square flex flex-col items-center justify-center gap-2 ${
                        isProductUploading || domainProducts.length >= 3 ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {isProductUploading ? (
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-muted-foreground" />
                          <span className="text-sm font-medium text-muted-foreground">
                            {domainProducts.length >= 3 ? "Max 3 products" : "Add another"}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`flex flex-col items-center justify-center flex-1 text-muted-foreground text-center cursor-pointer border-2 border-dashed border-border rounded-xl min-h-[280px] transition-colors ${
                    isProductDraggingOver ? "bg-primary/5 border-primary" : "hover:border-primary hover:bg-primary/5"
                  } ${isProductUploading ? "pointer-events-none opacity-70" : ""}`}
                  onDragOver={handleProductDragOver}
                  onDragLeave={handleProductDragLeave}
                  onDrop={handleProductDrop}
                  onClick={() => !isProductUploading && productFileInputRef.current?.click()}
                >
                  {isProductUploading ? (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <Loader2 className="w-10 h-10 animate-spin" />
                      <p>Uploading product image...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-8">
                      <Upload className="w-12 h-12 opacity-60" />
                      <p className="font-medium text-foreground">Drop a product image here</p>
                      <p className="text-sm">or click to browse</p>
                      <p className="text-xs mt-2">JPEG, PNG, or WebP. We&apos;ll use it for your ad creation.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: Inspiration */}
        {step === "inspiration" && (
          <>
            <div className="px-6 py-6 border-b border-border shrink-0">
              <h2 className="text-2xl md:text-3xl font-bold mb-2 text-center text-neutral-900">
                Customize your ad creation
              </h2>
              <p className="text-muted-foreground text-center mb-6">Select competitor ads for inspiration</p>
              <div className="max-w-md mx-auto">
                <div className="flex items-center gap-3 bg-neutral-100 rounded-full px-5 py-3 border border-neutral-200">
                  <Search className="w-5 h-5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search brands or keywords..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </div>
              </div>
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto p-6 ${selectedAdIds.size > 0 ? "pb-24" : "pb-4"}`}>
              {adsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-muted-foreground">Loading ads...</p>
                </div>
              ) : filteredAds.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">No ads match your search.</div>
              ) : (
                <div className="columns-[160px] md:columns-[180px] lg:columns-[200px] gap-4">
                  {filteredAds.map((ad) => {
                    const isSelected = selectedAdIds.has(ad.id);
                    const mediaUrl = ad.isVideo ? ad.videoSrc : ad.image;
                    return (
                      <button
                        key={ad.id}
                        type="button"
                        onClick={() => handleAdToggle(ad.id)}
                        className={`text-left rounded-xl overflow-hidden cursor-pointer transition-all border border-neutral-200 bg-white break-inside-avoid mb-4 w-full ${
                          isSelected ? "ring-4 ring-neutral-900 ring-offset-2" : "hover:shadow-lg hover:border-neutral-300"
                        }`}
                      >
                        <div className="relative bg-neutral-100">
                          {mediaUrl ? (
                            ad.isVideo ? (
                              <div className="w-full aspect-video bg-neutral-200">
                                <video
                                  src={mediaUrl}
                                  className="w-full h-full object-contain"
                                  muted
                                  playsInline
                                />
                              </div>
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={mediaUrl}
                                alt={ad.brandName}
                                className="w-full h-auto block"
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
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-8 min-h-0">
            <div className="max-w-md w-full text-center">
              <div className="w-16 h-16 bg-neutral-200 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold mb-2 text-neutral-900">Create your account</h2>
              <p className="text-muted-foreground mb-6">Save your brand and unlock your personalized ads</p>

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
              selectedAdIds.size > 0 ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="w-full max-w-[90vw] mb-6 bg-neutral-900 text-white rounded-2xl px-6 py-4 flex items-center justify-between shadow-2xl pointer-events-auto cursor-pointer">
              <p className="font-medium">
                {selectedAdIds.size} ad{selectedAdIds.size !== 1 ? "s" : ""} selected
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
