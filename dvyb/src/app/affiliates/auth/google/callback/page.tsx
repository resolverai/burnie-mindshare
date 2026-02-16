"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { affiliateAuthApi } from "@/lib/api";
import { Loader2 } from "lucide-react";

function AffiliateGoogleCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      // If session was already established (e.g. by a prior mount in Strict Mode),
      // skip the API call and go straight to dashboard
      const existingSession = localStorage.getItem("dvyb_affiliate_session_active");
      const existingId = localStorage.getItem("dvyb_affiliate_id");
      if (existingSession === "true" && existingId) {
        router.replace("/affiliates/dashboard");
        return;
      }

      const code = searchParams.get("code");
      const state = searchParams.get("state");

      if (!code || !state) {
        setError("Missing authentication parameters");
        return;
      }

      try {
        const parentRef = localStorage.getItem("dvyb_affiliate_parent_ref");
        const response = await affiliateAuthApi.handleGoogleCallback(
          code,
          state,
          parentRef || undefined
        );

        if (response.success && response.data.affiliate) {
          const affiliate = response.data.affiliate;
          localStorage.setItem("dvyb_affiliate_id", String(affiliate.id));
          localStorage.setItem("dvyb_affiliate_session_active", "true");
          localStorage.removeItem("dvyb_affiliate_parent_ref");
          localStorage.removeItem("dvyb_affiliate_oauth_state");

          // Set cookie for session
          const isProduction = window.location.protocol === "https:";
          const cookieOptions = isProduction
            ? "path=/; max-age=604800; SameSite=None; Secure"
            : "path=/; max-age=604800; SameSite=Lax";
          document.cookie = `dvyb_affiliate_id=${affiliate.id}; ${cookieOptions}`;

          router.replace("/affiliates/dashboard");
        } else {
          setError("Authentication failed. Please try again.");
        }
      } catch (err) {
        console.error("Affiliate callback error:", err);
        // Don't show error if session was established by a concurrent call
        const sessionEstablished = localStorage.getItem("dvyb_affiliate_session_active");
        if (sessionEstablished === "true") {
          router.replace("/affiliates/dashboard");
        } else {
          setError("Authentication failed. Please try again.");
        }
      }
    };

    handleCallback();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <a href="/affiliates/login" className="text-[hsl(var(--landing-cta-orange))] hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--landing-cta-orange))]" />
      <p className="mt-4 text-muted-foreground">Setting up your affiliate account...</p>
    </div>
  );
}

export default function AffiliateGoogleCallback() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AffiliateGoogleCallbackInner />
    </Suspense>
  );
}
