'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import api from '../services/burnie-api'
import { 
  PlayIcon, 
  StopIcon, 
  ClockIcon,
  BoltIcon,
  TrophyIcon,
  RocketLaunchIcon,
  CheckCircleIcon,
  XCircleIcon,
  DocumentDuplicateIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  CpuChipIcon
} from '@heroicons/react/24/outline'
import { 
  CheckCircleIcon as CheckCircleIconSolid, 
  BoltIcon as BoltIconSolid,
  CheckIcon, 
  XMarkIcon
} from '@heroicons/react/24/solid'
import { getApiKeys } from '@/utils/api-keys'
import TweetThreadDisplay from './TweetThreadDisplay'

interface Campaign {
  id: number;
  title: string;
  slug: string;
  description: string;
  brandGuidelines: string; // Add brandGuidelines field
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
  tweet_thread?: string[]; // Array of tweet thread messages
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
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set())
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
      const apiUrl = `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/user/${address}`
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
      setMiningStatus({ status: 'analyzing', progress: 5, currentStep: 'Validating configuration...' })
      
      // Get user API keys from Neural Keys
      const apiKeys = address ? getApiKeys(address) : null
      

      
      if (!apiKeys) {
        setMiningStatus({ 
          status: 'error', 
          progress: 0, 
          currentStep: 'No API keys found. Please configure your API keys in Neural Keys before mining.',
          error: 'No API keys configured'
        })
        return
      }

      // Check for agent selection
      for (const selection of selectedCampaigns) {
        if (!selection.selectedAgent) {
          setMiningStatus({ 
            status: 'error', 
            progress: 0, 
            currentStep: `Please select an agent for campaign: ${selection.campaign.title}`,
            error: 'Missing agent selection'
          })
          return
        }

        // CRITICAL: Validate text generation API keys (required)
        const agentConfig = selection.selectedAgent.config
        const modelPreferences = agentConfig?.modelPreferences
        const textProvider = modelPreferences?.text?.provider || 'openai'
        
        let hasTextApiKey = false
        const providerKeyMap = {
          'openai': 'openai',
          'anthropic': 'anthropic',
          'google': 'google',
          'replicate': 'replicate',
          'elevenlabs': 'elevenlabs',
          'stability': 'stability'
        }
        
        const requiredTextKeyName = providerKeyMap[textProvider as keyof typeof providerKeyMap]
        if (requiredTextKeyName && apiKeys[requiredTextKeyName as keyof typeof apiKeys] && apiKeys[requiredTextKeyName as keyof typeof apiKeys]?.trim()) {
          hasTextApiKey = true
        }
        
        // If primary text provider key is missing, check if user has alternative text providers
        if (!hasTextApiKey) {
          // Check for alternative text providers (OpenAI or Anthropic)
          const textProviders = ['openai', 'anthropic']
          for (const provider of textProviders) {
            if (apiKeys[provider as keyof typeof apiKeys] && apiKeys[provider as keyof typeof apiKeys]?.trim()) {
              hasTextApiKey = true
              console.log(`✅ Using alternative text provider: ${provider.toUpperCase()} (user preferred ${textProvider.toUpperCase()} but key not available)`)
              break
            }
          }
        }
        
        if (!hasTextApiKey) {
          setMiningStatus({ 
            status: 'error', 
            progress: 0, 
            currentStep: `Text generation requires ${textProvider.toUpperCase()} API key for campaign "${selection.campaign.title}". Please configure it in Neural Keys. Text content is mandatory for Twitter posts.`,
            error: `Missing required ${textProvider.toUpperCase()} API key for text generation`
          })
          return
        }
      }

      // Log what API keys are available for optional content (visual)
      const availableProviders = []
      const unavailableProviders = []
      
      if (apiKeys) {
        const providerKeys = {
          'OpenAI': apiKeys.openai,
          'Anthropic': apiKeys.anthropic,
          'Google': apiKeys.google,
          'Replicate': apiKeys.replicate,
          'ElevenLabs': apiKeys.elevenlabs,
          'Stability': apiKeys.stability,
          'Fal.ai': apiKeys.fal
        }
        
        Object.entries(providerKeys).forEach(([provider, key]) => {
          if (key && key.trim()) {
            availableProviders.push(provider)
          } else {
            unavailableProviders.push(provider)
          }
        })
      }

      console.log('🔑 Available API providers:', availableProviders)
      if (unavailableProviders.length > 0) {
        console.log('⚠️ Unavailable providers (visual content may be skipped):', unavailableProviders)
      }

      setMiningStatus({ status: 'analyzing', progress: 10, currentStep: 'Starting content generation...' })
      
      // Initialize content review items for each selected campaign
      const initialReviewItems: ContentReviewItem[] = selectedCampaigns.map(selection => ({
        campaign: selection.campaign,
        agent: selection.selectedAgent!,
        content: null,
        status: 'generating'
      }))
      setContentReviewItems(initialReviewItems)
      
      // Prepare campaigns data for the new multi-campaign API
      const campaignsData = selectedCampaigns.map(selection => ({
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
      }))
      
      // Start mining session with Python AI backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_AI_API_URL || 'http://localhost:8000'}/api/mining/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address, // Send wallet address instead of hardcoded user_id
          campaigns: campaignsData, // Send multiple campaigns
          user_preferences: {
            preferred_tone: "engaging",
            preferred_length: 250,
            hashtag_preference: 3,
            emoji_usage: "moderate"
          },
          user_api_keys: Object.fromEntries(
            Object.entries({
              openai: apiKeys?.openai,
              anthropic: apiKeys?.anthropic,
              google: apiKeys?.google,
              replicate: apiKeys?.replicate,
              elevenlabs: apiKeys?.elevenlabs,
              stability: apiKeys?.stability,
              fal: apiKeys?.fal
            }).filter(([key, value]) => value && value.trim() !== '')
          )
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`)
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
        currentStep: error instanceof Error ? error.message : 'Failed to start mining. Please check your configuration.',
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
  }

  const connectToWebSocket = async (sessionId: string) => {
    try {
      // Get base WebSocket URL and construct proper endpoint
      const baseWsUrl = process.env.NEXT_PUBLIC_BURNIE_WS_URL || 'ws://localhost:8000'
      
      // Remove trailing /ws if it exists to avoid double /ws/ws
      const cleanBaseUrl = baseWsUrl.replace(/\/ws\/?$/, '')
      
      // Construct the full WebSocket URL
      const fullWsUrl = `${cleanBaseUrl}/ws/${sessionId}`
      
      console.log('🔌 Connecting to WebSocket:', fullWsUrl)
      const ws = new WebSocket(fullWsUrl)
      
      ws.onopen = () => {
        console.log('🔌 WebSocket connected successfully')
        setMiningStatus({ status: 'analyzing', progress: 15, currentStep: 'Connected to AI agents...' })
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('📨 WebSocket message received:', data)

          switch (data.type) {
            case 'progress_update':
              console.log('📊 Progress update:', data.progress, data.current_step)
              setMiningStatus(prev => ({
                ...prev,
                status: data.error ? 'error' : 'generating',
                progress: data.progress,
                currentStep: data.current_step,
                error: data.error
              }))
              break

            case 'agent_update':
              console.log('🤖 Agent update:', data.agent_type, data.status, data.task)
              setMiningStatus(prev => ({
                ...prev,
                // Only update currentStep if it's not a milestone message
                currentStep: prev.currentStep?.includes('🎯') || prev.currentStep?.includes('✅') || prev.currentStep?.includes('📊') ? 
                  prev.currentStep : 
                  `${data.agent_info?.emoji || '🤖'} ${data.agent_info?.name || data.agent_type}: ${data.task}`,
                progress: prev.progress // Keep existing progress
              }))
              break

            case 'generation_milestone':
              console.log('🎯 Generation milestone:', data.milestone, data.data)
              // Update UI with milestone information - PRIORITY OVER AGENT UPDATES
              const milestoneMessage = getMilestoneMessage(data.milestone, data.data)
              const progressValue = getMilestoneProgress(data.milestone)
              setMiningStatus(prev => ({
                ...prev,
                currentStep: milestoneMessage,
                progress: progressValue || prev.progress, // Update progress if milestone has one
                status: data.milestone === 'generation_error' ? 'error' : 
                        data.milestone === 'generation_complete' ? 'completed' :
                        prev.status
              }))
              break
            
            case 'content_preview':
              console.log('👀 Content preview:', data.content_type, data.preview)
              // Show real-time content preview
              if (data.content_type === 'final_content') {
                setMiningStatus(prev => ({
                  ...prev,
                  currentStep: `📝 Content ready! ${data.preview.char_count} characters, ${data.preview.has_image ? 'with image' : 'text only'}`
                }))
              }
              break

            case 'campaign_completed':
              console.log('✅ Campaign completed:', data)
              console.log('🖼️  Campaign content images:', data.campaign_content?.content_images)
              console.log('🧵 Campaign tweet thread from WebSocket:', {
                thread: data.campaign_content?.tweet_thread,
                type: typeof data.campaign_content?.tweet_thread,
                length: data.campaign_content?.tweet_thread?.length,
                isArray: Array.isArray(data.campaign_content?.tweet_thread)
              })
              
              // Find the campaign index by matching campaign_id
              const campaignIndex = selectedCampaigns.findIndex(
                selection => selection.campaign.id === data.campaign_content?.campaign_id
              )
              
              if (campaignIndex >= 0) {
                // Add the completed content to review items
                setContentReviewItems(prev => {
                  const newItems = [...prev]
                  newItems[campaignIndex] = {
                    ...newItems[campaignIndex],
                    content: {
                      id: data.campaign_content?.id || `gen_${Date.now()}`,
                      content_text: data.campaign_content?.content_text || '',
                      tweet_thread: data.campaign_content?.tweet_thread || null, // Include tweet thread
                      content_images: data.campaign_content?.content_images || null, // Include images from backend
                      predicted_mindshare: data.campaign_content?.predicted_mindshare || 0,
                      quality_score: data.campaign_content?.quality_score || 0,
                      generation_metadata: data.campaign_content?.generation_metadata || {
                        agents_used: ['CrewAI Constellation'],
                        optimization_factors: ['mindshare', 'engagement'],
                        generation_time: Date.now()
                      }
                    },
                    status: 'reviewing'
                  }
                  return newItems
                })
              }
              break

            case 'completion':
              console.log('🎉 All campaigns completed:', data)
              setMiningStatus({
                status: 'completed',
                progress: 100,
                currentStep: '🎉 All content generated successfully!'
              })
              break

            case 'error':
              console.error('❌ WebSocket error:', data)
              setMiningStatus(prev => ({
                ...prev,
                status: 'error',
                error: data.message || 'An error occurred during content generation',
                currentStep: `❌ Error: ${data.message || 'Unknown error'}`
              }))
              break

            case 'pong':
              // Heartbeat response
              break
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error, event.data)
        }
      }

              ws.onerror = (error) => {
        console.error('❌ WebSocket connection error:', error)
          setMiningStatus({
            status: 'error',
            progress: 0,
            currentStep: 'WebSocket connection failed. Please ensure the Python AI backend is running.',
            error: 'WebSocket connection failed'
          })
        }

      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason)
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

  const toggleCampaignExpansion = (campaignId: number) => {
    setExpandedCampaigns(prev => {
      const newSet = new Set(prev)
      if (newSet.has(campaignId)) {
        newSet.delete(campaignId)
      } else {
        newSet.add(campaignId)
      }
      return newSet
    })
  }

  const approveContent = async (index: number) => {
    try {
      // Update local state immediately
      setContentReviewItems(prev => prev.map((item, i) => 
        i === index ? { ...item, status: 'approved' } : item
      ))

      const reviewItem = contentReviewItems[index]
      
      // Send to backend for publication to Burnie influencer platform
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: reviewItem.campaign.id,
          agentId: reviewItem.agent.id,
          agentName: reviewItem.agent.name,
          walletAddress: address,
          contentText: reviewItem.content?.content_text,
          tweetThread: reviewItem.content?.tweet_thread || null, // Include tweet thread
          contentImages: reviewItem.content?.content_images || null, // Pass actual images from content
          predictedMindshare: reviewItem.content?.predicted_mindshare,
          qualityScore: reviewItem.content?.quality_score,
          generationMetadata: reviewItem.content?.generation_metadata,
          askingPrice: 100 // Default asking price
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      
      console.log('✅ Content approved and added to marketplace:', {
        campaign: reviewItem.campaign.title,
        agent: reviewItem.agent.name,
        marketplaceId: result.data?.id,
        marketplaceUrl: result.data?.marketplace_url
      })

      // Show success notification
      alert(`✅ Content approved! Added to marketplace with ID: ${result.data?.id}`)
      
    } catch (error) {
      console.error('❌ Failed to approve content:', error)
      alert('❌ Failed to approve content. Please try again.')
      
      // Revert local state on error
      setContentReviewItems(prev => prev.map((item, i) => 
        i === index ? { ...item, status: 'reviewing' } : item
      ))
    }
  }

  const rejectContent = async (index: number) => {
    try {
      const item = contentReviewItems[index]
      
      // Make API call to record rejection in database
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: item.campaign.id,
          agentId: item.agent.id,
          walletAddress: address,
          contentText: item.content?.content_text || '',
          reason: 'Content rejected by user'
        })
      })

      const result = await response.json()

      if (result.success) {
        // Update local state only after successful API call
        setContentReviewItems(prev => prev.map((item, i) => 
          i === index ? { ...item, status: 'rejected' } : item
        ))

        console.log('✅ Content rejected and recorded in database:', {
          campaignTitle: item.campaign.title,
          recordId: result.data.id,
          action: result.data.action,
          rejectedAt: result.data.rejectedAt
        })
      } else {
        console.error('❌ Failed to reject content:', result.error)
        alert('Failed to reject content. Please try again.')
      }
    } catch (error) {
      console.error('❌ Error rejecting content:', error)
      alert('Error rejecting content. Please try again.')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('✅ Content copied to clipboard!')
  }

  const getMilestoneMessage = (milestone: string, data: any): string => {
    switch (milestone) {
      case 'crew_start':
        return `🚀 Starting ${data?.agents_count || 5} AI agents (${data?.estimated_duration || '2-3 minutes'})`
      case 'data_analysis_complete':
        return `📊 Data analysis complete (${Math.round((data?.confidence || 0.92) * 100)}% confidence)`
      case 'strategy_complete':
        return `🎯 Strategy ready: ${data?.content_approach || 'data-driven'} approach`
      case 'text_generation_progress':
        return `✍️ Text generation ${data?.status || 'in progress'} (${data?.estimated_completion || '30 seconds'})`
      case 'visual_generation_progress':
        return `🎨 Creating ${data?.visual_type || 'image'} with ${data?.style || 'professional'} style`
      case 'generation_complete':
        return `✅ Content complete! Quality: ${Math.round(data?.quality_score || 85)}%, Mindshare: ${Math.round(data?.mindshare_score || 75)}%`
      case 'generation_error':
        return `❌ ${data?.error_type || 'Error'}: ${data?.error_message || 'Generation failed'}`
      default:
        return `🔄 ${milestone}: Processing...`
    }
  }

  const getMilestoneProgress = (milestone: string): number | undefined => {
    switch (milestone) {
      case 'crew_start':
        return 5
      case 'data_analysis_complete':
        return 15
      case 'strategy_complete':
        return 25
      case 'text_generation_progress':
        return 40
      case 'visual_generation_progress':
        return 60
      case 'generation_complete':
        return 90
      default:
        return undefined
    }
  }

  const extractImageUrl = (contentText: string): string | null => {
    console.log('🔍 Extracting image URL from content:', contentText.substring(0, 200) + '...')
    
    // Extract image URL from content text using enhanced regex
    // Pattern 1: Look for Image URL: prefix (backend format)
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i)
    if (prefixMatch) {
      const url = prefixMatch[1].replace(/[.,;'"]+$/, '') // Remove trailing punctuation
      console.log('✅ Found image URL via prefix pattern:', url)
      return url
    }
    
    // Pattern 2: Look for OpenAI DALL-E URLs specifically
    const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i)
    if (dalleMatch) {
      const url = dalleMatch[1].replace(/[.,;'"]+$/, '') // Remove trailing punctuation
      console.log('✅ Found image URL via DALL-E pattern:', url)
      return url
    }
    
    // Pattern 3: General blob URL detection
    const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i)
    if (blobMatch) {
      const url = blobMatch[1].replace(/[.,;'"]+$/, '') // Remove trailing punctuation
      console.log('✅ Found image URL via blob pattern:', url)
      return url
    }
    
    // Pattern 4: Any HTTPS URL that looks like an image (fallback)
    const generalMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]+\.(png|jpg|jpeg|gif|webp)(?:\?[^\s\n<>"'`]+)?)/i)
    if (generalMatch) {
      const url = generalMatch[1].replace(/[.,;'"]+$/, '') // Remove trailing punctuation
      console.log('✅ Found image URL via general pattern:', url)
      return url
    }
    
    console.log('❌ No image URL found in content')
    return null
  }

  const formatTwitterContent = (contentText: string): { text: string; imageUrl: string | null } => {
    const imageUrl = extractImageUrl(contentText)
    
    // Start with the full content
    let cleanText = contentText
    
    // Remove image URL patterns from the text
    cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '')
    
    // Extract just the Twitter text (before the stats and metadata)
    const lines = cleanText.split('\n')
    let twitterText = ""
    
    for (const line of lines) {
      if (line.includes('📊 Content Stats') || 
          line.includes('🖼️ [Image will be attached') ||
          line.includes('💡 To post:') ||
          line.includes('AWSAccessKeyId=') ||
          line.includes('Signature=') ||
          line.includes('Expires=')) {
        break
      }
      
      const trimmedLine = line.trim()
      // Skip lines that are just URLs or AWS parameters
      if (trimmedLine && 
          !trimmedLine.startsWith('http') && 
          !trimmedLine.includes('AWSAccessKeyId') &&
          !trimmedLine.includes('Signature=') &&
          !trimmedLine.includes('Expires=')) {
        twitterText += line + "\n"
      }
    }
    
    return {
      text: twitterText.trim(),
      imageUrl
    }
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
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
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
                        
                        {/* Expand/Collapse Button */}
                        <button
                          onClick={() => toggleCampaignExpansion(campaign.id)}
                          className="flex items-center text-gray-400 hover:text-white transition-colors text-sm"
                        >
                          {expandedCampaigns.has(campaign.id) ? (
                            <>
                              <span className="mr-1">Hide Details</span>
                              <ChevronUpIcon className="h-4 w-4" />
                            </>
                          ) : (
                            <>
                              <span className="mr-1">Show Details</span>
                              <ChevronDownIcon className="h-4 w-4" />
                            </>
                          )}
                        </button>
                      </div>
                      
                      {/* Expandable Campaign Details */}
                      {expandedCampaigns.has(campaign.id) && (
                        <div className="mb-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700/50">
                          <h4 className="text-sm font-medium text-orange-400 mb-2">📋 Brand Guidelines</h4>
                          <p className="text-gray-300 text-sm leading-relaxed">
                            {campaign.brandGuidelines || campaign.guidelines || 'No specific brand guidelines provided.'}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex items-center space-x-4 text-sm">
                        <span className="text-gray-300">
                          <span className="text-orange-400 font-semibold">{parseInt(campaign.winner_reward).toLocaleString()}</span> ROAST
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
                      {selection.campaign.platform_source} • {selection.campaign.campaign_type} • {parseInt(selection.campaign.winner_reward).toLocaleString()} ROAST
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
            Content Generation Engine
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

              {/* Processing Stages */}
              <div className="grid grid-cols-5 gap-2 mt-4">
                {['Analysis', 'Strategy', 'Creation', 'Optimization', 'Finalization'].map((stage, index) => (
                  <div key={stage} className={`p-2 rounded text-center text-xs ${
                    miningStatus.progress > index * 20 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/50 text-gray-500'
                  }`}>
                    {miningStatus.progress > index * 20 && <CheckCircleIconSolid className="h-4 w-4 mx-auto mb-1" />}
                    {stage}
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
                    {/* Twitter-Ready Content Display */}
                    <div className="bg-gray-900/50 rounded-lg p-4 mb-4 border border-gray-700">
                      <h4 className="text-sm font-semibold text-orange-400 mb-3 flex items-center">
                        🐦 Twitter-Ready Content
                      </h4>
                      
                      {(() => {
                        // Parse the content to separate tweet text from image URLs
                        const { text, imageUrl: extractedImageUrl } = formatTwitterContent(reviewItem.content.content_text)
                        // Use content_images array if available, otherwise fall back to extracted URL
                        const imageUrl = reviewItem.content.content_images && reviewItem.content.content_images.length > 0 
                          ? reviewItem.content.content_images[0] 
                          : extractedImageUrl
                        
                        // Debug logging
                        console.log('🖼️ Mining: Content images array:', reviewItem.content.content_images)
                        console.log('🖼️ Mining: Selected image URL:', imageUrl)
                        console.log('🔍 Mining: Tweet thread:', {
                          thread: reviewItem.content.tweet_thread,
                          type: typeof reviewItem.content.tweet_thread,
                          length: reviewItem.content.tweet_thread?.length,
                          isArray: Array.isArray(reviewItem.content.tweet_thread)
                        })
                        
                        const hashtags = text.match(/#\w+/g) || []
                        
                        return (
                          <div className="space-y-4">
                            {/* Use TweetThreadDisplay Component */}
                            <TweetThreadDisplay
                              mainTweet={text}
                              tweetThread={reviewItem.content.tweet_thread}
                              imageUrl={imageUrl}
                              characterCount={text.length}
                              hashtags={hashtags}
                              showImage={true}
                            />
                            
                            {/* Image URL Section - only if image exists */}
                            {imageUrl && (
                              <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="font-semibold text-purple-300 text-sm">
                                    📎 Image URL ({imageUrl.length} characters)
                                  </div>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(imageUrl)
                                      alert('✅ Image URL copied to clipboard!')
                                    }}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                                  >
                                    📋 Copy URL
                                  </button>
                                </div>
                                <div className="bg-gray-900 p-3 rounded border font-mono text-xs text-gray-300 break-all max-h-24 overflow-y-auto">
                                  {imageUrl}
                                </div>
                                <div className="flex gap-2 mt-3">
                                  <button
                                    onClick={() => window.open(imageUrl, '_blank')}
                                    className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                                  >
                                    🔗 Open in New Tab
                                  </button>
                                  <button
                                    onClick={() => {
                                      const tweetText = `Check out this AI-generated image! ${imageUrl}`
                                      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
                                      window.open(twitterUrl, '_blank')
                                    }}
                                    className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                                  >
                                    🐦 Share on Twitter
                                  </button>
                                </div>
                              </div>
                            )}
                            
                            {/* Twitter Posting Instructions */}
                            <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/20">
                              <div className="text-sm text-blue-300">
                                💡 <strong>To Post on Twitter:</strong>
                              </div>
                              <div className="text-xs text-gray-300 mt-1">
                                1. Copy the text from the main tweet above<br/>
                                {imageUrl && "2. Save the image above\n3. "}
                                {imageUrl ? "Paste text + attach image in Twitter" : "2. Paste text in Twitter"}
                                {reviewItem.content.tweet_thread && reviewItem.content.tweet_thread.length > 0 && (
                                  <><br/>4. Expand thread details above for additional tweets to post as replies</>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                        <div className="text-2xl font-bold text-green-400">
                          {(reviewItem.content.predicted_mindshare || 0).toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-400">Predicted Mindshare</div>
                      </div>
                      <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <div className="text-2xl font-bold text-blue-400">
                          {(reviewItem.content.quality_score || 0).toFixed(1)}
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
                        onClick={() => {
                          const { text } = formatTwitterContent(reviewItem.content.content_text)
                          copyToClipboard(text)
                        }}
                        className="flex-1 px-4 py-3 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors flex items-center justify-center"
                      >
                        <DocumentDuplicateIcon className="h-5 w-5 mr-2" />
                        Copy Twitter Text
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