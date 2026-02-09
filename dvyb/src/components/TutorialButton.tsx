"use client";

import { BookOpen } from "lucide-react";
import { trackTutorialButtonClicked } from "@/lib/mixpanel";

interface TutorialButtonProps {
  /** Screen/context where the button is shown (e.g. "discover", "brands", "content-library") */
  screen: string;
}

export function TutorialButton({ screen }: TutorialButtonProps) {
  return (
    <button
      type="button"
      onClick={() => trackTutorialButtonClicked(screen)}
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[hsl(var(--landing-nav-bar-border))] bg-card hover:bg-[hsl(var(--landing-explore-pill-hover))] text-foreground text-sm font-medium"
    >
      <BookOpen className="w-4 h-4" />
      Tutorial
    </button>
  );
}
