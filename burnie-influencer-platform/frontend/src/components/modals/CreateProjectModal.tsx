'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api'
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export default function CreateProjectModal({ isOpen, onClose, onSuccess }: CreateProjectModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    website_url: ''
  })
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState('')

  const queryClient = useQueryClient()

  const createProjectMutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (data) => {
      // Invalidate all relevant queries to update dashboard numbers
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] })
      
      // Show success message
      setShowSuccess(true)
      
      // Auto close after 1.5 seconds (shorter for better UX)
      setTimeout(() => {
        setShowSuccess(false)
        onSuccess?.()
        onClose()
        setFormData({ name: '', description: '', website_url: '' })
      }, 1500)
    },
    onError: (error) => {
      console.error('Failed to create project:', error)
    }
  })

  const resetForm = () => {
    setFormData({ name: '', description: '', website_url: '' })
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.description.trim()) {
      setError('Please fill in all required fields')
      return
    }

    // Map frontend fields to backend fields
    const projectData = {
      name: formData.name,
      description: formData.description,
      website: formData.website_url
    }

    createProjectMutation.mutate(projectData)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
          <h3 className="text-lg font-semibold text-gray-900">Create New Project</h3>
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
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Project Created Successfully! 🎉</h4>
            <p className="text-gray-600">Your project has been saved to the database.<br/>Dashboard will update automatically.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Project Name *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter project name"
                required
              />
            </div>

            <div className="mb-4">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Project Description *
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Describe your project and its goals"
                required
              />
            </div>

            <div className="mb-6">
              <label htmlFor="website_url" className="block text-sm font-medium text-gray-700 mb-1">
                Website URL
              </label>
              <input
                type="url"
                id="website_url"
                name="website_url"
                value={formData.website_url}
                onChange={handleChange}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://yourproject.com"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                disabled={createProjectMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createProjectMutation.isPending}
                className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
              >
                {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
              </button>
            </div>

            {createProjectMutation.isError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-700 text-sm">
                  Failed to create project. Please try again.
                </p>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
} 