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
  phantomWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { configureChains, createConfig, WagmiConfig } from 'wagmi'
import { base, mainnet } from 'wagmi/chains'
import { publicProvider } from 'wagmi/providers/public'

import '@rainbow-me/rainbowkit/styles.css'

// Configure chains and providers - Base mainnet as primary
const { chains, publicClient, webSocketPublicClient } = configureChains(
  [base, mainnet], // Base mainnet as primary, Ethereum mainnet as fallback
  [publicProvider()]
)

// Get WalletConnect project ID from environment
const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID

// Configure wallets with MetaMask and Phantom support
const connectors = connectorsForWallets([
  {
    groupName: 'Popular',
    wallets: [
      metaMaskWallet({ projectId: projectId || 'demo', chains }),
      phantomWallet({ chains }),
      injectedWallet({ chains }),
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
        initialChain={base} // Default to Base mainnet
      >
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
          {children}
        </div>
      </RainbowKitProvider>
    </WagmiConfig>
  )
} 