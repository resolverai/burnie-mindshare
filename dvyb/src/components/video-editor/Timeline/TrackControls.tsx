"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Track } from "@/types/video-editor";
import { Volume2, VolumeX, Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrackControlsProps {
  track: Track;
}

export function TrackControls({ track }: TrackControlsProps) {
  const { dispatch } = useVideoEditor();

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "TOGGLE_TRACK_MUTE", payload: track.id });
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "TOGGLE_TRACK_LOCK", payload: track.id });
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "TOGGLE_TRACK_VISIBILITY", payload: track.id });
  };

  // Only show mute for audio-type tracks
  const showMute = ["audio", "music", "voiceover"].includes(track.type);

  return (
    <div className="flex items-center gap-0.5">
      {showMute && (
        <button
          onClick={handleToggleMute}
          className={cn(
            "p-1 rounded hover:bg-secondary/50 transition-colors",
            track.muted && "text-destructive"
          )}
          title={track.muted ? "Unmute" : "Mute"}
        >
          {track.muted ? (
            <VolumeX className="h-3 w-3" />
          ) : (
            <Volume2 className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      )}

      <button
        onClick={handleToggleLock}
        className={cn(
          "p-1 rounded hover:bg-secondary/50 transition-colors",
          track.locked && "text-amber-500"
        )}
        title={track.locked ? "Unlock" : "Lock"}
      >
        {track.locked ? (
          <Lock className="h-3 w-3" />
        ) : (
          <Unlock className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      <button
        onClick={handleToggleVisibility}
        className={cn(
          "p-1 rounded hover:bg-secondary/50 transition-colors",
          !track.visible && "text-muted-foreground/50"
        )}
        title={track.visible ? "Hide" : "Show"}
      >
        {track.visible ? (
          <Eye className="h-3 w-3 text-muted-foreground" />
        ) : (
          <EyeOff className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}
