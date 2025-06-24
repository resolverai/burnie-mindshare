'use client'

import { useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import api from '@/services/api'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ProjectFormData {
  name: string
  description: string
  website: string
  logo: string
  socialLinks: {
    twitter: string
    discord: string
    telegram: string
    farcaster: string
  }
  brandGuidelines: {
    colors: string[]
    fonts: string[]
    tone: string
    keywords: string[]
    restrictions: string[]
  }
  isActive: boolean
}

export default function CreateProjectModal({ isOpen, onClose, onSuccess }: CreateProjectModalProps) {
  const [formData, setFormData] = useState<ProjectFormData>({
    name: '',
    description: '',
    website: '',
    logo: '',
    socialLinks: {
      twitter: '',
      discord: '',
      telegram: '',
      farcaster: '',
    },
    brandGuidelines: {
      colors: [],
      fonts: [],
      tone: '',
      keywords: [],
      restrictions: [],
    },
    isActive: true,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validate required fields
      if (!formData.name || !formData.description) {
        throw new Error('Project name and description are required')
      }

      // Prepare data for API
      const projectData = {
        name: formData.name,
        description: formData.description,
        website: formData.website || undefined,
        logo: formData.logo || undefined,
        socialLinks: {
          twitter: formData.socialLinks.twitter || undefined,
          discord: formData.socialLinks.discord || undefined,
          telegram: formData.socialLinks.telegram || undefined,
          farcaster: formData.socialLinks.farcaster || undefined,
        },
        brandGuidelines: {
          colors: formData.brandGuidelines.colors.length > 0 ? formData.brandGuidelines.colors : undefined,
          fonts: formData.brandGuidelines.fonts.length > 0 ? formData.brandGuidelines.fonts : undefined,
          tone: formData.brandGuidelines.tone || undefined,
          keywords: formData.brandGuidelines.keywords.length > 0 ? formData.brandGuidelines.keywords : undefined,
          restrictions: formData.brandGuidelines.restrictions.length > 0 ? formData.brandGuidelines.restrictions : undefined,
        },
        isActive: formData.isActive,
      }

      const response = await api.post('/api/projects', projectData)
      
      if (response.data.success) {
        onSuccess()
        handleReset()
      } else {
        throw new Error(response.data.error || 'Failed to create project')
      }
    } catch (error: any) {
      console.error('Failed to create project:', error)
      setError(error.message || 'Failed to create project. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFormData({
      name: '',
      description: '',
      website: '',
      logo: '',
      socialLinks: {
        twitter: '',
        discord: '',
        telegram: '',
        farcaster: '',
      },
      brandGuidelines: {
        colors: [],
        fonts: [],
        tone: '',
        keywords: [],
        restrictions: [],
      },
      isActive: true,
    })
    setError(null)
  }

  const handleClose = () => {
    handleReset()
    onClose()
  }

  const handleArrayInput = (field: 'colors' | 'fonts' | 'keywords' | 'restrictions', value: string) => {
    const items = value.split(',').map(item => item.trim()).filter(item => item.length > 0)
    setFormData(prev => ({
      ...prev,
      brandGuidelines: {
        ...prev.brandGuidelines,
        [field]: items,
      },
    }))
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    Create New Project
                  </Dialog.Title>
                  <button
                    onClick={handleClose}
                    className="rounded-md p-2 hover:bg-gray-100 transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>

                {error && (
                  <div className="mb-4 rounded-md bg-red-50 p-4">
                    <div className="text-sm text-red-700">{error}</div>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Information */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Basic Information</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Project Name *
                        </label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter project name"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Website
                        </label>
                        <input
                          type="url"
                          value={formData.website}
                          onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://example.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Description *
                      </label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Describe your project..."
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Logo URL
                      </label>
                      <input
                        type="url"
                        value={formData.logo}
                        onChange={(e) => setFormData(prev => ({ ...prev, logo: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="https://example.com/logo.png"
                      />
                    </div>
                  </div>

                  {/* Social Links */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Social Links</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Twitter
                        </label>
                        <input
                          type="url"
                          value={formData.socialLinks.twitter}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            socialLinks: { ...prev.socialLinks, twitter: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://twitter.com/username"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Discord
                        </label>
                        <input
                          type="url"
                          value={formData.socialLinks.discord}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            socialLinks: { ...prev.socialLinks, discord: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://discord.gg/invite"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Telegram
                        </label>
                        <input
                          type="url"
                          value={formData.socialLinks.telegram}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            socialLinks: { ...prev.socialLinks, telegram: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://t.me/channel"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Farcaster
                        </label>
                        <input
                          type="url"
                          value={formData.socialLinks.farcaster}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            socialLinks: { ...prev.socialLinks, farcaster: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://farcaster.xyz/username"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Brand Guidelines */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Brand Guidelines</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Brand Colors
                        </label>
                        <input
                          type="text"
                          onChange={(e) => handleArrayInput('colors', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter colors separated by commas"
                        />
                        <p className="text-xs text-gray-500 mt-1">e.g., #FF6B35, #004E89, #00A896</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Fonts
                        </label>
                        <input
                          type="text"
                          onChange={(e) => handleArrayInput('fonts', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter fonts separated by commas"
                        />
                        <p className="text-xs text-gray-500 mt-1">e.g., Montserrat, Arial, Helvetica</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Brand Tone
                      </label>
                      <input
                        type="text"
                        value={formData.brandGuidelines.tone}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          brandGuidelines: { ...prev.brandGuidelines, tone: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., Professional yet approachable, innovative"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Keywords
                        </label>
                        <input
                          type="text"
                          onChange={(e) => handleArrayInput('keywords', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter keywords separated by commas"
                        />
                        <p className="text-xs text-gray-500 mt-1">e.g., DeFi, innovative, secure</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Content Restrictions
                        </label>
                        <input
                          type="text"
                          onChange={(e) => handleArrayInput('restrictions', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter restrictions separated by commas"
                        />
                        <p className="text-xs text-gray-500 mt-1">e.g., No offensive content, Keep professional</p>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.isActive}
                      onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                      Project is active
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Creating...' : 'Create Project'}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
} 