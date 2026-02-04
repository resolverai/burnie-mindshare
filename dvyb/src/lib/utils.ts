import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract display domain from website URL (e.g. "https://www.yourbrand.com" → "yourbrand.com"). For @handle, returns as-is. Fallback when no URL. */
export function getWebsiteDomainDisplay(fallback = "yourbrand"): string {
  if (typeof window === "undefined") return fallback;
  try {
    const url = localStorage.getItem("dvyb_pending_website_url");
    if (!url || !url.trim()) return fallback;
    const trimmed = url.trim();
    if (trimmed.startsWith("@")) return trimmed;
    try {
      const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      let host = parsed.hostname.replace(/^www\./, "");
      return host || fallback;
    } catch {
      return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || fallback;
    }
  } catch {
    return fallback;
  }
}

