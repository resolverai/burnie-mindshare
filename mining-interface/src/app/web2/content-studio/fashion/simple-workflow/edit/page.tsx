'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import toast from 'react-hot-toast'
import Web2Sidebar from '@/components/Web2Sidebar'
import { useGenerationPolling } from '@/hooks/useGenerationPolling'

interface EditImageData {
  url: string
  originalPrompt: string
  productCategory: string
}

export default function EditWorkflowPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { startPolling, stopPolling } = useGenerationPolling()
  
  // Get edit data from URL params
  const editImageData: EditImageData = {
    url: searchParams.get('imageUrl') || '',
    originalPrompt: searchParams.get('originalPrompt') || '',
    productCategory: searchParams.get('productCategory') || ''
  }
  
  // Get account ID from URL params (passed from Step 2)
  const accountIdFromParams = searchParams.get('accountId')
  
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [generationState, setGenerationState] = useState<'idle' | 'generating' | 'complete' | 'error'>('idle')
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  
  // Modal state
  const [modalImage, setModalImage] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Edit-specific state
  const [numVariations, setNumVariations] = useState(4)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [includeBrandLogo, setIncludeBrandLogo] = useState(true)
  
  // Custom input states for "Other" options
  const [customInputs, setCustomInputs] = useState({
    ethnicities: '',
    bodyTypes: '',
    ageRanges: '',
    genders: '',
    targetOccasions: '',
    settingsContext: '',
    stylingEnhancements: '',
    colorVariations: '',
    styleVariations: '',
    stylingTransformations: '',
    seasons: '',
    campaignStyles: ''
  })
  
  // Model image handling
  const [modelImage, setModelImage] = useState<string | null>(null)
  const [modelImageFile, setModelImageFile] = useState<File | null>(null)
  const [isModelDragging, setIsModelDragging] = useState(false)
  const modelFileInputRef = useRef<HTMLInputElement>(null)
  
  // Permutation selections
  const [selectedPermutations, setSelectedPermutations] = useState({
    modelPreferences: {
      ethnicities: [] as string[],
      bodyTypes: [] as string[],
      ageRanges: [] as string[],
      genders: [] as string[]
    },
    targetOccasions: [] as string[],
    settingsContext: [] as string[],
    stylingEnhancements: [] as string[],
    colorVariations: [] as string[],
    styleVariations: [] as string[],
    productCategories: [] as string[],
    stylingTransformations: [] as string[],
    seasons: [] as string[],
    campaignStyles: [] as string[]
  })
  
  // Collapsible sections
  const [sections, setSections] = useState([
    { id: 'reference-image', title: 'Reference Image', isOpen: true },
    { id: 'model-preferences', title: 'Model Preferences', isOpen: true },
    { id: 'lifestyle-context', title: 'Lifestyle & Context', isOpen: false },
    { id: 'color-style', title: 'Color & Style', isOpen: false },
    { id: 'before-after', title: 'Before/After Styling', isOpen: false },
    { id: 'seasonal', title: 'Seasonal Campaign', isOpen: false },
    { id: 'generation-settings', title: 'Generation Settings', isOpen: true }
  ])
  
  const toggleSection = (sectionId: string) => {
    setSections(prev => prev.map(section => 
      section.id === sectionId 
        ? { ...section, isOpen: !section.isOpen }
        : section
    ))
  }
  
  // Handle model image upload
  const handleModelFileSelect = (files: FileList) => {
    if (files.length > 0) {
      const file = files[0]
      const url = URL.createObjectURL(file)
      setModelImage(url)
      setModelImageFile(file)
    }
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
  
  const removeModelImage = () => {
    setModelImage(null)
    setModelImageFile(null)
  }

  const openModal = (imageUrl: string) => {
    setModalImage(imageUrl)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setModalImage(null)
  }

  const toggleArrayValue = (array: string[], value: string, setter: (newArray: string[]) => void) => {
    if (array.includes(value)) {
      setter(array.filter(item => item !== value))
    } else {
      setter([...array, value])
    }
  }

  const handleCustomInputChange = (category: string, value: string) => {
    setCustomInputs(prev => ({
      ...prev,
      [category]: value
    }))
  }

  const addCustomValue = (category: string, customValue: string) => {
    if (!customValue.trim()) return
    
    // Handle model preferences differently
    if (['ethnicities', 'bodyTypes', 'ageRanges', 'genders'].includes(category)) {
      const currentArray = selectedPermutations.modelPreferences[category as keyof typeof selectedPermutations.modelPreferences] as string[]
      const newArray = [...currentArray, customValue.trim()]
      
      setSelectedPermutations(prev => ({
        ...prev,
        modelPreferences: {
          ...prev.modelPreferences,
          [category]: newArray
        }
      }))
    } else {
      // Handle other categories
      const categoryKey = category as keyof typeof selectedPermutations
      const currentArray = selectedPermutations[categoryKey] as string[]
      const newArray = [...currentArray, customValue.trim()]
      
      setSelectedPermutations(prev => ({
        ...prev,
        [categoryKey]: newArray
      }))
    }
    
    // Clear the custom input
    setCustomInputs(prev => ({
      ...prev,
      [category]: ''
    }))
  }

  // Helper function to render model preference options (consistent with lifestyle options)
  const renderModelPreferenceOptions = (category: string, options: string[], selectedArray: string[]) => {
    const customValue = customInputs[category as keyof typeof customInputs]
    
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => handleModelPreferenceChange(category, option, selectedArray.includes(option) ? false : true)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                ${selectedArray.includes(option)
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => handleCustomInputChange(category, e.target.value)}
            placeholder={`Enter custom ${category.replace(/([A-Z])/g, ' $1').toLowerCase()}`}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => addCustomValue(category, customValue)}
            disabled={!customValue.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Custom
          </button>
        </div>
        {/* Display selected custom values */}
        {selectedArray.filter(item => !options.includes(item)).length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-gray-400 mb-1">Custom {category.replace(/([A-Z])/g, ' $1').toLowerCase()}:</div>
            <div className="flex flex-wrap gap-1">
              {selectedArray.filter(item => !options.includes(item)).map((item, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg flex items-center gap-1"
                >
                  {item}
                  <button
                    onClick={() => {
                      const newArray = selectedArray.filter(i => i !== item)
                      if (category === 'ethnicities') {
                        setSelectedPermutations(prev => ({ ...prev, modelPreferences: { ...prev.modelPreferences, ethnicities: newArray } }))
                      } else if (category === 'bodyTypes') {
                        setSelectedPermutations(prev => ({ ...prev, modelPreferences: { ...prev.modelPreferences, bodyTypes: newArray } }))
                      } else if (category === 'ageRanges') {
                        setSelectedPermutations(prev => ({ ...prev, modelPreferences: { ...prev.modelPreferences, ageRanges: newArray } }))
                      } else if (category === 'genders') {
                        setSelectedPermutations(prev => ({ ...prev, modelPreferences: { ...prev.modelPreferences, genders: newArray } }))
                      }
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
    )
  }

  // Helper function to render lifestyle/context options (like Lifestyle & Context workflow)
  const renderLifestyleOptions = (category: string, options: string[], selectedArray: string[]) => {
    const customValue = customInputs[category as keyof typeof customInputs]
    
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              onClick={() => handlePermutationChange(category, option, selectedArray.includes(option) ? false : true)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                ${selectedArray.includes(option)
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => handleCustomInputChange(category, e.target.value)}
            placeholder={`Enter custom ${category.replace(/([A-Z])/g, ' $1').toLowerCase()}`}
            className="flex-1 bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => addCustomValue(category, customValue)}
            disabled={!customValue.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Custom
          </button>
        </div>
        {/* Display selected custom values */}
        {selectedArray.filter(item => !options.includes(item)).length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-gray-400 mb-1">Custom {category.replace(/([A-Z])/g, ' $1').toLowerCase()}:</div>
            <div className="flex flex-wrap gap-1">
              {selectedArray.filter(item => !options.includes(item)).map((item, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg flex items-center gap-1"
                >
                  {item}
                  <button
                    onClick={() => {
                      const newArray = selectedArray.filter(i => i !== item)
                      handlePermutationChange(category, item, false)
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
    )
  }
  
  // Handle permutation changes
  const handlePermutationChange = (category: string, value: string, checked: boolean) => {
    setSelectedPermutations(prev => {
      const newState = { ...prev }
      if (category === 'modelPreferences') {
        // Handle model preferences separately
        return newState
      } else {
        const currentValues = newState[category as keyof typeof newState] as string[]
        if (checked) {
          (newState[category as keyof typeof newState] as string[]) = [...currentValues, value]
        } else {
          (newState[category as keyof typeof newState] as string[]) = currentValues.filter(v => v !== value)
        }
      }
      return newState
    })
  }
  
  const handleModelPreferenceChange = (preferenceType: string, value: string, checked: boolean) => {
    setSelectedPermutations(prev => ({
      ...prev,
      modelPreferences: {
        ...prev.modelPreferences,
        [preferenceType]: checked 
          ? [...prev.modelPreferences[preferenceType as keyof typeof prev.modelPreferences], value]
          : prev.modelPreferences[preferenceType as keyof typeof prev.modelPreferences].filter(v => v !== value)
      }
    }))
  }
  
  // Handle generation
  const handleGenerate = async () => {
    if (!editImageData.url) {
      toast.error('No reference image available')
      return
    }
    
    setGenerationState('generating')
    setProgressPercent(0)
    setProgressMessage('Starting edit generation...')
    
    try {
      // Upload model image if provided
      let modelImageUrl = null
      if (modelImageFile) {
        const formData = new FormData()
        formData.append('file', modelImageFile)
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
      
      // Get account ID with validation (prefer URL param over localStorage)
      const accountId = accountIdFromParams || localStorage.getItem('burnie_web2_account_id')
      if (!accountId || accountId === 'null' || accountId === 'undefined' || accountId === '0') {
        toast.error('Account ID not found. Please log in again.')
        return
      }
      
      // Prepare edit request
      const editRequest = {
        account_id: parseInt(accountId),
        content_type: 'image',
        industry: 'Fashion',
        workflow_type: 'Edit Flow',
        theme: 'Image refinement with permutation-based styling',
        original_prompt: editImageData.originalPrompt,
        product_category: editImageData.productCategory,
        reference_image_url: editImageData.url,
        num_variations: numVariations,
        additional_instructions: additionalInstructions,
        model_image_url: modelImageUrl,
        include_logo: includeBrandLogo,
        no_characters: false,
        human_characters_only: true,
        web3_characters: false,
        use_brand_aesthetics: true,
        viral_trends: false,
        // image_model will be fetched from account_configurations
        aspect_ratio: '1:1',
        // Permutation selections - flatten model_preferences
        model_preferences: {
          ethnicities: selectedPermutations.modelPreferences.ethnicities,
          bodyTypes: selectedPermutations.modelPreferences.bodyTypes,
          ageRanges: selectedPermutations.modelPreferences.ageRanges,
          genders: selectedPermutations.modelPreferences.genders
        },
        target_occasions: selectedPermutations.targetOccasions,
        settings_context: selectedPermutations.settingsContext,
        styling_enhancements: selectedPermutations.stylingEnhancements,
        color_variations: selectedPermutations.colorVariations,
        style_variations: selectedPermutations.styleVariations,
        product_categories: selectedPermutations.productCategories,
        styling_transformations: selectedPermutations.stylingTransformations,
        seasons: selectedPermutations.seasons,
        campaign_styles: selectedPermutations.campaignStyles
      }
      
      console.log('🚀 Starting edit generation:', editRequest)
      
      const response = await fetch(
        (process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000') + '/api/web2/unified-generation-edit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(editRequest)
        }
      )
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to start edit generation')
      }
      
      const responseData = await response.json()
      console.log('✅ Edit generation started:', responseData)
      
      if (responseData.job_id) {
        // Navigate back to Step 2 with the new job ID for polling
        router.push(`/web2/content-studio/fashion/simple-workflow?job_id=${responseData.job_id}&edit_mode=true`)
      } else {
        throw new Error('Job ID not received from backend')
      }
      
    } catch (error: any) {
      console.error('Edit generation error:', error)
      setGenerationState('error')
      setProgressMessage(`Error: ${error.message}`)
      toast.error(`Edit generation failed: ${error.message}`)
    }
  }
  
  // Handle progress updates
  const handleProgress = (progress: any) => {
    setProgressMessage(progress.progress_message || 'Generating...')
    setProgressPercent(progress.progress_percent || 0)
  }
  
  const handleComplete = (progress: any) => {
    setGenerationState('complete')
    setProgressMessage('Edit generation complete!')
    setProgressPercent(100)
    toast.success('Edit generation completed!')
    
    // Navigate back to Step 2 with new images
    setTimeout(() => {
      router.push('/web2/content-studio/fashion/simple-workflow')
    }, 2000)
  }
  
  const handleError = (error: string) => {
    setGenerationState('error')
    setProgressMessage(`Error: ${error}`)
    setProgressPercent(0)
    toast.error(`Edit generation failed: ${error}`)
  }
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])
  
  const isGenerateButtonDisabled = generationState === 'generating' || !editImageData.url
  
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
                  onClick={() => router.push('/web2/content-studio/fashion/simple-workflow')}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ← Back to Results
                </button>
                <h1 className="text-3xl font-bold text-white">Edit Image</h1>
              </div>
              <p className="text-gray-400">
                Refine your generated image with new permutations and styling options
              </p>
            </div>
          </div>
        </header>
        
        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {generationState === 'idle' || generationState === 'error' ? (
            /* Edit Screen */
            <div className="h-full overflow-y-auto px-8 py-6">
              <div className="max-w-4xl mx-auto space-y-3">
                
                {/* Reference Image */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('reference-image')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">1. Reference Image</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'reference-image')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'reference-image')?.isOpen && (
                    <div className="p-4 border-t border-gray-700">
                      <div className="space-y-4">
                        <div className="relative w-32 h-32 rounded-lg overflow-hidden cursor-pointer group mx-auto" onClick={() => openModal(editImageData.url)}>
                          <Image
                            src={editImageData.url}
                            alt="Reference image for editing"
                            fill
                            className="object-cover hover:opacity-80 transition-opacity"
                          />
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm font-medium">
                              Click to view
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-gray-400 text-center">
                          <p><strong>Product Category:</strong> {editImageData.productCategory}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Model Preferences & Image */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('model-preferences')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">2. Model Preferences</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'model-preferences')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'model-preferences')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      {/* Model Image Upload */}
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Upload Model Image (Optional)
                        </label>
                        <p className="text-xs text-gray-400 mb-3">
                          Upload a specific model's image to fit the product on that model
                        </p>
                        <div
                          onDragOver={handleModelDragOver}
                          onDragLeave={handleModelDragLeave}
                          onDrop={handleModelDrop}
                          onClick={() => modelFileInputRef.current?.click()}
                          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
                            ${isModelDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'}
                            ${modelImage ? 'border-green-500' : ''}`}
                        >
                          {modelImage ? (
                            <div className="space-y-3">
                              <div className="relative w-24 h-24 mx-auto rounded-lg overflow-hidden group">
                                <Image
                                  src={modelImage}
                                  alt="Model preview"
                                  fill
                                  className="object-cover"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    removeModelImage()
                                  }}
                                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  ×
                                </button>
                              </div>
                              <p className="text-xs text-gray-400">Click to change model image</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="text-4xl">👤</div>
                              <div>
                                <p className="text-white font-medium mb-1 text-sm">Drop model image or click to browse</p>
                                <p className="text-xs text-gray-400">JPG, PNG, GIF, WebP (max 10MB)</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <input
                          ref={modelFileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => e.target.files && handleModelFileSelect(e.target.files)}
                          className="hidden"
                        />
                      </div>

                      {/* Model Preferences */}
                      <div className="border-t border-gray-600 pt-4">
                        <div className="space-y-4">
                          {/* Ethnicities */}
                          <div>
                            <label className="block text-xs font-medium text-gray-300 mb-2">
                              Ethnicities
                            </label>
                            {renderModelPreferenceOptions('ethnicities', ['Asian', 'Black', 'Hispanic', 'White', 'Middle Eastern', 'Mixed'], selectedPermutations.modelPreferences.ethnicities)}
                          </div>
                          
                          {/* Body Types */}
                          <div>
                            <label className="block text-xs font-medium text-gray-300 mb-2">
                              Body Types
                            </label>
                            {renderModelPreferenceOptions('bodyTypes', ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus Size'], selectedPermutations.modelPreferences.bodyTypes)}
                          </div>
                          
                          {/* Age Ranges */}
                          <div>
                            <label className="block text-xs font-medium text-gray-300 mb-2">
                              Age Ranges
                            </label>
                            {renderModelPreferenceOptions('ageRanges', ['18-25', '26-35', '36-45', '46-55', '55+'], selectedPermutations.modelPreferences.ageRanges)}
                          </div>
                          
                          {/* Genders */}
                          <div>
                            <label className="block text-xs font-medium text-gray-300 mb-2">
                              Genders
                            </label>
                            {renderModelPreferenceOptions('genders', ['Male', 'Female', 'Non-binary'], selectedPermutations.modelPreferences.genders)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                

                {/* Lifestyle & Context Permutations */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('lifestyle-context')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">3. Lifestyle & Context</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'lifestyle-context')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'lifestyle-context')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Target Occasions
                        </label>
                        {renderLifestyleOptions('targetOccasions', ['Casual', 'Professional', 'Date Night', 'Party', 'Travel', 'Workout', 'Formal'], selectedPermutations.targetOccasions)}
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Settings/Context
                        </label>
                        {renderLifestyleOptions('settingsContext', ['Urban Street', 'Coffee Shop', 'Office', 'Park', 'Beach', 'Studio', 'Home'], selectedPermutations.settingsContext)}
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Styling Enhancements
                        </label>
                        {renderLifestyleOptions('stylingEnhancements', ['Layering', 'Accessories', 'Color Coordination', 'Texture Mix', 'Pattern Play', 'Minimalist', 'Bold Statement'], selectedPermutations.stylingEnhancements)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Color & Style Permutations */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('color-style')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">4. Color & Style</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'color-style')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'color-style')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Color Variations
                        </label>
                        {renderLifestyleOptions('colorVariations', ['Neutral', 'Bold', 'Pastel', 'Earth Tones', 'Bright', 'Monochrome', 'Complementary'], selectedPermutations.colorVariations)}
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Style Variations
                        </label>
                        {renderLifestyleOptions('styleVariations', ['Classic', 'Trendy', 'Vintage', 'Modern', 'Bohemian', 'Preppy', 'Edgy'], selectedPermutations.styleVariations)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Before/After Styling Permutations */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('before-after')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">5. Before/After Styling</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'before-after')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'before-after')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Styling Transformations
                        </label>
                        {renderLifestyleOptions('stylingTransformations', ['Casual to Formal', 'Day to Night', 'Simple to Glam', 'Basic to Statement', 'Minimal to Maximal'], selectedPermutations.stylingTransformations)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Seasonal Campaign Permutations */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('seasonal')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">6. Seasonal Campaign</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'seasonal')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'seasonal')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Seasons
                        </label>
                        {renderLifestyleOptions('seasons', ['Spring', 'Summer', 'Fall', 'Winter', 'All Season'], selectedPermutations.seasons)}
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Campaign Styles
                        </label>
                        {renderLifestyleOptions('campaignStyles', ['Luxury', 'Streetwear', 'Minimalist', 'Bohemian', 'Athletic', 'Vintage', 'Contemporary'], selectedPermutations.campaignStyles)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Generation Settings */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg border border-gray-700/50">
                  <button
                    onClick={() => toggleSection('generation-settings')}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/30 transition-colors rounded-lg"
                  >
                    <h2 className="text-base font-bold text-white">7. Generation Settings</h2>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform ${sections.find(s => s.id === 'generation-settings')?.isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {sections.find(s => s.id === 'generation-settings')?.isOpen && (
                    <div className="p-4 border-t border-gray-700 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Number of Variations
                        </label>
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
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-2">
                          Additional Instructions
                        </label>
                        <textarea
                          placeholder="e.g., 'Make it more vibrant and energetic', 'Focus on close-ups of the product details'"
                          value={additionalInstructions}
                          onChange={(e) => setAdditionalInstructions(e.target.value)}
                          className="w-full h-20 bg-gray-700/50 border border-gray-600 rounded-lg p-3 text-sm text-white placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="include-logo"
                          checked={includeBrandLogo}
                          onChange={(e) => setIncludeBrandLogo(e.target.checked)}
                          className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="include-logo" className="text-sm text-gray-300">
                          Include Brand Logo (AI will intelligently embed)
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  className="w-full py-3 text-lg font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isGenerateButtonDisabled}
                >
                  {(generationState as string) === 'generating' ? (
                    <>
                      <div className="mr-2 h-5 w-5 animate-spin inline border-2 border-white border-t-transparent rounded-full" />
                      Generating Edit Variations...
                    </>
                  ) : (
                    'Generate Edit Variations'
                  )}
                </button>
                
                {generationState === 'error' && (
                  <div className="bg-red-900/30 border border-red-700 text-red-300 p-4 rounded-lg">
                    <p>{progressMessage}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Progress Screen */
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <h2 className="text-2xl font-semibold text-white">Generating Edit Variations</h2>
                <p className="text-gray-400">{progressMessage}</p>
                <div className="w-64 bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500">{progressPercent}%</p>
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
            className="relative max-w-4xl max-h-[90vh] bg-gray-900 rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 w-8 h-8 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-lg z-20"
            >
              ×
            </button>
            <div className="relative w-full h-full">
              <Image
                src={modalImage}
                alt="Full size image"
                width={800}
                height={600}
                className="object-contain max-w-full max-h-[90vh]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
