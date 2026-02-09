"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Video, Loader2, UserPlus, ChevronDown, ArrowUpDown, Lock, ImageIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdDetailModal } from "./AdDetailModal";
import type { PreselectedInspiration } from "./CreateAdFlowModal";
import { brandsApi } from "@/lib/api";

const filterConfig: Record<string, string[]> = {
  Media: ["All", "Image", "Video"],
  Status: ["All", "Active", "Paused", "Draft"],
  Category: ["All", "Fashion", "Food & Beverage", "Tech", "Health", "Retail", "Beauty"],
  Runtime: ["All", "15s", "30s", "60s", "90s"],
  "Ad Count": ["All", "1-5", "6-10", "11-20", "20+"],
  Country: ["All", "US", "UK", "Canada", "Australia", "Germany"],
  Language: ["All", "English", "Spanish", "French", "German"],
};
const filterLabels = Object.keys(filterConfig);

type AspectRatio = "9:16" | "16:9" | "1:1";

interface DiscoverCard {
  id: number;
  image: string | null;
  videoSrc?: string | null;
  isVideo: boolean;
  timeAgo: string;
  brandLetter: string;
  brandName: string;
  aspectRatio: AspectRatio;
  status?: string;
  firstSeen?: string | null;
  targetLanguage?: string;
  targetCountries?: string[] | null;
  adCopy?: Record<string, unknown> | null;
  landingPage?: string | null;
  adSnapshotUrl?: string | null;
  platform?: string;
  category?: string | null;
}

const DRAWER_CLOSE_DURATION_MS = 300;

export function DiscoverScreen({
  onCreateAd,
  hasActiveSubscription = true,
  onShowPricingModal,
}: {
  onCreateAd?: (inspiration?: PreselectedInspiration) => void;
  hasActiveSubscription?: boolean;
  onShowPricingModal?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<DiscoverCard | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [cards, setCards] = useState<DiscoverCard[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, pages: 0 });
  const [isLoading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    () => Object.fromEntries(filterLabels.map((k) => [k, "All"]))
  );
  const [sortBy, setSortBy] = useState<"latest" | "oldest" | "most_ads" | "longest_runtime">("latest");
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const fetchAds = useCallback(
    async (page: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await brandsApi.getDiscoverAds({
          page,
          limit: 30,
          search: searchQuery.trim() || undefined,
          media: filterValues.Media,
          status: filterValues.Status,
          category: filterValues.Category,
          runtime: filterValues.Runtime,
          adCount: filterValues["Ad Count"],
          country: filterValues.Country,
          language: filterValues.Language,
          sort: sortBy,
        });
        if (res.success && res.data) {
          const newCards: DiscoverCard[] = (res.data as Array<Record<string, unknown>>).map((ad) => ({
            id: ad.id as number,
            image: (ad.creativeImageUrl as string) ?? null,
            videoSrc: (ad.creativeVideoUrl as string) ?? null,
            isVideo: ad.mediaType === "video",
            timeAgo: (ad.runtime as string) || "",
            brandLetter: (ad.brandLetter as string) || (ad.brandName as string)?.charAt(0) || "?",
            brandName: (ad.brandName as string) || "Unknown",
            aspectRatio: "1:1",
            status: ad.status as string,
            firstSeen: ad.firstSeen as string | null,
            targetLanguage: ad.targetLanguage as string,
            targetCountries: ad.targetCountries as string[] | null,
            targetGender: ad.targetGender as string | null,
            targetAges: ad.targetAges as string[] | null,
            adCopy: ad.adCopy as Record<string, unknown> | null,
            landingPage: ad.landingPage as string | null,
            adSnapshotUrl: ad.adSnapshotUrl as string | null,
            platform: ad.platform as string,
            category: ad.category as string | null,
          }));
          if (append) {
            setCards((prev) => [...prev, ...newCards]);
          } else {
            setCards(newCards);
          }
          if (res.pagination) {
            setPagination(res.pagination);
          }
        }
      } catch (err) {
        console.error("Failed to fetch discover ads:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [searchQuery, filterValues, sortBy]
  );

  useEffect(() => {
    const t = setTimeout(() => fetchAds(1, false), searchQuery ? 400 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, filterValues, sortBy, fetchAds]);

  const loadMore = useCallback(() => {
    if (loadingMore || isLoading) return;
    if (pagination.page >= pagination.pages) return;
    setLoadingMore(true);
    brandsApi
      .getDiscoverAds({
        page: pagination.page + 1,
        limit: 30,
        search: searchQuery.trim() || undefined,
        media: filterValues.Media,
        status: filterValues.Status,
        category: filterValues.Category,
        runtime: filterValues.Runtime,
        adCount: filterValues["Ad Count"],
        country: filterValues.Country,
        language: filterValues.Language,
        sort: sortBy,
      })
      .then((res) => {
        if (res.success && res.data) {
          const newCards: DiscoverCard[] = (res.data as Array<Record<string, unknown>>).map((ad) => ({
            id: ad.id as number,
            image: (ad.creativeImageUrl as string) ?? null,
            videoSrc: (ad.creativeVideoUrl as string) ?? null,
            isVideo: ad.mediaType === "video",
            timeAgo: (ad.runtime as string) || "",
            brandLetter: (ad.brandLetter as string) || (ad.brandName as string)?.charAt(0) || "?",
            brandName: (ad.brandName as string) || "Unknown",
            aspectRatio: "1:1",
            status: ad.status as string,
            firstSeen: ad.firstSeen as string | null,
            targetLanguage: ad.targetLanguage as string,
            targetCountries: ad.targetCountries as string[] | null,
            targetGender: ad.targetGender as string | null,
            targetAges: ad.targetAges as string[] | null,
            adCopy: ad.adCopy as Record<string, unknown> | null,
            landingPage: ad.landingPage as string | null,
            adSnapshotUrl: ad.adSnapshotUrl as string | null,
            platform: ad.platform as string,
            category: ad.category as string | null,
          }));
          setCards((prev) => [...prev, ...newCards]);
          if (res.pagination) setPagination(res.pagination);
        }
      })
      .catch((err) => console.error("Failed to load more ads:", err))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, isLoading, pagination.page, pagination.pages, searchQuery, filterValues, sortBy]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && !isLoading && pagination.page < pagination.pages) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );
    const el = loaderRef.current;
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, loadingMore, isLoading, pagination.page, pagination.pages]);

  const handleOpenDetail = (card: DiscoverCard) => {
    setSelectedCard(card);
    setIsDrawerOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDrawerOpen(false);
    setTimeout(() => setSelectedCard(null), DRAWER_CLOSE_DURATION_MS);
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--app-content-bg))]">
      {/* Toolbar - heading left, actions right */}
      <div className="flex flex-col gap-4 px-2 md:px-3 lg:px-4 py-4 md:py-5 border-b border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--app-content-bg))]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Discover</h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onCreateAd?.()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90 text-sm font-medium shadow-soft"
            >
              <UserPlus className="w-4 h-4" />
              + Create my own ad
            </button>
          </div>
        </div>

        {/* Row 1: Search bar - same bg as main content area */}
        <div className="w-full">
          <div className="flex items-center gap-3 px-4 py-2.5 max-w-2xl h-10 border border-[hsl(var(--discover-input-border))] rounded-full bg-[hsl(var(--app-content-bg))]"
          >
            <Search className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search brands, keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-[hsl(var(--app-content-bg))] outline-none text-sm min-w-0 text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Row 2: Filter pills (left) + Sort (far right) - dropdown menus */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {filterLabels.map((label) => (
              <DropdownMenu key={label}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-4 py-2 h-9 text-sm font-medium transition-colors border border-[hsl(var(--discover-pill-border))] rounded-full text-foreground bg-[hsl(var(--discover-pill-bg))] hover:bg-[#e88d44] hover:text-white hover:border-[#e88d44] data-[state=open]:bg-[#e88d44] data-[state=open]:text-white data-[state=open]:border-[#e88d44]"
                  >
                    {label}
                    <ChevronDown className="w-3.5 h-3.5 text-current" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[140px]">
                  {filterConfig[label].map((opt) => (
                    <DropdownMenuItem
                      key={opt}
                      onClick={() => setFilterValues((prev) => ({ ...prev, [label]: opt }))}
                      className={filterValues[label] === opt ? "bg-accent/10 font-medium" : ""}
                    >
                      {opt}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-2 h-9 text-sm font-medium shrink-0 border border-[hsl(var(--discover-pill-border))] rounded-full text-foreground bg-[hsl(var(--discover-pill-bg))] hover:bg-[#e88d44] hover:text-white hover:border-[#e88d44] data-[state=open]:bg-[#e88d44] data-[state=open]:text-white data-[state=open]:border-[#e88d44]"
              >
                <ArrowUpDown className="w-4 h-4 text-current" />
                Sort: {sortBy === "latest" ? "Latest" : sortBy === "oldest" ? "Oldest" : sortBy === "most_ads" ? "Most Ads" : "Longest Runtime"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => setSortBy("latest")} className={sortBy === "latest" ? "bg-accent/10 font-medium" : ""}>
                Latest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("oldest")} className={sortBy === "oldest" ? "bg-accent/10 font-medium" : ""}>
                Oldest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("most_ads")} className={sortBy === "most_ads" ? "bg-accent/10 font-medium" : ""}>
                Most Ads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("longest_runtime")} className={sortBy === "longest_runtime" ? "bg-accent/10 font-medium" : ""}>
                Longest Runtime
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Masonry grid - varying card heights like wanderlust */}
      <div className="flex-1 overflow-y-auto px-2 md:px-3 lg:px-4 py-4 md:py-5 bg-[hsl(var(--app-content-bg))]">
        {isLoading ? (
          <div className="flex justify-center items-center py-24">
            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-sm font-medium">No ads yet</p>
            <p className="text-xs mt-1">Ads will appear here once brands are added and approved</p>
          </div>
        ) : (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-4 md:gap-5">
          {cards.map((card, index) => (
            <div
              key={card.id}
              className="mb-4 md:mb-5 break-inside-avoid group relative rounded-xl overflow-hidden bg-card shadow-card hover:shadow-card-hover transition-all cursor-pointer animate-scale-in w-full"
              style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
              onClick={() => handleOpenDetail(card)}
              onMouseEnter={() => {
                setHoveredId(card.id);
                if (card.videoSrc && videoRefs.current[card.id]) {
                  videoRefs.current[card.id]?.play().catch(() => {});
                }
              }}
              onMouseLeave={() => {
                setHoveredId(null);
                const v = videoRefs.current[card.id];
                if (v) {
                  v.pause();
                  v.currentTime = 0;
                }
              }}
            >
              <div className="relative">
                {card.videoSrc ? (
                  <>
                    {card.image ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={card.image}
                          alt=""
                          className={`w-full h-auto block transition-opacity duration-300 ${
                            hoveredId === card.id ? "opacity-0" : "opacity-100"
                          }`}
                        />
                        <video
                          ref={(el) => {
                            videoRefs.current[card.id] = el;
                          }}
                          src={card.videoSrc}
                          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                            hoveredId === card.id ? "opacity-100" : "opacity-0"
                          }`}
                          muted
                          playsInline
                          loop
                        />
                      </>
                    ) : (
                      <video
                        ref={(el) => {
                          videoRefs.current[card.id] = el;
                        }}
                        src={card.videoSrc}
                        className="w-full h-auto block"
                        muted
                        playsInline
                        loop
                      />
                    )}
                  </>
                ) : card.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={card.image}
                    alt=""
                    className="w-full h-auto block"
                  />
                ) : (
                  <div className="w-full aspect-square bg-neutral-200 flex items-center justify-center text-neutral-500 text-sm">
                    No preview
                  </div>
                )}
                {/* Time badge - teal pill top-left (new UI) */}
                <div className="absolute top-2.5 left-2.5">
                  <span className="px-2.5 py-1 rounded-md bg-teal-600 text-white text-xs font-medium">
                    {card.timeAgo}
                  </span>
                </div>
                {/* Brand tag - dark or white pill top-right (new UI) */}
                <div className="absolute top-2.5 right-2.5">
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                    card.id % 2 === 0
                      ? "bg-white/95 text-gray-800 border border-gray-200"
                      : "bg-gray-800/90 text-white"
                  }`}>
                    {card.brandLetter} {card.brandName}
                  </span>
                </div>
                {/* Video/Image badge - at bottom, visible when not hovered */}
                <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-gray-800/80 text-white z-10 opacity-100 group-hover:opacity-0 transition-opacity duration-200">
                  {card.isVideo ? (
                    <>
                      <Video className="w-3 h-3" />
                      <span className="text-xs font-medium">Video</span>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-3 h-3" />
                      <span className="text-xs font-medium">Image</span>
                    </>
                  )}
                </div>
                {/* Create ad using template CTA - visible only on hover, at bottom (match wanderlust) */}
                <div className="absolute bottom-0 left-0 right-0 p-2.5 flex justify-center bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateAd?.({
                        imageUrl: card.image ?? null,
                        videoUrl: card.videoSrc ?? null,
                        isVideo: card.isVideo,
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-white text-sm font-semibold bg-[hsl(var(--landing-cta-orange))] hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                    Create ad using template
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
        <div ref={loaderRef} className="flex justify-center py-8">
          {loadingMore && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
        </div>
      </div>

      <AdDetailModal
        card={selectedCard}
        isOpen={isDrawerOpen && !!selectedCard}
        onClose={handleCloseDetail}
        onCreateAd={onCreateAd}
        hasActiveSubscription={hasActiveSubscription}
        onShowPricingModal={onShowPricingModal}
      />
    </div>
  );
}
