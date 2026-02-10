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
            Obsessed on by D2C founders and marketers
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base md:text-lg">
            Teams across industries use dvyb.ai to scale their creative output.
          </p>
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
