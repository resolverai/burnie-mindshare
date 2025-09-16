'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { XMarkIcon, KeyIcon } from '@heroicons/react/24/outline'
import { saveApiKeys, getApiKeys, type ApiKeyConfig } from '../utils/api-keys'
import toast from 'react-hot-toast'

interface NeuralKeysModalProps {
  isOpen: boolean
  onClose: () => void
}

export function NeuralKeysModal({ isOpen, onClose }: NeuralKeysModalProps) {
  const { address } = useAccount()
  const [apiKeys, setApiKeys] = useState<Partial<ApiKeyConfig>>({
    openai: '',
    anthropic: '',
    google: '',
    xai: '',
    replicate: '',
    elevenlabs: '',
    stability: '',
    fal: ''
  })
  const [isLoading, setIsLoading] = useState(false)

  // Load existing keys when modal opens
  useEffect(() => {
    if (isOpen && address) {
      const existingKeys = getApiKeys(address)
      if (existingKeys) {
        setApiKeys({
          openai: existingKeys.openai || '',
          anthropic: existingKeys.anthropic || '',
          google: existingKeys.google || '',
          xai: existingKeys.xai || '',
          replicate: existingKeys.replicate || '',
          elevenlabs: existingKeys.elevenlabs || '',
          stability: existingKeys.stability || '',
          fal: existingKeys.fal || ''
        })
      }
    }
  }, [isOpen, address])

  const handleSave = async () => {
    if (!address) {
      toast.error('Wallet not connected')
      return
    }

    setIsLoading(true)
    try {
      // Only save non-empty keys
      const keysToSave = Object.entries(apiKeys)
        .filter(([_, value]) => value && value.trim() !== '')
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})

      saveApiKeys(address, keysToSave)
      
      toast.success('API Keys saved locally!')
      onClose()
    } catch (error) {
      toast.error('Failed to save API keys')
      console.error('Error saving API keys:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (provider: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <KeyIcon className="h-6 w-6 text-purple-400" />
            <h2 className="text-xl font-bold text-white">Neural Keys</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <h3 className="text-blue-400 font-medium mb-2">🔒 Local Storage Only</h3>
              <p className="text-gray-300 text-sm">
                Your API keys are stored locally in your browser and never sent to our servers. 
                This ensures maximum security and trust.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* OpenAI */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                OpenAI API Key
              </label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeys.openai || ''}
                onChange={(e) => handleInputChange('openai', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Anthropic */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                Anthropic API Key
              </label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={apiKeys.anthropic || ''}
                onChange={(e) => handleInputChange('anthropic', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Google */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                Google AI API Key
              </label>
              <input
                type="password"
                placeholder="AIza..."
                value={apiKeys.google || ''}
                onChange={(e) => handleInputChange('google', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* XAI (Grok) */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                XAI (Grok) API Key
              </label>
              <input
                type="password"
                placeholder="xai-..."
                value={apiKeys.xai || ''}
                onChange={(e) => handleInputChange('xai', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Replicate */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                Replicate API Key
              </label>
              <input
                type="password"
                placeholder="r8_..."
                value={apiKeys.replicate || ''}
                onChange={(e) => handleInputChange('replicate', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* ElevenLabs */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                ElevenLabs API Key
              </label>
              <input
                type="password"
                placeholder="..."
                value={apiKeys.elevenlabs || ''}
                onChange={(e) => handleInputChange('elevenlabs', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Stability AI */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                Stability AI API Key
              </label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeys.stability || ''}
                onChange={(e) => handleInputChange('stability', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Fal.ai */}
            <div>
              <label className="block text-gray-300 font-medium mb-2">
                Fal.ai API Key
              </label>
              <input
                type="password"
                placeholder="fal_..."
                value={apiKeys.fal || ''}
                onChange={(e) => handleInputChange('fal', e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors flex items-center space-x-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Saving...</span>
              </>
            ) : (
              <>
                <KeyIcon className="h-4 w-4" />
                <span>Save Keys</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
} 