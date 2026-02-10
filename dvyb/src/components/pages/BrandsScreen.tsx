"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, UserPlus, UserMinus, Globe, Loader2, Check, AlertCircle, ChevronDown, ArrowUpDown } from "lucide-react";
import { TutorialButton } from "@/components/TutorialButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brandsApi, type CountrySelection } from "@/lib/api";
import {
  trackBrandsViewed,
  trackBrandsSearch,
  trackBrandsFilterApplied,
  trackBrandsTabSwitched,
  trackBrandsRequestBrandClicked,
  trackBrandsFollowClicked,
} from "@/lib/mixpanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BrandRow {
  id: number;
  brandName: string;
  brandDomain: string;
  source: string;
  approvalStatus?: string;
  fetchStatus: string;
  lastAdsFetchedAt: string | null;
  createdAt?: string | null;
  adCount?: number;
  approvedAdCount?: number;
  category?: string | null;
  webTraffic?: string | null;
  facebookLikes?: string | null;
  instagramFollowers?: string | null;
  isFollowing?: boolean;
}

const NEW_BADGE_DAYS = 10;
function isBrandNew(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  const cutoff = Date.now() - NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
  return created >= cutoff;
}

const BRAND_CATEGORY_OPTIONS = ["All", "Fashion", "Food & Beverage", "Tech", "Health", "Retail", "Beauty", "E-Commerce", "Home & Living"];
const BRAND_AD_COUNT_OPTIONS = ["All", "1-5", "6-10", "11-20", "20+"];
const BRAND_FB_LIKES_OPTIONS = ["All", "10K+", "50K+", "100K+", "500K+"];
const BRAND_IG_FOLLOWERS_OPTIONS = ["All", "10K+", "50K+", "100K+", "500K+"];
const BRAND_WEB_TRAFFIC_OPTIONS = ["All", "100K+", "500K+", "1M+", "5M+"];
const BRAND_SORT_OPTIONS = ["recently_added", "most_ads", "oldest"] as const;

/** Meta Ads Library country codes. Same as admin for parity. */
const META_ADS_COUNTRIES: CountrySelection[] = [
  { code: "EU", name: "European Union (all 27 EU countries)" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "IE", name: "Ireland" },
  { code: "PT", name: "Portugal" },
  { code: "GR", name: "Greece" },
  { code: "CZ", name: "Czech Republic" },
  { code: "RO", name: "Romania" },
  { code: "HU", name: "Hungary" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "IL", name: "Israel" },
  { code: "TR", name: "Turkey" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "NZ", name: "New Zealand" },
].sort((a, b) => a.name.localeCompare(b.name));

interface BrandsScreenProps {
  hasActiveSubscription?: boolean;
  onShowPricingModal?: () => void;
}

export function BrandsScreen({ hasActiveSubscription = true, onShowPricingModal }: BrandsScreenProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "following">("all");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterAdCount, setFilterAdCount] = useState("All");
  const [filterFbLikes, setFilterFbLikes] = useState("All");
  const [filterIgFollowers, setFilterIgFollowers] = useState("All");
  const [filterWebTraffic, setFilterWebTraffic] = useState("All");
  const [sortBy, setSortBy] = useState<(typeof BRAND_SORT_OPTIONS)[number]>("recently_added");
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestDomain, setRequestDomain] = useState("");
  const [requestCountries, setRequestCountries] = useState<CountrySelection[]>([]);
  const [requestBrandName, setRequestBrandName] = useState("");
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [pollingBrandId, setPollingBrandId] = useState<number | null>(null);
  const [pollingMessage, setPollingMessage] = useState("");
  const [followLoadingId, setFollowLoadingId] = useState<number | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const fetchBrands = useCallback(async (followingOnly?: boolean) => {
    try {
      setLoading(true);
      const [brandsRes, countRes] = await Promise.all([
        brandsApi.getBrands(followingOnly ? { following: true } : undefined),
        brandsApi.getFollowingCount(),
      ]);
      if (brandsRes.success && brandsRes.data) {
        const { brands: brandList } = brandsRes.data as { brands: BrandRow[]; followingCount: number };
        setBrands(brandList);
      }
      if (countRes.success && typeof countRes.followingCount === "number") {
        setFollowingCount(countRes.followingCount);
      }
    } catch (err) {
      console.error("Failed to fetch brands:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrands(activeTab === "following");
  }, [fetchBrands, activeTab]);

  // Track page view
  useEffect(() => {
    trackBrandsViewed();
  }, []);

  // Track search only when user stops typing (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) {
        trackBrandsSearch(searchQuery.trim());
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Poll for brand ads when fetch is in progress
  useEffect(() => {
    if (!pollingBrandId) return;

    const poll = async () => {
      try {
        const res = await brandsApi.getBrandAds(pollingBrandId);
        if (!res.success || !res.data) return;

        const { brand } = res.data;
        if (brand.fetchStatus === "completed") {
          setPollingBrandId(null);
          setPollingMessage("");
          fetchBrands(activeTab === "following");
        } else if (brand.fetchStatus === "failed") {
          setPollingBrandId(null);
          setPollingMessage("Fetch failed. Please try again later.");
        }
      } catch {
        // Keep polling on transient errors
      }
    };

    const interval = setInterval(poll, 3000);
    poll(); // Initial poll

    return () => clearInterval(interval);
  }, [pollingBrandId, fetchBrands, activeTab]);

  const toggleCountry = (c: CountrySelection) => {
    setRequestCountries((prev) =>
      prev.some((x) => x.code === c.code) ? prev.filter((x) => x.code !== c.code) : [...prev, c]
    );
  };

  const removeCountry = (index: number) => {
    setRequestCountries((prev) => prev.filter((_, i) => i !== index));
  };

  const filteredCountries = countrySearchQuery.trim()
    ? META_ADS_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(countrySearchQuery.toLowerCase()) ||
          c.code.toLowerCase().includes(countrySearchQuery.toLowerCase())
      )
    : META_ADS_COUNTRIES;

  const closeRequestModal = () => {
    setShowRequestModal(false);
    setRequestError("");
    setRequestDomain("");
    setRequestCountries([]);
    setRequestBrandName("");
    setCountrySearchQuery("");
    setCountryDropdownOpen(false);
  };

  const handleRequestBrandClick = () => {
    trackBrandsRequestBrandClicked();
    if (hasActiveSubscription !== true && onShowPricingModal) {
      onShowPricingModal();
      return;
    }
    setShowRequestModal(true);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setCountryDropdownOpen(false);
      }
    };
    if (countryDropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [countryDropdownOpen]);

  const handleRequestBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestDomain.trim()) {
      setRequestError("Brand domain is required");
      return;
    }
    try {
      setRequesting(true);
      setRequestError("");
      const res = await brandsApi.requestBrand(requestDomain.trim(), {
        countries: requestCountries.length > 0 ? requestCountries : undefined,
        brandName: requestBrandName.trim() || undefined,
      });
      if (res.success && res.data) {
        const { brand } = res.data;
        closeRequestModal();
        if (brand.approvalStatus === "pending_approval") {
          setPollingMessage("Request submitted. An admin will review and approve to fetch ads.");
          setPollingBrandId(null);
          setTimeout(() => setPollingMessage(""), 5000);
        } else if (brand.fetchStatus === "fetching" || brand.fetchStatus === "pending") {
          setPollingBrandId(brand.id);
          setPollingMessage(`Fetching ads for ${brand.brandDomain}...`);
        } else if (brand.fetchStatus === "completed") {
          fetchBrands();
        }
      } else {
        setRequestError((res as { error?: string }).error || "Failed to request brand");
      }
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Failed to request brand");
    } finally {
      setRequesting(false);
    }
  };

  const filteredBrands = useMemo(() => {
    let list = brands;
    // When on Following tab, brands are already filtered by API
    if (searchQuery.trim()) {
      list = list.filter(
        (b) =>
          (b.brandName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.brandDomain.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (filterCategory !== "All") {
      list = list.filter(
        (b) => (b.category || "").toLowerCase().includes(filterCategory.toLowerCase())
      );
    }
    if (filterAdCount !== "All") {
      const count = (b: BrandRow) => b.approvedAdCount ?? 0;
      if (filterAdCount === "1-5") list = list.filter((b) => count(b) >= 1 && count(b) <= 5);
      else if (filterAdCount === "6-10") list = list.filter((b) => count(b) >= 6 && count(b) <= 10);
      else if (filterAdCount === "11-20") list = list.filter((b) => count(b) >= 11 && count(b) <= 20);
      else if (filterAdCount === "20+") list = list.filter((b) => count(b) >= 20);
    }
    const sorted = [...list].sort((a, b) => {
      if (sortBy === "most_ads") return (b.approvedAdCount ?? 0) - (a.approvedAdCount ?? 0);
      if (sortBy === "oldest") {
        const da = a.lastAdsFetchedAt ? new Date(a.lastAdsFetchedAt).getTime() : 0;
        const db = b.lastAdsFetchedAt ? new Date(b.lastAdsFetchedAt).getTime() : 0;
        return da - db;
      }
      const da = a.lastAdsFetchedAt ? new Date(a.lastAdsFetchedAt).getTime() : 0;
      const db = b.lastAdsFetchedAt ? new Date(b.lastAdsFetchedAt).getTime() : 0;
      return db - da;
    });
    return sorted;
  }, [brands, activeTab, searchQuery, filterCategory, filterAdCount, filterFbLikes, filterIgFollowers, filterWebTraffic, sortBy]);

  const activeFilterCount = [
    filterCategory,
    filterAdCount,
    filterFbLikes,
    filterIgFollowers,
    filterWebTraffic,
  ].filter((v) => v && v !== "All").length;

  const handleFollowBrand = async (brand: BrandRow) => {
    if (followLoadingId === brand.id) return;
    if (!brand.isFollowing && hasActiveSubscription !== true && onShowPricingModal) {
      onShowPricingModal();
      return;
    }
    trackBrandsFollowClicked(brand.id, brand.brandName || brand.brandDomain, !brand.isFollowing);
    try {
      setFollowLoadingId(brand.id);
      if (brand.isFollowing) {
        await brandsApi.unfollowBrand(brand.id);
        setBrands((prev) =>
          prev.map((b) => (b.id === brand.id ? { ...b, isFollowing: false } : b))
        );
      } else {
        await brandsApi.followBrand(brand.id);
        setBrands((prev) =>
          prev.map((b) => (b.id === brand.id ? { ...b, isFollowing: true } : b))
        );
      }
      // Refresh count from dvyb_brands_follow
      const countRes = await brandsApi.getFollowingCount();
      if (countRes.success && typeof countRes.followingCount === "number") {
        setFollowingCount(countRes.followingCount);
      }
    } catch (err) {
      console.error("Failed to follow/unfollow brand:", err);
    } finally {
      setFollowLoadingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--app-content-bg))] lg:overflow-auto">
      {/* Toolbar - sticky on mobile/tablet; proper left/right margin (wander-style px-4) */}
      <div className="sticky top-0 z-10 px-4 pb-4 pt-2 lg:static lg:px-4 lg:pt-4 lg:pb-4 lg:border-b border-[hsl(var(--landing-nav-bar-border))] bg-[hsl(var(--app-content-bg))]">
        {/* Row 1: Title + Request (+ Tutorial on desktop) */}
        <div className="flex items-center justify-between gap-3 mb-4 lg:mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-display">Brands</h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRequestBrandClick}
              className="flex items-center gap-2 px-3 py-2 lg:px-4 lg:py-2.5 rounded-full bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90 text-sm font-medium"
            >
              <UserPlus className="w-4 h-4" />
              <span className="hidden lg:inline">+ Request a brand</span>
              <span className="lg:hidden">Request</span>
            </button>
            <div className="hidden lg:block">
              <TutorialButton screen="brands" />
            </div>
          </div>
        </div>

        {/* Tabs: All Brands | Following - full width on mobile */}
        <div className="flex gap-1 p-1 rounded-full bg-[hsl(var(--landing-explore-pill-bg))] border border-[hsl(var(--landing-nav-bar-border))] w-full lg:w-fit mb-4">
          <button
            type="button"
            onClick={() => { setActiveTab("all"); trackBrandsTabSwitched("all"); }}
            className={`flex-1 lg:flex-initial px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeTab === "all"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Brands
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("following"); trackBrandsTabSwitched("following"); }}
            className={`flex-1 lg:flex-initial px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeTab === "following"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Following ({followingCount})
          </button>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 border border-[hsl(var(--landing-nav-bar-border))] rounded-full px-4 py-2.5 lg:py-3 h-10 lg:max-w-xl mb-4 lg:mb-6 bg-[hsl(var(--app-content-bg))]">
          <Search className="w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder="Search brands, keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm min-w-0"
          />
        </div>

        {/* Polling banner */}
        {pollingMessage && (
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm mb-4 ${
              pollingMessage.includes("submitted")
                ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
                : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
            }`}
          >
            {pollingMessage.includes("submitted") ? null : (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            )}
            <span>{pollingMessage}</span>
          </div>
        )}

        {/* Mobile/Tablet: Filter + Sort row (wander-style) */}
        <div className="flex items-center gap-2 mb-4 lg:hidden">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMobileFilters ? "rotate-180" : ""}`} />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-[hsl(var(--landing-cta-orange))] text-white rounded-full text-xs">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortBy === "recently_added" ? "Recently added" : sortBy === "most_ads" ? "Most Ads" : "Oldest"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => { setSortBy("recently_added"); trackBrandsFilterApplied("Sort", "recently_added"); }}>
                Recently added
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("most_ads"); trackBrandsFilterApplied("Sort", "most_ads"); }}>
                Most Ads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("oldest"); trackBrandsFilterApplied("Sort", "oldest"); }}>
                Oldest
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile: Collapsible filter pills */}
        {showMobileFilters && (
          <div className="flex flex-wrap gap-2 mb-4 lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Category <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                {BRAND_CATEGORY_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => { setFilterCategory(opt); trackBrandsFilterApplied("Category", opt); }} className={filterCategory === opt ? "bg-accent/10 font-medium" : ""}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  FB Likes <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_FB_LIKES_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => { setFilterFbLikes(opt); trackBrandsFilterApplied("FB Likes", opt); }} className={filterFbLikes === opt ? "bg-accent/10 font-medium" : ""}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  IG Followers <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_IG_FOLLOWERS_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => { setFilterIgFollowers(opt); trackBrandsFilterApplied("IG Followers", opt); }} className={filterIgFollowers === opt ? "bg-accent/10 font-medium" : ""}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Web Traffic <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_WEB_TRAFFIC_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => { setFilterWebTraffic(opt); trackBrandsFilterApplied("Web Traffic", opt); }} className={filterWebTraffic === opt ? "bg-accent/10 font-medium" : ""}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Ad Count <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_AD_COUNT_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt} onClick={() => { setFilterAdCount(opt); trackBrandsFilterApplied("Ad Count", opt); }} className={filterAdCount === opt ? "bg-accent/10 font-medium" : ""}>
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Desktop: Full filter row + Sort */}
        <div className="hidden lg:flex flex-wrap items-center justify-between gap-2 mb-6">
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Category
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                {BRAND_CATEGORY_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => { setFilterCategory(opt); trackBrandsFilterApplied("Category", opt); }}
                    className={filterCategory === opt ? "bg-accent/10 font-medium" : ""}
                  >
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  FB Likes
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_FB_LIKES_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => { setFilterFbLikes(opt); trackBrandsFilterApplied("FB Likes", opt); }}
                    className={filterFbLikes === opt ? "bg-accent/10 font-medium" : ""}
                  >
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  IG Followers
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_IG_FOLLOWERS_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => { setFilterIgFollowers(opt); trackBrandsFilterApplied("IG Followers", opt); }}
                    className={filterIgFollowers === opt ? "bg-accent/10 font-medium" : ""}
                  >
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Web Traffic
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_WEB_TRAFFIC_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => { setFilterWebTraffic(opt); trackBrandsFilterApplied("Web Traffic", opt); }}
                    className={filterWebTraffic === opt ? "bg-accent/10 font-medium" : ""}
                  >
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                  Ad Count
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[120px]">
                {BRAND_AD_COUNT_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => { setFilterAdCount(opt); trackBrandsFilterApplied("Ad Count", opt); }}
                    className={filterAdCount === opt ? "bg-accent/10 font-medium" : ""}
                  >
                    {opt}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full shrink-0">
                <ArrowUpDown className="w-4 h-4" />
                Sort: {sortBy === "recently_added" ? "Recently added" : sortBy === "most_ads" ? "Most Ads" : "Oldest"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => { setSortBy("recently_added"); trackBrandsFilterApplied("Sort", "recently_added"); }} className={sortBy === "recently_added" ? "bg-accent/10 font-medium" : ""}>
                Recently added
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("most_ads"); trackBrandsFilterApplied("Sort", "most_ads"); }} className={sortBy === "most_ads" ? "bg-accent/10 font-medium" : ""}>
                Most Ads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortBy("oldest"); trackBrandsFilterApplied("Sort", "oldest"); }} className={sortBy === "oldest" ? "bg-accent/10 font-medium" : ""}>
                Oldest
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content area - proper left/right margin on mobile and tablet (wander-style) */}
      <div className="flex-1 overflow-auto px-4 pb-4 lg:pb-5 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Globe className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm font-medium">No brands yet</p>
            <p className="text-xs mt-1 text-center">Request a brand to see competitor ads from Meta Ad Library</p>
            <button
              type="button"
              onClick={handleRequestBrandClick}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90 text-sm font-medium"
            >
              <UserPlus className="w-4 h-4" />
              Request a brand
            </button>
          </div>
        ) : (
          <>
            {/* Mobile only: 2-column card grid (tablet uses table with horizontal scroll) */}
            <div className="grid grid-cols-2 gap-3 md:hidden">
              {filteredBrands.map((brand) => (
                <div
                  key={brand.id}
                  className="bg-background border border-border rounded-xl p-4 flex flex-col items-center text-center"
                >
                  <div className="relative mb-3">
                    {isBrandNew(brand.createdAt) && (
                      <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-[hsl(var(--landing-cta-orange))] text-white text-[10px] font-bold rounded">
                        NEW
                      </span>
                    )}
                    <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-xl font-semibold text-foreground">
                      {(brand.brandName || brand.brandDomain)[0]}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mb-1 min-w-0">
                    <span className="font-medium text-sm truncate">{brand.brandName || brand.brandDomain}</span>
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 shrink-0">
                      <Check className="w-2.5 h-2.5 text-white stroke-[2.5]" />
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground mb-3 truncate w-full">{brand.category || "—"}</span>
                  <button
                    type="button"
                    onClick={() => handleFollowBrand(brand)}
                    disabled={followLoadingId === brand.id}
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      brand.isFollowing
                        ? "bg-secondary text-foreground border border-border"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    {followLoadingId === brand.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : brand.isFollowing ? (
                      <>
                        <UserMinus className="w-3.5 h-3.5" />
                        Following
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3.5 h-3.5" />
                        Follow
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>

            {/* Tablet + Desktop: Table with internal horizontal scroll (wander-style) */}
            <div className="hidden md:block rounded-lg overflow-hidden bg-card shadow-sm border border-border overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse table-fixed">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-border bg-secondary/50">
                <tr>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Brand
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Domain
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Category
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Web Traffic
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Facebook
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Instagram
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                    Ads
                  </th>
                  <th className="text-left py-3.5 px-5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider align-middle">
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredBrands.map((brand) => (
                  <tr
                    key={brand.id}
                    className="border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors bg-card align-middle"
                  >
                    <td className="py-3.5 px-5 align-middle">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-foreground font-semibold text-sm bg-secondary">
                            {(brand.brandName || brand.brandDomain)[0]}
                          </div>
                          {isBrandNew(brand.createdAt) && (
                            <span className="absolute -top-1 -left-1 px-1.5 py-1 rounded-lg bg-[hsl(var(--landing-cta-orange))] text-white text-[10px] font-semibold uppercase leading-none shadow-sm">
                              New
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm text-foreground font-normal truncate">
                            {brand.brandName || brand.brandDomain}
                          </span>
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 shrink-0">
                            <Check className="w-3 h-3 text-white stroke-[2.5]" />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{brand.brandDomain}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <span className="text-sm text-muted-foreground truncate block">
                        {brand.category || "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <span className="text-sm text-muted-foreground">{brand.webTraffic || "—"}</span>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <span className="text-sm text-muted-foreground">{brand.facebookLikes || "—"}</span>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <span className="text-sm text-muted-foreground">{brand.instagramFollowers || "—"}</span>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <span className="text-sm text-foreground font-medium">{brand.approvedAdCount ?? 0}</span>
                    </td>
                    <td className="py-3.5 px-5 align-middle">
                      <button
                        type="button"
                        onClick={() => handleFollowBrand(brand)}
                        disabled={followLoadingId === brand.id}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          brand.isFollowing
                            ? "bg-secondary text-foreground border border-[hsl(var(--landing-nav-bar-border))] hover:bg-secondary/80"
                            : "bg-blue-500 text-white hover:bg-blue-600"
                        }`}
                      >
                        {followLoadingId === brand.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : brand.isFollowing ? (
                          <>
                            <UserMinus className="w-3.5 h-3.5" />
                            Following
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            Follow
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
          )}
      </div>

      {/* Request Brand Modal - aligned to admin structure, dvyb theme */}
      <Dialog open={showRequestModal} onOpenChange={(open) => !open && closeRequestModal()}>
        <DialogContent
          className="max-w-2xl w-full min-w-0 border border-[hsl(var(--landing-nav-bar-border))] bg-background shadow-xl"
          hideCloseButton={false}
        >
          <DialogHeader className="border-b border-[hsl(var(--landing-nav-bar-border))] pb-6">
            <DialogTitle className="text-xl font-bold text-foreground">Request a brand</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              You will see the Ads once the brand is approved.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRequestBrand} className="space-y-4 pt-6">
            {requestError && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{requestError}</span>
              </div>
            )}
            <div>
              <Label htmlFor="brand-domain" className="text-sm font-medium text-foreground">
                Brand domain *
              </Label>
              <Input
                id="brand-domain"
                type="text"
                value={requestDomain}
                onChange={(e) => setRequestDomain(e.target.value)}
                placeholder="e.g. nike.com"
                className="mt-2 border-[hsl(var(--landing-nav-bar-border))] focus-visible:ring-[hsl(var(--landing-cta-orange))]"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">Enter domain without https://</p>
            </div>
            <div className="min-w-0" ref={countryDropdownRef}>
              <Label className="text-sm font-medium text-foreground">
                Countries to fetch ads from
              </Label>
              <p className="text-xs text-muted-foreground mb-2 mt-1">
                Select countries where competitors run ads. Empty = All.
              </p>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setCountryDropdownOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 mt-1 border border-[hsl(var(--landing-nav-bar-border))] rounded-lg bg-background text-foreground text-left hover:bg-[hsl(var(--landing-explore-pill-hover))] focus:ring-2 focus:ring-[hsl(var(--landing-cta-orange))] focus:border-transparent transition-colors"
                >
                  <span className="truncate">
                    {requestCountries.length === 0
                      ? "Select countries..."
                      : `${requestCountries.length} selected`}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${countryDropdownOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {countryDropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 rounded-lg border border-[hsl(var(--landing-nav-bar-border))] bg-background shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-[hsl(var(--landing-nav-bar-border))]">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search countries..."
                          value={countrySearchQuery}
                          onChange={(e) => setCountrySearchQuery(e.target.value)}
                          className="pl-8 border-[hsl(var(--landing-nav-bar-border))] focus-visible:ring-[hsl(var(--landing-cta-orange))]"
                        />
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {filteredCountries.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                          No countries match
                        </p>
                      ) : (
                        filteredCountries.map((c) => {
                          const isSelected = requestCountries.some((x) => x.code === c.code);
                          return (
                            <label
                              key={c.code}
                              className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-[hsl(var(--landing-explore-pill-hover))] text-sm text-foreground"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleCountry(c)}
                                className="rounded border-[hsl(var(--landing-nav-bar-border))] text-[hsl(var(--landing-cta-orange))] focus:ring-[hsl(var(--landing-cta-orange))]"
                              />
                              {c.name} ({c.code})
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              {requestCountries.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {requestCountries.map((c, i) => (
                    <span
                      key={c.code}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[hsl(var(--landing-explore-pill-bg))] border border-[hsl(var(--landing-nav-bar-border))] text-foreground text-sm"
                    >
                      {c.name} ({c.code})
                      <button
                        type="button"
                        onClick={() => removeCountry(i)}
                        className="text-muted-foreground hover:text-foreground ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="brand-name" className="text-sm font-medium text-foreground">
                Brand name (optional)
              </Label>
              <Input
                id="brand-name"
                type="text"
                value={requestBrandName}
                onChange={(e) => setRequestBrandName(e.target.value)}
                placeholder="e.g. Nike"
                className="mt-2 border-[hsl(var(--landing-nav-bar-border))] focus-visible:ring-[hsl(var(--landing-cta-orange))]"
              />
            </div>
            <DialogFooter className="flex gap-3 pt-4 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={closeRequestModal}
                className="flex-1 sm:flex-initial border-[hsl(var(--landing-nav-bar-border))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={requesting}
                className="flex-1 sm:flex-initial bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90"
              >
                {requesting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Requesting...
                  </span>
                ) : (
                  "Request brand"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
