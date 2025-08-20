"use client";
import React from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";

export type HeroSlide = {
  id: string;
  backgroundUrl: string;
  title: string;
  endText: string;
  tag?: string;
  gallery?: string[];
};

type HeroCarouselProps = {
  slides: HeroSlide[];
  onProgressChange?: (position: number) => void;
};

export default function HeroCarousel({ slides, onProgressChange }: HeroCarouselProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number>(0);

  // Embla carousel with autoplay and snap
  const autoplay = React.useRef(Autoplay({ delay: 4000, stopOnInteraction: false }));
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { 
      loop: slides.length > 1, // Only loop if we have multiple slides
      align: "start", 
      skipSnaps: false, 
      containScroll: "trimSnaps",
      startIndex: 0
    },
    slides.length > 1 ? [autoplay.current] : [] // Only use autoplay if multiple slides
  );

  // Gallery hover handlers for pausing/resuming carousel
  const handleGalleryMouseEnter = React.useCallback(() => {
    if (autoplay.current && slides.length > 1) {
      autoplay.current.stop();
      console.log('🎠 Carousel paused - gallery hovered');
    }
  }, [slides.length]);

  const handleGalleryMouseLeave = React.useCallback(() => {
    if (autoplay.current && slides.length > 1) {
      autoplay.current.play();
      console.log('🎠 Carousel resumed - gallery unhovered');
    }
  }, [slides.length]);

  React.useEffect(() => {
    if (!emblaApi) return;
    
    console.log('🎠 Carousel initialized with', slides.length, 'slides');
    
    const report = () => {
      const currentIndex = emblaApi.selectedScrollSnap();
      
      // Use current slide index for correlated movement
      // For 3 slides: 0, 1, 2 (moves twice, then resets)
      setSelectedIndex(currentIndex);
      onProgressChange?.(currentIndex);
    };
    report();
    emblaApi.on("select", report);
    emblaApi.on("reInit", report);
    
    // Only start animation loop if we have multiple slides
    if (slides.length > 1) {
      let raf = 0;
      const tick = () => {
        report();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  }, [emblaApi, onProgressChange, slides.length]);

  if (!slides || slides.length === 0) {
    return null;
  }

  return (
    <section className="relative bg-yapper-surface">
      <div className="relative w-full aspect-[8/5] md:aspect-[10/2] rounded-[24px] overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
        {/* Embla with full-slide content */}
        <div ref={emblaRef} className="absolute inset-0 overflow-hidden">
          <div className="flex h-full">
            {slides.map((slide, i) => (
              <div key={slide.id + i} className="relative h-full min-w-full pr-6 md:pr-8">
                {/* Background */}
                <div className="absolute inset-0 rounded-[24px] overflow-hidden">
                  {(() => {
                    const isS3Url = slide.backgroundUrl.includes('amazonaws.com') || slide.backgroundUrl.includes('.s3.');
                    console.log(`🎨 Carousel slide ${i + 1}:`, {
                      url: slide.backgroundUrl.substring(0, 100) + '...',
                      isS3: isS3Url,
                      method: isS3Url ? 'Direct img tag' : 'Next.js Image'
                    });
                    
                    return isS3Url ? (
                      // Use regular img tag for S3 URLs to avoid Next.js proxy
                      <img 
                        src={slide.backgroundUrl} 
                        alt="Campaign background"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.log('🎨 S3 image failed to load:', slide.backgroundUrl);
                          // Fallback to default hero image if S3 image fails
                          const target = e.target as HTMLImageElement;
                          target.src = '/hero.svg';
                        }}
                        onLoad={() => {
                          console.log('🎨 ✅ S3 image loaded successfully');
                        }}
                      />
                    ) : (
                      // Use Next.js Image for local/static images
                      <Image 
                        src={slide.backgroundUrl} 
                        alt="Campaign background" 
                        fill 
                        priority={i === 0} 
                        sizes="100vw" 
                        className="object-cover"
                        onError={(e) => {
                          // Fallback to default hero image if image fails
                          const target = e.target as HTMLImageElement;
                          target.src = '/hero.svg';
                        }}
                      />
                    );
                  })()}
                </div>

                {/* Subtle dark gradient to improve text contrast */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/5 to-black/30" aria-hidden />

                {/* Slide Content */}
                <div className="relative h-full px-4 py-4 md:px-6 md:py-6 flex flex-col md:flex-row items-center md:items-end">
                  <div className="inline-block rounded-[14px] bg-gradient-to-b from-white/20 via-white/20 to-white/20 backdrop-blur-sm p-4 md:p-5">
                    {slide.tag ? (
                      <span className="inline-flex h-8 mb-2 items-center rounded-full bg-[#FFEB68] px-4 text-[#3b2a00] text-sm font-semibold shadow-[0_6px_20px_rgba(0,0,0,0.25)]">
                        {slide.tag}
                      </span>
                    ) : null}
                    <h2 className="text-lg md:text-xl font-semibold tracking-tight text-white font-nt-brick">{slide.title}</h2>
                    <p className="mt-2 text-xs md:text-sm font-semibold text-white/80">{slide.endText}</p>
                  </div>

                  {/* Right-side mini gallery */}
                  {slide.gallery && slide.gallery.length ? (
                    <div className="ml-auto hidden md:flex items-end gap-6">
                      {slide.gallery.slice(0, 2).map((item, idx) => {
                        // Check if this is a number (content count)
                        if (item.match(/^\d+$/)) {
                          return null; // Skip rendering content count here, we'll show it in the third box
                        } else {
                          // Regular image
                          return <GalleryItem key={item + idx} src={item} onMouseEnter={handleGalleryMouseEnter} onMouseLeave={handleGalleryMouseLeave} />;
                        }
                      })}
                      {/* Third box showing content count */}
                      {slide.gallery.length > 2 && slide.gallery[2] && (
                        <div 
                          className="relative w-[180px] h-[120px] rounded-[16px] overflow-hidden bg-white/20 backdrop-blur-md flex items-center justify-center text-white/90 text-center carousel-gallery-3d cursor-pointer"
                          onMouseEnter={handleGalleryMouseEnter}
                          onMouseLeave={handleGalleryMouseLeave}
                        >
                          <div>
                            <div className="text-2xl font-bold">{slide.gallery[2]}</div>
                            <div className="text-sm opacity-80">content pieces</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GalleryItem({ src, onMouseEnter, onMouseLeave }: { 
  src: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div 
      className="relative w-[180px] h-[120px] rounded-[16px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.35)] carousel-gallery-3d cursor-pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Image 
        src={src} 
        alt="gallery" 
        fill 
        className="object-cover"
        onError={(e) => {
          // Hide the gallery item if image fails to load
          const target = e.target as HTMLImageElement;
          const container = target.closest('.relative') as HTMLElement;
          if (container) {
            container.style.display = 'none';
          }
        }}
      />
    </div>
  );
}
