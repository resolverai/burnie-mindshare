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
import { useTheme } from "next-themes";
import { Loader2, Menu, Sun, Moon } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Home", path: "/" },
  { name: "Explore", path: "/explore" },
  { name: "Pricing", path: "/pricing" },
  { name: "Affiliates", path: "/affiliates" },
];

interface NavigationLandingProps {
  variant?: "default" | "dark";
  onGetStarted?: () => void;
  /** Show Sign In (existing users only) - only on new landing page, not Explore etc. */
  showSignIn?: boolean;
  /** Hide Explore tab - used on new landing page */
  hideExplore?: boolean;
  /** Show theme toggle (dark/light) in header */
  showThemeToggle?: boolean;
  /** Nav style: "wander" = flat layout, active pill only, Sign In orange (matches wander-and-seek) */
  navStyle?: "default" | "wander";
}

const MOBILE_NAV_LINKS = [
  { name: "Home", path: "/" },
  { name: "Pricing", path: "/pricing" },
  { name: "Explore", path: "/explore" },
  { name: "Affiliates", path: "/affiliates" },
];

export function NavigationLanding({ variant = "default", onGetStarted, showSignIn = false, hideExplore = false, showThemeToggle = false, navStyle = "default" }: NavigationLandingProps) {
  const pathname = usePathname();
  const isDark = variant === "dark";
  const { isAuthenticated, isLoading } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [signInChoiceOpen, setSignInChoiceOpen] = useState(false);
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
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div
        className={cn(
          "container mx-auto relative",
          navStyle === "wander" ? "px-6 sm:px-12 py-7 sm:py-10" : "px-4 sm:px-6 py-3 sm:py-4"
        )}
      >
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
                  {showThemeToggle && (
                    <button
                      type="button"
                      onClick={() => {
                        setTheme(resolvedTheme === "dark" ? "light" : "dark");
                        setMobileNavOpen(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                    >
                      {resolvedTheme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                      {resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    </button>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
            {navStyle !== "wander" && (
              <Link href="/" className="shrink-0 transition-opacity hover:opacity-90">
                <Image
                  src={dvybLogo}
                  alt="dvyb.ai"
                  width={200}
                  height={80}
                  className={cn(
                    "h-10 sm:h-14 md:h-20 w-auto object-contain",
                    resolvedTheme === "dark" ? "brightness-0 invert" : "brightness-0"
                  )}
                  priority
                />
              </Link>
            )}
          </div>

          <div
            className={cn(
              "hidden sm:flex items-center absolute left-1/2 -translate-x-1/2 z-10",
              navStyle === "wander" && "font-hind font-light text-[15px] gap-6",
              navStyle !== "wander" && "gap-1 bg-secondary/50 rounded-full p-1.5 backdrop-blur-sm border border-border/50"
            )}
          >
            {navStyle === "wander" ? (
              <div
                className={cn(
                  "flex items-center rounded-full p-1.5 gap-1",
                  isDark ? "bg-black/30 border border-white/25" : "bg-secondary/60 border border-black/10"
                )}
              >
                {navLinks.map((item) => (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={cn(
                      "text-[15px] transition-all duration-300",
                      pathname === item.path
                        ? isDark
                          ? "px-4 py-2 rounded-full bg-black text-white border border-white/20"
                          : "px-4 py-2 rounded-full bg-foreground text-background border border-foreground/20"
                        : isDark
                          ? "text-white/60 hover:text-white px-4 py-2 rounded-full"
                          : "text-muted-foreground hover:text-foreground px-4 py-2 rounded-full"
                    )}
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            ) : (
              <>
            {navLinks.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "text-sm font-medium transition-all duration-300 px-4 sm:px-5 py-2 rounded-full",
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
              </>
            )}
            {navStyle === "wander" && showSignIn && !isLoading && !isAuthenticated && (
              <button
                type="button"
                onClick={() => setSignInChoiceOpen(true)}
                disabled={isSigningIn}
                className="font-hind font-light text-[15px] text-cta hover:text-cta/90 transition-opacity"
              >
                Sign In
              </button>
            )}
            {navStyle === "wander" && showThemeToggle && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0 z-10">
            {showThemeToggle && navStyle === "wander" && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="sm:hidden p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            )}
            {showThemeToggle && navStyle !== "wander" && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            )}
            {showSignIn && navStyle !== "wander" && !isLoading && !isAuthenticated && (
              <button
                type="button"
                onClick={() => setSignInChoiceOpen(true)}
                disabled={isSigningIn}
                className={cn(
                  "px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-sm font-medium transition-opacity",
                  isDark
                    ? "text-white/70 hover:text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Sign In
              </button>
            )}
            {navStyle !== "wander" && (
            <button
              type="button"
              onClick={onGetStarted}
              className="px-4 sm:px-6 py-2 sm:py-2.5 bg-cta text-cta-foreground rounded-full text-sm font-semibold hover:scale-105 transition-all duration-300 shrink-0"
              style={{ boxShadow: "0 0 20px -5px hsl(25 100% 55% / 0.4)" }}
            >
              Get Started
            </button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={signInChoiceOpen} onOpenChange={setSignInChoiceOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-4 sm:p-6 rounded-xl sm:rounded-lg">
          <p className="text-center text-foreground text-sm sm:text-base px-1">
            If you have an account with us, press <strong>Proceed</strong>. Otherwise, press <strong>Get Started</strong>.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4 sm:mt-6">
            <Button
              type="button"
              onClick={() => {
                setSignInChoiceOpen(false);
                onGetStarted?.();
              }}
              className="w-full sm:w-auto rounded-full px-6 py-2.5 bg-[hsl(var(--landing-cta-orange))] text-white hover:opacity-90 border-0 font-medium"
            >
              Get Started
            </Button>
            <Button
              type="button"
              onClick={() => {
                setSignInChoiceOpen(false);
                handleSignIn();
              }}
              disabled={isSigningIn}
              className="w-full sm:w-auto rounded-full px-6 py-2.5 bg-black text-white hover:bg-black/90 border-0 font-medium"
            >
              {isSigningIn ? <Loader2 className="w-4 h-4 animate-spin" /> : "Proceed"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
