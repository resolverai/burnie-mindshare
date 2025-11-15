import { useAccount, useChainId } from 'wagmi';
import { useEffect, useState } from 'react';

const BASE_CHAIN_ID = 8453;
const SOMNIA_TESTNET_CHAIN_ID = 50312;

// Array of valid chain IDs
const VALID_CHAIN_IDS = [BASE_CHAIN_ID, SOMNIA_TESTNET_CHAIN_ID];

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
      const isValid = VALID_CHAIN_IDS.includes(chainId);
      setIsValidChain(isValid);
      setShowChainError(!isValid);
      
      if (!isValid) {
        console.error(`❌ Invalid chain detected: ${chainId}. Expected: ${BASE_CHAIN_ID} (Base) or ${SOMNIA_TESTNET_CHAIN_ID} (Somnia Testnet)`);
      } else {
        const networkName = chainId === BASE_CHAIN_ID ? 'Base' : 'Somnia Testnet';
        console.log(`✅ Valid chain detected: ${chainId} (${networkName})`);
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
    expectedChainId: BASE_CHAIN_ID, // Keep for backward compatibility
    isBaseNetwork: chainId === BASE_CHAIN_ID,
    isSomniaNetwork: chainId === SOMNIA_TESTNET_CHAIN_ID,
    validChainIds: VALID_CHAIN_IDS
  };
}
