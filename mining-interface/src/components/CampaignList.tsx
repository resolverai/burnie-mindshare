'use client'

import React, { useState } from 'react'

interface Campaign {
  id: number
  title: string
  slug: string
  description: string
  brandGuidelines?: string
  guidelines?: string
  topic: string
  campaign_type: string
  category?: string
  keywords?: string[]
  min_token_spend: number
  winner_reward: number
  max_submissions: number
  current_submissions: number
  submission_deadline: string
  time_remaining: number
  submission_rate: number
  is_full: boolean
}

interface CampaignListProps {
  campaigns: Campaign[]
  selectedCampaign: Campaign | null
  onCampaignSelect: (campaign: Campaign) => void
}

export function CampaignList({ campaigns, selectedCampaign, onCampaignSelect }: CampaignListProps) {
  const [filter, setFilter] = useState<string>('all')

  const filteredCampaigns = campaigns.filter(campaign => {
    if (filter === 'all') return true
    if (filter === 'high-reward') return (campaign.winner_reward || 0) >= 1000
    if (filter === 'low-competition') return (campaign.submission_rate || 0) < 0.5
    return campaign.category === filter || campaign.campaign_type === filter
  })

  const formatTimeRemaining = (hours: number) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`
    } else if (hours < 24) {
      return `${Math.round(hours)}h`
    } else {
      return `${Math.round(hours / 24)}d`
    }
  }

  const getProgressColor = (rate: number) => {
    if (rate < 0.3) return 'neon-progress-bar'
    if (rate < 0.7) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const getCampaignTypeEmoji = (type: string) => {
    switch (type) {
      case 'roast': return '🔥'
      case 'meme': return '😂'
      case 'creative': return '🎨'
      case 'viral': return '⚡'
      case 'brand': return '🏢'
      default: return '💬'
    }
  }

  const getCampaignTypeColor = (type: string) => {
    switch (type) {
      case 'roast': return 'neon-red'
      case 'meme': return 'neon-purple'
      case 'creative': return 'neon-orange'
      case 'viral': return 'neon-blue'
      case 'brand': return 'neon-blue'
      default: return 'neon-green'
    }
  }

  return (
    <div className="gaming-card gaming-card-glow p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">🎯</span>
          <h2 className="neon-text neon-orange text-xl font-bold">ACTIVE CAMPAIGNS</h2>
        </div>
        <div className="neon-text neon-blue text-sm font-mono">
          {filteredCampaigns.length} missions
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {['all', 'high-reward', 'low-competition', 'roast', 'meme', 'creative'].map((filterOption) => (
            <button
              key={filterOption}
              onClick={() => setFilter(filterOption)}
              className={`px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wide transition-all ${
                filter === filterOption
                  ? 'neon-button'
                  : 'gaming-card text-gray-400 hover:text-gray-200 border border-gray-600 hover:border-gray-500'
              }`}
            >
              {filterOption.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign List */}
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {filteredCampaigns.length === 0 ? (
          <div className="text-center py-8">
            <div className="neon-text neon-purple text-4xl mb-2">🔍</div>
            <p className="text-gray-400">No campaigns match your filters</p>
          </div>
        ) : (
          filteredCampaigns.map((campaign) => (
            <div
              key={campaign.id}
              onClick={() => onCampaignSelect(campaign)}
              className={`gaming-card cursor-pointer transition-all p-4 ${
                selectedCampaign?.id === campaign.id
                  ? 'border-orange-500 gaming-card-glow'
                  : 'hover:gaming-card-glow'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">{getCampaignTypeEmoji(campaign.campaign_type)}</div>
                  <div>
                    <h3 className="neon-text neon-blue font-bold text-sm uppercase tracking-wide">
                      {campaign.title}
                    </h3>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`neon-text ${getCampaignTypeColor(campaign.campaign_type)} text-xs font-mono uppercase`}>
                        {campaign.campaign_type}
                      </span>
                      <span className="text-gray-400 text-xs">•</span>
                      <span className="text-gray-400 text-xs uppercase">{campaign.category}</span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="neon-text neon-green text-lg font-bold font-mono">
                    {(campaign.winner_reward || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide">ROAST</div>
                  <div className="text-xs text-gray-400 mt-1">
                    ⏱️ {formatTimeRemaining(campaign.time_remaining || 0)}
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-300 mb-3 line-clamp-2">
                {campaign.brandGuidelines || campaign.guidelines || 'No brand guidelines provided.'}
              </p>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400 uppercase tracking-wide">Min Stake:</span>
                  <span className="neon-text neon-orange font-mono font-bold">
                    {campaign.min_token_spend || 0} ROAST
                  </span>
                </div>
                
                {campaign.is_full && (
                  <span className="bg-red-600 neon-text neon-red px-2 py-1 rounded-full text-xs font-mono uppercase tracking-wide">
                    FULL
                  </span>
                )}
              </div>

              {campaign.keywords && campaign.keywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {campaign.keywords.slice(0, 3).map((keyword, index) => (
                    <span
                      key={index}
                      className="gaming-card text-gray-300 px-2 py-1 text-xs font-mono"
                    >
                      #{keyword}
                    </span>
                  ))}
                  {campaign.keywords.length > 3 && (
                    <span className="text-xs text-gray-400 font-mono">
                      +{campaign.keywords.length - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
} 