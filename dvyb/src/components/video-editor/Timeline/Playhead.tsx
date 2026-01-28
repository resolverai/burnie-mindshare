"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { formatTimeSimple } from "@/types/video-editor";

interface PlayheadProps {
  currentTime: number;
  pixelsPerSecond: number;
  height: number;
}

export function Playhead({ currentTime, pixelsPerSecond, height }: PlayheadProps) {
  const { dispatch, state } = useVideoEditor();
  const left = currentTime * pixelsPerSecond;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const timelineElement = (e.target as HTMLElement).closest(".timeline-bg");
    if (!timelineElement) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const timelineRect = timelineElement.getBoundingClientRect();
      const x = moveEvent.clientX - timelineRect.left;
      const newTime = Math.max(0, Math.min(x / pixelsPerSecond, state.duration));
      dispatch({ type: "SET_CURRENT_TIME", payload: newTime });
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      className="absolute top-0 z-30 -translate-x-1/2 pointer-events-auto cursor-ew-resize flex flex-col items-center"
      style={{ left, width: 16, height: height + 32 }}
      onMouseDown={handleMouseDown}
    >
      {/* Time indicator */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-red-500 text-[10px] font-medium text-white whitespace-nowrap shadow-lg pointer-events-none">
        {formatTimeSimple(currentTime)}
      </div>

      {/* Triangle handle */}
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500 shrink-0 pointer-events-none" />

      {/* Vertical line - full height so dragging anywhere on the strip moves the playhead */}
      <div
        className="w-0.5 bg-red-500 shadow-lg pointer-events-none"
        style={{ height }}
      />
    </div>
  );
}
