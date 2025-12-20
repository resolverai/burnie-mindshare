"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2, ArrowLeft } from "lucide-react";
import dvybLogo from "@/assets/dvyb-logo.png";
import { uploadApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackProductShotUploadViewed } from "@/lib/mixpanel";

interface ProductShotUploadProps {
  onUpload: (file: File, s3Key: string, guestSessionId: string, presignedUrl: string) => void;
  onBack: () => void;
  isGenerating?: boolean;
}

export const ProductShotUpload = ({ onUpload, onBack, isGenerating = false }: ProductShotUploadProps) => {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const hasTrackedRef = useRef(false);
  const [guestSessionId, setGuestSessionId] = useState<string>(() => {
    // Get or create a guest session ID
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('dvyb_guest_session_id');
      if (stored) return stored;
      const newId = crypto.randomUUID();
      localStorage.setItem('dvyb_guest_session_id', newId);
      return newId;
    }
    return crypto.randomUUID();
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track page view on mount
  useEffect(() => {
    if (!hasTrackedRef.current) {
      hasTrackedRef.current = true;
      trackProductShotUploadViewed();
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileSelect(file);
    }
  };

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    
    // Upload to S3 immediately
    setIsUploading(true);
    try {
      const response = await uploadApi.uploadGuestImage(file, guestSessionId);
      setS3Key(response.data.s3_key);
      setPresignedUrl(response.data.presigned_url);
      setGuestSessionId(response.data.guest_session_id);
      // Store session ID for future uploads
      localStorage.setItem('dvyb_guest_session_id', response.data.guest_session_id);
      console.log('✅ Guest upload successful:', response.data.s3_key, 'presigned:', response.data.presigned_url);
    } catch (error: any) {
      console.error('❌ Guest upload failed:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload image. Please try again.",
        variant: "destructive",
      });
      // Reset state on failure
      setUploadedFile(null);
      setPreviewUrl(null);
      URL.revokeObjectURL(url);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRemoveFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setUploadedFile(null);
    setPreviewUrl(null);
    setS3Key(null);
    setPresignedUrl(null);
  };

  const handleGenerate = () => {
    if (uploadedFile && s3Key && presignedUrl) {
      onUpload(uploadedFile, s3Key, guestSessionId, presignedUrl);
    }
  };

  return (
    <div 
      className="min-h-screen flex flex-col"
      style={{
        backgroundImage: "url(/onboarding-bg.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* Header */}
      <header className="relative z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-white/20 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </button>
            <div className="w-24 h-16 md:w-32 md:h-20 flex items-center">
              <Image src={dvybLogo} alt="Dvyb" className="w-full h-auto" priority />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl space-y-8">
          {/* Title */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground">
              Upload your product
            </h1>
            <p className="text-foreground/60 text-lg">
              We'll create stunning product shots in multiple styles
            </p>
          </div>

          {/* Upload Zone - Flow 1 style */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploadedFile && fileInputRef.current?.click()}
            className={`
              relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer
              backdrop-blur-xl
              ${isDragging
                ? "border-primary bg-primary/10 scale-[1.02]"
                : uploadedFile
                  ? "border-teal/50 bg-white/20"
                  : "border-white/40 bg-white/20 hover:border-primary/50 hover:bg-white/30"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInputChange}
              className="hidden"
            />

            {previewUrl ? (
              <div className="relative p-8">
                <div className="relative mx-auto w-fit">
                  <img
                    src={previewUrl}
                    alt="Product preview"
                    className="max-h-[300px] max-w-full rounded-xl object-contain shadow-xl"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(); }}
                    className="absolute -top-3 -right-3 p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-center text-foreground/60 mt-4 text-sm">{uploadedFile?.name}</p>
              </div>
            ) : (
              <div className="p-12 md:p-16 text-center space-y-6">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-teal/20 flex items-center justify-center border border-white/30 backdrop-blur-sm">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-medium text-foreground">Drop your product image here</p>
                  <p className="text-foreground/50 mt-2">or click to browse • PNG, JPG, WEBP</p>
                </div>
                <div className="flex items-center justify-center gap-2 text-foreground/40 text-sm">
                  <div className="w-1 h-1 rounded-full bg-foreground/30" />
                  <span>Any background works</span>
                  <div className="w-1 h-1 rounded-full bg-foreground/30" />
                  <span>AI will handle the rest</span>
                </div>
              </div>
            )}
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={!s3Key || isGenerating || isUploading}
            size="lg"
            className={`w-full btn-gradient-cta py-6 text-lg rounded-xl font-semibold ${
              !s3Key ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Uploading image...
              </>
            ) : isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating product shots...
              </>
            ) : (
              "Generate Product Shots"
            )}
          </Button>

          {/* Info text */}
          <p className="text-center text-foreground/40 text-sm">
            We'll generate 4 unique product shot variations
          </p>
        </div>
      </div>
    </div>
  );
};

