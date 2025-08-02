'use client'

import MinerDashboard from '@/components/MinerDashboard'
import { useAuthGuard } from '@/hooks/useAuthGuard'

function PortfolioPageContent() {
  const { shouldShowContent } = useAuthGuard()
  
  if (!shouldShowContent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Checking authentication...</p>
        </div>
      </div>
    )
  }
  
  return <MinerDashboard activeSection="portfolio" />
}

export default function PortfolioPage() {
  return <PortfolioPageContent />
}
