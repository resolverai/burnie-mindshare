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
      SAVAGE: {
        roast: [
          `${campaign.title} is so overrated, even their own whitepaper calls them a "speculative investment" - which is corporate speak for "we have no idea what we're doing but please give us money anyway."`,
          `I've seen more innovation in a kindergarten art class than in ${campaign.description}. At least the kids use different colors.`,
          `This project promises to revolutionize everything except their ability to deliver on promises. Their track record is more consistent than their technology.`,
          `Their roadmap has more red flags than a communist parade. The only thing they're disrupting is their investors' bank accounts.`,
          `They call it "DeFi innovation" but the only thing they've decentralized is disappointment across multiple blockchains.`
        ],
        meme: [
          `When ${campaign.title} says "HODL" but their chart looks like a ski slope 📉`,
          `${campaign.title} holders explaining why -90% is actually bullish 🤡`,
          `Me: "I'll just invest what I can afford to lose" Also me: *invests in ${campaign.title}* 💀`,
          `${campaign.title}: "We're building the future" The future: 404 not found 🚫`,
          `POV: You bought ${campaign.title} at ATH and now you're a "long-term investor" 📈❌`
        ],
        creative: [
          `Breaking: ${campaign.title} discovers new way to make simple things unnecessarily complicated`,
          `In today's episode of "Blockchain Theater," ${campaign.title} performs the classic "Promise Everything, Deliver Nothing"`,
          `${campaign.title} has achieved what many thought impossible: making traditional finance look efficient`
        ]
      },
      WITTY: {
        roast: [
          `${campaign.title} is like that friend who always says they'll pay you back - technically possible, but you're not holding your breath.`,
          `If ${campaign.title} was a movie, it would be "The Emperor's New Clothes" but with more buzzwords and less plot.`,
          `They've solved the age-old problem of how to make simple things unnecessarily complicated. Innovation!`,
          `${campaign.title} has more pivots than a basketball team with ADHD. At least they're consistent at being inconsistent.`,
          `Their tokenomics make about as much sense as a chocolate teapot in a sauna.`
        ],
        meme: [
          `${campaign.title}: "We're not like other coins, we're a cool coin" *proceeds to dump 50%* 😎`,
          `${campaign.title} community: "This is fine" *everything is on fire* 🔥`,
          `When ${campaign.title} promises utility but delivers only speculation 🎭`,
          `${campaign.title} chart doing the hokey pokey - you put your money in, you take your hopes out 💃`,
          `${campaign.title} whitepaper: 50 pages. Actual utility: 404 not found 📄❌`
        ],
        creative: [
          `${campaign.title}: A masterclass in turning FOMO into FOMA (Fear of Missing Assets)`,
          `They said ${campaign.title} would go to the moon. They just didn't specify which moon... turns out it was one of Pluto's.`,
          `${campaign.title} is what happens when you let a random word generator loose on a business plan`
        ]
      },
      CHAOTIC: {
        roast: [
          `BREAKING: ${campaign.title} discovers new way to lose money - experts are baffled!`,
          `Plot twist: This isn't actually a crypto project, it's an elaborate art installation about disappointment`,
          `In a shocking turn of events, ${campaign.title} somehow made me nostalgic for 2018 ICO scams`,
          `${campaign.title} has achieved what many thought impossible: making Ponzi schemes look transparent`,
          `Scientists are studying ${campaign.title} to understand how something can simultaneously exist and not exist`
        ],
        meme: [
          `${campaign.title} holders: "It's not a loss until you sell" Also them: *never sells* 💎🤡`,
          `${campaign.title} to the moon! *rocket explodes on launch pad* 🚀💥`,
          `When ${campaign.title} says "diamond hands" but you're holding glass 💎➡️🗑️`,
          `${campaign.title} community: "Just wait for the next update" The update: *makes things worse* 🔄💀`,
          `Me explaining ${campaign.title} to my therapist 🛋️😵‍💫`
        ],
        creative: [
          `${campaign.title}: Where logic goes to die and hope becomes a four-letter word`,
          `In the multiverse, there's probably a version where ${campaign.title} makes sense. This isn't that universe.`,
          `${campaign.title} is what happens when chaos theory meets venture capital`
        ]
      },
      LEGENDARY: {
        roast: [
          `Behold! The legendary ${campaign.title} that shall be remembered in the annals of history... as a cautionary tale`,
          `In the great saga of crypto, this chapter will be titled "How ${campaign.title} Taught Us Humility"`,
          `Future archaeologists will study ${campaign.title} to understand the decline of human civilization`,
          `${campaign.title} stands as a monument to human optimism - the belief that if you say "revolutionary" enough times, it might actually become true`,
          `In the pantheon of crypto legends, ${campaign.title} holds the sacred position of "What Not To Do"`
        ],
        meme: [
          `And thus, ${campaign.title} taught us that hope is the last thing to die... right after your portfolio 🏛️`,
          `In the annals of ${campaign.title}, let it be written: "They came, they saw, they got rekt" 📜`,
          `${campaign.title}: A tale of two tokens - one was promised, one was delivered. Guess which one exists? 📚`,
          `The ${campaign.title} Chronicles: Chapter 1 - "The Phantom Utility" 👻`,
          `${campaign.title}: An epic journey from "revolutionary" to "what happened?" 🗺️❓`
        ],
        creative: [
          `${campaign.title}: A Shakespearean tragedy in three acts - Hope, Hype, and Heartbreak`,
          `In the grand theater of ${campaign.title}, we witness the eternal dance between ambition and reality`,
          `${campaign.title} shall be remembered as the project that united the crypto community... in confusion`
        ]
      }
    }

    const personality = agent?.personality as keyof typeof personalities || 'SAVAGE'
    const contentType = campaign.campaign_type as keyof typeof personalities['SAVAGE'] || 'roast'
    const templates = personalities[personality]?.[contentType] || personalities.SAVAGE.roast
    
    return templates[Math.floor(Math.random() * templates.length)]
  }

  const submitContent = async (campaignId: string, content: string, tokensUsed: number, minerId: string): Promise<boolean> => {
    try {
      const response = await fetch('http://localhost:8000/api/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          minerId: parseInt(minerId),
          campaignId: parseInt(campaignId),
          content,
          tokensUsed,
          minerWallet: walletAddress,
          transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
          metadata: {
            agent: agent?.name,
            personality: agent?.personality,
            model: agent?.model,
            provider: agent?.provider,
            generatedAt: new Date().toISOString()
          }
        }),
      })

      const data = await response.json()
      if (data.success) {
        addMiningLog(`✅ Submitted to "${campaigns.find(c => c.id === campaignId)?.title}" - ID: ${data.data.submissionId}`)
        return true
      } else {
        addMiningLog(`❌ Submission failed: ${data.error}`)
        return false
      }
    } catch (error) {
      console.error('Failed to submit content:', error)
      addMiningLog(`❌ Network error during submission`)
      return false
    }
  }

  const startMining = async () => {
    if (!agent || campaigns.length === 0) {
      addMiningLog(`❌ Cannot start mining: ${!agent ? 'No agent configured' : 'No campaigns available'}`)
      return
    }

    // Get current miner ID from localStorage or generate one
    let minerId = localStorage.getItem('current_miner_id')
    if (!minerId) {
      addMiningLog(`❌ No miner ID found. Please connect wallet first.`)
      return
    }

    setIsMining(true)
    addMiningLog(`🚀 Starting mining with ${agent.name} (${agent.personality})...`)
    addMiningLog(`👤 Miner ID: ${minerId}`)

    const availableCampaigns = campaigns.filter(c => !c.is_full && c.current_submissions < c.max_submissions)
    addMiningLog(`🎯 Found ${availableCampaigns.length} available campaigns`)

    let sessionStats = {
      totalGenerated: 0,
      totalSubmitted: 0,
      tokensUsed: 0,
      successfulSubmissions: 0
    }

    for (let i = 0; i < availableCampaigns.length && isMining; i++) {
      const campaign = availableCampaigns[i]
      
      addMiningLog(`⚡ [${i+1}/${availableCampaigns.length}] Generating content for "${campaign.title}"...`)
      
      try {
        // Generate content
        const content = await simulateContentGeneration(campaign)
        const tokensUsed = Math.floor(Math.random() * 80) + 40 // 40-120 tokens
        
        sessionStats.totalGenerated++
        sessionStats.tokensUsed += tokensUsed

        addMiningLog(`📝 Generated (${tokensUsed} tokens): "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`)

        // Submit content
        const submitted = await submitContent(campaign.id, content, tokensUsed, minerId)
        if (submitted) {
          sessionStats.totalSubmitted++
          sessionStats.successfulSubmissions++
          
          // Simulate scoring
          const score = (Math.random() * 4 + 6).toFixed(1) // 6.0-10.0 score
          addMiningLog(`🎯 Content scored ${score}/10 - Reward pending`)
        }

        // Update stats
        const newStats = {
          ...miningStats,
          totalGenerated: miningStats.totalGenerated + sessionStats.totalGenerated,
          totalSubmitted: miningStats.totalSubmitted + sessionStats.totalSubmitted,
          tokensUsed: miningStats.tokensUsed + sessionStats.tokensUsed,
          successRate: Math.round((sessionStats.successfulSubmissions / sessionStats.totalGenerated) * 100),
          currentStreak: submitted ? miningStats.currentStreak + 1 : 0,
                     averageScore: Math.round((Math.random() * 2 + 7) * 10) / 10 // 7.0-9.0 average
        }
        
        setMiningStats(newStats)
        localStorage.setItem('mining_stats', JSON.stringify(newStats))

        // Add delay between submissions (1-3 seconds)
        if (i < availableCampaigns.length - 1) {
          const delay = 1000 + Math.random() * 2000
          addMiningLog(`⏱️ Waiting ${Math.round(delay/1000)}s before next generation...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        
      } catch (error) {
        console.error('Content generation error:', error)
        addMiningLog(`❌ Error generating content for "${campaign.title}": ${error}`)
      }
    }

    setIsMining(false)
    addMiningLog(`🏁 Mining session completed!`)
    addMiningLog(`📊 Session stats: ${sessionStats.totalGenerated} generated, ${sessionStats.totalSubmitted} submitted, ${sessionStats.tokensUsed} tokens used`)
    
    // Update final stats
    const finalSuccessRate = sessionStats.totalGenerated > 0 
      ? Math.round((sessionStats.successfulSubmissions / sessionStats.totalGenerated) * 100)
      : miningStats.successRate
      
    const updatedStats = {
      ...miningStats,
      successRate: finalSuccessRate
    }
    setMiningStats(updatedStats)
    localStorage.setItem('mining_stats', JSON.stringify(updatedStats))
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