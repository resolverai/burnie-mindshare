"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check } from "lucide-react";

const AVAILABLE_FONTS = [
  "Inter",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Merriweather",
  "Playfair Display",
];

interface FontSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFont: string;
  onFontSelect: (font: string) => void;
  title?: string;
  fontType?: 'title' | 'body';
}

export function FontSelectorDialog({
  open,
  onOpenChange,
  currentFont,
  onFontSelect,
  title = "Select Font",
  fontType = 'title',
}: FontSelectorDialogProps) {
  const [selectedFont, setSelectedFont] = useState(currentFont);

  const handleSave = () => {
    onFontSelect(selectedFont);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Select a font for {fontType === 'title' ? 'titles' : 'body text'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 overflow-y-auto max-h-[400px]">
          <div className="space-y-2">
            {AVAILABLE_FONTS.map((font) => (
              <button
                key={font}
                onClick={() => setSelectedFont(font)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                  selectedFont === font
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span
                  className="text-lg"
                  style={{ fontFamily: font }}
                >
                  {font}
                </span>
                {selectedFont === font && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Font
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

