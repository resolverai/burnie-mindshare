"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Search, Check, ArrowRight, Plus, Upload, Link as LinkIcon, FileText, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { productsApi, brandsApi, adhocGenerationApi, contextApi } from "@/lib/api";
import { trackCreateAdFlowRelevantAdsFetched } from "@/lib/mixpanel";
import { useToast } from "@/hooks/use-toast";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";

type Step = "product" | "ad" | "generating";

interface Product {
  id: number;
  name: string;
  imageS3Key: string;
  imageUrl: string;
  createdAt: string;
}

interface DiscoverAd {
  id: number;
  image: string | null;
  videoSrc: string | null;
  isVideo: boolean;
  brandName: string;
  brandLetter: string;
  category: string | null;
  creativeImageUrl: string | null;
  creativeVideoUrl: string | null;
}

const ALLOWED_PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// Choose Product modal: dimensions for 3 columns grid with scroll
const productModalClass =
  "w-[min(90vw,560px)] h-[min(85vh,640px)] flex flex-col p-0 gap-0 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl overflow-hidden";

// Choose Ad modal: width matches floating bar (90vw)
const adModalClass =
  "w-[90vw] max-w-[90vw] h-[min(90vh,680px)] min-h-[min(90vh,680px)] flex flex-col p-0 gap-0 bg-[hsl(0,0%,98%)] border-neutral-200/80 text-neutral-900 rounded-2xl shadow-xl overflow-hidden";

export interface PreselectedInspiration {
  imageUrl: string | null;
  videoUrl: string | null;
  isVideo: boolean;
}

interface CreateAdFlowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAd?: () => void;
  /** When set, skip the inspiration/ad selection step and use this as inspiration after product selection */
  preselectedInspiration?: PreselectedInspiration | null;
  /** Called when user saves design edits - parent can refetch content library */
  onDesignSaved?: () => void;
}

export function CreateAdFlowModal({ open, onOpenChange, onCreateAd, preselectedInspiration, onDesignSaved }: CreateAdFlowModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("product");

  // Product step
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [isProductUploading, setIsProductUploading] = useState(false);
  const [isProductDraggingOver, setIsProductDraggingOver] = useState(false);
  const productFileInputRef = useRef<HTMLInputElement>(null);

  // Ad step
  const [discoverAds, setDiscoverAds] = useState<DiscoverAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [selectedAdIds, setSelectedAdIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [inspirationLink, setInspirationLink] = useState("");
  const [instructions, setInstructions] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedS3Url, setUploadedS3Url] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generating
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [initialJobId, setInitialJobId] = useState<string | null>(null);
  const [expectedImageCount, setExpectedImageCount] = useState(0);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await productsApi.list();
      if (res.success && res.data) {
        setProducts(res.data);
      }
    } catch (e) {
      console.error("Failed to fetch products:", e);
      toast({ title: "Error", description: "Failed to load products", variant: "destructive" });
    } finally {
      setProductsLoading(false);
    }
  }, [toast]);

  const fetchDiscoverAds = useCallback(async () => {
    setAdsLoading(true);
    try {
      let websiteCategory: string | undefined;
      let brandContext: { business_overview?: string | null; popular_products?: string[] | null; customer_demographics?: string | null; brand_story?: string | null } | undefined;
      let productImageS3Key: string | undefined;
      // Try backend context first (saved dvyb_context)
      try {
        const ctxRes = await contextApi.getContext();
        if (ctxRes.success && ctxRes.data) {
          const ctx = ctxRes.data;
          if (ctx.industry) websiteCategory = String(ctx.industry).trim() || undefined;
          const hasContext =
            ctx.businessOverview ||
            ctx.popularProducts ||
            ctx.customerDemographics ||
            ctx.brandStory;
          if (hasContext) {
            const pop = ctx.popularProducts;
            brandContext = {
              business_overview: ctx.businessOverview ?? null,
              popular_products: Array.isArray(pop) ? pop : typeof pop === "string" ? (pop ? [pop] : null) : null,
              customer_demographics: ctx.customerDemographics ?? null,
              brand_story: ctx.brandStory ?? null,
            };
          }
        }
      } catch {
        /* ignore */
      }
      // Fallback: use localStorage website analysis (same as unified onboarding modal)
      // Ensures relevant ads when user is mid-onboarding or context not yet synced to backend
      if (!websiteCategory || !brandContext) {
        try {
          const analysisStr = localStorage.getItem("dvyb_website_analysis");
          if (analysisStr) {
            const analysis = JSON.parse(analysisStr) as {
              industry?: string;
              business_overview_and_positioning?: string;
              most_popular_products_and_services?: string | string[];
              customer_demographics_and_psychographics?: string;
              brand_story?: string;
            };
            if (!websiteCategory && analysis?.industry?.trim()) {
              websiteCategory = analysis.industry.trim();
            }
            if (!brandContext) {
              const pop = analysis?.most_popular_products_and_services;
              brandContext = {
                business_overview: analysis?.business_overview_and_positioning ?? null,
                popular_products: Array.isArray(pop) ? pop : typeof pop === "string" ? (pop ? [pop] : null) : null,
                customer_demographics: analysis?.customer_demographics_and_psychographics ?? null,
                brand_story: analysis?.brand_story ?? null,
              };
            }
          }
        } catch {
          /* ignore */
        }
      }
      // Pass selected product image for Grok matching (top 20 relevant category+subcategory pairs)
      if (selectedProductId) {
        const sel = products.find((p) => p.id === selectedProductId);
        if (sel?.imageS3Key) productImageS3Key = sel.imageS3Key;
      }
      // Fallback: use product from onboarding if user selected from there
      if (!productImageS3Key) {
        try {
          const selectedStr = localStorage.getItem("dvyb_selected_products");
          if (selectedStr) {
            const selected = JSON.parse(selectedStr) as Array<{ id: number; s3Key: string; image?: string }>;
            if (Array.isArray(selected) && selected.length > 0 && selected[0]?.s3Key) {
              productImageS3Key = selected[0].s3Key;
            }
          }
        } catch {
          /* ignore */
        }
      }
      const res = await brandsApi.getDiscoverAds({
        page: 1,
        limit: 24,
        sort: "latest",
        ...(productImageS3Key && { productImageS3Key }),
        ...(websiteCategory && { websiteCategory }),
        ...(brandContext && Object.values(brandContext).some((v) => v != null && (Array.isArray(v) ? v.length : true)) && { brandContext }),
      });
      if (res.success && res.data) {
        const ads = (res.data as Array<Record<string, unknown>>).map((ad) => ({
          id: ad.id as number,
          image: (ad.creativeImageUrl as string) ?? null,
          videoSrc: (ad.creativeVideoUrl as string) ?? null,
          isVideo: ad.mediaType === "video",
          brandName: (ad.brandName as string) || "Unknown",
          brandLetter: (ad.brandLetter as string) || "?",
          category: ad.category as string | null,
          creativeImageUrl: (ad.creativeImageUrl as string) ?? null,
          creativeVideoUrl: (ad.creativeVideoUrl as string) ?? null,
        }));
        trackCreateAdFlowRelevantAdsFetched({
          adCount: ads.length,
          hasProductImage: !!productImageS3Key,
        });
        setDiscoverAds(ads);
      }
    } catch (e) {
      console.error("Failed to fetch discover ads:", e);
      toast({ title: "Error", description: "Failed to load ads", variant: "destructive" });
    } finally {
      setAdsLoading(false);
    }
  }, [toast, selectedProductId, products]);

  useEffect(() => {
    if (!open) return;
    setStep("product");
    setSelectedProductId(null);
    setSelectedAdIds(new Set());
    setInspirationLink("");
    setInstructions("");
    setUploadedFile(null);
    setUploadedS3Url(null);
    setIsDraggingOver(false);
    setIsUploading(false);
    setSearchQuery("");
    setProductSearchQuery("");
    setIsProductUploading(false);
    setIsProductDraggingOver(false);
    fetchProducts();
  }, [open, fetchProducts]);

  useEffect(() => {
    if (open && step === "ad") {
      fetchDiscoverAds();
    }
  }, [open, step, fetchDiscoverAds]);

  const filteredProducts = productSearchQuery.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(productSearchQuery.toLowerCase())
      )
    : products;

  const filteredAds = searchQuery.trim()
    ? discoverAds.filter(
        (ad) =>
          ad.brandName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ad.category?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : discoverAds;

  const handleProductSelect = (id: number) => {
    setSelectedProductId((prev) => (prev === id ? null : id));
  };

  const handleProductContinue = () => {
    if (!selectedProductId) return;
    if (preselectedInspiration?.imageUrl || preselectedInspiration?.videoUrl) {
      // Skip ad step: use preselected inspiration and generate directly
      void handleCreateAd();
    } else {
      setStep("ad");
    }
  };

  const handleAdToggle = (id: number) => {
    setSelectedAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const processInspirationFile = useCallback(async (file: File) => {
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file", description: "Please upload an image (JPEG, PNG, WebP, GIF) or video (MP4, WebM)", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      setUploadedFile(file);
      const s3Url = await adhocGenerationApi.uploadImage(file);
      setUploadedS3Url(s3Url);
    } catch (err) {
      toast({ title: "Upload failed", description: "Could not upload file", variant: "destructive" });
      setUploadedFile(null);
    } finally {
      setIsUploading(false);
    }
  }, [toast]);

  const processProductFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(file.type)) {
        toast({
          title: "Invalid file",
          description: "Please upload JPEG, PNG, or WebP image",
          variant: "destructive",
        });
        return;
      }
      setIsProductUploading(true);
      try {
        const uploadRes = await productsApi.uploadImage(file, () => {});
        if (uploadRes.success && uploadRes.data?.s3_key) {
          const defaultName = file.name.replace(/\.[^/.]+$/, "") || "Untitled";
          const createRes = await productsApi.create(defaultName, uploadRes.data.s3_key);
          if (createRes.success && createRes.data) {
            setProducts((prev) => [createRes.data!, ...prev]);
            setSelectedProductId(createRes.data!.id);
            setProductSearchQuery("");
          }
        } else {
          toast({ title: "Upload failed", description: uploadRes.error || "Could not upload", variant: "destructive" });
        }
      } catch (e) {
        console.error("Failed to add product:", e);
        toast({ title: "Failed to add product", variant: "destructive" });
      } finally {
        setIsProductUploading(false);
      }
    },
    [toast]
  );

  const handleProductFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processProductFile(file);
    e.target.value = "";
  };

  const handleProductDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(true);
  };

  const handleProductDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsProductDraggingOver(false);
    }
  };

  const handleProductDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsProductDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processProductFile(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processInspirationFile(file);
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
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processInspirationFile(file);
  };

  const handleCreateAd = async () => {
    const selectedProduct = products.find((p) => p.id === selectedProductId);
    if (!selectedProduct) {
      toast({ title: "Select a product", variant: "destructive" });
      return;
    }

    // Preselected inspiration (from "Create ad using template") takes precedence
    const preselectedUrls = preselectedInspiration
      ? [preselectedInspiration.isVideo ? preselectedInspiration.videoUrl : preselectedInspiration.imageUrl].filter(Boolean) as string[]
      : [];

    // Otherwise: template creatives OR custom reference — not both. Template takes precedence.
    const adUrls = discoverAds
      .filter((ad) => selectedAdIds.has(ad.id))
      .flatMap((ad) => [ad.creativeImageUrl, ad.creativeVideoUrl].filter(Boolean) as string[]);
    const pastedLinks = inspirationLink.trim() ? [inspirationLink.trim()] : [];
    const uploadedLinks = uploadedS3Url ? [uploadedS3Url] : [];

    const allInspirationLinks =
      preselectedUrls.length > 0
        ? preselectedUrls
        : adUrls.length > 0
          ? adUrls
          : [...pastedLinks, ...uploadedLinks].filter(Boolean);

    if (allInspirationLinks.length === 0) {
      toast({ title: "Select or add inspiration", description: "Choose an ad to replicate, paste a link, or upload an image", variant: "destructive" });
      return;
    }

    const imageCount = allInspirationLinks.length;

    try {
      const response = await adhocGenerationApi.generateContent({
        topic: "Ad Creative generation",
        platforms: ["instagram"],
        number_of_posts: imageCount,
        number_of_images: imageCount,
        number_of_videos: 0,
        user_images: [selectedProduct.imageS3Key],
        inspiration_links: allInspirationLinks,
        user_prompt: instructions.trim() || undefined,
      });

      if (!response.success) {
        throw new Error(response.error || "Generation failed");
      }

      setExpectedImageCount(imageCount);
      setInitialJobId(response.job_id || (response as { uuid?: string }).uuid || null);
      setShowGenerateDialog(true);
      onOpenChange(false);
      onCreateAd?.();
    } catch (error: any) {
      console.error("Create ad error:", error);
      toast({
        title: "Couldn't start generation",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleInteractOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-floating-bar]")) {
      e.preventDefault();
    }
  };

  const hasAdSelection = selectedAdIds.size > 0 || inspirationLink.trim() || uploadedS3Url;

  return (
    <>
      <Dialog open={open && step !== "generating"} onOpenChange={onOpenChange}>
        <DialogContent
          className={step === "product" ? productModalClass : adModalClass}
          onInteractOutside={handleInteractOutside}
        >
          {/* Step 1: Choose Product */}
          {step === "product" && (
            <>
              <input
                ref={productFileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleProductFileSelect}
              />
              <div className="px-6 py-4 border-b border-border shrink-0">
                <h2 className="text-xl font-bold mb-2 text-center text-neutral-900">
                  Choose a product to recreate this ad
                </h2>
                <p className="text-muted-foreground text-center text-sm mb-2">
                  Select the product you want to create an ad for
                </p>
                <p className="text-muted-foreground text-center text-xs mb-4">
                  Drag and drop an image onto the Add Product card, or click to browse
                </p>
                <div className="flex items-center gap-3 bg-neutral-100 rounded-full px-4 py-2.5 border border-neutral-200 max-w-md mx-auto">
                  <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground min-w-0"
                  />
                </div>
              </div>
              <div
                className={`flex-1 min-h-0 overflow-y-auto p-6 flex flex-col transition-colors ${
                  isProductDraggingOver ? "bg-primary/5 border-2 border-dashed border-primary rounded-lg" : ""
                }`}
                onDragOver={handleProductDragOver}
                onDragLeave={handleProductDragLeave}
                onDrop={handleProductDrop}
              >
                {isProductUploading ? (
                  <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
                    <Loader2 className="w-10 h-10 animate-spin" />
                    <p>Adding product...</p>
                  </div>
                ) : productsLoading ? (
                  <div className="flex justify-center items-center flex-1">
                    <p className="text-muted-foreground">Loading products...</p>
                  </div>
                ) : products.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-center cursor-pointer border-2 border-dashed border-border rounded-xl hover:border-primary hover:bg-primary/5 transition-colors"
                    onClick={() => productFileInputRef.current?.click()}
                  >
                    <Upload className="w-12 h-12 mb-4 opacity-60" />
                    <p className="mb-1 font-medium text-foreground">Drop a product image here</p>
                    <p className="text-sm">or click to browse</p>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="flex justify-center items-center flex-1 text-muted-foreground">
                    No products match your search.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3 content-start items-start pb-4">
                      <button
                        type="button"
                        onClick={() => !isProductUploading && productFileInputRef.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsProductDraggingOver(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setIsProductDraggingOver(false);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsProductDraggingOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) processProductFile(file);
                        }}
                        disabled={isProductUploading}
                        className={`text-left rounded-xl overflow-hidden cursor-pointer shrink-0 flex flex-col border-2 border-dashed bg-secondary/50 transition-colors group ${
                          isProductDraggingOver ? "border-primary bg-primary/5" : "border-border hover:border-primary hover:bg-primary/5"
                        } ${isProductUploading ? "pointer-events-none opacity-70" : ""}`}
                      >
                        <div className="aspect-square flex flex-col items-center justify-center gap-2 text-muted-foreground group-hover:text-primary">
                          <Plus className="w-8 h-8" />
                          <span className="text-sm font-medium">Add Product</span>
                        </div>
                      </button>
                      {filteredProducts.map((product) => {
                        const isSelected = selectedProductId === product.id;
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => handleProductSelect(product.id)}
                            className={`text-left rounded-xl overflow-hidden cursor-pointer group transition-all shrink-0 border border-neutral-200 bg-white ${
                              isSelected ? "ring-4 ring-neutral-900 ring-offset-2 border-neutral-300" : "hover:shadow-lg hover:border-neutral-300"
                            }`}
                          >
                            <div className="aspect-square relative bg-neutral-200">
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                              {isSelected && (
                                <div className="absolute top-2 right-2 w-6 h-6 bg-neutral-900 rounded-full flex items-center justify-center">
                                  <Check className="w-3.5 h-3.5 text-white" />
                                </div>
                              )}
                            </div>
                            <div className="p-2">
                              <p className="font-medium text-xs truncate">{product.name}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t border-border flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => productFileInputRef.current?.click()}
                  disabled={isProductUploading}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {isProductUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add new product
                </button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleProductContinue}
                    disabled={!selectedProductId}
                    className="bg-foreground text-background hover:bg-foreground/90"
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 2: Choose Ad to Replicate - Left/Right split, no scroll */}
          {step === "ad" && (
            <>
              <div className="px-6 py-4 border-b border-border shrink-0">
                <h2 className="text-xl font-bold mb-1 text-center text-neutral-900">
                  Choose an ad to replicate
                </h2>
                <p className="text-muted-foreground text-center text-sm">
                  Select from templates or add your own inspiration
                </p>
              </div>

              <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Left: Ad creative templates - scrollable when more images */}
                <div className="flex-1 min-w-0 flex flex-col p-5 min-h-0">
                  <div className="flex items-center gap-3 bg-neutral-100 rounded-full px-4 py-2.5 border border-neutral-200 mb-4 shrink-0">
                    <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Search brands or keywords..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-sm min-w-0"
                    />
                  </div>
                  {adsLoading ? (
                    <div className="flex justify-center items-center flex-1">
                      <p className="text-muted-foreground">Loading ads...</p>
                    </div>
                  ) : filteredAds.length === 0 ? (
                    <div className="flex justify-center items-center flex-1 text-muted-foreground text-center">
                      No ads match your search.
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto p-3">
                      <div className="columns-[160px] md:columns-[180px] lg:columns-[200px] gap-4">
                        {filteredAds.map((ad) => {
                          const isSelected = selectedAdIds.has(ad.id);
                          const mediaUrl = ad.isVideo ? ad.videoSrc : ad.image;
                          return (
                            <button
                              key={ad.id}
                              type="button"
                              onClick={() => handleAdToggle(ad.id)}
                              className={`text-left rounded-xl overflow-hidden cursor-pointer transition-all border border-neutral-200 bg-white break-inside-avoid mb-4 w-full ${
                                isSelected ? "ring-4 ring-neutral-900 ring-offset-2 border-neutral-300" : "hover:shadow-lg hover:border-neutral-300"
                              }`}
                            >
                              <div className="relative bg-neutral-100">
                                {mediaUrl ? (
                                  ad.isVideo ? (
                                    <video
                                      src={mediaUrl}
                                      className="w-full h-auto block"
                                      muted
                                      playsInline
                                    />
                                  ) : (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={mediaUrl}
                                      alt={ad.brandName}
                                      className="w-full h-auto block"
                                    />
                                  )
                                ) : (
                                  <div className="w-full aspect-square flex items-center justify-center bg-neutral-200 text-neutral-500">
                                    <span className="text-xs">No preview</span>
                                  </div>
                                )}
                                {isSelected && (
                                  <div className="absolute top-2 right-2 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center z-10">
                                    <Check className="w-4 h-4 text-white" />
                                  </div>
                                )}
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                                  <p className="text-white text-xs font-medium truncate">
                                    {ad.brandName} {ad.category ? `· ${ad.category}` : ""}
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Center: OR divider */}
                <div className="relative flex flex-col items-center justify-center w-12 shrink-0 bg-[hsl(0,0%,98%)]">
                  <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border" />
                  <span className="relative z-10 bg-[hsl(0,0%,98%)] px-2 text-base font-bold text-muted-foreground">
                    OR
                  </span>
                </div>

                {/* Right: Custom inspiration + Instructions */}
                <div className="flex-1 min-w-0 flex flex-col gap-4 p-5 overflow-hidden">
                  <div className="bg-neutral-100 rounded-xl p-4 border border-neutral-200 shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Reference Inspiration</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Drag and drop an ad you like — we&apos;ll adapt the style, not copy it.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => !isUploading && fileInputRef.current?.click()}
                      className={`relative flex flex-col items-center justify-center w-full min-h-[100px] rounded-xl border-2 border-dashed transition-all cursor-pointer mb-3 ${
                        isDraggingOver
                          ? "border-primary bg-primary/5"
                          : uploadedS3Url
                          ? "border-neutral-300 bg-white"
                          : "border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50"
                      } ${isUploading ? "pointer-events-none opacity-70" : ""}`}
                    >
                      {isUploading ? (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                          <span className="text-sm text-muted-foreground">Uploading...</span>
                        </div>
                      ) : uploadedS3Url && uploadedFile ? (
                        <div className="flex items-center gap-3 p-3 w-full">
                          {uploadedFile.type.startsWith("image/") ? (
                            <img
                              src={uploadedS3Url}
                              alt="Preview"
                              className="w-12 h-12 rounded-lg object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-neutral-200 flex items-center justify-center shrink-0">
                              <span className="text-xs text-muted-foreground">Video</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium truncate">{uploadedFile.name}</p>
                            <p className="text-xs text-muted-foreground">Click or drop to replace</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-4 px-4 text-center">
                          <Upload className="w-8 h-8 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {isDraggingOver ? "Drop here" : "Drag & drop Image"}
                          </span>
                          <span className="text-xs text-muted-foreground">or click to browse</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-neutral-200">
                      <LinkIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <Input
                        type="url"
                        placeholder="Paste an Instagram link"
                        value={inspirationLink}
                        onChange={(e) => setInspirationLink(e.target.value)}
                        className="flex-1 bg-transparent border-0 p-0 h-auto text-sm min-w-0"
                      />
                    </div>
                  </div>
                  <div className="bg-neutral-100 rounded-xl p-4 border border-neutral-200 shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Instructions</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Optional — you can skip this and edit later.
                    </p>
                    <Textarea
                      placeholder="Example: 'Minimal, premium tone. Focus on comfort and quality.'"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      className="min-h-[72px] resize-none bg-white text-sm border-neutral-200"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>

        {/* Floating bar for ad step */}
        {open && step === "ad" && typeof document !== "undefined" &&
          createPortal(
            <div
              data-floating-bar
              className={`fixed bottom-0 left-0 right-0 z-[300] flex justify-center px-[5vw] transition-transform duration-300 ease-out ${
                hasAdSelection ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <div className="w-full max-w-[90vw] mb-6 bg-neutral-900 text-white rounded-2xl px-6 py-4 flex items-center justify-between shadow-2xl pointer-events-auto">
                <p className="font-medium">
                  {selectedAdIds.size > 0
                    ? `${selectedAdIds.size} ad${selectedAdIds.size !== 1 ? "s" : ""} selected`
                    : inspirationLink.trim() || uploadedS3Url
                    ? "Inspiration added"
                    : "Continue"}
                </p>
                <button
                  type="button"
                  onClick={handleCreateAd}
                  className="inline-flex items-center justify-center gap-2 h-10 px-8 rounded-md text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Create Ad
                  <ArrowRight className="w-4 h-4 ml-2" />
                </button>
              </div>
            </div>,
            document.body
          )}
      </Dialog>

      {/* GenerateContentDialog - job polling and creatives (ad flow: bypass strategy, compact modal) */}
      <GenerateContentDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
        parentPage="home"
        initialJobId={initialJobId || undefined}
        adFlowMode={true}
        expectedImageCount={expectedImageCount}
        landingStyle={true}
        onDesignSaved={onDesignSaved}
        onDialogClosed={() => {
          setInitialJobId(null);
          setExpectedImageCount(0);
        }}
      />
    </>
  );
}
