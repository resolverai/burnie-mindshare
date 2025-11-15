"use client";

import React from 'react';
import { useChainId } from 'wagmi';
import { useSomniaPurchase } from '@/hooks/useSomniaPurchase';
import { getTokenSymbol } from '@/config/somnia';

interface SomniaPurchaseButtonProps {
  contentId: number;
  price: string; // in TOAST tokens
  disabled?: boolean;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
  className?: string;
}

export function SomniaPurchaseButton({
  contentId,
  price,
  disabled = false,
  onSuccess,
  onError,
  className = '',
}: SomniaPurchaseButtonProps) {
  const chainId = useChainId();
  const { isLoading, step, txHash, purchaseWithPermit } = useSomniaPurchase();

  const isSomniaNetwork = chainId === 50312;

  const handlePurchase = () => {
    purchaseWithPermit({
      contentId,
      price,
      onSuccess,
      onError,
    });
  };

  const getButtonText = () => {
    if (!isSomniaNetwork) {
      return 'Switch to Somnia';
    }

    switch (step) {
      case 'signing':
        return 'Sign Approval...';
      case 'purchasing':
        return 'Purchasing...';
      case 'confirming':
        return 'Confirming...';
      case 'notifying':
        return 'Finalizing...';
      case 'complete':
        return 'Purchase Complete!';
      default:
        return `Purchase (${price} TOAST)`;
    }
  };

  const getButtonIcon = () => {
    if (isLoading) {
      return (
        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
      );
    }

    if (step === 'complete') {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      );
    }

    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Single Signature Info Banner */}
      {isSomniaNetwork && !isLoading && (
        <div className="bg-purple-900 bg-opacity-20 border border-purple-500 rounded-lg p-3 text-sm">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="font-semibold text-purple-300 mb-1">✨ Single Signature Purchase</p>
              <p className="text-gray-300">
                This purchase uses EIP-2612 permit for gasless approval. You'll only sign once!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={disabled || isLoading}
        className={`
          flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold
          transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
          ${
            step === 'complete'
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
          }
          text-white shadow-lg hover:shadow-xl transform hover:scale-105
          ${className}
        `}
      >
        {getButtonIcon()}
        <span>{getButtonText()}</span>
      </button>

      {/* Transaction Hash Link */}
      {txHash && isSomniaNetwork && (
        <a
          href={`${process.env.NEXT_PUBLIC_SOMNIA_EXPLORER_URL}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1 justify-center"
        >
          <span>View transaction</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}

