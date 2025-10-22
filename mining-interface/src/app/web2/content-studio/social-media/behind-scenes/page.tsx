'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon, CameraIcon } from '@heroicons/react/24/outline'
import PlatformSelector from '@/components/web2/PlatformSelector'
import ProgressOverlay from '@/components/web2/ProgressOverlay'
import PlatformText from '@/components/web2/PlatformText'
import Image from 'next/image'

export default function BehindScenesPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  
  const [contentType, setContentType] = useState('team')
  const [theme, setTheme] = useState('')
  const [mood, setMood] = useState('authentic')
  const [numVariations, setNumVariations] = useState(1)
  const [includeLogo, setIncludeLogo] = useState(true)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  
  const [expandedSections, setExpandedSections] = useState({ basic: true, advanced: false, options: false })
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  
  // New state for unified generation
  const [generationState, setGenerationState] = useState<'idle' | 'generating' | 'complete'>('idle')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [selectedPlatform, setSelectedPlatform] = useState<'twitter' | 'youtube' | 'instagram' | 'linkedin'>('twitter')
  const [platformTexts, setPlatformTexts] = useState<any>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const toggleSection = (section: 'basic' | 'advanced' | 'options') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const handleGenerate = async () => {
    if (!theme.trim()) {
      alert('Please enter a theme or description')
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

      const promptRequest = {
        account_id: parseInt(accountId),
        content_type: 'image',
        workflow_type: 'behind_scenes',
        target_platform: 'instagram',
        theme: 'Behind-the-scenes: ' + contentType + ' - ' + theme,
        user_prompt: 'Create authentic behind-the-scenes content showing ' + contentType + '. Theme: ' + theme + '. Mood: ' + mood + '. ' + additionalInstructions,
        num_prompts: numVariations,
        enable_live_search: false
      }

      const promptResponse = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-prompts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + web2Auth },
          body: JSON.stringify(promptRequest)
        }
      )

      if (!promptResponse.ok) throw new Error('Failed to generate prompts')
      const promptData = await promptResponse.json()

      const imageGenerationPromises = []
      for (let i = 1; i <= numVariations; i++) {
        const promptKey = 'image_prompt_' + i
        const imagePrompt = promptData[promptKey] || promptData.image_prompt_1

        imageGenerationPromises.push(
          fetch(
            (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-image',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + web2Auth },
              body: JSON.stringify({ account_id: parseInt(accountId), prompt: imagePrompt, include_logo: includeLogo, num_images: 1 })
            }
          )
        )
      }

      const imageResponses = await Promise.all(imageGenerationPromises)
      const imageUrls: string[] = []

      for (const response of imageResponses) {
        if (response.ok) {
          const data = await response.json()
          if (data.content_urls && data.content_urls.length > 0) imageUrls.push(data.content_urls[0])
        }
      }

      setGeneratedImages(imageUrls)
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <div className="flex items-center space-x-4">
            <button onClick={() => router.push('/web2/content-studio/social-media')} className="text-gray-400 hover:text-white transition-colors">← Back</button>
            <CameraIcon className="w-6 h-6 text-purple-500" />
            <h1 className="text-xl font-semibold text-white">Behind-the-Scenes Content</h1>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-800">
            <div className="max-w-2xl">
              <div className="mb-4">
                <button onClick={() => toggleSection('basic')} className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
                  <span className="font-semibold text-white">Basic Settings</span>
                  {expandedSections.basic ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                </button>
                
                {expandedSections.basic && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Content Type</label>
                      <select value={contentType} onChange={(e) => setContentType(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="team">Team & Culture</option>
                        <option value="process">Work Process</option>
                        <option value="workspace">Workspace/Office</option>
                        <option value="creation">Product Creation</option>
                        <option value="daily">Daily Operations</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Theme / Description *</label>
                      <textarea
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        placeholder="e.g., Morning team standup, Creating our latest product, Office tour..."
                        rows={3}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Mood & Feeling</label>
                      <select value={mood} onChange={(e) => setMood(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="authentic">Authentic & Real</option>
                        <option value="energetic">Energetic & Fun</option>
                        <option value="focused">Focused & Productive</option>
                        <option value="casual">Casual & Relaxed</option>
                        <option value="inspiring">Inspiring</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <button onClick={() => toggleSection('advanced')} className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
                  <span className="font-semibold text-white">Advanced Settings</span>
                  {expandedSections.advanced ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                </button>
                
                {expandedSections.advanced && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Additional Instructions</label>
                      <textarea
                        value={additionalInstructions}
                        onChange={(e) => setAdditionalInstructions(e.target.value)}
                        placeholder="Add specific details about what to show..."
                        rows={4}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-6">
                <button onClick={() => toggleSection('options')} className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
                  <span className="font-semibold text-white">Generation Options</span>
                  {expandedSections.options ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                </button>
                
                {expandedSections.options && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Number of Variations ({numVariations})</label>
                      <input type="range" min="1" max="5" value={numVariations} onChange={(e) => setNumVariations(parseInt(e.target.value))} className="w-full" />
                      <div className="flex justify-between text-xs text-gray-500 mt-1"><span>1</span><span>5</span></div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <input type="checkbox" id="includeLogo" checked={includeLogo} onChange={(e) => setIncludeLogo(e.target.checked)} className="w-4 h-4 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-purple-500" />
                      <label htmlFor="includeLogo" className="text-sm text-gray-300">Include account logo</label>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerating || !theme.trim()}
                className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5" />
                    <span>Generate Behind-the-Scenes</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel - Output Preview (50%) */}
          <div className="w-1/2 flex flex-col">
            {/* Platform Selector - Top */}
            <PlatformSelector
              platforms={['twitter', 'youtube', 'instagram', 'linkedin']}
              selected={selectedPlatform}
              onChange={(platform) => setSelectedPlatform(platform as any)}
              disabled={generationState !== 'complete'}
            />
            
            {/* Content Area - Middle */}
            <div className="flex-1 p-6 overflow-hidden flex flex-col">
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 flex-1 flex items-center justify-center relative">
                {generationState === 'generating' ? (
                  <ProgressOverlay
                    message={progressMessage}
                    percent={progressPercent}
                  />
                ) : generationState === 'complete' && generatedImages.length > 0 ? (
                  <div className="relative w-full h-full p-4">
                    {/* Image navigation if multiple */}
                    {generatedImages.length > 1 && (
                      <div className="absolute top-4 left-0 right-0 flex items-center justify-center space-x-2 z-10">
                        <button
                          onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))}
                          disabled={currentImageIndex === 0}
                          className="px-3 py-1 bg-gray-900/80 text-white rounded-lg disabled:opacity-50"
                        >
                          ←
                        </button>
                        <span className="px-3 py-1 bg-gray-900/80 text-white rounded-lg text-sm">
                          {currentImageIndex + 1} of {generatedImages.length}
                        </span>
                        <button
                          onClick={() => setCurrentImageIndex(Math.min(generatedImages.length - 1, currentImageIndex + 1))}
                          disabled={currentImageIndex === generatedImages.length - 1}
                          className="px-3 py-1 bg-gray-900/80 text-white rounded-lg disabled:opacity-50"
                        >
                          →
                        </button>
                      </div>
                    )}
                    
                    {/* Current image */}
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="relative max-w-full max-h-full">
                        <Image
                          src={generatedImages[currentImageIndex]}
                          alt={'Generated image ' + (currentImageIndex + 1)}
                          width={800}
                          height={800}
                          className="object-contain rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="text-6xl opacity-20">📸</div>
                    <p className="text-gray-400">Your generated content will appear here</p>
                    <p className="text-sm text-gray-500">Fill the form and click Generate</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Platform Text - Bottom */}
            {generationState === 'complete' && platformTexts[selectedPlatform] && (
              <PlatformText
                text={platformTexts[selectedPlatform]}
                platform={selectedPlatform}
                onCopy={() => console.log('Text copied')}
                onPost={() => console.log('Posting to ' + selectedPlatform)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

