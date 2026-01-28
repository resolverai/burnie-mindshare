"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, TextProperties, TextAnimation, defaultTextProperties } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { 
  Type, 
  AlignLeft, 
  AlignCenter, 
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Bold,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TextSectionProps {
  clip: Clip;
}

const fontFamilies = [
  "Inter",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Impact",
];

const animations: { value: TextAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade-in", label: "Fade In" },
  { value: "fade-out", label: "Fade Out" },
  { value: "typewriter", label: "Typewriter" },
  { value: "slide-up", label: "Slide Up" },
  { value: "slide-down", label: "Slide Down" },
  { value: "bounce", label: "Bounce" },
  { value: "zoom", label: "Zoom" },
  { value: "glow", label: "Glow" },
];

export function TextSection({ clip }: TextSectionProps) {
  const { dispatch } = useVideoEditor();
  
  const text = clip.text || defaultTextProperties;

  const updateText = (updates: Partial<TextProperties>) => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        text: { ...text, ...updates },
      },
    });
  };

  return (
    <Accordion type="single" collapsible defaultValue="text">
      <AccordionItem value="text" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-primary" />
            Text & Style
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Text Content */}
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Content</label>
            <textarea
              value={text.content}
              onChange={(e) => updateText({ content: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/50 text-sm resize-none h-20 focus:outline-none focus:border-primary/50"
              placeholder="Enter text..."
            />
          </div>

          {/* Font Family */}
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Font</label>
            <select
              value={text.fontFamily}
              onChange={(e) => updateText({ fontFamily: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/50 text-xs focus:outline-none focus:border-primary/50"
            >
              {fontFamilies.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size & Weight */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Size</label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[text.fontSize]}
                  onValueChange={([v]) => updateText({ fontSize: v })}
                  min={12}
                  max={120}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs w-8">{text.fontSize}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Weight</label>
              <select
                value={text.fontWeight}
                onChange={(e) => updateText({ fontWeight: Number(e.target.value) })}
                className="w-full px-2 py-1.5 rounded-lg bg-secondary/50 border border-border/50 text-xs focus:outline-none focus:border-primary/50"
              >
                <option value={300}>Light</option>
                <option value={400}>Regular</option>
                <option value={500}>Medium</option>
                <option value={600}>Semibold</option>
                <option value={700}>Bold</option>
                <option value={800}>Extrabold</option>
              </select>
            </div>
          </div>

          {/* Color */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Text Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={text.color}
                  onChange={(e) => updateText({ color: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={text.color}
                  onChange={(e) => updateText({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border/50 text-xs focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground">Background</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={text.backgroundColor || "#000000"}
                  onChange={(e) => updateText({ backgroundColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <button
                  onClick={() => updateText({ backgroundColor: undefined })}
                  className="px-2 py-1.5 rounded-lg bg-secondary/50 border border-border/50 text-[10px] hover:bg-secondary"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Alignment */}
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Alignment</label>
            <div className="flex gap-2">
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                {[
                  { value: "left", icon: AlignLeft },
                  { value: "center", icon: AlignCenter },
                  { value: "right", icon: AlignRight },
                ].map(({ value, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => updateText({ textAlign: value as TextProperties["textAlign"] })}
                    className={cn(
                      "p-2 transition-colors",
                      text.textAlign === value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-secondary/50"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                {[
                  { value: "top", icon: AlignVerticalJustifyStart },
                  { value: "middle", icon: AlignVerticalJustifyCenter },
                  { value: "bottom", icon: AlignVerticalJustifyEnd },
                ].map(({ value, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => updateText({ verticalAlign: value as TextProperties["verticalAlign"] })}
                    className={cn(
                      "p-2 transition-colors",
                      text.verticalAlign === value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-secondary/50"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Animation */}
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Animation</label>
            <div className="grid grid-cols-3 gap-1.5">
              {animations.map((anim) => (
                <button
                  key={anim.value}
                  onClick={() => updateText({ animation: anim.value })}
                  className={cn(
                    "px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all",
                    text.animation === anim.value
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border/50 hover:border-primary/50"
                  )}
                >
                  {anim.label}
                </button>
              ))}
            </div>
          </div>

          {/* Effects */}
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Effects</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateText({ shadow: !text.shadow })}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all",
                  text.shadow
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border/50 hover:border-primary/50"
                )}
              >
                Shadow
              </button>
              <button
                onClick={() => updateText({ outline: !text.outline })}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all",
                  text.outline
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border/50 hover:border-primary/50"
                )}
              >
                Outline
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="p-4 rounded-lg bg-black/50 flex items-center justify-center min-h-[80px]">
            <span
              style={{
                fontFamily: text.fontFamily,
                fontSize: Math.min(text.fontSize / 2, 24),
                fontWeight: text.fontWeight,
                color: text.color,
                backgroundColor: text.backgroundColor,
                padding: text.backgroundColor ? "4px 8px" : undefined,
                borderRadius: text.backgroundColor ? "4px" : undefined,
                textShadow: text.shadow ? "2px 2px 4px rgba(0,0,0,0.5)" : undefined,
                WebkitTextStroke: text.outline ? `1px ${text.outlineColor || "#000"}` : undefined,
              }}
            >
              {text.content || "Preview"}
            </span>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
