"use client";

import { useRouter } from "next/navigation";
import { OnboardingTips } from "@/components/onboarding/OnboardingTips";

export default function OnboardingTipsPage() {
  const router = useRouter();

  const handleComplete = () => {
    // Mark onboarding as complete
    localStorage.setItem("dvyb_is_new_account", "false");
    
    // Redirect to home page after completing onboarding tips
    router.push("/home");
  };

  return <OnboardingTips onComplete={handleComplete} />;
}

