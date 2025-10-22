'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { 
  SwatchIcon, 
  PhotoIcon, 
  DocumentTextIcon,
  LinkIcon,
  PlusIcon,
  TrashIcon,
  CloudArrowUpIcon,
  XMarkIcon,
  CheckIcon
} from '@heroicons/react/24/outline'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface FileData {
  filename: string
  s3_url: string
  s3_key?: string
  presigned_url?: string
  file_type?: string
  uploaded_at?: string
  extracted_text?: string
}

interface ContextData {
  id?: number
  account_id: number
  // Brand Assets
  brand_logo_url?: string
  brand_logo_url_presigned?: string
  brand_colors?: {
    primary?: string
    secondary?: string
    additional?: string[]
  }
  brand_voice?: string
  brand_guidelines_pdf_url?: string
  brand_guidelines_pdf_url_presigned?: string
  brand_assets_files?: FileData[]
  
  // Visual References
  product_photos?: FileData[]
  inspiration_images?: FileData[]
  past_content_images?: FileData[]
  generic_visuals?: FileData[]
  
  // Text & Content
  brand_story?: string
  key_messages?: string
  target_audience?: string
  dos_and_donts?: string
  custom_text?: string
  
  // Platform Handles
  twitter_handle?: string
  linkedin_url?: string
  youtube_url?: string
  instagram_handle?: string
  additional_reference_urls?: string[]
  
  // Extracted text context
  extra_context?: string
}

export default function ContextPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('brand')
  const [contextData, setContextData] = useState<ContextData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [accountId, setAccountId] = useState<number | null>(null)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)

  // Form state - Brand Assets
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [primaryColor, setPrimaryColor] = useState('')
  const [secondaryColor, setSecondaryColor] = useState('')
  const [additionalColors, setAdditionalColors] = useState<string[]>([])
  const [brandVoice, setBrandVoice] = useState('')
  const [guidelinesPdfFile, setGuidelinesPdfFile] = useState<File | null>(null)
  const [genericBrandFiles, setGenericBrandFiles] = useState<File[]>([])
  
  // Form state - Visual References
  const [productPhotoFiles, setProductPhotoFiles] = useState<File[]>([])
  const [inspirationFiles, setInspirationFiles] = useState<File[]>([])
  const [pastContentFiles, setPastContentFiles] = useState<File[]>([])
  const [genericVisualFiles, setGenericVisualFiles] = useState<File[]>([])
  
  // Form state - Text & Content
  const [brandStory, setBrandStory] = useState('')
  const [keyMessages, setKeyMessages] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [dosAndDonts, setDosAndDonts] = useState('')
  const [customText, setCustomText] = useState('')
  
  // Form state - Platform Handles
  const [twitterHandle, setTwitterHandle] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [instagramHandle, setInstagramHandle] = useState('')
  const [referenceUrls, setReferenceUrls] = useState<string[]>([''])

  const tabs = [
    { id: 'brand', label: 'Brand Assets', icon: SwatchIcon },
    { id: 'visual', label: 'Visual References', icon: PhotoIcon },
    { id: 'content', label: 'Text & Content', icon: DocumentTextIcon },
    { id: 'platforms', label: 'Platform Handles', icon: LinkIcon }
  ]

  useEffect(() => {
    // Check authentication
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const storedAccountId = localStorage.getItem('burnie_web2_account_id')
    
    if (!web2Auth || !storedAccountId) {
      router.push('/web2/auth')
      return
    }
    
    setAccountId(parseInt(storedAccountId, 10))
    fetchContextData(parseInt(storedAccountId, 10))
  }, [router])

  const fetchContextData = async (accId: number) => {
    setIsLoading(true)
    try {
      const response = await fetch(API_BASE + '/api/web2-context/' + accId)
      const result = await response.json()
      
      if (result.success && result.data) {
        const data = result.data
        setContextData(data)
        
        // Pre-fill form fields
        setPrimaryColor(data.brand_colors?.primary || '')
        setSecondaryColor(data.brand_colors?.secondary || '')
        setAdditionalColors(data.brand_colors?.additional || [])
        setBrandVoice(data.brand_voice || '')
        setBrandStory(data.brand_story || '')
        setKeyMessages(data.key_messages || '')
        setTargetAudience(data.target_audience || '')
        setDosAndDonts(data.dos_and_donts || '')
        setCustomText(data.custom_text || '')
        setTwitterHandle(data.twitter_handle || '')
        setLinkedinUrl(data.linkedin_url || '')
        setYoutubeUrl(data.youtube_url || '')
        setInstagramHandle(data.instagram_handle || '')
        setReferenceUrls(data.additional_reference_urls || [''])
      }
    } catch (error) {
      console.error('Failed to fetch context:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const uploadFile = async (file: File, tab: string): Promise<FileData | null> => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tab', tab)
      
      const response = await fetch(API_BASE + '/api/web2-context/' + accountId + '/upload-file', {
        method: 'POST',
        body: formData
      })
      
      const result = await response.json()
      if (result.success) {
        return result.data
      }
      return null
    } catch (error) {
      console.error('File upload failed:', error)
      return null
    }
  }

  const saveAllChanges = async () => {
    if (!accountId) return
    
    setIsSaving(true)
    setSaveStatus('saving')
    
    try {
      // Upload all new files first
      const newExtractedTexts: string[] = []
      
      // Upload brand assets files
      let logoUrl = contextData?.brand_logo_url
      if (logoFile) {
        const uploaded = await uploadFile(logoFile, 'brand_assets')
        if (uploaded) {
          logoUrl = uploaded.s3_url
          if (uploaded.extracted_text) newExtractedTexts.push(uploaded.extracted_text)
        }
      }
      
      let guidelinesUrl = contextData?.brand_guidelines_pdf_url
      if (guidelinesPdfFile) {
        const uploaded = await uploadFile(guidelinesPdfFile, 'brand_assets')
        if (uploaded) {
          guidelinesUrl = uploaded.s3_url
          if (uploaded.extracted_text) newExtractedTexts.push(uploaded.extracted_text)
        }
      }
      
      const brandAssetsFiles = contextData?.brand_assets_files || []
      for (const file of genericBrandFiles) {
        const uploaded = await uploadFile(file, 'brand_assets')
        if (uploaded) {
          brandAssetsFiles.push(uploaded)
          if (uploaded.extracted_text) newExtractedTexts.push(uploaded.extracted_text)
        }
      }
      
      // Upload visual references (no text extraction for images)
      const productPhotos = contextData?.product_photos || []
      for (const file of productPhotoFiles) {
        const uploaded = await uploadFile(file, 'visual_references')
        if (uploaded) productPhotos.push(uploaded)
      }
      
      const inspirationImages = contextData?.inspiration_images || []
      for (const file of inspirationFiles) {
        const uploaded = await uploadFile(file, 'visual_references')
        if (uploaded) inspirationImages.push(uploaded)
      }
      
      const pastContentImages = contextData?.past_content_images || []
      for (const file of pastContentFiles) {
        const uploaded = await uploadFile(file, 'visual_references')
        if (uploaded) pastContentImages.push(uploaded)
      }
      
      const genericVisuals = contextData?.generic_visuals || []
      for (const file of genericVisualFiles) {
        const uploaded = await uploadFile(file, 'visual_references')
        if (uploaded) genericVisuals.push(uploaded)
      }
      
      // Build data object to save
      const dataToSave: any = {
        brand_logo_url: logoUrl,
        brand_colors: {
          primary: primaryColor,
          secondary: secondaryColor,
          additional: additionalColors.filter(c => c.trim() !== '')
        },
        brand_voice: brandVoice,
        brand_guidelines_pdf_url: guidelinesUrl,
        brand_assets_files: brandAssetsFiles,
        product_photos: productPhotos,
        inspiration_images: inspirationImages,
        past_content_images: pastContentImages,
        generic_visuals: genericVisuals,
        brand_story: brandStory,
        key_messages: keyMessages,
        target_audience: targetAudience,
        dos_and_donts: dosAndDonts,
        custom_text: customText,
        twitter_handle: twitterHandle,
        linkedin_url: linkedinUrl,
        youtube_url: youtubeUrl,
        instagram_handle: instagramHandle,
        additional_reference_urls: referenceUrls.filter(u => u.trim() !== ''),
        new_extracted_texts: newExtractedTexts
      }
      
      // Save to backend
      const response = await fetch(API_BASE + '/api/web2-context/' + accountId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataToSave)
      })
      
      const result = await response.json()
      
      console.log('Save response:', result)
      
      if (result.success) {
        setSaveStatus('saved')
        
        // Update context data without full page reload
        setContextData(result.data)
        
        // Clear file inputs
        setLogoFile(null)
        setGuidelinesPdfFile(null)
        setGenericBrandFiles([])
        setProductPhotoFiles([])
        setInspirationFiles([])
        setPastContentFiles([])
        setGenericVisualFiles([])
        
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        console.error('Save failed:', result.error || 'Unknown error')
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
      }
    } catch (error) {
      console.error('Failed to save:', error)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } finally {
      setIsSaving(false)
    }
  }

  const deleteFile = async (s3Key: string, field: string) => {
    if (!accountId || !confirm('Are you sure you want to delete this file?')) return
    
    try {
      await fetch(API_BASE + '/api/web2-context/' + accountId + '/files', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ s3Key, field })
      })
      
      // Refresh data
      fetchContextData(accountId)
    } catch (error) {
      console.error('Failed to delete file:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <div className="text-white">Loading context...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-white">Context Management</h1>
            <p className="text-sm text-gray-400">Add context to improve content generation across all workflows</p>
          </div>
          
          <button
            onClick={saveAllChanges}
            disabled={isSaving}
            className={'px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-all flex items-center space-x-2 ' + (isSaving ? 'opacity-50 cursor-not-allowed' : '')}
          >
            {saveStatus === 'saving' && <span>Saving...</span>}
            {saveStatus === 'saved' && (
              <>
                <CheckIcon className="w-5 h-5" />
                <span>Saved!</span>
              </>
            )}
            {saveStatus === 'idle' && <span>Save All Changes</span>}
            {saveStatus === 'error' && <span>Error - Try Again</span>}
          </button>
        </header>

        {/* Tabs */}
        <div className="bg-gray-800/50 border-b border-gray-700 px-6 flex space-x-1 flex-shrink-0">
          {tabs.map((tab) => {
            const IconComponent = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={'px-4 py-3 flex items-center space-x-2 border-b-2 transition-colors ' + (activeTab === tab.id ? 'border-orange-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-300')}
              >
                <IconComponent className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Brand Assets Tab */}
            {activeTab === 'brand' && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Brand Logo */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <SwatchIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Brand Logo</h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">Upload your primary logo (PNG with transparency recommended)</p>
                    
                    {contextData?.brand_logo_url_presigned && !logoFile && (
                      <div className="mb-4">
                        <img src={contextData.brand_logo_url_presigned} alt="Logo" className="max-h-32 mb-2" />
                        <button
                          onClick={() => contextData.brand_logo_url && deleteFile(contextData.brand_logo_url, 'brand_logo_url')}
                          className="text-sm text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    
                    <label className="block">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                      />
                      <div 
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const file = e.dataTransfer.files?.[0]
                          if (file && file.type.startsWith('image/')) {
                            setLogoFile(file)
                          }
                        }}
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm">{logoFile ? logoFile.name : 'Click or drag & drop to upload'}</span>
                      </div>
                    </label>
                  </div>

                  {/* Brand Colors */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <SwatchIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Brand Colors</h3>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">Primary Color</label>
                        <div className="flex space-x-2">
                          <input
                            type="color"
                            value={primaryColor || '#000000'}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            className="w-12 h-10 rounded cursor-pointer bg-gray-700 border border-gray-600"
                          />
                          <input
                            type="text"
                            value={primaryColor}
                            onChange={(e) => setPrimaryColor(e.target.value)}
                            placeholder="#000000 or rgb(0,0,0)"
                            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">Secondary Color</label>
                        <div className="flex space-x-2">
                          <input
                            type="color"
                            value={secondaryColor || '#ffffff'}
                            onChange={(e) => setSecondaryColor(e.target.value)}
                            className="w-12 h-10 rounded cursor-pointer bg-gray-700 border border-gray-600"
                          />
                          <input
                            type="text"
                            value={secondaryColor}
                            onChange={(e) => setSecondaryColor(e.target.value)}
                            placeholder="#000000 or rgb(0,0,0)"
                            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                          />
                        </div>
                      </div>
                      
                      <button
                        onClick={() => setAdditionalColors([...additionalColors, ''])}
                        className="text-sm text-orange-400 hover:text-orange-300"
                      >
                        + Add More Colors
                      </button>
                      
                      {additionalColors.map((color, idx) => (
                        <div key={idx} className="flex space-x-2">
                          <input
                            type="color"
                            value={color || '#000000'}
                            onChange={(e) => {
                              const newColors = [...additionalColors]
                              newColors[idx] = e.target.value
                              setAdditionalColors(newColors)
                            }}
                            className="w-12 h-10 rounded cursor-pointer bg-gray-700 border border-gray-600"
                          />
                          <input
                            type="text"
                            value={color}
                            onChange={(e) => {
                              const newColors = [...additionalColors]
                              newColors[idx] = e.target.value
                              setAdditionalColors(newColors)
                            }}
                            placeholder="#000000 or rgb(0,0,0)"
                            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                          />
                          <button
                            onClick={() => setAdditionalColors(additionalColors.filter((_, i) => i !== idx))}
                            className="p-2 text-red-400 hover:text-red-300"
                          >
                            <XMarkIcon className="w-5 h-5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Brand Voice */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Brand Voice</h3>
                    </div>
                    <textarea
                      value={brandVoice}
                      onChange={(e) => setBrandVoice(e.target.value)}
                      placeholder="Describe your brand voice (e.g., professional, friendly, casual, authoritative)..."
                      className="w-full h-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  {/* Brand Guidelines PDF */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Brand Guidelines PDF</h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">Upload your brand style guide or guidelines document</p>
                    
                    {contextData?.brand_guidelines_pdf_url_presigned && !guidelinesPdfFile && (
                      <div className="mb-4">
                        <a href={contextData.brand_guidelines_pdf_url_presigned} target="_blank" className="text-orange-400 hover:text-orange-300 text-sm">
                          View Current PDF
                        </a>
                        <button
                          onClick={() => contextData.brand_guidelines_pdf_url && deleteFile(contextData.brand_guidelines_pdf_url, 'brand_guidelines_pdf_url')}
                          className="ml-4 text-sm text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    
                    <label className="block">
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => setGuidelinesPdfFile(e.target.files?.[0] || null)}
                      />
                      <div 
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const file = e.dataTransfer.files?.[0]
                          if (file && file.type === 'application/pdf') {
                            setGuidelinesPdfFile(file)
                          }
                        }}
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm">{guidelinesPdfFile ? guidelinesPdfFile.name : 'Click or drag & drop PDF'}</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Generic Document Upload */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Additional Documents</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Upload any additional brand documents (PDF, DOCX, CSV, TXT). Text will be extracted and used as context.</p>
                  
                  {/* Show uploaded files */}
                  {contextData?.brand_assets_files && contextData.brand_assets_files.length > 0 && (
                    <div className="mb-4 space-y-2">
                      {contextData.brand_assets_files.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                          <span className="text-sm text-white">{file.filename}</span>
                          <button
                            onClick={() => file.s3_key && deleteFile(file.s3_key, 'brand_assets_files')}
                            className="text-red-400 hover:text-red-300"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <label className="block">
                    <input
                      type="file"
                      accept=".pdf,.docx,.csv,.txt"
                      multiple
                      className="hidden"
                      onChange={(e) => setGenericBrandFiles([...genericBrandFiles, ...Array.from(e.target.files || [])])}
                    />
                    <div 
                      className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const files = Array.from(e.dataTransfer.files)
                        const validFiles = files.filter(file => 
                          file.name.endsWith('.pdf') || 
                          file.name.endsWith('.docx') || 
                          file.name.endsWith('.csv') || 
                          file.name.endsWith('.txt')
                        )
                        if (validFiles.length > 0) {
                          setGenericBrandFiles([...genericBrandFiles, ...validFiles])
                        }
                      }}
                    >
                      <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <span className="text-sm">{genericBrandFiles.length > 0 ? genericBrandFiles.length + ' file(s) selected' : 'Click or drag & drop documents'}</span>
                    </div>
                  </label>
                </div>
              </>
            )}

            {/* Visual References Tab */}
            {activeTab === 'visual' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Product Photos */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <PhotoIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Product Photos</h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">Upload product images for reference</p>
                    
                    <label className="block">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => setProductPhotoFiles([...productPhotoFiles, ...Array.from(e.target.files || [])])}
                      />
                      <div 
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                          if (files.length > 0) setProductPhotoFiles([...productPhotoFiles, ...files])
                        }}
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm">{productPhotoFiles.length > 0 ? productPhotoFiles.length + ' selected' : 'Click or drag & drop images'}</span>
                      </div>
                    </label>
                  </div>

                  {/* Inspiration */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <PhotoIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Inspiration</h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">Add mood board or style references</p>
                    
                    <label className="block">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => setInspirationFiles([...inspirationFiles, ...Array.from(e.target.files || [])])}
                      />
                      <div 
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                          if (files.length > 0) setInspirationFiles([...inspirationFiles, ...files])
                        }}
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm">{inspirationFiles.length > 0 ? inspirationFiles.length + ' selected' : 'Click or drag & drop images'}</span>
                      </div>
                    </label>
                  </div>

                  {/* Past Content */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <PhotoIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Past Content</h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">Examples of your best content</p>
                    
                    <label className="block">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => setPastContentFiles([...pastContentFiles, ...Array.from(e.target.files || [])])}
                      />
                      <div 
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                          if (files.length > 0) setPastContentFiles([...pastContentFiles, ...files])
                        }}
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm">{pastContentFiles.length > 0 ? pastContentFiles.length + ' selected' : 'Click or drag & drop images'}</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Generic Visuals */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <PhotoIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Other Visual References</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Upload any other visual references</p>
                  
                  <label className="block">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => setGenericVisualFiles([...genericVisualFiles, ...Array.from(e.target.files || [])])}
                    />
                    <div 
                      className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors border-2 border-dashed border-gray-600"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                        if (files.length > 0) setGenericVisualFiles([...genericVisualFiles, ...files])
                      }}
                    >
                      <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <span className="text-sm">{genericVisualFiles.length > 0 ? genericVisualFiles.length + ' selected' : 'Click or drag & drop images'}</span>
                    </div>
                  </label>
                </div>

                {/* Grouped Gallery for All Visual References */}
                {(contextData?.product_photos && contextData.product_photos.length > 0) ||
                 (contextData?.inspiration_images && contextData.inspiration_images.length > 0) ||
                 (contextData?.past_content_images && contextData.past_content_images.length > 0) ||
                 (contextData?.generic_visuals && contextData.generic_visuals.length > 0) ? (
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <PhotoIcon className="w-6 h-6 text-orange-400" />
                      <h3 className="text-lg font-semibold text-white">Uploaded Visual References</h3>
                    </div>
                    
                    <div className="space-y-6">
                      {contextData?.product_photos && contextData.product_photos.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-3">Product Photos ({contextData.product_photos.length})</h4>
                          <div className="grid grid-cols-6 gap-3">
                            {contextData.product_photos.map((file, idx) => (
                              <div 
                                key={idx} 
                                className="relative group cursor-pointer"
                                onClick={(e) => {
                                  if (!e.target || (e.target as HTMLElement).tagName !== 'BUTTON') {
                                    setZoomedImage(file.presigned_url || '')
                                  }
                                }}
                              >
                                <img src={file.presigned_url} alt={file.filename} className="w-full h-24 object-cover rounded-lg border border-gray-600 hover:border-orange-500 transition-colors" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    file.s3_key && deleteFile(file.s3_key, 'product_photos')
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                >
                                  <TrashIcon className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {contextData?.inspiration_images && contextData.inspiration_images.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-3">Inspiration ({contextData.inspiration_images.length})</h4>
                          <div className="grid grid-cols-6 gap-3">
                            {contextData.inspiration_images.map((file, idx) => (
                              <div 
                                key={idx} 
                                className="relative group cursor-pointer"
                                onClick={(e) => {
                                  if (!e.target || (e.target as HTMLElement).tagName !== 'BUTTON') {
                                    setZoomedImage(file.presigned_url || '')
                                  }
                                }}
                              >
                                <img src={file.presigned_url} alt={file.filename} className="w-full h-24 object-cover rounded-lg border border-gray-600 hover:border-orange-500 transition-colors" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    file.s3_key && deleteFile(file.s3_key, 'inspiration_images')
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                >
                                  <TrashIcon className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {contextData?.past_content_images && contextData.past_content_images.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-3">Past Content ({contextData.past_content_images.length})</h4>
                          <div className="grid grid-cols-6 gap-3">
                            {contextData.past_content_images.map((file, idx) => (
                              <div 
                                key={idx} 
                                className="relative group cursor-pointer"
                                onClick={(e) => {
                                  if (!e.target || (e.target as HTMLElement).tagName !== 'BUTTON') {
                                    setZoomedImage(file.presigned_url || '')
                                  }
                                }}
                              >
                                <img src={file.presigned_url} alt={file.filename} className="w-full h-24 object-cover rounded-lg border border-gray-600 hover:border-orange-500 transition-colors" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    file.s3_key && deleteFile(file.s3_key, 'past_content_images')
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                >
                                  <TrashIcon className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {contextData?.generic_visuals && contextData.generic_visuals.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-3">Other Visuals ({contextData.generic_visuals.length})</h4>
                          <div className="grid grid-cols-6 gap-3">
                            {contextData.generic_visuals.map((file, idx) => (
                              <div 
                                key={idx} 
                                className="relative group cursor-pointer"
                                onClick={(e) => {
                                  if (!e.target || (e.target as HTMLElement).tagName !== 'BUTTON') {
                                    setZoomedImage(file.presigned_url || '')
                                  }
                                }}
                              >
                                <img src={file.presigned_url} alt={file.filename} className="w-full h-24 object-cover rounded-lg border border-gray-600 hover:border-orange-500 transition-colors" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    file.s3_key && deleteFile(file.s3_key, 'generic_visuals')
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                >
                                  <TrashIcon className="w-4 h-4 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {/* Text & Content Tab */}
            {activeTab === 'content' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Brand Story</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Tell your brand's story, mission, and what makes you unique...</p>
                  <textarea
                    value={brandStory}
                    onChange={(e) => setBrandStory(e.target.value)}
                    placeholder="Tell your brand's story, mission, and what makes you unique..."
                    className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Key Messages</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Your main talking points, value propositions, taglines...</p>
                  <textarea
                    value={keyMessages}
                    onChange={(e) => setKeyMessages(e.target.value)}
                    placeholder="Your main talking points, value propositions, taglines..."
                    className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Target Audience</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Describe your ideal customer, demographics, interests, pain points...</p>
                  <textarea
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="Describe your ideal customer, demographics, interests, pain points..."
                    className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Do's & Don'ts</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Topics/words to avoid, preferred terminology, content restrictions...</p>
                  <textarea
                    value={dosAndDonts}
                    onChange={(e) => setDosAndDonts(e.target.value)}
                    placeholder="Topics/words to avoid, preferred terminology, content restrictions..."
                    className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="lg:col-span-2 bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Custom Text / Additional Context</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Add any other relevant information, notes, or context...</p>
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Add any other relevant information, notes, or context..."
                    className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            )}

            {/* Platform Handles Tab */}
            {activeTab === 'platforms' && (
              <div className="max-w-3xl mx-auto">
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Platform Handles & URLs</h3>
                    <p className="text-sm text-gray-400">Add your social media handles to analyze your style, voice, and successful content patterns</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Twitter/X Handle</label>
                    <div className="flex items-center">
                      <span className="px-3 py-2 bg-gray-700 border border-r-0 border-gray-600 rounded-l-lg text-gray-400">@</span>
                      <input
                        type="text"
                        value={twitterHandle}
                        onChange={(e) => setTwitterHandle(e.target.value)}
                        placeholder="username"
                        className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-r-lg text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">We'll analyze your tweet style, tone, and successful patterns</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">LinkedIn Profile/Company URL</label>
                    <input
                      type="text"
                      value={linkedinUrl}
                      onChange={(e) => setLinkedinUrl(e.target.value)}
                      placeholder="https://linkedin.com/in/username or /company/name"
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">We'll learn your professional tone and content themes</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">YouTube Channel URL</label>
                    <input
                      type="text"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://youtube.com/@channel"
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">We'll analyze video titles, thumbnails, and description styles</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Instagram Handle</label>
                    <div className="flex items-center">
                      <span className="px-3 py-2 bg-gray-700 border border-r-0 border-gray-600 rounded-l-lg text-gray-400">@</span>
                      <input
                        type="text"
                        value={instagramHandle}
                        onChange={(e) => setInstagramHandle(e.target.value)}
                        placeholder="username"
                        className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-r-lg text-white focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">We'll learn your visual aesthetic and caption style</p>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Additional Reference URLs</label>
                    <p className="text-xs text-gray-500 mb-3">Add competitor sites, inspiration sources, or any relevant URLs for context</p>
                    
                    {referenceUrls.map((url, idx) => (
                      <div key={idx} className="flex items-center space-x-2 mb-2">
                        <input
                          type="text"
                          value={url}
                          onChange={(e) => {
                            const newUrls = [...referenceUrls]
                            newUrls[idx] = e.target.value
                            setReferenceUrls(newUrls)
                          }}
                          placeholder="https://example.com"
                          className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                        />
                        {referenceUrls.length > 1 && (
                          <button
                            onClick={() => setReferenceUrls(referenceUrls.filter((_, i) => i !== idx))}
                            className="p-2 text-red-400 hover:text-red-300"
                          >
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                    
                    <button
                      onClick={() => setReferenceUrls([...referenceUrls, ''])}
                      className="text-sm text-orange-400 hover:text-orange-300 mt-2"
                    >
                      + Add Another URL
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Save Button (visible on all tabs) */}
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-700">
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <span>Tip: More context = better AI-generated content</span>
              </div>
              
              <button
                onClick={saveAllChanges}
                disabled={isSaving}
                className={'px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-all flex items-center space-x-2 ' + (isSaving ? 'opacity-50 cursor-not-allowed' : '')}
              >
                {saveStatus === 'saving' && <span>Saving...</span>}
                {saveStatus === 'saved' && (
                  <>
                    <CheckIcon className="w-5 h-5" />
                    <span>Saved!</span>
                  </>
                )}
                {saveStatus === 'idle' && <span>Save All Changes</span>}
                {saveStatus === 'error' && <span>Error - Try Again</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Image Zoom Modal */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img 
              src={zoomedImage} 
              alt="Zoomed preview" 
              className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain"
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                setZoomedImage(null)
              }}
              className="absolute top-4 right-4 p-2 bg-gray-900/80 hover:bg-gray-800 rounded-full transition-colors"
            >
              <XMarkIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
