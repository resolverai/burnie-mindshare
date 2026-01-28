"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TransformSection } from "./TransformSection";
import { SpeedSection } from "./SpeedSection";
import { AudioSection } from "./AudioSection";
import { TransitionsSection } from "./TransitionsSection";
import { TextSection } from "./TextSection";
import { AISection } from "./AISection";
import { ImageOverlaySection } from "./ImageOverlaySection";
import { MousePointer, Video, Music, Type, Mic, Volume2, Sparkles, Image as ImageIcon, X } from "lucide-react";
import { TrackType } from "@/types/video-editor";

const clipTypeIcons: Record<TrackType, React.ElementType> = {
  video: Video,
  audio: Volume2,
  music: Music,
  voiceover: Mic,
  captions: Type,
  overlay: ImageIcon,
};

interface InspectorProps {
  onClose?: () => void;
}

function InspectorHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="p-3 border-b border-border/30 flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{title}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close Inspector"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Inspector({ onClose }: InspectorProps) {
  const { getSelectedClip, state } = useVideoEditor();
  const selectedClip = getSelectedClip();

  // Empty state
  if (!selectedClip) {
    return (
      <div className="h-full flex flex-col bg-card/50 border-l border-border/30">
        <InspectorHeader title="Inspector" onClose={onClose} />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
            <MousePointer className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">
            No clip selected
          </p>
          <p className="text-xs text-muted-foreground/70">
            Select a clip on the timeline to edit its properties
          </p>
        </div>
      </div>
    );
  }

  const Icon = clipTypeIcons[selectedClip.type];
  const isVideoClip = selectedClip.type === "video";
  const isAudioClip = ["audio", "music", "voiceover"].includes(selectedClip.type);
  const isCaptionClip = selectedClip.type === "captions";
  const isOverlayClip = selectedClip.type === "overlay";

  return (
    <div className="h-full flex flex-col bg-card/50 border-l border-border/30">
      {/* Header */}
      <div className="p-3 border-b border-border/30 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{selectedClip.name}</p>
          <div className="flex items-center gap-1">
            <p className="text-[10px] text-muted-foreground uppercase">
              {selectedClip.type === "overlay" ? "image overlay" : selectedClip.type} clip
            </p>
            {(selectedClip.aiGenerated || selectedClip.aiModified) && (
              <Sparkles className="h-3 w-3 text-purple-500" />
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label="Close Inspector"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sections */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {/* AI Section - for AI generated/modified clips */}
          {(selectedClip.aiGenerated || selectedClip.aiModified) && (
            <AISection clip={selectedClip} />
          )}

          {/* Image Overlay Section - full editor for overlay clips */}
          {isOverlayClip && <ImageOverlaySection clip={selectedClip} />}

          {/* Text Section - for caption clips */}
          {isCaptionClip && <TextSection clip={selectedClip} />}

          {/* Transform - for video clips */}
          {isVideoClip && <TransformSection clip={selectedClip} />}

          {/* Transitions - for video clips */}
          {isVideoClip && <TransitionsSection clip={selectedClip} />}

          {/* Speed - for video clips */}
          {isVideoClip && <SpeedSection clip={selectedClip} />}

          {/* Audio - for all clip types with audio */}
          {(isVideoClip || isAudioClip) && <AudioSection clip={selectedClip} />}
        </div>
      </ScrollArea>
    </div>
  );
}
