"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Search, Upload, Link as LinkIcon, FileText, Check, ArrowRight, Instagram, Video } from "lucide-react";
import { inspirationsApi, InspirationItem } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackInspirationPageViewed, trackInspirationSelected } from "@/lib/mixpanel";

function getEmbedOrImageUrl(item: InspirationItem): string | null {
  if (item.platform === "custom" && item.mediaUrl) return item.mediaUrl;
  return null;
}

const platformColors: Record<string, string> = {
  instagram: "bg-[hsl(var(--landing-accent-orange))]",
  facebook: "bg-blue-600",
  tiktok: "bg-black",
  youtube: "bg-red-600",
  twitter: "bg-black",
};

function PlatformBadge({ platform }: { platform: string }) {
  const color = platformColors[platform] || "bg-neutral-600";
  const Icon = platform === "instagram" ? Instagram : platform === "tiktok" || platform === "youtube" ? Video : null;
  return (
    <div className={`${color} text-white px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium capitalize`}>
      {Icon && <Icon className="w-3 h-3" />}
      {platform}
    </div>
  );
}

interface CustomizeAdModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, Next opens product selection modal instead of going to login. */
  onNextToProducts?: () => void;
}

export function CustomizeAdModal({ open, onOpenChange, onNextToProducts }: CustomizeAdModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inspirationItems, setInspirationItems] = useState<InspirationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [inspirationLink, setInspirationLink] = useState("");
  const [instructions, setInstructions] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    hasFetchedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      if (hasFetchedRef.current) return;
      hasFetchedRef.current = true;
      setIsLoading(true);
      try {
        const analysisStr = localStorage.getItem("dvyb_website_analysis");
        if (!analysisStr) {
          toast({
            title: "No analysis found",
            description: "Please analyze your website first",
            variant: "destructive",
          });
          onOpenChange(false);
          return;
        }
        const analysis = JSON.parse(analysisStr);
        const industry = analysis.industry || "General";
        const response = await inspirationsApi.matchInspirations(industry, 8);
        if (response.success && response.data?.inspiration_videos) {
          setInspirationItems(response.data.inspiration_videos);
          trackInspirationPageViewed({ industry, inspirationCount: response.data.inspiration_videos.length });
        }
      } catch (e) {
        console.error("Failed to load inspirations:", e);
        toast({
          title: "Error",
          description: "Failed to load inspirations",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [open, toast, onOpenChange]);

  const filteredItems = searchQuery.trim()
    ? inspirationItems.filter(
        (item) =>
          (item.title?.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (item.category?.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (item.platform?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : inspirationItems;

  const handleToggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setUploadedFile(file);
  };

  const handleNext = () => {
    const selected = inspirationItems.filter((item) => selectedIds.has(item.id));
    if (selected.length > 0) {
      selected.forEach((item) =>
        trackInspirationSelected({
          inspirationId: item.id,
          platform: item.platform,
          category: item.category,
        })
      );
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify(selected));
    }
    if (instructions.trim()) {
      localStorage.setItem("dvyb_instructions", instructions.trim());
    }
    if (inspirationLink.trim()) {
      const existing = JSON.parse(localStorage.getItem("dvyb_inspiration_links") || "[]");
      if (!existing.includes(inspirationLink.trim())) {
        localStorage.setItem("dvyb_inspiration_links", JSON.stringify([...existing, inspirationLink.trim()]));
      }
    }
    if (onNextToProducts) {
      onNextToProducts();
      onOpenChange(false);
    } else {
      onOpenChange(false);
      router.push("/auth/login");
    }
  };

  const handleInteractOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-floating-bar]")) {
      e.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90vw] w-full max-h-[85vh] flex flex-col p-0 gap-0 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl overflow-hidden"
        onInteractOutside={handleInteractOutside}
      >
        <div className="px-6 py-6 border-b border-border shrink-0">
          <h2 className="text-2xl md:text-3xl font-bold mb-2 text-center text-neutral-900">
            Customize your ad creation
          </h2>
          <p className="text-muted-foreground text-center mb-6">
            Select competitor ads for inspiration
          </p>

          {/* Reference Inspiration + Instructions — hidden, code kept for future use */}
          <div className="max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 hidden">
            <div className="bg-neutral-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Reference Inspiration</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Upload an ad you like — we&apos;ll adapt the style, not copy it.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="w-full mb-3 gap-2"
              >
                <Upload className="w-4 h-4" />
                {uploadedFile ? uploadedFile.name : "Upload image or video"}
              </Button>
              <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-neutral-200">
                <LinkIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <input
                  type="url"
                  placeholder="Or paste a link..."
                  value={inspirationLink}
                  onChange={(e) => setInspirationLink(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground min-w-0"
                />
              </div>
            </div>
            <div className="bg-neutral-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Instructions</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Optional — you can skip this and edit later.
              </p>
              <Textarea
                placeholder="Example: 'Minimal, premium tone. Focus on comfort and quality. No flashy text.'"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[80px] resize-none bg-white text-sm border-neutral-200"
              />
            </div>
          </div>

          <div className="max-w-md mx-auto">
            <div className="flex items-center gap-3 bg-neutral-100 rounded-full px-5 py-3 border border-neutral-200">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search brands or keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm"
              />
            </div>
          </div>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto p-6 ${selectedIds.size > 0 ? "pb-24" : "pb-4"}`}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-muted-foreground">Loading inspirations...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No inspirations match your search.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredItems.map((item) => {
                const imgUrl = getEmbedOrImageUrl(item);
                const isSelected = selectedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleToggle(item.id)}
                    className={`text-left rounded-xl overflow-hidden cursor-pointer group transition-all ${
                      isSelected ? "ring-4 ring-neutral-900 ring-offset-2" : "hover:shadow-lg"
                    }`}
                  >
                    <div className="aspect-[4/5] relative bg-neutral-200">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={item.title || item.category || "Inspiration"}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-neutral-200 text-neutral-500">
                          <span className="text-xs font-medium capitalize">{item.platform}</span>
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <PlatformBadge platform={item.platform} />
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                        <p className="text-white text-xs font-medium truncate">
                          {item.title || item.category || item.platform}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      {/* Floating bar outside modal — fixed at viewport bottom, pulls up when items selected */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-floating-bar
            className={`fixed bottom-0 left-0 right-0 z-[300] flex justify-center px-[5vw] transition-transform duration-300 ease-out cursor-pointer ${
              selectedIds.size > 0 ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="w-full max-w-[90vw] mb-6 bg-neutral-900 text-white rounded-2xl px-6 py-4 flex items-center justify-between shadow-2xl pointer-events-auto cursor-pointer">
              <p className="font-medium">
                {selectedIds.size} ad{selectedIds.size !== 1 ? "s" : ""} selected
              </p>
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center justify-center gap-2 h-10 px-8 rounded-md text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
