'use client'

import * as React from 'react'
import {
  RainbowKitProvider,
  getDefaultWallets,
  connectorsForWallets,
} from '@rainbow-me/rainbowkit'
import {
  injectedWallet,
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { configureChains, createConfig, WagmiConfig } from 'wagmi'
import { base, mainnet, localhost } from 'wagmi/chains'
import { publicProvider } from 'wagmi/providers/public'

import '@rainbow-me/rainbowkit/styles.css'

// Development chain configuration
const developmentChain = {
  ...localhost,
  id: 31337,
  name: 'RoastPower Local',
  network: 'roastpower-local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
    },
    public: {
      http: ['http://127.0.0.1:8545'],
    },
  },
}

// Configure chains and providers
const { chains, publicClient, webSocketPublicClient } = configureChains(
  process.env.NODE_ENV === 'development' 
    ? [developmentChain as any, base] // Local development chain first, then Base
    : [base, mainnet], // Production: Base mainnet as primary, Ethereum mainnet as fallback
  [publicProvider()]
)

// Get WalletConnect project ID from environment
const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID

// Configure wallets with fallback for missing project ID
const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',
    wallets: [
      injectedWallet({ chains }),
      metaMaskWallet({ projectId: projectId || 'demo', chains }),
      coinbaseWallet({ appName: 'RoastPower Mining', chains }),
      // Only include WalletConnect if we have a project ID
      ...(projectId ? [walletConnectWallet({ projectId, chains })] : []),
    ],
  },
])

// Create wagmi config
const wagmiConfig = createConfig({
  autoConnect: true,
  connectors,
  publicClient,
  webSocketPublicClient,
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiConfig config={wagmiConfig}>
      <RainbowKitProvider 
        chains={chains}
        initialChain={process.env.NODE_ENV === 'development' ? developmentChain as any : base}
      >
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
          {children}
        </div>
      </RainbowKitProvider>
    </WagmiConfig>
  )
} 