'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useAccount } from 'wagmi'

// Twitter authentication state types
export interface TwitterProfile {
  username: string
  displayName?: string
  profileImage?: string
  followers?: number
  following?: number
}

export interface TwitterCapabilities {
  canTweet: boolean
  canUploadImages: boolean
  canUploadVideos: boolean
  needsReconnection: boolean
  needsVideoReconnection: boolean
  // Backend snake_case variants (for compatibility)
  can_tweet?: boolean
  can_upload_images?: boolean
  can_upload_videos?: boolean
  needs_reconnection?: boolean
  needs_video_reconnection?: boolean
}

export interface TwitterAuthState {
  isConnected: boolean
  isLoading: boolean
  profile: TwitterProfile | null
  tokenStatus: 'valid' | 'expired' | 'missing'
  hasPreviousConnection: boolean
  tokenExpiresAt: Date | null
  // OAuth 1.0a capabilities
  oauth1Connected: boolean
  oauth1TokenStatus: 'valid' | 'expired' | 'missing'
  capabilities: TwitterCapabilities
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
  
  console.log('🔍 TwitterProvider - Initialized with address:', address)
  
  const [twitter, setTwitter] = useState<TwitterAuthState>({
    isConnected: false,
    isLoading: false,
    profile: null,
    tokenStatus: 'missing',
    hasPreviousConnection: false,
    tokenExpiresAt: null,
    oauth1Connected: false,
    oauth1TokenStatus: 'missing',
    capabilities: {
      canTweet: false,
      canUploadImages: false,
      canUploadVideos: false,
      needsReconnection: true,
      needsVideoReconnection: true
    }
  })

  // Check if Twitter is ready (connected with valid token and can tweet)
  const isTwitterReady = twitter.capabilities?.canTweet && !twitter.capabilities?.needsReconnection

  // Check Twitter connection status
  const checkConnection = useCallback(async (): Promise<void> => {
    console.log('🔍 TwitterContext - checkConnection called with address:', address)
    
    if (!address) {
      console.log('🔍 TwitterContext - No address, clearing state')
      setTwitter(prev => ({
        ...prev,
        isConnected: false,
        profile: null,
        tokenStatus: 'missing',
        hasPreviousConnection: false,
        tokenExpiresAt: null,
        oauth1Connected: false,
        oauth1TokenStatus: 'missing',
        capabilities: {
          canTweet: false,
          canUploadImages: false,
          canUploadVideos: false,
          needsReconnection: true,
          needsVideoReconnection: true
        }
      }))
      return
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      console.log('🔍 TwitterContext - Making API call to:', `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`)
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`
      )
      
      console.log('🔍 TwitterContext - API response status:', response.status, response.ok)

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
            token_expires_at,
            oauth1_connected,
            oauth1_token_status,
            capabilities,
            needs_reconnection
          } = data.data

          console.log('🔍 TwitterContext - API Response Data:', {
            connected,
            token_status,
            oauth1_connected,
            oauth1_token_status,
            capabilities,
            needs_reconnection,
            needsReconnection: capabilities?.needsReconnection,
            needs_reconnection_from_capabilities: capabilities?.needs_reconnection
          })

          setTwitter(prev => ({
            ...prev,
            isConnected: connected,
            tokenStatus: token_status,
            hasPreviousConnection: has_previous_connection,
            tokenExpiresAt: token_expires_at ? new Date(token_expires_at) : null,
            oauth1Connected: oauth1_connected || false,
            oauth1TokenStatus: oauth1_token_status || 'missing',
            capabilities: {
              canTweet: capabilities?.canTweet ?? capabilities?.can_tweet ?? false,
              canUploadImages: capabilities?.canUploadImages ?? capabilities?.can_upload_images ?? false,
              canUploadVideos: capabilities?.canUploadVideos ?? capabilities?.can_upload_videos ?? false,
              needsReconnection: capabilities?.needsReconnection ?? capabilities?.needs_reconnection ?? needs_reconnection ?? true,
              needsVideoReconnection: capabilities?.needsVideoReconnection ?? capabilities?.needs_video_reconnection ?? true
            },
            profile: connected ? {
              username: twitter_username,
              displayName: twitter_display_name,
              profileImage: profile_image_url,
              followers: twitter_followers,
              following: twitter_following,
            } : null,
          }))

          console.log('🔍 TwitterContext - Updated State:', {
            needsReconnection: capabilities?.needsReconnection,
            canUploadVideos: capabilities?.canUploadVideos,
            oauth1Connected: oauth1_connected
          })
        } else {
          console.warn('❌ Failed to check Twitter status:', data.message)
          setTwitter(prev => ({
            ...prev,
            isConnected: false,
            profile: null,
            tokenStatus: 'missing',
            hasPreviousConnection: false,
            tokenExpiresAt: null,
            oauth1Connected: false,
            oauth1TokenStatus: 'missing',
            capabilities: {
              canTweet: false,
              canUploadImages: false,
              canUploadVideos: false,
              needsReconnection: true,
              needsVideoReconnection: true
            }
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
          oauth1Connected: false,
          oauth1TokenStatus: 'missing',
          capabilities: {
            canTweet: false,
            canUploadImages: false,
            canUploadVideos: false,
            needsReconnection: true,
            needsVideoReconnection: true
          }
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
        oauth1Connected: false,
        oauth1TokenStatus: 'missing',
        capabilities: {
          canTweet: false,
          canUploadImages: false,
          canUploadVideos: false,
          needsReconnection: true,
          needsVideoReconnection: true
        }
      }))
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }, [address])

  // Connect Twitter account - handles both OAuth 2.0 and OAuth 1.0a
  const connect = async (): Promise<boolean> => {
    if (!address) {
      console.error('❌ No wallet address available for Twitter connection')
      return false
    }

    setTwitter(prev => ({ ...prev, isLoading: true }))

    try {
      // Check current connection status first and get fresh data
      await checkConnection()
      
      // Wait a moment for state to update, then get fresh connection status
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Get fresh connection status by calling the API directly
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`)
      const statusData = await response.json()
      
      let needsOAuth2 = true
      let needsOAuth1 = true
      
      if (statusData.success) {
        const { connected, token_status, oauth1_connected, oauth1_token_status } = statusData.data
        needsOAuth2 = !connected || token_status !== 'valid'
        needsOAuth1 = !oauth1_connected || oauth1_token_status !== 'valid'
        
        console.log('🔍 Fresh authentication status check:', {
          needsOAuth2,
          needsOAuth1,
          connected,
          token_status,
          oauth1_connected,
          oauth1_token_status
        })
      } else {
        console.log('🔍 Using fallback authentication status check (API failed)')
      }

      // Step 1: Handle OAuth 2.0 if needed
      if (needsOAuth2) {
        console.log('🔐 Starting OAuth 2.0 flow...')
        const oauth2Success = await performOAuth2Flow()
        if (!oauth2Success) {
          console.error('❌ OAuth 2.0 flow failed')
          return false
        }
        console.log('✅ OAuth 2.0 flow completed')
        
        // Refresh status after OAuth 2.0
        await checkConnection()
      }

      // Step 2: Handle OAuth 1.0a if needed
      if (needsOAuth1 || twitter.oauth1TokenStatus !== 'valid') {
        console.log('🔐 Starting OAuth 1.0a flow...')
        const oauth1Success = await performOAuth1Flow()
        if (!oauth1Success) {
          console.error('❌ OAuth 1.0a flow failed')
          return false
        }
        console.log('✅ OAuth 1.0a flow completed')
        
        // Wait a moment for database to be updated, then refresh status
        await new Promise(resolve => setTimeout(resolve, 1000))
        await checkConnection()
      }

      console.log('✅ All Twitter authentication flows completed successfully')
      return true

    } catch (error) {
      console.error('❌ Error during Twitter authentication:', error)
      return false
    } finally {
      setTwitter(prev => ({ ...prev, isLoading: false }))
    }
  }

  // OAuth 2.0 flow (existing logic)
  const performOAuth2Flow = async (): Promise<boolean> => {
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
        throw new Error('Failed to open authentication window. Please disable popup blocker.')
      }

      // Step 3: Listen for messages from callback window
      return new Promise((resolve) => {
        const messageHandler = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return

          if (event.data.type === 'YAPPER_TWITTER_AUTH_SUCCESS') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            console.log('✅ OAuth 2.0 authentication successful')
            resolve(true)
          } else if (event.data.type === 'YAPPER_TWITTER_AUTH_ERROR') {
            authWindow.close()
            window.removeEventListener('message', messageHandler)
            console.error('❌ OAuth 2.0 authentication failed:', event.data.error)
            resolve(false)
          }
        }

        window.addEventListener('message', messageHandler)

        // Handle window closed manually
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', messageHandler)
            console.log('🐦 OAuth 2.0 auth window closed')
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
      console.error('❌ Error during OAuth 2.0 flow:', error)
      return false
    }
  }

  // OAuth 1.0a flow (new implementation)
  const performOAuth1Flow = async (): Promise<boolean> => {
    try {
      // Step 1: Initialize OAuth 1.0a flow
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/auth/twitter/oauth1/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: address, // Using wallet address as user identifier
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to initialize OAuth 1.0a flow')
      }

      const data = await response.json()
      
      console.log('🔍 OAuth 1.0a init response:', data)
      
      if (!data.success || !data.data?.authUrl) {
        throw new Error('Invalid OAuth 1.0a URL response')
      }

      // Store session ID for callback
      localStorage.setItem('oauth1_session_id', data.data.sessionId)

      // Step 2: Open OAuth 1.0a window
      const authWindow = window.open(
        data.data.authUrl,
        'oauth1-twitter-auth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!authWindow) {
        throw new Error('Failed to open OAuth 1.0a authentication window. Please disable popup blocker.')
      }

      // Step 3: Wait for callback window to complete authentication
      return new Promise((resolve) => {
        // Listen for messages from the callback window
        const handleMessage = (event: MessageEvent) => {
          // Verify origin for security
          if (event.origin !== window.location.origin) {
            return
          }

          if (event.data.type === 'OAUTH1_TWITTER_AUTH_SUCCESS') {
            console.log('✅ OAuth 1.0a authentication successful!')
            window.removeEventListener('message', handleMessage)
            authWindow.close()
            resolve(true)
          } else if (event.data.type === 'OAUTH1_TWITTER_AUTH_ERROR') {
            console.error('❌ OAuth 1.0a authentication failed:', event.data.error)
            window.removeEventListener('message', handleMessage)
            authWindow.close()
            resolve(false)
          }
        }

        window.addEventListener('message', handleMessage)

        // Monitor window closure as fallback
        const checkClosed = setInterval(() => {
          if (authWindow.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', handleMessage)
            console.log('🔄 OAuth 1.0a window closed, checking final status...')
            
            // Give a brief moment for any final messages
            setTimeout(() => {
              resolve(false)
            }, 1000)
          }
        }, 1000)

        // Cleanup after timeout
        setTimeout(() => {
          clearInterval(checkClosed)
          window.removeEventListener('message', handleMessage)
          if (!authWindow.closed) {
            authWindow.close()
          }
          resolve(false)
        }, 600000) // 10 minutes timeout
      })


    } catch (error) {
      console.error('❌ Error during OAuth 1.0a flow:', error)
      return false
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
    console.log('🔍 TwitterProvider - useEffect triggered with address:', address)
    if (address) {
      console.log('🔍 TwitterProvider - Address exists, calling checkConnection')
      checkConnection()
    } else {
      console.log('🔍 TwitterProvider - No address, clearing Twitter state')
      // Clear Twitter state when wallet disconnects
      setTwitter({
        isConnected: false,
        isLoading: false,
        profile: null,
        tokenStatus: 'missing',
        hasPreviousConnection: false,
        tokenExpiresAt: null,
        oauth1Connected: false,
        oauth1TokenStatus: 'missing',
        capabilities: {
          canTweet: false,
          canUploadImages: false,
          canUploadVideos: false,
          needsReconnection: true,
          needsVideoReconnection: true
        }
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
  
  console.log('🔍 useTwitter - Hook called, context exists:', !!context)
  
  if (context === undefined) {
    console.error('❌ useTwitter - No context found! TwitterProvider not found in component tree')
    throw new Error('useTwitter must be used within a TwitterProvider')
  }
  
  console.log('🔍 useTwitter - Current twitter state:', {
    isConnected: context.twitter.isConnected,
    capabilities: context.twitter.capabilities,
    address: context.twitter.profile?.username
  })
  
  return context
}

// Export context for advanced usage
export { TwitterContext }
