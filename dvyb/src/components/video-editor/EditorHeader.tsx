"use client";

import { useState, useCallback } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import {
  ChevronLeft,
  Save,
  Download,
  Trash2,
  Bug,
  Copy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

interface EditorHeaderProps {
  onClose?: () => void;
  onSave?: () => void;
  onClearDraft?: () => void;
}

const DRAFT_KEY_PREFIX = "video-edit-draft-";

export function EditorHeader({ onClose, onSave, onClearDraft }: EditorHeaderProps) {
  const { state, dispatch } = useVideoEditor();
  const [showDebugModal, setShowDebugModal] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    onSave?.();
  };

  const getDraftFromStorage = useCallback(() => {
    const cid = state.generatedContentId;
    const pidx = state.postIndex;
    const key =
      cid != null && pidx != null
        ? `${DRAFT_KEY_PREFIX}${cid}-${pidx}`
        : null;
    if (!key || typeof window === "undefined") {
      return {
        key: key ?? "(no generatedContentId/postIndex)",
        found: false,
        data: null,
      };
    }
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { key, found: false, data: null };
    }
    try {
      const data = JSON.parse(raw);
      return { key, found: true, data };
    } catch {
      return { key, found: true, data: raw };
    }
  }, [state.generatedContentId, state.postIndex]);

  const handleCopyDebug = () => {
    const { key, found, data } = getDraftFromStorage();
    const payload = JSON.stringify({ key, found, data }, null, 2);
    navigator.clipboard.writeText(payload).then(
      () => toast({ title: "Copied to clipboard" }),
      () => toast({ title: "Copy failed", variant: "destructive" })
    );
  };

  const debugPayload = showDebugModal ? getDraftFromStorage() : null;
  const debugJson =
    debugPayload == null
      ? ""
      : JSON.stringify(
          { key: debugPayload.key, found: debugPayload.found, data: debugPayload.data },
          null,
          2
        );

  return (
    <>
      <header className="h-12 sm:h-14 border-b border-border/50 bg-background/95 backdrop-blur-sm flex items-center justify-between px-2 sm:px-4 flex-shrink-0">
        {/* Left - Back & Project Name */}
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          {onClose && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors flex-shrink-0"
              >
                <ChevronLeft className="h-5 w-5 text-muted-foreground" />
              </Button>
              <div className="h-4 w-px bg-border hidden sm:block" />
            </>
          )}

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <input
              type="text"
              value={state.projectName}
              onChange={(e) =>
                dispatch({ type: "SET_PROJECT_NAME", payload: e.target.value })
              }
              className="bg-transparent border-none text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 rounded px-1.5 sm:px-2 py-1 w-24 sm:w-48 truncate"
            />
            <span className="text-xs text-muted-foreground hidden sm:inline">•</span>
            <span className="text-xs text-muted-foreground">
              {state.aspectRatio}
            </span>
          </div>
        </div>

        {/* Right - Actions */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setShowDebugModal(true)}
            className="p-2 sm:p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground flex items-center gap-2"
            title="Debug: view draft in localStorage"
            aria-label="Debug draft"
          >
            <Bug className="h-4 w-4" />
          </button>

          <button 
            onClick={handleSave}
            className="p-2 sm:px-3 sm:py-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-sm text-muted-foreground flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            <span className="hidden sm:inline">Save</span>
          </button>
          
          {onClearDraft && (
            <button 
              onClick={onClearDraft}
              className="p-2 sm:px-3 sm:py-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors text-sm flex items-center gap-2"
              title="Clear saved draft"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear Draft</span>
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 sm:px-3 sm:py-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-sm text-muted-foreground flex items-center gap-2"
              title="Close"
            >
              <span>Close</span>
            </button>
          )}

          <button 
            onClick={() => dispatch({ type: "SHOW_EXPORT_MODAL", payload: true })}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs sm:text-sm font-medium"
          >
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>
        </div>
      </header>

      <Dialog open={showDebugModal} onOpenChange={setShowDebugModal}>
        <DialogContent className="max-w-[90vw] w-full max-h-[85vh] flex flex-col gap-4 overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-muted-foreground" />
              Draft in localStorage
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground flex-shrink-0">
            Key: <code className="bg-muted px-1.5 py-0.5 rounded">
              {debugPayload?.key ?? ""}
            </code>
            {debugPayload?.found === false && (
              <span className="ml-2">(no draft found for this video)</span>
            )}
          </div>
          <ScrollArea className="h-[50vh] min-h-[200px] max-h-[60vh] rounded-md border border-border bg-muted/30">
            <div className="p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {debugJson || "{}"}
              </pre>
            </div>
          </ScrollArea>
          <div className="flex justify-end gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={handleCopyDebug}>
              <Copy className="h-4 w-4 mr-2" />
              Copy JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowDebugModal(false)}>
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
