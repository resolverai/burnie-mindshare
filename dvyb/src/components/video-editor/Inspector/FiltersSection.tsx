"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Clip, FilterPreset, FILTER_PRESETS } from "@/types/video-editor";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Palette, Sun, Contrast, Droplets, CircleDot, Brush, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface FiltersSectionProps {
  clip: Clip;
}

export function FiltersSection({ clip }: FiltersSectionProps) {
  const { dispatch } = useVideoEditor();

  const updateFilter = (key: keyof Clip["filters"], value: number) => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        filters: { ...clip.filters, [key]: value },
      },
    });
  };

  const setFilterPreset = (preset: FilterPreset) => {
    const presetDef = FILTER_PRESETS.find(p => p.id === preset);
    if (presetDef) {
      dispatch({
        type: "UPDATE_CLIP",
        payload: {
          id: clip.id,
          filterPreset: preset,
          filters: {
            ...clip.filters,
            brightness: presetDef.filters.brightness ?? 100,
            contrast: presetDef.filters.contrast ?? 100,
            saturation: presetDef.filters.saturation ?? 100,
            hue: presetDef.filters.hue ?? 0,
            blur: presetDef.filters.blur ?? 0,
            vignette: presetDef.filters.vignette ?? 0,
            sharpen: presetDef.filters.sharpen ?? 0,
            grain: presetDef.filters.grain ?? 0,
          },
        },
      });
    }
  };

  const resetFilters = () => {
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        id: clip.id,
        filterPreset: "none",
        filters: {
          brightness: 100,
          contrast: 100,
          saturation: 100,
          hue: 0,
          blur: 0,
          sharpen: 0,
          vignette: 0,
          grain: 0,
        },
      },
    });
  };

  const FilterSlider = ({
    label,
    icon: Icon,
    value,
    min,
    max,
    defaultValue,
    unit = "",
    onChange,
  }: {
    label: string;
    icon: React.ElementType;
    value: number;
    min: number;
    max: number;
    defaultValue: number;
    unit?: string;
    onChange: (value: number) => void;
  }) => {
    const isModified = value !== defaultValue;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-3.5 w-3.5", isModified ? "text-primary" : "text-muted-foreground")} />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs", isModified ? "text-primary" : "text-muted-foreground")}>
              {value}{unit}
            </span>
            {isModified && (
              <button
                onClick={() => onChange(defaultValue)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={min}
          max={max}
          step={1}
          className="w-full"
        />
      </div>
    );
  };

  return (
    <Accordion type="single" collapsible defaultValue="filters">
      <AccordionItem value="filters" className="border-border/30">
        <AccordionTrigger className="py-2 text-xs font-medium hover:no-underline">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            Filters & Color
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-2">
          {/* Filter Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Presets</span>
              <button
                onClick={resetFilters}
                className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
              >
                Reset All
              </button>
            </div>
            
            <div className="grid grid-cols-4 gap-1.5">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setFilterPreset(preset.id)}
                  className={cn(
                    "aspect-square rounded-lg border flex flex-col items-center justify-center p-1 transition-all",
                    clip.filterPreset === preset.id
                      ? "border-primary bg-primary/20"
                      : "border-border/50 hover:border-primary/50"
                  )}
                  title={preset.name}
                >
                  <div 
                    className="w-6 h-6 rounded-md mb-1"
                    style={{
                      background: "linear-gradient(135deg, #ff6b6b, #4ecdc4, #45b7d1)",
                      filter: preset.id === "none" ? "none" : `
                        brightness(${preset.filters.brightness ?? 100}%)
                        contrast(${preset.filters.contrast ?? 100}%)
                        saturate(${preset.filters.saturation ?? 100}%)
                        hue-rotate(${preset.filters.hue ?? 0}deg)
                      `,
                    }}
                  />
                  <span className="text-[8px] truncate w-full text-center">
                    {preset.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Manual Adjustments */}
          <div className="space-y-3 pt-2 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground">Manual Adjustments</span>
            
            <FilterSlider
              label="Brightness"
              icon={Sun}
              value={clip.filters.brightness}
              min={0}
              max={200}
              defaultValue={100}
              unit="%"
              onChange={(v) => updateFilter("brightness", v)}
            />

            <FilterSlider
              label="Contrast"
              icon={Contrast}
              value={clip.filters.contrast}
              min={0}
              max={200}
              defaultValue={100}
              unit="%"
              onChange={(v) => updateFilter("contrast", v)}
            />

            <FilterSlider
              label="Saturation"
              icon={Droplets}
              value={clip.filters.saturation}
              min={0}
              max={200}
              defaultValue={100}
              unit="%"
              onChange={(v) => updateFilter("saturation", v)}
            />

            <FilterSlider
              label="Hue Shift"
              icon={CircleDot}
              value={clip.filters.hue}
              min={-180}
              max={180}
              defaultValue={0}
              unit="°"
              onChange={(v) => updateFilter("hue", v)}
            />

            <FilterSlider
              label="Blur"
              icon={Brush}
              value={clip.filters.blur}
              min={0}
              max={20}
              defaultValue={0}
              unit="px"
              onChange={(v) => updateFilter("blur", v)}
            />

            <FilterSlider
              label="Sharpen"
              icon={Sparkles}
              value={clip.filters.sharpen}
              min={0}
              max={100}
              defaultValue={0}
              unit="%"
              onChange={(v) => updateFilter("sharpen", v)}
            />

            <FilterSlider
              label="Vignette"
              icon={CircleDot}
              value={clip.filters.vignette}
              min={0}
              max={100}
              defaultValue={0}
              unit="%"
              onChange={(v) => updateFilter("vignette", v)}
            />
          </div>

          {/* Preview */}
          <div className="p-3 rounded-lg bg-secondary/30">
            <div className="text-[10px] text-muted-foreground mb-2">Preview</div>
            <div
              className="h-16 rounded-md overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 50%, #45b7d1 100%)",
                filter: `
                  brightness(${clip.filters.brightness}%)
                  contrast(${clip.filters.contrast}%)
                  saturate(${clip.filters.saturation}%)
                  hue-rotate(${clip.filters.hue}deg)
                  blur(${clip.filters.blur}px)
                `,
              }}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
