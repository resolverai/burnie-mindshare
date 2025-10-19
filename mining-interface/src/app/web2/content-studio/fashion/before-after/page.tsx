'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'

interface CollapsibleSection {
  id: string
  title: string
  isOpen: boolean
}

const stylingTypes = [
  { id: 'casual-to-formal', name: 'Casual to Formal', icon: '👔', description: 'Transform casual look to professional' },
  { id: 'basic-to-trendy', name: 'Basic to Trendy', icon: '✨', description: 'Elevate basic to fashion-forward' },
  { id: 'day-to-night', name: 'Day to Night', icon: '🌙', description: 'Day wear to evening glamour' },
  { id: 'season-transition', name: 'Season Transition', icon: '🍂', description: 'Adapt look across seasons' },
  { id: 'minimal-to-statement', name: 'Minimal to Statement', icon: '💎', description: 'Simple to bold styling' },
  { id: 'vintage-to-modern', name: 'Vintage to Modern', icon: '🕰️', description: 'Classic to contemporary' }
]

const accessoryOptions = [
  'Add accessories', 'Add layers', 'Change footwear', 'Style hair differently', 
  'Add jewelry', 'Change colors', 'Add textures', 'Professional makeup'
]

export default function BeforeAfterPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [productImage, setProductImage] = useState<File | null>(null)
  const [productImagePreview, setProductImagePreview] = useState<string | null>(null)
  const [productCategory, setProductCategory] = useState('')
  const [selectedStylingType, setSelectedStylingType] = useState('')
  const [selectedEnhancements, setSelectedEnhancements] = useState<Set<string>>(new Set())
  const [includeLogo, setIncludeLogo] = useState(true)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [generatedCaption, setGeneratedCaption] = useState('')
  const [sections, setSections] = useState<CollapsibleSection[]>([
    { id: 'upload', title: '1. Upload Product Image', isOpen: true },
    { id: 'category', title: '2. Product Category', isOpen: true },
    { id: 'styling', title: '3. Styling Transformation', isOpen: false },
    { id: 'enhancements', title: '4. Styling Enhancements', isOpen: false },
    { id: 'options', title: '5. Additional Options', isOpen: false }
  ])

  const productCategories = [
    'Dress', 'Shirt', 'Pants', 'Shoes', 'Jacket', 'Skirt',
    'Accessories', 'Bag', 'Hat', 'Jewelry', 'Watch', 'Sunglasses'
  ]

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB')
      return
    }

    setProductImage(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setProductImagePreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const toggleSection = (sectionId: string) => {
    setSections(sections.map(section => 
      section.id === sectionId 
        ? { ...section, isOpen: !section.isOpen }
        : section
    ))
  }

  const toggleEnhancement = (enhancement: string) => {
    const newEnhancements = new Set(selectedEnhancements)
    if (newEnhancements.has(enhancement)) {
      newEnhancements.delete(enhancement)
    } else {
      newEnhancements.add(enhancement)
    }
    setSelectedEnhancements(newEnhancements)
  }

  const handleGenerate = async () => {
    if (!productImage) {
      alert('Please upload a product image')
      return
    }

    if (!productCategory) {
      alert('Please select a product category')
      return
    }

    if (!selectedStylingType) {
      alert('Please select a styling transformation type')
      return
    }

    setIsGenerating(true)
    setGeneratedImages([])

    try {
      const formData = new FormData()
      formData.append('file', productImage)
      formData.append('account_id', localStorage.getItem('burnie_web2_account_id') || '')

      const uploadResponse = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/upload-user-file',
        {
          method: 'POST',
          body: formData
        }
      )

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload product image')
      }

      const uploadData = await uploadResponse.json()
      const productImageUrl = uploadData.s3_url

      const enhancementsArray = Array.from(selectedEnhancements)
      const selectedTypeObj = stylingTypes.find(t => t.id === selectedStylingType)

      const promptRequest = {
        account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
        prompt_types: ['image', 'tweet'],
        num_prompts: { image: 2, tweet: 1 },
        theme: 'Before/After styling: ' + (selectedTypeObj?.name || selectedStylingType),
        user_prompt: 'Create before and after images showing this ' + productCategory + ' in a ' + (selectedTypeObj?.name || selectedStylingType) + ' transformation. Enhancements: ' + enhancementsArray.join(', ') + '. ' + additionalInstructions,
        user_images: [productImageUrl],
        workflow_type: 'fashion_before_after',
        target_platform: 'instagram',
        no_characters: false,
        human_characters_only: true,
        web3_characters: false,
        use_brand_aesthetics: true,
        viral_trends: false,
        include_logo: includeLogo
      }

      const promptResponse = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-prompts',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(promptRequest)
        }
      )

      if (!promptResponse.ok) {
        throw new Error('Failed to generate prompts')
      }

      const promptData = await promptResponse.json()
      setGeneratedCaption(promptData.prompts.tweet_text)

      const imageGenerationPromises = []
      for (let i = 1; i <= 2; i++) {
        const promptKey = 'image_prompt_' + i
        const imagePrompt = promptData.prompts[promptKey]
        
        const imageRequest = {
          account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
          prompt: imagePrompt,
          num_images: 1,
          include_logo: includeLogo,
          user_images: [productImageUrl],
          image_model: 'nano-banana'
        }

        imageGenerationPromises.push(
          fetch(
            (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/generate-image',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(imageRequest)
            }
          )
        )
      }

      const imageResponses = await Promise.all(imageGenerationPromises)
      const imageResults = await Promise.all(imageResponses.map(r => r.json()))

      const imageUrls = imageResults
        .filter(result => result.success)
        .map(result => result.content_url)

      setGeneratedImages(imageUrls)

    } catch (error) {
      console.error('Generation error:', error)
      alert('Error generating images: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveAndContinue = () => {
    sessionStorage.setItem('generated_images', JSON.stringify({
      images: generatedImages,
      caption: generatedCaption,
      workflow: 'before-after',
      productCategory,
      stylingType: selectedStylingType,
      enhancements: Array.from(selectedEnhancements)
    }))

    router.push('/web2/content-studio/results')
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />

      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-8 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.push('/web2/content-studio/fashion')}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ← Back
              </button>
              <h1 className="text-2xl font-bold text-white flex items-center">
                <span className="mr-3">✨</span>
                Before/After Styling
              </h1>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex">
          <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-700">
            <div className="space-y-3">
              {/* Section 1: Upload */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('upload')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">1. Upload Product Image</h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'upload')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'upload')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ' + 
                        (isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500') +
                        (productImagePreview ? ' border-green-500' : '')}
                    >
                      {productImagePreview ? (
                        <div className="space-y-3">
                          <div className="relative w-32 h-32 mx-auto">
                            <Image
                              src={productImagePreview}
                              alt="Product preview"
                              fill
                              className="object-contain rounded-lg"
                            />
                          </div>
                          <p className="text-xs text-gray-400">Click to change</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-4xl">📸</div>
                          <div>
                            <p className="text-white font-medium mb-1 text-sm">Drop image or click to browse</p>
                            <p className="text-xs text-gray-400">JPG, PNG, GIF, WebP (max 10MB)</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                      className="hidden"
                    />
                  </div>
                )}
              </div>

              {/* Section 2: Category */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('category')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">2. Product Category</h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'category')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'category')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="grid grid-cols-3 gap-2">
                      {productCategories.map((category) => (
                        <button
                          key={category}
                          onClick={() => setProductCategory(category)}
                          className={'px-3 py-2 rounded-lg text-sm font-medium transition-all ' +
                            (productCategory === category
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700')}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Styling Type */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('styling')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">3. Styling Transformation</h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'styling')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'styling')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="grid grid-cols-2 gap-3">
                      {stylingTypes.map((type) => (
                        <button
                          key={type.id}
                          onClick={() => setSelectedStylingType(type.id)}
                          className={'p-3 rounded-lg text-left transition-all border-2 ' +
                            (selectedStylingType === type.id
                              ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white border-blue-500'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 border-transparent')}
                        >
                          <div className="text-2xl mb-1">{type.icon}</div>
                          <div className="text-sm font-medium">{type.name}</div>
                          <div className="text-xs opacity-75 mt-1">{type.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 4: Enhancements */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('enhancements')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">
                    4. Styling Enhancements {selectedEnhancements.size > 0 && <span className="text-purple-400">({selectedEnhancements.size})</span>}
                  </h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'enhancements')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'enhancements')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="grid grid-cols-2 gap-2">
                      {accessoryOptions.map((option) => (
                        <button
                          key={option}
                          onClick={() => toggleEnhancement(option)}
                          className={'px-3 py-2 rounded-lg text-sm font-medium transition-all ' +
                            (selectedEnhancements.has(option)
                              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700')}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 5: Options */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('options')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">5. Additional Options</h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'options')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'options')?.isOpen && (
                  <div className="p-4 border-t border-gray-700 space-y-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeLogo}
                        onChange={(e) => setIncludeLogo(e.target.checked)}
                        className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-300">Include brand logo</span>
                    </label>

                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">
                        Additional Instructions
                      </label>
                      <textarea
                        value={additionalInstructions}
                        onChange={(e) => setAdditionalInstructions(e.target.value)}
                        placeholder="e.g., Keep same person, focus on outfit transformation..."
                        rows={3}
                        className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !productImage || !productCategory || !selectedStylingType}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <span>✨ Generate Images</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel */}
          <div className="w-1/2 p-6 flex flex-col">
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 flex-1 flex flex-col">
              <h2 className="text-xl font-bold text-white mb-4">Generated Images</h2>
              
              <div className="flex-1 flex items-center justify-center">
                {isGenerating ? (
                  <div className="text-center space-y-4">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto"></div>
                    <p className="text-white font-medium">Generating your before/after images...</p>
                    <p className="text-sm text-gray-400">This may take a minute</p>
                  </div>
                ) : generatedImages.length > 0 ? (
                  <div className="w-full space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {generatedImages.map((imageUrl, index) => (
                        <div key={index} className="space-y-2">
                          <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-gray-700 hover:border-blue-500 transition-all">
                            <Image
                              src={imageUrl}
                              alt={'Generated image ' + (index + 1)}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <p className="text-center text-sm font-medium text-gray-400">
                            {index === 0 ? 'BEFORE' : 'AFTER'}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-700">
                      <button
                        onClick={handleSaveAndContinue}
                        className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-500 hover:to-teal-500 text-white rounded-lg font-bold transition-all flex items-center justify-center space-x-2"
                      >
                        <span>→ Continue to Post</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="text-6xl opacity-20">🖼️</div>
                    <p className="text-gray-400">Your before/after images will appear here</p>
                    <p className="text-sm text-gray-500">Fill the form and click Generate Images</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

