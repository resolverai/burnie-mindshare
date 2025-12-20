"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Sparkles, ArrowRight } from "lucide-react";

function SubscriptionSuccessContent() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Wait a moment for webhook to process
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleContinue = () => {
    // Clear any remaining product flow flags
    localStorage.removeItem("dvyb_landing_flow");
    localStorage.removeItem("dvyb_product_flow_pending");
    localStorage.removeItem("dvyb_product_shot_s3_key");
    localStorage.removeItem("dvyb_product_preview_url");
    localStorage.removeItem("dvyb_product_shot_job_id");
    
    // Redirect based on flow - both flows now go to content-library
    router.push('/content-library');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">
        {isLoading ? (
          <>
            <div className="flex justify-center">
              <Loader2 className="h-16 w-16 text-primary animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Processing your subscription...
            </h1>
            <p className="text-muted-foreground">
              Please wait while we activate your plan.
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse" />
                <CheckCircle className="relative h-20 w-20 text-green-500" />
              </div>
            </div>
            
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">
                Subscription Activated! 🎉
              </h1>
              <p className="text-muted-foreground text-lg">
                Thank you for upgrading your plan.
              </p>
            </div>

            <div className="bg-muted/50 rounded-xl p-6 space-y-4 border border-border">
              <div className="flex items-center justify-center gap-2 text-primary">
                <Sparkles className="h-5 w-5" />
                <span className="font-medium">Your new features are ready!</span>
              </div>
              <ul className="text-left text-sm text-muted-foreground space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  Additional content generation credits
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  Priority content processing
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  Full access to all features
                </li>
              </ul>
            </div>

            <Button 
              onClick={handleContinue}
              size="lg" 
              className="w-full py-6 text-lg font-semibold"
            >
              Continue to Content Library
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Loader2 className="h-16 w-16 text-primary animate-spin" />
      </div>
    }>
      <SubscriptionSuccessContent />
    </Suspense>
  );
}

