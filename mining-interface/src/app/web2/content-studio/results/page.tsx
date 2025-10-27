'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import Image from 'next/image'

interface GeneratedResult {
  images: string[]
  caption: string
  workflow: string
  productCategory?: string
  setting?: string
}

export default function ResultsPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [results, setResults] = useState<GeneratedResult | null>(null)
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set())
  const [editedCaption, setEditedCaption] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())

  const platforms = [
    { id: 'twitter', name: 'Twitter', icon: '𝕏', color: 'from-black to-gray-800' },
    { id: 'linkedin', name: 'LinkedIn', icon: '💼', color: 'from-blue-600 to-blue-800' },
    { id: 'instagram', name: 'Instagram', icon: '📷', color: 'from-pink-600 to-purple-600' }
  ]

  useEffect(() => {
    const storedResults = sessionStorage.getItem('generated_images')
    if (storedResults) {
      const parsedResults = JSON.parse(storedResults)
      setResults(parsedResults)
      setEditedCaption(parsedResults.caption || '')
      // Select all images by default
      setSelectedImages(new Set(parsedResults.images.map((_: any, idx: number) => idx)))
    } else {
      router.push('/web2/content-studio')
    }
  }, [router])

  const toggleImageSelection = (index: number) => {
    const newSelected = new Set(selectedImages)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedImages(newSelected)
  }

  const togglePlatform = (platformId: string) => {
    const newSelected = new Set(selectedPlatforms)
    if (newSelected.has(platformId)) {
      newSelected.delete(platformId)
    } else {
      newSelected.add(platformId)
    }
    setSelectedPlatforms(newSelected)
  }

  const handlePost = async () => {
    if (selectedImages.size === 0) {
      alert('Please select at least one image to post')
      return
    }

    if (selectedPlatforms.size === 0) {
      alert('Please select at least one platform')
      return
    }

    // TODO: Implement posting logic
    alert(`Posting ${selectedImages.size} image(s) to ${Array.from(selectedPlatforms).join(', ')}`)
  }

  const handleDownload = () => {
    if (selectedImages.size === 0) {
      alert('Please select at least one image to download')
      return
    }

    // TODO: Implement download logic
    alert(`Downloading ${selectedImages.size} image(s)`)
  }

  const handleRegenerate = () => {
    router.back()
  }

  if (!results) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center">
        <div className="text-white text-xl">Loading results...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <h1 className="text-3xl font-bold text-white flex items-center">
                  <span className="mr-3">✨</span>
                  Generated Content
                </h1>
              </div>
              <p className="text-gray-400">
                Review, edit, and publish your AI-generated content
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRegenerate}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
              >
                <span>🔄</span>
                <span>Regenerate</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Images Grid */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <h2 className="text-xl font-bold text-white mb-4">
                    Generated Images ({results.images.length})
                  </h2>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {results.images.map((imageUrl, index) => (
                      <div
                        key={index}
                        onClick={() => toggleImageSelection(index)}
                        className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all
                          ${selectedImages.has(index) 
                            ? 'border-blue-500 shadow-lg shadow-blue-500/20' 
                            : 'border-transparent hover:border-gray-600'}`}
                      >
                        <div className="relative aspect-square">
                          <Image
                            src={imageUrl}
                            alt={`Generated image ${index + 1}`}
                            fill
                            className="object-cover"
                          />
                          {selectedImages.has(index) && (
                            <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-sm text-gray-400 mt-4">
                    Click images to select/deselect
                  </p>
                </div>

                {/* Caption Editor */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <h2 className="text-xl font-bold text-white mb-4">Caption</h2>
                  <textarea
                    value={editedCaption}
                    onChange={(e) => setEditedCaption(e.target.value)}
                    rows={4}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Write your caption..."
                  />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-gray-400">
                      {editedCaption.length} characters
                    </span>
                    <button
                      onClick={() => setEditedCaption(results.caption)}
                      className="text-sm text-blue-400 hover:text-blue-300"
                    >
                      Reset to AI caption
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions Panel */}
              <div className="space-y-6">
                {/* Platform Selection */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <h2 className="text-xl font-bold text-white mb-4">Select Platforms</h2>
                  <div className="space-y-3">
                    {platforms.map((platform) => (
                      <button
                        key={platform.id}
                        onClick={() => togglePlatform(platform.id)}
                        className={`w-full px-4 py-3 rounded-lg font-medium transition-all flex items-center space-x-3
                          ${selectedPlatforms.has(platform.id)
                            ? `bg-gradient-to-r ${platform.color} text-white`
                            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'}`}
                      >
                        <span className="text-xl">{platform.icon}</span>
                        <span>{platform.name}</span>
                        {selectedPlatforms.has(platform.id) && (
                          <svg className="w-5 h-5 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <h2 className="text-xl font-bold text-white mb-4">Actions</h2>
                  <div className="space-y-3">
                    <button
                      onClick={handlePost}
                      disabled={selectedImages.size === 0 || selectedPlatforms.size === 0}
                      className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      <span>🚀</span>
                      <span>Post Now</span>
                    </button>

                    <button
                      onClick={handleDownload}
                      disabled={selectedImages.size === 0}
                      className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      <span>⬇️</span>
                      <span>Download Selected</span>
                    </button>

                    <button
                      onClick={() => router.push('/web2/content-library')}
                      className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
                    >
                      <span>💾</span>
                      <span>Save to Library</span>
                    </button>
                  </div>
                </div>

                {/* Metadata */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <h2 className="text-xl font-bold text-white mb-4">Details</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Workflow:</span>
                      <span className="text-white font-medium capitalize">
                        {results.workflow.replace('-', ' ')}
                      </span>
                    </div>
                    {results.productCategory && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Category:</span>
                        <span className="text-white font-medium">{results.productCategory}</span>
                      </div>
                    )}
                    {results.setting && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Setting:</span>
                        <span className="text-white font-medium">{results.setting}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Images:</span>
                      <span className="text-white font-medium">{results.images.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

