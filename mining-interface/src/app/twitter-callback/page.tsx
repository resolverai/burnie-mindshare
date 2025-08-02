'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import TwitterConnection from '@/components/TwitterConnection'

function TwitterCallbackPageContent() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Connecting Twitter...</h1>
        <p className="text-gray-400">Processing Twitter authentication...</p>
      </div>
    </div>
  )
}

export default function TwitterCallbackPage() {
  return (
    <WagmiWrapper>
      <TwitterCallbackPageContent />
    </WagmiWrapper>
  )
}
