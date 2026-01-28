"use client";

import { useState, useEffect } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AssetPanel } from "./AssetPanel/AssetPanel";
import { PreviewPlayer } from "./Preview/PreviewPlayer";
import { Timeline } from "./Timeline/Timeline";
import { Inspector } from "./Inspector/Inspector";
import { EditorHeader } from "./EditorHeader";
import { UploadModal } from "./modals/UploadModal";
import { AIPromptModal } from "./modals/AIPromptModal";
import { GenerateWithAIModal, type GenerateWithAIContext } from "./modals/GenerateWithAIModal";
import { ExportModal } from "./modals/ExportModal";
import { ShareModal } from "./modals/ShareModal";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { cn } from "@/lib/utils";
import { Layers, Play, Settings2 } from "lucide-react";

const INSPECTOR_DRAWER_WIDTH = 320;

interface EditorLayoutProps {
  onClose?: () => void;
  onSave?: () => void;
  onClearDraft?: () => void;
  refreshAssets?: () => Promise<void>;
}

type MobileTab = "preview" | "assets" | "inspector";

export function EditorLayout({ onClose, onSave, onClearDraft, refreshAssets }: EditorLayoutProps) {
  const { state, dispatch } = useVideoEditor();
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>("preview");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [generateAIContext, setGenerateAIContext] = useState<GenerateWithAIContext | null>(null);

  // When a clip is selected, open the Inspector drawer; when none selected, keep it closed
  useEffect(() => {
    if (state.selectedClipId) {
      setInspectorOpen(true);
    } else {
      setInspectorOpen(false);
    }
  }, [state.selectedClipId]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Editor Header */}
      <EditorHeader onClose={onClose} onSave={onSave} onClearDraft={onClearDraft} />

      {/* Desktop Layout (lg and up): Assets + Preview take full width; Inspector opens as drawer */}
      <div className="flex-1 overflow-hidden hidden lg:flex lg:flex-row">
        {/* Main content: Assets + Preview + Timeline — shrinks when Inspector opens */}
        <div
          className="h-full min-w-0 transition-[width] duration-200 ease-out flex-shrink-0"
          style={{ width: inspectorOpen ? `calc(100% - ${INSPECTOR_DRAWER_WIDTH}px)` : "100%" }}
        >
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left Panel - Asset Browser */}
                <ResizablePanel defaultSize={26} minSize={20} maxSize={38}>
              <AssetPanel refreshAssets={refreshAssets} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center Panel - Preview + Timeline */}
            <ResizablePanel defaultSize={74} minSize={50}>
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={55} minSize={30}>
                  <PreviewPlayer />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={45} minSize={25}>
                  <Timeline
                    onOpenInspector={() => setInspectorOpen(true)}
                    onOpenGenerateAI={(ctx) => setGenerateAIContext(ctx)}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Inspector drawer: closed by default; opens when a clip is selected */}
        <div
          className="h-full flex-shrink-0 overflow-hidden border-l border-border/30 bg-card/50 transition-[width] duration-200 ease-out"
          style={{ width: inspectorOpen ? INSPECTOR_DRAWER_WIDTH : 0 }}
        >
          <Inspector onClose={() => setInspectorOpen(false)} />
        </div>
      </div>

      {/* Mobile/Tablet Layout (below lg) */}
      <div className="flex-1 overflow-hidden flex flex-col lg:hidden">
        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {/* Preview Tab Content */}
          <div className={cn(
            "absolute inset-0 flex flex-col transition-opacity duration-200",
            activeMobileTab === "preview" ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
          )}>
            {/* Preview Player - takes more space on mobile */}
            <div className="flex-1 min-h-0">
              <PreviewPlayer />
            </div>
            {/* Timeline - compact on mobile */}
            <div className="h-[200px] sm:h-[250px] border-t border-border/30 overflow-hidden">
              <Timeline onOpenGenerateAI={(ctx) => setGenerateAIContext(ctx)} />
            </div>
          </div>

          {/* Assets Tab Content */}
          <div className={cn(
            "absolute inset-0 transition-opacity duration-200",
            activeMobileTab === "assets" ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
          )}>
            <AssetPanel refreshAssets={refreshAssets} />
          </div>

          {/* Inspector Tab Content */}
          <div className={cn(
            "absolute inset-0 transition-opacity duration-200",
            activeMobileTab === "inspector" ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
          )}>
            <Inspector />
          </div>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="flex-shrink-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex justify-around items-center h-14 px-2">
            <button
              onClick={() => setActiveMobileTab("assets")}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-lg transition-colors flex-1",
                activeMobileTab === "assets" 
                  ? "text-primary bg-primary/10" 
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Layers className="h-5 w-5" />
              <span className="text-[10px] font-medium">Assets</span>
            </button>

            <button
              onClick={() => setActiveMobileTab("preview")}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-lg transition-colors flex-1",
                activeMobileTab === "preview" 
                  ? "text-primary bg-primary/10" 
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Play className="h-5 w-5" />
              <span className="text-[10px] font-medium">Preview</span>
            </button>

            <button
              onClick={() => setActiveMobileTab("inspector")}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-lg transition-colors flex-1",
                activeMobileTab === "inspector" 
                  ? "text-primary bg-primary/10" 
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Settings2 className="h-5 w-5" />
              <span className="text-[10px] font-medium">Inspector</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        isOpen={state.showUploadModal}
        onClose={() => dispatch({ type: "SHOW_UPLOAD_MODAL", payload: false })}
        onUploadSuccess={refreshAssets}
      />
      <AIPromptModal
        isOpen={state.showAIPromptModal}
        onClose={() => dispatch({ type: "SHOW_AI_PROMPT_MODAL", payload: null })}
      />
      <GenerateWithAIModal
        isOpen={generateAIContext != null}
        onClose={() => setGenerateAIContext(null)}
        context={generateAIContext}
        onGenerate={async (_context, _prompt) => {
          // Generation logic TBD — different models per track type
        }}
      />
      <ExportModal
        isOpen={state.showExportModal}
        onClose={() => dispatch({ type: "SHOW_EXPORT_MODAL", payload: false })}
      />
      <ShareModal
        isOpen={state.showShareModal}
        onClose={() => dispatch({ type: "SHOW_SHARE_MODAL", payload: false })}
      />
    </div>
  );
}
