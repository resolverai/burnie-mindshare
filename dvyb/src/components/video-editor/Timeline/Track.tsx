"use client";

import { useCallback } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Track as TrackType, Asset, generateId, createClip, defaultTextProperties } from "@/types/video-editor";
import { Clip } from "./Clip";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import type { GenerateWithAIContext } from "@/components/video-editor/modals/GenerateWithAIModal";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  isDropTarget: boolean;
  onOpenInspector?: () => void;
  onOpenGenerateAI?: (context: GenerateWithAIContext) => void;
}

export function Track({ track, pixelsPerSecond, isDropTarget, onOpenInspector, onOpenGenerateAI }: TrackProps) {
  const { state, dispatch } = useVideoEditor();
  const isSelected = state.selectedTrackId === track.id;
  const currentTime = state.currentTime;

  const { isOver, setNodeRef } = useDroppable({
    id: track.id,
    disabled: track.locked,
  });

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const assetData = e.dataTransfer.getData("asset");
    const textPresetData = e.dataTransfer.getData("textPreset");

    // Resolve the correct track for an asset type (drop on any track → route to the right one)
    const getTargetTrackForAsset = (asset: Asset): TrackType | null => {
      if (asset.type === "video") return state.tracks.find((t) => t.type === "video") ?? null;
      if (asset.type === "image" || asset.type === "overlay") return state.tracks.find((t) => t.type === "overlay") ?? null;
      if (asset.type === "music") return state.tracks.find((t) => t.type === "music") ?? null;
      if (asset.type === "voiceover") return state.tracks.find((t) => t.type === "voiceover") ?? null;
      if (asset.type === "audio") return state.tracks.find((t) => t.type === "audio") ?? null;
      return null;
    };

    const getLastClipEndTime = (targetTrack: TrackType) =>
      targetTrack.clips.reduce((maxEnd, clip) => {
        const clipEnd = clip.startTime + clip.duration;
        return clipEnd > maxEnd ? clipEnd : maxEnd;
      }, 0);

    if (assetData) {
      try {
        const asset: Asset = JSON.parse(assetData);
        const targetTrack = getTargetTrackForAsset(asset);
        if (!targetTrack || targetTrack.locked) return;

        const startTime = getLastClipEndTime(targetTrack);

        const newClip = createClip({
          id: generateId(),
          trackId: targetTrack.id,
          name: asset.name,
          type: targetTrack.type,
          startTime,
          duration: asset.duration || 5,
          thumbnail: asset.thumbnail,
          src: asset.src,
          aiGenerated: asset.aiGenerated,
        });

        dispatch({
          type: "ADD_CLIP",
          payload: { trackId: targetTrack.id, clip: newClip },
        });
      } catch (err) {
        console.error("Failed to parse dropped asset:", err);
      }
      return;
    }

    if (textPresetData) {
      try {
        const preset = JSON.parse(textPresetData);
        const captionsTrack = state.tracks.find((t) => t.type === "captions");
        if (!captionsTrack || captionsTrack.locked) return;

        const startTime = getLastClipEndTime(captionsTrack);

        const newClip = createClip({
          id: generateId(),
          trackId: captionsTrack.id,
          name: preset.name,
          type: "captions",
          startTime,
          duration: 3,
          text: {
            ...defaultTextProperties,
            ...preset.style,
            content: preset.preview,
          },
        });

        dispatch({
          type: "ADD_CLIP",
          payload: { trackId: captionsTrack.id, clip: newClip },
        });
      } catch (err) {
        console.error("Failed to parse dropped text preset:", err);
      }
    }
  }, [state.tracks, dispatch]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!track.locked) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, [track.locked]);

  const generateAIContext: GenerateWithAIContext = {
    trackId: track.id,
    trackType: track.type,
    startTime: currentTime,
  };

  const handleTrackDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      onOpenGenerateAI?.(generateAIContext);
    },
    [onOpenGenerateAI, generateAIContext]
  );

  const lastClipEnd =
    track.clips.length > 0
      ? track.clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
      : 0;
  const hasEmptySegmentAfter = state.duration > lastClipEnd;
  const emptySegmentLeftPx = lastClipEnd * pixelsPerSecond;
  const emptySegmentWidthPx = Math.max(0, (state.duration - lastClipEnd) * pixelsPerSecond);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative timeline-track border-b border-border/20 transition-colors",
        isSelected && "bg-secondary/20",
        track.locked && "opacity-60",
        !track.visible && "opacity-40",
        isOver && !track.locked && "bg-primary/10"
      )}
      style={{ height: track.height }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDoubleClick={handleTrackDoubleClick}
    >
      {/* Grid lines */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: Math.ceil(state.duration / 5) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/10"
            style={{ left: i * 5 * pixelsPerSecond }}
          />
        ))}
      </div>

      {/* Hint: double-click to generate with AI — full track when empty, or in empty segment after last clip */}
      {track.clips.length === 0 ? (
        <div
          className="absolute inset-y-0 left-3 flex items-center pointer-events-none z-0"
          aria-hidden
        >
          <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">
            Double-click to generate with AI
          </span>
        </div>
      ) : hasEmptySegmentAfter && emptySegmentWidthPx >= 60 ? (
        <div
          className="absolute inset-y-0 flex items-center pointer-events-none z-0"
          style={{ left: emptySegmentLeftPx + 12, width: emptySegmentWidthPx - 12 }}
          aria-hidden
        >
          <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">
            Double-click to generate with AI
          </span>
        </div>
      ) : null}

      {/* Drop indicator */}
      {(isDropTarget || isOver) && !track.locked && (
        <div className="absolute inset-0 border-2 border-primary/50 border-dashed rounded-md pointer-events-none z-10 bg-primary/5" />
      )}

      {/* Clips */}
      {track.clips.map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          trackColor={track.color}
          trackLocked={track.locked}
          trackType={track.type}
          onOpenInspector={onOpenInspector}
        />
      ))}
    </div>
  );
}
