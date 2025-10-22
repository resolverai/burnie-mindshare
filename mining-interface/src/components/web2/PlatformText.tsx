'use client'

import { DocumentDuplicateIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

interface PlatformTextProps {
  text: string
  platform: 'twitter' | 'youtube' | 'instagram' | 'linkedin'
  onCopy: () => void
  onPost: () => void
}

export default function PlatformText({ text, platform, onCopy, onPost }: PlatformTextProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    onCopy()
  }

  return (
    <div className="p-4 bg-gray-800/50">
      {/* Text display */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4 max-h-60 overflow-y-auto">
        <p className="text-gray-300 whitespace-pre-wrap text-sm leading-relaxed">
          {text}
        </p>
      </div>
      
      {/* Action buttons */}
      <div className="flex space-x-3">
        <button
          onClick={handleCopy}
          className={'flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-all ' + (
            copied
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          )}
        >
          <DocumentDuplicateIcon className="w-5 h-5" />
          <span>{copied ? 'Copied!' : 'Copy Text'}</span>
        </button>
        
        <button
          onClick={onPost}
          className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg font-medium transition-all"
        >
          <PaperAirplaneIcon className="w-5 h-5" />
          <span>Post to {platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
        </button>
      </div>
    </div>
  )
}

