"use client";


import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

interface CaptionEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCaption: string;
  onSave: (caption: string) => void;
}

export const CaptionEditDialog = ({ open, onOpenChange, initialCaption, onSave }: CaptionEditDialogProps) => {
  const [caption, setCaption] = useState(initialCaption);

  const handleSave = () => {
    onSave(caption);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Caption</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your caption..."
            className="min-h-[200px] resize-none"
          />
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
