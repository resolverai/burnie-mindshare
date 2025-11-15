"use client";

import { useState } from 'react';
import { useAccount, useChainId, useSignTypedData, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { toast } from 'react-hot-toast';
import TOASTTokenABI from '@/contracts/TOASTToken.json';
import ContentRegistryABI from '@/contracts/ContentRegistry.json';

interface PurchaseWithPermitParams {
  contentId: number;
  price: string; // in TOAST tokens (e.g., "100")
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

interface PurchaseState {
  isLoading: boolean;
  step: 'idle' | 'signing' | 'purchasing' | 'confirming' | 'notifying' | 'complete';
  error: string | null;
  txHash: string | null;
}

export function useSomniaPurchase() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [state, setState] = useState<PurchaseState>({
    isLoading: false,
    step: 'idle',
    error: null,
    txHash: null,
  });

  const toastTokenAddress = process.env.NEXT_PUBLIC_TOAST_TOKEN_ADDRESS as Address;
  const contentRegistryAddress = process.env.NEXT_PUBLIC_CONTENT_REGISTRY_ADDRESS as Address;

  // Read nonce for permit
  const { data: nonce } = useReadContract({
    address: toastTokenAddress,
    abi: TOASTTokenABI.abi,
    functionName: 'nonces',
    args: address ? [address] : undefined,
    chainId: 50312, // Somnia Testnet
  });

  const purchaseWithPermit = async ({
    contentId,
    price,
    onSuccess,
    onError,
  }: PurchaseWithPermitParams) => {
    if (!address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (chainId !== 50312) {
      toast.error('Please switch to Somnia Testnet');
      return;
    }

    setState({ isLoading: true, step: 'signing', error: null, txHash: null });

    try {
      const priceInWei = parseEther(price);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

      // Step 1: Sign EIP-2612 permit (gasless approval)
      console.log('[useSomniaPurchase] Signing permit...');
      toast.loading('Please sign the approval...', { id: 'purchase' });

      const domain = {
        name: 'TOAST Token',
        version: '2.0.0',
        chainId: 50312,
        verifyingContract: toastTokenAddress,
      };

      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };

      const message = {
        owner: address,
        spender: contentRegistryAddress,
        value: priceInWei,
        nonce: nonce || BigInt(0),
        deadline,
      };

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: 'Permit',
        message,
      });

      // Split signature
      const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
      const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
      const v = parseInt(signature.slice(130, 132), 16);

      console.log('[useSomniaPurchase] Permit signed successfully');

      // Step 2: Execute purchase with permit
      setState(prev => ({ ...prev, step: 'purchasing' }));
      toast.loading('Purchasing content...', { id: 'purchase' });

      const txHash = await writeContractAsync({
        address: contentRegistryAddress,
        abi: ContentRegistryABI.abi,
        functionName: 'purchaseContentWithPermit',
        args: [BigInt(contentId), deadline, v, r, s],
        chainId: 50312,
      });

      console.log('[useSomniaPurchase] Transaction sent:', txHash);
      setState(prev => ({ ...prev, step: 'confirming', txHash }));
      toast.loading('Confirming transaction...', { id: 'purchase' });

      // Step 3: Wait for confirmation (using polling since we can't use useWaitForTransactionReceipt in hook)
      await waitForTransaction(txHash);

      console.log('[useSomniaPurchase] Transaction confirmed');
      setState(prev => ({ ...prev, step: 'notifying' }));

      // Step 4: Notify backend
      await notifyBackend(contentId, address, price, txHash);

      setState(prev => ({ ...prev, step: 'complete', isLoading: false }));
      toast.success('Content purchased successfully!', { id: 'purchase' });

      if (onSuccess) {
        onSuccess(txHash);
      }

    } catch (error: any) {
      console.error('[useSomniaPurchase] Purchase failed:', error);
      
      let errorMessage = 'Purchase failed';
      if (error.message?.includes('User rejected') || error.message?.includes('User denied')) {
        errorMessage = 'Transaction cancelled';
      } else if (error.message) {
        errorMessage = error.message.length > 100 ? 'Transaction failed' : error.message;
      }

      setState({
        isLoading: false,
        step: 'idle',
        error: errorMessage,
        txHash: null,
      });

      toast.error(errorMessage, { id: 'purchase' });

      if (onError) {
        onError(error);
      }
    }
  };

  const waitForTransaction = async (txHash: string): Promise<void> => {
    const maxAttempts = 30;
    const pollInterval = 2000; // 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL}/api/v2/transactions/${txHash}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'ok' || data.result?.status === '1') {
            return; // Transaction confirmed
          }
        }
      } catch (error) {
        console.log('[useSomniaPurchase] Polling transaction...', i + 1);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Transaction confirmation timeout');
  };

  const notifyBackend = async (
    contentId: number,
    buyerAddress: string,
    price: string,
    txHash: string
  ): Promise<void> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/marketplace/purchase`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contentId,
            buyerWalletAddress: buyerAddress,
            purchasePrice: price,
            currency: 'TOAST',
            transactionHash: txHash,
            network: 'somnia_testnet',
          }),
        }
      );

      if (!response.ok) {
        console.error('[useSomniaPurchase] Failed to notify backend:', await response.text());
        // Don't throw - purchase was successful on-chain
      }
    } catch (error) {
      console.error('[useSomniaPurchase] Backend notification error:', error);
      // Don't throw - purchase was successful on-chain
    }
  };

  return {
    ...state,
    purchaseWithPermit,
    reset: () => setState({
      isLoading: false,
      step: 'idle',
      error: null,
      txHash: null,
    }),
  };
}

