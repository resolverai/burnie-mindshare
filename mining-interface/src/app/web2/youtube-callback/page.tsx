'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export default function YouTubeCallbackPage() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      window.opener?.postMessage(
        { type: 'YOUTUBE_AUTH_ERROR', message: error },
        window.location.origin
      )
      window.close()
      return
    }

    if (code && state) {
      window.opener?.postMessage(
        { type: 'YOUTUBE_AUTH_SUCCESS', code, state },
        window.location.origin
      )
      window.close()
    }
  }, [searchParams])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
        <p className="text-white">Connecting to YouTube...</p>
      </div>
    </div>
  )
}

