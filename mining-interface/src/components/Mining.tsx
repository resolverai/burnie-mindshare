import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import api from '../services/burnie-api'
import { 
  PlayIcon, StopIcon, ClockIcon, BoltIcon, TrophyIcon, RocketLaunchIcon, 
  CheckCircleIcon, XCircleIcon, DocumentDuplicateIcon, ChevronRightIcon,
  Cog6ToothIcon, ChartBarIcon
} from '@heroicons/react/24/outline'
import { 
  CheckCircleIcon as CheckCircleIconSolid, BoltIcon as BoltIconSolid,
  CheckIcon, XMarkIcon
} from '@heroicons/react/24/solid'

interface Campaign {
  id: number;
  title: string;
  slug: string;
  description: string;
  topic: string;
  campaign_type: 'roast' | 'meme' | 'creative' | 'viral' | 'social' | 'educational';
  category: string;
  platform_source: string;
  keywords: string[];
  guidelines: string;
  min_token_spend: number;
  winner_reward: string;
  max_submissions: number;
  current_submissions: number;
  submission_deadline: string;
  time_remaining: number;
  submission_rate: number;
  is_full: boolean;
  project: any;
}

interface PersonalizedAgent {
  id: string;
  name: string;
  personality: string;
  level: number;
  experience: number;
  maxExperience: number;
  quality: number;
  alignment: number;
  learning: number;
  status: string;
  deploys: number;
  x_account_connected: boolean;
  system_message: string;
  config: any;
  agentType: string;
}

interface CampaignSelection {
  campaign: Campaign;
  selectedAgent: PersonalizedAgent | null;
}

interface GeneratedContent {
  id: string;
  content_text: string;
  content_images?: string[];
  predicted_mindshare: number;
  quality_score: number;
  generation_metadata: {
    agents_used: string[];
    optimization_factors: string[];
    generation_time: number;
  };
  platformSource?: string;
  campaignId?: number;
  agentUsed?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
}

interface ContentReviewItem {
  campaign: Campaign;
  agent: PersonalizedAgent;
  content: GeneratedContent | null;
  status: 'idle' | 'generating' | 'reviewing' | 'approved' | 'rejected';
}

interface MiningStatus {
  status: 'idle' | 'analyzing' | 'generating' | 'optimizing' | 'completed' | 'error';
  progress: number;
  currentStep: string;
  generatedContent?: GeneratedContent;
  error?: string;
}

// All campaigns fetched dynamically from database - no mock data

export default function Mining() {
  const [selectedCampaigns, setSelectedCampaigns] = useState<CampaignSelection[]>([])
  const [miningStatus, setMiningStatus] = useState<MiningStatus>({ status: 'idle', progress: 0, currentStep: 'Ready to mine' })
  const [contentReviewItems, setContentReviewItems] = useState<ContentReviewItem[]>([])
  const { address } = useAccount()

  // Fetch available campaigns from centralized platform
  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns', 'marketplace-ready'],
    queryFn: async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
        const fullUrl = `${apiUrl}/campaigns/marketplace-ready?limit=20`
        console.log('🔍 Mining: Fetching campaigns from:', fullUrl)
        
        // Try to fetch from TypeScript backend first
        const response = await fetch(fullUrl)
        if (response.ok) {
          const data = await response.json()
          console.log('✅ Mining: Successfully fetched campaigns:', data.data?.length || 0, 'campaigns')
          return data.data || []
        }
        console.error('❌ Mining: Backend response not ok:', response.status, response.statusText)
        throw new Error(`Backend responded with ${response.status}`)
      } catch (error) {
        console.error('❌ Mining: Failed to fetch campaigns from backend:', error)
        // Return empty array if backend is not available - no mock data
        return []
      }
    },
    refetchInterval: 30000,
  })

  // Fetch user's agents
  const { data: userAgents, isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ['user-agents', address],
    queryFn: async () => {
      if (!address) {
        console.log('🔍 Mining: No wallet address available for fetching agents')
        return []
      }
      
      console.log('🔍 Mining: Fetching agents for wallet:', address)
      const apiUrl = `${process.env.NEXT_PUBLIC_BURNIE_API_URL}/agents/user/${address}`
      console.log('🔍 Mining: API URL:', apiUrl)
      
      const response = await fetch(apiUrl)
      const data = await response.json()
      
      console.log('🔍 Mining: Agents API response:', data)
      
      if (response.ok && data.success) {
        console.log('✅ Mining: Successfully fetched agents:', data.data)
        return data.data || []
      } else {
        console.log('❌ Mining: Failed to fetch agents or no agents found:', data)
        return []
      }
    },
    enabled: !!address,
  })

  const startMining = async () => {
    if (selectedCampaigns.length === 0) return

    try {
      setMiningStatus({ status: 'analyzing', progress: 10, currentStep: 'Connecting to AI backend...' })
      
      // Start mining session with Python AI backend
      const response = await fetch('http://localhost:8000/api/mining/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 1, // Mock user ID - should come from auth context
          campaigns: selectedCampaigns.map(selection => ({
            campaign_id: selection.campaign.id,
            agent_id: selection.selectedAgent?.id,
            campaign_context: {
              title: selection.campaign.title,
              description: selection.campaign.description,
              category: selection.campaign.category,
              campaign_type: selection.campaign.campaign_type,
              topic: selection.campaign.topic,
              guidelines: selection.campaign.guidelines,
              winner_reward: selection.campaign.winner_reward,
              platform_source: selection.campaign.platform_source
            }
          })),
          user_preferences: {
            preferred_tone: "engaging",
            preferred_length: 250,
            hashtag_preference: 3,
            emoji_usage: "moderate"
          }
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      const sessionId = data.session_id

      // Connect to WebSocket for real-time updates
      await connectToWebSocket(sessionId)

    } catch (error) {
          console.error('❌ Failed to start mining:', error)
          setMiningStatus({ 
            status: 'error', 
            progress: 0, 
            currentStep: 'Failed to connect to AI backend. Please ensure the Python AI backend is running on port 8000.',
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
  }

  const connectToWebSocket = async (sessionId: string) => {
    try {
      const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`)
      
      ws.onopen = () => {
        console.log('🔌 WebSocket connected')
        setMiningStatus({ status: 'analyzing', progress: 15, currentStep: 'Connected to AI agents...' })
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('📨 WebSocket message:', data)

          switch (data.type) {
            case 'progress_update':
              setMiningStatus({
                status: data.status || 'generating',
                progress: data.progress || 0,
                currentStep: data.current_step || 'Processing...'
              })
              break

            case 'agent_update':
              console.log(`🤖 Agent ${data.agent_type}: ${data.status}`)
              break

            case 'completion':
              // Handle multi-campaign content generation completion
              if (data.generated_content && Array.isArray(data.generated_content)) {
                // Multiple campaigns - update review items
                const reviewItems: ContentReviewItem[] = data.generated_content.map((content: any, index: number) => {
                  const selection = selectedCampaigns[index]
                  return {
                    campaign: selection.campaign,
                    agent: selection.selectedAgent!,
                    content: {
                      id: content.id || `${data.session_id}_${index}`,
                      content_text: content.content_text,
                      predicted_mindshare: content.predicted_mindshare,
                      quality_score: content.quality_score,
                      generation_metadata: content.generation_metadata,
                      platformSource: selection.campaign.platform_source,
                      campaignId: selection.campaign.id,
                      agentUsed: selection.selectedAgent?.name,
                      status: 'pending',
                      createdAt: new Date().toISOString()
                    },
                    status: 'reviewing'
                  }
                })
                setContentReviewItems(reviewItems)
              } else {
                // Single campaign - create review item
                const content = data.generated_content
                const selection = selectedCampaigns[0]
                const reviewItem: ContentReviewItem = {
                  campaign: selection.campaign,
                  agent: selection.selectedAgent!,
                  content: {
                    id: content.id || data.session_id,
                    content_text: content.content_text,
                    predicted_mindshare: content.predicted_mindshare,
                    quality_score: content.quality_score,
                    generation_metadata: content.generation_metadata,
                    platformSource: selection.campaign.platform_source,
                    campaignId: selection.campaign.id,
                    agentUsed: selection.selectedAgent?.name,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                  },
                  status: 'reviewing'
                }
                setContentReviewItems([reviewItem])
              }
              
              setMiningStatus({
                status: 'completed',
                progress: 100,
                currentStep: 'Content generated! Review and approve below.'
              })
              ws.close()
              break

            case 'error':
              console.error('❌ AI Backend Error:', data.error)
              setMiningStatus({
                status: 'idle',
                progress: 0,
                currentStep: `Error: ${data.error}`
              })
              ws.close()
              break

            case 'pong':
              // Heartbeat response
              break
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error)
        }
      }

              ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error)
          setMiningStatus({
            status: 'error',
            progress: 0,
            currentStep: 'WebSocket connection failed. Please ensure the Python AI backend is running.',
            error: 'WebSocket connection failed'
          })
        }

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected')
      }

      // Send periodic ping to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        } else {
          clearInterval(pingInterval)
        }
      }, 30000) // Ping every 30 seconds

            } catch (error) {
          console.error('❌ Failed to connect WebSocket:', error)
          setMiningStatus({
            status: 'error',
            progress: 0,
            currentStep: 'Failed to connect to AI backend. Please ensure the Python AI backend is running.',
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
  }

  const stopMining = () => {
    setMiningStatus({ status: 'idle', progress: 0, currentStep: 'Mining stopped' })
    setTimeout(() => {
      setMiningStatus({ status: 'idle', progress: 0, currentStep: 'Ready to mine' })
    }, 2000)
  }

  const toggleCampaignSelection = (campaign: Campaign) => {
    setSelectedCampaigns(prev => {
      const exists = prev.find(selection => selection.campaign.id === campaign.id)
      if (exists) {
        // Remove campaign
        return prev.filter(selection => selection.campaign.id !== campaign.id)
      } else {
        // Add campaign
        return [...prev, { campaign, selectedAgent: null }]
      }
    })
  }

  const updateSelectedAgent = (campaignId: number, agent: PersonalizedAgent | null) => {
    setSelectedCampaigns(prev => 
      prev.map(selection => 
        selection.campaign.id === campaignId 
          ? { ...selection, selectedAgent: agent }
          : selection
      )
    )
  }

  const isCampaignSelected = (campaignId: number) => {
    return selectedCampaigns.some(selection => selection.campaign.id === campaignId)
  }

  const getSelectedAgent = (campaignId: number) => {
    return selectedCampaigns.find(selection => selection.campaign.id === campaignId)?.selectedAgent || null
  }

  const approveContent = async (index: number) => {
    try {
      // Update local state immediately
      setContentReviewItems(prev => prev.map((item, i) => 
        i === index ? { ...item, status: 'approved' } : item
      ))

      // TODO: Send to backend for publication to Burnie influencer platform
      const reviewItem = contentReviewItems[index]
      console.log('✅ Content approved for publication:', {
        campaign: reviewItem.campaign.title,
        agent: reviewItem.agent.name,
        content: reviewItem.content?.content_text
      })

      // Here you would typically call the backend to publish to the marketplace
      // const response = await fetch('/api/content/approve', { ... })
      
    } catch (error) {
      console.error('❌ Failed to approve content:', error)
    }
  }

  const rejectContent = (index: number) => {
    // Update local state
    setContentReviewItems(prev => prev.map((item, i) => 
      i === index ? { ...item, status: 'rejected' } : item
    ))

    console.log('❌ Content rejected for campaign:', contentReviewItems[index].campaign.title)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    // You could add a toast notification here
  }

  const postToTwitter = (content: string) => {
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(content)}`
    window.open(twitterUrl, '_blank')
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Multi-Campaign AI Mining</h1>
          <p className="text-gray-400">Select campaigns from different platforms, assign your personalized agents, and generate Twitter-ready content optimized for maximum mindshare</p>
        </div>



        {/* Campaign Selection */}
        <div className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <TrophyIcon className="h-6 w-6 text-orange-400 mr-2" />
            Select Campaign
          </h2>
          
          {campaignsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mx-auto"></div>
              <p className="text-gray-400 mt-2">Loading campaigns...</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {campaignsData?.map((campaign) => (
                <div
                  key={campaign.id}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    isCampaignSelected(campaign.id)
                      ? 'border-orange-400 bg-orange-500/10'
                      : 'border-gray-600 bg-gray-700/30 hover:border-gray-500'
                  }`}
                >
                  {/* Campaign Selection Checkbox */}
                  <div className="flex items-start space-x-4">
                    <div className="flex items-center mt-1">
                      <input
                        type="checkbox"
                        id={`campaign-${campaign.id}`}
                        checked={isCampaignSelected(campaign.id)}
                        onChange={() => toggleCampaignSelection(campaign)}
                        className="w-4 h-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
                      />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        <h3 className="text-lg font-semibold text-white">{campaign.title}</h3>
                        <span className="ml-2 px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full">
                          {campaign.category}
                        </span>
                        <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                          campaign.platform_source === 'cookie.fun' ? 'bg-cyan-500/20 text-cyan-400' :
                          campaign.platform_source === 'yaps.kaito.ai' ? 'bg-purple-500/20 text-purple-400' :
                          campaign.platform_source === 'yap.market' ? 'bg-pink-500/20 text-pink-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {campaign.platform_source}
                        </span>
                        <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                          campaign.campaign_type === 'social' ? 'bg-green-500/20 text-green-400' :
                          campaign.campaign_type === 'meme' ? 'bg-purple-500/20 text-purple-400' :
                          campaign.campaign_type === 'educational' ? 'bg-blue-500/20 text-blue-400' :
                          campaign.campaign_type === 'roast' ? 'bg-red-500/20 text-red-400' :
                          campaign.campaign_type === 'creative' ? 'bg-cyan-500/20 text-cyan-400' :
                          campaign.campaign_type === 'viral' ? 'bg-pink-500/20 text-pink-400' :
                          'bg-orange-500/20 text-orange-400'
                        }`}>
                          {campaign.campaign_type.charAt(0).toUpperCase() + campaign.campaign_type.slice(1)}
                        </span>
              </div>
                      <p className="text-gray-400 text-sm mb-2">{campaign.description}</p>
                      <div className="flex items-center space-x-4 text-sm">
                        <span className="text-gray-300">
                          <span className="text-orange-400 font-semibold">{parseInt(campaign.winner_reward).toLocaleString()}</span> Tokens
                        </span>
                        <span className="text-gray-300">
                          Submissions: <span className="text-green-400 font-semibold">{campaign.current_submissions}/{campaign.max_submissions}</span>
                        </span>
            </div>
                      
                      {/* Agent Selection for Selected Campaigns */}
                      {isCampaignSelected(campaign.id) && (
                        <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Select Agent for this Campaign:
                          </label>
                          <select
                            value={getSelectedAgent(campaign.id)?.id || ''}
                            onChange={(e) => {
                              const selectedAgent = userAgents?.find((agent: PersonalizedAgent) => agent.id === e.target.value) || null
                              updateSelectedAgent(campaign.id, selectedAgent)
                            }}
                                                         className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                           >
                             <option value="">
                               {agentsLoading ? 'Loading agents...' : 
                                !address ? 'Connect wallet first' :
                                !userAgents || userAgents.length === 0 ? 'No agents found - create one in Agents screen' :
                                'Choose an agent...'}
                             </option>
                             {userAgents?.map((agent: PersonalizedAgent) => (
                               <option key={agent.id} value={agent.id}>
                                 {agent.name} ({agent.personality})
                               </option>
                             ))}
                           </select>
                          {getSelectedAgent(campaign.id) && (
                            <div className="mt-2 text-xs text-gray-400">
                              Agent: {getSelectedAgent(campaign.id)?.name} | Level: {getSelectedAgent(campaign.id)?.level} | Learning: {getSelectedAgent(campaign.id)?.learning}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>

        {/* Selected Campaigns Summary */}
        {selectedCampaigns.length > 0 && (
          <div className="bg-gray-800/50 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">
              Selected Campaigns ({selectedCampaigns.length})
            </h3>
            <div className="space-y-3">
              {selectedCampaigns.map((selection) => (
                <div key={selection.campaign.id} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                  <div>
                    <div className="font-medium text-white">{selection.campaign.title}</div>
                    <div className="text-sm text-gray-400">
                      {selection.campaign.platform_source} • {selection.campaign.campaign_type} • {parseInt(selection.campaign.winner_reward).toLocaleString()} tokens
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">
                      {selection.selectedAgent ? selection.selectedAgent.name : 'No agent selected'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {selection.selectedAgent ? `${selection.selectedAgent.personality} • Level ${selection.selectedAgent.level}` : 'Select an agent above'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mining Control */}
        <div className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <Cog6ToothIcon className="h-6 w-6 text-blue-400 mr-2" />
            AI Multi-Agentic System
          </h2>
          
          {miningStatus.status === 'idle' ? (
            <div className="text-center py-8">
              <BoltIconSolid className="h-16 w-16 text-orange-400 mx-auto mb-4" />
              <p className="text-gray-400 mb-6">
                {selectedCampaigns.length > 0 
                  ? `Ready to generate content for ${selectedCampaigns.length} campaign${selectedCampaigns.length > 1 ? 's' : ''}` 
                  : 'Select campaigns and assign agents to start mining'}
              </p>
              <button
                onClick={startMining}
                disabled={selectedCampaigns.length === 0 || selectedCampaigns.some(selection => !selection.selectedAgent)}
                className={`px-8 py-4 rounded-lg font-semibold transition-all flex items-center mx-auto ${
                  selectedCampaigns.length > 0 && selectedCampaigns.every(selection => selection.selectedAgent)
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                <RocketLaunchIcon className="h-5 w-5 mr-2" />
                Start Mining
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-3">
                <div 
                  className="bg-gradient-to-r from-orange-400 to-red-400 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${miningStatus.progress}%` }}
                ></div>
              </div>
              
              {/* Current Step */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">{miningStatus.currentStep}</span>
                <span className="text-orange-400 font-semibold">{miningStatus.progress}%</span>
            </div>

              {/* Agents Status */}
              <div className="grid grid-cols-5 gap-2 mt-4">
                {['Data Analyst', 'Content Strategist', 'Text Content', 'Visual Creator', 'Orchestrator'].map((agent, index) => (
                  <div key={agent} className={`p-2 rounded text-center text-xs ${
                    miningStatus.progress > index * 20 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/50 text-gray-500'
                  }`}>
                    {miningStatus.progress > index * 20 && <CheckCircleIconSolid className="h-4 w-4 mx-auto mb-1" />}
                    {agent}
                  </div>
                ))}
              </div>
              
              {/* Control Buttons */}
              <div className="flex justify-center mt-6">
                {miningStatus.status !== 'completed' ? (
                  <button
                    onClick={stopMining}
                    className="px-6 py-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors flex items-center"
                  >
                    <StopIcon className="h-5 w-5 mr-2" />
                    Stop Mining
                  </button>
                ) : (
                  <div className="flex items-center text-green-400">
                    <CheckCircleIcon className="h-6 w-6 mr-2" />
                    Content Generation Complete!
                  </div>
                          )}
                        </div>
                        </div>
          )}
                    </div>
                    
        {/* Content Review Section */}
        {contentReviewItems.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-white mb-6 flex items-center">
              <CheckCircleIconSolid className="h-6 w-6 text-green-400 mr-2" />
              Content Review & Approval
              <span className="ml-3 text-sm text-gray-400">
                ({contentReviewItems.filter(item => item.status === 'approved').length}/{contentReviewItems.length} approved)
              </span>
            </h2>
            
            {contentReviewItems.map((reviewItem, index) => (
              <div key={index} className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 p-6">
                {/* Campaign and Agent Info */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{reviewItem.campaign.title}</h3>
                    <p className="text-sm text-gray-400">
                      Agent: {reviewItem.agent.name} • Platform: {reviewItem.campaign.platform_source} • Type: {reviewItem.campaign.campaign_type}
                    </p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    reviewItem.status === 'generating' ? 'bg-blue-500/20 text-blue-400' :
                    reviewItem.status === 'reviewing' ? 'bg-yellow-500/20 text-yellow-400' :
                    reviewItem.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                    reviewItem.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {reviewItem.status === 'generating' ? 'Generating...' :
                     reviewItem.status === 'reviewing' ? 'Pending Review' :
                     reviewItem.status === 'approved' ? 'Approved' :
                     reviewItem.status === 'rejected' ? 'Rejected' : 'Idle'}
                  </div>
                </div>

                {reviewItem.content ? (
                  <>
                    {/* Generated Content */}
                    <div className="bg-gray-900/50 rounded-lg p-4 mb-4">
                      <pre className="text-gray-200 whitespace-pre-wrap font-medium leading-relaxed">
                        {reviewItem.content.content_text}
                      </pre>
                    </div>

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                        <div className="text-2xl font-bold text-green-400">
                          {reviewItem.content.predicted_mindshare.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-400">Predicted Mindshare</div>
                      </div>
                      <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <div className="text-2xl font-bold text-blue-400">
                          {reviewItem.content.quality_score.toFixed(1)}
                        </div>
                        <div className="text-xs text-gray-400">Quality Score</div>
                      </div>
                      <div className="text-center p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                        <div className="text-2xl font-bold text-purple-400">
                          {reviewItem.content.generation_metadata.generation_time}s
                        </div>
                        <div className="text-xs text-gray-400">Generation Time</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-4 mb-4">
                      {reviewItem.status === 'reviewing' && (
                        <>
                          <button
                            onClick={() => approveContent(index)}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
                          >
                            <CheckIcon className="h-5 w-5 mr-2" />
                            Approve & Publish
                          </button>
                          <button
                            onClick={() => rejectContent(index)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
                          >
                            <XMarkIcon className="h-5 w-5 mr-2" />
                            Reject
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => copyToClipboard(reviewItem.content.content_text)}
                        className="flex-1 px-4 py-3 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors flex items-center justify-center"
                      >
                        <DocumentDuplicateIcon className="h-5 w-5 mr-2" />
                        Copy Content
                      </button>
                    </div>

                    {/* Generation Metadata */}
                    <div className="p-3 bg-gray-700/30 rounded-lg">
                      <p className="text-xs text-gray-400 mb-1">Agents Used: {reviewItem.content.generation_metadata.agents_used.join(', ')}</p>
                      <p className="text-xs text-gray-400 mb-1">Optimization: {reviewItem.content.generation_metadata.optimization_factors.join(', ')}</p>
                      <p className="text-xs text-gray-400">Platform: {reviewItem.content.platformSource} • Campaign: {reviewItem.campaign.title}</p>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mx-auto mb-4"></div>
                    <p className="text-gray-400">Generating content with {reviewItem.agent.name}...</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
} 