'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  XMarkIcon,
  CpuChipIcon,
  SparklesIcon,
  AcademicCapIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'
import { ContentTypeModelPreferences, hasRequiredApiKeys, getApiKey, validateAgentApiKeys } from '../utils/api-keys'

const PERSONALITIES = [
  { value: 'WITTY', label: '🧠 Witty', description: 'Clever and sharp' },
  { value: 'SAVAGE', label: '🔥 Savage', description: 'Brutal and cutting' },
  { value: 'CHAOTIC', label: '🌪️ Chaotic', description: 'Unpredictable and wild' },
  { value: 'LEGENDARY', label: '👑 Legendary', description: 'Wise and authoritative' }
]

const PROVIDER_OPTIONS = [
  {
    name: 'OpenAI',
    value: 'openai',
    description: 'Latest GPT models with multimodal capabilities and reasoning',
    textModels: [
      'gpt-4o',           // Latest multimodal model
      'gpt-4o-mini',      // Efficient multimodal model  
      'gpt-4-turbo',      // Previous generation
      'gpt-3.5-turbo',    // Fast and efficient
      'o1-preview',       // Reasoning model
      'o1-mini'           // Smaller reasoning model
    ],
    imageModels: [
      'gpt-image-1',      // Latest dedicated image generation model (April 2025)
      'gpt-4o',           // Direct image generation via responses API
      'gpt-4o-mini',      // Direct image generation via responses API
      'dall-e-3',         // Previous generation dedicated image model
      'dall-e-2'          // Legacy image model
    ],
    audioModels: [
      'tts-1-hd',         // High quality text-to-speech
      'tts-1',            // Standard text-to-speech
      'whisper-1'         // Speech-to-text
    ],
    videoModels: [
      'sora'              // Video generation model (limited preview)
    ]
  },
  {
    name: 'Anthropic',
    value: 'anthropic',
    description: 'Claude models with advanced reasoning and safety features',
    textModels: [
      'claude-4-opus',       // Most capable model
      'claude-4-sonnet',     // Balanced performance  
      'claude-3.7-sonnet',   // Extended thinking capabilities
      'claude-3.5-sonnet',   // Fast and efficient
      'claude-3-haiku'       // Fastest model
    ],
    imageModels: [],
    audioModels: [],
    videoModels: []
  },
  {
    name: 'Google',
    value: 'google',
    description: 'Gemini models with multimodal understanding and generation',
    textModels: [
      'gemini-2.0-flash-exp', // Latest experimental model
      'gemini-1.5-pro',       // High capability model
      'gemini-1.5-flash',     // Fast and efficient
      'gemini-pro'            // General purpose model
    ],
    imageModels: [
      'gemini-2.0-flash-exp', // Supports image generation
      'imagen-2',             // Dedicated image model
      'imagen-3'              // Latest image model
    ],
    audioModels: [
      'gemini-audio'          // Audio processing capabilities
    ],
    videoModels: [
      'veo-3-large',          // High-fidelity video generation
      'lumiere'               // Video generation model
    ]
  },
  {
    name: 'XAI (Grok)',
    value: 'xai',
    description: 'Grok models with advanced reasoning and multimodal capabilities',
    textModels: [
      'grok-4-latest',       // Latest Grok model
      'grok-4-0709',         // Specific version
      'grok-3',              // Previous generation
      'grok-3-mini'          // Smaller, faster model
    ],
    imageModels: [
      'grok-2-image-1212'    // Image generation model
    ],
    audioModels: [],
    videoModels: []
  },
  { 
    name: 'Replicate', 
    value: 'replicate',
    description: 'Open-source models hosted on Replicate platform',
    textModels: [
      'meta/llama-2-70b-chat',           // Meta's LLaMA 2 Large
      'meta/llama-2-13b-chat',           // Meta's LLaMA 2 Medium
      'meta/llama-2-7b-chat',            // Meta's LLaMA 2 Small
      'mistralai/mixtral-8x7b-instruct', // Mixtral expert model
      'meta/codellama-70b-instruct',     // Code generation specialist
      'togethercomputer/falcon-40b'      // Falcon large model
    ],
    imageModels: [
      'stability-ai/flux-schnell',       // Fast image generation
      'stability-ai/sdxl',               // Stable Diffusion XL
      'stability-ai/stable-diffusion-xl-base-1.0',
      'midjourney/midjourney',           // Midjourney-style generation
      'runwayml/stable-diffusion-v1-5'
    ],
    audioModels: [
      'suno-ai/bark',                    // Text-to-speech with emotions
      'facebook/musicgen-large'          // Music generation
    ],
    videoModels: [
      'runway-ml/gen-2',                 // Runway ML video generation
      'stability-ai/stable-video-diffusion',
      'animate-diff/animate-diff'        // Animation from images
    ]
  },
  { 
    name: 'Stability AI', 
    value: 'stability',
    description: 'Stable Diffusion and video generation models',
    textModels: [],
    imageModels: [
      'stable-diffusion-xl-1024-v1-0',   // SDXL latest
      'stable-diffusion-v1-6',           // SD 1.6
      'stable-diffusion-v2-1',           // SD 2.1
      'stable-diffusion-xl-base-1.0',    // SDXL base
      'stable-diffusion-3-medium'        // SD 3 medium
    ],
    audioModels: [
      'stable-audio'                     // Audio generation
    ],
    videoModels: [
      'stable-video-diffusion-xt',       // Extended video model
      'stable-video-diffusion-img2vid'   // Image to video
    ]
  },
  { 
    name: 'ElevenLabs', 
    value: 'elevenlabs',
    description: 'High-quality voice synthesis and cloning',
    textModels: [],
    imageModels: [],
    audioModels: [
      'eleven_multilingual_v2',          // Multilingual voice model
      'eleven_turbo_v2',                 // Fast voice synthesis
      'eleven_monolingual_v1',           // English-only high quality
      'eleven_multilingual_v1'           // Original multilingual
    ],
    videoModels: []
  },
  {
    name: 'Cohere',
    value: 'cohere',
    description: 'Enterprise-focused language models with strong reasoning',
    textModels: [
      'command-r-plus',                  // Flagship model
      'command-r',                       // Balanced performance
      'command-light',                   // Fast and efficient
      'command-nightly'                  // Latest experimental
    ],
    imageModels: [],
    audioModels: [],
    videoModels: []
  },
  {
    name: 'Perplexity',
    value: 'perplexity',
    description: 'Search-augmented language models with real-time information',
    textModels: [
      'llama-3.1-sonar-huge-128k-online',    // Large online model
      'llama-3.1-sonar-large-128k-online',   // Large online model
      'llama-3.1-sonar-small-128k-online',   // Small online model
      'llama-3.1-70b-instruct',              // Offline instruction model
      'mixtral-8x7b-instruct'                // Offline Mixtral model
    ],
    imageModels: [],
    audioModels: [],
    videoModels: []
  },
  {
    name: 'Fal.ai',
    value: 'fal',
    description: 'Comprehensive text-to-image models platform with 100+ models',
    textModels: [],
    imageModels: [
      // Imagen Models
      'imagen4-preview',
      'imagen4-preview-fast',
      'imagen4-preview-ultra',
      'imagen3',
      'imagen3-fast',
      
      // FLUX Models
      'flux-pro-v1.1',
      'flux-pro-v1.1-ultra',
      'flux-pro-v1.1-ultra-finetuned',
      'flux-pro-new',
      'flux-pro-kontext',
      'flux-pro-kontext-max',
      'flux-general',
      'flux-dev',
      'flux-1-dev',
      'flux-1-schnell',
      'flux-schnell',
      'flux-1-krea',
      'flux-krea',
      'flux-lora',
      'flux-lora-stream',
      'flux-lora-inpainting',
      'flux-krea-lora',
      'flux-krea-lora-stream',
      'flux-subject',
      'flux-kontext-lora',
      'flux-control-lora-canny',
      'flux-control-lora-depth',
      
      // Recraft Models
      'recraft-v3',
      'recraft-v2',
      
      // Bria Models
      'bria-text-to-image-3.2',
      'bria-text-to-image-base',
      'bria-text-to-image-fast',
      'bria-text-to-image-hd',
      
      // HiDream Models
      'hidream-i1-full',
      'hidream-i1-dev',
      'hidream-i1-fast',
      
      // Ideogram Models
      'ideogram-v2',
      'ideogram-v2-turbo',
      'ideogram-v2a',
      'ideogram-v2a-turbo',
      'ideogram-v3',
      'ideogram-character-edit',
      'ideogram-character-remix',
      
      // Stable Diffusion Models
      'stable-diffusion-v35-large',
      'stable-diffusion-v35-medium',
      'stable-diffusion-v3-medium',
      'stable-diffusion-v15',
      'stable-cascade',
      'stable-cascade-sote-diffusion',
      
      // Bytedance Models
      'dreamina-v3.1',
      'seedream-3.0',
      
      // Wan Models
      'wan-v2.2-a14b',
      'wan-v2.2-a14b-lora',
      'wan-v2.2-5b',
      
      // Other Popular Models
      'qwen-image',
      'omnigen-v1',
      'omnigen-v2',
      'sky-raccoon',
      'bagel',
      'dreamo',
      'flowedit',
      'cogview4',
      
      // Minimax Models
      'minimax-image-01',
      
      // F-Lite Models
      'f-lite-standard',
      'f-lite-texture',
      
      // GPT Models
      'gpt-image-1',
      
      // Sana Models
      'sana',
      'sana-v1.5-1.6b',
      'sana-v1.5-4.8b',
      'sana-sprint',
      
      // RunDiffusion Models
      'rundiffusion-juggernaut-flux-lightning',
      'rundiffusion-photo-flux',
      'rundiffusion-juggernaut-flux-lora',
      'rundiffusion-juggernaut-flux-pro',
      'rundiffusion-juggernaut-flux-base',
      
      // Switti Models
      'switti',
      'switti-512',
      
      // Lumina Models
      'lumina-image-v2',
      
      // Luma Models
      'luma-photon',
      'luma-photon-flash',
      
      // Aura Flow
      'aura-flow',
      
      // Fast SDXL Models
      'fast-sdxl',
      'fast-sdxl-controlnet-canny',
      'fast-lightning-sdxl',
      'fast-lcm-diffusion',
      'fast-fooocus-sdxl',
      'fast-fooocus-sdxl-image-to-image',
      
      // Fooocus Models
      'fooocus',
      'fooocus-upscale-or-vary',
      'fooocus-image-prompt',
      
      // Hyper SDXL
      'hyper-sdxl',
      
      // Illusion Diffusion
      'illusion-diffusion',
      
      // LCM Models
      'lcm',
      
      // Lightning Models
      'lightning-models',
      
      // Playground Models
      'playground-v25',
      
      // Realistic Vision
      'realistic-vision',
      
      // Dreamshaper
      'dreamshaper',
      
      // SDXL ControlNet Union
      'sdxl-controlnet-union',
      
      // Kolors
      'kolors',
      
      // Pixart Sigma
      'pixart-sigma',
      
      // LoRA
      'lora',
      
      // Easel Avatar
      'easel-avatar',
      
      // Nano Banana Models
      'fal-ai/nano-banana',
      'fal-ai/nano-banana/edit'
    ],
    audioModels: [],
    videoModels: []
  }
]

interface CreateAgentModalProps {
  onClose: () => void
  onAgentCreated: (agent: any) => void
  editingAgent?: any // The agent being edited, null for create mode
}

export function CreateAgentModal({ onClose, onAgentCreated, editingAgent }: CreateAgentModalProps) {
  // Debug log to check if editingAgent is being passed correctly
  console.log('CreateAgentModal - editingAgent:', editingAgent)
  console.log('CreateAgentModal - isEditing:', !!editingAgent)
  
  const [formData, setFormData] = useState({
    name: editingAgent?.name || '',
    personality: editingAgent?.personality || '',
    systemPrompt: editingAgent?.system_message || '',
    temperature: editingAgent?.config?.temperature || 0.8,
    maxTokens: editingAgent?.config?.maxTokens || 150,
  })
  
  // Update form data when editingAgent changes
  useEffect(() => {
    if (editingAgent) {
      console.log('useEffect - updating form data with editingAgent:', editingAgent)
      setFormData({
        name: editingAgent.name || '',
        personality: editingAgent.personality || '',
        systemPrompt: editingAgent.system_message || '',
        temperature: editingAgent.config?.temperature || 0.8,
        maxTokens: editingAgent.config?.maxTokens || 150,
      })
      setModelPreferences({
        text: editingAgent.config?.modelPreferences?.text || { provider: 'xai', model: 'grok-4-latest' },
        image: editingAgent.config?.modelPreferences?.image || { provider: 'fal', model: 'fal-ai/nano-banana/edit' },
        video: editingAgent.config?.modelPreferences?.video || { provider: 'openai', model: 'sora' },
        audio: editingAgent.config?.modelPreferences?.audio || { provider: 'elevenlabs', model: 'eleven_multilingual_v2' }
      })
    }
  }, [editingAgent])

  const [modelPreferences, setModelPreferences] = useState<ContentTypeModelPreferences>({
    text: editingAgent?.config?.modelPreferences?.text || { provider: 'xai', model: 'grok-4-latest' },
    image: editingAgent?.config?.modelPreferences?.image || { provider: 'fal', model: 'fal-ai/nano-banana/edit' },
    video: editingAgent?.config?.modelPreferences?.video || { provider: 'openai', model: 'sora' },
    audio: editingAgent?.config?.modelPreferences?.audio || { provider: 'elevenlabs', model: 'eleven_multilingual_v2' }
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const { address } = useAccount()
  const queryClient = useQueryClient()

  const getModelsForProvider = (providerValue: string, contentType: keyof ContentTypeModelPreferences) => {
    const provider = PROVIDER_OPTIONS.find(p => p.value === providerValue)
    if (!provider) return []
    
    switch (contentType) {
      case 'text': return provider.textModels
      case 'image': return provider.imageModels
      case 'video': return provider.videoModels
      case 'audio': return provider.audioModels
      default: return []
    }
  }

  const hasApiKey = (provider: string) => {
    if (!address) return false
    return !!getApiKey(address, provider)
  }

  const handleModelPreferenceChange = (
    contentType: keyof ContentTypeModelPreferences, 
    field: 'provider' | 'model', 
    value: string
  ) => {
    setModelPreferences(prev => {
      const newPrefs = { ...prev }
      
      if (field === 'provider') {
        // When provider changes, reset model to first available
        const models = getModelsForProvider(value, contentType)
        newPrefs[contentType] = {
          provider: value,
          model: models[0] || ''
        }
      } else {
        newPrefs[contentType] = {
          ...prev[contentType],
          [field]: value
        }
      }
      
      // Clear API key errors when user changes preferences
      if (errors.apiKeys) {
        setErrors(prev => ({ ...prev, apiKeys: '' }))
      }
      
      return newPrefs
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!address) {
      setErrors({ general: 'Please connect your wallet first' })
      return
    }
    
    // Validation
    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = 'Agent name is required'
    if (!formData.personality) newErrors.personality = 'Personality is required'

    // API Key validation using helper function
    const validation = validateAgentApiKeys(address, modelPreferences)
    if (!validation.isValid) {
      newErrors.apiKeys = `Missing API keys for: ${validation.missingKeys.join(', ')}. Please configure them in Neural Keys.`
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setIsSubmitting(true)
    setErrors({})

    try {
    // Generate system prompt based on personality
    const personalityConfig = PERSONALITIES.find(p => p.value === formData.personality)
    const defaultSystemPrompt = formData.systemPrompt || 
        `You are a ${personalityConfig?.label} AI agent for generating content. ${personalityConfig?.description}. Generate creative content that matches this personality while staying within appropriate bounds.`

      // Call backend API with config (model preferences stored in agent config)
      const isEditing = !!editingAgent
      const url = isEditing 
        ? `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/${editingAgent.id}/update`
        : `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/create`
      
      const requestBody = isEditing ? {
        name: formData.name,
        personality: formData.personality,
        systemPrompt: defaultSystemPrompt,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        modelPreferences: modelPreferences
      } : {
        name: formData.name,
        personality: formData.personality,
        systemPrompt: defaultSystemPrompt,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        modelPreferences: modelPreferences,
        walletAddress: address
      }
      
      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create agent')
      }

      const result = await response.json()
      
      // Refresh agents data
      queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
      
      // Call success callback
      onAgentCreated(result.data)
      
      // Close modal
      onClose()
      
    } catch (error: any) {
      console.error('Error creating agent:', error)
      setErrors({ 
        general: error.message || 'Failed to create agent. Please try again.' 
      })
    } finally {
      setIsSubmitting(false)
    }
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
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h3 className="text-xl font-bold text-white">
            🤖 {editingAgent ? 'Edit Personalized Agent' : 'Create Personalized Agent'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Information Banner */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AcademicCapIcon className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-blue-400 font-medium mb-1">Mindshare Intelligence Training</h4>
                <p className="text-blue-300 text-sm">
                  Your agent will learn from your social media patterns and apply proprietary mindshare algorithms 
                  to create content that dominates attention economy platforms like cookie.fun and Kaito yaps.
                </p>
              </div>
            </div>
          </div>

          {/* Basic Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                placeholder="e.g., ContentCreator_Pro"
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
          </div>

          {/* Model Preferences by Content Type */}
          <div>
            <h4 className="text-lg font-semibold text-white mb-4">Content Generation Preferences</h4>
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mb-4">
              <p className="text-orange-400 text-sm">
                💡 <strong>Important:</strong> Configure your API keys using the "Neural Keys" button in the header 
                before creating your agent. Choose the best AI models for each content type below.
                <br />
                <span className="text-orange-300">✅ = API key configured | ❌ = API key missing</span>
              </p>
            </div>
            
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Text Content */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h5 className="text-white font-medium mb-3">📝 Text Content</h5>
                <div className="space-y-3">
            <div>
                    <label className="block text-sm text-gray-300 mb-1">Provider</label>
              <select
                      value={modelPreferences.text.provider}
                      onChange={(e) => handleModelPreferenceChange('text', 'provider', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {PROVIDER_OPTIONS.filter(p => p.value === 'xai' && p.textModels.length > 0).map(provider => (
                        <option key={provider.value} value={provider.value}>
                    {provider.name} {hasApiKey(provider.value) ? '✅' : '❌'}
                  </option>
                ))}
              </select>
                    {/* Provider Description */}
                    {PROVIDER_OPTIONS.find(p => p.value === modelPreferences.text.provider)?.description && (
                      <p className="text-xs text-gray-400 mt-1">
                        {PROVIDER_OPTIONS.find(p => p.value === modelPreferences.text.provider)?.description}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Model</label>
                    <select
                      value={modelPreferences.text.model}
                      onChange={(e) => handleModelPreferenceChange('text', 'model', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {getModelsForProvider(modelPreferences.text.provider, 'text').map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
            </div>

              {/* Image Content */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h5 className="text-white font-medium mb-3">🎨 Image Content</h5>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Provider</label>
                    <select
                      value={modelPreferences.image.provider}
                      onChange={(e) => handleModelPreferenceChange('image', 'provider', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {PROVIDER_OPTIONS.filter(p => p.value === 'fal' && p.imageModels.length > 0).map(provider => (
                        <option key={provider.value} value={provider.value}>
                          {provider.name} {hasApiKey(provider.value) ? '✅' : '❌'}
                        </option>
                      ))}
                    </select>
                  </div>
            <div>
                    <label className="block text-sm text-gray-300 mb-1">Model</label>
              <select
                      value={modelPreferences.image.model}
                      onChange={(e) => handleModelPreferenceChange('image', 'model', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {getModelsForProvider(modelPreferences.image.provider, 'image').map(model => (
                        <option key={model} value={model}>
                          {model}
                  </option>
                ))}
              </select>
                  </div>
            </div>
          </div>

              {/* Video Content (Optional) */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h5 className="text-white font-medium mb-3">🎥 Video Content <span className="text-gray-400 text-sm">(Optional)</span></h5>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Provider</label>
                    <select
                      value={modelPreferences.video.provider}
                      onChange={(e) => handleModelPreferenceChange('video', 'provider', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {PROVIDER_OPTIONS.filter(p => p.value === 'openai' && p.videoModels.length > 0).map(provider => (
                        <option key={provider.value} value={provider.value}>
                          {provider.name} {hasApiKey(provider.value) ? '✅' : '❌'}
                        </option>
                      ))}
                    </select>
                  </div>
          <div>
                    <label className="block text-sm text-gray-300 mb-1">Model</label>
                    <select
                      value={modelPreferences.video.model}
                      onChange={(e) => handleModelPreferenceChange('video', 'model', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {getModelsForProvider(modelPreferences.video.provider, 'video').map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
          </div>

              {/* Audio Content (Optional) */}
              <div className="bg-gray-700/30 rounded-lg p-4">
                <h5 className="text-white font-medium mb-3">🎵 Audio Content <span className="text-gray-400 text-sm">(Optional)</span></h5>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Provider</label>
                    <select
                      value={modelPreferences.audio.provider}
                      onChange={(e) => handleModelPreferenceChange('audio', 'provider', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {PROVIDER_OPTIONS.filter(p => p.value === 'elevenlabs' && p.audioModels.length > 0).map(provider => (
                        <option key={provider.value} value={provider.value}>
                          {provider.name} {hasApiKey(provider.value) ? '✅' : '❌'}
                        </option>
                      ))}
                    </select>
                  </div>
          <div>
                    <label className="block text-sm text-gray-300 mb-1">Model</label>
                    <select
                      value={modelPreferences.audio.model}
                      onChange={(e) => handleModelPreferenceChange('audio', 'model', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {getModelsForProvider(modelPreferences.audio.provider, 'audio').map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="temperature" className="block text-sm font-medium text-gray-300 mb-2">
                Creativity: {formData.temperature}
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
              <p className="text-xs text-gray-400 mt-1">Higher = more creative, Lower = more focused</p>
            </div>

            <div>
              <label htmlFor="maxTokens" className="block text-sm font-medium text-gray-300 mb-2">
                Max Response Length
              </label>
              <input
                type="number"
                id="maxTokens"
                name="maxTokens"
                value={formData.maxTokens}
                onChange={handleChange}
                min="50"
                max="1000"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Custom System Prompt */}
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

          {/* Error Display */}
          {errors.general && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400 text-sm">{errors.general}</p>
            </div>
          )}
          
          {errors.apiKeys && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400 text-sm">{errors.apiKeys}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2 text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-gradient-to-r from-orange-600 to-red-600 text-white rounded-md hover:from-orange-700 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg flex items-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  <span>{editingAgent ? 'Updating & Re-training...' : 'Creating & Training...'}</span>
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4" />
                  <span>{editingAgent ? 'Update Personalized Agent' : 'Create Personalized Agent'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
} 