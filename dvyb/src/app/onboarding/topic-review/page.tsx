"use client";

import { useRouter } from "next/navigation";
import { TopicReview } from "@/components/onboarding/TopicReview";

export default function TopicReviewPage() {
  const router = useRouter();

  const handleComplete = () => {
    // Redirect to onboarding tips after topic review
    router.push("/onboarding/tips");
  };

  return <TopicReview onComplete={handleComplete} />;
}

