"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Track } from "./Track";
import { TimeRuler } from "./TimeRuler";
import { Playhead } from "./Playhead";
import { TrackControls } from "./TrackControls";
import { Slider } from "@/components/ui/slider";
import {
  Plus,
  Minus,
  Video,
  Music,
  Mic,
  Type,
  Volume2,
  Magnet,
  Image as ImageIcon,
  Scissors,
  Trash2,
  Copy,
} from "lucide-react";
import { TrackType, calculateSnapPoints, findNearestSnapPoint, generateId, createClip, defaultTextProperties } from "@/types/video-editor";
import { cn } from "@/lib/utils";
import { DndContext, closestCenter, DragStartEvent, DragEndEvent, DragMoveEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { GenerateWithAIContext } from "@/components/video-editor/modals/GenerateWithAIModal";

const trackTypeIcons: Record<TrackType, React.ElementType> = {
  video: Video,
  audio: Volume2,
  music: Music,
  voiceover: Mic,
  captions: Type,
  overlay: ImageIcon,
};

interface TimelineProps {
  onOpenInspector?: () => void;
  onOpenGenerateAI?: (context: GenerateWithAIContext) => void;
}

export function Timeline({ onOpenInspector, onOpenGenerateAI }: TimelineProps) {
  const { state, dispatch, getClipById, getTrackForClip } = useVideoEditor();
  const { tracks, zoom, duration, currentTime, snapEnabled } = state;
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const trackLabelsRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);

  const pixelsPerSecond = zoom * 2;
  const timelineWidth = Math.max(duration * pixelsPerSecond, 1000);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Synchronize vertical scrolling between track labels and tracks
  // (Time ruler is now inside the same scroll container, so horizontal sync is automatic)
  useEffect(() => {
    const trackLabels = trackLabelsRef.current;
    const tracksScroll = tracksScrollRef.current;

    if (!trackLabels || !tracksScroll) return;

    let isSyncing = false;

    // Vertical scroll sync between track labels and tracks
    const handleTracksScroll = () => {
      if (isSyncing) return;
      isSyncing = true;
      if (trackLabels) {
        trackLabels.scrollTop = tracksScroll.scrollTop;
      }
      requestAnimationFrame(() => { isSyncing = false; });
    };

    const handleTrackLabelsScroll = () => {
      if (isSyncing) return;
      isSyncing = true;
      if (tracksScroll) {
        tracksScroll.scrollTop = trackLabels.scrollTop;
      }
      requestAnimationFrame(() => { isSyncing = false; });
    };

    trackLabels.addEventListener("scroll", handleTrackLabelsScroll);
    tracksScroll.addEventListener("scroll", handleTracksScroll);

    return () => {
      trackLabels.removeEventListener("scroll", handleTrackLabelsScroll);
      tracksScroll.removeEventListener("scroll", handleTracksScroll);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if ((e.key === "Delete" || e.key === "Backspace") && state.selectedClipId) {
        e.preventDefault();
        const track = getTrackForClip(state.selectedClipId);
        if (track && !track.locked) {
          dispatch({
            type: "REMOVE_CLIP",
            payload: { trackId: track.id, clipId: state.selectedClipId },
          });
        }
      }

      if (e.key === "s" && state.selectedClipId) {
        e.preventDefault();
        handleSplit();
      }

      if (e.key === "Home" || e.key === "0") {
        e.preventDefault();
        dispatch({ type: "SET_CURRENT_TIME", payload: 0 });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.selectedClipId, currentTime, dispatch, getTrackForClip]);

  const handleZoomChange = (value: number[]) => {
    dispatch({ type: "SET_ZOOM", payload: value[0] });
  };

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("timeline-bg")) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(x / pixelsPerSecond, duration));
    dispatch({ type: "SET_CURRENT_TIME", payload: newTime });
    dispatch({ type: "SELECT_CLIP", payload: null });
  }, [dispatch, duration, pixelsPerSecond]);

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedClipId(event.active.id as string);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!snapEnabled || !event.active.id) return;

    const clip = getClipById(event.active.id as string);
    if (!clip) return;

    const delta = event.delta.x / pixelsPerSecond;
    const newStartTime = clip.startTime + delta;
    
    const snapPoints = calculateSnapPoints(tracks, clip.id);
    const snapStart = findNearestSnapPoint(newStartTime, snapPoints, 0.2);
    const snapEnd = findNearestSnapPoint(newStartTime + clip.duration, snapPoints, 0.2);

    if (snapStart !== null) {
      setSnapIndicator(snapStart);
    } else if (snapEnd !== null) {
      setSnapIndicator(snapEnd);
    } else {
      setSnapIndicator(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedClipId(null);
    setSnapIndicator(null);

    const { active, over, delta } = event;
    if (!active) return;

    const clipId = active.id as string;
    const clip = getClipById(clipId);
    const track = getTrackForClip(clipId);

    if (!clip || !track || track.locked) return;

    // Dropped on another clip (same track) → swap positions
    if (over && typeof over.id === "string" && over.id !== clipId && !over.id.startsWith("track-")) {
      const otherClipId = over.id as string;
      const otherTrack = getTrackForClip(otherClipId);
      if (otherTrack && otherTrack.id === track.id) {
        dispatch({
          type: "SWAP_CLIPS",
          payload: { clipIdA: clipId, clipIdB: otherClipId },
        });
        return;
      }
    }

    let newStartTime = clip.startTime + (delta.x / pixelsPerSecond);
    
    if (snapEnabled) {
      const snapPoints = calculateSnapPoints(tracks, clipId);
      const snapStart = findNearestSnapPoint(newStartTime, snapPoints, 0.2);
      const snapEnd = findNearestSnapPoint(newStartTime + clip.duration, snapPoints, 0.2);

      if (snapStart !== null) {
        newStartTime = snapStart;
      } else if (snapEnd !== null) {
        newStartTime = snapEnd - clip.duration;
      }
    }

    newStartTime = Math.max(0, newStartTime);

    let targetTrackId = track.id;
    if (over && typeof over.id === "string" && over.id.startsWith("track-")) {
      const overTrack = tracks.find(t => t.id === over.id);
      if (overTrack && overTrack.type === track.type && !overTrack.locked) {
        targetTrackId = overTrack.id;
      }
    }

    if (targetTrackId !== track.id || newStartTime !== clip.startTime) {
      dispatch({
        type: "MOVE_CLIP",
        payload: { clipId, newTrackId: targetTrackId, newStartTime },
      });
    }
  };

  const handleSplit = () => {
    if (state.selectedClipId) {
      const clip = getClipById(state.selectedClipId);
      if (clip && currentTime > clip.startTime && currentTime < clip.startTime + clip.duration) {
        dispatch({
          type: "SPLIT_CLIP",
          payload: { clipId: state.selectedClipId, splitTime: currentTime },
        });
      }
    }
  };

  const handleDelete = () => {
    if (state.selectedClipId) {
      const track = getTrackForClip(state.selectedClipId);
      if (track && !track.locked) {
        dispatch({
          type: "REMOVE_CLIP",
          payload: { trackId: track.id, clipId: state.selectedClipId },
        });
      }
    }
  };

  const handleDuplicate = () => {
    if (state.selectedClipId) {
      dispatch({ type: "DUPLICATE_CLIP", payload: state.selectedClipId });
    }
  };

  const totalTracksHeight = tracks.reduce((acc, t) => acc + t.height, 0);

  return (
    <div className="h-full flex flex-col bg-muted/30 border-t border-border/50">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 border-b border-border/30 flex-shrink-0 overflow-x-auto gap-2">
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Timeline</span>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "TOGGLE_SNAP" })}
            className={cn(
              "h-7 px-1.5 sm:px-2 gap-1",
              snapEnabled && "bg-primary/20 text-primary"
            )}
          >
            <Magnet className="h-3.5 w-3.5" />
            <span className="text-xs hidden sm:inline">Snap</span>
          </Button>

          <div className="h-4 w-px bg-border/50 mx-0.5 sm:mx-1 hidden sm:block" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSplit}
            disabled={!state.selectedClipId}
            className="h-7 px-1.5 sm:px-2 gap-1"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="text-xs hidden sm:inline">Split</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDuplicate}
            disabled={!state.selectedClipId}
            className="h-7 px-1.5 sm:px-2 gap-1"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="text-xs hidden sm:inline">Duplicate</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={!state.selectedClipId}
            className="h-7 px-1.5 sm:px-2 gap-1 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="text-xs hidden sm:inline">Delete</span>
          </Button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", payload: Math.max(10, zoom - 10) })}
            className="p-1 rounded hover:bg-secondary/50 transition-colors"
          >
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <Slider
            value={[zoom]}
            onValueChange={handleZoomChange}
            min={10}
            max={200}
            step={5}
            className="w-16 sm:w-24"
          />
          <button
            onClick={() => dispatch({ type: "SET_ZOOM", payload: Math.min(200, zoom + 10) })}
            className="p-1 rounded hover:bg-secondary/50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <span className="text-xs text-muted-foreground w-10 sm:w-12">{zoom}%</span>
        </div>
      </div>

      {/* Timeline Body */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Track Labels */}
          <div className="w-28 sm:w-48 flex-shrink-0 border-r border-border/30 flex flex-col min-h-0">
            <div className="h-8 border-b border-border/30 flex-shrink-0" />
            
            <div 
              ref={trackLabelsRef}
              className="flex-1 overflow-y-auto overflow-x-hidden"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <div style={{ height: totalTracksHeight }}>
                {tracks.map((track) => {
                  const Icon = trackTypeIcons[track.type];
                  return (
                    <div
                      key={track.id}
                      className={cn(
                        "flex items-center gap-2 px-3 border-b border-border/20 cursor-pointer hover:bg-secondary/30 transition-colors",
                        state.selectedTrackId === track.id && "bg-secondary/50"
                      )}
                      style={{ height: track.height }}
                      onClick={() => dispatch({ type: "SELECT_TRACK", payload: track.id })}
                      onDoubleClick={() =>
                        onOpenGenerateAI?.({
                          trackId: track.id,
                          trackType: track.type,
                          startTime: currentTime,
                        })
                      }
                      title="Double-click to generate with AI"
                    >
                      <div
                        className="w-1 h-6 rounded-full flex-shrink-0"
                        style={{ backgroundColor: track.color }}
                      />
                      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1 py-0.5">
                        <span className="text-xs font-medium truncate">
                          {track.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground/80 truncate">
                          Double-click to generate with AI
                        </span>
                      </div>
                      <TrackControls track={track} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Timeline Tracks - Single horizontal scroll container for both ruler and tracks */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Horizontal scroll wrapper for time ruler + tracks */}
            <div 
              ref={tracksScrollRef}
              className="flex-1 overflow-auto"
            >
              <div style={{ width: timelineWidth, minWidth: "100%" }}>
                {/* Time Ruler - inside the scroll container */}
                <div className="h-8 flex-shrink-0 sticky top-0 z-20 bg-muted/30">
                  <TimeRuler
                    duration={duration}
                    pixelsPerSecond={pixelsPerSecond}
                    onClick={handleTimelineClick}
                  />
                </div>

                {/* Tracks */}
                <div
                  ref={tracksContainerRef}
                  className="relative timeline-bg"
                  style={{ 
                    width: timelineWidth,
                    height: totalTracksHeight,
                    minHeight: "100%"
                  }}
                  onClick={handleTimelineClick}
                >
                  {snapIndicator !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-px bg-primary z-30 pointer-events-none"
                      style={{ left: snapIndicator * pixelsPerSecond }}
                    />
                  )}

                  <Playhead
                    currentTime={currentTime}
                    pixelsPerSecond={pixelsPerSecond}
                    height={totalTracksHeight}
                  />

                  {tracks.map((track) => (
                    <Track
                      key={track.id}
                      track={track}
                      pixelsPerSecond={pixelsPerSecond}
                      isDropTarget={draggedClipId !== null}
                      onOpenInspector={onOpenInspector}
                      onOpenGenerateAI={onOpenGenerateAI}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DndContext>
    </div>
  );
}
