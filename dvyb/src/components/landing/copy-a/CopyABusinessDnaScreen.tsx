"use client";

import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Link as LinkIcon, Upload, Pencil, Check, Loader2, X } from "lucide-react";
import { contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const Card = ({
  children,
  className = "",
  isDarkTheme = true,
}: {
  children: React.ReactNode;
  className?: string;
  isDarkTheme?: boolean;
}) => (
  <div
    className={`rounded-2xl p-5 md:p-6 ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-card"} ${className}`}
  >
    {children}
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-display font-medium text-foreground mb-3">{children}</h3>
);

const FONT_OPTIONS = ["Arial", "Inter", "Roboto", "Open Sans", "Poppins", "Playfair Display", "Georgia", "Helvetica"];
const ALLOWED_PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

interface AnalysisData {
  base_name?: string;
  industry?: string;
  business_overview_and_positioning?: string;
  color_palette?: { primary?: string; secondary?: string; accent?: string } | string[];
  most_popular_products_and_services?: string | string[];
  why_customers_choose?: string;
  brand_story?: string;
  customer_demographics_and_psychographics?: string;
  tagline?: string;
}

interface CopyABusinessDnaScreenProps {
  url: string;
  analysisData: AnalysisData | null;
  websiteSnapshotUrl: string | null;
  domainProducts: Array<{ id: number; s3Key: string; image: string }>;
  onProductSelect: (product: { id: number; s3Key: string; image: string }) => void;
  selectedProduct: { id: number; s3Key: string; image: string } | null;
  onProductUpload: (file: File) => void;
  isProductUploading: boolean;
  editedColors: string[];
  onColorsChange: (colors: string[]) => void;
  editedFont: string;
  onFontChange: (font: string) => void;
  onContinue: () => void;
  isDarkTheme?: boolean;
}

const COPY_A_BG_DARK =
  "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

function colorsFromAnalysis(data: AnalysisData | null): string[] {
  if (!data?.color_palette) return ["#faf9f7", "#8a5334", "#97abb1", "#1a491d", "#212121"];
  const cp = data.color_palette;
  if (Array.isArray(cp)) return cp.filter((c): c is string => typeof c === "string" && c.startsWith("#"));
  const arr: string[] = [];
  if (cp.primary) arr.push(cp.primary);
  if (cp.secondary) arr.push(cp.secondary);
  if (cp.accent) arr.push(cp.accent);
  if (arr.length === 0) return ["#faf9f7", "#8a5334", "#97abb1", "#1a491d", "#212121"];
  return arr;
}

export function CopyABusinessDnaScreen({
  url,
  analysisData,
  websiteSnapshotUrl,
  domainProducts,
  onProductSelect,
  selectedProduct,
  onProductUpload,
  isProductUploading,
  editedColors,
  onColorsChange,
  editedFont,
  onFontChange,
  onContinue,
  isDarkTheme = true,
}: CopyABusinessDnaScreenProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [isProductDraggingOver, setIsProductDraggingOver] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<{ id: number; s3Key: string; image: string } | null>(null);
  const displayUrl = url.startsWith("http") ? url : `https://${url}`;

  const processProductFile = (file: File) => {
    if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
      toast({ title: "Invalid file", description: "Please upload JPEG, PNG, or WebP image", variant: "destructive" });
      return;
    }
    onProductUpload(file);
  };

  const handleProductDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(true);
  };

  const handleProductDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsProductDraggingOver(false);
  };

  const handleProductDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processProductFile(file);
  };
  const baseName = analysisData?.base_name || "Your Brand";
  const tagline = analysisData?.tagline || "";
  const brandValues = analysisData?.industry ? [analysisData.industry] : ["Quality", "Innovation"];
  const overview = analysisData?.business_overview_and_positioning || analysisData?.brand_story || "A modern brand focused on delivering quality.";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processProductFile(f);
    e.target.value = "";
  };

  const colors = editedColors.length > 0 ? editedColors : colorsFromAnalysis(analysisData);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="min-h-screen flex flex-col items-center overflow-y-auto overflow-x-hidden px-4 md:px-6 pt-24 pb-6 lg:h-screen lg:overflow-hidden"
      style={{ background: isDarkTheme ? COPY_A_BG_DARK : "var(--gradient-hero)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-center mb-8 shrink-0"
      >
        <h1 className="text-3xl md:text-5xl font-display font-medium tracking-tight text-foreground mb-3">
          Your Business DNA
        </h1>
        <p className="text-muted-foreground text-sm md:text-base max-w-lg mx-auto">
          Here is a snapshot of your business that we&apos;ll use to create campaigns.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full max-w-6xl mx-auto rounded-3xl rounded-b-none border-b-0 backdrop-blur-sm p-4 md:p-6 flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden ${isDarkTheme ? "border border-white/10 bg-white/[0.03]" : "border border-border bg-card/80"}`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 md:gap-5 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
          <div className="flex flex-col gap-4 lg:overflow-y-auto lg:min-h-0 pr-0 lg:pr-2" style={{ scrollbarWidth: "thin", scrollbarColor: "hsl(0 0% 30%) transparent" }}>
            <Card isDarkTheme={isDarkTheme}>
              <h2 className="text-2xl font-display font-medium text-foreground mb-2">{baseName}</h2>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <LinkIcon className="w-4 h-4" />
                {displayUrl}
              </div>
            </Card>

            {websiteSnapshotUrl && (
              <Card isDarkTheme={isDarkTheme}>
                <SectionTitle>Website snapshot</SectionTitle>
                <div className={`rounded-xl overflow-hidden aspect-video ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-muted"}`}>
                  <img src={websiteSnapshotUrl} alt="Website snapshot" className="w-full h-full object-cover" />
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
              <Card className="flex items-center justify-center w-full sm:w-32 h-28" isDarkTheme={isDarkTheme}>
                <span className="text-xl font-display font-bold text-foreground">{baseName}</span>
              </Card>
              <Card className="flex flex-col justify-center" isDarkTheme={isDarkTheme}>
                <div className="flex items-center justify-between mb-2">
                  <SectionTitle>Fonts</SectionTitle>
                  <select
                    value={editedFont}
                    disabled
                    title="Font is auto-detected from your website"
                    className={`text-xs bg-transparent rounded px-2 py-1 text-foreground cursor-not-allowed opacity-80 ${isDarkTheme ? "border border-white/15" : "border border-input"}`}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <p className="text-3xl font-display text-cta">Aa</p>
                <p className="text-xs text-muted-foreground mt-1">{editedFont}</p>
              </Card>
            </div>

            <Card isDarkTheme={isDarkTheme}>
              <SectionTitle>Colors</SectionTitle>
              <div className="flex gap-4 flex-wrap">
                {colors.map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <div
                      className="w-12 h-12 rounded-full border border-white/10 cursor-pointer hover:ring-2 hover:ring-cta/50 transition-all"
                      style={{ backgroundColor: c }}
                      title="Click to edit"
                    />
                    <input
                      type="text"
                      value={c}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = [...colors];
                        if (/^#[0-9A-Fa-f]{3,6}$/.test(v) || v === "#") {
                          next[i] = v === "#" ? c : v;
                          onColorsChange(next);
                        }
                      }}
                      className={`w-14 text-center text-[10px] text-muted-foreground bg-transparent border-0 border-b focus:outline-none focus:border-cta/50 ${isDarkTheme ? "border-white/20" : "border-input"}`}
                    />
                  </div>
                ))}
              </div>
            </Card>

            <Card isDarkTheme={isDarkTheme}>
              <SectionTitle>Tagline</SectionTitle>
              <p className={`text-base font-display font-medium ${tagline ? "text-cta" : "text-muted-foreground italic"}`}>
                {tagline || "No tagline detected"}
              </p>
            </Card>

            <Card isDarkTheme={isDarkTheme}>
              <SectionTitle>Business overview</SectionTitle>
              <div className="text-sm text-muted-foreground leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-foreground">
                <ReactMarkdown>{overview}</ReactMarkdown>
              </div>
            </Card>
          </div>

          <div className="flex flex-col lg:overflow-y-auto lg:min-h-0 pl-0 lg:pl-2" style={{ scrollbarWidth: "thin", scrollbarColor: "hsl(0 0% 30%) transparent" }}>
            <Card className="flex-1" isDarkTheme={isDarkTheme}>
              <SectionTitle>Images</SectionTitle>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => !isProductUploading && fileRef.current?.click()}
                  onDragOver={handleProductDragOver}
                  onDragLeave={handleProductDragLeave}
                  onDrop={handleProductDrop}
                  disabled={isProductUploading}
                  className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50 ${isProductDraggingOver ? "border-cta bg-cta/20" : isDarkTheme ? "border-white/15 bg-cta/10 hover:border-cta/40" : "border-border bg-cta/10 hover:border-cta/50"}`}
                >
                  {isProductUploading ? (
                    <Loader2 className="w-5 h-5 text-cta animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-cta" />
                      <span className="text-[10px] text-cta font-display font-medium">Upload Images</span>
                      <span className="text-[9px] text-muted-foreground">or drag and drop</span>
                    </>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

                {domainProducts.map((product) => {
                  const isSelected = selectedProduct?.id === product.id;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => setPreviewProduct(product)}
                      className={`aspect-square rounded-xl overflow-hidden border-2 transition-all relative ${
                        isSelected
                          ? "border-cta ring-2 ring-cta/30"
                          : isDarkTheme
                            ? "bg-white/5 border-white/10 hover:border-white/20"
                            : "bg-muted border-border hover:border-input"
                      }`}
                    >
                      <img src={product.image} alt="Product" className="w-full h-full object-cover" />
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-cta flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-cta-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className={`w-full max-w-6xl mx-auto rounded-b-3xl border-t-0 backdrop-blur-sm px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 ${isDarkTheme ? "border border-white/10 bg-white/10" : "border border-border border-t-0 bg-secondary"}`}
      >
        <p className="text-muted-foreground text-sm">
          Next we&apos;ll use your Business DNA to generate social media campaigns
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="px-10 py-3.5 rounded-full text-base font-display font-semibold bg-cta text-cta-foreground hover:scale-105 transition-all duration-300 flex-shrink-0"
          style={{ boxShadow: "0 0 30px -5px hsl(25 100% 55% / 0.5)" }}
        >
          Looks good
        </button>
      </motion.div>

      {/* Product preview modal - opens on product click, "Use this Image" to select */}
      {previewProduct && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-black/80 animate-in fade-in-0"
            onClick={() => setPreviewProduct(null)}
            aria-hidden
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
            <div
              className="relative w-full max-w-md bg-black rounded-lg overflow-hidden shadow-2xl animate-in zoom-in-95 fade-in-0 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewProduct(null)}
                className="absolute top-4 right-4 z-20 bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              <div className="w-full aspect-[4/5]">
                <img
                  src={previewProduct.image}
                  alt="Product"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    onProductSelect(previewProduct);
                    setPreviewProduct(null);
                  }}
                  className="px-8 py-3 rounded-full text-base font-display font-semibold bg-cta text-cta-foreground hover:scale-105 transition-all"
                  style={{ boxShadow: "0 0 20px -3px hsl(25 100% 55% / 0.4)" }}
                >
                  Use this Image
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
