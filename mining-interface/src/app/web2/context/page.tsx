'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { 
  SwatchIcon, 
  PhotoIcon, 
  DocumentTextIcon,
  LinkIcon,
  SparklesIcon,
  PlusIcon,
  TrashIcon,
  CloudArrowUpIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

interface ContextItem {
  id: string
  category: string
  sub_category?: string
  title: string
  description?: string
  content_type: 'text' | 'image' | 'pdf' | 'url'
  content_value?: string
  file_url?: string
  tags?: string[]
}

export default function ContextPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('brand')
  const [contextItems, setContextItems] = useState<ContextItem[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Form states for adding new context
  const [showAddModal, setShowAddModal] = useState(false)
  const [newItemCategory, setNewItemCategory] = useState('brand_assets')
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemType, setNewItemType] = useState<'text' | 'image' | 'pdf' | 'url'>('text')
  const [newItemContent, setNewItemContent] = useState('')
  const [newItemFile, setNewItemFile] = useState<File | null>(null)

  // Platform handles
  const [twitterHandle, setTwitterHandle] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [instagramHandle, setInstagramHandle] = useState('')

  const tabs = [
    { id: 'brand', label: 'Brand Assets', icon: SwatchIcon },
    { id: 'visual', label: 'Visual References', icon: PhotoIcon },
    { id: 'content', label: 'Text & Content', icon: DocumentTextIcon },
    { id: 'platforms', label: 'Platform Handles', icon: LinkIcon }
  ]

  useEffect(() => {
    fetchContextData()
  }, [])

  const fetchContextData = async () => {
    // TODO: Fetch from backend
    setIsLoading(true)
    try {
      // const response = await fetch(...)
      // setContextItems(response.data)
    } catch (error) {
      console.error('Failed to fetch context:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setNewItemFile(file)
      setNewItemTitle(file.name)
    }
  }

  const handleDragDrop = (event: React.DragEvent<HTMLDivElement>, category: string) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) {
      setNewItemFile(file)
      setNewItemTitle(file.name)
      setNewItemCategory(category)
      setShowAddModal(true)
    }
  }

  const handleAddContext = async () => {
    // TODO: Upload to backend
    console.log('Adding context:', {
      category: newItemCategory,
      title: newItemTitle,
      description: newItemDescription,
      type: newItemType,
      content: newItemContent,
      file: newItemFile
    })
    
    setShowAddModal(false)
    resetForm()
  }

  const resetForm = () => {
    setNewItemTitle('')
    setNewItemDescription('')
    setNewItemContent('')
    setNewItemFile(null)
    setNewItemType('text')
  }

  const handleDeleteContext = async (id: string) => {
    // TODO: Delete from backend
    setContextItems(prev => prev.filter(item => item.id !== id))
  }

  const savePlatformHandles = async () => {
    // TODO: Save to backend
    console.log('Saving platform handles:', {
      twitter: twitterHandle,
      linkedin: linkedinUrl,
      youtube: youtubeUrl,
      instagram: instagramHandle
    })
    alert('Platform handles saved successfully!')
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-white">Context Management</h1>
            <p className="text-sm text-gray-400">Add context to improve content generation across all workflows</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-medium rounded-lg transition-all flex items-center space-x-2"
          >
            <PlusIcon className="w-5 h-5" />
            <span>Add Context</span>
          </button>
        </header>

        {/* Tabs */}
        <div className="bg-gray-800/50 border-b border-gray-700 px-6 flex space-x-1 flex-shrink-0">
          {tabs.map((tab) => {
            const IconComponent = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={'px-4 py-3 flex items-center space-x-2 border-b-2 transition-colors ' + (activeTab === tab.id ? 'border-orange-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-300')}
              >
                <IconComponent className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {/* Brand Assets Tab */}
            {activeTab === 'brand' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Logo Upload */}
                <div 
                  className="bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 p-6 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDragDrop(e, 'brand_assets')}
                >
                  <div className="flex items-center space-x-3 mb-4">
                    <SwatchIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Brand Logo</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Upload your primary logo (PNG with transparency recommended)</p>
                  <label className="block">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    <div className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors">
                      <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <span className="text-sm">Click or drag & drop</span>
                    </div>
                  </label>
                </div>

                {/* Brand Colors */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <SwatchIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Brand Colors</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Primary Color</label>
                      <input type="text" placeholder="#000000 or rgb(0,0,0)" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Secondary Color</label>
                      <input type="text" placeholder="#000000 or rgb(0,0,0)" className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                    </div>
                    <button className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
                      + Add More Colors
                    </button>
                  </div>
                </div>

                {/* Brand Voice */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Brand Voice</h3>
                  </div>
                  <textarea
                    placeholder="Describe your brand voice (e.g., professional, friendly, casual, authoritative)..."
                    rows={4}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>

                {/* Brand Guidelines */}
                <div 
                  className="bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 p-6 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDragDrop(e, 'brand_assets')}
                >
                  <div className="flex items-center space-x-3 mb-4">
                    <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Brand Guidelines PDF</h3>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">Upload your brand style guide or guidelines document</p>
                  <label className="block">
                    <input type="file" accept=".pdf" className="hidden" />
                    <div className="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white transition-colors">
                      <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <span className="text-sm">Upload PDF</span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Visual References Tab */}
            {activeTab === 'visual' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Product Photos */}
                <div 
                  className="bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 p-6 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDragDrop(e, 'visual_references')}
                >
                  <PhotoIcon className="w-12 h-12 mx-auto mb-3 text-gray-500" />
                  <h3 className="text-center font-semibold text-white mb-2">Product Photos</h3>
                  <p className="text-sm text-gray-400 text-center mb-4">Upload product images for reference</p>
                  <label className="block">
                    <input type="file" accept="image/*" multiple className="hidden" />
                    <div className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white text-sm transition-colors">
                      Upload Images
                    </div>
                  </label>
                </div>

                {/* Inspiration/Mood Board */}
                <div 
                  className="bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 p-6 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDragDrop(e, 'visual_references')}
                >
                  <SparklesIcon className="w-12 h-12 mx-auto mb-3 text-gray-500" />
                  <h3 className="text-center font-semibold text-white mb-2">Inspiration</h3>
                  <p className="text-sm text-gray-400 text-center mb-4">Add mood board or style references</p>
                  <label className="block">
                    <input type="file" accept="image/*" multiple className="hidden" />
                    <div className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white text-sm transition-colors">
                      Upload Images
                    </div>
                  </label>
                </div>

                {/* Past Successful Content */}
                <div 
                  className="bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-600 p-6 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDragDrop(e, 'visual_references')}
                >
                  <PhotoIcon className="w-12 h-12 mx-auto mb-3 text-gray-500" />
                  <h3 className="text-center font-semibold text-white mb-2">Past Content</h3>
                  <p className="text-sm text-gray-400 text-center mb-4">Examples of your best content</p>
                  <label className="block">
                    <input type="file" accept="image/*" multiple className="hidden" />
                    <div className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer text-center text-white text-sm transition-colors">
                      Upload Images
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Text & Content Tab */}
            {activeTab === 'content' && (
              <div className="grid grid-cols-1 gap-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Brand Story */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <h3 className="font-semibold text-white mb-3 flex items-center space-x-2">
                      <DocumentTextIcon className="w-5 h-5 text-orange-400" />
                      <span>Brand Story</span>
                    </h3>
                    <textarea
                      placeholder="Tell your brand's story, mission, and what makes you unique..."
                      rows={5}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>

                  {/* Key Messaging */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <h3 className="font-semibold text-white mb-3 flex items-center space-x-2">
                      <DocumentTextIcon className="w-5 h-5 text-orange-400" />
                      <span>Key Messages</span>
                    </h3>
                    <textarea
                      placeholder="Your main talking points, value propositions, taglines..."
                      rows={5}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>

                  {/* Target Audience */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <h3 className="font-semibold text-white mb-3 flex items-center space-x-2">
                      <DocumentTextIcon className="w-5 h-5 text-orange-400" />
                      <span>Target Audience</span>
                    </h3>
                    <textarea
                      placeholder="Describe your ideal customer, demographics, interests, pain points..."
                      rows={5}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>

                  {/* Content Do's and Don'ts */}
                  <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                    <h3 className="font-semibold text-white mb-3 flex items-center space-x-2">
                      <DocumentTextIcon className="w-5 h-5 text-orange-400" />
                      <span>Do's & Don'ts</span>
                    </h3>
                    <textarea
                      placeholder="Topics/words to avoid, preferred terminology, content restrictions..."
                      rows={5}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Platform Handles Tab */}
            {activeTab === 'platforms' && (
              <div className="max-w-4xl mx-auto">
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-white mb-2">Platform Handles & URLs</h3>
                    <p className="text-sm text-gray-400">
                      Add your social media handles to analyze your style, voice, and successful content patterns
                    </p>
                  </div>

                  <div className="space-y-6">
                    {/* Twitter/X */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Twitter/X Handle
                      </label>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-400">@</span>
                        <input
                          type="text"
                          value={twitterHandle}
                          onChange={(e) => setTwitterHandle(e.target.value)}
                          placeholder="username"
                          className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">We'll analyze your tweet style, tone, and successful patterns</p>
                    </div>

                    {/* LinkedIn */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        LinkedIn Profile/Company URL
                      </label>
                      <input
                        type="url"
                        value={linkedinUrl}
                        onChange={(e) => setLinkedinUrl(e.target.value)}
                        placeholder="https://linkedin.com/in/username or /company/name"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">We'll learn your professional tone and content themes</p>
                    </div>

                    {/* YouTube */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        YouTube Channel URL
                      </label>
                      <input
                        type="url"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        placeholder="https://youtube.com/@channel"
                        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">We'll analyze video titles, thumbnails, and description styles</p>
                    </div>

                    {/* Instagram */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Instagram Handle
                      </label>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-400">@</span>
                        <input
                          type="text"
                          value={instagramHandle}
                          onChange={(e) => setInstagramHandle(e.target.value)}
                          placeholder="username"
                          className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">We'll learn your visual aesthetic and caption style</p>
                    </div>

                    {/* Save Button */}
                    <div className="pt-4 border-t border-gray-700">
                      <button
                        onClick={savePlatformHandles}
                        className="px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-medium rounded-lg transition-all"
                      >
                        Save Platform Handles
                      </button>
                    </div>
                  </div>
                </div>

                {/* Additional Context URLs */}
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 mt-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-white mb-2">Additional Reference URLs</h3>
                    <p className="text-sm text-gray-400">
                      Add competitor sites, inspiration sources, or any relevant URLs for context
                    </p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <input
                        type="url"
                        placeholder="https://example.com"
                        className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <button className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
                        <PlusIcon className="w-5 h-5 text-gray-300" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Save Button - Fixed at bottom */}
        <div className="bg-gray-800/50 border-t border-gray-700 px-6 py-4 flex-shrink-0">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <p className="text-sm text-gray-400">
              <span className="text-orange-400">💡 Tip:</span> More context = better AI-generated content
            </p>
            <button className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-medium rounded-lg transition-all">
              Save All Changes
            </button>
          </div>
        </div>
      </div>

      {/* Add Context Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">Add New Context</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="brand_assets">Brand Assets</option>
                    <option value="visual_references">Visual References</option>
                    <option value="text_content">Text Content</option>
                    <option value="platform_handles">Platform Handles</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Title</label>
                  <input
                    type="text"
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    placeholder="Give this context a name"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Type</label>
                  <div className="flex space-x-2">
                    {(['text', 'image', 'pdf', 'url'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewItemType(type)}
                        className={'px-4 py-2 rounded-lg transition-colors ' + (newItemType === type ? 'bg-orange-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600')}
                      >
                        {type.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {newItemType === 'text' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Content</label>
                    <textarea
                      value={newItemContent}
                      onChange={(e) => setNewItemContent(e.target.value)}
                      placeholder="Enter your text content..."
                      rows={6}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>
                )}

                {newItemType === 'url' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">URL</label>
                    <input
                      type="url"
                      value={newItemContent}
                      onChange={(e) => setNewItemContent(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                )}

                {(newItemType === 'image' || newItemType === 'pdf') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">File</label>
                    <input
                      type="file"
                      accept={newItemType === 'image' ? 'image/*' : '.pdf'}
                      onChange={handleFileUpload}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
                  <textarea
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    placeholder="Add notes or description..."
                    rows={3}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddContext}
                  className="px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg transition-all"
                >
                  Add Context
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

