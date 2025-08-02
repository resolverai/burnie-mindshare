'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import MinerDashboard from '@/components/MinerDashboard'

function MiningPageContent() {
  return <MinerDashboard activeSection="mining" />
}

export default function MiningPage() {
  return (
    <WagmiWrapper>
      <MiningPageContent />
    </WagmiWrapper>
  )
}
