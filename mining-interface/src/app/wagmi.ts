import { getDefaultWallets, connectorsForWallets } from '@rainbow-me/rainbowkit'
import { configureChains, createConfig } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { publicProvider } from 'wagmi/providers/public'
import {
  metaMaskWallet,
  injectedWallet,
  rainbowWallet,
  walletConnectWallet,
  coinbaseWallet,
  phantomWallet,
} from '@rainbow-me/rainbowkit/wallets'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id'

const { chains, publicClient, webSocketPublicClient } = configureChains(
  [base, baseSepolia],
  [publicProvider()]
)

const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',
    wallets: [
      metaMaskWallet({ projectId, chains }),
      phantomWallet({ chains }),
      coinbaseWallet({ appName: 'Burnie Mining Interface', chains }),
      walletConnectWallet({ projectId, chains }),
    ],
  },
  {
    groupName: 'More',
    wallets: [
      rainbowWallet({ projectId, chains }),
      injectedWallet({ chains }),
    ],
  },
])

export const config = createConfig({
  autoConnect: true,
  connectors,
  publicClient,
  webSocketPublicClient,
})

export { chains } 