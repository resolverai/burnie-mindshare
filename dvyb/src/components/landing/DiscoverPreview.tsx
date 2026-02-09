"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { tileImages } from "@/lib/tileImages";

// Combined image pool for DiscoverPreview: discover (18) + tiles (38) = 56 unique images (no repeats)
const TILE_PATHS = [
  "/landing/tiles/tile-1.jpg", "/landing/tiles/tile-2.jpg", "/landing/tiles/tile-3.jpg",
  "/landing/tiles/tile-4.jpg", "/landing/tiles/tile-5.jpg", "/landing/tiles/tile-6.jpg",
  "/landing/tiles/tile-7.png", "/landing/tiles/tile-8.png", "/landing/tiles/tile-9.jpg",
  "/landing/tiles/tile-10.jpg", "/landing/tiles/tile-11.png", "/landing/tiles/tile-12.png",
  "/landing/tiles/tile-13.png", "/landing/tiles/tile-14.png", "/landing/tiles/tile-15.png",
  "/landing/tiles/tile-16.png", "/landing/tiles/tile-17.png", "/landing/tiles/tile-18.png",
  "/landing/tiles/tile-19.png", "/landing/tiles/tile-20.png", "/landing/tiles/tile-21.png",
  "/landing/tiles/tile-22.png", "/landing/tiles/tile-23.png", "/landing/tiles/tile-24.png",
  "/landing/tiles/tile-25.png", "/landing/tiles/tile-26.png", "/landing/tiles/tile-27.png",
  "/landing/tiles/tile-28.png", "/landing/tiles/tile-29.png", "/landing/tiles/tile-30.png",
  "/landing/tiles/tile-31.png", "/landing/tiles/tile-32.png", "/landing/tiles/tile-33.png",
  "/landing/tiles/tile-34.png", "/landing/tiles/tile-35.png", "/landing/tiles/tile-36.png",
  "/landing/tiles/tile-37.png", "/landing/tiles/tile-38.png",
];

interface AdTemplate {
  id: number;
  title: string;
  category: string;
  image: string;
  runtime: string;
  status: "Active" | "Inactive" | "Paused";
  brand: string;
  brandLogo: string;
}

const brandData = [
  { name: "Laifen", logo: "https://logo.clearbit.com/laifen.com" },
  { name: "Keychron", logo: "https://logo.clearbit.com/keychron.com" },
  { name: "T2 Tea", logo: "https://logo.clearbit.com/t2tea.com" },
  { name: "Lonvera", logo: "https://logo.clearbit.com/lonvera.com" },
  { name: "Styleware", logo: "https://logo.clearbit.com/styleware.com.au" },
  { name: "Flodesk", logo: "https://logo.clearbit.com/flodesk.com" },
];

const statuses: ("Active" | "Inactive" | "Paused")[] = ["Active", "Inactive", "Paused"];

const templateTitles = [
  "Product Launch",
  "Brand Story",
  "Property Tour",
  "Collection Drop",
  "Recipe Video",
  "App Demo",
  "Testimonial",
  "Promo Reel",
  "Feature Highlight",
  "Lifestyle Ad",
];

// Random shuffle (different each page load)
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const generateTemplates = (count: number): AdTemplate[] => {
  const templates: AdTemplate[] = [];
  // First preference: discover images at the top (all 18, no repeats, in order)
  const discoverImages = [...tileImages];
  // Second preference: tiles only to fill remaining slots and prevent duplications
  const tilesShuffled = shuffleArray(TILE_PATHS);
  const slotsToFill = Math.max(0, count - discoverImages.length);
  const uniqueImages = [...discoverImages, ...tilesShuffled.slice(0, slotsToFill)];

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const hours = Math.floor(Math.random() * 48) + 1;
    const brandInfo = brandData[Math.floor(Math.random() * brandData.length)];
    templates.push({
      id,
      title: templateTitles[id % templateTitles.length],
      category: ["SaaS", "DTC", "Fashion", "Food", "Tech", "Health"][id % 6],
      image: uniqueImages[i % uniqueImages.length],
      runtime: `${hours}h`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      brand: brandInfo.name,
      brandLogo: brandInfo.logo,
    });
  }
  return templates;
};

const TEMPLATE_COUNT = 30;

interface DiscoverPreviewProps {
  onOpenWebsiteModal?: () => void;
}

export function DiscoverPreview({ onOpenWebsiteModal }: DiscoverPreviewProps) {
  const templates = useMemo(() => generateTemplates(TEMPLATE_COUNT), []);

  return (
    <section
      id="showcase"
      className="min-h-screen pt-4 pb-12 relative -mt-2 scroll-mt-20"
      style={{ background: "var(--gradient-carousel)" }}
    >
      <div className="w-full h-full">
        {/* Masonry Grid - Full screen height with fade */}
        <div className="relative h-[calc(100vh-6rem)] overflow-hidden">
          <div className="columns-[220px] gap-4 px-4">
            {templates.map((template, index) => (
              <div
                key={template.id}
                className="mb-4 break-inside-avoid group relative rounded-xl overflow-hidden cursor-pointer"
                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.image}
                  alt={template.title}
                  className="w-full h-auto"
                />

                {/* Top badges - smaller font/padding to prevent overlap */}
                <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0 shrink">
                    <span
                      className="-ml-2 block pl-2 pr-2.5 py-0.5 bg-gradient-to-r from-green-700 via-green-600 to-green-500 text-white text-[9px] font-bold tracking-wide"
                      style={{
                        clipPath: "polygon(0 0, 100% 0, 85% 100%, 0 100%)",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                      }}
                    >
                      WINNER
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${
                        template.status === "Active"
                          ? "bg-green-500/90 text-white"
                          : "bg-muted/90 text-foreground"
                      }`}
                    >
                      {template.runtime}
                    </span>
                  </div>
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Hover action button at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenWebsiteModal?.();
                    }}
                    className="w-full gap-2 bg-cta hover:bg-cta/90 text-cta-foreground"
                  >
                    Create ad using template
                  </Button>
                </div>

                {/* Brand logo and name badge top right - smaller to prevent overlap */}
                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-white/90 backdrop-blur-sm rounded-full flex items-center gap-1 shrink-0 max-w-[45%]">
                  <img
                    src={template.brandLogo}
                    alt={template.brand}
                    className="w-3 h-3 rounded-full object-cover shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                  <span className="hidden w-3 h-3 rounded-full bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center shrink-0">
                    {template.brand.charAt(0)}
                  </span>
                  <span className="text-[9px] font-medium text-foreground truncate">{template.brand}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom fade overlay with CTA */}
          <div
            className="absolute bottom-0 left-0 right-0 h-72 flex flex-col items-center justify-end pb-8 gap-4 px-4 z-20"
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%, hsl(var(--secondary) / 0.7) 15%, hsl(var(--secondary) / 0.95) 40%, hsl(var(--secondary)) 60%, hsl(var(--secondary)) 100%)",
            }}
          >
            <p className="text-xl sm:text-2xl md:text-4xl lg:text-5xl font-display font-bold text-center">
              <span className="text-cta">Steal</span> your competitor&apos;s ads{" "}
              <span className="text-cta">(legally)</span>
            </p>
            <Button
              size="lg"
              type="button"
              onClick={onOpenWebsiteModal}
              className="bg-cta hover:bg-cta/90 text-cta-foreground px-10 py-7 text-lg font-display font-semibold rounded-full shadow-lg"
            >
              Create one for your brand
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
