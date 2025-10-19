'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BoltIcon, ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/solid'

export default function BrandProfilePage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [step, setStep] = useState(1)
  const [accountData, setAccountData] = useState<any>(null)

  // Form state
  const [formData, setFormData] = useState({
    // Step 1: Basic Info
    account_name: '',
    account_tagline: '',
    account_description: '',
    industry: '',
    
    // Step 2: Account Identity
    account_values: [] as string[],
    tone_of_voice: [] as string[],
    target_audience: '',
    
    // Step 3: Visual Identity
    logo_file: null as File | null,
    logo_url: '',
    color_palette: {
      primary: '#000000',
      secondary: '#ffffff',
      accent: '#ff6b35'
    },
    typography_preferences: '',
    visual_aesthetics: '',
    
    // Step 4: Content Preferences
    content_types: [] as string[],
    posting_frequency: 'daily',
    preferred_platforms: [] as string[]
  })

  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    // Check authentication
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')

    if (!web2Auth || !accountId) {
      router.push('/web2/auth')
      return
    }

    // Fetch account data
    const fetchAccountData = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-auth/me`,
          {
            headers: {
              'Authorization': `Bearer ${web2Auth}`
            }
          }
        )

        if (response.ok) {
          const data = await response.json()
          setAccountData(data.data)
          
          // Pre-fill account name from account
          setFormData(prev => ({
            ...prev,
            account_name: data.data.user.account.business_name || '',
            industry: data.data.user.account.industry || ''
          }))
        } else {
          const errorData = await response.json()
          if (errorData.requiresReconnect || errorData.requiresAuth) {
            localStorage.removeItem('burnie_web2_auth')
            localStorage.removeItem('burnie_web2_account_id')
            router.push('/web2/auth')
          }
        }
      } catch (error) {
        console.error('Error fetching account data:', error)
        router.push('/web2/auth')
      } finally {
        setIsLoading(false)
      }
    }

    fetchAccountData()
  }, [router])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleArrayToggle = (field: 'account_values' | 'tone_of_voice' | 'content_types' | 'preferred_platforms', value: string) => {
    setFormData(prev => {
      const currentArray = prev[field] as string[]
      const newArray = currentArray.includes(value)
        ? currentArray.filter(item => item !== value)
        : [...currentArray, value]
      return { ...prev, [field]: newArray }
    })
  }

  const handleColorChange = (colorType: 'primary' | 'secondary' | 'accent', value: string) => {
    setFormData(prev => ({
      ...prev,
      color_palette: {
        ...prev.color_palette,
        [colorType]: value
      }
    }))
  }

  const handleNext = () => {
    if (step < 4) setStep(step + 1)
  }

  const handleBack = () => {
    if (step > 1) setStep(step - 1)
  }

  const validateAndSetLogo = (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file')
      return false
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Logo file size must be less than 5MB')
      return false
    }
    
    // Set file and create preview
    setFormData(prev => ({ ...prev, logo_file: file }))
    
    const reader = new FileReader()
    reader.onloadend = () => {
      setLogoPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
    return true
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      validateAndSetLogo(file)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      validateAndSetLogo(file)
    }
  }

  const handleRemoveLogo = () => {
    setFormData(prev => ({ ...prev, logo_file: null }))
    setLogoPreview(null)
  }

  const uploadLogoToS3 = async (accountId: string): Promise<string | null> => {
    if (!formData.logo_file) return null

    try {
      const formDataUpload = new FormData()
      formDataUpload.append('logo', formData.logo_file)
      formDataUpload.append('account_id', accountId)

      // Upload to backend which will handle S3 upload
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-account-context/upload-logo`,
        {
          method: 'POST',
          body: formDataUpload
        }
      )

      if (response.ok) {
        const result = await response.json()
        // Return the s3_url (non-presigned format: s3://bucket/key)
        // This will be stored in database and presigned URLs generated when needed
        return result.data.s3_url
      } else {
        const errorData = await response.json()
        console.error('Logo upload failed:', errorData.error)
        alert(`Failed to upload logo: ${errorData.error || 'Unknown error'}`)
        return null
      }
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert('Failed to upload logo. Please try again.')
      return null
    }
  }

  const handleSubmit = async () => {
    setIsSaving(true)
    
    try {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const accountId = localStorage.getItem('burnie_web2_account_id')

      // Upload logo first if provided
      let logoUrl = formData.logo_url
      if (formData.logo_file && accountId) {
        const uploadedLogoUrl = await uploadLogoToS3(accountId)
        if (uploadedLogoUrl) {
          logoUrl = uploadedLogoUrl
        }
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-account-context/account/${accountId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${web2Auth}`
          },
          body: JSON.stringify({
            industry: formData.industry,
            brand_name: formData.account_name,
            brand_tagline: formData.account_tagline,
            brand_description: formData.account_description,
            brand_values: formData.account_values,
            target_audience: formData.target_audience,
            tone_of_voice: formData.tone_of_voice,
            logo_url: logoUrl,
            color_palette: formData.color_palette,
            typography_preferences: formData.typography_preferences,
            brand_aesthetics: formData.visual_aesthetics,
            content_preferences: {
              content_types: formData.content_types,
              posting_frequency: formData.posting_frequency,
              preferred_platforms: formData.preferred_platforms
            }
          })
        }
      )

      if (response.ok) {
        // Success! Redirect to dashboard
        router.push('/web2/dashboard')
      } else {
        const errorData = await response.json()
        alert(`Error: ${errorData.error || 'Failed to save account profile'}`)
      }
    } catch (error) {
      console.error('Error saving account profile:', error)
      alert('Failed to save account profile. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
              <BoltIcon className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Complete Your Account Profile</h1>
          <p className="text-gray-400">
            Help our AI understand your account to create perfect content
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">Step {step} of 4</span>
            <span className="text-sm text-gray-400">{Math.round((step / 4) * 100)}% Complete</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-orange-500 to-red-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Form Container */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8">
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white mb-6">Basic Information</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Account Name *
                </label>
                <input
                  type="text"
                  name="account_name"
                  value={formData.account_name}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="e.g., Acme Corp"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Account Tagline
                </label>
                <input
                  type="text"
                  name="account_tagline"
                  value={formData.account_tagline}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="e.g., Innovation at its finest"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Account Description *
                </label>
                <textarea
                  name="account_description"
                  value={formData.account_description}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="Tell us about your account, what you do, and what makes you unique..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Industry *
                </label>
                <div className="relative">
                  <select
                    name="industry"
                    value={formData.industry}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500 appearance-none cursor-pointer"
                    required
                  >
                    <option value="" className="bg-gray-800">Select an industry</option>
                    <option value="web3_mining" className="bg-gray-800">Web3 & Crypto Mining</option>
                    <option value="fashion" className="bg-gray-800">Fashion & Apparel</option>
                    <option value="design_agency" className="bg-gray-800">Design Agency</option>
                    <option value="social_media_management" className="bg-gray-800">Social Media Management</option>
                    <option value="influencer" className="bg-gray-800">Influencer / Content Creator</option>
                    <option value="ecommerce" className="bg-gray-800">E-commerce</option>
                    <option value="technology" className="bg-gray-800">Technology / SaaS</option>
                    <option value="marketing_agency" className="bg-gray-800">Marketing Agency</option>
                    <option value="food_beverage" className="bg-gray-800">Food & Beverage</option>
                    <option value="health_wellness" className="bg-gray-800">Health & Wellness</option>
                    <option value="finance" className="bg-gray-800">Finance</option>
                    <option value="education" className="bg-gray-800">Education</option>
                    <option value="entertainment" className="bg-gray-800">Entertainment</option>
                    <option value="travel" className="bg-gray-800">Travel & Hospitality</option>
                    <option value="real_estate" className="bg-gray-800">Real Estate</option>
                    <option value="automotive" className="bg-gray-800">Automotive</option>
                    <option value="beauty" className="bg-gray-800">Beauty & Cosmetics</option>
                    <option value="sports" className="bg-gray-800">Sports & Fitness</option>
                    <option value="other" className="bg-gray-800">Other</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Account Identity */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white mb-6">Account Identity</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Tone of Voice (Select all that apply)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {['Professional', 'Casual', 'Friendly', 'Authoritative', 'Humorous', 'Inspirational', 'Educational', 'Conversational'].map(tone => (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => handleArrayToggle('tone_of_voice', tone.toLowerCase())}
                      className={`px-4 py-2 rounded-lg border transition-colors ${
                        formData.tone_of_voice.includes(tone.toLowerCase())
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-orange-500'
                      }`}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Target Audience *
                </label>
                <textarea
                  name="target_audience"
                  value={formData.target_audience}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="Describe your ideal customer (age, interests, demographics, pain points...)"
                  required
                />
              </div>
            </div>
          )}

          {/* Step 3: Visual Identity */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white mb-6">Visual Identity</h2>
              
              {/* Logo Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Account Logo
                </label>
                
                {/* Drag and Drop Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative border-2 border-dashed rounded-xl p-8 transition-all ${
                    isDragging 
                      ? 'border-orange-500 bg-orange-500/10' 
                      : 'border-gray-600 bg-gray-700/30'
                  }`}
                >
                  {logoPreview ? (
                    /* Logo Preview with Remove Button */
                    <div className="flex items-center space-x-6">
                      <div className="relative w-32 h-32 bg-gray-700/50 rounded-lg border-2 border-gray-600 flex items-center justify-center overflow-hidden group">
                        <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                        <button
                          onClick={handleRemoveLogo}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          type="button"
                        >
                          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-green-400 font-medium mb-1">
                          ✓ {formData.logo_file?.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formData.logo_file && (formData.logo_file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        <button
                          onClick={handleRemoveLogo}
                          className="mt-2 text-sm text-red-400 hover:text-red-300"
                          type="button"
                        >
                          Remove logo
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Upload Prompt */
                    <div className="text-center">
                      <svg
                        className={`mx-auto h-16 w-16 mb-4 ${isDragging ? 'text-orange-500' : 'text-gray-500'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      <div className="mb-4">
                        <input
                          type="file"
                          id="logo-upload"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <label
                          htmlFor="logo-upload"
                          className="inline-block px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg cursor-pointer transition-colors font-medium"
                        >
                          Choose Logo
                        </label>
                      </div>
                      <p className="text-sm text-gray-400 mb-1">
                        or drag and drop your logo here
                      </p>
                      <p className="text-xs text-gray-500">
                        PNG, JPG, or SVG • Max size: 5MB
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Brand Colors
                </label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">Primary Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={formData.color_palette.primary}
                        onChange={(e) => handleColorChange('primary', e.target.value)}
                        className="w-12 h-12 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.color_palette.primary}
                        onChange={(e) => handleColorChange('primary', e.target.value)}
                        className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">Secondary Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={formData.color_palette.secondary}
                        onChange={(e) => handleColorChange('secondary', e.target.value)}
                        className="w-12 h-12 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.color_palette.secondary}
                        onChange={(e) => handleColorChange('secondary', e.target.value)}
                        className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">Accent Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={formData.color_palette.accent}
                        onChange={(e) => handleColorChange('accent', e.target.value)}
                        className="w-12 h-12 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.color_palette.accent}
                        onChange={(e) => handleColorChange('accent', e.target.value)}
                        className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Typography Preferences
                </label>
                <input
                  type="text"
                  name="typography_preferences"
                  value={formData.typography_preferences}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="e.g., Modern, Clean, Bold, Elegant"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Visual Aesthetics & Style
                </label>
                <textarea
                  name="visual_aesthetics"
                  value={formData.visual_aesthetics}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  placeholder="Describe your visual style (minimalist, vibrant, professional, playful, etc.)"
                />
              </div>
            </div>
          )}

          {/* Step 4: Content Preferences */}
          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white mb-6">Content Preferences</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Content Types (Select all that apply)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {['Images', 'Videos', 'Carousels', 'Infographics', 'Quotes', 'Behind-the-scenes', 'Product Showcases', 'Educational'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleArrayToggle('content_types', type.toLowerCase())}
                      className={`px-4 py-2 rounded-lg border transition-colors ${
                        formData.content_types.includes(type.toLowerCase())
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-orange-500'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Posting Frequency
                </label>
                <select
                  name="posting_frequency"
                  value={formData.posting_frequency}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="daily">Daily</option>
                  <option value="3x_week">3 times per week</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Preferred Platforms (Already connected: 𝕏)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="px-4 py-3 bg-green-500/20 border border-green-500 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <span className="text-green-400">✓</span>
                      <span className="text-white">𝕏 (Twitter)</span>
                    </div>
                  </div>
                  {['LinkedIn', 'YouTube', 'Instagram'].map(platform => (
                    <div key={platform} className="px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">{platform}</span>
                        <span className="text-xs text-gray-500">Connect later</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-700">
            <button
              onClick={handleBack}
              disabled={step === 1}
              className="flex items-center space-x-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              <span>Back</span>
            </button>

            {step < 4 ? (
              <button
                onClick={handleNext}
                className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg transition-all"
              >
                <span>Next</span>
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSaving}
                className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <span>Complete Setup</span>
                    <ArrowRightIcon className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

