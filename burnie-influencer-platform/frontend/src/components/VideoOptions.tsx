'use client'

import React from 'react'

interface VideoOptionsProps {
  includeVideo: boolean
  videoDuration: number
  onVideoToggle: (includeVideo: boolean) => void
  onDurationChange: (duration: number) => void
  disabled?: boolean
}

const VIDEO_DURATION_OPTIONS = [
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 20, label: '20 seconds' },
  { value: 25, label: '25 seconds' }
]

export default function VideoOptions({
  includeVideo,
  videoDuration,
  onVideoToggle,
  onDurationChange,
  disabled = false
}: VideoOptionsProps) {
  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="include-video"
          checked={includeVideo}
          onChange={(e) => onVideoToggle(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="include-video" className="text-sm font-medium text-gray-700">
          Generate Video
        </label>
      </div>
      
      {includeVideo && (
        <div className="space-y-2">
          <label htmlFor="video-duration" className="block text-sm font-medium text-gray-700">
            Video Duration
          </label>
          <select
            id="video-duration"
            value={videoDuration}
            onChange={(e) => onDurationChange(parseInt(e.target.value))}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {VIDEO_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
      
      {includeVideo && (
        <div className="text-xs text-gray-600 bg-blue-50 p-3 rounded">
          <p className="font-medium mb-1">🎬 Video Generation Info:</p>
          <ul className="space-y-1">
            <li>• Video will be generated after the initial image</li>
            <li>• Duration: {videoDuration} seconds ({Math.ceil(videoDuration / 5) + 1} frames, {Math.ceil(videoDuration / 5)} clips)</li>
            <li>• Includes dynamic frames, clips, and audio</li>
            <li>• Brand logo will be overlaid on the final video</li>
          </ul>
        </div>
      )}
    </div>
  )
}