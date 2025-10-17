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

  const handleSubmit = async () => {
    setIsSaving(true)
    
    try {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const accountId = localStorage.getItem('burnie_web2_account_id')

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-brand-context`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${web2Auth}`
          },
          body: JSON.stringify({
            ...formData,
            account_id: accountId
          })
        }
      )

      if (response.ok) {
        // Success! Redirect to dashboard
        router.push('/web2/dashboard')
      } else {
        const errorData = await response.json()
        alert(`Error: ${errorData.error || 'Failed to save brand profile'}`)
      }
    } catch (error) {
      console.error('Error saving brand profile:', error)
      alert('Failed to save brand profile. Please try again.')
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
                  Account Values (Select all that apply)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {['Innovation', 'Quality', 'Sustainability', 'Affordability', 'Luxury', 'Transparency', 'Community', 'Excellence'].map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleArrayToggle('account_values', value.toLowerCase())}
                      className={`px-4 py-2 rounded-lg border transition-colors ${
                        formData.account_values.includes(value.toLowerCase())
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-orange-500'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

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

