"use client";

import { Search } from "lucide-react";

const steps = [
  { number: 1, title: "Add your brand's website link", description: "Our AI learns your brand aesthetic, identifies competitors, and extracts their winning ads." },
  { number: 2, title: "Select the winning ad you want to replicate", description: "Upload your product image and watch the magic unfold. Their winning ad is now your winning ad." },
  { number: 3, title: "DONE. Save or edit your winning ad creative and caption", description: "The best visuals, hooks and format - replicated in seconds.", highlight: "seconds" },
];

const filters = ["Industry", "Platform", "Ad Type", "Tone"];

const previewImages = [
  "/landing/showcase-1.png",
  "/landing/showcase-2.jpg",
  "/landing/showcase-3.png",
  "/landing/showcase-4.png",
  "/landing/showcase-5.png",
  "/landing/showcase-6.png",
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 px-6 scroll-mt-20" style={{ background: "var(--gradient-section-1)" }}>
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-semibold text-center mb-16">
          How it works — <span className="text-cta">3 simple steps</span>
        </h2>
        <div className="grid md:grid-cols-2 gap-16 items-start">
          <div className="space-y-12">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className="flex gap-6 animate-slide-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <span className="text-5xl md:text-6xl font-display font-semibold text-muted-foreground/50">
                  {step.number}.
                </span>
                <div>
                  <h3 className="text-xl md:text-2xl font-display font-semibold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
                    {step.highlight ? (
                      <>
                        {step.description.split(step.highlight).map((part, i, arr) => (
                          <span key={i}>
                            {part}
                            {i < arr.length - 1 && <strong className="text-cta font-semibold">{step.highlight}</strong>}
                          </span>
                        ))}
                      </>
                    ) : (
                      step.description
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-card rounded-3xl p-8 shadow-card border border-border/50">
            <div className="flex items-center gap-3 bg-secondary/50 rounded-full px-5 py-3 mb-6 border border-border/50">
              <Search className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Search by industry, format, goal...</span>
            </div>
            <div className="flex gap-2 mb-8">
              {filters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className="px-4 py-2 text-xs bg-secondary/50 rounded-full hover:bg-secondary transition-colors border border-border/50"
                >
                  {filter} ▾
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {previewImages.map((image, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-xl overflow-hidden hover:scale-105 transition-transform duration-300 shadow-soft"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt={`Template preview ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
