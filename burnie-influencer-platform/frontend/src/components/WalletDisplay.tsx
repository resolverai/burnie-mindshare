'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { appKit } from '@/app/reown'
import toast from 'react-hot-toast'
import useMixpanel from '../hooks/useMixpanel'

interface WalletDisplayProps {
  className?: string
  showBalance?: boolean
  balance?: string | number
  balanceLoading?: boolean
}

export default function WalletDisplay({ 
  className = '', 
  showBalance = false, 
  balance, 
  balanceLoading = false 
}: WalletDisplayProps) {
  const { address, isConnected, isConnecting } = useAccount()
  const { disconnect, isPending: isDisconnecting } = useDisconnect()
  const mixpanel = useMixpanel()
  const [showDropdown, setShowDropdown] = useState(false)
  const [mounted, setMounted] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle SSR hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const truncateAddress = (address: string | undefined): string => {
    if (!address) return ""
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleConnect = () => {
    console.log("[AppKit] Connect button clicked")
    
    // Track wallet connect event
    console.log('🎯 Wallet connect clicked from header bar')
    mixpanel.walletConnectClicked({
      connectSource: 'headerBar',
      currentPage: typeof window !== 'undefined' ? window.location.pathname : '/',
      deviceType: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
      screenName: 'HeaderBar'
    })
    
    const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/"
    localStorage.setItem("wc_return_path", currentPath)
    appKit.open()
  }

  const handleDisconnect = async () => {
    try {
      // Track wallet disconnect event
      console.log('🎯 Wallet disconnect clicked from header bar')
      mixpanel.walletDisconnected({
        disconnectSource: 'headerBar',
        currentPage: typeof window !== 'undefined' ? window.location.pathname : '/',
        deviceType: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
        screenName: 'HeaderBar'
      })
      
      // Start redirect immediately, don't wait for disconnect to complete
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        console.log('🔄 Immediate redirect to homepage after wallet disconnect')
        setTimeout(() => {
          window.location.replace('/')
        }, 100)
      }
      
      await disconnect()
      toast.success("Wallet disconnected successfully")
      
      // Additional redirect attempts in case the first one didn't work
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Secondary redirect to homepage after wallet disconnect')
          window.location.replace('/')
        }
      }, 500)
      
      // Final backup redirect
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Final backup redirect to homepage after wallet disconnect')
          window.location.href = '/'
        }
      }, 1000)
    } catch {
      toast.error("Failed to disconnect wallet")
      // Even if disconnect fails, still redirect to homepage
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.location.replace('/')
      }
    }
  }

  const copyAddress = async () => {
    if (address) {
      try {
        await navigator.clipboard.writeText(address)
        toast.success("Wallet address copied!")
      } catch {
        toast.error("Failed to copy address")
      }
    }
  }

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <div className={`bg-[#FD7A10] text-white px-4 py-2 rounded-lg font-medium ${className}`}>
        Connect Wallet
      </div>
    )
  }

  if (!isConnected) {
    return (
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className={`bg-[#FD7A10] hover:bg-[#e55a0d] text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${className}`}
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    )
  }

  return (
    <div className={`relative flex items-center gap-2 ${className}`} ref={dropdownRef}>
      {/* Balance Badge */}
      {showBalance && (
        <div className="px-3 py-1 bg-white text-black rounded-full text-lg font-bold hidden md:flex items-center gap-1" style={{ fontFamily: 'Silkscreen, monospace' }}>
          🔥 {balanceLoading ? '...' : balance}
        </div>
      )}

      {/* Wallet Button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isDisconnecting}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50"
      >
        {/* User Icon */}
        <div className="w-8 h-8 bg-[#FD7A10] rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        
        {/* Dropdown Arrow */}
        <svg 
          className={`w-3 h-3 text-white/60 ml-1 transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <div className="absolute right-0 top-12 w-64 min-w-[200px] rounded-md shadow-2xl bg-[#220808]/90 backdrop-blur-md border border-[#3a1a1a] overflow-hidden z-50">
          <div className="py-2">
            {/* Wallet Info */}
            <div className="px-3 py-2 text-white/70 text-xs border-b border-[#3a1a1a]">
              <div className="flex items-center justify-between">
                <div className="font-medium">Connected Wallet</div>
                <button
                  onClick={copyAddress}
                  className="p-1 hover:bg-white/20 rounded transition-colors"
                  title="Copy wallet address"
                >
                  <svg className="w-3 h-3 text-white/60 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <div className="font-mono text-xs mt-1 break-all">{address}</div>
            </div>
            
            {/* Disconnect Button */}
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-white hover:bg-white/20 transition-all duration-200 flex items-center text-sm"
              style={{ fontFamily: 'Silkscreen, monospace' }}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                handleDisconnect()
                setShowDropdown(false)
              }}
            >
              <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Disconnect Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
