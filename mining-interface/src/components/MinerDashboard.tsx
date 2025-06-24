import React, { useState, useEffect } from 'react'
import WalletConnector from './WalletConnector'
import { ConnectionStatus } from './ConnectionStatus'
import ContentGenerator from './ContentGenerator'
import { CampaignList } from './CampaignList'
import { PerformanceStats } from './PerformanceStats'
import { api, Campaign, MinerRegistration } from '../services/burnie-api'

interface MinerStats {
  balance: number
  totalEarnings: number
  successRate: number
  activeSubmissions: number
  completedCampaigns: number
  minerRank: number
}

interface MinerDashboardProps {
  walletAddress: string | null
  isConnected: boolean
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

export const MinerDashboard: React.FC<MinerDashboardProps> = ({ 
  walletAddress, 
  isConnected 
}) => {
  const [stats, setStats] = useState<MinerStats>({
    balance: 0,
    totalEarnings: 0,
    successRate: 0,
    activeSubmissions: 0,
    completedCampaigns: 0,
    minerRank: 0
  })
  const [loading, setLoading] = useState(false)
  const [minerId, setMinerId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [miningStatus, setMiningStatus] = useState<'idle' | 'mining' | 'waiting_block'>('idle')
  const [blockNotification, setBlockNotification] = useState<string | null>(null)
  const [apiConnected, setApiConnected] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [minerStatus, setMinerStatus] = useState<'ONLINE' | 'OFFLINE' | 'MINING' | 'IDLE'>('OFFLINE')

  useEffect(() => {
    if (isConnected && walletAddress) {
      fetchMinerStats()
      setApiConnected(true)
      setMinerStatus('ONLINE')
    }
  }, [isConnected, walletAddress])

  useEffect(() => {
    if (walletAddress && minerId) {
      fetchActiveCampaigns()
      const interval = setInterval(fetchActiveCampaigns, 5000)
      return () => clearInterval(interval)
    }
  }, [walletAddress, minerId])

  useEffect(() => {
    if (walletAddress && minerId) {
      const interval = setInterval(checkBlockStatus, 2000)
      return () => clearInterval(interval)
    }
  }, [walletAddress, minerId])

  const fetchMinerStats = async () => {
    setLoading(true)
    try {
      // Mock data for now - replace with actual API call
      setStats({
        balance: 1250.75,
        totalEarnings: 4382.50,
        successRate: 87.5,
        activeSubmissions: 3,
        completedCampaigns: 12,
        minerRank: 34
      })
    } catch (error) {
      console.error('Failed to fetch miner stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchActiveCampaigns = async () => {
    try {
      setLoadingCampaigns(true)
      const response = await api.getActiveCampaigns()
      setCampaigns(response)
    } catch (error) {
      console.error('Failed to fetch campaigns:', error)
    } finally {
      setLoadingCampaigns(false)
    }
  }

  const checkBlockStatus = async () => {
    try {
      // Check if block mining is about to start
      const response = await api.getBlockStatus()
      if (response.blockMiningStarting) {
        setBlockNotification('⚡ Block mining starting in 30 seconds! Start mining now!')
        setMiningStatus('waiting_block')
        
        // Clear notification after 10 seconds
        setTimeout(() => {
          setBlockNotification(null)
        }, 10000)
      }
    } catch (error) {
      // Silently handle API errors for status checks
    }
  }

  const handleWalletConnected = async (address: string) => {
    try {
      // Register or get existing miner
      const minerData: MinerRegistration = {
        wallet_address: address,
        agent_personality: 'SAVAGE',
        llm_provider: 'OPENAI',
        llm_model: 'gpt-4'
      }
      const response = await api.registerMiner(minerData)
      if (response.id) {
        setMinerId(response.id.toString())
        localStorage.setItem('miner_id', response.id.toString())
      }
    } catch (error) {
      console.error('Failed to register miner:', error)
    }
  }

  const handleAgentCreated = (agent: Agent) => {
    const updatedAgents = [...agents, agent]
    setAgents(updatedAgents)
    setSelectedAgent(agent)
    localStorage.setItem('miner_agents', JSON.stringify(updatedAgents))
    localStorage.setItem('selected_agent', JSON.stringify(agent))
    setShowCreateAgent(false)
  }

  const handleAgentSelected = (agent: Agent) => {
    setSelectedAgent(agent)
    localStorage.setItem('selected_agent', JSON.stringify(agent))
  }

  const handleCampaignSelected = (campaign: Campaign) => {
    setSelectedCampaign(campaign)
  }

  const handleStartMining = () => {
    if (selectedAgent && selectedCampaign) {
      setMiningStatus('mining')
      setMinerStatus('MINING')
    }
  }

  const handleMiningComplete = () => {
    setMiningStatus('idle')
    setMinerStatus('IDLE')
  }

  // Show agent creation if no agents exist
  const shouldShowAgentCreation = walletAddress && minerId && agents.length === 0

  if (!isConnected) {
    return (
      <div className="gaming-card p-6 text-center">
        <div className="neon-text neon-red text-4xl mb-4">🔒</div>
        <h3 className="neon-text neon-blue text-xl font-semibold mb-2">SYSTEM LOCKED</h3>
        <p className="text-gray-400">Connect your wallet to access miner dashboard</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">⛏️</span>
                </div>
                <h1 className="text-xl font-bold text-white">RoastPower Mining</h1>
              </div>
              {blockNotification && (
                <div className="bg-yellow-600 text-yellow-100 px-3 py-1 rounded-full text-sm font-medium animate-pulse">
                  {blockNotification}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <ConnectionStatus 
                isApiConnected={apiConnected}
                isWsConnected={wsConnected}
                minerStatus={minerStatus}
              />
              <WalletConnector />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!walletAddress ? (
          // Wallet Connection Required
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gradient-to-r from-orange-500 to-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl">🔗</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Connect Your Wallet</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Connect your wallet to start mining and earning rewards from content creation campaigns.
            </p>
            <WalletConnector />
          </div>
        ) : shouldShowAgentCreation ? (
          // Agent Creation Required
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl">🤖</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Create Your First Agent</h2>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Before you can start mining, you need to create an AI agent that will generate content for campaigns. 
              Bring your own API keys and configure your agent's personality.
            </p>
            <button
              onClick={() => setShowCreateAgent(true)}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg"
            >
              Create Agent
            </button>
          </div>
        ) : (
          // Main Dashboard
          <div className="space-y-8">
            {/* Agent & Campaign Selection */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Agent Selection */}
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">AI Agent</h3>
                  <button
                    onClick={() => setShowCreateAgent(true)}
                    className="px-3 py-1 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 transition-colors"
                  >
                    + New Agent
                  </button>
                </div>
                
                {agents.length > 0 ? (
                  <div className="space-y-3">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        onClick={() => handleAgentSelected(agent)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedAgent?.id === agent.id
                            ? 'border-purple-500 bg-purple-900/20'
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-white">{agent.name}</h4>
                            <p className="text-sm text-gray-400">{agent.personality} • {agent.provider} {agent.model}</p>
                          </div>
                          <div className={`w-2 h-2 rounded-full ${agent.isActive ? 'bg-green-500' : 'bg-gray-500'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-4">No agents created yet</p>
                )}
              </div>

              {/* Campaign Selection */}
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Active Campaigns</h3>
                  <div className="flex items-center space-x-2">
                    {loadingCampaigns && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
                    )}
                    <span className="text-sm text-gray-400">Refreshing every 5s</span>
                  </div>
                </div>
                
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {campaigns.length > 0 ? (
                    campaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        onClick={() => handleCampaignSelected(campaign)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedCampaign?.id === campaign.id
                            ? 'border-orange-500 bg-orange-900/20'
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-white">{campaign.title}</h4>
                          <span className="text-sm text-green-400">${campaign.winner_reward.toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-gray-400 mb-2">{campaign.description}</p>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">{campaign.category || campaign.topic}</span>
                          <span className="text-gray-500">
                            {campaign.current_submissions}/{campaign.max_submissions} submissions
                          </span>
                        </div>
                        {campaign.is_full && (
                          <div className="mt-2 text-xs text-red-400">Campaign Full</div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-400 text-center py-4">
                      {loadingCampaigns ? 'Loading campaigns...' : 'No active campaigns'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Start Mining Button */}
            {selectedAgent && selectedCampaign && !selectedCampaign.is_full && (
              <div className="text-center">
                <button
                  onClick={handleStartMining}
                  disabled={miningStatus === 'mining'}
                  className={`px-8 py-4 text-lg font-bold rounded-lg transition-all duration-200 shadow-lg ${
                    miningStatus === 'mining'
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-orange-600 to-red-600 text-white hover:from-orange-700 hover:to-red-700 transform hover:scale-105'
                  }`}
                >
                  {miningStatus === 'mining' ? '⚡ Mining in Progress...' : '🚀 Start Mining'}
                </button>
                <p className="text-gray-400 mt-2 text-sm">
                  Generate content using {selectedAgent.name} for "{selectedCampaign.title}"
                </p>
              </div>
            )}

            {/* Content Generator */}
            {miningStatus === 'mining' && selectedAgent && selectedCampaign && (
              <ContentGenerator
                selectedCampaigns={[selectedCampaign.id]}
                campaigns={campaigns}
                minerData={{
                  agent_personality: selectedAgent.personality,
                  id: minerId
                }}
                onContentGenerated={(content, tokensUsed, campaignId) => {
                  console.log('Content generated:', { content, tokensUsed, campaignId })
                  handleMiningComplete()
                }}
              />
            )}

            {/* Campaign List */}
            <CampaignList 
              campaigns={campaigns}
              selectedCampaign={selectedCampaign}
              onCampaignSelect={handleCampaignSelected}
            />

            {/* Performance Stats */}
            <PerformanceStats />
          </div>
        )}
      </main>

      {/* Create Agent Modal - Placeholder for now */}
      {showCreateAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-4">Create Agent</h3>
            <p className="text-gray-400 mb-4">Agent creation feature coming soon!</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateAgent(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 