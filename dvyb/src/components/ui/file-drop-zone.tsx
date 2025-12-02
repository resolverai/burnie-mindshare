"use client";

import { useCallback, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => Promise<string[]>;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  currentFiles?: string[];
  onRemove?: (url: string) => void;
  className?: string;
  preview?: boolean;
  uploadType?: 'logo' | 'images';
}

export function FileDropZone({
  onFilesSelected,
  accept = "image/*",
  multiple = false,
  maxFiles = 1,
  currentFiles = [],
  onRemove,
  className = "",
  preview = true,
  uploadType = 'images',
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateFiles = (files: File[]): File[] => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const blockedTypes = ['image/gif'];
    
    const validFiles = files.filter(file => {
      // Block GIF files explicitly
      if (blockedTypes.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: `${file.name} is a GIF file. GIF files are not supported. Please use PNG, JPG, JPEG, or WEBP.`,
          variant: "destructive",
        });
        return false;
      }
      
      // Check if file type is allowed
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: `${file.name} is not a supported image format. Only PNG, JPG, JPEG, and WEBP are allowed.`,
          variant: "destructive",
        });
        return false;
      }
      
      // Check file size
      if (file.size > 10 * 1024 * 1024) { // 10MB
        toast({
          title: "File too large",
          description: `${file.name} exceeds the 10MB size limit.`,
          variant: "destructive",
        });
        return false;
      }
      
      return true;
    });

    return validFiles;
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const validFiles = validateFiles(files);

      if (validFiles.length === 0) return;

      // Check if we've exceeded maxFiles
      if (currentFiles.length + validFiles.length > maxFiles) {
        toast({
          title: "Too many files",
          description: `You can upload a maximum of ${maxFiles} file(s).`,
          variant: "destructive",
        });
        return;
      }

      setIsUploading(true);
      try {
        await onFilesSelected(validFiles);
        toast({
          title: "Upload successful",
          description: `${validFiles.length} file(s) uploaded successfully.`,
        });
      } catch (error: any) {
        toast({
          title: "Upload failed",
          description: error.message || "Failed to upload files. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [onFilesSelected, currentFiles.length, maxFiles, toast]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const validFiles = validateFiles(files);

      if (validFiles.length === 0) return;

      if (currentFiles.length + validFiles.length > maxFiles) {
        toast({
          title: "Too many files",
          description: `You can upload a maximum of ${maxFiles} file(s).`,
          variant: "destructive",
        });
        return;
      }

      setIsUploading(true);
      try {
        await onFilesSelected(validFiles);
        toast({
          title: "Upload successful",
          description: `${validFiles.length} file(s) uploaded successfully.`,
        });
      } catch (error: any) {
        toast({
          title: "Upload failed",
          description: error.message || "Failed to upload files. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
      }

      // Reset input
      e.target.value = '';
    },
    [onFilesSelected, currentFiles.length, maxFiles, toast]
  );

  // For logo type, show preview in the same box
  if (uploadType === 'logo') {
    return (
      <div className={className}>
        <div
          className={`relative border-2 border-dashed rounded-lg transition-colors ${
            isDragging
              ? 'border-primary bg-primary/10'
              : 'border-border hover:border-primary/50'
          } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleFileSelect}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            disabled={isUploading}
          />

          <div className="flex items-center justify-center p-8 min-h-[200px]">
            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </div>
            ) : currentFiles.length > 0 ? (
              <div className="relative inline-block group">
                <Image
                  src={currentFiles[0]}
                  alt="Logo"
                  width={150}
                  height={150}
                  className="object-contain max-h-[150px]"
                  unoptimized
                />
                {onRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(currentFiles[0]);
                    }}
                    className="absolute top-1 right-1 md:top-2 md:right-2 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors z-20"
                  >
                    <X className="w-3 h-3 md:w-4 md:h-4" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <Upload className="w-10 h-10 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Drop your logo here</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or click to browse (PNG, JPG, WEBP)
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // For images type, show grid of previews
  return (
    <div className={className}>
      <div
        className={`border-2 border-dashed rounded-lg p-4 md:p-6 transition-colors ${
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-border hover:border-primary/50'
        } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
          disabled={isUploading}
        />

        {currentFiles.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
            {currentFiles.map((url, index) => (
              <div key={index} className="relative group">
                <Image
                  src={url}
                  alt={`Brand image ${index + 1}`}
                  width={150}
                  height={150}
                  className="w-full h-24 sm:h-28 md:h-32 object-cover rounded-lg"
                  unoptimized
                />
                {onRemove && (
                  <button
                    onClick={() => onRemove(url)}
                    className="absolute top-1 right-1 md:top-2 md:right-2 p-1 bg-destructive text-destructive-foreground rounded-full opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 md:w-4 md:h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-center">
          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Uploading images...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4">
              <Upload className="w-10 h-10 text-muted-foreground" />
              <div>
                <p className="text-sm md:text-base text-muted-foreground mb-3 md:mb-4">
                  Drop your brand inspiration images here or click to browse
                </p>
                <label
                  htmlFor="file-upload"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md cursor-pointer transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Add Media
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, JPEG, WEBP (max 10MB each)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

