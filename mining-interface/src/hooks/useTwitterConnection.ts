import { useState, useEffect } from 'react'

interface TwitterConnectionStatus {
  isConnected: boolean
  isLoading: boolean
  error: string | null
  twitterUsername?: string
}

export function useTwitterConnection(walletAddress?: string) {
  // Check if we're in dedicated miner mode
  const isDedicatedMiner = process.env.NEXT_PUBLIC_MINER === '1'
  
  // Debug logging
  console.log('🐦 useTwitterConnection Debug:', {
    NEXT_PUBLIC_MINER: process.env.NEXT_PUBLIC_MINER,
    isDedicatedMiner,
    walletAddress
  })

  const [status, setStatus] = useState<TwitterConnectionStatus>({
    isConnected: isDedicatedMiner ? true : false, // Dedicated miners don't need Twitter
    isLoading: isDedicatedMiner ? false : true,   // Skip loading for dedicated miners
    error: null
  })

  const checkTwitterConnection = async () => {
    // Skip Twitter check for dedicated miners
    if (isDedicatedMiner) {
      setStatus({
        isConnected: true, // Always "connected" for dedicated miners
        isLoading: false,
        error: null,
        twitterUsername: 'dedicated-miner' // Placeholder username
      })
      return
    }

    if (!walletAddress) {
      setStatus({
        isConnected: false,
        isLoading: false,
        error: null
      })
      return
    }

    try {
      setStatus(prev => ({ ...prev, isLoading: true, error: null }))

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL}/twitter-auth/twitter/status/${walletAddress}`
      )

      if (response.ok) {
        const data = await response.json()
        setStatus({
          isConnected: data.data?.connected || false,
          isLoading: false,
          error: null,
          twitterUsername: data.data?.twitter_username
        })
      } else {
        setStatus({
          isConnected: false,
          isLoading: false,
          error: null // Not connected is not an error
        })
      }
    } catch (error) {
      console.error('Failed to check Twitter connection:', error)
      setStatus({
        isConnected: false,
        isLoading: false,
        error: 'Failed to check Twitter connection'
      })
    }
  }

  useEffect(() => {
    checkTwitterConnection()
  }, [walletAddress, isDedicatedMiner])

  return {
    ...status,
    refetch: checkTwitterConnection
  }
} 