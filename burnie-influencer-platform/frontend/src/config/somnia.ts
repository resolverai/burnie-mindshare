import { type AppKitNetwork } from "@reown/appkit/networks";

/**
 * Somnia Testnet Network Configuration for Reown AppKit
 * 
 * Chain ID: 50312
 * RPC: https://dream-rpc.somnia.network
 * Explorer: https://somnia.w3us.site
 * Native Token: STT (Somnia Test Token)
 */
export const somniaTestnet: AppKitNetwork = {
  id: parseInt(process.env.NEXT_PUBLIC_SOMNIA_CHAIN_ID || "50312"),
  name: "Somnia Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Somnia Test Token",
    symbol: "STT",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Somnia Explorer",
      url: process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL || "https://somnia.w3us.site",
    },
  },
  contracts: {
    // TOAST Token (ERC-20 with EIP-2612 Permit)
    toastToken: {
      address: process.env.NEXT_PUBLIC_TOAST_TOKEN_ADDRESS as `0x${string}` || "0x3A15cfDDa1c598De891E66AA6e7EAc47D20EfBC7",
    },
    // Content Registry (Content ownership & marketplace)
    contentRegistry: {
      address: process.env.NEXT_PUBLIC_CONTENT_REGISTRY_ADDRESS as `0x${string}` || "0x74A28D0a78ae57C618BD8338E54110D8922C990e",
    },
    // Reward Distribution (Automated payouts)
    rewardDistribution: {
      address: process.env.NEXT_PUBLIC_REWARD_DISTRIBUTION_ADDRESS as `0x${string}` || "0x6feaa2AC70D6afFc70063840E3e8465668267700",
    },
  },
  testnet: true,
} as AppKitNetwork;

/**
 * Network Type for TypeScript
 */
export type NetworkType = 'base' | 'somnia_testnet';

/**
 * Get network type from chain ID
 */
export function getNetworkType(chainId: number | undefined): NetworkType {
  if (!chainId) return 'base';
  
  switch (chainId) {
    case 50312:
      return 'somnia_testnet';
    case 8453:
    default:
      return 'base';
  }
}

/**
 * Get chain ID from network type
 */
export function getChainIdFromNetwork(network: NetworkType): number {
  switch (network) {
    case 'somnia_testnet':
      return 50312;
    case 'base':
    default:
      return 8453;
  }
}

/**
 * Get token symbol for network
 */
export function getTokenSymbol(network: NetworkType): string {
  return network === 'somnia_testnet' ? 'TOAST' : 'ROAST';
}

/**
 * Get token address for network
 */
export function getTokenAddress(network: NetworkType): string {
  if (network === 'somnia_testnet') {
    return process.env.NEXT_PUBLIC_TOAST_TOKEN_ADDRESS || '0x3A15cfDDa1c598De891E66AA6e7EAc47D20EfBC7';
  }
  return process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN || '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';
}

/**
 * Check if USDC is supported on network
 */
export function isUSDCSupported(network: NetworkType): boolean {
  return network === 'base'; // USDC only on Base
}

/**
 * Get explorer URL for transaction
 */
export function getExplorerTxUrl(network: NetworkType, txHash: string): string {
  if (network === 'somnia_testnet') {
    return `${process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL}/tx/${txHash}`;
  }
  return `https://basescan.org/tx/${txHash}`;
}

/**
 * Get explorer URL for address
 */
export function getExplorerAddressUrl(network: NetworkType, address: string): string {
  if (network === 'somnia_testnet') {
    return `${process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL}/address/${address}`;
  }
  return `https://basescan.org/address/${address}`;
}

