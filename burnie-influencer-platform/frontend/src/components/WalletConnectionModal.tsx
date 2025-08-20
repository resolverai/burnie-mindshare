'use client'

import React from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { XMarkIcon, WalletIcon } from '@heroicons/react/24/outline'

interface WalletConnectionModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message?: string
}

export default function WalletConnectionModal({
  isOpen,
  onClose,
  title = "Connect Your Wallet",
  message = "Please connect your wallet to purchase content"
}: WalletConnectionModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-yapper-surface border border-yapper rounded-2xl p-8 mx-4 max-w-md w-full shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-white/60 hover:text-white transition-colors"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mb-6">
            <WalletIcon className="w-8 h-8 text-orange-500" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-white mb-4">
            {title}
          </h2>

          {/* Message */}
          <p className="text-white/70 mb-8 leading-relaxed">
            {message}
          </p>

          {/* Connect Button */}
          <div className="flex justify-center">
            <ConnectButton 
              showBalance={false}
              chainStatus="none"
              accountStatus="avatar"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
