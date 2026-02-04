"use client";

const features = [
  {
    title: "Built to convert — not just look good",
    description: "Ads designed to stop scroll, communicate value, and drive action.",
    tag: "Based on real ad patterns",
    image: "/landing/showcase-1.png",
  },
  {
    title: "Hooks and scripts written for real ads",
    description: "No generic AI copy. Inspired by what's already working in your industry.",
    tag: "Industry-proven",
    image: "/landing/showcase-4.png",
  },
  {
    title: "Every format. One consistent brand.",
    description: "Automatically adapted for Reels, TikTok, Shorts, and paid placements.",
    tag: "Platform-native",
    image: "/landing/showcase-6.png",
  },
];

export function FeaturesSection() {
  return (
    <section className="py-24 px-6" style={{ background: "var(--gradient-section-2)" }}>
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-semibold text-center mb-16">
          Built for <span className="text-cta">performance</span>
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group bg-card rounded-3xl p-8 shadow-card border border-border/50 hover:border-border transition-all duration-500 animate-fade-up"
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              <h3 className="text-xl font-display font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground text-sm mb-8 leading-relaxed">{feature.description}</p>
              <div className="aspect-video rounded-2xl relative overflow-hidden shadow-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={feature.image}
                  alt={feature.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute bottom-3 left-3">
                  <span className="px-3 py-1.5 bg-card/90 backdrop-blur-sm rounded-full text-xs font-medium border border-border/50">
                    {feature.tag}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
