import Link from 'next/link'
import { HomeIcon } from '@heroicons/react/24/outline'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-white to-primary-50 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-secondary-900 mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-secondary-700 mb-2">Page Not Found</h2>
          <p className="text-secondary-600 max-w-md mx-auto">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
        
        <Link
          href="/"
          className="inline-flex items-center btn-primary"
        >
          <HomeIcon className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
} 