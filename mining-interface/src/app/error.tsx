'use client'

import { useEffect } from 'react'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application Error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="max-w-md mx-auto text-center">
        <div className="text-6xl font-bold text-red-500 mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-white mb-4">Something went wrong!</h1>
        <p className="text-gray-400 mb-8">
          An unexpected error occurred. Please try again.
        </p>
        <div className="space-y-4">
          <button
            onClick={reset}
            className="inline-flex items-center px-6 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors mr-4"
          >
            Try Again
          </button>
          <a 
            href="/"
            className="inline-flex items-center px-6 py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Return Home
          </a>
        </div>
      </div>
    </div>
  )
} 