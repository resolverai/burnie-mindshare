"use client";

import { useRef, useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

const LANDING_VIDEO_URL = "https://burnie-videos.s3.us-east-1.amazonaws.com/dvyb_landing_video.mp4";

function scrollToHeroAndFocusInput() {
  document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => {
    document.getElementById("hero-website-input")?.focus();
  }, 500);
}

export function LandingVideoSection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playWhenInView = () => {
      video.muted = true;
      video.play().catch(() => {});
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;
        if (entry.isIntersecting) {
          playWhenInView();
        } else {
          video.muted = true;
          video.pause();
        }
      },
      { threshold: 0.2, rootMargin: "0px" }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const handleVideoClick = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted) {
      video.muted = false;
      setIsMuted(false);
      video.play().catch(() => {});
    } else {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  };

  return (
    <section className="w-full">
      <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
        <video
          ref={videoRef}
          src={LANDING_VIDEO_URL}
          className="w-full h-full object-cover"
          autoPlay
          loop
          muted
          playsInline
        />
        {isMuted && (
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-white text-sm backdrop-blur-sm">
            <Volume2 className="h-4 w-4" />
            <span>Tap for sound</span>
          </div>
        )}
        <div
          className="absolute inset-0 flex items-end justify-center pb-[10%] cursor-pointer"
          onClick={handleVideoClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleVideoClick();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={isMuted ? "Tap for sound" : "Play or pause video"}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollToHeroAndFocusInput();
            }}
            className="px-8 py-4 bg-cta hover:bg-cta/90 text-cta-foreground font-semibold text-lg rounded-full transition-colors shadow-[0_4px_30px_hsl(25_100%_50%/0.5)] hover:shadow-[0_6px_40px_hsl(25_100%_50%/0.65)]"
          >
            Try for free
          </button>
        </div>
      </div>
    </section>
  );
}
