'use client'

import { useState } from 'react'
import { getApiUrlWithFallback } from '@/utils/api-config'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ProjectsTwitterAuthModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const startAuth = async () => {
    try {
      setLoading(true)
      setError('')
      const apiUrl = getApiUrlWithFallback()
      const resp = await fetch(`${apiUrl}/projects/twitter/login`)
      const data = await resp.json()
      if (!resp.ok || !data?.success || !data?.data?.oauth_url) throw new Error('Failed to initiate Twitter auth')
      window.location.href = data.data.oauth_url
    } catch (e: any) {
      setError(e?.message || 'Unable to start Twitter login')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="glass w-full max-w-md p-6 rounded-2xl border border-gray-800">
        <h2 className="text-xl font-bold text-white mb-4 text-center">Sign in with 𝕏</h2>
        {error && <div className="mb-3 p-2 text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">{error}</div>}
        <button onClick={startAuth} disabled={loading} className="w-full bg-black hover:bg-gray-900 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50">
          {loading ? 'Connecting…' : 'Continue'}
        </button>
        <button onClick={onClose} className="w-full mt-3 text-gray-400 hover:text-white text-sm">Cancel</button>
      </div>
    </div>
  )
}


