import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { base } from 'wagmi/chains'
import {
  metaMaskWallet,
  injectedWallet,
  rainbowWallet,
  walletConnectWallet,
  coinbaseWallet,
  phantomWallet,
} from '@rainbow-me/rainbowkit/wallets'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id'

// Enhanced Base chain with token metadata
const baseWithTokens = {
  ...base,
  contracts: {
    ...base.contracts,
    // Add ROAST token to the chain's contract registry
    roastToken: {
      address: '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4' as const,
      blockCreated: 18000000, // Approximate block when ROAST was deployed
    },
    usdcToken: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
      blockCreated: 16000000, // Approximate block when USDC was deployed on Base
    }
  },
  // Add token metadata for better wallet recognition
  nativeCurrency: base.nativeCurrency,
  rpcUrls: base.rpcUrls,
  blockExplorers: base.blockExplorers,
  testnet: false,
} as const

export const config = getDefaultConfig({
  appName: 'Burnie - Yapper Platform',
  projectId,
  chains: [baseWithTokens], // Use enhanced Base chain with token metadata
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [
        metaMaskWallet,
        phantomWallet,
        coinbaseWallet,
        walletConnectWallet,
      ],
    },
    {
      groupName: 'More',
      wallets: [
        rainbowWallet,
        injectedWallet,
      ],
    },
  ],
  ssr: false, // Disable SSR to prevent indexedDB errors
})

// Static fallback token metadata (used while fetching real data)
export const ROAST_TOKEN_FALLBACK = {
  address: '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4' as const,
  name: 'BurnieAI by Virtuals',
  symbol: 'ROAST',
  decimals: 18,
  image: '/roastusdc.svg', // Fallback to local image
  chainId: base.id,
  logoURI: '/roastusdc.svg',
  website: 'https://burnie.io',
  description: 'BurnieAI by Virtuals - The Attention Economy Intelligence Token'
} as const

// Legacy export for backward compatibility
export const ROAST_TOKEN_METADATA = ROAST_TOKEN_FALLBACK

export const USDC_TOKEN_METADATA = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  name: 'USD Coin',
  symbol: 'USDC', 
  decimals: 6,
  image: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
  chainId: base.id,
} as const 