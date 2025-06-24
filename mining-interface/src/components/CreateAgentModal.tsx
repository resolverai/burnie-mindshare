'use client'

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

const PERSONALITIES = [
  { value: 'SAVAGE', label: '🔥 Savage', description: 'Brutal, cutting, no mercy' },
  { value: 'WITTY', label: '🧠 Witty', description: 'Clever, sharp, intelligent humor' },
  { value: 'CHAOTIC', label: '🌪️ Chaotic', description: 'Random, unpredictable, wild' },
  { value: 'LEGENDARY', label: '👑 Legendary', description: 'Epic, grandiose, theatrical' },
]

const LLM_PROVIDERS = [
  {
    name: 'OpenAI',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o (Latest)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ]
  },
  {
    name: 'Anthropic',
    models: [
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Latest)' },
      { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
      { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
    ]
  },
  {
    name: 'Google',
    models: [
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'gemini-pro', label: 'Gemini Pro' },
    ]
  },
  {
    name: 'Groq',
    models: [
      { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    ]
  }
]

export function CreateAgentModal({ onClose, onAgentCreated }: CreateAgentModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    personality: '',
    provider: '',
    model: '',
    apiKey: '',
    systemPrompt: '',
    temperature: 0.8,
    maxTokens: 150,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const selectedProvider = LLM_PROVIDERS.find(p => p.name === formData.provider)
  const availableModels = selectedProvider?.models || []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = 'Agent name is required'
    if (!formData.personality) newErrors.personality = 'Personality is required'
    if (!formData.provider) newErrors.provider = 'LLM provider is required'
    if (!formData.model) newErrors.model = 'Model is required'
    if (!formData.apiKey.trim()) newErrors.apiKey = 'API key is required'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Generate system prompt based on personality
    const personalityConfig = PERSONALITIES.find(p => p.value === formData.personality)
    const defaultSystemPrompt = formData.systemPrompt || 
      `You are a ${personalityConfig?.label} AI agent for generating roast content. ${personalityConfig?.description}. Generate creative, humorous content that matches this personality while staying within appropriate bounds.`

    // Create agent
    const newAgent: Agent = {
      id: Date.now().toString(),
      name: formData.name,
      personality: formData.personality,
      provider: formData.provider,
      model: formData.model,
      apiKey: formData.apiKey,
      systemPrompt: defaultSystemPrompt,
      temperature: formData.temperature,
      maxTokens: formData.maxTokens,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    onAgentCreated(newAgent)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value
    }))
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }

    // Reset model when provider changes
    if (name === 'provider') {
      setFormData(prev => ({ ...prev, model: '' }))
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h3 className="text-xl font-bold text-white">🤖 Create AI Agent</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Agent Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
              Agent Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                errors.name ? 'border-red-500' : 'border-gray-600'
              }`}
              placeholder="e.g., SavageRoaster_007"
            />
            {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
          </div>

          {/* Personality */}
          <div>
            <label htmlFor="personality" className="block text-sm font-medium text-gray-300 mb-2">
              Agent Personality *
            </label>
            <select
              id="personality"
              name="personality"
              value={formData.personality}
              onChange={handleChange}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                errors.personality ? 'border-red-500' : 'border-gray-600'
              }`}
            >
              <option value="">Select personality</option>
              {PERSONALITIES.map(personality => (
                <option key={personality.value} value={personality.value}>
                  {personality.label} - {personality.description}
                </option>
              ))}
            </select>
            {errors.personality && <p className="text-red-400 text-sm mt-1">{errors.personality}</p>}
          </div>

          {/* LLM Provider & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="provider" className="block text-sm font-medium text-gray-300 mb-2">
                LLM Provider *
              </label>
              <select
                id="provider"
                name="provider"
                value={formData.provider}
                onChange={handleChange}
                className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  errors.provider ? 'border-red-500' : 'border-gray-600'
                }`}
              >
                <option value="">Select provider</option>
                {LLM_PROVIDERS.map(provider => (
                  <option key={provider.name} value={provider.name}>
                    {provider.name}
                  </option>
                ))}
              </select>
              {errors.provider && <p className="text-red-400 text-sm mt-1">{errors.provider}</p>}
            </div>

            <div>
              <label htmlFor="model" className="block text-sm font-medium text-gray-300 mb-2">
                Model *
              </label>
              <select
                id="model"
                name="model"
                value={formData.model}
                onChange={handleChange}
                disabled={!formData.provider}
                className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 ${
                  errors.model ? 'border-red-500' : 'border-gray-600'
                }`}
              >
                <option value="">Select model</option>
                {availableModels.map(model => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              {errors.model && <p className="text-red-400 text-sm mt-1">{errors.model}</p>}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-300 mb-2">
              API Key *
            </label>
            <input
              type="password"
              id="apiKey"
              name="apiKey"
              value={formData.apiKey}
              onChange={handleChange}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                errors.apiKey ? 'border-red-500' : 'border-gray-600'
              }`}
              placeholder="Enter your API key"
            />
            {errors.apiKey && <p className="text-red-400 text-sm mt-1">{errors.apiKey}</p>}
            <p className="text-gray-400 text-sm mt-1">Your API key is stored locally and never shared</p>
          </div>

          {/* System Prompt (Optional) */}
          <div>
            <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-300 mb-2">
              Custom System Prompt (Optional)
            </label>
            <textarea
              id="systemPrompt"
              name="systemPrompt"
              value={formData.systemPrompt}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Leave empty to use default prompt based on personality"
            />
          </div>

          {/* Advanced Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="temperature" className="block text-sm font-medium text-gray-300 mb-2">
                Temperature: {formData.temperature}
              </label>
              <input
                type="range"
                id="temperature"
                name="temperature"
                min="0"
                max="2"
                step="0.1"
                value={formData.temperature}
                onChange={handleChange}
                className="w-full"
              />
              <p className="text-gray-400 text-xs mt-1">Higher = more creative, Lower = more focused</p>
            </div>

            <div>
              <label htmlFor="maxTokens" className="block text-sm font-medium text-gray-300 mb-2">
                Max Tokens
              </label>
              <input
                type="number"
                id="maxTokens"
                name="maxTokens"
                value={formData.maxTokens}
                onChange={handleChange}
                min="50"
                max="500"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-md hover:from-orange-700 hover:to-red-700 transition-all duration-200 shadow-lg"
            >
              Create Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  )
} 