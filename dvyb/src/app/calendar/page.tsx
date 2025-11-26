"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarView } from "@/components/calendar/CalendarView";
import { Loader2 } from "lucide-react";

export default function CalendarPage() {
  const router = useRouter();
  const { isAuthenticated, accountId, isLoading } = useAuth();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (isLoading) return;

      if (!isAuthenticated || !accountId) {
        // Redirect to home if not authenticated
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

  if (isLoading || isCheckingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return <CalendarView />;
}

