"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, TransitionType, TRANSITION_PRESETS } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowRightLeft, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransitionsSectionProps {
  clip: Clip;
}

export function TransitionsSection({ clip }: TransitionsSectionProps) {
  const { dispatch } = useVideoEditor();

  const setTransition = (position: "in" | "out", type: TransitionType, duration?: number) => {
    const preset = TRANSITION_PRESETS.find(p => p.type === type);
    dispatch({
      type: "SET_CLIP_TRANSITION",
      payload: {
        clipId: clip.id,
        position,
        transition: type,
        duration: duration ?? preset?.defaultDuration ?? 0.5,
      },
    });
  };

  const TransitionPicker = ({ position, currentType, currentDuration }: {
    position: "in" | "out";
    currentType: TransitionType;
    currentDuration: number;
  }) => {
    const Icon = position === "in" ? ArrowRight : ArrowLeft;
    
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">
              Transition {position === "in" ? "In" : "Out"}
            </span>
          </div>
          {currentType !== "none" && (
            <span className="text-xs text-primary">
              {currentDuration.toFixed(1)}s
            </span>
          )}
        </div>

        {/* Transition grid */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => setTransition(position, "none", 0)}
            className={cn(
              "py-2 px-1 rounded-md border flex items-center justify-center text-[10px] font-medium transition-all",
              currentType === "none"
                ? "border-primary bg-primary/20 text-primary"
                : "border-border hover:border-primary/50"
            )}
          >
            None
          </button>
          {TRANSITION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setTransition(position, preset.type)}
              className={cn(
                "py-2 px-1 rounded-md border flex items-center justify-center text-[10px] font-medium transition-all",
                currentType === preset.type
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border hover:border-primary/50"
              )}
              title={preset.name}
            >
              {preset.name}
            </button>
          ))}
        </div>

        {/* Duration slider */}
        {currentType !== "none" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Duration</span>
              <span className="text-[10px] text-muted-foreground">
                {currentDuration.toFixed(1)}s
              </span>
            </div>
            <Slider
              value={[currentDuration]}
              onValueChange={([v]) => setTransition(position, currentType, v)}
              min={0.1}
              max={2}
              step={0.1}
              className="w-full"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Accordion type="single" collapsible defaultValue="transitions">
      <AccordionItem value="transitions" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Transitions
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          <TransitionPicker
            position="in"
            currentType={clip.transitionIn}
            currentDuration={clip.transitionInDuration}
          />
          
          <div className="border-t border-border/30" />
          
          <TransitionPicker
            position="out"
            currentType={clip.transitionOut}
            currentDuration={clip.transitionOutDuration}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
