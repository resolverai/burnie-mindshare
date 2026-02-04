"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Bookmark, Loader2, Video, ImageIcon, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContentLibrary, ContentLibraryRef } from "./ContentLibrary";
import { AdDetailModal } from "./AdDetailModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { brandsApi, productsApi } from "@/lib/api";
import { format } from "date-fns";

type TabId = "my-ads" | "my-products" | "saved-ads";

type AspectRatio = "9:16" | "16:9" | "1:1";

const getAspectRatioClass = (ratio: AspectRatio) => {
  switch (ratio) {
    case "9:16": return "aspect-[9/16]";
    case "16:9": return "aspect-[16/9]";
    case "1:1": return "aspect-square";
    default: return "aspect-square";
  }
};

/** Derive aspect ratio from ad id for visual variety (API doesn't return dimensions yet). */
const getAspectRatioFromId = (id: number): AspectRatio => {
  const r = id % 5;
  if (r === 0 || r === 1) return "1:1";
  if (r === 2 || r === 3) return "9:16";
  return "16:9";
};

interface SavedAdCard {
  id: number;
  image: string | null;
  videoSrc: string | null;
  isVideo: boolean;
  timeAgo: string;
  brandLetter: string;
  brandName: string;
  category: string | null;
  aspectRatio: "9:16" | "16:9" | "1:1";
  status?: string;
  runtime?: string | null;
  firstSeen?: string | null;
  adSnapshotUrl?: string | null;
  platform?: string;
  targetLanguage?: string;
  targetCountries?: string[] | null;
  targetGender?: string | null;
  targetAges?: string[] | null;
  adCopy?: Record<string, unknown> | null;
  landingPage?: string | null;
}

interface Product {
  id: number;
  name: string;
  imageS3Key: string;
  imageUrl: string;
  createdAt: string;
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const DRAWER_CLOSE_DURATION_MS = 300;

interface MyContentPageProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onEditDesignModeChange?: (isEditMode: boolean) => void;
}

export function MyContentPage({
  activeTab,
  onTabChange,
  onEditDesignModeChange,
}: MyContentPageProps) {
  const [savedAds, setSavedAds] = useState<SavedAdCard[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [selectedSavedAd, setSelectedSavedAd] = useState<SavedAdCard | null>(null);
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [hoveredSavedId, setHoveredSavedId] = useState<number | null>(null);
  const contentLibraryCreateNewRef = useRef<ContentLibraryRef | null>(null);
  const savedVideoRefs = useRef<{ [key: number]: HTMLVideoElement | null }>({});

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [productNameDialog, setProductNameDialog] = useState<{ open: boolean; s3Key: string | null; name: string }>({
    open: false,
    s3Key: null,
    name: "",
  });
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  const productFileInputRef = useRef<HTMLInputElement>(null);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await productsApi.list();
      if (res.success && res.data) {
        setProducts(res.data);
      }
    } catch (e) {
      console.error("Failed to fetch products:", e);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return;
      }
      setUploadProgress(0);
      const res = await productsApi.uploadImage(file, (p) => setUploadProgress(p));
      setUploadProgress(null);
      if (res.success && res.data?.s3_key) {
        setProductNameDialog({ open: true, s3Key: res.data.s3_key, name: "" });
      } else {
        console.error("Upload failed:", res.error);
      }
    },
    []
  );

  const handleAddProductClick = useCallback(() => {
    productFileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile]
  );

  const handleProductNameSubmit = useCallback(async () => {
    const { s3Key, name } = productNameDialog;
    if (!s3Key || !name.trim()) return;
    setIsCreatingProduct(true);
    try {
      const res = await productsApi.create(name.trim(), s3Key);
      if (res.success && res.data) {
        setProducts((prev) => [res.data!, ...prev]);
        setProductNameDialog({ open: false, s3Key: null, name: "" });
      }
    } catch (e) {
      console.error("Failed to create product:", e);
    } finally {
      setIsCreatingProduct(false);
    }
  }, [productNameDialog]);

  const handleDeleteProduct = useCallback(async (id: number) => {
    setDeleteConfirmProduct(null);
    setIsDeletingId(id);
    try {
      const res = await productsApi.delete(id);
      if (res.success) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (e) {
      console.error("Failed to delete product:", e);
    } finally {
      setIsDeletingId(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }, []);

  const fetchSavedAds = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await brandsApi.getSavedAds({ page: 1, limit: 50 });
      if (res.success && res.data) {
        setSavedAds(
          res.data.map((ad) => ({
            id: ad.id,
            image: ad.image,
            videoSrc: ad.videoSrc,
            isVideo: ad.isVideo,
            timeAgo: ad.timeAgo || ad.runtime || "",
            brandLetter: ad.brandLetter,
            brandName: ad.brandName,
            category: ad.category,
            aspectRatio: getAspectRatioFromId(ad.id),
            status: ad.status,
            runtime: ad.runtime,
            firstSeen: (ad as any).firstSeen,
            adSnapshotUrl: (ad as any).adSnapshotUrl,
            platform: (ad as any).platform,
            targetLanguage: (ad as any).targetLanguage,
            targetCountries: (ad as any).targetCountries,
            targetGender: (ad as any).targetGender,
            targetAges: (ad as any).targetAges,
            adCopy: (ad as any).adCopy,
            landingPage: (ad as any).landingPage,
          }))
        );
      }
    } catch (e) {
      console.error("Failed to fetch saved ads:", e);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "saved-ads") {
      fetchSavedAds();
    }
  }, [activeTab, fetchSavedAds]);

  useEffect(() => {
    if (activeTab === "my-products") {
      fetchProducts();
    }
  }, [activeTab, fetchProducts]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header - Row 1: My Content + Create New */}
      <div className="flex-shrink-0 border-b border-border bg-[hsl(var(--app-content-bg))]">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-5">
          <div className="flex flex-row items-center justify-between gap-4">
            <h1 className="text-2xl lg:text-3xl font-bold">My Content</h1>
            {activeTab === "my-ads" && (
              <Button
                onClick={() => contentLibraryCreateNewRef.current?.openCreateNew()}
                className="bg-foreground text-background hover:bg-foreground/90 rounded-lg px-4 py-2 font-medium shrink-0"
              >
                Create New
              </Button>
            )}
            {activeTab === "my-products" && (
              <Button
                onClick={handleAddProductClick}
                className="bg-foreground text-background hover:bg-foreground/90 rounded-lg px-4 py-2 font-medium shrink-0"
              >
                Add Product
              </Button>
            )}
          </div>
          {/* Row 2: Content type tabs */}
          <div className="flex items-center mt-4">
            <div className="flex items-center bg-secondary rounded-full p-1">
              <button
                onClick={() => onTabChange("my-ads")}
                className={`px-3 lg:px-4 py-2 rounded-full text-xs lg:text-sm font-medium transition-all ${
                  activeTab === "my-ads" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                My Ads
              </button>
              <button
                onClick={() => onTabChange("my-products")}
                className={`px-3 lg:px-4 py-2 rounded-full text-xs lg:text-sm font-medium transition-all ${
                  activeTab === "my-products" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Products
              </button>
              <button
                onClick={() => onTabChange("saved-ads")}
                className={`px-3 lg:px-4 py-2 rounded-full text-xs lg:text-sm font-medium transition-all ${
                  activeTab === "saved-ads" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Saved
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "my-ads" && (
          <ContentLibrary
            ref={contentLibraryCreateNewRef}
            onEditDesignModeChange={onEditDesignModeChange}
          />
        )}

        {activeTab === "my-products" && (
          <div
            className={`max-w-7xl mx-auto px-4 md:px-6 py-6 min-h-[300px] rounded-xl transition-colors ${
              isDraggingOver ? "bg-primary/5 border-2 border-dashed border-primary" : ""
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={productFileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
            {uploadProgress !== null && (
              <div className="mb-6 p-4 bg-secondary rounded-xl">
                <p className="text-sm font-medium mb-2">Uploading product image...</p>
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}
            {productsLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Loading products...</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="group relative bg-background border border-border rounded-xl overflow-hidden cursor-pointer"
                    onClick={() => setPreviewProduct(product)}
                  >
                    <div className="aspect-square relative">
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmProduct(product);
                        }}
                        disabled={isDeletingId === product.id}
                        className="absolute top-2 right-2 p-2 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity disabled:opacity-50"
                        aria-label="Delete product"
                      >
                        {isDeletingId === product.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="p-3 flex items-center justify-between gap-2">
                      {product.name.length > 12 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <h3 className="font-medium text-sm truncate min-w-0 cursor-default">
                              {product.name.slice(0, 12)}...
                            </h3>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">{product.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <h3 className="font-medium text-sm truncate min-w-0">{product.name}</h3>
                      )}
                      <p className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(product.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                ))}
                <button
                  onClick={handleAddProductClick}
                  className="aspect-square bg-secondary/50 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <Plus className="w-8 h-8" />
                  <span className="text-sm font-medium">Add Product</span>
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "saved-ads" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
            {savedLoading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Loading saved ads...</p>
              </div>
            ) : savedAds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
                  <Bookmark className="w-8 h-8 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold mb-2">No saved ads yet</h2>
                <p className="text-muted-foreground max-w-md">
                  Save ads from the Discover page to reference them later when creating your own content
                </p>
              </div>
            ) : (
              <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-4 md:gap-5">
                {savedAds.map((ad, index) => (
                  <div
                    key={ad.id}
                    className={`mb-4 md:mb-5 break-inside-avoid group relative rounded-xl overflow-hidden bg-card shadow-card hover:shadow-card-hover transition-all cursor-pointer ${getAspectRatioClass(ad.aspectRatio)}`}
                    style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                    onClick={() => {
                      setSelectedSavedAd(ad);
                      setSavedDrawerOpen(true);
                    }}
                    onMouseEnter={() => {
                      setHoveredSavedId(ad.id);
                      if (ad.videoSrc && savedVideoRefs.current[ad.id]) {
                        savedVideoRefs.current[ad.id]?.play().catch(() => {});
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredSavedId(null);
                      const v = savedVideoRefs.current[ad.id];
                      if (v) {
                        v.pause();
                        v.currentTime = 0;
                      }
                    }}
                  >
                    <div className="relative w-full h-full">
                      {ad.videoSrc ? (
                        <>
                          <img
                            src={ad.image || "/placeholder.svg"}
                            alt=""
                            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                              hoveredSavedId === ad.id ? "opacity-0" : "opacity-100"
                            }`}
                          />
                          <video
                            ref={(el) => {
                              savedVideoRefs.current[ad.id] = el;
                            }}
                            src={ad.videoSrc}
                            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                              hoveredSavedId === ad.id ? "opacity-100" : "opacity-0"
                            }`}
                            muted
                            playsInline
                            loop
                          />
                        </>
                      ) : (
                        <img
                          src={ad.image || "/placeholder.svg"}
                          alt={ad.brandName}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                      <div className="absolute top-2.5 left-2.5">
                        <span className="px-2.5 py-1 rounded-md bg-teal-600 text-white text-xs font-medium">
                          {ad.runtime || ad.timeAgo || "—"}
                        </span>
                      </div>
                      <div className="absolute top-2.5 right-2.5">
                        <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          ad.id % 2 === 0
                            ? "bg-white/95 text-gray-800 border border-gray-200"
                            : "bg-gray-800/90 text-white"
                        }`}>
                          {ad.brandLetter} {ad.brandName}
                        </span>
                      </div>
                      <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-gray-800/80 text-white z-10">
                        {ad.isVideo ? (
                          <>
                            <Video className="w-3 h-3" />
                            <span className="text-xs font-medium">Video</span>
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-3 h-3" />
                            <span className="text-xs font-medium">Image</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete product confirmation */}
      <AlertDialog open={!!deleteConfirmProduct} onOpenChange={(open) => !open && setDeleteConfirmProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmProduct && (
                <>
                  Are you sure you want to delete &quot;{deleteConfirmProduct.name}&quot;? This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmProduct && handleDeleteProduct(deleteConfirmProduct.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Product preview modal - similar to inspiration modal in GenerateContentDialog */}
      {previewProduct && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-black/80 animate-in fade-in-0"
            onClick={() => setPreviewProduct(null)}
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4">
            <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden shadow-2xl animate-in zoom-in-95 fade-in-0">
              <button
                onClick={() => setPreviewProduct(null)}
                className="absolute top-4 right-4 z-20 bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              <div className="w-full aspect-[4/5]">
                <img
                  src={previewProduct.imageUrl}
                  alt={previewProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white font-medium text-lg">{previewProduct.name}</p>
                <p className="text-white/60 text-xs mt-1">
                  Added {format(new Date(previewProduct.createdAt), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Product name dialog - after upload */}
      <Dialog
        open={productNameDialog.open}
        onOpenChange={(open) => !open && setProductNameDialog({ open: false, s3Key: null, name: "" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name your product</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Enter product name"
              value={productNameDialog.name}
              onChange={(e) => setProductNameDialog((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleProductNameSubmit()}
              maxLength={500}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {productNameDialog.name.length}/500 characters
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProductNameDialog({ open: false, s3Key: null, name: "" })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleProductNameSubmit}
              disabled={!productNameDialog.name.trim() || isCreatingProduct}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isCreatingProduct ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Product"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ad detail modal for saved ads - delay clearing selected so close animation plays */}
      {selectedSavedAd && (
        <AdDetailModal
          card={selectedSavedAd}
          isOpen={savedDrawerOpen && !!selectedSavedAd}
          onClose={() => {
            setSavedDrawerOpen(false);
            setTimeout(() => {
              setSelectedSavedAd(null);
              fetchSavedAds(); // Refresh in case user unsaved
            }, DRAWER_CLOSE_DURATION_MS);
          }}
        />
      )}
    </div>
  );
}
