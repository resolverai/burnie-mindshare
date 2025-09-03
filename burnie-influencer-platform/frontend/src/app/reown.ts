"use client";

import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, mainnet } from "@reown/appkit/networks";
import { type AppKitNetwork } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
console.log("[AppKit] projectId (first 6 chars):", projectId.slice(0, 6)); // <= should NOT be empty
if (!projectId) {
  console.error("[AppKit] Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (.env.local)");
}

const networks: AppKitNetwork[] = [base, mainnet];

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: networks as [AppKitNetwork, ...AppKitNetwork[]],
  metadata: {
    name: process.env.NEXT_PUBLIC_APP_NAME || "Burnie - Yapper Platform",
    description: process.env.NEXT_PUBLIC_APP_DESCRIPTION || "AI-powered content marketplace for yappers and content creators",
    url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004",
    icons: [
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004"}/favicon.svg`,
    ],
  },
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

// Event-based modal prevention for wallet management features
appKit.subscribeEvents((event) => {
  console.log('AppKit Event:', event);
  
  // Handle modal state changes - check if modal is open
  if ((event as any).open) {
    // Check if this is an unwanted modal view
    const currentView = (event as any).view;
    
    // Prevent account/balance/fund management views from opening
    if (currentView === 'Account' || 
        currentView === 'OnRamp' || 
        currentView === 'Swap' ||
        currentView === 'WalletManagement' ||
        currentView === 'FundWallet' ||
        currentView === 'Send' ||
        currentView === 'Activity') {
      console.log('Preventing modal view:', currentView);
      // Immediately close unwanted modals
      setTimeout(() => {
        appKit.close();
      }, 50); // Faster response time
    }
  }
});

// Override modal methods to filter unwanted views
const originalOpen = appKit.open.bind(appKit);
appKit.open = function(options) {
  // Filter out unwanted modal views - use string comparison to avoid type issues
  if (options && options.view && (
    String(options.view).includes('OnRamp') || 
    String(options.view).includes('Swap') || 
    String(options.view).includes('Account') ||
    String(options.view).includes('WalletManagement') ||
    String(options.view).includes('FundWallet') ||
    String(options.view).includes('Send') ||
    String(options.view).includes('Activity')
  )) {
    console.log('Blocked modal view:', options.view);
    return Promise.resolve();
  }
  
  // Allow connection and other necessary views
  return originalOpen(options);
};

// Additional state monitoring to prevent fund management modals
appKit.subscribeState((state) => {
  console.log('AppKit State:', state);
  
  // Check if modal is open and prevent fund management views
  if (state.open) {
    const currentView = (state as any).view;
    
    // If any fund management view is detected, close immediately
    if (currentView === 'Account' || 
        currentView === 'OnRamp' || 
        currentView === 'Swap' ||
        currentView === 'WalletManagement' ||
        currentView === 'FundWallet' ||
        currentView === 'Send' ||
        currentView === 'Activity') {
      console.log('State-based prevention - closing modal view:', currentView);
      appKit.close();
    }
  }
});
