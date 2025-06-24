import { useState } from 'react'

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

interface CreateAgentModalProps {
  onClose: () => void
  onAgentCreated: (agent: Agent) => void
}

const providers = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { value: 'anthropic', label: 'Anthropic', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
  { value: 'google', label: 'Google', models: ['gemini-pro', 'gemini-pro-vision'] },
  { value: 'cohere', label: 'Cohere', models: ['command', 'command-light'] },
]

const personalities = [
  { value: 'SAVAGE', label: 'Savage 🔥', description: 'Brutal, no-holds-barred roasting' },
  { value: 'WITTY', label: 'Witty 🎭', description: 'Clever and humorous takes' },
  { value: 'CHAOTIC', label: 'Chaotic 🌪️', description: 'Unpredictable and wild content' },
  { value: 'LEGENDARY', label: 'Legendary 👑', description: 'Epic and memorable content' },
  { value: 'ANALYTICAL', label: 'Analytical 🧠', description: 'Data-driven insights' },
  { value: 'CREATIVE', label: 'Creative 🎨', description: 'Original and artistic content' },
]

export function CreateAgentModal({ onClose, onAgentCreated }: CreateAgentModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    personality: 'SAVAGE',
    provider: 'openai',
    model: 'gpt-4',
    apiKey: '',
    systemPrompt: '',
    temperature: 0.8,
    maxTokens: 2000,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = providers.find(p => p.value === formData.provider)
  const selectedPersonality = personalities.find(p => p.value === formData.personality)

  const generateSystemPrompt = () => {
    const personalityDesc = selectedPersonality?.description || ''
    const prompt = `You are a ${formData.personality.toLowerCase()} AI agent for content creation campaigns. Your personality: ${personalityDesc}

Your role is to generate engaging content that matches the campaign requirements while maintaining your unique voice and style. Always:
- Stay true to your ${formData.personality.toLowerCase()} personality
- Create content that's appropriate for the target audience
- Follow any specific guidelines provided
- Be creative and original
- Aim for viral potential

Remember: You're competing with other miners, so make your content stand out!`

    setFormData(prev => ({ ...prev, systemPrompt: prompt }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validate required fields
      if (!formData.name || !formData.apiKey) {
        throw new Error('Agent name and API key are required')
      }

      // Test API key (basic validation)
      if (formData.provider === 'openai' && !formData.apiKey.startsWith('sk-')) {
        throw new Error('Invalid OpenAI API key format')
      }

      // Create agent object
      const agent: Agent = {
        id: Date.now().toString(),
        name: formData.name,
        personality: formData.personality,
        provider: formData.provider,
        model: formData.model,
        apiKey: formData.apiKey,
        systemPrompt: formData.systemPrompt,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      // Save to localStorage (in a real app, this would be encrypted)
      const existingAgents = JSON.parse(localStorage.getItem('miner_agents') || '[]')
      const updatedAgents = [...existingAgents, agent]
      localStorage.setItem('miner_agents', JSON.stringify(updatedAgents))

      onAgentCreated(agent)
    } catch (error: any) {
      setError(error.message || 'Failed to create agent')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white">Create AI Agent</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Basic Information</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., RoastMaster3000"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Personality *
                </label>
                <select
                  value={formData.personality}
                  onChange={(e) => setFormData(prev => ({ ...prev, personality: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {personalities.map(personality => (
                    <option key={personality.value} value={personality.value}>
                      {personality.label} - {personality.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* AI Configuration */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">AI Configuration</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Provider *
                  </label>
                  <select
                    value={formData.provider}
                    onChange={(e) => {
                      const provider = providers.find(p => p.value === e.target.value)
                      setFormData(prev => ({ 
                        ...prev, 
                        provider: e.target.value,
                        model: provider?.models[0] || ''
                      }))
                    }}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {providers.map(provider => (
                      <option key={provider.value} value={provider.value}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Model *
                  </label>
                  <select
                    value={formData.model}
                    onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {selectedProvider?.models.map(model => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  API Key *
                </label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Enter your API key"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Your API key is stored locally and never shared. You'll be charged based on usage.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Temperature ({formData.temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={formData.temperature}
                    onChange={(e) => setFormData(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Conservative</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 2000 }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                    min="100"
                    max="4000"
                  />
                </div>
              </div>
            </div>

            {/* System Prompt */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">System Prompt</h3>
                <button
                  type="button"
                  onClick={generateSystemPrompt}
                  className="px-3 py-1 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 transition-colors"
                >
                  Auto-Generate
                </button>
              </div>
              
              <textarea
                value={formData.systemPrompt}
                onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                rows={6}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Define your agent's behavior and personality..."
              />
              <p className="text-xs text-gray-400">
                This prompt defines how your agent behaves. Click "Auto-Generate" for a template based on your selected personality.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-300 bg-gray-700 border border-gray-600 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
} 