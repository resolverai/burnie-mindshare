"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ImageIcon, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const COPY_A_BG_DARK =
  "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

interface CopyAWebsiteInputScreenProps {
  onContinue: (data: { url?: string; file?: File }) => void;
  onSkip?: () => void;
  isDarkTheme?: boolean;
  isUploading?: boolean;
}

export function CopyAWebsiteInputScreen({ onContinue, onSkip, isDarkTheme = true, isUploading = false }: CopyAWebsiteInputScreenProps) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canContinue = url.trim().length > 0 || file !== null;

  const handleContinue = () => {
    if (canContinue) onContinue({ url: url || undefined, file: file || undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleContinue();
    }
  };

  const processFile = useCallback(
    (f: File) => {
      if (!ALLOWED_IMAGE_TYPES.includes(f.type)) {
        toast({ title: "Invalid file", description: "Please use JPEG, PNG, or WebP image", variant: "destructive" });
        return;
      }
      setFile(f);
    },
    [toast]
  );

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-12"
      style={{ background: isDarkTheme ? COPY_A_BG_DARK : "var(--gradient-hero)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-4xl"
        onKeyDown={handleKeyDown}
      >
        <h1 className="text-3xl md:text-5xl font-display font-medium tracking-tight text-foreground mb-3 text-center">
          Get started
        </h1>
        <p className="text-muted-foreground text-sm md:text-base mb-10 text-center">
          Enter your website, upload a product photo, or both
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-0 mb-8 items-stretch">
          <div className={`rounded-2xl backdrop-blur-md p-6 md:p-8 flex flex-col ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-card"}`}>
            <h2 className="text-lg font-display font-medium text-foreground mb-1">Website URL</h2>
            <p className="text-muted-foreground text-xs mb-5">We&apos;ll analyze your brand and generate your Business DNA</p>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="www.example.com"
              className={`w-full rounded-xl px-5 py-4 text-foreground placeholder:text-muted-foreground/50 focus:outline-none transition-colors ${isDarkTheme ? "bg-white/5 border border-white/10 focus:border-white/20" : "bg-secondary border border-input focus:border-ring"}`}
            />
          </div>

          <div className="flex md:flex-col items-center justify-center gap-3 px-6 py-2">
            <div className={`flex-1 w-full md:w-px md:h-full ${isDarkTheme ? "bg-white/10" : "bg-border"}`} />
            <span className="text-muted-foreground text-xs font-display uppercase tracking-widest">or</span>
            <div className={`flex-1 w-full md:w-px md:h-full ${isDarkTheme ? "bg-white/10" : "bg-border"}`} />
          </div>

          <div className={`rounded-2xl backdrop-blur-md p-6 md:p-8 flex flex-col ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-card"}`}>
            <h2 className="text-lg font-display font-medium text-foreground mb-1">Product Photo</h2>
            <p className="text-muted-foreground text-xs mb-5">We&apos;ll use your image to generate creatives</p>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            />

            {file ? (
              <div
                onClick={() => fileRef.current?.click()}
                className={`relative flex items-center gap-4 rounded-xl p-4 cursor-pointer transition-colors ${isDarkTheme ? "bg-white/5 border border-white/10 hover:border-white/20" : "bg-secondary border border-input hover:border-border"}`}
              >
                <div className={`relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 ${isDarkTheme ? "bg-white/5" : "bg-muted"}`}>
                  <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-cta flex items-center justify-center">
                    <Check className="w-3 h-3 text-cta-foreground" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-sm font-medium truncate">{file.name}</p>
                  <p className="text-muted-foreground text-xs">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex-1 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-4 transition-colors cursor-pointer ${isDraggingOver ? "border-cta bg-cta/10" : isDarkTheme ? "border-white/15 bg-white/5 hover:border-white/25" : "border-border bg-muted/50 hover:border-input"}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDarkTheme ? "bg-white/10" : "bg-muted"}`}>
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </div>
                <span className="text-muted-foreground text-xs">Click to upload or drag and drop</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue || isUploading}
              className="px-12 py-4 rounded-full text-lg font-display font-semibold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed bg-cta text-cta-foreground hover:scale-105"
              style={{ boxShadow: canContinue && !isUploading ? "0 0 30px -5px hsl(25 100% 55% / 0.5)" : "none" }}
            >
              {isUploading ? "Uploading…" : "Continue"}
            </button>
          </div>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              No I will skip
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
