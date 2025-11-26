"use client";

import { useRouter } from "next/navigation";
import { ContentGeneration } from "@/components/onboarding/ContentGeneration";

export default function ContentGenerationPage() {
  const router = useRouter();

  const handleComplete = () => {
    // Redirect to topic review page after content generation animation
    router.push("/onboarding/topic-review");
  };

  return <ContentGeneration onComplete={handleComplete} />;
}

