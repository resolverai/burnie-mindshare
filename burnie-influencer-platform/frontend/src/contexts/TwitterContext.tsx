'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAccount } from 'wagmi'

// Twitter authentication state types
export interface TwitterProfile {
  username: string
  displayName?: string
  profileImage?: string
  followers?: number
  following?: number
}

export interface TwitterAuthState {
  isConnected: boolean
  isLoading: boolean
  profile: TwitterProfile | null
  tokenStatus: 'valid' | 'expired' | 'missing'
  hasPreviousConnection: boolean
  tokenExpiresAt: Date | null
}

export interface TwitterContextType {
  // State
  twitter: TwitterAuthState
  
  // Actions
  connect: () => Promise<boolean>
  disconnect: () => Promise<boolean>
  refreshToken: () => Promise<boolean>
  checkConnection: () => Promise<void>
  
  // Utilities
  isTwitterReady: boolean
}

const TwitterContext = createContext<TwitterContextType | undefined>(undefined)

interface TwitterProviderProps {
  children: ReactNode
}

export function TwitterProvider({ children }: TwitterProviderProps) {
  const { address } = useAccount()
  
  const [twitter, setTwitter] = useState<TwitterAuthState>({
    isConnected: false,
    isLoading: false,
    profile: null,
    tokenStatus: 'missing',
    hasPreviousConnection: false,
    tokenExpiresAt: null,
  })

  // Check if Twitter is ready (connected with valid token)
  const isTwitterReady = twitter.isConnected && twitter.tokenStatus === 'valid'

  // Check Twitter connection status
  const checkConnection = async (): Promise<void> => {
    if (!address) {
      setTwitter(prev => ({
        ...prev,
        isConnected: false,
        profile: null,
        tokenStatus: 'missing',
        hasPreviousConnection: false,
        tokenExpiresAt: null,
      }))
      return
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`
      )

      if (response.ok) {
        const data = await response.json()
        
        if (data.success) {
          const { 
            connected, 
            has_previous_connection, 
            token_status, 
            twitter_username, 
            twitter_display_name,
            profile_image_url,
            twitter_followers,
            twitter_following,
            token_expires_at 
          } = data.data

          setTwitter(prev => ({
            ...prev,
            isConnected: connected,
            tokenStatus: token_status,
            hasPreviousConnection: has_previous_connection,
            tokenExpiresAt: token_expires_at ? new Date(token_expires_at) : null,
            profile: connected ? {
              username: twitter_username,
              displayName: twitter_display_name,
              profileImage: profile_image_url,
              followers: twitter_followers,
              following: twitter_following,
            } : null,
          }))
        } else {
          console.warn('❌ Failed to check Twitter status:', data.message)
          setTwitter(prev => ({
            ...prev,
            isConnected: false,
            profile: null,
            tokenStatus: 'missing',
            hasPreviousConnection: false,
            tokenExpiresAt: null,
          }))
        }
      } else {
        console.error('❌ Twitter status check failed:', response.status)
        setTwitter(prev => ({
          ...prev,
          isConnected: false,
          profile: null,
          tokenStatus: 'missing',
          hasPreviousConnection: false,
          tokenExpiresAt: null,
        }))
      }
    } catch (error) {
      console.error('❌ Error checking Twitter connection:', error)
      setTwitter(prev => ({
        ...prev,
        isConnected: false,
        profile: null,
        tokenStatus: 'missing',
        hasPreviousConnection: false,
        tokenExpiresAt: null,
      }))
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }

  // Connect Twitter account
  const connect = async (): Promise<boolean> => {
    if (!address) {
      console.error('❌ No wallet address available for Twitter connection')
      return false
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      // Step 1: Get Twitter OAuth URL
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (!data.success || !data.data.oauth_url) {
        throw new Error('Invalid OAuth URL response')
      }

      // Store state, code verifier, and wallet address for later use
      localStorage.setItem('yapper_twitter_oauth_state', data.data.state)
      localStorage.setItem('yapper_twitter_code_verifier', data.data.code_verifier)
      localStorage.setItem('yapper_twitter_wallet_address', address || '')

      // Step 2: Open Twitter OAuth in a new window
      const authWindow = window.open(
        data.data.oauth_url,
        'yapper-twitter-auth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!authWindow) {
        console.error('❌ Failed to open authentication window. Please disable popup blocker.')
        return false
      }

      // Step 3: Listen for messages from callback window
      return new Promise((resolve) => {
        const messageHandler = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return

          if (event.data.type === 'YAPPER_TWITTER_AUTH_SUCCESS') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            
            // Refresh connection status to get the latest Twitter profile data
            await checkConnection()
            console.log('✅ Twitter authentication successful')
            resolve(true)
          } else if (event.data.type === 'YAPPER_TWITTER_AUTH_ERROR') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            console.error('❌ Twitter authentication failed:', event.data.error)
            resolve(false)
          }
        }

        window.addEventListener('message', messageHandler)

        // Handle window closed manually
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            console.log('🐦 Twitter auth window closed')
            resolve(false)
          }
        }, 1000)

        // Cleanup after timeout
        setTimeout(() => {
          clearInterval(checkClosed)
          window.removeEventListener('message', messageHandler)
          if (!authWindow.closed) {
            authWindow.close()
          }
          resolve(false)
        }, 300000) // 5 minutes
      })

    } catch (error) {
      console.error('❌ Error during Twitter authentication:', error)
      return false
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }

  // Disconnect Twitter account
  const disconnect = async (): Promise<boolean> => {
    if (!address) {
      console.error('❌ No wallet address available for Twitter disconnection')
      return false
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/disconnect/${address}`,
        { method: 'POST' }
      )

      const data = await response.json()

      if (data.success) {
        console.log('✅ Twitter account disconnected successfully')
        setTwitter(prev => ({
          ...prev,
          isConnected: false,
          profile: null,
          tokenStatus: 'missing',
          hasPreviousConnection: true, // Keep this true since they had a connection
          tokenExpiresAt: null,
        }))
        return true
      } else {
        console.error('❌ Failed to disconnect Twitter:', data.message)
        return false
      }
    } catch (error) {
      console.error('❌ Error disconnecting Twitter:', error)
      return false
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }

  // Refresh Twitter token
  const refreshToken = async (): Promise<boolean> => {
    if (!address) {
      console.error('❌ No wallet address available for token refresh')
      return false
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/refresh-token/${address}`,
        { method: 'POST' }
      )

      const data = await response.json()

      if (data.success) {
        console.log('✅ Twitter token refreshed successfully')
        // Refresh the connection status
        await checkConnection()
        return true
      } else {
        console.error('❌ Failed to refresh Twitter token:', data.message)
        return false
      }
    } catch (error) {
      console.error('❌ Error refreshing Twitter token:', error)
      return false
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }

  // Check connection on wallet address change
  useEffect(() => {
    if (address) {
      checkConnection()
    } else {
      // Clear Twitter state when wallet disconnects
      setTwitter({
        isConnected: false,
        isLoading: false,
        profile: null,
        tokenStatus: 'missing',
        hasPreviousConnection: false,
        tokenExpiresAt: null,
      })
    }
  }, [address])

  const contextValue: TwitterContextType = {
    twitter,
    connect,
    disconnect,
    refreshToken,
    checkConnection,
    isTwitterReady,
  }

  return (
    <TwitterContext.Provider value={contextValue}>
      {children}
    </TwitterContext.Provider>
  )
}

// Custom hook to use Twitter context
export function useTwitter(): TwitterContextType {
  const context = useContext(TwitterContext)
  
  if (context === undefined) {
    throw new Error('useTwitter must be used within a TwitterProvider')
  }
  
  return context
}

// Export context for advanced usage
export { TwitterContext }
