"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { authApi } from "@/lib/api";
import { trackSignInClicked } from "@/lib/mixpanel";
import dvybLogo from "@/assets/dvyb-logo.png";

const COPY_A_SIGNUP_BG_DARK =
  "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(240 10% 12%) 0%, hsl(240 10% 4%) 60%), hsl(240 10% 4%)";

interface CopyASignUpScreenProps {
  onContinue: () => void;
  isDarkTheme?: boolean;
}

export function CopyASignUpScreen({ onContinue, isDarkTheme = true }: CopyASignUpScreenProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignUp = async () => {
    if (isLoading) return;
    setIsLoading(true);
    trackSignInClicked("google", "landing_page", { copy: "A" });
    try {
      localStorage.removeItem("dvyb_google_oauth_state");
      localStorage.setItem("dvyb_oauth_return_url", "/");
      localStorage.setItem("dvyb_oauth_platform", "google");
      localStorage.setItem("dvyb_landing_onboarding_flow_pending", "true");
      const response = await authApi.getGoogleLoginUrl({ signInOnly: false });
      if (response.success && response.data.oauth_url) {
        if (response.data.state) {
          localStorage.setItem("dvyb_google_oauth_state", response.data.state);
        }
        window.location.href = response.data.oauth_url;
      } else {
        throw new Error("Failed to get Google login URL");
      }
    } catch (err) {
      console.error("Google sign up error:", err);
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 pt-24 pb-12"
      style={{
        background: isDarkTheme ? COPY_A_SIGNUP_BG_DARK : "var(--gradient-hero)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="flex justify-center mb-8">
          <Image src={dvybLogo} alt="dvyb" className="h-8 w-auto" width={120} height={32} />
        </div>

        <div
          className={`rounded-2xl backdrop-blur-sm p-8 ${isDarkTheme ? "border border-white/10 bg-white/[0.03]" : "border border-border bg-card"}`}
        >
          <h2 className="text-2xl font-display font-semibold text-foreground text-center mb-2">
            Create your account
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-8">
            Start creating ads in minutes
          </p>

          <button
            type="button"
            onClick={handleGoogleSignUp}
            disabled={isLoading}
            className={`w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-foreground text-sm font-medium transition-colors disabled:opacity-50 ${isDarkTheme ? "border border-white/10 bg-white/[0.05] hover:bg-white/[0.08]" : "border border-input bg-secondary hover:bg-secondary/80"}`}
          >
            <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            {isLoading ? "Connecting…" : "Continue with Google"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
