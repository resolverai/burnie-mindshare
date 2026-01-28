"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { formatTimeSimple } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PlayerControlsProps {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function PlayerControls({ videoRef }: PlayerControlsProps) {
  const { state, dispatch } = useVideoEditor();
  const { currentTime, duration, isPlaying, isMuted, masterVolume } = state;
  const [isLooping, setIsLooping] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(currentTime);
  const isSeeking = useRef(false);

  // Keep currentTimeRef in sync with state
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Animation loop using refs to avoid dependency issues
  const runAnimationLoop = useCallback(() => {
    if (isSeeking.current) {
      animationFrameRef.current = requestAnimationFrame(runAnimationLoop);
      return;
    }

    const now = performance.now();
    const delta = (now - lastTimeRef.current) / 1000; // Convert to seconds
    lastTimeRef.current = now;

    // Only update if delta is reasonable (less than 100ms to handle tab switching)
    if (delta > 0 && delta < 0.1) {
      const newTime = currentTimeRef.current + delta;
      
      if (newTime >= duration) {
        if (isLooping) {
          currentTimeRef.current = 0;
          dispatch({ type: "SET_CURRENT_TIME", payload: 0 });
        } else {
          dispatch({ type: "SET_PLAYING", payload: false });
          dispatch({ type: "SET_CURRENT_TIME", payload: duration });
          return;
        }
      } else {
        currentTimeRef.current = newTime;
        dispatch({ type: "SET_CURRENT_TIME", payload: newTime });
      }
    }

    animationFrameRef.current = requestAnimationFrame(runAnimationLoop);
  }, [duration, isLooping, dispatch]);

  // Start/stop animation loop based on isPlaying
  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(runAnimationLoop);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, runAnimationLoop]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch (e.code) {
        case "Space":
          e.preventDefault();
          dispatch({ type: "TOGGLE_PLAY" });
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            dispatch({ type: "SET_CURRENT_TIME", payload: Math.max(0, currentTime - 1) });
          } else {
            dispatch({ type: "SET_CURRENT_TIME", payload: Math.max(0, currentTime - 1/30) });
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            dispatch({ type: "SET_CURRENT_TIME", payload: Math.min(duration, currentTime + 1) });
          } else {
            dispatch({ type: "SET_CURRENT_TIME", payload: Math.min(duration, currentTime + 1/30) });
          }
          break;
        case "Home":
          e.preventDefault();
          dispatch({ type: "SET_CURRENT_TIME", payload: 0 });
          break;
        case "End":
          e.preventDefault();
          dispatch({ type: "SET_CURRENT_TIME", payload: duration });
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, currentTime, duration]);

  const handlePlayPause = () => {
    dispatch({ type: "TOGGLE_PLAY" });
  };

  const handleSeekStart = () => {
    isSeeking.current = true;
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[0];
    currentTimeRef.current = newTime;
    dispatch({ type: "SET_CURRENT_TIME", payload: newTime });
  };

  const handleSeekEnd = () => {
    isSeeking.current = false;
    // Reset the time reference after seeking
    lastTimeRef.current = performance.now();
  };

  const handleSkipBack = () => {
    // Use SKIP_TO_START which goes to earliest clip (handles trimmed clips)
    dispatch({ type: "SKIP_TO_START" });
  };

  const handleSkipForward = () => {
    // Use SKIP_TO_END which goes to end of timeline
    dispatch({ type: "SKIP_TO_END" });
  };

  const handleFrameBack = () => {
    const newTime = Math.max(0, currentTime - 1 / 30);
    currentTimeRef.current = newTime;
    dispatch({
      type: "SET_CURRENT_TIME",
      payload: newTime,
    });
  };

  const handleFrameForward = () => {
    const newTime = Math.min(duration, currentTime + 1 / 30);
    currentTimeRef.current = newTime;
    dispatch({
      type: "SET_CURRENT_TIME",
      payload: newTime,
    });
  };

  const handleVolumeChange = (value: number[]) => {
    dispatch({ type: "SET_MASTER_VOLUME", payload: value[0] });
    if (value[0] === 0) {
      dispatch({ type: "SET_MUTED", payload: true });
    } else if (isMuted) {
      dispatch({ type: "SET_MUTED", payload: false });
    }
  };

  const toggleMute = () => {
    dispatch({ type: "SET_MUTED", payload: !isMuted });
  };

  return (
    <div className="px-2 sm:px-4 py-2 sm:py-3 border-t border-border/30 bg-background/50">
      {/* Timeline scrubber */}
      <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
        <span className="text-[10px] sm:text-xs font-mono text-muted-foreground w-10 sm:w-14">
          {formatTimeSimple(currentTime)}
        </span>
        <Slider
          value={[currentTime]}
          onValueChange={handleSeek}
          onPointerDown={handleSeekStart}
          onPointerUp={handleSeekEnd}
          min={0}
          max={duration}
          step={0.01}
          className="flex-1"
        />
        <span className="text-[10px] sm:text-xs font-mono text-muted-foreground w-10 sm:w-14 text-right">
          {formatTimeSimple(duration)}
        </span>
      </div>

      {/* Control buttons */}
      <div className="flex items-center justify-between">
        {/* Left controls */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={handleSkipBack}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors"
            title="Skip to start (Home)"
          >
            <SkipBack className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={handleFrameBack}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors hidden sm:flex"
            title="Previous frame (←)"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Center controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayPause}
            className={cn(
              "p-2.5 sm:p-3 rounded-full transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 sm:h-5 sm:w-5" />
            ) : (
              <Play className="h-4 w-4 sm:h-5 sm:w-5 ml-0.5" />
            )}
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            onClick={handleFrameForward}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors hidden sm:flex"
            title="Next frame (→)"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={handleSkipForward}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors"
            title="Skip to end (End)"
          >
            <SkipForward className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={cn(
              "p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors",
              isLooping && "text-primary bg-primary/10"
            )}
            title="Toggle loop"
          >
            <Repeat className="h-4 w-4" />
          </button>

          {/* Volume control - hidden on mobile */}
          <div className="hidden sm:flex items-center gap-2 ml-2 pl-2 border-l border-border/30">
            <button
              onClick={toggleMute}
              className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || masterVolume === 0 ? (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <Slider
              value={[isMuted ? 0 : masterVolume]}
              onValueChange={handleVolumeChange}
              min={0}
              max={100}
              step={1}
              className="w-20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
