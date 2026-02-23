"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Link as LinkIcon, Loader2 } from "lucide-react";

const stages = [
  "Scanning your website",
  "Studying your brand values",
  "Analyzing your products",
  "Extracting brand colors",
  "Understanding your audience",
  "Building your Business DNA",
];

const COPY_A_BG_DARK =
  "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

interface CopyAAnalyzingScreenProps {
  url: string;
  onDone: () => void;
  /** When true, analysis has completed; screen will call onDone after a short delay */
  analysisDone?: boolean;
  isDarkTheme?: boolean;
  /** Presigned URL for website screenshot – when available, shows snapshot instead of iframe */
  websiteSnapshotUrl?: string | null;
}

export function CopyAAnalyzingScreen({ url, onDone, analysisDone = false, isDarkTheme = true, websiteSnapshotUrl = null }: CopyAAnalyzingScreenProps) {
  const [stageIndex, setStageIndex] = useState(0);

  const displayUrl = url.startsWith("http") ? url : `https://${url}`;

  // Progress through stages on a timer
  useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((prev) => (prev >= stages.length - 1 ? prev : prev + 1));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // When analysis completes, show final stage and call onDone after delay
  useEffect(() => {
    if (!analysisDone) return;
    setStageIndex(stages.length - 1);
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [analysisDone, onDone]);

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
        className={`w-full max-w-2xl rounded-3xl backdrop-blur-md p-8 md:p-12 flex flex-col items-center ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-card"}`}
      >
        <h1 className="text-3xl md:text-5xl font-display font-medium tracking-tight text-foreground mb-3 text-center">
          Generating your Business DNA
        </h1>
        <p className="text-muted-foreground text-sm md:text-base mb-8 text-center max-w-md">
          We&apos;re researching and analyzing your business.
          <br />
          It will take only a few seconds.
        </p>

        <div className="mb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={stageIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-cta/90 text-cta-foreground text-sm font-display font-medium"
            >
              <Sparkles className="w-4 h-4" />
              {stages[stageIndex]}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className={`w-full rounded-2xl overflow-hidden mb-6 flex items-center justify-center ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-muted/50"}`} style={{ height: "380px" }}>
          {websiteSnapshotUrl ? (
            <img src={websiteSnapshotUrl} alt="Website preview" className="w-full h-full object-cover object-top" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-10 h-10 animate-spin" />
              <span className="text-sm">Capturing website snapshot...</span>
            </div>
          )}
        </div>

        <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-muted-foreground text-sm ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-secondary"}`}>
          <LinkIcon className="w-4 h-4" />
          {displayUrl}
        </div>
      </motion.div>
    </motion.div>
  );
}
