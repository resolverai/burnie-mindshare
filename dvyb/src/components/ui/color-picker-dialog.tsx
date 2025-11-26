"use client";

import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

  const handleSave = () => {
    onColorSelect(color);
    onOpenChange(false);
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
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-background"
                placeholder="#000000"
              />
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

