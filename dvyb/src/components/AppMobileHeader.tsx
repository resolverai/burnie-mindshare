"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu, Moon, Sparkles, Settings, LogOut, ImageIcon, Video } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useTheme } from "next-themes";
import { trackThemeChanged, trackUpgradeButtonClicked } from "@/lib/mixpanel";

export interface PlanInfo {
  planName: string;
  selectedFrequency: "monthly" | "annual";
  imagePostsLimit: number;
  videoPostsLimit: number;
}

interface AppMobileHeaderProps {
  planInfo: PlanInfo | null;
  onUpgrade: () => void;
  onLogout: () => void;
  logoUrl?: string | null;
}

export function AppMobileHeader({ planInfo, onUpgrade, onLogout, logoUrl }: AppMobileHeaderProps) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSettingsClick = () => {
    setIsOpen(false);
    router.push("/subscription/manage");
  };

  const handleUpgradeClick = () => {
    setIsOpen(false);
    trackUpgradeButtonClicked("mobile_header");
    onUpgrade();
  };

  const handleLogoutClick = () => {
    setIsOpen(false);
    onLogout();
  };

  return (
    <header className="sticky top-0 bg-[hsl(var(--app-content-bg))] border-b border-border z-40 lg:hidden">
      <div className="flex items-center justify-between w-full px-4 py-3">
        {/* Left: Logo / Plan name only (minimal header like wander) */}
        <div className="flex items-center gap-3 min-w-0">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="w-10 h-10 rounded-xl object-contain bg-muted/50 flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              <Image src={dvybLogo} alt="Dvyb" width={32} height={32} className="object-contain" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">
              {planInfo?.planName ?? "Dvyb"}
            </p>
            <p className="text-xs text-muted-foreground">
              {planInfo?.selectedFrequency === "annual" ? "Annual" : "Monthly"}
            </p>
          </div>
        </div>

        {/* Right: Hamburger only. Mobile/tablet: drawer opens from right, closed by default. */}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <button className="ml-auto flex-shrink-0 p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Open menu">
              <Menu className="w-6 h-6" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 p-0">
            <div className="flex flex-col h-full">
              {/* Header with plan */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="w-12 h-12 rounded-xl object-contain bg-muted/50"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                      <Image src={dvybLogo} alt="Dvyb" width={40} height={40} className="object-contain" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{planInfo?.planName ?? "Dvyb"}</p>
                    <p className="text-xs text-muted-foreground">
                      {planInfo?.selectedFrequency === "annual" ? "Annual" : "Monthly"}
                    </p>
                    {planInfo && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" />
                          {planInfo.imagePostsLimit}
                        </span>
                        <span className="flex items-center gap-1">
                          <Video className="w-3 h-3" />
                          {planInfo.videoPostsLimit}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="flex-1 p-4 space-y-2">
                {/* Dark Mode Toggle */}
                <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-muted/50">
                  <Moon className="w-5 h-5 text-muted-foreground" />
                  <span className="flex-1 text-sm">Dark Mode</span>
                  {mounted && (
                    <Switch
                      checked={resolvedTheme === "dark"}
                      onCheckedChange={(checked) => {
                        const theme = checked ? "dark" : "light";
                        setTheme(theme);
                        trackThemeChanged(theme);
                      }}
                      className="shrink-0"
                    />
                  )}
                </div>

                {/* Upgrade Button */}
                <button
                  onClick={handleUpgradeClick}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 transition-opacity"
                >
                  <Sparkles className="w-5 h-5 flex-shrink-0" />
                  <span>Upgrade Plan</span>
                </button>

                {/* Settings */}
                <button
                  onClick={handleSettingsClick}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                >
                  <Settings className="w-5 h-5 flex-shrink-0" />
                  <span>Settings</span>
                </button>

                {/* Logout */}
                <button
                  onClick={handleLogoutClick}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                >
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
