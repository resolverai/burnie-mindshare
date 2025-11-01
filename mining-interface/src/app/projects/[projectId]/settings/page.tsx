'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getApiUrlWithFallback } from '@/utils/api-config'

interface ProjectConfiguration {
  id: number
  project_id: number
  image_model: string
  video_model: string
  clip_duration: number
  daily_posts_count: number
  content_mix: {
    shitpost: number
    threads: number
    longpost: number
  }
  schedule_config: {
    frequency: 'daily' | 'weekly' | 'thrice_week' | 'custom'
    days: number[]
    time: string
  } | null
}

export default function ProjectSettingsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const router = useRouter()
  const apiUrl = getApiUrlWithFallback()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  // Configuration state - Web2 settings
  const [imageModel, setImageModel] = useState<string>('seedream')
  const [videoModel, setVideoModel] = useState<string>('kling')
  const [clipDuration, setClipDuration] = useState<number>(5)
  
  // Configuration state - Web3 specific settings
  const [dailyPostsCount, setDailyPostsCount] = useState<number>(10)
  const [contentMix, setContentMix] = useState({
    shitpost: 4,
    threads: 4,
    longpost: 2
  })
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'thrice_week' | 'custom'>('daily')
  const [scheduleDays, setScheduleDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]) // All days for daily
  const [scheduleHour, setScheduleHour] = useState<string>('9')
  const [scheduleMinute, setScheduleMinute] = useState<string>('00')
  const [scheduleAmPm, setScheduleAmPm] = useState<'AM' | 'PM'>('AM')

  // Day names for display
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  useEffect(() => {
    const projectIdFromStorage = localStorage.getItem('burnie_project_id')
    if (!projectIdFromStorage || projectIdFromStorage !== projectId) {
      router.replace('/projects/auth')
      return
    }
    
    fetchConfiguration()
  }, [projectId, router])

  const fetchConfiguration = async () => {
    if (!apiUrl || !projectId) {
      console.error('Missing apiUrl or projectId')
      setIsLoading(false)
      return
    }
    
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const response = await fetch(`${apiUrl}/projects/${projectId}/configurations?user_timezone=${encodeURIComponent(userTimezone)}`)
      if (response.ok) {
        const config: ProjectConfiguration = await response.json()
        setImageModel(config.image_model)
        setVideoModel(config.video_model)
        setClipDuration(config.clip_duration)
        setDailyPostsCount(config.daily_posts_count)
        if (config.content_mix) {
          setContentMix(config.content_mix)
        }
        // Load schedule config
        if (config.schedule_config) {
          setScheduleFrequency(config.schedule_config.frequency)
          setScheduleDays(config.schedule_config.days || [])
          // Parse time from HH:mm to hour, minute, AM/PM
          const timeStr = config.schedule_config.time || '09:00'
          const [hours, minutes] = timeStr.split(':').map(Number)
          const hour24 = hours
          const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24
          setScheduleHour(hour12.toString())
          setScheduleMinute(String(minutes).padStart(2, '0'))
          setScheduleAmPm(hour24 >= 12 ? 'PM' : 'AM')
        } else {
          // Default: daily at 09:00 AM
          setScheduleFrequency('daily')
          setScheduleDays([0, 1, 2, 3, 4, 5, 6])
          setScheduleHour('9')
          setScheduleMinute('00')
          setScheduleAmPm('AM')
        }
      }
    } catch (error) {
      console.error('Failed to fetch configuration:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!apiUrl || !projectId) {
      alert('API URL or Project ID not configured')
      return
    }
    
    setIsSaving(true)
    try {
      // Determine days based on frequency
      let finalDays = scheduleDays
      if (scheduleFrequency === 'daily') {
        finalDays = [0, 1, 2, 3, 4, 5, 6] // All days
      } else if (scheduleFrequency === 'weekly') {
        // Keep selected days (should be one day)
        if (finalDays.length === 0) {
          finalDays = [1] // Default to Monday
        }
      } else if (scheduleFrequency === 'thrice_week') {
        // Default to Mon, Wed, Fri if empty
        if (finalDays.length === 0) {
          finalDays = [1, 3, 5]
        }
      }
      // For custom, use selected days as-is

      // Convert hour, minute, AM/PM to 24-hour format (HH:mm)
      const hour24 = parseInt(scheduleHour)
      let hour24Value = scheduleAmPm === 'AM' 
        ? (hour24 === 12 ? 0 : hour24)
        : (hour24 === 12 ? 12 : hour24 + 12)
      const time24 = `${String(hour24Value).padStart(2, '0')}:${scheduleMinute.padStart(2, '0')}`

      const response = await fetch(`${apiUrl}/projects/${projectId}/configurations`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_model: imageModel,
          video_model: videoModel,
          clip_duration: clipDuration,
          daily_posts_count: dailyPostsCount,
          content_mix: contentMix,
          schedule_config: {
            frequency: scheduleFrequency,
            days: finalDays,
            time: time24, // HH:mm format in user's timezone, backend will convert
          },
          user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  // Auto-adjust longpost when daily posts count changes (not when user manually changes mix)
  // This ensures the total always matches dailyPostsCount when the count changes
  useEffect(() => {
    const total = contentMix.shitpost + contentMix.threads + contentMix.longpost
    if (total !== dailyPostsCount) {
      // Adjust longpost to make total match
      const newLongpost = dailyPostsCount - contentMix.shitpost - contentMix.threads
      if (newLongpost >= 0) {
        setContentMix(prev => ({
          ...prev,
          longpost: newLongpost
        }))
      } else {
        // If negative, adjust proportionally
        const ratio = dailyPostsCount / total
        setContentMix({
          shitpost: Math.round(contentMix.shitpost * ratio),
          threads: Math.round(contentMix.threads * ratio),
          longpost: dailyPostsCount - Math.round(contentMix.shitpost * ratio) - Math.round(contentMix.threads * ratio)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyPostsCount]) // Only react to dailyPostsCount changes

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
        </div>
      </div>
    )
  }

  const totalMix = contentMix.shitpost + contentMix.threads + contentMix.longpost
  const mixWarning = totalMix !== dailyPostsCount

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Project Settings</h1>
      
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
          </div>
        </div>
      </div>

      {/* Daily Posts Configuration */}
      <div className="mb-8">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <span className="mr-2">📊</span>
            Daily Posts Configuration
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Number of Daily Posts
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={dailyPostsCount}
                onChange={(e) => setDailyPostsCount(parseInt(e.target.value) || 1)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
              <p className="mt-2 text-sm text-gray-400">
                Total number of posts to generate daily (between 1 and 50).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Mix Configuration */}
      <div className="mb-8">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <span className="mr-2">🎯</span>
            Content Mix Configuration
          </h2>
          
          <div className="space-y-4">
            {mixWarning && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-300">
                  ⚠️ Content mix totals ({totalMix}) must equal daily posts count ({dailyPostsCount})
                </p>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Shitposts
                </label>
                <input
                  type="number"
                  min="0"
                  value={contentMix.shitpost}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0
                    const remaining = dailyPostsCount - value - contentMix.threads
                    setContentMix({
                      shitpost: value,
                      threads: contentMix.threads,
                      longpost: Math.max(0, remaining)
                    })
                  }}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Threads
                </label>
                <input
                  type="number"
                  min="0"
                  value={contentMix.threads}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0
                    const remaining = dailyPostsCount - contentMix.shitpost - value
                    setContentMix({
                      shitpost: contentMix.shitpost,
                      threads: value,
                      longpost: Math.max(0, remaining)
                    })
                  }}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Longposts
                </label>
                <input
                  type="number"
                  min="0"
                  value={contentMix.longpost}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0
                    const remaining = dailyPostsCount - contentMix.shitpost - contentMix.threads
                    setContentMix({
                      shitpost: contentMix.shitpost,
                      threads: contentMix.threads,
                      longpost: Math.max(0, Math.min(value, remaining))
                    })
                  }}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                />
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-gray-900/30 rounded-lg">
              <p className="text-sm text-gray-400">
                Total: <span className={`font-semibold ${mixWarning ? 'text-yellow-400' : 'text-green-400'}`}>
                  {totalMix} / {dailyPostsCount}
                </span>
              </p>
            </div>
            
            <p className="text-sm text-gray-400">
              Configure how many posts of each type should be generated daily. The total must match the number of daily posts.
            </p>
          </div>
        </div>
      </div>

      {/* Post Schedule Configuration */}
      <div className="mb-8">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
            <span className="mr-2">⏰</span>
            Post Schedule Configuration
          </h2>
          
          <div className="space-y-6">
            {/* Schedule Frequency */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Schedule Frequency
              </label>
              <select
                value={scheduleFrequency}
                onChange={(e) => {
                  const freq = e.target.value as 'daily' | 'weekly' | 'thrice_week' | 'custom'
                  setScheduleFrequency(freq)
                  
                  // Auto-set days based on frequency
                  if (freq === 'daily') {
                    setScheduleDays([0, 1, 2, 3, 4, 5, 6])
                  } else if (freq === 'weekly') {
                    setScheduleDays([1]) // Default to Monday
                  } else if (freq === 'thrice_week') {
                    setScheduleDays([1, 3, 5]) // Mon, Wed, Fri
                  }
                  // For 'custom', keep existing days
                }}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="thrice_week">Thrice a Week</option>
                <option value="custom">Custom</option>
              </select>
              <p className="mt-2 text-sm text-gray-400">
                Choose how often posts should be published automatically.
              </p>
            </div>

            {/* Day Selection (shown for weekly, thrice_week, and custom) */}
            {(scheduleFrequency === 'weekly' || scheduleFrequency === 'thrice_week' || scheduleFrequency === 'custom') && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Select Days
                </label>
                <div className="grid grid-cols-7 gap-2">
                  {dayNames.map((day, index) => {
                    const isSelected = scheduleDays.includes(index)
                    const maxSelections = scheduleFrequency === 'weekly' ? 1 : scheduleFrequency === 'thrice_week' ? 3 : undefined
                    
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          if (scheduleFrequency === 'weekly') {
                            // For weekly, always set to the clicked day (replace current selection)
                            setScheduleDays([index])
                          } else {
                            // Toggle day selection
                            if (isSelected) {
                              setScheduleDays(scheduleDays.filter(d => d !== index))
                            } else {
                              if (maxSelections && scheduleDays.length >= maxSelections) {
                                return // Don't allow more selections
                              }
                              setScheduleDays([...scheduleDays, index].sort())
                            }
                          }
                        }}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          isSelected
                            ? 'bg-orange-500 text-white hover:bg-orange-600'
                            : 'bg-gray-900/50 text-gray-300 border border-gray-600 hover:bg-gray-800 hover:border-gray-500'
                        }`}
                      >
                        {day.substring(0, 3)}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  {scheduleFrequency === 'weekly' && 'Select one day per week'}
                  {scheduleFrequency === 'thrice_week' && 'Select up to 3 days per week'}
                  {scheduleFrequency === 'custom' && 'Select any combination of days'}
                </p>
                {scheduleDays.length > 0 && (
                  <div className="mt-2 p-2 bg-gray-900/30 rounded-lg">
                    <p className="text-xs text-gray-400">Selected: {scheduleDays.map(d => dayNames[d]).join(', ')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Time Input */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Posting Time
              </label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={scheduleHour}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '')
                      if (value === '' || (parseInt(value) >= 1 && parseInt(value) <= 12)) {
                        setScheduleHour(value)
                      }
                    }}
                    onBlur={() => {
                      if (!scheduleHour || parseInt(scheduleHour) < 1) {
                        setScheduleHour('1')
                      } else if (parseInt(scheduleHour) > 12) {
                        setScheduleHour('12')
                      }
                    }}
                    className="w-16 px-3 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    placeholder="9"
                  />
                  <span className="text-white text-xl">:</span>
                  <input
                    type="text"
                    value={scheduleMinute}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '')
                      if (value === '' || (parseInt(value) >= 0 && parseInt(value) <= 59)) {
                        setScheduleMinute(value.padStart(2, '0').slice(0, 2))
                      }
                    }}
                    onBlur={() => {
                      if (!scheduleMinute) {
                        setScheduleMinute('00')
                      } else {
                        setScheduleMinute(String(parseInt(scheduleMinute)).padStart(2, '0'))
                      }
                    }}
                    className="w-16 px-3 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    placeholder="00"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleAmPm('AM')}
                    className={`px-4 py-3 rounded-lg font-medium transition-all ${
                      scheduleAmPm === 'AM'
                        ? 'bg-orange-500 text-white hover:bg-orange-600'
                        : 'bg-gray-900/50 text-gray-300 border border-gray-600 hover:bg-gray-800 hover:border-gray-500'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleAmPm('PM')}
                    className={`px-4 py-3 rounded-lg font-medium transition-all ${
                      scheduleAmPm === 'PM'
                        ? 'bg-orange-500 text-white hover:bg-orange-600'
                        : 'bg-gray-900/50 text-gray-300 border border-gray-600 hover:bg-gray-800 hover:border-gray-500'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                Time when posts will be automatically published on Twitter (in your local timezone). This time will be converted to the server timezone for scheduling.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving || mixWarning}
          className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}


