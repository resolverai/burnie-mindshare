"use client";

import { useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Sparkles, Square, Circle, Star, Heart, Hexagon } from "lucide-react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import type { Asset } from "@/types/video-editor";

interface ImageOverlaysTabProps {
  searchQuery: string;
}

// Mock image overlay assets - these should eventually come from the assets API
const imageOverlays = [
  {
    id: "overlay-1",
    name: "Company Logo",
    thumbnail: "/placeholder.svg",
    category: "Logos",
    tags: ["logo", "branding"],
  },
  {
    id: "overlay-2",
    name: "Subscribe Button",
    thumbnail: "/placeholder.svg",
    category: "CTA",
    tags: ["button", "subscribe"],
    aiGenerated: true,
  },
  {
    id: "overlay-3",
    name: "Arrow Pointer",
    thumbnail: "/placeholder.svg",
    category: "Shapes",
    tags: ["arrow", "pointer"],
  },
  {
    id: "overlay-4",
    name: "Social Icons",
    thumbnail: "/placeholder.svg",
    category: "Social",
    tags: ["social", "icons"],
  },
  {
    id: "overlay-5",
    name: "Frame Border",
    thumbnail: "/placeholder.svg",
    category: "Frames",
    tags: ["frame", "border"],
  },
  {
    id: "overlay-6",
    name: "Sticker Pack",
    thumbnail: "/placeholder.svg",
    category: "Stickers",
    tags: ["sticker", "emoji"],
    aiGenerated: true,
  },
];

// Shape presets that can be used as overlays
const shapePresets = [
  { id: "shape-rect", name: "Rectangle", icon: Square, color: "#10b981" },
  { id: "shape-circle", name: "Circle", icon: Circle, color: "#3b82f6" },
  { id: "shape-star", name: "Star", icon: Star, color: "#eab308" },
  { id: "shape-heart", name: "Heart", icon: Heart, color: "#ef4444" },
  { id: "shape-hex", name: "Hexagon", icon: Hexagon, color: "#8b5cf6" },
];

export function ImageOverlaysTab({ searchQuery }: ImageOverlaysTabProps) {
  const { state } = useVideoEditor();
  const yourImages = state.mediaAssets.filter(
    (a) => a.type === "image" && (a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())))
  );
  const filteredOverlays = imageOverlays.filter((overlay) =>
    overlay.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    overlay.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
    overlay.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDragStart = useCallback((e: React.DragEvent, overlay: typeof imageOverlays[0]) => {
    const asset = {
      id: overlay.id,
      name: overlay.name,
      type: "overlay" as const,
      thumbnail: overlay.thumbnail,
      tags: overlay.tags,
      aiGenerated: overlay.aiGenerated || false,
    };
    e.dataTransfer.setData("asset", JSON.stringify(asset));
    e.dataTransfer.setData("text/plain", overlay.name);
    e.dataTransfer.effectAllowed = "copy";
    
    const dragImage = document.createElement("div");
    dragImage.style.cssText = "position: absolute; top: -1000px; padding: 8px 12px; background: #ec4899; color: white; border-radius: 4px; font-size: 12px;";
    dragImage.textContent = overlay.name;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, []);

  const handleShapeDragStart = useCallback((e: React.DragEvent, shape: typeof shapePresets[0]) => {
    const asset = {
      id: shape.id,
      name: shape.name,
      type: "overlay" as const,
      tags: ["shape", shape.name.toLowerCase()],
    };
    e.dataTransfer.setData("asset", JSON.stringify(asset));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleYourImageDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    const overlayAsset = { ...asset, type: "overlay" as const, thumbnail: asset.thumbnail || asset.src, src: asset.src };
    e.dataTransfer.setData("asset", JSON.stringify(overlayAsset));
    e.dataTransfer.setData("text/plain", asset.name);
    e.dataTransfer.effectAllowed = "copy";
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;top:-1000px;padding:8px 12px;background:#ec4899;color:white;border-radius:4px;font-size:12px;";
    el.textContent = asset.name;
    document.body.appendChild(el);
    e.dataTransfer.setDragImage(el, 0, 0);
    setTimeout(() => document.body.removeChild(el), 0);
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Your images (imported / dropped) - use as overlay */}
        {yourImages.length > 0 && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">Your images</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Imported or dropped images — drag to Overlays track</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {yourImages.map((asset) => (
                <div
                  key={asset.id}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-secondary cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/50 transition-all"
                  draggable
                  onDragStart={(e) => handleYourImageDragStart(e, asset)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.thumbnail || asset.src}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[10px] text-white font-medium truncate">{asset.name}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shape Presets */}
        <div>
          <span className="text-xs font-medium text-muted-foreground">Quick Shapes</span>
          <div className="grid grid-cols-5 gap-2 mt-2">
            {shapePresets.map((shape) => (
              <button
                key={shape.id}
                className="aspect-square rounded-lg bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={(e) => handleShapeDragStart(e, shape)}
                title={shape.name}
              >
                <shape.icon className="h-5 w-5" style={{ color: shape.color }} />
              </button>
            ))}
          </div>
        </div>

        {/* Image Overlays Grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Image Overlays</span>
            <span className="text-[10px] text-muted-foreground">Drag to Image Overlays track</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            {filteredOverlays.map((overlay) => (
              <div
                key={overlay.id}
                className="group relative aspect-square rounded-lg overflow-hidden bg-secondary cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/50 transition-all"
                draggable
                onDragStart={(e) => handleDragStart(e, overlay)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={overlay.thumbnail}
                  alt={overlay.name}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                
                {/* AI badge */}
                {overlay.aiGenerated && (
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/80 text-[8px] text-white font-medium">
                    <Sparkles className="h-2.5 w-2.5" />
                    AI
                  </div>
                )}

                {/* Category badge */}
                <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-pink-500/80 text-[8px] text-white uppercase">
                  {overlay.category}
                </div>

                {/* Info */}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-[10px] text-white font-medium truncate">
                    {overlay.name}
                  </p>
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {filteredOverlays.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No image overlays found</p>
          </div>
        )}

        {/* Help text */}
        <div className="p-3 rounded-lg bg-secondary/30 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Image Overlay Tips:</p>
          <ul className="list-disc list-inside space-y-1 text-[10px]">
            <li>Drag overlays to the Image Overlays track</li>
            <li>Use blend modes for creative effects</li>
            <li>Adjust position, scale, and rotation in Inspector</li>
            <li>Add shadows and borders for depth</li>
          </ul>
        </div>
      </div>
    </ScrollArea>
  );
}
