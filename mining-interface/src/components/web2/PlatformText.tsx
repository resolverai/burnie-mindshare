'use client'

import { useState } from 'react'

interface PlatformTextProps {
  text: string
  platform: 'twitter' | 'youtube' | 'instagram' | 'linkedin'
  onCopy: () => void
  onPost: () => void
}

export default function PlatformText({ text, platform, onCopy, onPost }: PlatformTextProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      onCopy()
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const openModal = () => {
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
  }

  return (
    <>
      <div className="p-4 bg-gray-800/50">
        {/* Clickable text display with fixed height */}
        <div 
          className="bg-gray-900 rounded-lg p-4 cursor-pointer hover:bg-gray-800 transition-colors relative h-24 overflow-hidden"
          onClick={openModal}
        >
          <p className="text-gray-300 whitespace-pre-wrap text-sm leading-relaxed line-clamp-4">
            {text}
          </p>
          {/* Gradient overlay to indicate more content */}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none"></div>
        </div>
      </div>

      {/* Modal for full text */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div 
            className="relative max-w-2xl w-full bg-gray-900 rounded-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl"
            >
              ×
            </button>
            
            <h3 className="text-xl font-semibold text-white mb-4">
              {platform.charAt(0).toUpperCase() + platform.slice(1)} Post Text
            </h3>
            
            <div className="bg-gray-800 rounded-lg p-4 mb-4 max-h-96 overflow-y-auto">
              <p className="text-gray-300 whitespace-pre-wrap text-sm leading-relaxed">
                {text}
              </p>
            </div>
            
            <button
              onClick={handleCopy}
              className={`w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-lg font-medium transition-all ${
                copied
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              <span>{copied ? 'Copied!' : 'Copy Text'}</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

