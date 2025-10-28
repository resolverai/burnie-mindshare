'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useGenerationPolling } from '@/hooks/useGenerationPolling'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'
import PlatformSelector from '@/components/web2/PlatformSelector'
import ProgressOverlay from '@/components/web2/ProgressOverlay'

interface CollapsibleSection {
  id: string
  title: string
  isOpen: boolean
}

export default function SimpleWorkflowPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { startPolling, stopPolling } = useGenerationPolling()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)
  
  // Upload state
  const [productImages, setProductImages] = useState<File[]>([])
  const [productImagePreviews, setProductImagePreviews] = useState<string[]>([])
  const [modelImage, setModelImage] = useState<File | null>(null)
  const [modelImagePreview, setModelImagePreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isModelDragging, setIsModelDragging] = useState(false)
  
  // Generation state
  const [generationState, setGenerationState] = useState<'idle' | 'generating' | 'complete'>('idle')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [generatedImageData, setGeneratedImageData] = useState<Array<{
    url: string
    originalPrompt: string
    productCategory: string
  }>>([])
  const [selectedPlatform, setSelectedPlatform] = useState<'twitter' | 'youtube' | 'instagram' | 'linkedin'>('twitter')
  const [platformTexts, setPlatformTexts] = useState<any>({})
  const [perImagePlatformTexts, setPerImagePlatformTexts] = useState<Array<any>>([])
  const [perImageMetadata, setPerImageMetadata] = useState<any>({})
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0)
  const [numVariations, setNumVariations] = useState(4) // Default to 4, will be updated for edit flow
  
  // UI state
  const [sections, setSections] = useState<CollapsibleSection[]>([
    { id: 'upload', title: '1. Upload Product Images', isOpen: true },
    { id: 'model', title: '2. Optional Model Image', isOpen: true },
    { id: 'generate', title: '3. Generate Content', isOpen: true }
  ])
  
  // Modal state
  const [modalImage, setModalImage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Handle edit flow parameters from Step 3
  useEffect(() => {
    const jobId = searchParams.get('job_id')
    const editMode = searchParams.get('edit_mode')
    const numVariations = searchParams.get('num_variations')
    
    if (jobId && editMode === 'true') {
      console.log('🔄 Edit flow detected, starting polling for job:', jobId)
      console.log('🔢 Number of variations for edit flow:', numVariations)
      setGenerationState('generating')
      setProgressPercent(0)
      setProgressMessage('Generating edit variations...')
      
      // Set the number of variations for edit flow
      if (numVariations) {
        setNumVariations(parseInt(numVariations))
      }
      
      // Start polling for the edit job
      setTimeout(() => {
        startPolling(jobId, handleProgress, handleComplete, handleError)
      }, 1000)
    }
  }, [searchParams])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isModalOpen) {
        closeModal()
      }
    }

    if (isModalOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isModalOpen])

  const toggleSection = (sectionId: string) => {
    setSections(prev => prev.map(section => 
      section.id === sectionId 
        ? { ...section, isOpen: !section.isOpen }
        : section
    ))
  }

  const handleFileSelect = (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const validFiles = fileArray.filter(file => {
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not an image file`)
        return false
      }
      return true
    })

    // Limit to 5 product images
    const newFiles = [...productImages, ...validFiles].slice(0, 5)
    setProductImages(newFiles)

    // Generate previews
    const newPreviews = newFiles.map(file => URL.createObjectURL(file))
    setProductImagePreviews(newPreviews)
  }

  const handleModelFileSelect = (files: FileList | File[]) => {
    const file = Array.from(files)[0]
    if (file && file.type.startsWith('image/')) {
      setModelImage(file)
      setModelImagePreview(URL.createObjectURL(file))
    } else {
      alert('Please select a valid image file')
    }
  }

  const removeProductImage = (index: number) => {
    const newImages = productImages.filter((_, i) => i !== index)
    const newPreviews = productImagePreviews.filter((_, i) => i !== index)
    setProductImages(newImages)
    setProductImagePreviews(newPreviews)
  }

  const removeModelImage = () => {
    setModelImage(null)
    if (modelImagePreview) {
      URL.revokeObjectURL(modelImagePreview)
    }
    setModelImagePreview(null)
  }

  const openModal = (imageUrl: string, imageIndex: number) => {
    setModalImage(imageUrl)
    setSelectedImageIndex(imageIndex)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setModalImage(null)
    setIsModalOpen(false)
  }

  const handleEditImage = (imageIndex: number) => {
    const imageData = generatedImageData[imageIndex]
    if (imageData) {
      const accountId = localStorage.getItem('burnie_web2_account_id')
      
      // Get per-image platform texts if available
      const platformTexts = perImagePlatformTexts[imageIndex] || {}
      
      const params = new URLSearchParams({
        imageUrl: imageData.url,
        originalPrompt: imageData.originalPrompt,
        productCategory: imageData.productCategory,
        accountId: accountId || '0',
        platformTexts: JSON.stringify(platformTexts)
      })
      router.push(`/web2/content-studio/fashion/simple-workflow/edit?${params.toString()}`)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    handleFileSelect(files)
  }

  const handleModelDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsModelDragging(true)
  }

  const handleModelDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsModelDragging(false)
  }

  const handleModelDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsModelDragging(false)
    const files = e.dataTransfer.files
    handleModelFileSelect(files)
  }

  const fetchPerImageMetadata = async (jobId: string) => {
    try {
      console.log(`🔍 Fetching per_image_metadata for job ${jobId}...`)
      const response = await fetch(
        (process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api') + `/web2-generated-content/job/${jobId}`
      )
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data?.per_image_metadata) {
          console.log('🔍 Fetched per_image_metadata from database:', data.data.per_image_metadata)
          setPerImageMetadata(data.data.per_image_metadata)
          
          // Convert per_image_metadata to perImagePlatformTexts array format
          const platformTextsArray: any[] = []
          Object.keys(data.data.per_image_metadata).forEach(key => {
            const imageData = data.data.per_image_metadata[key]
            if (imageData.platform_texts) {
              platformTextsArray[imageData.image_index] = imageData.platform_texts
              console.log(`📝 Added platform texts for image ${imageData.image_index}:`, imageData.platform_texts)
            }
          })
          
          console.log('🔍 Converted to perImagePlatformTexts:', platformTextsArray)
          console.log('🔍 Array length:', platformTextsArray.length)
          console.log('🔍 Array contents:', platformTextsArray.map((item, index) => ({ index, hasTwitter: !!item?.twitter, twitterText: item?.twitter?.substring(0, 50) + '...' })))
          setPerImagePlatformTexts(platformTextsArray)
        } else {
          console.log('⚠️ No per_image_metadata found in response:', data)
        }
      } else {
        console.log('❌ Failed to fetch per_image_metadata:', response.status)
      }
    } catch (error) {
      console.error('Error fetching per_image_metadata:', error)
    }
  }

  const handleProgress = async (progress: any) => {
    console.log('🔄 handleProgress called with:', progress)
    setProgressMessage(progress.progress_message || 'Generating...')
    setProgressPercent(progress.progress_percent || 0)
    
    // Fetch latest per_image_metadata from database to get updated platform texts
    if (progress.job_id) {
      console.log(`🔄 Polling update received, fetching per_image_metadata for job ${progress.job_id}`)
      await fetchPerImageMetadata(progress.job_id)
    } else {
      console.log('⚠️ No job_id in progress data, skipping per_image_metadata fetch')
    }
    
    // Update generated images progressively as they come in
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      console.log('🖼️ Progressive image update:', progress.generated_image_urls)
      setGeneratedImages(progress.generated_image_urls)
      
      // Update image data with prompts and categories
      if (progress.generated_prompts && progress.generated_prompts.length > 0) {
        const newImageData = progress.generated_image_urls.map((url: string, index: number) => ({
          url,
          originalPrompt: progress.generated_prompts[index] || '',
          productCategory: progress.product_categories && progress.product_categories[index] ? progress.product_categories[index] : 'Unknown'
        }))
        setGeneratedImageData(newImageData)
      }
    }
    
    // Update platform texts progressively - show immediately as they come in
    if (progress.twitter_text || progress.youtube_description || progress.instagram_caption || progress.linkedin_post) {
      const platformTexts: any = {}
      if (progress.twitter_text) platformTexts.twitter = progress.twitter_text
      if (progress.youtube_description) platformTexts.youtube = progress.youtube_description
      if (progress.instagram_caption) platformTexts.instagram = progress.instagram_caption
      if (progress.linkedin_post) platformTexts.linkedin = progress.linkedin_post
      
      setPlatformTexts(platformTexts)
    }
    
    // Note: Individual image platform texts are now fetched from database via fetchPerImageMetadata
  }

  const handleComplete = async (progress: any) => {
    setGenerationState('complete')
    setProgressMessage('Generation complete!')
    setProgressPercent(100)
    
    // Fetch final per_image_metadata from database
    if (progress.job_id) {
      await fetchPerImageMetadata(progress.job_id)
    }
    
    if (progress.generated_image_urls) {
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Update per-image platform texts if available (don't overwrite existing ones)
    if (progress.per_image_platform_texts && Array.isArray(progress.per_image_platform_texts)) {
      console.log('📝 Final per-image platform texts received:', progress.per_image_platform_texts)
      // Only update if we don't already have per-image texts
      setPerImagePlatformTexts(prev => {
        if (prev.length === 0 || prev.every(text => !text || Object.keys(text).length === 0)) {
          return progress.per_image_platform_texts
        }
        return prev
      })
    }
    
    // Only set global platform texts if per-image texts are not available
    // This prevents overwriting individual image texts with generic ones
    if (!progress.per_image_platform_texts || !Array.isArray(progress.per_image_platform_texts)) {
      const platformTexts: any = {}
      if (progress.twitter_text) platformTexts.twitter = progress.twitter_text
      if (progress.youtube_description) platformTexts.youtube = progress.youtube_description
      if (progress.instagram_caption) platformTexts.instagram = progress.instagram_caption
      if (progress.linkedin_post) platformTexts.linkedin = progress.linkedin_post
      
      setPlatformTexts(platformTexts)
    }
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

      // Upload model image if provided
      let modelImageUrl = null
      if (modelImage) {
        const formData = new FormData()
        formData.append('file', modelImage)
        formData.append('account_id', localStorage.getItem('burnie_web2_account_id') || '')

        const uploadResponse = await fetch(
          (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/upload-user-file',
          {
            method: 'POST',
            body: formData
          }
        )

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json()
          modelImageUrl = uploadData.s3_url
        }
      }

      // Prepare workflow inputs
      const workflowInputs = {
        productImages: productImageUrls,
        modelImage: modelImageUrl,
        numProducts: productImages.length
      }

      // Call unified generation endpoint
      const unifiedRequest = {
        account_id: parseInt(localStorage.getItem('burnie_web2_account_id') || '0'),
        content_type: 'image',
        industry: 'Fashion',
        workflow_type: 'Simple Workflow',
        theme: 'Bulk inventory processing with AI-powered styling',
        workflow_inputs: workflowInputs,
        user_uploaded_images: productImageUrls,
        model_image_url: modelImageUrl,
        user_prompt: `Generate 4 variations for each of the ${productImages.length} uploaded products with intelligent styling and model selection`,
        num_images: productImages.length * 4, // 4 variations per product
        include_logo: true,
        no_characters: false,
        human_characters_only: true,
        web3_characters: false,
        use_brand_aesthetics: true,
        viral_trends: false
      }

      console.log('🚀 Starting unified generation for Simple Workflow')
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
      console.log('🚀 Starting polling for job:', jobId)
      setTimeout(() => {
        console.log('🚀 About to call startPolling with job:', jobId)
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

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />

      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarExpanded ? 'ml-64' : 'ml-20'}`}>
        {/* Header */}
        <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <button
                  onClick={() => router.push('/web2/content-studio/fashion')}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
                <h1 className="text-3xl font-bold text-white">Simple Workflow</h1>
              </div>
              <p className="text-gray-400">
                Upload your entire inventory and get AI-generated variations for all products in one go
              </p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {generationState === 'idle' ? (
            /* Upload Screen */
            <div className="h-full overflow-y-auto px-8 py-6">
              <div className="max-w-4xl mx-auto space-y-6">
                {/* Upload Product Images */}
                <div className="bg-gray-800/50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-white">1. Upload Product Images</h2>
                    <button
                      onClick={() => toggleSection('upload')}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {sections.find(s => s.id === 'upload')?.isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  
                  {sections.find(s => s.id === 'upload')?.isOpen && (
                    <div className="space-y-4">
                      <div
                        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                          isDragging 
                            ? 'border-blue-400 bg-blue-400/10' 
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      >
                        <div className="text-6xl mb-4">📦</div>
                        <p className="text-gray-300 mb-2">Drop product images here or click to browse</p>
                        <p className="text-sm text-gray-500 mb-4">JPG, PNG, GIF, WebP (max 10MB each, up to 5 images)</p>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                        >
                          Choose Files
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                        />
                      </div>

                      {/* Product Image Previews */}
                      {productImagePreviews.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                          {productImagePreviews.map((preview, index) => (
                            <div key={index} className="relative group">
                              <div 
                                onClick={() => openModal(preview, index)}
                                className="cursor-pointer"
                              >
                                <Image
                                  src={preview}
                                  alt={`Product ${index + 1}`}
                                  width={200}
                                  height={200}
                                  className="w-full h-32 object-cover rounded-lg hover:opacity-80 transition-opacity"
                                />
                              </div>
                              <button
                                onClick={() => removeProductImage(index)}
                                className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Optional Model Image */}
                <div className="bg-gray-800/50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-white">2. Optional Model Image</h2>
                    <button
                      onClick={() => toggleSection('model')}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {sections.find(s => s.id === 'model')?.isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  
                  {sections.find(s => s.id === 'model')?.isOpen && (
                    <div className="space-y-4">
                      <div
                        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                          isModelDragging 
                            ? 'border-purple-400 bg-purple-400/10' 
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                        onDragOver={handleModelDragOver}
                        onDragLeave={handleModelDragLeave}
                        onDrop={handleModelDrop}
                      >
                        <div className="text-6xl mb-4">👤</div>
                        <p className="text-gray-300 mb-2">Drop model image here or click to browse</p>
                        <p className="text-sm text-gray-500 mb-4">JPG, PNG, GIF, WebP (max 10MB)</p>
                        <button
                          onClick={() => modelInputRef.current?.click()}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                        >
                          Choose Model Image
                        </button>
                        <input
                          ref={modelInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files && handleModelFileSelect(e.target.files)}
                        />
                      </div>

                      {/* Model Image Preview */}
                      {modelImagePreview && (
                        <div className="relative group max-w-xs">
                          <div 
                            onClick={() => openModal(modelImagePreview, -1)}
                            className="cursor-pointer"
                          >
                            <Image
                              src={modelImagePreview}
                              alt="Model"
                              width={200}
                              height={200}
                              className="w-full h-32 object-cover rounded-lg hover:opacity-80 transition-opacity"
                            />
                          </div>
                          <button
                            onClick={removeModelImage}
                            className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-400 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Generate Button */}
                <div className="bg-gray-800/50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-white">3. Generate Content</h2>
                    <button
                      onClick={() => toggleSection('generate')}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {sections.find(s => s.id === 'generate')?.isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  
                  {sections.find(s => s.id === 'generate')?.isOpen && (
                    <div className="space-y-4">
                      <div className="text-gray-300">
                        <p className="mb-2">Ready to generate {productImages.length * 4} variations for your {productImages.length} products?</p>
                        <p className="text-sm text-gray-500">
                          AI will analyze your products and create intelligent styling variations
                        </p>
                      </div>
                      
                      <button
                        onClick={handleGenerate}
                        disabled={(generationState as string) === 'generating' || productImages.length === 0}
                        className="w-full px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                      >
                        {(generationState as string) === 'generating' ? (
                          <>
                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <span>🚀 Start Simple Workflow</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Results Screen */
            <div className="h-full flex flex-col">
              {/* Platform Selector */}
              <div className="bg-gray-800/50 border-b border-gray-700/50 px-8 py-4">
                <PlatformSelector
                  platforms={['twitter', 'instagram', 'linkedin']}
                  selected={selectedPlatform}
                  onChange={(platform) => setSelectedPlatform(platform as 'twitter' | 'instagram' | 'linkedin')}
                />
              </div>

              {/* Progress Messages */}
              {generationState === 'generating' && (
                <div className="bg-gray-800/50 border-b border-gray-700/50 px-8 py-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-gray-300">{progressMessage}</span>
                    <span className="text-blue-400">{progressPercent}%</span>
                  </div>
                </div>
              )}

              {/* Results Grid */}
              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {Array.from({ length: searchParams.get('edit_mode') === 'true' ? numVariations : (productImages.length * numVariations) }, (_, index) => (
                    <div key={index} className="bg-gray-800/50 rounded-lg overflow-hidden">
                      <div className="aspect-square relative">
                        {generatedImages[index] ? (
                          <div 
                            className="w-full h-full cursor-pointer"
                            onClick={() => openModal(generatedImages[index], index)}
                          >
                            <Image
                              src={generatedImages[index]}
                              alt={`Generated image ${index + 1}`}
                              fill
                              className="object-cover hover:opacity-80 transition-opacity"
                            />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-700">
                            <div className="text-center space-y-2">
                              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                              <p className="text-sm text-gray-400">Generating...</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="p-4 space-y-3">
                        {/* Platform Text Preview for this specific image */}
                        {generatedImages[index] && (
                          <div className="bg-gray-700 rounded-lg p-3">
                            <div className="text-xs text-gray-400 mb-2">
                              {selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)} Text:
                            </div>
                            <div className="text-sm text-gray-300 line-clamp-2">
                              {(() => {
                                // Get platform text for this specific image
                                const imagePlatformTexts = perImagePlatformTexts[index]
                                
                                // Debug logging for grid
                                console.log('🔍 Grid text debug for index', index, ':', {
                                  selectedPlatform,
                                  imagePlatformTexts,
                                  globalPlatformTexts: platformTexts[selectedPlatform],
                                  perImagePlatformTextsLength: perImagePlatformTexts.length,
                                  perImagePlatformTextsArray: perImagePlatformTexts
                                })
                                
                                if (imagePlatformTexts && imagePlatformTexts[selectedPlatform]) {
                                  console.log('✅ Using per-image text for grid index', index, ':', imagePlatformTexts[selectedPlatform])
                                  return imagePlatformTexts[selectedPlatform]
                                }
                                
                                // Fall back to global platform texts
                                if (platformTexts[selectedPlatform]) {
                                  console.log('⚠️ Falling back to global text for grid index', index, ':', platformTexts[selectedPlatform])
                                  return platformTexts[selectedPlatform]
                                }
                                
                                console.log('❌ No text available for grid index', index)
                                return 'Generating text...'
                              })()}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex space-x-2">
                          <button 
                            className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            disabled={!generatedImages[index]}
                            onClick={() => handleEditImage(index)}
                          >
                            Edit
                          </button>
                          <button 
                            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                            disabled={!generatedImages[index]}
                          >
                            Post to {selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </main>
      </div>

      {/* Image Modal */}
      {isModalOpen && modalImage && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div 
            className="relative max-w-6xl max-h-[90vh] bg-gray-900 rounded-lg overflow-hidden flex"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg z-20"
            >
              ×
            </button>
            
            {/* Image Section */}
            <div className="flex-1 flex items-center justify-center p-4">
              <Image
                src={modalImage}
                alt="Full size image"
                width={600}
                height={600}
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            </div>
            
            {/* Platform Text Section */}
            {selectedImageIndex >= 0 && (
              <div className="w-80 bg-gray-800 p-6 flex flex-col">
                <h3 className="text-lg font-semibold text-white mb-4">Platform-Specific Text</h3>
                
                {/* Platform Selector */}
                <div className="flex space-x-2 mb-4">
                  {['twitter', 'instagram', 'linkedin'].map((platform) => (
                    <button
                      key={platform}
                      onClick={() => setSelectedPlatform(platform as any)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                        selectedPlatform === platform
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    </button>
                  ))}
                </div>
                
                {/* Platform Text Display */}
                <div className="flex-1">
                  <div className="bg-gray-700 rounded-lg p-4 h-48 overflow-y-auto">
                    <p className="text-gray-300 text-sm leading-relaxed">
                      {(() => {
                        const imageData = generatedImageData[selectedImageIndex]
                        if (!imageData) return 'No text available for this image'
                        
                        // Get platform text for this specific image
                        const platformKey = selectedPlatform === 'twitter' ? 'twitter' : 
                                          selectedPlatform === 'instagram' ? 'instagram' : 'linkedin'
                        
                        // Debug logging
                        console.log('🔍 Modal text debug:', {
                          selectedImageIndex,
                          selectedPlatform,
                          platformKey,
                          perImagePlatformTexts: perImagePlatformTexts[selectedImageIndex],
                          globalPlatformTexts: platformTexts[platformKey]
                        })
                        
                        // Use per-image platform texts if available, otherwise fall back to global
                        const imagePlatformTexts = perImagePlatformTexts[selectedImageIndex]
                        if (imagePlatformTexts && imagePlatformTexts[platformKey]) {
                          console.log('✅ Using per-image text for', platformKey)
                          return imagePlatformTexts[platformKey]
                        }
                        
                        // Check if this image is still being generated
                        if (generationState === 'generating' && selectedImageIndex >= generatedImages.length) {
                          console.log('🔄 Image still being generated')
                          return 'Generating text for this image...'
                        }
                        
                        // Fall back to global platform texts
                        if (platformTexts[platformKey]) {
                          console.log('⚠️ Falling back to global text for', platformKey)
                          return platformTexts[platformKey]
                        }
                        
                        console.log('❌ No text available for', platformKey)
                        return generationState === 'generating' ? 'Generating text for this image...' : 'No text available for this image'
                      })()}
                    </p>
                  </div>
                  
                  {/* Copy Text Button */}
                  <button
                    onClick={() => {
                      const text = (() => {
                        const imageData = generatedImageData[selectedImageIndex]
                        if (!imageData) return ''
                        
                        const platformKey = selectedPlatform === 'twitter' ? 'twitter' : 
                                          selectedPlatform === 'instagram' ? 'instagram' : 'linkedin'
                        
                        // Use per-image platform texts if available, otherwise fall back to global
                        const imagePlatformTexts = perImagePlatformTexts[selectedImageIndex]
                        if (imagePlatformTexts && imagePlatformTexts[platformKey]) {
                          return imagePlatformTexts[platformKey]
                        }
                        
                        // Fall back to global platform texts
                        if (platformTexts[platformKey]) {
                          return platformTexts[platformKey]
                        }
                        
                        return ''
                      })()
                      
                      if (text) {
                        navigator.clipboard.writeText(text)
                        alert('Text copied to clipboard!')
                      }
                    }}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                  >
                    Copy Text
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
