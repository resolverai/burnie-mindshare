'use client'

import { useState, useEffect } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import api from '@/services/api'

interface CreateCampaignModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface Project {
  id: number
  name: string
  description: string
  isActive: boolean
}

interface CampaignFormData {
  projectId: number | null
  title: string
  description: string
  category: string
  campaignType: string
  rewardPool: number
  entryFee: number
  maxSubmissions: number
  startDate: string
  endDate: string
  requirements: {
    minStake: number
    maxSubmissionsPerMiner: number
    allowedPersonalities: string[]
    requiredSocialVerification: string[]
  }
  metadata: {
    tags: string[]
    difficulty: string
    targetAudience: string
    brandGuidelines: string
    examples: string[]
  }
}

const campaignTypes = [
  { value: 'ROAST', label: 'Roast 🔥', description: 'Savage roasts and humorous takes' },
  { value: 'MEME', label: 'Meme 🎭', description: 'Viral memes and funny content' },
  { value: 'CREATIVE', label: 'Creative 🎨', description: 'Original creative content' },
  { value: 'ANALYSIS', label: 'Analysis 📊', description: 'In-depth analysis and insights' },
]

const categories = [
  'Roasting', 'Memes', 'Creative', 'Analysis', 'Marketing', 'Educational', 'Entertainment'
]

const difficulties = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

export default function CreateCampaignModal({ isOpen, onClose, onSuccess }: CreateCampaignModalProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [formData, setFormData] = useState<CampaignFormData>({
    projectId: null,
    title: '',
    description: '',
    category: '',
    campaignType: 'ROAST',
    rewardPool: 0,
    entryFee: 0,
    maxSubmissions: 1500,
    startDate: '',
    endDate: '',
    requirements: {
      minStake: 100,
      maxSubmissionsPerMiner: 5,
      allowedPersonalities: [],
      requiredSocialVerification: [],
    },
    metadata: {
      tags: [],
      difficulty: 'Intermediate',
      targetAudience: '',
      brandGuidelines: '',
      examples: [],
    },
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchProjects()
      // Set default dates
      const now = new Date()
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      
      setFormData(prev => ({
        ...prev,
        startDate: tomorrow.toISOString().slice(0, 16),
        endDate: nextWeek.toISOString().slice(0, 16),
      }))
    }
  }, [isOpen])

  const fetchProjects = async () => {
    try {
      setLoadingProjects(true)
      const response = await api.get('/api/projects?limit=100')
      const projectsData = response.data.data || []
      setProjects(projectsData.filter((p: Project) => p.isActive))
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setLoadingProjects(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validate required fields
      if (!formData.title || !formData.description || !formData.category || !formData.rewardPool || !formData.maxSubmissions || !formData.startDate || !formData.endDate) {
        throw new Error('Please fill in all required fields')
      }

      // Validate dates
      const startDate = new Date(formData.startDate)
      const endDate = new Date(formData.endDate)
      const now = new Date()

      if (startDate <= now) {
        throw new Error('Start date must be in the future')
      }

      if (endDate <= startDate) {
        throw new Error('End date must be after start date')
      }

      // Prepare data for API
      const campaignData = {
        projectId: formData.projectId || undefined,
        title: formData.title,
        description: formData.description,
        category: formData.category,
        campaignType: formData.campaignType,
        rewardPool: formData.rewardPool,
        entryFee: formData.entryFee,
        maxSubmissions: formData.maxSubmissions,
        startDate: formData.startDate,
        endDate: formData.endDate,
        requirements: {
          minStake: formData.requirements.minStake,
          maxSubmissionsPerMiner: formData.requirements.maxSubmissionsPerMiner,
          allowedPersonalities: formData.requirements.allowedPersonalities.length > 0 ? formData.requirements.allowedPersonalities : undefined,
          requiredSocialVerification: formData.requirements.requiredSocialVerification.length > 0 ? formData.requirements.requiredSocialVerification : undefined,
        },
        metadata: {
          tags: formData.metadata.tags.length > 0 ? formData.metadata.tags : undefined,
          difficulty: formData.metadata.difficulty,
          targetAudience: formData.metadata.targetAudience || undefined,
          brandGuidelines: formData.metadata.brandGuidelines || undefined,
          examples: formData.metadata.examples.length > 0 ? formData.metadata.examples : undefined,
        },
        isActive: true,
      }

      const response = await api.post('/api/campaigns', campaignData)
      
      if (response.data.success) {
        onSuccess()
        handleReset()
      } else {
        throw new Error(response.data.error || 'Failed to create campaign')
      }
    } catch (error: any) {
      console.error('Failed to create campaign:', error)
      setError(error.message || 'Failed to create campaign. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFormData({
      projectId: null,
      title: '',
      description: '',
      category: '',
      campaignType: 'ROAST',
      rewardPool: 0,
      entryFee: 0,
      maxSubmissions: 1500,
      startDate: '',
      endDate: '',
      requirements: {
        minStake: 100,
        maxSubmissionsPerMiner: 5,
        allowedPersonalities: [],
        requiredSocialVerification: [],
      },
      metadata: {
        tags: [],
        difficulty: 'Intermediate',
        targetAudience: '',
        brandGuidelines: '',
        examples: [],
      },
    })
    setError(null)
  }

  const handleClose = () => {
    handleReset()
    onClose()
  }

  const handleArrayInput = (field: string, value: string, section: 'requirements' | 'metadata') => {
    const items = value.split(',').map(item => item.trim()).filter(item => item.length > 0)
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
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
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    Create New Campaign
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
                          Project (Optional)
                        </label>
                        <select
                          value={formData.projectId || ''}
                          onChange={(e) => setFormData(prev => ({ 
                            ...prev, 
                            projectId: e.target.value ? parseInt(e.target.value) : null 
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          disabled={loadingProjects}
                        >
                          <option value="">Select a project (optional)</option>
                          {projects.map(project => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                        {loadingProjects && (
                          <p className="text-xs text-gray-500 mt-1">Loading projects...</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Campaign Title *
                        </label>
                        <input
                          type="text"
                          value={formData.title}
                          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="Enter campaign title"
                          required
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        placeholder="Describe your campaign..."
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Campaign Type *
                        </label>
                        <select
                          value={formData.campaignType}
                          onChange={(e) => setFormData(prev => ({ ...prev, campaignType: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          required
                        >
                          {campaignTypes.map(type => (
                            <option key={type.value} value={type.value}>
                              {type.label} - {type.description}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Category *
                        </label>
                        <select
                          value={formData.category}
                          onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          required
                        >
                          <option value="">Select category</option>
                          {categories.map(category => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Rewards & Limits */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Rewards & Limits</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Reward Pool ($) *
                        </label>
                        <input
                          type="number"
                          value={formData.rewardPool}
                          onChange={(e) => setFormData(prev => ({ ...prev, rewardPool: parseInt(e.target.value) || 0 }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="0"
                          min="0"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Entry Fee ($)
                        </label>
                        <input
                          type="number"
                          value={formData.entryFee}
                          onChange={(e) => setFormData(prev => ({ ...prev, entryFee: parseInt(e.target.value) || 0 }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="0"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Max Submissions *
                        </label>
                        <input
                          type="number"
                          value={formData.maxSubmissions}
                          onChange={(e) => setFormData(prev => ({ ...prev, maxSubmissions: parseInt(e.target.value) || 1500 }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="1500"
                          min="1"
                          max="1500"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Timeline</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Start Date & Time *
                        </label>
                        <input
                          type="datetime-local"
                          value={formData.startDate}
                          onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          End Date & Time *
                        </label>
                        <input
                          type="datetime-local"
                          value={formData.endDate}
                          onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Requirements */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Requirements</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Minimum Stake ($)
                        </label>
                        <input
                          type="number"
                          value={formData.requirements.minStake}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            requirements: { ...prev.requirements, minStake: parseInt(e.target.value) || 100 }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="100"
                          min="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Max Submissions per Miner
                        </label>
                        <input
                          type="number"
                          value={formData.requirements.maxSubmissionsPerMiner}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            requirements: { ...prev.requirements, maxSubmissionsPerMiner: parseInt(e.target.value) || 5 }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="5"
                          min="1"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="space-y-4">
                    <h4 className="text-md font-medium text-gray-900">Additional Details</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Tags
                        </label>
                        <input
                          type="text"
                          onChange={(e) => handleArrayInput('tags', e.target.value, 'metadata')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                          placeholder="Enter tags separated by commas"
                        />
                        <p className="text-xs text-gray-500 mt-1">e.g., crypto, funny, viral</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Difficulty
                        </label>
                        <select
                          value={formData.metadata.difficulty}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            metadata: { ...prev.metadata, difficulty: e.target.value }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        >
                          {difficulties.map(difficulty => (
                            <option key={difficulty} value={difficulty}>
                              {difficulty}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Audience
                      </label>
                      <input
                        type="text"
                        value={formData.metadata.targetAudience}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          metadata: { ...prev.metadata, targetAudience: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        placeholder="e.g., Crypto enthusiasts, DeFi users"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Brand Guidelines
                      </label>
                      <textarea
                        value={formData.metadata.brandGuidelines}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          metadata: { ...prev.metadata, brandGuidelines: e.target.value }
                        }))}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        placeholder="Specific guidelines for content creators..."
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 text-sm font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Creating...' : 'Create Campaign'}
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