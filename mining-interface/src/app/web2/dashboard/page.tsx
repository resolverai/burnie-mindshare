'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Web2DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    // Check authentication
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    if (!web2Auth) {
      router.push('/web2/auth')
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full text-center">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-12">
          <div className="text-6xl mb-6">🚀</div>
          <h1 className="text-4xl font-bold text-white mb-4">
            Web2 Dashboard Coming Soon!
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Your brand profile has been saved successfully. We're building an amazing dashboard for you!
          </p>
          
          <div className="space-y-4 text-left max-w-md mx-auto mb-8">
            <div className="flex items-start space-x-3">
              <span className="text-green-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Account Created</p>
                <p className="text-sm text-gray-400">Your Web2 business account is ready</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Twitter Connected</p>
                <p className="text-sm text-gray-400">Ready for automated posting</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 text-xl">✓</span>
              <div>
                <p className="text-white font-medium">Brand Profile Complete</p>
                <p className="text-sm text-gray-400">AI knows your brand identity</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push('/')}
            className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold rounded-xl transition-all"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
