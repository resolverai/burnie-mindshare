'use client'

import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { BurnieAPIClient } from '../services/burnie-api'
import WalletConnector from '../components/WalletConnector'
import ContentGenerator from '../components/ContentGenerator'

// Initialize API client
const api = new BurnieAPIClient()

interface AppState {
  isConnected: boolean
  walletAddress: string | null
  minerData: any | null
  campaigns: any[]
  selectedCampaigns: Set<number>
  isLoading: boolean
  error: string | null
  isMining: boolean
  miningStats: {
    totalSubmissions: number
    tokensUsed: number
    successRate: number
  }
}

interface Agent {
  id: string
  name: string
  personality: string
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  isActive: boolean
  createdAt: string
}

interface Campaign {
  id: number
  title: string
  description: string
  campaign_type: string
  category: string
  winner_reward: number
  max_submissions: number
  current_submissions: number
  time_remaining: number
  is_full: boolean
}

export default function MiningInterface() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const [state, setState] = useState<AppState>({
    isConnected: false,
    walletAddress: null,
    minerData: null,
    campaigns: [],
    selectedCampaigns: new Set(),
    isLoading: false,
    error: null,
    isMining: false,
    miningStats: {
      totalSubmissions: 0,
      tokensUsed: 0,
      successRate: 0
    }
  })

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [miningStatus, setMiningStatus] = useState<'idle' | 'mining' | 'waiting_block'>('idle')
  const [blockNotification, setBlockNotification] = useState<string | null>(null)
  const [generatedContent, setGeneratedContent] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)

  // Initialize app on mount
  useEffect(() => {
    console.log('🚀 Mining Interface initializing...')
    initializeApp()
  }, [])

  // Handle wallet connection changes
  useEffect(() => {
    if (isConnected && address && !state.isConnected) {
      handleWalletConnection(address)
    } else if (!isConnected && state.isConnected) {
      handleWalletDisconnection()
    }
  }, [isConnected, address])

  const initializeApp = async () => {
    try {
      // Load campaigns from backend
      await loadCampaigns()
      
      // Check for saved wallet
      const savedWallet = localStorage.getItem('roastpower_wallet')
      if (savedWallet && !state.isConnected) {
        // Auto-connect if wallet was previously connected
        console.log('🔄 Attempting to restore wallet connection:', savedWallet)
      }
    } catch (error) {
      console.error('❌ App initialization failed:', error)
    }
  }

  const handleWalletConnection = async (address: string) => {
    if (!address) return
    
    try {
      console.log('🔗 Starting wallet connection for address:', address)
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      // Register or update miner
      console.log('🔧 Registering miner...')
      const minerData = await api.registerMiner({
        wallet_address: address,
        agent_personality: 'SAVAGE',
        llm_provider: 'OPENAI'
      })

      console.log('✅ Miner registered successfully:', minerData)
      console.log('🆔 Miner ID:', minerData.id)

      if (!minerData.id) {
        throw new Error('Miner registration failed: No ID returned')
      }

      // Start heartbeat system
      console.log('💓 Starting heartbeat for miner ID:', minerData.id)
      startHeartbeat(minerData.id)

      setState(prev => ({
        ...prev,
        isConnected: true,
        walletAddress: address,
        minerData,
        isLoading: false
      }))

      // Save wallet for persistence
      localStorage.setItem('roastpower_wallet', address)
      console.log('✅ Wallet connection completed successfully')

    } catch (error) {
      console.error('❌ Wallet connection failed:', error)
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: `Failed to connect wallet: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }))
    }
  }

  const handleWalletDisconnection = () => {
    setState(prev => ({
      ...prev,
      isConnected: false,
      walletAddress: null,
      minerData: null,
      isMining: false,
      selectedCampaigns: new Set()
    }))
    localStorage.removeItem('roastpower_wallet')
    
    // Trigger wagmi disconnect
    disconnect()
  }

  const startHeartbeat = (minerId: number) => {
    console.log('💓 Starting heartbeat system for miner:', minerId)
    
    if (!minerId) {
      console.error('❌ Cannot start heartbeat: Miner ID is undefined')
      return
    }

    const sendHeartbeat = async () => {
      try {
        console.log(`💓 Sending heartbeat for miner ${minerId}`)
        const heartbeatData = {
          status: state.isMining ? 'MINING' as const : 'ONLINE' as const,
          is_available: true,
          roast_balance: 1000, // Would get from blockchain
          ip_address: undefined,
          user_agent: navigator.userAgent
        }

        // Send via HTTP API
        await api.sendHeartbeat(minerId, heartbeatData)
        console.log(`✅ Heartbeat sent successfully for miner ${minerId}`)

      } catch (error) {
        console.error(`❌ Heartbeat failed for miner ${minerId}:`, error)
      }
    }

    // Send initial heartbeat
    console.log('💓 Sending initial heartbeat')
    sendHeartbeat()

    // Setup interval for regular heartbeats
    const heartbeatInterval = setInterval(sendHeartbeat, 30000) // Every 30 seconds
    console.log('⏰ Heartbeat interval setup - every 30 seconds')
    
    // Store interval ID for cleanup
    // @ts-ignore - adding to window for debugging
    window.heartbeatInterval = heartbeatInterval
  }

  const loadCampaigns = async () => {
    try {
      const campaignsData = await api.getActiveCampaigns()
      // Ensure campaigns is always an array
      const campaigns = Array.isArray(campaignsData) ? campaignsData : []
      setState(prev => ({ ...prev, campaigns }))
    } catch (error) {
      console.error('Failed to load campaigns:', error)
      // Use mock data for development
      const mockCampaigns = [
        {
          id: 1,
          title: "Roast the Latest DeFi Protocol",
          slug: "roast-latest-defi",
          description: "Create hilarious roasts about the newest overhyped DeFi protocol that promises 10000% APY",
          topic: "DeFi",
          campaign_type: "roast",
          category: "crypto",
          keywords: ["defi", "roast", "protocol"],
          min_token_spend: 100,
          winner_reward: 1000,
          max_submissions: 1500,
          current_submissions: 234,
          submission_deadline: "2024-12-31T23:59:59Z",
          time_remaining: 25200,
          submission_rate: 0.16,
          is_full: false
        },
        {
          id: 2,
          title: "NFT Collection Comedy Gold",
          slug: "nft-comedy-gold", 
          description: "Create memes and roasts about NFT collections that went from hero to zero",
          topic: "NFTs",
          campaign_type: "meme",
          category: "nft",
          keywords: ["nft", "meme", "comedy"],
          min_token_spend: 100,
          winner_reward: 750,
          max_submissions: 1500,
          current_submissions: 89,
          submission_deadline: "2024-12-25T23:59:59Z",
          time_remaining: 43200,
          submission_rate: 0.06,
          is_full: false
        }
      ]
      setState(prev => ({ ...prev, campaigns: mockCampaigns }))
    }
  }

  const handleCampaignToggle = (campaignId: number) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedCampaigns)
      if (newSelected.has(campaignId)) {
        newSelected.delete(campaignId)
      } else {
        newSelected.add(campaignId)
      }
      return { ...prev, selectedCampaigns: newSelected }
    })
  }

  const startMining = async () => {
    if (state.selectedCampaigns.size === 0) {
      setState(prev => ({ ...prev, error: 'Please select at least one campaign to mine' }))
      return
    }

    setState(prev => ({ 
      ...prev, 
      isMining: true, 
      error: null,
      miningStats: { totalSubmissions: 0, tokensUsed: 0, successRate: 0 }
    }))

    console.log('⛏️ Starting mining for campaigns:', Array.from(state.selectedCampaigns))
  }

  const stopMining = () => {
    setState(prev => ({ ...prev, isMining: false }))
    console.log('⏹️ Mining stopped')
  }

  const handleContentGenerated = (content: string, tokensUsed: number, campaignId: number) => {
    setState(prev => ({
      ...prev,
      miningStats: {
        totalSubmissions: prev.miningStats.totalSubmissions + 1,
        tokensUsed: prev.miningStats.tokensUsed + tokensUsed,
        successRate: Math.round(((prev.miningStats.totalSubmissions + 1) / (prev.miningStats.totalSubmissions + 1)) * 100)
      }
    }))
    
    console.log(`✅ Content generated for campaign ${campaignId}: ${tokensUsed} tokens`)
  }

  const fetchActiveCampaigns = async () => {
    try {
      setLoadingCampaigns(true)
      const campaignsData = await api.getActiveCampaigns()
      setState(prev => ({ ...prev, campaigns: campaignsData || [] }))
    } catch (error) {
      console.error('Failed to fetch campaigns:', error)
    } finally {
      setLoadingCampaigns(false)
    }
  }

  const checkBlockStatus = async () => {
    try {
      const response = await api.getBlockStatus()
      if (response.blockMiningStarting) {
        setBlockNotification('⚡ Block mining starting in 30 seconds! Start mining now!')
        setMiningStatus('waiting_block')
        
        setTimeout(() => {
          setBlockNotification(null)
        }, 10000)
      }
    } catch (error) {
      // Silently handle API errors for status checks
    }
  }

  const connectWallet = async () => {
    // Simulate wallet connection
    const mockAddress = '0x' + Math.random().toString(16).substr(2, 40)
    setState(prev => ({ ...prev, walletAddress: mockAddress }))
    localStorage.setItem('roastpower_wallet', mockAddress)

    try {
      // Register miner with proper data structure
      const minerData = {
        wallet_address: mockAddress,
        username: `Miner_${Date.now()}`,
        agent_personality: 'SAVAGE' as const,
        llm_provider: 'OPENAI' as const,
      }
      
      const response = await api.registerMiner(minerData)
      if (response?.id) {
        setState(prev => ({ ...prev, minerData: response }))
        localStorage.setItem('roastpower_wallet', mockAddress)
      }
    } catch (error) {
      console.error('Failed to register miner:', error)
    }
  }

  const createAgent = (agentData: Partial<Agent>) => {
    const agent: Agent = {
      id: Date.now().toString(),
      name: agentData.name || 'New Agent',
      personality: agentData.personality || 'SAVAGE',
      provider: agentData.provider || 'openai',
      model: agentData.model || 'gpt-4',
      apiKey: agentData.apiKey || '',
      systemPrompt: agentData.systemPrompt || 'You are a savage AI agent for content creation.',
      temperature: agentData.temperature || 0.8,
      maxTokens: agentData.maxTokens || 2000,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const updatedAgents = [...agents, agent]
    setAgents(updatedAgents)
    setSelectedAgent(agent)
    localStorage.setItem('miner_agents', JSON.stringify(updatedAgents))
    localStorage.setItem('selected_agent', JSON.stringify(agent))
    setShowCreateAgent(false)
  }

  const generateContent = async () => {
    if (!selectedAgent || !selectedCampaign) return

    setIsGenerating(true)
    setMiningStatus('mining')

    try {
      // Simulate content generation
      const prompt = `Create content for campaign: ${selectedCampaign.title}\nDescription: ${selectedCampaign.description}\nPersonality: ${selectedAgent.personality}`
      
      // Mock content generation
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      const mockContent = `🔥 ${selectedAgent.personality} CONTENT GENERATED 🔥\n\nCampaign: ${selectedCampaign.title}\n\n[This is mock content generated by ${selectedAgent.name} with ${selectedAgent.personality} personality for the campaign "${selectedCampaign.title}". In a real implementation, this would use the configured LLM API to generate actual content based on the campaign requirements.]`
      
      setGeneratedContent(mockContent)
      
      // Submit content to backend
      await api.submitContent({
        campaign_id: selectedCampaign.id,
        content: mockContent,
        tokens_spent: Math.floor(Math.random() * 500) + 100,
        transaction_hash: '0x' + Math.random().toString(16).substr(2, 64),
        metadata: {
          agent_id: selectedAgent.id,
          agent_personality: selectedAgent.personality,
          generation_time: new Date().toISOString(),
        }
      })

    } catch (error) {
      console.error('Content generation failed:', error)
    } finally {
      setIsGenerating(false)
      setMiningStatus('idle')
    }
  }

  const shouldShowAgentCreation = state.walletAddress && state.minerData && agents.length === 0

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-white">
                🔥 RoastPower Mining Interface
              </h1>
              {/* Connection Status */}
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${state.isConnected ? 'bg-green-400 pulse-green' : 'bg-red-400'}`}></div>
                <span className="text-sm text-gray-300">
                  {state.isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {state.isConnected && state.minerData && (
                <div className="text-sm text-gray-300">
                  <span className="text-green-400">Miner ID:</span> {state.minerData.id}
                </div>
              )}
              <WalletConnector />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!state.isConnected ? (
          /* Wallet Connection Required */
          <div className="text-center py-16">
            <div className="mining-card max-w-md mx-auto">
              <h2 className="mining-title mb-4">Connect Your Wallet</h2>
              <p className="mining-subtitle mb-6">
                Connect your wallet to start mining content and earning rewards
              </p>
              <div className="text-4xl mb-6">🔗</div>
              <p className="text-sm text-gray-400">
                Your wallet will be used to identify your miner and track your earnings
              </p>
            </div>
          </div>
        ) : shouldShowAgentCreation ? (
          /* Agent Creation Required */
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl">🤖</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Create Your First Agent</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Before you can start mining, you need to create an AI agent that will generate content for campaigns. 
              Bring your own API keys and configure your agent's personality.
            </p>
            
            {/* Quick Agent Creation Form */}
            <div className="max-w-md mx-auto space-y-4">
              <input
                type="text"
                placeholder="Agent Name"
                className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    createAgent({ 
                      name: e.currentTarget.value,
                      apiKey: 'mock-api-key-for-demo'
                    })
                  }
                }}
              />
              <button
                onClick={() => createAgent({ 
                  name: 'Demo Agent',
                  apiKey: 'mock-api-key-for-demo'
                })}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-200"
              >
                Create Demo Agent
              </button>
            </div>
          </div>
        ) : (
          /* Mining Dashboard */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Miner Stats */}
            <div className="space-y-6">
              {/* Miner Info */}
              <div className="mining-card">
                <h3 className="mining-title mb-4">Miner Dashboard</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="mining-subtitle">Status</span>
                    <span className={state.isMining ? 'status-mining' : 'status-online'}>
                      {state.isMining ? 'MINING' : 'ONLINE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="mining-subtitle">Wallet</span>
                    <span className="text-white font-mono text-sm">
                      {state.walletAddress?.slice(0, 6)}...{state.walletAddress?.slice(-4)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="mining-subtitle">Balance</span>
                    <span className="mining-value text-lg">1,000 ROAST</span>
                  </div>
                </div>
              </div>

              {/* Mining Stats */}
              <div className="mining-card">
                <h3 className="mining-title mb-4">Mining Stats</h3>
                <div className="grid grid-cols-1 gap-4">
                  <div className="mining-stat">
                    <span className="mining-stat-value">{state.miningStats.totalSubmissions}</span>
                    <span className="mining-stat-label">Submissions</span>
                  </div>
                  <div className="mining-stat">
                    <span className="mining-stat-value">{state.miningStats.tokensUsed.toLocaleString()}</span>
                    <span className="mining-stat-label">Tokens Used</span>
                  </div>
                  <div className="mining-stat">
                    <span className="mining-stat-value">{state.miningStats.successRate}%</span>
                    <span className="mining-stat-label">Success Rate</span>
                  </div>
                </div>
              </div>

              {/* Mining Controls */}
              <div className="mining-card">
                <h3 className="mining-title mb-4">Mining Controls</h3>
                <div className="space-y-4">
                  <div className="text-sm text-gray-400 mb-2">
                    Selected: {state.selectedCampaigns.size} campaigns
                  </div>
                  {!state.isMining ? (
                    <button
                      onClick={startMining}
                      disabled={state.selectedCampaigns.size === 0}
                      className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ⛏️ Start Mining
                    </button>
                  ) : (
                    <button
                      onClick={stopMining}
                      className="btn-secondary w-full"
                    >
                      ⏹️ Stop Mining
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Campaigns and Content Generator */}
            <div className="lg:col-span-2 space-y-6">
              {/* Active Campaigns */}
              <div className="mining-card">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="mining-title">Active Campaigns</h3>
                  <button
                    onClick={fetchActiveCampaigns}
                    className="btn-secondary text-sm"
                  >
                    🔄 Refresh
                  </button>
                </div>

                {state.campaigns.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-4">📭</div>
                    <p className="mining-subtitle">No active campaigns available</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.campaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        className={`campaign-card cursor-pointer ${
                          state.selectedCampaigns.has(campaign.id) ? 'selected' : ''
                        }`}
                        onClick={() => handleCampaignToggle(campaign.id)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <h4 className="font-semibold text-white text-sm leading-tight">
                            {campaign.title}
                          </h4>
                          <div className="flex items-center space-x-2 ml-2">
                            <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded">
                              {campaign.campaign_type}
                            </span>
                            {state.selectedCampaigns.has(campaign.id) && (
                              <div className="w-5 h-5 bg-green-400 rounded-full flex items-center justify-center">
                                <span className="text-black text-xs">✓</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <p className="text-gray-400 text-xs mb-3 line-clamp-2">
                          {campaign.description}
                        </p>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Progress</span>
                            <span className="text-white">
                              {campaign.current_submissions || 0}/{campaign.max_submissions}
                            </span>
                          </div>
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ 
                                width: `${((campaign.current_submissions || 0) / campaign.max_submissions) * 100}%` 
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Reward</span>
                            <span className="text-green-400 font-semibold">
                              {campaign.winner_reward} ROAST
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Content Generator - Only show when mining */}
              {state.isMining && (
                <ContentGenerator
                  selectedCampaigns={Array.from(state.selectedCampaigns)}
                  campaigns={state.campaigns}
                  minerData={state.minerData}
                  onContentGenerated={handleContentGenerated}
                />
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {state.error && (
          <div className="fixed bottom-4 right-4 bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg">
            {state.error}
          </div>
        )}

        {/* Loading Overlay */}
        {state.isLoading && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="mining-card">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
                <span className="text-white">Loading...</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 