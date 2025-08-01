'use client'

import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'

// Types matching our enhanced Campaign model
export enum CampaignCategory {
  AI_DEFI = 'ai_defi',
  AI_AGENTS = 'ai_agents', 
  CRYPTO_AI = 'crypto_ai',
  GAMING = 'gaming',
  SOCIAL_AI = 'social_ai',
  INFRASTRUCTURE = 'infrastructure',
  OTHER = 'other',
}

export enum TokenType {
  PROJECT_TOKEN = 'project_token',
  USDC = 'usdc',
  ROAST = 'roast',
  ETH = 'eth',
}

interface RewardDistribution {
  roasters: number // Content creators (equivalent to cSnappers)
  yappers: number // Social promoters (equivalent to snappers) 
  platform: number // Platform fee
  bonus_pool: number // Additional rewards
}

interface CampaignMilestone {
  id: string
  title: string
  description: string
  date: Date
  type: 'tge' | 'airdrop' | 'presale' | 'launch' | 'marketing' | 'other'
  completed: boolean
  reward_amount?: number
}

interface CampaignFormData {
  title: string
  description: string
  campaign_guide: string
  category: CampaignCategory
  total_reward_pool: number
  reward_token_type: TokenType
  reward_token_address?: string
  reward_distribution: RewardDistribution
  start_date: Date
  end_date: Date
  tge_date?: Date
  airdrop_date?: Date
  milestones: CampaignMilestone[]
  max_submissions: number
  max_blocks: number
  min_stake_amount: number
  content_types: string[]
  content_guidelines: string[]
  hashtags: string[]
  mentions: string[]
  eligibility_requirements: {
    min_roast_stake?: number
    twitter_required: boolean
    min_followers?: number
    kyc_required: boolean
    whitelist_only: boolean
  }
  social_media_config: {
    twitter_campaign_hashtag?: string
    farcaster_channel?: string
    auto_retweet: boolean
    engagement_tracking: boolean
  }
}

interface CampaignCreationWizardProps {
  onSubmit: (campaignData: CampaignFormData) => Promise<void>
  onClose: () => void
  isLoading?: boolean
}

export default function CampaignCreationWizard({ 
  onSubmit, 
  onClose, 
  isLoading = false 
}: CampaignCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<CampaignFormData>({
    title: '',
    description: '',
    campaign_guide: '',
    category: CampaignCategory.AI_DEFI,
    total_reward_pool: 0,
    reward_token_type: TokenType.ROAST,
    reward_distribution: {
      roasters: 80, // Like cookie.fun's cSnappers
      yappers: 15,  // Like cookie.fun's snappers
      platform: 3,
      bonus_pool: 2
    },
    start_date: new Date(),
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    milestones: [],
    max_submissions: 1500,
    max_blocks: 30,
    min_stake_amount: 1.0,
    content_types: ['text'],
    content_guidelines: [],
    hashtags: [],
    mentions: [],
    eligibility_requirements: {
      twitter_required: true,
      kyc_required: false,
      whitelist_only: false
    },
    social_media_config: {
      auto_retweet: true,
      engagement_tracking: true
    }
  })

  const steps = [
    { id: 1, title: 'Basic Info', description: 'Campaign details and category' },
    { id: 2, title: 'Reward Pool', description: 'Token rewards and distribution' },
    { id: 3, title: 'Timeline', description: 'Schedule and milestones' },
    { id: 4, title: 'Content Rules', description: 'Guidelines and requirements' },
    { id: 5, title: 'Eligibility', description: 'Participant requirements' },
    { id: 6, title: 'Review', description: 'Final review and launch' }
  ]

  const categoryLabels = {
    [CampaignCategory.AI_DEFI]: 'AI DeFi',
    [CampaignCategory.AI_AGENTS]: 'AI Agents',
    [CampaignCategory.CRYPTO_AI]: 'Crypto AI',
    [CampaignCategory.GAMING]: 'Gaming',
    [CampaignCategory.SOCIAL_AI]: 'Social AI',
    [CampaignCategory.INFRASTRUCTURE]: 'Infrastructure',
    [CampaignCategory.OTHER]: 'Other'
  }

  const updateFormData = (updates: Partial<CampaignFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }))
  }

  const addMilestone = () => {
    const newMilestone: CampaignMilestone = {
      id: `milestone_${Date.now()}`,
      title: '',
      description: '',
      date: new Date(),
      type: 'other',
      completed: false
    }
    updateFormData({
      milestones: [...formData.milestones, newMilestone]
    })
  }

  const updateMilestone = (index: number, updates: Partial<CampaignMilestone>) => {
    const updatedMilestones = formData.milestones.map((milestone, i) =>
      i === index ? { ...milestone, ...updates } : milestone
    )
    updateFormData({ milestones: updatedMilestones })
  }

  const removeMilestone = (index: number) => {
    updateFormData({
      milestones: formData.milestones.filter((_, i) => i !== index)
    })
  }

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(formData.title && formData.description && formData.category)
      case 2:
        return formData.total_reward_pool > 0 && 
               formData.reward_distribution.roasters + 
               formData.reward_distribution.yappers + 
               formData.reward_distribution.platform + 
               formData.reward_distribution.bonus_pool === 100
      case 3:
        return formData.start_date < formData.end_date
      case 4:
        return formData.content_types.length > 0
      case 5:
        return true // No strict validation for eligibility
      default:
        return true
    }
  }

  const nextStep = () => {
    if (validateStep(currentStep) && currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    if (validateStep(currentStep)) {
      await onSubmit(formData)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Campaign Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => updateFormData({ title: e.target.value })}
                placeholder="e.g., Introducing cROAST campaign with YourProject"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Campaign Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => updateFormData({ description: e.target.value })}
                placeholder="Describe your campaign, its goals, and what participants should create..."
                rows={4}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => updateFormData({ category: e.target.value as CampaignCategory })}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Campaign Guide (Optional)
              </label>
              <textarea
                value={formData.campaign_guide}
                onChange={(e) => updateFormData({ campaign_guide: e.target.value })}
                placeholder="Detailed instructions, examples, and guidelines for participants..."
                rows={6}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Total Reward Pool
              </label>
              <div className="flex space-x-4">
                <input
                  type="number"
                  value={formData.total_reward_pool}
                  onChange={(e) => updateFormData({ total_reward_pool: parseFloat(e.target.value) || 0 })}
                  placeholder="10000"
                  className="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                  required
                />
                <select
                  value={formData.reward_token_type}
                  onChange={(e) => updateFormData({ reward_token_type: e.target.value as TokenType })}
                  className="px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                >
                  <option value={TokenType.ROAST}>ROAST</option>
                  <option value={TokenType.USDC}>USDC</option>
                  <option value={TokenType.PROJECT_TOKEN}>Project Token</option>
                  <option value={TokenType.ETH}>ETH</option>
                </select>
              </div>
            </div>

            {formData.reward_token_type === TokenType.PROJECT_TOKEN && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token Contract Address
                </label>
                <input
                  type="text"
                  value={formData.reward_token_address || ''}
                  onChange={(e) => updateFormData({ reward_token_address: e.target.value })}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-4">
                Reward Distribution (Inspired by cookie.fun)
              </label>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Roasters (Content Creators)</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={formData.reward_distribution.roasters}
                      onChange={(e) => updateFormData({
                        reward_distribution: {
                          ...formData.reward_distribution,
                          roasters: parseInt(e.target.value) || 0
                        }
                      })}
                      className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-center"
                      min="0"
                      max="100"
                    />
                    <span className="text-gray-400">%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Yappers (Social Promoters)</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={formData.reward_distribution.yappers}
                      onChange={(e) => updateFormData({
                        reward_distribution: {
                          ...formData.reward_distribution,
                          yappers: parseInt(e.target.value) || 0
                        }
                      })}
                      className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-center"
                      min="0"
                      max="100"
                    />
                    <span className="text-gray-400">%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Platform Fee</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={formData.reward_distribution.platform}
                      onChange={(e) => updateFormData({
                        reward_distribution: {
                          ...formData.reward_distribution,
                          platform: parseInt(e.target.value) || 0
                        }
                      })}
                      className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-center"
                      min="0"
                      max="100"
                    />
                    <span className="text-gray-400">%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Bonus Pool</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={formData.reward_distribution.bonus_pool}
                      onChange={(e) => updateFormData({
                        reward_distribution: {
                          ...formData.reward_distribution,
                          bonus_pool: parseInt(e.target.value) || 0
                        }
                      })}
                      className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-center"
                      min="0"
                      max="100"
                    />
                    <span className="text-gray-400">%</span>
                  </div>
                </div>

                <div className="border-t border-gray-600 pt-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-white">Total</span>
                    <span className={`${
                      formData.reward_distribution.roasters + 
                      formData.reward_distribution.yappers + 
                      formData.reward_distribution.platform + 
                      formData.reward_distribution.bonus_pool === 100 
                        ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {formData.reward_distribution.roasters + 
                       formData.reward_distribution.yappers + 
                       formData.reward_distribution.platform + 
                       formData.reward_distribution.bonus_pool}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      case 3:
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Campaign Start Date
                </label>
                <input
                  type="datetime-local"
                  value={format(formData.start_date, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => updateFormData({ start_date: new Date(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Campaign End Date
                </label>
                <input
                  type="datetime-local"
                  value={format(formData.end_date, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => updateFormData({ end_date: new Date(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  TGE Date (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={formData.tge_date ? format(formData.tge_date, "yyyy-MM-dd'T'HH:mm") : ''}
                  onChange={(e) => updateFormData({ 
                    tge_date: e.target.value ? new Date(e.target.value) : undefined 
                  })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Airdrop Date (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={formData.airdrop_date ? format(formData.airdrop_date, "yyyy-MM-dd'T'HH:mm") : ''}
                  onChange={(e) => updateFormData({ 
                    airdrop_date: e.target.value ? new Date(e.target.value) : undefined 
                  })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-medium text-gray-300">
                  Campaign Milestones
                </label>
                <button
                  type="button"
                  onClick={addMilestone}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm"
                >
                  Add Milestone
                </button>
              </div>

              <div className="space-y-4">
                {formData.milestones.map((milestone, index) => (
                  <div key={milestone.id} className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <input
                        type="text"
                        value={milestone.title}
                        onChange={(e) => updateMilestone(index, { title: e.target.value })}
                        placeholder="Milestone title"
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                      />
                      <select
                        value={milestone.type}
                        onChange={(e) => updateMilestone(index, { type: e.target.value as any })}
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      >
                        <option value="tge">TGE</option>
                        <option value="airdrop">Airdrop</option>
                        <option value="presale">Presale</option>
                        <option value="launch">Launch</option>
                        <option value="marketing">Marketing</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <input
                        type="datetime-local"
                        value={format(milestone.date, "yyyy-MM-dd'T'HH:mm")}
                        onChange={(e) => updateMilestone(index, { date: new Date(e.target.value) })}
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                      />
                      <input
                        type="number"
                        value={milestone.reward_amount || ''}
                        onChange={(e) => updateMilestone(index, { 
                          reward_amount: e.target.value ? parseFloat(e.target.value) : undefined 
                        })}
                        placeholder="Reward amount (optional)"
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                      />
                    </div>
                    <div className="flex items-end justify-between">
                      <textarea
                        value={milestone.description}
                        onChange={(e) => updateMilestone(index, { description: e.target.value })}
                        placeholder="Milestone description"
                        rows={2}
                        className="flex-1 mr-4 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400"
                      />
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Allowed Content Types
              </label>
              <div className="grid grid-cols-2 gap-4">
                {['text', 'image', 'video', 'audio'].map(type => (
                  <label key={type} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.content_types.includes(type)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateFormData({ content_types: [...formData.content_types, type] })
                        } else {
                          updateFormData({ 
                            content_types: formData.content_types.filter(t => t !== type) 
                          })
                        }
                      }}
                      className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-gray-300 capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Submissions
                </label>
                <input
                  type="number"
                  value={formData.max_submissions}
                  onChange={(e) => updateFormData({ max_submissions: parseInt(e.target.value) || 1500 })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Blocks
                </label>
                <input
                  type="number"
                  value={formData.max_blocks}
                  onChange={(e) => updateFormData({ max_blocks: parseInt(e.target.value) || 30 })}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                  min="1"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Minimum ROAST Stake
              </label>
              <input
                type="number"
                value={formData.min_stake_amount}
                onChange={(e) => updateFormData({ min_stake_amount: parseFloat(e.target.value) || 1.0 })}
                step="0.1"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Required Hashtags (one per line)
              </label>
              <textarea
                value={formData.hashtags.join('\n')}
                onChange={(e) => updateFormData({ 
                  hashtags: e.target.value.split('\n').filter(tag => tag.trim()) 
                })}
                placeholder="#YourProject&#10;#ROAST&#10;#AI"
                rows={3}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Content Guidelines (one per line)
              </label>
              <textarea
                value={formData.content_guidelines.join('\n')}
                onChange={(e) => updateFormData({ 
                  content_guidelines: e.target.value.split('\n').filter(guideline => guideline.trim()) 
                })}
                placeholder="Keep content engaging and humorous&#10;Include project mention&#10;Follow community guidelines"
                rows={4}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        )

      case 5:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.eligibility_requirements.twitter_required}
                  onChange={(e) => updateFormData({
                    eligibility_requirements: {
                      ...formData.eligibility_requirements,
                      twitter_required: e.target.checked
                    }
                  })}
                  className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-gray-300">Twitter account required</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.eligibility_requirements.kyc_required}
                  onChange={(e) => updateFormData({
                    eligibility_requirements: {
                      ...formData.eligibility_requirements,
                      kyc_required: e.target.checked
                    }
                  })}
                  className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-gray-300">KYC verification required</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.eligibility_requirements.whitelist_only}
                  onChange={(e) => updateFormData({
                    eligibility_requirements: {
                      ...formData.eligibility_requirements,
                      whitelist_only: e.target.checked
                    }
                  })}
                  className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-gray-300">Whitelist only</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Minimum Followers (Optional)
              </label>
              <input
                type="number"
                value={formData.eligibility_requirements.min_followers || ''}
                onChange={(e) => updateFormData({
                  eligibility_requirements: {
                    ...formData.eligibility_requirements,
                    min_followers: e.target.value ? parseInt(e.target.value) : undefined
                  }
                })}
                placeholder="100"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Twitter Campaign Hashtag
              </label>
              <input
                type="text"
                value={formData.social_media_config.twitter_campaign_hashtag || ''}
                onChange={(e) => updateFormData({
                  social_media_config: {
                    ...formData.social_media_config,
                    twitter_campaign_hashtag: e.target.value
                  }
                })}
                placeholder="#YourCampaign"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div className="space-y-4">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.social_media_config.auto_retweet}
                  onChange={(e) => updateFormData({
                    social_media_config: {
                      ...formData.social_media_config,
                      auto_retweet: e.target.checked
                    }
                  })}
                  className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-gray-300">Auto-retweet winning content</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.social_media_config.engagement_tracking}
                  onChange={(e) => updateFormData({
                    social_media_config: {
                      ...formData.social_media_config,
                      engagement_tracking: e.target.checked
                    }
                  })}
                  className="rounded border-gray-600 bg-gray-700 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-gray-300">Track engagement metrics</span>
              </label>
            </div>
          </div>
        )

      case 6:
        return (
          <div className="space-y-6">
            <div className="bg-gray-700/50 p-6 rounded-lg border border-gray-600">
              <h3 className="text-lg font-semibold text-white mb-4">Campaign Summary</h3>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Title:</span>
                  <span className="text-white">{formData.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Category:</span>
                  <span className="text-white">{categoryLabels[formData.category]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Reward Pool:</span>
                  <span className="text-white">
                    {formData.total_reward_pool.toLocaleString()} {formData.reward_token_type.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Duration:</span>
                  <span className="text-white">
                    {format(formData.start_date, 'MMM dd')} - {format(formData.end_date, 'MMM dd, yyyy')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Max Submissions:</span>
                  <span className="text-white">{formData.max_submissions.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Content Types:</span>
                  <span className="text-white">{formData.content_types.join(', ')}</span>
                </div>
              </div>
            </div>

            <div className="bg-orange-600/10 border border-orange-500/30 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="text-orange-400 text-xl">⚠️</div>
                <div>
                  <h4 className="text-orange-400 font-semibold mb-1">Ready to Launch</h4>
                  <p className="text-gray-300 text-sm">
                    Please review all campaign details carefully. Once launched, some settings cannot be changed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90vh] mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white">Create Campaign</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center ${step.id < steps.length ? 'flex-1' : ''}`}
              >
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  step.id === currentStep
                    ? 'bg-orange-600 text-white'
                    : step.id < currentStep
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                }`}>
                  {step.id < currentStep ? '✓' : step.id}
                </div>
                <div className="ml-3">
                  <div className="text-sm font-medium text-white">{step.title}</div>
                  <div className="text-xs text-gray-400">{step.description}</div>
                </div>
                {step.id < steps.length && (
                  <div className={`flex-1 h-0.5 mx-4 ${
                    step.id < currentStep ? 'bg-green-600' : 'bg-gray-600'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderStepContent()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>

          <div className="text-sm text-gray-400">
            Step {currentStep} of {steps.length}
          </div>

          {currentStep < steps.length ? (
            <button
              onClick={nextStep}
              disabled={!validateStep(currentStep)}
              className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!validateStep(currentStep) || isLoading}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Creating...' : 'Launch Campaign'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
} 