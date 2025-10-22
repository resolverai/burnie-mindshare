'use client'

interface ProgressOverlayProps {
  message: string
  percent: number
  step?: string
}

export default function ProgressOverlay({ message, percent, step }: ProgressOverlayProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-900/95 rounded-lg p-8">
      {/* Animated spinner */}
      <div className="mb-6">
        <div className="w-20 h-20 border-4 border-gray-700 border-t-orange-500 rounded-full animate-spin"></div>
      </div>
      
      {/* Progress message */}
      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-white mb-2">{message}</h3>
        {step && <p className="text-sm text-gray-400">{step}</p>}
      </div>
      
      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="bg-gray-700 rounded-full h-3 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-orange-500 to-orange-600 h-full transition-all duration-500 ease-out"
            style={{ width: percent + '%' }}
          ></div>
        </div>
        <div className="text-center mt-2 text-sm text-gray-400">{percent}%</div>
      </div>
      
      {/* Loading dots animation */}
      <div className="flex space-x-2 mt-6">
        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
      </div>
    </div>
  )
}

