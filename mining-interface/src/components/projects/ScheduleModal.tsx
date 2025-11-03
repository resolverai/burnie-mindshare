'use client'

import { useState, useEffect } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'

interface ScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  mediaS3Url: string
  mediaType: 'image' | 'video'
  tweetText: {
    main_tweet: string
    thread_array?: string[]
    content_type: 'thread' | 'shitpost' | 'longpost'
  }
  currentSchedule?: {
    scheduleId: number
    scheduledAt: string
    mediaS3Url: string
    mediaType: 'image' | 'video'
    tweetText?: {
      main_tweet: string
      thread_array?: string[]
      content_type: 'thread' | 'shitpost' | 'longpost'
    }
  } | null
}

export default function ScheduleModal({
  isOpen,
  onClose,
  projectId,
  mediaS3Url,
  mediaType,
  tweetText,
  currentSchedule
}: ScheduleModalProps) {
  const [scheduledAt, setScheduledAt] = useState<string>('')
  const [scheduledDate, setScheduledDate] = useState<string>('')
  const [scheduledTime, setScheduledTime] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize from current schedule or set defaults
  useEffect(() => {
    if (currentSchedule && currentSchedule.scheduledAt) {
      const scheduleDate = new Date(currentSchedule.scheduledAt)
      const dateStr = scheduleDate.toISOString().split('T')[0]
      const timeStr = scheduleDate.toTimeString().split(' ')[0].slice(0, 5) // HH:mm
      
      setScheduledDate(dateStr)
      setScheduledTime(timeStr)
      setScheduledAt(currentSchedule.scheduledAt)
    } else {
      // Default: tomorrow at 9 AM
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      
      const dateStr = tomorrow.toISOString().split('T')[0]
      const timeStr = '09:00'
      
      setScheduledDate(dateStr)
      setScheduledTime(timeStr)
      setScheduledAt(tomorrow.toISOString())
    }
  }, [currentSchedule, isOpen])

  // Update scheduledAt when date or time changes
  useEffect(() => {
    if (scheduledDate && scheduledTime) {
      const [hours, minutes] = scheduledTime.split(':').map(Number)
      const dateTime = new Date(scheduledDate)
      dateTime.setHours(hours, minutes, 0, 0)
      setScheduledAt(dateTime.toISOString())
    }
  }, [scheduledDate, scheduledTime])

  if (!isOpen) return null

  const handleSave = async () => {
    if (!scheduledDate || !scheduledTime) {
      setError('Please select both date and time')
      return
    }

    const [hours, minutes] = scheduledTime.split(':').map(Number)
    const dateTime = new Date(scheduledDate)
    dateTime.setHours(hours, minutes, 0, 0)
    
    if (dateTime <= new Date()) {
      setError('Scheduled date and time must be in the future')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/post/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaS3Url,
          mediaType,
          tweetText,
          scheduledAt: dateTime.toISOString()
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save schedule')
      }

      const result = await response.json()
      if (result.success) {
        onClose()
        // Trigger refresh in parent component if needed
        window.location.reload()
      } else {
        throw new Error(result.error || 'Failed to save schedule')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this schedule?')) {
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const apiUrl = getApiUrlWithFallback()
      const response = await fetch(`${apiUrl}/projects/${projectId}/post/schedule?mediaS3Url=${encodeURIComponent(mediaS3Url)}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to delete schedule')
      }

      onClose()
      window.location.reload()
    } catch (err: any) {
      setError(err.message || 'Failed to delete schedule')
    } finally {
      setIsSaving(false)
    }
  }

  const formatScheduleDate = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Schedule Post</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {currentSchedule && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                This post is currently scheduled to be posted on Twitter on{' '}
                <span className="font-semibold">{formatScheduleDate(currentSchedule.scheduledAt)}</span>
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Date
              </label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Time
              </label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {scheduledDate && scheduledTime && (
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-400">Scheduled for:</p>
                <p className="text-lg font-semibold text-white">
                  {new Date(scheduledAt).toLocaleString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            {currentSchedule && (
              <button
                onClick={handleDelete}
                disabled={isSaving}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Remove Schedule
              </button>
            )}
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !scheduledDate || !scheduledTime}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {isSaving ? 'Saving...' : currentSchedule ? 'Update Schedule' : 'Save Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
