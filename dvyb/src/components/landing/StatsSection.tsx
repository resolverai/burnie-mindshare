"use client";

import { Star } from "lucide-react";
import { tileImages } from "@/lib/tileImages";

const testimonials = [
  { initials: "SM", name: "Sarah Mitchell", title: "Founder, Glow Essentials", quote: "We used to spend 3-4 days researching what competitors were running before even briefing our agency. Now I see exactly what's working in my space and have on-brand ads ready in minutes. It's completely changed how fast we can test." },
  { initials: "JC", name: "James Chen", title: "Head of Growth, Luxe Apparel", quote: "The competitor insights alone are worth it. I can see what ads my competitors are scaling, then dvyb generates our version that actually matches our brand. We've 3x'd our creative testing velocity." },
  { initials: "MR", name: "Maya Rodriguez", title: "Performance Marketing Lead, Nova Skincare", quote: "No more back-and-forth with agencies or waiting weeks for creative. I spot a winning ad format, upload my product, and have Meta-ready creatives the same day. Our CAC dropped 22% in the first month." },
  { initials: "DK", name: "David Kim", title: "Co-founder, Thread & Stone", quote: "Finally I can see what's actually performing in my niche instead of guessing. dvyb shows me the winning patterns, then creates ads that look like our brand shot them. We launched 40 new creatives last week alone." },
  { initials: "EP", name: "Emma Patel", title: "Marketing Director, Aura Jewelry", quote: "The speed is unreal. What used to take our team days of research and agency coordination now happens in one session. We're testing more, learning faster, and scaling winners before competitors even notice." },
  { initials: "TW", name: "Tyler West", title: "Founder & CEO, Peak Athletics", quote: "dvyb removed our biggest bottleneck: creative production. I can see exactly what ad formats are winning for similar brands, and generate our own versions instantly. We went from 5 new ads a month to 5 a day." },
];

const StarsRating = () => (
  <div className="flex gap-0.5">
    {[...Array(5)].map((_, i) => (
      <Star key={i} className="w-4 h-4 fill-cta text-cta" />
    ))}
  </div>
);

export interface StatsSectionProps {
  adCount?: number;
  floatingTiles?: { id: number; delay: number; imageIndex: number }[];
}

export function StatsSection({ adCount = 0, floatingTiles = [] }: StatsSectionProps) {
  const stats = [
    { value: `${adCount.toLocaleString()}+`, label: "Ads created", hasAnimation: true },
    { value: "15+", label: "Industries served", hasAnimation: false },
    { value: "Weekly", label: "New teams joining", hasAnimation: false },
  ];

  return (
    <section className="py-24 px-6" style={{ background: "var(--gradient-section-1)" }}>
      <div className="container mx-auto">
        <div className="flex flex-wrap justify-center gap-10 md:gap-16 mb-20">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center relative">
              <p className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-foreground">
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
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">
            Obsessed on by D2C founders and marketers
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Teams across industries use dvyb.ai to scale their creative output.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={testimonial.name}
              className="bg-card rounded-2xl p-8 shadow-card border border-border/50 animate-fade-up hover:border-border transition-all duration-300"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-cta/20 flex items-center justify-center text-sm font-semibold text-cta">
                    {testimonial.initials}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-display font-semibold">{testimonial.name}</span>
                    <span className="text-xs text-muted-foreground">{testimonial.title}</span>
                  </div>
                </div>
                <StarsRating />
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                &quot;{testimonial.quote}&quot;
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
