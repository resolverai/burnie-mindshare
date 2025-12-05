"use client";

import { useState, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import { Button } from "@/components/ui/button";
import { Pipette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Extend Window interface for EyeDropper API
declare global {
  interface Window {
    EyeDropper?: new () => {
      open: () => Promise<{ sRGBHex: string }>;
    };
  }
}

interface ColorPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialColor: string;
  onColorSelect: (color: string) => void;
  title?: string;
}

export function ColorPickerDialog({
  open,
  onOpenChange,
  initialColor,
  onColorSelect,
  title = "Choose Color",
}: ColorPickerDialogProps) {
  const [color, setColor] = useState(initialColor);
  const [eyeDropperSupported, setEyeDropperSupported] = useState(false);

  // Check if EyeDropper API is supported
  useEffect(() => {
    setEyeDropperSupported(typeof window !== 'undefined' && 'EyeDropper' in window);
  }, []);

  // Reset color when dialog opens with new initial color
  useEffect(() => {
    if (open) {
      setColor(initialColor);
    }
  }, [open, initialColor]);

  const handleSave = () => {
    onColorSelect(color);
    onOpenChange(false);
  };

  const handleEyeDropper = async () => {
    if (!window.EyeDropper) return;
    
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      setColor(result.sRGBHex);
    } catch (e) {
      // User cancelled or error occurred
      console.log('EyeDropper cancelled or error:', e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Select a color for your brand
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-6">
          <HexColorPicker color={color} onChange={setColor} />
          
          <div className="flex items-center gap-4 w-full">
            <div
              className="w-16 h-16 rounded-lg border-2 border-border shadow-sm"
              style={{ backgroundColor: color }}
            />
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground">Hex Code</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 px-3 py-2 border border-input rounded-md bg-background"
                  placeholder="#000000"
                />
                {eyeDropperSupported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleEyeDropper}
                    title="Pick color from screen"
                    className="flex-shrink-0"
                  >
                    <Pipette className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Color
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

