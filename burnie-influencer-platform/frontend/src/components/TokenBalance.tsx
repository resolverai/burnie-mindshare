"use client";

import React, { useEffect, useState } from 'react';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { getNetworkType, getTokenAddress, getTokenSymbol } from '@/config/somnia';

interface TokenBalanceProps {
  className?: string;
  showNativeBalance?: boolean;
}

export function TokenBalance({ className = '', showNativeBalance = true }: TokenBalanceProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const [network, setNetwork] = useState<'base' | 'somnia_testnet'>('base');

  // Update network when chain changes
  useEffect(() => {
    const networkType = getNetworkType(chainId);
    setNetwork(networkType);
  }, [chainId]);

  const tokenAddress = getTokenAddress(network);
  const tokenSymbol = getTokenSymbol(network);

  // Token balance (ROAST/TOAST)
  const { data: tokenBalance, isLoading: isLoadingToken, refetch: refetchToken } = useBalance({
    address,
    token: tokenAddress as `0x${string}`,
    chainId,
  });

  // Native currency balance (ETH/STT)
  const { data: nativeBalance, isLoading: isLoadingNative } = useBalance({
    address,
    chainId,
  });

  // Auto-refetch token balance every 10 seconds
  useEffect(() => {
    if (!address) return;
    
    const interval = setInterval(() => {
      refetchToken();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [address, refetchToken]);

  if (!address) {
    return null;
  }

  const formatBalance = (value: bigint | undefined, decimals: number = 2): string => {
    if (!value) return '0';
    const formatted = parseFloat(formatEther(value));
    return formatted.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  return (
    <div className={`flex flex-col gap-2 p-4 bg-gray-800 rounded-lg border border-gray-700 ${className}`}>
      {/* Token Balance (ROAST/TOAST) */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${network === 'somnia_testnet' ? 'bg-purple-500' : 'bg-blue-500'}`} />
          <span className="text-gray-400 text-sm font-medium">{tokenSymbol}:</span>
        </div>
        <div className="flex items-center gap-2">
          {isLoadingToken ? (
            <div className="animate-pulse h-5 w-20 bg-gray-700 rounded" />
          ) : (
            <span className="text-white font-semibold text-lg">
              {formatBalance(tokenBalance?.value, 2)}
            </span>
          )}
          <button
            onClick={() => refetchToken()}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh balance"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Native Currency Balance (ETH/STT) - Optional */}
      {showNativeBalance && (
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-700">
          <span className="text-gray-500 text-xs">
            {nativeBalance?.symbol || 'Native'}:
          </span>
          <span className="text-gray-400 text-sm">
            {isLoadingNative ? (
              <div className="animate-pulse h-4 w-16 bg-gray-700 rounded" />
            ) : (
              formatBalance(nativeBalance?.value, 4)
            )}
          </span>
        </div>
      )}

      {/* Network Badge */}
      <div className="pt-2 border-t border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {network === 'somnia_testnet' ? 'Somnia Testnet' : 'Base Mainnet'}
        </span>
        {network === 'somnia_testnet' && (
          <span className="px-2 py-0.5 bg-purple-900 bg-opacity-30 border border-purple-500 rounded text-xs text-purple-300">
            On-Chain
          </span>
        )}
      </div>
    </div>
  );
}

