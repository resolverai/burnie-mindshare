'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon, EyeIcon, PencilIcon, ShareIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface GeneratedJob {
  id: number
  job_id: string
  content_type: 'image' | 'video'
  workflow_type: string
  status: string
  created_at: string
  generated_image_urls?: string[]
  generated_video_urls?: string[]
  user_images?: string[]
  workflow_metadata?: any
  progress_percent?: number
  progress_message?: string
}

export default function ContentLibraryPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [jobs, setJobs] = useState<GeneratedJob[]>([])
  const [filteredJobs, setFilteredJobs] = useState<GeneratedJob[]>([])
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'image' | 'video'>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalJob, setModalJob] = useState<GeneratedJob | null>(null)
  const [modalImageIndex, setModalImageIndex] = useState(0)
  const [selectedPlatform, setSelectedPlatform] = useState<'twitter' | 'instagram' | 'linkedin'>('twitter')
  const [showInputImages, setShowInputImages] = useState(false)

  useEffect(() => {
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    if (!web2Auth) {
      router.push('/web2/auth')
      return
    }
    fetchJobs()
  }, [router])

  const fetchJobs = async () => {
    try {
      const accountId = localStorage.getItem('burnie_web2_account_id')
      console.log('🔍 Fetching jobs for account ID:', accountId)
      
      if (!accountId) {
        toast.error('Account ID not found')
        return
      }

      const response = await fetch(`/api/web2/generated-content/${accountId}?limit=50`)
      console.log('🔍 API Response status:', response.status)
      
      if (!response.ok) {
        throw new Error('Failed to fetch jobs')
      }

      const data = await response.json()
      console.log('🔍 API Response data:', data)
      console.log('🔍 Jobs count:', data.data?.length || 0)
      
      setJobs(data.data || [])
      setFilteredJobs(data.data || [])
    } catch (error) {
      console.error('Error fetching jobs:', error)
      toast.error('Failed to load content library')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (selectedFilter === 'all') {
      setFilteredJobs(jobs)
    } else {
      setFilteredJobs(jobs.filter(job => job.content_type === selectedFilter))
    }
  }, [selectedFilter, jobs])

  const openModal = (job: GeneratedJob, imageIndex: number = 0, isInputImage: boolean = false) => {
    setModalJob(job)
    setModalImageIndex(imageIndex)
    setShowInputImages(isInputImage)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setModalJob(null)
    setModalImageIndex(0)
    setShowInputImages(false)
  }

  const handleEdit = (job: GeneratedJob) => {
    if (!job.generated_image_urls || job.generated_image_urls.length === 0) {
      toast.error('No images available for editing')
      return
    }

    // Get the first image for editing
    const imageUrl = job.generated_image_urls[0]
    const originalPrompt = job.workflow_metadata?.original_prompt || 'Generated content'
    const productCategory = job.workflow_metadata?.product_category || 'Unknown'

    const params = new URLSearchParams({
      imageUrl,
      originalPrompt,
      productCategory,
      accountId: localStorage.getItem('burnie_web2_account_id') || '0'
    })

    router.push(`/web2/content-studio/fashion/simple-workflow/edit?${params.toString()}`)
  }

  const handlePost = (platform: string) => {
    toast.success(`Posting to ${platform}...`)
    // TODO: Implement actual posting functionality
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getWorkflowDisplayName = (workflowType: string) => {
    const workflowNames: { [key: string]: string } = {
      'Simple Workflow': 'Simple Workflow',
      'Model Diversity Showcase': 'Model Diversity',
      'Lifestyle & Context Variations': 'Lifestyle & Context',
      'Color & Style Variations': 'Color & Style',
      'Before/After Styling': 'Before/After',
      'Seasonal Campaign': 'Seasonal Campaign',
      'Edit Flow': 'Edit Flow'
    }
    return workflowNames[workflowType] || workflowType
  }

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 transition-all duration-300 ${
          sidebarExpanded ? 'ml-64' : 'ml-20'
        }`}>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        sidebarExpanded ? 'ml-64' : 'ml-20'
      }`}>
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Content Library</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-3xl font-bold text-white">Content Library</h1>
              <div className="flex space-x-2">
                <button
                  onClick={() => setSelectedFilter('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedFilter === 'all'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  All ({jobs.length})
                </button>
                <button
                  onClick={() => setSelectedFilter('image')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedFilter === 'image'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Images ({jobs.filter(j => j.content_type === 'image').length})
                </button>
                <button
                  onClick={() => setSelectedFilter('video')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedFilter === 'video'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Videos ({jobs.filter(j => j.content_type === 'video').length})
                </button>
              </div>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-400 text-lg mb-2">No content found</div>
                <p className="text-gray-500">Your generated content will appear here.</p>
                <div className="text-xs text-gray-600 mt-4">
                  Debug: Jobs count: {jobs.length}, Filtered: {filteredJobs.length}, Filter: {selectedFilter}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredJobs.map((job) => (
                  <div key={job.id} className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            job.content_type === 'image' 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-purple-600 text-white'
                          }`}>
                            {job.content_type.toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-400">
                            {getWorkflowDisplayName(job.workflow_type)}
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          job.status === 'completed' 
                            ? 'bg-green-600 text-white' 
                            : job.status === 'generating'
                            ? 'bg-yellow-600 text-white'
                            : 'bg-gray-600 text-white'
                        }`}>
                          {job.status}
                        </span>
                      </div>

                      <div className="text-sm text-gray-300 mb-3">
                        {formatDate(job.created_at)}
                      </div>

                      {/* Input Images Section */}
                      {job.user_images && job.user_images.length > 0 && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-400 mb-2 flex items-center">
                            <EyeIcon className="w-3 h-3 mr-1" />
                            Input Images ({job.user_images.length})
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {job.user_images.slice(0, 2).map((imageUrl, index) => (
                              <div
                                key={`input-${index}`}
                                className="aspect-square relative cursor-pointer group border border-gray-600 rounded"
                                onClick={() => openModal(job, index, true)}
                              >
                                <Image
                                  src={imageUrl}
                                  alt={`Input image ${index + 1}`}
                                  fill
                                  className="object-cover rounded group-hover:opacity-80 transition-opacity"
                                />
                                {job.user_images && job.user_images.length > 2 && index === 1 && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded">
                                    <span className="text-white text-xs font-medium">
                                      +{job.user_images.length - 2}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Output Images Section */}
                      <div className="mb-4">
                        <div className="text-xs text-gray-400 mb-2">Generated Images</div>
                        <div className="grid grid-cols-2 gap-2">
                          {job.content_type === 'image' && job.generated_image_urls ? (
                            job.generated_image_urls.slice(0, 4).map((imageUrl, index) => (
                              <div
                                key={`output-${index}`}
                                className="aspect-square relative cursor-pointer group"
                                onClick={() => openModal(job, index, false)}
                              >
                                <Image
                                  src={imageUrl}
                                  alt={`Generated image ${index + 1}`}
                                  fill
                                  className="object-cover rounded-lg group-hover:opacity-80 transition-opacity"
                                />
                                {job.generated_image_urls && job.generated_image_urls.length > 4 && index === 3 && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                                    <span className="text-white text-sm font-medium">
                                      +{job.generated_image_urls.length - 4}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))
                          ) : job.content_type === 'video' && job.generated_video_urls ? (
                            job.generated_video_urls.slice(0, 4).map((videoUrl, index) => (
                              <div
                                key={`video-${index}`}
                                className="aspect-square relative cursor-pointer group bg-gray-700 rounded-lg flex items-center justify-center"
                                onClick={() => openModal(job, index, false)}
                              >
                                <div className="text-gray-400 text-sm">Video {index + 1}</div>
                              </div>
                            ))
                          ) : (
                            <div className="col-span-2 aspect-square bg-gray-700 rounded-lg flex items-center justify-center">
                              <span className="text-gray-400 text-sm">No content</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Generation Parameters Summary */}
                      {job.workflow_metadata && (
                        <div className="text-xs text-gray-400 mb-2">
                          <div className="flex flex-wrap gap-1">
                            {job.workflow_metadata.num_variations && (
                              <span className="px-2 py-1 bg-gray-700 rounded">
                                {job.workflow_metadata.num_variations} variations
                              </span>
                            )}
                            {job.workflow_metadata.industry && (
                              <span className="px-2 py-1 bg-gray-700 rounded">
                                {job.workflow_metadata.industry}
                              </span>
                            )}
                            {job.workflow_metadata.product_category && (
                              <span className="px-2 py-1 bg-gray-700 rounded">
                                {job.workflow_metadata.product_category}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && modalJob && (
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
            
            {/* Image/Video Section */}
            <div className="flex-1 flex items-center justify-center p-4">
              {showInputImages && modalJob.user_images ? (
                <Image
                  src={modalJob.user_images[modalImageIndex]}
                  alt={`Input image ${modalImageIndex + 1}`}
                  width={600}
                  height={600}
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              ) : modalJob.content_type === 'image' && modalJob.generated_image_urls ? (
                <Image
                  src={modalJob.generated_image_urls[modalImageIndex]}
                  alt={`Generated image ${modalImageIndex + 1}`}
                  width={600}
                  height={600}
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              ) : (
                <div className="w-full h-96 bg-gray-700 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400">Video content</span>
                </div>
              )}
            </div>
            
            {/* Action Panel */}
            <div className="w-80 bg-gray-800 p-6 flex flex-col">
              <h3 className="text-lg font-semibold text-white mb-4">
                {showInputImages ? 'Input Image Details' : 'Actions'}
              </h3>
              
              {/* Job Info */}
              <div className="mb-4 text-sm text-gray-300">
                <div className="mb-2">
                  <span className="font-medium">Workflow:</span> {getWorkflowDisplayName(modalJob.workflow_type)}
                </div>
                <div className="mb-2">
                  <span className="font-medium">Created:</span> {formatDate(modalJob.created_at)}
                </div>
                <div className="mb-2">
                  <span className="font-medium">Status:</span> {modalJob.status}
                </div>
                {showInputImages && modalJob.user_images && (
                  <div className="mb-2">
                    <span className="font-medium">Total Input Images:</span> {modalJob.user_images.length}
                  </div>
                )}
              </div>

              {/* Action Buttons - Only show for output images */}
              {!showInputImages && (
                <div className="space-y-3">
                  <button
                    onClick={() => handleEdit(modalJob)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2"
                  >
                    <PencilIcon className="w-4 h-4" />
                    <span>Edit</span>
                  </button>

                  {/* Platform Posting */}
                  <div className="space-y-2">
                    <div className="text-sm text-gray-300 font-medium">Post to Platform:</div>
                    <div className="flex space-x-2">
                      {['twitter', 'instagram', 'linkedin'].map((platform) => (
                        <button
                          key={platform}
                          onClick={() => handlePost(platform)}
                          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                            selectedPlatform === platform
                              ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {platform.charAt(0).toUpperCase() + platform.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
