"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { BrandKit } from "@/components/onboarding/BrandKit";
import { Loader2 } from "lucide-react";

export default function BrandProfilePage() {
  const { isAuthenticated, isLoading, checkAuth } = useAuth();
  const router = useRouter();
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Always re-check authentication with backend
    checkAuth();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        console.log('❌ Not authenticated, redirecting to login');
        // Redirect to login if not authenticated
        router.push('/auth/login');
      } else {
        console.log('✅ Authenticated, showing Brand Kit');
        setShowContent(true);
      }
    }
  }, [isAuthenticated, isLoading, router]);

  const handleContinue = () => {
    // Mark onboarding as complete (skip all intermediate steps)
    localStorage.setItem("dvyb_is_new_account", "false");
    
    // Navigate directly to home (hassle-free onboarding!)
    router.push('/home');
  };

  if (isLoading || !showContent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
        <p className="mt-4 text-base md:text-lg text-muted-foreground text-center px-4">
          Loading your Brand Kit...
        </p>
      </div>
    );
  }

  return <BrandKit onContinue={handleContinue} />;
}

