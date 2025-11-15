"use client";

import { useEffect } from 'react';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { getNetworkType, getTokenAddress, getTokenSymbol } from '@/config/somnia';

/**
 * Hook to get the current token balance (ROAST or TOAST) based on the active network
 * Automatically switches between ROAST (Base) and TOAST (Somnia)
 */
export function useTokenBalance() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  
  // Get network type directly from chainId (no state delay)
  const network = getNetworkType(chainId);
  const tokenAddress = getTokenAddress(network);
  const tokenSymbol = getTokenSymbol(network);

  // Immediate console log (runs on every render)
  console.log('[useTokenBalance] Hook called:', {
    chainId,
    network,
    tokenSymbol,
    tokenAddress,
    isConnected,
    hasAddress: !!address,
  });

  // Token balance (ROAST on Base or TOAST on Somnia)
  // Note: wagmi's useBalance will auto-refetch when address, token, or chainId changes
  const { 
    data: tokenBalance, 
    isLoading, 
    refetch 
  } = useBalance({
    address,
    token: tokenAddress as `0x${string}`,
    chainId,
  });

  // Refetch balance when network changes
  useEffect(() => {
    console.log('[useTokenBalance] Network updated:', {
      chainId,
      network,
      tokenSymbol,
      tokenAddress,
    });
    
    if (address && isConnected && tokenAddress) {
      console.log('[useTokenBalance] Network changed, refetching balance...');
      // Multiple retries with increasing delays to ensure network switch is complete
      setTimeout(() => refetch(), 300);
      setTimeout(() => refetch(), 800);
      setTimeout(() => refetch(), 1500);
    }
  }, [chainId, network, tokenAddress]);

  // Log balance updates
  useEffect(() => {
    if (tokenBalance) {
      console.log('[useTokenBalance] Balance updated:', {
        value: tokenBalance.value.toString(),
        symbol: tokenBalance.symbol,
        decimals: tokenBalance.decimals,
      });
    }
  }, [tokenBalance]);

  // Format balance with proper decimals
  const formatBalance = (value: bigint | undefined, decimals: number = 2): string => {
    if (!value) return '0';
    const formatted = parseFloat(formatEther(value));
    return formatted.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  return {
    balance: tokenBalance?.value ? formatBalance(tokenBalance.value, 2) : '0',
    rawBalance: tokenBalance?.value,
    isLoading,
    refetch,
    tokenSymbol,
    network,
    decimals: tokenBalance?.decimals || 18,
  };
}

