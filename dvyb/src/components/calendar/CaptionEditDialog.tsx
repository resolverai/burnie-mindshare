"use client";


import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { trackCaptionEdited } from "@/lib/mixpanel";

interface CaptionEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCaption: string;
  onSave: (caption: string) => void;
  platform?: string;
  contentType?: 'image' | 'video';
}

const platformLabels: Record<string, string> = {
  twitter: "X / Twitter",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

const platformIcons: Record<string, string> = {
  twitter: "𝕏",
  instagram: "📷",
  linkedin: "💼",
  tiktok: "🎵",
};

export const CaptionEditDialog = ({ open, onOpenChange, initialCaption, onSave, platform, contentType = 'image' }: CaptionEditDialogProps) => {
  const [caption, setCaption] = useState(initialCaption);

  // Update caption when initialCaption changes (e.g., switching platforms)
  useEffect(() => {
    setCaption(initialCaption);
  }, [initialCaption]);

  const handleSave = () => {
    if (platform) trackCaptionEdited(platform, contentType);
    onSave(caption);
    onOpenChange(false);
  };

  const platformLabel = platform ? platformLabels[platform] || platform : "Caption";
  const platformIcon = platform ? platformIcons[platform] || "✏️" : "✏️";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-lg md:max-w-xl lg:max-w-2xl z-[300] p-4 sm:p-6">
        <DialogHeader className="space-y-1 sm:space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg md:text-xl">
            <span className="text-lg sm:text-xl">{platformIcon}</span>
            <span>Edit {platformLabel} Caption</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Changes will only apply to {platformLabel}. Other platforms will keep their captions.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          <div className="relative">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your caption..."
              className="min-h-[150px] sm:min-h-[180px] md:min-h-[200px] resize-none text-sm sm:text-base leading-relaxed"
            />
            <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded">
              {caption.length} characters
            </div>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto text-sm sm:text-base py-2 sm:py-2.5"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              className="w-full sm:w-auto text-sm sm:text-base py-2 sm:py-2.5"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
