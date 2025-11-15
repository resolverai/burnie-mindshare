"use client";

import { useState, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { getNetworkType, type NetworkType } from '@/config/somnia';

interface NetworkState {
  currentNetwork: NetworkType;
  isLoading: boolean;
  error: string | null;
  hasReceivedAirdrop: boolean;
}

interface AirdropStatus {
  hasReceived: boolean;
  airdrops: any[];
  airdropAmount: string;
}

export function useNetwork() {
  const { address } = useAccount();
  const chainId = useChainId();
  
  const [state, setState] = useState<NetworkState>({
    currentNetwork: 'base',
    isLoading: false,
    error: null,
    hasReceivedAirdrop: false,
  });

  // Update current network based on chain ID
  useEffect(() => {
    const networkType = getNetworkType(chainId);
    setState(prev => ({ ...prev, currentNetwork: networkType }));
  }, [chainId]);

  // Fetch airdrop status
  useEffect(() => {
    const fetchAirdropStatus = async () => {
      if (!address) return;

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/network/airdrop-status`,
          {
            headers: {
              'Authorization': `Bearer ${address}`,
            },
          }
        );

        if (response.ok) {
          const data: AirdropStatus = await response.json();
          setState(prev => ({
            ...prev,
            hasReceivedAirdrop: data.hasReceived,
          }));
        }
      } catch (error) {
        console.error('[useNetwork] Failed to fetch airdrop status:', error);
      }
    };

    fetchAirdropStatus();
  }, [address]);

  const getAirdropStatus = async (): Promise<AirdropStatus | null> => {
    if (!address) return null;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/network/airdrop-status`,
        {
          headers: {
            'Authorization': `Bearer ${address}`,
          },
        }
      );

      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('[useNetwork] Failed to fetch airdrop status:', error);
      return null;
    }
  };

  const claimAirdrop = async (walletAddress: string): Promise<{ success: boolean; error?: string; transactionHash?: string }> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/network/claim-airdrop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ walletAddress }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        setState(prev => ({ ...prev, hasReceivedAirdrop: true }));
        return { success: true, transactionHash: data.transactionHash };
      } else {
        return { success: false, error: data.error || 'Failed to claim airdrop' };
      }
    } catch (error: any) {
      console.error('[useNetwork] Failed to claim airdrop:', error);
      return { success: false, error: error.message || 'Failed to claim airdrop' };
    }
  };

  return {
    ...state,
    getAirdropStatus,
    claimAirdrop,
  };
}

