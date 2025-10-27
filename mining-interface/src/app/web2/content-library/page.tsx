'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon, EyeIcon, PencilIcon, ShareIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
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
  product_categories?: string[]
  user_prompt?: string
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
  const [currentInputImageIndex, setCurrentInputImageIndex] = useState(0)
  const [currentOutputImageIndex, setCurrentOutputImageIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const jobsPerPage = 12

  useEffect(() => {
    let isMounted = true
    
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    if (!web2Auth) {
      if (isMounted) {
        router.push('/web2/auth')
      }
      return
    }
    
    fetchJobs()
    
    return () => {
      isMounted = false
    }
  }, []) // Empty dependency array to run only once

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
    let filtered = jobs
    
    // Apply content type filter
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(job => job.content_type === selectedFilter)
    }
    
    // Apply search filter
    filtered = searchJobs(filtered, searchQuery)
    
    // Update filtered jobs
    setFilteredJobs(filtered)
    
    // Calculate total pages
    const totalPagesCount = Math.ceil(filtered.length / jobsPerPage)
    setTotalPages(totalPagesCount)
    
    // Reset to page 1 if current page exceeds total pages
    if (currentPage > totalPagesCount) {
      setCurrentPage(1)
    }
  }, [selectedFilter, jobs, searchQuery, currentPage])

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

  const handleEdit = (job: GeneratedJob, imageIndex?: number) => {
    if (!job.generated_image_urls || job.generated_image_urls.length === 0) {
      toast.error('No images available for editing')
      return
    }

    // Use the provided imageIndex or default to 0
    const selectedIndex = imageIndex !== undefined ? imageIndex : 0
    const imageUrl = job.generated_image_urls[selectedIndex]
    const originalPrompt = job.workflow_metadata?.original_prompt || 'Generated content'
    // Get product category from the first item in product_categories array
    const productCategory = job.product_categories && job.product_categories.length > 0 
      ? job.product_categories[0] 
      : 'Unknown'

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

  const searchJobs = (jobs: GeneratedJob[], query: string) => {
    if (!query.trim()) return jobs
    
    const lowercaseQuery = query.toLowerCase()
    
    return jobs.filter(job => {
      // Search in workflow type
      if (job.workflow_type?.toLowerCase().includes(lowercaseQuery)) return true
      
      // Search in industry
      if (job.workflow_metadata?.industry?.toLowerCase().includes(lowercaseQuery)) return true
      
      // Search in product categories
      if (job.product_categories?.some(category => 
        category.toLowerCase().includes(lowercaseQuery)
      )) return true
      
      // Search in generated prompts
      if (job.workflow_metadata?.generated_prompts?.some((prompt: string) => 
        prompt.toLowerCase().includes(lowercaseQuery)
      )) return true
      
      // Search in original prompt
      if (job.workflow_metadata?.original_prompt?.toLowerCase().includes(lowercaseQuery)) return true
      
      // Search in user prompt
      if (job.user_prompt?.toLowerCase().includes(lowercaseQuery)) return true
      
      return false
    })
  }

  const paginateJobs = (jobs: GeneratedJob[], page: number) => {
    const startIndex = (page - 1) * jobsPerPage
    const endIndex = startIndex + jobsPerPage
    return jobs.slice(startIndex, endIndex)
  }

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
    setCurrentPage(1) // Reset to first page when searching
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
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
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Content Library</h1>
          
          {/* Search Bar */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search jobs, prompts, categories..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-96 pl-10 pr-10 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
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
                  All ({searchJobs(jobs, searchQuery).length})
                </button>
                <button
                  onClick={() => setSelectedFilter('image')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedFilter === 'image'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Images ({searchJobs(jobs, searchQuery).filter(j => j.content_type === 'image').length})
                </button>
                <button
                  onClick={() => setSelectedFilter('video')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedFilter === 'video'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Videos ({searchJobs(jobs, searchQuery).filter(j => j.content_type === 'video').length})
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
                {paginateJobs(filteredJobs, currentPage).map((job) => (
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
                          <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                            <div className="flex items-center">
                              <EyeIcon className="w-3 h-3 mr-1" />
                              Input Images ({job.user_images.length})
                            </div>
                            {job.user_images.length > 2 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openModal(job, 0, true)
                                }}
                                className="text-blue-400 hover:text-blue-300 text-xs underline"
                              >
                                View All
                              </button>
                            )}
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
                        <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                          <span>Generated Images</span>
                          {job.content_type === 'image' && job.generated_image_urls && job.generated_image_urls.length > 4 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openModal(job, 0, false)
                              }}
                              className="text-blue-400 hover:text-blue-300 text-xs underline"
                            >
                              View All ({job.generated_image_urls.length})
                            </button>
                          )}
                        </div>
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
                            {job.product_categories && job.product_categories.length > 0 && (
                              <span className="px-2 py-1 bg-blue-700 rounded">
                                {job.product_categories[0]}
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
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center mt-8 space-x-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 bg-gray-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
                >
                  Previous
                </button>
                
                <div className="flex space-x-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === pageNum
                            ? 'bg-orange-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 bg-gray-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
            
            {/* Results Summary */}
            <div className="text-center mt-4 text-gray-400 text-sm">
              Showing {Math.min((currentPage - 1) * jobsPerPage + 1, filteredJobs.length)}-{Math.min(currentPage * jobsPerPage, filteredJobs.length)} of {filteredJobs.length} jobs
              {searchQuery && (
                <span className="ml-2">
                  for "{searchQuery}"
                </span>
              )}
            </div>
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
            <div className="flex-1 flex items-center justify-center p-4 relative">
              {/* Navigation Arrows */}
              {showInputImages && modalJob.user_images && modalJob.user_images.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const newIndex = modalImageIndex > 0 ? modalImageIndex - 1 : modalJob.user_images!.length - 1
                      setModalImageIndex(newIndex)
                    }}
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg z-20"
                  >
                    ‹
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const newIndex = modalImageIndex < modalJob.user_images!.length - 1 ? modalImageIndex + 1 : 0
                      setModalImageIndex(newIndex)
                    }}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg z-20"
                  >
                    ›
                  </button>
                </>
              )}
              
              {!showInputImages && modalJob.content_type === 'image' && modalJob.generated_image_urls && modalJob.generated_image_urls.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const newIndex = modalImageIndex > 0 ? modalImageIndex - 1 : modalJob.generated_image_urls!.length - 1
                      setModalImageIndex(newIndex)
                    }}
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg z-20"
                  >
                    ‹
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const newIndex = modalImageIndex < modalJob.generated_image_urls!.length - 1 ? modalImageIndex + 1 : 0
                      setModalImageIndex(newIndex)
                    }}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-gray-800 hover:bg-gray-700 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg z-20"
                  >
                    ›
                  </button>
                </>
              )}

              {/* Image Display */}
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

              {/* Image Counter */}
              {((showInputImages && modalJob.user_images && modalJob.user_images.length > 1) || 
                (!showInputImages && modalJob.content_type === 'image' && modalJob.generated_image_urls && modalJob.generated_image_urls.length > 1)) && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800 bg-opacity-75 text-white px-3 py-1 rounded-full text-sm">
                  {modalImageIndex + 1} / {showInputImages ? modalJob.user_images!.length : modalJob.generated_image_urls!.length}
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
                    onClick={() => handleEdit(modalJob, modalImageIndex)}
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
