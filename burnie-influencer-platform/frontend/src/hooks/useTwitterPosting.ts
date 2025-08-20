import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'

interface TwitterPostingStatus {
  connected: boolean
  username?: string
  displayName?: string
  profileImage?: string
  tokenExpired: boolean
  requiresAuth: boolean
  loading: boolean
  error?: string
}

export const useTwitterPosting = () => {
  const { address } = useAccount()
  const [status, setStatus] = useState<TwitterPostingStatus>({
    connected: false,
    tokenExpired: false,
    requiresAuth: true,
    loading: true
  })

  const checkTwitterStatus = async () => {
    if (!address) {
      setStatus({
        connected: false,
        tokenExpired: false,
        requiresAuth: true,
        loading: false
      })
      return
    }

    try {
      setStatus(prev => ({ ...prev, loading: true, error: undefined }))

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/twitter/status`, {
        headers: {
          'Authorization': `Bearer ${address}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setStatus({
          connected: data.connected,
          username: data.username,
          displayName: data.displayName,
          profileImage: data.profileImage,
          tokenExpired: data.tokenExpired || false,
          requiresAuth: data.requiresAuth || false,
          loading: false
        })
      } else {
        setStatus({
          connected: false,
          tokenExpired: false,
          requiresAuth: true,
          loading: false,
          error: data.error
        })
      }
    } catch (error) {
      console.error('Error checking Twitter status:', error)
      setStatus({
        connected: false,
        tokenExpired: false,
        requiresAuth: true,
        loading: false,
        error: 'Failed to check Twitter status'
      })
    }
  }

  useEffect(() => {
    checkTwitterStatus()
  }, [address])

  return {
    status,
    refresh: checkTwitterStatus
  }
}
