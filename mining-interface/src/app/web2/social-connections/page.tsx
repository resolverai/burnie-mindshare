'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'

type ConnectionStatus = {
  platform: string
  connected: boolean
  username?: string
  expiresAt?: string
}

export default function SocialConnectionsPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [connections, setConnections] = useState<ConnectionStatus[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)

  useEffect(() => {
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const storedAccountId = localStorage.getItem('burnie_web2_account_id')
    
    if (!web2Auth || !storedAccountId) {
      router.push('/web2/auth')
      return
    }
    
    const accId = parseInt(storedAccountId, 10)
    setAccountId(accId)
    
    // Fetch existing connections
    fetchConnections(accId)
    
    setIsLoading(false)
  }, [router])

  const fetchConnections = async (accId: number) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
      const response = await fetch(`${apiUrl}/web2-account-connections/${accId}`)
      
      if (response.ok) {
        const data = await response.json()
        
        // Map connections to status
        const platforms = ['twitter', 'linkedin', 'youtube']
        const statusMap = platforms.map(platform => {
          const connection = data.find((c: any) => c.platform === platform)
          return {
            platform,
            connected: !!connection,
            username: connection?.platform_username,
            expiresAt: connection?.token_expires_at
          }
        })
        
        setConnections(statusMap)
      }
    } catch (error) {
      console.error('Failed to fetch connections:', error)
    }
  }

  const handleConnect = async (platform: 'twitter' | 'linkedin' | 'youtube') => {
    if (!accountId) return

    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
      const response = await fetch(`${apiUrl}/web2-auth/${platform}/login?redirect_uri=${encodeURIComponent(window.location.origin + `/web2/${platform}-callback`)}`)
      
      if (!response.ok) {
        alert(`Failed to initiate ${platform} connection`)
        return
      }

      const data = await response.json()
      
      if (data.success && data.data?.oauth_url) {
        const state = data.data.state
        const codeChallenge = data.data.code_challenge // Only for Twitter

        // Open OAuth popup
        const width = 600
        const height = 700
        const left = window.screenX + (window.outerWidth - width) / 2
        const top = window.screenY + (window.outerHeight - height) / 2
        
        const authWindow = window.open(
          data.data.oauth_url,
          `${platform}_auth`,
          `width=${width},height=${height},left=${left},top=${top}`
        )

        // Listen for OAuth callback
        const messageHandler = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return

          const platformUpperCase = platform.toUpperCase()
          
          if (event.data.type === `${platformUpperCase}_AUTH_SUCCESS`) {
            const { code, state: returnedState } = event.data

            // Complete OAuth flow
            const callbackPayload: any = {
              code,
              state: returnedState,
              account_id: accountId
            }

            // Add code_verifier for Twitter
            if (platform === 'twitter' && codeChallenge) {
              callbackPayload.code_verifier = codeChallenge
            }

            const callbackResponse = await fetch(
              `${apiUrl}/web2-auth/${platform}/callback`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(callbackPayload),
              }
            )

            if (callbackResponse.ok) {
              alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`)
              // Refresh connections
              fetchConnections(accountId)
            } else {
              const error = await callbackResponse.json()
              alert(`Failed to connect ${platform}: ${error.error}`)
            }

            window.removeEventListener('message', messageHandler)
          } else if (event.data.type === `${platformUpperCase}_AUTH_ERROR`) {
            alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} authentication failed: ${event.data.message}`)
            window.removeEventListener('message', messageHandler)
          }
        }

        window.addEventListener('message', messageHandler)
      }
    } catch (error) {
      console.error(`Failed to connect ${platform}:`, error)
      alert(`Failed to connect ${platform}. Please try again.`)
    }
  }

  const handleDisconnect = async (platform: string) => {
    if (!accountId) return

    if (!confirm(`Are you sure you want to disconnect ${platform}?`)) {
      return
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
      const response = await fetch(`${apiUrl}/web2-account-connections/${accountId}/${platform}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} disconnected successfully!`)
        fetchConnections(accountId)
      } else {
        alert(`Failed to disconnect ${platform}`)
      }
    } catch (error) {
      console.error(`Failed to disconnect ${platform}:`, error)
      alert(`Failed to disconnect ${platform}. Please try again.`)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 transition-all duration-300 ${
          sidebarExpanded ? 'ml-64' : 'ml-20'
        }`}>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        sidebarExpanded ? 'ml-64' : 'ml-20'
      }`}>
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Social Connections</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-4xl">
            <h1 className="text-3xl font-bold text-white mb-2">Social Media Connections</h1>
            <p className="text-gray-400 mb-8">Connect your social media accounts for automated posting.</p>

            <div className="space-y-4">
              {/* Twitter Connection */}
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">Twitter (X)</h3>
                      {connections.find(c => c.platform === 'twitter')?.connected ? (
                        <p className="text-sm text-green-400">
                          Connected as @{connections.find(c => c.platform === 'twitter')?.username}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">Not connected</p>
                      )}
                    </div>
                  </div>
                  {connections.find(c => c.platform === 'twitter')?.connected ? (
                    <button
                      onClick={() => handleDisconnect('twitter')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect('twitter')}
                      className="px-4 py-2 bg-black hover:bg-gray-900 text-white rounded-lg transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* LinkedIn Connection */}
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-700 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">LinkedIn</h3>
                      {connections.find(c => c.platform === 'linkedin')?.connected ? (
                        <p className="text-sm text-green-400">
                          Connected as {connections.find(c => c.platform === 'linkedin')?.username}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">Not connected</p>
                      )}
                    </div>
                  </div>
                  {connections.find(c => c.platform === 'linkedin')?.connected ? (
                    <button
                      onClick={() => handleDisconnect('linkedin')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect('linkedin')}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* YouTube Connection */}
              <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">YouTube</h3>
                      {connections.find(c => c.platform === 'youtube')?.connected ? (
                        <p className="text-sm text-green-400">
                          Connected as {connections.find(c => c.platform === 'youtube')?.username}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">Not connected</p>
                      )}
                    </div>
                  </div>
                  {connections.find(c => c.platform === 'youtube')?.connected ? (
                    <button
                      onClick={() => handleDisconnect('youtube')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect('youtube')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8 p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
              <p className="text-sm text-blue-300">
                <strong>Note:</strong> Your social media credentials are securely stored and encrypted. 
                You can disconnect any platform at any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
