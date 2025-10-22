'use client'

interface PlatformSelectorProps {
  platforms: Array<'twitter' | 'youtube' | 'instagram' | 'linkedin'>
  selected: string
  onChange: (platform: string) => void
  disabled?: boolean
}

const platformConfig = {
  twitter: {
    label: 'Twitter',
    icon: '𝕏',
    color: 'from-gray-700 to-gray-900'
  },
  youtube: {
    label: 'YouTube',
    icon: '▶',
    color: 'from-red-600 to-red-800'
  },
  instagram: {
    label: 'Instagram',
    icon: '📷',
    color: 'from-pink-600 to-purple-600'
  },
  linkedin: {
    label: 'LinkedIn',
    icon: 'in',
    color: 'from-blue-600 to-blue-800'
  }
}

export default function PlatformSelector({ platforms, selected, onChange, disabled }: PlatformSelectorProps) {
  return (
    <div className="flex items-center space-x-2 p-4 bg-gray-800/50 border-b border-gray-700">
      {platforms.map((platform) => {
        const config = platformConfig[platform]
        const isSelected = selected === platform
        
        return (
          <button
            key={platform}
            onClick={() => !disabled && onChange(platform)}
            disabled={disabled}
            className={'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all ' + (
              disabled
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : isSelected
                  ? 'bg-gradient-to-r ' + config.color + ' text-white shadow-lg scale-105'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:scale-102'
            )}
          >
            <span className="text-lg">{config.icon}</span>
            <span>{config.label}</span>
          </button>
        )
      })}
    </div>
  )
}

