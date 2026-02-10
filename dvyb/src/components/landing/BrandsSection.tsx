"use client";

const brands = [
  { name: "Prezzo", style: "font-semibold" },
  { name: "HELLBABIES", style: "font-serif italic" },
  { name: "cocokind", style: "font-medium tracking-wide" },
  { name: "Rouere", style: "font-serif italic" },
  { name: "Lume", style: "font-semibold text-xl" },
  { name: "Glossier", style: "font-light tracking-widest" },
  { name: "SKIMS", style: "font-bold tracking-tight" },
  { name: "Mejuri", style: "font-serif" },
  { name: "Allbirds", style: "font-medium" },
  { name: "Warby Parker", style: "font-semibold tracking-wide" },
  { name: "Casper", style: "font-bold" },
  { name: "Away", style: "font-light uppercase tracking-widest" },
];

export function BrandsSection() {
  return (
    <section
      id="trusted-brands"
      className="py-10 sm:py-16 px-4 sm:px-6 scroll-mt-20 overflow-hidden"
      style={{ background: "var(--gradient-brands)" }}
    >
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-semibold px-2">
          Create ads like <span className="text-cta">billion dollar brands</span>
        </h2>
      </div>
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 md:w-32 bg-gradient-to-r from-secondary to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 md:w-32 bg-gradient-to-l from-secondary to-transparent z-10 pointer-events-none" />
        <div className="flex animate-marquee">
          {brands.map((brand, index) => (
            <div
              key={`first-${brand.name}-${index}`}
              className="flex-shrink-0 px-4 py-3 sm:px-8 sm:py-4 mx-2 sm:mx-3 bg-card rounded-full shadow-soft"
            >
              <span className={`text-foreground whitespace-nowrap ${brand.style}`}>{brand.name}</span>
            </div>
          ))}
          {brands.map((brand, index) => (
            <div
              key={`second-${brand.name}-${index}`}
              className="flex-shrink-0 px-4 py-3 sm:px-8 sm:py-4 mx-2 sm:mx-3 bg-card rounded-full shadow-soft"
            >
              <span className={`text-foreground whitespace-nowrap ${brand.style}`}>{brand.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
