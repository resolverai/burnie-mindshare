'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import MinerDashboard from '@/components/MinerDashboard'

function TeamsPageContent() {
  return <MinerDashboard activeSection="teams" />
}

export default function TeamsPage() {
  return (
    <WagmiWrapper>
      <TeamsPageContent />
    </WagmiWrapper>
  )
}
