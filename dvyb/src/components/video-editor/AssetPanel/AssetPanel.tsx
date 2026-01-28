"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaTab } from "./MediaTab";
import { AudioTab } from "./AudioTab";
import { TextTab } from "./TextTab";
import { EffectsTab } from "./EffectsTab";
import { TemplatesTab } from "./TemplatesTab";
import { ImageOverlaysTab } from "./ImageOverlaysTab";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { Video, Music, Type, Sparkles, Upload, Search, Layers, Image as ImageIcon, Volume2 } from "lucide-react";
import { useState, useCallback } from "react";
import { Asset, generateId, generateWaveformData } from "@/types/video-editor";
import { cn } from "@/lib/utils";
import { assetsApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// Map file to Dvyb asset type: video | image | audio | music | voiceover | overlay | sticker (from admin types)
function getAssetTypeFromFile(file: File): "video" | "image" | "audio" | "music" | "voiceover" | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

interface AssetPanelProps {
  refreshAssets?: () => Promise<void>;
}

export function AssetPanel(props?: AssetPanelProps) {
  const { refreshAssets } = props ?? {};
  const { dispatch } = useVideoEditor();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("media");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingAudioFiles, setPendingAudioFiles] = useState<File[] | null>(null);

  const processDroppedFile = useCallback(
    async (file: File, audioTypeOverride?: "music" | "audio"): Promise<Asset | null> => {
      const type = getAssetTypeFromFile(file);
      if (!type) return null;
      const preview = URL.createObjectURL(file);
      let duration: number | undefined;
      if (type === "video" || type === "audio") {
        duration = await new Promise<number>((resolve) => {
          const el = document.createElement(type === "video" ? "video" : "audio");
          el.src = preview;
          el.onloadedmetadata = () => resolve(el.duration);
          el.onerror = () => resolve(10);
        });
      }
      const assetType =
        type === "audio" && audioTypeOverride
          ? audioTypeOverride
          : type === "audio" && duration != null && duration >= 60
            ? "music"
            : type;
      const asset: Asset = {
        id: generateId(),
        name: file.name.replace(/\.[^/.]+$/, "") || file.name,
        type: assetType as Asset["type"],
        thumbnail: type === "video" || type === "image" ? preview : "/placeholder.svg",
        duration,
        src: preview,
        tags: [assetType],
        waveformData: (assetType === "audio" || assetType === "music" || assetType === "voiceover") ? generateWaveformData(100) : undefined,
        createdAt: new Date(),
        isAdminAsset: false,
      };
      return asset;
    },
    []
  );

  const [dropUploadProgress, setDropUploadProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);

  const uploadFileToBackend = useCallback(
    async (
      file: File,
      audioTypeOverride?: "music" | "audio",
      onProgress?: (percent: number) => void
    ): Promise<boolean> => {
      const type = getAssetTypeFromFile(file);
      if (!type) return false;
      let duration: number | undefined;
      if (type === "video" || type === "audio") {
        const preview = URL.createObjectURL(file);
        duration = await new Promise<number>((resolve) => {
          const el = document.createElement(type === "video" ? "video" : "audio");
          el.src = preview;
          el.onloadedmetadata = () => resolve(el.duration);
          el.onerror = () => resolve(10);
        });
        URL.revokeObjectURL(preview);
      }
      const assetType =
        type === "audio" && audioTypeOverride
          ? audioTypeOverride
          : type === "audio" && duration != null && duration >= 60
            ? "music"
            : type;
      const name = file.name.replace(/\.[^/.]+$/, "") || file.name;
      const createRes = await assetsApi.uploadAsset({
        name,
        type: assetType,
        tags: [assetType],
      });
      if (!createRes.success || !createRes.asset?.id) return false;
      const assetId = createRes.asset.id;
      const uploadRes = await assetsApi.uploadAssetFile(assetId, file, onProgress);
      if (!uploadRes.success) return false;
      await assetsApi.updateAsset(assetId, {
        duration: duration ?? undefined,
        metadata: duration != null ? { duration } : undefined,
      });
      return true;
    },
    []
  );

  const applyPendingAudio = useCallback(
    async (chosenType: "music" | "audio") => {
      if (!pendingAudioFiles?.length) return;
      setActiveTab("audio");
      if (refreshAssets) {
        const total = pendingAudioFiles.length;
        setDropUploadProgress({ current: 1, total, percent: 0 });
        let ok = true;
        for (let i = 0; i < total; i++) {
          if (i > 0) setDropUploadProgress((prev) => (prev ? { ...prev, current: i + 1, percent: 0 } : null));
          const success = await uploadFileToBackend(
            pendingAudioFiles[i],
            chosenType,
            (p) => setDropUploadProgress((prev) => (prev ? { ...prev, percent: p } : null))
          );
          if (!success) {
            ok = false;
            toast({ title: "Upload failed", description: `Could not upload ${pendingAudioFiles[i].name}`, variant: "destructive" });
          }
        }
        setDropUploadProgress((prev) => (prev ? { ...prev, percent: 100 } : null));
        await new Promise((r) => setTimeout(r, 500));
        setDropUploadProgress(null);
        if (ok) await refreshAssets();
      } else {
        for (const file of pendingAudioFiles) {
          const asset = await processDroppedFile(file, chosenType);
          if (asset) dispatch({ type: "ADD_ASSET", payload: asset });
        }
      }
      setPendingAudioFiles(null);
    },
    [pendingAudioFiles, processDroppedFile, dispatch, refreshAssets, uploadFileToBackend, toast]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const audioFiles = files.filter((f) => f.type.startsWith("audio/"));
      const otherFiles = files.filter((f) => !f.type.startsWith("audio/"));
      let hadMedia = false;
      let hadAudio = false;
      if (refreshAssets && otherFiles.length > 0) {
        const total = otherFiles.length;
        setDropUploadProgress({ current: 1, total, percent: 0 });
        for (let i = 0; i < total; i++) {
          if (i > 0) setDropUploadProgress((prev) => (prev ? { ...prev, current: i + 1, percent: 0 } : null));
          const success = await uploadFileToBackend(
            otherFiles[i],
            undefined,
            (p) => setDropUploadProgress((prev) => (prev ? { ...prev, percent: p } : null))
          );
          if (success) {
            if (getAssetTypeFromFile(otherFiles[i]) === "video" || getAssetTypeFromFile(otherFiles[i]) === "image") hadMedia = true;
            else hadAudio = true;
          } else {
            toast({ title: "Upload failed", description: `Could not upload ${otherFiles[i].name}`, variant: "destructive" });
          }
        }
        setDropUploadProgress((prev) => (prev ? { ...prev, percent: 100 } : null));
        await new Promise((r) => setTimeout(r, 600));
        setDropUploadProgress(null);
        if (hadMedia || hadAudio) await refreshAssets();
      } else if (otherFiles.length > 0) {
        for (const file of otherFiles) {
          const asset = await processDroppedFile(file);
          if (asset) {
            if (asset.type === "video" || asset.type === "image") hadMedia = true;
            else if (asset.type === "audio" || asset.type === "music" || asset.type === "voiceover") hadAudio = true;
            dispatch({ type: "ADD_ASSET", payload: asset });
          }
        }
      }
      if (audioFiles.length > 0) {
        setPendingAudioFiles(audioFiles);
        hadAudio = true;
      }
      if (hadMedia) setActiveTab("media");
      else if (hadAudio) setActiveTab("audio");
    },
    [dispatch, processDroppedFile, refreshAssets, uploadFileToBackend, toast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  }, []);

  return (
    <div
      className={cn("h-full flex flex-col bg-card/50 border-r border-border/30", isDraggingOver && "ring-2 ring-primary/50 ring-inset")}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Audio type disambiguation modal */}
      {pendingAudioFiles != null && pendingAudioFiles.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-2xl border border-border p-6 max-w-sm mx-4">
            <p className="text-sm font-medium text-foreground mb-1">Add audio as</p>
            <p className="text-xs text-muted-foreground mb-4">
              {pendingAudioFiles.length} file{pendingAudioFiles.length !== 1 ? "s" : ""} — choose how to categorize.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => applyPendingAudio("music")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition-colors"
              >
                <Music className="h-4 w-4 text-purple-500" />
                Background music
              </button>
              <button
                type="button"
                onClick={() => applyPendingAudio("audio")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium transition-colors"
              >
                <Volume2 className="h-4 w-4 text-blue-500" />
                Sound effects
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPendingAudioFiles(null)}
              className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Drop upload progress */}
      {dropUploadProgress != null && (
        <div className="min-h-[52px] flex flex-col justify-center px-3 py-2 border-b border-primary/30 bg-primary/10 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-foreground">
              Uploading {dropUploadProgress.current}/{dropUploadProgress.total}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{dropUploadProgress.percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{
                width: `${Math.min(100, (((dropUploadProgress.current - 1) + dropUploadProgress.percent / 100) / dropUploadProgress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="p-3 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Assets</span>
          <button 
            onClick={() => dispatch({ type: "SHOW_UPLOAD_MODAL", payload: true })}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-background border border-border/50 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Drag and drop files here to add</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-full justify-start rounded-none bg-transparent border-b border-border/30 p-0 h-auto flex-nowrap overflow-x-auto">
          <TabsTrigger
            value="media"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <Video className="h-3.5 w-3.5" />
            <span className="text-[10px]">Media</span>
          </TabsTrigger>
          <TabsTrigger
            value="audio"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <Music className="h-3.5 w-3.5" />
            <span className="text-[10px]">Audio</span>
          </TabsTrigger>
          <TabsTrigger
            value="text"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <Type className="h-3.5 w-3.5" />
            <span className="text-[10px]">Text</span>
          </TabsTrigger>
          <TabsTrigger
            value="overlays"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="text-[10px]">Overlays</span>
          </TabsTrigger>
          <TabsTrigger
            value="effects"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[10px]">Effects</span>
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2 py-2"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="text-[10px]">Templates</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="media" className="h-full m-0">
            <MediaTab searchQuery={searchQuery} />
          </TabsContent>
          <TabsContent value="audio" className="h-full m-0">
            <AudioTab searchQuery={searchQuery} />
          </TabsContent>
          <TabsContent value="text" className="h-full m-0">
            <TextTab searchQuery={searchQuery} />
          </TabsContent>
          <TabsContent value="overlays" className="h-full m-0">
            <ImageOverlaysTab searchQuery={searchQuery} />
          </TabsContent>
          <TabsContent value="effects" className="h-full m-0">
            <EffectsTab searchQuery={searchQuery} />
          </TabsContent>
          <TabsContent value="templates" className="h-full m-0">
            <TemplatesTab searchQuery={searchQuery} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
