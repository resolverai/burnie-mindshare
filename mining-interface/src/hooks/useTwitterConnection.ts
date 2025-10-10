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
  
  // TEMPORARY: Skip Twitter for both regular and dedicated miners
  // TODO: Re-enable Twitter requirement for regular miners later
  const skipTwitter = true // Set to false to re-enable Twitter requirement
  
  // Debug logging
  console.log('🐦 useTwitterConnection Debug:', {
    NEXT_PUBLIC_MINER: process.env.NEXT_PUBLIC_MINER,
    isDedicatedMiner,
    skipTwitter,
    walletAddress
  })

  const [status, setStatus] = useState<TwitterConnectionStatus>({
    isConnected: skipTwitter ? true : (isDedicatedMiner ? true : false), // Skip Twitter for all miners temporarily
    isLoading: skipTwitter ? false : (isDedicatedMiner ? false : true),   // Skip loading when Twitter is bypassed
    error: null
  })

  const checkTwitterConnection = async () => {
    // TEMPORARY: Skip Twitter check for all miners when skipTwitter is true
    if (skipTwitter || isDedicatedMiner) {
      setStatus({
        isConnected: true, // Always "connected" when Twitter is skipped
        isLoading: false,
        error: null,
        twitterUsername: skipTwitter ? 'twitter-bypassed' : 'dedicated-miner' // Placeholder username
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