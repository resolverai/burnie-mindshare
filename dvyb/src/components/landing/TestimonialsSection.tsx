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
    <section className="py-24 px-6" style={{ background: "var(--gradient-section-1)" }}>
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">
            Obsessed on by D2C founders and marketers
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Teams across industries use dvyb.ai to scale their creative output.
          </p>
        </div>

        <div className="relative flex items-center gap-4">
          <button
            type="button"
            onClick={() => api?.scrollPrev()}
            className="shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Previous testimonial"
          >
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6 text-foreground" />
          </button>
          <Carousel setApi={setApi} opts={{ loop: true, align: "start", containScroll: "trimSnaps" }} className="flex-1 min-w-0">
            <CarouselContent className="-ml-5">
              {testimonials.map((testimonial) => (
                <CarouselItem key={testimonial.name} className="pl-5 basis-full md:basis-1/2 flex">
                  <div className="bg-card rounded-2xl p-8 shadow-card border border-border/50 flex flex-col w-full h-[220px]">
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

          </Carousel>
          <button
            type="button"
            onClick={() => api?.scrollNext()}
            className="shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-card border border-border shadow-card flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Next testimonial"
          >
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-foreground" />
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
