'use client'

import { useRef, useState, useEffect } from 'react'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { useRouter } from 'next/navigation'

export default function ProjectsAuthPage() {
  const router = useRouter()
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const connectingRef = useRef(false)

  useEffect(() => {
    // If we have a stored project id, only redirect if backend confirms valid tokens
    const projectId = localStorage.getItem('burnie_project_id')
    const checkAndRedirect = async () => {
      try {
        if (!projectId) return
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          console.error('API URL not configured')
          return
        }
        
        const resp = await fetch(`${apiUrl}/projects/${projectId}/twitter/status`, {
          credentials: 'include' // Include cookies for session
        })
        if (!resp.ok) {
          console.error(`Failed to check Twitter status: ${resp.status}`)
          return
        }
        
        const data = await resp.json()
        if (data?.success && data.valid) {
          router.replace(`/projects/${projectId}/dashboard`)
        }
      } catch (error) {
        console.error('Error checking Twitter status:', error)
        // stay on auth page
      }
    }
    checkAndRedirect()
  }, [router])

  const handleTwitterConnect = async () => {
    if (connectingRef.current || isConnecting) return
    connectingRef.current = true
    setIsConnecting(true)
    setError('')

    try {
      const apiUrl = getApiUrlWithFallback()
      if (!apiUrl) {
        throw new Error('API URL not configured')
      }
      
      const response = await fetch(`${apiUrl}/projects/twitter/login`, { method: 'GET', credentials: 'include' })
      if (!response.ok) {
        throw new Error(`Failed to get Twitter OAuth URL: ${response.status}`)
      }
      const data = await response.json()
      if (data?.success && data?.data?.oauth_url) {
        const width = 500
        const height = 600
        const left = window.screenX + (window.outerWidth - width) / 2
        const top = window.screenY + (window.outerHeight - height) / 2
        const authWindow = window.open(
          data.data.oauth_url,
          'projects-twitter-auth',
          `width=${width},height=${height},left=${left},top=${top}`
        )

        let messageReceived = false
        const messageHandler = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return
          if (event.data.type === 'PROJECTS_TWITTER_AUTH_SUCCESS') {
            messageReceived = true
            window.removeEventListener('message', messageHandler)
            setIsConnecting(false)
            connectingRef.current = false
            const { project_id, exists } = event.data
            if (project_id) {
              localStorage.setItem('burnie_project_id', String(project_id))
              // Check if context exists; if not, go to onboarding
              try {
                const apiUrl = getApiUrlWithFallback()
                if (apiUrl) {
                  const ctxResp = await fetch(`${apiUrl}/projects/${project_id}/context`, {
                    credentials: 'include' // Include cookies for session
                  })
                  if (ctxResp.ok) {
                    const ctxData = await ctxResp.json()
                    const hasContext = !!ctxData?.data
                    if (exists && hasContext) {
                      router.replace(`/projects/${project_id}/dashboard`)
                    } else {
                      router.replace(`/projects/new`)
                    }
                  } else {
                    router.replace(`/projects/new`)
                  }
                } else {
                  router.replace(`/projects/new`)
                }
              } catch (e) {
                console.error('Error checking context:', e)
                router.replace(`/projects/new`)
              }
            }
          } else if (event.data.type === 'PROJECTS_TWITTER_AUTH_ERROR') {
            messageReceived = true
            setError(event.data.message || 'Twitter authentication failed')
            setIsConnecting(false)
            connectingRef.current = false
            window.removeEventListener('message', messageHandler)
          }
        }
        window.addEventListener('message', messageHandler)

        // Fallback if user closes popup
        const checkClose = setInterval(() => {
          if (authWindow && authWindow.closed) {
            clearInterval(checkClose)
            window.removeEventListener('message', messageHandler)
            if (!messageReceived) {
              setIsConnecting(false)
              connectingRef.current = false
            }
          }
        }, 800)
      } else {
        throw new Error('Invalid response from backend')
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to start Twitter login')
      connectingRef.current = false
      setIsConnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center p-6">
      <div className="max-w-xl w-full glass p-8 rounded-2xl border border-gray-800">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">𝕏</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Sign in with 𝕏</h1>
          <p className="text-gray-400">Connect your projects Twitter account to continue</p>
        </div>

        {error && (
          <div className="mb-4 p-3 text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">{error}</div>
        )}

        <button
          onClick={handleTwitterConnect}
          disabled={isConnecting}
          className="w-full bg-black hover:bg-gray-900 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
        >
          {isConnecting ? 'Connecting...' : 'Sign in with 𝕏'}
        </button>

        <div className="text-center mt-6">
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-white text-sm">← Back to Home</button>
        </div>
      </div>
    </div>
  )
}


