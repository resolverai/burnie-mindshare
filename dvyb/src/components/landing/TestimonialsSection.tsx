"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return "https://" + u;
  return u;
}

function isValidWebsiteUrl(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  const toParse = /^https?:\/\//i.test(value) ? value : "https://" + value;
  try {
    const parsed = new URL(toParse);
    const host = parsed.hostname;
    if (!host || host.includes(" ")) return false;
    const parts = host.split(".");
    if (parts.length < 2) return false;
    const tld = parts[parts.length - 1];
    return tld.length >= 2 && /^[a-zA-Z]{2,}$/.test(tld);
  } catch {
    return false;
  }
}

const testimonials = [
  {
    initials: "D",
    name: "David",
    title: "Marketer, Apparel Brand",
    quote:
      "DVYB is extremely efficient. It's quite incredible that they've rolled up ad search, save and creation into one powerful platform. Incredible experience. Highly recommend.",
  },
  {
    initials: "M",
    name: "Mary",
    title: "Founder, Skincare Brand",
    quote:
      "Game changer for my business. I'm shipping ads like never before and I'm driving more sales because I'm choosing what's already working... just would not have been able to do this without DVYB.",
  },
  {
    initials: "S",
    name: "Selena",
    title: "Brand Manager, Multiple Brands",
    quote:
      "The images created are hyper-realistic and the backgrounds are great. They've really done a fantastic job. I'm excited to see what's next.",
  },
  {
    initials: "A",
    name: "Anjali",
    title: "Brand Manager, Footwear Brand",
    quote:
      "The fact that DVYB can automatically identify my brand's competitors and the ads they're running is by itself huge. The fact that I can convert them into my ads using my products is soooo cool. My marketing team is in love.",
  },
  {
    initials: "M",
    name: "Mathieu",
    title: "Social Media Agency Owner",
    quote:
      "Saved a straight few hundred dollars every month, let alone the sanity of my team. Give this a shot, you'll be blown away.",
  },
];

const StarsRating = () => (
  <div className="flex gap-0.5">
    {[...Array(5)].map((_, i) => (
      <Star key={i} className="w-4 h-4 fill-cta text-cta" />
    ))}
  </div>
);

interface TestimonialsSectionProps {
  /** When provided, show URL input + Generate for free button (wander-connect style) */
  onOpenOnboardingWithUrl?: (url: string) => void;
}

export function TestimonialsSection({ onOpenOnboardingWithUrl }: TestimonialsSectionProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteError, setWebsiteError] = useState<string | null>(null);

  const handleCtaClick = () => {
    if (!onOpenOnboardingWithUrl) return;
    if (!websiteUrl.trim()) {
      setWebsiteError("Please enter your website URL.");
      return;
    }
    if (!isValidWebsiteUrl(websiteUrl)) {
      setWebsiteError("Please enter a valid website URL like yourbrand.com or https://yourbrand.com.");
      return;
    }
    setWebsiteError(null);
    onOpenOnboardingWithUrl(normalizeUrl(websiteUrl));
  };

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

  // Auto-rotate every 15 seconds (matches wanderConnect)
  useEffect(() => {
    if (!api) return;
    const interval = setInterval(() => api.scrollNext(), 15000);
    return () => clearInterval(interval);
  }, [api]);

  return (
    <section className="py-16 sm:py-24 px-4 sm:px-6" style={{ background: "var(--gradient-section-1)" }}>
      <div className="container mx-auto">
        <div className="text-center mb-10 sm:mb-16 px-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-4 sm:mb-6">
            Built with <span className="text-cta">❤️</span> for small teams and agencies
          </h2>
          {onOpenOnboardingWithUrl && (
            <div className="flex flex-col items-center gap-2 md:gap-3 mt-6">
              <div className="flex flex-col md:flex-row gap-3 w-full max-w-xl mx-auto">
                <Input
                  type="url"
                  placeholder="https://yourbrand.com"
                  value={websiteUrl}
                  onChange={(e) => {
                    setWebsiteUrl(e.target.value);
                    if (websiteError) setWebsiteError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleCtaClick())}
                  className="h-12 md:h-14 text-base md:text-lg px-5 rounded-full border-2 border-foreground dark:border-cta bg-card/80 backdrop-blur-sm shadow-soft"
                />
                <button
                  type="button"
                  onClick={handleCtaClick}
                  disabled={!websiteUrl.trim()}
                  className="group relative h-12 md:h-14 px-8 md:px-10 bg-cta text-cta-foreground rounded-full font-semibold text-base md:text-lg transition-all duration-300 hover:scale-105 flex items-center justify-center gap-3 whitespace-nowrap disabled:opacity-60 disabled:hover:scale-100"
                  style={{ boxShadow: "0 0 40px -10px hsl(25 100% 55% / 0.5)" }}
                >
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                  </span>
                  Generate for free
                </button>
              </div>
              {websiteError && (
                <p className="text-xs text-red-500">{websiteError}</p>
              )}
              <p className="text-xs md:text-sm text-muted-foreground tracking-wide">
                No credit card · Takes 3 minutes
              </p>
            </div>
          )}
        </div>

        <div className="relative flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => api?.scrollPrev()}
            className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-muted transition-colors -translate-x-1 sm:translate-x-0"
            aria-label="Previous testimonial"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-foreground" />
          </button>
          <Carousel setApi={setApi} opts={{ loop: true, align: "start", containScroll: "trimSnaps" }} className="flex-1 min-w-0 overflow-hidden">
            <CarouselContent className="-ml-3 sm:-ml-5">
              {testimonials.map((testimonial) => (
                <CarouselItem key={testimonial.name} className="pl-3 sm:pl-5 basis-full md:basis-1/2 flex">
                  <div className="bg-card rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 shadow-card border border-border/50 flex flex-col w-full min-h-[200px] sm:min-h-[220px]">
                    <div className="flex items-center justify-between mb-4 sm:mb-6 shrink-0">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-cta/20 flex items-center justify-center text-xs sm:text-sm font-semibold text-cta shrink-0">
                          {testimonial.initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-display font-semibold truncate">{testimonial.name}</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground truncate">{testimonial.title}</span>
                        </div>
                      </div>
                      <StarsRating />
                    </div>
                    <p className="text-muted-foreground text-xs sm:text-sm leading-relaxed flex-1 min-h-0 line-clamp-4 sm:line-clamp-none">
                      &quot;{testimonial.quote}&quot;
                    </p>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>

          </Carousel>
          <button
            type="button"
            onClick={() => api?.scrollNext()}
            className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-muted transition-colors translate-x-1 sm:translate-x-0"
            aria-label="Next testimonial"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-foreground" />
          </button>
        </div>

        {/* Dot indicators */}
        <div className="flex items-center justify-center gap-2 mt-8">
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
    </section>
  );
}
