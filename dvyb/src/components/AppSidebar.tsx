"use client";

import { useState, useEffect } from "react";
import { 
  Home, 
  Calendar, 
  FileText, 
  Palette,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  ImageIcon,
  Video,
  CreditCard,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi } from "@/lib/api";
import { PricingModal } from "@/components/PricingModal";

interface AppSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  forceCollapsed?: boolean;
  onboardingHighlight?: 'content_library' | 'brand_kit' | null;
  onHighlightClick?: (item: string) => void;
}

const menuItems = [
  { id: "home", label: "Dashboard", icon: Home, disabled: false },
  { id: "calendar", label: "Calendar", icon: Calendar, disabled: false },
  { id: "content-library", label: "Content Library", icon: FolderOpen, disabled: false },
  { id: "brand-plan", label: "Brand Plan", icon: FileText, disabled: true, badge: "coming soon" },
  { id: "brand-kit", label: "Brand Kit", icon: Palette, disabled: false },
  { id: "subscription", label: "Manage Subscription", icon: CreditCard, disabled: false },
];

export const AppSidebar = ({ activeView, onViewChange, isMobileOpen = false, onMobileClose, forceCollapsed = false, onboardingHighlight = null, onHighlightClick }: AppSidebarProps) => {
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

  const handleMenuItemClick = (itemId: string, disabled: boolean) => {
    if (!disabled) {
      onViewChange(itemId);
      // Close mobile drawer when menu item is clicked
      if (onMobileClose) {
        onMobileClose();
      }
      // Notify parent about highlighted item click
      if (onHighlightClick) {
        if (itemId === 'content-library') {
          onHighlightClick('content_library');
        } else if (itemId === 'brand-kit') {
          onHighlightClick('brand_kit');
        }
      }
    }
  };

  // Determine if a menu item should show the onboarding highlight ring
  const shouldShowRing = (itemId: string): boolean => {
    if (itemId === 'content-library' && onboardingHighlight === 'content_library') {
      return true;
    }
    if (itemId === 'brand-kit' && onboardingHighlight === 'brand_kit') {
      return true;
    }
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
          "bg-sidebar border-r border-sidebar-border h-screen flex flex-col transition-all duration-300 relative",
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
            className="hidden md:block absolute -right-3 top-20 bg-sidebar border border-sidebar-border rounded-full p-1 hover:bg-sidebar-accent transition-colors z-10"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-sidebar-foreground" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-sidebar-foreground" />
            )}
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleMenuItemClick(item.id, item.disabled)}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors",
                activeView === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                collapsed && "md:justify-center",
                item.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                shouldShowRing(item.id) && "onboarding-pulse-ring"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className={cn(
                "flex-1 text-left flex items-center gap-2",
                collapsed && "md:hidden"
              )}>
                {item.label}
                {item.badge && (
                  <span className="text-xs text-muted-foreground">({item.badge})</span>
                )}
              </span>
            </button>
          ))}
        </nav>

        {/* Upgrade & Logout Buttons */}
        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          {/* Upgrade Button */}
          <button
            onClick={() => setShowPricingModal(true)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base",
              "btn-upgrade-sidebar",
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
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors",
              "text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive",
              collapsed && "md:justify-center"
            )}
            title={collapsed ? "Log out" : undefined}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
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
