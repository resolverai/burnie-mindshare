"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Volume2, VolumeX, TrendingUp, TrendingDown, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

interface AudioSectionProps {
  clip: Clip;
}

export function AudioSection({ clip }: AudioSectionProps) {
  const { dispatch, state } = useVideoEditor();

  const updateAudio = (key: "volume" | "fadeIn" | "fadeOut" | "muted", value: number | boolean) => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: { id: clip.id, [key]: value },
    });
  };

  // Video track clips (sorted by start time) for "trim to clip end" — music only
  const videoTrackClips = useMemo(() => {
    const videoTrack = state.tracks.find((t) => t.type === "video");
    if (!videoTrack) return [];
    return [...videoTrack.clips].sort((a, b) => a.startTime - b.startTime);
  }, [state.tracks]);

  const isMusicClip = clip.type === "music";
  const trimToClipEnd = Boolean(clip.trimToClipEnd);
  const selectedVideoClipId = clip.trimToVideoClipId ?? null;

  const setTrimToClipEnd = (enabled: boolean, videoClipId?: string) => {
    if (!enabled) {
      dispatch({
        type: "UPDATE_CLIP",
        payload: { id: clip.id, trimToClipEnd: false, trimToVideoClipId: undefined },
      });
      return;
    }
    const videoClip = videoClipId
      ? videoTrackClips.find((c) => c.id === videoClipId)
      : videoTrackClips[0];
    if (!videoClip) return;
    const videoEndTime = videoClip.startTime + videoClip.duration;
    const newDuration = Math.max(0.1, videoEndTime - clip.startTime);
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        trimToClipEnd: true,
        trimToVideoClipId: videoClip.id,
        duration: newDuration,
      },
    });
  };

  const handleTrimVideoClipSelect = (videoClipId: string) => {
    const videoClip = videoTrackClips.find((c) => c.id === videoClipId);
    if (!videoClip) return;
    const videoEndTime = videoClip.startTime + videoClip.duration;
    const newDuration = Math.max(0.1, videoEndTime - clip.startTime);
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        trimToClipEnd: true,
        trimToVideoClipId: videoClip.id,
        duration: newDuration,
      },
    });
  };

  return (
    <Accordion type="single" collapsible defaultValue="audio">
      <AccordionItem value="audio" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-primary" />
            Audio
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Mute toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              {clip.muted ? (
                <VolumeX className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-xs font-medium">Mute Audio</span>
            </div>
            <button
              onClick={() => updateAudio("muted", !clip.muted)}
              className={cn(
                "relative w-9 h-5 rounded-full transition-colors",
                clip.muted ? "bg-destructive" : "bg-secondary"
              )}
            >
              <div
                className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                  clip.muted ? "left-4" : "left-0.5"
                )}
              />
            </button>
          </label>

          {/* Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Volume</span>
              <span className="text-xs text-muted-foreground">{clip.volume}%</span>
            </div>
            <div className="flex items-center gap-2">
              <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
              <Slider
                value={[clip.volume]}
                onValueChange={([v]) => updateAudio("volume", v)}
                min={0}
                max={200}
                step={1}
                disabled={clip.muted}
                className="flex-1"
              />
              <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            {clip.volume > 100 && (
              <p className="text-[10px] text-yellow-500">
                Volume above 100% may cause distortion
              </p>
            )}
          </div>

          {/* Fade In */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Fade In</span>
              </div>
              <span className="text-xs text-muted-foreground">{clip.fadeIn.toFixed(1)}s</span>
            </div>
            <Slider
              value={[clip.fadeIn]}
              onValueChange={([v]) => updateAudio("fadeIn", v)}
              min={0}
              max={5}
              step={0.1}
              disabled={clip.muted}
              className="w-full"
            />
          </div>

          {/* Fade Out */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Fade Out</span>
              </div>
              <span className="text-xs text-muted-foreground">{clip.fadeOut.toFixed(1)}s</span>
            </div>
            <Slider
              value={[clip.fadeOut]}
              onValueChange={([v]) => updateAudio("fadeOut", v)}
              min={0}
              max={5}
              step={0.1}
              disabled={clip.muted}
              className="w-full"
            />
          </div>

          {/* Background music only: trim to end when a video clip ends */}
          {isMusicClip && (
            <div className="space-y-3 pt-2 border-t border-border/30">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Trim to clip end</span>
                </div>
                <button
                  onClick={() => setTrimToClipEnd(!trimToClipEnd)}
                  className={cn(
                    "relative w-9 h-5 rounded-full transition-colors",
                    trimToClipEnd ? "bg-primary" : "bg-secondary"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                      trimToClipEnd ? "left-4" : "left-0.5"
                    )}
                  />
                </button>
              </label>
              {trimToClipEnd && videoTrackClips.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium">End when video clip</span>
                  <Select
                    value={selectedVideoClipId ?? videoTrackClips[0]?.id ?? ""}
                    onValueChange={handleTrimVideoClipSelect}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select clip" />
                    </SelectTrigger>
                    <SelectContent>
                      {videoTrackClips.map((vc, index) => (
                        <SelectItem key={vc.id} value={vc.id} className="text-xs">
                          Clip {index + 1} (ends {(vc.startTime + vc.duration).toFixed(1)}s)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Music will end at the same time as the selected video clip.
                  </p>
                </div>
              )}
              {trimToClipEnd && videoTrackClips.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Add a video clip to the Video track to trim music to its end.
                </p>
              )}
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
