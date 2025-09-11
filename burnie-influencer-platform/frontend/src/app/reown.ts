"use client";

import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, mainnet } from "@reown/appkit/networks";
import { type AppKitNetwork } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
console.log("[AppKit] projectId (first 6 chars):", projectId.slice(0, 6)); // <= should NOT be empty
console.log("[AppKit] Full projectId length:", projectId.length);
if (!projectId) {
  console.error("[AppKit] Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (.env.local)");
  throw new Error("WalletConnect Project ID is required");
}
if (projectId.length !== 32) {
  console.error("[AppKit] Invalid projectId length:", projectId.length, "Expected: 32");
  throw new Error("Invalid WalletConnect Project ID format");
}

// Force Base network only - remove Ethereum Mainnet to prevent gas fee issues
const networks: AppKitNetwork[] = [base];

console.log("[AppKit] Networks configured:", networks.map(n => n.name));
console.log("[AppKit] Environment:", process.env.NODE_ENV);

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

// Log metadata configuration for debugging
const metadata = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "Burnie - Yapper Platform",
  description: process.env.NEXT_PUBLIC_APP_DESCRIPTION || "AI-powered content marketplace for yappers and content creators",
  url: process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXT_PUBLIC_YAPPER_TWITTER_REDIRECT_URI?.replace('/yapper-twitter-callback', '') || "http://localhost:3004",
  icons: [
    `${process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.NEXT_PUBLIC_YAPPER_TWITTER_REDIRECT_URI?.replace('/yapper-twitter-callback', '') || "http://localhost:3004"}/favicon.svg`,
  ],
};

console.log("[AppKit] Metadata configuration:", metadata);

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: networks as [AppKitNetwork, ...AppKitNetwork[]],
  metadata,
  // Disable email, Google sign-in, and social login options
  // KEY CONFIGURATION: Disable wallet management features
  features: {
    email: false,
    socials: [],
    analytics: false,
    
    // Disable on-ramp (buy crypto) functionality
    onramp: false,
    
    // Disable token swaps functionality  
    swaps: false,
    
    // Set connection methods to wallet only (no email/social)
    connectMethodsOrder: ['wallet'],
    
    // Disable legal checkbox
    legalCheckbox: false
  },
  siweConfig: {
    getNonce: async () => {
      const res = await fetch("/api/siwe/nonce", { cache: "no-store" });
      return res.text();
    },
    createMessage: async (opts: Record<string, unknown>) => {
      const res = await fetch("/api/siwe/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      return res.text();
    },
    verifyMessage: async (sig: { message: string; signature: string }) => {
      const res = await fetch("/api/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sig),
      });
      return res.json();
    },
    mapToSIWX: (siwe: any) => siwe, // Add this required function
  },
});

// Import centralized modal management
import { setPurchaseFlowActive as setModalPurchaseFlowActive } from '../utils/modalManager';

// Re-export for backward compatibility
export function setPurchaseFlowActive(active: boolean) {
  setModalPurchaseFlowActive(active);
}

// Initialize the centralized modal management system
import '../utils/modalManager';

// Event-based modal prevention for wallet management features
appKit.subscribeEvents((event) => {
  console.log('AppKit Event:', event);
  
  // Handle modal state changes - check if modal is open
  if ((event as any).open) {
    // Check if this is an unwanted modal view
    const currentView = (event as any).view;
    
    // The centralized modal manager handles all logic now
    // This is just for logging and emergency fallback
    console.log('Modal event detected:', currentView);
  }
});

// Additional state monitoring for logging
appKit.subscribeState((state) => {
  console.log('AppKit State:', state);
});
