'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'

interface AccountConfiguration {
  id: number
  account_id: number
  image_model: string
  video_model: string
  clip_duration: number
}

export default function SettingsPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [accountId, setAccountId] = useState<number | null>(null)
  
  // Configuration state
  const [imageModel, setImageModel] = useState<string>('seedream')
  const [videoModel, setVideoModel] = useState<string>('kling')
  const [clipDuration, setClipDuration] = useState<number>(5)

  useEffect(() => {
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountIdStr = localStorage.getItem('burnie_web2_account_id')
    
    if (!web2Auth || !accountIdStr) {
      router.push('/web2/auth')
      return
    }
    
    const accId = parseInt(accountIdStr, 10)
    setAccountId(accId)
    
    // Fetch existing configuration
    fetchConfiguration(accId)
  }, [router])

  const fetchConfiguration = async (accId: number) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
      const response = await fetch(`${apiUrl}/web2-account-configurations/${accId}`)
      if (response.ok) {
        const config: AccountConfiguration = await response.json()
        setImageModel(config.image_model)
        setVideoModel(config.video_model)
        setClipDuration(config.clip_duration)
      }
    } catch (error) {
      console.error('Failed to fetch configuration:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!accountId) return

    setIsSaving(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
      const response = await fetch(`${apiUrl}/web2-account-configurations/${accountId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_model: imageModel,
          video_model: videoModel,
          clip_duration: clipDuration,
        }),
      })

      if (response.ok) {
        alert('Settings saved successfully!')
      } else {
        const error = await response.json()
        alert(`Failed to save settings: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to save configuration:', error)
      alert('Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const getAvailableDurations = () => {
    if (videoModel === 'pixverse') return [5, 8]
    if (videoModel === 'sora') return [4, 8, 12]
    if (videoModel === 'kling') return [5, 10]
    return [5]
  }

  useEffect(() => {
    // Auto-adjust clip duration when video model changes
    const availableDurations = getAvailableDurations()
    if (!availableDurations.includes(clipDuration)) {
      setClipDuration(availableDurations[0])
    }
  }, [videoModel])

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
          <h1 className="text-xl font-semibold text-white">Settings</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-8">Account Settings</h1>
            
            {/* Image Generation Settings */}
            <div className="mb-8">
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
                  <span className="mr-2">🎨</span>
                  Image Generation Settings
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Image Model
                    </label>
                    <select
                      value={imageModel}
                      onChange={(e) => setImageModel(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    >
                      <option value="flux-pro-kontext">Flux Pro Kontext</option>
                      <option value="seedream">Seedream (ByteDance)</option>
                      <option value="nano-banana">Nano-Banana</option>
                    </select>
                    <p className="mt-2 text-sm text-gray-400">
                      Choose the AI model for generating images. All images are generated in square (1:1) aspect ratio.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Generation Settings */}
            <div className="mb-8">
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
                  <span className="mr-2">🎬</span>
                  Video Generation Settings
                </h2>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Video Model
                    </label>
                    <select
                      value={videoModel}
                      onChange={(e) => setVideoModel(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    >
                      <option value="pixverse">Pixverse Transition V5</option>
                      <option value="sora">Sora 2 (OpenAI)</option>
                      <option value="kling">Kling 2.5 Turbo</option>
                    </select>
                    <p className="mt-2 text-sm text-gray-400">
                      Choose the AI model for generating video clips. All videos are generated in 16:9 aspect ratio.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Clip Duration
                    </label>
                    <select
                      value={clipDuration}
                      onChange={(e) => setClipDuration(parseInt(e.target.value))}
                      className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    >
                      {getAvailableDurations().map((duration) => (
                        <option key={duration} value={duration}>
                          {duration} seconds
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-sm text-gray-400">
                      {videoModel === 'pixverse' && 'Pixverse supports 5 or 8 second clips.'}
                      {videoModel === 'sora' && 'Sora supports 4, 8, or 12 second clips.'}
                      {videoModel === 'kling' && 'Kling supports 5 or 10 second clips.'}
                    </p>
                  </div>

                  {/* Model Info Cards */}
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      videoModel === 'pixverse' 
                        ? 'border-orange-500 bg-orange-500/10' 
                        : 'border-gray-700 bg-gray-900/30'
                    }`}>
                      <h3 className="font-semibold text-white mb-2">Pixverse</h3>
                      <p className="text-xs text-gray-400">Transition-based video generation. Best for smooth frame transitions.</p>
                      <p className="text-xs text-gray-500 mt-2">Duration: 5s or 8s</p>
                    </div>
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      videoModel === 'sora' 
                        ? 'border-orange-500 bg-orange-500/10' 
                        : 'border-gray-700 bg-gray-900/30'
                    }`}>
                      <h3 className="font-semibold text-white mb-2">Sora 2</h3>
                      <p className="text-xs text-gray-400">OpenAI's advanced video model. High quality cinematic output.</p>
                      <p className="text-xs text-gray-500 mt-2">Duration: 4s, 8s, or 12s</p>
                    </div>
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      videoModel === 'kling' 
                        ? 'border-orange-500 bg-orange-500/10' 
                        : 'border-gray-700 bg-gray-900/30'
                    }`}>
                      <h3 className="font-semibold text-white mb-2">Kling</h3>
                      <p className="text-xs text-gray-400">Fast turbo model. Quick generation with great results.</p>
                      <p className="text-xs text-gray-500 mt-2">Duration: 5s or 10s</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
