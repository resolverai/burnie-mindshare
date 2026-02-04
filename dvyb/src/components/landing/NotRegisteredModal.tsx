"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface NotRegisteredModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGetStarted?: () => void;
}

export function NotRegisteredModal({ open, onOpenChange, onGetStarted }: NotRegisteredModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg sm:max-w-xl p-4 sm:p-6 min-h-[min(90vh,320px)] flex flex-col"
        closeButtonClassName="hover:opacity-70 hover:text-foreground"
      >
        <div className="flex-1 flex flex-col justify-center">
          <DialogHeader className="space-y-2 text-center">
            <DialogTitle className="text-base sm:text-lg text-center">You are not registered</DialogTitle>
            <DialogDescription className="text-sm text-center">
              Please start your journey by clicking Get Started.
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-4 justify-center mt-auto shrink-0">
          <Button
            onClick={() => {
              onOpenChange(false);
              onGetStarted?.();
            }}
            className="w-full sm:w-auto bg-foreground text-background hover:bg-foreground/90"
          >
            Get Started
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto border-0 bg-secondary hover:bg-secondary/80 hover:text-foreground"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
