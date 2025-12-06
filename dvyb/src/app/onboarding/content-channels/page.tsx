"use client";

import { useRouter } from "next/navigation";
import { ContentChannels } from "@/components/onboarding/ContentChannels";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export default function ContentChannelsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Redirect to landing page if not authenticated
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleComplete = () => {
    // Redirect to content generation animation page
    router.push("/onboarding/content-generation");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <ContentChannels onComplete={handleComplete} />;
}

