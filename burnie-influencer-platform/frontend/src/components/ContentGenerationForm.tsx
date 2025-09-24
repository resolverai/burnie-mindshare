'use client'

import React, { useState } from 'react'
import { useAccount } from 'wagmi'
import { useMutation } from '@tanstack/react-query'
import VideoOptions from './VideoOptions'
import { 
  PlayIcon,
  SparklesIcon,
  ClockIcon
} from '@heroicons/react/24/outline'

interface ContentGenerationFormProps {
  onContentGenerated?: (executionId: string) => void
  className?: string
}

interface Campaign {
  campaign_id: number
  title: string
  platform_source: string
  project_name?: string
  post_type: string
  include_brand_logo: boolean
  selected_yapper_handle?: string
  price: number
}

interface UserPreferences {
  voice_tone: string
  personality: string
  creativity_level: number
}

interface UserApiKeys {
  openai?: string
  anthropic?: string
  fal?: string
  grok?: string
}

export default function ContentGenerationForm({ 
  onContentGenerated, 
  className = '' 
}: ContentGenerationFormProps) {
  const { address } = useAccount()
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [includeVideo, setIncludeVideo] = useState(false)
  const [videoDuration, setVideoDuration] = useState(10)
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({
    voice_tone: 'professional',
    personality: 'engaging',
    creativity_level: 7
  })
  const [userApiKeys, setUserApiKeys] = useState<UserApiKeys>({
    openai: '',
    anthropic: '',
    fal: '',
    grok: ''
  })

  // Mock campaigns - in real implementation, these would come from an API
  const mockCampaigns: Campaign[] = [
    {
      campaign_id: 1,
      title: 'DeFi Innovation Campaign',
      platform_source: 'Twitter',
      project_name: 'Multipli',
      post_type: 'thread',
      include_brand_logo: true,
      selected_yapper_handle: 'crypto_expert',
      price: 50
    },
    {
      campaign_id: 2,
      title: 'NFT Art Showcase',
      platform_source: 'Twitter',
      project_name: 'ArtChain',
      post_type: 'visual',
      include_brand_logo: true,
      selected_yapper_handle: 'art_critic',
      price: 75
    }
  ]

  const generateContentMutation = useMutation({
    mutationFn: async (formData: any) => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/yapper-interface/generate-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Content generation failed')
      }

      return response.json()
    },
    onSuccess: (data) => {
      console.log('✅ Content generation started:', data)
      onContentGenerated?.(data.execution_id)
      setIsGenerating(false)
    },
    onError: (error) => {
      console.error('❌ Content generation failed:', error)
      setIsGenerating(false)
    }
  })

  const handleGenerateContent = async () => {
    if (!address || !selectedCampaign) {
      alert('Please connect your wallet and select a campaign')
      return
    }

    setIsGenerating(true)

    try {
      await generateContentMutation.mutateAsync({
        wallet_address: address,
        campaigns: [selectedCampaign],
        user_preferences: userPreferences,
        user_api_keys: userApiKeys,
        source: 'yapper_interface',
        include_video: includeVideo,
        video_duration: videoDuration
      })
    } catch (error) {
      console.error('Content generation error:', error)
    }
  }

  return (
    <div className={`bg-white rounded-lg shadow-lg p-6 ${className}`}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Generate Content</h2>
        <p className="text-gray-600">Create AI-powered content for your campaigns</p>
      </div>

      <div className="space-y-6">
        {/* Campaign Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Campaign
          </label>
          <select
            value={selectedCampaign?.campaign_id || ''}
            onChange={(e) => {
              const campaign = mockCampaigns.find(c => c.campaign_id === parseInt(e.target.value))
              setSelectedCampaign(campaign || null)
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Choose a campaign...</option>
            {mockCampaigns.map((campaign) => (
              <option key={campaign.campaign_id} value={campaign.campaign_id}>
                {campaign.title} - {campaign.project_name}
              </option>
            ))}
          </select>
        </div>

        {/* Video Options */}
        <VideoOptions
          includeVideo={includeVideo}
          videoDuration={videoDuration}
          onVideoToggle={setIncludeVideo}
          onDurationChange={setVideoDuration}
        />

        {/* User Preferences */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Voice Tone
            </label>
            <select
              value={userPreferences.voice_tone}
              onChange={(e) => setUserPreferences(prev => ({ ...prev, voice_tone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="humorous">Humorous</option>
              <option value="technical">Technical</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Personality
            </label>
            <select
              value={userPreferences.personality}
              onChange={(e) => setUserPreferences(prev => ({ ...prev, personality: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="engaging">Engaging</option>
              <option value="authoritative">Authoritative</option>
              <option value="friendly">Friendly</option>
              <option value="creative">Creative</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Creativity Level: {userPreferences.creativity_level}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={userPreferences.creativity_level}
              onChange={(e) => setUserPreferences(prev => ({ ...prev, creativity_level: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>

        {/* API Keys */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">API Keys (Optional)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                OpenAI API Key
              </label>
              <input
                type="password"
                value={userApiKeys.openai || ''}
                onChange={(e) => setUserApiKeys(prev => ({ ...prev, openai: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Anthropic API Key
              </label>
              <input
                type="password"
                value={userApiKeys.anthropic || ''}
                onChange={(e) => setUserApiKeys(prev => ({ ...prev, anthropic: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="sk-ant-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                FAL API Key
              </label>
              <input
                type="password"
                value={userApiKeys.fal || ''}
                onChange={(e) => setUserApiKeys(prev => ({ ...prev, fal: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="fal-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Grok API Key
              </label>
              <input
                type="password"
                value={userApiKeys.grok || ''}
                onChange={(e) => setUserApiKeys(prev => ({ ...prev, grok: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="grok-..."
              />
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerateContent}
          disabled={!address || !selectedCampaign || isGenerating}
          className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              <span>Generating Content...</span>
            </>
          ) : (
            <>
              <SparklesIcon className="h-5 w-5" />
              <span>Generate Content</span>
            </>
          )}
        </button>

        {/* Generation Info */}
        {includeVideo && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex items-center gap-2 text-blue-800">
              <PlayIcon className="h-5 w-5" />
              <span className="font-medium">Video Generation Enabled</span>
            </div>
            <p className="text-blue-700 text-sm mt-1">
              Duration: {videoDuration} seconds • Estimated time: {Math.ceil(videoDuration / 5) + 2} minutes
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
