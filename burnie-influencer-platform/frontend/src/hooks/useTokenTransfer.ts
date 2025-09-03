"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import toast from "react-hot-toast";

// Enhanced ERC20 ABI for better wallet compatibility
export const ERC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

// Token contract address from environment
export const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN as `0x${string}`;

// Recipient wallet address from environment
export const RECIPIENT_WALLET = process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS as `0x${string}`;

// Transfer amount (1 token with 18 decimals)
export const TRANSFER_AMOUNT = parseEther("1");

// Token metadata for better wallet recognition
export const TOKEN_METADATA = {
  name: "ROAST",
  symbol: "ROAST", 
  decimals: 18,
  address: TOKEN_CONTRACT,
  // Add common token info that wallets can recognize
  logoURI: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004"}/roast-token.png`,
} as const;

export interface TransferResult {
  success: boolean;
  hash?: string;
  error?: string;
}

export function useTokenTransfer() {
  const [isTransferring, setIsTransferring] = useState(false);
  const [hasShownSuccess, setHasShownSuccess] = useState(false);
  const { address } = useAccount();
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  // Track if we've already shown success toast for this transaction
  const lastHashRef = useRef<string | undefined>(undefined);

  const transferToken = async (): Promise<TransferResult> => {
    if (!address) {
      toast.error("Please connect your wallet first");
      return { success: false, error: "Wallet not connected" };
    }

    setIsTransferring(true);
    setHasShownSuccess(false);
    
    try {
      console.log("[Token Transfer] Starting transfer...");
      console.log("[Token Transfer] From:", address);
      console.log("[Token Transfer] To:", RECIPIENT_WALLET);
      console.log("[Token Transfer] Amount:", TRANSFER_AMOUNT.toString());
      console.log("[Token Transfer] Token:", TOKEN_CONTRACT);

      writeContract({
        address: TOKEN_CONTRACT,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [RECIPIENT_WALLET, TRANSFER_AMOUNT],
      });

      toast.success("Transaction submitted! Waiting for confirmation...");
      
      return { success: true, hash: hash };
    } catch (err) {
      console.error("[Token Transfer] Error:", err);
      const errorMessage = err instanceof Error ? err.message : "Transfer failed";
      toast.error(`Transfer failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    } finally {
      setIsTransferring(false);
    }
  };

  // Handle success toast only once per transaction
  useEffect(() => {
    if (isConfirmed && hash && hash !== lastHashRef.current && !hasShownSuccess) {
      toast.success("Token transfer successful!");
      console.log("[Token Transfer] Transaction confirmed:", hash);
      setHasShownSuccess(true);
      lastHashRef.current = hash;
    }
  }, [isConfirmed, hash, hasShownSuccess]);

  // Handle error toast
  useEffect(() => {
    if (error && !hasShownSuccess) {
      toast.error(`Transfer failed: ${error.message}`);
      console.error("[Token Transfer] Transaction error:", error);
    }
  }, [error, hasShownSuccess]);

  // Function to add token to wallet
  const addTokenToWallet = async () => {
    if (!window.ethereum) {
      toast.error("Wallet not found");
      return;
    }

    try {
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: TOKEN_CONTRACT,
            symbol: TOKEN_METADATA.symbol,
            decimals: TOKEN_METADATA.decimals,
            image: TOKEN_METADATA.logoURI,
          },
        },
      });
      toast.success("Token added to wallet!");
    } catch (error) {
      console.error("Error adding token:", error);
      toast.error("Failed to add token to wallet");
    }
  };

  return {
    transferToken,
    addTokenToWallet,
    isTransferring: isTransferring || isPending || isConfirming,
    isConfirmed,
    hash,
    error,
  };
}
