'use client'

import { WagmiWrapper } from '@/components/WagmiWrapper'
import MinerDashboard from '@/components/MinerDashboard'

function CampaignsPageContent() {
  return <MinerDashboard activeSection="campaigns" />
}

export default function CampaignsPage() {
  return (
    <WagmiWrapper>
      <CampaignsPageContent />
    </WagmiWrapper>
  )
}
