"use client";

import { tileImages } from "@/lib/tileImages";

const statsConfig = [
  { label: "Ads created", hasAnimation: true, getValue: (adCount: number) => `${adCount.toLocaleString()}+` },
  { label: "Industries served", hasAnimation: false, getValue: () => "15+" },
  { label: "New teams joining", hasAnimation: false, getValue: () => "Weekly" },
] as const;

interface LandingHeroStatsSectionProps {
  adCount: number;
  floatingTiles: { id: number; delay: number; imageIndex: number }[];
}

export function LandingHeroStatsSection({ adCount, floatingTiles }: LandingHeroStatsSectionProps) {
  const statsWithValues = statsConfig.map((s) => ({
    value: s.getValue(adCount),
    label: s.label,
    hasAnimation: s.hasAnimation,
  }));

  return (
    <section className="relative px-4 sm:px-6">
      <div className="container mx-auto relative z-10">
        <div className="text-center max-w-4xl mx-auto">
          <div className="mt-10 sm:mt-14 flex flex-wrap justify-center gap-6 sm:gap-10 md:gap-16 animate-fade-up" style={{ animationDelay: "0.3s" }}>
            {statsWithValues.map((stat) => (
              <div key={stat.label} className="text-center relative">
                <p className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
                {stat.hasAnimation &&
                  floatingTiles.map(({ id, delay, imageIndex }, index) => {
                    const offsetPercent = (index % 3 - 1) * 30;
                    return (
                      <div
                        key={id}
                        className="absolute w-8 h-10 rounded-sm overflow-hidden shadow-lg pointer-events-none animate-float-up border border-border/50"
                        style={{
                          top: "-15px",
                          left: `calc(50% + ${offsetPercent}%)`,
                          transform: "translateX(-50%)",
                          animationDelay: `${delay}ms`,
                          opacity: 0,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={tileImages[imageIndex]}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute -left-0.5 top-1 z-10">
                          <span
                            className="block pl-1 pr-1.5 py-0.5 bg-gradient-to-r from-green-700 via-green-600 to-green-500 text-white text-[5px] font-bold tracking-wide"
                            style={{
                              clipPath: "polygon(0 0, 100% 0, 85% 100%, 0 100%)",
                              boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                            }}
                          >
                            WINNER
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
