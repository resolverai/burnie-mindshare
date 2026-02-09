"use client";

import { useState, useEffect } from "react";
import {
  Download,
  Clock,
  Calendar,
  Globe,
  Languages,
  Building2,
  ExternalLink,
  Infinity,
  Wand2,
  Bookmark,
  BookmarkCheck,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { brandsApi } from "@/lib/api";
import type { PreselectedInspiration } from "./CreateAdFlowModal";

export interface DiscoverCard {
  id: number;
  image: string | null;
  videoSrc?: string | null;
  isVideo: boolean;
  timeAgo: string;
  brandLetter: string;
  brandName: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  status?: string;
  firstSeen?: string | null;
  targetLanguage?: string;
  targetCountries?: string[] | null;
  targetGender?: string | null;
  targetAges?: string[] | null;
  adCopy?: Record<string, unknown> | null;
  landingPage?: string | null;
  adSnapshotUrl?: string | null;
  platform?: string;
  category?: string | null;
}

interface AdDetailModalProps {
  card: DiscoverCard | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called when "Create ad using template" is clicked. Pass inspiration to skip the ad selection step. */
  onCreateAd?: (inspiration?: PreselectedInspiration) => void;
  /** If false, show pricing modal instead of allowing download. */
  hasActiveSubscription?: boolean;
  /** Called when user tries to download without subscription. */
  onShowPricingModal?: () => void;
}

export function AdDetailModal({ card, isOpen, onClose, onCreateAd, hasActiveSubscription = true, onShowPricingModal }: AdDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "ads">("overview");
  const [downloading, setDownloading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [freshUrls, setFreshUrls] = useState<{
    image: string | null;
    videoSrc: string | null;
    isSaved?: boolean;
  } | null>(null);

  // Fetch fresh presigned URLs and saved status when modal opens
  useEffect(() => {
    if (!isOpen || !card) {
      setFreshUrls(null);
      return;
    }
    let cancelled = false;
    brandsApi
      .getAdCreativeUrls(card.id)
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;
        const img = res.data.creativeImageUrl ?? null;
        const vid = res.data.creativeVideoUrl ?? null;
        setFreshUrls({ image: img, videoSrc: vid, isSaved: res.data.isSaved });
      })
      .catch(() => {
        if (!cancelled) setFreshUrls(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, card?.id]);

  const isSaved = freshUrls?.isSaved ?? false;

  const handleSaveToggle = async () => {
    if (!card || saveLoading) return;
    try {
      setSaveLoading(true);
      if (isSaved) {
        await brandsApi.unsaveAd(card.id);
        setFreshUrls((prev) => (prev ? { ...prev, isSaved: false } : null));
      } else {
        await brandsApi.saveAd(card.id);
        setFreshUrls((prev) => (prev ? { ...prev, isSaved: true } : null));
      }
    } catch (err) {
      console.error("Failed to save/unsave ad:", err);
    } finally {
      setSaveLoading(false);
    }
  };

  if (!card) return null;

  const displayImage = freshUrls?.image ?? card.image;
  const displayVideoSrc = freshUrls?.videoSrc ?? card.videoSrc;

  const handleDownload = async () => {
    if (hasActiveSubscription !== true && onShowPricingModal) {
      onShowPricingModal();
      return;
    }
    const url = card.isVideo ? displayVideoSrc : displayImage;
    if (!url) return;
    setDownloading(true);
    try {
      const res = await fetch(url, { mode: "cors" });
      const blob = await res.blob();
      const ext = card.isVideo ? ".mp4" : (url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || "jpg");
      const brandSlug = (card.brandName || "ad").replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_") || "ad";
      const filename = `${brandSlug}_ad_${card.id}${ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Download failed:", err);
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  const handleCreateFromTemplate = () => {
    const inspiration: PreselectedInspiration = {
      imageUrl: displayImage ?? null,
      videoUrl: displayVideoSrc ?? null,
      isVideo: card.isVideo,
    };
    onClose();
    onCreateAd?.(inspiration);
  };

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="h-[90vh] border-t border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--app-content-bg))] flex flex-col">
        <DrawerHeader className="sr-only">
          <DrawerTitle>Ad Details</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col lg:flex-row gap-6 p-6 overflow-auto flex-1 min-h-0">
          {/* Left side - Creative Preview */}
          <div className="lg:w-1/2 flex flex-col">
            <div className="relative max-w-md w-full mx-auto">
              {displayVideoSrc ? (
                <video
                  src={displayVideoSrc}
                  className="w-full rounded-xl"
                  controls
                  poster={displayImage || undefined}
                />
              ) : displayImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={displayImage}
                  alt={card.brandName}
                  className="w-full rounded-xl"
                />
              ) : (
                <div className="w-full aspect-square rounded-xl bg-muted flex items-center justify-center">
                  <span className="text-muted-foreground">No preview</span>
                </div>
              )}
            </div>
            {/* Action buttons below media - mobile only */}
            <div className="flex items-center justify-center gap-2 mt-4 max-w-md w-full mx-auto lg:hidden">
              <Button
                onClick={handleCreateFromTemplate}
                className="flex-1 gap-2 bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90"
                size="sm"
              >
                <Wand2 className="w-4 h-4" />
                Create ad using template
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={`h-10 w-10 shrink-0 ${isSaved ? "bg-[#e88d44] text-white border-[#e88d44]" : ""}`}
                onClick={handleSaveToggle}
                disabled={saveLoading}
              >
                {saveLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isSaved ? (
                  <BookmarkCheck className="w-4 h-4 fill-current" />
                ) : (
                  <Bookmark className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Right side - Details */}
          <div className="lg:w-1/2">
            {/* Action buttons - desktop only */}
            <div className="hidden lg:flex items-center gap-2 mb-6">
              <Button
                onClick={handleCreateFromTemplate}
                className="flex-1 gap-2 bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90"
              >
                <Wand2 className="w-4 h-4" />
                Create ad using template
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={`h-10 w-10 shrink-0 ${isSaved ? "bg-[#e88d44] text-white border-[#e88d44]" : ""}`}
                onClick={handleSaveToggle}
                disabled={saveLoading}
              >
                {saveLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isSaved ? (
                  <BookmarkCheck className="w-4 h-4 fill-current" />
                ) : (
                  <Bookmark className="w-4 h-4" />
                )}
              </Button>
            </div>

            {/* Tabs */}
            <div className="flex items-center bg-secondary rounded-full p-1 mb-6">
              <button
                onClick={() => setActiveTab("overview")}
                className={`flex-1 px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                  activeTab === "overview"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab("ads")}
                className={`flex-1 px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  activeTab === "ads"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Infinity className="w-4 h-4" />
                Ad copy
              </button>
            </div>

            {activeTab === "overview" ? (
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold mb-4">Creative details</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        (card.status || "active").toLowerCase() === "active" ? "bg-green-500" : "bg-amber-500"
                      }`} />
                      <span className="capitalize">{card.status || "Active"}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Runtime</span>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span>{card.timeAgo || "—"}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">First seen</span>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>{card.firstSeen || "—"}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Target language</span>
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4 text-muted-foreground" />
                      <span>{card.targetLanguage || "—"}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Target country</span>
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span>{card.targetCountries?.length ? card.targetCountries.join(", ") : "—"}</span>
                    </div>
                  </div>
                  {card.targetGender && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Target gender</span>
                      <span className="capitalize">{card.targetGender}</span>
                    </div>
                  )}
                  {card.targetAges && card.targetAges.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Target age ranges</span>
                      <span>
                        {card.targetAges.length === 2 &&
                        /^\d+$/.test(card.targetAges[0] ?? "") &&
                        /^\d+$/.test(card.targetAges[1] ?? "")
                          ? `${card.targetAges[0]}-${card.targetAges[1]}`
                          : card.targetAges.join(", ")}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Brand</span>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <span>{card.brandName}</span>
                    </div>
                  </div>
                  {card.adSnapshotUrl && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">View on {card.platform === "instagram" ? "Instagram" : card.platform === "facebook" ? "Facebook" : "Meta"}</span>
                      <a
                        href={card.adSnapshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-primary hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span className="truncate max-w-[200px]">Open</span>
                      </a>
                    </div>
                  )}
                  {card.landingPage && (() => {
                    let raw = card.landingPage.trim();
                    const baseUrl = typeof window !== "undefined"
                      ? window.location.origin
                      : (process.env.NEXT_PUBLIC_FRONTEND_URL || "");
                    if (baseUrl && raw.startsWith(baseUrl)) {
                      raw = raw.slice(baseUrl.length).replace(/^\//, "") || raw;
                    }
                    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                    const displayText = raw.replace(/^https?:\/\//i, "");
                    const display = displayText.slice(0, 60) + (displayText.length > 60 ? "…" : "");
                    return (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Landing page</span>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span className="truncate max-w-[200px]">{display}</span>
                        </a>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-semibold mb-4">Ad copy</h3>
                <div className="space-y-4">
                  <div className="border border-border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full text-xs font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        {card.timeAgo || "—"}
                      </span>
                      <span className="px-2 py-1 bg-secondary rounded-full text-xs">{card.targetLanguage || "—"}</span>
                      <span className="px-2 py-1 bg-secondary rounded-full text-xs flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {card.targetCountries?.length ? card.targetCountries.join(", ") : "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">AD COPY</div>
                    {card.adCopy && (card.adCopy.bodies || card.adCopy.captions || card.adCopy.titles || card.adCopy.descriptions) ? (
                      <>
                        {(Array.isArray(card.adCopy.bodies) ? card.adCopy.bodies : Array.isArray(card.adCopy.captions) ? card.adCopy.captions : []).slice(0, 3).map((t, i) => (
                          <p key={i} className="text-sm mb-2">{String(t)}</p>
                        ))}
                        {(Array.isArray(card.adCopy.titles) ? card.adCopy.titles : []).slice(0, 2).map((t, i) => (
                          <p key={`t-${i}`} className="text-sm font-medium mb-1">{String(t)}</p>
                        ))}
                        {(Array.isArray(card.adCopy.descriptions) ? card.adCopy.descriptions : []).slice(0, 2).map((t, i) => (
                          <p key={`d-${i}`} className="text-sm text-muted-foreground mb-1">{String(t)}</p>
                        ))}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No ad copy available</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleDownload}
                disabled={downloading || (!displayImage && !displayVideoSrc)}
              >
                {downloading ? (
                  <span className="animate-pulse">Downloading...</span>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download
                  </>
                )}
              </Button>
            </div>
            <DrawerClose asChild>
              <button
                className="w-full mt-4 text-muted-foreground text-sm hover:text-foreground transition-colors"
              >
                Close
              </button>
            </DrawerClose>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
