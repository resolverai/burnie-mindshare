"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Lock } from "lucide-react";
import dvybLogo from "@/assets/dvyb-logo.png";

interface ProductShotGenerationProps {
  productPreviewUrl?: string | null;
  onSignupClick: () => void;
  onGenerateMore: () => void;
  generatedImages?: string[];
  isGenerating?: boolean;
  isAuthenticated?: boolean;
}

// Rotating messages shown during generation (before any images appear)
const GENERATION_MESSAGES = [
  { title: "Analyzing your product...", subtitle: "Understanding shape, texture, and details" },
  { title: "Selecting perfect lighting...", subtitle: "Creating professional studio ambiance" },
  { title: "Crafting the scene...", subtitle: "Designing a compelling visual story" },
  { title: "Rendering high-resolution...", subtitle: "Finalizing your product shots" },
  { title: "Adding finishing touches...", subtitle: "Making your product irresistible" },
];

// Special message when first image is about to appear
const ALMOST_READY_MESSAGE = { title: "Almost there...", subtitle: "Your stunning images are nearly ready" };

export const ProductShotGeneration = ({
  productPreviewUrl,
  onSignupClick,
  onGenerateMore,
  generatedImages = [],
  isGenerating = true,
  isAuthenticated = false,
}: ProductShotGenerationProps) => {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  
  // Show signup overlay when not authenticated and not actively generating
  const showSignupOverlay = !isAuthenticated && !isGenerating;

  // Calculate how many images are ready vs pending
  const completedCount = generatedImages.length;
  const totalCount = 4;

  // Rotate through messages during generation (only when no images yet)
  useEffect(() => {
    if (isGenerating && completedCount === 0) {
      const interval = setInterval(() => {
        setCurrentMessageIndex((prev) => (prev + 1) % GENERATION_MESSAGES.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isGenerating, completedCount]);

  // Show "Almost there" only when first image appears, otherwise rotate through regular messages
  const currentMessage = completedCount > 0 ? ALMOST_READY_MESSAGE : GENERATION_MESSAGES[currentMessageIndex];

  return (
    <div 
      className="min-h-screen relative overflow-hidden flex flex-col"
      style={{
        backgroundImage: "url(/onboarding-bg.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Header - matches landing page style */}
      <header className="relative z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="w-24 h-16 md:w-32 md:h-20 flex items-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          {!isAuthenticated && (
            <Button
              className="btn-gradient-cta font-semibold h-9 md:h-10 px-4 md:px-6 rounded-lg text-xs md:text-sm"
              onClick={onSignupClick}
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 pb-16 px-6 flex flex-col items-center justify-center">
        {/* Always show the grid layout */}
        <div className="max-w-6xl mx-auto w-full space-y-12">
          {/* Header Section */}
          <div className="text-center space-y-4">
            {isGenerating ? (
              <>
                {/* Rotating Message during generation */}
                <div 
                  className="backdrop-blur-xl bg-white/40 border border-white/30 rounded-2xl p-6 shadow-lg animate-fade-in max-w-xl mx-auto" 
                  key={currentMessageIndex}
                >
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                      {currentMessage.title}
                    </h2>
                  </div>
                  <p className="text-foreground/60 text-lg">{currentMessage.subtitle}</p>
                </div>
                
                {/* Progress indicator */}
                <p className="text-foreground/50 text-sm">
                  {completedCount > 0 ? `${completedCount} of ${totalCount} shots ready` : "Generating your product shots..."}
                </p>
              </>
            ) : (
              <>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal/10 border border-teal/20">
                  <Sparkles className="w-4 h-4 text-teal" />
                  <span className="text-sm font-medium text-teal">Generation Complete</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-bold text-foreground">
                  Your product shots are ready!
                </h1>
              </>
            )}
          </div>

          {/* Generated Images Grid - Always show 4 slots */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {Array.from({ length: 4 }).map((_, index) => {
              const imageUrl = generatedImages[index];
              const isLoading = isGenerating && !imageUrl;
              
              return (
                <div
                  key={index}
                  className={`aspect-square rounded-2xl overflow-hidden backdrop-blur-xl border border-white/30 shadow-lg transition-all duration-300 ${
                    imageUrl 
                      ? "bg-white/40 hover:shadow-xl hover:scale-[1.02] group" 
                      : "bg-gradient-to-br from-white/20 to-white/10"
                  }`}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`Generated shot ${index + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                      {isLoading ? (
                        <>
                          <div className="w-12 h-12 rounded-xl bg-white/30 animate-pulse flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
                          </div>
                          <div className="h-2 w-16 bg-white/30 rounded animate-pulse" />
                        </>
                      ) : (
                        <Sparkles className="w-8 h-8 text-foreground/30" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Product Preview - Show small thumbnail during generation */}
          {isGenerating && productPreviewUrl && (
            <div className="flex items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-xl overflow-hidden backdrop-blur-xl bg-white/40 border border-white/30 shadow-lg">
                <img
                  src={productPreviewUrl}
                  alt="Your product"
                  className="w-full h-full object-contain p-2"
                />
              </div>
              <p className="text-foreground/50 text-sm">Your product is being transformed...</p>
            </div>
          )}

          {/* Progress Dots */}
          {isGenerating && (
            <div className="flex items-center justify-center gap-2">
              {GENERATION_MESSAGES.map((_, index) => (
                <div
                  key={index}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    index === currentMessageIndex
                      ? "bg-primary w-8"
                      : index < currentMessageIndex
                      ? "bg-primary/50 w-2"
                      : "bg-foreground/20 w-2"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Action Button - Show when authenticated, enable only when all 4 images are done */}
          {isAuthenticated && (
            <div className="text-center">
              <Button
                onClick={onGenerateMore}
                size="lg"
                disabled={isGenerating || generatedImages.length < 4}
                className={`btn-gradient-cta py-6 px-10 text-lg rounded-2xl ${
                  (isGenerating || generatedImages.length < 4) ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <Sparkles className="w-5 h-5 mr-2" />
                {isGenerating ? "Generating..." : "Generate More Shots"}
              </Button>
              {isGenerating && generatedImages.length > 0 && (
                <p className="text-foreground/50 text-sm mt-3">
                  {generatedImages.length} of 4 shots complete
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Signup Overlay */}
      {showSignupOverlay && !isAuthenticated && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Blurred Background */}
          <div className="absolute inset-0 backdrop-blur-xl bg-black/40" />

          {/* Signup Modal */}
          <div className="relative z-10 max-w-md w-full mx-6 p-8 rounded-3xl backdrop-blur-xl bg-white/90 border border-white/50 shadow-2xl">
            <div className="text-center space-y-6">
              {/* Lock Icon */}
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-teal/20 flex items-center justify-center border border-primary/20">
                <Lock className="w-8 h-8 text-primary" />
              </div>

              {/* Title */}
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Sign up to generate</h2>
                <p className="text-foreground/60">
                  Create a free account to generate your product shots and unlock all features.
                </p>
              </div>

              {/* Benefits */}
              <div className="text-left space-y-3 py-4">
                {[
                  "Generate 4 stunning product variations",
                  "Download high-resolution images",
                  "Access all studio styles",
                  "Save to your brand library",
                ].map((benefit, index) => (
                  <div key={index} className="flex items-center gap-3 text-foreground/70">
                    <div className="w-5 h-5 rounded-full bg-teal/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-teal" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm">{benefit}</span>
                  </div>
                ))}
              </div>

              {/* Signup Button */}
              <Button
                onClick={onSignupClick}
                size="lg"
                className="w-full btn-gradient-cta py-6 text-lg rounded-2xl"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign up with Google
              </Button>

              <p className="text-xs text-foreground/40">
                No credit card required
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
