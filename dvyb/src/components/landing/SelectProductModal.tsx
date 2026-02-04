"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Check, ArrowRight } from "lucide-react";

// Static products from new UI implementation (same as wander-discover-connect)
const STATIC_PRODUCTS = [
  { id: 1, name: "Snowflake Jacket", image: "/products/product-1.jpg" },
  { id: 2, name: "Puffer Coat", image: "/products/product-2.jpeg" },
  { id: 3, name: "Mohair Knit", image: "/products/product-3.webp" },
  { id: 4, name: "Black Crewneck", image: "/products/product-4.webp" },
  { id: 5, name: "Silver Speed Tee", image: "/products/product-5.webp" },
  { id: 6, name: "Tassel Bikini", image: "/products/product-6.jpeg" },
  { id: 7, name: "Chore Coat", image: "/products/product-7.jpeg" },
];

interface SelectProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SelectProductModal({ open, onOpenChange }: SelectProductModalProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleToggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreateAds = () => {
    const selected = STATIC_PRODUCTS.filter((p) => selectedIds.has(p.id));
    if (selected.length > 0) {
      localStorage.setItem("dvyb_selected_products", JSON.stringify(selected));
    }
    onOpenChange(false);
    router.push("/auth/login");
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
            Select your product photos
          </h2>
          <p className="text-muted-foreground text-center mb-2">
            Choose 1–3 products. We&apos;ll handle the rest.
          </p>
          <p className="text-xs text-muted-foreground text-center">
            You can regenerate with different products later.
          </p>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto p-6 ${selectedIds.size > 0 ? "pb-24" : "pb-4"}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {STATIC_PRODUCTS.map((product) => {
              const isSelected = selectedIds.has(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleToggle(product.id)}
                  className={`text-left rounded-xl overflow-hidden cursor-pointer group transition-all ${
                    isSelected ? "ring-4 ring-neutral-900 ring-offset-2" : "hover:shadow-lg"
                  }`}
                >
                  <div className="aspect-square relative bg-neutral-200">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-primary-foreground font-medium text-sm">{product.name}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>

      {/* Floating bar outside modal — same style as CustomizeAdModal; onInteractOutside keeps bar clicks from closing modal */}
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
                {selectedIds.size} product{selectedIds.size !== 1 ? "s" : ""} selected
              </p>
              <button
                type="button"
                onClick={handleCreateAds}
                className="inline-flex items-center justify-center gap-2 h-10 px-8 rounded-md text-sm font-medium bg-white text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Create Ads
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
