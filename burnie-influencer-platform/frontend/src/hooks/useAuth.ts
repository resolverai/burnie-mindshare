import { useState, useEffect, useCallback } from 'react'
import { useAccount, useSignMessage, useDisconnect } from 'wagmi'
import { useRouter } from 'next/navigation'
import { usePageVisibility } from './usePageVisibility'

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
  const router = useRouter()
  const { returnedFromBackground } = usePageVisibility()

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
  const [isRecoveringFromMobile, setIsRecoveringFromMobile] = useState(false)

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

  // Mobile-specific: Handle return from wallet app
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return

    // Only run mobile recovery on mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     window.innerWidth < 768

    if (!isMobile) {
      console.log('🖥️ Desktop detected - skipping mobile wallet recovery logic')
      return
    }

    const handleMobileWalletReturn = async () => {
      const returnPath = localStorage.getItem('wc_return_path')
      const walletConnectionTimestamp = localStorage.getItem('wc_connection_timestamp')
      const now = Date.now()
      
      // Check if user recently initiated wallet connection (within last 5 minutes)
      const isRecentConnection = walletConnectionTimestamp && 
        (now - parseInt(walletConnectionTimestamp)) < 5 * 60 * 1000

      console.log('📱 Mobile wallet return check:', {
        returnPath: !!returnPath,
        isConnected,
        isAuthenticated: authState.isAuthenticated,
        isRecentConnection,
        address: !!address,
        needsSignature: authState.needsSignature,
        isMobile
      })

      // If user has return path, wallet is connected, but not authenticated
      // AND it's a recent connection attempt, trigger recovery
      if (returnPath && isConnected && !authState.isAuthenticated && isRecentConnection && address && !isRecoveringFromMobile) {
        console.log('📱 Detected mobile wallet return - attempting authentication recovery')
        setIsRecoveringFromMobile(true)
        
        try {
          // Small delay to ensure wallet state is fully synced
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Check if user is already authenticated with this wallet (race condition fix)
          const storedAuth = localStorage.getItem('burnie_yapper_auth_user')
          if (storedAuth) {
            const user = JSON.parse(storedAuth)
            if (user.address === address.toLowerCase()) {
              console.log('✅ Found existing auth during mobile recovery')
              setAuthState(prev => ({
                ...prev,
                isAuthenticated: true,
                user,
                needsSignature: false,
                error: null,
                isLoading: false
              }))
              
              // Redirect to return path
              setTimeout(() => {
                if (returnPath !== window.location.pathname) {
                  console.log('🔄 Redirecting to return path:', returnPath)
                  window.location.href = returnPath
                }
                localStorage.removeItem('wc_return_path')
                localStorage.removeItem('wc_connection_timestamp')
              }, 500)
              
              setIsRecoveringFromMobile(false)
              return
            }
          }
          
          // If no existing auth, trigger signature
          console.log('🔐 Triggering signature for mobile recovery')
          const success = await handleSignIn()
          
          if (success) {
            console.log('✅ Mobile authentication recovery successful')
            // Redirect to return path after successful authentication
            setTimeout(() => {
              if (returnPath !== window.location.pathname) {
                console.log('🔄 Redirecting to return path after auth:', returnPath)
                window.location.href = returnPath
              }
              localStorage.removeItem('wc_return_path')
              localStorage.removeItem('wc_connection_timestamp')
            }, 1000)
          } else {
            console.log('❌ Mobile authentication recovery failed')
            // Clear return path on failure
            localStorage.removeItem('wc_return_path')
            localStorage.removeItem('wc_connection_timestamp')
          }
        } catch (error) {
          console.error('❌ Error during mobile wallet recovery:', error)
          localStorage.removeItem('wc_return_path')
          localStorage.removeItem('wc_connection_timestamp')
        } finally {
          setIsRecoveringFromMobile(false)
        }
      }
    }

    // Run immediately on mount
    handleMobileWalletReturn()

    // Also run when wallet connection state changes
    const timeoutId = setTimeout(handleMobileWalletReturn, 1000)
    
    return () => clearTimeout(timeoutId)
  }, [mounted, isConnected, authState.isAuthenticated, address, authState.needsSignature, handleSignIn, isRecoveringFromMobile])

  // Enhanced mobile recovery: Trigger when user returns from background
  useEffect(() => {
    if (!mounted || !returnedFromBackground) return

    // Only run on mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     window.innerWidth < 768

    if (!isMobile) {
      console.log('🖥️ Desktop detected - skipping background return recovery logic')
      return
    }

    console.log('📱 User returned from background - checking wallet state')
    
    // Small delay to allow wallet state to sync
    const timeoutId = setTimeout(() => {
      const returnPath = localStorage.getItem('wc_return_path')
      const walletConnectionTimestamp = localStorage.getItem('wc_connection_timestamp')
      const now = Date.now()
      
      const isRecentConnection = walletConnectionTimestamp && 
        (now - parseInt(walletConnectionTimestamp)) < 5 * 60 * 1000

      if (returnPath && isConnected && !authState.isAuthenticated && isRecentConnection && address && !isRecoveringFromMobile) {
        console.log('📱 Triggering mobile recovery after background return')
        // The main mobile recovery logic will handle this
      }
    }, 1500) // Longer delay for background returns

    return () => clearTimeout(timeoutId)
  }, [returnedFromBackground, mounted, isConnected, authState.isAuthenticated, address, isRecoveringFromMobile])

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
        
        // Clear mobile recovery data
        localStorage.removeItem('wc_return_path')
        localStorage.removeItem('wc_connection_timestamp')
        
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
      
      // Redirect to homepage when wallet is disconnected to fix AppKit modal issues
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Redirecting to homepage after wallet disconnect with page reload')
          // Force a hard reload to ensure complete state reset
          window.location.replace('/')
        }
      }, 500)
      
      // Backup redirect in case the first one fails
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          console.log('🔄 Backup redirect to homepage after wallet disconnect')
          window.location.href = '/'
        }
      }, 1000)
      
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

    // Redirect to homepage to fix AppKit modal issues
    setTimeout(() => {
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        console.log('🔄 Redirecting to homepage after logout with page reload')
        // Force a hard reload to ensure complete state reset
        window.location.replace('/')
      }
    }, 500)

    // Disconnect wallet last to trigger cleanup
    disconnect()
    
    // Clear disconnecting flag after logout process
    setTimeout(() => {
      setIsDisconnecting(false)
    }, 500)
  }, [disconnect, router])

  const clearError = useCallback(() => {
    setAuthState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading || isRecoveringFromMobile,
    user: authState.user,
    address: authState.user?.address || address,
    needsSignature: authState.needsSignature,
    error: authState.error,
    signIn: handleSignIn,
    logout,
    clearError,
    isRecoveringFromMobile
  }
} 