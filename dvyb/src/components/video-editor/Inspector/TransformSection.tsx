"use client";

import { useCallback } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Move, RotateCw, Maximize2, Eye } from "lucide-react";

interface TransformSectionProps {
  clip: Clip;
}

// Property slider component - defined outside to prevent recreating on each render
function PropertySlider({
  label,
  icon: Icon,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  icon: React.ElementType;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const handleValueChange = useCallback(
    (values: number[]) => {
      onChange(values[0]);
    },
    [onChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {typeof value === "number" ? value.toFixed(step < 1 ? 2 : 0) : value}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={handleValueChange}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
    </div>
  );
}

export function TransformSection({ clip }: TransformSectionProps) {
  const { dispatch } = useVideoEditor();

  const updateTransform = useCallback(
    (key: keyof Clip["transform"], value: number) => {
      dispatch({
        type: "UPDATE_CLIP",
        payload: {
          id: clip.id,
          transform: { ...clip.transform, [key]: value },
        },
      });
    },
    [dispatch, clip.id, clip.transform]
  );

  const handleScaleChange = useCallback(
    (v: number) => updateTransform("scale", v / 100),
    [updateTransform]
  );

  const handleRotationChange = useCallback(
    (v: number) => updateTransform("rotation", v),
    [updateTransform]
  );

  const handleOpacityChange = useCallback(
    (v: number) => updateTransform("opacity", v / 100),
    [updateTransform]
  );

  const handleReset = useCallback(() => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      },
    });
  }, [dispatch, clip.id]);

  return (
    <Accordion type="single" collapsible defaultValue="transform">
      <AccordionItem value="transform" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Move className="h-4 w-4 text-primary" />
            Transform
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Position */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">X Position</label>
              <input
                type="number"
                value={clip.transform.x}
                onChange={(e) => updateTransform("x", Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded-md bg-secondary/50 border border-border/50 text-xs focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Y Position</label>
              <input
                type="number"
                value={clip.transform.y}
                onChange={(e) => updateTransform("y", Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded-md bg-secondary/50 border border-border/50 text-xs focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {/* Scale */}
          <PropertySlider
            label="Scale"
            icon={Maximize2}
            value={clip.transform.scale * 100}
            min={10}
            max={200}
            step={1}
            unit="%"
            onChange={handleScaleChange}
          />

          {/* Rotation */}
          <PropertySlider
            label="Rotation"
            icon={RotateCw}
            value={clip.transform.rotation}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={handleRotationChange}
          />

          {/* Opacity */}
          <PropertySlider
            label="Opacity"
            icon={Eye}
            value={clip.transform.opacity * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={handleOpacityChange}
          />

          {/* Reset button */}
          <button
            onClick={handleReset}
            className="w-full py-2 rounded-lg border border-border/50 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            Reset Transform
          </button>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
