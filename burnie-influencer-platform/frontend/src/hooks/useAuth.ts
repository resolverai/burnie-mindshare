import { useState, useEffect, useCallback } from 'react'
import { useAccount, useSignMessage, useDisconnect } from 'wagmi'

interface AuthUser {
  address: string
  signature: string
  timestamp: string
  chainId: number
}

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  needsSignature: boolean
  user: AuthUser | null
  error: string | null
}

export function useAuth() {
  const { address, isConnected, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()

  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true, // Start with loading to prevent flash
    needsSignature: false,
    user: null,
    error: null
  })

  const [mounted, setMounted] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [userExplicitlyDisconnected, setUserExplicitlyDisconnected] = useState(false)

  // Initialize authentication state on mount
  useEffect(() => {
    const initializeAuth = () => {
      try {
        // Only access localStorage on client side
        if (typeof window === 'undefined') {
          setAuthState({
            isAuthenticated: false,
            isLoading: false,
            user: null,
            needsSignature: false,
            error: null
          })
          setMounted(true)
          return
        }

        // Check localStorage for existing authentication to maintain session
        const storedAuth = localStorage.getItem('burnie_yapper_auth_user')
        const storedToken = localStorage.getItem('burnie_yapper_auth_token')
        
        if (storedAuth && storedToken) {
          const user = JSON.parse(storedAuth)
          console.log('✅ Restored authentication from localStorage for:', user.address)
          
          setAuthState({
            isAuthenticated: true,
            isLoading: false,
            user,
            needsSignature: false,
            error: null
          })
          setMounted(true)
          return
        }
        
        // No stored authentication
        console.log('🔐 No stored authentication found')
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          needsSignature: false,
          error: null
        })
        setMounted(true)
        
      } catch (error) {
        console.error('❌ Error initializing auth:', error)
        // Clear corrupted data (only on client side)
        if (typeof window !== 'undefined') {
          localStorage.removeItem('burnie_yapper_auth_user')
          localStorage.removeItem('burnie_yapper_auth_token')
          localStorage.removeItem('burnie_yapper_auth_signature')
        }
        
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          needsSignature: false,
          error: null
        })
        setMounted(true)
      }
    }

    initializeAuth()
  }, [])

  const handleSignIn = useCallback(async () => {
    if (!address || !chainId || !isConnected) {
      setAuthState(prev => ({ ...prev, error: 'Wallet not connected' }))
      return false
    }

    // Clear disconnect flag when user explicitly signs in
    setUserExplicitlyDisconnected(false)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('burnie_user_disconnected')
    }

    setAuthState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const message = `Welcome to Burnie - Yapper Platform!

Please sign this message to authenticate your wallet.

Wallet: ${address}
Chain ID: ${chainId}
Timestamp: ${new Date().toISOString()}

This signature proves you own this wallet.`

      const signature = await signMessageAsync({ message })

      const user: AuthUser = {
        address: address.toLowerCase(),
        signature,
        timestamp: new Date().toISOString(),
        chainId
      }

      // Store authentication (only on client side)
      if (typeof window !== 'undefined') {
        localStorage.setItem('burnie_yapper_auth_user', JSON.stringify(user))
        localStorage.setItem('burnie_yapper_auth_token', signature)
        localStorage.setItem('burnie_yapper_auth_signature', signature)
      }

      setAuthState({
        isAuthenticated: true,
        isLoading: false,
        needsSignature: false,
        user,
        error: null
      })

      console.log('✅ Authentication successful for:', address)
      return true

    } catch (error: any) {
      console.error('❌ Authentication failed:', error)

      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        needsSignature: true,
        user: null,
        error: error.message || 'Authentication failed'
      })

      // If user rejected, disconnect wallet
      if (error.message?.includes('rejected') || error.name === 'UserRejectedRequestError') {
        disconnect()
      }

      return false
    }
  }, [address, chainId, isConnected, signMessageAsync, disconnect])

  // Handle wallet changes (only after component is mounted)
  useEffect(() => {
    if (!mounted) return // Don't run until after initial mount
    
    console.log('🔍 Wallet state change:', { isConnected, address, mounted })
    
    if (!isConnected || !address) {
      // Wallet disconnected - clear authentication completely
      console.log('🔄 Wallet disconnected, clearing all authentication state')
      
      // Mark that user has explicitly disconnected
      setUserExplicitlyDisconnected(true)
      setIsDisconnecting(true)
      
      // Clear ALL localStorage related to auth (only on client side)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('burnie_yapper_auth_user')
        localStorage.removeItem('burnie_yapper_auth_token')
        localStorage.removeItem('burnie_yapper_auth_signature')
        
        // Store the explicit disconnect flag with timestamp to automatically clear it
        localStorage.setItem('burnie_user_disconnected', Date.now().toString())
        
        // Clear any other potential auth-related storage
        Object.keys(localStorage).forEach(key => {
          if (key.includes('burnie') && key !== 'burnie_user_disconnected' && (key.includes('auth') || key.includes('signature'))) {
            localStorage.removeItem(key)
          }
        })
      }
      
      // Clear auth state completely - NEVER set needsSignature on disconnect
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        needsSignature: false, // Critical: NEVER prompt on disconnect
        error: null
      })
      
      // Clear disconnecting flag after a delay to prevent immediate reconnection
      setTimeout(() => {
        setIsDisconnecting(false)
      }, 1000) // Increased to 1 second for more robust protection
      
      return
    }

    // Wallet connected - add small delay to prevent rapid disconnect/reconnect issues
    const timeoutId = setTimeout(() => {
      // Don't authenticate if we're in the middle of a disconnect process
      if (isDisconnecting) {
        console.log('🚫 Ignoring wallet connection during disconnect process')
        return
      }
      
      // Check if this is a brief reconnection during recent disconnect (within 2 seconds)
      if (typeof window !== 'undefined') {
        const userDisconnectedTime = localStorage.getItem('burnie_user_disconnected')
        if (userDisconnectedTime) {
          const disconnectTime = parseInt(userDisconnectedTime)
          const timeSinceDisconnect = Date.now() - disconnectTime
          
          // Only block for 2 seconds after disconnect
          if (timeSinceDisconnect < 2000) {
            console.log('🚫 Ignoring brief reconnection during recent disconnect process')
            // Set the state to show that wallet is connected but not authenticated
            setAuthState(prev => ({
              ...prev,
              isAuthenticated: false,
              user: null,
              needsSignature: false, // Don't auto-prompt during recent disconnect
              error: null,
              isLoading: false
            }))
            return
          } else {
            // Clear old disconnect flag if more than 2 seconds have passed
            localStorage.removeItem('burnie_user_disconnected')
          }
        }
      }
      
      // Clear the explicit disconnection flag since user is connecting (not during disconnect)
      setUserExplicitlyDisconnected(false)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('burnie_user_disconnected')
      }
      
      console.log('🔐 Wallet connected (after debounce), checking authentication status')
      
      // Check if user is already authenticated with this wallet
      if (typeof window !== 'undefined') {
        const storedAuth = localStorage.getItem('burnie_yapper_auth_user')
        if (storedAuth) {
          try {
            const user = JSON.parse(storedAuth)
            if (user.address === address.toLowerCase()) {
              // User is already authenticated with this wallet - don't require signature again
              console.log('✅ User already authenticated with this wallet, maintaining session')
              setAuthState(prev => ({
                ...prev,
                isAuthenticated: true,
                user,
                needsSignature: false,
                error: null,
                isLoading: false
              }))
              return
            }
          } catch (error) {
            console.error('Error parsing stored auth:', error)
          }
        }
      }
      
      // No valid authentication found - require signature for new session
      console.log('🔍 No valid authentication found, requiring signature for new session with address:', address)
      
      // Clear any old/invalid auth data
      if (typeof window !== 'undefined') {
        localStorage.removeItem('burnie_yapper_auth_user')
        localStorage.removeItem('burnie_yapper_auth_token')
        localStorage.removeItem('burnie_yapper_auth_signature')
      }
      
      // Require signature for new session
      setAuthState(prev => ({
        ...prev,
        isAuthenticated: false,
        user: null,
        needsSignature: true,
        error: null,
        isLoading: false
      }))
    }, 100) // Small delay to prevent rapid fire state changes

    return () => clearTimeout(timeoutId)
  }, [isConnected, address, mounted, isDisconnecting])

  const logout = useCallback(() => {
    console.log('🚪 Logging out user and clearing all state')
    
    // Set disconnecting flag to prevent re-authentication during logout
    setIsDisconnecting(true)
    
    // Clear ALL localStorage related to auth (only on client side)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('burnie_yapper_auth_user')
      localStorage.removeItem('burnie_yapper_auth_token')
      localStorage.removeItem('burnie_yapper_auth_signature')
      
      // Clear any other potential auth-related storage including Twitter
      Object.keys(localStorage).forEach(key => {
        if (key.includes('burnie') || key.includes('auth') || key.includes('signature') || key.includes('yapper_twitter')) {
          localStorage.removeItem(key)
        }
      })
    }
    
    // Clear auth state completely - this will require signature on next connection
    setAuthState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      needsSignature: false, // Will be set to true when wallet reconnects
      error: null
    })

    // Disconnect wallet last to trigger cleanup
    disconnect()
    
    // Clear disconnecting flag after logout process
    setTimeout(() => {
      setIsDisconnecting(false)
    }, 500)
  }, [disconnect])

  const clearError = useCallback(() => {
    setAuthState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    user: authState.user,
    address: authState.user?.address || address,
    needsSignature: authState.needsSignature,
    error: authState.error,
    signIn: handleSignIn,
    logout,
    clearError
  }
} 