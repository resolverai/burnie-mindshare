'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UseWeb2AuthGuardReturn {
  isAuthenticated: boolean
  isLoading: boolean
  accountId: string | null
  token: string | null
}

export function useWeb2AuthGuard(): UseWeb2AuthGuardReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let isMounted = true

    const checkAuth = async () => {
      try {
        const web2Auth = localStorage.getItem('burnie_web2_auth')
        const web2AccountId = localStorage.getItem('burnie_web2_account_id')
        const web2Username = localStorage.getItem('burnie_web2_username')

        if (!web2Auth || !web2AccountId) {
          if (isMounted) {
            setIsAuthenticated(false)
            setIsLoading(false)
            router.push('/web2/auth')
          }
          return
        }

        // Verify session with backend
        try {
          const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
          const response = await fetch(`${apiUrl}/web2-auth/check-session?twitter_username=${encodeURIComponent(web2Username || '')}`)
          
          if (!isMounted) return

          if (response.ok) {
            const data = await response.json()
            if (data.success && data.hasValidSession) {
              if (isMounted) {
                setIsAuthenticated(true)
                setAccountId(web2AccountId)
                setToken(web2Auth)
                setIsLoading(false)
              }
              return
            }
          }
          
          // Invalid session, clear data
          if (isMounted) {
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            localStorage.removeItem('burnie_web2_username')
            setIsAuthenticated(false)
            setIsLoading(false)
            router.push('/web2/auth')
          }
        } catch (error) {
          console.error('Error checking session:', error)
          if (isMounted) {
            // Clear potentially corrupted auth data
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            localStorage.removeItem('burnie_web2_username')
            setIsAuthenticated(false)
            setIsLoading(false)
            router.push('/web2/auth')
          }
        }
      } catch (error) {
        console.error('Auth check error:', error)
        if (isMounted) {
          setIsAuthenticated(false)
          setIsLoading(false)
          router.push('/web2/auth')
        }
      }
    }

    checkAuth()

    return () => {
      isMounted = false
    }
  }, []) // Empty dependency array to run only once

  return {
    isAuthenticated,
    isLoading,
    accountId,
    token
  }
}
