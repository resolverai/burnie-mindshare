"use client";

import { useRef, useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import dvybLogo from "@/assets/dvyb-logo.png";
import { trackProductShotLandingViewed, trackProductShotGetStartedClicked } from "@/lib/mixpanel";

interface ProductShotLandingProps {
  onGetStarted: () => void;
}

// Scene environments with actual images
const SCENE_ENVIRONMENTS = [
  { name: "Sunset Terrace", image: "/showcase/sunset-terrace.png", dark: false },
  { name: "Ocean Mist", image: "/showcase/ocean-mist.png", dark: false },
  { name: "Forest Floor", image: "/showcase/forest-floor.png", dark: false },
  { name: "Urban Night", image: "/showcase/urban-night.png", dark: true },
  { name: "Marble Studio", image: "/showcase/marble-studio.png", dark: false },
  { name: "Velvet Noir", image: "/showcase/velvet-noir.png", dark: true },
];

// Hydra product variations
const HYDRA_VARIATIONS = [
  "/showcase/hydra-var1.png",
  "/showcase/hydra-var2.png",
  "/showcase/hydra-var3.png",
  "/showcase/hydra-var4.png",
];

export const ProductShotLanding = ({ onGetStarted }: ProductShotLandingProps) => {
  // Refs for parallax sections
  const mockupRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const customersRef = useRef<HTMLDivElement>(null);
  const hasTrackedRef = useRef(false);
  
  // Visibility states for parallax (0-1)
  const [mockupVisible, setMockupVisible] = useState(0);
  const [videoVisible, setVideoVisible] = useState(0);
  const [customersVisible, setCustomersVisible] = useState(0);

  // Track page view on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      hasTrackedRef.current = true;
      trackProductShotLandingViewed();
    }
  }, []);

  // Handle Get Started click with tracking
  const handleGetStartedClick = () => {
    trackProductShotGetStartedClicked();
    onGetStarted();
  };

  // Intersection observers for parallax effects
  useEffect(() => {
    const observerOptions = {
      threshold: Array.from({ length: 50 }, (_, i) => i * 0.02),
      rootMargin: "-10% 0px -10% 0px",
    };

    const mockupObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        setMockupVisible(entry.intersectionRatio);
      });
    }, observerOptions);

    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        setVideoVisible(entry.intersectionRatio);
      });
    }, observerOptions);

    const customersObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        setCustomersVisible(entry.intersectionRatio);
      });
    }, observerOptions);

    if (mockupRef.current) mockupObserver.observe(mockupRef.current);
    if (videoRef.current) videoObserver.observe(videoRef.current);
    if (customersRef.current) customersObserver.observe(customersRef.current);

    return () => {
      mockupObserver.disconnect();
      videoObserver.disconnect();
      customersObserver.disconnect();
    };
  }, []);

  // Calculate rotation: starts at ~28deg slant, goes to 0 as section becomes visible
  const mockupRotation = 28 * (1 - Math.min(mockupVisible * 1.8, 1));
  const videoRotation = -20 * (1 - Math.min(videoVisible * 1.6, 1));
  const customersRotation = 15 * (1 - Math.min(customersVisible * 1.6, 1));

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f8f7f4]">
      {/* Hero Section - Not full height to show teaser of next section */}
      <section
        className="relative flex flex-col"
        style={{
          backgroundImage: "url(/onboarding-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          minHeight: "85vh",
        }}
      >
        {/* Header */}
        <header className="relative z-50 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="w-24 h-16 md:w-32 md:h-20 flex items-center">
              <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
            </div>
            <Button
              className="btn-gradient-cta font-semibold h-9 md:h-10 px-4 md:px-6 rounded-lg text-xs md:text-sm"
              onClick={handleGetStartedClick}
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </header>

        {/* Hero Content */}
        <div className="flex-1 flex items-center justify-center px-6 pb-8">
          <div className="relative z-10 text-center max-w-4xl mx-auto space-y-8">
            {/* Main Heading with gradient styling */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[1.05]">
              <span className="text-foreground">On-brand visuals.</span>
              <br />
              <span className="bg-gradient-to-r from-orange-600 via-primary to-orange-600 bg-clip-text text-transparent">
                Made by AI.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg md:text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
              Create, customize, and manage all your brand visuals in one place.
              Turn hours of work into seconds of flow.
            </p>

            {/* CTA Button */}
            <div className="flex items-center justify-center">
              <Button
                onClick={handleGetStartedClick}
                size="lg"
                className="btn-gradient-cta py-6 px-10 text-base rounded-xl font-semibold"
              >
                Get started
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Scene Showcase Section - Floating Cards with Strong Slant */}
      <section 
        ref={mockupRef}
        className="relative py-16 md:py-24 overflow-hidden bg-[#f8f7f4]"
      >
        <div
          className="max-w-6xl mx-auto px-4 md:px-6 transition-all duration-1000 ease-out"
          style={{
            transform: `perspective(1500px) rotateX(${mockupRotation}deg)`,
            transformOrigin: "center top",
          }}
        >
          {/* Main Showcase - Staggered Card Layout */}
          <div className="relative">
            {/* Background decorative elements */}
            <div className="absolute -top-8 -left-8 w-64 h-64 bg-gradient-to-br from-primary/5 to-teal/5 rounded-full blur-3xl" />
            <div className="absolute -bottom-8 -right-8 w-48 h-48 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-full blur-3xl" />
            
            {/* MOBILE LAYOUT - Clean 2-column grid */}
            <div className="md:hidden space-y-3">
              {/* Hero Card - Full width */}
              <div className="rounded-2xl shadow-2xl aspect-[16/10] relative overflow-hidden border border-white/50 group">
                <img 
                  src={SCENE_ENVIRONMENTS[4].image} 
                  alt={SCENE_ENVIRONMENTS[4].name}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 bg-foreground text-background text-[10px] font-medium px-2.5 py-1 rounded-full">
                  Best Seller
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                  <p className="text-white text-sm font-medium">Your product, infinite possibilities</p>
                </div>
              </div>

              {/* 2x2 Grid of scene cards */}
              <div className="grid grid-cols-2 gap-3">
                {/* Sunset Terrace */}
                <div className="rounded-xl shadow-lg aspect-square relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[0].image} 
                    alt={SCENE_ENVIRONMENTS[0].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm text-foreground/80 bg-white/70">
                    {SCENE_ENVIRONMENTS[0].name}
                  </span>
                </div>
                {/* Ocean Mist */}
                <div className="rounded-xl shadow-lg aspect-square relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[1].image} 
                    alt={SCENE_ENVIRONMENTS[1].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm text-foreground/80 bg-white/70">
                    {SCENE_ENVIRONMENTS[1].name}
                  </span>
                </div>
                {/* Urban Night */}
                <div className="rounded-xl shadow-lg aspect-square relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[3].image} 
                    alt={SCENE_ENVIRONMENTS[3].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm text-white/90 bg-black/40">
                    {SCENE_ENVIRONMENTS[3].name}
                  </span>
                </div>
                {/* Velvet Noir */}
                <div className="rounded-xl shadow-lg aspect-square relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[5].image} 
                    alt={SCENE_ENVIRONMENTS[5].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm text-white/90 bg-black/40">
                    {SCENE_ENVIRONMENTS[5].name}
                  </span>
                </div>
              </div>

              {/* Bottom row - Forest Floor + CTA */}
              <div className="grid grid-cols-2 gap-3">
                {/* Forest Floor */}
                <div className="rounded-xl shadow-lg relative overflow-hidden group aspect-[4/3]">
                  <img 
                    src={SCENE_ENVIRONMENTS[2].image} 
                    alt={SCENE_ENVIRONMENTS[2].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm text-white/90 bg-black/40">
                    {SCENE_ENVIRONMENTS[2].name}
                  </span>
                </div>
                {/* CTA Card */}
                <div 
                  onClick={handleGetStartedClick}
                  className="bg-gradient-to-br from-foreground to-foreground/80 rounded-xl p-4 shadow-lg cursor-pointer hover:opacity-90 transition-opacity aspect-[4/3] flex flex-col justify-center"
                >
                  <p className="font-semibold text-background text-sm mb-1">Ready to create?</p>
                  <p className="text-background/70 text-[10px] mb-2">Upload your product</p>
                  <ArrowRight className="w-4 h-4 text-background" />
                </div>
              </div>
            </div>

            {/* DESKTOP LAYOUT - Original asymmetric grid */}
            <div className="hidden md:grid grid-cols-12 gap-6 items-start">
              {/* Left Column - Stacked smaller cards */}
              <div className="col-span-4 space-y-4">
                {/* Sunset Terrace */}
                <div className="rounded-2xl shadow-xl aspect-[4/3] relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[0].image} 
                    alt={SCENE_ENVIRONMENTS[0].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className={`absolute bottom-3 left-3 text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm ${SCENE_ENVIRONMENTS[0].dark ? 'text-white/90 bg-black/30' : 'text-foreground/70 bg-white/60'}`}>
                    {SCENE_ENVIRONMENTS[0].name}
                  </span>
                </div>
                {/* Ocean Mist */}
                <div className="rounded-2xl shadow-xl aspect-square relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[1].image} 
                    alt={SCENE_ENVIRONMENTS[1].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className={`absolute bottom-3 left-3 text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm ${SCENE_ENVIRONMENTS[1].dark ? 'text-white/90 bg-black/30' : 'text-foreground/70 bg-white/60'}`}>
                    {SCENE_ENVIRONMENTS[1].name}
                  </span>
                </div>
              </div>

              {/* Center - Hero Card (Marble Studio) */}
              <div className="col-span-4">
                <div className="rounded-3xl shadow-2xl aspect-[3/4] relative overflow-hidden border border-white/50 group">
                  <img 
                    src={SCENE_ENVIRONMENTS[4].image} 
                    alt={SCENE_ENVIRONMENTS[4].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-4 right-4 bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-full">
                    Best Seller
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-4">
                    <p className="text-white text-sm font-medium">Your product, infinite possibilities</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Varied cards */}
              <div className="col-span-4 space-y-4 mt-8">
                {/* Urban Night */}
                <div className="rounded-2xl shadow-xl aspect-video relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[3].image} 
                    alt={SCENE_ENVIRONMENTS[3].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className={`absolute bottom-3 left-3 text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm ${SCENE_ENVIRONMENTS[3].dark ? 'text-white/90 bg-black/30' : 'text-foreground/70 bg-white/60'}`}>
                    {SCENE_ENVIRONMENTS[3].name}
                  </span>
                </div>
                {/* Velvet Noir */}
                <div className="rounded-2xl shadow-xl aspect-[4/3] relative overflow-hidden group">
                  <img 
                    src={SCENE_ENVIRONMENTS[5].image} 
                    alt={SCENE_ENVIRONMENTS[5].name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className={`absolute bottom-3 left-3 text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm ${SCENE_ENVIRONMENTS[5].dark ? 'text-white/90 bg-black/30' : 'text-foreground/70 bg-white/60'}`}>
                    {SCENE_ENVIRONMENTS[5].name}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom row - Desktop only */}
            <div className="hidden md:grid grid-cols-2 gap-4 mt-6">
              {/* Forest Floor */}
              <div className="rounded-2xl shadow-xl relative overflow-hidden group h-24">
                <img 
                  src={SCENE_ENVIRONMENTS[2].image} 
                  alt={SCENE_ENVIRONMENTS[2].name}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
                <div className="absolute inset-0 flex items-center p-6">
                  <div>
                    <p className="font-medium text-white text-sm mb-1">{SCENE_ENVIRONMENTS[2].name}</p>
                    <p className="text-white/70 text-xs">Natural lighting, organic textures</p>
                  </div>
                </div>
              </div>
              {/* CTA Card */}
              <div 
                onClick={handleGetStartedClick}
                className="bg-gradient-to-r from-foreground to-foreground/90 rounded-2xl p-6 shadow-xl relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity h-24 flex items-center"
              >
                <div className="flex items-center justify-between w-full">
                  <div>
                    <p className="font-medium text-background text-sm mb-1">Ready to create?</p>
                    <p className="text-background/70 text-xs">Upload your first product</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-background" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Integrate Products Section */}
      <section className="py-20 md:py-28 bg-[#f8f7f4]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <p className="text-sm font-medium text-primary/80">AI Product Shots</p>
              <h2 className="text-3xl md:text-5xl font-bold text-foreground leading-tight">
                Integrate real products in generated visuals
              </h2>
              <p className="text-foreground/60 text-lg leading-relaxed">
                Create high-quality visuals by placing real product images into AI-made scenes—from clean packshots to styled lifestyle shots.
              </p>
              <Button
                onClick={handleGetStartedClick}
                className="btn-gradient-cta py-5 px-8 text-base rounded-xl font-semibold"
              >
                Get started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
            {/* Hydra variations preview */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 overflow-hidden">
              <div className="grid grid-cols-2 gap-3">
                {HYDRA_VARIATIONS.map((src, index) => (
                  <div key={index} className="aspect-square rounded-xl overflow-hidden group">
                    <img 
                      src={src} 
                      alt={`Product variation ${index + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                ))}
              </div>
              <p className="text-center text-foreground/50 text-sm mt-4">4 unique variations from 1 photo</p>
            </div>
          </div>
        </div>
      </section>

      {/* Video Generation Section */}
      <section
        ref={videoRef}
        className="py-20 md:py-28 bg-[#f8f7f4] overflow-hidden"
      >
        <div
          className="max-w-6xl mx-auto px-6 transition-all duration-1000 ease-out"
          style={{
            transform: `perspective(1500px) rotateX(${videoRotation}deg)`,
            transformOrigin: "center bottom",
          }}
        >
          {/* Section header */}
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-bold text-foreground leading-tight mb-4">
              Motion that sells
            </h2>
            <p className="text-foreground/60 text-lg max-w-xl mx-auto">
              Transform any product into scroll-stopping video content
            </p>
          </div>

          {/* Video showcase - horizontal scroll feel */}
          <div className="grid md:grid-cols-3 gap-4">
            {/* Vertical video - SOLARA Perfume (9:16) */}
            <div className="bg-black rounded-2xl aspect-[9/16] relative overflow-hidden shadow-xl group">
              <video 
                autoPlay 
                loop 
                muted 
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              >
                <source src="/showcase/solara.webm" type="video/webm" />
              </video>
              <div className="absolute top-3 left-3 bg-white/10 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full z-10">
                9:16
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 z-10">
                <p className="text-white/70 text-[10px] uppercase tracking-wider mb-0.5">SOLARA</p>
                <p className="text-white text-xs font-medium">Stories & Reels</p>
              </div>
            </div>

            {/* Square video - MERIDIAN Skincare (1:1) */}
            <div className="bg-black rounded-2xl aspect-square relative overflow-hidden shadow-xl group">
              <video 
                autoPlay 
                loop 
                muted 
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              >
                <source src="/showcase/meridian.webm" type="video/webm" />
              </video>
              <div className="absolute top-3 left-3 bg-white/10 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full z-10">
                1:1
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 z-10">
                <p className="text-white/70 text-[10px] uppercase tracking-wider mb-0.5">MERIDIAN</p>
                <p className="text-white text-xs font-medium">Feed Posts</p>
              </div>
            </div>

            {/* Landscape video - MAISON ONYX Watch (16:9) */}
            <div className="bg-black rounded-2xl aspect-video relative overflow-hidden shadow-xl group md:self-center">
              <video 
                autoPlay 
                loop 
                muted 
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              >
                <source src="/showcase/maison.webm" type="video/webm" />
              </video>
              <div className="absolute top-3 left-3 bg-white/10 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full z-10">
                16:9
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 z-10">
                <p className="text-white/70 text-[10px] uppercase tracking-wider mb-0.5">MAISON ONYX</p>
                <p className="text-white text-xs font-medium">YouTube & Ads</p>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-foreground">15s</p>
              <p className="text-foreground/50 text-xs mt-1">Average render</p>
            </div>
            <div className="text-center border-x border-gray-200">
              <p className="text-2xl md:text-3xl font-bold text-foreground">4K</p>
              <p className="text-foreground/50 text-xs mt-1">Resolution</p>
            </div>
            <div className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-foreground">∞</p>
              <p className="text-foreground/50 text-xs mt-1">Variations</p>
            </div>
          </div>
        </div>
      </section>

      {/* Who It's For Section */}
      <section
        ref={customersRef}
        className="py-20 md:py-28 bg-[#f8f7f4] overflow-hidden"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-foreground leading-tight mb-4">
              For creators who move fast
            </h2>
            <p className="text-foreground/60 text-lg">
              Whether you're a solo creator or a global brand
            </p>
          </div>

          <div
            className="transition-all duration-1000 ease-out"
            style={{
              transform: `perspective(1500px) rotateX(${customersRotation}deg)`,
              transformOrigin: "center bottom",
            }}
          >
            {/* Bento Grid Layout */}
            <div className="grid grid-cols-12 gap-4">
              {/* Solo Creators - Large Card */}
              <div className="col-span-12 md:col-span-7 bg-gradient-to-br from-orange-50 to-orange-100 rounded-3xl p-8 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-foreground mb-3">Solo Creators</h3>
                  <p className="text-foreground/60 max-w-sm leading-relaxed">
                    Create professional product content without a design team. Launch campaigns faster, test more ideas.
                  </p>
                </div>
              </div>

              {/* E-commerce - Tall Card */}
              <div className="col-span-12 md:col-span-5 bg-gradient-to-b from-amber-50 to-orange-100 rounded-3xl p-8 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-foreground mb-3">E-commerce</h3>
                  <p className="text-foreground/60 leading-relaxed">
                    Turn one product photo into dozens of variations. A/B test visuals at scale.
                  </p>
                </div>
              </div>

              {/* Agencies */}
              <div className="col-span-12 md:col-span-5 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-8 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-white mb-3">Agencies</h3>
                  <p className="text-white/60 leading-relaxed">
                    Deliver more creative options to clients. Win pitches with rapid prototyping.
                  </p>
                </div>
              </div>

              {/* Brands - Wide Card */}
              <div className="col-span-12 md:col-span-7 bg-gradient-to-r from-teal-50 to-emerald-100 rounded-3xl p-8 relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-foreground mb-3">Enterprise Brands</h3>
                  <p className="text-foreground/60 max-w-md leading-relaxed">
                    Maintain brand consistency across thousands of product visuals. Scale content production without scaling headcount.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 md:py-32 bg-gradient-to-b from-[#f8f7f4] to-white relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-primary/3 to-teal/3 rounded-full blur-3xl" />
        </div>
        
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center space-y-8">
          <h2 className="text-4xl md:text-6xl font-bold text-foreground leading-tight">
            Start creating
            <br />
            <span className="bg-gradient-to-r from-orange-600 via-primary to-orange-600 bg-clip-text text-transparent">in seconds</span>
          </h2>
          <p className="text-foreground/60 text-lg max-w-md mx-auto">
            No credit card required. Generate your first product shots today.
          </p>
          <div className="flex items-center justify-center">
            <Button
              onClick={handleGetStartedClick}
              size="lg"
              className="btn-gradient-cta py-6 px-10 text-base rounded-xl font-semibold"
            >
              Get started free
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 px-6 bg-[#f8f7f4]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Image src={dvybLogo} alt="Dvyb" className="h-6 w-auto opacity-60" />
          <p className="text-foreground/40 text-sm">© 2025 Dvyb. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
