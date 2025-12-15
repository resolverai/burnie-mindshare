"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { Loader2, Menu } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export default function BrandPlanPage() {
  const [activeView] = useState("brand-plan");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Redirect to landing page instead of login
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleViewChange = (view: string) => {
    if (view === "home") router.push("/home");
    else if (view === "calendar") router.push("/calendar");
    else if (view === "content-library") router.push("/content-library");
    else if (view === "brand-kit") router.push("/brand-kit");
    else if (view === "subscription") router.push("/subscription/manage");
  };

  if (isLoading || !isAuthenticated) {
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

        {/* Header - Desktop only */}
        <header className="hidden md:flex items-center justify-between px-4 md:px-8 py-4 md:py-6 border-b border-border bg-background">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-16 md:w-32 md:h-24">
                <Image src={dvybLogo} alt="Dvyb Logo" fill className="object-contain" priority />
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 md:p-8">
            <div className="text-center py-20">
              <h1 className="text-3xl font-bold text-foreground mb-4">Brand Plan</h1>
              <p className="text-muted-foreground">Coming soon...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

