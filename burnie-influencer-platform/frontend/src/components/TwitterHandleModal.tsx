'use client'

import React, { useState, useEffect } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { processTwitterHandle } from '../utils/twitterHandleUtils'

interface TwitterHandleModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (twitterHandle: string) => void
  loading?: boolean
}

export default function TwitterHandleModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  loading = false 
}: TwitterHandleModalProps) {
  const [twitterHandle, setTwitterHandle] = useState('')
  const [error, setError] = useState('')
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Process the Twitter handle (sanitize and validate)
    const { sanitized, isValid, error } = processTwitterHandle(twitterHandle)
    
    if (!isValid) {
      setError(error || 'Invalid Twitter handle')
      return
    }

    setError('')
    onSubmit(sanitized)
  }

  const handleClose = () => {
    setTwitterHandle('')
    setError('')
    onClose()
  }

  if (!isClient || !isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#220808] border border-[#3a1a1a] rounded-lg shadow-2xl w-full max-w-md backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#3a1a1a]">
          <h3 className="text-lg font-semibold text-white font-nt-brick">
            Join Waitlist
          </h3>
          <button
            onClick={handleClose}
            className="text-white/60 hover:text-white transition-colors"
            disabled={loading}
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-white/80 mb-2 font-nt-brick">
              Twitter Handle *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-white/60">@</span>
              <input
                type="text"
                value={twitterHandle}
                onChange={(e) => setTwitterHandle(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-white border border-yapper-border rounded-md text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="username"
                disabled={loading}
                maxLength={15}
              />
            </div>
            {error && (
              <p className="mt-1 text-sm text-red-400 font-nt-brick">{error}</p>
            )}
          </div>

          <div className="mb-6">
            <p className="text-sm text-white/70 font-nt-brick">
              We'll use your Twitter handle to verify your identity and provide updates about your waitlist status.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 bg-[#451616] hover:bg-[#743636] text-white rounded-lg transition-colors font-nt-brick"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !twitterHandle.trim()}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors font-nt-brick"
            >
              {loading ? 'Joining...' : 'Join Waitlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
