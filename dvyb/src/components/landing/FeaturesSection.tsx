"use client";

import { useState, useEffect } from "react";
import { Lightbulb, Target, BarChart3 } from "lucide-react";

const features = [
  {
    id: "intelligent",
    label: "Intelligent selection",
    icon: Lightbulb,
    title: "Built to convert — not just look good",
    description: "Ads designed to stop scroll, communicate value, and drive action.",
    tag: "Based on real ad patterns",
    image: "/landing/showcase-1.png",
  },
  {
    id: "lifelike",
    label: "Life like ads",
    icon: Target,
    title: "Hooks and scripts written for real ads",
    description: "No generic AI copy. Inspired by what's already working in your industry.",
    tag: "Industry-proven",
    image: "/landing/showcase-4.png",
  },
  {
    id: "format",
    label: "Every format",
    icon: BarChart3,
    title: "Every format. One consistent brand.",
    description: "Automatically adapted for Reels, TikTok, Shorts, and paid placements.",
    tag: "Platform-native",
    image: "/landing/showcase-6.png",
  },
];

export function FeaturesSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto-rotate carousel every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const activeFeature = features[activeIndex];

  return (
    <section
      id="built-for-performance"
      className="py-24 px-6 scroll-mt-20"
      style={{ background: "var(--gradient-section-2)" }}
    >
      <div className="container mx-auto max-w-4xl">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-semibold text-center mb-10">
          Built for <span className="text-cta">performance</span>
        </h2>

        {/* Progress bar style tabs */}
        <div className="flex gap-1 mb-12">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const isActive = index === activeIndex;
            return (
              <button
                key={feature.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`flex-1 flex flex-col items-center gap-2 py-3 px-4 rounded-lg transition-all duration-300 ${
                  isActive ? "bg-cta text-cta-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-xs font-medium text-center leading-tight">{feature.label}</span>
              </button>
            );
          })}
        </div>

        {/* Single placeholder - one card that changes based on selected tab */}
        <div
          key={activeIndex}
          className="group bg-card rounded-3xl p-8 shadow-card border border-border/50 animate-fade-up"
        >
          <h3 className="text-xl md:text-2xl font-display font-semibold mb-3">{activeFeature.title}</h3>
          <p className="text-muted-foreground text-base mb-8 leading-relaxed">{activeFeature.description}</p>
          <div className="aspect-video rounded-2xl relative overflow-hidden shadow-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeFeature.image}
              alt={activeFeature.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute bottom-3 left-3">
              <span className="px-3 py-1.5 bg-foreground/90 text-background rounded-full text-xs font-medium">
                {activeFeature.tag}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
