"use client";

import { useState, useEffect, useRef } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { X, Download, Film, Settings, Loader2, Check, AlertCircle } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { videoEditsApi, accountApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportComplete?: (videoUrl: string) => void;
}

type Resolution = "720p" | "1080p" | "2k" | "4k";
type Format = "mp4" | "webm" | "mov";
type Quality = "low" | "medium" | "high" | "ultra";

const resolutions: { value: Resolution; label: string; dimensions: string }[] = [
  { value: "720p", label: "HD 720p", dimensions: "1280 × 720" },
  { value: "1080p", label: "Full HD 1080p", dimensions: "1920 × 1080" },
  { value: "2k", label: "2K QHD", dimensions: "2560 × 1440" },
  { value: "4k", label: "4K UHD", dimensions: "3840 × 2160" },
];

const formats: { value: Format; label: string; description: string }[] = [
  { value: "mp4", label: "MP4 (H.264)", description: "Best compatibility" },
  { value: "webm", label: "WebM (VP9)", description: "Smaller file size" },
  { value: "mov", label: "MOV (ProRes)", description: "Best quality" },
];

const qualities: { value: Quality; label: string; bitrate: string }[] = [
  { value: "low", label: "Low", bitrate: "5 Mbps" },
  { value: "medium", label: "Medium", bitrate: "10 Mbps" },
  { value: "high", label: "High", bitrate: "20 Mbps" },
  { value: "ultra", label: "Ultra", bitrate: "50 Mbps" },
];

export function ExportModal({ isOpen, onClose, onExportComplete }: ExportModalProps) {
  const { state } = useVideoEditor();
  const { toast } = useToast();
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [format, setFormat] = useState<Format>("mp4");
  const [quality, setQuality] = useState<Quality>("high");
  const [fps, setFps] = useState(30);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<string>("");
  const [exportComplete, setExportComplete] = useState(false);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Cleanup polling on unmount - MUST be before any early returns
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  // Serialize editor state for backend processing
  const serializeEditData = () => {
    // Ensure generatedContentId and postIndex are valid numbers
    const generatedContentId = state.generatedContentId !== undefined && state.generatedContentId !== null
      ? Number(state.generatedContentId)
      : undefined;
    
    const postIndex = state.postIndex !== undefined && state.postIndex !== null
      ? Number(state.postIndex)
      : undefined;
    
    if (generatedContentId === undefined || isNaN(generatedContentId)) {
      throw new Error('generatedContentId must be a valid number');
    }
    
    if (postIndex === undefined || postIndex === null || isNaN(postIndex)) {
      throw new Error('postIndex must be a valid number');
    }
    
    return {
      generatedContentId,
      postIndex,
      originalVideoUrl: state.videoUrl,
      projectName: state.projectName,
      aspectRatio: state.aspectRatio,
      duration: state.duration,
      exportSettings: {
        resolution,
        format,
        quality,
        fps,
      },
      tracks: state.tracks.map(track => ({
        id: track.id,
        name: track.name,
        type: track.type,
        muted: track.muted,
        visible: track.visible,
        clips: track.clips.map(clip => ({
          id: clip.id,
          name: clip.name,
          type: clip.type,
          // Timing - IMPORTANT for Python processing
          startTime: clip.startTime,        // Position on timeline
          duration: clip.duration,          // Duration on timeline
          sourceStart: clip.sourceStart || 0,  // Where to start in source video
          sourceDuration: clip.sourceDuration, // Original source duration
          // Source
          src: clip.src || '',
          thumbnail: clip.thumbnail,
          // Transform & Position (for overlays) — always send object for overlay type so export uses same center formula as preview
          transform: clip.type === 'overlay'
            ? {
                x: clip.transform?.x ?? 0,
                y: clip.transform?.y ?? 0,
                scale: clip.transform?.scale ?? 1,
                rotation: clip.transform?.rotation ?? 0,
                opacity: clip.transform?.opacity ?? 1,
              }
            : clip.transform ? {
                x: clip.transform.x || 0,
                y: clip.transform.y || 0,
                scale: clip.transform.scale || 1,
                rotation: clip.transform.rotation || 0,
                opacity: clip.transform.opacity ?? 1,
              } : null,
          position: clip.position ? {
            x: clip.position.x || 50,
            y: clip.position.y || 50,
          } : null,
          // Overlay size: match preview (width % of frame; default 30 like PreviewPlayer)
          size: clip.size ? {
            width: clip.size.width ?? 30,
            height: clip.size.height,
          } : (clip.type === 'overlay' ? { width: 30, height: undefined } : null),
          // Audio settings
          volume: clip.volume ?? 100,
          fadeIn: clip.fadeIn || 0,
          fadeOut: clip.fadeOut || 0,
          muted: clip.muted || false,
          // Visual effects - for Python/FFmpeg processing
          filters: clip.filters ? {
            brightness: clip.filters.brightness || 100,
            contrast: clip.filters.contrast || 100,
            saturation: clip.filters.saturation || 100,
            hue: clip.filters.hue || 0,
            blur: clip.filters.blur || 0,
            sharpen: clip.filters.sharpen || 0,
            vignette: clip.filters.vignette || 0,
            noise: clip.filters.noise ?? 0,
            temperature: clip.filters.temperature ?? 0,
          } : null,
          filterPreset: clip.filterPreset,
          // Transitions
          transitionIn: clip.transitionIn || 'none',
          transitionOut: clip.transitionOut || 'none',
          transitionInDuration: clip.transitionInDuration || 0,
          transitionOutDuration: clip.transitionOutDuration || 0,
          // Speed (for video clips)
          speed: clip.speed || 1.0,
          // Text/Captions
          text: clip.text ? {
            content: clip.text.content,
            fontFamily: clip.text.fontFamily,
            fontSize: clip.text.fontSize,
            fontWeight: clip.text.fontWeight,
            color: clip.text.color,
            backgroundColor: clip.text.backgroundColor,
            textAlign: clip.text.textAlign,
            verticalAlign: clip.text.verticalAlign,
            shadow: clip.text.shadow,
            animation: clip.text.animation,
          } : null,
          // Overlay specific (rounded corners, white border - must match preview)
          blendMode: clip.blendMode || 'normal',
          flipHorizontal: clip.flipHorizontal || false,
          flipVertical: clip.flipVertical || false,
          cornerRadius: clip.cornerRadius ?? 0,
          borderWidth: clip.borderWidth ?? 0,
          borderColor: clip.borderColor || '#ffffff',
          // AI flags
          aiGenerated: clip.aiGenerated || false,
          aiModified: clip.aiModified || false,
          // Music/audio: trim to video clip end (export uses this so music ends when referenced video clip ends)
          ...(clip.type === 'music' || clip.type === 'audio' || clip.type === 'voiceover'
            ? {
                trimToClipEnd: clip.trimToClipEnd ?? false,
                trimToVideoClipId: clip.trimToVideoClipId ?? undefined,
              }
            : {}),
        })),
      })),
    };
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(5);
    setExportStatus("Preparing export...");
    setExportError(null);

    try {
      // Validate required fields before exporting
      if (!state.generatedContentId || state.generatedContentId === undefined || isNaN(state.generatedContentId)) {
        throw new Error('generatedContentId is required and must be a valid number');
      }
      
      if (state.postIndex === undefined || state.postIndex === null || isNaN(state.postIndex)) {
        throw new Error('postIndex is required and must be a valid number');
      }
      
      const editData = serializeEditData();
      
      // Ensure generatedContentId and postIndex are numbers (not undefined/null)
      if (editData.generatedContentId === undefined || editData.generatedContentId === null) {
        throw new Error('generatedContentId is missing from editor state');
      }
      
      if (editData.postIndex === undefined || editData.postIndex === null) {
        throw new Error('postIndex is missing from editor state');
      }
      
      // Validate all clips have source URLs (except captions which don't need src)
      const clipsWithoutSrc: string[] = [];
      editData.tracks.forEach(track => {
        track.clips.forEach(clip => {
          // Captions don't need src (they're generated from text)
          if (clip.type !== 'captions' && !clip.src) {
            clipsWithoutSrc.push(`${track.name} > ${clip.name || clip.id}`);
          }
        });
      });
      
      if (clipsWithoutSrc.length > 0) {
        throw new Error(
          `Cannot export: The following clips are missing source URLs:\n${clipsWithoutSrc.join('\n')}\n\nPlease ensure all video, audio, and overlay clips have valid source files.`
        );
      }
      
      // Send to backend for processing (backend will poll internally)
      setExportProgress(10);
      setExportStatus("Sending to server and processing...");
      
      const response = await videoEditsApi.exportVideo(editData);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to start export');
      }
      
      // Check if export completed immediately (backend polling completed)
      if (response.status === 'completed') {
        // Export completed during backend polling
        setExportProgress(100);
        setExportStatus("Export complete!");
        
        // Handle file download (blob response)
        if (response.blob && response.filename) {
          // Create download link and trigger download
          const url = window.URL.createObjectURL(response.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = response.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          
          setExportedVideoUrl(url); // Store blob URL for display
          console.log('✅ Video downloaded:', response.filename);
        } else if (response.videoUrl) {
          // Fallback: URL response (if download failed on backend)
          setExportedVideoUrl(response.videoUrl);
          onExportComplete?.(response.videoUrl);
        }
        
        setIsExporting(false);
        setExportComplete(true);
        accountApi.recordEditSaved().catch(() => {});
        toast({
          title: "Export Complete",
          description: "Your video has been exported and downloaded successfully!",
        });
        return;
      }
      
      // If still processing or timeout, fall back to frontend polling
      if (response.status === 'processing' || response.status === 'pending') {
        const jobId = String(response.jobId ?? response.editId ?? '');
        if (!jobId || jobId === 'undefined' || jobId === 'null') {
          throw new Error('No job ID returned from server');
        }
        setExportStatus("Processing video...");
        setExportProgress(50);
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusResponse = await videoEditsApi.getExportStatus(jobId);
            
            if (statusResponse.status === 'completed') {
              clearInterval(pollIntervalRef.current!);
              setExportProgress(100);
              setExportStatus("Export complete! Downloading...");
              
              // Download the video file
              try {
                const { blob, filename } = await videoEditsApi.downloadVideo(jobId);
                
                // Create download link and trigger download
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                
                setExportedVideoUrl(url); // Store blob URL for display
                console.log('✅ Video downloaded:', filename);
                
                setIsExporting(false);
                setExportComplete(true);
                accountApi.recordEditSaved().catch(() => {});
                toast({
                  title: "Export Complete",
                  description: "Your video has been exported and downloaded successfully!",
                });
              } catch (downloadError: any) {
                console.error('❌ Failed to download video:', downloadError);
                // Fallback to URL if download fails
                const videoUrl = statusResponse.videoUrl;
                if (videoUrl) {
                  setExportedVideoUrl(videoUrl);
                  onExportComplete?.(videoUrl);
                  accountApi.recordEditSaved().catch(() => {});
                  toast({
                    title: "Export Complete",
                    description: "Your video has been exported. Click the download button to get it.",
                  });
                } else {
                  setExportError('Export completed but video is not available. Please try refreshing.');
                  toast({
                    title: "Export Complete",
                    description: "Export completed but download failed. Please try again.",
                    variant: "destructive",
                  });
                }
                setIsExporting(false);
                setExportComplete(true);
              }
            } else if (statusResponse.status === 'failed') {
              clearInterval(pollIntervalRef.current!);
              throw new Error(statusResponse.error || 'Export failed');
            } else {
              // Update progress
              const progress = statusResponse.progress || 50;
              setExportProgress(Math.min(95, 50 + progress * 0.5));
              setExportStatus(statusResponse.message || "Processing video...");
            }
          } catch (pollError: any) {
            clearInterval(pollIntervalRef.current!);
            throw pollError;
          }
        }, 2000); // Poll every 2 seconds
      } else if (response.status === 'failed') {
        throw new Error(response.error || 'Export failed');
      } else {
        // Unknown status, treat as processing and poll
        const jobId = String(response.jobId ?? response.editId ?? '');
        if (jobId && jobId !== 'undefined' && jobId !== 'null') {
          setExportStatus("Processing video...");
          setExportProgress(50);
          pollIntervalRef.current = setInterval(async () => {
            try {
              const statusResponse = await videoEditsApi.getExportStatus(jobId);
              if (statusResponse.status === 'completed') {
                clearInterval(pollIntervalRef.current!);
                setExportProgress(100);
                setExportStatus("Export complete! Downloading...");
                
                // Download the video file
                try {
                  const { blob, filename } = await videoEditsApi.downloadVideo(jobId);
                  
                  // Create download link and trigger download
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = filename;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  
                  setExportedVideoUrl(url);
                  console.log('✅ Video downloaded:', filename);
                  
                  setIsExporting(false);
                  setExportComplete(true);
                  accountApi.recordEditSaved().catch(() => {});
                  toast({
                    title: "Export Complete",
                    description: "Your video has been exported and downloaded successfully!",
                  });
                } catch (downloadError: any) {
                  console.error('❌ Failed to download video:', downloadError);
                  // Fallback to URL
                  if (statusResponse.videoUrl) {
                    setExportedVideoUrl(statusResponse.videoUrl);
                    onExportComplete?.(statusResponse.videoUrl);
                    accountApi.recordEditSaved().catch(() => {});
                    toast({
                      title: "Export Complete",
                      description: "Your video has been exported. Click the download button to get it.",
                    });
                  }
                  setIsExporting(false);
                  setExportComplete(true);
                }
              } else if (statusResponse.status === 'failed') {
                clearInterval(pollIntervalRef.current!);
                throw new Error(statusResponse.error || 'Export failed');
              }
            } catch (pollError: any) {
              clearInterval(pollIntervalRef.current!);
              throw pollError;
            }
          }, 2000);
        }
      }
      
    } catch (error: any) {
      console.error('Export failed:', error);
      setExportError(error.message || 'Export failed');
      setIsExporting(false);
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export video. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    if (isExporting) return;
    setExportComplete(false);
    setExportProgress(0);
    onClose();
  };

  const estimatedSize = () => {
    const baseSize = state.duration * 2; // MB per second at medium quality
    const qualityMultiplier = { low: 0.5, medium: 1, high: 2, ultra: 4 }[quality];
    const resMultiplier = { "720p": 0.5, "1080p": 1, "2k": 2, "4k": 4 }[resolution];
    return Math.round(baseSize * qualityMultiplier * resMultiplier);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20 text-primary">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Export Video</h2>
              <p className="text-xs text-muted-foreground">{state.projectName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isExporting}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        {exportComplete ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Export Complete!</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Your video has been exported and downloaded automatically.
            </p>
            <button
              onClick={handleClose}
              className="px-6 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium hover:bg-secondary/80 transition-colors"
            >
              Close
            </button>
          </div>
        ) : isExporting ? (
          <div className="p-8">
            <div className="text-center mb-6">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Exporting...</h3>
              <p className="text-sm text-muted-foreground">
                {exportStatus || "Please wait while your video is being exported."}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{Math.round(exportProgress)}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
            {exportError && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {exportError}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Resolution */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Resolution</label>
              <div className="grid grid-cols-2 gap-2">
                {resolutions.map((res) => (
                  <button
                    key={res.value}
                    onClick={() => setResolution(res.value)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      resolution === res.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <p className="text-sm font-medium">{res.label}</p>
                    <p className="text-xs text-muted-foreground">{res.dimensions}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Format */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Format</label>
              <div className="flex gap-2">
                {formats.map((fmt) => (
                  <button
                    key={fmt.value}
                    onClick={() => setFormat(fmt.value)}
                    className={cn(
                      "flex-1 p-3 rounded-lg border text-center transition-all",
                      format === fmt.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <p className="text-sm font-medium">{fmt.label}</p>
                    <p className="text-xs text-muted-foreground">{fmt.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quality */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Quality</label>
              <div className="flex gap-2">
                {qualities.map((q) => (
                  <button
                    key={q.value}
                    onClick={() => setQuality(q.value)}
                    className={cn(
                      "flex-1 p-2 rounded-lg border text-center transition-all",
                      quality === q.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <p className="text-sm font-medium">{q.label}</p>
                    <p className="text-[10px] text-muted-foreground">{q.bitrate}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Rate */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-sm font-medium">Frame Rate</label>
                <span className="text-sm text-muted-foreground">{fps} fps</span>
              </div>
              <Slider
                value={[fps]}
                onValueChange={([v]) => setFps(v)}
                min={24}
                max={60}
                step={1}
              />
            </div>

            {/* Estimated Size */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Estimated file size</span>
              </div>
              <span className="text-sm font-medium">{estimatedSize()} MB</span>
            </div>
          </div>
        )}

        {/* Footer */}
        {!exportComplete && !isExporting && (
          <div className="px-6 py-4 border-t border-border flex justify-between">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
