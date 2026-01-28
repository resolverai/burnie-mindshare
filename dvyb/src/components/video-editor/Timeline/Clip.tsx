"use client";

import { useState, useRef, useEffect } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip as ClipType, TrackType, TransitionType } from "@/types/video-editor";
import { cn } from "@/lib/utils";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Sparkles, ArrowLeftRight } from "lucide-react";

interface ClipProps {
  clip: ClipType;
  pixelsPerSecond: number;
  trackColor: string;
  trackLocked: boolean;
  trackType: TrackType;
  onOpenInspector?: () => void;
}

// Mock waveform data
const getWaveformData = (clipId: string, duration: number): number[] => {
  const seed = clipId.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  const length = Math.floor(duration * 20);
  const data: number[] = [];
  
  for (let i = 0; i < length; i++) {
    const base = Math.sin((i + seed) * 0.15) * 0.3;
    const noise = ((seed * i) % 100) / 200;
    data.push(Math.abs(base + noise));
  }
  
  return data;
};

export function Clip({ clip, pixelsPerSecond, trackColor, trackLocked, trackType, onOpenInspector }: ClipProps) {
  const { state, dispatch } = useVideoEditor();
  const [isResizing, setIsResizing] = useState<"start" | "end" | null>(null);
  const [localStartTime, setLocalStartTime] = useState(clip.startTime);
  const [localDuration, setLocalDuration] = useState(clip.duration);
  const resizeStateRef = useRef({ startTime: clip.startTime, duration: clip.duration });

  const isSelected = state.selectedClipId === clip.id || state.selectedClipIds.includes(clip.id);
  const displayStartTime = isResizing ? localStartTime : clip.startTime;
  const displayDuration = isResizing ? localDuration : clip.duration;
  const left = displayStartTime * pixelsPerSecond;
  const width = displayDuration * pixelsPerSecond;

  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({
    id: clip.id,
    disabled: trackLocked || isResizing !== null,
    data: { clip, trackType },
  });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: clip.id,
    data: { clip, trackType },
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const style = transform && !isResizing
    ? {
        transform: `translate3d(${transform.x}px, 0px, 0)`,
        zIndex: isDragging ? 50 : isSelected ? 20 : 10,
      }
    : {
        zIndex: isSelected ? 20 : 10,
      };

  useEffect(() => {
    if (!isResizing) {
      setLocalStartTime(clip.startTime);
      setLocalDuration(clip.duration);
      resizeStateRef.current = { startTime: clip.startTime, duration: clip.duration };
    }
  }, [clip.startTime, clip.duration, isResizing]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackLocked && !isResizing) {
      if (e.shiftKey) {
        dispatch({ type: "ADD_TO_SELECTION", payload: clip.id });
      } else {
        dispatch({ type: "SELECT_CLIP", payload: clip.id });
      }
      onOpenInspector?.();
    }
  };

  // Double-click to open AI prompt modal for AI-generated clips
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clip.aiGenerated || clip.aiModified) {
      dispatch({ 
        type: "SHOW_AI_PROMPT_MODAL", 
        payload: { clipId: clip.id, type: "modify" } 
      });
    }
  };

  // Unified resize handler for both mouse and touch events
  const handleResizeStart = (clientX: number, anchor: "start" | "end") => {
    if (trackLocked) return;
    
    const initialStartTime = clip.startTime;
    const initialDuration = clip.duration;
    const initialEndTime = initialStartTime + initialDuration;
    const startX = clientX;

    setIsResizing(anchor);
    setLocalStartTime(initialStartTime);
    setLocalDuration(initialDuration);
    resizeStateRef.current = { startTime: initialStartTime, duration: initialDuration };

    const handleMove = (currentX: number) => {
      const deltaX = currentX - startX;
      const deltaTime = deltaX / pixelsPerSecond;

      if (anchor === "end") {
        const newDuration = Math.max(0.5, initialDuration + deltaTime);
        setLocalDuration(newDuration);
        resizeStateRef.current = { startTime: initialStartTime, duration: newDuration };
      } else {
        let newStartTime = initialStartTime + deltaTime;
        newStartTime = Math.max(0, newStartTime);
        let newDuration = initialEndTime - newStartTime;
        
        if (newDuration < 0.5) {
          newDuration = 0.5;
          newStartTime = initialEndTime - 0.5;
        }
        
        setLocalStartTime(newStartTime);
        setLocalDuration(newDuration);
        resizeStateRef.current = { startTime: newStartTime, duration: newDuration };
      }
    };

    const handleEnd = () => {
      const finalState = resizeStateRef.current;
      setIsResizing(null);
      
      dispatch({
        type: "RESIZE_CLIP",
        payload: {
          clipId: clip.id,
          newStartTime: finalState.startTime,
          newDuration: finalState.duration,
        },
      });

      // Remove all event listeners
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      handleMove(moveEvent.clientX);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      upEvent.preventDefault();
      handleEnd();
    };

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      if (moveEvent.touches.length > 0) {
        handleMove(moveEvent.touches[0].clientX);
      }
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
  };

  const handleResizeMouseDown = (e: React.MouseEvent, anchor: "start" | "end") => {
    e.stopPropagation();
    e.preventDefault();
    handleResizeStart(e.clientX, anchor);
  };

  const handleResizeTouchStart = (e: React.TouchEvent, anchor: "start" | "end") => {
    e.stopPropagation();
    if (e.touches.length > 0) {
      handleResizeStart(e.touches[0].clientX, anchor);
    }
  };

  const renderTransition = (type: TransitionType, position: "in" | "out", duration: number) => {
    if (type === "none" || duration === 0) return null;
    
    const transitionWidth = duration * pixelsPerSecond;
    const isIn = position === "in";
    
    return (
      <div
        className={cn(
          "absolute top-0 bottom-0 flex items-center justify-center pointer-events-none",
          isIn ? "left-0" : "right-0"
        )}
        style={{ width: transitionWidth }}
      >
        <div 
          className={cn(
            "h-full w-full",
            isIn 
              ? "bg-gradient-to-r from-black/50 to-transparent" 
              : "bg-gradient-to-l from-black/50 to-transparent"
          )}
        />
        <ArrowLeftRight className="absolute h-3 w-3 text-white/70" />
      </div>
    );
  };

  const renderWaveform = () => {
    if (!["audio", "music", "voiceover"].includes(trackType)) return null;
    
    const waveformData = getWaveformData(clip.id, displayDuration);
    
    return (
      <div className="absolute inset-0 flex items-center px-1 overflow-hidden">
        <svg 
          className="w-full h-full" 
          preserveAspectRatio="none"
          viewBox={`0 0 ${waveformData.length} 1`}
        >
          {waveformData.map((value, i) => (
            <rect
              key={i}
              x={i}
              y={0.5 - value * 0.4}
              width={0.8}
              height={value * 0.8}
              fill="rgba(255,255,255,0.5)"
              rx={0.1}
            />
          ))}
        </svg>
      </div>
    );
  };

  const renderTextContent = () => {
    if (trackType !== "captions" || !clip.text) return null;
    
    return (
      <div className="absolute inset-0 flex items-center justify-center px-2 overflow-hidden">
        <span 
          className="text-[10px] font-medium text-white truncate"
          style={{
            fontFamily: clip.text.fontFamily,
            fontWeight: clip.text.fontWeight,
          }}
        >
          {clip.text.content}
        </span>
      </div>
    );
  };

  const renderImageOverlay = () => {
    if (trackType !== "overlay") return null;
    const imageUrl = clip.thumbnail || clip.src;
    if (!imageUrl) return null;

    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="w-full h-full"
          style={{
            transform: `scaleX(${clip.flipHorizontal ? -1 : 1}) scaleY(${clip.flipVertical ? -1 : 1})`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={clip.name}
            className="w-full h-full object-cover opacity-70"
            style={{
              borderRadius: clip.cornerRadius || 0,
              mixBlendMode: clip.blendMode || "normal",
            }}
            draggable={false}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute top-1 bottom-1 rounded-md overflow-hidden transition-shadow",
        isSelected && "ring-2 ring-white shadow-lg",
        isDragging && !isResizing && "cursor-grabbing opacity-70 shadow-xl",
        !isDragging && !isResizing && !trackLocked && "cursor-grab",
        trackLocked && "cursor-not-allowed",
        isResizing && "ring-2 ring-primary cursor-ew-resize",
        isOver && !isDragging && "ring-2 ring-primary/80 ring-offset-1 ring-offset-background"
      )}
      style={{
        left,
        width: Math.max(width, 20),
        backgroundColor: trackColor,
        ...style,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      {...(isResizing ? {} : attributes)}
      {...(isResizing ? {} : listeners)}
    >
      {/* Video/Image thumbnail */}
      {trackType === "video" && (clip.src || clip.thumbnail) && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Check if the source looks like a video URL */}
          {(clip.src?.includes('.mp4') || clip.src?.includes('.webm') || clip.src?.includes('.mov') || 
            clip.src?.includes('video') || clip.src?.includes('X-Amz')) ? (
            <video
              src={clip.src}
              className="w-full h-full object-cover opacity-60"
              muted
              preload="metadata"
              onLoadedMetadata={(e) => {
                // Seek to show a frame (not black)
                const video = e.currentTarget;
                video.currentTime = Math.min(1, video.duration * 0.1);
              }}
              draggable={false}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={clip.thumbnail || clip.src}
              alt={clip.name}
              className="w-full h-full object-cover opacity-60"
              draggable={false}
            />
          )}
        </div>
      )}

      {renderWaveform()}
      {renderTextContent()}
      {renderImageOverlay()}
      {renderTransition(clip.transitionIn, "in", clip.transitionInDuration)}
      {renderTransition(clip.transitionOut, "out", clip.transitionOutDuration)}

      {/* Clip name overlay */}
      <div className="relative h-full flex items-center px-2 z-10 pointer-events-none">
        <div className="flex items-center gap-1 min-w-0">
          {(clip.aiGenerated || clip.aiModified) && (
            <Sparkles className="h-3 w-3 text-white/80 flex-shrink-0" />
          )}
          <span className="text-[10px] font-medium text-white truncate drop-shadow-sm">
            {clip.name}
          </span>
        </div>
      </div>

      {/* Resize handles - larger on mobile for touch */}
      {isSelected && !trackLocked && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-6 sm:w-3 cursor-ew-resize z-30 group touch-none"
            onMouseDown={(e) => handleResizeMouseDown(e, "start")}
            onTouchStart={(e) => handleResizeTouchStart(e, "start")}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="absolute left-0 top-0 bottom-0 w-full hover:bg-white/20 active:bg-white/30 transition-colors" />
            <div className="absolute left-1 sm:left-0.5 top-1/2 -translate-y-1/2 w-1.5 sm:w-1 h-8 sm:h-6 bg-white/70 rounded-full group-hover:bg-white group-active:bg-white transition-colors" />
          </div>
          <div
            className="absolute right-0 top-0 bottom-0 w-6 sm:w-3 cursor-ew-resize z-30 group touch-none"
            onMouseDown={(e) => handleResizeMouseDown(e, "end")}
            onTouchStart={(e) => handleResizeTouchStart(e, "end")}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="absolute right-0 top-0 bottom-0 w-full hover:bg-white/20 active:bg-white/30 transition-colors" />
            <div className="absolute right-1 sm:right-0.5 top-1/2 -translate-y-1/2 w-1.5 sm:w-1 h-8 sm:h-6 bg-white/70 rounded-full group-hover:bg-white group-active:bg-white transition-colors" />
          </div>
        </>
      )}

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white pointer-events-none" />
      )}

      {/* AI badge */}
      {clip.aiGenerated && (
        <div className="absolute top-0.5 right-0.5 px-1 py-0.5 rounded text-[8px] bg-purple-500/80 text-white pointer-events-none">
          AI
        </div>
      )}
    </div>
  );
}
