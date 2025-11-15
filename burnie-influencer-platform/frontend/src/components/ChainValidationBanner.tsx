'use client'

import React, { useState, useEffect } from 'react';
import { useChainValidation } from '../hooks/useChainValidation';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function ChainValidationBanner() {
  const { showChainError, currentChainId } = useChainValidation();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Don't render on server side to prevent hydration mismatch
  if (!isClient || !showChainError) {
    return null;
  }

  return (
    <div className="bg-red-600 text-white p-4 text-center">
      <div className="flex items-center justify-center gap-2">
        <ExclamationTriangleIcon className="h-5 w-5" />
        <span className="font-semibold">
          Wrong Network Detected
        </span>
      </div>
      <p className="text-sm mt-1">
        You're connected to Chain ID {currentChainId}. This platform supports Base Mainnet (Chain ID 8453) and Somnia Testnet (Chain ID 50312).
        Please switch to a supported network in your wallet to continue.
      </p>
    </div>
  );
}
