"use client";

import { useState, useEffect, useRef } from "react";
import { Video, Sparkles } from "lucide-react";

// Match original: center-to-center ~200px with 192px cards => ~8px gap (not 24) so visual gap doesn’t grow away from center
const GAP = 8;

function useCarouselBreakpoint() {
  const [width, setWidth] = useState(768);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (width < 640) return { cardWidth: 128 };
  if (width < 768) return { cardWidth: 144 };
  if (width < 1024) return { cardWidth: 168 };
  return { cardWidth: 192 };
}

const showcaseItems = [
  { id: 1, beforeImage: "/landing/before-1.jpg", afterContent: "/landing/video-celsius.mp4", category: "Fashion", isVideo: true },
  { id: 2, beforeImage: "/landing/showcase-2.jpg", afterContent: "/landing/video-daise.mp4", category: "DTC", isVideo: true },
  { id: 3, beforeImage: "/landing/before-2.jpeg", afterContent: "/landing/video-lip.mp4", category: "Apparel", isVideo: true },
  { id: 4, beforeImage: "/landing/showcase-4.png", afterContent: "/landing/video-multi.mp4", category: "Jewelry", isVideo: true },
  { id: 5, beforeImage: "/landing/showcase-5.png", afterContent: "/landing/video-step.mp4", category: "Swimwear", isVideo: true },
  { id: 6, beforeImage: "/landing/showcase-6.png", afterContent: "/landing/video-watch.mp4", category: "Beauty", isVideo: true },
  { id: 7, beforeImage: "/landing/showcase-3.png", afterContent: "/landing/after-1.png", category: "Luxury", isVideo: false },
];

const COPIES = 3; // triple the strip so we can loop seamlessly

export function ShowcaseCarousel() {
  const { cardWidth } = useCarouselBreakpoint();
  const totalItems = showcaseItems.length;
  const totalStrip = totalItems * COPIES;
  const startIndex = totalItems; // start in the "middle" copy so we can loop both ways

  const [scrollIndex, setScrollIndex] = useState(startIndex);
  const [phase, setPhase] = useState<"idle" | "transforming" | "showing">("idle");
  const [transformedItems, setTransformedItems] = useState<Set<number>>(new Set());
  const [skipTransition, setSkipTransition] = useState(false);
  const videoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});
  const isFirstRender = useRef(true);

  const activeIndex = scrollIndex % totalItems;

  // Translate the whole strip so the active card is at center
  const stripTranslateX = -(scrollIndex * (cardWidth + GAP) + cardWidth / 2);

  // When we reach the end of the middle copy (scrollIndex === 2*N), reset to start of middle copy (N) so the loop is seamless
  const handleStripTransitionEnd = () => {
    if (scrollIndex === totalItems * 2) {
      setSkipTransition(true);
      setScrollIndex(startIndex);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSkipTransition(false));
      });
    }
  };

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      const timer = setTimeout(() => setPhase("transforming"), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (phase === "transforming") {
      setTransformedItems((prev) => new Set(prev).add(activeIndex));
      const video = videoRefs.current[scrollIndex];
      if (video && showcaseItems[activeIndex].isVideo) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
      const timer = setTimeout(() => setPhase("showing"), 500);
      return () => clearTimeout(timer);
    }
  }, [phase, activeIndex, scrollIndex]);

  useEffect(() => {
    if (phase === "showing") {
      const timer = setTimeout(() => {
        const exitingContentIndex = (activeIndex - 2 + totalItems) % totalItems;
        setTransformedItems((prev) => {
          const newSet = new Set(prev);
          newSet.delete(exitingContentIndex);
          return newSet;
        });
        const exitingStripIndex = (scrollIndex - 2 + totalStrip) % totalStrip;
        const exitingVideo = videoRefs.current[exitingStripIndex];
        if (exitingVideo) {
          exitingVideo.pause();
          exitingVideo.currentTime = 0;
        }
        // At loop boundary: reset to middle copy instead of advancing (transitionend may not fire)
        if (scrollIndex === totalItems * 2) {
          setSkipTransition(true);
          setScrollIndex(startIndex);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setSkipTransition(false));
          });
        } else {
          setScrollIndex((prev) => prev + 1);
        }
        setPhase("idle");
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [phase, activeIndex, scrollIndex, totalItems, totalStrip, startIndex]);

  useEffect(() => {
    if (phase === "idle" && !isFirstRender.current) {
      const timer = setTimeout(() => setPhase("transforming"), 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, activeIndex]);

  // Room at edges so no content is clipped: strip extent + generous buffer (scaled cards + rounding)
  const stripExtent = (totalStrip - 1) * (cardWidth + GAP) + cardWidth / 2;
  const edgeRoom = stripExtent + Math.max(800, cardWidth * 3);

  return (
    <div className="mb-4 overflow-x-hidden">
      <div
        className="relative h-[320px] sm:h-[400px] md:h-[440px] lg:h-[480px] overflow-hidden mx-auto"
        style={{
          perspective: "1200px",
          width: `calc(100% + ${edgeRoom * 2}px)`,
          marginLeft: -edgeRoom,
        }}
      >
        {/* Triple strip; cards scale by distance from center for 3D effect (center = max height) */}
        <div
          className="absolute top-1/2 flex items-center -translate-y-1/2"
          style={{
            left: "50%",
            gap: GAP,
            transform: `translateY(-50%) translateX(${stripTranslateX}px)`,
            transition: skipTransition ? "none" : "transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onTransitionEnd={handleStripTransitionEnd}
        >
          {Array.from({ length: totalStrip }, (_, stripIndex) => {
            const contentIndex = stripIndex % totalItems;
            const item = showcaseItems[contentIndex];
            const isCenter = stripIndex === scrollIndex;
            const isTransformed = transformedItems.has(contentIndex);
            const isCurrentlyTransforming = isCenter && (phase === "transforming" || phase === "showing");
            const shouldShowAd = isTransformed || isCurrentlyTransforming;

            const distance = Math.abs(stripIndex - scrollIndex);
            const scale = distance === 0 ? 1 : distance === 1 ? 0.8 : distance === 2 ? 0.65 : 0.5;
            const opacity = distance === 0 ? 1 : 0.8;
            const zIndex = Math.max(0, 10 - distance);

            return (
              <div
                key={`strip-${stripIndex}`}
                className={`relative flex-shrink-0 aspect-[9/16] rounded-xl sm:rounded-2xl overflow-hidden shadow-card cursor-pointer group ${
                  isCurrentlyTransforming ? "animate-pulse-subtle" : ""
                }`}
                style={{
                  width: cardWidth,
                  transform: `scale(${scale})`,
                  transformOrigin: "center center",
                  opacity,
                  zIndex,
                  transition: "transform 0.8s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.8s",
                }}
              >
                <div
                  className="absolute inset-0 transition-opacity duration-500"
                  style={{ opacity: shouldShowAd ? 0 : 1 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.beforeImage}
                    alt={`${item.category} before`}
                    className="w-full h-full object-cover"
                  />
                  {isCenter && !shouldShowAd && (
                    <div className="landing-pill absolute top-3 right-3 bg-foreground/90 text-white">
                      Product
                    </div>
                  )}
                </div>
                <div
                  className="absolute inset-0 transition-opacity duration-500"
                  style={{ opacity: shouldShowAd ? 1 : 0 }}
                >
                  {item.isVideo ? (
                    <video
                      ref={(el) => {
                        videoRefs.current[stripIndex] = el;
                      }}
                      src={item.afterContent}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      loop
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.afterContent}
                      alt={`${item.category} after`}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div
                  className={`absolute inset-0 bg-gradient-to-t from-foreground/40 to-transparent transition-opacity duration-300 pointer-events-none ${
                    isCenter ? "opacity-100" : "opacity-0"
                  }`}
                />
                <div className="absolute top-3 left-3 right-3 flex justify-between items-center gap-2 z-10 px-2 sm:px-3">
                  {item.isVideo ? (
                    <div className="landing-pill-sm gap-1 bg-foreground/90 text-white shadow-soft">
                      <Video className="w-2.5 h-2.5 shrink-0" />
                      <span>Video</span>
                    </div>
                  ) : (
                    <div />
                  )}
                  {isCurrentlyTransforming ? (
                    <div className="landing-pill-sm gap-1 bg-[hsl(var(--landing-accent-orange-ad-ready))] text-white">
                      <Sparkles className="w-2.5 h-2.5 shrink-0" />
                      <span>Ad Ready</span>
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
                <div
                  className={`absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 transition-opacity duration-300 z-10 ${
                    isCenter ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <span className="landing-pill gap-1.5 bg-white/95 text-[hsl(var(--landing-accent-orange))] shadow-soft">
                    <span aria-hidden>▼</span> Template
                  </span>
                  <span className="landing-pill bg-white/95 text-foreground shadow-soft">
                    {item.category}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 sm:gap-6 md:gap-8 mt-4 sm:mt-6 text-xs sm:text-sm text-muted-foreground justify-center px-2">
        {["SaaS", "DTC", "Real Estate", "Jewelry", "Apps"].map((category) => (
          <span key={category} className="hover:text-foreground cursor-pointer transition-colors">
            {category}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5 sm:gap-2 mt-4 sm:mt-6">
        {showcaseItems.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => {
              const currentVideo = videoRefs.current[scrollIndex];
              if (currentVideo) {
                currentVideo.pause();
                currentVideo.currentTime = 0;
              }
              setScrollIndex(startIndex + index);
              setPhase("idle");
            }}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === activeIndex ? "bg-[hsl(var(--landing-accent-orange))] w-6" : "w-2 bg-muted hover:bg-muted-foreground"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
