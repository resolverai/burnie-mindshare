'use client'

import { useState, useEffect } from 'react'
import { CreateAgentModal } from './CreateAgentModal'

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
  id: string
  title: string
  description: string
  campaign_type: string
  category: string
  winner_reward: number
  max_submissions: number
  current_submissions: number
  time_remaining: string
  submission_rate: number
  is_full: boolean
}

interface MiningStats {
  totalGenerated: number
  totalSubmitted: number
  tokensUsed: number
  successRate: number
  currentStreak: number
  averageScore: number
}

interface MinerDashboardProps {
  walletAddress: string | null
  isConnected: boolean
}

export const MinerDashboard: React.FC<MinerDashboardProps> = ({ 
  walletAddress, 
  isConnected 
}) => {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isMining, setIsMining] = useState(false)
  const [miningStats, setMiningStats] = useState<MiningStats>({
    totalGenerated: 0,
    totalSubmitted: 0,
    tokensUsed: 0,
    successRate: 0,
    currentStreak: 0,
    averageScore: 0,
  })
  const [miningLogs, setMiningLogs] = useState<string[]>([])

  useEffect(() => {
    // Load agent from localStorage
    const savedAgent = localStorage.getItem('mining_agent')
    if (savedAgent) {
      setAgent(JSON.parse(savedAgent))
    }

    // Load mining stats
    const savedStats = localStorage.getItem('mining_stats')
    if (savedStats) {
      setMiningStats(JSON.parse(savedStats))
    }

    // Load campaigns
    fetchCampaigns()
  }, [])

  const fetchCampaigns = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/campaigns')
      const data = await response.json()
      if (data.success && Array.isArray(data.data)) {
        setCampaigns(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch campaigns:', error)
      // No mock data - show empty state when backend is unavailable
      setCampaigns([])
    }
  }

  const handleAgentCreated = (newAgent: Agent) => {
    setAgent(newAgent)
    localStorage.setItem('mining_agent', JSON.stringify(newAgent))
    setShowCreateAgent(false)
    addMiningLog(`🤖 Agent "${newAgent.name}" created with ${newAgent.personality} personality`)
  }

  const addMiningLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setMiningLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)])
  }

  const simulateContentGeneration = async (campaign: Campaign): Promise<string> => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

    const personalities = {
      SAVAGE: [
        `This ${campaign.category} project is so bad, even my grandmother's knitting circle could build better DeFi protocols`,
        `Calling this ${campaign.category} "innovative" is like calling a broken calculator "mathematically advanced"`,
        `I've seen more creativity in a bowl of plain oatmeal than in this entire ${campaign.category} ecosystem`,
      ],
      WITTY: [
        `This ${campaign.category} project has more red flags than a communist parade`,
        `Their tokenomics make about as much sense as a chocolate teapot`,
        `I'm not saying this is a rug pull, but I've seen Persian carpets with more transparency`,
      ],
      CHAOTIC: [
        `BREAKING: Local ${campaign.category} project discovers new way to lose money - experts are baffled!`,
        `Plot twist: This isn't actually a ${campaign.category} project, it's an elaborate art installation about disappointment`,
        `In a shocking turn of events, this project somehow made me nostalgic for 2018 ICO scams`,
      ],
      LEGENDARY: [
        `Behold! The legendary ${campaign.category} project that shall be remembered in the annals of history... as a cautionary tale`,
        `In the great saga of ${campaign.category}, this chapter will be titled "How Not To Build Anything"`,
        `Future archaeologists will study this ${campaign.category} project to understand the decline of human civilization`,
      ]
    }

    const personalityContent = personalities[agent?.personality as keyof typeof personalities] || personalities.SAVAGE
    return personalityContent[Math.floor(Math.random() * personalityContent.length)]
  }

  const submitContent = async (campaignId: string, content: string) => {
    try {
      const response = await fetch('http://localhost:8000/api/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId,
          minerId: agent?.id,
          content,
          contentType: 'text',
          metadata: {
            agent: agent?.name,
            personality: agent?.personality,
            model: agent?.model,
            provider: agent?.provider,
          }
        }),
      })

      const data = await response.json()
      return data.success
    } catch (error) {
      console.error('Failed to submit content:', error)
      return false
    }
  }

  const startMining = async () => {
    if (!agent || campaigns.length === 0) return

    setIsMining(true)
    addMiningLog(`🚀 Starting mining with ${agent.name}...`)

    const availableCampaigns = campaigns.filter(c => !c.is_full)
    let totalGenerated = 0
    let totalSubmitted = 0
    let tokensUsed = 0

    for (const campaign of availableCampaigns) {
      if (!isMining) break

      addMiningLog(`⚡ Generating content for "${campaign.title}"...`)
      
      try {
        const content = await simulateContentGeneration(campaign)
        totalGenerated++
        tokensUsed += Math.floor(Math.random() * 100) + 50 // Simulate token usage

        addMiningLog(`📝 Generated: "${content.substring(0, 60)}..."`)

        // Simulate submission
        const submitted = await submitContent(campaign.id, content)
        if (submitted) {
          totalSubmitted++
          addMiningLog(`✅ Submitted to "${campaign.title}"`)
        } else {
          addMiningLog(`❌ Failed to submit to "${campaign.title}"`)
        }

        // Update stats
        const newStats = {
          ...miningStats,
          totalGenerated: miningStats.totalGenerated + totalGenerated,
          totalSubmitted: miningStats.totalSubmitted + totalSubmitted,
          tokensUsed: miningStats.tokensUsed + tokensUsed,
          successRate: ((miningStats.totalSubmitted + totalSubmitted) / (miningStats.totalGenerated + totalGenerated)) * 100,
          currentStreak: submitted ? miningStats.currentStreak + 1 : 0,
          averageScore: 75 + Math.random() * 20, // Simulate score
        }
        setMiningStats(newStats)
        localStorage.setItem('mining_stats', JSON.stringify(newStats))

        // Wait before next campaign
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        addMiningLog(`💥 Error generating content for "${campaign.title}"`)
      }
    }

    setIsMining(false)
    addMiningLog(`🏁 Mining completed! Generated ${totalGenerated}, Submitted ${totalSubmitted}`)
  }

  const stopMining = () => {
    setIsMining(false)
    addMiningLog('⏹️ Mining stopped by user')
  }

  const resetAgent = () => {
    setAgent(null)
    localStorage.removeItem('mining_agent')
    addMiningLog('🔄 Agent reset')
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h3 className="text-2xl font-bold mb-2">Connect Wallet</h3>
          <p className="text-gray-400">Connect your wallet to access the mining interface</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent mb-2">
            🔥 RoastPower Mining Interface
          </h1>
          <p className="text-gray-400">Generate savage content with AI agents</p>
        </div>

        {!agent ? (
          /* No Agent State */
          <div className="max-w-2xl mx-auto text-center">
            <div className="bg-gray-800 rounded-lg p-8 border border-gray-700">
              <div className="text-6xl mb-4">🤖</div>
              <h2 className="text-2xl font-bold mb-4">Create Your AI Agent</h2>
              <p className="text-gray-400 mb-6">
                Set up your AI agent with personality, LLM provider, and model to start mining content
              </p>
              <button
                onClick={() => setShowCreateAgent(true)}
                className="px-6 py-3 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-lg hover:from-orange-700 hover:to-red-700 transition-all duration-200 shadow-lg"
              >
                Create Agent
              </button>
            </div>
          </div>
        ) : (
          /* Agent Active State */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Agent Info */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">🤖 Agent Status</h3>
                <button
                  onClick={resetAgent}
                  className="text-gray-400 hover:text-red-400 text-sm"
                >
                  Reset
                </button>
              </div>
              
              <div className="space-y-3">
                <div>
                  <span className="text-gray-400">Name:</span>
                  <span className="ml-2 font-semibold">{agent.name}</span>
                </div>
                <div>
                  <span className="text-gray-400">Personality:</span>
                  <span className="ml-2 font-semibold">{agent.personality}</span>
                </div>
                <div>
                  <span className="text-gray-400">Model:</span>
                  <span className="ml-2 font-semibold">{agent.provider} {agent.model}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-gray-400">Status:</span>
                  <span className={`ml-2 px-2 py-1 rounded text-xs ${
                    isMining ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {isMining ? '⚡ Mining' : '💤 Idle'}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                {!isMining ? (
                  <button
                    onClick={startMining}
                    disabled={campaigns.length === 0}
                    className="w-full px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all duration-200 disabled:opacity-50"
                  >
                    🚀 Start Mining
                  </button>
                ) : (
                  <button
                    onClick={stopMining}
                    className="w-full px-4 py-2 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-lg hover:from-red-700 hover:to-pink-700 transition-all duration-200"
                  >
                    ⏹️ Stop Mining
                  </button>
                )}
              </div>
            </div>

            {/* Mining Stats */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-xl font-bold mb-4">📊 Mining Stats</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-400">{miningStats.totalGenerated}</div>
                  <div className="text-sm text-gray-400">Generated</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">{miningStats.totalSubmitted}</div>
                  <div className="text-sm text-gray-400">Submitted</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-400">{miningStats.tokensUsed.toLocaleString()}</div>
                  <div className="text-sm text-gray-400">Tokens Used</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-400">{miningStats.successRate.toFixed(1)}%</div>
                  <div className="text-sm text-gray-400">Success Rate</div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-700">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Current Streak:</span>
                  <span className="font-semibold">{miningStats.currentStreak}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">Avg Score:</span>
                  <span className="font-semibold">{miningStats.averageScore.toFixed(1)}</span>
                </div>
              </div>
            </div>

            {/* Mining Logs */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-xl font-bold mb-4">📋 Mining Logs</h3>
              
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {miningLogs.map((log, index) => (
                  <div key={index} className="text-sm text-gray-300 font-mono">
                    {log}
                  </div>
                ))}
                {miningLogs.length === 0 && (
                  <div className="text-gray-500 text-sm">No logs yet...</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Campaigns Section */}
        {agent && (
          <div className="mt-8">
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-xl font-bold mb-4">🎯 Available Campaigns</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-white">{campaign.title}</h4>
                      <span className="text-green-400 font-bold">${campaign.winner_reward.toLocaleString()}</span>
                    </div>
                    <p className="text-gray-300 text-sm mb-3">{campaign.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{campaign.category} • {campaign.campaign_type}</span>
                      <span className="text-gray-400">{campaign.current_submissions}/{campaign.max_submissions}</span>
                    </div>
                    <div className="mt-2">
                      <div className="bg-gray-600 rounded-full h-2">
                        <div 
                          className="bg-orange-500 h-2 rounded-full" 
                          style={{ width: `${(campaign.current_submissions / campaign.max_submissions) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      {campaign.time_remaining} remaining
                    </div>
                  </div>
                ))}
                {campaigns.length === 0 && (
                  <div className="col-span-2 text-center py-8 text-gray-400">
                    No campaigns available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Agent Modal */}
        {showCreateAgent && (
          <CreateAgentModal
            onClose={() => setShowCreateAgent(false)}
            onAgentCreated={handleAgentCreated}
          />
        )}
      </div>
    </div>
  )
} 