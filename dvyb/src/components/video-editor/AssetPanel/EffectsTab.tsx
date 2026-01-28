"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  ArrowRightLeft,
  Palette,
  Smile,
  Layers,
} from "lucide-react";

interface EffectsTabProps {
  searchQuery: string;
}

const categoryIcons: Record<string, React.ElementType> = {
  transition: ArrowRightLeft,
  filter: Palette,
  sticker: Smile,
  overlay: Layers,
};

const categoryColors: Record<string, string> = {
  transition: "text-blue-500 bg-blue-500/10",
  filter: "text-purple-500 bg-purple-500/10",
  sticker: "text-yellow-500 bg-yellow-500/10",
  overlay: "text-pink-500 bg-pink-500/10",
};

export function EffectsTab({ searchQuery }: EffectsTabProps) {
  const { state } = useVideoEditor();

  const filteredEffects = state.effects.filter((effect) =>
    effect.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    effect.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group effects by type
  const groupedEffects = filteredEffects.reduce((acc, effect) => {
    if (!acc[effect.type]) {
      acc[effect.type] = [];
    }
    acc[effect.type].push(effect);
    return acc;
  }, {} as Record<string, typeof filteredEffects>);

  const typeLabels: Record<string, string> = {
    transition: "Transitions",
    filter: "Filters",
    sticker: "Stickers",
    overlay: "Overlays",
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {Object.entries(groupedEffects).map(([type, effects]) => {
          const Icon = categoryIcons[type] || Sparkles;
          const colorClass = categoryColors[type] || "text-primary bg-primary/10";

          return (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("p-1 rounded", colorClass)}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {typeLabels[type] || type} ({effects.length})
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {effects.map((effect) => (
                  <div
                    key={effect.id}
                    className="group relative aspect-square rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-grab transition-all hover:ring-2 hover:ring-primary/50 flex flex-col items-center justify-center p-2"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("effect", JSON.stringify(effect));
                    }}
                  >
                    {/* Effect icon/preview */}
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center mb-1",
                        colorClass
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Name */}
                    <span className="text-[9px] text-center text-muted-foreground truncate w-full">
                      {effect.name}
                    </span>

                    {/* Duration badge for transitions */}
                    {effect.duration && (
                      <span className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/50 text-[8px] text-white">
                        {effect.duration}s
                      </span>
                    )}

                    {/* Category tag */}
                    <span className="absolute bottom-1 left-1 right-1 text-[8px] text-center text-muted-foreground/70 truncate">
                      {effect.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {filteredEffects.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No effects found</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
