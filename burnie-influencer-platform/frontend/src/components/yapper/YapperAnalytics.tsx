'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import clsx from 'clsx'

// Component interfaces and types
type StatCardProps = {
  title: string
  subtitle?: string
  value: string
  chip?: string
  gradient: string // radial gradient css
}

interface AnalyticsData {
  totalEarnings: number
  roastBalance: number
  contentPurchased: number
  successRate: number
  weeklyGrowth: number
  topCategories: Array<{
    name: string
    percentage: number
    growth: string
  }>
  recentActivity: Array<{
    type: string
    content: string
    earnings: number
    timestamp: string
  }>
}

// UI Components matching the new design
const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="mb-2">
    <h2 className="text-white text-sm font-semibold">{title}</h2>
    {subtitle ? <p className="text-[11px] text-white/60 mt-1">{subtitle}</p> : null}
  </div>
)

const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={clsx("rounded-xl bg-[#2b1a1a] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]", className)}>{children}</div>
)

const StatSlab: React.FC<StatCardProps> = ({ title, subtitle, value, chip, gradient }) => (
  <div
    className="rounded-[16px] p-4 h-[139px] text-white flex flex-col items-start justify-between w-full"
    style={{ background: gradient }}
  >
    <div className="flex flex-col items-start justify-start">
      <div className="text-sm font-medium">{title}</div>
      {subtitle ? <div className="text-sm text-[#FEBC2F] mt-1">{subtitle}</div> : null}
    </div>
    <div className="flex flex-row items-center justify-between w-full">
      <div className="text-3xl font-extrabold mt-2">{value}</div>
      {chip ? <div className="mt-2 inline-flex items-center rounded-full bg-black/20 px-2 py-1 text-[10px]">{chip}</div> : null}
    </div>
  </div>
)

const InsightItem: React.FC<{ 
  label: string; 
  value: string; 
  time?: string; 
  sublabel?: string; 
  right?: string; 
  info?: string; 
  className?: string 
}> = ({ label, value, time, sublabel, right, info, className }) => (
  <div className={clsx("flex flex-col items-start justify-between gap-3 py-3 border-t border-white/10 first:border-t-0", className)}>
    <div className="flex flex-col items-start justify-start gap-1 w-full">
      <div className="flex flex-row items-center justify-between w-full">
        <div className="flex flex-row items-center justify-start gap-2">
          {info ? <img src={info} alt="info" width={16} height={16} className="w-4 h-4" /> : null}
          <div className="text-xs font-medium">{label}</div>
        </div>
        <div className="text-white/60 text-xs">{sublabel}</div>
      </div>
      <div className="text-white/90 text-xs flex flex-row items-center justify-between w-full">
        <div className="text-white text-sm">{value}</div>
        <div className="text-white/90 text-xs">{time}</div>
      </div>
    </div>
    <div className="text-white/90 text-xs">{right}</div>
  </div>
)

const PerfBar: React.FC<{ label: string; you: number; community: number }> = ({ label, you, community }) => (
  <div className="mb-4 space-y-2">
    <div className="flex items-center justify-between text-sm text-white/80"><span>{label}</span><span>You: {you}, Community: {community}</span></div>
    <div className="text-xs text-white/60">You outperformed 78% of similar yappers</div>
    <div className="mt-2 h-2 rounded bg-white/10 overflow-hidden relative">
      <div className="absolute inset-y-0 left-0 bg-[#FEBC2F] rounded-full" style={{ width: `${community}%` }} />
      <div className="relative h-full bg-[#FD7A10] rounded-full" style={{ width: `${you}%` }} />
    </div>
  </div>
)

export default function YapperAnalytics() {
  const { address, isConnected } = useAccount()
  const [selectedTimeframe, setSelectedTimeframe] = useState('7d')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAnalytics = async () => {
      setIsLoading(true)
      
      try {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Mock analytics data
        const mockData: AnalyticsData = {
          totalEarnings: 3450,
          roastBalance: 1240,
          contentPurchased: 24,
          successRate: 73.2,
          weeklyGrowth: 12.5,
          topCategories: [
            { name: 'Gaming DeFi', percentage: 45, growth: '+23%' },
            { name: 'Memes', percentage: 32, growth: '+15%' },
            { name: 'Trading', percentage: 23, growth: '+8%' }
          ],
          recentActivity: [
            {
              type: 'purchase',
              content: 'Gaming DeFi Strategy Post',
              earnings: 156,
              timestamp: '2 hours ago'
            },
            {
              type: 'reward',
              content: 'Meme Performance Bonus',
              earnings: 89,
              timestamp: '5 hours ago'
            }
          ]
        }
        
        setAnalyticsData(mockData)
      } catch (error) {
        console.error('Failed to fetch analytics:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchAnalytics()
  }, [address, isConnected])

  if (isLoading) {
    return (
      <div className="h-full p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-white/10 rounded w-1/3 mb-6"></div>
          <div className="flex gap-6">
            <div className="flex-1">
              <div className="h-64 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-32 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-48 bg-white/10 rounded-xl"></div>
            </div>
            <div className="w-96">
              <div className="h-48 bg-white/10 rounded-xl mb-6"></div>
              <div className="h-96 bg-white/10 rounded-xl"></div>
          </div>
          </div>
        </div>
      </div>
    )
  }

  if (!analyticsData) {
    return (
      <div className="h-full p-6 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Coming Soon</h2>
          <p className="text-yapper-muted">Start purchasing content to see your performance analytics and AI insights</p>
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      <SectionHeader
        title="PERSONALISED GROWTH ANALYTICS"
        subtitle="AI powered insights to maximise your platform rewards and leaderboard climbing"
      />

      {/* Top area: slabs + prediction tiles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:col-span-2">
                      <StatSlab
              title="Platform earning potential"
              subtitle="Analysis coming soon"
              value="Coming Soon"
              gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(120, 199, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)"
            />
          {/* TODO: Restore when data is available
          <StatSlab 
            title="Platform earning potential" 
            subtitle="24 smart content investments available" 
            value="$3,450" 
            chip="+12% next week" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(120, 199, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          */}
          
          <StatSlab 
            title="Leaderboard power" 
            subtitle="No data available" 
            value="Coming Soon" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 235, 104, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          {/* TODO: Restore when data is available
          <StatSlab 
            title="Leaderboard power" 
            subtitle="+12 position, next milestone" 
            value="N/A" 
            chip="+12% next week" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 235, 104, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          */}
          
          <StatSlab 
            title="AI success rate" 
            subtitle="No data available" 
            value="Coming Soon" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(148, 251, 72, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          {/* TODO: Restore when data is available
          <StatSlab 
            title="AI success rate" 
            subtitle="18/24 content outperformed" 
            value="73.2%" 
            chip="87% confident" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(148, 251, 72, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          */}
          
          <StatSlab 
            title="Content ROI" 
            subtitle="No data available" 
            value="Coming Soon" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(245, 116, 116, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          {/* TODO: Restore when data is available
          <StatSlab 
            title="Content ROI" 
            subtitle="$22 avg investment per content" 
            value="155.7%" 
            chip="+23% this month" 
            gradient="radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(245, 116, 116, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)" 
          />
          */}
      </div>

        {/* Prediction slab on right */}
        <Card>
          <div className="text-white font-medium text-sm mb-3">AI CONTENT PREDICTION (NEXT 7 DAYS)</div>
          <div className="grid grid-cols-2 gap-4 place-items-center">
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(159, 123, 239, 0.25) 0%, rgba(91, 70, 137, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-sm font-medium mb-1">Coming Soon</div>
              <div className="text-[11px] text-center leading-tight">Predicted SNAP</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(123, 215, 239, 0.25) 0%, rgba(70, 123, 137, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-sm font-medium mb-1">Coming Soon</div>
              <div className="text-[11px] text-center leading-tight">AI Confidence</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(123, 239, 152, 0.25) 0%, rgba(70, 137, 87, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-sm font-medium mb-1">Coming Soon</div>
              <div className="text-[11px] text-center leading-tight">Position jump</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(239, 123, 150, 0.25) 0%, rgba(137, 70, 86, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-sm font-medium mb-1">Coming Soon</div>
              <div className="text-[11px] text-center leading-tight">Hot picks</div>
            </div>
          </div>
          {/* TODO: Restore when data is available
          <div className="grid grid-cols-2 gap-4 place-items-center">
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(159, 123, 239, 0.25) 0%, rgba(91, 70, 137, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-2xl font-extrabold mb-1">+340</div>
              <div className="text-[11px] text-center leading-tight">Predicted SNAP</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(123, 215, 239, 0.25) 0%, rgba(70, 123, 137, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-2xl font-extrabold mb-1">87%</div>
              <div className="text-[11px] text-center leading-tight">AI Confidence</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(123, 239, 152, 0.25) 0%, rgba(70, 137, 87, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-2xl font-extrabold mb-1">+8</div>
              <div className="text-[11px] text-center leading-tight">Position jump</div>
            </div>
            <div className="rounded-[12px] p-4 text-white flex flex-col items-center justify-center" style={{ background: 'linear-gradient(90deg, rgba(239, 123, 150, 0.25) 0%, rgba(137, 70, 86, 0.25) 100%)', width: 180, height: 120 }}>
              <div className="text-2xl font-extrabold mb-1">3</div>
              <div className="text-[11px] text-center leading-tight">Hot picks</div>
            </div>
          </div>
          */}
        </Card>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Opportunity scanner + Performance + What works + AI recommendations */}
        <div className="space-y-4 lg:col-span-2">
          {/* Opportunity scanner */}
          <Card className="rounded-[20px]">
            <div className="flex items-center justify-between">
              <h3 className="text-white text-sm space-y-2">LIVE OPPORTUNITY SCANNER - CONTENT TRENDS</h3>
              <div className="flex items-center gap-3">
                <button aria-label="previous" className="p-1 rounded-full hover:bg-white/10">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/70"><path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button aria-label="next" className="p-1 rounded-full hover:bg-white/10">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/70"><path d="M9 18l6-6-6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <span className="text-white/40 text-xs">⋮</span>
              </div>
            </div>
            <div className="mt-3 flex gap-3 overflow-hidden scroll-smooth">
              <div className="rounded-[12px] bg-[#3c2c2cba] p-4 h-[214px] space-y-4 flex flex-col items-center justify-center min-w-[340px]">
                <div className="text-white/60 text-sm text-center">No opportunity data available</div>
              </div>
            </div>
            {/* TODO: Restore when data is available
            <div className="mt-3 flex gap-3 overflow-hidden scroll-smooth">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="rounded-[12px] bg-[#3c2c2cba] p-4 h-[214px] space-y-4 flex flex-col items-start justify-between min-w-[340px]">
                  <div className="text-white text-sm font-semibold">Gaming DeFi</div>
                  <div className="mt-2 grid grid-cols-2 gap-y-1 text-[11px] text-white/80">
                    <span className="text-white/60 text-xs">Predicted SNAP</span><span className="text-right text-white">+245</span>
                    <span className="text-white/60 text-xs">Price Range</span><span className="text-right text-white">$15-25</span>
                    <span className="text-white/60 text-xs">Leaderboard Jump</span><span className="text-right text-white">+12 positions</span>
                  </div>
                  <button className="mt-4 w-full rounded-sm border border-[#FD7A10] text-[#FD7A10] text-xs py-2">3 Available Content</button>
                </div>
              ))}
            </div>
            */}
          </Card>

          {/* Your vs community performance */}
          <Card>
            <div className="flex items-center justify-between space-y-4">
              <div className="text-white text-sm font-medium ">YOUR VS COMMUNITY PERFORMANCE</div>
              <div className="flex items-center gap-3 text-[11px] text-white/70">
                <span className="inline-block w-2 h-2 rounded-full bg-[#FD7A10]" />
                <span className="text-xs text-[#FD7A10]"> You</span>
                <span className="inline-block w-2 h-2 rounded-full bg-[#FEBC2F]" />
                <span className="text-xs text-[#FEBC2F]"> Community</span>
              </div>
            </div>
            <div className="flex items-center justify-center py-8">
              <div className="text-white/60 text-sm text-center">No performance data available</div>
            </div>
            {/* TODO: Restore when data is available
            <PerfBar label="Gaming content" you={52} community={65} />
            <PerfBar label="DeFi content" you={42} community={68} />
            <PerfBar label="Meme content" you={36} community={88} />
            */}
          </Card>

          {/* What's working for top yappers */}
          <Card>
            <div className="flex items-center justify-between space-y-4"><div className="text-white text-sm font-medium">WHAT'S WORKING FOR TOP YAPPERS</div><button className="text-white text-xs">View all</button></div>
            <div className="flex items-center justify-center py-8">
              <div className="text-white/60 text-sm text-center">No top yapper data available</div>
            </div>
            {/* TODO: Restore when data is available
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2 text-white/90 text-sm">
                    <div className="w-8 h-8 flex items-center justify-center">
                      <img src="/trophy.svg" alt="trophy" width={24} height={24} className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col items-start justify-start gap-1">
                      <div className="text-white text-sm font-medium">Gaming DeFi</div>
                      <div className="text-white/80 text-xs">47 yappers bought this week</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white text-xs">+254 SNAP</div>
                    <div className="text-white/80 text-[10px]">avg earned</div>
                  </div>
                </div>
              ))}
            </div>
            */}
          </Card>

          {/* AI-Recommended content */}
          <Card>
            <div className="flex items-center justify-between space-y-4"><div className="text-white text-sm font-medium">AI-RECOMMENDATION CONTENT (HIGH PREDICTION)</div><button className="text-white text-xs">View all</button></div>
            <div className="flex items-center justify-center py-8">
              <div className="text-white/60 text-sm text-center">No AI recommendation data available</div>
            </div>
            {/* TODO: Restore when data is available
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2 text-white/90 text-sm">
                    <div className="w-8 h-8 flex items-center justify-center">
                      <img src="/bulb.svg" alt="AI recommendation" width={24} height={24} className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col items-start justify-start gap-1">
                      <div className="text-white text-sm font-medium">Gaming DeFi</div>
                      <div className="text-white/80 text-xs">47 yappers bought this week</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white text-xs">+254 SNAP</div>
                    <div className="text-white/80 text-[10px]">avg earned</div>
                  </div>
                </div>
              ))}
            </div>
            */}
          </Card>
        </div>

        {/* Right: AI insights + algorithm intelligence */}
        <div className="space-y-4">
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 bg-[#2b1a1a] px-6 py-4 rounded-t-xl">
              <h3 className="text-white text-sm font-medium">PERFORMANCE INSIGHTS</h3>
              <span className="text-white/40 text-xs">Updated 5 min ago</span>
            </div>
            <div className="flex flex-col gap-2 rounded-b-xl bg-[#2b1a1a] px-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-center py-8">
                <div className="text-white/60 text-sm text-center">No performance insights data available</div>
              </div>
            </div>
            {/* TODO: Restore when data is available
            <div className="flex flex-col gap-2 rounded-b-xl bg-[#2b1a1a] px-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <InsightItem label="Hot Opportunity Alert" value="Gaming DeFi content showing 340% ROI spike - Window closes in 4 hours" right="Only 3 high-prediction pieces available at optimal price" className="text-[#FEBC2F]" />
              <InsightItem label="Your Best Category" value="Gaming content: 156% ROI" right="You outperform 78% of similar yappers in this category" className="text-[#FEBC2F]" />
              <InsightItem label="Competitive Intel" value="Top 10% yappers buy 3.2x more gaming content" right="Your competitors spending average $87/week " className="text-[#FEBC2F]" />
              <InsightItem label="AI Confidence Level" value="Our AI is 87% confident in gaming content predictions" right="Historical accuracy: 87% for your profile type" className="text-[#FEBC2F]" />
            </div>
            */}
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 bg-[#2b1a1a] px-6 py-4 rounded-t-xl">
              <h3 className="text-white text-sm font-medium">MARKET INSIGHTS</h3>
              <span className="text-white/40 text-xs">Updated 5 min ago</span>
            </div>
            <div className="flex flex-col gap-2 rounded-b-xl bg-[#2b1a1a] px-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-center py-8">
                <div className="text-white/60 text-sm text-center">No market insights data available</div>
              </div>
            </div>
            {/* TODO: Restore when data is available
            <div className="flex flex-col gap-2 rounded-b-xl bg-[#2b1a1a] px-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <InsightItem label="Algorithm Update Detected" value="Gaming content getting 2.3x boost" right="Recommendation: Gaming memes showing 340% ROI " className="text-[#CAB6FF]" sublabel="Peak performance" time="2-4 PM EST" info="/star.svg" />
              <InsightItem label="Trending Pattern" value="Achievement-framed content trending" right="Window: Next 2 hours for max impact 10" className="text-[#A1E8FF]" sublabel="Pattern expires in" time="4 hours" info="/thunder.svg" />
              <InsightItem label="Community Intel" value="47 yappers bought gaming content today" right="Success rate: 73% for users like you" className="text-[#FD7A10]" sublabel="Avg earnings" time="+156 SNAP" info="/profile.svg" />
              <InsightItem label="Time-Sensitive" value="Only 3 high-prediction pieces left" right="Expected: +400 SNAP, climb 20 positionsM" sublabel="Price locked until" time="11:59 PM" info="/time.svg" />
            </div>
            */}
          </div>
        </div>
      </div>
    </section>
  )
} 