"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { StrategyCalendarView } from "@/components/calendar/StrategyCalendarView";
import { AppSidebar } from "@/components/AppSidebar";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function CalendarPage() {
  const router = useRouter();
  const { isAuthenticated, accountId, isLoading } = useAuth();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [activeView] = useState("calendar");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (isLoading) return;

      if (!isAuthenticated || !accountId) {
        // Redirect to landing page if not authenticated
        router.push("/");
        return;
      }

      // Check if onboarding is complete by checking localStorage
      // If user just completed onboarding, is_new_account would be in localStorage
      const isNewAccount = localStorage.getItem("dvyb_is_new_account");
      
      if (isNewAccount === "true") {
        // First time landing - onboarding just completed
        console.log("✅ First time user - onboarding completed");
        // Clear the flag
        localStorage.removeItem("dvyb_is_new_account");
      }

      setIsCheckingOnboarding(false);
    };

    checkOnboardingStatus();
  }, [isAuthenticated, accountId, isLoading, router]);

  const handleViewChange = (view: string) => {
    if (view === "home") router.push("/home");
    else if (view === "content-library") router.push("/content-library");
    else if (view === "brand-kit") router.push("/brand-kit");
    else if (view === "subscription") router.push("/subscription/manage");
    else if (view === "brand-plan") return; // Disabled
    // calendar is current page, no navigation needed
  };

  if (isLoading || isCheckingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
          <p className="text-base md:text-lg text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <AppSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header with Hamburger */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-foreground" />
          </button>
          
          <div className="flex items-center gap-2">
            <Image src={dvybLogo} alt="Dvyb Logo" width={80} height={32} className="object-contain" priority />
          </div>
          
          {/* Empty div for spacing */}
          <div className="w-10" />
        </div>

        {/* Strategy Calendar View */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <StrategyCalendarView />
        </div>
      </div>
    </div>
  );
}

