"use client";

import { useState, useRef, useCallback } from "react";
import { X, Upload, FileAudio, Check, Loader2, Music, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { assetsApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: () => Promise<void>;
}

interface FilePreview {
  file: File;
  preview: string;
  type: "video" | "image" | "audio" | "music" | "voiceover";
  duration?: number;
  uploading: boolean;
  uploaded: boolean;
  progress?: number; // 0–100
}

export function UploadModal({ isOpen, onClose, onUploadSuccess }: UploadModalProps) {
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Auto-detect file type; Dvyb categorization (music vs audio) applied in processFile
  const getFileType = (file: File): "video" | "image" | "audio" | null => {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    return null;
  };

  const processFile = async (file: File): Promise<FilePreview | null> => {
    const rawType = getFileType(file);
    if (!rawType) return null;

    const preview = URL.createObjectURL(file);
    let duration: number | undefined;

    if (rawType === "video" || rawType === "audio") {
      duration = await new Promise<number>((resolve) => {
        const media = document.createElement(rawType === "video" ? "video" : "audio");
        media.src = preview;
        media.onloadedmetadata = () => resolve(media.duration);
        media.onerror = () => resolve(10);
      });
    }
    // Dvyb auto-categorize: audio >= 60s → music, else → audio
    const type = rawType === "audio" && duration != null && duration >= 60 ? "music" : rawType;

    return {
      file,
      preview,
      type: type as FilePreview["type"],
      duration,
      uploading: false,
      uploaded: false,
    };
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;

    const newFiles: FilePreview[] = [];
    for (const file of Array.from(fileList)) {
      const processed = await processFile(file);
      if (processed) {
        newFiles.push(processed);
      }
    }
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    await handleFiles(e.dataTransfer.files);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const setAudioCategory = (index: number, category: "music" | "audio") => {
    setFiles((prev) => {
      const next = [...prev];
      if (next[index] && (next[index].type === "audio" || next[index].type === "music")) {
        next[index] = { ...next[index], type: category };
      }
      return next;
    });
  };

  const uploadFile = async (filePreview: FilePreview, index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      newFiles[index] = { ...newFiles[index], uploading: true, progress: 0 };
      return newFiles;
    });

    const name = filePreview.file.name.replace(/\.[^/.]+$/, "") || filePreview.file.name;
    try {
      const createRes = await assetsApi.uploadAsset({
        name,
        type: filePreview.type,
        tags: [filePreview.type],
      });
      if (!createRes.success || !createRes.asset?.id) {
        throw new Error(createRes.error || "Failed to create upload");
      }
      const assetId = createRes.asset.id;

      const uploadRes = await assetsApi.uploadAssetFile(
        assetId,
        filePreview.file,
        (percent) => {
          setFiles((prev) => {
            const n = [...prev];
            if (n[index]) n[index] = { ...n[index], progress: percent };
            return n;
          });
        }
      );
      if (!uploadRes.success) {
        throw new Error(uploadRes.error || "Upload to storage failed");
      }

      await assetsApi.updateAsset(assetId, {
        duration: filePreview.duration ?? undefined,
        metadata: filePreview.duration != null ? { duration: filePreview.duration } : undefined,
      });

      await onUploadSuccess?.();
      setFiles((prev) => {
        const newFiles = [...prev];
        newFiles[index] = { ...newFiles[index], uploading: false, uploaded: true, progress: 100 };
        return newFiles;
      });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Could not upload. Try again.",
        variant: "destructive",
      });
      setFiles((prev) => {
        const newFiles = [...prev];
        newFiles[index] = { ...newFiles[index], uploading: false, progress: undefined };
        return newFiles;
      });
    }
  };

  const uploadAll = async () => {
    for (let i = 0; i < files.length; i++) {
      if (!files[i].uploaded) {
        await uploadFile(files[i], i);
      }
    }
  };

  const handleClose = () => {
    // Clean up previews
    files.forEach((f) => {
      if (!f.uploaded) {
        URL.revokeObjectURL(f.preview);
      }
    });
    setFiles([]);
    onClose();
  };

  if (!isOpen) return null;

  const pendingFiles = files.filter((f) => !f.uploaded);
  const uploadedFiles = files.filter((f) => f.uploaded);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Upload Media</h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-all",
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium mb-1">
              Drag & drop files here, or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-primary hover:underline"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-muted-foreground">
              Supports video, audio, and image files
            </p>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} ready to upload
                </span>
                {pendingFiles.length > 0 && (
                  <button
                    onClick={uploadAll}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Upload All
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border",
                      file.uploaded ? "border-green-500/30 bg-green-500/10" : "border-border bg-secondary/30"
                    )}
                  >
                    {/* Preview */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0">
                      {file.type === "video" || file.type === "image" ? (
                        <img
                          src={file.preview}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileAudio className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span className="capitalize">{file.type}</span>
                        {file.duration && (
                          <span>• {Math.round(file.duration)}s</span>
                        )}
                        <span>• {(file.file.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                      {(file.type === "audio" || file.type === "music") && !file.uploaded && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-muted-foreground">Add as:</span>
                          <div className="flex rounded-md overflow-hidden border border-border/60">
                            <button
                              type="button"
                              onClick={() => setAudioCategory(index, "music")}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
                                file.type === "music"
                                  ? "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Music className="h-3 w-3" />
                              Music
                            </button>
                            <button
                              type="button"
                              onClick={() => setAudioCategory(index, "audio")}
                              className={cn(
                                "flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
                                file.type === "audio"
                                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                              )}
                            >
                              <Volume2 className="h-3 w-3" />
                              Sound effect
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions + progress */}
                    {file.uploading ? (
                      <div className="flex flex-col items-end gap-1 min-w-[80px]">
                        <span className="text-[10px] text-muted-foreground">
                          {file.progress != null ? `${file.progress}%` : "…"}
                        </span>
                        <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-200"
                            style={{ width: `${file.progress ?? 0}%` }}
                          />
                        </div>
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </div>
                    ) : file.uploaded ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => uploadFile(file, index)}
                          className="p-2 rounded-lg hover:bg-primary/20 text-primary transition-colors"
                        >
                          <Upload className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeFile(index)}
                          className="p-2 rounded-lg hover:bg-destructive/20 text-destructive transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
