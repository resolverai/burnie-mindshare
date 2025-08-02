'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useSignMessage, useDisconnect, useChainId } from 'wagmi'

interface AuthUser {
  address: string
  signature: string
  timestamp: string
}

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  needsSignature: boolean
  error: string | null
}

export function useAuth() {
  const [mounted, setMounted] = useState(false)
  
  // Always call hooks - this is required by React
  const accountData = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()

  const { address, isConnected } = accountData
  
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    needsSignature: false,
    error: null
  })

  // Client-side mounting check
  useEffect(() => {
    setMounted(true)
  }, [])

  // Initialize authentication state on mount
  useEffect(() => {
    if (!mounted) return
    
    const initializeAuth = () => {
      try {
        // Check localStorage for existing authentication
        const storedAuth = localStorage.getItem('burnie_auth_user')
        const storedToken = localStorage.getItem('burnie_auth_token')
        
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
        
      } catch (error) {
        console.error('❌ Error initializing auth:', error)
        // Clear corrupted data
        localStorage.removeItem('burnie_auth_user')
        localStorage.removeItem('burnie_auth_token')
        localStorage.removeItem('burnie_auth_signature')
        
        setAuthState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          needsSignature: false,
          error: null
        })
      }
    }

    initializeAuth()
  }, [mounted])

  // Handle wallet changes (only after component is mounted)
  useEffect(() => {
    if (!mounted) return
    
    console.log('🔍 Wallet state change:', { isConnected, address, mounted })
    
    if (!isConnected || !address) {
      // Wallet disconnected - clear authentication completely
      console.log('🔄 Wallet disconnected, clearing authentication')
      
      // Clear localStorage
      localStorage.removeItem('burnie_auth_user')
      localStorage.removeItem('burnie_auth_token')
      localStorage.removeItem('burnie_auth_signature')
      
      // Clear auth state
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        needsSignature: false,
        error: null
      })
      return
    }

    // Wallet connected - check if we need to authenticate this specific wallet
    const storedAuth = localStorage.getItem('burnie_auth_user')
    if (storedAuth) {
      try {
        const user = JSON.parse(storedAuth)
        if (user.address === address.toLowerCase()) {
          // Same wallet as stored auth - restore authentication immediately
          console.log('✅ Wallet reconnected with stored auth, restoring session')
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

    // Different wallet or no stored auth - need signature confirmation
    console.log('🔐 New wallet connected, requiring sign-in confirmation')
    setAuthState(prev => ({
      ...prev,
      isAuthenticated: false,
      user: null,
      needsSignature: true,
      error: null,
      isLoading: false
    }))
  }, [isConnected, address, mounted])

  const signIn = useCallback(async () => {
    if (!mounted || !signMessageAsync) {
      setAuthState(prev => ({ ...prev, error: 'Wallet not ready' }))
      return false
    }

    if (!address || !isConnected) {
      setAuthState(prev => ({ ...prev, error: 'Wallet not connected' }))
      return false
    }

    setAuthState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const message = `Welcome to Burnie Mining Interface!

Please sign this message to authenticate your wallet.

Wallet: ${address}
Chain ID: ${chainId || 'unknown'}
Timestamp: ${new Date().toISOString()}

This signature proves you own this wallet.`

      const signature = await signMessageAsync({ message })
      
      const user: AuthUser = {
        address: address.toLowerCase(),
        signature,
        timestamp: new Date().toISOString()
      }

      // Store authentication
      localStorage.setItem('burnie_auth_user', JSON.stringify(user))
      localStorage.setItem('burnie_auth_token', signature)
      localStorage.setItem('burnie_auth_signature', signature)

      setAuthState({
        isAuthenticated: true,
        isLoading: false,
        user,
        needsSignature: false,
        error: null
      })

      console.log('✅ Authentication successful for:', address)
      return true

    } catch (error: any) {
      console.error('❌ Authentication failed:', error)
      
      setAuthState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        needsSignature: true,
        error: error.message || 'Authentication failed'
      })

      // If user rejected, disconnect wallet
      if (error.message?.includes('rejected') || error.name === 'UserRejectedRequestError') {
        if (disconnect) disconnect()
      }

      return false
    }
  }, [address, chainId, isConnected, signMessageAsync, disconnect, mounted])

  const logout = useCallback(() => {
    console.log('🚪 Logging out user')
    
    // Clear all auth-related localStorage
    localStorage.removeItem('burnie_auth_user')
    localStorage.removeItem('burnie_auth_token')
    localStorage.removeItem('burnie_auth_signature')
    // Clear Twitter OAuth data as well
    localStorage.removeItem('twitter_oauth_state')
    localStorage.removeItem('twitter_code_verifier')
    localStorage.removeItem('twitter_wallet_address')
    
    // Clear auth state
    setAuthState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      needsSignature: false,
      error: null
    })

    // Disconnect wallet
    if (disconnect) disconnect()
  }, [disconnect])

  const clearError = useCallback(() => {
    setAuthState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading || !mounted,
    user: authState.user,
    address: authState.user?.address || address,
    needsSignature: authState.needsSignature,
    error: authState.error,
    signIn,
    logout,
    clearError
  }
} 