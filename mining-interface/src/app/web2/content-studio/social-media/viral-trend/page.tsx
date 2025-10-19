'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon, FireIcon } from '@heroicons/react/24/outline'

export default function ViralTrendPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  
  // Form state
  const [trendTopic, setTrendTopic] = useState('')
  const [platform, setPlatform] = useState('twitter')
  const [contentGoal, setContentGoal] = useState('engagement')
  const [toneStyle, setToneStyle] = useState('casual')
  const [numVariations, setNumVariations] = useState(1)
  const [includeLogo, setIncludeLogo] = useState(true)
  const [additionalContext, setAdditionalContext] = useState('')
  
  // UI state
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    advanced: false,
    options: false
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])

  const toggleSection = (section: 'basic' | 'advanced' | 'options') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const handleGenerate = async () => {
    // Validation
    if (!trendTopic.trim()) {
      alert('Please enter a trend topic or hashtag')
      return
    }

    setIsGenerating(true)
    setGeneratedImages([])

    try {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const accountId = localStorage.getItem('burnie_web2_account_id')

      if (!web2Auth || !accountId) {
        alert('Authentication required')
        router.push('/web2/auth')
        return
      }

      // Step 1: Generate prompts using Grok
      const promptRequest = {
        account_id: parseInt(accountId),
        content_type: 'image',
        workflow_type: 'viral_trend',
        target_platform: platform,
        theme: 'Viral trend: ' + trendTopic,
        user_prompt: 'Create engaging social media content about ' + trendTopic + '. Goal: ' + contentGoal + '. Tone: ' + toneStyle + '. ' + additionalContext,
        num_prompts: numVariations,
        enable_live_search: true
      }

      const promptResponse = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-prompts',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + web2Auth
          },
          body: JSON.stringify(promptRequest)
        }
      )

      if (!promptResponse.ok) {
        throw new Error('Failed to generate prompts')
      }

      const promptData = await promptResponse.json()

      // Step 2: Generate images for each prompt
      const imageGenerationPromises = []
      for (let i = 1; i <= numVariations; i++) {
        const promptKey = 'image_prompt_' + i
        const imagePrompt = promptData[promptKey] || promptData.image_prompt_1

        const imageRequest = {
          account_id: parseInt(accountId),
          prompt: imagePrompt,
          include_logo: includeLogo,
          num_images: 1
        }

        imageGenerationPromises.push(
          fetch(
            (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-image',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + web2Auth
              },
              body: JSON.stringify(imageRequest)
            }
          )
        )
      }

      const imageResponses = await Promise.all(imageGenerationPromises)
      const imageUrls: string[] = []

      for (const response of imageResponses) {
        if (response.ok) {
          const data = await response.json()
          if (data.content_urls && data.content_urls.length > 0) {
            imageUrls.push(data.content_urls[0])
          }
        }
      }

      setGeneratedImages(imageUrls)
    } catch (error) {
      console.error('Error generating content:', error)
      alert('Error generating content: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/web2/content-studio/social-media')}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
            <FireIcon className="w-6 h-6 text-orange-500" />
            <h1 className="text-xl font-semibold text-white">Viral Trend Content</h1>
          </div>
        </header>

        {/* Main Content - 50-50 Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Form (50%) */}
          <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-800">
            <div className="max-w-2xl">
              {/* Basic Settings */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('basic')}
                  className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
                >
                  <span className="font-semibold text-white">Basic Settings</span>
                  {expandedSections.basic ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                
                {expandedSections.basic && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    {/* Trend Topic */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Trend Topic / Hashtag *
                      </label>
                      <input
                        type="text"
                        value={trendTopic}
                        onChange={(e) => setTrendTopic(e.target.value)}
                        placeholder="e.g., #AI2025, Viral Challenge, Breaking News..."
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">Enter the trending topic or hashtag you want to create content about</p>
                    </div>

                    {/* Platform */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Target Platform
                      </label>
                      <select
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value)}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="twitter">Twitter/X</option>
                        <option value="instagram">Instagram</option>
                        <option value="linkedin">LinkedIn</option>
                        <option value="facebook">Facebook</option>
                        <option value="tiktok">TikTok</option>
                      </select>
                    </div>

                    {/* Content Goal */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Content Goal
                      </label>
                      <select
                        value={contentGoal}
                        onChange={(e) => setContentGoal(e.target.value)}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="engagement">Maximize Engagement</option>
                        <option value="awareness">Brand Awareness</option>
                        <option value="traffic">Drive Traffic</option>
                        <option value="viral">Go Viral</option>
                        <option value="conversation">Start Conversation</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced Settings */}
              <div className="mb-4">
                <button
                  onClick={() => toggleSection('advanced')}
                  className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
                >
                  <span className="font-semibold text-white">Advanced Settings</span>
                  {expandedSections.advanced ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                
                {expandedSections.advanced && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    {/* Tone & Style */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Tone & Style
                      </label>
                      <select
                        value={toneStyle}
                        onChange={(e) => setToneStyle(e.target.value)}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="casual">Casual & Fun</option>
                        <option value="professional">Professional</option>
                        <option value="humorous">Humorous</option>
                        <option value="inspirational">Inspirational</option>
                        <option value="bold">Bold & Edgy</option>
                      </select>
                    </div>

                    {/* Additional Context */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Additional Context
                      </label>
                      <textarea
                        value={additionalContext}
                        onChange={(e) => setAdditionalContext(e.target.value)}
                        placeholder="Add any specific requirements, brand messaging, or creative direction..."
                        rows={4}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Generation Options */}
              <div className="mb-6">
                <button
                  onClick={() => toggleSection('options')}
                  className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
                >
                  <span className="font-semibold text-white">Generation Options</span>
                  {expandedSections.options ? (
                    <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                
                {expandedSections.options && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    {/* Number of Variations */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Number of Variations ({numVariations})
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="5"
                        value={numVariations}
                        onChange={(e) => setNumVariations(parseInt(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>1</span>
                        <span>5</span>
                      </div>
                    </div>

                    {/* Include Logo */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="includeLogo"
                        checked={includeLogo}
                        onChange={(e) => setIncludeLogo(e.target.checked)}
                        className="w-4 h-4 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-orange-500"
                      />
                      <label htmlFor="includeLogo" className="text-sm text-gray-300">
                        Include account logo in generated images
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !trendTopic.trim()}
                className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Generating Content...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5" />
                    <span>Generate Viral Content</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel - Output Preview (50%) */}
          <div className="w-1/2 flex items-center justify-center p-6 bg-gray-900/50">
            <div className="w-full max-w-2xl">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-400 text-lg">Generating your viral content...</p>
                  <p className="text-gray-500 text-sm">This may take a moment</p>
                </div>
              ) : generatedImages.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white mb-4">Generated Content</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {generatedImages.map((url, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={url}
                          alt={'Generated variation ' + (idx + 1)}
                          className="w-full rounded-lg border border-gray-700 group-hover:border-orange-500 transition-colors"
                        />
                        <div className="absolute top-2 right-2 bg-gray-900/80 px-2 py-1 rounded text-xs text-white">
                          Variation {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-4 py-12">
                  <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
                    <FireIcon className="w-12 h-12 text-gray-600" />
                  </div>
                  <p className="text-gray-400 text-lg">No content generated yet</p>
                  <p className="text-gray-500 text-sm max-w-md">
                    Fill in the form and click "Generate Viral Content" to create engaging social media content
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

