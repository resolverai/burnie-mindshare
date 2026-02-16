"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { affiliateAuthApi } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";

function AffiliateLoginInner() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentRef = searchParams.get("ref");

  useEffect(() => {
    // Check if already authenticated
    affiliateAuthApi.getAuthStatus().then((res) => {
      if (res.success && res.data.authenticated) {
        router.push("/affiliates/dashboard");
      }
    }).catch(() => {});
  }, [router]);

  const handleGoogleLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      // Store parent referral code if present
      if (parentRef) {
        localStorage.setItem("dvyb_affiliate_parent_ref", parentRef);
      }

      const response = await affiliateAuthApi.getGoogleLoginUrl();
      if (response.success && response.data.oauth_url) {
        localStorage.setItem("dvyb_affiliate_oauth_state", response.data.state);
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err) {
      console.error("Affiliate login error:", err);
      setError("Failed to initiate login. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel - branding */}
      <div className="lg:w-1/2 bg-foreground text-background p-8 lg:p-16 flex flex-col justify-center relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute top-8 left-8 w-32 h-32 border-2 border-muted-foreground/20 rounded-full" />
        <div className="absolute bottom-8 right-8 w-48 h-48 border-2 border-muted-foreground/20 rounded-full" />
        <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-muted-foreground/10 rounded-full" />

        <div className="relative z-10">
          <a
            href="/affiliates"
            className="text-sm text-muted-foreground hover:text-background/80 transition-colors mb-8 inline-block"
          >
            Get to know us more &rarr;
          </a>

          <div className="mb-6">
            <Image src={dvybLogo} alt="dvyb.ai" width={120} height={48} className="h-10 w-auto brightness-0 invert object-contain" />
          </div>

          <h1 className="text-3xl lg:text-4xl font-bold mb-4 leading-tight">
            Welcome to
            <br />
            dvyb&apos;s Affiliate
            <br />
            Program
          </h1>

          <p className="text-lg text-[hsl(var(--landing-cta-orange))] font-semibold mt-4">
            Earn 40% on all paid customers &#x26A1;
          </p>
        </div>
      </div>

      {/* Right panel - login form */}
      <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-background">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-foreground mb-2">Log in or Sign up</h2>
          <p className="text-muted-foreground mb-8">
            Sign in with your Google account to get started as an affiliate.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 border border-border rounded-xl bg-card hover:bg-secondary/50 transition-all duration-200 text-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <p className="mt-6 text-xs text-muted-foreground text-center">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AffiliateLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>}>
      <AffiliateLoginInner />
    </Suspense>
  );
}
