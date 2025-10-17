import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Web2User {
  id: string
  account_id: string
  email: string
  full_name: string
  twitter_username: string
  role: string
}

interface Web2AuthData {
  token: string
  user: Web2User
  expires_at: number
}

interface UseWeb2AuthReturn {
  isAuthenticated: boolean
  isLoading: boolean
  user: Web2User | null
  token: string | null
  login: (authData: Web2AuthData) => void
  logout: () => void
  refreshAuth: () => Promise<void>
}

export function useWeb2Auth(): UseWeb2AuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<Web2User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const authDataStr = localStorage.getItem('burnie_web2_auth')
      if (!authDataStr) {
        setIsAuthenticated(false)
        setIsLoading(false)
        return
      }

      const authData: Web2AuthData = JSON.parse(authDataStr)
      
      // Check if token is expired
      if (Date.now() >= authData.expires_at) {
        console.log('Token expired, logging out')
        logout()
        return
      }

      // Verify token with backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-auth/me`, {
        headers: {
          'Authorization': `Bearer ${authData.token}`
        }
      })

      if (!response.ok) {
        console.log('Token invalid, logging out')
        logout()
        return
      }

      const data = await response.json()
      setUser(data.data.user)
      setToken(authData.token)
      setIsAuthenticated(true)
    } catch (error) {
      console.error('Auth check error:', error)
      logout()
    } finally {
      setIsLoading(false)
    }
  }

  const login = (authData: Web2AuthData) => {
    localStorage.setItem('burnie_web2_auth', JSON.stringify(authData))
    setUser(authData.user)
    setToken(authData.token)
    setIsAuthenticated(true)
  }

  const logout = () => {
    localStorage.removeItem('burnie_web2_auth')
    localStorage.removeItem('burnie_user_flow')
    setUser(null)
    setToken(null)
    setIsAuthenticated(false)
    router.push('/')
  }

  const refreshAuth = async () => {
    try {
      const authDataStr = localStorage.getItem('burnie_web2_auth')
      if (!authDataStr) return

      const authData: Web2AuthData = JSON.parse(authDataStr)
      
      // Get refresh token from user data (if available)
      // For now, just re-check auth
      await checkAuth()
    } catch (error) {
      console.error('Refresh auth error:', error)
      logout()
    }
  }

  return {
    isAuthenticated,
    isLoading,
    user,
    token,
    login,
    logout,
    refreshAuth
  }
}

