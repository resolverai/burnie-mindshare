'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { PhotoIcon, VideoCameraIcon, SparklesIcon, Bars3Icon } from '@heroicons/react/24/outline'

export default function ContentStudioPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [industry, setIndustry] = useState<string>('')

  useEffect(() => {
    // Check authentication
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')
    
    if (!web2Auth || !accountId) {
      router.push('/web2/auth')
      return
    }

    // Fetch account industry from Account table
    const fetchIndustry = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-accounts/${accountId}`,
          {
            headers: {
              'Authorization': `Bearer ${web2Auth}`
            }
          }
        )
        
        if (response.ok) {
          const data = await response.json()
          const accountIndustry = data.data?.industry || ''
          console.log('Fetched industry from account:', accountIndustry)
          setIndustry(accountIndustry)
        }
      } catch (error) {
        console.error('Failed to fetch industry:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchIndustry()
  }, [router])

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 transition-all duration-300 ${
          sidebarExpanded ? 'ml-64' : 'ml-20'
        }`}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        sidebarExpanded ? 'ml-64' : 'ml-20'
      }`}>
        {/* Fixed Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Content Studio</h1>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Content Studio</h1>
            <p className="text-gray-400">
              Create AI-powered images and videos for your social media
            </p>
          </div>

          {/* Content Type Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Image Generation */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8 hover:border-orange-500/50 transition-all cursor-pointer group">
              <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl mb-6 group-hover:scale-110 transition-transform">
                <PhotoIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Generate Images</h3>
              <p className="text-gray-400 mb-6">
                Create stunning images using AI. Perfect for social media posts, ads, and marketing materials.
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  Multiple styles and variations
                </li>
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  Logo integration available
                </li>
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  High-resolution output
                </li>
              </ul>
              <button 
                onClick={() => {
                  console.log('Current industry:', industry)
                  // Route based on industry (exact match)
                  if (industry === 'fashion') {
                    router.push('/web2/content-studio/fashion')
                  } else if (industry === 'social_media_management') {
                    router.push('/web2/content-studio/social-media')
                  } else if (industry === 'design_agency') {
                    router.push('/web2/content-studio/design-agency')
                  } else {
                    // Route to no-workflows page with industry info
                    router.push('/web2/content-studio/no-workflows?type=image')
                  }
                }}
                className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors">
                Start Creating Images →
              </button>
            </div>

            {/* Video Generation */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8 hover:border-orange-500/50 transition-all cursor-pointer group">
              <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl mb-6 group-hover:scale-110 transition-transform">
                <VideoCameraIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Generate Videos</h3>
              <p className="text-gray-400 mb-6">
                Create engaging videos with AI. Ideal for social media, ads, and promotional content.
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  Multiple video formats
                </li>
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  AI voiceover and music
                </li>
                <li className="flex items-center text-sm text-gray-300">
                  <SparklesIcon className="w-4 h-4 text-orange-400 mr-2" />
                  Ready for all platforms
                </li>
              </ul>
              <button 
                onClick={() => {
                  console.log('Current industry:', industry)
                  // Route based on industry (exact match)
                  if (industry === 'fashion') {
                    router.push('/web2/content-studio/fashion')
                  } else if (industry === 'social_media_management') {
                    router.push('/web2/content-studio/social-media')
                  } else if (industry === 'design_agency') {
                    router.push('/web2/content-studio/design-agency')
                  } else {
                    // Route to no-workflows page with industry info
                    router.push('/web2/content-studio/no-workflows?type=video')
                  }
                }}
                className="w-full px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg transition-colors">
                Start Creating Videos →
              </button>
            </div>
          </div>

          {/* Quick Tips */}
          <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/30 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-3">💡 Pro Tips</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>• Be specific with your prompts for better results</li>
              <li>• Use your brand profile information for consistent styling</li>
              <li>• Generate multiple variations and pick the best one</li>
              <li>• Review content before scheduling or publishing</li>
            </ul>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

