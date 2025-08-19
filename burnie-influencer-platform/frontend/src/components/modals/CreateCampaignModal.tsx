'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { campaignsApi } from '@/services/api'
import { XMarkIcon, CheckCircleIcon, PhotoIcon } from '@heroicons/react/24/outline'

interface CreateCampaignModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const CAMPAIGN_TYPES = [
  { value: 'feature_launch', label: '🚀 Feature Launch' },
  { value: 'showcase', label: '✨ Showcase' },
  { value: 'awareness', label: '📢 Awareness' },
  { value: 'roast', label: '🔥 Roast' },
  { value: 'meme', label: '😂 Meme' },
  { value: 'creative', label: '🎨 Creative' },
  { value: 'viral', label: '⚡ Viral' },
  { value: 'social', label: '👥 Social' },
  { value: 'educational', label: '📚 Educational' },
  { value: 'technical', label: '🔧 Technical' },
]

const WEB3_CATEGORIES = [
  { value: 'defi', label: '🏦 DeFi' },
  { value: 'nft', label: '🖼️ NFT' },
  { value: 'gaming', label: '🎮 Gaming' },
  { value: 'metaverse', label: '🌐 Metaverse' },
  { value: 'dao', label: '🏛️ DAO' },
  { value: 'infrastructure', label: '🏗️ Infrastructure' },
  { value: 'layer1', label: '1️⃣ Layer 1' },
  { value: 'layer2', label: '2️⃣ Layer 2' },
  { value: 'trading', label: '📈 Trading' },
  { value: 'meme_coins', label: '🐕 Meme Coins' },
  { value: 'social_fi', label: '💬 SocialFi' },
  { value: 'ai_crypto', label: '🤖 AI & Crypto' },
  { value: 'rwa', label: '🏠 Real World Assets' },
  { value: 'prediction_markets', label: '🔮 Prediction Markets' },
  { value: 'privacy', label: '🔒 Privacy' },
  { value: 'cross_chain', label: '🌉 Cross Chain' },
  { value: 'yield_farming', label: '🌾 Yield Farming' },
  { value: 'liquid_staking', label: '💧 Liquid Staking' },
  { value: 'derivatives', label: '📊 Derivatives' },
  { value: 'payments', label: '💳 Payments' },
  { value: 'identity', label: '🆔 Identity' },
  { value: 'security', label: '🛡️ Security' },
  { value: 'tools', label: '🔨 Tools' },
  { value: 'analytics', label: '📊 Analytics' },
  { value: 'education', label: '🎓 Education' },
  { value: 'other', label: '📦 Other' },
]

export default function CreateCampaignModal({ isOpen, onClose, onSuccess }: CreateCampaignModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    projectName: '',
    projectLogo: null as File | null,
    campaignBanner: null as File | null,
    category: '',
    campaignType: '',
    rewardPool: '',
    startDate: '',
    endDate: '',
    guidelines: '',
    projectTwitterHandle: '', // For fetching latest tweets
  })
  const [showSuccess, setShowSuccess] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [bannerPreview, setBannerPreview] = useState<string>('')

  const queryClient = useQueryClient()

  const createCampaignMutation = useMutation({
    mutationFn: async (data: any) => {
      // If there's a logo, upload it first
      let logoUrl = ''
      if (formData.projectLogo) {
        const logoFormData = new FormData()
        logoFormData.append('logo', formData.projectLogo)
        logoFormData.append('projectName', formData.projectName || 'untitled')

        const logoResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-logo`, {
          method: 'POST',
          body: logoFormData,
        })
        
        if (logoResponse.ok) {
          const logoResult = await logoResponse.json()
          logoUrl = logoResult.data.logoUrl
        }
      }

      // If there's a banner, upload it
      let bannerUrl = ''
      if (formData.campaignBanner) {
        const bannerFormData = new FormData()
        bannerFormData.append('banner', formData.campaignBanner)
        bannerFormData.append('campaignName', formData.title || 'untitled')

        const bannerResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-banner`, {
          method: 'POST',
          body: bannerFormData,
        })
        
        if (bannerResponse.ok) {
          const bannerResult = await bannerResponse.json()
          bannerUrl = bannerResult.data.bannerUrl
        }
      }
      
      // Create campaign with logo and banner URLs
      return campaignsApi.create({
        ...data,
        projectLogo: logoUrl,
        campaignBanner: bannerUrl
      })
    },
    onSuccess: (data) => {
      // Invalidate all relevant queries to update dashboard numbers
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] })
      
      // Show success message
      setShowSuccess(true)
      
      // Auto close after 1.5 seconds
      setTimeout(() => {
        setShowSuccess(false)
        onSuccess?.()
        onClose()
        setFormData({
          title: '',
          description: '',
          projectName: '',
          projectLogo: null,
          campaignBanner: null,
          category: '',
          campaignType: '',
          rewardPool: '',
          startDate: '',
          endDate: '',
          guidelines: '',
          projectTwitterHandle: '',
        })
        setLogoPreview('')
      }, 1500)
    },
    onError: (error) => {
      console.error('Failed to create campaign:', error)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim() || !formData.description.trim() || !formData.category || !formData.campaignType || !formData.rewardPool || !formData.startDate) {
      return
    }

    // Calculate end date if not provided (30 days from start date)
    const startDate = new Date(formData.startDate)
    const endDate = formData.endDate ? new Date(formData.endDate) : new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)

    const campaignData = {
      title: formData.title,
      description: formData.description,
      projectName: formData.projectName || undefined,
      category: formData.category,
      campaignType: formData.campaignType,
      rewardPool: parseInt(formData.rewardPool),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      brandGuidelines: formData.guidelines || undefined,
      projectTwitterHandle: formData.projectTwitterHandle || undefined,
    }

    console.log('🚀 Submitting campaign data:', campaignData)
    createCampaignMutation.mutate(campaignData)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, projectLogo: file }))
      
      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, campaignBanner: file }))
      
      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setBannerPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // Allow any start date - no automatic default to today
  // Users can select past, present, or future dates freely

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Create New Campaign</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {showSuccess ? (
          <div className="p-6 text-center">
            <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Campaign Created Successfully! 🎉</h4>
            <p className="text-gray-600">Your campaign has been saved to the database.<br/>Dashboard will update automatically.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Campaign Title *
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Enter campaign title"
                required
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Describe your campaign objectives and requirements"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  id="projectName"
                  name="projectName"
                  value={formData.projectName}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="Enter project name"
                />
              </div>

              <div>
                <label htmlFor="projectTwitterHandle" className="block text-sm font-medium text-gray-700 mb-1">
                  Project Twitter Handle <span className="text-gray-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="projectTwitterHandle"
                  name="projectTwitterHandle"
                  value={formData.projectTwitterHandle}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="@projectname"
                />
                <p className="text-xs text-gray-500 mt-1">We'll fetch latest tweets for content context</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="projectLogo" className="block text-sm font-medium text-gray-700 mb-1">
                  Project Logo
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="file"
                    id="projectLogo"
                    name="projectLogo"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                  <label
                    htmlFor="projectLogo"
                    className="flex items-center px-3 py-2 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50"
                  >
                    <PhotoIcon className="h-5 w-5 mr-2 text-gray-400" />
                    Choose File
                  </label>
                  {logoPreview && (
                    <img src={logoPreview} alt="Logo preview" className="h-8 w-8 rounded object-cover" />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="campaignType" className="block text-sm font-medium text-gray-700 mb-1">
                  Campaign Type *
                </label>
                <select
                  id="campaignType"
                  name="campaignType"
                  value={formData.campaignType}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Select type</option>
                  {CAMPAIGN_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                  Category *
                </label>
                <select
                  id="category"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Select category</option>
                  {WEB3_CATEGORIES.map(category => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="rewardPool" className="block text-sm font-medium text-gray-700 mb-1">
                  Reward Pool (ROAST) *
                </label>
                <input
                  type="number"
                  id="rewardPool"
                  name="rewardPool"
                  value={formData.rewardPool}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="1000"
                  min="1"
                  required
                />
              </div>

              <div>
                <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  id="startDate"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                End Date (Optional)
              </label>
              <input
                type="date"
                id="endDate"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                min={formData.startDate}
              />
              <p className="text-xs text-gray-500 mt-1">
                If not specified, campaign will run for 30 days from start date
              </p>
            </div>

            <div>
              <label htmlFor="guidelines" className="block text-sm font-medium text-gray-700 mb-1">
                Brand Guidelines (Optional)
              </label>
              <textarea
                id="guidelines"
                name="guidelines"
                value={formData.guidelines}
                onChange={handleChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Optional content guidelines and requirements"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                disabled={createCampaignMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createCampaignMutation.isPending}
                className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
              >
                {createCampaignMutation.isPending ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>

            {createCampaignMutation.isError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-700 text-sm">
                  Failed to create campaign. Please try again.
                </p>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
} 