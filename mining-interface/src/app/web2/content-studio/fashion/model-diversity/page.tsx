'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useGenerationPolling } from '@/hooks/useGenerationPolling'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'
import PlatformSelector from '@/components/web2/PlatformSelector'
import ProgressOverlay from '@/components/web2/ProgressOverlay'
import PlatformText from '@/components/web2/PlatformText'

interface ModelPreference {
  ethnicities: string[]
  bodyTypes: string[]
  ageRanges: string[]
  genders: string[]
}

interface CollapsibleSection {
  id: string
  title: string
  isOpen: boolean
}

export default function ModelDiversityPage() {
  const router = useRouter()
  const { startPolling, stopPolling } = useGenerationPolling()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Form state
  const [productImages, setProductImages] = useState<File[]>([])
  const [productImagePreviews, setProductImagePreviews] = useState<string[]>([])
  const [productCategory, setProductCategory] = useState('')
  const [customProductCategory, setCustomProductCategory] = useState('')
  const [showCustomCategory, setShowCustomCategory] = useState(false)
  const [numVariations, setNumVariations] = useState(1)
  const [modelPreferences, setModelPreferences] = useState<ModelPreference>({
    ethnicities: [],
    bodyTypes: [],
    ageRanges: [],
    genders: []
  })
  const [customEthnicity, setCustomEthnicity] = useState('')
  const [customBodyType, setCustomBodyType] = useState('')
  const [customAgeRange, setCustomAgeRange] = useState('')
  const [customGender, setCustomGender] = useState('')
  const [setting, setSetting] = useState('')
  const [customSetting, setCustomSetting] = useState('')
  const [showCustomSetting, setShowCustomSetting] = useState(false)
  const [modelImage, setModelImage] = useState<File | null>(null)
  const [modelImagePreview, setModelImagePreview] = useState<string | null>(null)
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null)
  const [includeLogo, setIncludeLogo] = useState(true)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [generatedCaption, setGeneratedCaption] = useState('')
  
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
    { id: 'preferences', title: '4. Model Preferences', isOpen: false },
    { id: 'setting', title: '5. Setting/Context', isOpen: false },
    { id: 'options', title: '6. Additional Options', isOpen: false }
  ])

  const productCategories = [
    'Dress', 'Shirt', 'Pants', 'Shoes', 'Jacket', 'Skirt', 
    'Accessories', 'Bag', 'Hat', 'Jewelry', 'Watch', 'Sunglasses', 'Other'
  ]

  const ethnicityOptions = [
    'Asian', 'Black', 'Hispanic', 'White', 'Middle Eastern', 'Mixed', 'Any'
  ]

  const bodyTypeOptions = [
    'Slim', 'Athletic', 'Curvy', 'Plus-size', 'Petite', 'Tall', 'Any'
  ]

  const ageRangeOptions = [
    'Teen (16-19)', 'Young Adult (20-30)', 'Adult (30-50)', 'Mature (50+)', 'Any'
  ]

  const genderOptions = [
    'Female', 'Male', 'Non-binary', 'Any'
  ]

  const settingOptions = [
    'Studio', 'Street', 'Beach', 'Office', 'Evening Event', 
    'Casual Home', 'Park', 'Cafe', 'Shopping Mall', 'Other'
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

  const handleModelImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB')
      return
    }

    setModelImage(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setModelImagePreview(e.target?.result as string)
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
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files)
    }
  }

  const toggleArrayValue = (array: string[], value: string, setter: (val: string[]) => void) => {
    if (array.includes(value)) {
      setter(array.filter(item => item !== value))
    } else {
      setter([...array, value])
    }
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

  const handleSettingChange = (settingValue: string) => {
    setSetting(settingValue)
    if (settingValue === 'Other') {
      setShowCustomSetting(true)
    } else {
      setShowCustomSetting(false)
      setCustomSetting('')
    }
  }

  const removeProductImage = (index: number) => {
    setProductImages(prev => prev.filter((_, i) => i !== index))
    setProductImagePreviews(prev => prev.filter((_, i) => i !== index))
  }

  const toggleSection = (sectionId: string) => {
    setSections(sections.map(section => 
      section.id === sectionId 
        ? { ...section, isOpen: !section.isOpen }
        : section
    ))
  }

  const handleProgress = (progress: any) => {
    console.log('🎯 Frontend progress update:', {
      progress_percent: progress.progress_percent,
      progress_message: progress.progress_message,
      status: progress.status,
      generated_image_urls: progress.generated_image_urls?.length || 0
    })
    console.log('🎯 Updating UI with progress:', progress.progress_percent + '%')
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

    if (modelPreferences.ethnicities.length === 0 && !modelImage) {
      alert('Please select at least one ethnicity preference or upload a model image')
      return
    }

    // Set generation state
    setGenerationState('generating')
    setProgressMessage('Starting generation...')
    setProgressPercent(0)
    setGeneratedImages([])
    setPlatformTexts({})

    try {
      // Step 1: Upload all product images
      setProgressMessage('Uploading product images...')
      setProgressPercent(10)
      
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

      // Step 2: Upload model image if provided
      let modelImageUrl = null
      if (modelImage) {
        setProgressMessage('Uploading model image...')
        setProgressPercent(15)
        
        const modelFormData = new FormData()
        modelFormData.append('file', modelImage)
        modelFormData.append('account_id', localStorage.getItem('burnie_web2_account_id') || '')

        const modelUploadResponse = await fetch(
          (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/upload-user-file',
          {
            method: 'POST',
            body: modelFormData
          }
        )

        if (!modelUploadResponse.ok) {
          throw new Error('Failed to upload model image')
        }

        const modelUploadData = await modelUploadResponse.json()
        modelImageUrl = modelUploadData.s3_url
      }

      // Step 3: Use unified generation endpoint
      setProgressMessage('Starting unified generation...')
      setProgressPercent(0)

      // Generate user prompt based on whether model image is provided
      let userPrompt
      if (modelImageUrl) {
        // When model image is provided, override all preferences
        userPrompt = 'Show this ' + (productCategory === 'Other' ? customProductCategory : productCategory) + 
          ' on the specific model provided in the model image. ' +
          'Use the exact model from the uploaded image for the product showcase. ' +
          'Setting: ' + (setting === 'Other' ? customSetting : setting) + 
          '. ' + additionalInstructions
      } else {
        // Use model preferences when no specific model image
        userPrompt = 'Show this ' + (productCategory === 'Other' ? customProductCategory : productCategory) + ' on diverse models. ' + 
          'Model preferences: Ethnicities: ' + modelPreferences.ethnicities.join(', ') + 
          ', Body Types: ' + modelPreferences.bodyTypes.join(', ') + 
          ', Age Ranges: ' + modelPreferences.ageRanges.join(', ') + 
          ', Genders: ' + modelPreferences.genders.join(', ') + 
          '. Setting: ' + (setting === 'Other' ? customSetting : setting) + 
          '. ' + additionalInstructions
      }

      const unifiedRequest = {
        account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
        content_type: 'image',
        industry: 'Fashion',
        workflow_type: 'Model Diversity Showcase',
        theme: 'Product showcase: ' + (productCategory === 'Other' ? customProductCategory : productCategory),
        user_prompt: userPrompt,
        user_uploaded_images: productImageUrls,
        model_image_url: modelImageUrl, // Add model image URL
        num_images: numVariations,
        target_platform: selectedPlatform,
        no_characters: false,
        human_characters_only: true,
        web3_characters: false,
        use_brand_aesthetics: true,
        viral_trends: false,
        include_logo: includeLogo,
        workflow_inputs: {
          productCategory: productCategory === 'Other' ? customProductCategory : productCategory,
          modelPreferences: modelImageUrl ? null : modelPreferences, // Override with null if model image provided
          modelImageProvided: !!modelImageUrl,
          setting: setting === 'Other' ? customSetting : setting,
          additionalInstructions
        }
      }

      // Start generation and get job ID
      const response = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/unified-generation',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(unifiedRequest)
        }
      )

      if (!response.ok) {
        throw new Error('Failed to start generation')
      }

      const { job_id } = await response.json()
      
      // Start polling for progress after a short delay to ensure initial record is created
      console.log('🔍 Job ID for polling:', job_id)
      if (job_id) {
        console.log('⏰ Setting timeout to start polling in 1 second...')
        setTimeout(() => {
          console.log('🚀 Starting polling for job:', job_id)
          console.log('🚀 Polling callbacks:', { handleProgress: !!handleProgress, handleComplete: !!handleComplete, handleError: !!handleError })
          startPolling(job_id, handleProgress, handleComplete, handleError)
        }, 1000) // 1 second delay
      } else {
        console.error('❌ No job ID received from backend')
      }

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
      workflow: 'model-diversity',
      productCategory,
      setting
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

      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarExpanded ? 'ml-64' : 'ml-20'}`}>
        {/* Header */}
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
                <span className="mr-3">👥</span>
                Model Diversity Showcase
              </h1>
            </div>
          </div>
        </header>

        {/* Main Content - Split Layout 50-50 */}
        <main className="flex-1 overflow-hidden flex">
          {/* Left Panel - Form (50%) */}
          <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-700">
            <div className="space-y-3">
              {/* Section 1: Upload Product Image */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('upload')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">1. Upload Product Images</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'upload')?.isOpen ? 'rotate-180' : ''}`}
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
                      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
                        ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}
                        ${productImagePreviews.length > 0 ? 'border-green-500' : ''}`}
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

              {/* Section 2: Product Category */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('category')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">2. Product Category</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'category')?.isOpen ? 'rotate-180' : ''}`}
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
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all
                            ${productCategory === category
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
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

              {/* Section 4: Model Preferences */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('preferences')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">4. Model Preferences</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'preferences')?.isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'preferences')?.isOpen && (
                  <div className="p-4 border-t border-gray-700 space-y-4">
                    {/* Ethnicities */}
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">
                        Ethnicities {!modelImage && <span className="text-red-400">*</span>}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {ethnicityOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() => toggleArrayValue(
                              modelPreferences.ethnicities,
                              option,
                              (val) => setModelPreferences({ ...modelPreferences, ethnicities: val })
                            )}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                              ${modelPreferences.ethnicities.includes(option)
                                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                          >
                            {option}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            const newEthnicities = [...modelPreferences.ethnicities, customEthnicity]
                            setModelPreferences({ ...modelPreferences, ethnicities: newEthnicities })
                            setCustomEthnicity('')
                          }}
                          disabled={!customEthnicity.trim()}
                          className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          + Add Custom
                        </button>
                      </div>
                      <input
                        type="text"
                        value={customEthnicity}
                        onChange={(e) => setCustomEthnicity(e.target.value)}
                        placeholder="Enter custom ethnicity"
                        className="w-full mt-2 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {/* Display selected custom ethnicities */}
                      {modelPreferences.ethnicities.filter(eth => !ethnicityOptions.includes(eth)).length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-400 mb-1">Custom ethnicities:</div>
                          <div className="flex flex-wrap gap-1">
                            {modelPreferences.ethnicities.filter(eth => !ethnicityOptions.includes(eth)).map((ethnicity, index) => (
                              <span
                                key={index}
                                className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg flex items-center gap-1"
                              >
                                {ethnicity}
                                <button
                                  onClick={() => {
                                    const newEthnicities = modelPreferences.ethnicities.filter(eth => eth !== ethnicity)
                                    setModelPreferences({ ...modelPreferences, ethnicities: newEthnicities })
                                  }}
                                  className="text-blue-200 hover:text-white"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Body Types */}
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">Body Types</label>
                      <div className="flex flex-wrap gap-2">
                        {bodyTypeOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() => toggleArrayValue(
                              modelPreferences.bodyTypes,
                              option,
                              (val) => setModelPreferences({ ...modelPreferences, bodyTypes: val })
                            )}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                              ${modelPreferences.bodyTypes.includes(option)
                                ? 'bg-gradient-to-r from-green-600 to-teal-600 text-white'
                                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                          >
                            {option}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            const newBodyTypes = [...modelPreferences.bodyTypes, customBodyType]
                            setModelPreferences({ ...modelPreferences, bodyTypes: newBodyTypes })
                            setCustomBodyType('')
                          }}
                          disabled={!customBodyType.trim()}
                          className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          + Add Custom
                        </button>
                      </div>
                      <input
                        type="text"
                        value={customBodyType}
                        onChange={(e) => setCustomBodyType(e.target.value)}
                        placeholder="Enter custom body type"
                        className="w-full mt-2 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {/* Display selected custom body types */}
                      {modelPreferences.bodyTypes.filter(bt => !bodyTypeOptions.includes(bt)).length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-400 mb-1">Custom body types:</div>
                          <div className="flex flex-wrap gap-1">
                            {modelPreferences.bodyTypes.filter(bt => !bodyTypeOptions.includes(bt)).map((bodyType, index) => (
                              <span
                                key={index}
                                className="px-2 py-1 bg-green-600 text-white text-xs rounded-lg flex items-center gap-1"
                              >
                                {bodyType}
                                <button
                                  onClick={() => {
                                    const newBodyTypes = modelPreferences.bodyTypes.filter(bt => bt !== bodyType)
                                    setModelPreferences({ ...modelPreferences, bodyTypes: newBodyTypes })
                                  }}
                                  className="text-green-200 hover:text-white"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Age Ranges */}
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">Age Ranges</label>
                      <div className="flex flex-wrap gap-2">
                        {ageRangeOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() => toggleArrayValue(
                              modelPreferences.ageRanges,
                              option,
                              (val) => setModelPreferences({ ...modelPreferences, ageRanges: val })
                            )}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                              ${modelPreferences.ageRanges.includes(option)
                                ? 'bg-gradient-to-r from-orange-600 to-red-600 text-white'
                                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Genders */}
                    <div>
                      <label className="block text-xs font-medium text-gray-300 mb-2">Genders</label>
                      <div className="flex flex-wrap gap-2">
                        {genderOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() => toggleArrayValue(
                              modelPreferences.genders,
                              option,
                              (val) => setModelPreferences({ ...modelPreferences, genders: val })
                            )}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                              ${modelPreferences.genders.includes(option)
                                ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white'
                                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Model Image Upload */}
                    <div className="border-t border-gray-600 pt-4">
                      <label className="block text-xs font-medium text-gray-300 mb-2">
                        Upload Model Image (Optional)
                      </label>
                      <p className="text-xs text-gray-400 mb-3">
                        Upload a specific model's image to fit the product on that model
                      </p>
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => {
                          e.preventDefault()
                          setIsDragging(false)
                          const file = e.dataTransfer.files[0]
                          if (file) {
                            handleModelImageSelect(file)
                          }
                        }}
                        onClick={() => {
                          const input = document.createElement('input')
                          input.type = 'file'
                          input.accept = 'image/*'
                          input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0]
                            if (file) {
                              handleModelImageSelect(file)
                            }
                          }
                          input.click()
                        }}
                        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all
                          ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}
                          ${modelImagePreview ? 'border-green-500' : ''}`}
                      >
                        {modelImagePreview ? (
                          <div className="space-y-2">
                            <div className="relative w-24 h-24 mx-auto group">
                              <div 
                                className="relative w-full h-full cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedImageModal(modelImagePreview)
                                }}
                              >
                                <Image
                                  src={modelImagePreview}
                                  alt="Model preview"
                                  fill
                                  className="object-cover rounded-lg hover:opacity-80 transition-opacity"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setModelImage(null)
                                    setModelImagePreview(null)
                                  }}
                                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-gray-400">Click to view/change model image</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-2xl">👤</div>
                            <p className="text-white font-medium text-sm">Drop model image or click to browse</p>
                            <p className="text-xs text-gray-400">JPG, PNG, GIF, WebP (max 10MB)</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 5: Setting/Context */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('setting')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">5. Setting/Context</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'setting')?.isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {sections.find(s => s.id === 'setting')?.isOpen && (
                  <div className="p-4 border-t border-gray-700">
                    <div className="grid grid-cols-2 gap-2">
                      {settingOptions.map((option) => (
                        <button
                          key={option}
                          onClick={() => handleSettingChange(option)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all
                            ${setting === option
                              ? 'bg-purple-600 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    {showCustomSetting && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Custom Setting Context
                        </label>
                        <input
                          type="text"
                          value={customSetting}
                          onChange={(e) => setCustomSetting(e.target.value)}
                          placeholder="Enter your custom setting context"
                          className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 6: Additional Options */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                <button
                  onClick={() => toggleSection('options')}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                >
                  <h2 className="text-base font-bold text-white">6. Additional Options</h2>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'options')?.isOpen ? 'rotate-180' : ''}`}
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
                        placeholder="e.g., Focus on texture, outdoor lighting..."
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
                disabled={generationState === 'generating' || productImages.length === 0 || !productCategory || (modelPreferences.ethnicities.length === 0 && !modelImage)}
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

