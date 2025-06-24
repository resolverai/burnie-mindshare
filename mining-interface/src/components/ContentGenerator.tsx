'use client'

import { useState } from 'react'
import { BurnieAPIClient } from '../services/burnie-api'

interface ContentGeneratorProps {
  selectedCampaigns: number[]
  campaigns: any[]
  minerData: any
  onContentGenerated: (content: string, tokensUsed: number, campaignId: number) => void
}

const api = new BurnieAPIClient()

export default function ContentGenerator({ 
  selectedCampaigns, 
  campaigns, 
  minerData,
  onContentGenerated 
}: ContentGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<{
    [campaignId: number]: {
      content: string
      tokensUsed: number
      timestamp: number
    }
  }>({})

  // Mock LLM content generation (in real implementation, this would call OpenAI/Claude)
  const generateContentForCampaign = async (campaign: any): Promise<{ content: string; tokensUsed: number }> => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

    // Mock content generation based on campaign type and personality
    const personality = minerData?.agent_personality || 'SAVAGE'
    const campaignType = campaign.campaign_type || 'roast'
    
    let content = ''
    let baseTokens = 80 + Math.floor(Math.random() * 40) // 80-120 base tokens

    if (campaignType === 'roast') {
      const roastTemplates = {
        SAVAGE: [
          `${campaign.topic} is so overrated, even their own whitepaper calls them a "speculative investment" - which is corporate speak for "we have no idea what we're doing but please give us money anyway."`,
          `I've seen more innovation in a kindergarten art class than in ${campaign.topic}'s entire roadmap. At least the kids use different colors.`,
          `${campaign.topic} promises to revolutionize everything except their ability to deliver on promises. Their track record is more consistent than their technology.`
        ],
        WITTY: [
          `${campaign.topic} is like that friend who always says they'll pay you back - technically possible, but you're not holding your breath.`,
          `If ${campaign.topic} was a movie, it would be "The Emperor's New Clothes" but with more buzzwords and less plot.`,
          `${campaign.topic} has solved the age-old problem of how to make simple things unnecessarily complicated. Innovation!`
        ],
        CHAOTIC: [
          `${campaign.topic} is what happens when you let a random word generator loose on a business plan. "Synergistic blockchain solutions" anyone?`,
          `I asked ${campaign.topic} for directions and they gave me a roadmap to nowhere with 47 stops at "Coming Soon" stations.`,
          `${campaign.topic} has more pivots than a basketball team with ADHD. At least they're consistent at being inconsistent.`
        ],
        LEGENDARY: [
          `In the grand theater of ${campaign.topic}, we witness the eternal dance between ambition and reality - a performance so captivating in its absurdity that even Shakespeare would weep.`,
          `${campaign.topic} stands as a monument to human optimism - the belief that if you say "revolutionary" enough times, it might actually become true.`,
          `History will remember ${campaign.topic} as the project that taught us the difference between disruption and destruction - spoiler alert: they chose the latter.`
        ]
      }

      const templates = roastTemplates[personality as keyof typeof roastTemplates] || roastTemplates.SAVAGE
      content = templates[Math.floor(Math.random() * templates.length)]
      baseTokens += 20 // Roasts tend to be longer
    } 
    else if (campaignType === 'meme') {
      const memeTemplates = {
        SAVAGE: [
          `When ${campaign.topic} says "HODL" but their chart looks like a ski slope 📉`,
          `${campaign.topic} holders explaining why -90% is actually bullish 🤡`,
          `Me: "I'll just invest what I can afford to lose" Also me: *invests in ${campaign.topic}* 💀`
        ],
        WITTY: [
          `${campaign.topic}: "We're not like other coins, we're a cool coin" *proceeds to dump 50%* 😎`,
          `${campaign.topic} community: "This is fine" *everything is on fire* 🔥`,
          `POV: You bought ${campaign.topic} at the top and now you're a long-term investor 📈❌`
        ],
        CHAOTIC: [
          `${campaign.topic} chart doing the hokey pokey - you put your money in, you take your hopes out 💃`,
          `${campaign.topic} whitepaper: 50 pages. ${campaign.topic} actual utility: 404 not found 📄❌`,
          `When ${campaign.topic} says "diamond hands" but you're holding glass 💎➡️🗑️`
        ],
        LEGENDARY: [
          `And thus, ${campaign.topic} taught us that hope is the last thing to die... right after your portfolio 🏛️`,
          `In the annals of ${campaign.topic}, let it be written: "They came, they saw, they got rekt" 📜`,
          `${campaign.topic}: A masterclass in turning FOMO into FOMA (Fear of Missing Assets) 🎭`
        ]
      }

      const templates = memeTemplates[personality as keyof typeof memeTemplates] || memeTemplates.SAVAGE
      content = templates[Math.floor(Math.random() * templates.length)]
      baseTokens += 10 // Memes are usually shorter but with emojis
    }
    else {
      // Creative content
      content = `Creative content about ${campaign.topic} - ${personality} style analysis and commentary.`
      baseTokens += Math.floor(Math.random() * 30)
    }

    // Add some randomness to token usage
    const tokensUsed = baseTokens + Math.floor(Math.random() * 20)

    return { content, tokensUsed }
  }

  const generateAllContent = async () => {
    if (selectedCampaigns.length === 0) return

    setIsGenerating(true)
    const newContent: typeof generatedContent = {}

    try {
      // Generate content for each selected campaign
      for (const campaignId of selectedCampaigns) {
        const campaign = campaigns.find(c => c.id === campaignId)
        if (!campaign) continue

        console.log(`🎨 Generating content for campaign: ${campaign.title}`)
        
        const { content, tokensUsed } = await generateContentForCampaign(campaign)
        
        newContent[campaignId] = {
          content,
          tokensUsed,
          timestamp: Date.now()
        }

        // Submit to backend immediately
        try {
          const minerId = localStorage.getItem('current_miner_id')
          if (!minerId) {
            console.error('❌ No miner ID found for submission')
            continue
          }

          const result = await api.submitContent({
            minerId: parseInt(minerId),
            campaignId: campaignId,
            content,
            tokensUsed,
            minerWallet: '0x' + Math.random().toString(16).substr(2, 40), // Would get from wallet
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            metadata: {
              personality: minerData?.agent_personality,
              generated_at: new Date().toISOString(),
              campaign_type: campaign.campaign_type
            }
          })

          console.log(`✅ Content submitted for campaign ${campaignId}:`, result)
          onContentGenerated(content, tokensUsed, campaignId)

        } catch (submitError) {
          console.error(`❌ Failed to submit content for campaign ${campaignId}:`, submitError)
        }
      }

      setGeneratedContent(prev => ({ ...prev, ...newContent }))
      
    } catch (error) {
      console.error('❌ Content generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const selectedCampaignData = campaigns.filter(c => selectedCampaigns.includes(c.id))

  return (
    <div className="mining-card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="mining-title">Content Generator</h3>
        <div className="text-sm text-gray-400">
          {selectedCampaigns.length} campaigns selected
        </div>
      </div>

      {selectedCampaigns.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-4">🎯</div>
          <p className="mining-subtitle">Select campaigns to start generating content</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Selected Campaigns Preview */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">Selected Campaigns:</h4>
            {selectedCampaignData.map((campaign) => (
              <div key={campaign.id} className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{campaign.title}</span>
                  <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded">
                    {campaign.campaign_type}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{campaign.description}</p>
                {generatedContent[campaign.id] && (
                  <div className="mt-3 p-3 bg-green-500/10 rounded border border-green-500/20">
                    <div className="text-xs text-green-400 mb-1">
                      Generated • {generatedContent[campaign.id].tokensUsed} tokens
                    </div>
                    <div className="text-sm text-white">
                      {generatedContent[campaign.id].content}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Generate Button */}
          <button
            onClick={generateAllContent}
            disabled={isGenerating}
            className={`btn-primary w-full ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isGenerating ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Generating Content...</span>
              </div>
            ) : (
              <span>🎨 Generate Content for All Campaigns</span>
            )}
          </button>

          {/* Stats */}
          {Object.keys(generatedContent).length > 0 && (
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
              <div className="text-center">
                <div className="mining-stat-value text-lg">
                  {Object.values(generatedContent).reduce((sum, item) => sum + item.tokensUsed, 0)}
                </div>
                <div className="mining-stat-label">Total Tokens</div>
              </div>
              <div className="text-center">
                <div className="mining-stat-value text-lg">
                  {Object.keys(generatedContent).length}
                </div>
                <div className="mining-stat-label">Generated</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
} 