"use client";

const brands = [
  { name: "Prezzo", style: "font-semibold" },
  { name: "HELLBABIES", style: "font-serif italic" },
  { name: "cocokind", style: "font-medium tracking-wide" },
  { name: "Rouere", style: "font-serif italic" },
  { name: "Lume", style: "font-semibold text-xl" },
];

export function BrandsSection() {
  return (
    <section className="py-16 px-6" style={{ background: "var(--gradient-brands)" }}>
      <div className="container mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-semibold mb-4">
          Create epic ads like billion dollar brands
        </h2>
        <div className="flex items-center justify-center gap-6 flex-wrap">
          {brands.map((brand, index) => (
            <div
              key={brand.name}
              className="px-8 py-4 bg-card rounded-full shadow-soft hover:shadow-card transition-all duration-300 animate-fade-up"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <span className={`text-foreground ${brand.style}`}>{brand.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
