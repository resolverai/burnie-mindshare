import { useState, useEffect } from 'react'

interface YapperTwitterConnectionStatus {
  isConnected: boolean
  isLoading: boolean
  error: string | null
  twitterUsername?: string
  twitterDisplayName?: string
  profileImageUrl?: string
}

export function useYapperTwitterConnection(walletAddress?: string) {
  const [status, setStatus] = useState<YapperTwitterConnectionStatus>({
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
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${walletAddress}`
      )

      if (response.ok) {
        const data = await response.json()
        setStatus({
          isConnected: data.data?.connected || false,
          isLoading: false,
          error: null,
          twitterUsername: data.data?.twitter_username,
          twitterDisplayName: data.data?.twitter_display_name,
          profileImageUrl: data.data?.profile_image_url
        })
      } else {
        setStatus({
          isConnected: false,
          isLoading: false,
          error: null // Not connected is not an error
        })
      }
    } catch (error) {
      console.error('Failed to check Yapper Twitter connection:', error)
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