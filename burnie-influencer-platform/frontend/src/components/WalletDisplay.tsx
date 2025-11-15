'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { appKit } from '@/app/reown'
import toast from 'react-hot-toast'
import useMixpanel from '../hooks/useMixpanel'
import { getNetworkType, getChainIdFromNetwork, type NetworkType } from '@/config/somnia'

interface WalletDisplayProps {
  className?: string
  showBalance?: boolean
  balance?: string | number
  balanceLoading?: boolean
  tokenSymbol?: string
}

export default function WalletDisplay({ 
  className = '', 
  showBalance = false, 
  balance, 
  balanceLoading = false,
  tokenSymbol = 'ROAST'
}: WalletDisplayProps) {
  const { address, isConnected, isConnecting } = useAccount()
  const { disconnect, isPending: isDisconnecting } = useDisconnect()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const mixpanel = useMixpanel()
  const [showDropdown, setShowDropdown] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('base')
  const [isSwitching, setIsSwitching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Sync selected network with actual chain ID
  useEffect(() => {
    const networkType = getNetworkType(chainId)
    setSelectedNetwork(networkType)
  }, [chainId])

  // Initialize user's network record on first connection
  useEffect(() => {
    const initializeNetwork = async () => {
      if (!address) return
      
      try {
        console.log('[WalletDisplay] Initializing network for:', address)
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/network/current`, {
          headers: {
            'Authorization': `Bearer ${address}`,
          },
        })
        
        if (response.ok) {
          const data = await response.json()
          console.log('[WalletDisplay] User network preference:', data.currentNetwork)
          
          // If backend network differs from wallet network, update backend to match wallet
          const backendNetwork = data.currentNetwork as NetworkType
          const walletNetwork = getNetworkType(chainId)
          
          if (backendNetwork !== walletNetwork) {
            console.log('[WalletDisplay] Syncing backend to match wallet network:', walletNetwork)
            
            // Update backend to match wallet without switching the wallet
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/network/switch`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${address}`,
              },
              body: JSON.stringify({
                network: walletNetwork,
                walletAddress: address,
              }),
            })
          }
        }
      } catch (error) {
        console.error('[WalletDisplay] Failed to initialize network:', error)
      }
    }
    
    initializeNetwork()
  }, [address, chainId])

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const truncateAddress = (address: string | undefined): string => {
    if (!address) return ""
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleConnect = () => {
    console.log("[AppKit] Connect button clicked")
    
    // Track wallet connect event
    console.log('🎯 Wallet connect clicked from header bar')
    mixpanel.walletConnectClicked({
      connectSource: 'headerBar',
      currentPage: typeof window !== 'undefined' ? window.location.pathname : '/',
      deviceType: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
      screenName: 'HeaderBar'
    })
    
    const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/"
    localStorage.setItem("wc_return_path", currentPath)
    
    // Only set timestamp for mobile devices to enable mobile recovery
    const isMobile = typeof window !== "undefined" && (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
      window.innerWidth < 768
    )
    
    if (isMobile) {
      localStorage.setItem("wc_connection_timestamp", Date.now().toString())
      console.log('📱 Mobile wallet connection initiated from:', currentPath)
    } else {
      console.log('🖥️ Desktop wallet connection initiated from:', currentPath)
    }
    
    appKit.open()
  }

  const handleDisconnect = async () => {
    try {
      // Track wallet disconnect event
      console.log('🎯 Wallet disconnect clicked from header bar')
      mixpanel.walletDisconnected({
        disconnectSource: 'headerBar',
        currentPage: typeof window !== 'undefined' ? window.location.pathname : '/',
        deviceType: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
        screenName: 'HeaderBar'
      })
      
      // Start redirect immediately, don't wait for disconnect to complete
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        console.log('🔄 Immediate redirect to homepage after wallet disconnect')
        setTimeout(() => {
          window.location.replace('/')
        }, 100)
      }
      
      await disconnect()
      toast.success("Wallet disconnected successfully")
      
      // Additional redirect attempts in case the first one didn't work
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Secondary redirect to homepage after wallet disconnect')
          window.location.replace('/')
        }
      }, 500)
      
      // Final backup redirect
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Final backup redirect to homepage after wallet disconnect')
          window.location.href = '/'
        }
      }, 1000)
    } catch {
      toast.error("Failed to disconnect wallet")
      // Even if disconnect fails, still redirect to homepage
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.replace('/')
      }
    }
  }

  const copyAddress = async () => {
    if (address) {
      try {
        await navigator.clipboard.writeText(address)
        toast.success("Wallet address copied!")
      } catch {
        toast.error("Failed to copy address")
      }
    }
  }

  const handleNetworkSwitch = async (network: NetworkType) => {
    if (!address) {
      toast.error('Please connect your wallet first')
      return
    }

    if (isSwitching) return

    setIsSwitching(true)
    
    try {
      const targetChainId = getChainIdFromNetwork(network)
      
      // Step 1: Switch wallet network
      console.log(`[WalletDisplay] Switching to ${network} (Chain ID: ${targetChainId})`)
      
      try {
        await switchChain({ chainId: targetChainId })
      } catch (switchError: any) {
        // If the error is because the chain is not added, try to add it via wallet_addEthereumChain
        if (switchError?.message?.includes('Unrecognized chain ID') || 
            switchError?.code === 4902 || 
            switchError?.message?.includes('Try adding the chain')) {
          
          console.log('[WalletDisplay] Chain not found in wallet, attempting to add it...')
          
          if (network === 'somnia_testnet') {
            // Add Somnia Testnet to wallet
            try {
              // @ts-ignore - wallet_addEthereumChain is not in the types
              await window.ethereum?.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: `0x${targetChainId.toString(16)}`,
                  chainName: 'Somnia Testnet',
                  nativeCurrency: {
                    name: 'STT',
                    symbol: 'STT',
                    decimals: 18,
                  },
                  rpcUrls: [process.env.NEXT_PUBLIC_SOMNIA_RPC_URL || 'https://dream-rpc.somnia.network'],
                  blockExplorerUrls: [process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL || 'https://somnia.w3us.site'],
                }],
              })
              
              // After adding, try switching again
              await switchChain({ chainId: targetChainId })
              console.log('[WalletDisplay] Successfully added and switched to Somnia Testnet')
            } catch (addError) {
              console.error('[WalletDisplay] Failed to add Somnia Testnet:', addError)
              throw new Error('Failed to add Somnia Testnet to your wallet. Please add it manually.')
            }
          } else {
            throw switchError
          }
        } else {
          throw switchError
        }
      }
      
      // Step 2: Update backend
      console.log('[WalletDisplay] Updating backend network preference')
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/network/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          network,
          walletAddress: address,
        }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to update network preference')
      }
      
      const data = await response.json()
      console.log('[WalletDisplay] Backend response:', data)
      
      // Step 3: Show airdrop notification if applicable
      if (data.airdrop?.success) {
        toast.success(
          `🎁 Welcome to Somnia! Received ${data.airdrop.amount} TOAST tokens!`,
          { duration: 6000 }
        )
      }
      
      setSelectedNetwork(network)
      toast.success(`Switched to ${network === 'somnia_testnet' ? 'Somnia Testnet' : 'Base Mainnet'}`)
      
      // Close dropdown
      setShowDropdown(false)
      
      // Step 4: Reload to refresh marketplace content
      setTimeout(() => {
        window.location.reload()
      }, 1500)
      
    } catch (error: any) {
      console.error('[WalletDisplay] Failed to switch network:', error)
      
      if (error.message?.includes('User rejected')) {
        toast.error('Network switch cancelled')
      } else if (error.code === 4001) {
        toast.error('Network switch rejected by user')
      } else {
        toast.error(error.message || 'Failed to switch network. Please try switching manually in your wallet.')
      }
    } finally {
      setTimeout(() => setIsSwitching(false), 2000)
    }
  }

  const getNetworkName = (network: NetworkType) => {
    return network === 'somnia_testnet' ? 'Somnia Testnet' : 'Base Mainnet'
  }

  const getTokenSymbol = (network: NetworkType) => {
    return network === 'somnia_testnet' ? 'TOAST' : 'ROAST'
  }

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <div className={`bg-[#FD7A10] text-white px-4 py-2 rounded-lg font-medium ${className}`}>
        Connect Wallet
      </div>
    )
  }

  if (!isConnected) {
    return (
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className={`bg-[#FD7A10] hover:bg-[#e55a0d] text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${className}`}
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    )
  }

  return (
    <div className={`relative flex items-center gap-2 ${className}`} ref={dropdownRef}>
      {/* Balance Badge */}
      {showBalance && (
        <div 
          key={`balance-${tokenSymbol}`}
          className="px-3 py-1 bg-white text-black rounded-full text-lg font-bold hidden md:flex items-center gap-1" 
          style={{ fontFamily: 'Silkscreen, monospace' }}
        >
          🔥 {balanceLoading ? '...' : balance} {tokenSymbol}
        </div>
      )}

      {/* Wallet Button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isDisconnecting}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50"
      >
        {/* User Icon */}
        <div className="w-8 h-8 bg-[#FD7A10] rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        
        {/* Dropdown Arrow */}
        <svg 
          className={`w-3 h-3 text-white/60 ml-1 transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <div className="absolute right-0 top-12 w-72 min-w-[280px] rounded-md shadow-2xl bg-[#220808]/90 backdrop-blur-md border border-[#3a1a1a] overflow-hidden z-50">
          <div className="py-2">
            {/* Wallet Info */}
            <div className="px-3 py-2 text-white text-xs border-b border-[#3a1a1a]">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-sm" style={{ fontFamily: 'Silkscreen, monospace' }}>Connected Wallet</div>
                <button
                  onClick={copyAddress}
                  className="p-1 hover:bg-white/20 rounded transition-colors"
                  title="Copy wallet address"
                >
                  <svg className="w-3.5 h-3.5 text-white/70 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <div className="font-mono text-[11px] mt-1 break-all text-white/70">{address}</div>
            </div>

            {/* Network Selector */}
            <div className="px-3 py-3 border-b border-[#3a1a1a]">
              <label className="text-white text-sm font-medium mb-2 block" style={{ fontFamily: 'Silkscreen, monospace' }}>Network</label>
              <div className="relative">
                <select
                  value={selectedNetwork}
                  onChange={(e) => handleNetworkSwitch(e.target.value as NetworkType)}
                  disabled={isSwitching}
                  className="w-full appearance-none px-3 py-2.5 pr-10 bg-[#1a0505] border border-[#3a1a1a] rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#FD7A10] focus:border-[#FD7A10] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2a0808] hover:border-[#4a2a2a] transition-all cursor-pointer"
                  style={{ fontFamily: 'Silkscreen, monospace' }}
                >
                  <option value="base" className="bg-[#1a0505] text-white">Base Mainnet ({getTokenSymbol('base')})</option>
                  <option value="somnia_testnet" className="bg-[#1a0505] text-white">Somnia Testnet ({getTokenSymbol('somnia_testnet')})</option>
                </select>
                
                {/* Custom Dropdown Arrow */}
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              
              {/* Network Status */}
              <div className="flex items-center gap-2 mt-2.5 text-xs text-white/70">
                <div className={`w-2 h-2 rounded-full ${selectedNetwork === 'somnia_testnet' ? 'bg-purple-500' : 'bg-blue-500'} shadow-lg`} />
                <span className="font-medium">{getNetworkName(selectedNetwork)}</span>
                {isSwitching && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="animate-spin h-3 w-3 border-2 border-[#FD7A10] border-t-transparent rounded-full" />
                    <span className="text-xs text-white/70">Switching...</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Disconnect Button */}
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-white hover:bg-white/20 transition-all duration-200 flex items-center text-sm"
              style={{ fontFamily: 'Silkscreen, monospace' }}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                handleDisconnect()
                setShowDropdown(false)
              }}
            >
              <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Disconnect Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
