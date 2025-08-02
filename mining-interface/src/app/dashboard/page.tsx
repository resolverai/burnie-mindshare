'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import MinerDashboard from '@/components/MinerDashboard'

function DashboardPageContent() {
  return <MinerDashboard activeSection="dashboard" />
}

export default function DashboardPage() {
  return (
    <WagmiWrapper>
      <DashboardPageContent />
    </WagmiWrapper>
  )
}
