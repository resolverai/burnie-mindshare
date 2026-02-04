"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Heart, Video, Loader2 } from "lucide-react";
import { NavigationLanding } from "@/components/landing/NavigationLanding";
import { FooterLanding } from "@/components/landing/FooterLanding";

const categories = ["All", "SaaS", "DTC", "Real Estate", "Fashion", "Food", "Tech", "Health"];

type AspectRatio = "9:16" | "16:9" | "1:1";

interface Template {
  id: number;
  title: string;
  category: string;
  aspectRatio: AspectRatio;
  image: string;
  isVideo: boolean;
  videoSrc?: string;
}

// Same static assets as new frontend (wander-discover-connect) Explore page — replace with dynamic later
const imagePaths = [
  "/landing/warehouse-1.png",
  "/landing/warehouse-2.webp",
  "/landing/chef-1.png",
  "/landing/fitness.jpg",
  "/landing/chef-2.jpg",
  "/landing/pottery.jpg",
  "/landing/grocery.png",
];

const videoPaths = [
  "/landing/video-celsius.mp4",
  "/landing/video-daise.mp4",
  "/landing/video-lip.mp4",
  "/landing/video-multi.mp4",
  "/landing/video-step.mp4",
  "/landing/video-watch.mp4",
];

const aspectRatios: AspectRatio[] = ["9:16", "16:9", "1:1"];
const templateTitles = [
  "Product Launch",
  "Brand Story",
  "Property Tour",
  "Collection Drop",
  "Recipe Video",
  "App Demo",
  "Testimonial",
  "Promo Reel",
  "Feature Highlight",
  "Lifestyle Ad",
  "Quick Tips",
  "Behind the Scenes",
  "Tutorial",
  "Unboxing",
  "Workout Routine",
  "Home Tour",
  "Case Study",
  "Event Recap",
  "How-To Guide",
  "Customer Review",
  "Flash Sale",
  "New Arrival",
  "Seasonal Promo",
  "Team Intro",
  "Product Demo",
  "Success Story",
  "Before & After",
  "Day in Life",
  "Tips & Tricks",
  "Announcement",
];

const getRandomAspectRatio = (): AspectRatio => {
  const rand = Math.random();
  if (rand < 0.5) return "9:16";
  if (rand < 0.75) return "1:1";
  return "16:9";
};

const generateTemplates = (startId: number, count: number): Template[] => {
  const templates: Template[] = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const isVideo = Math.random() > 0.4;
    templates.push({
      id,
      title: templateTitles[id % templateTitles.length],
      category: categories[1 + (id % (categories.length - 1))],
      aspectRatio: getRandomAspectRatio(),
      image: imagePaths[Math.floor(Math.random() * imagePaths.length)],
      isVideo,
      videoSrc: isVideo ? videoPaths[Math.floor(Math.random() * videoPaths.length)] : undefined,
    });
  }
  return templates;
};

const INITIAL_COUNT = 30;
const LOAD_MORE_COUNT = 15;

const getAspectRatioClass = (ratio: AspectRatio) => {
  switch (ratio) {
    case "9:16":
      return "aspect-[9/16]";
    case "16:9":
      return "aspect-[16/9]";
    case "1:1":
      return "aspect-square";
    default:
      return "aspect-square";
  }
};

export default function ExplorePage() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<Template[]>(() => generateTemplates(1, INITIAL_COUNT));
  const [isLoading, setIsLoading] = useState(false);
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const filteredTemplates = useMemo(() => {
    return templates
      .filter((template) => {
        const matchesCategory = activeCategory === "All" || template.category === activeCategory;
        const matchesSearch = template.title.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
      })
      .sort(() => Math.random() - 0.5);
  }, [templates, activeCategory, searchQuery]);

  const loadMore = useCallback(() => {
    if (isLoading) return;
    setIsLoading(true);
    setTimeout(() => {
      setTemplates((prev) => [...prev, ...generateTemplates(prev.length + 1, LOAD_MORE_COUNT)]);
      setIsLoading(false);
    }, 500);
  }, [isLoading]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );
    const el = loaderRef.current;
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, isLoading]);

  const handleMouseEnter = (template: Template) => {
    setHoveredId(template.id);
    if (template.videoSrc && videoRefs.current[template.id]) {
      videoRefs.current[template.id]?.play().catch(() => {});
    }
  };

  const handleMouseLeave = (template: Template) => {
    setHoveredId(null);
    if (template.videoSrc && videoRefs.current[template.id]) {
      const video = videoRefs.current[template.id];
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    }
  };

  const handleGetStarted = () => router.push("/?openModal=website");

  return (
    <div className="min-h-screen bg-[hsl(var(--landing-hero-bg))]">
      <NavigationLanding onGetStarted={handleGetStarted} />
      <main className="pt-20 sm:pt-28 pb-12 sm:pb-20 px-4 sm:px-6 bg-[hsl(var(--landing-hero-bg))]">
        <div className="container mx-auto">
          {/* Search Bar */}
          <div className="max-w-2xl mx-auto mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 bg-card border border-border rounded-full px-4 sm:px-6 py-3 sm:py-4 shadow-soft">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm sm:text-base min-w-0"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="flex items-center justify-start sm:justify-center gap-2 flex-nowrap sm:flex-wrap mb-8 sm:mb-12 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                  activeCategory === category
                    ? "bg-[hsl(var(--landing-cta-bg))] text-white"
                    : "bg-[hsl(var(--landing-explore-pill-bg))] text-foreground hover:bg-[hsl(var(--landing-explore-pill-hover))]"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Masonry Grid */}
          <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 sm:gap-4">
            {filteredTemplates.map((template, index) => (
              <div
                key={template.id}
                className={`mb-3 sm:mb-4 break-inside-avoid group relative rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer animate-scale-in ${getAspectRatioClass(template.aspectRatio)}`}
                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                onMouseEnter={() => handleMouseEnter(template)}
                onMouseLeave={() => handleMouseLeave(template)}
              >
                {template.videoSrc ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.image}
                      alt={template.title}
                      className={`w-full h-full object-cover absolute inset-0 transition-opacity duration-300 ${
                        hoveredId === template.id ? "opacity-0" : "opacity-100"
                      }`}
                    />
                    <video
                      ref={(el) => {
                        videoRefs.current[template.id] = el;
                      }}
                      src={template.videoSrc}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${
                        hoveredId === template.id ? "opacity-100" : "opacity-0"
                      }`}
                      muted
                      playsInline
                      loop
                    />
                  </>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={template.image}
                    alt={template.title}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 via-foreground/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Top Icons */}
                <div className="absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <div className="w-6 h-6 sm:w-7 sm:h-7 bg-card/90 backdrop-blur-sm rounded-md flex items-center justify-center">
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[hsl(var(--landing-accent-orange))] rounded-sm" />
                    </div>
                    {template.isVideo && (
                      <div className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-card/90 backdrop-blur-sm rounded-md flex items-center gap-1">
                        <Video className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        <span className="text-[10px] sm:text-xs font-medium">Video</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="w-7 h-7 sm:w-8 sm:h-8 bg-card/90 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-card transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Heart className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </div>

                {/* Bottom Info */}
                <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-white font-medium text-xs sm:text-sm truncate">
                        {template.title}
                      </p>
                      <p className="text-white/70 text-[10px] sm:text-xs">{template.category}</p>
                    </div>
                    <span className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-card/90 backdrop-blur-sm rounded-full text-[10px] sm:text-xs whitespace-nowrap flex-shrink-0">
                      {template.aspectRatio}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Infinite Scroll Loader */}
          <div ref={loaderRef} className="flex justify-center py-8">
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading more...</span>
              </div>
            )}
          </div>
        </div>
      </main>
      <FooterLanding />
    </div>
  );
}
