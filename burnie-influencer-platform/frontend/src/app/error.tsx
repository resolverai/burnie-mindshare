'use client'

import { useEffect } from 'react'
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-white to-primary-50 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="mb-8">
          <ExclamationTriangleIcon className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-secondary-900 mb-2">Something went wrong!</h1>
          <p className="text-secondary-600 max-w-md mx-auto">
            An unexpected error occurred. Please try again or contact support if the problem persists.
          </p>
          {error.digest && (
            <p className="text-xs text-secondary-400 mt-2">
              Error ID: {error.digest}
            </p>
          )}
        </div>
        
        <button
          onClick={reset}
          className="inline-flex items-center btn-primary"
        >
          <ArrowPathIcon className="h-4 w-4 mr-2" />
          Try again
        </button>
      </div>
    </div>
  )
} 