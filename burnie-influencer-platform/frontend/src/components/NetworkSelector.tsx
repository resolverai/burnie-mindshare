"use client";

import React, { useState, useEffect } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { toast } from 'react-hot-toast';
import { getNetworkType, getChainIdFromNetwork, type NetworkType } from '@/config/somnia';

interface NetworkSelectorProps {
  className?: string;
}

export function NetworkSelector({ className = '' }: NetworkSelectorProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('base');
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Sync selected network with actual chain ID
  useEffect(() => {
    const networkType = getNetworkType(chainId);
    setSelectedNetwork(networkType);
  }, [chainId]);

  // Fetch user's saved network preference from backend and initialize record if needed
  useEffect(() => {
    const fetchCurrentNetwork = async () => {
      if (!address) return;
      
      try {
        console.log('[NetworkSelector] Fetching network preference for:', address);
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/network/current`, {
          headers: {
            'Authorization': `Bearer ${address}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('[NetworkSelector] User network preference:', data.currentNetwork);
          
          // If backend network differs from wallet network, update backend to match wallet
          const backendNetwork = data.currentNetwork as NetworkType;
          const walletNetwork = getNetworkType(chainId);
          
          if (backendNetwork !== walletNetwork) {
            console.log('[NetworkSelector] Syncing backend to match wallet network:', walletNetwork);
            
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
            });
          }
        } else if (response.status === 401) {
          console.warn('[NetworkSelector] User not authenticated, will create network record on first switch');
        }
      } catch (error) {
        console.error('[NetworkSelector] Failed to fetch network preference:', error);
      }
    };
    
    fetchCurrentNetwork();
  }, [address, chainId]);

  const handleNetworkSwitch = async (network: NetworkType) => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (isSwitching) return;

    setIsLoading(true);
    setIsSwitching(true);
    
    try {
      const targetChainId = getChainIdFromNetwork(network);
      
      // Step 1: Switch wallet network
      console.log(`[NetworkSelector] Switching to ${network} (Chain ID: ${targetChainId})`);
      
      await switchChain({ chainId: targetChainId });
      
      // Step 2: Update backend
      console.log('[NetworkSelector] Updating backend network preference');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/network/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          network,
          walletAddress: address,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update network preference');
      }
      
      const data = await response.json();
      console.log('[NetworkSelector] Backend response:', data);
      
      // Step 3: Show airdrop notification if applicable
      if (data.airdrop?.success) {
        toast.success(
          `🎁 Welcome to Somnia! Received ${data.airdrop.amount} TOAST tokens!`,
          { duration: 6000 }
        );
      }
      
      setSelectedNetwork(network);
      toast.success(`Switched to ${network === 'somnia_testnet' ? 'Somnia Testnet' : 'Base Mainnet'}`);
      
      // Step 4: Reload to refresh marketplace content
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      
    } catch (error: any) {
      console.error('[NetworkSelector] Failed to switch network:', error);
      
      if (error.message?.includes('User rejected')) {
        toast.error('Network switch cancelled');
      } else {
        toast.error(error.message || 'Failed to switch network');
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => setIsSwitching(false), 2000);
    }
  };

  const getNetworkBadgeColor = (network: NetworkType) => {
    return network === 'somnia_testnet' ? 'bg-purple-500' : 'bg-blue-500';
  };

  const getNetworkName = (network: NetworkType) => {
    return network === 'somnia_testnet' ? 'Somnia Testnet' : 'Base Mainnet';
  };

  const getTokenSymbol = (network: NetworkType) => {
    return network === 'somnia_testnet' ? 'TOAST' : 'ROAST';
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Network Selector Dropdown */}
      <div className="relative">
        <select
          value={selectedNetwork}
          onChange={(e) => handleNetworkSwitch(e.target.value as NetworkType)}
          disabled={isLoading || !address}
          className="appearance-none px-4 py-2 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-750 transition-colors cursor-pointer"
          style={{ minWidth: '180px' }}
        >
          <option value="base">Base ({getTokenSymbol('base')})</option>
          <option value="somnia_testnet">Somnia ({getTokenSymbol('somnia_testnet')})</option>
        </select>
        
        {/* Dropdown arrow */}
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
          <svg 
            className="w-4 h-4 text-gray-400" 
            fill="none" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth="2" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Loading Spinner */}
      {isLoading && (
        <div className="flex items-center gap-2">
          <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-xs text-gray-400">Switching...</span>
        </div>
      )}
      
      {/* Connection Status Indicator */}
      {!isLoading && (
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${address ? getNetworkBadgeColor(selectedNetwork) : 'bg-gray-500'}`} />
          <span className="text-xs text-gray-400 hidden sm:inline">
            {address ? getNetworkName(selectedNetwork) : 'Not Connected'}
          </span>
        </div>
      )}
    </div>
  );
}

