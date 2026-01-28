"use client";

import { useState, useEffect } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { X, Sparkles, Wand2, RefreshCw, Plus, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface AIPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const promptSuggestions = {
  regenerate: [
    "Make it more energetic and dynamic",
    "Create a calmer, more professional tone",
    "Add more visual effects and transitions",
    "Make it shorter and more concise",
  ],
  modify: [
    "Change the color grading to warm tones",
    "Add dramatic slow motion effect",
    "Make the text larger and more visible",
    "Adjust the pacing to be faster",
  ],
  extend: [
    "Continue with the same style for 5 more seconds",
    "Add a smooth transition to the next scene",
    "Extend with a fade-out ending",
    "Add more content in the same visual style",
  ],
};

const actionLabels = {
  regenerate: { title: "Regenerate Clip", icon: RefreshCw, color: "text-blue-500" },
  modify: { title: "Modify Clip", icon: Wand2, color: "text-purple-500" },
  extend: { title: "Extend Clip", icon: Plus, color: "text-green-500" },
};

export function AIPromptModal({ isOpen, onClose }: AIPromptModalProps) {
  const { state, dispatch, getClipById } = useVideoEditor();
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const clipId = state.aiPromptTarget?.clipId;
  const type = state.aiPromptTarget?.type || "modify";
  const clip = clipId ? getClipById(clipId) : null;
  
  // Pre-fill textarea with existing prompt when modal opens or clip changes
  useEffect(() => {
    if (isOpen && clip?.prompt) {
      setPrompt(clip.prompt);
    } else if (!isOpen) {
      setPrompt("");
    }
  }, [isOpen, clip?.prompt]);

  if (!isOpen || !state.aiPromptTarget || !clip) return null;

  const actionInfo = actionLabels[type];
  const ActionIcon = actionInfo.icon;
  const suggestions = promptSuggestions[type];

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setIsProcessing(true);
    setHistory((prev) => [...prev, prompt]);

    // Simulate AI processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update clip with new prompt and mark as AI modified
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clipId,
        prompt,
        aiModified: true,
      },
    });

    setIsProcessing(false);
    setPrompt("");
    
    // In a real app, this would trigger the Python backend to process the clip
  };

  const handleSuggestionClick = (suggestion: string) => {
    setPrompt(suggestion);
  };

  const handleClose = () => {
    dispatch({ type: "SHOW_AI_PROMPT_MODAL", payload: null });
    setPrompt("");
    setHistory([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-primary/10 to-accent/10">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg bg-background", actionInfo.color)}>
              <ActionIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{actionInfo.title}</h2>
              <p className="text-xs text-muted-foreground">{clip.name}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* History */}
          {history.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Recent prompts:</p>
              <div className="flex flex-wrap gap-2">
                {history.slice(-3).map((h, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(h)}
                    className="px-2 py-1 rounded text-xs bg-secondary/50 hover:bg-secondary transition-colors truncate max-w-[200px]"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {clip.prompt ? "Edit the prompt:" : "Describe what you want:"}
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={clip.prompt ? "Modify the existing prompt above..." : `Describe how you want to ${type} this clip...`}
                className="w-full h-24 px-4 py-3 rounded-lg bg-background border border-border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                disabled={isProcessing}
              />
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || isProcessing}
                className={cn(
                  "absolute bottom-3 right-3 p-2 rounded-lg transition-all",
                  prompt.trim() && !isProcessing
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Suggestions */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Suggestions:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded-lg text-xs bg-secondary/50 hover:bg-secondary hover:text-primary transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">Processing with AI...</p>
                <p className="text-xs text-muted-foreground">
                  This may take a moment. The clip will update automatically.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Powered by AI
          </div>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
