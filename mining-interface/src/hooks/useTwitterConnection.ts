import { useState, useEffect } from 'react'

interface TwitterConnectionStatus {
  isConnected: boolean
  isLoading: boolean
  error: string | null
  twitterUsername?: string
}

export function useTwitterConnection(walletAddress?: string) {
  const [status, setStatus] = useState<TwitterConnectionStatus>({
    isConnected: false,
    isLoading: true,
    error: null
  })

  const checkTwitterConnection = async () => {
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
  }, [walletAddress])

  return {
    ...status,
    refetch: checkTwitterConnection
  }
} 