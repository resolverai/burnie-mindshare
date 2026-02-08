"use client";

const brands = [
  { name: "Prezzo", style: "font-semibold" },
  { name: "HELLBABIES", style: "font-serif italic" },
  { name: "cocokind", style: "font-medium tracking-wide" },
  { name: "Rouere", style: "font-serif italic" },
  { name: "Lume", style: "font-semibold text-xl" },
  { name: "Laifen", style: "font-semibold" },
  { name: "Keychron", style: "font-medium" },
  { name: "Flodesk", style: "font-medium" },
];

export function BrandsSection() {
  return (
    <section
      id="trusted-brands"
      className="py-24 px-6 scroll-mt-20 overflow-hidden"
      style={{ background: "var(--gradient-section-2)" }}
    >
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-semibold text-center mb-16">
          Trusted by <span className="text-cta">top brands</span>
        </h2>
        <div className="relative overflow-hidden">
          <div className="flex animate-marquee whitespace-nowrap w-max">
            {[...brands, ...brands].map((brand, index) => (
              <div
                key={`${brand.name}-${index}`}
                className="mx-4 inline-flex shrink-0 px-8 py-4 bg-card rounded-full shadow-soft border border-border/50"
              >
                <span className={`text-foreground text-base ${brand.style}`}>{brand.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
