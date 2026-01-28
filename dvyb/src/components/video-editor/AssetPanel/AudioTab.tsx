"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Play, Pause, Clock, Music, Volume2, Mic, Sparkles, Trash2 } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { assetsApi } from "@/lib/api";

interface AudioTabProps {
  searchQuery: string;
}

export function AudioTab({ searchQuery }: AudioTabProps) {
  const { state, dispatch } = useVideoEditor();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSrcRef = useRef<string | null>(null);

  // Inline playback: sync playingId with actual <audio> element
  const playingAsset = playingId ? state.audioAssets.find((a) => a.id === playingId) : null;
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playingAsset?.src) {
      if (currentSrcRef.current !== playingAsset.src) {
        el.src = playingAsset.src;
        currentSrcRef.current = playingAsset.src;
        el.play().catch(() => {});
      }
    } else {
      el.pause();
      el.removeAttribute("src");
      currentSrcRef.current = null;
    }
  }, [playingAsset?.src, playingAsset?.id]);

  const handleEnded = useCallback(() => {
    setPlayingId(null);
    currentSrcRef.current = null;
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, asset: (typeof state.audioAssets)[0]) => {
      e.stopPropagation();
      if (asset.isAdminAsset) return;
      try {
        await assetsApi.deleteAsset(asset.id);
      } catch (_) {
        // still remove from local state if API fails
      }
      dispatch({ type: "REMOVE_ASSET", payload: asset.id });
      if (playingId === asset.id) {
        setPlayingId(null);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.removeAttribute("src");
        }
        currentSrcRef.current = null;
      }
    },
    [dispatch, playingId]
  );

  const filteredAssets = state.audioAssets.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    asset.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const musicAssets = filteredAssets.filter((a) => a.type === "music");
  const voiceoverAssets = filteredAssets.filter((a) => a.type === "voiceover");
  const sfxAssets = filteredAssets.filter((a) => a.type === "audio");

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const togglePlay = (id: string) => {
    setPlayingId(playingId === id ? null : id);
  };

  const handleDragStart = useCallback((e: React.DragEvent, asset: typeof filteredAssets[0]) => {
    e.dataTransfer.setData("asset", JSON.stringify(asset));
    e.dataTransfer.setData("text/plain", asset.name);
    e.dataTransfer.effectAllowed = "copy";
    
    const color = asset.type === "music" ? "#8b5cf6" : asset.type === "voiceover" ? "#f97316" : "#3b82f6";
    const dragImage = document.createElement("div");
    dragImage.style.cssText = `position: absolute; top: -1000px; padding: 8px 12px; background: ${color}; color: white; border-radius: 4px; font-size: 12px;`;
    dragImage.textContent = asset.name;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  }, []);

  const AudioItem = ({ asset }: { asset: typeof filteredAssets[0] }) => {
    const isPlaying = playingId === asset.id;
    const trackName = asset.type === "music" ? "Music" : asset.type === "voiceover" ? "Voiceover" : "Audio";
    const canDelete = !asset.isAdminAsset;

    return (
      <div
        className="group flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-grab active:cursor-grabbing transition-colors"
        draggable
        onDragStart={(e) => handleDragStart(e, asset)}
      >
        {/* Play button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePlay(asset.id);
          }}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
            isPlaying
              ? "bg-primary text-primary-foreground"
              : "bg-secondary hover:bg-primary/20"
          )}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium truncate">{asset.name}</p>
            {asset.aiGenerated && (
              <Sparkles className="h-3 w-3 text-purple-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              Drag to {trackName} track
            </span>
            {asset.duration && (
              <div className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  {formatDuration(asset.duration)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Waveform (mock) */}
        <div className="flex items-center gap-0.5 opacity-50">
          {(asset.waveformData || Array.from({ length: 8 })).slice(0, 8).map((value, i) => (
            <div
              key={i}
              className={cn(
                "w-0.5 rounded-full bg-current",
                isPlaying && "animate-pulse"
              )}
              style={{ height: typeof value === "number" ? value * 16 + 4 : Math.random() * 12 + 4 }}
            />
          ))}
        </div>

        {/* Delete (user-uploaded only) – always visible so users can find it */}
        {canDelete && (
          <button
            onClick={(e) => handleDelete(e, asset)}
            className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  };

  const Section = ({ 
    title, 
    icon: Icon, 
    iconColor, 
    assets 
  }: { 
    title: string; 
    icon: React.ElementType; 
    iconColor: string;
    assets: typeof filteredAssets;
  }) => {
    if (assets.length === 0) return null;
    
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          <span className="text-xs font-medium text-muted-foreground">
            {title} ({assets.length})
          </span>
        </div>
        <div className="space-y-1">
          {assets.map((asset) => (
            <AudioItem key={asset.id} asset={asset} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        className="sr-only"
        playsInline
      />
      <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        <Section 
          title="Music" 
          icon={Music} 
          iconColor="text-purple-500" 
          assets={musicAssets} 
        />
        
        <Section 
          title="Voiceover" 
          icon={Mic} 
          iconColor="text-orange-500" 
          assets={voiceoverAssets} 
        />
        
        <Section 
          title="Sound Effects" 
          icon={Volume2} 
          iconColor="text-blue-500" 
          assets={sfxAssets} 
        />

        {filteredAssets.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Volume2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No audio found</p>
          </div>
        )}
      </div>
    </ScrollArea>
    </>
  );
}
