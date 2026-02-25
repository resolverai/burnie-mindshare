"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight, Search, Upload, Loader2 } from "lucide-react";
import { brandsApi, contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const ALLOWED_INSPIRATION_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

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

interface CopyAInspirationSelectScreenProps {
  onContinue: (selectedAds: DiscoverAd[]) => void;
  /** When user clicks Skip (no inspirations selected), call this to go e.g. to discover. */
  onSkip?: () => void;
  isDarkTheme?: boolean;
}

const COPY_A_BG_DARK =
  "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

export function CopyAInspirationSelectScreen({ onContinue, onSkip, isDarkTheme = true }: CopyAInspirationSelectScreenProps) {
  const [discoverAds, setDiscoverAds] = useState<DiscoverAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(true);
  const [selectedAdIds, setSelectedAdIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [customInspirationS3Url, setCustomInspirationS3Url] = useState<string | null>(null);
  const [isCustomInspirationUploading, setIsCustomInspirationUploading] = useState(false);
  const [isCustomInspirationDraggingOver, setIsCustomInspirationDraggingOver] = useState(false);
  const inspirationFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processCustomInspirationFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_INSPIRATION_IMAGE_TYPES.includes(file.type)) {
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

  const loadAds = useCallback(async () => {
    setAdsLoading(true);
    try {
      let websiteCategory: string | undefined;
      let brandContext: { business_overview?: string | null; popular_products?: string[] | null; customer_demographics?: string | null; brand_story?: string | null } | undefined;
      let productImageS3Key: string | undefined;

      const analysisStr = localStorage.getItem("dvyb_website_analysis");
      if (analysisStr) {
        const analysis = JSON.parse(analysisStr);
        websiteCategory = analysis?.industry?.trim();
        const pop = analysis?.most_popular_products_and_services;
        brandContext = {
          business_overview: analysis?.business_overview_and_positioning ?? null,
          popular_products: Array.isArray(pop) ? pop : typeof pop === "string" && pop ? [pop] : null,
          customer_demographics: analysis?.customer_demographics_and_psychographics ?? null,
          brand_story: analysis?.brand_story ?? null,
        };
      }

      const selectedStr = localStorage.getItem("dvyb_selected_products");
      if (selectedStr) {
        const selected = JSON.parse(selectedStr) as Array<{ id: number; s3Key: string; image?: string }>;
        if (Array.isArray(selected) && selected.length > 0 && selected[0]?.s3Key) {
          productImageS3Key = selected[0].s3Key;
        }
      }

      const response = await brandsApi.getDiscoverAdsOnboarding({
        page: 1,
        limit: 24,
        sort: "latest",
        ...(productImageS3Key && { productImageS3Key }),
        ...(websiteCategory && { websiteCategory }),
        ...(brandContext && { brandContext }),
      });

      if (response.success && response.data) {
        const ads = (response.data as Array<Record<string, unknown>>).map((ad) => ({
          id: ad.id as number,
          image: (ad.creativeImageUrl as string) ?? (ad.image as string) ?? null,
          videoSrc: (ad.creativeVideoUrl as string) ?? (ad.videoSrc as string) ?? null,
          isVideo: ad.mediaType === "video",
          brandName: (ad.brandName as string) || "Unknown",
          brandLetter: (ad.brandLetter as string) || "?",
          category: ad.category as string | null,
          creativeImageUrl: (ad.creativeImageUrl as string) ?? null,
          creativeVideoUrl: (ad.creativeVideoUrl as string) ?? null,
        }));
        setDiscoverAds(ads);
      }
    } catch (e) {
      console.error("Failed to load ads:", e);
      toast({ title: "Error", description: "Failed to load inspirations", variant: "destructive" });
    } finally {
      setAdsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const filteredAds = searchQuery.trim()
    ? discoverAds.filter(
        (ad) =>
          ad.brandName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ad.category?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : discoverAds;

  const handleToggle = (id: number) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleContinue = () => {
    const noSelection = selectedAdIds.size === 0 && !customInspirationS3Url;
    if (noSelection && onSkip) {
      onSkip();
      return;
    }
    if (customInspirationS3Url) {
      const customInspiration: DiscoverAd[] = [
        {
          id: -1,
          image: customInspirationS3Url,
          videoSrc: null,
          isVideo: false,
          brandName: "Your inspiration",
          brandLetter: "Y",
          category: null,
          creativeImageUrl: customInspirationS3Url,
          creativeVideoUrl: null,
        },
      ];
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(customInspiration));
      onContinue(customInspiration);
    } else {
      const selected = discoverAds.filter((ad) => selectedAdIds.has(ad.id));
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(selected));
      onContinue(selected);
    }
  };

  const hasSelection = selectedAdIds.size > 0 || (discoverAds.length === 0 && !!customInspirationS3Url);

  return (
    <div
      className="min-h-screen flex flex-col pt-24"
      style={{ background: isDarkTheme ? COPY_A_BG_DARK : "var(--gradient-hero)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={`sticky top-24 z-20 backdrop-blur-xl px-6 py-5 ${isDarkTheme ? "bg-black/20 border-b border-white/10" : "bg-background/80 border-b border-border"}`}
      >
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-display font-semibold text-foreground mb-1">
              Select Inspirations
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose styles that resonate with your brand. We&apos;ll use these to guide your creatives.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className={`flex-1 sm:flex-initial flex items-center gap-3 rounded-full px-4 py-2.5 ${isDarkTheme ? "bg-white/5 border border-white/10" : "bg-secondary border border-input"}`}>
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Search brands or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
              />
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleContinue}
              className="flex items-center gap-2 px-6 py-3 bg-cta text-cta-foreground rounded-full font-display font-semibold text-sm hover:brightness-110 transition-all shrink-0"
              style={{ boxShadow: "0 0 20px -5px hsl(25 100% 55% / 0.4)" }}
            >
              {hasSelection ? `Continue with ${selectedAdIds.size || (customInspirationS3Url ? 1 : 0)}` : "Skip"}
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </motion.div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {adsLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-6">
            <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground">Finding inspirations for you…</p>
          </div>
        ) : discoverAds.length === 0 ? (
          <div className="flex flex-col items-center py-8 sm:py-12 gap-6 max-w-md mx-auto">
            <input
              ref={inspirationFileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={handleCustomInspirationFileSelect}
            />
            {!customInspirationS3Url && (
              <>
                <p className="text-center text-muted-foreground font-medium">No matching ads found.</p>
                <p className="text-center text-sm text-muted-foreground">
                  You can skip this step and continue, or upload your own inspiration image below to get started.
                </p>
              </>
            )}
            {customInspirationS3Url ? (
              <div className="w-full">
                <div
                  className={`rounded-xl overflow-hidden border-2 transition-all ${
                    isDarkTheme ? "border-cta ring-2 ring-cta/30 bg-white/5" : "border-cta ring-2 ring-cta/30 bg-card"
                  }`}
                >
                  <div className="relative flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={customInspirationS3Url}
                      alt="Your inspiration"
                      className="w-full h-auto max-h-[320px] object-contain block"
                    />
                    <div
                      className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center ${
                        isDarkTheme ? "bg-cta" : "bg-cta"
                      }`}
                    >
                      <Check className="w-4 h-4 text-cta-foreground" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                      <p className="text-white text-xs font-medium">Your inspiration</p>
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
                className={`w-full flex flex-col items-center justify-center min-h-[200px] rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                  isCustomInspirationDraggingOver
                    ? "border-cta bg-cta/10"
                    : isDarkTheme
                      ? "border-white/20 hover:border-cta/50 hover:bg-cta/5"
                      : "border-border hover:border-cta/50 hover:bg-cta/5"
                } ${isCustomInspirationUploading ? "pointer-events-none opacity-70" : ""}`}
              >
                {isCustomInspirationUploading ? (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <Loader2 className="w-8 h-8 animate-spin text-cta" />
                    <span className="text-sm text-muted-foreground">Uploading...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
                    <Upload className="w-10 h-10 text-cta" />
                    <span className="text-sm font-medium text-foreground">Drag & drop your inspiration image</span>
                    <span className="text-xs text-muted-foreground">or click to browse · JPEG, PNG, or WebP</span>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleContinue}
              className="px-8 py-3 bg-cta text-cta-foreground rounded-full font-display font-semibold"
              style={{ boxShadow: "0 0 20px -5px hsl(25 100% 55% / 0.4)" }}
            >
              Continue
            </button>
          </div>
        ) : filteredAds.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">No ads match your search.</div>
        ) : (
          <div
            className={
              filteredAds.length >= 8
                ? "columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 space-y-3"
                : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto"
            }
          >
            {filteredAds.map((ad, i) => {
              const mediaUrl = ad.isVideo ? ad.videoSrc : ad.image;
              const isSelected = selectedAdIds.has(ad.id);
              const useMasonry = filteredAds.length >= 8;
              return (
                <motion.button
                  key={ad.id}
                  type="button"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.03 }}
                  onClick={() => handleToggle(ad.id)}
                  className={`relative break-inside-avoid w-full text-left rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                    useMasonry ? "" : ""
                  } ${isSelected ? "border-cta shadow-lg shadow-cta/20" : isDarkTheme ? "border-white/10 hover:border-white/20" : "border-transparent hover:border-border"}`}
                >
                  <div className="relative">
                    {mediaUrl ? (
                      ad.isVideo ? (
                        <div className="w-full aspect-video bg-muted flex items-center justify-center">
                          <video src={mediaUrl} className="w-full h-full object-contain max-h-[280px]" muted playsInline />
                        </div>
                      ) : (
                        <img
                          src={mediaUrl}
                          alt={ad.brandName}
                          className="w-full h-auto max-h-[320px] object-contain block"
                        />
                      )
                    ) : (
                      <div className="w-full aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">
                        No preview
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-cta flex items-center justify-center">
                        <Check className="w-4 h-4 text-cta-foreground" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                      <span className="text-xs font-medium text-white">
                        {ad.brandName} {ad.category ? `· ${ad.category}` : ""}
                      </span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
