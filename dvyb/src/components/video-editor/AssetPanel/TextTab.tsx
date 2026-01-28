"use client";

import { useCallback } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Type, Plus } from "lucide-react";

interface TextTabProps {
  searchQuery: string;
}

export function TextTab({ searchQuery }: TextTabProps) {
  const { state } = useVideoEditor();

  const filteredPresets = state.textPresets.filter((preset) =>
    preset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    preset.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group by category
  const presetsByCategory = filteredPresets.reduce((acc, preset) => {
    if (!acc[preset.category]) {
      acc[preset.category] = [];
    }
    acc[preset.category].push(preset);
    return acc;
  }, {} as Record<string, typeof filteredPresets>);

  const handleDragStart = useCallback((e: React.DragEvent, preset: typeof filteredPresets[0]) => {
    e.dataTransfer.setData("textPreset", JSON.stringify(preset));
    e.dataTransfer.setData("text/plain", preset.name);
    e.dataTransfer.effectAllowed = "copy";
    
    const dragImage = document.createElement("div");
    dragImage.style.cssText = "position: absolute; top: -1000px; padding: 8px 12px; background: #eab308; color: black; border-radius: 4px; font-size: 12px;";
    dragImage.textContent = preset.name;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Add Text Button */}
        <button className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all">
          <Plus className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Add Text</span>
        </button>

        <p className="text-[10px] text-muted-foreground text-center">
          Drag text presets to the Captions or Text Overlays track
        </p>

        {/* Text Presets by Category */}
        {Object.entries(presetsByCategory).map(([category, presets]) => (
          <div key={category}>
            <span className="text-xs font-medium text-muted-foreground">
              {category}
            </span>
            <div className="grid grid-cols-1 gap-2 mt-2">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="group p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-grab active:cursor-grabbing transition-all hover:ring-2 hover:ring-primary/50"
                  draggable
                  onDragStart={(e) => handleDragStart(e, preset)}
                >
                  <div
                    className="text-center mb-2"
                    style={{
                      fontFamily: preset.style.fontFamily,
                      fontSize: Math.min(preset.style.fontSize / 2, 24),
                      fontWeight: preset.style.fontWeight,
                      color: preset.style.color,
                      backgroundColor: preset.style.backgroundColor,
                      padding: preset.style.backgroundColor ? "4px 8px" : undefined,
                      borderRadius: preset.style.backgroundColor ? "4px" : undefined,
                      display: "inline-block",
                    }}
                  >
                    {preset.preview}
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center">
                    {preset.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filteredPresets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Type className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No text presets found</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
