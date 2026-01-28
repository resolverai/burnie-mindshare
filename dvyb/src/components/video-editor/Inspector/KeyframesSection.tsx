"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, generateId, ClipTransform, ClipFilters } from "@/types/video-editor";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Key, Plus, Trash2, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

interface KeyframesSectionProps {
  clip: Clip;
}

export function KeyframesSection({ clip }: KeyframesSectionProps) {
  const { dispatch, state } = useVideoEditor();

  const animatableProperties = [
    { key: "x", label: "Position X", group: "transform" },
    { key: "y", label: "Position Y", group: "transform" },
    { key: "scale", label: "Scale", group: "transform" },
    { key: "rotation", label: "Rotation", group: "transform" },
    { key: "opacity", label: "Opacity", group: "transform" },
  ];

  const addKeyframe = (property: string) => {
    const relativeTime = state.currentTime - clip.startTime;
    if (relativeTime < 0 || relativeTime > clip.duration) return;

    // Get current value for the property
    let value = 0;
    if (property in clip.transform) {
      value = clip.transform[property as keyof ClipTransform] as number;
    } else if (property in clip.filters) {
      value = clip.filters[property as keyof ClipFilters] as number;
    }

    const newKeyframe = {
      id: generateId(),
      time: relativeTime,
      property: property as keyof ClipTransform,
      value,
      easing: "ease-in-out" as const,
    };

    dispatch({
      type: "ADD_KEYFRAME",
      payload: { clipId: clip.id, keyframe: newKeyframe },
    });
  };

  const removeKeyframe = (keyframeId: string) => {
    dispatch({
      type: "REMOVE_KEYFRAME",
      payload: { clipId: clip.id, keyframeId },
    });
  };

  // Group keyframes by property
  const keyframesByProperty = clip.keyframes.reduce((acc, kf) => {
    if (!acc[kf.property]) {
      acc[kf.property] = [];
    }
    acc[kf.property].push(kf);
    return acc;
  }, {} as Record<string, typeof clip.keyframes>);

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="keyframes" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            Keyframes
            {clip.keyframes.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-[10px] text-primary">
                {clip.keyframes.length}
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pt-2">
          {/* Add keyframe buttons */}
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground">Add keyframe at current time</div>
            <div className="flex flex-wrap gap-1">
              {animatableProperties.map((prop) => (
                <button
                  key={prop.key}
                  onClick={() => addKeyframe(prop.key)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-secondary/50 hover:bg-secondary text-[10px] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {prop.label}
                </button>
              ))}
            </div>
          </div>

          {/* Keyframe list */}
          {clip.keyframes.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground">Active keyframes</div>
              {Object.entries(keyframesByProperty).map(([property, keyframes]) => (
                <div key={property} className="p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium capitalize">{property}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {keyframes.length} keyframe{keyframes.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Timeline visualization */}
                  <div className="relative h-6 bg-secondary/50 rounded overflow-hidden">
                    {keyframes.map((kf) => {
                      const position = (kf.time / clip.duration) * 100;
                      return (
                        <div
                          key={kf.id}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer group"
                          style={{ left: `${position}%` }}
                        >
                          <Diamond
                            className="h-4 w-4 text-primary fill-primary group-hover:scale-125 transition-transform"
                          />
                          <button
                            onClick={() => removeKeyframe(kf.id)}
                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          >
                            <Trash2 className="h-2 w-2" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Keyframe details */}
                  <div className="mt-2 space-y-1">
                    {keyframes.map((kf) => (
                      <div
                        key={kf.id}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <span className="text-muted-foreground">
                          {kf.time.toFixed(2)}s
                        </span>
                        <span>{kf.value.toFixed(2)}</span>
                        <select
                          value={kf.easing}
                          onChange={() => {}}
                          className="bg-transparent text-muted-foreground text-[10px]"
                        >
                          <option value="linear">Linear</option>
                          <option value="ease-in">Ease In</option>
                          <option value="ease-out">Ease Out</option>
                          <option value="ease-in-out">Ease In-Out</option>
                          <option value="bounce">Bounce</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <Diamond className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No keyframes</p>
              <p className="text-[10px]">Add keyframes to animate properties over time</p>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
