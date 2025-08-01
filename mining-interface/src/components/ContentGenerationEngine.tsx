'use client'

import React, { useState, useEffect } from 'react'
import { aiProviderManager, ContentGenerationRequest, ContentGenerationResponse } from '../services/ai-providers'

interface ContentGenerationEngineProps {
  onContentGenerated: (content: ContentGenerationResponse) => void
  selectedCampaign?: any
  agentPersonality?: string
}

interface ApiKeys {
  openai: string
  anthropic: string
  mock: string
}

export default function ContentGenerationEngine({ 
  onContentGenerated, 
  selectedCampaign, 
  agentPersonality 
}: ContentGenerationEngineProps) {
  const [prompt, setPrompt] = useState('')
  const [contentType, setContentType] = useState<'text' | 'image' | 'video' | 'audio'>('text')
  const [selectedProvider, setSelectedProvider] = useState('mock')
  const [selectedModel, setSelectedModel] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<ContentGenerationResponse | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    openai: '',
    anthropic: '',
    mock: ''
  })
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  // Load API keys from localStorage on mount
  useEffect(() => {
    const savedKeys = localStorage.getItem('roastpower_api_keys')
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys)
        setApiKeys({ ...apiKeys, ...parsed })
      } catch (error) {
        console.error('Failed to parse saved API keys:', error)
      }
    }
  }, [])

  // Get available providers for selected content type
  const availableProviders = aiProviderManager.getProvidersForContentType(contentType)

  // Get available models for selected provider
  const getModelsForProvider = (providerName: string, contentType: string) => {
    switch (providerName.toLowerCase()) {
      case 'openai':
        return contentType === 'text' 
          ? ['gpt-4-turbo-preview', 'gpt-4o', 'gpt-4', 'gpt-3.5-turbo']
          : contentType === 'image'
          ? ['dall-e-3', 'dall-e-2']
          : contentType === 'audio'
          ? ['tts-1-hd', 'tts-1']
          : []
      case 'anthropic':
        return ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']
      case 'mock':
        return [`mock-${contentType}-model`, 'demo-model', 'test-model']
      default:
        return []
    }
  }

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider)
    const models = getModelsForProvider(provider, contentType)
    setSelectedModel(models[0] || '')
  }

  const handleContentTypeChange = (type: 'text' | 'image' | 'video' | 'audio') => {
    setContentType(type)
    const providers = aiProviderManager.getProvidersForContentType(type)
    if (providers.length > 0) {
      const defaultProvider = providers[0].name.toLowerCase().replace(/\s+.*/, '') // Remove "(Coming Soon)" etc
      setSelectedProvider(defaultProvider)
      const models = getModelsForProvider(defaultProvider, type)
      setSelectedModel(models[0] || '')
    }
  }

  const saveApiKeys = () => {
    localStorage.setItem('roastpower_api_keys', JSON.stringify(apiKeys))
    setShowApiKeyModal(false)
  }

  const generateContent = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt')
      return
    }

    const apiKey = apiKeys[selectedProvider as keyof ApiKeys] || ''
    
    // Check if API key is needed and provided
    if (selectedProvider === 'openai' && !apiKey) {
      alert('Please configure your OpenAI API key first')
      setShowApiKeyModal(true)
      return
    }

    setIsGenerating(true)
    try {
      const request: ContentGenerationRequest = {
        prompt: agentPersonality ? `${agentPersonality}\n\nPrompt: ${prompt}` : prompt,
        contentType,
        model: selectedModel,
        options: {
          temperature: 0.7,
          maxTokens: contentType === 'text' ? 500 : undefined,
          quality: 'standard',
          duration: contentType === 'video' ? 5 : contentType === 'audio' ? 10 : undefined,
        }
      }

      const response = await aiProviderManager.generateContent(
        selectedProvider,
        request,
        apiKey
      )

      setGeneratedContent(response)
      onContentGenerated(response)
    } catch (error) {
      console.error('Content generation failed:', error)
      alert(`Content generation failed: ${error}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const renderContentPreview = () => {
    if (!generatedContent) return null

    switch (generatedContent.contentType) {
      case 'text':
        return (
          <div className="bg-gray-800 p-4 rounded-lg">
            <h4 className="text-white font-semibold mb-2">Generated Text:</h4>
            <div className="text-gray-300 whitespace-pre-wrap">{generatedContent.content}</div>
          </div>
        )
      case 'image':
        return (
          <div className="bg-gray-800 p-4 rounded-lg">
            <h4 className="text-white font-semibold mb-2">Generated Image:</h4>
            <img 
              src={generatedContent.content} 
              alt="Generated content" 
              className="max-w-full h-auto rounded-lg"
              onError={(e) => {
                // Fallback if image fails to load
                (e.target as HTMLImageElement).src = 'https://via.placeholder.com/512x512/1a1a1a/ff6b35?text=IMAGE+PREVIEW'
              }}
            />
          </div>
        )
      case 'video':
        return (
          <div className="bg-gray-800 p-4 rounded-lg">
            <h4 className="text-white font-semibold mb-2">Generated Video:</h4>
            <video 
              src={generatedContent.content} 
              controls 
              className="max-w-full h-auto rounded-lg"
            >
              <p className="text-gray-400">Your browser doesn't support video playback.</p>
            </video>
          </div>
        )
      case 'audio':
        return (
          <div className="bg-gray-800 p-4 rounded-lg">
            <h4 className="text-white font-semibold mb-2">Generated Audio:</h4>
            <audio 
              src={generatedContent.content} 
              controls 
              className="w-full"
            >
              <p className="text-gray-400">Your browser doesn't support audio playback.</p>
            </audio>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Content Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Content Type
        </label>
        <div className="grid grid-cols-4 gap-2">
          {(['text', 'image', 'video', 'audio'] as const).map(type => (
            <button
              key={type}
              onClick={() => handleContentTypeChange(type)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                contentType === type
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Provider Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          AI Provider
        </label>
        <select
          value={selectedProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:ring-2 focus:ring-orange-500"
        >
          {availableProviders.map(provider => (
            <option key={provider.name} value={provider.name.toLowerCase().replace(/\s+.*/, '')}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      {/* Model Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Model
        </label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:ring-2 focus:ring-orange-500"
        >
          {getModelsForProvider(selectedProvider, contentType).map(model => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      {/* Campaign Context */}
      {selectedCampaign && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="text-white font-semibold mb-2">Campaign Context:</h4>
          <p className="text-gray-300 text-sm">{selectedCampaign.title}</p>
          <p className="text-gray-400 text-xs mt-1">{selectedCampaign.description}</p>
        </div>
      )}

      {/* Agent Personality */}
      {agentPersonality && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="text-white font-semibold mb-2">Agent Personality:</h4>
          <p className="text-gray-300 text-sm">{agentPersonality}</p>
        </div>
      )}

      {/* Provider Info */}
      <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-white font-semibold mb-1">Selected Provider: {selectedProvider.toUpperCase()}</h4>
            <p className="text-gray-400 text-xs">
              {selectedProvider === 'mock' && 'Testing mode - generates placeholder content for development'}
              {selectedProvider === 'openai' && 'Real AI generation using OpenAI models (requires API key)'}
              {selectedProvider === 'anthropic' && 'Placeholder - Claude integration coming soon'}
            </p>
          </div>
          <div className={`w-3 h-3 rounded-full ${
            selectedProvider === 'mock' ? 'bg-blue-400' :
            selectedProvider === 'openai' && apiKeys.openai ? 'bg-green-400' :
            'bg-yellow-400'
          }`}></div>
        </div>
      </div>

      {/* Prompt Input */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Content Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Enter your ${contentType} generation prompt...\n\nExample: "Create engaging content about DeFi protocols with a humorous tone"`}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:ring-2 focus:ring-orange-500"
          rows={4}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <button
          onClick={generateContent}
          disabled={isGenerating || !prompt.trim()}
          className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-lg hover:from-orange-700 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {isGenerating ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Generating...</span>
            </div>
          ) : (
            `Generate ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}`
          )}
        </button>
        
        <button
          onClick={() => setShowApiKeyModal(true)}
          className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
        >
          Configure API Keys
        </button>
      </div>

      {/* Generated Content Preview */}
      {renderContentPreview()}

      {/* Generation Metadata */}
      {generatedContent && (
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="text-white font-semibold mb-2">Generation Details:</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Provider:</span>
              <span className="text-white ml-2">{generatedContent.provider}</span>
            </div>
            <div>
              <span className="text-gray-400">Model:</span>
              <span className="text-white ml-2">{generatedContent.model}</span>
            </div>
            {generatedContent.metadata.tokensUsed && (
              <div>
                <span className="text-gray-400">Tokens Used:</span>
                <span className="text-white ml-2">{generatedContent.metadata.tokensUsed}</span>
              </div>
            )}
            {generatedContent.metadata.cost && (
              <div>
                <span className="text-gray-400">Estimated Cost:</span>
                <span className="text-white ml-2">${generatedContent.metadata.cost.toFixed(4)}</span>
              </div>
            )}
            {generatedContent.metadata.duration && (
              <div>
                <span className="text-gray-400">Duration:</span>
                <span className="text-white ml-2">{generatedContent.metadata.duration}s</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Keys Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-white mb-4">Configure API Keys</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={apiKeys.openai}
                  onChange={(e) => setApiKeys(prev => ({
                    ...prev,
                    openai: e.target.value
                  }))}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:ring-2 focus:ring-orange-500"
                  placeholder="sk-..."
                />
                <p className="text-xs text-gray-500 mt-1">Required for OpenAI text, image, and audio generation</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={apiKeys.anthropic}
                  onChange={(e) => setApiKeys(prev => ({
                    ...prev,
                    anthropic: e.target.value
                  }))}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:ring-2 focus:ring-orange-500"
                  placeholder="sk-ant-..."
                  disabled
                />
                <p className="text-xs text-gray-500 mt-1">Coming soon - Claude integration in development</p>
              </div>
            </div>
            <div className="flex space-x-4 mt-6">
              <button
                onClick={saveApiKeys}
                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
              >
                Save Keys
              </button>
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 