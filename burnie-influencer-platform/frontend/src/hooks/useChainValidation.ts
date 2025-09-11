import { useAccount, useChainId } from 'wagmi';
import { useEffect, useState } from 'react';

const BASE_CHAIN_ID = 8453;

export function useChainValidation() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [isValidChain, setIsValidChain] = useState(true);
  const [showChainError, setShowChainError] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Ensure this only runs on client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    // Only run validation on client side
    if (!isClient) return;

    if (isConnected) {
      const isValid = chainId === BASE_CHAIN_ID;
      setIsValidChain(isValid);
      setShowChainError(!isValid);
      
      if (!isValid) {
        console.error(`❌ Invalid chain detected: ${chainId}. Expected: ${BASE_CHAIN_ID} (Base)`);
      } else {
        console.log(`✅ Valid chain detected: ${chainId} (Base)`);
      }
    } else {
      setIsValidChain(true);
      setShowChainError(false);
    }
  }, [isConnected, chainId, isClient]);

  return {
    isValidChain,
    showChainError,
    currentChainId: chainId,
    expectedChainId: BASE_CHAIN_ID,
    isBaseNetwork: chainId === BASE_CHAIN_ID
  };
}
