"use client";

import { ShowcaseCarousel } from "./ShowcaseCarousel";

export function CarouselSection() {
  return (
    <section id="showcase" className="py-8 sm:py-10 md:py-12 px-4 sm:px-6 relative scroll-mt-20" style={{ background: "var(--gradient-carousel)" }}>
      <div className="absolute inset-y-0 left-0 w-24 sm:w-32 md:w-48 bg-gradient-to-r from-[hsl(35_85%_92%)] via-[hsl(35_85%_92%/0.6)] to-transparent pointer-events-none z-20" />
      <div className="absolute inset-y-0 right-0 w-24 sm:w-32 md:w-48 bg-gradient-to-l from-[hsl(200_80%_90%)] via-[hsl(200_80%_90%/0.6)] to-transparent pointer-events-none z-20" />
      <div className="container mx-auto relative z-10">
        <ShowcaseCarousel />
      </div>
    </section>
  );
}
