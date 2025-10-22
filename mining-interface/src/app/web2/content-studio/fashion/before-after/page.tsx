'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'
import PlatformSelector from '@/components/web2/PlatformSelector'
import ProgressOverlay from '@/components/web2/ProgressOverlay'
import PlatformText from '@/components/web2/PlatformText'

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
  
  const [productImages, setProductImages] = useState<File[]>([])
  const [productImagePreviews, setProductImagePreviews] = useState<string[]>([])
  const [productCategory, setProductCategory] = useState('')
  const [customProductCategory, setCustomProductCategory] = useState('')
  const [showCustomCategory, setShowCustomCategory] = useState(false)
  const [numVariations, setNumVariations] = useState(1)
  const [selectedStylingType, setSelectedStylingType] = useState('')
  const [customStylingType, setCustomStylingType] = useState('')
  const [selectedEnhancements, setSelectedEnhancements] = useState<Set<string>>(new Set())
  const [customEnhancement, setCustomEnhancement] = useState('')
  const [includeLogo, setIncludeLogo] = useState(true)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [generatedCaption, setGeneratedCaption] = useState('')
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null)
  
  // New state for unified generation
  const [generationState, setGenerationState] = useState<'idle' | 'generating' | 'complete'>('idle')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [selectedPlatform, setSelectedPlatform] = useState<'twitter' | 'youtube' | 'instagram' | 'linkedin'>('twitter')
  const [platformTexts, setPlatformTexts] = useState<any>({})
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [sections, setSections] = useState<CollapsibleSection[]>([
    { id: 'upload', title: '1. Upload Product Image', isOpen: true },
    { id: 'category', title: '2. Product Category', isOpen: true },
    { id: 'variations', title: '3. Number of Variations', isOpen: true },
    { id: 'styling', title: '4. Styling Transformation', isOpen: false },
    { id: 'enhancements', title: '5. Styling Enhancements', isOpen: false },
    { id: 'options', title: '6. Additional Options', isOpen: false }
  ])

  const productCategories = [
    'Dress', 'Shirt', 'Pants', 'Shoes', 'Jacket', 'Skirt',
    'Accessories', 'Bag', 'Hat', 'Jewelry', 'Watch', 'Sunglasses', 'Other'
  ]

  const handleFileSelect = (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const validFiles = fileArray.filter(file => {
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not an image file`)
        return false
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} is larger than 10MB`)
        return false
      }
      return true
    })

    if (validFiles.length === 0) return

    setProductImages(prev => [...prev, ...validFiles])
    
    // Generate previews for new files
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        setProductImagePreviews(prev => [...prev, e.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const removeProductImage = (index: number) => {
    setProductImages(prev => prev.filter((_, i) => i !== index))
    setProductImagePreviews(prev => prev.filter((_, i) => i !== index))
  }

  const handleCategoryChange = (category: string) => {
    setProductCategory(category)
    if (category === 'Other') {
      setShowCustomCategory(true)
    } else {
      setShowCustomCategory(false)
      setCustomProductCategory('')
    }
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
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files)
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
    if (productImages.length === 0) {
      alert('Please upload at least one product image')
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
      // Upload all product images
      const uploadPromises = productImages.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
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
        return uploadData.s3_url
      })

      const productImageUrls = await Promise.all(uploadPromises)

      const enhancementsArray = Array.from(selectedEnhancements)
      const selectedTypeObj = stylingTypes.find(t => t.id === selectedStylingType)

      const promptRequest = {
        account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
        prompt_types: ['image', 'tweet'],
        num_prompts: { image: 2, tweet: 1 },
        theme: 'Before/After styling: ' + (selectedTypeObj?.name || selectedStylingType),
        user_prompt: 'Create before and after images showing this ' + (productCategory === 'Other' ? customProductCategory : productCategory) + ' in a ' + (selectedTypeObj?.name || selectedStylingType) + ' transformation. Enhancements: ' + enhancementsArray.join(', ') + '. ' + additionalInstructions,
        user_images: productImageUrls,
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
          user_images: productImageUrls,
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
    <>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #1f2937;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #1f2937;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-webkit-slider-track {
          height: 8px;
          border-radius: 4px;
        }
        
        .slider::-moz-range-track {
          height: 8px;
          border-radius: 4px;
        }
      `}</style>
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
                  <h2 className="text-base font-bold text-white">1. Upload Product Images</h2>
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
                        (productImagePreviews.length > 0 ? ' border-green-500' : '')}
                    >
                      {productImagePreviews.length > 0 ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
                            {productImagePreviews.map((preview, index) => (
                              <div key={index} className="relative w-20 h-20 group">
                                <div 
                                  className="relative w-full h-full cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedImageModal(preview)
                                  }}
                                >
                                  <Image
                                    src={preview}
                                    alt={`Product preview ${index + 1}`}
                                    fill
                                    className="object-cover rounded-lg hover:opacity-80 transition-opacity"
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removeProductImage(index)
                                    }}
                                    className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-gray-400">Click to add more images</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="text-4xl">📸</div>
                          <div>
                            <p className="text-white font-medium mb-1 text-sm">Drop images or click to browse</p>
                            <p className="text-xs text-gray-400">JPG, PNG, GIF, WebP (max 10MB each)</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
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
                          onClick={() => handleCategoryChange(category)}
                          className={'px-3 py-2 rounded-lg text-sm font-medium transition-all ' +
                            (productCategory === category
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700')}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                    {showCustomCategory && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Custom Product Category
                        </label>
                        <input
                          type="text"
                          value={customProductCategory}
                          onChange={(e) => setCustomProductCategory(e.target.value)}
                          placeholder="Enter your custom product category"
                          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 3: Number of Variations */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('variations')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">3. Number of Variations</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'variations')?.isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'variations')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="flex items-center space-x-4">
                      <input
                        type="range"
                        min="1"
                        max="5"
                        value={numVariations}
                        onChange={(e) => setNumVariations(parseInt(e.target.value))}
                        className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                        style={{
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((numVariations - 1) / 4) * 100}%, #374151 ${((numVariations - 1) / 4) * 100}%, #374151 100%)`
                        }}
                      />
                      <span className="text-white font-medium min-w-[2rem] text-center">{numVariations}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Choose how many variations to generate (1-5)</p>
                  </div>
                )}
              </div>

              {/* Section 4: Styling Type */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('styling')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">4. Styling Transformation</h2>
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
                    <div className="mt-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customStylingType}
                          onChange={(e) => setCustomStylingType(e.target.value)}
                          placeholder="Enter custom styling transformation"
                          className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => {
                            if (customStylingType.trim()) {
                              setSelectedStylingType(customStylingType)
                              setCustomStylingType('')
                            }
                          }}
                          disabled={!customStylingType.trim()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Add Custom
                        </button>
                      </div>
                    </div>
                    {/* Display selected custom styling transformation */}
                    {selectedStylingType && !stylingTypes.map(s => s.id).includes(selectedStylingType) && (
                      <div className="mt-2">
                        <div className="text-xs text-gray-400 mb-1">Custom styling transformation:</div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg flex items-center gap-1">
                            {selectedStylingType}
                            <button
                              onClick={() => setSelectedStylingType('')}
                              className="text-blue-200 hover:text-white"
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      </div>
                    )}
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
                    5. Styling Enhancements {selectedEnhancements.size > 0 && <span className="text-purple-400">({selectedEnhancements.size})</span>}
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
                    <div className="mt-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customEnhancement}
                          onChange={(e) => setCustomEnhancement(e.target.value)}
                          placeholder="Enter custom enhancement"
                          className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => {
                            if (customEnhancement.trim()) {
                              setSelectedEnhancements(prev => new Set([...Array.from(prev), customEnhancement]))
                              setCustomEnhancement('')
                            }
                          }}
                          disabled={!customEnhancement.trim()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Add Custom
                        </button>
                      </div>
                    </div>
                    {/* Display selected custom enhancements */}
                    {Array.from(selectedEnhancements).filter(enhancement => !accessoryOptions.includes(enhancement)).length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-gray-400 mb-1">Custom enhancements:</div>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(selectedEnhancements).filter(enhancement => !accessoryOptions.includes(enhancement)).map((enhancement, index) => (
                            <span
                              key={index}
                              className="px-2 py-1 bg-purple-600 text-white text-xs rounded-lg flex items-center gap-1"
                            >
                              {enhancement}
                              <button
                                onClick={() => {
                                  setSelectedEnhancements(prev => {
                                    const newSet = new Set(Array.from(prev))
                                    newSet.delete(enhancement)
                                    return newSet
                                  })
                                }}
                                className="text-purple-200 hover:text-white"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 5: Options */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('options')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">6. Additional Options</h2>
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
                disabled={isGenerating || productImages.length === 0 || !productCategory || !selectedStylingType}
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
                    <div className="text-6xl opacity-20">🖼️</div>
                    <p className="text-gray-400">Your generated images will appear here</p>
                    <p className="text-sm text-gray-500">Fill the form and click Generate Images</p>
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
        </main>
      </div>
    </div>

    {/* Image Modal */}
    {selectedImageModal && (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={() => setSelectedImageModal(null)}>
        <div className="relative max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setSelectedImageModal(null)}
            className="absolute -top-2 -right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center text-lg hover:bg-red-600 transition-colors z-10"
          >
            ×
          </button>
          <Image
            src={selectedImageModal}
            alt="Full size preview"
            width={800}
            height={600}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        </div>
      </div>
    )}
    </>
  )
}