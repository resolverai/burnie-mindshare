"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Building2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Moon,
  Link2,
  Copy,
  Check,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useAffiliateAuth } from "@/contexts/AffiliateAuthContext";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface AffiliateSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, route: "/affiliates/dashboard" },
  { id: "referred-users", label: "Referred Users", icon: Users, route: "/affiliates/referred-users" },
  { id: "revenue", label: "Revenue", icon: DollarSign, route: "/affiliates/revenue" },
  { id: "banking", label: "Banking Details", icon: Building2, route: "/affiliates/banking" },
];

export const AffiliateSidebar = ({ activeView, onViewChange, isMobileOpen = false, onMobileClose }: AffiliateSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined") return window.innerWidth < 1024;
    return false;
  });
  const [referralCopied, setReferralCopied] = useState(false);
  const { affiliateName, profilePicture, referralCode, commissionTier, commissionRate, logout } = useAffiliateAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleCopyReferral = async () => {
    if (!referralCode) return;
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3005";
    const link = `${frontendUrl}?ref=${referralCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      /* fallback: do nothing */
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn("p-4 flex items-center border-b border-sidebar-border", isCollapsed ? "justify-center p-2" : "gap-3")}>
        <Image src={dvybLogo} alt="dvyb.ai" width={120} height={48} className={cn("object-contain", isCollapsed ? "h-8 w-8" : "h-12 w-auto")} priority />
        {!isCollapsed && (
          <span className="text-base font-semibold text-[hsl(var(--landing-cta-orange))]">
            Affiliates
          </span>
        )}
      </div>

      {/* Affiliate Info */}
      {!isCollapsed && (
        <div className="mx-4 mb-4 p-3 rounded-xl bg-secondary/50 border border-border/30">
          <div className="flex items-center gap-3 mb-2">
            {profilePicture ? (
              <img src={profilePicture} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--landing-cta-orange))/0.2] flex items-center justify-center text-sm font-bold text-[hsl(var(--landing-cta-orange))]">
                {affiliateName?.[0] || "A"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{affiliateName || "Affiliate"}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {commissionTier} &middot; {commissionRate}% commission
              </p>
            </div>
          </div>
          {referralCode && (
            <button
              type="button"
              onClick={handleCopyReferral}
              className="w-full flex items-center justify-between gap-2 mt-2 px-3 py-2 rounded-lg bg-background border border-border/50 text-xs hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground truncate">{referralCode}</span>
              </div>
              {referralCopied ? (
                <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="app-sidebar-nav flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onViewChange(item.id);
                onMobileClose?.();
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                isCollapsed && "justify-center",
                isActive
                  ? "bg-[hsl(var(--sidebar-wanderlust-selected))] font-medium"
                  : "font-normal hover:bg-[hsl(var(--sidebar-wanderlust-hover))]"
              )}
              style={{ fontSize: "var(--sidebar-menu-text-size)" }}
              data-sidebar-menu
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0 opacity-80" />
              {!isCollapsed && <span className="flex-1 text-left">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="app-sidebar-nav px-3 py-4 border-t border-sidebar-border space-y-2 mt-auto">
        {/* Dark Mode Toggle */}
        {mounted && (
          <div
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg font-normal transition-colors",
              "hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
              isCollapsed && "justify-center"
            )}
            style={{ fontSize: "var(--sidebar-menu-text-size)" }}
            data-sidebar-menu
          >
            <Moon className="w-5 h-5 flex-shrink-0 opacity-80" />
            {!isCollapsed && (
              <span className="flex-1 text-left">Dark Mode</span>
            )}
            <Switch
              checked={resolvedTheme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              className="shrink-0"
            />
          </div>
        )}

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-3 rounded-lg font-normal transition-colors",
            "hover:bg-[hsl(var(--sidebar-wanderlust-hover))]",
            isCollapsed && "justify-center"
          )}
          style={{ fontSize: "var(--sidebar-menu-text-size)" }}
          data-sidebar-menu
        >
          <LogOut className="w-5 h-5 flex-shrink-0 opacity-80" />
          {!isCollapsed && <span className="flex-1 text-left">Log Out</span>}
        </button>
      </div>

      {/* Collapse Toggle (desktop only) */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="hidden lg:flex absolute right-0 top-20 -translate-y-1/2 translate-x-1/2 z-[110] items-center justify-center w-7 h-7 rounded-full bg-[hsl(var(--sidebar-wanderlust-selected))] border-2 border-sidebar-border shadow-md hover:bg-[hsl(var(--sidebar-wanderlust-selected))] hover:brightness-95 transition-colors"
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 text-sidebar-foreground" /> : <ChevronLeft className="w-4 h-4 text-sidebar-foreground" />}
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile Header */}
      <header className="sticky top-0 bg-[hsl(var(--app-content-bg))] border-b border-border z-40 lg:hidden">
        <div className="flex items-center justify-between w-full px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              <Image src={dvybLogo} alt="Dvyb" width={32} height={32} className="object-contain" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">Affiliates</p>
              {commissionTier && (
                <p className="text-xs text-muted-foreground capitalize">{commissionTier} &middot; {commissionRate}%</p>
              )}
            </div>
          </div>
          <button type="button" onClick={() => onViewChange("__toggle_mobile__")} className="ml-auto flex-shrink-0 p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Open menu">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={isMobileOpen} onOpenChange={(open) => !open && onMobileClose?.()}>
        <SheetContent side="right" className="w-[280px] p-0 bg-[hsl(var(--sidebar-wanderlust-bg))]">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0 lg:order-1 order-4 relative z-30 overflow-visible">
        <aside
          className={cn(
            "bg-[hsl(var(--sidebar-wanderlust-bg))] border-r border-sidebar-border h-screen flex flex-col transition-all duration-300 relative overflow-visible",
            isCollapsed ? "w-16" : "w-64"
          )}
        >
          <SidebarContent />
        </aside>
      </div>
    </>
  );
};
