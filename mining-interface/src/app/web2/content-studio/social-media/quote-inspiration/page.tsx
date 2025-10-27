'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import PlatformSelector from '@/components/web2/PlatformSelector'
import ProgressOverlay from '@/components/web2/ProgressOverlay'
import PlatformText from '@/components/web2/PlatformText'
import Image from 'next/image'

export default function QuoteInspirationPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  
  const [quoteText, setQuoteText] = useState('')
  const [quoteType, setQuoteType] = useState('motivational')
  const [designStyle, setDesignStyle] = useState('modern')
  const [colorScheme, setColorScheme] = useState('brand')
  const [typography, setTypography] = useState('bold')
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
    if (!quoteText.trim()) {
      alert('Please enter a quote or message')
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
        workflow_type: 'quote_inspiration',
        target_platform: 'instagram',
        theme: 'Quote graphic: ' + quoteType,
        user_prompt: 'Create a visually stunning quote graphic with the text: "' + quoteText + '". Type: ' + quoteType + '. Design style: ' + designStyle + '. Color scheme: ' + colorScheme + '. Typography: ' + typography + '. ' + additionalInstructions,
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
            <ChatBubbleLeftRightIcon className="w-6 h-6 text-yellow-500" />
            <h1 className="text-xl font-semibold text-white">Quote & Inspiration Content</h1>
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
                      <label className="block text-sm font-medium text-gray-300 mb-2">Quote / Message *</label>
                      <textarea
                        value={quoteText}
                        onChange={(e) => setQuoteText(e.target.value)}
                        placeholder="Enter your inspirational quote, thought leadership message, or motivational text..."
                        rows={4}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                      />
                      <p className="text-xs text-gray-500 mt-1">Keep it concise for maximum impact (30-100 characters ideal)</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Quote Type</label>
                      <select value={quoteType} onChange={(e) => setQuoteType(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500">
                        <option value="motivational">Motivational</option>
                        <option value="inspirational">Inspirational</option>
                        <option value="thought-leadership">Thought Leadership</option>
                        <option value="wisdom">Wisdom / Insight</option>
                        <option value="humorous">Humorous</option>
                        <option value="industry-specific">Industry Specific</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <button onClick={() => toggleSection('advanced')} className="w-full flex items-center justify-between p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors">
                  <span className="font-semibold text-white">Design Settings</span>
                  {expandedSections.advanced ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                </button>
                
                {expandedSections.advanced && (
                  <div className="mt-4 space-y-4 p-4 bg-gray-800/50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Design Style</label>
                      <select value={designStyle} onChange={(e) => setDesignStyle(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500">
                        <option value="modern">Modern & Sleek</option>
                        <option value="minimal">Minimalist</option>
                        <option value="bold">Bold & Striking</option>
                        <option value="elegant">Elegant & Refined</option>
                        <option value="artistic">Artistic & Creative</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Color Scheme</label>
                      <select value={colorScheme} onChange={(e) => setColorScheme(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500">
                        <option value="brand">Brand Colors</option>
                        <option value="gradient">Vibrant Gradient</option>
                        <option value="monochrome">Monochrome</option>
                        <option value="pastel">Soft Pastel</option>
                        <option value="dark">Dark & Moody</option>
                        <option value="bright">Bright & Energetic</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Typography Style</label>
                      <select value={typography} onChange={(e) => setTypography(e.target.value)} className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500">
                        <option value="bold">Bold & Impactful</option>
                        <option value="elegant">Elegant Serif</option>
                        <option value="modern">Modern Sans-serif</option>
                        <option value="handwritten">Handwritten / Script</option>
                        <option value="mixed">Mixed Typography</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Additional Instructions</label>
                      <textarea
                        value={additionalInstructions}
                        onChange={(e) => setAdditionalInstructions(e.target.value)}
                        placeholder="Describe specific design elements, mood, or visual effects..."
                        rows={3}
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
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
                      <input type="checkbox" id="includeLogo" checked={includeLogo} onChange={(e) => setIncludeLogo(e.target.checked)} className="w-4 h-4 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-yellow-500" />
                      <label htmlFor="includeLogo" className="text-sm text-gray-300">Include account logo</label>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleGenerate}
                disabled={generationState === 'generating' || !quoteText.trim()}
                className="w-full py-4 bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {generationState === 'generating' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5" />
                    <span>Generate Quote Graphic</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="w-1/2 flex items-center justify-center p-6 bg-gray-900/50">
            <div className="w-full max-w-2xl">
              {generationState === 'generating' ? (
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="w-16 h-16 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-400 text-lg">Creating inspiring visual...</p>
                </div>
              ) : generatedImages.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white mb-4">Generated Content</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {generatedImages.map((url, idx) => (
                      <div key={idx} className="relative group">
                        <img src={url} alt={'Generated ' + (idx + 1)} className="w-full rounded-lg border border-gray-700 group-hover:border-yellow-500 transition-colors" />
                        <div className="absolute top-2 right-2 bg-gray-900/80 px-2 py-1 rounded text-xs text-white">Variation {idx + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-4 py-12">
                  <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center">
                    <ChatBubbleLeftRightIcon className="w-12 h-12 text-gray-600" />
                  </div>
                  <p className="text-gray-400 text-lg">No content generated yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

