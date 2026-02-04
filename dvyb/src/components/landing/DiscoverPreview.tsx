"use client";

import { useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";

type AspectRatio = "9:16" | "16:9" | "1:1";

interface AdTemplate {
  id: number;
  title: string;
  category: string;
  aspectRatio: AspectRatio;
  image: string;
  isVideo: boolean;
  videoSrc?: string;
  runtime: string;
  status: "Active" | "Inactive" | "Paused";
  brand: string;
  brandLogo: string;
}

const images = [
  "/landing/warehouse-1.png",
  "/landing/warehouse-2.webp",
  "/landing/chef-1.png",
  "/landing/fitness.jpg",
  "/landing/chef-2.jpg",
  "/landing/pottery.jpg",
  "/landing/grocery.png",
];

const videos = [
  "/landing/video-celsius.mp4",
  "/landing/video-daise.mp4",
  "/landing/video-lip.mp4",
  "/landing/video-multi.mp4",
  "/landing/video-step.mp4",
  "/landing/video-watch.mp4",
];

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

const getRandomAspectRatio = (): AspectRatio => {
  const rand = Math.random();
  if (rand < 0.5) return "9:16";
  if (rand < 0.75) return "1:1";
  return "16:9";
};

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const generateTemplates = (count: number): AdTemplate[] => {
  const templates: AdTemplate[] = [];
  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const seed = id * 12345;
    const isVideo = seededRandom(seed) > 0.4;
    const hours = Math.floor(seededRandom(seed + 1) * 48) + 1;
    const brandInfo = brandData[Math.floor(seededRandom(seed + 2) * brandData.length)];
    templates.push({
      id,
      title: templateTitles[id % templateTitles.length],
      category: ["SaaS", "DTC", "Fashion", "Food", "Tech", "Health"][id % 6],
      aspectRatio: getRandomAspectRatio(),
      image: images[Math.floor(seededRandom(seed + 3) * images.length)],
      isVideo,
      videoSrc: isVideo ? videos[Math.floor(seededRandom(seed + 4) * videos.length)] : undefined,
      runtime: `${hours}h`,
      status: statuses[Math.floor(seededRandom(seed + 5) * statuses.length)],
      brand: brandInfo.name,
      brandLogo: brandInfo.logo,
    });
  }
  return templates;
};

const getAspectRatioClass = (ratio: AspectRatio) => {
  switch (ratio) {
    case "9:16":
      return "aspect-[9/16]";
    case "16:9":
      return "aspect-[16/9]";
    case "1:1":
      return "aspect-square";
    default:
      return "aspect-square";
  }
};

const TEMPLATE_COUNT = 30;

interface DiscoverPreviewProps {
  onOpenWebsiteModal?: () => void;
}

export function DiscoverPreview({ onOpenWebsiteModal }: DiscoverPreviewProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

  const templates = useMemo(() => generateTemplates(TEMPLATE_COUNT), []);

  const handleMouseEnter = (template: AdTemplate) => {
    setHoveredId(template.id);
    if (template.videoSrc && videoRefs.current[template.id]) {
      videoRefs.current[template.id]?.play().catch(() => {});
    }
  };

  const handleMouseLeave = (template: AdTemplate) => {
    setHoveredId(null);
    if (template.videoSrc && videoRefs.current[template.id]) {
      const video = videoRefs.current[template.id];
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    }
  };

  return (
    <section id="showcase" className="py-12 px-6 relative scroll-mt-20" style={{ background: "var(--gradient-carousel)" }}>
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-foreground">
          Steal your competitor&apos;s ads (legally)
        </h2>

        {/* Masonry Grid - Limited height with fade */}
        <div className="relative max-h-[70vh] overflow-hidden">
          <div className="columns-[220px] gap-4">
            {templates.map((template, index) => (
              <div
                key={template.id}
                className={`mb-4 break-inside-avoid group relative rounded-xl overflow-hidden ${getAspectRatioClass(template.aspectRatio)}`}
                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                onMouseEnter={() => handleMouseEnter(template)}
                onMouseLeave={() => handleMouseLeave(template)}
              >
                {template.videoSrc ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.image}
                      alt={template.title}
                      className={`w-full h-full object-cover absolute inset-0 transition-opacity duration-300 ${hoveredId === template.id ? "opacity-0" : "opacity-100"}`}
                    />
                    <video
                      ref={(el) => {
                        videoRefs.current[template.id] = el;
                      }}
                      src={template.videoSrc}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${hoveredId === template.id ? "opacity-100" : "opacity-0"}`}
                      muted
                      playsInline
                      loop
                    />
                  </>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={template.image} alt={template.title} className="w-full h-full object-cover" />
                )}

                {/* Top badges */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-medium ${
                        template.status === "Active" ? "bg-green-500/90 text-white" : "bg-muted/90 text-foreground"
                      }`}
                    >
                      {template.runtime}
                    </span>
                  </div>
                  {template.isVideo && (
                    <span className="px-2 py-1 bg-black/50 backdrop-blur-sm rounded-md text-xs text-white">
                      0:17
                    </span>
                  )}
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Hover action button at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" className="w-full gap-2 bg-cta hover:bg-cta/90 text-cta-foreground">
                    Create ad using template
                  </Button>
                </div>

                {/* Brand logo and name badge top right */}
                <div className="absolute top-3 right-3 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-full flex items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={template.brandLogo}
                    alt={template.brand}
                    className="w-4 h-4 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                  <span className="hidden w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                    {template.brand.charAt(0)}
                  </span>
                  <span className="text-xs font-medium text-foreground">{template.brand}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom fade overlay with CTA */}
          <div
            className="absolute bottom-0 left-0 right-0 h-48 flex items-end justify-center pb-6"
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%, hsl(var(--secondary) / 0.3) 30%, hsl(var(--secondary) / 0.7) 60%, hsl(var(--secondary)) 100%)",
            }}
          >
            <Button
              size="lg"
              onClick={onOpenWebsiteModal}
              className="bg-black hover:bg-black/90 text-white px-8 py-6 text-base font-semibold rounded-full shadow-lg"
            >
              Create one for your brand
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
