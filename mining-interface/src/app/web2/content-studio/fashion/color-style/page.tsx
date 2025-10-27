'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useGenerationPolling } from '@/hooks/useGenerationPolling'
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

const colorOptions = [
  { id: 'red', name: 'Red', hex: '#EF4444' },
  { id: 'blue', name: 'Blue', hex: '#3B82F6' },
  { id: 'green', name: 'Green', hex: '#10B981' },
  { id: 'yellow', name: 'Yellow', hex: '#F59E0B' },
  { id: 'purple', name: 'Purple', hex: '#8B5CF6' },
  { id: 'pink', name: 'Pink', hex: '#EC4899' },
  { id: 'black', name: 'Black', hex: '#000000' },
  { id: 'white', name: 'White', hex: '#FFFFFF' },
  { id: 'gray', name: 'Gray', hex: '#6B7280' },
  { id: 'brown', name: 'Brown', hex: '#92400E' },
  { id: 'orange', name: 'Orange', hex: '#F97316' },
  { id: 'teal', name: 'Teal', hex: '#14B8A6' }
]

const styleOptions = [
  'Casual', 'Formal', 'Sporty', 'Bohemian', 'Vintage', 
  'Minimalist', 'Edgy', 'Romantic', 'Classic', 'Trendy'
]

export default function ColorStylePage() {
  const router = useRouter()
  const { startPolling, stopPolling } = useGenerationPolling()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [productImages, setProductImages] = useState<File[]>([])
  const [productImagePreviews, setProductImagePreviews] = useState<string[]>([])
  const [productCategory, setProductCategory] = useState('')
  const [customProductCategory, setCustomProductCategory] = useState('')
  const [showCustomCategory, setShowCustomCategory] = useState(false)
  const [numVariations, setNumVariations] = useState(1)
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set())
  const [customColors, setCustomColors] = useState<string[]>([])
  const [newCustomColor, setNewCustomColor] = useState('')
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set())
  const [customStyle, setCustomStyle] = useState('')
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
    { id: 'upload', title: '1. Upload Product Images', isOpen: true },
    { id: 'category', title: '2. Product Category', isOpen: true },
    { id: 'variations', title: '3. Number of Variations', isOpen: true },
    { id: 'colors', title: '4. Color Variations', isOpen: false },
    { id: 'styles', title: '5. Style Variations', isOpen: false },
    { id: 'options', title: '6. Additional Options', isOpen: false }
  ])

  const productCategories = [
    'Dress', 'Shirt', 'Pants', 'Shoes', 'Jacket', 'Skirt',
    'Accessories', 'Bag', 'Hat', 'Jewelry', 'Watch', 'Sunglasses', 'Other'
  ]

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])

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

  const toggleColor = (colorId: string) => {
    const newColors = new Set(selectedColors)
    if (newColors.has(colorId)) {
      newColors.delete(colorId)
    } else {
      newColors.add(colorId)
    }
    setSelectedColors(newColors)
  }

  const toggleStyle = (style: string) => {
    const newStyles = new Set(selectedStyles)
    if (newStyles.has(style)) {
      newStyles.delete(style)
    } else {
      newStyles.add(style)
    }
    setSelectedStyles(newStyles)
  }

  
  const handleProgress = (progress: any) => {
    setProgressMessage(progress.progress_message || 'Processing...')
    setProgressPercent(progress.progress_percent || 0)
    
    // Update generated images progressively as they come in
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      console.log('🖼️ Progressive image update:', progress.generated_image_urls)
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Update platform texts progressively
    if (progress.twitter_text || progress.youtube_description || progress.instagram_caption || progress.linkedin_post) {
      const platformTexts: any = {}
      if (progress.twitter_text) platformTexts.twitter = progress.twitter_text
      if (progress.youtube_description) platformTexts.youtube = progress.youtube_description
      if (progress.instagram_caption) platformTexts.instagram = progress.instagram_caption
      if (progress.linkedin_post) platformTexts.linkedin = progress.linkedin_post
      
      setPlatformTexts(platformTexts)
    }
  }

  const handleComplete = (progress: any) => {
    setGenerationState('complete')
    setProgressMessage('Generation complete!')
    setProgressPercent(100)
    
    // Extract generated images
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Extract platform texts
    const platformTexts: any = {}
    if (progress.twitter_text) platformTexts.twitter = progress.twitter_text
    if (progress.youtube_description) platformTexts.youtube = progress.youtube_description
    if (progress.instagram_caption) platformTexts.instagram = progress.instagram_caption
    if (progress.linkedin_post) platformTexts.linkedin = progress.linkedin_post
    
    setPlatformTexts(platformTexts)
  }

  const handleError = (error: string) => {
    setGenerationState('idle')
    setProgressMessage('')
    setProgressPercent(0)
    alert('Generation failed: ' + error)
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

    if (selectedColors.size === 0 && selectedStyles.size === 0) {
      alert('Please select at least one color or style variation')
      return
    }

    setGenerationState('generating')
    setProgressMessage('Starting unified generation...')
    setProgressPercent(0)
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

      const colorsArray = Array.from(selectedColors)
      const stylesArray = Array.from(selectedStyles)
      const totalVariations = Math.max(colorsArray.length, stylesArray.length, colorsArray.length + stylesArray.length > 0 ? colorsArray.length + stylesArray.length : 1)
      const numImages = Math.min(totalVariations, 5)

      // Prepare workflow inputs
      const workflowInputs = {
        productCategory: productCategory === 'Other' ? customProductCategory : productCategory,
        selectedColors: colorsArray,
        selectedStyles: stylesArray,
        additionalInstructions,
        includeLogo
      }

      // Call unified generation endpoint
      const unifiedRequest = {
        account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
        content_type: 'image',
        industry: 'Fashion',
        workflow_type: 'Color & Style Variations',
        theme: 'Color and style variations: ' + productCategory,
        workflow_inputs: workflowInputs,
        user_uploaded_images: productImageUrls,
        user_prompt: 'Create variations of this ' + (productCategory === 'Other' ? customProductCategory : productCategory) + ' in different colors (' + colorsArray.join(', ') + ') and styles (' + stylesArray.join(', ') + '). ' + additionalInstructions,
        num_variations: numImages,
        include_logo: includeLogo,
        no_characters: false,
        human_characters_only: true,
        web3_characters: false,
        use_brand_aesthetics: true,
        viral_trends: false
      }

      console.log('🚀 Starting unified generation for Color & Style workflow')
      console.log('🔍 Job ID will be received from response')

      const unifiedResponse = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/unified-generation',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(unifiedRequest)
        }
      )

      if (!unifiedResponse.ok) {
        throw new Error('Failed to start unified generation')
      }

      const unifiedData = await unifiedResponse.json()
      const jobId = unifiedData.job_id

      console.log('✅ Unified generation started')
      console.log('🔍 Job ID:', jobId)

      // Start polling for progress updates
      setTimeout(() => {
        startPolling(jobId, handleProgress, handleComplete, handleError)
      }, 1000)

    } catch (error) {
      console.error('Generation error:', error)
      setGenerationState('idle')
      setProgressMessage('')
      setProgressPercent(0)
      alert('Error generating images: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleSaveAndContinue = () => {
    sessionStorage.setItem('generated_images', JSON.stringify({
      images: generatedImages,
      caption: generatedCaption,
      workflow: 'color-style',
      productCategory,
      colors: Array.from(selectedColors),
      styles: Array.from(selectedStyles)
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
                <span className="mr-3">🎨</span>
                Color & Style Variations
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
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'variations')?.isOpen ? 'rotate-180' : '')}
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
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((numVariations - 1) / (5 - 1)) * 100}%, #374151 ${((numVariations - 1) / (5 - 1)) * 100}%, #374151 100%)`
                        }}
                      />
                      <span className="text-2xl font-bold text-blue-400 min-w-[40px] text-center">
                        {numVariations}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Generate 1-5 variations
                    </p>
                  </div>
                )}
              </div>

              {/* Section 4: Colors */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('colors')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">
                    3. Color Variations {selectedColors.size > 0 && <span className="text-blue-400">({selectedColors.size})</span>}
                  </h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'colors')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'colors')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="space-y-4">
                      {/* Color Picker */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Select Colors</label>
                        <div className="space-y-3">
                          {/* Custom Color Input */}
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={newCustomColor || '#000000'}
                              onChange={(e) => setNewCustomColor(e.target.value)}
                              className="w-12 h-8 rounded border border-gray-600 cursor-pointer"
                            />
                            <input
                              type="text"
                              value={newCustomColor}
                              onChange={(e) => setNewCustomColor(e.target.value)}
                              placeholder="Enter color name or hex code"
                              className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => {
                                if (newCustomColor.trim()) {
                                  setCustomColors(prev => [...prev, newCustomColor])
                                  setSelectedColors(prev => new Set([...Array.from(prev), newCustomColor]))
                                  setNewCustomColor('')
                                }
                              }}
                              disabled={!newCustomColor.trim()}
                              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Add
                            </button>
                          </div>
                          
                          {/* Selected Colors Display */}
                          {customColors.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {customColors.map((color, index) => (
                                <div key={index} className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
                                  <div 
                                    className="w-4 h-4 rounded border border-gray-600"
                                    style={{ backgroundColor: color }}
                                  ></div>
                                  <span className="text-sm text-white">{color}</span>
                                  <button
                                    onClick={() => {
                                      setCustomColors(prev => prev.filter((_, i) => i !== index))
                                      setSelectedColors(prev => {
                                        const newSet = new Set(Array.from(prev))
                                        newSet.delete(color)
                                        return newSet
                                      })
                                    }}
                                    className="text-red-400 hover:text-red-300 text-sm"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 4: Styles */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('styles')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">
                    4. Style Variations {selectedStyles.size > 0 && <span className="text-purple-400">({selectedStyles.size})</span>}
                  </h2>
                  <svg
                    className={'w-5 h-5 text-gray-400 transition-transform ' + (sections.find(s => s.id === 'styles')?.isOpen ? 'rotate-180' : '')}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'styles')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="grid grid-cols-2 gap-2">
                      {styleOptions.map((style) => (
                        <button
                          key={style}
                          onClick={() => toggleStyle(style)}
                          className={'px-4 py-2 rounded-lg text-sm font-medium transition-all ' +
                            (selectedStyles.has(style)
                              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700')}
                        >
                          {style}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if (customStyle.trim()) {
                            setSelectedStyles(prev => new Set([...Array.from(prev), customStyle]))
                            setCustomStyle('')
                          }
                        }}
                        disabled={!customStyle.trim()}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        + Add Custom
                      </button>
                    </div>
                    <input
                      type="text"
                      value={customStyle}
                      onChange={(e) => setCustomStyle(e.target.value)}
                      placeholder="Enter custom style"
                      className="w-full mt-2 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {/* Display selected custom styles */}
                    {Array.from(selectedStyles).filter(style => !styleOptions.includes(style)).length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-gray-400 mb-1">Custom styles:</div>
                        <div className="flex flex-wrap gap-1">
                          {Array.from(selectedStyles).filter(style => !styleOptions.includes(style)).map((style, index) => (
                            <span
                              key={index}
                              className="px-2 py-1 bg-purple-600 text-white text-xs rounded-lg flex items-center gap-1"
                            >
                              {style}
                              <button
                                onClick={() => {
                                  setSelectedStyles(prev => {
                                    const newSet = new Set(Array.from(prev))
                                    newSet.delete(style)
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
                        placeholder="e.g., Keep same design, just vary colors..."
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
                disabled={generationState === 'generating' || productImages.length === 0 || !productCategory || (selectedColors.size === 0 && selectedStyles.size === 0)}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {generationState === 'generating' ? (
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
          <div className="w-1/2 flex flex-col">
            <PlatformSelector
              platforms={['twitter', 'youtube', 'instagram', 'linkedin']}
              selected={selectedPlatform}
              onChange={(platform) => setSelectedPlatform(platform as any)}
              disabled={generationState !== 'complete'}
            />
            <div className="flex-1 p-6 overflow-hidden flex flex-col">
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 flex-1 flex items-center justify-center relative">
                {generationState === 'generating' ? (
                  <ProgressOverlay
                    message={progressMessage}
                    percent={progressPercent}
                  />
                ) : generationState === 'complete' && generatedImages.length > 0 ? (
                  <div className="relative w-full h-full p-4">
                    {generatedImages.length > 1 && (
                      <div className="absolute top-4 left-0 right-0 flex items-center justify-center space-x-2 z-10">
                        <button onClick={() => setCurrentImageIndex(Math.max(0, currentImageIndex - 1))} disabled={currentImageIndex === 0} className="px-3 py-1 bg-gray-900/80 text-white rounded-lg disabled:opacity-50">←</button>
                        <span className="px-3 py-1 bg-gray-900/80 text-white rounded-lg text-sm">{currentImageIndex + 1} of {generatedImages.length}</span>
                        <button onClick={() => setCurrentImageIndex(Math.min(generatedImages.length - 1, currentImageIndex + 1))} disabled={currentImageIndex === generatedImages.length - 1} className="px-3 py-1 bg-gray-900/80 text-white rounded-lg disabled:opacity-50">→</button>
                      </div>
                    )}
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="relative max-w-full max-h-full">
                        <Image src={generatedImages[currentImageIndex]} alt={'Generated image ' + (currentImageIndex + 1)} width={800} height={800} className="object-contain rounded-lg" />
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
            {generationState === 'complete' && platformTexts[selectedPlatform] && (
              <PlatformText text={platformTexts[selectedPlatform]} platform={selectedPlatform} onCopy={() => console.log('Text copied')} onPost={() => console.log('Posting to ' + selectedPlatform)} />
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