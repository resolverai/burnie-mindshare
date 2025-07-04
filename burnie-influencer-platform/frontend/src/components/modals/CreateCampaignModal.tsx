'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { campaignsApi, projectsApi } from '@/services/api'
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

interface CreateCampaignModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const CAMPAIGN_TYPES = [
  { value: 'roast', label: '🔥 Roast' },
  { value: 'meme', label: '😂 Meme' },
  { value: 'creative', label: '🎨 Creative' },
  { value: 'viral', label: '⚡ Viral' },
]

const CATEGORIES = [
  'DeFi', 'NFT', 'Gaming', 'Social', 'Infrastructure', 'Trading', 'Meme', 'Other'
]

export default function CreateCampaignModal({ isOpen, onClose, onSuccess }: CreateCampaignModalProps) {
  const [formData, setFormData] = useState({
    projectId: '',
    title: '',
    description: '',
    category: '',
    campaignType: '',
    rewardPool: '',
    maxSubmissions: '100',
  })
  const [showSuccess, setShowSuccess] = useState(false)

  const queryClient = useQueryClient()

  // Fetch available projects
  const { data: projectsResponse, isLoading: projectsLoading, error: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    enabled: isOpen
  })

  const projects = projectsResponse?.items || []

  // Debug logging
  useEffect(() => {
    if (isOpen) {
      console.log('📊 Campaign Modal Debug:', {
        projectsLoading,
        projectsError,
        projectsResponse,
        projects: projects.length,
        projectsList: projects
      })
    }
  }, [isOpen, projectsLoading, projectsError, projectsResponse, projects])

  const createCampaignMutation = useMutation({
    mutationFn: campaignsApi.create,
    onSuccess: (data) => {
      // Invalidate all relevant queries to update dashboard numbers
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] })
      
      // Show success message
      setShowSuccess(true)
      
      // Auto close after 1.5 seconds (shorter for better UX)
      setTimeout(() => {
        setShowSuccess(false)
        onSuccess?.()
        onClose()
        setFormData({
          projectId: '',
          title: '',
          description: '',
          category: '',
          campaignType: '',
          rewardPool: '',
          maxSubmissions: '100',
        })
      }, 1500)
    },
    onError: (error) => {
      console.error('Failed to create campaign:', error)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim() || !formData.description.trim() || !formData.category || !formData.campaignType || !formData.rewardPool) {
      return
    }

    // Map frontend fields to backend fields
    const campaignData = {
      projectId: formData.projectId ? parseInt(formData.projectId) : undefined,
      title: formData.title,
      description: formData.description,
      category: formData.category,
      campaignType: formData.campaignType,
      rewardPool: parseInt(formData.rewardPool),
      maxSubmissions: parseInt(formData.maxSubmissions),
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
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
              <label htmlFor="projectId" className="block text-sm font-medium text-gray-700 mb-1">
                Project {projectsLoading ? '(Loading...)' : projects.length === 0 ? '(No projects available)' : '(Optional)'}
              </label>
              <select
                id="projectId"
                name="projectId"
                value={formData.projectId}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                disabled={projectsLoading || projects.length === 0}
              >
                <option value="">
                  {projectsLoading ? 'Loading projects...' : 
                   projects.length === 0 ? 'No projects available - Create a project first' : 
                   'Select project (optional)'}
                </option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {projectsError && (
                <p className="mt-1 text-sm text-red-600">
                  Failed to load projects. Please try again.
                </p>
              )}
              {projects.length === 0 && !projectsLoading && (
                <p className="mt-1 text-sm text-gray-500">
                  You can create campaigns without projects, or create a project first for better organization.
                </p>
              )}
            </div>

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
                placeholder="Describe your campaign"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="campaignType" className="block text-sm font-medium text-gray-700 mb-1">
                  Type *
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
                  {CATEGORIES.map(category => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="rewardPool" className="block text-sm font-medium text-gray-700 mb-1">
                  Reward Pool *
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
                <label htmlFor="maxSubmissions" className="block text-sm font-medium text-gray-700 mb-1">
                  Max Submissions
                </label>
                <input
                  type="number"
                  id="maxSubmissions"
                  name="maxSubmissions"
                  value={formData.maxSubmissions}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min="1"
                  required
                />
              </div>
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