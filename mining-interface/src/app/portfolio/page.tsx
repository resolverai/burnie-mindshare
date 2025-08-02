'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import MinerDashboard from '@/components/MinerDashboard'

function PortfolioPageContent() {
  return <MinerDashboard activeSection="portfolio" />
}

export default function PortfolioPage() {
  return (
    <WagmiWrapper>
      <PortfolioPageContent />
    </WagmiWrapper>
  )
}
