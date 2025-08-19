import React from "react";
import { cn } from "@/lib/utils";

type ProgressSliderProps = {
  segments: number;
  position: number; // 0..(segments-1)
  className?: string;
};

export default function ProgressSlider({ segments, position, className }: ProgressSliderProps) {
  if (segments <= 1) return null;

  // Calculate the position of the sliding indicator
  const windowWidth = 100 / segments; // percent width per segment
  const currentPosition = position % segments; // Ensure position wraps around
  const left = (currentPosition / segments) * 100; // 0..100 position
  
  return (
    <div className={cn("relative h-2 rounded-full bg-white/10 overflow-hidden", className)}>
      <div
        className="absolute inset-y-0 rounded-full bg-white transition-all duration-300 ease-out"
        style={{ 
          width: `${windowWidth}%`, 
          left: `${left}%`,
          transform: 'translateZ(0)' // Hardware acceleration for smooth animation
        }}
      />
    </div>
  );
}
