"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import dvybLogo from "@/assets/dvyb-logo.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { authApi } from "@/lib/api";
import { trackSignInClicked } from "@/lib/mixpanel";
import { Loader2, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { name: "Home", path: "/" },
  { name: "Explore", path: "/explore" },
  { name: "Pricing", path: "/pricing" },
];

interface NavigationLandingProps {
  variant?: "default" | "dark";
  onGetStarted?: () => void;
  /** Show Sign In (existing users only) - only on new landing page, not Explore etc. */
  showSignIn?: boolean;
  /** Hide Explore tab - used on new landing page */
  hideExplore?: boolean;
}

const MOBILE_NAV_LINKS = [
  { name: "Home", path: "/" },
  { name: "Pricing", path: "/pricing" },
  { name: "Explore", path: "/explore" },
];

export function NavigationLanding({ variant = "default", onGetStarted, showSignIn = false, hideExplore = false }: NavigationLandingProps) {
  const pathname = usePathname();
  const isDark = variant === "dark";
  const { isAuthenticated, isLoading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navLinks = hideExplore ? navItems.filter((i) => i.path !== "/explore") : navItems;
  const mobileLinks = hideExplore ? MOBILE_NAV_LINKS.filter((i) => i.path !== "/explore") : MOBILE_NAV_LINKS;

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    trackSignInClicked("google", "landing_page");
    try {
      localStorage.removeItem("dvyb_google_oauth_state");
      // Redirect to discover screen after successful login when account is found
      localStorage.setItem("dvyb_oauth_return_url", "/discover");
      localStorage.setItem("dvyb_oauth_platform", "google");
      const response = await authApi.getGoogleLoginUrl({ signInOnly: true });
      if (response.success && response.data.oauth_url) {
        if (response.data.state) {
          localStorage.setItem("dvyb_google_oauth_state", response.data.state);
        }
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setIsSigningIn(false);
    }
  };

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/50"
      )}
    >
      <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 relative">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 z-10">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="sm:hidden p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="w-6 h-6" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] sm:w-[300px]">
                <nav className="flex flex-col gap-1 pt-8">
                  {mobileLinks.map((item) => (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={() => setMobileNavOpen(false)}
                      className={cn(
                        "px-4 py-3 rounded-lg text-base font-medium transition-colors",
                        pathname === item.path ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      {item.name}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
            <Link href="/" className="shrink-0 transition-opacity hover:opacity-90">
              <Image src={dvybLogo} alt="dvyb.ai" width={200} height={80} className="h-10 sm:h-14 md:h-20 w-auto object-contain" priority />
            </Link>
          </div>

          <div className="hidden sm:flex items-center gap-1 bg-secondary/50 rounded-full p-1.5 backdrop-blur-sm border border-border/50 absolute left-1/2 -translate-x-1/2 z-10">
            {navLinks.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all duration-300",
                  pathname === item.path
                    ? isDark
                      ? "bg-white/20 text-white shadow-soft"
                      : "bg-white text-foreground shadow-soft"
                    : isDark
                      ? "text-white/70 hover:text-white"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0 z-10">
            {showSignIn && !isLoading && !isAuthenticated && (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={isSigningIn}
                className={cn(
                  "px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-sm font-medium transition-opacity",
                  isDark
                    ? "text-white/70 hover:text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Sign In"
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onGetStarted}
              className="px-4 sm:px-6 py-2 sm:py-2.5 bg-cta text-cta-foreground rounded-full text-sm font-semibold hover:scale-105 transition-all duration-300 shrink-0"
              style={{ boxShadow: "0 0 20px -5px hsl(25 100% 55% / 0.4)" }}
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
