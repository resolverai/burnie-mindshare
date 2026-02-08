"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

const testimonials = [
  {
    initials: "SM",
    name: "Sarah Mitchell",
    title: "Founder, Glow Essentials",
    quote:
      "We used to spend 3-4 days researching what competitors were running before even briefing our agency. Now I see exactly what's working in my space and have on-brand ads ready in minutes. It's completely changed how fast we can test.",
  },
  {
    initials: "JC",
    name: "James Chen",
    title: "Head of Growth, Luxe Apparel",
    quote:
      "The competitor insights alone are worth it. I can see what ads my competitors are scaling, then dvyb generates our version that actually matches our brand. We've 3x'd our creative testing velocity.",
  },
  {
    initials: "MR",
    name: "Maya Rodriguez",
    title: "Performance Marketing Lead, Nova Skincare",
    quote:
      "No more back-and-forth with agencies or waiting weeks for creative. I spot a winning ad format, upload my product, and have Meta-ready creatives the same day. Our CAC dropped 22% in the first month.",
  },
  {
    initials: "DK",
    name: "David Kim",
    title: "Co-founder, Thread & Stone",
    quote:
      "Finally I can see what's actually performing in my niche instead of guessing. dvyb shows me the winning patterns, then creates ads that look like our brand shot them. We launched 40 new creatives last week alone.",
  },
  {
    initials: "EP",
    name: "Emma Patel",
    title: "Marketing Director, Aura Jewelry",
    quote:
      "The speed is unreal. What used to take our team days of research and agency coordination now happens in one session. We're testing more, learning faster, and scaling winners before competitors even notice.",
  },
  {
    initials: "TW",
    name: "Tyler West",
    title: "Founder & CEO, Peak Athletics",
    quote:
      "dvyb removed our biggest bottleneck: creative production. I can see exactly what ad formats are winning for similar brands, and generate our own versions instantly. We went from 5 new ads a month to 5 a day.",
  },
];

const StarsRating = () => (
  <div className="flex gap-0.5">
    {[...Array(5)].map((_, i) => (
      <Star key={i} className="w-4 h-4 fill-cta text-cta" />
    ))}
  </div>
);

export function TestimonialsSection() {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  const onSelect = useCallback((api: CarouselApi) => {
    setCurrent(api?.selectedScrollSnap() ?? 0);
  }, []);

  useEffect(() => {
    if (!api) return;
    onSelect(api);
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, onSelect]);

  // Auto-rotate every 5 seconds
  useEffect(() => {
    if (!api) return;
    const interval = setInterval(() => api.scrollNext(), 5000);
    return () => clearInterval(interval);
  }, [api]);

  return (
    <section className="py-24 px-6" style={{ background: "var(--gradient-section-1)" }}>
      <div className="container mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">
            Obsessed on by D2C founders and marketers
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Teams across industries use dvyb.ai to scale their creative output.
          </p>
        </div>

        <div className="relative max-w-6xl mx-auto px-14 md:px-16">
          <Carousel setApi={setApi} opts={{ loop: true, align: "start", containScroll: "trimSnaps" }} className="w-full">
            <CarouselContent className="-ml-5">
              {testimonials.map((testimonial) => (
                <CarouselItem key={testimonial.name} className="pl-5 basis-full md:basis-1/2 flex">
                  <div className="bg-card rounded-2xl p-8 shadow-card border border-border/50 flex flex-col w-full h-[340px]">
                    <div className="flex items-center justify-between mb-6 shrink-0">
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
                    <p className="text-muted-foreground text-sm leading-relaxed flex-1 min-h-0">
                      &quot;{testimonial.quote}&quot;
                    </p>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>

            {/* Prev/Next arrows */}
            <button
              type="button"
              onClick={() => api?.scrollPrev()}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-secondary transition-colors"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="w-5 h-5 text-foreground" />
            </button>
            <button
              type="button"
              onClick={() => api?.scrollNext()}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-secondary transition-colors"
              aria-label="Next testimonial"
            >
              <ChevronRight className="w-5 h-5 text-foreground" />
            </button>
          </Carousel>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-2 mt-6">
            {testimonials.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => api?.scrollTo(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === current ? "bg-cta w-6" : "w-2 bg-muted hover:bg-muted-foreground"
                }`}
                aria-label={`Go to testimonial ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
