"use client";

import { formatTimeSimple } from "@/types/video-editor";

interface TimeRulerProps {
  duration: number;
  pixelsPerSecond: number;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function TimeRuler({ duration, pixelsPerSecond, onClick }: TimeRulerProps) {
  // Calculate interval based on zoom level
  const getInterval = () => {
    if (pixelsPerSecond >= 100) return 1;
    if (pixelsPerSecond >= 50) return 2;
    if (pixelsPerSecond >= 25) return 5;
    return 10;
  };

  const interval = getInterval();
  const markers = [];

  for (let i = 0; i <= duration; i += interval) {
    markers.push(i);
  }

  return (
    <div
      className="h-8 border-b border-border/30 relative bg-muted/30 cursor-pointer select-none"
      style={{ width: duration * pixelsPerSecond }}
      onClick={onClick}
    >
      {markers.map((time) => (
        <div
          key={time}
          className="absolute top-0 bottom-0 flex flex-col items-center"
          style={{ left: time * pixelsPerSecond }}
        >
          <span className="text-[10px] text-muted-foreground mt-1">
            {formatTimeSimple(time)}
          </span>
          <div className="flex-1 w-px bg-border/50" />
        </div>
      ))}

      {/* Sub-markers */}
      {interval > 1 && markers.flatMap((time) => {
        const subMarkers = [];
        for (let i = 1; i < interval; i++) {
          const subTime = time + i;
          if (subTime <= duration) {
            subMarkers.push(
              <div
                key={`sub-${subTime}`}
                className="absolute bottom-0 h-2 w-px bg-border/30"
                style={{ left: subTime * pixelsPerSecond }}
              />
            );
          }
        }
        return subMarkers;
      })}
    </div>
  );
}
