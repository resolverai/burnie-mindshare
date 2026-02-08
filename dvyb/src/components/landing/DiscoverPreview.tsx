"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { tileImages } from "@/lib/tileImages";

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const shuffleWithSeed = <T,>(arr: T[], seed: number): T[] => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed + i) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const TEMPLATE_COUNT = 30;

interface DiscoverPreviewProps {
  onOpenWebsiteModal?: () => void;
}

export function DiscoverPreview({ onOpenWebsiteModal }: DiscoverPreviewProps) {
  const tiles = useMemo(() => {
    const shuffled = shuffleWithSeed(tileImages, 42);
    return Array.from({ length: TEMPLATE_COUNT }, (_, i) => ({
      id: i + 1,
      image: shuffled[i % shuffled.length],
    }));
  }, []);

  return (
    <section
      id="showcase"
      className="min-h-screen pt-4 pb-12 relative -mt-2 scroll-mt-20"
      style={{ background: "var(--gradient-carousel)" }}
    >
      {/* Masonry Grid - Full viewport height */}
      <div className="relative h-[calc(100vh-6rem)] overflow-hidden px-4">
        <div className="columns-[220px] gap-4">
          {tiles.map((tile) => (
            <div
              key={tile.id}
              className="mb-4 break-inside-avoid group relative rounded-xl overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tile.image}
                alt=""
                className="w-full h-auto object-cover block"
              />

              {/* WINNER badge */}
              <div className="absolute -left-0.5 top-2 z-10">
                <span
                  className="block pl-1 pr-1.5 py-0.5 bg-gradient-to-r from-green-700 via-green-600 to-green-500 text-white text-[9px] font-bold tracking-wide"
                  style={{
                    clipPath: "polygon(0 0, 100% 0, 85% 100%, 0 100%)",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                  }}
                >
                  WINNER
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom fade overlay with heading + CTA - z-20 ensures it sits above tiles/badges */}
        <div
          className="absolute bottom-0 left-0 right-0 z-20 h-56 flex flex-col items-center justify-end pb-8 px-4 backdrop-blur-md"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--secondary) / 0.7) 15%, hsl(var(--secondary) / 0.85) 45%, hsl(var(--secondary)) 100%)",
          }}
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-semibold text-center mb-5 text-foreground">
            <span className="text-cta">Steal</span> your competitor&apos;s ads <span className="text-cta">(legally)</span>
          </h2>
          <Button
            size="lg"
            onClick={onOpenWebsiteModal}
            className="bg-cta hover:bg-cta/90 text-cta-foreground px-8 py-6 text-base font-semibold rounded-full shadow-lg"
          >
            Create one for your brand
          </Button>
        </div>
      </div>
    </section>
  );
}
