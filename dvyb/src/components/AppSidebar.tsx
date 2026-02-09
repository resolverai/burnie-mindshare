"use client";

import { useState, useEffect } from "react";
import { 
  FileText, 
  Palette,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogOut,
  ImageIcon,
  Video,
  Sparkles,
  Moon,
  Compass,
  Building2,
  VideoIcon,
  Package,
  Bookmark,
  Pencil,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi } from "@/lib/api";
import { PricingModal } from "@/components/PricingModal";
import { trackThemeChanged, trackUpgradeButtonClicked } from "@/lib/mixpanel";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";

interface AppSidebarProps {
  activeView: string;
  activeSubView?: string;
  onViewChange: (view: string, subView?: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  forceCollapsed?: boolean;
  onboardingHighlight?: 'content_library' | 'brand_kit' | null;
  onHighlightClick?: (item: string) => void;
  /** When provided, shows "Create your ad" button; called when user clicks it (same flow as Discover "Create my own ad") */
  onCreateAd?: () => void;
}

// Wanderlust-style nav: Discover, Brands, My Content (collapsible), Brand Kit (collapsible), Settings
// Hidden (keep code): home, calendar, content-library, brand-plan, subscription
const topLevelItems = [
  { id: "discover", label: "Discover", icon: Compass, disabled: false },
  { id: "brands", label: "Brands", icon: Building2, disabled: false },
];
const myContentSubItems = [
  { id: "my-ads", label: "My Ads", icon: VideoIcon, route: "/content-library" },
  { id: "my-products", label: "My Products", icon: Package, route: "/content-library" },
  { id: "saved-ads", label: "Saved Ads", icon: Bookmark, route: "/content-library" },
];
const brandKitSubItems = [
  { id: "style", label: "Style", icon: Pencil, route: "/brand-kit" },
  { id: "source-materials", label: "Source Materials", icon: FileText, route: "/brand-kit" },
];
// Settings moved to bottom section with Dark Mode, Upgrade, Log out (wanderlust style)

export const AppSidebar = ({ activeView, activeSubView, onViewChange, isMobileOpen = false, onMobileClose, forceCollapsed = false, onboardingHighlight = null, onHighlightClick, onCreateAd }: AppSidebarProps) => {
  const [myContentExpanded, setMyContentExpanded] = useState(() => activeView === "content-library");
  const [brandKitExpanded, setBrandKitExpanded] = useState(() => activeView === "brand-kit");
  // Collapsed by default on mobile/tablet, expanded on desktop
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024; // Tailwind's lg breakpoint
    }
    return false;
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [planInfo, setPlanInfo] = useState<{
    planName: string;
    selectedFrequency: 'monthly' | 'annual';
    imagePostsLimit: number;
    videoPostsLimit: number;
    isFreeTrialPlan: boolean;
    planId?: number;
    monthlyPrice?: number;
    annualPrice?: number;
    initialAcquisitionFlow?: 'website_analysis' | 'product_photoshot' | null;
  } | null>(null);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const { accountId, logout } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted before accessing theme
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (activeView === "content-library") setMyContentExpanded(true);
  }, [activeView]);
  useEffect(() => {
    if (activeView === "brand-kit") setBrandKitExpanded(true);
  }, [activeView]);

  // Determine if sidebar should be collapsed (either manually or forced)
  const collapsed = forceCollapsed || isCollapsed;

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  // Handle window resize for responsive sidebar state
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      } else {
        setIsCollapsed(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchLogo = async () => {
      if (!accountId) return;
      
      try {
        const response = await contextApi.getContext();
        if (response.success && response.data) {
          // Use logoPresignedUrl (which includes presigned S3 URL) instead of logoUrl
          const presignedUrl = response.data.logoPresignedUrl || response.data.logoUrl;
          if (presignedUrl) {
            console.log("Setting logo URL:", presignedUrl);
            setLogoUrl(presignedUrl);
          }
        }
      } catch (error) {
        console.error("Failed to fetch logo:", error);
      }
    };

    fetchLogo();
  }, [accountId]);

  useEffect(() => {
    const fetchPlan = async () => {
      if (!accountId) return;
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/plan`, {
          credentials: 'include',
          headers: {
            ...(() => {
              const storedAccountId = localStorage.getItem('dvyb_account_id');
              return storedAccountId ? { 'X-DVYB-Account-ID': storedAccountId } : {};
            })(),
          },
        });
        const data = await response.json();
        if (data.success && data.data) {
          setPlanInfo({
            ...data.data,
            planId: data.data.planId,
            monthlyPrice: data.data.monthlyPrice,
            annualPrice: data.data.annualPrice,
            initialAcquisitionFlow: data.data.initialAcquisitionFlow,
          });
        }
      } catch (error) {
        console.error("Failed to fetch plan:", error);
      }
    };

    fetchPlan();
  }, [accountId]);

  const handleMenuItemClick = (itemId: string, disabled: boolean, subView?: string) => {
    if (!disabled) {
      const view = itemId.startsWith("/") ? itemId.replace(/^\//, "") : itemId;
      onViewChange(view, subView);
      if (onMobileClose) onMobileClose();
      if (onHighlightClick) {
        if (view === "content-library" || subView === "my-ads" || subView === "my-products" || subView === "saved-ads") {
          onHighlightClick("content_library");
        } else if (view === "brand-kit" || subView === "style" || subView === "source-materials") {
          onHighlightClick("brand_kit");
        }
      }
    }
  };

  const shouldShowRing = (itemId: string): boolean => {
    if ((itemId === "content-library" || itemId === "my-ads") && onboardingHighlight === "content_library") return true;
    if ((itemId === "brand-kit" || itemId === "style") && onboardingHighlight === "brand_kit") return true;
    return false;
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-[60] md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-[hsl(var(--sidebar-wanderlust-bg))] border-r border-sidebar-border h-screen flex flex-col transition-all duration-300 relative",
          // Mobile: Fixed positioning, slide in/out
          "fixed md:static top-0 left-0 z-[70]",
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // Width based on collapsed state (only applies to tablet/desktop)
          collapsed ? "w-64 md:w-16" : "w-64"
        )}
      >
        {/* Logo Section */}
        <div className={cn(
          "p-4 flex items-center justify-center border-b border-sidebar-border",
          collapsed ? "md:p-2" : "p-4"
        )}>
          {logoUrl ? (
            <img 
              src={logoUrl} 
              alt="Logo" 
              className={cn(
                "object-contain",
                collapsed ? "h-16 md:h-8 w-auto md:w-8" : "h-16 w-auto"
              )}
            />
          ) : (
            <Image 
              src={dvybLogo} 
              alt="Dvyb Logo" 
              className={cn(
                "object-contain",
                collapsed ? "h-16 md:h-8 w-auto md:w-8" : "h-16 w-auto"
              )}
              priority 
            />
          )}
        </div>

        {/* Plan Info Section */}
        {planInfo && (
          <div className={cn(
            "px-4 py-2 border-b border-sidebar-border",
            collapsed && "md:hidden" // Hide on desktop/tablet when collapsed, but always show on mobile
          )}>
            <div className="text-center space-y-1">
              {/* Plan Name + Frequency */}
              <div className="text-xs text-sidebar-foreground">
                <span className="font-medium">{planInfo.planName}</span>
                <span className="text-sidebar-foreground/60"> · {planInfo.selectedFrequency === 'annual' ? 'Annual' : 'Monthly'}</span>
              </div>
              
              {/* Usage Limits */}
              <div className="flex items-center justify-center gap-3 text-xs text-sidebar-foreground/70">
                <span className="flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  {planInfo.imagePostsLimit}
                </span>
                <span className="flex items-center gap-1">
                  <Video className="w-3 h-3" />
                  {planInfo.videoPostsLimit}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Collapse Toggle Button (Hidden on mobile and when force collapsed) */}
        {!forceCollapsed && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden md:block absolute -right-3 top-20 bg-[hsl(var(--sidebar-wanderlust-selected))] border border-sidebar-border rounded-full p-1 hover:bg-[hsl(var(--sidebar-wanderlust-selected))] hover:brightness-95 transition-colors z-10"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-sidebar-foreground" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-sidebar-foreground" />
            )}
          </button>
        )}

        {/* Navigation - Wanderlust style */}
        <nav className="app-sidebar-nav flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {onCreateAd && (
            <button
              type="button"
              onClick={() => {
                onCreateAd();
                onMobileClose?.();
              }}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-3 mb-3 rounded-xl text-sm font-semibold bg-[hsl(var(--landing-cta-orange))] text-white hover:scale-[1.02] transition-all duration-300",
                collapsed && "md:px-2"
              )}
              style={{ boxShadow: "0 0 20px -5px hsl(25 100% 55% / 0.4)" }}
              title={collapsed ? "Create your ad" : undefined}
            >
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>Create your ad</span>}
            </button>
          )}
          {topLevelItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleMenuItemClick(item.id, item.disabled)}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                activeView === item.id
                  ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                  : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
                collapsed && "md:justify-center md:rounded-lg",
                item.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
              )}
              style={{ fontSize: "var(--sidebar-menu-text-size)" }}
              data-sidebar-menu
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0 opacity-80" />
              <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>{item.label}</span>
            </button>
          ))}

          {/* My Content - collapsible */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setMyContentExpanded(!myContentExpanded)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                activeView === "content-library"
                  ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                  : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
                collapsed && "md:justify-center md:rounded-lg"
              )}
              style={{ fontSize: "var(--sidebar-menu-text-size)" }}
              data-sidebar-menu
            >
              <FolderOpen className="w-5 h-5 flex-shrink-0 opacity-80" />
              <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>My Content</span>
              {myContentExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {myContentExpanded && !collapsed && (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2">
                {myContentSubItems.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => handleMenuItemClick(sub.route, false, sub.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                      activeView === "content-library" && activeSubView === sub.id
                        ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                        : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
                      shouldShowRing(sub.id) && "onboarding-pulse-ring"
                    )}
                    style={{ fontSize: "var(--sidebar-menu-sub-size)" }}
                    data-sidebar-menu
                  >
                    <sub.icon className="w-4 h-4 flex-shrink-0 opacity-80" />
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Brand Kit - collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setBrandKitExpanded(!brandKitExpanded)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                activeView === "brand-kit"
                  ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                  : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
                collapsed && "md:justify-center md:rounded-lg"
              )}
              style={{ fontSize: "var(--sidebar-menu-text-size)" }}
              data-sidebar-menu
            >
              <Palette className="w-5 h-5 flex-shrink-0 opacity-80" />
              <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>Brand Kit</span>
              {brandKitExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {brandKitExpanded && !collapsed && (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-2">
                {brandKitSubItems.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => handleMenuItemClick(sub.route, false, sub.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                      activeView === "brand-kit" && activeSubView === sub.id
                        ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                        : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
                      shouldShowRing(sub.id) && "onboarding-pulse-ring"
                    )}
                    style={{ fontSize: "var(--sidebar-menu-sub-size)" }}
                    data-sidebar-menu
                  >
                    <sub.icon className="w-4 h-4 flex-shrink-0 opacity-80" />
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Bottom section: Settings, Dark Mode, Upgrade, Log out (wanderlust style) */}
        <div className="app-sidebar-nav px-3 py-4 border-t border-sidebar-border space-y-2">
          {/* Settings */}
          <button
            onClick={() => handleMenuItemClick("settings", false)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
              activeView === "settings"
                ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
              collapsed && "md:justify-center md:rounded-lg"
            )}
            style={{ fontSize: "var(--sidebar-menu-text-size)" }}
            data-sidebar-menu
            title={collapsed ? "Settings" : undefined}
          >
            <Settings className="w-5 h-5 flex-shrink-0 opacity-80" />
            <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>Settings</span>
          </button>

          {/* Dark Mode - toggle switch like new UI (Moon + "Dark Mode" + Switch on right) */}
          <div
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg font-normal transition-colors",
              "hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
              collapsed && "md:justify-center md:rounded-lg"
            )}
            style={{ fontSize: "var(--sidebar-menu-text-size)" }}
            data-sidebar-menu
            title={collapsed ? (mounted && resolvedTheme === "dark" ? "Light Theme" : "Dark Theme") : undefined}
          >
            <Moon className="w-5 h-5 flex-shrink-0 opacity-80" />
            <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>
              {mounted && resolvedTheme === "dark" ? "Light Theme" : "Dark Theme"}
            </span>
            {mounted && (
              <Switch
                checked={resolvedTheme === "dark"}
                onCheckedChange={(checked) => {
                  const theme = checked ? "dark" : "light";
                  setTheme(theme);
                  trackThemeChanged(theme);
                }}
                className={cn("shrink-0", collapsed && "md:ml-0")}
              />
            )}
          </div>

          {/* Upgrade Button - inline styles to match new UI (purple-to-pink gradient), no shared class */}
          <button
            onClick={() => {
              trackUpgradeButtonClicked("sidebar");
              setShowPricingModal(true);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 text-base",
              "rounded-full font-semibold text-white border-0",
              "bg-gradient-to-r from-purple-600 to-pink-500",
              "transition-opacity duration-200 hover:opacity-90 active:opacity-95",
              collapsed && "md:justify-center"
            )}
            title={collapsed ? "Upgrade" : undefined}
          >
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <span className={cn(
              "flex-1 text-left",
              collapsed && "md:hidden"
            )}>
              Upgrade
            </span>
          </button>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg font-normal transition-colors",
              "hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
              collapsed && "md:justify-center md:rounded-lg"
            )}
            style={{ fontSize: "var(--sidebar-menu-text-size)" }}
            data-sidebar-menu
            title={collapsed ? "Log out" : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0 opacity-80" />
            <span className={cn(
              "flex-1 text-left",
              collapsed && "md:hidden"
            )}>
              Log out
            </span>
          </button>
        </div>
      </aside>

      {/* Pricing Modal */}
      <PricingModal
        open={showPricingModal}
        onClose={() => setShowPricingModal(false)}
        currentPlanInfo={planInfo ? {
          planName: planInfo.planName,
          planId: planInfo.planId || null,
          monthlyPrice: planInfo.monthlyPrice || 0,
          annualPrice: planInfo.annualPrice || 0,
          billingCycle: planInfo.selectedFrequency,
          isFreeTrialPlan: planInfo.isFreeTrialPlan,
        } : null}
        isAuthenticated={true}
        canSkip={true}
        reason="user_initiated"
        userFlow={planInfo?.initialAcquisitionFlow || 'website_analysis'}
      />
    </>
  );
};
