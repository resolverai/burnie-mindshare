"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Play, Clock, Grid, List, Sparkles, Video, Image as ImageIcon, ChevronDown, ChevronRight, X, Trash2, Maximize2 } from "lucide-react";
import { useState, useCallback } from "react";
import { Asset } from "@/types/video-editor";
import { assetsApi } from "@/lib/api";

interface MediaTabProps {
  searchQuery: string;
}

export function MediaTab({ searchQuery }: MediaTabProps) {
  const { state, dispatch } = useVideoEditor();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [videosExpanded, setVideosExpanded] = useState(true);
  const [imagesExpanded, setImagesExpanded] = useState(true);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  const filteredAssets = state.mediaAssets.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    asset.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Separate videos and images
  const videoAssets = filteredAssets.filter((asset) => asset.type === "video");
  const imageAssets = filteredAssets.filter((asset) => asset.type === "image");

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    // Set the asset data as JSON
    e.dataTransfer.setData("asset", JSON.stringify(asset));
    e.dataTransfer.setData("text/plain", asset.name);
    e.dataTransfer.effectAllowed = "copy";
    
    // Create a custom drag image
    const dragImage = document.createElement("div");
    dragImage.style.cssText = "position: absolute; top: -1000px; padding: 8px 12px; background: #10b981; color: white; border-radius: 4px; font-size: 12px;";
    dragImage.textContent = asset.name;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, asset: Asset) => {
      e.stopPropagation();
      if (asset.isAdminAsset) return;
      try {
        await assetsApi.deleteAsset(asset.id);
      } catch (_) {
        // still remove from local state if API fails (e.g. already deleted)
      }
      dispatch({ type: "REMOVE_ASSET", payload: asset.id });
    },
    [dispatch]
  );

  const renderAssetItem = (asset: Asset) => (
    <div
      key={asset.id}
      className={cn(
        "group relative rounded-lg overflow-hidden cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/50 transition-all min-w-0",
        viewMode === "grid"
          ? "aspect-square bg-secondary w-full"
          : "flex items-center gap-3 p-2 bg-secondary/30 hover:bg-secondary/50"
      )}
      draggable
      onDragStart={(e) => handleDragStart(e, asset)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        setPreviewAsset(asset);
      }}
    >
      {viewMode === "grid" ? (
        <>
          {/* Thumbnail - use video element for videos, img for images */}
          {asset.type === "video" ? (
            <video
              src={asset.src || asset.thumbnail}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              muted
              preload="metadata"
              onLoadedMetadata={(e) => {
                const video = e.currentTarget;
                video.currentTime = Math.min(1, video.duration * 0.1);
              }}
            />
          ) : (
            <img
              src={asset.thumbnail || asset.src}
              alt={asset.name}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />

          {/* Play (video) / View (image) overlay - click opens modal */}
          <div
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setPreviewAsset(asset); }}
          >
            <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              {asset.type === "video" ? <Play className="h-4 w-4 text-white ml-0.5" fill="white" /> : <Maximize2 className="h-4 w-4 text-white" />}
            </div>
          </div>

          {/* Delete (user-uploaded only) */}
          {!asset.isAdminAsset && (
            <button
              type="button"
              onClick={(e) => handleDelete(e, asset)}
              className="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/50 hover:bg-destructive/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}

          {/* AI badge */}
          {asset.aiGenerated && (
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/80 text-[8px] text-white font-medium" style={!asset.isAdminAsset ? { right: "1.75rem" } : undefined}>
              <Sparkles className="h-2.5 w-2.5" />
              AI
            </div>
          )}

          {/* Info */}
          <div className="absolute bottom-0 left-0 right-0 p-2 pointer-events-none">
            <p className="text-[10px] text-white font-medium truncate">
              {asset.name}
            </p>
            {asset.duration && (
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="h-2.5 w-2.5 text-white/70" />
                <span className="text-[9px] text-white/70">
                  {formatDuration(asset.duration)}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            className="w-12 h-12 rounded overflow-hidden flex-shrink-0 relative cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setPreviewAsset(asset); }}
          >
            {asset.type === "video" ? (
              <video
                src={asset.src || asset.thumbnail}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  video.currentTime = Math.min(1, video.duration * 0.1);
                }}
              />
            ) : (
              <img
                src={asset.thumbnail || asset.src}
                alt={asset.name}
                className="w-full h-full object-cover"
              />
            )}
            {asset.aiGenerated && (
              <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-purple-500/80 flex items-center justify-center">
                <Sparkles className="h-2.5 w-2.5 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{asset.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground uppercase">
                {asset.type}
              </span>
              {asset.duration && (
                <span className="text-[10px] text-muted-foreground">
                  {formatDuration(asset.duration)}
                </span>
              )}
            </div>
          </div>
          {!asset.isAdminAsset && (
            <button
              type="button"
              onClick={(e) => handleDelete(e, asset)}
              className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    assets: Asset[],
    isExpanded: boolean,
    setExpanded: (val: boolean) => void,
    bgColor: string
  ) => {
    if (assets.length === 0) return null;

    return (
      <div className="mb-3">
        {/* Section Header */}
        <button
          onClick={() => setExpanded(!isExpanded)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
            bgColor
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {icon}
          <span className="text-xs font-medium flex-1 text-left">{title}</span>
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full bg-background/50">
            {assets.length}
          </span>
        </button>

        {/* Section Content */}
        {isExpanded && (
          <div
            className={cn(
              "mt-2 px-1",
              viewMode === "grid"
                ? "grid grid-cols-3 gap-1.5"
                : "flex flex-col gap-1"
            )}
          >
            {assets.map(renderAssetItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* View toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <span className="text-xs text-muted-foreground">
          {filteredAssets.length} items • Drag to Video track
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === "grid" ? "bg-primary/20 text-primary" : "hover:bg-secondary/50"
            )}
          >
            <Grid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === "list" ? "bg-primary/20 text-primary" : "hover:bg-secondary/50"
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">
          {/* Videos Section */}
          {renderSection(
            "Videos",
            <Video className="h-3.5 w-3.5 text-blue-500" />,
            videoAssets,
            videosExpanded,
            setVideosExpanded,
            "bg-blue-500/10 hover:bg-blue-500/20"
          )}

          {/* Images Section */}
          {renderSection(
            "Images",
            <ImageIcon className="h-3.5 w-3.5 text-green-500" />,
            imageAssets,
            imagesExpanded,
            setImagesExpanded,
            "bg-green-500/10 hover:bg-green-500/20"
          )}

          {/* Empty state */}
          {filteredAssets.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No media found</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Video / Image preview modal (like GenerateContentDialog Add context step) */}
      {previewAsset && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-black/80"
            onClick={() => setPreviewAsset(null)}
            aria-hidden
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4">
            <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden shadow-2xl">
              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                className="absolute top-4 right-4 z-20 bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <div className={cn("w-full", previewAsset.type === "video" ? "aspect-[9/16] max-h-[70vh]" : "max-h-[85vh]")}>
                {previewAsset.type === "video" ? (
                  <video
                    src={previewAsset.src || previewAsset.thumbnail}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    playsInline
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <img
                    src={previewAsset.src || previewAsset.thumbnail}
                    alt={previewAsset.name}
                    className="w-full h-full object-contain"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white text-sm font-medium truncate">{previewAsset.name}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
