"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, BlendMode, BLEND_MODES } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { 
  Image as ImageIcon, 
  FlipHorizontal, 
  FlipVertical, 
  Square, 
  Circle,
  Layers,
  Sun,
  Move,
  RotateCw,
  Maximize2,
  Droplets,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageOverlaySectionProps {
  clip: Clip;
}

export function ImageOverlaySection({ clip }: ImageOverlaySectionProps) {
  const { dispatch } = useVideoEditor();

  const updateClip = (updates: Partial<Clip>) => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: { id: clip.id, ...updates },
    });
  };

  const updateTransform = (key: keyof Clip["transform"], value: number) => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        transform: { ...clip.transform, [key]: value },
      },
    });
  };

  return (
    <Accordion type="multiple" defaultValue={["transform", "appearance", "effects"]}>
      {/* Transform Section */}
      <AccordionItem value="transform" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Move className="h-4 w-4 text-primary" />
            Transform
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Position */}
          <div className="space-y-2">
            <span className="text-[10px] text-muted-foreground uppercase">Position</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">X</label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[clip.transform.x]}
                    onValueChange={([v]) => updateTransform("x", v)}
                    min={-500}
                    max={500}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-[10px] w-8 text-right">{clip.transform.x}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Y</label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[clip.transform.y]}
                    onValueChange={([v]) => updateTransform("y", v)}
                    min={-500}
                    max={500}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-[10px] w-8 text-right">{clip.transform.y}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                <Maximize2 className="h-3 w-3" /> Scale
              </span>
              <span className="text-xs font-medium">{Math.round(clip.transform.scale * 100)}%</span>
            </div>
            <Slider
              value={[clip.transform.scale * 100]}
              onValueChange={([v]) => updateTransform("scale", v / 100)}
              min={5}
              max={300}
              step={1}
            />
          </div>

          {/* Rotation */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                <RotateCw className="h-3 w-3" /> Rotation
              </span>
              <span className="text-xs font-medium">{clip.transform.rotation}°</span>
            </div>
            <Slider
              value={[clip.transform.rotation]}
              onValueChange={([v]) => updateTransform("rotation", v)}
              min={-180}
              max={180}
              step={1}
            />
          </div>

          {/* Flip buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => updateClip({ flipHorizontal: !clip.flipHorizontal })}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs transition-colors",
                clip.flipHorizontal 
                  ? "bg-primary/20 border-primary text-primary" 
                  : "border-border/50 hover:bg-secondary/50"
              )}
            >
              <FlipHorizontal className="h-4 w-4" />
              Flip H
            </button>
            <button
              onClick={() => updateClip({ flipVertical: !clip.flipVertical })}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs transition-colors",
                clip.flipVertical 
                  ? "bg-primary/20 border-primary text-primary" 
                  : "border-border/50 hover:bg-secondary/50"
              )}
            >
              <FlipVertical className="h-4 w-4" />
              Flip V
            </button>
          </div>

          {/* Reset button */}
          <button
            onClick={() => updateClip({ 
              transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
              flipHorizontal: false,
              flipVertical: false,
            })}
            className="w-full py-2 rounded-lg border border-border/50 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            Reset Transform
          </button>
        </AccordionContent>
      </AccordionItem>

      {/* Appearance Section */}
      <AccordionItem value="appearance" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Appearance
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Opacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                <Sun className="h-3 w-3" /> Opacity
              </span>
              <span className="text-xs font-medium">{Math.round(clip.transform.opacity * 100)}%</span>
            </div>
            <Slider
              value={[clip.transform.opacity * 100]}
              onValueChange={([v]) => updateTransform("opacity", v / 100)}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Blend Mode */}
          <div className="space-y-2">
            <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
              <Droplets className="h-3 w-3" /> Blend Mode
            </span>
            <div className="grid grid-cols-3 gap-1">
              {BLEND_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => updateClip({ blendMode: mode.id })}
                  className={cn(
                    "px-2 py-1.5 rounded text-[10px] transition-colors",
                    clip.blendMode === mode.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 hover:bg-secondary text-muted-foreground"
                  )}
                  title={mode.description}
                >
                  {mode.name}
                </button>
              ))}
            </div>
          </div>

          {/* Corner Radius */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                <Square className="h-3 w-3" /> Corner Radius
              </span>
              <span className="text-xs font-medium">{clip.cornerRadius || 0}px</span>
            </div>
            <Slider
              value={[clip.cornerRadius || 0]}
              onValueChange={([v]) => updateClip({ cornerRadius: v })}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Border */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase">Border Width</span>
              <span className="text-xs font-medium">{clip.borderWidth || 0}px</span>
            </div>
            <Slider
              value={[clip.borderWidth || 0]}
              onValueChange={([v]) => updateClip({ borderWidth: v })}
              min={0}
              max={20}
              step={1}
            />
            {(clip.borderWidth || 0) > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground">Color</label>
                <input
                  type="color"
                  value={clip.borderColor || "#ffffff"}
                  onChange={(e) => updateClip({ borderColor: e.target.value })}
                  className="w-8 h-6 rounded border border-border/50 cursor-pointer"
                />
                <span className="text-[10px] text-muted-foreground">{clip.borderColor || "#ffffff"}</span>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Effects Section */}
      <AccordionItem value="effects" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Circle className="h-4 w-4 text-primary" />
            Shadow & Effects
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Shadow Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Drop Shadow</span>
            <button
              onClick={() => updateClip({ shadowEnabled: !clip.shadowEnabled })}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                clip.shadowEnabled ? "bg-primary" : "bg-secondary"
              )}
            >
              <div 
                className={cn(
                  "absolute w-4 h-4 rounded-full bg-white top-0.5 transition-transform",
                  clip.shadowEnabled ? "translate-x-5" : "translate-x-0.5"
                )}
              />
            </button>
          </div>

          {clip.shadowEnabled && (
            <>
              {/* Shadow Color */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground">Shadow Color</label>
                <input
                  type="color"
                  value={clip.shadowColor?.replace(/rgba?\([^)]+\)/, "#000000") || "#000000"}
                  onChange={(e) => updateClip({ shadowColor: e.target.value + "80" })}
                  className="w-8 h-6 rounded border border-border/50 cursor-pointer"
                />
              </div>

              {/* Shadow Blur */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase">Blur</span>
                  <span className="text-xs font-medium">{clip.shadowBlur || 10}px</span>
                </div>
                <Slider
                  value={[clip.shadowBlur || 10]}
                  onValueChange={([v]) => updateClip({ shadowBlur: v })}
                  min={0}
                  max={50}
                  step={1}
                />
              </div>

              {/* Shadow Offset */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Offset X</label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[clip.shadowOffsetX || 0]}
                      onValueChange={([v]) => updateClip({ shadowOffsetX: v })}
                      min={-30}
                      max={30}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-[10px] w-6 text-right">{clip.shadowOffsetX || 0}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Offset Y</label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[clip.shadowOffsetY || 4]}
                      onValueChange={([v]) => updateClip({ shadowOffsetY: v })}
                      min={-30}
                      max={30}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-[10px] w-6 text-right">{clip.shadowOffsetY || 4}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Preview */}
          <div className="p-4 rounded-lg bg-secondary/30 flex items-center justify-center">
            <div 
              className="w-20 h-20 bg-gradient-to-br from-pink-500 to-purple-500"
              style={{
                opacity: clip.transform.opacity,
                transform: `
                  scale(${clip.transform.scale > 1 ? 1 : clip.transform.scale})
                  rotate(${clip.transform.rotation}deg)
                  scaleX(${clip.flipHorizontal ? -1 : 1})
                  scaleY(${clip.flipVertical ? -1 : 1})
                `,
                borderRadius: clip.cornerRadius || 0,
                border: clip.borderWidth ? `${clip.borderWidth}px solid ${clip.borderColor}` : undefined,
                boxShadow: clip.shadowEnabled 
                  ? `${clip.shadowOffsetX || 0}px ${clip.shadowOffsetY || 4}px ${clip.shadowBlur || 10}px ${clip.shadowColor || "rgba(0,0,0,0.5)"}`
                  : undefined,
                mixBlendMode: clip.blendMode || "normal",
              }}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
