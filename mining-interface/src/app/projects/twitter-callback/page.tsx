'use client'

import { useEffect, useRef, useState } from 'react'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { useSearchParams } from 'next/navigation'

function ProjectsTwitterCallbackContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing…')
  const [isError, setIsError] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const process = async () => {
      if (processingRef.current) return
      processingRef.current = true
      try {
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        if (!code || !state) throw new Error('Missing code or state')
        
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          throw new Error('API URL not configured')
        }
        
        const resp = await fetch(`${apiUrl}/projects/twitter/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state })
        })
        
        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}))
          throw new Error(errorData.error || `Callback failed: ${resp.status}`)
        }
        
        const result = await resp.json()
        if (!result?.success) {
          throw new Error(result?.error || 'Callback failed')
        }
        setStatus('Connected! You can close this window…')
        if (window.opener) {
          window.opener.postMessage({
            type: 'PROJECTS_TWITTER_AUTH_SUCCESS',
            project_id: result?.data?.project_id,
            exists: result?.data?.exists
          }, window.location.origin)
        }
        setTimeout(() => window.close(), 1200)
      } catch (e: any) {
        setIsError(true)
        setStatus(e?.message || 'An error occurred')
        if (window.opener) {
          window.opener.postMessage({ type: 'PROJECTS_TWITTER_AUTH_ERROR', message: e?.message || 'Error' }, window.location.origin)
        }
        setTimeout(() => window.close(), 1500)
      }
    }
    process()
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex items-center justify-center">
      <div className={`px-6 py-4 rounded-lg ${isError ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>{status}</div>
    </div>
  )
}

export default function ProjectsTwitterCallbackPage() {
  return <ProjectsTwitterCallbackContent />
}


