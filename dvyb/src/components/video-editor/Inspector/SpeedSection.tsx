"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, formatTimeSimple } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Gauge, Clock, Rewind, FastForward } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeedSectionProps {
  clip: Clip;
}

const speedPresets = [
  { value: 0.25, label: "0.25x" },
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
];

export function SpeedSection({ clip }: SpeedSectionProps) {
  const { dispatch } = useVideoEditor();

  const updateSpeed = (speed: number) => {
    dispatch({
      type: "SET_CLIP_SPEED",
      payload: { clipId: clip.id, speed },
    });
  };

  // Calculate source duration (original video length)
  const sourceDuration = clip.sourceDuration || (clip.duration * (clip.speed || 1));
  // Current timeline duration (what's shown on timeline)
  const currentDuration = clip.duration;
  // New duration if speed were 1x
  const originalDuration = sourceDuration;

  return (
    <Accordion type="single" collapsible defaultValue="speed">
      <AccordionItem value="speed" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            Speed & Time
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Speed Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Playback Speed</span>
              <span className="text-xs text-primary font-medium">
                {clip.speed.toFixed(2)}x
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Rewind className="h-3.5 w-3.5 text-muted-foreground" />
              <Slider
                value={[clip.speed]}
                onValueChange={([v]) => updateSpeed(v)}
                min={0.1}
                max={4}
                step={0.05}
                className="flex-1"
              />
              <FastForward className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Speed Presets */}
          <div className="space-y-2">
            <span className="text-[10px] text-muted-foreground">Presets</span>
            <div className="grid grid-cols-6 gap-1">
              {speedPresets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => updateSpeed(preset.value)}
                  className={cn(
                    "px-2 py-1.5 rounded text-[10px] font-medium transition-colors",
                    clip.speed === preset.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 hover:bg-secondary"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration Info */}
          <div className="p-3 rounded-lg bg-secondary/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Source Duration</span>
              </div>
              <span className="text-xs font-medium">
                {formatTimeSimple(originalDuration)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">Timeline Duration</span>
              </div>
              <span className="text-xs font-medium text-primary">
                {formatTimeSimple(currentDuration)}
              </span>
            </div>
            {clip.speed !== 1 && (
              <p className="text-[10px] text-muted-foreground">
                At {clip.speed}x speed, {formatTimeSimple(originalDuration)} of video plays in {formatTimeSimple(currentDuration)}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
