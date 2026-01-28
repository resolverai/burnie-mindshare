"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TrackType } from "@/types/video-editor";

const trackTypeLabels: Record<TrackType, string> = {
  video: "Video / Clip",
  overlay: "Image Overlay",
  captions: "Caption",
  voiceover: "Voiceover",
  music: "Background Music",
  audio: "Sound Effect",
};

export interface GenerateWithAIContext {
  trackId: string;
  trackType: TrackType;
  startTime?: number;
}

interface GenerateWithAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: GenerateWithAIContext | null;
  onGenerate?: (context: GenerateWithAIContext, prompt: string) => void | Promise<void>;
}

export function GenerateWithAIModal({
  isOpen,
  onClose,
  context,
  onGenerate,
}: GenerateWithAIModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  if (!isOpen || !context) return null;

  const trackLabel = trackTypeLabels[context.trackType] ?? context.trackType;

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setIsGenerating(true);
    try {
      await onGenerate?.(context, trimmed);
      setPrompt("");
      onClose();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    setPrompt("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Generate with AI</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
            disabled={isGenerating}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Track: <span className="font-medium text-foreground">{trackLabel}</span>
            {context.startTime != null && (
              <span className="ml-2 text-muted-foreground">
                (at {context.startTime.toFixed(1)}s)
              </span>
            )}
          </p>
          <div>
            <label className="text-sm font-medium text-foreground block mb-2">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want to generate..."
              className={cn(
                "w-full min-h-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              )}
              disabled={isGenerating}
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
              prompt.trim() && !isGenerating
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isGenerating ? (
              <>
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
