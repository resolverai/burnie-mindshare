"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Video, Loader2, UserPlus, ChevronDown, ArrowUpDown, Lock, ImageIcon } from "lucide-react";
import { TutorialButton } from "@/components/TutorialButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AdDetailModal } from "./AdDetailModal";
import type { PreselectedInspiration } from "./CreateAdFlowModal";
import { brandsApi, accountApi } from "@/lib/api";
import { META_AD_COUNTRIES_UNIQUE } from "@/lib/metaAdCountries";
import {
  trackDiscoverViewed,
  trackDiscoverSearch,
  trackDiscoverFilterApplied,
  trackDiscoverSortChanged,
  trackDiscoverCreateMyOwnAdClicked,
  trackDiscoverAdCardClicked,
  trackCreateAdUsingTemplateClicked,
} from "@/lib/mixpanel";

const filterConfig: Record<string, string[]> = {
  Media: ["All", "Image", "Video"],
  Status: ["All", "Active", "Paused", "Draft"],
  Runtime: ["All", "≥ 1d", "≥ 7d", "≥ 30d", "≥ 90d"],
  "Ad Count": ["All", "1-5", "6-10", "11-20", "20+"],
  Language: ["All", "English", "Spanish", "French", "German"],
};
const filterLabels = ["Media", "Status", "Category", "Runtime", "Ad Count", "Country", "Language"];

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
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [discoverCategories, setDiscoverCategories] = useState<string[]>([]);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [countryPopoverOpen, setCountryPopoverOpen] = useState(false);
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const loaderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    brandsApi.getDiscoverCategories().then((res) => {
      if (res.success && Array.isArray(res.data)) setDiscoverCategories(res.data);
    }).catch(() => {});
  }, []);

  const activeFilterCount = Object.values(filterValues).filter((v) => v && v !== "All").length;

  const categoryOptions = ["All", ...discoverCategories];
  const countryOptions: { value: string; label: string }[] = [
    { value: "All", label: "All" },
    ...META_AD_COUNTRIES_UNIQUE.map((c) => ({ value: c.code, label: c.name })),
  ];

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

  // Mark discover page visited (for free trial edit limit)
  useEffect(() => {
    accountApi.recordDiscoverVisit().catch(() => {});
  }, []);

  // Track page view
  useEffect(() => {
    trackDiscoverViewed();
  }, []);

  // Track search only when user stops typing (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) {
        trackDiscoverSearch(searchQuery.trim());
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery]);

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
          // Append only: keep existing cards immutable so their content never changes.
          // Deduplicate by id to avoid layout shifts from overlapping/duplicate backend responses.
          setCards((prev) => {
            const existingIds = new Set(prev.map((c) => c.id));
            const toAdd = newCards.filter((c) => !existingIds.has(c.id));
            return [...prev, ...toAdd];
          });
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
      {/* Toolbar - proper left/right margin (wander-style px-4) */}
      <div className="flex flex-col gap-4 px-4 py-4 lg:py-5 border-b border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--app-content-bg))]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-display">Discover</h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                trackDiscoverCreateMyOwnAdClicked();
                onCreateAd?.();
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90 text-sm font-medium shadow-soft"
            >
              <UserPlus className="w-4 h-4" />
              + Create my own ad
            </button>
            <TutorialButton screen="discover" />
          </div>
        </div>

        {/* Search bar */}
        <div className="w-full max-w-2xl">
          <div className="flex items-center gap-3 px-4 py-2.5 lg:py-3 h-10 border border-[hsl(var(--discover-input-border))] rounded-full bg-[hsl(var(--app-content-bg))]"
          >
            <Search className="w-4 h-4 lg:w-5 lg:h-5 flex-shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search brands, keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm min-w-0 text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Mobile/Tablet: Filter + Sort only (wander-style), expandable filters */}
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className="flex items-center gap-1.5 px-4 py-2 h-9 text-sm font-medium rounded-full border border-[hsl(var(--discover-pill-border))] bg-[hsl(var(--discover-pill-bg))] text-foreground hover:opacity-90"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMobileFilters ? "rotate-180" : ""}`} />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-[hsl(var(--landing-cta-orange))] text-white rounded-full text-xs">
                {activeFilterCount}
              </span>
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-2 h-9 text-sm font-medium rounded-full border border-[hsl(var(--discover-pill-border))] bg-[hsl(var(--discover-pill-bg))] text-foreground hover:opacity-90"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortBy === "latest" ? "Latest" : sortBy === "oldest" ? "Oldest" : sortBy === "most_ads" ? "Most Ads" : "Longest Runtime"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => { setSortBy("latest"); trackDiscoverSortChanged("latest"); }} className={sortBy === "latest" ? "bg-accent/10 font-medium" : ""}>
                Latest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("oldest"); trackDiscoverSortChanged("oldest"); }} className={sortBy === "oldest" ? "bg-accent/10 font-medium" : ""}>
                Oldest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("most_ads"); trackDiscoverSortChanged("most_ads"); }} className={sortBy === "most_ads" ? "bg-accent/10 font-medium" : ""}>
                Most Ads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("longest_runtime"); trackDiscoverSortChanged("longest_runtime"); }} className={sortBy === "longest_runtime" ? "bg-accent/10 font-medium" : ""}>
                Longest Runtime
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile/Tablet: Collapsible filter pills */}
        {showMobileFilters && (
          <div className="flex flex-wrap gap-2 lg:hidden">
            {filterLabels.map((label) => {
              const triggerClass = "flex items-center gap-2 px-4 py-2 h-9 text-sm font-medium rounded-full border border-[hsl(var(--discover-pill-border))] bg-[hsl(var(--discover-pill-bg))] text-foreground";
              if (label === "Category") {
                return (
                  <Popover key={label} open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className={triggerClass}>
                        {label}
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[240px] p-0">
                      <Command>
                        <CommandInput placeholder="Search categories..." />
                        <CommandList>
                          <CommandEmpty>No category found.</CommandEmpty>
                          <CommandGroup>
                            {categoryOptions.map((opt) => (
                              <CommandItem
                                key={opt}
                                value={opt}
                                onSelect={() => {
                                  setFilterValues((prev) => ({ ...prev, [label]: opt }));
                                  trackDiscoverFilterApplied(label, opt);
                                  setCategoryPopoverOpen(false);
                                }}
                                className={filterValues[label] === opt ? "bg-accent/10 font-medium" : ""}
                              >
                                {opt}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              }
              if (label === "Country") {
                return (
                  <Popover key={label} open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className={triggerClass}>
                        {label}
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[240px] p-0">
                      <Command>
                        <CommandInput placeholder="Search countries..." />
                        <CommandList>
                          <CommandEmpty>No country found.</CommandEmpty>
                          <CommandGroup>
                            {countryOptions.map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => {
                                  setFilterValues((prev) => ({ ...prev, [label]: opt.value }));
                                  trackDiscoverFilterApplied(label, opt.value);
                                  setCountryPopoverOpen(false);
                                }}
                                className={filterValues[label] === opt.value ? "bg-accent/10 font-medium" : ""}
                              >
                                {opt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <DropdownMenu key={label}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={triggerClass}>
                      {label}
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[140px]">
                    {filterConfig[label].map((opt) => (
                      <DropdownMenuItem
                        key={opt}
                        onClick={() => {
                          setFilterValues((prev) => ({ ...prev, [label]: opt }));
                          trackDiscoverFilterApplied(label, opt);
                        }}
                        className={filterValues[label] === opt ? "bg-accent/10 font-medium" : ""}
                      >
                        {opt}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </div>
        )}

        {/* Desktop: Full filter row + Sort */}
        <div className="hidden lg:flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {filterLabels.map((label) => {
              const triggerClass = "flex items-center gap-2 px-4 py-2 h-9 text-sm font-medium transition-colors border border-[hsl(var(--discover-pill-border))] rounded-full text-foreground bg-[hsl(var(--discover-pill-bg))] hover:bg-[#e88d44] hover:text-white hover:border-[#e88d44] data-[state=open]:bg-[#e88d44] data-[state=open]:text-white data-[state=open]:border-[#e88d44]";
              if (label === "Category") {
                return (
                  <Popover key={label} open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className={triggerClass}>
                        {label}
                        <ChevronDown className="w-3.5 h-3.5 text-current" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[260px] p-0">
                      <Command>
                        <CommandInput placeholder="Search categories..." />
                        <CommandList>
                          <CommandEmpty>No category found.</CommandEmpty>
                          <CommandGroup>
                            {categoryOptions.map((opt) => (
                              <CommandItem
                                key={opt}
                                value={opt}
                                onSelect={() => {
                                  setFilterValues((prev) => ({ ...prev, [label]: opt }));
                                  trackDiscoverFilterApplied(label, opt);
                                  setCategoryPopoverOpen(false);
                                }}
                                className={filterValues[label] === opt ? "bg-accent/10 font-medium" : ""}
                              >
                                {opt}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              }
              if (label === "Country") {
                return (
                  <Popover key={label} open={countryPopoverOpen} onOpenChange={setCountryPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className={triggerClass}>
                        {label}
                        <ChevronDown className="w-3.5 h-3.5 text-current" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[260px] p-0">
                      <Command>
                        <CommandInput placeholder="Search countries..." />
                        <CommandList>
                          <CommandEmpty>No country found.</CommandEmpty>
                          <CommandGroup>
                            {countryOptions.map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => {
                                  setFilterValues((prev) => ({ ...prev, [label]: opt.value }));
                                  trackDiscoverFilterApplied(label, opt.value);
                                  setCountryPopoverOpen(false);
                                }}
                                className={filterValues[label] === opt.value ? "bg-accent/10 font-medium" : ""}
                              >
                                {opt.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <DropdownMenu key={label}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={triggerClass}>
                      {label}
                      <ChevronDown className="w-3.5 h-3.5 text-current" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[140px]">
                    {filterConfig[label].map((opt) => (
                      <DropdownMenuItem
                        key={opt}
                        onClick={() => {
                          setFilterValues((prev) => ({ ...prev, [label]: opt }));
                          trackDiscoverFilterApplied(label, opt);
                        }}
                        className={filterValues[label] === opt ? "bg-accent/10 font-medium" : ""}
                      >
                        {opt}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
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
              <DropdownMenuItem onClick={() => { setSortBy("latest"); trackDiscoverSortChanged("latest"); }} className={sortBy === "latest" ? "bg-accent/10 font-medium" : ""}>
                Latest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("oldest"); trackDiscoverSortChanged("oldest"); }} className={sortBy === "oldest" ? "bg-accent/10 font-medium" : ""}>
                Oldest
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("most_ads"); trackDiscoverSortChanged("most_ads"); }} className={sortBy === "most_ads" ? "bg-accent/10 font-medium" : ""}>
                Most Ads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("longest_runtime"); trackDiscoverSortChanged("longest_runtime"); }} className={sortBy === "longest_runtime" ? "bg-accent/10 font-medium" : ""}>
                Longest Runtime
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Masonry grid - proper left/right margin (wander-style) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 lg:py-5 bg-[hsl(var(--app-content-bg))]">
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
              onClick={() => {
                trackDiscoverAdCardClicked(card.id, card.brandName);
                handleOpenDetail(card);
              }}
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
                      trackCreateAdUsingTemplateClicked({
                        source: 'discover_card',
                        adId: card.id,
                        brandName: card.brandName,
                        isVideo: card.isVideo,
                      });
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
