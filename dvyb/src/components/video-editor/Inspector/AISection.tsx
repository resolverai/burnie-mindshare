"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip } from "@/types/video-editor";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sparkles, Wand2, RefreshCw, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AISectionProps {
  clip: Clip;
}

export function AISection({ clip }: AISectionProps) {
  const { dispatch } = useVideoEditor();

  const openAIModal = (type: "regenerate" | "modify" | "extend") => {
    dispatch({
      type: "SHOW_AI_PROMPT_MODAL",
      payload: { clipId: clip.id, type },
    });
  };

  return (
    <Accordion type="single" collapsible defaultValue="ai">
      <AccordionItem value="ai" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI Controls
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Current prompt */}
          {clip.prompt && (
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] font-medium text-purple-500 uppercase">
                  AI Prompt
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{clip.prompt}</p>
            </div>
          )}

          {/* AI Actions */}
          <div className="space-y-2">
            <button
              onClick={() => openAIModal("modify")}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                <Wand2 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium">Modify with AI</p>
                <p className="text-[10px] text-muted-foreground">
                  Describe changes to this clip
                </p>
              </div>
            </button>

            <button
              onClick={() => openAIModal("regenerate")}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <RefreshCw className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium">Regenerate</p>
                <p className="text-[10px] text-muted-foreground">
                  Create a new version of this clip
                </p>
              </div>
            </button>

            <button
              onClick={() => openAIModal("extend")}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                <Plus className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium">Extend Clip</p>
                <p className="text-[10px] text-muted-foreground">
                  Generate more content in the same style
                </p>
              </div>
            </button>
          </div>

          {/* AI Status */}
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
            <div className={cn(
              "w-2 h-2 rounded-full",
              clip.aiGenerated ? "bg-purple-500" : clip.aiModified ? "bg-blue-500" : "bg-muted"
            )} />
            <span className="text-[10px] text-muted-foreground">
              {clip.aiGenerated && !clip.aiModified && "AI Generated"}
              {clip.aiModified && "AI Modified"}
              {!clip.aiGenerated && !clip.aiModified && "Original clip"}
            </span>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
